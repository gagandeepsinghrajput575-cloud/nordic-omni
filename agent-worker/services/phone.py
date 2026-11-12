"""Phone normalization and explicitly confirmed SIP transfers."""

from __future__ import annotations

import os
import re
from typing import Any


def normalize_phone(value: str | None) -> str | None:
    if not value:
        return None
    raw = str(value).strip()
    if raw.startswith("00"):
        raw = f"+{raw[2:]}"
    digits = re.sub(r"\D", "", raw)
    if len(digits) < 7 or len(digits) > 15:
        return None
    return f"+{digits}"


def livekit_http_url(value: str) -> str:
    return value.replace("wss://", "https://").replace("ws://", "http://").rstrip("/")


async def forward_sip_call(room_name: str, participant_identity: str, owner_phone: str) -> tuple[bool, str]:
    """Transfer an existing PSTN participant; never claim success for a mere dial attempt.

    LiveKit resolves the destination through the project's configured SIP outbound
    trunk. No carrier credentials or telephone routing are fabricated here.
    """
    destination = normalize_phone(owner_phone)
    if not destination:
        return False, "A valid international owner phone number is required."
    if not participant_identity.strip():
        return False, "The inbound SIP participant could not be identified."
    url = livekit_http_url(os.getenv("LIVEKIT_URL", ""))
    key = os.getenv("LIVEKIT_API_KEY")
    secret = os.getenv("LIVEKIT_API_SECRET")
    if not url or not key or not secret:
        return False, "LiveKit SIP is not configured."
    from livekit import api

    try:
        async with api.LiveKitAPI(url, key, secret) as client:
            result: Any = await client.sip.transfer_sip_participant(
                api.TransferSIPParticipantRequest(
                    room_name=room_name,
                    participant_identity=participant_identity,
                    transfer_to=f"tel:{destination}",
                    play_dialtone=True,
                ),
                timeout=45,
            )
        if result.status == api.SIPTransferStatus.STS_TRANSFER_SUCCESSFUL:
            return True, "SIP transfer confirmed."
        return False, f"SIP transfer was not completed (status={result.status}, reason={result.reason})."
    except Exception:
        # Exception bodies may contain provider credentials or subscriber details.
        return False, "The SIP provider could not complete the transfer."
