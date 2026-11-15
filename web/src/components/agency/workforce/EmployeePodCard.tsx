'use client';

import { useId, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { SPRING, springFor } from '@/lib/motion/springs';
import { Badge } from '@/components/ui/core';
import type { EmployeePod, PodId, PodStatus } from '@/lib/workforce/roster';

/**
 * One AI employee pod.
 *
 * The drawer is a disclosure: a real button with `aria-expanded` and
 * `aria-controls`, animating height and opacity together. Height animation is
 * normally a layout cost, but the drawer is one short list inside an isolated
 * card, so the reflow is scoped to that card rather than the page.
 *
 * Under reduced motion the drawer still opens — it just does so without
 * travelling, and `AnimatePresence` returns the element immediately.
 */

const STATUS_TONE: Record<PodStatus, 'success' | 'neutral' | 'warning'> = {
  active: 'success',
  idle: 'neutral',
  attention: 'warning',
};

export interface EmployeePodCardProps {
  pod: EmployeePod;
  /** Opens the drawer on first render, used for the featured pod. */
  defaultOpen?: boolean;
}

export function EmployeePodCard({ pod, defaultOpen = false }: EmployeePodCardProps) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(defaultOpen);
  const drawerId = useId();

  return (
    <motion.article
      className="pod"
      initial={reduceMotion ? false : { opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      transition={springFor(reduceMotion, SPRING)}
    >
      <div className="pod__head">
        <span className="pod__glyph" aria-hidden="true">
          <PodGlyph id={pod.id} />
        </span>
        <div className="pod__id">
          <span className="pod__role">{pod.role}</span>
          <h3 className="pod__name">{pod.name}</h3>
        </div>
        <span className="pod__status">
          <Badge tone={STATUS_TONE[pod.status]} dot>
            {pod.statusLabel}
          </Badge>
        </span>
      </div>

      <p className="wfhud__sub">{pod.charter}</p>

      <div className="pod__metrics">
        {pod.metrics.map((metric) => (
          <div className="pod__metric" key={metric.label}>
            <span className="pod__metric-label">{metric.label}</span>
            <span className="pod__metric-value">{metric.value}</span>
          </div>
        ))}
      </div>

      <ul className="pod__tags" aria-label="Kapabiliteter">
        {pod.capabilities.map((capability) => (
          <li className="pod-tag" key={capability}>
            {capability}
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="pod__drawer-toggle"
        aria-expanded={open}
        aria-controls={drawerId}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? 'Skjul detaljer' : 'Vis detaljer'}
        <motion.span
          aria-hidden="true"
          animate={{ rotate: open ? 180 : 0 }}
          transition={springFor(reduceMotion, SPRING)}
          style={{ display: 'inline-flex' }}
        >
          <ChevronGlyph />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            className="pod__drawer"
            id={drawerId}
            key="drawer"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={springFor(reduceMotion, SPRING)}
          >
            <ul className="pod__drawer-list">
              {pod.drawer.map((row) => (
                <li className="pod__drawer-item" key={row.key}>
                  <span className="pod__drawer-key">{row.key}</span>
                  <span>{row.value}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  );
}

function PodGlyph({ id }: { id: PodId }) {
  switch (id) {
    case 'creative':
      return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
          <path d="M8 1.6 9.6 6l4.4 1.6-4.4 1.6L8 13.6 6.4 9.2 2 7.6 6.4 6 8 1.6Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
        </svg>
      );
    case 'paid-media':
      return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.1" />
          <circle cx="8" cy="8" r="2.6" stroke="currentColor" strokeWidth="1.1" />
          <circle cx="8" cy="8" r="0.9" fill="currentColor" />
        </svg>
      );
    case 'seo-geo':
      return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
          <circle cx="3" cy="4" r="1.7" stroke="currentColor" strokeWidth="1.1" />
          <circle cx="13" cy="4" r="1.7" stroke="currentColor" strokeWidth="1.1" />
          <circle cx="8" cy="12.4" r="1.7" stroke="currentColor" strokeWidth="1.1" />
          <path d="M4.5 5 7 11M11.5 5 9 11M4.8 4h6.4" stroke="currentColor" strokeWidth="1.05" />
        </svg>
      );
    case 'voice':
      return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
          <path d="M3.4 2.4h2.2l1.1 2.7-1.4 1a7.6 7.6 0 0 0 3.4 3.4l1-1.4 2.7 1.1v2.2a1.4 1.4 0 0 1-1.5 1.4A11.3 11.3 0 0 1 2 3.9a1.4 1.4 0 0 1 1.4-1.5Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
        </svg>
      );
  }
}

function ChevronGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false">
      <path d="M3 4.6 6 7.6l3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
