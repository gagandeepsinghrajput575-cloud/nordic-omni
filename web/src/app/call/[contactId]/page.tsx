import { notFound } from 'next/navigation';
import { getPublicCallContext } from '@/lib/db/queries';
import { CallClientView } from './CallClientView';

export const dynamic = 'force-dynamic';

export default async function InstantCallPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const { contactId } = await params;

  const context = await getPublicCallContext(contactId).catch(() => null);
  if (!context) notFound();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg-ground)] p-4 text-[var(--text-primary)]">
      <CallClientView contact={context.contact} tenant={context.tenant} />
    </main>
  );
}

