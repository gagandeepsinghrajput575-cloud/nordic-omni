'use client';

import React, { useState } from 'react';
import { Plus, ArrowUpRight, Key, Copy, Check, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { ClientProvisioningModal } from './ClientProvisioningModal';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';

interface TenantItem {
  id: string;
  name: string;
  slug: string;
  owner_name: string;
  owner_phone: string;
  telephony_mode: string;
  client_passkey?: string | null;
  default_language: string;
}

interface SuperAdminDeckClientProps {
  initialTenants: TenantItem[];
  totalPipelineVal: number;
  totalCallSeconds: number;
}

export function SuperAdminDeckClient({
  initialTenants,
  totalPipelineVal,
  totalCallSeconds,
}: SuperAdminDeckClientProps) {
  const [tenants, setTenants] = useState<TenantItem[]>(initialTenants);
  const [isProvisionOpen, setIsProvisionOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyPasskey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <>
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border-subtle,#161D2B)] pb-6">
        <div>
          <span className="text-[11px] font-mono uppercase tracking-widest text-[var(--accent-primary,#00F5D4)] font-semibold">
            Agency Master Operations
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary,#FFFFFF)] mt-1">Super-Admin Provisioning Deck</h1>
          <p className="text-xs text-[var(--text-secondary,#8E9CAE)]">Managing 0–10+ High-Ticket Client Workspaces with DeepSeek Onboarding</p>
        </div>

        <div className="flex items-center gap-3">
          <ThemeSwitcher />
          <button
            onClick={() => setIsProvisionOpen(true)}
            className="flex items-center gap-2 bg-[var(--accent-primary,#00F5D4)] hover:brightness-110 text-black text-xs font-bold px-4 py-2.5 rounded-xl transition-all shadow-[0_0_20px_rgba(0,245,212,0.2)] active:scale-95 font-mono"
          >
            <Plus className="w-4 h-4" /> Provision New Client
          </button>
        </div>
      </div>

      {/* Global Agency Bento Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[var(--bg-surface,#0A0D15)] border border-[var(--border-subtle,#1A2234)] rounded-2xl p-5">
          <span className="text-xs text-[var(--text-muted,#8E9CAE)] block mb-1">Total Agency Pipeline Managed</span>
          <div className="text-2xl font-bold text-[var(--text-primary,#FFFFFF)] font-mono tabular-nums">
            {totalPipelineVal.toLocaleString('da-DK')} DKK
          </div>
        </div>
        <div className="bg-[var(--bg-surface,#0A0D15)] border border-[var(--border-subtle,#1A2234)] rounded-2xl p-5">
          <span className="text-xs text-[var(--text-muted,#8E9CAE)] block mb-1">Active Client Tenants</span>
          <div className="text-2xl font-bold text-[var(--accent-primary,#00F5D4)] font-mono tabular-nums">{tenants.length} Workspaces</div>
        </div>
        <div className="bg-[var(--bg-surface,#0A0D15)] border border-[var(--border-subtle,#1A2234)] rounded-2xl p-5">
          <span className="text-xs text-[var(--text-muted,#8E9CAE)] block mb-1">Total Voice Interaction Time</span>
          <div className="text-2xl font-bold text-[var(--accent-secondary,#7B61FF)] font-mono tabular-nums">
            {Math.round(totalCallSeconds / 60)} Mins
          </div>
        </div>
      </div>

      {/* Tenants Table */}
      <div className="bg-[var(--bg-surface,#0A0D15)] border border-[var(--border-subtle,#1A2234)] rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-[var(--border-subtle,#161D2B)] font-semibold text-sm flex items-center justify-between">
          <span className="flex items-center gap-2 text-[var(--text-primary,#FFFFFF)]">
            <ShieldCheck className="w-4 h-4 text-[var(--accent-primary,#00F5D4)]" /> Active Client Workspaces & Passkeys
          </span>
          <span className="text-xs font-mono text-[var(--text-muted,#6B7280)]">Zero-Code Multi-Tenant Engine</span>
        </div>
        <div className="divide-y divide-[var(--border-subtle,#141A26)]">
          {tenants.map((t) => (
            <div key={t.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-[var(--bg-raised,#0F1420)] transition-colors">
              <div>
                <h3 className="font-semibold text-sm text-[var(--text-primary,#FFFFFF)] flex items-center gap-2">
                  {t.name}
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--bg-ground,#182133)] text-[var(--text-secondary,#8E9CAE)] border border-[var(--border-subtle,#243048)]">
                    /{t.slug}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--accent-primary,#00F5D4)]/10 text-[var(--accent-primary,#00F5D4)] border border-[var(--accent-primary,#00F5D4)]/30">
                    {t.default_language}
                  </span>
                </h3>
                <p className="text-xs text-[var(--text-muted,#718096)] mt-0.5">
                  Owner: {t.owner_name} ({t.owner_phone}) • Mode: <span className="text-[var(--accent-primary,#00F5D4)] font-mono">{t.telephony_mode}</span>
                </p>
              </div>

              <div className="flex items-center gap-3">
                {/* Client Passkey Pill */}
                {t.client_passkey && (
                  <div className="flex items-center gap-1.5 bg-[var(--bg-ground,#121724)] border border-[var(--border-subtle,#212C42)] px-3 py-1.5 rounded-xl text-xs font-mono">
                    <Key className="w-3.5 h-3.5 text-[var(--accent-primary,#00F5D4)]" />
                    <span className="text-[var(--accent-primary,#00F5D4)] font-semibold">{t.client_passkey}</span>
                    <button
                      onClick={() => copyPasskey(t.client_passkey!)}
                      className="ml-1 text-[var(--text-muted,#8E9CAE)] hover:text-[var(--text-primary,#FFFFFF)]"
                      title="Copy Passkey"
                    >
                      {copiedKey === t.client_passkey ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                )}

                <Link
                  className="flex items-center gap-1.5 text-xs text-[var(--accent-primary,#00F5D4)] bg-[var(--accent-primary,#00F5D4)]/10 hover:bg-[var(--accent-primary,#00F5D4)]/20 border border-[var(--accent-primary,#00F5D4)]/30 px-3.5 py-1.5 rounded-xl transition-all font-mono"
                  href={`/portal/${t.slug}${t.client_passkey ? `?key=${t.client_passkey}` : ''}`}
                >
                  Enter Portal <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Provisioning Wizard Modal */}
      <ClientProvisioningModal
        isOpen={isProvisionOpen}
        onClose={() => setIsProvisionOpen(false)}
        onTenantCreated={() => {
          // Re-fetch tenants
          fetch('/api/admin/tenants/list')
            .then((r) => r.json())
            .then((data) => {
              if (data.tenants) setTenants(data.tenants);
            })
            .catch(() => {});
        }}
      />
    </>
  );
}
