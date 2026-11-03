import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/guard';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Resolves the acting scope for a server action.
 *
 * The tenant ALWAYS comes from the session. There is no parameter a caller could
 * tamper with, which is why a client cannot address another workspace even if
 * they forge a form field — nothing here reads one.
 */
export async function clientScope(): Promise<{
  session: SessionUser;
  tenantId: string;
}> {
  const session = await requireUser();
  if (session.isAgency) redirect('/agency');
  const tenantId = session.tenantIds[0];
  if (!tenantId) redirect('/no-access');
  return { session, tenantId };
}

/** Agency scope: God mode, but still a real identity for RLS and audit. */
export async function agencyScope(): Promise<{ session: SessionUser }> {
  const session = await requireUser();
  if (!session.isAgency) redirect('/portal');
  return { session };
}
