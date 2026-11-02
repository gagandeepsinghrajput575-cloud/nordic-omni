'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  X,
  Send,
  Mic,
  MicOff,
  CheckCircle2,
  Copy,
  ExternalLink,
  Shield,
  Layers,
  ArrowRight,
  Clock,
  Tag,
  Key,
} from 'lucide-react';
import { ProvisionTenantPayload } from '@/contracts/schemas';

interface ClientProvisioningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTenantCreated?: () => void;
}

export function ClientProvisioningModal({ isOpen, onClose, onTenantCreated }: ClientProvisioningModalProps) {
  const [activeTab, setActiveTab] = useState<'ai_interview' | 'manual_form'>('ai_interview');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([
    {
      role: 'assistant',
      content:
        'Hello! I am your DeepSeek Client Architect. Tell me about the client business you want to spin up (e.g., name, owner, city, rates, hours, and whether they need Danish or English). You can type or speak below.',
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [readyToGenerate, setReadyToGenerate] = useState(false);
  const [generatedPayload, setGeneratedPayload] = useState<ProvisionTenantPayload | null>(null);
  const [deployedResult, setDeployedResult] = useState<{
    clientPasskey: string;
    portalUrl: string;
    tenantName: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const recognitionRef = useRef<any>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  // Initialize Speech Recognition
  useEffect(() => {
    if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'en-US';

      rec.onresult = (e: any) => {
        const text = e.results[0][0].transcript;
        setInputText(text);
        handleSendMessage(text);
      };

      rec.onerror = () => setIsListening(false);
      rec.onend = () => setIsListening(false);
      recognitionRef.current = rec;
    }
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  if (!isOpen) return null;

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
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

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text || isThinking) return;

    const updatedHistory = [...messages, { role: 'user' as const, content: text }];
    setMessages(updatedHistory);
    setInputText('');
    setIsThinking(true);

    try {
      const res = await fetch('/api/admin/provision-wizard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'interview',
          notes: text,
          history: updatedHistory.slice(0, -1),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Interview error');

      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
      if (data.readyToGenerate) {
        setReadyToGenerate(true);
      }
    } catch (err: any) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Connection issue. Let me proceed to synthesize the profile now.' },
      ]);
      setReadyToGenerate(true);
    } finally {
      setIsThinking(false);
    }
  };

  const handleGenerateProfile = async () => {
    setIsThinking(true);
    try {
      const allText = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
      const res = await fetch('/api/admin/provision-wizard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'generate',
          notes: allText,
          history: messages,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.tenantPayload) throw new Error(data.message || 'Generation failed');

      setGeneratedPayload(data.tenantPayload);
      setActiveTab('manual_form');
    } catch (err) {
      console.error(err);
      alert('Failed to synthesize profile. Please check credentials or retry.');
    } finally {
      setIsThinking(false);
    }
  };

  const handleDeployWorkspace = async () => {
    if (!generatedPayload) return;
    setIsDeploying(true);

    try {
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(generatedPayload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Deployment failed');

      setDeployedResult({
        clientPasskey: data.clientPasskey,
        portalUrl: data.portalUrl,
        tenantName: generatedPayload.name,
      });

      onTenantCreated?.();
    } catch (err: any) {
      console.error(err);
      alert('Deployment failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsDeploying(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-4xl bg-[#090C14] border border-[#1E2638] rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-white"
      >
        {/* Header */}
        <div className="p-5 border-b border-[#1A2234] flex items-center justify-between bg-[#0C101A]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#00F5D4] to-[#7B61FF] p-[1.5px]">
              <div className="w-full h-full bg-[#080B12] rounded-[14px] flex items-center justify-center text-[#00F5D4]">
                <Sparkles className="w-5 h-5" />
              </div>
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                No-Code Client Provisioning Deck
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-[#00F5D4]/10 text-[#00F5D4] border border-[#00F5D4]/30">
                  DeepSeek Powered
                </span>
              </h2>
              <p className="text-xs text-[#8E9CAE]">Spin up new client voice agents, chatbots, and CRMs effortlessly</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-[#121724] p-1 rounded-xl border border-[#1E283C]">
              <button
                onClick={() => setActiveTab('ai_interview')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  activeTab === 'ai_interview' ? 'bg-[#00F5D4] text-black shadow' : 'text-[#8E9CAE] hover:text-white'
                }`}
              >
                1. AI Interview
              </button>
              <button
                onClick={() => setActiveTab('manual_form')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  activeTab === 'manual_form' ? 'bg-[#00F5D4] text-black shadow' : 'text-[#8E9CAE] hover:text-white'
                }`}
              >
                2. Preview & Fine-Tune
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-[#121724] text-[#8E9CAE] hover:text-white hover:bg-[#1A2234] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {deployedResult ? (
            /* SUCCESS CONFIRMATION SCREEN */
            <div className="text-center py-8 space-y-6 max-w-lg mx-auto">
              <div className="w-16 h-16 rounded-full bg-[#00F5D4]/20 border-2 border-[#00F5D4] flex items-center justify-center mx-auto text-[#00F5D4] animate-bounce">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div>
                <h3 className="text-xl font-bold text-white">Client Workspace Deployed!</h3>
                <p className="text-xs text-[#8E9CAE] mt-1">
                  The AI Voice receptionist, chatbot, and CRM for <strong className="text-white">{deployedResult.tenantName}</strong> are live.
                </p>
              </div>

              {/* Passkey Card */}
              <div className="bg-[#101522] border border-[#232F48] rounded-2xl p-4 text-left space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#8E9CAE] flex items-center gap-1.5 font-semibold">
                    <Key className="w-4 h-4 text-[#00F5D4]" /> Client Master Passkey:
                  </span>
                  <button
                    onClick={() => copyToClipboard(deployedResult.clientPasskey)}
                    className="text-xs text-[#00F5D4] hover:underline flex items-center gap-1"
                  >
                    <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied!' : 'Copy Key'}
                  </button>
                </div>
                <div className="p-3 bg-[#0A0D15] rounded-xl border border-[#1A2338] font-mono text-sm text-[#00F5D4] font-bold tracking-wider select-all">
                  {deployedResult.clientPasskey}
                </div>
                <p className="text-[10px] text-[#718096]">
                  Keep this passkey for yourself or hand it to the client to unlock their dedicated portal.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-center gap-3 pt-2">
                <a
                  href={`${deployedResult.portalUrl}?key=${deployedResult.clientPasskey}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-2.5 bg-[#00F5D4] hover:bg-[#00D2B6] text-black font-bold text-xs rounded-xl shadow-lg shadow-[#00F5D4]/20 flex items-center gap-2 transition-all"
                >
                  Enter Client Portal <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <button
                  onClick={onClose}
                  className="px-5 py-2.5 bg-[#161C2A] hover:bg-[#1E2638] text-white text-xs font-semibold rounded-xl border border-[#27324B] transition-all"
                >
                  Done
                </button>
              </div>
            </div>
          ) : activeTab === 'ai_interview' ? (
            /* TAB 1: AI INTERVIEW CHAT */
            <div className="flex flex-col h-[520px]">
              <div className="flex-1 overflow-y-auto space-y-3 pr-2 mb-4">
                {messages.map((m, idx) => (
                  <div
                    key={idx}
                    className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl p-4 text-xs leading-relaxed ${
                        m.role === 'user'
                          ? 'bg-[#00F5D4]/15 border border-[#00F5D4]/40 text-white'
                          : 'bg-[#101522] border border-[#1D263B] text-[#E2E8F0]'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 text-[10px] text-[#79889E] font-mono font-bold uppercase">
                        {m.role === 'user' ? 'Operator' : 'DeepSeek Architect'}
                      </div>
                      <p className="whitespace-pre-line">{m.content}</p>
                    </div>
                  </div>
                ))}
                {isThinking && (
                  <div className="flex justify-start">
                    <div className="bg-[#101522] border border-[#1D263B] rounded-2xl p-3 text-xs text-[#8E9CAE] flex items-center gap-2 animate-pulse">
                      <Sparkles className="w-3.5 h-3.5 text-[#00F5D4] animate-spin" /> DeepSeek is reasoning & synthesizing...
                    </div>
                  </div>
                )}
                <div ref={chatBottomRef} />
              </div>

              {/* Ready to generate prompt banner */}
              {readyToGenerate && (
                <div className="p-3 mb-3 bg-[#00F5D4]/10 border border-[#00F5D4]/40 rounded-2xl flex items-center justify-between">
                  <span className="text-xs text-[#00F5D4] font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> Ready to assemble workspace profile!
                  </span>
                  <button
                    onClick={handleGenerateProfile}
                    disabled={isThinking}
                    className="px-4 py-1.5 bg-[#00F5D4] hover:bg-[#00D2B6] text-black font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5"
                  >
                    Generate Profile <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Input Bar */}
              <div className="flex items-center gap-2 pt-2 border-t border-[#161D2B]">
                <button
                  onClick={toggleListening}
                  className={`p-3 rounded-2xl border transition-all ${
                    isListening
                      ? 'bg-[#FF2A85]/20 border-[#FF2A85] text-[#FF2A85] animate-pulse'
                      : 'bg-[#121724] border-[#20293C] text-[#8E9CAE] hover:text-white'
                  }`}
                  title="Speak via voice"
                >
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>

                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Describe client (e.g. 'Aarhus emergency plumbing, Lars, 895 kr/hr, 24/7 hotline')..."
                  className="flex-1 bg-[#0E131E] border border-[#1E2638] rounded-2xl px-4 py-3 text-xs text-white placeholder-[#5A687C] focus:outline-none focus:border-[#00F5D4]"
                />

                <button
                  onClick={() => handleSendMessage()}
                  disabled={!inputText.trim() || isThinking}
                  className="p-3 bg-[#00F5D4] hover:bg-[#00D2B6] text-black rounded-2xl font-bold disabled:opacity-40 transition-all"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            /* TAB 2: MANUAL FORM & FINE-TUNING */
            <div className="space-y-6">
              {!generatedPayload ? (
                <div className="text-center py-12 border border-dashed border-[#1E2638] rounded-2xl">
                  <p className="text-xs text-[#8E9CAE]">No profile generated yet.</p>
                  <button
                    onClick={() => setActiveTab('ai_interview')}
                    className="mt-2 text-xs text-[#00F5D4] underline"
                  >
                    Return to AI Interview
                  </button>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Top Bar: Identity & Passkey */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[11px] text-[#8E9CAE] block mb-1">Business Name</label>
                      <input
                        type="text"
                        value={generatedPayload.name}
                        onChange={(e) =>
                          setGeneratedPayload({ ...generatedPayload, name: e.target.value })
                        }
                        className="w-full bg-[#111724] border border-[#1E283C] rounded-xl px-3 py-2 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[#8E9CAE] block mb-1">Slug (URL path)</label>
                      <input
                        type="text"
                        value={generatedPayload.slug}
                        onChange={(e) =>
                          setGeneratedPayload({ ...generatedPayload, slug: e.target.value })
                        }
                        className="w-full bg-[#111724] border border-[#1E283C] rounded-xl px-3 py-2 text-xs text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[#8E9CAE] block mb-1">Client Passkey (PIN/Secret)</label>
                      <input
                        type="text"
                        value={generatedPayload.client_passkey}
                        onChange={(e) =>
                          setGeneratedPayload({ ...generatedPayload, client_passkey: e.target.value })
                        }
                        className="w-full bg-[#111724] border border-[#00F5D4]/40 rounded-xl px-3 py-2 text-xs text-[#00F5D4] font-mono font-bold"
                      />
                    </div>
                  </div>

                  {/* Owner Contact */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[11px] text-[#8E9CAE] block mb-1">Owner Name</label>
                      <input
                        type="text"
                        value={generatedPayload.owner_name}
                        onChange={(e) =>
                          setGeneratedPayload({ ...generatedPayload, owner_name: e.target.value })
                        }
                        className="w-full bg-[#111724] border border-[#1E283C] rounded-xl px-3 py-2 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[#8E9CAE] block mb-1">Owner Phone (E.164)</label>
                      <input
                        type="text"
                        value={generatedPayload.owner_phone}
                        onChange={(e) =>
                          setGeneratedPayload({ ...generatedPayload, owner_phone: e.target.value })
                        }
                        className="w-full bg-[#111724] border border-[#1E283C] rounded-xl px-3 py-2 text-xs text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[#8E9CAE] block mb-1">Default Language</label>
                      <select
                        value={generatedPayload.default_language}
                        onChange={(e) =>
                          setGeneratedPayload({
                            ...generatedPayload,
                            default_language: e.target.value as 'da-DK' | 'en-US',
                          })
                        }
                        className="w-full bg-[#111724] border border-[#1E283C] rounded-xl px-3 py-2 text-xs text-white"
                      >
                        <option value="da-DK">🇩🇰 Danish (da-DK)</option>
                        <option value="en-US">🇬🇧 English (en-US)</option>
                      </select>
                    </div>
                  </div>

                  {/* System Prompt Synthesized */}
                  <div>
                    <label className="text-[11px] text-[#8E9CAE] block mb-1">
                      Customer Voice Receptionist Prompt (DeepSeek Synthesized)
                    </label>
                    <textarea
                      rows={4}
                      value={generatedPayload.customer_system_prompt}
                      onChange={(e) =>
                        setGeneratedPayload({
                          ...generatedPayload,
                          customer_system_prompt: e.target.value,
                        })
                      }
                      className="w-full bg-[#111724] border border-[#1E283C] rounded-xl p-3 text-xs text-white font-mono leading-relaxed"
                    />
                  </div>

                  {/* Pricing Catalog Preview */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                        <Tag className="w-3.5 h-3.5 text-[#00F5D4]" /> Pricing Catalog ({generatedPayload.pricing_catalog.length} services)
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {generatedPayload.pricing_catalog.map((item, idx) => (
                        <div key={idx} className="p-2.5 bg-[#101522] border border-[#1E273A] rounded-xl text-xs space-y-1">
                          <span className="font-semibold text-white block">{item.service}</span>
                          <span className="text-[#00F5D4] font-mono">{item.price_dkk} DKK / {item.unit}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Deploy Button */}
                  <div className="pt-4 border-t border-[#1A2234] flex justify-end gap-3">
                    <button
                      onClick={() => setActiveTab('ai_interview')}
                      className="px-4 py-2 text-xs text-[#8E9CAE] hover:text-white"
                    >
                      Back to Interview
                    </button>
                    <button
                      onClick={handleDeployWorkspace}
                      disabled={isDeploying}
                      className="px-6 py-2.5 bg-gradient-to-r from-[#00F5D4] to-[#00D2B6] hover:brightness-110 text-black font-bold text-xs rounded-xl shadow-lg shadow-[#00F5D4]/20 flex items-center gap-2 transition-all disabled:opacity-50"
                    >
                      {isDeploying ? 'Deploying Database & Agent...' : 'Deploy Client Profile Instantly'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
