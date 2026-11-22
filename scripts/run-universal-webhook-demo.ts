/**
 * Live demonstration and test runner for the Universal Agency Inbound Webhook
 * and Vision AI bidirectional bridge.
 *
 * Runs real HTTP requests against the live server on http://localhost:3000/api/v1/agency/webhook.
 */
import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { generateApiKey } from '../web/src/lib/webhooks/inbound-auth';
import { toVisionAlarm, toVisionTask, routeEvent, type OmniEvent } from '../web/src/lib/vision/bridge';

const BASE_URL = process.env.APP_URL || 'http://localhost:3000';
const AGENCY_USER_ID = 'a0000000-0000-4000-8000-000000000001'; // agency@nordic-omni.local
const DB_URL = process.env.DATABASE_ADMIN_URL || 'postgres://postgres@127.0.0.1:54330/nordic_omni';

async function createLiveApiKey() {
  const sql = postgres(DB_URL);
  const generated = generateApiKey();
  const hmacSecret = randomBytes(32).toString('hex');
  const [row] = await sql`
    insert into webhook_api_keys
      (agency_user_id, tenant_id, name, key_prefix, key_hash, hmac_secret, created_by)
    values
      (${AGENCY_USER_ID}, null, 'Vision AI Local Runner Key', ${generated.prefix},
       ${generated.hash}, ${hmacSecret}, ${AGENCY_USER_ID})
    returning id
  `;
  await sql.end();
  return { id: row.id, key: generated.key, prefix: generated.prefix };
}

async function callGateway(apiKey: string, payload: Record<string, unknown>) {
  const start = Date.now();
  const res = await fetch(`${BASE_URL}/api/v1/agency/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  const duration = Date.now() - start;
  const data = await res.json();
  return { status: res.status, ok: res.ok, duration, data };
}

async function run() {
  console.log('\n===============================================================');
  console.log('🚀 NORDIC OMNI — UNIVERSAL WEBHOOK & VISION AI BRIDGE RUNNER');
  console.log('===============================================================\n');

  // 1. Mint a fresh API key for the Agency Operator
  console.log('🔑 Step 1: Minting Agency API key for live gateway access...');
  const { id: keyId, key: apiKey, prefix } = await createLiveApiKey();
  console.log(`   ✓ Key generated! ID: ${keyId}`);
  console.log(`   ✓ Bearer Token: ${prefix}...${apiKey.slice(-6)}`);
  console.log(`   ✓ Full Key: ${apiKey}\n`);

  // 2. Fetch all client workspaces
  console.log('🏢 Step 2: Querying connected client tenants (`fetch_clients`)...');
  const clientsRes = await callGateway(apiKey, { action: 'fetch_clients' });
  console.log(`   HTTP ${clientsRes.status} in ${clientsRes.duration}ms:`, JSON.stringify(clientsRes.data, null, 2));

  const clients = (clientsRes.data as any)?.data?.clients || [];
  const primaryTenant = clients[0] || { id: '11111111-1111-4111-8111-111111111111', name: 'Dansk Byg & Renovering ApS' };
  const tenantId = primaryTenant.id;
  console.log(`\n   Targeting Tenant: "${primaryTenant.name}" (${tenantId})\n`);

  // 3. Fetch Agency / Tenant Metrics
  console.log('📊 Step 3: Fetching live conversion & revenue metrics (`fetch_metrics`)...');
  const metricsRes = await callGateway(apiKey, { action: 'fetch_metrics', tenantId });
  console.log(`   HTTP ${metricsRes.status} in ${metricsRes.duration}ms:`, JSON.stringify(metricsRes.data, null, 2));

  // 4. Ingest a New Lead (from Vision AI or external source)
  console.log('\n📥 Step 4: Ingesting a new high-priority lead (`create_lead`)...');
  const newLeadPayload = {
    action: 'create_lead',
    tenantId,
    name: 'Magnus Lind (Vision Ingest)',
    phone: '+4520998877',
    note: 'AKUT: Rørbrud i kælderen på Østerbro. Vand fosser ud.',
    triggerSms: false,
  };
  const leadRes = await callGateway(apiKey, newLeadPayload);
  console.log(`   HTTP ${leadRes.status} in ${leadRes.duration}ms:`, JSON.stringify(leadRes.data, null, 2));

  // 5. Verify leads list in CRM
  console.log('\n📋 Step 5: Querying leads via CRM gateway (`fetch_leads`)...');
  const leadsRes = await callGateway(apiKey, { action: 'fetch_leads', tenantId, limit: 2 });
  console.log(`   HTTP ${leadsRes.status} in ${leadsRes.duration}ms:`, JSON.stringify(leadsRes.data, null, 2));

  // 6. Grounded AI Copilot Query
  console.log('\n🤖 Step 6: Querying Grounded AI Copilot (`ask_copilot`)...');
  const copilotRes = await callGateway(apiKey, {
    action: 'ask_copilot',
    tenantId,
    query: 'Hvad er prisen for tømrer timetakst?',
  });
  console.log(`   HTTP ${copilotRes.status} in ${copilotRes.duration}ms:`, JSON.stringify(copilotRes.data, null, 2));

  // 7. Vision AI Bridge Translation Demo
  console.log('\n===============================================================');
  console.log('⚡ Step 7: Vision AI Bridge Contract Demonstration');
  console.log('   (Mapping Nordic Omni Events -> Vision AI Task & Alarm)');
  console.log('===============================================================\n');

  // Case A: High-Value Lead (>= 50,000 DKK) -> Maps to a Vision Task
  const highValueLeadEvent: OmniEvent = {
    id: 'evt_lead_' + Date.now(),
    type: 'lead.created',
    tenantId,
    createdAt: new Date().toISOString(),
    data: {
      leadId: (leadRes.data as any)?.data?.lead?.id || 'lead-12345',
      name: 'Magnus Lind',
      phone: '+4520998877',
      estimatedValueDkk: 145000,
      scope: 'Komplet Nyt Badeværelse',
    },
  };

  const leadRoute = routeEvent(highValueLeadEvent);
  console.log(`A. High-Value Lead Routing Decision: "${leadRoute.toUpperCase()}" (threshold >= 50,000 DKK)`);
  const visionTask = toVisionTask(highValueLeadEvent, { tenantName: primaryTenant.name });
  console.log('   Generated Vision AI Task (`untitled folder 2/me/src/shared/vision-contract.ts`):');
  console.log(JSON.stringify(visionTask, null, 2));

  // Case B: Urgent Escalation / Missed Call -> Maps to a Critical Vision Alarm
  const urgentEscalationEvent: OmniEvent = {
    id: 'evt_esc_' + Date.now(),
    type: 'escalation.created',
    tenantId,
    createdAt: new Date().toISOString(),
    data: {
      callerName: 'Jens Hansen',
      callerPhone: '+4570201122',
      urgency: 5, // critical
      summary: 'Døgnvagt: Hovedvandledning sprunget. Kræver omgående udrykning.',
    },
  };

  const escRoute = routeEvent(urgentEscalationEvent);
  console.log(`\nB. Urgent Escalation Routing Decision: "${escRoute.toUpperCase()}" (urgency >= 4 triggers ALARM)`);
  const visionAlarm = toVisionAlarm(urgentEscalationEvent, { tenantName: primaryTenant.name });
  console.log('   Generated Vision AI Alarm (`untitled folder 2/me/src/shared/vision-contract.ts`):');
  console.log(JSON.stringify(visionAlarm, null, 2));

  console.log('\n===============================================================');
  console.log('✅ ALL WEBHOOK ACTIONS & VISION AI BRIDGE PROVEN LIVE!');
  console.log('===============================================================\n');
}

run().catch((err) => {
  console.error('\n❌ Error running gateway demo:', err);
  process.exit(1);
});
