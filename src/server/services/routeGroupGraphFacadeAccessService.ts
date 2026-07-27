import type {
  CandidateSelectorMacroConfig,
  RouteGraphMacro,
  RouteGraphNode,
  RouteGraphSource,
} from "../../shared/routeGraph.js";
import { normalizeRouteGraphMacro } from "../../shared/routeGraph.js";
import {
  findRouteGroupFacadeMacro,
  replaceRouteGroupFacadeMacro,
} from "./routeGroupGraphFacadeService.js";
import { executionTargetIdForRouteGraphEndpoint } from "./routeGraphExecutionTargetEndpointService.js";

export type RouteGroupFacadeStage =
  CandidateSelectorMacroConfig["groups"][number];
export type RouteGroupFacadeMember = NonNullable<
  RouteGroupFacadeStage["members"]
>[number];

const GENERATED_PRIMARY_STAGE_ROLE = "generated_primary";

function text(value: unknown): string {
  return String(value || "").trim();
}

function endpointIds(members: RouteGroupFacadeMember[]): string[] {
  return members.map((member) => text(member.endpointId)).filter(Boolean);
}

function macroIds(members: RouteGroupFacadeMember[]): string[] {
  return members.map((member) => text(member.macroId)).filter(Boolean);
}

/**
 * Candidate-selector input is the compiler-facing materialization of the
 * stage-local members. Keep both facets synchronized in one Graph mutation.
 */
export function synchronizeRouteGroupFacadeStageInput(
  stage: RouteGroupFacadeStage,
  hasCandidateSource = false,
): RouteGroupFacadeStage {
  const members = (stage.members || []).filter(
    (member) => text(member.endpointId) || text(member.macroId),
  );
  const stageEndpointIds = endpointIds(members);
  const stageMacroIds = macroIds(members);
  return {
    ...stage,
    input: hasCandidateSource
      ? {
          kind: "synthetic",
          statusCode: 503,
          message: "No route is available.",
        }
      : stageMacroIds.length > 0
        ? {
            kind: "graph_references",
            endpointIds: stageEndpointIds,
            macroIds: stageMacroIds,
          }
        : stageEndpointIds.length > 0
          ? { kind: "route_endpoints", endpointIds: stageEndpointIds }
          : {
            kind: "synthetic",
            statusCode: 503,
            message: "No route is available.",
          },
    ...(members.length > 0 ? { members } : { members: [] }),
  };
}

export function replaceRouteGroupFacadeStage(
  macro: RouteGraphMacro,
  stageId: string,
  replace: (stage: RouteGroupFacadeStage) => RouteGroupFacadeStage,
): RouteGraphMacro {
  const normalizedStageId = text(stageId);
  const found = macro.config.groups.some(
    (stage) => stage.id === normalizedStageId,
  );
  if (!found) throw new RouteGroupFacadeStageNotFoundError(normalizedStageId);
  return normalizeRouteGraphMacro({
    ...macro,
    config: {
      ...macro.config,
      groups: macro.config.groups.map((stage) =>
        stage.id === normalizedStageId
          ? synchronizeRouteGroupFacadeStageInput(
              replace(stage),
              !!macro.config.candidateSource,
            )
          : stage,
      ),
    },
  });
}

export function replaceRouteGroupFacadeStages(
  macro: RouteGraphMacro,
  stages: RouteGroupFacadeStage[],
): RouteGraphMacro {
  return normalizeRouteGraphMacro({
    ...macro,
    config: {
      ...macro.config,
      groups: stages.map((stage) =>
        synchronizeRouteGroupFacadeStageInput(stage, !!macro.config.candidateSource),
      ),
    },
  });
}

export function findRouteGroupFacadeStage(
  macro: RouteGraphMacro,
  stageId: string,
): RouteGroupFacadeStage | null {
  const normalizedStageId = text(stageId);
  return (
    macro.config.groups.find((stage) => stage.id === normalizedStageId) || null
  );
}

export function routeGroupFacadeGeneratedPrimaryStage(
  macro: RouteGraphMacro,
): RouteGroupFacadeStage | null {
  return (
    macro.config.groups.find(
      (stage) =>
        stage.metadata?.generationRole === GENERATED_PRIMARY_STAGE_ROLE,
    ) ||
    macro.config.groups[0] ||
    null
  );
}

export function markRouteGroupFacadeGeneratedPrimaryStage<
  TStage extends object,
>(stage: TStage): TStage & { metadata: Record<string, unknown> } {
  const metadata = (stage as { metadata?: Record<string, unknown> }).metadata;
  return {
    ...stage,
    metadata: {
      ...metadata,
      generationRole: GENERATED_PRIMARY_STAGE_ROLE,
    },
  };
}

export function findRouteGroupFacadeMember(
  macro: RouteGraphMacro,
  memberId: string,
): {
  stage: RouteGroupFacadeStage;
  member: RouteGroupFacadeMember;
  memberIndex: number;
} | null {
  const normalizedMemberId = text(memberId);
  if (!normalizedMemberId) return null;
  for (const stage of macro.config.groups) {
    const memberIndex = (stage.members || []).findIndex(
      (member) => member.memberId === normalizedMemberId,
    );
    if (memberIndex >= 0)
      return { stage, member: stage.members![memberIndex]!, memberIndex };
  }
  return null;
}

export function routeGroupFacadeModelName(macro: RouteGraphMacro): string {
  if (macro.config.surface.entry.kind === "external") {
    return text(macro.config.surface.entry.match.requestedModelPattern);
  }
  return text(macro.metadata?.canonicalModel);
}

export function routeGroupFacadeVisibility(
  macro: RouteGraphMacro,
): "public" | "internal" {
  return macro.config.surface.entry.kind === "external" ? "public" : "internal";
}

export function isAutomaticRouteGroupFacadeMacro(
  macro: RouteGraphMacro,
): boolean {
  return macro.ownership === "system";
}

export function routeGroupFacadeEndpointForExecutionTarget(
  source: RouteGraphSource,
  executionTargetId: number,
): Extract<RouteGraphNode, { type: "route_endpoint" }> | null {
  return (
    source.nodes.find(
      (node): node is Extract<RouteGraphNode, { type: "route_endpoint" }> =>
        node.type === "route_endpoint" &&
        executionTargetIdForRouteGraphEndpoint(node) === executionTargetId,
    ) || null
  );
}

export function routeGroupFacadeMacroOrThrow(
  source: RouteGraphSource,
  macroId: string,
): RouteGraphMacro {
  const macro = findRouteGroupFacadeMacro(source, macroId);
  if (!macro) throw new RouteGroupFacadeNotFoundError(text(macroId));
  return macro;
}

/**
 * Facade-created endpoints are derived Graph materialization. Remove only
 * endpoints no macro or primitive edge still references; user-authored Graph
 * endpoints and shared execution-target endpoints are left intact.
 */
export function pruneUnreferencedRouteGroupFacadeEndpoints(
  source: RouteGraphSource,
): RouteGraphSource {
  const referencedEndpointIds = new Set<string>();
  for (const macro of source.macros || []) {
    for (const stage of macro.config.groups) {
      for (const member of stage.members || []) {
        if (text(member.endpointId))
          referencedEndpointIds.add(text(member.endpointId));
      }
      if (
        stage.input.kind === "route_endpoints" ||
        stage.input.kind === "graph_references"
      ) {
        for (const endpointId of stage.input.endpointIds)
          referencedEndpointIds.add(endpointId);
      }
    }
  }
  const edgeReferencedNodeIds = new Set(
    source.edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]),
  );
  const retainedNodes = source.nodes.filter((node) => {
    if (node.type !== "route_endpoint" || node.ownerKind !== "macro")
      return true;
    const provenance = node.provenance as Record<string, unknown> | undefined;
    if (provenance?.generatedBy !== "route-group-facade") return true;
    return (
      referencedEndpointIds.has(node.routeEndpointId) ||
      edgeReferencedNodeIds.has(node.id)
    );
  });
  return retainedNodes.length === source.nodes.length
    ? source
    : { ...source, nodes: retainedNodes };
}

export function replaceRouteGroupFacadeMacroInSource(
  source: RouteGraphSource,
  macro: RouteGraphMacro,
): RouteGraphSource {
  const synchronizedMacro = normalizeRouteGraphMacro({
    ...macro,
    config: {
      ...macro.config,
      groups: macro.config.groups.map((stage) =>
        synchronizeRouteGroupFacadeStageInput(stage, !!macro.config.candidateSource),
      ),
    },
  });
  return pruneUnreferencedRouteGroupFacadeEndpoints(
    replaceRouteGroupFacadeMacro(source, synchronizedMacro),
  );
}

export class RouteGroupFacadeNotFoundError extends Error {
  constructor(macroId: string) {
    super(`Route group ${macroId || "unknown"} does not exist`);
    this.name = "RouteGroupFacadeNotFoundError";
  }
}

export class RouteGroupFacadeStageNotFoundError extends Error {
  constructor(stageId: string) {
    super(
      `Fallback stage ${stageId || "unknown"} does not belong to the route group`,
    );
    this.name = "RouteGroupFacadeStageNotFoundError";
  }
}
