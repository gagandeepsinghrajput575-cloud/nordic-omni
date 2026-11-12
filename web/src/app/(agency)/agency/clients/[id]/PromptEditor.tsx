'use client';

import { useState, useTransition } from 'react';
import {
  updateAgentConfig,
  generateAgentConfigAction,
  type ActionResult,
} from './actions';
import { CallPanel } from '@/components/call/CallPanel';
import {
  Mic,
  Sparkles,
  Bot,
  Volume2,
  Code2,
  Play,
  Check,
  Copy,
  ExternalLink,
  PhoneCall,
  Sliders,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';

const GEN_TONES = ['professional', 'warm', 'urgent_dispatcher'] as const;
type GenTone = (typeof GEN_TONES)[number];

function isGenTone(value: string): value is GenTone {
  return GEN_TONES.some((tone) => tone === value);
}

interface PromptEditorProps {
  tenantId: string;
  tenantSlug?: string;
  tenantName?: string;
  defaultLanguage?: string;
  contactId?: string;
  contactName?: string;
  initial: {
    customer_system_prompt: string;
    copilot_system_prompt: string;
    greeting_script: string | null;
    voice_id: string | null;
  };
}

const VOICES = [
  {
    id: 'azure:da-DK-ChristelNeural',
    provider: 'Microsoft Azure',
    name: 'Christel Neural (Native Danish)',
    lang: 'Dansk (da-DK)',
    flag: '🇩🇰',
    gender: 'Female',
    style: '100% Native Copenhagen Danish. Warm, articulate receptionist. Switches to English with Danish accent.',
    recommended: true,
  },
  {
    id: 'azure:en-US-NovaTurboMultilingualNeural',
    provider: 'Microsoft Azure (OpenAI Turbo)',
    name: 'Nova Turbo (Multilingual)',
    lang: 'Bilingual (da-DK / en-US)',
    flag: '🇩🇰/🇺🇸',
    gender: 'Female',
    style: 'Warm, dynamic, high human emotion & lively conversational tempo. Fluent Danish with international lilt.',
  },
  {
    id: 'azure:da-DK-JeppeNeural',
    provider: 'Microsoft Azure',
    name: 'Jeppe Neural',
    lang: 'Dansk (da-DK)',
    flag: '🇩🇰',
    gender: 'Male',
    style: 'Calm, authoritative technician voice. Ideal for emergency dispatch & trades.',
  },
  {
    id: 'azure:en-US-JennyNeural',
    provider: 'Microsoft Azure',
    name: 'Jenny Neural',
    lang: 'English (US)',
    flag: '🇺🇸',
    gender: 'Female',
    style: 'Natural, friendly customer service voice with clear enunciation.',
  },
  {
    id: 'azure:en-US-GuyNeural',
    provider: 'Microsoft Azure',
    name: 'Guy Neural',
    lang: 'English (US)',
    flag: '🇺🇸',
    gender: 'Male',
    style: 'Casual, confident, conversational voice for general business.',
  },
  {
    id: 'azure:en-US-AriaNeural',
    provider: 'Microsoft Azure',
    name: 'Aria Neural',
    lang: 'English (US)',
    flag: '🇺🇸',
    gender: 'Female',
    style: 'Expressive and empathetic. Excellent for healthcare & clinic appointments.',
  },
  {
    id: 'cartesia:sonic-3',
    provider: 'Cartesia',
    name: 'Sonic-3 Stream',
    lang: 'Danish & English',
    flag: '⚡',
    gender: 'Neural',
    style: 'Ultra-low latency (~400ms turnaround) with dual Danish & English fluency.',
  },
];

export function PromptEditor({
  tenantId,
  tenantSlug = 'tenant',
  tenantName = 'Client Workspace',
  defaultLanguage = 'da-DK',
  contactId = 'demo-caller',
  contactName = 'Demo Caller',
  initial,
}: PromptEditorProps) {
  const [activeTab, setActiveTab] = useState<'prompt' | 'voice' | 'simulator' | 'embed'>('prompt');
  const [customerPrompt, setCustomerPrompt] = useState(initial.customer_system_prompt);
  const [copilotPrompt, setCopilotPrompt] = useState(initial.copilot_system_prompt);
  const [greeting, setGreeting] = useState(initial.greeting_script ?? '');
  const [selectedVoice, setSelectedVoice] = useState(initial.voice_id ?? 'azure:da-DK-ChristelNeural');
  const [result, setResult] = useState<ActionResult | null>(null);
  const [isPending, startTransition] = useTransition();

  // AI Generator Modal state
  const [showAiModal, setShowAiModal] = useState(false);
  const [genCompany, setGenCompany] = useState(tenantName);
  const [genIndustry, setGenIndustry] = useState(
    defaultLanguage.startsWith('da') ? 'VVS og Varmepumper' : 'Emergency Plumbing & HVAC'
  );
  const [genTone, setGenTone] = useState<GenTone>('professional');
  const [genServices, setGenServices] = useState(
    defaultLanguage.startsWith('da')
      ? 'Døgnvagt udrykning, sprængte rør, serviceeftersyn og tilbud på badeværelser'
      : '24/7 emergency leak repair, boiler maintenance, and bathroom consultations'
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  const isDirty =
    customerPrompt !== initial.customer_system_prompt ||
    copilotPrompt !== initial.copilot_system_prompt ||
    greeting !== (initial.greeting_script ?? '') ||
    selectedVoice !== (initial.voice_id ?? 'azure:da-DK-ChristelNeural');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const fd = new FormData();
    fd.set('tenantId', tenantId);
    fd.set('customer_system_prompt', customerPrompt);
    fd.set('copilot_system_prompt', copilotPrompt);
    fd.set('greeting_script', greeting);
    fd.set('voice_id', selectedVoice);

    startTransition(async () => {
      const res = await updateAgentConfig(fd);
      setResult(res);
    });
  }

  async function handleGeneratePrompt() {
    setIsGenerating(true);
    try {
      const isDa = defaultLanguage.toLowerCase().startsWith('da');
      const res = await generateAgentConfigAction({
        companyName: genCompany,
        industry: genIndustry,
        language: isDa ? 'da' : 'en',
        tone: genTone,
        keyServices: genServices,
      });

      if (res.ok && res.data) {
        setCustomerPrompt(res.data.customer_system_prompt);
        setCopilotPrompt(res.data.copilot_system_prompt);
        setGreeting(res.data.greeting_script);
        if (res.data.voice_id) {
          setSelectedVoice(res.data.voice_id);
        }
        setShowAiModal(false);
        setResult({
          ok: true,
          message: 'AI generated new agent prompts! Click "Save Agent Studio" to apply.',
        });
      } else {
        setResult({ ok: false, error: res.error ?? 'Generation failed' });
      }
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : 'Error generating' });
    } finally {
      setIsGenerating(false);
    }
  }

  const embedScriptSnippet = `<!-- Nordic-Omni Voice & Chat Agent Widget -->
<script
  src="${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/widget.js"
  data-tenant="${tenantSlug}"
  data-primary-color="#6366F1"
  defer>
</script>`;

  const directCallUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/call/demo-caller-${tenantSlug}`
    : `http://localhost:3000/call/demo-caller-${tenantSlug}`;

  const field =
    'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-ground)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]';

  return (
    <div className="space-y-6">
      {/* Studio Header & Sub-Nav */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-semibold">Retell-Grade Agent Studio</div>
            <div className="text-[10px] text-[var(--text-muted)]">
              Voice Provider: <span className="font-mono text-[var(--text-primary)]">{selectedVoice.split(':')[0].toUpperCase()}</span> · Model: <span className="font-mono text-[var(--text-primary)]">Gemini 2.5 Flash</span>
            </div>
          </div>
        </div>

        {/* Pulse Segmented Tab Controls */}
        <div className="flex items-center gap-1 rounded-xl border border-[var(--line)] bg-[rgba(0,0,0,0.35)] p-1 text-[11px]">
          <button
            type="button"
            onClick={() => setActiveTab('prompt')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition-all ${
              activeTab === 'prompt'
                ? 'bg-gradient-to-r from-[#8b5cf6]/80 to-[#22d3ee]/80 text-white shadow-md'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            Prompt & Logic
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('voice')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition-all ${
              activeTab === 'voice'
                ? 'bg-gradient-to-r from-[#8b5cf6]/80 to-[#22d3ee]/80 text-white shadow-md'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <Volume2 className="h-3.5 w-3.5" />
            Voice Studio
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('simulator')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition-all ${
              activeTab === 'simulator'
                ? 'bg-gradient-to-r from-[#8b5cf6]/80 to-[#22d3ee]/80 text-white shadow-md'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <PhoneCall className="h-3.5 w-3.5" />
            Simulator
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('embed')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition-all ${
              activeTab === 'embed'
                ? 'bg-gradient-to-r from-[#8b5cf6]/80 to-[#22d3ee]/80 text-white shadow-md'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <Code2 className="h-3.5 w-3.5" />
            Share & Embed
          </button>
        </div>
      </div>

      {/* Main Studio Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* TAB 1: PROMPT & LOGIC */}
        {activeTab === 'prompt' && (
          <div className="space-y-5">
            <div className="flex items-center justify-between rounded-xl border border-[var(--accent-primary)]/20 bg-[var(--accent-primary)]/5 p-3">
              <div>
                <div className="text-xs font-semibold text-[var(--accent-primary)]">
                  ✨ Instant Agent Builder
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  Spin up a complete agent prompt, greeting, and rules in seconds with AI.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAiModal(true)}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-contrast)] shadow-sm hover:opacity-90"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Generate with AI
              </button>
            </div>

            <div>
              <label htmlFor="greeting" className="mb-1.5 block text-xs font-medium">
                Opening Spoken Greeting <span className="text-[var(--text-muted)]">(spoken first before user speaks)</span>
              </label>
              <input
                id="greeting"
                type="text"
                value={greeting}
                onChange={(e) => setGreeting(e.target.value)}
                placeholder="e.g. Goddag, du har ringet til København VVS. Hvad kan jeg hjælpe dig med?"
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-ground)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] font-mono"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <label htmlFor="customer_prompt" className="text-xs font-medium">
                  Voice Receptionist System Prompt
                </label>
                <span className="font-mono text-[10px] text-[var(--text-muted)]">
                  {customerPrompt.length} chars
                </span>
              </div>
              <textarea
                id="customer_prompt"
                rows={10}
                value={customerPrompt}
                onChange={(e) => setCustomerPrompt(e.target.value)}
                className={field}
                spellCheck={false}
              />
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                The agent dynamically combines this with live database facts: open/closed hours, verified prices, knowledge items, and emergency escalation policies.
              </p>
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <label htmlFor="copilot_prompt" className="text-xs font-medium">
                  Owner Co-Pilot Prompt
                </label>
                <span className="font-mono text-[10px] text-[var(--text-muted)]">
                  {copilotPrompt.length} chars
                </span>
              </div>
              <textarea
                id="copilot_prompt"
                rows={4}
                value={copilotPrompt}
                onChange={(e) => setCopilotPrompt(e.target.value)}
                className={field}
                spellCheck={false}
              />
            </div>
          </div>
        )}

        {/* TAB 2: VOICE STUDIO */}
        {activeTab === 'voice' && (
          <div className="space-y-4">
            <div className="text-xs text-[var(--text-secondary)]">
              Choose the neural voice persona for this client. Changes take effect on the next phone or WebRTC call.
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {VOICES.map((v) => {
                const isSelected = selectedVoice === v.id;
                return (
                  <div
                    key={v.id}
                    onClick={() => setSelectedVoice(v.id)}
                    className={`glass cursor-pointer rounded-2xl p-4 transition-all duration-150 ${
                      isSelected
                        ? 'border-[var(--a)] bg-[rgba(139,92,246,0.16)] shadow-[0_8px_26px_rgba(139,92,246,0.25)] ring-1 ring-[var(--a)]'
                        : 'hover:border-white/[0.18] hover:-translate-y-0.5'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="text-xl">{v.flag}</span>
                        <div>
                          <div className="text-xs font-bold text-[var(--text)]">{v.name}</div>
                          <div className="text-[10px] text-[var(--muted)]">{v.provider}</div>
                        </div>
                      </div>
                      {isSelected && (
                        <span
                          className="rounded-full p-1 text-white shadow"
                          style={{ background: 'var(--grad)' }}
                        >
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex items-center gap-2 text-[10px]">
                      <span className="rounded-md border border-[var(--line)] bg-white/[0.04] px-2 py-0.5 font-mono text-[var(--muted)]">
                        {v.gender}
                      </span>
                      <span className="rounded-md border border-[var(--line)] bg-white/[0.04] px-2 py-0.5 font-mono text-[#a5f3fc]">
                        {v.lang}
                      </span>
                    </div>

                    <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--muted)]">
                      {v.style}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: LIVE SIMULATOR */}
        {activeTab === 'simulator' && (
          <div className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-ground)] p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                  Interactive Browser Simulator
                </h3>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Test your prompt, tools, and voice response directly in the browser over LiveKit WebRTC.
                </p>
              </div>
              <a
                href={directCallUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[11px] text-[var(--accent-primary)] hover:underline"
              >
                Open full screen <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <CallPanel
                tenantId={tenantId}
                tenantSlug={tenantSlug}
                contactId={contactId}
                contactName={contactName}
                isDanish={defaultLanguage.startsWith('da')}
              />
            </div>
          </div>
        )}

        {/* TAB 4: EMBED & SHARE */}
        {activeTab === 'embed' && (
          <div className="space-y-5">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                Website Embed Snippet
              </h3>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Your client can paste this 1-line script onto their website (WordPress, Webflow, Shopify, custom HTML) to give visitors 24/7 AI voice and chat reception.
              </p>
            </div>

            <div className="relative">
              <pre className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-ground)] p-4 font-mono text-[11px] text-[var(--text-primary)] leading-relaxed">
                {embedScriptSnippet}
              </pre>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(embedScriptSnippet);
                  setCopiedEmbed(true);
                  setTimeout(() => setCopiedEmbed(false), 2000);
                }}
                className="absolute right-3 top-3 flex items-center gap-1 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                {copiedEmbed ? <Check className="h-3 w-3 text-[var(--success)]" /> : <Copy className="h-3 w-3" />}
                {copiedEmbed ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div>
              <h4 className="text-xs font-medium">Direct WebRTC Customer Call Link</h4>
              <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                Share this link in SMS, email, or marketing ads for direct 1-click calls.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={directCallUrl}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-ground)] px-3 py-2 font-mono text-xs text-[var(--text-primary)]"
                />
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(directCallUrl)}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Result Message */}
        {result && (
          <p
            role="status"
            className={`rounded-lg border px-3 py-2 text-xs ${
              result.ok
                ? 'border-[var(--success)]/40 bg-[var(--success)]/10 text-[var(--success)]'
                : 'border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)]'
            }`}
          >
            {result.ok ? result.message : result.error}
          </p>
        )}

        {/* Submit Actions */}
        <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] pt-4">
          <button
            type="submit"
            disabled={isPending || !isDirty}
            className="rounded-lg bg-[var(--accent-primary)] px-5 py-2.5 text-xs font-semibold text-[var(--accent-contrast)] transition hover:opacity-90 disabled:opacity-40"
          >
            {isPending ? 'Saving Agent Studio…' : 'Save Agent Studio'}
          </button>
          {isDirty && !isPending && (
            <span className="text-[11px] text-[var(--warning)]">You have unsaved changes</span>
          )}
        </div>
      </form>

      {/* AI GENERATOR MODAL */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[var(--accent-primary)]" />
                <h3 className="text-sm font-semibold">AI Agent Architect</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAiModal(false)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3.5">
              <div>
                <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                  Company Name
                </label>
                <input
                  type="text"
                  value={genCompany}
                  onChange={(e) => setGenCompany(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-ground)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                  Industry / Trade
                </label>
                <input
                  type="text"
                  value={genIndustry}
                  onChange={(e) => setGenIndustry(e.target.value)}
                  placeholder="e.g. Tandlægeklinik, Autoværksted, Advokatfirma"
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-ground)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                  Key Services & Focus
                </label>
                <textarea
                  rows={2}
                  value={genServices}
                  onChange={(e) => setGenServices(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-ground)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                  Agent Persona & Tone
                </label>
                <select
                  value={genTone}
                  onChange={(e) => {
                    if (isGenTone(e.target.value)) setGenTone(e.target.value);
                  }}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-ground)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
                >
                  <option value="professional">Professional & Polite (Corporate & Standard)</option>
                  <option value="warm">Warm & Empathetic (Clinics & Healthcare)</option>
                  <option value="urgent_dispatcher">Urgent Dispatcher (24/7 Emergency Trades)</option>
                </select>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
              <button
                type="button"
                onClick={() => setShowAiModal(false)}
                className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGeneratePrompt}
                disabled={isGenerating}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {isGenerating ? 'Synthesizing...' : 'Synthesize Production Agent'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
