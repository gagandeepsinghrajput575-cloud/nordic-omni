import Link from 'next/link';
import { requireAgency } from '@/lib/auth/guard';
import { PageHeader } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/form';
import { CreateWorkspaceForm } from './CreateWorkspaceForm';

export const dynamic = 'force-dynamic';

export default async function NewWorkspacePage() {
  await requireAgency();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="New client"
        title="Create a workspace"
        description="Provisions the tenant and its AI receptionist in one transaction, so a half-created client can never exist."
        actions={
          <Link href="/agency/clients" className={buttonClass('ghost', 'sm')}>
            Back to clients
          </Link>
        }
      />
      <CreateWorkspaceForm />
    </div>
  );
}
