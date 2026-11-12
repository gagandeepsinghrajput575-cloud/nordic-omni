# Agency control plane

## Deployment

1. Apply `db/migrations/0012_agency_control_plane.sql` before deploying.
2. Deploy the web app and Python voice worker together.
3. Run the durable webhook worker alongside the web app:

```sh
# From the repository root; load the same environment as the web app.
node --env-file=web/.env.local node_modules/tsx/dist/cli.mjs \
  --tsconfig web/tsconfig.json web/scripts/webhook-worker.ts
# Or, with DATABASE_URL / DATABASE_ADMIN_URL / SESSION_SECRET exported:
npm run webhooks
```

Use a process supervisor in production. The worker polls every five seconds,
claims rows with `FOR UPDATE SKIP LOCKED`, retries failed deliveries with exponential
backoff (30 seconds to one hour, six attempts), and recovers abandoned claims.
The UI reports queued/delivered/failed counts from the database; it never fabricates
delivery success. Failed deliveries can be requeued manually.

## Webhook contract

Endpoints are agency-only, HTTPS, and reject private/local addresses. Each endpoint
is agency-global (`tenant_id = null`) or scoped to one client. Event selection is
editable. Database triggers capture events from both Next.js and the Python worker:

- `call.started`, `call.completed`, `call.missed`
- `lead.created`, `lead.updated` (stage, value or AI takeover changes)
- `escalation.created`, `escalation.resolved`

Payload envelope: `{ id, type, tenantId, createdAt, data }`. `id` is the durable
event ID. Delivery is **at-least-once**; deduplicate by this ID. `X-OMNI-Delivery`
identifies the endpoint delivery row and stays stable across its retries.

Headers:

- `X-OMNI-Timestamp`: Unix seconds.
- `X-OMNI-Signature`: `sha256=<hex HMAC-SHA256(secret, timestamp + '.' + rawBody)>`.
- `X-OMNI-Delivery`: stable delivery UUID.

Verify the exact raw request bytes and reject timestamps outside a five-minute
window. Return 2xx promptly. Redirects are not followed. Network timeout is eight
seconds. Secrets are generated with 32 random bytes, shown once on creation or
rotation, and subsequently masked. **Send test** performs a real signed
`webhook.test` POST and reports the actual HTTP/network result; it does not insert
a customer event.

## Workspace and account controls

- Active, Paused and Suspended are enforced states: non-active workspaces cannot
  mint browser-call tokens, the worker refuses calls, chat AI is disabled, and
  client sessions lose workspace access. Pausing/suspending revokes sessions.
- Reception mode is separate from the existing zero-cost WebRTC / paid SIP transport
  enum. Voice AI answers normally; hybrid emphasizes human escalation; human-forward
  transfers an inbound SIP participant to the owner phone and disables browser AI
  calls/chat. A transfer is logged as completed only when the SIP API confirms it.
- DID assignment persists the routing key. It does **not** purchase a number or
  configure a carrier. Point the carrier at LiveKit and run
  `agent-worker/scripts/setup_livekit_sip.py` with the matching client config/DID.
  Human forwarding also requires a working LiveKit SIP outbound trunk/provider.
- Provisioned client users belong to one workspace. Agency accounts and accounts
  already belonging to another workspace cannot be attached by the provisioning
  flow. Passwords use scrypt; initial/reset passwords require a private replacement
  before portal access. Reset/suspend/reactivate revoke existing sessions.
- Agency pages/actions require `agencyScope` or `requireAgency`; the test API returns
  403 for client sessions. Webhook tables and operational tenant controls are
  agency-only at the database layer as well. Client business-fact edits remain allowed.

No live carrier, SIP provider, or customer CRM credentials are included. Those
integrations must be configured and tested in the deployment environment; the app
reports failures rather than simulating a connection.
