import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { adminSql, withUser } from '@/lib/db/client';
import { assertPublicUrl } from '@/lib/ai/website';
import { envelope, retryDelay, signedHeaders } from './protocol';

const MAX_ATTEMPTS = 6;

/** DNS-pin the validated public address. TLS still verifies the original hostname.
 * No redirects, credentials in URLs, private networks or unbounded response bodies.
 * Only the privileged delivery worker uses adminSql; configuration remains RLS-gated. */
async function postPinned(rawBody: string, target: string, headers: Record<string, string>): Promise<number> {
  const url = await assertPublicUrl(target);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  const address = addresses[0];
  if (!address) throw new Error('Endpoint hostname did not resolve.');
  const family = isIP(address.address);
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(rawBody) },
      lookup: (_hostname, _options, callback) => callback(null, address.address, family),
      signal: AbortSignal.timeout(8000),
    }, (res) => {
      let bytes = 0;
      res.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 4096) res.destroy(); });
      res.on('end', () => resolve(res.statusCode ?? 0));
      res.on('error', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end(rawBody);
  });
}

export async function dispatchWebhooks(limit = 20): Promise<number> {
  // Recover abandoned claims after a process restart. A receiver must deduplicate
  // by X-OMNI-Delivery: network delivery is at-least-once, not exactly-once.
  await adminSql`
    update webhook_deliveries set status = 'pending', updated_at = now()
    where status = 'sending' and updated_at < now() - interval '2 minutes'
  `;
  const jobs = await adminSql.begin(async (tx) => {
    const rows = await tx`
    select d.id, d.attempts, e.url, e.secret, e.is_enabled,
           ev.id as event_id, ev.event_type, ev.tenant_id, ev.payload, ev.created_at
    from webhook_deliveries d
    join webhook_endpoints e on e.id = d.endpoint_id
    join webhook_events ev on ev.id = d.event_id
    where d.status in ('pending', 'failed') and d.attempts < ${MAX_ATTEMPTS}
      and d.next_attempt_at <= now()
    order by d.created_at
    for update of d skip locked
    limit ${limit}
  `;
    if (rows.length) await tx`update webhook_deliveries set status = 'sending', updated_at = now()
      where id = any(${`{${rows.map((j) => j.id).join(',')}}`}::uuid[])`;
    return rows;
  });
  if (!jobs.length) return 0;

  await Promise.all(jobs.map(async (job) => {
    const attempt = Number(job.attempts) + 1;
    let status = 0;
    let error: string | null = null;
    if (!job.is_enabled) {
      await adminSql`update webhook_deliveries set status = 'cancelled', updated_at = now() where id = ${job.id}`;
      return;
    }
    try {
      const body = {
        ...envelope(job.event_type as string, job.tenant_id as string | null, job.payload),
        id: job.event_id,
        createdAt: job.created_at,
      };
      status = await postPinned(JSON.stringify(body), job.url as string,
        signedHeaders(JSON.stringify(body), job.secret as string, job.id as string));
      if (status < 200 || status >= 300) error = `Receiver returned HTTP ${status}.`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message.slice(0, 400) : 'Network delivery failed.';
    }
    const succeeded = !error;
    await adminSql`
      update webhook_deliveries set
        status = ${succeeded ? 'delivered' : 'failed'}, attempts = ${attempt},
        response_status = ${status || null}, error = ${error},
        delivered_at = ${succeeded ? new Date() : null},
        next_attempt_at = now() + ${`${succeeded ? 0 : retryDelay(attempt)} milliseconds`}::interval,
        updated_at = now()
      where id = ${job.id}
    `;
  }));
  return jobs.length;
}

export async function testWebhook(userId: string, endpointId: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  const rows = await withUser(userId, async (tx) =>
    tx`select id, url, secret, tenant_id from webhook_endpoints where id = ${endpointId}`);
  const endpoint = rows[0];
  if (!endpoint) return { ok: false, error: 'Endpoint not found or agency access required.' };
  const body = JSON.stringify(envelope('webhook.test', endpoint.tenant_id as string | null, {
    message: 'Nordic Omni webhook connection test.',
  }));
  try {
    const status = await postPinned(body, endpoint.url as string,
      signedHeaders(body, endpoint.secret as string, `test-${endpoint.id}`));
    return status >= 200 && status < 300
      ? { ok: true, status }
      : { ok: false, status, error: `Receiver returned HTTP ${status}.` };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message.slice(0, 300) : 'Network delivery failed.' };
  }
}
