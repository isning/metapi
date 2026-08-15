import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { Sub2ApiAdapter } from './sub2api.js';
import type { PlatformCredentialContext } from './base.js';

function accountContext(baseUrl: string, credential: string): PlatformCredentialContext {
  return {
    endpoint: { baseUrl },
    account: { id: null, siteId: null, username: null, mode: 'session', credential, credentialKind: 'access_token', extraConfig: null },
    token: null,
  };
}

function modelContext(baseUrl: string, token: string): PlatformCredentialContext {
  return {
    ...accountContext(baseUrl, ''),
    account: { ...accountContext(baseUrl, '').account, mode: 'apikey' },
    token: { id: null, accountId: null, token, enabled: true, extraConfig: null },
  };
}

describe('Sub2ApiAdapter', () => {
  let server: ReturnType<typeof createServer> | undefined;
  let baseUrl: string;
  let adapter: Sub2ApiAdapter;

  beforeEach(() => {
    adapter = new Sub2ApiAdapter();
  });

  afterEach(async () => {
    if (server) {
      const s = server;
      server = undefined;
      await new Promise<void>((resolve, reject) => {
        s.close((err?: Error) => (err ? reject(err) : resolve()));
      });
    }
  });

  function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void) {
    return new Promise<void>((resolve) => {
      server = createServer(handler);
      server.listen(0, '127.0.0.1', () => {
        const addr = server!.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  }

  it('detects sub2api from URL', async () => {
    expect(await adapter.detect('https://sub2api.example.com')).toBe(true);
  });

  it('detects sub2api by auth/me unauthorized envelope even without sub2api domain', async () => {
    await startServer((req, res) => {
      if (req.url === '/api/v1/auth/me') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 'UNAUTHORIZED',
          message: 'Authorization header is required',
        }));
        return;
      }
      if (req.url === '/v1/models') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 'API_KEY_REQUIRED',
          message: 'API key is required',
        }));
        return;
      }
      res.writeHead(404).end();
    });

    expect(await adapter.detect(baseUrl)).toBe(true);
  });

  it('does not mis-detect generic json 401 responses', async () => {
    await startServer((req, res) => {
      if (req.url === '/api/v1/auth/me' || req.url === '/v1/models') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>Not Sub2</title></head><body></body></html>');
    });

    expect(await adapter.detect(baseUrl)).toBe(false);
  });

  it('returns unsupported for checkin', async () => {
    const result = await adapter.checkin(accountContext('http://localhost', 'token'));
    expect(result.success).toBe(false);
    expect(result.message).toContain('not supported');
  });

  it('fetches balance from /api/v1/auth/me', async () => {
    await startServer((req, res) => {
      if (req.url === '/api/v1/auth/me') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          message: 'success',
          data: { id: 1, username: 'testuser', email: 'test@example.com', balance: 12.5 },
        }));
        return;
      }
      res.writeHead(404).end();
    });

    const balance = await adapter.getBalance(accountContext(baseUrl, 'jwt-token'));
    expect(balance.balance).toBeGreaterThan(0);
    expect(balance.used).toBe(0);
  });

  it('includes subscription summary from /api/v1/subscriptions/summary when available', async () => {
    await startServer((req, res) => {
      if (req.url === '/api/v1/auth/me') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          message: 'success',
          data: { id: 1, username: 'testuser', email: 'test@example.com', balance: 12.5 },
        }));
        return;
      }
      if (req.url === '/api/v1/subscriptions/summary') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          message: 'success',
          data: {
            active_count: 1,
            total_used_usd: 3.75,
            subscriptions: [
              {
                id: 3,
                group_name: 'Pro',
                status: 'active',
                expires_at: '2026-04-01T00:00:00Z',
                monthly_used_usd: 3.75,
                monthly_limit_usd: 20,
              },
            ],
          },
        }));
        return;
      }
      res.writeHead(404).end();
    });

    const balance = await adapter.getBalance(accountContext(baseUrl, 'jwt-token'));
    expect(balance.subscriptionSummary).toEqual({
      activeCount: 1,
      totalUsedUsd: 3.75,
      subscriptions: [
        {
          id: 3,
          groupName: 'Pro',
          status: 'active',
          expiresAt: '2026-04-01T00:00:00.000Z',
          monthlyUsedUsd: 3.75,
          monthlyLimitUsd: 20,
        },
      ],
    });
  });

  it('falls back to active subscriptions when summary endpoint is unavailable', async () => {
    await startServer((req, res) => {
      if (req.url === '/api/v1/auth/me') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          message: 'success',
          data: { id: 1, username: 'testuser', email: 'test@example.com', balance: 12.5 },
        }));
        return;
      }
      if (req.url === '/api/v1/subscriptions/summary') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 404, message: 'not found' }));
        return;
      }
      if (req.url === '/api/v1/subscriptions/active') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          message: 'success',
          data: [
            {
              id: 9,
              group_name: 'Fallback',
              expires_at: '2026-05-01T00:00:00Z',
              monthly_used_usd: 2.5,
              monthly_limit_usd: 15,
            },
          ],
        }));
        return;
      }
      res.writeHead(404).end();
    });

    const balance = await adapter.getBalance(accountContext(baseUrl, 'jwt-token'));
    expect(balance.subscriptionSummary).toEqual({
      activeCount: 1,
      totalUsedUsd: 2.5,
      subscriptions: [
        {
          id: 9,
          groupName: 'Fallback',
          expiresAt: '2026-05-01T00:00:00.000Z',
          monthlyUsedUsd: 2.5,
          monthlyLimitUsd: 15,
        },
      ],
    });
  });

  it('fetches user info from /api/v1/auth/me', async () => {
    await startServer((req, res) => {
      if (req.url === '/api/v1/auth/me') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          message: 'success',
          data: { id: 1, username: 'testuser', email: 'test@example.com', balance: 5.0 },
        }));
        return;
      }
      res.writeHead(404).end();
    });

    const userInfo = await adapter.getUserInfo(accountContext(baseUrl, 'jwt-token'));
    expect(userInfo).not.toBeNull();
    expect(userInfo!.username).toBe('testuser');
  });

  it('falls back to email local part when username is empty', async () => {
    await startServer((req, res) => {
      if (req.url === '/api/v1/auth/me') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          message: 'success',
          data: { id: 1, username: '', email: 'alice@example.com', balance: 0 },
        }));
        return;
      }
      res.writeHead(404).end();
    });

    const userInfo = await adapter.getUserInfo(accountContext(baseUrl, 'jwt-token'));
    expect(userInfo!.username).toBe('alice');
  });

  it('fetches models via /v1/models', async () => {
    await startServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: [{ id: 'gpt-4o' }, { id: 'claude-3-opus' }],
        }));
        return;
      }
      res.writeHead(404).end();
    });

    const models = await adapter.getModels(modelContext(baseUrl, 'jwt-token'));
    expect(models).toEqual(['gpt-4o', 'claude-3-opus']);
  });

  it('fetches gemini models via /v1beta/models when ai base url already targets gemini endpoint', async () => {
    await startServer((req, res) => {
      if (req.url === '/v1beta/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          models: [
            { name: 'models/gemini-2.5-flash' },
            { name: 'models/gemini-2.5-pro' },
          ],
        }));
        return;
      }
      res.writeHead(404).end();
    });

    const models = await adapter.getModels(modelContext(`${baseUrl}/v1beta`, 'gemini-key'));
    expect(models).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
  });

  it('falls back to /v1beta/models when openai-compatible models APIs are unavailable', async () => {
    await startServer((req, res) => {
      if (req.url === '/v1/models' || req.url === '/api/v1/models') {
        res.writeHead(404).end();
        return;
      }
      if (req.url === '/v1beta/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          models: [
            { name: 'models/gemini-2.5-flash-lite' },
            { name: 'models/gemini-3-pro-preview' },
          ],
        }));
        return;
      }
      res.writeHead(404).end();
    });

    const models = await adapter.getModels(modelContext(baseUrl, 'gemini-key'));
    expect(models).toEqual(['gemini-2.5-flash-lite', 'gemini-3-pro-preview']);
  });

  it('uses the api/v1 models API directly when the ai base already includes /api/v1', async () => {
    await startServer((req, res) => {
      if (req.url === '/api/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: [{ id: 'gpt-4o-mini' }, { id: 'claude-3-5-sonnet' }],
        }));
        return;
      }
      res.writeHead(404).end();
    });

    const models = await adapter.getModels(modelContext(`${baseUrl}/api/v1`, 'jwt-token'));
    expect(models).toEqual(['gpt-4o-mini', 'claude-3-5-sonnet']);
  });

  it('does not turn a rejected model credential into a management-key lookup', async () => {
    const urls: string[] = [];
    await startServer((req, res) => {
      urls.push(req.url || '');
      const auth = req.headers.authorization || '';
      if (req.url === '/v1/models' && auth === 'Bearer jwt-token') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 'API_KEY_REQUIRED',
          message: 'API key is required',
        }));
        return;
      }
      res.writeHead(404).end();
    });

    const models = await adapter.getModels(modelContext(baseUrl, 'jwt-token'));
    expect(models).toEqual([]);
    expect(urls).toEqual([
      '/v1/models',
      '/api/v1/models',
      '/v1beta/models',
      '/antigravity/v1beta/models',
    ]);
    expect(urls.some((url) => url.startsWith('/api/v1/keys'))).toBe(false);
  });

  it('handles non-zero code as error in /api/v1/auth/me', async () => {
    await startServer((req, res) => {
      if (req.url === '/api/v1/auth/me') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 401,
          message: 'token expired',
          data: null,
        }));
        return;
      }
      res.writeHead(404).end();
    });

    await expect(adapter.getBalance(accountContext(baseUrl, 'expired-token'))).rejects.toThrow();
  });

  it('login returns unsupported', async () => {
    const result = await adapter.login('http://localhost', 'user', 'pass');
    expect(result.success).toBe(false);
  });

  it('accepts bearer-prefixed access tokens when verifying session tokens', async () => {
    await startServer((req, res) => {
      if (req.url === '/api/v1/auth/me') {
        const auth = req.headers.authorization || '';
        if (auth !== 'Bearer jwt-token') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 401, message: 'unauthorized' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          message: 'success',
          data: { id: 1, username: 'testuser', email: 'test@example.com', balance: 5.0 },
        }));
        return;
      }
      res.writeHead(404).end();
    });

    const result = await adapter.verifyToken(accountContext(baseUrl, 'Bearer jwt-token'));
    expect(result.tokenType).toBe('session');
    expect(result.userInfo?.username).toBe('testuser');
  });

  it('lists api keys when access token includes Bearer prefix', async () => {
    await startServer((req, res) => {
      if (req.url === '/api/v1/keys?page=1&page_size=100') {
        const auth = req.headers.authorization || '';
        if (auth !== 'Bearer jwt-token') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 401, message: 'unauthorized' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          message: 'success',
          data: {
            items: [
              { id: 11, key: 'sk-active', name: 'default', status: 'active' },
            ],
          },
        }));
        return;
      }
      res.writeHead(404).end();
    });

    const tokens = await adapter.getApiTokens(accountContext(baseUrl, 'Bearer jwt-token'));
    expect(tokens).toEqual([{ key: 'sk-active', name: 'default', enabled: true }]);
  });

  it('lists api keys from /api/v1/keys and picks active key as default api token', async () => {
    await startServer((req, res) => {
      if (req.url === '/api/v1/keys?page=1&page_size=100') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          message: 'success',
          data: {
            items: [
              { id: 10, key: 'sk-disabled', name: 'old', status: 'inactive' },
              { id: 11, key: 'sk-active', name: 'default', status: 'active' },
            ],
          },
        }));
        return;
      }
      res.writeHead(404).end();
    });

    const tokens = await adapter.getApiTokens(accountContext(baseUrl, 'jwt-token'));
    expect(tokens).toEqual([
      { key: 'sk-disabled', name: 'old', enabled: false },
      { key: 'sk-active', name: 'default', enabled: true },
    ]);
    expect(await adapter.getApiToken(accountContext(baseUrl, 'jwt-token'))).toBe('sk-active');
  });

  it('fetches user groups from /api/v1/groups', async () => {
    await startServer((req, res) => {
      if (req.url === '/api/v1/groups?page=1&page_size=100') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          message: 'success',
          data: {
            items: [
              { id: 1, name: 'default' },
              { id: 2, name: 'vip' },
            ],
          },
        }));
        return;
      }
      res.writeHead(404).end();
    });

    const groups = await adapter.getUserGroups(accountContext(baseUrl, 'jwt-token'));
    expect(groups).toEqual(['1', '2']);
  });

  it('fetches user groups from /api/v1/groups/available', async () => {
    await startServer((req, res) => {
      if (req.url === '/api/v1/groups/available') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          message: 'success',
          data: [
            { id: 5, name: 'basic' },
            { id: 6, name: 'pro' },
          ],
        }));
        return;
      }
      res.writeHead(404).end();
    });

    const groups = await adapter.getUserGroups(accountContext(baseUrl, 'jwt-token'));
    expect(groups).toEqual(['5', '6']);
  });

  it('builds a group-aware upstream pricing catalog from the user APIs', async () => {
    await startServer((req, res) => {
      if (req.headers.authorization !== 'Bearer jwt-token') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 401, message: 'unauthorized' }));
        return;
      }
      const responses: Record<string, unknown> = {
        '/api/v1/groups/available': {
          code: 0,
          data: [
            { id: 10, name: 'standard', rate_multiplier: 1 },
            { id: 20, name: 'premium', rate_multiplier: 1.5 },
          ],
        },
        '/api/v1/groups/rates': { code: 0, data: { '20': 1.2 } },
        '/api/v1/channels/available': {
          code: 0,
          data: [{
            name: 'OpenAI',
            platforms: [{
              groups: [{ id: 10 }, { id: 20 }],
              supported_models: [{
                name: 'gpt-4o',
                pricing: {
                  billing_mode: 'token',
                  input_price: 0.0000025,
                  output_price: 0.00001,
                  cache_read_price: 0.00000125,
                  cache_write_price: 0.00000375,
                },
              }],
            }],
          }],
        },
      };
      const body = responses[req.url || ''];
      if (!body) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });

    const catalog = await adapter.getPricingCatalog(accountContext(baseUrl, 'Bearer jwt-token'));

    expect(catalog?.groupRatio).toEqual({ default: 1, '10': 1, '20': 1.2 });
    expect(catalog?.models.get('gpt-4o')).toMatchObject({
      enableGroups: ['10', '20'],
      groupPrices: {
        '10': { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 3.75 },
        '20': { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 3.75 },
      },
    });
  });

  it('preserves Sub2API per-request pricing in the upstream catalog', async () => {
    await startServer((req, res) => {
      const responses: Record<string, unknown> = {
        '/api/v1/groups/available': { code: 0, data: [{ id: 10, rate_multiplier: 2 }] },
        '/api/v1/groups/rates': { code: 0, data: {} },
        '/api/v1/channels/available': { code: 0, data: [{ platforms: [{
          groups: [{ id: 10 }],
          supported_models: [{
            name: 'image-model',
            pricing: { billing_mode: 'per_request', per_request_price: 0.04 },
          }],
        }] }] },
      };
      const body = responses[req.url || ''];
      if (!body) return void res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });

    const catalog = await adapter.getPricingCatalog(accountContext(baseUrl, 'jwt-token'));
    expect(catalog?.models.get('image-model')).toMatchObject({
      quotaType: 1,
      modelPrice: 0.04,
      groupPrices: { '10': 0.04 },
    });
  });

  it('falls back to infer groups from /api/v1/keys when group endpoint is unavailable', async () => {
    await startServer((req, res) => {
      if (req.url === '/api/v1/groups?page=1&page_size=100') {
        res.writeHead(404).end();
        return;
      }
      if (req.url === '/api/v1/groups') {
        res.writeHead(404).end();
        return;
      }
      if (req.url === '/api/v1/group?page=1&page_size=100') {
        res.writeHead(404).end();
        return;
      }
      if (req.url === '/api/v1/group') {
        res.writeHead(404).end();
        return;
      }
      if (req.url === '/api/v1/keys?page=1&page_size=100') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          message: 'success',
          data: {
            items: [
              { id: 11, key: 'sk-1', group_id: 7, status: 'active' },
              { id: 12, key: 'sk-2', group_id: 7, status: 'inactive' },
              { id: 13, key: 'sk-3', group_id: 9, status: 'active' },
            ],
          },
        }));
        return;
      }
      res.writeHead(404).end();
    });

    const groups = await adapter.getUserGroups(accountContext(baseUrl, 'jwt-token'));
    expect(groups).toEqual(['7', '9']);
  });

  it('creates api key via /api/v1/keys', async () => {
    await startServer((req, res) => {
      if (req.url === '/api/v1/keys' && req.method === 'POST') {
        let rawBody = '';
        req.on('data', (chunk) => { rawBody += chunk; });
        req.on('end', () => {
          const body = JSON.parse(rawBody || '{}');
          expect(body.name).toBe('metapi-e2e');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            code: 0,
            message: 'success',
            data: {
              id: 1,
              key: 'sk-created',
              name: body.name,
            },
          }));
        });
        return;
      }
      res.writeHead(404).end();
    });

    const created = await adapter.createApiToken({ ...accountContext(baseUrl, 'jwt-token'), options: { name: 'metapi-e2e' } });
    expect(created).toBe(true);
  });

  it('deletes api key by key value via /api/v1/keys/:id', async () => {
    await startServer((req, res) => {
      if (req.url === '/api/v1/keys?page=1&page_size=100') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          message: 'success',
          data: {
            items: [
              { id: 31, key: 'sk-delete-me', name: 'to-delete', status: 'active' },
            ],
          },
        }));
        return;
      }
      if (req.url === '/api/v1/keys/31' && req.method === 'DELETE') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          message: 'success',
          data: { id: 31 },
        }));
        return;
      }
      res.writeHead(404).end();
    });

    const deleted = await adapter.deleteApiToken({ ...accountContext(baseUrl, 'jwt-token'), token: modelContext(baseUrl, 'sk-delete-me').token });
    expect(deleted).toBe(true);
  });

  it('normalizes announcements from /api/v1/announcements', async () => {
    await startServer((req, res) => {
      if (req.url === '/api/v1/announcements?page=1&page_size=100') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          message: 'success',
          data: {
            items: [
              {
                id: 11,
                title: 'Maintenance',
                content: 'Window starts at 10:00',
                starts_at: '2026-03-20T10:00:00Z',
                ends_at: '2026-03-20T12:00:00Z',
                created_at: '2026-03-20T09:00:00Z',
                updated_at: '2026-03-20T09:30:00Z',
              },
              {
                id: 12,
                title: 'New model online',
                content: 'gpt-4.1 is available',
                read_at: '2026-03-20T12:05:00Z',
                created_at: '2026-03-20T12:00:00Z',
                updated_at: '2026-03-20T12:01:00Z',
              },
            ],
          },
        }));
        return;
      }
      res.writeHead(404).end();
    });

    const rows = await adapter.getSiteAnnouncements(accountContext(baseUrl, 'jwt-token'));

    expect(rows).toEqual([
      {
        sourceKey: 'announcement:11',
        title: 'Maintenance',
        content: 'Window starts at 10:00',
        level: 'info',
        startsAt: '2026-03-20T10:00:00Z',
        endsAt: '2026-03-20T12:00:00Z',
        upstreamCreatedAt: '2026-03-20T09:00:00Z',
        upstreamUpdatedAt: '2026-03-20T09:30:00Z',
        rawPayload: {
          id: 11,
          title: 'Maintenance',
          content: 'Window starts at 10:00',
          starts_at: '2026-03-20T10:00:00Z',
          ends_at: '2026-03-20T12:00:00Z',
          created_at: '2026-03-20T09:00:00Z',
          updated_at: '2026-03-20T09:30:00Z',
        },
      },
      {
        sourceKey: 'announcement:12',
        title: 'New model online',
        content: 'gpt-4.1 is available',
        level: 'info',
        upstreamCreatedAt: '2026-03-20T12:00:00Z',
        upstreamUpdatedAt: '2026-03-20T12:01:00Z',
        rawPayload: {
          id: 12,
          title: 'New model online',
          content: 'gpt-4.1 is available',
          read_at: '2026-03-20T12:05:00Z',
          created_at: '2026-03-20T12:00:00Z',
          updated_at: '2026-03-20T12:01:00Z',
        },
      },
    ]);
  });
});
