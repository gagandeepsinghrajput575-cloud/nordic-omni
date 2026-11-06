'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { Phone, PhoneOff, Mic, MicOff, Sparkles, Volume2, Radio } from 'lucide-react';
import { motion } from 'framer-motion';

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

  const isLive = stage === 'live';
  const isConnecting = stage === 'connecting' || stage === 'requesting';

  return (
    <div className={`glass relative overflow-hidden p-6 transition-all duration-300 ${isLive ? 'border-[rgba(52,211,153,0.5)] shadow-[0_20px_70px_rgba(52,211,153,0.18)]' : ''}`}>
      {/* Pulse Ambient Glow in Header */}
      <div
        className="pointer-events-none absolute -top-24 -left-10 h-56 w-full opacity-60 transition-opacity duration-500"
        style={{
          background: isLive
            ? 'radial-gradient(ellipse at center, rgba(52, 211, 153, 0.4), transparent 70%)'
            : isConnecting
            ? 'radial-gradient(ellipse at center, rgba(251, 191, 36, 0.35), transparent 70%)'
            : 'radial-gradient(ellipse at center, rgba(139, 92, 246, 0.35), transparent 70%)',
        }}
      />

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
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
              {isLive
                ? (isDanish ? 'Opkald i gang' : 'Call in progress')
                : isConnecting
                ? (isDanish ? 'Forbinder…' : 'Connecting…')
                : (isDanish ? 'WebRTC Test Studio' : 'WebRTC Test Studio')}
            </span>
            <div className="mt-0.5 text-base font-extrabold text-[var(--text)]">
              {contactName}
            </div>
            <div className="text-xs text-[var(--muted)]">
              {isDanish ? 'Live browser-simulator' : 'Live browser audio simulator'}
            </div>
          </div>
        </div>

        {/* Timer & Live Controls */}
        <div className="flex items-center gap-4">
          {isLive && (
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end">
                <span className="font-mono text-2xl font-extrabold tabular-nums text-white">
                  {timer}
                </span>
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-[#34d399]">
                  <span className="h-2 w-2 rounded-full bg-[#34d399] animate-pulse" />
                  {isDanish ? 'Aktiv linje' : 'Active line'}
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
              className="btn primary glow"
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
            <div className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/[0.05] px-4 py-2 font-mono text-xs text-[#fcd34d]">
              <span className="h-2 w-2 rounded-full bg-[#fcd34d] animate-ping" />
              {stage === 'requesting'
                ? (isDanish ? 'Anmoder om mikrofon…' : 'Requesting mic…')
                : (isDanish ? 'Forbinder WebRTC…' : 'Connecting WebRTC…')}
            </div>
          )}
        </div>
      </div>

      {/* Pulse 24-Bar Audio Equalizer Waveform */}
      {isLive && (
        <div className="relative z-10 mt-5 border-t border-[var(--line)] pt-4">
          <div className="wave on">
            {Array.from({ length: 24 }).map((_, i) => (
              <motion.i
                key={i}
                animate={{
                  scaleY: agentSpeaking
                    ? [0.25, 1.0, 0.35, 0.85, 0.25]
                    : [0.15, 0.45, 0.2, 0.4, 0.15],
                }}
                transition={{
                  duration: 1.0 + (i % 5) * 0.15,
                  repeat: Infinity,
                  delay: i * 0.04,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </div>

          <div className="mt-2 text-center text-xs font-medium text-[var(--muted)]">
            {agentSpeaking ? (
              <span className="text-[#22d3ee]">
                {isDanish ? '⚡ AI-receptionisten taler…' : '⚡ AI receptionist is speaking…'}
              </span>
            ) : (
              <span>
                {isDanish
                  ? '🎙️ Lytter til dig… prøv at sige: “Mit vandrør er sprunget akut”.'
                  : '🎙️ Listening to you… say: “My pipe burst in the bathroom”.'}
              </span>
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
