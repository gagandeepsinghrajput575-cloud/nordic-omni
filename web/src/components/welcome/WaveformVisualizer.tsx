'use client';

import { useCallback, useMemo, useRef } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * The studio waveform.
 *
 * Deliberately dumb about time: it owns no clock. `playhead` is controlled by
 * `StudioPlaygroundCard`, which also drives the transport button, so the
 * playhead and the button can never disagree about whether audio is playing.
 *
 * Two render paths:
 *  - default: bars whose height transitions over 90ms linear. Height is not a
 *    layout property of the page (the bars are absolutely sized by flex), so
 *    the animation stays on the compositor-friendly path.
 *  - `prefers-reduced-motion`: a single static SVG silhouette built from the
 *    same amplitude data. Identical shape, zero movement.
 *
 * Accessibility: the visual row is `aria-hidden`; the scrub affordance is a
 * separate `role="slider"` with a keyboard handler (arrows, Home, End), so a
 * keyboard or screen-reader user can seek without seeing the bars at all.
 */

export interface WaveformVisualizerProps {
  /** Pre-smoothed 0..1 levels. Omitted → a deterministic sine spine is used. */
  levels?: readonly number[];
  /** Bars rendered. Clamped 4..96. */
  bars?: number;
  /** Playback state machine, owned by the card. */
  state: 'idle' | 'playing' | 'paused' | 'buffering';
  /** 0..1 position of the playhead. */
  playhead: number;
  /** Fires while scrubbing, with a 0..1 ratio. */
  onScrub?: (ratio: number) => void;
  /** Accessible name for the slider. */
  label?: string;
  className?: string;
}

const MIN_BARS = 4;
const MAX_BARS = 96;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * The idle silhouette.
 *
 * Two incommensurate sines plus a centre-weighted envelope: organic, and — more
 * importantly — deterministic, so the server and client markup agree and there
 * is no hydration mismatch.
 */
function spineAt(index: number, count: number): number {
  const position = index / Math.max(1, count - 1);
  const envelope = 0.34 + 0.66 * Math.sin(Math.PI * position);
  const a = Math.abs(Math.sin(index * 1.7 + 0.6));
  const b = Math.abs(Math.cos(index * 0.53 + 0.2));
  return clamp01(envelope * (0.18 + 0.82 * (a * 0.62 + b * 0.38)));
}

function resample(levels: readonly number[], count: number): number[] {
  if (levels.length === 0) return new Array<number>(count).fill(0);
  if (levels.length === count) return levels.map(clamp01);
  const out = new Array<number>(count);
  for (let i = 0; i < count; i += 1) {
    const position = (i / Math.max(1, count - 1)) * (levels.length - 1);
    const low = Math.floor(position);
    const high = Math.min(levels.length - 1, low + 1);
    const mix = position - low;
    out[i] = clamp01(levels[low] * (1 - mix) + levels[high] * mix);
  }
  return out;
}

export function WaveformVisualizer({
  levels,
  bars = 56,
  state,
  playhead,
  onScrub,
  label = 'Playback position',
  className,
}: WaveformVisualizerProps) {
  const reduceMotion = useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const count = Math.max(MIN_BARS, Math.min(MAX_BARS, Math.round(bars)));
  const position = clamp01(playhead);

  const amplitudes = useMemo(() => {
    if (levels && levels.length > 0) return resample(levels, count);
    return Array.from({ length: count }, (_, index) => spineAt(index, count));
  }, [levels, count]);

  const seekTo = useCallback(
    (clientX: number) => {
      const node = trackRef.current;
      if (!node || !onScrub) return;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0) return;
      onScrub(clamp01((clientX - rect.left) / rect.width));
    },
    [onScrub],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!onScrub) return;
      // Capture so a drag that leaves the track keeps scrubbing.
      event.currentTarget.setPointerCapture(event.pointerId);
      seekTo(event.clientX);
    },
    [onScrub, seekTo],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      seekTo(event.clientX);
    },
    [seekTo],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!onScrub) return;
      const step = 0.05;
      const map: Record<string, number | undefined> = {
        ArrowRight: position + step,
        ArrowLeft: position - step,
        Home: 0,
        End: 1,
      };
      const next = map[event.key];
      if (next === undefined) return;
      event.preventDefault();
      onScrub(clamp01(next));
    },
    [onScrub, position],
  );

  const stateLabel = {
    idle: 'Idle',
    playing: 'Playing',
    paused: 'Paused',
    buffering: 'Buffering',
  }[state];

  return (
    <div
      ref={trackRef}
      className={['wave-visual', className ?? ''].filter(Boolean).join(' ')}
      data-state={state}
      role="slider"
      tabIndex={0}
      aria-label={`${label}, ${stateLabel}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(position * 100)}
      aria-valuetext={`${Math.round(position * 100)} percent`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onKeyDown={handleKeyDown}
    >
      {reduceMotion ? (
        <svg
          className="wave-static"
          viewBox={`0 0 ${count} 100`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d={amplitudes
              .map((amplitude, index) => {
                // A 1-unit-wide column per bar, centred vertically.
                const height = Math.max(6, amplitude * 100);
                const top = (100 - height) / 2;
                return `M${index + 0.15} ${top}h0.7v${height}h-0.7Z`;
              })
              .join(' ')}
          />
        </svg>
      ) : (
        <>
          <span aria-hidden="true" className="sr-only">
            {stateLabel}
          </span>
          {amplitudes.map((amplitude, index) => {
            const played = index / Math.max(1, count - 1) <= position;
            const style: CSSProperties = {
              ['--h' as string]: `${Math.max(6, Math.min(100, amplitude * 100))}%`,
            };
            return (
              <span
                key={index}
                className="wave-bar"
                data-played={played ? 'true' : 'false'}
                style={style}
                aria-hidden="true"
              />
            );
          })}
          <span
            className="wave-playhead"
            style={{ left: `${position * 100}%` }}
            aria-hidden="true"
          />
        </>
      )}
    </div>
  );
}
