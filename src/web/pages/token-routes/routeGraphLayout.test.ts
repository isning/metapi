import { describe, expect, it } from 'vitest';
import { macroFlowNodeId } from './routeGraphConnections.js';
import { layoutRouteGraph } from './routeGraphLayout.js';
import type { RouteGraphEdge, RouteGraphMacro, RouteGraphNode } from './routeGraphTypes.js';

function node(input: Partial<RouteGraphNode> & Pick<RouteGraphNode, 'id' | 'type'>): RouteGraphNode {
  return {
    enabled: true,
    visibility: input.type === 'entry' ? 'public' : 'internal',
    ownership: 'auto_generated',
    ...input,
  };
}

function macro(input: Partial<RouteGraphMacro> & Pick<RouteGraphMacro, 'id'>): RouteGraphMacro {
  return {
    kind: 'candidate_selector',
    enabled: true,
    visibility: 'public',
    ownership: 'auto_generated',
    config: {},
    ...input,
  };
}

function edge(sourceNodeId: string, targetNodeId: string): RouteGraphEdge {
  return {
    id: `${sourceNodeId}->${targetNodeId}`,
    sourceNodeId,
    sourcePortId: 'bidirect.out',
    targetNodeId,
    targetPortId: 'bidirect.in',
    kind: 'bidirect_flow',
    ownership: 'auto_generated',
  };
}

describe('routeGraphLayout', () => {
  it('lays generated route graphs as a semantic flow instead of four-column rows', () => {
    const graph = layoutRouteGraph({
      nodes: [
        node({ id: 'entry:gpt', type: 'entry', ownership: 'auto_generated' }),
        node({ id: 'route:a', type: 'model_endpoint', routeId: 10 }),
        node({ id: 'route:b', type: 'model_endpoint', routeId: 11 }),
        node({ id: 'route:c', type: 'model_endpoint', routeId: 12 }),
        node({ id: 'route:d', type: 'model_endpoint', routeId: 13 }),
        node({ id: 'fallback', type: 'synthetic_endpoint' }),
      ],
      macros: [
        macro({
          id: 'route:1:model-group',
          config: {
            groups: [
              { priority: 0, input: { routeIds: [10, 11] } },
              { priority: 1, input: { routeIds: [12, 13] } },
            ],
          },
        }),
      ],
      edges: [
        edge('entry:gpt', macroFlowNodeId('route:1:model-group')),
        edge(macroFlowNodeId('route:1:model-group'), 'route:a'),
        edge(macroFlowNodeId('route:1:model-group'), 'route:b'),
        edge(macroFlowNodeId('route:1:model-group'), 'route:c'),
        edge(macroFlowNodeId('route:1:model-group'), 'route:d'),
        edge(macroFlowNodeId('route:1:model-group'), 'fallback'),
      ],
    }, { preserveExistingPositions: false });

    const entry = graph.nodes.find((item) => item.id === 'entry:gpt')!;
    const modelEndpoints = graph.nodes.filter((item) => item.type === 'model_endpoint');
    const group = graph.macros[0]!;

    expect(entry.position?.x).toBeLessThan(group.position!.x);
    expect(group.position?.x).toBeLessThan(Math.min(...modelEndpoints.map((item) => item.position!.x)));
    expect(new Set(modelEndpoints.map((item) => item.position!.x))).toHaveLength(1);
    expect(modelEndpoints.map((item) => item.position!.y)).toEqual([...modelEndpoints.map((item) => item.position!.y)].sort((a, b) => a - b));
  });

  it('preserves user positions when only filling missing generated positions', () => {
    const graph = layoutRouteGraph({
      nodes: [
        node({ id: 'entry:manual', type: 'entry', ownership: 'manual', position: { x: 44, y: 55 } }),
        node({ id: 'endpoint:auto', type: 'model_endpoint' }),
      ],
      macros: [],
      edges: [edge('entry:manual', 'endpoint:auto')],
    });

    expect(graph.nodes.find((item) => item.id === 'entry:manual')?.position).toEqual({ x: 44, y: 55 });
    expect(graph.nodes.find((item) => item.id === 'endpoint:auto')?.position?.x).toBeGreaterThan(44);
  });

  it('keeps collapsed macro rows compact enough for the semantic overview', () => {
    const graph = layoutRouteGraph({
      nodes: [],
      macros: [
        macro({ id: 'route:1:model-group' }),
        macro({ id: 'route:2:model-group' }),
        macro({ id: 'route:3:model-group' }),
      ],
      edges: [],
    }, { preserveExistingPositions: false });

    const yPositions = graph.macros.map((item) => item.position!.y);
    expect(yPositions).toEqual([96, 192, 288]);
  });
});
