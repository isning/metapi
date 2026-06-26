import { describe, expect, it } from 'vitest';

import { bootIsolatedRuntimeDb } from '../../../testing/dbHarness.js';

describe('admin and proxy auth boundary', () => {
  it('protects admin API routes with the shared app harness', async () => {
    const { createTestApp } = await import('../../../testing/appHarness.js');
    const app = await createTestApp({
      auth: 'admin-api',
      env: { AUTH_TOKEN: 'admin-boundary-token' },
      routes: [
        async (fastify) => {
          fastify.get('/api/protected-boundary', async () => ({ ok: true }));
          fastify.get('/api/auth/login', async () => ({ login: true }));
        },
      ],
    });

    try {
      const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
      expect(login.statusCode).toBe(200);
      expect(login.json()).toEqual({ login: true });

      const missing = await app.inject({ method: 'GET', url: '/api/protected-boundary' });
      expect(missing.statusCode).toBe(401);
      expect(missing.json()).toEqual({ error: 'Missing Authorization header' });

      const invalid = await app.inject({
        method: 'GET',
        url: '/api/protected-boundary',
        headers: { authorization: 'Bearer wrong-token' },
      });
      expect(invalid.statusCode).toBe(403);
      expect(invalid.json()).toEqual({ error: 'Invalid token' });

      const accepted = await app.inject({
        method: 'GET',
        url: '/api/protected-boundary',
        headers: app.adminHeaders(),
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

  it('protects proxy routes across bearer, api-key, google api-key, and query credentials', async () => {
    const runtimeDb = await bootIsolatedRuntimeDb('metapi-proxy-auth-boundary-');
    const { createTestApp } = await import('../../../testing/appHarness.js');
    const app = await createTestApp({
      auth: 'proxy',
      env: {
        DATA_DIR: runtimeDb.path,
        DB_TYPE: 'sqlite',
        PROXY_TOKEN: 'proxy-boundary-token',
      },
      routes: [
        async (fastify) => {
          fastify.all('/v1/proxy-boundary', async () => ({ ok: true }));
        },
      ],
    });

    try {
      const missing = await app.inject({ method: 'POST', url: '/v1/proxy-boundary' });
      expect(missing.statusCode).toBe(401);
      expect(missing.json()).toEqual({
        error: 'Missing Authorization, x-api-key, x-goog-api-key, or key query parameter',
      });

      const invalid = await app.inject({
        method: 'POST',
        url: '/v1/proxy-boundary',
        headers: { authorization: 'Bearer wrong-token' },
      });
      expect(invalid.statusCode).toBe(403);
      expect(invalid.json()).toEqual({ error: 'Invalid API key' });

      for (const credentials of [
        { authorization: 'Bearer proxy-boundary-token' },
        { 'x-api-key': 'proxy-boundary-token' },
        { 'x-goog-api-key': 'proxy-boundary-token' },
      ]) {
        const accepted = await app.inject({
          method: 'POST',
          url: '/v1/proxy-boundary',
          headers: credentials,
        });
        expect(accepted.statusCode).toBe(200);
        expect(accepted.json()).toEqual({ ok: true });
      }

      const queryAccepted = await app.inject({
        method: 'POST',
        url: '/v1/proxy-boundary?key=proxy-boundary-token',
      });
      expect(queryAccepted.statusCode).toBe(200);
      expect(queryAccepted.json()).toEqual({ ok: true });
    } finally {
      await app.close();
      await runtimeDb.cleanup();
    }
  }, 15_000);

  it('rejects disabled and expired managed proxy keys before proxy route handlers run', async () => {
    const runtimeDb = await bootIsolatedRuntimeDb('metapi-managed-proxy-auth-');
    const { createTestApp } = await import('../../../testing/appHarness.js');
    const app = await createTestApp({
      auth: 'proxy',
      env: {
        DATA_DIR: runtimeDb.path,
        DB_TYPE: 'sqlite',
        PROXY_TOKEN: 'global-proxy-token',
      },
      routes: [
        async (fastify) => {
          fastify.get('/v1/managed-key-boundary', async () => ({ ok: true }));
        },
      ],
    });

    try {
      await runtimeDb.db.insert(runtimeDb.schema.downstreamApiKeys).values([
        {
          name: 'disabled-key',
          key: 'sk-disabled-managed',
          enabled: false,
        },
        {
          name: 'expired-key',
          key: 'sk-expired-managed',
          enabled: true,
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        },
      ]).run();

      const disabled = await app.inject({
        method: 'GET',
        url: '/v1/managed-key-boundary',
        headers: { authorization: 'Bearer sk-disabled-managed' },
      });
      expect(disabled.statusCode).toBe(403);
      expect(disabled.json()).toEqual({ error: 'API key is disabled' });

      const expired = await app.inject({
        method: 'GET',
        url: '/v1/managed-key-boundary',
        headers: { authorization: 'Bearer sk-expired-managed' },
      });
      expect(expired.statusCode).toBe(403);
      expect(expired.json()).toEqual({ error: 'API key is expired' });

      const acceptedGlobal = await app.inject({
        method: 'GET',
        url: '/v1/managed-key-boundary',
        headers: { authorization: 'Bearer global-proxy-token' },
      });
      expect(acceptedGlobal.statusCode).toBe(200);
      expect(acceptedGlobal.json()).toEqual({ ok: true });
    } finally {
      await app.close();
      await runtimeDb.cleanup();
    }
  }, 15_000);

  it('enforces the configured request body limit at the shared app boundary', async () => {
    const { createTestApp } = await import('../../../testing/appHarness.js');
    const app = await createTestApp({
      fastifyOptions: {
        bodyLimit: 32,
      },
      routes: [
        async (fastify) => {
          fastify.post('/api/body-limit-boundary', async (request) => ({
            ok: true,
            size: JSON.stringify(request.body).length,
          }));
        },
      ],
    });

    try {
      const accepted = await app.inject({
        method: 'POST',
        url: '/api/body-limit-boundary',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ v: 'small' }),
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toMatchObject({ ok: true });

      const rejected = await app.inject({
        method: 'POST',
        url: '/api/body-limit-boundary',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ v: 'x'.repeat(128) }),
      });
      expect(rejected.statusCode).toBe(413);
      expect(rejected.json()).toMatchObject({
        error: 'Payload Too Large',
      });
    } finally {
      await app.close();
    }
  });
});
