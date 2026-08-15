import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { clearRouteGroupMemberTestData } from '../../../testing/routeGroupMemberTestUtils.js';
import { waitForBackgroundTaskToReachTerminalState } from '../../test-fixtures/backgroundTaskTestUtils.js';

const verifyTokenMock = vi.fn();
const getModelsMock = vi.fn();
const getApiTokensMock = vi.fn();

vi.mock('../../services/platforms/index.js', () => ({
  getAdapter: (platform: string) => platform === 'unsupported' ? undefined : ({
    verifyToken: (...args: unknown[]) => verifyTokenMock(...args),
    getModels: (...args: unknown[]) => getModelsMock(...args),
    getApiTokens: (...args: unknown[]) => getApiTokensMock(...args),
    credentialCapabilities: platform === 'openai'
      ? { session: false, apiKey: true, sessionCredentialOptions: [] }
      : {
          session: true,
          apiKey: true,
          sessionCredentialOptions: platform === 'anyrouter'
            ? [{ kind: 'session_cookie' }, { kind: 'access_token' }]
            : [{ kind: 'access_token' }],
        },
    accountConnectionFields: platform === 'sub2api'
      ? [
          { key: 'sub2apiAuth.refreshToken', inputType: 'password', storagePath: 'sub2apiAuth.refreshToken', secret: true },
          { key: 'sub2apiAuth.tokenExpiresAt', inputType: 'number', storagePath: 'sub2apiAuth.tokenExpiresAt' },
        ]
      : [],
  }),
}));

type DbModule = typeof import('../../db/index.js');
type BackgroundTaskModule = typeof import('../../services/backgroundTaskService.js');

describe('accounts credential mode', { timeout: 15_000 }, () => {
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let resetBackgroundTasks: BackgroundTaskModule['__resetBackgroundTasksForTests'];
  let getBackgroundTask: BackgroundTaskModule['getBackgroundTask'];
  let listBackgroundTasks: BackgroundTaskModule['listBackgroundTasks'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-accounts-credential-mode-'));
    process.env.DATA_DIR = dataDir;

    await import('../../db/migrate.js');
    const dbModule = await import('../../db/index.js');
    const routesModule = await import('./accounts.js');
    const backgroundTaskModule = await import('../../services/backgroundTaskService.js');
    db = dbModule.db;
    schema = dbModule.schema;
    resetBackgroundTasks = backgroundTaskModule.__resetBackgroundTasksForTests;
    getBackgroundTask = backgroundTaskModule.getBackgroundTask;
    listBackgroundTasks = backgroundTaskModule.listBackgroundTasks;

    app = Fastify();
    await app.register(routesModule.accountsRoutes);
  });

  beforeEach(async () => {
    verifyTokenMock.mockReset();
    getModelsMock.mockReset();
    getApiTokensMock.mockReset();
    getApiTokensMock.mockResolvedValue([]);
    resetBackgroundTasks();

    await db.delete(schema.proxyLogs).run();
    await db.delete(schema.checkinLogs).run();
    await clearRouteGroupMemberTestData();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.tokenModelAvailability).run();
    await db.delete(schema.modelAvailability).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterEach(async () => {
    const tasks = listBackgroundTasks(200);
    await Promise.all(tasks.map((task) => waitForBackgroundTaskToReachTerminalState(
      getBackgroundTask,
      task.id,
      { timeoutMs: 10_000, pollMs: 5 },
    )));
    resetBackgroundTasks();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DATA_DIR;
  });

  it('rejects model-key fields from connection credential verification', async () => {

    const site = await db.insert(schema.sites).values({
      name: 'Fast Verify Site',
      url: 'https://fast-verify.example.com',
      platform: 'new-api',
    }).returning().get();

    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts/verify-token',
      payload: {
        siteId: site.id,
        apiKey: 'sk-fast-verify',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      message: 'Connection credential verification only accepts credential and credentialKind.',
    });
    expect(verifyTokenMock).not.toHaveBeenCalled();
  });

  it('requires an explicit Session Cookie or Access Token choice for AnyRouter-style sessions', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Explicit Credential Kind Site',
      url: 'https://explicit-kind.example.com',
      platform: 'anyrouter',
    }).returning().get();

    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts/verify-token',
      payload: {
        siteId: site.id,
        credential: 'session=value',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: false,
      message: '请选择连接凭据类型：Session Cookie 或 Access Token。',
    });
    expect(verifyTokenMock).not.toHaveBeenCalled();
  });

  it('derives API-key account health from observed enabled token health', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'API Key Health Site',
      url: 'https://api-key-health.example.com',
      platform: 'new-api',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'api-key-health',
      credentialMode: 'apikey',
      credential: '',
      credentialKind: 'none',
      status: 'active',
    }).returning().get();
    const healthy = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'healthy',
      token: 'sk-health-1',
      enabled: true,
      isDefault: true,
    }).returning().get();
    const unhealthy = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'unhealthy',
      token: 'sk-health-2',
      enabled: true,
      isDefault: false,
    }).returning().get();
    const disabled = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'disabled',
      token: 'sk-health-3',
      enabled: false,
      isDefault: false,
    }).returning().get();
    await db.insert(schema.accountTokenHealth).values([
      { tokenId: healthy.id, state: 'healthy', reason: 'proxy ok', source: 'proxy-observation' },
      { tokenId: unhealthy.id, state: 'unhealthy', reason: '401', source: 'proxy-auth' },
      { tokenId: disabled.id, state: 'unhealthy', reason: '401', source: 'proxy-auth' },
    ]).run();

    const response = await app.inject({ method: 'GET', url: '/api/accounts?refresh=1' });
    expect(response.statusCode).toBe(200);
    const listed = response.json().accounts.find((item: { id: number }) => item.id === account.id);
    expect(listed.apiKeyHealth).toMatchObject({ state: 'degraded', source: 'token-aggregate' });

    await db.update(schema.accountTokenHealth).set({ state: 'unhealthy' }).where(eq(schema.accountTokenHealth.tokenId, healthy.id)).run();
    const allFailed = await app.inject({ method: 'GET', url: '/api/accounts?refresh=1' });
    expect(allFailed.json().accounts.find((item: { id: number }) => item.id === account.id).apiKeyHealth.state).toBe('unhealthy');
  });

  it('rejects accessToken input when API-key mode requires apiKey', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Separated Credential Fields',
      url: 'https://separated-credentials.example.com',
      platform: 'new-api',
    }).returning().get();

    const verifyResponse = await app.inject({
      method: 'POST',
      url: '/api/accounts/verify-token',
      payload: {
        siteId: site.id,
        accessToken: 'sk-wrong-field',
      },
    });

    expect(verifyResponse.statusCode).toBe(400);
    expect(verifyResponse.json()).toMatchObject({
      success: false,
      message: expect.stringContaining('Unsupported legacy account field "accessToken"'),
    });

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: {
        siteId: site.id,
        accessToken: 'sk-wrong-field',
      },
    });

    expect(createResponse.statusCode).toBe(400);
    expect(createResponse.json()).toMatchObject({
      message: expect.stringContaining('Unsupported legacy account field "accessToken"'),
    });
    expect(getModelsMock).not.toHaveBeenCalled();
  });

  it('rejects Session connection flows for OpenAI-compatible API-key-only sites', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'OpenAI API Only',
      url: 'https://api.openai.example.com',
      platform: 'openai',
    }).returning().get();

    const verifyResponse = await app.inject({
      method: 'POST',
      url: '/api/accounts/verify-token',
      payload: {
        siteId: site.id,
        credential: 'not-a-session',
      },
    });
    expect(verifyResponse.statusCode).toBe(200);
    expect(verifyResponse.json()).toMatchObject({
      success: false,
      message: '此站点仅支持 API Key，请在「API Key 管理」中添加。',
    });

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: {
        siteId: site.id,
        credential: 'not-a-session',
      },
    });
    expect(createResponse.statusCode).toBe(400);
    expect(createResponse.json()).toMatchObject({
      message: '此站点仅支持 API Key，请在「API Key 管理」中添加。',
    });
    expect(verifyTokenMock).not.toHaveBeenCalled();
  });

  it('adds account as proxy-only when credentialMode is apikey', async () => {
    verifyTokenMock.mockRejectedValueOnce(new Error('verifyToken should not be called'));
    getModelsMock.mockResolvedValueOnce(['gpt-4o-mini']);

    const site = await db.insert(schema.sites).values({
      name: 'Proxy Only Site',
      url: 'https://proxy-only.example.com',
      platform: 'new-api',
    }).returning().get();

    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: {
        siteId: site.id,
        apiKey: 'sk-proxy-only',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      tokenType?: string;
      capabilities?: {
        canSyncAccountTokens?: boolean;
        canCreateAccountTokens?: boolean;
        canRebindSession?: boolean;
        proxyOnly?: boolean;
      };
    };
    expect(body.tokenType).toBe('apikey');
    expect(body.capabilities).toMatchObject({
      canSyncAccountTokens: false,
      canCreateAccountTokens: true,
      canRebindSession: false,
      proxyOnly: true,
    });

    const accounts = await db.select().from(schema.accounts).all();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.credentialMode).toBe('apikey');
    expect(accounts[0]?.credential).toBe('');
    expect(accounts[0]?.credentialKind).toBe('none');
    expect(accounts[0]?.checkinEnabled).toBe(false);

    const accountTokens = await db.select().from(schema.accountTokens).all();
    expect(accountTokens).toHaveLength(1);
    expect(accountTokens[0]).toMatchObject({
      accountId: accounts[0]?.id,
      token: 'sk-proxy-only',
      enabled: true,
      isDefault: true,
    });
  });

  it('rejects changing a session account into API-key mode', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'API Key Reclassification Site',
      url: 'https://api-key-reclassification.example.com',
      platform: 'new-api',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'session-user',
      credentialMode: 'session',
      credential: 'stale-access-token',
      credentialKind: 'access_token',
      status: 'active',
      checkinEnabled: true,
    }).returning().get();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}`,
      payload: {
        credentialMode: 'apikey',
        checkinEnabled: true,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      message: '账号凭据模式不可切换，请在对应连接管理页面重新创建。',
    });
    const latest = await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)).get();
    expect(latest?.credentialMode).toBe('session');
    expect(latest?.credential).toBe('stale-access-token');
  });

  it('rejects malformed verify-token payloads at the route boundary', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts/verify-token',
      payload: {
        siteId: '1',
        credential: 'session-value',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      message: 'Invalid siteId. Expected positive number.',
    });
  });

  it('rejects array payloads when adding account', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: [],
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { message?: string }).message).toContain('account payload');
  });

  it('rejects non-string credential when adding account', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Typed Site',
      url: 'https://typed.example.com',
      platform: 'new-api',
    }).returning().get();

    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: {
        siteId: site.id,
        credential: 123,
      },
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { message?: string }).message).toContain('credential');
  });

  it('does not derive API-key account health from model discovery records', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Healthy API Key Site',
      url: 'https://healthy-apikey.example.com',
      platform: 'new-api',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'Wong',
      credentialMode: 'apikey',
      credential: '',
      credentialKind: 'none',
      checkinEnabled: false,
    }).returning().get();
    await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'default',
      token: 'sk-healthy-apikey',
      enabled: true,
      isDefault: true,
    }).run();

    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'gpt-5.4',
      available: true,
      latencyMs: 1200,
      checkedAt: '2026-03-07T07:35:00.000Z',
    }).run();

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/accounts',
    });
    expect(listResponse.statusCode).toBe(200);

    const body = listResponse.json() as {
      generatedAt: string;
      accounts: Array<{
        id: number;
        runtimeHealth?: { state?: string; reason?: string };
        capabilities?: {
          canSyncAccountTokens?: boolean;
          canCreateAccountTokens?: boolean;
          canRebindSession?: boolean;
          proxyOnly?: boolean;
        };
      }>;
      sites: any[];
    };
    const list = body.accounts;
    expect(list).toHaveLength(1);
    expect(list[0]?.capabilities).toMatchObject({
      canSyncAccountTokens: false,
      canCreateAccountTokens: true,
      canRebindSession: false,
      proxyOnly: true,
    });
    expect(list[0]?.runtimeHealth).toMatchObject({
      state: 'unknown',
      reason: '尚未检测',
    });
    expect(list[0]?.apiKeyHealth).toMatchObject({
      state: 'unknown',
      source: 'token-aggregate',
    });
  });

  it('marks codex oauth connection as direct-routed proxy-only connection without checkin/balance capabilities', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Codex Site',
      url: 'https://chatgpt.com/backend-api/codex',
      platform: 'codex',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'codex-user@example.com',
      credentialMode: 'oauth',
      credential: 'oauth-access-token',
      credentialKind: 'oauth_access_token',
      oauthProvider: 'codex',
      oauthAccountKey: 'chatgpt-account-123',
      status: 'active',
      checkinEnabled: false,
      extraConfig: JSON.stringify({
        oauth: {
          provider: 'codex',
          accountId: 'chatgpt-account-123',
          email: 'codex-user@example.com',
          planType: 'plus',
        },
      }),
    }).returning().get();

    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'gpt-5.2-codex',
      available: true,
      checkedAt: '2026-03-16T12:00:00.000Z',
    }).run();

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/accounts',
    });
    expect(listResponse.statusCode).toBe(200);

    const body = listResponse.json() as {
      generatedAt: string;
      accounts: Array<{
        id: number;
        credentialMode?: string;
        capabilities?: {
          canCheckin?: boolean;
          canRefreshBalance?: boolean;
          canSyncAccountTokens?: boolean;
          canCreateAccountTokens?: boolean;
          canRebindSession?: boolean;
          proxyOnly?: boolean;
        };
      }>;
      sites: any[];
    };
    const list = body.accounts;
    const item = list.find((entry) => entry.id === account.id);
    expect(item?.credentialMode).toBe('oauth');
    expect(item?.capabilities).toMatchObject({
      canCheckin: false,
      canRefreshBalance: false,
      canSyncAccountTokens: false,
      canCreateAccountTokens: false,
      canRebindSession: false,
      proxyOnly: true,
    });
  });

  it('uses structured oauth columns when listing oauth account capabilities and runtime health', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Structured Codex Site',
      url: 'https://chatgpt.com/backend-api/codex',
      platform: 'codex',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'structured-oauth@example.com',
      credentialMode: 'oauth',
      credential: 'oauth-access-token',
      credentialKind: 'oauth_access_token',
      status: 'active',
      checkinEnabled: false,
      oauthProvider: 'codex',
      oauthAccountKey: 'chatgpt-account-structured-123',
      extraConfig: JSON.stringify({
        oauth: {
          email: 'structured-oauth@example.com',
          planType: 'team',
        },
      }),
    }).returning().get();

    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'gpt-5.2-codex',
      available: true,
      checkedAt: '2026-04-01T12:00:00.000Z',
    }).run();

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/accounts',
    });
    expect(listResponse.statusCode).toBe(200);

    const body = listResponse.json() as {
      generatedAt: string;
      accounts: Array<{
        id: number;
        capabilities?: {
          canCheckin?: boolean;
          canRefreshBalance?: boolean;
          canSyncAccountTokens?: boolean;
          canCreateAccountTokens?: boolean;
          canRebindSession?: boolean;
          proxyOnly?: boolean;
        };
        runtimeHealth?: {
          state?: string;
          reason?: string;
        };
      }>;
      sites: any[];
    };
    const list = body.accounts;
    const item = list.find((entry) => entry.id === account.id);
    expect(item?.capabilities).toMatchObject({
      canCheckin: false,
      canRefreshBalance: false,
      canSyncAccountTokens: false,
      canCreateAccountTokens: false,
      canRebindSession: false,
      proxyOnly: true,
    });
    expect(item?.runtimeHealth).toMatchObject({
      state: 'unknown',
      reason: '尚未检测',
    });
  });

  it('stores managed refresh token for sub2api session account', async () => {
    verifyTokenMock.mockResolvedValueOnce({
      tokenType: 'session',
      userInfo: { username: 'sub2-user' },
    });

    const site = await db.insert(schema.sites).values({
      name: 'Sub2 Site',
      url: 'https://sub2.example.com',
      platform: 'sub2api',
    }).returning().get();

    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: {
        siteId: site.id,
        credential: 'jwt-access-token',
        connectionValues: {
          'sub2apiAuth.refreshToken': 'jwt-refresh-token',
          'sub2apiAuth.tokenExpiresAt': 1760000000000,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const created = (await db.select().from(schema.accounts).all())[0];
    const parsedExtra = JSON.parse(created?.extraConfig || '{}') as {
      sub2apiAuth?: {
        refreshToken?: string;
        tokenExpiresAt?: number;
      };
    };
    expect(created?.credentialMode).toBe('session');
    expect(created?.credential).toBe('jwt-access-token');
    expect(parsedExtra.sub2apiAuth?.refreshToken).toBe('jwt-refresh-token');
    expect(parsedExtra.sub2apiAuth?.tokenExpiresAt).toBe(1760000000000);
    expect(verifyTokenMock).toHaveBeenCalledWith(expect.objectContaining({
      account: expect.objectContaining({
        extraConfig: expect.stringContaining('jwt-refresh-token'),
      }),
    }));
  });

  it('returns a client error for credential edits on an unsupported legacy platform', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Unsupported Site',
      url: 'https://unsupported.example.com',
      platform: 'unsupported',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      credentialMode: 'session',
      credential: 'existing-access-token',
      credentialKind: 'access_token',
      status: 'active',
    }).returning().get();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}`,
      payload: { credential: 'replacement-access-token' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ message: '不支持的平台: unsupported' });
  });

  it('updates adapter connection fields and preserves an omitted secret value', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Sub2 Site',
      url: 'https://sub2.example.com',
      platform: 'sub2api',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'sub2-user',
      credentialMode: 'session',
      credential: 'access-token',
      credentialKind: 'access_token',
      extraConfig: JSON.stringify({
        sub2apiAuth: {
          refreshToken: 'old-refresh-token',
          tokenExpiresAt: 1750000000000,
        },
      }),
    }).returning().get();

    const updateResponse = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}`,
      payload: {
        connectionValues: {
          'sub2apiAuth.refreshToken': 'new-refresh-token',
          'sub2apiAuth.tokenExpiresAt': 1760000000000,
        },
      },
    });
    expect(updateResponse.statusCode).toBe(200);

    const updated = await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)).get();
    const parsedUpdated = JSON.parse(updated?.extraConfig || '{}') as {
      sub2apiAuth?: { refreshToken?: string; tokenExpiresAt?: number };
    };
    expect(parsedUpdated.sub2apiAuth?.refreshToken).toBe('new-refresh-token');
    expect(parsedUpdated.sub2apiAuth?.tokenExpiresAt).toBe(1760000000000);

    const clearResponse = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}`,
      payload: {
        connectionValues: {
          'sub2apiAuth.refreshToken': null,
          'sub2apiAuth.tokenExpiresAt': null,
        },
      },
    });
    expect(clearResponse.statusCode).toBe(200);

    const cleared = await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)).get();
    const parsedCleared = JSON.parse(cleared?.extraConfig || '{}') as {
      sub2apiAuth?: { refreshToken?: string; tokenExpiresAt?: number };
    };
    expect(parsedCleared.sub2apiAuth?.refreshToken).toBe('new-refresh-token');
    expect(parsedCleared.sub2apiAuth?.tokenExpiresAt).toBeUndefined();
  });

  it('accepts nullable optional fields from the edit panel payload', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Editable Site',
      url: 'https://editable.example.com',
      platform: 'new-api',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'before-edit',
      credentialMode: 'session',
      credential: 'access-token',
      credentialKind: 'access_token',
      status: 'active',
      unitCost: 25,
      extraConfig: JSON.stringify({
        proxyUrl: 'http://127.0.0.1:7890',
      }),
    }).returning().get();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}`,
      payload: {
        username: 'after-edit',
        status: 'disabled',
        checkinEnabled: false,
        unitCost: null,
        credential: 'access-token-updated',
        isPinned: false,
        proxyUrl: null,
      },
    });

    expect(response.statusCode).toBe(200);
    const updated = await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)).get();
    expect(updated).toMatchObject({
      username: 'after-edit',
      status: 'disabled',
      checkinEnabled: false,
      unitCost: null,
      credential: 'access-token-updated',
      isPinned: false,
    });
    expect(JSON.parse(updated?.extraConfig || '{}')).not.toHaveProperty('proxyUrl');
  });

  it('does not refresh models for pin-only account edits', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Pinned Site',
      url: 'https://pinned.example.com',
      platform: 'new-api',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'pinned-user',
      credentialMode: 'session',
      credential: 'access-token',
      credentialKind: 'access_token',
      status: 'active',
      isPinned: false,
      sortOrder: 0,
    }).returning().get();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}`,
      payload: {
        isPinned: true,
        sortOrder: 5,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(getModelsMock).not.toHaveBeenCalled();
    expect(verifyTokenMock).not.toHaveBeenCalled();

    const updated = await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)).get();
    expect(updated?.isPinned).toBe(true);
    expect(updated?.sortOrder).toBe(5);
  });

  it('rejects array payloads when updating account', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Update Site',
      url: 'https://update.example.com',
      platform: 'new-api',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'update-user',
      credentialMode: 'session',
      credential: 'access-token',
      credentialKind: 'access_token',
      status: 'active',
    }).returning().get();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}`,
      payload: [],
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { message?: string }).message).toContain('account payload');
  });

  it('rejects non-string username when updating account', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Update Site',
      url: 'https://update.example.com',
      platform: 'new-api',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'update-user',
      credentialMode: 'session',
      credential: 'access-token',
      credentialKind: 'access_token',
      status: 'active',
    }).returning().get();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}`,
      payload: {
        username: 123,
      },
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { message?: string }).message).toContain('username');
  });
});
