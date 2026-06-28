import { getRouteGraphMacroPort, getRouteGraphPortConnectionBounds } from '../../../shared/routeGraph.js';
import { getNodePorts } from './routeGraphRegistry.js';
import type {
  RouteGraphEdge,
  RouteGraphEdgeKind,
  RouteGraphMacro,
  RouteGraphNode,
  RouteGraphPort,
  RouteGraphPortKind,
} from './routeGraphTypes.js';

import { tr } from '../../i18n.js';
export type RouteGraphConnectionGraph = {
  nodes: RouteGraphNode[];
  edges: RouteGraphEdge[];
  macros?: RouteGraphMacro[];
};

export type RouteGraphConnection = {
  source?: string | null;
  sourceHandle?: string | null;
  target?: string | null;
  targetHandle?: string | null;
};

export function macroFlowNodeId(macroId: string): string {
  return `macro:${macroId}`;
}

function getNodePort(node: RouteGraphNode | null, portId?: string | null): RouteGraphPort | null {
  if (!node || !portId) return null;
  return getNodePorts(node).find((port) => port.id === portId) || null;
}

function getMacroPort(macro: RouteGraphMacro | null, portId?: string | null): RouteGraphPort | null {
  if (!macro || !portId) return null;
  return getRouteGraphMacroPort(macro, portId) as RouteGraphPort | null;
}

function getFlowNodeById(graph: RouteGraphConnectionGraph, nodeId: string): RouteGraphNode | RouteGraphMacro | null {
  return graph.nodes.find((node) => node.id === nodeId)
    || (graph.macros || []).find((macro) => macroFlowNodeId(macro.id) === nodeId)
    || null;
}

function isRouteGraphMacroItem(item: RouteGraphNode | RouteGraphMacro | null): item is RouteGraphMacro {
  return !!item && typeof item === 'object' && typeof (item as RouteGraphMacro).kind === 'string' && 'config' in item && !('type' in item);
}

function isPortEnabled(port: RouteGraphPort | null | undefined): boolean {
  return port?.enabled !== false;
}

function edgeKindForPort(kind: RouteGraphPortKind): RouteGraphEdgeKind {
  if (kind === 'bidirect') return 'bidirect_flow';
  if (kind === 'route') return 'route_flow';
  return 'request_flow';
}

function hasPath(edges: RouteGraphEdge[], start: string, target: string): boolean {
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    if (!next.has(edge.sourceNodeId)) next.set(edge.sourceNodeId, []);
    next.get(edge.sourceNodeId)!.push(edge.targetNodeId);
  }
  const stack = [start];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    if (nodeId === target) return true;
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    stack.push(...(next.get(nodeId) || []));
  }
  return false;
}

export function validateRouteGraphConnection(
  graph: RouteGraphConnectionGraph,
  connection: RouteGraphConnection,
): { ok: true; kind: RouteGraphEdgeKind } | { ok: false; message: string } {
  if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
    return { ok: false, message: tr('pages.tokenRoutes.routeGraphConnections.connectionsMustGoFromSpecificPortSpecific') };
  }
  if (connection.source === connection.target) return { ok: false, message: tr('pages.tokenRoutes.routeGraphConnections.cannotConnectSameNode') };
  const sourceNode = getFlowNodeById(graph, connection.source);
  const targetNode = getFlowNodeById(graph, connection.target);
  if (!sourceNode || !targetNode) return { ok: false, message: tr('pages.tokenRoutes.routeGraphConnections.nodeDoesNotExist') };
  const sourcePort = isRouteGraphMacroItem(sourceNode) ? getMacroPort(sourceNode, connection.sourceHandle) : getNodePort(sourceNode, connection.sourceHandle);
  const targetPort = isRouteGraphMacroItem(targetNode) ? getMacroPort(targetNode, connection.targetHandle) : getNodePort(targetNode, connection.targetHandle);
  if (!sourcePort || !targetPort) return { ok: false, message: tr('pages.tokenRoutes.routeGraphConnections.portDoesNotExist') };
  if (sourceNode.ownership !== 'manual' && !isRouteGraphMacroItem(sourceNode)) return { ok: false, message: tr('pages.tokenRoutes.routeGraphConnections.manual') };
  if (sourceNode.ownership !== 'manual' && isRouteGraphMacroItem(sourceNode) && sourcePort.direction !== 'output') {
    return { ok: false, message: tr('pages.tokenRoutes.routeGraphConnections.manualMacroOutput') };
  }
  if (targetNode.ownership !== 'manual' && isRouteGraphMacroItem(targetNode)) {
    return { ok: false, message: tr('pages.tokenRoutes.routeGraphConnections.manualMacroOutput') };
  }
  if (!isPortEnabled(sourcePort) || !isPortEnabled(targetPort)) return { ok: false, message: tr('pages.tokenRoutes.routeGraphConnections.disabled') };
  if (sourcePort.direction !== 'output') return { ok: false, message: tr('pages.tokenRoutes.routeGraphConnections.sourceMustOutputPort') };
  if (targetPort.direction !== 'input') return { ok: false, message: tr('pages.tokenRoutes.routeGraphConnections.targetMustInputPort') };
  if (sourcePort.kind !== targetPort.kind) {
    return {
      ok: false,
      message: tr('pages.tokenRoutes.routeGraphConnections.portKindCannotConnect')
        .replace('{source}', sourcePort.kind)
        .replace('{target}', targetPort.kind),
    };
  }
  if (graph.edges.some((edge) => (
    edge.sourceNodeId === connection.source
    && edge.sourcePortId === sourcePort.id
    && edge.targetNodeId === connection.target
    && edge.targetPortId === targetPort.id
  ))) {
    return { ok: false, message: tr('pages.tokenRoutes.routeGraphConnections.duplicateConnection') };
  }
  const incomingCount = graph.edges.filter((edge) => edge.targetNodeId === connection.target && edge.targetPortId === targetPort.id).length;
  const bounds = getRouteGraphPortConnectionBounds(targetPort);
  if (incomingCount >= bounds.max) {
    if (!bounds.collection) return { ok: false, message: tr('pages.tokenRoutes.routeGraphConnections.inputPortAlreadyConnected') };
    return {
      ok: false,
      message: tr('pages.tokenRoutes.routeGraphConnections.inputPortMaxConnections')
        .replace('{max}', String(bounds.max)),
    };
  }
  if (hasPath(graph.edges, targetNode.id, sourceNode.id)) return { ok: false, message: tr('pages.tokenRoutes.routeGraphConnections.cannotCreateCycle') };
  return { ok: true, kind: edgeKindForPort(sourcePort.kind) };
}
