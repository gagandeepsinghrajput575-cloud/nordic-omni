import { requireAgency } from '@/lib/auth/guard';
import { PageHeader } from '@/components/ui/feedback';
import { WorkforceConsole } from '@/components/agency/workforce/WorkforceConsole';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI workforce' };

/**
 * The AI employees workforce console.
 *
 * A **prototype** surface: it reads no agent telemetry, because none exists.
 * The roster, metrics and mission log are fixed samples in
 * `lib/workforce/roster.ts`, and the page states that in the HUD rather than
 * implying a live orchestrator.
 *
 * `requireAgency` still gates the route, so the prototype is not reachable
 * without an agency session.
 */
export default async function WorkforcePage() {
  await requireAgency();

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Agency operations"
        title="AI workforce"
        description="General Partner AI fordeler arbejdet til fire specialister. Prototype — ingen live-telemetri er tilsluttet endnu."
      />
      <WorkforceConsole />
    </div>
  );
}
