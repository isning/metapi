import { and, desc, eq, gte, inArray, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getLocalRangeStartUtc } from './localTimeService.js';
import { evaluateActiveRouteGraphForModel, type RouteGraphRuntimeTraceStep } from './routeGraphRuntimeService.js';
import { ensureActiveRouteGraphVersion } from './routeGraphService.js';
import {
  estimateRouteEntryPricing,
  type EntryPricingEstimate,
} from './routeEntryPricingService.js';
import {
  resolveDispatchUpstreamCompatibilityPolicy,
} from './upstreamCompatibilityPolicyResolver.js';
import type { ResolvedUpstreamCompatibilityPolicy } from '../contracts/upstreamCompatibilityPolicy.js';

export type RouteFlowNodeKind =
  | 'request'
  | 'entry'
  | 'dispatcher'
  | 'filter'
  | 'route_endpoint'
  | 'synthetic_endpoint';
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
  selectedAccountId?: number | null;
  routePattern?: string | null;
  summary: string[];
  nodes: RouteFlowNode[];
  edges: RouteFlowEdge[];
  diagnostics: RouteFlowDiagnostic[];
  entryPricing?: {
    theoretical: EntryPricingEstimate | null;
  };
  compatibilityPolicy?: {
    resolved: ResolvedUpstreamCompatibilityPolicy;
    layers: Array<{
      source: 'site' | 'account' | 'token' | 'endpoint_policy' | 'target';
      configured: boolean;
    }>;
  };
  compiledAt: string;
};

type ChannelHealth = {
  successCount: number;
  failureCount: number;
  totalCalls: number;
  avgLatencyMs: number | null;
  history: RouteFlowNode['history'];
};

type RuntimeStatsSourceRow = typeof schema.routeEndpointTargets.$inferSelect;
type RuntimeCredentialIdentity = {
  targetId: number;
  routeId: number;
  sourceModel: string | null;
  siteId: number;
  siteName: string;
  siteUrl: string;
  sitePlatform: string;
  accountId: number;
  accountUsername: string | null;
  tokenId: number | null;
  tokenName: string | null;
  tokenGroup: string | null;
};

function roundRate(successCount: number, totalCalls: number): number | null {
  if (totalCalls <= 0) return null;
  return Math.round((successCount / totalCalls) * 1000) / 10;
}

function buildGraphCandidateBadges(candidate: NonNullable<EntryPricingEstimate>['candidates'][number]): string[] {
  const badges = [
    candidate.priority != null ? `P${candidate.priority}` : null,
    candidate.weight != null ? `W${candidate.weight}` : null,
    candidate.probability == null ? null : `${Math.round(candidate.probability * 1000) / 10}%`,
    candidate.matchedScope || null,
  ].filter((badge): badge is string => !!badge);
  return badges.length > 0 ? badges : ['candidate'];
}

function graphCandidatePercent(candidate: NonNullable<EntryPricingEstimate>['candidates'][number]): string {
  if (candidate.probability == null) return 'N/A';
  return `${Math.round(candidate.probability * 1000) / 10}%`;
}

function trimDisplay(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function endpointCredentialLabel(input: {
  candidate: NonNullable<EntryPricingEstimate>['candidates'][number];
  identity?: RuntimeCredentialIdentity;
}): string {
  const accountId = input.identity?.accountId ?? input.candidate.accountId;
  const tokenId = input.identity?.tokenId ?? input.candidate.tokenId;
  const accountLabel = trimDisplay(input.identity?.accountUsername)
    || (accountId != null ? `account #${accountId}` : 'account');
  const tokenLabel = trimDisplay(input.identity?.tokenName)
    || trimDisplay(input.identity?.tokenGroup)
    || (tokenId != null ? `token #${tokenId}` : '');
  return tokenLabel ? `${accountLabel} / ${tokenLabel}` : accountLabel;
}

function graphCandidateDisplay(input: {
  candidate: NonNullable<EntryPricingEstimate>['candidates'][number];
  identity?: RuntimeCredentialIdentity;
  supplyEndpointId?: string | null;
}): { label: string; subtitle: string } {
  const siteId = input.identity?.siteId ?? input.candidate.siteId;
  const siteLabel = trimDisplay(input.identity?.siteName)
    || trimDisplay(input.identity?.siteUrl)
    || (siteId != null ? `site #${siteId}` : 'upstream');
  const modelName = input.candidate.modelName || trimDisplay(input.identity?.sourceModel) || 'upstream target';
  const details = [
    modelName,
    input.supplyEndpointId ? `endpoint ${input.supplyEndpointId}` : null,
    input.candidate.targetId ? `target ${input.candidate.targetId}` : null,
    input.identity?.routeId != null ? `route #${input.identity.routeId}` : null,
    trimDisplay(input.identity?.sitePlatform) || null,
  ].filter((item): item is string => !!item);
  return {
    label: `${siteLabel} · ${endpointCredentialLabel(input)}`,
    subtitle: details.join(' · '),
  };
}

function targetIdentityValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function candidateEndpointIdentity(candidate: NonNullable<EntryPricingEstimate>['candidates'][number]): string {
  return targetIdentityValue(candidate.sourceRef?.endpointId) || targetIdentityValue(candidate.endpointId);
}

function candidateRuntimeTargetId(candidate: NonNullable<EntryPricingEstimate>['candidates'][number]): number | null {
  const direct = Number(candidate.targetId);
  if (Number.isFinite(direct) && direct > 0) return Math.trunc(direct);
  const derivedTargetMatch = /:target:\d+:(\d+)$/.exec(candidate.targetId);
  if (!derivedTargetMatch) return null;
  const parsed = Number(derivedTargetMatch[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function candidateMatchesSelectedEndpoint(input: {
  candidate: NonNullable<EntryPricingEstimate>['candidates'][number];
  target: NonNullable<Awaited<ReturnType<typeof evaluateActiveRouteGraphForModel>>>['selectedEndpointTarget'];
}): boolean {
  const targetEndpointId = targetIdentityValue(input.target?.sourceRef?.endpointId) || targetIdentityValue(input.target?.endpointId);
  return !!targetEndpointId && candidateEndpointIdentity(input.candidate) === targetEndpointId;
}

function routeFlowNodeStatusForCandidate(input: {
  candidate: NonNullable<EntryPricingEstimate>['candidates'][number];
  target: NonNullable<Awaited<ReturnType<typeof evaluateActiveRouteGraphForModel>>>['selectedEndpointTarget'];
  health: ChannelHealth;
  runtimeStatsSource?: RuntimeStatsSourceRow;
}): RouteFlowNode['status'] {
  if (candidateMatchesSelectedEndpoint({
    candidate: input.candidate,
    target: input.target,
  })) return 'selected';
  if ((input.runtimeStatsSource?.consecutiveFailCount ?? 0) > 0 || input.health.failureCount > input.health.successCount) return 'blocked';
  return 'available';
}

function findGraphDispatcherNodeId(input: {
  nodes: RouteFlowNode[];
  trace: NonNullable<Awaited<ReturnType<typeof evaluateActiveRouteGraphForModel>>>['trace'];
}): string | null {
  const selectedDispatcher = [...input.trace.path].reverse().find((step) => step.nodeType === 'dispatcher');
  if (selectedDispatcher) {
    const graphNodeId = `graph:${selectedDispatcher.nodeId}`;
    if (input.nodes.some((node) => node.id === graphNodeId)) return graphNodeId;
  }
  const dispatcherNode = input.nodes.find((node) => node.kind === 'dispatcher');
  return dispatcherNode?.id || null;
}

function routeGraphTraceKind(step: RouteGraphRuntimeTraceStep): RouteFlowNodeKind {
  if (step.nodeType === 'entry') return 'entry';
  if (step.nodeType === 'dispatcher') return 'dispatcher';
  if (step.nodeType === 'filter' || step.appliedFilters.length > 0) return 'filter';
  if (step.nodeType === 'route_endpoint') return 'route_endpoint';
  if (step.nodeType === 'synthetic_endpoint') return 'synthetic_endpoint';
  return 'route_endpoint';
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

  input.terminalLinkSource.current = previousStepNodeId;
}

async function loadRuntimeStatsSources(targetIds: number[]): Promise<Map<number, RuntimeStatsSourceRow>> {
  const uniqueIds = Array.from(new Set(targetIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (uniqueIds.length === 0) return new Map<number, RuntimeStatsSourceRow>();

  const rows = await db.select().from(schema.routeEndpointTargets)
    .where(inArray(schema.routeEndpointTargets.id, uniqueIds))
    .all();
  return new Map(rows.map((row) => [row.id, row as RuntimeStatsSourceRow]));
}

async function loadRuntimeCredentialIdentities(targetIds: number[]): Promise<Map<number, RuntimeCredentialIdentity>> {
  const uniqueIds = Array.from(new Set(targetIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (uniqueIds.length === 0) return new Map<number, RuntimeCredentialIdentity>();

  const rows = await db.select({
    targetId: schema.routeEndpointTargets.id,
    routeId: schema.routeEndpointTargets.routeId,
    sourceModel: schema.routeEndpointTargets.sourceModel,
    siteId: schema.sites.id,
    siteName: schema.sites.name,
    siteUrl: schema.sites.url,
    sitePlatform: schema.sites.platform,
    accountId: schema.accounts.id,
    accountUsername: schema.accounts.username,
    tokenId: schema.accountTokens.id,
    tokenName: schema.accountTokens.name,
    tokenGroup: schema.accountTokens.tokenGroup,
  })
    .from(schema.routeEndpointTargets)
    .innerJoin(schema.accounts, eq(schema.routeEndpointTargets.accountId, schema.accounts.id))
    .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .leftJoin(schema.accountTokens, eq(schema.routeEndpointTargets.tokenId, schema.accountTokens.id))
    .where(inArray(schema.routeEndpointTargets.id, uniqueIds))
    .all();

  return new Map(rows.map((row) => [row.targetId, row]));
}

async function loadRuntimeEndpointHealth(model: string, targetIds: number[]): Promise<Map<number, ChannelHealth>> {
  const uniqueIds = Array.from(new Set(targetIds.filter((id) => Number.isFinite(id) && id > 0)));
  const result = new Map<number, ChannelHealth>();
  for (const targetId of uniqueIds) {
    result.set(targetId, {
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
    targetId: schema.proxyLogs.targetId,
    status: schema.proxyLogs.status,
    httpStatus: schema.proxyLogs.httpStatus,
    latencyMs: schema.proxyLogs.latencyMs,
    errorMessage: schema.proxyLogs.errorMessage,
    createdAt: schema.proxyLogs.createdAt,
  }).from(schema.proxyLogs)
    .where(and(
      inArray(schema.proxyLogs.targetId, uniqueIds),
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
    const targetId = log.targetId;
    if (typeof targetId !== 'number') continue;
    const target = result.get(targetId);
    if (!target) continue;

    target.totalCalls += 1;
    if (log.status === 'success') {
      target.successCount += 1;
      if (typeof log.latencyMs === 'number' && log.latencyMs >= 0) {
        const current = latencyTotals.get(targetId) || { total: 0, samples: 0 };
        current.total += log.latencyMs;
        current.samples += 1;
        latencyTotals.set(targetId, current);
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

  for (const [targetId, latency] of latencyTotals.entries()) {
    const target = result.get(targetId);
    if (!target || latency.samples <= 0) continue;
    target.avgLatencyMs = Math.round(latency.total / latency.samples);
  }

  return result;
}

async function resolveGraphCompatibilityPolicy(input: {
  selection: NonNullable<Awaited<ReturnType<typeof evaluateActiveRouteGraphForModel>>>;
  candidateIdentity?: {
    siteId: number | null;
    accountId: number | null;
    tokenId: number | null;
  } | null;
}): Promise<CompiledRouteFlow['compatibilityPolicy']> {
  const selection = input.selection;
  const fallback = input.candidateIdentity || null;
  const target = selection.selectedEndpointTarget;
  let siteId = Number(target?.siteId ?? fallback?.siteId);
  let accountId = Number(target?.accountId ?? fallback?.accountId);
  let tokenId = Number(target?.tokenId ?? fallback?.tokenId);
  const [site, account, token] = await Promise.all([
    Number.isFinite(siteId) && siteId > 0
      ? db.select({ compatibilityPolicy: schema.sites.compatibilityPolicy })
        .from(schema.sites)
        .where(eq(schema.sites.id, Math.trunc(siteId)))
        .get()
      : Promise.resolve(null),
    Number.isFinite(accountId) && accountId > 0
      ? db.select({ extraConfig: schema.accounts.extraConfig })
        .from(schema.accounts)
        .where(eq(schema.accounts.id, Math.trunc(accountId)))
        .get()
      : Promise.resolve(null),
    Number.isFinite(tokenId) && tokenId > 0
      ? db.select({ compatibilityPolicy: schema.accountTokens.compatibilityPolicy })
        .from(schema.accountTokens)
        .where(eq(schema.accountTokens.id, Math.trunc(tokenId)))
        .get()
      : Promise.resolve(null),
  ]);

  return {
    resolved: resolveDispatchUpstreamCompatibilityPolicy({
      site,
      account,
      token,
      routeEndpointCompatibilityPolicy: selection.routeEndpointCompatibilityPolicy,
      selectedEndpointTarget: target,
    }),
    layers: [
      { source: 'site', configured: !!site?.compatibilityPolicy },
      { source: 'account', configured: !!account?.extraConfig },
      { source: 'token', configured: !!token?.compatibilityPolicy },
      { source: 'endpoint_policy', configured: !!selection.routeEndpointCompatibilityPolicy },
      { source: 'target', configured: !!target?.compatibilityPolicy },
    ],
  };
}

export async function compileModelRouteFlow(model: string): Promise<CompiledRouteFlow> {
  const requestedModel = model.trim();
  const compiledAt = new Date().toISOString();
  const activeGraph = await ensureActiveRouteGraphVersion();
  const [graphSelection, staticEntryPricing] = await Promise.all([
    evaluateActiveRouteGraphForModel(requestedModel),
    estimateRouteEntryPricing({
      bundle: activeGraph.compiledGraph.compiledRouterBundle
        || activeGraph.compiledGraph.flatProgramBundle
        || activeGraph.compiledGraph.programBundle,
      requestedModel,
    }),
  ]);
  const theoreticalEntryPricing = staticEntryPricing;

  const nodes: RouteFlowNode[] = [{
    id: 'request',
    kind: 'request',
    visibility: 'public',
    label: requestedModel,
    subtitle: 'client request model',
    status: graphSelection ? 'active' : 'blocked',
    badges: ['public'],
    metrics: {},
    history: [],
  }];
  const edges: RouteFlowEdge[] = [];
  const diagnostics: RouteFlowDiagnostic[] = [];
  const terminalLinkSource = { current: 'request' };

  if (graphSelection) {
    const target = graphSelection.selectedEndpointTarget;
    const selectedEndpointId = targetIdentityValue(target?.sourceRef?.endpointId) || targetIdentityValue(target?.endpointId);
    const selectedPricingCandidate = theoreticalEntryPricing?.candidates.find((candidate) => (
      candidateEndpointIdentity(candidate) === selectedEndpointId
    )) || theoreticalEntryPricing?.candidates[0] || null;
    const compatibilityPolicy = await resolveGraphCompatibilityPolicy({
      selection: graphSelection,
      candidateIdentity: selectedPricingCandidate
        ? {
          siteId: selectedPricingCandidate.siteId,
          accountId: selectedPricingCandidate.accountId,
          tokenId: selectedPricingCandidate.tokenId,
        }
        : null,
    });
    appendGraphTraceFlow({
      nodes,
      edges,
      terminalLinkSource,
      trace: graphSelection.trace,
    });

    const pricingCandidates = theoreticalEntryPricing?.candidates || [];
    const graphTargetIds = pricingCandidates
      .map((candidate) => candidateRuntimeTargetId(candidate))
      .filter((targetId): targetId is number => targetId != null);
    const [runtimeStatsSources, runtimeHealthBySourceId, runtimeCredentialIdentities] = await Promise.all([
      loadRuntimeStatsSources(graphTargetIds),
      loadRuntimeEndpointHealth(requestedModel, graphTargetIds),
      loadRuntimeCredentialIdentities(graphTargetIds),
    ]);
    const dispatcherNodeId = findGraphDispatcherNodeId({ nodes, trace: graphSelection.trace }) || terminalLinkSource.current;
    const semanticCandidateTargets = new Set<string>();
    const semanticSupplyEndpointNodes = new Set<string>();

    for (const candidate of pricingCandidates.sort((left, right) => {
      if (candidateEndpointIdentity(left) === selectedEndpointId) return -1;
      if (candidateEndpointIdentity(right) === selectedEndpointId) return 1;
      const rightProbability = right.probability ?? -1;
      const leftProbability = left.probability ?? -1;
      if (rightProbability !== leftProbability) return rightProbability - leftProbability;
      return candidateEndpointIdentity(left).localeCompare(candidateEndpointIdentity(right));
    })) {
      const supplyEndpointId = candidateEndpointIdentity(candidate);
      if (!supplyEndpointId) {
        diagnostics.push({
          level: 'warn',
          message: `Skipping pricing candidate without route_endpoint id for ${candidate.modelName || requestedModel}.`,
        });
        continue;
      }
      const targetId = candidateRuntimeTargetId(candidate);
      const hasRuntimeTargetStats = targetId != null;
      const runtimeStatsSource = hasRuntimeTargetStats ? runtimeStatsSources.get(targetId) : undefined;
      const runtimeCredentialIdentity = hasRuntimeTargetStats ? runtimeCredentialIdentities.get(targetId) : undefined;
      const health = (hasRuntimeTargetStats ? runtimeHealthBySourceId.get(targetId) : undefined) || {
        successCount: 0,
        failureCount: 0,
        totalCalls: 0,
        avgLatencyMs: null,
        history: [],
      };
      const semanticSupplyNodeId = `graph:${supplyEndpointId}`;
      semanticSupplyEndpointNodes.add(semanticSupplyNodeId);
      const supplyNodeId = semanticSupplyNodeId;
      const selected = candidateMatchesSelectedEndpoint({ candidate, target });
      const candidateStatus = selected
        ? 'selected'
        : routeFlowNodeStatusForCandidate({ candidate, target, health, runtimeStatsSource });
      const candidateDisplay = graphCandidateDisplay({
        candidate,
        identity: runtimeCredentialIdentity,
        supplyEndpointId,
      });
      if (!nodes.some((node) => node.id === supplyNodeId)) {
        nodes.push({
          id: supplyNodeId,
          kind: 'route_endpoint',
          visibility: 'internal',
          label: candidateDisplay.label,
          subtitle: candidateDisplay.subtitle,
          status: candidateStatus,
          badges: Array.from(new Set([
            'supply',
            'supply-target',
            ...buildGraphCandidateBadges(candidate),
          ])),
          metrics: {
            successRate: roundRate(health.successCount, health.totalCalls),
            totalCalls: health.totalCalls,
            recentSuccessCount: health.successCount,
            recentFailureCount: health.failureCount,
            avgLatencyMs: health.avgLatencyMs,
            probability: candidate.probability == null ? null : candidate.probability * 100,
            priority: candidate.priority,
            weight: candidate.weight,
            failCount: runtimeStatsSource?.failCount ?? null,
            consecutiveFailureCount: runtimeStatsSource?.consecutiveFailCount ?? null,
            lastUsedAt: runtimeStatsSource?.lastUsedAt ?? null,
            lastSelectedAt: runtimeStatsSource?.lastSelectedAt ?? null,
            lastFailureAt: runtimeStatsSource?.lastFailAt ?? null,
            cooldownUntil: runtimeStatsSource?.cooldownUntil ?? null,
          },
          history: health.history,
        });
      } else {
        const supplyNode = nodes.find((node) => node.id === supplyNodeId);
        if (supplyNode) {
          supplyNode.kind = 'route_endpoint';
          supplyNode.visibility = 'internal';
          supplyNode.label = candidateDisplay.label;
          supplyNode.subtitle = candidateDisplay.subtitle;
          supplyNode.status = selected ? 'selected' : supplyNode.status;
          supplyNode.metrics = {
            ...supplyNode.metrics,
            successRate: roundRate(health.successCount, health.totalCalls),
            totalCalls: health.totalCalls,
            recentSuccessCount: health.successCount,
            recentFailureCount: health.failureCount,
            avgLatencyMs: health.avgLatencyMs,
            probability: candidate.probability == null ? null : candidate.probability * 100,
            priority: candidate.priority,
            weight: candidate.weight,
            failCount: runtimeStatsSource?.failCount ?? null,
            consecutiveFailureCount: runtimeStatsSource?.consecutiveFailCount ?? null,
            lastUsedAt: runtimeStatsSource?.lastUsedAt ?? null,
            lastSelectedAt: runtimeStatsSource?.lastSelectedAt ?? null,
            lastFailureAt: runtimeStatsSource?.lastFailAt ?? null,
            cooldownUntil: runtimeStatsSource?.cooldownUntil ?? null,
          };
          supplyNode.history = health.history;
          supplyNode.badges = Array.from(new Set([...supplyNode.badges, 'supply', 'supply-target', ...buildGraphCandidateBadges(candidate)]));
        }
      }
      if (!edges.some((edge) => edge.source === supplyNodeId && edge.target === dispatcherNodeId)) {
        edges.push({
          id: `graph-candidate-supply-${supplyEndpointId}`,
          source: supplyNodeId,
          target: dispatcherNodeId,
          label: graphCandidatePercent(candidate),
        });
      }
      semanticCandidateTargets.add(supplyNodeId);
    }
    terminalLinkSource.current = dispatcherNodeId;
    for (let index = edges.length - 1; index >= 0; index -= 1) {
      const edge = edges[index];
      if (
        (
          edge.id.startsWith('graph-step:')
          && edge.source === dispatcherNodeId
          && (semanticCandidateTargets.has(edge.target) || semanticSupplyEndpointNodes.has(edge.target))
        )
        || (
          edge.id.startsWith('graph-edge:')
          && edge.target === dispatcherNodeId
          && semanticSupplyEndpointNodes.has(edge.source)
        )
      ) {
        edges.splice(index, 1);
      }
    }

    const syntheticStatus = graphSelection.syntheticResponse?.statusCode || 503;
    if (graphSelection.terminalKind === 'synthetic_endpoint') {
      nodes.push({
        id: 'graph:synthetic-response',
        kind: 'synthetic_endpoint',
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
    }

    return {
      version: 1,
      requestedModel,
      actualModel: target?.modelSource === 'request'
        ? graphSelection.currentModel
        : (target?.model || graphSelection.currentModel),
      matched: true,
      selectedRouteId: graphSelection.selectedRouteId ?? graphSelection.matchedRouteId ?? null,
      selectedAccountId: target?.accountId == null || typeof target.accountId !== 'number' ? null : target.accountId,
      routePattern: null,
      summary: graphSelection.terminalKind === 'synthetic_endpoint'
        ? [`route graph synthetic response ${syntheticStatus}`]
        : [
          `compiled graph selected route_endpoint`,
          graphSelection.selectedRouteId ? `route #${graphSelection.selectedRouteId}` : null,
          selectedPricingCandidate?.sourceRef?.endpointId
            ? `supply ${selectedPricingCandidate.sourceRef.endpointId}`
            : null,
        ].filter((line): line is string => !!line),
      nodes,
      edges,
      diagnostics,
      entryPricing: {
        theoretical: theoreticalEntryPricing,
      },
      compatibilityPolicy,
      compiledAt,
    };
  }

  nodes.push({
    id: 'graph:unmatched',
    kind: 'synthetic_endpoint',
    visibility: 'terminal',
    label: 'No route matched',
    subtitle: 'compiled route graph has no public entry for this model',
    status: 'blocked',
    badges: ['terminal', 'synthetic_endpoint'],
    metrics: {},
    history: [],
  });
  edges.push({ id: 'request-unmatched', source: 'request', target: 'graph:unmatched', label: 'match' });
  diagnostics.push({ level: 'warn', message: '当前模型没有命中启用路由图入口' });

  return {
    version: 1,
    requestedModel,
    actualModel: requestedModel,
    matched: false,
    selectedRouteId: null,
    selectedAccountId: null,
    routePattern: null,
    summary: ['no compiled route graph entry matched'],
    nodes,
    edges,
    diagnostics,
    compiledAt,
  };
}
