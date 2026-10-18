import React from 'react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { CallClientView } from './CallClientView';

interface CallPageProps {
  params: Promise<{ contactId: string }>;
}

export default async function InstantCallPage({ params }: CallPageProps) {
  const { contactId } = await params;
  const supabase = await createClient();

  // Load Contact & Tenant context
  const { data: contact, error: contactErr } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .single();

  if (contactErr || !contact) {
    notFound();
  }

  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', contact.tenant_id)
    .single();

  if (tenantErr || !tenant) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[#07090E] text-white flex flex-col items-center justify-center p-4">
      <CallClientView
        contact={contact}
        tenant={tenant}
      />
    </main>
  );
}
