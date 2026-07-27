import type { CanonicalUsage } from '../pricing-core/index.js';
import {
  evaluateUpstreamCostPricing,
  type ProviderCatalogResolveMode,
} from './upstreamCostPricingService.js';
import {
  pricingEvaluationSummary,
} from './pricingResolutionSummary.js';
import type {
  EndpointPricingSupply,
  PricingResolution,
} from './pricingQuoteTypes.js';

export const ENDPOINT_PREVIEW_USAGE: Partial<CanonicalUsage> = {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  requestCount: 1,
};

export const ENDPOINT_ROUTING_REFERENCE_USAGE: Partial<CanonicalUsage> = {
  inputTokens: 500_000,
  outputTokens: 500_000,
  totalTokens: 1_000_000,
  requestCount: 1,
};

function normalizeOptionalText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function sourceFromUpstreamCost(sourceType: string | null | undefined): PricingResolution['source'] {
  if (sourceType === 'provider_catalog') return 'provider_catalog';
  if (sourceType === 'system_default') return 'system_default';
  return 'manual_binding';
}

export async function resolveEndpointPricing(input: {
  supply: EndpointPricingSupply;
  usage: Partial<CanonicalUsage>;
  allowProviderCatalog?: boolean;
  providerCatalogMode?: ProviderCatalogResolveMode;
}): Promise<PricingResolution | null> {
  const resolved = await evaluateUpstreamCostPricing({
    siteId: input.supply.siteId,
    accountId: input.supply.accountId,
    tokenId: input.supply.tokenId ?? null,
    tokenGroup: normalizeOptionalText(input.supply.tokenGroup),
    modelName: input.supply.modelName,
    allowProviderCatalog: input.allowProviderCatalog,
    providerCatalogMode: input.providerCatalogMode,
    usage: input.usage,
    context: {
      provider: input.supply.provider || undefined,
      metadata: {
        siteId: input.supply.siteId,
        accountId: input.supply.accountId,
        tokenId: input.supply.tokenId ?? null,
        tokenGroup: normalizeOptionalText(input.supply.tokenGroup),
      },
    },
  });
  if (!resolved) return null;

  return {
    source: sourceFromUpstreamCost(resolved.pricing.sourceType),
    sourceId: resolved.pricing.id > 0 ? resolved.pricing.id : null,
    matchedScope: resolved.matchedScope,
    sourceType: resolved.pricing.sourceType,
    planFingerprint: resolved.evaluation.planFingerprint || null,
    estimateLevel: resolved.evaluation.estimateLevel,
    evaluation: resolved.evaluation,
    summary: pricingEvaluationSummary(resolved.evaluation),
    diagnostics: resolved.evaluation.diagnostics,
  };
}

export async function resolveEndpointPreviewPricing(input: {
  supply: EndpointPricingSupply;
  usage?: Partial<CanonicalUsage>;
}): Promise<PricingResolution | null> {
  return await resolveEndpointPricing({
    supply: input.supply,
    usage: input.usage || ENDPOINT_PREVIEW_USAGE,
  });
}

export function clearEndpointPricingReferenceCache(): void {
}
