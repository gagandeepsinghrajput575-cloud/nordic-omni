'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Send, Sparkles, Volume2 } from 'lucide-react';
import { OrbVisualizer } from '@/components/audio/OrbVisualizer';
import { useUICommandStore } from '@/lib/store/ui-command-store';

interface OwnerCopilotDockProps {
  tenantId: string;
  tenantSlug: string;
  ownerName: string;
  defaultLanguage: 'da-DK' | 'en-US';
}

export function OwnerCopilotDock({
  tenantId,
  ownerName,
  defaultLanguage,
}: OwnerCopilotDockProps) {
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResponse, setLastResponse] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const recognitionRef = useRef<any>(null);
  const executeUICommand = useUICommandStore((state) => state.executeUICommand);

  // Initialize Web Speech API for voice input
  useEffect(() => {
    if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = defaultLanguage;

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInputText(transcript);
        handleSendCommand(transcript, 'voice');
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, [defaultLanguage]);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in this browser. Please use Google Chrome or Edge.');
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setInputText('');
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const handleSendCommand = async (textToSend: string, mode: 'voice' | 'text' = 'text') => {
    const query = textToSend.trim();
    if (!query || isProcessing) return;

    setIsProcessing(true);
    setLastResponse(null);

    try {
      const res = await fetch('/api/copilot/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          inputMode: mode,
          utterance: query,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Copilot failed to execute');
      }

      setLastResponse(data.replyText);
      setInputText('');

      // Voice synthesis response in Danish or English
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(data.replyText);
        utterance.lang = defaultLanguage;
        utterance.rate = 1.05;
        window.speechSynthesis.speak(utterance);
      }

      // Execute locally returned UI commands immediately
      if (Array.isArray(data.uiCommands)) {
        for (const cmd of data.uiCommands) {
          executeUICommand(cmd.commandType, cmd.payload);
        }
      }
    } catch (err: any) {
      console.error('Error dispatching copilot command:', err);
      setLastResponse(defaultLanguage === 'da-DK' ? 'Fejl under udførelse. Prøv igen.' : 'Execution failed. Please retry.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end">
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 350, damping: 28 }}
            className="w-[420px] max-w-[calc(100vw-32px)] mb-3 bg-[#0A0D14]/95 border border-[#1E2638] rounded-2xl p-5 shadow-2xl backdrop-blur-xl flex flex-col gap-4 text-white"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#1E2638] pb-3">
              <div className="flex items-center gap-2.5">
                <div className="relative w-8 h-8 rounded-lg bg-gradient-to-tr from-[#00F5D4]/20 to-[#7B61FF]/20 flex items-center justify-center border border-[#00F5D4]/40">
                  <Sparkles className="w-4 h-4 text-[#00F5D4]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold tracking-wide flex items-center gap-1.5">
                    Owner Co-Pilot{' '}
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-[#00F5D4]/10 text-[#00F5D4] border border-[#00F5D4]/30 font-mono">
                      God Mode
                    </span>
                  </h3>
                  <p className="text-[11px] text-[#8E9CAE]">Controlling {ownerName}'s AI Operations</p>
                </div>
              </div>
              <button
                onClick={() => setIsExpanded(false)}
                className="text-xs text-[#8E9CAE] hover:text-white transition-colors"
                aria-label="Minimize Copilot"
              >
                Close
              </button>
            </div>

            {/* Orb Visualizer State */}
            <div className="flex flex-col items-center justify-center py-2 bg-[#06080C] rounded-xl border border-[#161C28] relative overflow-hidden">
              <div className="w-28 h-28 flex items-center justify-center">
                <OrbVisualizer
                  isActive={isListening || isProcessing}
                  state={isListening ? 'listening' : isProcessing ? 'speaking' : 'idle'}
                  size={110}
                />
              </div>
              <span className="text-[11px] font-mono tracking-wider uppercase text-[#8E9CAE] mt-1">
                {isListening
                  ? defaultLanguage === 'da-DK'
                    ? 'Lytter til din stemme...'
                    : 'Listening...'
                  : isProcessing
                  ? defaultLanguage === 'da-DK'
                    ? 'Udfører handling...'
                    : 'Reasoning & Mutating...'
                  : defaultLanguage === 'da-DK'
                  ? 'Klar til instruks'
                  : 'Ready for instruction'}
              </span>
            </div>

            {/* Response Display */}
            {lastResponse && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 bg-[#121722] border border-[#232C3E] rounded-xl text-xs text-[#E1E7EF] leading-relaxed flex items-start gap-2"
              >
                <Volume2 className="w-4 h-4 text-[#00F5D4] shrink-0 mt-0.5" />
                <span>{lastResponse}</span>
              </motion.div>
            )}

            {/* Quick Prompt Suggestions */}
            <div className="flex flex-wrap gap-1.5">
              {[
                defaultLanguage === 'da-DK' ? 'Luk fredag eftermiddag' : 'Close Friday afternoon',
                defaultLanguage === 'da-DK' ? 'Opdater timepris til 950 DKK' : 'Update rate to 950 DKK',
                defaultLanguage === 'da-DK' ? 'Giv mig dagens overblik' : 'Brief me on pipeline',
              ].map((pill, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendCommand(pill, 'text')}
                  className="text-[10px] bg-[#161C28] hover:bg-[#1E2638] text-[#9FB1C7] hover:text-white px-2.5 py-1 rounded-full border border-[#263147] transition-all"
                >
                  {pill}
                </button>
              ))}
            </div>

            {/* Input Bar */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={toggleListening}
                className={`p-2.5 rounded-xl border transition-all flex items-center justify-center ${
                  isListening
                    ? 'bg-[#FF2A85]/20 border-[#FF2A85] text-[#FF2A85] animate-pulse'
                    : 'bg-[#161C28] border-[#263147] text-[#8E9CAE] hover:text-white hover:border-[#384663]'
                }`}
                title="Speak to Owner AI"
                aria-label="Toggle Microphone"
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendCommand(inputText, 'text')}
                placeholder={defaultLanguage === 'da-DK' ? 'Giv en instruks til botten...' : 'Command your AI operations...'}
                className="flex-1 bg-[#0E131D] border border-[#20293A] rounded-xl px-3 py-2 text-xs text-white placeholder-[#5A687C] focus:outline-none focus:border-[#00F5D4] transition-colors"
              />

              <button
                onClick={() => handleSendCommand(inputText, 'text')}
                disabled={isProcessing || !inputText.trim()}
                className="p-2.5 rounded-xl bg-[#00F5D4] hover:bg-[#00D2B6] text-black font-semibold disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                aria-label="Send Text Command"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Launcher Button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-3 bg-[#0A0D14]/90 border border-[#00F5D4]/40 hover:border-[#00F5D4] text-white px-4 py-3 rounded-full shadow-[0_0_25px_rgba(0,245,212,0.18)] backdrop-blur-xl group transition-all"
        aria-label="Open AI Operations Copilot"
      >
        <div className="w-3 h-3 rounded-full bg-[#00F5D4] animate-ping" />
        <span className="text-xs font-semibold tracking-wide flex items-center gap-1.5">
          Talk to Business AI
        </span>
        <div className="w-7 h-7 rounded-full bg-[#161D2B] flex items-center justify-center border border-[#232D42] group-hover:border-[#00F5D4]/50 transition-colors">
          <Sparkles className="w-3.5 h-3.5 text-[#00F5D4]" />
        </div>
      </motion.button>
    </div>
  );
}
