'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Real audio, not decoration.
 *
 * The previous visualiser was a lie: a boolean flipped the bars into a fixed
 * keyframe loop, so it danced identically whether the agent was shouting or
 * silent. This reads the actual frequency data from the LiveKit audio track.
 *
 * Returns `bars` values in 0..1, already smoothed and log-scaled so quiet
 * speech still shows movement and loud speech does not clip to the ceiling.
 */
export function useAudioBands(
  stream: MediaStream | null,
  bars = 24,
  options: { smoothing?: number; floor?: number } = {}
) {
  const { smoothing = 0.72, floor = 0.06 } = options;

  const [levels, setLevels] = useState<number[]>(() => new Array(bars).fill(floor));
  const smoothed = useRef<number[]>(new Array(bars).fill(floor));

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      smoothed.current = new Array(bars).fill(floor);
      setLevels(new Array(bars).fill(floor));
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    let ctx: AudioContext;
    let source: MediaStreamAudioSourceNode;
    let analyser: AnalyserNode;
    try {
      ctx = new AudioCtx();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.8;
      source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
    } catch {
      // No Web Audio (or a blocked context): remain visually quiet rather than
      // inventing a waveform.
      setLevels(new Array(bars).fill(floor));
      return;
    }

    // Autoplay policy may create the context suspended even after the LiveKit
    // room was unlocked. Resume it, and retry whenever the page becomes visible.
    const resume = () => {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    };
    resume();
    ctx.addEventListener('statechange', resume);
    document.addEventListener('visibilitychange', resume);

    const bins = analyser.frequencyBinCount;
    const data = new Uint8Array(bins);

    let raf = 0;
    let last = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);

      // ~30 fps is plenty for bars and keeps React out of the hot path.
      if (now - last < 33) return;
      last = now;

      analyser.getByteFrequencyData(data as unknown as Uint8Array<ArrayBuffer>);

      const next = new Array<number>(bars);
      let changed = false;
      for (let i = 0; i < bars; i += 1) {
        // Log scale: speech energy sits low in the spectrum, so a linear read
        // makes everything look silent except the bass.
        const from = Math.floor(Math.pow(i / bars, 1.6) * bins);
        const to = Math.max(from + 1, Math.floor(Math.pow((i + 1) / bars, 1.6) * bins));

        let sum = 0;
        for (let b = from; b < to; b += 1) sum += data[b];
        const avg = sum / (to - from) / 255;

        const shaped = Math.pow(avg, 0.7);
        const prev = smoothed.current[i] ?? floor;
        const value = prev + (shaped - prev) * (1 - smoothing);

        smoothed.current[i] = value;
        next[i] = Math.max(floor, Math.min(1, value));
        if (Math.abs(next[i] - prev) > 0.004) changed = true;
      }

      if (changed) setLevels(next);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', resume);
      ctx.removeEventListener('statechange', resume);
      try {
        source.disconnect();
      } catch {
        /* already gone */
      }
      if (ctx.state !== 'closed') ctx.close().catch(() => {});
    };
  }, [stream, bars, smoothing, floor]);

  return levels;
}

/** The loudest band, 0..1 — handy for driving a single orb radius. */
export function peakOf(levels: number[]): number {
  return levels.reduce((max, n) => (n > max ? n : max), 0);
}
