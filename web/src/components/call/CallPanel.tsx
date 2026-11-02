'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';

type Stage = 'idle' | 'requesting' | 'connecting' | 'live' | 'ended' | 'error';

interface CallPanelProps {
  tenantId: string;
  tenantSlug: string;
  contactId: string;
  contactName: string;
  isDanish: boolean;
}

export function CallPanel({
  tenantId,
  tenantSlug,
  contactId,
  contactName,
  isDanish,
}: CallPanelProps) {
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [agentSpeaking, setAgentSpeaking] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
      roomRef.current = null;
      audioRef.current?.remove();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (stage !== 'live') return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [stage]);

  const hangUp = useCallback(() => {
    roomRef.current?.disconnect();
    roomRef.current = null;
    audioRef.current?.remove();
    audioRef.current = null;
    setStage('ended');
    setAgentSpeaking(false);
  }, []);

  async function startCall() {
    setError(null);
    setStage('requesting');
    setSeconds(0);

    // Must match the room naming the worker and seed data expect.
    const roomName = `${tenantSlug}_call_${contactId}`;

    try {
      const res = await fetch('/api/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          roomName,
          participantIdentity: `customer_${contactId}`,
          participantName: contactName,
          role: 'customer',
          contactId,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) {
        throw new Error(data.error ?? 'Could not get a call token');
      }

      setStage('connecting');

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.autoplay = true;
        el.style.display = 'none';
        document.body.appendChild(el);
        audioRef.current = el;
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        setAgentSpeaking(speakers.some((p) => !p.isLocal));
      });

      room.on(RoomEvent.Disconnected, () => {
        setStage((prev) => (prev === 'live' ? 'ended' : prev));
      });

      await room.connect(data.serverUrl, data.token);
      await room.localParticipant.setMicrophoneEnabled(true);

      setStage('live');
    } catch (err) {
      setStage('error');
      setError(err instanceof Error ? err.message : 'Call failed');
    }
  }

  async function toggleMute() {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }

  const timer = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(
    seconds % 60
  ).padStart(2, '0')}`;

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)]">
            {isDanish ? 'Test din AI-receptionist' : 'Test your AI receptionist'}
          </h2>
          <p className="mt-1 text-sm font-medium">
            {isDanish ? `Ring op som ${contactName}` : `Call in as ${contactName}`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {stage === 'live' && (
            <>
              <span className="flex items-center gap-2 font-mono text-xs tabular-nums text-[var(--success)]">
                <span className="h-2 w-2 rounded-full bg-[var(--success)] animate-pulse" />
                {timer}
              </span>
              <button
                onClick={toggleMute}
                className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
              >
                {muted ? (isDanish ? 'Slå lyd til' : 'Unmute') : 'Mute'}
              </button>
              <button
                onClick={hangUp}
                className="rounded-lg bg-[var(--danger)] px-4 py-2 text-xs font-semibold text-white"
              >
                {isDanish ? 'Læg på' : 'Hang up'}
              </button>
            </>
          )}

          {(stage === 'idle' || stage === 'ended' || stage === 'error') && (
            <button
              onClick={startCall}
              className="rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)]"
            >
              {stage === 'idle'
                ? isDanish
                  ? 'Start opkald'
                  : 'Start call'
                : isDanish
                  ? 'Ring igen'
                  : 'Call again'}
            </button>
          )}

          {(stage === 'requesting' || stage === 'connecting') && (
            <span className="font-mono text-xs text-[var(--text-muted)]">
              {stage === 'requesting'
                ? isDanish
                  ? 'Anmoder om mikrofon…'
                  : 'Requesting microphone…'
                : isDanish
                  ? 'Forbinder…'
                  : 'Connecting…'}
            </span>
          )}
        </div>
      </div>

      {stage === 'live' && (
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          {agentSpeaking
            ? isDanish
              ? 'AI-assistenten taler…'
              : 'The AI is speaking…'
            : isDanish
              ? 'Lytter… prøv fx “mit hovedrør er sprunget”.'
              : 'Listening… try “my kitchen pipe just burst”.'}
        </p>
      )}

      {(stage === 'idle' || stage === 'ended') && (
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          {isDanish
            ? 'Opkaldet foregår i browseren via WebRTC. Ingen telefonregning.'
            : 'The call runs in your browser over WebRTC. No phone bill.'}
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

