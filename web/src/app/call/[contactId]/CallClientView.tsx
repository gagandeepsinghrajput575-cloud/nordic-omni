'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, MessageSquare, Mic, MicOff, Phone, PhoneOff, ShieldCheck } from 'lucide-react';
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import { OrbVisualizer } from '@/components/audio/OrbVisualizer';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';
import { BrandMark } from '@/components/ui/BrandMark';
import { Badge } from '@/components/ui/core';
import { buttonClass } from '@/components/ui/form';
import { Spinner } from '@/components/ui/SubmitButton';

interface CallClientViewProps {
  contact: { id: string; full_name: string | null; phone_number: string | null; preferred_language: string; shared_memory_summary?: string | null };
  tenant: { id: string; name: string; slug: string; default_language: string; reception_mode?: string; flynumber_did?: string | null };
  compact?: boolean;
}

type CallStage = 'idle' | 'connecting' | 'waiting_for_agent' | 'active' | 'ended' | 'error';
const AGENT_TIMEOUT_MS = 30_000;

export function CallClientView({ contact, tenant, compact = false }: CallClientViewProps) {
  const [stage, setStage] = useState<CallStage>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [agentStream, setAgentStream] = useState<MediaStream | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const roomRef = useRef<Room | null>(null);
  const audioTracksRef = useRef(new Map<RemoteTrack, HTMLAudioElement>());
  const intentionalDisconnectRef = useRef(false);
  const attemptIdRef = useRef<string | null>(null);
  const isDanish = contact.preferred_language ? contact.preferred_language.startsWith('da') : tenant.default_language.startsWith('da');
  const t = (da: string, en: string) => isDanish ? da : en;

  useEffect(() => {
    if (stage === 'active') timerRef.current = setInterval(() => setDuration((value) => value + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; };
  }, [stage]);

  const cleanupCall = useCallback(() => {
    // Invalidate every continuation belonging to the previous attempt.
    runRef.current += 1;
    intentionalDisconnectRef.current = true;
    reachedAgentRef.current = false;
    attemptIdRef.current = null;
    cancelAgentWaitRef.current?.();
    cancelAgentWaitRef.current = null;
    if (agentTimeoutRef.current) clearTimeout(agentTimeoutRef.current);
    agentTimeoutRef.current = null;

    const room = roomRef.current;
    roomRef.current = null;
    audioElementsRef.current.forEach((element) => element.remove());
    audioElementsRef.current = [];
    setAgentStream(null);
    setIsMuted(false);
  }, []);
  useEffect(() => () => cleanupCall(), [cleanupCall]);

  const handleStartCall = async () => {
    if (stage === 'connecting' || stage === 'waiting_for_agent' || stage === 'active') return;
    setErrorMessage('');
    setDuration(0);
    intentionalDisconnectRef.current = false;
    reachedAgentRef.current = false;
    attemptIdRef.current = null;
    let agentAudioResolved = false;
    try {
      setStage('connecting');
      const tokenResponse = await fetch('/api/livekit/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: tenant.id, contactId: contact.id, role: 'customer' }) });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenData.token || !tokenData.serverUrl) throw new Error(tokenData.error ?? t('Kunne ikke starte opkaldet.', 'Could not start the call.'));
      attemptIdRef.current = tokenData.attemptId ?? null;
      if (!isCurrent()) {
        recoverCurrentAttempt();
        return;
      }

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      let resolveAgentAudio: ((element: HTMLAudioElement | null) => void) | null = null;
      const agentAudio = new Promise<HTMLAudioElement | null>((resolve) => { resolveAgentAudio = resolve; });

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return;
        if (!isCurrent()) {
          track.detach().forEach(disposeAudioElement);
          return;
        }
        const previous = audioTracksRef.current.get(track);
        if (previous) disposeAudioElement(previous);
        const audioElement = track.attach();
        audioElement.autoplay = true;
        audioElement.style.display = 'none';
        document.body.appendChild(audioElement);
        audioElementsRef.current.push(audioElement);
        const media = track.mediaStreamTrack;
        if (media) setAgentStream(new MediaStream([media]));
        agentAudioResolved = true;
        resolveAgentAudio?.(audioElement);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((element) => { element.remove(); audioElementsRef.current = audioElementsRef.current.filter((audio) => audio !== element); });
      });
      room.on(RoomEvent.Disconnected, () => {
        if (!isCurrent() || intentionalDisconnectRef.current) return;
        recoverCurrentAttempt();
        cleanupCall();
        setStage('ended');
      });

      await room.connect(tokenData.serverUrl, tokenData.token);
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
      setStage('active');
    } catch (error) {
      if (attemptIdRef.current) {
        void fetch('/api/livekit/abandon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attemptId: attemptIdRef.current }), keepalive: true }).catch(() => undefined);
      }
      cleanupCall();
      setErrorMessage(error instanceof Error ? error.message : t('Opkaldet kunne ikke oprettes.', 'The call could not be established.'));
      setStage('error');
    }
  };

  const handleEndCall = () => { cleanupCall(); setStage('ended'); };
  const toggleMute = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !isMuted;
    try { await room.localParticipant.setMicrophoneEnabled(!next); setIsMuted(next); }
    catch { setErrorMessage(t('Mikrofonen kunne ikke ændres.', 'The microphone could not be changed.')); }
  };
  const formatTimer = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const stageLabel = { idle: t('Klar', 'Ready'), connecting: t('Forbinder', 'Connecting'), waiting_for_agent: t('Venter på receptionisten', 'Waiting for the receptionist'), active: t('Forbundet', 'Connected'), ended: t('Afsluttet', 'Ended'), error: t('Fejl', 'Error') }[stage];
  const stageTone = stage === 'active' ? 'success' : stage === 'error' ? 'danger' : stage === 'connecting' || stage === 'waiting_for_agent' ? 'warning' : 'neutral';

  const callCard = (
    <section className="glass enter flex flex-col overflow-hidden" aria-label={t('Browseropkald', 'Browser call')}>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4"><Badge tone={stageTone} dot>{stageLabel}</Badge><span className="text-[13px] tabular-nums text-[var(--muted)]">{stage === 'active' ? formatTimer(duration) : '00:00'}</span></div>
      <div className="call-stage flex-1 px-6 py-8">
        {stage === 'idle' ? <><span className="call-btn mb-5" aria-hidden><Phone size={24} /></span><h2 className="text-[19px] font-semibold tracking-[-0.03em]">{t('Klar til at tale sammen', 'Ready to talk')}</h2><p className="mt-2 max-w-[290px] text-[13px] leading-6 text-[var(--muted)]">{t('Tryk start, giv mikrofonadgang, og vent på hilsenen.', 'Press start, allow the microphone and wait for the greeting.')}</p></> : null}
        {stage === 'connecting' || stage === 'waiting_for_agent' ? <><OrbVisualizer isActive state="listening" size={132} /><p className="mt-4 flex items-center gap-2 text-[13px] font-medium text-[var(--text-secondary)]" role="status"><Spinner />{stage === 'waiting_for_agent' ? t('Forbundet. Venter på receptionisten…', 'Connected. Waiting for the receptionist…') : t('Forbinder sikkert…', 'Connecting securely…')}</p></> : null}
        {stage === 'active' ? <><OrbVisualizer isActive state={isMuted ? 'idle' : 'speaking'} audioStream={agentStream} size={150} /><p className="mt-3 text-[30px] font-medium tabular-nums tracking-[-0.04em]">{formatTimer(duration)}</p><Badge tone="success" dot>{t('Forbundet med receptionisten', 'Connected to the receptionist')}</Badge></> : null}
        {stage === 'error' ? <><span className="mb-5 flex h-20 w-20 items-center justify-center rounded-full border border-[var(--danger-line)] bg-[var(--danger-soft)] text-[var(--danger)]"><AlertTriangle size={28} strokeWidth={1.7} /></span><h2 className="text-[19px] font-semibold tracking-[-0.03em]">{t('Opkaldet blev ikke oprettet', 'Call not established')}</h2><p className="mt-2 max-w-[300px] text-[13px] leading-6 text-[var(--muted)]" role="alert">{errorMessage}</p></> : null}
        {stage === 'ended' ? <><span className="mb-5 flex h-20 w-20 items-center justify-center rounded-full border border-[var(--success-line)] bg-[var(--success-soft)] text-[var(--success)]"><CheckCircle2 size={28} strokeWidth={1.7} /></span><h2 className="text-[19px] font-semibold tracking-[-0.03em]">{t('Opkaldet er afsluttet', 'Call ended')}</h2><p className="mt-2 max-w-[290px] text-[13px] leading-6 text-[var(--muted)]">{t('Tak for samtalen. Din henvendelse er gemt til opfølgning.', 'Thank you for calling. Your request has been recorded for follow-up.')}</p></> : null}
      </div>
      <div className="border-t border-[var(--line)] p-4">
        {tenant.reception_mode === 'human_forward' ? <div className="notice notice-info flex-col"><p className="text-[13px]">{t('Dette kontor viderestiller opkald til en medarbejder. Ring til hovednummeret.', 'This office forwards calls to a team member. Please call the main number.')}</p>{tenant.flynumber_did ? <a href={`tel:${tenant.flynumber_did}`} className={buttonClass('primary', 'md', 'min-h-12 w-full')}><Phone size={16} />{tenant.flynumber_did}</a> : <p className="text-[12px]">{t('Telefonnummeret er ikke offentliggjort endnu.', 'The phone number is not published yet.')}</p>}</div> : stage === 'idle' || stage === 'error' ? <button type="button" onClick={handleStartCall} className={buttonClass('primary', 'md', 'min-h-12 w-full')}><Phone size={16} />{stage === 'error' ? t('Prøv igen', 'Try again') : t('Start opkald', 'Start call')}</button> : null}
        {stage === 'active' ? <div className="flex items-center gap-3"><button type="button" onClick={toggleMute} aria-pressed={isMuted} aria-label={isMuted ? t('Slå mikrofon til', 'Unmute microphone') : t('Slå mikrofon fra', 'Mute microphone')} className={buttonClass(isMuted ? 'danger' : 'secondary', 'md', 'icon-button h-12 w-12')}>{isMuted ? <MicOff size={18} /> : <Mic size={18} />}</button><button type="button" onClick={handleEndCall} className={buttonClass('danger', 'md', 'min-h-12 flex-1')}><PhoneOff size={16} />{t('Afslut opkald', 'End call')}</button></div> : null}
        {stage === 'ended' ? <button type="button" onClick={() => { setStage('idle'); setDuration(0); setErrorMessage(''); }} className={buttonClass('secondary', 'md', 'min-h-12 w-full')}>{t('Ring igen', 'Call again')}</button> : null}
        {stage === 'connecting' || stage === 'waiting_for_agent' ? <button type="button" onClick={handleEndCall} className={buttonClass('ghost', 'md', 'min-h-12 w-full')}>{t('Annuller', 'Cancel')}</button> : null}
      </div>
    </section>
  );

  if (compact) return <div className="mx-auto w-full max-w-[420px] space-y-4"><div className="flex items-center justify-between gap-3"><span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold"><BrandMark size={20} /><span className="truncate">{tenant.name}</span></span><ThemeSwitcher /></div>{callCard}</div>;

  return (
    <div className="mx-auto w-full max-w-[1120px]">
      <header className="public-header enter">
        <Link href={`/chat/${contact.id}`} className="flex min-w-0 items-center gap-2.5 text-[var(--text)]"><BrandMark size={28} /><span className="truncate text-[14px] font-semibold tracking-[-0.02em]">{tenant.name}</span></Link>
        <div className="flex items-center gap-2"><Link href={`/chat/${contact.id}`} className={buttonClass('ghost', 'sm')} aria-label={t('Chat i stedet', 'Chat instead')}><MessageSquare size={14} /><span className="hidden sm:inline">{t('Chat i stedet', 'Chat instead')}</span></Link><ThemeSwitcher /></div>
      </header>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] lg:gap-12">
        <section className="enter enter-delay order-last py-4 lg:order-first lg:py-10">
          <Badge tone="accent">{t('AI-reception', 'AI reception')}</Badge>
          <h1 className="mt-5 text-[clamp(32px,5vw,52px)] font-semibold leading-[1.06] tracking-[-0.05em]">{t('Tal med', 'Talk to')} <span className="text-[var(--accent-primary)]">{tenant.name}.</span></h1>
          <p className="mt-5 max-w-[520px] text-[16px] leading-7 text-[var(--text-secondary)]">{t('Ring direkte i browseren. Receptionisten kan svare på spørgsmål, tage en besked og hjælpe med det næste skridt.', 'Call directly in your browser. The receptionist can answer questions, take a message and help with the next step.')}</p>
          <dl className="mt-9 grid gap-6 sm:grid-cols-3">{[
            [t('Fortæl os behovet', 'Tell us what you need'), t('Beskriv kort, hvad du søger hjælp til.', 'Briefly describe what you need help with.')],
            [t('Få et klart svar', 'Get a clear answer'), t('Receptionisten bruger virksomhedens godkendte oplysninger.', 'The receptionist uses the business’s approved details.')],
            [t('Vi følger op', 'We follow up'), t('En person tager over, når sagen kræver det.', 'A person takes over when the case needs it.')],
          ].map(([title, body]) => <div key={title}><dt className="text-[13px] font-semibold">{title}</dt><dd className="mt-1.5 text-[13px] leading-6 text-[var(--muted)]">{body}</dd></div>)}</dl>
          <p className="mt-9 flex max-w-[520px] items-start gap-2 text-[12px] leading-6 text-[var(--muted)]"><ShieldCheck size={14} className="mt-1 shrink-0" aria-hidden />{t('Opkaldet kan blive optaget, så virksomheden kan følge op på din henvendelse.', 'The call may be recorded so the business can follow up on your request.')}</p>
        </section>
        <div className="enter enter-delay-2 order-first lg:order-last">{callCard}</div>
      </div>
    </div>
  );
}
