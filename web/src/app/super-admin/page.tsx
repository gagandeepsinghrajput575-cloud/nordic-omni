import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { Plus, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

export default async function SuperAdminMasterPage() {
  const supabase = await createClient();

  const [tenantsRes, contactsRes, callLogsRes] = await Promise.all([
    supabase.from('tenants').select('*').order('created_at', { ascending: false }),
    supabase.from('contacts').select('estimated_value_dkk, pipeline_stage'),
    supabase.from('call_logs').select('id, duration_seconds'),
  ]);

  const tenants = tenantsRes.data || [];
  const contacts = contactsRes.data || [];
  const callLogs = callLogsRes.data || [];

  const totalPipelineVal = contacts.reduce((sum, c) => sum + Number(c.estimated_value_dkk || 0), 0);
  const totalCallSeconds = callLogs.reduce((sum, cl) => sum + Number(cl.duration_seconds || 0), 0);

  return (
    <main className="min-h-screen bg-[#05070B] text-white p-8 max-w-7xl mx-auto space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#161D2B] pb-6">
        <div>
          <span className="text-[11px] font-mono uppercase tracking-widest text-[#00F5D4] font-semibold">
            Agency Master Operations
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-white mt-1">Super-Admin Provisioning Deck</h1>
          <p className="text-xs text-[#8E9CAE]">Managing 0–10+ High-Ticket Client Workspaces</p>
        </div>

        <button className="flex items-center gap-2 bg-[#00F5D4] hover:bg-[#00D2B6] text-black text-xs font-semibold px-4 py-2.5 rounded-xl transition-all shadow-[0_0_20px_rgba(0,245,212,0.2)]">
          <Plus className="w-4 h-4" /> Provision New Client
        </button>
      </div>

      {/* Global Agency Bento Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#0A0D15] border border-[#1A2234] rounded-2xl p-5">
          <span className="text-xs text-[#8E9CAE] block mb-1">Total Agency Pipeline Managed</span>
          <div className="text-2xl font-bold text-white font-mono">
            {totalPipelineVal.toLocaleString('da-DK')} DKK
          </div>
        </div>
        <div className="bg-[#0A0D15] border border-[#1A2234] rounded-2xl p-5">
          <span className="text-xs text-[#8E9CAE] block mb-1">Active Client Tenants</span>
          <div className="text-2xl font-bold text-[#00F5D4] font-mono">{tenants.length} / 10</div>
        </div>
        <div className="bg-[#0A0D15] border border-[#1A2234] rounded-2xl p-5">
          <span className="text-xs text-[#8E9CAE] block mb-1">Total Voice Interaction Time</span>
          <div className="text-2xl font-bold text-[#7B61FF] font-mono">
            {Math.round(totalCallSeconds / 60)} Mins
          </div>
        </div>
      </div>

      {/* Tenants Table */}
      <div className="bg-[#0A0D15] border border-[#1A2234] rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-[#161D2B] font-semibold text-sm flex items-center justify-between">
          <span>Active Client Workspaces</span>
          <span className="text-xs font-mono text-gray-500">Multi-tenant RLS</span>
        </div>
        <div className="divide-y divide-[#141A26]">
          {tenants.map((t) => (
            <div key={t.id} className="p-4 flex items-center justify-between hover:bg-[#0F1420] transition-colors">
              <div>
                <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                  {t.name}
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#182133] text-[#8E9CAE]">
                    /{t.slug}
                  </span>
                </h3>
                <p className="text-xs text-[#718096] mt-0.5">
                  Owner: {t.owner_name} ({t.owner_phone}) • Mode: <span className="text-[#00F5D4] font-mono">{t.telephony_mode}</span>
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Link
                  className="flex items-center gap-1.5 text-xs text-[#00F5D4] bg-[#00F5D4]/10 hover:bg-[#00F5D4]/20 border border-[#00F5D4]/30 px-3.5 py-1.5 rounded-xl transition-all"
                  href={`/portal/${t.slug}`}
                >
                  Enter Portal <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
