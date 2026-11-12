import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { isPrivateAddress } from '@/lib/ai/website';
import { withUser } from '@/lib/db/client';
import {
  listActiveWebhooksForDispatch,
  recordWebhookDeliverySystem,
} from '@/lib/db/trusted-records';

import {
  WEBHOOK_EVENTS,
  type WebhookDeliveryRow,
  type WebhookEvent,
  type WebhookRow,
} from '@/lib/webhook-types';

export {
  WEBHOOK_EVENTS,
  type WebhookDeliveryRow,
  type WebhookEvent,
  type WebhookRow,
};

export interface PinnedTarget {
  url: URL;
  pinnedIp: string;
  family: 4 | 6;
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('hex')}`;
}

export function signWebhookPayload(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function verifyWebhookSignature(secret: string, body: string, header: string | null): boolean {
  if (!header) return false;
  const expected = signWebhookPayload(secret, body);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(header, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export type DnsLookupFn = (
  hostname: string
) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: DnsLookupFn = (hostname) => lookup(hostname, { all: true, verbatim: true });

export async function assertAndPinWebhookUrl(
  rawUrl: string,
  dnsLookup: DnsLookupFn = defaultLookup
): Promise<PinnedTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error('Enter a valid http or https webhook URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Webhook URLs must use http or https.');
  }
  if (url.username || url.password) {
    throw new Error('Webhook URLs cannot contain embedded credentials.');
  }
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Local and private webhook targets are not allowed.');
  }

  const literalVersion = isIP(host.replace(/^\[|\]$/g, ''));
  if (literalVersion === 4 || literalVersion === 6) {
    const cleanIp = host.replace(/^\[|\]$/g, '');
    if (isPrivateAddress(cleanIp)) {
      throw new Error('Private or loopback IP webhook targets are not allowed.');
    }
    return { url, pinnedIp: cleanIp, family: literalVersion };
  }

  const resolved = await dnsLookup(host);
  if (resolved.length === 0) {
    throw new Error('The webhook hostname did not resolve.');
  }
  for (const entry of resolved) {
    if (isPrivateAddress(entry.address)) {
      throw new Error('Webhook hostname resolves to a private or loopback address.');
    }
  }
  const first = resolved[0];
  const family: 4 | 6 = isIP(first.address) === 6 ? 6 : 4;
  return { url, pinnedIp: first.address, family };
}

export interface DeliveryOutcome {
  statusCode: number | null;
  success: boolean;
  error: string | null;
}

export async function deliverPinnedWebhook({
  target,
  eventType,
  body,
  signature,
  timeoutMs = 7000,
}: {
  target: PinnedTarget;
  eventType: string;
  body: string;
  signature: string;
  timeoutMs?: number;
}): Promise<DeliveryOutcome> {
  const { url, pinnedIp, family } = target;
  const isHttps = url.protocol === 'https:';
  const port = url.port ? Number(url.port) : isHttps ? 443 : 80;
  const path = `${url.pathname}${url.search}`;

  return new Promise<DeliveryOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: DeliveryOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    const transport = isHttps ? https : http;
    const req = transport.request(
      {
        host: pinnedIp,
        port,
        family,
        path,
        method: 'POST',
        headers: {
          Host: url.host,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'NORDIC-OMNI-Webhook/1.0',
          'X-OMNI-Event': eventType,
          'X-OMNI-Signature': signature,
        },
        ...(isHttps ? { servername: url.hostname } : {}),
        timeout: timeoutMs,
      },
      (res) => {
        const statusCode = res.statusCode ?? null;
        res.resume();
        if (statusCode !== null && statusCode >= 300 && statusCode < 400) {
          finish({ statusCode, success: false, error: `Redirects are not followed (HTTP ${statusCode})` });
          return;
        }
        const ok = statusCode !== null && statusCode >= 200 && statusCode < 300;
        finish({
          statusCode,
          success: ok,
          error: ok ? null : `HTTP ${statusCode ?? 'unknown'}`,
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Webhook request timed out after ${timeoutMs}ms`));
    });
    req.on('error', (err) => {
      finish({ statusCode: null, success: false, error: err.message.slice(0, 400) });
    });

    req.write(body);
    req.end();
  });
}

export async function listWebhooks(
  actingUserId: string,
  tenantId: string | null
): Promise<WebhookRow[]> {
  return withUser(actingUserId, async (tx) => {
    const rows =
      tenantId === null
        ? await tx`
            select id, tenant_id, name, url, signing_secret, events, is_active, created_at, updated_at
            from public.webhooks
            where tenant_id is null
            order by created_at desc
          `
        : await tx`
            select id, tenant_id, name, url, signing_secret, events, is_active, created_at, updated_at
            from public.webhooks
            where tenant_id = ${tenantId}::uuid
            order by created_at desc
          `;
    return rows as unknown as WebhookRow[];
  });
}

export async function listWebhookDeliveries(
  actingUserId: string,
  tenantId: string | null,
  limit = 20
): Promise<WebhookDeliveryRow[]> {
  return withUser(actingUserId, async (tx) => {
    const rows =
      tenantId === null
        ? await tx`
            select d.id, d.webhook_id, w.name as webhook_name, d.tenant_id,
                   d.event_type, d.status_code, d.success, d.error, d.created_at
            from public.webhook_deliveries d
            join public.webhooks w on w.id = d.webhook_id
            where d.tenant_id is null
            order by d.created_at desc
            limit ${limit}
          `
        : await tx`
            select d.id, d.webhook_id, w.name as webhook_name, d.tenant_id,
                   d.event_type, d.status_code, d.success, d.error, d.created_at
            from public.webhook_deliveries d
            join public.webhooks w on w.id = d.webhook_id
            where d.tenant_id = ${tenantId}::uuid
            order by d.created_at desc
            limit ${limit}
          `;
    return rows as unknown as WebhookDeliveryRow[];
  });
}

export async function createWebhook(
  actingUserId: string,
  input: {
    tenantId: string | null;
    name: string;
    url: string;
    events: WebhookEvent[];
  }
): Promise<WebhookRow> {
  await assertAndPinWebhookUrl(input.url);
  const secret = generateWebhookSecret();
  return withUser(actingUserId, async (tx) => {
    const rows = await tx`
      insert into public.webhooks (tenant_id, name, url, signing_secret, events, is_active)
      values (
        ${input.tenantId}::uuid,
        ${input.name.trim()},
        ${input.url.trim()},
        ${secret},
        ${input.events}::text[],
        true
      )
      returning id, tenant_id, name, url, signing_secret, events, is_active, created_at, updated_at
    `;
    return rows[0] as unknown as WebhookRow;
  });
}

export async function updateWebhook(
  actingUserId: string,
  webhookId: string,
  input: {
    name: string;
    url: string;
    events: WebhookEvent[];
    isActive: boolean;
  }
): Promise<void> {
  await assertAndPinWebhookUrl(input.url);
  await withUser(actingUserId, async (tx) => {
    const rows = await tx`
      update public.webhooks
         set name = ${input.name.trim()},
             url = ${input.url.trim()},
             events = ${input.events}::text[],
             is_active = ${input.isActive}
       where id = ${webhookId}::uuid
      returning id
    `;
    if (rows.length === 0) throw new Error('Webhook not found or access denied.');
  });
}

export async function rotateWebhookSecret(
  actingUserId: string,
  webhookId: string
): Promise<string> {
  const secret = generateWebhookSecret();
  await withUser(actingUserId, async (tx) => {
    const rows = await tx`
      update public.webhooks
         set signing_secret = ${secret}
       where id = ${webhookId}::uuid
      returning id
    `;
    if (rows.length === 0) throw new Error('Webhook not found or access denied.');
  });
  return secret;
}

export async function deleteWebhook(actingUserId: string, webhookId: string): Promise<void> {
  await withUser(actingUserId, async (tx) => {
    const rows = await tx`
      delete from public.webhooks where id = ${webhookId}::uuid returning id
    `;
    if (rows.length === 0) throw new Error('Webhook not found or access denied.');
  });
}

export async function sendTestWebhook(
  actingUserId: string,
  webhookId: string
): Promise<DeliveryOutcome> {
  const hook = await withUser(actingUserId, async (tx) => {
    const rows = await tx`
      select id, tenant_id, name, url, signing_secret
      from public.webhooks
      where id = ${webhookId}::uuid
      limit 1
    `;
    return rows[0] as
      | { id: string; tenant_id: string | null; name: string; url: string; signing_secret: string }
      | undefined;
  });
  if (!hook) throw new Error('Webhook not found or access denied.');

  const payload = {
    event: 'webhook.test',
    webhookId: hook.id,
    tenantId: hook.tenant_id,
    name: hook.name,
    sentAt: new Date().toISOString(),
  };
  const body = JSON.stringify(payload);
  let outcome: DeliveryOutcome;
  try {
    const target = await assertAndPinWebhookUrl(hook.url);
    const sig = signWebhookPayload(hook.signing_secret, body);
    outcome = await deliverPinnedWebhook({
      target,
      eventType: 'webhook.test',
      body,
      signature: sig,
    });
  } catch (err) {
    outcome = {
      statusCode: null,
      success: false,
      error: err instanceof Error ? err.message.slice(0, 400) : 'Blocked webhook URL',
    };
  }

  await withUser(actingUserId, async (tx) => {
    await tx`
      insert into public.webhook_deliveries (
        webhook_id, tenant_id, event_type, status_code, success, error, payload
      ) values (
        ${hook.id}::uuid,
        ${hook.tenant_id}::uuid,
        'webhook.test',
        ${outcome.statusCode},
        ${outcome.success},
        ${outcome.error},
        ${JSON.stringify(payload)}::jsonb
      )
    `;
  });

  return outcome;
}

export async function dispatchWebhookEvent(
  tenantId: string,
  eventType: WebhookEvent,
  data: Record<string, unknown>
): Promise<void> {
  let targets;
  try {
    targets = await listActiveWebhooksForDispatch(tenantId, eventType);
  } catch {
    return;
  }
  if (targets.length === 0) return;

  const payload = {
    event: eventType,
    tenantId,
    timestamp: new Date().toISOString(),
    data,
  };
  const body = JSON.stringify(payload);

  await Promise.allSettled(
    targets.map(async (hook) => {
      let outcome: DeliveryOutcome;
      try {
        const target = await assertAndPinWebhookUrl(hook.url);
        const sig = signWebhookPayload(hook.signing_secret, body);
        outcome = await deliverPinnedWebhook({
          target,
          eventType,
          body,
          signature: sig,
        });
      } catch (err) {
        outcome = {
          statusCode: null,
          success: false,
          error: err instanceof Error ? err.message.slice(0, 400) : 'Delivery failed',
        };
      }

      await recordWebhookDeliverySystem({
        webhookId: hook.id,
        tenantId: hook.tenant_id,
        eventType,
        statusCode: outcome.statusCode,
        success: outcome.success,
        error: outcome.error,
        payload,
      }).catch(() => undefined);
    })
  );
}
