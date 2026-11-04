"""Tests for the recording pipeline.

The rule being tested is not "does it record" — it's **"does failure become
visible"**. The previous recorder in this repo threw on every call and nothing
reported it, so `preserve()` must always return an explicit status.

No network, no LiveKit, no database: a temp directory stands in for the job's
session directory.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.recordings import (  # noqa: E402
    MIN_VALID_BYTES,
    history_to_turns,
    preserve,
)

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}{(' — ' + detail) if detail else ''}")
        FAILURES.append(name)


class FakeHistory:
    class Item:
        def __init__(self, role, content):
            self.role = role
            self.content = content

    def __init__(self, items):
        self.items = items


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        os.environ["RECORDINGS_DIR"] = str(root / "library")

        print("=== missing file must be reported, not ignored ===")
        empty_dir = root / "job-empty"
        empty_dir.mkdir()
        # Speed the retry loop up: no file is ever going to appear here.
        import services.recordings as rec

        original_attempts, original_wait = rec.WAIT_ATTEMPTS, rec.WAIT_SECONDS
        rec.WAIT_ATTEMPTS, rec.WAIT_SECONDS = 1, 0.0
        try:
            result = preserve(source_dir=empty_dir, tenant_slug="kbh-vvs", room_name="call-1")
            check("status is failed", result["status"] == "failed", str(result))
            check("error names the missing file", "not found" in (result.get("error") or ""))
            check("no path returned", result.get("path") is None)

            print("\n=== a file below the size floor is not a recording ===")
            small = root / "job-small"
            small.mkdir()
            (small / "audio.ogg").write_bytes(b"OggS" + b"\x00" * 100)
            result = preserve(source_dir=small, tenant_slug="kbh-vvs", room_name="call-2")
            check("status is failed", result["status"] == "failed", str(result))
            check("error mentions the size floor", str(MIN_VALID_BYTES) in (result.get("error") or ""))
        finally:
            rec.WAIT_ATTEMPTS, rec.WAIT_SECONDS = original_attempts, original_wait

        print("\n=== a real file is copied and its size verified ===")
        good = root / "job-good"
        good.mkdir()
        payload = b"OggS" + os.urandom(MIN_VALID_BYTES + 4096)
        (good / "audio.ogg").write_bytes(payload)

        result = preserve(source_dir=good, tenant_slug="kbh-vvs", room_name="call-3")
        check("status is ok", result["status"] == "ok", str(result))
        check("no error", result.get("error") is None)
        check("byte count matches", result.get("bytes") == len(payload), str(result.get("bytes")))

        copied = Path(result["path"])
        check("file exists on disk", copied.exists())
        check("contents identical", copied.read_bytes() == payload)
        check("stored under the tenant slug", "kbh-vvs" in str(copied))
        check("stored under the recordings root", str(copied).startswith(str(root / "library")))

        print("\n=== unsafe names cannot escape the root ===")
        result = preserve(
            source_dir=good,
            tenant_slug="../../etc",
            room_name="../../passwd",
        )
        check("status is ok", result["status"] == "ok", str(result))
        stored = Path(result["path"]).resolve()
        check(
            "path stays inside the recordings root",
            str(stored).startswith(str((root / "library").resolve())),
            str(stored),
        )
        check("no directory traversal in the name", ".." not in str(stored.relative_to((root / "library").resolve())))

    print("\n=== transcript flattening ===")
    history = FakeHistory(
        [
            FakeHistory.Item("assistant", "Hej, du er kommet til Københavns VVS."),
            FakeHistory.Item("user", "Mit hovedrør er sprunget"),
            FakeHistory.Item("user", "   "),  # blank turns are dropped
            FakeHistory.Item("assistant", [{"text": "Jeg forbinder dig nu."}][0]["text"]),
        ]
    )
    turns = history_to_turns(history)
    check("three usable turns", len(turns) == 3, str(len(turns)))
    check("roles preserved", [t["role"] for t in turns] == ["assistant", "user", "assistant"])
    check("Danish text intact", "hovedrør" in turns[1]["content"])
    check("blank turn dropped", all(t["content"].strip() for t in turns))

    list_content = FakeHistory([FakeHistory.Item("assistant", [{"text": "Første"}, {"text": "del"}])])
    turns = history_to_turns(list_content)
    check("list-shaped content is joined", turns and "Første" in turns[0]["content"], str(turns))

    check("empty history is safe", history_to_turns(FakeHistory([])) == [])
    check("None history is safe", history_to_turns(None) == [])

    print("\n" + "=" * 46)
    if FAILURES:
        print(f"{len(FAILURES)} CHECK(S) FAILED")
        for name in FAILURES:
            print(f"  - {name}")
        return 1

    print("ALL RECORDING CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
