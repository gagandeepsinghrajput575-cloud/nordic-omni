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

  // --- ElevenLabs Conversational AI (the voice receptionist synthesizer) ----------
  // Optional by design: without a key the bridge reports `configured: false` and the
  // caller is served the browser speech fallback, never a silent half-call.
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_BASE_URL: z.string().url().optional(),
  ELEVENLABS_AGENT_ID: z.string().optional(),
  // A dedicated English agent is optional; without one the Danish agent follows the
  // caller's language, which its prompt already instructs it to do.
  ELEVENLABS_AGENT_ID_EN: z.string().optional(),

  // --- Cal.com (slot synchronisation) ---------------------------------------------
  CALCOM_API_URL: z.string().url().optional(),
  CALCOM_API_KEY: z.string().optional(),
  CALCOM_EVENT_TYPE_ID: z.string().optional(),
  CALCOM_EVENT_SLUG: z.string().optional(),
  CALCOM_TIMEZONE: z.string().optional(),

  // --- Telephony bridge ceilings ---------------------------------------------------
  // Process-wide and per-tenant live-call limits. Refusing at the SIP layer is a
  // fast busy tone; running out mid-call is a caller alone in a silent room.
  TELEPHONY_MAX_CONCURRENT_CALLS: z.coerce.number().int().min(1).max(64).default(8),
  TELEPHONY_MAX_CALLS_PER_TENANT: z.coerce.number().int().min(1).max(64).default(4),

  // --- Meta --------------------------------------------------------------------
  META_VERIFY_TOKEN: z.string().default('nordic_omni_verify'),
  META_APP_SECRET: z.string().optional(),

  // --- Vision AI bridge --------------------------------------------------------
  // Optional: without it the bridge reports itself as unconfigured rather than
  // pretending to deliver. Vision runs on the operator's own machine, so a
  // private base URL is only honoured when explicitly allowed below.
  VISION_AI_BASE_URL: z.string().url().optional(),
  VISION_AI_SECRET: z.string().min(16).optional(),
  VISION_AI_ALLOW_PRIVATE: z.enum(['true', 'false']).optional(),
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
