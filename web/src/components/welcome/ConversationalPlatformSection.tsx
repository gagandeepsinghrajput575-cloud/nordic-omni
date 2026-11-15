'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { SPRING_SOFT, riseIn } from '@/lib/motion/springs';
import { GlidingTabSwitcher, type TabOption } from './GlidingTabSwitcher';
import { ConversationalOrb, type OrbState } from './ConversationalOrb';
import { TelemetryHud, type TelemetryStat } from './TelemetryHud';

/**
 * Piece 3: the conversational platform band.
 *
 * Sits on the studio ground (`--studio-black`, which does not flip with the
 * theme) because the orb only reads as luminous against obsidian. That is a
 * deliberate exception to the page ground, not an oversight — the same rule the
 * existing studio surfaces already follow.
 *
 * The "call" is a simulation. There is no WebRTC session here: pressing the
 * button runs a scripted local state machine (ringing → listening → speaking →
 * ended) on timers, and the HUD reads from that machine. It is labelled as a
 * demo in the bar, the same way `VoicePlayground` and the Piece 1 transport are.
 */

export type PersonaId = 'receptionist' | 'advisor' | 'technician';

export const PERSONAS: ReadonlyArray<TabOption<PersonaId>> = [
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'advisor', label: 'Rådgiver' },
  { value: 'technician', label: 'Tekniker' },
];

type Phase = 'idle' | 'ringing' | 'listening' | 'speaking' | 'ended';

const PHASE_MS: Record<Exclude<Phase, 'idle'>, number> = {
  ringing: 1400,
  listening: 2600,
  speaking: 3000,
  ended: 900,
};

const ORB_FOR_PHASE: Record<Phase, OrbState> = {
  idle: 'idle',
  ringing: 'idle',
  listening: 'listening',
  speaking: 'speaking',
  ended: 'idle',
};

const PHASE_COPY: Record<Phase, string> = {
  idle: 'Klar',
  ringing: 'Ringer op',
  listening: 'Kunden taler',
  speaking: 'Agenten taler',
  ended: 'Samtale afsluttet',
};

const STATS: readonly TelemetryStat[] = [
  { label: 'Oppetid', value: '99,98', unit: '%' },
  { label: 'Jitter', value: '1,4', unit: 'ms' },
  { label: 'Gennemstrøm', value: '48', unit: 'kb/s' },
  { label: 'Svar', value: '128', unit: 'ms' },
];

export interface ConversationalPlatformSectionProps {
  className?: string;
}

export function ConversationalPlatformSection({ className }: ConversationalPlatformSectionProps) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [persona, setPersona] = useState<PersonaId>('receptionist');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const advance = useCallback(
    (next: Phase) => {
      setPhase(next);
      if (next === 'idle' || next === 'ended') return;
      timerRef.current = setTimeout(() => {
        // ringing -> listening -> speaking -> ended -> idle
        const order: Phase[] = ['ringing', 'listening', 'speaking', 'ended'];
        const at = order.indexOf(next);
        advance(at === -1 || at === order.length - 1 ? 'idle' : order[at + 1]);
      }, PHASE_MS[next]);
    },
    [],
  );

  const startCall = useCallback(() => {
    clearTimer();
    advance(phase === 'idle' || phase === 'ended' ? 'ringing' : 'idle');
  }, [advance, clearTimer, phase]);

  const inCall = phase !== 'idle' && phase !== 'ended';
  const duplexing = phase === 'listening' || phase === 'speaking';
  const turn =
    phase === 'listening' ? 'listening' : phase === 'speaking' ? 'speaking' : 'idle';

  return (
    <section
      className={['conv-section', className ?? ''].filter(Boolean).join(' ')}
      aria-labelledby="conv-heading"
    >
      <motion.div
        className="conv-head"
        variants={riseIn(reduceMotion)}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      >
        <div>
          <p className="conv-eyebrow">Samtale-AI</p>
          <h2 className="conv-title" id="conv-heading">
            Den taler, lytter — og afbrydes midt i en sætning
          </h2>
        </div>
        <p className="bento-sub">
          Fuld duplex med tur-tagning under 150 ms. Orbens tilstand og telemetrien
          kommer fra samme simuleringsmaskine, så de aldrig viser to sandheder.
        </p>
      </motion.div>

      <div className="conv-stage">
        <div className="conv-orb-well">
          <ConversationalOrb state={ORB_FOR_PHASE[phase]} />
        </div>

        <TelemetryHud
          latencyMs={128}
          duplexing={duplexing}
          turn={turn}
          stats={STATS}
        />
      </div>

      <div className="conv-bar">
        <button
          type="button"
          className="conv-call"
          onClick={startCall}
          aria-pressed={inCall}
        >
          <PhoneGlyph />
          {inCall ? 'Afslut demo' : 'Start demosamtale'}
        </button>

        <GlidingTabSwitcher
          options={PERSONAS}
          value={persona}
          onChange={setPersona}
          label="Vælg stemmepersona"
        />

        <span className="conv-bar__note" aria-live="polite">
          {PHASE_COPY[phase]} · Simuleret WebRTC · intet opkald oprettes
        </span>
      </div>
    </section>
  );
}

function PhoneGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M3.1 1.8h2l1 2.4-1.3.9a7 7 0 0 0 3.1 3.1l.9-1.3 2.4 1v2a1.3 1.3 0 0 1-1.4 1.3A10.4 10.4 0 0 1 1.8 3.2a1.3 1.3 0 0 1 1.3-1.4Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
