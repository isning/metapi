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

function buildEditBody(boundary: string) {
  return Buffer.from(
    `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="prompt"\r\n\r\n`
      + `polish this image\r\n`
      + `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="image"; filename="source.png"\r\n`
      + `Content-Type: image/png\r\n\r\n`
      + `pngdata\r\n`
      + `--${boundary}--\r\n`,
  );
}

describe('/v1/images/edits relay with scenario upstreams', () => {
  let harness: ProxyRelayHarness;

  beforeAll(async () => {
    harness = await createProxyRelayHarness('metapi-images-edits-relay-');
  });

  beforeEach(async () => {
    await harness.resetData();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('relays multipart edit requests to the upstream edits endpoint', async () => {
    const { managedKey } = await harness.seedRoute({ model: 'gpt-image-1' });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/images/edits',
      respond: {
        json: {
          created: 1700000001,
          data: [{ b64_json: 'aW1hZ2UtZWRpdA==' }],
        },
      },
    });

    const boundary = 'metapi-image-edit-boundary';
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/images/edits',
      headers: {
        'x-api-key': managedKey.key,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: buildEditBody(boundary),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      created: 1700000001,
      data: [{ b64_json: 'aW1hZ2UtZWRpdA==' }],
    });

    const call = harness.upstream.calls.find((entry) => entry.url.pathname === '/v1/images/edits');
    expect(call?.headers.get('authorization')).toBe('Bearer gpt-image-1-token-value');
    expect(call?.bodyText).toBe('[form-data]');
  });

  it('records a failed proxy log when the upstream image edits endpoint returns an error', async () => {
    const { managedKey, route, target, account } = await harness.seedRoute({ model: 'gpt-image-1' });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/images/edits',
      respond: {
        status: 502,
        json: {
          error: {
            message: 'image edit backend unavailable',
            type: 'bad_gateway',
          },
        },
      },
    });

    const boundary = 'metapi-image-edit-failure-boundary';
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/images/edits',
      headers: {
        'x-api-key': managedKey.key,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: buildEditBody(boundary),
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
      && log.modelRequested === 'gpt-image-1'
      && String(log.errorMessage || '').includes('image edit backend unavailable'))).toBe(true);
  });
});
