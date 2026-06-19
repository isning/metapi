import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  doneSseChunk,
  openAiChatCompletionChunk,
} from '../../../testing/upstreamMock.js';
import {
  createProxyRelayHarness,
  type ProxyRelayHarness,
} from '../../../testing/proxyRelayHarness.js';
import { tokenRouteFixture } from '../../test/routeGraphFixtures.js';

vi.mock('undici', async () => {
  const actual = await vi.importActual<typeof import('undici')>('undici');
  return {
    ...actual,
    fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
  };
});

describe('/v1/chat/completions relay with scenario upstreams', () => {
  let harness: ProxyRelayHarness;

  beforeAll(async () => {
    harness = await createProxyRelayHarness('metapi-openai-chat-relay-');
  });

  beforeEach(async () => {
    await harness.resetData();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('sanitizes outbound tools and returns valid reasoning plus tool calls from non-stream upstream responses', async () => {
    const { managedKey } = await harness.seedRoute();
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
          id: 'chatcmpl-relay-tool',
          object: 'chat.completion',
          created: 0,
          model: 'relay-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: '',
                reasoning_content: 'Need to call a tool with preserved spaces.',
                tool_calls: [
                  {
                    id: 'call_valid',
                    type: 'function',
                    function: { name: 'search_docs', arguments: '{"query":"route graph"}' },
                  },
                  {
                    id: '',
                    type: 'function',
                    function: { name: '', arguments: '' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
        },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        model: 'relay-model',
        messages: [{ role: 'user', content: 'find route graph docs' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'search_docs',
              description: 'Search docs',
              parameters: { type: 'object', properties: { query: { type: 'string' } } },
            },
          },
          {
            type: 'function',
            function: {
              name: '',
              parameters: { type: 'object' },
            },
          },
        ],
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.choices[0].message.reasoning_content).toBe('Need to call a tool with preserved spaces.');
    expect(body.choices[0].message.tool_calls).toEqual([
      expect.objectContaining({
        id: 'call_valid',
        type: 'function',
        function: {
          name: 'search_docs',
          arguments: '{"query":"route graph"}',
        },
      }),
    ]);
    expect(body.choices[0].finish_reason).toBe('tool_calls');

    const chatCall = harness.upstream.calls.find((call) => call.url.pathname === '/v1/chat/completions');
    expect(chatCall?.headers.get('authorization')).toBe('Bearer relay-model-token-value');
    expect(chatCall?.json).toMatchObject({
      model: 'relay-model',
      tools: [
        expect.objectContaining({
          type: 'function',
          function: expect.objectContaining({ name: 'search_docs' }),
        }),
      ],
    });
    expect((chatCall?.json as { tools?: unknown[] }).tools).toHaveLength(1);
  });

  it('preserves reasoning whitespace and assembled tool arguments through streaming relay', async () => {
    const { managedKey } = await harness.seedRoute({ model: 'relay-stream-model' });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/responses',
      respond: { status: 404, json: { error: { message: 'responses unavailable', type: 'invalid_request_error' } } },
      once: true,
    }).add({
      method: 'POST',
      path: '/v1/chat/completions',
      respond: {
        sse: [
          openAiChatCompletionChunk({
            model: 'relay-stream-model',
            delta: { role: 'assistant', reasoning_content: ' first thought ' },
          }),
          openAiChatCompletionChunk({
            model: 'relay-stream-model',
            delta: { reasoning_content: ' second thought' },
          }),
          openAiChatCompletionChunk({
            model: 'relay-stream-model',
            delta: {
              tool_calls: [
                { index: 0, id: 'call_stream', type: 'function', function: { name: 'search_docs', arguments: '{"query":"' } },
              ],
            },
          }),
          openAiChatCompletionChunk({
            model: 'relay-stream-model',
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: 'route graph"}' } },
              ],
            },
          }),
          openAiChatCompletionChunk({
            model: 'relay-stream-model',
            delta: {},
            finishReason: 'tool_calls',
          }),
          doneSseChunk(),
        ],
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        model: 'relay-stream-model',
        stream: true,
        messages: [{ role: 'user', content: 'stream tool' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'search_docs',
              parameters: { type: 'object', properties: { query: { type: 'string' } } },
            },
          },
        ],
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('"reasoning_content":" first thought "');
    expect(response.body).toContain('"reasoning_content":" second thought"');
    expect(response.body).toContain('"id":"call_stream"');
    expect(response.body).toContain('\\"query\\":\\"');
    expect(response.body).toContain('route graph\\"}');
    expect(response.body).toContain('"finish_reason":"tool_calls"');
    expect(response.body).toContain('data: [DONE]');
  });

  it('rejects managed keys before relay when their model policy does not allow the requested model', async () => {
    const { managedKey } = await harness.seedRoute({ model: 'policy-allowed-model' });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        model: 'policy-blocked-model',
        messages: [{ role: 'user', content: 'should not relay' }],
      },
    });

    expect(response.statusCode, response.body).toBe(403);
    expect(response.json()).toMatchObject({
      error: {
        type: 'permission_error',
      },
    });
    expect(harness.upstream.calls).toHaveLength(0);
    const logs = await harness.db.select().from(harness.schema.proxyLogs).all();
    expect(logs).toEqual([]);
  });

  it('applies managed key allowedRouteIds to the actual relay channel selection', async () => {
    const allowed = await harness.seedRoute({
      model: 'policy-shared-model',
      siteUrl: 'https://allowed-route.example.com',
      tokenValue: 'allowed-route-token',
    });
    const blockedSite = await harness.db.insert(harness.schema.sites).values({
      name: 'policy-shared-blocked-site',
      url: 'https://blocked-route.example.com',
      platform: 'openai',
      status: 'active',
    }).returning().get();
    const blockedAccount = await harness.db.insert(harness.schema.accounts).values({
      siteId: blockedSite.id,
      username: 'policy-shared-blocked-account',
      accessToken: 'blocked-route-access',
      apiToken: 'blocked-route-api',
      status: 'active',
    }).returning().get();
    const blockedToken = await harness.db.insert(harness.schema.accountTokens).values({
      accountId: blockedAccount.id,
      name: 'policy-shared-blocked-token',
      token: 'blocked-route-token',
      enabled: true,
      isDefault: true,
    }).returning().get();
    const blockedRoute = await harness.db.insert(harness.schema.tokenRoutes).values({
      ...tokenRouteFixture({
        modelPattern: 'policy-shared-model',
        displayName: 'policy-shared-model',
      }),
      enabled: true,
    }).returning().get();
    const blockedChannel = await harness.db.insert(harness.schema.routeChannels).values({
      routeId: blockedRoute.id,
      accountId: blockedAccount.id,
      tokenId: blockedToken.id,
      sourceModel: 'policy-shared-model',
      priority: 0,
      weight: 10,
      enabled: true,
    }).returning().get();
    await harness.db.update(harness.schema.downstreamApiKeys).set({
      supportedModels: JSON.stringify([]),
      allowedRouteIds: JSON.stringify([allowed.route.id]),
    }).run();
    const managedKey = await harness.db.select().from(harness.schema.downstreamApiKeys).get();

    harness.upstream.add({
      method: 'POST',
      path: (request) => request.url.origin === 'https://allowed-route.example.com'
        && request.url.pathname === '/v1/responses',
      respond: { status: 404, json: { error: { message: 'responses unavailable', type: 'invalid_request_error' } } },
      once: true,
    }).add({
      method: 'POST',
      path: (request) => request.url.origin === 'https://allowed-route.example.com'
        && request.url.pathname === '/v1/chat/completions',
      respond: {
        json: {
          id: 'chatcmpl_allowed_route',
          object: 'chat.completion',
          created: 0,
          model: 'policy-shared-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'allowed route' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
        },
      },
    }).add({
      method: 'POST',
      path: (request) => request.url.origin === 'https://blocked-route.example.com',
      respond: {
        status: 500,
        json: { error: { message: 'blocked route should not be selected', type: 'test_error' } },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'x-api-key': managedKey!.key,
      },
      payload: {
        model: 'policy-shared-model',
        messages: [{ role: 'user', content: 'respect route policy' }],
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().choices[0].message.content).toBe('allowed route');

    const chatCall = harness.upstream.calls.find((call) => call.url.pathname === '/v1/chat/completions');
    expect(chatCall?.url.origin).toBe('https://allowed-route.example.com');
    expect(chatCall?.headers.get('authorization')).toBe('Bearer allowed-route-token');
    expect(harness.upstream.calls.some((call) => call.url.origin === 'https://blocked-route.example.com')).toBe(false);

    const logs = await harness.db.select().from(harness.schema.proxyLogs).all();
    expect(logs.some((log) => log.status === 'success'
      && log.routeId === allowed.route.id
      && log.channelId === allowed.channel.id
      && log.accountId === allowed.account.id
      && log.downstreamApiKeyId === managedKey!.id)).toBe(true);
    expect(logs.some((log) => log.status === 'success' && log.routeId === blockedRoute.id)).toBe(false);
    expect(logs.some((log) => log.status === 'success' && log.channelId === blockedChannel.id)).toBe(false);
  });

  it('records a normalized failure log when every upstream chat candidate fails', async () => {
    const { managedKey, route, channel, account } = await harness.seedRoute({ model: 'relay-failure-model' });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/responses',
      respond: { status: 404, json: { error: { message: 'responses unavailable', type: 'invalid_request_error' } } },
      once: true,
    }).add({
      method: 'POST',
      path: '/v1/chat/completions',
      respond: {
        status: 502,
        json: {
          error: {
            message: 'upstream chat exploded',
            type: 'bad_gateway',
          },
        },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        model: 'relay-failure-model',
        messages: [{ role: 'user', content: 'fail please' }],
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
      && log.httpStatus === 502
      && log.routeId === route.id
      && log.channelId === channel.id
      && log.accountId === account.id
      && log.downstreamApiKeyId === managedKey.id
      && log.modelRequested === 'relay-failure-model'
      && String(log.errorMessage || '').includes('upstream chat exploded'))).toBe(true);
  });
});
