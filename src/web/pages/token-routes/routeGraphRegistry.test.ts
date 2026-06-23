import { describe, expect, it, vi } from 'vitest';

import {
  NODE_TYPES,
  ROUTE_GRAPH_VISUAL_COLORS,
  buildAddTemplates,
  getNodePorts,
  makeNode,
  routeGraphNodeDefinitions,
  templateAccent,
} from './routeGraphRegistry.js';
import {
  getPortCollectionKind,
  getPortDisplayLabel,
  getPortTypeSignature,
} from './routeGraphViewModel.js';
import type { RouteGraphNodeType } from './routeGraphTypes.js';

describe('routeGraphRegistry', () => {
  it('keeps every primitive template backed by a node definition and visual color', () => {
    expect(NODE_TYPES).toEqual([
      'entry',
      'filter',
      'dispatcher',
      'route_endpoint',
      'synthetic_endpoint',
    ]);

    for (const type of NODE_TYPES) {
      expect(routeGraphNodeDefinitions[type].primitive, type).toBe(true);
      expect(routeGraphNodeDefinitions[type].defaultPorts.length, type).toBeGreaterThan(0);
      expect(ROUTE_GRAPH_VISUAL_COLORS.node[type], type).toBe(routeGraphNodeDefinitions[type].accent);
    }
  });

  it('creates complete primitive nodes with deterministic defaults for editor insertion', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_706_000_000_000);

    const entry = makeNode('entry', 2, { x: 10, y: 20 });
    const dispatcher = makeNode('dispatcher', 3);
    const endpoint = makeNode('route_endpoint', 4);
    const synthetic = makeNode('synthetic_endpoint', 5);
    const auto = makeNode('auto_node', 6);
    const unknown = makeNode('missing_type' as RouteGraphNodeType, 7);

    expect(entry).toMatchObject({
      id: 'entry:1706000000000:2',
      type: 'entry',
      enabled: true,
      visibility: 'public',
      ownership: 'manual',
      position: { x: 10, y: 20 },
      match: {
        kind: 'model',
        requestedModelPattern: '',
        currentModelPattern: '',
        displayName: null,
      },
    });
    expect(dispatcher).toMatchObject({
      type: 'dispatcher',
      visibility: 'internal',
      mode: 'route',
      ordering: 'explicit',
      policy: { strategy: 'weighted' },
    });
    expect(endpoint).toMatchObject({
      type: 'route_endpoint',
      config: {
        targets: [
          {
            targetId: 'route_endpoint:1706000000000:4',
            model: 'route_endpoint:1706000000000:4',
          },
        ],
        targetSelection: { strategy: 'weighted' },
      },
    });
    expect(synthetic).toMatchObject({
      type: 'synthetic_endpoint',
      statusCode: 503,
      message: 'Route unavailable',
    });
    expect(auto).toMatchObject({
      id: 'auto_node:1706000000000:6',
      type: 'auto_node',
      visibility: 'internal',
      routeNodeId: 'auto_node:1706000000000:6',
      routingStrategy: 'weighted',
    });
    expect(unknown).toMatchObject({
      id: 'auto_node:1706000000000:7',
      type: 'auto_node',
      routeNodeId: 'auto_node:1706000000000:7',
      routingStrategy: 'weighted',
    });
  });

  it('exposes dispatcher route and flow mode ports without misleading disabled connections', () => {
    const routeDispatcher = {
      id: 'dispatcher.route',
      type: 'dispatcher',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
      mode: 'route',
      policy: { strategy: 'weighted' },
    } as const;
    const flowDispatcher = {
      ...routeDispatcher,
      id: 'dispatcher.flow',
      mode: 'flow',
    } as const;

    const routePorts = getNodePorts(routeDispatcher);
    const flowPorts = getNodePorts(flowDispatcher);

    expect(routePorts.find((port) => port.id === 'bidirect.in')).toMatchObject({
      label: 'dispatch input',
      direction: 'input',
      kind: 'bidirect',
      required: true,
      enabled: true,
    });
    expect(routePorts.find((port) => port.id === 'route.in')).toMatchObject({
      label: 'endpoint candidates',
      direction: 'input',
      kind: 'route',
      multiple: true,
      collection: { type: 'set', min: 1 },
      enabled: true,
    });
    expect(routePorts.find((port) => port.id === 'bidirect[1...].out')?.enabled).toBe(false);
    expect(flowPorts.find((port) => port.id === 'route.in')?.enabled).toBe(false);
    expect(flowPorts.find((port) => port.id === 'bidirect[1...].out')).toMatchObject({
      label: 'dispatch path',
      direction: 'output',
      kind: 'bidirect',
      multiple: true,
      collection: { type: 'arr', min: 1 },
      enabled: true,
    });
  });

  it('merges dynamic ports by id and exposes collection signatures for port handles', () => {
    const node = {
      id: 'auto.custom',
      type: 'auto_node' as RouteGraphNodeType,
      enabled: true,
      visibility: 'internal' as const,
      ownership: 'manual' as const,
      dynamicPorts: [
        { id: 'route.in', label: 'custom candidate set', direction: 'input' as const, kind: 'route' as const, collection: { type: 'set' as const, min: 0, max: 8 } },
        { id: 'metrics.out', label: 'telemetry', direction: 'output' as const, kind: 'metrics' as const, collection: { type: 'arr' as const } },
      ],
    };

    const ports = getNodePorts(node);
    const routePort = ports.find((port) => port.id === 'route.in');
    const metricsPort = ports.find((port) => port.id === 'metrics.out');

    expect(routePort).toMatchObject({
      label: 'custom candidate set',
      collection: { type: 'set', min: 0, max: 8 },
      enabled: true,
    });
    expect(getPortCollectionKind(routePort!)).toBe('set');
    expect(getPortTypeSignature(routePort!)).toBe('route{0,8}');
    expect(getPortDisplayLabel(metricsPort!)).toBe('telemetrys');
    expect(getPortTypeSignature(metricsPort!)).toBe('metrics[]');
  });

  it('keeps graph templates graph-native instead of legacy-route specific', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_706_000_001_000);

    const templates = buildAddTemplates();
    const byId = new Map(templates.map((template) => [template.id, template]));

    expect(Array.from(byId.keys())).toEqual(expect.arrayContaining([
      'entry',
      'dispatcher-route',
      'dispatcher',
      'route_endpoint',
      'reasoning_effort',
      'thinking',
      'model_rewrite',
      'endpoint_preference',
      'header_injection',
      'dummy_503',
      'dummy_429',
    ]));
    expect(byId.get('dispatcher-route')?.create(0)).toMatchObject({
      type: 'dispatcher',
      mode: 'route',
      policy: { strategy: 'weighted' },
    });
    expect(byId.get('entry')?.create(8)).toMatchObject({
      type: 'entry',
      visibility: 'public',
      match: {
        kind: 'model',
        requestedModelPattern: '',
        currentModelPattern: '',
        displayName: null,
      },
    });
    expect(byId.get('dispatcher')?.create(1)).toMatchObject({
      type: 'dispatcher',
      mode: 'flow',
      policy: { strategy: 'weighted' },
    });
    expect(byId.get('route_endpoint')?.create(9)).toMatchObject({
      type: 'route_endpoint',
      config: {
        targetSelection: { strategy: 'weighted' },
      },
    });
    expect(byId.get('reasoning_effort')?.create(2)).toMatchObject({
      type: 'filter',
      operations: [
        { type: 'set_payload', path: 'reasoning_effort', value: 'high', mode: 'default' },
      ],
    });
    expect(byId.get('endpoint_preference')?.create(3)).toMatchObject({
      type: 'filter',
      operations: [
        { type: 'set_endpoint_preference', endpoint: 'responses' },
      ],
    });
    expect(byId.get('thinking')?.create(5, { x: 40, y: 50 })).toMatchObject({
      id: 'filter:thinking:1706000001000:5',
      type: 'filter',
      name: 'Inject thinking payload',
      position: { x: 40, y: 50 },
      operations: [
        { type: 'set_payload', path: 'thinking', value: { type: 'enabled' }, mode: 'default' },
      ],
    });
    expect(byId.get('model_rewrite')?.create(6)).toMatchObject({
      id: 'filter:model-rewrite:1706000001000:6',
      type: 'filter',
      name: 'Strip model suffix',
      operations: [
        { type: 'rewrite_model', source: 'current_model', operation: 'strip_suffix', suffix: '-max' },
      ],
    });
    expect(byId.get('header_injection')?.create(7)).toMatchObject({
      id: 'filter:header:1706000001000:7',
      type: 'filter',
      name: 'Set upstream header',
      operations: [
        { type: 'set_header', name: 'x-metapi-route', value: 'manual', mode: 'override' },
      ],
    });
    expect(byId.get('dummy_429')?.create(4)).toMatchObject({
      type: 'synthetic_endpoint',
      statusCode: 429,
      message: 'Route is rate limited',
    });
    expect(byId.get('dummy_503')?.create(10)).toMatchObject({
      type: 'synthetic_endpoint',
      statusCode: 503,
      message: 'No backend for this model',
    });
    expect(templateAccent(byId.get('reasoning_effort')!)).toBe(ROUTE_GRAPH_VISUAL_COLORS.templateCategory.Transform);
    expect(templateAccent(byId.get('route_endpoint')!)).toBe(ROUTE_GRAPH_VISUAL_COLORS.node.route_endpoint);
  });
});
