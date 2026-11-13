"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OrbVisualizer } from "@/components/audio/OrbVisualizer";
import { AudioStatePill, BargeInPill, LatencyPill, Waveform } from "@/components/audio/Waveform";
import { Icon, Pill } from "@/components/ui/primitives";
import { useBrowserVoice } from "@/hooks/useBrowserVoice";
import { streamReceptionistChat } from "@/lib/chat-client";
import { formatClock } from "@/lib/format";
import type { ChatTurn, Language, OpenState, TranscriptMessage, VoiceState } from "@/lib/types";

interface ShowcaseExperienceProps {
  slug: string;
  workspaceSlug: string;
  workspaceName: string;
  agentName: string;
  greetingDa: string;
  greetingEn: string;
  initialLanguage: Language;
  allowDanish: boolean;
  allowEnglish: boolean;
  openState: OpenState;
  escalationPhone: string;
  knowledgeCount: number;
}

function messageId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function ShowcaseExperience({
  slug,
  workspaceSlug,
  workspaceName,
  agentName,
  greetingDa,
  greetingEn,
  initialLanguage,
  allowDanish,
  allowEnglish,
  openState,
  escalationPhone,
  knowledgeCount,
}: ShowcaseExperienceProps) {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<VoiceState>("idle");
  const [mode, setMode] = useState<"live" | "local">("local");
  const [providerLabel, setProviderLabel] = useState("grounded brain");
  const [latencyMs, setLatencyMs] = useState(150);
  const [toolNotes, setToolNotes] = useState<string[]>([]);
  const [bargeIns, setBargeIns] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [leadCaptured, setLeadCaptured] = useState(false);

  const [leadName, setLeadName] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadChannel, setLeadChannel] = useState<"browser" | "phone">("phone");
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [leadResult, setLeadResult] = useState<{ reference: string; message: string } | null>(null);
  const [leadError, setLeadError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sessionStartedAt = useRef<number | null>(null);
  const conversationCounted = useRef(false);
  const speakRef = useRef<(text: string, spokenLanguage?: Language) => Promise<void>>(async () => undefined);

  const greeting = language === "da" ? greetingDa : greetingEn;

  const pushMessage = useCallback((role: "agent" | "caller", text: string): void => {
    setMessages((previous) => [...previous, { id: messageId(), role, text, at: new Date().toISOString() }]);
  }, []);

  const sendMessage = useCallback(
    async (raw: string): Promise<void> => {
      const text = raw.trim();
      if (!text || busy) return;
      setError(null);
      setBusy(true);
      const userMessage: TranscriptMessage = { id: messageId(), role: "caller", text, at: new Date().toISOString() };
      const nextMessages = [...messages, userMessage];
      setMessages(nextMessages);
      setInput("");
      setStatus("thinking");
      setStreamingText("");

      const history: ChatTurn[] = nextMessages.map((message) => ({
        role: message.role === "agent" ? "assistant" : "user",
        content: message.text,
      }));

      try {
        const result = await streamReceptionistChat({
          workspaceSlug,
          messages: history,
          language,
          channel: "browser",
          callerName: leadName || undefined,
          callerPhone: leadPhone || undefined,
          onDelta: (delta) => setStreamingText((previous) => previous + delta),
          onTool: (name, summary) => {
            setToolNotes((previous) => [...previous.slice(-3), `${name} · ${summary}`]);
            if (name === "capture_lead" && /saved|captured|already/i.test(summary)) {
              setLeadCaptured(true);
            }
          },
          onMeta: (nextMode, provider) => {
            setMode(nextMode);
            if (provider) setProviderLabel(provider);
          },
          onError: (message) => setError(message),
        });

        setStreamingText("");
        const reply = result.text.trim() || greeting;
        pushMessage("agent", reply);
        if (result.leadCaptured) setLeadCaptured(true);
        setLatencyMs(result.latencyMs);
        setStatus("speaking");
        await speakRef.current(reply, language);
        setStatus(started ? "listening" : "idle");
      } catch (caught) {
        setStreamingText("");
        setError(caught instanceof Error ? caught.message : "The receptionist could not respond");
        setStatus(started ? "listening" : "idle");
      } finally {
        setBusy(false);
      }
    },
    [busy, greeting, language, leadName, leadPhone, messages, pushMessage, started, workspaceSlug],
  );

  const voice = useBrowserVoice({
    language,
    onUtterance: (text) => {
      void sendMessage(text);
    },
    onBargeIn: () => {
      setBargeIns((previous) => previous + 1);
      setToolNotes((previous) => [...previous.slice(-3), "barge-in · caller interrupted the agent"]);
    },
  });

  useEffect(() => {
    speakRef.current = voice.speak;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [voice.speak, messages, streamingText, busy]);

  useEffect(() => {
    if (!started) return;
    const interval = window.setInterval(() => setElapsed((previous) => previous + 1), 1000);
    return () => window.clearInterval(interval);
  }, [started]);

  const trackEvent = useCallback(
    (action: "view" | "conversation"): void => {
      void fetch("/api/showcases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, slug }),
      }).catch(() => undefined);
    },
    [slug],
  );

  useEffect(() => {
    trackEvent("view");
  }, [trackEvent]);

  const startConversation = async (): Promise<void> => {
    setError(null);
    setStarted(true);
    sessionStartedAt.current = Date.now();
    setStatus("listening");
    const granted = await voice.startListening();
    const opening = language === "da" ? greetingDa : greetingEn;
    pushMessage("agent", opening);
    setStatus("speaking");
    await voice.speak(opening, language);
    setStatus(granted ? "listening" : "idle");
    if (!conversationCounted.current) {
      conversationCounted.current = true;
      trackEvent("conversation");
    }
  };

  const saveCall = async (): Promise<void> => {
    const duration = sessionStartedAt.current
      ? Math.round((Date.now() - sessionStartedAt.current) / 1000)
      : elapsed;
    try {
      await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceSlug,
          callerName: leadName.trim() || "Browser visitor",
          callerPhone: leadPhone.trim() || undefined,
          language,
          channel: "browser",
          outcome: leadCaptured ? "qualified" : "info",
          durationSeconds: duration,
          transcript: messages.map((message) => ({
            role: message.role,
            text: message.text,
            at: message.at,
            lang: language,
          })),
          summary: `Public showcase conversation (${slug}) · ${messages.filter((m) => m.role === "caller").length} caller turns`,
        }),
      });
    } catch {
      // Saving the call record must never block the conversation UI.
    }
  };

  const endConversation = (): void => {
    void saveCall();
    voice.endSession();
    setStarted(false);
    setStatus("idle");
    sessionStartedAt.current = null;
  };

  const toggleMute = async (): Promise<void> => {
    if (status === "muted" || voice.listening) {
      voice.stopListening();
      setStatus("muted");
      return;
    }
    const granted = await voice.startListening();
    setStatus(granted ? "listening" : "muted");
  };

  const submitLead = async (): Promise<void> => {
    setLeadSubmitting(true);
    setLeadError(null);
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceSlug,
          name: leadName,
          phone: leadPhone,
          channel: leadChannel,
          language,
          intent: leadChannel === "phone" ? "Instant qualification callback" : "Browser demo follow-up",
          notes: `Captured on showcase /${slug}`,
        }),
      });
      const payload = (await response.json()) as { reference?: string; message?: string; error?: string };
      if (!response.ok || !payload.reference) {
        setLeadError(payload.error ?? "Could not submit your details");
        return;
      }
      setLeadResult({ reference: payload.reference, message: payload.message ?? "Saved." });
      setLeadCaptured(true);
    } catch (caught) {
      setLeadError(caught instanceof Error ? caught.message : "Could not submit your details");
    } finally {
      setLeadSubmitting(false);
    }
  };

  const switchLanguage = (next: Language): void => {
    if (next === language) return;
    setLanguage(next);
    voice.cancelSpeech();
    setStatus(started ? "listening" : "idle");
  };

  const stateLabel: Record<VoiceState, string> = {
    idle: "Ready when you are",
    listening: "Listening — go ahead",
    speaking: `${agentName} is speaking`,
    thinking: "Thinking through your question",
    muted: "Microphone muted",
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Pill tone={mode === "live" ? "live" : "warn"}>
              <span className={mode === "live" ? "dot-live" : "dot-thinking"} />
              {mode === "live" ? "Live model" : "Grounded demo"}
            </Pill>
            <Pill>{knowledgeCount} grounded sources</Pill>
          </div>
          <div className="flex items-center gap-1">
            {allowDanish ? (
              <button
                type="button"
                className={`pill ${language === "da" ? "pill-accent" : ""}`}
                onClick={() => switchLanguage("da")}
              >
                Dansk
              </button>
            ) : null}
            {allowEnglish ? (
              <button
                type="button"
                className={`pill ${language === "en" ? "pill-accent" : ""}`}
                onClick={() => switchLanguage("en")}
              >
                English
              </button>
            ) : null}
          </div>
        </div>

        <div className="relative px-4 pt-4">
          <div className="mx-auto w-full max-w-[360px]">
            <OrbVisualizer
              state={status === "muted" || status === "thinking" ? "idle" : status}
              audioStream={voice.micStream}
            />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center">
            <div className="rounded-full border border-[var(--border-subtle)] bg-[rgba(8,9,12,0.72)] px-3 py-1.5 backdrop-blur">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                {stateLabel[status]}
              </span>
            </div>
          </div>
        </div>

        <div className="px-4 pb-4">
          <Waveform active={status === "listening" || status === "speaking"} bars={56} className="h-10" tone={status === "muted" ? "muted" : "accent"} />

          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
            <AudioStatePill state={status} />
            <BargeInPill />
            <LatencyPill latencyMs={latencyMs} mode={mode} />
            {bargeIns > 0 ? <Pill tone="accent">{bargeIns} barge-in{bargeIns === 1 ? "" : "s"}</Pill> : null}
          </div>

          {voice.interim ? (
            <p className="mt-3 rounded-lg border border-[rgba(201,242,108,0.2)] bg-[rgba(201,242,108,0.05)] px-3 py-2 text-center text-[12.5px] italic text-[var(--text-secondary)]">
              “{voice.interim}”
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {!started ? (
              <button type="button" className="btn btn-accent px-5" onClick={() => void startConversation()}>
                <Icon name="mic" className="h-4 w-4" />
                Start conversation
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-primary" onClick={() => void toggleMute()}>
                  <Icon name={status === "muted" ? "mic" : "wave"} className="h-4 w-4" />
                  {status === "muted" ? "Unmute" : "Mute"}
                </button>
                <button type="button" className="btn btn-danger" onClick={endConversation}>
                  End · {formatClock(elapsed)}
                </button>
              </>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                voice.cancelSpeech();
                setStatus(started ? "listening" : "idle");
              }}
            >
              Stop audio
            </button>
          </div>

          <p className="mt-3 text-center text-[11px] leading-relaxed text-[var(--text-muted)]">
            {openState.isOpen ? `${openState.headline}. ` : `${openState.headline}. `}
            Emergency line {escalationPhone}. No phone number or telephony required — audio stays in your browser.
          </p>

          {voice.error ? (
            <p className="mt-2 rounded-lg border border-[rgba(243,197,107,0.24)] bg-[rgba(243,197,107,0.07)] px-3 py-2 text-center text-[11.5px] text-[var(--warning)]">
              {voice.error}
            </p>
          ) : null}
          {error ? (
            <p className="mt-2 rounded-lg border border-[rgba(255,107,107,0.26)] bg-[rgba(255,107,107,0.07)] px-3 py-2 text-center text-[11.5px] text-[#ffb3b3]">
              {error}
            </p>
          ) : null}
        </div>
      </section>

      <div className="space-y-5">
        <section className="card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className={started ? "dot-live" : "dot-thinking"} />
              <p className="text-[12.5px] font-medium text-[var(--text-primary)]">Live transcript</p>
              <Pill>{language === "da" ? "da-DK" : "en-GB"}</Pill>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
              {providerLabel}
            </span>
          </div>

          <div ref={scrollRef} className="transcript-scroll h-[280px] space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && !streamingText ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <p className="text-[13px] text-[var(--text-secondary)]">{greeting}</p>
                <p className="max-w-[260px] text-[11px] leading-relaxed text-[var(--text-muted)]">
                  Press start and ask about opening hours, prices or an appointment. You can interrupt {agentName} at any
                  time.
                </p>
              </div>
            ) : null}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "caller" ? "justify-end" : "justify-start"} rise`}
              >
                <div className="max-w-[85%]">
                  <p className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    {message.role === "agent" ? agentName : "Caller"} ·{" "}
                    {new Date(message.at).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                  <div
                    className={`rounded-xl px-3 py-2 text-[12.5px] leading-relaxed ${
                      message.role === "caller"
                        ? "bg-[rgba(201,242,108,0.1)] text-[var(--text-primary)]"
                        : "border border-[var(--border-subtle)] bg-white/[0.025] text-[var(--text-secondary)]"
                    }`}
                  >
                    {message.text}
                  </div>
                </div>
              </div>
            ))}
            {streamingText ? (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-xl border border-[rgba(201,242,108,0.24)] bg-[rgba(201,242,108,0.05)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--text-primary)]">
                  {streamingText}
                  <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-[var(--accent-primary)] align-middle" />
                </div>
              </div>
            ) : null}
            {busy && !streamingText ? (
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                <span className="dot-thinking" /> {agentName} is retrieving the answer…
              </div>
            ) : null}
          </div>

          {toolNotes.length > 0 ? (
            <div className="border-t border-[var(--border-subtle)] px-4 py-2">
              {toolNotes.map((note, index) => (
                <p key={`${note}-${index}`} className="truncate font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                  ↳ {note}
                </p>
              ))}
            </div>
          ) : null}

          <div className="border-t border-[var(--border-subtle)] p-3">
            <div className="flex items-center gap-2">
              <input
                className="input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage(input);
                  }
                }}
                placeholder="Or type your question here…"
                aria-label="Type a message to the receptionist"
              />
              <button
                type="button"
                className="btn btn-primary btn-sm h-[36px]"
                onClick={() => void sendMessage(input)}
                disabled={busy || input.trim().length === 0}
              >
                Send
              </button>
            </div>
          </div>
        </section>

        <section className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="label">Instant lead-to-call</p>
              <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                Test a browser call now, or have {agentName} call you back.
              </p>
            </div>
            {leadCaptured ? <Pill tone="live">Lead captured</Pill> : null}
          </div>

          {leadResult ? (
            <div className="mt-3 rounded-lg border border-[rgba(110,231,183,0.26)] bg-[rgba(110,231,183,0.07)] px-3 py-3">
              <p className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--success)]">
                <Icon name="check" className="h-3.5 w-3.5" />
                Reference {leadResult.reference}
              </p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-secondary)]">{leadResult.message}</p>
              <button
                type="button"
                className="btn btn-ghost btn-sm mt-2"
                onClick={() => {
                  setLeadResult(null);
                  setLeadName("");
                  setLeadPhone("");
                }}
              >
                Submit another
              </button>
            </div>
          ) : (
            <>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <input
                  className="input"
                  value={leadName}
                  onChange={(event) => setLeadName(event.target.value)}
                  placeholder="Full name"
                  autoComplete="name"
                />
                <input
                  className="input"
                  value={leadPhone}
                  onChange={(event) => setLeadPhone(event.target.value)}
                  placeholder="+45 20 00 00 00"
                  type="tel"
                  autoComplete="tel"
                />
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setLeadChannel("phone")}
                  className={`hairline-card flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                    leadChannel === "phone" ? "border-[rgba(201,242,108,0.4)] bg-[rgba(201,242,108,0.06)]" : ""
                  }`}
                >
                  <Icon name="phone" className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                  <span>
                    <span className="block text-[12px] text-[var(--text-primary)]">Automated callback</span>
                    <span className="block text-[10.5px] text-[var(--text-muted)]">Qualify by phone</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setLeadChannel("browser")}
                  className={`hairline-card flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                    leadChannel === "browser" ? "border-[rgba(201,242,108,0.4)] bg-[rgba(201,242,108,0.06)]" : ""
                  }`}
                >
                  <Icon name="wave" className="h-3.5 w-3.5 text-[var(--accent-secondary)]" />
                  <span>
                    <span className="block text-[12px] text-[var(--text-primary)]">Browser test call</span>
                    <span className="block text-[10.5px] text-[var(--text-muted)]">No telephony</span>
                  </span>
                </button>
              </div>
              {leadError ? <p className="mt-2 text-[11.5px] text-[#ffb3b3]">{leadError}</p> : null}
              <button
                type="button"
                className="btn btn-accent mt-2 w-full"
                onClick={() => void submitLead()}
                disabled={leadSubmitting || leadName.trim().length < 2 || leadPhone.trim().length < 6}
              >
                {leadSubmitting ? "Saving…" : leadChannel === "phone" ? "Queue my qualification call" : "Link this browser session"}
                <Icon name="arrow" className="h-3.5 w-3.5" />
              </button>
              <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--text-muted)]">
                We store your details with the {workspaceName} workspace and hand the lead to the on-call team. No phone
                system required for the demo.
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}