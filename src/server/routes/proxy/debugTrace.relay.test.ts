import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createProxyRelayHarness,
  type ProxyRelayHarness,
} from '../../../testing/proxyRelayHarness.js';

vi.mock('undici', async () => {
  const actual = await vi.importActual<typeof import('undici')>('undici');
  return {
    ...actual,
    fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
  };
});

describe('proxy debug trace relay capture', () => {
  let harness: ProxyRelayHarness;
  let config: typeof import('../../config.js').config;

  beforeAll(async () => {
    harness = await createProxyRelayHarness('metapi-debug-trace-relay-');
    const configModule = await import('../../config.js');
    config = configModule.config;
  });

  beforeEach(async () => {
    await harness.resetData();
    config.proxyDebugTraceEnabled = false;
    config.proxyDebugCaptureHeaders = true;
    config.proxyDebugCaptureBodies = false;
    config.proxyDebugCaptureStreamChunks = false;
    config.proxyDebugTargetSessionId = '';
    config.proxyDebugTargetClientKind = '';
    config.proxyDebugTargetModel = '';
    config.proxyDebugMaxBodyBytes = 262_144;
  });

  afterAll(async () => {
    config.proxyDebugTraceEnabled = false;
    config.proxyDebugCaptureHeaders = true;
    config.proxyDebugCaptureBodies = false;
    config.proxyDebugCaptureStreamChunks = false;
    config.proxyDebugTargetSessionId = '';
    config.proxyDebugTargetClientKind = '';
    config.proxyDebugTargetModel = '';
    await harness?.close();
  });

  it('captures scoped non-stream relay request, attempt, endpoint decision, and final response body', async () => {
    const { managedKey, route, channel, account, site } = await harness.seedRoute({ model: 'debug-trace-model' });
    config.proxyDebugTraceEnabled = true;
    config.proxyDebugCaptureHeaders = true;
    config.proxyDebugCaptureBodies = true;
    config.proxyDebugTargetSessionId = 'trace-session-1';
    config.proxyDebugTargetClientKind = 'codex';
    config.proxyDebugTargetModel = 'debug-trace-model';

    harness.upstream.add({
      method: 'POST',
      path: '/v1/responses',
      respond: { status: 404, json: { error: { message: 'responses unavailable', type: 'invalid_request_error' } } },
      once: true,
    }).add({
      method: 'POST',
      path: '/v1/chat/completions',
      respond: {
        json: {
          id: 'chatcmpl_debug_trace',
          object: 'chat.completion',
          created: 0,
          model: 'debug-trace-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'debug trace response' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
        },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'x-api-key': managedKey.key,
        originator: 'codex_cli_rs',
        session_id: 'trace-session-1',
        'x-trace-id': 'trace-hint-1',
      },
      payload: {
        model: 'debug-trace-model',
        messages: [{ role: 'user', content: 'capture this' }],
      },
    });

    expect(response.statusCode, response.body).toBe(200);

    const traces = await harness.db.select().from(harness.schema.proxyDebugTraces).all();
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      downstreamPath: '/v1/chat/completions',
      clientKind: 'codex',
      sessionId: 'trace-session-1',
      traceHint: 'trace-session-1',
      requestedModel: 'debug-trace-model',
      downstreamApiKeyId: managedKey.id,
      selectedChannelId: channel.id,
      selectedRouteId: route.id,
      selectedAccountId: account.id,
      selectedSiteId: site.id,
      selectedSitePlatform: 'openai',
      finalStatus: 'success',
      finalHttpStatus: 200,
      finalUpstreamPath: '/v1/chat/completions',
    });
    expect(JSON.parse(traces[0]!.requestHeadersJson || '{}')).toMatchObject({
      'x-api-key': managedKey.key,
      session_id: 'trace-session-1',
      'x-trace-id': 'trace-hint-1',
    });
    expect(JSON.parse(traces[0]!.requestBodyJson || '{}')).toMatchObject({
      model: 'debug-trace-model',
      messages: [{ role: 'user', content: 'capture this' }],
    });
    expect(JSON.parse(traces[0]!.finalResponseBodyJson || '{}')).toMatchObject({
      id: 'chatcmpl_debug_trace',
      choices: [
        expect.objectContaining({
          message: { role: 'assistant', content: 'debug trace response' },
        }),
      ],
    });

    const attemptState = JSON.parse(traces[0]!.endpointRuntimeStateJson || '{}');
    expect(attemptState).toMatchObject({
      enabled: true,
      blockedEndpoints: [],
    });
    expect(String(attemptState.stateKey)).toContain('debug-trace-model');
    const decisionSummary = JSON.parse(traces[0]!.decisionSummaryJson || '{}');
    expect(decisionSummary).toMatchObject({
      downstreamFormat: 'openai/chat',
      stickySessionKey: 'key:1|codex|/v1/chat/completions|debug-trace-model|trace-session-1',
    });
    const candidates = JSON.parse(traces[0]!.endpointCandidatesJson || '[]');
    expect(candidates).toEqual(expect.arrayContaining(['responses', 'chat']));

    const attempts = await harness.db.select().from(harness.schema.proxyDebugAttempts).all();
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    expect(attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        traceId: traces[0]!.id,
        endpoint: 'openai/chat',
        requestPath: '/v1/chat/completions',
        runtimeExecutor: 'default',
      }),
    ]));
  });

  it('does not capture relay requests when scoped debug filters do not match', async () => {
    const { managedKey } = await harness.seedRoute({ model: 'debug-filtered-model' });
    config.proxyDebugTraceEnabled = true;
    config.proxyDebugCaptureHeaders = true;
    config.proxyDebugCaptureBodies = true;
    config.proxyDebugTargetSessionId = 'wanted-session';
    config.proxyDebugTargetClientKind = 'codex';
    config.proxyDebugTargetModel = 'debug-filtered-model';

    harness.upstream.add({
      method: 'POST',
      path: '/v1/responses',
      respond: { status: 404, json: { error: { message: 'responses unavailable', type: 'invalid_request_error' } } },
      once: true,
    }).add({
      method: 'POST',
      path: '/v1/chat/completions',
      respond: {
        json: {
          id: 'chatcmpl_debug_filtered',
          object: 'chat.completion',
          created: 0,
          model: 'debug-filtered-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'not captured' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'x-api-key': managedKey.key,
        originator: 'codex_cli_rs',
        session_id: 'other-session',
      },
      payload: {
        model: 'debug-filtered-model',
        messages: [{ role: 'user', content: 'do not capture' }],
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(await harness.db.select().from(harness.schema.proxyDebugTraces).all()).toEqual([]);
    expect(await harness.db.select().from(harness.schema.proxyDebugAttempts).all()).toEqual([]);
  });
});
