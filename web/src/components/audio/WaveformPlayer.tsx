'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, Volume2, VolumeX, RotateCcw, AlertCircle, Music } from 'lucide-react';
import { TranscriptTurn } from '@/contracts/schemas';

export interface WaveformPlayerProps {
  audioUrl?: string | null;
  transcript?: TranscriptTurn[];
  durationSeconds?: number;
  className?: string;
  language?: 'da' | 'en';
  onTimeUpdate?: (currentTime: number) => void;
}

export const WaveformPlayer: React.FC<WaveformPlayerProps> = ({
  audioUrl,
  transcript = [],
  durationSeconds = 0,
  className = '',
  language = 'en',
  onTimeUpdate,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [totalDuration, setTotalDuration] = useState<number>(durationSeconds);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(audioUrl));
  const [loadError, setLoadError] = useState<string | null>(null);

  const isDanish = language === 'da';

  // Initialize WaveSurfer
  const initWaveSurfer = useCallback(() => {
    if (!containerRef.current || !audioUrl) return;

    if (waveSurferRef.current) {
      waveSurferRef.current.destroy();
      waveSurferRef.current = null;
    }

    setIsLoading(true);
    setLoadError(null);

    try {
      const ws = WaveSurfer.create({
        container: containerRef.current,
        waveColor: '#4B5563',
        progressColor: '#00F5D4',
        cursorColor: '#38BDF8',
        barWidth: 2,
        barRadius: 2,
        barGap: 3,
        height: 64,
        normalize: true,
      });

      ws.load(audioUrl);

      ws.on('ready', () => {
        setIsLoading(false);
        const dur = ws.getDuration();
        setTotalDuration(dur > 0 ? dur : durationSeconds);
      });

      ws.on('audioprocess', (time: number) => {
        setCurrentTime(time);
        onTimeUpdate?.(time);
      });

      ws.on('play', () => setIsPlaying(true));
      ws.on('pause', () => setIsPlaying(false));
      ws.on('finish', () => {
        setIsPlaying(false);
        setCurrentTime(0);
      });

      ws.on('error', (err: Error) => {
        setIsLoading(false);
        setLoadError(`Audio playback error: ${err.message || 'Failed to decode file'}`);
      });

      waveSurferRef.current = ws;
    } catch (err: unknown) {
      setIsLoading(false);
      setLoadError(err instanceof Error ? err.message : 'Could not initialize waveform audio');
    }
  }, [audioUrl, durationSeconds, onTimeUpdate]);

  useEffect(() => {
    initWaveSurfer();
    return () => {
      if (waveSurferRef.current) {
        waveSurferRef.current.destroy();
        waveSurferRef.current = null;
      }
    };
  }, [initWaveSurfer]);

  const togglePlayPause = () => {
    if (!waveSurferRef.current) return;
    waveSurferRef.current.playPause();
  };

  const toggleMute = () => {
    if (!waveSurferRef.current) return;
    const nextMuted = !isMuted;
    waveSurferRef.current.setMuted(nextMuted);
    setIsMuted(nextMuted);
  };

  const seekToTime = (timestampSeconds: number) => {
    if (!waveSurferRef.current || totalDuration <= 0) return;
    const targetProgress = Math.min(1, Math.max(0, timestampSeconds / totalDuration));
    waveSurferRef.current.seekTo(targetProgress);
    if (!isPlaying) {
      waveSurferRef.current.play();
    }
  };

  const formatTime = (secs: number): string => {
    const mins = Math.floor(secs / 60);
    const remainder = Math.floor(secs % 60);
    return `${mins}:${remainder < 10 ? '0' : ''}${remainder}`;
  };

  // 1. EMPTY STATE
  if (!audioUrl) {
    return (
      <div className={`p-6 rounded-2xl bg-gray-900/60 border border-gray-800 text-center ${className}`}>
        <Music className="w-8 h-8 mx-auto text-gray-500 mb-2 animate-pulse" />
        <p className="text-sm text-gray-400 font-medium">
          {isDanish ? 'Ingen lydoptagelse tilgængelig endnu' : 'No call recording available yet'}
        </p>
        <p className="text-xs text-gray-600 mt-1">
          {isDanish
            ? 'Optagelsen behandles af LiveKit Egress og overføres til Supabase Storage.'
            : 'Session is captured directly via LiveKit RoomCompositeEgress to Supabase Storage S3.'}
        </p>
      </div>
    );
  }

  // 2. ERROR STATE
  if (loadError) {
    return (
      <div className={`p-4 rounded-2xl bg-red-950/40 border border-red-800/80 text-red-300 text-sm flex items-center justify-between ${className}`}>
        <div className="flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <span>{loadError}</span>
        </div>
        <button
          onClick={initWaveSurfer}
          className="px-3 py-1 bg-red-900/60 hover:bg-red-800 rounded-lg text-xs font-semibold text-white flex items-center gap-1.5 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" /> {isDanish ? 'Prøv igen' : 'Retry'}
        </button>
      </div>
    );
  }

  return (
    <div className={`p-5 rounded-2xl bg-gray-950/80 border border-gray-800/90 shadow-xl ${className}`}>
      {/* Waveform Canvas Host */}
      <div className="relative w-full">
        <div ref={containerRef} className="w-full" />
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950/70 backdrop-blur-sm rounded-lg">
            <span className="text-xs font-mono text-cyan-400 animate-pulse">
              {isDanish ? 'Indlæser lydbølger...' : 'Loading audio waveforms...'}
            </span>
          </div>
        )}
      </div>

      {/* Control Bar */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-800/60">
        <div className="flex items-center gap-3">
          <button
            onClick={togglePlayPause}
            disabled={isLoading}
            className="w-10 h-10 rounded-full bg-cyan-400 hover:bg-cyan-300 text-black flex items-center justify-center font-bold shadow-lg shadow-cyan-500/20 transition-transform active:scale-95 disabled:opacity-50"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
          </button>

          <button
            onClick={toggleMute}
            className="w-8 h-8 rounded-lg bg-gray-900 hover:bg-gray-800 text-gray-300 flex items-center justify-center transition-colors"
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <div className="text-xs font-mono text-gray-400">
            <span className="text-cyan-400 font-semibold">{formatTime(currentTime)}</span> / {formatTime(totalDuration)}
          </div>
        </div>

        <span className="text-[11px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-gray-800 text-gray-300">
          Lossless MP3
        </span>
      </div>

      {/* Interactive Word-Level Clickable Transcript */}
      {transcript.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-800/60 space-y-2 max-h-48 overflow-y-auto pr-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            {isDanish
              ? 'Synkroniseret Transskription (Klik for at afspille)'
              : 'Synchronized Transcript (Click to seek)'}
          </p>
          {transcript.map((turn, idx) => {
            const isTurnActive =
              typeof turn.start === 'number' &&
              typeof turn.end === 'number' &&
              currentTime >= turn.start &&
              currentTime <= turn.end;

            return (
              <div
                key={idx}
                onClick={() => typeof turn.start === 'number' && seekToTime(turn.start)}
                className={`p-2 rounded-lg text-xs cursor-pointer transition-colors ${
                  isTurnActive
                    ? 'bg-cyan-950/60 border border-cyan-500/50 text-cyan-200'
                    : 'bg-gray-900/40 hover:bg-gray-900 text-gray-300'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] text-gray-500 mb-0.5 font-mono">
                  <span className={turn.speaker === 'agent' || turn.speaker === 'ai' ? 'text-cyan-400 font-bold' : 'text-purple-400 font-bold'}>
                    {turn.speaker === 'agent' || turn.speaker === 'ai'
                      ? 'AI Voice Receptionist'
                      : isDanish
                      ? 'Kunde / Caller'
                      : 'Customer / Caller'}
                  </span>
                  {typeof turn.start === 'number' && <span>{formatTime(turn.start)}</span>}
                </div>
                <p className="leading-relaxed">{turn.text}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
