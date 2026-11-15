'use client';

import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { SPRING_SOFT, springFor, staggerFor } from '@/lib/motion/springs';

/**
 * The hero's asymmetric headline band.
 *
 * The reference does not centre: the display headline owns the left ~45% of a
 * 1180px measure and the supporting deck is right-shifted and top-aligned to
 * the headline's first line. That is a deliberate 40/60 split, not a mistake,
 * so it is encoded in `.welcome-hero` rather than left to chance.
 *
 * Motion: each line rises in sequence on a soft spring. Under reduced motion
 * the container collapses to a zero stagger and the items render at their final
 * position, so nothing is left waiting behind an animation that will not run.
 */

export interface HeroHeadlineProps {
  /** Display lines. Each entry is its own line; never reflowed by the browser. */
  lines: readonly string[];
  /** Supporting paragraph, rendered in the right-hand column. */
  deck: ReactNode;
  /** Extra delay before the first line arrives, in seconds. */
  delay?: number;
  className?: string;
}

export function HeroHeadline({ lines, deck, delay = 0, className }: HeroHeadlineProps) {
  const reduceMotion = useReducedMotion();
  const container = {
    hidden: {},
    show: {
      transition: {
        ...staggerFor(reduceMotion, 0.07, delay),
      },
    },
  };
  const item = {
    hidden: reduceMotion ? { opacity: 1 } : { opacity: 0, y: 16 },
    show: { opacity: 1, y: 0, transition: springFor(reduceMotion, SPRING_SOFT) },
  };
  const deckIn = {
    hidden: reduceMotion ? { opacity: 1 } : { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: springFor(reduceMotion, SPRING_SOFT) },
  };

  return (
    <div className={['welcome-hero', className ?? ''].filter(Boolean).join(' ')}>
      <motion.h1
        className="welcome-title"
        variants={container}
        initial="hidden"
        animate="show"
      >
        {lines.map((line) => (
          <motion.span key={line} className="welcome-title-line" variants={item}>
            {line}
          </motion.span>
        ))}
      </motion.h1>

      <motion.p className="welcome-deck" variants={deckIn} initial="hidden" animate="show">
        {deck}
      </motion.p>
    </div>
  );
}
