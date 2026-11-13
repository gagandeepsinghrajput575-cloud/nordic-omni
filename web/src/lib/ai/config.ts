import "server-only";

import type { Workspace } from "@/db/schema";
import { createOpenAICompatibleClient, type OpenAICompatibleClient } from "@/lib/ai/openai-client";
import type { ProviderStatus } from "@/lib/types";

export interface ResolvedProvider extends ProviderStatus {
  apiKey: string;
}

interface EnvCandidate {
  key: string;
  label: string;
  baseURL: string;
  model: string;
}

function envCandidates(): EnvCandidate[] {
  return [
    {
      key: "OPENAI_API_KEY",
      label: "OpenAI",
      baseURL: process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    },
    {
      key: "OPENROUTER_API_KEY",
      label: "OpenRouter",
      baseURL: "https://openrouter.ai/api/v1",
      model: process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini",
    },
    {
      key: "DEEPSEEK_API_KEY",
      label: "DeepSeek",
      baseURL: "https://api.deepseek.com/v1",
      model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat",
    },
    {
      key: "GEMINI_API_KEY",
      label: "Google Gemini",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash",
    },
    {
      key: "GROQ_API_KEY",
      label: "Groq",
      baseURL: "https://api.groq.com/openai/v1",
      model: process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile",
    },
  ];
}

export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "not set";
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}••••`;
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export function resolveProvider(workspace: Workspace): ResolvedProvider {
  const workspaceKey = workspace.providerApiKey?.trim() ?? "";
  const workspaceBase = workspace.providerBaseUrl?.trim() ?? "";
  const workspaceModel = workspace.providerModel?.trim() ?? "";

  if (workspaceBase && workspaceModel) {
    const envFallback = envCandidates().find((candidate) => Boolean(process.env[candidate.key]));
    const apiKey = workspaceKey || (envFallback ? process.env[envFallback.key] ?? "" : "");
    return {
      configured: true,
      label: workspace.providerLabel?.trim() || "Custom provider",
      baseURL: workspaceBase,
      model: workspaceModel,
      source: "workspace",
      apiKeyHint: maskKey(apiKey),
      apiKey,
    };
  }

  const candidate = envCandidates().find((entry) => Boolean(process.env[entry.key]));
  if (candidate) {
    const apiKey = process.env[candidate.key] ?? "";
    return {
      configured: true,
      label: candidate.label,
      baseURL: candidate.baseURL,
      model: candidate.model,
      source: "environment",
      apiKeyHint: maskKey(apiKey),
      apiKey,
    };
  }

  return {
    configured: false,
    label: "Nordic-Omni local brain",
    baseURL: "",
    model: "grounded-receptionist-v1",
    source: "none",
    apiKeyHint: "not set",
    apiKey: "",
  };
}

export function providerClient(provider: ResolvedProvider): OpenAICompatibleClient {
  return createOpenAICompatibleClient({
    baseURL: provider.baseURL,
    apiKey: provider.apiKey,
    model: provider.model,
    headers: {
      "HTTP-Referer": "https://nordic-omni.dk",
      "X-Title": "Nordic-Omni Receptionist",
    },
  });
}
