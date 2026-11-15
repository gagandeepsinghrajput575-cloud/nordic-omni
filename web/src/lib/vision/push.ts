import { assertPublicUrl } from '@/lib/ai/website';
import { computeSignature } from '@/lib/webhooks/inbound-auth';
import { newDeliveryId } from '@/lib/webhooks/inbound-auth';
import {
  routeEvent,
  toVisionAlarm,
  toVisionTask,
  type OmniEvent,
  type VisionAlarm,
  type VisionTask,
} from './bridge';

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Outbound push to Vision AI.
 *
 * The transport mirrors `lib/webhooks/dispatcher.ts` on purpose: validate the
 * URL as public, DNS-pin the resolved address, send no redirects, and cap the
 * response body. Vision runs on a laptop, so the *testing* path must be able to
 * target localhost — that is gated behind an explicit `allowPrivate` flag which
 * only the operator's own server-side config can set, never a request body.
 */

export interface VisionConfig {
  /** e.g. http://127.0.0.1:3000 */
  baseUrl: string;
  /** Shared secret for the HMAC we send to Vision. */
  secret: string;
  /** Required to accept a private/loopback base URL. Defaults to false. */
  allowPrivate?: boolean;
}

export type VisionPushResult =
  | { ok: true; status: number; deliveryId: string; channel: 'alarm' | 'task' }
  | { ok: false; error: string; deliveryId: string; channel: 'alarm' | 'task' | 'none' };

async function postJson(
  url: string,
  body: string,
  headers: Record<string, string>,
  allowPrivate: boolean,
): Promise<number> {
  let target: URL;
  if (allowPrivate) {
    target = new URL(url);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new Error('Vision endpoint must be http or https.');
    }
  } else {
    target = await assertPublicUrl(url);
  }

  const addresses = await lookup(target.hostname, { all: true, verbatim: true });
  const address = addresses[0];
  if (!address) throw new Error('Vision hostname did not resolve.');

  const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(
      target,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        lookup: (_hostname, _options, callback) =>
          callback(null, address.address, isIP(address.address)),
        signal: AbortSignal.timeout(8000),
      },
      (res) => {
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          // A receiver that streams forever must not become our problem.
          if (bytes > 4096) res.destroy();
        });
        res.on('end', () => resolve(res.statusCode ?? 0));
        res.on('error', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

async function push(
  config: VisionConfig,
  channel: 'alarm' | 'task',
  payload: VisionAlarm | VisionTask,
): Promise<VisionPushResult> {
  const deliveryId = newDeliveryId();
  const path = channel === 'alarm' ? '/api/alarms' : '/api/tasks';
  const base = config.baseUrl.replace(/\/+$/, '');
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Nordic-Omni-VisionBridge/1.0',
    'X-OMNI-Delivery': deliveryId,
    'X-OMNI-Timestamp': timestamp,
    'X-OMNI-Signature': computeSignature(timestamp, body, config.secret),
  };

  try {
    const status = await postJson(`${base}${path}`, body, headers, config.allowPrivate === true);
    if (status < 200 || status >= 300) {
      return { ok: false, channel, deliveryId, error: `Vision returned HTTP ${status}.` };
    }
    return { ok: true, channel, deliveryId, status };
  } catch (cause) {
    // Never surface a stack or a credential-bearing URL to the caller.
    const message = cause instanceof Error ? cause.message.slice(0, 300) : 'Vision push failed.';
    return { ok: false, channel, deliveryId, error: message };
  }
}

/**
 * Route one Omni event to Vision, or explain why it was not routed.
 * Returning a reason (rather than silently dropping) is what makes the
 * "why didn't I get an alarm?" question answerable.
 */
export async function pushEventToVision(
  config: VisionConfig | null,
  event: OmniEvent,
  tenantName?: string,
): Promise<VisionPushResult> {
  const deliveryId = newDeliveryId();
  if (!config) {
    return { ok: false, channel: 'none', deliveryId, error: 'Vision is not configured.' };
  }

  const route = routeEvent(event);
  if (route === 'none') {
    return {
      ok: false,
      channel: 'none',
      deliveryId,
      error: `${event.type} is below the Vision notification threshold.`,
    };
  }

  const ctx = { tenantName };
  return route === 'alarm'
    ? push(config, 'alarm', toVisionAlarm(event, ctx))
    : push(config, 'task', toVisionTask(event, ctx));
}

/** Read the Vision config from the environment. Absent means "not configured". */
export function visionConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): VisionConfig | null {
  const baseUrl = env.VISION_AI_BASE_URL?.trim();
  const secret = env.VISION_AI_SECRET?.trim();
  if (!baseUrl || !secret) return null;
  return {
    baseUrl,
    secret,
    allowPrivate: env.VISION_AI_ALLOW_PRIVATE === 'true',
  };
}

/** Headless probe used by the UI's "test connection" button. */
export async function probeVision(
  config: VisionConfig | null,
): Promise<{ configured: boolean; reachable: boolean; detail: string }> {
  if (!config) {
    return {
      configured: false,
      reachable: false,
      detail: 'Set VISION_AI_BASE_URL and VISION_AI_SECRET to enable the bridge.',
    };
  }

  // A task that is already done, so a mis-set endpoint cannot create live work.
  const probe = toVisionTask(
    { id: `probe-${Date.now()}`, type: 'escalation.created', tenantId: null, createdAt: new Date().toISOString(), data: { summary: 'Connection probe from Nordic Omni.' } },
    { tenantName: 'Nordic Omni' },
  );
  const result = await push({ ...config }, 'task', probe);
  return {
    configured: true,
    reachable: result.ok,
    detail: result.ok
      ? `Vision accepted the probe (HTTP ${result.status}).`
      : result.error,
  };
}
