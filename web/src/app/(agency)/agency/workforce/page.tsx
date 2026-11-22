import { requireAgency } from '@/lib/auth/guard';
import { WorkforceStudio } from '@/components/workforce/WorkforceStudio';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'AI Workforce Console · Nordic Omni',
  description: 'Specialized autonomous AI employees and client feature switchboard.',
};

export default async function WorkforcePage() {
  await requireAgency();

  return (
    <div className="pb-12">
      <WorkforceStudio />
    </div>
  );
}
