"use client";

import { useState } from "react";
import type { ProviderCheck } from "@/db/schema";
import type { ProviderStatus, TestConnectionResult } from "@/lib/types";
import { Icon, Pill, SectionHeader } from "@/components/ui/primitives";
import { formatRelative } from "@/lib/format";

const PRESETS = [
  {
    id: "openai-mini",
    label: "OpenAI · gpt-4o-mini",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    hint: "Best cost/latency balance for voice reception.",
  },
  {
    id: "openai-4o",
    label: "OpenAI · gpt-4o",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4o",
    hint: "Highest quality tool calling and Danish nuance.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    hint: "One key, 300+ models, per-request routing.",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    hint: "Low cost, strong function calling.",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash",
    hint: "OpenAI-compatible Gemini endpoint.",
  },
  {
    id: "ollama",
    label: "Local Ollama",
    baseURL: "http://localhost:11434/v1",
    model: "llama3.2",
    hint: "Runs on your own hardware. No key required.",
  },
  {
    id: "vllm",
    label: "Custom vLLM",
    baseURL: "http://localhost:8000/v1",
    model: "mistral-7b-instruct",
    hint: "Any OpenAI-compatible inference server.",
  },
] as const;

interface ProviderPanelProps {
  workspaceSlug: string;
  workspaceName: string;
  provider: ProviderStatus;
  checks: ProviderCheck[];
}

export function ProviderPanel({ workspaceSlug, workspaceName, provider, checks }: ProviderPanelProps) {
  const [baseURL, setBaseURL] = useState(provider.baseURL || "https://api.openai.com/v1");
  const [model, setModel] = useState(provider.model === "grounded-receptionist-v1" ? "gpt-4o-mini" : provider.model);
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState(provider.label === "Nordic-Omni local brain" ? "OpenAI" : provider.label);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<TestConnectionResult | null>(null);
  const [status, setStatus] = useState<ProviderStatus>(provider);
  const [error, setError] = useState<string | null>(null);

  const runTest = async (save: boolean): Promise<void> => {
    setError(null);
    setResult(null);
    setTesting(true);
    try {
      const response = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug, baseURL, model, apiKey, label, save }),
      });
      const payload = (await response.json()) as TestConnectionResult & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Connection test failed");
        return;
      }
      setResult(payload);
      if (payload.saved) {
        setStatus({
          configured: true,
          label,
          baseURL,
          model,
          source: "workspace",
          apiKeyHint: apiKey ? `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}` : status.apiKeyHint,
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Connection test failed");
    } finally {
      setTesting(false);
    }
  };

  const saveOnly = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug, baseURL, model, apiKey, label }),
      });
      const payload = (await response.json()) as { provider?: ProviderStatus; error?: string };
      if (!response.ok || !payload.provider) {
        setError(payload.error ?? "Could not save provider");
        return;
      }
      setStatus(payload.provider);
      setApiKey("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save provider");
    } finally {
      setSaving(false);
    }
  };

  const clearProvider = async (): Promise<void> => {
    setSaving(true);
    await fetch("/api/provider", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceSlug, clear: true }),
    });
    setStatus({
      configured: false,
      label: "Nordic-Omni local brain",
      baseURL: "",
      model: "grounded-receptionist-v1",
      source: "none",
      apiKeyHint: "not set",
    });
    setResult(null);
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        label="AI provider layer"
        title="Bring your own model"
        description="Any OpenAI API compatible endpoint — OpenAI, OpenRouter, DeepSeek, Gemini, local vLLM or Ollama. Credentials are stored per workspace and never shipped to the browser."
        actions={
          <>
            <Pill tone={status.configured ? "live" : "warn"}>
              <span className={status.configured ? "dot-live" : "dot-thinking"} />
              {status.configured ? `${status.label} live` : "Grounded local brain"}
            </Pill>
            <Pill>key {status.apiKeyHint}</Pill>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <p className="label">Connection settings</p>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
              {status.source === "workspace" ? "workspace override" : status.source === "environment" ? "env fallback" : "no key"}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => {
              const active = preset.baseURL === baseURL && preset.model === model;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setBaseURL(preset.baseURL);
                    setModel(preset.model);
                    setLabel(preset.label.split(" · ")[0]);
                  }}
                  className={`pill transition-colors ${active ? "pill-accent" : "hover:text-[var(--text-primary)]"}`}
                  title={preset.hint}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label mb-1.5 block">Base URL</span>
              <input
                className="input"
                value={baseURL}
                onChange={(event) => setBaseURL(event.target.value)}
                placeholder="https://api.openai.com/v1"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <label className="block">
              <span className="label mb-1.5 block">Model</span>
              <input
                className="input"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="gpt-4o-mini"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <label className="block">
              <span className="label mb-1.5 block">API key</span>
              <input
                className="input"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={status.configured ? `Saved key ${status.apiKeyHint}` : "sk-…"}
                type="password"
                autoComplete="off"
              />
            </label>
            <label className="block">
              <span className="label mb-1.5 block">Workspace label</span>
              <input
                className="input"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Nordic-Omni production"
              />
            </label>
          </div>

          <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
            Streaming, function calling and tool-result round-trips are enabled automatically. The test probe sends a
            one-token completion and reports real round-trip latency.
          </p>

          {error ? (
            <p className="mt-3 rounded-lg border border-[rgba(255,107,107,0.28)] bg-[rgba(255,107,107,0.08)] px-3 py-2 text-[12px] text-[#ffb3b3]">
              {error}
            </p>
          ) : null}

          {result ? (
            <div
              className={`mt-3 rounded-lg border px-3 py-2.5 text-[12px] ${
                result.ok
                  ? "border-[rgba(110,231,183,0.26)] bg-[rgba(110,231,183,0.07)] text-[var(--success)]"
                  : "border-[rgba(255,107,107,0.26)] bg-[rgba(255,107,107,0.07)] text-[#ffb3b3]"
              }`}
            >
              <p className="flex items-center gap-2">
                <Icon name={result.ok ? "check" : "shield"} className="h-3.5 w-3.5" />
                {result.message}
              </p>
              {result.sample ? (
                <p className="num mt-1 font-mono text-[11px] text-[var(--text-secondary)]">probe: “{result.sample}”</p>
              ) : null}
              {result.saved ? <p className="mt-1 text-[11px]">Saved to {workspaceName}.</p> : null}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-accent" onClick={() => void runTest(true)} disabled={testing || saving}>
              {testing ? "Pinging model…" : "Test & save connection"}
              <Icon name="plug" className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void saveOnly()} disabled={testing || saving}>
              {saving ? "Saving…" : "Save without test"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void clearProvider()} disabled={saving}>
              Reset to local brain
            </button>
          </div>
        </section>

        <div className="space-y-5">
          <section className="card p-5">
            <p className="label">Resolved runtime</p>
            <dl className="mt-3 space-y-2.5 text-[12.5px]">
              {[
                ["Mode", status.configured ? "Live provider" : "Grounded local brain"],
                ["Endpoint", status.baseURL || "—"],
                ["Model", status.model],
                ["Credentials", status.apiKeyHint],
              ].map(([term, value]) => (
                <div key={term} className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-2 last:border-0 last:pb-0">
                  <dt className="text-[var(--text-muted)]">{term}</dt>
                  <dd className="num max-w-[62%] truncate text-right font-mono text-[11.5px] text-[var(--text-secondary)]" title={value}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {checks && checks.length > 0 ? (
            <section className="card p-5">
              <p className="label">Recent probe audit</p>
              <ul className="mt-3 space-y-2 text-[12px]">
                {checks.slice(0, 5).map((check) => (
                  <li key={check.id} className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2 last:border-0 last:pb-0">
                    <span className="flex items-center gap-2">
                      <span className={check.status === "ok" ? "dot-live" : "dot-danger"} />
                      <span className="font-mono text-[11px] text-[var(--text-secondary)]">{check.latencyMs}ms</span>
                    </span>
                    <span className="text-[11px] text-[var(--text-muted)]">{formatRelative(new Date(check.createdAt))}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
