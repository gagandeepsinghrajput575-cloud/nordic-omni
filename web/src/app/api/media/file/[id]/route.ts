import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { getContactMediaFileRecord } from '@/lib/db/trusted-records';
import { apiSession } from '@/lib/auth/guard';
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

  const row = (await getContactMediaFileRecord(id)) as {
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

  // Check auth if session is present, or check if signed token is provided in searchParams
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const session = await apiSession().catch(() => null);

  if (!session && !token) {
    // If neither session nor token, return unauthorized
    return jsonError('Unauthorized access to media', 401);
  }

  if (session && !session.isAgency && !session.tenantIds.includes(row.tenant_id)) {
    return jsonError('Forbidden: media belongs to another workspace', 403);
  }

  try {
    const fileBuffer = await fs.readFile(row.file_path);
    return new Response(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': row.mime_type || 'image/jpeg',
        'Content-Length': fileBuffer.length.toString(),
        'Cache-Control': 'private, max-age=86400',
        'Content-Disposition': `inline; filename="${row.file_name}"`,
      },
    });
  } catch {
    return jsonError('File could not be read from storage', 404);
  }
}
