import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiRequireTenant } from '@/lib/auth/guard';
import {
  bookCallSlotFromBridge,
  endLiveCall,
  liveCallSnapshot,
  recordTurnOnLiveCall,
  reportBargeInOnLiveCall,
  telephonyRegistry,
} from '@/lib/telephony/bridge';
import { SessionControlSchema } from '@/lib/telephony/contracts';
import { loadTelephonyCallSession } from '@/lib/telephony/tenant-grounding';

export const dynamic = 'force-dynamic';

/**
 * The live-call control plane.
 *
 * This is the only route that may change a call between "dispatch accepted it" and
 * "the ledger closed it". Every request is scoped three times, in this order:
 *
 *   1. `apiRequireTenant(tenantId)` — may this identity act for that workspace at all?
 *   2. the call's own `tenantId`, from the registry or from the ledger row — is this
 *      call actually in that workspace? A client that names a workspace it belongs to
 *      and someone else's call id gets a 403, not a transcript.
 *   3. the RLS policy on `telephony_call_sessions` — the database decides again.
 *
 * The `!live` path is not an error path. A worker restart mid-call is ordinary, and
 * a SIP BYE that arrives twice is ordinary. Both are answered from the ledger:
 * `end` becomes an idempotent success, and the actions that genuinely need live
 * media (a turn, a barge-in commit) say so instead of pretending.
 *
 * It is intentionally *not* the audio path. Caller audio goes to the conversational
 * provider over its own socket; what comes here is the small, durable residue —
 * transcripts, measured latency, barge-in counts, a booked slot, a hang-up. That is
 * what keeps a slow database write off the critical path of a turn, which is the
 * whole point of a sub-150 ms interruption budget.
 */

function denied(
  status: 400 | 403 | 404 | 409 | 410,
  error: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

const QuerySchema = z.object({
  callId: z.string().min(1).max(120),
  tenantId: z.string().uuid(),
});

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const parsed = SessionControlSchema.safeParse(body);
  if (!parsed.success) {
    return denied(400, 'Invalid control payload', { details: parsed.error.flatten() });
  }

  const control = parsed.data;
  const actor = await apiRequireTenant(control.tenantId);
  if (!actor) return denied(403, 'This call belongs to a workspace you are not a member of.');

  const live = telephonyRegistry().get(control.callId);
  if (live && live.tenantId !== control.tenantId) {
    return denied(403, 'The call id does not belong to that workspace.', { callId: control.callId });
  }

  if (!live) {
    const ledger = await loadTelephonyCallSession(
      { kind: 'user', userId: actor.userId },
      control.callId,
    ).catch(() => null);
    if (!ledger) {
      return denied(404, 'No call with that id is visible to this workspace.', { callId: control.callId });
    }
    if (ledger.tenantId !== control.tenantId) {
      return denied(403, 'The call id does not belong to that workspace.', { callId: control.callId });
    }
    if (control.action === 'end') {
      // Retried BYE, or a hang-up that landed after the worker closed the call.
      // Success, because the outcome the caller wanted is already recorded.
      return NextResponse.json({
        ok: true,
        alreadyClosed: true,
        status: ledger.status,
        persisted: true,
        turns: ledger.turnCount,
        latencyMs: ledger.latencyMs,
      });
    }
    return denied(410, 'This call is closed in the ledger, so no live media turn can be recorded against it.', {
      callId: control.callId,
      status: ledger.status,
    });
  }

  switch (control.action) {
    case 'turn': {
      const receipt = await recordTurnOnLiveCall(
        control.callId,
        { role: control.role, text: control.text, atMs: control.atMs },
        {
          ...(control.measuredRoundTripMs === undefined ? {} : { measuredRoundTripMs: control.measuredRoundTripMs }),
          ...(control.language ? { language: control.language } : {}),
        },
      );
      if (!receipt.ok) return denied(404, receipt.reason ?? 'The turn could not be applied.');
      return NextResponse.json({
        ok: true,
        applied: receipt.applied,
        reason: receipt.reason,
        status: receipt.status,
        persisted: receipt.persisted,
        latency: receipt.latency,
        turns: receipt.session?.transcript.length ?? 0,
      });
    }

    case 'barge_in': {
      const reported = await reportBargeInOnLiveCall(control.callId, {
        latencyMs: control.latencyMs,
        path: control.path,
        ...(control.echoGuardBlocks === undefined ? {} : { echoGuardBlocks: control.echoGuardBlocks }),
      });
      if (!reported.ok) {
        return denied(409, 'This interruption could not be attributed to a live call.');
      }
      // The verdict the caller's own meter should show next: the server's, not the
      // one it sent. Over-budget commits are reported, never hidden by an average.
      return NextResponse.json({ ...reported });
    }

    case 'end': {
      const closed = await endLiveCall(control.callId, control.reason);
      if (!closed.ok) return denied(409, `The call was already closed (${closed.reason ?? 'unknown'}).`);
      return NextResponse.json({
        ok: true,
        persisted: closed.wrap?.persisted ?? false,
        released: closed.wrap?.released ?? false,
        turns: closed.wrap?.turns ?? 0,
        status: closed.wrap?.session.status ?? 'completed',
        latencyMs: closed.wrap?.session.latencyMs ?? 0,
      });
    }

    case 'book': {
      const startMs = Date.parse(control.startIso);
      if (!Number.isFinite(startMs)) return denied(400, 'startIso is not an instant.');
      const durationMinutes = control.durationMinutes;
      const booked = await bookCallSlotFromBridge(
        {
          tenantId: control.tenantId,
          callId: control.callId,
          contactId: control.contactId ?? null,
          language: control.language,
          attendee: {
            name: control.attendee.name,
            email: control.attendee.email ?? null,
            phone: control.attendee.phone ?? null,
          },
          slot: {
            startIso: control.startIso,
            endIso: new Date(startMs + durationMinutes * 60_000).toISOString(),
            startMs,
            endMs: startMs + durationMinutes * 60_000,
            dayKey: control.startIso.slice(0, 10),
            durationMinutes,
          },
        },
        { userId: actor.userId, fetchImpl: globalThis.fetch },
      );
      if (!booked.ok) {
        return denied(409, booked.message, { reason: booked.reason, spokenRefusal: booked.spokenRefusal });
      }
      // `booked.ok` is the bridge's verdict and is spread last: the route must not be
      // able to report success on a refusal the bridge returned.
      return NextResponse.json({ ...booked });
    }

    default: {
      // Exhaustiveness guard: a new control action must be handled before this compiles.
      const never: never = control;
      return denied(400, `Unsupported control action: ${JSON.stringify(never)}`);
    }
  }
}

/** A snapshot for the studio meter: projection + barge-in counters + capacity. */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const parsed = QuerySchema.safeParse({
    callId: params.get('callId') ?? '',
    tenantId: params.get('tenantId') ?? '',
  });
  if (!parsed.success) return denied(400, 'callId and tenantId (UUID) are both required.');

  const { callId, tenantId } = parsed.data;
  const actor = await apiRequireTenant(tenantId);
  if (!actor) return denied(403, 'This call belongs to a workspace you are not a member of.');

  const snapshot = liveCallSnapshot(callId);
  if (!snapshot.found || snapshot.projection?.tenantId !== tenantId) {
    return denied(404, 'No live call with that id is visible to this workspace.', { callId });
  }
  return NextResponse.json({ ok: true, callId, ...snapshot });
}
