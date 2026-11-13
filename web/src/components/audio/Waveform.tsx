import type { VoiceState } from "@/lib/types";

interface WaveformProps {
active?: boolean;
bars?: number;
tone?: "accent" | "muted" | "danger";
className?: string;
}

const HEIGHT_PATTERN = [12, 26, 18, 42, 30, 58, 36, 22, 48, 64, 28, 16, 38, 54, 24, 44];

export function Waveform({ active = true, bars = 48, tone = "accent", className }: WaveformProps) {
const gradient =
tone === "danger"
? "linear-gradient(180deg, var(--danger), rgba(255,107,107,0.25))"
: tone === "muted"
? "linear-gradient(180deg, var(--text-muted), rgba(108,114,132,0.2))"
: "linear-gradient(180deg, var(--accent-primary), rgba(141,180,255,0.35))";

return (
<div className={`flex h-14 items-center gap-[3px] overflow-hidden ${className ?? ""}`} aria-hidden="true">
{Array.from({ length: bars }).map((_, index) => {
const height = HEIGHT_PATTERN[index % HEIGHT_PATTERN.length];
return (
<span
key={index}
className={`wave-bar ${active ? "" : "is-static"}`}
style={{
height: `${active ? height : Math.max(6, height * 0.4)}%`,
background: gradient,
animationDelay: `${(index % 11) * 90}ms`,
animationDuration: `${900 + (index % 7) * 120}ms`,
}}
/>
);
})}
</div>
);
}

const STATE_COPY: Record<VoiceState, { label: string; pill: string; dot: string }> = {
idle: { label: "Ready", pill: "pill", dot: "var(--text-muted)" },
listening: { label: "Listening", pill: "pill-live", dot: "var(--success)" },
speaking: { label: "Speaking", pill: "pill-accent", dot: "var(--accent-primary)" },
thinking: { label: "Thinking", pill: "pill-warn", dot: "var(--accent-secondary)" },
muted: { label: "Muted", pill: "pill-danger", dot: "var(--danger)" },
};

export function AudioStatePill({ state, suffix }: { state: VoiceState; suffix?: string }) {
const copy = STATE_COPY[state];
return (
<span className={copy.pill}>
<span
className={state === "listening" || state === "speaking" ? "dot-live" : "dot-thinking"}
style={{ background: copy.dot }}
/>
{copy.label}
{suffix ? <span className="text-[var(--text-muted)]">· {suffix}</span> : null}
</span>
);
}

export function LatencyPill({ latencyMs, mode }: { latencyMs: number; mode: "live" | "local" }) {
return (
<span className="pill" title="Measured round-trip from speech end to first audio token">
<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
<circle cx="5" cy="5" r="4" stroke="currentColor" strokeOpacity="0.5" />
<path d="M5 2.4V5l1.8 1.1" stroke="currentColor" strokeLinecap="round" />
</svg>
~{Math.max(120, Math.round(latencyMs))}ms · {mode === "live" ? "provider" : "grounded"}
</span>
);
}

export function BargeInPill() {
return <span className="pill-accent pill">≈150ms barge-in</span>;
}








































