import type { CanonicalUsage, PricingPlan } from '../pricing-core/index.js';
import { evaluatePricingPlan } from '../pricing-core/index.js';
import {
  loadPricingReferenceConfig,
  type PricingFallbackProfile,
  type PricingReferenceMode,
} from './pricingReferenceConfigService.js';
import {
  createSimpleTokenPricingPlan,
} from './upstreamCostPricingService.js';
import {
  pricingEvaluationSummary,
} from './pricingResolutionSummary.js';
import type {
  PricingResolution,
  ReferencePricingSubject,
} from './pricingQuoteTypes.js';

const SYSTEM_DEFAULT_INPUT_PER_MILLION = 2;
const SYSTEM_DEFAULT_OUTPUT_PER_MILLION = 2;

export type ReferencePricingInput = {
  subject: ReferencePricingSubject;
  usage: Partial<CanonicalUsage>;
  mode?: PricingReferenceMode;
};

type ReferencePlanCandidate = {
  source: PricingResolution['source'];
  sourceId: string | number | null;
  matchedScope: string | null;
  sourceType: string | null;
  plan: PricingPlan;
};

function buildSystemDefaultPlan(profile: PricingFallbackProfile): PricingPlan | null {
  if (profile === 'unknown') return null;
  if (profile === 'free') {
    return createSimpleTokenPricingPlan({
      inputPerMillion: 0,
      outputPerMillion: 0,
    });
  }
  return createSimpleTokenPricingPlan({
    inputPerMillion: SYSTEM_DEFAULT_INPUT_PER_MILLION,
    outputPerMillion: SYSTEM_DEFAULT_OUTPUT_PER_MILLION,
  });
}

async function resolveManualReferencePlan(_input: ReferencePricingInput): Promise<ReferencePlanCandidate | null> {
  return null;
}

async function resolveBuiltInReferencePlan(_input: ReferencePricingInput): Promise<ReferencePlanCandidate | null> {
  return null;
}

export async function resolveReferencePricing(input: ReferencePricingInput): Promise<PricingResolution | null> {
  const config = await loadPricingReferenceConfig();
  const mode = input.mode || config.defaultReferenceMode;

  const candidates: ReferencePlanCandidate[] = [];
  const manual = mode !== 'default'
    ? await resolveManualReferencePlan(input)
    : null;
  if (manual) candidates.push(manual);

  const builtIn = mode !== 'manual' && config.catalog.builtInCatalogEnabled
    ? await resolveBuiltInReferencePlan(input)
    : null;
  if (builtIn) candidates.push(builtIn);

  if (mode === 'override' && builtIn && manual) {
    candidates.unshift(manual);
  }

  if (mode !== 'manual') {
    const systemDefaultPlan = buildSystemDefaultPlan(config.fallbackProfile);
    if (systemDefaultPlan) {
      candidates.push({
        source: 'system_default',
        sourceId: `fallback:${config.fallbackProfile}`,
        matchedScope: 'system_default',
        sourceType: 'system_default',
        plan: systemDefaultPlan,
      });
    }
  }

  const candidate = candidates[0] ?? null;
  if (!candidate) return null;

  const evaluation = evaluatePricingPlan({
    plan: candidate.plan,
    usage: input.usage,
    source: candidate.source === 'system_default' ? 'default' : 'reference',
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
