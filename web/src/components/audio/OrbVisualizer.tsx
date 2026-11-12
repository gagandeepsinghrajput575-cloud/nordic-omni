'use client';

import React, { useEffect, useRef } from 'react';
import {
  createAnalyserRuntime,
  createMotionPreference,
  createPacedFrameLoop,
} from '@/lib/audio/visualizer-runtime';

export type VisualizerState = 'idle' | 'speaking' | 'listening' | 'dire_hold' | 'consulting';

export interface OrbVisualizerProps {
  isActive?: boolean;
  state?: VisualizerState;
  audioStream?: MediaStream | null;
  size?: number;
  className?: string;
}

export const OrbVisualizer: React.FC<OrbVisualizerProps> = ({
  isActive = false,
  state = 'idle',
  audioStream = null,
  size = 180,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  // Each stream owns one runtime. React runs the previous cleanup before a
  // rapid stream replacement, so old contexts/listeners cannot accumulate.
  useEffect(() => {
    if (!audioStream) {
      analyserRef.current = null;
      dataArrayRef.current = null;
      return;
    }
    const runtime = createAnalyserRuntime(audioStream);
    analyserRef.current = runtime?.analyser ?? null;
    dataArrayRef.current = runtime?.dataArray ?? null;
    return () => {
      runtime?.dispose();
      if (analyserRef.current === runtime?.analyser) analyserRef.current = null;
      if (dataArrayRef.current === runtime?.dataArray) dataArrayRef.current = null;
    };
  }, [audioStream]);

  // Canvas resolution follows DPR; colours follow the active theme. Motion and
  // RAF ownership react immediately to media-query changes and effect teardown.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    let time = 0;
    let loop: ReturnType<typeof createPacedFrameLoop> | null = null;
    const motion = createMotionPreference(() => loop?.refresh());
    const draw = (now: number) => {
      const reduced = motion.reduced;
      if (!reduced && isActive && now > 0) time += 0.035;

      const styles = getComputedStyle(canvas);
      const accent = styles.getPropertyValue('--accent-primary').trim() || '#34d399';
      const secondary = styles.getPropertyValue('--accent-secondary').trim() || accent;
      const danger = styles.getPropertyValue('--danger').trim() || accent;
      const warning = styles.getPropertyValue('--warning').trim() || accent;
      const muted = styles.getPropertyValue('--text-muted').trim() || accent;

      let primary = accent;
      let secondaryColor = secondary;
      if (state === 'dire_hold') {
        primary = danger;
        secondaryColor = warning;
      } else if (state === 'consulting') {
        primary = warning;
        secondaryColor = accent;
      } else if (state === 'idle') {
        primary = muted;
        secondaryColor = muted;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const centerX = size / 2;
      const centerY = size / 2;
      const baseRadius = size * 0.27;

      let amplitude = state === 'speaking' ? 0.08 : state === 'listening' ? 0.045 : 0.02;
      if (analyserRef.current && dataArrayRef.current) {
        analyserRef.current.getByteFrequencyData(
          dataArrayRef.current as unknown as Uint8Array<ArrayBuffer>,
        );
        let energy = 0;
        for (let i = 0; i < dataArrayRef.current.length; i += 1) {
          const normalized = dataArrayRef.current[i] / 255;
          energy += normalized * normalized;
        }
        amplitude = Math.min(1, Math.sqrt(energy / dataArrayRef.current.length) * 1.8);
      }

      ctx.save();
      ctx.globalAlpha = 0.18 + amplitude * 0.16;
      const glowGradient = ctx.createRadialGradient(
        centerX,
        centerY,
        baseRadius * 0.55,
        centerX,
        centerY,
        baseRadius * (1.5 + amplitude * 0.55),
      );
      glowGradient.addColorStop(0, primary);
      glowGradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * (1.5 + amplitude * 0.55), 0, Math.PI * 2);
      ctx.fillStyle = glowGradient;
      ctx.fill();
      ctx.restore();

      const points = 36;
      ctx.beginPath();
      for (let i = 0; i <= points; i += 1) {
        const angle = (i / points) * Math.PI * 2;
        const wave = Math.sin(angle * 3 + time * 1.8) * Math.cos(angle * 2 - time * 0.9);
        const dynamicRadius = baseRadius + wave * (3 + amplitude * size * 0.055);
        const x = centerX + Math.cos(angle) * dynamicRadius;
        const y = centerY + Math.sin(angle) * dynamicRadius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      const orbGradient = ctx.createLinearGradient(
        centerX - baseRadius,
        centerY - baseRadius,
        centerX + baseRadius,
        centerY + baseRadius,
      );
      orbGradient.addColorStop(0, primary);
      orbGradient.addColorStop(1, secondaryColor);
      ctx.fillStyle = orbGradient;
      ctx.globalAlpha = state === 'idle' ? 0.32 : 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.beginPath();
      ctx.ellipse(
        centerX - baseRadius * 0.25,
        centerY - baseRadius * 0.3,
        baseRadius * 0.3,
        baseRadius * 0.13,
        -Math.PI / 6,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius + size * 0.055, 0, Math.PI * 2);
      ctx.strokeStyle = styles.getPropertyValue('--line').trim() || 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    loop = createPacedFrameLoop(draw, () => isActive && !motion.reduced);

    return () => {
      loop?.dispose();
      motion.dispose();
    };
  }, [isActive, state, size]);

  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="block rounded-full"
        style={{ width: `${size}px`, height: `${size}px` }}
      />
      {state === 'dire_hold' && (
        <span className="absolute -bottom-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white bg-red-600 rounded-full animate-pulse border border-red-400">
          Hold for Owner
        </span>
      )}
    </div>
  );
};
