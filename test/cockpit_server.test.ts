import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

const require = createRequire(import.meta.url);
const cockpit = require('../cockpit/server.js') as {
  MAX_BODY_BYTES: number;
  createCockpitServer: (options: Record<string, unknown>) => Server;
};

const payload = {
  model: 'agent-test',
  category: 'webrtc-ui-visualizer-and-cockpit-bridge',
  score: 9.5,
  verdict: 'PASS',
  experience: 'lifecycle verified',
  snippet: 'const disposed = true;',
};

function runningStatus() {
  return {
    master: false,
    services: {
      web: { running: false },
      worker: { running: false },
      database: { running: false },
      ollama: { running: false },
      n8n: { running: false },
    },
    timestamp: new Date().toISOString(),
  };
}

async function harness(t: TestContext, options: Record<string, unknown> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'cockpit-test-'));
  const publicDir = join(directory, 'public');
  mkdirSync(publicDir);
  writeFileSync(join(publicDir, 'index.html'), '<h1>Cockpit</h1>');
  writeFileSync(join(directory, 'secret.txt'), 'do-not-serve');
  const registryFile = join(directory, 'tools_registry.json');
  const evaluationsFile = join(directory, 'arena_evals.json');
  writeFileSync(registryFile, '[]');
  writeFileSync(evaluationsFile, '[]');
  const server = cockpit.createCockpitServer({
    publicDir,
    registryFile,
    evaluationsFile,
    getSystemStatus: async () => runningStatus(),
    ...options,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    base: `http://127.0.0.1:${address.port}`,
    directory,
    publicDir,
    registryFile,
    evaluationsFile,
  };
}

const jsonPost = (base: string, path: string, value: unknown) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(value),
});

test('webhook validates shape, persists exact schema, caps bodies, and writes atomically', async (t) => {
  const h = await harness(t);
  const invalid = await jsonPost(h.base, '/api/webhook/arena', { ...payload, score: '9.5' });
  assert.equal(invalid.status, 400);
  const missing = await jsonPost(h.base, '/api/webhook/arena', { model: 'incomplete' });
  assert.equal(missing.status, 400);
  assert.deepEqual(JSON.parse(readFileSync(h.evaluationsFile, 'utf8')), []);

  const accepted = await jsonPost(h.base, '/api/webhook/arena', payload);
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), {
    success: true,
    entryId: (JSON.parse(readFileSync(h.evaluationsFile, 'utf8'))[0].id),
    count: 1,
  });
  const entries = JSON.parse(readFileSync(h.evaluationsFile, 'utf8'));
  assert.equal(entries.length, 1);
  assert.deepEqual(Object.keys(entries[0]).sort(), [
    'benchmarkScore', 'category', 'codeExperience', 'diffOrSnippet',
    'id', 'model', 'source', 'timestamp', 'verdict',
  ].sort());
  assert.equal(entries[0].benchmarkScore, payload.score);
  assert.equal(entries[0].codeExperience, payload.experience);
  assert.equal(entries[0].diffOrSnippet, payload.snippet);
  assert.deepEqual(readdirSync(h.directory).filter((name) => name.endsWith('.tmp')), []);

  const listed = await fetch(`${h.base}/api/webhook/arena`);
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).length, 1);

  const oversized = await fetch(`${h.base}/api/webhook/arena`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'x'.repeat(cockpit.MAX_BODY_BYTES + 1),
  });
  assert.equal(oversized.status, 413);
  assert.equal(JSON.parse(readFileSync(h.evaluationsFile, 'utf8')).length, 1);
});

test('webhook caps at 50 and concurrent writes remain valid JSON', async (t) => {
  const h = await harness(t);
  writeFileSync(h.evaluationsFile, JSON.stringify(Array.from({ length: 50 }, (_, index) => ({ index }))));
  const responses = await Promise.all(
    Array.from({ length: 12 }, (_, index) => jsonPost(h.base, '/api/webhook/arena', {
      ...payload,
      model: `agent-${index}`,
    })),
  );
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal((await response.json()).count, 50);
  }
  const entries = JSON.parse(readFileSync(h.evaluationsFile, 'utf8'));
  assert.equal(entries.length, 50);
  assert.equal(entries[0].category, payload.category);
  assert.ok(entries.every((entry) => entry.category === payload.category || typeof entry.index === 'number'));
  assert.deepEqual(readdirSync(h.directory).filter((name) => name.endsWith('.tmp')), []);
});

test('static serving rejects encoded traversal and symlink escapes', async (t) => {
  const h = await harness(t);
  assert.equal((await fetch(`${h.base}/`)).status, 200);
  const traversal = await fetch(`${h.base}/..%2Fsecret.txt`);
  assert.equal(traversal.status, 403);
  assert.doesNotMatch(await traversal.text(), /do-not-serve/);
  symlinkSync(join(h.directory, 'secret.txt'), join(h.publicDir, 'leak.txt'));
  const symlink = await fetch(`${h.base}/leak.txt`);
  assert.equal(symlink.status, 403);
  assert.doesNotMatch(await symlink.text(), /do-not-serve/);
});

test('tools use bounded atomic JSON and toggle rejects unknown actions', async (t) => {
  let started = 0;
  let stopped = 0;
  const h = await harness(t, {
    startWorker: async () => { started += 1; },
    stopWorker: async () => { stopped += 1; },
  });
  const tool = await jsonPost(h.base, '/api/tools', { name: 'Local tool', command: 'status' });
  assert.equal(tool.status, 200);
  const registry = JSON.parse(readFileSync(h.registryFile, 'utf8'));
  assert.equal(registry.length, 1);
  assert.equal(registry[0].name, 'Local tool');
  assert.ok(registry[0].id);
  assert.deepEqual(readdirSync(h.directory).filter((name) => name.endsWith('.tmp')), []);

  assert.equal((await jsonPost(h.base, '/api/toggle', { service: 'other', action: 'start' })).status, 400);
  assert.equal((await jsonPost(h.base, '/api/toggle', { service: 'worker', action: 'restart' })).status, 400);
  assert.equal(started + stopped, 0);
  const start = await jsonPost(h.base, '/api/toggle', { service: 'worker', action: 'start' });
  assert.equal(start.status, 200);
  assert.equal(started, 1);
  const stop = await jsonPost(h.base, '/api/toggle', { service: 'worker', action: 'stop' });
  assert.equal(stop.status, 200);
  assert.equal(stopped, 1);
});

test('cockpit has one webhook route pair and self-safe worker process detection', () => {
  const source = readFileSync(new URL('../cockpit/server.js', import.meta.url), 'utf8');
  assert.equal((source.match(/url\.pathname === '\/api\/webhook\/arena' && req\.method === 'POST'/g) ?? []).length, 1);
  assert.equal((source.match(/url\.pathname === '\/api\/webhook\/arena' && req\.method === 'GET'/g) ?? []).length, 1);
  assert.match(source, /\[a\]gent-worker/);
  assert.match(source, /path\.resolve\(publicDir, relative\)/);
  assert.match(source, /fs\.renameSync\(temporary, file\)/);
});
