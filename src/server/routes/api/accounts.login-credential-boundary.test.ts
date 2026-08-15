import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { resetRequestRateLimitStore } from '../../middleware/requestRateLimit.js';

const loginMock = vi.fn();

vi.mock('../../services/platforms/index.js', () => ({
  getAdapter: (platform: string) => ({
    login: (...args: unknown[]) => loginMock(...args),
    credentialCapabilities: platform === 'openai'
      ? { session: false, apiKey: true, sessionCredentialOptions: [] }
      : {
          session: true,
          apiKey: true,
          sessionCredentialOptions: [{ kind: 'access_token' }],
        },
  }),
}));

type DbModule = typeof import('../../db/index.js');

describe('accounts login credential boundary', () => {
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-accounts-login-credential-boundary-'));
    process.env.DATA_DIR = dataDir;

    await import('../../db/migrate.js');
    const dbModule = await import('../../db/index.js');
    const routesModule = await import('./accounts.js');
    db = dbModule.db;
    schema = dbModule.schema;

    app = Fastify();
    await app.register(routesModule.accountsRoutes);
  });

  beforeEach(async () => {
    loginMock.mockReset();
    resetRequestRateLimitStore();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await app.close();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  async function createExistingAccount(credentialMode: 'apikey' | 'oauth') {
    const site = await db.insert(schema.sites).values({
      name: 'Credential Boundary Site',
      url: 'https://credential-boundary.example.com',
      platform: 'new-api',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'same-user',
      credentialMode,
      credential: credentialMode === 'oauth' ? 'oauth-access-token' : '',
      credentialKind: credentialMode === 'oauth' ? 'oauth_access_token' : 'none',
      ...(credentialMode === 'oauth' ? { oauthProvider: 'codex' } : {}),
    }).returning().get();
    return { site, account };
  }

  it.each(['apikey', 'oauth'] as const)(
    'does not overwrite an existing %s account through password login',
    async (credentialMode) => {
      const { site, account } = await createExistingAccount(credentialMode);

      const response = await app.inject({
        method: 'POST',
        url: '/api/accounts/login',
        payload: { siteId: site.id, username: 'same-user', password: 'password' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ success: false });
      expect(loginMock).not.toHaveBeenCalled();
      const persisted = await db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, account.id))
        .get();
      expect(persisted).toMatchObject({
        credentialMode,
        credential: credentialMode === 'oauth' ? 'oauth-access-token' : '',
      });
    },
  );

  it('rejects password login for an adapter without Session support', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'API Key Only Site',
      url: 'https://api-key-only.example.com',
      platform: 'openai',
    }).returning().get();

    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts/login',
      payload: { siteId: site.id, username: 'user', password: 'password' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ success: false });
    expect(loginMock).not.toHaveBeenCalled();
  });
});
