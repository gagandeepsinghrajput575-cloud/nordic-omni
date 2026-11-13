import Link from "next/link";
import { ArrowLeft, Terminal } from "lucide-react";
import { AGENT_WORKER_FILES, TELEPHONY_ARCHITECTURE } from "@/lib/telephony-architecture";
import { PanelHeader } from "@/components/ui/studio";
import { Pill } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export const metadata = {
title: "Telephony architecture",
};

export default function TelephonyArchitecturePage() {
return (
<div className="space-y-4">
<div>
<Link href="/agency/telephony" className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
<ArrowLeft className="h-3 w-3" /> Telephony hub
</Link>
<div className="mt-2 flex flex-wrap items-center gap-1.5">
<Pill tone="accent">FlyNumber → LiveKit SIP</Pill>
<Pill tone="live">DA production</Pill>
<Pill>&lt; 600ms round trip</Pill>
</div>
<h1 className="display mt-3 text-[25px] text-[var(--text-primary)] sm:text-[30px]">Telephony audio architecture</h1>
<p className="mt-2 max-w-3xl text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
How a Danish PSTN call reaches the tenant&apos;s receptionist, how the audio is shaped for mobile handsets, and
the worker configuration that keeps turn-taking inside a 600 ms budget.
</p>
</div>

<div className="grid gap-3 lg:grid-cols-3">
{TELEPHONY_ARCHITECTURE.map((lane) => (
<section key={lane.id} className="card overflow-hidden">
<PanelHeader title={lane.label} subtitle={`${lane.stages.length} stages`} icon={Terminal} />
<p className="border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">{lane.summary}</p>
<ol className="divide-y divide-[var(--border-subtle)]">
{lane.stages.map((stage) => (
<li key={stage.id} className="px-3 py-2.5">
<div className="flex items-start justify-between gap-2">
<p className="text-[11.5px] text-[var(--text-primary)]">{stage.title}</p>
{typeof stage.latencyMs === "number" ? (
<span className="num shrink-0 font-mono text-[9.5px] text-[var(--text-muted)]">{stage.latencyMs}ms</span>
) : null}
</div>
<p className="mt-1 text-[10.5px] leading-relaxed text-[var(--text-muted)]">{stage.detail}</p>
{stage.code ? (
<pre className="mt-1.5 overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-ground)] p-2 font-mono text-[9px] leading-relaxed text-[var(--text-secondary)] scroll-thin">
{stage.code}
</pre>
) : null}
</li>
))}
</ol>
</section>
))}
</div>

<div className="grid gap-3 lg:grid-cols-2">
{AGENT_WORKER_FILES.map((file) => (
<section key={file.path} className="card overflow-hidden">
<PanelHeader title={file.path} subtitle={file.language} icon={Terminal} />
<p className="border-b border-[var(--border-subtle)] px-3 py-2 text-[10.5px] leading-relaxed text-[var(--text-muted)]">{file.purpose}</p>
<pre className="max-h-[320px] overflow-auto p-3 font-mono text-[10px] leading-relaxed text-[var(--text-secondary)] scroll-thin">
{file.content}
</pre>
</section>
))}
</div>
</div>
);
}
