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

describe('/v1/messages relay with scenario upstreams', () => {
  let harness: ProxyRelayHarness;

  beforeAll(async () => {
    harness = await createProxyRelayHarness('metapi-claude-relay-');
  });

  beforeEach(async () => {
    await harness.resetData();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('relays native Claude messages with Anthropic headers, thinking blocks, and tool_use content', async () => {
    const { managedKey } = await harness.seedRoute({
      model: 'claude-relay-model',
      platform: 'claude',
      tokenValue: 'sk-claude-relay-token',
    });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/messages',
      respond: {
        json: {
          id: 'msg_relay_claude',
          type: 'message',
          role: 'assistant',
          model: 'claude-relay-model',
          content: [
            {
              type: 'thinking',
              thinking: ' first claude thought ',
              signature: 'sig-claude-relay',
            },
            {
              type: 'tool_use',
              id: 'toolu_relay_lookup',
              name: 'lookup_docs',
              input: { query: 'route graph' },
            },
            {
              type: 'text',
              text: 'done',
            },
          ],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: {
            input_tokens: 11,
            output_tokens: 5,
          },
        },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        model: 'claude-relay-model',
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'find route graph docs' }],
          },
        ],
        tools: [
          {
            name: 'lookup_docs',
            input_schema: {
              type: 'object',
              properties: { query: { type: 'string' } },
            },
          },
        ],
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      id: 'msg_relay_claude',
      type: 'message',
      role: 'assistant',
      model: 'claude-relay-model',
      content: [
        {
          type: 'thinking',
          thinking: ' first claude thought ',
          signature: 'sig-claude-relay',
        },
        {
          type: 'tool_use',
          id: 'toolu_relay_lookup',
          name: 'lookup_docs',
          input: { query: 'route graph' },
        },
        {
          type: 'text',
          text: 'done',
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 11,
        output_tokens: 5,
      },
    });

    const call = harness.upstream.calls.filter((entry) => entry.url.pathname === '/v1/messages').at(-1);
    expect(call).toBeTruthy();
    expect(call.url.pathname).toBe('/v1/messages');
    expect(call.headers.get('x-api-key')).toBe('sk-claude-relay-token');
    expect(call.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(call.headers.get('anthropic-beta')).toContain('fine-grained-tool-streaming');
    expect(call.json).toMatchObject({
      model: 'claude-relay-model',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'find route graph docs' }],
        },
      ],
      tools: [
        {
          name: 'lookup_docs',
          input_schema: {
            type: 'object',
            properties: { query: { type: 'string' } },
          },
        },
      ],
    });
  });

  it('relays Claude count_tokens without max_tokens or stream and includes token-counting beta', async () => {
    const { managedKey } = await harness.seedRoute({
      model: 'claude-count-model',
      platform: 'claude',
      tokenValue: 'sk-claude-count-token',
    });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/messages/count_tokens?beta=true',
      respond: {
        json: {
          input_tokens: 42,
        },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/messages/count_tokens',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        model: 'claude-count-model',
        max_tokens: 99,
        stream: true,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'count these' }],
          },
        ],
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ input_tokens: 42 });

    const call = harness.upstream.calls
      .filter((entry) => `${entry.url.pathname}${entry.url.search}` === '/v1/messages/count_tokens?beta=true')
      .at(-1);
    expect(call).toBeTruthy();
    expect(`${call.url.pathname}${call.url.search}`).toBe('/v1/messages/count_tokens?beta=true');
    expect(call.headers.get('x-api-key')).toBe('sk-claude-count-token');
    expect(call.headers.get('anthropic-beta')).toContain('token-counting-2024-11-01');
    expect(call.json).toEqual({
      model: 'claude-count-model',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'count these', cache_control: { type: 'ephemeral' } }],
        },
      ],
    });
  });

  it('records a normalized failure log when the upstream Claude messages endpoint fails', async () => {
    const { managedKey, route, channel, account } = await harness.seedRoute({
      model: 'claude-failure-model',
      platform: 'claude',
      tokenValue: 'sk-claude-failure-token',
    });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/messages',
      respond: {
        status: 529,
        json: {
          error: {
            message: 'anthropic overloaded',
            type: 'overloaded_error',
          },
        },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        model: 'claude-failure-model',
        max_tokens: 64,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'fail please' }],
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
      && log.httpStatus === 529
      && log.routeId === route.id
      && log.channelId === channel.id
      && log.accountId === account.id
      && log.downstreamApiKeyId === managedKey.id
      && log.modelRequested === 'claude-failure-model'
      && String(log.errorMessage || '').includes('anthropic overloaded'))).toBe(true);
  });
});
