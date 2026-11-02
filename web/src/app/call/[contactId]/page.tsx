import React from 'react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { CallClientView } from './CallClientView';
import { MOCK_CONTACTS, MOCK_TENANTS } from '@/lib/mockData';

interface CallPageProps {
  params: Promise<{ contactId: string }>;
}

export default async function InstantCallPage({ params }: CallPageProps) {
  const { contactId } = await params;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const isPlaceholderDb = !supabaseUrl || supabaseUrl.includes('your-project-id') || supabaseUrl.includes('placeholder');

  // Load Contact & Tenant context
  let contact = null;
  if (!isPlaceholderDb) {
    try {
      const supabase = await createClient();
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', contactId)
        .single();
      if (data) contact = data;
    } catch {}
  }

  if (!contact) {
    contact = MOCK_CONTACTS.find((c) => c.id === contactId) || null;
  }

  if (!contact) {
    notFound();
  }

  let tenant = null;
  if (!isPlaceholderDb) {
    try {
      const supabase = await createClient();
      const { data } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', contact.tenant_id)
        .single();
      if (data) tenant = data;
    } catch {}
  }

  if (!tenant) {
    tenant = MOCK_TENANTS.find((t) => t.id === contact.tenant_id) || null;
  }

  if (!tenant) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[var(--bg-ground,#07090E)] text-[var(--text-primary,#FFFFFF)] flex flex-col items-center justify-center p-4 transition-colors">
      <CallClientView
        contact={contact}
        tenant={tenant}
      />
    </main>
  );
}
