import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createGraphNativeTokenRouteFixture,
  publishCurrentGraphNativeTokenRouteFixtures,
  resetGraphNativeTokenRouteFixtures,
} from '../../test/graphNativeRouteFixtures.js';

type DbModule = typeof import('../../db/index.js');
type TokenRouterModule = typeof import('../../services/tokenRouter.js');
type ConfigModule = typeof import('../../config.js');

describe('sites token-router cache invalidation', () => {
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let tokenRouter: TokenRouterModule['tokenRouter'];
  let invalidateTokenRouterCache: TokenRouterModule['invalidateTokenRouterCache'];
  let config: ConfigModule['config'];
  let originalCacheTtlMs = 0;
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-sites-token-router-cache-'));
    process.env.DATA_DIR = dataDir;

    await import('../../db/migrate.js');
    const dbModule = await import('../../db/index.js');
    const routesModule = await import('./sites.js');
    const tokenRouterModule = await import('../../services/tokenRouter.js');
    const configModule = await import('../../config.js');

    db = dbModule.db;
    schema = dbModule.schema;
    tokenRouter = tokenRouterModule.tokenRouter;
    invalidateTokenRouterCache = tokenRouterModule.invalidateTokenRouterCache;
    config = configModule.config;
    originalCacheTtlMs = config.tokenRouterCacheTtlMs;

    app = Fastify();
    await app.register(routesModule.sitesRoutes);
  });

  beforeEach(async () => {
    await db.delete(schema.routeEndpointTargets).run();
    await db.delete(schema.tokenRoutes).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
    config.tokenRouterCacheTtlMs = 60_000;
    resetGraphNativeTokenRouteFixtures();
    invalidateTokenRouterCache();
  });

  afterAll(async () => {
    await app.close();
    config.tokenRouterCacheTtlMs = originalCacheTtlMs;
    invalidateTokenRouterCache();
    delete process.env.DATA_DIR;
  });

  it('recomputes probabilities with the new site weight after updating a site', async () => {
    const targetSite = await db.insert(schema.sites).values({
      name: 'weighted-target',
      url: 'https://weighted-target.example.com',
      platform: 'new-api',
      status: 'active',
      globalWeight: 1,
    }).returning().get();

    const competitorSite = await db.insert(schema.sites).values({
      name: 'weighted-competitor',
      url: 'https://weighted-competitor.example.com',
      platform: 'new-api',
      status: 'active',
      globalWeight: 1,
    }).returning().get();

    const targetAccount = await db.insert(schema.accounts).values({
      siteId: targetSite.id,
      username: 'target-user',
      accessToken: 'target-access-token',
      apiToken: 'sk-target-api-token',
      status: 'active',
      unitCost: 1,
      balance: 0,
    }).returning().get();

    const competitorAccount = await db.insert(schema.accounts).values({
      siteId: competitorSite.id,
      username: 'competitor-user',
      accessToken: 'competitor-access-token',
      apiToken: 'sk-competitor-api-token',
      status: 'active',
      unitCost: 1,
      balance: 0,
    }).returning().get();

    const route = await createGraphNativeTokenRouteFixture({
      modelPattern: 'gpt-4o-mini',
      enabled: true,
    });

    await db.insert(schema.routeEndpointTargets).values([
      {
        routeId: route.id,
        accountId: targetAccount.id,
        tokenId: null,
        priority: 0,
        weight: 10,
        enabled: true,
      },
      {
        routeId: route.id,
        accountId: competitorAccount.id,
        tokenId: null,
        priority: 0,
        weight: 10,
        enabled: true,
      },
    ]).run();
    await publishCurrentGraphNativeTokenRouteFixtures();
    invalidateTokenRouterCache();

    const before = await tokenRouter.explainSelection('gpt-4o-mini');
    const beforeTarget = before.candidates.find((candidate) => candidate.accountId === targetAccount.id);
    expect(beforeTarget?.probability).toBeCloseTo(50, 1);

    const response = await app.inject({
      method: 'PUT',
      url: `/api/sites/${targetSite.id}`,
      payload: {
        globalWeight: 100,
      },
    });

    expect(response.statusCode).toBe(200);

    const after = await tokenRouter.explainSelection('gpt-4o-mini');
    const afterTarget = after.candidates.find((candidate) => candidate.accountId === targetAccount.id);

    expect(afterTarget?.probability || 0).toBeGreaterThan(90);
    expect(afterTarget?.reason || '').toContain('站点权重=100.00');
  });
});
