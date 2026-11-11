import { z } from 'zod';

/**
 * Environment contract.
 *
 * This deliberately HARD-FAILS instead of silently falling back to mock data.
 * The previous implementation shipped `isPlaceholderDb`, which meant the app
 * happily ran on fake data in production and reported it as "connected".
 */

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Public origin, used to build magic call links.
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),

  // User-scoped connection. Connects as `omni_app`, which is NOT the table
  // owner, so Row Level Security applies to every query.
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Owner-level connection. Bypasses RLS. Used ONLY by webhooks and by the
  // login flow (which must read a user before any identity exists).
  DATABASE_ADMIN_URL: z.string().min(1),

  // 32+ chars. Signs the session cookie.
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

  // --- LiveKit -----------------------------------------------------------------
  NEXT_PUBLIC_LIVEKIT_URL: z.string().min(1).default('ws://localhost:7880'),
  LIVEKIT_API_KEY: z.string().min(1).default('devkey'),
  LIVEKIT_API_SECRET: z.string().min(1).default('secret'),

  // --- LLM ---------------------------------------------------------------------
  // Used by the AI Brain compiler and customer web chat through LiveKit Inference.
  DEEPSEEK_API_KEY: z.string().optional(),
  LIVEKIT_INFERENCE_URL: z.string().url().optional(),
  INFERENCE_LLM_MODEL: z.string().optional(),

  // Optional owner-notification workflow. Without it, escalations are recorded
  // truthfully as "not configured" and no transfer is claimed.
  N8N_ESCALATION_WEBHOOK_URL: z.string().url().optional(),
  N8N_WEBHOOK_SECRET: z.string().optional(),

  // --- Meta --------------------------------------------------------------------
  META_VERIFY_TOKEN: z.string().default('nordic_omni_verify'),
  META_APP_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');

    // Fail loudly. Never degrade to fake data.
    throw new Error(
      `\n\nInvalid environment configuration. Refusing to start.\n${details}\n\n` +
        `Copy web/.env.example to web/.env.local and fill in the missing values.\n`
    );
  }

  return parsed.data;
}

export const env = loadEnv();
