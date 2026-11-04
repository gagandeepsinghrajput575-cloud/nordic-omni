"""Call recording: verify, preserve, and record the outcome.

Why this module exists
----------------------
`AgentSession.start(record=...)` writes `audio.ogg` into the job's session
directory. That directory is the agents CLI's per-job temp folder, so it is not
storage — it disappears.

The previous implementation of recording in this repo was fake: it handed a
Supabase service-role JWT to LiveKit as both the S3 access key and the secret,
so every attempt raised and nothing ever said so. The lesson is not "use S3
properly", it is **failure must be visible**. So every path below ends in an
explicit status written to `call_logs`:

    ok       file verified and copied
    failed   something went wrong, and `recording_error` says what
    skipped  recording was switched off for this call

NULL means it was never attempted, which is a different thing again.
"""

from __future__ import annotations

import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("omni.recordings")

# A real conversation is never this small. An empty or header-only Ogg file is
# usually a few hundred bytes, so anything under 2 KB is treated as a failure
# rather than a recording.
MIN_VALID_BYTES = 2048

# The recorder task flushes on session close; give it a moment before declaring
# the file missing.
WAIT_ATTEMPTS = 10
WAIT_SECONDS = 0.5


def recordings_root() -> Path:
    """Where recordings live permanently. Local disk, by design."""
    root = os.environ.get("RECORDINGS_DIR")
    base = Path(root) if root else Path.home() / "nordic-omni-recordings"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _wait_for(path: Path) -> bool:
    import time

    for _ in range(WAIT_ATTEMPTS):
        if path.exists() and path.stat().st_size > 0:
            return True
        time.sleep(WAIT_SECONDS)
    return path.exists()


def _safe_component(value: str) -> str:
    """Room names and slugs become directory names, so strip anything unsafe."""
    cleaned = "".join(c if c.isalnum() or c in "-_" else "-" for c in value)
    return cleaned.strip("-")[:80] or "unknown"


def preserve(
    *,
    source_dir: Path,
    tenant_slug: str,
    room_name: str,
) -> dict[str, Any]:
    """Copy the session recording somewhere permanent and prove it arrived.

    Returns a dict shaped for `Database.set_recording`.
    """
    src = Path(source_dir) / "audio.ogg"

    if not _wait_for(src):
        logger.error("Recording file never appeared: %s", src)
        return {
            "status": "failed",
            "error": f"audio.ogg not found in session directory ({src})",
        }

    try:
        size = src.stat().st_size
    except OSError as exc:  # pragma: no cover - filesystem race
        return {"status": "failed", "error": f"could not stat recording: {exc}"}

    if size < MIN_VALID_BYTES:
        logger.error("Recording too small to be real audio: %s bytes", size)
        return {
            "status": "failed",
            "error": f"file is only {size} bytes, below the {MIN_VALID_BYTES}-byte floor",
        }

    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    dest_dir = recordings_root() / _safe_component(tenant_slug) / day
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{_safe_component(room_name)}.ogg"

    try:
        shutil.copy2(src, dest)
    except OSError as exc:
        logger.exception("Could not copy recording to %s", dest)
        return {"status": "failed", "error": f"copy failed: {exc}"}

    copied = dest.stat().st_size
    if copied != size:
        return {
            "status": "failed",
            "error": f"size mismatch after copy: {size} -> {copied} bytes",
        }

    logger.info("Recording saved: %s (%s bytes)", dest, copied)
    return {
        "status": "ok",
        "path": str(dest),
        "bytes": copied,
        "error": None,
    }


def _content_to_text(content: Any) -> str:
    """ChatMessage.content is either a string or a list of content parts.

    Parts arrive as objects with `.text` in livekit-agents, but dicts appear in
    serialised histories, so both are handled rather than assuming one shape.
    """
    if isinstance(content, str):
        return content.strip()

    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
                continue
            text = getattr(part, "text", None)
            if text is None and isinstance(part, dict):
                text = part.get("text")
            if text:
                parts.append(str(text))
        return " ".join(parts).strip()

    return ""


def history_to_turns(history: Any) -> list[dict[str, str]]:
    """Flatten a ChatContext into [{role, content, at}] for `transcript_full`.

    Written locally so we never upload a caller's conversation to a third party
    just to read it back. This is what the portal shows as "Samtale", and it is
    what you paste into a reviewer to check the Danish.
    """
    turns: list[dict[str, str]] = []

    for item in getattr(history, "items", []) or []:
        role = getattr(item, "role", None) or "unknown"
        text = _content_to_text(getattr(item, "content", ""))
        if not text:
            continue
        turns.append({"role": str(role), "content": text})

    return turns


def duration_seconds(started_at: Optional[float]) -> int:
    if not started_at:
        return 0
    import time

    return max(0, int(time.time() - started_at))

