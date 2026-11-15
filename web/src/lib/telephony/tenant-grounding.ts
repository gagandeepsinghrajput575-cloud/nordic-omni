import 'server-only';

import { adminSql, withPublicContact, withUser, type Tx } from '@/lib/db/client';
import { clampBudget } from './types';
import {
  languageOf,
  normalizeE164,
  normaliseKnowledge,
  readHoursJson,
  readPricingJson,
  type KnowledgeRowShape,
  type TenantGrounding,
  type TenantHoursDay,
  type TenantPricingEntry,
  type TenantSoundTuning,
} from './grounding';

/**
 * The only place the telephony bridge touches Postgres.
 *
 * **Two connections, one rule.** `adminSql` bypasses RLS, so it is used for exactly
 * two things here and nothing else: resolving a dialled DID to a tenant (a SIP
 * webhook has no session to scope by), and finding that tenant's own owner id so
 * every *real* read can be made as that user. Tenant record, agent config,
 * knowledge and provider bindings are read through `withUser()` /
 * `withPublicContact()`, which means RLS decides visibility even if this file
 * grows a careless query later — `web/test/rls-contract.test.ts` counts the
 * `adminSql` uses here for exactly that reason.
 *
 * **Fail closed.** A tenant whose owner cannot be resolved yields no grounding and
 * therefore no AI answer; the bridge forwards the call to the operator's number.
 * "Just this one read over the owner pool" is the one way to make a cross-tenant
 * leak possible, so it is not offered.
 */

export interface InboundTenantRecord {
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly status: string;
  readonly receptionMode: string;
  readonly flynumberDid: string | null;
  readonly actingUserId: string | null;
}

/**
 * The same expression as the functional unique index in
 * `db/migrations/0008_sip_inbound_routing.sql`, spelled identically so the index is
 * actually used. A DID lookup that degrades to a sequential scan inside a live SIP
 * INVITE is a dispatch that times out and a call nobody answers.
 */
const DID_NORMALISATION = `
  CASE
    WHEN regexp_replace(t.flynumber_did, '[^0-9]', '', 'g') LIKE '00%'
      THEN '+' || substr(regexp_replace(t.flynumber_did, '[^0-9]', '', 'g'), 3)
    ELSE '+' || regexp_replace(t.flynumber_did, '[^0-9]', '', 'g')
  END`;

export async function resolveInboundTenantByDid(
  dialed: string | null | undefined,
): Promise<InboundTenantRecord | null> {
  const normalized = normalizeE164(dialed);
  if (!normalized) return null;

  const rows = await adminSql.unsafe<{
    tenant_id: string;
    slug: string;
    name: string;
    status: string;
    reception_mode: string;
    flynumber_did: string | null;
    acting_user_id: string | null;
  }[]>(
    `
    select t.id as tenant_id, t.slug, t.name, t.status::text as status,
           t.reception_mode, t.flynumber_did,
           (select u.id
              from public.tenant_members tm
              join public.users u on u.id = tm.user_id
             where tm.tenant_id = t.id and tm.role = 'owner' and u.is_active
             order by tm.created_at asc
             limit 1) as acting_user_id` + DID_MATCH_SQL,
    [normalized],
  );

  const row = rows[0];
  if (!row) return null;
  return {
    tenantId: row.tenant_id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    receptionMode: row.reception_mode,
    flynumberDid: row.flynumber_did,
    actingUserId: row.acting_user_id,
  };
}

/**
 * Find the tenant's own owner, so a browser call started from an agency session
 * can still be grounded under that tenant's RLS scope. Returns null rather than
 * widening scope when there is no active owner.
 */
export async function actingUserForTenant(tenantId: string): Promise<string | null> {
  const rows = await adminSql<{ acting_user_id: string | null }[]>`
    select (
      select u.id
        from public.tenant_members tm
        join public.users u on u.id = tm.user_id
       where tm.tenant_id = ${tenantId}::uuid and tm.role = 'owner' and u.is_active
       order by tm.created_at asc
       limit 1
    ) as acting_user_id
  `;
  return rows[0]?.acting_user_id ?? null;
}

export type GroundingActor =
  | { readonly kind: 'user'; readonly userId: string }
  | { readonly kind: 'publicContact'; readonly contactId: string };

export interface TenantRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly reception_mode: string;
  readonly default_language: string;
  readonly owner_phone: string;
  readonly owner_email: string | null;
  readonly active_broadcast_message: string | null;
  readonly business_hours: unknown;
  readonly pricing_catalog: unknown;
}

export interface AgentConfigRow {
  readonly customer_system_prompt: string | null;
  readonly greeting_script: string | null;
  readonly voice_id: string | null;
  readonly stt_language: string | null;
  readonly escalation_policy: unknown;
}

export interface KnowledgeRowLike {
  readonly id: string;
  readonly category: string;
  readonly title: string;
  readonly content: string;
  readonly priority: number;
  readonly is_active: boolean;
  readonly source_label: string | null;
}

/**
 * The dynamic half of the DID match, as a constant string rather than a template
 * the caller can influence. `unsafe` is used because the predicate must be spelled
 * exactly like the functional index; the *value* is still a bound parameter.
 */
const DID_MATCH_SQL = `
      from public.tenants t
     where t.flynumber_did is not null
       and ${DID_NORMALISATION} = $1
     limit 1`;

export interface BindingRow {
  readonly elevenlabs_agent_id: string | null;
  readonly elevenlabs_agent_id_en: string | null;
  readonly elevenlabs_voice_id: string | null;
  readonly audio_format_expectation: string | null;
  readonly vad_threshold: number | null;
  readonly barge_in_sensitivity: number | null;
  readonly barge_in_budget_ms: number | null;
  readonly echo_tail_ms: number | null;
  readonly speech_rate: number | null;
  readonly calcom_event_type_id: string | null;
  readonly calcom_event_slug: string | null;
  readonly calcom_slot_minutes: number | null;
  readonly forward_to_phone: string | null;
  readonly timezone: string | null;
}

/**
 * Rows → `TenantGrounding`, in one transaction.
 *
 * Four reads, one snapshot: a call must not be grounded on a tenant record from
 * before an edit and a knowledge list from after it. The provider's whole
 * initiation frame is built from this object, so a torn read would be spoken out
 * loud to a paying customer.
 */
async function readGrounding(tx: Tx, tenantId: string): Promise<TenantGrounding | null> {
  const tenantRows = await tx<TenantRow[]>`
    select t.id, t.name, t.slug, t.status::text as status, t.reception_mode,
           t.default_language::text as default_language, t.owner_phone, t.owner_email,
           t.active_broadcast_message, t.business_hours, t.pricing_catalog
      from public.tenants t
     where t.id = ${tenantId}::uuid
     limit 1
  `;
  const tenant = tenantRows[0];
  if (!tenant) return null;

  const configRows = await tx<AgentConfigRow[]>`
    select customer_system_prompt, greeting_script, voice_id, stt_language, escalation_policy
      from public.tenant_agent_config
     where tenant_id = ${tenantId}::uuid
     limit 1
  `;

  const knowledgeRows = await tx<KnowledgeRowLike[]>`
    select id, category, title, content, priority, is_active, source_label
      from public.knowledge_items
     where tenant_id = ${tenantId}::uuid
       and is_active
     order by priority desc, title asc
     limit 60
  `;

  const bindingRows = await tx<BindingRow[]>`
    select elevenlabs_agent_id, elevenlabs_agent_id_en, elevenlabs_voice_id,
           audio_format_expectation, vad_threshold, barge_in_sensitivity,
           barge_in_budget_ms, echo_tail_ms, speech_rate,
           calcom_event_type_id, calcom_event_slug, calcom_slot_minutes,
           forward_to_phone, timezone
      from public.tenant_telephony_bindings
     where tenant_id = ${tenantId}::uuid
     limit 1
  `;

  return mapGrounding(tenant, configRows[0] ?? null, knowledgeRows, bindingRows[0] ?? null);
}

/**
 * The interpretation step, exported so a test can disagree with it without owning
 * a database.
 *
 * Two deliberate behaviours: `tenant_agent_config.greeting_script` wins over the
 * generated default (the first sentence a caller hears is brand copy, and the
 * operator owns it), and the acoustic tuning is snapshotted per call rather than
 * re-read per turn — a mid-call settings change must not alter how the caller in
 * progress is heard.
 */
export function mapGrounding(
  tenant: TenantRow,
  config: AgentConfigRow | null,
  knowledgeRows: readonly KnowledgeRowShape[],
  binding: BindingRow | null,
): TenantGrounding {
  const policy = asRecord(config?.escalation_policy);
  const language = languageOf({ default_language: tenant.default_language });
  const greeting = readString(config?.greeting_script);
  const hours: Record<string, TenantHoursDay> = { ...readHoursJson(tenant.business_hours) };
  const pricing: readonly TenantPricingEntry[] = readPricingJson(tenant.pricing_catalog);
  const timezone = readString(binding?.timezone, 'Europe/Copenhagen');

  const sound: TenantSoundTuning = {
    vadThreshold: clampNumber(numberOr(binding?.vad_threshold, numberOr(policy.vadThreshold, 65)), 10, 90),
    bargeInSensitivity: clampNumber(
      numberOr(binding?.barge_in_sensitivity, numberOr(policy.bargeInSensitivity, 85)),
      0,
      100,
    ),
    speechRate: clampNumber(numberOr(binding?.speech_rate, numberOr(policy.speechRate, 1)), 0.9, 1.1),
    echoTailMs: clampNumber(numberOr(binding?.echo_tail_ms, numberOr(policy.echoTailMs, 90)), 0, 400),
  };

  return {
    tenantId: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status === 'paused' || tenant.status === 'archived' ? tenant.status : 'active',
    receptionMode:
      tenant.reception_mode === 'human_forward'
        ? 'human_forward'
        : tenant.reception_mode === 'after_hours'
          ? 'after_hours'
          : 'voice_ai',
    language,
    agentName: readString(policy.agentName, 'Freja'),
    industry: readString(policy.industry, 'Byggeri & Håndværk'),
    city: readString(policy.city, 'København'),
    timezone,
    greetingDa: greeting || DEFAULT_GREETING.da,
    greetingEn: readString(policy.greetingEn) || DEFAULT_GREETING.en,
    escalationPhone: readString(policy.escalationPhone, tenant.owner_phone),
    contactEmail: tenant.owner_email,
    broadcastMessage: tenant.active_broadcast_message,
    hours,
    pricing,
    knowledge: normaliseKnowledge(knowledgeRows),
    customerSystemPrompt: config?.customer_system_prompt ?? null,
    sound,
    voice: {
      elevenLabsAgentId: readString(binding?.elevenlabs_agent_id) || null,
      elevenLabsAgentIdEn: readString(binding?.elevenlabs_agent_id_en) || null,
      voiceId: readString(binding?.elevenlabs_voice_id) || readString(config?.voice_id) || null,
      modelLabel: readString(binding?.audio_format_expectation, 'pcm_16000'),
    },
    calendar: {
      eventTypeId: readString(binding?.calcom_event_type_id) || null,
      eventSlug: readString(binding?.calcom_event_slug) || null,
      timeZone: timezone,
      slotMinutes: clampNumber(numberOr(binding?.calcom_slot_minutes, 30), 10, 240),
    },
    forwardToPhone: readString(binding?.forward_to_phone) || null,
    audioFormatExpectation: readString(binding?.audio_format_expectation, 'pcm_16000'),
    bargeInBudgetMs: clampBudget(numberOr(binding?.barge_in_budget_ms, BARGE_IN_BUDGET_MS)),
    groundedAtIso: new Date().toISOString(),
  };
}

const BARGE_IN_BUDGET_MS = 150;

const DEFAULT_GREETING: Readonly<Record<'da' | 'en', string>> = {
  da: 'Goddag, du taler med {agent} hos {tenant}. Hvad kan jeg hjælpe dig med?',
  en: 'Hello, you have reached {tenant}. How can I help you today?',
};

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

// -----------------------------------------------------------------------------
// Public entry points
// -----------------------------------------------------------------------------

/** Ground a call for a signed-in actor (agency staff or the tenant's owner). */
export async function loadTenantGrounding(
  actor: GroundingActor,
  tenantId: string,
): Promise<TenantGrounding | null> {
  if (actor.kind === 'user') {
    return withUser(actor.userId, (tx) => readGrounding(tx, tenantId));
  }
  return withPublicContact(actor.contactId, async (tx) => {
    // The capability, not the request, decides which tenant may be read: a public
    // call link is scoped to exactly one contact, and therefore one tenant.
    const scoped = await tx<{ tenant_id: string }[]>`
      select tenant_id from public.contacts where id = ${actor.contactId}::uuid limit 1
    `;
    const ownedTenantId = scoped[0]?.tenant_id;
    if (!ownedTenantId || ownedTenantId !== tenantId) return null;
    return readGrounding(tx, ownedTenantId);
  });
}

/**
 * Ground a PSTN call from the dialled DID, as the tenant's own owner. `null` means
 * "unknown DID, or no active owner": the caller is forwarded, never answered by a
 * guess.
 */
export async function loadGroundingForDialledNumber(
  dialed: string,
): Promise<{ readonly grounding: TenantGrounding; readonly inbound: InboundTenantRecord } | null> {
  const inbound = await resolveInboundTenantByDid(dialed);
  if (!inbound || !inbound.actingUserId) return null;
  const grounding = await withUser(inbound.actingUserId, (tx) => readGrounding(tx, inbound.tenantId));
  if (!grounding) return null;
  return { grounding, inbound };
}

// -----------------------------------------------------------------------------
// Call ledger
// -----------------------------------------------------------------------------

export interface LedgerSnapshot {
  readonly callId: string;
  readonly tenantId: string;
  readonly roomName: string;
  readonly dispatchRuleId: string | null;
  readonly callerNumber: string | null;
  readonly dialedNumber: string | null;
  readonly contactId: string | null;
  readonly language: 'da-DK' | 'en-GB';
  readonly status: 'connecting' | 'active' | 'transferring' | 'completed' | 'failed';
  readonly latencyMs: number;
  readonly transcript: readonly {
    readonly role: 'agent' | 'caller';
    readonly text: string;
    readonly timestampMs: number;
  }[];
  readonly bargeIn: {
    readonly commits: number;
    readonly overBudget: number;
    readonly worstMs: number;
    readonly budgetMs: number;
  };
  readonly telemetry: Record<string, string | number | boolean | null>;
  readonly provider: 'elevenlabs' | 'azure' | 'browser_fallback';
  readonly startedAtIso: string;
  readonly endedAtIso: string | null;
}

/**
 * Persist the call's current state.
 *
 * Upsert on `call_id`, and the transcript is *replaced* rather than appended: the
 * bridge owns the window (bounded, deduplicated, monotonic), and two places
 * appending the same turn is how a replayed webhook grows duplicate lines. A
 * rejected write (RLS found no policy for this actor on this tenant) returns
 * `false` instead of throwing, so a dispatch that cannot be recorded still answers
 * the caller.
 */
export async function upsertTelephonyCallSession(
  actor: GroundingActor,
  snapshot: LedgerSnapshot,
): Promise<boolean> {
  const transcriptJson = JSON.stringify(snapshot.transcript);
  const telemetryJson = JSON.stringify({
    ...snapshot.telemetry,
    bargeInBudgetMs: snapshot.bargeIn.budgetMs,
  });

  const write = async (tx: Tx): Promise<boolean> => {
    const rows = await tx<{ call_id: string }[]>`
      insert into public.telephony_call_sessions (
        call_id, tenant_id, contact_id, room_name, dispatch_rule_id,
        caller_number, dialed_number, language, status, latency_ms,
        barge_in_count, barge_in_over_budget, barge_in_worst_ms, turn_count,
        transcript, telemetry, provider, started_at, ended_at
      ) values (
        ${snapshot.callId}, ${snapshot.tenantId}::uuid, ${snapshot.contactId}::uuid,
        ${snapshot.roomName}, ${snapshot.dispatchRuleId},
        ${snapshot.callerNumber}, ${snapshot.dialedNumber}, ${snapshot.language},
        ${snapshot.status}, ${Math.max(0, Math.round(snapshot.latencyMs))},
        ${Math.max(0, Math.round(snapshot.bargeIn.commits))},
        ${Math.max(0, Math.round(snapshot.bargeIn.overBudget))},
        ${Math.max(0, Math.round(snapshot.bargeIn.worstMs))},
        ${snapshot.transcript.length},
        ${transcriptJson}::jsonb, ${telemetryJson}::jsonb, ${snapshot.provider},
        ${snapshot.startedAtIso}::timestamptz, ${snapshot.endedAtIso}::timestamptz
      )
      on conflict (call_id) do update
         set status = excluded.status,
             latency_ms = excluded.latency_ms,
             barge_in_count = excluded.barge_in_count,
             barge_in_over_budget = excluded.barge_in_over_budget,
             barge_in_worst_ms = excluded.barge_in_worst_ms,
             turn_count = excluded.turn_count,
             transcript = excluded.transcript,
             telemetry = excluded.telemetry,
             contact_id = coalesce(excluded.contact_id, telephony_call_sessions.contact_id),
             ended_at = coalesce(excluded.ended_at, telephony_call_sessions.ended_at)
      returning call_id
    `;
    return rows.length > 0;
  };

  if (actor.kind === 'user') return withUser(actor.userId, write);
  return withPublicContact(actor.contactId, write);
}

export interface LedgerRow {
  readonly callId: string;
  readonly tenantId: string;
  readonly status: string;
  readonly language: string;
  readonly latencyMs: number;
  readonly bargeInCount: number;
  readonly bargeInOverBudget: number;
  readonly bargeInWorstMs: number;
  readonly turnCount: number;
  readonly startedAtIso: string;
  readonly endedAtIso: string | null;
}

/** Read one call back: the operator's "what actually happened" view, RLS-scoped. */
export async function loadTelephonyCallSession(
  actor: GroundingActor,
  callId: string,
): Promise<LedgerRow | null> {
  const read = async (tx: Tx): Promise<LedgerRow | null> => {
    const rows = await tx<{
      call_id: string;
      tenant_id: string;
      status: string;
      language: string;
      latency_ms: number;
      barge_in_count: number;
      barge_in_over_budget: number;
      barge_in_worst_ms: number;
      turn_count: number;
      started_at: string;
      ended_at: string | null;
    }[]>`
      select call_id, tenant_id, status, language, latency_ms, barge_in_count,
             barge_in_over_budget, barge_in_worst_ms, turn_count, started_at, ended_at
        from public.telephony_call_sessions
       where call_id = ${callId}
       limit 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      callId: row.call_id,
      tenantId: row.tenant_id,
      status: row.status,
      language: row.language,
      latencyMs: Number(row.latency_ms),
      bargeInCount: Number(row.barge_in_count),
      bargeInOverBudget: Number(row.barge_in_over_budget),
      bargeInWorstMs: Number(row.barge_in_worst_ms),
      turnCount: Number(row.turn_count),
      startedAtIso: new Date(row.started_at).toISOString(),
      endedAtIso: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    };
  };

  if (actor.kind === 'user') return withUser(actor.userId, read);
  return withPublicContact(actor.contactId, read);
}

/**
 * Live-call occupancy for the concurrency ceiling.
 *
 * RLS does the scoping; the `status IN (...)` predicate is what makes a stale row
 * stop counting the moment the bridge marks it terminal, so no sweeper job is
 * required to keep the ceiling honest.
 */
export async function countOpenCalls(actor: GroundingActor, tenantId: string): Promise<number> {
  const read = async (tx: Tx): Promise<number> => {
    const rows = await tx<{ open_calls: number }[]>`
      select count(*)::int as open_calls
        from public.telephony_call_sessions
       where tenant_id = ${tenantId}::uuid
         and status in ('connecting', 'active', 'transferring')
    `;
    return Number(rows[0]?.open_calls ?? 0);
  };
  if (actor.kind === 'user') return withUser(actor.userId, read);
  return withPublicContact(actor.contactId, read);
}
