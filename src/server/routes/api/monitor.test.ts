import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';
import { createUpstreamMock, type UpstreamMockHandle } from '../../../testing/upstreamMock.js';

type DbModule = typeof import('../../db/index.js');
type ConfigModule = typeof import('../../config.js');

describe('monitor routes', () => {
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let config: ConfigModule['config'];
  let dataDir = '';
  let originalAuthToken = '';
  let upstream: UpstreamMockHandle | null = null;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-monitor-routes-'));
    process.env.DATA_DIR = dataDir;

    await import('../../db/migrate.js');
    const dbModule = await import('../../db/index.js');
    const configModule = await import('../../config.js');
    const routesModule = await import('./monitor.js');
    db = dbModule.db;
    schema = dbModule.schema;
    config = configModule.config;
    originalAuthToken = config.authToken;

    app = Fastify();
    await app.register(routesModule.monitorRoutes);
  });

  beforeEach(async () => {
    upstream?.restore();
    upstream = null;
    config.authToken = 'monitor-admin-token';
    await db.delete(schema.settings).run();
  });

  afterAll(async () => {
    upstream?.restore();
    config.authToken = originalAuthToken;
    await app.close();
    delete process.env.DATA_DIR;
  });

  it('rejects malformed monitor config payloads at the route boundary', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/monitor/config',
      payload: {
        ldohCookie: 123,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      message: 'Invalid ldohCookie. Expected string or null.',
    });
  });

  it('accepts null monitor cookie payloads and clears the stored cookie', async () => {
    const saveResponse = await app.inject({
      method: 'PUT',
      url: '/api/monitor/config',
      payload: {
        ldohCookie: 'ld_auth_session=abcdefghijklmnopqrstuvwxyz',
      },
    });
    expect(saveResponse.statusCode).toBe(200);

    const clearResponse = await app.inject({
      method: 'PUT',
      url: '/api/monitor/config',
      payload: {
        ldohCookie: null,
      },
    });

    expect(clearResponse.statusCode).toBe(200);
    expect(clearResponse.json()).toMatchObject({
      success: true,
      ldohCookieConfigured: false,
    });

    const saved = await db.select().from(schema.settings)
      .where(eq(schema.settings.key, 'monitor_ldoh_cookie'))
      .get();
    expect(saved?.value).toBe('""');
  });

  it('rejects ldoh proxy requests without a monitor session cookie before contacting upstream', async () => {
    upstream = createUpstreamMock();

    const response = await app.inject({
      method: 'GET',
      url: '/monitor-proxy/ldoh/dashboard',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Missing or invalid monitor session' });
    expect(upstream.calls).toHaveLength(0);
  });

  it('rejects ldoh proxy requests when the ldoh cookie is not configured', async () => {
    upstream = createUpstreamMock();

    const response = await app.inject({
      method: 'GET',
      url: '/monitor-proxy/ldoh/dashboard',
      headers: {
        cookie: 'meta_monitor_auth=monitor-admin-token',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toBe('LDOH cookie not configured');
    expect(upstream.calls).toHaveLength(0);
  });

  it('forwards ldoh proxy requests with the stored ldoh cookie and rewrites upstream links', async () => {
    upstream = createUpstreamMock([
      {
        method: 'GET',
        path: '/dashboard?tab=models',
        respond: {
          status: 302,
          headers: {
            location: 'https://ldoh.105117.xyz/login',
            'content-type': 'text/html; charset=utf-8',
          },
          text: '<html><a href="/api/models">models</a><script src="/_next/static/app.js"></script></html>',
        },
      },
    ]);
    await db.insert(schema.settings).values({
      key: 'monitor_ldoh_cookie',
      value: JSON.stringify('ld_auth_session=abcdefghijklmnopqrstuvwxyz'),
    }).run();

    const response = await app.inject({
      method: 'GET',
      url: '/monitor-proxy/ldoh/dashboard?tab=models',
      headers: {
        cookie: 'meta_monitor_auth=monitor-admin-token',
        accept: 'text/html',
        'user-agent': 'monitor-test-agent',
      },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/monitor-proxy/ldoh/login');
    expect(response.body).toContain('href="/monitor-proxy/ldoh/api/models"');
    expect(response.body).toContain('src="/monitor-proxy/ldoh/_next/static/app.js"');
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]?.url.href).toBe('https://ldoh.105117.xyz/dashboard?tab=models');
    expect(upstream.calls[0]?.headers.get('cookie')).toBe('ld_auth_session=abcdefghijklmnopqrstuvwxyz');
    expect(upstream.calls[0]?.headers.get('user-agent')).toBe('monitor-test-agent');
  });
});
