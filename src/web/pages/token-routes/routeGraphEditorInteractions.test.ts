import { describe, expect, it } from 'vitest';

import {
  deleteSelectedGraphElements,
  selectionForContextMenu,
  selectionFromFlowNodeId,
  selectionFromFlowSelection,
  toggleGraphEdgeSelection,
  toggleGraphNodeSelection,
} from './routeGraphEditorInteractions.js';
import type {
  RouteGraphEdge,
  RouteGraphMacro,
  RouteGraphNode,
} from './routeGraphTypes.js';

function node(id: string, ownership: RouteGraphNode['ownership'] = 'manual'): RouteGraphNode {
  return {
    id,
    type: id.startsWith('entry') ? 'entry' : 'filter',
    enabled: true,
    visibility: id.startsWith('entry') ? 'public' : 'internal',
    ownership,
    match: { requestedModelPattern: id },
    operations: [],
  };
}

function edge(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  ownership: RouteGraphEdge['ownership'] = 'manual',
): RouteGraphEdge {
  return {
    id,
    sourceNodeId,
    sourcePortId: 'bidirect.out',
    targetNodeId,
    targetPortId: 'bidirect.in',
    kind: 'bidirect_flow',
    ownership,
  };
}

function macro(id: string, ownership: RouteGraphMacro['ownership'] = 'manual'): RouteGraphMacro {
  return {
    id,
    kind: 'candidate_selector',
    enabled: true,
    visibility: 'public',
    ownership,
    config: {},
  };
}

describe('routeGraphEditorInteractions', () => {
  it('derives a stable primary selection from ReactFlow node and edge selections', () => {
    expect(selectionFromFlowNodeId('entry.public')).toEqual({ kind: 'node', nodeId: 'entry.public' });
    expect(selectionFromFlowNodeId('macro:model-group')).toEqual({ kind: 'macro', macroId: 'model-group' });
    expect(selectionFromFlowSelection({ nodeIds: [], edgeIds: [] })).toBeNull();
    expect(selectionFromFlowSelection({ nodeIds: [], edgeIds: ['edge.a'] })).toEqual({ kind: 'edge', edgeId: 'edge.a' });
    expect(selectionFromFlowSelection({ nodeIds: ['entry.a', 'filter.b'], edgeIds: ['edge.a'] })).toEqual({ kind: 'node', nodeId: 'entry.a' });
    expect(selectionFromFlowSelection({ nodeIds: [], edgeIds: ['edge.a', 'edge.b'] })).toEqual({ kind: 'edge', edgeId: 'edge.a' });
  });

  it('toggles multi-selection without dropping the other element kind', () => {
    expect(toggleGraphNodeSelection({ nodeIds: ['entry.a'], edgeIds: ['edge.a'] }, 'filter.b')).toEqual({
      nodeIds: ['entry.a', 'filter.b'],
      edgeIds: ['edge.a'],
    });
    expect(toggleGraphNodeSelection({ nodeIds: ['entry.a', 'filter.b'], edgeIds: ['edge.a'] }, 'entry.a')).toEqual({
      nodeIds: ['filter.b'],
      edgeIds: ['edge.a'],
    });
    expect(toggleGraphEdgeSelection({ nodeIds: ['entry.a'], edgeIds: [] }, 'edge.a')).toEqual({
      nodeIds: ['entry.a'],
      edgeIds: ['edge.a'],
    });
    expect(toggleGraphEdgeSelection({ nodeIds: ['entry.a'], edgeIds: ['edge.a', 'edge.b'] }, 'edge.a')).toEqual({
      nodeIds: ['entry.a'],
      edgeIds: ['edge.b'],
    });
  });

  it('keeps existing multi-selection when opening a context menu on a selected element', () => {
    const current = { nodeIds: ['entry.a', 'filter.b'], edgeIds: ['edge.a'] };

    expect(selectionForContextMenu({
      current,
      target: { kind: 'node', nodeId: 'filter.b' },
    })).toBe(current);
    expect(selectionForContextMenu({
      current,
      target: { kind: 'edge', edgeId: 'edge.a' },
    })).toBe(current);
    expect(selectionForContextMenu({
      current,
      target: { kind: 'edge', edgeId: 'edge.unselected' },
    })).toEqual({ nodeIds: [], edgeIds: ['edge.unselected'] });
    expect(selectionForContextMenu({
      current,
      target: { kind: 'node', nodeId: 'filter.c' },
    })).toEqual({ nodeIds: ['filter.c'], edgeIds: [] });
    expect(selectionForContextMenu({
      current,
      target: { kind: 'macro', macroId: 'model-group' },
    })).toEqual({ nodeIds: ['macro:model-group'], edgeIds: [] });
    expect(selectionForContextMenu({
      current: { nodeIds: ['macro:model-group'], edgeIds: [] },
      target: { kind: 'macro', macroId: 'model-group' },
    })).toEqual({ nodeIds: ['macro:model-group'], edgeIds: [] });
    expect(selectionForContextMenu({
      current,
      target: { kind: 'graph' },
    })).toBe(current);
    expect(selectionForContextMenu({
      current,
      target: { kind: 'port', nodeId: 'entry.a', portId: 'request.in' },
    })).toBe(current);
  });

  it('deletes selected manual nodes, macros, edges, and incident edges while preserving generated items', () => {
    const graph = {
      version: 1 as const,
      nodes: [
        node('entry.a'),
        node('filter.manual'),
        node('filter.generated', 'auto_generated'),
      ],
      macros: [
        macro('macro.manual'),
        macro('macro.generated', 'auto_generated'),
      ],
      edges: [
        edge('edge.entry.manual', 'entry.a', 'filter.manual'),
        edge('edge.manual.generated', 'filter.manual', 'filter.generated'),
        edge('edge.generated', 'filter.generated', 'entry.a', 'auto_generated'),
        edge('edge.macro', 'macro:macro.manual', 'entry.a'),
      ],
      metadata: { source: 'test' },
    };

    const next = deleteSelectedGraphElements(
      graph,
      { kind: 'graph' },
      {
        nodeIds: ['filter.manual', 'filter.generated', 'macro:macro.manual', 'macro:macro.generated'],
        edgeIds: ['edge.generated'],
      },
    );

    expect(next.nodes.map((item) => item.id)).toEqual(['entry.a', 'filter.generated']);
    expect(next.macros.map((item) => item.id)).toEqual(['macro.generated']);
    expect(next.edges.map((item) => item.id)).toEqual(['edge.generated']);
    expect(next.metadata).toEqual({ source: 'test' });
  });

  it('falls back to the focused target when no batch selection is active', () => {
    const graph = {
      version: 1 as const,
      nodes: [node('entry.a'), node('filter.manual')],
      macros: [macro('macro.manual')],
      edges: [edge('edge.entry.manual', 'entry.a', 'filter.manual')],
    };

    expect(deleteSelectedGraphElements(graph, { kind: 'edge', edgeId: 'edge.entry.manual' }, { nodeIds: [], edgeIds: [] }).edges).toEqual([]);
    expect(deleteSelectedGraphElements(graph, { kind: 'macro', macroId: 'macro.manual' }, { nodeIds: [], edgeIds: [] }).macros).toEqual([]);
    expect(deleteSelectedGraphElements(graph, { kind: 'node', nodeId: 'filter.manual' }, { nodeIds: [], edgeIds: [] }).nodes.map((item) => item.id)).toEqual(['entry.a']);
  });

  it('returns the original graph when selection does not target deletable manual elements', () => {
    const graph = {
      version: 1 as const,
      nodes: [node('entry.generated', 'auto_generated')],
      macros: [macro('macro.generated', 'auto_generated')],
      edges: [edge('edge.generated', 'entry.generated', 'entry.generated', 'auto_generated')],
    };

    expect(deleteSelectedGraphElements(graph, { kind: 'node', nodeId: 'missing' }, { nodeIds: [], edgeIds: [] })).toBe(graph);
    expect(deleteSelectedGraphElements(graph, { kind: 'edge', edgeId: 'edge.generated' }, { nodeIds: [], edgeIds: [] })).toBe(graph);
    expect(deleteSelectedGraphElements(graph, { kind: 'macro', macroId: 'macro.generated' }, { nodeIds: [], edgeIds: [] })).toBe(graph);
  });
});
