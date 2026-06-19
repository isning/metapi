import { getRouteGraphMacroPort } from '../../../shared/routeGraph.js';
import { getNodePorts } from './routeGraphRegistry.js';
import type {
  RouteGraphEdge,
  RouteGraphEdgeKind,
  RouteGraphMacro,
  RouteGraphNode,
  RouteGraphPort,
  RouteGraphPortKind,
} from './routeGraphTypes.js';

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
  if (kind === 'response') return 'response_flow';
  if (kind === 'control') return 'control_flow';
  if (kind === 'metrics') return 'metrics_link';
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
    return { ok: false, message: '连接必须从具体接口连接到具体接口' };
  }
  if (connection.source === connection.target) return { ok: false, message: '不能连接到同一个节点' };
  const sourceNode = getFlowNodeById(graph, connection.source);
  const targetNode = getFlowNodeById(graph, connection.target);
  if (!sourceNode || !targetNode) return { ok: false, message: '节点不存在' };
  const sourcePort = isRouteGraphMacroItem(sourceNode) ? getMacroPort(sourceNode, connection.sourceHandle) : getNodePort(sourceNode, connection.sourceHandle);
  const targetPort = isRouteGraphMacroItem(targetNode) ? getMacroPort(targetNode, connection.targetHandle) : getNodePort(targetNode, connection.targetHandle);
  if (!sourcePort || !targetPort) return { ok: false, message: '接口不存在' };
  if (sourceNode.ownership !== 'manual' && !isRouteGraphMacroItem(sourceNode)) return { ok: false, message: '非 manual 节点不能新增出边' };
  if (sourceNode.ownership !== 'manual' && isRouteGraphMacroItem(sourceNode) && sourcePort.direction !== 'output') {
    return { ok: false, message: '非 manual macro 只允许从输出接口复用' };
  }
  if (!isPortEnabled(sourcePort) || !isPortEnabled(targetPort)) return { ok: false, message: '禁用接口不能连接' };
  if (sourcePort.direction !== 'output') return { ok: false, message: '起点必须是输出接口' };
  if (targetPort.direction !== 'input') return { ok: false, message: '终点必须是输入接口' };
  const accepts = targetPort.accepts || [targetPort.kind];
  if (!accepts.includes(sourcePort.kind)) return { ok: false, message: `${sourcePort.kind} 不能连接到 ${targetPort.kind}` };
  if (targetPort.multiple === false && graph.edges.some((edge) => edge.targetNodeId === connection.target && edge.targetPortId === targetPort.id)) {
    return { ok: false, message: '该输入接口已连接' };
  }
  if (graph.edges.some((edge) => (
    edge.sourceNodeId === connection.source
    && edge.sourcePortId === sourcePort.id
    && edge.targetNodeId === connection.target
    && edge.targetPortId === targetPort.id
  ))) {
    return { ok: false, message: '重复连接' };
  }
  if (hasPath(graph.edges, targetNode.id, sourceNode.id)) return { ok: false, message: '不能创建环路' };
  return { ok: true, kind: edgeKindForPort(sourcePort.kind) };
}
