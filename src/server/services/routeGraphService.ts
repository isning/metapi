import { desc, eq } from 'drizzle-orm';
import { requireInsertedRowId } from '../db/insertHelpers.js';
import { db, schema } from '../db/index.js';
import {
  buildRouteGraphSourceFromLegacyRoutes,
  compileRouteGraphSource,
  deriveLegacyModelPatternFromSpecs,
  legacyRouteIdToRouteGraphEntryNodeId,
  normalizeRouteGraphBackendSpec,
  normalizeRouteGraphSource,
  parseRouteGraphSource,
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
  if (candidate.version !== 3 || !candidate.matcher || typeof candidate.matcher !== 'object' || !Array.isArray(candidate.programs)) {
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
  const hasV3 = candidate.programs.some((program) => (
    program
    && typeof program === 'object'
    && !Array.isArray(program)
    && typeof (program as { startOpId?: unknown }).startOpId === 'string'
    && !!String((program as { startOpId?: unknown }).startOpId).trim()
    && Array.isArray((program as { ops?: unknown }).ops)
  ));
  if (!hasV3) return false;

  const flatBundle = candidateGraph?.flatProgramBundle;
  if (!flatBundle || typeof flatBundle !== 'object' || Array.isArray(flatBundle)) return false;
  const flatCandidate = flatBundle as {
    version?: unknown;
    matcher?: unknown;
    programs?: unknown;
    diagnostics?: unknown;
  };
  if (flatCandidate.version !== 4 || !flatCandidate.matcher || typeof flatCandidate.matcher !== 'object' || !Array.isArray(flatCandidate.programs)) {
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
  const hasV4 = flatCandidate.programs.some((program) => (
    program
    && typeof program === 'object'
    && !Array.isArray(program)
    && !!(program as { start?: unknown }).start
  ));
  return hasV4;
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
  const match = /^(?:entry|dispatcher|pool):legacy:(\d+)$/.exec(String(node.id || ''));
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
    const match = /^(?:pool):legacy:(\d+)$/.exec(String(node.id || ''));
    if (match) {
      const routeId = Number(match[1]);
      return Number.isFinite(routeId) && routeId > 0 ? routeId : null;
    }
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
    result.set(routeId, {
      match: endpoint.match,
      backend: endpoint.backend,
      visibility: macroVisibilityByRouteId.get(routeId) || (endpoint.exposure === 'internal' ? 'internal' : 'public'),
    });
  }
  if (result.size > 0) return result;
  for (const entry of compiled.compiled.entries) {
    const routeId = Number(entry.match.routeId || routeIdFromLegacyGraphNodeId(entry.nodeId));
    if (!Number.isFinite(routeId) || routeId <= 0) continue;
    result.set(routeId, {
      match: entry.match,
      backend: entry.backend,
      visibility: macroVisibilityByRouteId.get(routeId) || entry.visibility || 'public',
    });
  }
  return result;
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
  const [routes, groupSources, routeEndpointTargets] = await Promise.all([
    db.select().from(schema.tokenRoutes).all(),
    db.select().from(schema.routeGroupSources).all(),
    db.select().from(schema.routeEndpointTargets).all(),
  ]);
  const accountIdsWithRouteEndpointTargets = Array.from(new Set(routeEndpointTargets.map((channel) => channel.accountId)));
  const tokenIdsWithRouteEndpointTargets = Array.from(new Set(routeEndpointTargets
    .map((channel) => channel.tokenId)
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
  for (const channel of routeEndpointTargets) {
    const sourceModel = String(channel.sourceModel || '').trim();
    const account = accountById.get(channel.accountId) || null;
    const token = channel.tokenId ? tokenById.get(channel.tokenId) || null : null;
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
      localRouteId: channel.routeId,
      routeTargetId: channel.id,
      accountId: channel.accountId,
      tokenId: channel.tokenId,
      oauthRouteUnitId: channel.oauthRouteUnitId,
    };
    const existingTargets = targetsByRouteId.get(channel.routeId) || [];
    const target = {
      targetId: String(channel.id),
      model: sourceModel,
      modelSource: sourceModel ? 'fixed' : 'request',
      accountId: channel.accountId,
      tokenId: channel.tokenId,
      siteId: site?.id ?? null,
      weight: channel.weight,
      priority: channel.priority,
      metadata: {
        ...localRef,
        routeTargetId: channel.id,
        endpointIdentity: stableEndpointIdentity,
        oauthRouteUnitId: channel.oauthRouteUnitId,
        enabled: channel.enabled !== false,
        manualOverride: channel.manualOverride === true,
        successCount: channel.successCount || 0,
        failCount: channel.failCount || 0,
        consecutiveFailCount: channel.consecutiveFailCount || 0,
        cooldownLevel: channel.cooldownLevel || 0,
        cooldownUntil: channel.cooldownUntil || null,
      },
    };
    existingTargets.push(target);
    targetsByRouteId.set(channel.routeId, existingTargets);
    const existingLocalRefs = endpointLocalRefsByRouteId.get(channel.routeId) || [];
    existingLocalRefs.push(localRef);
    endpointLocalRefsByRouteId.set(channel.routeId, existingLocalRefs);
    const existingIdentities = endpointStableTargetsByRouteId.get(channel.routeId) || [];
    endpointStableTargetsByRouteId.set(channel.routeId, [...existingIdentities, stableEndpointIdentity]);
    const existingSupplySpecs = supplyEndpointSpecsByRouteId.get(channel.routeId) || [];
    existingSupplySpecs.push({
      endpointIdentity: stableEndpointIdentity,
      endpointLocalRefs: [localRef],
      targets: [target],
    });
    supplyEndpointSpecsByRouteId.set(channel.routeId, existingSupplySpecs);
    if (!sourceModel) {
      continue;
    }
    const existing = sourceModelsByRouteId.get(channel.routeId) || [];
    if (!existing.includes(sourceModel)) existing.push(sourceModel);
    sourceModelsByRouteId.set(channel.routeId, existing);
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
    const routeTargets = routeEndpointTargets.filter((channel) => channel.routeId === route.id);
    if (routeTargets.length === 0) continue;
    const routeAccountModelSet = new Set<string>();
    for (const target of routeTargets) {
      for (const model of availableModelsByAccountId.get(target.accountId) || []) {
        routeAccountModelSet.add(model);
      }
    }
    const routeAccountModels = Array.from(routeAccountModelSet);
    const sourceRouteIds = sourceRouteIdsByGroupRouteId.get(route.id) || [];
    const previous = routeOverrides.get(route.id) ?? previousRouteBindingByRouteId.get(route.id);
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
    const previous = routeOverrides.get(route.id) ?? previousRouteBindingByRouteId.get(route.id);
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
  if (active) return active;

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
  const row = await db.select().from(schema.routeGraphVersions)
    .where(eq(schema.routeGraphVersions.id, pointer.versionId))
    .get();
  if (!row) return null;
  const sourceGraph = parseRouteGraphSource(row.sourceGraphJson);
  let compiledGraph = parseJsonObject<CompiledRouteGraph>(row.compiledGraphJson, compileRouteGraphSource(null).compiled);
  if (!hasRouteProgramBundle(compiledGraph)) {
    compiledGraph = compileRouteGraphSource(sourceGraph).compiled;
    await db.update(schema.routeGraphVersions).set({
      compiledGraphJson: JSON.stringify(compiledGraph),
    }).where(eq(schema.routeGraphVersions.id, row.id)).run();
  }
  return {
    id: row.id,
    version: row.version,
    sourceGraph,
    compiledGraph,
    status: row.status,
    createdAt: row.createdAt,
    activatedAt: row.activatedAt,
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
  const bindings = await loadActiveRouteGraphRouteBindings();
  return new Map(Array.from(bindings.entries()).map(([routeId, binding]) => [routeId, {
    routeId: binding.routeId,
    entryNodeId: binding.entryNodeId,
    match: binding.match,
    backend: binding.backend,
    visibility: binding.visibility,
    sourceRouteIds: binding.sourceRouteIds,
    modelPattern: binding.exposedModelName,
    routeMode: binding.routeMode,
  }]));
}

export async function listRouteEndpointCatalog(): Promise<RouteEndpointCatalogItem[]> {
  const active = await ensureActiveRouteGraphVersion();
  const compiledGraph = active.compiledGraph;
  const programEndpointCatalog = compiledGraph.programBundle?.endpointCatalog?.byId;
  const routeEndpoints = programEndpointCatalog && Object.keys(programEndpointCatalog).length > 0
    ? Object.values(programEndpointCatalog)
    : (compiledGraph.routeEndpoints || []);
  const nodesById = new Map(Object.entries(compiledGraph.nodesById || {}));
  const routeRows = await db.select().from(schema.tokenRoutes).all();
  const routeById = new Map<number, typeof routeRows[number]>(routeRows.map((route) => [route.id, route]));
  const routeEndpointTargets = await db.select().from(schema.routeEndpointTargets).all();
  const routeSiteNames = new Map<number, Set<string>>();
  const routeModels = new Map<number, Set<string>>();
  const routeTargetCounts = new Map<number, number>();
  const accountIds = Array.from(new Set(routeEndpointTargets.map((channel) => channel.accountId).filter((id): id is number => Number.isFinite(Number(id)))));
  const accounts = accountIds.length > 0
    ? await db.select().from(schema.accounts).all()
    : [];
  const sites = accounts.length > 0
    ? await db.select().from(schema.sites).all()
    : [];
  const accountById = new Map<number, typeof accounts[number]>(accounts.map((account) => [account.id, account]));
  const siteById = new Map<number, typeof sites[number]>(sites.map((site) => [site.id, site]));
  for (const channel of routeEndpointTargets) {
    routeTargetCounts.set(channel.routeId, (routeTargetCounts.get(channel.routeId) || 0) + 1);
    const model = String(channel.sourceModel || '').trim();
    if (model) {
      const models = routeModels.get(channel.routeId) || new Set<string>();
      models.add(model);
      routeModels.set(channel.routeId, models);
    }
    const account = accountById.get(channel.accountId);
    const site = account ? siteById.get(account.siteId) : null;
    const siteName = String(site?.name || '').trim();
    if (siteName) {
      const names = routeSiteNames.get(channel.routeId) || new Set<string>();
      names.add(siteName);
      routeSiteNames.set(channel.routeId, names);
    }
  }
  const normalizeTextList = (values: unknown[]) => Array.from(new Set(values
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
  const readRecord = (value: unknown): Record<string, unknown> | null => (
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  );
  const readEndpointIdentity = (value: unknown): Record<string, unknown> | null => {
    const record = readRecord(value);
    const metadata = readRecord(record?.metadata);
    return readRecord(metadata?.endpointIdentity) || readRecord(record?.endpointIdentity);
  };

  return routeEndpoints.map((endpoint) => {
    const node = nodesById.get(endpoint.nodeId);
    const sourceRouteIds = endpoint.backend.kind === 'routes'
      ? endpoint.backend.routeIds
      : (endpoint.routeId ? [endpoint.routeId] : []);
    const route = endpoint.routeId ? routeById.get(endpoint.routeId) : null;
    const label = String(node?.name || route?.displayName || endpoint.match.displayName || endpoint.match.requestedModelPattern || endpoint.endpointId);
    const metadata = node && 'metadata' in node && node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
      ? node.metadata as Record<string, unknown>
      : {};
    const supplyTargets = endpoint.endpointKind === 'supply'
      ? (compiledGraph.programBundle?.endpointCatalog?.supplyTargets?.[endpoint.endpointId] || [])
      : [];
    const supplyIdentities = [
      ...supplyTargets.map((target) => readEndpointIdentity(target)),
      readEndpointIdentity(metadata),
    ].filter((identity): identity is Record<string, unknown> => !!identity);
    const endpointUpstreamModels = endpoint.endpointKind === 'supply' && supplyIdentities.length > 0
      ? normalizeTextList(supplyIdentities.map((identity) => identity.model))
      : Array.from(new Set(sourceRouteIds.flatMap((routeId) => Array.from(routeModels.get(routeId) || []))));
    const endpointSiteNames = endpoint.endpointKind === 'supply' && supplyIdentities.length > 0
      ? normalizeTextList(supplyIdentities.map((identity) => identity.siteName))
      : Array.from(new Set(sourceRouteIds.flatMap((routeId) => Array.from(routeSiteNames.get(routeId) || []))));
    return {
      endpointId: endpoint.endpointId,
      nodeId: endpoint.nodeId,
      routeId: endpoint.routeId,
      label,
      exposure: endpoint.exposure,
      endpointKind: endpoint.endpointKind,
      resolutionStatus: endpoint.resolutionStatus,
      ownerKind: endpoint.ownerKind,
      sourceKind: endpoint.sourceKind,
      enabled: endpoint.enabled,
      displayIcon: route?.displayIcon ?? null,
      modelPattern: endpoint.match.requestedModelPattern || endpoint.match.displayName || '',
      publicModelName: endpoint.publicModelName || null,
      upstreamModels: endpointUpstreamModels,
      siteNames: endpointSiteNames,
      targetCount: endpoint.endpointKind === 'supply'
        ? supplyTargets.length
        : sourceRouteIds.reduce((sum, routeId) => sum + (routeTargetCounts.get(routeId) || 0), 0),
      sourceRouteIds,
      tags: [],
      metadata,
    };
  });
}

export async function resolveRouteEndpointSourceRouteIds(endpointIdsInput: unknown): Promise<RouteEndpointSourceRouteResolution> {
  const endpointIds = Array.isArray(endpointIdsInput)
    ? Array.from(new Set(endpointIdsInput.map((endpointId) => String(endpointId || '').trim()).filter(Boolean)))
    : [];
  if (endpointIds.length === 0) {
    return { routeIds: [], missingEndpointIds: [], unresolvedEndpointIds: [] };
  }
  const active = await ensureActiveRouteGraphVersion();
  const compiledGraph = active.compiledGraph;
  const programEndpointCatalog = compiledGraph.programBundle?.endpointCatalog?.byId;
  const routeEndpoints = programEndpointCatalog && Object.keys(programEndpointCatalog).length > 0
    ? Object.values(programEndpointCatalog)
    : (compiledGraph.routeEndpoints || []);
  const endpointsById = new Map<string, typeof routeEndpoints[number]>();
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
    if (endpoint.backend.kind === 'routes') {
      routeIds.push(...endpoint.backend.routeIds);
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

export async function loadActiveRouteGraphRouteBindings(): Promise<Map<number, RouteGraphRouteBinding>> {
  const active = await ensureActiveRouteGraphVersion();
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
  if (binding.size > 0) return binding;
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
  return binding;
}
