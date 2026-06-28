import type {
  AddTemplate,
  RouteFilter,
  RouteGraphEdgeKind,
  RouteGraphNode,
  RouteGraphNodeType,
  RouteGraphPort,
  RouteGraphPortKind,
} from './routeGraphTypes.js';
import { tr } from '../../i18n.js';

type NodeDefinition = {
  titleKey: string;
  detailKey: string;
  kickerKey: string;
  accent: string;
  primitive: boolean;
  defaultPorts: RouteGraphPort[];
  createDefaultNode: (index: number, position?: { x: number; y: number }) => RouteGraphNode;
};

const templateCategoryAccent = {
  Core: '#2563eb',
  Transform: '#7c3aed',
  Synthetic: '#dc2626',
} satisfies Record<AddTemplate['category'], string>;

function baseNode(type: RouteGraphNodeType, index: number, position?: { x: number; y: number }): RouteGraphNode {
  const id = `${type}:${Date.now()}:${index}`;
  return {
    id,
    type,
    name: type.replace('_', ' '),
    enabled: true,
    visibility: type === 'entry' ? 'public' : 'internal',
    ownership: 'manual',
    position: position || { x: 120 + (index % 3) * 300, y: 120 + Math.floor(index / 3) * 180 },
    provenance: { source: 'manual' },
  };
}

export function makeNode(type: RouteGraphNodeType, index: number, position?: { x: number; y: number }): RouteGraphNode {
  return routeGraphNodeDefinitions[type]?.createDefaultNode(index, position)
    || { ...baseNode('auto_node', index, position), routeNodeId: `auto_node:${Date.now()}:${index}`, routingStrategy: 'weighted' };
}

function makeFilterNode(
  index: number,
  input: {
    idPrefix: string;
    name: string;
    operations: RouteFilter[];
    position?: { x: number; y: number };
  },
): RouteGraphNode {
  const node = makeNode('filter', index, input.position);
  return {
    ...node,
    id: `filter:${input.idPrefix}:${Date.now()}:${index}`,
    name: input.name,
    operations: input.operations,
  };
}

export const routeGraphNodeDefinitions = {
  entry: {
    kickerKey: 'pages.tokenRoutes.routeGraphRegistry.node.entry.kicker',
    titleKey: 'pages.tokenRoutes.routeGraphRegistry.node.entry.title',
    detailKey: 'pages.tokenRoutes.routeGraphRegistry.node.entry.detail',
    accent: '#2563eb',
    primitive: true,
    defaultPorts: [
      { id: 'bidirect.in', label: 'reuse input', direction: 'input', kind: 'bidirect' },
      { id: 'bidirect.out', label: 'matched flow', direction: 'output', kind: 'bidirect' },
    ],
    createDefaultNode: (index, position) => ({
      ...baseNode('entry', index, position),
      match: { kind: 'model', requestedModelPattern: '', currentModelPattern: '', displayName: null },
      selectionStrategy: 'weighted',
    }),
  },
  filter: {
    kickerKey: 'pages.tokenRoutes.routeGraphRegistry.node.filter.kicker',
    titleKey: 'pages.tokenRoutes.routeGraphRegistry.node.filter.title',
    detailKey: 'pages.tokenRoutes.routeGraphRegistry.node.filter.detail',
    accent: '#7c3aed',
    primitive: true,
    defaultPorts: [
      { id: 'request.in', label: 'before mutation', direction: 'input', kind: 'request' },
      { id: 'request.out', label: 'after mutation', direction: 'output', kind: 'request' },
      { id: 'bidirect.in', label: 'before round trip', direction: 'input', kind: 'bidirect' },
      { id: 'bidirect.out', label: 'after round trip', direction: 'output', kind: 'bidirect' },
    ],
    createDefaultNode: (index, position) => ({ ...baseNode('filter', index, position), operations: [] }),
  },
  dispatcher: {
    kickerKey: 'pages.tokenRoutes.routeGraphRegistry.node.dispatcher.kicker',
    titleKey: 'pages.tokenRoutes.routeGraphRegistry.node.dispatcher.title',
    detailKey: 'pages.tokenRoutes.routeGraphRegistry.node.dispatcher.detail',
    accent: '#2563eb',
    primitive: true,
    defaultPorts: [
      { id: 'bidirect.in', label: 'dispatch input', direction: 'input', kind: 'bidirect', required: true },
      { id: 'bidirect[1...].out', label: 'dispatch path', direction: 'output', kind: 'bidirect', multiple: true, collection: { type: 'arr', min: 1 } },
      { id: 'route.in', label: 'endpoint candidates', direction: 'input', kind: 'route', multiple: true, collection: { type: 'set', min: 1 } },
    ],
    createDefaultNode: (index, position) => ({ ...baseNode('dispatcher', index, position), mode: 'route', ordering: 'explicit', policy: { strategy: 'weighted' } }),
  },
  route_endpoint: {
    kickerKey: 'pages.tokenRoutes.routeGraphRegistry.node.routeEndpoint.kicker',
    titleKey: 'pages.tokenRoutes.routeGraphRegistry.node.routeEndpoint.title',
    detailKey: 'pages.tokenRoutes.routeGraphRegistry.node.routeEndpoint.detail',
    accent: '#16a34a',
    primitive: true,
    defaultPorts: [
      { id: 'route.out', label: 'route product', direction: 'output', kind: 'route' },
      { id: 'bidirect.in', label: 'invoke route', direction: 'input', kind: 'bidirect', multiple: true },
    ],
    createDefaultNode: (index, position) => {
      const node = baseNode('route_endpoint', index, position);
      return {
        ...node,
        endpointKind: 'supply',
        exposure: 'none',
        resolutionStatus: 'resolved',
        ownerKind: 'manual_route',
        sourceKind: 'upstream_model',
        metadata: {},
        config: { targets: [{ targetId: node.id, model: node.id }], targetSelection: { strategy: 'weighted' } },
      };
    },
  },
  synthetic_endpoint: {
    kickerKey: 'pages.tokenRoutes.routeGraphRegistry.node.syntheticEndpoint.kicker',
    titleKey: 'pages.tokenRoutes.routeGraphRegistry.node.syntheticEndpoint.title',
    detailKey: 'pages.tokenRoutes.routeGraphRegistry.node.syntheticEndpoint.detail',
    accent: '#dc2626',
    primitive: true,
    defaultPorts: [
      { id: 'route.out', label: 'synthetic target', direction: 'output', kind: 'route' },
      { id: 'bidirect.in', label: 'return response', direction: 'input', kind: 'bidirect' },
    ],
    createDefaultNode: (index, position) => ({ ...baseNode('synthetic_endpoint', index, position), statusCode: 503, message: 'Route unavailable' }),
  },
  auto_node: {
    kickerKey: 'pages.tokenRoutes.routeGraphRegistry.node.autoNode.kicker',
    titleKey: 'pages.tokenRoutes.routeGraphRegistry.node.autoNode.title',
    detailKey: 'pages.tokenRoutes.routeGraphRegistry.node.autoNode.detail',
    accent: '#64748b',
    primitive: false,
    defaultPorts: [
      { id: 'route.in', label: 'candidate targets', direction: 'input', kind: 'route', multiple: true, collection: { type: 'set' } },
      { id: 'bidirect.in', label: 'route input', direction: 'input', kind: 'bidirect' },
      { id: 'bidirect.out', label: 'selected path', direction: 'output', kind: 'bidirect' },
    ],
    createDefaultNode: (index, position) => {
      const node = baseNode('auto_node', index, position);
      return { ...node, routeNodeId: node.id, routingStrategy: 'weighted' };
    },
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
  templateCategory: templateCategoryAccent,
} as const;

export function templateAccent(template: AddTemplate): string {
  if (template.primitiveType) return routeGraphNodeDefinitions[template.primitiveType].accent;
  return templateCategoryAccent[template.category];
}

export function getNodeDefinitionTitle(type: RouteGraphNodeType): string {
  return tr(routeGraphNodeDefinitions[type].titleKey);
}

export function getNodeDefinitionDetail(type: RouteGraphNodeType): string {
  return tr(routeGraphNodeDefinitions[type].detailKey);
}

export function getNodeDefinitionKicker(type: RouteGraphNodeType): string {
  return tr(routeGraphNodeDefinitions[type].kickerKey);
}

export function getTemplateTitle(template: AddTemplate): string {
  return tr(template.titleKey);
}

export function getTemplateDetail(template: AddTemplate): string {
  return tr(template.detailKey);
}

export function getTemplateKicker(template: AddTemplate): string {
  return tr(template.kickerKey);
}

export function getNodePorts(node: RouteGraphNode): RouteGraphPort[] {
  const portsById = new Map<string, RouteGraphPort>();
  for (const port of routeGraphNodeDefinitions[node.type]?.defaultPorts || []) portsById.set(port.id, port);
  for (const port of node.dynamicPorts || []) {
    if (port.id) portsById.set(port.id, port);
  }
  return Array.from(portsById.values()).map((port) => {
    if (node.type !== 'dispatcher') return { ...port, enabled: port.enabled !== false };
    if (port.id === 'route.in') return { ...port, enabled: node.mode !== 'flow' };
    if (port.id === 'bidirect[1...].out') return { ...port, enabled: node.mode === 'flow' };
    return { ...port, enabled: port.enabled !== false };
  });
}

export function buildAddTemplates(): AddTemplate[] {
  return [
    {
      id: 'entry',
      category: 'Core',
      kickerKey: 'pages.tokenRoutes.routeGraphRegistry.template.entry.kicker',
      titleKey: 'pages.tokenRoutes.routeGraphRegistry.template.entry.title',
      detailKey: 'pages.tokenRoutes.routeGraphRegistry.template.entry.detail',
      primitiveType: 'entry',
      create: (index, position) => makeNode('entry', index, position),
    },
    {
      id: 'dispatcher-route',
      category: 'Core',
      kickerKey: 'pages.tokenRoutes.routeGraphRegistry.template.dispatcherRoute.kicker',
      titleKey: 'pages.tokenRoutes.routeGraphRegistry.template.dispatcherRoute.title',
      detailKey: 'pages.tokenRoutes.routeGraphRegistry.template.dispatcherRoute.detail',
      primitiveType: 'dispatcher',
      create: (index, position) => ({ ...makeNode('dispatcher', index, position), mode: 'route', policy: { strategy: 'weighted' } }),
    },
    {
      id: 'reasoning_effort',
      category: 'Transform',
      kickerKey: 'pages.tokenRoutes.routeGraphRegistry.template.reasoningEffort.kicker',
      titleKey: 'pages.tokenRoutes.routeGraphRegistry.template.reasoningEffort.title',
      detailKey: 'pages.tokenRoutes.routeGraphRegistry.template.reasoningEffort.detail',
      create: (index, position) => makeFilterNode(index, {
        idPrefix: 'reasoning-effort',
        name: 'Inject reasoning effort',
        position,
        operations: [
          { type: 'set_payload', path: 'reasoning_effort', value: 'high', mode: 'default' },
        ],
      }),
    },
    {
      id: 'thinking',
      category: 'Transform',
      kickerKey: 'pages.tokenRoutes.routeGraphRegistry.template.thinking.kicker',
      titleKey: 'pages.tokenRoutes.routeGraphRegistry.template.thinking.title',
      detailKey: 'pages.tokenRoutes.routeGraphRegistry.template.thinking.detail',
      create: (index, position) => makeFilterNode(index, {
        idPrefix: 'thinking',
        name: 'Inject thinking payload',
        position,
        operations: [
          { type: 'set_payload', path: 'thinking', value: { type: 'enabled' }, mode: 'default' },
        ],
      }),
    },
    {
      id: 'model_rewrite',
      category: 'Transform',
      kickerKey: 'pages.tokenRoutes.routeGraphRegistry.template.modelRewrite.kicker',
      titleKey: 'pages.tokenRoutes.routeGraphRegistry.template.modelRewrite.title',
      detailKey: 'pages.tokenRoutes.routeGraphRegistry.template.modelRewrite.detail',
      create: (index, position) => makeFilterNode(index, {
        idPrefix: 'model-rewrite',
        name: 'Strip model suffix',
        position,
        operations: [
          { type: 'rewrite_model', source: 'current_model', operation: 'strip_suffix', suffix: '-max' },
        ],
      }),
    },
    {
      id: 'endpoint_preference',
      category: 'Transform',
      kickerKey: 'pages.tokenRoutes.routeGraphRegistry.template.endpointPreference.kicker',
      titleKey: 'pages.tokenRoutes.routeGraphRegistry.template.endpointPreference.title',
      detailKey: 'pages.tokenRoutes.routeGraphRegistry.template.endpointPreference.detail',
      create: (index, position) => makeFilterNode(index, {
        idPrefix: 'endpoint-preference',
        name: 'Prefer responses',
        position,
        operations: [
          { type: 'set_endpoint_preference', endpoint: 'responses' },
        ],
      }),
    },
    {
      id: 'header_injection',
      category: 'Transform',
      kickerKey: 'pages.tokenRoutes.routeGraphRegistry.template.headerInjection.kicker',
      titleKey: 'pages.tokenRoutes.routeGraphRegistry.template.headerInjection.title',
      detailKey: 'pages.tokenRoutes.routeGraphRegistry.template.headerInjection.detail',
      create: (index, position) => makeFilterNode(index, {
        idPrefix: 'header',
        name: 'Set upstream header',
        position,
        operations: [
          { type: 'set_header', name: 'x-metapi-route', value: 'manual', mode: 'override' },
        ],
      }),
    },
    {
      id: 'dispatcher',
      category: 'Core',
      kickerKey: 'pages.tokenRoutes.routeGraphRegistry.template.dispatcherFlow.kicker',
      titleKey: 'pages.tokenRoutes.routeGraphRegistry.template.dispatcherFlow.title',
      detailKey: 'pages.tokenRoutes.routeGraphRegistry.template.dispatcherFlow.detail',
      primitiveType: 'dispatcher',
      create: (index, position) => ({ ...makeNode('dispatcher', index, position), mode: 'flow', policy: { strategy: 'weighted' } }),
    },
    {
      id: 'route_endpoint',
      category: 'Core',
      kickerKey: 'pages.tokenRoutes.routeGraphRegistry.template.routeEndpoint.kicker',
      titleKey: 'pages.tokenRoutes.routeGraphRegistry.template.routeEndpoint.title',
      detailKey: 'pages.tokenRoutes.routeGraphRegistry.template.routeEndpoint.detail',
      primitiveType: 'route_endpoint',
      create: (index, position) => makeNode('route_endpoint', index, position),
    },
    {
      id: 'dummy_503',
      category: 'Synthetic',
      kickerKey: 'pages.tokenRoutes.routeGraphRegistry.template.dummy503.kicker',
      titleKey: 'pages.tokenRoutes.routeGraphRegistry.template.dummy503.title',
      detailKey: 'pages.tokenRoutes.routeGraphRegistry.template.dummy503.detail',
      primitiveType: 'synthetic_endpoint',
      create: (index, position) => ({ ...makeNode('synthetic_endpoint', index, position), statusCode: 503, message: 'No backend for this model' }),
    },
    {
      id: 'dummy_429',
      category: 'Synthetic',
      kickerKey: 'pages.tokenRoutes.routeGraphRegistry.template.dummy429.kicker',
      titleKey: 'pages.tokenRoutes.routeGraphRegistry.template.dummy429.title',
      detailKey: 'pages.tokenRoutes.routeGraphRegistry.template.dummy429.detail',
      primitiveType: 'synthetic_endpoint',
      create: (index, position) => ({ ...makeNode('synthetic_endpoint', index, position), statusCode: 429, message: 'Route is rate limited' }),
    },
  ];
}
