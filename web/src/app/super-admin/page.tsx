import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { SuperAdminDeckClient } from '@/components/admin/SuperAdminDeckClient';
import { MOCK_TENANTS, MOCK_CONTACTS, MOCK_CALL_LOGS } from '@/lib/mockData';

export default async function SuperAdminMasterPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const isPlaceholderDb = !supabaseUrl || supabaseUrl.includes('your-project-id') || supabaseUrl.includes('placeholder');

  let tenantsRes: any = { data: [] };
  let contactsRes: any = { data: [] };
  let callLogsRes: any = { data: [] };

  if (!isPlaceholderDb) {
    try {
      const supabase = await createClient();
      [tenantsRes, contactsRes, callLogsRes] = await Promise.all([
        supabase
          .from('tenants')
          .select('id, name, slug, owner_name, owner_phone, telephony_mode, client_passkey, default_language')
          .order('created_at', { ascending: false }),
        supabase.from('contacts').select('estimated_value_dkk, pipeline_stage'),
        supabase.from('call_logs').select('id, duration_seconds'),
      ]);
    } catch {}
  }

  let tenants = tenantsRes?.data || [];
  if (tenants.length === 0) {
    tenants = MOCK_TENANTS;
  }
  let contacts = contactsRes?.data || [];
  if (contacts.length === 0) {
    contacts = MOCK_CONTACTS;
  }
  let callLogs = callLogsRes?.data || [];
  if (callLogs.length === 0) {
    callLogs = MOCK_CALL_LOGS;
  }

  const totalPipelineVal = contacts.reduce((sum: number, c: any) => sum + Number(c.estimated_value_dkk || 0), 0);
  const totalCallSeconds = callLogs.reduce((sum: number, cl: any) => sum + Number(cl.duration_seconds || 0), 0);

  return (
    <main className="min-h-screen bg-[var(--bg-ground,#05070B)] text-[var(--text-primary,#FFFFFF)] p-6 sm:p-8 max-w-7xl mx-auto space-y-8 transition-colors">
      <SuperAdminDeckClient
        initialTenants={tenants}
        totalPipelineVal={totalPipelineVal}
        totalCallSeconds={totalCallSeconds}
      />
    </main>
  );
}
