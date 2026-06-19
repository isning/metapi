import { describe, expect, it } from 'vitest';

import {
  getGraphFacts,
  getNodeConnections,
  getNodeCardMetrics,
  getNodeCardSubtitle,
  getNodeConnectionCount,
  getNodeInspectorFacts,
  getNodeModeLabel,
  getModelListSubtitle,
  getNodePortsPreview,
  getNodeSubtitle,
  getNodeTitle,
  getPortConnectionCount,
  getPortCollectionKind,
  getPortDisplayLabel,
  getPortModeNote,
  getPortSummary,
  getPortTypeSignature,
  getOutlineSubtitle,
} from './routeGraphViewModel.js';
import type { RouteGraphLike } from './routeGraphViewModel.js';
import type { RouteGraphNode } from './routeGraphTypes.js';

function graphWith(nodes: RouteGraphNode[]): RouteGraphLike {
  return {
    nodes,
    edges: [
      {
        id: 'entry-dispatcher',
        sourceNodeId: 'entry.public',
        sourcePortId: 'bidirect.out',
        targetNodeId: 'dispatcher.route',
        targetPortId: 'bidirect.in',
        kind: 'bidirect_flow',
        ownership: 'manual',
      },
      {
        id: 'endpoint-dispatcher',
        sourceNodeId: 'endpoint.primary',
        sourcePortId: 'route.out',
        targetNodeId: 'dispatcher.route',
        targetPortId: 'route.in',
        kind: 'route_flow',
        ownership: 'manual',
      },
    ],
  };
}

describe('routeGraphViewModel', () => {
  it('renders compact node and graph facts without duplicating config fields', () => {
    const entry: RouteGraphNode = {
      id: 'entry.public',
      type: 'entry',
      name: 'Public GPT',
      enabled: true,
      visibility: 'public',
      ownership: 'manual',
      match: { kind: 'model', requestedModelPattern: 'gpt-*', displayName: 'gpt-public' },
    };
    const dispatcher: RouteGraphNode = {
      id: 'dispatcher.route',
      type: 'dispatcher',
      name: 'Primary selector',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
      mode: 'route',
      ordering: 'explicit',
      policy: { strategy: 'priority_order' },
      successRate: 0.876,
    };
    const endpoint: RouteGraphNode = {
      id: 'endpoint.primary',
      type: 'model_endpoint',
      name: 'Primary endpoint',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
      config: {
        targets: [
          { channelId: 'channel-a', model: 'gpt-a' },
          { channelId: 'channel-b', model: 'gpt-b' },
        ],
        targetSelection: { strategy: 'weighted' },
      },
    };
    const graph = graphWith([entry, dispatcher, endpoint]);

    expect(getGraphFacts(graph)).toEqual([
      { label: 'Nodes', value: 3 },
      { label: 'Edges', value: 2 },
      { label: 'Public', value: 1 },
      { label: 'Manual', value: 3 },
    ]);
    expect(getNodeCardSubtitle(entry)).toBe('gpt-public');
    expect(getNodeCardSubtitle(endpoint)).toBe('2 model targets');
    expect(getNodeCardMetrics(graph, dispatcher)).toEqual([
      '2 connections',
      '88% success',
      'priority_order',
    ]);
    expect(getNodeInspectorFacts(graph, dispatcher)).toEqual([
      { label: 'Selected', value: 'dispatcher.route' },
      { label: 'Type', value: 'dispatcher' },
      { label: 'Mode', value: 'route' },
      { label: 'Connections', value: 2 },
    ]);
  });

  it('uses semantic port labels and puts collection details in type signatures', () => {
    const dispatcher: RouteGraphNode = {
      id: 'dispatcher.flow',
      type: 'dispatcher',
      name: 'Flow dispatcher',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
      mode: 'flow',
      ordering: 'explicit',
      policy: { strategy: 'weighted' },
    };
    const ports = getNodePortsPreview(dispatcher, 10);
    const routeIn = ports.find((port) => port.id === 'route.in');
    const bidirectOut = ports.find((port) => port.id === 'bidirect[1...].out');

    expect(routeIn).toBeTruthy();
    expect(bidirectOut).toBeTruthy();
    expect(getPortDisplayLabel(routeIn!)).toBe('endpoint candidates');
    expect(getPortSummary(routeIn!)).toBe('input · route');
    expect(getPortTypeSignature(routeIn!)).toBe('route{1,}');
    expect(getPortModeNote(dispatcher, routeIn!)).toBe('Ignored in flow mode');

    expect(getPortDisplayLabel(bidirectOut!)).toBe('dispatch paths');
    expect(getPortSummary(bidirectOut!)).toBe('output · bidirect');
    expect(getPortTypeSignature(bidirectOut!)).toBe('bidirect[1,]');
    expect(getPortModeNote(dispatcher, bidirectOut!)).toBeNull();
  });

  it('renders bounded set and array signatures without leaking collection markers into labels', () => {
    const setPort = {
      id: 'route.custom',
      label: 'candidate targets',
      direction: 'output' as const,
      kind: 'route' as const,
      collection: { type: 'set' as const, min: 0, max: 8 },
    };
    const arrPort = {
      id: 'bidirect.custom',
      label: 'dispatch path',
      direction: 'output' as const,
      kind: 'bidirect' as const,
      collection: { type: 'arr' as const, min: 1 },
    };
    const singlePort = {
      id: 'request.in',
      label: 'request input',
      direction: 'input' as const,
      kind: 'request' as const,
    };

    expect(getPortDisplayLabel(setPort)).toBe('candidate targets');
    expect(getPortTypeSignature(setPort)).toBe('route{0,8}');
    expect(getPortCollectionKind(setPort)).toBe('set');

    expect(getPortDisplayLabel(arrPort)).toBe('dispatch paths');
    expect(getPortTypeSignature(arrPort)).toBe('bidirect[1,]');
    expect(getPortCollectionKind(arrPort)).toBe('arr');

    expect(getPortDisplayLabel(singlePort)).toBe('request input');
    expect(getPortTypeSignature(singlePort)).toBe('request');
    expect(getPortCollectionKind(singlePort)).toBe('single');
  });

  it('keeps port type signatures compact for tooltip-only display', () => {
    const ports = [
      {
        id: 'route.empty-set',
        label: 'routes',
        direction: 'output' as const,
        kind: 'route' as const,
        collection: { type: 'set' as const },
      },
      {
        id: 'route.open-set',
        label: 'routes',
        direction: 'output' as const,
        kind: 'route' as const,
        collection: { type: 'set' as const, min: 0 },
      },
      {
        id: 'route.bounded-set',
        label: 'routes',
        direction: 'output' as const,
        kind: 'route' as const,
        collection: { type: 'set' as const, min: 0, max: 8 },
      },
      {
        id: 'route.array',
        label: 'routes',
        direction: 'output' as const,
        kind: 'route' as const,
        collection: { type: 'arr' as const },
      },
      {
        id: 'route.open-array',
        label: 'routes',
        direction: 'output' as const,
        kind: 'route' as const,
        collection: { type: 'arr' as const, min: 0 },
      },
      {
        id: 'route.bounded-array',
        label: 'routes',
        direction: 'output' as const,
        kind: 'route' as const,
        collection: { type: 'arr' as const, min: 0, max: 8 },
      },
      {
        id: 'route.max-only-set',
        label: 'routes',
        direction: 'output' as const,
        kind: 'route' as const,
        collection: { type: 'set' as const, max: 8 },
      },
    ];

    expect(ports.map(getPortTypeSignature)).toEqual([
      'route{}',
      'route{0,}',
      'route{0,8}',
      'route[]',
      'route[0,]',
      'route[0,8]',
      'route{,8}',
    ]);
    expect(ports.map(getPortDisplayLabel)).toEqual([
      'routes',
      'routes',
      'routes',
      'routes',
      'routes',
      'routes',
      'routes',
    ]);
  });

  it('shows disabled dispatcher port state as mode notes instead of changing labels or type signatures', () => {
    const dispatcher: RouteGraphNode = {
      id: 'dispatcher.route',
      type: 'dispatcher',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
      mode: 'route',
      ordering: 'explicit',
      policy: { strategy: 'weighted' },
    };
    const disabledFlowOut = getNodePortsPreview(dispatcher, 10)
      .find((port) => port.id === 'bidirect[1...].out');

    expect(disabledFlowOut).toMatchObject({
      enabled: false,
      label: 'dispatch path',
      kind: 'bidirect',
    });
    expect(getPortDisplayLabel(disabledFlowOut!)).toBe('dispatch paths');
    expect(getPortTypeSignature(disabledFlowOut!)).toBe('bidirect[1,]');
    expect(getPortModeNote(dispatcher, disabledFlowOut!)).toBe('Ignored in route mode');
  });

  it('keeps list and outline subtitles focused on status, visibility, and ownership', () => {
    const manualPublic: RouteGraphNode = {
      id: 'entry.public',
      type: 'entry',
      name: 'Public',
      enabled: true,
      visibility: 'public',
      ownership: 'manual',
      match: { requestedModelPattern: 'public-model' },
    };
    const disabledDerived: RouteGraphNode = {
      id: 'endpoint.derived',
      type: 'model_endpoint',
      name: 'Derived endpoint',
      enabled: false,
      visibility: 'internal',
      ownership: 'derived',
      config: { targets: [], targetSelection: { strategy: 'weighted' } },
    };

    expect(getModelListSubtitle(manualPublic)).toBe('enabled · manual');
    expect(getOutlineSubtitle(manualPublic)).toBe('entry · public · manual');
    expect(getModelListSubtitle(disabledDerived)).toBe('disabled · derived');
    expect(getOutlineSubtitle(disabledDerived)).toBe('model_endpoint · internal · derived');
  });

  it('summarizes unknown and fallback node types without repeating enabled/public facts', () => {
    const autoNode: RouteGraphNode = {
      id: 'auto.derived',
      type: 'auto_node',
      name: 'Auto generated',
      enabled: true,
      visibility: 'internal',
      ownership: 'auto_generated',
      routingStrategy: 'weighted',
    };
    const synthetic: RouteGraphNode = {
      id: 'synthetic.429',
      type: 'synthetic_endpoint',
      name: 'Rate limited',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
      statusCode: 429,
      message: 'Rate limited',
    };
    const graph = graphWith([autoNode, synthetic]);

    expect(getNodeCardSubtitle(autoNode)).toBe('auto_generated node');
    expect(getNodeCardSubtitle(synthetic)).toBe('429 synthetic response');
    expect(getNodeInspectorFacts(graph, synthetic).map((fact) => fact.label)).toEqual([
      'Selected',
      'Type',
      'Mode',
      'Connections',
    ]);
  });

  it('covers title, subtitle, cardinality, and connection display fallbacks', () => {
    const unnamedEntry: RouteGraphNode = {
      id: 'entry.unnamed',
      type: 'entry',
      enabled: true,
      visibility: 'public',
      ownership: 'manual',
      match: {},
    };
    const dispatcherDefault: RouteGraphNode = {
      id: 'dispatcher.default',
      type: 'dispatcher',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
      policy: {},
    };
    const filterOne: RouteGraphNode = {
      id: 'filter.one',
      type: 'filter',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
      operations: [{ kind: 'set', path: 'metadata.source', value: 'test' }],
    };
    const filterZero: RouteGraphNode = {
      id: 'filter.zero',
      type: 'filter',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
      operations: [],
    };
    const endpointOne: RouteGraphNode = {
      id: 'endpoint.one',
      type: 'model_endpoint',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
      config: { targets: [{ channelId: '1', model: 'gpt-4.1' }] },
    };
    const syntheticDefault: RouteGraphNode = {
      id: 'synthetic.default',
      type: 'synthetic_endpoint',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
    };
    const manualAuto: RouteGraphNode = {
      id: 'auto.manual',
      type: 'auto_node',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
    };
    const graph: RouteGraphLike = {
      nodes: [unnamedEntry, dispatcherDefault, filterOne, filterZero, endpointOne, syntheticDefault, manualAuto],
      edges: [
        {
          id: 'entry-filter',
          sourceNodeId: 'entry.unnamed',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'filter.one',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
      ],
    };

    expect(getNodeTitle(unnamedEntry)).toBe('entry.unnamed');
    expect(getNodeSubtitle(unnamedEntry)).toBe('entry.unnamed');
    expect(getNodeCardSubtitle(unnamedEntry)).toBe('public model entry');
    expect(getNodeCardSubtitle(dispatcherDefault)).toBe('route dispatcher');
    expect(getNodeModeLabel(dispatcherDefault)).toBe('route');
    expect(getNodeCardSubtitle(filterOne)).toBe('1 operation');
    expect(getNodeCardSubtitle(filterZero)).toBe('0 operations');
    expect(getNodeCardSubtitle(endpointOne)).toBe('1 model target');
    expect(getNodeCardSubtitle(syntheticDefault)).toBe('503 synthetic response');
    expect(getNodeCardSubtitle(manualAuto)).toBe('manual node');
    expect(getNodeCardMetrics(graph, dispatcherDefault)).toEqual(['0 connections', 'weighted']);
    expect(getNodeCardMetrics(graph, unnamedEntry)).toEqual(['1 connection']);
    expect(getNodeConnectionCount(graph, 'entry.unnamed')).toBe(1);
    expect(getPortConnectionCount(graph, 'entry.unnamed', 'bidirect.out')).toBe(1);
    expect(getPortConnectionCount(graph, 'filter.one', 'bidirect.in')).toBe(1);
    expect(getNodeConnections(graph, 'entry.unnamed')).toEqual([
      { edge: graph.edges[0], direction: 'outbound', peerNodeId: 'filter.one' },
    ]);
    expect(getNodeConnections(graph, 'filter.one')).toEqual([
      { edge: graph.edges[0], direction: 'inbound', peerNodeId: 'entry.unnamed' },
    ]);
  });
});
