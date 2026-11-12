import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { requireUser } from '@/lib/auth/guard';
import { getAgentConfig, getTenantFacts } from '@/lib/db/queries';
import { listWebhookDeliveries, listWebhooks } from '@/lib/webhooks';
import { WebhookManager } from '@/components/webhooks/WebhookManager';
import { Badge, Card, CardHeader } from '@/components/ui/core';
import { PageHeader } from '@/components/ui/feedback';
import { SettingsPanels } from '@/components/portal/SettingsPanels';
import { BusinessDetailsForm } from './BusinessDetailsForm';
import { HoursForm, type HoursValue } from './HoursForm';
import { PricingForm, type PriceRow } from './PricingForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const session = await requireUser();
  const tenantId = session.tenantIds[0];
  if (!tenantId) redirect('/no-access');
  const [tenant, config] = await Promise.all([getTenantFacts(session.userId, tenantId), getAgentConfig(session.userId, tenantId)]);
  if (!tenant) redirect('/no-access');
  const isDanish = tenant.default_language === 'da-DK';
  const t = (da: string, en: string) => isDanish ? da : en;
  const hours = (tenant.business_hours ?? {}) as Record<string, HoursValue>;
  const prices = (tenant.pricing_catalog ?? []) as PriceRow[];

  return (
    <div className="space-y-7">
      <PageHeader eyebrow={t('Arbejdsrum', 'Workspace')} title={t('Virksomhedsindstillinger', 'Business settings')} description={t('De oplysninger, din AI-receptionist bruger til at svare kunderne præcist.', 'The details your AI receptionist uses to give customers an accurate answer.')} />
      <div className="notice notice-info"><ShieldCheck size={17} className="mt-0.5 shrink-0 text-[var(--accent-primary)]" aria-hidden /><p className="text-[12px]">{t('Du styrer virksomhedens fakta: åbningstider, priser og meddelelser. Bureauet styrer AI’ens tone og regler.', 'You manage the business facts: hours, prices and notices. Your agency manages the AI’s persona and rules.')}</p></div>
      <SettingsPanels isDanish={isDanish}
        business={<BusinessDetailsForm isDanish={isDanish} ownerName={tenant.owner_name} ownerPhone={tenant.owner_phone} ownerEmail={tenant.owner_email} broadcast={tenant.active_broadcast_message ?? ''} />}
        hours={<HoursForm isDanish={isDanish} hours={hours} />}
        pricing={<PricingForm isDanish={isDanish} rows={prices} />}
        agent={<Card><CardHeader title={t('AI’ens opsætning', 'AI configuration')} hint={t('Administreres af dit bureau. Kontakt dem for ændringer.', 'Managed by your agency. Contact them to make changes.')} action={<Badge tone="neutral">{t('Kun læsning', 'Read only')}</Badge>} /><div className="space-y-5 p-5"><div><h3 className="mb-2 text-[13px] font-medium">{t('Hilsen', 'Greeting')}</h3><p className="surface-raised p-4 text-[13px] leading-6 text-[var(--text-secondary)]">{config?.greeting_script || t('Ingen hilsen sat.', 'No greeting set.')}</p></div><div><h3 className="mb-2 text-[13px] font-medium">{t('Instruktion', 'Instructions')}</h3><p className="surface-raised max-h-[480px] overflow-y-auto whitespace-pre-wrap p-4 text-[13px] leading-6 text-[var(--text-secondary)]">{config?.customer_system_prompt || t('Ingen instruktion sat.', 'No instructions set.')}</p></div></div></Card>}
      />
    </div>
  );
}
