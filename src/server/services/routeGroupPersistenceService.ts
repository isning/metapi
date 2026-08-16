import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createManagedRouteGraphElementId } from "../../shared/routingIdentity.js";
import type {
  RouteFailureBackoffOverride,
  RouteGraphMacro,
  RouteGraphSource,
} from "../../shared/routeGraph.js";
import { normalizeRouteGraphMacro } from "../../shared/routeGraph.js";
import { db, schema } from "../db/index.js";
import {
  createRouteGroupFacadeMacro,
  mutateRouteGroupFacadeGraph,
} from "./routeGroupGraphFacadeService.js";
import {
  isAutomaticRouteGroupFacadeMacro,
  markRouteGroupFacadeGeneratedPrimaryStage,
  pruneUnreferencedRouteGroupFacadeEndpoints,
  replaceRouteGroupFacadeMacroInSource,
  routeGroupFacadeModelName,
  routeGroupFacadeGeneratedPrimaryStage,
  routeGroupFacadeVisibility,
  synchronizeRouteGroupFacadeStageInput,
} from "./routeGroupGraphFacadeAccessService.js";
import {
  ensureRouteGraphExecutionTargetsEndpoint,
  executionTargetIdsForRouteGraphEndpoint,
} from "./routeGraphExecutionTargetEndpointService.js";
import {
  runtimeExecutionTargetKey,
  upsertRuntimeExecutionTarget,
} from "./runtimeExecutionTargetService.js";
import { assertNoRouteGroupPublicExposureConflicts } from "./routeGroupPublicExposureService.js";
import { advanceRouteGroupManagementCatalogRevision } from "./routeGroupManagementCatalogRevisionService.js";
import {
  AVAILABILITY_ROUTE_GROUP_OWNER,
  isAvailabilityManagedRouteGroup,
} from "./routeGroupAutomaticOwnership.js";

export type AutomaticRouteGroupCandidate = {
  accountId: number;
  tokenId: number | null;
  oauthRouteUnitId: number | null;
  siteId: number;
  modelName: string;
  sharedEndpoint?: {
    key: number;
    targetSelection: { kind: "builtin"; builtin: "round_robin" | "stable_first" };
  } | null;
};

type AutomaticRouteGroupExecutionEndpoint = {
  targets: Array<typeof schema.runtimeExecutionTargets.$inferSelect>;
  targetSelection: { kind: "builtin"; builtin: "round_robin" | "stable_first" };
};

export type AutomaticRouteGroupCandidateMap = Map<
  string,
  Map<string, AutomaticRouteGroupCandidate>
>;

export type AutomaticRouteGroupSynchronizationResult = {
  createdRouteGroups: number;
  updatedRouteGroups: number;
  createdRouteGroupFallbackStages: number;
  createdSupplyEndpoints: number;
  updatedSupplyEndpoints: number;
  createdRouteGroupCandidates: number;
  updatedRouteGroupCandidates: number;
  removedRouteGroupCandidates: number;
  createdSupplyEndpointStates: number;
  removedRoutes: number;
};

function text(value: unknown): string {
  return String(value || "").trim();
}

function modelKey(value: unknown): string {
  return text(value).toLowerCase();
}

function automaticMacrosByModel(
  source: RouteGraphSource,
): Map<string, RouteGraphMacro[]> {
  const result = new Map<string, RouteGraphMacro[]>();
  for (const macro of source.macros || []) {
    if (
      macro.kind !== "candidate_selector" ||
      !isAutomaticRouteGroupFacadeMacro(macro) ||
      !isAvailabilityManagedRouteGroup(macro)
    )
      continue;
    const key = modelKey(
      macro.metadata?.canonicalModel || routeGroupFacadeModelName(macro),
    );
    if (!key) continue;
    const macros = result.get(key) || [];
    macros.push(macro);
    result.set(key, macros);
  }
  return result;
}

function publicExposureRows(source: RouteGraphSource) {
  return (source.macros || [])
    .filter((macro) => macro.kind === "candidate_selector")
    .map((macro) => ({
      groupKey: macro.id,
      kind: isAutomaticRouteGroupFacadeMacro(macro) ? "automatic" : "manual",
      publicModelName: routeGroupFacadeModelName(macro),
      normalizedModelName: modelKey(routeGroupFacadeModelName(macro)),
      displayName: macro.name || null,
      visibility: routeGroupFacadeVisibility(macro),
      enabled: macro.enabled !== false,
      syncStatus: "active",
    }));
}

function automaticVisibility(
  source: RouteGraphSource,
  macro: RouteGraphMacro | null,
  canonicalModel: string,
): "public" | "internal" {
  const collidesWithManualPublicMacro = (source.macros || []).some(
    (current) =>
      current.kind === "candidate_selector" &&
      !isAutomaticRouteGroupFacadeMacro(current) &&
      current.enabled !== false &&
      routeGroupFacadeVisibility(current) === "public" &&
      modelKey(routeGroupFacadeModelName(current)) === canonicalModel,
  );
  if (collidesWithManualPublicMacro) return "internal";
  return macro ? routeGroupFacadeVisibility(macro) : "public";
}

type ExistingAutomaticMember = {
  stageId: string;
  memberIndex: number;
  member: NonNullable<
    RouteGraphMacro["config"]["groups"][number]["members"]
  >[number];
};

/**
 * Automatic rebuilds own the discovered endpoint set, but not the operator's
 * fallback flow. Keep stage placement, member order and stage-local settings
 * keyed by the stable runtime execution-target identity.
 */
function existingAutomaticMemberByExecutionTarget(
  source: RouteGraphSource,
  macro: RouteGraphMacro | null,
): Map<number, ExistingAutomaticMember> {
  const result = new Map<number, ExistingAutomaticMember>();
  if (!macro) return result;
  const nodesByEndpointId = new Map(
    source.nodes.map((node) => [
      node.type === "route_endpoint" ? node.routeEndpointId : node.id,
      node,
    ]),
  );
  for (const stage of macro.config.groups) {
    for (const [memberIndex, member] of (stage.members || []).entries()) {
      const targetIds = executionTargetIdsForRouteGraphEndpoint(
        nodesByEndpointId.get(text(member.endpointId)),
      );
      for (const targetId of targetIds) {
        if (member.memberId && !result.has(targetId))
          result.set(targetId, { stageId: stage.id, memberIndex, member });
      }
    }
  }
  return result;
}

async function upsertAutomaticExecutionTargets(
  modelCandidates: AutomaticRouteGroupCandidateMap,
) {
  const targetsByModel = new Map<
    string,
    AutomaticRouteGroupExecutionEndpoint[]
  >();
  let createdSupplyEndpoints = 0;
  let updatedSupplyEndpoints = 0;
  let createdSupplyEndpointStates = 0;
  for (const [canonicalModel, candidates] of modelCandidates) {
    const independentTargets: Array<typeof schema.runtimeExecutionTargets.$inferSelect> = [];
    const sharedTargets = new Map<number, AutomaticRouteGroupExecutionEndpoint>();
    for (const candidate of candidates.values()) {
      const executionKey = runtimeExecutionTargetKey({
        accountId: candidate.accountId,
        tokenId: candidate.tokenId,
        oauthRouteUnitId: candidate.oauthRouteUnitId,
        sourceModel: candidate.modelName,
      });
      const before = await db
        .select({ id: schema.runtimeExecutionTargets.id })
        .from(schema.runtimeExecutionTargets)
        .where(eq(schema.runtimeExecutionTargets.executionKey, executionKey))
        .get();
      const stateBefore = before
        ? await db
            .select({ id: schema.runtimeExecutionTargetState.id })
            .from(schema.runtimeExecutionTargetState)
            .where(
              eq(
                schema.runtimeExecutionTargetState.executionTargetId,
                before.id,
              ),
            )
            .get()
        : null;
      const target = await upsertRuntimeExecutionTarget({
        accountId: candidate.accountId,
        tokenId: candidate.tokenId,
        oauthRouteUnitId: candidate.oauthRouteUnitId,
        sourceModel: candidate.modelName,
        enabled: true,
        discovered: true,
        source: "availability_rebuild",
        metadata: { source: "availability_rebuild" },
        advanceManagementCatalogRevision: false,
      });
      if (before) updatedSupplyEndpoints += 1;
      else createdSupplyEndpoints += 1;
      if (!stateBefore) createdSupplyEndpointStates += 1;
      if (candidate.sharedEndpoint) {
        const endpoint = sharedTargets.get(candidate.sharedEndpoint.key) || {
          targets: [],
          targetSelection: candidate.sharedEndpoint.targetSelection,
        };
        endpoint.targets.push(target);
        sharedTargets.set(candidate.sharedEndpoint.key, endpoint);
      } else {
        independentTargets.push(target);
      }
    }
    targetsByModel.set(canonicalModel, [
      ...independentTargets.map((target) => ({
        targets: [target],
        targetSelection: { kind: "builtin" as const, builtin: "stable_first" as const },
      })),
      ...Array.from(sharedTargets.values()).map((endpoint) => ({
        ...endpoint,
        targets: [...endpoint.targets].sort((left, right) => left.id - right.id),
      })),
    ]);
  }
  await advanceRouteGroupManagementCatalogRevision();
  return {
    targetsByModel,
    createdSupplyEndpoints,
    updatedSupplyEndpoints,
    createdSupplyEndpointStates,
  };
}

function automaticMacroForModel(input: {
  source: RouteGraphSource;
  existing: RouteGraphMacro | null;
  canonicalModel: string;
  endpoints: AutomaticRouteGroupExecutionEndpoint[];
}): {
  source: RouteGraphSource;
  macro: RouteGraphMacro;
  created: boolean;
  createdMembers: number;
  updatedMembers: number;
} {
  let source = input.source;
  const existingMembers = existingAutomaticMemberByExecutionTarget(
    source,
    input.existing,
  );
  const membersByStageId = new Map<
    string,
    Array<{
      member: {
        memberId: string;
        endpointId: string;
        enabled: boolean;
        weight: number;
        metadata: Record<string, unknown>;
        failureBackoff?: RouteFailureBackoffOverride;
      };
      manualIndex: number | null;
    }>
  >();
  const primaryStage = input.existing
    ? routeGroupFacadeGeneratedPrimaryStage(input.existing)
    : null;
  const primaryStageId =
    primaryStage?.id || createManagedRouteGraphElementId("stage", randomUUID());
  for (const executionEndpoint of [...input.endpoints].sort(
    (left, right) => (left.targets[0]?.id || 0) - (right.targets[0]?.id || 0),
  )) {
    const existing = executionEndpoint.targets
      .map((target) => existingMembers.get(target.id))
      .find(Boolean);
    const ensured = ensureRouteGraphExecutionTargetsEndpoint(
      source,
      executionEndpoint.targets.map((target) => ({
        id: target.id,
        upstreamModelName: target.upstreamModelName,
        enabled: target.enabled !== false,
      })),
      {
        ownership: "derived",
        ownerKind: "macro",
        provenance: { source: "generated", generatedBy: "route-group-facade" },
        endpointId: existing?.member.endpointId,
        targetSelection: executionEndpoint.targetSelection,
      },
    );
    source = ensured.source;
    const manuallyAdjusted = !!existing?.member.override || existing?.member.metadata?.manualOverride === true;
    const memberOverride = manuallyAdjusted ? {
      fallbackStageId: existing?.member.override?.fallbackStageId || existing?.stageId || primaryStageId,
      order: existing?.member.override?.order ?? existing?.memberIndex ?? 0,
      weight: existing?.member.override?.weight ?? existing?.member.weight ?? 10,
      enabled: existing?.member.override?.enabled ?? (existing?.member.enabled !== false),
      ...((existing?.member.override?.failureBackoff || existing?.member.failureBackoff)
        ? { failureBackoff: existing?.member.override?.failureBackoff || existing?.member.failureBackoff }
        : {}),
    } : null;
    const { manualOverride: _legacyManualOverride, ...existingMetadata } = existing?.member.metadata || {};
    const stageId = manuallyAdjusted ? existing.stageId : primaryStageId;
    const members = membersByStageId.get(stageId) || [];
    members.push({
      member: {
        memberId:
          existing?.member.memberId ||
          createManagedRouteGraphElementId("member", randomUUID()),
        endpointId: ensured.endpoint.routeEndpointId,
        enabled: executionEndpoint.targets.some((target) => target.enabled !== false),
        weight: 10,
        ...(memberOverride ? { override: memberOverride } : {}),
        metadata: {
          source: "availability_rebuild",
          ...existingMetadata,
        },
      },
      manualIndex: manuallyAdjusted ? existing.memberIndex : null,
    });
    membersByStageId.set(stageId, members);
  }
  const materializedMembers = (stageId: string) => {
    const records = membersByStageId.get(stageId) || [];
    const members = records
      .filter((record) => record.manualIndex === null)
      .map((record) => record.member);
    for (const record of records
      .filter((item) => item.manualIndex !== null)
      .sort((left, right) => left.manualIndex! - right.manualIndex!)) {
      members.splice(
        Math.min(record.manualIndex!, members.length),
        0,
        record.member,
      );
    }
    return members;
  };
  const memberCount = Array.from(membersByStageId.values()).reduce(
    (count, members) => count + members.length,
    0,
  );
  const visibility = automaticVisibility(
    source,
    input.existing,
    input.canonicalModel,
  );
  if (!input.existing) {
    const created = createRouteGroupFacadeMacro(source, {
      kind: "automatic",
      modelName: input.canonicalModel,
      displayName: input.canonicalModel,
      visibility,
      enabled: true,
      stages: [
        markRouteGroupFacadeGeneratedPrimaryStage({
          id: primaryStageId,
          enabled: true,
          members: materializedMembers(primaryStageId).map((member) => ({
            kind: "endpoint" as const,
            ...member,
          })),
        }),
      ],
      metadata: { managementOwner: AVAILABILITY_ROUTE_GROUP_OWNER },
    });
    return {
      source: created.source,
      macro: created.macro,
      created: true,
      createdMembers: memberCount,
      updatedMembers: 0,
    };
  }
  const previousMembers = input.existing.config.groups
    .flatMap((stage) => stage.members || [])
    .filter((member) => !!member.endpointId).length;
  const stages = input.existing.config.groups.map((stage) => {
    const { acceptUnassigned: _acceptUnassigned, ...explicitStage } = stage;
    const nextStage = stage.id === primaryStageId
      ? markRouteGroupFacadeGeneratedPrimaryStage({
          ...explicitStage,
          members: materializedMembers(stage.id),
        })
      : { ...explicitStage, members: materializedMembers(stage.id) };
    return synchronizeRouteGroupFacadeStageInput(nextStage, false);
  });
  if (!stages.some((stage) => stage.id === primaryStageId)) {
    stages.unshift(
      synchronizeRouteGroupFacadeStageInput(
        markRouteGroupFacadeGeneratedPrimaryStage({
          id: primaryStageId,
          enabled: true,
          input: { kind: "synthetic", statusCode: 503, message: "No route is available." },
          members: materializedMembers(primaryStageId),
        }),
        false,
      ),
    );
  }
  const { candidateSource: _candidateSource, ...existingConfig } = input.existing.config;
  const next = normalizeRouteGraphMacro({
    ...input.existing,
    name: input.canonicalModel,
    enabled: input.existing.enabled !== false,
    config: {
      ...existingConfig,
      surface:
        visibility === "public"
          ? {
              entry: {
                kind: "external",
                match: {
                  kind: "model",
                  requestedModelPattern: input.canonicalModel,
                  displayName: input.canonicalModel,
                },
              },
              output: "route",
            }
          : { entry: { kind: "none" }, output: "route" },
      groups: stages,
    },
    metadata: {
      ...input.existing.metadata,
      canonicalModel: input.canonicalModel,
      managementOwner: AVAILABILITY_ROUTE_GROUP_OWNER,
    },
  });
  return {
    source: replaceRouteGroupFacadeMacroInSource(source, next),
    macro: next,
    created: false,
    createdMembers: Math.max(0, memberCount - previousMembers),
    updatedMembers: Math.min(memberCount, previousMembers),
  };
}

/**
 * Rebuilds automatic Route Groups as source-Graph candidate-selector macros.
 * Runtime targets are transport facts; no Route Group rows, stage rows or
 * candidate rows are read or written by this workflow.
 */
export async function synchronizeAutomaticRouteGroups(
  modelCandidates: AutomaticRouteGroupCandidateMap,
): Promise<AutomaticRouteGroupSynchronizationResult> {
  const targetSync = await upsertAutomaticExecutionTargets(modelCandidates);
  const desiredModels = new Set(
    Array.from(modelCandidates.keys()).map(modelKey),
  );
  const result = await mutateRouteGroupFacadeGraph({
    createdBy: "availability-rebuild",
    mutate: (initialSource) => {
      let source = initialSource;
      const automatic = automaticMacrosByModel(source);
      let createdRouteGroups = 0;
      let updatedRouteGroups = 0;
      let createdRouteGroupFallbackStages = 0;
      let createdRouteGroupCandidates = 0;
      let updatedRouteGroupCandidates = 0;
      let removedRouteGroupCandidates = 0;
      for (const canonicalModel of desiredModels) {
        const endpoints = targetSync.targetsByModel.get(canonicalModel) || [];
        const existing = automatic.get(canonicalModel)?.[0] || null;
        const existingCount =
          existing?.config.groups.flatMap((stage) => stage.members || [])
            .length || 0;
        const synced = automaticMacroForModel({
          source,
          existing,
          canonicalModel,
          endpoints,
        });
        source = synced.source;
        if (synced.created) {
          createdRouteGroups += 1;
          createdRouteGroupFallbackStages += 1;
        } else {
          updatedRouteGroups += 1;
        }
        createdRouteGroupCandidates += synced.createdMembers;
        updatedRouteGroupCandidates += synced.updatedMembers;
        removedRouteGroupCandidates += Math.max(
          0,
          existingCount - endpoints.length,
        );
      }
      const staleMacroIds = new Set<string>();
      for (const [canonicalModel, macros] of automatic) {
        const [primary, ...duplicates] = macros;
        for (const duplicate of duplicates) staleMacroIds.add(duplicate.id);
        if (!desiredModels.has(canonicalModel) && primary)
          staleMacroIds.add(primary.id);
      }
      const staleMacros = (source.macros || []).filter((macro) =>
        staleMacroIds.has(macro.id),
      );
      removedRouteGroupCandidates += staleMacros.reduce(
        (count, macro) =>
          count +
          macro.config.groups.reduce(
            (stageCount, stage) => stageCount + (stage.members || []).length,
            0,
          ),
        0,
      );
      // Removing a managed macro must also remove graph-reference members
      // pointing at it. Otherwise the next publication sees dangling child
      // macro IDs and rejects the entire route graph.
      const next = pruneUnreferencedRouteGroupFacadeEndpoints({
        ...source,
        macros: (source.macros || [])
          .filter((macro) => !staleMacroIds.has(macro.id))
          .map((macro) => ({
            ...macro,
            config: {
              ...macro.config,
              groups: macro.config.groups.map((stage) => {
                const members = (stage.members || []).filter(
                  (member) => !member.macroId || !staleMacroIds.has(member.macroId),
                );
                const input = stage.input.kind === "graph_references"
                  ? {
                      ...stage.input,
                      macroIds: stage.input.macroIds.filter((macroId) => !staleMacroIds.has(macroId)),
                    }
                  : stage.input;
                return synchronizeRouteGroupFacadeStageInput({ ...stage, members, input }, !!macro.config.candidateSource);
              }),
            },
          })),
      });
      assertNoRouteGroupPublicExposureConflicts(publicExposureRows(next));
      return {
        source: next,
        result: {
          createdRouteGroups,
          updatedRouteGroups,
          createdRouteGroupFallbackStages,
          createdRouteGroupCandidates,
          updatedRouteGroupCandidates,
          removedRouteGroupCandidates,
          removedRoutes: staleMacros.length,
        },
      };
    },
  });
  return {
    ...result.result,
    createdSupplyEndpoints: targetSync.createdSupplyEndpoints,
    updatedSupplyEndpoints: targetSync.updatedSupplyEndpoints,
    createdSupplyEndpointStates: targetSync.createdSupplyEndpointStates,
  };
}
