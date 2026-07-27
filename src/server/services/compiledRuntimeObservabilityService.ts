import {
  getCompiledRuntimeRouteFlow,
  type CompiledRouteFlow,
} from './routeFlowService.js';
import type { EntryPricingUsage } from './routeEntryPricingService.js';
import type { CompiledRouteRuntimeRequest } from './compiledRuntimeRequestTypes.js';
import { runUsageAggregationProjectionPass } from './usageAggregationService.js';
import {
  aggregateByIdentity,
  aggregateRealtimeEndpointHealth,
  aggregateRealtimeExecutionAttemptHealth,
  aggregateTerminalEntryHealth,
} from './compiledRuntimeObservabilityRepository.js';
import { aggregateTerminalEntryHistory } from './compiledRuntimeObservabilityHistoryRepository.js';
import {
  buildCapabilitySummary,
  buildRealtimeWindow,
  buildWindow,
  emptyHealth,
  hasAvailableExecutionAttempt,
  historyGranularity,
  normalizeRange,
  rangeToRealtimeMinutes,
  withStatus,
} from './compiledRuntimeObservabilityProjection.js';
import type {
  CompiledRuntimeObservability,
  CompiledRuntimeObservabilityInput,
  CompiledRuntimeObservabilityRange,
  RuntimeAlternativeObservability,
  RuntimeApiFallbackAttemptObservability,
  RuntimeEndpointObservability,
  RuntimeEntrySummary,
  RuntimeExecutionAttemptObservability,
  RuntimeHistory,
  RuntimeIdentitySummary,
  RuntimeObservabilityDiagnostic,
} from './compiledRuntimeObservabilityTypes.js';

export type {
  CompiledRuntimeObservability,
  CompiledRuntimeObservabilityInput,
  CompiledRuntimeObservabilityRange,
  RuntimeAlternativeObservability,
  RuntimeApiFallbackAttemptObservability,
  RuntimeCapabilitySummary,
  RuntimeEndpointObservability,
  RuntimeEntrySummary,
  RuntimeExecutionAttemptObservability,
  RuntimeHealth,
  RuntimeHealthSource,
  RuntimeHealthStatus,
  RuntimeHistory,
  RuntimeHistoryBucket,
  RuntimeIdentitySummary,
  RuntimeObservationWindow,
  RuntimeObservabilityDiagnostic,
} from './compiledRuntimeObservabilityTypes.js';

function routeEntrypointId(flow: CompiledRouteFlow): string | null {
  const entryNodeId = flow.compiledRuntime?.match.entryNodeId;
  return typeof entryNodeId === 'string' && entryNodeId.trim() ? entryNodeId.trim() : null;
}

function buildRuntimeIdentity(flow: CompiledRouteFlow): RuntimeIdentitySummary | null {
  const runtime = flow.compiledRuntime;
  if (!runtime) return null;
  const artifactHash = runtime.runtimeRef.bundleHash ?? null;
  return {
    runtimeId: artifactHash ? `runtime:${artifactHash}` : runtime.match.planId || null,
    artifactHash,
    projectedAt: flow.projectedAt,
    source: runtime.runtimeRef.artifactId ? 'active_runtime' : 'unknown',
  };
}

function buildEntry(flow: CompiledRouteFlow): RuntimeEntrySummary | null {
  if (!flow.matched) return null;
  const entryId = routeEntrypointId(flow);
  if (!entryId) return null;
  return {
    entryId,
    displayName: flow.requestedModel,
    requestedModel: flow.requestedModel,
    actualModel: flow.compiledRuntime?.selected.actualModel ?? null,
    matchedBy: 'unknown',
  };
}

export async function getCompiledRuntimeObservability(
  input: CompiledRuntimeObservabilityInput,
): Promise<CompiledRuntimeObservability> {
  const requestedModel = input.requestedModel.trim();
  const range = normalizeRange(input.range);
  const window = buildWindow(range);
  const realtimeMinutes = input.healthWindowMinutes ?? rangeToRealtimeMinutes(range);
  const realtimeWindow = realtimeMinutes == null ? window : buildRealtimeWindow(realtimeMinutes);
  const historyWindow = realtimeMinutes == null ? window : buildRealtimeWindow(realtimeMinutes);
  const projectionResult = input.freshness === 'sync_projection'
    ? await runUsageAggregationProjectionPass({ maxBatches: 1 })
    : { processedLogs: 0 };
  const flow = await getCompiledRuntimeRouteFlow(requestedModel, {
    request: input.request ?? null,
    pricingUsage: input.pricingUsage ?? null,
    includeEntryPricing: false,
    includeCompatibilityPolicy: false,
  });
  const diagnostics: RuntimeObservabilityDiagnostic[] = [];
  const runtime = flow.compiledRuntime;
  if (!flow.matched || !runtime) {
    diagnostics.push({
      level: 'warn',
      code: 'runtime_unmatched',
      messageKey: 'runtimeObservability.diagnostics.runtimeUnmatched',
      params: { requestedModel },
    });
  }

  const attemptHealthPairs = await Promise.all((runtime?.executionAttempts ?? []).map(async (attempt) => [
    attempt.executionAttemptId,
    await aggregateByIdentity({
      scope: 'executionAttempt',
      identity: attempt.executionAttemptId,
      window,
    }),
  ] as const));
  const historicalAttemptHealthById = new Map(attemptHealthPairs);
  const realtimeAttemptHealthPairs = await Promise.all((runtime?.executionAttempts ?? []).map(async (attempt) => [
    attempt.executionAttemptId,
    await aggregateRealtimeExecutionAttemptHealth({
      executionAttemptId: attempt.executionAttemptId,
      window: realtimeWindow,
    }),
  ] as const));
  const attemptHealthById = new Map(realtimeAttemptHealthPairs);

  const endpointHealthPairs = await Promise.all((runtime?.endpoints ?? []).map(async (endpoint) => [
    endpoint.endpointId,
    realtimeMinutes == null
      ? await aggregateByIdentity({
          scope: 'endpoint',
          identity: endpoint.endpointId,
          window,
        })
      : await aggregateRealtimeEndpointHealth({
          runtimeEndpointId: endpoint.endpointId,
          window: realtimeWindow,
        }),
  ] as const));
  const endpointHealthById = new Map(endpointHealthPairs);

  let entryHealth = await aggregateTerminalEntryHealth({
    routeEntrypointId: routeEntrypointId(flow),
    window: realtimeWindow,
  });
  if (flow.matched && entryHealth.totalCalls <= 0) {
    diagnostics.push({
      level: 'info',
      code: 'entry_usage_missing',
      messageKey: 'runtimeObservability.diagnostics.entryUsageMissing',
      params: { requestedModel },
    });
  }
  if (flow.matched && !runtime?.syntheticResponse && !hasAvailableExecutionAttempt(flow)) {
    entryHealth = withStatus(entryHealth, 'unavailable');
  }

  const capabilitySummary = buildCapabilitySummary(flow);
  const apiFallbackAttempts: RuntimeApiFallbackAttemptObservability[] = [];
  for (const attempt of runtime?.executionAttempts ?? []) {
    for (const apiAttempt of attempt.apiAttempts ?? []) {
      apiFallbackAttempts.push({
        apiAttemptId: apiAttempt.apiAttemptId,
        executionAttemptId: attempt.executionAttemptId,
        order: apiAttempt.order,
        endpointType: apiAttempt.apiType,
        selected: apiAttempt.order === 0,
        supported: true,
        health: attemptHealthById.get(attempt.executionAttemptId) ?? emptyHealth(realtimeWindow),
        pricing: null,
        diagnostics: [],
      });
    }
  }

  const alternatives = (runtime?.alternatives ?? []).map((alternative): RuntimeAlternativeObservability => {
    return {
      alternativeId: alternative.alternativeId,
      label: alternative.model ?? alternative.endpointId,
      selected: runtime?.selected.alternativeId === alternative.alternativeId,
      enabled: alternative.enabled,
      probability: {
        value: alternative.probability,
        status: alternative.probabilityStatus,
      },
      health: emptyHealth(realtimeWindow),
      pricing: null,
      endpointIds: alternative.endpointId ? [alternative.endpointId] : [],
      executionAttemptIds: alternative.executionAttemptIds,
    };
  });

  const endpoints = (runtime?.endpoints ?? []).map((endpoint): RuntimeEndpointObservability => {
    const endpointAttempts = runtime?.executionAttempts.filter((attempt) => attempt.endpointId === endpoint.endpointId) ?? [];
    const firstAttempt = endpointAttempts[0] || null;
    return {
      endpointId: endpoint.endpointId,
      label: endpoint.endpointId,
      actualModel: null,
      models: Array.from(new Set(endpointAttempts
        .map((attempt) => attempt.model)
        .filter((model): model is string => !!model))),
      endpointType: null,
      site: firstAttempt?.siteId ? { id: firstAttempt.siteId, name: firstAttempt.siteName ?? null } : null,
      account: firstAttempt?.accountId ? { id: firstAttempt.accountId, label: firstAttempt.accountLabel ?? null } : null,
      health: endpointHealthById.get(endpoint.endpointId) ?? emptyHealth(window),
      pricing: null,
      capabilitySummary,
    };
  });

  const executionAttempts = (runtime?.executionAttempts ?? []).map((attempt): RuntimeExecutionAttemptObservability => ({
    executionAttemptId: attempt.executionAttemptId,
    alternativeId: attempt.alternativeId,
    endpointId: attempt.endpointId,
    selected: runtime?.selected.executionAttemptId === attempt.executionAttemptId,
    enabled: attempt.enabled,
    actualModel: attempt.model,
    target: {
      executionTargetId: attempt.executionTargetId,
      siteId: attempt.siteId,
      siteName: attempt.siteName ?? null,
      accountId: attempt.accountId,
      accountLabel: attempt.accountLabel ?? null,
      tokenId: attempt.tokenId,
      tokenLabel: attempt.tokenLabel ?? null,
    },
    health: attemptHealthById.get(attempt.executionAttemptId) ?? emptyHealth(realtimeWindow),
    pricing: null,
    routingSignals: attempt.routingSignals ?? null,
    apiFallbackAttemptIds: (attempt.apiAttempts ?? []).map((apiAttempt) => apiAttempt.apiAttemptId),
  }));

  const historyBuckets = await aggregateTerminalEntryHistory({
    routeEntrypointId: routeEntrypointId(flow),
    executionAttemptIds: executionAttempts.map((attempt) => attempt.executionAttemptId),
    endpointIds: endpoints.map((endpoint) => endpoint.endpointId),
    window: historyWindow,
  });
  const history: RuntimeHistory = {
    range,
    buckets: historyBuckets,
    granularity: historyGranularity(range),
    emptyReason: !flow.matched ? 'unmatched' : historyBuckets.length > 0 ? null : 'no_logs',
  };
  if (flow.matched && historyBuckets.length === 0) {
    diagnostics.push({
      level: 'info',
      code: 'history_empty',
      messageKey: 'runtimeObservability.diagnostics.historyEmpty',
      params: { requestedModel },
    });
  }

  return {
    requestedModel,
    matched: flow.matched,
    runtime: buildRuntimeIdentity(flow),
    entry: buildEntry(flow),
    health: entryHealth,
    capabilitySummary,
    pricingSummary: flow.entryPricing ?? null,
    freshness: {
      projected: input.freshness === 'sync_projection',
      projectionProcessedLogs: projectionResult.processedLogs ?? 0,
    },
    diagnostics,
    request: {
      requestedModel,
      hasRequestSnapshot: !!input.request,
    },
    match: runtime?.match ?? null,
    alternatives,
    endpoints,
    executionAttempts,
    apiFallbackAttempts,
    history,
    pricing: flow.entryPricing ?? null,
    routeFlow: flow,
  };
}
