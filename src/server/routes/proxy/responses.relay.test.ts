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

  beforeAll(async () => {
    harness = await createProxyRelayHarness('metapi-responses-relay-');
  });

  beforeEach(async () => {
    await harness.resetData();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('relays non-stream responses requests to upstream /v1/responses and records usage', async () => {
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
    const { managedKey, route, channel, account } = await harness.seedRoute({ model: 'responses-failure-model' });
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
        message: expect.stringContaining('No available channels for this model'),
      }),
    });

    const logs = await harness.db.select().from(harness.schema.proxyLogs).all();
    expect(logs.some((log) => log.status === 'failed'
      && log.httpStatus === 503
      && log.routeId === route.id
      && log.channelId === channel.id
      && log.accountId === account.id
      && log.downstreamApiKeyId === managedKey.id
      && log.modelRequested === 'responses-failure-model'
      && String(log.errorMessage || '').includes('responses upstream unavailable'))).toBe(true);
  });
});
