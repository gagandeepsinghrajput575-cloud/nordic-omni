# RFC 003: "The Final Boss" No-Code Multi-Tenant Engine, DeepSeek AI Architect & Integration Gateways

- **Status**: Draft / Awaiting Review
- **Authors**: Antigravity Pair Programming Engine
- **Target Systems**: `web/` (Next.js 15), `agent-worker/` (LiveKit Voice Agent), `supabase/` (PostgreSQL Schema)

---

## 1. Executive Summary & Problem Statement

Project NORDIC-OMNI has a robust foundation with real-time WebRTC voice telephony, Supabase replication, and a reactive Kanban CRM. However, scaling it into an autonomous agency platform where non-technical operators can spin up, configure, and monetize client profiles without touching code requires addressing four fundamental bottlenecks:

1. **Code-Bound Provisioning**: Adding a new client currently requires writing SQL seeds or manually issuing database queries. There is no visual, zero-code wizard to spin up a new tenant, configure their AI personas, or set their rate cards.
2. **Missing AI Prompt & Knowledge Engineering**: Configuring business logic, voice receptionists, and emergency dispatch prompts currently requires manual copywriting. Operators need an intelligent **DeepSeek AI Provisioning Agent** that interviews the user, organizes fragmented business details, asks follow-up questions, and auto-generates optimized system prompts and knowledge items.
3. **No Client Security or Passkey Isolation**: Workspaces (`/portal/[tenantSlug]`) are currently open URLs without authentication. Clients need a secure **Client Passkey (PIN / Token)** to access their private CRM, voice recordings, and live dispatch feeds.
4. **Integration Gateways for Missing Capabilities**:
   - **Calendar Gateway**: External scheduling bridge for Google Calendar / Cal.com / Outlook.
   - **Payment & Invoicing Gateway**: Stripe / MobilePay instant deposit link generator for emergency call-outs.
   - **Outbound Telephony Bridge**: Forwarding trigger to ring the owner's physical cellular phone (+45 mobile) during dire emergencies.
   - **WebRTC & Worker Bug Resolutions**: Connect real `livekit-client` audio tracks in the browser and fix the fatal `fnc_ctx.add_context` method in Python.

---

## 2. System Architecture & Component Breakdown

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SUPER-ADMIN COMMAND DECK                        │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │       🤖 DeepSeek AI Client Architect & Interview Agent        │   │
│   │  • Unstructured input: "Plumber in Aarhus, Lars, 895kr/hr..."  │   │
│   │  • Interactive Q&A: Clarifies hours, emergency policy, tone    │   │
│   │  • Auto-generates: Prompts, Hours, Pricing Catalog, KB Rules   │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
│                                   │ Generates Profile + Passkey        │
│                                   ▼                                    │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │              Zero-Code Tenant Provisioning Pipeline            │   │
│   │  • Slug generation, FlyNumber SIP binding, Language toggle     │   │
│   │  • Client Passkey Minting (`CPK-XXXXXXXX`)                     │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
└───────────────────────────────────┼────────────────────────────────────┘
                                    │ Provisioned into DB
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        SUPABASE POSTGRESQL & WAL                       │
│  • `tenants` (Added `client_passkey`, `gateway_configs`, `prompts`)    │
│  • `knowledge_items`, `contacts`, `call_logs`, `ui_command_events`     │
└───────────────────────┬────────────────────────────────┬───────────────┘
                        │                                │
            Secure Passkey Authentication                │ Webhook Dispatches
                        │                                │
                        ▼                                ▼
┌────────────────────────────────────────┐   ┌───────────────────────────┐
│       ISOLATED TENANT CRM PORTAL       │   │   INTEGRATION GATEWAYS    │
│  (/portal/[slug] protected by Passkey) │   │                           │
│  • Live Kanban & Scorecards            │   │ 1. Calendar Gateway       │
│  • Word-Level Waveform Audio Player    │   │    (Google/Cal.com sync)  │
│  • Owner Voice & Text Co-Pilot         │   │ 2. Payment Gateway        │
│  • In-Browser LiveKit WebRTC Voice     │   │    (Stripe / MobilePay)   │
│  • Gateway Toggles & Webhook URLs      │   │ 3. PSTN Outbound Dispatch │
└────────────────────────────────────────┘   └───────────────────────────┘
```

---

## 3. Detailed Specifications

### Module A: DeepSeek AI Provisioning Architect (`/api/admin/provision-wizard`)
1. **Interactive Conversational Onboarding**:
   - Accepts raw text or spoken business notes from the operator.
   - Analyzes completeness across 6 pillars:
     - Company identity (Name, Owner, Location, Contact Phone).
     - Language preference (Danish `da-DK` vs English `en-US`).
     - Business Hours (Monday–Sunday standard opening and closing times).
     - Pricing Catalog (Services, hourly rates, fixed packages in DKK/EUR).
     - Emergency & Dire Escalation Rules (Keywords, emergency call-out fees).
     - Persona & Tone (Authoritative, reassuring, formal, friendly).
   - If information is ambiguous or incomplete, returns targeted follow-up questions to prompt the operator.
   - Once confirmed, returns a validated schema payload ready for instant database insertion.

2. **Autonomous Prompt Synthesis**:
   - Synthesizes the **Customer Voice Receptionist Prompt** with strict guidelines on tone, pricing, escalation boundaries, and response conciseness for phone calls.
   - Synthesizes the **Owner Co-Pilot God-Mode Prompt** customized to the owner's preferred operational instructions.

---

### Module B: Zero-Code Tenant Provisioning & Management UI
1. **Visual Provisioning Deck (`/super-admin`)**:
   - **Interactive Modal**: Toggle between "AI Copilot Auto-Fill" and "Manual Fine-Tuning".
   - Generates unique slug, sets primary language, assigns FlyNumber SIP DID or WebRTC mode.
   - Displays real-time preview of the generated system prompt and pricing cards before saving.
2. **Client Passkey System**:
   - Generates a cryptographically strong, human-readable passkey (e.g., `CPK-AARHUS-4921-X9`).
   - Tenant portal checks cookie / localStorage passkey. If not authenticated, displays a branded unlock screen requesting the passkey.
   - Super Admin has a 1-click master access token bypass to enter any client portal.

---

### Module C: Integration Gateways Hub (`/api/gateways/*`)
1. **Calendar Booking Gateway (`/api/gateways/calendar`)**:
   - Dispatches a standardized webhook payload to external scheduling systems (Google Calendar via Zapier/Make, Cal.com API, or custom webhooks) whenever an appointment is marked `booked`.
   - Stores external calendar webhook URLs and API keys in `tenants.gateway_configs`.
2. **Payment & Invoicing Gateway (`/api/gateways/payment`)**:
   - Integrates Stripe Checkout / Payment Link generation for emergency deposits and invoices.
   - When an emergency or booking occurs, generates an instant payment link sent via SMS/WhatsApp.
3. **Outbound PSTN Escalation Gateway (`/api/gateways/telephony-outbound`)**:
   - Dispatches an automated phone call or SIP trunk alert to the owner's physical cellular phone (+45 mobile) during dire emergencies, briefing them on the caller and estimated value.

---

### Module D: Voice Engine & WebRTC Critical Bug Fixes
1. **Python `customer_agent.py` Tool Unification**:
   - Replace broken `fnc_ctx.add_context(...)` calls with a unified `CustomerAgentTools` context class that inherits from or combines `CRMTools`, `KnowledgeTools`, and `WarmTransferTools`.
2. **WebRTC In-Browser Audio Connection (`CallClientView.tsx`)**:
   - Integrate `livekit-client`'s `Room` to actually connect to the LiveKit server, publish local microphone audio, and route remote assistant audio to the browser's audio output.
3. **Egress S3 Credentials**:
   - Support dedicated Supabase S3 Access Keys (`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`) in `egress_recorder.py`.

---

## 4. Schema Migration Plan (`0002_add_passkeys_and_gateways.sql`)

```sql
-- 1. ADD PASSKEY AND GATEWAY CONFIGURATION TO TENANTS
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS client_passkey VARCHAR(64) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS customer_system_prompt TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS copilot_system_prompt TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS gateway_configs JSONB NOT NULL DEFAULT '{
    "calendar_webhook_url": null,
    "calendar_provider": "generic_webhook",
    "stripe_enabled": false,
    "stripe_account_id": null,
    "emergency_sms_forwarding": true,
    "emergency_cellular_forwarding": false
}'::jsonb;

-- Create index on client passkey for instant lookup
CREATE INDEX IF NOT EXISTS idx_tenants_client_passkey ON tenants (client_passkey);

-- Populate initial passkeys for seeded tenants
UPDATE tenants 
SET client_passkey = 'CPK-KBH-8899-DEMO' 
WHERE slug = 'kbh-vvs' AND client_passkey IS NULL;

UPDATE tenants 
SET client_passkey = 'CPK-DENTAL-1234-DEMO' 
WHERE slug = 'nordic-dental' AND client_passkey IS NULL;
```

---

## 5. Verification & Test Strategy
1. **AI Provisioning Wizard Unit & Contract Tests**:
   - Verify unstructured prompt ingestion extracts valid JSON matching `TenantProvisionPayloadSchema`.
   - Verify prompt synthesizes Danish and English variants correctly.
2. **Passkey Auth Guard Integration**:
   - Verify unauthenticated requests to `/portal/[tenantSlug]` are intercepted by the passkey gate.
   - Verify correct passkey unlocks session storage and renders the full CRM.
3. **Gateway Dispatch Verification**:
   - Test Calendar Gateway webhook dispatch upon booking.
   - Test Payment Link mock generation.
4. **LiveKit WebRTC Integration**:
   - Test client room connection and token ingestion.

