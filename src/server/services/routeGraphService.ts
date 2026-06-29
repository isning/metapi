import { desc, eq, inArray, sql } from 'drizzle-orm';
import { requireInsertedRowId } from '../db/insertHelpers.js';
import { db, schema } from '../db/index.js';
import {
  loadRouteBindingProjectionMap,
  loadRouteBindingProjectionsForRouteIds,
  syncRouteBindingProjectionsFromRouteTable,
  upsertRouteBindingProjections,
} from './routeTableProjectionService.js';
import {
  buildRouteGraphSourceFromLegacyRoutes,
  type CompiledRouterBundle,
  compileRouteGraphSource,
  deriveLegacyModelPatternFromSpecs,
  legacyRouteIdToRouteGraphEntryNodeId,
  normalizeRouteGraphBackendSpec,
  normalizeRouteGraphMatchSpec,
  normalizeRouteGraphSource,
  parseRouteGraphSource,
  routeGraphAutoModelProductEndpointId,
  routeGraphRouteProductEndpointIdFromRoute,
  routeGraphSupplyEndpointIdFromIdentity,
  stringifyRouteGraphSource,
  type CompiledRouteGraph,
  type RouteGraphCompileResult,
  type RouteGraphDiagnostic,
  type RouteGraphBackendSpec,
  type RouteGraphMatchSpec,
  type RouteGraphEndpointExposure,
  type RouteGraphEndpointKind,
  type RouteGraphEndpointResolutionStatus,
  type RouteGraphEndpointSourceKind,
  type RouteGraphVisibility,
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

export type ActiveRouteGraphSourceVersion = Omit<ActiveRouteGraphVersion, 'compiledGraph'>;

export type ActiveRouteGraphRuntimeVersion = {
  id: number;
  version: number;
  compiledGraph: {
    hash?: string;
    compiledRouterBundle?: CompiledRouterBundle;
    flatProgramBundle?: CompiledRouteGraph['flatProgramBundle'];
  };
};

export type ActiveRouteGraphSummary = {
  version: {
    id: number;
    version: number;
    status: string;
    createdAt: string | null;
    activatedAt: string | null;
  };
  sourceSummary: {
    nodes: number;
    edges: number;
    macros: number;
  };
  hashes: {
    sourceGraph: string;
    compiledGraph: string | null;
  };
};

export type RouteGraphVersionSummary = {
  id: number;
  version: number;
  status: string;
  createdBy: string | null;
  createdAt: string | null;
  activatedAt: string | null;
  sourceSummary: {
    nodes: number;
    edges: number;
    macros: number;
    publicModels: number;
  };
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

export type RouteGraphRouteTableBinding = {
  routeId: number;
  entryNodeId: string;
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
  visibility: RouteGraphVisibility;
  sourceRouteIds: number[];
  modelPattern: string;
  routeMode: 'pattern' | 'explicit_group';
};

export type RouteGraphRouteBinding = {
  routeId: number;
  entryNodeId: string;
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
  visibility: RouteGraphVisibility;
  sourceRouteIds: number[];
  exposedModelName: string;
  exactModelName: string;
  routeMode: 'pattern' | 'explicit_group';
};

export type RouteEndpointCatalogItem = {
  endpointId: string;
  nodeId: string;
  routeId: number | null;
  label: string;
  endpointKind: RouteGraphEndpointKind;
  exposure: RouteGraphEndpointExposure;
  resolutionStatus: RouteGraphEndpointResolutionStatus;
  ownerKind: 'automatic_route' | 'manual_route' | 'macro';
  sourceKind: RouteGraphEndpointSourceKind;
  enabled: boolean;
  displayIcon: string | null;
  modelPattern: string;
  publicModelName: string | null;
  upstreamModels: string[];
  siteNames: string[];
  targetCount: number;
  sourceRouteIds: number[];
  tags: string[];
  metadata: Record<string, unknown>;
};

export type RouteEndpointCatalogPageInfo = {
  page: number;
  pageSize: number;
  totalCount: number;
  hasMore: boolean;
};

export type RouteEndpointCatalogQuery = {
  page?: number;
  pageSize?: number;
  endpointKind?: 'all' | RouteGraphEndpointKind;
  routeId?: number | null;
  siteId?: number | null;
  q?: string | null;
};

export type RouteEndpointCatalogPage = {
  items: RouteEndpointCatalogItem[];
  pageInfo: RouteEndpointCatalogPageInfo;
};

export type RouteEndpointSourceRouteResolution = {
  routeIds: number[];
  missingEndpointIds: string[];
  unresolvedEndpointIds: string[];
};

export class RouteGraphSyncValidationError extends Error {
  diagnostics: RouteGraphDiagnostic[];

  constructor(diagnostics: RouteGraphDiagnostic[]) {
    super(`Cannot reconcile route graph sync: ${diagnostics.map((item) => item.message).join('; ')}`);
    this.name = 'RouteGraphSyncValidationError';
    this.diagnostics = diagnostics;
  }
}

function parseJsonObject<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const EMPTY_COMPILED_ROUTE_GRAPH = compileRouteGraphSource(null).compiled;
const EMPTY_ROUTE_GRAPH_SOURCE = parseRouteGraphSource(null);

let activeRouteGraphCache: {
  versionId: number;
  version: ActiveRouteGraphVersion;
  compactedIdentity: boolean;
} | null = null;

let activeRouteGraphSourceCache: {
  versionId: number;
  version: ActiveRouteGraphSourceVersion;
  compactedIdentity: boolean;
} | null = null;

let activeRouteGraphRuntimeCache: {
  versionId: number;
  version: ActiveRouteGraphRuntimeVersion;
} | null = null;

let activeRouteGraphSummaryCache: {
  versionId: number;
  summary: ActiveRouteGraphSummary;
} | null = null;

let activeRouteGraphBindingsCache: {
  versionId: number;
  bindings: Map<number, RouteGraphRouteBinding>;
} | null = null;

export function invalidateRouteGraphReadCaches(): void {
  activeRouteGraphCache = null;
  activeRouteGraphSourceCache = null;
  activeRouteGraphRuntimeCache = null;
  activeRouteGraphSummaryCache = null;
  activeRouteGraphBindingsCache = null;
}

function activeVersionMetadata(input: ActiveRouteGraphSourceVersion): ActiveRouteGraphSummary['version'] {
  return {
    id: input.id,
    version: input.version,
    status: input.status,
    createdAt: input.createdAt,
    activatedAt: input.activatedAt,
  };
}

function summarizeActiveRouteGraphVersion(input: ActiveRouteGraphSourceVersion, compiledHash: string | null = null): ActiveRouteGraphSummary {
  return {
    version: activeVersionMetadata(input),
    sourceSummary: {
      nodes: input.sourceGraph.nodes.length,
      edges: input.sourceGraph.edges.length,
      macros: (input.sourceGraph.macros || []).length,
    },
    hashes: {
      sourceGraph: `version:${input.id}`,
      compiledGraph: compiledHash,
    },
  };
}

function sourceVersionFromActiveVersion(input: ActiveRouteGraphVersion): ActiveRouteGraphSourceVersion {
  return {
    id: input.id,
    version: input.version,
    sourceGraph: input.sourceGraph,
    status: input.status,
    createdAt: input.createdAt,
    activatedAt: input.activatedAt,
  };
}

function runtimeVersionFromActiveVersion(input: ActiveRouteGraphVersion): ActiveRouteGraphRuntimeVersion {
  const runtimeCompiledGraph: ActiveRouteGraphRuntimeVersion['compiledGraph'] = {
    hash: input.compiledGraph.hash,
  };
  if (input.compiledGraph.compiledRouterBundle) {
    runtimeCompiledGraph.compiledRouterBundle = input.compiledGraph.compiledRouterBundle;
  } else if (input.compiledGraph.flatProgramBundle) {
    runtimeCompiledGraph.flatProgramBundle = input.compiledGraph.flatProgramBundle;
  }
  return {
    id: input.id,
    version: input.version,
    compiledGraph: runtimeCompiledGraph,
  };
}

function cacheActiveSourceVersion(input: ActiveRouteGraphSourceVersion, compactedIdentity?: boolean): void {
  activeRouteGraphSourceCache = {
    versionId: input.id,
    version: input,
    compactedIdentity: compactedIdentity ?? hasCompactedRouteEndpointIdentity(input.sourceGraph),
  };
}

async function getActiveRouteGraphVersionId(): Promise<number | null> {
  const pointer = await db.select().from(schema.routeGraphActiveVersion).where(eq(schema.routeGraphActiveVersion.id, 1)).get();
  return pointer?.versionId ?? null;
}

function hasRouteProgramBundle(compiledGraph: CompiledRouteGraph | null | undefined): boolean {
  const candidateGraph = compiledGraph as { programBundle?: unknown; flatProgramBundle?: unknown } | null | undefined;
  const bundle = candidateGraph?.programBundle;
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return false;
  const candidate = bundle as {
    version?: unknown;
    matcher?: unknown;
    programs?: unknown;
    diagnostics?: unknown;
  };
  if (candidate.version !== 1 || !candidate.matcher || typeof candidate.matcher !== 'object' || !Array.isArray(candidate.programs)) {
    return false;
  }
  if (Array.isArray(candidate.diagnostics) && candidate.diagnostics.some((diagnostic) => (
    diagnostic
    && typeof diagnostic === 'object'
    && !Array.isArray(diagnostic)
    && (diagnostic as { severity?: unknown }).severity === 'error'
    && String((diagnostic as { code?: unknown }).code || '').startsWith('program.')
  ))) {
    return false;
  }
  const hasOperationProgram = candidate.programs.some((program) => (
    program
    && typeof program === 'object'
    && !Array.isArray(program)
    && typeof (program as { startOpId?: unknown }).startOpId === 'string'
    && !!String((program as { startOpId?: unknown }).startOpId).trim()
    && Array.isArray((program as { ops?: unknown }).ops)
  ));
  if (!hasOperationProgram) return false;

  const flatBundle = candidateGraph?.flatProgramBundle;
  if (!flatBundle || typeof flatBundle !== 'object' || Array.isArray(flatBundle)) return false;
  const flatCandidate = flatBundle as {
    version?: unknown;
    matcher?: unknown;
    programs?: unknown;
    diagnostics?: unknown;
  };
  if (flatCandidate.version !== 1 || !flatCandidate.matcher || typeof flatCandidate.matcher !== 'object' || !Array.isArray(flatCandidate.programs)) {
    return false;
  }
  if (Array.isArray(flatCandidate.diagnostics) && flatCandidate.diagnostics.some((diagnostic) => (
    diagnostic
    && typeof diagnostic === 'object'
    && !Array.isArray(diagnostic)
    && (diagnostic as { severity?: unknown }).severity === 'error'
    && (
      String((diagnostic as { code?: unknown }).code || '').startsWith('program.')
      || String((diagnostic as { code?: unknown }).code || '').startsWith('flat_program.')
    )
  ))) {
    return false;
  }
  const hasFlatProgram = flatCandidate.programs.some((program) => (
    program
    && typeof program === 'object'
    && !Array.isArray(program)
    && !!(program as { start?: unknown }).start
  ));
  return hasFlatProgram;
}

function hasLegacyRouteProgramBundles(compiledGraph: CompiledRouteGraph | null | undefined): boolean {
  const candidateGraph = compiledGraph as { programBundle?: unknown; flatProgramBundle?: unknown } | null | undefined;
  return candidateGraph?.programBundle !== undefined || candidateGraph?.flatProgramBundle !== undefined;
}

function hasCompiledRouterBundle(compiledGraph: CompiledRouteGraph | null | undefined): boolean {
  const candidateGraph = compiledGraph as { compiledRouterBundle?: unknown } | null | undefined;
  const bundle = candidateGraph?.compiledRouterBundle;
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return false;
  const candidate = bundle as {
    version?: unknown;
    matcher?: unknown;
    plans?: unknown;
    diagnostics?: unknown;
  };
  if (candidate.version !== 2 || !candidate.matcher || typeof candidate.matcher !== 'object' || !Array.isArray(candidate.plans)) {
    return false;
  }
  if (Array.isArray(candidate.diagnostics) && candidate.diagnostics.some((diagnostic) => (
    diagnostic
    && typeof diagnostic === 'object'
    && !Array.isArray(diagnostic)
    && (diagnostic as { severity?: unknown }).severity === 'error'
    && String((diagnostic as { code?: unknown }).code || '').startsWith('compiled_router.')
  ))) {
    return false;
  }
  return true;
}

function hasCompactedRouteEndpointIdentity(sourceGraph: RouteGraphSource): boolean {
  return sourceGraph.nodes.some((node) => {
    if (
      node.type !== 'route_endpoint'
      || node.ownership !== 'auto_generated'
      || !node.metadata
      || typeof node.metadata !== 'object'
      || Array.isArray(node.metadata)
    ) {
      return false;
    }
    const metadata = node.metadata as Record<string, unknown>;
    const endpointIdentity = metadata.endpointIdentity;
    if (!endpointIdentity || typeof endpointIdentity !== 'object' || Array.isArray(endpointIdentity)) return false;
    const identity = endpointIdentity as Record<string, unknown>;
    return typeof identity.targetSetFingerprint === 'string'
      && !Array.isArray(identity.targets);
  });
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

function stableHash(value: unknown): string {
  const input = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeIdentityText(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function buildCredentialFingerprint(input: {
  site?: { platform?: string | null; url?: string | null } | null;
  account?: { username?: string | null; apiToken?: string | null; accessToken?: string | null; oauthProvider?: string | null; oauthAccountKey?: string | null; oauthProjectId?: string | null } | null;
  token?: { name?: string | null; token?: string | null; tokenGroup?: string | null; source?: string | null; isDefault?: boolean | null } | null;
}): string {
  const account = input.account;
  const token = input.token;
  const tokenHash = token?.token ? stableHash(String(token.token)) : '';
  const oauthIdentity = account?.oauthProvider || account?.oauthAccountKey || account?.oauthProjectId
    ? {
      mode: 'oauth',
      provider: normalizeIdentityText(account.oauthProvider),
      accountKey: normalizeIdentityText(account.oauthAccountKey),
      projectId: normalizeIdentityText(account.oauthProjectId),
    }
    : null;
  return stableHash({
    sitePlatform: normalizeIdentityText(input.site?.platform),
    siteUrl: normalizeIdentityText(input.site?.url),
    account: oauthIdentity || {
      mode: account?.apiToken ? 'api_key' : 'session',
      username: normalizeIdentityText(account?.username),
      apiTokenHash: account?.apiToken ? stableHash(String(account.apiToken)) : '',
      accessTokenHash: account?.accessToken ? stableHash(String(account.accessToken)) : '',
    },
    token: tokenHash
      ? { tokenHash }
      : {
        name: normalizeIdentityText(token?.name),
        tokenGroup: normalizeIdentityText(token?.tokenGroup),
        source: normalizeIdentityText(token?.source),
        isDefault: token?.isDefault === true,
      },
  });
}

function buildRouteEndpointIdentityFromTargets(targets: Array<Record<string, unknown>>, fallbackModel = ''): Record<string, unknown> | undefined {
  const stableTargets = Array.from(
    new Map(targets
      .filter((target) => target && typeof target === 'object')
      .map((target) => {
        const targetModel = String(target.model || '').trim();
        const normalizedTarget = targetModel || !fallbackModel
          ? target
          : { ...target, model: fallbackModel };
        return [stableStringify(normalizedTarget), normalizedTarget];
      }))
      .values(),
  ).sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
  if (stableTargets.length === 0) return undefined;
  if (stableTargets.length === 1) {
    return stableTargets[0];
  }

  const uniqueTexts = (values: unknown[]) => Array.from(new Set(values
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
  const providers = uniqueTexts(stableTargets.map((target) => target.provider || target.sitePlatform));
  const siteUrls = uniqueTexts(stableTargets.map((target) => target.siteUrl));
  const siteNames = uniqueTexts(stableTargets.map((target) => target.siteName));
  const credentialFingerprints = uniqueTexts(stableTargets.map((target) => target.credentialFingerprint));
  const models = uniqueTexts(stableTargets.map((target) => target.model));

  return {
    kind: 'upstream_model_group',
    provider: providers.length === 1 ? providers[0] : 'mixed',
    sitePlatform: providers.length === 1 ? providers[0] : 'mixed',
    siteUrl: siteUrls.length === 1 ? siteUrls[0] : '',
    siteName: siteNames.length === 1 ? siteNames[0] : '',
    credentialFingerprint: credentialFingerprints.length === 1
      ? credentialFingerprints[0]
      : stableHash({ credentialFingerprints }),
    model: models.length === 1 ? models[0] : 'mixed-models',
    targets: stableTargets,
  };
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
      message: `Non-manual macro ${candidateMacro.id} cannot be created in a draft; create a manual macro or let the route table sync generate it.`,
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
  return await buildRouteGraphSourceFromRouteTable(null);
}

function routeIdFromLegacyGraphNodeId(nodeId: string): number | null {
  const match = /^(entry|dispatcher):legacy:(\d+)$/.exec(nodeId);
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

function isRouteTableSyncedNodeId(nodeId: string): boolean {
  return isLegacyGraphNodeId(nodeId)
    || /^route-endpoint:(?:supply:.+|product:route:\d+|product:auto-model:.+)$/.test(nodeId)
    || /^macro:auto-model:.+/.test(nodeId)
    || removedReferenceNodeLegacyGroupRouteId(nodeId) !== null;
}

function isRouteTableSyncedMacroId(macroId: string): boolean {
  return /^route:\d+:model-group$/.test(macroId)
    || /^auto-model:.+$/.test(macroId);
}

function macroSemanticGraphNodeId(macroId: string): string {
  const safeId = String(macroId || 'x')
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'x';
  return `macro:${safeId}`;
}

function routeIdFromRouteTableMacroId(macroId: string | null | undefined): number | null {
  const match = /^route:(\d+):model-group$/.exec(String(macroId || ''));
  if (!match) return null;
  const routeId = Number(match[1]);
  return Number.isFinite(routeId) && routeId > 0 ? Math.trunc(routeId) : null;
}

function isEntryNode(node: { type?: string } | null | undefined): node is { type: 'entry'; match: RouteGraphMatchSpec; id: string } {
  return !!node && node.type === 'entry';
}

function routeIdFromRouteTableCandidateNode(node: { id?: string; type?: string; match?: RouteGraphMatchSpec; legacyRouteId?: number | null } | null | undefined): number | null {
  if (!node) return null;
  const direct = Number(node.legacyRouteId);
  if (Number.isFinite(direct) && direct > 0) return Math.trunc(direct);
  if (node.type === 'entry') {
    const matchRouteId = Number(node.match?.routeId);
    if (Number.isFinite(matchRouteId) && matchRouteId > 0) return Math.trunc(matchRouteId);
  }
  const match = /^(?:entry|dispatcher):legacy:(\d+)$/.exec(String(node.id || ''));
  if (!match) return null;
  const routeId = Number(match[1]);
  return Number.isFinite(routeId) && routeId > 0 ? routeId : null;
}

function routeIdsFromRouteTableCandidateNode(node: {
  id?: string;
  type?: string;
  match?: RouteGraphMatchSpec;
  legacyRouteId?: number | null;
  backend?: RouteGraphBackendSpec;
} | null | undefined): number[] {
  if (!node) return [];
  if (node.type === 'route_endpoint') {
    const backend = normalizeRouteGraphBackendSpec(node.backend);
    if (backend.kind === 'routes') return backend.routeIds;
  }
  const routeId = routeIdFromRouteTableEntryNode(node);
  return routeId ? [routeId] : [];
}

function routeIdFromRouteTableEntryNode(node: { id?: string; type?: string; match?: RouteGraphMatchSpec; legacyRouteId?: number | null } | null | undefined): number | null {
  if (!node) return null;
  if (node.type === 'auto_node') {
    const direct = Number(node.legacyRouteId);
    if (Number.isFinite(direct) && direct > 0) return Math.trunc(direct);
  }
  return routeIdFromRouteTableCandidateNode(node);
}

function collectMatchAndBackendByLegacyRouteId(source: RouteGraphSource | null | undefined): Map<number, {
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
  visibility: RouteGraphVisibility;
}> {
  const result = new Map<number, { match: RouteGraphMatchSpec; backend: RouteGraphBackendSpec; visibility: RouteGraphVisibility }>();
  if (!source) return result;
  const macroVisibilityByRouteId = new Map<number, RouteGraphVisibility>();
  for (const macro of source.macros || []) {
    const routeId = routeIdFromRouteTableMacroId(macro.id);
    if (!routeId) continue;
    macroVisibilityByRouteId.set(routeId, macro.visibility === 'internal' ? 'internal' : 'public');
  }
  const compiled = compileRouteGraphSource(source);
  for (const endpoint of compiled.compiled.routeEndpoints || []) {
    if (endpoint.endpointKind !== 'route_product') continue;
    const routeId = Number(endpoint.routeId || routeIdFromLegacyGraphNodeId(endpoint.nodeId));
    if (!Number.isFinite(routeId) || routeId <= 0) continue;
    const backend = normalizeSelfRouteProductBackend(endpoint.backend, routeId);
    result.set(routeId, {
      match: endpoint.match,
      backend,
      visibility: macroVisibilityByRouteId.get(routeId) || (endpoint.exposure === 'internal' ? 'internal' : 'public'),
    });
  }
  for (const entry of compiled.compiled.entries) {
    const routeId = Number(entry.match.routeId || routeIdFromLegacyGraphNodeId(entry.nodeId));
    if (!Number.isFinite(routeId) || routeId <= 0) continue;
    if (result.has(routeId)) continue;
    const backend = normalizeSelfRouteProductBackend(entry.backend, routeId);
    result.set(routeId, {
      match: entry.match,
      backend,
      visibility: macroVisibilityByRouteId.get(routeId) || entry.visibility || 'public',
    });
  }
  return result;
}

function normalizeSelfRouteProductBackend(backendInput: RouteGraphBackendSpec, routeId: number): RouteGraphBackendSpec {
  const backend = normalizeRouteGraphBackendSpec(backendInput);
  return backend.kind === 'routes' && backend.routeIds.length === 1 && backend.routeIds[0] === routeId
    ? { kind: 'supply' }
    : backend;
}

function isRouteTableExactModelPattern(value: string): boolean {
  const model = String(value || '').trim();
  return Boolean(model) && !/[*?]/.test(model) && !model.startsWith('re:');
}

function inferRouteTableExactModel(input: {
  route: { id: number; displayName: string | null };
  previous?: { match: RouteGraphMatchSpec; backend: RouteGraphBackendSpec } | undefined;
  isExplicitGroup: boolean;
  accountModels: string[];
}): string {
  if (input.isExplicitGroup) return '';
  if (input.previous) {
    const previousModel = String(input.previous.match.requestedModelPattern || deriveLegacyModelPatternFromSpecs(input.previous.match, { kind: 'supply' })).trim();
    if (isRouteTableExactModelPattern(previousModel)) return previousModel;
  }
  const routeDisplayName = typeof input.route.displayName === 'string' ? input.route.displayName.trim() : '';
  if (isRouteTableExactModelPattern(routeDisplayName)) return routeDisplayName;
  return input.accountModels.length === 1 ? input.accountModels[0] : '';
}

export async function buildRouteGraphSourceFromRouteTable(
  baseSource?: RouteGraphSource | null,
  routeOverrides: Map<number, { match: RouteGraphMatchSpec; backend: RouteGraphBackendSpec; visibility?: RouteGraphVisibility }> = new Map(),
): Promise<RouteGraphSource> {
  const [routes, groupSources, routeEndpointTargets, bindingProjections] = await Promise.all([
    db.select().from(schema.tokenRoutes).all(),
    db.select().from(schema.routeGroupSources).all(),
    db.select().from(schema.routeEndpointTargets).all(),
    loadRouteBindingProjectionMap(),
  ]);
  const accountIdsWithRouteEndpointTargets = Array.from(new Set(routeEndpointTargets.map((routeTarget) => routeTarget.accountId)));
  const tokenIdsWithRouteEndpointTargets = Array.from(new Set(routeEndpointTargets
    .map((routeTarget) => routeTarget.tokenId)
    .filter((tokenId): tokenId is number => Number.isFinite(Number(tokenId)))));
  const [accounts, tokens, sites] = await Promise.all([
    accountIdsWithRouteEndpointTargets.length > 0 ? db.select().from(schema.accounts).all() : Promise.resolve([]),
    tokenIdsWithRouteEndpointTargets.length > 0 ? db.select().from(schema.accountTokens).all() : Promise.resolve([]),
    accountIdsWithRouteEndpointTargets.length > 0 ? db.select().from(schema.sites).all() : Promise.resolve([]),
  ]);
  const accountById = new Map<number, typeof accounts[number]>(accounts.map((account) => [account.id, account]));
  const tokenById = new Map<number, typeof tokens[number]>(tokens.map((token) => [token.id, token]));
  const siteById = new Map<number, typeof sites[number]>(sites.map((site) => [site.id, site]));
  const previousRouteBindingByRouteId = collectMatchAndBackendByLegacyRouteId(baseSource);
  const sourceRouteIdsByGroupRouteId = new Map<number, number[]>();
  for (const source of groupSources) {
    const existing = sourceRouteIdsByGroupRouteId.get(source.groupRouteId) || [];
    existing.push(source.sourceRouteId);
    sourceRouteIdsByGroupRouteId.set(source.groupRouteId, existing);
  }
  const targetsByRouteId = new Map<number, Array<Record<string, unknown>>>();
  const sourceModelsByRouteId = new Map<number, string[]>();
  const endpointStableTargetsByRouteId = new Map<number, Array<Record<string, unknown>>>();
  const endpointLocalRefsByRouteId = new Map<number, Array<Record<string, unknown>>>();
  const supplyEndpointSpecsByRouteId = new Map<number, Array<Record<string, unknown>>>();
  for (const routeTargetRow of routeEndpointTargets) {
    const sourceModel = String(routeTargetRow.sourceModel || '').trim();
    const account = accountById.get(routeTargetRow.accountId) || null;
    const token = routeTargetRow.tokenId ? tokenById.get(routeTargetRow.tokenId) || null : null;
    const site = account ? siteById.get(account.siteId) || null : null;
    const credentialFingerprint = buildCredentialFingerprint({ site, account, token });
    const stableEndpointIdentity = {
      kind: 'upstream_model',
      provider: site?.platform || 'unknown',
      sitePlatform: site?.platform || '',
      siteUrl: site?.url || '',
      siteName: site?.name || '',
      credentialFingerprint,
      accountUsername: account?.username || '',
      oauthProvider: account?.oauthProvider || '',
      oauthAccountKey: account?.oauthAccountKey || '',
      oauthProjectId: account?.oauthProjectId || '',
      tokenName: token?.name || '',
      tokenGroup: token?.tokenGroup || '',
      tokenSource: token?.source || '',
      model: sourceModel,
    };
    const localRef = {
      localRouteId: routeTargetRow.routeId,
      routeTargetId: routeTargetRow.id,
      accountId: routeTargetRow.accountId,
      tokenId: routeTargetRow.tokenId,
      oauthRouteUnitId: routeTargetRow.oauthRouteUnitId,
    };
    const existingTargets = targetsByRouteId.get(routeTargetRow.routeId) || [];
    const target = {
      targetId: String(routeTargetRow.id),
      model: sourceModel,
      modelSource: sourceModel ? 'fixed' : 'request',
      accountId: routeTargetRow.accountId,
      tokenId: routeTargetRow.tokenId,
      siteId: site?.id ?? null,
      weight: routeTargetRow.weight,
      priority: routeTargetRow.priority,
      metadata: {
        ...localRef,
        routeTargetId: routeTargetRow.id,
        endpointIdentity: stableEndpointIdentity,
        oauthRouteUnitId: routeTargetRow.oauthRouteUnitId,
        enabled: routeTargetRow.enabled !== false,
        manualOverride: routeTargetRow.manualOverride === true,
        successCount: routeTargetRow.successCount || 0,
        failCount: routeTargetRow.failCount || 0,
        consecutiveFailCount: routeTargetRow.consecutiveFailCount || 0,
        cooldownLevel: routeTargetRow.cooldownLevel || 0,
        cooldownUntil: routeTargetRow.cooldownUntil || null,
      },
    };
    existingTargets.push(target);
    targetsByRouteId.set(routeTargetRow.routeId, existingTargets);
    const existingLocalRefs = endpointLocalRefsByRouteId.get(routeTargetRow.routeId) || [];
    existingLocalRefs.push(localRef);
    endpointLocalRefsByRouteId.set(routeTargetRow.routeId, existingLocalRefs);
    const existingIdentities = endpointStableTargetsByRouteId.get(routeTargetRow.routeId) || [];
    existingIdentities.push(stableEndpointIdentity);
    endpointStableTargetsByRouteId.set(routeTargetRow.routeId, existingIdentities);
    const existingSupplySpecs = supplyEndpointSpecsByRouteId.get(routeTargetRow.routeId) || [];
    existingSupplySpecs.push({
      endpointIdentity: stableEndpointIdentity,
      endpointLocalRefs: [localRef],
      targets: [target],
    });
    supplyEndpointSpecsByRouteId.set(routeTargetRow.routeId, existingSupplySpecs);
    if (!sourceModel) {
      continue;
    }
    const existing = sourceModelsByRouteId.get(routeTargetRow.routeId) || [];
    if (!existing.includes(sourceModel)) existing.push(sourceModel);
    sourceModelsByRouteId.set(routeTargetRow.routeId, existing);
  }
  const availableModelsByAccountId = new Map<number, string[]>();
  if (accountIdsWithRouteEndpointTargets.length > 0) {
    const availabilityRows = await db.select().from(schema.modelAvailability).all();
    for (const row of availabilityRows) {
      if (!row.available || !accountIdsWithRouteEndpointTargets.includes(row.accountId)) continue;
      const modelName = String(row.modelName || '').trim();
      if (!modelName) continue;
      const existing = availableModelsByAccountId.get(row.accountId) || [];
      if (!existing.includes(modelName)) existing.push(modelName);
      availableModelsByAccountId.set(row.accountId, existing);
    }
  }
  for (const route of routes) {
    if (sourceModelsByRouteId.has(route.id)) continue;
    const routeTargets = routeEndpointTargets.filter((routeTarget) => routeTarget.routeId === route.id);
    if (routeTargets.length === 0) continue;
    const routeAccountModelSet = new Set<string>();
    for (const target of routeTargets) {
      for (const model of availableModelsByAccountId.get(target.accountId) || []) {
        routeAccountModelSet.add(model);
      }
    }
    const routeAccountModels = Array.from(routeAccountModelSet);
    const sourceRouteIds = sourceRouteIdsByGroupRouteId.get(route.id) || [];
    const previous = routeOverrides.get(route.id) ?? previousRouteBindingByRouteId.get(route.id) ?? bindingProjections.get(route.id);
    const inferredModel = inferRouteTableExactModel({
      route,
      previous,
      isExplicitGroup: sourceRouteIds.length > 0,
      accountModels: routeAccountModels,
    });
    if (!inferredModel) continue;
    sourceModelsByRouteId.set(route.id, [inferredModel]);
    const inferredTargets = endpointStableTargetsByRouteId.get(route.id) || [];
    let inferredIdentityChanged = false;
    const nextInferredTargets = inferredTargets.map((target) => {
      if (String(target.model || '').trim()) return target;
      inferredIdentityChanged = true;
      return { ...target, model: inferredModel };
    });
    if (inferredIdentityChanged) {
      endpointStableTargetsByRouteId.set(route.id, nextInferredTargets);
    }
    const targets = targetsByRouteId.get(route.id) || [];
    for (const target of targets) {
      if (typeof target.model === 'string' && !target.model) {
        target.model = inferredModel;
        target.modelSource = 'fixed';
        const metadata = target.metadata && typeof target.metadata === 'object' && !Array.isArray(target.metadata)
          ? target.metadata as Record<string, unknown>
          : {};
        const targetIdentity = metadata.endpointIdentity && typeof metadata.endpointIdentity === 'object' && !Array.isArray(metadata.endpointIdentity)
          ? metadata.endpointIdentity as Record<string, unknown>
          : null;
        if (targetIdentity && !String(targetIdentity.model || '').trim()) {
          targetIdentity.model = inferredModel;
        }
      }
    }
    const nextSupplySpecs = (supplyEndpointSpecsByRouteId.get(route.id) || []).map((spec) => {
      const endpointIdentity = spec.endpointIdentity && typeof spec.endpointIdentity === 'object' && !Array.isArray(spec.endpointIdentity)
        ? {
          ...(spec.endpointIdentity as Record<string, unknown>),
          model: String((spec.endpointIdentity as Record<string, unknown>).model || '').trim() || inferredModel,
        }
        : spec.endpointIdentity;
      const specTargets = Array.isArray(spec.targets)
        ? spec.targets.map((target) => {
          if (!target || typeof target !== 'object' || Array.isArray(target)) return target;
          const targetRecord = target as Record<string, unknown>;
          if (String(targetRecord.model || '').trim()) return targetRecord;
          const metadata = targetRecord.metadata && typeof targetRecord.metadata === 'object' && !Array.isArray(targetRecord.metadata)
            ? targetRecord.metadata as Record<string, unknown>
            : {};
          const targetIdentity = metadata.endpointIdentity && typeof metadata.endpointIdentity === 'object' && !Array.isArray(metadata.endpointIdentity)
            ? metadata.endpointIdentity as Record<string, unknown>
            : null;
          return {
            ...targetRecord,
            model: inferredModel,
            modelSource: 'fixed',
            metadata: targetIdentity
              ? {
                ...metadata,
                endpointIdentity: {
                  ...targetIdentity,
                  model: String(targetIdentity.model || '').trim() || inferredModel,
                },
              }
              : metadata,
          };
        })
        : spec.targets;
      return {
        ...spec,
        endpointIdentity,
        targets: specTargets,
      };
    });
    supplyEndpointSpecsByRouteId.set(route.id, nextSupplySpecs);
  }
  return buildRouteGraphSourceFromLegacyRoutes(routes.map((route) => {
    const sourceRouteIds = sourceRouteIdsByGroupRouteId.get(route.id) || [];
    const isExplicitGroup = sourceRouteIds.length > 0;
    const sourceModels = sourceModelsByRouteId.get(route.id) || [];
    const previous = routeOverrides.get(route.id) ?? previousRouteBindingByRouteId.get(route.id) ?? bindingProjections.get(route.id);
    const previousMatch = previous?.match;
    const visibility = previous?.visibility || 'public';
    const inferredPattern = previousMatch?.requestedModelPattern
      || (isExplicitGroup ? '' : (sourceModels.length === 1 ? sourceModels[0] : ''))
      || route.displayName
      || '';
    const inferredDisplayName = route.displayName ?? previousMatch?.displayName ?? null;
    const endpointIdentityFallbackModel = !isExplicitGroup && inferredPattern && !/[*?]/.test(inferredPattern) && !inferredPattern.startsWith('re:')
      ? inferredPattern
      : '';
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
        : { kind: 'supply' },
      visibility,
      ownership: route.ownership || 'auto_generated',
      endpointIdentity: buildRouteEndpointIdentityFromTargets(endpointStableTargetsByRouteId.get(route.id) || [], endpointIdentityFallbackModel),
      endpointLocalRefs: endpointLocalRefsByRouteId.get(route.id) || [],
      targets: targetsByRouteId.get(route.id) || [],
      supplyEndpointSpecs: supplyEndpointSpecsByRouteId.get(route.id) || [],
    };
  }));
}

export async function reconcileActiveGraphWithRouteTable(
  active: ActiveRouteGraphVersion,
  routeOverrides: Map<number, { match: RouteGraphMatchSpec; backend: RouteGraphBackendSpec; visibility?: RouteGraphVisibility }> = new Map(),
  options: { allowDiagnostics?: boolean } = {},
): Promise<ActiveRouteGraphVersion> {
  const syncedRouteSource = await buildRouteGraphSourceFromRouteTable(active.sourceGraph, routeOverrides);
  const keptNodes = active.sourceGraph.nodes.filter((node) => !isRouteTableSyncedNodeId(node.id));
  const keptMacros = (active.sourceGraph.macros || []).filter((macro) => !isRouteTableSyncedMacroId(macro.id));
  const nextNodes = [...keptNodes, ...syncedRouteSource.nodes];
  const nextNodeIds = new Set(nextNodes.map((node) => node.id));
  for (const macro of [...keptMacros, ...(syncedRouteSource.macros || [])]) {
    nextNodeIds.add(macroSemanticGraphNodeId(macro.id));
  }
  const syncedRouteEdgeIds = new Set(syncedRouteSource.edges.map((edge) => edge.id));
  const keptEdges = active.sourceGraph.edges.filter((edge) => (
    nextNodeIds.has(edge.sourceNodeId)
    && nextNodeIds.has(edge.targetNodeId)
    && !syncedRouteEdgeIds.has(edge.id)
  ));
  const nextSource = normalizeRouteGraphSource({
    ...active.sourceGraph,
    nodes: nextNodes,
    edges: [...keptEdges, ...syncedRouteSource.edges],
    macros: [...keptMacros, ...(syncedRouteSource.macros || [])],
  });
  if (JSON.stringify(nextSource) === JSON.stringify(active.sourceGraph)) {
    if (!options.allowDiagnostics) {
      const compiled = compileRouteGraphSource(nextSource);
      if (!compiled.ok) {
        throw new RouteGraphSyncValidationError(compiled.diagnostics);
      }
    }
    return active;
  }
  const published = await publishRouteGraphSource({
    sourceGraph: nextSource,
    createdBy: 'route-table-sync',
    allowDiagnostics: options.allowDiagnostics,
  });
  if (!published.ok) {
    throw new RouteGraphSyncValidationError(published.diagnostics);
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
  const compiled = compileRouteGraphSource(input.sourceGraph, { includeLegacyBundles: false, includePrimitiveSource: false });
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
  const shouldSyncRouteTableProjection = input.createdBy === 'legacy-migration'
    || input.createdBy === 'route-table-sync';
  if (shouldSyncRouteTableProjection) {
    await syncRouteBindingProjectionsFromRouteTable();
  } else {
    const routeBindings = collectMatchAndBackendByLegacyRouteId(compiled.source);
    await upsertRouteBindingProjections(Array.from(routeBindings.entries()).map(([routeId, binding]) => ({
      routeId,
      match: binding.match,
      backend: binding.backend,
      visibility: binding.visibility,
    })));
  }

  invalidateRouteGraphReadCaches();
  const version: ActiveRouteGraphVersion = {
    id: versionId,
    version: versionNumber,
    sourceGraph: compiled.source,
    compiledGraph: compiled.compiled,
    status: 'active',
    createdAt: timestamp,
    activatedAt: timestamp,
  };
  const sourceVersion = sourceVersionFromActiveVersion(version);
  cacheActiveSourceVersion(sourceVersion);
  activeRouteGraphRuntimeCache = {
    versionId,
    version: runtimeVersionFromActiveVersion(version),
  };
  activeRouteGraphSummaryCache = {
    versionId,
    summary: summarizeActiveRouteGraphVersion(sourceVersion, version.compiledGraph.hash || null),
  };
  return { ok: true, version, diagnostics: compiled.diagnostics };
}

export async function ensureActiveRouteGraphVersion(): Promise<ActiveRouteGraphVersion> {
  const active = await getActiveRouteGraphVersion();
  if (active) {
    const compactedIdentity = activeRouteGraphCache?.versionId === active.id
      ? activeRouteGraphCache.compactedIdentity
      : hasCompactedRouteEndpointIdentity(active.sourceGraph);
    if (compactedIdentity) {
      return await reconcileActiveGraphWithRouteTable(active, new Map(), { allowDiagnostics: true });
    }
    return active;
  }

  const sourceGraph = await loadLegacyRouteGraphSource();
  const published = await publishRouteGraphSource({
    sourceGraph,
    createdBy: 'legacy-migration',
    allowDiagnostics: true,
  });
  if (!published.ok) {
    throw new Error(`Cannot bootstrap route graph: ${published.diagnostics.map((item) => item.message).join('; ')}`);
  }
  return published.version;
}

export async function synchronizeActiveRouteGraphVersion(
  options: { allowDiagnostics?: boolean } = {},
): Promise<ActiveRouteGraphVersion> {
  const active = await ensureActiveRouteGraphVersion();
  return await reconcileActiveGraphWithRouteTable(active, new Map(), {
    allowDiagnostics: options.allowDiagnostics ?? true,
  });
}

export async function getActiveRouteGraphVersion(): Promise<ActiveRouteGraphVersion | null> {
  const pointer = await db.select().from(schema.routeGraphActiveVersion).where(eq(schema.routeGraphActiveVersion.id, 1)).get();
  if (!pointer) return null;
  const cachedActive = activeRouteGraphCache;
  if (cachedActive && cachedActive.versionId === pointer.versionId) {
    return cachedActive.version;
  }
  const row = await db.select().from(schema.routeGraphVersions)
    .where(eq(schema.routeGraphVersions.id, pointer.versionId))
    .get();
  if (!row) return null;
  const sourceGraph = parseRouteGraphSource(row.sourceGraphJson);
  let compiledGraph = parseJsonObject<CompiledRouteGraph>(row.compiledGraphJson, EMPTY_COMPILED_ROUTE_GRAPH);
  if (!hasCompiledRouterBundle(compiledGraph) || hasLegacyRouteProgramBundles(compiledGraph)) {
    compiledGraph = compileRouteGraphSource(sourceGraph, { includeLegacyBundles: false, includePrimitiveSource: false }).compiled;
    await db.update(schema.routeGraphVersions).set({
      compiledGraphJson: JSON.stringify(compiledGraph),
    }).where(eq(schema.routeGraphVersions.id, row.id)).run();
  }
  const version = {
    id: row.id,
    version: row.version,
    sourceGraph,
    compiledGraph,
    status: row.status,
    createdAt: row.createdAt,
    activatedAt: row.activatedAt,
  };
  activeRouteGraphCache = {
    versionId: row.id,
    version,
    compactedIdentity: hasCompactedRouteEndpointIdentity(sourceGraph),
  };
  cacheActiveSourceVersion(sourceVersionFromActiveVersion(version), activeRouteGraphCache.compactedIdentity);
  activeRouteGraphRuntimeCache = {
    versionId: row.id,
    version: runtimeVersionFromActiveVersion(version),
  };
  activeRouteGraphSummaryCache = {
    versionId: row.id,
    summary: summarizeActiveRouteGraphVersion(sourceVersionFromActiveVersion(version), compiledGraph.hash || null),
  };
  return version;
}

export async function getActiveRouteGraphSourceVersion(): Promise<ActiveRouteGraphSourceVersion | null> {
  const versionId = await getActiveRouteGraphVersionId();
  if (!versionId) return null;
  if (activeRouteGraphSourceCache?.versionId === versionId) {
    return activeRouteGraphSourceCache.version;
  }
  if (activeRouteGraphCache?.versionId === versionId) {
    const sourceVersion = sourceVersionFromActiveVersion(activeRouteGraphCache.version);
    cacheActiveSourceVersion(sourceVersion, activeRouteGraphCache.compactedIdentity);
    return sourceVersion;
  }
  const row = await db.select({
    id: schema.routeGraphVersions.id,
    version: schema.routeGraphVersions.version,
    sourceGraphJson: schema.routeGraphVersions.sourceGraphJson,
    status: schema.routeGraphVersions.status,
    createdAt: schema.routeGraphVersions.createdAt,
    activatedAt: schema.routeGraphVersions.activatedAt,
  })
    .from(schema.routeGraphVersions)
    .where(eq(schema.routeGraphVersions.id, versionId))
    .get();
  if (!row) return null;
  const sourceGraph = parseRouteGraphSource(row.sourceGraphJson);
  const sourceVersion: ActiveRouteGraphSourceVersion = {
    id: row.id,
    version: row.version,
    sourceGraph,
    status: row.status,
    createdAt: row.createdAt,
    activatedAt: row.activatedAt,
  };
  cacheActiveSourceVersion(sourceVersion);
  activeRouteGraphSummaryCache = {
    versionId: row.id,
    summary: summarizeActiveRouteGraphVersion(sourceVersion),
  };
  return sourceVersion;
}

export async function ensureActiveRouteGraphSourceVersion(): Promise<ActiveRouteGraphSourceVersion> {
  const active = await getActiveRouteGraphSourceVersion();
  if (active) return active;
  return sourceVersionFromActiveVersion(await ensureActiveRouteGraphVersion());
}

export async function getActiveRouteGraphRuntimeVersion(): Promise<ActiveRouteGraphRuntimeVersion | null> {
  const versionId = await getActiveRouteGraphVersionId();
  if (!versionId) return null;
  if (activeRouteGraphRuntimeCache?.versionId === versionId) {
    return activeRouteGraphRuntimeCache.version;
  }
  if (activeRouteGraphCache?.versionId === versionId) {
    const runtimeVersion = runtimeVersionFromActiveVersion(activeRouteGraphCache.version);
    activeRouteGraphRuntimeCache = { versionId, version: runtimeVersion };
    return runtimeVersion;
  }
  const row = await db.select({
    id: schema.routeGraphVersions.id,
    version: schema.routeGraphVersions.version,
    sourceGraphJson: schema.routeGraphVersions.sourceGraphJson,
    compiledGraphJson: schema.routeGraphVersions.compiledGraphJson,
  })
    .from(schema.routeGraphVersions)
    .where(eq(schema.routeGraphVersions.id, versionId))
    .get();
  if (!row) return null;

  let compiledGraph = parseJsonObject<CompiledRouteGraph>(row.compiledGraphJson, EMPTY_COMPILED_ROUTE_GRAPH);
  if (!hasCompiledRouterBundle(compiledGraph) || hasLegacyRouteProgramBundles(compiledGraph)) {
    const sourceGraph = parseRouteGraphSource(row.sourceGraphJson);
    compiledGraph = compileRouteGraphSource(sourceGraph, { includeLegacyBundles: false, includePrimitiveSource: false }).compiled;
    await db.update(schema.routeGraphVersions).set({
      compiledGraphJson: JSON.stringify(compiledGraph),
    }).where(eq(schema.routeGraphVersions.id, row.id)).run();
  }
  const runtimeVersion: ActiveRouteGraphRuntimeVersion = {
    id: row.id,
    version: row.version,
    compiledGraph: runtimeVersionFromActiveVersion({
      id: row.id,
      version: row.version,
      sourceGraph: EMPTY_ROUTE_GRAPH_SOURCE,
      compiledGraph,
      status: 'active',
      createdAt: null,
      activatedAt: null,
    }).compiledGraph,
  };
  activeRouteGraphRuntimeCache = { versionId: row.id, version: runtimeVersion };
  return runtimeVersion;
}

export async function getActiveRouteGraphSummary(): Promise<ActiveRouteGraphSummary | null> {
  const versionId = await getActiveRouteGraphVersionId();
  if (!versionId) return null;
  if (activeRouteGraphSummaryCache?.versionId === versionId) {
    return activeRouteGraphSummaryCache.summary;
  }
  if (activeRouteGraphSourceCache?.versionId === versionId) {
    const summary = summarizeActiveRouteGraphVersion(activeRouteGraphSourceCache.version, activeRouteGraphRuntimeCache?.versionId === versionId ? activeRouteGraphRuntimeCache.version.compiledGraph.hash || null : null);
    activeRouteGraphSummaryCache = { versionId, summary };
    return summary;
  }
  if (activeRouteGraphCache?.versionId === versionId) {
    const summary = summarizeActiveRouteGraphVersion(sourceVersionFromActiveVersion(activeRouteGraphCache.version), activeRouteGraphCache.version.compiledGraph.hash || null);
    activeRouteGraphSummaryCache = { versionId, summary };
    return summary;
  }
  const row = await db.select({
    id: schema.routeGraphVersions.id,
    version: schema.routeGraphVersions.version,
    sourceGraphJson: schema.routeGraphVersions.sourceGraphJson,
    status: schema.routeGraphVersions.status,
    createdAt: schema.routeGraphVersions.createdAt,
    activatedAt: schema.routeGraphVersions.activatedAt,
  })
    .from(schema.routeGraphVersions)
    .where(eq(schema.routeGraphVersions.id, versionId))
    .get();
  if (!row) return null;
  const sourceGraph = parseRouteGraphSource(row.sourceGraphJson);
  const summary: ActiveRouteGraphSummary = {
    version: {
      id: row.id,
      version: row.version,
      status: row.status,
      createdAt: row.createdAt,
      activatedAt: row.activatedAt,
    },
    sourceSummary: {
      nodes: sourceGraph.nodes.length,
      edges: sourceGraph.edges.length,
      macros: (sourceGraph.macros || []).length,
    },
    hashes: {
      sourceGraph: `version:${row.id}`,
      compiledGraph: null,
    },
  };
  activeRouteGraphSummaryCache = { versionId: row.id, summary };
  return summary;
}

export async function getRouteGraphRouteTableSummary(): Promise<ActiveRouteGraphSummary> {
  const [routeCountRow, targetCountRow, sourceCountRow] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(schema.tokenRoutes).get(),
    db.select({ count: sql<number>`count(*)` }).from(schema.routeEndpointTargets).get(),
    db.select({ count: sql<number>`count(*)` }).from(schema.routeGroupSources).get(),
  ]);
  const routeCount = Number(routeCountRow?.count || 0);
  const targetCount = Number(targetCountRow?.count || 0);
  const sourceCount = Number(sourceCountRow?.count || 0);
  return {
    version: {
      id: 0,
      version: 0,
      status: 'active',
      createdAt: null,
      activatedAt: null,
    },
    sourceSummary: {
      nodes: routeCount + targetCount,
      edges: targetCount + sourceCount,
      macros: routeCount,
    },
    hashes: {
      sourceGraph: `route-table:${routeCount}:${targetCount}:${sourceCount}`,
      compiledGraph: null,
    },
  };
}

export async function listRouteGraphVersions(limit = 20): Promise<RouteGraphVersionSummary[]> {
  const rows = await db.select().from(schema.routeGraphVersions)
    .orderBy(desc(schema.routeGraphVersions.version))
    .limit(Math.max(1, Math.min(100, limit)))
    .all();
  return rows.map((row) => {
    const sourceGraph = parseRouteGraphSource(row.sourceGraphJson);
    const compiledGraph = parseJsonObject<CompiledRouteGraph>(row.compiledGraphJson, compileRouteGraphSource(sourceGraph).compiled);
    return {
      id: row.id,
      version: row.version,
      status: row.status,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      activatedAt: row.activatedAt,
      sourceSummary: {
        nodes: sourceGraph.nodes.length,
        edges: sourceGraph.edges.length,
        macros: (sourceGraph.macros || []).length,
        publicModels: Array.isArray(compiledGraph.publicModels) ? compiledGraph.publicModels.length : 0,
      },
    };
  });
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

export async function loadRouteGraphRouteTableBindings(): Promise<Map<number, RouteGraphRouteTableBinding>> {
  const [routes, routeGroupSources, projections] = await Promise.all([
    db.select().from(schema.tokenRoutes).all(),
    db.select().from(schema.routeGroupSources).all(),
    loadRouteBindingProjectionMap(),
  ]);
  const sourceRouteIdsByGroupRouteId = new Map<number, number[]>();
  for (const source of routeGroupSources) {
    const existing = sourceRouteIdsByGroupRouteId.get(source.groupRouteId) || [];
    existing.push(source.sourceRouteId);
    sourceRouteIdsByGroupRouteId.set(source.groupRouteId, existing);
  }

  const bindings = new Map<number, RouteGraphRouteTableBinding>();
  for (const route of routes) {
    const projection = projections.get(route.id);
    const routeTableSourceRouteIds = sourceRouteIdsByGroupRouteId.get(route.id) || [];
    const backend = normalizeRouteGraphBackendSpec(routeTableSourceRouteIds.length > 0
      ? { kind: 'routes', routeIds: routeTableSourceRouteIds }
      : projection?.backend ?? { kind: 'supply' });
    const fallbackMatch = normalizeRouteGraphMatchSpec({
      kind: 'model',
      requestedModelPattern: backend.kind === 'routes'
        ? ''
        : (route.displayName || projection?.match.requestedModelPattern || ''),
      displayName: route.displayName ?? projection?.match.displayName ?? null,
      routeId: route.id,
    });
    const match = projection?.match ?? fallbackMatch;
    const sourceRouteIds = backend.kind === 'routes' ? backend.routeIds : [];
    const routeMode = backend.kind === 'routes' ? 'explicit_group' : 'pattern';
    bindings.set(route.id, {
      routeId: route.id,
      entryNodeId: legacyRouteIdToRouteGraphEntryNodeId(route.id),
      match,
      backend,
      visibility: projection?.visibility ?? 'public',
      sourceRouteIds,
      modelPattern: deriveLegacyModelPatternFromSpecs(match, backend) || route.displayName || '',
      routeMode,
    });
  }
  return bindings;
}

function normalizeTextList(values: unknown[]): string[] {
  return Array.from(new Set(values
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
}

const ROUTE_ENDPOINT_CATALOG_DEFAULT_PAGE_SIZE = 100;
const ROUTE_ENDPOINT_CATALOG_MAX_PAGE_SIZE = 500;
const ROUTE_ENDPOINT_CATALOG_LEGACY_MAX_ITEMS = 20_000;

type RouteEndpointTargetCatalogRow = {
  route_endpoint_targets: typeof schema.routeEndpointTargets.$inferSelect;
  accounts: typeof schema.accounts.$inferSelect;
  sites: typeof schema.sites.$inferSelect;
  account_tokens: typeof schema.accountTokens.$inferSelect | null;
};

function normalizeCatalogQuery(input: RouteEndpointCatalogQuery = {}): Required<Pick<RouteEndpointCatalogQuery, 'page' | 'pageSize' | 'endpointKind'>> & {
  routeId: number | null;
  siteId: number | null;
  q: string;
} {
  const page = Math.max(1, Math.trunc(Number(input.page || 1)));
  const pageSize = Math.max(1, Math.min(
    ROUTE_ENDPOINT_CATALOG_MAX_PAGE_SIZE,
    Math.trunc(Number(input.pageSize || ROUTE_ENDPOINT_CATALOG_DEFAULT_PAGE_SIZE)),
  ));
  const endpointKind = input.endpointKind === 'route_product' || input.endpointKind === 'supply'
    ? input.endpointKind
    : 'all';
  const routeId = Number(input.routeId);
  const siteId = Number(input.siteId);
  return {
    page,
    pageSize,
    endpointKind,
    routeId: Number.isFinite(routeId) && routeId > 0 ? Math.trunc(routeId) : null,
    siteId: Number.isFinite(siteId) && siteId > 0 ? Math.trunc(siteId) : null,
    q: String(input.q || '').trim().toLowerCase(),
  };
}

function readRouteModelPattern(input: {
  route: typeof schema.tokenRoutes.$inferSelect;
  routeGroup?: typeof schema.routeGroups.$inferSelect | null;
  isExplicitGroup: boolean;
}): string {
  if (input.isExplicitGroup) {
    return String(
      input.routeGroup?.publicModelName
      || input.routeGroup?.displayName
      || input.route.displayName
      || '',
    ).trim();
  }
  return String(
    input.routeGroup?.upstreamModelName
    || input.routeGroup?.publicModelName
    || input.route.displayName
    || '',
  ).trim();
}

function catalogItemMatchesQuery(item: RouteEndpointCatalogItem, query: ReturnType<typeof normalizeCatalogQuery>): boolean {
  if (query.endpointKind !== 'all' && item.endpointKind !== query.endpointKind) return false;
  if (query.routeId && item.routeId !== query.routeId && !item.sourceRouteIds.includes(query.routeId)) return false;
  if (query.siteId) {
    const siteIds = Array.isArray(item.metadata.siteIds)
      ? item.metadata.siteIds.map((value) => Number(value)).filter((value) => Number.isFinite(value))
      : [];
    if (!siteIds.includes(query.siteId)) return false;
  }
  if (query.q) {
    const haystack = [
      item.endpointId,
      item.nodeId,
      item.label,
      item.modelPattern,
      item.publicModelName,
      ...item.upstreamModels,
      ...item.siteNames,
    ].join('\n').toLowerCase();
    if (!haystack.includes(query.q)) return false;
  }
  return true;
}

async function selectRouteEndpointTargetCatalogRows(routeIds?: number[]): Promise<RouteEndpointTargetCatalogRow[]> {
  const normalizedRouteIds = Array.from(new Set((routeIds || [])
    .map((routeId) => Math.trunc(Number(routeId)))
    .filter((routeId) => Number.isFinite(routeId) && routeId > 0)));
  const query = db.select()
    .from(schema.routeEndpointTargets)
    .innerJoin(schema.accounts, eq(schema.routeEndpointTargets.accountId, schema.accounts.id))
    .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .leftJoin(schema.accountTokens, eq(schema.routeEndpointTargets.tokenId, schema.accountTokens.id));
  if (normalizedRouteIds.length > 0 && normalizedRouteIds.length <= 500) {
    return await query.where(inArray(schema.routeEndpointTargets.routeId, normalizedRouteIds)).all() as RouteEndpointTargetCatalogRow[];
  }
  const rows = await query.all() as RouteEndpointTargetCatalogRow[];
  if (normalizedRouteIds.length === 0) return rows;
  const routeIdSet = new Set(normalizedRouteIds);
  return rows.filter((row) => routeIdSet.has(row.route_endpoint_targets.routeId));
}

async function loadRouteEndpointCatalogProjection(): Promise<RouteEndpointCatalogItem[]> {
  const [routes, routeGroups, routeGroupSources, bindingProjections] = await Promise.all([
    db.select().from(schema.tokenRoutes).all(),
    db.select().from(schema.routeGroups).all(),
    db.select().from(schema.routeGroupSources).all(),
    loadRouteBindingProjectionMap(),
  ]);
  const routeById = new Map<number, typeof routes[number]>(routes.map((route) => [route.id, route]));
  const routeGroupByLegacyRouteId = new Map<number, typeof routeGroups[number]>();
  for (const routeGroup of routeGroups) {
    const routeId = Number(routeGroup.legacyRouteId || 0);
    if (Number.isFinite(routeId) && routeId > 0) routeGroupByLegacyRouteId.set(Math.trunc(routeId), routeGroup);
  }
  const sourceRouteIdsByGroupRouteId = new Map<number, number[]>();
  for (const source of routeGroupSources) {
    const existing = sourceRouteIdsByGroupRouteId.get(source.groupRouteId) || [];
    existing.push(source.sourceRouteId);
    sourceRouteIdsByGroupRouteId.set(source.groupRouteId, existing);
  }
  const routeModelPatternById = new Map<number, string>();
  for (const route of routes) {
    const explicitSources = sourceRouteIdsByGroupRouteId.get(route.id) || [];
    const projection = bindingProjections.get(route.id);
    const projectedModelPattern = projection
      ? deriveLegacyModelPatternFromSpecs(projection.match, projection.backend)
      : '';
    routeModelPatternById.set(route.id, projectedModelPattern || readRouteModelPattern({
      route,
      routeGroup: routeGroupByLegacyRouteId.get(route.id) || null,
      isExplicitGroup: explicitSources.length > 0 || projection?.backend.kind === 'routes',
    }));
  }

  const targetRows = await selectRouteEndpointTargetCatalogRows();
  const routeTargetCounts = new Map<number, number>();
  const routeEnabledTargetCounts = new Map<number, number>();
  const routeSiteNames = new Map<number, Set<string>>();
  const routeSiteIds = new Map<number, Set<number>>();
  const routeModels = new Map<number, Set<string>>();
  for (const row of targetRows) {
    const target = row.route_endpoint_targets;
    routeTargetCounts.set(target.routeId, (routeTargetCounts.get(target.routeId) || 0) + 1);
    if (target.enabled !== false) {
      routeEnabledTargetCounts.set(target.routeId, (routeEnabledTargetCounts.get(target.routeId) || 0) + 1);
    }
    const model = String(target.sourceModel || routeModelPatternById.get(target.routeId) || '').trim();
    if (model) {
      const models = routeModels.get(target.routeId) || new Set<string>();
      models.add(model);
      routeModels.set(target.routeId, models);
    }
    const siteName = String(row.sites.name || '').trim();
    if (siteName) {
      const names = routeSiteNames.get(target.routeId) || new Set<string>();
      names.add(siteName);
      routeSiteNames.set(target.routeId, names);
    }
    const siteIds = routeSiteIds.get(target.routeId) || new Set<number>();
    siteIds.add(row.sites.id);
    routeSiteIds.set(target.routeId, siteIds);
  }
  for (const route of routes) {
    if (routeModelPatternById.get(route.id)) continue;
    const models = Array.from(routeModels.get(route.id) || []);
    if (models.length === 1) routeModelPatternById.set(route.id, models[0]);
  }

  const productItems = routes.map((route): RouteEndpointCatalogItem => {
    const explicitSourceRouteIds = sourceRouteIdsByGroupRouteId.get(route.id) || [];
    const projection = bindingProjections.get(route.id);
    const isExplicitGroup = explicitSourceRouteIds.length > 0 || projection?.backend.kind === 'routes';
    const sourceRouteIds = explicitSourceRouteIds.length > 0
      ? explicitSourceRouteIds
      : (projection?.backend.kind === 'routes' ? projection.backend.routeIds : [route.id]);
    const routeGroup = routeGroupByLegacyRouteId.get(route.id) || null;
    const modelPattern = deriveLegacyModelPatternFromSpecs(
      projection?.match ?? normalizeRouteGraphMatchSpec(null),
      projection?.backend ?? normalizeRouteGraphBackendSpec(null),
    ) || routeModelPatternById.get(route.id) || '';
    const endpointId = isExplicitGroup
      ? routeGraphRouteProductEndpointIdFromRoute(route.id)
      : routeGraphAutoModelProductEndpointId((modelPattern || String(route.id)).toLowerCase());
    const upstreamModels = Array.from(new Set(sourceRouteIds.flatMap((routeId) => Array.from(routeModels.get(routeId) || []))));
    const siteNames = Array.from(new Set(sourceRouteIds.flatMap((routeId) => Array.from(routeSiteNames.get(routeId) || []))));
    const siteIds = Array.from(new Set(sourceRouteIds.flatMap((routeId) => Array.from(routeSiteIds.get(routeId) || []))));
    const targetCount = sourceRouteIds.reduce((sum, routeId) => sum + (routeTargetCounts.get(routeId) || 0), 0);
    const label = String(route.displayName || routeGroup?.displayName || routeGroup?.publicModelName || modelPattern || endpointId).trim();
    return {
      endpointId,
      nodeId: endpointId,
      routeId: route.id,
      label,
      endpointKind: 'route_product',
      exposure: projection?.visibility ?? (routeGroup?.visibility === 'internal' ? 'internal' : 'public'),
      resolutionStatus: targetCount > 0 ? 'resolved' : 'unresolved',
      ownerKind: 'automatic_route',
      sourceKind: isExplicitGroup ? 'manual_group' : 'automatic_model_group',
      enabled: route.enabled !== false,
      displayIcon: route.displayIcon ?? routeGroup?.displayIcon ?? null,
      modelPattern,
      publicModelName: routeGroup?.publicModelName || modelPattern || null,
      upstreamModels,
      siteNames,
      targetCount,
      sourceRouteIds,
      tags: [],
      metadata: {
        source: 'route_table_projection',
        siteIds,
        enabledTargetCount: sourceRouteIds.reduce((sum, routeId) => sum + (routeEnabledTargetCounts.get(routeId) || 0), 0),
      },
    };
  });

  const supplyItems = targetRows.map((row): RouteEndpointCatalogItem => {
    return routeEndpointTargetCatalogRowToItem(row, {
      route: routeById.get(row.route_endpoint_targets.routeId) || null,
      routeModelPattern: routeModelPatternById.get(row.route_endpoint_targets.routeId) || '',
      metadataSource: 'route_target_projection',
    });
  });

  return [...productItems, ...supplyItems].sort((left, right) => {
    if (left.endpointKind !== right.endpointKind) {
      return left.endpointKind === 'route_product' ? -1 : 1;
    }
    return (left.routeId || 0) - (right.routeId || 0) || left.endpointId.localeCompare(right.endpointId);
  });
}

async function countTableRows(table: typeof schema.tokenRoutes | typeof schema.routeEndpointTargets): Promise<number> {
  const row = await db.select({ count: sql<number>`count(*)` }).from(table).get();
  return Number(row?.count || 0);
}

function routeEndpointTargetCatalogRowToItem(
  row: RouteEndpointTargetCatalogRow,
  input: {
    route: typeof schema.tokenRoutes.$inferSelect | null;
    routeModelPattern: string;
    metadataSource: string;
  },
): RouteEndpointCatalogItem {
  const target = row.route_endpoint_targets;
  const sourceModel = String(target.sourceModel || input.routeModelPattern || '').trim();
  const endpointIdentity = {
    kind: 'upstream_model',
    provider: row.sites.platform || 'unknown',
    sitePlatform: row.sites.platform || '',
    siteUrl: row.sites.url || '',
    siteName: row.sites.name || '',
    credentialFingerprint: buildCredentialFingerprint({
      site: row.sites,
      account: row.accounts,
      token: row.account_tokens,
    }),
    accountUsername: row.accounts.username || '',
    oauthProvider: row.accounts.oauthProvider || '',
    oauthAccountKey: row.accounts.oauthAccountKey || '',
    oauthProjectId: row.accounts.oauthProjectId || '',
    tokenName: row.account_tokens?.name || '',
    tokenGroup: row.account_tokens?.tokenGroup || '',
    tokenSource: row.account_tokens?.source || '',
    model: sourceModel,
  };
  const endpointId = String(target.routeEndpointId || '').trim()
    || routeGraphSupplyEndpointIdFromIdentity(endpointIdentity, target.routeId);
  const metadata = {
    source: input.metadataSource,
    endpointIdentity,
    endpointLocalRefs: [{
      localRouteId: target.routeId,
      routeTargetId: target.id,
      accountId: target.accountId,
      tokenId: target.tokenId,
      oauthRouteUnitId: target.oauthRouteUnitId,
    }],
    siteIds: [row.sites.id],
    routeTargetId: target.id,
    accountId: target.accountId,
    tokenId: target.tokenId,
    oauthRouteUnitId: target.oauthRouteUnitId,
    priority: target.priority ?? 0,
    weight: target.weight ?? 10,
    enabled: target.enabled !== false,
    manualOverride: target.manualOverride === true,
    successCount: target.successCount || 0,
    failCount: target.failCount || 0,
    consecutiveFailCount: target.consecutiveFailCount || 0,
    cooldownLevel: target.cooldownLevel || 0,
    cooldownUntil: target.cooldownUntil || null,
  };
  return {
    endpointId,
    nodeId: endpointId,
    routeId: target.routeId,
    label: String(input.route?.displayName || sourceModel || row.sites.name || endpointId).trim(),
    endpointKind: 'supply',
    exposure: 'none',
    resolutionStatus: 'resolved',
    ownerKind: 'automatic_route',
    sourceKind: 'upstream_model',
    enabled: target.enabled !== false && input.route?.enabled !== false,
    displayIcon: input.route?.displayIcon ?? null,
    modelPattern: sourceModel,
    publicModelName: null,
    upstreamModels: sourceModel ? [sourceModel] : [],
    siteNames: normalizeTextList([row.sites.name]),
    targetCount: 1,
    sourceRouteIds: [target.routeId],
    tags: [],
    metadata,
  };
}

async function selectRouteEndpointTargetCatalogPageRows(input: {
  offset: number;
  limit: number;
}): Promise<RouteEndpointTargetCatalogRow[]> {
  if (input.limit <= 0) return [];
  return await db.select()
    .from(schema.routeEndpointTargets)
    .innerJoin(schema.accounts, eq(schema.routeEndpointTargets.accountId, schema.accounts.id))
    .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .leftJoin(schema.accountTokens, eq(schema.routeEndpointTargets.tokenId, schema.accountTokens.id))
    .orderBy(schema.routeEndpointTargets.id)
    .limit(input.limit)
    .offset(input.offset)
    .all() as RouteEndpointTargetCatalogRow[];
}

async function loadRouteModelPatternContext(routeIdsInput: number[]): Promise<{
  routeById: Map<number, typeof schema.tokenRoutes.$inferSelect>;
  routeModelPatternById: Map<number, string>;
}> {
  const routeIds = Array.from(new Set(routeIdsInput
    .map((routeId) => Math.trunc(Number(routeId)))
    .filter((routeId) => Number.isFinite(routeId) && routeId > 0)));
  if (routeIds.length === 0) {
    return { routeById: new Map(), routeModelPatternById: new Map() };
  }
  const [routes, routeGroups, bindingProjections] = await Promise.all([
    db.select().from(schema.tokenRoutes).where(inArray(schema.tokenRoutes.id, routeIds)).all(),
    db.select().from(schema.routeGroups).where(inArray(schema.routeGroups.legacyRouteId, routeIds)).all(),
    loadRouteBindingProjectionsForRouteIds(routeIds),
  ]);
  const routeById = new Map<number, typeof routes[number]>(routes.map((route) => [route.id, route]));
  const routeGroupByLegacyRouteId = new Map<number, typeof routeGroups[number]>();
  for (const routeGroup of routeGroups) {
    const routeId = Number(routeGroup.legacyRouteId || 0);
    if (Number.isFinite(routeId) && routeId > 0) routeGroupByLegacyRouteId.set(Math.trunc(routeId), routeGroup);
  }
  const routeModelPatternById = new Map<number, string>();
  for (const route of routes) {
    const projection = bindingProjections.get(route.id);
    const projectedModelPattern = projection
      ? deriveLegacyModelPatternFromSpecs(projection.match, projection.backend)
      : '';
    routeModelPatternById.set(route.id, projectedModelPattern || readRouteModelPattern({
      route,
      routeGroup: routeGroupByLegacyRouteId.get(route.id) || null,
      isExplicitGroup: projection?.backend.kind === 'routes',
    }));
  }
  return { routeById, routeModelPatternById };
}

async function buildSupplyCatalogItemsForTargetPage(input: {
  offset: number;
  limit: number;
}): Promise<RouteEndpointCatalogItem[]> {
  const targetRows = await selectRouteEndpointTargetCatalogPageRows(input);
  const { routeById, routeModelPatternById } = await loadRouteModelPatternContext(
    targetRows.map((row) => row.route_endpoint_targets.routeId),
  );
  return targetRows.map((row) => routeEndpointTargetCatalogRowToItem(row, {
    route: routeById.get(row.route_endpoint_targets.routeId) || null,
    routeModelPattern: routeModelPatternById.get(row.route_endpoint_targets.routeId) || '',
    metadataSource: 'route_target_projection_page',
  }));
}

async function buildProductCatalogItemsForRoutePage(
  routes: Array<typeof schema.tokenRoutes.$inferSelect>,
): Promise<RouteEndpointCatalogItem[]> {
  if (routes.length === 0) return [];
  const routeIdList = routes.map((route) => route.id);
  const [routeGroups, routeGroupSources, bindingProjections] = await Promise.all([
    db.select().from(schema.routeGroups)
      .where(inArray(schema.routeGroups.legacyRouteId, routeIdList))
      .all(),
    db.select().from(schema.routeGroupSources)
      .where(inArray(schema.routeGroupSources.groupRouteId, routeIdList))
      .all(),
    loadRouteBindingProjectionsForRouteIds(routeIdList),
  ]);
  const routeIds = new Set(routes.map((route) => route.id));
  const routeGroupByLegacyRouteId = new Map<number, typeof routeGroups[number]>();
  for (const routeGroup of routeGroups) {
    const routeId = Number(routeGroup.legacyRouteId || 0);
    if (routeIds.has(routeId)) routeGroupByLegacyRouteId.set(routeId, routeGroup);
  }
  const sourceRouteIdsByGroupRouteId = new Map<number, number[]>();
  const targetRouteIds = new Set<number>();
  for (const source of routeGroupSources) {
    if (!routeIds.has(source.groupRouteId)) continue;
    const existing = sourceRouteIdsByGroupRouteId.get(source.groupRouteId) || [];
    existing.push(source.sourceRouteId);
    sourceRouteIdsByGroupRouteId.set(source.groupRouteId, existing);
    targetRouteIds.add(source.sourceRouteId);
  }
  for (const route of routes) {
    if (!sourceRouteIdsByGroupRouteId.has(route.id)) targetRouteIds.add(route.id);
    const projection = bindingProjections.get(route.id);
    if (projection?.backend.kind === 'routes') {
      for (const sourceRouteId of projection.backend.routeIds) targetRouteIds.add(sourceRouteId);
    }
  }

  const targetRows = await selectRouteEndpointTargetCatalogRows(Array.from(targetRouteIds));
  const routeTargetCounts = new Map<number, number>();
  const routeEnabledTargetCounts = new Map<number, number>();
  const routeSiteNames = new Map<number, Set<string>>();
  const routeSiteIds = new Map<number, Set<number>>();
  const routeModels = new Map<number, Set<string>>();
  for (const row of targetRows) {
    const target = row.route_endpoint_targets;
    routeTargetCounts.set(target.routeId, (routeTargetCounts.get(target.routeId) || 0) + 1);
    if (target.enabled !== false) {
      routeEnabledTargetCounts.set(target.routeId, (routeEnabledTargetCounts.get(target.routeId) || 0) + 1);
    }
    const model = String(target.sourceModel || '').trim();
    if (model) {
      const models = routeModels.get(target.routeId) || new Set<string>();
      models.add(model);
      routeModels.set(target.routeId, models);
    }
    const siteName = String(row.sites.name || '').trim();
    if (siteName) {
      const names = routeSiteNames.get(target.routeId) || new Set<string>();
      names.add(siteName);
      routeSiteNames.set(target.routeId, names);
    }
    const siteIds = routeSiteIds.get(target.routeId) || new Set<number>();
    siteIds.add(row.sites.id);
    routeSiteIds.set(target.routeId, siteIds);
  }

  return routes.map((route): RouteEndpointCatalogItem => {
    const explicitSourceRouteIds = sourceRouteIdsByGroupRouteId.get(route.id) || [];
    const projection = bindingProjections.get(route.id);
    const sourceRouteIds = explicitSourceRouteIds.length > 0
      ? explicitSourceRouteIds
      : (projection?.backend.kind === 'routes' ? projection.backend.routeIds : [route.id]);
    const isExplicitGroup = sourceRouteIds.length > 0 && !(sourceRouteIds.length === 1 && sourceRouteIds[0] === route.id);
    const routeGroup = routeGroupByLegacyRouteId.get(route.id) || null;
    const projectedModelPattern = projection ? deriveLegacyModelPatternFromSpecs(projection.match, projection.backend) : '';
    const inferredModelPattern = projectedModelPattern
      || readRouteModelPattern({ route, routeGroup, isExplicitGroup })
      || (Array.from(routeModels.get(route.id) || []).length === 1 ? Array.from(routeModels.get(route.id) || [])[0] : '');
    const endpointId = isExplicitGroup
      ? routeGraphRouteProductEndpointIdFromRoute(route.id)
      : routeGraphAutoModelProductEndpointId((inferredModelPattern || String(route.id)).toLowerCase());
    const upstreamModels = Array.from(new Set(sourceRouteIds.flatMap((routeId) => Array.from(routeModels.get(routeId) || []))));
    const siteNames = Array.from(new Set(sourceRouteIds.flatMap((routeId) => Array.from(routeSiteNames.get(routeId) || []))));
    const siteIds = Array.from(new Set(sourceRouteIds.flatMap((routeId) => Array.from(routeSiteIds.get(routeId) || []))));
    const targetCount = sourceRouteIds.reduce((sum, routeId) => sum + (routeTargetCounts.get(routeId) || 0), 0);
    const label = String(route.displayName || routeGroup?.displayName || routeGroup?.publicModelName || inferredModelPattern || endpointId).trim();
    return {
      endpointId,
      nodeId: endpointId,
      routeId: route.id,
      label,
      endpointKind: 'route_product',
      exposure: projection?.visibility ?? (routeGroup?.visibility === 'internal' ? 'internal' : 'public'),
      resolutionStatus: targetCount > 0 ? 'resolved' : 'unresolved',
      ownerKind: 'automatic_route',
      sourceKind: isExplicitGroup ? 'manual_group' : 'automatic_model_group',
      enabled: route.enabled !== false,
      displayIcon: route.displayIcon ?? routeGroup?.displayIcon ?? null,
      modelPattern: inferredModelPattern,
      publicModelName: routeGroup?.publicModelName || inferredModelPattern || null,
      upstreamModels,
      siteNames,
      targetCount,
      sourceRouteIds,
      tags: [],
      metadata: {
        source: 'route_table_projection_page',
        siteIds,
        enabledTargetCount: sourceRouteIds.reduce((sum, routeId) => sum + (routeEnabledTargetCounts.get(routeId) || 0), 0),
      },
    };
  });
}

async function listRouteEndpointCatalogPageFast(input: ReturnType<typeof normalizeCatalogQuery>): Promise<RouteEndpointCatalogPage | null> {
  if (input.q || input.routeId || input.siteId) return null;
  const includeProducts = input.endpointKind === 'all' || input.endpointKind === 'route_product';
  const includeSupply = input.endpointKind === 'all' || input.endpointKind === 'supply';
  const productTotal = includeProducts ? await countTableRows(schema.tokenRoutes) : 0;
  const supplyTotal = includeSupply ? await countTableRows(schema.routeEndpointTargets) : 0;
  const totalCount = productTotal + supplyTotal;
  const offset = (input.page - 1) * input.pageSize;
  const items: RouteEndpointCatalogItem[] = [];
  if (includeProducts && offset < productTotal) {
    const productLimit = Math.min(input.pageSize, productTotal - offset);
    const routes = await db.select().from(schema.tokenRoutes)
      .orderBy(schema.tokenRoutes.id)
      .limit(productLimit)
      .offset(offset)
      .all();
    items.push(...await buildProductCatalogItemsForRoutePage(routes));
  }
  if (includeSupply && items.length < input.pageSize) {
    const supplyOffset = includeProducts ? Math.max(0, offset - productTotal) : offset;
    const consumedProductCount = includeProducts ? Math.max(0, Math.min(productTotal - offset, input.pageSize)) : 0;
    if (!includeProducts || offset >= productTotal || consumedProductCount < input.pageSize) {
      const supplyLimit = input.pageSize - items.length;
      items.push(...await buildSupplyCatalogItemsForTargetPage({
        offset: supplyOffset,
        limit: supplyLimit,
      }));
    }
  }
  return {
    items,
    pageInfo: {
      page: input.page,
      pageSize: input.pageSize,
      totalCount,
      hasMore: offset + items.length < totalCount,
    },
  };
}

export async function listRouteEndpointCatalogPage(input: RouteEndpointCatalogQuery = {}): Promise<RouteEndpointCatalogPage> {
  const query = normalizeCatalogQuery(input);
  const fastPage = await listRouteEndpointCatalogPageFast(query);
  if (fastPage) return fastPage;
  const catalog = await loadRouteEndpointCatalogProjection();
  const filtered = catalog.filter((item) => catalogItemMatchesQuery(item, query));
  const offset = (query.page - 1) * query.pageSize;
  const items = filtered.slice(offset, offset + query.pageSize);
  return {
    items,
    pageInfo: {
      page: query.page,
      pageSize: query.pageSize,
      totalCount: filtered.length,
      hasMore: offset + items.length < filtered.length,
    },
  };
}

export async function listRouteEndpointCatalog(input: RouteEndpointCatalogQuery = {}): Promise<RouteEndpointCatalogItem[]> {
  const query = normalizeCatalogQuery({
    ...input,
    page: 1,
    pageSize: ROUTE_ENDPOINT_CATALOG_MAX_PAGE_SIZE,
  });
  const unpagedQuery = {
    ...query,
    page: 1,
    pageSize: ROUTE_ENDPOINT_CATALOG_LEGACY_MAX_ITEMS,
  };
  const catalog = await loadRouteEndpointCatalogProjection();
  return catalog
    .filter((item) => catalogItemMatchesQuery(item, unpagedQuery))
    .slice(0, ROUTE_ENDPOINT_CATALOG_LEGACY_MAX_ITEMS);
}

export async function resolveRouteEndpointSourceRouteIds(endpointIdsInput: unknown): Promise<RouteEndpointSourceRouteResolution> {
  const endpointIds = Array.isArray(endpointIdsInput)
    ? Array.from(new Set(endpointIdsInput.map((endpointId) => String(endpointId || '').trim()).filter(Boolean)))
    : [];
  if (endpointIds.length === 0) {
    return { routeIds: [], missingEndpointIds: [], unresolvedEndpointIds: [] };
  }
  const routeEndpoints = await listRouteEndpointCatalog();
  const endpointsById = new Map<string, RouteEndpointCatalogItem>();
  for (const endpoint of routeEndpoints) {
    endpointsById.set(endpoint.endpointId, endpoint);
    endpointsById.set(endpoint.nodeId, endpoint);
  }
  const routeIds: number[] = [];
  const missingEndpointIds: string[] = [];
  const unresolvedEndpointIds: string[] = [];
  for (const endpointId of endpointIds) {
    const endpoint = endpointsById.get(endpointId);
    if (!endpoint) {
      missingEndpointIds.push(endpointId);
      continue;
    }
    if (endpoint.resolutionStatus === 'unresolved') {
      unresolvedEndpointIds.push(endpointId);
      continue;
    }
    const sourceRouteIds = endpoint.sourceRouteIds || [];
    if (sourceRouteIds.length > 0) {
      routeIds.push(...sourceRouteIds);
      continue;
    }
    if (Number.isFinite(Number(endpoint.routeId)) && Number(endpoint.routeId) > 0) {
      routeIds.push(Math.trunc(Number(endpoint.routeId)));
      continue;
    }
    unresolvedEndpointIds.push(endpointId);
  }
  return {
    routeIds: Array.from(new Set(routeIds)),
    missingEndpointIds,
    unresolvedEndpointIds,
  };
}

function loadRouteBindingsFromSourceGraph(sourceGraph: RouteGraphSource): Map<number, RouteGraphRouteBinding> {
  const macroVisibilityByRouteId = new Map<number, RouteGraphVisibility>();
  for (const macro of sourceGraph.macros || []) {
    const routeId = routeIdFromRouteTableMacroId(macro.id);
    if (!routeId) continue;
    macroVisibilityByRouteId.set(routeId, macro.visibility === 'internal' ? 'internal' : 'public');
  }

  const bindings = new Map<number, RouteGraphRouteBinding>();
  for (const node of sourceGraph.nodes) {
    const record = node as Record<string, unknown>;
    if (record.type !== 'route_endpoint' || record.endpointKind !== 'route_product') continue;
    const routeId = Number(record.routeId ?? record.legacyRouteId ?? (record.match as { routeId?: unknown } | undefined)?.routeId);
    if (!Number.isFinite(routeId) || routeId <= 0) continue;
    const match = normalizeRouteGraphMatchSpec(record.match);
    const endpointBackend = normalizeRouteGraphBackendSpec(record.backend);
    const sourceKind = String(record.sourceKind || '');
    const routeMode = sourceKind === 'automatic_model_group'
      ? 'pattern'
      : (endpointBackend.kind === 'routes' ? 'explicit_group' : 'pattern');
    const sourceRouteIds = routeMode === 'explicit_group' && endpointBackend.kind === 'routes'
      ? endpointBackend.routeIds
      : [];
    const modelPattern = routeMode === 'explicit_group'
      ? (match.displayName || match.requestedModelPattern || '')
      : (match.requestedModelPattern || match.displayName || '');
    const exposure = String(record.exposure || '');
    bindings.set(Math.trunc(routeId), {
      routeId: Math.trunc(routeId),
      entryNodeId: String(record.id || ''),
      match,
      backend: routeMode === 'explicit_group'
        ? { kind: 'routes', routeIds: sourceRouteIds }
        : { kind: 'supply' },
      visibility: macroVisibilityByRouteId.get(Math.trunc(routeId)) || (exposure === 'internal' ? 'internal' : 'public'),
      sourceRouteIds,
      exposedModelName: modelPattern,
      exactModelName: routeMode === 'explicit_group' ? '' : (match.requestedModelPattern || ''),
      routeMode,
    });
  }
  if (bindings.size > 0) return bindings;

  for (const node of sourceGraph.nodes) {
    const record = node as Record<string, unknown>;
    if (record.type !== 'entry') continue;
    const match = normalizeRouteGraphMatchSpec(record.match);
    const routeId = Number(match.routeId || String(record.id || '').replace(/^entry:legacy:/, ''));
    if (!Number.isFinite(routeId) || routeId <= 0) continue;
    bindings.set(Math.trunc(routeId), {
      routeId: Math.trunc(routeId),
      entryNodeId: String(record.id || ''),
      match,
      backend: { kind: 'supply' },
      visibility: record.visibility === 'internal' ? 'internal' : 'public',
      sourceRouteIds: [],
      exposedModelName: match.requestedModelPattern || match.displayName || '',
      exactModelName: match.requestedModelPattern || '',
      routeMode: 'pattern',
    });
  }
  return bindings;
}

export async function loadActiveRouteGraphRouteBindings(): Promise<Map<number, RouteGraphRouteBinding>> {
  const activeVersionId = await getActiveRouteGraphVersionId();
  if (activeVersionId && activeRouteGraphBindingsCache?.versionId === activeVersionId) {
    return new Map(activeRouteGraphBindingsCache.bindings);
  }
  const activeSource = await getActiveRouteGraphSourceVersion() ?? await ensureActiveRouteGraphSourceVersion();
  if (activeSource) {
    const sourceBindings = loadRouteBindingsFromSourceGraph(activeSource.sourceGraph);
    if (sourceBindings.size > 0) {
      activeRouteGraphBindingsCache = {
        versionId: activeSource.id,
        bindings: new Map(sourceBindings),
      };
      return sourceBindings;
    }
  }
  const active = await ensureActiveRouteGraphVersion();
  if (activeRouteGraphBindingsCache?.versionId === active.id) {
    return new Map(activeRouteGraphBindingsCache.bindings);
  }
  const compiledGraph = active.compiledGraph;
  const macroVisibilityByRouteId = new Map<number, RouteGraphVisibility>();
  for (const macro of active.sourceGraph.macros || []) {
    const routeId = routeIdFromRouteTableMacroId(macro.id);
    if (!routeId) continue;
    macroVisibilityByRouteId.set(routeId, macro.visibility === 'internal' ? 'internal' : 'public');
  }
  const primitiveNodes = Object.values(compiledGraph.nodesById);
  const primitiveEdges = Object.values(compiledGraph.edgesByFromPort).flat();
  const byEntryId = new Map(primitiveNodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, typeof primitiveEdges>();
  const incoming = new Map<string, typeof primitiveEdges>();
  for (const edge of primitiveEdges) {
    if (!outgoing.has(edge.sourceNodeId)) outgoing.set(edge.sourceNodeId, []);
    outgoing.get(edge.sourceNodeId)!.push(edge);
    if (!incoming.has(edge.targetNodeId)) incoming.set(edge.targetNodeId, []);
    incoming.get(edge.targetNodeId)!.push(edge);
  }
  const binding = new Map<number, RouteGraphRouteBinding>();
  for (const endpoint of compiledGraph.routeEndpoints) {
    if (endpoint.endpointKind !== 'route_product') continue;
    const routeId = Number(endpoint.routeId);
    if (!Number.isFinite(routeId) || routeId <= 0) continue;
    const node = byEntryId.get(endpoint.nodeId) || null;
    const targetEdges = [
      ...(outgoing.get(endpoint.nodeId) || []).filter((edge) => edge.sourcePortId === 'route.out'),
      ...(outgoing.get(legacyRouteIdToRouteGraphEntryNodeId(routeId)) || []).filter((edge) => edge.sourcePortId === 'bidirect.out'),
    ];
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
          sourceRouteIds.push(...routeIdsFromRouteTableCandidateNode(source));
        }
        continue;
      }
    }
    const uniqueSourceRouteIds = Array.from(new Set(sourceRouteIds));
    const endpointBackend = endpoint.backend;
    const groupSourceRouteIds = endpoint.sourceKind === 'automatic_model_group'
      ? []
      : endpointBackend.kind === 'routes'
      ? endpointBackend.routeIds
      : uniqueSourceRouteIds.filter((sourceRouteId) => sourceRouteId !== routeId);
    const routeMode = endpoint.sourceKind === 'automatic_model_group'
      ? 'pattern'
      : (endpointBackend.kind === 'routes' || groupSourceRouteIds.length > 0 ? 'explicit_group' : 'pattern');
    const modelPattern = routeMode === 'explicit_group'
      ? (endpoint.match.displayName || endpoint.match.requestedModelPattern || '')
      : (endpoint.match.requestedModelPattern || endpoint.match.displayName || '');
    binding.set(routeId, {
      routeId,
      entryNodeId: endpoint.nodeId,
      match: endpoint.match,
      backend: routeMode === 'explicit_group'
        ? { kind: 'routes', routeIds: groupSourceRouteIds }
        : { kind: 'supply' },
      visibility: macroVisibilityByRouteId.get(routeId) || (endpoint.exposure === 'internal' ? 'internal' : 'public'),
      sourceRouteIds: routeMode === 'explicit_group' ? groupSourceRouteIds : [],
      exposedModelName: modelPattern,
      exactModelName: routeMode === 'explicit_group' ? '' : (endpoint.match.requestedModelPattern || ''),
      routeMode,
    });
  }
  if (binding.size > 0) {
    activeRouteGraphBindingsCache = {
      versionId: active.id,
      bindings: new Map(binding),
    };
    return binding;
  }
  for (const node of primitiveNodes) {
    if (node.type !== 'entry') continue;
    const routeId = Number(node.match.routeId || String(node.id).replace(/^entry:legacy:/, ''));
    if (!Number.isFinite(routeId) || routeId <= 0) continue;
    binding.set(routeId, {
      routeId,
      entryNodeId: node.id,
      match: node.match,
      backend: { kind: 'supply' },
      visibility: 'public',
      sourceRouteIds: [],
      exposedModelName: node.match.requestedModelPattern || node.match.displayName || '',
      exactModelName: node.match.requestedModelPattern || '',
      routeMode: 'pattern',
    });
  }
  activeRouteGraphBindingsCache = {
    versionId: active.id,
    bindings: new Map(binding),
  };
  return binding;
}
