'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  CalendarCheck2,
  CalendarDays,
  Clock3,
  Loader2,
  Lock,
  Send,
  Smartphone,
  Unlock,
} from 'lucide-react';
import { StudioPanel, StudioStatusBar, Pill, Tag, Meter } from '@/components/ui/primitives';
import type {
  BookingSlot,
  CalendarLinks,
  CalendarProvider,
  SlotHoldResponse,
} from '@/contracts/schemas';

interface CalendarBookingPanelProps {
  tenantId: string;
  tenantName: string;
  agentName: string;
  /** Server-rendered first painting of availability; the panel refreshes it. */
  initialSlots: BookingSlot[];
  timezone: string;
  /** Cal.com handle, when the workspace has one configured. */
  calcomLink?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  /**
   * Set when the server could not read occupancy. The panel then refuses to
   * offer any time instead of implying that every slot is taken.
   */
  availabilityError?: string | null;
}

const PROVIDERS: Array<{ id: CalendarProvider; label: string; hint: string }> = [
  { id: 'google', label: 'Google', hint: 'calendar.google.com render link' },
  { id: 'apple_icloud', label: 'Apple', hint: 'RFC 5545 .ics + webcal://' },
  { id: 'outlook', label: 'Outlook', hint: 'Microsoft 365 deeplink' },
  { id: 'calcom', label: 'Cal.com', hint: 'Pre-selected booking slot' },
];

const HOLD_SECONDS = 600;

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

/** Group the flat grid into Danish weekdays for the timeline. */
function groupByDate(slots: BookingSlot[]): Array<{ date: string; label: string; slots: BookingSlot[] }> {
  const groups = new Map<string, BookingSlot[]>();
  for (const slot of slots) {
    const bucket = groups.get(slot.localDate);
    if (bucket) bucket.push(slot);
    else groups.set(slot.localDate, [slot]);
  }
  return Array.from(groups.entries()).map(([date, group]) => ({
    date,
    label: group[0]?.label.split(' ').slice(0, 3).join(' ') ?? date,
    slots: group,
  }));
}

export function CalendarBookingPanel({
  tenantId,
  tenantName,
  agentName,
  initialSlots,
  timezone,
  calcomLink = null,
  contactName = null,
  contactPhone = null,
  availabilityError = null,
}: CalendarBookingPanelProps) {
  const [slots, setSlots] = useState<BookingSlot[]>(initialSlots);
  const [provider, setProvider] = useState<CalendarProvider>('google');
  const [selected, setSelected] = useState<BookingSlot | null>(null);
  const [hold, setHold] = useState<SlotHoldResponse | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [links, setLinks] = useState<CalendarLinks | null>(null);
  const [attendeeName, setAttendeeName] = useState(contactName ?? '');
  const [attendeePhone, setAttendeePhone] = useState(contactPhone ?? '');
  const [topic, setTopic] = useState('Besigtigelse');
  const [sendSms, setSendSms] = useState(true);
  const [pending, setPending] = useState<'slots' | 'hold' | 'book' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setPending('slots');
    setError(null);
    try {
      const response = await fetch(`/api/calendar/slots?days=7&tenantId=${encodeURIComponent(tenantId)}`, {
        credentials: 'same-origin',
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error('Kunne ikke hente ledige tider.');
      const parsed = data as { slots?: BookingSlot[] } | null;
      if (mounted.current && Array.isArray(parsed?.slots)) setSlots(parsed.slots);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Netværksfejl');
    } finally {
      if (mounted.current) setPending(null);
    }
  }, [tenantId]);

  /** Optimistic hold. A 409 means another call won the slot. */
  const takeHold = useCallback(
    async (slot: BookingSlot) => {
      setPending('hold');
      setError(null);
      setLinks(null);
      try {
        const response = await fetch('/api/calendar/slots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            tenantId,
            startIso: slot.startIso,
            endIso: slot.endIso,
            provider,
            topic,
            holdSeconds: HOLD_SECONDS,
          }),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message = (data as { error?: string } | null)?.error;
          throw new Error(message ?? 'Tidspunktet er ikke længere ledigt.');
        }
        if (!mounted.current) return;
        const held = data as SlotHoldResponse;
        setHold(held);
        setSelected(slot);
        setRemaining(held.expiresInSeconds);
        // Mark the slot as held locally so the timeline reflects the lock.
        setSlots((current) =>
          current.map((candidate) =>
            candidate.startIso === slot.startIso
              ? { ...candidate, available: false, blockedBy: 'held' }
              : candidate,
          ),
        );
      } catch (cause) {
        if (!mounted.current) return;
        setError(cause instanceof Error ? cause.message : 'Netværksfejl');
        void refresh();
      } finally {
        if (mounted.current) setPending(null);
      }
    },
    [provider, refresh, tenantId, topic],
  );

  const releaseHold = useCallback(async () => {
    if (!hold) return;
    const id = hold.hold.id;
    setHold(null);
    setRemaining(0);
    setSelected(null);
    await fetch(`/api/calendar/slots?holdId=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    }).catch(() => undefined);
    void refresh();
  }, [hold, refresh]);

  const confirm = useCallback(async () => {
    if (!selected || !hold) return;
    setPending('book');
    setError(null);
    try {
      const response = await fetch('/api/calendar/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          tenantId,
          startIso: selected.startIso,
          endIso: selected.endIso,
          provider,
          holdId: hold.hold.id,
          attendeeName: attendeeName.trim(),
          attendeePhone: attendeePhone.trim() || null,
          topic,
          sendSms,
          calcomLink: calcomLink ?? undefined,
        }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = (data as { error?: string } | null)?.error;
        throw new Error(message ?? 'Bookingen kunne ikke gennemføres.');
      }
      if (!mounted.current) return;
      const result = data as { links: CalendarLinks };
      setLinks(result.links);
      setHold(null);
      setRemaining(0);
      void refresh();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Netværksfejl');
    } finally {
      if (mounted.current) setPending(null);
    }
  }, [attendeeName, attendeePhone, calcomLink, hold, provider, refresh, selected, sendSms, tenantId, topic]);

  // The hold countdown is the visible half of the optimistic lock.
  useEffect(() => {
    if (!hold) return;
    const timer = setInterval(() => {
      setRemaining((current) => {
        if (current <= 1) {
          clearInterval(timer);
          setHold(null);
          setSelected(null);
          void refresh();
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [hold, refresh]);

  const groups = useMemo(() => groupByDate(slots), [slots]);
  const availableCount = slots.filter((slot) => slot.available).length;
  const activeProvider = PROVIDERS.find((item) => item.id === provider) ?? PROVIDERS[0];
  const holdProgress = hold ? (remaining / HOLD_SECONDS) * 100 : 0;

  return (
    <StudioPanel className="p-0">
      <StudioStatusBar>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="live" dot>
            {timezone}
          </Pill>
          <Pill tone="accent">{availableCount} ledige tider</Pill>
          <Tag>07:00–16:00</Tag>
        </div>
        <div className="flex items-center gap-2">
          {hold ? (
            <Pill tone="warn" dot>
              <span className="mono">{formatCountdown(remaining)}</span> hold
            </Pill>
          ) : (
            <Pill>
              <Unlock className="h-3 w-3" aria-hidden /> Ingen hold
            </Pill>
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={pending !== null}
            className="pill"
          >
            {pending === 'slots' ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <CalendarDays className="h-3 w-3" aria-hidden />}
            Opdatér
          </button>
        </div>
      </StudioStatusBar>

      <div className="border-b border-[var(--border-subtle)] px-4 py-3">
        <p className="label mb-2">Kalenderudbyder</p>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Kalenderudbyder">
          {PROVIDERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={provider === item.id}
              title={item.hint}
              onClick={() => setProvider(item.id)}
              className={`pill ${provider === item.id ? 'pill-accent' : ''}`}
            >
              {provider === item.id ? <Lock className="h-3 w-3" aria-hidden /> : <CalendarCheck2 className="h-3 w-3" aria-hidden />}
              {item.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
          {activeProvider.label}: {activeProvider.hint} · invitationen genereres til {tenantName}.
        </p>
      </div>

      <div className="max-h-[420px] overflow-y-auto px-4 py-3">
        {availabilityError ? (
          <p className="flex items-start gap-2 rounded-lg border border-[var(--warning-line)] bg-[var(--warning-soft)] px-3 py-2.5 text-[11.5px] text-[var(--warning)]" role="alert">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {availabilityError}
          </p>
        ) : groups.length === 0 ? (
          <p className="py-8 text-center text-[12.5px] text-[var(--text-muted)]">
            Ingen ledige tider de næste 7 dage. Justér åbningstider eller helligdage.
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.date}>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="label">{group.label}</p>
                  <span className="mono text-[10px] text-[var(--text-muted)]">
                    {group.slots.filter((slot) => slot.available).length}/{group.slots.length}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                  {group.slots.map((slot) => {
                    const isSelected = selected?.startIso === slot.startIso;
                    return (
                      <button
                        key={slot.startIso}
                        type="button"
                        onClick={() => void takeHold(slot)}
                        disabled={!slot.available || pending !== null || hold !== null}
                        aria-pressed={isSelected}
                        aria-label={`${slot.label}${slot.available ? '' : ` — ${slot.blockedBy === 'held' ? 'reserveret' : 'optaget'}`}`}
                        className={[
                          'rounded-lg border px-2 py-1.5 text-left transition-colors',
                          isSelected
                            ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent-primary)]'
                            : slot.available
                              ? 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
                              : 'border-[var(--border-subtle)] text-[var(--text-muted)] line-through opacity-60',
                        ].join(' ')}
                      >
                        <span className="mono block text-[12px] tabular-nums">{slot.localStart}</span>
                        <span className="block text-[9.5px] uppercase tracking-[0.08em] opacity-80">
                          {slot.available ? 'ledig' : slot.blockedBy === 'held' ? 'hold' : 'optaget'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {hold ? (
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="border-t border-[var(--border-subtle)] px-4 py-3"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="label">Hold aktivt · {selected?.label}</p>
            <span className="mono text-[10.5px] text-[var(--warning)]">{formatCountdown(remaining)}</span>
          </div>
          <div className="mt-1.5">
            <Meter value={remaining} max={HOLD_SECONDS} />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="label">Kundens navn</span>
              <input
                className="input mt-1"
                value={attendeeName}
                onChange={(event) => setAttendeeName(event.target.value)}
                placeholder="Jens Hansen"
                autoComplete="name"
              />
            </label>
            <label className="block">
              <span className="label">Telefon til SMS</span>
              <input
                className="input mt-1"
                value={attendeePhone}
                onChange={(event) => setAttendeePhone(event.target.value)}
                placeholder="+4527441802"
                inputMode="tel"
                autoComplete="tel"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="label">Aftalens emne</span>
              <input
                className="input mt-1"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="Besigtigelse"
              />
            </label>
          </div>
          <label className="mt-2 flex items-center gap-2 text-[11.5px] text-[var(--text-secondary)]">
            <input type="checkbox" checked={sendSms} onChange={(event) => setSendSms(event.target.checked)} />
            <Smartphone className="h-3.5 w-3.5" aria-hidden />
            Send dansk bekræftelses-SMS med kalenderlink
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-accent btn-sm"
              onClick={() => void confirm()}
              disabled={pending !== null || attendeeName.trim().length < 2}
            >
              {pending === 'book' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CalendarCheck2 className="h-3.5 w-3.5" aria-hidden />}
              Bekræft booking
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void releaseHold()}>
              <Unlock className="h-3.5 w-3.5" aria-hidden />
              Giv slip
            </button>
          </div>
        </motion.div>
      ) : null}

      {error ? (
        <p className="flex items-start gap-2 border-t border-[var(--danger-line)] bg-[var(--danger-soft)] px-4 py-2.5 text-[11.5px] text-[var(--danger)]" role="alert">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {links ? (
        <div className="border-t border-[var(--border-subtle)] px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="label">Invitation klar</p>
            <Pill tone="live" dot>
              <Send className="h-3 w-3" aria-hidden /> sendt
            </Pill>
          </div>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            <a className="btn btn-sm" href={links.google} target="_blank" rel="noreferrer">
              Google Calendar
            </a>
            <a className="btn btn-sm" href={links.outlook} target="_blank" rel="noreferrer">
              Outlook 365
            </a>
            <a className="btn btn-sm" href={links.apple} download="aftale.ics">
              Apple · .ics
            </a>
            <a className="btn btn-sm" href={links.webcal}>
              webcal:// feed
            </a>
            <a className="btn btn-sm sm:col-span-2" href={links.calcom} target="_blank" rel="noreferrer">
              Cal.com tid
            </a>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-[var(--text-muted)]">
            <Clock3 className="h-3 w-3" aria-hidden />
            Tider er låst til Europe/Copenhagen · {agentName} bekræfter i samtalen.
          </p>
        </div>
      ) : null}
    </StudioPanel>
  );
}
