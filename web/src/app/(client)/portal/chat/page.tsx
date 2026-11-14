import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/guard';
import { getTenantFacts } from '@/lib/db/queries';
import { getChatState, listChatMessages } from '@/lib/db/client-chat';
import { ClientDirectChatPanel } from '@/components/portal/ClientDirectChatPanel';
import { PageHeader } from '@/components/ui/feedback';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Beskeder' };

/**
 * The client's conversation view.
 *
 * The tenant is taken from the session (`tenantIds[0]`), never from the URL, so
 * a client cannot point this page at somebody else's workspace.
 */
export default async function PortalChatPage() {
  const session = await requireUser();
  const tenantId = session.tenantIds[0];
  if (!tenantId) redirect('/no-access');

  const tenant = await getTenantFacts(session.userId, tenantId);
  if (!tenant) redirect('/no-access');

  const isDanish = tenant.default_language === 'da-DK';

  const [messages, state] = await Promise.all([
    listChatMessages(session.userId, tenantId, { limit: 200 }).catch(() => []),
    getChatState(session.userId, tenantId).catch(() => ({
      tenantId,
      aiEnabled: true,
      pausedReason: null,
      updatedAt: new Date(0).toISOString(),
    })),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        eyebrow={isDanish ? 'Din arbejdsdag' : 'Your workspace'}
        title={isDanish ? 'Beskeder' : 'Messages'}
        description={
          isDanish
            ? 'Skriv direkte til dit bureau. Assistenten svarer med det samme, og en medarbejder tager over, når der er brug for det.'
            : 'Write directly to your agency. The assistant answers instantly, and a person takes over when needed.'
        }
      />
      <ClientDirectChatPanel
        tenantId={tenantId}
        tenantName={tenant.name}
        initialMessages={messages}
        initialState={state}
      />
    </div>
  );
}
