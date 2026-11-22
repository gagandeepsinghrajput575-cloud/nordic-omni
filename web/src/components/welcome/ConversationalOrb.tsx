'use client';

import { useId } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { SPRING, springFor } from '@/lib/motion/springs';

/**
 * The breathing conversational orb.
 *
 * Two independent mechanisms, on purpose:
 *
 *  1. **State expansion** — a Framer Motion spring. Moving between `idle`,
 *     `listening` and `speaking` changes the target scale, and the shared
 *     `SPRING` carries it there. Overshoot on arrival is what makes the orb
 *     feel like it is reacting rather than being set.
 *  2. **Breathing** — a CSS keyframe per ring, staggered by a per-ring delay.
 *     This is a continuous loop, and a spring is the wrong tool for one: it
 *     settles. Keeping the loop in CSS also means it costs nothing on the main
 *     thread while the user is talking.
 *
 * Reduced motion: no rings, no loop — a single static `<svg>` with concentric
 * circles and a `role="img"` label. Not a scaled-down animation, an actual
 * second render path, so there is nothing left running to ignore the setting.
 */

export type OrbState = 'idle' | 'listening' | 'speaking';

export interface ConversationalOrbProps {
  state: OrbState;
  /** Accessible description of what the orb is depicting. */
  label?: string;
  className?: string;
}

const RING_COUNT = 3;

/** Where each ring sits, and how far it travels, per state. */
const STATE_SCALE: Record<OrbState, number> = {
  idle: 0.86,
  listening: 1,
  speaking: 1.12,
};

const STATE_COPY: Record<OrbState, string> = {
  idle: 'Stille',
  listening: 'Lytter',
  speaking: 'Taler',
};

export function ConversationalOrb({
  state,
  label = 'Samtale-orb',
  className,
}: ConversationalOrbProps) {
  const reduceMotion = useReducedMotion();
  const motionId = useId();
  const copy = STATE_COPY[state];

  if (reduceMotion) {
    return (
      <div className={['conv-orb', className ?? ''].filter(Boolean).join(' ')}>
        <svg
          viewBox="0 0 200 200"
          width="100%"
          height="100%"
          role="img"
          aria-label={`${label}: ${copy}. Statisk gengivelse.`}
        >
          {Array.from({ length: RING_COUNT }, (_, index) => (
            <circle
              key={`ring-${index}`}
              cx="100"
              cy="100"
              r={38 + index * 22}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.22 - index * 0.05}
              strokeWidth="1"
            />
          ))}
          <circle
            cx="100"
            cy="100"
            r="26"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.55"
            strokeWidth="1"
          />
          <circle cx="100" cy="100" r="13" fill="currentColor" fillOpacity="0.85" />
        </svg>
      </div>
    );
  }

  return (
    <div
      className={['conv-orb', className ?? ''].filter(Boolean).join(' ')}
      data-state={state}
    >
      {Array.from({ length: RING_COUNT }, (_, index) => {
        const inset = 14 + index * 8;
        return (
          <motion.span
            key={`ring-${index}`}
            className="conv-orb__ring"
            style={{
              ['--i' as string]: index,
              inset: `${inset}%`,
              animation: `conv-breathe-ring 4200ms var(--ease) ${index * 420}ms infinite`,
            }}
            initial={false}
            animate={{ scale: STATE_SCALE[state], opacity: 0.42 - index * 0.08 }}
            transition={{ ...springFor(reduceMotion, SPRING), delay: index * 0.05 }}
            aria-hidden="true"
          />
        );
      })}

      <motion.span
        className="conv-orb__glow"
        initial={false}
        animate={{ scale: state === 'speaking' ? 1.04 : 1 }}
        transition={springFor(reduceMotion, SPRING)}
        aria-hidden="true"
      />

      <motion.span
        className="conv-orb__core"
        initial={false}
        animate={{ scale: state === 'speaking' ? 1.14 : state === 'listening' ? 0.94 : 1 }}
        transition={springFor(reduceMotion, SPRING)}
        aria-hidden="true"
      />

      {/* The state is announced in text, so the orb never depends on motion. */}
      <span className="conv-orb__label" aria-live="polite" id={motionId}>
        {copy}
      </span>
    </div>
  );
}
