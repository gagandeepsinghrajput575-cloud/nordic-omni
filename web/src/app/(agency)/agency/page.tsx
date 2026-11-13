import Link from "next/link";
import { AlertTriangle, ArrowRight, Building2, Plus, PhoneCall, Radio, Sparkles } from "lucide-react";
import { requireAgency } from "@/lib/auth/guard";
import { listTenants } from "@/lib/db/queries";
import { Waveform } from "@/components/audio/Waveform";
import { Icon, Pill, Stat } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/form";
import { resolveProvider } from "@/lib/ai/config";
import { getAgencyWorkspace } from "@/lib/data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agency Console · Nordic Omni" };

const dkk = (value: number) => value.toLocaleString("da-DK", { maximumFractionDigits: 0 });

export default async function AgencyPortfolioPage() {
  const session = await requireAgency();
  const [tenants, agencyWorkspace] = await Promise.all([
    listTenants(session.userId),
    getAgencyWorkspace().catch(() => null),
  ]);

  const totalPipeline = tenants.reduce((sum, tenant) => sum + tenant.pipeline_dkk, 0);
  const totalContacts = tenants.reduce((sum, tenant) => sum + tenant.contact_count, 0);
  const totalCalls = tenants.reduce((sum, tenant) => sum + tenant.call_count, 0);
  const totalDire = tenants.reduce((sum, tenant) => sum + tenant.open_dire, 0);

  const provider = agencyWorkspace
    ? resolveProvider(agencyWorkspace)
    : { configured: false, label: "local brain", source: "none" };

  return (
    <div className="space-y-7">
      {/* Header with ElevenLabs Live Pill & Actions */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--accent-secondary)]">
            Agency Owner Command Center
          </p>
          <h1 className="display mt-2 text-[28px] font-bold tracking-tight text-[var(--text-primary)] sm:text-[34px]">
            Portfolio & Voice Operations
          </h1>
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
            Manage your client workspaces, real-time voice receptionists, and live partner showcases across Denmark.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={provider.configured ? "live" : "warn"}>
            <span className={provider.configured ? "dot-live" : "dot-thinking"} />
            {provider.configured ? provider.label : "Local Grounded Brain"}
          </Pill>
          <Link href="/agency/clients/new" className={buttonClass("primary", "sm")}>
            <Plus size={15} />
            New Client Workspace
          </Link>
        </div>
      </div>

      {/* Emergency Alert Banner if any open critical issues */}
      {totalDire > 0 ? (
        <div className="notice notice-danger flex items-center justify-between rounded-xl border border-[rgba(255,107,107,0.3)] bg-[rgba(255,107,107,0.08)] p-4 text-[13px]">
          <div className="flex items-center gap-3">
            <AlertTriangle size={18} className="text-[var(--danger)] shrink-0" aria-hidden />
            <span className="font-medium text-[var(--text-primary)]">
              {totalDire} open {totalDire === 1 ? "emergency escalation requires" : "emergencies require"} immediate operator attention.
            </span>
          </div>
          <Link href="/agency/clients" className={buttonClass("ghost", "sm", "text-[var(--danger)]")}>
            Review cases <ArrowRight size={14} />
          </Link>
        </div>
      ) : null}

      {/* Hero Executive Statistics Grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Total Managed Pipeline"
          value={`${dkk(totalPipeline)} DKK`}
          tone="accent"
          hint="Grounded estimate quotes across all clients"
        />
        <Stat
          label="Active Workspaces"
          value={`${tenants.filter((t) => t.status === "active").length} / ${tenants.length}`}
          hint="Accepting calls & client sign-ins"
        />
        <Stat
          label="Combined Call Volume"
          value={`${totalCalls} calls`}
          hint={`${totalContacts} callers managed`}
        />
        <Stat
          label="Urgent Escalations"
          value={totalDire}
          tone={totalDire > 0 ? "warn" : "default"}
          hint="Cases with urgency 4–5"
        />
      </div>

      {/* Client Workspaces Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="dot-live" />
            <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
              Active Client Workspaces ({tenants.length})
            </h2>
          </div>
          <Link href="/agency/clients" className="text-[12px] font-medium text-[var(--accent-secondary)] hover:underline flex items-center gap-1">
            Manage all clients <ArrowRight size={13} />
          </Link>
        </div>

        {tenants.length === 0 ? (
          <div className="card p-8 text-center">
            <Building2 size={24} className="mx-auto text-[var(--text-muted)]" />
            <p className="mt-3 text-[14px] font-medium text-[var(--text-primary)]">Ready for your first client</p>
            <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
              Create a workspace with an AI receptionist, custom knowledge base, and zero-telephony showcase in minutes.
            </p>
            <Link href="/agency/clients/new" className={`${buttonClass("primary", "sm")} mt-4 inline-flex`}>
              <Plus size={14} /> Create a client
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {tenants.map((tenant) => (
              <div
                key={tenant.id}
                className="card group flex flex-col justify-between overflow-hidden border border-[var(--border-subtle)] bg-[rgba(14,16,21,0.7)] p-5 backdrop-blur transition-all hover:border-[var(--border-strong)]"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-[16px] font-semibold tracking-tight text-[var(--text-primary)]">
                          {tenant.name}
                        </h3>
                        <Pill tone={tenant.status === "active" ? "live" : "warn"}>
                          {tenant.status}
                        </Pill>
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-[var(--text-muted)]">
                        /{tenant.slug} · {tenant.default_language === "da-DK" || tenant.default_language === "da" ? "Dansk (da-DK)" : "English (en-GB)"}
                      </p>
                    </div>

                    <Link
                      href={`/showcase/${tenant.slug}`}
                      target="_blank"
                      className="pill pill-accent flex items-center gap-1 text-[11px] font-medium hover:opacity-90"
                      title="Launch Web Voice Partner Showcase"
                    >
                      <Sparkles size={12} />
                      Showcase
                    </Link>
                  </div>

                  {/* Audio Telemetry & Phone Indicator */}
                  <div className="mt-4 flex items-center gap-2 border-t border-[var(--border-subtle)] pt-3 text-[12px] text-[var(--text-secondary)]">
                    <Radio size={13} className="text-[var(--accent-primary)] animate-pulse" />
                    <span className="font-mono text-[11px]">
                      {tenant.flynumber_did ? tenant.flynumber_did : "WebRTC Browser Voice only"}
                    </span>
                    <span className="ml-auto text-[11px] font-mono text-[var(--text-muted)]">
                      {tenant.reception_mode === "human_forward"
                        ? "Human forward"
                        : tenant.reception_mode === "hybrid"
                        ? "Hybrid reception"
                        : "Autonomous AI"}
                    </span>
                  </div>

                  {/* Metrics Snapshot */}
                  <dl className="mt-4 grid grid-cols-3 gap-3 rounded-lg border border-[var(--border-subtle)] bg-[rgba(8,9,12,0.4)] p-3">
                    <div>
                      <dt className="text-[11px] text-[var(--text-muted)]">Callers</dt>
                      <dd className="mt-1 font-mono text-[17px] font-semibold text-[var(--text-primary)]">
                        {tenant.contact_count}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-[var(--text-muted)]">Pipeline</dt>
                      <dd className="mt-1 font-mono text-[17px] font-semibold text-[var(--text-primary)]">
                        {dkk(tenant.pipeline_dkk)} <span className="text-[11px] text-[var(--text-muted)]">DKK</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-[var(--text-muted)]">Calls</dt>
                      <dd className="mt-1 font-mono text-[17px] font-semibold text-[var(--text-primary)]">
                        {tenant.call_count}
                      </dd>
                    </div>
                  </dl>
                </div>

                {/* Footer Link & Emergency status */}
                <div className="mt-5 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
                  <div>
                    {tenant.open_dire > 0 ? (
                      <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--danger)]">
                        <AlertTriangle size={13} />
                        {tenant.open_dire} urgent case{tenant.open_dire === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <span className="text-[11px] text-[var(--text-muted)]">No open emergencies</span>
                    )}
                  </div>
                  <Link
                    href={`/agency/clients/${tenant.id}`}
                    className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                  >
                    Open studio <ArrowRight size={13} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Mini Audio Visualizer preview strip */}
      <section className="card flex items-center justify-between gap-4 p-4 border border-[var(--border-subtle)] bg-[rgba(14,16,21,0.6)]">
        <div className="flex items-center gap-3">
          <PhoneCall size={18} className="text-[var(--accent-primary)]" />
          <div>
            <p className="text-[13px] font-medium text-[var(--text-primary)]">Live Speech-to-Speech Engine</p>
            <p className="text-[11px] text-[var(--text-muted)]">Sub-150ms real-time barge-in active across all tenant receptionists.</p>
          </div>
        </div>
        <div className="w-48 hidden sm:block">
          <Waveform active bars={28} className="h-6" tone="accent" />
        </div>
      </section>
    </div>
  );
}
