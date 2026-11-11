'use client';

import { useActionState } from 'react';
import { BrainCircuit, CheckCircle2, FileText, Globe2, ShieldAlert } from 'lucide-react';
import { approveBrainAction, compileBrainAction, rejectBrainAction } from './brain-actions';
import { EMPTY_STATE } from '@/lib/actions/types';
import type { BrainPayload } from '@/lib/ai/brain';
import { Badge, Card, CardHeader } from '@/components/ui/core';
import { Field, Input, Textarea, FormAlert } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/SubmitButton';

interface BundleView {
  id: string;
  status: 'draft' | 'approved' | 'rejected';
  compiler_model: string;
  summary: string;
  payload: BrainPayload;
  warnings: string[];
  created_at: string;
  approved_at: string | null;
  sources: Array<{
    id: string;
    kind: string;
    title: string;
    location: string | null;
  }>;
}

export function AiBrainPanel({
  tenantId,
  bundle,
}: {
  tenantId: string;
  bundle: BundleView | null;
}) {
  const [state, formAction, pending] = useActionState(compileBrainAction, EMPTY_STATE);
  const fallback = bundle?.compiler_model === 'fallback';

  return (
    <Card>
      <CardHeader
        title="AI Brain"
        hint="Turn the client’s website and owner notes into reviewed knowledge, guardrails and qualification rules."
        action={
          bundle ? (
            <Badge
              tone={
                bundle.status === 'approved'
                  ? 'success'
                  : bundle.status === 'rejected'
                    ? 'danger'
                    : 'warning'
              }
            >
              {bundle.status}
            </Badge>
          ) : (
            <Badge tone="neutral">No sources yet</Badge>
          )
        }
      />

      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="tenantId" value={tenantId} />
          {state.error ? <FormAlert tone="error">{state.error}</FormAlert> : null}
          {state.ok && state.message ? <FormAlert tone="success">{state.message}</FormAlert> : null}

          <Field
            htmlFor="brain-website"
            label="Website"
            hint="Homepage plus up to three service/about pages"
          >
            <Input
              id="brain-website"
              name="websiteUrl"
              type="url"
              inputMode="url"
              placeholder="https://danskbyg.dk"
            />
          </Field>

          <Field
            htmlFor="brain-notes"
            label="Owner notes"
            hint="Facts the website does not say"
          >
            <Textarea
              id="brain-notes"
              name="notes"
              rows={5}
              placeholder="Serviceområde, garantier, hvad I aldrig lover, typiske spørgsmål, hvornår Morten skal ringes op…"
            />
          </Field>

          <Field
            htmlFor="brain-documents"
            label="Paste document text"
            hint="Price list, onboarding notes or a service description"
          >
            <Textarea
              id="brain-documents"
              name="documentText"
              rows={4}
              placeholder="Indsæt tekst fra fx en prisliste eller virksomhedsbeskrivelse."
            />
          </Field>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <SubmitButton pendingLabel="Reading and compiling…">
              <BrainCircuit size={14} />
              Compile draft
            </SubmitButton>
            <p className="max-w-[300px] text-[11px] leading-5 text-[var(--text-muted)]">
              Nothing goes live until an agency operator approves the draft. Sources stay attached.
            </p>
          </div>
          {pending ? (
            <p className="text-[12px] text-[var(--text-muted)]">
              Fetching pages and extracting facts can take up to a minute.
            </p>
          ) : null}
        </form>

        <div className="min-w-0">
          {!bundle ? (
            <div className="rounded-[10px] border border-[var(--line)] bg-[var(--bg-ground)] p-5">
              <Globe2 size={20} className="text-[var(--accent-primary)]" />
              <p className="mt-3 text-[14px] font-semibold text-[var(--text)]">
                Start with what the business already has
              </p>
              <p className="mt-1 text-[13px] leading-6 text-[var(--text-secondary)]">
                The compiler reads only supplied material. It cannot invent certifications, prices,
                coverage or response times; missing facts become questions for the owner.
              </p>
            </div>
          ) : (
            <BrainDraftReview tenantId={tenantId} bundle={bundle} fallback={fallback} />
          )}
        </div>
      </div>
    </Card>
  );
}


function BrainDraftReview({
  tenantId,
  bundle,
  fallback,
}: {
  tenantId: string;
  bundle: BundleView;
  fallback: boolean;
}) {
  return (
    <div className="space-y-4">
      {fallback ? (
        <FormAlert tone="error">
          AI compilation failed, so this draft cannot be approved. The sources are saved; retry
          compilation or add knowledge manually.
        </FormAlert>
      ) : null}

      <div className="rounded-[10px] bg-[var(--bg-ground)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{bundle.compiler_model}</Badge>
          <span className="text-[11px] text-[var(--text-muted)]">
            {new Date(bundle.created_at).toLocaleString('da-DK')}
          </span>
        </div>
        <p className="mt-3 text-[13px] leading-6 text-[var(--text)]">{bundle.summary}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Services', bundle.payload.services.length],
          ['FAQs', bundle.payload.faqs.length],
          ['Rules', bundle.payload.policies.length + bundle.payload.guardrails.length],
          ['Questions', bundle.payload.qualification_questions.length],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-[var(--line)] p-2.5">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
              {label}
            </div>
            <div className="mt-1 text-[17px] font-semibold tabular-nums text-[var(--text)]">
              {value}
            </div>
          </div>
        ))}
      </div>

      <details className="rounded-[10px] border border-[var(--line)]">
        <summary className="cursor-pointer list-none px-4 py-3 text-[12px] font-medium text-[var(--text-secondary)]">
          Review extracted knowledge
        </summary>
        <div className="space-y-4 border-t border-[var(--line)] p-4 text-[12px] leading-5">
          <BrainSection
            title="Services"
            items={bundle.payload.services.map((s) => `${s.name}: ${s.description}`)}
          />
          <BrainSection
            title="FAQs"
            items={bundle.payload.faqs.map((f) => `${f.question} → ${f.answer}`)}
          />
          <BrainSection title="Guardrails" items={bundle.payload.guardrails} />
          <BrainSection
            title="Qualification"
            items={bundle.payload.qualification_questions.map((q) => q.question)}
          />
          <BrainSection title="Escalation triggers" items={bundle.payload.escalation_triggers} />
          <BrainSection title="Gaps to confirm" items={bundle.payload.uncertainties} />
        </div>
      </details>

      <div className="rounded-[10px] border border-[var(--line)] p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
          <FileText size={12} /> Sources
        </div>
        <ul className="mt-2 space-y-1.5">
          {bundle.sources.map((source) => (
            <li key={source.id} className="truncate text-[11px] text-[var(--text-muted)]">
              {source.location || source.title}
            </li>
          ))}
        </ul>
      </div>

      {bundle.warnings.length > 0 ? (
        <div className="rounded-[10px] border border-[var(--warning)]/30 bg-[var(--warning)]/5 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--warning)]">
            <ShieldAlert size={12} /> Review notes
          </div>
          {bundle.warnings.map((warning) => (
            <p key={warning} className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      {bundle.status === 'draft' && !fallback ? (
        <div className="flex flex-wrap gap-2">
          <form action={approveBrainAction}>
            <input type="hidden" name="tenantId" value={tenantId} />
            <input type="hidden" name="bundleId" value={bundle.id} />
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-[10px] bg-[var(--text)] px-4 py-2.5 text-[13px] font-semibold text-[var(--bg)]"
            >
              <CheckCircle2 size={14} />
              Approve for both chat and voice
            </button>
          </form>
          <form action={rejectBrainAction}>
            <input type="hidden" name="tenantId" value={tenantId} />
            <input type="hidden" name="bundleId" value={bundle.id} />
            <button
              type="submit"
              className="rounded-[10px] border border-[var(--line)] px-3 py-2.5 text-[12px] text-[var(--text-secondary)]"
            >
              Discard
            </button>
          </form>
        </div>
      ) : null}

      {bundle.status === 'approved' ? (
        <p className="flex items-center gap-2 text-[12px] text-[var(--success)]">
          <CheckCircle2 size={14} /> Live in the shared knowledge base for chat and voice.
        </p>
      ) : null}
    </div>
  );
}

function BrainSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{title}</p>
      <ul className="mt-1.5 space-y-1">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="text-[var(--text-secondary)]">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
