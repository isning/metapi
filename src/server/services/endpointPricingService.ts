import type { CanonicalUsage } from '../pricing-core/index.js';
import {
  evaluateUpstreamCostPricing,
} from './upstreamCostPricingService.js';
import {
  pricingEvaluationSummary,
} from './pricingResolutionSummary.js';
import type {
  EndpointPricingSupply,
  PricingResolution,
} from './pricingQuoteTypes.js';

const ENDPOINT_PRICING_CACHE_TTL_MS = 10 * 60 * 1000;
const ENDPOINT_PRICING_FAILURE_TTL_MS = 60 * 1000;

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

type EndpointRoutingReferenceCacheEntry = {
  fetchedAt: number;
  ttlMs: number;
  resolution: PricingResolution | null;
};

const endpointRoutingReferenceCache = new Map<string, EndpointRoutingReferenceCacheEntry>();

function normalizeOptionalText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeModelKey(modelName: string): string {
  return String(modelName || '').trim().toLowerCase();
}

function normalizeId(value: unknown): number {
  return Math.trunc(Number(value) || 0);
}

function endpointPricingCacheKey(input: EndpointPricingSupply): string {
  return [
    `site:${normalizeId(input.siteId)}`,
    `account:${normalizeId(input.accountId)}`,
    `token:${input.tokenId == null ? '-' : normalizeId(input.tokenId)}`,
    `group:${normalizeOptionalText(input.tokenGroup) || '-'}`,
    `model:${normalizeModelKey(input.modelName)}`,
  ].join('|');
}

function sourceFromUpstreamCost(sourceType: string | null | undefined): PricingResolution['source'] {
  if (sourceType === 'provider_catalog') return 'provider_catalog';
  if (sourceType === 'system_default') return 'system_default';
  return 'manual_binding';
}

export async function resolveEndpointPricing(input: {
  supply: EndpointPricingSupply;
  usage: Partial<CanonicalUsage>;
}): Promise<PricingResolution | null> {
  const resolved = await evaluateUpstreamCostPricing({
    siteId: input.supply.siteId,
    accountId: input.supply.accountId,
    tokenId: input.supply.tokenId ?? null,
    tokenGroup: normalizeOptionalText(input.supply.tokenGroup),
    modelName: input.supply.modelName,
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

export function getCachedEndpointRoutingReferencePricing(input: EndpointPricingSupply): PricingResolution | null {
  const cached = endpointRoutingReferenceCache.get(endpointPricingCacheKey(input));
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt >= cached.ttlMs) return null;

  const totalCostUsd = cached.resolution?.summary.totalCostUsd;
  if (typeof totalCostUsd !== 'number' || !Number.isFinite(totalCostUsd) || totalCostUsd <= 0) {
    return null;
  }
  return cached.resolution;
}

export async function refreshEndpointRoutingReferencePricing(input: {
  supply: EndpointPricingSupply;
  usage?: Partial<CanonicalUsage>;
}): Promise<PricingResolution | null> {
  const key = endpointPricingCacheKey(input.supply);
  const now = Date.now();
  try {
    const resolution = await resolveEndpointPricing({
      supply: input.supply,
      usage: input.usage || ENDPOINT_ROUTING_REFERENCE_USAGE,
    });
    endpointRoutingReferenceCache.set(key, {
      fetchedAt: now,
      ttlMs: resolution ? ENDPOINT_PRICING_CACHE_TTL_MS : ENDPOINT_PRICING_FAILURE_TTL_MS,
      resolution,
    });
    return resolution;
  } catch {
    endpointRoutingReferenceCache.set(key, {
      fetchedAt: now,
      ttlMs: ENDPOINT_PRICING_FAILURE_TTL_MS,
      resolution: null,
    });
    return null;
  }
}

export function clearEndpointPricingReferenceCache(): void {
  endpointRoutingReferenceCache.clear();
}
