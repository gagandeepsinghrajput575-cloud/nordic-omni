"""Phone-number normalization shared by SIP routing and contact lookup."""

from __future__ import annotations

import re


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
