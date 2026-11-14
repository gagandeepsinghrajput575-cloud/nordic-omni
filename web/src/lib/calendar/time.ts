/**
 * Danish booking-time engine.
 *
 * Every instant the gateway reasons about is evaluated in Europe/Copenhagen,
 * never in the server's local zone and never in the visitor's. Danish workweeks
 * run Monday–Friday 07:00–16:00 and skip Danish holidays, so the slot grid is a
 * calendar fact rather than a client preference.
 *
 * This module is deliberately dependency-free: `Intl.DateTimeFormat` with an
 * explicit IANA zone is the only timezone authority, and all arithmetic is done
 * on integer UTC milliseconds. Nothing here imports `server-only`, so the same
 * functions run in the API routes, in the studio panel, and in unit tests.
 */

export const BOOKING_TIMEZONE = 'Europe/Copenhagen';

/** Danish workweek, as declared by the receptionist product. */
export const WORKDAY_START = '07:00';
export const WORKDAY_END = '16:00';
export const DEFAULT_SLOT_MINUTES = 30;
export const DEFAULT_LEAD_TIME_MINUTES = 60;
export const DEFAULT_HORIZON_DAYS = 21;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface ZonedWallClock extends WallClock {
  /** 0 = Sunday … 6 = Saturday, resolved in the target zone. */
  weekday: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** Wall-clock fields of an instant, as a Danish office would read the clock. */
export function zonedParts(instant: Date, timeZone: string = BOOKING_TIMEZONE): ZonedWallClock {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number.parseInt(found.value, 10) : 0;
  };
  const year = read('year');
  const month = read('month');
  const day = read('day');
  // Weekday is derived from the *wall-clock* date, which is zone-independent.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return {
    year,
    month,
    day,
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
    weekday,
  };
}

/** UTC offset of `timeZone` at `instant`, in milliseconds (positive east). */
export function zoneOffsetMs(instant: Date, timeZone: string = BOOKING_TIMEZONE): number {
  const wall = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  // Second precision keeps the offset free of sub-second drift.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function sameWallClock(a: WallClock, b: WallClock): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute
  );
}

/**
 * Convert a Copenhagen wall-clock reading to the UTC instant it names.
 *
 * Both DST edges are resolved deterministically ("compatible" disambiguation):
 *   - Ambiguous hour (autumn): two instants share the reading, so the *earlier*
 *     one wins — 02:30 on the night the clocks go back is read as CEST, the way
 *     a Dane experiences it first.
 *   - Non-existent hour (spring): no instant matches, so the reading is shifted
 *     forward past the gap (02:30 becomes 03:30), never silently an hour early.
 */
export function zonedTimeToUtc(
  wall: Pick<WallClock, 'year' | 'month' | 'day' | 'hour' | 'minute'> & { second?: number },
  timeZone: string = BOOKING_TIMEZONE,
): Date {
  const second = wall.second ?? 0;
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, second);
  const target = { ...wall, second };

  // Offsets either side of the reading, covering any transition within a day.
  const probeBefore = new Date(guess - 12 * 3_600_000);
  const probeAfter = new Date(guess + 12 * 3_600_000);
  const offsets = Array.from(
    new Set([zoneOffsetMs(probeBefore, timeZone), zoneOffsetMs(probeAfter, timeZone)]),
  );

  const matching = offsets
    .map((offset) => guess - offset)
    .filter((instant) => sameWallClock(zonedParts(new Date(instant), timeZone), target));

  if (matching.length > 0) {
    // Ambiguous readings resolve to the earliest matching instant.
    return new Date(Math.min(...matching));
  }
  // Spring-forward gap: interpret with the pre-transition offset so the result
  // lands after the jump rather than before it.
  return new Date(guess - offsets[0]);
}

export interface DanishHoliday {
  /** ISO date in Europe/Copenhagen, `YYYY-MM-DD`. */
  date: string;
  /** Danish name, used in operator-facing copy. */
  name: string;
  /** `closed` skips the day entirely; `restricted` keeps it out of booking too. */
  kind: 'closed' | 'restricted';
  /** Included for auditability where a holiday was repealed. */
  abolishedFrom?: number;
}

function isoDate(year: number, month: number, day: number): string {
  const utc = new Date(Date.UTC(year, month - 1, day));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}`;
}

function addDaysIso(baseIso: string, days: number): string {
  const [year, month, day] = baseIso.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return isoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Anonymous Gregorian computus — Easter Sunday for a Gregorian year. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}

/**
 * Danish holidays for a year.
 *
 * `Store bededag` became a normal working day in 2024 after its repeal as a
 * public holiday, so it is carried with `abolishedFrom` and skipped from that
 * year on. `Grundlovsdag`, `Juleaften` and `Nytårsaften` are not statutory
 * holidays but Danish offices are shut, so they are `restricted` rather than
 * bookable.
 */
export function danishHolidays(year: number): DanishHoliday[] {
  const easter = easterSunday(year);
  const holidays: DanishHoliday[] = [
    { date: isoDate(year, 1, 1), name: 'Nytårsdag', kind: 'closed' },
    { date: addDaysIso(easter, -3), name: 'Skærtorsdag', kind: 'closed' },
    { date: addDaysIso(easter, -2), name: 'Langfredag', kind: 'closed' },
    { date: easter, name: 'Påskedag', kind: 'closed' },
    { date: addDaysIso(easter, 1), name: '2. påskedag', kind: 'closed' },
    { date: addDaysIso(easter, 39), name: 'Kristi himmelfartsdag', kind: 'closed' },
    { date: addDaysIso(easter, 49), name: 'Pinsedag', kind: 'closed' },
    { date: addDaysIso(easter, 50), name: '2. pinsedag', kind: 'closed' },
    { date: isoDate(year, 6, 5), name: 'Grundlovsdag', kind: 'restricted' },
    { date: isoDate(year, 12, 24), name: 'Juleaften', kind: 'restricted' },
    { date: isoDate(year, 12, 25), name: 'Juledag', kind: 'closed' },
    { date: isoDate(year, 12, 26), name: '2. juledag', kind: 'closed' },
    { date: isoDate(year, 12, 31), name: 'Nytårsaften', kind: 'restricted' },
  ];
  if (year < 2024) {
    holidays.push({
      date: addDaysIso(easter, 26),
      name: 'Store bededag',
      kind: 'closed',
      abolishedFrom: 2024,
    });
  }
  return holidays.sort((left, right) => left.date.localeCompare(right.date));
}

/** Every exclusion date for the years spanned by `from`–`to`, as ISO dates. */
export function holidayIndex(fromYear: number, toYear: number): Map<string, DanishHoliday> {
  const index = new Map<string, DanishHoliday>();
  for (let year = fromYear; year <= toYear; year += 1) {
    for (const holiday of danishHolidays(year)) index.set(holiday.date, holiday);
  }
  return index;
}

export function isoDateOfWallClock(wall: WallClock): string {
  return `${String(wall.year).padStart(4, '0')}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
}

export function holidayOn(wall: WallClock, index: Map<string, DanishHoliday>): DanishHoliday | null {
  return index.get(isoDateOfWallClock(wall)) ?? null;
}

function parseHhMm(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}

export interface BookingWindowConfig {
  timeZone: string;
  workdayStart: string;
  workdayEnd: string;
  slotMinutes: number;
  /** Minutes reserved after each appointment (travel/tidy-up). */
  bufferMinutes: number;
  /** A slot may not start sooner than this from now. */
  leadTimeMinutes: number;
  horizonDays: number;
  /** Book on Grundlovsdag/Juleaften/Nytårsaften when the owner insists. */
  allowRestrictedDays: boolean;
}

export const DEFAULT_BOOKING_WINDOW: BookingWindowConfig = {
  timeZone: BOOKING_TIMEZONE,
  workdayStart: WORKDAY_START,
  workdayEnd: WORKDAY_END,
  slotMinutes: DEFAULT_SLOT_MINUTES,
  bufferMinutes: 5,
  leadTimeMinutes: DEFAULT_LEAD_TIME_MINUTES,
  horizonDays: DEFAULT_HORIZON_DAYS,
  allowRestrictedDays: false,
};

export interface TimeInterval {
  startUtc: Date;
  endUtc: Date;
}

/** Half-open overlap: `[10:00,10:30)` and `[10:30,11:00)` never conflict. */
export function intervalsOverlap(left: TimeInterval, right: TimeInterval): boolean {
  return left.startUtc.getTime() < right.endUtc.getTime() && right.startUtc.getTime() < left.endUtc.getTime();
}

/** Expand an interval by `bufferMinutes` on both sides. */
export function withBuffer(interval: TimeInterval, bufferMinutes: number): TimeInterval {
  if (bufferMinutes <= 0) return interval;
  return {
    startUtc: new Date(interval.startUtc.getTime() - bufferMinutes * MS_PER_MINUTE),
    endUtc: new Date(interval.endUtc.getTime() + bufferMinutes * MS_PER_MINUTE),
  };
}

export function isSlotFree(candidate: TimeInterval, busy: readonly TimeInterval[]): boolean {
  return busy.every((interval) => !intervalsOverlap(candidate, interval));
}

export interface SlotRefusal {
  reason:
    | 'weekend'
    | 'holiday'
    | 'restricted_day'
    | 'outside_workday'
    | 'off_grid'
    | 'too_soon'
    | 'beyond_horizon';
  message: string;
  holidayName?: string;
}

export interface ScheduleSlot extends TimeInterval {
  /** ISO UTC instants — the only form that crosses the wire. */
  startIso: string;
  endIso: string;
  /** Copenhagen wall clock, for the Danish label and ICS output. */
  localDate: string;
  localStart: string;
  localEnd: string;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  /** Danish, e.g. `man. 18. nov. 07:00–07:30`. */
  label: string;
  available: boolean;
  /** Set when the slot is blocked, so the panel can explain itself. */
  blockedBy?: 'booked' | 'held' | 'past';
}

const WEEKDAY_LABELS_DA = ['søn.', 'man.', 'tir.', 'ons.', 'tor.', 'fre.', 'lør.'];
const MONTH_LABELS_DA = [
  'jan.',
  'feb.',
  'mar.',
  'apr.',
  'maj',
  'jun.',
  'jul.',
  'aug.',
  'sep.',
  'okt.',
  'nov.',
  'dec.',
];

export function danishSlotLabel(wall: ZonedWallClock, startMinutes: number, endMinutes: number): string {
  const hh = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return `${WEEKDAY_LABELS_DA[wall.weekday]} ${wall.day}. ${MONTH_LABELS_DA[wall.month - 1]} ${hh(startMinutes)}–${hh(endMinutes)}`;
}

const timeFormatCache = new Map<string, Intl.DateTimeFormat>();

function timeFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = timeFormatCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  });
  timeFormatCache.set(timeZone, formatter);
  return formatter;
}

export function localClock(instant: Date, timeZone: string = BOOKING_TIMEZONE): string {
  return timeFormatter(timeZone).format(instant);
}

/**
 * Why a wall-clock reading cannot be booked, or `null` when it is valid.
 * Pure, so the API and the panel agree on the same refusals.
 */
export function refusalFor(
  instant: Date,
  config: BookingWindowConfig,
  now: Date,
  holidays: Map<string, DanishHoliday>,
): SlotRefusal | null {
  const wall = zonedParts(instant, config.timeZone);
  if (wall.weekday === 0 || wall.weekday === 6) {
    return { reason: 'weekend', message: 'Vi booker ikke i weekenden.' };
  }
  const holiday = holidayOn(wall, holidays);
  if (holiday && holiday.kind === 'closed') {
    return { reason: 'holiday', message: `${holiday.name} er en dansk helligdag.`, holidayName: holiday.name };
  }
  if (holiday && holiday.kind === 'restricted' && !config.allowRestrictedDays) {
    return {
      reason: 'restricted_day',
      message: `${holiday.name} er en lukkedag.`,
      holidayName: holiday.name,
    };
  }
  const startMinutes = wall.hour * 60 + wall.minute;
  const open = parseHhMm(config.workdayStart);
  const close = parseHhMm(config.workdayEnd);
  if (startMinutes < open || startMinutes + config.slotMinutes > close) {
    return { reason: 'outside_workday', message: `Vi booker mellem ${config.workdayStart} og ${config.workdayEnd}.` };
  }
  if ((startMinutes - open) % config.slotMinutes !== 0) {
    return { reason: 'off_grid', message: 'Tidspunktet passer ikke i tidsgriden.' };
  }
  if (instant.getTime() < now.getTime() + config.leadTimeMinutes * MS_PER_MINUTE) {
    return { reason: 'too_soon', message: `Vi skal have mindst ${config.leadTimeMinutes} minutters varsel.` };
  }
  if (instant.getTime() > now.getTime() + config.horizonDays * MS_PER_DAY) {
    return { reason: 'beyond_horizon', message: `Vi booker højst ${config.horizonDays} dage frem.` };
  }
  return null;
}

/**
 * The full slot grid between `now` and the horizon, annotated with occupancy.
 *
 * Slots are generated from the Copenhagen wall clock (not by stepping UTC), so
 * a DST shift never produces 06:00 or 08:00 slots on the transition day.
 */
export function buildSlotGrid({
  now,
  config = DEFAULT_BOOKING_WINDOW,
  busy = [],
}: {
  now: Date;
  config?: BookingWindowConfig;
  busy?: readonly TimeInterval[];
}): ScheduleSlot[] {
  const slots: ScheduleSlot[] = [];
  const open = parseHhMm(config.workdayStart);
  const close = parseHhMm(config.workdayEnd);
  const today = zonedParts(now, config.timeZone);
  const horizon = now.getTime() + config.horizonDays * MS_PER_DAY;
  const holidays = holidayIndex(today.year, today.year + 1);
  const buffered = busy.map((interval) => withBuffer(interval, config.bufferMinutes));

  for (let dayOffset = 0; dayOffset <= config.horizonDays; dayOffset += 1) {
    const base = Date.UTC(today.year, today.month - 1, today.day + dayOffset);
    const probe = new Date(base);
    const year = probe.getUTCFullYear();
    const month = probe.getUTCMonth() + 1;
    const day = probe.getUTCDate();
    const weekday = probe.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;

    for (let minutes = open; minutes + config.slotMinutes <= close; minutes += config.slotMinutes) {
      const startUtc = zonedTimeToUtc(
        { year, month, day, hour: Math.floor(minutes / 60), minute: minutes % 60 },
        config.timeZone,
      );
      if (startUtc.getTime() > horizon) break;
      const refusal = refusalFor(startUtc, config, now, holidays);
      if (refusal && refusal.reason !== 'too_soon') continue;

      const endUtc = new Date(startUtc.getTime() + config.slotMinutes * MS_PER_MINUTE);
      const wall = zonedParts(startUtc, config.timeZone);
      const endWall = zonedParts(endUtc, config.timeZone);
      const endMinutes = endWall.hour * 60 + endWall.minute;
      const conflicting = buffered.filter((interval) => intervalsOverlap({ startUtc, endUtc }, interval));
      const available = refusal === null && conflicting.length === 0;

      let blockedBy: ScheduleSlot['blockedBy'];
      if (!available) blockedBy = refusal ? 'past' : 'booked';

      slots.push({
        startUtc,
        endUtc,
        startIso: startUtc.toISOString(),
        endIso: endUtc.toISOString(),
        localDate: isoDateOfWallClock(wall),
        localStart: localClock(startUtc, config.timeZone),
        localEnd: localClock(endUtc, config.timeZone),
        startMinutes: wall.hour * 60 + wall.minute,
        endMinutes,
        durationMinutes: config.slotMinutes,
        label: danishSlotLabel(wall, wall.hour * 60 + wall.minute, endMinutes),
        available,
        ...(blockedBy ? { blockedBy } : {}),
      });
    }
  }
  return slots;
}

/** Validate one requested instant against the window and existing occupancy. */
export function validateRequestedSlot({
  start,
  end,
  now,
  config = DEFAULT_BOOKING_WINDOW,
  busy = [],
}: {
  start: Date;
  end: Date;
  now: Date;
  config?: BookingWindowConfig;
  busy?: readonly TimeInterval[];
}): SlotRefusal | null {
  const startWall = zonedParts(start, config.timeZone);
  const holidays = holidayIndex(startWall.year - 1, startWall.year + 1);
  const refusal = refusalFor(start, config, now, holidays);
  if (refusal) return refusal;

  const durationMinutes = Math.round((end.getTime() - start.getTime()) / MS_PER_MINUTE);
  if (durationMinutes !== config.slotMinutes) {
    return { reason: 'off_grid', message: `Aftalen skal vare ${config.slotMinutes} minutter.` };
  }
  const buffered = busy.map((interval) => withBuffer(interval, config.bufferMinutes));
  if (!isSlotFree({ startUtc: start, endUtc: end }, buffered)) {
    return { reason: 'off_grid', message: 'Tidspunktet er allerede optaget.' };
  }
  return null;
}

export function intervalOf(startIso: string, endIso: string): TimeInterval {
  return { startUtc: new Date(startIso), endUtc: new Date(endIso) };
}
