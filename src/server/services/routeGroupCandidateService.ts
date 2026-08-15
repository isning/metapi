import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createManagedRouteGraphElementId } from "../../shared/routingIdentity.js";
import type {
  RouteGroupCandidateCatalogItem,
  RouteGroupCandidateCatalogPage,
  RouteGroupManagementCandidate,
  RouteGroupManagementFallbackStage,
} from "../../shared/routeGroupManagement.js";
import { db, schema } from "../db/index.js";
import { mutateRouteGroupFacadeGraph, mutateRouteGroupFacadeGraphTransaction } from "./routeGroupGraphFacadeService.js";
import {
  isAutomaticRouteGroupFacadeMacro,
  findRouteGroupFacadeMember,
  findRouteGroupFacadeStage,
  replaceRouteGroupFacadeMacroInSource,
  replaceRouteGroupFacadeStage,
  routeGroupFacadeGeneratedPrimaryStage,
  type RouteGroupFacadeMember,
  routeGroupFacadeMacroOrThrow,
  routeGroupFacadeModelName,
} from "./routeGroupGraphFacadeAccessService.js";
import { loadRuntimeExecutionTargetFactPage, loadRuntimeExecutionTargetFacts } from "./runtimeExecutionTargetFactsService.js";
import { projectRouteGroupFallbackStagesFromGraph } from "./routeGroupManagementProjectionService.js";
import { getActiveRouteGraphSourceVersion } from "./routeGraphService.js";
import {
  ensureRouteGraphExecutionTargetEndpoint,
  executionTargetIdForRouteGraphEndpoint,
} from "./routeGraphExecutionTargetEndpointService.js";
import { RouteGroupCommandError } from "./routeGroupCommandError.js";
import { AVAILABILITY_ROUTE_GROUP_OWNER } from "./routeGroupAutomaticOwnership.js";
import type { RouteFailureBackoffOverride } from "../../shared/routeGraph.js";

export type RouteGroupCandidateCreateInput = {
  routeGroupKey: string;
  sourceRef: string;
  stageId?: string | null;
  weight?: number | null;
  enabled?: boolean | null;
  manualOverride?: boolean | null;
};

export type RouteGroupCandidateUpdateInput = {
  stageId?: string;
  weight?: number;
  enabled?: boolean;
  failureBackoff?: RouteFailureBackoffOverride | null;
};

function text(value: unknown): string {
  return String(value || "").trim();
}

function normalizeWeight(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 10;
}

function automaticGroupError(): RouteGroupCommandError {
  return new RouteGroupCommandError("candidate_kind_unsupported");
}

async function projectedStages(groupId: string) {
  const [active, facts] = await Promise.all([
    getActiveRouteGraphSourceVersion(),
    loadRuntimeExecutionTargetFacts(),
  ]);
  return active
    ? projectRouteGroupFallbackStagesFromGraph(
        active.sourceGraph,
        groupId,
        facts,
      ) || []
    : [];
}

export async function listRouteGroupCandidatesByGroupKeys(
  groupKeys: string[],
): Promise<Map<string, RouteGroupManagementCandidate[]>> {
  const ids = Array.from(new Set(groupKeys.map(text).filter(Boolean)));
  const [active, facts] = await Promise.all([
    getActiveRouteGraphSourceVersion(),
    loadRuntimeExecutionTargetFacts(),
  ]);
  const result = new Map<string, RouteGroupManagementCandidate[]>();
  for (const id of ids) {
    const stages = active
      ? projectRouteGroupFallbackStagesFromGraph(
          active.sourceGraph,
          id,
          facts,
        ) || []
      : [];
    result.set(
      id,
      stages.flatMap((stage) => stage.candidates),
    );
  }
  return result;
}

export async function loadRouteGroupCandidate(
  groupId: string,
  memberId: string,
): Promise<RouteGroupManagementCandidate | null> {
  const stages = await projectedStages(groupId);
  return (
    stages
      .flatMap((stage) => stage.candidates)
      .find((member) => member.id === text(memberId)) || null
  );
}

/**
 * Lists runtime execution endpoints as native Route Group candidate inputs.
 * The UI receives display facts, but the mutation continues to use the
 * explicit account/token/model command rather than a Graph implementation ID.
 */
export async function listRouteGroupCandidateCatalog(
  groupId: string,
  queryInput?: string | null,
): Promise<RouteGroupCandidateCatalogItem[]> {
  const group = await getActiveRouteGraphSourceVersion();
  const macro = (group?.sourceGraph.macros || []).find(
    (current) =>
      current.id === text(groupId) && current.kind === "candidate_selector",
  );
  if (!macro) throw new RouteGroupCommandError("route_group_not_found");
  const query = text(queryInput).toLowerCase();
  const [facts, current] = await Promise.all([
    loadRuntimeExecutionTargetFacts(),
    projectedStages(macro.id),
  ]);
  const memberKeys = new Set(
    current
      .flatMap((stage) => stage.candidates)
      .filter(
        (
          candidate,
        ): candidate is Extract<
          RouteGroupManagementCandidate,
          { kind: "execution_endpoint" }
        > => candidate.kind === "execution_endpoint",
      )
      .flatMap((candidate) => candidate.targets.map((target) =>
        `${target.accountId}\u0000${target.tokenId ?? ""}\u0000${target.sourceModel || ""}`,
      )),
  );
  return facts
    .filter((fact) => !!text(fact.modelName))
    .map((fact) => {
      const accountLabel =
        text(fact.account.username) || `account-${fact.accountId}`;
      const sourceModel = text(fact.modelName);
      const key = `${fact.accountId}\u0000${fact.tokenId ?? ""}\u0000${sourceModel}`;
      return {
        sourceRef: fact.sourceRef,
        accountId: fact.accountId,
        tokenId: fact.tokenId,
        sourceModel,
        accountLabel,
        siteName: fact.site.name,
        tokenName: fact.token?.name || null,
        enabled: fact.enabled && fact.token?.enabled !== false,
        alreadyMember: memberKeys.has(key),
      } satisfies RouteGroupCandidateCatalogItem;
    })
    .filter(
      (item) =>
        !query ||
        [
          item.accountLabel,
          item.siteName,
          item.tokenName,
          item.sourceModel,
        ].some((value) => text(value).toLowerCase().includes(query)),
    )
    .sort(
      (left, right) =>
        left.accountLabel.localeCompare(right.accountLabel) ||
        left.sourceModel.localeCompare(right.sourceModel) ||
        left.sourceRef.localeCompare(right.sourceRef),
    );
}

export async function listRouteGroupCandidateCatalogPage(input: {
  groupId: string;
  query?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<RouteGroupCandidateCatalogPage> {
  const active = await getActiveRouteGraphSourceVersion();
  const macro = (active?.sourceGraph.macros || []).find((current) => current.id === text(input.groupId) && current.kind === "candidate_selector");
  if (!macro) throw new RouteGroupCommandError("route_group_not_found");
  const page = Math.max(1, Math.trunc(Number(input.page) || 1));
  const pageSize = Math.max(1, Math.min(200, Math.trunc(Number(input.pageSize) || 50)));
  const [factPage, current] = await Promise.all([
    loadRuntimeExecutionTargetFactPage({ page, pageSize, query: input.query }),
    projectedStages(macro.id),
  ]);
  const memberKeys = new Set(current.flatMap((stage) => stage.candidates)
    .filter((candidate): candidate is Extract<RouteGroupManagementCandidate, { kind: "execution_endpoint" }> => candidate.kind === "execution_endpoint")
    .flatMap((candidate) => candidate.targets.map((target) =>
      `${target.accountId}\u0000${target.tokenId ?? ""}\u0000${target.sourceModel || ""}`,
    )));
  const items = factPage.facts.filter((fact) => !!text(fact.modelName)).map((fact) => {
    const accountLabel = text(fact.account.username) || `account-${fact.accountId}`;
    const sourceModel = text(fact.modelName);
    return {
      sourceRef: fact.sourceRef,
      accountId: fact.accountId,
      tokenId: fact.tokenId,
      sourceModel,
      accountLabel,
      siteName: fact.site.name,
      tokenName: fact.token?.name || null,
      enabled: fact.enabled && fact.token?.enabled !== false,
      alreadyMember: memberKeys.has(`${fact.accountId}\u0000${fact.tokenId ?? ""}\u0000${sourceModel}`),
    } satisfies RouteGroupCandidateCatalogItem;
  });
  return {
    items,
    pageInfo: {
      page,
      pageSize,
      totalCount: factPage.totalCount,
      hasMore: (page - 1) * pageSize + items.length < factPage.totalCount,
    },
  };
}

function targetMetadata(input: {
  manualOverride: boolean;
}): Record<string, unknown> {
  return { manualOverride: input.manualOverride };
}

export async function createRouteGroupCandidate(
  input: RouteGroupCandidateCreateInput,
): Promise<RouteGroupManagementCandidate | null> {
  const active = await getActiveRouteGraphSourceVersion();
  const macro = (active?.sourceGraph.macros || []).find(
    (current) =>
      current.id === text(input.routeGroupKey) &&
      current.kind === "candidate_selector",
  );
  if (!macro)
    throw new RouteGroupCommandError("route_group_not_found");
  if (isAutomaticRouteGroupFacadeMacro(macro)) throw automaticGroupError();
  let memberId = "";
  await mutateRouteGroupFacadeGraphTransaction({
    createdBy: "route-group-management",
    mutate: async (transaction, source) => {
      const group = routeGroupFacadeMacroOrThrow(source, input.routeGroupKey);
      if (isAutomaticRouteGroupFacadeMacro(group)) throw automaticGroupError();
      if (group.config.candidateSource) {
        throw new RouteGroupCommandError("candidate_kind_unsupported");
      }
      const stageId = text(input.stageId) || group.config.groups[0]?.id;
      const stage = stageId ? findRouteGroupFacadeStage(group, stageId) : null;
      if (!stage)
        throw new RouteGroupCommandError("fallback_stage_not_found");
      if (
        stage.input.kind !== "route_endpoints" &&
        stage.input.kind !== "graph_references" &&
        stage.input.kind !== "synthetic"
      ) {
        throw new RouteGroupCommandError("candidate_kind_unsupported");
      }
      const executionTarget = await transaction.select()
        .from(schema.runtimeExecutionTargets)
        .where(eq(schema.runtimeExecutionTargets.sourceRef, text(input.sourceRef)))
        .get();
      if (!executionTarget) throw new RouteGroupCommandError("source_not_found");
      const ensured = ensureRouteGraphExecutionTargetEndpoint(
        source,
        {
          id: executionTarget.id,
          upstreamModelName: executionTarget.upstreamModelName,
          enabled: executionTarget.enabled !== false,
        },
        {
          ownership: "derived",
          ownerKind: "macro",
          provenance: {
            source: "generated",
            generatedBy: "route-group-facade",
          },
        },
      );
      const duplicate = (stage.members || []).find(
        (member) => member.endpointId === ensured.endpoint.routeEndpointId,
      );
      if (duplicate?.memberId) {
        memberId = duplicate.memberId;
        return { source: ensured.source, result: undefined };
      }
      memberId = createManagedRouteGraphElementId("member", randomUUID());
      const nextMacro = replaceRouteGroupFacadeStage(
        group,
        stage.id,
        (current) => ({
          ...current,
          members: [
            ...(current.members || []),
            {
              memberId,
              endpointId: ensured.endpoint.routeEndpointId,
              enabled: input.enabled !== false,
              weight: normalizeWeight(input.weight),
              metadata: targetMetadata({
                manualOverride: input.manualOverride !== false,
              }),
            },
          ],
        }),
      );
      return {
        source: replaceRouteGroupFacadeMacroInSource(ensured.source, nextMacro),
        result: undefined,
      };
    },
  });
  return memberId
    ? await loadRouteGroupCandidate(input.routeGroupKey, memberId)
    : null;
}

export async function createRouteGroupCandidates(input: {
  routeGroupKey: string;
  stageId?: string;
  candidates: Array<{
    sourceRef: string;
    enabled?: boolean;
    weight?: number;
    manualOverride?: boolean;
  }>;
}): Promise<RouteGroupManagementCandidate[]> {
  if (input.candidates.length === 0) return [];
  const memberIds: string[] = [];
  await mutateRouteGroupFacadeGraphTransaction({
    createdBy: "route-group-management",
    mutate: async (transaction, source) => {
      let nextSource = source;
      let group = routeGroupFacadeMacroOrThrow(nextSource, input.routeGroupKey);
      if (isAutomaticRouteGroupFacadeMacro(group)) throw automaticGroupError();
      if (group.config.candidateSource) {
        throw new RouteGroupCommandError("candidate_kind_unsupported");
      }
      const stageId = text(input.stageId) || group.config.groups[0]?.id;
      if (!stageId) throw new RouteGroupCommandError("fallback_stage_not_found");

      for (const candidate of input.candidates) {
        const stage = findRouteGroupFacadeStage(group, stageId);
        if (!stage) throw new RouteGroupCommandError("fallback_stage_not_found");
        if (stage.input.kind !== "route_endpoints" && stage.input.kind !== "graph_references" && stage.input.kind !== "synthetic") {
          throw new RouteGroupCommandError("candidate_kind_unsupported");
        }
        const executionTarget = await transaction.select()
          .from(schema.runtimeExecutionTargets)
          .where(eq(schema.runtimeExecutionTargets.sourceRef, text(candidate.sourceRef)))
          .get();
        if (!executionTarget) throw new RouteGroupCommandError("source_not_found");
        const ensured = ensureRouteGraphExecutionTargetEndpoint(nextSource, {
          id: executionTarget.id,
          upstreamModelName: executionTarget.upstreamModelName,
          enabled: executionTarget.enabled !== false,
        }, {
          ownership: "derived",
          ownerKind: "macro",
          provenance: { source: "generated", generatedBy: "route-group-facade" },
        });
        nextSource = ensured.source;
        const duplicate = (stage.members || []).find((member) => member.endpointId === ensured.endpoint.routeEndpointId);
        if (duplicate?.memberId) {
          memberIds.push(duplicate.memberId);
          continue;
        }
        const memberId = createManagedRouteGraphElementId("member", randomUUID());
        memberIds.push(memberId);
        group = replaceRouteGroupFacadeStage(group, stage.id, (current) => ({
          ...current,
          members: [...(current.members || []), {
            memberId,
            endpointId: ensured.endpoint.routeEndpointId,
            enabled: candidate.enabled !== false,
            weight: normalizeWeight(candidate.weight),
            metadata: targetMetadata({ manualOverride: candidate.manualOverride !== false }),
          }],
        }));
        nextSource = replaceRouteGroupFacadeMacroInSource(nextSource, group);
      }
      return { source: nextSource, result: undefined };
    },
  });
  const loaded = await Promise.all(memberIds.map((memberId) => loadRouteGroupCandidate(input.routeGroupKey, memberId)));
  return loaded.filter((candidate): candidate is RouteGroupManagementCandidate => candidate !== null);
}

export async function updateRouteGroupMember(
  groupId: string,
  memberId: string,
  input: RouteGroupCandidateUpdateInput,
): Promise<RouteGroupManagementCandidate | null> {
  const current = await loadRouteGroupCandidate(groupId, memberId);
  if (!current) return null;
  await mutateRouteGroupFacadeGraphTransaction({
    createdBy: "route-group-management",
    mutate: async (transaction, source) => {
      const group = routeGroupFacadeMacroOrThrow(source, groupId);
      // Availability synchronization owns the endpoint source facts. It does
      // not own dispatcher arguments, so automatic groups retain the same
      // member placement, weight and enabled controls as manual groups.
      const found = findRouteGroupFacadeMember(group, memberId);
      if (!found) throw new RouteGroupCommandError("candidate_not_found");
      let nextSource = source;
      let endpointId = found.member.endpointId;
      const targetStageId = text(input.stageId) || found.stage.id;
      if (!findRouteGroupFacadeStage(group, targetStageId))
        throw new RouteGroupCommandError("fallback_stage_not_found");
      const updatedMember = {
        ...found.member,
        ...(endpointId ? { endpointId } : {}),
        ...(input.weight !== undefined
          ? { weight: normalizeWeight(input.weight) }
          : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.failureBackoff !== undefined
          ? { failureBackoff: input.failureBackoff || undefined }
          : {}),
        metadata: { ...found.member.metadata, manualOverride: true },
      };
      const nextMacro = replaceRouteGroupFacadeMacroInSource(nextSource, {
        ...group,
        config: {
          ...group.config,
          groups: group.config.groups.map((stage) => {
            if (stage.id === found.stage.id && stage.id === targetStageId) {
              return {
                ...stage,
                members: (stage.members || []).map((member) =>
                  member.memberId === memberId ? updatedMember : member,
                ),
              };
            }
            const members = (stage.members || []).filter(
              (member) => member.memberId !== memberId,
            );
            return stage.id === targetStageId
              ? { ...stage, members: [...members, updatedMember] }
              : { ...stage, members };
          }),
        },
      });
      return { source: nextMacro, result: undefined };
    },
  });
  return await loadRouteGroupCandidate(groupId, memberId);
}

export async function moveRouteGroupCandidatesToFallbackStages(
  groupId: string,
  updates: Array<{ id: string; stageId: string; sortOrder?: number }>,
  options: { manuallyAdjustedCandidateIds?: string[] } = {},
): Promise<{
  candidates: RouteGroupManagementCandidate[];
  stages: RouteGroupManagementFallbackStage[];
}> {
  const normalized = updates
    .map((update) => ({
      id: text(update.id),
      stageId: text(update.stageId),
      ...(Number.isFinite(Number(update.sortOrder))
        ? { sortOrder: Math.max(0, Math.trunc(Number(update.sortOrder))) }
        : {}),
    }))
    .filter((update) => update.id && update.stageId);
  if (normalized.length === 0) {
    return { candidates: [], stages: await projectedStages(groupId) };
  }
  const manuallyAdjustedIds = new Set(
    (options.manuallyAdjustedCandidateIds || normalized.map(({ id }) => id))
      .map(text)
      .filter(Boolean),
  );
  const changedIds = new Set<string>();
  await mutateRouteGroupFacadeGraph({
    createdBy: "route-group-management",
    mutate: (source) => {
      const group = routeGroupFacadeMacroOrThrow(source, groupId);
      const movedById = new Map(
        normalized.map((update) => [update.id, update]),
      );
      for (const update of normalized) {
        if (
          !findRouteGroupFacadeStage(group, update.stageId) ||
          !findRouteGroupFacadeMember(group, update.id)
        ) {
          throw new RouteGroupCommandError("fallback_stage_reference_not_found");
        }
      }
      const previousPlacementById = new Map(
        group.config.groups.flatMap((stage) =>
          (stage.members || []).flatMap((member, sortOrder) => {
            const memberId = text(member.memberId);
            return memberId
              ? [[memberId, { stageId: stage.id, sortOrder }] as const]
              : [];
          }),
        ),
      );
      const pending = new Map<
        string,
        Array<{
          member: NonNullable<
            ReturnType<typeof findRouteGroupFacadeMember>
          >["member"];
          sortOrder?: number;
        }>
      >();
      const retainedStages = group.config.groups.map((stage) => ({
        ...stage,
        members: (stage.members || []).filter((member) => {
          const update = member.memberId
            ? movedById.get(member.memberId)
            : null;
          if (!update) return true;
          const entries = pending.get(update.stageId) || [];
          entries.push({
            member,
            sortOrder: update.sortOrder,
          });
          pending.set(update.stageId, entries);
          return false;
        }),
      }));
      const movedStages = retainedStages.map((stage) => {
        const additions = (pending.get(stage.id) || []).sort(
          (left, right) =>
            (left.sortOrder ?? Number.MAX_SAFE_INTEGER) -
            (right.sortOrder ?? Number.MAX_SAFE_INTEGER),
        );
        const members = [...(stage.members || [])];
        for (const addition of additions) {
          const index =
            addition.sortOrder === undefined
              ? members.length
              : Math.min(addition.sortOrder, members.length);
          members.splice(index, 0, addition.member);
        }
        return { ...stage, members };
      });
      changedIds.clear();
      for (const stage of movedStages) {
        for (const [sortOrder, member] of (stage.members || []).entries()) {
          const memberId = text(member.memberId);
          if (!memberId || !movedById.has(memberId)) continue;
          const previous = previousPlacementById.get(memberId);
          if (
            previous?.stageId !== stage.id ||
            previous.sortOrder !== sortOrder
          ) {
            changedIds.add(memberId);
          }
        }
      }
      if (changedIds.size === 0) {
        return { source, result: undefined, publish: false };
      }
      const nextMacro = {
        ...group,
        config: {
          ...group.config,
          groups: movedStages.map((stage) => ({
            ...stage,
            members: (stage.members || []).map((member) =>
              member.memberId &&
              changedIds.has(member.memberId) &&
              manuallyAdjustedIds.has(member.memberId)
                ? {
                    ...member,
                    metadata: { ...member.metadata, manualOverride: true },
                  }
                : member,
            ),
          })),
        },
      };
      return {
        source: replaceRouteGroupFacadeMacroInSource(source, nextMacro),
        result: undefined,
      };
    },
  });
  const stages = await projectedStages(groupId);
  return {
    candidates: stages
      .flatMap((stage) => stage.candidates)
      .filter((candidate) => changedIds.has(candidate.id)),
    stages,
  };
}

export async function restoreAutomaticRouteGroupCandidateManagement(
  groupId: string,
  candidateIds?: string[],
): Promise<{
  restoredCount: number;
  stages: RouteGroupManagementFallbackStage[];
}> {
  const requestedIds = candidateIds
    ? new Set(candidateIds.map(text).filter(Boolean))
    : null;
  let restoredCount = 0;
  await mutateRouteGroupFacadeGraph({
    createdBy: "route-group-management",
    mutate: (source) => {
      const group = routeGroupFacadeMacroOrThrow(source, groupId);
      if (!isAutomaticRouteGroupFacadeMacro(group)) {
        throw new RouteGroupCommandError("candidate_kind_unsupported");
      }
      const primaryStage = routeGroupFacadeGeneratedPrimaryStage(group);
      if (!primaryStage)
        throw new RouteGroupCommandError("candidate_kind_unsupported");
      if (requestedIds) {
        for (const candidateId of requestedIds) {
          if (!findRouteGroupFacadeMember(group, candidateId)) {
            throw new RouteGroupCommandError("candidate_not_found");
          }
        }
      }
      const endpointsById = new Map(
        source.nodes.flatMap((node) =>
          node.type === "route_endpoint"
            ? ([[node.routeEndpointId, node]] as const)
            : [],
        ),
      );
      const selected = group.config.groups.flatMap((stage) =>
        (stage.members || []).filter((member) => {
          const memberId = text(member.memberId);
          return (
            memberId &&
            member.metadata?.manualOverride === true &&
            (!requestedIds || requestedIds.has(memberId))
          );
        }),
      );
      restoredCount = selected.length;
      const ownershipNeedsRestore =
        group.metadata?.managementOwner !== AVAILABILITY_ROUTE_GROUP_OWNER;
      if (restoredCount === 0 && !ownershipNeedsRestore) {
        return { source, result: undefined, publish: false };
      }
      const restoredById = new Map(
        selected.map((member) => {
          const endpoint = endpointsById.get(text(member.endpointId));
          return [
            text(member.memberId),
            {
              ...member,
              enabled: endpoint?.enabled !== false,
              weight: 10,
              metadata: { ...member.metadata, manualOverride: false },
            },
          ] as const;
        }),
      );
      type PlacementRecord = {
        member: RouteGroupFacadeMember;
        manualIndex: number | null;
        targetOrder: number;
      };
      const recordsByStageId = new Map<string, PlacementRecord[]>();
      for (const stage of group.config.groups) {
        for (const [memberIndex, currentMember] of (
          stage.members || []
        ).entries()) {
          const member =
            restoredById.get(text(currentMember.memberId)) || currentMember;
          const manuallyAdjusted = member.metadata?.manualOverride === true;
          const targetStageId = manuallyAdjusted ? stage.id : primaryStage.id;
          const records = recordsByStageId.get(targetStageId) || [];
          records.push({
            member,
            manualIndex: manuallyAdjusted ? memberIndex : null,
            targetOrder:
              executionTargetIdForRouteGraphEndpoint(
                endpointsById.get(text(member.endpointId)),
              ) ?? Number.MAX_SAFE_INTEGER,
          });
          recordsByStageId.set(targetStageId, records);
        }
      }
      const materialize = (stageId: string) => {
        const records = recordsByStageId.get(stageId) || [];
        const members = records
          .filter((record) => record.manualIndex === null)
          .sort((left, right) => left.targetOrder - right.targetOrder)
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
      const nextStages = group.config.groups
        .filter((stage) => requestedIds || stage.id === primaryStage.id)
        .map((stage) => ({ ...stage, members: materialize(stage.id) }));
      const nextMacro = {
        ...group,
        metadata: {
          ...group.metadata,
          managementOwner: AVAILABILITY_ROUTE_GROUP_OWNER,
        },
        config: { ...group.config, groups: nextStages },
      };
      return {
        source: replaceRouteGroupFacadeMacroInSource(source, nextMacro),
        result: undefined,
      };
    },
  });
  return { restoredCount, stages: await projectedStages(groupId) };
}

export async function deleteRouteGroupCandidate(
  groupId: string,
  memberId: string,
): Promise<{ routeGroupKey: string; deleted: boolean }> {
  const current = await loadRouteGroupCandidate(groupId, memberId);
  if (!current) return { routeGroupKey: groupId, deleted: false };
  await mutateRouteGroupFacadeGraph({
    createdBy: "route-group-management",
    mutate: (source) => {
      const group = routeGroupFacadeMacroOrThrow(source, groupId);
      if (isAutomaticRouteGroupFacadeMacro(group)) throw automaticGroupError();
      const nextMacro = {
        ...group,
        config: {
          ...group.config,
          groups: group.config.groups.map((stage) => ({
            ...stage,
            members: (stage.members || []).filter(
              (member) => member.memberId !== memberId,
            ),
          })),
        },
      };
      return {
        source: replaceRouteGroupFacadeMacroInSource(source, nextMacro),
        result: undefined,
      };
    },
  });
  return { routeGroupKey: groupId, deleted: true };
}

export async function routeGroupMembersBelongToGroup(
  groupId: string,
  memberIds: string[],
): Promise<{ ok: true } | { ok: false }> {
  const active = await getActiveRouteGraphSourceVersion();
  const macro = (active?.sourceGraph.macros || []).find(
    (current) =>
      current.id === groupId && current.kind === "candidate_selector",
  );
  if (!macro) return { ok: false };
  const known = new Set(
    macro.config.groups.flatMap((stage) =>
      (stage.members || []).map((member) => member.memberId).filter(Boolean),
    ),
  );
  const missing = memberIds.find((id) => !known.has(id));
  return missing ? { ok: false } : { ok: true };
}
