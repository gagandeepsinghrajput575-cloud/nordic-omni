# Zenith Mission Scope Charter: Project NORDIC-OMNI "The Final Boss" Multi-Tenant Platform

## 1. Plan Overview
Transform Project NORDIC-OMNI from a static pre-seeded prototype into a complete, no-code multi-tenant SaaS engine orchestrated with DeepSeek AI onboarding, secure client passkeys, live human takeover ("AI Auto-Pilot" toggle), owner broadcasting, and real LiveKit WebRTC audio.

## 2. In-Scope Capabilities & Milestones
- **M1: Database Schema Migration (`0002_add_passkeys_and_takeover.sql`)**:
  - Add `client_passkey`, `customer_system_prompt`, `copilot_system_prompt`, `active_broadcast_message`, `ai_auto_reply_default` to `tenants`.
  - Add `ai_auto_reply_enabled` (boolean, default true) and `last_human_takeover_at` to `contacts`.
  - Add seed passkeys for demo workspaces.
- **M2: DeepSeek AI Client Architect & Provisioning API (`/api/admin/provision-wizard` & `/api/admin/tenants`)**:
  - Conversational DeepSeek Q&A mode: analyzes unstructured business text/voice, identifies missing fields, and asks clarifying questions.
  - Profile generation mode: synthesizes full tenant config, business hours, DKK/EUR pricing catalog, knowledge rules, and custom voice/chat prompts.
  - Multi-tenant creation API route to insert newly provisioned clients directly into Supabase.
- **M3: Super-Admin No-Code Provisioning Deck (`/super-admin`)**:
  - Interactive "Provision New Client" modal with DeepSeek AI interview tab and manual fine-tuning tab.
  - Displays generated Client Passkey and instant portal link upon creation.
- **M4: Client Passkey Security Gate (`PasskeyAuthModal.tsx`)**:
  - Guards `/portal/[tenantSlug]` so operators and clients must authenticate with their assigned passkey (or master passkey).
  - Persists session in `localStorage` / cookie with clean unlock state.
- **M5: Human Takeover ("AI Auto-Pilot" Toggle) & Chat Intercept**:
  - `Lead360Drawer.tsx`: Add "AI Auto-Pilot" switch. When toggled OFF, human operator takes over and AI auto-replies are silenced.
  - `api/webhooks/meta` & `api/webhooks/lead-form`: Honor `ai_auto_reply_enabled`.
  - Owner can send direct messages over WhatsApp/Instagram/Web directly from the drawer.
- **M6: Owner Broadcasting & Operational Announcements**:
  - Feature in tenant portal allowing the owner to post operational bulletins (e.g., emergency storm priority, holiday hours).
  - Updates `tenants.active_broadcast_message` and syncs live across the UI and agent prompt.
- **M7: LiveKit WebRTC Real Audio Wiring & Python Worker Fix**:
  - Wire `livekit-client` `Room` in `CallClientView.tsx` with local microphone publishing and remote audio track playback.
  - Fix `customer_agent.py` fatal `fnc_ctx.add_context` bug by defining unified `CustomerAgentTools` context class.
  - Fix Danish/English hardcoded strings.

## 3. Explicit Non-Goals
- In-app payment processing (Stripe / MobilePay): Explicitly excluded per user requirement; payments are handled offline/outside the app.
