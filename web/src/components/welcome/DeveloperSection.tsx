'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { riseIn } from '@/lib/motion/springs';
import { DeveloperApiConsole, ENDPOINTS, type EndpointId } from './DeveloperApiConsole';

/**
 * Piece 4: the developer section.
 *
 * Two columns, mirroring the reference: a stacked endpoint list on the left and
 * the terminal on the right. Selecting an endpoint updates the path shown in
 * the terminal's title bar — the snippets themselves document the webhook,
 * which is the endpoint this page is actually selling.
 */

export interface DeveloperSectionProps {
  className?: string;
}

export function DeveloperSection({ className }: DeveloperSectionProps) {
  const reduceMotion = useReducedMotion();
  const [endpoint, setEndpoint] = useState<EndpointId>('webhook');

  return (
    <section
      className={['devc-section', 'welcome-wrap', className ?? ''].filter(Boolean).join(' ')}
      aria-labelledby="devc-heading"
    >
      <motion.div
        className="devc-head"
        variants={riseIn(reduceMotion)}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      >
        <div>
          <p className="devc-eyebrow">Udvikler-API</p>
          <h2 className="devc-title" id="devc-heading">
            Byg videre på den reception, du allerede har
          </h2>
        </div>
        <a className="devc-link" href="/agency/webhooks">
          Åbn dokumentation
          <ArrowGlyph />
        </a>
      </motion.div>

      <div className="devc-layout">
        <div className="devc-endpoints" role="group" aria-label="Endepunkter">
          {ENDPOINTS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="devc-endpoint"
              aria-pressed={endpoint === entry.id}
              onClick={() => setEndpoint(entry.id)}
            >
              <span className="devc-endpoint__row">
                <span className="devc-method">{entry.method}</span>
                <span className="devc-endpoint__path">{entry.path}</span>
              </span>
              <span className="devc-endpoint__desc">{entry.description}</span>
            </button>
          ))}
        </div>

        <DeveloperApiConsole />
      </div>
    </section>
  );
}

function ArrowGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false">
      <path d="M3.4 10.6 10.6 3.4M5.2 3.4h5.4v5.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
