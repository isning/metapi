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
  filterPublicModelEntryRows,
  getPortConnectionCount,
  getPortCollectionKind,
  getPortDisplayLabel,
  getPortModeNote,
  getPortSummary,
  getPortTypeSignature,
  getPublicModelEntryRows,
  getOutlineSubtitle,
} from './routeGraphViewModel.js';
import { tr } from '../../i18n.js';
import type { RouteGraphLike } from './routeGraphViewModel.js';
import type { RouteGraphMacro, RouteGraphNode } from './routeGraphTypes.js';

function text(key: string, replacements: Record<string, string | number> = {}): string {
  let value = tr(key);
  for (const [name, replacement] of Object.entries(replacements)) {
    value = value.replace(`{${name}}`, String(replacement));
  }
  return value;
}

function graphWith(nodes: RouteGraphNode[], macros: RouteGraphMacro[] = []): RouteGraphLike {
  return {
    nodes,
    macros,
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
      type: 'route_endpoint',
      name: 'Primary endpoint',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
      config: {
        targets: [
          { targetId: 'target-a', model: 'gpt-a' },
          { targetId: 'target-b', model: 'gpt-b' },
        ],
        targetSelection: { strategy: 'weighted' },
      },
    };
    const graph = graphWith([entry, dispatcher, endpoint]);

    expect(getGraphFacts(graph)).toEqual([
      { label: text('pages.tokenRoutes.routeGraphViewModel.fact.nodes'), value: 3 },
      { label: text('pages.tokenRoutes.routeGraphViewModel.fact.edges'), value: 2 },
      { label: text('pages.tokenRoutes.routeGraphViewModel.fact.public'), value: 1 },
      { label: text('pages.tokenRoutes.routeGraphViewModel.fact.manual'), value: 3 },
    ]);
    expect(getNodeCardSubtitle(entry)).toBe('gpt-public');
    expect(getNodeCardSubtitle(endpoint)).toBe(text('pages.tokenRoutes.routeGraphViewModel.upstreamTargetsCount', { count: 2 }));
    expect(getNodeCardMetrics(graph, dispatcher)).toEqual([
      text('pages.tokenRoutes.routeGraphViewModel.connectionsCount', { count: 2 }),
      text('pages.tokenRoutes.routeGraphViewModel.successPercent', { percent: 88 }),
      'priority_order',
    ]);
    expect(getNodeInspectorFacts(graph, dispatcher)).toEqual([
      { label: text('pages.tokenRoutes.routeGraphViewModel.fact.selected'), value: 'dispatcher.route' },
      { label: text('pages.tokenRoutes.routeGraphViewModel.fact.type'), value: text('pages.tokenRoutes.routeGraphViewModel.nodeType.dispatcher') },
      { label: text('pages.tokenRoutes.routeGraphViewModel.fact.mode'), value: 'route' },
      { label: text('pages.tokenRoutes.routeGraphViewModel.fact.connections'), value: 2 },
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
    expect(getPortDisplayLabel(routeIn!)).toBe(text('pages.tokenRoutes.routeGraphViewModel.portLabel.endpointCandidates'));
    expect(getPortSummary(routeIn!)).toBe(`${text('pages.tokenRoutes.routeGraphViewModel.portDirection.input')} · ${text('pages.tokenRoutes.routeGraphViewModel.portKind.route')}`);
    expect(getPortTypeSignature(routeIn!)).toBe('route{1,}');
    expect(getPortModeNote(dispatcher, routeIn!)).toBe(text('pages.tokenRoutes.routeGraphViewModel.ignoredInFlowMode'));

    expect(getPortDisplayLabel(bidirectOut!)).toBe(text('pages.tokenRoutes.routeGraphViewModel.portLabel.dispatchPaths'));
    expect(getPortSummary(bidirectOut!)).toBe(`${text('pages.tokenRoutes.routeGraphViewModel.portDirection.output')} · ${text('pages.tokenRoutes.routeGraphViewModel.portKind.bidirect')}`);
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

    expect(getPortDisplayLabel(setPort)).toBe(text('pages.tokenRoutes.routeGraphViewModel.portLabel.candidateTargets'));
    expect(getPortTypeSignature(setPort)).toBe('route{0,8}');
    expect(getPortCollectionKind(setPort)).toBe('set');

    expect(getPortDisplayLabel(arrPort)).toBe(text('pages.tokenRoutes.routeGraphViewModel.portLabel.dispatchPaths'));
    expect(getPortTypeSignature(arrPort)).toBe('bidirect[1,]');
    expect(getPortCollectionKind(arrPort)).toBe('arr');

    expect(getPortDisplayLabel(singlePort)).toBe('request input');
    expect(getPortTypeSignature(singlePort)).toBe('request');
    expect(getPortCollectionKind(singlePort)).toBe('single');
  });

  it('uses compiled public route products for model entries before primitive entry fallback', () => {
    const entry: RouteGraphNode = {
      id: 'entry.public',
      type: 'entry',
      enabled: true,
      visibility: 'public',
      ownership: 'manual',
      match: { kind: 'model', requestedModelPattern: 'manual-model', displayName: 'manual-model' },
    };
    const graph = graphWith([entry]);

    expect(getPublicModelEntryRows(graph, [
      {
        endpointId: 'route-endpoint:product:auto-model:deepseek-v4-flash-reroute',
        nodeId: 'route-endpoint:product:auto-model:deepseek-v4-flash-reroute',
        routeId: null,
        label: 'deepseek-v4-flash-reroute',
        endpointKind: 'route_product',
        exposure: 'public',
        resolutionStatus: 'resolved',
        ownerKind: 'macro',
        sourceKind: 'automatic_model_group',
        enabled: true,
        displayIcon: null,
        modelPattern: 'deepseek-v4-flash-reroute',
        publicModelName: 'deepseek-v4-flash-reroute',
        upstreamModels: ['deepseek-v4-flash'],
        siteNames: ['site-a', 'site-b', 'site-c'],
        sourceRouteIds: [1, 2, 3],
        tags: [],
        metadata: {},
      },
    ])).toEqual([
      expect.objectContaining({
        id: 'route-endpoint:product:auto-model:deepseek-v4-flash-reroute',
        nodeId: 'route-endpoint:product:auto-model:deepseek-v4-flash-reroute',
        title: 'deepseek-v4-flash-reroute',
        source: 'compiled_endpoint',
      }),
      expect.objectContaining({
        id: 'entry.public',
        nodeId: 'entry.public',
        title: 'manual-model',
        source: 'entry_node',
      }),
    ]);
  });

  it('uses current public candidate selector macros when endpoint catalog is empty', () => {
    const macro: RouteGraphMacro = {
      id: 'deepseek-v4-flash-reroute',
      kind: 'candidate_selector',
      enabled: true,
      visibility: 'public',
      ownership: 'manual',
      name: 'deepseek-v4-flash-reroute',
      config: {
        surface: {
          entry: {
            kind: 'external',
            visibility: 'public',
            match: {
              kind: 'model',
              requestedModelPattern: 'deepseek-v4-flash-reroute',
              displayName: 'deepseek-v4-flash-reroute',
            },
          },
          output: 'route',
        },
        policy: { strategy: 'weighted' },
        groups: [
          {
            id: 'primary',
            enabled: true,
            priority: 0,
            input: { kind: 'model_pattern', pattern: 'deepseek-v4-flash' },
          },
        ],
      },
    };

    expect(getPublicModelEntryRows(graphWith([], [macro]), [])).toEqual([
      expect.objectContaining({
        id: 'macro:deepseek-v4-flash-reroute:entry',
        nodeId: 'macro:deepseek-v4-flash-reroute:entry',
        title: 'deepseek-v4-flash-reroute',
        source: 'macro_entry',
      }),
    ]);
  });

  it('keeps disabled public candidate selector macro entries visible as configured entries', () => {
    const macro: RouteGraphMacro = {
      id: 'manual-public-group',
      kind: 'candidate_selector',
      enabled: false,
      visibility: 'public',
      ownership: 'manual',
      config: {
        surface: {
          entry: {
            kind: 'external',
            visibility: 'public',
            match: {
              kind: 'model',
              requestedModelPattern: 'manual-public-group',
              displayName: 'manual-public-group',
            },
          },
          output: 'route',
        },
        policy: { strategy: 'weighted' },
        groups: [],
      },
    };

    expect(getPublicModelEntryRows(graphWith([], [macro]), [])).toEqual([
      expect.objectContaining({
        id: 'macro-config:manual-public-group:entry',
        nodeId: 'macro:manual-public-group',
        title: 'manual-public-group',
        source: 'macro_entry',
      }),
    ]);
  });

  it('filters public model entries by title, subtitle, id, and multiple search terms', () => {
    const rows = [
      {
        id: 'macro:deepseek-v4-flash-reroute:entry',
        nodeId: 'macro:deepseek-v4-flash-reroute:entry',
        title: 'deepseek-v4-flash-reroute',
        subtitle: 'macro · deepseek-v4-flash-reroute',
        source: 'macro_entry' as const,
      },
      {
        id: 'entry.manual',
        nodeId: 'entry.manual',
        title: 'manual-model',
        subtitle: 'enabled · manual',
        source: 'entry_node' as const,
      },
      {
        id: 'route-endpoint:product:auto-model:gpt-4o',
        nodeId: 'route-endpoint:product:auto-model:gpt-4o',
        title: 'gpt-4o',
        subtitle: 'macro · site-a, site-b · 2 routes',
        source: 'compiled_endpoint' as const,
      },
    ];

    expect(filterPublicModelEntryRows(rows, '')).toBe(rows);
    expect(filterPublicModelEntryRows(rows, 'DEEPSEEK reroute')).toEqual([rows[0]]);
    expect(filterPublicModelEntryRows(rows, 'site-b')).toEqual([rows[2]]);
    expect(filterPublicModelEntryRows(rows, 'entry manual')).toEqual([rows[1]]);
    expect(filterPublicModelEntryRows(rows, 'missing')).toEqual([]);
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
    expect(getPortDisplayLabel(disabledFlowOut!)).toBe(text('pages.tokenRoutes.routeGraphViewModel.portLabel.dispatchPaths'));
    expect(getPortTypeSignature(disabledFlowOut!)).toBe('bidirect[1,]');
    expect(getPortModeNote(dispatcher, disabledFlowOut!)).toBe(text('pages.tokenRoutes.routeGraphViewModel.ignoredInRouteMode'));
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
      type: 'route_endpoint',
      name: 'Derived endpoint',
      enabled: false,
      visibility: 'internal',
      ownership: 'derived',
      config: { targets: [], targetSelection: { strategy: 'weighted' } },
    };

    expect(getModelListSubtitle(manualPublic)).toBe(`${text('pages.tokenRoutes.routeGraphViewModel.status.enabled')} · ${text('pages.tokenRoutes.routeGraphViewModel.ownership.manual')}`);
    expect(getOutlineSubtitle(manualPublic)).toBe(`${text('pages.tokenRoutes.routeGraphViewModel.nodeType.entry')} · ${text('pages.tokenRoutes.routeGraphViewModel.visibility.public')} · ${text('pages.tokenRoutes.routeGraphViewModel.ownership.manual')}`);
    expect(getModelListSubtitle(disabledDerived)).toBe(`${text('pages.tokenRoutes.routeGraphViewModel.status.disabled')} · ${text('pages.tokenRoutes.routeGraphViewModel.ownership.derived')}`);
    expect(getOutlineSubtitle(disabledDerived)).toBe(`${text('pages.tokenRoutes.routeGraphViewModel.nodeType.routeEndpoint')} · ${text('pages.tokenRoutes.routeGraphViewModel.visibility.internal')} · ${text('pages.tokenRoutes.routeGraphViewModel.ownership.derived')}`);
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

    expect(getNodeCardSubtitle(autoNode)).toBe(text('pages.tokenRoutes.routeGraphViewModel.ownershipNode', {
      ownership: text('pages.tokenRoutes.routeGraphViewModel.ownership.autoGenerated'),
    }));
    expect(getNodeCardSubtitle(synthetic)).toBe(text('pages.tokenRoutes.routeGraphViewModel.syntheticResponse', { status: 429 }));
    expect(getNodeInspectorFacts(graph, synthetic).map((fact) => fact.label)).toEqual([
      text('pages.tokenRoutes.routeGraphViewModel.fact.selected'),
      text('pages.tokenRoutes.routeGraphViewModel.fact.type'),
      text('pages.tokenRoutes.routeGraphViewModel.fact.mode'),
      text('pages.tokenRoutes.routeGraphViewModel.fact.connections'),
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
      type: 'route_endpoint',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
      config: { targets: [{ targetId: '1', model: 'gpt-4.1' }] },
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
    expect(getNodeCardSubtitle(unnamedEntry)).toBe(text('pages.tokenRoutes.routeGraphViewModel.publicModelEntry'));
    expect(getNodeCardSubtitle(dispatcherDefault)).toBe(text('pages.tokenRoutes.routeGraphViewModel.dispatcherSubtitle', {
      mode: text('pages.tokenRoutes.routeGraphViewModel.dispatcherMode.route'),
    }));
    expect(getNodeModeLabel(dispatcherDefault)).toBe('route');
    expect(getNodeCardSubtitle(filterOne)).toBe(text('pages.tokenRoutes.routeGraphViewModel.oneOperation'));
    expect(getNodeCardSubtitle(filterZero)).toBe(text('pages.tokenRoutes.routeGraphViewModel.operationsCount', { count: 0 }));
    expect(getNodeCardSubtitle(endpointOne)).toBe(text('pages.tokenRoutes.routeGraphViewModel.oneUpstreamTarget'));
    expect(getNodeCardSubtitle(syntheticDefault)).toBe(text('pages.tokenRoutes.routeGraphViewModel.syntheticResponse', { status: 503 }));
    expect(getNodeCardSubtitle(manualAuto)).toBe(text('pages.tokenRoutes.routeGraphViewModel.ownershipNode', {
      ownership: text('pages.tokenRoutes.routeGraphViewModel.ownership.manual'),
    }));
    expect(getNodeCardMetrics(graph, dispatcherDefault)).toEqual([text('pages.tokenRoutes.routeGraphViewModel.connectionsCount', { count: 0 }), 'weighted']);
    expect(getNodeCardMetrics(graph, unnamedEntry)).toEqual([text('pages.tokenRoutes.routeGraphViewModel.oneConnection')]);
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
