import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestAppHandle } from '../../../testing/appHarness.js';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../../testing/dbHarness.js';

type DbModule = typeof import('../../db/index.js');

describe('upstream cost pricing routes', () => {
  let app: TestAppHandle;
  let runtimeDb: IsolatedRuntimeDbHandle;
  let db: DbModule['db'];
  let schema: DbModule['schema'];

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-upstream-cost-routes-');
    const routesModule = await import('./upstreamCostPricing.js');
    db = runtimeDb.dbModule.db;
    schema = runtimeDb.dbModule.schema;
    app = await createTestApp({
      routes: [routesModule.upstreamCostPricingRoutes],
      auth: 'admin-api',
      env: {
        DATA_DIR: runtimeDb.path,
        DB_TYPE: 'sqlite',
      },
    });
  });

  beforeEach(async () => {
    await db.delete(schema.upstreamModelCostPricings).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await app.close();
    await runtimeDb.cleanup();
  });

  it('creates, lists, resolves, previews, updates, and deletes upstream cost pricing', async () => {
    const { site, account, token } = await seedSupply(db, schema);

    const create = await app.inject({
      method: 'POST',
      url: '/api/pricing/upstream-cost',
      headers: app.adminHeaders(),
      payload: {
        scope: 'token_model_group',
        siteId: site.id,
        accountId: account.id,
        tokenId: token.id,
        tokenGroup: 'gold',
        modelName: 'route-free-model',
        displayName: 'Route Free Model',
        simpleTokenPricing: {
          inputPerMillion: 2,
          outputPerMillion: 8,
          requestUsd: 0.001,
        },
      },
    });

    expect(create.statusCode).toBe(201);
    const created = create.json();
    expect(created).toMatchObject({
      scope: 'token_model_group',
      normalizedModelName: 'route-free-model',
      planFingerprint: expect.any(String),
    });

    const list = await app.inject({
      method: 'GET',
      url: `/api/pricing/upstream-cost?siteId=${site.id}&modelName=ROUTE-FREE-MODEL`,
      headers: app.adminHeaders(),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    const resolve = await app.inject({
      method: 'GET',
      url: `/api/pricing/upstream-cost/resolve?siteId=${site.id}&accountId=${account.id}&tokenId=${token.id}&tokenGroup=gold&modelName=route-free-model`,
      headers: app.adminHeaders(),
    });
    expect(resolve.statusCode).toBe(200);
    expect(resolve.json()).toMatchObject({
      matchedScope: 'token_model_group',
      pricing: { id: created.id },
    });

    const preview = await app.inject({
      method: 'POST',
      url: '/api/pricing/upstream-cost/preview',
      headers: app.adminHeaders(),
      payload: {
        siteId: site.id,
        accountId: account.id,
        tokenId: token.id,
        tokenGroup: 'gold',
        modelName: 'route-free-model',
        usage: {
          inputTokens: 1000,
          outputTokens: 500,
          requestCount: 1,
        },
      },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      evaluation: {
        totalCostUsd: 0.007,
        source: 'user_override',
      },
    });

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/pricing/upstream-cost/${created.id}`,
      headers: app.adminHeaders(),
      payload: {
        enabled: false,
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({ enabled: false });

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/pricing/upstream-cost/${created.id}`,
      headers: app.adminHeaders(),
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ success: true });
  });
});

async function seedSupply(db: DbModule['db'], schema: DbModule['schema']) {
  const site = await db.insert(schema.sites).values({
    name: 'Route Cost Site',
    url: 'https://route-cost.example.com',
    platform: 'openai',
  }).returning().get();
  const account = await db.insert(schema.accounts).values({
    siteId: site.id,
    username: 'route-cost-account',
    accessToken: 'access-token',
  }).returning().get();
  const token = await db.insert(schema.accountTokens).values({
    accountId: account.id,
    name: 'gold-token',
    token: 'sk-gold',
    tokenGroup: 'gold',
  }).returning().get();
  return { site, account, token };
}
