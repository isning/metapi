import {
  type CompiledRouterBundle,
  type CompiledRouterPlan,
  type CompiledRouterSelectorGroup,
  type CompiledRouterTerminal,
  type CompiledRouterTerminalCandidate,
  type CompiledRouteGraph,
  type CompiledEndpointTarget,
  type CompiledRouterFilterStage,
  type RouteFilter,
  type RouteProgramSourceRef,
} from '../../shared/routeGraph.js';
import {
  matchesTokenRouteModelPattern,
  parseTokenRouteRegexPattern,
} from '../../shared/tokenRoutePatterns.js';
import {
  cloneJsonValue,
  deleteJsonPath,
  hasJsonPath,
  setJsonPath,
} from './jsonPathMutation.js';
import {
  normalizeUpstreamCompatibilityPolicy,
  type UpstreamCompatibilityPolicy,
} from '../contracts/upstreamCompatibilityPolicy.js';
import {
  getActiveRouteGraphRuntimeVersion,
  getCachedActiveRouteGraphRuntimeVersion,
} from './routeGraphService.js';
import {
  hydrateRuntimeSelectorPlan,
  selectRuntimeCandidate,
  type RuntimeSelectorCandidate,
} from './selectorEngine.js';

type RouteGraphRuntimeState = {
  requestedModel: string;
  currentModel: string;
  upstreamModel?: string;
  endpointPreference?: 'chat' | 'messages' | 'responses';
  headers: Record<string, string>;
  stateStore: Record<string, unknown>;
};

export type RouteGraphRuntimeFailureOverlay = {
  disabledCandidateIds?: string[];
  disabledEndpointIds?: string[];
  disabledTargetIds?: number[];
};

export type RouteGraphRuntimeTraceStep = {
  nodeId: string;
  nodeName?: string | null;
  nodeType: string;
  programId?: string;
  opId?: string;
  enteredPortId?: string;
  exitedPortId?: string;
  appliedFilters: string[];
  decision: 'matched_entry' | 'applied_filter' | 'dispatcher_selected_route' | 'dispatcher_selected_flow' | 'terminal' | 'synthetic_response';
  selectedCandidateId?: string;
  sourceRef?: RouteProgramSourceRef;
  candidateSourceRef?: RouteProgramSourceRef;
};

export type RouteGraphRuntimeTrace = {
  path: RouteGraphRuntimeTraceStep[];
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

export type RouteGraphPostBuildFilters = {
  payload: RouteFilter[];
  headers: RouteFilter[];
  endpointPreference?: 'chat' | 'messages' | 'responses';
};

export type RouteGraphRuntimeCandidateSnapshot = {
  candidateId: string;
  nodeId?: string | null;
  endpointId?: string | null;
  routeId: number | null;
  targetIds: number[];
  priority: number;
  weight: number;
  enabled: boolean;
  sourceRef?: RouteProgramSourceRef;
};

export type RouteGraphRuntimeSelection = {
  graphVersionId?: number | null;
  graphVersion?: number | null;
  matchedEntryNodeId: string;
  selectedEntryNodeId: string;
  matchedRouteId: number | null;
  selectedRouteId: number | null;
  routeEndpointCompatibilityPolicy?: UpstreamCompatibilityPolicy;
  selectedEndpointTarget: {
    endpointId: string;
    targetId: string;
    nodeId: string;
    model: string;
    modelSource?: 'fixed' | 'request';
    accountId?: number | string | null;
    tokenId?: number | string | null;
    siteId?: number | string | null;
    weight?: number | null;
    priority?: number | null;
    metadata?: Record<string, unknown>;
    compatibilityPolicy?: UpstreamCompatibilityPolicy;
    sourceRef: RouteProgramSourceRef;
  } | null;
  terminalNodeId: string | null;
  terminalKind: 'route_endpoint' | 'synthetic_endpoint';
  syntheticResponse?: {
    statusCode: 429 | 503;
    message: string;
  };
  requestedModel: string;
  currentModel: string;
  upstreamModel?: string;
  postBuildFilters: RouteGraphPostBuildFilters;
  trace: RouteGraphRuntimeTrace;
  candidateSnapshots?: RouteGraphRuntimeCandidateSnapshot[];
};

type DispatcherCandidate = RuntimeSelectorCandidate & {
  kind: 'route' | 'bidirect' | 'target';
};

export type HydratedCompiledRouterBundle = {
  bundle: CompiledRouterBundle;
  plans: CompiledRouterPlan[];
  planCache: Map<string, CompiledRouterPlan | null>;
  exact: Map<string, NonNullable<CompiledRouterBundle['matcher']['exact'][string]>>;
  normalizedExact: Map<string, NonNullable<CompiledRouterBundle['matcher']['normalizedExact'][string]>>;
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

function numberOrFallback(value: unknown, fallback: number): number {
  const normalized = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function normalizeFailureOverlay(value?: RouteGraphRuntimeFailureOverlay | null): Required<RouteGraphRuntimeFailureOverlay> {
  return {
    disabledCandidateIds: Array.from(new Set((value?.disabledCandidateIds || []).map(asTrimmedString).filter(Boolean))),
    disabledEndpointIds: Array.from(new Set((value?.disabledEndpointIds || []).map(asTrimmedString).filter(Boolean))),
    disabledTargetIds: Array.from(new Set((value?.disabledTargetIds || []).map((item) => Number(item)).filter((item) => Number.isSafeInteger(item) && item > 0))),
  };
}

function buildRouteExecutionStateStore(
  stateStore: Record<string, unknown> | undefined,
  failureOverlay?: RouteGraphRuntimeFailureOverlay | null,
): Record<string, unknown> {
  const target = stateStore || {};
  const normalized = normalizeFailureOverlay(failureOverlay);
  target.routeExecutionFailure = {
    disabledCandidateIds: normalized.disabledCandidateIds,
    disabledEndpointIds: normalized.disabledEndpointIds,
    disabledTargetIds: normalized.disabledTargetIds,
  };
  return target;
}

function runtimeTargetIdFromCompiledTargetId(value: unknown): string {
  const targetId = asTrimmedString(value);
  const match = /:target:\d+:(.+)$/.exec(targetId);
  return match?.[1] || targetId;
}

function isTargetDisabledByOverlay(targetId: unknown, overlay?: RouteGraphRuntimeFailureOverlay | null): boolean {
  const normalized = typeof targetId === 'number'
    ? targetId
    : typeof targetId === 'string' && targetId.trim()
      ? Number(targetId.trim())
      : NaN;
  return Number.isSafeInteger(normalized)
    && normalizeFailureOverlay(overlay).disabledTargetIds.includes(normalized);
}

function mergeRuntimeCandidateSnapshots(
  left?: RouteGraphRuntimeCandidateSnapshot[],
  right?: RouteGraphRuntimeCandidateSnapshot[],
): RouteGraphRuntimeCandidateSnapshot[] {
  const merged = new Map<string, RouteGraphRuntimeCandidateSnapshot>();
  for (const item of [...(left || []), ...(right || [])]) {
    merged.set(item.candidateId, item);
  }
  return Array.from(merged.values());
}

function endpointTargetForSelection(target: Record<string, unknown>): RouteGraphRuntimeSelection['selectedEndpointTarget'] {
  const modelSource = target.modelSource === 'request' ? 'request' : 'fixed';
  const sourceRef = isRecord(target.sourceRef) ? target.sourceRef as RouteProgramSourceRef : {};
  return {
    endpointId: asTrimmedString(target.endpointId) || asTrimmedString(sourceRef.endpointId),
    targetId: runtimeTargetIdFromCompiledTargetId(target.targetId),
    nodeId: asTrimmedString(target.nodeId),
    model: modelSource === 'request' ? '' : asTrimmedString(target.model),
    modelSource,
    accountId: target.accountId as number | string | null | undefined,
    tokenId: target.tokenId as number | string | null | undefined,
    siteId: target.siteId as number | string | null | undefined,
    weight: Number.isFinite(Number(target.weight)) ? Number(target.weight) : null,
    priority: Number.isFinite(Number(target.priority)) ? Number(target.priority) : null,
    metadata: isRecord(target.metadata) ? target.metadata : undefined,
    compatibilityPolicy: normalizeUpstreamCompatibilityPolicy(target.compatibilityPolicy),
    sourceRef,
  };
}

function filterMatchesOperationPhase(operation: RouteFilter, phase: 'pre_selection' | 'post_build'): boolean {
  if (operation.type === 'rewrite_model') return phase === 'pre_selection';
  return phase === 'post_build';
}

function applyPreSelectionFilter(state: RouteGraphRuntimeState, operation: RouteFilter): string | null {
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

function collectPostBuildFilter(target: RouteGraphPostBuildFilters, operation: RouteFilter): void {
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
  if (!isRecord(value) || value.version !== 2 || !isRecord(value.matcher) || !Array.isArray(value.plans)) {
    return false;
  }
  if (Array.isArray(value.diagnostics) && value.diagnostics.some((diagnostic) => (
    isRecord(diagnostic)
    && diagnostic.severity === 'error'
    && asTrimmedString(diagnostic.code).startsWith('compiled_router.')
  ))) {
    return false;
  }
  return value.plans.some((plan) => isRecord(plan) && Array.isArray(plan.candidates));
}

function hydrateCompiledRouterSelectorPlans(plan: CompiledRouterPlan): void {
  for (const level of plan.selectorLevels || []) {
    hydrateRuntimeSelectorPlan(isRecord(level.policy) ? level.policy : { strategy: 'weighted' });
  }
  for (const candidate of plan.candidates || []) {
    const terminal = candidate.terminal;
    if (terminal.kind === 'supply' && isRecord(terminal.targetSelectionPolicy)) {
      hydrateRuntimeSelectorPlan(terminal.targetSelectionPolicy);
    }
  }
}

export function hydrateCompiledRouterBundle(bundle: CompiledRouterBundle): HydratedCompiledRouterBundle | null {
  if (!hasUsableCompiledRouterBundle(bundle)) return null;
  const cached = hydratedCompiledRouterCache.get(bundle);
  if (cached) return cached;
  for (const plan of bundle.plans) {
    const planId = asTrimmedString(plan.id);
    if (!planId || !Array.isArray(plan.candidates)) return null;
  }
  const patterns = Array.isArray(bundle.matcher?.patterns) ? bundle.matcher.patterns : [];
  for (const pattern of patterns) {
    if (pattern.patternKind !== 'regex') continue;
    const parsed = parseTokenRouteRegexPattern(pattern.pattern);
    if (parsed.error) return null;
  }
  const hydrated: HydratedCompiledRouterBundle = {
    bundle,
    plans: bundle.plans,
    planCache: new Map(),
    exact: new Map(Object.entries(bundle.matcher?.exact || {})),
    normalizedExact: new Map(Object.entries(bundle.matcher?.normalizedExact || {})),
    patterns,
  };
  hydratedCompiledRouterCache.set(bundle, hydrated);
  return hydrated;
}

function findCompiledRouterPlanById(hydrated: HydratedCompiledRouterBundle, planId: string): CompiledRouterPlan | null {
  const normalizedPlanId = asTrimmedString(planId);
  if (!normalizedPlanId) return null;
  if (hydrated.planCache.has(normalizedPlanId)) return hydrated.planCache.get(normalizedPlanId) || null;
  const plan = hydrated.plans.find((candidate) => candidate.id === normalizedPlanId && candidate.enabled !== false) || null;
  if (plan) hydrateCompiledRouterSelectorPlans(plan);
  hydrated.planCache.set(normalizedPlanId, plan);
  return plan;
}

function matchCompiledRouterBundle(hydrated: HydratedCompiledRouterBundle, requestedModel: string): { plan: CompiledRouterPlan; entryNodeId: string; routeId: number | null } | null {
  const target = hydrated.exact.get(requestedModel)
    || hydrated.normalizedExact.get(requestedModel.toLowerCase())
    || hydrated.patterns.find((pattern) => matchesTokenRouteModelPattern(requestedModel, pattern.pattern));
  if (!target?.programId) return null;
  const plan = findCompiledRouterPlanById(hydrated, target.programId);
  if (!plan) return null;
  const routeId = Number(target.sourceRef?.routeId ?? plan.sourceRef?.routeId);
  return {
    plan,
    entryNodeId: target.entryNodeId || plan.entryNodeId,
    routeId: Number.isFinite(routeId) && routeId > 0 ? Math.trunc(routeId) : null,
  };
}

function targetRefToRuntimeTarget(target: CompiledEndpointTarget | null | undefined): RouteGraphRuntimeSelection['selectedEndpointTarget'] {
  if (!target) return null;
  return endpointTargetForSelection(target as unknown as Record<string, unknown>);
}

function selectCompiledRouterEndpointTarget(input: {
  plan: CompiledRouterPlan;
  terminal: Extract<CompiledRouterTerminal, { kind: 'supply' }>;
  state: RouteGraphRuntimeState;
  failureOverlay?: RouteGraphRuntimeFailureOverlay | null;
  random?: () => number;
}): RouteGraphRuntimeSelection['selectedEndpointTarget'] {
  const policy = isRecord(input.terminal.targetSelectionPolicy) ? input.terminal.targetSelectionPolicy : { strategy: 'weighted' };
  if (policy.strategy === 'defer_to_router') return null;
  const targets = resolveCompiledRouterTerminalTargets(input.plan, input.terminal)
    .filter((target) => target.enabled !== false && !isTargetDisabledByOverlay(target.targetId, input.failureOverlay));
  const candidates: DispatcherCandidate[] = targets.map((target, index) => {
    const metadata = {
      ...(isRecord(target.metadata) ? target.metadata : {}),
      targetId: target.targetId,
      model: target.model,
      modelSource: target.modelSource || 'fixed',
      accountId: target.accountId ?? null,
      tokenId: target.tokenId ?? null,
      siteId: target.siteId ?? null,
    };
    return {
      idx: index,
      kind: 'target',
      metadata,
      runtime: {},
      enabled: target.enabled !== false,
      weight: numberOrFallback(target.weight, 1),
      priority: numberOrFallback(target.priority, 0),
      score: numberOrFallback(target.weight, 1),
      order: index,
    };
  });
  const selected = selectRuntimeCandidate({
    selectorId: input.terminal.nodeId,
    policy,
    candidates,
    state: {
      requestedModel: input.state.requestedModel,
      currentModel: input.state.currentModel,
      upstreamModel: input.state.upstreamModel,
      endpointPreference: input.state.endpointPreference,
      stateStore: input.state.stateStore,
    },
    random: input.random,
  });
  if (!selected) return null;
  return targetRefToRuntimeTarget(targets[selected.idx]);
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

function resolveCompiledRouterTerminalTargets(
  plan: CompiledRouterPlan,
  terminal: Extract<CompiledRouterTerminal, { kind: 'supply' }>,
): CompiledEndpointTarget[] {
  const targets = Array.isArray(plan.targets) ? plan.targets : [];
  return (Array.isArray(terminal.targetIndexes) ? terminal.targetIndexes : [])
    .map((index) => targets[index])
    .filter((target): target is NonNullable<typeof target> => !!target)
    .map((target) => ({
      ...target,
      endpointId: asTrimmedString(target.endpointId) || terminal.endpointId,
      nodeId: asTrimmedString(target.nodeId) || terminal.nodeId,
      routeId: target.routeId ?? terminal.routeId,
      enabled: target.enabled !== false,
      modelSource: target.modelSource === 'request' ? 'request' : 'fixed',
      sourceRef: isRecord(target.sourceRef) ? target.sourceRef : terminal.sourceRef,
    } as CompiledEndpointTarget));
}

function compiledRouterTerminalDisabledByOverlay(
  plan: CompiledRouterPlan,
  terminal: CompiledRouterTerminal,
  overlay?: RouteGraphRuntimeFailureOverlay | null,
): boolean {
  const normalized = normalizeFailureOverlay(overlay);
  if (normalized.disabledEndpointIds.includes(terminal.nodeId)) return true;
  if (terminal.kind === 'synthetic') return false;
  const endpointIds = [
    terminal.endpointId,
    terminal.routeEndpointId,
    terminal.sourceRef?.endpointId,
    terminal.sourceRef?.nodeId,
  ].map(asTrimmedString).filter(Boolean);
  if (endpointIds.some((endpointId) => normalized.disabledEndpointIds.includes(endpointId))) return true;
  const targets = resolveCompiledRouterTerminalTargets(plan, terminal);
  return targets.length > 0 && targets.every((target) => isTargetDisabledByOverlay(target.targetId, overlay));
}

function compiledRouterCandidateDisabledByOverlay(
  plan: CompiledRouterPlan,
  candidate: CompiledRouterTerminalCandidate,
  overlay?: RouteGraphRuntimeFailureOverlay | null,
): boolean {
  const normalized = normalizeFailureOverlay(overlay);
  const candidateIds = [
    candidate.candidateId,
    candidate.terminal.nodeId,
    candidate.terminal.kind === 'supply' ? candidate.terminal.endpointId : null,
    candidate.terminal.kind === 'supply' ? candidate.terminal.routeEndpointId : null,
    candidate.terminal.sourceRef?.endpointId,
    candidate.terminal.sourceRef?.nodeId,
    ...candidate.selectorPath.map((item) => item.groupId),
  ].map(asTrimmedString).filter(Boolean);
  return candidateIds.some((candidateId) => normalized.disabledCandidateIds.includes(candidateId))
    || candidateIds.some((candidateId) => normalized.disabledEndpointIds.includes(candidateId))
    || compiledRouterTerminalDisabledByOverlay(plan, candidate.terminal, overlay);
}

function compiledRouterCandidateMatchesGroup(
  candidate: CompiledRouterTerminalCandidate,
  selectorId: string,
  groupId: string,
): boolean {
  return candidate.selectorPath.some((item) => item.selectorId === selectorId && item.groupId === groupId);
}

function compiledRouterGroupCandidate(
  group: CompiledRouterSelectorGroup,
  idx: number,
): DispatcherCandidate {
  const metadata = isRecord(group.metadata) ? group.metadata : {};
  const kind = group.kind === 'bidirect' || group.kind === 'target' ? group.kind : 'route';
  return {
    idx,
    kind,
    nodeId: group.nodeId,
    edgeId: group.edgeId,
    metadata,
    runtime: {},
    enabled: group.enabled !== false,
    weight: numberOrFallback(group.weight, 1),
    priority: numberOrFallback(group.priority, 0),
    score: numberOrFallback(group.weight, 1),
    order: Number.isFinite(Number(group.order)) ? Number(group.order) : idx,
  };
}

function compiledRouterCandidateRouteId(candidate: CompiledRouterTerminalCandidate): number | null {
  return candidate.terminal.kind === 'supply' ? candidate.terminal.routeId : null;
}

function compiledRouterCandidateTargetIds(
  plan: CompiledRouterPlan,
  candidate: CompiledRouterTerminalCandidate,
): number[] {
  if (candidate.terminal.kind !== 'supply') return [];
  return resolveCompiledRouterTerminalTargets(plan, candidate.terminal)
    .map((target) => Number(target.targetId))
    .filter((targetId) => Number.isSafeInteger(targetId) && targetId > 0);
}

function compiledRouterGroupSnapshot(
  group: CompiledRouterSelectorGroup,
  plan: CompiledRouterPlan,
): RouteGraphRuntimeCandidateSnapshot {
  const terminalCandidates = group.terminalCandidateIndexes
    .map((index) => plan.candidates[index])
    .filter((candidate): candidate is CompiledRouterTerminalCandidate => !!candidate);
  return {
    candidateId: group.groupId,
    nodeId: group.nodeId ?? null,
    endpointId: group.endpointId ?? group.sourceRef?.endpointId ?? null,
    routeId: terminalCandidates.map(compiledRouterCandidateRouteId).find((routeId) => routeId != null) ?? null,
    targetIds: Array.from(new Set(terminalCandidates.flatMap((candidate) => compiledRouterCandidateTargetIds(plan, candidate)))),
    priority: group.priority,
    weight: group.weight,
    enabled: group.enabled !== false,
    sourceRef: group.sourceRef,
  };
}

function consumeCompiledRouterHop(budget: { hops: number; maxHops: number }): boolean {
  budget.hops += 1;
  return budget.hops <= budget.maxHops;
}

function applyCompiledRouterFilterStages(input: {
  stages: CompiledRouterFilterStage[];
  planId: string;
  state: RouteGraphRuntimeState;
  postBuildFilters: RouteGraphPostBuildFilters;
  trace: RouteGraphRuntimeTrace;
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

function evaluateCompiledRouterTerminal(input: {
  terminal: CompiledRouterTerminal;
  plan: CompiledRouterPlan;
  entryNodeId: string;
  matchedRouteId: number | null;
  state: RouteGraphRuntimeState;
  postBuildFilters: RouteGraphPostBuildFilters;
  trace: RouteGraphRuntimeTrace;
  failureOverlay?: RouteGraphRuntimeFailureOverlay | null;
  random?: () => number;
}): RouteGraphRuntimeSelection | null {
  const terminal = input.terminal;
  if (compiledRouterTerminalDisabledByOverlay(input.plan, terminal, input.failureOverlay)) return null;
  if (terminal.kind === 'synthetic') {
    input.trace.path.push({
      nodeId: terminal.nodeId,
      nodeType: 'synthetic_endpoint',
      programId: input.plan.id,
      appliedFilters: [],
      decision: 'synthetic_response',
      sourceRef: terminal.sourceRef,
    });
    input.trace.terminalNodeId = terminal.nodeId;
    return {
      matchedEntryNodeId: input.entryNodeId,
      selectedEntryNodeId: terminal.nodeId,
      matchedRouteId: input.matchedRouteId,
      selectedRouteId: null,
      selectedEndpointTarget: null,
      terminalNodeId: terminal.nodeId,
      terminalKind: 'synthetic_endpoint',
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
    };
  }

  const selectedEndpointTarget = selectCompiledRouterEndpointTarget({
    plan: input.plan,
    terminal,
    state: input.state,
    failureOverlay: input.failureOverlay,
    random: input.random,
  });
  const terminalModel = asTrimmedString(terminal.terminalModel);
  const selectedTargetModel = selectedEndpointTarget?.modelSource === 'request'
    ? (terminalModel || input.state.currentModel)
    : selectedEndpointTarget?.model;
  const currentModel = selectedTargetModel || terminalModel || input.state.currentModel;
  input.trace.path.push({
    nodeId: terminal.nodeId,
    nodeType: 'route_endpoint',
    programId: input.plan.id,
    appliedFilters: [],
    decision: 'terminal',
    sourceRef: terminal.sourceRef,
  });
  input.trace.terminalNodeId = terminal.nodeId;
  return {
    matchedEntryNodeId: input.entryNodeId,
    selectedEntryNodeId: asTrimmedString(terminal.routeEndpointId) || terminal.nodeId,
    matchedRouteId: input.matchedRouteId,
    selectedRouteId: terminal.routeId,
    routeEndpointCompatibilityPolicy: isRecord(terminal.compatibilityPolicy)
      ? normalizeUpstreamCompatibilityPolicy(terminal.compatibilityPolicy)
      : undefined,
    selectedEndpointTarget,
    terminalNodeId: terminal.nodeId,
    terminalKind: 'route_endpoint',
    requestedModel: input.state.requestedModel,
    currentModel,
    upstreamModel: input.state.upstreamModel || selectedTargetModel || terminalModel || undefined,
    postBuildFilters: {
      ...input.postBuildFilters,
      endpointPreference: input.postBuildFilters.endpointPreference || input.state.endpointPreference,
    },
    trace: input.trace,
  };
}

export function evaluateCompiledRouterBundle(input: {
  bundle: CompiledRouterBundle;
  requestedModel: string;
  maxHops?: number;
  stateStore?: Record<string, unknown>;
  failureOverlay?: RouteGraphRuntimeFailureOverlay | null;
  random?: () => number;
}): RouteGraphRuntimeSelection | null {
  const hydrated = hydrateCompiledRouterBundle(input.bundle);
  if (!hydrated) return null;
  const matched = matchCompiledRouterBundle(hydrated, input.requestedModel);
  if (!matched) return null;
  const plan = matched.plan;
  const budget = {
    hops: 0,
    maxHops: Math.max(1, Math.trunc(input.maxHops || DEFAULT_ROUTE_GRAPH_MAX_HOPS)),
  };
  const state: RouteGraphRuntimeState = {
    requestedModel: input.requestedModel,
    currentModel: input.requestedModel,
    headers: {},
    stateStore: buildRouteExecutionStateStore(input.stateStore, input.failureOverlay),
  };
  const postBuildFilters: RouteGraphPostBuildFilters = { payload: [], headers: [] };
  const trace: RouteGraphRuntimeTrace = {
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
  const eligible = (plan.candidates || []).map((candidate) => (
    candidate.enabled !== false && !compiledRouterCandidateDisabledByOverlay(plan, candidate, input.failureOverlay)
  ));
  const candidateSnapshots: RouteGraphRuntimeCandidateSnapshot[] = [];

  for (const level of plan.selectorLevels || []) {
    const selectableGroups = (level.groups || []).filter((group) => (
      group.enabled !== false
      && group.terminalCandidateIndexes.some((index) => eligible[index] === true)
    ));
    if (selectableGroups.length === 0) continue;
    if (!applyCompiledRouterFilterStages({
      stages: resolveCompiledRouterFilterStages(plan, level.filterStageIndexes),
      planId: plan.id,
      state,
      postBuildFilters,
      trace,
      budget,
    })) {
      return null;
    }
    if (!consumeCompiledRouterHop(budget)) return null;
    const dispatcherCandidates = selectableGroups.map(compiledRouterGroupCandidate);
    const selected = selectRuntimeCandidate({
      selectorId: level.nodeId || level.selectorId,
      policy: isRecord(level.policy) ? level.policy : { strategy: 'weighted' },
      candidates: dispatcherCandidates,
      state: {
        requestedModel: state.requestedModel,
        currentModel: state.currentModel,
        upstreamModel: state.upstreamModel,
        endpointPreference: state.endpointPreference,
        stateStore: state.stateStore,
      },
      random: input.random,
    });
    const selectedGroup = selected ? selectableGroups[selected.idx] : undefined;
    trace.path.push({
      nodeId: level.nodeId || level.selectorId,
      nodeType: 'dispatcher',
      programId: plan.id,
      exitedPortId: selected ? (level.mode === 'flow' ? 'bidirect[1...].out' : 'route.in') : undefined,
      appliedFilters: [],
      decision: level.mode === 'flow' ? 'dispatcher_selected_flow' : 'dispatcher_selected_route',
      selectedCandidateId: selectedGroup?.groupId,
      sourceRef: level.sourceRef,
      candidateSourceRef: selectedGroup?.sourceRef,
    });
    candidateSnapshots.push(...selectableGroups.map((group) => compiledRouterGroupSnapshot(group, plan)));
    if (!selectedGroup) return null;
    for (let index = 0; index < eligible.length; index += 1) {
      if (!eligible[index]) continue;
      const candidate = plan.candidates[index];
      if (!candidate || !compiledRouterCandidateMatchesGroup(candidate, level.selectorId, selectedGroup.groupId)) {
        eligible[index] = false;
      }
    }
  }

  const selectedCandidateIndex = eligible.findIndex(Boolean);
  if (selectedCandidateIndex < 0) return null;
  const selectedCandidate = plan.candidates[selectedCandidateIndex];
  if (!selectedCandidate) return null;
  if (!applyCompiledRouterFilterStages({
    stages: resolveCompiledRouterFilterStages(plan, selectedCandidate.filterStageIndexes),
    planId: plan.id,
    state,
    postBuildFilters,
    trace,
    budget,
  })) {
    return null;
  }
  if (!consumeCompiledRouterHop(budget)) return null;
  const selection = evaluateCompiledRouterTerminal({
    terminal: selectedCandidate.terminal,
    plan,
    entryNodeId: matched.entryNodeId,
    matchedRouteId: matched.routeId,
    state,
    postBuildFilters,
    trace,
    failureOverlay: input.failureOverlay,
    random: input.random,
  });
  if (!selection) return null;
  return {
    ...selection,
    candidateSnapshots: mergeRuntimeCandidateSnapshots(candidateSnapshots, selection.candidateSnapshots),
  };
}

export function evaluateCompiledRouteGraph(input: {
  graph: CompiledRouteGraph;
  requestedModel: string;
  maxHops?: number;
  stateStore?: Record<string, unknown>;
  failureOverlay?: RouteGraphRuntimeFailureOverlay | null;
  random?: () => number;
}): RouteGraphRuntimeSelection | null {
  if (hasUsableCompiledRouterBundle(input.graph.compiledRouterBundle)) {
    const selection = evaluateCompiledRouterBundle({
      bundle: input.graph.compiledRouterBundle,
      requestedModel: input.requestedModel,
      maxHops: input.maxHops,
      stateStore: input.stateStore,
      failureOverlay: input.failureOverlay,
      random: input.random,
    });
    if (selection) return selection;
  }
  return null;
}

export async function evaluateActiveRouteGraphForModel(
  requestedModel: string,
  options: {
    failureOverlay?: RouteGraphRuntimeFailureOverlay | null;
  } = {},
): Promise<RouteGraphRuntimeSelection | null> {
  const cachedActive = getCachedActiveRouteGraphRuntimeVersion();
  const active = cachedActive === undefined ? await getActiveRouteGraphRuntimeVersion() : cachedActive;
  if (!active) return null;
  const selection = evaluateCompiledRouteGraph({
    graph: active.compiledGraph as CompiledRouteGraph,
    requestedModel,
    failureOverlay: options.failureOverlay,
  });
  return selection
    ? {
        ...selection,
        graphVersionId: active.id,
        graphVersion: active.version,
      }
    : null;
}

export function applyRouteGraphPostBuildFilters(input: {
  payload: Record<string, unknown>;
  headers?: Record<string, string>;
  filters?: RouteGraphPostBuildFilters | null;
}): {
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  endpointPreference?: 'chat' | 'messages' | 'responses';
} {
  const filters = input.filters || { payload: [], headers: [] };
  const outputPayload = cloneJsonValue(input.payload);
  const outputHeaders = { ...(input.headers || {}) };

  for (const operation of filters.payload) {
    if (operation.type === 'set_payload') {
      const path = asTrimmedString(operation.path);
      if (!path) continue;
      if (operation.mode !== 'override' && hasJsonPath(outputPayload, path)) continue;
      setJsonPath(outputPayload, path, operation.value);
    } else if (operation.type === 'remove_payload') {
      const path = asTrimmedString(operation.path);
      if (!path) continue;
      deleteJsonPath(outputPayload, path);
    }
  }

  for (const operation of filters.headers) {
    if (operation.type === 'set_header') {
      const name = asTrimmedString(operation.name).toLowerCase();
      if (!name) continue;
      if (operation.mode !== 'override' && outputHeaders[name] !== undefined) continue;
      outputHeaders[name] = String(operation.value ?? '');
    } else if (operation.type === 'remove_header') {
      const name = asTrimmedString(operation.name).toLowerCase();
      if (!name) continue;
      delete outputHeaders[name];
    }
  }

  return {
    payload: outputPayload,
    headers: outputHeaders,
    endpointPreference: filters.endpointPreference,
  };
}
