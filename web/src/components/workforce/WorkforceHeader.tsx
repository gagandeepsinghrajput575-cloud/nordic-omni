'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { SPRING, springFor } from '@/lib/motion/springs';
import type { OrchestratorMetric } from '@/lib/workforce/roster';

/**
 * The orchestrator HUD.
 *
 * Four telemetry cells and a simulation toggle. The figures are props — this
 * component holds no clock and starts no poller, so mounting it in a prototype
 * cannot imply a live feed it does not have.
 *
 * The toggle is a real `aria-pressed` button; the spring only moves the thumb,
 * so the state is legible with motion disabled.
 */

export interface WorkforceHeaderProps {
  metrics: ReadonlyArray<OrchestratorMetric>;
  /** Human-readable count of pods currently working. */
  activePods: number;
  totalPods: number;
  simulating: boolean;
  onToggleSimulation: () => void;
}

export function WorkforceHeader({
  metrics,
  activePods,
  totalPods,
  simulating,
  onToggleSimulation,
}: WorkforceHeaderProps) {
  const reduceMotion = useReducedMotion();

  return (
    <section className="wfhud" aria-labelledby="wf-orchestrator-title">
      <div className="wfhud__row">
        <span className="wfhud__mark" aria-hidden="true">
          <OrchestratorGlyph />
        </span>

        <div className="wfhud__id">
          <div className="wfhud__name" id="wf-orchestrator-title">
            General Partner AI
            <span className="wf-live">
              <span className="wf-dot" data-state="live" aria-hidden="true" />
              Orkestrator
            </span>
          </div>
          <p className="wfhud__sub">
            Fordeler opgaver til {totalPods} specialister · {activePods} arbejder nu
          </p>
        </div>

        <div className="wfhud__mode">
          <button
            type="button"
            className="wf-toggle"
            aria-pressed={simulating}
            onClick={onToggleSimulation}
          >
            <span className="wf-toggle__track" aria-hidden="true">
              <motion.span
                className="wf-toggle__thumb"
                initial={false}
                animate={{ x: simulating ? 16 : 0 }}
                transition={springFor(reduceMotion, SPRING)}
              />
            </span>
            {simulating ? 'Simulering til' : 'Simulering fra'}
          </button>
        </div>
      </div>

      <div className="wfhud__metrics">
        {metrics.map((metric) => (
          <div className="wfhud__metric" key={metric.label}>
            <span className="wfhud__metric-label">{metric.label}</span>
            <span className="wfhud__metric-value">
              {metric.value}
              {metric.unit ? <span className="wfhud__metric-unit">{metric.unit}</span> : null}
            </span>
          </div>
        ))}
      </div>

      <p className="wfhud__sub" role="note">
        Prototype · alle tal er faste eksempelværdier, ikke en live-feed.
        {simulating ? ' Simulering er slået til.' : ''}
      </p>
    </section>
  );
}

function OrchestratorGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="2.4" r="1.4" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="8" cy="13.6" r="1.4" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="2.4" cy="8" r="1.4" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="13.6" cy="8" r="1.4" stroke="currentColor" strokeWidth="1.1" />
      <path d="M8 3.8v1.8M8 10.4v1.8M3.8 8h1.8M10.4 8h1.8" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}
