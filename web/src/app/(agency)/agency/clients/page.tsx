import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requireAgency } from '@/lib/auth/guard';
import { listTenants } from '@/lib/db/queries';
import { PageHeader } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/form';
import { ClientDirectory } from '@/components/agency/ClientDirectory';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Clients' };

export default async function AgencyClientsPage() {
  const session = await requireAgency();
  const tenants = await listTenants(session.userId);
  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Agency" title="Client workspaces" description="Every business you operate. Open a workspace to manage its receptionist, knowledge and business facts." actions={<Link href="/agency/clients/new" className={buttonClass('primary')}><Plus size={15} />New Client Workspace</Link>} />
      <ClientDirectory tenants={tenants} />
    </div>
  );
}
