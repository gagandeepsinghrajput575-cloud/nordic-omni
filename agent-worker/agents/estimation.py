"""Catalog-grounded estimate calculations, kept outside the LLM."""

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


def _number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) and result > 0 else None


def _legacy_bracket(unit: str) -> tuple[float, float] | None:
    match = re.search(
        r"typisk\s+([\d.]+)(?:,\d+)?\s*-\s*([\d.]+)(?:,\d+)?",
        unit,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    low = _number(match.group(1).replace(".", ""))
    high = _number(match.group(2).replace(".", ""))
    if low is None or high is None:
        return None
    return low, high


def calculate_estimate(
    catalog: list[dict[str, Any]],
    catalog_item_id: str,
    square_meters: float | None,
) -> Estimate:
    item = next((entry for entry in catalog if entry.get("id") == catalog_item_id), None)
    if not item:
        raise EstimateError("This project type is not configured for an estimate.")

    unit = str(item.get("unit") or "")
    low = _number(item.get("estimate_min_dkk"))
    high = _number(item.get("estimate_max_dkk"))
    if low is None or high is None:
        legacy = _legacy_bracket(unit)
        if legacy:
            low, high = legacy
    if low is None or high is None or low > high:
        raise EstimateError("No valid estimate bracket is configured for this project.")

    model = str(item.get("estimate_model") or "").strip()
    if not model:
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
    elif model != "fixed":
        raise EstimateError("The catalog has an unsupported estimation model.")

    return Estimate(
        catalog_item_id=catalog_item_id,
        service=str(item.get("service") or catalog_item_id),
        minimum=low,
        maximum=high,
        midpoint=round((low + high) / 2),
        square_meters=scope,
    )
