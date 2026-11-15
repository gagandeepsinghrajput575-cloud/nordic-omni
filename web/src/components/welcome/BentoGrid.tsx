'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { SPRING_SOFT, riseIn } from '@/lib/motion/springs';
import { BentoCard } from './BentoCard';

/**
 * The bento product ecosystem.
 *
 * Four cards, each with a small illustrated well built from monochrome
 * geometry — no screenshots, no external images, and no colour. Every fill and
 * stroke resolves from a theme token, so the whole section survives the
 * achromatic scan in `design-system.test.ts` and both themes.
 *
 * Note on the reference: the supplied screenshot (`02_bento_grid_products.png`)
 * shows the Piece 1 canvas, a "Trusted by" logo wall and a cookie banner — it
 * contains no bento grid. This layout follows the written brief instead, which
 * is the authoritative description of the four cards.
 */

const STAGGER_STEP = 0.06;

export interface BentoGridProps {
  className?: string;
}

export function BentoGrid({ className }: BentoGridProps) {
  const reduceMotion = useReducedMotion();

  return (
    <section
      className={['bento-section', 'welcome-wrap', className ?? ''].filter(Boolean).join(' ')}
      aria-labelledby="bento-heading"
    >
      <motion.div
        className="bento-head"
        variants={riseIn(reduceMotion)}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      >
        <div>
          <p className="bento-eyebrow">Platformen</p>
          <h2 className="bento-title" id="bento-heading">
            Fire systemer, én reception
          </h2>
        </div>
        <p className="bento-sub">
          Hvert modul kører selvstændigt og deler samme kundebillede, så intet lead
          falder mellem to systemer.
        </p>
      </motion.div>

      <div className="bento-grid">
        <BentoCard
          index={0}
          span="wide"
          title="Autonom AI-reception"
          blurb="Tager telefonen døgnet rundt, forstår dansk og booker direkte i kalenderen."
          glyph={<PhoneGlyph />}
          meta={<span>Live samtale · under 300 ms svartid</span>}
        >
          <ReceptionWell />
        </BentoCard>

        <BentoCard
          index={1}
          span="wide"
          title="Meta & Google Ads"
          blurb="Bygger kreative hooks og stager kampagner, så budgettet først frigives ved godkendelse."
          glyph={<TargetGlyph />}
          meta={<span>Kampagner står klar · intet budget brugt</span>}
        >
          <CampaignWell />
        </BentoCard>

        <BentoCard
          index={2}
          span="narrow"
          title="AI SEO / GEO"
          blurb="Sporer hvordan Perplexity og ChatGPT citerer dine sider — og hvor kilderne mangler."
          glyph={<GraphGlyph />}
          meta={<span>Citationsgraf · 2 kilder mangler</span>}
        >
          <CitationWell />
        </BentoCard>

        <BentoCard
          index={3}
          span="narrow"
          title="Universal inbound webhook"
          blurb="Ét endepunkt til telefoni og CRM. Signeret, idempotent og med replay-vindue."
          glyph={<WebhookGlyph />}
          meta={<span>HMAC-SHA256 · 5 min replay-vindue</span>}
        >
          <PipelineWell />
        </BentoCard>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Wells
// -----------------------------------------------------------------------------

/**
 * A CSS-driven waveform.
 *
 * The bars pulse from a single keyframe on a per-bar delay, so there is no RAF
 * loop and no state. `animation-play-state` is paused outright under reduced
 * motion (see CSS), leaving a static silhouette of the same shape.
 */
function ReceptionWell() {
  const bars = 44;
  return (
    <>
      <div className="bento-wave" data-live="true" aria-hidden="true">
        {Array.from({ length: bars }, (_, index) => {
          const envelope = 0.34 + 0.66 * Math.sin(Math.PI * (index / (bars - 1)));
          const shape = 0.2 + 0.8 * Math.abs(Math.sin(index * 1.7 + 0.6));
          const height = Math.round(Math.min(100, Math.max(8, envelope * shape * 100)));
          return (
            <span
              key={index}
              className="bento-wave__bar"
              style={{
                ['--h' as string]: `${height}%`,
                ['--d' as string]: `${(index % 9) * 90}ms`,
              }}
            />
          );
        })}
      </div>
    </>
  );
}

function CampaignWell() {
  const rows = [
    { label: 'Meta', value: 72 },
    { label: 'Google', value: 54 },
    { label: 'Retarget', value: 31 },
  ];
  return (
    <>
      <div className="bento-chips">
        <span className="bento-chip" data-tone="armed">Klar til godkendelse</span>
        <span className="bento-chip">3 hooks</span>
        <span className="bento-chip">4 annoncegrupper</span>
      </div>
      <div className="bento-bars" aria-hidden="true">
        {rows.map((row) => (
          <div className="bento-bars__row" key={row.label}>
            <span>{row.label}</span>
            <span className="bento-bars__track">
              <span className="bento-bars__fill" style={{ width: `${row.value}%` }} />
            </span>
            <span>{row.value}%</span>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * A citation graph: one hub, four sources.
 *
 * Drawn as inline SVG at a fixed viewBox so it scales without a layout pass.
 * Every class is styled from a token; the SVG carries no `fill` attribute of
 * its own, so nothing can drift chromatic.
 */
function CitationWell() {
  const sources = [
    { x: 18, y: 16, label: 'Perplexity' },
    { x: 122, y: 12, label: 'ChatGPT' },
    { x: 14, y: 66, label: 'Google' },
    { x: 118, y: 62, label: 'Bing' },
  ];
  const hub = { x: 68, y: 40 };
  return (
    <svg
      className="bento-graph"
      viewBox="0 0 140 84"
      role="img"
      aria-label="Citationsgraf: fire kilder peger på ét fælles svar"
    >
      {sources.map((source) => (
        <line
          key={`edge-${source.label}`}
          className="bento-graph__edge"
          x1={hub.x}
          y1={hub.y}
          x2={source.x}
          y2={source.y}
        />
      ))}
      {sources.map((source) => (
        <g key={source.label}>
          <circle className="bento-graph__node" cx={source.x} cy={source.y} r={5} />
          <text
            className="bento-graph__label"
            x={source.x}
            y={source.y + (source.y > hub.y ? 14 : -9)}
            textAnchor="middle"
          >
            {source.label}
          </text>
        </g>
      ))}
      <circle className="bento-graph__node" data-hub="true" cx={hub.x} cy={hub.y} r={9} />
      <text className="bento-graph__label" x={hub.x} y={hub.y + 20} textAnchor="middle">
        Svar
      </text>
    </svg>
  );
}

function PipelineWell() {
  const steps = [
    { label: 'Ind', value: 'opkald' },
    { label: 'Verify', value: 'HMAC' },
    { label: 'CRM', value: 'lead' },
  ];
  return (
    <div className="bento-pipe">
      {steps.map((step, index) => (
        <div
          className="bento-pipe__step"
          key={step.label}
          data-stage={index === steps.length - 1 ? 'final' : undefined}
        >
          <span className="bento-pipe__label">{step.label}</span>
          <span className="bento-pipe__value">{step.value}</span>
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Glyphs — 14px, currentColor, monochrome by inheritance
// -----------------------------------------------------------------------------

const glyphProps = {
  width: 14,
  height: 14,
  viewBox: '0 0 14 14',
  fill: 'none',
  'aria-hidden': true,
  focusable: 'false',
} as const;

function PhoneGlyph() {
  return (
    <svg {...glyphProps}>
      <path
        d="M3.1 1.8h2l1 2.4-1.3.9a7 7 0 0 0 3.1 3.1l.9-1.3 2.4 1v2a1.3 1.3 0 0 1-1.4 1.3A10.4 10.4 0 0 1 1.8 3.2a1.3 1.3 0 0 1 1.3-1.4Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TargetGlyph() {
  return (
    <svg {...glyphProps}>
      <circle cx="7" cy="7" r="5.2" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="7" cy="7" r="2.1" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="7" cy="7" r="0.8" fill="currentColor" />
    </svg>
  );
}

function GraphGlyph() {
  return (
    <svg {...glyphProps}>
      <circle cx="2.6" cy="3.4" r="1.6" stroke="currentColor" strokeWidth="1.05" />
      <circle cx="11.4" cy="3.4" r="1.6" stroke="currentColor" strokeWidth="1.05" />
      <circle cx="7" cy="10.8" r="1.6" stroke="currentColor" strokeWidth="1.05" />
      <path d="M4 4.4 6.2 9.4M10 4.4 7.8 9.4M4.2 3.4h5.6" stroke="currentColor" strokeWidth="1.05" />
    </svg>
  );
}

function WebhookGlyph() {
  return (
    <svg {...glyphProps}>
      <path d="M2 7h3.2M8.8 7H12" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="7" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="1.6" cy="7" r="0.9" fill="currentColor" />
      <circle cx="12.4" cy="7" r="0.9" fill="currentColor" />
    </svg>
  );
}
