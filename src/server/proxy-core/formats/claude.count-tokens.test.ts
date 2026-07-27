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
const resolveProxyUsageWithSelfLogFallbackMock = vi.fn(async ({ usage }: any) => ({
  ...usage,
  estimatedCostFromQuota: 0,
  recoveredFromSelfLog: false,
}));
const startSurfaceProxyDebugTraceMock = vi.fn();
const safeUpdateSurfaceProxyDebugSelectionMock = vi.fn();
const safeUpdateSurfaceProxyDebugRuntimeMock = vi.fn();
const safeInsertSurfaceProxyDebugAttemptMock = vi.fn();
const safeFinalizeSurfaceProxyDebugTraceMock = vi.fn();
const dbInsertMock = vi.fn((_arg?: any) => ({
  values: () => ({
    run: () => undefined,
  }),
}));

vi.mock('undici', async () => {
  const actual = await vi.importActual<typeof import('undici')>('undici');
  return {
    ...actual,
    fetch: (...args: unknown[]) => fetchMock(...args),
  };
});


vi.mock('../../services/routeRuntimeExecutionService.js', () => ({
  createRouteRuntimeDecisionSession: async (input: any) => input,
  selectRouteRuntimeDecisionInSession: (session: any, input: any) => executionDecisionFromTargetMocks(
    { ...session, ...input }, selectTargetMock, selectNextTargetMock,
  ),
  previewRouteRuntimeDecisionInSession: (session: any, input: any) => executionDecisionFromTargetMocks(
    { ...session, ...input }, selectNextTargetMock,
  ),
  selectRouteRuntimeDecision: (input: any) => executionDecisionFromTargetMocks(input, selectTargetMock, selectNextTargetMock),
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
  startCompiledRuntimeExecutionSession: async () => ({ requestId: 'request:claude-count-test', startedAtMs: Date.now() }),
  resumeCompiledRuntimeExecutionSession: async () => null,
  bindCompiledRuntimeExecutionDecision: async () => undefined,
  completeCompiledRuntimeExecutionSession: async () => undefined,
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
  estimateProxyCost: async () => 0,
  buildProxyBillingDetails: async () => null,
  fetchModelPricingCatalog: async () => null,
}));

vi.mock('../../services/proxyRetryPolicy.js', () => ({
  shouldRetryProxyRequest: () => false,
  shouldAbortSameSiteEndpointFallback: () => false,
  RETRYABLE_TIMEOUT_PATTERNS: [/(request timed out|connection timed out|read timeout|\btimed out\b)/i],
}));

vi.mock('../../services/proxyUsageFallbackService.js', () => ({
  resolveProxyUsageWithSelfLogFallback: (arg: any) => resolveProxyUsageWithSelfLogFallbackMock(arg),
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

vi.mock('../../services/proxyDebugTraceRuntime.js', () => ({
  startSurfaceProxyDebugTrace: (...args: unknown[]) => startSurfaceProxyDebugTraceMock(...args),
  safeUpdateSurfaceProxyDebugSelection: (...args: unknown[]) => safeUpdateSurfaceProxyDebugSelectionMock(...args),
  safeUpdateSurfaceProxyDebugRuntime: (...args: unknown[]) => safeUpdateSurfaceProxyDebugRuntimeMock(...args),
  safeInsertSurfaceProxyDebugAttempt: (...args: unknown[]) => safeInsertSurfaceProxyDebugAttemptMock(...args),
  safeFinalizeSurfaceProxyDebugTrace: (...args: unknown[]) => safeFinalizeSurfaceProxyDebugTraceMock(...args),
  safeUpdateSurfaceProxyDebugAttempt: vi.fn(),
  reserveSurfaceProxyDebugAttemptBase: () => 0,
  buildSurfaceProxyDebugResponseHeaders: () => ({}),
  captureSurfaceProxyDebugSuccessResponseBody: async () => null,
  parseSurfaceProxyDebugTextPayload: (raw: string) => raw,
}));

vi.mock('../../services/oauth/quota.js', () => ({
  recordOauthQuotaHeadersSnapshot: async () => undefined,
  recordOauthQuotaResetHint: async () => undefined,
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

describe('claude count_tokens proxy route', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { registerDownstreamProtocolSurface } = await import('../surfaces/downstreamProtocolSurface.js');
    const { claudeProtocolAdapter } = await import('./claude.js');
    app = Fastify();
    await registerDownstreamProtocolSurface(app, claudeProtocolAdapter);
  });

  beforeEach(() => {
    fetchMock.mockReset();
    selectTargetMock.mockReset();
    selectNextTargetMock.mockReset();
    recordSuccessMock.mockReset();
    recordFailureMock.mockReset();
    refreshModelsAndRebuildRoutesMock.mockReset();
    reportProxyAllFailedMock.mockReset();
    reportTokenExpiredMock.mockReset();
    resolveProxyUsageWithSelfLogFallbackMock.mockClear();
    startSurfaceProxyDebugTraceMock.mockReset();
    safeUpdateSurfaceProxyDebugSelectionMock.mockReset();
    safeUpdateSurfaceProxyDebugRuntimeMock.mockReset();
    safeInsertSurfaceProxyDebugAttemptMock.mockReset();
    safeFinalizeSurfaceProxyDebugTraceMock.mockReset();
    dbInsertMock.mockClear();

    startSurfaceProxyDebugTraceMock.mockResolvedValue({
      traceId: 701,
      options: {
        enabled: true,
        captureHeaders: true,
        captureBodies: true,
        captureStreamChunks: false,
        targetSessionId: '',
        targetClientKind: '',
        targetModel: '',
        retentionHours: 24,
        maxBodyBytes: 262144,
      },
    });
    selectTargetMock.mockReturnValue({
      target: { id: 11, routeId: 22 },
      executionTargetId: 11,
      executionAttemptId: 'ea_11',
      site: { id: 44, name: 'claude-site', url: 'https://api.anthropic.com', platform: 'claude' },
      account: { id: 33, username: 'claude-user@example.com' },
      tokenName: 'default',
      tokenValue: 'sk-claude',
      actualModel: 'claude-opus-4-6',
    });
    selectNextTargetMock.mockReturnValue(null);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('forwards /v1/messages/count_tokens to the claude count_tokens upstream path', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      input_tokens: 42,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/messages/count_tokens',
      payload: {
        model: 'claude-opus-4-6',
        tools: [
          { name: 'lookup', input_schema: { type: 'object' } },
        ],
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'count these tokens' }],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ input_tokens: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [targetUrl, options] = fetchMock.mock.calls[0] as [string, any];
    expect(targetUrl).toBe('https://api.anthropic.com/v1/messages/count_tokens?beta=true');
    expect(options.headers['anthropic-version']).toBe('2023-06-01');
    expect(options.headers['anthropic-beta']).toBe('token-counting-2024-11-01');
    expect(options.headers['Accept-Encoding']).toBeUndefined();
    expect(startSurfaceProxyDebugTraceMock).toHaveBeenCalledWith(expect.objectContaining({
      downstreamPath: '/v1/messages/count_tokens',
      requestedModel: 'claude-opus-4-6',
    }));
    expect(safeInsertSurfaceProxyDebugAttemptMock).toHaveBeenCalled();
    expect(safeFinalizeSurfaceProxyDebugTraceMock).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: 701 }),
      expect.objectContaining({
        finalStatus: 'success',
        finalUpstreamPath: '/v1/messages/count_tokens?beta=true',
      }),
    );

    const forwardedBody = JSON.parse(String(options.body));
    expect(forwardedBody.model).toBe('claude-opus-4-6');
    expect(forwardedBody.messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: 'count these tokens', cache_control: { type: 'ephemeral' } }],
      },
    ]);
  });

  it('supports /v1/messages/count_tokens for openai-platform gateways that expose Claude messages endpoints', async () => {
    selectTargetMock.mockReturnValue({
      target: { id: 12, routeId: 23 },
      executionTargetId: 12,
      executionAttemptId: 'ea_12',
      site: { id: 44, name: 'gateway-site', url: 'https://gateway.example.com', platform: 'openai' },
      account: { id: 34, username: 'gateway-user@example.com' },
      tokenName: 'default',
      tokenValue: 'sk-gateway',
      actualModel: 'claude-sonnet-4-5-20250929',
    });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      input_tokens: 9,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/messages/count_tokens',
      payload: {
        model: 'claude-sonnet-4-5-20250929',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'count through a compatible gateway' }],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ input_tokens: 9 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [targetUrl, options] = fetchMock.mock.calls[0] as [string, any];
    expect(targetUrl).toBe('https://gateway.example.com/v1/messages/count_tokens?beta=true');
    expect(options.headers['x-api-key']).toBe('sk-gateway');
    expect(options.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('does not forward when claude count_tokens upstream compatibility is unavailable', async () => {
    selectTargetMock.mockReturnValue({
      target: { id: 12, routeId: 23 },
      executionTargetId: 12,
      executionAttemptId: 'ea_12',
      site: { id: 44, name: 'codex-site', url: 'https://chatgpt.com/backend-api/codex', platform: 'codex' },
      account: { id: 34, username: 'codex-user@example.com' },
      tokenName: 'default',
      tokenValue: 'sk-codex',
      actualModel: 'gpt-5.4',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/messages/count_tokens',
      payload: {
        model: 'gpt-5.4',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'count through codex' }],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        message: 'No available targets for this model',
        type: 'upstream_error',
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
