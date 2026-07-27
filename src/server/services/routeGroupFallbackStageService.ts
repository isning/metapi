import { randomUUID } from "node:crypto";
import { requireNativeDispatcherPolicy, type DispatcherPolicy } from "../../shared/routeGraph.js";
import { createManagedRouteGraphElementId } from "../../shared/routingIdentity.js";
import type { RouteGroupManagementFallbackStage } from "../../shared/routeGroupManagement.js";
import { mutateRouteGroupFacadeGraph } from "./routeGroupGraphFacadeService.js";
import {
  type RouteGroupFacadeStage,
  findRouteGroupFacadeMember,
  findRouteGroupFacadeStage,
  replaceRouteGroupFacadeMacroInSource,
  replaceRouteGroupFacadeStages,
  routeGroupFacadeMacroOrThrow,
} from "./routeGroupGraphFacadeAccessService.js";
import { loadRuntimeExecutionTargetFacts } from "./runtimeExecutionTargetFactsService.js";
import { projectRouteGroupFallbackStagesFromGraph } from "./routeGroupManagementProjectionService.js";
import { getActiveRouteGraphSourceVersion } from "./routeGraphService.js";
import { executionTargetIdsForRouteGraphEndpoint } from "./routeGraphExecutionTargetEndpointService.js";
import { RouteGroupCommandError } from "./routeGroupCommandError.js";

export type RouteGroupFallbackStageCreateInput = {
  label?: string | null;
  dispatcherPolicy?: DispatcherPolicy | null;
  enabled?: boolean;
};

export type RouteGroupFallbackStagePlacementInput = {
  afterStageId: string;
  candidateId: string;
};

export type RouteGroupFallbackStageUpdateInput =
  RouteGroupFallbackStageCreateInput;

function text(value: unknown): string {
  return String(value || "").trim();
}

function policy(value: unknown): DispatcherPolicy | undefined {
  if (value === null || value === undefined) return undefined;
  return requireNativeDispatcherPolicy(value);
}

function createStage(
  input: RouteGroupFallbackStageCreateInput,
): RouteGroupFacadeStage {
  return {
    id: createManagedRouteGraphElementId("stage", randomUUID()),
    ...(text(input.label) ? { label: text(input.label) } : {}),
    enabled: input.enabled !== false,
    ...(policy(input.dispatcherPolicy)
      ? { policy: policy(input.dispatcherPolicy) }
      : {}),
    input: {
      kind: "synthetic" as const,
      statusCode: 503 as const,
      message: "No route is available.",
    },
    members: [],
  };
}

export function fallbackStageDto(
  stage: RouteGroupManagementFallbackStage,
): RouteGroupManagementFallbackStage {
  return stage;
}

export async function listRouteGroupFallbackStages(
  groupId: string,
): Promise<RouteGroupManagementFallbackStage[]> {
  const active = await getActiveRouteGraphSourceVersion();
  if (!active) return [];
  const macro = (active.sourceGraph.macros || []).find(
    (item) => item.id === groupId && item.kind === 'candidate_selector',
  );
  if (!macro) return [];
  const nodesByEndpointId = new Map(active.sourceGraph.nodes.map((node) => [
    node.type === 'route_endpoint' ? node.routeEndpointId : node.id,
    node,
  ]));
  const executionTargetIds = Array.from(new Set(macro.config.groups.flatMap((stage) =>
    (stage.members || []).flatMap((member) =>
      executionTargetIdsForRouteGraphEndpoint(nodesByEndpointId.get(text(member.endpointId))),
    ),
  )));
  const facts = await loadRuntimeExecutionTargetFacts(executionTargetIds);
  return active
    ? projectRouteGroupFallbackStagesFromGraph(
        active.sourceGraph,
        groupId,
        facts,
      ) || []
    : [];
}

export async function loadRouteGroupFallbackStage(
  groupId: string,
  stageId: string,
): Promise<RouteGroupManagementFallbackStage | null> {
  const stages = await listRouteGroupFallbackStages(groupId);
  return stages.find((stage) => stage.id === text(stageId)) || null;
}

export async function createRouteGroupFallbackStage(
  groupId: string,
  input: RouteGroupFallbackStageCreateInput,
): Promise<RouteGroupManagementFallbackStage> {
  const created = await createRouteGroupFallbackStageWithProjection(
    groupId,
    input,
  );
  return created.stage;
}

export async function createRouteGroupFallbackStageWithProjection(
  groupId: string,
  input: RouteGroupFallbackStageCreateInput,
  placement?: RouteGroupFallbackStagePlacementInput,
): Promise<{
  stage: RouteGroupManagementFallbackStage;
  stages: RouteGroupManagementFallbackStage[];
}> {
  const created = await mutateRouteGroupFacadeGraph({
    createdBy: "route-group-management",
    mutate: (source) => {
      const macro = routeGroupFacadeMacroOrThrow(source, groupId);
      const stage = createStage(input);
      let stages = macro.config.groups;
      if (placement) {
        const afterStageIndex = stages.findIndex(
          (current) => current.id === text(placement.afterStageId),
        );
        const candidate = findRouteGroupFacadeMember(
          macro,
          placement.candidateId,
        );
        if (afterStageIndex < 0 || !candidate) {
          throw new RouteGroupCommandError(
            "fallback_stage_reference_not_found",
          );
        }
        const movedMember = {
          ...candidate.member,
          metadata: { ...candidate.member.metadata, manualOverride: true },
        };
        stages = stages.map((current) => ({
          ...current,
          members: (current.members || []).filter(
            (member) => member.memberId !== placement.candidateId,
          ),
        }));
        stage.members = [movedMember];
        stages = [...stages];
        stages.splice(afterStageIndex + 1, 0, stage);
      } else {
        stages = [...stages, stage];
      }
      const nextMacro = replaceRouteGroupFacadeStages(macro, stages);
      return {
        source: replaceRouteGroupFacadeMacroInSource(source, nextMacro),
        result: stage.id,
      };
    },
  });
  const stages = await listRouteGroupFallbackStages(groupId);
  const stage = stages.find((current) => current.id === created.result);
  if (!stage) throw new RouteGroupCommandError("fallback_stage_projection_failed");
  return { stage, stages };
}

export async function updateRouteGroupFallbackStage(
  groupId: string,
  stageId: string,
  input: RouteGroupFallbackStageUpdateInput,
): Promise<RouteGroupManagementFallbackStage | null> {
  const existing = await loadRouteGroupFallbackStage(groupId, stageId);
  if (!existing) return null;
  await mutateRouteGroupFacadeGraph({
    createdBy: "route-group-management",
    mutate: (source) => {
      const macro = routeGroupFacadeMacroOrThrow(source, groupId);
      const current = findRouteGroupFacadeStage(macro, stageId);
      if (!current)
        throw new RouteGroupCommandError("fallback_stage_not_found");
      const nextStages = macro.config.groups.map((stage) =>
        stage.id === current.id
          ? {
              ...stage,
              ...(Object.prototype.hasOwnProperty.call(input, "label")
                ? text(input.label)
                  ? { label: text(input.label) }
                  : { label: undefined }
                : {}),
              ...(typeof input.enabled === "boolean"
                ? { enabled: input.enabled }
                : {}),
              ...(Object.prototype.hasOwnProperty.call(
                input,
                "dispatcherPolicy",
              )
                ? { policy: policy(input.dispatcherPolicy) }
                : {}),
            }
          : stage,
      );
      const nextMacro = replaceRouteGroupFacadeStages(macro, nextStages);
      return {
        source: replaceRouteGroupFacadeMacroInSource(source, nextMacro),
        result: undefined,
      };
    },
  });
  return await loadRouteGroupFallbackStage(groupId, stageId);
}

export async function reorderRouteGroupFallbackStages(
  groupId: string,
  stageIds: string[],
): Promise<RouteGroupManagementFallbackStage[]> {
  const stages = await listRouteGroupFallbackStages(groupId);
  const normalizedIds = Array.from(new Set(stageIds.map(text).filter(Boolean)));
  const existingIds = stages.map((stage) => stage.id);
  if (
    normalizedIds.length !== existingIds.length ||
    normalizedIds.some((id) => !existingIds.includes(id))
  ) {
    throw new RouteGroupCommandError("fallback_stage_order_invalid");
  }
  await mutateRouteGroupFacadeGraph({
    createdBy: "route-group-management",
    mutate: (source) => {
      const macro = routeGroupFacadeMacroOrThrow(source, groupId);
      const byId = new Map(
        macro.config.groups.map((stage) => [stage.id, stage]),
      );
      const nextMacro = replaceRouteGroupFacadeStages(
        macro,
        normalizedIds.map((id) => byId.get(id)!),
      );
      return {
        source: replaceRouteGroupFacadeMacroInSource(source, nextMacro),
        result: undefined,
      };
    },
  });
  return await listRouteGroupFallbackStages(groupId);
}

export async function deleteRouteGroupFallbackStage(
  groupId: string,
  stageId: string,
): Promise<boolean> {
  const stages = await listRouteGroupFallbackStages(groupId);
  const stage = stages.find((item) => item.id === text(stageId));
  if (!stage) return false;
  if (stages.length <= 1)
    throw new RouteGroupCommandError("fallback_stage_required");
  if (stage.candidates.length > 0)
    throw new RouteGroupCommandError("fallback_stage_not_empty");
  await mutateRouteGroupFacadeGraph({
    createdBy: "route-group-management",
    mutate: (source) => {
      const macro = routeGroupFacadeMacroOrThrow(source, groupId);
      const nextMacro = replaceRouteGroupFacadeStages(
        macro,
        macro.config.groups.filter((current) => current.id !== stageId),
      );
      return {
        source: replaceRouteGroupFacadeMacroInSource(source, nextMacro),
        result: undefined,
      };
    },
  });
  return true;
}
