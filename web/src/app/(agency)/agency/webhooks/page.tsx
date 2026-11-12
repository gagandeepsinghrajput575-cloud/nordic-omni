import { requireAgency } from '@/lib/auth/guard';
import { listWebhooks } from '@/lib/db/agency';
import { PageHeader } from '@/components/ui/feedback';
import { WebhookHub } from '@/components/agency/WebhookHub';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Webhook hub' };

export default async function WebhooksPage() {
  const session = await requireAgency();
  const endpoints = await listWebhooks(session.userId);
  return <div className="space-y-7"><PageHeader eyebrow="Agency integrations" title="Webhook hub" description="One connection to your operating stack. Stream calls, leads and urgent escalations from every client workspace." /><WebhookHub endpoints={endpoints} /></div>;
}
