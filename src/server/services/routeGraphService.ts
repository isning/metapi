import { and, desc, eq, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { config } from "../config.js";
import { requireInsertedRowId } from "../db/insertHelpers.js";
import { db, schema } from "../db/index.js";
import {
  compileRouteGraphSource,
  getRouteGraphModelPatternFromSpecs,
  normalizeRouteGraphSource,
  parseRouteGraphSource,
  stringifyRouteGraphSource,
  validateNativeRouteGraphSourcePolicies,
  type RouteGraphCompileResult,
  type RouteGraphDiagnostic,
  type RouteGraphEdge,
  type RouteGraphMacro,
  type RouteGraphNode,
  type RouteGraphSource,
} from "../../shared/routeGraph.js";
import { createManagedRouteGraphElementId, createManualRouteGraphEdgeId, createManualRouteGraphNodeId, createRouteMacroSemanticNodeId, stableRoutingIdentityJson } from "../../shared/routingIdentity.js";
import type { RouteGraphAuthoringPayload } from "../contracts/routeManagementPayloads.js";
import type { CompiledRouteGraph } from "../../shared/compiledRuntime.js";
import {
  invalidateRouteRuntimeCaches,
  type RouteRuntimeInvalidationReason,
} from "./routeRuntimeCacheService.js";
import { invalidateRouteRuntimeSelectorState } from "./routeRuntimeSelectorStateService.js";
import {
  assertRouteRuntimeArtifactTransportBindings,
  cacheActiveRouteRuntimeArtifact,
  compiledRouteGraphFromRuntimeArtifact,
  invalidateRouteRuntimeArtifactPointerCache,
  loadRouteRuntimeArtifactForSourceGraphVersion,
  persistAndActivateRouteRuntimeArtifact,
  primeRouteRuntimeArtifactExecutionIdentities,
  type ActiveRouteRuntimeArtifact,
} from "./routeRuntimeArtifactService.js";
import { invalidateRouteRuntimeExecutionIdentityCache } from "./routeRuntimeExecutionIdentityService.js";
import { clearModelsMarketplaceCache } from "./modelsMarketplaceCacheService.js";
import { validateRouteGraphDispatchPolicies } from "./dispatchPolicyReferenceValidation.js";

export type ActiveRouteGraphVersion = {
  id: number;
  version: number;
  sourceGraph: RouteGraphSource;
  compiledGraph: CompiledRouteGraph;
  status: string;
  createdAt: string | null;
  activatedAt: string | null;
};

export type ActiveRouteGraphSourceVersion = Omit<
  ActiveRouteGraphVersion,
  "compiledGraph"
>;

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
  revision: number;
  status: string;
  workingGraph: RouteGraphSource;
  diagnostics: RouteGraphDiagnostic[];
  updatedAt: string | null;
  stale: boolean;
};

type RouteGraphActiveVersionPointerRow =
  typeof schema.routeGraphActiveVersion.$inferSelect;
type RouteGraphVersionSummaryRow = Pick<
  typeof schema.routeGraphVersions.$inferSelect,
  | "id"
  | "version"
  | "sourceGraphJson"
  | "status"
  | "createdBy"
  | "createdAt"
  | "activatedAt"
>;

export class RouteGraphSyncValidationError extends Error {
  diagnostics: RouteGraphDiagnostic[];

  constructor(diagnostics: RouteGraphDiagnostic[]) {
    super(
      `Cannot reconcile route graph sync: ${diagnostics.map((item) => item.message).join("; ")}`,
    );
    this.name = "RouteGraphSyncValidationError";
    this.diagnostics = diagnostics;
  }
}

export class RouteGraphSourceValidationError extends Error {
  diagnostics: RouteGraphDiagnostic[];

  constructor(diagnostics: RouteGraphDiagnostic[]) {
    super(
      `Route graph source is invalid: ${diagnostics.map((item) => item.message).join("; ")}`,
    );
    this.name = "RouteGraphSourceValidationError";
    this.diagnostics = diagnostics;
  }
}

export class RouteGraphDraftRevisionConflictError extends Error {
  constructor() {
    super(
      "The route graph draft changed before this operation could be saved.",
    );
    this.name = "RouteGraphDraftRevisionConflictError";
  }
}

export class RouteGraphAuthoringIdentityError extends Error {
  constructor(message: string) {
    super(message);
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

function nativeRouteGraphPolicyDiagnostics(
  sourceGraph: unknown,
): RouteGraphDiagnostic[] {
  return validateNativeRouteGraphSourcePolicies(sourceGraph).map((message) => ({
    severity: "error" as const,
    code: "route_graph.native_policy",
    message,
  }));
}

function compileRouteGraphWithNativePolicyValidation(
  sourceGraph: unknown,
  options: { compactRuntimeBundle?: boolean } = {},
): RouteGraphCompileResult {
  const nativePolicyDiagnostics =
    nativeRouteGraphPolicyDiagnostics(sourceGraph);
  const policyReferenceDiagnostics = validateRouteGraphDispatchPolicies(
    sourceGraph,
    config.dispatchPolicyRegistry,
  );
  const compiled = compileRouteGraphSource(sourceGraph, {
    includePrimitiveSource: false,
    compactRuntimeBundle: options.compactRuntimeBundle === true,
  });
  if (
    nativePolicyDiagnostics.length === 0 &&
    policyReferenceDiagnostics.length === 0
  )
    return compiled;
  const diagnostics = [
    ...nativePolicyDiagnostics,
    ...policyReferenceDiagnostics,
    ...compiled.diagnostics,
  ];
  return {
    ...compiled,
    diagnostics,
    ok: false,
  };
}

let activeRouteGraphSummaryCache: {
  versionId: number;
  summary: ActiveRouteGraphSummary;
} | null = null;

/**
 * Source Graph publication is a linearizable local write boundary. A facade
 * mutation must observe the graph published by the preceding mutation rather
 * than race to publish a stale replacement.
 */
let routeGraphWriteTail: Promise<void> = Promise.resolve();

function runSerializedRouteGraphWrite<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const scheduled = routeGraphWriteTail.then(operation, operation);
  routeGraphWriteTail = scheduled.then(
    () => undefined,
    () => undefined,
  );
  return scheduled;
}

const ACTIVE_ROUTE_GRAPH_VERSION_ID_CACHE_TTL_MS = 1_000;
let activeRouteGraphVersionIdCache: {
  loadedAt: number;
  versionId: number | null;
} | null = null;
let activeRouteGraphVersionIdLoadPromise: Promise<number | null> | null = null;
let activeRouteGraphVersionIdCacheGeneration = 0;

const EXECUTION_IDENTITY_INVALIDATION_REASONS =
  new Set<RouteRuntimeInvalidationReason>([
    "route-graph-published",
    "route-source-mutated",
    "route-group-mutated",
    "route-group-candidate-mutated",
    "route-supply-endpoint-mutated",
    "account-mutated",
    "account-token-mutated",
    "site-mutated",
    "model-availability-rebuilt",
    "test-reset",
  ]);

export function invalidateRouteGraphReadCaches(
  reason: RouteRuntimeInvalidationReason = "manual",
): void {
  activeRouteGraphVersionIdCacheGeneration += 1;
  activeRouteGraphVersionIdCache = null;
  activeRouteGraphVersionIdLoadPromise = null;
  invalidateRouteRuntimeArtifactPointerCache();
  invalidateRouteRuntimeCaches(reason);
  invalidateRouteRuntimeSelectorState();
  if (EXECUTION_IDENTITY_INVALIDATION_REASONS.has(reason)) {
    invalidateRouteRuntimeExecutionIdentityCache();
  }
  clearModelsMarketplaceCache();
  activeRouteGraphSummaryCache = null;
}

function activeVersionMetadata(
  input: ActiveRouteGraphSourceVersion,
): ActiveRouteGraphSummary["version"] {
  return {
    id: input.id,
    version: input.version,
    status: input.status,
    createdAt: input.createdAt,
    activatedAt: input.activatedAt,
  };
}

export function hashRouteGraphSource(source: RouteGraphSource): string {
  const canonical = stableRoutingIdentityJson(normalizeRouteGraphSource(source));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function summarizeActiveRouteGraphVersion(
  input: ActiveRouteGraphSourceVersion,
  compiledHash: string | null = null,
): ActiveRouteGraphSummary {
  return {
    version: activeVersionMetadata(input),
    sourceSummary: {
      nodes: input.sourceGraph.nodes.length,
      edges: input.sourceGraph.edges.length,
      macros: (input.sourceGraph.macros || []).length,
    },
    hashes: {
      sourceGraph: hashRouteGraphSource(input.sourceGraph),
      compiledGraph: compiledHash,
    },
  };
}

function countPublicModelEntriesInSourceGraph(
  sourceGraph: RouteGraphSource,
): number {
  const names = new Set<string>();
  for (const node of sourceGraph.nodes) {
    if (node.type !== "entry" || node.enabled === false) {
      continue;
    }
    const modelName = getRouteGraphModelPatternFromSpecs(node.match, {
      kind: "supply",
    }).trim();
    if (modelName) names.add(modelName.toLowerCase());
  }
  for (const macro of sourceGraph.macros || []) {
    if (
      macro.kind !== "candidate_selector" ||
      macro.enabled === false ||
      macro.config?.surface?.entry?.kind !== "external"
    ) {
      continue;
    }
    const modelName =
      getRouteGraphModelPatternFromSpecs(macro.config.surface.entry.match, {
        kind: "supply",
      }).trim() || String(macro.name || "").trim();
    if (modelName) names.add(modelName.toLowerCase());
  }
  return names.size;
}

function sourceVersionFromActiveVersion(
  input: ActiveRouteGraphVersion,
): ActiveRouteGraphSourceVersion {
  return {
    id: input.id,
    version: input.version,
    sourceGraph: input.sourceGraph,
    status: input.status,
    createdAt: input.createdAt,
    activatedAt: input.activatedAt,
  };
}

export async function getActiveRouteGraphVersionId(): Promise<number | null> {
  const nowMs = Date.now();
  if (
    activeRouteGraphVersionIdCache &&
    nowMs - activeRouteGraphVersionIdCache.loadedAt <
      ACTIVE_ROUTE_GRAPH_VERSION_ID_CACHE_TTL_MS
  ) {
    return activeRouteGraphVersionIdCache.versionId;
  }
  if (activeRouteGraphVersionIdLoadPromise) {
    return await activeRouteGraphVersionIdLoadPromise;
  }

  const generation = activeRouteGraphVersionIdCacheGeneration;
  const activeVersionTable = schema.routeGraphActiveVersion as
    typeof schema.routeGraphActiveVersion | undefined;
  if (!activeVersionTable?.id) return null;
  const loadTask = db
    .select()
    .from(activeVersionTable)
    .where(eq(activeVersionTable.id, 1))
    .get()
    .then((pointer: RouteGraphActiveVersionPointerRow | undefined) => {
      const versionId = pointer?.versionId ?? null;
      if (generation === activeRouteGraphVersionIdCacheGeneration) {
        activeRouteGraphVersionIdCache = {
          loadedAt: Date.now(),
          versionId,
        };
      }
      return versionId;
    })
    .finally(() => {
      if (activeRouteGraphVersionIdLoadPromise === loadTask) {
        activeRouteGraphVersionIdLoadPromise = null;
      }
    });
  activeRouteGraphVersionIdLoadPromise = loadTask;
  return await loadTask;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function appendOwnershipDiagnostics(input: {
  baseGraph: RouteGraphSource;
  candidateGraph: RouteGraphSource;
  diagnostics: RouteGraphDiagnostic[];
}): void {
  const baseNodesById = new Map(
    input.baseGraph.nodes.map((node) => [node.id, node]),
  );
  const candidateNodesById = new Map(
    input.candidateGraph.nodes.map((node) => [node.id, node]),
  );
  for (const baseNode of input.baseGraph.nodes) {
    if (baseNode.ownership === "manual") continue;
    const candidate = candidateNodesById.get(baseNode.id);
    if (!candidate) {
      input.diagnostics.push({
        severity: "error",
        code: "ownership.non_manual_delete",
        message: `Non-manual node ${baseNode.id} cannot be deleted from a draft.`,
        nodeId: baseNode.id,
      });
      continue;
    }
    if (
      candidate.ownership !== baseNode.ownership ||
      stableStringify(candidate) !== stableStringify(baseNode)
    ) {
      input.diagnostics.push({
        severity: "error",
        code: "ownership.non_manual_mutation",
        message: `Non-manual node ${baseNode.id} cannot be edited directly; clone it as manual first.`,
        nodeId: baseNode.id,
      });
    }
  }
  for (const candidateNode of input.candidateGraph.nodes) {
    if (
      candidateNode.ownership === "manual" ||
      baseNodesById.has(candidateNode.id)
    )
      continue;
    input.diagnostics.push({
      severity: "error",
      code: "ownership.non_manual_create",
      message: `Non-manual node ${candidateNode.id} cannot be created in a draft; create a manual source node or edit the owning macro/source instead.`,
      nodeId: candidateNode.id,
    });
  }

  const baseEdgesById = new Map(
    input.baseGraph.edges.map((edge) => [edge.id, edge]),
  );
  const candidateEdgesById = new Map(
    input.candidateGraph.edges.map((edge) => [edge.id, edge]),
  );
  for (const baseEdge of input.baseGraph.edges) {
    if (baseEdge.ownership === "manual") continue;
    const candidate = candidateEdgesById.get(baseEdge.id);
    if (!candidate) {
      input.diagnostics.push({
        severity: "error",
        code: "ownership.non_manual_edge_delete",
        message: `Non-manual edge ${baseEdge.id} cannot be deleted from a draft.`,
        edgeId: baseEdge.id,
      });
      continue;
    }
    if (
      candidate.ownership !== baseEdge.ownership ||
      stableStringify(candidate) !== stableStringify(baseEdge)
    ) {
      input.diagnostics.push({
        severity: "error",
        code: "ownership.non_manual_edge_mutation",
        message: `Non-manual edge ${baseEdge.id} cannot be edited directly; clone the affected path as manual first.`,
        edgeId: baseEdge.id,
      });
    }
  }
  for (const candidateEdge of input.candidateGraph.edges) {
    if (
      candidateEdge.ownership === "manual" ||
      baseEdgesById.has(candidateEdge.id)
    )
      continue;
    input.diagnostics.push({
      severity: "error",
      code: "ownership.non_manual_edge_create",
      message: `Non-manual edge ${candidateEdge.id} cannot be created in a draft; create a manual edge or edit the owning macro/source instead.`,
      edgeId: candidateEdge.id,
    });
  }

  const baseMacrosById = new Map(
    (input.baseGraph.macros || []).map((macro) => [macro.id, macro]),
  );
  const candidateMacrosById = new Map(
    (input.candidateGraph.macros || []).map((macro) => [macro.id, macro]),
  );
  for (const baseMacro of input.baseGraph.macros || []) {
    if (baseMacro.ownership === "manual") continue;
    const candidate = candidateMacrosById.get(baseMacro.id);
    if (!candidate) {
      input.diagnostics.push({
        severity: "error",
        code: "ownership.non_manual_macro_delete",
        message: `Non-manual macro ${baseMacro.id} cannot be deleted from a draft.`,
      });
      continue;
    }
    if (
      candidate.ownership !== baseMacro.ownership ||
      stableStringify(candidate) !== stableStringify(baseMacro)
    ) {
      input.diagnostics.push({
        severity: "error",
        code: "ownership.non_manual_macro_mutation",
        message: `Non-manual macro ${baseMacro.id} cannot be edited directly; clone it as manual first.`,
      });
    }
  }
  for (const candidateMacro of input.candidateGraph.macros || []) {
    if (
      candidateMacro.ownership === "manual" ||
      baseMacrosById.has(candidateMacro.id)
    )
      continue;
    input.diagnostics.push({
      severity: "error",
      code: "ownership.non_manual_macro_create",
      message: `Non-manual macro ${candidateMacro.id} cannot be created in a draft; create a manual macro or let the route graph generator create it.`,
    });
  }
}

async function getNextGraphVersionNumber(database: any = db): Promise<number> {
  const latest = await database
    .select({ version: schema.routeGraphVersions.version })
    .from(schema.routeGraphVersions)
    .orderBy(desc(schema.routeGraphVersions.version))
    .limit(1)
    .get();
  return Number(latest?.version || 0) + 1;
}

function affectedRowCount(result: any): number {
  return Number(result?.changes ?? result?.rowsAffected ?? result?.affectedRows ?? 0);
}

export class RouteGraphPublicationConflictError extends Error {
  constructor() {
    super('The active Source Graph changed while this publication was being committed.');
    this.name = 'RouteGraphPublicationConflictError';
  }
}

async function loadActiveSourceVersionFromDatabase(database: any): Promise<ActiveRouteGraphSourceVersion | null> {
  const pointer = await database.select()
    .from(schema.routeGraphActiveVersion)
    .where(eq(schema.routeGraphActiveVersion.id, 1))
    .get();
  if (!pointer) return null;
  const row = await database.select({
    id: schema.routeGraphVersions.id,
    version: schema.routeGraphVersions.version,
    sourceGraphJson: schema.routeGraphVersions.sourceGraphJson,
    status: schema.routeGraphVersions.status,
    createdAt: schema.routeGraphVersions.createdAt,
    activatedAt: schema.routeGraphVersions.activatedAt,
  }).from(schema.routeGraphVersions)
    .where(eq(schema.routeGraphVersions.id, pointer.versionId))
    .get();
  return row ? {
    id: row.id,
    version: row.version,
    sourceGraph: parseRouteGraphSource(row.sourceGraphJson),
    status: row.status,
    createdAt: row.createdAt,
    activatedAt: row.activatedAt,
  } : null;
}

async function markDraftsStaleExceptBase(
  activeVersionId: number,
  database: any = db,
  excludedDraftId?: number | null,
): Promise<void> {
  const activeDrafts = await database
    .select()
    .from(schema.routeGraphDrafts)
    .where(eq(schema.routeGraphDrafts.status, "active"))
    .all();
  for (const draft of activeDrafts) {
    if (excludedDraftId != null && draft.id === excludedDraftId) continue;
    if (draft.baseVersion === activeVersionId) continue;
    await database
      .update(schema.routeGraphDrafts)
      .set({
        status: "stale",
        updatedAt: nowIso(),
        revision: sql`${schema.routeGraphDrafts.revision} + 1`,
      })
      .where(eq(schema.routeGraphDrafts.id, draft.id))
      .run();
  }
}

async function publishRouteGraphSourceInWriteBoundary(input: {
  sourceGraph: unknown;
  createdBy?: string;
  allowDiagnostics?: boolean;
  publishingDraftId?: number | null;
}, options: { database?: any; applyRuntimeSideEffects?: boolean } = {}): Promise<
  | {
      ok: true;
      version: ActiveRouteGraphVersion;
      diagnostics: RouteGraphDiagnostic[];
    }
  | { ok: false; diagnostics: RouteGraphDiagnostic[] }
> {
  const database = options.database || db;
  const currentPointer = await database.select()
    .from(schema.routeGraphActiveVersion)
    .where(eq(schema.routeGraphActiveVersion.id, 1))
    .get();
  const compiled = compileRouteGraphWithNativePolicyValidation(
    input.sourceGraph,
    {
      compactRuntimeBundle: true,
    },
  );
  const hasNativePolicyErrors = compiled.diagnostics.some(
    (diagnostic) => diagnostic.code === "route_graph.native_policy",
  );
  if ((!compiled.ok && !input.allowDiagnostics) || hasNativePolicyErrors) {
    return { ok: false, diagnostics: compiled.diagnostics };
  }

  const timestamp = nowIso();
  const versionNumber = await getNextGraphVersionNumber(database);
  await assertRouteRuntimeArtifactTransportBindings({ database, compiledGraph: compiled.compiled });
  await database
    .update(schema.routeGraphVersions)
    .set({ status: "archived" })
    .where(eq(schema.routeGraphVersions.status, "active"))
    .run();
  const inserted = await database.insert(schema.routeGraphVersions).values({
    version: versionNumber,
    sourceGraphJson: JSON.stringify(compiled.source),
    status: "active",
    createdBy: input.createdBy || "system",
    createdAt: timestamp,
    activatedAt: timestamp,
  }).run();
  const versionId = requireInsertedRowId(
    inserted,
    "Failed to create route graph version",
  );
  const runtimeArtifact = await persistAndActivateRouteRuntimeArtifact({
    database,
    compiledGraph: compiled.compiled,
    sourceGraphVersionId: versionId,
    sourceGraphHash: hashRouteGraphSource(compiled.source),
    timestamp,
  });

  await database
    .update(schema.routeGraphVersions)
    .set({ status: "active", activatedAt: timestamp })
    .where(eq(schema.routeGraphVersions.id, versionId))
    .run();
  if (currentPointer) {
    const pointerUpdate = await database.update(schema.routeGraphActiveVersion)
      .set({ versionId, updatedAt: timestamp })
      .where(and(
        eq(schema.routeGraphActiveVersion.id, 1),
        eq(schema.routeGraphActiveVersion.versionId, currentPointer.versionId),
      ))
      .run();
    if (affectedRowCount(pointerUpdate) !== 1) throw new RouteGraphPublicationConflictError();
  } else {
    await database.insert(schema.routeGraphActiveVersion).values({
      id: 1,
      versionId,
      updatedAt: timestamp,
    }).run();
  }
  await markDraftsStaleExceptBase(versionId, database, input.publishingDraftId);
  const version: ActiveRouteGraphVersion = {
    id: versionId,
    version: versionNumber,
    sourceGraph: compiled.source,
    compiledGraph: compiled.compiled,
    status: "active",
    createdAt: timestamp,
    activatedAt: timestamp,
  };
  if (options.applyRuntimeSideEffects !== false) {
    await applyPublishedRouteGraphRuntimeSideEffects(version, runtimeArtifact);
  }
  return { ok: true, version, diagnostics: compiled.diagnostics };
}

async function applyPublishedRouteGraphRuntimeSideEffects(
  version: ActiveRouteGraphVersion,
  suppliedRuntimeArtifact?: ActiveRouteRuntimeArtifact,
): Promise<void> {
  const runtimeArtifact = suppliedRuntimeArtifact
    ?? await loadRouteRuntimeArtifactForSourceGraphVersion(version.id);
  if (!runtimeArtifact) throw new Error(`Compiled runtime artifact is missing for Source Graph version ${version.id}`);
  invalidateRouteGraphReadCaches("route-graph-published");
  cacheActiveRouteRuntimeArtifact(runtimeArtifact);
  await primeRouteRuntimeArtifactExecutionIdentities(
    runtimeArtifact.artifactId,
    runtimeArtifact.compiledGraph,
  );
  activeRouteGraphSummaryCache = {
    versionId: version.id,
    summary: summarizeActiveRouteGraphVersion(
      sourceVersionFromActiveVersion(version),
      version.compiledGraph.hash || null,
    ),
  };
}

/** Publishes a complete Source Graph through the single Graph write boundary. */
export async function publishRouteGraphSource(input: {
  sourceGraph: unknown;
  createdBy?: string;
  allowDiagnostics?: boolean;
}): Promise<
  | {
      ok: true;
      version: ActiveRouteGraphVersion;
      diagnostics: RouteGraphDiagnostic[];
    }
  | { ok: false; diagnostics: RouteGraphDiagnostic[] }
> {
  return await runSerializedRouteGraphWrite(async () => {
    const committed = await db.transaction(async (transaction: any) => (
      await publishRouteGraphSourceInWriteBoundary(input, {
        database: transaction,
        applyRuntimeSideEffects: false,
      })
    ));
    if (committed.ok) await applyPublishedRouteGraphRuntimeSideEffects(committed.version);
    return committed;
  });
}

/**
 * Mutates the currently active Source Graph and publishes the result as one
 * ordered operation. This is the Graph-native boundary for all operations
 * whose input depends on the active Graph.
 */
export async function mutateActiveRouteGraphSource<T>(input: {
  createdBy: string;
  mutate: (source: RouteGraphSource) => {
    source: RouteGraphSource;
    result: T;
    publish?: boolean;
  };
}): Promise<{ source: RouteGraphSource; result: T }> {
  return await runSerializedRouteGraphWrite(async () => {
    const committed = await db.transaction(async (transaction: any) => {
      const active = await loadActiveSourceVersionFromDatabase(transaction);
      const current = active?.sourceGraph || { nodes: [], edges: [], macros: [] };
      const changed = input.mutate(current);
      if (changed.publish === false) return { version: null, source: current, result: changed.result };
      const published = await publishRouteGraphSourceInWriteBoundary({
        sourceGraph: changed.source,
        createdBy: input.createdBy,
      }, { database: transaction, applyRuntimeSideEffects: false });
      if (!published.ok) throw new RouteGraphSyncValidationError(published.diagnostics);
      return { version: published.version, source: published.version.sourceGraph, result: changed.result };
    });
    if (committed.version) await applyPublishedRouteGraphRuntimeSideEffects(committed.version);
    return { source: committed.source, result: committed.result };
  });
}

/** Commits related relational facts and one compiled Graph publication together. */
export async function mutateActiveRouteGraphSourceTransaction<T>(input: {
  createdBy: string;
  mutate: (transaction: any, source: RouteGraphSource) => Promise<{
    source: RouteGraphSource;
    result: T;
  }>;
}): Promise<{ source: RouteGraphSource; result: T }> {
  return await runSerializedRouteGraphWrite(async () => {
    const committed = await db.transaction(async (transaction: any) => {
      const active = await loadActiveSourceVersionFromDatabase(transaction);
      const current = active?.sourceGraph || { nodes: [], edges: [], macros: [] };
      const changed = await input.mutate(transaction, current);
      const published = await publishRouteGraphSourceInWriteBoundary({
        sourceGraph: changed.source,
        createdBy: input.createdBy,
      }, {
        database: transaction,
        applyRuntimeSideEffects: false,
      });
      if (!published.ok) throw new RouteGraphSyncValidationError(published.diagnostics);
      return { version: published.version, result: changed.result };
    });
    await applyPublishedRouteGraphRuntimeSideEffects(committed.version);
    return { source: committed.version.sourceGraph, result: committed.result };
  });
}

export async function ensureActiveRouteGraphVersion(): Promise<ActiveRouteGraphVersion> {
  const active = await getActiveRouteGraphVersion();
  if (active) {
    return active;
  }

  const published = await publishRouteGraphSource({
    sourceGraph: { nodes: [], edges: [], macros: [] },
    createdBy: "graph-bootstrap",
    allowDiagnostics: true,
  });
  if (!published.ok) {
    throw new Error(
      `Cannot bootstrap route graph: ${published.diagnostics.map((item) => item.message).join("; ")}`,
    );
  }
  return published.version;
}

export async function getActiveRouteGraphVersion(): Promise<ActiveRouteGraphVersion | null> {
  const pointer = await db
    .select()
    .from(schema.routeGraphActiveVersion)
    .where(eq(schema.routeGraphActiveVersion.id, 1))
    .get();
  if (!pointer) return null;
  const row = await db
    .select({
      id: schema.routeGraphVersions.id,
      version: schema.routeGraphVersions.version,
      sourceGraphJson: schema.routeGraphVersions.sourceGraphJson,
      status: schema.routeGraphVersions.status,
      createdAt: schema.routeGraphVersions.createdAt,
      activatedAt: schema.routeGraphVersions.activatedAt,
    })
    .from(schema.routeGraphVersions)
    .where(eq(schema.routeGraphVersions.id, pointer.versionId))
    .get();
  if (!row) return null;
  const sourceGraph = parseRouteGraphSource(row.sourceGraphJson);
  const runtimeArtifact = await loadRouteRuntimeArtifactForSourceGraphVersion(row.id);
  if (!runtimeArtifact) throw new Error(`Compiled runtime artifact is missing for Source Graph version ${row.id}`);
  const compiledGraph = compiledRouteGraphFromRuntimeArtifact(runtimeArtifact.compiledGraph);
  const version = {
    id: row.id,
    version: row.version,
    sourceGraph,
    compiledGraph,
    status: row.status,
    createdAt: row.createdAt,
    activatedAt: row.activatedAt,
  };
  cacheActiveRouteRuntimeArtifact(runtimeArtifact);
  await primeRouteRuntimeArtifactExecutionIdentities(
    runtimeArtifact.artifactId,
    runtimeArtifact.compiledGraph,
  );
  activeRouteGraphSummaryCache = {
    versionId: row.id,
    summary: summarizeActiveRouteGraphVersion(
      sourceVersionFromActiveVersion(version),
      compiledGraph.hash || null,
    ),
  };
  return version;
}

export async function getActiveRouteGraphSourceVersion(): Promise<ActiveRouteGraphSourceVersion | null> {
  const versionId = await getActiveRouteGraphVersionId();
  if (!versionId) return null;
  const row = await db
    .select({
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
  activeRouteGraphSummaryCache = {
    versionId: row.id,
    summary: summarizeActiveRouteGraphVersion(sourceVersion),
  };
  return sourceVersion;
}

export async function ensureActiveRouteGraphSourceVersion(): Promise<ActiveRouteGraphSourceVersion> {
  const active = await getActiveRouteGraphSourceVersion();
  if (active) return active;
  const published = await publishRouteGraphSource({
    sourceGraph: { nodes: [], edges: [], macros: [] },
    createdBy: "graph-bootstrap",
    allowDiagnostics: true,
  });
  if (!published.ok) {
    throw new Error(
      `Cannot bootstrap route graph source: ${published.diagnostics.map((item) => item.message).join("; ")}`,
    );
  }
  return sourceVersionFromActiveVersion(published.version);
}

export async function getActiveRouteGraphSummary(): Promise<ActiveRouteGraphSummary | null> {
  const versionId = await getActiveRouteGraphVersionId();
  if (!versionId) return null;
  if (activeRouteGraphSummaryCache?.versionId === versionId) {
    return activeRouteGraphSummaryCache.summary;
  }
  const row = await db
    .select({
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
      sourceGraph: hashRouteGraphSource(sourceGraph),
      compiledGraph: null,
    },
  };
  activeRouteGraphSummaryCache = { versionId: row.id, summary };
  return summary;
}

export async function listRouteGraphVersions(
  limit = 20,
): Promise<RouteGraphVersionSummary[]> {
  const rows = await db
    .select({
      id: schema.routeGraphVersions.id,
      version: schema.routeGraphVersions.version,
      sourceGraphJson: schema.routeGraphVersions.sourceGraphJson,
      status: schema.routeGraphVersions.status,
      createdBy: schema.routeGraphVersions.createdBy,
      createdAt: schema.routeGraphVersions.createdAt,
      activatedAt: schema.routeGraphVersions.activatedAt,
    })
    .from(schema.routeGraphVersions)
    .orderBy(desc(schema.routeGraphVersions.version))
    .limit(Math.max(1, Math.min(100, limit)))
    .all();
  return rows.map((row: RouteGraphVersionSummaryRow) => {
    const sourceGraph = parseRouteGraphSource(row.sourceGraphJson);
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
        publicModels: countPublicModelEntriesInSourceGraph(sourceGraph),
      },
    };
  });
}

async function getLatestRouteGraphDraftRow(database: any = db) {
  return await database
    .select()
    .from(schema.routeGraphDrafts)
    .orderBy(desc(schema.routeGraphDrafts.updatedAt))
    .limit(1)
    .get();
}

export async function getRouteGraphDraft(): Promise<RouteGraphDraftState> {
  const active = await getActiveRouteGraphSourceVersion();
  if (!active) {
    return {
      id: 0,
      baseVersion: null,
      revision: 0,
      status: "unpublished",
      workingGraph: { nodes: [], edges: [], macros: [] },
      diagnostics: [],
      updatedAt: null,
      stale: false,
    };
  }
  const draft = await getLatestRouteGraphDraftRow();
  if (!draft) {
    return {
      id: 0,
      baseVersion: active.id,
      revision: 0,
      status: "active",
      workingGraph: active.sourceGraph,
      diagnostics: [],
      updatedAt: null,
      stale: false,
    };
  }
  return {
    id: draft.id,
    baseVersion: draft.baseVersion,
    revision: Number(draft.revision || 0),
    status: draft.status,
    workingGraph: parseRouteGraphSource(draft.workingGraphJson),
    diagnostics: parseJsonObject<RouteGraphDiagnostic[]>(
      draft.diagnosticsJson,
      [],
    ),
    updatedAt: draft.updatedAt,
    stale: draft.baseVersion !== active.id,
  };
}

/**
 * Converts a complete Graph authoring command into a persisted source Graph.
 * Only this boundary allocates durable identities for full JSON editing.
 */
export async function materializeRouteGraphAuthoringPayload(
  input: RouteGraphAuthoringPayload,
): Promise<RouteGraphSource> {
  const current = await getRouteGraphDraft();
  const knownNodeIds = new Set(
    current.workingGraph.nodes.map((node) => node.id),
  );
  const knownMacroIds = new Set(
    (current.workingGraph.macros || []).map((macro) => macro.id),
  );
  const knownEdgeIds = new Set(
    current.workingGraph.edges.map((edge) => edge.id),
  );
  const nodeRefs = new Map<string, string>();
  const macroRefs = new Map<string, string>();
  const submittedNodeIds = new Set<string>();
  const submittedMacroIds = new Set<string>();

  const resolveElementId = (
    kind: "node" | "macro",
    identity: { id?: string; localRef?: string },
    nodeType?: string,
  ): string => {
    if (identity.id) {
      const known = kind === "node" ? knownNodeIds : knownMacroIds;
      if (!known.has(identity.id)) {
        throw new RouteGraphAuthoringIdentityError(
          `Unknown persisted ${kind} id: ${identity.id}`,
        );
      }
      const submitted = kind === "node" ? submittedNodeIds : submittedMacroIds;
      if (submitted.has(identity.id)) {
        throw new RouteGraphAuthoringIdentityError(
          `Duplicate persisted ${kind} id: ${identity.id}`,
        );
      }
      submitted.add(identity.id);
      return identity.id;
    }
    if (!identity.localRef) {
      throw new RouteGraphAuthoringIdentityError(
        `New ${kind} requires a localRef`,
      );
    }
    const refs = kind === "node" ? nodeRefs : macroRefs;
    if (refs.has(identity.localRef)) {
      throw new RouteGraphAuthoringIdentityError(
        `Duplicate ${kind} localRef: ${identity.localRef}`,
      );
    }
    const id = kind === "node"
      ? createManualRouteGraphNodeId(nodeType || 'node', randomUUID())
      : createManagedRouteGraphElementId('macro', randomUUID());
    refs.set(identity.localRef, id);
    return id;
  };

  const nodes = input.nodes.map((node) => {
    const { localRef: _localRef, ...persisted } = node;
    const id = resolveElementId("node", node, node.type);
    return {
      ...persisted,
      id,
      ...(node.type === 'route_endpoint' && node.localRef
        ? { routeEndpointId: createManagedRouteGraphElementId('endpoint', randomUUID()) }
        : {}),
    } as RouteGraphNode;
  });
  const macros = (input.macros || []).map((macro) => {
    const { localRef: _localRef, ...persisted } = macro;
    return {
      ...persisted,
      id: resolveElementId("macro", macro),
    } as RouteGraphMacro;
  });

  const resolveEdgeEndpoint = (endpoint: {
    kind: "node" | "macro";
    id?: string;
    localRef?: string;
  }): string => {
    const refs = endpoint.kind === "node" ? nodeRefs : macroRefs;
    const id =
      endpoint.id ||
      (endpoint.localRef ? refs.get(endpoint.localRef) : undefined);
    if (!id) {
      throw new RouteGraphAuthoringIdentityError(
        `Unknown ${endpoint.kind} localRef: ${endpoint.localRef || ""}`,
      );
    }
    if (endpoint.id) {
      const submitted = endpoint.kind === "node" ? nodes : macros;
      if (!submitted.some((element) => element.id === id)) {
        throw new RouteGraphAuthoringIdentityError(
          `Edge references a ${endpoint.kind} that is not present in this full graph: ${id}`,
        );
      }
    }
    return endpoint.kind === "macro" ? createRouteMacroSemanticNodeId(id) : id;
  };

  const edgeRefs = new Set<string>();
  const edges = input.edges.map((edge) => {
    if (edge.id && !knownEdgeIds.has(edge.id)) {
      throw new RouteGraphAuthoringIdentityError(
        `Unknown persisted edge id: ${edge.id}`,
      );
    }
    if (
      edge.localRef &&
      (edgeRefs.has(edge.localRef) || !edgeRefs.add(edge.localRef))
    ) {
      throw new RouteGraphAuthoringIdentityError(
        `Duplicate edge localRef: ${edge.localRef}`,
      );
    }
    if (!edge.id && !edge.localRef) {
      throw new RouteGraphAuthoringIdentityError(
        "New edge requires a localRef",
      );
    }
    const { localRef: _localRef, source, target, ...persisted } = edge;
    return {
      ...persisted,
      id: edge.id || createManualRouteGraphEdgeId(randomUUID()),
      sourceNodeId: resolveEdgeEndpoint(source),
      targetNodeId: resolveEdgeEndpoint(target),
    } as RouteGraphEdge;
  });

  return {
    nodes,
    macros,
    edges,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export async function saveRouteGraphAuthoringDraft(
  input: RouteGraphAuthoringPayload,
  options: { expectedRevision?: number } = {},
): Promise<RouteGraphDraftState> {
  return await saveRouteGraphDraft(
    await materializeRouteGraphAuthoringPayload(input),
    options,
  );
}

export async function validateRouteGraphAuthoringPayload(
  input: RouteGraphAuthoringPayload,
): Promise<RouteGraphCompileResult> {
  return await validateRouteGraphDraft(
    await materializeRouteGraphAuthoringPayload(input),
  );
}

export async function saveRouteGraphDraft(
  sourceGraph: unknown,
  options: { expectedRevision?: number } = {},
): Promise<RouteGraphDraftState> {
  return (
    await saveRouteGraphDraftWithTransaction(
      sourceGraph,
      options,
      async () => undefined,
    )
  ).draft;
}

/**
 * Persist a draft and a directly related record in one transaction.  Workspace
 * operation batches use this so their inverse data can never outlive (or miss)
 * the draft revision they describe.
 */
export async function saveRouteGraphDraftWithTransaction<T>(
  sourceGraph: unknown,
  options: { expectedRevision?: number } = {},
  writeRelated: (
    tx: any,
    saved: { id: number; baseVersion: number | null; revision: number },
  ) => Promise<T>,
): Promise<{ draft: RouteGraphDraftState; result: T }> {
  const active = await ensureActiveRouteGraphSourceVersion();
  const validation = compileRouteGraphWithNativePolicyValidation(sourceGraph);
  const nativePolicyDiagnostics = validation.diagnostics.filter(
    (diagnostic) => diagnostic.code === "route_graph.native_policy",
  );
  if (nativePolicyDiagnostics.length > 0)
    throw new RouteGraphSourceValidationError(nativePolicyDiagnostics);
  const normalized = validation.source;
  appendOwnershipDiagnostics({
    baseGraph: active.sourceGraph,
    candidateGraph: normalized,
    diagnostics: validation.diagnostics,
  });
  const timestamp = nowIso();
  const result = await db.transaction(async (tx: any) => {
    const existing = await tx
      .select()
      .from(schema.routeGraphDrafts)
      .where(eq(schema.routeGraphDrafts.status, "active"))
      .limit(1)
      .get();
    let saved: { id: number; baseVersion: number | null; revision: number };
    if (existing) {
      const updateResult = await tx
        .update(schema.routeGraphDrafts)
        .set({
          workingGraphJson: stringifyRouteGraphSource(normalized),
          diagnosticsJson: JSON.stringify(validation.diagnostics),
          updatedAt: timestamp,
          status: existing.baseVersion === active.id ? "active" : "stale",
          revision: sql`${schema.routeGraphDrafts.revision} + 1`,
        })
        .where(
          options.expectedRevision === undefined
            ? eq(schema.routeGraphDrafts.id, existing.id)
            : and(
                eq(schema.routeGraphDrafts.id, existing.id),
                eq(schema.routeGraphDrafts.revision, options.expectedRevision),
              ),
        )
        .run();
      if (
        options.expectedRevision !== undefined &&
        Number(updateResult?.changes ?? updateResult?.rowsAffected ?? 0) !== 1
      ) {
        throw new RouteGraphDraftRevisionConflictError();
      }
      saved = {
        id: existing.id,
        baseVersion: existing.baseVersion,
        revision: Number(existing.revision || 0) + 1,
      };
    } else {
      const inserted = await tx
        .insert(schema.routeGraphDrafts)
        .values({
          baseVersion: active.id,
          workingGraphJson: stringifyRouteGraphSource(normalized),
          status: "active",
          revision: 1,
          diagnosticsJson: JSON.stringify(validation.diagnostics),
          updatedAt: timestamp,
        })
        .run();
      saved = {
        id: requireInsertedRowId(
          inserted,
          "Failed to create route graph draft",
        ),
        baseVersion: active.id,
        revision: 1,
      };
    }
    return await writeRelated(tx, saved);
  });
  return { draft: await getRouteGraphDraft(), result };
}

export async function validateRouteGraphDraft(
  sourceGraph: unknown,
): Promise<RouteGraphCompileResult> {
  return compileRouteGraphWithNativePolicyValidation(sourceGraph);
}

export async function publishRouteGraphDraft(): Promise<
  | {
      ok: true;
      version: ActiveRouteGraphVersion;
      diagnostics: RouteGraphDiagnostic[];
    }
  | { ok: false; stale?: boolean; diagnostics: RouteGraphDiagnostic[] }
> {
  await ensureActiveRouteGraphSourceVersion();
  return await runSerializedRouteGraphWrite(async () => {
    const committed = await db.transaction(async (transaction: any) => {
      const active = await loadActiveSourceVersionFromDatabase(transaction);
      const draft = await getLatestRouteGraphDraftRow(transaction);
      if (!active || !draft || draft.status !== "active" || draft.baseVersion !== active.id) {
        return {
          ok: false as const,
          stale: true,
          diagnostics: [{
            severity: "error" as const,
            code: "draft.stale",
            message: "Draft is based on an older active graph version and must be rebased before publish.",
          }],
        };
      }
      const sourceGraph = parseRouteGraphSource(draft.workingGraphJson);
      const validation = compileRouteGraphWithNativePolicyValidation(sourceGraph);
      appendOwnershipDiagnostics({
        baseGraph: active.sourceGraph,
        candidateGraph: sourceGraph,
        diagnostics: validation.diagnostics,
      });
      if (validation.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        return { ok: false as const, diagnostics: validation.diagnostics };
      }
      const published = await publishRouteGraphSourceInWriteBoundary({
        sourceGraph,
        createdBy: "manual",
        publishingDraftId: draft.id,
      }, {
        database: transaction,
        applyRuntimeSideEffects: false,
      });
      if (!published.ok) return published;
      const draftUpdate = await transaction.update(schema.routeGraphDrafts)
        .set({
          status: "published",
          diagnosticsJson: JSON.stringify(published.diagnostics),
          updatedAt: nowIso(),
          revision: sql`${schema.routeGraphDrafts.revision} + 1`,
        })
        .where(and(
          eq(schema.routeGraphDrafts.id, draft.id),
          eq(schema.routeGraphDrafts.revision, draft.revision),
          eq(schema.routeGraphDrafts.status, "active"),
        ))
        .run();
      if (affectedRowCount(draftUpdate) !== 1) throw new RouteGraphPublicationConflictError();
      return published;
    });
    if (committed.ok) await applyPublishedRouteGraphRuntimeSideEffects(committed.version);
    return committed;
  });
}

export async function discardRouteGraphDraft(): Promise<void> {
  const draft = await getLatestRouteGraphDraftRow();
  if (!draft) return;
  await db
    .update(schema.routeGraphDrafts)
    .set({
      status: "discarded",
      updatedAt: nowIso(),
      revision: sql`${schema.routeGraphDrafts.revision} + 1`,
    })
    .where(eq(schema.routeGraphDrafts.id, draft.id))
    .run();
}

export async function rebaseRouteGraphDraft(): Promise<RouteGraphDraftState> {
  const active = await ensureActiveRouteGraphSourceVersion();
  const draftRow = await getLatestRouteGraphDraftRow();
  if (!draftRow) {
    return await saveRouteGraphDraft({
      nodes: active.sourceGraph.nodes,
      edges: active.sourceGraph.edges,
      macros: active.sourceGraph.macros || [],
      metadata: active.sourceGraph.metadata || {},
    });
  }
  const draft = {
    id: draftRow.id,
    baseVersion: draftRow.baseVersion,
    revision: Number(draftRow.revision || 0),
    status: draftRow.status,
    workingGraph: parseRouteGraphSource(draftRow.workingGraphJson),
    diagnostics: parseJsonObject<RouteGraphDiagnostic[]>(
      draftRow.diagnosticsJson,
      [],
    ),
    updatedAt: draftRow.updatedAt,
    stale: draftRow.baseVersion !== active.id,
  };
  const manualNodes = draft.workingGraph.nodes.filter(
    (node) => node.ownership === "manual",
  );
  const manualEdges = draft.workingGraph.edges.filter(
    (edge) => edge.ownership === "manual",
  );
  const manualMacros = (draft.workingGraph.macros || []).filter(
    (macro) => macro.ownership === "manual",
  );
  const autoNodes = active.sourceGraph.nodes.filter(
    (node) => node.ownership !== "manual",
  );
  const autoEdges = active.sourceGraph.edges.filter(
    (edge) => edge.ownership !== "manual",
  );
  const autoMacros = (active.sourceGraph.macros || []).filter(
    (macro) => macro.ownership !== "manual",
  );
  return await saveRouteGraphDraft({
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
