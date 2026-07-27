import Fastify, { type FastifyInstance } from 'fastify';
import { executionDecisionFromTargetMocks } from '../../../testing/routeRuntimeDecisionMock.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearRouteGroupMemberTestData } from '../../../testing/routeGroupMemberTestUtils.js';

const fetchMock = vi.fn();
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


vi.mock('../../services/routeRuntimeExecutionService.js', () => ({
  createRouteRuntimeDecisionSession: async (input: any) => input,
  selectRouteRuntimeDecisionInSession: (session: any, input: any) => executionDecisionFromTargetMocks(
    { ...session, ...input }, selectTargetMock,
  ),
  previewRouteRuntimeDecisionInSession: (session: any, input: any) => executionDecisionFromTargetMocks(
    { ...session, ...input }, selectTargetMock,
  ),
  selectRouteRuntimeDecision: (input: any) => executionDecisionFromTargetMocks(input, selectTargetMock),
  selectRouteRuntimeExecutionAttempt: (input: any) =>
    selectTargetMock(input?.requestedModel, input?.downstreamPolicy),
  resolveRouteRuntimeSyntheticResponse: async () => null,
  recordRouteRuntimeExecutionAttemptStarted: async () => undefined,
  recordRouteRuntimeExecutionAttemptSuccess: (input: any) =>
    recordSuccessMock(input.executionTargetId, input.latencyMs),
  recordRouteRuntimeExecutionAttemptFailure: (input: any) =>
    recordFailureMock(input.executionTargetId, { status: input.status, rawErrorText: input.errorText }),
  recordRouteRuntimeExecutionAttemptSelected: async () => undefined,
}));

vi.mock('../../services/compiledRuntimeExecutionSessionService.js', () => ({
  startCompiledRuntimeExecutionSession: async () => ({ requestId: 'request:completions-test', startedAtMs: Date.now() }),
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

vi.mock('../../routes/proxy/proxyBilling.js', () => ({
  resolveProxyLogBilling: (...args: unknown[]) => resolveProxyLogBillingMock(...args),
}));

type DbModule = typeof import('../../db/index.js');

describe('/v1/completions usage source logging', () => {
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-completions-usage-source-'));
    process.env.DATA_DIR = dataDir;

    await import('../../db/migrate.js');
    const { registerDownstreamProtocolSurface } = await import('../surfaces/downstreamProtocolSurface.js');
    const dbModule = await import('../../db/index.js');
    const { openaiCompletionsProtocolAdapter } = await import('./completions.js');
    db = dbModule.db;
    schema = dbModule.schema;

    app = Fastify();
    await registerDownstreamProtocolSurface(app, openaiCompletionsProtocolAdapter);
  });

  beforeEach(async () => {
    fetchMock.mockReset();
    selectTargetMock.mockReset();
    recordSuccessMock.mockReset();
    recordFailureMock.mockReset();
    refreshModelsAndRebuildRoutesMock.mockReset();
    reportProxyAllFailedMock.mockReset();
    reportTokenExpiredMock.mockReset();
    insertProxyLogMock.mockReset();
    resolveProxyUsageWithSelfLogFallbackMock.mockReset();
    resolveProxyLogBillingMock.mockReset();

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
    delete process.env.DATA_DIR;
  });

  it('stores usage source metadata on successful completion logs', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'usage-site',
      url: 'https://console.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'usage-user',
      accessToken: '',
      apiToken: 'sk-usage',
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

    selectTargetMock.mockResolvedValue({
      target: { id: 11, routeId: 22 },
      executionTargetId: 11,
      executionAttemptId: 'completions-usage-attempt',
      site,
      account,
      tokenName: 'default',
      tokenValue: 'sk-usage',
      actualModel: 'gpt-4o-mini',
    });

    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      id: 'cmpl-ok',
      object: 'text_completion',
      choices: [{ text: 'ok' }],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3,
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/completions',
      headers: {
        authorization: 'Bearer sk-downstream',
      },
      payload: {
        model: 'gpt-4o-mini',
        prompt: 'hello',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(insertProxyLogMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'success',
      errorMessage: expect.stringContaining('[usage:self-log]'),
    }));
  });
});
