import { describe, expect, it } from 'vitest';
import { macroFlowNodeId } from './routeGraphConnections.js';
import { DEFAULT_ROUTE_GRAPH_VIEW_STATE, canReplaceRouteGraphMacro, canReplaceRouteGraphNode, computeRouteGraphInspectorAnchor, filterGraphForView, filterRouteGraphFlowNodeChanges, getMacroGeneratedPreviewRows, getMacroHiddenSupplyByPort, isRouteGraphFlowNodeDraggable, preservesGeneratedRouteGraphArtifacts } from './RouteGraphWorkbench.js';
import type { RouteGraphEdge, RouteGraphMacro, RouteGraphNode } from './routeGraphTypes.js';

function generatedNode(id: string, type: RouteGraphNode['type']): RouteGraphNode {
  return {
    id,
    type,
    enabled: true,
    visibility: type === 'entry' ? 'public' : 'internal',
    ownership: 'auto_generated',
  };
}

const generatedEntry = generatedNode('entry:legacy:127', 'entry');
const generatedRouteEndpoint = generatedNode('route-endpoint:product:route:127', 'route_endpoint');
const generatedSupplyEndpoint: RouteGraphNode = {
  ...generatedNode('route-endpoint:supply:route:127:openai:gpt-test', 'route_endpoint'),
  endpointKind: 'supply',
  routeEndpointId: 'route-endpoint:supply:route:127:openai:gpt-test',
  resolvesTo: { kind: 'model_endpoint', id: 'pool:legacy:127' },
};
const generatedDispatcher = generatedNode('dispatcher:legacy:127', 'dispatcher');
const generatedEndpoint = generatedNode('pool:legacy:127', 'model_endpoint');
const otherGeneratedEntry = generatedNode('entry:legacy:128', 'entry');
const otherGeneratedRouteEndpoint = generatedNode('route-endpoint:product:route:128', 'route_endpoint');

const manualFilter: RouteGraphNode = {
  id: 'filter:manual',
  type: 'filter',
  enabled: true,
  visibility: 'internal',
  ownership: 'manual',
};

const generatedMacro: RouteGraphMacro = {
  id: 'route:auto:model-group',
  kind: 'candidate_selector',
  enabled: true,
  visibility: 'public',
  ownership: 'auto_generated',
  position: { x: 640, y: 320 },
  config: {
    groups: [{ input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:supply:route:127:openai:gpt-test'] } }],
  },
};

const manualMacro: RouteGraphMacro = {
  id: 'route:manual:model-group',
  kind: 'candidate_selector',
  enabled: true,
  visibility: 'public',
  ownership: 'manual',
  position: { x: 760, y: 320 },
  config: {
    groups: [{ input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:supply:route:127:openai:gpt-test'] } }],
  },
};

const otherMacro: RouteGraphMacro = {
  id: 'route:other:model-group',
  kind: 'candidate_selector',
  enabled: true,
  visibility: 'public',
  ownership: 'auto_generated',
  config: {
    groups: [{ input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:product:route:128'] } }],
  },
};

const edges: RouteGraphEdge[] = [
  {
    id: 'entry-dispatcher',
    sourceNodeId: 'entry:legacy:127',
    sourcePortId: 'bidirect.out',
    targetNodeId: 'dispatcher:legacy:127',
    targetPortId: 'bidirect.in',
    kind: 'bidirect_flow',
    ownership: 'auto_generated',
  },
  {
    id: 'pool-dispatcher',
    sourceNodeId: 'pool:legacy:127',
    sourcePortId: 'route.out',
    targetNodeId: 'dispatcher:legacy:127',
    targetPortId: 'route.in',
    kind: 'route_flow',
    ownership: 'auto_generated',
  },
  {
    id: 'supply-macro-candidates',
    sourceNodeId: 'route-endpoint:supply:route:127:openai:gpt-test',
    sourcePortId: 'route.out',
    targetNodeId: macroFlowNodeId(generatedMacro.id),
    targetPortId: 'candidates.in',
    kind: 'route_flow',
    ownership: 'auto_generated',
  },
  {
    id: 'macro-manual',
    sourceNodeId: macroFlowNodeId(generatedMacro.id),
    sourcePortId: 'route.out',
    targetNodeId: 'filter:manual',
    targetPortId: 'route.in',
    kind: 'route_flow',
    ownership: 'manual',
  },
];

const graph = {
  version: 2 as const,
  nodes: [generatedEntry, generatedRouteEndpoint, generatedSupplyEndpoint, generatedDispatcher, generatedEndpoint, otherGeneratedEntry, otherGeneratedRouteEndpoint, manualFilter],
  macros: [generatedMacro, otherMacro],
  edges,
};

function absoluteAnchor(anchor: { x: number; y: number }, container: { left: number; top: number }) {
  return { left: anchor.x + container.left, top: anchor.y + container.top };
}

function overlaps(
  panel: { left: number; top: number; width: number; height: number },
  target: { left: number; right: number; top: number; bottom: number },
) {
  return panel.left < target.right
    && panel.left + panel.width > target.left
    && panel.top < target.bottom
    && panel.top + panel.height > target.top;
}

describe('RouteGraphWorkbench view filtering', () => {
  it('keeps the advanced JSON workbench constrained to its parent width', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/web/pages/token-routes/RouteGraphWorkbench.tsx', 'utf8');

    expect(source).toContain('route-graph-advanced-json min-w-0 max-w-full overflow-hidden');
  });

  it('does not render hidden supply count zero as toolbar text', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/web/pages/token-routes/RouteGraphWorkbench.tsx', 'utf8');

    expect(source).not.toContain('data.__hiddenSupplyCount &&');
    expect(source).toContain('(data.__hiddenSupplyCount || 0) > 0');
  });

  it('anchors the inspector beside the selected node without covering it when there is room', () => {
    const container = { left: 0, right: 1200, top: 0, bottom: 800 };
    const target = { left: 260, right: 480, top: 160, bottom: 260 };
    const anchor = computeRouteGraphInspectorAnchor({
      target,
      container,
      bounds: container,
      viewportWidth: 1200,
      panelWidth: 360,
      panelHeight: 420,
    });
    const panel = { ...absoluteAnchor(anchor, container), width: 360, height: 420 };

    expect(anchor.side).toBe('right');
    expect(overlaps(panel, target)).toBe(false);
  });

  it('moves the inspector away from a right-edge node instead of clamping over it', () => {
    const container = { left: 0, right: 900, top: 0, bottom: 700 };
    const target = { left: 710, right: 880, top: 120, bottom: 220 };
    const anchor = computeRouteGraphInspectorAnchor({
      target,
      container,
      bounds: container,
      viewportWidth: 900,
      panelWidth: 360,
      panelHeight: 420,
    });
    const panel = { ...absoluteAnchor(anchor, container), width: 360, height: 420 };

    expect(anchor.side).toBe('left');
    expect(overlaps(panel, target)).toBe(false);
  });

  it('keeps only manual graph nodes and macros draggable on the canvas', () => {
    expect(isRouteGraphFlowNodeDraggable(manualMacro, 'macro')).toBe(true);
    expect(isRouteGraphFlowNodeDraggable(generatedMacro, 'macro')).toBe(false);
    expect(isRouteGraphFlowNodeDraggable({ ...generatedMacro, ownership: 'system' }, 'macro')).toBe(false);
    expect(isRouteGraphFlowNodeDraggable(manualFilter, 'node')).toBe(true);
    expect(isRouteGraphFlowNodeDraggable(generatedRouteEndpoint, 'node')).toBe(false);
    expect(isRouteGraphFlowNodeDraggable({ ...generatedRouteEndpoint, ownership: 'derived' }, 'node')).toBe(false);
  });

  it('drops position changes for generated flow nodes and macros', () => {
    const changes = filterRouteGraphFlowNodeChanges([
      { id: 'macro:route:auto:model-group', type: 'position', position: { x: 10, y: 20 } },
      { id: 'macro:route:manual:model-group', type: 'position', position: { x: 30, y: 40 } },
      { id: 'route-endpoint:product:route:127', type: 'position', position: { x: 50, y: 60 } },
      { id: 'filter:manual', type: 'position', position: { x: 70, y: 80 } },
      { id: 'macro:route:auto:model-group', type: 'select', selected: true },
    ], [
      { id: 'macro:route:auto:model-group', type: 'macro', data: { ...generatedMacro, __isMacroNode: true }, position: { x: 0, y: 0 } },
      { id: 'macro:route:manual:model-group', type: 'macro', data: { ...manualMacro, __isMacroNode: true }, position: { x: 0, y: 0 } },
      { id: 'route-endpoint:product:route:127', type: 'route_endpoint', data: generatedRouteEndpoint, position: { x: 0, y: 0 } },
      { id: 'filter:manual', type: 'filter', data: manualFilter, position: { x: 0, y: 0 } },
    ]);

    expect(changes.map((change) => `${change.type}:${change.id}`)).toEqual([
      'position:macro:route:manual:model-group',
      'position:filter:manual',
      'select:macro:route:auto:model-group',
    ]);
  });

  it('allows replacing only manual graph nodes and macros from editor forms', () => {
    expect(canReplaceRouteGraphNode(graph, { ...manualFilter, name: 'Manual filter' })).toBe(true);
    expect(canReplaceRouteGraphNode(graph, { ...generatedRouteEndpoint, enabled: false })).toBe(false);
    expect(canReplaceRouteGraphNode(graph, { ...generatedRouteEndpoint, ownership: 'manual' })).toBe(false);
    expect(canReplaceRouteGraphMacro(graph, { ...generatedMacro, visibility: 'internal' })).toBe(false);
    expect(canReplaceRouteGraphMacro(graph, { ...generatedMacro, ownership: 'manual' })).toBe(false);
  });

  it('rejects whole-graph JSON edits that change generated artifacts', () => {
    expect(preservesGeneratedRouteGraphArtifacts(graph, {
      ...graph,
      nodes: graph.nodes.map((node) => node.id === generatedRouteEndpoint.id ? { ...node, enabled: false } : node),
    })).toBe(false);
    expect(preservesGeneratedRouteGraphArtifacts(graph, {
      ...graph,
      nodes: graph.nodes.map((node) => node.id === manualFilter.id ? { ...node, name: 'Manual filter' } : node),
    })).toBe(true);
  });

  it('keeps generated macros visible while collapsing generated primitive details by default', () => {
    const visible = filterGraphForView(graph, DEFAULT_ROUTE_GRAPH_VIEW_STATE);

    expect(visible.nodes.map((node) => node.id)).toEqual(['filter:manual']);
    expect(visible.macros.map((macro) => macro.id)).toEqual([generatedMacro.id, otherMacro.id]);
    expect(visible.edges.map((edge) => edge.id)).toEqual(['macro-manual']);
  });

  it('marks hidden supply on the collapsed macro candidates port', () => {
    expect(getMacroHiddenSupplyByPort(graph, generatedMacro)).toEqual({ 'candidates.in': 1 });
  });

  it('preserves route_endpoint node types from backend graphs', () => {
    const visible = filterGraphForView(graph, { ...DEFAULT_ROUTE_GRAPH_VIEW_STATE, showGeneratedPrimitives: true });

    expect(visible.nodes.find((node) => node.id === 'route-endpoint:product:route:127')?.type).toBe('route_endpoint');
  });

  it('global primitive expansion hides generated macros to avoid duplicate route representations', () => {
    const visible = filterGraphForView(graph, { ...DEFAULT_ROUTE_GRAPH_VIEW_STATE, showGeneratedPrimitives: true });

    expect(visible.nodes.map((node) => node.id)).toEqual([
      'entry:legacy:127',
      'route-endpoint:product:route:127',
      'route-endpoint:supply:route:127:openai:gpt-test',
      'dispatcher:legacy:127',
      'pool:legacy:127',
      'entry:legacy:128',
      'route-endpoint:product:route:128',
      'filter:manual',
      'macro:route:auto:model-group:entry',
      'macro:route:auto:model-group:dispatcher',
      'macro:route:other:model-group:entry',
      'macro:route:other:model-group:dispatcher',
    ]);
    expect(visible.macros).toEqual([]);
    expect(visible.edges.map((edge) => edge.id)).toEqual(expect.arrayContaining([
      'entry-dispatcher',
      'pool-dispatcher',
      'macro:route:auto:model-group:edge:entry-dispatcher',
      'macro:route:other:model-group:edge:entry-dispatcher',
      'macro-semantic:supply-macro-candidates:candidate-in',
      'macro-semantic:macro-manual:route-out:route-endpoint:supply:route:127:openai:gpt-test',
    ]));
    expect(visible.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'macro-semantic:supply-macro-candidates:candidate-in',
        sourceNodeId: 'route-endpoint:supply:route:127:openai:gpt-test',
        sourcePortId: 'route.out',
        targetNodeId: 'macro:route:auto:model-group:dispatcher',
        targetPortId: 'route.in',
      }),
    ]));
  });

  it('can expand one macro without expanding supply projections', () => {
    const visible = filterGraphForView(graph, { ...DEFAULT_ROUTE_GRAPH_VIEW_STATE, expandedMacroIds: [generatedMacro.id] });

    expect(visible.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      'filter:manual',
      'macro:route:auto:model-group:entry',
      'macro:route:auto:model-group:dispatcher',
    ]));
    expect(visible.nodes.some((node) => node.id === 'route-endpoint:supply:route:127:openai:gpt-test')).toBe(false);
    expect(visible.nodes).toHaveLength(3);
    expect(visible.macros.map((macro) => macro.id)).toEqual([otherMacro.id]);
    expect(visible.edges.map((edge) => edge.id)).toEqual([
      'macro:route:auto:model-group:edge:entry-dispatcher',
    ]);
    const dispatcher = visible.nodes.find((node) => node.id === 'macro:route:auto:model-group:dispatcher')!;
    const entry = visible.nodes.find((node) => node.id === 'macro:route:auto:model-group:entry')!;
    expect(dispatcher.position).toEqual({ x: 640, y: 320 });
    expect(entry.position).toEqual({ x: 364, y: 272 });
    expect(visible.nodes.some((node) => node.id.startsWith('macro:route:other:model-group:'))).toBe(false);
  });

  it('can expand hidden supply without expanding the macro itself', () => {
    const visible = filterGraphForView(graph, { ...DEFAULT_ROUTE_GRAPH_VIEW_STATE, expandedSupplyMacroIds: [generatedMacro.id] });

    expect(visible.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      'filter:manual',
      'route-endpoint:supply:route:127:openai:gpt-test',
    ]));
    expect(visible.macros.map((macro) => macro.id)).toEqual([generatedMacro.id, otherMacro.id]);
    expect(visible.edges.map((edge) => edge.id)).toEqual(expect.arrayContaining([
      'supply-macro-candidates',
      'macro-manual',
    ]));
    expect(visible.edges.find((edge) => edge.id === 'supply-macro-candidates')).toMatchObject({
      sourceNodeId: 'route-endpoint:supply:route:127:openai:gpt-test',
      targetNodeId: macroFlowNodeId(generatedMacro.id),
      targetPortId: 'candidates.in',
    });
    const candidate = visible.nodes.find((node) => node.id === 'route-endpoint:supply:route:127:openai:gpt-test')!;
    expect(candidate.position).toEqual({ x: 364, y: 320 });
  });

  it('builds macro inspector preview rows from candidate edges for existing route endpoints', () => {
    const rows = getMacroGeneratedPreviewRows(graph, generatedMacro);

    expect(rows).toEqual([
      expect.objectContaining({
        routeId: 127,
        endpointId: 'route-endpoint:supply:route:127:openai:gpt-test',
        nodeIds: expect.arrayContaining([
          'macro:route:auto:model-group:entry',
          'macro:route:auto:model-group:dispatcher',
          'route-endpoint:supply:route:127:openai:gpt-test',
        ]),
        links: expect.arrayContaining([
          expect.objectContaining({
            sourceNodeId: 'route-endpoint:supply:route:127:openai:gpt-test',
            targetNodeId: 'macro:route:auto:model-group:dispatcher',
            label: 'candidate input',
          }),
        ]),
      }),
    ]);
  });

  it('falls back to macro endpoint groups when lowered candidate edges are unavailable', () => {
    const rows = getMacroGeneratedPreviewRows({
      version: 2,
      nodes: [generatedRouteEndpoint],
      macros: [generatedMacro],
      edges: [],
    }, generatedMacro);

    expect(rows).toEqual([
      expect.objectContaining({
        routeId: 127,
        endpointId: 'route-endpoint:supply:route:127:openai:gpt-test',
        nodeIds: expect.arrayContaining(['route-endpoint:supply:route:127:openai:gpt-test']),
        links: expect.arrayContaining([
          expect.objectContaining({
            sourceNodeId: 'route-endpoint:supply:route:127:openai:gpt-test',
            targetNodeId: 'macro:route:auto:model-group:dispatcher',
            label: 'candidate input',
          }),
        ]),
      }),
    ]);
  });

  it('anchors expanded primitives at the laid-out macro position when the macro has no saved position', () => {
    const graphWithoutMacroPosition = {
      ...graph,
      macros: [{ ...generatedMacro, position: undefined }, otherMacro],
    };
    const collapsed = filterGraphForView(graphWithoutMacroPosition, DEFAULT_ROUTE_GRAPH_VIEW_STATE);
    const expanded = filterGraphForView(graphWithoutMacroPosition, { ...DEFAULT_ROUTE_GRAPH_VIEW_STATE, expandedMacroIds: [generatedMacro.id] });
    const collapsedMacro = collapsed.macros.find((macro) => macro.id === generatedMacro.id)!;
    const expandedDispatcher = expanded.nodes.find((node) => node.id === 'macro:route:auto:model-group:dispatcher')!;
    const expandedEntry = expanded.nodes.find((node) => node.id === 'macro:route:auto:model-group:entry')!;

    expect(collapsedMacro.position).toBeDefined();
    expect(expandedDispatcher.position?.x).toBe(collapsedMacro.position?.x);
    expect(expandedDispatcher.position?.y).toBe(collapsedMacro.position?.y);
    expect(expandedEntry.position?.x).toBe((collapsedMacro.position?.x || 0) - 276);
    expect(expandedEntry.position?.y).toBeLessThan(collapsedMacro.position?.y || 0);
    expect(expandedDispatcher.position).not.toEqual({ x: 120, y: 120 });
  });

  it('reserves space for a locally expanded macro before rendering following collapsed macros', () => {
    const graphWithoutMacroPositions = {
      ...graph,
      macros: [
        { ...generatedMacro, position: undefined },
        { ...otherMacro, position: undefined },
        { ...otherMacro, id: 'route:third:model-group', position: undefined },
      ],
    };
    const expanded = filterGraphForView(graphWithoutMacroPositions, { ...DEFAULT_ROUTE_GRAPH_VIEW_STATE, expandedMacroIds: [generatedMacro.id] });
    const expandedDispatcher = expanded.nodes.find((node) => node.id === 'macro:route:auto:model-group:dispatcher')!;
    const followingMacro = expanded.macros.find((macro) => macro.id === otherMacro.id)!;
    const thirdMacro = expanded.macros.find((macro) => macro.id === 'route:third:model-group')!;

    expect(followingMacro.position!.y).toBeGreaterThan(expandedDispatcher.position!.y + 100);
    expect(thirdMacro.position!.y).toBeGreaterThan(followingMacro.position!.y);
  });

  it('does not reserve center-column space for a long left-side expanded input list', () => {
    const longInputGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        generatedNode('route-endpoint:product:route:129', 'route_endpoint'),
        generatedNode('pool:legacy:128', 'model_endpoint'),
        generatedNode('pool:legacy:129', 'model_endpoint'),
      ],
      macros: [
        {
          ...generatedMacro,
          position: { x: 640, y: 320 },
          config: {
            groups: [{
              input: {
                kind: 'route_endpoints',
                endpointIds: ['route-endpoint:product:route:127', 'route-endpoint:product:route:128', 'route-endpoint:product:route:129'],
              },
            }],
          },
        },
        { ...otherMacro, position: { x: 640, y: 432 } },
      ],
    };
    const expanded = filterGraphForView(longInputGraph, { ...DEFAULT_ROUTE_GRAPH_VIEW_STATE, expandedMacroIds: [generatedMacro.id] });
    const followingMacro = expanded.macros.find((macro) => macro.id === otherMacro.id)!;

    expect(followingMacro.position).toEqual({ x: 640, y: 448 });
  });
});
