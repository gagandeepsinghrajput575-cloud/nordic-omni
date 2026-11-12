import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicCallContext } from '@/lib/db/queries';
import { CallClientView } from './CallClientView';

export const dynamic = 'force-dynamic';
const loadCallContext = cache(getPublicCallContext);

export async function generateMetadata({ params }: { params: Promise<{ contactId: string }> }): Promise<Metadata> {
  const { contactId } = await params;
  const context = await loadCallContext(contactId).catch(() => null);
  if (!context || context.tenant.status !== 'active') return { title: 'Call unavailable' };
  return { title: `Talk to ${context.tenant.name}`, description: `Start a secure browser call with ${context.tenant.name}.`, robots: { index: false, follow: false } };
}

export default async function InstantCallPage({ params, searchParams }: { params: Promise<{ contactId: string }>; searchParams: Promise<{ embed?: string }> }) {
  const { contactId } = await params;
  const { embed } = await searchParams;
  const context = await loadCallContext(contactId).catch(() => null);
  if (!context || context.tenant.status !== 'active') notFound();
  return (
    <main className={embed === '1' ? 'min-h-dvh bg-[var(--bg)] p-4 text-[var(--text)]' : 'min-h-dvh bg-[var(--bg)] px-5 py-6 text-[var(--text)] sm:px-8 lg:py-10'}>
      <CallClientView contact={context.contact} tenant={context.tenant} compact={embed === '1'} />
    </main>
  );
}
