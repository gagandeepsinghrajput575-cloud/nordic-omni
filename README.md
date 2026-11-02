# Project NORDIC-OMNI: "The Final Boss" Multi-Tenant Platform
### Real-Time Omnichannel Voice, Meta AI & Autonomous Dispatch Engine

> **Zero-cost ($0 WebRTC default + +45 FlyNumber SIP) Multi-Tenant Voice Agent & Meta CRM platform tailored for the Nordic market.**  
> Powered by Next.js 15, LiveKit SFU, DeepSeek AI, Supabase PostgreSQL, and styled using `Leonxlnx/taste-skill` anti-slop design principles.

---

## ⚡ Quick Links & Live Local Demo Surfaces

Once running locally on port `3000`, explore the primary surfaces:

| Surface | Direct URL | Passkey / Credentials | Highlights & Capabilities |
| :--- | :--- | :--- | :--- |
| **København VVS Portal** | [http://localhost:3000/portal/kbh-vvs?key=CPK-KBH-VVS-2026](http://localhost:3000/portal/kbh-vvs?key=CPK-KBH-VVS-2026) | `CPK-KBH-VVS-2026` | Live Danish dispatch portal, Kanban CRM, taste-skill scorecards, operational broadcast banner, and multi-theme switcher. |
| **Nordic Dental Portal** | [http://localhost:3000/portal/nordic-dental?key=CPK-DENTAL-2026](http://localhost:3000/portal/nordic-dental?key=CPK-DENTAL-2026) | `CPK-DENTAL-2026` | English-first dental tenant workspace showing multi-tenant data isolation and DKK pricing matrix. |
| **Super-Admin Master Deck** | [http://localhost:3000/super-admin](http://localhost:3000/super-admin) | Master Operator | Agency command deck. Launch the **DeepSeek Provisioning Wizard** to spin up new clients with zero code. |
| **Zero-Cost Voice Call Client** | [http://localhost:3000/call/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa](http://localhost:3000/call/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa) | Direct Link | Frequency-reactive WebRTC audio orb with real microphone streaming, low-latency LiveKit connection, and live transcripts. |

---

## 🏛️ System Architecture

```
                      ┌──────────────────────────────────────────────┐
                      │            PSTN Caller (+45 Danish)          │
                      └──────────────────────┬───────────────────────┘
                                             │ Standard PSTN Call
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │             FlyNumber Local DID              │
                      └──────────────────────┬───────────────────────┘
                                             │ SIP Forwarding ($0 Carrier Fee)
                                             ▼
┌─────────────────────────┐               ┌──────────────────────────────────────────┐
│   Instant Mobile Client │               │   Next.js 15 Reactive Command Center     │
│   (/call/[contactId])   │               │   (/portal/[tenantSlug] & /super-admin)  │
└────────────┬────────────┘               └─────────────────────┬────────────────────┘
             │ WebRTC Audio                                     │ Supabase Realtime & API
             ▼                                                  ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│                        LiveKit SFU (Cloud / Self-Hosted)                           │
└─────────────────────────────────┬──────────────────────────────────────────────────┘
                                  │ WebRTC Audio Tracks
                                  ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│                   Python Voice Engine (agent-worker/)                              │
│  - Ear: Deepgram Nova-2 (language="multi" auto da/en)                              │
│  - Brain: DeepSeek V3 / Groq Llama 3.3 70b                                         │
│  - Voice: Azure Neural (da-DK-Christel / en-US-Ava / Jeppe)                        │
│  - Tools: CRM mutation, Knowledge & Availability, Unified CustomerAgentTools       │
└─────────────────────────────────┬──────────────────────────────────────────────────┘
                                  │ Mutations & Event Bus
                                  ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│                               Supabase PostgreSQL                                  │
│  - Multi-Tenant Schema: tenants, contacts, omnichannel_messages, call_logs         │
│  - Passkey Auth (`client_passkey`) & Human Takeover (`ai_auto_reply_enabled`)       │
│  - Bi-directional Command Bus (ui_command_events) & Call Recording S3 Bucket        │
└────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Key Features & Capabilities

### 1. No-Code DeepSeek Client Architect & Provisioning Deck (`/super-admin`)
- **Conversational Onboarding Wizard**: Click **"+ Provision New Client"** to interview the business owner via text or voice dictation.
- **Auto-Synthesized Configuration**: DeepSeek automatically drafts:
  - Custom voice receptionist system prompts (e.g. tone, Danish/English dialect).
  - Internal owner co-pilot prompts.
  - Weekly business hours (`mon`–`sun`).
  - Itemized pricing catalog with DKK rates and service units.
  - Emergency protocols and knowledge base rules.
- **1-Click Tenant Deployment**: Direct insertion into Supabase PostgreSQL, minting a unique client passkey and immediate workspace URL.

### 2. Client Passkey Security Shield (`CPK-...`)
- Every client workspace at `/portal/[tenantSlug]` is guarded by the cryptographic passkey gate ([`PasskeyAuthModal.tsx`](file:///Users/gaganrajput11/the%20final%20form/web/src/components/auth/PasskeyAuthModal.tsx)).
- Passkeys are displayed and copyable with 1 click in `/super-admin`.
- Supports direct URL unlock: `?key=CPK-YOUR-PASSKEY`.

### 3. Live Human Takeover ("AI Auto-Pilot" Switch)
- Located inside the **Lead 360° Drawer** ([`Lead360Drawer.tsx`](file:///Users/gaganrajput11/the%20final%20form/web/src/components/command-center/Lead360Drawer.tsx)).
- **Toggle OFF**: Instantly silences automated AI responses across both the [Meta Webhook](file:///Users/gaganrajput11/the%20final%20form/web/src/app/api/webhooks/meta/route.ts) (WhatsApp/Instagram) and [Lead Form Webhook](file:///Users/gaganrajput11/the%20final%20form/web/src/app/api/webhooks/lead-form/route.ts).
- **Direct Owner Intervention**: The owner can chat directly with customers without AI interference.
- **Toggle ON**: Resumes automated AI customer responses seamlessly.

### 4. Owner Operational Broadcasting Banner
- Located at the top of the tenant command center ([`OwnerBroadcastBanner.tsx`](file:///Users/gaganrajput11/the%20final%20form/web/src/components/command-center/OwnerBroadcastBanner.tsx)).
- Allows owners to post operational announcements (e.g., storm emergencies, holiday schedules) directly over the app.
- Updates `tenants.active_broadcast_message` and syncs live across all connected agent sessions via `ui_command_events`.

### 5. Taste-Skill Anti-Slop Art Direction & Multi-Theme Engine
- Integrated from **`Leonxlnx/taste-skill`** (`design-taste-frontend`), adhering to the **`references/app-screens.md`** rulebook:
  - **Type-First KPIs**: Decorative icon boxes and fake sparklines removed in favor of clean typography and authentic baseline comparisons (`+24.5% vs prior 7d`, `awaiting triage`).
  - **Tabular Numerals**: Numerical figures use `font-variant-numeric: tabular-nums` and `IBM Plex Mono` to prevent layout jitter.
  - **Flat 1px Surfaces**: Replaced generic bloated gradients with clean, tactical 1px borders.
- **3 Dynamic Theme Modes** (accessible via the `ThemeSwitcher` in every navigation bar):
  1. **⚡ Nordic Noir**: Cyber Obsidian (`#07090E`), Hyper-Cyan (`#00F5D4`), and Razor Pink (`#FF2A85`).
  2. **☣️ Industrial Volt**: Pure Black Monolith (`#000000`) and Radioactive Volt (`#D4FF00`).
  3. **☀️ Surgical Daylight**: Technical Paper (`#F4F6F9`), Deep Ink (`#090A10`), and Cobalt Blue (`#1D4ED8`).

### 6. Strict Non-Goal: Zero In-App Payment Gateways
- In strict adherence to operational requirements, **no payment gateways** (Stripe, MobilePay, QuickPay, PayPal) are embedded. All invoicing and payments are handled offline/outside the application.

---

## 🛠️ Step-by-Step Local Run Guide

### 1. Run the Web Application Locally
1. Navigate to the `web/` directory and build the production bundle:
   ```bash
   cd web
   npm run build
   ```
2. Start the local server:
   ```bash
   npm run start
   ```
   *(Or run `npm run dev` for hot-reloading development).*
3. The server starts immediately at **`http://localhost:3000`**.

### 2. Configure Environment Variables (`web/.env.local`)
```env
# Application Host
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Supabase (Runs seamlessly with mock fallback if credentials are placeholder)
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# LiveKit Cloud
NEXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret

# LLM Brain (DeepSeek)
DEEPSEEK_API_KEY=your_deepseek_api_key

# Meta Verification
META_VERIFY_TOKEN=nordic_omni_verify
```

### 3. Run the LiveKit Python Worker (`agent-worker/`)
1. Create and activate a Python 3.10–3.12 virtual environment:
   ```bash
   cd agent-worker
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
2. Start the worker:
   ```bash
   python main.py dev
   ```

---

## 🧪 Verification & Test Suite

The repository includes comprehensive automated verification suites:

### 1. Final Boss Multi-Tenant Verification
Tests passkey format, DeepSeek wizard schemas, full tenant payload validation, human takeover auto-reply silencing, broadcast events, and gateway boundary compliance:
```bash
npx tsx test/final_boss_verification.ts
```
*Result: 100% Passed (All 7 verification checkpoints).*

### 2. Phase 3 Ingress & Contract Verification
Tests lead form webhooks, warm transfer actions, and LiveKit token requests:
```bash
npx tsx test/phase3_ingress_verification.ts
```
*Result: Passed.*

### 3. Deep Bug & English Localization Verification
Tests dual-cased metadata, English translations, and UUID safety:
```bash
npx tsx test/deep_bug_and_localization_verification.ts
```
*Result: Passed.*

### 4. Next.js Production Build Verification
```bash
cd web && npm run build
```
*Result: Zero errors across all 13 routes.*

---

## 🎯 Interactive Walkthrough Checklist

- [x] **Theme Switcher**: Open [http://localhost:3000/portal/kbh-vvs](http://localhost:3000/portal/kbh-vvs) and switch between *Nordic Noir*, *Industrial Volt*, and *Surgical Daylight*.
- [x] **Human Takeover**: Open the Lead 360 Drawer for Morten Bondo, toggle **AI Auto-Pilot OFF**, and verify automated replies are paused.
- [x] **Broadcast Notice**: In the portal header, click **"Rediger Meddelelse"**, post a new operational bulletin, and verify the live update.
- [x] **Passkey Auth**: Open [http://localhost:3000/portal/kbh-vvs](http://localhost:3000/portal/kbh-vvs) without `?key=` in incognito mode and enter `CPK-KBH-VVS-2026`.
- [x] **DeepSeek Provisioning**: Visit [http://localhost:3000/super-admin](http://localhost:3000/super-admin), click **"+ Provision New Client"**, and test conversational onboarding.
- [x] **Voice Client**: Open [http://localhost:3000/call/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa](http://localhost:3000/call/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa) to experience the live WebRTC audio orb.
