"use client";

import { useState } from "react";
import type { Showcase, Workspace } from "@/db/schema";
import { Icon, Pill, SectionHeader } from "@/components/ui/primitives";
import { formatRelative, slugify } from "@/lib/format";

interface WorkspaceOption {
  slug: string;
  name: string;
}

interface ShowcasePanelProps {
  workspaceSlug: string;
  workspaceName: string;
  initialShowcases: Showcase[];
  workspaceOptions: WorkspaceOption[];
}

export function ShowcasePanel({
  workspaceSlug,
  workspaceName,
  initialShowcases,
  workspaceOptions,
}: ShowcasePanelProps) {
  const [items, setItems] = useState<Showcase[]>(initialShowcases);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [partnerName, setPartnerName] = useState(workspaceName);
  const [language, setLanguage] = useState("bilingual");
  const [targetWorkspace, setTargetWorkspace] = useState(workspaceSlug);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const createShowcase = async (): Promise<void> => {
    if (title.trim().length < 3) {
      setError("Give the showcase a title your partner will recognise.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/showcases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          title,
          subtitle,
          partnerName,
          language,
          targetWorkspace,
        }),
      });
      const payload = (await response.json()) as { item?: Showcase; error?: string };
      if (!response.ok || !payload.item) {
        setError(payload.error ?? "Could not create the showcase");
        return;
      }
      setItems((previous) => [payload.item as Showcase, ...previous]);
      setTitle("");
      setSubtitle("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the showcase");
    } finally {
      setBusy(false);
    }
  };

  const toggleShowcase = async (item: Showcase): Promise<void> => {
    setItems((previous) => previous.map((entry) => (entry.id === item.id ? { ...entry, enabled: !entry.enabled } : entry)));
    await fetch("/api/showcases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", id: item.id, enabled: !item.enabled }),
    });
  };

  const deleteShowcase = async (item: Showcase): Promise<void> => {
    setItems((previous) => previous.filter((entry) => entry.id !== item.id));
    await fetch("/api/showcases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id: item.id }),
    });
  };

  const copyLink = async (slug: string): Promise<void> => {
    const url = `${window.location.origin}/showcase/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(slug);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setError("Clipboard access was blocked — copy the link manually.");
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        label="Zero-telephony partner showcase"
        title="Pitch rooms that sell themselves"
        description="Generate a public, branded demo where a partner speaks to the receptionist through their browser. Every conversation and lead is attributed back to this workspace."
        actions={<Pill tone="accent">{items.length} showcase{items.length === 1 ? "" : "s"}</Pill>}
      />

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <section className="card h-fit p-5">
          <p className="label">New showcase</p>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="label mb-1.5 block">Title</span>
              <input
                className="input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Meet Freja — construction receptionist"
              />
            </label>
            <label className="block">
              <span className="label mb-1.5 block">Pitch line</span>
              <textarea
                className="textarea"
                value={subtitle}
                onChange={(event) => setSubtitle(event.target.value)}
                placeholder="Speak to the live receptionist. No phone number required."
                style={{ minHeight: 72 }}
              />
            </label>
            <label className="block">
              <span className="label mb-1.5 block">Partner name</span>
              <input className="input" value={partnerName} onChange={(event) => setPartnerName(event.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label mb-1.5 block">Language</span>
                <select className="select" value={language} onChange={(event) => setLanguage(event.target.value)}>
                  <option value="bilingual">Danish + English</option>
                  <option value="da">Danish</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label className="block">
                <span className="label mb-1.5 block">Receptionist</span>
                <select
                  className="select"
                  value={targetWorkspace}
                  onChange={(event) => setTargetWorkspace(event.target.value)}
                >
                  {workspaceOptions.map((option) => (
                    <option key={option.slug} value={option.slug}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {title ? (
              <p className="font-mono text-[10.5px] text-[var(--text-muted)]">
                /showcase/{slugify(title) || "…"}
              </p>
            ) : null}
            {error ? <p className="text-[12px] text-[#ffb3b3]">{error}</p> : null}
            <button type="button" className="btn btn-accent w-full" onClick={() => void createShowcase()} disabled={busy}>
              {busy ? "Creating…" : "Create pitch link"}
              <Icon name="spark" className="h-3.5 w-3.5" />
            </button>
            <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
              The public page uses the browser microphone, real-time barge-in and the same knowledge base & operating
              hours as live calls.
            </p>
          </div>
        </section>

        <div className="space-y-3">
          {items.length === 0 ? (
            <div className="card p-8 text-center text-[13px] text-[var(--text-muted)]">
              No showcases yet — create your first pitch room.
            </div>
          ) : null}
          {items.map((item) => (
            <article key={item.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-[14px] font-medium text-[var(--text-primary)]">{item.title}</h3>
                    <Pill tone={item.enabled ? "live" : "warn"}>{item.enabled ? "Live" : "Paused"}</Pill>
                    <Pill>{item.language === "bilingual" ? "DA + EN" : item.language.toUpperCase()}</Pill>
                  </div>
                  <p className="mt-1.5 line-clamp-2 max-w-xl text-[12px] leading-relaxed text-[var(--text-secondary)]">
                    {item.subtitle || "No pitch line yet."}
                  </p>
                  <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                    {item.partnerName} · /showcase/{item.slug} · {formatRelative(item.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyLink(item.slug)}>
                    {copied === item.slug ? "Copied" : "Copy link"}
                  </button>
                  <a
                    className="btn btn-ghost btn-sm"
                    href={`/showcase/${item.slug}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open
                    <Icon name="external" className="h-3 w-3" />
                  </a>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-[var(--border-subtle)] pt-3">
                <span className="num font-mono text-[11px] text-[var(--text-secondary)]">
                  {(item.accessCount ?? 0).toLocaleString("da-DK")} views
                </span>
                <span className="num font-mono text-[11px] text-[var(--text-secondary)]">
                  {(item.callCount ?? 0).toLocaleString("da-DK")} live conversations
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void toggleShowcase(item)}>
                    {item.enabled ? "Pause" : "Publish"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-[var(--text-muted)]"
                    onClick={() => void deleteShowcase(item)}
                    aria-label={`Delete ${item.title}`}
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

export type { WorkspaceOption };
export type { Workspace };
