'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { Mic, MicOff, Phone, PhoneOff } from 'lucide-react';
import { useAudioBands, peakOf } from '@/lib/audio/useAudioBands';
import { Badge } from '@/components/ui/core';
import { buttonClass } from '@/components/ui/form';
import { Spinner } from '@/components/ui/SubmitButton';

type Stage = 'idle' | 'requesting' | 'connecting' | 'waiting_for_agent' | 'live' | 'ended' | 'error';
const AGENT_TIMEOUT_MS = 30_000;

interface CallPanelProps {
  tenantId: string;
  tenantSlug: string;
  contactId: string;
  contactName: string;
  isDanish: boolean;
}

/** Compact, real LiveKit call control. It never simulates a connected agent. */
export function CallPanel({ tenantId, contactId, contactName, isDanish }: CallPanelProps) {
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
  const t = (da: string, en: string) => isDanish ? da : en;

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
    const id = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [stage]);

  const hangUp = useCallback(() => { cleanupCall(); setStage('ended'); }, [cleanupCall]);

  async function startCall() {
    if (stage === 'requesting' || stage === 'connecting' || stage === 'waiting_for_agent' || stage === 'live') return;
    setError(null);
    setStage('requesting');
    setSeconds(0);
    intentionalDisconnectRef.current = false;
    attemptIdRef.current = null;
    let agentAudioResolved = false;

    try {
      const response = await fetch('/api/livekit/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, contactId, role: 'customer' }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token || !data.serverUrl) throw new Error(data.error ?? t('Kunne ikke starte opkaldet.', 'Could not start the call.'));
      attemptIdRef.current = data.attemptId ?? null;
      setStage('connecting');
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      let resolveAgentAudio: ((element: HTMLAudioElement | null) => void) | null = null;
      const agentAudio = new Promise<HTMLAudioElement | null>((resolve) => { resolveAgentAudio = resolve; });

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        const element = track.attach();
        element.autoplay = true;
        element.style.display = 'none';
        document.body.appendChild(element);
        audioRef.current = element;
        const media = track.mediaStreamTrack;
        if (media) setAgentStream(new MediaStream([media]));
        agentAudioResolved = true;
        resolveAgentAudio?.(element);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((element) => element.remove());
        if (audioRef.current && !audioRef.current.isConnected) audioRef.current = null;
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => setAgentSpeaking(speakers.some((participant) => !participant.isLocal)));
      room.on(RoomEvent.Disconnected, () => {
        if (intentionalDisconnectRef.current) return;
        cleanupCall();
        setStage('ended');
      });

      await room.connect(data.serverUrl, data.token);
      if (!roomRef.current) throw new Error(t('Opkaldet blev afbrudt.', 'The call was cancelled.'));
      await room.startAudio();
      await room.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      if (!agentAudioResolved) setStage('waiting_for_agent');

      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<null>((resolve) => { timeoutId = setTimeout(() => resolve(null), AGENT_TIMEOUT_MS); });
      const audioElement = await Promise.race([agentAudio, timeout]);
      if (timeoutId) clearTimeout(timeoutId);
      if (!audioElement || !roomRef.current) throw new Error(t('Receptionisten svarede ikke. Prøv igen om et øjeblik.', 'The receptionist did not answer. Please try again shortly.'));
      await audioElement.play();
      setStage('live');
    } catch (reason) {
      if (attemptIdRef.current) {
        void fetch('/api/livekit/abandon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attemptId: attemptIdRef.current }), keepalive: true }).catch(() => undefined);
      }
      cleanupCall();
      setStage('error');
      setError(reason instanceof Error ? reason.message : t('Opkaldet fejlede.', 'The call failed.'));
    }
  }

  async function toggleMute() {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    try { await room.localParticipant.setMicrophoneEnabled(!next); setMuted(next); }
    catch { setError(t('Mikrofonen kunne ikke ændres.', 'The microphone could not be changed.')); }
  }

  const timer = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const isLive = stage === 'live';
  const isConnecting = stage === 'connecting' || stage === 'requesting' || stage === 'waiting_for_agent';
  const status = isLive ? t('Forbundet', 'Connected') : isConnecting ? (stage === 'waiting_for_agent' ? t('Venter på receptionisten…', 'Waiting for the receptionist…') : t('Forbinder…', 'Connecting…')) : stage === 'ended' ? t('Afsluttet', 'Ended') : stage === 'error' ? t('Fejl', 'Error') : t('Klar til opkald', 'Ready to call');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`call-btn ${isLive ? 'active' : isConnecting ? 'dialing' : ''}`} aria-hidden>{isLive ? <PhoneOff size={22} /> : <Phone size={22} />}</span>
          <div className="min-w-0"><p className="truncate text-[14px] font-semibold tracking-[-0.02em]">{contactName}</p><p className="mt-0.5 text-[12px] text-[var(--muted)]" role="status" aria-live="polite">{status}</p></div>
        </div>
        {isLive ? <div className="flex items-center gap-2"><span className="mr-1 text-[18px] font-medium tabular-nums tracking-[-0.03em]">{timer}</span><button type="button" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? t('Slå mikrofon til', 'Unmute microphone') : t('Slå mikrofon fra', 'Mute microphone')} className={buttonClass(muted ? 'danger' : 'secondary', 'sm', 'icon-button')}>{muted ? <MicOff size={15} /> : <Mic size={15} />}</button><button type="button" onClick={hangUp} className={buttonClass('danger', 'sm')}><PhoneOff size={14} />{t('Læg på', 'Hang up')}</button></div> : isConnecting ? <Badge tone="warning"><Spinner className="h-3 w-3" />{t('Forbinder', 'Connecting')}</Badge> : <button type="button" onClick={startCall} className={buttonClass('primary')}><Phone size={15} />{stage === 'idle' ? t('Start opkald', 'Start call') : t('Ring igen', 'Call again')}</button>}
      </div>
      {isLive ? <div className="border-t border-[var(--line)] pt-3"><div className={peak > 0.05 ? 'wave on' : 'wave'} aria-hidden>{bands.map((level, index) => <i key={index} style={{ transform: `scaleY(${Math.max(0.08, 0.08 + level * 0.92).toFixed(3)})`, transition: 'transform 90ms linear, opacity 200ms ease', opacity: 0.35 + level * 0.65 }} />)}</div><p className="text-center text-[12px] text-[var(--muted)]">{agentSpeaking ? <span className="text-[var(--accent-primary)]">{t('Receptionisten taler', 'Receptionist is speaking')}</span> : t('Lytter efter dit svar…', 'Listening for your reply…')}</p></div> : null}
      {error ? <div className="notice notice-danger" role="alert">{error}</div> : null}
    </div>
  );
}
