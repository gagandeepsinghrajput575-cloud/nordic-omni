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

    def test_garbage_is_rejected(self):
        self.assertIsNone(normalize_phone(""))
        self.assertIsNone(normalize_phone("not a phone"))
        self.assertIsNone(normalize_phone("123"))


if __name__ == "__main__":
    unittest.main()
