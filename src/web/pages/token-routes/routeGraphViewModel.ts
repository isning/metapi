import { tr } from '../../i18n.js';
import type { RouteGraphEdge, RouteGraphMacro, RouteGraphNode, RouteGraphOwnership, RouteGraphPort } from './routeGraphTypes.js';

export type RouteGraphLike = { nodes: RouteGraphNode[]; edges: RouteGraphEdge[]; macros?: RouteGraphMacro[] };

const label = (key: string, fallback: string) => {
  const translated = tr(key);
  return translated === key ? fallback : translated;
};

export function getOwnershipLabel(value: RouteGraphOwnership): string {
  return label(`pages.tokenRoutes.routeGraphViewModel.ownership.${value}`, value.replace('_', ' '));
}
export function getNodeTypeLabel(value: RouteGraphNode['type']): string {
  return label(`pages.tokenRoutes.routeGraphViewModel.nodeType.${value}`, value.replace('_', ' '));
}
export function getEndpointKindLabel(value: unknown): string { return String(value || 'supply').replace('_', ' '); }
export function getEndpointResolutionStatusLabel(value: unknown): string { return String(value || 'unresolved').replace('_', ' '); }
export function getEndpointSourceKindLabel(value: unknown): string { return String(value || 'inline').replace('_', ' '); }
export function getEndpointExposureLabel(value: unknown): string { return String(value || 'none'); }
export function getNodeCardSubtitle(node: RouteGraphNode): string {
  if (node.type === 'entry') return node.match.displayName || node.match.requestedModelPattern || node.id;
  if (node.type === 'route_endpoint') {
    const targets = (node.config as { targets?: unknown } | undefined)?.targets;
    const count = Array.isArray(targets) ? targets.length : 0;
    return count === 1 ? '1 target' : `${count} targets`;
  }
  if (node.type === 'filter') return `${node.operations.length} operations`;
  if (node.type === 'dispatcher') return node.mode;
  if (node.type === 'synthetic_endpoint') return String(node.statusCode);
  return '';
}
export function getNodeCardMetrics(graph: RouteGraphLike, node: RouteGraphNode): string[] {
  return [`${graph.edges.filter((edge) => edge.sourceNodeId === node.id || edge.targetNodeId === node.id).length} connections`];
}
export function getPortSummary(port: RouteGraphPort): string {
  const policy = port.manualEdgePolicy === 'allow'
    ? label('pages.tokenRoutes.routeGraphWorkspace.manualEdgeAllowed', 'manual edge allowed')
    : label('pages.tokenRoutes.routeGraphWorkspace.manualEdgeDenied', 'manual edge denied');
  return `${port.direction} · ${port.kind} · ${policy}`;
}
