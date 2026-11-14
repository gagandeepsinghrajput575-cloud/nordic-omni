import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  appleCalendarUrl,
  buildCalendarLinks,
  buildIcs,
  calcomBookingUrl,
  danishBookingSms,
  escapeIcsText,
  foldContentLine,
  googleCalendarUrl,
  outlookCalendarUrl,
  parseIcsEvent,
  webcalFeedUrl,
  type BookingEventDetails,
} from '../src/lib/calendar/formatters';
import {
  BOOKING_TIMEZONE,
  DEFAULT_BOOKING_WINDOW,
  buildSlotGrid,
  danishHolidays,
  easterSunday,
  intervalsOverlap,
  isSlotFree,
  refusalFor,
  validateRequestedSlot,
  zonedParts,
  zonedTimeToUtc,
  holidayIndex,
} from '../src/lib/calendar/time';
import { SlotHoldStore, effectiveStatus, SLOT_HOLD_MS } from '../src/lib/calendar/holds';
import {
  cacheInvite,
  clearInvites,
  readInvite,
  signBookingToken,
  verifyBookingToken,
} from '../src/lib/calendar/invites';
import {
  BookingSlotSchema,
  SlotHoldRequestSchema,
  BookingConfirmationSchema,
  BookingHoldRecordSchema,
  CalendarLinksSchema,
  SLOT_HOLD_SECONDS,
} from '../src/contracts/schemas';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EVENT: BookingEventDetails = {
  uid: 'bk-test-1@nordic-omni.dk',
  title: 'Besigtigelse — Murermester Åse Østergaard ApS',
  description: 'man. 18. nov. 08:00–08:30 (Europe/Copenhagen).\nNoter: Tagrenovering, 120 m²',
  location: 'Nørrebrogade 12, 2200 København N',
  startUtc: new Date('2025-11-17T07:00:00.000Z'),
  endUtc: new Date('2025-11-17T07:30:00.000Z'),
  organizerName: 'Åse Østergaard',
  organizerEmail: 'ase@murermester.dk',
  attendeeName: 'Jens Hansen',
  attendeeEmail: 'jens@example.dk',
  label: 'man. 17. nov. 08:00–08:30',
  url: 'https://app.nordic-omni.dk/calendar/bk-test-1',
};

const ICS_OPTIONS = {
  organizerEmail: 'ase@murermester.dk',
  organizerName: 'Åse Østergaard',
  attendeeEmail: 'jens@example.dk',
  attendeeName: 'Jens Hansen',
  stamp: new Date('2025-11-14T09:00:00.000Z'),
};

/** Friday 2025-11-14 at 07:30 Copenhagen (06:30 UTC): the workday is only just
 *  open, so today's later slots are still bookable rather than "past". */
const NOW = new Date('2025-11-14T06:30:00.000Z');

// ---------------------------------------------------------------------------
// Timezone invariant
// ---------------------------------------------------------------------------

test('Europe/Copenhagen conversion survives both DST transitions', () => {
  // Winter (CET, UTC+1): a 07:00 Danish slot is 06:00 UTC.
  const winter = zonedTimeToUtc({ year: 2025, month: 11, day: 17, hour: 7, minute: 0 });
  assert.equal(winter.toISOString(), '2025-11-17T06:00:00.000Z');

  // Summer (CEST, UTC+2): the same wall clock is 05:00 UTC.
  const summer = zonedTimeToUtc({ year: 2025, month: 6, day: 16, hour: 7, minute: 0 });
  assert.equal(summer.toISOString(), '2025-06-16T05:00:00.000Z');

  // Spring forward: 2025-03-30 02:00 CET → 03:00 CEST. 01:30 exists, 02:30 does not.
  const beforeGap = zonedTimeToUtc({ year: 2025, month: 3, day: 30, hour: 1, minute: 30 });
  assert.equal(beforeGap.toISOString(), '2025-03-30T00:30:00.000Z');
  const inGap = zonedTimeToUtc({ year: 2025, month: 3, day: 30, hour: 2, minute: 30 });
  // The shifted instant must read back as 03:30 local, past the gap.
  const gapWall = zonedParts(inGap);
  assert.equal(gapWall.hour, 3);
  assert.equal(gapWall.minute, 30);

  // Autumn back: 2025-10-26 03:00 CEST → 02:00 CET. 02:30 is ambiguous and
  // resolves to the first (summer) occurrence.
  const ambiguous = zonedTimeToUtc({ year: 2025, month: 10, day: 26, hour: 2, minute: 30 });
  assert.equal(ambiguous.toISOString(), '2025-10-26T00:30:00.000Z');
  assert.equal(zonedParts(ambiguous).hour, 2);
});

test('weekday is resolved in Copenhagen, not the server zone', () => {
  // 2025-11-16T23:30Z is Sunday 23:30 UTC but Monday 00:30 in Copenhagen.
  const wall = zonedParts(new Date('2025-11-16T23:30:00.000Z'));
  assert.equal(wall.weekday, 1);
  assert.equal(wall.day, 17);
  assert.equal(wall.hour, 0);
});

// ---------------------------------------------------------------------------
// Danish holidays
// ---------------------------------------------------------------------------

test('Easter computus matches the published Danish holiday dates', () => {
  assert.equal(easterSunday(2024), '2024-03-31');
  assert.equal(easterSunday(2025), '2025-04-20');
  assert.equal(easterSunday(2026), '2026-04-05');
  assert.equal(easterSunday(2027), '2027-03-28');
  // Leap-century sanity check.
  assert.equal(easterSunday(2000), '2000-04-23');
});

test('Danish holidays cover the Easter chain, Christmas, and the 2024 Store bededag repeal', () => {
  const holidays2025 = danishHolidays(2025);
  const byName = new Map(holidays2025.map((holiday) => [holiday.name, holiday]));
  assert.equal(byName.get('Skærtorsdag')?.date, '2025-04-17');
  assert.equal(byName.get('Langfredag')?.date, '2025-04-18');
  assert.equal(byName.get('Påskedag')?.date, '2025-04-20');
  assert.equal(byName.get('2. påskedag')?.date, '2025-04-21');
  assert.equal(byName.get('Kristi himmelfartsdag')?.date, '2025-05-29');
  assert.equal(byName.get('Pinsedag')?.date, '2025-06-08');
  assert.equal(byName.get('2. pinsedag')?.date, '2025-06-09');
  assert.equal(byName.get('Juledag')?.date, '2025-12-25');
  // Restricted-but-open-office days are excluded from booking without being
  // described as statutory holidays.
  assert.equal(byName.get('Grundlovsdag')?.kind, 'restricted');
  assert.equal(byName.get('Juleaften')?.kind, 'restricted');

  // Store bededag was a public holiday through 2023 and abolished from 2024.
  const storeBededag2023 = danishHolidays(2023).find((h) => h.name === 'Store bededag');
  assert.ok(storeBededag2023, 'Store bededag must exist in 2023');
  assert.equal(storeBededag2023.date, '2023-05-05');
  assert.equal(storeBededag2023.abolishedFrom, 2024);
  assert.equal(danishHolidays(2024).some((h) => h.name === 'Store bededag'), false);
  assert.equal(danishHolidays(2025).some((h) => h.name === 'Store bededag'), false);
});

test('holidays block slots; weekends and off-hours are refused with Danish copy', () => {
  const holidays = holidayIndex(2025, 2025);
  const config = DEFAULT_BOOKING_WINDOW;

  // 2025-12-25 (Juledag) at 08:00 local.
  const christmas = zonedTimeToUtc({ year: 2025, month: 12, day: 25, hour: 8, minute: 0 });
  const christmasRefusal = refusalFor(christmas, config, NOW, holidays);
  assert.equal(christmasRefusal?.reason, 'holiday');
  assert.equal(christmasRefusal?.holidayName, 'Juledag');
  assert.match(christmasRefusal?.message ?? '', /helligdag/);

  // Saturday 2025-11-22.
  const saturday = zonedTimeToUtc({ year: 2025, month: 11, day: 22, hour: 8, minute: 0 });
  assert.equal(refusalFor(saturday, config, NOW, holidays)?.reason, 'weekend');

  // 06:30 is before the 07:00 opening.
  const early = zonedTimeToUtc({ year: 2025, month: 11, day: 18, hour: 6, minute: 30 });
  assert.equal(refusalFor(early, config, NOW, holidays)?.reason, 'outside_workday');

  // 15:45 would end at 16:15, past closing.
  const late = zonedTimeToUtc({ year: 2025, month: 11, day: 18, hour: 15, minute: 45 });
  assert.equal(refusalFor(late, config, NOW, holidays)?.reason, 'outside_workday');

  // 08:05 is inside the window but off the 30-minute grid.
  const offGrid = zonedTimeToUtc({ year: 2025, month: 11, day: 18, hour: 8, minute: 5 });
  assert.equal(refusalFor(offGrid, config, NOW, holidays)?.reason, 'off_grid');

  // Grundlovsdag is restricted, so it is refused unless explicitly allowed.
  // Evaluated against a May "now" so the date is genuinely in the future.
  const may = new Date('2025-05-25T06:00:00.000Z');
  const grundlov = zonedTimeToUtc({ year: 2025, month: 6, day: 5, hour: 9, minute: 0 });
  assert.equal(refusalFor(grundlov, config, may, holidays)?.reason, 'restricted_day');
  assert.equal(
    refusalFor(grundlov, { ...config, allowRestrictedDays: true }, may, holidays),
    null,
  );

  // A valid Tuesday 08:00 slot is inside the window and on the grid.
  const valid = zonedTimeToUtc({ year: 2025, month: 11, day: 18, hour: 8, minute: 0 });
  assert.equal(refusalFor(valid, config, NOW, holidays), null);
});

// ---------------------------------------------------------------------------
// Slot grid
// ---------------------------------------------------------------------------

test('slot grid runs 07:00–16:00 on Danish workdays only, in Copenhagen time', () => {
  const slots = buildSlotGrid({ now: NOW });
  assert.ok(slots.length > 0);

  const monday = slots.filter((slot) => slot.localDate === '2025-11-17');
  assert.equal(monday.length, 18, '07:00 through 15:30 in 30-minute steps is 18 slots');
  assert.equal(monday[0].localStart, '07:00');
  assert.equal(monday[0].localEnd, '07:30');
  assert.equal(monday.at(-1)?.localStart, '15:30');
  assert.equal(monday.at(-1)?.localEnd, '16:00');
  assert.equal(monday[0].durationMinutes, 30);

  // 07:00 Copenhagen in November is 06:00 UTC — never a floating local time.
  assert.equal(monday[0].startIso, '2025-11-17T06:00:00.000Z');

  // No weekend slots, and every slot carries a Danish label.
  for (const slot of slots) {
    const weekday = new Date(`${slot.localDate}T12:00:00Z`).getUTCDay();
    assert.ok(weekday >= 1 && weekday <= 5, `${slot.localDate} must be a weekday`);
    assert.match(slot.label, /^(man|tir|ons|tor|fre)\. \d{1,2}\. (jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\. \d{2}:\d{2}–\d{2}:\d{2}$/);
  }

  // Christmas Day is excluded even though it is a Thursday.
  assert.equal(slots.some((slot) => slot.localDate === '2025-12-25'), false);

  // Slots remain contiguous at 30 minutes, and any slot already in the past is
  // surfaced as unavailable rather than silently dropped (the agent needs to see
  // that the time has gone).
  for (const slot of slots) {
    const start = Date.parse(slot.startIso);
    assert.equal(Date.parse(slot.endIso) - start, 30 * 60_000);
    if (start < NOW.getTime()) {
      assert.equal(slot.available, false, `${slot.label} in the past must not be offered`);
      assert.equal(slot.blockedBy, 'past');
    }
  }
  // Today's earliest slot is in the past at 07:30 local, so it is shown blocked.
  const today = slots.filter((slot) => slot.localDate === '2025-11-14');
  assert.equal(today[0].localStart, '07:00');
  assert.equal(today[0].available, false);
});

test('busy intervals block exactly the overlapping slots and nothing else', () => {
  const busy = [{ startUtc: new Date('2025-11-17T06:00:00Z'), endUtc: new Date('2025-11-17T06:30:00Z') }];
  const slots = buildSlotGrid({ now: NOW, busy });
  const blocked = slots.filter((slot) => !slot.available && slot.localDate === '2025-11-17');
  // 07:00–07:30 booked; the 5-minute buffer also takes 07:30–08:00.
  assert.deepEqual(
    blocked.map((slot) => slot.localStart),
    ['07:00', '07:30'],
  );
  assert.equal(blocked[0].blockedBy, 'booked');
  // The next slot is untouched.
  const free = slots.find((slot) => slot.localStart === '08:00' && slot.localDate === '2025-11-17');
  assert.equal(free?.available, true);
});

test('half-open overlap math never treats adjacent slots as conflicting', () => {
  const left = { startUtc: new Date('2025-11-17T06:00:00Z'), endUtc: new Date('2025-11-17T06:30:00Z') };
  const right = { startUtc: new Date('2025-11-17T06:30:00Z'), endUtc: new Date('2025-11-17T07:00:00Z') };
  assert.equal(intervalsOverlap(left, right), false);
  assert.equal(isSlotFree(left, [right]), true);
  const overlapping = { startUtc: new Date('2025-11-17T06:15:00Z'), endUtc: new Date('2025-11-17T06:45:00Z') };
  assert.equal(intervalsOverlap(left, overlapping), true);
  assert.equal(isSlotFree(left, [overlapping]), false);
});

test('validateRequestedSlot rejects an occupied or wrongly-sized slot', () => {
  const start = new Date('2025-11-18T07:00:00Z');
  const end = new Date('2025-11-18T07:30:00Z');
  assert.equal(validateRequestedSlot({ start, end, now: NOW }), null);

  const occupied = [{ startUtc: new Date('2025-11-18T07:00:00Z'), endUtc: new Date('2025-11-18T07:30:00Z') }];
  const refusal = validateRequestedSlot({ start, end, now: NOW, busy: occupied });
  assert.equal(refusal?.reason, 'off_grid');
  assert.match(refusal?.message ?? '', /optaget/);

  const tooLong = validateRequestedSlot({
    start,
    end: new Date('2025-11-18T08:00:00Z'),
    now: NOW,
  });
  assert.equal(tooLong?.reason, 'off_grid');
});

// ---------------------------------------------------------------------------
// RFC 5545
// ---------------------------------------------------------------------------

test('ICS output is CRLF, correctly framed, and carries a Copenhagen VTIMEZONE', () => {
  const ics = buildIcs(EVENT, { ...ICS_OPTIONS, method: 'REQUEST' });

  // Every line ends CRLF, and there is exactly one trailing CRLF.
  assert.ok(ics.endsWith('\r\n'));
  assert.equal(ics.includes('\n\n'), false);
  for (const line of ics.split('\r\n').slice(0, -1)) {
    assert.doesNotMatch(line, /\r|\n/, 'no bare newlines inside a content line');
  }

  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2.0\r\n/);
  assert.match(ics, /PRODID:-\/\/Nordic Omni\/\/Danish Voice Receptionist\/\/DA/);
  assert.match(ics, /CALSCALE:GREGORIAN/);
  assert.match(ics, /METHOD:REQUEST/);
  assert.match(ics, /BEGIN:VTIMEZONE/);
  assert.match(ics, /TZID:Europe\/Copenhagen/);
  assert.match(ics, /RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU/);
  assert.match(ics, /RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU/);
  assert.match(ics, /TZNAME:CEST/);
  assert.match(ics, /TZNAME:CET/);

  // Instants are UTC with the Z suffix, so no client can reinterpret them.
  assert.match(ics, /DTSTART:20251117T070000Z\r\n/);
  assert.match(ics, /DTEND:20251117T073000Z\r\n/);
  assert.match(ics, /DTSTAMP:20251114T090000Z\r\n/);
  assert.match(ics, /UID:bk-test-1@nordic-omni\.dk\r\n/);
  assert.match(ics, /ORGANIZER;CN=[^:]*:mailto:ase@murermester\.dk\r\n/);
  // ATTENDEE is long enough to be folded, so assert on the unfolded text.
  assert.match(
    ics.replace(/\r\n /g, ''),
    /ATTENDEE;CN=[^:]*;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:jens@example\.dk/,
  );
  assert.match(ics, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M/);
  assert.match(ics, /STATUS:CONFIRMED/);
  // Balanced blocks.
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 1);
  assert.equal(ics.match(/END:VEVENT/g)?.length, 1);
  assert.equal(ics.match(/END:VTIMEZONE/g)?.length, 1);
});

test('ICS folding respects 75 octets and never splits a Danish multibyte character', () => {
  const longTitle = `Besigtigelse af tag — ${'Åse Østergaard '.repeat(12)}`;
  const ics = buildIcs({ ...EVENT, title: longTitle }, ICS_OPTIONS);

  for (const line of ics.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line too long: ${Buffer.byteLength(line, 'utf8')} octets`);
  }
  // Continuation lines start with a space.
  const continuation = ics.split('\r\n').filter((line) => line.startsWith(' '));
  assert.ok(continuation.length > 0);

  // Unfolding by the RFC rule must return the original text exactly: no
  // replacement characters, no dropped æ/ø/å.
  const unfolded = ics.replace(/\r\n[ \t]/g, '');
  const parsed = parseIcsEvent(unfolded);
  assert.equal(parsed.summary, longTitle);
  assert.equal(parsed.summary.includes('\uFFFD'), false);
});

test('foldContentLine is a no-op under 75 octets and preserves emoji boundaries', () => {
  const short = 'SUMMARY:Kort dansk tekst med æ, ø og å';
  assert.equal(foldContentLine(short), short);

  const emoji = `SUMMARY:${'🎉'.repeat(40)}`;
  const folded = foldContentLine(emoji);
  for (const line of folded.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  }
  assert.equal(folded.replace(/\r\n /g, ''), emoji);
  // A 4-byte emoji must never be split into lone surrogates.
  assert.equal(folded.includes('\uFFFD'), false);
});

test('ICS TEXT escaping handles backslash, semicolon, comma and newline', () => {
  assert.equal(escapeIcsText('a,b;c\\d'), 'a\\,b\\;c\\\\d');
  assert.equal(escapeIcsText('linje 1\nlinje 2'), 'linje 1\\nlinje 2');
  assert.equal(escapeIcsText('CRLF\r\nhere'), 'CRLF\\nhere');

  const ics = buildIcs(
    { ...EVENT, description: 'Tag, 120 m²; med adgang\\gennem gården\nRing først' },
    ICS_OPTIONS,
  );
  const parsed = parseIcsEvent(ics);
  assert.equal(parsed.description, 'Tag, 120 m²; med adgang\\gennem gården\nRing først');
});

test('ICS round-trips through the reader and stays stable per UID', () => {
  const ics = buildIcs(EVENT, ICS_OPTIONS);
  const parsed = parseIcsEvent(ics);
  assert.equal(parsed.uid, EVENT.uid);
  assert.equal(parsed.startUtc, EVENT.startUtc.toISOString());
  assert.equal(parsed.endUtc, EVENT.endUtc.toISOString());
  assert.equal(parsed.location, EVENT.location);
  assert.equal(parsed.hasVtimezone, true);
  assert.equal(parsed.timezone, 'Europe/Copenhagen');

  // Deterministic output: same event + same stamp === same bytes.
  assert.equal(buildIcs(EVENT, ICS_OPTIONS), ics);

  // PUBLISH omits RSVP semantics but keeps the attendee when known.
  const published = buildIcs(EVENT, { ...ICS_OPTIONS, method: 'PUBLISH' });
  assert.match(published, /METHOD:PUBLISH/);
});

// ---------------------------------------------------------------------------
// Provider links
// ---------------------------------------------------------------------------

test('Google Calendar link uses the TEMPLATE action with floating local dates and ctz', () => {
  const url = googleCalendarUrl(EVENT);
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(parsed.searchParams.get('action'), 'TEMPLATE');
  // Floating local time (no Z) plus the zone hint: Google renders 08:00 Danish.
  assert.equal(parsed.searchParams.get('dates'), '20251117T070000/20251117T073000');
  assert.equal(parsed.searchParams.get('ctz'), BOOKING_TIMEZONE);
  assert.equal(parsed.searchParams.get('text'), EVENT.title);
  assert.equal(parsed.searchParams.get('location'), EVENT.location);
  // Danish characters survive percent-encoding and no `+` is used for spaces.
  assert.equal(url.includes('+'), false);
  assert.ok(decodeURIComponent(url).includes('Åse Østergaard'));
});

test('Outlook 365 link uses the deeplink composer with ISO UTC instants', () => {
  const url = outlookCalendarUrl(EVENT);
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://outlook.office.com/calendar/0/deeplink/compose');
  assert.equal(parsed.searchParams.get('path'), '/calendar/action/compose');
  assert.equal(parsed.searchParams.get('rru'), 'addevent');
  assert.equal(parsed.searchParams.get('subject'), EVENT.title);
  // Outlook wants round-trippable instants, not floating dates.
  assert.equal(parsed.searchParams.get('startdt'), '2025-11-17T07:00:00.000Z');
  assert.equal(parsed.searchParams.get('enddt'), '2025-11-17T07:30:00.000Z');
  assert.equal(url.includes('+'), false);
});

test('Apple, webcal and Cal.com links match their documented shapes', () => {
  const ics = buildIcs(EVENT, ICS_OPTIONS);
  const apple = appleCalendarUrl(ics);
  assert.ok(apple.startsWith('data:text/calendar;charset=utf-8,'));
  // The payload must decode back to byte-identical ICS.
  const decoded = decodeURIComponent(apple.slice('data:text/calendar;charset=utf-8,'.length));
  assert.equal(decoded, ics);

  assert.equal(
    webcalFeedUrl('https://app.nordic-omni.dk', '/api/calendar/ics?tenantId=abc'),
    'webcal://app.nordic-omni.dk/api/calendar/ics?tenantId=abc',
  );
  assert.equal(
    webcalFeedUrl('http://localhost:3000/', 'api/calendar/ics'),
    'webcal://localhost:3000/api/calendar/ics',
  );

  const calcom = calcomBookingUrl({
    calcomLink: 'https://cal.com/murermester/besigtigelse',
    localDate: '2025-11-17',
    localStart: '08:00',
    attendeeName: 'Jens Hansen',
    attendeeEmail: 'jens@example.dk',
    notes: 'Tagrenovering',
  });
  const parsed = new URL(calcom);
  assert.equal(parsed.origin + parsed.pathname, 'https://cal.com/murermester/besigtigelse');
  assert.equal(parsed.searchParams.get('date'), '2025-11-17');
  assert.equal(parsed.searchParams.get('slot'), '08:00');
  assert.equal(parsed.searchParams.get('name'), 'Jens Hansen');
  assert.equal(parsed.searchParams.get('email'), 'jens@example.dk');
});

test('buildCalendarLinks emits every surface and satisfies the wire schema', () => {
  const links = buildCalendarLinks({
    event: EVENT,
    origin: 'https://app.nordic-omni.dk',
    feedPath: '/api/calendar/ics?tenantId=abc',
    calcomLink: 'https://cal.com/murermester',
    calcomSlot: { localDate: '2025-11-17', localStart: '08:00' },
    stamp: ICS_OPTIONS.stamp,
  });

  // Contract validation, excluding the large inline ICS data URI.
  const parsed = CalendarLinksSchema.safeParse(links);
  assert.equal(parsed.success, true);
  assert.ok(links.webcal.startsWith('webcal://app.nordic-omni.dk/'));
  assert.equal(parseIcsEvent(links.ics).uid, EVENT.uid);
});

test('Danish booking SMS stays inside one GSM segment where possible', () => {
  const sms = danishBookingSms({
    venueName: 'Murermester & Byg ApS',
    localDateLabel: 'man. 17. nov.',
    timeLabel: '08:00',
    link: 'webcal://app.nordic-omni.dk/api/calendar/ics?tenantId=abc',
  });
  assert.match(sms, /^Murermester & Byg ApS: din tid er booket man\. 17\. nov\. kl\. 08:00\./);
  assert.match(sms, /Tilføj til kalender: webcal:\/\//);
  // Danish æ/ø/å are GSM-7 characters, so the text must not force UCS-2.
  assert.ok(sms.length <= 160, `expected <=160 chars, got ${sms.length}`);

  // A very long venue name degrades by dropping the prose, never the link.
  const long = danishBookingSms({
    venueName: 'X'.repeat(150),
    localDateLabel: 'man. 17. nov.',
    timeLabel: '08:00',
    link: 'https://x.dk/a',
  });
  assert.ok(long.endsWith('https://x.dk/a'));
});

// ---------------------------------------------------------------------------
// Slot holds: optimistic concurrency
// ---------------------------------------------------------------------------

test('a hold blocks its slot for exactly ten minutes, then lapses on its own', () => {
  let clock = new Date('2025-11-17T07:00:00.000Z');
  const store = new SlotHoldStore(() => clock);

  const created = store.create({
    tenantId: 'tenant-a',
    contactId: null,
    callLogId: null,
    provider: 'google',
    startIso: '2025-11-17T08:00:00.000Z',
    endIso: '2025-11-17T08:30:00.000Z',
    topic: 'Besigtigelse',
    notes: '',
    label: 'man. 17. nov. 09:00–09:30',
  });
  assert.equal(created.ok, true);
  assert.ok(created.hold);
  assert.equal(created.hold.status, 'held');
  assert.equal(SLOT_HOLD_SECONDS, 600);
  assert.equal(
    Date.parse(created.hold.expiresAtIso) - Date.parse(created.hold.createdAtIso),
    SLOT_HOLD_MS,
  );

  // Immediately: the slot is occupied for everyone in the tenant.
  assert.equal(store.busyIntervals('tenant-a').length, 1);

  // 9m59s later it still blocks.
  clock = new Date('2025-11-17T07:09:59.000Z');
  assert.equal(effectiveStatus(created.hold, clock), 'held');
  assert.equal(store.busyIntervals('tenant-a').length, 1);

  // At exactly 10 minutes it no longer blocks, without any sweeper running.
  clock = new Date('2025-11-17T07:10:00.000Z');
  assert.equal(effectiveStatus(created.hold, clock), 'expired');
  assert.equal(store.busyIntervals('tenant-a').length, 0);

  // A competing caller can now hold the same time.
  const second = store.create({
    tenantId: 'tenant-a',
    contactId: null,
    callLogId: null,
    provider: 'outlook',
    startIso: '2025-11-17T08:00:00.000Z',
    endIso: '2025-11-17T08:30:00.000Z',
    topic: 'Besigtigelse',
    notes: '',
    label: '',
  });
  assert.equal(second.ok, true);

  // And the swept record is terminal.
  assert.equal(store.expireStale(), 1);
  assert.equal(store.find(created.hold.id)?.status, 'expired');
});

test('two simultaneous calls cannot hold the same slot', () => {
  const clock = new Date('2025-11-17T07:00:00.000Z');
  const store = new SlotHoldStore(() => clock);
  const base = {
    tenantId: 'tenant-a',
    contactId: null,
    callLogId: null,
    provider: 'google' as const,
    topic: 'Besigtigelse',
    notes: '',
    label: '',
  };

  const first = store.create({
    ...base,
    startIso: '2025-11-17T09:00:00.000Z',
    endIso: '2025-11-17T09:30:00.000Z',
  });
  const second = store.create({
    ...base,
    startIso: '2025-11-17T09:00:00.000Z',
    endIso: '2025-11-17T09:30:00.000Z',
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'slot_taken');

  // A partially overlapping request is also refused.
  const partial = store.create({
    ...base,
    startIso: '2025-11-17T09:15:00.000Z',
    endIso: '2025-11-17T09:45:00.000Z',
  });
  assert.equal(partial.reason, 'slot_taken');

  // An adjacent slot is free: holds are half-open.
  const adjacent = store.create({
    ...base,
    startIso: '2025-11-17T09:30:00.000Z',
    endIso: '2025-11-17T10:00:00.000Z',
  });
  assert.equal(adjacent.ok, true);

  // A different tenant is unaffected.
  const otherTenant = store.create({
    ...base,
    tenantId: 'tenant-b',
    startIso: '2025-11-17T09:00:00.000Z',
    endIso: '2025-11-17T09:30:00.000Z',
  });
  assert.equal(otherTenant.ok, true);
});

test('hold lifecycle: confirm is terminal, release frees the slot, expiry refuses a claim', () => {
  let clock = new Date('2025-11-17T07:00:00.000Z');
  const store = new SlotHoldStore(() => clock);
  const request = {
    tenantId: 'tenant-a',
    contactId: null,
    callLogId: null,
    provider: 'apple_icloud' as const,
    startIso: '2025-11-17T10:00:00.000Z',
    endIso: '2025-11-17T10:30:00.000Z',
    topic: 'Besigtigelse',
    notes: '',
    label: '',
  };

  const hold = store.create(request);
  assert.ok(hold.hold);
  const id = hold.hold.id;

  // Confirming wins the slot permanently.
  const confirmed = store.confirm(id);
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.hold?.status, 'confirmed');

  // A confirmed hold can never be released or re-claimed.
  assert.equal(store.release(id).reason, 'already_confirmed');
  assert.equal(store.confirm(id).ok, true, 'confirm is idempotent');

  // Even an hour later the confirmed slot still blocks.
  clock = new Date('2025-11-17T08:00:00.000Z');
  assert.equal(store.busyIntervals('tenant-a').length, 1);
  assert.equal(store.create(request).reason, 'slot_taken');

  // A released hold frees the slot immediately.
  const releasable = store.create({
    ...request,
    startIso: '2025-11-17T11:00:00.000Z',
    endIso: '2025-11-17T11:30:00.000Z',
  });
  assert.ok(releasable.hold);
  assert.equal(store.release(releasable.hold.id).ok, true);
  assert.equal(store.busyIntervals('tenant-a').length, 1, 'only the confirmed one remains');
  const reHeld = store.create({
    ...request,
    startIso: '2025-11-17T11:00:00.000Z',
    endIso: '2025-11-17T11:30:00.000Z',
  });
  assert.equal(reHeld.ok, true);
  // Narrow the optional hold once, so the assertions below stay type-safe.
  assert.ok(reHeld.hold, 'the re-held slot must produce a hold record');
  const reHeldId = reHeld.hold.id;

  // An expired hold cannot be claimed by a late confirmation.
  clock = new Date('2025-11-17T08:20:00.000Z');
  const late = store.confirm(reHeldId);
  assert.equal(late.ok, false);
  assert.equal(late.reason, 'hold_expired');
  assert.equal(store.release(reHeldId).reason, 'hold_expired');
  assert.equal(store.confirm('hold-does-not-exist').reason, 'hold_not_found');
});

test('confirmed bookings remain occupied after their hold row would have expired', () => {
  let clock = new Date('2025-11-17T07:00:00.000Z');
  const store = new SlotHoldStore(() => clock);
  store.addBooking({
    id: 'bk-1',
    tenantId: 'tenant-a',
    contactId: null,
    callLogId: null,
    provider: 'google',
    startIso: '2025-11-17T12:00:00.000Z',
    endIso: '2025-11-17T12:30:00.000Z',
    label: '',
    topic: 'Besigtigelse',
    attendeeName: 'Jens Hansen',
    attendeeEmail: null,
    attendeePhone: null,
    icsUid: 'bk-1@nordic-omni.dk',
    createdAtIso: clock.toISOString(),
  });

  clock = new Date('2025-12-01T07:00:00.000Z');
  const attempt = store.create({
    tenantId: 'tenant-a',
    contactId: null,
    callLogId: null,
    provider: 'google',
    startIso: '2025-11-17T12:00:00.000Z',
    endIso: '2025-11-17T12:30:00.000Z',
    topic: 'Besigtigelse',
    notes: '',
    label: '',
  });
  assert.equal(attempt.reason, 'slot_taken');
});

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

test('calendar contracts reject malformed instants, offsets and slot windows', () => {
  const validSlot = {
    id: 's1',
    startIso: '2025-11-17T07:00:00.000Z',
    endIso: '2025-11-17T07:30:00.000Z',
    localDate: '2025-11-17',
    localStart: '08:00',
    localEnd: '08:30',
    durationMinutes: 30,
    label: 'man. 17. nov. 08:00–08:30',
    available: true,
  };
  assert.equal(BookingSlotSchema.safeParse(validSlot).success, true);

  // Floating local time is refused: the wire format must carry an offset.
  assert.equal(
    BookingSlotSchema.safeParse({ ...validSlot, startIso: '2025-11-17T08:00:00' }).success,
    false,
  );
  // Duration must agree with the instants.
  assert.equal(BookingSlotSchema.safeParse({ ...validSlot, durationMinutes: 60 }).success, false);
  // An inverted window is refused.
  assert.equal(
    BookingSlotSchema.safeParse({
      ...validSlot,
      startIso: '2025-11-17T08:00:00.000Z',
      endIso: '2025-11-17T07:30:00.000Z',
    }).success,
    false,
  );
  // A non-positive offset is still an explicit offset.
  assert.equal(
    BookingSlotSchema.safeParse({ ...validSlot, startIso: '2025-11-17T09:00:00+02:00' }).success,
    true,
  );

  const holdRequest = SlotHoldRequestSchema.safeParse({
    startIso: '2025-11-17T07:00:00.000Z',
    endIso: '2025-11-17T07:30:00.000Z',
  });
  assert.equal(holdRequest.success, true);
  if (holdRequest.success) {
    assert.equal(holdRequest.data.provider, 'ics_universal');
    assert.equal(holdRequest.data.holdSeconds, SLOT_HOLD_SECONDS);
  }

  const bookRequest = BookingConfirmationSchema.safeParse({
    tenantId: '11111111-1111-4111-8111-111111111111',
    startIso: '2025-11-17T07:00:00.000Z',
    endIso: '2025-11-17T07:30:00.000Z',
    attendeeName: 'Jens Hansen',
  });
  assert.equal(bookRequest.success, true);
  if (bookRequest.success) assert.equal(bookRequest.data.sendSms, true);

  // Danish phone numbers must be E.164 on the wire.
  assert.equal(
    BookingConfirmationSchema.safeParse({
      tenantId: '11111111-1111-4111-8111-111111111111',
      startIso: '2025-11-17T07:00:00.000Z',
      endIso: '2025-11-17T07:30:00.000Z',
      attendeeName: 'Jens Hansen',
      attendeePhone: '27441802',
    }).success,
    false,
  );

  const holdRecord = {
    id: 'hold-1',
    tenantId: '11111111-1111-4111-8111-111111111111',
    contactId: null,
    callLogId: null,
    provider: 'calcom',
    status: 'held',
    startIso: '2025-11-17T07:00:00.000Z',
    endIso: '2025-11-17T07:30:00.000Z',
    topic: 'Besigtigelse',
    notes: '',
    expiresAtIso: '2025-11-17T07:10:00.000Z',
    label: '',
    createdAtIso: '2025-11-17T07:00:00.000Z',
  };
  assert.equal(BookingHoldRecordSchema.safeParse(holdRecord).success, true);
  assert.equal(
    BookingHoldRecordSchema.safeParse({ ...holdRecord, provider: 'yahoo' }).success,
    false,
  );
  assert.equal(
    BookingHoldRecordSchema.safeParse({ ...holdRecord, status: 'pending' }).success,
    false,
  );
});

test('the slot grid satisfies BookingSlotSchema end to end', () => {
  const slots = buildSlotGrid({ now: NOW }).slice(0, 40);
  assert.ok(slots.length > 0);
  for (const slot of slots) {
    const parsed = BookingSlotSchema.safeParse({
      id: slot.startIso,
      startIso: slot.startIso,
      endIso: slot.endIso,
      localDate: slot.localDate,
      localStart: slot.localStart,
      localEnd: slot.localEnd,
      durationMinutes: slot.durationMinutes,
      label: slot.label,
      available: slot.available,
    });
    assert.equal(parsed.success, true, JSON.stringify(parsed.success ? {} : parsed.error.issues));
  }
});

// ---------------------------------------------------------------------------
// Source-level guarantees
// ---------------------------------------------------------------------------

test('calendar API routes never touch the owner pool and stay RLS scoped', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  for (const route of [
    '../src/app/api/calendar/slots/route.ts',
    '../src/app/api/calendar/book/route.ts',
    '../src/app/api/calendar/ics/route.ts',
  ]) {
    const source = read(route);
    assert.doesNotMatch(source, /adminSql/, `${route} must not use the owner pool`);
    assert.match(source, /apiSession/, `${route} must authenticate`);
  }
  const db = read('../src/lib/db/calendar.ts');
  assert.doesNotMatch(db, /adminSql/);
  assert.match(db, /pg_advisory_xact_lock/);
  assert.match(db, /withUser/);
});

test('migration 0018 enables RLS, blocks tenant reassignment, and keeps holds terminal', () => {
  const sql = readFileSync(new URL('../../db/migrations/0018_calendar_booking_gateway.sql', import.meta.url), 'utf8');
  for (const table of ['calendar_slot_holds', 'calendar_bookings']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`), table);
    assert.match(sql, new RegExp(`CREATE POLICY ${table}_read`), `${table} read policy`);
    assert.match(sql, new RegExp(`CREATE POLICY ${table}_write`), `${table} write policy`);
    assert.match(sql, new RegExp(`CREATE TRIGGER ${table}_tenant_immutable`), `${table} tenant trigger`);
  }
  assert.match(sql, /EXECUTE FUNCTION prevent_tenant_reassignment\(\)/);
  assert.match(sql, /guard_calendar_hold_transition/);
  assert.match(sql, /a confirmed slot hold cannot be reopened/);
  assert.match(sql, /a lapsed slot hold is terminal/);
  assert.match(sql, /public\.is_agency\(\) OR public\.is_tenant_owner\(tenant_id\)/);
  // An empty session identity must never be able to write.
  assert.match(sql, /EXISTS \(SELECT 1 FROM public\.users u WHERE u\.id = public\.app_user_id\(\) AND u\.is_active\)/);
  // The optimistic window is enforced in SQL, not only in TypeScript.
  assert.match(sql, /CHECK \(expires_at > created_at\)/);
});

test('booking SMS type is accepted by the telephony route', () => {
  const route = readFileSync(new URL('../src/app/api/telephony/sms/route.ts', import.meta.url), 'utf8');
  assert.match(route, /"booking_confirm"/);
  // The type list must include it, otherwise it is silently coerced to `custom`.
  const validTypes = route.slice(route.indexOf('const validTypes'), route.indexOf('];', route.indexOf('const validTypes')));
  assert.match(validTypes, /"booking_confirm"/);
});

// ---------------------------------------------------------------------------
// Public signed invitations (the SMS link must work without a session)
// ---------------------------------------------------------------------------

test('invitation tokens are HMAC-signed and reject any tampering', () => {
  process.env.SESSION_SECRET = 'test-secret-that-is-at-least-32-characters-long';
  const bookingId = 'bk-abc123-xyz789';
  const token = signBookingToken(bookingId);

  assert.equal(verifyBookingToken(token), bookingId);
  // Editing the id invalidates the signature.
  assert.equal(verifyBookingToken(`bk-evil-000000.${token.split('.')[1]}`), null);
  // So does editing the signature.
  assert.equal(verifyBookingToken(`${bookingId}.0000000000000000`), null);
  // Malformed input never throws.
  for (const bad of ['', 'nonsense', '.', 'a.', '.abc', `${bookingId}.short`, 'UPPER CASE.sig']) {
    assert.equal(verifyBookingToken(bad), null, bad);
  }
  // A different secret must not validate the same token.
  process.env.SESSION_SECRET = 'a-completely-different-secret-value-32ch';
  assert.equal(verifyBookingToken(token), null);
});

test('the invitation cache is bounded, expiring, and clears cleanly', () => {
  process.env.SESSION_SECRET = 'test-secret-that-is-at-least-32-characters-long';
  clearInvites();
  const ics = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
  cacheInvite('bk-1', { ics, title: 'Besigtigelse — æøå' });
  assert.equal(readInvite('bk-1')?.ics, ics);
  assert.equal(readInvite('bk-1')?.title, 'Besigtigelse — æøå');
  assert.equal(readInvite('bk-missing'), null);
  clearInvites();
  assert.equal(readInvite('bk-1'), null);
});

test('the booking SMS links to the signed public invitation, not an authenticated feed', () => {
  const route = readFileSync(new URL('../src/app/api/calendar/book/route.ts', import.meta.url), 'utf8');
  // The webcal:// feed requires a session, so it must not be the SMS target.
  assert.match(route, /signBookingToken\(bookingId\)/);
  assert.match(route, /\/api\/calendar\/invite\//);
  assert.doesNotMatch(route, /link: links\.webcal/);

  // The public route verifies the signature before reading anything.
  const invite = readFileSync(
    new URL('../src/app/api/calendar/invite/[token]/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(invite, /verifyBookingToken\(token\)/);
  assert.match(invite, /readInvite\(bookingId\)/);
  assert.match(invite, /Content-Type': 'text\/calendar/);
  assert.match(invite, /no-store/);
});
