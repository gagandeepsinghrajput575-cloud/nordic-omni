"""The declarative client file must be validated before it reaches PostgreSQL."""

from __future__ import annotations

import copy
import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from services.client_config import ConfigError, load_client_config, validate_client_config  # noqa: E402


class ClientConfigTests(unittest.TestCase):
    def setUp(self):
        self.path = ROOT.parent / "clients" / "client-01-dansk-byg" / "client.config.json"
        self.raw = json.loads(self.path.read_text())

    def test_pilot_config_is_valid_and_has_structured_estimates(self):
        config = load_client_config(self.path)
        self.assertEqual(config["slug"], "dansk-byg")
        bathroom = next(item for item in config["pricing_catalog"] if item["id"] == "proj-bath")
        self.assertEqual(bathroom["estimate_model"], "fixed")
        self.assertEqual((bathroom["estimate_min_dkk"], bathroom["estimate_max_dkk"]), (95000, 165000))

    def test_duplicate_catalog_ids_and_inverted_ranges_fail_closed(self):
        broken = copy.deepcopy(self.raw)
        broken["pricing_catalog"].append(copy.deepcopy(broken["pricing_catalog"][0]))
        with self.assertRaises(ConfigError):
            validate_client_config(broken)

        broken = copy.deepcopy(self.raw)
        broken["pricing_catalog"][2]["estimate_min_dkk"] = 999999
        with self.assertRaises(ConfigError):
            validate_client_config(broken)

    def test_unsafe_slug_and_missing_owner_are_rejected(self):
        broken = copy.deepcopy(self.raw)
        broken["slug"] = "../../etc"
        with self.assertRaises(ConfigError):
            validate_client_config(broken)
        broken = copy.deepcopy(self.raw)
        broken["owner"] = {}
        with self.assertRaises(ConfigError):
            validate_client_config(broken)


if __name__ == "__main__":
    unittest.main()
