"use client";

import { useState, useCallback, type FormEvent } from "react";
import {
  MessageSquare,
  Send,
  Smartphone,
  RefreshCw,
  Waves,
  ShieldCheck,
  Clock,
} from "lucide-react";
import { Pill } from "@/components/ui/primitives";
import { PanelHeader, MetricCard } from "@/components/ui/studio";
import { InlineNotice } from "@/components/ui/client-ui";
import {
  SmsDispatchRecordSchema,
  SmsSummaryMetricsSchema,
  type SmsDispatchRecord,
  type SmsSummaryMetrics,
  type SmsMessageType,
} from "@/contracts/schemas";

interface SmsDispatchPanelProps {
  initialRecords: SmsDispatchRecord[];
  initialMetrics: SmsSummaryMetrics;
  agencyName: string;
}

const TEMPLATES: Record<
  SmsMessageType,
  { label: string; placeholder: string; defaultText: string }
> = {
  customer_followup: {
    label: "Kundeopfølgning (Customer Confirmation)",
    placeholder: "Tak for dit opkald...",
    defaultText:
      "Tak for dit opkald til Murermester & Byg ApS. Freja har registreret din henvendelse, og vi vender tilbage hurtigst muligt med et prisoverslag.",
  },
  lead_alert: {
    label: "Ejer-advisering (Lead Notification)",
    placeholder: "Nyt lead modtaget...",
    defaultText:
      "Nyt lead fra +45 27 44 18 02 (Jens Hansen). Projekt: Tagrenovering 120 m². Estimeret værdi: 145.000 DKK. Log ind for at se detaljer.",
  },
  booking_confirm: {
    label: "Tidsbestilling (Booking Confirmed)",
    placeholder: "Din tid er booket...",
    defaultText:
      "Tak for dit opkald. Din tid er booket, og du modtager en kalenderinvitation med det samme. Mvh receptionen.",
  },
  inspection_confirm: {
    label: "Besigtigelse (Inspection Confirmed)",
    placeholder: "Besigtigelse bekræftet...",
    defaultText:
      "Besigtigelse bekræftet: Vores murer kommer forbi tirsdag kl. 10:00 på adressen. Svar på denne SMS ved behov for ændring.",
  },
  custom: {
    label: "Brugerdefineret SMS",
    placeholder: "Skriv en besked...",
    defaultText: "",
  },
};

export function SmsDispatchPanel({
  initialRecords,
  initialMetrics,
  agencyName,
}: SmsDispatchPanelProps) {
  const [records, setRecords] = useState<SmsDispatchRecord[]>(initialRecords);
  const [metrics, setMetrics] = useState<SmsSummaryMetrics>(initialMetrics);
  const [recipient, setRecipient] = useState("+45 ");
  const [messageType, setMessageType] = useState<SmsMessageType>("customer_followup");
  const [bodyText, setBodyText] = useState(TEMPLATES.customer_followup.defaultText);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>("all");

  const segments = bodyText.length <= 160 ? 1 : Math.ceil(bodyText.length / 153);

  const handleTemplateChange = (type: SmsMessageType) => {
    setMessageType(type);
    setBodyText(TEMPLATES[type].defaultText);
  };

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/telephony/sms", { cache: "no-store" });
      const payload: unknown = await res.json();
      if (typeof payload === "object" && payload !== null) {
        const payloadObj = payload as { records?: unknown[]; metrics?: unknown };
        if (Array.isArray(payloadObj.records)) {
          const validRecords: SmsDispatchRecord[] = [];
          for (const item of payloadObj.records) {
            const parsed = SmsDispatchRecordSchema.safeParse(item);
            if (parsed.success) validRecords.push(parsed.data);
          }
          setRecords(validRecords);
        }
        if (payloadObj.metrics) {
          const parsedMetrics = SmsSummaryMetricsSchema.safeParse(payloadObj.metrics);
          if (parsedMetrics.success) setMetrics(parsedMetrics.data);
        }
      }
    } catch {
      setError("Kunne ikke opdatere SMS telemetri");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleSend = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setNotice(null);
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/telephony/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient,
          messageType,
          body: bodyText,
        }),
      });

      const data: unknown = await res.json();
      const dataObj = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};

      if (!res.ok || dataObj.ok !== true) {
        const errorMsg = typeof dataObj.error === "string" ? dataObj.error : "Fejl ved afsendelse af SMS";
        throw new Error(errorMsg);
      }

      if (dataObj.record) {
        const parsedRecord = SmsDispatchRecordSchema.safeParse(dataObj.record);
        if (parsedRecord.success) {
          setRecords((prev) => [parsedRecord.data, ...prev]);
          setNotice(`SMS afsendt med succes til ${recipient} (${parsedRecord.data.deliveryLatencyMs}ms)`);
        }
      }
      if (dataObj.metrics) {
        const parsedMetrics = SmsSummaryMetricsSchema.safeParse(dataObj.metrics);
        if (parsedMetrics.success) {
          setMetrics(parsedMetrics.data);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ukendt fejl");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredRecords =
    filterType === "all"
      ? records
      : records.filter((r) => r.messageType === filterType);

  return (
    <div className="space-y-4">
      {/* Metrics Row */}
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="SMS Udsendt 24t"
          value={metrics.totalSent24h}
          hint="Post-call opfølgninger & alarmer"
          icon={MessageSquare}
          tone="accent"
        />
        <MetricCard
          label="Leveringsrate"
          value={`${metrics.deliveryRatePct}%`}
          hint={`${metrics.deliveredCount} leveret · ${metrics.failedCount} fejlet`}
          icon={ShieldCheck}
          tone={metrics.deliveryRatePct >= 95 ? "green" : "warn"}
        />
        <MetricCard
          label="Gns. Leveringstid"
          value={`${metrics.avgLatencyMs}ms`}
          hint="Gateway latency til modtager"
          icon={Clock}
          tone="blue"
        />
        <MetricCard
          label="SMS Gateway Trunk"
          value={metrics.carrierStatus === "healthy" ? "Aktiv" : "Degraderet"}
          hint="FlyNumber Danish SMS E.164"
          icon={Waves}
          tone={metrics.carrierStatus === "healthy" ? "green" : "danger"}
        />
      </div>

      {notice ? <InlineNotice tone="accent">{notice}</InlineNotice> : null}
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

      {/* Main 2-Column Console */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Left Column: Dispatch Composer */}
        <section className="card space-y-3 p-4 lg:col-span-5">
          <PanelHeader
            title="Send Post-Call SMS"
            subtitle={`${agencyName} · Automatisk dansk opfølgning`}
            icon={Smartphone}
          />

          <form onSubmit={handleSend} className="space-y-3">
            <div>
              <label className="label text-[11px] font-semibold text-[var(--text-secondary)]">
                Modtager (+45 Telefonnummer)
              </label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="+45 27 44 18 02"
                required
                className="input mt-1 w-full font-mono text-[13px]"
              />
            </div>

            <div>
              <label className="label text-[11px] font-semibold text-[var(--text-secondary)]">
                Beskedskabelon
              </label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(Object.keys(TEMPLATES) as SmsMessageType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleTemplateChange(type)}
                    className={`btn btn-xs ${messageType === type ? "btn-primary" : "btn-ghost"}`}
                  >
                    {TEMPLATES[type].label.split(" ")[0]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="label text-[11px] font-semibold text-[var(--text-secondary)]">
                  SMS Tekst
                </label>
                <span className="font-mono text-[10px] text-[var(--text-muted)]">
                  {bodyText.length} tegn · {segments} segment{segments > 1 ? "er" : ""}
                </span>
              </div>
              <textarea
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                rows={4}
                required
                className="input mt-1 w-full text-xs leading-relaxed"
                placeholder="Skriv besked..."
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary w-full justify-center text-[13px]"
            >
              <Send className="h-3.5 w-3.5" />
              {submitting ? "Sender SMS..." : "Udsend SMS via FlyNumber"}
            </button>
          </form>
        </section>

        {/* Right Column: Activity Stream */}
        <section className="card overflow-hidden lg:col-span-7">
          <PanelHeader
            title="SMS Udsendelseslog"
            subtitle={`${filteredRecords.length} beskeder registreret`}
            icon={MessageSquare}
            actions={
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={refreshing}
                className="btn btn-ghost btn-xs"
              >
                <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
                Opdater
              </button>
            }
          />

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-2">
            {[
              { id: "all", label: "Alle" },
              { id: "customer_followup", label: "Kunde" },
              { id: "lead_alert", label: "Lead-Alarm" },
              { id: "inspection_confirm", label: "Besigtigelse" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterType(tab.id)}
                className={`btn btn-xs ${filterType === tab.id ? "btn-primary" : "btn-ghost"}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="divide-y divide-[var(--border-subtle)]">
            {filteredRecords.length === 0 ? (
              <div className="p-6 text-center text-[12px] text-[var(--text-muted)]">
                Ingen SMS udsendelser fundet i denne kategori.
              </div>
            ) : (
              filteredRecords.map((rec) => (
                <article key={rec.id} className="space-y-1.5 p-3 hover:bg-[var(--glass-soft)]">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold text-[var(--text-primary)]">
                        {rec.recipient}
                      </span>
                      <Pill
                        tone={
                          rec.status === "delivered"
                            ? "live"
                            : rec.status === "sending"
                            ? "accent"
                            : "danger"
                        }
                      >
                        {rec.status === "delivered" ? (
                          <span className="dot-live" />
                        ) : null}
                        {rec.status}
                      </Pill>
                    </div>
                    <span className="font-mono text-[10px] text-[var(--text-muted)]">
                      {new Date(rec.createdAt).toLocaleTimeString("da-DK", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })} · {rec.deliveryLatencyMs}ms
                    </span>
                  </div>

                  <p className="text-[12px] text-[var(--text-secondary)]">{rec.body}</p>

                  <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                    <span>{rec.carrier}</span>
                    <span>·</span>
                    <span>{rec.segments} segment{rec.segments > 1 ? "er" : ""}</span>
                    <span>·</span>
                    <span>{rec.workspaceName}</span>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
