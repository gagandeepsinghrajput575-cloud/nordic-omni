import { getPortalWorkspace, getWorkspaceById, getWorkspaceBySlug } from '@/lib/data';
import { resolveProvider } from '@/lib/ai/config';
import { apiSession } from '@/lib/auth/guard';
import {
  isValidHttpUrl,
  jsonError,
  readJson,
  readString,
} from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const session = await apiSession();
  if (!session) {
    return jsonError('Unauthorized', 401);
  }

  const slug = new URL(request.url).searchParams.get('workspace') ?? '';
  let workspace = null;

  if (slug) {
    workspace = await getWorkspaceBySlug(slug);
    // Anti-slug-enumeration: non-agency callers get 403 for unauthorized/unknown workspaces
    if (!session.isAgency) {
      if (!workspace || !session.tenantIds.includes(workspace.id)) {
        return jsonError('Forbidden: caller session lacks authority for requested workspace', 403);
      }
    } else if (!workspace) {
      return jsonError('Workspace not found', 404);
    }
  } else {
    // Omitting workspace parameter defaults to the client's own tenant, or portal workspace for agency
    if (!session.isAgency) {
      const tenantId = session.tenantIds[0];
      if (!tenantId) {
        return jsonError('Forbidden: client session has no assigned workspace', 403);
      }
      workspace = await getWorkspaceById(tenantId);
    } else {
      workspace = await getPortalWorkspace();
    }
    if (!workspace) {
      return jsonError('Workspace not found', 404);
    }
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
  const session = await apiSession();
  if (!session) {
    return jsonError('Unauthorized', 401);
  }

  const body = await readJson(request);
  const slug = readString(body, 'workspaceSlug').trim();
  let workspace = null;

  if (slug) {
    workspace = await getWorkspaceBySlug(slug);
    if (!session.isAgency) {
      if (!workspace || !session.tenantIds.includes(workspace.id)) {
        return jsonError('Forbidden: caller session lacks authority for requested workspace', 403);
      }
    } else if (!workspace) {
      return jsonError('Workspace not found', 404);
    }
  } else {
    if (!session.isAgency) {
      const tenantId = session.tenantIds[0];
      if (!tenantId) {
        return jsonError('Forbidden: client session has no assigned workspace', 403);
      }
      workspace = await getWorkspaceById(tenantId);
    } else {
      workspace = await getPortalWorkspace();
    }
    if (!workspace) {
      return jsonError('Workspace not found', 404);
    }
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
