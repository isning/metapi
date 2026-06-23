import { describe, expect, it } from 'vitest';

import { createTestApp } from './appHarness.js';
import { createDirectModelRouteGraph, compileRouteGraphOrThrow } from './routeGraphHarness.js';
import { createUpstreamMock, doneSseChunk, openAiChatCompletionChunk } from './upstreamMock.js';
import { installWebDomHarness } from './webHarness.js';

describe('test harnesses', () => {
  it('creates injectable Fastify apps with admin auth helpers', async () => {
    const handle = await createTestApp({
      auth: 'admin-api',
      env: { AUTH_TOKEN: 'harness-admin-token' },
      routes: [
        async (app) => {
          app.get('/api/harness', async () => ({ ok: true }));
        },
      ],
    });

    try {
      const rejected = await handle.inject({ method: 'GET', url: '/api/harness' });
      expect(rejected.statusCode).toBe(401);

      const accepted = await handle.inject({
        method: 'GET',
        url: '/api/harness',
        headers: handle.adminHeaders(),
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toEqual({ ok: true });
    } finally {
      await handle.close();
    }
  });

  it('records upstream requests and serves protocol fixtures', async () => {
    const upstream = createUpstreamMock([
      {
        method: 'POST',
        path: '/v1/chat/completions',
        respond: {
          sse: [
            openAiChatCompletionChunk({ delta: { content: 'hello' } }),
            doneSseChunk(),
          ],
        },
      },
    ]);

    try {
      const response = await fetch('https://provider.test/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-test', stream: true }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(await response.text()).toContain('chat.completion.chunk');
      expect(upstream.calls).toHaveLength(1);
      expect(upstream.calls[0]?.json).toMatchObject({ model: 'gpt-test' });
    } finally {
      upstream.restore();
    }
  });

  it('builds graph fixtures through the shared compiler contract', () => {
    const result = compileRouteGraphOrThrow(createDirectModelRouteGraph('gpt-harness'));

    expect(result.compiled.publicModels).toEqual(expect.arrayContaining([
      { nodeId: 'entry:test', model: 'gpt-harness' },
    ]));
    expect(result.compiled.terminals).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'endpoint:test', type: 'route_endpoint' }),
    ]));
  });

  it('installs browser DOM seams for web component tests', () => {
    const storage = installWebDomHarness({ token: 'web-token', mediaMatches: true });

    expect(storage.getItem('auth_token')).toBe('web-token');
    expect(globalThis.matchMedia('(min-width: 1px)').matches).toBe(true);
    expect(new ResizeObserver(() => undefined)).toBeTruthy();
  });
});
