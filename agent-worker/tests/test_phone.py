from __future__ import annotations

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from services.phone import normalize_phone  # noqa: E402


class PhoneTests(unittest.TestCase):
    def test_e164_normalization(self):
        self.assertEqual(normalize_phone("+45 70 20 11 22"), "+4570201122")
        self.assertEqual(normalize_phone("0045 70 20 11 22"), "+4570201122")
        self.assertEqual(normalize_phone("(45) 70-20-11-22"), "+4570201122")

    def test_international_prefix_and_punctuation_have_one_canonical_form(self):
        expected = "+4570201122"
        for value in (
            "0045 70 20 11 22",
            "+45 (70) 20-11-22",
            "45.70.20.11.22",
            "++45 70 20 11 22",
        ):
            self.assertEqual(normalize_phone(value), expected)

    def test_sql_index_uses_the_same_00_and_digits_rules(self):
        root = pathlib.Path(__file__).resolve().parents[2]
        for migration in (
            "0008_sip_inbound_routing.sql",
            "0009_unique_contact_phone.sql",
            "0012_phone_normalization_parity.sql",
        ):
            sql = (root / "db" / "migrations" / migration).read_text()
            self.assertIn("regexp_replace", sql)
            self.assertIn("[^0-9]", sql)
            self.assertIn("LIKE '00%'", sql)
            self.assertIn("substr(", sql)
            self.assertNotIn("[^0-9+]", sql)

    def test_garbage_is_rejected(self):
        self.assertIsNone(normalize_phone(""))
        self.assertIsNone(normalize_phone("not a phone"))
        self.assertIsNone(normalize_phone("123"))


if __name__ == "__main__":
    unittest.main()
