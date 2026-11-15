'use client';

import type { ReactNode } from 'react';

/**
 * The real-time telemetry HUD.
 *
 * A read-out, not a chart. Four stats, a duplex/turn-taking meter and a latency
 * pill. Every number carries its unit in text rather than relying on a
 * neighbour, and every value is set in tabular figures so a live update cannot
 * shuffle the column width.
 *
 * The latency pill takes a number and decides its own tone from it, so a
 * consumer cannot pass "fast" copy next to a slow measurement.
 */

export interface TelemetryStat {
  label: string;
  value: string;
  unit?: string;
}

export interface TelemetryHudProps {
  /** Round-trip latency in milliseconds. Drives the pill's tone. */
  latencyMs: number;
  /** Whether the session is currently carrying audio in both directions. */
  duplexing: boolean;
  /** Turn-taking phase, shown as text beside the meter. */
  turn: 'idle' | 'listening' | 'speaking';
  stats: readonly TelemetryStat[];
  className?: string;
}

/** The barge-in budget the rest of the product is measured against. */
const LATENCY_TARGET_MS = 150;

const TURN_COPY: Record<TelemetryHudProps['turn'], string> = {
  idle: 'Ingen aktiv samtale',
  listening: 'Kunden taler',
  speaking: 'Agenten taler',
};

export function TelemetryHud({
  latencyMs,
  duplexing,
  turn,
  stats,
  className,
}: TelemetryHudProps) {
  const measured = Math.max(0, Math.round(latencyMs));
  const withinTarget = measured < LATENCY_TARGET_MS;

  return (
    <div className={['conv-hud', className ?? ''].filter(Boolean).join(' ')}>
      <div className="conv-hud__top">
        <span
          className="conv-pill"
          title={`Målrettet barge-in-budget: under ${LATENCY_TARGET_MS} ms`}
        >
          <BoltGlyph />
          <span>
            {withinTarget ? '<' : ''}
            {measured} ms latenstid
          </span>
        </span>

        <span className="conv-pill">
          <span className="conv-dot" data-state={duplexing ? 'live' : 'idle'} aria-hidden="true" />
          <span>{duplexing ? 'Fuld duplex' : 'Halv duplex'}</span>
        </span>

        <span className="conv-pill">
          <span className="conv-dot" data-state={turn === 'idle' ? 'idle' : 'live'} aria-hidden="true" />
          <span>{TURN_COPY[turn]}</span>
        </span>
      </div>

      <div className="conv-stats">
        {stats.map((stat) => (
          <div className="conv-stat" key={stat.label}>
            <span className="conv-stat__label">{stat.label}</span>
            <span className="conv-stat__value">
              {stat.value}
              {stat.unit ? <span className="conv-stat__unit">{stat.unit}</span> : null}
            </span>
          </div>
        ))}
      </div>

      <div className="conv-duplex">
        <span className="conv-duplex__track" aria-hidden="true">
          <span
            className="conv-duplex__fill"
            style={{ width: duplexing ? '100%' : '50%' }}
          />
        </span>
        <span>{duplexing ? 'Audio i begge retninger' : 'Tur-vis audio'}</span>
      </div>
    </div>
  );
}

function BoltGlyph(): ReactNode {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" focusable="false">
      <path d="M5.6 0.8 2.2 5.4h2.1L4.1 9.2l3.6-4.7H5.5L5.6 0.8Z" fill="currentColor" fillOpacity="0.9" />
    </svg>
  );
}
