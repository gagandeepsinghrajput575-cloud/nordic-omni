import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAgency } from '@/lib/auth/guard';
import {
  getTenantFacts,
  getTenantOverview,
  getAgentConfig,
  listKnowledge,
  listConfigHistory,
  listContacts,
} from '@/lib/db/queries';
import { PromptEditor } from './PromptEditor';
import { KnowledgeEditor } from './KnowledgeEditor';
import { restoreAgentConfigForm } from './actions';

export const dynamic = 'force-dynamic';

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export default async function AgencyClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireAgency();

  const [tenant, overview, config, knowledge, history, contacts] = await Promise.all([
    getTenantFacts(session.userId, id),
    getTenantOverview(session.userId, id),
    getAgentConfig(session.userId, id),
    listKnowledge(session.userId, id),
    listConfigHistory(session.userId, id),
    listContacts(session.userId, id, 1),
  ]);

  if (!tenant) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/agency/clients"
          className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--accent-primary)]"
        >
          ← Clients
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">{tenant.name}</h1>
          <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
            /{tenant.slug}
          </span>
          <span className="rounded border border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 px-1.5 py-0.5 font-mono text-[10px] text-[var(--accent-primary)]">
            {tenant.default_language}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Leads', value: String(overview.contacts) },
          {
            label: 'Pipeline',
            value: overview.pipeline_dkk.toLocaleString('da-DK', { maximumFractionDigits: 0 }),
          },
          { label: 'Calls', value: String(overview.calls) },
          { label: 'Emergencies', value: String(overview.dire) },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
          >
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              {s.label}
            </div>
            <div className="mt-1 font-mono text-lg font-bold tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)]">
            Facts — client can edit these
          </h2>
          <span className="font-mono text-[10px] text-[var(--success)]">tenant-editable</span>
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Owner</dt>
            <dd className="text-xs">{tenant.owner_name}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Phone</dt>
            <dd className="font-mono text-xs">{tenant.owner_phone}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              Inbound line
            </dt>
            <dd className="font-mono text-xs">{tenant.flynumber_did ?? 'WebRTC only'}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Email</dt>
            <dd className="truncate text-xs">{tenant.owner_email}</dd>
          </div>
        </dl>

        <div className="mt-5 grid grid-cols-1 gap-5 border-t border-[var(--border-subtle)] pt-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              Business hours
            </h3>
            <ul className="space-y-1">
              {DAY_ORDER.map((day) => {
                const d = tenant.business_hours?.[day];
                return (
                  <li key={day} className="flex justify-between font-mono text-[11px]">
                    <span className="uppercase text-[var(--text-muted)]">{day}</span>
                    <span className="tabular-nums">
                      {!d || d.closed ? (
                        <span className="text-[var(--text-muted)]">closed</span>
                      ) : (
                        `${d.open}–${d.close}`
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              Pricing catalog
            </h3>
            <ul className="space-y-1">
              {(tenant.pricing_catalog ?? []).map((p) => (
                <li key={p.id} className="flex justify-between gap-3 text-[11px]">
                  <span className="truncate text-[var(--text-secondary)]">{p.service}</span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {p.price_dkk.toLocaleString('da-DK')} / {p.unit}
                  </span>
                </li>
              ))}
              {(tenant.pricing_catalog ?? []).length === 0 && (
                <li className="text-[11px] text-[var(--text-muted)]">No services configured</li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-5 border-t border-[var(--border-subtle)] pt-3">
          <h3 className="mb-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Broadcast
          </h3>
          <p className="text-xs text-[var(--text-secondary)]">
            {tenant.active_broadcast_message ?? (
              <span className="italic text-[var(--text-muted)]">No active broadcast</span>
            )}
          </p>
        </div>
      </section>

      {/* BEHAVIOUR — agency-only */}
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)]">
            Behaviour — agency only
          </h2>
          <span className="font-mono text-[10px] text-[var(--accent-primary)]">restricted</span>
        </div>

        {config ? (
          <PromptEditor
            tenantId={tenant.id}
            tenantSlug={tenant.slug}
            tenantName={tenant.name}
            defaultLanguage={tenant.default_language}
            contactId={contacts[0]?.id ?? 'demo-caller'}
            contactName={contacts[0]?.full_name ?? 'Demo Caller'}
            initial={{
              customer_system_prompt: config.customer_system_prompt,
              copilot_system_prompt: config.copilot_system_prompt,
              greeting_script: config.greeting_script,
              voice_id: config.voice_id,
            }}
          />
        ) : (
          <p className="text-xs text-[var(--text-muted)]">No agent config on file.</p>
        )}
      </section>

      {/* KNOWLEDGE */}
      <KnowledgeEditor
        tenantId={tenant.id}
        items={knowledge.map((k) => ({
          id: k.id,
          title: k.title,
          content: k.content,
          category: String(k.category),
          priority: k.priority,
        }))}
      />

      {/* HISTORY */}
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <h2 className="mb-3 text-xs font-mono uppercase tracking-wider text-[var(--text-muted)]">
          Prompt history ({history.length})
        </h2>
        {history.length === 0 ? (
          <p className="text-[11px] text-[var(--text-muted)]">
            No previous versions yet. Saving a prompt creates a snapshot here.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {history.map((h) => (
              <li key={h.id} className="flex items-start justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <div className="font-mono text-[10px] text-[var(--text-muted)]">
                    {new Date(h.changed_at).toLocaleString('da-DK')}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] text-[var(--text-secondary)]">
                    {h.customer_system_prompt}
                  </p>
                </div>
                <form action={restoreAgentConfigForm} className="shrink-0">
                  <input type="hidden" name="tenantId" value={tenant.id} />
                  <input type="hidden" name="historyId" value={h.id} />
                  <button
                    type="submit"
                    className="rounded-lg border border-[var(--border-subtle)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-secondary)] transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
                  >
                    Restore
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
