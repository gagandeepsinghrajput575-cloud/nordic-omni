"""Deterministic project-estimate calculations; no network or database writes."""

from __future__ import annotations

import math
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agents.estimation import EstimateError, calculate_estimate  # noqa: E402


CATALOG = [
    {
        "id": "proj-bath",
        "service": "Komplet Nyt Badeværelse",
        "price_dkk": 115000,
        "unit": "vejledende overslag (typisk 95.000 - 165.000 kr.)",
    },
    {
        "id": "proj-extension",
        "service": "Tilbygning / Udestue",
        "price_dkk": 22000,
        "unit": "kr. pr. kvadratmeter (typisk 18.000 - 26.000 kr./m²)",
    },
]


def item(**overrides):
    value = {
        "id": "project",
        "service": "Nyt tag",
        "price_dkk": 1900,
        "unit": "kr. pr. kvadratmeter (typisk 1.400 - 2.400 kr./m²)",
        "estimate_model": "per_square_meter",
        "estimate_min_dkk": 1400,
        "estimate_max_dkk": 2400,
    }
    value.update(overrides)
    return value


class EstimationTests(unittest.TestCase):
    def test_fixed_project_uses_catalog_bracket(self):
        result = calculate_estimate(CATALOG, "proj-bath", None)
        self.assertEqual((result.minimum, result.maximum, result.midpoint), (95000, 165000, 130000))
        self.assertIsNone(result.square_meters)

    def test_per_square_meter_project_requires_and_uses_scope(self):
        result = calculate_estimate(CATALOG, "proj-extension", 35)
        self.assertEqual((result.minimum, result.maximum, result.midpoint), (630000, 910000, 770000))
        self.assertEqual(result.square_meters, 35)

    def test_structured_fields_take_precedence_over_display_unit(self):
        result = calculate_estimate([item(unit="display only")], "project", 100)
        self.assertEqual((result.minimum, result.maximum), (140000, 240000))

    def test_fixed_scope_is_validated_but_not_retained(self):
        fixed = item(estimate_model="fixed", estimate_min_dkk=1, estimate_max_dkk=2)
        result = calculate_estimate([fixed], "project", 8)
        self.assertIsNone(result.square_meters)
        self.assertEqual(result.midpoint, 2)  # half-up, never Python ties-to-even
        for invalid in (True, False, 0, -1, 100_001, "", "8", math.nan, math.inf, -math.inf):
            with self.subTest(invalid=invalid), self.assertRaises(EstimateError):
                calculate_estimate([fixed], "project", invalid)

    def test_danish_legacy_bracket_preserves_decimal_fractions(self):
        legacy = item(
            estimate_model=None,
            estimate_min_dkk=None,
            estimate_max_dkk=None,
            unit="typisk 1.400,50 - 2.400,25 kr. pr. kvadratmeter",
        )
        result = calculate_estimate([legacy], "project", 2)
        self.assertEqual((result.minimum, result.maximum), (2801, 4800.5))
        self.assertEqual(result.midpoint, 3801)

    def test_every_structured_numeric_field_rejects_coercion_and_non_finite_values(self):
        for field in ("price_dkk", "estimate_min_dkk", "estimate_max_dkk"):
            for invalid in (True, False, "", "1400", math.nan, math.inf, -math.inf, -1, 10**1000):
                with self.subTest(field=field, invalid=invalid), self.assertRaises(EstimateError):
                    calculate_estimate([item(**{field: invalid})], "project", 1)

    def test_catalog_shape_and_brackets_match_pricing_item_contract(self):
        invalid_items = [
            item(service="x"), item(price_dkk=None), item(unit=""),
            item(estimate_model="unsupported"),
            item(estimate_min_dkk=2000, estimate_max_dkk=1000),
            item(estimate_model="fixed", estimate_max_dkk=None),
        ]
        for invalid in invalid_items:
            with self.subTest(invalid=invalid), self.assertRaises(EstimateError):
                calculate_estimate([invalid], "project", 1)
        with self.assertRaises(EstimateError):
            calculate_estimate([None], "project", 1)

    def test_unknown_scope_and_out_of_catalog_work_fail_closed(self):
        with self.assertRaises(EstimateError):
            calculate_estimate(CATALOG, "proj-extension", None)
        with self.assertRaises(EstimateError):
            calculate_estimate(CATALOG, "proj-extension", -2)
        with self.assertRaises(EstimateError):
            calculate_estimate(CATALOG, "not-configured", 10)


if __name__ == "__main__":
    unittest.main()
