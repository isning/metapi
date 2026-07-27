import type { CanonicalUsage } from '../pricing-core/index.js';
import { quoteEndpointPricing } from './pricingQuoteService.js';
import {
  compiledRuntimeRequestUsageConstraints,
  loadCompiledRuntimeUsageForecast,
  type CompiledRuntimeUsageForecast,
} from './compiledRuntimeUsageForecastService.js';
import type { CompiledRouteRuntimeRequest } from './compiledRuntimeRequestTypes.js';
import {
  proxyTargetCoordinator,
  type ProxyTargetLoadSnapshot,
} from './proxyTargetCoordinator.js';
import type {
  RuntimeHealthSummary,
  RuntimeRoutingSignals,
} from './compiledRuntimeProjectionService.js';
import type { DownstreamRoutingPolicy } from './downstreamPolicyTypes.js';

const MIN_EFFECTIVE_UNIT_COST = 1e-6;
const SITE_RUNTIME_MIN_MULTIPLIER = 0.08;
const SITE_HISTORICAL_HEALTH_MIN_MULTIPLIER = 0.45;
const SITE_HISTORICAL_HEALTH_MAX_SAMPLE = 24;
const SITE_HISTORICAL_LATENCY_BASELINE_MS = 2_000;
const SITE_HISTORICAL_LATENCY_WINDOW_MS = 20_000;
const SITE_HISTORICAL_MAX_LATENCY_PENALTY = 0.18;
const SITE_RECENT_SUCCESS_CONFIDENCE_SAMPLES = 12;

type ReferencePricingSignal = RuntimeRoutingSignals['referencePricing'];

type HistoricalHealth = RuntimeRoutingSignals['historicalHealth'];
type RuntimeCostSignal = RuntimeRoutingSignals['cost'];

export type RuntimeRoutingSignalEndpointState = {
  successCount: number;
  failCount: number;
  totalLatencyMs: number;
  latencySampleCount: number;
};

export type RuntimeRoutingSignalContext = {
  executionAttemptId: string;
  entryId?: string | null;
  selectionGroupId: string;
  enabled: boolean;
  siteId: number | null;
  accountId: number | null;
  tokenId: number | null;
  tokenGroup?: string | null;
  provider?: string | null;
  modelName: string;
  executionTargetId: number | null;
  weight: number | null;
  order: number;
  accountBalance: number | null;
  accountExtraConfig?: string | null;
  accountOauthProvider?: string | null;
  siteGlobalWeight: number | null;
  health: RuntimeHealthSummary | null;
  endpointState: RuntimeRoutingSignalEndpointState | null;
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteNumberOrFallback(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveNumberOrFallback(value: unknown, fallback: number): number {
  const parsed = finiteNumberOrFallback(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function knownNonNegativeNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function roundSignal(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeByRange(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  const range = max - min;
  return clampNumber((value - min) / range, 0, 1);
}

function resolveRuntimeLoadMultiplier(snapshot: ProxyTargetLoadSnapshot): number {
  if (!snapshot.sessionScoped || snapshot.concurrencyLimit <= 0) return 1;
  const activeRatio = clampNumber(snapshot.activeLeaseCount / Math.max(1, snapshot.concurrencyLimit), 0, 1.5);
  const waitingRatio = clampNumber(snapshot.waitingCount / Math.max(1, snapshot.concurrencyLimit), 0, 3);
  const activePenalty = activeRatio * 0.28;
  const waitingPenalty = waitingRatio * 0.32;
  const saturationPenalty = snapshot.saturated ? 0.12 : 0;
  return clampNumber(1 - activePenalty - waitingPenalty - saturationPenalty, 0.18, 1);
}

function historicalHealthBySite(contexts: RuntimeRoutingSignalContext[]): Map<number, HistoricalHealth> {
  const totals = new Map<number, {
    totalCalls: number;
    successCount: number;
    failCount: number;
    totalLatencyMs: number;
    latencySamples: number;
  }>();

  for (const context of contexts) {
    const siteId = Number(context.siteId);
    if (!Number.isSafeInteger(siteId) || siteId <= 0) continue;
    if (!context.endpointState) continue;
    const current = totals.get(siteId) || {
      totalCalls: 0,
      successCount: 0,
      failCount: 0,
      totalLatencyMs: 0,
      latencySamples: 0,
    };
    const successCount = Math.max(0, Math.trunc(context.endpointState.successCount || 0));
    const failCount = Math.max(0, Math.trunc(context.endpointState.failCount || 0));
    current.successCount += successCount;
    current.failCount += failCount;
    current.totalCalls += successCount + failCount;
    const latencySampleCount = Math.max(0, Math.trunc(context.endpointState.latencySampleCount || 0));
    if (latencySampleCount > 0) {
      current.totalLatencyMs += Math.max(0, context.endpointState.totalLatencyMs || 0);
      current.latencySamples += latencySampleCount;
    }
    totals.set(siteId, current);
  }

  const result = new Map<number, HistoricalHealth>();
  for (const [siteId, total] of totals.entries()) {
    if (total.totalCalls <= 0) {
      result.set(siteId, {
        status: 'insufficient_data',
        multiplier: null,
        totalCalls: 0,
        successRate: null,
        avgLatencyMs: null,
      });
      continue;
    }
    const sampleFactor = clampNumber(total.totalCalls / SITE_HISTORICAL_HEALTH_MAX_SAMPLE, 0, 1);
    const successRate = total.successCount / total.totalCalls;
    const successPenaltyFactor = 1 - ((1 - successRate) * 0.55 * sampleFactor);
    const avgLatencyMs = total.latencySamples > 0
      ? Math.round(total.totalLatencyMs / total.latencySamples)
      : null;
    const latencyPenaltyRatio = avgLatencyMs == null
      ? 0
      : clampNumber(
        (avgLatencyMs - SITE_HISTORICAL_LATENCY_BASELINE_MS) / SITE_HISTORICAL_LATENCY_WINDOW_MS,
        0,
        1,
      ) * sampleFactor;
    const latencyFactor = 1 - (latencyPenaltyRatio * SITE_HISTORICAL_MAX_LATENCY_PENALTY);
    result.set(siteId, {
      status: 'available',
      multiplier: clampNumber(successPenaltyFactor * latencyFactor, SITE_HISTORICAL_HEALTH_MIN_MULTIPLIER, 1),
      totalCalls: total.totalCalls,
      successRate,
      avgLatencyMs,
    });
  }
  return result;
}

function siteAttemptCounts(contexts: RuntimeRoutingSignalContext[]): Map<number, number> {
  const result = new Map<number, number>();
  for (const context of contexts) {
    if (context.enabled === false) continue;
    const siteId = Number(context.siteId);
    if (!Number.isSafeInteger(siteId) || siteId <= 0) continue;
    result.set(siteId, (result.get(siteId) || 0) + 1);
  }
  return result;
}

async function resolveReferencePricing(context: RuntimeRoutingSignalContext): Promise<ReferencePricingSignal> {
  const siteId = Math.trunc(Number(context.siteId));
  const accountId = Math.trunc(Number(context.accountId));
  if (Number.isSafeInteger(siteId) && siteId > 0 && Number.isSafeInteger(accountId) && accountId > 0) {
    const endpointPricing = await quoteEndpointPricing({
      supply: {
        siteId,
        accountId,
        tokenId: context.tokenId ?? null,
        tokenGroup: context.tokenGroup || undefined,
        provider: context.provider || undefined,
        modelName: context.modelName,
      },
      usageProfile: 'routing_reference',
      includeReference: false,
      allowProviderCatalog: true,
      providerCatalogMode: 'cache_only',
    });
    const usesSystemDefaultPrice = endpointPricing.endpoint?.source === 'system_default'
      || endpointPricing.endpoint?.sourceType === 'system_default';
    const rawCost = usesSystemDefaultPrice ? null : endpointPricing.endpoint?.summary.totalCost ?? null;
    const walletCost = usesSystemDefaultPrice ? null : endpointPricing.effectiveCost?.walletCostBaseCurrency ?? null;
    const freeQuotaDaysCost = usesSystemDefaultPrice ? null : endpointPricing.effectiveCost?.freeQuotaDaysCost ?? null;
    if (typeof walletCost === 'number' && Number.isFinite(walletCost) && walletCost >= 0) {
      return {
        scenario: 'routing_reference',
        source: 'wallet_acquisition',
        rawCost,
        effectiveCost: walletCost,
        baseCostUnit: endpointPricing.effectiveCost?.baseCostUnit ?? null,
        balanceBurn: endpointPricing.effectiveCost?.balanceBurn ?? [],
      };
    }
    if (typeof freeQuotaDaysCost === 'number' && Number.isFinite(freeQuotaDaysCost) && freeQuotaDaysCost >= 0) {
      return {
        scenario: 'routing_reference',
        source: 'free_quota',
        rawCost,
        effectiveCost: freeQuotaDaysCost,
        baseCostUnit: endpointPricing.effectiveCost?.baseCostUnit ?? null,
        balanceBurn: endpointPricing.effectiveCost?.balanceBurn ?? [],
      };
    }
  }

  return {
    scenario: 'routing_reference',
    source: 'unavailable',
    rawCost: null,
    effectiveCost: null,
    baseCostUnit: null,
    balanceBurn: [],
  };
}

function usageForCostSignal(inputTokens: number, outputTokens: number): Partial<CanonicalUsage> {
  const input = Math.max(0, Math.trunc(inputTokens));
  const output = Math.max(0, Math.trunc(outputTokens));
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    requestCount: 1,
  };
}

function emptyCostSignal(
  forecast: CompiledRuntimeUsageForecast,
  status: RuntimeCostSignal['status'] = 'insufficient_data',
): RuntimeCostSignal {
  return {
    status,
    currency: null,
    forecast: forecast.status === 'available'
      ? {
          sampleCount: forecast.sampleCount,
          confidence: forecast.confidence,
          estimatedInputTokens: forecast.estimatedInputTokens,
          expectedOutputTokens: forecast.expectedOutputTokens,
          p90OutputTokens: forecast.p90OutputTokens,
          maxOutputTokens: forecast.maxOutputTokens,
        }
      : {
          sampleCount: forecast.sampleCount,
          confidence: forecast.confidence,
          estimatedInputTokens: null,
          expectedOutputTokens: null,
          p90OutputTokens: null,
          maxOutputTokens: forecast.maxOutputTokens,
        },
    floor: null,
    expected: null,
    p90: null,
    ceiling: null,
    routingCost: null,
  };
}

async function resolveRequestCostSignal(
  context: RuntimeRoutingSignalContext,
  forecast: CompiledRuntimeUsageForecast,
): Promise<RuntimeCostSignal> {
  if (forecast.status !== 'available') return emptyCostSignal(forecast);
  const siteId = Math.trunc(Number(context.siteId));
  const accountId = Math.trunc(Number(context.accountId));
  if (!Number.isSafeInteger(siteId) || siteId <= 0 || !Number.isSafeInteger(accountId) || accountId <= 0) {
    return emptyCostSignal(forecast, 'pricing_unavailable');
  }

  const quote = async (outputTokens: number) => await quoteEndpointPricing({
    supply: {
      siteId,
      accountId,
      tokenId: context.tokenId ?? null,
      tokenGroup: context.tokenGroup || undefined,
      provider: context.provider || undefined,
      modelName: context.modelName,
    },
    usageProfile: 'actual',
    usage: usageForCostSignal(forecast.estimatedInputTokens, outputTokens),
    includeReference: false,
    allowProviderCatalog: true,
    providerCatalogMode: 'cache_only',
  });
  const ceilingOutput = forecast.maxOutputTokens;
  const [floorQuote, expectedQuote, p90Quote, ceilingQuote] = await Promise.all([
    quote(0),
    quote(forecast.expectedOutputTokens),
    quote(forecast.p90OutputTokens),
    ceilingOutput == null ? Promise.resolve(null) : quote(ceilingOutput),
  ]);
  const point = (value: Awaited<ReturnType<typeof quoteEndpointPricing>> | null) => value == null
    ? null
    : {
        rawCost: value.endpoint?.summary.totalCost ?? null,
        effectiveCost: value.effectiveCost?.walletCostBaseCurrency ?? null,
      };
  const floor = point(floorQuote);
  const expected = point(expectedQuote);
  const p90 = point(p90Quote);
  const ceiling = point(ceilingQuote);
  const expectedEffective = expected?.effectiveCost;
  const p90Effective = p90?.effectiveCost;
  if (
    typeof expectedEffective !== 'number'
    || !Number.isFinite(expectedEffective)
    || typeof p90Effective !== 'number'
    || !Number.isFinite(p90Effective)
  ) {
    return {
      ...emptyCostSignal(forecast, 'pricing_unavailable'),
      currency: expectedQuote.effectiveCost?.baseCostUnit ?? expectedQuote.endpoint?.summary.currency ?? null,
      floor,
      expected,
      p90,
      ceiling,
    };
  }
  // Keep expected behavior primary while pricing enough tail risk to avoid unstable cheap paths.
  const routingCost = expectedEffective + Math.max(0, p90Effective - expectedEffective) * 0.25;
  return {
    status: 'available',
    currency: expectedQuote.effectiveCost?.baseCostUnit ?? expectedQuote.endpoint?.summary.currency ?? null,
    forecast: {
      sampleCount: forecast.sampleCount,
      confidence: forecast.confidence,
      estimatedInputTokens: forecast.estimatedInputTokens,
      expectedOutputTokens: forecast.expectedOutputTokens,
      p90OutputTokens: forecast.p90OutputTokens,
      maxOutputTokens: forecast.maxOutputTokens,
    },
    floor,
    expected,
    p90,
    ceiling,
    routingCost,
  };
}

function runtimeHealthFromSummary(health: RuntimeHealthSummary | null): RuntimeRoutingSignals['runtimeHealth'] {
  if (!health) {
    return {
      status: 'unavailable',
      globalMultiplier: null,
      modelMultiplier: null,
      combinedMultiplier: null,
      globalBreakerOpen: false,
      modelBreakerOpen: false,
      recentSuccessRate: null,
      recentSampleCount: null,
      recentConfidence: null,
    };
  }
  const recentSuccessRate = health?.successRate ?? null;
  const recentSampleCount = Math.max(0, health?.totalCalls || 0);
  if (recentSampleCount === 0 || recentSuccessRate == null) {
    return {
      status: 'insufficient_data',
      globalMultiplier: null,
      modelMultiplier: null,
      combinedMultiplier: null,
      globalBreakerOpen: false,
      modelBreakerOpen: false,
      recentSuccessRate,
      recentSampleCount,
      recentConfidence: 0,
    };
  }
  const recentConfidence = clampNumber(recentSampleCount / SITE_RECENT_SUCCESS_CONFIDENCE_SAMPLES, 0, 1);
  const observedMultiplier = recentSuccessRate == null
    ? 1
    : clampNumber(SITE_RUNTIME_MIN_MULTIPLIER + (recentSuccessRate * (1 - SITE_RUNTIME_MIN_MULTIPLIER)), SITE_RUNTIME_MIN_MULTIPLIER, 1);
  return {
    status: 'available',
    globalMultiplier: observedMultiplier,
    modelMultiplier: 1,
    combinedMultiplier: observedMultiplier,
    globalBreakerOpen: false,
    modelBreakerOpen: false,
    recentSuccessRate,
    recentSampleCount,
    recentConfidence,
  };
}

function stableFirstSuccessRate(
  runtimeHealth: RuntimeRoutingSignals['runtimeHealth'],
  historicalHealth: HistoricalHealth,
): number | null {
  if ((runtimeHealth.recentSampleCount || 0) > 0 && runtimeHealth.recentSuccessRate != null) {
    const historical = historicalHealth.successRate ?? 0.5;
    const recentConfidence = runtimeHealth.recentConfidence ?? 0;
    return clampNumber(
      runtimeHealth.recentSuccessRate * recentConfidence
        + historical * (1 - recentConfidence),
      0,
      1,
    );
  }
  return historicalHealth.successRate == null ? null : clampNumber(historicalHealth.successRate, 0, 1);
}

function groupRange<T>(
  items: T[],
  value: (item: T) => number | null,
): { min: number; max: number } | null {
  const values = items.map(value).filter((item): item is number => item != null && Number.isFinite(item));
  return values.length > 0 ? { min: Math.min(...values), max: Math.max(...values) } : null;
}

function insufficientUsageForecast(
  constraints: ReturnType<typeof compiledRuntimeRequestUsageConstraints>,
): Extract<CompiledRuntimeUsageForecast, { status: 'insufficient_data' }> {
  return {
    status: 'insufficient_data',
    sampleCount: 0,
    confidence: 0,
    maxOutputTokens: constraints.maxOutputTokens,
  };
}

export async function buildRuntimeRoutingSignalMap(input: {
  contexts: RuntimeRoutingSignalContext[];
  downstreamPolicy?: DownstreamRoutingPolicy | null;
  request?: CompiledRouteRuntimeRequest | null;
}): Promise<Map<string, RuntimeRoutingSignals>> {
  const contexts = input.contexts;
  const historicalBySiteId = historicalHealthBySite(contexts);
  const attemptCountBySiteId = siteAttemptCounts(contexts);
  const emptyReferencePricing = (): ReferencePricingSignal => ({
    scenario: 'routing_reference',
    source: 'unavailable',
    rawCost: null,
    effectiveCost: null,
    baseCostUnit: null,
    balanceBurn: [],
  });
  const referencePricing = await Promise.all(contexts.map(resolveReferencePricing));
  const requestConstraints = compiledRuntimeRequestUsageConstraints(input.request);
  const uniqueEntryIds = Array.from(new Set(contexts
    .map((context) => String(context.entryId || '').trim())
    .filter(Boolean)));
  const forecastEntries = await Promise.all(uniqueEntryIds.map(async (entryId) => [
    entryId,
    input.request
      ? await loadCompiledRuntimeUsageForecast({ entryId, request: input.request })
      : insufficientUsageForecast(requestConstraints),
  ] as const));
  const forecastByEntryId = new Map(forecastEntries);
  const costSignals = await Promise.all(contexts.map((context) => {
    const forecast = forecastByEntryId.get(String(context.entryId || '').trim())
      || insufficientUsageForecast(requestConstraints);
    return resolveRequestCostSignal(context, forecast);
  }));

  const drafts = contexts.map((context, index) => {
    const staticReferencePricing = referencePricing[index] || emptyReferencePricing();
    const cost = costSignals[index] || emptyCostSignal(insufficientUsageForecast(requestConstraints));
    const siteId = Number(context.siteId);
    const siteGlobalWeight = positiveNumberOrFallback(context.siteGlobalWeight, 1);
    const downstreamSiteMultiplier = Number.isSafeInteger(siteId) && siteId > 0
      ? positiveNumberOrFallback(input.downstreamPolicy?.siteWeightMultipliers?.[siteId], 1)
      : 1;
    const combinedSiteWeight = siteGlobalWeight * downstreamSiteMultiplier;
    const successCount = context.endpointState
      ? Math.max(0, Math.trunc(context.endpointState.successCount || 0))
      : null;
    const failCount = context.endpointState
      ? Math.max(0, Math.trunc(context.endpointState.failCount || 0))
      : null;
    const recentUsage = context.health ? Math.max(0, Math.trunc(context.health.totalCalls || 0)) : null;
    const routingCost = cost.status === 'available' && cost.routingCost != null
      ? Math.max(cost.routingCost, MIN_EFFECTIVE_UNIT_COST)
      : null;
    const inverseRoutingCost = routingCost == null ? Number.NaN : 1 / routingCost;
    const inverseRecentUsage = recentUsage == null ? null : 1 / (recentUsage + 1);
    const balance = knownNonNegativeNumber(context.accountBalance);
    const siteAttemptCount = Number.isSafeInteger(siteId) && siteId > 0
      ? Math.max(1, attemptCountBySiteId.get(siteId) || 1)
      : 1;
    const historicalHealth: HistoricalHealth = Number.isSafeInteger(siteId) && siteId > 0
      ? historicalBySiteId.get(siteId) || { status: 'unavailable', multiplier: null, successRate: null, avgLatencyMs: null, totalCalls: null }
      : { status: 'unavailable', multiplier: null, successRate: null, avgLatencyMs: null, totalCalls: null };
    const runtimeHealth = runtimeHealthFromSummary(context.health);
    const targetId = Math.trunc(Number(context.executionTargetId));
    const loadSnapshot = proxyTargetCoordinator.getTargetLoadSnapshot({
      targetId: Number.isSafeInteger(targetId) && targetId > 0 ? targetId : 0,
      accountExtraConfig: context.accountExtraConfig,
      accountOauthProvider: context.accountOauthProvider,
    });
    const runtimeLoadMultiplier = resolveRuntimeLoadMultiplier(loadSnapshot);
    const effectiveSuccessRate = stableFirstSuccessRate(runtimeHealth, historicalHealth);
    const stableFirstContribution = Math.max(1e-4, (effectiveSuccessRate ?? 1) ** 2)
      * (runtimeHealth.combinedMultiplier ?? 1)
      * runtimeLoadMultiplier
      / siteAttemptCount;
    return {
      context,
      referencePricing: staticReferencePricing,
      cost,
      routingCost,
      siteGlobalWeight,
      downstreamSiteMultiplier,
      combinedSiteWeight,
      successCount,
      failCount,
      recentUsage,
      inverseRoutingCost,
      inverseRecentUsage,
      balance,
      siteAttemptCount,
      historicalHealth,
      runtimeHealth,
      loadSnapshot,
      runtimeLoadMultiplier,
      effectiveSuccessRate,
      stableFirstContribution,
    };
  });

  const draftsBySelectorScope = new Map<string, typeof drafts>();
  for (const draft of drafts) {
    const selectorScopeId = draft.context.selectionGroupId;
    const scopedDrafts = draftsBySelectorScope.get(selectorScopeId) || [];
    scopedDrafts.push(draft);
    draftsBySelectorScope.set(selectorScopeId, scopedDrafts);
  }

  const result = new Map<string, RuntimeRoutingSignals>();
  for (const scopedDrafts of draftsBySelectorScope.values()) {
    const costRange = groupRange(scopedDrafts, (draft) => draft.inverseRoutingCost);
    const balanceRange = groupRange(scopedDrafts, (draft) => draft.balance);
    const usageRange = groupRange(scopedDrafts, (draft) => draft.inverseRecentUsage);
    const normalizedDrafts = scopedDrafts.map((draft) => {
      const normalizedCostScore = draft.inverseRoutingCost != null && Number.isFinite(draft.inverseRoutingCost) && costRange
        ? normalizeByRange(draft.inverseRoutingCost, costRange.min, costRange.max)
        : null;
      const normalizedBalanceScore = draft.balance != null && balanceRange
        ? normalizeByRange(draft.balance, balanceRange.min, balanceRange.max)
        : null;
      const normalizedUsageScore = draft.inverseRecentUsage != null && usageRange
        ? normalizeByRange(draft.inverseRecentUsage, usageRange.min, usageRange.max)
        : null;
      return {
        ...draft,
        normalizedCostScore,
        normalizedBalanceScore,
        normalizedUsageScore,
      };
    });
    const stableSiteLeaders = new Map<number, string>();
    const stableSiteOrder = new Map<number, number>();
    [...normalizedDrafts]
      .sort((left, right) => right.stableFirstContribution - left.stableFirstContribution)
      .forEach((draft) => {
        const siteId = Math.trunc(Number(draft.context.siteId));
        if (!Number.isSafeInteger(siteId) || siteId <= 0 || stableSiteLeaders.has(siteId)) return;
        stableSiteLeaders.set(siteId, draft.context.executionAttemptId);
        stableSiteOrder.set(siteId, stableSiteOrder.size + 1);
      });

    normalizedDrafts.forEach((draft, index) => {
      const siteId = Math.trunc(Number(draft.context.siteId));
      result.set(draft.context.executionAttemptId, {
        referencePricing: {
          scenario: 'routing_reference',
          source: draft.referencePricing.source,
          rawCost: draft.referencePricing.rawCost == null ? null : roundSignal(draft.referencePricing.rawCost),
          effectiveCost: draft.referencePricing.effectiveCost == null ? null : roundSignal(draft.referencePricing.effectiveCost),
          baseCostUnit: draft.referencePricing.baseCostUnit,
          balanceBurn: draft.referencePricing.balanceBurn.map((item) => ({
            unit: item.unit,
            amount: roundSignal(item.amount),
          })),
        },
        cost: {
          ...draft.cost,
          currency: draft.cost.currency,
          floor: draft.cost.floor && {
            rawCost: draft.cost.floor.rawCost == null ? null : roundSignal(draft.cost.floor.rawCost),
            effectiveCost: draft.cost.floor.effectiveCost == null ? null : roundSignal(draft.cost.floor.effectiveCost),
          },
          expected: draft.cost.expected && {
            rawCost: draft.cost.expected.rawCost == null ? null : roundSignal(draft.cost.expected.rawCost),
            effectiveCost: draft.cost.expected.effectiveCost == null ? null : roundSignal(draft.cost.expected.effectiveCost),
          },
          p90: draft.cost.p90 && {
            rawCost: draft.cost.p90.rawCost == null ? null : roundSignal(draft.cost.p90.rawCost),
            effectiveCost: draft.cost.p90.effectiveCost == null ? null : roundSignal(draft.cost.p90.effectiveCost),
          },
          ceiling: draft.cost.ceiling && {
            rawCost: draft.cost.ceiling.rawCost == null ? null : roundSignal(draft.cost.ceiling.rawCost),
            effectiveCost: draft.cost.ceiling.effectiveCost == null ? null : roundSignal(draft.cost.ceiling.effectiveCost),
          },
          routingCost: draft.cost.routingCost == null ? null : roundSignal(draft.cost.routingCost),
        },
        balance: draft.balance == null ? null : roundSignal(draft.balance),
        rawBalance: draft.balance == null ? null : roundSignal(draft.balance),
        normalizedBalance: draft.normalizedBalanceScore == null ? null : roundSignal(draft.normalizedBalanceScore),
        recentUsage: draft.recentUsage,
        successCount: draft.successCount,
        failCount: draft.failCount,
        totalLatencyMs: draft.context.endpointState
          ? Math.max(0, Math.trunc(draft.context.endpointState.totalLatencyMs || 0))
          : null,
        sameSiteExecutionAttemptCount: draft.siteAttemptCount,
        siteGlobalWeight: roundSignal(draft.siteGlobalWeight),
        downstreamSiteMultiplier: roundSignal(draft.downstreamSiteMultiplier),
        combinedSiteWeight: roundSignal(draft.combinedSiteWeight),
        runtimeHealth: {
          ...draft.runtimeHealth,
          globalMultiplier: draft.runtimeHealth.globalMultiplier == null ? null : roundSignal(draft.runtimeHealth.globalMultiplier),
          modelMultiplier: draft.runtimeHealth.modelMultiplier == null ? null : roundSignal(draft.runtimeHealth.modelMultiplier),
          combinedMultiplier: draft.runtimeHealth.combinedMultiplier == null ? null : roundSignal(draft.runtimeHealth.combinedMultiplier),
          recentSuccessRate: draft.runtimeHealth.recentSuccessRate == null ? null : roundSignal(draft.runtimeHealth.recentSuccessRate),
          recentSampleCount: draft.runtimeHealth.recentSampleCount == null ? null : roundSignal(draft.runtimeHealth.recentSampleCount),
          recentConfidence: draft.runtimeHealth.recentConfidence == null ? null : roundSignal(draft.runtimeHealth.recentConfidence),
        },
        historicalHealth: {
          status: draft.historicalHealth.status,
          multiplier: draft.historicalHealth.multiplier == null ? null : roundSignal(draft.historicalHealth.multiplier),
          successRate: draft.historicalHealth.successRate == null ? null : roundSignal(draft.historicalHealth.successRate),
          avgLatencyMs: draft.historicalHealth.avgLatencyMs,
          totalCalls: draft.historicalHealth.totalCalls,
        },
        runtimeLoad: {
          activeLeaseCount: draft.loadSnapshot.activeLeaseCount,
          waitingCount: draft.loadSnapshot.waitingCount,
          concurrencyLimit: draft.loadSnapshot.concurrencyLimit,
          saturated: draft.loadSnapshot.saturated,
          multiplier: roundSignal(draft.runtimeLoadMultiplier),
        },
        inverseRoutingCost: Number.isFinite(draft.inverseRoutingCost)
          ? roundSignal(draft.inverseRoutingCost)
          : null,
        inverseRecentUsage: draft.inverseRecentUsage == null ? null : roundSignal(draft.inverseRecentUsage),
        normalizedCostScore: draft.normalizedCostScore == null ? null : roundSignal(draft.normalizedCostScore),
        normalizedBalanceScore: draft.normalizedBalanceScore == null ? null : roundSignal(draft.normalizedBalanceScore),
        normalizedUsageScore: draft.normalizedUsageScore == null ? null : roundSignal(draft.normalizedUsageScore),
        stableFirst: {
          effectiveSuccessRate: draft.effectiveSuccessRate == null ? null : roundSignal(draft.effectiveSuccessRate),
          siteOrder: draft.effectiveSuccessRate != null && Number.isSafeInteger(siteId) && siteId > 0 ? stableSiteOrder.get(siteId) ?? null : null,
          siteLeader: draft.effectiveSuccessRate != null && Number.isSafeInteger(siteId) && siteId > 0
            ? stableSiteLeaders.get(siteId) === draft.context.executionAttemptId
            : null,
        },
      });
    });
  }

  return result;
}
