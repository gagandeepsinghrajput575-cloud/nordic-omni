from __future__ import annotations

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agents.azure_tts import escape_ssml_text  # noqa: E402


class AzureTtsTests(unittest.TestCase):
    def test_company_ampersand_cannot_break_ssml(self):
        self.assertEqual(
            escape_ssml_text("Dansk Byg & Renovering <ApS>"),
            "Dansk Byg &amp; Renovering &lt;ApS&gt;",
        )

    def test_plain_danish_text_is_unchanged(self):
        text = "Et vejledende overslag på 95.000 kroner."
        self.assertEqual(escape_ssml_text(text), text)


if __name__ == "__main__":
    unittest.main()
