import { AccessToken } from 'livekit-server-sdk';
import { env } from '@/lib/env';

const DEFAULT_INFERENCE_URL =
  process.env.LIVEKIT_INFERENCE_URL?.replace(/\/$/, '') ||
  'https://agent-gateway.livekit.cloud/v1';

export const DEFAULT_INFERENCE_MODEL =
  process.env.INFERENCE_LLM_MODEL || 'google/gemini-2.5-flash';

let tokenCache: { token: string; expiresAt: number } | null = null;

async function inferenceToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - 60_000 > now) return tokenCache.token;

  const accessToken = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: 'omni-web-ai',
    ttl: 600,
  });
  accessToken.addInferenceGrant({ perform: true });
  const token = await accessToken.toJwt();
  tokenCache = { token, expiresAt: now + 600_000 };
  return token;
}

export class InferenceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'InferenceError';
  }
}

/** Accepts strict JSON, or JSON wrapped in a markdown fence by a chat model. */
export function parseJsonObject(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new InferenceError('The model did not return valid JSON.');
  }
}

export async function inferenceJson({
  system,
  user,
  model = DEFAULT_INFERENCE_MODEL,
  maxTokens = 1600,
  temperature = 0.2,
  timeoutMs = 45_000,
}: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${DEFAULT_INFERENCE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await inferenceToken()}`,
          'Content-Type': 'application/json',
          'User-Agent': 'NORDIC-OMNI/1.0',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_object' },
          max_tokens: maxTokens,
          temperature,
        }),
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new InferenceError(
          `Inference request failed (${response.status})`,
          response.status,
        );
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new InferenceError('Inference returned no content.');
      return parseJsonObject(content);
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
  }

  if (lastError instanceof InferenceError) throw lastError;
  throw new InferenceError('Inference is unavailable.');
}
