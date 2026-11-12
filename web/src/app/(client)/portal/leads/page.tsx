import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';
import { requireUser } from '@/lib/auth/guard';
import { getTenantFacts, listContacts } from '@/lib/db/queries';
import { PageHeader } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/form';
import { CallerDirectory } from '@/components/portal/CallerDirectory';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Callers' };

export default async function PortalLeadsPage() {
  const session = await requireUser();
  const tenantId = session.tenantIds[0];
  if (!tenantId) redirect('/no-access');
  const [contacts, tenant] = await Promise.all([listContacts(session.userId, tenantId, 200), getTenantFacts(session.userId, tenantId)]);
  if (!tenant) redirect('/no-access');
  const isDanish = tenant.default_language === 'da-DK';
  return (
    <div className="space-y-7">
      <PageHeader eyebrow={isDanish ? 'Arbejdsrum' : 'Workspace'} title={isDanish ? 'Dine kunder' : 'Your callers'} description={isDanish ? 'Følg samtalerne, vurder mulighederne, og find det næste skridt for hver kunde.' : 'Follow the conversations, qualify opportunities and find the next step for every caller.'} actions={<Link href="/portal/leads/new" className={buttonClass('primary')}><Plus size={15} />{isDanish ? 'Ny kunde' : 'New caller'}</Link>} />
      <CallerDirectory contacts={contacts} isDanish={isDanish} />
    </div>
  );
}
