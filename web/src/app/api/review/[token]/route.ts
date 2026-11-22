import { NextResponse } from 'next/server';
import { verifyReviewToken } from '@/lib/review/tokens';
import { getTenantReviewInfoRecord, recordGoogleReviewSubmission } from '@/lib/db/trusted-records';
import { jsonError, readJson } from '@/lib/api-utils';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const ReviewSubmissionSchema = z.object({
  rating: z.number().min(1).max(5),
  feedbackText: z.string().max(2000).optional().default(''),
  platform: z.enum(['web', 'whatsapp', 'meta', 'instagram']).optional().default('web'),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const verified = verifyReviewToken(token);
  if (!verified) {
    return jsonError('Invalid or expired review link', 403);
  }

  const { tenantId, contactId } = verified;

  const { tenant, contact } = (await getTenantReviewInfoRecord(tenantId, contactId)) as unknown as {
    tenant: { name: string; owner_name: string; google_review_url: string | null } | null;
    contact: { full_name: string | null } | null;
  };

  if (!tenant) {
    return jsonError('Tenant not found', 404);
  }

  return NextResponse.json({
    ok: true,
    businessName: tenant.name,
    ownerName: tenant.owner_name,
    customerName: contact?.full_name || '',
    googleReviewUrl: tenant.google_review_url || `https://search.google.com/local/writereview?placeid=${encodeURIComponent(tenant.name)}`,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const verified = verifyReviewToken(token);
  if (!verified) {
    return jsonError('Invalid or expired review link', 403);
  }

  const { tenantId, contactId } = verified;

  const parsed = ReviewSubmissionSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'Invalid review data', 400);
  }

  const { rating, feedbackText, platform } = parsed.data;

  const { tenant } = (await getTenantReviewInfoRecord(tenantId, contactId)) as unknown as {
    tenant: { name: string; owner_name: string; google_review_url: string | null } | null;
  };

  if (!tenant) {
    return jsonError('Tenant not found', 404);
  }

  const googleUrl = tenant.google_review_url || `https://search.google.com/local/writereview?placeid=${encodeURIComponent(tenant.name)}`;
  const isSatisfied = rating >= 2.8;
  const status = isSatisfied ? 'redirected_to_google' : 'internal_feedback';

  // Persist review in PostgreSQL via trusted record handler
  await recordGoogleReviewSubmission({
    tenantId,
    contactId,
    rating,
    feedbackText,
    status,
    platform,
  });

  if (!isSatisfied) {
    return NextResponse.json({
      ok: true,
      status: 'internal_feedback',
      message: 'Mange tak for din ærlige feedback. Din besked er sendt direkte til ledelsen, så vi kan rette op på fejlen med det samme.',
      // To strictly comply with Danish Markedsføringsloven and Google anti-gating policies,
      // provide optional link if caller still wishes to view public Google page
      googleUrl,
    });
  }

  return NextResponse.json({
    ok: true,
    status: 'redirected_to_google',
    googleUrl,
  });
}
