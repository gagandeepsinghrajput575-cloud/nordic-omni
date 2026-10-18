'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlayCircle, Zap, ShieldAlert, Sparkles, ChevronUp, ChevronDown, Globe } from 'lucide-react';
import { useUICommandStore } from '@/lib/store/ui-command-store';

interface PitchSimulatorDrawerProps {
  tenantSlug: string;
  tenantId: string;
}

export function PitchSimulatorDrawer({ tenantSlug }: PitchSimulatorDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [simLanguage, setSimLanguage] = useState<'en' | 'da'>('en');
  const triggerDireModal = useUICommandStore((state) => state.triggerDireModal);

  // 1. Simulate Lead Form Submission
  const simulateLeadForm = async () => {
    setIsRunning(true);
    try {
      const payload =
        simLanguage === 'en'
          ? {
              tenantSlug,
              fullName: 'Alexander Wright',
              phoneNumber: '+447911123456',
              channelPreference: 'whatsapp',
              inquiryText:
                'Hello! Our main clinic waterline burst and is leaking heavily across the consultation rooms. Can an emergency technician come immediately?',
              language: 'en',
            }
          : {
              tenantSlug,
              fullName: 'Morten Lindberg',
              phoneNumber: '+4528991122',
              channelPreference: 'whatsapp',
              inquiryText:
                'Hej, vi har brug for akut tagrens og algebehandling på 180 m2. Hvad koster det?',
              language: 'da',
            };

      await fetch('/api/webhooks/lead-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error(e);
    } finally {
      setIsRunning(false);
    }
  };

  // 2. Simulate Customer Demanding Instant Voice Call
  const simulateCustomerWantsCall = async () => {
    setIsRunning(true);
    try {
      const isEnglish = simLanguage === 'en';
      const callerName = isEnglish ? 'Alexander Wright' : 'Morten Lindberg';
      const callerNumber = isEnglish ? '+447911123456' : '+4528991122';
      const messageBody = isEnglish
        ? 'Can you call me on the phone right now? I need to book the treatment immediately.'
        : 'Kan du ringe mig op nu på telefonen? Jeg vil gerne bestille med det samme.';

      await fetch('/api/webhooks/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          object: 'whatsapp_business_account',
          entry: [
            {
              id: 'wh_entry_1',
              changes: [
                {
                  field: 'messages',
                  value: {
                    contacts: [{ profile: { name: callerName }, wa_id: callerNumber }],
                    messages: [
                      {
                        from: callerNumber,
                        id: `msg_${Date.now()}`,
                        timestamp: `${Date.now()}`,
                        text: { body: messageBody },
                        type: 'text',
                      },
                    ],
                  },
                },
              ],
            },
          ],
        }),
      });
    } catch (e) {
      console.error(e);
    } finally {
      setIsRunning(false);
    }
  };

  // 3. Simulate Dire Emergency Inbound
  const simulateDireEmergency = () => {
    const isEnglish = simLanguage === 'en';
    triggerDireModal({
      callLogId: '99999999-9999-4999-8999-999999999999',
      customerName: isEnglish ? 'Alexander Wright (Urgent)' : 'Frederik Møller (Akut)',
      phoneNumber: isEnglish ? '+447911123456' : '+4540112233',
      reason: 'high_value_emergency',
      estimatedValueDkk: 32000,
      aiBriefing: isEnglish
        ? 'Major waterline rupture in clinic basement. Caller demands immediate emergency dispatch and wants to speak directly with the owner.'
        : 'Akut vandskade og sprængt rør i kælder. Kunden kræver øjeblikkelig udrykning og vil tale med mester.',
    });
  };

  return (
    <div className="fixed bottom-6 left-6 z-40">
      <div className="bg-[#0A0D15]/95 border border-[#1F273B] rounded-2xl shadow-2xl backdrop-blur-xl overflow-hidden text-white w-72">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full p-3.5 flex items-center justify-between text-xs font-semibold hover:bg-[#121724] transition-colors"
        >
          <span className="flex items-center gap-2 text-[#00F5D4]">
            <Zap className="w-4 h-4" /> 🎯 Live Pitch Simulator
          </span>
          {isOpen ? <ChevronDown className="w-4 h-4 text-[#8E9CAE]" /> : <ChevronUp className="w-4 h-4 text-[#8E9CAE]" />}
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="p-3 border-t border-[#1C2335] space-y-2 text-xs"
            >
              {/* Language Switcher for Simulation */}
              <div className="flex items-center justify-between bg-[#111724] p-1.5 rounded-xl border border-[#1E293F] mb-1">
                <span className="text-[10px] text-[#8E9CAE] flex items-center gap-1 font-mono">
                  <Globe className="w-3 h-3 text-[#00F5D4]" /> Simulation Lang:
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setSimLanguage('en')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                      simLanguage === 'en'
                        ? 'bg-[#00F5D4] text-black shadow'
                        : 'text-[#8E9CAE] hover:text-white'
                    }`}
                  >
                    EN 🇬🇧
                  </button>
                  <button
                    onClick={() => setSimLanguage('da')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                      simLanguage === 'da'
                        ? 'bg-[#00F5D4] text-black shadow'
                        : 'text-[#8E9CAE] hover:text-white'
                    }`}
                  >
                    DA 🇩🇰
                  </button>
                </div>
              </div>

              <p className="text-[10px] text-[#8E9CAE]">
                Fire simulated customer interactions during live client sales presentations ($0 cost):
              </p>

              <button
                onClick={simulateLeadForm}
                disabled={isRunning}
                className="w-full text-left p-2.5 rounded-xl bg-[#121824] hover:bg-[#1A2234] border border-[#212C40] hover:border-[#00F5D4] transition-all flex items-center gap-2 group"
              >
                <PlayCircle className="w-4 h-4 text-[#00F5D4] group-hover:scale-110 transition-transform" />
                <div>
                  <div className="font-semibold text-white">1. Simulate Lead Form</div>
                  <div className="text-[9px] text-[#8E9CAE]">
                    {simLanguage === 'en'
                      ? 'Triggers instant English WhatsApp reply'
                      : 'Triggers instant Danish WhatsApp reply'}
                  </div>
                </div>
              </button>

              <button
                onClick={simulateCustomerWantsCall}
                disabled={isRunning}
                className="w-full text-left p-2.5 rounded-xl bg-[#121824] hover:bg-[#1A2234] border border-[#212C40] hover:border-[#7B61FF] transition-all flex items-center gap-2 group"
              >
                <Sparkles className="w-4 h-4 text-[#7B61FF] group-hover:scale-110 transition-transform" />
                <div>
                  <div className="font-semibold text-white">2. Simulate Call Request</div>
                  <div className="text-[9px] text-[#8E9CAE]">Spawns 1-tap WebRTC call link</div>
                </div>
              </button>

              <button
                onClick={simulateDireEmergency}
                className="w-full text-left p-2.5 rounded-xl bg-[#FF2A85]/10 hover:bg-[#FF2A85]/20 border border-[#FF2A85]/40 hover:border-[#FF2A85] transition-all flex items-center gap-2 group"
              >
                <ShieldAlert className="w-4 h-4 text-[#FF2A85] group-hover:scale-110 transition-transform" />
                <div>
                  <div className="font-semibold text-[#FF2A85]">3. Trigger Dire Alert (+45)</div>
                  <div className="text-[9px] text-white/70">Full-screen ringing warm transfer</div>
                </div>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
