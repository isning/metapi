import type { ModelRouteFlowData } from '../../components/ModelRouteFlow.js';
import type { ModelRouteFlowDiagnostics } from '../../api.js';
import type { ModelRuntimeObservability } from '../../api.js';
import type {
  ModelsMarketplaceAccount,
  ModelsMarketplaceGroupPricing,
  ModelsMarketplaceModel,
  ModelsMarketplacePricingSource,
  ModelsMarketplaceToken,
} from '../../../shared/modelsMarketplace.js';
import { tr } from '../../i18n.js';

export type ModelTokenInfo = ModelsMarketplaceToken;
export type ModelGroupPricing = ModelsMarketplaceGroupPricing;
export type ModelPricingSource = ModelsMarketplacePricingSource;

type RouteFlowTheoreticalPricing = NonNullable<NonNullable<ModelRouteFlowData['entryPricing']>['theoretical']>;
type ModelEntryPricingExecutionAttempt = RouteFlowTheoreticalPricing['executionAttempts'][number];

export type ModelEntryPricing = {
  currency?: string | null;
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cacheReadPerMillion?: number | null;
  cacheWritePerMillion?: number | null;
  reasoningPerMillion?: number | null;
  requestCost?: number | null;
  totalCost?: number | null;
  inputMultiplier: number | null;
  outputMultiplier: number | null;
  totalMultiplier?: number | null;
  components?: RouteFlowTheoreticalPricing['components'];
  usage?: RouteFlowTheoreticalPricing['usage'];
  effectiveCost?: {
    walletCostBaseCurrency: number | null;
    baseCostUnit: string | null;
    freeQuotaDaysCost: number | null;
    balanceBurn: Array<{ unit: string; amount: number }>;
    estimateLevel: 'exact' | 'static_estimate' | 'incomplete';
    diagnostics: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
  } | null;
  sourceCount: number;
  estimateLevel?: 'exact' | 'static_estimate' | 'incomplete';
  selectionMode?: 'weighted' | 'ordered' | 'round_robin' | 'direct' | 'mixed' | null;
  sampleCount?: number;
  lastMeasuredAt?: string | null;
  diagnostics?: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
  executionAttempts?: ModelEntryPricingExecutionAttempt[];
};

export type ModelAccountInfo = ModelsMarketplaceAccount;
export type ModelRow = ModelsMarketplaceModel;

export type ModelDetailsTab = 'overview' | 'routing' | 'performance' | 'api' | 'diagnostics';
export type ModelMetricsRange = '5m' | '15m' | '1h' | '6h' | '24h' | '7d' | '30d';
type RuntimeHistoryBucket = ModelRuntimeObservability['history']['buckets'][number];

export type ModelDetailsView = {
  model: ModelRow;
  brandName: string | null;
  status: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
  routeFlow: ModelRouteFlowData | null;
  routeFlowDiagnostics?: ModelRouteFlowDiagnostics | null;
  routeFlowLoading: boolean;
  routeFlowError: string;
  observability: ModelRuntimeObservability | null;
  observabilityLoading: boolean;
  observabilityError: string;
  performanceObservability: ModelRuntimeObservability | null;
  performanceObservabilityLoading: boolean;
  performanceObservabilityError: string;
  diagnostics: ModelRouteFlowData['diagnostics'];
  diagnosticsPayload: ModelRouteFlowData | null;
  freshnessLabel: string;
  descriptionText: string;
  overview: {
    displayMetrics: {
      successRate: number | null;
      avgLatency: number | null;
      avgFirstTokenLatency: number | null;
      avgOutputTokensPerSecond: number | null;
    };
    supportedEndpointTypes: string[];
    routeSummary: string[];
    routeSummaryLoading: boolean;
    routeSummaryRefreshing: boolean;
    routeSummaryError: string;
  };
  routing: {
    flow: ModelRouteFlowData | null;
    loading: boolean;
    refreshing: boolean;
    error: string;
    hasContent: boolean;
  };
  diagnosticsView: {
    items: ModelRouteFlowData['diagnostics'];
    itemsLoading: boolean;
    payload: ModelRouteFlowData | null;
    payloadLoading: boolean;
    error: string;
    payloadError: string;
  };
  performance: {
    observability: ModelRuntimeObservability | null;
    loading: boolean;
    refreshing: boolean;
    initialLoading: boolean;
    error: string;
    hasData: boolean;
    attempts: ModelRuntimeObservability['executionAttempts'];
    endpoints: ModelRuntimeObservability['endpoints'];
    historyBuckets: RuntimeHistoryBucket[];
    recentBuckets: RuntimeHistoryBucket[];
    successRate: number | null;
    avgLatency: number | null;
    avgFirstTokenLatency: number | null;
    avgOutputTokensPerSecond: number | null;
  };
  pricing: {
    measured: ModelEntryPricing | null;
    theoretical: ModelEntryPricing | null;
  };
};

function formatTemplate(key: string, replacements: Record<string, string | number | null | undefined>): string {
  let value = tr(key);
  for (const [name, replacement] of Object.entries(replacements)) {
    value = value.replace(`{${name}}`, replacement == null ? '' : String(replacement));
  }
  return value;
}

function runtimeInventoryIssueMessage(issue: NonNullable<ModelRow['runtimeInventoryIssues']>[number]): string {
  const reasonKey = `pages.models.modelDiagnosticsTab.runtimeInventoryIssue.reason.${issue.reason}`;
  const reason = tr(reasonKey);
  return formatTemplate('pages.models.modelDiagnosticsTab.runtimeInventoryIssue', {
    reason,
    alternativeId: issue.alternativeId,
    endpointId: issue.endpointId || tr('pages.models.modelDiagnosticsTab.runtimeInventoryIssue.unknownEndpoint'),
  });
}

function normalizeFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function buildMeasuredEntryPricing(model: ModelRow): ModelEntryPricing | null {
  const measured = model.measuredEntryPricing;
  if (!measured) return null;
  const inputPerMillion = normalizeFiniteNumber(measured.inputPerMillion);
  const outputPerMillion = normalizeFiniteNumber(measured.outputPerMillion);
  if (inputPerMillion == null && outputPerMillion == null) return null;
  const totalCost = normalizeFiniteNumber(measured.totalCost);
  return {
    currency: measured.currency ?? null,
    inputPerMillion,
    outputPerMillion,
    totalCost,
    inputMultiplier: normalizeFiniteNumber(measured.inputMultiplier),
    outputMultiplier: normalizeFiniteNumber(measured.outputMultiplier),
    totalMultiplier: normalizeFiniteNumber(measured.totalMultiplier),
    sourceCount: 1,
    sampleCount: measured.sampleCount,
    lastMeasuredAt: measured.lastMeasuredAt,
  };
}

export function buildRouteFlowTheoreticalEntryPricing(routeFlow: ModelRouteFlowData | null): ModelEntryPricing | null {
  const pricing = routeFlow?.entryPricing?.theoretical;
  if (!pricing) return null;
  const inputPerMillion = normalizeFiniteNumber(pricing.inputPerMillion);
  const outputPerMillion = normalizeFiniteNumber(pricing.outputPerMillion);
  const totalCost = normalizeFiniteNumber(pricing.totalCost);
  return {
    currency: pricing.currency ?? null,
    inputPerMillion,
    outputPerMillion,
    cacheReadPerMillion: normalizeFiniteNumber(pricing.cacheReadPerMillion),
    cacheWritePerMillion: normalizeFiniteNumber(pricing.cacheWritePerMillion),
    reasoningPerMillion: normalizeFiniteNumber(pricing.reasoningPerMillion),
    requestCost: normalizeFiniteNumber(pricing.requestCost),
    totalCost,
    inputMultiplier: normalizeFiniteNumber(pricing.inputMultiplier),
    outputMultiplier: normalizeFiniteNumber(pricing.outputMultiplier),
    totalMultiplier: normalizeFiniteNumber(pricing.totalMultiplier),
    components: pricing.components,
    usage: pricing.usage,
    effectiveCost: pricing.effectiveCost ?? null,
    sourceCount: pricing.sourceCount,
    estimateLevel: pricing.estimateLevel,
    selectionMode: pricing.selectionMode,
    diagnostics: pricing.diagnostics,
    executionAttempts: pricing.executionAttempts,
  };
}

function normalizeObservabilityRate(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function resolveModelDisplayMetrics(input: {
  observability: ModelRuntimeObservability | null;
}): {
  successRate: number | null;
  avgLatency: number | null;
  avgFirstTokenLatency: number | null;
  avgOutputTokensPerSecond: number | null;
} {
  const health = input.observability?.health;
  const hasRuntimeSamples = (health?.totalCalls ?? 0) > 0;
  return {
    successRate: hasRuntimeSamples ? normalizeObservabilityRate(health?.successRate) : null,
    avgLatency: hasRuntimeSamples ? normalizeObservabilityRate(health?.avgLatencyMs) : null,
    avgFirstTokenLatency: hasRuntimeSamples ? normalizeObservabilityRate(health?.avgFirstTokenLatencyMs) : null,
    avgOutputTokensPerSecond: hasRuntimeSamples ? normalizeObservabilityRate(health?.avgOutputTokensPerSecond) : null,
  };
}

export function resolveVisiblePerformanceObservability(input: {
  modelName: string;
  current: ModelRuntimeObservability | null;
  currentLoaded: boolean;
  currentLoading: boolean;
  currentError: string;
  settledByModel: Record<string, ModelRuntimeObservability>;
}): ModelRuntimeObservability | null {
  if (input.current) return input.current;
  if (!input.modelName || input.currentError) return null;
  if (input.currentLoaded && !input.currentLoading) return null;
  return input.settledByModel[input.modelName] ?? null;
}

function buildRouteSummary(routeFlow: ModelRouteFlowData | null): string[] {
  const runtime = routeFlow?.compiledRuntime ?? null;
  if (!runtime) return [];
  const selectedAttempt = runtime.executionAttempts.find((attempt) => (
    attempt.executionAttemptId === runtime.selected.executionAttemptId
  )) || null;
  return [
    `${tr('components.modelRouteFlow.planId')}: ${runtime.match.planId}`,
    `${tr('components.modelRouteFlow.entry')}: ${runtime.match.entryNodeId}`,
    `${tr('components.modelRouteFlow.executionAttempts')}: ${runtime.executionAttempts.length}`,
    selectedAttempt
      ? `${tr('components.modelRouteFlow.selectedExecutionAttempt')}: ${selectedAttempt.accountLabel || selectedAttempt.accountId || 'N/A'} @ ${selectedAttempt.siteName || selectedAttempt.siteUrl || selectedAttempt.siteId || 'N/A'}`
      : null,
  ].filter((item): item is string => !!item);
}

export function buildModelDetailsView(input: {
  model: ModelRow;
  brandName: string | null;
  routeFlow: ModelRouteFlowData | null;
  routeFlowDiagnostics?: ModelRouteFlowDiagnostics | null;
  routeFlowDiagnosticsError?: string;
  routeFlowLoading: boolean;
  routeFlowError: string;
  observability: ModelRuntimeObservability | null;
  observabilityLoading: boolean;
  observabilityError: string;
  performanceObservability?: ModelRuntimeObservability | null;
  performanceObservabilityLoading?: boolean;
  performanceObservabilityError?: string;
}): ModelDetailsView {
  const hasOtherMetadata = input.model.tags.length > 0
    || input.model.supportedEndpointTypes.length > 0;
  const displayMetrics = resolveModelDisplayMetrics({
    observability: input.observability,
  });
  const supportedEndpointTypes = input.observability?.capabilitySummary.supportedEndpointTypes.length
    ? input.observability.capabilitySummary.supportedEndpointTypes
    : input.model.supportedEndpointTypes;
  const routeSummary = buildRouteSummary(input.routeFlow);
  const routeDiagnostics = input.routeFlow?.diagnostics ?? input.routeFlowDiagnostics?.diagnostics ?? [];
  const diagnosticsError = input.routeFlowError || input.routeFlowDiagnosticsError || '';
  const runtimeInventoryDiagnostics = (input.model.runtimeInventoryIssues || []).map((issue) => ({
    level: issue.level,
    message: runtimeInventoryIssueMessage(issue),
  }));
  const diagnostics = [...runtimeInventoryDiagnostics, ...routeDiagnostics];
  const performanceObservability = input.performanceObservability ?? input.observability;
  const performanceLoading = input.performanceObservabilityLoading ?? input.observabilityLoading;
  const performanceError = input.performanceObservabilityError ?? input.observabilityError;
  const hasPerformanceData = !!performanceObservability;
  const historyBuckets = performanceObservability?.history.buckets ?? [];

  return {
    model: input.model,
    brandName: input.brandName,
    status: input.observability?.health?.status ?? 'unknown',
    routeFlow: input.routeFlow,
    routeFlowDiagnostics: input.routeFlowDiagnostics ?? null,
    routeFlowLoading: input.routeFlowLoading,
    routeFlowError: input.routeFlowError,
    observability: input.observability,
    observabilityLoading: input.observabilityLoading,
    observabilityError: input.observabilityError,
    performanceObservability,
    performanceObservabilityLoading: performanceLoading,
    performanceObservabilityError: performanceError,
    diagnostics,
    diagnosticsPayload: input.routeFlow,
    freshnessLabel: tr('pages.models.modelDetailsView.partialView'),
    descriptionText: input.model.description?.trim()
      || (hasOtherMetadata
        ? tr('pages.models.modelDetailsView.notProvidedTextSynctagsCapabilitiesInfo')
        : tr('pages.models.modelDetailsView.modelId')),
    overview: {
      displayMetrics,
      supportedEndpointTypes,
      routeSummary,
      routeSummaryLoading: input.routeFlowLoading && routeSummary.length === 0,
      routeSummaryRefreshing: input.routeFlowLoading && routeSummary.length > 0,
      routeSummaryError: input.routeFlowError,
    },
    routing: {
      flow: input.routeFlow,
      loading: input.routeFlowLoading,
      refreshing: input.routeFlowLoading && !!input.routeFlow,
      error: input.routeFlowError,
      hasContent: !!input.routeFlow,
    },
    diagnosticsView: {
      items: diagnostics,
      itemsLoading: input.routeFlowLoading && !input.routeFlow && !input.routeFlowDiagnostics,
      payload: input.routeFlow,
      payloadLoading: input.routeFlowLoading && !input.routeFlow,
      error: diagnosticsError,
      payloadError: input.routeFlowError,
    },
    performance: {
      observability: performanceObservability,
      loading: performanceLoading,
      refreshing: performanceLoading && hasPerformanceData,
      initialLoading: performanceLoading && !hasPerformanceData,
      error: performanceError,
      hasData: hasPerformanceData,
      attempts: performanceObservability?.executionAttempts ?? [],
      endpoints: performanceObservability?.endpoints ?? [],
      historyBuckets,
      recentBuckets: historyBuckets.slice(-8).reverse(),
      successRate: performanceObservability?.health.successRate ?? null,
      avgLatency: performanceObservability?.health.avgLatencyMs ?? null,
      avgFirstTokenLatency: performanceObservability?.health.avgFirstTokenLatencyMs ?? null,
      avgOutputTokensPerSecond: performanceObservability?.health.avgOutputTokensPerSecond ?? null,
    },
    pricing: {
      measured: buildMeasuredEntryPricing(input.model),
      theoretical: buildRouteFlowTheoreticalEntryPricing(input.routeFlow),
    },
  };
}

export function getModelManagedTokenCount(model: ModelRow): number {
  return model.managedTokenCount;
}

export function getAccountCredentialCount(account: ModelAccountInfo): number {
  return account.credentialCount;
}

export function getModelCredentialCount(model: ModelRow): number {
  return model.credentialCount;
}

export function formatLatencyValue(latency: number | null): string {
  return typeof latency === 'number' && Number.isFinite(latency) ? `${latency}ms` : tr('common.notAvailable');
}

export function formatTokenSpeedValue(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(value >= 10 ? 1 : 2)} tok/s` : tr('common.notAvailable');
}

export function formatSuccessRate(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}%` : tr('common.notAvailable');
}
