'use client';

import { useEffect, useState, useTransition } from 'react';
import { Bot, Volume2, Code2, PhoneCall, Check, Copy, ExternalLink, Sliders, Sparkles, ShieldCheck, Link2 } from 'lucide-react';
import { updateAgentConfig, generateAgentConfigAction, type ActionResult } from './actions';
import { CallPanel } from '@/components/call/CallPanel';
import { Badge, Card } from '@/components/ui/core';
import { EmptyState } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea, FormAlert, buttonClass } from '@/components/ui/form';
import { Spinner } from '@/components/ui/SubmitButton';
import { Tabs, tabPanelProps } from '@/components/ui/Tabs';
import { Dialog } from '@/components/ui/Dialog';

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
  initial: { customer_system_prompt: string; copilot_system_prompt: string; greeting_script: string | null; voice_id: string | null };
}

const VOICES = [
  { id: 'azure:da-DK-ChristelNeural', provider: 'Microsoft Azure', name: 'Christel Neural', lang: 'Dansk', gender: 'Female', style: 'Warm, articulate Danish receptionist. Switches to English when the caller does.', recommended: true },
  { id: 'azure:en-US-NovaTurboMultilingualNeural', provider: 'Microsoft Azure', name: 'Nova Turbo', lang: 'Dansk / English', gender: 'Female', style: 'A lively, multilingual voice for Danish and international callers.' },
  { id: 'azure:da-DK-JeppeNeural', provider: 'Microsoft Azure', name: 'Jeppe Neural', lang: 'Dansk', gender: 'Male', style: 'A calm, clear Danish voice for service and dispatch conversations.' },
  { id: 'azure:en-US-JennyNeural', provider: 'Microsoft Azure', name: 'Jenny Neural', lang: 'English · US', gender: 'Female', style: 'Friendly customer service with clear enunciation.' },
  { id: 'azure:en-US-GuyNeural', provider: 'Microsoft Azure', name: 'Guy Neural', lang: 'English · US', gender: 'Male', style: 'A confident, conversational voice for everyday business.' },
  { id: 'azure:en-US-AriaNeural', provider: 'Microsoft Azure', name: 'Aria Neural', lang: 'English · US', gender: 'Female', style: 'An expressive voice for clinics and customer care.' },
  { id: 'cartesia:sonic-3', provider: 'Cartesia', name: 'Sonic-3 Stream', lang: 'Dansk / English', gender: 'Neural', style: 'Streaming neural voice with Danish and English support.' },
];
const DEFAULT_VOICE = 'azure:da-DK-ChristelNeural';
type StudioTab = 'prompt' | 'voice' | 'simulator' | 'embed';

export function PromptEditor({ tenantId, tenantSlug = 'tenant', tenantName = 'Client workspace', defaultLanguage = 'da-DK', contactId, contactName = 'Caller', initial }: PromptEditorProps) {
  const [activeTab, setActiveTab] = useState<StudioTab>('prompt');
  const [customerPrompt, setCustomerPrompt] = useState(initial.customer_system_prompt);
  const [copilotPrompt, setCopilotPrompt] = useState(initial.copilot_system_prompt);
  const [greeting, setGreeting] = useState(initial.greeting_script ?? '');
  const [selectedVoice, setSelectedVoice] = useState(initial.voice_id ?? DEFAULT_VOICE);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showAiModal, setShowAiModal] = useState(false);
  const [genCompany, setGenCompany] = useState(tenantName);
  const [genIndustry, setGenIndustry] = useState(defaultLanguage.startsWith('da') ? 'VVS og Varmepumper' : 'Plumbing & HVAC');
  const [genTone, setGenTone] = useState<'professional' | 'warm' | 'urgent_dispatcher'>('professional');
  const [genServices, setGenServices] = useState(defaultLanguage.startsWith('da') ? 'Døgnvagt, sprængte rør, serviceeftersyn og tilbud på badeværelser' : 'Emergency leak repair, boiler maintenance and bathroom consultations');
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [origin, setOrigin] = useState('');
  const [copyState, setCopyState] = useState<'embed' | 'link' | null>(null);
  const [copyError, setCopyError] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => {
    if (!copyState) return;
    const timer = setTimeout(() => setCopyState(null), 2000);
    return () => clearTimeout(timer);
  }, [copyState]);

  const isDirty = customerPrompt !== initial.customer_system_prompt || copilotPrompt !== initial.copilot_system_prompt || greeting !== (initial.greeting_script ?? '') || selectedVoice !== (initial.voice_id ?? DEFAULT_VOICE);
  const hasContact = Boolean(contactId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contactId));
  const directCallUrl = hasContact && origin ? `${origin}/call/${contactId}` : '';
  const embedSnippet = `<script\n  src="${origin}/widget.js"\n  data-tenant="${tenantSlug}"\n  data-contact="${contactId}"\n  data-primary-color="#7C3AED"\n  defer>\n</script>`;
  const provider = selectedVoice.split(':')[0];

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isPending || !isDirty) return;
    const data = new FormData();
    data.set('tenantId', tenantId);
    data.set('customer_system_prompt', customerPrompt);
    data.set('copilot_system_prompt', copilotPrompt);
    data.set('greeting_script', greeting);
    data.set('voice_id', selectedVoice);
    startTransition(async () => {
      try { setResult(await updateAgentConfig(data)); }
      catch { setResult({ ok: false, error: 'Could not save the agent. Please try again.' }); }
    });
  }

  async function handleGeneratePrompt() {
    if (isGenerating) return;
    setIsGenerating(true);
    setGenError('');
    try {
      const response = await generateAgentConfigAction({ companyName: genCompany, industry: genIndustry, language: defaultLanguage.toLowerCase().startsWith('da') ? 'da' : 'en', tone: genTone, keyServices: genServices });
      if (response.ok && response.data) {
        setCustomerPrompt(response.data.customer_system_prompt);
        setCopilotPrompt(response.data.copilot_system_prompt);
        setGreeting(response.data.greeting_script);
        if (response.data.voice_id) setSelectedVoice(response.data.voice_id);
        setShowAiModal(false);
        setResult({ ok: true, message: 'Draft generated. Review the prompt and voice, then save your changes.' });
      } else setGenError(response.error ?? 'Generation failed. Please try again.');
    } catch { setGenError('The assistant could not be reached. Please try again.'); }
    finally { setIsGenerating(false); }
  }

  async function copy(kind: 'embed' | 'link', value: string) {
    setCopyError('');
    try { await navigator.clipboard.writeText(value); setCopyState(kind); }
    catch { setCopyError('Clipboard access was blocked. Select the text and copy it manually.'); }
  }

  const tabs = [
    { id: 'prompt' as const, label: 'Prompt & logic', icon: <Sliders size={15} /> },
    { id: 'voice' as const, label: 'Voice', icon: <Volume2 size={15} /> },
    { id: 'simulator' as const, label: 'Simulator', icon: <PhoneCall size={15} /> },
    { id: 'embed' as const, label: 'Share & embed', icon: <Code2 size={15} /> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2.5"><Bot size={20} strokeWidth={1.6} className="text-[var(--accent-primary)]" aria-hidden /><div><h3 className="text-[15px] font-semibold tracking-[-0.02em]">Agent studio</h3><p className="mt-0.5 text-[12px] text-[var(--muted)]">Voice provider: {provider === 'azure' ? 'Microsoft Azure' : provider === 'cartesia' ? 'Cartesia' : provider}</p></div></div><Badge tone="neutral"><ShieldCheck size={12} />Agency only</Badge></div>
      <Tabs id="agent-studio" items={tabs} value={activeTab} onChange={setActiveTab} label="Agent studio sections" />
      <form onSubmit={handleSubmit} className="space-y-6" aria-busy={isPending}>
        <div key="prompt" {...tabPanelProps('agent-studio', activeTab, 'prompt')} className="tab-enter space-y-5">
          <div className="notice notice-info items-center"><Sparkles size={18} className="mt-0.5 shrink-0 text-[var(--accent-primary)]" aria-hidden /><div className="flex-1"><p className="text-[13px] font-medium text-[var(--text)]">Start with a tailored draft</p><p className="mt-0.5 text-[12px] text-[var(--muted)]">Generate a prompt and greeting from the business details. Review before saving.</p></div><button type="button" onClick={() => { setGenError(''); setShowAiModal(true); }} className={buttonClass('secondary', 'sm')}><Sparkles size={13} />Generate with AI</button></div>
          <Field htmlFor="greeting" label="Opening spoken greeting" hint="Spoken before the caller responds"><Input id="greeting" value={greeting} onChange={(event) => setGreeting(event.target.value)} placeholder={`Goddag, du har ringet til ${tenantName}. Hvad kan jeg hjælpe dig med?`} maxLength={500} /></Field>
          <Field htmlFor="customer_prompt" label="Voice receptionist prompt" hint={`${customerPrompt.length} / 8,000 characters`}><Textarea id="customer_prompt" rows={10} value={customerPrompt} onChange={(event) => setCustomerPrompt(event.target.value)} className="font-mono text-[12px] leading-6" spellCheck={false} maxLength={8000} /></Field>
          <p className="text-[12px] leading-5 text-[var(--muted)]">Combined with live business hours, verified prices, approved knowledge and the escalation policy before each call.</p>
          <Field htmlFor="copilot_prompt" label="Owner co-pilot prompt" hint={`${copilotPrompt.length} / 8,000 characters`}><Textarea id="copilot_prompt" rows={5} value={copilotPrompt} onChange={(event) => setCopilotPrompt(event.target.value)} className="font-mono text-[12px] leading-6" spellCheck={false} maxLength={8000} /></Field>
        </div>
        <div key="voice" {...tabPanelProps('agent-studio', activeTab, 'voice')} className="tab-enter space-y-4"><p className="text-[13px] leading-6 text-[var(--muted)]">Choose the voice for this business. Your saved selection is used on the next call.</p><fieldset><legend className="sr-only">Receptionist voice</legend><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{VOICES.map((voice) => {
          const selected = selectedVoice === voice.id;
          return <label key={voice.id} className={`voice-option glass relative cursor-pointer p-4 transition-[border-color,background-color,transform] hover:-translate-y-0.5 ${selected ? 'border-[var(--accent-primary)] bg-[var(--accent-soft)]' : 'hover:border-[var(--border-strong)]'}`}><input type="radio" name="voice" value={voice.id} checked={selected} onChange={() => setSelectedVoice(voice.id)} className="sr-only" /><span className="flex items-start justify-between gap-2"><span><span className="block text-[13px] font-semibold">{voice.name}</span><span className="mt-1 block text-[11px] text-[var(--muted)]">{voice.provider}</span></span>{selected ? <Check size={16} className="shrink-0 text-[var(--accent-primary)]" aria-label="Selected" /> : null}</span><span className="mt-3 flex flex-wrap gap-1.5"><Badge tone="neutral">{voice.lang}</Badge><Badge tone="neutral">{voice.gender}</Badge>{voice.recommended ? <Badge tone="accent">Default</Badge> : null}</span><span className="mt-3 block text-[12px] leading-5 text-[var(--text-secondary)]">{voice.style}</span></label>;
        })}</div></fieldset>{!VOICES.some((voice) => voice.id === selectedVoice) ? <p className="text-[12px] text-[var(--muted)]">Currently saved voice: <code>{selectedVoice}</code>. Select a listed voice to replace it.</p> : null}</div>
        <div key="simulator" {...tabPanelProps('agent-studio', activeTab, 'simulator')} className="tab-enter space-y-4">{activeTab === 'simulator' ? <><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-[14px] font-medium">Browser simulator</h3><p className="mt-1 text-[12px] text-[var(--muted)]">Test the receptionist over LiveKit. Save changes before placing a test call.</p></div>{directCallUrl ? <a href={directCallUrl} target="_blank" rel="noreferrer" className={buttonClass('ghost', 'sm')}>Open full screen<ExternalLink size={13} /></a> : null}</div>{hasContact ? <Card className="p-5"><CallPanel tenantId={tenantId} tenantSlug={tenantSlug} contactId={contactId!} contactName={contactName} isDanish={defaultLanguage.startsWith('da')} /></Card> : <Card><EmptyState icon={<PhoneCall size={20} />} title="Add a caller before testing" description="Create a caller in the client portal, then return here to test the receptionist with that caller’s context." /></Card>}{isDirty ? <p className="text-[12px] text-[var(--warning)]">You have unsaved changes. The simulator uses the last saved configuration.</p> : null}</> : null}</div>
        <div key="embed" {...tabPanelProps('agent-studio', activeTab, 'embed')} className="tab-enter space-y-5">{hasContact && origin ? <>
          <div><h3 className="text-[14px] font-medium">Put the receptionist on their website</h3><p className="mt-1 text-[12px] leading-5 text-[var(--muted)]">Paste this snippet before the closing body tag. It opens a compact browser-call panel for {contactName}.</p></div>
          <div className="relative"><pre className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] p-4 pr-24 font-mono text-[12px] leading-6">{embedSnippet}</pre><button type="button" onClick={() => void copy('embed', embedSnippet)} className={buttonClass('secondary', 'sm', 'absolute right-3 top-3')}>{copyState === 'embed' ? <Check size={13} /> : <Copy size={13} />}{copyState === 'embed' ? 'Copied' : 'Copy'}</button></div>
          <Field htmlFor="direct-call-link" label="Direct browser-call link" hint="Share by email or SMS"><div className="flex items-center gap-2"><Input id="direct-call-link" readOnly value={directCallUrl} className="min-w-0 flex-1 font-mono text-[12px]" /><button type="button" onClick={() => void copy('link', directCallUrl)} className={buttonClass('secondary', 'md', 'shrink-0')}>{copyState === 'link' ? <Check size={14} /> : <Link2 size={14} />}{copyState === 'link' ? 'Copied' : 'Copy'}</button></div></Field>
          <p className="text-[12px] leading-5 text-[var(--muted)]">This link is scoped to one caller. Generate a separate link for each customer; never share one customer’s link with another.</p>
        </> : <Card><EmptyState icon={<Link2 size={20} />} title="No shareable caller link yet" description="Add a caller in the client portal to create a real, customer-scoped call link and website widget." /></Card>}{copyError ? <FormAlert tone="error">{copyError}</FormAlert> : null}</div>
        {result ? <FormAlert tone={result.ok ? 'success' : 'error'}>{result.ok ? result.message : result.error}</FormAlert> : null}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-5"><p className="text-[12px] text-[var(--muted)]">{isDirty ? <span className="text-[var(--warning)]">Unsaved changes</span> : 'Changes apply to the next conversation after saving.'}</p><button type="submit" disabled={isPending || !isDirty} aria-busy={isPending} className={buttonClass('primary')}>{isPending ? <Spinner /> : <Check size={15} />}{isPending ? 'Saving changes…' : 'Save changes'}</button></div>
      </form>
      <Dialog open={showAiModal} onClose={() => setShowAiModal(false)} title="AI agent architect" description="Draft instructions from the business context. Nothing goes live until you review and save." footer={<><button type="button" onClick={() => setShowAiModal(false)} className={buttonClass('ghost')}>Cancel</button><button type="button" onClick={handleGeneratePrompt} disabled={isGenerating || !genCompany.trim() || !genIndustry.trim()} aria-busy={isGenerating} className={buttonClass('primary')}>{isGenerating ? <Spinner /> : <Sparkles size={15} />}{isGenerating ? 'Generating draft…' : 'Generate draft'}</button></>}>
        <div className="space-y-4">{genError ? <FormAlert tone="error">{genError}</FormAlert> : null}<Field htmlFor="gen-company" label="Company name"><Input id="gen-company" value={genCompany} onChange={(event) => setGenCompany(event.target.value)} disabled={isGenerating} /></Field><Field htmlFor="gen-industry" label="Industry or trade"><Input id="gen-industry" value={genIndustry} onChange={(event) => setGenIndustry(event.target.value)} placeholder="e.g. Dental clinic, auto repair, legal practice" disabled={isGenerating} /></Field><Field htmlFor="gen-services" label="Key services"><Textarea id="gen-services" rows={3} value={genServices} onChange={(event) => setGenServices(event.target.value)} disabled={isGenerating} /></Field><Field htmlFor="gen-tone" label="Personality and tone"><Select id="gen-tone" value={genTone} onChange={(event) => setGenTone(event.target.value as typeof genTone)} disabled={isGenerating}><option value="professional">Professional and polite</option><option value="warm">Warm and empathetic</option><option value="urgent_dispatcher">Urgent dispatcher · emergency trades</option></Select></Field></div>
      </Dialog>
    </div>
  );
}
