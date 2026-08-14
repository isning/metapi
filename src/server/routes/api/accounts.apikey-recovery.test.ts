import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { clearRouteGroupMemberTestData } from '../../../testing/routeGroupMemberTestUtils.js';

const getModelsMock = vi.fn();

vi.mock('../../services/platforms/index.js', () => ({
  getAdapter: () => ({
    getModels: (...args: unknown[]) => getModelsMock(...args),
  }),
}));

type DbModule = typeof import('../../db/index.js');

describe('accounts api key ownership', { timeout: 15_000 }, () => {
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-accounts-apikey-ownership-'));
    process.env.DATA_DIR = dataDir;

    const migrate = await import('../../db/migrate.js');
    await migrate.runSqliteMigrations();
    const dbModule = await import('../../db/index.js');
    const routesModule = await import('./accounts.js');
    db = dbModule.db;
    schema = dbModule.schema;

    app = Fastify();
    await app.register(routesModule.accountsRoutes);
  });

  beforeEach(async () => {
    getModelsMock.mockReset();

    await db.delete(schema.proxyLogs).run();
    await db.delete(schema.checkinLogs).run();
    await clearRouteGroupMemberTestData();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.tokenModelAvailability).run();
    await db.delete(schema.modelAvailability).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.siteApiEndpoints).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DATA_DIR;
  });

  async function seedApiKeyAccount(input: { name: string; token: string; status?: string }) {
    const site = await db.insert(schema.sites).values({
      name: input.name,
      url: `https://${input.name.toLowerCase().replaceAll(' ', '-')}.example.com`,
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'apikey-user',
      credentialMode: 'apikey',
      credential: '',
      credentialKind: 'none',
      status: input.status ?? 'active',
      checkinEnabled: false,
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'default',
      token: input.token,
      enabled: true,
      isDefault: true,
    }).returning().get();
    return { site, account, token };
  }

  it('requires model keys to be updated through account token management', async () => {
    const { account, token } = await seedApiKeyAccount({
      name: 'Separated Key Ownership',
      token: 'existing-model-key',
      status: 'expired',
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}`,
      payload: { credential: 'replacement-model-key' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      message: 'API Key 连接的模型 Key 必须通过账号令牌管理更新。',
    });
    const latestAccount = await db.select().from(schema.accounts)
      .where(eq(schema.accounts.id, account.id)).get();
    const latestToken = await db.select().from(schema.accountTokens)
      .where(eq(schema.accountTokens.id, token.id)).get();
    expect(latestAccount?.credential).toBe('');
    expect(latestToken?.token).toBe('existing-model-key');
    expect(getModelsMock).not.toHaveBeenCalled();
  });

  it('rejects legacy account-level key fields instead of migrating them in the route', async () => {
    const { account } = await seedApiKeyAccount({
      name: 'Legacy Field Rejection',
      token: 'existing-model-key',
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}`,
      payload: { apiToken: 'replacement-model-key' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      message: expect.stringContaining('Unsupported legacy account field "apiToken"'),
    });
    const tokens = await db.select().from(schema.accountTokens)
      .where(eq(schema.accountTokens.accountId, account.id)).all();
    expect(tokens.map((row) => row.token)).toEqual(['existing-model-key']);
  });

  it('does not reactivate an expired API key account for metadata-only edits', async () => {
    const { account } = await seedApiKeyAccount({
      name: 'Expired Metadata Edit',
      token: 'expired-model-key',
      status: 'expired',
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}`,
      payload: {
        username: 'renamed-apikey-user',
        status: 'active',
        checkinEnabled: false,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: account.id,
      username: 'renamed-apikey-user',
      status: 'expired',
    });
    expect(getModelsMock).not.toHaveBeenCalled();
  });

  it('updates a Session connection credential without creating a model key', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Session Credential Edit',
      url: 'https://session-credential-edit.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'session-user',
      credentialMode: 'session',
      credential: 'old-session-credential',
      credentialKind: 'access_token',
      status: 'active',
      checkinEnabled: true,
    }).returning().get();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}`,
      payload: { credential: 'new-session-credential' },
    });

    expect(response.statusCode).toBe(200);
    const latest = await db.select().from(schema.accounts)
      .where(eq(schema.accounts.id, account.id)).get();
    expect(latest?.credential).toBe('new-session-credential');
    const tokens = await db.select().from(schema.accountTokens)
      .where(eq(schema.accountTokens.accountId, account.id)).all();
    expect(tokens).toEqual([]);
  });
});
