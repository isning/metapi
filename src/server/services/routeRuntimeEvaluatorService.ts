import {
  getCompiledRouterPlanById,
  type CompiledExecutionAlternative,
  type CompiledExecutionSelectionTerm,
  type CompiledRouterBundle,
  type CompiledRouterPlan,
  type CompiledRouterTerminal,
  type CompiledRouteGraph,
  type CompiledEndpointTarget,
  type CompiledRouterFilterStage,
  type RouteFilter,
  type RouteProgramSourceRef,
} from '../../shared/compiledRuntime.js';
import {
  matchesModelPattern,
} from '../../shared/modelPatternMatcher.js';
import {
  normalizeUpstreamCompatibilityPolicy,
  type UpstreamCompatibilityPolicy,
} from '../contracts/upstreamCompatibilityPolicy.js';
import {
  evaluateRuntimeSelectorCandidates,
  hydrateRuntimeSelectorPlan,
  selectRuntimeCandidate,
} from './selectorEngine.js';
import {
  buildCompiledRuntimeSelectorCandidate,
  compiledRuntimeSelectorState,
  groupCompiledRuntimeSelectionOptions,
  type CompiledRuntimeSelectionOption,
} from './compiledRuntimeSelectorScopes.js';
import {
  nextCommonCompiledRuntimeControl,
  selectLowestAvailableCompiledFallbackStage,
} from './compiledRuntimeControlFlow.js';
import { resolveDispatchSelectorPolicy } from './dispatchPolicyService.js';
import {
  applyCompiledRuntimePostBuildFilters,
  type CompiledRuntimePostBuildFilters,
} from './compiledRuntimePostBuildFilters.js';
import type { CompiledRouteRuntimeRequest } from './compiledRuntimeRequestTypes.js';

type RouteRuntimeEvaluationState = {
  requestedModel: string;
  currentModel: string;
  upstreamModel?: string;
  endpointPreference?: 'chat' | 'messages' | 'responses';
  payload?: unknown;
  normalizedPayload?: unknown;
  headers: Record<string, unknown>;
  query?: Record<string, unknown>;
  request: Record<string, unknown>;
  stateStore: Record<string, unknown>;
  selectorStateStore: Record<string, unknown>;
};

export type RouteRuntimeFailureOverlay = {
  disabledExecutionAttemptIds?: string[];
  disabledExecutionTargetIds?: number[];
};

export type RouteRuntimeSelectionConstraint = {
  forcedExecutionAttemptId?: string | null;
};

export type RouteRuntimeTraceStep = {
  nodeId: string | null;
  selectorId?: string;
  nodeName?: string | null;
  nodeType: string;
  programId?: string;
  opId?: string;
  enteredPortId?: string;
  exitedPortId?: string;
  appliedFilters: string[];
  decision: 'matched_entry' | 'applied_filter' | 'selected_fallback_stage' | 'selected_option' | 'selected_alternative' | 'terminal' | 'synthetic_response';
  selectedChoiceId?: string;
  selectedAlternativeId?: string;
  fallbackId?: string;
  fallbackStageId?: string;
  fallbackStageIndex?: number;
  sourceRef?: RouteProgramSourceRef;
  selectionSourceRef?: RouteProgramSourceRef;
};

export type RouteRuntimeTrace = {
  path: RouteRuntimeTraceStep[];
  edges: Array<{
    edgeId: string;
    sourceNodeId: string;
    sourcePortId: string;
    targetNodeId: string;
    targetPortId: string;
    kind: string;
  }>;
  terminalNodeId: string | null;
};

export type RouteRuntimePostBuildFilters = CompiledRuntimePostBuildFilters;

export type RouteRuntimeAlternativeSnapshot = {
  alternativeId: string;
  nodeId?: string | null;
  endpointId?: string | null;
  executionTargetIds: number[];
  weight: number;
  enabled: boolean;
  policyEvaluation: {
    eligible: boolean;
    contribution: number;
    order: number;
    score: number;
  };
  sourceRef?: RouteProgramSourceRef;
};

export type RouteRuntimeFallbackStageSnapshot = {
  fallbackId: string;
  stageId: string;
  stageIndex: number;
  nodeId: string;
  sourceRef?: RouteProgramSourceRef;
};

export type RouteRuntimeSelectionSnapshot = {
  selectorId: string;
  nodeId: string | null;
  mode: string;
  policy: Record<string, unknown>;
  resolvedPolicy: {
    source: 'default' | 'registry' | 'inline' | 'builtin';
    id: string | null;
    kind: 'cel' | 'builtin' | null;
    selectionMode: string | null;
  };
  selectedChoiceId: string | null;
  candidates: RouteRuntimeAlternativeSnapshot[];
  sourceRef?: RouteProgramSourceRef;
};

export type RouteRuntimeCompiledPlanSnapshot = {
  planId: string;
  entryNodeId: string;
  terminalNodeId: string | null;
  terminalKind: 'endpoint' | 'synthetic_response' | null;
  publicModelName: string | null;
  sourceRef?: RouteProgramSourceRef;
  terminal: {
    kind: 'supply' | 'synthetic';
    nodeId: string | null;
    endpointId?: string | null;
    terminalModel?: string | null;
    targetSelectionPolicy?: Record<string, unknown> | null;
    statusCode?: 429 | 503;
    message?: string | null;
    sourceRef?: RouteProgramSourceRef;
  } | null;
};

export type RouteRuntimeMetadataSnapshot = {
  graph: Record<string, unknown> | null;
  plan: Record<string, unknown> | null;
  selection: Record<string, unknown> | null;
  endpoint: Record<string, unknown> | null;
  executionAttempt: Record<string, unknown> | null;
};

export type RouteRuntimeSelection = {
  runtimeBundleHash?: string | null;
  runtimeArtifactId?: string | null;
  compiledPlanSnapshot?: RouteRuntimeCompiledPlanSnapshot | null;
  compiledProgramSnapshot?: CompiledRouterPlan | null;
  selectionSnapshots?: RouteRuntimeSelectionSnapshot[];
  fallbackStageSnapshots?: RouteRuntimeFallbackStageSnapshot[];
  matchedEntryNodeId: string;
  selectedEntryNodeId: string;
  routeEndpointCompatibilityPolicy?: UpstreamCompatibilityPolicy;
  selectedExecutionAttempt: {
    endpointId: string;
    executionAttemptId: string;
    targetId: string;
    nodeId: string;
    model: string;
    modelSource?: 'fixed' | 'request';
    accountId?: number | string | null;
    tokenId?: number | string | null;
    siteId?: number | string | null;
    weight?: number | null;
    transportBinding?: { kind: 'execution_target'; executionTargetId: number };
    metadata?: Record<string, unknown>;
    compatibilityPolicy?: UpstreamCompatibilityPolicy;
    sourceRef: RouteProgramSourceRef;
  } | null;
  terminalNodeId: string | null;
  terminalKind: 'endpoint' | 'synthetic_response';
  syntheticResponse?: {
    statusCode: 429 | 503;
    message: string;
  };
  requestedModel: string;
  currentModel: string;
  upstreamModel?: string;
  postBuildFilters: RouteRuntimePostBuildFilters;
  trace: RouteRuntimeTrace;
  selectedAlternativeId?: string | null;
  alternativeSnapshots?: RouteRuntimeAlternativeSnapshot[];
  metadata?: RouteRuntimeMetadataSnapshot;
};

export type HydratedCompiledRouterBundle = {
  bundle: CompiledRouterBundle;
  hydratedPlanIds: Set<string>;
  patterns: CompiledRouterBundle['matcher']['patterns'];
};

const DEFAULT_ROUTE_GRAPH_MAX_HOPS = 8;
const hydratedCompiledRouterCache = new WeakMap<CompiledRouterBundle, HydratedCompiledRouterBundle>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function runtimeRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function buildCompiledRouteRequestContext(input: {
  requestedModel: string;
  request?: CompiledRouteRuntimeRequest | null;
}): {
  requestedModel: string;
  payload?: unknown;
  normalizedPayload?: unknown;
  headers: Record<string, unknown>;
  query?: Record<string, unknown>;
  request: Record<string, unknown>;
} {
  const request = isRecord(input.request) ? input.request : {};
  const hasExplicitRequest = input.request != null;
  const requestedModel = hasExplicitRequest
    ? asTrimmedString(request.requestedModel)
    : asTrimmedString(input.requestedModel);
  if (!requestedModel) {
    throw new Error('Compiled runtime request is missing requestedModel');
  }
  const payload = Object.prototype.hasOwnProperty.call(request, 'payload') ? request.payload : undefined;
  const normalizedPayload = Object.prototype.hasOwnProperty.call(request, 'normalizedPayload') ? request.normalizedPayload : undefined;
  const hasPayload = Object.prototype.hasOwnProperty.call(request, 'payload');
  const hasNormalizedPayload = Object.prototype.hasOwnProperty.call(request, 'normalizedPayload');
  const headers = runtimeRecord(request.headers) || {};
  const query = runtimeRecord(request.query);
  const clientContext = runtimeRecord(request.clientContext);
  const requestContext: Record<string, unknown> = {
    requestedModel,
    currentModel: requestedModel,
    payload: payload === undefined ? null : payload,
    normalizedPayload: normalizedPayload === undefined ? null : normalizedPayload,
    headers,
    method: asTrimmedString(request.method) || null,
    path: asTrimmedString(request.path) || null,
    query: query || null,
    clientContext: clientContext || null,
  };
  return {
    requestedModel,
    ...(hasPayload ? { payload } : {}),
    ...(hasNormalizedPayload ? { normalizedPayload } : {}),
    headers,
    ...(query ? { query } : {}),
    request: requestContext,
  };
}

function numberOrFallback(value: unknown, fallback: number): number {
  const normalized = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function normalizeFailureOverlay(value?: RouteRuntimeFailureOverlay | null): Required<RouteRuntimeFailureOverlay> {
  return {
    disabledExecutionAttemptIds: Array.from(new Set((value?.disabledExecutionAttemptIds || []).map(asTrimmedString).filter(Boolean))),
    disabledExecutionTargetIds: Array.from(new Set((value?.disabledExecutionTargetIds || []).map((item) => Number(item)).filter((item) => Number.isSafeInteger(item) && item > 0))),
  };
}

function normalizeSelectionConstraint(value?: RouteRuntimeSelectionConstraint | null): Required<RouteRuntimeSelectionConstraint> {
  const forcedExecutionAttemptId = asTrimmedString(value?.forcedExecutionAttemptId);
  return {
    forcedExecutionAttemptId,
  };
}

function buildRouteExecutionStateStore(
  stateStore: Record<string, unknown> | undefined,
  failureOverlay?: RouteRuntimeFailureOverlay | null,
): Record<string, unknown> {
  const target = stateStore || {};
  const normalized = normalizeFailureOverlay(failureOverlay);
  target.routeExecutionFailure = {
    disabledExecutionAttemptIds: normalized.disabledExecutionAttemptIds,
    disabledExecutionTargetIds: normalized.disabledExecutionTargetIds,
  };
  return target;
}

function executionTargetIdFromTarget(target: CompiledEndpointTarget): number | null {
  const value = Number(target.transportBinding?.executionTargetId);
  return Number.isSafeInteger(value) && value > 0 ? Math.trunc(value) : null;
}

function transportBindingFromTarget(
  value: unknown,
): { kind: 'execution_target'; executionTargetId: number } | undefined {
  if (!isRecord(value) || value.kind !== 'execution_target') return undefined;
  const executionTargetId = Number(value.executionTargetId);
  if (!Number.isSafeInteger(executionTargetId) || executionTargetId <= 0) return undefined;
  return { kind: 'execution_target', executionTargetId: Math.trunc(executionTargetId) };
}

function executionAttemptDisabledByOverlay(
  target: CompiledEndpointTarget,
  overlay?: RouteRuntimeFailureOverlay | null,
): boolean {
  const normalized = normalizeFailureOverlay(overlay);
  const executionTargetId = executionTargetIdFromTarget(target);
  if (executionTargetId == null) return true;
  if (normalized.disabledExecutionTargetIds.includes(executionTargetId)) return true;
  return normalized.disabledExecutionAttemptIds.includes(target.executionAttemptId);
}

function mergeRuntimeAlternativeSnapshots(
  left?: RouteRuntimeAlternativeSnapshot[],
  right?: RouteRuntimeAlternativeSnapshot[],
): RouteRuntimeAlternativeSnapshot[] {
  const merged = new Map<string, RouteRuntimeAlternativeSnapshot>();
  for (const item of [...(left || []), ...(right || [])]) {
    merged.set(item.alternativeId, item);
  }
  return Array.from(merged.values());
}

function executionAttemptTargetForSelection(
  target: Record<string, unknown>,
  fallbackSourceRef: RouteProgramSourceRef = {},
): RouteRuntimeSelection['selectedExecutionAttempt'] {
  const modelSource = target.modelSource === 'request' ? 'request' : 'fixed';
  const sourceRef = isRecord(target.sourceRef) ? target.sourceRef as RouteProgramSourceRef : fallbackSourceRef;
  return {
    endpointId: asTrimmedString(target.endpointId),
    executionAttemptId: asTrimmedString(target.executionAttemptId),
    targetId: asTrimmedString(target.targetId),
    nodeId: asTrimmedString(target.nodeId),
    model: modelSource === 'request' ? '' : asTrimmedString(target.model),
    modelSource,
    accountId: target.accountId as number | string | null | undefined,
    tokenId: target.tokenId as number | string | null | undefined,
    siteId: target.siteId as number | string | null | undefined,
    weight: Number.isFinite(Number(target.weight)) ? Number(target.weight) : null,
    transportBinding: transportBindingFromTarget(target.transportBinding),
    metadata: isRecord(target.metadata) ? target.metadata : undefined,
    compatibilityPolicy: normalizeUpstreamCompatibilityPolicy(target.compatibilityPolicy),
    sourceRef,
  };
}

function filterMatchesOperationPhase(operation: RouteFilter, phase: 'pre_selection' | 'post_build'): boolean {
  if (operation.type === 'rewrite_model') return phase === 'pre_selection';
  return phase === 'post_build';
}

function applyPreSelectionFilter(state: RouteRuntimeEvaluationState, operation: RouteFilter): string | null {
  if (operation.type !== 'rewrite_model') return null;
  const source = operation.source === 'upstream_model' ? 'upstreamModel' : 'currentModel';
  const current = source === 'upstreamModel'
    ? (state.upstreamModel || state.currentModel)
    : state.currentModel;
  if (operation.operation === 'set') {
    const value = asTrimmedString(operation.value);
    if (!value) return null;
    if (source === 'upstreamModel') state.upstreamModel = value;
    else state.currentModel = value;
    return `rewrite_model:${source}=set`;
  }
  const suffix = asTrimmedString(operation.suffix);
  if (!suffix || !current.endsWith(suffix)) return null;
  const next = current.slice(0, -suffix.length);
  if (source === 'upstreamModel') state.upstreamModel = next;
  else state.currentModel = next;
  return `rewrite_model:${source}=strip_suffix`;
}

function collectPostBuildFilter(target: RouteRuntimePostBuildFilters, operation: RouteFilter): void {
  if (operation.type === 'set_payload' || operation.type === 'remove_payload') {
    target.payload.push(operation);
    return;
  }
  if (operation.type === 'set_header' || operation.type === 'remove_header') {
    target.headers.push(operation);
    return;
  }
  if (operation.type === 'set_endpoint_preference') {
    target.endpointPreference = operation.endpoint;
  }
}

function hasUsableCompiledRouterBundle(value: unknown): value is CompiledRouterBundle {
  if (
    !isRecord(value)
    || !isRecord(value.matcher)
    || !Array.isArray(value.plans)
    || !isRecord(value.planIndex)
  ) {
    return false;
  }
  if (Array.isArray(value.diagnostics) && value.diagnostics.some((diagnostic) => (
    isRecord(diagnostic)
    && diagnostic.severity === 'error'
    && asTrimmedString(diagnostic.code).startsWith('compiled_router.')
  ))) {
    return false;
  }
  return value.plans.length > 0;
}

function hydrateCompiledRouterSelectionTerms(plan: CompiledRouterPlan): void {
  for (const alternative of plan.executionAlternatives || []) {
    for (const term of alternative.selectionTerms || []) {
      hydrateRuntimeSelectorPlan(resolveDispatchSelectorPolicy(term.policy).selectorPolicy);
    }
  }
}

export function hydrateCompiledRouterBundle(bundle: CompiledRouterBundle): HydratedCompiledRouterBundle | null {
  if (!hasUsableCompiledRouterBundle(bundle)) return null;
  const cached = hydratedCompiledRouterCache.get(bundle);
  if (cached) return cached;
  const patterns = Array.isArray(bundle.matcher?.patterns) ? bundle.matcher.patterns : [];
  const hydrated: HydratedCompiledRouterBundle = {
    bundle,
    hydratedPlanIds: new Set(),
    patterns,
  };
  hydratedCompiledRouterCache.set(bundle, hydrated);
  return hydrated;
}

function findCompiledRouterPlanById(hydrated: HydratedCompiledRouterBundle, planId: string): CompiledRouterPlan | null {
  const normalizedPlanId = asTrimmedString(planId);
  if (!normalizedPlanId) return null;
  const plan = getCompiledRouterPlanById(hydrated.bundle, normalizedPlanId);
  if (!plan || plan.enabled === false || !Array.isArray(plan.executionAlternatives)) return null;
  if (!hydrated.hydratedPlanIds.has(normalizedPlanId)) {
    hydrateCompiledRouterSelectionTerms(plan);
    hydrated.hydratedPlanIds.add(normalizedPlanId);
  }
  return plan;
}

function matcherEntryForModel<T>(table: Record<string, T> | null | undefined, model: string): T | null {
  if (!table || !Object.prototype.hasOwnProperty.call(table, model)) return null;
  return table[model] || null;
}

function matchCompiledRouterBundle(hydrated: HydratedCompiledRouterBundle, requestedModel: string): { plan: CompiledRouterPlan; entryNodeId: string } | null {
  const target = matcherEntryForModel(hydrated.bundle.matcher?.exact, requestedModel)
    || matcherEntryForModel(hydrated.bundle.matcher?.normalizedExact, requestedModel.toLowerCase())
    || hydrated.patterns.find((pattern) => matchesModelPattern(requestedModel, pattern.pattern));
  if (!target?.programId || !asTrimmedString(target.entryNodeId)) return null;
  const plan = findCompiledRouterPlanById(hydrated, target.programId);
  if (!plan) return null;
  if (asTrimmedString(plan.entryNodeId) && asTrimmedString(plan.entryNodeId) !== asTrimmedString(target.entryNodeId)) {
    return null;
  }
  return {
    plan,
    entryNodeId: asTrimmedString(target.entryNodeId),
  };
}

export function matchCompiledRouterPlanId(
  bundle: CompiledRouterBundle,
  requestedModel: string,
): string | null {
  const hydrated = hydrateCompiledRouterBundle(bundle);
  return hydrated
    ? matchCompiledRouterBundle(hydrated, requestedModel)?.plan.id || null
    : null;
}

function targetRefToRuntimeTarget(
  target: CompiledEndpointTarget | null | undefined,
  endpoint: CompiledExecutionAlternative['endpoint'],
  fallbackSourceRef: RouteProgramSourceRef = {},
): RouteRuntimeSelection['selectedExecutionAttempt'] {
  if (!target) return null;
  return executionAttemptTargetForSelection({
    ...target,
    endpointId: endpoint?.endpointId || '',
    nodeId: endpoint?.nodeId || '',
  }, fallbackSourceRef);
}

function alternativeSourceRef(alternative: CompiledExecutionAlternative): RouteProgramSourceRef {
  if (isRecord(alternative.endpoint?.sourceRef)) return alternative.endpoint.sourceRef as RouteProgramSourceRef;
  if (isRecord(alternative.executionAttempt?.sourceRef)) return alternative.executionAttempt.sourceRef as RouteProgramSourceRef;
  if (alternative.terminal.kind === 'synthetic' && isRecord(alternative.terminal.sourceRef)) {
    return alternative.terminal.sourceRef as RouteProgramSourceRef;
  }
  return {};
}

function resolveCompiledRouterFilterStages(
  plan: CompiledRouterPlan,
  indexes: number[] | null | undefined,
): CompiledRouterFilterStage[] {
  const stages = Array.isArray(plan.filterStages) ? plan.filterStages : [];
  return (Array.isArray(indexes) ? indexes : [])
    .map((index) => stages[index])
    .filter((stage): stage is CompiledRouterFilterStage => !!stage);
}

function compiledRouterTerminalSnapshot(
  terminal: CompiledRouterTerminal | null | undefined,
  endpoint?: CompiledExecutionAlternative['endpoint'],
): RouteRuntimeCompiledPlanSnapshot['terminal'] {
  if (!terminal) return null;
  if (terminal.kind === 'synthetic') {
    return {
      kind: 'synthetic',
      nodeId: terminal.nodeId || null,
      statusCode: terminal.statusCode === 429 ? 429 : 503,
      message: terminal.message || null,
      sourceRef: terminal.sourceRef,
    };
  }
  return {
    kind: 'supply',
    nodeId: endpoint?.nodeId || null,
    endpointId: terminal.endpointId || null,
    terminalModel: endpoint?.model || null,
    targetSelectionPolicy: null,
    sourceRef: endpoint?.sourceRef || {},
  };
}

function compiledRouterPlanSnapshot(
  plan: CompiledRouterPlan,
  matched: { entryNodeId: string },
  selection: RouteRuntimeSelection,
  alternative?: CompiledExecutionAlternative | null,
): RouteRuntimeCompiledPlanSnapshot {
  const terminal = alternative?.terminal || null;
  return {
    planId: plan.id,
    entryNodeId: matched.entryNodeId,
    terminalNodeId: selection.terminalNodeId,
    terminalKind: selection.terminalKind,
    publicModelName: plan.publicModelName || null,
    sourceRef: plan.sourceRef,
    terminal: compiledRouterTerminalSnapshot(terminal, alternative?.endpoint),
  };
}

function cloneRecordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? JSON.parse(JSON.stringify(value)) as Record<string, unknown> : null;
}

function selectedSelectionTermMetadata(alternative: CompiledExecutionAlternative): Record<string, unknown> | null {
  const selectedTerm = [...(alternative.selectionTerms || [])].reverse()
    .find((term) => isRecord(term.metadata));
  return cloneRecordOrNull(selectedTerm?.metadata);
}

function runtimeMetadataSnapshot(input: {
  bundle: CompiledRouterBundle;
  plan: CompiledRouterPlan;
  alternative: CompiledExecutionAlternative;
}): RouteRuntimeMetadataSnapshot {
  return {
    graph: cloneRecordOrNull(input.bundle.metadata),
    plan: cloneRecordOrNull(input.plan.metadata),
    selection: selectedSelectionTermMetadata(input.alternative),
    endpoint: cloneRecordOrNull(input.alternative.endpoint?.metadata),
    executionAttempt: cloneRecordOrNull(input.alternative.executionAttempt?.metadata),
  };
}

function consumeCompiledRouterHop(budget: { hops: number; maxHops: number }): boolean {
  budget.hops += 1;
  return budget.hops <= budget.maxHops;
}

function applyCompiledRouterFilterStages(input: {
  stages: CompiledRouterFilterStage[];
  planId: string;
  state: RouteRuntimeEvaluationState;
  postBuildFilters: RouteRuntimePostBuildFilters;
  trace: RouteRuntimeTrace;
  budget: { hops: number; maxHops: number };
}): boolean {
  for (const stage of input.stages || []) {
    if (!consumeCompiledRouterHop(input.budget)) return false;
    const appliedFilters: string[] = [];
    for (const operation of stage.operations || []) {
      if (stage.phase === 'pre_selection' && filterMatchesOperationPhase(operation, 'pre_selection')) {
        const applied = applyPreSelectionFilter(input.state, operation);
        if (applied) appliedFilters.push(applied);
      } else if (stage.phase === 'post_build' && filterMatchesOperationPhase(operation, 'post_build')) {
        collectPostBuildFilter(input.postBuildFilters, operation);
        appliedFilters.push(operation.type);
      }
    }
    input.trace.path.push({
      nodeId: stage.nodeId,
      nodeType: 'filter',
      programId: input.planId,
      enteredPortId: stage.phase === 'pre_selection' ? 'bidirect.in' : undefined,
      exitedPortId: 'bidirect.out',
      appliedFilters,
      decision: 'applied_filter',
      sourceRef: stage.sourceRef,
    });
  }
  return true;
}

function runtimeSelectorState(state: RouteRuntimeEvaluationState) {
  return compiledRuntimeSelectorState({
    requestedModel: state.requestedModel,
    currentModel: state.currentModel,
    upstreamModel: state.upstreamModel,
    endpointPreference: state.endpointPreference,
    payload: state.payload !== undefined ? state.payload : state.normalizedPayload,
    headers: state.headers,
    request: state.request,
    stateStore: state.stateStore,
    selectorStateStore: state.selectorStateStore,
  });
}

function compiledAlternativeDisabledByOverlay(
  alternative: CompiledExecutionAlternative,
  overlay?: RouteRuntimeFailureOverlay | null,
  constraint?: RouteRuntimeSelectionConstraint | null,
): boolean {
  if (alternative.enabled === false) return true;
  if ((alternative.selectionTerms || []).some((term) => term.enabled === false)) return true;
  const normalized = normalizeFailureOverlay(overlay);
  const normalizedConstraint = normalizeSelectionConstraint(constraint);
  if (normalizedConstraint.forcedExecutionAttemptId) {
    if (!alternative.executionAttempt) return true;
    if (alternative.executionAttempt.executionAttemptId !== normalizedConstraint.forcedExecutionAttemptId) return true;
  }
  if (alternative.executionAttempt && executionAttemptDisabledByOverlay(alternative.executionAttempt, overlay)) return true;
  return false;
}

function commonFilterStageIndexes(
  alternatives: CompiledExecutionAlternative[],
  appliedStageIndexes: Set<number>,
): number[] {
  const [first] = alternatives;
  if (!first) return [];
  return (first.filterStageIndexes || [])
    .filter((index) => !appliedStageIndexes.has(index))
    .filter((index) => alternatives.every((alternative) => (alternative.filterStageIndexes || []).includes(index)));
}

function applyCommonCompiledRouterFilterStages(input: {
  alternatives: CompiledExecutionAlternative[];
  appliedStageIndexes: Set<number>;
  plan: CompiledRouterPlan;
  state: RouteRuntimeEvaluationState;
  postBuildFilters: RouteRuntimePostBuildFilters;
  trace: RouteRuntimeTrace;
  budget: { hops: number; maxHops: number };
}): boolean {
  const indexes = commonFilterStageIndexes(input.alternatives, input.appliedStageIndexes);
  if (indexes.length === 0) return true;
  if (!applyCompiledRouterFilterStages({
    stages: resolveCompiledRouterFilterStages(input.plan, indexes),
    planId: input.plan.id,
    state: input.state,
    postBuildFilters: input.postBuildFilters,
    trace: input.trace,
    budget: input.budget,
  })) {
    return false;
  }
  for (const index of indexes) input.appliedStageIndexes.add(index);
  return true;
}

type CompiledAlternativeOption = CompiledRuntimeSelectionOption & {
  optionId: string;
  term: CompiledExecutionSelectionTerm;
  alternatives: CompiledExecutionAlternative[];
};

function compiledAlternativeSnapshot(alternative: CompiledExecutionAlternative): RouteRuntimeAlternativeSnapshot {
  const target = alternative.executionAttempt || null;
  const executionTargetId = target ? executionTargetIdFromTarget(target) : null;
  const terminal = alternative.terminal;
  const endpoint = alternative.endpoint;
  const lastTerm = [...(alternative.selectionTerms || [])].reverse().find(Boolean);
  return {
    alternativeId: alternative.alternativeId,
    nodeId: endpoint?.nodeId ?? (terminal.kind === 'synthetic' ? terminal.nodeId : null),
    endpointId: endpoint?.endpointId ?? (terminal.kind === 'supply' ? terminal.endpointId : null),
    executionTargetIds: executionTargetId == null ? [] : [executionTargetId],
    weight: numberOrFallback(lastTerm?.weight, 1),
    enabled: alternative.enabled !== false,
    policyEvaluation: {
      eligible: alternative.enabled !== false,
      contribution: numberOrFallback(lastTerm?.weight, 1),
      order: numberOrFallback(lastTerm?.order, 0),
      score: numberOrFallback(lastTerm?.weight, 1),
    },
    sourceRef: alternativeSourceRef(alternative),
  };
}

function selectCompiledExecutionAlternative(input: {
  bundle: CompiledRouterBundle;
  plan: CompiledRouterPlan;
  state: RouteRuntimeEvaluationState;
  postBuildFilters: RouteRuntimePostBuildFilters;
  trace: RouteRuntimeTrace;
  budget: { hops: number; maxHops: number };
  failureOverlay?: RouteRuntimeFailureOverlay | null;
  selectionConstraint?: RouteRuntimeSelectionConstraint | null;
  random?: () => number;
}): {
  alternative: CompiledExecutionAlternative;
  alternativeSnapshots: RouteRuntimeAlternativeSnapshot[];
  selectionSnapshots: RouteRuntimeSelectionSnapshot[];
  fallbackStageSnapshots: RouteRuntimeFallbackStageSnapshot[];
} | null {
  let eligible = (input.plan.executionAlternatives || [])
    .filter((alternative) => !compiledAlternativeDisabledByOverlay(
      alternative,
      input.failureOverlay,
      input.selectionConstraint,
    ));
  if (eligible.length === 0) return null;

  const alternativeSnapshots = eligible.map(compiledAlternativeSnapshot);
  const selectionSnapshots: RouteRuntimeSelectionSnapshot[] = [];
  const fallbackStageSnapshots: RouteRuntimeFallbackStageSnapshot[] = [];
  const appliedStageIndexes = new Set<number>();
  const processedControlKeys = new Set<string>();

  for (;;) {
    const control = nextCommonCompiledRuntimeControl({
      alternatives: eligible,
      processedControlKeys,
    });
    if (!control) break;
    if (!applyCommonCompiledRouterFilterStages({
      alternatives: eligible,
      appliedStageIndexes,
      plan: input.plan,
      state: input.state,
      postBuildFilters: input.postBuildFilters,
      trace: input.trace,
      budget: input.budget,
    })) {
      return null;
    }

    if (control.kind === 'fallback') {
      if (!consumeCompiledRouterHop(input.budget)) return null;
      const selectedStage = selectLowestAvailableCompiledFallbackStage({
        alternatives: eligible,
        fallbackId: control.fallbackId,
      });
      if (!selectedStage) return null;
      processedControlKeys.add(control.key);
      eligible = selectedStage.alternatives;
      const snapshot: RouteRuntimeFallbackStageSnapshot = {
        fallbackId: selectedStage.stage.fallbackId,
        stageId: selectedStage.stage.stageId,
        stageIndex: selectedStage.stage.stageIndex,
        nodeId: selectedStage.stage.nodeId,
        sourceRef: selectedStage.stage.sourceRef,
      };
      fallbackStageSnapshots.push(snapshot);
      input.trace.path.push({
        nodeId: snapshot.nodeId,
        nodeType: 'fallback_stage',
        programId: input.plan.id,
        appliedFilters: [],
        decision: 'selected_fallback_stage',
        fallbackId: snapshot.fallbackId,
        fallbackStageId: snapshot.stageId,
        fallbackStageIndex: snapshot.stageIndex,
        sourceRef: snapshot.sourceRef,
      });
      continue;
    }

    const options = groupCompiledRuntimeSelectionOptions(eligible, control.termId) as CompiledAlternativeOption[] | null;
    if (!options || options.length === 0) return null;
    const [firstOption] = options;
    const term = firstOption.term;
    if (!consumeCompiledRouterHop(input.budget)) return null;
    const runtimeCandidates = options.map((option, index) => buildCompiledRuntimeSelectorCandidate({
      index,
      option,
      plan: input.plan,
      bundle: input.bundle,
    }));
    const resolvedPolicy = resolveDispatchSelectorPolicy(term.policy);
    const selectorState = runtimeSelectorState(input.state);
    const evaluatedCandidates = evaluateRuntimeSelectorCandidates({
      selectorId: term.termId,
      policy: resolvedPolicy.selectorPolicy,
      candidates: runtimeCandidates,
      state: selectorState,
    });
    const evaluatedByOptionId = new Map(evaluatedCandidates.map((candidate) => [candidate.payload?.optionId, candidate]));
    const selected = selectRuntimeCandidate({
      selectorId: term.termId,
      policy: resolvedPolicy.selectorPolicy,
      candidates: runtimeCandidates,
      state: selectorState,
      random: input.random,
    });
    const selectedOption = selected?.payload;
    selectionSnapshots.push({
      selectorId: term.termId,
      nodeId: term.nodeId || null,
      mode: term.mode || 'route',
      policy: resolvedPolicy.selectorPolicy,
      resolvedPolicy: {
        source: resolvedPolicy.source,
        id: resolvedPolicy.resolvedPolicy?.id ?? null,
        kind: resolvedPolicy.resolvedPolicy?.kind ?? null,
        selectionMode: resolvedPolicy.resolvedPolicy?.selectionMode ?? null,
      },
      selectedChoiceId: selectedOption?.optionId || null,
      candidates: options.map((option) => {
        const optionAlternative = option.alternatives[0];
        const snapshot = optionAlternative ? compiledAlternativeSnapshot(optionAlternative) : null;
        const evaluated = evaluatedByOptionId.get(option.optionId);
        return {
          alternativeId: option.optionId,
          nodeId: option.term.nodeId || null,
          endpointId: snapshot?.endpointId || null,
          executionTargetIds: Array.from(new Set(option.alternatives.flatMap((alternative) => compiledAlternativeSnapshot(alternative).executionTargetIds))),
          weight: evaluated?.weight ?? numberOrFallback(option.term.weight, 1),
          enabled: evaluated?.enabled ?? false,
          policyEvaluation: {
            eligible: evaluated?.enabled ?? false,
            contribution: evaluated?.weight ?? 0,
            order: evaluated?.order ?? numberOrFallback(option.term.order, 0),
            score: evaluated?.score ?? 0,
          },
          sourceRef: option.term.sourceRef,
        };
      }),
      sourceRef: term.sourceRef,
    });
    input.trace.path.push({
      nodeId: term.nodeId || null,
      selectorId: term.termId,
      nodeType: 'selection',
      programId: input.plan.id,
      exitedPortId: selectedOption ? `${term.mode || 'selection'}.out` : undefined,
      appliedFilters: [],
      decision: 'selected_option',
      selectedChoiceId: selectedOption?.optionId,
      sourceRef: term.sourceRef,
      selectionSourceRef: selectedOption?.term.sourceRef,
    });
    if (!selectedOption) return null;
    processedControlKeys.add(control.key);
    eligible = eligible.filter((alternative) => (
      (alternative.selectionTerms || []).some((item) => item.termId === control.termId && item.optionId === selectedOption.optionId)
    ));
    if (eligible.length === 0) return null;
  }

  if (!applyCommonCompiledRouterFilterStages({
    alternatives: eligible,
    appliedStageIndexes,
    plan: input.plan,
    state: input.state,
    postBuildFilters: input.postBuildFilters,
    trace: input.trace,
    budget: input.budget,
  })) {
    return null;
  }

  const selectedAlternative = eligible[0] || null;
  if (!selectedAlternative) return null;
  const remainingFilterStageIndexes = (selectedAlternative.filterStageIndexes || [])
    .filter((index) => !appliedStageIndexes.has(index));
  if (!applyCompiledRouterFilterStages({
    stages: resolveCompiledRouterFilterStages(input.plan, remainingFilterStageIndexes),
    planId: input.plan.id,
    state: input.state,
    postBuildFilters: input.postBuildFilters,
    trace: input.trace,
    budget: input.budget,
  })) {
    return null;
  }

  return {
    alternative: selectedAlternative,
    alternativeSnapshots,
    selectionSnapshots,
    fallbackStageSnapshots,
  };
}

function evaluateCompiledRouterAlternative(input: {
  bundle: CompiledRouterBundle;
  alternative: CompiledExecutionAlternative;
  plan: CompiledRouterPlan;
  entryNodeId: string;
  state: RouteRuntimeEvaluationState;
  postBuildFilters: RouteRuntimePostBuildFilters;
  trace: RouteRuntimeTrace;
}): RouteRuntimeSelection | null {
  const alternative = input.alternative;
  const terminal = alternative.terminal;
  if (terminal.kind === 'synthetic') {
    input.trace.path.push({
      nodeId: terminal.nodeId,
      nodeType: 'synthetic_endpoint',
      programId: input.plan.id,
      appliedFilters: [],
      decision: 'synthetic_response',
      selectedAlternativeId: alternative.alternativeId,
      sourceRef: alternativeSourceRef(alternative),
    });
    input.trace.terminalNodeId = terminal.nodeId;
    return {
      matchedEntryNodeId: input.entryNodeId,
      selectedEntryNodeId: input.entryNodeId,
      selectedExecutionAttempt: null,
      terminalNodeId: terminal.nodeId,
      terminalKind: 'synthetic_response',
      syntheticResponse: {
        statusCode: terminal.statusCode === 429 ? 429 : 503,
        message: terminal.message || 'No route is available.',
      },
      requestedModel: input.state.requestedModel,
      currentModel: input.state.currentModel,
      upstreamModel: input.state.upstreamModel || undefined,
      postBuildFilters: {
        ...input.postBuildFilters,
        endpointPreference: input.postBuildFilters.endpointPreference || input.state.endpointPreference,
      },
      trace: input.trace,
      selectedAlternativeId: alternative.alternativeId,
      metadata: runtimeMetadataSnapshot({
        bundle: input.bundle,
        plan: input.plan,
        alternative,
      }),
    };
  }

  const selectedExecutionAttempt = alternative.kind === 'execution_attempt'
    ? targetRefToRuntimeTarget(alternative.executionAttempt, alternative.endpoint, alternativeSourceRef(alternative))
    : null;
  const terminalModel = asTrimmedString(alternative.endpoint?.model);
  const selectedExecutionModel = selectedExecutionAttempt?.modelSource === 'request'
    ? (terminalModel || input.state.currentModel)
    : selectedExecutionAttempt?.model;
  const currentModel = input.state.currentModel;
  const terminalNodeId = alternative.endpoint?.nodeId || terminal.endpointId;
  input.trace.path.push({
    nodeId: terminalNodeId,
    nodeType: 'route_endpoint',
    programId: input.plan.id,
    appliedFilters: [],
    decision: 'selected_alternative',
    selectedAlternativeId: alternative.alternativeId,
    sourceRef: alternativeSourceRef(alternative),
  });
  input.trace.terminalNodeId = terminalNodeId;
  return {
    matchedEntryNodeId: input.entryNodeId,
    selectedEntryNodeId: input.entryNodeId,
    routeEndpointCompatibilityPolicy: isRecord(alternative.endpoint?.compatibilityPolicy)
      ? normalizeUpstreamCompatibilityPolicy(alternative.endpoint.compatibilityPolicy)
      : undefined,
    selectedExecutionAttempt,
    terminalNodeId,
    terminalKind: 'endpoint',
    requestedModel: input.state.requestedModel,
    currentModel,
    upstreamModel: input.state.upstreamModel || selectedExecutionModel || undefined,
    postBuildFilters: {
      ...input.postBuildFilters,
      endpointPreference: input.postBuildFilters.endpointPreference || input.state.endpointPreference,
    },
    trace: input.trace,
    selectedAlternativeId: alternative.alternativeId,
    metadata: runtimeMetadataSnapshot({
      bundle: input.bundle,
      plan: input.plan,
      alternative,
    }),
  };
}

export function evaluateCompiledRouterBundle(input: {
  bundle: CompiledRouterBundle;
  requestedModel: string;
  request?: CompiledRouteRuntimeRequest | null;
  maxHops?: number;
  stateStore?: Record<string, unknown>;
  failureOverlay?: RouteRuntimeFailureOverlay | null;
  selectionConstraint?: RouteRuntimeSelectionConstraint | null;
  random?: () => number;
}): RouteRuntimeSelection | null {
  const hydrated = hydrateCompiledRouterBundle(input.bundle);
  if (!hydrated) return null;
  const routeRequest = buildCompiledRouteRequestContext({
    requestedModel: input.requestedModel,
    request: input.request,
  });
  const matched = matchCompiledRouterBundle(hydrated, routeRequest.requestedModel);
  if (!matched) return null;
  const plan = matched.plan;
  const budget = {
    hops: 0,
    maxHops: Math.max(1, Math.trunc(input.maxHops || DEFAULT_ROUTE_GRAPH_MAX_HOPS)),
  };
  const state: RouteRuntimeEvaluationState = {
    requestedModel: routeRequest.requestedModel,
    currentModel: routeRequest.requestedModel,
    payload: routeRequest.payload,
    normalizedPayload: routeRequest.normalizedPayload,
    headers: routeRequest.headers,
    query: routeRequest.query,
    request: routeRequest.request,
    stateStore: buildRouteExecutionStateStore(undefined, input.failureOverlay),
    selectorStateStore: input.stateStore || {},
  };
  const postBuildFilters: RouteRuntimePostBuildFilters = { payload: [], headers: [] };
  const trace: RouteRuntimeTrace = {
    path: [{
      nodeId: matched.entryNodeId,
      nodeType: 'entry',
      programId: plan.id,
      exitedPortId: 'request.out',
      appliedFilters: [],
      decision: 'matched_entry',
      sourceRef: plan.sourceRef,
    }],
    edges: [],
    terminalNodeId: null,
  };
  const selected = selectCompiledExecutionAlternative({
    bundle: input.bundle,
    plan,
    state,
    postBuildFilters,
    trace,
    budget,
    failureOverlay: input.failureOverlay,
    selectionConstraint: input.selectionConstraint,
    random: input.random,
  });
  if (!selected) return null;
  if (!consumeCompiledRouterHop(budget)) return null;
  const selection = evaluateCompiledRouterAlternative({
    bundle: input.bundle,
    alternative: selected.alternative,
    plan,
    entryNodeId: matched.entryNodeId,
    state,
    postBuildFilters,
    trace,
  });
  if (!selection) return null;
  return {
    ...selection,
    compiledProgramSnapshot: plan,
    compiledPlanSnapshot: compiledRouterPlanSnapshot(plan, matched, selection, selected.alternative),
    selectionSnapshots: selected.selectionSnapshots,
    fallbackStageSnapshots: selected.fallbackStageSnapshots,
    alternativeSnapshots: mergeRuntimeAlternativeSnapshots(selected.alternativeSnapshots, selection.alternativeSnapshots),
  };
}

export function evaluateCompiledRuntimeArtifact(input: {
  graph: CompiledRouteGraph;
  requestedModel: string;
  request?: CompiledRouteRuntimeRequest | null;
  maxHops?: number;
  stateStore?: Record<string, unknown>;
  failureOverlay?: RouteRuntimeFailureOverlay | null;
  selectionConstraint?: RouteRuntimeSelectionConstraint | null;
  random?: () => number;
}): RouteRuntimeSelection | null {
  if (hasUsableCompiledRouterBundle(input.graph.compiledRouterBundle)) {
    const selection = evaluateCompiledRouterBundle({
      bundle: input.graph.compiledRouterBundle,
      requestedModel: input.requestedModel,
      request: input.request,
      maxHops: input.maxHops,
      stateStore: input.stateStore,
      failureOverlay: input.failureOverlay,
      selectionConstraint: input.selectionConstraint,
      random: input.random,
    });
    if (selection) return selection;
  }
  return null;
}

export function applyRouteRuntimePostBuildFilters(input: {
  payload: Record<string, unknown>;
  headers?: Record<string, string>;
  filters?: RouteRuntimePostBuildFilters | null;
}): {
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  endpointPreference?: 'chat' | 'messages' | 'responses';
} {
  return applyCompiledRuntimePostBuildFilters(input);
}
