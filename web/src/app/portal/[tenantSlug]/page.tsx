import React from 'react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AnimatedScorecards } from '@/components/command-center/AnimatedScorecards';
import { InteractiveKanban } from '@/components/command-center/InteractiveKanban';
import { AvailabilityPricingMatrix } from '@/components/command-center/AvailabilityPricingMatrix';
import { OwnerCopilotDock } from '@/components/command-center/OwnerCopilotDock';
import { DireTransferModal } from '@/components/command-center/DireTransferModal';
import { PitchSimulatorDrawer } from '@/components/command-center/PitchSimulatorDrawer';
import { TenantStoreHydrator } from './TenantStoreHydrator';

interface PortalPageProps {
  params: Promise<{ tenantSlug: string }>;
}

export default async function TenantPortalPage({ params }: PortalPageProps) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  // Load Tenant data
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('slug', tenantSlug)
    .single();

  if (error || !tenant) {
    notFound();
  }

  // Load initial contacts
  const { data: contacts } = await supabase
    .from('contacts')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('updated_at', { ascending: false });

  // Load initial call logs
  const { data: callLogs } = await supabase
    .from('call_logs')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false });

  return (
    <main className="min-h-screen bg-[#06080D] text-white relative pb-28">
      {/* Hydrates client-side Zustand store with server-fetched data */}
      <TenantStoreHydrator
        tenant={tenant}
        contacts={contacts || []}
        callLogs={callLogs || []}
      />

      {/* Top Navigation Bar */}
      <header className="border-b border-[#141A26] bg-[#0A0D15]/80 backdrop-blur-xl sticky top-0 z-30 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#00F5D4] to-[#7B61FF] p-[1px]">
            <div className="w-full h-full bg-[#07090F] rounded-[11px] flex items-center justify-center font-bold text-xs text-[#00F5D4]">
              {tenant.name.charAt(0)}
            </div>
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              {tenant.name}
              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-[#182133] text-[#8E9CAE] border border-[#232F48]">
                {tenant.default_language === 'da-DK' ? '🇩🇰 Danish (da-DK)' : '🇬🇧 English (en-US)'}
              </span>
            </h1>
            <p className="text-[11px] text-[#718096]">
              {tenant.flynumber_did ? `Inbound Line: ${tenant.flynumber_did}` : 'WebRTC Zero-Cost Mode Active'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-[#00F5D4] bg-[#00F5D4]/10 border border-[#00F5D4]/30 px-3 py-1.5 rounded-full font-mono">
            <span className="w-2 h-2 rounded-full bg-[#00F5D4] animate-ping" />
            LiveKit & Supabase Realtime Connected
          </span>
        </div>
      </header>

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
