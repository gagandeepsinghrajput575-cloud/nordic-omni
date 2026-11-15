"use client";

import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { VoiceState } from "@/lib/types";
import { useAudioBands } from "@/lib/audio/useAudioBands";
import { css, rampAt, type RGB } from "@/lib/audio/orb-shader";
import { useTheme } from "@/lib/theme/ThemeContext";

interface WaveformProps {
  active?: boolean;
  bars?: number;
  tone?: "accent" | "muted" | "danger";
  className?: string;
}

/**
 * Additive, backwards-compatible surface of the waveform.
 *
 * `Waveform` stays a pure geometry renderer when nothing is wired: `bars`,
 * `tone` and `active` are enough. When a caller has a real stream or already
 * smoothed levels, those drive the geometry instead of a decorative pattern.
 */
export interface WaveformSpectrumProps extends WaveformProps {
  /** Pre-smoothed 0..1 levels, e.g. from `useAudioBands`. */
  levels?: readonly number[];
  /** A MediaStream to analyse directly; ignored when `levels` is supplied. */
  audioStream?: MediaStream | null;
}

const TONE_TO_ATTR = { accent: "accent", muted: "muted", danger: "danger" } as const;

/**
 * The studio ramp, in the same order as `--studio-iri` in globals.css — a
 * monochrome silver scale. Every stop is a true grey (R = G = B), so the
 * waveform disperses white light and cannot drift into hue.
 *
 * Brightness still travels across the sequence rather than repeating per bar,
 * which keeps the spectrum legible without colour.
 */
const STUDIO_RAMP: readonly RGB[] = [
  [255, 255, 255],
  [228, 228, 231],
  [190, 190, 196],
  [161, 161, 170],
];

/**
 * The same ramp inverted for the light theme.
 *
 * White bars are invisible on paper, so the sequence runs from near-black to
 * mid zinc: `#09090b` -> `#27272a`, exactly the ink the light spec asks for.
 * It stays a true-grey sequence, so the waveform is still achromatic — only its
 * direction changes.
 */
const PAPER_RAMP: readonly RGB[] = [
  [9, 9, 11],
  [39, 39, 42],
  [63, 63, 70],
  [82, 82, 91],
];

/**
 * A per-bar monochrome gradient. Varying brightness by index is what makes the
 * waveform read as a real spectrum; a single repeated gradient reads as a slab.
 * The bars keep a translucent-to-solid falloff so they still look like glass.
 */
function barGradient(progress: number, ramp: readonly RGB[]): string {
  const colour = rampAt(ramp, 0.04 + progress * 0.9);
  return `linear-gradient(180deg, ${css(colour, 0.98)} 0%, ${css(colour, 0.7)} 46%, ${css(colour, 0.24)} 100%)`;
}

/**
 * A deterministic "spine" for the idle/preview waveform.
 *
 * Two incommensurate sines give an organic, non-repeating silhouette without a
 * random source, so server and client markup always agree.
 */
function spineAt(index: number): number {
  const a = Math.abs(Math.sin(index * 1.7 + 0.6));
  const b = Math.abs(Math.cos(index * 0.53 + 0.2));
  return 0.22 + 0.78 * (a * 0.62 + b * 0.38);
}

/** A cylinder envelope: full height in the middle, tapered at the edges. */
function envelopeAt(progress: number): number {
  return 0.42 + 0.58 * Math.sin(Math.PI * Math.min(1, Math.max(0, progress)));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Resample arbitrary levels to `count` bars with linear interpolation, so a
 * 32-band analyser and a 64-bar display still meet cleanly.
 */
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

export function Waveform({
  active = true,
  bars = 48,
  tone = "accent",
  className,
  levels,
  audioStream = null,
}: WaveformSpectrumProps) {
  const { theme } = useTheme();
  // Studio surfaces stay obsidian in both themes, so the bright ramp is the
  // default; only a paper-white ground needs the inverted one.
  const ramp = theme === "light" ? PAPER_RAMP : STUDIO_RAMP;
  const count = Math.max(4, Math.min(128, Math.round(bars)));
  const analysed = levels !== undefined && levels.length > 0;
  // Hooks are unconditional: the analyser only runs when a stream exists.
  const streamLevels = useAudioBands(levels === undefined ? audioStream : null, 32);
  const source = levels ?? streamLevels;
  const driven = analysed || audioStream !== null;

  const heights = useMemo(() => {
    const sampled = driven ? resample(source, count) : null;
    return Array.from({ length: count }, (_, index) => {
      const envelope = envelopeAt(index / Math.max(1, count - 1));
      const shape = spiritOf(index, sampled);
      const value = active ? envelope * shape : envelope * shape * 0.34 + 0.06;
      return Math.round(clamp01(value) * 1000) / 10;
    });
  }, [active, count, driven, source]);

  const shellClass = ["wave-shell", driven && active ? "is-analysed" : "", className ?? ""].filter(Boolean).join(" ");

  return (
    <div className={shellClass} aria-hidden="true">
      {!active ? <span className="wave-idle-rule" /> : null}
      <div className="wave-bars">
        {heights.map((height, index) => {
          const style: CSSProperties = {
            height: `${Math.max(6, Math.min(100, height))}%`,
            // Only the accent tone carries the ramp; muted and danger stay flat
            // so their meaning is never confused with energy.
            ...(tone === "accent" ? { backgroundImage: barGradient(index / Math.max(1, count - 1), ramp) } : {}),
            ...(driven && active
              ? {}
              : {
                  animationDelay: `${(index % 11) * 90}ms`,
                  animationDuration: `${1100 + (index % 7) * 140}ms`,
                }),
          };
          return (
            <span
              key={index}
              className={[
                "wave-bar",
                active ? "" : "is-static",
                active && !driven ? "is-live" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-tone={TONE_TO_ATTR[tone]}
              style={style}
            />
          );
        })}
      </div>
      {active ? <span className="wave-spark" /> : null}
    </div>
  );
}

/** Real levels when present, the deterministic spine otherwise. */
function spiritOf(index: number, sampled: number[] | null): number {
  if (!sampled) return spineAt(index);
  const value = sampled[index] ?? 0;
  // A floor keeps a silent channel legible as "listening, not speaking".
  return 0.1 + 0.9 * value;
}

const STATE_COPY: Record<VoiceState, { label: string; pill: string; dot: string }> = {
  idle: { label: "Ready", pill: "pill", dot: "var(--text-muted)" },
  listening: { label: "Listening", pill: "pill-live", dot: "var(--success)" },
  speaking: { label: "Speaking", pill: "pill-accent", dot: "var(--accent-primary)" },
  thinking: { label: "Thinking", pill: "pill-warn", dot: "var(--warning)" },
  muted: { label: "Muted", pill: "pill-danger", dot: "var(--danger)" },
};

export function AudioStatePill({ state, suffix }: { state: VoiceState; suffix?: string }) {
  const copy = STATE_COPY[state];
  const live = state === "listening" || state === "speaking";
  return (
    <span className={`${copy.pill} pill`} data-state={state}>
      <span className={live ? "dot-live" : state === "thinking" ? "dot-thinking" : "dot-idle"} style={{ background: copy.dot }} />
      {copy.label}
      {suffix ? <span className="mono text-[var(--text-muted)]">· {suffix}</span> : null}
    </span>
  );
}

/**
 * Telemetry meter for the sub-300ms barge-in budget.
 *
 * The bar is scaled against the 300ms contract rather than an arbitrary
 * maximum, so an over-budget round trip is visible at a glance. Colour is
 * paired with the numeric read-out so the signal never relies on hue alone.
 */
export function LatencyPill({ latencyMs, mode }: { latencyMs: number; mode: "live" | "local" }) {
  const measured = Math.max(120, Math.round(latencyMs));
  const budget = 300;
  const ratio = Math.min(1, measured / budget);
  const withinBudget = measured <= budget;
  const tone = withinBudget ? (ratio > 0.8 ? "pill-warn" : "pill-live") : "pill-danger";

  return (
    <span
      className={`${tone} pill`}
      title="Measured round-trip from speech end to first audio token"
      aria-label={`Round trip ${measured} milliseconds, ${withinBudget ? "within" : "over"} the ${budget} millisecond budget, ${mode === "live" ? "provider" : "grounded"} mode`}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <circle cx="5" cy="5" r="4" stroke="currentColor" strokeOpacity="0.5" />
        <path d="M5 2.4V5l1.8 1.1" stroke="currentColor" strokeLinecap="round" />
      </svg>
      <span className="mono">~{measured}ms</span>
      <span className="latency-budget" aria-hidden="true">
        <span style={{ width: `${Math.max(4, Math.round(ratio * 100))}%` }} />
      </span>
      <span className="text-[var(--text-muted)]">· {mode === "live" ? "provider" : "grounded"}</span>
    </span>
  );
}

export function BargeInPill() {
  return (
    <span className="pill pill-accent" title="Interruption is committed before the agent finishes speaking">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M5.6 1 2.2 5.6h2.1L4.1 9l3.6-4.7H5.5L5.6 1Z" fill="currentColor" fillOpacity="0.9" />
      </svg>
      <span className="mono">≈150ms</span>
      <span className="text-[var(--text-muted)]">barge-in</span>
    </span>
  );
}
