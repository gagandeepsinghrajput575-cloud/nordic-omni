/**
 * The snippets the developer console renders.
 *
 * These are not invented: every path and field below exists in the repository.
 *
 *   POST /api/v1/agency/webhook   `src/app/api/v1/agency/webhook/route.ts`,
 *                                 body per `fetch_leads` in
 *                                 `lib/webhooks/inbound-contract.ts`
 *   POST /api/telephony/dispatch  `src/app/api/telephony/dispatch/route.ts`,
 *                                 which reads `did` and `caller`
 *
 * Three languages share one payload object as the single source of truth, so
 * the samples cannot drift apart. The cURL sample is built from the same bytes
 * `InboundGateway.tsx` already emits for its copyable request.
 */

export type SnippetLanguage = 'ts' | 'py' | 'curl' | 'go';

export interface LanguageOption {
  value: SnippetLanguage;
  label: string;
}

export const LANGUAGES: ReadonlyArray<LanguageOption> = [
  { value: 'ts', label: 'TypeScript' },
  { value: 'py', label: 'Python' },
  { value: 'curl', label: 'cURL' },
  { value: 'go', label: 'Go' },
];

export const WEBHOOK_PATH = '/api/v1/agency/webhook';
export const DISPATCH_PATH = '/api/telephony/dispatch';

/** Mirrors the `fetch_leads` branch of the inbound schema. */
export const WEBHOOK_PAYLOAD = {
  action: 'fetch_leads',
  status: 'new',
  limit: 25,
} as const;

/** Mirrors the dispatch route's read order: `did`, then `caller`. */
export const DISPATCH_PAYLOAD = {
  did: '+4527441802',
  caller: '+4522334455',
  state: 'connected',
} as const;

const payloadJson = JSON.stringify(WEBHOOK_PAYLOAD);

export function snippetFor(language: SnippetLanguage): string {
  switch (language) {
    case 'ts':
      return [
        `// Fetch the newest leads through the inbound gateway.`,
        `const response = await fetch('${WEBHOOK_PATH}', {`,
        `  method: 'POST',`,
        `  headers: {`,
        `    Authorization: \`Bearer \${process.env.OMNI_API_KEY}\`,`,
        `    'Content-Type': 'application/json',`,
        `  },`,
        `  body: JSON.stringify(${payloadJson}),`,
        `});`,
        ``,
        `const { data } = await response.json();`,
      ].join('\n');

    case 'py':
      return [
        `# Fetch the newest leads through the inbound gateway.`,
        `import os, requests`,
        ``,
        `response = requests.post(`,
        `    '${WEBHOOK_PATH}',`,
        `    headers={'Authorization': f"Bearer {os.environ['OMNI_API_KEY']}"},`,
        `    json=${payloadJson},`,
        `    timeout=10,`,
        `)`,
        `leads = response.json()['data']`,
      ].join('\n');

    case 'curl':
      return [
        `curl -X POST '${WEBHOOK_PATH}' \\`,
        `  -H 'Authorization: Bearer <api-key>' \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -d '${payloadJson}'`,
      ].join('\n');

    case 'go':
      return [
        `// Fetch the newest leads through the inbound gateway.`,
        `body := []byte(\`${payloadJson}\`)`,
        `req, _ := http.NewRequest("POST", "${WEBHOOK_PATH}", bytes.NewBuffer(body))`,
        `req.Header.Set("Authorization", "Bearer "+os.Getenv("OMNI_API_KEY"))`,
        `req.Header.Set("Content-Type", "application/json")`,
        ``,
        `res, err := http.DefaultClient.Do(req)`,
        `if err != nil {`,
        `  log.Fatal(err)`,
        `}`,
        `defer res.Body.Close()`,
      ].join('\n');
  }
}
