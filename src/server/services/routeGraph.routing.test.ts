import { describe, expect, it } from 'vitest';
import { compileRouteGraphSource } from '../../shared/routeGraph.js';
import { config } from '../config.js';
import { evaluateCompiledRuntimeArtifact } from './routeRuntimeEvaluatorService.js';

function compileExecutableGraph(source: unknown) {
  const result = compileRouteGraphSource(source);
  expect(result.ok, result.diagnostics.map((item) => `${item.code}: ${item.message}`).join('\n')).toBe(true);
  return result.compiled;
}

function executionEndpoint(input: {
  id: string;
  targetId: string;
  model: string;
  executionTargetId: number;
  modelSource?: 'fixed' | 'request';
  weight?: number;
}) {
  return {
    id: input.id,
    type: 'route_endpoint' as const,
    routeEndpointId: input.id,
    enabled: true,
    ownership: 'manual' as const,
    config: {
      targets: [{
        targetId: input.targetId,
        model: input.model,
        modelSource: input.modelSource || 'fixed',
        weight: input.weight,
        transportBinding: {
          kind: 'execution_target' as const,
          executionTargetId: input.executionTargetId,
        },
      }],
      targetSelection: { kind: 'builtin' as const, builtin: 'stable_first' as const },
    },
  };
}

function directEdge(entryId: string, endpointId: string) {
  return {
    id: `edge:${entryId}:${endpointId}`,
    sourceNodeId: entryId,
    sourcePortId: 'bidirect.out',
    targetNodeId: endpointId,
    targetPortId: 'bidirect.in',
    kind: 'bidirect_flow' as const,
    ownership: 'manual' as const,
  };
}

describe('Route Graph actual runtime routing', () => {
  it('routes exact, normalized exact, glob, and regex entry matches to their compiled targets', () => {
    const entries = [
      { id: 'entry.exact', pattern: 'CaseModel', endpointId: 'endpoint.exact', targetId: 'exact', executionTargetId: 101 },
      { id: 'entry.glob', pattern: 'glob-*', endpointId: 'endpoint.glob', targetId: 'glob', executionTargetId: 102 },
      { id: 'entry.regex', pattern: 're:^regex-[0-9]+$', endpointId: 'endpoint.regex', targetId: 'regex', executionTargetId: 103 },
    ];
    const graph = compileExecutableGraph({
      nodes: entries.flatMap((entry) => [
        {
          id: entry.id,
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: entry.pattern },
        },
        executionEndpoint({
          id: entry.endpointId,
          targetId: entry.targetId,
          model: `${entry.targetId}-upstream`,
          executionTargetId: entry.executionTargetId,
        }),
      ]),
      edges: entries.map((entry) => directEdge(entry.id, entry.endpointId)),
    });

    expect(evaluateCompiledRuntimeArtifact({ graph, requestedModel: 'CaseModel' })?.selectedExecutionAttempt?.targetId).toBe('exact');
    expect(evaluateCompiledRuntimeArtifact({ graph, requestedModel: 'casemodel' })?.selectedExecutionAttempt?.targetId).toBe('exact');
    expect(evaluateCompiledRuntimeArtifact({ graph, requestedModel: 'glob-coder' })?.selectedExecutionAttempt?.targetId).toBe('glob');
    expect(evaluateCompiledRuntimeArtifact({ graph, requestedModel: 'regex-42' })?.selectedExecutionAttempt?.targetId).toBe('regex');
    expect(evaluateCompiledRuntimeArtifact({ graph, requestedModel: 'unmatched-model' })).toBeNull();
  });

  it('uses the complete request context when a CEL dispatcher selects a route candidate', () => {
    const graph = compileExecutableGraph({
      nodes: [
        { id: 'entry.context', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'context-model' } },
        {
          id: 'dispatcher.context',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: {
            kind: 'inline',
            policy: {
              id: 'request-context-selector',
              name: 'Request context selector',
              kind: 'cel',
              selectionMode: 'direct',
              selectExpression: 'request.method == "POST" && request.path == "/v1/responses" && request.query.region == "us" && request.clientContext.plan == "team" && request.headers["x-route-choice"] == "b" && request.payload.tier == "pro" ? 1 : 0',
            },
          },
        },
        executionEndpoint({ id: 'endpoint.context-a', targetId: 'context-a', model: 'context-a', executionTargetId: 201 }),
        executionEndpoint({ id: 'endpoint.context-b', targetId: 'context-b', model: 'context-b', executionTargetId: 202 }),
      ],
      edges: [
        { id: 'entry-dispatcher', sourceNodeId: 'entry.context', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.context', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'candidate-a', sourceNodeId: 'endpoint.context-a', sourcePortId: 'route.out', targetNodeId: 'dispatcher.context', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'candidate-b', sourceNodeId: 'endpoint.context-b', sourcePortId: 'route.out', targetNodeId: 'dispatcher.context', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });
    const request = {
      requestedModel: 'context-model',
      payload: { tier: 'pro' },
      headers: { 'x-route-choice': 'b' },
      method: 'POST',
      path: '/v1/responses',
      query: { region: 'us' },
      clientContext: { plan: 'team' },
    };

    expect(evaluateCompiledRuntimeArtifact({ graph, requestedModel: 'ignored-when-request-is-explicit', request })?.selectedExecutionAttempt?.targetId).toBe('context-b');
    expect(evaluateCompiledRuntimeArtifact({
      graph,
      requestedModel: 'context-model',
      request: { ...request, headers: { 'x-route-choice': 'a' } },
    })?.selectedExecutionAttempt?.targetId).toBe('context-a');
    expect(() => evaluateCompiledRuntimeArtifact({
      graph,
      requestedModel: 'context-model',
      request: { ...request, requestedModel: '  ' },
    })).toThrow('missing requestedModel');
  });

  it('resolves a registry CEL policy during compiled runtime evaluation', () => {
    const previousRegistry = config.dispatchPolicyRegistry;
    config.dispatchPolicyRegistry = {
      defaultPolicyId: 'request-tier',
      policies: [{
        id: 'request-tier',
        name: 'Request tier',
        kind: 'cel',
        selectionMode: 'direct',
        selectExpression: 'request.payload.tier == "pro" ? 1 : 0',
      }],
    };

    try {
      const graph = compileExecutableGraph({
        nodes: [
          { id: 'entry.registry', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'registry-model' } },
          { id: 'dispatcher.registry', type: 'dispatcher', enabled: true, ownership: 'manual', mode: 'route', policy: { kind: 'registry', policyId: 'request-tier' } },
          executionEndpoint({ id: 'endpoint.registry-a', targetId: 'registry-a', model: 'registry-a', executionTargetId: 601 }),
          executionEndpoint({ id: 'endpoint.registry-b', targetId: 'registry-b', model: 'registry-b', executionTargetId: 602 }),
        ],
        edges: [
          { id: 'entry-dispatcher', sourceNodeId: 'entry.registry', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.registry', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
          { id: 'candidate-a', sourceNodeId: 'endpoint.registry-a', sourcePortId: 'route.out', targetNodeId: 'dispatcher.registry', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
          { id: 'candidate-b', sourceNodeId: 'endpoint.registry-b', sourcePortId: 'route.out', targetNodeId: 'dispatcher.registry', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        ],
      });

      expect(evaluateCompiledRuntimeArtifact({
        graph,
        requestedModel: 'registry-model',
        request: { requestedModel: 'registry-model', payload: { tier: 'pro' } },
      })?.selectedExecutionAttempt?.targetId).toBe('registry-b');
      expect(evaluateCompiledRuntimeArtifact({
        graph,
        requestedModel: 'registry-model',
        request: { requestedModel: 'registry-model', payload: { tier: 'free' } },
      })?.selectedExecutionAttempt?.targetId).toBe('registry-a');
    } finally {
      config.dispatchPolicyRegistry = previousRegistry;
    }
  });

  it('applies current and upstream model rewrites in graph order before selecting the endpoint', () => {
    const graph = compileExecutableGraph({
      nodes: [
        { id: 'entry.rewrite', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'rewrite-input' } },
        {
          id: 'filter.rewrite',
          type: 'filter',
          enabled: true,
          ownership: 'manual',
          operations: [
            { type: 'rewrite_model', source: 'current_model', operation: 'set', value: 'rewritten-current' },
            { type: 'rewrite_model', source: 'upstream_model', operation: 'set', value: 'rewritten-upstream-max' },
            { type: 'rewrite_model', source: 'upstream_model', operation: 'strip_suffix', suffix: '-max' },
          ],
        },
        executionEndpoint({ id: 'endpoint.rewrite', targetId: 'rewrite-target', model: 'fixed-fallback', executionTargetId: 301 }),
      ],
      edges: [
        { id: 'entry-filter', sourceNodeId: 'entry.rewrite', sourcePortId: 'bidirect.out', targetNodeId: 'filter.rewrite', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'filter-endpoint', sourceNodeId: 'filter.rewrite', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint.rewrite', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });

    const selection = evaluateCompiledRuntimeArtifact({ graph, requestedModel: 'rewrite-input' });

    expect(selection).toMatchObject({
      currentModel: 'rewritten-current',
      upstreamModel: 'rewritten-upstream',
      selectedExecutionAttempt: { targetId: 'rewrite-target', model: 'fixed-fallback' },
    });
    expect(selection?.trace.path.find((step) => step.nodeId === 'filter.rewrite')?.appliedFilters).toEqual([
      'rewrite_model:currentModel=set',
      'rewrite_model:upstreamModel=set',
      'rewrite_model:upstreamModel=strip_suffix',
    ]);
  });

  it('resolves request-model execution attempts from the model produced by the graph', () => {
    const graph = compileExecutableGraph({
      nodes: [
        { id: 'entry.request-model', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'request-model' } },
        {
          id: 'filter.request-model',
          type: 'filter',
          enabled: true,
          ownership: 'manual',
          operations: [{ type: 'rewrite_model', source: 'current_model', operation: 'set', value: 'request-model-rewritten' }],
        },
        executionEndpoint({
          id: 'endpoint.request-model',
          targetId: 'request-model-target',
          model: '',
          modelSource: 'request',
          executionTargetId: 401,
        }),
      ],
      edges: [
        { id: 'entry-filter', sourceNodeId: 'entry.request-model', sourcePortId: 'bidirect.out', targetNodeId: 'filter.request-model', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'filter-endpoint', sourceNodeId: 'filter.request-model', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint.request-model', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });

    expect(evaluateCompiledRuntimeArtifact({ graph, requestedModel: 'request-model' })).toMatchObject({
      currentModel: 'request-model-rewritten',
      upstreamModel: 'request-model-rewritten',
      selectedExecutionAttempt: {
        targetId: 'request-model-target',
        model: '',
        modelSource: 'request',
      },
    });
  });

  it('applies attempt-level failure overlays and forced-attempt constraints to actual alternatives', () => {
    const graph = compileExecutableGraph({
      nodes: [
        { id: 'entry.constraints', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'constraint-model' } },
        { id: 'dispatcher.constraints', type: 'dispatcher', enabled: true, ownership: 'manual', mode: 'route', policy: { kind: 'builtin', builtin: 'stable_first' } },
        executionEndpoint({ id: 'endpoint.constraints-a', targetId: 'constraints-a', model: 'constraints-a', executionTargetId: 501 }),
        executionEndpoint({ id: 'endpoint.constraints-b', targetId: 'constraints-b', model: 'constraints-b', executionTargetId: 502 }),
      ],
      edges: [
        { id: 'entry-dispatcher', sourceNodeId: 'entry.constraints', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.constraints', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'candidate-a', sourceNodeId: 'endpoint.constraints-a', sourcePortId: 'route.out', targetNodeId: 'dispatcher.constraints', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'candidate-b', sourceNodeId: 'endpoint.constraints-b', sourcePortId: 'route.out', targetNodeId: 'dispatcher.constraints', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });
    const alternatives = graph.compiledRouterBundle!.plans[0]!.executionAlternatives;
    const firstAttemptId = alternatives.find((item) => item.executionAttempt?.targetId === 'constraints-a')!.executionAttempt!.executionAttemptId;
    const secondAttemptId = alternatives.find((item) => item.executionAttempt?.targetId === 'constraints-b')!.executionAttempt!.executionAttemptId;

    expect(evaluateCompiledRuntimeArtifact({
      graph,
      requestedModel: 'constraint-model',
      failureOverlay: { disabledExecutionAttemptIds: [firstAttemptId] },
    })?.selectedExecutionAttempt?.targetId).toBe('constraints-b');
    expect(evaluateCompiledRuntimeArtifact({
      graph,
      requestedModel: 'constraint-model',
      selectionConstraint: { forcedExecutionAttemptId: secondAttemptId },
    })?.selectedExecutionAttempt?.targetId).toBe('constraints-b');
    expect(evaluateCompiledRuntimeArtifact({
      graph,
      requestedModel: 'constraint-model',
      selectionConstraint: { forcedExecutionAttemptId: 'missing-attempt' },
    })).toBeNull();
  });
});
