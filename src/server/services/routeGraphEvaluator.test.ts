import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compileRouteGraphSource as compileRouteGraphSourceBase,
  normalizeRouteGraphSource,
} from '../../shared/routeGraph.js';
import {
  applyRouteRuntimePostBuildFilters,
  evaluateCompiledRuntimeArtifact,
  evaluateCompiledRouterBundle,
  hydrateCompiledRouterBundle,
} from './routeRuntimeEvaluatorService.js';
import { __selectorEngineTestUtils } from './selectorEngine.js';

function compileRouteGraphSource(source: Parameters<typeof compileRouteGraphSourceBase>[0]) {
  let nextExecutionTargetId = 1;
  for (const node of source.nodes || []) {
    if (node.type !== 'route_endpoint') continue;
    node.routeEndpointId ||= node.id;
    const config = node.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) continue;
    const targets = Array.isArray(config.targets) ? config.targets : [];
    for (const target of targets) {
      if (!target || typeof target !== 'object' || Array.isArray(target)) continue;
      if (target.transportBinding?.kind !== 'execution_target') {
        target.transportBinding = {
          kind: 'execution_target',
          executionTargetId: nextExecutionTargetId,
        };
      }
      nextExecutionTargetId += 1;
    }
  }
  return compileRouteGraphSourceBase(source);
}

describe('route graph runtime evaluator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('evaluates multi-hop model rewrite and payload filters without provider hardcoding', () => {
    const source = normalizeRouteGraphSource({
      nodes: [
        {
          id: 'entry.deepseek-max',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'deepseek-v4-pro-max', displayName: null, routeId: 100 },
        },
        {
          id: 'filter.strip-max',
          type: 'filter',
          enabled: true,
          ownership: 'manual',
          operations: [
            { type: 'rewrite_model', source: 'current_model', operation: 'strip_suffix', suffix: '-max' },
          ],
        },
        {
          id: 'filter.thinking',
          type: 'filter',
          enabled: true,
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
          ownership: 'manual',
          mode: 'route',
          ordering: 'explicit',
          policy: { kind: 'builtin', builtin: 'weighted' },
        },
        {
          id: 'endpoint.deepseek-pro',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          config: { targets: [{ targetId: '101', model: 'deepseek-v4-pro', accountId: 1, tokenId: 1 }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
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
    expect(compiled.compiled.compiledRouterBundle?.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('compiled_router.unsupported_filter_path');
    const compiledRouterPlan = compiled.compiled.compiledRouterBundle?.plans.find((plan) => plan.id === 'program:entry.deepseek-max');
    expect(compiledRouterPlan?.executionAlternatives[0]?.filterStageIndexes.map((index) => compiledRouterPlan.filterStages[index]?.nodeId)).toEqual([
      'filter.strip-max',
      'filter.thinking',
    ]);

    const selection = evaluateCompiledRuntimeArtifact({
      graph: compiled.compiled,
      requestedModel: 'deepseek-v4-pro-max',
    });

    expect(selection).toMatchObject({
      matchedEntryNodeId: 'entry.deepseek-max',
      currentModel: 'deepseek-v4-pro',
      terminalKind: 'endpoint',
      selectedExecutionAttempt: {
        targetId: '101',
        model: 'deepseek-v4-pro',
      },
    });
    expect(selection?.postBuildFilters.payload.map((operation) => operation.type)).toEqual(['set_payload', 'set_payload']);

    const filtered = applyRouteRuntimePostBuildFilters({
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
      nodes: [
        {
          id: 'entry.rules',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'rules-model' },
        },
        {
          id: 'filter.rules',
          type: 'filter',
          enabled: true,
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
          ownership: 'manual',
          config: { targets: [{ targetId: '41', model: 'rules-model' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
      ],
      edges: [
        { id: 'entry-filter', sourceNodeId: 'entry.rules', sourcePortId: 'bidirect.out', targetNodeId: 'filter.rules', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'filter-endpoint', sourceNodeId: 'filter.rules', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint.rules', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });
    const compiled = compileRouteGraphSource(source);
    expect(compiled.ok).toBe(true);

    const selection = evaluateCompiledRuntimeArtifact({
      graph: compiled.compiled,
      requestedModel: 'rules-model',
    });

    const filtered = applyRouteRuntimePostBuildFilters({
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
      nodes: [
        {
          id: 'entry.blocked',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'blocked-model' },
        },
        {
          id: 'synthetic.503',
          type: 'synthetic_endpoint',
          enabled: true,
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
    expect(evaluateCompiledRuntimeArtifact({
      graph: compiled.compiled,
      requestedModel: 'blocked-model',
    })).toMatchObject({
      terminalKind: 'synthetic_response',
      syntheticResponse: {
        statusCode: 503,
        message: 'No backend for this model',
      },
    });
  });

  it('allows a supply route endpoint node to be reused by a dispatcher', () => {
    const compiled = compileRouteGraphSource({
      nodes: [
        {
          id: 'entry.public',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'public-model' },
        },
        {
          id: 'endpoint.reused',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          endpointKind: 'supply',
          routeEndpointId: 'entry.public',
          config: { targets: [{ targetId: '77', model: 'public-model' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
        {
          id: 'dispatcher.reuse',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: { kind: 'builtin', builtin: 'weighted' },
        },
      ],
      edges: [
        { id: 'reuse-entry', sourceNodeId: 'entry.public', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.reuse', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'reuse-supply', sourceNodeId: 'endpoint.reused', sourcePortId: 'route.out', targetNodeId: 'dispatcher.reuse', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    expect(evaluateCompiledRuntimeArtifact({
      graph: compiled.compiled,
      requestedModel: 'public-model',
    })).toMatchObject({
      matchedEntryNodeId: 'entry.public',
      terminalNodeId: 'endpoint.reused',
    });
  });

  it('enforces the configured max hop limit during traversal', () => {
    const source = normalizeRouteGraphSource({
      nodes: [
        { id: 'entry.a', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'a' } },
        { id: 'filter.1', type: 'filter', enabled: true, ownership: 'manual', operations: [] },
        { id: 'filter.2', type: 'filter', enabled: true, ownership: 'manual', operations: [] },
        { id: 'endpoint.a', type: 'route_endpoint', enabled: true, ownership: 'manual', routeEndpointId: 'entry.a', config: { targets: [{ targetId: '1', model: 'a' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'filter.1', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e2', sourceNodeId: 'filter.1', sourcePortId: 'bidirect.out', targetNodeId: 'filter.2', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e3', sourceNodeId: 'filter.2', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint.a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });
    const compiled = compileRouteGraphSource(source);
    expect(compiled.ok).toBe(true);
    const graphWithoutFlatBundle = compiled.compiled;

    expect(evaluateCompiledRuntimeArtifact({
      graph: graphWithoutFlatBundle,
      requestedModel: 'a',
      maxHops: 2,
    })).toBe(null);
    expect(evaluateCompiledRuntimeArtifact({
      graph: graphWithoutFlatBundle,
      requestedModel: 'a',
      maxHops: 4,
    })?.terminalKind).toBe('endpoint');
  });

  it('uses route dispatcher weighted strategy as weighted random selection', () => {
    const compiled = compileRouteGraphSource({
      nodes: [
        { id: 'entry.a', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'a' } },
        {
          id: 'dispatcher.a',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: { kind: 'builtin', builtin: 'weighted' },
        },
        { id: 'endpoint.low', type: 'route_endpoint', enabled: true, ownership: 'manual', routeEndpointId: 'entry.a', metadata: { weight: 1 }, config: { targets: [{ targetId: '1', model: 'a-low' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
        { id: 'endpoint.high', type: 'route_endpoint', enabled: true, ownership: 'manual', routeEndpointId: 'entry.a', metadata: { weight: 10 }, config: { targets: [{ targetId: '2', model: 'a-high' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e3', sourceNodeId: 'endpoint.low', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'e4', sourceNodeId: 'endpoint.high', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    const graphWithoutFlatBundle = compiled.compiled;
    expect(evaluateCompiledRuntimeArtifact({
      graph: graphWithoutFlatBundle,
      requestedModel: 'a',
      random: () => 0.01,
    })?.selectedExecutionAttempt?.targetId).toBe('1');

    expect(evaluateCompiledRuntimeArtifact({
      graph: graphWithoutFlatBundle,
      requestedModel: 'a',
      random: () => 0.99,
    })?.selectedExecutionAttempt?.targetId).toBe('2');
  });

  it('uses route dispatcher CEL score policy over candidate metadata', () => {
    const compiled = compileRouteGraphSource({
      nodes: [
        { id: 'entry.a', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'a' } },
        {
          id: 'dispatcher.a',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: {
            kind: 'inline',
            policy: {
              id: 'rank-by-quality-and-cost',
              name: 'Rank by quality and cost',
              kind: 'cel',
              selectionMode: 'ordered',
              orderExpression: '-(endpoint.metadata.qualityScore - endpoint.metadata.costRank)',
            },
          },
        },
        { id: 'endpoint.low', type: 'route_endpoint', enabled: true, ownership: 'manual', metadata: { qualityScore: 5, costRank: 1 }, config: { targets: [{ targetId: '1', model: 'a-low' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
        { id: 'endpoint.high', type: 'route_endpoint', enabled: true, ownership: 'manual', metadata: { qualityScore: 10, costRank: 2 }, config: { targets: [{ targetId: '2', model: 'a-high' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e2', sourceNodeId: 'endpoint.low', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'e3', sourceNodeId: 'endpoint.high', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.99);
    expect(evaluateCompiledRuntimeArtifact({
      graph: compiled.compiled,
      requestedModel: 'a',
    })?.selectedExecutionAttempt?.targetId).toBe('2');
  });

  it('hydrates compiled router selector CEL plans only for the matched plan', () => {
    const utils = __selectorEngineTestUtils();
    utils.clearCelPlanCache();
    const compiled = compileRouteGraphSource({
      nodes: [
        { id: 'entry.prehydrated', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'prehydrated-model' } },
        {
          id: 'dispatcher.prehydrated',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: {
            kind: 'inline',
            policy: {
              id: 'rank-prehydrated-endpoints',
              name: 'Rank prehydrated endpoints',
              kind: 'cel',
              selectionMode: 'ordered',
              orderExpression: '-(endpoint.metadata.quality - endpoint.metadata.cost)',
            },
          },
        },
        {
          id: 'endpoint.prehydrated',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          metadata: { quality: 10, cost: 1 },
          config: {
            targets: [
              { targetId: 'a', model: 'target-a', metadata: { latency: 50 } },
              { targetId: 'b', model: 'target-b', metadata: { latency: 10 } },
            ],
            targetSelection: {
              kind: 'inline',
              policy: {
                id: 'rank-prehydrated-attempts',
                name: 'Rank prehydrated attempts',
                kind: 'cel',
                selectionMode: 'ordered',
                orderExpression: '-(100.0 - self.metadata.latency)',
              },
            },
          },
        },
        { id: 'entry.unused', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'unused-model' } },
        {
          id: 'dispatcher.unused',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: {
            kind: 'inline',
            policy: {
              id: 'rank-unused-endpoints',
              name: 'Rank unused endpoints',
              kind: 'cel',
              selectionMode: 'ordered',
              orderExpression: '-(endpoint.metadata.quality * 10)',
            },
          },
        },
        {
          id: 'endpoint.unused',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          metadata: { quality: 1 },
          config: {
            targets: [
              { targetId: 'unused', model: 'target-unused', metadata: { latency: 1 } },
            ],
            targetSelection: {
              kind: 'inline',
              policy: {
                id: 'rank-unused-attempts',
                name: 'Rank unused attempts',
                kind: 'cel',
                selectionMode: 'ordered',
                orderExpression: '-(self.metadata.latency * 2)',
              },
            },
          },
        },
      ],
      edges: [
        { id: 'entry-dispatcher', sourceNodeId: 'entry.prehydrated', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.prehydrated', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'endpoint-dispatcher', sourceNodeId: 'endpoint.prehydrated', sourcePortId: 'route.out', targetNodeId: 'dispatcher.prehydrated', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'unused-entry-dispatcher', sourceNodeId: 'entry.unused', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.unused', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'unused-endpoint-dispatcher', sourceNodeId: 'endpoint.unused', sourcePortId: 'route.out', targetNodeId: 'dispatcher.unused', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });
    expect(compiled.ok).toBe(true);

    expect(utils.celPlanCacheSize()).toBe(0);
    expect(hydrateCompiledRouterBundle(compiled.compiled.compiledRouterBundle!)).toBeTruthy();
    expect(utils.celPlanCacheSize()).toBe(0);

    expect(evaluateCompiledRuntimeArtifact({
      graph: compiled.compiled,
      requestedModel: 'prehydrated-model',
    })).toMatchObject({
      selectedExecutionAttempt: {
        targetId: 'b',
        model: 'target-b',
      },
    });
    expect(utils.celPlanCacheSize()).toBe(2);
  });

  it('exposes merged endpoint and edge metadata to route dispatcher CEL scoring', () => {
    const compiled = compileRouteGraphSource({
      nodes: [
        { id: 'entry.metadata', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'metadata-model' } },
        {
          id: 'dispatcher.metadata',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: {
            kind: 'inline',
            policy: {
              id: 'rank-by-node-and-edge',
              name: 'Rank by node and edge metadata',
              kind: 'cel',
              selectionMode: 'ordered',
              orderExpression: '-(endpoint.metadata.nodeScore + self.metadata.edgeBoost)',
            },
          },
        },
        {
          id: 'endpoint.node-only',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          metadata: { nodeScore: 10, edgeBoost: 0 },
          config: { targets: [{ targetId: '1', model: 'node-only' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
        {
          id: 'endpoint.edge-boosted',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          metadata: { nodeScore: 5 },
          config: { targets: [{ targetId: '2', model: 'edge-boosted' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
      ],
      edges: [
        { id: 'entry-dispatcher', sourceNodeId: 'entry.metadata', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.metadata', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'node-only-route', sourceNodeId: 'endpoint.node-only', sourcePortId: 'route.out', targetNodeId: 'dispatcher.metadata', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual', metadata: { edgeBoost: 0 } },
        { id: 'edge-boosted-route', sourceNodeId: 'endpoint.edge-boosted', sourcePortId: 'route.out', targetNodeId: 'dispatcher.metadata', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual', metadata: { edgeBoost: 20 } },
      ],
    });

    expect(compiled.ok).toBe(true);
    expect(evaluateCompiledRuntimeArtifact({
      graph: compiled.compiled,
      requestedModel: 'metadata-model',
    })).toMatchObject({
      selectedExecutionAttempt: {
        targetId: '2',
        model: 'edge-boosted',
      },
    });
  });

  it('uses route dispatcher direct CEL select and rejects an out-of-range result', () => {
    const compiled = compileRouteGraphSource({
      nodes: [
        { id: 'entry.direct', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'direct-model' } },
        {
          id: 'dispatcher.direct',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: {
            kind: 'inline',
            policy: {
              id: 'choose-direct-model',
              name: 'Choose direct model',
              kind: 'cel',
              selectionMode: 'direct',
              selectExpression: 'payload.currentModel == "direct-model" ? 1 : 99',
            },
          },
        },
        { id: 'endpoint.first', type: 'route_endpoint', enabled: true, ownership: 'manual', config: { targets: [{ targetId: '1', model: 'first' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
        { id: 'endpoint.second', type: 'route_endpoint', enabled: true, ownership: 'manual', config: { targets: [{ targetId: '2', model: 'second' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
      ],
      edges: [
        { id: 'entry-dispatcher', sourceNodeId: 'entry.direct', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.direct', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'first-route', sourceNodeId: 'endpoint.first', sourcePortId: 'route.out', targetNodeId: 'dispatcher.direct', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'second-route', sourceNodeId: 'endpoint.second', sourcePortId: 'route.out', targetNodeId: 'dispatcher.direct', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });
    expect(compiled.ok).toBe(true);

    expect(evaluateCompiledRuntimeArtifact({
      graph: compiled.compiled,
      requestedModel: 'direct-model',
    })?.selectedExecutionAttempt?.targetId).toBe('2');

    const rewritten = compileRouteGraphSource({
      ...compiled.source,
      nodes: compiled.source.nodes.map((node) => (
        node.id === 'dispatcher.direct'
          ? {
            ...node,
            policy: {
              kind: 'inline',
              policy: {
                id: 'choose-direct-model',
                name: 'Choose direct model',
                kind: 'cel',
                selectionMode: 'direct',
                selectExpression: '99',
              },
            },
          }
          : node
      )),
    });
    expect(rewritten.ok).toBe(true);
    expect(() => evaluateCompiledRuntimeArtifact({
      graph: rewritten.compiled,
      requestedModel: 'direct-model',
    })).toThrow(/direct selection/i);
  });

  it('round-robins endpoint targets while ignoring disabled targets', () => {
    const compiled = compileRouteGraphSource({
      nodes: [
        { id: 'entry.targets', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'target-model' } },
        {
          id: 'dispatcher.targets',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: { kind: 'builtin', builtin: 'weighted' },
        },
        {
          id: 'endpoint.targets',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          endpointKind: 'supply',
          config: {
            targets: [
              { targetId: 'disabled', model: 'disabled', enabled: false },
              { targetId: 'a', model: 'target-a' },
              { targetId: 'b', model: 'target-b' },
            ],
            targetSelection: { kind: 'builtin', builtin: 'round_robin' },
          },
        },
      ],
      edges: [
        { id: 'entry-dispatcher', sourceNodeId: 'entry.targets', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.targets', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        {
          id: 'endpoint-candidate',
          sourceNodeId: 'endpoint.targets',
          sourcePortId: 'route.out',
          targetNodeId: 'dispatcher.targets',
          targetPortId: 'route.in',
          kind: 'route_flow',
          ownership: 'manual',
        },
      ],
    });
    expect(compiled.ok).toBe(true);

    const stateStore: Record<string, unknown> = {};
    const first = evaluateCompiledRuntimeArtifact({ graph: compiled.compiled, requestedModel: 'target-model', stateStore });
    const second = evaluateCompiledRuntimeArtifact({ graph: compiled.compiled, requestedModel: 'target-model', stateStore });
    const third = evaluateCompiledRuntimeArtifact({ graph: compiled.compiled, requestedModel: 'target-model', stateStore });

    expect(first?.selectedExecutionAttempt?.targetId).toBe('a');
    expect(second?.selectedExecutionAttempt?.targetId).toBe('b');
    expect(third?.selectedExecutionAttempt?.targetId).toBe('a');
    expect(Object.values(stateStore)).toContain(3);
  });

  it('ignores disabled route candidates before applying dispatcher policy', () => {
    const compiled = compileRouteGraphSource({
      nodes: [
        { id: 'entry.a', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'a' } },
        {
          id: 'dispatcher.a',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: { kind: 'builtin', builtin: 'weighted' },
        },
        { id: 'endpoint.disabled', type: 'route_endpoint', enabled: false, ownership: 'manual', metadata: { weight: 100 }, config: { targets: [{ targetId: '1', model: 'a-disabled' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
        { id: 'endpoint.enabled', type: 'route_endpoint', enabled: true, ownership: 'manual', metadata: { weight: 1 }, config: { targets: [{ targetId: '2', model: 'a-enabled' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e2', sourceNodeId: 'endpoint.disabled', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'e3', sourceNodeId: 'endpoint.enabled', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.99);
    expect(evaluateCompiledRuntimeArtifact({
      graph: compiled.compiled,
      requestedModel: 'a',
    })?.selectedExecutionAttempt?.targetId).toBe('2');
  });

  it('selects only the first available fallback stage before applying its stage policy', () => {
    const compiled = compileRouteGraphSource({
      nodes: [
        { id: 'endpoint.fallback', type: 'route_endpoint', enabled: true, ownership: 'manual', endpointKind: 'supply', config: { targets: [{ targetId: '1', model: 'a-fallback' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
        { id: 'endpoint.primary-a', type: 'route_endpoint', enabled: true, ownership: 'manual', endpointKind: 'supply', config: { targets: [{ targetId: '2', model: 'a-primary-a' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
        { id: 'endpoint.primary-b', type: 'route_endpoint', enabled: true, ownership: 'manual', endpointKind: 'supply', config: { targets: [{ targetId: '3', model: 'a-primary-b' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
      ],
      edges: [],
      macros: [{
        id: 'macro:fallback-stages',
        kind: 'candidate_selector',
        enabled: true,
        ownership: 'manual',
        config: {
          surface: {
            entry: { kind: 'external', match: { requestedModelPattern: 'a', displayName: 'a' } },
            output: 'route',
          },
          policy: { kind: 'builtin', builtin: 'weighted' },
          groups: [
            {
              id: 'primary',
              enabled: true,
              policy: { kind: 'builtin', builtin: 'weighted' },
              input: { kind: 'route_endpoints', endpointIds: ['endpoint.primary-a', 'endpoint.primary-b'] },
              members: [
                { endpointId: 'endpoint.primary-a', weight: 1 },
                { endpointId: 'endpoint.primary-b', weight: 9 },
              ],
            },
            {
              id: 'fallback',
              enabled: true,
              policy: { kind: 'builtin', builtin: 'weighted' },
              input: { kind: 'route_endpoints', endpointIds: ['endpoint.fallback'] },
              members: [{ endpointId: 'endpoint.fallback', weight: 100 }],
            },
          ],
        },
      }],
    });

    expect(compiled.ok).toBe(true);
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.01);
    expect(evaluateCompiledRuntimeArtifact({
      graph: compiled.compiled,
      requestedModel: 'a',
    })?.selectedExecutionAttempt?.targetId).toBe('2');

    vi.spyOn(Math, 'random').mockReturnValueOnce(0.99);
    expect(evaluateCompiledRuntimeArtifact({
      graph: compiled.compiled,
      requestedModel: 'a',
    })?.selectedExecutionAttempt?.targetId).toBe('3');
  });

  it('uses route endpoint targetSelection to select the concrete endpoint target', () => {
    const compiled = compileRouteGraphSource({
      nodes: [
        { id: 'entry.a', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'a' } },
        {
          id: 'dispatcher.a',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: { kind: 'builtin', builtin: 'weighted' },
        },
        {
          id: 'endpoint.a',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          config: {
            targets: [
              { targetId: '10', model: 'a-low', weight: 1 },
              { targetId: '20', model: 'a-high', weight: 9 },
            ],
            targetSelection: { kind: 'builtin', builtin: 'weighted' },
          },
        },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e2', sourceNodeId: 'endpoint.a', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    const graphWithoutFlatBundle = compiled.compiled;
    expect(evaluateCompiledRuntimeArtifact({
      graph: graphWithoutFlatBundle,
      requestedModel: 'a',
      random: () => 0.01,
    })).toMatchObject({
      selectedExecutionAttempt: {
        targetId: '10',
        model: 'a-low',
      },
      currentModel: 'a',
      upstreamModel: 'a-low',
    });
    expect(evaluateCompiledRuntimeArtifact({
      graph: graphWithoutFlatBundle,
      requestedModel: 'a',
      random: () => 0.5,
    })).toMatchObject({
      selectedExecutionAttempt: {
        targetId: '20',
        model: 'a-high',
      },
      currentModel: 'a',
      upstreamModel: 'a-high',
    });
  });

  it('exposes route endpoint compatibility defaults and selected target overrides separately', () => {
    const compiled = compileRouteGraphSource({
      nodes: [
        { id: 'entry.compat', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'compat' } },
        {
          id: 'dispatcher.compat',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: { kind: 'builtin', builtin: 'weighted' },
        },
        {
          id: 'endpoint.compat',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
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
            targetSelection: { kind: 'builtin', builtin: 'weighted' },
          },
        },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.compat', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.compat', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e2', sourceNodeId: 'endpoint.compat', sourcePortId: 'route.out', targetNodeId: 'dispatcher.compat', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    expect(evaluateCompiledRuntimeArtifact({
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
      selectedExecutionAttempt: {
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

  it('emits unresolved endpoint selection for compiled runtime execution when configured', () => {
    const compiled = compileRouteGraphSource({
      nodes: [
        { id: 'entry.a', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'a' } },
        {
          id: 'dispatcher.a',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: { kind: 'builtin', builtin: 'weighted' },
        },
        {
          id: 'endpoint.a',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          config: {
            targets: [
              { targetId: '10', model: 'a-low', weight: 1 },
              { targetId: '20', model: 'a-high', weight: 9 },
            ],
            targetSelection: { kind: 'defer_to_router' },
          },
        },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e2', sourceNodeId: 'endpoint.a', sourcePortId: 'route.out', targetNodeId: 'dispatcher.a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    expect(evaluateCompiledRuntimeArtifact({
      graph: compiled.compiled,
      requestedModel: 'a',
    })).toMatchObject({
      selectedExecutionAttempt: null,
      currentModel: 'a',
    });
  });

  it('advances to the next fallback stage when the current stage is exhausted', () => {
    const compiled = compileRouteGraphSource({
      nodes: [
        {
          id: 'endpoint.primary',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          endpointKind: 'supply',
          config: {
            targets: [{ targetId: '10', model: 'primary', transportBinding: { kind: 'execution_target', executionTargetId: 10 } }],
            targetSelection: { kind: 'builtin', builtin: 'weighted' },
          },
        },
        {
          id: 'endpoint.backup',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          endpointKind: 'supply',
          config: {
            targets: [{ targetId: '20', model: 'backup', transportBinding: { kind: 'execution_target', executionTargetId: 20 } }],
            targetSelection: { kind: 'builtin', builtin: 'weighted' },
          },
        },
      ],
      edges: [],
      macros: [{
        id: 'macro:retry-fallback',
        kind: 'candidate_selector',
        enabled: true,
        ownership: 'manual',
        config: {
          surface: {
            entry: { kind: 'external', match: { requestedModelPattern: 'a', displayName: 'a' } },
            output: 'route',
          },
          policy: { kind: 'builtin', builtin: 'weighted' },
          groups: [
            {
              id: 'primary',
              enabled: true,
              input: { kind: 'route_endpoints', endpointIds: ['endpoint.primary'] },
              members: [{ endpointId: 'endpoint.primary' }],
            },
            {
              id: 'fallback',
              enabled: true,
              input: { kind: 'route_endpoints', endpointIds: ['endpoint.backup'] },
              members: [{ endpointId: 'endpoint.backup' }],
            },
          ],
        },
      }],
    });

    expect(compiled.ok).toBe(true);
    const first = evaluateCompiledRuntimeArtifact({
      graph: compiled.compiled,
      requestedModel: 'a',
    });
    expect(first?.selectedExecutionAttempt?.targetId).toBe('10');
    expect(first?.fallbackStageSnapshots?.map((stage) => stage.stageId)).toEqual(['macro:macro:retry-fallback:dispatcher']);

    const retry = evaluateCompiledRuntimeArtifact({
      graph: compiled.compiled,
      requestedModel: 'a',
      failureOverlay: {
        disabledExecutionTargetIds: [10],
      },
    });
    expect(retry?.selectedExecutionAttempt?.targetId).toBe('20');
    expect(retry?.fallbackStageSnapshots?.map((stage) => stage.stageId)).toEqual([
      'macro:macro:retry-fallback:fallback-stage:fallback:dispatcher',
    ]);
  });

  it('uses direct flow dispatcher policy to choose a bidirect branch', () => {
    const compiled = compileRouteGraphSource({
      nodes: [
        { id: 'entry.a', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'a' } },
        {
          id: 'dispatcher.flow',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'flow',
          policy: {
            kind: 'inline',
            policy: {
              id: 'choose-flow-branch',
              name: 'Choose flow branch',
              kind: 'cel',
              selectionMode: 'direct',
              selectExpression: 'payload.currentModel == "a" ? 1 : 0',
            },
          },
        },
        { id: 'endpoint.first', type: 'route_endpoint', enabled: true, ownership: 'manual', config: { targets: [{ targetId: '1', model: 'a-first' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
        { id: 'endpoint.second', type: 'route_endpoint', enabled: true, ownership: 'manual', config: { targets: [{ targetId: '2', model: 'a-second' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'entry.a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.flow', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e2', sourceNodeId: 'dispatcher.flow', sourcePortId: 'bidirect[1...].out', targetNodeId: 'endpoint.first', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'e3', sourceNodeId: 'dispatcher.flow', sourcePortId: 'bidirect[1...].out', targetNodeId: 'endpoint.second', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    expect(evaluateCompiledRuntimeArtifact({
      graph: compiled.compiled,
      requestedModel: 'a',
    })?.selectedExecutionAttempt?.targetId).toBe('2');
  });

  it('can select synthetic fallback branches from bidirect flow dispatchers', () => {
    const compiled = compileRouteGraphSource({
      nodes: [
        { id: 'entry.flow-fallback', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'flow-fallback' } },
        {
          id: 'dispatcher.flow-fallback',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'flow',
          policy: { kind: 'builtin', builtin: 'stable_first' },
        },
        {
          id: 'endpoint.unavailable',
          type: 'route_endpoint',
          enabled: false,
          ownership: 'manual',
          config: { targets: [{ targetId: '1', model: 'disabled' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
        {
          id: 'synthetic.rate-limit',
          type: 'synthetic_endpoint',
          enabled: true,
          ownership: 'manual',
          statusCode: 429,
          message: 'Rate limited by route graph',
        },
      ],
      edges: [
        { id: 'entry-dispatcher', sourceNodeId: 'entry.flow-fallback', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.flow-fallback', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'disabled-primary', sourceNodeId: 'dispatcher.flow-fallback', sourcePortId: 'bidirect[1...].out', targetNodeId: 'endpoint.unavailable', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual', metadata: { enabled: false } },
        { id: 'fallback', sourceNodeId: 'dispatcher.flow-fallback', sourcePortId: 'bidirect[1...].out', targetNodeId: 'synthetic.rate-limit', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });

    expect(compiled.ok).toBe(true);
    expect(evaluateCompiledRuntimeArtifact({
      graph: compiled.compiled,
      requestedModel: 'flow-fallback',
    })).toMatchObject({
      terminalKind: 'synthetic_response',
      syntheticResponse: {
        statusCode: 429,
        message: 'Rate limited by route graph',
      },
    });
  });

  it('round-robins route dispatcher candidates through the supplied runtime state store', () => {
    const compiled = compileRouteGraphSource({
      nodes: [
        { id: 'entry.rr', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'rr' } },
        {
          id: 'dispatcher.rr',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: { kind: 'builtin', builtin: 'round_robin' },
        },
        { id: 'endpoint.first', type: 'route_endpoint', enabled: true, ownership: 'manual', config: { targets: [{ targetId: '1', model: 'rr-first' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
        { id: 'endpoint.second', type: 'route_endpoint', enabled: true, ownership: 'manual', config: { targets: [{ targetId: '2', model: 'rr-second' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
      ],
      edges: [
        { id: 'entry-dispatcher', sourceNodeId: 'entry.rr', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.rr', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'first-route', sourceNodeId: 'endpoint.first', sourcePortId: 'route.out', targetNodeId: 'dispatcher.rr', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'second-route', sourceNodeId: 'endpoint.second', sourcePortId: 'route.out', targetNodeId: 'dispatcher.rr', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });
    expect(compiled.ok).toBe(true);

    const stateStore: Record<string, unknown> = {};

    expect(evaluateCompiledRuntimeArtifact({ graph: compiled.compiled, requestedModel: 'rr', stateStore })?.selectedExecutionAttempt?.targetId).toBe('1');
    expect(evaluateCompiledRuntimeArtifact({ graph: compiled.compiled, requestedModel: 'rr', stateStore })?.selectedExecutionAttempt?.targetId).toBe('2');
    expect(evaluateCompiledRuntimeArtifact({ graph: compiled.compiled, requestedModel: 'rr', stateStore })?.selectedExecutionAttempt?.targetId).toBe('1');
    expect(stateStore).toMatchObject({ 'selector:program:entry.rr:op:dispatcher.rr:dispatch-route:round_robin': 3 });
    expect(stateStore).not.toHaveProperty('dispatcher:dispatcher.rr:round_robin');
  });

  it('round-robins route endpoint targets and skips disabled targets', () => {
    const compiled = compileRouteGraphSource({
      nodes: [
        { id: 'entry.targets', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'target-rr' } },
        {
          id: 'dispatcher.targets',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: { kind: 'builtin', builtin: 'weighted' },
        },
        {
          id: 'endpoint.targets',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          config: {
            targets: [
              { targetId: 'disabled', model: 'target-disabled', enabled: false },
              { targetId: 'a', model: 'target-a' },
              { targetId: 'b', model: 'target-b' },
            ],
            targetSelection: { kind: 'builtin', builtin: 'round_robin' },
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

    expect(evaluateCompiledRuntimeArtifact({ graph: compiled.compiled, requestedModel: 'target-rr', stateStore })?.selectedExecutionAttempt?.targetId).toBe('a');
    expect(evaluateCompiledRuntimeArtifact({ graph: compiled.compiled, requestedModel: 'target-rr', stateStore })?.selectedExecutionAttempt?.targetId).toBe('b');
    expect(evaluateCompiledRuntimeArtifact({ graph: compiled.compiled, requestedModel: 'target-rr', stateStore })?.selectedExecutionAttempt?.targetId).toBe('a');
    expect(stateStore).toMatchObject({
      'selector:endpoint.targets:execution_attempt:round_robin': 3,
    });
    expect(stateStore).not.toHaveProperty('dispatcher:endpoint.targets:round_robin');
    expect(stateStore).not.toHaveProperty('dispatcher:endpoint.targets:execution_attempt:round_robin');
  });

  it('rejects an out-of-range direct CEL branch index', () => {
    const compiled = compileRouteGraphSource({
      nodes: [
        { id: 'entry.direct', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'direct' } },
        {
          id: 'dispatcher.direct',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'flow',
          policy: {
            kind: 'inline',
            policy: {
              id: 'out-of-range-direct',
              name: 'Out of range direct',
              kind: 'cel',
              selectionMode: 'direct',
              selectExpression: '99',
            },
          },
        },
        { id: 'endpoint.first', type: 'route_endpoint', enabled: true, ownership: 'manual', config: { targets: [{ targetId: '1', model: 'direct-first' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
        { id: 'endpoint.second', type: 'route_endpoint', enabled: true, ownership: 'manual', config: { targets: [{ targetId: '2', model: 'direct-second' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
      ],
      edges: [
        { id: 'entry-dispatcher', sourceNodeId: 'entry.direct', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.direct', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'first-flow', sourceNodeId: 'dispatcher.direct', sourcePortId: 'bidirect[1...].out', targetNodeId: 'endpoint.first', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'second-flow', sourceNodeId: 'dispatcher.direct', sourcePortId: 'bidirect[1...].out', targetNodeId: 'endpoint.second', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });
    expect(compiled.ok).toBe(true);

    expect(() => evaluateCompiledRuntimeArtifact({
      graph: compiled.compiled,
      requestedModel: 'direct',
    })).toThrow(/direct selection/i);
  });

  it('hydrates compiled router bundles for direct evaluation and refuses unusable bundles at runtime', () => {
    const compiled = compileRouteGraphSource({
      nodes: [
        { id: 'entry.program', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'program-model' } },
        {
          id: 'endpoint.program',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          config: { targets: [{ targetId: '42', model: 'program-model' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
      ],
      edges: [
        { id: 'entry-endpoint', sourceNodeId: 'entry.program', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint.program', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });
    expect(compiled.ok).toBe(true);

    const firstCompiledRouter = hydrateCompiledRouterBundle(compiled.compiled.compiledRouterBundle!);
    const secondCompiledRouter = hydrateCompiledRouterBundle(compiled.compiled.compiledRouterBundle!);
    expect(firstCompiledRouter).toBe(secondCompiledRouter);

    const compiledRouterBundleWithoutRouteEndpointId = structuredClone(compiled.compiled.compiledRouterBundle!);
    delete (compiledRouterBundleWithoutRouteEndpointId.plans[0].executionAlternatives[0].terminal as Record<string, unknown>).routeEndpointId;
    expect(evaluateCompiledRouterBundle({
      bundle: compiledRouterBundleWithoutRouteEndpointId,
      requestedModel: 'program-model',
    })).toMatchObject({
      selectedEntryNodeId: 'entry.program',
      selectedExecutionAttempt: {
        targetId: '42',
        model: 'program-model',
      },
    });

    const graphWithoutUsableProgram = {
      ...compiled.compiled,
      compiledRouterBundle: {
        ...compiled.compiled.compiledRouterBundle!,
        plans: [],
      },
    };
    expect(evaluateCompiledRuntimeArtifact({
      graph: graphWithoutUsableProgram,
      requestedModel: 'program-model',
    })).toBe(null);

    expect(evaluateCompiledRuntimeArtifact({
      graph: compiled.compiled,
      requestedModel: 'program-model',
    })).toMatchObject({
      matchedEntryNodeId: 'entry.program',
    });
  });
});
