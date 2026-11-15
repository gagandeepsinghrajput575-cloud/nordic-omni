'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { GlidingTabSwitcher } from '@/components/welcome/GlidingTabSwitcher';
import { SPRING, springFor } from '@/lib/motion/springs';
import {
  NEXT_DISPATCH_STATE,
  probeCitations,
  rebalanceCbo,
  simulateCall,
  synthesizeAngles,
  type AngleSynthesisResult,
  type CallSimulationResult,
  type CboRebalanceResult,
  type CitationProbeResult,
  type DispatchRunnerId,
  type DispatchState,
} from '@/lib/workforce/simulation';

/**
 * The dispatch console.
 *
 * Four runners, one per AI employee. Each is driven by the pure functions in
 * `lib/workforce/simulation.ts`, so what the operator sees is a deterministic
 * replay of a seeded computation rather than a fake network call.
 *
 * Timing: a runner goes idle → running → done on a single `setTimeout` that is
 * cleared on unmount and on re-dispatch. Nothing polls, and no runner keeps
 * working after the operator leaves.
 *
 * The whole console is labelled a simulation. If a runner could be mistaken for
 * a real dispatch, the work order would be worse than useless — it would be
 * misleading.
 */

export type RunnerId = DispatchRunnerId;

const RUNNERS: ReadonlyArray<{ value: RunnerId; label: string }> = [
  { value: 'creative', label: 'Creative' },
  { value: 'paid-media', label: 'Paid media' },
  { value: 'seo-geo', label: 'SEO / GEO' },
  { value: 'voice', label: 'Reception' },
];

/** How long a runner shows "arbejder" before its result lands. */
const RUN_MS = 900;

export interface DispatchSimulationConsoleProps {
  /**
   * Called once a runner finishes, with the runner id and the wall-clock time
   * the run completed. The parent owns the feed, so this component reports
   * rather than appending to shared state itself.
   */
  onDispatched?: (runner: RunnerId) => void;
  className?: string;
}

export function DispatchSimulationConsole({
  onDispatched,
  className,
}: DispatchSimulationConsoleProps) {
  const reduceMotion = useReducedMotion();
  const [runner, setRunner] = useState<RunnerId>('creative');
  const [state, setState] = useState<DispatchState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const dispatch = useCallback(() => {
    clearTimer();
    if (state === 'done') {
      // "Kør igen" clears back to idle so the result is replaced, not stacked.
      setState('idle');
      return;
    }
    if (state === 'running') return;
    setState('running');
    timerRef.current = setTimeout(() => {
      setState('done');
      // Report on completion, not on click: the feed should record what ran,
      // not what was requested.
      onDispatched?.(runner);
    }, RUN_MS);
  }, [clearTimer, onDispatched, runner, state]);

  const choose = useCallback(
    (next: RunnerId) => {
      clearTimer();
      setState('idle');
      setRunner(next);
    },
    [clearTimer],
  );

  const meta = NEXT_DISPATCH_STATE[state];

  return (
    <div className={['dsc', className ?? ''].filter(Boolean).join(' ')}>
      <div className="dsc__tabs">
        <GlidingTabSwitcher
          options={RUNNERS}
          value={runner}
          onChange={choose}
          label="Vælg AI-medarbejder"
        />
      </div>

      <div className="dsc__panel">
        <div className="dsc__panel-head">
          <h3 className="dsc__panel-title">{PANEL_TITLE[runner]}</h3>
          <button
            type="button"
            className="dsc__run"
            onClick={dispatch}
            disabled={state === 'running'}
            aria-live="off"
          >
            {state === 'running' ? <SpinnerGlyph /> : null}
            {meta.label}
          </button>
        </div>

        <p className="dsc__panel-sub">{PANEL_SUB[runner]}</p>

        {state !== 'done' ? (
          <div className="dsc__empty" role="status">
            {state === 'running'
              ? 'Dispatcherer til specialisten… (simulering)'
              : 'Ingen test-dispatch kørt endnu. Tryk “Kør test-dispatch”.'}
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${runner}-result`}
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={springFor(reduceMotion, SPRING)}
            >
              {runner === 'creative' ? <CreativeResult /> : null}
              {runner === 'paid-media' ? <PaidMediaResult /> : null}
              {runner === 'seo-geo' ? <SeoResult /> : null}
              {runner === 'voice' ? <VoiceResult /> : null}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      <p className="dsc__panel-sub" role="note">
        Simulering · ingen agent kaldes, ingen API-kald sendes, intet budget flyttes.
      </p>
    </div>
  );
}

const PANEL_TITLE: Record<RunnerId, string> = {
  creative: 'Creative Director AI · vinkelsyntese',
  'paid-media': 'Paid Media Specialist AI · CBO-rebalancering',
  'seo-geo': 'AI SEO & GEO Specialist AI · citationsprøve',
  voice: 'Voice Receptionist AI · opkaldssimulering',
};

const PANEL_SUB: Record<RunnerId, string> = {
  creative: 'Fem formaterede hooks, ét per vinkel, med en styrkescore.',
  'paid-media': 'Fordeler den daglige ramme på ny inden for CBO-loftet.',
  'seo-geo': 'Prøver hvordan Perplexity, ChatGPT og Google citerer kunden.',
  voice: 'Afspiller et optaget forløb med bølgeform og transskription.',
};

// -----------------------------------------------------------------------------
// 1. Creative
// -----------------------------------------------------------------------------

function CreativeResult() {
  const result: AngleSynthesisResult = synthesizeAngles('facaderens i København');
  return (
    <div className="dsc" style={{ gap: 10 }}>
      <p className="dsc__panel-sub">
        Emne: <strong>{result.subject}</strong> · gennemsnitlig styrke{' '}
        {Math.round(result.averageStrength * 100)} %
      </p>
      <ul className="hooks">
        {result.hooks.map((hook) => (
          <li className="hook" key={hook.id}>
            <span className="hook__angle">{hook.angle}</span>
            <span className="hook__text">{hook.text}</span>
            <span className="hook__strength">
              <span className="hook__bar" aria-hidden="true">
                <span style={{ width: `${Math.round(hook.strength * 100)}%` }} />
              </span>
              <span className="hook__pct">{Math.round(hook.strength * 100)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 2. Paid media
// -----------------------------------------------------------------------------

function PaidMediaResult() {
  const result: CboRebalanceResult = rebalanceCbo([
    { channel: 'Meta', spend: 1200 },
    { channel: 'Google', spend: 800 },
    { channel: 'Retarget', spend: 400 },
  ]);
  const max = Math.max(...result.lines.map((line) => Math.max(line.before, line.after)), 1);

  return (
    <div className="budget">
      {result.lines.map((line) => (
        <div className="budget__row" key={line.channel}>
          <span className="budget__channel">{line.channel}</span>
          <span className="budget__bars">
            <span className="budget__track">
              <span
                className="budget__fill"
                data-phase="before"
                style={{ width: `${(line.before / max) * 100}%` }}
              />
            </span>
            <span className="budget__track">
              <span
                className="budget__fill"
                data-phase="after"
                style={{ width: `${(line.after / max) * 100}%` }}
              />
            </span>
          </span>
          <span className="budget__values">
            <s>{line.before} kr</s> → {line.after} kr
          </span>
        </div>
      ))}

      <div className="budget__foot">
        <span>
          I alt {result.totalBefore} → {result.totalAfter} kr/dag
        </span>
        <span style={{ marginLeft: 'auto' }}>
          {result.withinCeiling
            ? `Inden for loftet på ${result.ceiling} kr`
            : `Over loftet på ${result.ceiling} kr`}
        </span>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 3. SEO / GEO
// -----------------------------------------------------------------------------

function SeoResult() {
  const result: CitationProbeResult = probeCitations('ai telefonreception danmark');
  // A 72px-radius arc, drawn as a dash offset on a circle.
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const filled = (result.score / 100) * circumference;

  return (
    <div className="dsc" style={{ gap: 12 }}>
      <div className="gauge">
        <div className="gauge__dial">
          <svg viewBox="0 0 104 104" width="104" height="104" aria-hidden="true" focusable="false">
            <circle cx="52" cy="52" r={radius} fill="none" stroke="var(--line)" strokeWidth="5" />
            <circle
              cx="52"
              cy="52"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={`${filled} ${circumference}`}
              transform="rotate(-90 52 52)"
              style={{ color: 'var(--text)' }}
            />
          </svg>
          <span className="gauge__value">
            <span className="gauge__score">{result.score}</span>
            <span className="gauge__band">{result.band}</span>
          </span>
        </div>

        <ul className="cite-list">
          {result.sources.map((source) => (
            <li className="cite" key={source.engine} data-cited={source.cited ? 'true' : 'false'}>
              <span className="cite__engine">{source.engine}</span>
              <span className="cite__pos">
                {source.cited ? `citeret · #${source.position}` : 'ikke citeret'}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <ul className="gaps">
        {result.gaps.map((gap) => (
          <li key={gap}>{gap}</li>
        ))}
      </ul>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 4. Voice reception
// -----------------------------------------------------------------------------

function VoiceResult() {
  const result: CallSimulationResult = simulateCall();
  // The transcript is revealed by the same playhead as the waveform, so the
  // text and the audio-simulation cannot disagree about where the call is.
  const [playhead, setPlayhead] = useState(0);

  useEffect(() => {
    let frame = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      start ??= now;
      const progress = Math.min(1, (now - start) / (result.durationMs / 2));
      setPlayhead(progress);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [result.durationMs]);

  const revealed = result.transcript.filter((turn) => turn.atMs / result.durationMs <= playhead);

  return (
    <div className="call">
      <div className="call__wave" aria-hidden="true">
        {result.waveform.map((amplitude, index) => (
          <span
            key={index}
            className="call__bar"
            data-played={index / result.waveform.length <= playhead ? 'true' : 'false'}
            style={{ ['--h' as string]: `${Math.max(8, amplitude * 100)}%` }}
          />
        ))}
      </div>

      <p className="dsc__panel-sub">
        Varighed {(result.durationMs / 1000).toFixed(1)} s · svartid {result.latencyMs} ms ·
        udfald <strong>{result.outcome}</strong>
      </p>

      <ol className="transcript" aria-live="polite" aria-label="Transskription">
        {revealed.map((turn) => (
          <li className="turn" key={turn.id} data-speaker={turn.speaker}>
            <span className="turn__who">{turn.speaker}</span>
            <span className="turn__text">{turn.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SpinnerGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false">
      <circle cx="6" cy="6" r="4.4" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.4" />
      <path d="M6 1.6A4.4 4.4 0 0 1 10.4 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
