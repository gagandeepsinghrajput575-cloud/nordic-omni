"""Deterministic project-estimate calculations; no network or database writes."""

from __future__ import annotations

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


class EstimationTests(unittest.TestCase):
    def test_fixed_project_uses_catalog_bracket(self):
        result = calculate_estimate(CATALOG, "proj-bath", None)
        self.assertEqual(result.minimum, 95000)
        self.assertEqual(result.maximum, 165000)
        self.assertEqual(result.midpoint, 130000)

    def test_per_square_meter_project_requires_and_uses_scope(self):
        result = calculate_estimate(CATALOG, "proj-extension", 35)
        self.assertEqual(result.minimum, 630000)
        self.assertEqual(result.maximum, 910000)
        self.assertEqual(result.midpoint, 770000)

    def test_structured_fields_take_precedence_over_display_unit(self):
        catalog = [{
            "id": "roof",
            "service": "Nyt tag",
            "estimate_model": "per_square_meter",
            "estimate_min_dkk": 1400,
            "estimate_max_dkk": 2400,
            "unit": "display only",
        }]
        result = calculate_estimate(catalog, "roof", 100)
        self.assertEqual((result.minimum, result.maximum), (140000, 240000))

    def test_unknown_scope_and_out_of_catalog_work_fail_closed(self):
        with self.assertRaises(EstimateError):
            calculate_estimate(CATALOG, "proj-extension", None)
        with self.assertRaises(EstimateError):
            calculate_estimate(CATALOG, "proj-extension", -2)
        with self.assertRaises(EstimateError):
            calculate_estimate(CATALOG, "not-configured", 10)


if __name__ == "__main__":
    unittest.main()
