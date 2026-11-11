import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicCallContext } from '@/lib/db/queries';
import { CallClientView } from './CallClientView';

export const dynamic = 'force-dynamic';

const loadCallContext = cache(getPublicCallContext);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ contactId: string }>;
}): Promise<Metadata> {
  const { contactId } = await params;
  const context = await loadCallContext(contactId).catch(() => null);
  if (!context) return { title: 'Call link unavailable' };
  return {
    title: `Talk to ${context.tenant.name}`,
    description: `Start a secure browser call with ${context.tenant.name}.`,
    robots: { index: false, follow: false },
  };
}

export default async function InstantCallPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const { contactId } = await params;

  const context = await loadCallContext(contactId).catch(() => null);
  if (!context) notFound();

  return (
    <main className="flex min-h-screen flex-col items-center bg-[var(--bg-ground)] px-5 py-6 text-[var(--text-primary)] sm:px-8 lg:justify-center lg:py-10">
      <CallClientView contact={context.contact} tenant={context.tenant} />
    </main>
  );
}

