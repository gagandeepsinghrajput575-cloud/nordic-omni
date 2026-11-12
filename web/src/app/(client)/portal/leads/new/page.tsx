import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireUser } from '@/lib/auth/guard';
import { getTenantFacts } from '@/lib/db/queries';
import { PageHeader } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/form';
import { CreateCallerForm } from './CreateCallerForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New caller' };

export default async function NewCallerPage() {
  const session = await requireUser();
  const tenantId = session.tenantIds[0];
  if (!tenantId) redirect('/no-access');
  const tenant = await getTenantFacts(session.userId, tenantId);
  if (!tenant) redirect('/no-access');
  const isDanish = tenant.default_language === 'da-DK';
  const t = (da: string, en: string) => isDanish ? da : en;
  return (
    <div className="space-y-7">
      <PageHeader eyebrow={t('Ny kunde', 'New caller')} title={t('Opret en kunde', 'Create a caller')} description={t('Tilføj kontaktoplysninger og kontekst, så AI-receptionisten kan hjælpe kunden personligt.', 'Add contact details and context so the AI receptionist can help this caller personally.')} actions={<Link href="/portal/leads" className={buttonClass('ghost', 'sm')}><ArrowLeft size={13} />{t('Alle kunder', 'All callers')}</Link>} />
      <CreateCallerForm isDanish={isDanish} />
    </div>
  );
}
