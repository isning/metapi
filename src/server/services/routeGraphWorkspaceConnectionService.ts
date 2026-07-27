import { randomUUID } from 'node:crypto';
import { createManagedRouteGraphElementId, stableRoutingIdentityHash } from '../../shared/routingIdentity.js';
import type {
  RouteGraphWorkspaceConnectionEndpointRef,
  RouteGraphWorkspaceConnectionTarget,
  RouteGraphWorkspaceConnectionTargetFilters,
  RouteGraphWorkspaceConnectionTargetPage,
} from '../../shared/routeGraphWorkspace.js';
import {
  RouteGraphConnectionValidationError,
  createRouteGraphConnectionValidationSession,
  resolveRouteGraphConnectionEndpoint,
  validateRouteGraphConnectionAgainstSource,
  type ResolvedRouteGraphConnectionEndpoint,
} from './routeGraphConnectionService.js';
import { buildRouteGraphSemanticIndex, routeGraphSemanticElementLabel, type RouteGraphSemanticIndex } from './routeGraphWorkspaceIndexService.js';
import { applyRouteGraphWorkspaceOperations, applyRouteGraphWorkspaceOperationsToGraph, RouteGraphWorkspaceRevisionConflictError } from './routeGraphWorkspaceOperationsService.js';
import { getRouteGraphWorkspaceRevisionContext } from './routeGraphWorkspaceQueryService.js';

const DEFAULT_TARGET_LIMIT = 24;
const MAX_TARGET_LIMIT = 100;

type TargetCursor = {
  revision: string;
  queryHash: string;
  offset: number;
};

export class RouteGraphWorkspaceConnectionCursorError extends Error {
  readonly code = 'invalid_connection_cursor';

  constructor() {
    super('The route graph connection cursor is invalid or stale.');
    this.name = 'RouteGraphWorkspaceConnectionCursorError';
  }
}

export class RouteGraphWorkspaceConnectionMutationError extends Error {
  constructor(readonly code: 'edge_not_found' | 'edge_not_authorable' | 'replacement_source_mismatch') {
    super(code);
    this.name = 'RouteGraphWorkspaceConnectionMutationError';
  }
}

function encodeCursor(cursor: TargetCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string | null | undefined): TargetCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<TargetCursor>;
    if (typeof parsed.revision !== 'string' || typeof parsed.queryHash !== 'string' || !Number.isInteger(parsed.offset) || parsed.offset! < 0) {
      throw new RouteGraphWorkspaceConnectionCursorError();
    }
    return parsed as TargetCursor;
  } catch (error) {
    if (error instanceof RouteGraphWorkspaceConnectionCursorError) throw error;
    throw new RouteGraphWorkspaceConnectionCursorError();
  }
}

function targetFromResolved(
  index: RouteGraphSemanticIndex,
  endpoint: ResolvedRouteGraphConnectionEndpoint,
): RouteGraphWorkspaceConnectionTarget {
  const element = index.elementsById.get(endpoint.graphElementId)!;
  const source = endpoint.node || endpoint.macro!;
  return {
    endpoint: endpoint.ref,
    graphElementId: endpoint.graphElementId,
    elementLabel: routeGraphSemanticElementLabel(element),
    elementKind: endpoint.node?.type || 'macro',
    elementSubtitle: endpoint.node?.type || endpoint.macro?.kind || null,
    enabled: source.enabled !== false,
    ownership: source.ownership,
    port: {
      id: endpoint.port.id,
      label: endpoint.port.label,
      direction: endpoint.port.direction,
      kind: endpoint.port.kind,
      manualEdgePolicy: endpoint.port.manualEdgePolicy,
      ...(endpoint.port.description ? { description: endpoint.port.description } : {}),
    },
    focuses: (index.focusesByElementId.get(endpoint.graphElementId) || []).map((focus) => ({
      focus: focus.element.ref,
      label: routeGraphSemanticElementLabel(focus.element),
    })),
  };
}

function resolveReplacement(input: {
  replacingEdgeId?: string | null;
  source: ResolvedRouteGraphConnectionEndpoint;
  semanticIndex: RouteGraphSemanticIndex;
}) {
  if (!input.replacingEdgeId) return null;
  const edge = input.semanticIndex.edgeById.get(input.replacingEdgeId);
  if (!edge) throw new RouteGraphWorkspaceConnectionMutationError('edge_not_found');
  if (edge.ownership !== 'manual') throw new RouteGraphWorkspaceConnectionMutationError('edge_not_authorable');
  const matchesSource = (
    (edge.sourceNodeId === input.source.graphElementId && edge.sourcePortId === input.source.port.id)
    || (edge.targetNodeId === input.source.graphElementId && edge.targetPortId === input.source.port.id)
  );
  if (!matchesSource) throw new RouteGraphWorkspaceConnectionMutationError('replacement_source_mismatch');
  return edge;
}

function candidateEndpoints(index: RouteGraphSemanticIndex): ResolvedRouteGraphConnectionEndpoint[] {
  const values: ResolvedRouteGraphConnectionEndpoint[] = [];
  for (const element of index.elementsById.values()) {
    for (const port of index.portsByElementId.get(element.elementId)?.values() || []) {
      values.push({
        ref: { element: element.ref, portId: port.id },
        graphElementId: element.elementId,
        node: element.node,
        macro: element.macro,
        port,
      });
    }
  }
  return values;
}

function compareTargets(left: RouteGraphWorkspaceConnectionTarget, right: RouteGraphWorkspaceConnectionTarget): number {
  return left.elementLabel.localeCompare(right.elementLabel)
    || left.port.label.localeCompare(right.port.label)
    || left.graphElementId.localeCompare(right.graphElementId)
    || left.port.id.localeCompare(right.port.id);
}

export async function getRouteGraphWorkspaceConnectionTargets(
  input: RouteGraphWorkspaceConnectionTargetFilters,
): Promise<RouteGraphWorkspaceConnectionTargetPage> {
  const context = await getRouteGraphWorkspaceRevisionContext();
  if (input.revision && input.revision !== context.revision) throw new RouteGraphWorkspaceRevisionConflictError();
  const graph = input.operations?.length
    ? applyRouteGraphWorkspaceOperationsToGraph(context.draft.workingGraph, input.operations).graph
    : context.draft.workingGraph;
  const draft = { ...context.draft, workingGraph: graph };
  const revision = context.revision;
  const semanticIndex = input.operations?.length ? buildRouteGraphSemanticIndex(graph) : context.semanticIndex;
  const source = resolveRouteGraphConnectionEndpoint(semanticIndex, input.source);
  const replacement = resolveReplacement({ replacingEdgeId: input.replacingEdgeId, source, semanticIndex });
  const normalizedQuery = String(input.query || '').trim().toLocaleLowerCase();
  const queryHash = stableRoutingIdentityHash({ source: input.source, replacingEdgeId: input.replacingEdgeId || null, query: normalizedQuery });
  const cursor = decodeCursor(input.cursor);
  if (cursor && (cursor.revision !== revision || cursor.queryHash !== queryHash)) {
    throw new RouteGraphWorkspaceConnectionCursorError();
  }
  const validationSession = createRouteGraphConnectionValidationSession({
    graph: draft.workingGraph,
    first: source.ref,
    replacingEdgeId: replacement?.id,
    semanticIndex,
  });
  const targets = candidateEndpoints(semanticIndex)
    .filter((candidate) => {
      if (candidate.graphElementId === source.graphElementId && candidate.port.id === source.port.id) return false;
      try {
        validationSession.validate(candidate);
        return true;
      } catch (error) {
        if (error instanceof RouteGraphConnectionValidationError) return false;
        throw error;
      }
    })
    .map((candidate) => targetFromResolved(semanticIndex, candidate))
    .filter((target) => !normalizedQuery || `${target.elementLabel}\n${target.elementSubtitle || ''}\n${target.port.label}\n${target.graphElementId}`.toLocaleLowerCase().includes(normalizedQuery))
    .sort(compareTargets);
  const numericLimit = Number(input.limit);
  const limit = Number.isFinite(numericLimit) ? Math.max(1, Math.min(MAX_TARGET_LIMIT, Math.trunc(numericLimit))) : DEFAULT_TARGET_LIMIT;
  const offset = Math.min(cursor?.offset || 0, targets.length);
  const items = targets.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    revision,
    source: targetFromResolved(semanticIndex, source),
    items,
    nextCursor: nextOffset < targets.length ? encodeCursor({ revision, queryHash, offset: nextOffset }) : null,
    totalCount: targets.length,
  };
}

export async function draftRouteGraphWorkspaceConnection(input: {
  revision: string;
  operations: import('../../shared/routeGraphOperations.js').RouteGraphWorkspaceOperation[];
  first: RouteGraphWorkspaceConnectionEndpointRef;
  second: RouteGraphWorkspaceConnectionEndpointRef;
  replacingEdgeId?: string | null;
}) {
  const context = await getRouteGraphWorkspaceRevisionContext();
  if (input.revision !== context.revision) throw new RouteGraphWorkspaceRevisionConflictError();
  const graph = applyRouteGraphWorkspaceOperationsToGraph(context.draft.workingGraph, input.operations).graph;
  const semanticIndex = buildRouteGraphSemanticIndex(graph);
  const first = resolveRouteGraphConnectionEndpoint(semanticIndex, input.first);
  const replacement = resolveReplacement({ replacingEdgeId: input.replacingEdgeId, source: first, semanticIndex });
  const connection = validateRouteGraphConnectionAgainstSource({
    graph,
    first: input.first,
    second: input.second,
    replacingEdgeId: replacement?.id,
    semanticIndex,
  });
  return {
    edge: {
      id: createManagedRouteGraphElementId('edge', randomUUID()),
      sourceNodeId: connection.source.graphElementId,
      sourcePortId: connection.source.port.id,
      targetNodeId: connection.target.graphElementId,
      targetPortId: connection.target.port.id,
      kind: connection.edgeKind,
      ownership: 'manual' as const,
    },
  };
}

export async function createRouteGraphWorkspaceConnection(input: {
  revision: string;
  first: RouteGraphWorkspaceConnectionEndpointRef;
  second: RouteGraphWorkspaceConnectionEndpointRef;
  replacingEdgeId?: string | null;
}) {
  const { draft, revision, semanticIndex } = await getRouteGraphWorkspaceRevisionContext();
  if (input.revision !== revision) throw new RouteGraphWorkspaceRevisionConflictError();
  const first = resolveRouteGraphConnectionEndpoint(semanticIndex, input.first);
  const replacement = resolveReplacement({ replacingEdgeId: input.replacingEdgeId, source: first, semanticIndex });
  const connection = validateRouteGraphConnectionAgainstSource({
    graph: draft.workingGraph,
    first: input.first,
    second: input.second,
    replacingEdgeId: replacement?.id,
    semanticIndex,
  });
  const edge = {
    id: createManagedRouteGraphElementId('edge', randomUUID()),
    sourceNodeId: connection.source.graphElementId,
    sourcePortId: connection.source.port.id,
    targetNodeId: connection.target.graphElementId,
    targetPortId: connection.target.port.id,
    kind: connection.edgeKind,
    ownership: 'manual' as const,
  };
  const result = await applyRouteGraphWorkspaceOperations({
    revision,
    operations: [
      ...(replacement ? [{ kind: 'remove_edge' as const, edgeId: replacement.id }] : []),
      { kind: 'upsert_edge' as const, edge },
    ],
  });
  return { ...result, edge };
}
