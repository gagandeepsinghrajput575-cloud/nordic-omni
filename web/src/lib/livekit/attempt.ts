const abandonedAttemptIds = new Set<string>();

/**
 * Best-effort, idempotent recovery for attempts that never reached an agent.
 * Mark the ID before fetching so catch/pagehide/unmount races cannot double-fire.
 */
export function abandonCallAttempt(
  attemptId: string | null,
  reachedAgent = false,
): boolean {
  if (!attemptId || reachedAgent || abandonedAttemptIds.has(attemptId)) return false;
  abandonedAttemptIds.add(attemptId);
  void fetch('/api/livekit/abandon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attemptId }),
    keepalive: true,
  }).catch(() => undefined);
  return true;
}

/** Rebuild from all remaining remote audio tracks, never a stale single track. */
export function combineAudioTracks(
  tracks: Iterable<MediaStreamTrack | null | undefined>,
): MediaStream | null {
  const active = Array.from(tracks).filter(
    (track): track is MediaStreamTrack => track !== null && track !== undefined,
  );
  return active.length > 0 ? new MediaStream(active) : null;
}

/** Removing an element alone does not reliably stop WebRTC audio playback. */
export function disposeAudioElement(element: HTMLAudioElement): void {
  element.pause();
  element.srcObject = null;
  element.remove();
}
