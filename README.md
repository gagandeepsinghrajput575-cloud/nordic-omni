# Project NORDIC-OMNI: Multi-Tenant Omnichannel Voice & Meta AI Platform

Zero-cost ($0 WebRTC default + +45 FlyNumber SIP) Multi-Tenant Real-Time Voice Agent & Meta AI Platform tailored for the Danish Nordic market.

---

## Architecture Overview

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
┌─────────────────────────┐               ┌──────────────────────────┐
│   Instant Mobile Client │               │   Next.js 15 Reactive    │
│   (/call/[contactId])   │               │   Command Center (web/)  │
└────────────┬────────────┘               └─────────────┬────────────┘
             │ WebRTC Audio                             │ Supabase Realtime & API
             ▼                                          ▼
┌────────────────────────────────────────────────────────────────────┐
│                    LiveKit Cloud / Self-Hosted SFU                 │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │ WebRTC Audio Tracks
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│                   Python Voice Engine (agent-worker/)              │
│  - Ear: Deepgram Nova-2 (language="multi" auto da/en)              │
│  - Brain: DeepSeek V3 / Groq Llama 3.3 70b                         │
│  - Voice: Azure Neural (da-DK-Christel / en-US-Ava / Jeppe)        │
│  - Tools: CRM mutation, Knowledge & Availability, Warm Transfer    │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │ Mutations & Event Bus
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│                       Supabase PostgreSQL                          │
│  - Tenants, Contacts, Omnichannel Messages, Call Logs              │
│  - Bi-directional UI Command Bus (ui_command_events)              │
│  - S3 Call Recording Storage Bucket (call-recordings)              │
└────────────────────────────────────────────────────────────────────┘
```

---

## Local Setup & Quickstart Walkthrough

### Step 1: Boot the Database (Supabase)
1. Open your project dashboard at [supabase.com](https://supabase.com/).
2. In the left navigation bar, click the **SQL Editor** icon (`>_`).
3. Click **New Query**, paste the complete contents of [`supabase/migrations/0001_initial_multi_tenant_schema.sql`](file:///Users/gaganrajput11/the%20final%20form/supabase/migrations/0001_initial_multi_tenant_schema.sql) into the editor, and click **Run**.
4. **Confirm Success**:
   - Go to **Table Editor** and verify that `tenants`, `contacts`, `omnichannel_messages`, `call_logs`, `knowledge_items`, and `ui_command_events` exist with pre-seeded demo rows.
   - Go to **Storage**, click **New Bucket**, name it `call-recordings`, set it to **Public**, and save.
5. **Retrieve Credentials**:
   - Go to **Project Settings > API**.
   - Copy the **Project URL**, the **anon public key**, and the **service_role secret key**.

---

### Step 2: Configure and Boot the Frontend (Next.js)
1. Open your terminal in the `web/` directory:
   ```bash
   cd web
   ```
2. Ensure dependencies are installed:
   ```bash
   npm install
   ```
3. Configure `web/.env.local` with your credentials:
   ```env
   # App URL
   NEXT_PUBLIC_APP_URL=http://localhost:3000

   # Supabase
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

   # LiveKit Cloud
   NEXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud
   LIVEKIT_API_KEY=your_livekit_api_key
   LIVEKIT_API_SECRET=your_livekit_api_secret

   # LLM Brain (DeepSeek or Groq)
   DEEPSEEK_API_KEY=your_deepseek_api_key
   # GROQ_API_KEY=your_groq_api_key

   # Meta Webhook Verification
   META_VERIFY_TOKEN=nordic_omni_verify
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Open [http://localhost:3000/super-admin](http://localhost:3000/super-admin) in your browser. You will see the tenant management deck populated with the seeded workspaces.

---

### Step 3: Configure and Boot the Python Voice Worker
1. Open a second terminal window in the `agent-worker/` directory:
   ```bash
   cd agent-worker
   ```
2. Create and activate a Python virtual environment:
   - **macOS / Linux**:
     ```bash
     python3 -m venv venv
     source venv/bin/activate
     ```
   - **Windows**:
     ```bash
     python -m venv venv
     venv\Scripts\activate
     ```
3. Install the required Python packages:
   ```bash
   pip install -r requirements.txt
   ```
4. Configure `agent-worker/.env`:
   ```env
   LIVEKIT_URL=wss://your-project.livekit.cloud
   LIVEKIT_API_KEY=your_livekit_api_key
   LIVEKIT_API_SECRET=your_livekit_api_secret
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   DEEPGRAM_API_KEY=your_deepgram_api_key
   DEEPSEEK_API_KEY=your_deepseek_api_key
   AZURE_SPEECH_KEY=your_azure_speech_key
   AZURE_SPEECH_REGION=westeurope
   ```
5. Start the worker process:
   ```bash
   python main.py dev
   ```
   *(For background/production execution, use `python main.py start`)*

---

### Step 4: Run the Live Pitch Simulation
1. In your browser, navigate to:
   ```plaintext
   http://localhost:3000/super-admin
   ```
2. Click **Enter Portal** on one of the client workspaces (e.g., `kbh-vvs`).
3. Locate the **🎯 Live Pitch Simulator** floating drawer in the bottom-left corner of the command center:
   - **Test 1: Lead Form Submission** (`1. Simulate Lead Form`):
     - Ingests an inbound lead for Morten Lindberg.
     - Automatically calculates lead priority score (95 for pipe burst emergency).
     - Instantly animates the card into the **Contacted** column of the Kanban board, updates the top Bento scorecards via Supabase Realtime, and sends an automated WhatsApp reply with a 1-tap call link.
   - **Test 2: Instant WebRTC Voice Call** (`2. Simulate Call Request`):
     - Click on Morten Lindberg's card to open the **Lead 360° Drawer**.
     - View the complete timeline with the incoming WhatsApp request and the clickable `/call/[contactId]` link.
     - Open the link in a browser tab: renders the 60fps frequency-reactive audio orb, connects via WebRTC to your Python agent worker, and greets the caller in Danish with their full shared memory context.
   - **Test 3: Dire Emergency & Live Warm Transfer** (`3. Trigger Dire Alert (+45)`):
     - Spawns the full-screen crimson **Dire Situation Escalation** modal with synthesized dual-tone Web Audio ringtones.
     - Test all three warm transfer controls:
       - **Consult AI**: Spawns a private consult session with the AI while holding the caller.
       - **Instruct AI**: Relays owner instructions directly back to the customer on hold.
       - **Patch Me In Live**: Bridges your browser audio track live into the caller's room.
