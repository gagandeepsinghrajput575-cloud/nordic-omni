'use client';

import React, { useEffect, useRef } from 'react';

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
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  // Set up Web Audio Analyser if stream provided
  useEffect(() => {
    if (!audioStream) {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      const source = audioCtx.createMediaStreamSource(audioStream);
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;
      dataArrayRef.current = dataArray;
    } catch {
      // Graceful fallback to algorithmic harmonics
    }

    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, [audioStream]);

  // Canvas 60fps Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let time = 0;

    const render = () => {
      time += 0.04;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const baseRadius = size * 0.28;

      // Calculate audio amplitude level
      let amplitude = 0.2;
      if (analyserRef.current && dataArrayRef.current) {
        analyserRef.current.getByteFrequencyData(dataArrayRef.current as unknown as Uint8Array<ArrayBuffer>);
        let sum = 0;
        for (let i = 0; i < dataArrayRef.current.length; i++) {
          sum += dataArrayRef.current[i];
        }
        amplitude = sum / (dataArrayRef.current.length * 255);
      } else if (isActive) {
        amplitude = 0.35 + Math.sin(time * 3) * 0.15;
      }

      // State-driven color palettes
      let glowColor = 'rgba(0, 245, 212, 0.4)'; // Neon Cyan default
      let innerColor1 = '#00F5D4';
      let innerColor2 = '#7928CA';

      if (state === 'dire_hold') {
        glowColor = 'rgba(239, 68, 68, 0.6)'; // Urgent Red
        innerColor1 = '#EF4444';
        innerColor2 = '#F59E0B';
      } else if (state === 'consulting') {
        glowColor = 'rgba(245, 158, 11, 0.5)'; // Amber/Gold
        innerColor1 = '#F59E0B';
        innerColor2 = '#8B5CF6';
      } else if (state === 'speaking') {
        glowColor = 'rgba(56, 189, 248, 0.6)'; // Bright Sky Blue
        innerColor1 = '#38BDF8';
        innerColor2 = '#6366F1';
      }

      // Outer Glow Aura
      const glowGradient = ctx.createRadialGradient(
        centerX,
        centerY,
        baseRadius * 0.5,
        centerX,
        centerY,
        baseRadius * (1.8 + amplitude * 0.8)
      );
      glowGradient.addColorStop(0, glowColor);
      glowGradient.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * (1.8 + amplitude * 0.8), 0, Math.PI * 2);
      ctx.fillStyle = glowGradient;
      ctx.fill();

      // Fluid Wave Deformation Points
      ctx.save();
      ctx.beginPath();
      const points = 16;
      for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const wave = Math.sin(angle * 3 + time * 2) * Math.cos(angle * 2 - time);
        const dynamicRadius = baseRadius + wave * (12 + amplitude * 24);
        const x = centerX + Math.cos(angle) * dynamicRadius;
        const y = centerY + Math.sin(angle) * dynamicRadius;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();

      // Inner Gradient
      const orbGradient = ctx.createLinearGradient(
        centerX - baseRadius,
        centerY - baseRadius,
        centerX + baseRadius,
        centerY + baseRadius
      );
      orbGradient.addColorStop(0, innerColor1);
      orbGradient.addColorStop(1, innerColor2);

      ctx.fillStyle = orbGradient;
      ctx.shadowColor = innerColor1;
      ctx.shadowBlur = 18 + amplitude * 20;
      ctx.fill();
      ctx.restore();

      // Center Specular Reflection
      ctx.beginPath();
      ctx.ellipse(
        centerX - baseRadius * 0.25,
        centerY - baseRadius * 0.3,
        baseRadius * 0.35,
        baseRadius * 0.18,
        -Math.PI / 6,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.fill();

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
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
