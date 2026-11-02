'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Phone,
  Sparkles,
  Send,
  Bot,
  UserCheck,
  Power,
  ShieldAlert,
  MessageSquare,
} from 'lucide-react';
import { WaveformPlayer } from '@/components/audio/WaveformPlayer';
import { PipelineStage } from '@/contracts/schemas';
import { createClient } from '@/lib/supabase/client';

interface Lead360DrawerProps {
  contactId: string | null;
  tenantId: string;
  onClose: () => void;
  defaultLanguage: 'da-DK' | 'en-US';
}

export function Lead360Drawer({
  contactId,
  tenantId,
  onClose,
  defaultLanguage,
}: Lead360DrawerProps) {
  const [contact, setContact] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [callLogs, setCallLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isTogglingAi, setIsTogglingAi] = useState(false);

  const supabase = createClient();
  const isDanish = defaultLanguage === 'da-DK';

  useEffect(() => {
    if (!contactId) return;

    let isMounted = true;
    setIsLoading(true);

    async function loadLeadData() {
      const [cRes, mRes, clRes] = await Promise.all([
        supabase.from('contacts').select('*').eq('id', contactId).single(),
        supabase
          .from('messages')
          .select('*')
          .eq('contact_id', contactId)
          .order('created_at', { ascending: true }),
        supabase
          .from('call_logs')
          .select('*')
          .eq('contact_id', contactId)
          .order('created_at', { ascending: false }),
      ]);

      if (isMounted) {
        if (cRes.data) setContact(cRes.data);
        if (mRes.data) setMessages(mRes.data || []);
        if (clRes.data) setCallLogs(clRes.data || []);
        setIsLoading(false);
      }
    }

    loadLeadData();

    // Subscribe to realtime messages for this contact
    const channel = supabase
      .channel(`contact-drawer-${contactId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `contact_id=eq.${contactId}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new]);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'contacts', filter: `id=eq.${contactId}` },
        (payload) => {
          setContact((prev: any) => ({ ...prev, ...payload.new }));
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [contactId, supabase]);

  if (!contactId) return null;

  const handleStageChange = async (newStage: PipelineStage) => {
    if (!contact) return;
    setContact({ ...contact, pipeline_stage: newStage });
    await supabase.from('contacts').update({ pipeline_stage: newStage }).eq('id', contactId);
  };

  const handleToggleAiAutoPilot = async () => {
    if (!contact || isTogglingAi) return;
    setIsTogglingAi(true);

    const currentSetting = contact.ai_auto_reply_enabled ?? true;
    const nextSetting = !currentSetting;

    try {
      setContact({ ...contact, ai_auto_reply_enabled: nextSetting });

      await supabase
        .from('contacts')
        .update({
          ai_auto_reply_enabled: nextSetting,
          last_human_takeover_at: nextSetting ? null : new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', contactId);

      // Log system note in timeline
      const systemNote = nextSetting
        ? (isDanish ? 'AI Auto-Pilot genaktiveret af mester.' : 'AI Auto-Pilot resumed by operator.')
        : (isDanish ? 'Mester har overtaget samtalen. AI autosvar er sat på pause.' : 'Live human takeover initiated. AI auto-replies paused.');

      await supabase.from('messages').insert({
        tenant_id: tenantId,
        contact_id: contactId,
        channel: contact.preferred_channel || 'whatsapp',
        sender: 'system',
        content: `[SYSTEM]: ${systemNote}`,
        metadata: { action: 'HUMAN_TAKEOVER_TOGGLE', ai_enabled: nextSetting },
      });
    } catch (e) {
      console.error('Failed to toggle AI auto-pilot:', e);
    } finally {
      setIsTogglingAi(false);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || isSending) return;
    setIsSending(true);

    try {
      const channel = contact.preferred_channel === 'instagram' ? 'instagram' : 'whatsapp';

      // Insert message as owner
      await Promise.all([
        supabase.from('messages').insert({
          tenant_id: tenantId,
          contact_id: contactId,
          channel,
          sender: 'owner',
          content: newMessage,
          metadata: { manual_owner_entry: true, human_sender: true },
        }),
        supabase.from('omnichannel_messages').insert({
          tenant_id: tenantId,
          contact_id: contactId,
          channel,
          direction: 'outbound',
          content: newMessage,
          metadata: { manual_owner_entry: true, human_sender: true },
        }),
      ]);

      // If owner manually chats, ensure contact stage is moved to contacted if it was new_lead
      if (contact.pipeline_stage === 'new_lead') {
        await supabase
          .from('contacts')
          .update({ pipeline_stage: 'contacted', updated_at: new Date().toISOString() })
          .eq('id', contactId);
        setContact({ ...contact, pipeline_stage: 'contacted' });
      }

      setNewMessage('');
    } catch (e) {
      console.error('Failed to send message:', e);
    } finally {
      setIsSending(false);
    }
  };

  const isAiActive = contact?.ai_auto_reply_enabled ?? true;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-40 flex justify-end bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="w-full max-w-2xl h-full bg-[#080B11] border-l border-[#1D2536] flex flex-col shadow-2xl text-white overflow-hidden"
          role="dialog"
          aria-modal="true"
        >
          {/* Drawer Header */}
          <div className="p-5 border-b border-[#1A2233] flex items-center justify-between bg-[#0B0F17]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#00F5D4]/20 to-[#7B61FF]/20 border border-[#00F5D4]/40 flex items-center justify-center font-bold text-sm text-[#00F5D4]">
                {contact?.full_name ? contact.full_name.charAt(0) : 'L'}
              </div>
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  {contact?.full_name || 'Loading Contact...'}
                  <span className="text-xs">{contact?.preferred_language === 'da' ? '🇩🇰' : '🇬🇧'}</span>
                </h2>
                <p className="text-xs text-[#8E9CAE] font-mono">{contact?.phone_number}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={contact?.pipeline_stage || 'new_lead'}
                onChange={(e) => handleStageChange(e.target.value as PipelineStage)}
                className="bg-[#121824] border border-[#232E42] text-xs text-[#00F5D4] rounded-xl px-2.5 py-1.5 focus:outline-none"
              >
                <option value="new_lead">{isDanish ? 'Nyt Lead' : 'New Lead'}</option>
                <option value="contacted">{isDanish ? 'Kontaktet' : 'Contacted'}</option>
                <option value="qualified">{isDanish ? 'Kvalificeret' : 'Qualified'}</option>
                <option value="booked">{isDanish ? 'Aftale Booket' : 'Booked'}</option>
                <option value="dire_escalated">{isDanish ? '🚨 Akut Eskalering' : '🚨 Dire Escalated'}</option>
                <option value="closed_won">{isDanish ? 'Vundet' : 'Closed Won'}</option>
                <option value="closed_lost">{isDanish ? 'Tabt' : 'Closed Lost'}</option>
              </select>

              <button
                onClick={onClose}
                className="p-1.5 rounded-xl bg-[#121824] text-[#8E9CAE] hover:text-white transition-colors"
                aria-label="Close Drawer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* AI Auto-Pilot vs Human Takeover Switch Banner */}
          <div className="px-5 py-3 border-b border-[#1A2234] bg-[#0E131E] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {isAiActive ? (
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#00F5D4] animate-ping" />
                  <div>
                    <span className="text-xs font-bold text-[#00F5D4] flex items-center gap-1.5">
                      <Bot className="w-3.5 h-3.5" /> {isDanish ? 'AI Auto-Pilot: Aktiv' : 'AI Auto-Pilot: Active'}
                    </span>
                    <p className="text-[10px] text-[#8E9CAE]">
                      {isDanish ? 'Botten svarer automatisk på WhatsApp/Meta' : 'AI automatically replies to incoming inquiries'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#7B61FF]" />
                  <div>
                    <span className="text-xs font-bold text-[#7B61FF] flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5" /> {isDanish ? 'Manuel Overtagelse Aktiv' : 'Live Human Takeover'}
                    </span>
                    <p className="text-[10px] text-[#A0AEC0]">
                      {isDanish ? 'AI autosvar er sat på pause. Du chatter direkte.' : 'AI responses paused. You are chatting directly.'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={handleToggleAiAutoPilot}
              disabled={isTogglingAi}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                isAiActive
                  ? 'bg-[#7B61FF]/15 hover:bg-[#7B61FF]/30 text-[#A594FD] border border-[#7B61FF]/40'
                  : 'bg-[#00F5D4]/15 hover:bg-[#00F5D4]/30 text-[#00F5D4] border border-[#00F5D4]/40'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>{isAiActive ? (isDanish ? 'Overtag Samtale' : 'Take Over Chat') : (isDanish ? 'Genaktiver AI' : 'Resume AI')}</span>
            </button>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* AI Shared Memory Card */}
            <div className="bg-[#0E131E] border border-[#1E2638] rounded-2xl p-4 relative overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#00F5D4] flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> AI Unified Memory
                </span>
                <span className="text-[10px] font-mono text-[#8E9CAE]">Shared across IG, WA & Voice</span>
              </div>
              <p className="text-xs text-[#CBD5E1] leading-relaxed bg-[#07090E] p-3 rounded-xl border border-[#161D2B]">
                {contact?.shared_memory_summary || (isDanish ? 'Ingen historik endnu.' : 'No memory recorded yet.')}
              </p>
            </div>

            {/* Call Recordings Section */}
            {callLogs.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-mono uppercase tracking-wider text-[#8E9CAE]">
                  {isDanish ? 'Optagne Samtaler' : 'Recorded Voice Sessions'} ({callLogs.length})
                </h3>
                {callLogs.map((log) => (
                  <div key={log.id} className="bg-[#0E131E] border border-[#1C2436] rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-white flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-[#00F5D4]" />
                        {log.channel === 'voice_inbound' ? 'FlyNumber Inbound (+45)' : 'WebRTC Instant Call'}
                      </span>
                      <span className="text-[10px] font-mono text-[#8E9CAE]">
                        {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <WaveformPlayer
                      audioUrl={log.recording_url}
                      durationSeconds={log.duration_seconds}
                      transcript={Array.isArray(log.transcript_full) ? log.transcript_full : []}
                      language={defaultLanguage === 'da-DK' ? 'da' : 'en'}
                    />

                    {log.summary && (
                      <div className="text-[11px] text-[#A0AEC0] bg-[#07090E] p-2.5 rounded-lg border border-[#161D2B]">
                        <strong className="text-[#00F5D4]">AI Briefing:</strong> {log.summary}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Omnichannel Message Stream */}
            <div className="space-y-3">
              <h3 className="text-xs font-mono uppercase tracking-wider text-[#8E9CAE] flex items-center justify-between">
                <span>{isDanish ? 'Beskedstrøm' : 'Omnichannel Timeline'} ({messages.length})</span>
                {!isAiActive && (
                  <span className="text-[10px] font-mono text-[#7B61FF] font-semibold bg-[#7B61FF]/10 px-2 py-0.5 rounded-full border border-[#7B61FF]/30">
                    Live Human Control
                  </span>
                )}
              </h3>
              <div className="space-y-2.5">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex flex-col ${
                      m.sender === 'system'
                        ? 'items-center my-2'
                        : m.sender === 'customer' || m.direction === 'inbound'
                        ? 'items-start'
                        : 'items-end'
                    }`}
                  >
                    {m.sender === 'system' ? (
                      <span className="text-[10px] font-mono px-3 py-1 rounded-full bg-[#182030] text-[#8E9CAE] border border-[#26334D]">
                        {m.content}
                      </span>
                    ) : (
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs ${
                          m.sender === 'customer' || m.direction === 'inbound'
                            ? 'bg-[#141A26] border border-[#232D42] text-white'
                            : m.sender === 'owner'
                            ? 'bg-[#7B61FF] text-white font-medium shadow-md shadow-[#7B61FF]/20'
                            : 'bg-[#00F5D4]/10 border border-[#00F5D4]/30 text-[#E2E8F0]'
                        }`}
                      >
                        <div className="flex items-center gap-1 text-[9px] opacity-75 mb-1 font-mono uppercase">
                          <span>{m.sender === 'owner' ? (isDanish ? 'Mester (Dig)' : 'Owner (You)') : m.sender || m.direction}</span> • <span>{m.channel}</span>
                        </div>
                        <p className="leading-relaxed">{m.content}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Drawer Message Sender */}
          <div className="p-4 border-t border-[#1A2233] bg-[#0B0F17] flex items-center gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder={
                !isAiActive
                  ? (isDanish ? 'Skriv direkte til kunden (AI svarer ikke)...' : 'Type direct reply to customer (AI will not interfere)...')
                  : (isDanish ? 'Send besked til kunden over WhatsApp...' : 'Send message over WhatsApp/IG...')
              }
              className={`flex-1 bg-[#070A0F] border rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-[#5A687C] focus:outline-none transition-colors ${
                !isAiActive ? 'border-[#7B61FF]/60 focus:border-[#7B61FF]' : 'border-[#20293B] focus:border-[#00F5D4]'
              }`}
            />
            <button
              onClick={handleSendMessage}
              disabled={isSending || !newMessage.trim()}
              className={`p-2.5 rounded-xl font-semibold disabled:opacity-30 transition-all ${
                !isAiActive ? 'bg-[#7B61FF] hover:bg-[#684DEC] text-white' : 'bg-[#00F5D4] hover:bg-[#00D2B6] text-black'
              }`}
              aria-label="Send Message"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
