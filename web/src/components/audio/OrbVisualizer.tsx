'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { useTheme } from '@/lib/theme/ThemeContext';
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
}

/**
 * Fallbacks used only when a token is missing from the cascade.
 *
 * The studio pigments are the primary source because the orb is an instrument
 * on obsidian glass: they are fixed, bright, and legible in both themes. The
 * warm shell's accent is only a last resort, since a dark accent (#7C3AED)
 * would turn the ring into a muddy silhouette.
 */
const FALLBACK = {
  accent: '#7C3AED',
  secondary: '#5BE3FF',
  danger: '#FF9B93',
  warning: '#FFC978',
  muted: '#A6AEBE',
} as const;

const VIOLET: RGB = [169, 140, 255];

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
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { theme } = useTheme();

  // Palette is resolved from the live cascade once per state/theme change.
  // Reading computed styles inside the render loop would force a style
  // recalculation on every frame, which is the difference between 60fps and a
  // stuttering orb on mid-range hardware.
  const palette = useMemo<OrbPalette>(() => {
    if (typeof window === 'undefined') {
      return resolvePalette(state, {
        accent: VIOLET,
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
      // The historical product accent is the last-resort fallback.
      accent: parseColor(styles.getPropertyValue('--accent-primary').trim() || '#7C3AED', VIOLET),
      secondary: read('--studio-cyan', FALLBACK.secondary, [91, 227, 255]),
      danger: read('--studio-rose', FALLBACK.danger, [255, 155, 147]),
      warning: read('--studio-amber', FALLBACK.warning, [255, 201, 120]),
      muted: read('--studio-ink-muted', FALLBACK.muted, [166, 174, 190]),
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

  const label = STATE_LABEL[state];

  return (
    <div className={`studio-orb relative flex items-center justify-center ${className}`.trim()}>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        role="img"
        aria-label={`${label} — audio visualiser`}
        className="block rounded-full"
        style={{ width: `${size}px`, height: `${size}px` }}
      />
      {state === 'dire_hold' ? <span className="pill pill-danger absolute -bottom-2">Hold for owner</span> : null}
    </div>
  );
};
