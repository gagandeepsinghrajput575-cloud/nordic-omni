"use client";

import { useState } from "react";
import { OrbVisualizer } from "@/components/audio/OrbVisualizer";
import { AudioStatePill, BargeInPill, LatencyPill, Waveform } from "@/components/audio/Waveform";
import { Icon, Pill, SectionHeader } from "@/components/ui/primitives";
import type { VoiceState } from "@/lib/types";

interface VoiceStudioProps {
  agentName: string;
  workspaceName: string;
  greeting: string;
  voiceModel: string;
  providerLabel: string;
  providerMode: "live" | "local";
  hoursHeadline: string;
  escalationPhone: string;
}

const STATES: { state: VoiceState; title: string; body: string }[] = [
  {
    state: "listening",
    title: "Listening",
    body: "Mic stream open, VAD armed. Interrupting the agent triggers a sub-200ms barge-in.",
  },
  {
    state: "speaking",
    title: "Speaking",
    body: "Audio tokens stream from the provider; waveform follows the AnalyserNode envelope.",
  },
  {
    state: "thinking",
    title: "Thinking",
    body: "Tool calls or retrievals in flight. The caller hears a short natural hold.",
  },
  {
    state: "muted",
    title: "Muted",
    body: "Mic muted but the session stays warm, so unmuting does not reload the model.",
  },
];

export function VoiceStudio({
  agentName,
  workspaceName,
  greeting,
  voiceModel,
  providerLabel,
  providerMode,
  hoursHeadline,
  escalationPhone,
}: VoiceStudioProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latency, setLatency] = useState(150);

  const startMicTest = async (): Promise<void> => {
    setError(null);
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      setStream(mic);
      setState("listening");
    } catch {
      setError("Microphone permission was denied. The visualiser will keep running on synthetic cadence.");
      setState("listening");
    }
  };

  const stopMicTest = (): void => {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setState("idle");
  };

  const cycleState = (): void => {
    setState((previous) => {
      if (previous === "idle") return "listening";
      if (previous === "listening") return "thinking";
      if (previous === "thinking") return "speaking";
      if (previous === "speaking") return "muted";
      return "listening";
    });
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        label="Voice studio"
        title="Hear every state before your client does"
        description={`${agentName} is the voice of ${workspaceName}. Preview listening, thinking, speaking and muted states, test the analyser with your own microphone, and read the latency budget that keeps barge-in natural.`}
        actions={
          <>
            <Pill tone={providerMode === "live" ? "live" : "warn"}>
              <span className={providerMode === "live" ? "dot-live" : "dot-thinking"} />
              {providerMode === "live" ? providerLabel : "Local grounded brain"}
            </Pill>
            <Pill tone="accent">{voiceModel}</Pill>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
            <div className="flex items-center gap-2">
              <AudioStatePill state={state} />
              <BargeInPill />
            </div>
            <LatencyPill latencyMs={latency} mode={providerMode} />
          </div>

          <div className="relative px-4 pt-6">
            <div className="mx-auto w-full max-w-[380px]">
              <OrbVisualizer
                state={state === "muted" || state === "thinking" ? "idle" : state}
                audioStream={stream}
              />
            </div>
          </div>

          <div className="px-4 pb-5">
            <Waveform
              active={state === "listening" || state === "speaking" || state === "thinking"}
              bars={64}
              className="h-12"
              tone={state === "muted" ? "muted" : "accent"}
            />
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                className="btn btn-accent btn-sm"
                onClick={() => void startMicTest()}
                disabled={Boolean(stream)}
              >
                <Icon name="mic" className="h-3.5 w-3.5" />
                {stream ? "Mic analyser live" : "Test with my microphone"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={cycleState}>
                Cycle audio state
              </button>
              {stream ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={stopMicTest}>
                  Release mic
                </button>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
              {(["listening", "thinking", "speaking", "muted"] as VoiceState[]).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className={`pill ${state === candidate ? "pill-accent" : ""}`}
                  onClick={() => setState(candidate)}
                >
                  {candidate}
                </button>
              ))}
              <button
                type="button"
                className="pill"
                onClick={() => {
                  setLatency(150);
                  setState("idle");
                  stopMicTest();
                }}
              >
                reset
              </button>
            </div>
            <p className="mt-3 text-center text-[11px] leading-relaxed text-[var(--text-muted)]">
              {hoursHeadline} · escalation {escalationPhone} · all audio stays in the browser during preview.
            </p>
            {error ? <p className="mt-2 text-center text-[11.5px] text-[var(--warning)]">{error}</p> : null}
          </div>
        </section>

        <div className="space-y-5">
          <section className="card p-5">
            <p className="label">Greeting script</p>
            <p className="mt-2 rounded-lg border border-[var(--border-subtle)] bg-[rgba(8,9,12,0.5)] px-3 py-3 text-[13px] leading-relaxed text-[var(--text-secondary)]">
              “{greeting}”
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                ["Turn detect", "~160ms"],
                ["First token", `${providerMode === "live" ? "~420ms" : "~40ms"}`],
                ["Barge-in", "≈150ms"],
              ].map(([term, value]) => (
                <div key={term} className="hairline-card px-2.5 py-2">
                  <p className="label text-[9px]">{term}</p>
                  <p className="num mt-1 font-mono text-[12px] text-[var(--text-primary)]">{value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <p className="label">Audio state contract</p>
            <ul className="mt-3 space-y-3">
              {STATES.map((entry) => (
                <li key={entry.state} className="flex gap-3">
                  <span
                    className="mt-1 h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background:
                        entry.state === "listening"
                          ? "var(--success)"
                          : entry.state === "speaking"
                          ? "var(--accent-primary)"
                          : entry.state === "thinking"
                          ? "var(--accent-secondary)"
                          : "var(--danger)",
                    }}
                  />
                  <div>
                    <p className="text-[12.5px] font-medium text-[var(--text-primary)]">
                      {entry.title}
                      <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                        {entry.state}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--text-muted)]">{entry.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-5">
            <p className="label">Speech-to-speech path</p>
            <ol className="mt-3 space-y-2.5">
              {[
                ["Browser mic", "Opus capture, echo cancellation, zero telephony hop"],
                ["Streaming STT", "Partial transcripts arm the barge-in detector"],
                ["Grounded brain", "System prompt + knowledge + operating hours"],
                ["Tool calls", "Lead capture, hours, escalation — executed server-side"],
                ["Streaming TTS", "Audio starts before the sentence finishes"],
              ].map(([title, body], index) => (
                <li key={title} className="flex gap-3">
                  <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[var(--border-subtle)] font-mono text-[10px] text-[var(--text-muted)]">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-[12.5px] font-medium text-[var(--text-primary)]">{title}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
