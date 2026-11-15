'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { SPRING, springFor } from '@/lib/motion/springs';
import { GlidingTabSwitcher, type TabOption } from './GlidingTabSwitcher';
import { WaveformVisualizer } from './WaveformVisualizer';

/**
 * The interactive studio canvas.
 *
 * Audio: this is a labelled simulation, exactly like `VoicePlayground`. There is
 * no audio element and no network call — the card runs a requestAnimationFrame
 * clock that advances the playhead, and the transport button reports the
 * simulated state in text. Shipping a fake "playing" affordance without that
 * label would be a lie about what the product does.
 *
 * Clock: one RAF loop, owned here, cancelled on unmount and whenever the state
 * leaves `playing`. The waveform receives `playhead` as a prop and holds no
 * timer of its own.
 *
 * Reduced motion: the gliding thumb snaps (`SPRING` resolves to duration 0),
 * tiles do not fade, and the waveform swaps to a static SVG silhouette.
 */

export type StudioMode = 'speech' | 'agent' | 'studio';

export interface StudioTile {
  id: string;
  title: string;
  caption: string;
  /** Monochrome ramp stop, 0 = faintest. Drives size and lift only. */
  ramp: 0 | 1 | 2 | 3;
  /** The featured tile is larger and carries the inline play affordance. */
  featured?: boolean;
}

export interface StudioPlaygroundCardProps {
  modes: ReadonlyArray<TabOption<StudioMode>>;
  mode: StudioMode;
  onModeChange: (next: StudioMode) => void;
  /** Tiles for the currently selected mode. */
  tiles: readonly StudioTile[];
  /** Simulated clip length in seconds. */
  durationSeconds?: number;
  className?: string;
}

const TICK_MS = 1000 / 60;

export function StudioPlaygroundCard({
  modes,
  mode,
  onModeChange,
  tiles,
  durationSeconds = 24,
  className,
}: StudioPlaygroundCardProps) {
  const reduceMotion = useReducedMotion();
  const [state, setState] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [playhead, setPlayhead] = useState(0);
  const frameRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);

  const stopClock = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    lastRef.current = null;
  }, []);

  useEffect(() => {
    if (state !== 'playing') {
      stopClock();
      return;
    }

    const step = (now: number) => {
      const last = lastRef.current ?? now;
      const delta = now - last;
      lastRef.current = now;
      setPlayhead((current) => {
        const advanced = current + delta / (durationSeconds * 1000);
        if (advanced >= 1) {
          // Reaching the end parks the transport rather than looping silently.
          setState('paused');
          return 1;
        }
        return advanced;
      });
      frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
    return stopClock;
  }, [state, durationSeconds, stopClock]);

  useEffect(() => stopClock, [stopClock]);

  const toggle = useCallback(() => {
    setState((current) => {
      if (current === 'playing') return 'paused';
      // Restart from the top when the clip has finished.
      if (playhead >= 1) setPlayhead(0);
      return 'playing';
    });
  }, [playhead]);

  const scrub = useCallback(
    (ratio: number) => {
      setPlayhead(Math.min(1, Math.max(0, ratio)));
      // Seeking is a deliberate stop, so pause rather than chase the new spot.
      setState((current) => (current === 'playing' ? 'paused' : current));
    },
    [],
  );

  const seconds = Math.round(playhead * durationSeconds);
  const timeLabel = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const totalLabel = `00:${String(durationSeconds % 60).padStart(2, '0')}`;
  const visualState = state === 'playing' ? 'playing' : playhead > 0 ? 'paused' : 'idle';
  const activeMode = modes.find((option) => option.value === mode)?.label ?? 'Studio';

  return (
    <section
      className={['studio-card', className ?? ''].filter(Boolean).join(' ')}
      aria-labelledby="studio-card-title"
    >
      <div className="studio-card-head">
        <GlidingTabSwitcher
          options={modes}
          value={mode}
          onChange={onModeChange}
          label="Studio mode"
        />
      </div>

      <div className="studio-card-body">
        <h2 id="studio-card-title" className="sr-only">
          {activeMode} preview
        </h2>

        {/* Tiles swap with a short cross-fade. AnimatePresence is left out on
            purpose: the mode change is instant and the tiles share a grid, so a
            fade would fight the spring on the thumb. Only opacity is animated. */}
        <div className="studio-tiles">
          {tiles.map((tile) => (
            <div className="studio-tile" key={`${mode}-${tile.id}`}>
              <motion.div
                className="studio-tile-orb"
                data-ramp={tile.ramp}
                initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={springFor(reduceMotion, SPRING)}
                aria-hidden="true"
              >
                {tile.featured ? (
                  <button
                    type="button"
                    className="studio-play"
                    onClick={toggle}
                    aria-label={state === 'playing' ? 'Pause preview' : 'Play preview'}
                  >
                    {state === 'playing' ? <PauseGlyph /> : <PlayGlyph />}
                  </button>
                ) : null}
              </motion.div>
              <div className="studio-tile-title">{tile.title}</div>
              <div className="studio-tile-caption">{tile.caption}</div>
            </div>
          ))}
        </div>

        <div className="studio-transport">
          {tiles.some((tile) => tile.featured) ? null : (
            <button
              type="button"
              className="studio-play"
              onClick={toggle}
              aria-label={state === 'playing' ? 'Pause preview' : 'Play preview'}
            >
              {state === 'playing' ? <PauseGlyph /> : <PlayGlyph />}
            </button>
          )}

          <div className="studio-transport-meta">
            <span className="studio-transport-mode">{activeMode}</span>
            <span className="studio-transport-time" aria-live="off">
              {timeLabel} / {totalLabel}
            </span>
          </div>

          <WaveformVisualizer
            state={visualState}
            playhead={playhead}
            onScrub={scrub}
            label={`${activeMode} playback position`}
          />

          <span className="studio-mock-note">Simulated preview · no audio</span>
        </div>
      </div>
    </section>
  );
}

/**
 * The play/pause glyphs.
 *
 * `AnimatePresence` is intentionally absent: the morph is a hard swap between
 * two static SVG paths, which reads as instant at 46px and is trivially safe
 * under reduced motion (there is nothing to suppress).
 */
function PlayGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false">
      <path d="M4.6 2.1a.7.7 0 0 1 1.07-.6l6.1 4.1a.7.7 0 0 1 0 1.17l-6.1 4.1a.7.7 0 0 1-1.07-.58V2.1Z" fill="currentColor" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false">
      <rect x="3.4" y="2.2" width="2.6" height="9.6" rx="0.9" fill="currentColor" />
      <rect x="8" y="2.2" width="2.6" height="9.6" rx="0.9" fill="currentColor" />
    </svg>
  );
}
