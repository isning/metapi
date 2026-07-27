import { describe, expect, it } from 'vitest';
import type { CompiledRouterBundle } from '../../shared/compiledRuntime.js';
import type { RouteRuntimeSelection } from './routeRuntimeEvaluatorService.js';
import { buildCompiledRuntimeProjection } from './compiledRuntimeProjectionService.js';

function bundle(): CompiledRouterBundle {
  const policy = {
    kind: 'inline',
    policy: {
      id: 'rank-by-request-tier',
      name: 'Rank by request tier',
      kind: 'cel',
      selectionMode: 'ordered',
      orderExpression: '-(request.payload.tier == "pro" ? self.metadata.score : self.weight)',
    },
  };
  return {
    hash: 'hash',
    matcher: {
      exact: {},
      normalizedExact: {},
      patterns: [],
    },
    diagnostics: [],
    planIndex: {
      'plan:cel': 0,
    },
    plans: [{
      id: 'plan:cel',
      entryNodeId: 'entry:cel',
      publicModelName: 'public-cel',
      enabled: true,
      filterStages: [],
      executionAlternatives: [{
        alternativeId: 'alt:a',
        kind: 'execution_attempt',
        enabled: true,
        filterStageIndexes: [],
        selectionTerms: [{
          termId: 'dispatcher:cel',
          nodeId: 'dispatcher:cel',
          mode: 'route',
          policy,
          optionId: 'a',
          optionIndex: 0,
          optionKind: 'route',
          enabled: true,
          weight: 10,
          order: 0,
          metadata: { score: 1 },
          sourceRef: {},
        }],
        terminal: {
          kind: 'supply',
          endpointId: 'endpoint:a',
          nodeId: 'endpoint:a',
          targetSelectionPolicy: { kind: 'builtin', builtin: 'weighted' },
          sourceRef: {},
        },
        endpoint: {
          endpointId: 'endpoint:a',
          nodeId: 'endpoint:a',
          model: 'model-a',
          sourceRef: {},
        },
        executionAttempt: {
          endpointId: 'endpoint:a',
          executionAttemptId: 'ea_1',
          targetId: '1',
          nodeId: 'endpoint:a',
          model: 'model-a',
          modelSource: 'fixed',
          enabled: true,
          siteId: 1,
          accountId: 1,
          tokenId: 1,
          weight: 10,
          metadata: { executionTargetId: 1 },
          transportBinding: { kind: 'execution_target', executionTargetId: 1 },
          sourceRef: {},
        },
        syntheticResponse: null,
        lineage: {
          terminalRef: 'endpoint:a',
          selectionPath: [{ termId: 'dispatcher:cel', optionId: 'a' }],
        },
      }, {
        alternativeId: 'alt:b',
        kind: 'execution_attempt',
        enabled: true,
        filterStageIndexes: [],
        selectionTerms: [{
          termId: 'dispatcher:cel',
          nodeId: 'dispatcher:cel',
          mode: 'route',
          policy,
          optionId: 'b',
          optionIndex: 1,
          optionKind: 'route',
          enabled: true,
          weight: 1,
          order: 1,
          metadata: { score: 9 },
          sourceRef: {},
        }],
        terminal: {
          kind: 'supply',
          endpointId: 'endpoint:b',
          nodeId: 'endpoint:b',
          targetSelectionPolicy: { kind: 'builtin', builtin: 'weighted' },
          sourceRef: {},
        },
        endpoint: {
          endpointId: 'endpoint:b',
          nodeId: 'endpoint:b',
          model: 'model-b',
          sourceRef: {},
        },
        executionAttempt: {
          endpointId: 'endpoint:b',
          executionAttemptId: 'ea_2',
          targetId: '2',
          nodeId: 'endpoint:b',
          model: 'model-b',
          modelSource: 'fixed',
          enabled: true,
          siteId: 2,
          accountId: 2,
          tokenId: 2,
          weight: 1,
          metadata: { executionTargetId: 2 },
          transportBinding: { kind: 'execution_target', executionTargetId: 2 },
          sourceRef: {},
        },
        syntheticResponse: null,
        lineage: {
          terminalRef: 'endpoint:b',
          selectionPath: [{ termId: 'dispatcher:cel', optionId: 'b' }],
        },
      }],
      sourceRef: {},
    }],
  };
}

function selection(): RouteRuntimeSelection {
  return {
    matchedEntryNodeId: 'entry:cel',
    selectedEntryNodeId: 'entry:cel',
    selectedExecutionAttempt: {
      endpointId: 'endpoint:b',
      executionAttemptId: 'ea_2',
      targetId: '2',
      nodeId: 'endpoint:b',
      model: 'model-b',
      accountId: 2,
      tokenId: 2,
      siteId: 2,
      transportBinding: { kind: 'execution_target', executionTargetId: 2 },
      sourceRef: {},
    },
    terminalNodeId: 'endpoint:b',
    terminalKind: 'endpoint',
    requestedModel: 'public-cel',
    currentModel: 'public-cel',
    postBuildFilters: { payload: [], headers: [] },
    trace: {
      path: [],
      edges: [],
      terminalNodeId: 'endpoint:b',
    },
    compiledPlanSnapshot: {
      planId: 'plan:cel',
      entryNodeId: 'entry:cel',
      rootEndpointId: null,
      publicModelName: 'public-cel',
      selectedAlternativeId: 'alt:b',
    },
    selectedAlternativeId: 'alt:b',
  };
}

describe('buildCompiledRuntimeProjection', () => {
  it('uses the concrete request snapshot to estimate request-dependent CEL probabilities', () => {
    const runtime = buildCompiledRuntimeProjection({
      bundle: bundle(),
      selection: selection(),
      requestedModel: 'public-cel',
      request: {
        requestedModel: 'public-cel',
        payload: { tier: 'pro' },
        headers: {},
      },
    });

    expect(runtime?.alternatives.map((alternative) => ({
      id: alternative.alternativeId,
      probability: alternative.probability,
      status: alternative.probabilityStatus,
    }))).toEqual([
      { id: 'alt:a', probability: 0, status: 'static' },
      { id: 'alt:b', probability: 1, status: 'static' },
    ]);
  });

  it('keeps request-dependent CEL probabilities dynamic when no request snapshot is available', () => {
    const runtime = buildCompiledRuntimeProjection({
      bundle: bundle(),
      selection: selection(),
      requestedModel: 'public-cel',
    });

    expect(runtime?.alternatives.map((alternative) => ({
      id: alternative.alternativeId,
      probability: alternative.probability,
      status: alternative.probabilityStatus,
    }))).toEqual([
      { id: 'alt:a', probability: null, status: 'dynamic' },
      { id: 'alt:b', probability: null, status: 'dynamic' },
    ]);
  });

  it('does not derive execution attempt identity from compiled target id when execution target metadata is missing', () => {
    const source = bundle();
    delete source.plans[0]!.executionAlternatives[0]!.executionAttempt!.metadata!.executionTargetId;

    const runtime = buildCompiledRuntimeProjection({
      bundle: source,
      selection: selection(),
      requestedModel: 'public-cel',
    });

    expect(runtime?.alternatives.map((alternative) => ({
      id: alternative.alternativeId,
      executionAttemptIds: alternative.executionAttemptIds,
    }))).toEqual([
      { id: 'alt:a', executionAttemptIds: ['ea_1'] },
      { id: 'alt:b', executionAttemptIds: ['ea_2'] },
    ]);
    expect(runtime?.executionAttempts.map((attempt) => attempt.executionAttemptId)).toEqual(['ea_1', 'ea_2']);
    expect(runtime?.selected).toMatchObject({
      endpointId: 'endpoint:b',
      executionAttemptId: 'ea_2',
      accountId: 2,
      tokenId: 2,
      siteId: 2,
      actualModel: 'model-b',
    });
  });

  it('does not derive fixed execution attempt model from the requested model', () => {
    const source = bundle();
    source.plans[0]!.executionAlternatives[1]!.executionAttempt!.model = '';

    const runtime = buildCompiledRuntimeProjection({
      bundle: source,
      selection: selection(),
      requestedModel: 'public-cel',
    });

    expect(runtime?.alternatives.find((alternative) => alternative.alternativeId === 'alt:b')).toMatchObject({
      model: null,
    });
    expect(runtime?.executionAttempts.find((attempt) => attempt.executionAttemptId === 'ea_2')).toMatchObject({
      model: null,
      modelSource: 'fixed',
    });
    expect(runtime?.selected.actualModel).toBeNull();
  });
});
