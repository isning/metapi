import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import {
  normalizeRouteGraphMacro,
  requireNativeDispatcherPolicy,
  type DispatcherPolicy,
  type RouteFilter,
  type RouteGraphMacro,
  type RouteGraphSource,
} from "../../shared/routeGraph.js";
import type {
  RouteGroupManagementSummary,
  RouteGroupSourceCatalogItem,
  RouteGroupSourceProjection,
} from "../../shared/routeGroupManagement.js";
import { db, schema } from "../db/index.js";
import type {
  RouteGroupCreatePayload,
  RouteGroupExplicitSourceReference,
  RouteGroupSourceSelection,
  RouteGroupUpdatePayload,
} from "../contracts/routeGroupPayloads.js";
import { parseModelRegexPattern } from "../../shared/modelPatternMatcher.js";
import {
  createRouteGroupFacadeMacro,
  mutateRouteGroupFacadeGraph,
  mutateRouteGroupFacadeGraphTransaction,
} from "./routeGroupGraphFacadeService.js";
import {
  isAutomaticRouteGroupFacadeMacro,
  pruneUnreferencedRouteGroupFacadeEndpoints,
  replaceRouteGroupFacadeMacroInSource,
  routeGroupFacadeMacroOrThrow,
  routeGroupFacadeModelName,
  routeGroupFacadeVisibility,
  synchronizeRouteGroupFacadeStageInput,
} from "./routeGroupGraphFacadeAccessService.js";
import { createManagedRouteGraphElementId } from "../../shared/routingIdentity.js";
import { stableRoutingIdentityHash } from "../../shared/routingIdentity.js";
import {
  assertNoRouteGroupPublicExposureConflicts,
  type RouteGroupPublicExposureRow,
} from "./routeGroupPublicExposureService.js";
import {
  loadRuntimeExecutionTargetCatalogFacts,
  loadRuntimeExecutionTargetCatalogFactPage,
} from "./runtimeExecutionTargetFactsService.js";
import { projectRouteGroupsFromGraph } from "./routeGroupManagementProjectionService.js";
import { loadRouteGroupManagementReadModel } from "./routeGroupManagementReadModelService.js";
import { loadRouteGroupManagementCatalogRevision } from "./routeGroupManagementCatalogRevisionService.js";
import { getActiveRouteGraphSourceVersion } from "./routeGraphService.js";
import { ensureRouteGraphExecutionTargetEndpoint } from "./routeGraphExecutionTargetEndpointService.js";
import { RouteGroupCommandError } from "./routeGroupCommandError.js";

type RouteGroupVisibility = "public" | "internal";

export type RouteGroupFacadeRecord = {
  id: string;
  groupKey: string;
  kind: "automatic" | "manual";
  sourceMode: "auto" | "manual";
  upstreamModelName: string | null;
  normalizedModelName: string | null;
  publicModelName: string | null;
  displayName: string | null;
  displayIcon: string | null;
  visibility: RouteGroupVisibility;
  enabled: boolean;
  macro: RouteGraphMacro;
};

function text(value: unknown): string {
  return String(value || "").trim();
}

function normalizeModelKey(value: unknown): string {
  return text(value).toLowerCase();
}

function normalizeVisibility(value: unknown): RouteGroupVisibility {
  return value === "internal" ? "internal" : "public";
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizeWeight(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function normalizeRouteFilterArray(value: unknown): RouteFilter[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is RouteFilter =>
      !!item && typeof item === "object" && !Array.isArray(item),
  ) as RouteFilter[];
}

function normalizeRouteFilters(
  value: unknown,
): { operations: RouteFilter[] } | null {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const operations = normalizeRouteFilterArray(record.operations);
  return operations.length > 0 ? { operations } : null;
}

function policyOrDefault(value: unknown): DispatcherPolicy {
  return value == null
    ? { kind: "inherit_default" }
    : requireNativeDispatcherPolicy(value);
}

function routeGroupRecord(macro: RouteGraphMacro): RouteGroupFacadeRecord {
  const modelName = routeGroupFacadeModelName(macro);
  return {
    id: macro.id,
    groupKey: macro.id,
    kind: isAutomaticRouteGroupFacadeMacro(macro) ? "automatic" : "manual",
    sourceMode: isAutomaticRouteGroupFacadeMacro(macro) ? "auto" : "manual",
    upstreamModelName: modelName || null,
    normalizedModelName: normalizeModelKey(modelName) || null,
    publicModelName: modelName || null,
    displayName: text(macro.name) || modelName || null,
    displayIcon: text(macro.config.presentation?.displayIcon) || null,
    visibility: routeGroupFacadeVisibility(macro),
    enabled: macro.enabled !== false,
    macro,
  };
}

function routeGroupPublicExposureRows(
  source: RouteGraphSource,
): RouteGroupPublicExposureRow[] {
  return (source.macros || [])
    .filter((macro) => macro.kind === "candidate_selector")
    .map((macro) => ({
      groupKey: macro.id,
      kind: isAutomaticRouteGroupFacadeMacro(macro) ? "automatic" : "manual",
      publicModelName: routeGroupFacadeModelName(macro),
      normalizedModelName: normalizeModelKey(routeGroupFacadeModelName(macro)),
      displayName: macro.name || null,
      visibility: routeGroupFacadeVisibility(macro),
      enabled: macro.enabled !== false,
      syncStatus: "active",
    }));
}

function assertPublicExposure(source: RouteGraphSource): void {
  assertNoRouteGroupPublicExposureConflicts(
    routeGroupPublicExposureRows(source),
  );
}

function macroSurface(input: {
  modelName: string;
  visibility: RouteGroupVisibility;
}) {
  if (input.visibility === "internal")
    return { entry: { kind: "none" as const }, output: "route" as const };
  return {
    entry: {
      kind: "external" as const,
      match: {
        kind: "model" as const,
        requestedModelPattern: input.modelName,
        displayName: input.modelName || null,
      },
    },
    output: "route" as const,
  };
}

function sourceSelectionProvided(
  input: RouteGroupCreatePayload | RouteGroupUpdatePayload,
): boolean {
  return Object.prototype.hasOwnProperty.call(input, "sourceSelection");
}

function normalizeExplicitSources(
  value: RouteGroupExplicitSourceReference[] | undefined,
): RouteGroupExplicitSourceReference[] {
  const seen = new Set<string>();
  const result: RouteGroupExplicitSourceReference[] = [];
  for (const source of value || []) {
    const value = source.kind === "execution_target"
      ? text(source.sourceRef)
      : text(source.id);
    if (!value) continue;
    const key = `${source.kind}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(
      source.kind === "execution_target"
        ? { kind: "execution_target", sourceRef: value }
        : { kind: "route_group", id: value },
    );
  }
  return result;
}

function normalizeSourceSelection(
  value: RouteGroupSourceSelection | undefined,
): RouteGroupSourceSelection {
  if (value?.kind === "model_pattern") {
    const pattern = text(value.pattern);
    if (!pattern)
      throw new RouteGroupCommandError("model_source_pattern_required");
    const parsed = parseModelRegexPattern(pattern);
    if (parsed.error) {
      throw new RouteGroupCommandError("model_source_pattern_invalid");
    }
    return { kind: "model_pattern", pattern };
  }
  return {
    kind: "explicit",
    sources: normalizeExplicitSources(value?.sources),
  };
}

async function resolveExecutionTargets(
  sources: RouteGroupExplicitSourceReference[],
  database: any = db,
) {
  const sourceRefs = sources
    .filter(
      (
        source,
      ): source is Extract<
        RouteGroupExplicitSourceReference,
        { kind: "execution_target" }
      > => source.kind === "execution_target",
    )
    .map((source) => source.sourceRef);
  if (sourceRefs.length === 0)
    return new Map<
      string,
      typeof schema.runtimeExecutionTargets.$inferSelect
    >();
  const rows = await database
    .select()
    .from(schema.runtimeExecutionTargets)
    .where(inArray(schema.runtimeExecutionTargets.sourceRef, sourceRefs))
    .all();
  const targets = new Map<
    string,
    typeof schema.runtimeExecutionTargets.$inferSelect
  >(rows.map((target) => [target.sourceRef, target]));
  for (const sourceRef of sourceRefs) {
    if (!targets.has(sourceRef))
      throw new RouteGroupCommandError("source_not_found", { sourceRef });
  }
  return targets;
}

function facadeMembersForSources(
  source: RouteGraphSource,
  sources: RouteGroupExplicitSourceReference[],
  targets: Map<string, typeof schema.runtimeExecutionTargets.$inferSelect>,
  selfMacroId?: string,
): {
  source: RouteGraphSource;
  members: Array<
    | { kind: "endpoint"; endpointId: string; enabled: boolean; weight: number }
    | { kind: "macro"; macroId: string; enabled: boolean; weight: number }
  >;
} {
  let nextSource = source;
  const members: Array<
    | { kind: "endpoint"; endpointId: string; enabled: boolean; weight: number }
    | { kind: "macro"; macroId: string; enabled: boolean; weight: number }
  > = [];
  for (const routeSource of sources) {
    if (routeSource.kind === "route_group") {
      if (routeSource.id === selfMacroId)
        throw new RouteGroupCommandError("route_group_self_reference", {
          routeGroupId: selfMacroId || null,
        });
      if (
        !(nextSource.macros || []).some(
          (macro) =>
            macro.id === routeSource.id && macro.kind === "candidate_selector",
        )
      ) {
        throw new RouteGroupCommandError("route_group_source_not_found", {
          routeGroupId: routeSource.id,
        });
      }
      members.push({
        kind: "macro",
        macroId: routeSource.id,
        enabled: true,
        weight: 10,
      });
      continue;
    }
    const target = targets.get(routeSource.sourceRef);
    if (!target)
      throw new RouteGroupCommandError("source_not_found", {
        sourceRef: routeSource.sourceRef,
      });
    const ensured = ensureRouteGraphExecutionTargetEndpoint(
      nextSource,
      {
        id: target.id,
        upstreamModelName: target.upstreamModelName,
        enabled: target.enabled !== false,
      },
      {
        ownership: "derived",
        ownerKind: "macro",
        provenance: { source: "generated", generatedBy: "route-group-facade" },
      },
    );
    nextSource = ensured.source;
    members.push({
      kind: "endpoint",
      endpointId: ensured.endpoint.routeEndpointId,
      enabled: target.enabled !== false,
      weight: 10,
    });
  }
  return { source: nextSource, members };
}

function replaceMacroPresentation(
  macro: RouteGraphMacro,
  displayIcon: string | null | undefined,
): RouteGraphMacro {
  if (displayIcon === undefined) return macro;
  const presentation = displayIcon ? { displayIcon } : undefined;
  return normalizeRouteGraphMacro({
    ...macro,
    config: {
      ...macro.config,
      ...(presentation ? { presentation } : { presentation: {} }),
    },
  });
}

function replaceMacroConfiguration(input: {
  macro: RouteGraphMacro;
  modelName: string;
  displayName: string | null | undefined;
  displayIcon: string | null | undefined;
  visibility: RouteGroupVisibility;
  enabled: boolean;
  dispatcherPolicy: DispatcherPolicy | undefined;
  filters: { operations: RouteFilter[] } | null | undefined;
}): RouteGraphMacro {
  const current = input.macro;
  const presentation =
    input.displayIcon === undefined
      ? current.config.presentation
      : input.displayIcon
        ? { displayIcon: input.displayIcon }
        : undefined;
  return normalizeRouteGraphMacro({
    ...current,
    enabled: input.enabled,
    name:
      input.displayName === undefined
        ? current.name
        : input.displayName || input.modelName,
    config: {
      ...current.config,
      surface: macroSurface({
        modelName: input.modelName,
        visibility: input.visibility,
      }),
      policy:
        input.dispatcherPolicy === undefined
          ? current.config.policy
          : input.dispatcherPolicy,
      ...(input.filters === undefined
        ? current.config.filters
          ? { filters: current.config.filters }
          : {}
        : input.filters
          ? { filters: input.filters }
          : {}),
      ...(presentation ? { presentation } : {}),
    },
    metadata: {
      ...current.metadata,
      canonicalModel: normalizeModelKey(input.modelName),
    },
  });
}

export async function loadRouteGroupByKey(
  routeGroupKey: string,
): Promise<RouteGroupFacadeRecord | null> {
  const active = await getActiveRouteGraphSourceVersion();
  if (!active) return null;
  const macro = (active.sourceGraph.macros || []).find(
    (current) =>
      current.id === text(routeGroupKey) &&
      current.kind === "candidate_selector",
  );
  return macro ? routeGroupRecord(macro) : null;
}

async function loadRouteGroupManagementSummary(
  groupKey: string,
): Promise<RouteGroupManagementSummary> {
  const summary = (await loadRouteGroupManagementSummaries()).find(
    (item) => item.id === groupKey,
  );
  if (!summary)
    throw new RouteGroupCommandError("source_graph_invalid", {
      reason: "route_group_projection_missing",
    });
  return summary;
}

/** Source Graph plus runtime facts is the only Route Group read model. */
export async function loadRouteGroupManagementSummaries(): Promise<
  RouteGroupManagementSummary[]
> {
  return await loadRouteGroupManagementReadModel();
}

export async function createRouteGroupFromPayload(
  input: RouteGroupCreatePayload,
) {
  const modelName = text(input.model?.publicName);
  if (!modelName)
    throw new RouteGroupCommandError("invalid_route_group_payload", {
      field: "model.publicName",
    });
  const sourceSelection = normalizeSourceSelection(input.sourceSelection);
  const explicitSources =
    sourceSelection.kind === "explicit" ? sourceSelection.sources : [];
  const displayName = text(input.presentation?.displayName) || modelName;
  const displayIcon = text(input.presentation?.displayIcon) || null;
  const visibility = normalizeVisibility(input.visibility);
  const filters =
    input.filters === undefined ? null : normalizeRouteFilters(input.filters);
  const policy = policyOrDefault(input.dispatcherPolicy);
  const result = await mutateRouteGroupFacadeGraphTransaction({
    createdBy: "route-group-management",
    mutate: async (transaction, source) => {
      const targets = await resolveExecutionTargets(explicitSources, transaction);
      const resolved = facadeMembersForSources(
        source,
        explicitSources,
        targets,
      );
      const created = createRouteGroupFacadeMacro(resolved.source, {
        kind: "manual",
        modelName,
        displayName,
        displayIcon,
        visibility,
        enabled: input.enabled !== false,
        policy,
        filters: filters ? { operations: filters.operations } : null,
        ...(sourceSelection.kind === "model_pattern"
          ? { candidateSource: sourceSelection }
          : {}),
        stages: [{
          ...(sourceSelection.kind === "model_pattern" ? { acceptUnassigned: true } : {}),
          members: resolved.members,
        }],
      });
      assertPublicExposure(created.source);
      return { source: created.source, result: created.macro.id };
    },
  });
  return await loadRouteGroupManagementSummary(result.result);
}

export async function updateRouteGroupFromPayload(
  groupKey: string,
  input: RouteGroupUpdatePayload,
) {
  const existing = await loadRouteGroupByKey(groupKey);
  if (!existing) return null;
  const sourceSelection = sourceSelectionProvided(input)
    ? normalizeSourceSelection(input.sourceSelection)
    : null;
  const explicitSources =
    sourceSelection?.kind === "explicit" ? sourceSelection.sources : [];
  const body = input as Record<string, unknown>;
  await mutateRouteGroupFacadeGraphTransaction({
    createdBy: "route-group-management",
    mutate: async (transaction, source) => {
      const macro = routeGroupFacadeMacroOrThrow(source, groupKey);
      if (isAutomaticRouteGroupFacadeMacro(macro) && sourceSelection) {
        throw new RouteGroupCommandError(
          "automatic_source_selection_unsupported",
        );
      }
      const targets = sourceSelection
        ? await resolveExecutionTargets(explicitSources, transaction)
        : new Map<string, typeof schema.runtimeExecutionTargets.$inferSelect>();
      const currentModel = routeGroupFacadeModelName(macro);
      const modelName =
        !isAutomaticRouteGroupFacadeMacro(macro) && input.model
          ? text(input.model.publicName) || currentModel
          : currentModel;
      const visibility = hasOwn(body, "visibility")
        ? normalizeVisibility(body.visibility)
        : routeGroupFacadeVisibility(macro);
      const enabled =
        typeof body.enabled === "boolean"
          ? body.enabled
          : macro.enabled !== false;
      const displayName =
        !isAutomaticRouteGroupFacadeMacro(macro) &&
        input.presentation &&
        hasOwn(input.presentation, "displayName")
          ? text(input.presentation.displayName) || null
          : undefined;
      const displayIcon =
        input.presentation && hasOwn(input.presentation, "displayIcon")
          ? text(input.presentation.displayIcon) || null
          : undefined;
      const dispatcherPolicy = hasOwn(body, "dispatcherPolicy")
        ? policyOrDefault(body.dispatcherPolicy)
        : undefined;
      const filters = hasOwn(body, "filters")
        ? normalizeRouteFilters(body.filters)
        : undefined;
      let nextMacro = replaceMacroConfiguration({
        macro,
        modelName,
        displayName,
        displayIcon,
        visibility,
        enabled,
        dispatcherPolicy,
        filters,
      });
      if (sourceSelection) {
        const resolved = facadeMembersForSources(
          source,
          explicitSources,
          targets,
          macro.id,
        );
        const firstStage = nextMacro.config.groups[0];
        if (!firstStage)
          throw new RouteGroupCommandError("source_graph_invalid", {
            reason: "route_group_fallback_stage_missing",
          });
        nextMacro = normalizeRouteGraphMacro({
          ...nextMacro,
          config: {
            ...nextMacro.config,
            ...(sourceSelection.kind === "model_pattern"
              ? { candidateSource: sourceSelection }
              : { candidateSource: undefined }),
            groups: nextMacro.config.groups.map((stage, index) => {
              if (sourceSelection.kind === "model_pattern") {
                return {
                  ...stage,
                  acceptUnassigned: index === 0,
                  input: {
                    kind: "synthetic",
                    statusCode: 503,
                    message: "No route is available.",
                  },
                  members: [],
                };
              }
              if (index !== 0) return stage;
              return synchronizeRouteGroupFacadeStageInput({
                ...stage,
                acceptUnassigned: undefined,
                input: { kind: "route_endpoints", endpointIds: [] },
                members: resolved.members.map((member) => ({
                  memberId: createManagedRouteGraphElementId(
                    "member",
                    randomUUID(),
                  ),
                  ...(member.kind === "endpoint"
                    ? { endpointId: member.endpointId }
                    : { macroId: member.macroId }),
                  enabled: member.enabled,
                  weight: member.weight,
                })),
              });
            }),
          },
        });
        source = resolved.source;
      }
      const nextSource = replaceRouteGroupFacadeMacroInSource(
        source,
        nextMacro,
      );
      assertPublicExposure(nextSource);
      return { source: nextSource, result: macro.id };
    },
  });
  return await loadRouteGroupManagementSummary(existing.id);
}

export async function deleteRouteGroupByKey(
  groupKey: string,
): Promise<boolean> {
  const existing = await loadRouteGroupByKey(groupKey);
  if (!existing || existing.kind !== "manual") return false;
  await mutateRouteGroupFacadeGraph({
    createdBy: "route-group-management",
    mutate: (source) => {
      routeGroupFacadeMacroOrThrow(source, groupKey);
      const next = {
        ...source,
        macros: (source.macros || []).filter((macro) => macro.id !== groupKey),
      };
      return {
        source: pruneUnreferencedRouteGroupFacadeEndpoints(next),
        result: undefined,
      };
    },
  });
  return true;
}

export async function batchUpdateRouteGroups(input: {
  ids: string[];
  action: string;
}): Promise<number> {
  const ids = Array.from(
    new Set((input.ids || []).map(text).filter(Boolean)),
  ).slice(0, 500);
  if (ids.length === 0) return 0;
  if (
    !["enable", "disable", "set_internal", "set_public"].includes(input.action)
  ) {
    throw new RouteGroupCommandError("invalid_route_group_payload", {
      field: "action",
    });
  }
  const result = await mutateRouteGroupFacadeGraph({
    createdBy: "route-group-management",
    mutate: (source) => {
      let updatedCount = 0;
      const macros = (source.macros || []).map((macro) => {
        if (!ids.includes(macro.id) || macro.kind !== "candidate_selector")
          return macro;
        updatedCount += 1;
        const modelName = routeGroupFacadeModelName(macro);
        const visibility =
          input.action === "set_internal"
            ? "internal"
            : input.action === "set_public"
              ? "public"
              : routeGroupFacadeVisibility(macro);
        const enabled =
          input.action === "enable"
            ? true
            : input.action === "disable"
              ? false
              : macro.enabled !== false;
        return replaceMacroConfiguration({
          macro,
          modelName,
          displayName: undefined,
          displayIcon: undefined,
          visibility,
          enabled,
          dispatcherPolicy: undefined,
          filters: undefined,
        });
      });
      const next = { ...source, macros };
      assertPublicExposure(next);
      return { source: next, result: updatedCount };
    },
  });
  return result.result;
}

export async function listRouteGroupSourceCatalog(
  input: {
    q?: string | null;
    excludeGroupKey?: string | null;
  } = {},
): Promise<RouteGroupSourceCatalogItem[]> {
  const query = text(input.q).toLowerCase();
  const excludedGroupKey = text(input.excludeGroupKey);
  const [active, targetFacts] = await Promise.all([
    getActiveRouteGraphSourceVersion(),
    loadRuntimeExecutionTargetCatalogFacts(),
  ]);
  const macroItems: RouteGroupSourceProjection[] = (
    active?.sourceGraph.macros || []
  )
    .filter(
      (macro) =>
        macro.kind === "candidate_selector" && macro.id !== excludedGroupKey,
    )
    .map((macro) => ({
      source: { kind: "route_group" as const, id: macro.id },
      label: text(macro.name) || routeGroupFacadeModelName(macro) || macro.id,
      modelName: routeGroupFacadeModelName(macro) || null,
      siteName: null,
      enabled: macro.enabled !== false,
    }));
  const targetItems: RouteGroupSourceProjection[] = targetFacts.map(
    (target) => ({
      source: { kind: "execution_target" as const, sourceRef: target.sourceRef },
      label:
        target.site.name && target.modelName
          ? `${target.modelName} @ ${target.site.name}`
          : target.modelName ||
            target.site.name ||
            `Execution target ${target.id}`,
      modelName: target.modelName || null,
      siteName: target.site.name,
      enabled: target.enabled,
    }),
  );
  return [...macroItems, ...targetItems]
    .filter(
      (item) =>
        !query ||
        [item.label, item.modelName, item.siteName].some((value) =>
          text(value).toLowerCase().includes(query),
        ),
    )
    .sort((left, right) => left.label.localeCompare(right.label));
}

type RouteGroupSourceCatalogCursor = {
  revision: string;
  queryHash: string;
  macroOffset: number;
  targetOffset: number;
};

export class RouteGroupSourceCatalogCursorError extends Error {
  constructor(readonly code: 'invalid_source_catalog_cursor' | 'stale_source_catalog_cursor') {
    super(code);
    this.name = 'RouteGroupSourceCatalogCursorError';
  }
}

function decodeSourceCatalogCursor(value: unknown): RouteGroupSourceCatalogCursor | null {
  if (!text(value)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(text(value), 'base64url').toString('utf8')) as Record<string, unknown>;
    if (
      typeof parsed.revision !== 'string'
      || !parsed.revision
      || typeof parsed.queryHash !== 'string'
      || !parsed.queryHash
      || !Number.isSafeInteger(Number(parsed.macroOffset))
      || Number(parsed.macroOffset) < 0
      || !Number.isSafeInteger(Number(parsed.targetOffset))
      || Number(parsed.targetOffset) < 0
    ) throw new RouteGroupSourceCatalogCursorError('invalid_source_catalog_cursor');
    return {
      revision: parsed.revision,
      queryHash: parsed.queryHash,
      macroOffset: Math.trunc(Number(parsed.macroOffset)),
      targetOffset: Math.trunc(Number(parsed.targetOffset)),
    };
  } catch {
    throw new RouteGroupSourceCatalogCursorError('invalid_source_catalog_cursor');
  }
}

export async function listRouteGroupSourceCatalogPage(input: {
  q?: string | null;
  excludeGroupKey?: string | null;
  cursor?: string | null;
  limit?: number;
} = {}): Promise<import('../../shared/routeGroupManagement.js').RouteGroupSourceCatalogPage> {
  const query = text(input.q).toLowerCase();
  const excludedGroupKey = text(input.excludeGroupKey);
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(input.limit) || 50)));
  const [active, targetRevision] = await Promise.all([
    getActiveRouteGraphSourceVersion(),
    loadRouteGroupManagementCatalogRevision(),
  ]);
  const revision = stableRoutingIdentityHash({ graphVersionId: active?.id ?? null, targetRevision });
  const queryHash = stableRoutingIdentityHash({ query, excludedGroupKey });
  const decodedCursor = decodeSourceCatalogCursor(input.cursor);
  if (decodedCursor && (decodedCursor.revision !== revision || decodedCursor.queryHash !== queryHash)) {
    throw new RouteGroupSourceCatalogCursorError('stale_source_catalog_cursor');
  }
  const cursor = decodedCursor || { revision, queryHash, macroOffset: 0, targetOffset: 0 };
  const macros = (active?.sourceGraph.macros || [])
    .filter((macro) => macro.kind === 'candidate_selector' && macro.id !== excludedGroupKey)
    .map((macro) => ({
      source: { kind: 'route_group' as const, id: macro.id },
      label: text(macro.name) || routeGroupFacadeModelName(macro) || macro.id,
      modelName: routeGroupFacadeModelName(macro) || null,
      siteName: null,
      enabled: macro.enabled !== false,
    }))
    .filter((item) => !query || [item.label, item.modelName].some((value) => text(value).toLowerCase().includes(query)))
    .sort((left, right) => left.label.localeCompare(right.label))
    .slice(cursor.macroOffset, cursor.macroOffset + limit + 1);
  const targetPage = await loadRuntimeExecutionTargetCatalogFactPage({
    page: 1,
    pageSize: limit + 1,
    offset: cursor.targetOffset,
    query,
  });
  const targets = targetPage.facts.map((target) => ({
    source: { kind: 'execution_target' as const, sourceRef: target.sourceRef },
    label: target.site.name && target.modelName ? `${target.modelName} @ ${target.site.name}` : target.modelName || target.site.name || `Execution target ${target.id}`,
    modelName: target.modelName || null,
    siteName: target.site.name,
    enabled: target.enabled,
  }));
  const merged = [
    ...macros.map((item) => ({ item, source: 'macro' as const })),
    ...targets.map((item) => ({ item, source: 'target' as const })),
  ].sort((left, right) => left.item.label.localeCompare(right.item.label));
  const selected = merged.slice(0, limit);
  const macroConsumed = selected.filter((item) => item.source === 'macro').length;
  const targetConsumed = selected.length - macroConsumed;
  const hasMore = macros.length > macroConsumed || targets.length > targetConsumed;
  return {
    items: selected.map((item) => item.item),
    nextCursor: hasMore
      ? Buffer.from(JSON.stringify({
          revision,
          queryHash,
          macroOffset: cursor.macroOffset + macroConsumed,
          targetOffset: cursor.targetOffset + targetConsumed,
        }), 'utf8').toString('base64url')
      : null,
  };
}
