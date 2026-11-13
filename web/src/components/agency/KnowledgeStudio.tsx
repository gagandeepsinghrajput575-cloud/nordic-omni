"use client";

import { useEffect, useRef, useState } from "react";
import type { KnowledgeItem } from "@/db/schema";
import { streamReceptionistChat } from "@/lib/chat-client";
import type { ChatTurn, Language } from "@/lib/types";
import { Icon, Pill, SectionHeader, Tag } from "@/components/ui/primitives";

interface KnowledgeStudioProps {
  workspaceSlug: string;
  workspaceName: string;
  agentName: string;
  greeting: string;
  language: Language;
  initialItems: KnowledgeItem[];
  providerLabel: string;
  providerMode: "live" | "local";
}

interface PreviewMessage {
  id: string;
  role: "agent" | "caller";
  text: string;
}

const SUGGESTIONS = [
  "Hvornår har I åbent i morgen?",
  "What does an emergency visit cost?",
  "Jeg har akut brug for hjælp",
];

function newId(): string {
  return `m_${Math.random().toString(36).slice(2, 9)}`;
}

export function KnowledgeStudio({
  workspaceSlug,
  workspaceName,
  agentName,
  greeting,
  language,
  initialItems,
  providerLabel,
  providerMode,
}: KnowledgeStudioProps) {
  const [items, setItems] = useState<KnowledgeItem[]>(initialItems);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<"fact" | "faq" | "document" | "website">("fact");
  const [scrapeUrl, setScrapeUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [messages, setMessages] = useState<PreviewMessage[]>([
    { id: "greeting", role: "agent", text: greeting },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [thinking, setThinking] = useState(false);
  const [toolNotes, setToolNotes] = useState<string[]>([]);
  const [mode, setMode] = useState<"live" | "local">(providerMode);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  const createItem = async (): Promise<void> => {
    if (title.trim().length < 2 || content.trim().length < 8) {
      setError("Add a title and at least one grounded sentence.");
      return;
    }
    setBusy("create");
    setError(null);
    try {
      const response = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", workspaceSlug, title, content, kind }),
      });
      const payload = (await response.json()) as { item?: KnowledgeItem; error?: string };
      if (!response.ok || !payload.item) {
        setError(payload.error ?? "Could not save that knowledge entry");
        return;
      }
      setItems((previous) => [payload.item as KnowledgeItem, ...previous]);
      setTitle("");
      setContent("");
      setNotice("Knowledge entry added — the receptionist is grounded immediately.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save knowledge");
    } finally {
      setBusy(null);
    }
  };

  const scrape = async (): Promise<void> => {
    setBusy("scrape");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scrape", workspaceSlug, url: scrapeUrl }),
      });
      const payload = (await response.json()) as { item?: KnowledgeItem; error?: string };
      if (!response.ok || !payload.item) {
        setError(payload.error ?? "Could not scrape that website");
        return;
      }
      setItems((previous) => [payload.item as KnowledgeItem, ...previous]);
      setScrapeUrl("");
      setNotice("Website content imported into the knowledge base.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not scrape that website");
    } finally {
      setBusy(null);
    }
  };

  const uploadFile = async (file: File): Promise<void> => {
    setBusy("upload");
    setError(null);
    setNotice(null);
    try {
      if (file.size > 400_000) {
        setError("Keep uploads under 400 KB — split larger documents into sections.");
        return;
      }
      const text = await file.text();
      const response = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          workspaceSlug,
          title: file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 120),
          content: text.slice(0, 12_000),
          kind: "document",
        }),
      });
      const payload = (await response.json()) as { item?: KnowledgeItem; error?: string };
      if (!response.ok || !payload.item) {
        setError(payload.error ?? "Could not import that document");
        return;
      }
      setItems((previous) => [payload.item as KnowledgeItem, ...previous]);
      setNotice(`“${file.name}” added as a grounded document.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not import that document");
    } finally {
      setBusy(null);
    }
  };

  const toggleItem = async (item: KnowledgeItem): Promise<void> => {
    setItems((previous) => previous.map((entry) => (entry.id === item.id ? { ...entry, enabled: !entry.enabled } : entry)));
    await fetch("/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", workspaceSlug, id: item.id, enabled: !item.enabled }),
    });
  };

  const deleteItem = async (item: KnowledgeItem): Promise<void> => {
    setItems((previous) => previous.filter((entry) => entry.id !== item.id));
    await fetch("/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", workspaceSlug, id: item.id }),
    });
  };

  const sendPreview = async (raw?: string): Promise<void> => {
    const text = (raw ?? input).trim();
    if (!text || thinking) return;
    const userMessage: PreviewMessage = { id: newId(), role: "caller", text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setThinking(true);
    setStreaming("");
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
        onDelta: (delta) => setStreaming((previous) => previous + delta),
        onTool: (name, summary) => setToolNotes((previous) => [...previous.slice(-2), `${name}: ${summary}`]),
        onMeta: (nextMode) => setMode(nextMode),
      });
      setStreaming("");
      setMessages((previous) => [
        ...previous,
        { id: newId(), role: "agent", text: result.text || "…" },
      ]);
    } catch (caught) {
      setStreaming("");
      setError(caught instanceof Error ? caught.message : "Receptionist preview failed");
    } finally {
      setThinking(false);
    }
  };

  const resetPreview = (): void => {
    setMessages([{ id: "greeting", role: "agent", text: greeting }]);
    setStreaming("");
    setToolNotes([]);
  };

  const activeCount = items.filter((item) => item.enabled).length;

  return (
    <div className="space-y-6">
      <SectionHeader
        label="Knowledge base studio"
        title="Ground every sentence"
        description={`Facts, FAQs, uploaded documents and scraped website copy are injected into ${agentName}'s system prompt. Toggle a source off to remove it instantly.`}
        actions={
          <>
            <Pill tone="accent">{activeCount} live sources</Pill>
            <Pill tone={mode === "live" ? "live" : "warn"}>{mode === "live" ? providerLabel : "Local grounding"}</Pill>
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <section className="card p-5">
            <div className="flex items-center justify-between">
              <p className="label">Add a business fact or FAQ</p>
              <select
                className="select w-auto py-1.5 text-[11px]"
                value={kind}
                onChange={(event) => setKind(event.target.value as "fact" | "faq" | "document" | "website")}
              >
                <option value="fact">Fact</option>
                <option value="faq">FAQ</option>
                <option value="document">Document</option>
              </select>
            </div>
            <div className="mt-3 space-y-2.5">
              <input
                className="input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Opening hours for May bank holidays"
              />
              <textarea
                className="textarea"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="Closed 1 May and 29 May. Emergency line +45 35 43 21 10 stays open 08:00–20:00."
              />
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-[var(--text-muted)]">{content.length}/12000</span>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void createItem()} disabled={busy === "create"}>
                  {busy === "create" ? "Saving…" : "Add knowledge"}
                  <Icon name="plus" className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <section className="card p-4">
              <p className="label">Scrape a website</p>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
                Pull live copy from a home page or services page.
              </p>
              <input
                className="input mt-2.5"
                value={scrapeUrl}
                onChange={(event) => setScrapeUrl(event.target.value)}
                placeholder="https://nordic-omni.dk"
                spellCheck={false}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm mt-2 w-full"
                onClick={() => void scrape()}
                disabled={busy === "scrape" || scrapeUrl.trim().length === 0}
              >
                {busy === "scrape" ? "Scraping…" : "Import page"}
                <Icon name="globe" className="h-3.5 w-3.5" />
              </button>
            </section>
            <section className="card p-4">
              <p className="label">Upload documents</p>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
                .txt, .md, or document text up to 400 KB.
              </p>
              <label className="btn btn-ghost btn-sm mt-2.5 w-full cursor-pointer">
                {busy === "upload" ? "Importing…" : "Choose file"}
                <Icon name="book" className="h-3.5 w-3.5" />
                <input
                  type="file"
                  className="hidden"
                  accept=".txt,.md,.csv,.json,text/plain,application/json"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadFile(file);
                    event.target.value = "";
                  }}
                />
              </label>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">max 400 kb</p>
            </section>
          </div>

          {error ? (
            <p className="rounded-lg border border-[rgba(255,107,107,0.28)] bg-[rgba(255,107,107,0.08)] px-3 py-2 text-[12px] text-[#ffb3b3]">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="rounded-lg border border-[rgba(110,231,183,0.24)] bg-[rgba(110,231,183,0.07)] px-3 py-2 text-[12px] text-[var(--success)]">
              {notice}
            </p>
          ) : null}

          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
              <p className="label">Grounded sources · {items.length}</p>
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">{workspaceName}</span>
            </div>
            <ul className="divide-y divide-[rgba(255,255,255,0.045)]">
              {items.map((item) => (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">{item.title}</span>
                        <Tag>{item.kind}</Tag>
                        {!item.enabled ? <Pill tone="warn">off</Pill> : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-[var(--text-muted)]">{item.content}</p>
                      {item.sourceUrl ? (
                        <a
                          href={item.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-1 font-mono text-[10.5px] text-[var(--accent-secondary)] hover:underline"
                        >
                          {item.sourceUrl}
                          <Icon name="external" className="h-2.5 w-2.5" />
                        </a>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void toggleItem(item)}>
                        {item.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm text-[var(--text-muted)]"
                        onClick={() => void deleteItem(item)}
                        aria-label={`Delete ${item.title}`}
                      >
                        <Icon name="trash" className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
              {items.length === 0 ? (
                <li className="px-4 py-8 text-center text-[12px] text-[var(--text-muted)]">
                  No sources yet. Add a fact, scrape the website, or upload a document.
                </li>
              ) : null}
            </ul>
          </section>
        </div>

        <section className="card flex h-fit flex-col overflow-hidden xl:sticky xl:top-24">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[radial-gradient(circle_at_30%_25%,rgba(201,242,108,0.35),transparent)] text-[10px] font-medium text-[var(--text-primary)]">
                {agentName.slice(0, 1)}
              </span>
              <div>
                <p className="text-[12.5px] font-medium text-[var(--text-primary)]">Test receptionist</p>
                <p className="text-[10.5px] text-[var(--text-muted)]">Live preview · grounded in {activeCount} sources</p>
              </div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={resetPreview}>
              <Icon name="refresh" className="h-3 w-3" />
              Reset
            </button>
          </div>

          <div ref={scrollRef} className="transcript-scroll h-[340px] space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === "caller" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[86%] rounded-xl px-3 py-2 text-[12.5px] leading-relaxed ${
                    message.role === "caller"
                      ? "bg-[rgba(201,242,108,0.12)] text-[var(--text-primary)]"
                      : "border border-[var(--border-subtle)] bg-white/[0.025] text-[var(--text-secondary)]"
                  }`}
                >
                  {message.text}
                </div>
              </div>
            ))}
            {streaming ? (
              <div className="flex justify-start">
                <div className="max-w-[86%] rounded-xl border border-[rgba(201,242,108,0.24)] bg-[rgba(201,242,108,0.05)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--text-primary)]">
                  {streaming}
                  <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-[var(--accent-primary)] align-middle" />
                </div>
              </div>
            ) : null}
            {thinking && !streaming ? (
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                <span className="dot-thinking" /> retrieving grounded answer…
              </div>
            ) : null}
          </div>

          {toolNotes.length > 0 ? (
            <div className="border-t border-[var(--border-subtle)] px-4 py-2">
              {toolNotes.map((note, index) => (
                <p key={`${note}-${index}`} className="truncate font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  ↳ {note}
                </p>
              ))}
            </div>
          ) : null}

          <div className="border-t border-[var(--border-subtle)] p-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="pill hover:text-[var(--text-primary)]"
                  onClick={() => void sendPreview(suggestion)}
                  disabled={thinking}
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                className="input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendPreview();
                  }
                }}
                placeholder="Ask the receptionist anything…"
              />
              <button
                type="button"
                className="btn btn-primary btn-sm shrink-0"
                onClick={() => void sendPreview()}
                disabled={thinking || input.trim().length === 0}
              >
                Send
                <Icon name="send" className="h-3 w-3" />
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
