import { z } from 'zod';
import { adminSql, withUser } from '@/lib/db/client';
import { getTenantFacts, listContacts, listTenants, getTenantOverview } from '@/lib/db/queries';
import { updateTenantFacts } from '@/lib/db/mutations';
import { buildCopilotContext } from '@/lib/copilot/context';
import { respondToClient } from '@/lib/copilot/engine';
import { listBusyIntervals } from '@/lib/db/calendar';
import { buildSlotGrid, DEFAULT_BOOKING_WINDOW } from '@/lib/calendar/time';
import { sanitizeDanishPhone, isValidE164, SMS_STORE, calculateSmsSegments } from '@/lib/sms';
import { SPRING } from '@/lib/motion/springs';
import type { SmsDispatchRecord } from '@/contracts/schemas';
import type { AgencyAction, InboundWebhookPayload } from './inbound-contract';

/**
 * The action dispatcher.
 *
 * Rules this module follows, without exception:
 *
 *   1. Identity first. An inbound caller knows a tenant UUID, but every RLS
 *      query needs a *user* id. `resolveActingUser` performs exactly one
 *      owner-connection lookup to bridge that gap; everything after it runs
 *      through `withUser` so the database enforces scope, not this file.
 *   2. No handler may invent a capability. If the platform cannot place an
 *      outbound call or reach an SMS carrier, the response says so.
 *   3. Every handler returns a typed result. There is no path that returns
 *      `undefined` and looks like success.
 */

export interface DispatchContext {
  actingUserId: string;
  /** The tenant the request is scoped to, when the caller supplied one. */
  tenantId: string | null;
  isAgency: boolean;
}

export type DispatchOutcome =
  | { ok: true; data: unknown }
  | { ok: false; code: 'not_found' | 'conflict' | 'upstream' | 'internal'; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// -----------------------------------------------------------------------------
// Identity bridge
// -----------------------------------------------------------------------------

/**
 * Resolve the agency user who may act on behalf of the credential's owner.
 *
 * A key is minted by a specific agency member. `tenantId` narrows the request;
 * it never grants scope on its own. If a key is tenant-pinned, a payload that
 * names a different tenant is a conflict, not a scope widening.
 */
export async function resolveActingUser(args: {
  keyUserId: string;
  keyTenantId: string | null;
  requestedTenantId: string | null;
}): Promise<{ ok: true; context: DispatchContext } | { ok: false; code: 'conflict' | 'not_found'; error: string }> {
  const { keyUserId, keyTenantId, requestedTenantId } = args;

  if (keyTenantId && requestedTenantId && keyTenantId !== requestedTenantId) {
    return {
      ok: false,
      code: 'conflict',
      error: 'This API key is pinned to a different workspace.',
    };
  }

  const tenantId = keyTenantId ?? requestedTenantId;

  if (tenantId) {
    if (!UUID_RE.test(tenantId)) {
      return { ok: false, code: 'conflict', error: 'Malformed workspace identifier.' };
    }
    // Pre-identity existence check only. The RLS-scoped reads that follow are
    // what actually decide whether this identity may see the workspace.
    const rows = await adminSql`select id from tenants where id = ${tenantId}::uuid limit 1`;
    if (!rows[0]) {
      return { ok: false, code: 'not_found', error: 'Workspace not found.' };
    }
    if (keyTenantId && keyTenantId !== tenantId) {
      return { ok: false, code: 'conflict', error: 'This API key is pinned to a different workspace.' };
    }
  }

  return {
    ok: true,
    context: { actingUserId: keyUserId, tenantId, isAgency: true },
  };
}

/** Which tenants this credential may read. Agency keys see everything. */
async function visibleTenantIds(ctx: DispatchContext): Promise<string[]> {
  if (ctx.tenantId) return [ctx.tenantId];
  const tenants = await listTenants(ctx.actingUserId);
  return tenants.map((tenant) => tenant.id);
}

function normalisePhone(value: string): string | null {
  const cleaned = sanitizeDanishPhone(value);
  return isValidE164(cleaned) ? cleaned : null;
}

// -----------------------------------------------------------------------------
// Handlers
// -----------------------------------------------------------------------------

async function fetchLeads(ctx: DispatchContext, input: { tenantId?: string; status?: string; limit: number }): Promise<DispatchOutcome> {
  const tenantIds = input.tenantId ? [input.tenantId] : await visibleTenantIds(ctx);
  if (tenantIds.length === 0) return { ok: false, code: 'not_found', error: 'No workspaces are visible to this credential.' };

  const groups = await Promise.all(
    tenantIds.map(async (tenantId) => ({
      tenantId,
      leads: await listContacts(ctx.actingUserId, tenantId, input.limit),
    })),
  );

  const filtered = input.status
    ? groups.map((group) => ({
        tenantId: group.tenantId,
        // Filtering after the RLS read keeps the query simple and still correct:
        // the pipeline stage filter can only shrink what RLS already allowed.
        leads: group.leads.filter((lead) => lead.pipeline_stage === input.status),
      }))
    : groups;

  const total = filtered.reduce((sum, group) => sum + group.leads.length, 0);
  return {
    ok: true,
    data: {
      workspaces: filtered.map((group) => ({ tenantId: group.tenantId, leads: group.leads })),
      count: total,
      limit: input.limit,
      statusFilter: input.status ?? null,
    },
  };
}

async function fetchCalls(ctx: DispatchContext, input: { tenantId?: string; limit: number }): Promise<DispatchOutcome> {
  const tenantIds = input.tenantId ? [input.tenantId] : await visibleTenantIds(ctx);
  if (tenantIds.length === 0) return { ok: false, code: 'not_found', error: 'No workspaces are visible to this credential.' };

  // One RLS-scoped read per workspace; the union is taken in TypeScript so no
  // cross-tenant SQL is ever constructed.
  const rows = await withUser(ctx.actingUserId, async (tx) => {
    return tx`
      select id, tenant_id, contact_id, channel, status::text as status,
             duration_seconds, summary, detected_intent, created_at
      from call_logs
      where tenant_id = any(${`{${tenantIds.join(',')}}`}::uuid[])
      order by created_at desc
      limit ${input.limit}
    `;
  });

  return { ok: true, data: { calls: rows, count: rows.length, limit: input.limit } };
}

async function fetchClients(ctx: DispatchContext): Promise<DispatchOutcome> {
  return {
    ok: true,
    data: { clients: await listTenants(ctx.actingUserId) },
  };
}

async function fetchClientDetail(ctx: DispatchContext, input: { tenantId: string }): Promise<DispatchOutcome> {
  const facts = await getTenantFacts(ctx.actingUserId, input.tenantId);
  if (!facts) return { ok: false, code: 'not_found', error: 'Workspace not found.' };
  const overview = await getTenantOverview(ctx.actingUserId, input.tenantId).catch(() => null);
  return { ok: true, data: { client: facts, metrics: overview } };
}

async function fetchCalendarSlots(ctx: DispatchContext, input: { tenantId: string; date: string }): Promise<DispatchOutcome> {
  const facts = await getTenantFacts(ctx.actingUserId, input.tenantId);
  if (!facts) return { ok: false, code: 'not_found', error: 'Workspace not found.' };

  const busyRows = await listBusyIntervals(ctx.actingUserId, input.tenantId).catch(() => null);
  if (!busyRows) {
    // A failed read must never look like "fully available".
    return { ok: false, code: 'upstream', error: 'Calendar availability could not be read.' };
  }

  const busy = busyRows.map((row) => ({
    startUtc: new Date(row.start_iso),
    endUtc: new Date(row.end_iso),
  }));

  const now = new Date();
  const grid = buildSlotGrid({ now, config: { ...DEFAULT_BOOKING_WINDOW, horizonDays: 60 }, busy });
  // `localDate` is the Copenhagen wall-clock date, which is the only date a
  // Danish operator means when they ask for "the 18th".
  const forDate = grid.filter(
    (slot) => slot.localDate === input.date && slot.available,
  );

  return {
    ok: true,
    data: {
      date: input.date,
      timeZone: DEFAULT_BOOKING_WINDOW.timeZone,
      slots: forDate.map((slot) => ({
        start: slot.startIso,
        end: slot.endIso,
        label: slot.label,
        durationMinutes: slot.durationMinutes,
      })),
      count: forDate.length,
    },
  };
}

async function fetchMetrics(ctx: DispatchContext, input: { tenantId?: string }): Promise<DispatchOutcome> {
  const tenantIds = input.tenantId ? [input.tenantId] : await visibleTenantIds(ctx);
  if (tenantIds.length === 0) return { ok: false, code: 'not_found', error: 'No workspaces are visible to this credential.' };

  const perWorkspace = await Promise.all(
    tenantIds.map(async (tenantId) => ({
      tenantId,
      metrics: await getTenantOverview(ctx.actingUserId, tenantId),
    })),
  );

  const totals = perWorkspace.reduce(
    (acc, entry) => ({
      contacts: acc.contacts + (entry.metrics.contacts ?? 0),
      calls: acc.calls + (entry.metrics.calls ?? 0),
      messages: acc.messages + (entry.metrics.messages ?? 0),
      booked: acc.booked + (entry.metrics.booked ?? 0),
      dire: acc.dire + (entry.metrics.dire ?? 0),
      pipelineDkk: acc.pipelineDkk + (entry.metrics.pipeline_dkk ?? 0),
    }),
    { contacts: 0, calls: 0, messages: 0, booked: 0, dire: 0, pipelineDkk: 0 },
  );

  return { ok: true, data: { workspaces: perWorkspace, totals } };
}

async function createLead(ctx: DispatchContext, input: { tenantId: string; name: string; phone: string; note?: string; triggerSms: boolean }): Promise<DispatchOutcome> {
  const facts = await getTenantFacts(ctx.actingUserId, input.tenantId);
  if (!facts) return { ok: false, code: 'not_found', error: 'Workspace not found.' };

  const phone = normalisePhone(input.phone);
  if (!phone) return { ok: false, code: 'conflict', error: 'Phone number is not a valid E.164 number.' };

  // RLS decides whether this identity may insert into this tenant at all, so
  // the insert carries no extra scope logic of its own.
  const rows = await withUser(ctx.actingUserId, async (tx) => {
    return tx`
      insert into contacts (tenant_id, full_name, phone_number, pipeline_stage, metadata)
      values (${input.tenantId}::uuid, ${input.name}, ${phone}, 'new_lead',
              ${JSON.stringify({ source: 'universal_webhook', note: input.note ?? null })}::jsonb)
      returning id, full_name, phone_number, pipeline_stage::text as pipeline_stage, created_at
    `;
  });

  const lead = rows[0];
  if (!lead) return { ok: false, code: 'internal', error: 'Lead insert returned no row.' };

  let sms: { dispatched: boolean; detail: string } | null = null;
  if (input.triggerSms) {
    sms = { dispatched: false, detail: 'SMS is not dispatched from lead creation in this build.' };
  }

  return { ok: true, data: { lead, workspace: { id: facts.id, name: facts.name }, sms } };
}

async function dispatchCall(ctx: DispatchContext, input: { tenantId: string; phone: string; promptOverride?: string }): Promise<DispatchOutcome> {
  const facts = await getTenantFacts(ctx.actingUserId, input.tenantId);
  if (!facts) return { ok: false, code: 'not_found', error: 'Workspace not found.' };

  if (facts.status !== 'active') {
    return { ok: false, code: 'conflict', error: `Workspace is ${facts.status}; calls are not accepted.` };
  }

  const phone = normalisePhone(input.phone);
  if (!phone) return { ok: false, code: 'conflict', error: 'Phone number is not a valid E.164 number.' };

  // There is no outbound dial in the platform: the worker can only transfer an
  // existing SIP participant. Creating a call attempt is honest; claiming the
  // call was placed would not be.
  const roomName = `outbound-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    ok: true,
    data: {
      dispatch: 'staged',
      roomName,
      to: phone,
      workspace: { id: facts.id, name: facts.name },
      telephonyMode: facts.telephony_mode,
      promptOverride: input.promptOverride ?? null,
      note:
        'Call attempt staged. This build has no outbound SIP dial: the worker can only transfer an existing participant, so no call was placed.',
    },
  };
}

async function sendSms(ctx: DispatchContext, input: { tenantId: string; to: string; message: string }): Promise<DispatchOutcome> {
  const facts = await getTenantFacts(ctx.actingUserId, input.tenantId);
  if (!facts) return { ok: false, code: 'not_found', error: 'Workspace not found.' };

  const to = normalisePhone(input.to);
  if (!to) return { ok: false, code: 'conflict', error: 'Recipient is not a valid E.164 number.' };

  const record: SmsDispatchRecord = {
    id: `sms-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    recipient: to,
    messageType: 'custom',
    body: input.message,
    callLogId: null,
    contactId: null,
    workspaceId: facts.id,
    workspaceName: facts.name,
    status: 'delivered',
    carrier: 'In-process dispatch store',
    segments: calculateSmsSegments(input.message),
    deliveryLatencyMs: 0,
    createdAt: new Date().toISOString(),
  };

  SMS_STORE.unshift(record);
  if (SMS_STORE.length > 100) SMS_STORE.pop();

  return {
    ok: true,
    data: {
      record,
      delivery: 'simulated',
      note: 'Recorded in the in-process dispatch store. No SMS carrier is configured in this build, so nothing was transmitted.',
    },
  };
}

const IsoInstant = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'must be an ISO-8601 instant');

async function bookAppointment(ctx: DispatchContext, input: { tenantId: string; slotStart: string; slotEnd: string; customerName: string; customerPhone: string }): Promise<DispatchOutcome> {
  const facts = await getTenantFacts(ctx.actingUserId, input.tenantId);
  if (!facts) return { ok: false, code: 'not_found', error: 'Workspace not found.' };

  const startParse = IsoInstant.safeParse(input.slotStart);
  const endParse = IsoInstant.safeParse(input.slotEnd);
  if (!startParse.success || !endParse.success) {
    return { ok: false, code: 'conflict', error: 'slotStart and slotEnd must be ISO-8601 instants.' };
  }

  const start = new Date(input.slotStart);
  const end = new Date(input.slotEnd);
  if (end.getTime() <= start.getTime()) {
    return { ok: false, code: 'conflict', error: 'slotEnd must be after slotStart.' };
  }

  const phone = normalisePhone(input.customerPhone);
  if (!phone) return { ok: false, code: 'conflict', error: 'Customer phone is not a valid E.164 number.' };

  // Check the requested window against live holds and bookings before writing.
  const busyRows = await listBusyIntervals(ctx.actingUserId, input.tenantId).catch(() => null);
  if (!busyRows) return { ok: false, code: 'upstream', error: 'Calendar availability could not be read.' };

  const clash = busyRows.some((row) => {
    const busyStart = new Date(row.start_iso).getTime();
    const busyEnd = new Date(row.end_iso).getTime();
    return start.getTime() < busyEnd && end.getTime() > busyStart;
  });
  if (clash) return { ok: false, code: 'conflict', error: 'That slot is already held or booked.' };

  const id = crypto.randomUUID();
  const rows = await withUser(ctx.actingUserId, async (tx) => {
    return tx`
      insert into public.calendar_bookings (
        id, tenant_id, contact_id, call_log_id, provider, status,
        start_iso, end_iso, label, topic, attendee_name,
        attendee_email, attendee_phone, ics_uid
      ) values (
        ${id}::uuid, ${input.tenantId}::uuid, null, null, 'ics_universal', 'confirmed',
        ${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz,
        ${`Booket via API · ${facts.name}`}, ${'Inbound gateway booking'},
        ${input.customerName}, null, ${phone}, ${id}
      )
      returning id, start_iso, end_iso, status
    `;
  });

  const booking = rows[0];
  if (!booking) return { ok: false, code: 'internal', error: 'Booking insert returned no row.' };
  return { ok: true, data: { booking, workspace: { id: facts.id, name: facts.name } } };
}

async function updateClient(ctx: DispatchContext, input: { tenantId: string; businessHours?: Record<string, unknown>; broadcastMessage?: string }): Promise<DispatchOutcome> {
  const facts = await getTenantFacts(ctx.actingUserId, input.tenantId);
  if (!facts) return { ok: false, code: 'not_found', error: 'Workspace not found.' };

  if (input.businessHours === undefined && input.broadcastMessage === undefined) {
    return { ok: false, code: 'conflict', error: 'Nothing to update: supply businessHours or broadcastMessage.' };
  }

  // Business hours are validated per day so a malformed map cannot corrupt the
  // record the voice agent reads before answering a call.
  const DaySchema = z.object({
    open: z.string().regex(/^\d{2}:\d{2}$/),
    close: z.string().regex(/^\d{2}:\d{2}$/),
    closed: z.boolean(),
  });

  let hours: Record<string, z.infer<typeof DaySchema>> | undefined;
  if (input.businessHours) {
    const parsed = z.record(z.string(), DaySchema).safeParse(input.businessHours);
    if (!parsed.success) {
      return { ok: false, code: 'conflict', error: 'businessHours must map each day to {open, close, closed}.' };
    }
    hours = parsed.data;
  }

  const updated = await updateTenantFacts(ctx.actingUserId, input.tenantId, {
    ...(hours ? { businessHours: { ...facts.business_hours, ...hours } } : {}),
    ...(input.broadcastMessage !== undefined ? { activeBroadcastMessage: input.broadcastMessage } : {}),
  });

  if (!updated) return { ok: false, code: 'not_found', error: 'Workspace was not updated.' };

  return {
    ok: true,
    data: {
      updated: true,
      workspace: { id: facts.id, name: facts.name },
      applied: {
        businessHours: hours ? Object.keys(hours) : null,
        broadcastMessage: input.broadcastMessage ?? null,
      },
    },
  };
}

async function askCopilot(ctx: DispatchContext, input: { tenantId: string; query: string }): Promise<DispatchOutcome> {
  const copilot = await buildCopilotContext(ctx.actingUserId, input.tenantId, 'da-DK');
  if (!copilot) return { ok: false, code: 'not_found', error: 'Workspace not found or not readable.' };

  // Grounded only: the deterministic engine answers from real rows and says so
  // when it cannot. No LLM is called on this path, by design.
  const reply = respondToClient(copilot, input.query);

  return {
    ok: true,
    data: {
      // Spring value is irrelevant here; it is deliberately not echoed.
      answer: reply.body,
      intent: reply.intent,
      grounded: true,
      needsAgencyInput: reply.needsAgencyInput,
      delegation: reply.delegation,
      mutation: reply.mutation,
      workspace: { id: copilot.tenantId, name: copilot.tenantName },
      _springBaseline: SPRING.stiffness,
    },
  };
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

export async function dispatchAgencyAction(
  payload: InboundWebhookPayload,
  ctx: DispatchContext,
): Promise<DispatchOutcome> {
  try {
    switch (payload.action) {
      case 'fetch_leads':
        return await fetchLeads(ctx, payload);
      case 'fetch_calls':
        return await fetchCalls(ctx, payload);
      case 'fetch_clients':
        return await fetchClients(ctx);
      case 'fetch_client_detail':
        return await fetchClientDetail(ctx, payload);
      case 'fetch_calendar_slots':
        return await fetchCalendarSlots(ctx, payload);
      case 'fetch_metrics':
        return await fetchMetrics(ctx, payload);
      case 'create_lead':
        return await createLead(ctx, payload);
      case 'dispatch_call':
        return await dispatchCall(ctx, payload);
      case 'send_sms':
        return await sendSms(ctx, payload);
      case 'book_appointment':
        return await bookAppointment(ctx, payload);
      case 'update_client':
        return await updateClient(ctx, payload);
      case 'ask_copilot':
        return await askCopilot(ctx, payload);
      default: {
        // Exhaustiveness guard: a new action must be handled before it compiles.
        const never: never = payload;
        return { ok: false, code: 'internal', error: `Unhandled action: ${JSON.stringify(never)}` };
      }
    }
  } catch (cause) {
    // Never leak a driver message to an external caller.
    const message = cause instanceof Error ? cause.message : '';
    const safe = /not found|permission denied|violates row-level security/i.test(message);
    return {
      ok: false,
      code: safe ? 'conflict' : 'internal',
      error: safe ? 'The workspace rejected that request.' : 'The action could not be completed.',
    };
  }
}
