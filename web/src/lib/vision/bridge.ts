import { z } from 'zod';

/**
 * Vision AI bridge contract.
 *
 * Vision (`untitled folder 2/me`) is a productivity/alarm/task/focus system with
 * four schemas in `shared/vision-contract.ts`. Its source is not vendored into
 * this repository, so the shapes below are declared here from the agreed
 * contract and every mapper is a pure function — which means the mapping is
 * provable in tests today and adjustable in one file if the real schema drifts.
 *
 * Direction of travel:
 *
 *   Nordic Omni  --(signed POST)-->  Vision /api/alarms   (wake the operator)
 *   Nordic Omni  --(signed POST)-->  Vision /api/tasks    (stage priority work)
 *   Vision AI    --(inbound action)-->  Nordic Omni gateway
 */

// -----------------------------------------------------------------------------
// Vision's contract, as consumed/emitted
// -----------------------------------------------------------------------------

export const TaskPriority = z.enum(['low', 'normal', 'high', 'urgent']);
export type TaskPriority = z.infer<typeof TaskPriority>;

export const TaskSlot = z.enum(['morning', 'midday', 'afternoon', 'evening', 'anytime']);
export type TaskSlot = z.infer<typeof TaskSlot>;

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  priority: TaskPriority,
  slot: TaskSlot,
  done: z.boolean().default(false),
  /** Vision keeps provenance so a task can be traced back to its source system. */
  source: z.string().default('nordic-omni'),
  createdAt: z.string(),
  dueAt: z.string().optional(),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type VisionTask = z.infer<typeof TaskSchema>;

export const AlarmSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  body: z.string().max(1000),
  /** Alarms bypass task scheduling and fire immediately. */
  severity: z.enum(['info', 'warning', 'critical']),
  fireAt: z.string(),
  source: z.string().default('nordic-omni'),
  repeat: z.enum(['none', 'hourly', 'daily']).default('none'),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type VisionAlarm = z.infer<typeof AlarmSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1),
  createdAt: z.string(),
  context: z.record(z.string(), z.unknown()).default({}),
});
export type VisionChatMessage = z.infer<typeof ChatMessageSchema>;

export const CallStatusSchema = z.object({
  callId: z.string(),
  status: z.enum(['ringing', 'in_progress', 'completed', 'missed', 'failed']),
  direction: z.enum(['inbound', 'outbound']),
  contactName: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  startedAt: z.string(),
  durationSeconds: z.number().int().min(0).default(0),
  summary: z.string().nullable().default(null),
});
export type VisionCallStatus = z.infer<typeof CallStatusSchema>;

// -----------------------------------------------------------------------------
// Nordic Omni events that are worth waking someone for
// -----------------------------------------------------------------------------

export type VisionRoute = 'alarm' | 'task' | 'none';

export interface OmniEvent {
  id: string;
  type: string;
  tenantId: string | null;
  createdAt: string;
  data: Record<string, unknown>;
}

/** Urgency at or above this is an alarm; below it is a task. */
export const ALARM_URGENCY_FLOOR = 4;

/** A lead worth this much is worth a task even without an escalation. */
export const HIGH_VALUE_LEAD_DKK = 50_000;

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Which Vision channel an Omni event belongs on.
 *
 * Deliberately conservative: only missed calls, urgent escalations and
 * high-value leads are pushed. Everything else would train the operator to
 * ignore Vision, which is worse than not notifying at all.
 */
export function routeEvent(event: OmniEvent): VisionRoute {
  switch (event.type) {
    case 'call.missed':
      return 'alarm';
    case 'escalation.created':
      return num(event.data.urgency) >= ALARM_URGENCY_FLOOR ? 'alarm' : 'task';
    case 'lead.created':
      return num(event.data.estimatedValueDkk) >= HIGH_VALUE_LEAD_DKK ? 'task' : 'none';
    default:
      return 'none';
  }
}

// -----------------------------------------------------------------------------
// Mappers — pure, so they are testable without a network or a database
// -----------------------------------------------------------------------------

export interface MapperContext {
  /** Injected so mapped timestamps are deterministic in tests. */
  now?: Date;
  tenantName?: string;
}

export function toVisionAlarm(event: OmniEvent, ctx: MapperContext = {}): VisionAlarm {
  const now = (ctx.now ?? new Date()).toISOString();
  const who = ctx.tenantName ?? str(event.data.tenantName, 'ukendt arbejdsrum');
  const isMissed = event.type === 'call.missed';

  const title = isMissed
    ? `Mistet opkald · ${who}`
    : `Akut eskalering · ${who}`;

  const body = isMissed
    ? `Et opkald fra ${str(event.data.phone, 'ukendt nummer')} blev ikke besvaret. Ring tilbage eller tildel opgaven.`
    : `${str(event.data.summary, 'En kunde har brug for hjælp nu.')} Kilde: ${who}.`;

  return AlarmSchema.parse({
    id: `omni-alarm-${event.id}`,
    title,
    body,
    severity: num(event.data.urgency) >= 5 || isMissed ? 'critical' : 'warning',
    // Fire immediately: an alarm that waits is a notification, not an alarm.
    fireAt: now,
    source: 'nordic-omni',
    repeat: 'none',
    metadata: {
      omniEventId: event.id,
      omniEventType: event.type,
      tenantId: event.tenantId,
      contactId: str(event.data.contactId) || null,
    },
  });
}

export function toVisionTask(event: OmniEvent, ctx: MapperContext = {}): VisionTask {
  const now = (ctx.now ?? new Date()).toISOString();
  const who = ctx.tenantName ?? str(event.data.tenantName, 'ukendt arbejdsrum');
  const value = num(event.data.estimatedValueDkk);

  const isLead = event.type === 'lead.created';
  const title = isLead
    ? `Følg op på lead · ${str(event.data.name, 'nyt lead')}`
    : `Behandl eskalering · ${who}`;

  const urgent = value >= HIGH_VALUE_LEAD_DKK || num(event.data.urgency) >= ALARM_URGENCY_FLOOR;

  return TaskSchema.parse({
    id: `omni-task-${event.id}`,
    title,
    priority: urgent ? 'high' : 'normal',
    // High-value leads are best worked in the first real work block.
    slot: urgent ? 'morning' : 'anytime',
    done: false,
    source: 'nordic-omni',
    createdAt: now,
    tags: [event.type.replace(/\./g, '-'), 'nordic-omni'],
    metadata: {
      omniEventId: event.id,
      omniEventType: event.type,
      tenantId: event.tenantId,
      estimatedValueDkk: value || null,
      stage: str(event.data.stage) || null,
    },
  });
}

/** A finished or missed call, for Vision's own call ledger. */
export function toVisionCallStatus(event: OmniEvent, ctx: MapperContext = {}): VisionCallStatus {
  const status = event.type === 'call.missed'
    ? 'missed'
    : event.type === 'call.started'
      ? 'ringing'
      : 'completed';

  return CallStatusSchema.parse({
    callId: str(event.data.callId, event.id),
    status,
    direction: event.data.direction === 'outbound' ? 'outbound' : 'inbound',
    contactName: str(event.data.contactName) || null,
    phone: str(event.data.phone) || null,
    startedAt: str(event.data.startedAt, ctx.now?.toISOString() ?? event.createdAt),
    durationSeconds: Math.round(num(event.data.durationSeconds)),
    summary: str(event.data.summary) || null,
  });
}

/** A copilot answer posted into a Vision chat thread. */
export function toVisionChatMessage(args: {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: string;
  context?: Record<string, unknown>;
}): VisionChatMessage {
  return ChatMessageSchema.parse({
    id: args.id,
    role: args.role,
    content: args.content,
    createdAt: args.createdAt ?? new Date().toISOString(),
    context: args.context ?? {},
  });
}
