import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

type DbModule = typeof import('../../db/index.js');
type StoreModule = typeof import('../../services/proxyDebugTraceStore.js');

describe('stats proxy debug api', () => {
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let store: StoreModule;
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-stats-proxy-debug-'));
    process.env.DATA_DIR = dataDir;

    await import('../../db/migrate.js');
    const dbModule = await import('../../db/index.js');
    const storeModule = await import('../../services/proxyDebugTraceStore.js');
    const statsRoutesModule = await import('./stats.js');

    db = dbModule.db;
    schema = dbModule.schema;
    store = storeModule;

    app = Fastify();
    await app.register(statsRoutesModule.statsRoutes);
  });

  beforeEach(async () => {
    await db.delete(schema.proxyDebugAttempts).run();
    await db.delete(schema.proxyDebugTraces).run();
  });

  afterAll(async () => {
    await app.close();
    const dbModule = await import('../../db/index.js');
    await dbModule.closeDbConnections();
    delete process.env.DATA_DIR;
  });

  it('lists and returns proxy debug traces with attempt details', async () => {
    const trace = await store.createProxyDebugTrace({
      downstreamPath: '/v1/chat/completions',
      clientKind: 'codex',
      sessionId: 'sess-9',
      traceHint: 'trace-x',
      requestedModel: 'gpt-4.1',
      requestHeaders: { authorization: 'Bearer test' },
      requestBody: { model: 'gpt-4.1' },
    });
    await store.insertProxyDebugAttempt({
      traceId: trace.id,
      attemptIndex: 0,
      executionAttemptId: 'execution-attempt:test:gpt-4.1',
      endpoint: 'chat',
      requestPath: '/v1/chat/completions',
      targetUrl: 'https://example.com/v1/chat/completions',
      runtimeExecutor: 'default',
      requestHeaders: { authorization: 'Bearer test' },
      requestBody: { model: 'gpt-4.1' },
      responseStatus: 200,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: { id: 'chatcmpl_123' },
      rawErrorText: null,
      recoverApplied: false,
      downgradeDecision: false,
      downgradeReason: null,
      fallbackScope: null,
      failureClass: null,
      memoryWrite: { action: 'success', preferredEndpoint: 'chat' },
    });
    await store.insertProxyDebugAttempt({
      traceId: trace.id,
      attemptIndex: 1,
      executionAttemptId: 'execution-attempt:test:fallback',
      endpoint: 'responses',
      requestPath: '/v1/responses',
      targetUrl: 'https://example.com/v1/responses',
      runtimeExecutor: 'fallback',
      requestHeaders: { authorization: 'Bearer fallback' },
      requestBody: { model: 'gpt-4.1', input: 'fallback' },
      responseStatus: 503,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: { error: 'fallback failed' },
      rawErrorText: 'fallback failed',
      recoverApplied: true,
      downgradeDecision: true,
      downgradeReason: 'endpoint_fallback',
      fallbackScope: 'endpoint',
      failureClass: 'upstream_error',
      memoryWrite: { action: 'fallback', preferredEndpoint: 'chat' },
    });
    await store.finalizeProxyDebugTrace(trace.id, {
      finalStatus: 'success',
      finalHttpStatus: 200,
      finalUpstreamPath: '/v1/chat/completions',
      finalResponseHeaders: { 'content-type': 'application/json' },
      finalResponseBody: { id: 'chatcmpl_123' },
    });

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/stats/proxy-debug/traces?limit=10',
    });
    expect(listResponse.statusCode).toBe(200);
    const listBody = listResponse.json() as { items?: Array<{ id: number; finalStatus: string }> };
    expect(listBody.items).toHaveLength(1);
    expect(listBody.items?.[0]?.finalStatus).toBe('success');

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/stats/proxy-debug/traces/${trace.id}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    const detailBody = detailResponse.json() as {
      trace?: { requestedModel?: string; sessionId?: string };
      attempts?: Array<{ executionAttemptId?: string | null; endpoint?: string; endpointType?: string; responseStatus?: number; fallbackScope?: string | null; failureClass?: string | null }>;
    };
    expect(detailBody.trace).toMatchObject({
      requestedModel: 'gpt-4.1',
      sessionId: 'sess-9',
    });
    expect(detailBody.attempts?.[0]).toMatchObject({
      executionAttemptId: 'execution-attempt:test:gpt-4.1',
      endpoint: 'chat',
      endpointType: 'openai.chat_completions',
      responseStatus: 200,
      fallbackScope: null,
      failureClass: null,
    });
    expect(detailBody.trace).not.toHaveProperty('requestBodyJson');
    expect(detailBody.attempts?.[0]).not.toHaveProperty('requestBodyJson');

    const bodyDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/stats/proxy-debug/traces/${trace.id}?includeBodies=1`,
    });
    expect(bodyDetailResponse.statusCode).toBe(200);
    const bodyDetail = bodyDetailResponse.json() as {
      trace?: { requestBodyJson?: string; finalResponseBodyJson?: string };
      attempts?: Array<{ requestBodyJson?: string; responseBodyJson?: string; memoryWriteJson?: string }>;
    };
    expect(bodyDetail.trace?.requestBodyJson).toContain('gpt-4.1');
    expect(bodyDetail.trace?.finalResponseBodyJson).toContain('chatcmpl_123');
    expect(bodyDetail.attempts?.[0]?.requestBodyJson).toContain('gpt-4.1');
    expect(bodyDetail.attempts?.[0]?.responseBodyJson).toContain('chatcmpl_123');
    expect(bodyDetail.attempts?.[0]?.memoryWriteJson).toContain('preferredEndpoint');

    const targetAttempt = (await store.getProxyDebugTraceDetail(trace.id))?.attempts[0];
    expect(targetAttempt?.id).toEqual(expect.any(Number));
    const targetedBodyResponse = await app.inject({
      method: 'GET',
      url: `/api/stats/proxy-debug/traces/${trace.id}?includeBodies=1&attemptId=${targetAttempt?.id}`,
    });
    expect(targetedBodyResponse.statusCode).toBe(200);
    const targetedBody = targetedBodyResponse.json() as {
      trace?: { requestBodyJson?: string; finalResponseBodyJson?: string };
      attempts?: Array<{ id?: number; requestBodyJson?: string; responseBodyJson?: string; memoryWriteJson?: string }>;
    };
    expect(targetedBody.trace).not.toHaveProperty('requestBodyJson');
    expect(targetedBody.trace).not.toHaveProperty('finalResponseBodyJson');
    expect(targetedBody.attempts).toHaveLength(2);
    expect(targetedBody.attempts?.[0]?.requestBodyJson).toContain('gpt-4.1');
    expect(targetedBody.attempts?.[0]?.responseBodyJson).toContain('chatcmpl_123');
    expect(targetedBody.attempts?.[0]?.memoryWriteJson).toContain('preferredEndpoint');
    expect(targetedBody.attempts?.[1]).not.toHaveProperty('requestBodyJson');
    expect(targetedBody.attempts?.[1]).not.toHaveProperty('responseBodyJson');
    expect(targetedBody.attempts?.[1]).not.toHaveProperty('memoryWriteJson');

    const invalidAttemptResponse = await app.inject({
      method: 'GET',
      url: `/api/stats/proxy-debug/traces/${trace.id}?includeBodies=1&attemptId=1junk`,
    });
    expect(invalidAttemptResponse.statusCode).toBe(400);
    expect(invalidAttemptResponse.json()).toMatchObject({
      message: 'proxy debug attempt id is invalid',
    });
  });
});
