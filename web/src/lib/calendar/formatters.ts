/**
 * Universal calendar invitation formatters.
 *
 * Google Calendar, Outlook / Microsoft 365, Apple Calendar (iCloud .ics and
 * webcal://), and Cal.com all take a *different* shape for the same booking.
 * Everything here is pure string work so the output can be asserted byte for
 * byte in unit tests.
 *
 * RFC 5545 rules enforced below (and covered by `web/test/calendar.test.ts`):
 *   - CRLF line endings, every line.
 *   - Content lines folded at 75 octets, never splitting a multi-byte UTF-8
 *     sequence (Danish æ/ø/å would otherwise produce mojibake on iOS).
 *   - TEXT values escape `\ ; ,` and newlines.
 *   - A VTIMEZONE is emitted for Europe/Copenhagen so Apple and Outlook do not
 *     fall back to floating local time.
 *   - UID is stable per booking; DTSTAMP is the generation instant.
 */

import { BOOKING_TIMEZONE, type ZonedWallClock } from './time';

export type CalendarProvider = 'google' | 'apple_icloud' | 'outlook' | 'calcom' | 'ics_universal';

export const CALENDAR_PROVIDERS: readonly CalendarProvider[] = [
  'google',
  'apple_icloud',
  'outlook',
  'calcom',
  'ics_universal',
] as const;

export interface BookingEventDetails {
  /** Stable per booking; also used as the ICS UID prefix. */
  uid: string;
  title: string;
  description: string;
  location: string;
  startUtc: Date;
  endUtc: Date;
  organizerName: string;
  organizerEmail: string;
  attendeeName: string;
  attendeeEmail: string | null;
  /** Danish label shown in the panel and reused in the SMS. */
  label: string;
  url: string;
}

export interface CalendarLinks {
  google: string;
  outlook: string;
  apple: string;
  calcom: string;
  webcal: string;
  ics: string;
}

const MS_PER_MINUTE = 60_000;

const icsUtc = (instant: Date): string => {
  const iso = instant.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
};

/**
 * Largest cut index at or below `limit` that does not split a UTF-8 sequence.
 *
 * A UTF-8 continuation byte is `0b10xxxxxx`, so stepping back while the byte at
 * the cut is a continuation byte always lands on a code-point boundary. Without
 * this, folding a Danish or emoji line produces U+FFFD and iOS Calendar shows
 * mojibake.
 */
function utf8Boundary(bytes: Buffer, limit: number): number {
  let cut = Math.min(limit, bytes.length);
  while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut -= 1;
  // A pathological single code point longer than the limit would produce cut=0;
  // fall back to the raw limit so folding can always make progress.
  return cut > 0 ? cut : Math.min(limit, bytes.length);
}

/**
 * Fold one content line to the RFC 5545 75-octet limit.
 *
 * Continuation lines start with a single space, which itself counts toward the
 * 75-octet budget; folding is measured in UTF-8 bytes so Danish names and emoji
 * survive intact.
 */
export function foldContentLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let offset = 0;
  let budget = 75;
  while (bytes.length - offset > budget) {
    const cut = utf8Boundary(bytes.subarray(offset), budget);
    chunks.push(bytes.toString('utf8', offset, offset + cut));
    offset += cut;
    budget = 74; // continuation lines spend one octet on the leading space
  }
  chunks.push(bytes.toString('utf8', offset));
  return chunks.join('\r\n ');
}

/** Escape a TEXT value per RFC 5545 §3.3.11. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Europe/Copenhagen VTIMEZONE.
 *
 * The EU rule has been stable since 1996: summer time starts the last Sunday of
 * March at 01:00 UTC and ends the last Sunday of October at 01:00 UTC. Encoding
 * the rule (rather than fixed dates) keeps a booking made in 2025 valid in 2031.
 */
export function copenhagenVtimezone(): string[] {
  return [
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Copenhagen',
    'X-LIC-LOCATION:Europe/Copenhagen',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];
}

export interface IcsOptions {
  /** `PUBLISH` for a plain invitation, `REQUEST` when an attendee must RSVP. */
  method?: 'PUBLISH' | 'REQUEST';
  /** Injected for deterministic tests. */
  stamp?: Date;
  sequence?: number;
  organizerEmail: string;
  organizerName: string;
  attendeeEmail: string | null;
  attendeeName: string;
}

/** Build a complete VCALENDAR. Always CRLF-joined and folded. */
export function buildIcs(event: BookingEventDetails, options: IcsOptions): string {
  const method = options.method ?? 'PUBLISH';
  const stamp = icsUtc(options.stamp ?? new Date());
  const sequence = options.sequence ?? 0;
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Nordic Omni//Danish Voice Receptionist//DA`,
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    ...copenhagenVtimezone(),
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsUtc(event.startUtc)}`,
    `DTEND:${icsUtc(event.endUtc)}`,
    `SEQUENCE:${sequence}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    `LOCATION:${escapeIcsText(event.location)}`,
    `URL:${event.url}`,
    `ORGANIZER;CN=${escapeIcsText(options.organizerName)}:mailto:${options.organizerEmail}`,
  ];
  if (options.attendeeEmail) {
    lines.push(
      `ATTENDEE;CN=${escapeIcsText(options.attendeeName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${options.attendeeEmail}`,
    );
  }
  // A 15-minute reminder is the Danish trades default: enough time to leave.
  lines.push(
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT15M',
    `DESCRIPTION:${escapeIcsText(event.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  );
  return `${lines.map(foldContentLine).join('\r\n')}\r\n`;
}

function encodeQuery(pairs: Array<[string, string]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of pairs) params.set(key, value);
  // URLSearchParams writes `+` for spaces; calendar clients expect %20 and
  // Google/Outlook both accept it verbatim.
  return params.toString().replace(/\+/g, '%20');
}

/**
 * Google Calendar "add event" template link.
 *
 * `ctz=Europe/Copenhagen` plus floating local `dates` is what makes the event
 * land at 08:00 Danish time even for a recipient travelling abroad.
 */
export function googleCalendarUrl(event: BookingEventDetails): string {
  const start = icsUtc(event.startUtc).replace(/Z$/, '');
  const end = icsUtc(event.endUtc).replace(/Z$/, '');
  const query = encodeQuery([
    ['action', 'TEMPLATE'],
    ['text', event.title],
    ['dates', `${start}/${end}`],
    ['ctz', BOOKING_TIMEZONE],
    ['details', event.description],
    ['location', event.location],
  ]);
  return `https://calendar.google.com/calendar/render?${query}`;
}

/**
 * Outlook / Microsoft 365 web composer.
 *
 * The deeplink takes ISO-8601 UTC instants and expects `path=/calendar/action/
 * compose`, which is the shape both outlook.office.com and outlook.live.com
 * accept today.
 */
export function outlookCalendarUrl(event: BookingEventDetails): string {
  const query = encodeQuery([
    ['path', '/calendar/action/compose'],
    ['rru', 'addevent'],
    ['subject', event.title],
    ['startdt', event.startUtc.toISOString()],
    ['enddt', event.endUtc.toISOString()],
    ['body', event.description],
    ['location', event.location],
  ]);
  return `https://outlook.office.com/calendar/0/deeplink/compose?${query}`;
}

/**
 * Apple Calendar has no web composer, so the one-click path is a `data:` URI
 * carrying the .ics itself. iOS and macOS Safari hand this straight to
 * Calendar.app; the same payload is served again as a download for desktop
 * browsers that block `data:` navigation.
 */
export function appleCalendarUrl(ics: string): string {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

/** webcal:// subscription URI for an .ics feed (iPhone/Mac Calendar). */
export function webcalFeedUrl(origin: string, feedPath: string): string {
  const base = origin.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const path = feedPath.startsWith('/') ? feedPath : `/${feedPath}`;
  return `webcal://${base}${path}`;
}

/**
 * Cal.com pre-selected booking link.
 *
 * Cal.com reads `date` (YYYY-MM-DD) and the 24-hour `slot`; both are expressed
 * in the schedule's own timezone, which we pin to Copenhagen.
 */
export function calcomBookingUrl({
  calcomLink,
  localDate,
  localStart,
  attendeeName,
  attendeeEmail,
  notes,
}: {
  calcomLink: string;
  localDate: string;
  localStart: string;
  attendeeName: string;
  attendeeEmail: string | null;
  notes: string;
}): string {
  const base = calcomLink.replace(/\/$/, '');
  const params = new URLSearchParams();
  params.set('date', localDate);
  params.set('slot', localStart);
  if (attendeeName) params.set('name', attendeeName);
  if (attendeeEmail) params.set('email', attendeeEmail);
  if (notes) params.set('notes', notes);
  return `${base}?${params.toString()}`;
}

export interface BuildCalendarLinksInput {
  event: BookingEventDetails;
  /** Absolute origin, e.g. https://app.nordic-omni.dk */
  origin: string;
  feedPath: string;
  calcomLink: string;
  calcomSlot: { localDate: string; localStart: string };
  stamp?: Date;
}

/** Every invitation surface for one booking, generated from one event. */
export function buildCalendarLinks(input: BuildCalendarLinksInput): CalendarLinks {
  const { event, origin, feedPath, calcomLink, calcomSlot } = input;
  const ics = buildIcs(event, {
    method: 'REQUEST',
    stamp: input.stamp,
    organizerEmail: event.organizerEmail,
    organizerName: event.organizerName,
    attendeeEmail: event.attendeeEmail,
    attendeeName: event.attendeeName,
  });
  return {
    google: googleCalendarUrl(event),
    outlook: outlookCalendarUrl(event),
    apple: appleCalendarUrl(ics),
    calcom: calcomBookingUrl({
      calcomLink,
      localDate: calcomSlot.localDate,
      localStart: calcomSlot.localStart,
      attendeeName: event.attendeeName,
      attendeeEmail: event.attendeeEmail,
      notes: event.description,
    }),
    webcal: webcalFeedUrl(origin, feedPath),
    ics,
  };
}

/**
 * The Danish post-call SMS.
 *
 * GSM-7 safe (Danish æ/ø/å are in the GSM 03.38 basic set) and kept under 160
 * characters wherever the venue name allows, so a confirmation never splits
 * into two billable segments.
 */
export function danishBookingSms({
  venueName,
  localDateLabel,
  timeLabel,
  link,
}: {
  venueName: string;
  localDateLabel: string;
  timeLabel: string;
  link: string;
}): string {
  const head = `${venueName}: din tid er booket ${localDateLabel} kl. ${timeLabel}.`;
  const full = `${head} Tilføj til kalender: ${link}`;
  if (full.length <= 160) return full;
  return `${head} ${link}`;
}

export interface ParsedIcsEvent {
  uid: string;
  summary: string;
  location: string;
  description: string;
  startUtc: string | null;
  endUtc: string | null;
  timezone: string | null;
  hasVtimezone: boolean;
}

const unfold = (ics: string): string[] => ics.replace(/\r\n[ \t]/g, '').split(/\r\n|\n/);

const unescapeIcsText = (value: string): string =>
  value.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

function parseIcsUtc(value: string): string | null {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))).toISOString();
}

/**
 * A deliberately small VCALENDAR reader.
 *
 * This is not a general iCalendar library: it reads back the exact fields the
 * gateway emits so tests can prove round-trip fidelity (and so an imported
 * owner calendar can be sanity-checked later).
 */
export function parseIcsEvent(ics: string): ParsedIcsEvent {
  const all = unfold(ics);
  // Read only the VEVENT body: a VTIMEZONE also declares DTSTART, and picking
  // that up would silently report the 1970 daylight rule as the booking start.
  const start = all.indexOf('BEGIN:VEVENT');
  const end = all.indexOf('END:VEVENT');
  const lines = start !== -1 && end > start ? all.slice(start, end) : all;
  const field = (name: string): string => {
    const line = lines.find((candidate) => candidate.startsWith(`${name}:`) || candidate.startsWith(`${name};`));
    if (!line) return '';
    const colon = line.indexOf(':');
    return colon === -1 ? '' : line.slice(colon + 1);
  };
  // TZID is declared by the VTIMEZONE block, which sits outside the VEVENT.
  const timezoneLine = all.find((line) => line.startsWith('TZID:'));
  return {
    uid: field('UID'),
    summary: unescapeIcsText(field('SUMMARY')),
    location: unescapeIcsText(field('LOCATION')),
    description: unescapeIcsText(field('DESCRIPTION')),
    startUtc: parseIcsUtc(field('DTSTART')),
    endUtc: parseIcsUtc(field('DTEND')),
    timezone: timezoneLine ? timezoneLine.slice('TZID:'.length) : null,
    hasVtimezone: all.includes('BEGIN:VTIMEZONE'),
  };
}

/** Minutes between two instants, rounded to the nearest minute. */
export function minutesBetween(startUtc: Date, endUtc: Date): number {
  return Math.round((endUtc.getTime() - startUtc.getTime()) / MS_PER_MINUTE);
}

export type { ZonedWallClock };
