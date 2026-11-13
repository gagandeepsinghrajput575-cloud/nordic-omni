import { getPortalWorkspace, getWorkspaceBySlug } from '@/lib/data';
import { isValidHttpUrl, jsonError, readJson, readString } from '@/lib/api-utils';
import { describeProviderError } from '@/lib/ai/service';
import { createOpenAICompatibleClient } from '@/lib/ai/openai-client';
import type { TestConnectionResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  const slug = readString(body, 'workspaceSlug').trim();
  const workspace = slug ? await getWorkspaceBySlug(slug) : await getPortalWorkspace();
  if (!workspace) {
    return jsonError('Workspace not found', 404);
  }

  const baseURL = (readString(body, 'baseURL').trim() || workspace.providerBaseUrl || '').trim();
  const model = (readString(body, 'model').trim() || workspace.providerModel || '').trim();
  const submittedKey = readString(body, 'apiKey').trim();
  const apiKey = submittedKey || workspace.providerApiKey || '';

  if (!baseURL) {
    return jsonError('A provider base URL is required');
  }
  if (!isValidHttpUrl(baseURL)) {
    return jsonError('The provider base URL must be a valid http(s) URL');
  }
  if (!model) {
    return jsonError('A model identifier is required');
  }

  const client = createOpenAICompatibleClient({ baseURL, apiKey, model, timeoutMs: 25_000 });

  let result: TestConnectionResult;
  try {
    const report = await client.testConnection();
    result = {
      ok: true,
      latencyMs: report.latencyMs,
      model: report.model,
      baseUrl: baseURL,
      message: report.message,
      sample: report.sample,
    };
  } catch (error) {
    result = {
      ok: false,
      latencyMs: 0,
      model,
      baseUrl: baseURL,
      message: describeProviderError(error),
    };
  }

  return Response.json(result);
}
