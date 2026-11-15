import { requireAgency } from '@/lib/auth/guard';
import { listWebhooks } from '@/lib/db/agency';
import { listApiKeys } from '@/lib/webhooks/inbound-keys';
import { PageHeader } from '@/components/ui/feedback';
import { WebhookHub } from '@/components/agency/WebhookHub';
import { InboundGateway, WebhookTabs } from '@/components/agency/InboundGateway';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Webhook hub' };

/**
 * Two peer surfaces:
 *
 *   Outbound Streams              — events we send to the operator's systems.
 *   Universal Inbound & Vision    — one endpoint other systems call to query
 *                                   and act, plus the Vision AI bridge.
 *
 * Keys are read through `withUser`, so the agency RLS policy decides what is
 * visible. A missing 0020 migration is reported as an empty list with an
 * explicit hint rather than a 500: the page must stay usable before the
 * migration is applied.
 */
export default async function WebhooksPage() {
  const session = await requireAgency();
  const [endpoints, keys] = await Promise.all([
    listWebhooks(session.userId),
    listApiKeys(session.userId).catch(() => []),
  ]);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Agency integrations"
        title="Webhook hub"
        description="Stream calls, leads and escalations out to your stack, and let external systems query and act through one signed inbound gateway."
      />
      <WebhookTabs
        outbound={<WebhookHub endpoints={endpoints} />}
        inbound={<InboundGateway keys={keys} endpointUrl="/api/v1/agency/webhook" />}
      />
    </div>
  );
}
