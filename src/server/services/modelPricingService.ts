import { shouldUseProviderCatalogPricing } from './upstreamCostPricingService.js';
import { fetchUpstreamPricingCatalog } from './upstreamPricingCatalogService.js';
import type { PricingEvaluation } from '../pricing-core/index.js';
import { resolveEndpointPricing } from './endpointPricingService.js';
import type { PricingResolution } from './pricingQuoteTypes.js';
import type {
  UpstreamPricingCatalog as PricingData,
  UpstreamPricingModel as PricingModel,
} from './upstreamPricingCatalog.js';

const PRICE_CACHE_TTL_MS = 10 * 60 * 1000;
const PRICE_CACHE_FAILURE_TTL_MS = 60 * 1000;
const DEFAULT_GROUP = 'default';
const ONE_HUB_PER_CALL_RATIO = 0.002;
const MIN_ROUTING_REFERENCE_COST = 1e-6;
const ROUTING_REFERENCE_USAGE = {
  promptTokens: 500_000,
  completionTokens: 500_000,
  totalTokens: 1_000_000,
};

export type { PricingModel };

export interface ProxyBillingPricingOverride {
  modelRatio: number;
  completionRatio: number;
  cacheRatio?: number;
  cacheCreationRatio?: number;
  groupRatio?: number;
}

interface PricingCacheEntry {
  fetchedAt: number;
  ttlMs: number;
  data: PricingData | null;
}

interface RoutingReferenceCostCacheEntry {
  fetchedAt: number;
  ttlMs: number;
  costs: Map<string, number>;
}

export interface EstimateProxyCostInput {
  site: {
    id: number;
    url: string;
    platform: string;
    apiKey?: string | null;
  };
  account: {
    id: number;
    username?: string | null;
    accessToken?: string | null;
    apiToken?: string | null;
    extraConfig?: string | Record<string, unknown> | null;
  };
  tokenId?: number | null;
  upstreamGroup?: string | null;
  modelName: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  promptTokensIncludeCache?: boolean | null;
  billingPricingOverride?: ProxyBillingPricingOverride | null;
}

interface ModelGroupPricing {
  quotaType: number;
  inputPerMillion?: number;
  outputPerMillion?: number;
  cacheReadPerMillion?: number;
  cacheCreationPerMillion?: number;
  perCallInput?: number;
  perCallOutput?: number;
  perCallTotal?: number;
}

interface ModelPricingCatalogEntry {
  modelName: string;
  quotaType: number;
  modelDescription: string | null;
  tags: string[];
  supportedEndpointTypes: string[];
  ownerBy: string | null;
  enableGroups: string[];
  groupPricing: Record<string, ModelGroupPricing>;
}

interface ModelPricingCatalog {
  models: ModelPricingCatalogEntry[];
  groupRatio: Record<string, number>;
}

export interface ProxyBillingDetails {
  source?: 'upstream_catalog' | 'billing_override' | 'upstream_cost_pricing';
  upstreamCostPricingId?: number;
  upstreamCostPricingScope?: string;
  planFingerprint?: string;
  estimateLevel?: string;
  diagnostics?: unknown[];
  quotaType: number;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    billablePromptTokens: number;
    promptTokensIncludeCache: boolean | null;
  };
  pricing: {
    modelRatio: number;
    completionRatio: number;
    cacheRatio: number;
    cacheCreationRatio: number;
    groupRatio: number;
  };
  breakdown: {
    inputPerMillion: number | null;
    outputPerMillion: number | null;
    cacheReadPerMillion: number | null;
    cacheCreationPerMillion: number | null;
    inputCost: number;
    outputCost: number;
    cacheReadCost: number;
    cacheCreationCost: number;
    totalCost: number;
  };
}

const pricingCache = new Map<string, PricingCacheEntry>();
const routingReferenceCostCache = new Map<string, RoutingReferenceCostCacheEntry>();

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function toPositiveInt(value: unknown): number {
  return Math.max(0, Math.round(toNumber(value, 0)));
}

function roundCost(value: number): number {
  return Math.round(Math.max(0, value) * 1_000_000) / 1_000_000;
}

function normalizeRatio(value: unknown, fallback: number): number {
  const ratio = toNumber(value, Number.NaN);
  if (Number.isFinite(ratio) && ratio >= 0) return ratio;
  return fallback;
}

function getCacheKey(input: EstimateProxyCostInput): string {
  return `${input.site.id}:${input.account.id}`;
}

function normalizeModelKey(modelName: string): string {
  return modelName.trim().toLowerCase();
}

function buildRoutingReferenceCostMap(data: PricingData): Map<string, number> {
  const costs = new Map<string, number>();
  for (const model of data.models.values()) {
    const cost = calculateModelUsageCost(model, ROUTING_REFERENCE_USAGE, data.groupRatio);
    if (!Number.isFinite(cost)) continue;
    costs.set(normalizeModelKey(model.modelName), Math.max(cost, MIN_ROUTING_REFERENCE_COST));
  }
  return costs;
}

function syncRoutingReferenceCostCache(
  key: string,
  fetchedAt: number,
  ttlMs: number,
  data: PricingData | null,
): void {
  if (!data) {
    routingReferenceCostCache.delete(key);
    return;
  }

  routingReferenceCostCache.set(key, {
    fetchedAt,
    ttlMs,
    costs: buildRoutingReferenceCostMap(data),
  });
}

async function fetchPricingData(input: EstimateProxyCostInput): Promise<PricingData | null> {
  return fetchUpstreamPricingCatalog(input);
}

async function getPricingDataCached(input: EstimateProxyCostInput): Promise<PricingData | null> {
  const key = getCacheKey(input);
  const now = Date.now();
  const cached = pricingCache.get(key);
  if (cached && now - cached.fetchedAt < cached.ttlMs) {
    if (cached.data && !routingReferenceCostCache.has(key)) {
      syncRoutingReferenceCostCache(key, cached.fetchedAt, cached.ttlMs, cached.data);
    }
    return cached.data;
  }

  const data = await fetchPricingData(input);
  const ttlMs = data ? PRICE_CACHE_TTL_MS : PRICE_CACHE_FAILURE_TTL_MS;
  pricingCache.set(key, {
    fetchedAt: now,
    ttlMs,
    data,
  });
  syncRoutingReferenceCostCache(key, now, ttlMs, data);
  return data;
}

async function refreshPricingDataCache(input: EstimateProxyCostInput): Promise<PricingData | null> {
  const key = getCacheKey(input);
  const now = Date.now();
  const data = await fetchPricingData(input);
  const ttlMs = data ? PRICE_CACHE_TTL_MS : PRICE_CACHE_FAILURE_TTL_MS;
  pricingCache.set(key, {
    fetchedAt: now,
    ttlMs,
    data,
  });
  syncRoutingReferenceCostCache(key, now, ttlMs, data);
  return data;
}

export function getCachedModelRoutingReferenceCost(input: {
  siteId: number;
  accountId: number;
  modelName: string;
}): number | null {
  const key = `${input.siteId}:${input.accountId}`;
  const cached = routingReferenceCostCache.get(key);
  if (!cached) return null;

  if (Date.now() - cached.fetchedAt >= cached.ttlMs) {
    return null;
  }

  const cost = cached.costs.get(normalizeModelKey(input.modelName));
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost <= 0) {
    return null;
  }

  return cost;
}

function resolveModel(modelName: string, data: PricingData): PricingModel | null {
  const exact = data.models.get(modelName);
  if (exact) return exact;

  const lower = modelName.toLowerCase();
  for (const [name, model] of data.models.entries()) {
    if (name.toLowerCase() === lower) return model;
  }

  return null;
}

function resolveGroupMultiplier(model: PricingModel, groupRatio: Record<string, number>): number {
  if (model.enableGroups.includes(DEFAULT_GROUP) && groupRatio[DEFAULT_GROUP]) {
    return groupRatio[DEFAULT_GROUP];
  }

  for (const group of model.enableGroups) {
    if (groupRatio[group]) return groupRatio[group];
  }

  const first = Object.values(groupRatio).find((ratio) => ratio > 0);
  return first || 1;
}

function calculatePerCallCost(
  modelPrice: number | { input?: number; output?: number } | null,
  multiplier: number,
): number {
  if (typeof modelPrice === 'number') {
    return modelPrice * multiplier;
  }

  if (modelPrice && typeof modelPrice === 'object') {
    // done-hub/one-hub times pricing follows input ratio only.
    return toNumber(modelPrice.input, 0) * multiplier * ONE_HUB_PER_CALL_RATIO;
  }

  return 0;
}

function calculatePerCallPricing(
  modelPrice: number | { input?: number; output?: number } | null,
  multiplier: number,
): { input?: number; output?: number; total: number } {
  if (typeof modelPrice === 'number') {
    const total = roundCost(modelPrice * multiplier);
    return { total };
  }

  if (modelPrice && typeof modelPrice === 'object') {
    const input = modelPrice.input == null
      ? undefined
      : roundCost(toNumber(modelPrice.input, 0) * multiplier * ONE_HUB_PER_CALL_RATIO);
    const output = modelPrice.output == null
      ? undefined
      : roundCost(toNumber(modelPrice.output, 0) * multiplier * ONE_HUB_PER_CALL_RATIO);
    return {
      input,
      output,
      total: input ?? 0,
    };
  }

  return { total: 0 };
}

function buildPricingOverrideModel(
  modelName: string,
  pricingOverride: ProxyBillingPricingOverride,
): { model: PricingModel; groupRatio: Record<string, number> } {
  const groupRatio = normalizeRatio(pricingOverride.groupRatio, 1);
  return {
    model: {
      modelName,
      quotaType: 0,
      modelRatio: normalizeRatio(pricingOverride.modelRatio, 1),
      completionRatio: normalizeRatio(pricingOverride.completionRatio, 1),
      cacheRatio: normalizeRatio(pricingOverride.cacheRatio, 1),
      cacheCreationRatio: normalizeRatio(pricingOverride.cacheCreationRatio, 1),
      modelPrice: null,
      enableGroups: [DEFAULT_GROUP],
    },
    groupRatio: { [DEFAULT_GROUP]: groupRatio },
  };
}

function normalizeUsageBreakdownInput(usage: {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  promptTokensIncludeCache?: boolean | null;
}) {
  const promptTokens = toPositiveInt(usage.promptTokens);
  const completionTokens = toPositiveInt(usage.completionTokens);
  const totalTokensRaw = toPositiveInt(usage.totalTokens);
  const totalTokens = Math.max(totalTokensRaw, promptTokens + completionTokens);
  const cacheReadTokens = toPositiveInt(usage.cacheReadTokens);
  const cacheCreationTokens = toPositiveInt(usage.cacheCreationTokens);
  const promptTokensIncludeCache = usage.promptTokensIncludeCache ?? null;
  const hasSplit = promptTokens > 0 || completionTokens > 0;
  const effectivePromptTokens = hasSplit ? promptTokens : totalTokens;
  const billablePromptTokens = promptTokensIncludeCache === false
    ? effectivePromptTokens
    : Math.max(0, effectivePromptTokens - cacheReadTokens - cacheCreationTokens);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cacheReadTokens,
    cacheCreationTokens,
    billablePromptTokens,
    promptTokensIncludeCache,
  };
}

export function calculateModelUsageBreakdown(
  model: PricingModel,
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    promptTokensIncludeCache?: boolean | null;
  },
  groupRatio: Record<string, number>,
): ProxyBillingDetails | null {
  if (model.quotaType === 1) {
    return null;
  }

  const multiplier = resolveGroupMultiplier(model, groupRatio);
  const normalizedUsage = normalizeUsageBreakdownInput(usage);
  const cacheRatio = model.cacheRatio ?? 1;
  const cacheCreationRatio = model.cacheCreationRatio ?? 1;
  const inputPerMillion = roundCost(model.modelRatio * 2 * multiplier);
  const outputPerMillion = roundCost(model.modelRatio * model.completionRatio * 2 * multiplier);
  const cacheReadPerMillion = roundCost(model.modelRatio * cacheRatio * 2 * multiplier);
  const cacheCreationPerMillion = roundCost(model.modelRatio * cacheCreationRatio * 2 * multiplier);
  const inputCost = roundCost((normalizedUsage.billablePromptTokens / 1_000_000) * inputPerMillion);
  const outputCost = roundCost((normalizedUsage.completionTokens / 1_000_000) * outputPerMillion);
  const cacheReadCost = roundCost((normalizedUsage.cacheReadTokens / 1_000_000) * cacheReadPerMillion);
  const cacheCreationCost = roundCost((normalizedUsage.cacheCreationTokens / 1_000_000) * cacheCreationPerMillion);
  const totalCost = roundCost(inputCost + outputCost + cacheReadCost + cacheCreationCost);

  return {
    quotaType: model.quotaType,
    usage: normalizedUsage,
    pricing: {
      modelRatio: model.modelRatio,
      completionRatio: model.completionRatio,
      cacheRatio,
      cacheCreationRatio,
      groupRatio: multiplier,
    },
    breakdown: {
      inputPerMillion,
      outputPerMillion,
      cacheReadPerMillion,
      cacheCreationPerMillion,
      inputCost,
      outputCost,
      cacheReadCost,
      cacheCreationCost,
      totalCost,
    },
  };
}

export function calculateModelUsageCost(
  model: PricingModel,
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    promptTokensIncludeCache?: boolean | null;
  },
  groupRatio: Record<string, number>,
): number {
  const multiplier = resolveGroupMultiplier(model, groupRatio);

  if (model.quotaType === 1) {
    return roundCost(calculatePerCallCost(model.modelPrice, multiplier));
  }

  return calculateModelUsageBreakdown(model, usage, groupRatio)?.breakdown.totalCost ?? 0;
}

async function evaluateEffectiveEndpointCost(
  input: EstimateProxyCostInput,
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    promptTokensIncludeCache?: boolean | null;
  },
) {
  return await resolveEndpointPricing({
    supply: {
      siteId: input.site.id,
      accountId: input.account.id,
      tokenId: input.tokenId ?? null,
      tokenGroup: input.upstreamGroup ?? null,
      provider: input.site.platform,
      modelName: input.modelName,
    },
    usage: {
      inputTokens: usage.promptTokens,
      outputTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.cacheCreationTokens ?? 0,
      requestCount: 1,
    },
  });
}

function pricingEvaluationToProxyBillingDetails(
  resolved: PricingResolution,
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    promptTokensIncludeCache?: boolean | null;
  },
): ProxyBillingDetails {
  const normalizedUsage = normalizeUsageBreakdownInput(usage);
  const evaluation = resolved.evaluation as PricingEvaluation;
  const componentCost = (kind: string) => evaluation.components
    .filter((component) => component.kind === kind)
    .reduce((sum, component) => sum + component.costUsd, 0);
  const componentUnitPrice = (kind: string) => {
    const component = evaluation.components.find((item) => item.kind === kind);
    if (!component) return null;
    return roundCost(component.unitPriceUsd);
  };

  return {
    source: resolved.source === 'provider_catalog' ? 'upstream_catalog' : 'upstream_cost_pricing',
    upstreamCostPricingId: typeof resolved.sourceId === 'number' ? resolved.sourceId : undefined,
    upstreamCostPricingScope: resolved.matchedScope ?? undefined,
    planFingerprint: evaluation.planFingerprint,
    estimateLevel: evaluation.estimateLevel,
    diagnostics: evaluation.diagnostics,
    quotaType: 0,
    usage: normalizedUsage,
    pricing: {
      modelRatio: 0,
      completionRatio: 0,
      cacheRatio: 0,
      cacheCreationRatio: 0,
      groupRatio: 1,
    },
    breakdown: {
      inputPerMillion: componentUnitPrice('input_tokens'),
      outputPerMillion: componentUnitPrice('output_tokens'),
      cacheReadPerMillion: componentUnitPrice('cache_read_tokens'),
      cacheCreationPerMillion: componentUnitPrice('cache_write_tokens'),
      inputCost: roundCost(componentCost('input_tokens')),
      outputCost: roundCost(componentCost('output_tokens')),
      cacheReadCost: roundCost(componentCost('cache_read_tokens')),
      cacheCreationCost: roundCost(componentCost('cache_write_tokens')),
      totalCost: roundCost(evaluation.totalCostUsd),
    },
  };
}

function buildModelPricingCatalogFromData(pricingData: PricingData): ModelPricingCatalog {
  const groups = Array.from(new Set([DEFAULT_GROUP, ...Object.keys(pricingData.groupRatio)]));
  const defaultMultiplier = pricingData.groupRatio[DEFAULT_GROUP] || 1;

  const models: ModelPricingCatalogEntry[] = Array.from(pricingData.models.values())
    .map((model) => {
      const allowedGroups = Array.from(new Set([...(model.enableGroups || []), DEFAULT_GROUP]));
      const modelGroups = groups.filter((group) => allowedGroups.includes(group));
      const effectiveGroups = modelGroups.length > 0 ? modelGroups : [DEFAULT_GROUP];

      const groupPricing = effectiveGroups.reduce<Record<string, ModelGroupPricing>>((acc, group) => {
        const multiplier = pricingData.groupRatio[group] || defaultMultiplier;
        if (model.quotaType === 1) {
          const perCall = calculatePerCallPricing(model.modelPrice, multiplier);
          acc[group] = {
            quotaType: 1,
            perCallInput: perCall.input,
            perCallOutput: perCall.output,
            perCallTotal: perCall.total,
          };
          return acc;
        }

        acc[group] = {
          quotaType: 0,
          inputPerMillion: roundCost(model.modelRatio * 2 * multiplier),
          outputPerMillion: roundCost(model.modelRatio * model.completionRatio * 2 * multiplier),
          cacheReadPerMillion: roundCost(model.modelRatio * (model.cacheRatio ?? 1) * 2 * multiplier),
          cacheCreationPerMillion: roundCost(model.modelRatio * (model.cacheCreationRatio ?? 1) * 2 * multiplier),
        };
        return acc;
      }, {});

      return {
        modelName: model.modelName,
        quotaType: model.quotaType,
        modelDescription: model.modelDescription || null,
        tags: model.tags || [],
        supportedEndpointTypes: model.supportedEndpointTypes || [],
        ownerBy: model.ownerBy || null,
        enableGroups: model.enableGroups || [DEFAULT_GROUP],
        groupPricing,
      };
    })
    .sort((a, b) => a.modelName.localeCompare(b.modelName));

  return {
    models,
    groupRatio: pricingData.groupRatio,
  };
}

export async function fetchModelPricingCatalog(input: EstimateProxyCostInput): Promise<ModelPricingCatalog | null> {
  const pricingData = await getPricingDataCached(input);
  if (!pricingData) return null;
  return buildModelPricingCatalogFromData(pricingData);
}

export async function refreshModelPricingCatalog(input: EstimateProxyCostInput): Promise<ModelPricingCatalog | null> {
  const pricingData = await refreshPricingDataCache(input);
  if (!pricingData) return null;
  return buildModelPricingCatalogFromData(pricingData);
}

export function fallbackTokenCost(totalTokens: number, platform: string): number {
  const divisor = platform === 'veloera' ? 1_000_000 : 500_000;
  return roundCost(toPositiveInt(totalTokens) / divisor);
}

export async function estimateProxyCost(input: EstimateProxyCostInput): Promise<number> {
  const promptTokens = toPositiveInt(input.promptTokens);
  const completionTokens = toPositiveInt(input.completionTokens);
  const totalTokens = toPositiveInt(input.totalTokens || (promptTokens + completionTokens));
  const usage = {
    promptTokens,
    completionTokens,
    totalTokens,
    cacheReadTokens: input.cacheReadTokens,
    cacheCreationTokens: input.cacheCreationTokens,
    promptTokensIncludeCache: input.promptTokensIncludeCache,
  };

  try {
    if (input.billingPricingOverride) {
      const pricingOverride = buildPricingOverrideModel(input.modelName, input.billingPricingOverride);
      return calculateModelUsageCost(pricingOverride.model, usage, pricingOverride.groupRatio);
    }

    const endpoint = await evaluateEffectiveEndpointCost(input, usage);
    if (endpoint?.summary.totalCostUsd != null) {
      return roundCost(endpoint.summary.totalCostUsd);
    }

    return fallbackTokenCost(totalTokens, input.site.platform);
  } catch {
    return fallbackTokenCost(totalTokens, input.site.platform);
  }
}

export async function buildProxyBillingDetails(input: EstimateProxyCostInput): Promise<ProxyBillingDetails | null> {
  const promptTokens = toPositiveInt(input.promptTokens);
  const completionTokens = toPositiveInt(input.completionTokens);
  const totalTokens = toPositiveInt(input.totalTokens || (promptTokens + completionTokens));
  const usage = {
    promptTokens,
    completionTokens,
    totalTokens,
    cacheReadTokens: input.cacheReadTokens,
    cacheCreationTokens: input.cacheCreationTokens,
    promptTokensIncludeCache: input.promptTokensIncludeCache,
  };

  try {
    if (input.billingPricingOverride) {
      const pricingOverride = buildPricingOverrideModel(input.modelName, input.billingPricingOverride);
      const details = calculateModelUsageBreakdown(pricingOverride.model, usage, pricingOverride.groupRatio);
      return details ? { ...details, source: 'billing_override' } : null;
    }

    const endpoint = await evaluateEffectiveEndpointCost(input, usage);
    if (endpoint?.evaluation) {
      return pricingEvaluationToProxyBillingDetails(endpoint, usage);
    }

    return null;
  } catch {
    return null;
  }
}
