import {
  getTenantPricingCatalogRecord,
  recordBallparkQuoteEstimate,
} from '@/lib/db/trusted-records';
import { calculateEstimate, type CatalogItem } from '@/lib/estimation';

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

  const danishDisclaimer =
    'Dette er et vejledende overslag inkl. 25% moms, ikke et bindende tilbud. Endelig fast pris fastsættes ved besigtigelse.';
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
  };
}
