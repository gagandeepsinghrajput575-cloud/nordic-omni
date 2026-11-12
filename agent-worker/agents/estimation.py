"""Catalog-grounded estimate calculations, kept outside the LLM.

This is the Python counterpart of web/src/lib/estimation.ts. Structured values
are deliberately strict: JSON strings and booleans are not numeric prices.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
import re
from typing import Any


class EstimateError(ValueError):
    """The requested work cannot be priced from the configured catalog."""


@dataclass(frozen=True)
class Estimate:
    catalog_item_id: str
    service: str
    minimum: float
    maximum: float
    midpoint: float
    square_meters: float | None


def _number(value: Any, *, allow_zero: bool = False) -> float | None:
    """Mirror Zod's finite number checks without JavaScript-like coercion."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        result = float(value)
    except OverflowError:
        return None
    if not math.isfinite(result) or result < 0 or (result == 0 and not allow_zero):
        return None
    return result


def _legacy_number(token: str) -> float | None:
    """Parse a Danish display number such as 18.000,50 or 95000."""
    try:
        value = float(token.replace(".", "").replace(",", "."))
    except ValueError:
        return None
    return value if math.isfinite(value) and value > 0 else None


_LEGACY_NUMBER = r"(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?"


def _legacy_bracket(unit: str) -> tuple[float, float] | None:
    match = re.search(
        rf"typisk\s+({_LEGACY_NUMBER})\s*-\s*({_LEGACY_NUMBER})",
        unit,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    low = _legacy_number(match.group(1))
    high = _legacy_number(match.group(2))
    if low is None or high is None or low > high:
        return None
    return low, high


def _catalog_item(entry: Any, catalog_item_id: str) -> dict[str, Any]:
    """Apply PricingItemSchema's runtime rules before using a catalog entry."""
    if not isinstance(entry, dict) or entry.get("id") != catalog_item_id:
        raise EstimateError("This project type is not configured for an estimate.")
    if not isinstance(catalog_item_id, str) or not catalog_item_id:
        raise EstimateError("This project type is not configured for an estimate.")
    service = entry.get("service")
    unit = entry.get("unit")
    if (
        not isinstance(service, str)
        or len(service) < 2
        or not isinstance(unit, str)
        or not 1 <= len(unit.strip()) <= 240
        or _number(entry.get("price_dkk"), allow_zero=True) is None
    ):
        raise EstimateError("The catalog item is invalid.")

    model = entry.get("estimate_model")
    if model is not None and model not in ("fixed", "per_square_meter"):
        raise EstimateError("The catalog has an unsupported estimation model.")
    low = _number(entry.get("estimate_min_dkk"))
    high = _number(entry.get("estimate_max_dkk"))
    if model is not None and (low is None or high is None):
        raise EstimateError("No valid estimate bracket is configured for this project.")
    if low is not None and high is not None and low > high:
        raise EstimateError("No valid estimate bracket is configured for this project.")
    return entry


def calculate_estimate(
    catalog: list[dict[str, Any]],
    catalog_item_id: str,
    square_meters: Any,
) -> Estimate:
    item = next(
        (
            entry
            for entry in catalog
            if isinstance(entry, dict) and entry.get("id") == catalog_item_id
        ),
        None,
    )
    item = _catalog_item(item, catalog_item_id)

    unit = item["unit"].strip()
    low = _number(item.get("estimate_min_dkk"))
    high = _number(item.get("estimate_max_dkk"))
    if low is None or high is None:
        legacy = _legacy_bracket(unit)
        if legacy is not None:
            low, high = legacy
    if low is None or high is None:
        raise EstimateError("No valid estimate bracket is configured for this project.")

    model = item.get("estimate_model")
    if model is None:
        per_square_meter = "kvadratmeter" in unit.lower() or "m²" in unit.lower()
        model = "per_square_meter" if per_square_meter else "fixed"

    scope = None
    if square_meters is not None:
        scope = _number(square_meters)
        if scope is None or scope > 100_000:
            raise EstimateError("Square meters must be a positive, realistic number.")

    if model == "per_square_meter":
        if scope is None:
            raise EstimateError("Square meters are required for this estimate.")
        low *= scope
        high *= scope
        if not math.isfinite(low) or not math.isfinite(high):
            raise EstimateError("The estimate exceeds the supported numeric range.")
    else:
        # Scope can be useful dialogue context, but is not part of a fixed price.
        scope = None

    return Estimate(
        catalog_item_id=catalog_item_id,
        service=item["service"],
        minimum=low,
        maximum=high,
        # All brackets are positive: floor(x + .5) is JS Math.round at midpoints.
        midpoint=math.floor((low + high) / 2 + 0.5),
        square_meters=scope,
    )
