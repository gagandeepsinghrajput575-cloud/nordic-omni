import React from 'react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AnimatedScorecards } from '@/components/command-center/AnimatedScorecards';
import { InteractiveKanban } from '@/components/command-center/InteractiveKanban';
import { AvailabilityPricingMatrix } from '@/components/command-center/AvailabilityPricingMatrix';
import { OwnerCopilotDock } from '@/components/command-center/OwnerCopilotDock';
import { DireTransferModal } from '@/components/command-center/DireTransferModal';
import { PitchSimulatorDrawer } from '@/components/command-center/PitchSimulatorDrawer';
import { OwnerBroadcastBanner } from '@/components/command-center/OwnerBroadcastBanner';
import { ThemeSwitcher } from '@/components/theme/ThemeSwitcher';
import { TenantStoreHydrator } from './TenantStoreHydrator';
import { MOCK_TENANTS, MOCK_CONTACTS, MOCK_CALL_LOGS } from '@/lib/mockData';

interface PortalPageProps {
  params: Promise<{ tenantSlug: string }>;
}

export default async function TenantPortalPage({ params }: PortalPageProps) {
  const { tenantSlug } = await params;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const isPlaceholderDb = !supabaseUrl || supabaseUrl.includes('your-project-id') || supabaseUrl.includes('placeholder');

  // Load Tenant data
  let tenant = null;
  if (!isPlaceholderDb) {
    try {
      const supabase = await createClient();
      const { data } = await supabase
        .from('tenants')
        .select('*')
        .eq('slug', tenantSlug)
        .single();
      if (data) tenant = data;
    } catch {}
  }

  if (!tenant) {
    tenant = MOCK_TENANTS.find((t) => t.slug === tenantSlug) || null;
  }

  if (!tenant) {
    notFound();
  }

  // Load initial contacts
  let contacts: any[] = [];
  if (!isPlaceholderDb) {
    try {
      const supabase = await createClient();
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('updated_at', { ascending: false });
      if (data && data.length > 0) contacts = data;
    } catch {}
  }

  if (contacts.length === 0) {
    contacts = MOCK_CONTACTS.filter((c) => c.tenant_id === tenant.id);
  }

  // Load initial call logs
  let callLogs: any[] = [];
  if (!isPlaceholderDb) {
    try {
      const supabase = await createClient();
      const { data } = await supabase
        .from('call_logs')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false });
      if (data && data.length > 0) callLogs = data;
    } catch {}
  }

  if (callLogs.length === 0) {
    callLogs = MOCK_CALL_LOGS.filter((cl) => cl.tenant_id === tenant.id);
  }

  return (
    <main className="min-h-screen bg-[var(--bg-ground,#07090E)] text-[var(--text-primary,#F8FAFC)] relative pb-28 transition-colors">
      {/* Hydrates client-side Zustand store with server-fetched data */}
      <TenantStoreHydrator
        tenant={tenant}
        contacts={contacts || []}
        callLogs={callLogs || []}
      />

      {/* Top Navigation Bar */}
      <header className="border-b border-[var(--border-subtle,#1E2638)] bg-[var(--bg-surface,#0D111A)]/90 backdrop-blur-xl sticky top-0 z-30 px-6 py-3.5 flex items-center justify-between transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[var(--accent-primary,#00F5D4)] to-[var(--accent-secondary,#7B61FF)] p-[1.5px] shadow-sm">
            <div className="w-full h-full bg-[var(--bg-ground,#07090E)] rounded-[10px] flex items-center justify-center font-bold text-xs text-[var(--accent-primary,#00F5D4)]">
              {tenant.name.charAt(0)}
            </div>
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-[var(--text-primary,#FFFFFF)] flex items-center gap-2">
              {tenant.name}
              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-[var(--bg-raised,#171F2E)] text-[var(--text-secondary,#8E9CAE)] border border-[var(--border-subtle,#232F48)]">
                {tenant.default_language === 'da-DK' ? '🇩🇰 Danish (da-DK)' : '🇬🇧 English (en-US)'}
              </span>
            </h1>
            <p className="text-[11px] text-[var(--text-muted,#718096)]">
              {tenant.flynumber_did ? `Inbound Line: ${tenant.flynumber_did}` : 'WebRTC Zero-Cost Mode Active'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ThemeSwitcher />
          <span className="flex items-center gap-1.5 text-xs text-[var(--accent-primary,#00F5D4)] bg-[var(--accent-primary,#00F5D4)]/10 border border-[var(--accent-primary,#00F5D4)]/30 px-3 py-1.5 rounded-xl font-mono">
            <span className="w-2 h-2 rounded-full bg-[var(--accent-primary,#00F5D4)] animate-ping" />
            LiveKit & Supabase Realtime Connected
          </span>
        </div>
      </header>

      {/* Owner Operational Broadcast Banner */}
      <OwnerBroadcastBanner />

      {/* Main Container */}
      <div className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">
        {/* Animated Bento Scorecards */}
        <AnimatedScorecards />

        {/* 2-Column Split: Pipeline Kanban (Main) & Availability Matrix (Side) */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 items-start">
          <div className="xl:col-span-3">
            <InteractiveKanban />
          </div>
          <div className="xl:col-span-1">
            <AvailabilityPricingMatrix />
          </div>
        </div>
      </div>

      {/* Floating Modals & Controllers */}
      <OwnerCopilotDock
        tenantId={tenant.id}
        tenantSlug={tenant.slug}
        ownerName={tenant.owner_name}
        defaultLanguage={tenant.default_language}
      />

      <DireTransferModal
        tenantId={tenant.id}
        defaultLanguage={tenant.default_language}
      />

      <PitchSimulatorDrawer
        tenantId={tenant.id}
        tenantSlug={tenant.slug}
      />
    </main>
  );
}
