import Fastify, { type FastifyInstance } from 'fastify';
import { executionDecisionFromTargetMocks } from '../../../testing/routeRuntimeDecisionMock.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
const selectTargetMock = vi.fn();
const selectNextTargetMock = vi.fn();
const recordSuccessMock = vi.fn();
const recordFailureMock = vi.fn();
const refreshModelsAndRebuildRoutesMock = vi.fn();
const reportProxyAllFailedMock = vi.fn();
const reportTokenExpiredMock = vi.fn();
const estimateProxyCostMock = vi.fn(async () => 0);
const dbInsertMock = vi.fn((_arg?: any) => ({
  values: () => ({
    run: () => undefined,
  }),
}));

let hasPreviewedDecision = false;
let previewedDecision: unknown = null;

async function selectDecisionForTest(input: any) {
  if (hasPreviewedDecision) {
    hasPreviewedDecision = false;
    const decision = previewedDecision;
    previewedDecision = null;
    return decision;
  }
  return await executionDecisionFromTargetMocks(input, selectTargetMock, selectNextTargetMock);
}

async function previewDecisionForTest(input: any) {
  if (!hasPreviewedDecision) {
    previewedDecision = await selectDecisionForTest(input);
    hasPreviewedDecision = true;
  }
  return previewedDecision;
}

vi.mock('undici', async () => {
  const actual = await vi.importActual<typeof import('undici')>('undici');
  return {
    ...actual,
    fetch: (...args: unknown[]) => fetchMock(...args),
  };
});


vi.mock('../../services/routeRuntimeExecutionService.js', () => ({
  createRouteRuntimeDecisionSession: async (input: any) => input,
  selectRouteRuntimeDecisionInSession: (session: any, input: any) => selectDecisionForTest({ ...session, ...input }),
  previewRouteRuntimeDecisionInSession: (session: any, input: any) => previewDecisionForTest({ ...session, ...input }),
  selectRouteRuntimeDecision: selectDecisionForTest,
  previewRouteRuntimeDecision: previewDecisionForTest,
  selectRouteRuntimeExecutionAttempt: async (input: any) => {
    const excluded = Array.isArray(input?.disabledExecutionTargetIds) ? input.disabledExecutionTargetIds : [];
    const selected = excluded.length > 0
      ? await selectNextTargetMock(input.requestedModel, excluded, input.downstreamPolicy)
      : await selectTargetMock(input?.requestedModel, input?.downstreamPolicy);
    if (!selected) return selected;
    if (!selected.executionAttemptId || !selected.executionTargetId) {
      throw new Error('Test selected route runtime attempt must include executionAttemptId and executionTargetId');
    }
    return selected;
  },
  resolveRouteRuntimeSyntheticResponse: async () => null,
  recordRouteRuntimeExecutionAttemptStarted: async () => undefined,
  recordRouteRuntimeExecutionAttemptSuccess: (input: any) =>
    recordSuccessMock(input.executionTargetId, input.latencyMs, input.modelName),
  recordRouteRuntimeExecutionAttemptFailure: (input: any) =>
    recordFailureMock(input.executionTargetId, { status: input.status, errorText: input.errorText }),
  recordRouteRuntimeExecutionAttemptSelected: async () => undefined,
}));

vi.mock('../../services/compiledRuntimeExecutionSessionService.js', () => ({
  startCompiledRuntimeExecutionSession: async () => ({ requestId: 'request:images-test', startedAtMs: Date.now() }),
  resumeCompiledRuntimeExecutionSession: async () => null,
  bindCompiledRuntimeExecutionDecision: async () => undefined,
  completeCompiledRuntimeExecutionSession: async () => true,
}));

vi.mock('../../services/modelService.js', () => ({
  refreshModelsAndRebuildRoutes: (...args: unknown[]) => refreshModelsAndRebuildRoutesMock(...args),
}));

vi.mock('../../services/alertService.js', () => ({
  reportProxyAllFailed: (...args: unknown[]) => reportProxyAllFailedMock(...args),
  reportTokenExpired: (...args: unknown[]) => reportTokenExpiredMock(...args),
}));

vi.mock('../../services/alertRules.js', () => ({
  isTokenExpiredError: () => false,
}));

vi.mock('../../services/modelPricingService.js', () => ({
  estimateProxyCost: (arg: any) => estimateProxyCostMock(arg),
  buildProxyBillingDetails: async () => null,
}));

vi.mock('../../services/oauth/quota.js', () => ({
  recordOauthQuotaHeadersSnapshot: async () => null,
}));

vi.mock('../../services/proxyRetryPolicy.js', () => ({
  shouldRetryProxyRequest: (status?: number, errText?: string) => {
    if (status === 502 || errText?.includes('malformed')) return true;
    return false;
  },
  shouldAbortSameSiteEndpointFallback: () => false,
  RETRYABLE_TIMEOUT_PATTERNS: [/(request timed out|connection timed out|read timeout|\btimed out\b)/i],
}));

vi.mock('../../services/routeRuntimeEvaluatorService.js', async () => {
  const actual = await vi.importActual<typeof import('../../services/routeRuntimeEvaluatorService.js')>('../../services/routeRuntimeEvaluatorService.js');
  return {
    ...actual,
  };
});

vi.mock('../../services/credentialEndpointBindingService.js', () => ({
  loadCredentialApiVariantConfig: async () => null,
}));

vi.mock('../../db/index.js', () => ({
  db: {
    insert: (arg: any) => dbInsertMock(arg),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            all: async () => [],
          }),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          run: async () => undefined,
        }),
      }),
    }),
  },
  hasProxyLogBillingDetailsColumn: async () => false,
  hasProxyLogClientColumns: async () => false,
  hasProxyLogDownstreamApiKeyIdColumn: async () => false,
  hasProxyLogStreamTimingColumns: async () => false,
  schema: {
    proxyLogs: {},
    siteApiEndpoints: {
      id: {},
      siteId: {},
      sortOrder: {},
    },
  },
}));

function buildMultipartBody(boundary: string) {
  return Buffer.from(
    `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="model"\r\n\r\n`
      + `gpt-image-1\r\n`
      + `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="prompt"\r\n\r\n`
      + `edit this\r\n`
      + `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="image"; filename="cat.png"\r\n`
      + `Content-Type: image/png\r\n\r\n`
      + `pngdata\r\n`
      + `--${boundary}--\r\n`,
  );
}

describe('/v1/images/edits route', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { registerDownstreamProtocolSurface } = await import('../surfaces/downstreamProtocolSurface.js');
    const { openaiImagesProtocolAdapter } = await import('./images.js');
    const { imagesProxyRoute } = await import('../../routes/proxy/images.js');
    app = Fastify();
    await registerDownstreamProtocolSurface(app, openaiImagesProtocolAdapter);
    await app.register(imagesProxyRoute);
  });

  beforeEach(() => {
    hasPreviewedDecision = false;
    previewedDecision = null;
    fetchMock.mockReset();
    selectTargetMock.mockReset();
    selectNextTargetMock.mockReset();
    recordSuccessMock.mockReset();
    recordFailureMock.mockReset();
    refreshModelsAndRebuildRoutesMock.mockReset();
    reportProxyAllFailedMock.mockReset();
    reportTokenExpiredMock.mockReset();
    estimateProxyCostMock.mockClear();
    dbInsertMock.mockClear();
    selectTargetMock.mockReturnValue({
      target: { id: 11, routeId: 22 },
      executionTargetId: 11,
      executionAttemptId: 'ea_11',
      site: { id: 44, name: 'demo-site', url: 'https://upstream.example.com', platform: 'openai' },
      account: { id: 33, username: 'demo-user' },
      tokenName: 'default',
      tokenValue: 'sk-demo',
      actualModel: 'upstream-gpt-image',
      routeEntrypointId: 'entry:images',
      runtimeEndpointId: 'endpoint:images',
      runtimeArtifactId: 'runtime-artifact-1',
      routeRuntimeSnapshot: { compiledRuntime: { bundleHash: 'images-test-bundle' } },
    });
    selectNextTargetMock.mockReturnValue(null);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('accepts multipart image edit requests and forwards them to /v1/images/edits', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      created: 1,
      data: [{ b64_json: 'iVBORw0KGgo=' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const boundary = 'metapi-boundary';
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/edits',
      headers: {
        authorization: 'Bearer sk-demo',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: buildMultipartBody(boundary),
    });

    expect(response.statusCode).toBe(200);
    const [targetUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(targetUrl).toBe('https://upstream.example.com/v1/images/edits');
  });

  it('retries the next channel when image generation JSON is malformed', async () => {
    selectNextTargetMock.mockReturnValueOnce({
      target: { id: 12, routeId: 23 },
      executionTargetId: 12,
      executionAttemptId: 'ea_12',
      site: { id: 45, name: 'fallback-site', url: 'https://fallback.example.com', platform: 'openai' },
      account: { id: 34, username: 'fallback-user' },
      tokenName: 'fallback',
      tokenValue: 'sk-fallback',
      actualModel: 'fallback-gpt-image',
      routeEntrypointId: 'entry:images',
      runtimeEndpointId: 'endpoint:images-fallback',
      runtimeArtifactId: 'runtime-artifact-1',
      routeRuntimeSnapshot: { compiledRuntime: { bundleHash: 'images-test-bundle' } },
    });
    fetchMock
      .mockResolvedValueOnce(new Response('not-json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        created: 2,
        data: [{ b64_json: 'ZmFsbGJhY2s=' }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/generations',
      headers: {
        authorization: 'Bearer sk-demo',
      },
      payload: {
        model: 'gpt-image-1',
        prompt: 'draw a cat',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      created: 2,
      data: [{ b64_json: 'ZmFsbGJhY2s=' }],
    });
    expect(selectNextTargetMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps returning a successful image edit response when post-success accounting fails', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      created: 1,
      data: [{ b64_json: 'iVBORw0KGgo=' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    estimateProxyCostMock.mockRejectedValueOnce(new Error('cost failed'));

    const boundary = 'metapi-boundary-accounting';
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/edits',
      headers: {
        authorization: 'Bearer sk-demo',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: buildMultipartBody(boundary),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      created: 1,
      data: [{ b64_json: 'iVBORw0KGgo=' }],
    });
    expect(selectNextTargetMock).not.toHaveBeenCalled();
    expect(recordFailureMock).not.toHaveBeenCalled();
  });

  it('returns explicit not-supported error for /v1/images/variations', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/images/variations',
      payload: {
        model: 'gpt-image-1',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        message: 'Image variations are not supported',
        type: 'invalid_request_error',
      },
    });
  });
});
