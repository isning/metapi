// Projects Source Graph facts into the Route Group management facade.
import type {
  RouteGraphMacro,
  RouteGraphNode,
  RouteGraphSource,
} from "../../shared/routeGraph.js";
import { normalizeTargetSelectionPolicy } from "../../shared/routeGraph.js";
import type {
  RouteGroupManagementCandidate,
  RouteGroupManagementFallbackStage,
  RouteGroupManagementSummary,
  RouteGroupSourceProjection,
} from "../../shared/routeGroupManagement.js";
import { matchesModelPattern } from "../../shared/modelPatternMatcher.js";
import {
  executionTargetIdForRouteGraphEndpoint,
  executionTargetIdsForRouteGraphEndpoint,
} from "./routeGraphExecutionTargetEndpointService.js";
import type {
  RuntimeExecutionTargetCatalogFact,
  RuntimeExecutionTargetFact,
} from "./runtimeExecutionTargetFactsService.js";

function text(value: unknown): string {
  return String(value || "").trim();
}

function normalized(value: unknown): string | null {
  const result = text(value).toLowerCase();
  return result || null;
}

function macroModel(macro: RouteGraphMacro): string | null {
  const entry = macro.config.surface.entry;
  return entry.kind === "external"
    ? text(entry.match.requestedModelPattern) || null
    : text(macro.metadata?.canonicalModel) || null;
}

function macroVisibility(macro: RouteGraphMacro): "public" | "internal" {
  return macro.config.surface.entry.kind === "external" ? "public" : "internal";
}

function macroSources(
  macro: RouteGraphMacro,
  nodesByEndpointId: Map<string, RouteGraphNode>,
  targetsById: Map<number, RuntimeExecutionTargetCatalogFact>,
  macrosById: Map<string, RouteGraphMacro>,
): RouteGroupSourceProjection[] {
  const sources = new Map<string, RouteGroupSourceProjection>();
  for (const group of macro.config.groups.slice(0, 1)) {
    const endpointIds =
      group.input.kind === "route_endpoints" ||
      group.input.kind === "graph_references"
        ? group.input.endpointIds
        : [];
    for (const endpointId of endpointIds) {
      const node = nodesByEndpointId.get(endpointId);
      for (const targetId of executionTargetIdsForRouteGraphEndpoint(node)) {
        const target = targetsById.get(targetId);
        if (!target) continue;
        const siteName = target?.site?.name || null;
        const modelName = text(target?.modelName) || text(node?.name) || null;
        sources.set(`execution_target:${targetId}`, {
          source: { kind: "execution_target", sourceRef: target.sourceRef },
          label: text(siteName)
            ? `${siteName} · ${modelName || endpointId}`
            : modelName || endpointId,
          modelName,
          siteName,
          enabled:
            group.enabled !== false &&
            target?.enabled !== false &&
            node?.enabled !== false,
        });
      }
    }
    if (group.input.kind === "graph_references") {
      for (const macroId of group.input.macroIds) {
        const sourceMacro = macrosById.get(macroId);
        const sourceModel = sourceMacro ? macroModel(sourceMacro) : null;
        sources.set(`route_group:${macroId}`, {
          source: { kind: "route_group", id: macroId },
          label: text(sourceMacro?.name) || sourceModel || macroId,
          modelName: sourceModel,
          siteName: null,
          enabled: group.enabled !== false,
        });
      }
    }
  }
  return [...sources.values()];
}

function macroSourceSelection(
  macro: RouteGraphMacro,
  nodesByEndpointId: Map<string, RouteGraphNode>,
  targetsById: Map<number, RuntimeExecutionTargetCatalogFact>,
  macrosById: Map<string, RouteGraphMacro>,
): RouteGroupManagementSummary["sourceSelection"] {
  if (macro.config.candidateSource?.kind === "model_pattern") {
    return { kind: "model_pattern", pattern: macro.config.candidateSource.pattern };
  }
  return {
    kind: "explicit",
    sources: macroSources(macro, nodesByEndpointId, targetsById, macrosById),
  };
}

function patternTargets(
  macro: RouteGraphMacro,
  targetsById: Map<number, RuntimeExecutionTargetCatalogFact>,
): RuntimeExecutionTargetCatalogFact[] {
  const patterns = macro.config.candidateSource?.kind === "model_pattern"
    ? [macro.config.candidateSource.pattern]
    : [];
  if (patterns.length === 0) return [];
  return [...targetsById.values()].filter(
    (target) =>
      target.enabled !== false &&
      patterns.some((pattern) =>
        matchesModelPattern(target.modelName, pattern)
        || matchesModelPattern(target.modelName.toLowerCase(), pattern),
      ),
  );
}

function patternEndpointIds(
  macro: RouteGraphMacro,
  nodesByEndpointId: Map<string, RouteGraphNode>,
  targetsById: Map<number, RuntimeExecutionTargetCatalogFact>,
): string[] {
  const patterns = macro.config.candidateSource?.kind === 'model_pattern'
    ? [macro.config.candidateSource.pattern]
    : [];
  if (patterns.length === 0) return [];
  return [...nodesByEndpointId.values()].flatMap((node) => {
    if (node.type !== 'route_endpoint' || node.enabled === false) return [];
    const matches = executionTargetIdsForRouteGraphEndpoint(node)
      .map((id) => targetsById.get(id))
      .some((target) => target
        && target.enabled !== false
        && patterns.some((pattern) => (
          matchesModelPattern(target.modelName, pattern)
          || matchesModelPattern(target.modelName.toLowerCase(), pattern)
        )));
    return matches ? [node.routeEndpointId] : [];
  });
}

function macroCandidateCount(
  macro: RouteGraphMacro,
  nodesByEndpointId: Map<string, RouteGraphNode>,
  targetsById: Map<number, RuntimeExecutionTargetCatalogFact>,
): number {
  const endpointCandidates = new Set<string>();
  const macroCandidates = new Set<string>();
  for (const group of macro.config.groups) {
    if (group.enabled === false) continue;
    for (const member of group.members || []) {
      const endpointId = text(member.endpointId);
      const macroId = text(member.macroId);
      if (endpointId) endpointCandidates.add(endpointId);
      if (macroId) macroCandidates.add(macroId);
    }
  }
  for (const endpointId of patternEndpointIds(macro, nodesByEndpointId, targetsById)) {
    endpointCandidates.add(endpointId);
  }
  return endpointCandidates.size + macroCandidates.size;
}

function enabledCandidateCount(
  macro: RouteGraphMacro,
  nodesByEndpointId: Map<string, RouteGraphNode>,
  targetsById: Map<number, RuntimeExecutionTargetCatalogFact>,
): number {
  const endpointCandidates = new Set<string>();
  const macroCandidates = new Set<string>();
  for (const group of macro.config.groups) {
    if (group.enabled === false) continue;
    for (const member of group.members || []) {
      if (member.enabled === false) continue;
      const macroId = text(member.macroId);
      if (macroId) {
        macroCandidates.add(macroId);
        continue;
      }
      const endpointId = text(member.endpointId);
      const node = nodesByEndpointId.get(endpointId);
      const targets = executionTargetIdsForRouteGraphEndpoint(node)
        .map((id) => targetsById.get(id))
        .filter((target): target is RuntimeExecutionTargetCatalogFact => !!target);
      if (node?.enabled !== false && targets.some((target) => target.enabled !== false)) {
        endpointCandidates.add(endpointId);
      }
    }
  }
  for (const endpointId of patternEndpointIds(macro, nodesByEndpointId, targetsById)) {
    endpointCandidates.add(endpointId);
  }
  return endpointCandidates.size + macroCandidates.size;
}

function reachableSiteNames(
  macro: RouteGraphMacro,
  nodesByEndpointId: Map<string, RouteGraphNode>,
  targetsById: Map<number, RuntimeExecutionTargetCatalogFact>,
  macrosById: Map<string, RouteGraphMacro>,
  visited = new Set<string>(),
): string[] {
  if (visited.has(macro.id)) return [];
  visited.add(macro.id);
  const sites = new Set<string>();
  for (const group of macro.config.groups) {
    for (const member of group.members || []) {
      if (member.macroId) {
        const referenced = macrosById.get(member.macroId);
        if (referenced) {
          for (const siteName of reachableSiteNames(
            referenced,
            nodesByEndpointId,
            targetsById,
            macrosById,
            visited,
          ))
            sites.add(siteName);
        }
        continue;
      }
      const node = nodesByEndpointId.get(text(member.endpointId));
      for (const targetId of executionTargetIdsForRouteGraphEndpoint(node)) {
        const siteName = text(targetsById.get(targetId)?.site?.name);
        if (siteName) sites.add(siteName);
      }
    }
  }
  for (const target of patternTargets(macro, targetsById)) {
    const siteName = text(target.site?.name);
    if (siteName) sites.add(siteName);
  }
  return [...sites];
}

/**
 * Projects management stage/member DTOs from Graph configuration. The member
 * identity stays local to its dispatcher stage and is never reconstructed from
 * a persistence row or execution target key.
 */
export function projectRouteGroupFallbackStagesFromGraph(
  source: RouteGraphSource,
  macroId: string,
  targetFacts: RuntimeExecutionTargetFact[] = [],
): RouteGroupManagementFallbackStage[] | null {
  const macro = (source.macros || []).find(
    (current) =>
      current.id === macroId && current.kind === "candidate_selector",
  );
  if (!macro) return null;
  const nodesByEndpointId = new Map(
    source.nodes
      .filter(
        (node): node is Extract<RouteGraphNode, { type: "route_endpoint" }> =>
          node.type === "route_endpoint",
      )
      .map((node) => [node.routeEndpointId, node]),
  );
  const targetsById = new Map(targetFacts.map((target) => [target.id, target]));
  return macro.config.groups.map((group, order) => {
    const candidates: RouteGroupManagementCandidate[] = [];
    for (const [sortOrder, member] of (group.members || []).entries()) {
      const memberId = text(member.memberId);
      if (!memberId) continue;
      const candidateOverride = member.override;
      const effectiveSortOrder = candidateOverride?.order ?? sortOrder;
      const effectiveWeight = candidateOverride?.weight ?? member.weight;
      const effectiveEnabled = candidateOverride?.enabled ?? member.enabled;
      const effectiveFailureBackoff = candidateOverride?.failureBackoff ?? member.failureBackoff;
      if (member.macroId) {
        const referenced = (source.macros || []).find(
          (current) => current.id === member.macroId,
        );
        const referencedModel = referenced ? macroModel(referenced) : null;
        candidates.push({
          kind: "route_group",
          id: memberId,
          routeGroupId: macro.id,
          routeGroupKey: macro.id,
          fallbackStageId: group.id,
          fallbackStageLabel: group.label || null,
          fallbackStageOrder: order,
          sortOrder: effectiveSortOrder,
          weight:
            Number.isFinite(Number(effectiveWeight)) && Number(effectiveWeight) > 0
              ? Number(effectiveWeight)
              : 10,
          enabled:
            macro.enabled !== false &&
            group.enabled !== false &&
            effectiveEnabled !== false &&
            referenced?.enabled !== false,
          manualOverride: !!candidateOverride || member.metadata?.manualOverride === true,
          successCount: 0,
          failCount: 0,
          cooldownUntil: null,
          failureBackoff: effectiveFailureBackoff || null,
          referencedRouteGroup: {
            id: member.macroId,
            label: text(referenced?.name) || referencedModel || member.macroId,
            modelName: referencedModel,
            enabled: referenced?.enabled !== false,
          },
        });
        continue;
      }
      const node = nodesByEndpointId.get(text(member.endpointId));
      const targets = executionTargetIdsForRouteGraphEndpoint(node)
        .map((id) => targetsById.get(id))
        .filter((target): target is RuntimeExecutionTargetFact => !!target);
      if (targets.length === 0) continue;
      candidates.push({
        kind: "execution_endpoint",
        id: memberId,
        routeGroupId: macro.id,
        routeGroupKey: macro.id,
        modelName: text(node?.name) || targets[0]?.modelName || null,
        targetSelection: node?.type === "route_endpoint" && node.config?.targetSelection
          ? normalizeTargetSelectionPolicy(node.config.targetSelection)
          : null,
        targets: targets.map((target) => ({
          id: target.id,
          sourceRef: target.sourceRef,
          accountId: target.accountId,
          tokenId: target.tokenId,
          sourceModel: target.modelName || null,
          account: { username: target.account.username },
          site: target.site,
          token: target.token,
          enabled: target.enabled,
          successCount: target.successCount,
          failCount: target.failCount,
          cooldownUntil: target.cooldownUntil,
        })),
        fallbackStageId: group.id,
        fallbackStageLabel: group.label || null,
        fallbackStageOrder: order,
        sortOrder: effectiveSortOrder,
        weight:
          Number.isFinite(Number(effectiveWeight)) && Number(effectiveWeight) > 0
            ? Number(effectiveWeight)
            : 10,
        enabled:
          macro.enabled !== false &&
          group.enabled !== false &&
          effectiveEnabled !== false &&
          node?.enabled !== false &&
          targets.some((target) => target.enabled !== false),
        manualOverride: !!candidateOverride || member.metadata?.manualOverride === true,
        successCount: targets.reduce((sum, target) => sum + target.successCount, 0),
        failCount: targets.reduce((sum, target) => sum + target.failCount, 0),
        cooldownUntil: targets.every((target) => target.cooldownUntil === targets[0]?.cooldownUntil)
          ? targets[0]?.cooldownUntil || null
          : null,
        failureBackoff: effectiveFailureBackoff || null,
      });
    }
    return {
      id: group.id,
      label: group.label || null,
      order,
      enabled: group.enabled !== false,
      dispatcherPolicy: group.policy || null,
      failureBackoff: group.failureBackoff || group.defaults?.failureBackoff || null,
      candidateManagement:
        macro.config.candidateSource
          ? "generated"
          : group.input.kind === "route_endpoints" ||
            group.input.kind === "graph_references" ||
            group.input.kind === "synthetic"
          ? "explicit"
          : "generated",
      candidates,
    };
  });
}

/**
 * Derives the Route Group management read model from source-Graph macros.
 * No Route Group side tables exist; Source Graph is the only projection input.
 */
export function projectRouteGroupsFromGraph(
  source: RouteGraphSource,
  targetFacts: RuntimeExecutionTargetCatalogFact[] = [],
): RouteGroupManagementSummary[] {
  const nodesByEndpointId = new Map(
    source.nodes
      .filter(
        (node): node is Extract<RouteGraphNode, { type: "route_endpoint" }> =>
          node.type === "route_endpoint",
      )
      .map((node) => [node.routeEndpointId, node]),
  );
  const targetsById = new Map(targetFacts.map((target) => [target.id, target]));
  const macrosById = new Map(
    (source.macros || []).map((macro) => [macro.id, macro]),
  );
  const macroResources = (source.macros || [])
    .filter((macro) => macro.kind === "candidate_selector")
    .map((macro) => {
      const sourceSelection = macroSourceSelection(
        macro,
        nodesByEndpointId,
        targetsById,
        macrosById,
      );
      const model = macroModel(macro);
      const candidateCount = macroCandidateCount(
        macro,
        nodesByEndpointId,
        targetsById,
      );
      return {
        id: macro.id,
        kind: macro.ownership === "manual" ? "manual" : "automatic",
        sourceMode: macro.ownership === "manual" ? "manual" : "auto",
        model: {
          publicName: model,
          upstreamName: model,
          normalizedName: normalized(model),
        },
        presentation: {
          displayName: text(macro.name) || null,
          displayIcon: macro.config.presentation?.displayIcon || null,
        },
        filters: macro.config.filters || null,
        dispatcherPolicy: macro.config.policy || null,
        failureBackoff: macro.config.failureBackoff || null,
        affinity: macro.config.affinity || { policy: { kind: 'inherit_default' }, pools: [] },
        visibility: macroVisibility(macro),
        enabled: macro.enabled !== false,
        sourceSelection,
        candidateCount,
        enabledCandidateCount: enabledCandidateCount(
          macro,
          nodesByEndpointId,
          targetsById,
        ),
        siteNames: reachableSiteNames(
          macro,
          nodesByEndpointId,
          targetsById,
          macrosById,
        ).sort((left, right) => left.localeCompare(right)),
      } satisfies RouteGroupManagementSummary;
    });
  return macroResources;
}
