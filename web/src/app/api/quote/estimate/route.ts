import { NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth/guard';
import { jsonError, readJson } from '@/lib/api-utils';
import { generateBallparkQuote } from '@/lib/quotes/quote-assistant';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const BallparkQuoteSchema = z.object({
  tenantId: z.string().uuid(),
  contactId: z.string().uuid(),
  catalogItemId: z.string().min(1),
  projectType: z.string().min(1),
  scopeDetails: z.string().default(''),
  squareMeters: z.number().positive().nullable().optional(),
  followupNotes: z.string().optional(),
  photoIds: z.array(z.string().uuid()).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const session = await apiSession();
  if (!session) return jsonError('Unauthorized', 401);

  const parsed = BallparkQuoteSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'Invalid request', 400);
  }

  const { tenantId, contactId, catalogItemId, projectType, scopeDetails, squareMeters, followupNotes, photoIds } =
    parsed.data;

  if (!session.isAgency && !session.tenantIds.includes(tenantId)) {
    return jsonError('Forbidden: workspace mismatch', 403);
  }

  try {
    const result = await generateBallparkQuote({
      tenantId,
      contactId,
      catalogItemId,
      projectType,
      scopeDetails,
      squareMeters,
      followupNotes,
      photoIds,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Kunne ikke beregne overslag';
    return jsonError(message, 422);
  }
}
