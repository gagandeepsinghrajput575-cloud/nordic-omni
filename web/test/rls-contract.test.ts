import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CallStatusSchema,
  ChannelSchema,
  InspectionStatusSchema,
} from '../src/contracts/schemas';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migrationDirectory = fileURLToPath(new URL('../../db/migrations/', import.meta.url));
const migrations = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(migrationDirectory, name), 'utf8') }));
const allSql = migrations.map((migration) => migration.sql).join('\n');

test('owner-pool imports are limited to explicit infrastructure/trusted-write boundaries', () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && readFileSync(path, 'utf8').includes('adminSql')) {
        files.push(path.slice(root.length));
      }
    }
  };
  walk(root);
  assert.deepEqual(files.sort(), [
    'app/api/auth/login/route.ts',
    'app/api/health/route.ts',
    'app/api/livekit/abandon/route.ts',
    'app/api/livekit/token/route.ts',
    'lib/auth/session.ts',
    'lib/db/client.ts',
    'lib/db/trusted-records.ts',
    'lib/webhooks/dispatcher.ts',
  ]);
  assert.doesNotMatch(source('../src/lib/db/queries.ts'), /adminSql/);
  assert.doesNotMatch(source('../src/lib/ai/escalation.ts'), /adminSql/);
  assert.doesNotMatch(source('../src/lib/db/chat.ts'), /adminSql/);
  assert.equal((source('../src/lib/db/trusted-records.ts').match(/adminSql\.begin/g) ?? []).length, 2);

  const chat = source('../src/lib/db/chat.ts');
  for (const functionName of [
    'loadChatContext', 'loadChatMessages', 'appendChatMessage',
    'mergeContactMemory', 'updateChatContactState',
  ]) {
    const body = chat.split(`export async function ${functionName}`)[1].split('export async function')[0];
    assert.match(body, /withPublicContact/, functionName);
    assert.doesNotMatch(body, /adminSql/, functionName);
  }
});

test('every tenant-scoped table enables RLS and tenant reassignment is blocked', () => {
  const tenantTables = [
    'tenant_members', 'tenants', 'tenant_agent_config', 'agent_config_history',
    'contacts', 'messages', 'call_logs', 'ui_command_events', 'knowledge_items',
    'project_estimates', 'inspection_requests', 'knowledge_sources',
    'knowledge_bundles', 'conversation_escalations',
  ];
  for (const table of tenantTables) {
    assert.match(allSql, new RegExp(`ALTER TABLE\\s+${table}\\s+ENABLE ROW LEVEL SECURITY`), table);
    if (table !== 'tenants') {
      assert.match(allSql, new RegExp(`'${table}'`), `${table} immutable-tenant trigger`);
    }
  }
  assert.match(allSql, /CREATE OR REPLACE FUNCTION prevent_tenant_reassignment/);
  assert.match(allSql, /IF OLD\.tenant_id IS DISTINCT FROM NEW\.tenant_id THEN/);
});

test('public capabilities are contact-derived and estimate/inspection inserts stay trusted-only', () => {
  const latest = migrations.find((migration) => migration.name.startsWith('0013_'))?.sql ?? '';
  for (const policy of [
    'contacts_public_read', 'contacts_public_update', 'tenants_public_read',
    'agent_config_public_read', 'knowledge_public_read', 'messages_public_read',
    'messages_public_write', 'escalations_public_read', 'escalations_public_write',
    'escalations_public_notification_update',
  ]) {
    assert.match(latest, new RegExp(`CREATE POLICY ${policy}`), policy);
  }
  assert.match(latest, /SELECT tenant_id FROM public\.contacts WHERE id = app_public_contact_id\(\)/);
  assert.match(latest, /square_meters <= 100000/);
  for (const table of ['project_estimates', 'inspection_requests']) {
    assert.doesNotMatch(
      allSql,
      new RegExp(`CREATE POLICY \\w+ ON ${table} FOR INSERT`, 'i'),
      `${table} must not acquire a client INSERT policy`,
    );
  }
});

test('SQL enums and Zod enums agree, including web_chat added outside a transaction', () => {
  assert.deepEqual(CallStatusSchema.options, [
    'ringing', 'in_progress', 'dire_hold_for_owner', 'owner_consulting_ai',
    'merged_live_with_owner', 'ai_relaying_owner_instruction', 'completed', 'missed',
  ]);
  assert.deepEqual(ChannelSchema.options, [
    'lead_form', 'whatsapp', 'instagram', 'voice_inbound',
    'voice_instant_webrtc', 'owner_whisper', 'web_chat',
  ]);
  assert.deepEqual(InspectionStatusSchema.options, [
    'requested', 'confirmed', 'completed', 'cancelled',
  ]);
  const chatMigration = migrations.find((migration) => migration.name.startsWith('0010_'))?.sql ?? '';
  assert.match(chatMigration, /ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'web_chat'/);
  assert.doesNotMatch(chatMigration, /^BEGIN;/m);
  assert.match(allSql, /idx_messages_tenant_contact_created/);
  assert.match(allSql, /idx_project_estimates_tenant_contact_created/);
  assert.match(allSql, /idx_inspection_requests_tenant_contact_created/);
});

test('recording_path guard and chat/portal Batch-2 contracts hold', () => {
  const recordingGuard = migrations.find((migration) => migration.name.startsWith('0014_'))?.sql ?? '';
  assert.match(recordingGuard, /CREATE OR REPLACE FUNCTION guard_call_recording_path/);
  assert.match(recordingGuard, /BEFORE UPDATE ON call_logs/);
  assert.match(recordingGuard, /current_user = 'omni_app'/);
  assert.match(recordingGuard, /NEW\.recording_path IS DISTINCT FROM OLD\.recording_path/);

  const chat = source('../src/lib/db/chat.ts');
  const stageBody = chat.split('export async function updateChatContactState')[1];
  assert.match(stageBody, /'booked'/);
  assert.match(stageBody, /'closed_won'/);
  assert.match(stageBody, /'closed_lost'/);

  const leadsActions = source('../src/app/(client)/portal/leads/actions.ts');
  assert.match(leadsActions, /'voice_instant_webrtc' : 'web_chat'/);
  assert.match(leadsActions, /getAll\('aiAutoReplyEnabled'\)/);

  const settingsActions = source('../src/app/(client)/portal/settings/actions.ts');
  assert.match(settingsActions, /estimate_model_/);
  assert.match(settingsActions, /estimate_min_dkk_/);
  assert.match(settingsActions, /estimate_max_dkk_/);

  const isolation = migrations.find((migration) => migration.name.startsWith('0015_'))?.sql ?? '';
  assert.match(isolation, /REVOKE ALL ON users FROM omni_app/);
  assert.doesNotMatch(isolation, /GRANT SELECT \([^)]*password_hash/i);
  assert.match(isolation, /REVOKE ALL ON sessions FROM omni_app/);
  assert.match(isolation, /guard_tenant_agency_columns/);
  assert.match(isolation, /BEFORE UPDATE ON tenants/);
});
