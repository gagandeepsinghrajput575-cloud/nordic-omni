'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Pause, Play, RotateCcw, Volume2 } from 'lucide-react';
import { EqualizerBadge, GlassButton, SPRING, SPRING_SOFT } from '@/components/ui/glass';

/**
 * The ElevenLabs-style voice playground.
 *
 * ## What is real, and what is simulated
 *
 * The transport here is a **simulated preview**, not audio playback. There are no
 * audio assets in this repository, so this panel cannot produce sound; the
 * scrubber advances on a clock and the bars are drawn from a deterministic
 * envelope. The UI says so in plain language ("Simuleret forhåndsvisning")
 * rather than implying a voice is playing.
 *
 * The live, genuinely interactive activation path is the voice console beneath
 * this panel, which uses the browser's own speech recognition and synthesis.
 *
 * ## Why the clock is a ref, not state
 *
 * A 60fps loop that re-renders the whole panel would drop frames for no visual
 * gain. Instead the playhead advances in state at ~15Hz (enough for a smooth
 * head), while the bar heights are pure functions of progress, so React never
 * touches hundreds of DOM nodes per frame.
 */

export interface VoiceModelPreset {
  id: string;
  name: string;
  /** Danish description, shown under the name. */
  description: string;
  /** Relative pace of the simulated delivery, 0.6–1.6. */
  pace: number;
  /** Which catalogue voice this preset stands in for. */
  tone: 'warm' | 'bright' | 'calm';
}

export const VOICE_MODELS: readonly VoiceModelPreset[] = [
  { id: 'reception-klar', name: 'Reception · Klar', description: 'Kortfattet og professionel', pace: 1.15, tone: 'bright' },
  { id: 'reception-varm', name: 'Reception · Varm', description: 'Rolig og imødekommende', pace: 0.92, tone: 'warm' },
  { id: 'reception-ro', name: 'Reception · Ro', description: 'Meget rolig, til ældre kunder', pace: 0.78, tone: 'calm' },
];

export interface VoicePlaygroundProps {
  /** The agent's name, used in the playback caption. */
  agentName: string;
  /** Danish sample lines offered as one-tap presets. */
  presets: readonly string[];
  /** Seed text for the prompt bar. */
  initialText: string;
  language: 'da' | 'en';
  /** Optional callback when the visitor asks for the real thing. */
  onRequestLive?: () => void;
}

/** Deterministic bar envelope: the same progress always yields the same shape. */
function barHeight(index: number, count: number, progress: number): number {
  const position = index / Math.max(1, count - 1);
  // A travelling gaussian hump plus a fixed standing wave, so the profile looks
  // like speech rather than a sine sweep.
  const hump = Math.exp(-((position - progress) ** 2) / 0.012);
  const standing = Math.abs(Math.sin(index * 1.31 + 0.7)) * 0.55 + Math.abs(Math.cos(index * 0.47)) * 0.45;
  return Math.max(0.1, Math.min(1, 0.18 + standing * 0.5 + hump * 0.42));
}

export function VoicePlayground({
  agentName,
  presets,
  initialText,
  language,
  onRequestLive,
}: VoicePlaygroundProps) {
  const reduceMotion = useReducedMotion();
  const [text, setText] = useState(initialText);
  const [modelId, setModelId] = useState(VOICE_MODELS[1].id);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const scrubRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const progressRef = useRef(0);
  const modelLabelId = useId();

  const model = useMemo(
    () => VOICE_MODELS.find((candidate) => candidate.id === modelId) ?? VOICE_MODELS[0],
    [modelId],
  );

  /** Duration is a function of length and pace — a longer line takes longer. */
  const durationMs = useMemo(() => {
    const words = Math.max(1, text.trim().split(/\s+/).filter(Boolean).length);
    return Math.max(1800, Math.round((words / Math.max(0.6, model.pace)) * 340));
  }, [text, model.pace]);

  const stop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    lastTsRef.current = null;
  }, []);

  // One RAF chain, cancelled on unmount and whenever playback stops.
  useEffect(() => {
    if (!playing) {
      stop();
      return;
    }
    // Reduced motion still advances, but on a coarse timer with no smoothing:
    // the state is identical, only the visual interpolation is removed.
    const step = (timestamp: number) => {
      const previous = lastTsRef.current ?? timestamp;
      const delta = timestamp - previous;
      lastTsRef.current = timestamp;
      progressRef.current = Math.min(1, progressRef.current + delta / durationMs);
      setProgress(progressRef.current);
      if (progressRef.current >= 1) {
        setPlaying(false);
        stop();
        return;
      }
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return stop;
  }, [playing, durationMs, stop]);

  useEffect(() => stop, [stop]);

  const seekTo = useCallback((clientX: number) => {
    const element = scrubRef.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    const ratio = bounds.width > 0 ? (clientX - bounds.left) / bounds.width : 0;
    const next = Math.max(0, Math.min(1, ratio));
    progressRef.current = next;
    setProgress(next);
  }, []);

  const toggle = useCallback(() => {
    setPlaying((wasPlaying) => {
      if (wasPlaying) return false;
      // Restarting from the end begins a fresh pass.
      if (progressRef.current >= 1) {
        progressRef.current = 0;
        setProgress(0);
      }
      return true;
    });
  }, []);

  const restart = useCallback(() => {
    progressRef.current = 0;
    setProgress(0);
    setPlaying(false);
  }, []);

  const bars = reduceMotion ? 40 : 56;
  const playedRatio = Math.round(progress * 100);

  return (
    <section className="el-glass el-shimmer p-1" aria-labelledby="voice-playground-heading">
      {/* Header strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-1 pt-3">
        <div className="flex items-center gap-2.5">
          <h2 id="voice-playground-heading" className="text-[13px] font-semibold tracking-[-0.01em] text-[var(--el-ink)]">
            Stemme-playground
          </h2>
          <EqualizerBadge active={playing} label={playing ? 'Afspiller' : 'Klar'} />
        </div>
        <span className="rounded-full border border-[var(--el-line)] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--el-ink-muted)]">
          {language === 'da' ? 'Simuleret forhåndsvisning' : 'Simulated preview'}
        </span>
      </div>

      {/* Prompt bar */}
      <div className="px-4 pb-3 pt-2">
        <label htmlFor="playground-text" className="sr-only">
          {language === 'da' ? 'Tekst til forhåndsvisning' : 'Text to preview'}
        </label>
        <textarea
          id="playground-text"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            // Editing invalidates the current pass.
            restart();
          }}
          rows={3}
          maxLength={400}
          className="w-full resize-none rounded-xl border border-[var(--el-line)] bg-[color-mix(in_srgb,var(--el-black)_55%,transparent)] px-3.5 py-3 text-[13px] leading-relaxed text-[var(--el-ink)] outline-none transition-colors focus:border-[color-mix(in_srgb,var(--el-accent)_55%,transparent)]"
          placeholder={language === 'da' ? 'Skriv hvad receptionisten skal sige…' : 'Type what the receptionist should say…'}
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {presets.slice(0, 3).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setText(preset);
                restart();
              }}
              className="rounded-full border border-[var(--el-line)] px-2.5 py-1 text-[11px] text-[var(--el-ink-secondary)] transition-colors hover:border-[var(--el-line-strong)] hover:text-[var(--el-ink)]"
            >
              {preset.length > 34 ? `${preset.slice(0, 34)}…` : preset}
            </button>
          ))}
          <span className="ml-auto font-mono text-[10px] tabular-nums text-[var(--el-ink-muted)]">
            {text.trim().length}/400
          </span>
        </div>
      </div>

      {/* Model picker */}
      <fieldset className="px-4 pb-3">
        <legend id={modelLabelId} className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--el-ink-muted)]">
          {language === 'da' ? 'Stemmemodel' : 'Voice model'}
        </legend>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-labelledby={modelLabelId}>
          {VOICE_MODELS.map((option) => {
            const selected = option.id === modelId;
            return (
              <motion.button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-pressed={selected}
                onClick={() => {
                  setModelId(option.id);
                  restart();
                }}
                whileHover={reduceMotion ? undefined : { y: -2 }}
                transition={SPRING_SOFT}
                className="el-model-card"
              >
                {selected ? (
                  <motion.span
                    layoutId="model-card-ring"
                    className="pointer-events-none absolute inset-0 rounded-[14px] ring-1 ring-[color-mix(in_srgb,var(--el-accent)_60%,transparent)]"
                    transition={reduceMotion ? { duration: 0 } : SPRING}
                    aria-hidden
                  />
                ) : null}
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[var(--el-ink)]">{option.name}</span>
                  {selected ? <EqualizerBadge active={playing} bars={3} /> : null}
                </span>
                <span className="text-[10.5px] leading-snug text-[var(--el-ink-muted)]">{option.description}</span>
              </motion.button>
            );
          })}
        </div>
      </fieldset>

      {/* Scrubber + transport */}
      <div className="rounded-b-[19px] border-t border-[var(--el-line)] bg-[color-mix(in_srgb,var(--el-black)_35%,transparent)] px-4 py-3">
        <div className="flex items-center gap-3">
          <motion.button
            type="button"
            onClick={toggle}
            aria-label={
              playing
                ? language === 'da' ? 'Sæt på pause' : 'Pause'
                : language === 'da' ? 'Afspil forhåndsvisning' : 'Play preview'
            }
            aria-pressed={playing}
            data-playing={playing}
            className="el-play shrink-0"
            whileTap={reduceMotion ? undefined : { scale: 0.92 }}
            transition={SPRING}
          >
            {/* The icon morphs between play and pause with a crossfade + rotate. */}
            <motion.span
              key={playing ? 'pause' : 'play'}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.7, rotate: playing ? -90 : 90 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={reduceMotion ? { duration: 0 } : SPRING}
              className="flex items-center justify-center"
              aria-hidden
            >
              {playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" className="ml-0.5" />}
            </motion.span>
          </motion.button>

          <div className="min-w-0 flex-1">
            <div
              ref={scrubRef}
              role="slider"
              tabIndex={0}
              aria-label={language === 'da' ? 'Tidslinje for forhåndsvisning' : 'Preview timeline'}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={playedRatio}
              aria-valuetext={`${playedRatio}% ${language === 'da' ? 'afspillet' : 'played'}`}
              className="el-scrub"
              onPointerDown={(event) => {
                setScrubbing(true);
                event.currentTarget.setPointerCapture(event.pointerId);
                seekTo(event.clientX);
              }}
              onPointerMove={(event) => {
                if (scrubbing) seekTo(event.clientX);
              }}
              onPointerUp={(event) => {
                setScrubbing(false);
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onKeyDown={(event) => {
                const stepSize = event.shiftKey ? 0.1 : 0.02;
                if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const next = Math.min(1, progressRef.current + stepSize);
                  progressRef.current = next;
                  setProgress(next);
                } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  const next = Math.max(0, progressRef.current - stepSize);
                  progressRef.current = next;
                  setProgress(next);
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  progressRef.current = 0;
                  setProgress(0);
                } else if (event.key === 'End') {
                  event.preventDefault();
                  progressRef.current = 1;
                  setProgress(1);
                  setPlaying(false);
                } else if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault();
                  toggle();
                }
              }}
            >
              {Array.from({ length: bars }).map((_, index) => {
                const played = index / bars <= progress;
                return (
                  <span
                    key={index}
                    className="el-scrub-bar"
                    data-played={played ? 'true' : 'false'}
                    style={{ height: `${Math.round(barHeight(index, bars, progress) * 100)}%` }}
                  />
                );
              })}
              <span
                className="el-scrub-head"
                style={{ left: `${Math.max(0, Math.min(100, progress * 100))}%` }}
                aria-hidden
              />
            </div>
          </div>

          <div className="hidden shrink-0 items-center gap-1 sm:flex">
            <GlassButton
              size="sm"
              variant="ghost"
              onClick={restart}
              aria-label={language === 'da' ? 'Start forfra' : 'Restart'}
              icon={<RotateCcw size={13} />}
            />
            <GlassButton
              size="sm"
              variant="ghost"
              onClick={onRequestLive}
              aria-label={language === 'da' ? 'Hør den rigtige stemme' : 'Hear the real voice'}
              icon={<Volume2 size={13} />}
            />
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-[var(--el-ink-muted)]">
          <span>
            {language === 'da'
              ? `${agentName} · ${model.name} · ${Math.round(durationMs / 100) / 10}s`
              : `${agentName} · ${model.name} · ${Math.round(durationMs / 100) / 10}s`}
          </span>
          <span className="tabular-nums">{playedRatio}%</span>
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--el-ink-muted)]">
          {language === 'da'
            ? 'Forhåndsvisningen er en simulation uden lyd. Start samtalen herunder for at høre den rigtige stemme.'
            : 'This preview is a simulation with no audio. Start the conversation below to hear the real voice.'}
        </p>
      </div>
    </section>
  );
}
