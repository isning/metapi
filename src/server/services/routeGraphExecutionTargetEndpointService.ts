import { randomUUID } from 'node:crypto';
import {
  normalizeRouteGraphMatchSpec,
  normalizeRouteGraphNode,
  type RouteGraphOwnership,
  type RouteGraphNode,
  type RouteNodeProvenance,
  type RouteGraphSource,
  type TargetSelectionPolicy,
} from '../../shared/routeGraph.js';
import { createManagedRouteGraphElementId } from '../../shared/routingIdentity.js';

export type RouteGraphExecutionTargetEndpointInput = {
  id: number;
  sourceRef?: string;
  upstreamModelName: string;
  enabled: boolean;
};

export type RouteGraphExecutionTargetEndpointAuthoring = {
  ownership?: RouteGraphOwnership;
  ownerKind?: 'manual' | 'macro';
  provenance?: RouteNodeProvenance;
  endpointId?: string;
  targetSelection?: TargetSelectionPolicy;
};

function text(value: unknown): string {
  return String(value || '').trim();
}

function normalizedModelName(value: unknown): string {
  return text(value).toLowerCase();
}

export function executionTargetIdsForRouteGraphEndpoint(
  node: RouteGraphNode | undefined,
): number[] {
  if (node?.type !== 'route_endpoint') return [];
  const targets = Array.isArray(node.config?.targets) ? node.config.targets : [];
  return Array.from(new Set(targets.flatMap((target) => {
    const value = Number(target.transportBinding?.executionTargetId);
    return target.transportBinding?.kind === 'execution_target'
      && Number.isSafeInteger(value)
      && value > 0
      ? [Math.trunc(value)]
      : [];
  })));
}

export function executionTargetIdForRouteGraphEndpoint(
  node: RouteGraphNode | undefined,
): number | null {
  const ids = executionTargetIdsForRouteGraphEndpoint(node);
  return ids.length === 1 ? ids[0]! : null;
}

/**
 * Removes execution-target transport bindings from a Source Graph without
 * deriving identities. Empty endpoints and their candidate-selector members
 * are removed together, leaving an empty stage as an explicit synthetic
 * terminal rather than a dangling endpoint reference.
 */
export function removeRouteGraphExecutionTargets(
  source: RouteGraphSource,
  executionTargetIds: Iterable<number>,
): { source: RouteGraphSource; removedEndpointIds: string[] } {
  const removedTargetIds = new Set(
    Array.from(executionTargetIds).filter((id) => Number.isSafeInteger(id) && id > 0),
  );
  if (removedTargetIds.size === 0) return { source, removedEndpointIds: [] };

  const removedEndpointIds = new Set<string>();
  const nodes: RouteGraphNode[] = source.nodes.flatMap((node): RouteGraphNode[] => {
    if (node.type !== 'route_endpoint') return [node];
    const endpoint = node as Extract<RouteGraphNode, { type: 'route_endpoint' }>;
    const existingTargets = Array.isArray(endpoint.config?.targets) ? endpoint.config.targets : [];
    const targets = existingTargets.filter((target) => (
      target.transportBinding?.kind !== 'execution_target'
      || !removedTargetIds.has(Number(target.transportBinding.executionTargetId))
    ));
    if (targets.length === 0 && executionTargetIdsForRouteGraphEndpoint(endpoint).length > 0) {
      removedEndpointIds.add(endpoint.routeEndpointId || endpoint.id);
      return [];
    }
    return [{ ...endpoint, config: { ...endpoint.config, targets } }];
  });
  if (removedEndpointIds.size === 0) return { source: { ...source, nodes }, removedEndpointIds: [] };

  const macros = (source.macros || []).map((macro) => {
    if (macro.kind !== 'candidate_selector') return macro;
    let changed = false;
    const groups = macro.config.groups.map((group) => {
      const members = (group.members || []).filter((member) => (
        !member.endpointId || !removedEndpointIds.has(member.endpointId)
      ));
      const membersChanged = members.length !== (group.members || []).length;
      const input = group.input.kind === 'route_endpoints'
        ? {
            ...group.input,
            endpointIds: group.input.endpointIds.filter((id) => !removedEndpointIds.has(id)),
          }
        : group.input.kind === 'graph_references'
          ? {
              ...group.input,
              endpointIds: group.input.endpointIds.filter((id) => !removedEndpointIds.has(id)),
            }
          : group.input;
      const inputChanged = (
        group.input.kind === 'route_endpoints'
        && input.kind === 'route_endpoints'
        && input.endpointIds.length !== group.input.endpointIds.length
      ) || (
        group.input.kind === 'graph_references'
        && input.kind === 'graph_references'
        && input.endpointIds.length !== group.input.endpointIds.length
      );
      if (!membersChanged && !inputChanged) return group;
      changed = true;
      const isEmptyExplicitInput = (
        input.kind === 'route_endpoints' && input.endpointIds.length === 0
      ) || (
        input.kind === 'graph_references'
        && input.endpointIds.length === 0
        && input.macroIds.length === 0
      );
      const nextInput = isEmptyExplicitInput
        ? { kind: 'synthetic' as const, statusCode: 503 as const, message: 'No route is available.' }
        : input;
      if (members.length > 0) return { ...group, input: nextInput, members };
      const { members: _removedMembers, ...groupWithoutMembers } = group;
      return { ...groupWithoutMembers, input: nextInput };
    });
    return changed ? { ...macro, config: { ...macro.config, groups } } : macro;
  });

  return {
    source: {
      ...source,
      nodes,
      macros,
      edges: source.edges.filter((edge) => (
        !removedEndpointIds.has(edge.sourceNodeId) && !removedEndpointIds.has(edge.targetNodeId)
      )),
    },
    removedEndpointIds: [...removedEndpointIds],
  };
}

function newTargetId(): string {
  return createManagedRouteGraphElementId('target', randomUUID());
}

function supplyEndpointForTargets(
  targets: RouteGraphExecutionTargetEndpointInput[],
  authoring: RouteGraphExecutionTargetEndpointAuthoring,
) {
  const endpointId = text(authoring.endpointId)
    || createManagedRouteGraphElementId('endpoint', randomUUID());
  const model = text(targets[0]?.upstreamModelName);
  return normalizeRouteGraphNode({
    id: endpointId,
    type: 'route_endpoint',
    routeEndpointId: endpointId,
    name: model,
    enabled: targets.some((target) => target.enabled !== false),
    ownership: authoring.ownership || 'manual',
    endpointKind: 'supply',
    exposure: 'none',
    resolutionStatus: 'resolved',
    ownerKind: authoring.ownerKind || 'manual',
    sourceKind: 'upstream_model',
    backend: { kind: 'supply' },
    match: normalizeRouteGraphMatchSpec({
      kind: 'model',
      requestedModelPattern: model,
      displayName: model,
    }),
    metadata: { upstreamModel: model, normalizedModel: normalizedModelName(model) },
    config: {
      targets: targets.map((target) => ({
        targetId: newTargetId(),
        model: text(target.upstreamModelName),
        modelSource: 'fixed' as const,
        enabled: target.enabled !== false,
        transportBinding: {
          kind: 'execution_target' as const,
          executionTargetId: target.id,
        },
        ...(text(target.sourceRef) ? { executionTargetSourceRef: text(target.sourceRef) } : {}),
      })),
      targetSelection: authoring.targetSelection
        || { kind: 'builtin', builtin: 'stable_first' },
    },
    provenance: authoring.provenance || { source: 'manual' },
  });
}

/**
 * Authors one generic Graph endpoint containing one or more executable targets.
 * Transport bindings are explicit; grouping semantics live only in the normal
 * endpoint target-selection policy.
 */
export function ensureRouteGraphExecutionTargetsEndpoint(
  source: RouteGraphSource,
  targets: RouteGraphExecutionTargetEndpointInput[],
  authoring: RouteGraphExecutionTargetEndpointAuthoring = {},
): {
  source: RouteGraphSource;
  endpoint: Extract<RouteGraphNode, { type: 'route_endpoint' }>;
  created: boolean;
} {
  const normalizedTargets = targets.filter((target, index, all) => (
    Number.isSafeInteger(target.id)
    && target.id > 0
    && all.findIndex((candidate) => candidate.id === target.id) === index
  ));
  if (normalizedTargets.length === 0) {
    throw new Error('Route endpoint requires at least one execution target');
  }
  const requestedIds = new Set(normalizedTargets.map((target) => target.id));
  const requestedEndpointId = text(authoring.endpointId);
  const existing = source.nodes.find((node) => (
    node.type === 'route_endpoint'
    && (
      (requestedEndpointId && node.routeEndpointId === requestedEndpointId)
      || executionTargetIdsForRouteGraphEndpoint(node).some((id) => requestedIds.has(id))
    )
  ));
  if (existing?.type === 'route_endpoint') {
    const model = text(normalizedTargets[0]?.upstreamModelName);
    const existingMatch = existing.match || normalizeRouteGraphMatchSpec({
      kind: 'model',
      requestedModelPattern: existing.name,
    });
    const existingConfig = existing.config || { targets: [] };
    const existingTargets = Array.isArray(existingConfig.targets)
      ? existingConfig.targets
      : [];
    const existingTargetByExecutionTargetId = new Map(
      existingTargets.flatMap((target) => {
        const id = Number(target.transportBinding?.executionTargetId);
        return target.transportBinding?.kind === 'execution_target'
          && Number.isSafeInteger(id)
          && id > 0
          ? [[Math.trunc(id), target] as const]
          : [];
      }),
    );
    const endpoint = normalizeRouteGraphNode({
      ...existing,
      name: model || existing.name,
      enabled: normalizedTargets.some((target) => target.enabled !== false),
      match: normalizeRouteGraphMatchSpec({
        kind: 'model',
        requestedModelPattern: model || existingMatch.requestedModelPattern,
        displayName: model || existingMatch.displayName,
      }),
      metadata: {
        ...existing.metadata,
        upstreamModel: model || existing.metadata?.upstreamModel,
        normalizedModel: normalizedModelName(model || existing.metadata?.upstreamModel),
      },
      config: {
        ...existingConfig,
        targets: normalizedTargets.map((target) => {
          const current = existingTargetByExecutionTargetId.get(target.id);
          return {
            ...current,
            targetId: text(current?.targetId) || newTargetId(),
            model: text(target.upstreamModelName),
            modelSource: 'fixed' as const,
            enabled: target.enabled !== false,
            transportBinding: {
              kind: 'execution_target' as const,
              executionTargetId: target.id,
            },
            ...(text(target.sourceRef || current?.executionTargetSourceRef)
              ? { executionTargetSourceRef: text(target.sourceRef || current?.executionTargetSourceRef) }
              : {}),
          };
        }),
        targetSelection: authoring.targetSelection
          || existingConfig.targetSelection
          || { kind: 'builtin', builtin: 'stable_first' },
      },
    }) as Extract<RouteGraphNode, { type: 'route_endpoint' }>;
    return {
      source: {
        ...source,
        nodes: source.nodes.map((node) => node.id === endpoint.id ? endpoint : node),
      },
      endpoint,
      created: false,
    };
  }
  const endpoint = supplyEndpointForTargets(
    normalizedTargets,
    authoring,
  ) as Extract<RouteGraphNode, { type: 'route_endpoint' }>;
  return {
    source: { ...source, nodes: [...source.nodes, endpoint] },
    endpoint,
    created: true,
  };
}

export function ensureRouteGraphExecutionTargetEndpoint(
  source: RouteGraphSource,
  target: RouteGraphExecutionTargetEndpointInput,
  authoring: RouteGraphExecutionTargetEndpointAuthoring = {},
): {
  source: RouteGraphSource;
  endpoint: Extract<RouteGraphNode, { type: 'route_endpoint' }>;
  created: boolean;
} {
  return ensureRouteGraphExecutionTargetsEndpoint(source, [target], authoring);
}
