import { describe, expect, it, vi } from 'vitest';
import type { RouteGraphFocusedWorkspace } from '../../../shared/routeGraphWorkspace.js';
import { buildFocusCanvasModel } from './RouteGraphFocusCanvas.js';
import { canAttachManualRouteGraphEdge } from '../../../shared/routeGraph.js';
import type { RouteGraphWorkspaceSource } from './routeGraphWorkspace.js';

function manualNodeWorkspace(): RouteGraphFocusedWorkspace {
  const node = {
    id: 'manual:entry:test',
    type: 'entry' as const,
    name: 'Manual entry',
    enabled: true,
    ownership: 'manual' as const,
    match: {
      kind: 'model' as const,
      requestedModelPattern: 'test-model',
      displayName: 'Test model',
      downstreamProtocol: null,
      upstreamProtocol: null,
      sitePlatform: null,
      accountId: null,
      tokenId: null,
      siteId: null,
    },
  };
  return {
    revision: 'draft:1:0:1',
    representation: 'semantic',
    focus: { kind: 'node', id: node.id, label: node.name, subtitle: 'entry' },
    residentGraph: { nodes: [node], edges: [], macros: [], metadata: {} },
    residentElements: [{ element: { kind: 'node', id: node.id }, graphElementId: node.id }],
    portals: [],
    diagnostics: [],
    totals: { nodes: 1, edges: 0, macros: 0 },
    capabilities: { editable: true, primitiveAvailable: true },
  };
}

describe('RouteGraphFocusCanvas connection affordance', () => {
  it('keeps manual connection actions visible while direct drag authoring is temporarily blocked', () => {
    const workspace = manualNodeWorkspace();
    const graph: RouteGraphWorkspaceSource = {
      ...workspace.residentGraph,
      macros: workspace.residentGraph.macros || [],
    };
    const onStartConnection = vi.fn();
    const model = buildFocusCanvasModel(
      workspace,
      graph,
      vi.fn(),
      onStartConnection,
      false,
    );
    const resident = model.nodes.find((node) => node.data.kind === 'node');

    expect(resident?.data.kind).toBe('node');
    if (resident?.data.kind !== 'node') throw new Error('Expected resident node');
    expect(resident.data.connectionEditingEnabled).toBe(false);
    expect(resident.data.onStartConnection).toBe(onStartConnection);
  });

  it('uses the parent Source Graph edit mode as the sole connection-visibility gate', () => {
    const workspace = manualNodeWorkspace();
    const graph: RouteGraphWorkspaceSource = { ...workspace.residentGraph, macros: [] };
    const model = buildFocusCanvasModel(workspace, graph, vi.fn(), vi.fn(), true, false);
    const resident = model.nodes.find((node) => node.data.kind === 'node');

    expect(resident?.data.kind).toBe('node');
    if (resident?.data.kind !== 'node') throw new Error('Expected resident node');
    expect(resident.data.connectionEditingEnabled).toBe(false);
    expect(resident.data.onStartConnection).toBeUndefined();
  });

  it('uses the resolved port contract instead of element ownership to expose connection actions', () => {
    const workspace = manualNodeWorkspace();
    workspace.residentGraph.nodes[0].ownership = 'derived';
    const graph: RouteGraphWorkspaceSource = { ...workspace.residentGraph, macros: [] };
    const model = buildFocusCanvasModel(workspace, graph, vi.fn(), vi.fn(), true, true);
    const resident = model.nodes.find((node) => node.data.kind === 'node');

    expect(resident?.data.kind).toBe('node');
    if (resident?.data.kind !== 'node') throw new Error('Expected resident node');
    expect(resident.data.connectionEditingEnabled).toBe(true);
    expect(canAttachManualRouteGraphEdge(resident.data.ports[0])).toBe(true);
  });
});
