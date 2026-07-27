import { describe, expect, it } from 'vitest';
import type { RouteGraphMacro, RouteGraphSource } from '../../shared/routeGraph.js';
import {
  ensureRouteGraphExecutionTargetEndpoint,
  ensureRouteGraphExecutionTargetsEndpoint,
  removeRouteGraphExecutionTargets,
} from './routeGraphExecutionTargetEndpointService.js';

function boundEndpoint(id: string, executionTargetIds: number[]) {
  return {
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
    config: {
      targets: executionTargetIds.map((executionTargetId) => ({
        targetId: `target:${executionTargetId}`,
        model: id,
        transportBinding: { kind: 'execution_target' as const, executionTargetId },
      })),
      targetSelection: { kind: 'builtin' as const, builtin: 'stable_first' as const },
    },
  };
}

function selectorMacro(groups: RouteGraphMacro['config']['groups']): RouteGraphMacro {
  return {
    id: 'macro:route',
    name: 'Route',
    kind: 'candidate_selector',
    enabled: true,
    ownership: 'system',
    config: {
      surface: {
        entry: {
          kind: 'external',
          match: { kind: 'model', requestedModelPattern: 'route', displayName: 'Route' },
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
  };
}

describe('routeGraphExecutionTargetEndpointService', () => {
  it('creates a server-issued supply endpoint whose target binding owns the execution-target relation', () => {
    const first = ensureRouteGraphExecutionTargetEndpoint({ nodes: [], edges: [], macros: [] }, {
      id: 42,
      upstreamModelName: 'deepseek-v4-flash',
      enabled: true,
    });

    expect(first.created).toBe(true);
    expect(first.endpoint).toMatchObject({
      id: expect.stringMatching(/^route-endpoint:managed:[0-9a-f-]{36}$/),
      routeEndpointId: expect.stringMatching(/^route-endpoint:managed:[0-9a-f-]{36}$/),
      metadata: { upstreamModel: 'deepseek-v4-flash' },
      config: {
        targets: [expect.objectContaining({
          model: 'deepseek-v4-flash',
          transportBinding: { kind: 'execution_target', executionTargetId: 42 },
        })],
      },
    });
    expect(first.source.nodes).toEqual([first.endpoint]);

    const second = ensureRouteGraphExecutionTargetEndpoint(first.source, {
      id: 42,
      upstreamModelName: 'renamed-upstream-model',
      enabled: false,
    });
    expect(second.created).toBe(false);
    expect(second.endpoint.id).toBe(first.endpoint.id);
    expect(second.source.nodes).toHaveLength(1);
  });

  it('preserves the authoring ownership supplied by a Graph facade', () => {
    const result = ensureRouteGraphExecutionTargetEndpoint({ nodes: [], edges: [], macros: [] }, {
      id: 7,
      upstreamModelName: 'qwen3',
      enabled: true,
    }, {
      ownership: 'derived',
      ownerKind: 'macro',
      provenance: { source: 'generated', generatedBy: 'route-group-facade' },
    });

    expect(result.endpoint).toMatchObject({
      ownership: 'derived',
      ownerKind: 'macro',
      provenance: { source: 'generated', generatedBy: 'route-group-facade' },
    });
  });

  it('authors multiple explicit targets under one generic endpoint policy', () => {
    const first = ensureRouteGraphExecutionTargetsEndpoint(
      { nodes: [], edges: [], macros: [] },
      [
        { id: 11, upstreamModelName: 'gpt-5.4', enabled: true },
        { id: 22, upstreamModelName: 'gpt-5.4', enabled: true },
      ],
      { targetSelection: { kind: 'builtin', builtin: 'round_robin' } },
    );
    expect(first.endpoint.config).toMatchObject({
      targetSelection: { kind: 'builtin', builtin: 'round_robin' },
      targets: [
        expect.objectContaining({
          targetId: expect.stringMatching(/^execution-target:managed:[0-9a-f-]{36}$/),
          transportBinding: { kind: 'execution_target', executionTargetId: 11 },
        }),
        expect.objectContaining({
          targetId: expect.stringMatching(/^execution-target:managed:[0-9a-f-]{36}$/),
          transportBinding: { kind: 'execution_target', executionTargetId: 22 },
        }),
      ],
    });
    const targetIds = first.endpoint.config?.targets.map((target) => target.targetId);

    const updated = ensureRouteGraphExecutionTargetsEndpoint(
      first.source,
      [
        { id: 11, upstreamModelName: 'gpt-5.4', enabled: true },
        { id: 22, upstreamModelName: 'gpt-5.4', enabled: false },
      ],
      {
        endpointId: first.endpoint.routeEndpointId,
        targetSelection: { kind: 'builtin', builtin: 'stable_first' },
      },
    );
    expect(updated.endpoint.config?.targets.map((target) => target.targetId)).toEqual(targetIds);
    expect(updated.endpoint.config?.targetSelection).toEqual({
      kind: 'builtin',
      builtin: 'stable_first',
    });
  });

  it('removes one binding from a multi-target endpoint without changing its identity', () => {
    const endpoint = boundEndpoint('endpoint:shared', [11, 22]);
    const source: RouteGraphSource = { nodes: [endpoint], edges: [], macros: [] };

    const result = removeRouteGraphExecutionTargets(source, [11]);

    expect(result.removedEndpointIds).toEqual([]);
    expect(result.source.nodes).toEqual([expect.objectContaining({
      id: endpoint.id,
      routeEndpointId: endpoint.routeEndpointId,
      config: expect.objectContaining({
        targets: [expect.objectContaining({
          targetId: 'target:22',
          transportBinding: { kind: 'execution_target', executionTargetId: 22 },
        })],
      }),
    })]);
  });

  it('removes an empty endpoint, its incident edges, and its selector member', () => {
    const removed = boundEndpoint('endpoint:removed', [11]);
    const retained = boundEndpoint('endpoint:retained', [22]);
    const source: RouteGraphSource = {
      nodes: [removed, retained],
      edges: [{
        id: 'edge:removed',
        sourceNodeId: removed.id,
        sourcePortId: 'route.out',
        targetNodeId: retained.id,
        targetPortId: 'route.in',
        kind: 'route_flow',
        ownership: 'system',
      }],
      macros: [selectorMacro([{
        id: 'stage:primary',
        enabled: true,
        input: { kind: 'route_endpoints', endpointIds: [removed.id, retained.id] },
        members: [
          { endpointId: removed.id, enabled: true },
          { endpointId: retained.id, enabled: true },
        ],
      }])],
    };

    const result = removeRouteGraphExecutionTargets(source, [11]);

    expect(result.removedEndpointIds).toEqual([removed.id]);
    expect(result.source.nodes).toEqual([retained]);
    expect(result.source.edges).toEqual([]);
    expect(result.source.macros[0]?.config.groups[0]).toMatchObject({
      input: { kind: 'route_endpoints', endpointIds: [retained.id] },
      members: [{ endpointId: retained.id, enabled: true }],
    });
  });

  it('turns an emptied selector stage into an explicit synthetic terminal', () => {
    const removed = boundEndpoint('endpoint:removed', [11]);
    const source: RouteGraphSource = {
      nodes: [removed],
      edges: [],
      macros: [selectorMacro([{
        id: 'stage:primary',
        enabled: true,
        input: { kind: 'route_endpoints', endpointIds: [removed.id] },
        members: [{ endpointId: removed.id, enabled: true }],
      }])],
    };

    const result = removeRouteGraphExecutionTargets(source, [11]);

    expect(result.source.macros[0]?.config.groups[0]).toEqual(expect.objectContaining({
      id: 'stage:primary',
      input: { kind: 'synthetic', statusCode: 503, message: 'No route is available.' },
    }));
    expect(result.source.macros[0]?.config.groups[0]).not.toHaveProperty('members');
  });

  it('preserves unrelated endpoints, macros, metadata, and edges exactly', () => {
    const removed = boundEndpoint('endpoint:removed', [11]);
    const unrelatedA = boundEndpoint('endpoint:unrelated-a', [22]);
    const unrelatedB = boundEndpoint('endpoint:unrelated-b', [33]);
    const unrelatedMacro = selectorMacro([{
      id: 'stage:unrelated',
      enabled: true,
      input: { kind: 'route_endpoints', endpointIds: [unrelatedA.id] },
      members: [{ endpointId: unrelatedA.id, enabled: true }],
    }]);
    unrelatedMacro.id = 'macro:unrelated';
    const unrelatedEdge = {
      id: 'edge:unrelated',
      sourceNodeId: unrelatedA.id,
      sourcePortId: 'route.out',
      targetNodeId: unrelatedB.id,
      targetPortId: 'route.in',
      kind: 'route_flow' as const,
      ownership: 'system' as const,
    };
    const source: RouteGraphSource = {
      nodes: [removed, unrelatedA, unrelatedB],
      edges: [unrelatedEdge],
      macros: [unrelatedMacro],
      metadata: { owner: 'test' },
    };

    const result = removeRouteGraphExecutionTargets(source, [11]);

    expect(result.source.nodes).toEqual([unrelatedA, unrelatedB]);
    expect(result.source.edges).toEqual([unrelatedEdge]);
    expect(result.source.macros).toEqual([unrelatedMacro]);
    expect(result.source.metadata).toBe(source.metadata);
  });
});
