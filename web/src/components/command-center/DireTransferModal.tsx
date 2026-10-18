'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, UserCheck, MessageSquareReply, Radio, Volume2, X } from 'lucide-react';
import { useUICommandStore } from '@/lib/store/ui-command-store';

interface DireTransferModalProps {
  tenantId: string;
  defaultLanguage: 'da-DK' | 'en-US';
}

export function DireTransferModal({ tenantId, defaultLanguage }: DireTransferModalProps) {
  const activeDireAlert = useUICommandStore((state) => state.activeDireAlert);
  const clearDireAlert = useUICommandStore((state) => state.clearDireAlert);

  const [instruction, setInstruction] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentActionState, setCurrentActionState] = useState<
    'idle' | 'consulting' | 'relaying' | 'merged'
  >('idle');

  const audioContextRef = useRef<AudioContext | null>(null);
  const ringOscillatorRef = useRef<OscillatorNode | null>(null);

  // Play synthesized urgent ringtone when modal opens
  useEffect(() => {
    if (activeDireAlert) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);

        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();

        ringOscillatorRef.current = osc;
      } catch (e) {
        console.warn('AudioContext autoplay blocked by browser policy:', e);
      }
    }

    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [activeDireAlert]);

  if (!activeDireAlert) return null;

  const handleWarmTransferAction = async (
    action: 'START_PRIVATE_CONSULT' | 'RELAY_OWNER_INSTRUCTION' | 'MERGE_OWNER_INTO_CALL' | 'RESOLVE_AND_END'
  ) => {
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/livekit/warm-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callLogId: activeDireAlert.callLogId || '00000000-0000-0000-0000-000000000000',
          tenantId,
          action,
          ownerInstruction: instruction,
        }),
      });

      if (!res.ok) throw new Error('Failed to transition transfer state');

      if (action === 'START_PRIVATE_CONSULT') setCurrentActionState('consulting');
      if (action === 'RELAY_OWNER_INSTRUCTION') {
        setCurrentActionState('relaying');
        setTimeout(() => clearDireAlert(), 1800);
      }
      if (action === 'MERGE_OWNER_INTO_CALL') setCurrentActionState('merged');
      if (action === 'RESOLVE_AND_END') clearDireAlert();
    } catch (err) {
      console.error('Warm transfer action error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dire-modal-title"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', stiffness: 350, damping: 25 }}
          className="w-full max-w-xl bg-[#090C12] border-2 border-[#FF2A85] rounded-3xl p-6 shadow-[0_0_50px_rgba(255,42,133,0.35)] relative overflow-hidden text-white"
        >
          {/* Animated Ambient Alert Pulse */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#FF2A85] via-[#7B61FF] to-[#FF2A85] animate-pulse" />

          {/* Close / Dismiss */}
          <button
            onClick={clearDireAlert}
            className="absolute top-5 right-5 p-1.5 rounded-full bg-[#181D29] text-[#8E9CAE] hover:text-white transition-colors"
            aria-label="Dismiss Alert"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Header Badge */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-[#FF2A85]/20 border border-[#FF2A85]/50 flex items-center justify-center text-[#FF2A85] animate-bounce">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#FF2A85] font-bold">
                Dire Situation Escalation • Live PSTN Intercept
              </span>
              <h2 id="dire-modal-title" className="text-lg font-bold">
                {activeDireAlert.customerName || 'Inbound Caller (+45)'}
              </h2>
            </div>
          </div>

          {/* Caller Context Card */}
          <div className="bg-[#121622] border border-[#21283B] rounded-2xl p-4 mb-5 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8E9CAE]">Trigger Reason:</span>
              <span className="px-2 py-0.5 rounded bg-[#FF2A85]/10 text-[#FF2A85] font-mono font-medium border border-[#FF2A85]/30 uppercase text-[10px]">
                {activeDireAlert.reason}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8E9CAE]">Estimated Value:</span>
              <span className="text-[#00F5D4] font-semibold font-mono">
                {Number(activeDireAlert.estimatedValueDkk || 0).toLocaleString()} DKK
              </span>
            </div>
            <div className="pt-2 border-t border-[#1C2333]">
              <span className="text-[11px] text-[#8E9CAE] block mb-1">AI Live Briefing Note:</span>
              <p className="text-xs text-[#E1E7EF] bg-[#0A0D14] p-3 rounded-xl border border-[#1A2130] leading-relaxed">
                "{activeDireAlert.aiBriefing || 'Customer is demanding human intervention regarding an urgent emergency.'}"
              </p>
            </div>
          </div>

          {/* Transfer State Actions ($0 WebRTC Hybrid Engine) */}
          <div className="space-y-3">
            {currentActionState === 'idle' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  onClick={() => handleWarmTransferAction('START_PRIVATE_CONSULT')}
                  disabled={isSubmitting}
                  className="flex flex-col items-center justify-center gap-1.5 p-3.5 rounded-2xl bg-[#141A26] border border-[#252F45] hover:border-[#00F5D4] text-xs font-semibold text-white transition-all group"
                >
                  <UserCheck className="w-5 h-5 text-[#00F5D4] group-hover:scale-110 transition-transform" />
                  <span>1. Consult AI</span>
                  <span className="text-[9px] text-[#8E9CAE] font-normal">Customer stays on hold</span>
                </button>

                <button
                  onClick={() => handleWarmTransferAction('MERGE_OWNER_INTO_CALL')}
                  disabled={isSubmitting}
                  className="flex flex-col items-center justify-center gap-1.5 p-3.5 rounded-2xl bg-gradient-to-b from-[#FF2A85] to-[#D41C68] text-xs font-semibold text-white shadow-lg shadow-[#FF2A85]/30 hover:brightness-110 transition-all group"
                >
                  <Radio className="w-5 h-5 text-white animate-pulse" />
                  <span>2. Patch Me In Live</span>
                  <span className="text-[9px] text-white/80 font-normal">Bridge browser to caller</span>
                </button>

                <button
                  onClick={() => setCurrentActionState('relaying')}
                  disabled={isSubmitting}
                  className="flex flex-col items-center justify-center gap-1.5 p-3.5 rounded-2xl bg-[#141A26] border border-[#252F45] hover:border-[#7B61FF] text-xs font-semibold text-white transition-all group"
                >
                  <MessageSquareReply className="w-5 h-5 text-[#7B61FF] group-hover:scale-110 transition-transform" />
                  <span>3. Instruct AI</span>
                  <span className="text-[9px] text-[#8E9CAE] font-normal">Relay message to caller</span>
                </button>
              </div>
            )}

            {currentActionState === 'consulting' && (
              <div className="p-4 bg-[#0E131D] border border-[#00F5D4]/40 rounded-2xl text-center space-y-3">
                <div className="flex items-center justify-center gap-2 text-xs text-[#00F5D4]">
                  <Volume2 className="w-4 h-4 animate-bounce" />
                  <span className="font-semibold">Private WebRTC Consult Active with AI Voice Agent</span>
                </div>
                <p className="text-xs text-[#8E9CAE]">
                  Caller is currently listening to hold music. Speak directly through your microphone or click below to merge.
                </p>
                <div className="flex justify-center gap-3 pt-2">
                  <button
                    onClick={() => handleWarmTransferAction('MERGE_OWNER_INTO_CALL')}
                    className="px-4 py-2 bg-[#00F5D4] text-black font-semibold rounded-xl text-xs hover:bg-[#00D2B6] transition-colors"
                  >
                    Merge Call With Customer
                  </button>
                  <button
                    onClick={() => clearDireAlert()}
                    className="px-4 py-2 bg-[#1A2232] text-white rounded-xl text-xs hover:bg-[#253047] transition-colors"
                  >
                    End Call
                  </button>
                </div>
              </div>
            )}

            {currentActionState === 'relaying' && (
              <div className="space-y-3">
                <label className="text-xs text-[#8E9CAE] block">
                  {defaultLanguage === 'da-DK' ? 'Hvad skal AI-agenten sige til kunden på hold?' : 'What should the AI tell the customer on hold?'}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder={defaultLanguage === 'da-DK' ? 'F.eks: Vi kan komme kl 14:00 for 2.500 kr...' : 'e.g., We can arrive at 2 PM for 2,500 DKK...'}
                    className="flex-1 bg-[#0A0D14] border border-[#21293B] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#7B61FF]"
                  />
                  <button
                    onClick={() => handleWarmTransferAction('RELAY_OWNER_INSTRUCTION')}
                    disabled={!instruction.trim() || isSubmitting}
                    className="px-4 py-2 bg-[#7B61FF] hover:bg-[#684DEC] text-white text-xs font-semibold rounded-xl disabled:opacity-40 transition-colors"
                  >
                    Send to Caller
                  </button>
                </div>
              </div>
            )}

            {currentActionState === 'merged' && (
              <div className="p-4 bg-[#00F5D4]/10 border border-[#00F5D4]/50 rounded-2xl text-center space-y-2">
                <div className="flex items-center justify-center gap-2 text-xs text-[#00F5D4] font-bold">
                  <Radio className="w-4 h-4 animate-ping" />
                  <span>CALL MERGED: You are speaking live with the caller</span>
                </div>
                <p className="text-[11px] text-[#8E9CAE]">
                  Your browser mic and caller audio are linked. LiveKit Egress is recording this conversation to Supabase Storage.
                </p>
                <button
                  onClick={() => handleWarmTransferAction('RESOLVE_AND_END')}
                  className="mt-2 px-4 py-2 bg-[#FF2A85] hover:bg-[#D41C68] text-white rounded-xl text-xs font-semibold transition-colors"
                >
                  Hang Up Call
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
