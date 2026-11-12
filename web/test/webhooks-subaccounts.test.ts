import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.DATABASE_ADMIN_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.SESSION_SECRET ||= 'x'.repeat(64);
process.env.NEXT_PUBLIC_LIVEKIT_URL ||= 'ws://localhost:7880';
process.env.LIVEKIT_API_KEY ||= 'test-key';
process.env.LIVEKIT_API_SECRET ||= 'test-secret';

test('webhook URL validator blocks SSRF targets and pins public DNS results', async () => {
  const { assertAndPinWebhookUrl } = await import('../src/lib/webhooks');
  for (const bad of [
    'http://localhost:4000/hook',
    'https://127.0.0.1/hook',
    'http://169.254.169.254/latest/meta-data',
    'http://[::ffff:169.254.169.254]/hook',
    'http://[::ffff:a9fe:a9fe]/hook',
    'https://user:pass@hooks.example.com/hook',
    'ftp://hooks.example.com/hook',
  ]) {
    await assert.rejects(() => assertAndPinWebhookUrl(bad));
  }

  await assert.rejects(() =>
    assertAndPinWebhookUrl('https://rebind.example.com/hook', async () => [
      { address: '10.0.0.5', family: 4 },
    ])
  );

  const pinned = await assertAndPinWebhookUrl('https://hooks.example.com/events', async () => [
    { address: '93.184.216.34', family: 4 },
  ]);
  assert.equal(pinned.pinnedIp, '93.184.216.34');
  assert.equal(pinned.family, 4);
});

test('webhook HMAC signing and pinned HTTP delivery reject redirects and verify signatures', async () => {
  const {
    deliverPinnedWebhook,
    generateWebhookSecret,
    signWebhookPayload,
    verifyWebhookSignature,
  } = await import('../src/lib/webhooks');
  const secret = generateWebhookSecret();
  assert.ok(secret.length >= 32);
  const body = JSON.stringify({ event: 'lead.created', id: '123' });
  const sig = signWebhookPayload(secret, body);
  assert.equal(verifyWebhookSignature(secret, body, sig), true);
  assert.equal(verifyWebhookSignature(secret, body, `${sig}0`), false);
  assert.equal(verifyWebhookSignature(secret, body, null), false);

  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: 'http://169.254.169.254/' });
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const ok = verifyWebhookSignature(secret, raw, String(req.headers['x-omni-signature'] ?? ''));
      res.writeHead(ok ? 202 : 401);
      res.end(ok ? 'accepted' : 'bad-sig');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const targetUrl = new URL(`http://127.0.0.1:${address.port}/ok`);

    const delivered = await deliverPinnedWebhook({
      target: { url: targetUrl, pinnedIp: '127.0.0.1', family: 4 },
      eventType: 'lead.created',
      body,
      signature: sig,
    });
    assert.equal(delivered.success, true);
    assert.equal(delivered.statusCode, 202);

    const redirectUrl = new URL(`http://127.0.0.1:${address.port}/redirect`);
    const blockedRedirect = await deliverPinnedWebhook({
      target: { url: redirectUrl, pinnedIp: '127.0.0.1', family: 4 },
      eventType: 'lead.created',
      body,
      signature: sig,
    });
    assert.equal(blockedRedirect.success, false);
    assert.equal(blockedRedirect.statusCode, 302);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('GoHighLevel sub-account isolation: client portal and login leak zero agency UI or demo passwords', () => {
  const loginForm = readFileSync(
    fileURLToPath(new URL('../src/app/login/LoginForm.tsx', import.meta.url)),
    'utf8'
  );
  assert.doesNotMatch(loginForm, /agency@nordic-omni\.local|demo1234|Agency Admin/i);

  const portalRoot = fileURLToPath(new URL('../src/app/(client)/', import.meta.url));
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  for (const file of walk(portalRoot)) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /href=["'][^"']*\/agency|requireAgency|agency_members|agency@nordic-omni/i, file);
  }

  const m0016 = readFileSync(
    fileURLToPath(new URL('../../db/migrations/0016_webhooks_and_subaccount_provisioning.sql', import.meta.url)),
    'utf8'
  );
  assert.match(m0016, /SECURITY DEFINER/);
  assert.match(m0016, /subaccount_create_user/);
  assert.match(m0016, /subaccount_reset_password/);
  assert.match(m0016, /subaccount_set_user_active/);
  assert.match(m0016, /guard_webhook_identity/);
});
