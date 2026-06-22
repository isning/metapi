import { getNodePorts } from './routeGraphRegistry.js';
import type { RouteGraphEdge, RouteGraphNode, RouteGraphPort } from './routeGraphTypes.js';

export type RouteGraphLike = {
  nodes: RouteGraphNode[];
  edges: RouteGraphEdge[];
};

export function getNodeTitle(node: RouteGraphNode): string {
  return String(node.name || node.id);
}

export function getNodeStatusLabel(node: RouteGraphNode): 'enabled' | 'disabled' {
  return node.enabled ? 'enabled' : 'disabled';
}

export function getNodeCardSubtitle(node: RouteGraphNode): string {
  if (node.type === 'entry') {
    const match = (node.match || {}) as Record<string, unknown>;
    return String(match.displayName || match.requestedModelPattern || 'public model entry');
  }
  if (node.type === 'dispatcher') return `${String(node.mode || 'route')} dispatcher`;
  if (node.type === 'route_endpoint') {
    const kind = String(node.endpointKind || 'route_product');
    const exposure = String(node.exposure || (kind === 'supply' ? 'none' : node.visibility));
    return `${kind.replace('_', ' ')} · ${exposure}`;
  }
  if (node.type === 'filter') {
    const count = Array.isArray(node.operations) ? node.operations.length : 0;
    return count === 1 ? '1 operation' : `${count} operations`;
  }
  if (node.type === 'model_endpoint') {
    const config = (node.config || {}) as { targets?: unknown[] };
    const count = Array.isArray(config.targets) ? config.targets.length : 0;
    return count === 1 ? '1 model target' : `${count} model targets`;
  }
  if (node.type === 'synthetic_endpoint') return `${String(node.statusCode || 503)} synthetic response`;
  return node.ownership === 'manual' ? 'manual node' : `${node.ownership} node`;
}

export function getNodeCardMetrics(graph: RouteGraphLike, node: RouteGraphNode): string[] {
  const metrics: string[] = [];
  const connectionCount = getNodeConnectionCount(graph, node.id);
  metrics.push(connectionCount === 1 ? '1 connection' : `${connectionCount} connections`);
  if (typeof node.successRate === 'number') metrics.push(`${Math.round(node.successRate * 100)}% success`);
  if (node.type === 'dispatcher') metrics.push(String(node.policy && typeof node.policy === 'object' && 'strategy' in node.policy ? (node.policy as any).strategy : 'weighted'));
  return metrics;
}

export function getNodeSubtitle(node: RouteGraphNode): string {
  return node.id;
}

export function getNodeModeLabel(node: RouteGraphNode): string {
  return node.type === 'dispatcher' ? String(node.mode || 'route') : 'n/a';
}

export function getPublicEntryCount(graph: RouteGraphLike): number {
  return getPublicEntryNodes(graph).length;
}

export function getPublicEntryNodes(graph: RouteGraphLike): RouteGraphNode[] {
  return graph.nodes.filter((node) => node.type === 'entry' && node.visibility === 'public');
}

export function getManualNodeCount(graph: RouteGraphLike): number {
  return graph.nodes.filter((node) => node.ownership === 'manual').length;
}

export function getNodeConnectionCount(graph: RouteGraphLike, nodeId: string): number {
  return graph.edges.filter((edge) => edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId).length;
}

export function getPortConnectionCount(graph: RouteGraphLike, nodeId: string, portId: string): number {
  return graph.edges.filter((edge) => (
    (edge.sourceNodeId === nodeId && edge.sourcePortId === portId)
    || (edge.targetNodeId === nodeId && edge.targetPortId === portId)
  )).length;
}

export function getPortSummary(port: RouteGraphPort): string {
  return `${port.direction} · ${port.kind}${port.required ? ' · required' : ''}`;
}

export function pluralizePortLabel(label: string): string {
  if (label.endsWith('s')) return label;
  if (label === 'request fallback') return 'request fallbacks';
  if (label === 'response') return 'responses';
  if (label === 'route') return 'routes';
  if (label === 'request') return 'requests';
  if (label === 'error') return 'errors';
  if (label === 'matched flow') return 'matched flows';
  if (label === 'dispatch path') return 'dispatch paths';
  if (label === 'endpoint target') return 'endpoint targets';
  if (label === 'synthetic target') return 'synthetic targets';
  if (label === 'selected path') return 'selected paths';
  return `${label}s`;
}

export function getPortDisplayLabel(port: RouteGraphPort): string {
  return port.direction === 'input' ? port.label : pluralizePortLabel(port.label);
}

export function getPortCollectionKind(port: RouteGraphPort): 'single' | 'arr' | 'set' {
  return port.collection?.type || 'single';
}

export function getPortTypeSignature(port: RouteGraphPort): string {
  const collection = port.collection;
  if (!collection || collection.type === 'single') return port.kind;
  const open = collection.type === 'set' ? '{' : '[';
  const close = collection.type === 'set' ? '}' : ']';
  const min = typeof collection.min === 'number' ? String(collection.min) : '';
  const max = typeof collection.max === 'number' ? String(collection.max) : '';
  if (!min && !max) return `${port.kind}${open}${close}`;
  return `${port.kind}${open}${min},${max}${close}`;
}

export function getPortModeNote(node: RouteGraphNode, port: RouteGraphPort): string | null {
  if (node.type !== 'dispatcher') return null;
  if (port.id === 'route.in' && node.mode === 'flow') return 'Ignored in flow mode';
  if (port.id === 'bidirect[1...].out' && node.mode !== 'flow') return 'Ignored in route mode';
  return null;
}

export function getNodePortsPreview(node: RouteGraphNode, limit = 5): RouteGraphPort[] {
  return getNodePorts(node).slice(0, limit);
}

export function getNodeConnections(graph: RouteGraphLike, nodeId: string): Array<{ edge: RouteGraphEdge; direction: 'inbound' | 'outbound'; peerNodeId: string }> {
  const connections: Array<{ edge: RouteGraphEdge; direction: 'inbound' | 'outbound'; peerNodeId: string }> = [];
  for (const edge of graph.edges) {
    if (edge.sourceNodeId === nodeId) connections.push({ edge, direction: 'outbound', peerNodeId: edge.targetNodeId });
    if (edge.targetNodeId === nodeId) connections.push({ edge, direction: 'inbound', peerNodeId: edge.sourceNodeId });
  }
  return connections;
}

export function getNodeInspectorFacts(graph: RouteGraphLike, node: RouteGraphNode): Array<{ label: string; value: string | number }> {
  return [
    { label: 'Selected', value: node.id },
    { label: 'Type', value: node.type },
    { label: 'Mode', value: getNodeModeLabel(node) },
    { label: 'Connections', value: getNodeConnectionCount(graph, node.id) },
  ];
}

export function getGraphFacts(graph: RouteGraphLike): Array<{ label: string; value: string | number }> {
  return [
    { label: 'Nodes', value: graph.nodes.length },
    { label: 'Edges', value: graph.edges.length },
    { label: 'Public', value: getPublicEntryCount(graph) },
    { label: 'Manual', value: getManualNodeCount(graph) },
  ];
}

export function getModelListSubtitle(node: RouteGraphNode): string {
  return `${getNodeStatusLabel(node)} · ${node.ownership}`;
}

export function getOutlineSubtitle(node: RouteGraphNode): string {
  return `${node.type} · ${node.visibility} · ${node.ownership}`;
}
