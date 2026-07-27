import { describe, expect, it } from 'vitest';
import type { RouteGraphSource } from '../../shared/routeGraph.js';
import {
  createRouteGraphConnectionValidationSession,
  RouteGraphConnectionValidationError,
  resolveRouteGraphConnectionEndpoint,
  validateRouteGraphConnectionAgainstSource,
  validateRouteGraphEdgeMutation,
} from './routeGraphConnectionService.js';
import { buildRouteGraphSemanticIndex } from './routeGraphWorkspaceIndexService.js';

function graph(): RouteGraphSource {
  return {
    nodes: [
      {
        id: 'entry:a',
        type: 'entry',
        enabled: true,
        ownership: 'manual',
        match: { kind: 'model', requestedModelPattern: 'a', displayName: 'A' },
      },
      {
        id: 'filter:b',
        type: 'filter',
        enabled: true,
        ownership: 'manual',
        operations: [],
        dynamicPorts: [{ id: 'bidirect.alt.in', label: 'Alternative input', direction: 'input', kind: 'bidirect', manualEdgePolicy: 'allow', multiple: true }],
      },
      { id: 'filter:c', type: 'filter', enabled: true, ownership: 'manual', operations: [] },
      {
        id: 'dispatcher:manual',
        type: 'dispatcher',
        enabled: true,
        ownership: 'manual',
        mode: 'route',
        ordering: 'explicit',
        policy: { kind: 'inherit_default' },
      },
      {
        id: 'endpoint:derived-a',
        type: 'route_endpoint',
        enabled: true,
        ownership: 'derived',
        endpointKind: 'supply',
        exposure: 'none',
        resolutionStatus: 'resolved',
        sourceKind: 'upstream_model',
        config: {},
      },
      {
        id: 'endpoint:derived-b',
        type: 'route_endpoint',
        enabled: true,
        ownership: 'derived',
        endpointKind: 'supply',
        exposure: 'none',
        resolutionStatus: 'resolved',
        sourceKind: 'upstream_model',
        config: {},
      },
    ],
    macros: [],
    edges: [
      {
        id: 'edge:a-b',
        sourceNodeId: 'entry:a',
        sourcePortId: 'bidirect.out',
        targetNodeId: 'filter:b',
        targetPortId: 'bidirect.in',
        kind: 'bidirect_flow',
        ownership: 'manual',
      },
      {
        id: 'edge:b-c',
        sourceNodeId: 'filter:b',
        sourcePortId: 'bidirect.out',
        targetNodeId: 'filter:c',
        targetPortId: 'bidirect.in',
        kind: 'bidirect_flow',
        ownership: 'manual',
      },
    ],
  };
}

function expectCode(action: () => unknown, code: RouteGraphConnectionValidationError['code']) {
  try {
    action();
    throw new Error('Expected connection validation to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(RouteGraphConnectionValidationError);
    expect((error as RouteGraphConnectionValidationError).code).toBe(code);
  }
}

describe('route graph authoritative connection validation', () => {
  it('orients an incoming-first endpoint pair using authoritative ports', () => {
    const result = validateRouteGraphConnectionAgainstSource({
      graph: graph(),
      first: { element: { kind: 'node', id: 'filter:b' }, portId: 'bidirect.in' },
      second: { element: { kind: 'node', id: 'entry:a' }, portId: 'bidirect.out' },
      replacingEdgeId: 'edge:a-b',
    });
    expect(result.source.graphElementId).toBe('entry:a');
    expect(result.target.graphElementId).toBe('filter:b');
    expect(result.edgeKind).toBe('bidirect_flow');
  });

  it('uses the complete graph to reject a cycle outside a resident focus', () => {
    expectCode(() => validateRouteGraphConnectionAgainstSource({
      graph: graph(),
      first: { element: { kind: 'node', id: 'filter:c' }, portId: 'bidirect.out' },
      second: { element: { kind: 'node', id: 'filter:b' }, portId: 'bidirect.alt.in' },
    }), 'cycle');
  });

  it('allows a manual dispatcher to reference a derived supply endpoint', () => {
    const result = validateRouteGraphConnectionAgainstSource({
      graph: graph(),
      first: { element: { kind: 'node', id: 'dispatcher:manual' }, portId: 'route.in' },
      second: { element: { kind: 'node', id: 'endpoint:derived-a' }, portId: 'route.out' },
    });
    expect(result.source.graphElementId).toBe('endpoint:derived-a');
    expect(result.target.graphElementId).toBe('dispatcher:manual');
    expect(result.edgeKind).toBe('route_flow');
  });

  it('allows a manual edge between generated elements when their ports permit it', () => {
    const derivedGraph = graph();
    const derivedFilter = derivedGraph.nodes.find((node) => node.id === 'filter:b')!;
    derivedFilter.ownership = 'derived';
    const result = validateRouteGraphConnectionAgainstSource({
      graph: derivedGraph,
      first: { element: { kind: 'node', id: 'endpoint:derived-a' }, portId: 'bidirect.in' },
      second: { element: { kind: 'node', id: 'filter:b' }, portId: 'bidirect.out' },
    });
    expect(result.edgeKind).toBe('bidirect_flow');
  });

  it('rejects a manual edge only when both endpoint ports explicitly opt out', () => {
    const derivedGraph = graph();
    const filter = derivedGraph.nodes.find((node) => node.id === 'filter:b')!;
    filter.dynamicPorts = [{
      id: 'bidirect.locked.out',
      label: 'Locked output',
      direction: 'output',
      kind: 'bidirect',
      manualEdgePolicy: 'deny',
    }];
    const endpoint = derivedGraph.nodes.find((node) => node.id === 'endpoint:derived-a')!;
    endpoint.dynamicPorts = [{
      id: 'bidirect.locked.in',
      label: 'Locked input',
      direction: 'input',
      kind: 'bidirect',
      manualEdgePolicy: 'deny',
    }];
    expectCode(() => validateRouteGraphConnectionAgainstSource({
      graph: derivedGraph,
      first: { element: { kind: 'node', id: 'filter:b' }, portId: 'bidirect.locked.out' },
      second: { element: { kind: 'node', id: 'endpoint:derived-a' }, portId: 'bidirect.locked.in' },
    }), 'manual_edge_denied');
  });

  it('rejects a missing endpoint instead of silently dropping its edge', () => {
    expectCode(() => validateRouteGraphEdgeMutation(graph(), {
      id: 'edge:missing',
      sourceNodeId: 'missing',
      sourcePortId: 'bidirect.out',
      targetNodeId: 'filter:b',
      targetPortId: 'bidirect.in',
      kind: 'bidirect_flow',
      ownership: 'manual',
    }), 'element_not_found');
  });

  it('reuses one complete-graph validation context across a large target set', () => {
    const nodes = Array.from({ length: 10_000 }, (_, index) => ({
      id: `filter:${index}`,
      type: 'filter' as const,
      enabled: true,
      ownership: 'manual' as const,
      operations: [],
    }));
    const source: RouteGraphSource = { nodes, macros: [], edges: [] };
    const session = createRouteGraphConnectionValidationSession({
      graph: source,
      first: { element: { kind: 'node', id: 'filter:0' }, portId: 'bidirect.out' },
    });
    const index = buildRouteGraphSemanticIndex(source);
    let compatible = 0;
    for (let candidateIndex = 1; candidateIndex < nodes.length; candidateIndex += 1) {
      const endpoint = resolveRouteGraphConnectionEndpoint(index, {
        element: { kind: 'node', id: `filter:${candidateIndex}` },
        portId: 'bidirect.in',
      });
      if (session.validate(endpoint).edgeKind === 'bidirect_flow') compatible += 1;
    }
    expect(compatible).toBe(9_999);
  });
});
