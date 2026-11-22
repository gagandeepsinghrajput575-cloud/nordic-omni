import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { verifyMediaUploadToken } from '@/lib/media/tokens';
import { recordContactMediaFile } from '@/lib/db/trusted-records';
import { jsonError } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Validate image magic bytes to reject disguised executables or malicious payloads.
 */
function validateMagicBytes(buffer: Buffer): { valid: boolean; ext: string; mime: string } {
  if (buffer.length < 12) return { valid: false, ext: '', mime: '' };

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { valid: true, ext: 'jpg', mime: 'image/jpeg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { valid: true, ext: 'png', mime: 'image/png' };
  }

  // WebP: RIFF .... WEBP
  const riff = buffer.toString('ascii', 0, 4);
  const webp = buffer.toString('ascii', 8, 12);
  if (riff === 'RIFF' && webp === 'WEBP') {
    return { valid: true, ext: 'webp', mime: 'image/webp' };
  }

  // HEIC / HEIF / AVIF: [4 bytes length] 'ftyp' followed by 'heic', 'heix', 'mif1', 'msf1', or 'avif'
  const ftyp = buffer.toString('ascii', 4, 8);
  if (ftyp === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12).toLowerCase();
    if (['heic', 'heix', 'mif1', 'msf1'].includes(brand)) {
      return { valid: true, ext: 'heic', mime: 'image/heic' };
    }
    if (brand === 'avif') {
      return { valid: true, ext: 'avif', mime: 'image/avif' };
    }
  }

  return { valid: false, ext: '', mime: '' };
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const authHeader = request.headers.get('Authorization') || '';
  const tokenFromHeader = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const tokenFromQuery = url.searchParams.get('token') || '';

  const formData = await request.formData().catch(() => null);
  const tokenFromForm = (formData?.get('token') as string) || '';

  const token = tokenFromHeader || tokenFromQuery || tokenFromForm;
  if (!token) {
    return jsonError('Missing signed upload token', 401);
  }

  const payload = verifyMediaUploadToken(token);
  if (!payload) {
    return jsonError('Invalid or expired upload token', 403);
  }

  const { tenantId, contactId } = payload;

  if (!formData) {
    return jsonError('Form data required', 400);
  }

  const file = formData.get('file');
  if (!file || !(file instanceof Blob)) {
    return jsonError('No file provided in form field "file"', 400);
  }

  if (file.size > MAX_FILE_SIZE) {
    return jsonError('File size exceeds the 10MB limit', 413);
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const validation = validateMagicBytes(buffer);
  if (!validation.valid) {
    return jsonError(
      'Invalid file format. Only verified JPEG, PNG, WebP, and HEIC images are allowed.',
      415,
    );
  }

  const fileId = randomUUID();
  const sanitizedOriginalName = (file.name || 'photo').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
  const fileName = `${fileId}.${validation.ext}`;

  // Store in tenant-isolated directory: data/media/[tenantId]/[contactId]/
  const uploadDir = path.join(process.cwd(), 'data', 'media', tenantId, contactId);
  await fs.mkdir(uploadDir, { recursive: true });
  const filePath = path.join(uploadDir, fileName);

  await fs.writeFile(filePath, buffer);

  const description = (formData.get('description') as string) || sanitizedOriginalName;

  // Persist record to PostgreSQL
  const record = await recordContactMediaFile({
    fileId,
    tenantId,
    contactId,
    filePath,
    fileName: sanitizedOriginalName,
    mimeType: validation.mime,
    fileSizeBytes: buffer.length,
    description,
  });

  return NextResponse.json(
    {
      ok: true,
      media: {
        id: record.id,
        tenantId: record.tenant_id,
        contactId: record.contact_id,
        fileName: record.file_name,
        mimeType: record.mime_type,
        sizeBytes: Number(record.file_size_bytes),
        description: record.description,
        createdAt: record.created_at,
        url: `/api/media/file/${record.id}`,
      },
    },
    { status: 201 },
  );
}
