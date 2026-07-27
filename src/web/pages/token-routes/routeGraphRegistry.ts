import type {
  RouteGraphEdgeKind,
  RouteGraphNode,
  RouteGraphNodeType,
  RouteGraphPortKind,
} from './routeGraphTypes.js';
import { tr } from '../../i18n.js';

type NodeDefinition = {
  titleKey: string;
  detailKey: string;
  kickerKey: string;
  accent: string;
  primitive: boolean;
  createDefaultNode: (index: number, position?: { x: number; y: number }) => Omit<RouteGraphNode, 'id'>;
};

function baseNode(type: RouteGraphNodeType, index: number, position?: { x: number; y: number }): Omit<RouteGraphNode, 'id'> {
  return {
    type,
    name: type.replace('_', ' '),
    enabled: true,
    ownership: 'manual',
    position: position || { x: 120 + (index % 3) * 300, y: 120 + Math.floor(index / 3) * 180 },
    provenance: { source: 'manual' },
  } as Omit<RouteGraphNode, 'id'>;
}

export function makeNodeDraft(type: RouteGraphNodeType, index: number, position?: { x: number; y: number }): Omit<RouteGraphNode, 'id'> {
  return routeGraphNodeDefinitions[type].createDefaultNode(index, position);
}

export const routeGraphNodeDefinitions = {
  entry: {
    kickerKey: 'pages.tokenRoutes.routeGraphRegistry.node.entry.kicker',
    titleKey: 'pages.tokenRoutes.routeGraphRegistry.node.entry.title',
    detailKey: 'pages.tokenRoutes.routeGraphRegistry.node.entry.detail',
    accent: '#2563eb',
    primitive: true,
    createDefaultNode: (index, position) => ({
      ...baseNode('entry', index, position),
      match: { kind: 'model', requestedModelPattern: '', currentModelPattern: '', displayName: null },
    }),
  },
  filter: {
    kickerKey: 'pages.tokenRoutes.routeGraphRegistry.node.filter.kicker',
    titleKey: 'pages.tokenRoutes.routeGraphRegistry.node.filter.title',
    detailKey: 'pages.tokenRoutes.routeGraphRegistry.node.filter.detail',
    accent: '#7c3aed',
    primitive: true,
    createDefaultNode: (index, position) => ({ ...baseNode('filter', index, position), operations: [] } as Omit<RouteGraphNode, 'id'>),
  },
  dispatcher: {
    kickerKey: 'pages.tokenRoutes.routeGraphRegistry.node.dispatcher.kicker',
    titleKey: 'pages.tokenRoutes.routeGraphRegistry.node.dispatcher.title',
    detailKey: 'pages.tokenRoutes.routeGraphRegistry.node.dispatcher.detail',
    accent: '#2563eb',
    primitive: true,
    createDefaultNode: (index, position) => ({ ...baseNode('dispatcher', index, position), mode: 'route', ordering: 'explicit', policy: { kind: 'inherit_default' } } as Omit<RouteGraphNode, 'id'>),
  },
  route_endpoint: {
    kickerKey: 'pages.tokenRoutes.routeGraphRegistry.node.routeEndpoint.kicker',
    titleKey: 'pages.tokenRoutes.routeGraphRegistry.node.routeEndpoint.title',
    detailKey: 'pages.tokenRoutes.routeGraphRegistry.node.routeEndpoint.detail',
    accent: '#16a34a',
    primitive: true,
    createDefaultNode: (index, position) => {
      const node = baseNode('route_endpoint', index, position);
      return {
        ...node,
        routeEndpointId: '',
        endpointKind: 'supply',
        exposure: 'none',
        resolutionStatus: 'resolved',
        ownerKind: 'manual',
        sourceKind: 'upstream_model',
        backend: { kind: 'supply' },
        metadata: {},
        config: { targets: [], targetSelection: { kind: 'defer_to_router' } },
      } as Omit<RouteGraphNode, 'id'>;
    },
  },
  synthetic_endpoint: {
    kickerKey: 'pages.tokenRoutes.routeGraphRegistry.node.syntheticEndpoint.kicker',
    titleKey: 'pages.tokenRoutes.routeGraphRegistry.node.syntheticEndpoint.title',
    detailKey: 'pages.tokenRoutes.routeGraphRegistry.node.syntheticEndpoint.detail',
    accent: '#dc2626',
    primitive: true,
    createDefaultNode: (index, position) => ({ ...baseNode('synthetic_endpoint', index, position), statusCode: 503, message: 'Route unavailable' } as Omit<RouteGraphNode, 'id'>),
  },
} satisfies Record<RouteGraphNodeType, NodeDefinition>;

export const NODE_TYPES = (Object.keys(routeGraphNodeDefinitions) as RouteGraphNodeType[])
  .filter((type) => routeGraphNodeDefinitions[type].primitive);

export const ROUTE_GRAPH_NODE_TYPES = Object.keys(routeGraphNodeDefinitions) as RouteGraphNodeType[];

export const ROUTE_GRAPH_VISUAL_COLORS = {
  node: Object.fromEntries(
    (Object.keys(routeGraphNodeDefinitions) as RouteGraphNodeType[]).map((type) => [type, routeGraphNodeDefinitions[type].accent]),
  ) as Record<RouteGraphNodeType, string>,
  port: {
    request: '#2563eb',
    bidirect: '#2563eb',
    route: '#16a34a',
  } satisfies Record<RouteGraphPortKind, string>,
  edge: {
    request_flow: '#2563eb',
    bidirect_flow: '#2563eb',
    route_flow: '#16a34a',
  } satisfies Record<RouteGraphEdgeKind, string>,
  macro: {
    candidate_selector: '#9333ea',
  } satisfies Record<string, string>,
} as const;

export function getNodeDefinitionTitle(type: RouteGraphNodeType): string {
  return tr(routeGraphNodeDefinitions[type].titleKey);
}

export function getNodeDefinitionDetail(type: RouteGraphNodeType): string {
  return tr(routeGraphNodeDefinitions[type].detailKey);
}

export function getNodeDefinitionKicker(type: RouteGraphNodeType): string {
  return tr(routeGraphNodeDefinitions[type].kickerKey);
}
