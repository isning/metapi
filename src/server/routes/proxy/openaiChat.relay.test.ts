import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  doneSseChunk,
  openAiChatCompletionChunk,
} from '../../../testing/upstreamMock.js';
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

  it('applies managed key compiled plan scope to the actual relay candidate selection', async () => {
    const allowed = await harness.seedRoute({
      model: 'policy-shared-model',
      siteUrl: 'https://allowed-route.example.com',
      tokenValue: 'allowed-route-token',
    });
    await harness.db.update(harness.schema.downstreamApiKeys).set({
      supportedModels: JSON.stringify([]),
      allowedPlanIds: JSON.stringify([
        (await (await import('../../services/compiledRuntimeInventoryService.js')).listActiveCompiledRuntimeModelEntrypoints())
          .find((entrypoint) => entrypoint.modelName === 'policy-shared-model')!.planId,
      ]),
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

    const logs = await harness.db.select().from(harness.schema.proxyLogs).all();
    expect(logs.some((log: any) => log.status === 'success'
      && log.executionTargetId === allowed.candidate.executionTargetId
      && log.executionAttemptId === allowed.candidate.executionAttemptId
      && log.accountId === allowed.account.id
      && log.downstreamApiKeyId === managedKey!.id)).toBe(true);
  });

  it('executes published route graph filters before relaying chat requests upstream', async () => {
    const { site, account, token, route, candidate, managedKey } = await harness.seedRoute({
      model: 'deepseek-v4-pro',
      siteUrl: 'https://deepseek-runtime.example.com',
      tokenValue: 'sk-deepseek-runtime',
    });
    await harness.db.update(harness.schema.downstreamApiKeys).set({
      supportedModels: JSON.stringify(['deepseek-v4-pro-max']),
    }).run();
    const { getExecutionTargetIdForMember } = await import('../../../testing/routeGroupMemberTestUtils.js');
    const executionTargetId = await getExecutionTargetIdForMember(candidate.id);
    expect(executionTargetId).toBeTruthy();

    const { publishRouteGraphSource } = await import('../../services/routeGraphService.js');
    const published = await publishRouteGraphSource({
      createdBy: 'test',
      sourceGraph: {
        nodes: [
          {
            id: 'entry.deepseek-max',
            type: 'entry',
            enabled: true,
            visibility: 'public',
            ownership: 'manual',
            match: {
              requestedModelPattern: 'deepseek-v4-pro-max',
              displayName: 'deepseek-v4-pro-max',
            },
          },
          {
            id: 'filter.deepseek-runtime',
            type: 'filter',
            enabled: true,
            visibility: 'internal',
            ownership: 'manual',
            operations: [
              { type: 'rewrite_model', source: 'current_model', operation: 'strip_suffix', suffix: '-max' },
              { type: 'set_payload', path: 'reasoning_effort', mode: 'override', value: 'high' },
              { type: 'set_payload', path: 'metadata.routeGraph', mode: 'override', value: 'filtered' },
              { type: 'set_header', name: 'X-Route-Graph', mode: 'override', value: 'filtered' },
              { type: 'set_endpoint_preference', endpoint: 'chat' },
            ],
          },
          {
            id: 'endpoint.deepseek-runtime',
            type: 'route_endpoint',
            routeEndpointId: 'endpoint.deepseek-runtime',
            enabled: true,
            visibility: 'internal',
            ownership: 'manual',
            endpointKind: 'supply',
            config: {
              targets: [{
                targetId: String(candidate.id),
                model: 'deepseek-v4-pro',
                accountId: account.id,
                siteId: site.id,
                tokenId: token.id,
                weight: 10,
                transportBinding: { kind: 'execution_target', executionTargetId },
              }],
              targetSelection: { kind: 'builtin', builtin: 'weighted' },
            },
          },
        ],
        edges: [
          {
            id: 'entry-filter-deepseek-runtime',
            sourceNodeId: 'entry.deepseek-max',
            sourcePortId: 'bidirect.out',
            targetNodeId: 'filter.deepseek-runtime',
            targetPortId: 'bidirect.in',
            kind: 'bidirect_flow',
            ownership: 'manual',
          },
          {
            id: 'filter-endpoint-deepseek-runtime',
            sourceNodeId: 'filter.deepseek-runtime',
            sourcePortId: 'bidirect.out',
            targetNodeId: 'endpoint.deepseek-runtime',
            targetPortId: 'bidirect.in',
            kind: 'bidirect_flow',
            ownership: 'manual',
          },
        ],
        macros: [],
      },
    });
    expect(published.ok).toBe(true);
    if (!published.ok) throw new Error('Failed to publish route Graph fixture');
    const { getCompiledRouterPlanById } = await import('../../../shared/compiledRuntime.js');
    const publishedBundle = published.version.compiledGraph.compiledRouterBundle;
    if (!publishedBundle) throw new Error('Published Graph fixture has no compiled runtime bundle');
    const publishedAttempt = publishedBundle.plans
      .flatMap((storedPlan) => getCompiledRouterPlanById(publishedBundle, storedPlan.id)?.executionAlternatives || [])
      .map((alternative) => alternative.executionAttempt)
      .find((attempt) => attempt?.transportBinding?.executionTargetId === candidate.executionTargetId);
    if (!publishedAttempt?.executionAttemptId) throw new Error('Published Graph fixture has no execution attempt identity');

    harness.upstream.add({
      method: 'POST',
      path: (request) => (
        request.url.origin === 'https://deepseek-runtime.example.com'
        && request.url.pathname === '/v1/chat/completions'
      ),
      respond: {
        json: {
          id: 'chatcmpl_route_graph_filtered',
          object: 'chat.completion',
          created: 0,
          model: 'deepseek-v4-pro',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'filtered route graph request' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
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
        model: 'deepseek-v4-pro-max',
        messages: [{ role: 'user', content: 'use the route graph filters' }],
        reasoning_effort: 'medium',
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().choices[0].message.content).toBe('filtered route graph request');

    const call = harness.upstream.calls.find((entry) => entry.url.origin === 'https://deepseek-runtime.example.com');
    expect(call?.url.pathname).toBe('/v1/chat/completions');
    expect(call?.headers.get('authorization')).toBe('Bearer sk-deepseek-runtime');
    expect(call?.headers.get('x-route-graph')).toBe('filtered');
    expect(call?.json).toMatchObject({
      model: 'deepseek-v4-pro',
      reasoning_effort: 'high',
      metadata: { routeGraph: 'filtered' },
      messages: [{ role: 'user', content: 'use the route graph filters' }],
    });

    const logs = await harness.db.select().from(harness.schema.proxyLogs).all();
    expect(logs).toEqual([
      expect.objectContaining({
        executionTargetId: candidate.executionTargetId,
        executionAttemptId: publishedAttempt.executionAttemptId,
        accountId: account.id,
        downstreamApiKeyId: managedKey.id,
        modelRequested: 'deepseek-v4-pro-max',
        modelActual: 'deepseek-v4-pro',
        status: 'success',
      }),
    ]);
  });

  it('records a normalized failure log when every upstream chat candidate fails', async () => {
    const { managedKey, route, candidate, account } = await harness.seedRoute({ model: 'relay-failure-model' });
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
    }).add({
      method: 'POST',
      path: '/v1/messages',
      respond: {
        status: 502,
        json: { error: { message: 'upstream chat exploded', type: 'bad_gateway' } },
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

    expect(response.statusCode, response.body).toBe(502);
    expect(response.json()).toEqual({
      error: {
        message: '所有执行尝试均不可用，请稍后重试',
        type: 'upstream_error',
      },
    });

    const logs = await harness.db.select().from(harness.schema.proxyLogs).all();
    expect(logs.some((log: any) => log.status === 'failed'
      && log.httpStatus === 502
      && log.executionTargetId === candidate.executionTargetId
      && log.executionAttemptId === candidate.executionAttemptId
      && log.accountId === account.id
      && log.downstreamApiKeyId === managedKey.id
      && log.modelRequested === 'relay-failure-model'
      && String(log.errorMessage || '').includes('upstream chat exploded'))).toBe(true);
  });
});
