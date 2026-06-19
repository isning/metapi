import { describe, expect, it } from 'vitest';
import {
  compileRouteGraphSource,
  normalizeRouteGraphSource,
} from '../../shared/routeGraph.js';
import {
  applyRouteGraphPostBuildFilters,
  evaluateCompiledRouteGraph,
} from './routeGraphRuntimeService.js';

describe('route graph runtime evaluator', () => {
  it('evaluates multi-hop model rewrite and payload filters without provider hardcoding', () => {
    const source = normalizeRouteGraphSource({
      version: 1,
      nodes: [
        {
          id: 'entry.deepseek-max',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'deepseek-v4-pro-max', displayName: null, routeId: 100 },
        },
        {
          id: 'filter.strip-max',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          operations: [
            { type: 'rewrite_model', source: 'current_model', operation: 'strip_suffix', suffix: '-max' },
          ],
        },
        {
          id: 'filter.thinking',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          operations: [
            { type: 'set_payload', path: 'thinking', mode: 'override', value: { type: 'enabled' } },
            { type: 'set_payload', path: 'reasoning_effort', mode: 'override', value: 'high' },
          ],
        },
        {
          id: 'dispatcher.deepseek-pro',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          ordering: 'explicit',
          policy: { strategy: 'weighted' },
        },
        {
          id: 'endpoint.deepseek-pro',
          type: 'model_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 101,
          config: { targets: [{ channelId: '101', model: 'deepseek-v4-pro', accountId: 1, tokenId: 1 }], targetSelection: { strategy: 'weighted' } },
        },
      ],
      edges: [
        {
          id: 'e1',
          sourceNodeId: 'entry.deepseek-max',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'filter.strip-max',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
        {
          id: 'e2',
          sourceNodeId: 'filter.strip-max',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'filter.thinking',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
        {
          id: 'e3',
          sourceNodeId: 'filter.thinking',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'dispatcher.deepseek-pro',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
        {
          id: 'e4',
          sourceNodeId: 'endpoint.deepseek-pro',
          sourcePortId: 'route.out',
          targetNodeId: 'dispatcher.deepseek-pro',
          targetPortId: 'route.in',
          kind: 'route_flow',
          ownership: 'manual',
        },
      ],
    });
    const compiled = compileRouteGraphSource(source);
    expect(compiled.ok).toBe(true);

    const selection = evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'deepseek-v4-pro-max',
    });

    expect(selection).toMatchObject({
      matchedEntryNodeId: 'entry.deepseek-max',
      selectedRouteId: 101,
      currentModel: 'deepseek-v4-pro',
      terminalKind: 'model_endpoint',
      selectedEndpointTarget: {
        channelId: '101',
        model: 'deepseek-v4-pro',
      },
    });
    expect(selection?.postBuildFilters.payload.map((operation) => operation.type)).toEqual(['set_payload', 'set_payload']);

    const filtered = applyRouteGraphPostBuildFilters({
      payload: { model: 'deepseek-v4-pro' },
      filters: selection?.postBuildFilters,
    });

    expect(filtered.payload).toEqual({
      model: 'deepseek-v4-pro',
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    });
  });

  it('applies payload/header mutations with default, override, remove and endpoint preference semantics', () => {
    const source = normalizeRouteGraphSource({
      version: 1,
      nodes: [
        {
          id: 'entry.rules',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'rules-model' },
        },
        {
          id: 'filter.rules',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          operations: [
            { type: 'set_payload', path: 'reasoning_effort', mode: 'default', value: 'medium' },
            { type: 'set_payload', path: 'metadata.route', mode: 'override', value: 'graph' },
            { type: 'remove_payload', path: 'debug.removeMe' },
            { type: 'set_header', name: 'X-Reasoning', mode: 'default', value: 'enabled' },
            { type: 'set_header', name: 'X-Route', mode: 'override', value: 'graph' },
            { type: 'remove_header', name: 'X-Remove-Me' },
            { type: 'set_endpoint_preference', endpoint: 'responses' },
          ],
        },
        {
          id: 'endpoint.rules',
          type: 'model_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 41,
          config: { targets: [{ channelId: '41', model: 'rules-model' }], targetSelection: { strategy: 'weighted' } },
        },
      ],
      edges: [
        { id: 'entry-filter', sourceNodeId: 'entry.rules', sourcePortId: 'bidirect.out', targetNodeId: 'filter.rules', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'filter-endpoint', sourceNodeId: 'filter.rules', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint.rules', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });
    const compiled = compileRouteGraphSource(source);
    expect(compiled.ok).toBe(true);

    const selection = evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'rules-model',
    });

    const filtered = applyRouteGraphPostBuildFilters({
      payload: {
        model: 'rules-model',
        reasoning_effort: 'low',
        debug: { keepMe: true, removeMe: true },
      },
      headers: {
        'x-reasoning': 'client',
        'x-route': 'client',
        'x-remove-me': 'drop',
      },
      filters: selection?.postBuildFilters,
    });

    expect(filtered).toEqual({
      endpointPreference: 'responses',
      payload: {
        model: 'rules-model',
        reasoning_effort: 'low',
        debug: { keepMe: true },
        metadata: { route: 'graph' },
      },
      headers: {
        'x-reasoning': 'client',
        'x-route': 'graph',
      },
    });
  });

  it('returns configured dummy errors as terminal graph outcomes', () => {
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        {
          id: 'entry.blocked',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'blocked-model' },
        },
        {
          id: 'synthetic.503',
          type: 'synthetic_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          statusCode: 503,
          message: 'No backend for this model',
        },
      ],
      edges: [
        {
          id: 'fallback',
          sourceNodeId: 'entry.blocked',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'synthetic.503',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
      ],
    });

    expect(compiled.ok).toBe(true);
    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'blocked-model',
    })).toMatchObject({
      terminalKind: 'synthetic_endpoint',
      syntheticResponse: {
        statusCode: 503,
        message: 'No backend for this model',
      },
    });
  });

  it('allows an entry node to be reused as an internal bidirect flow', () => {
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        {
          id: 'entry.public',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'public-model' },
        },
        {
          id: 'entry.reusable',
          type: 'entry',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          match: { requestedModelPattern: '', displayName: null },
        },
        {
          id: 'endpoint.reused',
          type: 'model_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 77,
          routeNodeId: 'entry.public',
          config: { targets: [{ channelId: '77', model: 'public-model' }], targetSelection: { strategy: 'weighted' } },
        },
      ],
      edges: [
        { id: 'reuse-entry', sourceNodeId: 'entry.public', sourcePortId: 'bidirect.out', targetNodeId: 'entry.reusable', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'reuse-endpoint', sourceNodeId: 'entry.reusable', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint.reused', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'public-model',
    })).toMatchObject({
      matchedEntryNodeId: 'entry.public',
      selectedRouteId: 77,
      terminalNodeId: 'endpoint.reused',
    });
  });

  it('enforces the configured max hop limit during traversal', () => {
    const source = normalizeRouteGraphSource({
      version: 1,
      nodes: [
        { id: 'entry.a', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'a' } },
        { id: 'filter.1', type: 'filter', enabled: true, visibility: 'internal', ownership: 'manual', operations: [] },
        { id: 'filter.2', type: 'filter', enabled: true, visibility: 'internal', ownership: 'manual', operations: [] },
        { id: 'endpoint.a', type: 'model_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 1, routeNodeId: 'entry.a', config: { targets: [{ channelId: '1', model: 'a' }], targetSelection: { strategy: 'weighted' } } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'filter.1', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e2', sourceNodeId: 'filter.1', sourcePortId: 'bidirect.out', targetNodeId: 'filter.2', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e3', sourceNodeId: 'filter.2', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint.a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });
    const compiled = compileRouteGraphSource(source);
    expect(compiled.ok).toBe(true);

    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'a',
      maxHops: 2,
    })).toBe(null);
    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'a',
      maxHops: 4,
    })?.terminalKind).toBe('model_endpoint');
  });

  it('uses route dispatcher weighted strategy deterministically by highest weight', () => {
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        { id: 'entry.a', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'a' } },
        {
          id: 'dispatcher.a',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'weighted' },
        },
        { id: 'endpoint.low', type: 'model_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 1, routeNodeId: 'entry.a', metadata: { weight: 1 }, config: { targets: [{ channelId: '1', model: 'a-low' }], targetSelection: { strategy: 'weighted' } } },
        { id: 'endpoint.high', type: 'model_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 2, routeNodeId: 'entry.a', metadata: { weight: 10 }, config: { targets: [{ channelId: '2', model: 'a-high' }], targetSelection: { strategy: 'weighted' } } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e3', sourceNodeId: 'endpoint.low', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'e4', sourceNodeId: 'endpoint.high', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'a',
    })?.selectedRouteId).toBe(2);
  });

  it('uses route dispatcher CEL score policy over candidate metadata', () => {
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        { id: 'entry.a', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'a' } },
        {
          id: 'dispatcher.a',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: {
            strategy: 'weighted',
            score: 'candidate.metadata.qualityScore - candidate.metadata.costRank',
          },
        },
        { id: 'endpoint.low', type: 'model_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 1, metadata: { qualityScore: 5, costRank: 1 }, config: { targets: [{ channelId: '1', model: 'a-low' }], targetSelection: { strategy: 'weighted' } } },
        { id: 'endpoint.high', type: 'model_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 2, metadata: { qualityScore: 10, costRank: 2 }, config: { targets: [{ channelId: '2', model: 'a-high' }], targetSelection: { strategy: 'weighted' } } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e2', sourceNodeId: 'endpoint.low', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'e3', sourceNodeId: 'endpoint.high', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'a',
    })?.selectedRouteId).toBe(2);
  });

  it('exposes merged endpoint and edge metadata to route dispatcher CEL scoring', () => {
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        { id: 'entry.metadata', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'metadata-model' } },
        {
          id: 'dispatcher.metadata',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: {
            strategy: 'weighted',
            score: 'metadata.nodeScore + metadata.edgeBoost',
          },
        },
        {
          id: 'endpoint.node-only',
          type: 'model_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 1,
          metadata: { nodeScore: 10, edgeBoost: 0 },
          config: { targets: [{ channelId: '1', model: 'node-only' }], targetSelection: { strategy: 'weighted' } },
        },
        {
          id: 'endpoint.edge-boosted',
          type: 'model_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 2,
          metadata: { nodeScore: 5 },
          config: { targets: [{ channelId: '2', model: 'edge-boosted' }], targetSelection: { strategy: 'weighted' } },
        },
      ],
      edges: [
        { id: 'entry-dispatcher', sourceNodeId: 'entry.metadata', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.metadata', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'node-only-route', sourceNodeId: 'endpoint.node-only', sourcePortId: 'route.out', targetNodeId: 'dispatcher.metadata', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual', metadata: { edgeBoost: 0 } },
        { id: 'edge-boosted-route', sourceNodeId: 'endpoint.edge-boosted', sourcePortId: 'route.out', targetNodeId: 'dispatcher.metadata', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual', metadata: { edgeBoost: 20 } },
      ],
    });

    expect(compiled.ok).toBe(true);
    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'metadata-model',
    })).toMatchObject({
      selectedRouteId: 2,
      selectedEndpointTarget: {
        channelId: '2',
        model: 'edge-boosted',
      },
    });
  });

  it('uses route dispatcher direct CEL select and falls back to first candidate when out of range', () => {
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        { id: 'entry.direct', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'direct-model' } },
        {
          id: 'dispatcher.direct',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'direct', select: 'payload.currentModel == "direct-model" ? 1 : 99' },
        },
        { id: 'endpoint.first', type: 'model_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 1, config: { targets: [{ channelId: '1', model: 'first' }], targetSelection: { strategy: 'weighted' } } },
        { id: 'endpoint.second', type: 'model_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 2, config: { targets: [{ channelId: '2', model: 'second' }], targetSelection: { strategy: 'weighted' } } },
      ],
      edges: [
        { id: 'entry-dispatcher', sourceNodeId: 'entry.direct', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.direct', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'first-route', sourceNodeId: 'endpoint.first', sourcePortId: 'route.out', targetNodeId: 'dispatcher.direct', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'second-route', sourceNodeId: 'endpoint.second', sourcePortId: 'route.out', targetNodeId: 'dispatcher.direct', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });
    expect(compiled.ok).toBe(true);

    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'direct-model',
    })?.selectedRouteId).toBe(2);

    const rewritten = compileRouteGraphSource({
      ...compiled.source,
      nodes: compiled.source.nodes.map((node) => (
        node.id === 'dispatcher.direct'
          ? { ...node, policy: { strategy: 'direct', select: '99' } }
          : node
      )),
    });
    expect(rewritten.ok).toBe(true);
    expect(evaluateCompiledRouteGraph({
      graph: rewritten.compiled,
      requestedModel: 'direct-model',
    })?.selectedRouteId).toBe(1);
  });

  it('round-robins endpoint targets while ignoring disabled targets', () => {
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        { id: 'entry.targets', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'target-model' } },
        {
          id: 'endpoint.targets',
          type: 'model_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 70,
          config: {
            targets: [
              { channelId: 'disabled', model: 'disabled', enabled: false },
              { channelId: 'a', model: 'target-a' },
              { channelId: 'b', model: 'target-b' },
            ],
            targetSelection: { strategy: 'round_robin' },
          },
        },
      ],
      edges: [
        { id: 'entry-endpoint', sourceNodeId: 'entry.targets', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint.targets', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });
    expect(compiled.ok).toBe(true);

    const stateStore: Record<string, unknown> = {};
    const first = evaluateCompiledRouteGraph({ graph: compiled.compiled, requestedModel: 'target-model', stateStore });
    const second = evaluateCompiledRouteGraph({ graph: compiled.compiled, requestedModel: 'target-model', stateStore });
    const third = evaluateCompiledRouteGraph({ graph: compiled.compiled, requestedModel: 'target-model', stateStore });

    expect(first?.selectedEndpointTarget?.channelId).toBe('a');
    expect(second?.selectedEndpointTarget?.channelId).toBe('b');
    expect(third?.selectedEndpointTarget?.channelId).toBe('a');
    expect(stateStore['dispatcher:endpoint.targets:round_robin']).toBe(3);
  });

  it('ignores disabled route candidates before applying dispatcher policy', () => {
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        { id: 'entry.a', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'a' } },
        {
          id: 'dispatcher.a',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'weighted' },
        },
        { id: 'endpoint.disabled', type: 'model_endpoint', enabled: false, visibility: 'internal', ownership: 'manual', legacyRouteId: 1, metadata: { weight: 100 }, config: { targets: [{ channelId: '1', model: 'a-disabled' }], targetSelection: { strategy: 'weighted' } } },
        { id: 'endpoint.enabled', type: 'model_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 2, metadata: { weight: 1 }, config: { targets: [{ channelId: '2', model: 'a-enabled' }], targetSelection: { strategy: 'weighted' } } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e2', sourceNodeId: 'endpoint.disabled', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'e3', sourceNodeId: 'endpoint.enabled', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'a',
    })?.selectedRouteId).toBe(2);
  });

  it('uses route dispatcher priority order before score and weight', () => {
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        { id: 'entry.a', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'a' } },
        {
          id: 'dispatcher.a',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'priority_order' },
        },
        { id: 'endpoint.low-priority', type: 'model_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 1, metadata: { priority: 1, weight: 100 }, config: { targets: [{ channelId: '1', model: 'a-low-priority' }], targetSelection: { strategy: 'weighted' } } },
        { id: 'endpoint.high-priority', type: 'model_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 2, metadata: { priority: 10, weight: 1 }, config: { targets: [{ channelId: '2', model: 'a-high-priority' }], targetSelection: { strategy: 'weighted' } } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e2', sourceNodeId: 'endpoint.low-priority', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'e3', sourceNodeId: 'endpoint.high-priority', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'a',
    })?.selectedRouteId).toBe(2);
  });

  it('uses model endpoint targetSelection to select the concrete endpoint target', () => {
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        { id: 'entry.a', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'a' } },
        {
          id: 'dispatcher.a',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'weighted' },
        },
        {
          id: 'endpoint.a',
          type: 'model_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 1,
          config: {
            targets: [
              { channelId: '10', model: 'a-low', weight: 1 },
              { channelId: '20', model: 'a-high', weight: 9 },
            ],
            targetSelection: { strategy: 'weighted' },
          },
        },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e2', sourceNodeId: 'endpoint.a', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'a',
    })).toMatchObject({
      selectedEndpointTarget: {
        channelId: '20',
        model: 'a-high',
      },
      currentModel: 'a-high',
      upstreamModel: 'a-high',
    });
  });

  it('exposes model endpoint compatibility defaults and selected target overrides separately', () => {
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        { id: 'entry.compat', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'compat' } },
        {
          id: 'dispatcher.compat',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'weighted' },
        },
        {
          id: 'endpoint.compat',
          type: 'model_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 1,
          compatibilityPolicy: {
            reasoningHistory: {
              transport: {
                mode: 'content_think_tag',
              },
            },
          },
          config: {
            targets: [
              {
                channelId: '10',
                model: 'compat-target',
                compatibilityPolicy: {
                  reasoningHistory: {
                    transport: {
                      mode: 'native',
                      maxReasoningBytes: 4096,
                    },
                  },
                },
              },
            ],
            targetSelection: { strategy: 'weighted' },
          },
        },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.compat', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.compat', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e2', sourceNodeId: 'endpoint.compat', sourcePortId: 'route.out', targetNodeId: 'dispatcher.compat', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'compat',
    })).toMatchObject({
      modelEndpointCompatibilityPolicy: {
        reasoningHistory: {
          transport: {
            mode: 'content_think_tag',
          },
        },
      },
      selectedEndpointTarget: {
        channelId: '10',
        model: 'compat-target',
        compatibilityPolicy: {
          reasoningHistory: {
            transport: {
              mode: 'native',
              maxReasoningBytes: 4096,
            },
          },
        },
      },
    });
  });

  it('defers model endpoint target selection to the token router when configured', () => {
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        { id: 'entry.a', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'a' } },
        {
          id: 'dispatcher.a',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'weighted' },
        },
        {
          id: 'endpoint.a',
          type: 'model_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 1,
          config: {
            targets: [
              { channelId: '10', model: 'a-low', weight: 1 },
              { channelId: '20', model: 'a-high', weight: 9 },
            ],
            targetSelection: { strategy: 'defer_to_router' },
          },
        },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e2', sourceNodeId: 'endpoint.a', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'a',
    })).toMatchObject({
      selectedRouteId: 1,
      selectedEndpointTarget: null,
      currentModel: 'a',
    });
  });

  it('uses direct flow dispatcher policy to choose a bidirect branch', () => {
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        { id: 'entry.a', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'a' } },
        {
          id: 'dispatcher.flow',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'flow',
          policy: {
            strategy: 'direct',
            select: 'payload.currentModel == "a" ? 1 : 0',
          },
        },
        { id: 'endpoint.first', type: 'model_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 1, config: { targets: [{ channelId: '1', model: 'a-first' }], targetSelection: { strategy: 'weighted' } } },
        { id: 'endpoint.second', type: 'model_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 2, config: { targets: [{ channelId: '2', model: 'a-second' }], targetSelection: { strategy: 'weighted' } } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.flow', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e2', sourceNodeId: 'dispatcher.flow', sourcePortId: 'bidirect[1...].out', targetNodeId: 'endpoint.first', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e3', sourceNodeId: 'dispatcher.flow', sourcePortId: 'bidirect[1...].out', targetNodeId: 'endpoint.second', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'a',
    })?.selectedRouteId).toBe(2);
  });

  it('can select synthetic fallback branches from bidirect flow dispatchers', () => {
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        { id: 'entry.flow-fallback', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'flow-fallback' } },
        {
          id: 'dispatcher.flow-fallback',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'flow',
          policy: {
            strategy: 'priority_order',
          },
        },
        {
          id: 'endpoint.unavailable',
          type: 'model_endpoint',
          enabled: false,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 1,
          config: { targets: [{ channelId: '1', model: 'disabled' }], targetSelection: { strategy: 'weighted' } },
        },
        {
          id: 'synthetic.rate-limit',
          type: 'synthetic_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          statusCode: 429,
          message: 'Rate limited by route graph',
        },
      ],
      edges: [
        { id: 'entry-dispatcher', sourceNodeId: 'entry.flow-fallback', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.flow-fallback', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'disabled-primary', sourceNodeId: 'dispatcher.flow-fallback', sourcePortId: 'bidirect[1...].out', targetNodeId: 'endpoint.unavailable', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual', metadata: { priority: 100, enabled: false } },
        { id: 'fallback', sourceNodeId: 'dispatcher.flow-fallback', sourcePortId: 'bidirect[1...].out', targetNodeId: 'synthetic.rate-limit', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual', metadata: { priority: 1 } },
      ],
    });

    expect(compiled.ok).toBe(true);
    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'flow-fallback',
    })).toMatchObject({
      terminalKind: 'synthetic_endpoint',
      syntheticResponse: {
        statusCode: 429,
        message: 'Rate limited by route graph',
      },
    });
  });

  it('round-robins route dispatcher candidates through the supplied runtime state store', () => {
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        { id: 'entry.rr', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'rr' } },
        {
          id: 'dispatcher.rr',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'round_robin' },
        },
        { id: 'endpoint.first', type: 'model_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 1, config: { targets: [{ channelId: '1', model: 'rr-first' }], targetSelection: { strategy: 'weighted' } } },
        { id: 'endpoint.second', type: 'model_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 2, config: { targets: [{ channelId: '2', model: 'rr-second' }], targetSelection: { strategy: 'weighted' } } },
      ],
      edges: [
        { id: 'entry-dispatcher', sourceNodeId: 'entry.rr', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.rr', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'first-route', sourceNodeId: 'endpoint.first', sourcePortId: 'route.out', targetNodeId: 'dispatcher.rr', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'second-route', sourceNodeId: 'endpoint.second', sourcePortId: 'route.out', targetNodeId: 'dispatcher.rr', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });
    expect(compiled.ok).toBe(true);

    const stateStore: Record<string, unknown> = {};

    expect(evaluateCompiledRouteGraph({ graph: compiled.compiled, requestedModel: 'rr', stateStore })?.selectedRouteId).toBe(1);
    expect(evaluateCompiledRouteGraph({ graph: compiled.compiled, requestedModel: 'rr', stateStore })?.selectedRouteId).toBe(2);
    expect(evaluateCompiledRouteGraph({ graph: compiled.compiled, requestedModel: 'rr', stateStore })?.selectedRouteId).toBe(1);
    expect(stateStore).toMatchObject({ 'dispatcher:dispatcher.rr:round_robin': 3 });
  });

  it('round-robins model endpoint targets and skips disabled targets', () => {
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        { id: 'entry.targets', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'target-rr' } },
        {
          id: 'dispatcher.targets',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'weighted' },
        },
        {
          id: 'endpoint.targets',
          type: 'model_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 10,
          config: {
            targets: [
              { channelId: 'disabled', model: 'target-disabled', enabled: false },
              { channelId: 'a', model: 'target-a' },
              { channelId: 'b', model: 'target-b' },
            ],
            targetSelection: { strategy: 'round_robin' },
          },
        },
      ],
      edges: [
        { id: 'entry-dispatcher', sourceNodeId: 'entry.targets', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.targets', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'endpoint-route', sourceNodeId: 'endpoint.targets', sourcePortId: 'route.out', targetNodeId: 'dispatcher.targets', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });
    expect(compiled.ok).toBe(true);

    const stateStore: Record<string, unknown> = {};

    expect(evaluateCompiledRouteGraph({ graph: compiled.compiled, requestedModel: 'target-rr', stateStore })?.selectedEndpointTarget?.channelId).toBe('a');
    expect(evaluateCompiledRouteGraph({ graph: compiled.compiled, requestedModel: 'target-rr', stateStore })?.selectedEndpointTarget?.channelId).toBe('b');
    expect(evaluateCompiledRouteGraph({ graph: compiled.compiled, requestedModel: 'target-rr', stateStore })?.selectedEndpointTarget?.channelId).toBe('a');
  });

  it('falls back to the first enabled branch when direct CEL returns an out-of-range index', () => {
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        { id: 'entry.direct', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'direct' } },
        {
          id: 'dispatcher.direct',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'flow',
          policy: { strategy: 'direct', select: '99' },
        },
        { id: 'endpoint.first', type: 'model_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 1, config: { targets: [{ channelId: '1', model: 'direct-first' }], targetSelection: { strategy: 'weighted' } } },
        { id: 'endpoint.second', type: 'model_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 2, config: { targets: [{ channelId: '2', model: 'direct-second' }], targetSelection: { strategy: 'weighted' } } },
      ],
      edges: [
        { id: 'entry-dispatcher', sourceNodeId: 'entry.direct', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.direct', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'first-flow', sourceNodeId: 'dispatcher.direct', sourcePortId: 'bidirect[1...].out', targetNodeId: 'endpoint.first', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'second-flow', sourceNodeId: 'dispatcher.direct', sourcePortId: 'bidirect[1...].out', targetNodeId: 'endpoint.second', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });
    expect(compiled.ok).toBe(true);

    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'direct',
    })?.selectedRouteId).toBe(1);
  });
});
