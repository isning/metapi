import type {
  AddTemplate,
  RouteFilter,
  RouteGraphEdgeKind,
  RouteGraphNode,
  RouteGraphNodeType,
  RouteGraphPort,
  RouteGraphPortKind,
} from './routeGraphTypes.js';

type NodeDefinition = {
  title: string;
  detail: string;
  kicker: string;
  accent: string;
  primitive: boolean;
  defaultPorts: RouteGraphPort[];
  createDefaultNode: (index: number, position?: { x: number; y: number }) => RouteGraphNode;
};

const templateCategoryAccent = {
  Core: '#2563eb',
  Transform: '#7c3aed',
  Fallback: '#dc2626',
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
    kicker: 'Primitive',
    title: 'Entry',
    detail: 'Public or internal flow entry with model matching.',
    accent: '#2563eb',
    primitive: true,
    defaultPorts: [
      { id: 'bidirect.in', label: 'reuse input', direction: 'input', kind: 'bidirect', accepts: ['bidirect'] },
      { id: 'bidirect.out', label: 'matched flow', direction: 'output', kind: 'bidirect' },
    ],
    createDefaultNode: (index, position) => ({
      ...baseNode('entry', index, position),
      match: { kind: 'model', requestedModelPattern: '', currentModelPattern: '', displayName: null },
      selectionStrategy: 'weighted',
    }),
  },
  filter: {
    kicker: 'Primitive',
    title: 'Filter',
    detail: 'Empty request/bidirect mutation node.',
    accent: '#7c3aed',
    primitive: true,
    defaultPorts: [
      { id: 'request.in', label: 'before mutation', direction: 'input', kind: 'request', accepts: ['request'] },
      { id: 'request.out', label: 'after mutation', direction: 'output', kind: 'request' },
      { id: 'bidirect.in', label: 'before round trip', direction: 'input', kind: 'bidirect', accepts: ['bidirect'] },
      { id: 'bidirect.out', label: 'after round trip', direction: 'output', kind: 'bidirect' },
    ],
    createDefaultNode: (index, position) => ({ ...baseNode('filter', index, position), operations: [] }),
  },
  dispatcher: {
    kicker: 'Primitive',
    title: 'Dispatcher',
    detail: 'Route or flow load balancing primitive.',
    accent: '#2563eb',
    primitive: true,
    defaultPorts: [
      { id: 'bidirect.in', label: 'dispatch input', direction: 'input', kind: 'bidirect', accepts: ['bidirect'], required: true },
      { id: 'bidirect[1...].out', label: 'dispatch path', direction: 'output', kind: 'bidirect', multiple: true, collection: { type: 'arr', min: 1 } },
      { id: 'route.in', label: 'endpoint candidates', direction: 'input', kind: 'route', accepts: ['route'], multiple: true, collection: { type: 'set', min: 1 } },
    ],
    createDefaultNode: (index, position) => ({ ...baseNode('dispatcher', index, position), mode: 'route', ordering: 'explicit', policy: { strategy: 'weighted' } }),
  },
  model_endpoint: {
    kicker: 'Primitive',
    title: 'Model Endpoint',
    detail: 'Executable model target container.',
    accent: '#059669',
    primitive: true,
    defaultPorts: [
      { id: 'route.out', label: 'endpoint target', direction: 'output', kind: 'route' },
      { id: 'bidirect.in', label: 'invoke endpoint', direction: 'input', kind: 'bidirect', accepts: ['bidirect'] },
    ],
    createDefaultNode: (index, position) => {
      const node = baseNode('model_endpoint', index, position);
      return {
        ...node,
        metadata: {},
        config: { targets: [{ channelId: node.id, model: node.id }], targetSelection: { strategy: 'weighted' } },
      };
    },
  },
  synthetic_endpoint: {
    kicker: 'Primitive',
    title: 'Synthetic Endpoint',
    detail: 'Terminal dummy response backend.',
    accent: '#dc2626',
    primitive: true,
    defaultPorts: [
      { id: 'route.out', label: 'synthetic target', direction: 'output', kind: 'route' },
      { id: 'bidirect.in', label: 'return response', direction: 'input', kind: 'bidirect', accepts: ['bidirect'] },
    ],
    createDefaultNode: (index, position) => ({ ...baseNode('synthetic_endpoint', index, position), statusCode: 503, message: 'Route unavailable' }),
  },
  auto_node: {
    kicker: 'Primitive',
    title: 'Auto Node',
    detail: 'Generated compatibility node; not normally created manually.',
    accent: '#64748b',
    primitive: false,
    defaultPorts: [
      { id: 'route.in', label: 'candidate targets', direction: 'input', kind: 'route', accepts: ['route'], multiple: true, collection: { type: 'set' } },
      { id: 'bidirect.in', label: 'route input', direction: 'input', kind: 'bidirect', accepts: ['bidirect'] },
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

export const ROUTE_GRAPH_VISUAL_COLORS = {
  node: Object.fromEntries(
    (Object.keys(routeGraphNodeDefinitions) as RouteGraphNodeType[]).map((type) => [type, routeGraphNodeDefinitions[type].accent]),
  ) as Record<RouteGraphNodeType, string>,
  port: {
    request: '#2563eb',
    bidirect: '#2563eb',
    route: '#16a34a',
    response: '#047857',
    control: '#334155',
    metrics: '#64748b',
  } satisfies Record<RouteGraphPortKind, string>,
  edge: {
    request_flow: '#2563eb',
    bidirect_flow: '#2563eb',
    route_flow: '#16a34a',
    response_flow: '#047857',
    control_flow: '#334155',
    metrics_link: '#64748b',
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
      kicker: 'Entry',
      title: 'Public Model Entry',
      detail: 'Expose a downstream model name and start a route flow.',
      primitiveType: 'entry',
      create: (index, position) => makeNode('entry', index, position),
    },
    {
      id: 'dispatcher-route',
      category: 'Core',
      kicker: 'Route',
      title: 'Route Dispatcher',
      detail: 'Load balance route candidates by policy and metadata.',
      primitiveType: 'dispatcher',
      create: (index, position) => ({ ...makeNode('dispatcher', index, position), mode: 'route', policy: { strategy: 'weighted' } }),
    },
    {
      id: 'reasoning_effort',
      category: 'Transform',
      kicker: 'Payload',
      title: 'Reasoning Effort Injection',
      detail: 'Inject reasoning_effort without hardcoding provider/model names.',
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
      kicker: 'Payload',
      title: 'Thinking Payload Injection',
      detail: 'Set a generic thinking payload field for compatible upstreams.',
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
      kicker: 'Model',
      title: 'Strip Model Suffix',
      detail: 'Rewrite current_model before selecting an inner route.',
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
      kicker: 'Endpoint',
      title: 'Prefer Responses Endpoint',
      detail: 'Move a compatible endpoint to the front of the endpoint list.',
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
      kicker: 'Header',
      title: 'Header Injection',
      detail: 'Set a request header after protocol request preparation.',
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
      kicker: 'Flow',
      title: 'Flow Dispatcher',
      detail: 'Emit an ordered bidirect output array for flow composition.',
      primitiveType: 'dispatcher',
      create: (index, position) => ({ ...makeNode('dispatcher', index, position), mode: 'flow', policy: { strategy: 'weighted' } }),
    },
    {
      id: 'model_endpoint',
      category: 'Core',
      kicker: 'Endpoint',
      title: 'Model Endpoint',
      detail: 'Declare executable model targets with custom metadata.',
      primitiveType: 'model_endpoint',
      create: (index, position) => makeNode('model_endpoint', index, position),
    },
    {
      id: 'dummy_503',
      category: 'Fallback',
      kicker: 'Fallback',
      title: '503 Dummy Backend',
      detail: 'Return a configured terminal response when no backend is allowed.',
      primitiveType: 'synthetic_endpoint',
      create: (index, position) => ({ ...makeNode('synthetic_endpoint', index, position), statusCode: 503, message: 'No backend for this model' }),
    },
    {
      id: 'dummy_429',
      category: 'Fallback',
      kicker: 'Fallback',
      title: '429 Dummy Backend',
      detail: 'Return a configured rate-limit terminal response.',
      primitiveType: 'synthetic_endpoint',
      create: (index, position) => ({ ...makeNode('synthetic_endpoint', index, position), statusCode: 429, message: 'Route is rate limited' }),
    },
  ];
}
