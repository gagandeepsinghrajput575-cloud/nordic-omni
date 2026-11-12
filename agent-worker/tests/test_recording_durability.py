from __future__ import annotations

import os
import pathlib
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import main as worker_main  # noqa: E402
import services.recordings as recordings  # noqa: E402
from services.db import Database  # noqa: E402


class RecordingDurabilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.source = self.root / "job"
        self.source.mkdir()
        self.audio = self.source / "audio.ogg"
        self.audio.write_bytes(b"OggS" + os.urandom(recordings.MIN_VALID_BYTES + 100))
        self.environment = patch.dict(
            os.environ, {"RECORDINGS_DIR": str(self.root / "library")}, clear=False
        )
        self.environment.start()
        self.old_attempts = recordings.WAIT_ATTEMPTS
        self.old_wait = recordings.WAIT_SECONDS
        recordings.WAIT_ATTEMPTS = 2
        recordings.WAIT_SECONDS = 0.0

    def tearDown(self):
        recordings.WAIT_ATTEMPTS = self.old_attempts
        recordings.WAIT_SECONDS = self.old_wait
        self.environment.stop()
        self.temp.cleanup()

    def test_atomic_success_leaves_no_temporary_files(self):
        result = recordings.preserve(
            source_dir=self.source, tenant_slug="tenant", room_name="room"
        )
        self.assertEqual(result["status"], "ok", result)
        self.assertEqual(pathlib.Path(result["path"]).read_bytes(), self.audio.read_bytes())
        self.assertEqual(list(pathlib.Path(result["path"]).parent.glob("*.tmp")), [])

    def test_growing_file_is_not_published(self):
        stop = threading.Event()

        def grow():
            while not stop.is_set():
                with self.audio.open("ab") as output:
                    output.write(b"x" * 64)
                time.sleep(0.005)

        recordings.WAIT_ATTEMPTS = 3
        recordings.WAIT_SECONDS = 0.01
        writer = threading.Thread(target=grow)
        writer.start()
        try:
            result = recordings.preserve(
                source_dir=self.source, tenant_slug="tenant", room_name="growing"
            )
        finally:
            stop.set()
            writer.join()
        self.assertEqual(result["status"], "failed")
        self.assertIn("stable", result["error"])
        self.assertFalse(list((self.root / "library").rglob("*.ogg")))

    def test_source_mutation_during_copy_cleans_temporary_snapshot(self):
        original_copy = recordings.shutil.copyfileobj

        def copy_then_mutate(source, output, length):
            original_copy(source, output, length)
            with self.audio.open("ab") as changed:
                changed.write(b"late-write")

        with patch.object(recordings.shutil, "copyfileobj", side_effect=copy_then_mutate):
            result = recordings.preserve(
                source_dir=self.source, tenant_slug="tenant", room_name="mutated"
            )
        self.assertEqual(result["status"], "failed")
        self.assertIn("changed during copy", result["error"])
        destination = pathlib.Path(result.get("path") or self.root / "library")
        if destination.exists():
            self.assertEqual(list(destination.rglob("*.tmp")), [])
            self.assertEqual(list(destination.rglob("*.ogg")), [])

    def test_symlinked_tenant_directory_cannot_escape_root(self):
        outside = self.root / "outside"
        outside.mkdir()
        root = self.root / "library"
        root.mkdir()
        (root / "tenant").symlink_to(outside, target_is_directory=True)
        result = recordings.preserve(
            source_dir=self.source, tenant_slug="tenant", room_name="safe"
        )
        self.assertEqual(result["status"], "failed")
        self.assertIn("escapes", result["error"])
        self.assertEqual(list(outside.iterdir()), [])


class FinaliseRecordingTests(unittest.IsolatedAsyncioTestCase):
    class Db:
        def __init__(self):
            self.recording_writes = []

        async def finalise_call(self, **_kwargs):
            return None

        async def persist_transcript_messages(self, **_kwargs):
            return None

        async def set_recording(self, **kwargs):
            self.recording_writes.append(kwargs)

    async def test_disabled_recording_is_explicitly_skipped(self):
        db = self.Db()
        ctx = type("Ctx", (), {})()
        ctx.room = type("Room", (), {"name": "room"})()
        ctx.session_directory = pathlib.Path("/tmp")
        await worker_main.finalise_call(
            ctx=ctx,
            db=db,
            tenant={"id": "tenant", "slug": "tenant"},
            session=None,
            started_at=0,
            should_record=False,
        )
        self.assertEqual(db.recording_writes[0]["status"], "skipped")

    async def test_preserve_exception_is_persisted_as_failed(self):
        db = self.Db()
        ctx = type("Ctx", (), {})()
        ctx.room = type("Room", (), {"name": "room"})()
        ctx.session_directory = pathlib.Path("/tmp")
        with patch.object(worker_main, "preserve", side_effect=OSError("disk unavailable")):
            await worker_main.finalise_call(
                ctx=ctx,
                db=db,
                tenant={"id": "tenant", "slug": "tenant"},
                session=None,
                started_at=0,
                should_record=True,
            )
        self.assertEqual(db.recording_writes[0]["status"], "failed")
        self.assertIn("disk unavailable", db.recording_writes[0]["error"])


class RecordingStateTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_or_incomplete_recording_states_fail_before_sql(self):
        db = Database("postgres://unused")
        with self.assertRaises(ValueError):
            await db.set_recording(
                room_name="room", tenant_id="tenant", status="pending"
            )
        with self.assertRaises(ValueError):
            await db.set_recording(
                room_name="room", tenant_id="tenant", status="ok", path="/tmp/a.ogg"
            )
        with self.assertRaises(ValueError):
            await db.set_recording(
                room_name="room", tenant_id="tenant", status="failed"
            )


if __name__ == "__main__":
    unittest.main()
