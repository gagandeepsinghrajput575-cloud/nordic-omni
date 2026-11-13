import { readNdjson } from "@/lib/ai/utils";
import type { Channel, ChatTurn, Language } from "@/lib/types";

export interface ChatStreamOptions {
  workspaceSlug: string;
  messages: ChatTurn[];
  language: Language;
  channel: Channel;
  callerName?: string;
  callerPhone?: string;
  onDelta: (text: string) => void;
  onTool?: (name: string, summary: string) => void;
  onMeta?: (mode: "live" | "local", provider: string, model: string) => void;
  onError?: (message: string) => void;
  signal?: AbortSignal;
}

export interface ChatStreamResult {
  text: string;
  latencyMs: number;
  leadCaptured: boolean;
  mode: "live" | "local";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function streamReceptionistChat(options: ChatStreamOptions): Promise<ChatStreamResult> {
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceSlug: options.workspaceSlug,
      messages: options.messages,
      language: options.language,
      channel: options.channel,
      callerName: options.callerName,
      callerPhone: options.callerPhone,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    let message = `Receptionist unavailable (HTTP ${response.status})`;
    try {
      const payload: unknown = await response.json();
      if (isRecord(payload) && typeof payload.error === "string") {
        message = payload.error;
      }
    } catch {
      // Keep the default message.
    }
    throw new Error(message);
  }

  let text = "";
  let latencyMs = 0;
  let leadCaptured = false;
  let mode: "live" | "local" = "local";

  await readNdjson(response, (raw) => {
    if (!isRecord(raw)) return;
    const type = raw.type;
    if (type === "meta") {
      mode = raw.mode === "live" ? "live" : "local";
      options.onMeta?.(mode, typeof raw.provider === "string" ? raw.provider : "", typeof raw.model === "string" ? raw.model : "");
    } else if (type === "delta" && typeof raw.text === "string") {
      text += raw.text;
      options.onDelta(raw.text);
    } else if (type === "tool") {
      options.onTool?.(
        typeof raw.name === "string" ? raw.name : "tool",
        typeof raw.summary === "string" ? raw.summary : "",
      );
    } else if (type === "done") {
      leadCaptured = raw.leadCaptured === true;
      latencyMs = typeof raw.latencyMs === "number" ? raw.latencyMs : 0;
      mode = raw.mode === "live" ? "live" : mode;
      if (typeof raw.text === "string" && raw.text.length > text.length) {
        const remainder = raw.text.slice(text.length);
        if (remainder.length > 0) {
          text = raw.text;
          options.onDelta(remainder);
        }
      }
    } else if (type === "error") {
      options.onError?.(typeof raw.message === "string" ? raw.message : "Receptionist stream failed");
    }
  });

  return { text, latencyMs, leadCaptured, mode };
}