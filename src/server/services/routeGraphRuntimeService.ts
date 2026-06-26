import {
  type CompiledRouteGraph,
  type CompiledEndpointTarget,
  type RouteFilter,
  type RouteFlatCandidate,
  type RouteFlatDecision,
  type RouteFlatDispatchPlan,
  type RouteFlatFilterStage,
  type RouteFlatTerminal,
  type RouteProgram,
  type RouteProgramBundleV3,
  type RouteProgramBundleV4,
  type RouteProgramCandidate,
  type RouteProgramOp,
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

export type HydratedRouteProgramBundle = {
  bundle: RouteProgramBundleV3;
  programsById: Map<string, RouteProgram>;
  opsByProgramId: Map<string, Map<string, RouteProgramOp>>;
  exact: Map<string, NonNullable<RouteProgramBundleV3['matcher']['exact'][string]>>;
  normalizedExact: Map<string, NonNullable<RouteProgramBundleV3['matcher']['normalizedExact'][string]>>;
  patterns: RouteProgramBundleV3['matcher']['patterns'];
};

export type HydratedFlatRouteProgramBundle = {
  bundle: RouteProgramBundleV4;
  programsById: Map<string, RouteProgramBundleV4['programs'][number]>;
  exact: Map<string, NonNullable<RouteProgramBundleV4['matcher']['exact'][string]>>;
  normalizedExact: Map<string, NonNullable<RouteProgramBundleV4['matcher']['normalizedExact'][string]>>;
  patterns: RouteProgramBundleV4['matcher']['patterns'];
};

const DEFAULT_ROUTE_GRAPH_MAX_HOPS = 8;
const hydratedRouteProgramCache = new WeakMap<RouteProgramBundleV3, HydratedRouteProgramBundle>();
const hydratedFlatRouteProgramCache = new WeakMap<RouteProgramBundleV4, HydratedFlatRouteProgramBundle>();

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

function flatTerminalDisabledByOverlay(
  terminal: RouteFlatTerminal,
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
  const targets = Array.isArray(terminal.targets) ? terminal.targets : [];
  return targets.length > 0 && targets.every((target) => isTargetDisabledByOverlay(target.targetId, overlay));
}

function flatDecisionDisabledByOverlay(
  decision: RouteFlatDecision,
  overlay?: RouteGraphRuntimeFailureOverlay | null,
): boolean {
  if (decision.kind === 'terminal') return flatTerminalDisabledByOverlay(decision.terminal, overlay);
  const candidates = decision.dispatch.candidates || [];
  return candidates.length > 0 && candidates.every((candidate) => flatCandidateDisabledByOverlay(candidate, overlay));
}

function flatCandidateDisabledByOverlay(
  candidate: RouteFlatCandidate,
  overlay?: RouteGraphRuntimeFailureOverlay | null,
): boolean {
  const normalized = normalizeFailureOverlay(overlay);
  const candidateIds = [
    candidate.id,
    candidate.nodeId,
    candidate.edgeId,
    candidate.endpointId,
    candidate.sourceRef?.endpointId,
    candidate.sourceRef?.nodeId,
  ].map(asTrimmedString).filter(Boolean);
  return candidateIds.some((candidateId) => normalized.disabledCandidateIds.includes(candidateId))
    || candidateIds.some((candidateId) => normalized.disabledEndpointIds.includes(candidateId))
    || flatDecisionDisabledByOverlay(candidate.next, overlay);
}

function collectTargetIdsFromFlatDecision(decision: RouteFlatDecision): number[] {
  if (decision.kind === 'dispatch') {
    return Array.from(new Set((decision.dispatch.candidates || []).flatMap((candidate) => collectTargetIdsFromFlatDecision(candidate.next))));
  }
  const terminal = decision.terminal;
  if (terminal.kind !== 'supply') return [];
  return (terminal.targets || [])
    .map((target) => Number(target.targetId))
    .filter((targetId) => Number.isSafeInteger(targetId) && targetId > 0);
}

function routeIdFromFlatDecision(decision: RouteFlatDecision): number | null {
  if (decision.kind === 'terminal') {
    return decision.terminal.kind === 'supply' ? decision.terminal.routeId : null;
  }
  for (const candidate of decision.dispatch.candidates || []) {
    const routeId = routeIdFromFlatDecision(candidate.next);
    if (routeId != null) return routeId;
  }
  return null;
}

function flatCandidateSnapshot(candidate: RouteFlatCandidate): RouteGraphRuntimeCandidateSnapshot {
  return {
    candidateId: candidate.id,
    nodeId: candidate.nodeId ?? null,
    endpointId: candidate.endpointId ?? candidate.sourceRef?.endpointId ?? null,
    routeId: routeIdFromFlatDecision(candidate.next),
    targetIds: collectTargetIdsFromFlatDecision(candidate.next),
    priority: candidate.priority,
    weight: candidate.weight,
    enabled: candidate.enabled !== false,
    sourceRef: candidate.sourceRef,
  };
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

function hasUsableRouteProgramBundle(value: unknown): value is RouteProgramBundleV3 {
  if (!isRecord(value) || value.version !== 3 || !isRecord(value.matcher) || !Array.isArray(value.programs)) {
    return false;
  }
  if (Array.isArray(value.diagnostics) && value.diagnostics.some((diagnostic) => (
    isRecord(diagnostic)
    && diagnostic.severity === 'error'
    && asTrimmedString(diagnostic.code).startsWith('program.')
  ))) {
    return false;
  }
  return value.programs.some((program) => isRecord(program) && asTrimmedString(program.startOpId) && Array.isArray(program.ops));
}

function hasUsableFlatRouteProgramBundle(value: unknown): value is RouteProgramBundleV4 {
  if (!isRecord(value) || value.version !== 4 || !isRecord(value.matcher) || !Array.isArray(value.programs)) {
    return false;
  }
  if (Array.isArray(value.diagnostics) && value.diagnostics.some((diagnostic) => (
    isRecord(diagnostic)
    && diagnostic.severity === 'error'
    && (
      asTrimmedString(diagnostic.code).startsWith('program.')
      || asTrimmedString(diagnostic.code).startsWith('flat_program.')
    )
  ))) {
    return false;
  }
  return value.programs.some((program) => isRecord(program) && isRecord(program.start));
}

function hydrateRouteProgramSelectorPlans(program: RouteProgram): void {
  for (const op of program.ops || []) {
    if (op.op === 'dispatch') {
      hydrateRuntimeSelectorPlan(isRecord(op.policy) ? op.policy : { strategy: 'weighted' });
      continue;
    }
    if (op.op === 'select_supply' && isRecord(op.targetSelectionPolicy)) {
      hydrateRuntimeSelectorPlan(op.targetSelectionPolicy);
    }
  }
}

function hydrateFlatDecisionSelectorPlans(decision: RouteFlatDecision | null | undefined): void {
  if (!decision) return;
  if (decision.kind === 'dispatch') {
    hydrateRuntimeSelectorPlan(isRecord(decision.dispatch.policy) ? decision.dispatch.policy : { strategy: 'weighted' });
    for (const candidate of decision.dispatch.candidates || []) {
      hydrateFlatDecisionSelectorPlans(candidate.next);
    }
    return;
  }
  if (decision.terminal.kind === 'supply' && isRecord(decision.terminal.targetSelectionPolicy)) {
    hydrateRuntimeSelectorPlan(decision.terminal.targetSelectionPolicy);
  }
}

export function hydrateRouteProgramBundle(bundle: RouteProgramBundleV3): HydratedRouteProgramBundle | null {
  if (!hasUsableRouteProgramBundle(bundle)) return null;
  const cached = hydratedRouteProgramCache.get(bundle);
  if (cached) return cached;
  const programsById = new Map<string, RouteProgram>();
  const opsByProgramId = new Map<string, Map<string, RouteProgramOp>>();
  for (const program of bundle.programs) {
    const programId = asTrimmedString(program.id);
    const startOpId = asTrimmedString(program.startOpId);
    if (!programId || !startOpId || !Array.isArray(program.ops)) return null;
    const opsById = new Map((program.ops || []).map((op) => [op.id, op]));
    if (!opsById.has(startOpId)) return null;
    hydrateRouteProgramSelectorPlans(program);
    programsById.set(program.id, program);
    opsByProgramId.set(program.id, opsById);
  }
  const patterns = Array.isArray(bundle.matcher?.patterns) ? bundle.matcher.patterns : [];
  for (const pattern of patterns) {
    if (pattern.patternKind !== 'regex') continue;
    const parsed = parseTokenRouteRegexPattern(pattern.pattern);
    if (parsed.error) return null;
  }
  const hydrated: HydratedRouteProgramBundle = {
    bundle,
    programsById,
    opsByProgramId,
    exact: new Map(Object.entries(bundle.matcher?.exact || {})),
    normalizedExact: new Map(Object.entries(bundle.matcher?.normalizedExact || {})),
    patterns,
  };
  hydratedRouteProgramCache.set(bundle, hydrated);
  return hydrated;
}

export function hydrateFlatRouteProgramBundle(bundle: RouteProgramBundleV4): HydratedFlatRouteProgramBundle | null {
  if (!hasUsableFlatRouteProgramBundle(bundle)) return null;
  const cached = hydratedFlatRouteProgramCache.get(bundle);
  if (cached) return cached;
  const programsById = new Map<string, RouteProgramBundleV4['programs'][number]>();
  for (const program of bundle.programs) {
    const programId = asTrimmedString(program.id);
    if (!programId || !isRecord(program.start)) return null;
    hydrateFlatDecisionSelectorPlans(program.start);
    programsById.set(programId, program);
  }
  const patterns = Array.isArray(bundle.matcher?.patterns) ? bundle.matcher.patterns : [];
  for (const pattern of patterns) {
    if (pattern.patternKind !== 'regex') continue;
    const parsed = parseTokenRouteRegexPattern(pattern.pattern);
    if (parsed.error) return null;
  }
  const hydrated: HydratedFlatRouteProgramBundle = {
    bundle,
    programsById,
    exact: new Map(Object.entries(bundle.matcher?.exact || {})),
    normalizedExact: new Map(Object.entries(bundle.matcher?.normalizedExact || {})),
    patterns,
  };
  hydratedFlatRouteProgramCache.set(bundle, hydrated);
  return hydrated;
}

function matchRouteProgramBundle(hydrated: HydratedRouteProgramBundle, requestedModel: string): { program: RouteProgram; entryNodeId: string; routeId: number | null } | null {
  const target = hydrated.exact.get(requestedModel)
    || hydrated.normalizedExact.get(requestedModel.toLowerCase())
    || hydrated.patterns.find((pattern) => matchesTokenRouteModelPattern(requestedModel, pattern.pattern));
  if (!target?.programId) return null;
  const program = hydrated.programsById.get(target.programId);
  if (!program || program.enabled === false) return null;
  const routeId = Number(target.sourceRef?.routeId ?? program.sourceRef?.routeId);
  return {
    program,
    entryNodeId: target.entryNodeId || program.entryNodeId,
    routeId: Number.isFinite(routeId) && routeId > 0 ? Math.trunc(routeId) : null,
  };
}

function matchFlatRouteProgramBundle(hydrated: HydratedFlatRouteProgramBundle, requestedModel: string): { program: RouteProgramBundleV4['programs'][number]; entryNodeId: string; routeId: number | null } | null {
  const target = hydrated.exact.get(requestedModel)
    || hydrated.normalizedExact.get(requestedModel.toLowerCase())
    || hydrated.patterns.find((pattern) => matchesTokenRouteModelPattern(requestedModel, pattern.pattern));
  if (!target?.programId) return null;
  const program = hydrated.programsById.get(target.programId);
  if (!program || program.enabled === false) return null;
  const routeId = Number(target.sourceRef?.routeId ?? program.sourceRef?.routeId);
  return {
    program,
    entryNodeId: target.entryNodeId || program.entryNodeId,
    routeId: Number.isFinite(routeId) && routeId > 0 ? Math.trunc(routeId) : null,
  };
}

function dispatcherCandidateFromProgramCandidate(candidate: RouteProgramCandidate, index: number, mode: 'route' | 'flow' | 'target'): DispatcherCandidate {
  const metadata = isRecord(candidate.metadata) ? candidate.metadata : {};
  return {
    idx: index,
    kind: mode === 'flow' ? 'bidirect' : (mode === 'target' ? 'target' : 'route'),
    nodeId: candidate.nodeId,
    edgeId: candidate.edgeId,
    metadata,
    runtime: {},
    enabled: candidate.enabled !== false,
    weight: numberOrFallback(candidate.weight, 1),
    priority: numberOrFallback(candidate.priority, 0),
    score: numberOrFallback(candidate.weight, 1),
    order: index,
  };
}

function dispatcherCandidateFromFlatCandidate(candidate: RouteFlatCandidate, index: number): DispatcherCandidate {
  const metadata = isRecord(candidate.metadata) ? candidate.metadata : {};
  return {
    idx: index,
    kind: candidate.kind,
    nodeId: candidate.nodeId,
    edgeId: candidate.edgeId,
    metadata,
    runtime: {},
    enabled: candidate.enabled !== false,
    weight: numberOrFallback(candidate.weight, 1),
    priority: numberOrFallback(candidate.priority, 0),
    score: numberOrFallback(candidate.weight, 1),
    order: Number.isFinite(Number(candidate.order)) ? Number(candidate.order) : index,
  };
}

function targetRefToRuntimeTarget(target: CompiledEndpointTarget | null | undefined): RouteGraphRuntimeSelection['selectedEndpointTarget'] {
  if (!target) return null;
  return endpointTargetForSelection(target as unknown as Record<string, unknown>);
}

function selectProgramEndpointTarget(input: {
  op: Extract<RouteProgramOp, { op: 'select_supply' }>;
  state: RouteGraphRuntimeState;
}): RouteGraphRuntimeSelection['selectedEndpointTarget'] {
  const policy = isRecord(input.op.targetSelectionPolicy) ? input.op.targetSelectionPolicy : { strategy: 'weighted' };
  if (policy.strategy === 'defer_to_router') return null;
  const targets = Array.isArray(input.op.targets) ? input.op.targets : [];
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
    selectorId: input.op.nodeId,
    policy,
    candidates,
    state: {
      requestedModel: input.state.requestedModel,
      currentModel: input.state.currentModel,
      upstreamModel: input.state.upstreamModel,
      endpointPreference: input.state.endpointPreference,
      stateStore: input.state.stateStore,
    },
  });
  if (!selected) return null;
  return targetRefToRuntimeTarget(targets[selected.idx]);
}

function selectFlatEndpointTarget(input: {
  terminal: Extract<RouteFlatTerminal, { kind: 'supply' }>;
  state: RouteGraphRuntimeState;
  failureOverlay?: RouteGraphRuntimeFailureOverlay | null;
}): RouteGraphRuntimeSelection['selectedEndpointTarget'] {
  const policy = isRecord(input.terminal.targetSelectionPolicy) ? input.terminal.targetSelectionPolicy : { strategy: 'weighted' };
  if (policy.strategy === 'defer_to_router') return null;
  const targets = (Array.isArray(input.terminal.targets) ? input.terminal.targets : [])
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
  });
  if (!selected) return null;
  return targetRefToRuntimeTarget(targets[selected.idx]);
}

function consumeFlatHop(budget: { hops: number; maxHops: number }): boolean {
  budget.hops += 1;
  return budget.hops <= budget.maxHops;
}

function applyFlatFilterStages(input: {
  stages: RouteFlatFilterStage[];
  programId: string;
  state: RouteGraphRuntimeState;
  postBuildFilters: RouteGraphPostBuildFilters;
  trace: RouteGraphRuntimeTrace;
  budget: { hops: number; maxHops: number };
}): boolean {
  for (const stage of input.stages || []) {
    if (!consumeFlatHop(input.budget)) return false;
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
      programId: input.programId,
      enteredPortId: stage.phase === 'pre_selection' ? 'bidirect.in' : undefined,
      exitedPortId: 'bidirect.out',
      appliedFilters,
      decision: 'applied_filter',
      sourceRef: stage.sourceRef,
    });
  }
  return true;
}

function evaluateFlatTerminal(input: {
  terminal: RouteFlatTerminal;
  program: RouteProgramBundleV4['programs'][number];
  entryNodeId: string;
  matchedRouteId: number | null;
  state: RouteGraphRuntimeState;
  postBuildFilters: RouteGraphPostBuildFilters;
  trace: RouteGraphRuntimeTrace;
  budget: { hops: number; maxHops: number };
  failureOverlay?: RouteGraphRuntimeFailureOverlay | null;
}): RouteGraphRuntimeSelection | null {
  if (!consumeFlatHop(input.budget)) return null;
  const terminal = input.terminal;
  if (flatTerminalDisabledByOverlay(terminal, input.failureOverlay)) return null;
  if (terminal.kind === 'synthetic') {
    input.trace.path.push({
      nodeId: terminal.nodeId,
      nodeType: 'synthetic_endpoint',
      programId: input.program.id,
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

  const selectedEndpointTarget = selectFlatEndpointTarget({ terminal, state: input.state, failureOverlay: input.failureOverlay });
  const terminalModel = asTrimmedString(terminal.terminalModel);
  const selectedTargetModel = selectedEndpointTarget?.modelSource === 'request'
    ? (terminalModel || input.state.currentModel)
    : selectedEndpointTarget?.model;
  const currentModel = selectedTargetModel || terminalModel || input.state.currentModel;
  input.trace.path.push({
    nodeId: terminal.nodeId,
    nodeType: 'route_endpoint',
    programId: input.program.id,
    appliedFilters: [],
    decision: 'terminal',
    sourceRef: terminal.sourceRef,
  });
  input.trace.terminalNodeId = terminal.nodeId;
  return {
    matchedEntryNodeId: input.entryNodeId,
    selectedEntryNodeId: asTrimmedString(terminal.routeEndpointId) || (terminal.routeId ? `entry:legacy:${terminal.routeId}` : terminal.nodeId),
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

function evaluateFlatDecision(input: {
  decision: RouteFlatDecision;
  program: RouteProgramBundleV4['programs'][number];
  entryNodeId: string;
  matchedRouteId: number | null;
  state: RouteGraphRuntimeState;
  postBuildFilters: RouteGraphPostBuildFilters;
  trace: RouteGraphRuntimeTrace;
  budget: { hops: number; maxHops: number };
  failureOverlay?: RouteGraphRuntimeFailureOverlay | null;
}): RouteGraphRuntimeSelection | null {
  if (!applyFlatFilterStages({
    stages: input.decision.filterStages || [],
    programId: input.program.id,
    state: input.state,
    postBuildFilters: input.postBuildFilters,
    trace: input.trace,
    budget: input.budget,
  })) {
    return null;
  }

  if (input.decision.kind === 'terminal') {
    return evaluateFlatTerminal({
      terminal: input.decision.terminal,
      program: input.program,
      entryNodeId: input.entryNodeId,
      matchedRouteId: input.matchedRouteId,
      state: input.state,
      postBuildFilters: input.postBuildFilters,
      trace: input.trace,
      budget: input.budget,
      failureOverlay: input.failureOverlay,
    });
  }

  if (!consumeFlatHop(input.budget)) return null;
  const dispatch: RouteFlatDispatchPlan = input.decision.dispatch;
  const selectableFlatCandidates = (dispatch.candidates || [])
    .filter((candidate) => candidate.enabled !== false && !flatCandidateDisabledByOverlay(candidate, input.failureOverlay));
  const candidates = selectableFlatCandidates.map(dispatcherCandidateFromFlatCandidate);
  const selected = selectRuntimeCandidate({
    selectorId: dispatch.nodeId,
    policy: isRecord(dispatch.policy) ? dispatch.policy : { strategy: 'weighted' },
    candidates,
    state: {
      requestedModel: input.state.requestedModel,
      currentModel: input.state.currentModel,
      upstreamModel: input.state.upstreamModel,
      endpointPreference: input.state.endpointPreference,
      stateStore: input.state.stateStore,
    },
  });
  const selectedFlatCandidate = selected ? selectableFlatCandidates[selected.idx] : undefined;
  input.trace.path.push({
    nodeId: dispatch.nodeId,
    nodeType: 'dispatcher',
    programId: input.program.id,
    exitedPortId: selected ? (dispatch.mode === 'flow' ? 'bidirect[1...].out' : 'route.in') : undefined,
    appliedFilters: [],
    decision: dispatch.mode === 'flow' ? 'dispatcher_selected_flow' : 'dispatcher_selected_route',
    selectedCandidateId: selectedFlatCandidate?.id,
    sourceRef: dispatch.sourceRef,
    candidateSourceRef: selectedFlatCandidate?.sourceRef,
  });
  if (!selectedFlatCandidate) return null;
  const childSelection = evaluateFlatDecision({
    ...input,
    decision: selectedFlatCandidate.next,
    failureOverlay: input.failureOverlay,
  });
  if (!childSelection) return null;
  return {
    ...childSelection,
    candidateSnapshots: mergeRuntimeCandidateSnapshots(
      selectableFlatCandidates.map(flatCandidateSnapshot),
      childSelection.candidateSnapshots,
    ),
  };
}

export function evaluateFlatRouteProgramBundle(input: {
  bundle: RouteProgramBundleV4;
  requestedModel: string;
  maxHops?: number;
  stateStore?: Record<string, unknown>;
  failureOverlay?: RouteGraphRuntimeFailureOverlay | null;
}): RouteGraphRuntimeSelection | null {
  const hydrated = hydrateFlatRouteProgramBundle(input.bundle);
  if (!hydrated) return null;
  const matched = matchFlatRouteProgramBundle(hydrated, input.requestedModel);
  if (!matched || !matched.program.start) return null;
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
      programId: matched.program.id,
      exitedPortId: 'request.out',
      appliedFilters: [],
      decision: 'matched_entry',
      sourceRef: matched.program.sourceRef,
    }],
    edges: [],
    terminalNodeId: null,
  };
  return evaluateFlatDecision({
    decision: matched.program.start,
    program: matched.program,
    entryNodeId: matched.entryNodeId,
    matchedRouteId: matched.routeId,
    state,
    postBuildFilters,
    trace,
    budget: {
      hops: 0,
      maxHops: Math.max(1, Math.trunc(input.maxHops || DEFAULT_ROUTE_GRAPH_MAX_HOPS)),
    },
    failureOverlay: input.failureOverlay,
  });
}

function evaluateRouteProgram(input: {
  program: RouteProgram;
  opsById: Map<string, RouteProgramOp>;
  entryNodeId: string;
  matchedRouteId: number | null;
  requestedModel: string;
  maxHops: number;
  stateStore: Record<string, unknown>;
}): RouteGraphRuntimeSelection | null {
  let opId = asTrimmedString(input.program.startOpId);
  if (!opId) return null;
  const state: RouteGraphRuntimeState = {
    requestedModel: input.requestedModel,
    currentModel: input.requestedModel,
    headers: {},
    stateStore: input.stateStore,
  };
  let postBuildFilters: RouteGraphPostBuildFilters = { payload: [], headers: [] };
  const trace: RouteGraphRuntimeTrace = {
    path: [{
      nodeId: input.entryNodeId,
      nodeType: 'entry',
      programId: input.program.id,
      exitedPortId: 'request.out',
      appliedFilters: [],
      decision: 'matched_entry',
      sourceRef: input.program.sourceRef,
    }],
    edges: [],
    terminalNodeId: null,
  };
  const visited = new Set<string>();
  let hops = 0;
  while (opId && hops <= input.maxHops) {
    if (visited.has(opId)) return null;
    visited.add(opId);
    hops += 1;
    if (hops > input.maxHops) return null;
    const op = input.opsById.get(opId);
    if (!op) return null;

    if (op.op === 'filter') {
      const appliedFilters: string[] = [];
      for (const operation of op.operations || []) {
        if (op.phase === 'pre_selection' && filterMatchesOperationPhase(operation, 'pre_selection')) {
          const applied = applyPreSelectionFilter(state, operation);
          if (applied) appliedFilters.push(applied);
        } else if (op.phase === 'post_build' && filterMatchesOperationPhase(operation, 'post_build')) {
          collectPostBuildFilter(postBuildFilters, operation);
          appliedFilters.push(operation.type);
        }
      }
      trace.path.push({
        nodeId: op.nodeId,
        nodeType: 'filter',
        programId: input.program.id,
        opId: op.id,
        enteredPortId: op.phase === 'pre_selection' ? 'bidirect.in' : undefined,
        exitedPortId: op.nextOpId ? 'bidirect.out' : undefined,
        appliedFilters,
        decision: 'applied_filter',
        sourceRef: op.sourceRef,
      });
      opId = asTrimmedString(op.nextOpId);
      continue;
    }

    if (op.op === 'dispatch') {
      const candidates = (op.candidates || []).map((candidate, index) => dispatcherCandidateFromProgramCandidate(candidate, index, op.mode));
      const selected = selectRuntimeCandidate({
        selectorId: op.nodeId,
        policy: op.policy,
        candidates,
        state: {
          requestedModel: state.requestedModel,
          currentModel: state.currentModel,
          upstreamModel: state.upstreamModel,
          endpointPreference: state.endpointPreference,
          stateStore: state.stateStore,
        },
      });
      const selectedProgramCandidate = selected ? op.candidates[selected.idx] : undefined;
      trace.path.push({
        nodeId: op.nodeId,
        nodeType: 'dispatcher',
        programId: input.program.id,
        opId: op.id,
        exitedPortId: selected ? (op.mode === 'flow' ? 'bidirect[1...].out' : 'route.in') : undefined,
        appliedFilters: [],
        decision: op.mode === 'flow' ? 'dispatcher_selected_flow' : 'dispatcher_selected_route',
        selectedCandidateId: selectedProgramCandidate?.id,
        sourceRef: op.sourceRef,
        candidateSourceRef: selectedProgramCandidate?.sourceRef,
      });
      if (!selected) return null;
      opId = asTrimmedString(selectedProgramCandidate?.targetOpId);
      continue;
    }

    if (op.op === 'call_product') {
      trace.path.push({
        nodeId: op.sourceRef.nodeId || op.endpointId,
        nodeType: 'route_endpoint',
        programId: input.program.id,
        opId: op.id,
        exitedPortId: op.nextOpId ? 'route.out' : undefined,
        appliedFilters: [],
        decision: 'dispatcher_selected_route',
        sourceRef: op.sourceRef,
      });
      opId = asTrimmedString(op.nextOpId);
      continue;
    }

    if (op.op === 'synthetic') {
      const statusCode = op.statusCode === 429 ? 429 : 503;
      trace.path.push({
        nodeId: op.nodeId,
        nodeType: 'synthetic_endpoint',
        programId: input.program.id,
        opId: op.id,
        appliedFilters: [],
        decision: 'synthetic_response',
        sourceRef: op.sourceRef,
      });
      trace.terminalNodeId = op.nodeId;
      return {
        matchedEntryNodeId: input.entryNodeId,
        selectedEntryNodeId: op.nodeId,
        matchedRouteId: input.matchedRouteId,
        selectedRouteId: null,
        selectedEndpointTarget: null,
        terminalNodeId: op.nodeId,
        terminalKind: 'synthetic_endpoint',
        syntheticResponse: {
          statusCode,
          message: op.message || 'No route is available.',
        },
        requestedModel: state.requestedModel,
        currentModel: state.currentModel,
        upstreamModel: state.upstreamModel || undefined,
        postBuildFilters: {
          ...postBuildFilters,
          endpointPreference: postBuildFilters.endpointPreference || state.endpointPreference,
        },
        trace,
      };
    }

    if (op.op === 'select_supply') {
      const selectedEndpointTarget = selectProgramEndpointTarget({ op, state });
      const terminalModel = asTrimmedString(op.terminalModel);
      const selectedTargetModel = selectedEndpointTarget?.modelSource === 'request'
        ? (terminalModel || state.currentModel)
        : selectedEndpointTarget?.model;
      const currentModel = selectedTargetModel || terminalModel || state.currentModel;
      trace.path.push({
        nodeId: op.nodeId,
        nodeType: 'route_endpoint',
        programId: input.program.id,
        opId: op.id,
        appliedFilters: [],
        decision: 'terminal',
        sourceRef: op.sourceRef,
      });
      trace.terminalNodeId = op.nodeId;
      return {
        matchedEntryNodeId: input.entryNodeId,
        selectedEntryNodeId: asTrimmedString(op.routeEndpointId) || (op.routeId ? `entry:legacy:${op.routeId}` : op.nodeId),
        matchedRouteId: input.matchedRouteId,
        selectedRouteId: op.routeId,
        routeEndpointCompatibilityPolicy: isRecord(op.compatibilityPolicy)
          ? normalizeUpstreamCompatibilityPolicy(op.compatibilityPolicy)
          : undefined,
        selectedEndpointTarget,
        terminalNodeId: op.nodeId,
        terminalKind: 'route_endpoint',
        requestedModel: state.requestedModel,
        currentModel,
        upstreamModel: state.upstreamModel || selectedTargetModel || terminalModel || undefined,
        postBuildFilters: {
          ...postBuildFilters,
          endpointPreference: postBuildFilters.endpointPreference || state.endpointPreference,
        },
        trace,
      };
    }
  }
  return null;
}

export function evaluateRouteProgramBundle(input: {
  bundle: RouteProgramBundleV3;
  requestedModel: string;
  maxHops?: number;
  stateStore?: Record<string, unknown>;
}): RouteGraphRuntimeSelection | null {
  const hydrated = hydrateRouteProgramBundle(input.bundle);
  if (!hydrated) return null;
  const matched = matchRouteProgramBundle(hydrated, input.requestedModel);
  if (!matched) return null;
  const opsById = hydrated.opsByProgramId.get(matched.program.id);
  if (!opsById) return null;
  return evaluateRouteProgram({
    program: matched.program,
    opsById,
    entryNodeId: matched.entryNodeId,
    matchedRouteId: matched.routeId,
    requestedModel: input.requestedModel,
    maxHops: Math.max(1, Math.trunc(input.maxHops || DEFAULT_ROUTE_GRAPH_MAX_HOPS)),
    stateStore: input.stateStore || {},
  });
}

export function evaluateCompiledRouteGraph(input: {
  graph: CompiledRouteGraph;
  requestedModel: string;
  maxHops?: number;
  stateStore?: Record<string, unknown>;
  failureOverlay?: RouteGraphRuntimeFailureOverlay | null;
}): RouteGraphRuntimeSelection | null {
  if (hasUsableFlatRouteProgramBundle(input.graph.flatProgramBundle)) {
    return evaluateFlatRouteProgramBundle({
      bundle: input.graph.flatProgramBundle,
      requestedModel: input.requestedModel,
      maxHops: input.maxHops,
      stateStore: input.stateStore,
      failureOverlay: input.failureOverlay,
    });
  }
  return null;
}

export async function evaluateActiveRouteGraphForModel(
  requestedModel: string,
  options: {
    failureOverlay?: RouteGraphRuntimeFailureOverlay | null;
  } = {},
): Promise<RouteGraphRuntimeSelection | null> {
  const { ensureActiveRouteGraphVersion } = await import('./routeGraphService.js');
  const active = await ensureActiveRouteGraphVersion();
  const selection = evaluateCompiledRouteGraph({
    graph: active.compiledGraph,
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
