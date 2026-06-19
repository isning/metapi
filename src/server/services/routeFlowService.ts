import { and, desc, eq, gte, inArray, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getLocalRangeStartUtc } from './localTimeService.js';
import { evaluateActiveRouteGraphForModel, type RouteGraphRuntimeTraceStep } from './routeGraphRuntimeService.js';
import { tokenRouter, type RouteDecisionExplanation } from './tokenRouter.js';

export type RouteFlowNodeKind = 'request' | 'route' | 'transform' | 'pool' | 'channel';
export type RouteFlowVisibility = 'public' | 'internal' | 'terminal';
export type RouteFlowDiagnosticLevel = 'info' | 'warn' | 'error';

export type RouteFlowNode = {
  id: string;
  kind: RouteFlowNodeKind;
  visibility: RouteFlowVisibility;
  label: string;
  subtitle?: string | null;
  status: 'active' | 'selected' | 'available' | 'blocked' | 'inactive';
  badges: string[];
  metrics: {
    successRate?: number | null;
    totalCalls?: number | null;
    recentSuccessCount?: number | null;
    recentFailureCount?: number | null;
    avgLatencyMs?: number | null;
    probability?: number | null;
    priority?: number | null;
    weight?: number | null;
    failCount?: number | null;
    consecutiveFailureCount?: number | null;
    lastUsedAt?: string | null;
    lastSelectedAt?: string | null;
    lastFailureAt?: string | null;
    cooldownUntil?: string | null;
  };
  history: Array<{
    at: string;
    status: 'success' | 'failed' | 'retried';
    httpStatus?: number | null;
    message?: string | null;
  }>;
};

export type RouteFlowEdge = {
  id: string;
  source: string;
  target: string;
  label?: string | null;
};

export type RouteFlowDiagnostic = {
  level: RouteFlowDiagnosticLevel;
  message: string;
};

export type CompiledRouteFlow = {
  version: 1;
  requestedModel: string;
  actualModel: string;
  matched: boolean;
  selectedRouteId?: number | null;
  selectedChannelId?: number | null;
  selectedAccountId?: number | null;
  routePattern?: string | null;
  summary: string[];
  nodes: RouteFlowNode[];
  edges: RouteFlowEdge[];
  diagnostics: RouteFlowDiagnostic[];
  compiledAt: string;
};

type ChannelHealth = {
  successCount: number;
  failureCount: number;
  totalCalls: number;
  avgLatencyMs: number | null;
  history: RouteFlowNode['history'];
};

type RouteChannelRow = typeof schema.routeChannels.$inferSelect;

function roundRate(successCount: number, totalCalls: number): number | null {
  if (totalCalls <= 0) return null;
  return Math.round((successCount / totalCalls) * 1000) / 10;
}

function buildRouteBadges(decision: RouteDecisionExplanation): string[] {
  const badges: string[] = [];
  if (typeof decision.routeId === 'number') badges.push(`route #${decision.routeId}`);
  if (decision.matched) badges.push('matched');
  if (decision.selectedChannelId) badges.push('selected');
  return badges;
}

function buildCandidateBadges(candidate: RouteDecisionExplanation['candidates'][number]): string[] {
  const badges = [
    `P${candidate.priority}`,
    `W${candidate.weight}`,
    `${Math.round(candidate.probability * 10) / 10}%`,
  ];
  if (candidate.eligible) badges.push('eligible');
  if (candidate.recentlyFailed) badges.push('recent-fail');
  if (candidate.avoidedByRecentFailure) badges.push('cooldown-avoid');
  return badges;
}

function routeGraphTraceKind(step: RouteGraphRuntimeTraceStep): RouteFlowNodeKind {
  if (step.nodeType === 'entry' || step.decision === 'matched_entry') {
    return 'route';
  }
  if (step.nodeType === 'dispatcher' && step.decision === 'dispatcher_selected_route') {
    return 'route';
  }
  if (step.nodeType === 'filter' || step.appliedFilters.length > 0) return 'transform';
  return 'pool';
}

function routeGraphTraceVisibility(step: RouteGraphRuntimeTraceStep): RouteFlowVisibility {
  if (step.decision === 'terminal' || step.decision === 'synthetic_response') return 'terminal';
  return step.decision === 'matched_entry' ? 'public' : 'internal';
}

function routeGraphTraceStatus(step: RouteGraphRuntimeTraceStep): RouteFlowNode['status'] {
  if (step.decision === 'synthetic_response') return 'blocked';
  if (step.decision === 'terminal') return 'selected';
  return 'active';
}

function routeGraphTraceLabel(step: RouteGraphRuntimeTraceStep): string {
  return step.nodeName || step.nodeId;
}

function appendGraphTraceFlow(input: {
  nodes: RouteFlowNode[];
  edges: RouteFlowEdge[];
  terminalLinkSource: { current: string };
  trace: NonNullable<Awaited<ReturnType<typeof evaluateActiveRouteGraphForModel>>>['trace'];
}): void {
  const seenNodeIds = new Set(input.nodes.map((node) => node.id));
  let previousStepNodeId = 'request';

  for (const step of input.trace.path) {
    const nodeId = `graph:${step.nodeId}`;
    if (!seenNodeIds.has(nodeId)) {
      input.nodes.push({
        id: nodeId,
        kind: routeGraphTraceKind(step),
        visibility: routeGraphTraceVisibility(step),
        label: routeGraphTraceLabel(step),
        subtitle: `${step.nodeType}${step.exitedPortId ? ` / ${step.exitedPortId}` : ''}`,
        status: routeGraphTraceStatus(step),
        badges: [
          'graph',
          step.nodeType,
          ...step.appliedFilters,
        ].filter(Boolean),
        metrics: {},
        history: [],
      });
      seenNodeIds.add(nodeId);
    }

    if (!input.edges.some((edge) => edge.source === previousStepNodeId && edge.target === nodeId)) {
      input.edges.push({
        id: `graph-step:${previousStepNodeId}:${nodeId}`,
        source: previousStepNodeId,
        target: nodeId,
        label: step.decision,
      });
    }
    previousStepNodeId = nodeId;
  }

  for (const edge of input.trace.edges) {
    const source = `graph:${edge.sourceNodeId}`;
    const target = `graph:${edge.targetNodeId}`;
    if (!seenNodeIds.has(source) || !seenNodeIds.has(target)) continue;
    const edgeId = `graph-edge:${edge.edgeId}`;
    if (input.edges.some((item) => item.id === edgeId)) continue;
    input.edges.push({
      id: edgeId,
      source,
      target,
      label: edge.kind,
    });
  }

  if (input.trace.terminalNodeId) {
    input.terminalLinkSource.current = `graph:${input.trace.terminalNodeId}`;
  } else {
    input.terminalLinkSource.current = previousStepNodeId;
  }
}

async function loadChannelRows(channelIds: number[]): Promise<Map<number, RouteChannelRow>> {
  const uniqueIds = Array.from(new Set(channelIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (uniqueIds.length === 0) return new Map<number, RouteChannelRow>();

  const rows = await db.select().from(schema.routeChannels)
    .where(inArray(schema.routeChannels.id, uniqueIds))
    .all();
  return new Map(rows.map((row) => [row.id, row as RouteChannelRow]));
}

async function loadChannelHealth(model: string, channelIds: number[]): Promise<Map<number, ChannelHealth>> {
  const uniqueIds = Array.from(new Set(channelIds.filter((id) => Number.isFinite(id) && id > 0)));
  const result = new Map<number, ChannelHealth>();
  for (const channelId of uniqueIds) {
    result.set(channelId, {
      successCount: 0,
      failureCount: 0,
      totalCalls: 0,
      avgLatencyMs: null,
      history: [],
    });
  }
  if (uniqueIds.length === 0) return result;

  const since = getLocalRangeStartUtc(7);
  const recentLogs = await db.select({
    channelId: schema.proxyLogs.channelId,
    status: schema.proxyLogs.status,
    httpStatus: schema.proxyLogs.httpStatus,
    latencyMs: schema.proxyLogs.latencyMs,
    errorMessage: schema.proxyLogs.errorMessage,
    createdAt: schema.proxyLogs.createdAt,
  }).from(schema.proxyLogs)
    .where(and(
      inArray(schema.proxyLogs.channelId, uniqueIds),
      gte(schema.proxyLogs.createdAt, since),
      or(
        eq(schema.proxyLogs.modelRequested, model),
        eq(schema.proxyLogs.modelActual, model),
      ),
    ))
    .orderBy(desc(schema.proxyLogs.createdAt))
    .all();

  const latencyTotals = new Map<number, { total: number; samples: number }>();
  for (const log of recentLogs) {
    const channelId = log.channelId;
    if (typeof channelId !== 'number') continue;
    const target = result.get(channelId);
    if (!target) continue;

    target.totalCalls += 1;
    if (log.status === 'success') {
      target.successCount += 1;
      if (typeof log.latencyMs === 'number' && log.latencyMs >= 0) {
        const current = latencyTotals.get(channelId) || { total: 0, samples: 0 };
        current.total += log.latencyMs;
        current.samples += 1;
        latencyTotals.set(channelId, current);
      }
    } else {
      target.failureCount += 1;
    }

    if (target.history.length < 6) {
      target.history.push({
        at: log.createdAt || '',
        status: log.status === 'success' || log.status === 'retried' ? log.status : 'failed',
        httpStatus: log.httpStatus ?? null,
        message: log.errorMessage || null,
      });
    }
  }

  for (const [channelId, latency] of latencyTotals.entries()) {
    const target = result.get(channelId);
    if (!target || latency.samples <= 0) continue;
    target.avgLatencyMs = Math.round(latency.total / latency.samples);
  }

  return result;
}

export async function compileModelRouteFlow(model: string): Promise<CompiledRouteFlow> {
  const requestedModel = model.trim();
  const compiledAt = new Date().toISOString();
  const graphSelection = await evaluateActiveRouteGraphForModel(requestedModel);
  const graphRouteId = graphSelection?.matchedRouteId ?? graphSelection?.selectedRouteId ?? null;
  const decision = graphRouteId
    ? await tokenRouter.explainSelectionForRoute(graphRouteId, graphSelection?.currentModel || requestedModel)
    : await tokenRouter.explainSelection(requestedModel);
  const channelIds = decision.candidates.map((candidate) => candidate.channelId);
  const [channelRows, healthByChannelId] = await Promise.all([
    loadChannelRows(channelIds),
    loadChannelHealth(requestedModel, channelIds),
  ]);

  const nodes: RouteFlowNode[] = [{
    id: 'request',
    kind: 'request',
    visibility: 'public',
    label: requestedModel,
    subtitle: 'client request model',
    status: decision.matched ? 'active' : 'blocked',
    badges: ['public'],
    metrics: {},
    history: [],
  }];
  const edges: RouteFlowEdge[] = [];
  const diagnostics: RouteFlowDiagnostic[] = [];
  const terminalLinkSource = { current: 'request' };

  if (graphSelection) {
    appendGraphTraceFlow({
      nodes,
      edges,
      terminalLinkSource,
      trace: graphSelection.trace,
    });
  }

  if (graphSelection?.terminalKind === 'synthetic_endpoint') {
    const syntheticStatus = graphSelection.syntheticResponse?.statusCode || 503;
    nodes.push({
      id: 'graph:synthetic-response',
      kind: 'pool',
      visibility: 'terminal',
      label: `${syntheticStatus}`,
      subtitle: graphSelection.syntheticResponse?.message || 'configured route graph synthetic response',
      status: 'blocked',
      badges: ['terminal', 'synthetic_endpoint'],
      metrics: {},
      history: [],
    });
    edges.push({ id: 'graph-synthetic-response-terminal', source: terminalLinkSource.current, target: 'graph:synthetic-response', label: 'terminal' });
    diagnostics.push({ level: 'warn', message: graphSelection.syntheticResponse?.message || '路由图返回了配置的 synthetic endpoint' });
    return {
      version: 1,
      requestedModel,
      actualModel: graphSelection.currentModel,
      matched: true,
      selectedRouteId: null,
      selectedChannelId: null,
      selectedAccountId: null,
      routePattern: null,
      summary: [`route graph synthetic response ${syntheticStatus}`],
      nodes,
      edges,
      diagnostics,
      compiledAt,
    };
  }

  if (!graphSelection && !decision.matched) {
    nodes.push({
      id: 'unmatched',
      kind: 'pool',
      visibility: 'terminal',
      label: 'No route matched',
      subtitle: 'route compiler stopped before channel pool',
      status: 'blocked',
      badges: ['terminal'],
      metrics: {},
      history: [],
    });
    edges.push({ id: 'request-unmatched', source: 'request', target: 'unmatched', label: 'match' });
    diagnostics.push({ level: 'warn', message: '当前模型没有命中启用路由' });
    return {
      version: 1,
      requestedModel,
      actualModel: decision.actualModel,
      matched: false,
      selectedRouteId: null,
      selectedChannelId: null,
      selectedAccountId: null,
      routePattern: null,
      summary: decision.summary,
      nodes,
      edges,
      diagnostics,
      compiledAt,
    };
  }

  const routeNodeId = decision.routeId ? `route:${decision.routeId}` : 'route:matched';
  if (!graphSelection) {
    nodes.push({
      id: routeNodeId,
      kind: 'route',
      visibility: 'public',
      label: decision.modelPattern || 'matched route',
      subtitle: decision.actualModel === requestedModel ? null : `actual: ${decision.actualModel}`,
      status: 'active',
      badges: buildRouteBadges(decision),
      metrics: {},
      history: [],
    });
    edges.push({ id: 'request-route', source: 'request', target: routeNodeId, label: 'match' });
    terminalLinkSource.current = routeNodeId;
  }

  let upstreamNodeSource = terminalLinkSource.current;
  const actualModel = graphSelection?.currentModel || decision.actualModel;
  if (!graphSelection && decision.actualModel !== requestedModel) {
    nodes.push({
      id: 'transform:model-map',
      kind: 'transform',
      visibility: 'internal',
      label: 'Model rewrite',
      subtitle: `${requestedModel} -> ${decision.actualModel}`,
      status: 'active',
      badges: ['internal'],
      metrics: {},
      history: [],
    });
    edges.push({ id: 'route-transform-model-map', source: routeNodeId, target: 'transform:model-map', label: 'rewrite' });
    upstreamNodeSource = 'transform:model-map';
  }

  nodes.push({
    id: 'pool:channels',
    kind: 'pool',
    visibility: 'terminal',
    label: 'Channel pool',
    subtitle: `${decision.candidates.length} candidates`,
    status: decision.selectedChannelId ? 'selected' : 'blocked',
    badges: decision.selectedChannelId ? ['terminal', 'selected'] : ['terminal'],
    metrics: {
      totalCalls: decision.candidates.length,
    },
    history: [],
  });
  edges.push({ id: 'route-pool', source: upstreamNodeSource, target: 'pool:channels', label: 'resolve' });

  const sortedCandidates = [...decision.candidates].sort((left, right) => {
    if (left.channelId === decision.selectedChannelId) return -1;
    if (right.channelId === decision.selectedChannelId) return 1;
    if (right.eligible !== left.eligible) return Number(right.eligible) - Number(left.eligible);
    if (right.probability !== left.probability) return right.probability - left.probability;
    return left.channelId - right.channelId;
  });

  for (const candidate of sortedCandidates) {
    const channel = channelRows.get(candidate.channelId);
    const health = healthByChannelId.get(candidate.channelId) || {
      successCount: 0,
      failureCount: 0,
      totalCalls: 0,
      avgLatencyMs: null,
      history: [],
    };
    const selected = candidate.channelId === decision.selectedChannelId;
    const blocked = !candidate.eligible || candidate.avoidedByRecentFailure || candidate.recentlyFailed;
    const nodeId = `channel:${candidate.channelId}`;
    nodes.push({
      id: nodeId,
      kind: 'channel',
      visibility: 'internal',
      label: `${candidate.username} @ ${candidate.siteName}`,
      subtitle: `${candidate.tokenName} / channel #${candidate.channelId}`,
      status: selected ? 'selected' : (blocked ? 'blocked' : 'available'),
      badges: buildCandidateBadges(candidate),
      metrics: {
        successRate: roundRate(health.successCount, health.totalCalls),
        totalCalls: health.totalCalls,
        recentSuccessCount: health.successCount,
        recentFailureCount: health.failureCount,
        avgLatencyMs: health.avgLatencyMs,
        probability: candidate.probability,
        priority: candidate.priority,
        weight: candidate.weight,
        failCount: channel?.failCount ?? null,
        consecutiveFailureCount: channel?.consecutiveFailCount ?? null,
        lastUsedAt: channel?.lastUsedAt ?? null,
        lastSelectedAt: channel?.lastSelectedAt ?? null,
        lastFailureAt: channel?.lastFailAt ?? null,
        cooldownUntil: channel?.cooldownUntil ?? null,
      },
      history: health.history,
    });
    edges.push({
      id: `pool-channel-${candidate.channelId}`,
      source: 'pool:channels',
      target: nodeId,
      label: selected ? 'selected' : (candidate.eligible ? `${Math.round(candidate.probability * 10) / 10}%` : 'blocked'),
    });
  }

  if (decision.candidates.length === 0) {
    diagnostics.push({ level: 'warn', message: '路由已命中，但没有候选通道' });
  } else if (!decision.selectedChannelId) {
    diagnostics.push({ level: 'warn', message: '路由已命中，但本次没有选出通道' });
  }

  return {
    version: 1,
    requestedModel,
    actualModel,
    matched: true,
    selectedRouteId: decision.routeId ?? null,
    selectedChannelId: decision.selectedChannelId ?? null,
    selectedAccountId: decision.selectedAccountId ?? null,
    routePattern: decision.modelPattern ?? null,
    summary: decision.summary,
    nodes,
    edges,
    diagnostics,
    compiledAt,
  };
}
