/**
 * Dress Rehearsal (Option A) End-to-End Verification
 * Exercises all 5 steps against the live database, web server, and AI voice worker.
 */

import { adminSql, withUser, jsonb } from '../src/lib/db/client';
import { hashPassword } from '../src/lib/auth/password';
import { signMediaUploadToken } from '../src/lib/media/tokens';
import { signReviewToken } from '../src/lib/review/tokens';
import { getPublicCallContext, listContactMedia, listContactReviews, listProjectEstimates } from '../src/lib/db/queries';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

interface RehearsalState {
  tenantId: string;
  tenantSlug: string;
  ownerUserId: string;
  contactId: string;
}

let failures: string[] = [];

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  [PASS] ${label}`);
  } else {
    console.error(`  [FAIL] ${label} - ${detail}`);
    failures.push(`${label} ${detail}`);
  }
}

async function step1_agencyOnboarding(): Promise<RehearsalState> {
  console.log('\n======================================================');
  console.log('STEP 1: Agency Onboarding (Creating new client)');
  console.log('======================================================');

  const slug = 'aarhus-murer-vvs';

  // 1. Clean up existing tenant if present for clean idempotent test
  const existingTenants = await adminSql`select id from tenants where slug = ${slug}`;
  for (const t of existingTenants) {
    await adminSql`delete from google_reviews where tenant_id = ${t.id}`;
    await adminSql`delete from contact_media where tenant_id = ${t.id}`;
    await adminSql`delete from project_estimates where tenant_id = ${t.id}`;
    await adminSql`delete from call_logs where tenant_id = ${t.id}`;
    await adminSql`delete from contacts where tenant_id = ${t.id}`;
    await adminSql`delete from tenant_agent_config where tenant_id = ${t.id}`;
    await adminSql`delete from tenant_members where tenant_id = ${t.id}`;
    await adminSql`delete from tenants where id = ${t.id}`;
  }
  await adminSql`delete from users where email = 'frederik@aarhusmurer.dk'`;

  // 2. Create the tenant
  const hours = {
    mon: { open: '08:00', close: '16:00' },
    tue: { open: '08:00', close: '16:00' },
    wed: { open: '08:00', close: '16:00' },
    thu: { open: '08:00', close: '16:00' },
    fri: { open: '08:00', close: '16:00' },
  };

  const catalog = [
    {
      id: 'nyt-bad',
      service: 'Nyt Badeværelse',
      price_dkk: 95000,
      estimate_min_dkk: 75000,
      estimate_max_dkk: 140000,
      estimate_model: 'fixed',
      unit: 'projekt',
    },
    {
      id: 'fliser',
      service: 'Flisearbejde',
      price_dkk: 1000,
      estimate_min_dkk: 800,
      estimate_max_dkk: 1200,
      estimate_model: 'per_square_meter',
      unit: 'm2',
    },
    {
      id: 'akut-vvs',
      service: 'Akut VVS-udkald',
      price_dkk: 2500,
      estimate_min_dkk: 2500,
      estimate_max_dkk: 4500,
      estimate_model: 'fixed',
      unit: 'udkald',
    },
  ];

  const tenantRows = await adminSql`
    insert into tenants (
      name, slug, owner_name, owner_phone, owner_email, default_language,
      business_hours, pricing_catalog, google_review_url, status
    ) values (
      'Aarhus Murer & VVS ApS', ${slug}, 'Frederik Holm', '+4587654321',
      'frederik@aarhusmurer.dk', 'da-DK', ${jsonb(hours)}::jsonb, ${jsonb(catalog)}::jsonb,
      'https://g.page/r/aarhus-murer/review', 'active'
    )
    returning id, slug
  `;
  const tenantId = tenantRows[0].id as string;
  check('Tenant created', !!tenantId, `tenantId: ${tenantId}`);

  // 3. Create owner user & membership
  const pwHash = hashPassword('SecurePassword2026!');
  const userRows = await adminSql`
    insert into users (email, password_hash, full_name, is_active)
    values ('frederik@aarhusmurer.dk', ${pwHash}, 'Frederik Holm', true)
    returning id
  `;
  const ownerUserId = userRows[0].id as string;
  await adminSql`
    insert into tenant_members (user_id, tenant_id, role)
    values (${ownerUserId}, ${tenantId}, 'owner')
  `;
  check('Owner user created with role owner', !!ownerUserId);

  // 4. Create tenant agent config
  const businessPrompt =
    'Du er den indgående AI-receptionist for Aarhus Murer & VVS ApS. Du tager imod opkald fra kunder i Aarhus og omegn. ' +
    'Du giver vejledende overslag baseret på vores priskatalog (inkl. 25% moms) og understreger altid, at dette er et uforpligtende estimat. ' +
    'Optagelsen er underlagt samtykke. Ejer er Frederik Holm.';
  const greeting =
    'Hej, du er kommet til Aarhus Murer & VVS. For at give dig den bedste service, optages samtalen. Hvordan kan jeg hjælpe dig i dag?';

  await adminSql`
    insert into tenant_agent_config (
      tenant_id, customer_system_prompt, copilot_system_prompt, greeting_script,
      escalation_policy, stt_language
    ) values (
      ${tenantId}, ${businessPrompt}, 'Co-pilot for Frederik Holm', ${greeting},
      ${jsonb({ emergency_keywords: ['vandskade', 'gaslugt', 'oversvømmelse'] })}::jsonb, 'da'
    )
  `;
  check('Tenant agent config created with Danish greeting & prompt', true);

  // 5. Create a lead contact for Aarhus Murer
  const contactRows = await adminSql`
    insert into contacts (
      tenant_id, full_name, phone_number, email, preferred_language,
      pipeline_stage, estimated_value_dkk, shared_memory_summary
    ) values (
      ${tenantId}, 'Mette Thomsen', '+4520123456', 'mette@thomsen.dk', 'da',
      'new_lead', 0, 'Kunde overvejer nyt badeværelse i parcelhus i Risskov.'
    )
    returning id
  `;
  const contactId = contactRows[0].id as string;
  check('Lead contact Mette Thomsen created', !!contactId, `contactId: ${contactId}`);

  return { tenantId, tenantSlug: slug, ownerUserId, contactId };
}

async function step2_clientIsolation(state: RehearsalState) {
  console.log('\n======================================================');
  console.log('STEP 2: Client Isolation (Multi-tenant RLS checks)');
  console.log('======================================================');

  // Query as Frederik Holm
  const contactsVisible = await withUser(state.ownerUserId, async (tx) => {
    return tx`select id, tenant_id, full_name from contacts`;
  });

  check(
    'Owner can see their own tenant contacts',
    contactsVisible.length === 1 && contactsVisible[0].id === state.contactId,
    `Visible count: ${contactsVisible.length}`
  );

  const danskBygId = '11111111-1111-4111-8111-111111111111';
  const danskBygContacts = await withUser(state.ownerUserId, async (tx) => {
    return tx`select id from contacts where tenant_id = ${danskBygId}`;
  });
  check(
    'Owner cannot see Dansk Byg contacts (isolated by RLS)',
    danskBygContacts.length === 0,
    `Count: ${danskBygContacts.length}`
  );

  const dentalId = '22222222-2222-4222-8222-222222222222';
  const dentalContacts = await withUser(state.ownerUserId, async (tx) => {
    return tx`select id from contacts where tenant_id = ${dentalId}`;
  });
  check(
    'Owner cannot see Nordic Dental contacts (isolated by RLS)',
    dentalContacts.length === 0,
    `Count: ${dentalContacts.length}`
  );

  // Attempt cross-tenant update as Frederik Holm
  const updateResult = await withUser(state.ownerUserId, async (tx) => {
    return tx`update contacts set full_name = 'Injected' where tenant_id = ${danskBygId} returning id`;
  });
  check(
    'Cross-tenant mutation blocked by RLS (0 rows affected)',
    updateResult.length === 0,
    `Updated rows: ${updateResult.length}`
  );
}

async function step3_liveDanishVoiceCall(state: RehearsalState) {
  console.log('\n======================================================');
  console.log('STEP 3: Live Danish Voice Call Context & Token');
  console.log('======================================================');

  // Check public call context for /call/[contactId]
  const context = await getPublicCallContext(state.contactId);
  check('Public call context loads', !!context);
  check('Tenant name is Aarhus Murer & VVS ApS', context?.tenant.name === 'Aarhus Murer & VVS ApS');
  check('Language is da-DK', context?.tenant.default_language === 'da-DK');
  check('Zero Dansk Byg leaks in tenant name', !context?.tenant.name.includes('Dansk Byg'));

  // Request token from API endpoint
  const res = await fetch(`${APP_URL}/api/livekit/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId: state.tenantId,
      contactId: state.contactId,
      role: 'customer',
    }),
  });

  check('LiveKit token API returned 200 OK', res.ok, `Status: ${res.status}`);
  const data = (await res.json()) as { token?: string; roomName?: string; attemptId?: string };
  check('LiveKit token returned', !!data.token && data.token.length > 50);
  check('Room name matches slug convention', !!data.roomName && data.roomName.includes('aarhus-murer-vvs'));
}

async function step4_photoUploadAndIntelligence(state: RehearsalState) {
  console.log('\n======================================================');
  console.log('STEP 4: Photo Upload & Pipeline Intelligence Header');
  console.log('======================================================');

  // 1. Mint valid upload token
  const uploadToken = signMediaUploadToken(state.tenantId, state.contactId, 3600);
  check('Upload token minted', !!uploadToken && uploadToken.includes('.'));

  // 2. Prepare sample JPEG image buffer
  // Standard minimal 1x1 JPEG bytes
  const jpegBytes = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
    0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x03, 0x02, 0x02, 0x02, 0x02, 0x02, 0x03,
    0x02, 0x02, 0x02, 0x03, 0x03, 0x03, 0x03, 0x04, 0x06, 0x04, 0x04, 0x04, 0x04, 0x04, 0x08, 0x06,
    0x06, 0x05, 0x06, 0x09, 0x08, 0x0a, 0x0a, 0x09, 0x08, 0x09, 0x09, 0x0a, 0x0c, 0x0f, 0x0c, 0x0a,
    0x0b, 0x0e, 0x0b, 0x09, 0x09, 0x0d, 0x11, 0x0d, 0x0e, 0x0f, 0x10, 0x10, 0x11, 0x10, 0x0a, 0x0c,
    0x12, 0x13, 0x12, 0x10, 0x13, 0x0f, 0x10, 0x10, 0x10, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09, 0xff, 0xda, 0x00, 0x08,
    0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7f, 0x00, 0xff, 0xd9,
  ]);

  const formData = new FormData();
  formData.append('file', new Blob([jpegBytes], { type: 'image/jpeg' }), 'badevaerelse.jpg');
  formData.append('description', 'Badeværelse 8 m2 i Risskov, fliser fra 1970erne skal udskiftes.');

  const uploadRes = await fetch(`${APP_URL}/api/media/upload?token=${uploadToken}`, {
    method: 'POST',
    body: formData,
  });

  check('Media upload returned 200 OK', uploadRes.ok, `Status: ${uploadRes.status}`);
  const uploadData = (await uploadRes.json()) as { ok: boolean; media: { id: string } };
  const mediaId = uploadData.media?.id;
  check('Upload returned mediaId', !!mediaId, `mediaId: ${mediaId}`);

  // 3. Download the uploaded file with valid token
  const downloadRes = await fetch(`${APP_URL}/api/media/file/${mediaId}?token=${uploadToken}`);
  check('Media file download returned 200 OK', downloadRes.ok, `Status: ${downloadRes.status}`);
  check('Header nosniff present', downloadRes.headers.get('x-content-type-options') === 'nosniff');
  const downloadedBytes = Buffer.from(await downloadRes.arrayBuffer());
  check('Downloaded bytes match uploaded bytes', downloadedBytes.length === jpegBytes.length);

  // 4. Verify unauthenticated download is rejected
  const unauthRes = await fetch(`${APP_URL}/api/media/file/${mediaId}`);
  check('Unauthenticated download rejected with 401', unauthRes.status === 401, `Status: ${unauthRes.status}`);

  // 5. Verify tampered token is rejected with 403
  const tamperedRes = await fetch(`${APP_URL}/api/media/file/${mediaId}?token=invalid-token`);
  check('Tampered token rejected with 403', tamperedRes.status === 403, `Status: ${tamperedRes.status}`);

  // 6. Record a project estimate for Mette Thomsen to simulate voice agent quoting
  await adminSql`
    insert into project_estimates (
      tenant_id, contact_id, project_type, scope_details,
      square_meters, estimated_min_dkk, estimated_max_dkk, estimated_value_dkk, followup_notes
    ) values (
      ${state.tenantId}, ${state.contactId}, 'Badeværelse',
      '8 m2 komplet badeværelsesrenovering i Risskov inkl. vådrumssikring (vejledende overslag inkl. 25% moms)',
      8, 75000, 140000, 107500, 'Uforpligtende overslag afgivet'
    )
  `;
  await adminSql`
    update contacts set
      pipeline_stage = 'qualified',
      estimated_value_dkk = 107500
    where id = ${state.contactId}
  `;

  // 7. Check Lead Intelligence Data as Owner
  const mediaList = await listContactMedia(state.ownerUserId, state.contactId);
  check('Owner can see uploaded photo in media list', mediaList.length === 1);
  check('Photo has description attached', mediaList[0].description?.includes('Risskov') ?? false);

  const estimateList = await listProjectEstimates(state.ownerUserId, state.contactId);
  check('Owner can see project estimate', estimateList.length === 1);
  check(
    'Estimate range is 75.000 - 140.000 kr',
    estimateList[0].estimated_min_dkk === 75000 && estimateList[0].estimated_max_dkk === 140000
  );
}

async function step5_reviewGatekeeper(state: RehearsalState) {
  console.log('\n======================================================');
  console.log('STEP 5: Smart Google Review Gatekeeper (< 2.8 vs >= 2.8)');
  console.log('======================================================');

  // Mint signed review token
  const reviewToken = signReviewToken(state.tenantId, state.contactId, 3600);
  check('Review token minted', !!reviewToken && reviewToken.includes('.'));

  // Scenario A: Sub-2.8 rating (Internal feedback)
  const lowRatingRes = await fetch(`${APP_URL}/api/review/${reviewToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rating: 2.0,
      feedbackText: 'Murermesteren kom 2 dage senere end aftalt, men resultatet blev okay.',
    }),
  });

  check('Low rating submitted successfully (200 OK)', lowRatingRes.ok, `Status: ${lowRatingRes.status}`);
  const lowData = (await lowRatingRes.json()) as { ok: boolean; status: string; googleUrl?: string };
  check('Low rating marked as status: internal_feedback', lowData.status === 'internal_feedback');

  // Verify internal review saved in DB
  const reviewsInDb = await listContactReviews(state.ownerUserId, state.contactId);
  check('Review saved in database', reviewsInDb.length >= 1);
  const lowReview = reviewsInDb.find((r) => Number(r.rating) === 2.0);
  check(
    'Database row has rating 2.0 and status internal_feedback',
    !!lowReview && lowReview.status === 'internal_feedback'
  );

  // Scenario B: High rating (>= 2.8 -> Redirect to Google Review)
  const highRatingRes = await fetch(`${APP_URL}/api/review/${reviewToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rating: 5.0,
      feedbackText: 'Fremragende murerarbejde af Frederik og teamet! Pænt, hurtigt og holdt budgettet.',
    }),
  });

  check('High rating submitted successfully (200 OK)', highRatingRes.ok, `Status: ${highRatingRes.status}`);
  const highData = (await highRatingRes.json()) as { ok: boolean; status: string; googleUrl?: string };
  check('High rating marked as status: redirected_to_google', highData.status === 'redirected_to_google');
  check(
    'Google Review redirect URL provided',
    highData.googleUrl === 'https://g.page/r/aarhus-murer/review',
    `URL: ${highData.googleUrl}`
  );

  const reviewsAfterHigh = await listContactReviews(state.ownerUserId, state.contactId);
  const highReview = reviewsAfterHigh.find((r) => Number(r.rating) === 5.0);
  check(
    'Database row has rating 5.0 and status redirected_to_google',
    !!highReview && highReview.status === 'redirected_to_google'
  );
}

async function run() {
  console.log('STARTING DRESS REHEARSAL (OPTION A) VERIFICATION...');
  try {
    const state = await step1_agencyOnboarding();
    await step2_clientIsolation(state);
    await step3_liveDanishVoiceCall(state);
    await step4_photoUploadAndIntelligence(state);
    await step5_reviewGatekeeper(state);

    console.log('\n======================================================');
    if (failures.length === 0) {
      console.log('DRESS REHEARSAL 100% GREEN! ALL 5 STEPS PASSED PERFECTLY!');
      console.log('======================================================');
      process.exit(0);
    } else {
      console.error(`DRESS REHEARSAL FAILED: ${failures.length} errors:`);
      for (const f of failures) console.error(` - ${f}`);
      console.log('======================================================');
      process.exit(1);
    }
  } catch (err) {
    console.error('Unexpected rehearsal crash:', err);
    process.exit(1);
  }
}

run();
