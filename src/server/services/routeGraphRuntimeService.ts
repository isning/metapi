import { run as runCel } from '@bufbuild/cel';
import {
  type CompiledRouteGraph,
  type CompiledEndpointTarget,
  type RouteFilter,
  type RouteGraphNode,
  type RouteProgram,
  type RouteProgramBundleV3,
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
  deletePayloadPath,
  hasPayloadPath,
  setPayloadPath,
} from './payloadRules.js';
import {
  normalizeUpstreamCompatibilityPolicy,
  type UpstreamCompatibilityPolicy,
} from '../contracts/upstreamCompatibilityPolicy.js';

type RouteGraphRuntimeState = {
  requestedModel: string;
  currentModel: string;
  upstreamModel?: string;
  endpointPreference?: 'chat' | 'messages' | 'responses';
  headers: Record<string, string>;
  stateStore: Record<string, unknown>;
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

export type RouteGraphRuntimeSelection = {
  matchedEntryNodeId: string;
  selectedEntryNodeId: string;
  matchedRouteId: number | null;
  selectedRouteId: number | null;
  modelEndpointCompatibilityPolicy?: UpstreamCompatibilityPolicy;
  selectedEndpointTarget: {
    channelId: string;
    model: string;
    modelSource?: 'fixed' | 'request';
    accountId?: number | string | null;
    tokenId?: number | string | null;
    siteId?: number | string | null;
    weight?: number | null;
    priority?: number | null;
    metadata?: Record<string, unknown>;
    compatibilityPolicy?: UpstreamCompatibilityPolicy;
  } | null;
  terminalNodeId: string | null;
  terminalKind: 'model_endpoint' | 'synthetic_endpoint';
  syntheticResponse?: {
    statusCode: 429 | 503;
    message: string;
  };
  requestedModel: string;
  currentModel: string;
  upstreamModel?: string;
  postBuildFilters: RouteGraphPostBuildFilters;
  trace: RouteGraphRuntimeTrace;
};

type DispatcherCandidate = {
  idx: number;
  kind: 'route' | 'bidirect' | 'target';
  nodeId?: string;
  edgeId?: string;
  metadata: Record<string, unknown>;
  runtime: Record<string, unknown>;
  enabled: boolean;
  weight: number;
  priority: number;
  score: number;
  order: number;
};

export type HydratedRouteProgramBundle = {
  bundle: RouteProgramBundleV3;
  programsById: Map<string, RouteProgram>;
  opsByProgramId: Map<string, Map<string, RouteProgramOp>>;
  exact: Map<string, NonNullable<RouteProgramBundleV3['matcher']['exact'][string]>>;
  normalizedExact: Map<string, NonNullable<RouteProgramBundleV3['matcher']['normalizedExact'][string]>>;
  patterns: RouteProgramBundleV3['matcher']['patterns'];
};

const DEFAULT_ROUTE_GRAPH_MAX_HOPS = 8;
const hydratedRouteProgramCache = new WeakMap<RouteProgramBundleV3, HydratedRouteProgramBundle>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function celValueToPlain(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(celValueToPlain);
  if (!value || typeof value !== 'object') return value;
  const maybeCelCollection = value as {
    entries?: () => Iterable<[unknown, unknown]>;
    values?: () => Iterable<unknown>;
  };
  if (typeof maybeCelCollection.entries === 'function') {
    return Object.fromEntries(Array.from(maybeCelCollection.entries()).map(([key, item]) => [String(key), celValueToPlain(item)]));
  }
  if (typeof maybeCelCollection.values === 'function') {
    return Array.from(maybeCelCollection.values()).map(celValueToPlain);
  }
  return value;
}

function getPathValue(input: unknown, path: string): unknown {
  const parts = path.split('.').map((part) => part.trim()).filter(Boolean);
  let cursor = input;
  for (const part of parts) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function numberOrFallback(value: unknown, fallback: number): number {
  const normalized = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function positiveNumberOrFallback(value: unknown, fallback: number): number {
  const normalized = numberOrFallback(value, fallback);
  return normalized > 0 ? normalized : fallback;
}

function booleanOrFallback(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function evaluateCelExpression(expression: unknown, context: Record<string, unknown>): unknown {
  if (typeof expression !== 'string' || !expression.trim()) return undefined;
  try {
    return celValueToPlain(runCel(expression, context as Parameters<typeof runCel>[1]));
  } catch {
    return undefined;
  }
}

function candidateForCel(candidate: DispatcherCandidate): Record<string, unknown> {
  return {
    idx: candidate.idx,
    kind: candidate.kind,
    nodeId: candidate.nodeId,
    edgeId: candidate.edgeId,
    metadata: candidate.metadata,
    weight: candidate.weight,
    priority: candidate.priority,
    enabled: candidate.enabled,
    runtime: candidate.runtime,
  };
}

function endpointTargetForSelection(target: Record<string, unknown>): RouteGraphRuntimeSelection['selectedEndpointTarget'] {
  const modelSource = target.modelSource === 'request' ? 'request' : 'fixed';
  return {
    channelId: asTrimmedString(target.channelId),
    model: modelSource === 'request' ? '' : asTrimmedString(target.model),
    modelSource,
    accountId: target.accountId as number | string | null | undefined,
    tokenId: target.tokenId as number | string | null | undefined,
    siteId: target.siteId as number | string | null | undefined,
    weight: Number.isFinite(Number(target.weight)) ? Number(target.weight) : null,
    priority: Number.isFinite(Number(target.priority)) ? Number(target.priority) : null,
    metadata: isRecord(target.metadata) ? target.metadata : undefined,
    compatibilityPolicy: normalizeUpstreamCompatibilityPolicy(target.compatibilityPolicy),
  };
}

function dispatcherPolicy(node: RouteGraphNode): Record<string, unknown> {
  if ('policy' in node && isRecord(node.policy)) return node.policy;
  const config = 'config' in node && isRecord(node.config) ? node.config as Record<string, unknown> : null;
  if (config && isRecord(config.policy)) return config.policy;
  return { strategy: 'weighted' };
}

function selectWeightedDispatcherCandidate(candidates: DispatcherCandidate[]): DispatcherCandidate | null {
  if (candidates.length === 0) return null;
  const weighted = candidates.map((candidate) => ({
    candidate,
    weight: positiveNumberOrFallback(candidate.weight, 1),
  }));
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return weighted[0]?.candidate || null;
  let cursor = Math.random() * totalWeight;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor < 0) return item.candidate;
  }
  return weighted[weighted.length - 1]?.candidate || null;
}

function buildDispatcherCelContext(input: {
  state: RouteGraphRuntimeState;
  candidate: DispatcherCandidate;
  candidates: DispatcherCandidate[];
}): Record<string, unknown> {
  return {
    payload: {
      requestedModel: input.state.requestedModel,
      currentModel: input.state.currentModel,
      upstreamModel: input.state.upstreamModel ?? null,
      endpointPreference: input.state.endpointPreference ?? null,
    },
    metadata: input.candidate.metadata,
    stateStore: input.state.stateStore,
    idx: input.candidate.idx,
    candidate: candidateForCel(input.candidate),
    candidates: input.candidates.map(candidateForCel),
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

function applyScorePolicy(input: {
  policy: Record<string, unknown>;
  candidate: DispatcherCandidate;
  candidates: DispatcherCandidate[];
  state: RouteGraphRuntimeState;
}): DispatcherCandidate {
  const context = buildDispatcherCelContext(input);
  const next = { ...input.candidate };
  const rankExpression = input.policy.rank || input.policy.evaluate || input.policy.expression;
  const rankResult = evaluateCelExpression(rankExpression, context);
  if (isRecord(rankResult)) {
    next.enabled = booleanOrFallback(rankResult.enabled, next.enabled);
    next.weight = numberOrFallback(rankResult.weight, next.weight);
    next.priority = numberOrFallback(rankResult.priority, next.priority);
    next.score = numberOrFallback(rankResult.score, next.score);
  }

  if (typeof input.policy.score === 'string') {
    next.score = numberOrFallback(evaluateCelExpression(input.policy.score, context), next.score);
  } else if (Array.isArray(input.policy.score)) {
    let score = 0;
    let matched = false;
    for (const item of input.policy.score) {
      if (!isRecord(item)) continue;
      const source = asTrimmedString(item.source);
      if (!source) continue;
      const rawValue = source.includes('(') || /[+\-*/?:<>=!]/.test(source)
        ? evaluateCelExpression(source, context)
        : getPathValue(context, source);
      const value = numberOrFallback(rawValue, 0);
      const weight = numberOrFallback(item.weight, 1);
      score += value * weight;
      matched = true;
    }
    if (matched) next.score = score;
  }

  if (!Number.isFinite(next.score)) next.score = next.weight;
  return next;
}

function selectDispatcherCandidate(input: {
  node: RouteGraphNode;
  candidates: DispatcherCandidate[];
  state: RouteGraphRuntimeState;
}): DispatcherCandidate | null {
  const candidates = input.candidates.filter((candidate) => candidate.enabled !== false);
  if (candidates.length === 0) return null;
  const policy = dispatcherPolicy(input.node);
  const strategy = asTrimmedString(policy.strategy) || 'weighted';
  if (strategy === 'direct') {
    const context = buildDispatcherCelContext({ state: input.state, candidate: candidates[0], candidates });
    const direct = evaluateCelExpression(policy.select, context);
    const idx = isRecord(direct) ? numberOrFallback(direct.idx, Number.NaN) : numberOrFallback(direct, Number.NaN);
    if (Number.isInteger(idx) && idx >= 0 && idx < candidates.length) return candidates[idx];
    return candidates[0] || null;
  }
  if (strategy === 'round_robin') {
    const key = `dispatcher:${input.node.id}:round_robin`;
    const current = numberOrFallback(input.state.stateStore[key], 0);
    const normalizedIndex = candidates.length > 0 ? Math.abs(Math.trunc(current)) % candidates.length : 0;
    input.state.stateStore[key] = Math.max(0, Math.trunc(current)) + 1;
    return candidates[normalizedIndex] || null;
  }
  const ranked = candidates.map((candidate) => applyScorePolicy({
    policy,
    candidate,
    candidates,
    state: input.state,
  }));
  if (strategy === 'stable_first') {
    return ranked.sort((left, right) => left.order - right.order)[0] || null;
  }
  if (strategy === 'priority_order') {
    const maxPriority = Math.max(...ranked.map((candidate) => candidate.priority));
    return selectWeightedDispatcherCandidate(ranked.filter((candidate) => candidate.priority === maxPriority));
  }
  if (policy.score !== undefined || policy.scoreExpr !== undefined || Array.isArray(policy.score)) {
    return ranked.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.weight !== left.weight) return right.weight - left.weight;
      if (right.priority !== left.priority) return right.priority - left.priority;
      return left.order - right.order;
    })[0] || null;
  }
  return selectWeightedDispatcherCandidate(ranked);
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
      channelId: target.channelId,
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
  const selected = selectDispatcherCandidate({
    node: {
      id: input.op.nodeId,
      type: 'dispatcher',
      enabled: true,
      visibility: 'internal',
      ownership: 'derived',
      mode: 'route',
      policy,
    } as RouteGraphNode,
    candidates,
    state: input.state,
  });
  if (!selected) return null;
  return targetRefToRuntimeTarget(targets[selected.idx]);
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
      const selected = selectDispatcherCandidate({
        node: {
          id: op.nodeId,
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'derived',
          mode: op.mode === 'flow' ? 'flow' : 'route',
          policy: op.policy,
        } as RouteGraphNode,
        candidates,
        state,
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
        nodeType: 'model_endpoint',
        programId: input.program.id,
        opId: op.id,
        appliedFilters: [],
        decision: 'terminal',
        sourceRef: op.sourceRef,
      });
      trace.terminalNodeId = op.nodeId;
      return {
        matchedEntryNodeId: input.entryNodeId,
        selectedEntryNodeId: asTrimmedString(op.routeNodeId) || (op.routeId ? `entry:legacy:${op.routeId}` : op.nodeId),
        matchedRouteId: input.matchedRouteId,
        selectedRouteId: op.routeId,
        modelEndpointCompatibilityPolicy: isRecord(op.compatibilityPolicy)
          ? normalizeUpstreamCompatibilityPolicy(op.compatibilityPolicy)
          : undefined,
        selectedEndpointTarget,
        terminalNodeId: op.nodeId,
        terminalKind: 'model_endpoint',
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
}): RouteGraphRuntimeSelection | null {
  if (!hasUsableRouteProgramBundle(input.graph.programBundle)) return null;
  return evaluateRouteProgramBundle({
    bundle: input.graph.programBundle,
    requestedModel: input.requestedModel,
    maxHops: input.maxHops,
    stateStore: input.stateStore,
  });
}

export async function evaluateActiveRouteGraphForModel(requestedModel: string): Promise<RouteGraphRuntimeSelection | null> {
  const { ensureActiveRouteGraphVersion } = await import('./routeGraphService.js');
  const active = await ensureActiveRouteGraphVersion();
  return evaluateCompiledRouteGraph({
    graph: active.compiledGraph,
    requestedModel,
  });
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
      if (operation.mode !== 'override' && hasPayloadPath(outputPayload, path)) continue;
      setPayloadPath(outputPayload, path, operation.value);
    } else if (operation.type === 'remove_payload') {
      const path = asTrimmedString(operation.path);
      if (!path) continue;
      deletePayloadPath(outputPayload, path);
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
