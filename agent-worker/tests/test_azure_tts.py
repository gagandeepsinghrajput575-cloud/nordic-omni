from __future__ import annotations

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agents.azure_tts import escape_ssml_text, detect_utterance_language  # noqa: E402


class AzureTtsTests(unittest.TestCase):
    def test_company_ampersand_cannot_break_ssml(self):
        self.assertEqual(
            escape_ssml_text("Dansk Byg & Renovering <ApS>"),
            "Dansk Byg &amp; Renovering &lt;ApS&gt;",
        )

    def test_plain_danish_text_is_unchanged(self):
        text = "Et vejledende overslag på 95.000 kroner."
        self.assertEqual(escape_ssml_text(text), text)

    def test_detect_utterance_language(self):
        # Danish with special characters
        self.assertEqual(detect_utterance_language("Hej, vi vil meget gerne hjælpe med dit badeværelse"), "da-DK")
        self.assertEqual(detect_utterance_language("Vi har åbent fra 7 til 16 på hverdage"), "da-DK")

        # English
        self.assertEqual(detect_utterance_language("Hello, how can I help you with your renovation project?"), "en-US")
        self.assertEqual(detect_utterance_language("Thank you, our team will call you back shortly"), "en-US")

        # Fallback to default
        self.assertEqual(detect_utterance_language("", "da-DK"), "da-DK")


if __name__ == "__main__":
    unittest.main()
