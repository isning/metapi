import { describe, expect, it } from 'vitest';
import type { RouteRuntimeSnapshotBody } from '../../shared/routeRuntimeSnapshot.js';
import { mapRouteRuntimeSnapshotToResponse } from './routeRuntimeDecisionSnapshotService.js';

describe('routeRuntimeDecisionSnapshotService', () => {
  const snapshotBody: RouteRuntimeSnapshotBody = {
    compiledRuntime: {
      runtimeArtifactId: 'runtime-artifact-7',

      bundleHash: 'bundle-hash',
      program: {
        id: 'plan:public-model',
        entryNodeId: 'entry:public-model',
        publicModelName: 'public-model',
        enabled: true,
        filterStages: [],
        executionAlternatives: [],
      },
    },
    match: {
      requestedModel: 'public-model',
      actualModel: 'upstream-model',
      planId: 'plan:public-model',
      entryId: 'entry:public-model',
      publicModelName: 'public-model',
      terminalKind: 'endpoint',
    },
    metadata: {
      graph: { environment: 'test' },
      plan: { tier: 'primary' },
      selection: { strategy: 'weighted' },
      endpoint: { region: 'cn' },
      executionAttempt: { effectiveCost: 2.5 },
    },
    decision: null,
    endpoint: {
      endpointId: 'endpoint:canonical',
      executionTargetId: 41,
      compatibilityPolicy: null,
    },
    executionAttempt: {
      executionAttemptId: 'execution-attempt:41',
      model: 'upstream-model',
      executionTargetId: 41,
      accountId: 5,
      tokenId: 6,
      siteId: 7,
      credential: null,
      affinity: null,
    },
    requestUsage: {
      inputBytes: 128,
      maxOutputTokens: 256,
    },
    state: {
      failureOverlay: {
        disabledExecutionAttemptIds: [],
        disabledExecutionTargetIds: [],
      },
      executionAttemptState: null,
    },
    filters: {
      endpointPreference: 'responses',
      postBuild: { endpointPreference: 'responses' },
    },
    syntheticResponse: null,
  };

  it('maps only the stored canonical JSON snapshot shape to the API response', () => {
    const stored = JSON.stringify({
      capturedAt: '2026-07-11T02:30:00.000Z',
      request: {
        downstreamPath: '/v1/responses',
        stream: true,
      },
      ...snapshotBody,
    });

    expect(mapRouteRuntimeSnapshotToResponse(stored)).toEqual({
      capturedAt: '2026-07-11T02:30:00.000Z',
      request: {
        downstreamPath: '/v1/responses',
        stream: true,
      },
      ...snapshotBody,
      source: 'snapshot',
    });
  });

  it('does not synthesize missing canonical snapshot fields when reading logs', () => {
    expect(mapRouteRuntimeSnapshotToResponse(JSON.stringify({
      request: {
        downstreamPath: '/v1/responses',
        stream: true,
      },
      ...snapshotBody,
    }))).toBeNull();
    expect(mapRouteRuntimeSnapshotToResponse(JSON.stringify({
      capturedAt: '2026-07-11T02:30:00.000Z',
      ...snapshotBody,
    }))).toBeNull();
  });

  it('accepts and preserves selector, fallback, and affinity decision evidence', () => {
    const stored = JSON.stringify({
      capturedAt: '2026-07-11T02:30:00.000Z',
      request: { downstreamPath: '/v1/responses', stream: true },
      ...snapshotBody,
      decision: {
        selectedAlternativeId: 'choice:secondary',
        selectors: [{
          selectorId: 'selector:weighted',
          nodeId: 'selector-node',
          mode: 'weighted',
          policySource: 'inline',
          policyId: 'policy:weighted',
          policyKind: 'builtin',
          selectionMode: 'weighted',
          selectedChoiceId: 'choice:secondary',
          candidates: [{
            choiceId: 'choice:secondary',
            endpointId: 'endpoint:canonical',
            executionTargetIds: [41],
            targets: [{
              executionTargetId: 41,
              executionAttemptId: 'attempt:41',
              upstreamModel: 'upstream-model',
              credential: null,
            }],
            enabled: true,
            eligible: true,
            selected: true,
            weight: 25,
            contribution: 0.8,
            order: 1,
            score: 20,
          }],
        }],
        fallbackStages: [{
          fallbackId: 'fallback:main',
          stageId: 'stage:secondary',
          stageIndex: 1,
          nodeId: 'selector-node',
        }],
      },
      executionAttempt: {
        ...snapshotBody.executionAttempt,
        affinity: {
          mode: 'pool',
          selectedPoolId: 'pool:secondary',
          selectedExecutionTargetId: 41,
          primaryPoolId: 'pool:primary',
          primaryExecutionTargetId: null,
          primaryRevision: 4,
          fallback: true,
          promoteOnSuccess: true,
          bindingOutcome: 'promoted',
          resultingPrimaryPoolId: 'pool:secondary',
          resultingPrimaryExecutionTargetId: null,
          resultingRevision: 5,
        },
      },
    });

    expect(mapRouteRuntimeSnapshotToResponse(stored)).toMatchObject({
      decision: {
        selectedAlternativeId: 'choice:secondary',
        selectors: [{ candidates: [{
          selected: true,
          score: 20,
          targets: [{ executionTargetId: 41, executionAttemptId: 'attempt:41' }],
        }] }],
        fallbackStages: [{ stageId: 'stage:secondary', stageIndex: 1 }],
      },
      executionAttempt: {
        affinity: {
          bindingOutcome: 'promoted',
          resultingPrimaryPoolId: 'pool:secondary',
          resultingRevision: 5,
        },
      },
    });
  });

  it('keeps historical snapshots readable when decision and affinity evidence are absent', () => {
    const { decision: _decision, executionAttempt, ...historicalBody } = snapshotBody;
    const { affinity: _affinity, ...historicalAttempt } = executionAttempt!;
    const parsed = mapRouteRuntimeSnapshotToResponse(JSON.stringify({
      capturedAt: '2026-07-11T02:30:00.000Z',
      request: { downstreamPath: '/v1/responses', stream: true },
      ...historicalBody,
      executionAttempt: historicalAttempt,
    }));

    expect(parsed?.decision).toBeNull();
    expect(parsed?.executionAttempt?.affinity).toBeNull();
  });

  it('keeps selector snapshots readable before candidate target identities were recorded', () => {
    const parsed = mapRouteRuntimeSnapshotToResponse(JSON.stringify({
      capturedAt: '2026-07-11T02:30:00.000Z',
      request: { downstreamPath: '/v1/responses', stream: true },
      ...snapshotBody,
      decision: {
        selectedAlternativeId: 'choice:legacy',
        selectors: [{
          selectorId: 'selector:legacy',
          nodeId: 'selector-node',
          mode: 'weighted',
          policySource: 'builtin',
          policyId: null,
          policyKind: 'builtin',
          selectionMode: 'weighted',
          selectedChoiceId: 'choice:legacy',
          candidates: [{
            choiceId: 'choice:legacy',
            endpointId: 'endpoint:legacy',
            executionTargetIds: [41],
            enabled: true,
            eligible: true,
            selected: true,
            weight: 10,
            contribution: 1,
            order: 0,
            score: 10,
          }],
        }],
        fallbackStages: [],
      },
    }));

    expect(parsed?.decision?.selectors[0]?.candidates[0]).toMatchObject({
      choiceId: 'choice:legacy',
      executionTargetIds: [41],
    });
    expect(parsed?.decision?.selectors[0]?.candidates[0]).not.toHaveProperty('targets');
  });

  it('accepts request-level unavailable evidence without an execution attempt', () => {
    const parsed = mapRouteRuntimeSnapshotToResponse(JSON.stringify({
      capturedAt: '2026-07-11T02:30:00.000Z',
      request: { downstreamPath: '/v1/responses', stream: true },
      ...snapshotBody,
      decision: {
        selectedAlternativeId: 'choice:unavailable',
        selectors: [],
        fallbackStages: [],
        unavailable: {
          reason: 'execution_attempts_exhausted',
          rejectedAttempts: [{
            executionAttemptId: 'attempt:41',
            executionTargetId: 41,
            reason: 'cooldown',
          }],
        },
      },
      endpoint: null,
      executionAttempt: null,
    }));

    expect(parsed).toMatchObject({
      endpoint: null,
      executionAttempt: null,
      decision: {
        unavailable: {
          rejectedAttempts: [{ executionTargetId: 41, reason: 'cooldown' }],
        },
      },
    });
  });

  it('rejects malformed supplied decision and affinity evidence', () => {
    const base = {
      capturedAt: '2026-07-11T02:30:00.000Z',
      request: { downstreamPath: '/v1/responses', stream: true },
      ...snapshotBody,
    };
    expect(mapRouteRuntimeSnapshotToResponse(JSON.stringify({
      ...base,
      decision: { selectedAlternativeId: null, selectors: 'invalid', fallbackStages: [] },
    }))).toBeNull();
    expect(mapRouteRuntimeSnapshotToResponse(JSON.stringify({
      ...base,
      executionAttempt: {
        ...snapshotBody.executionAttempt,
        affinity: { mode: 'pool', bindingOutcome: 'promoted' },
      },
    }))).toBeNull();
    expect(mapRouteRuntimeSnapshotToResponse(JSON.stringify({
      ...base,
      decision: {
        selectedAlternativeId: null,
        selectors: [],
        fallbackStages: [],
        unavailable: {
          reason: 'execution_attempts_exhausted',
          rejectedAttempts: [{ executionAttemptId: null, executionTargetId: 41, reason: 'network_error' }],
        },
      },
    }))).toBeNull();
  });

  it('does not coerce invalid synthetic response status or message', () => {
    expect(mapRouteRuntimeSnapshotToResponse(JSON.stringify({
      capturedAt: '2026-07-11T02:30:00.000Z',
      request: {
        downstreamPath: null,
        stream: null,
      },
      ...snapshotBody,
      syntheticResponse: {
        statusCode: 500,
        message: 'upstream unavailable',
      },
    }))).toBeNull();
    expect(mapRouteRuntimeSnapshotToResponse(JSON.stringify({
      capturedAt: '2026-07-11T02:30:00.000Z',
      request: {
        downstreamPath: null,
        stream: null,
      },
      ...snapshotBody,
      syntheticResponse: {
        statusCode: 503,
        message: '',
      },
    }))).toBeNull();
  });

  it('treats non-serialized objects as outside the proxy-log storage boundary', () => {
    expect(mapRouteRuntimeSnapshotToResponse({
      capturedAt: '2026-07-11T02:30:00.000Z',
      request: {
        downstreamPath: '/v1/responses',
        stream: true,
      },
      ...snapshotBody,
    })).toBeNull();
  });

});
