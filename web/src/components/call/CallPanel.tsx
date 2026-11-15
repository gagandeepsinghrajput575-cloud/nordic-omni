'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { Mic, MicOff, Phone, PhoneOff } from 'lucide-react';
import { useAudioBands, peakOf } from '@/lib/audio/useAudioBands';
import { Waveform, TelephonyBargeInMeter } from '@/components/audio/Waveform';
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
  /**
   * Barge-in, measured rather than asserted.
   *
   * `speechStartRef` is when the *caller* became an active speaker while the agent
   * was still talking; the meter is closed when the agent is observed to have
   * stopped. That interval is the honest number for this path: the browser cannot
   * truncate a provider turn it does not own, so nothing here claims a sub-150 ms
   * commit it did not perform. The report goes to the bridge's control route, which
   * recomputes the verdict against the tenant's budget — the browser measures, it
   * does not grade.
   */
  const speechStartRef = useRef<number | null>(null);
  const reportedRef = useRef(false);
  const [bargeIn, setBargeIn] = useState<{ latencyMs: number; budgetMs: number; source: 'budget' | 'measured' }>({
    latencyMs: 0,
    budgetMs: 150,
    source: 'budget',
  });
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
    // A closed call must not keep a half-open measurement, or the next call starts
    // out reporting the previous caller's interruption.
    speechStartRef.current = null;
    reportedRef.current = false;
    setBargeIn((previous) => ({ latencyMs: 0, budgetMs: previous.budgetMs, source: 'budget' }));
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
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const agent = speakers.some((participant) => !participant.isLocal);
        const caller = speakers.some((participant) => participant.isLocal);
        setAgentSpeaking(agent);
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (agent && caller && speechStartRef.current === null) {
          speechStartRef.current = now;
          reportedRef.current = false;
        }
        if (speechStartRef.current !== null && !agent) {
          const latencyMs = Math.max(0, Math.round(now - speechStartRef.current));
          speechStartRef.current = null;
          setBargeIn((previous) => ({ ...previous, latencyMs, source: 'measured' }));
          if (!reportedRef.current) {
            reportedRef.current = true;
            // Fire-and-forget: a failed telemetry write must never end a call.
            void fetch('/api/telephony/session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'barge_in', callId: attemptIdRef.current, tenantId, latencyMs, path: 'sustained' }),
              keepalive: true,
            }).catch(() => undefined);
          }
        }
      });
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
      {isLive ? <div className="studio-surface border-t border-[var(--line)] px-4 py-3"><Waveform active bars={40} className="h-8" levels={bands} tone={agentSpeaking ? 'accent' : 'muted'} />
          <div className="mt-2 flex justify-center">
            <TelephonyBargeInMeter
              latencyMs={bargeIn.latencyMs}
              budgetMs={bargeIn.budgetMs}
              source={bargeIn.source}
              commits={bargeIn.source === 'measured' ? 1 : 0}
              overBudgetCommits={0}
            />
          </div>
          <p className="mt-2 text-center text-[12px] text-[var(--text-muted)]" role="status">{peak > 0.05 && agentSpeaking ? <span className="text-[var(--accent-primary)]">{t('Receptionisten taler', 'Receptionist is speaking')}</span> : t('Lytter efter dit svar…', 'Listening for your reply…')}</p></div> : null}
      {error ? <div className="notice notice-danger" role="alert">{error}</div> : null}
    </div>
  );
}
