"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { OperatingHour } from "@/db/schema";
import type { AfterHoursRouting, DigestSummary, OpenState } from "@/lib/types";
import { formatDuration, DAY_NAMES } from "@/lib/format";
import { Icon, Pill, SectionHeader, Stat } from "@/components/ui/primitives";

interface HoursDigestProps {
  workspaceSlug: string;
  workspaceName: string;
  timezone: string;
  agentName: string;
  initialHours: OperatingHour[];
  initialDigest: DigestSummary;
  initialOpenState: OpenState;
  escalationPhone: string;
  digestEmail: string;
  digestEnabled: boolean;
}

const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const ROUTING_LABEL: Record<AfterHoursRouting, string> = {
  callback: "Callback queue",
  voicemail: "Voicemail + SMS",
  emergency: "Emergency line",
  human: "Warm transfer",
};

interface EditableDay {
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
  afterHoursRouting: AfterHoursRouting;
  notes: string;
}

function toEditable(hours: OperatingHour[]): EditableDay[] {
  return DISPLAY_ORDER.map((day) => {
    const row = hours.find((entry) => entry.dayOfWeek === day);
    return {
      dayOfWeek: day,
      isOpen: row ? !row.closed : false,
      openTime: row?.openTime ?? "09:00",
      closeTime: row?.closeTime ?? "17:00",
      afterHoursRouting: "callback",
      notes: "",
    };
  });
}

export function HoursDigest({
  workspaceSlug,
  workspaceName,
  timezone,
  agentName,
  initialHours,
  initialDigest,
  initialOpenState,
  escalationPhone,
  digestEmail,
  digestEnabled,
}: HoursDigestProps) {
  const [days, setDays] = useState<EditableDay[]>(toEditable(initialHours));
  const [digest, setDigest] = useState<DigestSummary>(initialDigest);
  const [openState, setOpenState] = useState<OpenState>(initialOpenState);
  const [escalation, setEscalation] = useState(escalationPhone);
  const [email, setEmail] = useState(digestEmail);
  const [reminderEnabled, setReminderEnabled] = useState(digestEnabled);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const refreshDigest = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      const response = await fetch(`/api/digest?workspace=${encodeURIComponent(workspaceSlug)}`, { cache: "no-store" });
      const payload = (await response.json()) as {
        digest?: DigestSummary;
        openState?: OpenState;
        error?: string;
      };
      if (response.ok && payload.digest && payload.openState) {
        setDigest(payload.digest);
        setOpenState(payload.openState);
        setUpdatedAt(new Date().toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" }));
      } else {
        setError(payload.error ?? "Could not refresh the digest");
      }
    } catch {
      setError("Could not refresh the activity digest");
    } finally {
      setRefreshing(false);
    }
  }, [workspaceSlug]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshDigest();
    }, 90_000);
    return () => window.clearInterval(interval);
  }, [refreshDigest]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/hours", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceSlug,
          hours: days,
          escalationPhone: escalation,
          digestEmail: email,
          digestEnabled: reminderEnabled,
        }),
      });
      const payload = (await response.json()) as { hours?: OperatingHour[]; openState?: OpenState; error?: string };
      if (!response.ok || !payload.hours) {
        setError(payload.error ?? "Could not save the schedule");
        return;
      }
      setDays(toEditable(payload.hours));
      if (payload.openState) setOpenState(payload.openState);
      setNotice("Schedule saved. The receptionist is quoting the new hours instantly.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the schedule");
    } finally {
      setSaving(false);
    }
  };

  const maxCalls = useMemo(() => Math.max(1, ...digest.buckets.map((bucket) => bucket.calls)), [digest.buckets]);
  const peak = useMemo(
    () => [...digest.buckets].sort((a, b) => b.calls - a.calls)[0] ?? null,
    [digest.buckets],
  );

  return (
    <div className="space-y-6">
      <SectionHeader
        label="Operating hours & activity"
        title="Schedule, digest, after-hours routing"
        description="The receptionist reads this schedule out loud and routes after-hours calls according to the rule you set. The hourly digest tracks every incoming call and qualified lead."
        actions={
          <>
            <Pill tone={openState.isOpen ? "live" : "warn"}>
              <span className={openState.isOpen ? "dot-live" : "dot-thinking"} />
              {openState.isOpen ? "Open now" : "After-hours"}
            </Pill>
            <Pill>{openState.localTime} {timezone.split("/")[1]?.replace("_", " ")}</Pill>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Calls · 24h" value={digest.totalCalls} hint={`${digest.afterHoursCalls} after hours`} />
        <Stat label="Qualified leads" value={digest.qualifiedLeads} tone="accent" hint={`${digest.newLeads} captured total`} />
        <Stat label="Avg. handling" value={formatDuration(digest.avgDurationSeconds)} hint="speech-to-speech wrapped" />
        <Stat label="Missed" value={digest.missedCalls} tone={digest.missedCalls > 0 ? "warn" : "default"} hint="routed to callback" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="label">Weekly schedule · {workspaceName}</p>
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">{agentName} reads this live</span>
          </div>

          <div className="mt-3 divide-y divide-[rgba(255,255,255,0.045)]">
            {days.map((day, index) => (
              <div key={day.dayOfWeek} className="py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setDays((previous) =>
                        previous.map((entry, position) =>
                          position === index ? { ...entry, isOpen: !entry.isOpen } : entry,
                        ),
                      )
                    }
                    className={`relative h-[18px] w-[32px] shrink-0 rounded-full border transition-colors ${
                      day.isOpen
                        ? "border-[rgba(201,242,108,0.45)] bg-[rgba(201,242,108,0.24)]"
                        : "border-[var(--border-subtle)] bg-white/[0.04]"
                    }`}
                    aria-pressed={day.isOpen}
                    aria-label={`Toggle ${DAY_NAMES[day.dayOfWeek]}`}
                  >
                    <span
                      className={`absolute top-[2px] h-[12px] w-[12px] rounded-full transition-all ${
                        day.isOpen ? "left-[16px] bg-[var(--accent-primary)]" : "left-[2px] bg-[var(--text-muted)]"
                      }`}
                    />
                  </button>
                  <span className="w-[86px] text-[12.5px] text-[var(--text-primary)]">{DAY_NAMES[day.dayOfWeek]}</span>
                  {day.isOpen ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        className="input num w-[76px] px-2 py-1 text-center font-mono text-[11.5px]"
                        value={day.openTime}
                        onChange={(event) =>
                          setDays((previous) =>
                            previous.map((entry, position) =>
                              position === index ? { ...entry, openTime: event.target.value } : entry,
                            ),
                          )
                        }
                        aria-label={`${DAY_NAMES[day.dayOfWeek]} opening time`}
                      />
                      <span className="text-[var(--text-muted)]">–</span>
                      <input
                        className="input num w-[76px] px-2 py-1 text-center font-mono text-[11.5px]"
                        value={day.closeTime}
                        onChange={(event) =>
                          setDays((previous) =>
                            previous.map((entry, position) =>
                              position === index ? { ...entry, closeTime: event.target.value } : entry,
                            ),
                          )
                        }
                        aria-label={`${DAY_NAMES[day.dayOfWeek]} closing time`}
                      />
                    </div>
                  ) : (
                    <span className="pill pill-warn">closed</span>
                  )}
                  <select
                    className="select ml-auto w-auto py-1 text-[11px]"
                    value={day.afterHoursRouting}
                    onChange={(event) =>
                      setDays((previous) =>
                        previous.map((entry, position) =>
                          position === index
                            ? { ...entry, afterHoursRouting: event.target.value as AfterHoursRouting }
                            : entry,
                        ),
                      )
                    }
                    aria-label={`${DAY_NAMES[day.dayOfWeek]} after-hours routing`}
                  >
                    {(Object.keys(ROUTING_LABEL) as AfterHoursRouting[]).map((routing) => (
                      <option key={routing} value={routing}>
                        {ROUTING_LABEL[routing]}
                      </option>
                    ))}
                  </select>
                </div>
                {day.notes ? (
                  <p className="mt-1 pl-[98px] text-[10.5px] text-[var(--text-muted)]">{day.notes}</p>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-3 grid gap-3 border-t border-[var(--border-subtle)] pt-3 sm:grid-cols-2">
            <label className="block">
              <span className="label mb-1.5 block">After-hours emergency line</span>
              <input className="input" value={escalation} onChange={(event) => setEscalation(event.target.value)} />
            </label>
            <label className="block">
              <span className="label mb-1.5 block">Digest recipient</span>
              <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={reminderEnabled}
                onChange={(event) => setReminderEnabled(event.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--accent-primary)]"
              />
              Hourly activity digest & after-hours reminder
            </label>
            <button type="button" className="btn btn-accent btn-sm" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save schedule"}
              <Icon name="check" className="h-3.5 w-3.5" />
            </button>
          </div>

          {notice ? <p className="mt-3 text-[12px] text-[var(--success)]">{notice}</p> : null}
          {error ? <p className="mt-3 text-[12px] text-[#ffb3b3]">{error}</p> : null}
        </section>

        <div className="space-y-5">
          <section className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="label">Now · {timezone}</p>
                <p className="mt-1 text-[15px] font-medium text-[var(--text-primary)]">{openState.headline}</p>
                <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">{openState.detail}</p>
              </div>
              <Pill tone={openState.isOpen ? "live" : "warn"}>{openState.isOpen ? "Open" : "Closed"}</Pill>
            </div>
            <div className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[rgba(8,9,12,0.5)] p-3">
              <p className="label mb-1.5">Hourly digest preview</p>
              <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
                {digest.totalCalls} calls and {digest.newLeads} new leads in the last 24 hours.
                {peak && peak.calls > 0 ? ` Busiest window ${peak.label} with ${peak.calls} calls.` : ""}
                {digest.afterHoursCalls > 0
                  ? ` ${digest.afterHoursCalls} callers reached the after-hours routing.`
                  : " No after-hours calls."}
              </p>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                {reminderEnabled ? `Sent hourly to ${email || "no recipient"}` : "Reminder paused"}
              </p>
            </div>
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="label">Activity tracker · {digest.windowLabel}</p>
                <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">
                  {updatedAt ? `Refreshed ${updatedAt}` : "Live from PostgreSQL"}
                </p>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refreshDigest()} disabled={refreshing}>
                <Icon name="refresh" className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "…" : "Refresh"}
              </button>
            </div>

            <div className="mt-4 flex h-[120px] items-end gap-[3px]">
              {digest.buckets.map((bucket) => {
                const height = Math.max(3, Math.round((bucket.calls / maxCalls) * 100));
                const leadHeight = bucket.leads > 0 ? Math.max(2, Math.round((bucket.leads / maxCalls) * 100)) : 0;
                return (
                  <div
                    key={bucket.key}
                    className="group relative flex h-full flex-1 flex-col justify-end gap-[2px]"
                    title={`${bucket.label} · ${bucket.calls} calls · ${bucket.leads} leads`}
                  >
                    {leadHeight > 0 ? (
                      <span
                        className="block w-full rounded-sm bg-[var(--accent-secondary)] opacity-70"
                        style={{ height: `${Math.min(leadHeight, 100 - height)}%` }}
                      />
                    ) : null}
                    <span
                      className={`block w-full rounded-sm transition-all ${
                        bucket.calls > 0 ? "bg-[var(--accent-primary)] opacity-80 group-hover:opacity-100" : "bg-white/[0.07]"
                      }`}
                      style={{ height: `${height}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between font-mono text-[9.5px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
              {digest.buckets
                .filter((_, index) => index % 6 === 0)
                .map((bucket) => (
                  <span key={bucket.key}>{bucket.label}</span>
                ))}
              <span>now</span>
            </div>
            <div className="mt-3 flex items-center gap-4 text-[10.5px] text-[var(--text-muted)]">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-[var(--accent-primary)]" /> calls
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-[var(--accent-secondary)]" /> leads
              </span>
              <span className="ml-auto num font-mono uppercase">{digest.totalCalls} total</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
