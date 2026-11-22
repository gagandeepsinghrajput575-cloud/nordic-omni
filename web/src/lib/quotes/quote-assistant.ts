import {
  getTenantPricingCatalogRecord,
  recordBallparkQuoteEstimate,
} from '@/lib/db/trusted-records';
import { calculateEstimate, type CatalogItem } from '@/lib/estimation';
import { scheduleFollowupSequenceAdmin } from '@/lib/followup/sequences';

export interface BallparkQuoteInput {
  tenantId: string;
  contactId: string;
  catalogItemId: string;
  projectType: string;
  scopeDetails: string;
  squareMeters?: number | null;
  followupNotes?: string;
  photoIds?: string[];
}

export interface BallparkQuoteResult {
  ok: boolean;
  estimateId: string;
  projectType: string;
  scopeDetails: string;
  squareMeters: number | null;
  rawMinDkk: number;
  rawMaxDkk: number;
  minDkkWithVat: number;
  maxDkkWithVat: number;
  estimatedValueDkk: number;
  vatRate: number;
  isNonBinding: true;
  danishSummary: string;
  danishDisclaimer: string;
  hiddenConditionsWarning: string;
  budgetAlignmentQuestion: string;
}

const VAT_RATE = 0.25; // 25% Danish moms

export async function generateBallparkQuote(
  input: BallparkQuoteInput,
): Promise<BallparkQuoteResult> {
  const { tenantId, contactId, catalogItemId, projectType, scopeDetails, squareMeters, followupNotes } = input;

  // Fetch tenant pricing catalog
  const catalogRaw = await getTenantPricingCatalogRecord(tenantId);
  if (!catalogRaw) throw new Error('Tenant catalog not found');

  const catalog: CatalogItem[] = Array.isArray(catalogRaw)
    ? catalogRaw
    : typeof catalogRaw === 'string'
      ? JSON.parse(catalogRaw)
      : [];

  const estimate = calculateEstimate(catalog, catalogItemId, squareMeters ?? null);

  // Apply Danish moms (25% VAT)
  const minDkkWithVat = Math.round(estimate.minimum * (1 + VAT_RATE));
  const maxDkkWithVat = Math.round(estimate.maximum * (1 + VAT_RATE));
  const midpointWithVat = Math.round(estimate.midpoint * (1 + VAT_RATE));

  const hiddenConditionsWarning =
    'Bemærk venligst, at skjulte forhold, som ikke kan ses på fotos eller video (f.eks. fugtskader under gulv, skjult rørføring eller elinstallationer bag vægge), først kan vurderes endeligt ved en fysisk besigtigelse.';
  const budgetAlignmentQuestion = 'Passer det vejledende prisspænd nogenlunde med det budget, du havde i tankerne?';
  const danishDisclaimer =
    `Dette er et vejledende overslag inkl. 25% moms, ikke et bindende tilbud. ${hiddenConditionsWarning} ${budgetAlignmentQuestion}`;
  const danishSummary = `Vejledende overslag: ${minDkkWithVat.toLocaleString('da-DK')} - ${maxDkkWithVat.toLocaleString('da-DK')} kr. inkl. moms`;

  const notes = `${followupNotes || ''}\n${danishDisclaimer}`.trim();

  // Persist atomically to project_estimates and advance CRM stage
  const estimateId = await recordBallparkQuoteEstimate({
    tenantId,
    contactId,
    projectType,
    scopeDetails,
    squareMeters: estimate.squareMeters,
    minDkkWithVat,
    maxDkkWithVat,
    midpointWithVat,
    notes,
  });

  // Schedule timed follow-up sequences (+3.5h and +24h) for qualified lead
  await scheduleFollowupSequenceAdmin({
    tenantId,
    contactId,
    projectType,
  }).catch(() => null);

  return {
    ok: true,
    estimateId,
    projectType,
    scopeDetails,
    squareMeters: estimate.squareMeters,
    rawMinDkk: estimate.minimum,
    rawMaxDkk: estimate.maximum,
    minDkkWithVat,
    maxDkkWithVat,
    estimatedValueDkk: midpointWithVat,
    vatRate: VAT_RATE,
    isNonBinding: true,
    danishSummary,
    danishDisclaimer,
    hiddenConditionsWarning,
    budgetAlignmentQuestion,
  };
}
