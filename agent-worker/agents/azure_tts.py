"""Azure TTS with safe SSML, automatic Danish/English voice switching, and explicit socket ownership."""

from __future__ import annotations

import asyncio
import re
import weakref
from typing import Any

import aiohttp
from livekit.agents import tts
from livekit.agents.types import APIConnectOptions, DEFAULT_API_CONNECT_OPTIONS
from livekit.plugins import azure


_DANISH_CHARS = re.compile(r"[æøåÆØÅ]")
_DANISH_WORDS = re.compile(
    r"\b(hej|goddag|tak|gerne|ikke|også|hvordan|hvad|kan|jeg|vi|du|jer|jeres|det|den|er|har|vil|skal|på|med|til|fra|eller|moms|overslag|besigtigelse|opkald|optaget|kroner)\b",
    re.IGNORECASE,
)
_ENGLISH_WORDS = re.compile(
    r"\b(hello|hi|thanks|thank|please|how|what|can|would|should|could|the|and|with|from|your|our|you|we|this|that|estimate|inspection|recorded|call|help|price|quote|hours|open|closed|english)\b",
    re.IGNORECASE,
)


def escape_ssml_text(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def detect_utterance_language(text: str, default_language: str = "da-DK") -> str:
    """Detect whether an outbound utterance is Danish or English for native voice switching."""
    if not text or not text.strip():
        return default_language
    if _DANISH_CHARS.search(text):
        return "da-DK"
    da_hits = len(_DANISH_WORDS.findall(text))
    en_hits = len(_ENGLISH_WORDS.findall(text))
    if en_hits > da_hits and en_hits >= 2:
        return "en-US"
    if da_hits > en_hits:
        return "da-DK"
    return default_language


class SafeAzureTTS(azure.TTS):
    """Own Azure HTTP resources and seamlessly switch Danish/English neural voices mid-call.

    LiveKit cancels each ChunkedStream on barge-in. The weak set is a final
    shutdown guard only; streams are not closed between normal conversation
    turns, so the per-call connection pool remains warm.
    """

    def __init__(
        self,
        *args: Any,
        danish_voice: str = "da-DK-ChristelNeural",
        english_voice: str = "en-US-JennyNeural",
        **kwargs: Any,
    ) -> None:
        super().__init__(*args, **kwargs)
        self._danish_voice = danish_voice
        self._english_voice = english_voice
        self._default_language = str(kwargs.get("language") or "da-DK")
        self._owns_session = False
        self._closed = False
        self._close_lock = asyncio.Lock()
        self._live_streams: weakref.WeakSet[tts.ChunkedStream] = weakref.WeakSet()

    def _apply_voice_for_text(self, text: str) -> None:
        detected = detect_utterance_language(text, self._default_language)
        target_voice = self._danish_voice if detected.startswith("da") else self._english_voice
        target_lang = "da-DK" if detected.startswith("da") else "en-US"
        if hasattr(self, "_opts"):
            self._opts.voice = target_voice
            self._opts.language = target_lang

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> tts.ChunkedStream:
        if self._closed:
            raise RuntimeError("Azure TTS is closed")
        self._apply_voice_for_text(text)
        stream = super().synthesize(escape_ssml_text(text), conn_options=conn_options)
        self._live_streams.add(stream)
        return stream

    def _ensure_session(self) -> aiohttp.ClientSession:
        if self._closed:
            raise RuntimeError("Azure TTS is closed")
        if self._session is not None and not self._session.closed:
            return self._session

        # Four connections are ample for one non-streaming voice session. Fifty
        # calls therefore cannot create an unbounded global aiohttp connector.
        self._session = aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(
                limit=4,
                limit_per_host=4,
                ttl_dns_cache=300,
                enable_cleanup_closed=True,
            ),
            timeout=aiohttp.ClientTimeout(total=35, sock_connect=10, sock_read=30),
        )
        self._owns_session = True
        return self._session

    async def aclose(self) -> None:
        async with self._close_lock:
            if self._closed:
                return
            self._closed = True
            first_error: BaseException | None = None

            for stream in list(self._live_streams):
                try:
                    await stream.aclose()
                except BaseException as exc:  # finish releasing siblings
                    first_error = first_error or exc
            self._live_streams.clear()

            try:
                await super().aclose()
            except BaseException as exc:
                first_error = first_error or exc

            if self._owns_session and self._session is not None:
                try:
                    await self._session.close()
                except BaseException as exc:
                    first_error = first_error or exc
            self._session = None

            if first_error is not None:
                raise first_error
