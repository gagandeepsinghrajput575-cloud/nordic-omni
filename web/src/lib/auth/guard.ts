import { redirect } from 'next/navigation';
import { getSession, type SessionUser } from './session';

/**
 * Authorization guards.
 *
 * IMPORTANT: these are the ONLY correct way to authorize a page or server
 * action. RLS is the second line of defence; this is the first.
 */

/** Any signed-in user (agency staff or a client's staff). */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

/** Agency staff only. This is the "God mode" gate. */
export async function requireAgency(): Promise<SessionUser> {
  const session = await requireUser();
  if (!session.isAgency) redirect('/portal');
  return session;
}

/**
 * Resolves which tenant the current viewer is acting on.
 *
 * Clients are pinned to their own tenant and cannot influence it from the URL.
 * Agency staff may pass an explicit tenantId (that is what impersonation is).
 */
export async function resolveTenant(
  requestedTenantId?: string
): Promise<{ session: SessionUser; tenantId: string; isImpersonating: boolean }> {
  const session = await requireUser();

  if (session.isAgency) {
    if (!requestedTenantId) redirect('/agency/clients');
    return { session, tenantId: requestedTenantId, isImpersonating: true };
  }

  const tenantId = session.tenantIds[0];
  if (!tenantId) redirect('/no-access');

  // A client may never widen their own scope, even by guessing a UUID.
  if (requestedTenantId && requestedTenantId !== tenantId) {
    redirect('/no-access');
  }

  return { session, tenantId, isImpersonating: false };
}

// --- Route-handler variants (no redirects; return null so callers can 401) -----

export async function apiSession(): Promise<SessionUser | null> {
  return getSession();
}

export async function apiRequireAgency(): Promise<SessionUser | null> {
  const session = await getSession();
  if (!session || !session.isAgency) return null;
  return session;
}

export async function apiRequireTenant(tenantId: string): Promise<SessionUser | null> {
  const session = await getSession();
  if (!session) return null;
  if (session.isAgency) return session;
  return session.tenantIds.includes(tenantId) ? session : null;
}
