import { describe, expect, it } from 'vitest';
import type { RouteGraphMacro, RouteGraphSource } from '../../shared/routeGraph.js';
import { buildRouteGraphPrimitiveFocusedWorkspace } from './routeGraphPrimitiveFocusService.js';

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

const macro = (groups: RouteGraphMacro['config']['groups']): RouteGraphMacro => ({
  id: 'route:primitive',
  name: 'Primitive route',
  kind: 'candidate_selector',
  enabled: true,
  ownership: 'system',
  config: {
    surface: {
      entry: {
        kind: 'external',
        match: { kind: 'model', requestedModelPattern: 'primitive', displayName: 'Primitive route' },
      },
      output: 'route',
      ports: [
        { id: 'candidates.in', label: 'Candidates', direction: 'input', kind: 'route', collection: { type: 'set', min: 1 } },
        { id: 'route.out', label: 'Route', direction: 'output', kind: 'route' },
      ],
    },
    policy: { kind: 'inherit_default' },
    groups,
  },
});

describe('routeGraphPrimitiveFocusService', () => {
  it('lowers the complete focused macro before applying collection windows', () => {
    const nodes = Array.from({ length: 30 }, (_, index) => endpoint(`endpoint:${String(index).padStart(2, '0')}`));
    const graph: RouteGraphSource = {
      nodes,
      edges: [],
      macros: [macro([{
        id: 'stage:primary',
        enabled: true,
        input: { kind: 'route_endpoints', endpointIds: nodes.map((node) => node.routeEndpointId) },
      }])],
    };

    const workspace = buildRouteGraphPrimitiveFocusedWorkspace({
      graph,
      diagnostics: [],
      revision: 'draft:1',
      focus: { kind: 'macro', id: 'route:primitive' },
      collectionWindowSize: 8,
    });

    expect(workspace.representation).toBe('primitive');
    expect(workspace.residentGraph.macros).toEqual([]);
    expect(workspace.residentGraph.nodes.filter((node) => node.type === 'route_endpoint')).toHaveLength(8);
    expect(workspace.totals.nodes).toBe(32);
    expect(workspace.portals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'collection',
        connection: { edgeKind: 'route_flow', count: 22, portLabel: 'endpoint candidates' },
      }),
    ]));
  });

  it('keeps fallback dispatchers and their structural edge visible', () => {
    const primary = endpoint('endpoint:primary');
    const fallback = endpoint('endpoint:fallback');
    const graph: RouteGraphSource = {
      nodes: [primary, fallback],
      edges: [],
      macros: [macro([
        { id: 'stage:primary', label: 'Primary', enabled: true, input: { kind: 'route_endpoints', endpointIds: [primary.routeEndpointId] } },
        { id: 'stage:fallback', label: 'Fallback', enabled: true, input: { kind: 'route_endpoints', endpointIds: [fallback.routeEndpointId] } },
      ])],
    };

    const workspace = buildRouteGraphPrimitiveFocusedWorkspace({
      graph,
      diagnostics: [],
      revision: 'draft:1',
      focus: { kind: 'macro', id: 'route:primitive' },
    });

    const dispatchers = workspace.residentGraph.nodes.filter((node) => node.type === 'dispatcher');
    expect(dispatchers).toHaveLength(2);
    expect(workspace.residentGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePortId: 'fallback.out', kind: 'bidirect_flow' }),
    ]));
  });

  it('returns diagnostics instead of a guessed partial primitive graph when lowering fails', () => {
    const graph: RouteGraphSource = {
      nodes: [],
      edges: [],
      macros: [macro([{
        id: 'stage:missing',
        enabled: true,
        input: { kind: 'route_endpoints', endpointIds: ['endpoint:missing'] },
      }])],
    };

    const workspace = buildRouteGraphPrimitiveFocusedWorkspace({
      graph,
      diagnostics: [],
      revision: 'draft:1',
      focus: { kind: 'macro', id: 'route:primitive' },
    });

    expect(workspace.residentGraph).toMatchObject({ nodes: [], edges: [], macros: [] });
    expect(workspace.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', code: 'macro.candidate_route_endpoint_missing' }),
    ]));
    expect(workspace.capabilities).toEqual({ editable: false, primitiveAvailable: false });
  });
});
