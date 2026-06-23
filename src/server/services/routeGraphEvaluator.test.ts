import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compileRouteGraphSource,
  normalizeRouteGraphSource,
} from '../../shared/routeGraph.js';
import {
  applyRouteGraphPostBuildFilters,
  evaluateCompiledRouteGraph,
  hydrateFlatRouteProgramBundle,
  evaluateRouteProgramBundle,
  hydrateRouteProgramBundle,
} from './routeGraphRuntimeService.js';
import { __selectorEngineTestUtils } from './selectorEngine.js';

describe('route graph runtime evaluator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 101,
          config: { targets: [{ targetId: '101', model: 'deepseek-v4-pro', accountId: 1, tokenId: 1 }], targetSelection: { strategy: 'weighted' } },
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
      terminalKind: 'route_endpoint',
      selectedEndpointTarget: {
        targetId: '101',
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
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 41,
          config: { targets: [{ targetId: '41', model: 'rules-model' }], targetSelection: { strategy: 'weighted' } },
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

  it('allows a supply route endpoint node to be reused by a dispatcher', () => {
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
          id: 'endpoint.reused',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          endpointKind: 'supply',
          legacyRouteId: 77,
          routeEndpointId: 'entry.public',
          config: { targets: [{ targetId: '77', model: 'public-model' }], targetSelection: { strategy: 'weighted' } },
        },
        {
          id: 'dispatcher.reuse',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'weighted' },
        },
      ],
      edges: [
        { id: 'reuse-entry', sourceNodeId: 'entry.public', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.reuse', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'reuse-supply', sourceNodeId: 'endpoint.reused', sourcePortId: 'route.out', targetNodeId: 'dispatcher.reuse', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
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
        { id: 'endpoint.a', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 1, routeEndpointId: 'entry.a', config: { targets: [{ targetId: '1', model: 'a' }], targetSelection: { strategy: 'weighted' } } },
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
    })?.terminalKind).toBe('route_endpoint');
  });

  it('uses route dispatcher weighted strategy as weighted random selection', () => {
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
        { id: 'endpoint.low', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 1, routeEndpointId: 'entry.a', metadata: { weight: 1 }, config: { targets: [{ targetId: '1', model: 'a-low' }], targetSelection: { strategy: 'weighted' } } },
        { id: 'endpoint.high', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 2, routeEndpointId: 'entry.a', metadata: { weight: 10 }, config: { targets: [{ targetId: '2', model: 'a-high' }], targetSelection: { strategy: 'weighted' } } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e3', sourceNodeId: 'endpoint.low', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'e4', sourceNodeId: 'endpoint.high', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.01);
    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'a',
    })?.selectedRouteId).toBe(1);

    vi.spyOn(Math, 'random').mockReturnValueOnce(0.99);
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
        { id: 'endpoint.low', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 1, metadata: { qualityScore: 5, costRank: 1 }, config: { targets: [{ targetId: '1', model: 'a-low' }], targetSelection: { strategy: 'weighted' } } },
        { id: 'endpoint.high', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 2, metadata: { qualityScore: 10, costRank: 2 }, config: { targets: [{ targetId: '2', model: 'a-high' }], targetSelection: { strategy: 'weighted' } } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e2', sourceNodeId: 'endpoint.low', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'e3', sourceNodeId: 'endpoint.high', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.99);
    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'a',
    })?.selectedRouteId).toBe(2);
  });

  it('hydrates flat selector CEL plans before route graph evaluation', () => {
    const utils = __selectorEngineTestUtils();
    utils.clearCelPlanCache();
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        { id: 'entry.prehydrated', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'prehydrated-model' } },
        {
          id: 'dispatcher.prehydrated',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: {
            strategy: 'weighted',
            score: 'candidate.metadata.quality - candidate.metadata.cost',
          },
        },
        {
          id: 'endpoint.prehydrated',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 31,
          metadata: { quality: 10, cost: 1 },
          config: {
            targets: [
              { targetId: 'a', model: 'target-a', metadata: { latency: 50 } },
              { targetId: 'b', model: 'target-b', metadata: { latency: 10 } },
            ],
            targetSelection: {
              strategy: 'weighted',
              score: '100.0 - candidate.metadata.latency',
            },
          },
        },
      ],
      edges: [
        { id: 'entry-dispatcher', sourceNodeId: 'entry.prehydrated', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.prehydrated', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'endpoint-dispatcher', sourceNodeId: 'endpoint.prehydrated', sourcePortId: 'route.out', targetNodeId: 'dispatcher.prehydrated', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });
    expect(compiled.ok).toBe(true);

    expect(utils.celPlanCacheSize()).toBe(0);
    expect(hydrateFlatRouteProgramBundle(compiled.compiled.flatProgramBundle)).toBeTruthy();
    expect(utils.celPlanCacheSize()).toBe(2);

    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'prehydrated-model',
    })).toMatchObject({
      selectedRouteId: 31,
      selectedEndpointTarget: {
        targetId: 'b',
        model: 'target-b',
      },
    });
    expect(utils.celPlanCacheSize()).toBe(2);
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
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 1,
          metadata: { nodeScore: 10, edgeBoost: 0 },
          config: { targets: [{ targetId: '1', model: 'node-only' }], targetSelection: { strategy: 'weighted' } },
        },
        {
          id: 'endpoint.edge-boosted',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 2,
          metadata: { nodeScore: 5 },
          config: { targets: [{ targetId: '2', model: 'edge-boosted' }], targetSelection: { strategy: 'weighted' } },
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
        targetId: '2',
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
        { id: 'endpoint.first', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 1, config: { targets: [{ targetId: '1', model: 'first' }], targetSelection: { strategy: 'weighted' } } },
        { id: 'endpoint.second', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 2, config: { targets: [{ targetId: '2', model: 'second' }], targetSelection: { strategy: 'weighted' } } },
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
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 70,
          config: {
            targets: [
              { targetId: 'disabled', model: 'disabled', enabled: false },
              { targetId: 'a', model: 'target-a' },
              { targetId: 'b', model: 'target-b' },
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

    expect(first?.selectedEndpointTarget?.targetId).toBe('a');
    expect(second?.selectedEndpointTarget?.targetId).toBe('b');
    expect(third?.selectedEndpointTarget?.targetId).toBe('a');
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
        { id: 'endpoint.disabled', type: 'route_endpoint', enabled: false, visibility: 'internal', ownership: 'manual', legacyRouteId: 1, metadata: { weight: 100 }, config: { targets: [{ targetId: '1', model: 'a-disabled' }], targetSelection: { strategy: 'weighted' } } },
        { id: 'endpoint.enabled', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 2, metadata: { weight: 1 }, config: { targets: [{ targetId: '2', model: 'a-enabled' }], targetSelection: { strategy: 'weighted' } } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e2', sourceNodeId: 'endpoint.disabled', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'e3', sourceNodeId: 'endpoint.enabled', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.99);
    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'a',
    })?.selectedRouteId).toBe(2);
  });

  it('uses route dispatcher priority buckets before weighted random selection', () => {
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
        { id: 'endpoint.low-priority', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 1, metadata: { priority: 1, weight: 100 }, config: { targets: [{ targetId: '1', model: 'a-low-priority' }], targetSelection: { strategy: 'weighted' } } },
        { id: 'endpoint.high-priority-a', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 2, metadata: { priority: 10, weight: 1 }, config: { targets: [{ targetId: '2', model: 'a-high-priority-a' }], targetSelection: { strategy: 'weighted' } } },
        { id: 'endpoint.high-priority-b', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 3, metadata: { priority: 10, weight: 9 }, config: { targets: [{ targetId: '3', model: 'a-high-priority-b' }], targetSelection: { strategy: 'weighted' } } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e2', sourceNodeId: 'endpoint.low-priority', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'e3', sourceNodeId: 'endpoint.high-priority-a', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'e4', sourceNodeId: 'endpoint.high-priority-b', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.01);
    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'a',
    })?.selectedRouteId).toBe(2);

    vi.spyOn(Math, 'random').mockReturnValueOnce(0.99);
    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'a',
    })?.selectedRouteId).toBe(3);
  });

  it('uses route endpoint targetSelection to select the concrete endpoint target', () => {
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
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 1,
          config: {
            targets: [
              { targetId: '10', model: 'a-low', weight: 1 },
              { targetId: '20', model: 'a-high', weight: 9 },
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
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.5);
    expect(evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'a',
    })).toMatchObject({
      selectedEndpointTarget: {
        targetId: '20',
        model: 'a-high',
      },
      currentModel: 'a-high',
      upstreamModel: 'a-high',
    });
  });

  it('exposes route endpoint compatibility defaults and selected target overrides separately', () => {
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
          type: 'route_endpoint',
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
                targetId: '10',
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
      routeEndpointCompatibilityPolicy: {
        reasoningHistory: {
          transport: {
            mode: 'content_think_tag',
          },
        },
      },
      selectedEndpointTarget: {
        targetId: '10',
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

  it('defers route endpoint target selection to the token router when configured', () => {
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
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 1,
          config: {
            targets: [
              { targetId: '10', model: 'a-low', weight: 1 },
              { targetId: '20', model: 'a-high', weight: 9 },
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

  it('reruns dispatcher selection with request-local failed endpoint overlay', () => {
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
        {
          id: 'endpoint.primary',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 1,
          metadata: { priority: 10 },
          config: { targets: [{ targetId: '10', model: 'primary' }], targetSelection: { strategy: 'weighted' } },
        },
        {
          id: 'endpoint.backup',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 2,
          metadata: { priority: 1 },
          config: { targets: [{ targetId: '20', model: 'backup' }], targetSelection: { strategy: 'weighted' } },
        },
      ],
      edges: [
        { id: 'e-entry', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e-primary', sourceNodeId: 'endpoint.primary', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'e-backup', sourceNodeId: 'endpoint.backup', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    const first = evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'a',
    });
    expect(first?.selectedRouteId).toBe(1);
    expect(first?.candidateSnapshots?.map((candidate) => candidate.routeId).sort()).toEqual([1, 2]);

    const retry = evaluateCompiledRouteGraph({
      graph: compiled.compiled,
      requestedModel: 'a',
      failureOverlay: {
        disabledEndpointIds: ['endpoint.primary'],
        disabledTargetIds: [10],
      },
    });
    expect(retry?.selectedRouteId).toBe(2);
    expect(retry?.selectedEndpointTarget?.targetId).toBe('20');
    expect(retry?.candidateSnapshots?.some((candidate) => candidate.endpointId === 'endpoint.backup')).toBe(true);
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
        { id: 'endpoint.first', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 1, config: { targets: [{ targetId: '1', model: 'a-first' }], targetSelection: { strategy: 'weighted' } } },
        { id: 'endpoint.second', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 2, config: { targets: [{ targetId: '2', model: 'a-second' }], targetSelection: { strategy: 'weighted' } } },
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
          type: 'route_endpoint',
          enabled: false,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 1,
          config: { targets: [{ targetId: '1', model: 'disabled' }], targetSelection: { strategy: 'weighted' } },
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
        { id: 'endpoint.first', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 1, config: { targets: [{ targetId: '1', model: 'rr-first' }], targetSelection: { strategy: 'weighted' } } },
        { id: 'endpoint.second', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 2, config: { targets: [{ targetId: '2', model: 'rr-second' }], targetSelection: { strategy: 'weighted' } } },
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

  it('round-robins route endpoint targets and skips disabled targets', () => {
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
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 10,
          config: {
            targets: [
              { targetId: 'disabled', model: 'target-disabled', enabled: false },
              { targetId: 'a', model: 'target-a' },
              { targetId: 'b', model: 'target-b' },
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

    expect(evaluateCompiledRouteGraph({ graph: compiled.compiled, requestedModel: 'target-rr', stateStore })?.selectedEndpointTarget?.targetId).toBe('a');
    expect(evaluateCompiledRouteGraph({ graph: compiled.compiled, requestedModel: 'target-rr', stateStore })?.selectedEndpointTarget?.targetId).toBe('b');
    expect(evaluateCompiledRouteGraph({ graph: compiled.compiled, requestedModel: 'target-rr', stateStore })?.selectedEndpointTarget?.targetId).toBe('a');
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
        { id: 'endpoint.first', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 1, config: { targets: [{ targetId: '1', model: 'direct-first' }], targetSelection: { strategy: 'weighted' } } },
        { id: 'endpoint.second', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', legacyRouteId: 2, config: { targets: [{ targetId: '2', model: 'direct-second' }], targetSelection: { strategy: 'weighted' } } },
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

  it('hydrates program bundles for direct evaluation and refuses unusable bundles at runtime', () => {
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        { id: 'entry.program', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'program-model' } },
        {
          id: 'endpoint.program',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 42,
          config: { targets: [{ targetId: '42', model: 'program-model' }], targetSelection: { strategy: 'weighted' } },
        },
      ],
      edges: [
        { id: 'entry-endpoint', sourceNodeId: 'entry.program', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint.program', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });
    expect(compiled.ok).toBe(true);

    const firstHydrated = hydrateRouteProgramBundle(compiled.compiled.programBundle);
    const secondHydrated = hydrateRouteProgramBundle(compiled.compiled.programBundle);
    expect(firstHydrated).toBe(secondHydrated);
    expect(evaluateRouteProgramBundle({
      bundle: compiled.compiled.programBundle,
      requestedModel: 'program-model',
    })).toMatchObject({
      matchedEntryNodeId: 'entry.program',
      selectedRouteId: 42,
      trace: {
        path: expect.arrayContaining([
          expect.objectContaining({
            programId: 'program:entry.program',
            opId: expect.stringContaining('endpoint.program:select-supply'),
            sourceRef: expect.objectContaining({ nodeId: 'endpoint.program' }),
          }),
        ]),
      },
    });

    const graphWithoutUsableProgram = {
      ...compiled.compiled,
      programBundle: {
        ...compiled.compiled.programBundle,
        programs: [],
      },
      flatProgramBundle: {
        ...compiled.compiled.flatProgramBundle,
        programs: [],
      },
    };
    expect(evaluateCompiledRouteGraph({
      graph: graphWithoutUsableProgram,
      requestedModel: 'program-model',
    })).toBe(null);

    expect(evaluateCompiledRouteGraph({
      graph: {
        ...compiled.compiled,
        flatProgramBundle: undefined as unknown as typeof compiled.compiled.flatProgramBundle,
      },
      requestedModel: 'program-model',
    })).toBe(null);

    expect(hydrateRouteProgramBundle({
      ...compiled.compiled.programBundle,
      diagnostics: [{
        severity: 'error',
        code: 'program.unsupported_shape',
        message: 'unsupported',
      }],
    })).toBe(null);

    expect(hydrateRouteProgramBundle({
      ...compiled.compiled.programBundle,
      matcher: {
        ...compiled.compiled.programBundle.matcher,
        patterns: [{
          ...compiled.compiled.programBundle.matcher.exact['program-model'],
          pattern: 're:(a+)+',
          patternKind: 'regex',
        }],
      },
    })).toBe(null);
  });
});
