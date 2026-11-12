'use client';

import React, { useCallback, useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Phone, PhoneOff, Mic, MicOff, Volume2, CheckCircle, AlertTriangle, MessageSquare } from 'lucide-react';
import { Room, RoomEvent, Track, RemoteTrack } from 'livekit-client';
import { OrbVisualizer } from '@/components/audio/OrbVisualizer';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';
// Failed pre-agent attempts recover through /api/livekit/abandon.
import { abandonCallAttempt, combineAudioTracks, disposeAudioElement } from '@/lib/livekit/attempt';

interface CallClientViewProps {
  contact: {
    id: string;
    full_name: string | null;
    phone_number: string | null;
    preferred_language: string;
    // Intentionally NOT exposed on the public call page: internal CRM notes.
    shared_memory_summary?: string | null;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
    default_language: string;
  };
}

type CallStage = 'idle' | 'connecting' | 'waiting_for_agent' | 'active' | 'ended' | 'error';
const AGENT_TIMEOUT_MS = 30_000;

function stageDotClass(stage: CallStage) {
  if (stage === 'active') return 'h-1.5 w-1.5 rounded-full bg-[var(--success)]';
  if (stage === 'error') return 'h-1.5 w-1.5 rounded-full bg-[var(--danger)]';
  if (stage === 'connecting' || stage === 'waiting_for_agent') {
    return 'h-1.5 w-1.5 rounded-full bg-[var(--warning)]';
  }
  if (stage === 'ended') return 'h-1.5 w-1.5 rounded-full bg-[var(--text-muted)]';
  return 'h-1.5 w-1.5 rounded-full border border-[var(--text-muted)]';
}

export function CallClientView({ contact, tenant }: CallClientViewProps) {
  const [stage, setStage] = useState<CallStage>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [agentStream, setAgentStream] = useState<MediaStream | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [starting, setStarting] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const roomRef = useRef<Room | null>(null);
  const audioTracksRef = useRef(new Map<RemoteTrack, HTMLAudioElement>());
  const intentionalDisconnectRef = useRef(false);
  const attemptIdRef = useRef<string | null>(null);
  const startInFlightRef = useRef<number | null>(null);
  const reachedAgentRef = useRef(false);
  const disposedRef = useRef(false);
  const runRef = useRef(0);
  const agentTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cancelAgentWaitRef = useRef<(() => void) | null>(null);
  const muteInFlightRef = useRef(false);

  const isDanish = contact.preferred_language
    ? contact.preferred_language === 'da'
    : tenant.default_language.startsWith('da');

  useEffect(() => {
    if (stage === 'active') {
      timerRef.current = setInterval(() => setDuration((prev) => prev + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
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
    if (room) {
      room.removeAllListeners();
      void room.disconnect().catch(() => undefined);
    }
    audioTracksRef.current.forEach(disposeAudioElement);
    audioTracksRef.current.clear();
    setAgentStream(null);
    setIsMuted(false);
  }, []);

  const recoverCurrentAttempt = useCallback(() => {
    const attemptId = attemptIdRef.current;
    attemptIdRef.current = null;
    abandonCallAttempt(attemptId, reachedAgentRef.current);
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    const onPageHide = () => {
      disposedRef.current = true;
      recoverCurrentAttempt();
      cleanupCall();
    };
    const onPageShow = () => {
      disposedRef.current = false;
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      onPageHide();
    };
  }, [cleanupCall, recoverCurrentAttempt]);

  const handleStartCall = async () => {
    if (
      startInFlightRef.current !== null ||
      starting ||
      stage === 'connecting' ||
      stage === 'waiting_for_agent'
    ) return;

    const runId = ++runRef.current;
    startInFlightRef.current = runId;
    setStarting(true);
    setErrorMessage('');
    setDuration(0);
    intentionalDisconnectRef.current = false;
    reachedAgentRef.current = false;
    attemptIdRef.current = null;
    const isCurrent = () => !disposedRef.current && runRef.current === runId;

    try {
      setStage('connecting');
      const tokenRes = await fetch('/api/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: tenant.id,
          contactId: contact.id,
          role: 'customer',
        }),
      });
      const tokenData = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !tokenData.token || !tokenData.serverUrl) {
        throw new Error(
          tokenData.error ??
            (isDanish ? 'Kunne ikke starte opkaldet.' : 'Could not start the call.'),
        );
      }

      attemptIdRef.current = tokenData.attemptId ?? null;
      if (!isCurrent()) {
        recoverCurrentAttempt();
        return;
      }

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      let signalAgentAudio: () => void = () => undefined;
      const agentAudio = new Promise<void>((resolve) => {
        signalAgentAudio = resolve;
      });
      const cancelled = new Promise<null>((resolve) => {
        cancelAgentWaitRef.current = () => resolve(null);
      });

      const updateAgentStream = () => {
        if (!isCurrent()) return;
        const mediaTracks: MediaStreamTrack[] = [];
        audioTracksRef.current.forEach((_element, track) => {
          if (track.mediaStreamTrack) mediaTracks.push(track.mediaStreamTrack);
        });
        setAgentStream(combineAudioTracks(mediaTracks));
      };

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
        audioTracksRef.current.set(track, audioElement);
        updateAgentStream();
        signalAgentAudio();
      });

      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach(disposeAudioElement);
        if (!isCurrent()) return;
        const attached = audioTracksRef.current.get(track);
        if (attached) disposeAudioElement(attached);
        audioTracksRef.current.delete(track);
        // Another remote audio track may still be live.
        updateAgentStream();
      });

      room.on(RoomEvent.Disconnected, () => {
        if (!isCurrent() || intentionalDisconnectRef.current) return;
        recoverCurrentAttempt();
        cleanupCall();
        setStage('ended');
      });

      await room.connect(tokenData.serverUrl, tokenData.token);
      if (!isCurrent()) throw new Error('Call attempt superseded');
      await room.startAudio();
      if (!isCurrent()) throw new Error('Call attempt superseded');
      await room.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      if (!isCurrent()) throw new Error('Call attempt superseded');

      // Do not read agentStream from this async closure. TrackSubscribed may
      // already have fired while browser audio/microphone unlock was pending.
      setStage('waiting_for_agent');
      const timeout = new Promise<null>((resolve) => {
        agentTimeoutRef.current = setTimeout(() => resolve(null), AGENT_TIMEOUT_MS);
      });
      const ready = await Promise.race([
        agentAudio.then(() => true),
        timeout,
        cancelled,
      ]);
      if (agentTimeoutRef.current) clearTimeout(agentTimeoutRef.current);
      agentTimeoutRef.current = null;
      cancelAgentWaitRef.current = null;
      if (!isCurrent()) throw new Error('Call attempt superseded');
      if (!ready) {
        throw new Error(
          isDanish
            ? 'Receptionisten svarede ikke. Prøv igen om et øjeblik.'
            : 'The receptionist did not answer. Please try again shortly.',
        );
      }

      const audioElements = Array.from(audioTracksRef.current.values());
      if (audioElements.length === 0) throw new Error('Agent audio is no longer available');
      await Promise.all(audioElements.map(async (audioElement) => {
        try {
          await audioElement.play();
        } catch (error) {
          // An unsubscribed element can reject after disposal; a still-attached
          // element rejecting playback is a real autoplay failure.
          if (Array.from(audioTracksRef.current.values()).includes(audioElement)) {
            throw error;
          }
        }
      }));
      if (!isCurrent()) throw new Error('Call attempt superseded');
      if (audioTracksRef.current.size === 0) throw new Error('Agent audio is no longer available');
      reachedAgentRef.current = true;
      setStage('active');
    } catch (error) {
      // A late failure from an old room must never clean up a newer attempt.
      if (!isCurrent()) return;
      recoverCurrentAttempt();
      cleanupCall();
      setErrorMessage(
        error instanceof Error
          ? error.message
          : isDanish
            ? 'Opkaldet kunne ikke oprettes.'
            : 'The call could not be established.',
      );
      setStage('error');
    } finally {
      if (startInFlightRef.current === runId) {
        startInFlightRef.current = null;
        setStarting(false);
      }
    }
  };

  const handleEndCall = () => {
    // cleanup clears the ID, so pagehide/unmount cannot abandon an active call.
    cleanupCall();
    setStage('ended');
  };

  const toggleMute = async () => {
    const room = roomRef.current;
    if (!room || muteInFlightRef.current) return;
    muteInFlightRef.current = true;
    const participant = room.localParticipant;
    try {
      await participant.setMicrophoneEnabled(!participant.isMicrophoneEnabled);
    } catch {
      if (roomRef.current === room) {
        setErrorMessage(
          isDanish
            ? 'Mikrofonen kunne ikke ændres. Kontrollér browserens adgang.'
            : 'The microphone could not be changed. Check browser permission.',
        );
      }
    } finally {
      if (roomRef.current === room) {
        setIsMuted(!participant.isMicrophoneEnabled);
      }
      muteInFlightRef.current = false;
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const stageLabel = {
    idle: isDanish ? 'Klar' : 'Ready',
    connecting: isDanish ? 'Forbinder' : 'Connecting',
    waiting_for_agent: isDanish ? 'Venter' : 'Waiting',
    active: isDanish ? 'Forbundet' : 'Connected',
    ended: isDanish ? 'Afsluttet' : 'Ended',
    error: isDanish ? 'Fejl' : 'Error',
  }[stage];

  return (
    <div className="w-full max-w-[1180px]">
      <header className="enter mb-9 flex flex-wrap items-center justify-between gap-5 pb-2">
        <div className="flex items-center gap-3.5">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-[var(--bg-raised)] text-[17px] font-black text-[var(--accent-primary)]"
            title={tenant.name}
          >
            {tenant.name.charAt(0)}
          </div>
          <span className="sr-only">{tenant.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/chat/${contact.id}`}
            className="flex items-center gap-2 rounded-[10px] border border-[var(--line)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text)]"
          >
            <MessageSquare size={13} />
            <span className="hidden sm:inline">{isDanish ? 'Chat i stedet' : 'Chat instead'}</span>
          </Link>
          <span className="hidden text-[13px] text-[var(--muted)] sm:inline">
            WebRTC / {isDanish ? 'Dansk' : 'English'}
          </span>
          <ThemeSwitcher />
        </div>
      </header>

      <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(390px,0.72fr)] lg:grid-rows-[auto_1fr] lg:gap-x-12">
        <section className="enter enter-delay relative overflow-hidden rounded-[14px] bg-[var(--bg-surface)] px-6 py-8 lg:col-start-1 lg:row-start-1 lg:px-8">
          <Image
            src="/assets/oak-veneer.webp"
            alt=""
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 55vw"
            className="hero-drift pointer-events-none object-cover opacity-[0.16]"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[var(--bg-ground)]/20 via-[var(--bg-ground)]/55 to-[var(--bg-ground)]/85" />

          <div className="relative z-10">
            <h1 className="max-w-[700px] text-[clamp(2.65rem,5.2vw,4.5rem)] font-semibold leading-[0.98] tracking-[-0.055em] text-[var(--text)]">
              {isDanish ? (
                <>
                  Tal med <span className="text-[var(--accent-primary)]">Christel.</span>
                </>
              ) : (
                <>
                  Speak with <span className="text-[var(--accent-primary)]">Christel.</span>
                </>
              )}
            </h1>
            <p className="mt-5 max-w-[560px] text-[clamp(1.15rem,1.8vw,1.4rem)] font-medium leading-[1.35] tracking-[-0.025em] text-[var(--text)]">
              {isDanish
                ? 'Dansk Byg & Renovering hjælper med badeværelse, køkken, tilbygning og tag.'
                : 'Dansk Byg & Renovation handles bathrooms, kitchens, extensions and roofs.'}
            </p>
            <p className="mt-4 hidden max-w-[520px] text-[16px] leading-7 text-[var(--text-secondary)] sm:block">
              {isDanish
                ? 'Ring direkte i browseren. Christel afdækker opgaven, giver et vejledende overslag og finder en tid til en gratis besigtigelse.'
                : 'Call directly in your browser. Christel scopes the work, gives a non-binding estimate and finds a time for a free inspection.'}
            </p>
          </div>
        </section>

        <section className="enter enter-delay-2 flex min-h-[460px] flex-col overflow-hidden rounded-[14px] bg-[var(--bg-surface)] lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:min-h-[530px]">
          <div className="flex items-center justify-between gap-4 px-6 py-4">
            <div className="flex items-center gap-2.5">
              <span
                className={stageDotClass(stage)}
                aria-hidden
              />
              <span className="text-[13px] text-[var(--text-secondary)]">
                {stageLabel}
              </span>
            </div>
            <span className="text-[13px] tabular-nums text-[var(--text-muted)]">
              {stage === 'active' ? formatTimer(duration) : '00:00'}
            </span>
          </div>

          <div className="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
        {stage === 'idle' && (
          <div className="flex w-full flex-col items-center">
            <div className="flex h-28 w-28 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--bg-ground)]">
              <Phone className="h-9 w-9 text-[var(--accent-primary)]" strokeWidth={1.8} />
            </div>
            <div className="mt-6 space-y-2">
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-[var(--text)]">
                {isDanish ? 'Klar til at tale med Christel' : 'Ready to speak with Christel'}
              </h2>
              <p className="mx-auto max-w-[280px] text-[13px] leading-6 text-[var(--text-secondary)]">
                {isDanish
                  ? 'Tryk start, giv mikrofonadgang, og vent på hilsenen.'
                  : 'Press start, allow the microphone and wait for the greeting.'}
              </p>
            </div>
          </div>
        )}

        {(stage === 'connecting' || stage === 'waiting_for_agent') && (
          <div className="flex w-full flex-col items-center">
            <OrbVisualizer isActive={true} state="listening" size={132} />
            <span className="mt-5 text-[13px] font-medium text-[var(--text-secondary)]">
              {stage === 'waiting_for_agent'
                ? isDanish
                  ? 'Forbundet. Venter på receptionisten…'
                  : 'Connected. Waiting for the receptionist…'
                : isDanish
                  ? 'Forbinder sikkert…'
                  : 'Connecting securely…'}
            </span>
          </div>
        )}

        {stage === 'active' && (
          <div className="flex w-full flex-col items-center">
            <OrbVisualizer
              isActive={true}
              state={isMuted ? 'idle' : 'speaking'}
              audioStream={agentStream}
              size={150}
            />
            <div className="mt-4 text-[32px] font-medium leading-none tracking-[-0.04em] text-[var(--text)] tabular-nums">
              {formatTimer(duration)}
            </div>
            <span className="mt-3 inline-flex items-center gap-2 text-[13px] text-[var(--success)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
              {isDanish ? 'Forbundet med receptionisten' : 'Connected to the receptionist'}
            </span>

            <div className="mt-6 flex w-full items-start gap-2.5 text-left text-[13px] leading-5 text-[var(--text-secondary)]">
              <Volume2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-primary)]" />
              <span>
                {isDanish
                  ? 'Tal efter hilsenen. Optagelsen gemmes lokalt på arbejdsstationen.'
                  : 'Speak after the greeting. The recording stays on this workstation.'}
              </span>
            </div>
          </div>
        )}

        {stage === 'error' && (
          <div className="flex w-full flex-col items-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-full border border-[var(--danger)]/40 bg-[var(--danger-soft)] text-[var(--danger)]">
              <AlertTriangle className="h-8 w-8" strokeWidth={1.7} />
            </div>
            <div className="mt-6 space-y-2">
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-[var(--text)]">
                {isDanish ? 'Opkaldet blev ikke oprettet' : 'Call not established'}
              </h2>
              <p className="mx-auto max-w-[300px] text-[13px] leading-6 text-[var(--text-secondary)]">
                {errorMessage}
              </p>
            </div>
          </div>
        )}

        {stage === 'ended' && (
          <div className="flex w-full flex-col items-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-full border border-[var(--success)]/40 bg-[var(--success)]/10 text-[var(--success)]">
              <CheckCircle className="h-8 w-8" strokeWidth={1.7} />
            </div>
            <div className="mt-6 space-y-2">
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-[var(--text)]">
                {isDanish ? 'Opkaldet er afsluttet' : 'Call ended'}
              </h2>
              <p className="mx-auto max-w-[290px] text-[13px] leading-6 text-[var(--text-secondary)]">
                {isDanish
                  ? 'Tak for samtalen. Din henvendelse er gemt til gennemsyn.'
                  : 'Thank you for calling. Your request has been recorded for review.'}
              </p>
            </div>
          </div>
        )}
      </div>

          <div className="p-4 pt-1">
            {(stage === 'idle' || stage === 'error') && (
              <button
                onClick={handleStartCall}
                disabled={starting}
                className="flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-[10px] bg-[var(--accent-primary)] px-5 text-[14px] font-semibold text-[var(--accent-contrast)] transition-[filter,transform] duration-150 hover:brightness-105 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"
              >
                <Phone className="h-4 w-4 fill-current" />
                <span>
                  {stage === 'error'
                    ? isDanish ? 'Prøv igen' : 'Try again'
                    : isDanish ? 'Start opkald' : 'Start call'}
                </span>
              </button>
            )}

            {stage === 'active' && (
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={toggleMute}
                  className={`flex h-12 w-12 items-center justify-center rounded-[10px] border transition-colors ${
                    isMuted
                      ? 'border-[var(--danger)]/50 bg-[var(--danger-soft)] text-[var(--danger)]'
                      : 'border-[var(--line)] bg-[var(--bg-raised)] text-[var(--text)] hover:border-[var(--border-strong)]'
                  }`}
                  title={isMuted ? 'Slå lyd til' : 'Slå lyd fra'}
                  aria-label="Toggle microphone"
                >
                  {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </button>

                <button
                  onClick={handleEndCall}
                  className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[10px] border border-[var(--danger)]/40 bg-[var(--danger)] text-[13px] font-semibold text-white transition-[filter] hover:brightness-105"
                  aria-label="End call"
                >
                  <PhoneOff className="h-4 w-4" />
                  {isDanish ? 'Afslut opkald' : 'End call'}
                </button>
              </div>
            )}

            {stage === 'ended' && (
              <button
                onClick={() => {
                  setStage('idle');
                  setDuration(0);
                }}
                className="min-h-[48px] w-full rounded-[10px] bg-[var(--bg-raised)] px-5 text-[13px] font-semibold text-[var(--text)] transition-colors hover:bg-[var(--panel-2)]"
              >
                {isDanish ? 'Ring igen' : 'Call again'}
              </button>
            )}
          </div>
        </section>

        <section className="enter enter-delay-2 px-1 lg:col-start-1 lg:row-start-2 lg:pt-2">
          <dl className="grid gap-5 sm:grid-cols-3 lg:max-w-[600px]">
            {[
              {
                title: isDanish ? 'Opgaven' : 'The work',
                body: isDanish
                  ? 'Badeværelse, køkken, tilbygning eller tag.'
                  : 'Bathroom, kitchen, extension or roof.',
              },
              {
                title: isDanish ? 'Overslaget' : 'The estimate',
                body: isDanish
                  ? 'Vejledende, ikke et bindende tilbud.'
                  : 'A guide only, never a binding quote.',
              },
              {
                title: isDanish ? 'Næste skridt' : 'The next step',
                body: isDanish
                  ? 'Gratis besigtigelse med Morten Bondo.'
                  : 'Free inspection with Morten Bondo.',
              },
            ].map((item) => (
              <div key={item.title} className="enter" style={{ animationDelay: '220ms' }}>
                <dt className="text-[14px] font-semibold text-[var(--text)]">{item.title}</dt>
                <dd className="mt-1.5 text-[16px] leading-6 text-[var(--text)]">
                  {item.body}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 max-w-[520px] text-[16px] leading-6 text-[var(--text-secondary)]">
            {isDanish
              ? 'Opkaldet optages for at kunne følge op på din henvendelse. Optagelsen opbevares på virksomhedens arbejdsstation.'
              : 'The call is recorded so the business can follow up. The recording stays on the company workstation.'}
          </p>
        </section>
      </div>
    </div>
  );
}
