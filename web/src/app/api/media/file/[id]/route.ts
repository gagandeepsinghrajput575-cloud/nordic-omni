import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getContactMediaFileRecord } from '@/lib/db/trusted-records';
import { apiSession } from '@/lib/auth/guard';
import { verifyMediaUploadToken } from '@/lib/media/tokens';
import { jsonError } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return jsonError('Invalid media ID', 400);
  }

  const row = (await getContactMediaFileRecord(id)) as unknown as {
    id: string;
    tenant_id: string;
    contact_id: string;
    file_path: string;
    file_name: string;
    mime_type: string;
    file_size_bytes: number;
  } | null;

  if (!row) {
    return jsonError('Media not found', 404);
  }

  // Check auth: session or valid signed token
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const session = await apiSession().catch(() => null);

  if (!session) {
    if (!token) {
      return jsonError('Unauthorized access to media', 401);
    }
    const verified = verifyMediaUploadToken(token);
    if (!verified || verified.tenantId !== row.tenant_id || verified.contactId !== row.contact_id) {
      return jsonError('Forbidden: invalid or expired media token', 403);
    }
  } else {
    if (!session.isAgency && !session.tenantIds.includes(row.tenant_id)) {
      return jsonError('Forbidden: media belongs to another workspace', 403);
    }
  }

  // Path traversal guard: ensure file_path resolves strictly within data/media
  const allowedBase = path.resolve(process.cwd(), 'data', 'media');
  const resolvedPath = path.resolve(row.file_path);
  if (!resolvedPath.startsWith(allowedBase + path.sep)) {
    return jsonError('Forbidden: invalid media storage path', 403);
  }

  try {
    const fileBuffer = await fs.readFile(resolvedPath);
    return new Response(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': row.mime_type || 'image/jpeg',
        'Content-Length': fileBuffer.length.toString(),
        'Cache-Control': 'private, max-age=86400',
        'Content-Disposition': `inline; filename="${row.file_name.replace(/["\r\n]/g, '')}"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return jsonError('File could not be read from storage', 404);
  }
}
