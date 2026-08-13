import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createProxyRelayHarness,
  type ProxyRelayHarness,
} from '../../../testing/proxyRelayHarness.js';
import { doneSseChunk } from '../../../testing/upstreamMock.js';

vi.mock('undici', async () => {
  const actual = await vi.importActual<typeof import('undici')>('undici');
  return {
    ...actual,
    fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
  };
});

describe('/v1/responses relay with scenario upstreams', () => {
  let harness: ProxyRelayHarness;
  let runtimeConfig: typeof import('../../config.js').config;
  let originalResponsesUpstreamTransportMode: typeof runtimeConfig.responsesUpstreamTransportMode;
  let cacheAffinity: typeof import('../../services/cacheAffinityObservationService.js');
  let downstreamContext: typeof import('../../proxy-core/downstreamClientContext.js');

  beforeAll(async () => {
    harness = await createProxyRelayHarness('metapi-responses-relay-');
    runtimeConfig = (await import('../../config.js')).config;
    originalResponsesUpstreamTransportMode = runtimeConfig.responsesUpstreamTransportMode;
    cacheAffinity = await import('../../services/cacheAffinityObservationService.js');
    downstreamContext = await import('../../proxy-core/downstreamClientContext.js');
  });

  beforeEach(async () => {
    runtimeConfig.responsesUpstreamTransportMode = 'auto';
    cacheAffinity.resetCacheAffinityObservationsForTest();
    await harness.resetData();
  });

  afterAll(async () => {
    runtimeConfig.responsesUpstreamTransportMode = originalResponsesUpstreamTransportMode;
    await harness?.close();
  });

  it('follows the downstream non-stream mode when configured and records usage', async () => {
    runtimeConfig.responsesUpstreamTransportMode = 'follow_downstream';
    const { managedKey } = await harness.seedRoute({ model: 'responses-relay-model' });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/responses',
      respond: {
        json: {
          id: 'resp_relay_non_stream',
          object: 'response',
          model: 'responses-relay-model',
          status: 'completed',
          output: [
            {
              id: 'msg_relay_non_stream',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'hello from responses' }],
            },
          ],
          output_text: 'hello from responses',
          usage: {
            input_tokens: 12,
            output_tokens: 5,
            total_tokens: 17,
          },
        },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        model: 'responses-relay-model',
        input: 'say hello',
        instructions: 'Be concise.',
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'resp_relay_non_stream',
      object: 'response',
      model: 'responses-relay-model',
      output_text: 'hello from responses',
      usage: {
        input_tokens: 12,
        output_tokens: 5,
        total_tokens: 17,
      },
    });

    const upstreamCall = harness.upstream.calls.find((call) => call.url.pathname === '/v1/responses');
    expect(upstreamCall?.headers.get('authorization')).toBe('Bearer responses-relay-model-token-value');
    expect(upstreamCall?.json).toMatchObject({
      model: 'responses-relay-model',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'say hello',
            },
          ],
        },
      ],
      instructions: 'Be concise.',
      stream: false,
    });
    expect(upstreamCall?.headers.get('accept')).not.toBe('text/event-stream');

    const logs = await harness.db.select().from(harness.schema.proxyLogs).all();
    expect(logs).toEqual([
      expect.objectContaining({
        modelRequested: 'responses-relay-model',
        modelActual: 'responses-relay-model',
        status: 'success',
        httpStatus: 200,
        promptTokens: 12,
        completionTokens: 5,
        totalTokens: 17,
      }),
    ]);
  });

  it('records real upstream cache usage for the successful target and endpoint type', async () => {
    const model = 'responses-cache-observation-model';
    const { managedKey, candidate } = await harness.seedRoute({ model });
    const payload = {
      model,
      input: 'Inspect the cache-aware route.',
      instructions: 'Be concise.',
    };
    const clientContext = downstreamContext.detectDownstreamClientContext({
      downstreamPath: '/v1/responses',
      body: payload,
    });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/responses',
      respond: {
        json: {
          id: 'resp_cache_observation',
          object: 'response',
          model,
          status: 'completed',
          output: [],
          usage: {
            input_tokens: 100,
            output_tokens: 10,
            total_tokens: 110,
            input_tokens_details: {
              cached_tokens: 80,
            },
          },
        },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: { 'x-api-key': managedKey.key },
      payload,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(clientContext.contentAffinityKey).toMatch(/^content:/);
    const [successLog] = await harness.db.select().from(harness.schema.proxyLogs).all();
    expect(successLog).toMatchObject({
      executionTargetId: candidate.executionTargetId,
      promptTokens: 100,
      completionTokens: 10,
    });
    expect(cacheAffinity.getCacheAffinityObservation({
      executionTargetId: successLog.executionTargetId!,
      endpointType: 'openai.responses',
      contentAffinityKey: clientContext.contentAffinityKey!,
    })).toMatchObject({
      sampleCount: 1,
      hitProbability: 0.5,
      cachedReadFraction: 0.8,
    });
  });

  it('aggregates non-stream responses when the upstream returns responses SSE', async () => {
    const { managedKey } = await harness.seedRoute({ model: 'responses-sse-model' });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/responses',
      respond: {
        sse: [
          {
            event: 'response.created',
            data: {
              type: 'response.created',
              response: {
                id: 'resp_sse_relay',
                model: 'responses-sse-model',
                status: 'in_progress',
                output: [],
              },
            },
          },
          {
            event: 'response.output_item.added',
            data: {
              type: 'response.output_item.added',
              output_index: 0,
              item: {
                id: 'msg_sse_relay',
                type: 'message',
                role: 'assistant',
                status: 'in_progress',
                content: [],
              },
            },
          },
          {
            event: 'response.output_text.delta',
            data: {
              type: 'response.output_text.delta',
              output_index: 0,
              item_id: 'msg_sse_relay',
              delta: 'streamed but aggregated',
            },
          },
          {
            event: 'response.completed',
            data: {
              type: 'response.completed',
              response: {
                id: 'resp_sse_relay',
                model: 'responses-sse-model',
                status: 'completed',
                output: [],
                usage: {
                  input_tokens: 3,
                  output_tokens: 4,
                  total_tokens: 7,
                },
              },
            },
          },
          doneSseChunk(),
        ],
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        model: 'responses-sse-model',
        input: 'aggregate',
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'resp_sse_relay',
      status: 'completed',
      output_text: 'streamed but aggregated',
      output: [
        expect.objectContaining({
          id: 'msg_sse_relay',
          content: [
            {
              type: 'output_text',
              text: 'streamed but aggregated',
            },
          ],
        }),
      ],
    });
    const upstreamCall = harness.upstream.calls.find((call) => call.url.pathname === '/v1/responses');
    expect(upstreamCall?.headers.get('accept')).toBe('text/event-stream');
    expect(upstreamCall?.json).toMatchObject({
      model: 'responses-sse-model',
      stream: true,
    });
  });

  it('streams responses SSE through the responses stream session', async () => {
    const { managedKey } = await harness.seedRoute({ model: 'responses-stream-model' });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/responses',
      respond: {
        sse: [
          {
            event: 'response.created',
            data: {
              type: 'response.created',
              response: {
                id: 'resp_stream_relay',
                model: 'responses-stream-model',
                status: 'in_progress',
                output: [],
              },
            },
          },
          {
            event: 'response.output_item.added',
            data: {
              type: 'response.output_item.added',
              output_index: 0,
              item: {
                id: 'msg_stream_relay',
                type: 'message',
                role: 'assistant',
                status: 'in_progress',
                content: [],
              },
            },
          },
          {
            event: 'response.output_text.delta',
            data: {
              type: 'response.output_text.delta',
              output_index: 0,
              item_id: 'msg_stream_relay',
              delta: 'stream chunk',
            },
          },
          {
            event: 'response.completed',
            data: {
              type: 'response.completed',
              response: {
                id: 'resp_stream_relay',
                model: 'responses-stream-model',
                status: 'completed',
                output: [],
                usage: {
                  input_tokens: 2,
                  output_tokens: 2,
                  total_tokens: 4,
                },
              },
            },
          },
          doneSseChunk(),
        ],
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        model: 'responses-stream-model',
        input: 'stream',
        stream: true,
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('event: response.output_text.delta');
    expect(response.body).toContain('stream chunk');
    expect(response.body).toContain('data: [DONE]');

    const upstreamCall = harness.upstream.calls.find((call) => call.url.pathname === '/v1/responses');
    expect(upstreamCall?.json).toMatchObject({
      model: 'responses-stream-model',
      stream: true,
    });
  });

  it('records cache evidence from the terminal event of a streamed response', async () => {
    const model = 'responses-stream-cache-model';
    const { managedKey, candidate } = await harness.seedRoute({ model });
    const payload = { model, input: 'Stream a cache-aware answer.', stream: true };
    const clientContext = downstreamContext.detectDownstreamClientContext({
      downstreamPath: '/v1/responses',
      body: payload,
    });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/responses',
      respond: {
        sse: [
          {
            event: 'response.output_text.delta',
            data: { type: 'response.output_text.delta', delta: 'cached stream' },
          },
          {
            event: 'response.completed',
            data: {
              type: 'response.completed',
              response: {
                id: 'resp_stream_cache',
                model,
                status: 'completed',
                output: [],
                usage: {
                  input_tokens: 50,
                  output_tokens: 5,
                  total_tokens: 55,
                  input_tokens_details: { cached_tokens: 30 },
                },
              },
            },
          },
          doneSseChunk(),
        ],
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: { 'x-api-key': managedKey.key },
      payload,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(cacheAffinity.getCacheAffinityObservation({
      executionTargetId: candidate.executionTargetId,
      endpointType: 'openai.responses',
      contentAffinityKey: clientContext.contentAffinityKey!,
    })).toMatchObject({ cachedReadFraction: 0.6 });
  });

  it('supports /v1/responses/compact as a distinct upstream alias', async () => {
    const { managedKey } = await harness.seedRoute({ model: 'responses-compact-model' });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/responses/compact',
      respond: {
        json: {
          id: 'resp_compact_alias',
          object: 'response',
          model: 'responses-compact-model',
          status: 'completed',
          output_text: 'compact response',
        },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/responses/compact',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        model: 'responses-compact-model',
        input: 'compact',
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ id: 'resp_compact_alias' });
    expect(harness.upstream.calls.some((entry) => entry.url.pathname === '/v1/responses/compact')).toBe(true);
  });

  it('rejects managed keys before responses relay when their model policy blocks the requested model', async () => {
    const { managedKey } = await harness.seedRoute({ model: 'responses-policy-allowed' });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        model: 'responses-policy-blocked',
        input: 'should not relay',
      },
    });

    expect(response.statusCode, response.body).toBe(403);
    expect(response.json()).toMatchObject({
      error: {
        type: 'permission_error',
      },
    });
    expect(harness.upstream.calls).toHaveLength(0);
    expect(await harness.db.select().from(harness.schema.proxyLogs).all()).toEqual([]);
  });

  it('records a normalized failure log when every upstream responses candidate fails', async () => {
    const { managedKey, route, candidate, account } = await harness.seedRoute({ model: 'responses-failure-model' });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/responses',
      respond: {
        status: 503,
        json: {
          error: {
            message: 'responses upstream unavailable',
            type: 'server_error',
          },
        },
      },
    }).add({
      method: 'POST',
      path: /^\/v1\/(messages|chat\/completions)$/,
      respond: {
        status: 503,
        json: { error: { message: 'responses upstream unavailable', type: 'server_error' } },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        model: 'responses-failure-model',
        input: 'fail please',
      },
    });

    expect(response.statusCode, response.body).toBe(503);
    expect(response.json()).toMatchObject({
      error: expect.objectContaining({
        message: expect.stringContaining('responses upstream unavailable'),
      }),
    });

    const logs = await harness.db.select().from(harness.schema.proxyLogs).all();
    expect(logs.some((log) => log.status === 'failed'
      && log.httpStatus === 503
      && log.executionTargetId === candidate.executionTargetId
      && log.executionAttemptId === candidate.executionAttemptId
      && log.accountId === account.id
      && log.downstreamApiKeyId === managedKey.id
      && log.modelRequested === 'responses-failure-model'
      && String(log.errorMessage || '').includes('responses upstream unavailable'))).toBe(true);
  });
});
