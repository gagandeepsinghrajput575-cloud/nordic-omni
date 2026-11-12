'use client';

import { useActionState } from 'react';
import { BrainCircuit, CheckCircle2, ChevronDown, FileText, Globe2, ShieldAlert } from 'lucide-react';
import { approveBrainAction, compileBrainAction, rejectBrainAction } from './brain-actions';
import { EMPTY_STATE } from '@/lib/actions/types';
import type { BrainPayload } from '@/lib/ai/brain';
import { Badge, Card, CardHeader } from '@/components/ui/core';
import { Field, Input, Textarea, FormAlert, buttonClass } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';

interface BundleView {
  id: string; status: 'draft' | 'approved' | 'rejected'; compiler_model: string; summary: string;
  payload: BrainPayload; warnings: string[]; created_at: string; approved_at: string | null;
  sources: Array<{ id: string; kind: string; title: string; location: string | null }>;
}

export function AiBrainPanel({ tenantId, bundle }: { tenantId: string; bundle: BundleView | null }) {
  const [state, formAction, pending] = useActionState(compileBrainAction, EMPTY_STATE);
  const fallback = bundle?.compiler_model === 'fallback';
  return (
    <Card>
      <CardHeader title="AI brain" hint="Compile the client’s website and owner notes into reviewed knowledge, guardrails and qualification rules." action={bundle ? <Badge tone={bundle.status === 'approved' ? 'success' : bundle.status === 'rejected' ? 'danger' : 'warning'}>{bundle.status}</Badge> : <Badge tone="neutral">No draft yet</Badge>} />
      <div className="grid gap-8 p-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <form action={formAction} className="space-y-5">
          <input type="hidden" name="tenantId" value={tenantId} />
          {state.error ? <FormAlert tone="error">{state.error}</FormAlert> : null}
          {state.ok && state.message ? <FormAlert tone="success">{state.message}</FormAlert> : null}
          <Field htmlFor="brain-website" label="Website" hint="Homepage plus up to three service/about pages"><Input id="brain-website" name="websiteUrl" type="url" inputMode="url" placeholder="https://example.com" /></Field>
          <Field htmlFor="brain-notes" label="Owner notes" hint="Facts the website does not state"><Textarea id="brain-notes" name="notes" rows={5} placeholder="Service area, guarantees, what you never promise, common questions and when the owner should be called…" /></Field>
          <Field htmlFor="brain-documents" label="Document text" hint="Price list, onboarding notes or a service description"><Textarea id="brain-documents" name="documentText" rows={4} placeholder="Paste text from a price list or business description." /></Field>
          <div className="flex flex-wrap items-center gap-3"><SubmitButton pendingLabel="Reading and compiling…"><BrainCircuit size={15} />Compile draft</SubmitButton><p className="max-w-[300px] text-[12px] leading-5 text-[var(--muted)]">Nothing goes live until an agency operator approves the draft.</p></div>
          {pending ? <p className="text-[12px] text-[var(--muted)]" role="status">Fetching pages and extracting facts can take up to a minute.</p> : null}
        </form>
        <div className="min-w-0">{!bundle ? <div className="surface-raised flex h-full flex-col justify-center p-6"><Globe2 size={22} className="text-[var(--accent-primary)]" aria-hidden /><h3 className="mt-4 text-[15px] font-semibold tracking-[-0.02em]">Start with what the business already has</h3><p className="mt-2 text-[13px] leading-6 text-[var(--text-secondary)]">The compiler reads only supplied material. It cannot invent certifications, prices, coverage or response times; missing facts become questions for the owner.</p></div> : <BrainDraftReview tenantId={tenantId} bundle={bundle} fallback={fallback} />}</div>
      </div>
    </Card>
  );
}

function BrainDraftReview({ tenantId, bundle, fallback }: { tenantId: string; bundle: BundleView; fallback: boolean }) {
  const counts = [['Services', bundle.payload.services.length], ['FAQs', bundle.payload.faqs.length], ['Rules', bundle.payload.policies.length + bundle.payload.guardrails.length], ['Questions', bundle.payload.qualification_questions.length]] as const;
  return (
    <div className="space-y-4">
      {fallback ? <FormAlert tone="error">AI compilation failed, so this draft cannot be approved. The sources are saved; retry compilation or add knowledge manually.</FormAlert> : null}
      <div className="surface-raised p-4"><div className="flex flex-wrap items-center gap-2"><Badge tone="neutral">{bundle.compiler_model}</Badge><span className="text-[11px] tabular-nums text-[var(--muted)]">{new Date(bundle.created_at).toLocaleString('da-DK')}</span></div><p className="mt-3 text-[13px] leading-6">{bundle.summary}</p></div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{counts.map(([label, value]) => <div key={label} className="rounded-lg border border-[var(--line)] p-3"><dt className="text-[11px] text-[var(--muted)]">{label}</dt><dd className="mt-1 text-[20px] font-medium tabular-nums tracking-[-0.03em]">{value}</dd></div>)}</dl>
      <details className="group rounded-lg border border-[var(--line)]"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[13px] font-medium text-[var(--text-secondary)]">Review extracted knowledge<ChevronDown size={15} className="transition-transform group-open:rotate-180" aria-hidden /></summary><div className="space-y-4 border-t border-[var(--line)] p-4 text-[12px] leading-6"><BrainSection title="Services" items={bundle.payload.services.map((item) => `${item.name}: ${item.description}`)} /><BrainSection title="FAQs" items={bundle.payload.faqs.map((item) => `${item.question} → ${item.answer}`)} /><BrainSection title="Guardrails" items={bundle.payload.guardrails} /><BrainSection title="Qualification" items={bundle.payload.qualification_questions.map((item) => item.question)} /><BrainSection title="Escalation triggers" items={bundle.payload.escalation_triggers} /><BrainSection title="Gaps to confirm" items={bundle.payload.uncertainties} /></div></details>
      <div className="rounded-lg border border-[var(--line)] p-4"><h3 className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-secondary)]"><FileText size={13} aria-hidden />Sources</h3><ul className="mt-2 space-y-1.5">{bundle.sources.map((source) => <li key={source.id} className="break-words text-[12px] text-[var(--muted)]">{source.location || source.title}</li>)}</ul></div>
      {bundle.warnings.length > 0 ? <div className="notice notice-warning"><ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden /><div><p className="text-[12px] font-medium">Review notes</p>{bundle.warnings.map((warning) => <p key={warning} className="mt-1 text-[12px] leading-5">{warning}</p>)}</div></div> : null}
      {bundle.status === 'draft' && !fallback ? <div className="flex flex-wrap gap-2"><form action={approveBrainAction}><input type="hidden" name="tenantId" value={tenantId} /><input type="hidden" name="bundleId" value={bundle.id} /><SubmitButton pendingLabel="Approving…"><CheckCircle2 size={15} />Approve for chat and voice</SubmitButton></form><form action={rejectBrainAction}><input type="hidden" name="tenantId" value={tenantId} /><input type="hidden" name="bundleId" value={bundle.id} /><SubmitButton variant="ghost" pendingLabel="Discarding…">Discard</SubmitButton></form></div> : null}
      {bundle.status === 'approved' ? <p className="flex items-center gap-2 text-[12px] text-[var(--success)]"><CheckCircle2 size={14} aria-hidden />Live in the shared knowledge base for chat and voice.</p> : null}
    </div>
  );
}

function BrainSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return <div><h4 className="text-[12px] font-semibold">{title}</h4><ul className="mt-1.5 list-disc space-y-1 pl-4 text-[var(--text-secondary)]">{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>;
}
