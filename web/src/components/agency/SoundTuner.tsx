"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
AudioLines,
Check,
Ear,
Gauge,
Mic,
Play,
Radio,
Save,
Sliders,
Sparkles,
Square,
Volume2,
Waves,
Wind,
} from "lucide-react";
import { InlineNotice } from "@/components/ui/client-ui";
import { Equalizer, LiveStatus, PanelHeader } from "@/components/ui/studio";
import { Pill } from "@/components/ui/primitives";
import { Waveform } from "@/components/audio/Waveform";
import { pickVoice, speechLocale } from "@/lib/speech";
import type { PersonaVoiceModel, SoundProfile } from "@/lib/types";

interface VoiceModelOption {
key: PersonaVoiceModel;
label: string;
model: string;
engine: string;
latencyMs: number;
}

interface EqOption {
key: string;
lowShelf: string;
mid: string;
highShelf: string;
notes: string;
}

interface SoundTunerProps {
workspaceSlug: string;
workspaceName: string;
agentName: string;
greetingDa: string;
greetingEn: string;
initialProfile: SoundProfile;
voiceModels: VoiceModelOption[];
eqProfiles: EqOption[];
}

const FILLERS_DA = ["Ja, lige et øjeblik.", "Helt sikkert.", "Forstået."];
const FILLERS_EN = ["Yes, one moment.", "Absolutely.", "Understood."];

export function SoundTuner({
workspaceSlug,
workspaceName,
agentName,
greetingDa,
greetingEn,
initialProfile,
voiceModels,
eqProfiles,
}: SoundTunerProps) {
const [profile, setProfile] = useState<SoundProfile>(initialProfile);
const [saving, setSaving] = useState(false);
const [notice, setNotice] = useState<string | null>(null);
const [error, setError] = useState<string | null>(null);
const [previewing, setPreviewing] = useState(false);
const [fillerIndex, setFillerIndex] = useState(0);
const [language, setLanguage] = useState<"da" | "en">("da");
const [vadLevel, setVadLevel] = useState(0);
const [micAllowed, setMicAllowed] = useState(false);
const streamRef = useRef<MediaStream | null>(null);
const audioRef = useRef<{ context: AudioContext; analyser: AnalyserNode; source: MediaStreamAudioSourceNode } | null>(null);
const rafRef = useRef<number>(0);

const activeVoice = useMemo(
() => voiceModels.find((entry) => entry.key === profile.voiceModel) ?? voiceModels[0],
[voiceModels, profile.voiceModel],
);
const activeEq = useMemo(
() => eqProfiles.find((entry) => entry.key === profile.telephonyEq) ?? eqProfiles[0],
[eqProfiles, profile.telephonyEq],
);

const patch = useCallback((next: Partial<SoundProfile>): void => {
setProfile((previous) => ({ ...previous, ...next }));
setNotice(null);
}, []);

useEffect(
() => () => {
if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
cancelAnimationFrame(rafRef.current);
streamRef.current?.getTracks().forEach((track) => track.stop());
if (audioRef.current) {
audioRef.current.source.disconnect();
void audioRef.current.context.close();
audioRef.current = null;
}
},
[],
);

const speak = async (text: string): Promise<void> => {
if (typeof window === "undefined" || !("speechSynthesis" in window)) {
setError("This browser cannot synthesise previews — the profile is still applied to live calls.");
return;
}
window.speechSynthesis.cancel();
const utterance = new SpeechSynthesisUtterance(text);
utterance.lang = speechLocale(language);
utterance.rate = Math.min(2, Math.max(0.5, profile.speechRate));
utterance.volume = Math.min(1, Math.max(0.2, 1 + profile.gainDb / 20));
const voice = pickVoice(language);
if (voice) utterance.voice = voice;
setPreviewing(true);
await new Promise<void>((resolve) => {
utterance.onend = () => resolve();
utterance.onerror = () => resolve();
window.speechSynthesis.speak(utterance);
});
setPreviewing(false);
};

const stopPreview = (): void => {
if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
setPreviewing(false);
};

const toggleMic = async (): Promise<void> => {
if (micAllowed) {
cancelAnimationFrame(rafRef.current);
streamRef.current?.getTracks().forEach((track) => track.stop());
streamRef.current = null;
if (audioRef.current) {
audioRef.current.source.disconnect();
void audioRef.current.context.close();
audioRef.current = null;
}
setMicAllowed(false);
setVadLevel(0);
return;
}
try {
const stream = await navigator.mediaDevices.getUserMedia({
audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
});
streamRef.current = stream;
const context = new AudioContext();
const analyser = context.createAnalyser();
analyser.fftSize = 1024;
analyser.smoothingTimeConstant = 0.75;
const source = context.createMediaStreamSource(stream);
source.connect(analyser);
audioRef.current = { context, analyser, source };
await context.resume();
setMicAllowed(true);
const buffer = new Float32Array(analyser.fftSize);
const loop = (): void => {
const current = audioRef.current;
if (!current) return;
current.analyser.getFloatTimeDomainData(buffer);
let sum = 0;
for (let index = 0; index < buffer.length; index += 1) sum += buffer[index] * buffer[index];
const rms = Math.sqrt(sum / buffer.length);
setVadLevel(Math.min(100, Math.round(rms * 320)));
rafRef.current = requestAnimationFrame(loop);
};
loop();
} catch {
setError("Microphone permission was denied — VAD calibration needs mic access.");
}
};

const save = async (): Promise<void> => {
setSaving(true);
setNotice(null);
setError(null);
try {
const response = await fetch("/api/telephony/sound", {
method: "PUT",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({
workspaceSlug,
voiceModel: profile.voiceModel,
speechRate: profile.speechRate,
vadThreshold: profile.vadThreshold,
bargeInSensitivity: profile.bargeInSensitivity,
telephonyEq: profile.telephonyEq,
}),
});
const payload = (await response.json()) as {
ok?: boolean;
profile?: SoundProfile;
eq?: EqOption;
voiceModel?: VoiceModelOption;
error?: string;
};
if (!response.ok || !payload.ok || !payload.profile) {
setError(payload.error ?? "Could not save the sound profile");
return;
}
setProfile(payload.profile);
setNotice(
`Sound profile saved · ${payload.voiceModel?.label ?? activeVoice?.label ?? "voice"} · ${payload.profile.speechRate.toFixed(2)}x · VAD ${payload.profile.vadThreshold}`,
);
} catch (caught) {
setError(caught instanceof Error ? caught.message : "Could not save the sound profile");
} finally {
setSaving(false);
}
};

const vadZone = profile.vadThreshold > 70 ? "noisy environment" : profile.vadThreshold > 45 ? "typical office" : "quiet room";

return (
<div className="space-y-4">
<div className="flex flex-wrap items-end justify-between gap-3">
<div>
<div className="flex flex-wrap items-center gap-1.5">
<Pill tone="accent">
<Sliders className="h-2.5 w-2.5" /> Persona sound tuner
</Pill>
<LiveStatus label={`${agentName} · ${workspaceName}`} />
<Pill tone="accent">{activeEq?.key ?? "warm-mid"} EQ</Pill>
</div>
<h2 className="display mt-2 text-[20px] text-[var(--text-primary)] sm:text-[24px]">Acoustic profile for phone lines</h2>
<p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-[var(--text-secondary)]">
Tune cadence, endpointing and barge-in for Danish PSTN callers. These values shape the 16 kHz telephony render
only — the browser showcase keeps its 48 kHz profile.
</p>
</div>
<div className="flex flex-wrap items-center gap-1.5">
<button type="button" onClick={() => void toggleMic()} className="btn btn-ghost btn-sm">
<Mic className="h-3.5 w-3.5" /> {micAllowed ? "Stop VAD meter" : "Calibrate with my mic"}
</button>
<button type="button" onClick={() => void save()} disabled={saving} className="btn btn-accent btn-sm">
<Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save profile"}
</button>
</div>
</div>

{notice ? <InlineNotice>{notice}</InlineNotice> : null}
{error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

<div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
<div className="space-y-3">
<section className="card overflow-hidden">
<PanelHeader title="Voice model" subtitle="Telephony render · Danish neural voices" icon={AudioLines} />
<div className="grid gap-2 p-3 sm:grid-cols-2">
{voiceModels.map((option) => {
const active = option.key === profile.voiceModel;
return (
<button
key={option.key}
type="button"
onClick={() => patch({ voiceModel: option.key })}
className={`rounded-xl border p-2.5 text-left transition-colors ${
active
? "border-[color-mix(in_srgb,var(--accent-primary)_45%,transparent)] bg-[var(--accent-soft)]"
: "border-[var(--border-subtle)] bg-[var(--glass-soft)] hover:border-[var(--border-strong)]"
}`}
aria-pressed={active}
>
<span className="flex items-center justify-between gap-2">
<span className="truncate text-[12px] text-[var(--text-primary)]">{option.label}</span>
{active ? <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent-primary)]" /> : null}
</span>
<span className="mt-0.5 block truncate font-mono text-[9.5px] text-[var(--text-muted)]">{option.model}</span>
<span className="mt-1 flex items-center justify-between font-mono text-[9px] text-[var(--text-muted)]">
<span>{option.engine}</span>
<span>{option.latencyMs}ms</span>
</span>
</button>
);
})}
</div>
</section>

<section className="card p-3">
<div className="flex items-center justify-between">
<p className="label">Cadence & endpointing</p>
<span className="chip">{profile.speechRate.toFixed(2)}x · {vadZone}</span>
</div>

<div className="mt-3 space-y-3.5">
<div>
<div className="flex items-center justify-between">
<span className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)]">
<Gauge className="h-3 w-3 text-[var(--text-muted)]" /> Speech rate
</span>
<span className="num font-mono text-[10.5px] text-[var(--text-primary)]">{profile.speechRate.toFixed(2)}x</span>
</div>
<input
type="range"
min={0.95}
max={1.05}
step={0.01}
value={profile.speechRate}
onChange={(event) => patch({ speechRate: Number(event.target.value) })}
className="range mt-2"
aria-label="Speech rate"
/>
<div className="mt-1 flex justify-between font-mono text-[8.5px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
<span>0.95x deliberate</span>
<span>1.00x natural DA</span>
<span>1.05x brisk</span>
</div>
</div>

<div>
<div className="flex items-center justify-between">
<span className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)]">
<Ear className="h-3 w-3 text-[var(--text-muted)]" /> VAD silence threshold
</span>
<span className="num font-mono text-[10.5px] text-[var(--text-primary)]">{profile.vadThreshold}</span>
</div>
<input
type="range"
min={10}
max={90}
step={1}
value={profile.vadThreshold}
onChange={(event) => patch({ vadThreshold: Number(event.target.value) })}
className="range mt-2"
aria-label="VAD silence threshold"
/>
<div className="mt-1 flex justify-between font-mono text-[8.5px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
<span>quick pickup</span>
<span>caller pauses</span>
<span>noisy car</span>
</div>
{micAllowed ? (
<div className="mt-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-ground)] px-2 py-1.5">
<div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
<span className="flex items-center gap-1.5"><Mic className="h-2.5 w-2.5" /> live input</span>
<span>{vadLevel}%</span>
</div>
<div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text-primary)_8%,transparent)]">
<span
className="block h-full rounded-full transition-[width] duration-75"
style={{
width: `${Math.max(2, vadLevel)}%`,
background: vadLevel > profile.vadThreshold ? "var(--accent-primary)" : "var(--text-muted)",
}}
/>
</div>
<p className="mt-1 text-[9px] leading-relaxed text-[var(--text-muted)]">
{vadLevel > profile.vadThreshold ? "Speech detected — agent would keep listening." : "Below threshold — agent would yield the turn."}
</p>
</div>
) : null}
</div>

<div>
<div className="flex items-center justify-between">
<span className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)]">
<Radio className="h-3 w-3 text-[var(--text-muted)]" /> Interruption / barge-in sensitivity
</span>
<span className="num font-mono text-[10.5px] text-[var(--text-primary)]">{profile.bargeInSensitivity}%</span>
</div>
<input
type="range"
min={0}
max={100}
step={1}
value={profile.bargeInSensitivity}
onChange={(event) => patch({ bargeInSensitivity: Number(event.target.value) })}
className="range mt-2"
aria-label="Barge-in sensitivity"
/>
<div className="mt-1 flex justify-between font-mono text-[8.5px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
<span>polite</span>
<span>≈150ms</span>
<span>eager</span>
</div>
</div>

<div>
<div className="flex items-center justify-between">
<span className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)]">
<Volume2 className="h-3 w-3 text-[var(--text-muted)]" /> Telephony gain
</span>
<span className="num font-mono text-[10.5px] text-[var(--text-primary)]">{profile.gainDb > 0 ? "+" : ""}{profile.gainDb} dB</span>
</div>
<input
type="range"
min={-6}
max={2}
step={1}
value={profile.gainDb}
onChange={(event) => patch({ gainDb: Number(event.target.value) })}
className="range mt-2"
aria-label="Telephony gain"
/>
<div className="mt-1 flex justify-between font-mono text-[8.5px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
<span>-6 dB safe</span>
<span>0 dB unity</span>
<span>+2 dB hot</span>
</div>
</div>
</div>

<div className="mt-3 grid gap-2 sm:grid-cols-2">
<label className="block">
<span className="label mb-1 block">Telephony EQ curve</span>
<select
value={profile.telephonyEq}
onChange={(event) => patch({ telephonyEq: event.target.value as SoundProfile["telephonyEq"] })}
className="select py-1.5 text-[11.5px]"
>
{eqProfiles.map((option) => (
<option key={option.key} value={option.key}>
{option.key} · {option.mid}
</option>
))}
</select>
</label>
<div className="flex flex-col justify-end">
<div className="flex items-center gap-1.5">
<button
type="button"
role="switch"
aria-checked={profile.comfortNoise}
aria-label="Comfort noise"
className="switch"
onClick={() => patch({ comfortNoise: !profile.comfortNoise })}
>
<span />
</button>
<span className="text-[11px] text-[var(--text-secondary)]">Comfort noise (CNG)</span>
</div>
<div className="mt-1.5 flex items-center gap-1.5">
<button
type="button"
role="switch"
aria-checked={profile.fillersDa}
aria-label="Danish comfort fillers"
className="switch"
onClick={() => patch({ fillersDa: !profile.fillersDa })}
>
<span />
</button>
<span className="text-[11px] text-[var(--text-secondary)]">Danish filler acknowledgements</span>
</div>
</div>
</div>
</section>

<section className="card p-3">
<div className="flex items-center justify-between">
<p className="label">Comfort fillers · dead-air prevention</p>
<Sparkles className="h-3 w-3 text-[var(--accent-primary)]" />
</div>
<div className="mt-2 flex flex-wrap gap-1.5">
{(language === "da" ? FILLERS_DA : FILLERS_EN).map((filler) => (
<button
key={filler}
type="button"
onClick={() => {
setFillerIndex((previous) => previous + 1);
void speak(filler);
}}
className="chip hover:text-[var(--text-primary)]"
disabled={previewing}
>
{filler}
</button>
))}
<span className="chip">streamed while tools resolve</span>
</div>
<p className="mt-2 text-[10px] leading-relaxed text-[var(--text-muted)]">
While a knowledge lookup or lead write is in flight, the agent streams a short Danish acknowledgement so the
line never sounds dead. Fillers are trimmed to 320 ms and mixed at {profile.gainDb} dB.
</p>
</section>
</div>

<div className="space-y-3">
<section className="card overflow-hidden">
<PanelHeader
title="Preview bench"
subtitle={`${activeVoice?.label ?? agentName} · ${activeEq?.key ?? "warm-mid"}`}
icon={Mic}
actions={<Equalizer active={previewing} bars={5} />}
/>
<div className="p-3">
<div className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--glass-soft)] px-2.5 py-2">
<div className="min-w-0">
<p className="label text-[8.5px]">Dual profile</p>
<p className="mt-0.5 truncate text-[10.5px] text-[var(--text-secondary)]">
{language === "da" ? "Dansk telefonprofil 16 kHz" : "English telephony profile 16 kHz"}
</p>
</div>
<div className="segmented">
<button type="button" aria-pressed={language === "da"} onClick={() => setLanguage("da")}>DA</button>
<button type="button" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>EN</button>
</div>
</div>

<p className="mt-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--glass-soft)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
“{language === "da" ? greetingDa : greetingEn}”
</p>

<Waveform active={previewing} bars={48} className="mt-2 h-10" tone={previewing ? "accent" : "muted"} />

<div className="mt-2 flex flex-wrap items-center gap-1.5">
<button type="button" onClick={() => void speak(language === "da" ? greetingDa : greetingEn)} disabled={previewing} className="btn btn-accent btn-sm">
<Play className="h-3 w-3" /> Preview greeting
</button>
<button type="button" onClick={stopPreview} disabled={!previewing} className="btn btn-ghost btn-sm">
<Square className="h-3 w-3" /> Stop
</button>
<span className="chip">
<Waves className="h-2.5 w-2.5" /> {fillerIndex} filler plays
</span>
</div>

<div className="mt-2 grid grid-cols-2 gap-2">
{[
{ label: "Web showcase", value: "48 kHz · stereo Opus", icon: AudioLines },
{ label: "Phone line", value: "16 kHz · G.711/AMR-WB", icon: Wind },
].map((item) => (
<div key={item.label} className="rounded-lg border border-[var(--border-subtle)] px-2 py-1.5">
<p className="label text-[8.5px]">{item.label}</p>
<p className="mt-0.5 flex items-center gap-1 font-mono text-[9.5px] text-[var(--text-secondary)]">
<item.icon className="h-2.5 w-2.5 text-[var(--text-muted)]" /> {item.value}
</p>
</div>
))}
</div>
</div>
</section>

<section className="card p-3">
<p className="label">EQ & acoustic chain</p>
<div className="mt-2 space-y-1.5">
{[
["Low shelf", activeEq?.lowShelf ?? "+2.5dB @ 120Hz"],
["Mid presence", activeEq?.mid ?? "+1.2dB @ 1.2kHz"],
["High shelf", activeEq?.highShelf ?? "-4.5dB above 6kHz"],
].map(([label, value]) => (
<div key={label} className="flex items-center justify-between gap-2 text-[10.5px]">
<span className="text-[var(--text-muted)]">{label}</span>
<span className="font-mono text-[9.5px] text-[var(--text-secondary)]">{value}</span>
</div>
))}
</div>
<p className="mt-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--glass-soft)] px-2 py-1.5 text-[10px] leading-relaxed text-[var(--text-muted)]">
{activeEq?.notes ?? "Warm mid-range curve tuned for mobile speakers."}
</p>
<div className="mt-2 flex flex-wrap gap-1">
<span className={`pill ${profile.comfortNoise ? "pill-live" : "pill-warn"}`}>CNG {profile.comfortNoise ? "on" : "off"}</span>
<span className={`pill ${profile.fillersDa ? "pill-accent" : "pill-warn"}`}>fillers {profile.fillersDa ? "on" : "off"}</span>
<span className="pill pill-info">NS + RNNoise</span>
</div>
</section>

<section className="card p-3">
<div className="flex items-center justify-between">
<p className="label">Latency trade-off</p>
<span className="chip">{activeVoice?.latencyMs ?? 168}ms TTS</span>
</div>
<div className="mt-2 space-y-2">
{[
["STT endpointing", Math.max(120, 320 - profile.vadThreshold), 320],
["LLM first token", 210, 320],
["TTS first byte", activeVoice?.latencyMs ?? 168, 260],
].map(([label, value, budget]) => (
<div key={String(label)}>
<div className="flex items-center justify-between text-[10px]">
<span className="text-[var(--text-secondary)]">{label}</span>
<span className="num font-mono text-[9.5px] text-[var(--text-muted)]">{value} / {budget}ms</span>
</div>
<div className="meter mt-1">
<span style={{ width: `${Math.min(100, Math.round((Number(value) / Number(budget)) * 100))}%` }} />
</div>
</div>
))}
</div>
<p className="mt-2 text-[10px] leading-relaxed text-[var(--text-muted)]">
Higher VAD thresholds cut false interruptions but add endpointing latency. Keep the combined budget under
600 ms to stay inside the cellular target.
</p>
</section>
</div>
</div>
</div>
);
}
