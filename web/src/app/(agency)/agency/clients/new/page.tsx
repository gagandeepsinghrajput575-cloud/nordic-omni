import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireAgency } from '@/lib/auth/guard';
import { PageHeader } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/form';
import { CreateWorkspaceForm } from './CreateWorkspaceForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New client' };

export default async function NewWorkspacePage() {
  await requireAgency();
  return (
    <div className="space-y-7">
      <PageHeader eyebrow="New client" title="Create a workspace" description="Provision the business and its AI receptionist in one transaction, so a half-created client can never exist." actions={<Link href="/agency/clients" className={buttonClass('ghost', 'sm')}><ArrowLeft size={13} />All clients</Link>} />
      <CreateWorkspaceForm />
    </div>
  );
}
