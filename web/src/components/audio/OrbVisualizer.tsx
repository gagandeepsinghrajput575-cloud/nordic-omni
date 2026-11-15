'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { useTheme } from '@/lib/theme/ThemeContext';
import { BARGE_IN_BUDGET_MS, judgeLatency } from '@/lib/telephony/types';
import {
  createAnalyserRuntime,
  createMotionPreference,
  type AnalyserRuntime,
} from '@/lib/audio/visualizer-runtime';
import {
  createBloom,
  drawOrbFrame,
  parseColor,
  resolvePalette,
  clamp,
  type OrbPalette,
  type RGB,
  type VisualizerState,
} from '@/lib/audio/orb-shader';

export type { VisualizerState };

export interface OrbVisualizerProps {
  isActive?: boolean;
  state?: VisualizerState;
  audioStream?: MediaStream | null;
  size?: number;
  className?: string;
  /**
   * The barge-in verdict, when this orb is metering a live phone call.
   *
   * `latched` means the caller has interrupted and the agent is deliberately
   * silent — the ring holds its collapsed shape instead of blooming, so "the
   * receptionist stopped talking because you spoke" is visible, not implied.
   * `latencyMs` is measured caller-speech → agent-silence; `budgetMs` is the
   * tenant's own ceiling (never looser than the product's 150 ms).
   */
  bargeIn?: { latencyMs: number; budgetMs?: number; latched?: boolean; commits?: number; overBudgetCommits?: number } | null;
}

/**
 * Fallbacks used only when a token is missing from the cascade.
 *
 * The studio scale is the primary source because the orb is an instrument on
 * obsidian glass. Every fallback here is a true grey, so a missing token
 * degrades to a neutral silver ring and can never reintroduce hue.
 */
const FALLBACK = {
  accent: '#FFFFFF',
  secondary: '#A1A1AA',
  danger: '#E4E4E7',
  warning: '#A1A1AA',
  muted: '#A1A1AA',
} as const;

const NEUTRAL: RGB = [161, 161, 170];

const STATE_LABEL: Record<VisualizerState, string> = {
  idle: 'Idle',
  listening: 'Listening',
  speaking: 'Agent speaking',
  consulting: 'Consulting knowledge',
  dire_hold: 'Owner hold active',
};

export const OrbVisualizer: React.FC<OrbVisualizerProps> = ({
  isActive = false,
  state = 'idle',
  audioStream = null,
  size = 180,
  className = '',
  bargeIn = null,
}) => {
  // One computation, shared with the ledger and the pill: `judgeLatency` decides
  // the verdict here so the orb can never render "within budget" next to a meter
  // that says over.
  const verdict = bargeIn ? judgeLatency(bargeIn.latencyMs, bargeIn.budgetMs ?? BARGE_IN_BUDGET_MS) : null;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { theme } = useTheme();

  // Palette is resolved from the live cascade once per state/theme change.
  // Reading computed styles inside the render loop would force a style
  // recalculation on every frame, which is the difference between 60fps and a
  // stuttering orb on mid-range hardware.
  const palette = useMemo<OrbPalette>(() => {
    if (typeof window === 'undefined') {
      return resolvePalette(state, {
        accent: NEUTRAL,
        secondary: [91, 227, 255],
        danger: [255, 155, 147],
        warning: [255, 201, 120],
        muted: [166, 174, 190],
      });
    }
    const styles = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string, preset: RGB): RGB => {
      const value = styles.getPropertyValue(name).trim();
      return parseColor(value || fallback, preset);
    };
    return resolvePalette(state, {
      // Every fallback is a true grey, so a missing token degrades to a neutral
      // ring rather than to the retired amethyst accent.
      accent: parseColor(styles.getPropertyValue('--accent-primary').trim() || '#FFFFFF', NEUTRAL),
      secondary: read('--studio-cyan', FALLBACK.secondary, [212, 212, 216]),
      danger: read('--studio-rose', FALLBACK.danger, [228, 228, 231]),
      warning: read('--studio-amber', FALLBACK.warning, [161, 161, 170]),
      muted: read('--studio-ink-muted', FALLBACK.muted, [161, 161, 170]),
    });
    // Theme is a real dependency: a theme switch must re-read the tokens.
  }, [state, theme]);

  const paletteRef = useRef(palette);
  paletteRef.current = palette;

  // One analyser per stream, owned by the unit-tested runtime so listeners and
  // nodes are always released together (and teardown is idempotent).
  const analyserRef = useRef<AnalyserRuntime | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    if (streamRef.current === audioStream) return;
    analyserRef.current?.dispose();
    analyserRef.current = null;
    streamRef.current = audioStream;
    if (!audioStream) return;
    analyserRef.current = createAnalyserRuntime(audioStream);
    return () => {
      analyserRef.current?.dispose();
      analyserRef.current = null;
    };
  }, [audioStream]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const bands = new Uint8Array(32);
    const ring = new Float32Array(48);
    let amplitude = 0;
    let spin = 0;
    let phase = 0;
    let last = 0;
    let frame = 0;
    let running = false;
    const bloomCache = new Map<string, HTMLCanvasElement>();

    const bloomFor = (current: OrbPalette): HTMLCanvasElement | null => {
      const key = current.halo.join(',');
      const cached = bloomCache.get(key);
      if (cached) return cached;
      const sprite = createBloom(current.halo);
      if (sprite) bloomCache.set(key, sprite);
      return sprite;
    };

    const sampleBands = (): number => {
      const runtime = analyserRef.current;
      if (!runtime) return 0;
      runtime.analyser.getByteFrequencyData(bands);
      let total = 0;
      for (let i = 0; i < bands.length; i += 1) {
        const normalised = bands[i] / 255;
        total += normalised * normalised;
      }
      return Math.min(1, Math.sqrt(total / bands.length) * 2.1);
    };

    const paint = (delta: number, animate: boolean) => {
      const current = paletteRef.current;
      const goal = isActive ? Math.max(sampleBands(), current.rest * 0.7) : current.rest * 0.35;

      // Frame-rate independent attack/release envelope: fast on speech onset,
      // slower on decay, so the orb breathes instead of twitching.
      const rate = goal > amplitude ? 9 : 3.4;
      amplitude += (goal - amplitude) * (1 - Math.exp(-rate * delta));

      if (animate) {
        spin += delta * 0.16;
        phase += delta * (0.8 + amplitude * 1.9);
      }

      drawOrbFrame(ctx, {
        size,
        dpr,
        state,
        palette: current,
        amplitude,
        phase,
        spin,
        animate,
        ring,
        bands: analyserRef.current ? bands : null,
        bloom: bloomFor(current),
        smoothing: 1 - Math.exp(-8 * delta),
      });
    };

    const tick = (now: number) => {
      if (!running) return;
      frame = requestAnimationFrame(tick);
      const delta = last === 0 ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
      // Pace to roughly 60fps; slower displays simply receive a larger delta.
      if (last !== 0 && now - last < 14) return;
      last = now;
      paint(delta, true);
    };

    const start = () => {
      if (running || motion.reduced) return;
      running = true;
      last = 0;
      frame = requestAnimationFrame(tick);
    };

    const stop = () => {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };

    /** One deterministic frame for reduced-motion users. */
    const paintStatic = () => {
      stop();
      paint(1 / 60, false);
    };

    // prefers-reduced-motion is honoured through the shared runtime, which also
    // re-renders if the visitor flips the preference mid-session.
    const motion = createMotionPreference(() => {
      if (motion.reduced) paintStatic();
      else start();
    });

    // A hidden tab must not burn a GPU core; visibility re-enters cleanly.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
      else if (motion.reduced) paintStatic();
      else start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    if (motion.reduced) paintStatic();
    else start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      motion.dispose();
      bloomCache.clear();
    };
  }, [size, isActive, state]);

  const latched = Boolean(bargeIn?.latched);
  const label = latched ? 'Barge-in latched' : STATE_LABEL[state];
  const readout = verdict
    ? `${verdict.measuredMs} ms of ${verdict.budgetMs} ms budget · ${
        verdict.withinBudget ? 'within' : `${verdict.overByMs} ms over`
      }${bargeIn?.commits ? ` · ${bargeIn.commits} interruption${bargeIn.commits === 1 ? '' : 's'}` : ''}${
        bargeIn?.overBudgetCommits ? `, ${bargeIn.overBudgetCommits} too slow` : ''
      }`
    : null;

  return (
    <div className={`studio-orb relative flex items-center justify-center ${className}`.trim()}>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        role="img"
        aria-label={`${label} — audio visualiser${readout ? ` · ${readout}` : ''}`}
        className="block rounded-full"
        style={{ width: `${size}px`, height: `${size}px` }}
      />
      {state === 'dire_hold' ? <span className="pill pill-danger absolute -bottom-2">Hold for owner</span> : null}
      {/* An over-budget barge-in is a defect the operator can hear, so it is
          labelled on the orb itself rather than left in a telemetry panel. The
          pill appears only on a violation; a healthy call stays quiet. */}
      {verdict && !verdict.withinBudget ? (
        <span className="pill pill-danger absolute -top-2 mono" role="status">
          barge-in {verdict.measuredMs}ms · +{verdict.overByMs}ms over budget
        </span>
      ) : null}
    </div>
  );
};
