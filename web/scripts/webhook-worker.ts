/** Run with DATABASE_URL and SESSION_SECRET set: npx tsx web/scripts/webhook-worker.ts.
 * A single long-running worker drains the durable outbox, including Python-worker
 * events. Multiple workers are safe (SELECT FOR UPDATE SKIP LOCKED). */
import { dispatchWebhooks } from '../src/lib/webhooks/dispatcher';
import { adminSql } from '../src/lib/db/client';

let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

async function main() {
  console.log('Nordic Omni webhook worker started.');
  while (!stopping) {
    try {
      let count = 0;
      do { count = await dispatchWebhooks(20); } while (count === 20 && !stopping);
    } catch {
      // Do not log connection strings, payloads or signing secrets.
      console.error('Webhook batch failed; retrying in 5 seconds.');
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  await adminSql.end({ timeout: 5 });
}
main().catch(() => { console.error('Webhook worker could not start.'); process.exitCode = 1; });
