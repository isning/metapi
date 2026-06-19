import { run as runCel } from '@bufbuild/cel';
import {
  findRouteGraphEntryForModel,
  normalizeRouteGraphSource,
  type CompiledRouteGraph,
  type RouteFilter,
  type RouteGraphEdge,
  type RouteGraphNode,
  type RouteGraphSource,
} from '../../shared/routeGraph.js';
import { isExactTokenRouteModelPattern } from '../../shared/tokenRoutePatterns.js';
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
  enteredPortId?: string;
  exitedPortId?: string;
  appliedFilters: string[];
  decision: 'matched_entry' | 'applied_filter' | 'dispatcher_selected_route' | 'dispatcher_selected_flow' | 'terminal' | 'synthetic_response';
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

type EvaluationContext = {
  graph: CompiledRouteGraph;
  nodesById: Record<string, RouteGraphNode>;
  edgesByFromPort: Record<string, RouteGraphEdge[]>;
  maxHops: number;
};

type DispatcherCandidate = {
  idx: number;
  kind: 'route' | 'bidirect' | 'target';
  nodeId?: string;
  edge?: RouteGraphEdge;
  metadata: Record<string, unknown>;
  runtime: Record<string, unknown>;
  enabled: boolean;
  weight: number;
  priority: number;
  score: number;
  order: number;
};

const DEFAULT_ROUTE_GRAPH_MAX_HOPS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function legacyRouteIdFromNode(node: RouteGraphNode | null | undefined): number | null {
  if (!node) return null;
  if ('legacyRouteId' in node && Number.isFinite(Number(node.legacyRouteId)) && Number(node.legacyRouteId) > 0) {
    return Math.trunc(Number(node.legacyRouteId));
  }
  if (node.type === 'entry' && Number.isFinite(Number(node.match?.routeId)) && Number(node.match.routeId) > 0) {
    return Math.trunc(Number(node.match.routeId));
  }
  const match = /^(?:entry|pool):legacy:(\d+)$/.exec(node.id);
  if (!match) return null;
  const routeId = Number(match[1]);
  return Number.isFinite(routeId) && routeId > 0 ? routeId : null;
}

function routeModelFromEntryNode(node: RouteGraphNode | null | undefined): string {
  if (!node || node.type !== 'entry') return '';
  const requestedModelPattern = asTrimmedString(node.match?.requestedModelPattern);
  if (isExactTokenRouteModelPattern(requestedModelPattern)) return requestedModelPattern;
  return '';
}

function graphSourceFromCompiled(graph: CompiledRouteGraph): RouteGraphSource {
  return normalizeRouteGraphSource({
    version: 1,
    nodes: Object.values(graph.nodesById || {}),
    edges: Object.values(graph.edgesByFromPort || {}).flat(),
  });
}

function edgeTrace(edge: RouteGraphEdge) {
  return {
    edgeId: edge.id,
    sourceNodeId: edge.sourceNodeId,
    sourcePortId: edge.sourcePortId,
    targetNodeId: edge.targetNodeId,
    targetPortId: edge.targetPortId,
    kind: edge.kind,
  };
}

function outgoing(ctx: EvaluationContext, nodeId: string, sourcePortId: string): RouteGraphEdge[] {
  return ctx.edgesByFromPort[`${nodeId}:${sourcePortId}`] || [];
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
    edgeId: candidate.edge?.id,
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

function targetSelectionPolicy(node: RouteGraphNode): Record<string, unknown> {
  const config = 'config' in node && isRecord(node.config) ? node.config as Record<string, unknown> : null;
  if (config && isRecord(config.targetSelection)) return config.targetSelection;
  return { strategy: 'weighted' };
}

function modelEndpointCompatibilityPolicy(node: RouteGraphNode): UpstreamCompatibilityPolicy | undefined {
  const direct = (node as { compatibilityPolicy?: unknown }).compatibilityPolicy;
  if (isRecord(direct)) return normalizeUpstreamCompatibilityPolicy(direct);

  const config = 'config' in node && isRecord(node.config) ? node.config as Record<string, unknown> : null;
  if (config && isRecord(config.compatibilityPolicy)) {
    return normalizeUpstreamCompatibilityPolicy(config.compatibilityPolicy);
  }
  return undefined;
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

function routeCandidatesForDispatcher(
  ctx: EvaluationContext,
  nodeId: string,
): DispatcherCandidate[] {
  const incomingRouteEdges = Object.values(ctx.edgesByFromPort)
    .flat()
    .filter((edge) => edge.targetNodeId === nodeId && edge.targetPortId === 'route.in');
  const candidates: DispatcherCandidate[] = incomingRouteEdges.flatMap((edge, index) => {
    const node = ctx.nodesById[edge.sourceNodeId];
    if (!node) return [];
    const nodeMetadata = isRecord((node as { metadata?: unknown }).metadata)
      ? ((node as { metadata?: Record<string, unknown> }).metadata || {})
      : {};
    const edgeMetadata = isRecord((edge as { metadata?: unknown }).metadata)
      ? ((edge as { metadata?: Record<string, unknown> }).metadata || {})
      : {};
    const metadata = { ...edgeMetadata, ...nodeMetadata };
    const metadataWeight = Number(metadata.weight);
    const metadataPriority = Number(metadata.priority);
    const targetSelection = isRecord((node as { config?: unknown }).config)
      ? (node as { config?: { targetSelection?: Record<string, unknown> } }).config?.targetSelection
      : null;
    const configWeight = isRecord(targetSelection) ? Number(targetSelection.weight) : Number.NaN;
    const configPriority = isRecord(targetSelection) ? Number(targetSelection.priority) : Number.NaN;
    const weight = Number.isFinite(metadataWeight) ? metadataWeight : (Number.isFinite(configWeight) ? configWeight : 1);
    const priority = Number.isFinite(metadataPriority) ? metadataPriority : (Number.isFinite(configPriority) ? configPriority : 0);
    return [{
      idx: index,
      kind: 'route' as const,
      nodeId: node.id,
      metadata,
      runtime: {},
      enabled: node.enabled !== false,
      weight,
      priority,
      score: weight,
      order: index,
    }];
  });
  return candidates;
}

function flowCandidatesForDispatcher(ctx: EvaluationContext, nodeId: string): DispatcherCandidate[] {
  return outgoing(ctx, nodeId, 'bidirect[1...].out').map((edge, index) => {
    const metadata = isRecord((edge as { metadata?: unknown }).metadata)
      ? ((edge as { metadata?: Record<string, unknown> }).metadata || {})
      : {};
    const weight = numberOrFallback(metadata.weight, 1);
    const priority = numberOrFallback(metadata.priority, 0);
    return {
      idx: index,
      kind: 'bidirect',
      edge,
      metadata,
      runtime: {},
      enabled: metadata.enabled !== false,
      weight,
      priority,
      score: weight,
      order: index,
    };
  });
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
  return ranked.sort((left, right) => {
    if (strategy === 'stable_first') return left.order - right.order;
    if (strategy === 'priority_order') {
      if (right.priority !== left.priority) return right.priority - left.priority;
      if (right.score !== left.score) return right.score - left.score;
      if (right.weight !== left.weight) return right.weight - left.weight;
      return left.order - right.order;
    }
    if (right.score !== left.score) return right.score - left.score;
    if (right.weight !== left.weight) return right.weight - left.weight;
    if (right.priority !== left.priority) return right.priority - left.priority;
    return left.order - right.order;
  })[0] || null;
}

function routeIdFromEndpointNode(node: RouteGraphNode | null | undefined): number | null {
  if (!node) return null;
  const direct = legacyRouteIdFromNode(node);
  if (direct) return direct;
  const match = /^pool:legacy:(\d+)$/.exec(node.id);
  if (!match) return null;
  const routeId = Number(match[1]);
  return Number.isFinite(routeId) && routeId > 0 ? routeId : null;
}

function terminalModelFromEndpointNode(ctx: EvaluationContext, node: RouteGraphNode): string {
  const routeNodeId = 'routeNodeId' in node && typeof node.routeNodeId === 'string' ? node.routeNodeId : '';
  if (!routeNodeId) return '';
  const routeEntry = routeNodeId ? ctx.nodesById[routeNodeId] : null;
  const entryModel = routeModelFromEntryNode(routeEntry);
  if (entryModel) return entryModel;
  const legacyRouteId = routeIdFromEndpointNode(node);
  if (legacyRouteId) {
    const legacyEntry = ctx.nodesById[`entry:legacy:${legacyRouteId}`];
    const legacyModel = routeModelFromEntryNode(legacyEntry);
    if (legacyModel) return legacyModel;
  }
  return '';
}

function selectEndpointTarget(node: RouteGraphNode, state: RouteGraphRuntimeState): RouteGraphRuntimeSelection['selectedEndpointTarget'] {
  if (!('config' in node) || !isRecord(node.config)) return null;
  const policy = targetSelectionPolicy(node);
  if (policy.strategy === 'defer_to_router') return null;
  const targets = Array.isArray(node.config.targets) ? node.config.targets : [];
  const candidates: DispatcherCandidate[] = targets.flatMap((target, index) => {
    if (!isRecord(target)) return [];
    const normalized = endpointTargetForSelection(target);
    if (!normalized?.channelId || (!normalized.model && normalized.modelSource !== 'request')) return [];
    const metadata = {
      ...(isRecord(target.metadata) ? target.metadata : {}),
      channelId: normalized.channelId,
      model: normalized.model,
      modelSource: normalized.modelSource || 'fixed',
      accountId: normalized.accountId ?? null,
      tokenId: normalized.tokenId ?? null,
      siteId: normalized.siteId ?? null,
    };
    const weight = numberOrFallback(target.weight, 1);
    const priority = numberOrFallback(target.priority, 0);
    return [{
      idx: index,
      kind: 'target' as const,
      metadata,
      runtime: {},
      enabled: target.enabled !== false,
      weight,
      priority,
      score: weight,
      order: index,
    }];
  });
  const selected = selectDispatcherCandidate({
    node: {
      ...node,
      type: 'dispatcher',
      mode: 'route',
      policy,
    } as RouteGraphNode,
    candidates,
    state,
  });
  if (!selected) return null;
  const raw = targets[selected.idx];
  return isRecord(raw) ? endpointTargetForSelection(raw) : null;
}

function evaluateNode(input: {
  ctx: EvaluationContext;
  nodeId: string;
  enteredPortId?: string;
  state: RouteGraphRuntimeState;
  postBuildFilters: RouteGraphPostBuildFilters;
  trace: RouteGraphRuntimeTrace;
  visited: Set<string>;
  hops: number;
}): RouteGraphRuntimeSelection | null {
  const { ctx, nodeId, enteredPortId, state, postBuildFilters, trace, visited, hops } = input;
  if (hops > ctx.maxHops) return null;
  if (visited.has(nodeId)) return null;
  const node = ctx.nodesById[nodeId];
  if (!node || node.enabled === false) return null;
  const nextVisited = new Set(visited);
  nextVisited.add(nodeId);

  if (node.type === 'filter') {
    const appliedFilters: string[] = [];
    for (const operation of node.operations || []) {
      if (filterMatchesOperationPhase(operation, 'pre_selection')) {
        const applied = applyPreSelectionFilter(state, operation);
        if (applied) appliedFilters.push(applied);
      } else {
        collectPostBuildFilter(postBuildFilters, operation);
        appliedFilters.push(operation.type);
      }
    }
    trace.path.push({
      nodeId,
      nodeName: node.name,
      nodeType: node.type,
      enteredPortId,
      exitedPortId: enteredPortId?.startsWith('bidirect') ? 'bidirect.out' : 'request.out',
      appliedFilters,
      decision: 'applied_filter',
    });
    const portId = enteredPortId?.startsWith('bidirect') ? 'bidirect.out' : 'request.out';
    return followEdges(ctx, outgoing(ctx, nodeId, portId), state, postBuildFilters, trace, nextVisited, hops + 1);
  }

  if (node.type === 'dispatcher' && node.mode === 'route') {
    const candidates = routeCandidatesForDispatcher(ctx, nodeId);
    const selected = selectDispatcherCandidate({ node, candidates, state });
    trace.path.push({
      nodeId,
      nodeName: node.name,
      nodeType: node.type,
      enteredPortId,
      exitedPortId: selected ? 'route.in' : undefined,
      appliedFilters: [],
      decision: 'dispatcher_selected_route',
    });
    if (!selected?.nodeId) return null;
    return evaluateNode({
      ctx,
      nodeId: selected.nodeId,
      enteredPortId: 'route.selected',
      state,
      postBuildFilters,
      trace,
      visited: nextVisited,
      hops: hops + 1,
    });
  }

  if (node.type === 'dispatcher' && node.mode === 'flow') {
    const candidates = flowCandidatesForDispatcher(ctx, nodeId);
    const selected = selectDispatcherCandidate({ node, candidates, state });
    trace.path.push({
      nodeId,
      nodeName: node.name,
      nodeType: node.type,
      enteredPortId,
      exitedPortId: selected ? 'bidirect[1...].out' : undefined,
      appliedFilters: [],
      decision: 'dispatcher_selected_flow',
    });
    if (!selected?.edge) return null;
    return followEdges(ctx, [selected.edge], state, postBuildFilters, trace, nextVisited, hops + 1);
  }

  if (node.type === 'synthetic_endpoint') {
    const statusCode = node.statusCode === 429 ? 429 : 503;
    trace.path.push({
      nodeId,
      nodeName: node.name,
      nodeType: node.type,
      enteredPortId,
      appliedFilters: [],
      decision: 'synthetic_response',
    });
    trace.terminalNodeId = nodeId;
    return {
      matchedEntryNodeId: '',
      selectedEntryNodeId: nodeId,
      matchedRouteId: null,
      selectedRouteId: null,
      selectedEndpointTarget: null,
      terminalNodeId: nodeId,
      terminalKind: 'synthetic_endpoint',
      syntheticResponse: {
        statusCode,
        message: node.message || 'No route is available.',
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

  if (node.type === 'model_endpoint' || node.type === 'auto_node') {
    const routeId = routeIdFromEndpointNode(node);
    const selectedEndpointTarget = selectEndpointTarget(node, state);
    const endpointCompatibilityPolicy = modelEndpointCompatibilityPolicy(node);
    const terminalModel = terminalModelFromEndpointNode(ctx, node);
    const selectedTargetModel = selectedEndpointTarget?.modelSource === 'request'
      ? (terminalModel || state.currentModel)
      : selectedEndpointTarget?.model;
    const currentModel = selectedTargetModel || terminalModel || state.currentModel;
    trace.path.push({
      nodeId,
      nodeName: node.name,
      nodeType: node.type,
      enteredPortId,
      appliedFilters: [],
      decision: 'terminal',
    });
    trace.terminalNodeId = nodeId;
    return {
      matchedEntryNodeId: '',
      selectedEntryNodeId: ('routeNodeId' in node && typeof node.routeNodeId === 'string' && node.routeNodeId) || (routeId ? `entry:legacy:${routeId}` : nodeId),
      matchedRouteId: null,
      selectedRouteId: routeId,
      modelEndpointCompatibilityPolicy: endpointCompatibilityPolicy,
      selectedEndpointTarget,
      terminalNodeId: nodeId,
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

  if (node.type === 'entry') {
    trace.path.push({
      nodeId,
      nodeName: node.name,
      nodeType: node.type,
      enteredPortId,
      exitedPortId: 'bidirect.out',
      appliedFilters: [],
      decision: 'matched_entry',
    });
    return followEdges(ctx, outgoing(ctx, nodeId, 'bidirect.out'), state, postBuildFilters, trace, nextVisited, hops + 1);
  }

  return null;
}

function followEdges(
  ctx: EvaluationContext,
  edges: RouteGraphEdge[],
  state: RouteGraphRuntimeState,
  postBuildFilters: RouteGraphPostBuildFilters,
  trace: RouteGraphRuntimeTrace,
  visited: Set<string>,
  hops: number,
): RouteGraphRuntimeSelection | null {
  for (const edge of edges) {
    trace.edges.push(edgeTrace(edge));
    const result = evaluateNode({
      ctx,
      nodeId: edge.targetNodeId,
      enteredPortId: edge.targetPortId,
      state: { ...state, headers: { ...state.headers } },
      postBuildFilters: {
        payload: [...postBuildFilters.payload],
        headers: [...postBuildFilters.headers],
        endpointPreference: postBuildFilters.endpointPreference,
      },
      trace: {
        path: [...trace.path],
        edges: [...trace.edges],
        terminalNodeId: trace.terminalNodeId,
      },
      visited,
      hops,
    });
    if (result) return result;
  }
  return null;
}

function followFirstAvailablePorts(
  ctx: EvaluationContext,
  nodeId: string,
  sourcePortIds: string[],
  state: RouteGraphRuntimeState,
  postBuildFilters: RouteGraphPostBuildFilters,
  trace: RouteGraphRuntimeTrace,
  visited: Set<string>,
  hops: number,
): RouteGraphRuntimeSelection | null {
  for (const sourcePortId of sourcePortIds) {
    const edges = outgoing(ctx, nodeId, sourcePortId);
    if (edges.length <= 0) continue;
    const result = followEdges(ctx, edges, state, postBuildFilters, trace, visited, hops);
    if (result) return result;
  }
  return null;
}

export function evaluateCompiledRouteGraph(input: {
  graph: CompiledRouteGraph;
  requestedModel: string;
  maxHops?: number;
  stateStore?: Record<string, unknown>;
}): RouteGraphRuntimeSelection | null {
  const source = graphSourceFromCompiled(input.graph);
  const normalized = normalizeRouteGraphSource(source);
  const ctx: EvaluationContext = {
    graph: input.graph,
    nodesById: Object.fromEntries(normalized.nodes.map((node) => [node.id, node])),
    edgesByFromPort: Object.fromEntries(Object.entries(input.graph.edgesByFromPort || {})),
    maxHops: Math.max(1, Math.trunc(input.maxHops || DEFAULT_ROUTE_GRAPH_MAX_HOPS)),
  };
  const entry = findRouteGraphEntryForModel(input.graph, input.requestedModel);
  if (!entry) return null;
  const entryNode = ctx.nodesById[entry.nodeId];
  if (!entryNode || entryNode.type !== 'entry') return null;
  const state: RouteGraphRuntimeState = {
    requestedModel: input.requestedModel,
    currentModel: input.requestedModel,
    headers: {},
    stateStore: input.stateStore || {},
  };
  const trace: RouteGraphRuntimeTrace = {
    path: [{
      nodeId: entryNode.id,
      nodeName: entryNode.name,
      nodeType: entryNode.type,
      exitedPortId: 'request.out',
      appliedFilters: [],
      decision: 'matched_entry',
    }],
    edges: [],
    terminalNodeId: null,
  };
  const result = followFirstAvailablePorts(
    ctx,
    entryNode.id,
    ['bidirect.out'],
    state,
    { payload: [], headers: [] },
    trace,
    new Set([entryNode.id]),
    1,
  );
  if (!result) return null;
  return {
    ...result,
    matchedEntryNodeId: entryNode.id,
    matchedRouteId: legacyRouteIdFromNode(entryNode),
    selectedEntryNodeId: result.selectedEntryNodeId || entryNode.id,
  };
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
