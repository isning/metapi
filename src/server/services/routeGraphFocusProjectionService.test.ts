import { describe, expect, it } from 'vitest';
import { createRouteMacroSemanticNodeId } from '../../shared/routingIdentity.js';
import type { RouteGraphSource } from '../../shared/routeGraph.js';
import {
  buildRouteGraphFocusedWorkspace,
  decodeRouteGraphWorkspaceWindowToken,
  RouteGraphWorkspaceWindowTokenError,
} from './routeGraphFocusProjectionService.js';

const macro = (id: string) => ({
  id,
  name: id,
  kind: 'candidate_selector' as const,
  enabled: true,
  ownership: 'system' as const,
  config: {
    surface: {
      entry: {
        kind: 'external',
        match: { kind: 'model', requestedModelPattern: id, displayName: id },
      },
      output: 'route',
      ports: [
        { id: 'candidates.in', label: 'Candidates', direction: 'input', kind: 'route', collection: { type: 'set', min: 1 } },
        { id: 'route.out', label: 'Route', direction: 'output', kind: 'route' },
      ],
    },
    policy: { kind: 'inherit_default' },
    groups: [],
  },
});

const endpoint = (id: string) => ({
  id,
  name: id,
  type: 'route_endpoint' as const,
  enabled: true,
  ownership: 'system' as const,
  routeEndpointId: id,
  endpointKind: 'supply' as const,
  exposure: 'none' as const,
  resolutionStatus: 'resolved' as const,
  ownerKind: 'manual' as const,
  sourceKind: 'upstream_model' as const,
  backend: { kind: 'supply' as const },
  config: { targets: [{ targetId: `target:${id}`, model: id }] },
});

const edge = (id: string, endpointId: string, macroId: string) => ({
  id,
  sourceNodeId: endpointId,
  sourcePortId: 'route.out',
  targetNodeId: createRouteMacroSemanticNodeId(macroId),
  targetPortId: 'candidates.in',
  kind: 'route_flow' as const,
  ownership: 'system' as const,
});

describe('routeGraphFocusProjectionService', () => {
  it('returns one explicit focus without unrelated macros', () => {
    const graph: RouteGraphSource = {
      nodes: [endpoint('endpoint:a'), endpoint('endpoint:b')],
      macros: [macro('route:a'), macro('route:b')],
      edges: [edge('edge:a', 'endpoint:a', 'route:a'), edge('edge:b', 'endpoint:b', 'route:b')],
    };

    const workspace = buildRouteGraphFocusedWorkspace({
      graph,
      diagnostics: [],
      revision: 'draft:1',
      focus: { kind: 'macro', id: 'route:a' },
      representation: 'semantic',
    });

    expect(workspace.residentGraph.macros.map((item) => item.id)).toEqual(['route:a']);
    expect(workspace.residentGraph.nodes.map((item) => item.id)).toEqual(['endpoint:a']);
    expect(workspace.residentGraph.edges.map((item) => item.id)).toEqual(['edge:a']);
    expect(workspace.focus).toMatchObject({ kind: 'macro', id: 'route:a', label: 'route:a' });
    expect(workspace.residentElements).toEqual(expect.arrayContaining([
      { element: { kind: 'macro', id: 'route:a' }, graphElementId: createRouteMacroSemanticNodeId('route:a') },
      { element: { kind: 'node', id: 'endpoint:a' }, graphElementId: 'endpoint:a' },
    ]));
  });

  it('windows collection ports and represents every omitted relationship', () => {
    const nodes = Array.from({ length: 1_000 }, (_, index) => endpoint(`endpoint:${String(index).padStart(4, '0')}`));
    const graph: RouteGraphSource = {
      nodes,
      macros: [macro('route:many')],
      edges: nodes.map((node, index) => edge(`edge:${String(index).padStart(2, '0')}`, node.id, 'route:many')),
    };

    const first = buildRouteGraphFocusedWorkspace({
      graph,
      diagnostics: [],
      revision: 'draft:1',
      focus: { kind: 'macro', id: 'route:many' },
      representation: 'semantic',
      collectionWindowSize: 24,
    });

    expect(first.residentGraph.nodes).toHaveLength(24);
    expect(first.residentGraph.edges).toHaveLength(24);
    const nextPortal = first.portals.find((portal) => portal.kind === 'collection' && portal.collection?.action === 'next');
    expect(nextPortal).toMatchObject({
      direction: 'incoming',
      label: '976 more connections',
      connection: { count: 976, portLabel: 'Candidates' },
      collection: { action: 'next', start: 24, end: 48, total: 1_000 },
      destination: { kind: 'window' },
    });
    expect(first.residentGraph.edges.length + (nextPortal?.connection.count || 0)).toBe(1_000);
    expect(nextPortal?.destination.kind === 'window'
      ? decodeRouteGraphWorkspaceWindowToken(nextPortal.destination.token)
      : null).toMatchObject({ revision: 'draft:1', focus: { kind: 'macro', id: 'route:many' } });

    const second = buildRouteGraphFocusedWorkspace({
      graph,
      diagnostics: [],
      revision: 'draft:1',
      focus: { kind: 'macro', id: 'route:many' },
      representation: 'semantic',
      collectionWindowSize: 24,
      windowToken: nextPortal?.destination.kind === 'window' ? nextPortal.destination.token : undefined,
    });

    expect(second.residentGraph.nodes.map((item) => item.id)).toEqual(nodes.slice(24, 48).map((item) => item.id));
    expect(second.portals.filter((portal) => portal.kind === 'collection').map((portal) => portal.collection?.action).sort()).toEqual(['next', 'previous']);
    expect(second.residentGraph.nodes).toHaveLength(24);
    expect(
      second.residentGraph.edges.length
      + second.portals.filter((portal) => portal.kind === 'collection')
        .reduce((sum, portal) => sum + portal.connection.count, 0),
    ).toBe(1_000);
  });

  it('emits a labeled neighbor portal instead of silently crossing another traversal boundary', () => {
    const graph: RouteGraphSource = {
      nodes: [{
        id: 'entry:a',
        name: 'Entry A',
        type: 'entry',
        enabled: true,
        ownership: 'manual',
        match: { kind: 'model', requestedModelPattern: 'a', displayName: 'Entry A' },
      }],
      macros: [macro('route:a')],
      edges: [{
        id: 'edge:entry-macro',
        sourceNodeId: 'entry:a',
        sourcePortId: 'bidirect.out',
        targetNodeId: createRouteMacroSemanticNodeId('route:a'),
        targetPortId: 'bidirect.in',
        kind: 'bidirect_flow',
        ownership: 'manual',
      }],
    };

    const workspace = buildRouteGraphFocusedWorkspace({
      graph,
      diagnostics: [],
      revision: 'draft:1',
      focus: { kind: 'node', id: 'entry:a' },
      representation: 'semantic',
    });

    expect(workspace.residentGraph.nodes.map((item) => item.id)).toEqual(['entry:a']);
    expect(workspace.residentGraph.macros).toEqual([]);
    expect(workspace.portals).toEqual([
      expect.objectContaining({
        kind: 'neighbor',
        direction: 'outgoing',
        label: 'route:a',
        connection: {
          edgeKind: 'bidirect_flow',
          count: 1,
          portLabel: 'matched flow',
          edges: [{ id: 'edge:entry-macro', destinationPortId: 'bidirect.in', ownership: 'manual' }],
        },
        preview: { elementKind: 'macro', subtitle: 'candidate_selector', enabled: true },
        destination: { kind: 'focus', focus: { kind: 'macro', id: 'route:a' } },
      }),
    ]);
  });

  it('keeps derived entries inside a Macro focus and previews authored entries as boundaries', () => {
    const authoredEntry = {
      id: 'entry:authored',
      name: 'Authored entry',
      type: 'entry' as const,
      enabled: false,
      ownership: 'manual' as const,
      match: { kind: 'model' as const, requestedModelPattern: 'authored', displayName: 'Authored entry' },
    };
    const derivedEntry = {
      ...authoredEntry,
      id: 'entry:derived',
      name: 'Derived entry',
      enabled: true,
      ownership: 'derived' as const,
      match: { kind: 'model' as const, requestedModelPattern: 'derived', displayName: 'Derived entry' },
    };
    const macroElementId = createRouteMacroSemanticNodeId('route:boundary');
    const graph: RouteGraphSource = {
      nodes: [authoredEntry, derivedEntry],
      macros: [macro('route:boundary')],
      edges: [
        { id: 'edge:authored', sourceNodeId: authoredEntry.id, sourcePortId: 'bidirect.out', targetNodeId: macroElementId, targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'edge:derived', sourceNodeId: derivedEntry.id, sourcePortId: 'bidirect.out', targetNodeId: macroElementId, targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'system' },
      ],
    };

    const workspace = buildRouteGraphFocusedWorkspace({
      graph,
      diagnostics: [],
      revision: 'draft:1',
      focus: { kind: 'macro', id: 'route:boundary' },
      representation: 'semantic',
    });

    expect(workspace.residentGraph.nodes.map((node) => node.id)).toEqual(['entry:derived']);
    expect(workspace.residentGraph.edges.map((item) => item.id)).toEqual(['edge:derived']);
    expect(workspace.portals).toEqual([
      expect.objectContaining({
        kind: 'neighbor',
        label: 'Authored entry',
        preview: { elementKind: 'entry', subtitle: null, enabled: false },
        destination: { kind: 'focus', focus: { kind: 'node', id: 'entry:authored' } },
      }),
    ]);
  });

  it('windows each authoritative collection port independently and replaces only that port window', () => {
    const primary = Array.from({ length: 7 }, (_, index) => endpoint(`endpoint:primary:${index}`));
    const fallback = Array.from({ length: 7 }, (_, index) => endpoint(`endpoint:fallback:${index}`));
    const entry = {
      id: 'entry:stages',
      name: 'Stage entry',
      type: 'entry' as const,
      enabled: true,
      ownership: 'manual' as const,
      match: { kind: 'model' as const, requestedModelPattern: 'stages', displayName: 'Stage entry' },
    };
    const dispatcher = {
      id: 'dispatcher:stages',
      name: 'Stages',
      type: 'dispatcher' as const,
      enabled: true,
      ownership: 'manual' as const,
      mode: 'flow' as const,
      policy: { kind: 'inherit_default' as const },
      dynamicPorts: [
        { id: 'stage.primary.out', label: 'Primary stage', direction: 'output' as const, kind: 'bidirect' as const, collection: { type: 'arr' as const } },
        { id: 'stage.fallback.out', label: 'Fallback stage', direction: 'output' as const, kind: 'bidirect' as const, collection: { type: 'arr' as const } },
      ],
    };
    const stageEdges = [
      ...primary.map((node, index) => ({ id: `edge:primary:${index}`, sourceNodeId: dispatcher.id, sourcePortId: 'stage.primary.out', targetNodeId: node.id, targetPortId: 'bidirect.in', kind: 'bidirect_flow' as const, ownership: 'manual' as const })),
      ...fallback.map((node, index) => ({ id: `edge:fallback:${index}`, sourceNodeId: dispatcher.id, sourcePortId: 'stage.fallback.out', targetNodeId: node.id, targetPortId: 'bidirect.in', kind: 'bidirect_flow' as const, ownership: 'manual' as const })),
    ];
    const graph: RouteGraphSource = {
      nodes: [entry, dispatcher, ...primary, ...fallback],
      macros: [],
      edges: [
        { id: 'edge:entry-dispatcher', sourceNodeId: entry.id, sourcePortId: 'bidirect.out', targetNodeId: dispatcher.id, targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        ...stageEdges,
      ],
    };
    const first = buildRouteGraphFocusedWorkspace({
      graph,
      diagnostics: [],
      revision: 'draft:1',
      focus: { kind: 'node', id: entry.id },
      representation: 'semantic',
      collectionWindowSize: 2,
    });
    const nextPortals = first.portals.filter((portal) => portal.kind === 'collection' && portal.collection.action === 'next');

    expect(nextPortals.map((portal) => portal.connection.portLabel).sort()).toEqual(['Fallback stage', 'Primary stage']);
    expect(nextPortals.map((portal) => portal.connection.count)).toEqual([5, 5]);
    expect(first.residentGraph.nodes).toHaveLength(6);

    const primaryPortal = nextPortals.find((portal) => portal.connection.portLabel === 'Primary stage');
    if (!primaryPortal || primaryPortal.destination.kind !== 'window') throw new Error('Expected primary stage window');
    const second = buildRouteGraphFocusedWorkspace({
      graph,
      diagnostics: [],
      revision: 'draft:1',
      focus: { kind: 'node', id: entry.id },
      representation: 'semantic',
      collectionWindowSize: 2,
      windowToken: primaryPortal.destination.token,
    });

    expect(second.residentGraph.nodes.map((node) => node.id)).not.toContain(primary[0]!.id);
    expect(second.residentGraph.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      primary[2]!.id,
      primary[3]!.id,
      fallback[0]!.id,
      fallback[1]!.id,
    ]));
    expect(second.residentGraph.nodes).toHaveLength(6);
  });

  it('keeps a complete non-collection structural chain resident', () => {
    const graph: RouteGraphSource = {
      nodes: [
        {
          id: 'entry:chain',
          name: 'Chain Entry',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { kind: 'model', requestedModelPattern: 'chain', displayName: 'Chain Entry' },
        },
        {
          id: 'filter:one',
          name: 'Filter One',
          type: 'filter',
          enabled: true,
          ownership: 'manual',
          operations: [],
        },
        {
          id: 'filter:two',
          name: 'Filter Two',
          type: 'filter',
          enabled: true,
          ownership: 'manual',
          operations: [],
        },
        endpoint('endpoint:chain'),
      ],
      macros: [],
      edges: [
        { id: 'edge:chain:1', sourceNodeId: 'entry:chain', sourcePortId: 'bidirect.out', targetNodeId: 'filter:one', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'edge:chain:2', sourceNodeId: 'filter:one', sourcePortId: 'bidirect.out', targetNodeId: 'filter:two', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'edge:chain:3', sourceNodeId: 'filter:two', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint:chain', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    };

    const workspace = buildRouteGraphFocusedWorkspace({
      graph,
      diagnostics: [],
      revision: 'draft:1',
      focus: { kind: 'node', id: 'entry:chain' },
      representation: 'semantic',
    });

    expect(workspace.residentGraph.nodes.map((node) => node.id)).toEqual([
      'entry:chain',
      'filter:one',
      'filter:two',
      'endpoint:chain',
    ]);
    expect(workspace.residentGraph.edges.map((item) => item.id)).toEqual([
      'edge:chain:1',
      'edge:chain:2',
      'edge:chain:3',
    ]);
    expect(workspace.portals).toEqual([]);
  });

  it('rejects a collection window token after the draft revision changes', () => {
    const nodes = Array.from({ length: 30 }, (_, index) => endpoint(`endpoint:${index}`));
    const graph: RouteGraphSource = {
      nodes,
      macros: [macro('route:revision')],
      edges: nodes.map((node, index) => edge(`edge:${index}`, node.id, 'route:revision')),
    };
    const first = buildRouteGraphFocusedWorkspace({
      graph,
      diagnostics: [],
      revision: 'draft:1',
      focus: { kind: 'macro', id: 'route:revision' },
      representation: 'semantic',
      collectionWindowSize: 24,
    });
    const nextPortal = first.portals.find((portal) => portal.destination.kind === 'window');
    const token = nextPortal?.destination.kind === 'window' ? nextPortal.destination.token : '';

    expect(() => buildRouteGraphFocusedWorkspace({
      graph,
      diagnostics: [],
      revision: 'draft:2',
      focus: { kind: 'macro', id: 'route:revision' },
      representation: 'semantic',
      collectionWindowSize: 24,
      windowToken: token,
    })).toThrow(RouteGraphWorkspaceWindowTokenError);
  });
});
