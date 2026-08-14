import Fastify, { type FastifyInstance } from 'fastify';
import { executionDecisionFromTargetMocks } from '../../../testing/routeRuntimeDecisionMock.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRouteGroupMemberTestData } from '../../../testing/routeGroupMemberTestUtils.js';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../../testing/dbHarness.js';

const fetchMock = vi.fn();
const fetchWithObservedFirstByteMock = vi.fn();
const getObservedResponseMetaMock = vi.fn();
const selectTargetMock = vi.fn();
const recordSuccessMock = vi.fn();
const recordFailureMock = vi.fn();
const refreshModelsAndRebuildRoutesMock = vi.fn();
const reportProxyAllFailedMock = vi.fn();
const reportTokenExpiredMock = vi.fn();
const insertProxyLogMock = vi.fn();
const resolveProxyUsageWithSelfLogFallbackMock = vi.fn();
const resolveProxyLogBillingMock = vi.fn();

vi.mock('undici', async () => {
  const actual = await vi.importActual<typeof import('undici')>('undici');
  return {
    ...actual,
    fetch: (...args: unknown[]) => fetchMock(...args),
  };
});

vi.mock('../../proxy-core/firstByteTimeout.js', () => ({
  fetchWithObservedFirstByte: (...args: unknown[]) => fetchWithObservedFirstByteMock(...args),
  getObservedResponseMeta: (...args: unknown[]) => getObservedResponseMetaMock(...args),
}));


vi.mock('../../services/routeRuntimeExecutionService.js', () => ({
  createRouteRuntimeDecisionSession: async (input: any) => input,
  selectRouteRuntimeDecisionInSession: (session: any, input: any) => executionDecisionFromTargetMocks(
    { ...session, ...input }, selectTargetMock,
  ),
  previewRouteRuntimeDecisionInSession: (session: any, input: any) => executionDecisionFromTargetMocks(
    { ...session, ...input }, selectTargetMock,
  ),
  selectRouteRuntimeDecision: (input: any) => executionDecisionFromTargetMocks(input, selectTargetMock),
  selectRouteRuntimeExecutionAttempt: async (input: any) => {
    const selected = await selectTargetMock(input?.requestedModel, input?.downstreamPolicy);
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
  startCompiledRuntimeExecutionSession: async () => ({ requestId: 'request:embeddings-test', startedAtMs: Date.now() }),
  resumeCompiledRuntimeExecutionSession: async () => null,
  bindCompiledRuntimeExecutionDecision: async () => undefined,
  completeCompiledRuntimeExecutionSession: async () => undefined,
}));

vi.mock('../../services/routeRefreshWorkflow.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../services/routeRefreshWorkflow.js')>(
      '../../services/routeRefreshWorkflow.js',
    );
  return {
    ...actual,
    refreshModelsAndRebuildRoutes: (...args: unknown[]) =>
      refreshModelsAndRebuildRoutesMock(...args),
  };
});

vi.mock('../../services/alertService.js', () => ({
  reportProxyAllFailed: (...args: unknown[]) => reportProxyAllFailedMock(...args),
  reportTokenExpired: (...args: unknown[]) => reportTokenExpiredMock(...args),
}));

vi.mock('../../services/proxyLogStore.js', () => ({
  insertProxyLog: (...args: unknown[]) => insertProxyLogMock(...args),
}));

vi.mock('../../services/proxyUsageFallbackService.js', () => ({
  resolveProxyUsageWithSelfLogFallback: (...args: unknown[]) => resolveProxyUsageWithSelfLogFallbackMock(...args),
}));

vi.mock('../../services/proxyBilling.js', () => ({
  resolveProxyLogBilling: (...args: unknown[]) => resolveProxyLogBillingMock(...args),
}));

type DbModule = typeof import('../../db/index.js');

describe('/v1/embeddings usage source logging', () => {
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let runtimeDb: IsolatedRuntimeDbHandle;

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-embeddings-site-api-endpoint-');

    const { registerDownstreamProtocolSurface } = await import('../surfaces/downstreamProtocolSurface.js');
    const { openaiEmbeddingsProtocolAdapter } = await import('./embeddings.js');
    db = runtimeDb.db;
    schema = runtimeDb.schema;

    app = Fastify();
    await registerDownstreamProtocolSurface(app, openaiEmbeddingsProtocolAdapter);
  });

  beforeEach(async () => {
    fetchMock.mockReset();
    fetchWithObservedFirstByteMock.mockReset();
    getObservedResponseMetaMock.mockReset();
    selectTargetMock.mockReset();
    recordSuccessMock.mockReset();
    recordFailureMock.mockReset();
    refreshModelsAndRebuildRoutesMock.mockReset();
    reportProxyAllFailedMock.mockReset();
    reportTokenExpiredMock.mockReset();
    insertProxyLogMock.mockReset();
    resolveProxyUsageWithSelfLogFallbackMock.mockReset();
    resolveProxyLogBillingMock.mockReset();

    fetchWithObservedFirstByteMock.mockImplementation(async (runner: (signal?: AbortSignal) => Promise<Response>) => runner());
    getObservedResponseMetaMock.mockReturnValue({ firstByteLatencyMs: 14 });
    resolveProxyUsageWithSelfLogFallbackMock.mockResolvedValue({
      promptTokens: 3,
      completionTokens: 4,
      totalTokens: 7,
      usageSource: 'self-log',
    });
    resolveProxyLogBillingMock.mockResolvedValue({
      estimatedCost: 0,
      billingDetails: null,
    });

    await db.delete(schema.proxyLogs).run();
    await clearRouteGroupMemberTestData();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.tokenModelAvailability).run();
    await db.delete(schema.modelAvailability).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.siteApiEndpoints).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await app.close();
    await runtimeDb?.cleanup();
  });

  it('stores usage source metadata on successful embedding logs', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'usage-site',
      url: 'https://console.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'usage-user',
      credential: '',

      status: 'active',
      checkinEnabled: false,
      extraConfig: JSON.stringify({ credentialMode: 'apikey' }),
    }).returning().get();

    await db.insert(schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://api-a.example.com',
      enabled: true,
      sortOrder: 0,
    }).run();
    selectTargetMock.mockReturnValue({
      target: { id: 11, routeId: 22 },
      executionTargetId: 11,
      executionAttemptId: 'ea_11',
      site,
      account,
      tokenName: 'default',
      tokenValue: 'sk-usage',
      actualModel: 'text-embedding-3-large',
    });

    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      object: 'list',
      data: [
        {
          object: 'embedding',
          embedding: [0.1, 0.2],
          index: 0,
        },
      ],
      model: 'text-embedding-3-large',
      usage: {
        prompt_tokens: 1,
        total_tokens: 1,
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: {
        authorization: 'Bearer sk-downstream',
      },
      payload: {
        model: 'text-embedding-3-large',
        input: 'hello',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(insertProxyLogMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'success',
      errorMessage: expect.stringContaining('[usage:self-log]'),
    }));
  });
});
