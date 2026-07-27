import { describe, expect, it } from 'vitest';
import { createRouteMacroSemanticNodeId } from '../../shared/routingIdentity.js';
import type { RouteGraphDiagnostic, RouteGraphSource } from '../../shared/routeGraph.js';
import {
  buildRouteGraphSemanticIndex,
  buildRouteGraphWorkspaceIndexPage,
  RouteGraphWorkspaceIndexCursorError,
} from './routeGraphWorkspaceIndexService.js';

const macro = (id: string, name = id) => ({
  id,
  name,
  kind: 'candidate_selector' as const,
  enabled: true,
  ownership: 'system' as const,
  config: {},
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
  config: { targets: [] },
});

describe('routeGraphWorkspaceIndexService', () => {
  it('pages semantic focuses without returning a source graph window', () => {
    const macros = Array.from({ length: 120 }, (_, index) => macro(`macro:${String(index).padStart(3, '0')}`));
    const graph: RouteGraphSource = { nodes: [], edges: [], macros };

    const page = buildRouteGraphWorkspaceIndexPage(graph, [], 'draft:1', { limit: 20 });

    expect(page.items).toHaveLength(20);
    expect(page.items[0]).not.toHaveProperty('visibility');
    expect(page.totalCount).toBe(120);
    expect(page.summary).toMatchObject({ nodes: 0, edges: 0, macros: 120, focuses: 120 });
    expect(page).not.toHaveProperty('graph');
    expect(page.nextCursor).not.toBeNull();
  });

  it('keeps a 10,000-Macro overview response bounded to one server page', () => {
    const macros = Array.from({ length: 10_000 }, (_, index) => (
      macro(`macro:${String(index).padStart(5, '0')}`)
    ));
    const graph: RouteGraphSource = { nodes: [], edges: [], macros };

    const page = buildRouteGraphWorkspaceIndexPage(graph, [], 'draft:large', { limit: 40 });
    const payloadBytes = Buffer.byteLength(JSON.stringify(page), 'utf8');

    expect(page.items).toHaveLength(40);
    expect(page.totalCount).toBe(10_000);
    expect(page.summary).toMatchObject({ nodes: 0, edges: 0, macros: 10_000, focuses: 10_000 });
    expect(page.nextCursor).not.toBeNull();
    expect(page).not.toHaveProperty('graph');
    expect(payloadBytes).toBeLessThan(128 * 1024);
  });

  it('rejects malformed, stale-revision and changed-filter cursors explicitly', () => {
    const graph: RouteGraphSource = {
      nodes: [],
      edges: [],
      macros: [macro('macro:a', 'A'), macro('macro:b', 'B'), macro('macro:c', 'C')],
    };
    const first = buildRouteGraphWorkspaceIndexPage(graph, [], 'draft:1', { limit: 1 });
    expect(first.nextCursor).toEqual(expect.any(String));

    expect(() => buildRouteGraphWorkspaceIndexPage(graph, [], 'draft:1', { cursor: 'not-a-cursor' }))
      .toThrowError(expect.objectContaining<RouteGraphWorkspaceIndexCursorError>({ code: 'invalid_workspace_index_cursor' }));
    expect(() => buildRouteGraphWorkspaceIndexPage(graph, [], 'draft:2', { cursor: first.nextCursor }))
      .toThrowError(expect.objectContaining<RouteGraphWorkspaceIndexCursorError>({ code: 'stale_workspace_index_cursor' }));
    expect(() => buildRouteGraphWorkspaceIndexPage(graph, [], 'draft:1', { cursor: first.nextCursor, query: 'B' }))
      .toThrowError(expect.objectContaining<RouteGraphWorkspaceIndexCursorError>({ code: 'stale_workspace_index_cursor' }));
  });

  it('separates navigable focuses and traversal boundaries from endpoint dependencies', () => {
    const graph: RouteGraphSource = {
      macros: [macro('route:a', 'Route A')],
      nodes: [
        endpoint('endpoint:a'),
        {
          id: 'entry:manual',
          name: 'Manual entry',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: {
            kind: 'model',
            requestedModelPattern: 'manual',
            displayName: 'Manual entry',
            downstreamProtocol: null,
            upstreamProtocol: null,
            sitePlatform: null,
            accountId: null,
            tokenId: null,
            siteId: null,
          },
        },
      ],
      edges: [{
        id: 'edge:a',
        sourceNodeId: 'endpoint:a',
        sourcePortId: 'route.out',
        targetNodeId: createRouteMacroSemanticNodeId('route:a'),
        targetPortId: 'candidates.in',
        kind: 'route_flow',
        ownership: 'system',
      }],
    };

    const page = buildRouteGraphWorkspaceIndexPage(graph, [], 'draft:1');
    const index = buildRouteGraphSemanticIndex(graph);

    expect(page.items.map((item) => item.focus)).toEqual([
      { kind: 'node', id: 'entry:manual' },
      { kind: 'macro', id: 'route:a' },
    ]);
    expect(page.items.some((item) => item.focus.id === 'endpoint:a')).toBe(false);
    expect([...index.traversalBoundaryByElementId.keys()]).toEqual(expect.arrayContaining([
      createRouteMacroSemanticNodeId('route:a'),
      'entry:manual',
    ]));
    expect(index.traversalBoundaryByElementId.has('endpoint:a')).toBe(false);
  });

  it('filters graph-native diagnostics without requiring primitive lowering', () => {
    const graph: RouteGraphSource = { nodes: [], edges: [], macros: [macro('route:a', 'Route A')] };
    const diagnostics: RouteGraphDiagnostic[] = [{
      severity: 'error',
      code: 'macro.invalid',
      message: 'Invalid macro',
      nodeId: createRouteMacroSemanticNodeId('route:a'),
    }];

    const page = buildRouteGraphWorkspaceIndexPage(graph, diagnostics, 'draft:1', { diagnosticState: 'errors' });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.counts.errors).toBe(1);
    expect(page.summary.errors).toBe(1);
  });
});
