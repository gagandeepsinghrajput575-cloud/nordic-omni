import 'server-only';

import { withUser, type Tx } from '@/lib/db/client';
import type {
  BookingHoldRecord,
  BookingRecord,
  BookingStatus,
  CalendarProvider,
} from '@/contracts/schemas';

/**
 * Tenant-scoped calendar persistence.
 *
 * Every function here runs through `withUser()`, i.e. as the RLS-enforced
 * `omni_app` role inside a transaction where `app.user_id` is set. The owner
 * pool is deliberately NOT used: migrations 0018 define SELECT/INSERT/UPDATE
 * policies for live holds and bookings, so an agency user reads their tenants
 * and a client user reads only their own.
 *
 * Concurrency: `createSlotHold` takes `pg_advisory_xact_lock` keyed on the
 * tenant, then re-checks overlap inside the same transaction before inserting.
 * Two phones calling at once therefore serialise instead of both winning.
 */

export interface BusyIntervalRow {
  start_iso: string;
  end_iso: string;
  source: 'hold' | 'booking';
}

interface HoldDbRow {
  id: string;
  tenant_id: string;
  contact_id: string | null;
  call_log_id: string | null;
  provider: string;
  status: string;
  start_iso: string;
  end_iso: string;
  topic: string;
  notes: string;
  expires_at_iso: string;
  label: string;
  created_at_iso: string;
}

function toHold(row: HoldDbRow): BookingHoldRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    callLogId: row.call_log_id,
    provider: row.provider as CalendarProvider,
    status: row.status as BookingStatus,
    startIso: new Date(row.start_iso).toISOString(),
    endIso: new Date(row.end_iso).toISOString(),
    topic: row.topic,
    notes: row.notes,
    expiresAtIso: new Date(row.expires_at_iso).toISOString(),
    label: row.label,
    createdAtIso: new Date(row.created_at_iso).toISOString(),
  };
}

/**
 * Occupancy for a tenant: live holds plus confirmed bookings.
 *
 * A hold whose expiry has passed is excluded by the WHERE clause rather than by
 * the caller, so a lapsed hold cannot block a slot even before the sweeper runs.
 */
export async function listBusyIntervals(
  userId: string,
  tenantId: string,
): Promise<BusyIntervalRow[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select start_iso, end_iso, 'hold'::text as source
        from public.calendar_slot_holds
       where tenant_id = ${tenantId}
         and status = 'held'
         and expires_at > now()
      union all
      select start_iso, end_iso, 'booking'::text as source
        from public.calendar_bookings
       where tenant_id = ${tenantId}
         and status = 'confirmed'
    `;
    return (rows as unknown as BusyIntervalRow[]).map((row) => ({
      ...row,
      start_iso: new Date(row.start_iso).toISOString(),
      end_iso: new Date(row.end_iso).toISOString(),
    }));
  });
}

export interface CreateSlotHoldRow {
  tenantId: string;
  contactId: string | null;
  callLogId: string | null;
  provider: CalendarProvider;
  startIso: string;
  endIso: string;
  topic: string;
  notes: string;
  label: string;
  holdSeconds: number;
}

export type SlotHoldResult =
  | { ok: true; hold: BookingHoldRecord }
  | { ok: false; reason: 'slot_taken' };

/**
 * Take a ten-minute hold, atomically.
 *
 * The `where not exists` guard is evaluated under the advisory lock, so the
 * overlap test and the insert cannot interleave with a competing call.
 */
export async function createSlotHold(
  userId: string,
  input: CreateSlotHoldRow,
): Promise<SlotHoldResult> {
  return withUser(userId, async (tx: Tx) => {
    const { tenantId } = input;
    await tx`select pg_advisory_xact_lock(hashtext(${`calendar_slot_hold:${tenantId}`}))`;

    const conflict = await tx`
      select 1 as blocked
        from public.calendar_slot_holds
       where tenant_id = ${tenantId}
         and status = 'held'
         and expires_at > now()
         and start_iso < ${input.endIso}::timestamptz
         and ${input.startIso}::timestamptz < end_iso
      union all
      select 1 as blocked
        from public.calendar_bookings
       where tenant_id = ${tenantId}
         and status = 'confirmed'
         and start_iso < ${input.endIso}::timestamptz
         and ${input.startIso}::timestamptz < end_iso
       limit 1
    `;
    if (conflict.length > 0) return { ok: false, reason: 'slot_taken' } as const;

    const rows = await tx`
      insert into public.calendar_slot_holds (
        tenant_id, contact_id, call_log_id, provider, status,
        start_iso, end_iso, topic, notes, expires_at, label
      ) values (
        ${tenantId}, ${input.contactId}, ${input.callLogId}, ${input.provider}, 'held',
        ${input.startIso}::timestamptz, ${input.endIso}::timestamptz,
        ${input.topic}, ${input.notes},
        now() + make_interval(secs => ${input.holdSeconds}), ${input.label}
      )
      returning id, tenant_id, contact_id, call_log_id, provider, status,
                start_iso, end_iso, topic, notes, expires_at, label, created_at
    `;
    return { ok: true, hold: toHold(rows[0] as unknown as HoldDbRow) } as const;
  });
}

export async function findSlotHold(
  userId: string,
  tenantId: string,
  holdId: string,
): Promise<BookingHoldRecord | null> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select id, tenant_id, contact_id, call_log_id, provider, status,
             start_iso, end_iso, topic, notes, expires_at, label, created_at
        from public.calendar_slot_holds
       where id = ${holdId} and tenant_id = ${tenantId}
       limit 1
    `;
    const row = rows[0] as unknown as HoldDbRow | undefined;
    return row ? toHold(row) : null;
  });
}

/**
 * Claim a hold for confirmation.
 *
 * The UPDATE carries the expiry test in its own WHERE clause, so a hold that
 * lapses during the call cannot be resurrected by a late confirmation.
 */
export async function claimSlotHold(
  userId: string,
  tenantId: string,
  holdId: string,
): Promise<BookingHoldRecord | null> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      update public.calendar_slot_holds
         set status = 'confirmed', confirmed_at = now()
       where id = ${holdId}
         and tenant_id = ${tenantId}
         and status = 'held'
         and expires_at > now()
      returning id, tenant_id, contact_id, call_log_id, provider, status,
                start_iso, end_iso, topic, notes, expires_at, label, created_at
    `;
    const row = rows[0] as unknown as HoldDbRow | undefined;
    return row ? toHold(row) : null;
  });
}

export async function releaseSlotHold(
  userId: string,
  tenantId: string,
  holdId: string,
): Promise<boolean> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      update public.calendar_slot_holds
         set status = 'released', released_at = now()
       where id = ${holdId}
         and tenant_id = ${tenantId}
         and status = 'held'
      returning id
    `;
    return rows.length > 0;
  });
}

export interface InsertBookingInput {
  id: string;
  tenantId: string;
  contactId: string | null;
  callLogId: string | null;
  provider: CalendarProvider;
  startIso: string;
  endIso: string;
  label: string;
  topic: string;
  attendeeName: string;
  attendeeEmail: string | null;
  attendeePhone: string | null;
  icsUid: string;
}

export async function insertBooking(
  userId: string,
  input: InsertBookingInput,
): Promise<BookingRecord> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      insert into public.calendar_bookings (
        id, tenant_id, contact_id, call_log_id, provider, status,
        start_iso, end_iso, label, topic, attendee_name,
        attendee_email, attendee_phone, ics_uid
      ) values (
        ${input.id}, ${input.tenantId}, ${input.contactId}, ${input.callLogId},
        ${input.provider}, 'confirmed',
        ${input.startIso}::timestamptz, ${input.endIso}::timestamptz,
        ${input.label}, ${input.topic}, ${input.attendeeName},
        ${input.attendeeEmail}, ${input.attendeePhone}, ${input.icsUid}
      )
      returning id
    `;
    if (!rows[0]) throw new Error('Booking insert returned no row');
    return {
      id: input.id,
      tenantId: input.tenantId,
      contactId: input.contactId,
      callLogId: input.callLogId,
      provider: input.provider,
      startIso: new Date(input.startIso).toISOString(),
      endIso: new Date(input.endIso).toISOString(),
      label: input.label,
      topic: input.topic,
      attendeeName: input.attendeeName,
      attendeeEmail: input.attendeeEmail,
      attendeePhone: input.attendeePhone,
      icsUid: input.icsUid,
      createdAtIso: new Date().toISOString(),
    };
  });
}

export interface ConfirmAndInsertBookingInput {
  tenantId: string;
  holdId?: string | null;
  contactId: string | null;
  callLogId: string | null;
  provider: CalendarProvider;
  startIso: string;
  endIso: string;
  label: string;
  topic: string;
  notes?: string;
  attendeeName: string;
  attendeeEmail: string | null;
  attendeePhone: string | null;
  icsUid: string;
  id: string;
}

export type ConfirmBookingResult =
  | { ok: true; booking: BookingRecord }
  | { ok: false; reason: 'hold_expired' | 'slot_taken' };

/**
 * Atomically verifies hold or slot availability, claims hold, and inserts booking
 * under a single PostgreSQL transaction with pg_advisory_xact_lock.
 */
export async function confirmAndInsertBookingAtomic(
  userId: string,
  input: ConfirmAndInsertBookingInput,
): Promise<ConfirmBookingResult> {
  return withUser(userId, async (tx: Tx) => {
    const { tenantId } = input;
    await tx`select pg_advisory_xact_lock(hashtext(${`calendar_slot_hold:${tenantId}`}))`;

    if (input.holdId) {
      const claimed = await tx`
        update public.calendar_slot_holds
           set status = 'confirmed', confirmed_at = now()
         where id = ${input.holdId}
           and tenant_id = ${tenantId}
           and status = 'held'
           and expires_at > now()
        returning id
      `;
      if (claimed.length === 0) {
        return { ok: false, reason: 'hold_expired' } as const;
      }
    } else {
      const conflict = await tx`
        select 1 as blocked
          from public.calendar_slot_holds
         where tenant_id = ${tenantId}
           and status = 'held'
           and expires_at > now()
           and start_iso < ${input.endIso}::timestamptz
           and ${input.startIso}::timestamptz < end_iso
        union all
        select 1 as blocked
          from public.calendar_bookings
         where tenant_id = ${tenantId}
           and status = 'confirmed'
           and start_iso < ${input.endIso}::timestamptz
           and ${input.startIso}::timestamptz < end_iso
         limit 1
      `;
      if (conflict.length > 0) {
        return { ok: false, reason: 'slot_taken' } as const;
      }
    }

    const rows = await tx`
      insert into public.calendar_bookings (
        id, tenant_id, contact_id, call_log_id, provider, status,
        start_iso, end_iso, label, topic, attendee_name,
        attendee_email, attendee_phone, ics_uid
      ) values (
        ${input.id}, ${tenantId}, ${input.contactId}, ${input.callLogId},
        ${input.provider}, 'confirmed',
        ${input.startIso}::timestamptz, ${input.endIso}::timestamptz,
        ${input.label}, ${input.topic}, ${input.attendeeName},
        ${input.attendeeEmail}, ${input.attendeePhone}, ${input.icsUid}
      )
      returning id
    `;
    if (!rows[0]) throw new Error('Booking insert returned no row');

    return {
      ok: true,
      booking: {
        id: input.id,
        tenantId,
        contactId: input.contactId,
        callLogId: input.callLogId,
        provider: input.provider,
        startIso: new Date(input.startIso).toISOString(),
        endIso: new Date(input.endIso).toISOString(),
        label: input.label,
        topic: input.topic,
        attendeeName: input.attendeeName,
        attendeeEmail: input.attendeeEmail,
        attendeePhone: input.attendeePhone,
        icsUid: input.icsUid,
        createdAtIso: new Date().toISOString(),
      },
    } as const;
  });
}

export async function listBookings(
  userId: string,
  tenantId: string,
): Promise<BookingRecord[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select id, tenant_id, contact_id, call_log_id, provider, start_iso, end_iso,
             label, topic, attendee_name, attendee_email, attendee_phone,
             ics_uid, created_at
        from public.calendar_bookings
       where tenant_id = ${tenantId}
       order by start_iso asc
       limit 200
    `;
    return (rows as unknown as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      tenantId: String(row.tenant_id),
      contactId: (row.contact_id as string | null) ?? null,
      callLogId: (row.call_log_id as string | null) ?? null,
      provider: String(row.provider) as CalendarProvider,
      startIso: new Date(String(row.start_iso)).toISOString(),
      endIso: new Date(String(row.end_iso)).toISOString(),
      label: String(row.label),
      topic: String(row.topic),
      attendeeName: String(row.attendee_name),
      attendeeEmail: (row.attendee_email as string | null) ?? null,
      attendeePhone: (row.attendee_phone as string | null) ?? null,
      icsUid: String(row.ics_uid),
      createdAtIso: new Date(String(row.created_at)).toISOString(),
    }));
  });
}
