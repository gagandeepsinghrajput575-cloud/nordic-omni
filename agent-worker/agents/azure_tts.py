"""Azure TTS with mandatory XML escaping.

The upstream plugin interpolates caller/LLM text directly into SSML. An ampersand
in a perfectly normal Danish company name therefore returns HTTP 400.
"""

from __future__ import annotations

from livekit.agents import tts
from livekit.agents.types import APIConnectOptions, DEFAULT_API_CONNECT_OPTIONS
from livekit.plugins import azure


def escape_ssml_text(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


class SafeAzureTTS(azure.TTS):
    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> tts.ChunkedStream:
        return super().synthesize(escape_ssml_text(text), conn_options=conn_options)
