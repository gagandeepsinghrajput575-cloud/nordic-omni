"""Thread-safe, idempotent capacity accounting for LiveKit job lifecycles.

LiveKit's request callback and thread-executor shutdown callbacks can run on
different event loops and threads. An asyncio primitive must not be shared between
those loops, so this small registry uses a threading lock and job IDs instead
of a mutable integer. Releasing the same job twice is deliberately a no-op.
"""

from __future__ import annotations

import threading


class CallSlotRegistry:
    def __init__(self, limit: int) -> None:
        if limit < 1:
            raise ValueError("call slot limit must be at least one")
        self._limit = limit
        self._lock = threading.Lock()
        self._job_ids: set[str] = set()

    @property
    def active_count(self) -> int:
        with self._lock:
            return len(self._job_ids)

    @property
    def limit(self) -> int:
        return self._limit

    def acquire(self, job_id: str) -> bool:
        """Reserve one job exactly once, returning False at capacity."""
        if not job_id:
            raise ValueError("a LiveKit job ID is required")
        with self._lock:
            if job_id in self._job_ids:
                return True
            if len(self._job_ids) >= self._limit:
                return False
            self._job_ids.add(job_id)
            return True

    def release(self, job_id: str) -> bool:
        """Release a job; duplicate/unknown releases do not change capacity."""
        with self._lock:
            if job_id not in self._job_ids:
                return False
            self._job_ids.remove(job_id)
            return True
