import { desc, eq } from 'drizzle-orm';
import { requireInsertedRowId } from '../db/insertHelpers.js';
import { db, schema } from '../db/index.js';
import {
  buildRouteGraphSourceFromLegacyRoutes,
  compileRouteGraphSource,
  legacyRouteIdToRouteGraphEntryNodeId,
  legacyRouteIdToRouteGraphPoolNodeId,
  normalizeRouteGraphSource,
  parseRouteGraphSource,
  stringifyRouteGraphSource,
  type CompiledRouteGraph,
  type RouteGraphCompileResult,
  type RouteGraphDiagnostic,
  type RouteGraphBackendSpec,
  type RouteGraphMatchSpec,
  type RouteGraphSource,
} from '../../shared/routeGraph.js';

export type ActiveRouteGraphVersion = {
  id: number;
  version: number;
  sourceGraph: RouteGraphSource;
  compiledGraph: CompiledRouteGraph;
  status: string;
  createdAt: string | null;
  activatedAt: string | null;
};

export type RouteGraphDraftState = {
  id: number;
  baseVersion: number | null;
  status: string;
  workingGraph: RouteGraphSource;
  diagnostics: RouteGraphDiagnostic[];
  updatedAt: string | null;
  stale: boolean;
};

export type RouteGraphLegacyProjection = {
  routeId: number;
  entryNodeId: string;
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
  sourceRouteIds: number[];
  modelPattern: string;
  routeMode: 'pattern' | 'explicit_group';
};

export type RouteGraphRouteBinding = {
  routeId: number;
  entryNodeId: string;
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
  sourceRouteIds: number[];
  exposedModelName: string;
  exactModelName: string;
  routeMode: 'pattern' | 'explicit_group';
};

function parseJsonObject<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function appendOwnershipDiagnostics(input: {
  baseGraph: RouteGraphSource;
  candidateGraph: RouteGraphSource;
  diagnostics: RouteGraphDiagnostic[];
}): void {
  const baseNodesById = new Map(input.baseGraph.nodes.map((node) => [node.id, node]));
  const candidateNodesById = new Map(input.candidateGraph.nodes.map((node) => [node.id, node]));
  for (const baseNode of input.baseGraph.nodes) {
    if (baseNode.ownership === 'manual') continue;
    const candidate = candidateNodesById.get(baseNode.id);
    if (!candidate) {
      input.diagnostics.push({
        severity: 'error',
        code: 'ownership.non_manual_delete',
        message: `Non-manual node ${baseNode.id} cannot be deleted from a draft.`,
        nodeId: baseNode.id,
      });
      continue;
    }
    if (candidate.ownership !== baseNode.ownership || stableStringify(candidate) !== stableStringify(baseNode)) {
      input.diagnostics.push({
        severity: 'error',
        code: 'ownership.non_manual_mutation',
        message: `Non-manual node ${baseNode.id} cannot be edited directly; clone it as manual first.`,
        nodeId: baseNode.id,
      });
    }
  }
  for (const candidateNode of input.candidateGraph.nodes) {
    if (candidateNode.ownership === 'manual' || baseNodesById.has(candidateNode.id)) continue;
    input.diagnostics.push({
      severity: 'error',
      code: 'ownership.non_manual_create',
      message: `Non-manual node ${candidateNode.id} cannot be created in a draft; create a manual source node or edit the owning macro/source instead.`,
      nodeId: candidateNode.id,
    });
  }

  const baseEdgesById = new Map(input.baseGraph.edges.map((edge) => [edge.id, edge]));
  const candidateEdgesById = new Map(input.candidateGraph.edges.map((edge) => [edge.id, edge]));
  for (const baseEdge of input.baseGraph.edges) {
    if (baseEdge.ownership === 'manual') continue;
    const candidate = candidateEdgesById.get(baseEdge.id);
    if (!candidate) {
      input.diagnostics.push({
        severity: 'error',
        code: 'ownership.non_manual_edge_delete',
        message: `Non-manual edge ${baseEdge.id} cannot be deleted from a draft.`,
        edgeId: baseEdge.id,
      });
      continue;
    }
    if (candidate.ownership !== baseEdge.ownership || stableStringify(candidate) !== stableStringify(baseEdge)) {
      input.diagnostics.push({
        severity: 'error',
        code: 'ownership.non_manual_edge_mutation',
        message: `Non-manual edge ${baseEdge.id} cannot be edited directly; clone the affected path as manual first.`,
        edgeId: baseEdge.id,
      });
    }
  }
  for (const candidateEdge of input.candidateGraph.edges) {
    if (candidateEdge.ownership === 'manual' || baseEdgesById.has(candidateEdge.id)) continue;
    input.diagnostics.push({
      severity: 'error',
      code: 'ownership.non_manual_edge_create',
      message: `Non-manual edge ${candidateEdge.id} cannot be created in a draft; create a manual edge or edit the owning macro/source instead.`,
      edgeId: candidateEdge.id,
    });
  }

  const baseMacrosById = new Map((input.baseGraph.macros || []).map((macro) => [macro.id, macro]));
  const candidateMacrosById = new Map((input.candidateGraph.macros || []).map((macro) => [macro.id, macro]));
  for (const baseMacro of input.baseGraph.macros || []) {
    if (baseMacro.ownership === 'manual') continue;
    const candidate = candidateMacrosById.get(baseMacro.id);
    if (!candidate) {
      input.diagnostics.push({
        severity: 'error',
        code: 'ownership.non_manual_macro_delete',
        message: `Non-manual macro ${baseMacro.id} cannot be deleted from a draft.`,
      });
      continue;
    }
    if (candidate.ownership !== baseMacro.ownership || stableStringify(candidate) !== stableStringify(baseMacro)) {
      input.diagnostics.push({
        severity: 'error',
        code: 'ownership.non_manual_macro_mutation',
        message: `Non-manual macro ${baseMacro.id} cannot be edited directly; clone it as manual first.`,
      });
    }
  }
  for (const candidateMacro of input.candidateGraph.macros || []) {
    if (candidateMacro.ownership === 'manual' || baseMacrosById.has(candidateMacro.id)) continue;
    input.diagnostics.push({
      severity: 'error',
      code: 'ownership.non_manual_macro_create',
      message: `Non-manual macro ${candidateMacro.id} cannot be created in a draft; create a manual macro or let the projection system generate it.`,
    });
  }
}

async function getNextGraphVersionNumber(): Promise<number> {
  const latest = await db.select().from(schema.routeGraphVersions)
    .orderBy(desc(schema.routeGraphVersions.version))
    .limit(1)
    .get();
  return Number(latest?.version || 0) + 1;
}

async function loadLegacyRouteGraphSource(): Promise<RouteGraphSource> {
  return await buildRouteGraphSourceFromCurrentProjectionTable(null);
}

function routeIdFromLegacyGraphNodeId(nodeId: string): number | null {
  const match = /^(entry|dispatcher|pool):legacy:(\d+)$/.exec(nodeId);
  if (!match) return null;
  const routeId = Number(match[2]);
  return Number.isFinite(routeId) && routeId > 0 ? routeId : null;
}

function isLegacyGraphNodeId(nodeId: string): boolean {
  return routeIdFromLegacyGraphNodeId(nodeId) !== null;
}

function removedReferenceNodeLegacyGroupRouteId(nodeId: string): number | null {
  const match = /^ref:legacy:(\d+):(\d+)$/.exec(nodeId);
  if (!match) return null;
  const routeId = Number(match[1]);
  return Number.isFinite(routeId) && routeId > 0 ? routeId : null;
}

function isProjectionOwnedNodeId(nodeId: string): boolean {
  return isLegacyGraphNodeId(nodeId) || removedReferenceNodeLegacyGroupRouteId(nodeId) !== null;
}

function isProjectionOwnedMacroId(macroId: string): boolean {
  return /^route:\d+:model-group$/.test(macroId);
}

function isEntryNode(node: { type?: string } | null | undefined): node is { type: 'entry'; match: RouteGraphMatchSpec; id: string } {
  return !!node && node.type === 'entry';
}

function routeIdFromProjectionCandidateNode(node: { id?: string; type?: string; match?: RouteGraphMatchSpec; legacyRouteId?: number | null } | null | undefined): number | null {
  if (!node) return null;
  const direct = Number(node.legacyRouteId);
  if (Number.isFinite(direct) && direct > 0) return Math.trunc(direct);
  if (node.type === 'entry') {
    const matchRouteId = Number(node.match?.routeId);
    if (Number.isFinite(matchRouteId) && matchRouteId > 0) return Math.trunc(matchRouteId);
  }
  const match = /^(?:entry|dispatcher|pool):legacy:(\d+)$/.exec(String(node.id || ''));
  if (!match) return null;
  const routeId = Number(match[1]);
  return Number.isFinite(routeId) && routeId > 0 ? routeId : null;
}

function routeIdFromProjectionEntryNode(node: { id?: string; type?: string; match?: RouteGraphMatchSpec; legacyRouteId?: number | null } | null | undefined): number | null {
  if (!node) return null;
  if (node.type === 'model_endpoint' || node.type === 'auto_node') {
    const direct = Number(node.legacyRouteId);
    if (Number.isFinite(direct) && direct > 0) return Math.trunc(direct);
    const match = /^(?:pool):legacy:(\d+)$/.exec(String(node.id || ''));
    if (match) {
      const routeId = Number(match[1]);
      return Number.isFinite(routeId) && routeId > 0 ? routeId : null;
    }
  }
  return routeIdFromProjectionCandidateNode(node);
}

function collectMatchAndBackendByLegacyRouteId(source: RouteGraphSource | null | undefined): Map<number, {
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
}> {
  const result = new Map<number, { match: RouteGraphMatchSpec; backend: RouteGraphBackendSpec }>();
  if (!source) return result;
  const compiled = compileRouteGraphSource(source);
  for (const entry of compiled.compiled.entries) {
    const routeId = Number(entry.match.routeId || routeIdFromLegacyGraphNodeId(entry.nodeId));
    if (!Number.isFinite(routeId) || routeId <= 0) continue;
    result.set(routeId, {
      match: entry.match,
      backend: entry.backend,
    });
  }
  return result;
}

export async function buildRouteGraphSourceFromCurrentProjectionTable(
  baseSource?: RouteGraphSource | null,
  routeOverrides: Map<number, { match: RouteGraphMatchSpec; backend: RouteGraphBackendSpec }> = new Map(),
): Promise<RouteGraphSource> {
  const [routes, groupSources, routeChannels] = await Promise.all([
    db.select().from(schema.tokenRoutes).all(),
    db.select().from(schema.routeGroupSources).all(),
    db.select().from(schema.routeChannels).all(),
  ]);
  const previousProjectionByRouteId = collectMatchAndBackendByLegacyRouteId(baseSource);
  const sourceRouteIdsByGroupRouteId = new Map<number, number[]>();
  for (const source of groupSources) {
    const existing = sourceRouteIdsByGroupRouteId.get(source.groupRouteId) || [];
    existing.push(source.sourceRouteId);
    sourceRouteIdsByGroupRouteId.set(source.groupRouteId, existing);
  }
  const targetsByRouteId = new Map<number, Array<Record<string, unknown>>>();
  const sourceModelsByRouteId = new Map<number, string[]>();
  for (const channel of routeChannels) {
    const sourceModel = String(channel.sourceModel || '').trim();
    const existingTargets = targetsByRouteId.get(channel.routeId) || [];
    existingTargets.push({
      channelId: String(channel.id),
      model: sourceModel,
      modelSource: sourceModel ? 'fixed' : 'request',
      accountId: channel.accountId,
      tokenId: channel.tokenId,
      weight: channel.weight,
      priority: channel.priority,
      metadata: {
        routeChannelId: channel.id,
        oauthRouteUnitId: channel.oauthRouteUnitId,
        enabled: channel.enabled !== false,
        manualOverride: channel.manualOverride === true,
        successCount: channel.successCount || 0,
        failCount: channel.failCount || 0,
        consecutiveFailCount: channel.consecutiveFailCount || 0,
        cooldownLevel: channel.cooldownLevel || 0,
        cooldownUntil: channel.cooldownUntil || null,
      },
    });
    targetsByRouteId.set(channel.routeId, existingTargets);
    if (!sourceModel) {
      continue;
    }
    const existing = sourceModelsByRouteId.get(channel.routeId) || [];
    if (!existing.includes(sourceModel)) existing.push(sourceModel);
    sourceModelsByRouteId.set(channel.routeId, existing);
  }
  const accountIdsWithRouteChannels = Array.from(new Set(routeChannels.map((channel) => channel.accountId)));
  const availableModelsByAccountId = new Map<number, string[]>();
  if (accountIdsWithRouteChannels.length > 0) {
    const availabilityRows = await db.select().from(schema.modelAvailability).all();
    for (const row of availabilityRows) {
      if (!row.available || !accountIdsWithRouteChannels.includes(row.accountId)) continue;
      const modelName = String(row.modelName || '').trim();
      if (!modelName) continue;
      const existing = availableModelsByAccountId.get(row.accountId) || [];
      if (!existing.includes(modelName)) existing.push(modelName);
      availableModelsByAccountId.set(row.accountId, existing);
    }
  }
  for (const channel of routeChannels) {
    if (sourceModelsByRouteId.has(channel.routeId)) continue;
    const accountModels = availableModelsByAccountId.get(channel.accountId) || [];
    const route = routes.find((item) => item.id === channel.routeId);
    const routeDisplayName = typeof route?.displayName === 'string' ? route.displayName.trim() : '';
    const exactRouteModel = routeDisplayName && !/[*?]/.test(routeDisplayName) && !routeDisplayName.startsWith('re:')
      ? routeDisplayName
      : '';
    const inferredModel = exactRouteModel || (accountModels.length === 1 ? accountModels[0] : '');
    if (!inferredModel) continue;
    sourceModelsByRouteId.set(channel.routeId, [inferredModel]);
    const targets = targetsByRouteId.get(channel.routeId) || [];
    for (const target of targets) {
      if (target.channelId === String(channel.id) && typeof target.model === 'string' && !target.model) {
        target.model = inferredModel;
        target.modelSource = 'fixed';
      }
    }
  }
  return buildRouteGraphSourceFromLegacyRoutes(routes.map((route) => {
    const sourceRouteIds = sourceRouteIdsByGroupRouteId.get(route.id) || [];
    const isExplicitGroup = sourceRouteIds.length > 0;
    const sourceModels = sourceModelsByRouteId.get(route.id) || [];
    const previous = routeOverrides.get(route.id) ?? previousProjectionByRouteId.get(route.id);
    const previousMatch = previous?.match;
    const inferredPattern = previousMatch?.requestedModelPattern
      || (isExplicitGroup ? '' : (sourceModels.length === 1 ? sourceModels[0] : ''))
      || route.displayName
      || '';
    const inferredDisplayName = route.displayName ?? previousMatch?.displayName ?? null;
    return {
      ...route,
      match: {
        kind: 'model',
        requestedModelPattern: isExplicitGroup ? '' : inferredPattern,
        displayName: inferredDisplayName,
        routeId: route.id,
      },
      backend: isExplicitGroup
        ? { kind: 'routes', routeIds: sourceRouteIds }
        : { kind: 'channels' },
      ownership: route.ownership || 'auto_generated',
      targets: targetsByRouteId.get(route.id) || [],
    };
  }));
}

export async function reconcileActiveGraphWithProjectionTable(
  active: ActiveRouteGraphVersion,
  routeOverrides: Map<number, { match: RouteGraphMatchSpec; backend: RouteGraphBackendSpec }> = new Map(),
): Promise<ActiveRouteGraphVersion> {
  const projectionSource = await buildRouteGraphSourceFromCurrentProjectionTable(active.sourceGraph, routeOverrides);
  const keptNodes = active.sourceGraph.nodes.filter((node) => !isProjectionOwnedNodeId(node.id));
  const nextNodes = [...keptNodes, ...projectionSource.nodes];
  const nextNodeIds = new Set(nextNodes.map((node) => node.id));
  const keptEdges = active.sourceGraph.edges.filter((edge) => (
    nextNodeIds.has(edge.sourceNodeId)
    && nextNodeIds.has(edge.targetNodeId)
    && !isProjectionOwnedNodeId(edge.sourceNodeId)
    && !isProjectionOwnedNodeId(edge.targetNodeId)
  ));
  const keptMacros = (active.sourceGraph.macros || []).filter((macro) => !isProjectionOwnedMacroId(macro.id));
  const nextSource = normalizeRouteGraphSource({
    ...active.sourceGraph,
    nodes: nextNodes,
    edges: [...keptEdges, ...projectionSource.edges],
    macros: [...keptMacros, ...(projectionSource.macros || [])],
  });
  if (JSON.stringify(nextSource) === JSON.stringify(active.sourceGraph)) {
    return active;
  }
  const published = await publishRouteGraphSource({
    sourceGraph: nextSource,
    createdBy: 'projection-reconcile',
    allowDiagnostics: true,
  });
  if (!published.ok) {
    throw new Error(`Cannot reconcile route graph projection: ${published.diagnostics.map((item) => item.message).join('; ')}`);
  }
  return published.version;
}

async function markDraftsStaleExceptBase(activeVersionId: number): Promise<void> {
  const activeDrafts = await db.select().from(schema.routeGraphDrafts)
    .where(eq(schema.routeGraphDrafts.status, 'active'))
    .all();
  for (const draft of activeDrafts) {
    if (draft.baseVersion === activeVersionId) continue;
    await db.update(schema.routeGraphDrafts).set({
      status: 'stale',
      updatedAt: nowIso(),
    }).where(eq(schema.routeGraphDrafts.id, draft.id)).run();
  }
}

export async function publishRouteGraphSource(input: {
  sourceGraph: unknown;
  createdBy?: string;
  allowDiagnostics?: boolean;
}): Promise<{ ok: true; version: ActiveRouteGraphVersion; diagnostics: RouteGraphDiagnostic[] } | { ok: false; diagnostics: RouteGraphDiagnostic[] }> {
  const compiled = compileRouteGraphSource(input.sourceGraph);
  if (!compiled.ok && !input.allowDiagnostics) {
    return { ok: false, diagnostics: compiled.diagnostics };
  }

  const timestamp = nowIso();
  const versionNumber = await getNextGraphVersionNumber();
  await db.update(schema.routeGraphVersions).set({ status: 'archived' })
    .where(eq(schema.routeGraphVersions.status, 'active'))
    .run();
  const inserted = await db.insert(schema.routeGraphVersions).values({
    version: versionNumber,
    sourceGraphJson: JSON.stringify(compiled.source),
    compiledGraphJson: JSON.stringify(compiled.compiled),
    status: 'active',
    createdBy: input.createdBy || 'system',
    createdAt: timestamp,
    activatedAt: timestamp,
  });
  const versionId = requireInsertedRowId(inserted, 'Failed to create route graph version');

  const previousActiveRows = await db.select().from(schema.routeGraphActiveVersion).all();
  for (const row of previousActiveRows) {
    await db.delete(schema.routeGraphActiveVersion).where(eq(schema.routeGraphActiveVersion.id, row.id)).run();
  }
  await db.update(schema.routeGraphVersions).set({ status: 'active', activatedAt: timestamp })
    .where(eq(schema.routeGraphVersions.id, versionId))
    .run();
  await db.insert(schema.routeGraphActiveVersion).values({
    id: 1,
    versionId,
    updatedAt: timestamp,
  }).run();
  await markDraftsStaleExceptBase(versionId);

  const version = await getActiveRouteGraphVersion();
  if (!version) {
    throw new Error('Failed to load newly published route graph version');
  }
  return { ok: true, version, diagnostics: compiled.diagnostics };
}

export async function ensureActiveRouteGraphVersion(): Promise<ActiveRouteGraphVersion> {
  const active = await getActiveRouteGraphVersion();
  if (active) return await reconcileActiveGraphWithProjectionTable(active);

  const sourceGraph = await loadLegacyRouteGraphSource();
  const published = await publishRouteGraphSource({
    sourceGraph,
    createdBy: 'legacy-migration',
    allowDiagnostics: true,
  });
  if (!published.ok) {
    throw new Error(`Cannot bootstrap route graph: ${published.diagnostics.map((item) => item.message).join('; ')}`);
  }
  return await reconcileActiveGraphWithProjectionTable(published.version);
}

export async function getActiveRouteGraphVersion(): Promise<ActiveRouteGraphVersion | null> {
  const pointer = await db.select().from(schema.routeGraphActiveVersion).where(eq(schema.routeGraphActiveVersion.id, 1)).get();
  if (!pointer) return null;
  const row = await db.select().from(schema.routeGraphVersions)
    .where(eq(schema.routeGraphVersions.id, pointer.versionId))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    sourceGraph: parseRouteGraphSource(row.sourceGraphJson),
    compiledGraph: parseJsonObject<CompiledRouteGraph>(row.compiledGraphJson, compileRouteGraphSource(null).compiled),
    status: row.status,
    createdAt: row.createdAt,
    activatedAt: row.activatedAt,
  };
}

async function getLatestRouteGraphDraftRow() {
  return await db.select().from(schema.routeGraphDrafts)
    .orderBy(desc(schema.routeGraphDrafts.updatedAt))
    .limit(1)
    .get();
}

export async function getRouteGraphDraft(): Promise<RouteGraphDraftState> {
  const active = await ensureActiveRouteGraphVersion();
  const draft = await getLatestRouteGraphDraftRow();
  if (!draft) {
    return {
      id: 0,
      baseVersion: active.id,
      status: 'active',
      workingGraph: active.sourceGraph,
      diagnostics: [],
      updatedAt: null,
      stale: false,
    };
  }
  return {
    id: draft.id,
    baseVersion: draft.baseVersion,
    status: draft.status,
    workingGraph: parseRouteGraphSource(draft.workingGraphJson),
    diagnostics: parseJsonObject<RouteGraphDiagnostic[]>(draft.diagnosticsJson, []),
    updatedAt: draft.updatedAt,
    stale: draft.baseVersion !== active.id,
  };
}

export async function saveRouteGraphDraft(sourceGraph: unknown): Promise<RouteGraphDraftState> {
  const active = await ensureActiveRouteGraphVersion();
  const normalized = normalizeRouteGraphSource(sourceGraph);
  const validation: RouteGraphCompileResult = compileRouteGraphSource(normalized);
  appendOwnershipDiagnostics({
    baseGraph: active.sourceGraph,
    candidateGraph: normalized,
    diagnostics: validation.diagnostics,
  });
  const timestamp = nowIso();
  const existing = await db.select().from(schema.routeGraphDrafts)
    .where(eq(schema.routeGraphDrafts.status, 'active'))
    .limit(1)
    .get();
  if (existing) {
    await db.update(schema.routeGraphDrafts).set({
      workingGraphJson: stringifyRouteGraphSource(normalized),
      diagnosticsJson: JSON.stringify(validation.diagnostics),
      updatedAt: timestamp,
      status: existing.baseVersion === active.id ? 'active' : 'stale',
    }).where(eq(schema.routeGraphDrafts.id, existing.id)).run();
  } else {
    await db.insert(schema.routeGraphDrafts).values({
      baseVersion: active.id,
      workingGraphJson: stringifyRouteGraphSource(normalized),
      status: 'active',
      diagnosticsJson: JSON.stringify(validation.diagnostics),
      updatedAt: timestamp,
    }).run();
  }
  return await getRouteGraphDraft();
}

export async function validateRouteGraphDraft(sourceGraph: unknown): Promise<RouteGraphCompileResult> {
  return compileRouteGraphSource(sourceGraph);
}

export async function publishRouteGraphDraft(): Promise<{ ok: true; version: ActiveRouteGraphVersion; diagnostics: RouteGraphDiagnostic[] } | { ok: false; stale?: boolean; diagnostics: RouteGraphDiagnostic[] }> {
  const active = await ensureActiveRouteGraphVersion();
  const draft = await getRouteGraphDraft();
  if (draft.stale || draft.baseVersion !== active.id) {
    return {
      ok: false,
      stale: true,
      diagnostics: [{
        severity: 'error',
        code: 'draft.stale',
        message: 'Draft is based on an older active graph version and must be rebased before publish.',
      }],
    };
  }
  const validation = compileRouteGraphSource(draft.workingGraph);
  appendOwnershipDiagnostics({
    baseGraph: active.sourceGraph,
    candidateGraph: draft.workingGraph,
    diagnostics: validation.diagnostics,
  });
  if (validation.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return {
      ok: false,
      diagnostics: validation.diagnostics,
    };
  }
  const published = await publishRouteGraphSource({ sourceGraph: draft.workingGraph, createdBy: 'manual' });
  if (!published.ok) return published;
  if (draft.id > 0) {
    await db.update(schema.routeGraphDrafts).set({
      status: 'published',
      diagnosticsJson: JSON.stringify(published.diagnostics),
      updatedAt: nowIso(),
    }).where(eq(schema.routeGraphDrafts.id, draft.id)).run();
  }
  return published;
}

export async function discardRouteGraphDraft(): Promise<void> {
  const draft = await getLatestRouteGraphDraftRow();
  if (!draft) return;
  await db.update(schema.routeGraphDrafts).set({
    status: 'discarded',
    updatedAt: nowIso(),
  }).where(eq(schema.routeGraphDrafts.id, draft.id)).run();
}

export async function rebaseRouteGraphDraft(): Promise<RouteGraphDraftState> {
  const active = await ensureActiveRouteGraphVersion();
  const draftRow = await getLatestRouteGraphDraftRow();
  if (!draftRow) {
    return await saveRouteGraphDraft({
      version: 1,
      nodes: active.sourceGraph.nodes,
      edges: active.sourceGraph.edges,
      macros: active.sourceGraph.macros || [],
      metadata: active.sourceGraph.metadata || {},
    });
  }
  const draft = {
    id: draftRow.id,
    baseVersion: draftRow.baseVersion,
    status: draftRow.status,
    workingGraph: parseRouteGraphSource(draftRow.workingGraphJson),
    diagnostics: parseJsonObject<RouteGraphDiagnostic[]>(draftRow.diagnosticsJson, []),
    updatedAt: draftRow.updatedAt,
    stale: draftRow.baseVersion !== active.id,
  };
  const manualNodes = draft.workingGraph.nodes.filter((node) => node.ownership === 'manual');
  const manualEdges = draft.workingGraph.edges.filter((edge) => edge.ownership === 'manual');
  const manualMacros = (draft.workingGraph.macros || []).filter((macro) => macro.ownership === 'manual');
  const autoNodes = active.sourceGraph.nodes.filter((node) => node.ownership !== 'manual');
  const autoEdges = active.sourceGraph.edges.filter((edge) => edge.ownership !== 'manual');
  const autoMacros = (active.sourceGraph.macros || []).filter((macro) => macro.ownership !== 'manual');
  return await saveRouteGraphDraft({
    version: 1,
    nodes: [...autoNodes, ...manualNodes],
    edges: [...autoEdges, ...manualEdges],
    macros: [...autoMacros, ...manualMacros],
    metadata: {
      ...(draft.workingGraph.metadata || {}),
      rebasedFromVersion: draft.baseVersion,
      rebasedToVersion: active.id,
      rebasedAt: nowIso(),
    },
  });
}

export async function loadRouteGraphLegacyProjections(): Promise<Map<number, RouteGraphLegacyProjection>> {
  const bindings = await loadActiveRouteGraphRouteBindings();
  return new Map(Array.from(bindings.entries()).map(([routeId, binding]) => [routeId, {
    routeId: binding.routeId,
    entryNodeId: binding.entryNodeId,
    match: binding.match,
    backend: binding.backend,
    sourceRouteIds: binding.sourceRouteIds,
    modelPattern: binding.exposedModelName,
    routeMode: binding.routeMode,
  }]));
}

export async function loadActiveRouteGraphRouteBindings(): Promise<Map<number, RouteGraphRouteBinding>> {
  const active = await ensureActiveRouteGraphVersion();
  const primitiveSource = compileRouteGraphSource(active.sourceGraph).primitiveSource ?? active.sourceGraph;
  const byEntryId = new Map(primitiveSource.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, typeof primitiveSource.edges>();
  const incoming = new Map<string, typeof primitiveSource.edges>();
  for (const edge of primitiveSource.edges) {
    if (!outgoing.has(edge.sourceNodeId)) outgoing.set(edge.sourceNodeId, []);
    outgoing.get(edge.sourceNodeId)!.push(edge);
    if (!incoming.has(edge.targetNodeId)) incoming.set(edge.targetNodeId, []);
    incoming.get(edge.targetNodeId)!.push(edge);
  }
  const projection = new Map<number, RouteGraphRouteBinding>();
  for (const node of primitiveSource.nodes) {
    if (node.type !== 'entry') continue;
    if (node.enabled === false) continue;
    const routeId = Number(node.match.routeId || String(node.id).replace(/^entry:legacy:/, ''));
    if (!Number.isFinite(routeId) || routeId <= 0) continue;
    const targetEdges = (outgoing.get(node.id) || [])
      .filter((edge) => edge.sourcePortId === 'bidirect.out');
    const sourceRouteIds: number[] = [];
    for (const edge of targetEdges) {
      const targetId = edge.targetNodeId;
      const target = byEntryId.get(targetId);
      if (!target) continue;
      if (target.type === 'dispatcher' && target.mode === 'route') {
        const routeCandidateEdges = (incoming.get(target.id) || [])
          .filter((candidateEdge) => candidateEdge.targetPortId === 'route.in');
        for (const candidateEdge of routeCandidateEdges) {
          const source = byEntryId.get(candidateEdge.sourceNodeId);
          const sourceRouteId = routeIdFromProjectionEntryNode(source);
          if (sourceRouteId) sourceRouteIds.push(sourceRouteId);
        }
        continue;
      }
    }
    const uniqueSourceRouteIds = Array.from(new Set(sourceRouteIds));
    const groupSourceRouteIds = uniqueSourceRouteIds.filter((sourceRouteId) => sourceRouteId !== routeId);
    const routeMode = groupSourceRouteIds.length === 0 ? 'pattern' : 'explicit_group';
    const modelPattern = routeMode === 'explicit_group'
      ? (node.match.displayName || node.match.requestedModelPattern || '')
      : (node.match.requestedModelPattern || node.match.displayName || '');
    projection.set(routeId, {
      routeId,
      entryNodeId: node.id,
      match: node.match,
      backend: routeMode === 'explicit_group'
        ? { kind: 'routes', routeIds: groupSourceRouteIds }
        : { kind: 'channels' },
      sourceRouteIds: routeMode === 'explicit_group' ? groupSourceRouteIds : [],
      exposedModelName: modelPattern,
      exactModelName: routeMode === 'explicit_group' ? '' : (node.match.requestedModelPattern || ''),
      routeMode,
    });
  }
  return projection;
}
