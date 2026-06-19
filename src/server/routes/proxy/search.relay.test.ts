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

describe('/v1/search relay with scenario upstreams', () => {
  let harness: ProxyRelayHarness;

  beforeAll(async () => {
    harness = await createProxyRelayHarness('metapi-search-relay-');
  });

  beforeEach(async () => {
    await harness.resetData();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('defaults search model, relays max_results, and records proxy log metadata', async () => {
    const { managedKey } = await harness.seedRoute({ model: '__search' });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/search',
      respond: {
        json: {
          object: 'search.result',
          data: [
            {
              title: 'Route graph docs',
              url: 'https://docs.example.com/route-graph',
            },
          ],
        },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/search',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        query: 'route graph',
        max_results: 3,
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      object: 'search.result',
      data: [
        {
          title: 'Route graph docs',
          url: 'https://docs.example.com/route-graph',
        },
      ],
    });

    const call = harness.upstream.calls.find((entry) => entry.url.pathname === '/v1/search');
    expect(call?.headers.get('authorization')).toBe('Bearer __search-token-value');
    expect(call?.json).toEqual({
      query: 'route graph',
      max_results: 3,
      model: '__search',
    });

    const logs = await harness.db.select().from(harness.schema.proxyLogs).all();
    expect(logs).toEqual([
      expect.objectContaining({
        modelRequested: '__search',
        status: 'success',
        httpStatus: 200,
      }),
    ]);
  });

  it('records a failed proxy log when upstream search returns an error', async () => {
    const { managedKey, route, channel, account } = await harness.seedRoute({ model: '__search' });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/search',
      respond: {
        status: 502,
        json: {
          error: {
            message: 'search backend unavailable',
            type: 'bad_gateway',
          },
        },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/search',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        query: 'route graph',
      },
    });

    expect(response.statusCode, response.body).toBe(503);
    expect(response.json()).toMatchObject({
      error: expect.objectContaining({
        message: expect.stringContaining('No available channels'),
      }),
    });

    const logs = await harness.db.select().from(harness.schema.proxyLogs).all();
    expect(logs.some((log) => log.status === 'failed'
      && log.httpStatus === 502
      && log.routeId === route.id
      && log.channelId === channel.id
      && log.accountId === account.id
      && log.downstreamApiKeyId === managedKey.id
      && log.modelRequested === '__search'
      && String(log.errorMessage || '').includes('search backend unavailable'))).toBe(true);
  });
});
