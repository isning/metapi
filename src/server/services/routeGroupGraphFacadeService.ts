import { randomUUID } from "node:crypto";
import {
  normalizeRouteGraphMacro,
  type CandidateSelectorMacroConfig,
  type DispatcherPolicy,
  type RouteFilter,
  type RouteGraphMacro,
  type RouteGraphSource,
  type RouteFailureBackoffOverride,
} from "../../shared/routeGraph.js";
import { createManagedRouteGraphElementId } from "../../shared/routingIdentity.js";
import { mutateActiveRouteGraphSource, mutateActiveRouteGraphSourceTransaction } from "./routeGraphService.js";
import { invalidateRouteGroupManagementReadModel } from './routeGroupManagementReadModelService.js';

export type RouteGroupFacadeMemberReference =
  | {
      kind: "endpoint";
      endpointId: string;
      memberId?: string;
      enabled?: boolean;
      weight?: number;
      metadata?: Record<string, unknown>;
      override?: CandidateSelectorMacroConfig["groups"][number]["members"] extends Array<infer M> ? M extends { override?: infer O } ? O : never : never;
    }
  | {
      kind: "macro";
      macroId: string;
      memberId?: string;
      enabled?: boolean;
      weight?: number;
      metadata?: Record<string, unknown>;
      override?: CandidateSelectorMacroConfig["groups"][number]["members"] extends Array<infer M> ? M extends { override?: infer O } ? O : never : never;
    };

export type RouteGroupFacadeStage = {
  id?: string;
  label?: string | null;
  enabled?: boolean;
  acceptUnassigned?: boolean;
  policy?: DispatcherPolicy | null;
  members?: RouteGroupFacadeMemberReference[];
  metadata?: Record<string, unknown>;
};

export type RouteGroupFacadeMacroInput = {
  id?: string;
  kind: "automatic" | "manual";
  modelName: string;
  displayName?: string | null;
  displayIcon?: string | null;
  visibility?: "public" | "internal";
  enabled?: boolean;
  policy?: DispatcherPolicy | null;
  failureBackoff?: RouteFailureBackoffOverride | null;
  affinity?: CandidateSelectorMacroConfig["affinity"] | null;
  filters?: { operations: RouteFilter[] } | null;
  candidateSource?: CandidateSelectorMacroConfig["candidateSource"] | null;
  stages?: RouteGroupFacadeStage[];
  metadata?: Record<string, unknown>;
};

function text(value: unknown): string {
  return String(value || "").trim();
}

function opaqueId(kind: "macro" | "stage" | "member"): string {
  return createManagedRouteGraphElementId(kind, randomUUID());
}

function normalizeWeight(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function stageMembers(members: RouteGroupFacadeMemberReference[] = []) {
  return members
    .map((member) => {
      const endpointId =
        member.kind === "endpoint" ? text(member.endpointId) : "";
      const macroId = member.kind === "macro" ? text(member.macroId) : "";
      if (!endpointId && !macroId) return null;
      return {
        memberId: text(member.memberId) || opaqueId("member"),
        ...(endpointId ? { endpointId } : {}),
        ...(macroId ? { macroId } : {}),
        ...(member.enabled === false ? { enabled: false } : {}),
        ...(normalizeWeight(member.weight) !== undefined
          ? { weight: normalizeWeight(member.weight) }
          : {}),
        ...(member.metadata && Object.keys(member.metadata).length > 0
          ? { metadata: member.metadata }
          : {}),
        ...(member.override ? { override: member.override } : {}),
      };
    })
    .filter((member): member is NonNullable<typeof member> => !!member);
}

function graphInputForStage(members: ReturnType<typeof stageMembers>) {
  const endpointIds = members
    .map((member) => member.endpointId)
    .filter((value): value is string => !!value);
  const macroIds = members
    .map((member) => member.macroId)
    .filter((value): value is string => !!value);
  if (macroIds.length > 0) {
    return { kind: "graph_references" as const, endpointIds, macroIds };
  }
  if (endpointIds.length > 0) {
    return { kind: "route_endpoints" as const, endpointIds };
  }
  return {
    kind: "synthetic" as const,
    statusCode: 503 as const,
    message: "No route is available.",
  };
}

function normalizeStages(
  input: RouteGroupFacadeStage[] | undefined,
  hasCandidateSource: boolean,
) {
  const stages = input && input.length > 0 ? input : [{}];
  return stages.map((stage) => {
    const members = stageMembers(stage.members);
    return {
      id: text(stage.id) || opaqueId("stage"),
      ...(text(stage.label) ? { label: text(stage.label) } : {}),
      enabled: stage.enabled !== false,
      ...(stage.acceptUnassigned === true ? { acceptUnassigned: true } : {}),
      ...(stage.policy ? { policy: stage.policy } : {}),
      input: hasCandidateSource
        ? { kind: "synthetic" as const, statusCode: 503 as const, message: "No route is available." }
        : graphInputForStage(members),
      ...(members.length > 0 ? { members } : {}),
      ...(stage.metadata && Object.keys(stage.metadata).length > 0
        ? { metadata: stage.metadata }
        : {}),
    };
  });
}

function macroSurface(
  input: Pick<RouteGroupFacadeMacroInput, "modelName" | "visibility">,
) {
  const modelName = text(input.modelName);
  if (input.visibility === "internal") {
    return { entry: { kind: "none" as const }, output: "route" as const };
  }
  return {
    entry: {
      kind: "external" as const,
      match: {
        kind: "model" as const,
        requestedModelPattern: modelName,
        displayName: modelName || null,
      },
    },
    output: "route" as const,
  };
}

/**
 * Creates the Graph-owned macro used by the Route Group management facade.
 * Stages and members are macro configuration, rather than persisted Route
 * Group child resources. Member identity is scoped to its stage.
 */
export function createRouteGroupFacadeMacro(
  source: RouteGraphSource,
  input: RouteGroupFacadeMacroInput,
): { source: RouteGraphSource; macro: RouteGraphMacro } {
  const id = text(input.id) || opaqueId("macro");
  if ((source.macros || []).some((macro) => macro.id === id)) {
    throw new Error(`Route Group macro ${id} already exists`);
  }
  const modelName = text(input.modelName);
  if (!modelName) throw new Error("Route Group model name is required");
  const macro = normalizeRouteGraphMacro({
    id,
    kind: "candidate_selector",
    ownership: input.kind === "automatic" ? "system" : "manual",
    enabled: input.enabled !== false,
    name: text(input.displayName) || modelName,
    config: {
      surface: macroSurface(input),
      policy: input.policy || { kind: "inherit_default" },
      ...(input.failureBackoff ? { failureBackoff: input.failureBackoff } : {}),
      ...(input.affinity ? { affinity: input.affinity } : {}),
      ...(input.filters ? { filters: input.filters } : {}),
      ...(input.candidateSource ? { candidateSource: input.candidateSource } : {}),
      groups: normalizeStages(input.stages, !!input.candidateSource),
      ...(text(input.displayIcon)
        ? { presentation: { displayIcon: text(input.displayIcon) } }
        : {}),
    },
    metadata: {
      canonicalModel: modelName.toLowerCase(),
      ...(input.metadata || {}),
    },
  });
  return {
    source: {
      ...source,
      macros: [...(source.macros || []), macro],
    },
    macro,
  };
}

export function findRouteGroupFacadeMacro(
  source: RouteGraphSource,
  macroId: string,
): RouteGraphMacro | null {
  const id = text(macroId);
  if (!id) return null;
  return (
    (source.macros || []).find(
      (macro) => macro.id === id && macro.kind === "candidate_selector",
    ) || null
  );
}

/** Replaces one facade macro without a side table or reconstructed Graph identity. */
export function replaceRouteGroupFacadeMacro(
  source: RouteGraphSource,
  macro: RouteGraphMacro,
): RouteGraphSource {
  if (!(source.macros || []).some((current) => current.id === macro.id)) {
    throw new Error(`Route Group macro ${macro.id} does not exist`);
  }
  return {
    ...source,
    macros: (source.macros || []).map((current) =>
      current.id === macro.id ? normalizeRouteGraphMacro(macro) : current,
    ),
  };
}

/**
 * Applies one Route Group facade mutation to the active source Graph and
 * publishes it atomically. The facade does not read or persist a parallel
 * Route Group source of truth.
 */
export async function mutateRouteGroupFacadeGraph<T>(input: {
  createdBy: string;
  mutate: (source: RouteGraphSource) => {
    source: RouteGraphSource;
    result: T;
    publish?: boolean;
  };
}): Promise<{ source: RouteGraphSource; result: T }> {
  const result = await mutateActiveRouteGraphSource(input);
  invalidateRouteGroupManagementReadModel();
  return result;
}

export async function mutateRouteGroupFacadeGraphTransaction<T>(input: {
  createdBy: string;
  mutate: (transaction: any, source: RouteGraphSource) => Promise<{
    source: RouteGraphSource;
    result: T;
  }>;
}): Promise<{ source: RouteGraphSource; result: T }> {
  const result = await mutateActiveRouteGraphSourceTransaction(input);
  invalidateRouteGroupManagementReadModel();
  return result;
}
