"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
Activity,
Check,
Copy,
Gauge,
Loader2,
PhoneCall,
PhoneIncoming,
Radar,
Radio,
Signal,
Smartphone,
Timer,
Waves,
Wifi,
X,
} from "lucide-react";
import { InlineNotice } from "@/components/ui/client-ui";
import { Equalizer, LiveStatus } from "@/components/ui/studio";
import { Pill } from "@/components/ui/primitives";
import { Waveform } from "@/components/audio/Waveform";
import { formatMs, formatRelative } from "@/lib/format";
import type { SipSessionView, TelephonyNumberView, VoiceState } from "@/lib/types";

interface DispatchTelemetry {
ringDelayMs: number;
sttLatencyMs: number;
llmFirstTokenMs: number;
ttsFirstByteMs: number;
roundTripMs: number;
jitterMs: number;
packetLossPct: number;
mos: number;
}

interface DispatchResult {
ok?: boolean;
action?: string;
caller?: string;
dialed?: string;
tenant?: { name: string; agentName: string; slug: string };
dispatch?: {
roomName: string;
dispatchRuleId: string;
sipEndpoint: string;
agent: { participantIdentity: string };
metadata: { attempt: string; codec: string; sampleRate: number };
};
telemetry?: DispatchTelemetry;
session?: SipSessionView | null;
error?: string;
}

interface DialInTestModalProps {
number: TelephonyNumberView | null;
clients: { id: string; name: string; slug: string; agentName: string }[];
onClose: () => void;
onSession: (session: SipSessionView) => void;
}

type DialInState = VoiceState | "connected" | "ringing";

export function DialInTestModal({ number, clients, onClose, onSession }: DialInTestModalProps) {
const [state, setState] = useState<DialInState>("idle");
const [copied, setCopied] = useState(false);
const [dispatching, setDispatching] = useState(false);
const [result, setResult] = useState<DispatchResult | null>(null);
const [error, setError] = useState<string | null>(null);
const [elapsed, setElapsed] = useState(0);
const [pollCount, setPollCount] = useState(0);
const [simulatedCaller, setSimulatedCaller] = useState("+45 27 44 18 02");
const overlayRef = useRef<HTMLDivElement | null>(null);

const pretty = number?.pretty ?? "+45 33 12 00 00";
const tenantName = result?.tenant?.name ?? number?.workspaceName ?? clients[0]?.name ?? "Unassigned";
const agentName = result?.tenant?.agentName ?? number?.agentName ?? clients[0]?.agentName ?? "Freja";

const close = useCallback((): void => {
setState("idle");
onClose();
}, [onClose]);

useEffect(() => {
if (!number) return;
const onKeyDown = (event: KeyboardEvent): void => {
if (event.key === "Escape") close();
};
document.addEventListener("keydown", onKeyDown);
return () => document.removeEventListener("keydown", onKeyDown);
}, [number, close]);

useEffect(() => {
if (state !== "connected" && state !== "listening") return;
const interval = window.setInterval(() => setElapsed((previous) => previous + 1), 1000);
return () => window.clearInterval(interval);
}, [state]);

useEffect(() => {
if (state !== "connected") return;
const interval = window.setInterval(() => setPollCount((previous) => previous + 1), 4000);
return () => window.clearInterval(interval);
}, [state]);

useEffect(() => {
if (!number) {
setResult(null);
setState("idle");
setElapsed(0);
setError(null);
}
}, [number]);

if (!number) return null;

const copyNumber = async (): Promise<void> => {
try {
await navigator.clipboard.writeText(pretty);
setCopied(true);
window.setTimeout(() => setCopied(false), 1700);
} catch {
setError("Clipboard access was blocked — read the number from the badge.");
}
};

const simulateInbound = async (): Promise<void> => {
setDispatching(true);
setError(null);
setResult(null);
setElapsed(0);
setState("listening");
try {
const response = await fetch("/api/telephony/dispatch", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({
event: "inbound_call",
did: number.e164,
caller: simulatedCaller,
state: "connected",
transcriptPreview: "Inbound dial-in test — greeting dispatched to the SIP participant.",
}),
});
const payload = (await response.json()) as DispatchResult;
if (!response.ok || !payload.ok) {
setError(payload.error ?? "The SIP dispatch handler rejected the call");
setState("idle");
return;
}
setResult(payload);
setState("speaking");
window.setTimeout(() => setState("listening"), 2200);
if (payload.session) onSession(payload.session);
} catch (caught) {
setError(caught instanceof Error ? caught.message : "Could not reach the SIP dispatch handler");
setState("idle");
} finally {
setDispatching(false);
}
};

const endSession = async (): Promise<void> => {
const sessionId = result?.session?.id;
setState("idle");
if (!sessionId) return;
try {
await fetch("/api/telephony/sessions", {
method: "PUT",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ id: sessionId, state: "completed" }),
});
setResult((previous) => (previous ? { ...previous, session: previous.session ? { ...previous.session, state: "completed" } : null } : previous));
} catch {
setError("Session ended locally, but the telemetry record could not be updated.");
}
};

const telemetry = result?.telemetry;
const latencyBreakdown = telemetry
? [
{ label: "STT transcription", value: telemetry.sttLatencyMs, budget: 220, tone: "text-[var(--accent-secondary)]" },
{ label: "LLM first token", value: telemetry.llmFirstTokenMs, budget: 280, tone: "text-[var(--accent-primary)]" },
{ label: "TTS synthesis & buffer", value: telemetry.ttsFirstByteMs, budget: 180, tone: "text-[var(--success)]" },
]
: [];
const totalBudget = 600;

return (
<div className="fixed inset-0 z-[96] flex items-center justify-center px-3 py-4" role="dialog" aria-modal="true" aria-label="Dial-in test bench">
<button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-md overlay-in" onClick={close} aria-label="Close dial-in test bench" />
<div
ref={overlayRef}
className="relative max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[var(--shadow-float)] rise scroll-thin"
>
<div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-surface)_92%,transparent)] px-4 py-3 backdrop-blur">
<div className="flex min-w-0 items-center gap-2">
<span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border-warm)] bg-[var(--accent-soft)] text-[var(--accent-primary)]">
<Radar className="h-3.5 w-3.5" strokeWidth={1.8} />
</span>
<div className="min-w-0">
<p className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">Dial-in test bench</p>
<p className="truncate font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
{tenantName} · {agentName} · FlyNumber {number.carrier}
</p>
</div>
</div>
<div className="flex items-center gap-1.5">
<LiveStatus label={state === "idle" ? "ready" : state} tone={state === "listening" || state === "speaking" ? "live" : "warn"} />
<button type="button" onClick={close} className="btn-icon text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close">
<X className="h-4 w-4" />
</button>
</div>
</div>

<div className="grid gap-3 p-4 lg:grid-cols-[0.85fr_1.15fr]">
<div className="space-y-3">
<div className="glass-panel overflow-hidden p-4 text-center">
<p className="label">Danish DID · hand this to the client</p>
<button
type="button"
onClick={() => void copyNumber()}
className="group mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border-warm)] bg-[linear-gradient(135deg,rgba(216,200,166,0.14),transparent_70%)] px-3 py-3 transition-colors hover:border-[var(--accent-primary)]"
title="Copy the Danish number"
>
<span className="num text-[24px] tracking-[-0.02em] text-[var(--text-primary)] sm:text-[28px]">{pretty}</span>
<span className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-1.5 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
{copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
{copied ? "copied" : "copy"}
</span>
</button>
<div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
<Pill tone={number.mode === "sip" ? "accent" : "warn"}>{number.mode === "sip" ? "SIP trunk live" : "WebRTC only"}</Pill>
<Pill>{number.codec} · {number.sampleRate / 1000} kHz</Pill>
<Pill tone={number.ringBehavior === "immediate" ? "warn" : "live"}>
{number.ringBehavior === "immediate" ? "immediate answer" : "1-ring simulation"}
</Pill>
</div>
<p className="mt-2 text-[10.5px] leading-relaxed text-[var(--text-muted)]">
Ask the client to dial from their own iPhone or Android. This panel connects when LiveKit accepts the SIP
INVITE — no app, no headset, no telephony plugin.
</p>
</div>

<div className="hairline-card p-3">
<div className="flex items-center justify-between">
<p className="label">SIP connection radar</p>
<Equalizer active={state === "listening" || state === "speaking"} bars={5} />
</div>
<div className="relative mx-auto mt-2 flex h-[154px] w-[154px] items-center justify-center">
<span className="absolute inset-0 rounded-full border border-[rgba(126,224,181,0.16)]" />
<span className="absolute inset-4 rounded-full border border-[rgba(216,200,166,0.18)]" />
<span className="absolute inset-8 rounded-full border border-[rgba(157,180,255,0.14)]" />
{state !== "idle" ? (
<span className="absolute inset-0 animate-ping rounded-full border border-[rgba(126,224,181,0.28)]" style={{ animationDuration: "2.6s" }} />
) : null}
<span
className={`flex h-14 w-14 items-center justify-center rounded-full border transition-colors ${
state === "idle"
? "border-[var(--border-strong)] bg-[var(--glass-soft)] text-[var(--text-muted)]"
: "border-[rgba(126,224,181,0.4)] bg-[rgba(126,224,181,0.12)] text-[var(--success)]"
}`}
>
{state === "idle" ? <Radar className="h-5 w-5" strokeWidth={1.7} /> : <PhoneIncoming className="h-5 w-5" strokeWidth={1.9} />}
</span>
<span className="absolute bottom-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
{state === "idle" ? "awaiting invite" : state === "speaking" ? "greeting stream" : "call live"}
</span>
</div>
<div className="mt-1 grid grid-cols-2 gap-2">
<div className="rounded-lg border border-[var(--border-subtle)] px-2 py-1.5">
<p className="label text-[8.5px]">Room</p>
<p className="mt-0.5 truncate font-mono text-[9.5px] text-[var(--text-secondary)]" title={result?.dispatch?.roomName}>
{result?.dispatch?.roomName ?? "not created"}
</p>
</div>
<div className="rounded-lg border border-[var(--border-subtle)] px-2 py-1.5">
<p className="label text-[8.5px]">Dispatch rule</p>
<p className="mt-0.5 truncate font-mono text-[9.5px] text-[var(--text-secondary)]" title={result?.dispatch?.dispatchRuleId}>
{result?.dispatch?.dispatchRuleId ?? number.dispatchRuleId ?? "—"}
</p>
</div>
</div>
<div className="mt-2 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
<span className="flex items-center gap-1.5">
<Timer className="h-2.5 w-2.5" /> {String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}
</span>
<span className="truncate">{result?.caller ?? simulatedCaller} · {result?.dispatch?.metadata.attempt ?? "—"}</span>
</div>
</div>

<label className="block">
<span className="label mb-1 block">Simulated caller number</span>
<input
value={simulatedCaller}
onChange={(event) => setSimulatedCaller(event.target.value)}
className="input font-mono text-[11px]"
placeholder="+45 27 44 18 02"
aria-label="Simulated caller number"
/>
</label>

<div className="flex flex-wrap items-center gap-1.5">
<button type="button" onClick={() => void simulateInbound()} disabled={dispatching} className="btn btn-accent btn-sm">
{dispatching ? <Loader2 className="h-3 w-3 animate-spin" /> : <PhoneCall className="h-3 w-3" />}
{dispatching ? "Dispatching…" : "Simulate inbound SIP call"}
</button>
<button type="button" onClick={() => void endSession()} disabled={state === "idle"} className="btn btn-danger btn-sm">
<X className="h-3 w-3" /> End
</button>
</div>
{error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
{pollCount > 0 && state === "connected" ? (
<p className="font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-muted)]">telemetry poll #{pollCount}</p>
) : null}
</div>

<div className="space-y-3">
<div className="hairline-card p-3">
<div className="flex items-center justify-between">
<p className="label">Live audio telemetry</p>
<span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
<Gauge className="h-2.5 w-2.5" /> budget {formatMs(totalBudget)}
</span>
</div>

<div className="mt-2 flex items-center justify-between rounded-xl border border-[var(--border-warm)] bg-[var(--glass-soft)] px-3 py-2">
<div>
<p className="label text-[9px]">Total round-trip</p>
<p className={`num mt-0.5 text-[24px] leading-none ${telemetry ? (telemetry.roundTripMs <= totalBudget ? "text-[var(--success)]" : "text-[var(--warning)]") : "text-[var(--text-muted)]"}`}>
{telemetry ? formatMs(telemetry.roundTripMs) : "—"}
</p>
</div>
<div className="text-right">
<p className="label text-[9px]">MOS</p>
<p className="num mt-0.5 text-[16px] text-[var(--text-primary)]">{telemetry ? (telemetry.mos / 10).toFixed(1) : "—"}</p>
<p className="font-mono text-[8.5px] text-[var(--text-muted)]">cellular · {number.carrier}</p>
</div>
</div>

<div className="mt-2 space-y-2">
{latencyBreakdown.length === 0
? [
{ label: "STT transcription", budget: 220, tone: "text-[var(--accent-secondary)]" },
{ label: "LLM first token", budget: 280, tone: "text-[var(--accent-primary)]" },
{ label: "TTS synthesis & buffer", budget: 180, tone: "text-[var(--success)]" },
].map((row) => (
<div key={row.label}>
<div className="flex items-center justify-between text-[10.5px]">
<span className="text-[var(--text-secondary)]">{row.label}</span>
<span className="num font-mono text-[9.5px] text-[var(--text-muted)]">— / {row.budget}ms</span>
</div>
<div className="meter mt-1">
<span style={{ width: "0%" }} />
</div>
</div>
))
: latencyBreakdown.map((row) => (
<div key={row.label}>
<div className="flex items-center justify-between text-[10.5px]">
<span className="text-[var(--text-secondary)]">{row.label}</span>
<span className={`num font-mono text-[9.5px] ${row.tone}`}>
{row.value}ms <span className="text-[var(--text-muted)]">/ {row.budget}ms</span>
</span>
</div>
<div className="meter mt-1">
<span style={{ width: `${Math.min(100, Math.round((row.value / row.budget) * 100))}%` }} />
</div>
</div>
))}
</div>

<div className="mt-2.5 grid grid-cols-3 gap-2">
{[
{ label: "Jitter", value: telemetry ? `${telemetry.jitterMs}ms` : "—", icon: Waves },
{ label: "Packet loss", value: telemetry ? `${telemetry.packetLossPct}%` : "—", icon: Wifi },
{ label: "Ring delay", value: telemetry ? `${telemetry.ringDelayMs}ms` : "—", icon: Signal },
].map((item) => (
<div key={item.label} className="rounded-lg border border-[var(--border-subtle)] px-2 py-1.5">
<p className="label text-[8.5px]">{item.label}</p>
<p className="num mt-0.5 flex items-center gap-1 text-[11px] text-[var(--text-primary)]">
<item.icon className="h-2.5 w-2.5 text-[var(--text-muted)]" /> {item.value}
</p>
</div>
))}
</div>

<div className="mt-2">
<Waveform active={state === "listening" || state === "speaking"} bars={44} className="h-8" tone={state === "idle" ? "muted" : "accent"} />
</div>
</div>

<div className="hairline-card p-3">
<div className="flex items-center justify-between">
<p className="label">Live transcript</p>
<span className="chip"><Activity className="h-2.5 w-2.5" /> {agentName}</span>
</div>
<div className="transcript-scroll mt-2 max-h-[150px] space-y-1.5 overflow-y-auto">
{result?.session?.transcriptPreview ? (
<p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--glass-soft)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">
{result.session.transcriptPreview}
</p>
) : (
<p className="px-1 py-4 text-center text-[10.5px] leading-relaxed text-[var(--text-muted)]">
Transcription appears here once the SIP participant is connected and the agent starts listening.
</p>
)}
{result?.session ? (
<p className="font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
session {result.session.state} · {formatRelative(result.session.startedAt)} · {result.session.codec}
</p>
) : null}
</div>
<div className="mt-2 flex items-center justify-between border-t border-[var(--border-subtle)] pt-2">
<span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
<Radio className="h-2.5 w-2.5" /> {result?.action ?? "idle"}
</span>
<span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
<Smartphone className="h-2.5 w-2.5" /> dial {pretty}
</span>
</div>
</div>
</div>
</div>
</div>
</div>
);
}
