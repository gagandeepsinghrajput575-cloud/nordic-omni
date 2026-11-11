'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { Phone, PhoneOff, Mic, MicOff, Sparkles, Volume2, Radio } from 'lucide-react';
import { useAudioBands, peakOf } from '@/lib/audio/useAudioBands';

type Stage = 'idle' | 'requesting' | 'connecting' | 'waiting_for_agent' | 'live' | 'ended' | 'error';
const AGENT_TIMEOUT_MS = 30_000;

interface CallPanelProps {
  tenantId: string;
  tenantSlug: string;
  contactId: string;
  contactName: string;
  isDanish: boolean;
}

export function CallPanel({
  tenantId,
  contactId,
  contactName,
  isDanish,
}: CallPanelProps) {
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [agentStream, setAgentStream] = useState<MediaStream | null>(null);

  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const intentionalDisconnectRef = useRef(false);
  const attemptIdRef = useRef<string | null>(null);

  const bands = useAudioBands(agentStream, 24);
  const peak = peakOf(bands);

  const cleanupCall = useCallback(() => {
    intentionalDisconnectRef.current = true;
    roomRef.current?.disconnect();
    roomRef.current = null;
    audioRef.current?.remove();
    audioRef.current = null;
    setAgentStream(null);
    setAgentSpeaking(false);
    setMuted(false);
  }, []);

  useEffect(() => () => cleanupCall(), [cleanupCall]);

  useEffect(() => {
    if (stage !== 'live') return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [stage]);

  const hangUp = useCallback(() => {
    cleanupCall();
    setStage('ended');
  }, [cleanupCall]);

  async function startCall() {
    setError(null);
    setStage('requesting');
    setSeconds(0);
    intentionalDisconnectRef.current = false;
    attemptIdRef.current = null;

    try {
      const res = await fetch('/api/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, contactId, role: 'customer' }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token || !data.serverUrl) {
        throw new Error(data.error ?? 'Could not get a call token');
      }

      attemptIdRef.current = data.attemptId ?? null;
      setStage('connecting');
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      let resolveAgentAudio: ((element: HTMLAudioElement | null) => void) | null = null;
      const agentAudio = new Promise<HTMLAudioElement | null>((resolve) => {
        resolveAgentAudio = resolve;
      });

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.autoplay = true;
        el.style.display = 'none';
        document.body.appendChild(el);
        audioRef.current = el;
        const media = track.mediaStreamTrack;
        if (media) setAgentStream(new MediaStream([media]));
        resolveAgentAudio?.(el);
      });

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove());
        if (audioRef.current && !audioRef.current.isConnected) audioRef.current = null;
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        setAgentSpeaking(speakers.some((p) => !p.isLocal));
      });

      room.on(RoomEvent.Disconnected, () => {
        if (intentionalDisconnectRef.current) return;
        cleanupCall();
        setStage('ended');
      });

      await room.connect(data.serverUrl, data.token);
      await room.startAudio();
      await room.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      if (!agentStream) setStage('waiting_for_agent');

      let timeoutId: NodeJS.Timeout | null = null;
      const timeout = new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), AGENT_TIMEOUT_MS);
      });
      const audioElement = await Promise.race([agentAudio, timeout]);
      if (timeoutId) clearTimeout(timeoutId);
      if (!audioElement || !roomRef.current) {
        throw new Error(
          isDanish
            ? 'Receptionisten svarede ikke. Prøv igen om et øjeblik.'
            : 'The receptionist did not answer. Please try again shortly.',
        );
      }
      await audioElement.play();
      setStage('live');
    } catch (err) {
      if (attemptIdRef.current) {
        void fetch('/api/livekit/abandon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attemptId: attemptIdRef.current }),
          keepalive: true,
        }).catch(() => undefined);
      }
      cleanupCall();
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

  const isLive = stage === 'live';
  const isConnecting = stage === 'connecting' || stage === 'requesting' || stage === 'waiting_for_agent';

  return (
    <div className={`glass relative overflow-hidden p-6 transition-colors duration-200 ${isLive ? 'border-[var(--success)]/40' : ''}`}>
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          {/* Pulse Call Button with Outer Ripples */}
          <div className="call-wrap">
            {isLive && (
              <>
                <span className="ring" />
                <span className="ring r2" />
              </>
            )}
            <button
              type="button"
              onClick={isLive ? hangUp : isConnecting ? undefined : startCall}
              disabled={isConnecting}
              className={`call-btn ${isConnecting ? 'dialing' : isLive ? 'active' : ''}`}
              title={isLive ? 'Hang up' : 'Start call'}
            >
              {isLive ? (
                <PhoneOff size={26} strokeWidth={2.4} />
              ) : (
                <Phone size={26} strokeWidth={2.4} />
              )}
            </button>
          </div>

          <div className="flex flex-col">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
              {isLive
                ? (isDanish ? 'Opkald i gang' : 'Call in progress')
                : isConnecting
                ? (isDanish ? 'Forbinder' : 'Connecting')
                : (isDanish ? 'AI-reception' : 'AI reception')}
            </span>
            <div className="mt-1 text-[15px] font-semibold text-[var(--text)]">
              {contactName}
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--muted)]">
              {isDanish ? 'Browseropkald · direkte lyd' : 'Browser call · live audio'}
            </div>
          </div>
        </div>

        {/* Timer & Live Controls */}
        <div className="flex items-center gap-4">
          {isLive && (
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end">
                <span className="font-mono text-[22px] font-medium tabular-nums tracking-[-0.03em] text-[var(--text)]">
                  {timer}
                </span>
                <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--success)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
                  {isDanish ? 'Forbundet' : 'Connected'}
                </span>
              </div>

              <button
                type="button"
                onClick={toggleMute}
                className={`btn sm ${muted ? 'danger' : ''}`}
              >
                {muted ? <MicOff size={14} /> : <Mic size={14} />}
                {muted ? (isDanish ? 'Slå lyd til' : 'Unmute') : 'Mute'}
              </button>

              <button
                type="button"
                onClick={hangUp}
                className="btn sm danger"
              >
                <PhoneOff size={14} />
                {isDanish ? 'Læg på' : 'Hang up'}
              </button>
            </div>
          )}

          {!isLive && !isConnecting && (
            <button
              type="button"
              onClick={startCall}
              className="btn primary"
            >
              <Phone size={15} />
              {stage === 'idle'
                ? isDanish
                  ? 'Start opkald'
                  : 'Start call'
                : isDanish
                  ? 'Ring igen'
                  : 'Call again'}
            </button>
          )}

          {isConnecting && (
            <div className="flex items-center gap-2 rounded-[10px] border border-[var(--warning)]/30 bg-[var(--warning)]/5 px-4 py-2 font-mono text-[11px] text-[var(--warning)]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--warning)]" />
              {stage === 'waiting_for_agent'
                ? (isDanish ? 'Venter på receptionisten…' : 'Waiting for receptionist…')
                : stage === 'requesting'
                  ? (isDanish ? 'Starter sikkert opkald…' : 'Starting secure call…')
                  : (isDanish ? 'Forbinder WebRTC…' : 'Connecting WebRTC…')}
            </div>
          )}
        </div>
      </div>

      {/* Real 24-band equaliser, driven by the agent's actual voice. */}
      {isLive && (
        <div className="relative z-10 mt-5 border-t border-[var(--line)] pt-4">
          <div className={peak > 0.05 ? 'wave on' : 'wave'}>
            {bands.map((level, i) => (
              <i
                key={i}
                style={{
                  transform: `scaleY(${Math.max(0.08, 0.08 + level * 0.92).toFixed(3)})`,
                  transition: 'transform 90ms linear, opacity 200ms ease',
                  opacity: 0.35 + level * 0.65,
                }}
              />
            ))}
          </div>

          <div className="mt-2 text-center text-[12px] font-medium text-[var(--muted)]">
            {agentSpeaking ? (
              <span className="text-[var(--accent-primary)]">
                {isDanish ? 'Receptionisten taler' : 'Receptionist is speaking'}
              </span>
            ) : (
              <span>{isDanish ? 'Lytter efter dit svar…' : 'Listening for your reply…'}</span>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="relative z-10 mt-4 rounded-xl border border-[var(--bad)]/40 bg-[var(--bad)]/10 p-3 text-xs text-[#fca5a5]">
          {error}
        </div>
      )}
    </div>
  );
}
