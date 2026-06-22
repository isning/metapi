import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';

type DbModule = typeof import('../../db/index.js');
type StatsRoutesModule = typeof import('./stats.js');

describe('/api/models/marketplace', () => {
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let resetModelsMarketplaceCacheForTests: StatsRoutesModule['__resetModelsMarketplaceCacheForTests'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-stats-marketplace-'));
    process.env.DATA_DIR = dataDir;

    vi.resetModules();
    await import('../../db/migrate.js');
    const dbModule = await import('../../db/index.js');
    const routesModule = await import('./stats.js');
    db = dbModule.db;
    schema = dbModule.schema;
    resetModelsMarketplaceCacheForTests = routesModule.__resetModelsMarketplaceCacheForTests;

    app = Fastify();
    await app.register(routesModule.statsRoutes);
  });

  beforeEach(async () => {
    resetModelsMarketplaceCacheForTests();
    await db.delete(schema.proxyLogs).run();
    await db.delete(schema.routeChannels).run();
    await db.delete(schema.tokenRoutes).run();
    await db.delete(schema.tokenModelAvailability).run();
    await db.delete(schema.modelAvailability).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.checkinLogs).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DATA_DIR;
  });

  it('returns account-level discovered models even when account has no managed tokens', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'site-no-token',
      url: 'https://site-no-token.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'alice',
      accessToken: 'session-token',
      status: 'active',
      balance: 12.5,
    }).returning().get();

    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'claude-sonnet-4-5-20250929',
      available: true,
      latencyMs: 233,
    }).run();

    const visibleRows = await db.select().from(schema.modelAvailability)
      .innerJoin(schema.accounts, eq(schema.modelAvailability.accountId, schema.accounts.id))
      .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
      .where(
        and(
          eq(schema.modelAvailability.available, true),
          eq(schema.accounts.status, 'active'),
          eq(schema.sites.status, 'active'),
        ),
      )
      .all();
    expect(visibleRows).toHaveLength(1);

    const response = await app.inject({
      method: 'GET',
      url: '/api/models/marketplace',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      models: Array<{
        name: string;
        accountCount: number;
        tokenCount: number;
        accounts: Array<{
          id: number;
          site: string;
          username: string | null;
          tokens: Array<{ id: number; name: string; isDefault: boolean }>;
        }>;
      }>;
    };
    const model = body.models.find((item) => item.name === 'claude-sonnet-4-5-20250929');
    expect(model).toBeDefined();
    expect(model?.accountCount).toBe(1);
    expect(model?.tokenCount).toBe(0);
    expect(model?.accounts).toHaveLength(1);
    expect(model?.accounts[0]).toMatchObject({
      id: account.id,
      site: 'site-no-token',
      username: 'alice',
      tokens: [],
    });
  });

  it('only exposes available models from active sites, active accounts, and ready enabled tokens', async () => {
    const activeSite = await db.insert(schema.sites).values({
      name: 'active-market-site',
      url: 'https://active-market.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const disabledSite = await db.insert(schema.sites).values({
      name: 'disabled-market-site',
      url: 'https://disabled-market.example.com',
      platform: 'new-api',
      status: 'disabled',
    }).returning().get();
    const activeAccount = await db.insert(schema.accounts).values({
      siteId: activeSite.id,
      username: 'active-user',
      accessToken: 'active-access',
      apiToken: 'active-api',
      status: 'active',
      unitCost: 0.25,
      balance: 9,
    }).returning().get();
    const disabledAccount = await db.insert(schema.accounts).values({
      siteId: activeSite.id,
      username: 'disabled-user',
      accessToken: 'disabled-access',
      apiToken: 'disabled-api',
      status: 'disabled',
    }).returning().get();
    const accountOnDisabledSite = await db.insert(schema.accounts).values({
      siteId: disabledSite.id,
      username: 'site-disabled-user',
      accessToken: 'site-disabled-access',
      apiToken: 'site-disabled-api',
      status: 'active',
    }).returning().get();
    const readyToken = await db.insert(schema.accountTokens).values({
      accountId: activeAccount.id,
      name: 'ready-token',
      token: 'sk-ready-token',
      valueStatus: 'ready',
      enabled: true,
      isDefault: true,
    }).returning().get();
    const disabledToken = await db.insert(schema.accountTokens).values({
      accountId: activeAccount.id,
      name: 'disabled-token',
      token: 'sk-disabled-token',
      valueStatus: 'ready',
      enabled: false,
    }).returning().get();
    const pendingToken = await db.insert(schema.accountTokens).values({
      accountId: activeAccount.id,
      name: 'pending-token',
      token: 'sk-pending-token',
      valueStatus: 'pending',
      enabled: true,
    }).returning().get();

    await db.insert(schema.tokenModelAvailability).values([
      {
        tokenId: readyToken.id,
        modelName: 'gpt-4o-mini',
        available: true,
        latencyMs: 100,
      },
      {
        tokenId: disabledToken.id,
        modelName: 'hidden-disabled-token-model',
        available: true,
        latencyMs: 101,
      },
      {
        tokenId: pendingToken.id,
        modelName: 'hidden-pending-token-model',
        available: true,
        latencyMs: 102,
      },
      {
        tokenId: readyToken.id,
        modelName: 'hidden-unavailable-token-model',
        available: false,
        latencyMs: 103,
      },
    ]).run();
    await db.insert(schema.modelAvailability).values([
      {
        accountId: activeAccount.id,
        modelName: 'account-only-model',
        available: true,
        latencyMs: 80,
      },
      {
        accountId: disabledAccount.id,
        modelName: 'hidden-disabled-account-model',
        available: true,
        latencyMs: 81,
      },
      {
        accountId: accountOnDisabledSite.id,
        modelName: 'hidden-disabled-site-model',
        available: true,
        latencyMs: 82,
      },
      {
        accountId: activeAccount.id,
        modelName: 'hidden-unavailable-account-model',
        available: false,
        latencyMs: 83,
      },
    ]).run();
    await db.insert(schema.proxyLogs).values([
      {
        accountId: activeAccount.id,
        modelRequested: 'gpt-4o-mini',
        modelActual: 'gpt-4o-mini',
        status: 'success',
        latencyMs: 120,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        billingDetails: JSON.stringify({
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            billablePromptTokens: 100,
            promptTokensIncludeCache: false,
          },
          breakdown: {
            inputPerMillion: 5,
            outputPerMillion: 15,
          },
        }),
        createdAt: new Date().toISOString(),
      },
      {
        accountId: activeAccount.id,
        modelRequested: 'gpt-4o-mini',
        modelActual: 'gpt-4o-mini',
        status: 'failed',
        latencyMs: 240,
        createdAt: new Date().toISOString(),
      },
    ]).run();

    const response = await app.inject({
      method: 'GET',
      url: '/api/models/marketplace',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      models: Array<{
        name: string;
        accountCount: number;
        tokenCount: number;
        avgLatency: number;
        successRate: number | null;
        accounts: Array<{
          id: number;
          site: string;
          username: string | null;
          unitCost: number | null;
          balance: number;
          tokens: Array<{ id: number; name: string; isDefault: boolean }>;
        }>;
        measuredEntryPricing: {
          inputPerMillion: number | null;
          outputPerMillion: number | null;
          sampleCount: number;
          lastMeasuredAt: string | null;
        } | null;
      }>;
      meta: { includePricing: boolean; cacheHit?: boolean };
    };
    const names = body.models.map((model) => model.name);
    expect(names).toContain('gpt-4o-mini');
    expect(names).toContain('account-only-model');
    expect(names).not.toContain('hidden-disabled-token-model');
    expect(names).not.toContain('hidden-pending-token-model');
    expect(names).not.toContain('hidden-unavailable-token-model');
    expect(names).not.toContain('hidden-disabled-account-model');
    expect(names).not.toContain('hidden-disabled-site-model');
    expect(names).not.toContain('hidden-unavailable-account-model');

    const routedModel = body.models.find((model) => model.name === 'gpt-4o-mini');
    expect(routedModel).toMatchObject({
      accountCount: 1,
      tokenCount: 1,
      avgLatency: 100,
      successRate: 50,
      measuredEntryPricing: {
        inputPerMillion: 5,
        outputPerMillion: 15,
        sampleCount: 1,
      },
    });
    expect(routedModel?.accounts).toEqual([
      expect.objectContaining({
        id: activeAccount.id,
        site: 'active-market-site',
        username: 'active-user',
        unitCost: 0.25,
        balance: 9,
        tokens: [
          { id: readyToken.id, name: 'ready-token', isDefault: true },
        ],
      }),
    ]);

    const accountOnly = body.models.find((model) => model.name === 'account-only-model');
    expect(accountOnly).toMatchObject({
      accountCount: 1,
      tokenCount: 0,
      avgLatency: 80,
      successRate: null,
    });
    expect(body.meta.includePricing).toBe(false);
  });

  it('serves repeated marketplace reads from the matching pricing cache', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'cache-site',
      url: 'https://cache-site.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'cache-user',
      accessToken: 'cache-access',
      apiToken: 'cache-api',
      status: 'active',
    }).returning().get();
    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'cache-model',
      available: true,
      latencyMs: 55,
    }).run();

    const first = await app.inject({
      method: 'GET',
      url: '/api/models/marketplace',
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as {
      meta: { cacheHit?: boolean; includePricing: boolean };
    };
    expect(firstBody.meta.includePricing).toBe(false);
    expect('cacheHit' in firstBody.meta).toBe(false);

    await db.update(schema.modelAvailability).set({
      modelName: 'cache-model-mutated-after-first-read',
    }).where(eq(schema.modelAvailability.accountId, account.id)).run();

    const cached = await app.inject({
      method: 'GET',
      url: '/api/models/marketplace',
    });
    expect(cached.statusCode).toBe(200);
    const cachedBody = cached.json() as {
      models: Array<{ name: string }>;
      meta: { cacheHit?: boolean; includePricing: boolean };
    };
    expect(cachedBody.meta).toMatchObject({
      cacheHit: true,
      includePricing: false,
    });
    expect(cachedBody.models.map((model) => model.name)).toContain('cache-model');
    expect(cachedBody.models.map((model) => model.name)).not.toContain('cache-model-mutated-after-first-read');
  });
});
