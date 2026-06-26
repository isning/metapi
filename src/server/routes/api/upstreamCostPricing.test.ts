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
    await db.delete(schema.settings).run();
    await db.delete(schema.fxRateSnapshots).run();
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

  it('reads and updates reference pricing config', async () => {
    const initial = await app.inject({
      method: 'GET',
      url: '/api/pricing/reference-config',
      headers: app.adminHeaders(),
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      schemaVersion: 1,
      sync: {
        enabled: false,
        replaceOnSync: true,
      },
    });
    expect(initial.json()).not.toHaveProperty('defaultReferenceMode');

    const update = await app.inject({
      method: 'PUT',
      url: '/api/pricing/reference-config',
      headers: app.adminHeaders(),
      payload: {
        defaultReferenceMode: 'manual',
        fallbackProfile: 'unknown',
        sync: {
          enabled: true,
          url: 'https://example.com/reference.json',
          cron: '0 4 * * *',
          replaceOnSync: false,
        },
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({
      schemaVersion: 1,
      sync: {
        enabled: true,
        url: 'https://example.com/reference.json',
        cron: '0 4 * * *',
        replaceOnSync: false,
      },
    });
    expect(update.json()).not.toHaveProperty('defaultReferenceMode');
    expect(update.json()).not.toHaveProperty('fallbackProfile');

    const loaded = await app.inject({
      method: 'GET',
      url: '/api/pricing/reference-config',
      headers: app.adminHeaders(),
    });
    expect(loaded.json()).toMatchObject(update.json());
  });

  it('manages reference pricing catalog entries and resolves imported reference prices', async () => {
    const initial = await app.inject({
      method: 'GET',
      url: '/api/pricing/reference-catalog',
      headers: app.adminHeaders(),
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      schemaVersion: 1,
      entries: [],
      updatedAt: null,
    });

    const imported = await app.inject({
      method: 'POST',
      url: '/api/pricing/reference-catalog/import',
      headers: app.adminHeaders(),
      payload: {
        replace: true,
        data: [
          {
            provider: 'OpenAI',
            modelName: 'gpt-4o',
            aliases: ['gpt-4o-2024-08-06'],
            inputPerMillion: 3,
            outputPerMillion: 7,
            cacheReadPerMillion: 1,
          },
        ],
      },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({
      imported: 1,
      replaced: 0,
      catalog: {
        entries: [
          {
            id: 'openai:gpt-4o',
            provider: 'openai',
            modelName: 'gpt-4o',
            normalizedModelName: 'gpt-4o',
            sourceType: 'imported',
            aliases: ['gpt-4o-2024-08-06'],
          },
        ],
      },
    });

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/pricing/reference-catalog',
      headers: app.adminHeaders(),
      payload: {
        entries: [
          {
            provider: 'openai',
            modelName: 'gpt-4o-mini',
            displayName: 'GPT-4o mini',
            inputPerMillion: 0.15,
            outputPerMillion: 0.6,
            notes: 'manual estimate',
          },
        ],
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      schemaVersion: 1,
      entries: [
        {
          id: 'openai:gpt-4o-mini',
          sourceType: 'manual',
          notes: 'manual estimate',
        },
      ],
    });

    const reimported = await app.inject({
      method: 'POST',
      url: '/api/pricing/reference-catalog/import',
      headers: app.adminHeaders(),
      payload: {
        replace: false,
        data: [
          {
            provider: 'openai',
            modelName: 'gpt-4o',
            aliases: ['gpt-4o-2024-08-06'],
            inputPerMillion: 3,
            outputPerMillion: 7,
          },
        ],
      },
    });
    expect(reimported.statusCode).toBe(200);
    expect(reimported.json()).toMatchObject({
      imported: 1,
      replaced: 0,
    });

    const { resolveReferencePricing } = await import('../../services/referencePricingService.js');
    const resolved = await resolveReferencePricing({
      subject: {
        provider: 'openai',
        modelName: 'gpt-4o-2024-08-06',
      },
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 2_000_000,
        requestCount: 1,
      },
    });
    expect(resolved).toMatchObject({
      source: 'official_reference',
      sourceId: 'openai:gpt-4o',
      matchedScope: 'provider:openai',
      sourceType: 'imported',
      evaluation: {
        totalCostUsd: 17,
      },
    });
  });

  it('reads and updates platform pricing drift config separately from reference pricing', async () => {
    const initial = await app.inject({
      method: 'GET',
      url: '/api/pricing/platform-config',
      headers: app.adminHeaders(),
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      schemaVersion: 1,
      baseCostUnit: 'USD',
      driftCheck: {
        enabled: false,
        windowHours: 24,
        minSampleSize: 20,
      },
    });

    const update = await app.inject({
      method: 'PUT',
      url: '/api/pricing/platform-config',
      headers: app.adminHeaders(),
      payload: {
        baseCostUnit: 'CNY',
        driftCheck: {
          enabled: true,
          windowHours: 12,
          minSampleSize: 5,
          relativeTolerance: 0.2,
          absoluteToleranceUsd: 0.000002,
          notifyOnWarning: false,
        },
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({
      schemaVersion: 1,
      baseCostUnit: 'CNY',
      driftCheck: {
        enabled: true,
        windowHours: 12,
        minSampleSize: 5,
        relativeTolerance: 0.2,
        absoluteToleranceUsd: 0.000002,
        notifyOnWarning: false,
      },
    });
  });

  it('rejects invalid or duplicate unit conversions', async () => {
    const identity = await app.inject({
      method: 'POST',
      url: '/api/pricing/fx-rates',
      headers: app.adminHeaders(),
      payload: {
        fromCurrency: 'USD',
        toCurrency: 'usd',
        rate: 1,
      },
    });
    expect(identity.statusCode).toBe(400);
    expect(identity.json().error).toContain('must use different units');

    const created = await app.inject({
      method: 'POST',
      url: '/api/pricing/fx-rates',
      headers: app.adminHeaders(),
      payload: {
        fromCurrency: 'usd',
        toCurrency: 'cny',
        rate: 7.2,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      fromCurrency: 'CNY',
      toCurrency: 'USD',
      rate: 1 / 7.2,
    });

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/pricing/fx-rates',
      headers: app.adminHeaders(),
      payload: {
        fromCurrency: 'USD',
        toCurrency: 'CNY',
        rate: 7.3,
      },
    });
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json().error).toContain('already exists');

    const second = await app.inject({
      method: 'POST',
      url: '/api/pricing/fx-rates',
      headers: app.adminHeaders(),
      payload: {
        fromCurrency: 'EUR',
        toCurrency: 'USD',
        rate: 1.1,
      },
    });
    expect(second.statusCode).toBe(201);

    const conflictingUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/pricing/fx-rates/${second.json().id}`,
      headers: app.adminHeaders(),
      payload: {
        fromCurrency: 'USD',
        toCurrency: 'CNY',
      },
    });
    expect(conflictingUpdate.statusCode).toBe(400);
    expect(conflictingUpdate.json().error).toContain('already exists');
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
