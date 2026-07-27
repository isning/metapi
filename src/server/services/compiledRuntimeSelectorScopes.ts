import type {
  CompiledEndpointTarget,
  CompiledExecutionAlternative,
  CompiledExecutionSelectionTerm,
  CompiledRouterBundle,
  CompiledRouterPlan,
} from '../../shared/compiledRuntime.js';
import type {
  RuntimeSelectorCandidate,
  RuntimeSelectorCelScope,
  RuntimeSelectorState,
} from './selectorEngine.js';
import type { CompiledRouteRuntimeRequest } from './compiledRuntimeRequestTypes.js';

export type CompiledRuntimeSelectionOption = {
  optionId: string;
  term: CompiledExecutionSelectionTerm;
  alternatives: CompiledExecutionAlternative[];
};

export type CompiledRuntimeAlternativeProbability = {
  probability: number | null;
  status: 'static' | 'dynamic' | 'unsupported';
};

export function groupCompiledRuntimeSelectionOptions(
  alternatives: CompiledExecutionAlternative[],
  termId: string,
): CompiledRuntimeSelectionOption[] | null {
  const byOption = new Map<string, CompiledRuntimeSelectionOption>();
  for (const alternative of alternatives) {
    const term = (alternative.selectionTerms || []).find((item) => item.termId === termId);
    if (!term) return null;
    const optionId = asTrimmedString(term.optionId);
    if (!optionId) return null;
    const existing = byOption.get(optionId);
    if (existing) existing.alternatives.push(alternative);
    else byOption.set(optionId, { optionId, term, alternatives: [alternative] });
  }
  return Array.from(byOption.values()).sort((left, right) => {
    const orderDiff = numberOrFallback(left.term.order, 0) - numberOrFallback(right.term.order, 0);
    return orderDiff || numberOrFallback(left.term.optionIndex, 0) - numberOrFallback(right.term.optionIndex, 0);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberOrFallback(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function compiledRuntimeRecordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function compiledRuntimeSelectorState(input: {
  requestedModel: string;
  currentModel: string;
  upstreamModel?: string;
  endpointPreference?: 'chat' | 'messages' | 'responses';
  payload?: unknown;
  normalizedPayload?: unknown;
  headers?: Record<string, unknown>;
  request?: Record<string, unknown>;
  stateStore?: Record<string, unknown>;
  selectorStateStore?: Record<string, unknown>;
  requestKnown?: boolean;
}): RuntimeSelectorState {
  const hasNormalizedPayload = Object.prototype.hasOwnProperty.call(input, 'normalizedPayload');
  const payload = hasNormalizedPayload ? input.normalizedPayload : input.payload;
  return {
    requestedModel: input.requestedModel,
    currentModel: input.currentModel,
    ...(input.upstreamModel == null ? {} : { upstreamModel: input.upstreamModel }),
    ...(input.endpointPreference == null ? {} : { endpointPreference: input.endpointPreference }),
    payload,
    headers: input.headers || {},
    request: {
      ...(input.request || {}),
      requestedModel: input.requestedModel,
      currentModel: input.currentModel,
      upstreamModel: input.upstreamModel ?? null,
      endpointPreference: input.endpointPreference ?? null,
    },
    ...(input.stateStore ? { stateStore: input.stateStore } : {}),
    ...(input.selectorStateStore ? { selectorStateStore: input.selectorStateStore } : {}),
    ...(input.requestKnown == null ? {} : { requestKnown: input.requestKnown }),
  };
}

export function compiledRuntimeSelectorStateForRequest(
  request?: CompiledRouteRuntimeRequest | null,
): RuntimeSelectorState | undefined {
  if (!request) return undefined;
  const requestedModel = asTrimmedString(request.requestedModel);
  if (!requestedModel) return undefined;
  const hasNormalizedPayload = Object.prototype.hasOwnProperty.call(request, 'normalizedPayload');
  const headers = compiledRuntimeRecordOrEmpty(request.headers);
  const query = isRecord(request.query) ? request.query : null;
  const clientContext = isRecord(request.clientContext) ? request.clientContext : null;
  return compiledRuntimeSelectorState({
    requestedModel,
    currentModel: requestedModel,
    ...(hasNormalizedPayload ? { normalizedPayload: request.normalizedPayload } : { payload: request.payload }),
    headers,
    request: {
      payload: (hasNormalizedPayload ? request.normalizedPayload : request.payload) ?? null,
      normalizedPayload: hasNormalizedPayload ? request.normalizedPayload : null,
      headers,
      method: asTrimmedString(request.method) || null,
      path: asTrimmedString(request.path) || null,
      query,
      clientContext,
    },
    requestKnown: true,
  });
}

function uniqueBy<T>(items: T[], key: (item: T) => string | null | undefined): T | null {
  let selected: T | null = null;
  let selectedKey = '';
  for (const item of items) {
    const itemKey = asTrimmedString(key(item));
    if (!itemKey) return null;
    if (!selected) {
      selected = item;
      selectedKey = itemKey;
      continue;
    }
    if (selectedKey !== itemKey) return null;
  }
  return selected;
}

export function compiledRuntimePlanScope(plan: CompiledRouterPlan): RuntimeSelectorCelScope {
  return {
    id: plan.id,
    entryNodeId: plan.entryNodeId,
    publicModelName: plan.publicModelName,
    enabled: plan.enabled !== false,
    sourceRef: plan.sourceRef || {},
    metadata: compiledRuntimeRecordOrEmpty(plan.metadata),
    runtime: compiledRuntimeRecordOrEmpty(plan.runtime),
  };
}

export function compiledRuntimeGraphScope(bundle: CompiledRouterBundle): RuntimeSelectorCelScope {
  return {
    hash: bundle.hash,
    metadata: compiledRuntimeRecordOrEmpty(bundle.metadata),
    runtime: compiledRuntimeRecordOrEmpty(bundle.runtime),
  };
}

export function compiledRuntimeSelectionScope(
  term: CompiledExecutionSelectionTerm,
  runtime: Record<string, unknown>,
): RuntimeSelectorCelScope {
  return {
    termId: term.termId,
    nodeId: term.nodeId ?? null,
    mode: term.mode,
    optionId: term.optionId,
    optionIndex: term.optionIndex,
    optionKind: term.optionKind,
    enabled: term.enabled !== false,
    weight: numberOrFallback(term.weight, 1),
    order: numberOrFallback(term.order, 0),
    policy: isRecord(term.policy) ? term.policy : {},
    sourceRef: term.sourceRef || {},
    metadata: compiledRuntimeRecordOrEmpty(term.metadata),
    runtime,
  };
}

export function compiledRuntimeEndpointScope(
  endpoint: CompiledExecutionAlternative['endpoint'],
): RuntimeSelectorCelScope | null {
  if (!endpoint) return null;
  return {
    id: endpoint.endpointId,
    endpointId: endpoint.endpointId,
    nodeId: endpoint.nodeId,
    model: endpoint.model ?? null,
    compatibilityPolicy: isRecord(endpoint.compatibilityPolicy) ? endpoint.compatibilityPolicy : null,
    sourceRef: endpoint.sourceRef || {},
    metadata: compiledRuntimeRecordOrEmpty(endpoint.metadata),
    runtime: compiledRuntimeRecordOrEmpty(endpoint.runtime),
  };
}

export function compiledRuntimeExecutionAttemptScope(
  target: CompiledEndpointTarget | null | undefined,
  endpoint?: CompiledExecutionAlternative['endpoint'],
): RuntimeSelectorCelScope | null {
  if (!target) return null;
  return {
    id: target.executionAttemptId,
    executionAttemptId: target.executionAttemptId,
    targetId: target.targetId,
    endpointId: endpoint?.endpointId ?? target.endpointId ?? null,
    nodeId: endpoint?.nodeId ?? target.nodeId ?? null,
    model: target.model,
    modelSource: target.modelSource === 'request' ? 'request' : 'fixed',
    enabled: target.enabled !== false,
    weight: numberOrFallback(target.weight, 1),
    accountId: target.accountId ?? null,
    tokenId: target.tokenId ?? null,
    siteId: target.siteId ?? null,
    sourceRef: target.sourceRef || endpoint?.sourceRef || {},
    metadata: compiledRuntimeRecordOrEmpty(target.metadata),
    runtime: compiledRuntimeRecordOrEmpty(target.runtime),
  };
}

export function compiledRuntimeRoutingSignalsForAlternative(
  alternative: CompiledExecutionAlternative,
  termId: string,
): Record<string, unknown> | null {
  const term = (alternative.selectionTerms || []).find((item) => item.termId === termId);
  if (isRecord(term?.runtime?.routingSignals)) return term.runtime.routingSignals;
  if (isRecord(alternative.executionAttempt?.runtime?.routingSignals)) return alternative.executionAttempt.runtime.routingSignals;
  if (isRecord(alternative.runtime?.routingSignals)) return alternative.runtime.routingSignals;
  return null;
}

export function compiledRuntimeRuntimeScopeForSelectionOption(
  option: CompiledRuntimeSelectionOption,
  memberProbabilities?: Map<string, CompiledRuntimeAlternativeProbability>,
): Record<string, unknown> {
  const runtime = compiledRuntimeRecordOrEmpty(option.term.runtime);
  const routingSignals = option.alternatives
    .map((alternative) => compiledRuntimeRoutingSignalsForAlternative(alternative, option.term.termId));
  if (routingSignals.every((item) => item == null)) {
    return {
      ...runtime,
      routingSignals: {
        scope: 'selection_option',
        aggregation: 'downstream_probability',
        probabilityStatus: 'insufficient_data',
        memberCount: routingSignals.length,
        members: [],
        normalizedCostScore: null,
        normalizedBalanceScore: null,
        normalizedUsageScore: null,
      },
    };
  }
  if (routingSignals.length === 1 && routingSignals[0]) {
    const signal = routingSignals[0];
    return {
      ...runtime,
      routingSignals: {
        ...signal,
        normalizedCostScore: typeof signal.normalizedCostScore === 'number'
          ? signal.normalizedCostScore
          : null,
        normalizedBalanceScore: typeof signal.normalizedBalanceScore === 'number'
          ? signal.normalizedBalanceScore
          : null,
        normalizedUsageScore: typeof signal.normalizedUsageScore === 'number'
          ? signal.normalizedUsageScore
          : null,
      },
    };
  }

  const members = option.alternatives.map((alternative, index) => ({
    alternativeId: alternative.alternativeId,
    probability: memberProbabilities?.get(alternative.alternativeId)?.probability ?? null,
    probabilityStatus: memberProbabilities?.get(alternative.alternativeId)?.status ?? 'dynamic',
    routingSignals: routingSignals[index],
  }));
  const staticDistribution = members.every((member) => member.probabilityStatus === 'static' && member.probability != null);
  const probabilityTotal = staticDistribution
    ? members.reduce((sum, member) => sum + (member.probability ?? 0), 0)
    : 0;
  const weighted = (key: string): number | null => {
    if (!staticDistribution || probabilityTotal <= 0) return null;
    let total = 0;
    for (const member of members) {
      const value = member.routingSignals?.[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      total += value * (member.probability ?? 0);
    }
    return total / probabilityTotal;
  };
  const normalizedCostScore = weighted('normalizedCostScore');
  const normalizedBalanceScore = weighted('normalizedBalanceScore');
  const normalizedUsageScore = weighted('normalizedUsageScore');
  const probabilityStatus = members.some((member) => member.probabilityStatus === 'unsupported')
    ? 'unsupported'
    : staticDistribution ? 'static' : 'dynamic';

  return {
    ...runtime,
    routingSignals: {
      scope: 'selection_option',
      aggregation: 'downstream_probability',
      probabilityStatus,
      memberCount: members.length,
      members,
      normalizedCostScore,
      normalizedBalanceScore,
      normalizedUsageScore,
    },
  };
}

function endpointScopeForSelectionOption(option: CompiledRuntimeSelectionOption): RuntimeSelectorCelScope | null {
  const endpoints = option.alternatives.map((alternative) => alternative.endpoint).filter(Boolean);
  return compiledRuntimeEndpointScope(uniqueBy(endpoints, (endpoint) => endpoint?.endpointId) || null);
}

function executionAttemptScopeForSelectionOption(option: CompiledRuntimeSelectionOption): RuntimeSelectorCelScope | null {
  const attempts = option.alternatives.map((alternative) => alternative.executionAttempt).filter(Boolean);
  const endpoints = option.alternatives.map((alternative) => alternative.endpoint).filter(Boolean);
  return compiledRuntimeExecutionAttemptScope(
    uniqueBy(attempts, (target) => target?.executionAttemptId) || null,
    uniqueBy(endpoints, (endpoint) => endpoint?.endpointId) || null,
  );
}

export function buildCompiledRuntimeSelectorCandidate<TOption extends CompiledRuntimeSelectionOption>(input: {
  option: TOption;
  index: number;
  plan: CompiledRouterPlan;
  bundle: CompiledRouterBundle;
  enabled?: boolean;
  memberProbabilities?: Map<string, CompiledRuntimeAlternativeProbability>;
}): RuntimeSelectorCandidate<TOption> {
  const term = input.option.term;
  const weight = numberOrFallback(term.weight, 1);
  const runtime = compiledRuntimeRuntimeScopeForSelectionOption(input.option, input.memberProbabilities);
  const endpoint = endpointScopeForSelectionOption(input.option);
  const executionAttempt = executionAttemptScopeForSelectionOption(input.option);
  const selectionMetadata = compiledRuntimeRecordOrEmpty(term.metadata);
  const metadata = term.mode === 'execution_attempt' && Object.keys(selectionMetadata).length === 0
    ? compiledRuntimeRecordOrEmpty(executionAttempt?.metadata)
    : selectionMetadata;
  return {
    idx: input.index,
    kind: term.optionKind || term.mode || 'route',
    nodeId: term.nodeId || undefined,
    metadata,
    runtime,
    selection: compiledRuntimeSelectionScope(term, compiledRuntimeRecordOrEmpty(term.runtime)),
    endpoint,
    executionAttempt,
    plan: compiledRuntimePlanScope(input.plan),
    graph: compiledRuntimeGraphScope(input.bundle),
    enabled: input.enabled ?? (term.enabled !== false && input.option.alternatives.length > 0),
    weight,
    score: weight,
    order: numberOrFallback(term.order, input.index),
    payload: input.option,
  };
}
