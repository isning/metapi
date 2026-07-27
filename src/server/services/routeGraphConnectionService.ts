import {
  getRouteGraphMacroPort,
  getRouteGraphNodePort,
  getRouteGraphPortConnectionBounds,
  canAttachManualRouteGraphEdge,
} from '../../shared/routeGraph.js';
import type {
  RouteGraphEdge,
  RouteGraphEdgeKind,
  RouteGraphMacro,
  RouteGraphNode,
  RouteGraphPort,
  RouteGraphSource,
} from '../../shared/routeGraph.js';
import type {
  RouteGraphElementRef,
  RouteGraphWorkspaceConnectionEndpointRef,
} from '../../shared/routeGraphWorkspace.js';
import {
  buildRouteGraphSemanticIndex,
  type RouteGraphSemanticIndex,
} from './routeGraphWorkspaceIndexService.js';

export type RouteGraphConnectionValidationCode =
  | 'element_not_found'
  | 'port_not_found'
  | 'same_element'
  | 'source_not_output'
  | 'target_not_input'
  | 'port_disabled'
  | 'manual_edge_denied'
  | 'port_kind_mismatch'
  | 'edge_kind_mismatch'
  | 'duplicate_connection'
  | 'input_capacity_exceeded'
  | 'cycle';

export type ResolvedRouteGraphConnectionEndpoint = {
  ref: RouteGraphWorkspaceConnectionEndpointRef;
  graphElementId: string;
  node: RouteGraphNode | null;
  macro: RouteGraphMacro | null;
  port: RouteGraphPort;
};

export type ValidatedRouteGraphConnection = {
  source: ResolvedRouteGraphConnectionEndpoint;
  target: ResolvedRouteGraphConnectionEndpoint;
  edgeKind: RouteGraphEdgeKind;
};

export type RouteGraphConnectionValidationSession = {
  first: ResolvedRouteGraphConnectionEndpoint;
  validate: (second: ResolvedRouteGraphConnectionEndpoint) => ValidatedRouteGraphConnection;
};

export class RouteGraphConnectionValidationError extends Error {
  constructor(readonly code: RouteGraphConnectionValidationCode) {
    super(code);
    this.name = 'RouteGraphConnectionValidationError';
  }
}

function elementForRef(index: RouteGraphSemanticIndex, ref: RouteGraphElementRef) {
  if (ref.kind === 'node') return index.elementsById.get(ref.id) || null;
  return [...index.elementsById.values()].find((element) => element.ref.kind === 'macro' && element.ref.id === ref.id) || null;
}

export function resolveRouteGraphConnectionEndpoint(
  index: RouteGraphSemanticIndex,
  ref: RouteGraphWorkspaceConnectionEndpointRef,
): ResolvedRouteGraphConnectionEndpoint {
  const element = elementForRef(index, ref.element);
  if (!element) throw new RouteGraphConnectionValidationError('element_not_found');
  const port = element.node
    ? getRouteGraphNodePort(element.node, ref.portId)
    : getRouteGraphMacroPort(element.macro, ref.portId);
  if (!port) throw new RouteGraphConnectionValidationError('port_not_found');
  return {
    ref,
    graphElementId: element.elementId,
    node: element.node,
    macro: element.macro,
    port,
  };
}

function edgeKindForPort(port: RouteGraphPort): RouteGraphEdgeKind {
  if (port.kind === 'bidirect') return 'bidirect_flow';
  if (port.kind === 'route') return 'route_flow';
  return 'request_flow';
}

function appendAdjacent(map: Map<string, string[]>, from: string, to: string): void {
  const values = map.get(from);
  if (values) values.push(to);
  else map.set(from, [to]);
}

function reachableElements(adjacency: ReadonlyMap<string, readonly string[]>, start: string): Set<string> {
  const pending = [start];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(adjacency.get(current) || []));
  }
  return visited;
}

function endpointKey(elementId: string, portId: string): string {
  return `${elementId}\u0000${portId}`;
}

function connectionKey(sourceElementId: string, sourcePortId: string, targetElementId: string, targetPortId: string): string {
  return `${endpointKey(sourceElementId, sourcePortId)}\u0000${endpointKey(targetElementId, targetPortId)}`;
}

function buildConnectionIndexes(edges: readonly RouteGraphEdge[], ignoredEdgeId?: string): {
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
  incomingCounts: Map<string, number>;
  connections: Set<string>;
} {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const incomingCounts = new Map<string, number>();
  const connections = new Set<string>();
  for (const edge of edges) {
    if (edge.id === ignoredEdgeId) continue;
    appendAdjacent(outgoing, edge.sourceNodeId, edge.targetNodeId);
    appendAdjacent(incoming, edge.targetNodeId, edge.sourceNodeId);
    const targetKey = endpointKey(edge.targetNodeId, edge.targetPortId);
    incomingCounts.set(targetKey, (incomingCounts.get(targetKey) || 0) + 1);
    connections.add(connectionKey(edge.sourceNodeId, edge.sourcePortId, edge.targetNodeId, edge.targetPortId));
  }
  return { outgoing, incoming, incomingCounts, connections };
}

export function validateRouteGraphConnectionAgainstSource(input: {
  graph: RouteGraphSource;
  first: RouteGraphWorkspaceConnectionEndpointRef;
  second: RouteGraphWorkspaceConnectionEndpointRef;
  replacingEdgeId?: string;
  semanticIndex?: RouteGraphSemanticIndex;
}): ValidatedRouteGraphConnection {
  const index = input.semanticIndex || buildRouteGraphSemanticIndex(input.graph);
  const second = resolveRouteGraphConnectionEndpoint(index, input.second);
  return createRouteGraphConnectionValidationSession({
    graph: input.graph,
    first: input.first,
    replacingEdgeId: input.replacingEdgeId,
    semanticIndex: index,
  }).validate(second);
}

export function createRouteGraphConnectionValidationSession(input: {
  graph: RouteGraphSource;
  first: RouteGraphWorkspaceConnectionEndpointRef;
  replacingEdgeId?: string;
  semanticIndex?: RouteGraphSemanticIndex;
}): RouteGraphConnectionValidationSession {
  const index = input.semanticIndex || buildRouteGraphSemanticIndex(input.graph);
  const first = resolveRouteGraphConnectionEndpoint(index, input.first);
  const connectionIndexes = buildConnectionIndexes(input.graph.edges, input.replacingEdgeId);
  const cycleElements = first.port.direction === 'output'
    ? reachableElements(connectionIndexes.incoming, first.graphElementId)
    : reachableElements(connectionIndexes.outgoing, first.graphElementId);

  const validate = (second: ResolvedRouteGraphConnectionEndpoint): ValidatedRouteGraphConnection => {
    if (first.graphElementId === second.graphElementId) throw new RouteGraphConnectionValidationError('same_element');
    const source = first.port.direction === 'output' ? first : second;
    const target = source === first ? second : first;
    if (source.port.direction !== 'output') throw new RouteGraphConnectionValidationError('source_not_output');
    if (target.port.direction !== 'input') throw new RouteGraphConnectionValidationError('target_not_input');
    if (source.port.enabled === false || target.port.enabled === false) throw new RouteGraphConnectionValidationError('port_disabled');
    if (!canAttachManualRouteGraphEdge(source.port) || !canAttachManualRouteGraphEdge(target.port)) {
      throw new RouteGraphConnectionValidationError('manual_edge_denied');
    }
    if (source.port.kind !== target.port.kind) throw new RouteGraphConnectionValidationError('port_kind_mismatch');

    if (connectionIndexes.connections.has(connectionKey(
      source.graphElementId,
      source.port.id,
      target.graphElementId,
      target.port.id,
    ))) throw new RouteGraphConnectionValidationError('duplicate_connection');
    const incomingCount = connectionIndexes.incomingCounts.get(endpointKey(target.graphElementId, target.port.id)) || 0;
    if (incomingCount >= getRouteGraphPortConnectionBounds(target.port).max) {
      throw new RouteGraphConnectionValidationError('input_capacity_exceeded');
    }
    const cycle = first.port.direction === 'output'
      ? cycleElements.has(target.graphElementId)
      : cycleElements.has(source.graphElementId);
    if (cycle) {
      throw new RouteGraphConnectionValidationError('cycle');
    }
    return { source, target, edgeKind: edgeKindForPort(source.port) };
  };

  return { first, validate };
}

export function validateRouteGraphEdgeMutation(
  graph: RouteGraphSource,
  edge: RouteGraphEdge,
): ValidatedRouteGraphConnection {
  const index = buildRouteGraphSemanticIndex(graph);
  const sourceElement = index.elementsById.get(edge.sourceNodeId);
  const targetElement = index.elementsById.get(edge.targetNodeId);
  if (!sourceElement || !targetElement) throw new RouteGraphConnectionValidationError('element_not_found');
  const validated = validateRouteGraphConnectionAgainstSource({
    graph,
    first: { element: sourceElement.ref, portId: edge.sourcePortId },
    second: { element: targetElement.ref, portId: edge.targetPortId },
    replacingEdgeId: edge.id,
    semanticIndex: index,
  });
  if (validated.edgeKind !== edge.kind) throw new RouteGraphConnectionValidationError('edge_kind_mismatch');
  return validated;
}
