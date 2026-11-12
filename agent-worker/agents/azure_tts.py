"""Azure TTS with safe SSML and explicit per-call stream/socket ownership."""

from __future__ import annotations

import asyncio
import weakref
from typing import Any

import aiohttp
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
    """Own Azure HTTP resources instead of leaking them through job context.

    LiveKit cancels each ChunkedStream on barge-in. The weak set is a final
    shutdown guard only; streams are not closed between normal conversation
    turns, so the per-call connection pool remains warm.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._owns_session = False
        self._closed = False
        self._close_lock = asyncio.Lock()
        self._live_streams: weakref.WeakSet[tts.ChunkedStream] = weakref.WeakSet()

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> tts.ChunkedStream:
        if self._closed:
            raise RuntimeError("Azure TTS is closed")
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
