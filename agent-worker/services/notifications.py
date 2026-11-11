"""Owner escalation webhook for N8N.

N8N owns the provider-specific part: SMS, phone call, push, or task. This worker
only states that the workflow accepted the event; it never claims a human is live.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from typing import Any

import aiohttp


async def notify_owner_escalation(payload: dict[str, Any]) -> tuple[bool, str | None]:
    url = (os.getenv("N8N_ESCALATION_WEBHOOK_URL") or "").strip()
    if not url:
        return False, None

    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    headers = {"Content-Type": "application/json"}
    secret = (os.getenv("N8N_WEBHOOK_SECRET") or "").strip()
    if secret:
        digest = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
        headers["X-OMNI-Signature"] = f"sha256={digest}"

    try:
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=7)
        ) as session:
            async with session.post(url, data=body, headers=headers) as response:
                if 200 <= response.status < 300:
                    return True, None
                return False, f"HTTP {response.status}"
    except Exception as exc:  # network failures must not crash the voice agent
        return False, str(exc)
