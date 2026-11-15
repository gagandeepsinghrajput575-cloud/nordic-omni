'use client';

import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { SPRING, springFor } from '@/lib/motion/springs';
import { ASSURANCES, type AssuranceGlyphId } from './welcome-content';

/**
 * The enterprise assurance grid.
 *
 * Glass cards with a hairline border, a 2px hover lift, and a text-first badge.
 *
 * On the claims: SOC 2 Type II, GDPR, a 99.99% uptime SLA and encrypted vaults
 * describe *the deployment this product is designed for*, not a certification
 * this repository has evidence of. They are rendered from a data array so the
 * copy can be corrected in one place, and the badge is always text — a green
 * dot beside "SOC 2 Type II" is decorative, never the claim itself.
 */


export interface EnterpriseSecuritySectionProps {
  className?: string;
}

export function EnterpriseSecuritySection({ className }: EnterpriseSecuritySectionProps) {
  const reduceMotion = useReducedMotion();

  return (
    <section
      className={['wsec-section', 'welcome-wrap', className ?? ''].filter(Boolean).join(' ')}
      aria-labelledby="wsec-heading"
    >
      <div className="wsec-head">
        <p className="wsec-eyebrow">Enterprise</p>
        <h2 className="wsec-title" id="wsec-heading">
          Bygget til drift, ikke til en demo
        </h2>
      </div>

      <ul className="wsec-grid">
        {ASSURANCES.map((card, index) => (
          <motion.li
            key={card.id}
            className="wsec-card"
            initial={reduceMotion ? false : { opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '0px 0px -10% 0px' }}
            transition={{
              ...springFor(reduceMotion, SPRING),
              delay: reduceMotion ? 0 : index * 0.06,
            }}
          >
            <span className="wsec-card__glyph" aria-hidden="true">
              {GLYPHS[card.glyph]}
            </span>
            <h3 className="wsec-card__title">{card.title}</h3>
            <p className="wsec-card__body">{card.body}</p>
            <span className="wsec-badge">
              <span className="wsec-badge__dot" aria-hidden="true" />
              {card.badge}
            </span>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}

/** Glyph components keyed by id, so the data module stays JSX-free. */
const GLYPHS: Record<AssuranceGlyphId, ReactNode> = {
  shield: <ShieldGlyph />,
  pin: <PinGlyph />,
  pulse: <PulseGlyph />,
  lock: <LockGlyph />,
};

// -----------------------------------------------------------------------------
// Glyphs — 14px, currentColor
// -----------------------------------------------------------------------------

const glyphProps = {
  width: 14,
  height: 14,
  viewBox: '0 0 14 14',
  fill: 'none',
  'aria-hidden': true,
  focusable: 'false',
} as const;

function ShieldGlyph() {
  return (
    <svg {...glyphProps}>
      <path
        d="M7 1.6 12 3.4v4c0 2.8-2 4.9-5 5.6-3-.7-5-2.8-5-5.6v-4L7 1.6Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M4.9 7.1 6.4 8.6 9.2 5.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PinGlyph() {
  return (
    <svg {...glyphProps}>
      <path
        d="M7 12.4c2.2-2.4 3.6-4 3.6-5.8a3.6 3.6 0 1 0-7.2 0c0 1.8 1.4 3.4 3.6 5.8Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="6.5" r="1.3" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function PulseGlyph() {
  return (
    <svg {...glyphProps}>
      <path
        d="M1.4 7.4h2.2l1.4-3.6 2.2 6.8 1.5-3.2h3.9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg {...glyphProps}>
      <rect x="2.6" y="6.2" width="8.8" height="6.2" rx="1.6" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4.8 6.2V4.6a2.2 2.2 0 0 1 4.4 0v1.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="7" cy="9.3" r="0.9" fill="currentColor" />
    </svg>
  );
}
