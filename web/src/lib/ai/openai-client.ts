/**
 * OpenAI API compatible provider layer.
 *
 * Works against OpenAI, OpenRouter, DeepSeek, Google Gemini's OpenAI-compatible
 * endpoint, local vLLM, Ollama (`/v1`) and any other gateway that implements
 * `POST {baseURL}/chat/completions` with SSE streaming and tool calls.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface FunctionToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIChatMessage {
  role: ChatRole;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

export interface ChatCompletionRequest {
  messages: OpenAIChatMessage[];
  tools?: FunctionToolSchema[];
  toolChoice?: "auto" | "none";
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatCompletionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatCompletionResult {
  content: string;
  toolCalls: OpenAIToolCall[];
  model: string;
  finishReason: string | null;
  usage: ChatCompletionUsage | null;
}

export type ChatStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_calls"; toolCalls: OpenAIToolCall[] }
  | { type: "done"; finishReason: string | null; model: string }
  | { type: "error"; message: string };

export interface OpenAICompatibleConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface TestConnectionReport {
  ok: boolean;
  latencyMs: number;
  model: string;
  message: string;
  sample?: string;
}

export interface OpenAICompatibleClient {
  readonly baseURL: string;
  readonly model: string;
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResult>;
  streamChat(request: ChatCompletionRequest): AsyncGenerator<ChatStreamEvent, void, unknown>;
  listModels(): Promise<string[]>;
  testConnection(): Promise<TestConnectionReport>;
}

export class OpenAICompatibleError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "OpenAICompatibleError";
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_TIMEOUT_MS = 45_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
 * Accepts `https://api.openai.com`, `.../v1`, `.../v1beta/openai`,
 * `http://localhost:11434/v1` and gateway URLs that already include a path.
 */
export function resolveEndpoint(baseURL: string, path: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new OpenAICompatibleError("Provider base URL is required");
  }
  if (trimmed.endsWith(path)) {
    return trimmed;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new OpenAICompatibleError(`Invalid provider base URL: ${baseURL}`);
  }
  const hasPath = url.pathname.replace(/\/+$/, "").length > 0;
  const prefix = hasPath ? "" : "/v1";
  return `${trimmed}${prefix}/${path}`;
}

function parseToolCalls(value: unknown): OpenAIToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const calls: OpenAIToolCall[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const fn = record ? asRecord(record.function) : null;
    if (!record || !fn) continue;
    const name = asString(fn.name);
    if (!name) continue;
    calls.push({
      id: asString(record.id) ?? `call_${calls.length}_${Date.now()}`,
      type: "function",
      function: { name, arguments: asString(fn.arguments) ?? "{}" },
    });
  }
  return calls;
}

function parseUsage(value: unknown): ChatCompletionUsage | null {
  const record = asRecord(value);
  if (!record) return null;
  const prompt = asNumber(record.prompt_tokens) ?? 0;
  const completion = asNumber(record.completion_tokens) ?? 0;
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: asNumber(record.total_tokens) ?? prompt + completion,
  };
}

function extractErrorMessage(body: string, status: number): string {
  const parsed = asRecord(safeJson(body));
  const nested = parsed ? asRecord(parsed.error) : null;
  const message = nested ? asString(nested.message) : null;
  if (message) return message;
  if (body.trim().length > 0 && body.length < 400) return body.trim();
  return `Provider responded with HTTP ${status}`;
}

interface StreamDeltaAccumulator {
  content: string;
  toolCalls: Map<number, { id: string; name: string; args: string }>;
  finishReason: string | null;
  model: string;
}

function accumulateToolDelta(
  acc: StreamDeltaAccumulator,
  index: number,
  delta: Record<string, unknown>,
): void {
  const current = acc.toolCalls.get(index) ?? { id: "", name: "", args: "" };
  const id = asString(delta.id);
  const fn = asRecord(delta.function);
  if (id) current.id = id;
  if (fn) {
    const name = asString(fn.name);
    const args = asString(fn.arguments);
    if (name) current.name = name;
    if (args) current.args += args;
  }
  acc.toolCalls.set(index, current);
}

export function createOpenAICompatibleClient(config: OpenAICompatibleConfig): OpenAICompatibleClient {
  const baseURL = config.baseURL.trim();
  const model = config.model.trim();
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const authHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(config.headers ?? {}),
    };
    if (config.apiKey.trim()) {
      headers.Authorization = `Bearer ${config.apiKey.trim()}`;
    }
    return headers;
  };

  const post = async (
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> => {
    const response = await fetch(resolveEndpoint(baseURL, path), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new OpenAICompatibleError(extractErrorMessage(text, response.status), response.status);
    }
    return response;
  };

  const normalizeRequest = (request: ChatCompletionRequest): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      model,
      messages: request.messages.map((message) => {
        const payload: Record<string, unknown> = { role: message.role, content: message.content };
        if (message.name) payload.name = message.name;
        if (message.tool_call_id) payload.tool_call_id = message.tool_call_id;
        if (message.tool_calls && message.tool_calls.length > 0) payload.tool_calls = message.tool_calls;
        return payload;
      }),
      temperature: request.temperature ?? 0.4,
    };
    if (typeof request.maxTokens === "number") {
      body.max_tokens = request.maxTokens;
    }
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
      body.tool_choice = request.toolChoice ?? "auto";
    }
    return body;
  };

  const client: OpenAICompatibleClient = {
    baseURL,
    model,

    async chat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await post(
          "chat/completions",
          { ...normalizeRequest(request), stream: false },
          controller.signal,
        );
        const payload = asRecord((await response.json()) as unknown);
        if (!payload) {
          throw new OpenAICompatibleError("Provider returned an unexpected response body");
        }
        const choices = Array.isArray(payload.choices) ? payload.choices : [];
        const first = asRecord(choices[0]);
        const message = first ? asRecord(first.message) : null;
        return {
          content: message ? (asString(message.content) ?? "") : "",
          toolCalls: message ? parseToolCalls(message.tool_calls) : [],
          model: asString(payload.model) ?? model,
          finishReason: first ? asString(first.finish_reason) : null,
          usage: parseUsage(payload.usage),
        };
      } catch (error) {
        if (error instanceof OpenAICompatibleError) throw error;
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new OpenAICompatibleError(`Provider timed out after ${Math.round(timeoutMs / 1000)}s`);
        }
        throw new OpenAICompatibleError(
          error instanceof Error ? error.message : "Network request to provider failed",
        );
      } finally {
        clearTimeout(timer);
      }
    },

    async *streamChat(request: ChatCompletionRequest): AsyncGenerator<ChatStreamEvent, void, unknown> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      const acc: StreamDeltaAccumulator = {
        content: "",
        toolCalls: new Map(),
        finishReason: null,
        model,
      };

      try {
        const response = await post(
          "chat/completions",
          { ...normalizeRequest(request), stream: true },
          controller.signal,
        );
        if (!response.body) {
          throw new OpenAICompatibleError("Provider did not return a stream");
        }
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const payload = frame
              .split("\n")
              .filter((line) => line.trimStart().startsWith("data:"))
              .map((line) => line.trimStart().slice(5).trim())
              .join("");
            if (!payload || payload === "[DONE]") continue;
            const parsed = asRecord(safeJson(payload));
            if (!parsed) continue;
            const streamModel = asString(parsed.model);
            if (streamModel) acc.model = streamModel;
            const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
            const choice = asRecord(choices[0]);
            if (!choice) continue;
            const delta = asRecord(choice.delta);
            const finish = asString(choice.finish_reason);
            if (finish) acc.finishReason = finish;
            if (!delta) continue;
            const text = asString(delta.content);
            if (text) {
              acc.content += text;
              yield { type: "text", text };
            }
            if (Array.isArray(delta.tool_calls)) {
              delta.tool_calls.forEach((entry, position) => {
                const record = asRecord(entry);
                if (!record) return;
                const index = asNumber(record.index) ?? position;
                accumulateToolDelta(acc, index, record);
              });
            }
          }
        }

        const toolCalls: OpenAIToolCall[] = [...acc.toolCalls.entries()]
          .sort(([a], [b]) => a - b)
          .filter(([, call]) => call.name.length > 0)
          .map(([index, call]) => ({
            id: call.id || `call_${index}_${Date.now()}`,
            type: "function" as const,
            function: { name: call.name, arguments: call.args || "{}" },
          }));

        if (toolCalls.length > 0) {
          yield { type: "tool_calls", toolCalls };
        }
        yield { type: "done", finishReason: acc.finishReason, model: acc.model };
      } catch (error) {
        const message =
          error instanceof OpenAICompatibleError
            ? error.message
            : error instanceof DOMException && error.name === "AbortError"
              ? `Provider timed out after ${Math.round(timeoutMs / 1000)}s`
              : error instanceof Error
                ? error.message
                : "Provider streaming failed";
        yield { type: "error", message };
      } finally {
        clearTimeout(timer);
        if (reader) {
          await reader.cancel().catch(() => undefined);
        }
      }
    },

    async listModels(): Promise<string[]> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetch(resolveEndpoint(baseURL, "models"), {
          headers: authHeaders(),
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) {
          throw new OpenAICompatibleError(extractErrorMessage(await response.text(), response.status), response.status);
        }
        const payload = asRecord((await response.json()) as unknown);
        const data = payload && Array.isArray(payload.data) ? payload.data : [];
        return data
          .map((entry) => {
            const record = asRecord(entry);
            return record ? asString(record.id) : null;
          })
          .filter((id): id is string => typeof id === "string" && id.length > 0);
      } catch (error) {
        if (error instanceof OpenAICompatibleError) throw error;
        throw new OpenAICompatibleError(error instanceof Error ? error.message : "Could not list models");
      } finally {
        clearTimeout(timer);
      }
    },

    async testConnection(): Promise<TestConnectionReport> {
      const startedAt = performance.now();
      const result = await client.chat({
        messages: [
          {
            role: "system",
            content: "You are a connectivity probe. Answer with exactly one word.",
          },
          { role: "user", content: "Reply with: ready" },
        ],
        maxTokens: 8,
        temperature: 0,
      });
      const latencyMs = Math.round(performance.now() - startedAt);
      return {
        ok: true,
        latencyMs,
        model: result.model,
        message: `Connected to ${result.model} in ${latencyMs}ms`,
        sample: result.content.trim().slice(0, 120),
      };
    },
  };

  return client;
}