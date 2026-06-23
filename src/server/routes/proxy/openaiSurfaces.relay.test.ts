import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createProxyRelayHarness,
  type ProxyRelayHarness,
} from '../../../testing/proxyRelayHarness.js';
import { eq } from 'drizzle-orm';

vi.mock('undici', async () => {
  const actual = await vi.importActual<typeof import('undici')>('undici');
  return {
    ...actual,
    fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
  };
});

describe('OpenAI-compatible relay surfaces with scenario upstreams', () => {
  let harness: ProxyRelayHarness;

  beforeAll(async () => {
    harness = await createProxyRelayHarness('metapi-openai-surfaces-relay-');
  });

  beforeEach(async () => {
    await harness.resetData();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('relays embeddings requests and records usage', async () => {
    const { managedKey } = await harness.seedRoute({ model: 'text-embedding-relay' });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/embeddings',
      respond: {
        json: {
          object: 'list',
          data: [
            {
              object: 'embedding',
              index: 0,
              embedding: [0.1, 0.2, 0.3],
            },
          ],
          model: 'text-embedding-relay',
          usage: {
            prompt_tokens: 4,
            total_tokens: 4,
          },
        },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: {
        authorization: `Bearer ${managedKey.key}`,
      },
      payload: {
        model: 'text-embedding-relay',
        input: ['hello'],
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      object: 'list',
      model: 'text-embedding-relay',
      usage: {
        prompt_tokens: 4,
        total_tokens: 4,
      },
    });

    const call = harness.upstream.calls.find((entry) => entry.url.pathname === '/v1/embeddings');
    expect(call?.headers.get('authorization')).toBe('Bearer text-embedding-relay-token-value');
    expect(call?.json).toEqual({
      model: 'text-embedding-relay',
      input: ['hello'],
    });

    const logs = await harness.db.select().from(harness.schema.proxyLogs).all();
    expect(logs).toEqual([
      expect.objectContaining({
        modelRequested: 'text-embedding-relay',
        status: 'success',
        promptTokens: 4,
        totalTokens: 4,
      }),
    ]);
  });

  it('relays legacy completions requests through the generic surface', async () => {
    const { managedKey } = await harness.seedRoute({ model: 'completion-relay-model' });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/completions',
      respond: {
        json: {
          id: 'cmpl_relay',
          object: 'text_completion',
          model: 'completion-relay-model',
          choices: [
            {
              text: 'legacy completion',
              index: 0,
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 2,
            total_tokens: 7,
          },
        },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/completions',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        model: 'completion-relay-model',
        prompt: 'complete me',
        max_tokens: 8,
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'cmpl_relay',
      choices: [{ text: 'legacy completion' }],
    });

    const call = harness.upstream.calls.find((entry) => entry.url.pathname === '/v1/completions');
    expect(call?.json).toMatchObject({
      model: 'completion-relay-model',
      prompt: 'complete me',
      max_tokens: 8,
      stream: false,
    });
  });

  it('relays image generation JSON payloads and rejects malformed upstream JSON', async () => {
    const { managedKey } = await harness.seedRoute({ model: 'gpt-image-relay' });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/images/generations',
      respond: {
        json: {
          created: 1700000000,
          data: [
            {
              b64_json: 'aW1hZ2U=',
              revised_prompt: 'A tidy route graph',
            },
          ],
        },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/images/generations',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        model: 'gpt-image-relay',
        prompt: 'route graph',
        size: '1024x1024',
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      created: 1700000000,
      data: [
        {
          b64_json: 'aW1hZ2U=',
        },
      ],
    });
    expect(harness.upstream.calls.find((entry) => entry.url.pathname === '/v1/images/generations')?.json)
      .toEqual({
        model: 'gpt-image-relay',
        prompt: 'route graph',
        size: '1024x1024',
      });
  });

  it('rotates through a site endpoint pool when the first endpoint returns a retryable failure', async () => {
    const { site, managedKey } = await harness.seedRoute({
      model: 'endpoint-pool-embedding',
      siteUrl: 'https://panel-only.example.com',
    });
    const firstEndpoint = await harness.db.insert(harness.schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://endpoint-a.example.com',
      enabled: true,
      sortOrder: 0,
    }).returning().get();
    const secondEndpoint = await harness.db.insert(harness.schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://endpoint-b.example.com',
      enabled: true,
      sortOrder: 1,
    }).returning().get();

    harness.upstream
      .add({
        method: 'POST',
        path: (request) => request.url.origin === 'https://endpoint-a.example.com'
          && request.url.pathname === '/v1/embeddings',
        respond: {
          status: 502,
          json: {
            error: {
              message: 'temporary endpoint failure',
              type: 'server_error',
            },
          },
        },
      })
      .add({
        method: 'POST',
        path: (request) => request.url.origin === 'https://endpoint-b.example.com'
          && request.url.pathname === '/v1/embeddings',
        respond: {
          json: {
            object: 'list',
            data: [{ object: 'embedding', index: 0, embedding: [1, 2, 3] }],
            model: 'endpoint-pool-embedding',
            usage: {
              prompt_tokens: 1,
              total_tokens: 1,
            },
          },
        },
      });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        model: 'endpoint-pool-embedding',
        input: 'pool me',
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      object: 'list',
      model: 'endpoint-pool-embedding',
    });
    expect(harness.upstream.calls
      .filter((entry) => entry.url.pathname === '/v1/embeddings')
      .map((entry) => entry.url.origin)).toEqual([
      'https://endpoint-a.example.com',
      'https://endpoint-b.example.com',
    ]);

    const storedFirst = await harness.db.select().from(harness.schema.siteApiEndpoints)
      .where(eq(harness.schema.siteApiEndpoints.id, firstEndpoint.id))
      .get();
    const storedSecond = await harness.db.select().from(harness.schema.siteApiEndpoints)
      .where(eq(harness.schema.siteApiEndpoints.id, secondEndpoint.id))
      .get();
    expect(storedFirst?.lastFailureReason).toContain('HTTP 502');
    expect(storedFirst?.cooldownUntil).toBeTruthy();
    expect(storedSecond?.lastSelectedAt).toBeTruthy();
  });

  it('records a failed proxy log when embeddings upstream candidates are exhausted', async () => {
    const { managedKey, route, target, account } = await harness.seedRoute({ model: 'embedding-failure-model' });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/embeddings',
      respond: {
        status: 502,
        json: {
          error: {
            message: 'embedding backend unavailable',
            type: 'bad_gateway',
          },
        },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        model: 'embedding-failure-model',
        input: ['fail please'],
      },
    });

    expect(response.statusCode, response.body).toBe(503);
    expect(response.json()).toMatchObject({
      error: expect.objectContaining({
        message: expect.stringContaining('No available targets'),
      }),
    });

    const logs = await harness.db.select().from(harness.schema.proxyLogs).all();
    expect(logs.some((log) => log.status === 'failed'
      && log.httpStatus === 502
      && log.routeId === route.id
      && log.targetId === target.id
      && log.accountId === account.id
      && log.downstreamApiKeyId === managedKey.id
      && log.modelRequested === 'embedding-failure-model'
      && String(log.errorMessage || '').includes('embedding backend unavailable'))).toBe(true);
  });
});
