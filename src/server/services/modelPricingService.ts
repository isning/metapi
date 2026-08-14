import { shouldUseProviderCatalogPricing } from './upstreamCostPricingService.js';
import { fetchUpstreamPricingCatalog } from './upstreamPricingCatalogService.js';
import type { PricingEvaluation } from '../pricing-core/index.js';
import { resolveEndpointPricing } from './endpointPricingService.js';
import type { PricingResolution } from './pricingQuoteTypes.js';
import type {
  ProxyBillingBreakdown,
  ProxyBillingDetails,
} from '../../shared/proxyBilling.js';
export type {
  ProxyBillingBreakdown,
  ProxyBillingDetails,
  ProxyBillingQuote,
} from '../../shared/proxyBilling.js';
import type {
  UpstreamDirectModelPrice,
  UpstreamPricingCatalog as PricingData,
  UpstreamPricingCredential,
  UpstreamPricingModel as PricingModel,
} from './upstreamPricingCatalog.js';
import { resolveUpstreamPricingModelGroup } from './upstreamPricingCatalog.js';

const PRICE_CACHE_TTL_MS = 10 * 60 * 1000;
const PRICE_CACHE_FAILURE_TTL_MS = 60 * 1000;
const DEFAULT_GROUP = 'default';
const ONE_HUB_PER_CALL_RATIO = 0.002;

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
    credential?: string | null;
    extraConfig?: string | Record<string, unknown> | null;
  };
  upstreamCredential?: UpstreamPricingCredential | null;
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
  inputPerMillion?: number | null;
  outputPerMillion?: number | null;
  cacheReadPerMillion?: number | null;
  cacheCreationPerMillion?: number | null;
  perCallInput?: number | null;
  perCallOutput?: number | null;
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

const pricingCache = new Map<string, PricingCacheEntry>();

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

async function fetchPricingData(input: EstimateProxyCostInput): Promise<PricingData | null> {
  return fetchUpstreamPricingCatalog(input);
}

async function getPricingDataCached(input: EstimateProxyCostInput): Promise<PricingData | null> {
  const key = getCacheKey(input);
  const now = Date.now();
  const cached = pricingCache.get(key);
  if (cached && now - cached.fetchedAt < cached.ttlMs) {
    return cached.data;
  }

  const data = await fetchPricingData(input);
  const ttlMs = data ? PRICE_CACHE_TTL_MS : PRICE_CACHE_FAILURE_TTL_MS;
  pricingCache.set(key, {
    fetchedAt: now,
    ttlMs,
    data,
  });
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
  return data;
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

function calculatePerCallCost(
  modelPrice: number | UpstreamDirectModelPrice | null,
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
  modelPrice: number | UpstreamDirectModelPrice | null,
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

function sanitizeRate(value: unknown): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return roundCost(numeric);
}

function resolveTokenRateCard(model: PricingModel, multiplier: number) {
  const directPrice = model.modelPrice && typeof model.modelPrice === 'object'
    ? model.modelPrice
    : null;
  if (directPrice) {
    return {
      inputPerMillion: sanitizeRate(directPrice.input == null ? null : directPrice.input * multiplier),
      outputPerMillion: sanitizeRate(directPrice.output == null ? null : directPrice.output * multiplier),
      cacheReadPerMillion: sanitizeRate(directPrice.cacheRead == null ? null : directPrice.cacheRead * multiplier),
      cacheCreationPerMillion: sanitizeRate(directPrice.cacheWrite == null ? null : directPrice.cacheWrite * multiplier),
    };
  }

  return {
    inputPerMillion: roundCost(model.modelRatio * 2 * multiplier),
    outputPerMillion: roundCost(model.modelRatio * model.completionRatio * 2 * multiplier),
    cacheReadPerMillion: model.cacheRatio == null
      ? null
      : roundCost(model.modelRatio * model.cacheRatio * 2 * multiplier),
    cacheCreationPerMillion: model.cacheCreationRatio == null
      ? null
      : roundCost(model.modelRatio * model.cacheCreationRatio * 2 * multiplier),
  };
}

function costFromRate(quantity: number, ratePerMillion: number | null): number {
  if (ratePerMillion == null) return 0;
  return roundCost((quantity / 1_000_000) * ratePerMillion);
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
  preferredGroup?: string | null,
): ProxyBillingBreakdown | null {
  if (model.quotaType === 1) {
    return null;
  }

  const resolvedGroup = resolveUpstreamPricingModelGroup({ model, groupRatio, preferredGroup });
  const modelForGroup = resolvedGroup.model;
  const multiplier = resolvedGroup.multiplier;
  const normalizedUsage = normalizeUsageBreakdownInput(usage);
  const cacheRatio = modelForGroup.cacheRatio ?? 0;
  const cacheCreationRatio = modelForGroup.cacheCreationRatio ?? 0;
  const rates = resolveTokenRateCard(modelForGroup, multiplier);
  const inputCost = costFromRate(normalizedUsage.billablePromptTokens, rates.inputPerMillion);
  const outputCost = costFromRate(normalizedUsage.completionTokens, rates.outputPerMillion);
  const cacheReadCost = costFromRate(normalizedUsage.cacheReadTokens, rates.cacheReadPerMillion);
  const cacheCreationCost = costFromRate(normalizedUsage.cacheCreationTokens, rates.cacheCreationPerMillion);
  const totalCost = roundCost(inputCost + outputCost + cacheReadCost + cacheCreationCost);

  return {
    quotaType: model.quotaType,
    usage: normalizedUsage,
    pricing: {
      modelRatio: modelForGroup.modelRatio,
      completionRatio: modelForGroup.completionRatio,
      cacheRatio,
      cacheCreationRatio,
      groupRatio: multiplier,
    },
    breakdown: {
      inputPerMillion: rates.inputPerMillion,
      outputPerMillion: rates.outputPerMillion,
      cacheReadPerMillion: rates.cacheReadPerMillion,
      cacheCreationPerMillion: rates.cacheCreationPerMillion,
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
  preferredGroup?: string | null,
): number {
  const resolvedGroup = resolveUpstreamPricingModelGroup({ model, groupRatio, preferredGroup });

  if (model.quotaType === 1) {
    return roundCost(calculatePerCallCost(resolvedGroup.model.modelPrice, resolvedGroup.multiplier));
  }

  return calculateModelUsageBreakdown(model, usage, groupRatio, preferredGroup)?.breakdown.totalCost ?? 0;
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
  const normalizedUsage = normalizeUsageBreakdownInput(usage);
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
      inputTokens: normalizedUsage.billablePromptTokens,
      outputTokens: normalizedUsage.completionTokens,
      totalTokens: normalizedUsage.totalTokens,
      cacheReadTokens: normalizedUsage.cacheReadTokens,
      cacheWriteTokens: normalizedUsage.cacheCreationTokens,
      requestCount: 1,
    },
    providerCatalogMode: 'refresh',
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
    .reduce((sum, component) => sum + component.cost, 0);
  const componentUnitPrice = (kind: string) => {
    const component = evaluation.components.find((item) => item.kind === kind);
    if (!component) return null;
    return roundCost(component.unitPrice);
  };

  return {
    quote: {
      amount: roundCost(evaluation.totalCost),
      unit: 'currency',
      currency: evaluation.currency,
      source: resolved.source === 'provider_catalog' ? 'provider_catalog' : 'upstream_cost_pricing',
      sourceId: resolved.sourceId,
      matchedScope: resolved.matchedScope,
      estimateLevel: evaluation.estimateLevel,
      planFingerprint: evaluation.planFingerprint,
    },
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
      totalCost: roundCost(evaluation.totalCost),
    },
  };
}

function buildModelPricingCatalogFromData(pricingData: PricingData): ModelPricingCatalog {
  const groups = Object.keys(pricingData.groupRatio);

  const models: ModelPricingCatalogEntry[] = Array.from(pricingData.models.values())
    .map((model) => {
      const effectiveGroups = groups.filter((group) => model.enableGroups.includes(group));

      const groupPricing = effectiveGroups.reduce<Record<string, ModelGroupPricing>>((acc, group) => {
        const resolvedGroup = resolveUpstreamPricingModelGroup({
          model,
          groupRatio: pricingData.groupRatio,
          preferredGroup: group,
        });
        if (resolvedGroup.model.quotaType === 1) {
          const perCall = calculatePerCallPricing(resolvedGroup.model.modelPrice, resolvedGroup.multiplier);
          acc[group] = {
            quotaType: 1,
            perCallInput: perCall.input,
            perCallOutput: perCall.output,
            perCallTotal: perCall.total,
          };
          return acc;
        }

        const rates = resolveTokenRateCard(resolvedGroup.model, resolvedGroup.multiplier);
        acc[group] = {
          quotaType: 0,
          inputPerMillion: rates.inputPerMillion,
          outputPerMillion: rates.outputPerMillion,
          cacheReadPerMillion: rates.cacheReadPerMillion,
          cacheCreationPerMillion: rates.cacheCreationPerMillion,
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

export function clearModelPricingCaches(): void {
  pricingCache.clear();
}

export async function estimateProxyCost(input: EstimateProxyCostInput): Promise<number | null> {
  return (await buildProxyBillingDetails(input))?.quote.amount ?? null;
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
      if (!details) return null;
      return {
        ...details,
        quote: {
          amount: details.breakdown.totalCost,
          unit: 'quota',
          currency: null,
          source: 'billing_override',
          sourceId: null,
          matchedScope: null,
          estimateLevel: 'exact',
          planFingerprint: null,
        },
      };
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
