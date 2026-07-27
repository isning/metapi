import type {
  CompiledEndpointTarget,
  CompiledExecutionAlternative,
  CompiledExecutionSelectionTerm,
  CompiledFallbackStage,
  CompiledRouterBundle,
  CompiledRouterPlan,
  RouteProgramSourceRef,
} from '../../shared/compiledRuntime.js';
import { getCompiledRouterPlanById } from '../../shared/compiledRuntime.js';
import type { RouteRuntimeSelection } from './routeRuntimeEvaluatorService.js';
import type { CompiledRouteRuntimeRequest } from './compiledRuntimeRequestTypes.js';
import type { RuntimeSelectorState } from './selectorEngine.js';
import { resolveDispatchSelectorPolicy } from './dispatchPolicyService.js';
import { estimateCompiledRuntimeAlternativeProbabilities } from './compiledRuntimeProbabilityService.js';
import { compiledRuntimeSelectorStateForRequest } from './compiledRuntimeSelectorScopes.js';

export type RuntimeProbabilityStatus = 'static' | 'dynamic' | 'unsupported';

export type RuntimePolicySummary = {
  source: 'default' | 'registry' | 'inline' | 'builtin';
  id: string | null;
  kind: 'cel' | 'builtin' | null;
  selectionMode: 'weighted' | 'ordered' | 'round_robin' | 'direct' | null;
};

export type RuntimeHealthSummary = {
  successRate: number | null;
  totalCalls: number;
  avgLatencyMs: number | null;
  cooldownUntil: string | null;
  consecutiveFailureCount: number | null;
};

export type RuntimeRoutingSignals = {
  referencePricing: {
    scenario: 'routing_reference';
    source: 'wallet_acquisition' | 'free_quota' | 'unavailable';
    rawCost: number | null;
    effectiveCost: number | null;
    baseCostUnit: string | null;
    balanceBurn: Array<{ unit: string; amount: number }>;
  };
  cost: {
    status: 'available' | 'insufficient_data' | 'pricing_unavailable';
    currency: string | null;
    forecast: {
      sampleCount: number;
      confidence: number;
      estimatedInputTokens: number | null;
      expectedOutputTokens: number | null;
      p90OutputTokens: number | null;
      maxOutputTokens: number | null;
    };
    floor: { rawCost: number | null; effectiveCost: number | null } | null;
    expected: { rawCost: number | null; effectiveCost: number | null } | null;
    p90: { rawCost: number | null; effectiveCost: number | null } | null;
    ceiling: { rawCost: number | null; effectiveCost: number | null } | null;
    routingCost: number | null;
  };
  balance: number | null;
  rawBalance: number | null;
  normalizedBalance: number | null;
  recentUsage: number | null;
  successCount: number | null;
  failCount: number | null;
  totalLatencyMs: number | null;
  sameSiteExecutionAttemptCount: number;
  siteGlobalWeight: number;
  downstreamSiteMultiplier: number;
  combinedSiteWeight: number;
  runtimeHealth: {
    status: 'available' | 'insufficient_data' | 'unavailable';
    globalMultiplier: number | null;
    modelMultiplier: number | null;
    combinedMultiplier: number | null;
    globalBreakerOpen: boolean;
    modelBreakerOpen: boolean;
    recentSuccessRate: number | null;
    recentSampleCount: number | null;
    recentConfidence: number | null;
  };
  historicalHealth: {
    status: 'available' | 'insufficient_data' | 'unavailable';
    multiplier: number | null;
    successRate: number | null;
    avgLatencyMs: number | null;
    totalCalls: number | null;
  };
  runtimeLoad: {
    activeLeaseCount: number;
    waitingCount: number;
    concurrencyLimit: number;
    saturated: boolean;
    multiplier: number;
  };
  inverseRoutingCost: number | null;
  inverseRecentUsage: number | null;
  normalizedCostScore: number | null;
  normalizedBalanceScore: number | null;
  normalizedUsageScore: number | null;
  stableFirst: {
    effectiveSuccessRate: number | null;
    siteOrder: number | null;
    siteLeader: boolean | null;
  };
};

export type RuntimeSelectionTermProjection = {
  termId: string;
  optionId: string;
  mode: string;
  policy: RuntimePolicySummary;
  enabled: boolean;
  weight: number;
  order: number;
};

export type RuntimeFallbackStageProjection = {
  fallbackId: string;
  stageId: string;
  stageIndex: number;
  nodeId: string;
  selected: boolean;
};

export type RuntimeAlternativeProjection = {
  alternativeId: string;
  kind: 'execution_attempt' | 'endpoint_delegation' | 'synthetic_response';
  enabled: boolean;
  endpointId: string | null;
  nodeId: string | null;
  model: string | null;
  executionAttemptIds: string[];
  selectionTerms: RuntimeSelectionTermProjection[];
  fallbackStages: RuntimeFallbackStageProjection[];
  probability: number | null;
  probabilityStatus: RuntimeProbabilityStatus;
  syntheticResponse?: {
    statusCode: 429 | 503;
    message: string;
  } | null;
};

export type RuntimeEndpointProjection = {
  endpointId: string;
  nodeId: string | null;
  alternativeIds: string[];
  executionAttemptIds: string[];
};

export type RuntimeExecutionAttemptProjection = {
  executionAttemptId: string;
  alternativeId: string;
  endpointId: string;
  nodeId: string | null;
  executionTargetId: number | null;
  model: string | null;
  modelSource: 'fixed' | 'request';
  enabled: boolean;
  siteId: number | null;
  siteName?: string | null;
  siteUrl?: string | null;
  sitePlatform?: string | null;
  accountId: number | null;
  accountLabel?: string | null;
  tokenId: number | null;
  tokenLabel?: string | null;
  tokenGroup?: string | null;
  weight: number | null;
  probability: number | null;
  probabilityStatus: RuntimeProbabilityStatus;
  health: RuntimeHealthSummary;
  routingSignals?: RuntimeRoutingSignals;
  apiAttempts?: RuntimeApiAttemptProjection[];
  apiAttemptDiagnostics?: RuntimeApiAttemptDiagnosticProjection[];
};

export type RuntimeApiAttemptProjection = {
  apiAttemptId: string;
  order: number;
  apiType: string;
  upstreamEndpoint: string;
  requestMethod: 'POST' | 'GET';
  requestUrl: string;
  adapterId: string;
  credentialEndpointBindingId: string;
  apiEndpointProfileId: string;
  downgradeAllowed: boolean;
  reason: string[];
};

export type RuntimeApiAttemptDiagnosticProjection = {
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  i18nKey?: string;
  values?: Record<string, string | number | boolean | null>;
  apiType?: string;
  upstreamEndpoint?: string;
  credentialEndpointBindingId?: string;
  apiEndpointProfileId?: string;
};

export type CompiledRuntimeProjection = {
  runtimeRef: {
    artifactId: string | null;
    bundleHash: string | null;
  };
  match: {
    requestedModel: string;
    planId: string;
    entryNodeId: string;
    publicModelName: string | null;
  };
  alternatives: RuntimeAlternativeProjection[];
  endpoints: RuntimeEndpointProjection[];
  executionAttempts: RuntimeExecutionAttemptProjection[];
  selected: {
    alternativeId: string | null;
    endpointId: string | null;
    executionAttemptId: string | null;
    accountId: number | null;
    tokenId: number | null;
    siteId: number | null;
    actualModel: string | null;
    selectionSource: 'compiled_runtime' | 'forced_execution_attempt' | 'retry_scope' | 'synthetic';
  };
  filters: {
    preSelectionApplied: Array<{ nodeId: string; appliedFilters: string[] }>;
    postBuild: RouteRuntimeSelection['postBuildFilters'];
  };
  syntheticResponse?: {
    statusCode: 429 | 503;
    message: string;
  } | null;
};


function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function numberOrFallback(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function defaultHealth(): RuntimeHealthSummary {
  return {
    successRate: null,
    totalCalls: 0,
    avgLatencyMs: null,
    cooldownUntil: null,
    consecutiveFailureCount: null,
  };
}

function runtimePolicySummary(policy: unknown): RuntimePolicySummary {
  const resolved = resolveDispatchSelectorPolicy(policy);
  return {
    source: resolved.source,
    id: resolved.resolvedPolicy?.id ?? null,
    kind: resolved.resolvedPolicy?.kind ?? null,
    selectionMode: resolved.resolvedPolicy?.selectionMode ?? null,
  };
}

function executionTargetIdForTarget(target: { transportBinding?: { executionTargetId?: unknown } } | null | undefined): number | null {
  return asPositiveInteger(target?.transportBinding?.executionTargetId);
}

function executionAttemptIdForTarget(target: CompiledEndpointTarget): string | null {
  return asTrimmedString(target.executionAttemptId) || null;
}

function executionAttemptIdForSelectedRuntimeAttemptTarget(
  target: RouteRuntimeSelection['selectedExecutionAttempt'],
): string | null {
  if (!target) return null;
  return asTrimmedString(target.executionAttemptId) || null;
}

function termProjection(term: CompiledExecutionSelectionTerm): RuntimeSelectionTermProjection {
  return {
    termId: term.termId,
    optionId: term.optionId,
    mode: term.mode || 'route',
    policy: runtimePolicySummary(term.policy),
    enabled: term.enabled !== false,
    weight: numberOrFallback(term.weight, 1),
    order: numberOrFallback(term.order, 0),
  };
}

function runtimeRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function runtimeRoutingSignals(value: unknown): RuntimeRoutingSignals | undefined {
  return isRecord(value) ? value as RuntimeRoutingSignals : undefined;
}

function estimateAlternativeProbabilities(
  plan: CompiledRouterPlan,
  bundle: CompiledRouterBundle,
  state?: RuntimeSelectorState,
): Map<string, { probability: number | null; status: RuntimeProbabilityStatus }> {
  return estimateCompiledRuntimeAlternativeProbabilities({ plan, bundle, state }).probabilities;
}

function selectedAlternativeIdFromSelection(
  plan: CompiledRouterPlan,
  selection: RouteRuntimeSelection,
): string | null {
  const explicit = asTrimmedString(selection.selectedAlternativeId);
  if (explicit) return explicit;
  const selectedAttemptId = executionAttemptIdForSelectedRuntimeAttemptTarget(selection.selectedExecutionAttempt);
  if (selectedAttemptId) {
    return (plan.executionAlternatives || []).find((alternative) => (
      alternative.executionAttempt && executionAttemptIdForTarget(alternative.executionAttempt) === selectedAttemptId
    ))?.alternativeId || null;
  }
  if (selection.terminalKind === 'synthetic_response') {
    return (plan.executionAlternatives || []).find((alternative) => (
      alternative.kind === 'synthetic_response' && alternative.syntheticResponse?.nodeId === selection.terminalNodeId
    ))?.alternativeId || null;
  }
  return null;
}

function alternativeModel(
  alternative: CompiledExecutionAlternative,
  requestedModel: string,
): string | null {
  const target = alternative.executionAttempt;
  if (target) {
    return target.modelSource === 'request'
      ? requestedModel
      : (asTrimmedString(target.model) || null);
  }
  return alternative.endpoint?.model || null;
}

function alternativeEndpointId(alternative: CompiledExecutionAlternative): string | null {
  return alternative.endpoint?.endpointId || null;
}

function alternativeNodeId(alternative: CompiledExecutionAlternative): string | null {
  return alternative.endpoint?.nodeId || null;
}

function alternativeProbability(
  probabilityByAlternativeId: Map<string, { probability: number | null; status: RuntimeProbabilityStatus }>,
  alternativeId: string,
): { probability: number | null; status: RuntimeProbabilityStatus } {
  return probabilityByAlternativeId.get(alternativeId) || { probability: null, status: 'dynamic' };
}

function fallbackStageProjection(
  stage: CompiledFallbackStage,
  selection: RouteRuntimeSelection,
): RuntimeFallbackStageProjection {
  const selected = (selection.fallbackStageSnapshots || []).some((snapshot) => (
    snapshot.fallbackId === stage.fallbackId
    && snapshot.stageId === stage.stageId
  ));
  return {
    fallbackId: stage.fallbackId,
    stageId: stage.stageId,
    stageIndex: stage.stageIndex,
    nodeId: stage.nodeId,
    selected,
  };
}

export function buildCompiledRuntimeProjection(input: {
  bundle: CompiledRouterBundle;
  selection: RouteRuntimeSelection;
  requestedModel: string;
  request?: CompiledRouteRuntimeRequest | null;
  forcedExecutionAttemptId?: string | null;
}): CompiledRuntimeProjection | null {
  const planId = asTrimmedString(input.selection.compiledPlanSnapshot?.planId);
  const indexedPlan = getCompiledRouterPlanById(input.bundle, planId);
  const plan = indexedPlan?.enabled === false ? null : indexedPlan;
  if (!plan) return null;
  const matchedEntryNodeId = asTrimmedString(input.selection.matchedEntryNodeId);
  if (!matchedEntryNodeId) return null;

  const probabilityByAlternativeId = estimateAlternativeProbabilities(
    plan,
    input.bundle,
    compiledRuntimeSelectorStateForRequest(input.request),
  );
  const alternatives: RuntimeAlternativeProjection[] = [];
  const endpointsById = new Map<string, RuntimeEndpointProjection>();
  const executionAttempts: RuntimeExecutionAttemptProjection[] = [];

  for (const alternative of plan.executionAlternatives || []) {
    const probability = alternativeProbability(probabilityByAlternativeId, alternative.alternativeId);
    const endpointId = alternativeEndpointId(alternative);
    const nodeId = alternativeNodeId(alternative);
    const executionAttemptId = alternative.executionAttempt ? executionAttemptIdForTarget(alternative.executionAttempt) : null;
    alternatives.push({
      alternativeId: alternative.alternativeId,
      kind: alternative.kind,
      enabled: alternative.enabled !== false,
      endpointId,
      nodeId,
      model: alternativeModel(alternative, input.requestedModel),
      executionAttemptIds: executionAttemptId ? [executionAttemptId] : [],
      selectionTerms: (alternative.selectionTerms || []).map(termProjection),
      fallbackStages: (alternative.fallbackStages || []).map((stage) => fallbackStageProjection(stage, input.selection)),
      probability: probability.probability,
      probabilityStatus: probability.status,
      syntheticResponse: alternative.syntheticResponse
        ? {
            statusCode: alternative.syntheticResponse.statusCode === 429 ? 429 : 503,
            message: alternative.syntheticResponse.message || 'No route is available.',
          }
        : null,
    });

    if (endpointId) {
      const existingEndpoint = endpointsById.get(endpointId) || {
        endpointId,
        nodeId,
        alternativeIds: [],
        executionAttemptIds: [],
      };
      if (!existingEndpoint.alternativeIds.includes(alternative.alternativeId)) {
        existingEndpoint.alternativeIds.push(alternative.alternativeId);
      }
      if (executionAttemptId && !existingEndpoint.executionAttemptIds.includes(executionAttemptId)) {
        existingEndpoint.executionAttemptIds.push(executionAttemptId);
      }
      endpointsById.set(endpointId, existingEndpoint);
    }

    const target = alternative.executionAttempt;
    if (!target || !executionAttemptId || !endpointId) continue;
    const lastTerm = [...(alternative.selectionTerms || [])].reverse().find((term) => term.mode === 'execution_attempt') || null;
    executionAttempts.push({
      executionAttemptId,
      alternativeId: alternative.alternativeId,
      endpointId,
      nodeId,
      executionTargetId: executionTargetIdForTarget(target),
      model: target.modelSource === 'request'
        ? input.requestedModel
        : (asTrimmedString(target.model) || null),
      modelSource: target.modelSource === 'request' ? 'request' : 'fixed',
      enabled: target.enabled !== false && alternative.enabled !== false,
      siteId: asPositiveInteger(target.siteId),
      accountId: asPositiveInteger(target.accountId),
      tokenId: asPositiveInteger(target.tokenId),
      tokenGroup: asTrimmedString(target.metadata?.tokenGroup) || null,
      weight: asFiniteNumber(lastTerm?.weight ?? target.weight),
      probability: probability.probability,
      probabilityStatus: probability.status,
      health: {
        ...defaultHealth(),
        cooldownUntil: asTrimmedString(target.metadata?.cooldownUntil) || null,
        consecutiveFailureCount: asFiniteNumber(target.metadata?.consecutiveFailCount),
      },
      routingSignals: runtimeRoutingSignals(target.runtime?.routingSignals ?? alternative.runtime?.routingSignals),
    });
  }

  const selectedRuntimeAttemptTarget = input.selection.selectedExecutionAttempt;
  const defaultSelectedExecutionAttemptId = executionAttemptIdForSelectedRuntimeAttemptTarget(selectedRuntimeAttemptTarget);
  const forcedExecutionAttemptId = asTrimmedString(input.forcedExecutionAttemptId);
  const selectedExecutionAttemptProjection = forcedExecutionAttemptId
    && executionAttempts.some((attempt) => attempt.executionAttemptId === forcedExecutionAttemptId)
    ? executionAttempts.find((attempt) => attempt.executionAttemptId === forcedExecutionAttemptId) || null
    : executionAttempts.find((attempt) => attempt.executionAttemptId === defaultSelectedExecutionAttemptId) || null;
  const selectedAlternativeId = selectedExecutionAttemptProjection?.alternativeId
    || (input.selection.terminalKind === 'synthetic_response'
      ? selectedAlternativeIdFromSelection(plan, input.selection)
      : null);

  return {
    runtimeRef: {
      artifactId: input.selection.runtimeArtifactId ?? null,
      bundleHash: input.bundle.hash || null,
    },
    match: {
      requestedModel: input.requestedModel,
      planId: plan.id,
      entryNodeId: matchedEntryNodeId,
      publicModelName: plan.publicModelName || null,
    },
    alternatives,
    endpoints: Array.from(endpointsById.values()),
    executionAttempts,
    selected: {
      alternativeId: selectedAlternativeId,
      endpointId: selectedExecutionAttemptProjection?.endpointId ?? null,
      executionAttemptId: selectedExecutionAttemptProjection?.executionAttemptId ?? null,
      accountId: selectedExecutionAttemptProjection?.accountId ?? null,
      tokenId: selectedExecutionAttemptProjection?.tokenId ?? null,
      siteId: selectedExecutionAttemptProjection?.siteId ?? null,
      actualModel: selectedExecutionAttemptProjection?.model ?? null,
      selectionSource: forcedExecutionAttemptId && selectedExecutionAttemptProjection ? 'forced_execution_attempt' : (
        input.selection.terminalKind === 'synthetic_response' ? 'synthetic' : 'compiled_runtime'
      ),
    },
    filters: {
      preSelectionApplied: (input.selection.trace.path || [])
        .flatMap((step) => (
          step.appliedFilters.length > 0 && step.nodeId != null
            ? [{ nodeId: step.nodeId, appliedFilters: [...step.appliedFilters] }]
            : []
        )),
      postBuild: input.selection.postBuildFilters,
    },
    syntheticResponse: input.selection.syntheticResponse || null,
  };
}
