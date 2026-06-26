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

describe('/v1/videos relay with persisted public task ids', () => {
  let harness: ProxyRelayHarness;

  beforeAll(async () => {
    harness = await createProxyRelayHarness('metapi-videos-relay-');
  });

  beforeEach(async () => {
    await harness.resetData();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('creates a video task, rewrites the public id, then maps get/delete back to the upstream id', async () => {
    const { managedKey } = await harness.seedRoute({ model: 'video-relay-model' });
    harness.upstream
      .add({
        method: 'POST',
        path: '/v1/videos',
        respond: {
          json: {
            id: 'upstream_video_123',
            object: 'video',
            status: 'queued',
            model: 'video-relay-model',
          },
        },
      })
      .add({
        method: 'GET',
        path: '/v1/videos/upstream_video_123',
        respond: {
          json: {
            id: 'upstream_video_123',
            object: 'video',
            status: 'completed',
            model: 'video-relay-model',
          },
        },
      })
      .add({
        method: 'DELETE',
        path: '/v1/videos/upstream_video_123',
        respond: {
          status: 204,
        },
      });

    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/videos',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        model: 'video-relay-model',
        prompt: 'route graph animation',
      },
    });

    expect(created.statusCode, created.body).toBe(200);
    const createdBody = created.json() as { id: string; status: string };
    expect(createdBody.id).toMatch(/^vid_/);
    expect(createdBody.id).not.toBe('upstream_video_123');
    expect(createdBody.status).toBe('queued');

    const createCall = harness.upstream.calls.find((entry) => entry.url.pathname === '/v1/videos');
    expect(createCall?.headers.get('authorization')).toBe('Bearer video-relay-model-token-value');
    expect(createCall?.json).toMatchObject({
      model: 'video-relay-model',
      prompt: 'route graph animation',
    });

    const fetched = await harness.app.inject({
      method: 'GET',
      url: `/v1/videos/${createdBody.id}`,
      headers: {
        'x-api-key': managedKey.key,
      },
    });
    expect(fetched.statusCode, fetched.body).toBe(200);
    expect(fetched.json()).toMatchObject({
      id: createdBody.id,
      status: 'completed',
      model: 'video-relay-model',
    });

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/videos/${createdBody.id}`,
      headers: {
        'x-api-key': managedKey.key,
      },
    });
    expect(deleted.statusCode, deleted.body).toBe(204);

    const rows = await harness.db.select().from(harness.schema.proxyVideoTasks).all();
    expect(rows).toEqual([]);
    const upstreamPaths = harness.upstream.calls
      .map((entry) => entry.url.pathname)
      .filter((path) => path.startsWith('/v1/videos'));
    expect(upstreamPaths).toEqual([
      '/v1/videos',
      '/v1/videos/upstream_video_123',
      '/v1/videos/upstream_video_123',
    ]);
  });

  it('relays upstream video creation failures without persisting a task mapping', async () => {
    const { managedKey } = await harness.seedRoute({ model: 'video-relay-model' });
    harness.upstream.add({
      method: 'POST',
      path: '/v1/videos',
      respond: {
        status: 500,
        json: {
          error: {
            message: 'video backend exploded',
            type: 'server_error',
          },
        },
      },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/videos',
      headers: {
        'x-api-key': managedKey.key,
      },
      payload: {
        model: 'video-relay-model',
        prompt: 'route graph animation',
      },
    });

    expect(response.statusCode, response.body).toBe(503);
    expect(response.json()).toMatchObject({
      error: expect.objectContaining({
        message: expect.stringContaining('No available channels'),
      }),
    });
    expect(await harness.db.select().from(harness.schema.proxyVideoTasks).all()).toEqual([]);
  });
});
