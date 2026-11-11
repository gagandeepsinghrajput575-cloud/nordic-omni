"""Validation for `clients/<slug>/client.config.json`."""

from __future__ import annotations

import json
import math
import pathlib
import re
import uuid
from typing import Any


class ConfigError(ValueError):
    pass


SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _require_text(mapping: dict[str, Any], key: str, label: str) -> str:
    value = str(mapping.get(key) or "").strip()
    if not value:
        raise ConfigError(f"{label} requires a non-empty {key}")
    return value


def _positive_number(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ConfigError(f"{label} must be a number") from None
    if not math.isfinite(number) or number <= 0:
        raise ConfigError(f"{label} must be positive and finite")
    return number


def validate_client_config(config: Any) -> dict[str, Any]:
    if not isinstance(config, dict):
        raise ConfigError("Client config must be a JSON object")
    try:
        uuid.UUID(str(config.get("id") or ""))
    except ValueError:
        raise ConfigError("id must be a UUID") from None

    _require_text(config, "name", "Client")
    slug = _require_text(config, "slug", "Client")
    if not SLUG_RE.fullmatch(slug):
        raise ConfigError("slug may contain only lowercase letters, digits and hyphens")
    if config.get("language") not in ("da-DK", "en-US"):
        raise ConfigError("language must be da-DK or en-US")

    owner = config.get("owner")
    if not isinstance(owner, dict):
        raise ConfigError("owner must be an object")
    _require_text(owner, "name", "Owner")
    _require_text(owner, "phone", "Owner")
    email = _require_text(owner, "email", "Owner")
    if not EMAIL_RE.fullmatch(email):
        raise ConfigError("owner.email is invalid")

    hours = config.get("business_hours")
    if not isinstance(hours, dict) or not hours:
        raise ConfigError("business_hours must be a non-empty object")

    catalog = config.get("pricing_catalog")
    if not isinstance(catalog, list) or not catalog:
        raise ConfigError("pricing_catalog must be a non-empty list")
    seen_ids: set[str] = set()
    for index, item in enumerate(catalog):
        label = f"pricing_catalog[{index}]"
        if not isinstance(item, dict):
            raise ConfigError(f"{label} must be an object")
        item_id = _require_text(item, "id", label)
        if item_id in seen_ids:
            raise ConfigError(f"duplicate catalog id: {item_id}")
        seen_ids.add(item_id)
        _require_text(item, "service", label)
        _positive_number(item.get("price_dkk"), f"{label}.price_dkk")
        model = item.get("estimate_model")
        if model is not None:
            if model not in ("fixed", "per_square_meter"):
                raise ConfigError(f"{label}.estimate_model is unsupported")
            low = _positive_number(item.get("estimate_min_dkk"), f"{label}.estimate_min_dkk")
            high = _positive_number(item.get("estimate_max_dkk"), f"{label}.estimate_max_dkk")
            if low > high:
                raise ConfigError(f"{label} estimate range is inverted")

    if not isinstance(config.get("escalation_policy"), dict):
        raise ConfigError("escalation_policy must be an object")
    telephony = config.get("telephony")
    if telephony is not None:
        if not isinstance(telephony, dict):
            raise ConfigError("telephony must be an object")
        if telephony.get("provider") not in (None, "flynumber"):
            raise ConfigError("telephony.provider must be flynumber")
        if telephony.get("did") is not None:
            from services.phone import normalize_phone

            if normalize_phone(str(telephony["did"])) is None:
                raise ConfigError("telephony.did must be a valid phone number")
    return config


def load_client_config(path: str | pathlib.Path) -> dict[str, Any]:
    try:
        raw = json.loads(pathlib.Path(path).read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigError(f"Could not read client config: {exc}") from exc
    return validate_client_config(raw)
