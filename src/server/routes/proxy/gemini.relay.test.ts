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

describe('/v1beta/models/* Gemini relay with scenario upstreams', () => {
  let harness: ProxyRelayHarness;

  beforeAll(async () => {
    harness = await createProxyRelayHarness('metapi-gemini-relay-');
  });

  beforeEach(async () => {
    await harness.resetData();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('relays native generateContent requests to Gemini with model path, key query, and preserved body', async () => {
    const { managedKey } = await harness.seedRoute({
      model: 'gemini-relay-model',
      platform: 'gemini',
      tokenValue: 'gemini-relay-key',
    });
    harness.upstream.add({
      method: 'POST',
      path: '/v1beta/models/gemini-relay-model:generateContent?key=gemini-relay-key',
      respond: {
        json: {
          responseId: 'gemini-relay-response',
          modelVersion: 'gemini-relay-model',
          candidates: [
            {
              content: {
                parts: [{ text: 'hello from gemini relay' }],
                role: 'model',
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 8,
            candidatesTokenCount: 4,
            totalTokenCount: 12,
          },
        },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1beta/models/gemini-relay-model:generateContent',
      headers: {
        'x-goog-api-key': managedKey.key,
      },
      payload: {
        contents: [
          {
            role: 'user',
            parts: [{ text: 'hello' }],
          },
        ],
        generationConfig: {
          thinkingConfig: {
            thinkingBudget: 256,
          },
        },
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      responseId: 'gemini-relay-response',
      modelVersion: 'gemini-relay-model',
      candidates: [
        {
          index: 0,
          content: {
            parts: [{ text: 'hello from gemini relay' }],
            role: 'model',
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 8,
        candidatesTokenCount: 4,
        totalTokenCount: 12,
      },
    });

    const call = harness.upstream.calls
      .filter((entry) => `${entry.url.pathname}${entry.url.search}` === '/v1beta/models/gemini-relay-model:generateContent?key=gemini-relay-key')
      .at(-1);
    expect(call).toBeTruthy();
    expect(`${call.url.pathname}${call.url.search}`).toBe(
      '/v1beta/models/gemini-relay-model:generateContent?key=gemini-relay-key',
    );
    expect(call.headers.get('content-type')).toContain('application/json');
    expect(call.headers.get('authorization')).toBeNull();
    expect(call.json).toEqual({
      contents: [
        {
          role: 'user',
          parts: [{ text: 'hello' }],
        },
      ],
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: 256,
        },
      },
    });
  });

  it('passes through native Gemini SSE while preserving function-call and text chunks', async () => {
    const { managedKey } = await harness.seedRoute({
      model: 'gemini-stream-model',
      platform: 'gemini',
      tokenValue: 'gemini-stream-key',
    });
    const firstChunk = {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  id: 'tool-1',
                  name: 'lookup_docs',
                  args: { query: 'route graph' },
                },
                thoughtSignature: 'sig-tool-1',
              },
            ],
          },
        },
      ],
    };
    const secondChunk = {
      candidates: [
        {
          content: {
            parts: [{ text: 'answer with spacing' }],
            role: 'model',
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 9,
        candidatesTokenCount: 5,
        totalTokenCount: 14,
      },
    };
    harness.upstream.add({
      method: 'POST',
      path: '/v1beta/models/gemini-stream-model:streamGenerateContent?alt=sse&key=gemini-stream-key',
      respond: {
        sse: [
          { data: firstChunk },
          { data: secondChunk },
          'data: [DONE]',
        ],
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1beta/models/gemini-stream-model:streamGenerateContent?alt=sse',
      headers: {
        'x-goog-api-key': managedKey.key,
      },
      payload: {
        contents: [
          {
            role: 'user',
            parts: [{ text: 'stream please' }],
          },
        ],
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('"functionCall":{"id":"tool-1","name":"lookup_docs"');
    expect(response.body).toContain('"thoughtSignature":"sig-tool-1"');
    expect(response.body).toContain('"text":"answer with spacing"');
    expect(response.body).toContain('data: [DONE]');

    const call = harness.upstream.calls
      .filter((entry) => `${entry.url.pathname}${entry.url.search}` === '/v1beta/models/gemini-stream-model:streamGenerateContent?alt=sse&key=gemini-stream-key')
      .at(-1);
    expect(call).toBeTruthy();
    expect(`${call.url.pathname}${call.url.search}`).toBe(
      '/v1beta/models/gemini-stream-model:streamGenerateContent?alt=sse&key=gemini-stream-key',
    );
    expect(call.json).toEqual({
      contents: [
        {
          role: 'user',
          parts: [{ text: 'stream please' }],
        },
      ],
    });
  });

  it('records a normalized failure log when the upstream Gemini generateContent endpoint fails', async () => {
    const { managedKey, route, channel, account } = await harness.seedRoute({
      model: 'gemini-failure-model',
      platform: 'gemini',
      tokenValue: 'gemini-failure-key',
    });
    harness.upstream.add({
      method: 'POST',
      path: '/v1beta/models/gemini-failure-model:generateContent?key=gemini-failure-key',
      respond: {
        status: 500,
        json: {
          error: {
            message: 'gemini internal error',
            status: 'INTERNAL',
          },
        },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1beta/models/gemini-failure-model:generateContent',
      headers: {
        'x-goog-api-key': managedKey.key,
      },
      payload: {
        contents: [
          {
            role: 'user',
            parts: [{ text: 'fail please' }],
          },
        ],
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
      && log.httpStatus === 500
      && log.routeId === route.id
      && log.channelId === channel.id
      && log.accountId === account.id
      && log.downstreamApiKeyId === managedKey.id
      && log.modelRequested === 'gemini-failure-model'
      && String(log.errorMessage || '').includes('gemini internal error'))).toBe(true);
  });
});
