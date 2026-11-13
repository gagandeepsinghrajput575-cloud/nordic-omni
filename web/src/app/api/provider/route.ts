import { getPortalWorkspace, getWorkspaceBySlug } from '@/lib/data';
import { resolveProvider } from '@/lib/ai/config';
import {
  isValidHttpUrl,
  jsonError,
  readJson,
  readString,
} from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const slug = new URL(request.url).searchParams.get('workspace') ?? '';
  const workspace = slug ? await getWorkspaceBySlug(slug) : await getPortalWorkspace();
  if (!workspace) {
    return jsonError('Workspace not found', 404);
  }
  const provider = resolveProvider(workspace);
  return Response.json({
    provider: {
      configured: provider.configured,
      label: provider.label,
      baseURL: provider.baseURL,
      model: provider.model,
      source: provider.source,
      apiKeyHint: provider.apiKeyHint,
    },
    checks: [],
  });
}

export async function PUT(request: Request): Promise<Response> {
  const body = await readJson(request);
  const slug = readString(body, 'workspaceSlug').trim();
  const workspace = slug ? await getWorkspaceBySlug(slug) : await getPortalWorkspace();
  if (!workspace) {
    return jsonError('Workspace not found', 404);
  }

  const clear = body.clear === true;
  if (clear) {
    return Response.json({ ok: true, cleared: true });
  }

  const baseURL = readString(body, 'baseURL').trim();
  const model = readString(body, 'model').trim();
  const apiKey = readString(body, 'apiKey').trim();
  const label = readString(body, 'label').trim() || model;

  if (!baseURL || !isValidHttpUrl(baseURL)) {
    return jsonError('A valid http(s) provider base URL is required');
  }
  if (!model) {
    return jsonError('A model identifier is required');
  }

  return Response.json({
    ok: true,
    saved: true,
    provider: {
      label,
      baseURL,
      model,
      hasKey: Boolean(apiKey),
    },
  });
}
