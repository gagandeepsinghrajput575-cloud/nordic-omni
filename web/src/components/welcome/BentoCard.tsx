'use client';

import { useCallback, useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { SPRING, springFor, staggerFor } from '@/lib/motion/springs';

/**
 * One bento cell.
 *
 * Spotlight: the pointer writes two custom properties (`--mx`, `--my`) on the
 * card element, and a single absolutely-positioned layer paints a radial
 * gradient from `--spotlight`. Two consequences worth stating:
 *
 *  - No React state is involved, so moving the pointer never re-renders the
 *    card. A `useState` here would re-render the whole subtree on every
 *    pointermove, which is the classic way this effect becomes janky.
 *  - The gradient is `position: absolute` inside `overflow: hidden`, so the
 *    glow is clipped to the card. It reads as an ambient edge light rather
 *    than a halo bleeding onto the page.
 *
 * The layer is hidden by default and only revealed on `data-lit`, so a
 * touch device (or a keyboard user) never sees a spotlight parked at 50% 0%.
 * Under reduced motion the layer still tracks, but its opacity transition is
 * removed in CSS — it appears instantly instead of easing.
 */

export interface BentoCardProps {
  title: string;
  blurb: string;
  /** Monochrome glyph shown beside the title. */
  glyph?: ReactNode;
  /** Column footprint at >=1024px. */
  span?: 'wide' | 'narrow' | 'tall';
  /** The illustrated well beneath the copy. */
  children?: ReactNode;
  /** Extra line of monochrome meta below the well. */
  meta?: ReactNode;
  /** Reveal index, used to derive the stagger delay. */
  index?: number;
  className?: string;
}

export function BentoCard({
  title,
  blurb,
  glyph,
  span = 'wide',
  children,
  meta,
  index = 0,
  className,
}: BentoCardProps) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [lit, setLit] = useState(false);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    // Pointer-only: a touch drag should not leave a spotlight pinned mid-card.
    if (event.pointerType !== 'mouse') return;
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    node.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    node.style.setProperty('--my', `${event.clientY - rect.top}px`);
  }, []);

  const handlePointerEnter = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return;
    setLit(true);
  }, []);

  const handlePointerLeave = useCallback(() => setLit(false), []);

  return (
    <motion.div
      className="bento-cell"
      data-span={span}
      initial={reduceMotion ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{
        ...springFor(reduceMotion, SPRING),
        delay: reduceMotion ? 0 : index * staggerFor(reduceMotion).staggerChildren,
      }}
    >
      <div
        ref={ref}
        className={['bento-card', className ?? ''].filter(Boolean).join(' ')}
        data-lit={lit ? 'true' : 'false'}
        onPointerMove={handlePointerMove}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <span className="bento-card__spotlight" aria-hidden="true" />

        <div className="bento-card__inner">
          <div className="bento-card__head">
            {glyph ? (
              <span className="bento-card__glyph" aria-hidden="true">
                {glyph}
              </span>
            ) : null}
            <h3 className="bento-card__title">{title}</h3>
          </div>

          <p className="bento-card__blurb">{blurb}</p>

          {children ? <div className="bento-card__well">{children}</div> : null}

          {meta ? <div className="bento-meta">{meta}</div> : null}
        </div>
      </div>
    </motion.div>
  );
}
