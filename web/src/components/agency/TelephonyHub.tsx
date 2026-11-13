"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
Activity,
Antenna,
ArrowUpRight,
Check,
Copy,
CircleDot,
Ear,
Info,
Lock,
PhoneCall,
PhoneIncoming,
Radio,
RefreshCw,
Router,
Satellite,
ShieldCheck,
Signal,
Smartphone,
Waves,
Wifi,
} from "lucide-react";
import { InlineNotice } from "@/components/ui/client-ui";
import { Equalizer, LiveStatus, MetricCard, PanelHeader, Sparkline, WaveDock } from "@/components/ui/studio";
import { Pill } from "@/components/ui/primitives";
import { DialInTestModal } from "@/components/agency/DialInTestModal";
import { formatMs, formatRelative } from "@/lib/format";
import type { RingBehavior, SipCodec, SipSessionView, TelephonyHealth, TelephonyMode, TelephonyNumberView } from "@/lib/types";

interface ClientOption {
id: string;
name: string;
slug: string;
agentName: string;
}

interface TelephonyHubProps {
agencyName: string;
initialNumbers: TelephonyNumberView[];
initialSessions: SipSessionView[];
initialHealth: TelephonyHealth;
clients: ClientOption[];
}

const MODE_LABEL: Record<TelephonyMode, string> = {
webrtc: "Zero-Cost WebRTC Only",
sip: "Dedicated SIP Trunk (+45 DID)",
};

const RING_LABEL: Record<RingBehavior, string> = {
immediate: "Immediate answer",
"one-ring": "Simulated 1-ring delay",
"two-rings": "Two-ring delay",
};

const CODEC_LABEL: Record<SipCodec, string> = {
PCMA: "G.711 A-law · 8 kHz",
PCMU: "G.711 µ-law · 8 kHz",
"AMR-WB": "AMR-WB · 16 kHz",
OPUS: "Opus · 48 kHz",
};

const RING_DELAY: Record<RingBehavior, number> = { immediate: 0, "one-ring": 1200, "two-rings": 2400 };

export function TelephonyHub({ agencyName, initialNumbers, initialSessions, initialHealth, clients }: TelephonyHubProps) {
const [numbers, setNumbers] = useState<TelephonyNumberView[]>(initialNumbers);
const [sessions, setSessions] = useState<SipSessionView[]>(initialSessions);
const [health, setHealth] = useState<TelephonyHealth>(initialHealth);
const [busyId, setBusyId] = useState<string | null>(null);
const [notice, setNotice] = useState<string | null>(null);
const [error, setError] = useState<string | null>(null);
const [copied, setCopied] = useState<string | null>(null);
const [revealed, setRevealed] = useState<string[]>([]);
const [refreshing, setRefreshing] = useState(false);
const [dialIn, setDialIn] = useState<TelephonyNumberView | null>(null);

const refresh = useCallback(async (): Promise<void> => {
setRefreshing(true);
try {
const [numbersResponse, sessionsResponse] = await Promise.all([
fetch("/api/telephony/numbers", { cache: "no-store" }),
fetch("/api/telephony/sessions?limit=12", { cache: "no-store" }),
]);
const numbersPayload = (await numbersResponse.json()) as {
numbers?: TelephonyNumberView[];
health?: TelephonyHealth;
};
const sessionsPayload = (await sessionsResponse.json()) as { sessions?: SipSessionView[]; health?: TelephonyHealth };
if (numbersPayload.numbers) setNumbers(numbersPayload.numbers);
if (sessionsPayload.sessions) setSessions(sessionsPayload.sessions);
if (sessionsPayload.health ?? numbersPayload.health) {
setHealth((sessionsPayload.health ?? numbersPayload.health) as TelephonyHealth);
}
} catch {
setError("Could not refresh carrier telemetry");
} finally {
setRefreshing(false);
}
}, []);

useEffect(() => {
const interval = window.setInterval(() => {
void refresh();
}, 20_000);
return () => window.clearInterval(interval);
}, [refresh]);

const copy = async (value: string, key: string): Promise<void> => {
try {
await navigator.clipboard.writeText(value);
setCopied(key);
window.setTimeout(() => setCopied(null), 1600);
} catch {
setError("Clipboard access was blocked — copy manually.");
}
};

const patchNumber = async (id: string, patch: Record<string, string>): Promise<void> => {
setBusyId(id);
setNotice(null);
setError(null);
try {
const response = await fetch("/api/telephony/numbers", {
method: "PUT",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ id, ...patch }),
});
const payload = (await response.json()) as { numbers?: TelephonyNumberView[]; updated?: TelephonyNumberView; error?: string };
if (!response.ok || !payload.numbers) {
setError(payload.error ?? "Could not update the carrier route");
return;
}
setNumbers(payload.numbers);
setNotice(
payload.updated
? `${payload.updated.pretty} updated · ${MODE_LABEL[payload.updated.mode]} · ${RING_LABEL[payload.updated.ringBehavior]}`
: "Carrier route updated.",
);
} catch (caught) {
setError(caught instanceof Error ? caught.message : "Could not update the carrier route");
} finally {
setBusyId(null);
}
};

const trunOneLive = useMemo(() => numbers.filter((row) => row.status === "active").length, [numbers]);

const codecSpark = useMemo(
() => health.codecDistribution.map((entry) => ({ label: entry.codec, value: entry.count })),
[health.codecDistribution],
);

const toggleReveal = (id: string): void => {
setRevealed((previous) => (previous.includes(id) ? previous.filter((entry) => entry !== id) : [...previous, id]));
};

return (
<div className="space-y-5">
<div className="flex flex-wrap items-end justify-between gap-3">
<div>
<div className="flex flex-wrap items-center gap-1.5">
<Pill tone="accent">
<Satellite className="h-2.5 w-2.5" /> FlyNumber carrier hub
</Pill>
<LiveStatus label={health.trunkStatus === "active" ? "SIP trunk active" : health.trunkStatus} tone={health.trunkStatus === "active" ? "live" : "warn"} />
<Pill tone={health.dispatchHealthy ? "live" : "danger"}>
<Router className="h-2.5 w-2.5" /> dispatch {health.dispatchHealthy ? "healthy" : "degraded"}
</Pill>
</div>
<h1 className="display mt-3 text-[26px] text-[var(--text-primary)] sm:text-[31px]">Telephony & Danish DIDs</h1>
<p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
{agencyName} routes Danish PSTN calls through FlyNumber into a LiveKit SIP dispatch rule, resolves the tenant
from the dialled DID in PostgreSQL, and joins an attempt-scoped room running the tenant&apos;s agent.
</p>
</div>
<div className="flex flex-wrap items-center gap-1.5">
<button type="button" onClick={() => void refresh()} disabled={refreshing} className="btn btn-ghost btn-sm">
<RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh telemetry
</button>
<button type="button" onClick={() => { const first = numbers.find((row) => row.status === "active"); if (first) setDialIn(first); }} className="btn btn-accent btn-sm" disabled={numbers.length === 0}>
<Smartphone className="h-3.5 w-3.5" /> Open dial-in test
</button>
</div>
</div>

<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
<MetricCard
label="Numbers online"
value={health.numbersOnline}
unit={`/ ${health.numbersTotal}`}
hint={`${numbers.filter((row) => row.status === "pool").length} in the carrier pool`}
icon={PhoneCall}
tone="sand"
/>
<MetricCard
label="Inbound · 24h"
value={health.inbound24h}
hint={`${formatMs(health.avgRingDelayMs)} average ring delay`}
icon={PhoneIncoming}
tone="green"
spark={codecSpark.length > 0 ? codecSpark : undefined}
/>
<MetricCard
label="Round-trip audio"
value={formatMs(health.avgRoundTripMs)}
hint="STT + LLM first token + TTS first byte · target < 600ms"
icon={Activity}
tone="blue"
/>
<MetricCard
label="MOS / jitter"
value={health.avgMos.toFixed(1)}
unit="/ 4.5"
hint={`${health.jitterMs}ms jitter · ${health.packetLossPct}% loss`}
icon={Signal}
tone={health.avgMos >= 4.2 ? "green" : "danger"}
/>
</div>

{notice ? <InlineNotice>{notice}</InlineNotice> : null}
{error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

<section className="card overflow-hidden">
<PanelHeader
title="DID inventory & routing"
subtitle={`${numbers.length} numbers · ${trunOneLive} live · carrier health live`}
icon={Router}
actions={<WaveDock state={health.trunkStatus === "active" ? "trunk ok" : "checking"} />}
/>
<div className="grid gap-3 p-3 lg:grid-cols-2">
{numbers.map((number) => {
const assigned = Boolean(number.workspaceId);
return (
<article key={number.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--glass-soft)] p-3">
<div className="flex flex-wrap items-start justify-between gap-2">
<div className="min-w-0">
<div className="flex flex-wrap items-center gap-1.5">
<span className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border-warm)] bg-[var(--accent-soft)] text-[var(--accent-primary)]">
<PhoneCall className="h-3 w-3" strokeWidth={1.9} />
</span>
<p className="num text-[14px] tracking-[-0.01em] text-[var(--text-primary)]">{number.pretty}</p>
<Pill tone={number.status === "active" ? "live" : number.status === "pool" ? "warn" : "default"}>
{number.status === "active" ? <span className="dot-live" /> : null}
{number.status}
</Pill>
<Pill tone={number.mode === "sip" ? "accent" : "warn"}>{number.mode === "sip" ? "SIP" : "WebRTC"}</Pill>
</div>
<p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
{number.label} · {number.carrier} · {number.country}
</p>
</div>
<div className="flex shrink-0 items-center gap-1">
<button type="button" onClick={() => void copy(number.pretty, `num-${number.id}`)} className="btn btn-ghost btn-sm" aria-label={`Copy ${number.pretty}`}>
{copied === `num-${number.id}` ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
{copied === `num-${number.id}` ? "Copied" : "Copy"}
</button>
<button type="button" onClick={() => setDialIn(number)} className="btn btn-primary btn-sm" disabled={!assigned}>
<Smartphone className="h-3 w-3" /> Dial-in
</button>
</div>
</div>

<div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
{[
["SIP endpoint", number.sipEndpoint],
["Dispatch rule", number.dispatchRuleId ?? "not provisioned"],
["Codec", CODEC_LABEL[number.codec]],
["Calls 24h", `${number.calls24h}`],
].map(([label, value]) => (
<div key={label} className="rounded-lg border border-[var(--border-subtle)] px-2 py-1.5">
<p className="label text-[8.5px]">{label}</p>
<p className="mt-0.5 truncate font-mono text-[9.5px] text-[var(--text-secondary)]" title={value}>
{value}
</p>
</div>
))}
</div>

<div className="mt-2 flex flex-wrap items-center gap-1.5">
<span className={`pill ${number.healthScore >= 95 ? "pill-live" : "pill-warn"}`}>
<ShieldCheck className="h-2.5 w-2.5" /> health {number.healthScore}%
</span>
<span className="chip"><Waves className="h-2.5 w-2.5" /> {number.jitterMs}ms jitter</span>
<span className="chip"><Wifi className="h-2.5 w-2.5" /> {number.packetLoss}% loss</span>
<span className="chip">{number.monthlyCostDkk === 0 ? "zero cost" : `${number.monthlyCostDkk} DKK/mo`}</span>
<button
type="button"
onClick={() => toggleReveal(number.id)}
className="chip ml-auto hover:text-[var(--text-primary)]"
aria-label="Reveal SIP credentials"
>
<Lock className="h-2.5 w-2.5" /> {revealed.includes(number.id) ? "hide" : "sip auth"}
</button>
</div>

{revealed.includes(number.id) ? (
<div className="mt-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-ground)] p-2 font-mono text-[9.5px] text-[var(--text-secondary)]">
<p>user: {number.sipUsername}</p>
<p>host: {number.sipTrunkHost}</p>
<p>transport: TLS · {number.sampleRate / 1000} kHz</p>
</div>
) : null}

<div className="mt-2.5 space-y-2 border-t border-[var(--border-subtle)] pt-2.5">
<div>
<div className="flex items-center justify-between">
<span className="label text-[9px]">Telephony mode</span>
<span className="font-mono text-[9px] text-[var(--text-muted)]">{MODE_LABEL[number.mode]}</span>
</div>
<div className="segmented mt-1 flex">
<button type="button" aria-pressed={number.mode === "webrtc"} disabled={busyId === number.id} onClick={() => void patchNumber(number.id, { mode: "webrtc" })} className="flex-1">
WebRTC only
</button>
<button type="button" aria-pressed={number.mode === "sip"} disabled={busyId === number.id} onClick={() => void patchNumber(number.id, { mode: "sip" })} className="flex-1">
SIP trunk
</button>
</div>
</div>
<div className="grid gap-2 sm:grid-cols-2">
<label className="block">
<span className="label mb-1 block">Inbound ring behaviour</span>
<select
value={number.ringBehavior}
onChange={(event) => void patchNumber(number.id, { ringBehavior: event.target.value })}
className="select py-1 text-[11px]"
disabled={busyId === number.id}
aria-label={`Ring behaviour for ${number.pretty}`}
>
{(Object.keys(RING_LABEL) as RingBehavior[]).map((value) => (
<option key={value} value={value}>
{RING_LABEL[value]}
</option>
))}
</select>
</label>
<label className="block">
<span className="label mb-1 block">Assigned tenant</span>
<select
value={number.workspaceId ?? "unassigned"}
onChange={(event) => void patchNumber(number.id, { workspaceId: event.target.value })}
className="select py-1 text-[11px]"
disabled={busyId === number.id}
aria-label={`Assign ${number.pretty}`}
>
<option value="unassigned">Return to carrier pool</option>
{clients.map((client) => (
<option key={client.id} value={client.id}>
{client.name} · {client.agentName}
</option>
))}
</select>
</label>
</div>
<div className="flex flex-wrap items-center justify-between gap-1.5">
<span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
<Ear className="h-2.5 w-2.5" /> {RING_DELAY[number.ringBehavior]}ms simulated ring
{number.lastCallAt ? ` · last ${formatRelative(number.lastCallAt)}` : ""}
</span>
<button type="button" onClick={() => void patchNumber(number.id, { regenerateCredentials: "true" })} disabled={busyId === number.id} className="btn btn-ghost btn-sm">
<RefreshCw className="h-2.5 w-2.5" /> Rotate SIP auth
</button>
</div>
</div>
</article>
);
})}
</div>
</section>

<div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
<section className="card overflow-hidden">
<PanelHeader title="SIP ingress telemetry" subtitle="Attempt-scoped rooms · LiveKit dispatch" icon={Antenna} actions={<Pill>{sessions.length} sessions</Pill>} />
<div className="overflow-x-auto">
<table className="data-table">
<thead>
<tr>
<th>Room</th>
<th>Caller → DID</th>
<th>Codec</th>
<th>STT</th>
<th>LLM</th>
<th>TTS</th>
<th>RTT</th>
<th>State</th>
</tr>
</thead>
<tbody>
{sessions.map((session) => (
<tr key={session.id}>
<td>
<span className="block max-w-[150px] truncate font-mono text-[10.5px] text-[var(--text-primary)]">{session.roomName}</span>
<span className="block truncate font-mono text-[9.5px] text-[var(--text-muted)]">{session.agentName ?? "unassigned"}</span>
</td>
<td>
<span className="block font-mono text-[10.5px] text-[var(--text-secondary)]">{session.callerNumber ?? "anonymous"}</span>
<span className="block font-mono text-[9.5px] text-[var(--text-muted)]">{session.dialedNumber ?? "—"}</span>
</td>
<td className="font-mono text-[10px]">{session.codec}</td>
<td className="num font-mono text-[10.5px]">{session.sttLatencyMs}ms</td>
<td className="num font-mono text-[10.5px]">{session.llmFirstTokenMs}ms</td>
<td className="num font-mono text-[10.5px]">{session.ttsFirstByteMs}ms</td>
<td>
<span className={`num font-mono text-[10.5px] ${session.roundTripMs > 0 && session.roundTripMs <= 600 ? "text-[var(--success)]" : "text-[var(--warning)]"}`}>
{session.roundTripMs}ms
</span>
</td>
<td>
<span className={`pill ${session.state === "connected" ? "pill-live" : session.state === "missed" || session.state === "failed" ? "pill-danger" : ""}`}>
{session.state === "connected" ? <span className="dot-live" /> : null}
{session.state}
</span>
</td>
</tr>
))}
{sessions.length === 0 ? (
<tr>
<td colSpan={8} className="py-8 text-center text-[11.5px] text-[var(--text-muted)]">
No SIP sessions yet. Dial a DID or run the dial-in test bench.
</td>
</tr>
) : null}
</tbody>
</table>
</div>
</section>

<div className="space-y-3">
<section className="card p-3">
<div className="flex items-center justify-between">
<p className="label">Carrier & codec health</p>
<Equalizer active={health.trunkStatus === "active"} bars={5} />
</div>
<div className="mt-2 space-y-2">
{[
["SIP trunk", health.trunkStatus === "active" ? "FlyNumber · Active" : health.trunkStatus, health.trunkStatus === "active" ? 100 : 62],
["Dispatch rules", health.dispatchHealthy ? "all bound" : "binding required", health.dispatchHealthy ? 100 : 40],
["Average MOS", `${health.avgMos.toFixed(1)} / 4.5`, Math.round((health.avgMos / 4.5) * 100)],
["Round-trip budget", `${health.avgRoundTripMs}ms of 600ms`, Math.min(100, Math.round((health.avgRoundTripMs / 600) * 100))],
].map(([label, value, percent]) => (
<div key={String(label)}>
<div className="flex items-center justify-between text-[10.5px]">
<span className="text-[var(--text-secondary)]">{label}</span>
<span className="num font-mono text-[9.5px] text-[var(--text-muted)]">{value}</span>
</div>
<div className="meter mt-1">
<span style={{ width: `${percent}%` }} />
</div>
</div>
))}
</div>
<div className="mt-2.5 flex flex-wrap gap-1">
{health.codecDistribution.map((entry) => (
<span key={entry.codec} className="chip">
{entry.codec} · {entry.count}
</span>
))}
</div>
</section>

<section className="card p-3">
<div className="flex items-center justify-between">
<p className="label">Acoustic pipeline</p>
<span className="chip"><CircleDot className="h-2.5 w-2.5" /> dual profile</span>
</div>
<div className="mt-2 space-y-1.5">
{[
["Browser showcase", "48 kHz · stereo Opus · high dynamic range", "text-[var(--accent-secondary)]"],
["FlyNumber PSTN", "16 kHz acoustic profile · warm mid EQ · capped 5 kHz", "text-[var(--accent-primary)]"],
["Noise suppression", "WebRTC NS + RNNoise · VAD tuned for car Bluetooth", "text-[var(--success)]"],
["Comfort fillers", "“Ja, lige et øjeblik” · “Helt sikkert” · “Forstået”", "text-[var(--warning)]"],
].map(([label, value, tone]) => (
<div key={label} className="rounded-lg border border-[var(--border-subtle)] px-2 py-1.5">
<p className="text-[10.5px] text-[var(--text-primary)]">{label}</p>
<p className={`mt-0.5 text-[9.5px] leading-relaxed ${tone}`}>{value}</p>
</div>
))}
</div>
</section>

<section className="card p-3">
<p className="label">SIP signalling flow</p>
<ol className="mt-2 space-y-1.5">
{[
"Danish PSTN caller dials the +45 DID",
"FlyNumber SIP trunk forwards INVITE to LiveKit",
"Dispatch rule matches did → workspace",
"Attempt-scoped room + agent worker join",
"Freja greeting after ring behaviour",
].map((step, index) => (
<li key={step} className="flex items-start gap-2 text-[10.5px] leading-relaxed text-[var(--text-secondary)]">
<span className="num mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] font-mono text-[8.5px] text-[var(--text-muted)]">
{index + 1}
</span>
{step}
</li>
))}
</ol>
<div className="mt-2 flex items-center justify-between border-t border-[var(--border-subtle)] pt-2">
<span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
<Info className="h-2.5 w-2.5" /> POST /api/telephony/dispatch
</span>
<a href="/api/telephony/numbers" className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--accent-primary)] hover:underline">
inventory <ArrowUpRight className="h-2.5 w-2.5" />
</a>
</div>
</section>

<section className="card p-3">
<div className="flex items-center justify-between">
<p className="label">Ring delay distribution</p>
<Radio className="h-3 w-3 text-[var(--accent-primary)]" />
</div>
<div className="mt-2">
<Sparkline
points={sessions.slice(0, 10).map((session, index) => ({ label: `${index}`, value: session.ringDelayMs }))}
width={250}
height={46}
tone="sand"
/>
</div>
<p className="mt-1 text-[10px] leading-relaxed text-[var(--text-muted)]">
A 1.2s simulated ring matches Danish expectations: callers hear one ring before the receptionist picks up, so
the greeting never sounds like a machine answering instantly.
</p>
</section>
</div>
</div>

<DialInTestModal
number={dialIn}
clients={clients}
onClose={() => setDialIn(null)}
onSession={(session) => setSessions((previous) => [session, ...previous].slice(0, 12))}
/>
</div>
);
}
