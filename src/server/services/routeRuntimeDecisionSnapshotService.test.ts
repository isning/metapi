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
