import { withUser } from './client';
import { hashPassword } from '@/lib/auth/password';
import { newWebhookSecret, WEBHOOK_EVENTS } from '@/lib/webhooks/protocol';

export interface WorkspaceMember {
  id: string; email: string; full_name: string | null; role: string;
  is_active: boolean; must_change_password: boolean; created_at: string;
}
export async function listWorkspaceMembers(userId: string, tenantId: string): Promise<WorkspaceMember[]> {
  return withUser(userId, async (tx) => {
    if (!(await tx`select id from tenants where id = ${tenantId}`)[0]) return [];
    return await tx`
      select u.id, u.email, u.full_name, tm.role, u.is_active,
        coalesce(us.must_change_password, false) as must_change_password, u.created_at
      from tenant_members tm join users u on u.id = tm.user_id
      left join user_security us on us.user_id = u.id
      where tm.tenant_id = ${tenantId}
        and not exists (select 1 from agency_members am where am.user_id = u.id)
      order by tm.role, u.full_name, u.email
    ` as unknown as WorkspaceMember[];
  });
}

export async function setWorkspaceControls(userId: string, tenantId: string, status: string, mode: string, did: string | null) {
  return withUser(userId, async (tx) => {
    const rows = await tx`update tenants set status = ${status}, reception_mode = ${mode},
      flynumber_did = ${did}, updated_at = now() where id = ${tenantId} returning id`;
    if (!rows[0]) throw new Error('Workspace not found.');
    if (status !== 'active') await tx`delete from sessions where user_id in
      (select user_id from tenant_members where tenant_id = ${tenantId})`;
  });
}

export async function provisionMember(userId: string, tenantId: string, input: {
  fullName: string; email: string; password?: string; role: 'owner' | 'staff';
}) {
  const hash = input.password ? hashPassword(input.password) : '';
  return withUser(userId, async (tx) => {
    const rows = await tx`select provision_tenant_member(
      ${tenantId}, ${input.email}, ${hash}, ${input.fullName}, ${input.role}, ${Boolean(input.password)}
    ) as id`;
    return rows[0].id as string;
  });
}

export async function manageMember(userId: string, tenantId: string, memberId: string, action: 'suspend' | 'reactivate' | 'reset' | 'role', password?: string, role?: string) {
  const hash = password ? hashPassword(password) : null;
  await withUser(userId, async (tx) => {
    const members = await tx`select u.id, u.is_active from tenant_members tm
      join users u on u.id = tm.user_id
      where tm.tenant_id = ${tenantId} and tm.user_id = ${memberId}
      and not exists (select 1 from agency_members am where am.user_id = u.id)
      and not exists (select 1 from tenant_members other where other.user_id = u.id and other.tenant_id <> ${tenantId})
      for update of u`;
    if (!members[0]) throw new Error('Account not found in this workspace.');
    if (action === 'reset') {
      await tx`update users set password_hash = ${hash} where id = ${memberId}`;
    } else if (action === 'role') {
      await tx`update tenant_members set role = ${role!} where tenant_id = ${tenantId} and user_id = ${memberId}`;
    } else {
      await tx`update users set is_active = ${action === 'reactivate'} where id = ${memberId}`;
    }
    await tx`insert into user_security (user_id, session_version, must_change_password)
      values (${memberId}, 1, ${action === 'reset'}) on conflict (user_id) do update set
        session_version = user_security.session_version + 1,
        must_change_password = (user_security.must_change_password or ${action === 'reset'}), updated_at = now()`;
    await tx`delete from sessions where user_id = ${memberId}`;
  });
}

export interface WebhookEndpoint {
  id: string; name: string; url: string; tenant_id: string | null; events: string[];
  is_enabled: boolean; secret_hint: string; created_at: string;
  pending_count: number; delivered_count: number; failed_count: number;
  last_status: number | null; last_error: string | null; last_attempt_at: string | null;
}
export async function listWebhooks(userId: string, tenantId?: string): Promise<WebhookEndpoint[]> {
  return withUser(userId, async (tx) => {
    if (tenantId && !(await tx`select id from tenants where id = ${tenantId}`)[0]) throw new Error('Workspace not found.');
    return await tx`
      select e.id, e.name, e.url, e.tenant_id, e.events, e.is_enabled, e.created_at,
        right(e.secret, 4) as secret_hint,
        count(d.id) filter (where d.status in ('pending','sending'))::int as pending_count,
        count(d.id) filter (where d.status = 'delivered')::int as delivered_count,
        count(d.id) filter (where d.status = 'failed')::int as failed_count,
        latest.response_status as last_status, latest.error as last_error, latest.updated_at as last_attempt_at
      from webhook_endpoints e
      left join webhook_deliveries d on d.endpoint_id = e.id
      left join lateral (
        select response_status, error, updated_at from webhook_deliveries
        where endpoint_id = e.id and attempts > 0 order by updated_at desc limit 1
      ) latest on true
      where (${tenantId ?? null}::uuid is null or e.tenant_id = ${tenantId ?? null})
      group by e.id, latest.response_status, latest.error, latest.updated_at
      order by e.created_at desc
    ` as unknown as WebhookEndpoint[];
  });
}

export async function saveWebhook(userId: string, input: {
  id?: string; tenantId: string | null; name: string; url: string;
  events: string[]; enabled: boolean; secret?: string;
}) {
  if (input.events.some((event) => !WEBHOOK_EVENTS.includes(event as typeof WEBHOOK_EVENTS[number]))) throw new Error('Unknown event type.');
  return withUser(userId, async (tx) => {
    if (input.tenantId && !(await tx`select id from tenants where id = ${input.tenantId}`)[0]) throw new Error('Workspace not found.');
    if (input.id) {
      const rows = await tx`update webhook_endpoints set name = ${input.name}, url = ${input.url},
        events = ${input.events}, is_enabled = ${input.enabled}, tenant_id = ${input.tenantId},
        secret = coalesce(${input.secret ?? null}, secret), updated_at = now()
        where id = ${input.id} returning id`;
      if (!rows[0]) throw new Error('Endpoint not found.');
      return input.id;
    }
    const rows = await tx`insert into webhook_endpoints
      (tenant_id, name, url, events, is_enabled, secret, created_by)
      values (${input.tenantId}, ${input.name}, ${input.url}, ${input.events}, ${input.enabled},
        ${input.secret || newWebhookSecret()}, ${userId}) returning id`;
    return rows[0].id as string;
  });
}

export async function webhookAction(userId: string, id: string, action: 'delete' | 'toggle' | 'retry' | 'secret') {
  return withUser(userId, async (tx) => {
    if (action === 'delete') {
      await tx`delete from webhook_endpoints where id = ${id}`;
    } else if (action === 'toggle') {
      await tx`update webhook_endpoints set is_enabled = not is_enabled where id = ${id}`;
    } else if (action === 'retry') {
      await tx`update webhook_deliveries set status = 'pending', attempts = 0,
        next_attempt_at = now(), error = null, updated_at = now()
        where endpoint_id = ${id} and status = 'failed'`;
    } else {
      const secret = newWebhookSecret();
      const rows = await tx`update webhook_endpoints set secret = ${secret} where id = ${id} returning id`;
      if (!rows[0]) throw new Error('Endpoint not found.');
      return secret;
    }
    return null;
  });
}
