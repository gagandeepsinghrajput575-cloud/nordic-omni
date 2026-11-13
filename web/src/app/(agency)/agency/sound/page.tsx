import Link from "next/link";
import { ArrowLeft, Router } from "lucide-react";
import { SoundTuner } from "@/components/agency/SoundTuner";
import { buildSoundProfile, getPortalWorkspace } from "@/lib/data";
import type { PersonaVoiceModel } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
title: "Persona sound tuner",
};

const VOICE_MODELS: { key: PersonaVoiceModel; label: string; model: string; engine: string; latencyMs: number }[] = [
{ key: "azure-christel", label: "Azure Christel", model: "da-DK-ChristelNeural", engine: "Azure Neural", latencyMs: 168 },
{ key: "azure-jeppe", label: "Azure Jeppe", model: "da-DK-JeppeNeural", engine: "Azure Neural", latencyMs: 172 },
{ key: "elevenlabs-turbo-da", label: "ElevenLabs Turbo v2.5 DA", model: "eleven_turbo_v2_5", engine: "ElevenLabs", latencyMs: 214 },
{ key: "azure-sofie", label: "Azure Sofie", model: "da-DK-SofieNeural", engine: "Azure Neural", latencyMs: 165 },
];

const EQ_PROFILES = [
{ key: "warm-mid", lowShelf: "+2.5dB @ 120Hz", mid: "+1.2dB @ 1.2kHz", highShelf: "-4.5dB above 6kHz", notes: "Warm Danish mid-range — tames tinny mobile speakers on iPhone and Android." },
{ key: "flat", lowShelf: "0dB", mid: "0dB", highShelf: "0dB", notes: "Neutral reference profile for wired desk phones and SIP conference hardware." },
{ key: "presence", lowShelf: "-1.0dB @ 120Hz", mid: "+2.4dB @ 2.4kHz", highShelf: "0dB above 6kHz", notes: "Adds intelligibility for callers on car Bluetooth or windy streets." },
];

export default async function SoundTunerPage() {
const workspace = await getPortalWorkspace();
const profile = buildSoundProfile(workspace);

return (
<div className="space-y-4">
<Link href="/agency/telephony" className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
<ArrowLeft className="h-3 w-3" /> Telephony hub
</Link>
<SoundTuner
workspaceSlug={workspace.slug}
workspaceName={workspace.name}
agentName={workspace.agentName}
greetingDa={workspace.greetingDa}
greetingEn={workspace.greetingEn}
initialProfile={profile}
voiceModels={VOICE_MODELS}
eqProfiles={EQ_PROFILES}
/>
<div className="glass flex flex-wrap items-center justify-between gap-2 p-3">
<p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
Profile changes are written to the workspace record and picked up by the SIP dispatch handler on the next call
attempt — active calls keep their original render.
</p>
<Link href="/agency/telephony" className="btn btn-ghost btn-sm">
<Router className="h-3.5 w-3.5" /> DID routing
</Link>
</div>
</div>
);
}
