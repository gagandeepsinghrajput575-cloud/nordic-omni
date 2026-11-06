"""Environment configuration for the voice worker.

Hard-fails on missing values, matching the web app's policy: never degrade
silently into a mode that looks like it works.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


class ConfigError(RuntimeError):
    pass


def _require(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ConfigError(
            f"Missing required environment variable {name}. "
            f"Copy agent-worker/.env.example to agent-worker/.env and fill it in."
        )
    return value


@dataclass(frozen=True)
class Config:
    livekit_url: str
    livekit_api_key: str
    livekit_api_secret: str

    # Owner-level connection. The worker is a trusted backend component, so it
    # uses the owner role and always filters explicitly by tenant_id.
    database_url: str

    # LiveKit Inference model IDs. Included with LiveKit Cloud — no separate
    # provider keys required. Override via env to change provider or voice.
    stt_model: str
    llm_model: str
    tts_model: str
    tts_voice: str

    # Microsoft Azure Speech credentials (optional)
    azure_speech_key: Optional[str] = None
    azure_speech_region: Optional[str] = None


def load() -> Config:
    return Config(
        livekit_url=_require("LIVEKIT_URL"),
        livekit_api_key=_require("LIVEKIT_API_KEY"),
        livekit_api_secret=_require("LIVEKIT_API_SECRET"),
        database_url=_require("DATABASE_URL"),
        stt_model=os.getenv("STT_MODEL", "deepgram/nova-3"),
        llm_model=os.getenv("LLM_MODEL", "google/gemini-2.5-flash"),
        tts_model=os.getenv("TTS_MODEL", "cartesia/sonic-3"),
        # Empty string = let the provider pick a default voice for the language.
        tts_voice=os.getenv("TTS_VOICE", ""),
        azure_speech_key=os.getenv("AZURE_SPEECH_KEY") or None,
        azure_speech_region=os.getenv("AZURE_SPEECH_REGION") or None,
    )
