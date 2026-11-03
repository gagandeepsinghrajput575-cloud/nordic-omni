import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/guard';
import { getTenantFacts } from '@/lib/db/queries';
import { PageHeader } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/form';
import { CreateCallerForm } from './CreateCallerForm';

export const dynamic = 'force-dynamic';

export default async function NewCallerPage() {
  const session = await requireUser();
  const tenantId = session.tenantIds[0];
  if (!tenantId) redirect('/no-access');

  const tenant = await getTenantFacts(session.userId, tenantId);
  if (!tenant) redirect('/no-access');

  const isDanish = tenant.default_language === 'da-DK';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isDanish ? 'Ny kunde' : 'New caller'}
        title={isDanish ? 'Opret en kunde' : 'Create a caller'}
        description={
          isDanish
            ? 'Kunden kan straks ringes op af AI-receptionisten, og alt hvad du skriver her, læses højt-kontekst før opkaldet.'
            : 'The AI receptionist can call them immediately, and everything you write here is read as context before the call.'
        }
        actions={
          <Link href="/portal/leads" className={buttonClass('ghost', 'sm')}>
            Back to callers
          </Link>
        }
      />

      <CreateCallerForm isDanish={isDanish} />
    </div>
  );
}
