import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/guard';
import { getAgentConfig, getTenantFacts } from '@/lib/db/queries';
import { listWebhookDeliveries, listWebhooks } from '@/lib/webhooks';
import { WebhookManager } from '@/components/webhooks/WebhookManager';
import { Badge, Card, CardHeader } from '@/components/ui/core';
import { PageHeader } from '@/components/ui/feedback';
import { BusinessDetailsForm } from './BusinessDetailsForm';
import { HoursForm, type HoursValue } from './HoursForm';
import { PricingForm, type PriceRow } from './PricingForm';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await requireUser();
  const tenantId = session.tenantIds[0];
  if (!tenantId) redirect('/no-access');

  const [tenant, config, webhooks, deliveries] = await Promise.all([
    getTenantFacts(session.userId, tenantId),
    getAgentConfig(session.userId, tenantId),
    listWebhooks(session.userId, tenantId),
    listWebhookDeliveries(session.userId, tenantId),
  ]);

  if (!tenant) redirect('/no-access');
  const isDanish = tenant.default_language === 'da-DK';

  const hours = (tenant.business_hours ?? {}) as Record<string, HoursValue>;
  const prices = (tenant.pricing_catalog ?? []) as PriceRow[];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isDanish ? 'Indstillinger' : 'Settings'}
        title={isDanish ? 'Dine oplysninger' : 'Your details'}
        description={
          isDanish
            ? 'Det her er fakta om din virksomhed, og du ejer dem. AI’ens personlighed og instruktioner styres af bureauet.'
            : 'These are the facts about your business, and you own them. The AI’s persona and instructions are managed by the agency.'
        }
      />

      {/* Honest boundary: shows the client where their control ends. */}
      <Card className="border-[var(--accent-line)] bg-[var(--accent-soft)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{isDanish ? 'Sådan er det delt' : 'How this is split'}</Badge>
          <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
            {isDanish
              ? 'Du kan ændre timer, priser og meddelelser. AI’ens tone og regler kan du ikke ændre — det gør bureauet. Det håndhæves i databasen, ikke ved at skjule knapper.'
              : 'You can change hours, prices and notices. You cannot change the AI’s tone and rules — the agency does that. It is enforced in the database, not by hiding buttons.'}
          </p>
        </div>
      </Card>

      <BusinessDetailsForm
        isDanish={isDanish}
        ownerName={tenant.owner_name}
        ownerPhone={tenant.owner_phone}
        ownerEmail={tenant.owner_email}
        broadcast={tenant.active_broadcast_message ?? ''}
      />

      <HoursForm isDanish={isDanish} hours={hours} />

      <PricingForm isDanish={isDanish} rows={prices} />

      <WebhookManager tenantId={tenantId} webhooks={webhooks} deliveries={deliveries} isDanish={isDanish} />

      <Card>
        <CardHeader
          title={isDanish ? 'AI’ens opsætning' : 'AI configuration'}
          hint={
            isDanish
              ? 'Administreres af bureauet.'
              : 'Managed by the agency.'
          }
          action={<Badge tone="neutral">{isDanish ? 'Kun læsning' : 'Read only'}</Badge>}
        />
        <div className="space-y-3 p-5">
          <div>
            <p className="text-eyebrow mb-1">{isDanish ? 'Hilsen' : 'Greeting'}</p>
            <p className="rounded-[var(--r-sm)] border border-[var(--border-subtle)] bg-[var(--bg-ground)] p-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              {config?.greeting_script || (isDanish ? 'Ingen hilsen sat.' : 'No greeting set.')}
            </p>
          </div>
          <div>
            <p className="text-eyebrow mb-1">{isDanish ? 'Instruktion' : 'Instructions'}</p>
            <p className="whitespace-pre-wrap rounded-[var(--r-sm)] border border-[var(--border-subtle)] bg-[var(--bg-ground)] p-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              {config?.customer_system_prompt ||
                (isDanish ? 'Ingen instruktion sat.' : 'No instructions set.')}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
