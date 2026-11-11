# AI Brain, chat and escalation pipeline

This is the operational map for the business-AI layer. It is deliberately
human-in-the-loop: the model compiles and writes drafts, but the agency approves
what becomes live.

```text
Agency onboarding
  website + owner notes + pasted documents
        │
        ▼
safe website fetch (public IPs only, size/time limited)
        │
        ▼
LiveKit Inference compiler (JSON schema, source-only facts)
        │
        ▼
knowledge_bundles: draft + warnings + source provenance
        │
        ├── reject ──► kept for audit, never used
        └── approve ─► knowledge_items (shared by chat + voice)
                       + escalation trigger merge
```

## 1. AI Brain

Agency route: `/agency/clients/[id]` → **AI Brain**.

Inputs:
- a public website (homepage plus up to three same-origin about/service/price/contact/FAQ pages),
- owner notes,
- pasted document text.

Security:
- only `http`/`https`,
- DNS-resolved private, loopback, link-local and metadata addresses are rejected,
- every redirect is revalidated,
- page size is capped at 450 KB, four pages maximum,
- source text is treated as untrusted data and never as instructions.

Output:
- business summary,
- services,
- FAQs,
- policies,
- qualification questions,
- estimate rules,
- guardrails,
- escalation triggers,
- tone notes,
- explicit uncertainties.

Approval writes only generated knowledge items with `bundle_id` and
`source_label`. Previous AI-generated items from older bundles are deactivated,
so recompiling does not duplicate knowledge endlessly. `escalation_triggers` are
merged into the tenant’s existing `emergency_keywords`; existing triggers are
never deleted.

A fallback compilation (inference unavailable) is stored for diagnosis but the
database helper refuses to approve it.

## 2. Customer chat

Public route: `/chat/[contactId]` and `POST /api/chat/[contactId]`.

The chat uses the same `contacts.shared_memory_summary`, CRM stage, price catalog,
active knowledge and recent `messages` as the voice agent.

Rules enforced in the prompt and server:
- 1–3 sentences, at most 70 words, one question per turn.
- No invented facts, prices, guarantees or response times.
- Every estimate is a **vejledende overslag, ikke et bindende tilbud**.
- A model-selected catalog item is never trusted for the amount. The server
  recalculates from the configured catalog and refuses unsupported work.
- An inspection is stored as a **request**, never a confirmed booking.
- A booking stage cannot be set by chat.
- HTML is never rendered from model output; text is escaped by React.

The API rate-limits by contact + IP, caps message length, and refuses paused
tenants. When `ai_auto_reply_enabled` is false, the customer message is recorded
but no AI reply is generated.

## 3. Shared memory

- Chat writes each inbound/outbound message to `messages`, channel `web_chat`.
- Voice reads the last 12 cross-channel messages into its prompt and updates the
  same `contacts.shared_memory_summary`.
- On call shutdown, the voice transcript is written to `messages` with the call’s
  real channel (`voice_inbound` or `voice_instant_webrtc`). A per-call external ID
  makes this idempotent.
- The chat page labels older voice turns as “Telefon”, so the customer experiences
  one continuing conversation rather than two disconnected bots.

## 4. Escalation

Chat and voice both persist into `conversation_escalations` first.

Reasons:
- `angry_customer`
- `high_value_emergency`
- `ai_unanswered_question`
- `human_requested`

The customer is **never** told a human is live. Wording is limited to:
- “request recorded for the office”, or
- “sent to the office workflow” only after the N8N webhook returned 2xx.

The client portal shows an open escalation queue with a **Resolve** action. This
is the fallback when N8N is not configured.

### Optional N8N owner workflow

Set in both web and worker environments:

```dotenv
N8N_ESCALATION_WEBHOOK_URL=https://n8n.example.dk/webhook/omni-escalation
N8N_WEBHOOK_SECRET=replace-with-a-long-random-secret
```

The webhook receives `Content-Type: application/json` with:

```json
{
  "event": "owner_escalation",
  "tenant": { "id": "...", "name": "...", "slug": "..." },
  "contact": { "id": "...", "name": "...", "phone": "...", "email": "..." },
  "owner": { "name": "...", "phone": "...", "email": "..." },
  "channel": "web_chat",
  "reason": "human_requested",
  "urgency": 3,
  "briefing": "One or two sentences for the owner",
  "createdAt": "ISO-8601"
}
```

If `N8N_WEBHOOK_SECRET` is set, the exact raw body is signed:

```text
X-OMNI-Signature: sha256=<hex hmac-sha256(secret, raw body)>
```

The N8N workflow owns SMS/call delivery. Until that workflow exists and returns
2xx, this software only records the request. It does not pretend otherwise.

## 5. What is intentionally not built

- Per-tenant API-key vault controlled from the browser. Keys stay server-side.
- PDF/OCR ingestion. Pasted text and public HTML are supported.
- Automatic approval of AI-generated knowledge. Approval is an agency action.
- Owner phone bridge without N8N or another provider.
- Confirmed calendar bookings. Inspection requests remain unconfirmed.
