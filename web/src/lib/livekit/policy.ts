export type LiveKitRole = 'customer' | 'owner_consult' | 'owner_merged';

export const LIVEKIT_AGENT_NAME =
  process.env.LIVEKIT_AGENT_NAME?.trim() || 'nordic-omni';

export interface LiveKitActor {
  isAgency: boolean;
  tenantIds: string[];
}

export type LiveKitAccess =
  | { ok: true; role: LiveKitRole; contactId?: string }
  | { ok: false; status: 403; error: string };

/**
 * Authorization is deliberately independent of browser-supplied identity and
 * room name. The route supplies database-backed facts to this pure policy.
 */
export function resolveLiveKitAccess(args: {
  tenantId: string;
  tenantStatus: string;
  contactId?: string;
  contactTenantId?: string;
  requestedRole: LiveKitRole;
  session: LiveKitActor | null;
  isTenantOwner: boolean;
}): LiveKitAccess {
  const {
    tenantId,
    tenantStatus,
    contactId,
    contactTenantId,
    requestedRole,
    session,
    isTenantOwner,
  } = args;

  if (tenantStatus !== 'active') {
    return { ok: false, status: 403, error: 'This workspace is not accepting calls' };
  }

  if (requestedRole !== 'customer') {
    const member = Boolean(
      session && (session.isAgency || session.tenantIds.includes(tenantId)),
    );
    if (!session || !member || (!session.isAgency && !isTenantOwner)) {
      return { ok: false, status: 403, error: 'Owner authorization is required' };
    }
    return { ok: true, role: requestedRole };
  }

  if (session && !session.isAgency && !session.tenantIds.includes(tenantId)) {
    return { ok: false, status: 403, error: 'Not authorized for this tenant' };
  }
  if (!contactId || contactTenantId !== tenantId) {
    return { ok: false, status: 403, error: 'Contact does not belong to this tenant' };
  }
  return { ok: true, role: 'customer', contactId };
}

export function buildRoomName(slug: string, subjectId: string, attemptId: string): string {
  return `${slug}_call_${subjectId}_${attemptId}`;
}

export function buildParticipantIdentity(
  role: LiveKitRole,
  subjectId: string,
  attemptId: string,
): string {
  return `${role === 'customer' ? 'customer' : 'owner'}_${subjectId}_${attemptId}`;
}

/** Small per-process abuse guard. Production deployments should also rate-limit at the edge. */
export class FixedWindowRateLimiter {
  private readonly hits = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly limit = 10,
    private readonly windowMs = 60_000,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const current = this.hits.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.hits.set(key, { startedAt: now, count: 1 });
    } else {
      if (current.count >= this.limit) return false;
      current.count += 1;
    }

    if (this.hits.size > 10_000) {
      for (const [storedKey, value] of this.hits) {
        if (now - value.startedAt >= this.windowMs) this.hits.delete(storedKey);
      }
    }
    return true;
  }
}
