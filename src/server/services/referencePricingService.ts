import type { CanonicalUsage, PricingPlan } from '../pricing-core/index.js';
import { evaluatePricingPlan } from '../pricing-core/index.js';
import {
  findReferenceCatalogEntry,
  loadPricingReferenceCatalog,
} from './pricingReferenceCatalogService.js';
import {
  pricingEvaluationSummary,
} from './pricingResolutionSummary.js';
import type {
  PricingResolution,
  ReferencePricingSubject,
} from './pricingQuoteTypes.js';

export type ReferencePricingInput = {
  subject: ReferencePricingSubject;
  usage: Partial<CanonicalUsage>;
};

type ReferencePlanCandidate = {
  source: PricingResolution['source'];
  sourceId: string | number | null;
  matchedScope: string | null;
  sourceType: string | null;
  plan: PricingPlan;
};

async function resolveCatalogReferencePlan(input: ReferencePricingInput): Promise<ReferencePlanCandidate | null> {
  const catalog = await loadPricingReferenceCatalog();
  const entry = findReferenceCatalogEntry({
    catalog,
    provider: input.subject.provider,
    modelName: input.subject.modelName,
  });
  if (!entry) return null;
  return {
    source: 'official_reference',
    sourceId: entry.id,
    matchedScope: entry.provider ? `provider:${entry.provider}` : 'global',
    sourceType: entry.sourceType,
    plan: entry.plan,
  };
}

export async function resolveReferencePricing(input: ReferencePricingInput): Promise<PricingResolution | null> {
  const candidates: ReferencePlanCandidate[] = [];
  const catalog = await resolveCatalogReferencePlan(input);
  if (catalog) candidates.push(catalog);

  const candidate = candidates[0] ?? null;
  if (!candidate) return null;

  const evaluation = evaluatePricingPlan({
    plan: candidate.plan,
    usage: input.usage,
    source: 'reference',
    context: {
      model: input.subject.modelName,
      provider: input.subject.provider || undefined,
      metadata: {
        referenceSource: candidate.source,
        referenceSourceId: candidate.sourceId,
      },
    },
  });

  return {
    source: candidate.source,
    sourceId: candidate.sourceId,
    matchedScope: candidate.matchedScope,
    sourceType: candidate.sourceType,
    planFingerprint: evaluation.planFingerprint || null,
    estimateLevel: evaluation.estimateLevel,
    evaluation,
    summary: pricingEvaluationSummary(evaluation),
    diagnostics: evaluation.diagnostics,
  };
}
