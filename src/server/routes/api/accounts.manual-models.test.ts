import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

type DbModule = typeof import('../../db/index.js');

describe('accounts manual models endpoint', () => {
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-accounts-manual-models-'));
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
    await db.delete(schema.proxyLogs).run();
    await db.delete(schema.checkinLogs).run();
    await db.delete(schema.routeEndpointTargets).run();
    await db.delete(schema.tokenRoutes).run();
    await db.delete(schema.upstreamModelCostPricings).run();
    await db.delete(schema.tokenModelAvailability).run();
    await db.delete(schema.modelAvailability).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DATA_DIR;
  });

  it('adds manual models and sets isManual to true', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Test Site',
      url: 'https://test.example.com',
      platform: 'new-api',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      accessToken: 'test-token',
    }).returning().get();

    const response = await app.inject({
      method: 'POST',
      url: `/api/accounts/${account.id}/models/manual`,
      payload: {
        models: ['gpt-4-manual', 'claude-3-manual'],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);

    const models = await db.select().from(schema.modelAvailability).where(
      eq(schema.modelAvailability.accountId, account.id)
    ).all();
    
    expect(models).toHaveLength(2);
    expect(models.map(m => m.modelName).sort()).toEqual(['claude-3-manual', 'gpt-4-manual']);
    expect(models[0]?.isManual).toBe(true);
    expect(models[1]?.isManual).toBe(true);
  });

  it('returns account token metadata with account model list for pricing scope selection', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Token Scope Site',
      url: 'https://token-scope.example.com',
      platform: 'new-api',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      accessToken: 'test-token',
    }).returning().get();

    await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'premium token',
      token: 'sk-premium',
      tokenGroup: 'premium',
      enabled: true,
      isDefault: true,
    }).run();
    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'priced-model',
      available: true,
      latencyMs: 42,
    }).run();
    await db.insert(schema.upstreamModelCostPricings).values({
      scope: 'account_model',
      scopeKey: `account_model|site:${site.id}|account:${account.id}|token:-|group:-|model:priced-model`,
      siteId: site.id,
      accountId: account.id,
      modelName: 'priced-model',
      normalizedModelName: 'priced-model',
      planJson: JSON.stringify({
        schemaVersion: 1,
        planKind: 'rate_card',
        unitPrecision: 'mixed',
        billingMode: 'mixed',
        aggregation: { mode: 'sum_components', period: 'request' },
        rounding: { mode: 'total', precision: 12 },
        components: [
          {
            id: 'input_tokens',
            label: 'Input tokens',
            role: 'charge',
            kind: 'input_tokens',
            meter: { unit: 'token', quantityPath: 'usage.inputTokens', scale: 1000000, missingQuantity: 'zero' },
            price: { currency: 'USD', amount: 2, unitLabel: '1M tokens' },
          },
          {
            id: 'output_tokens',
            label: 'Output tokens',
            role: 'charge',
            kind: 'output_tokens',
            meter: { unit: 'token', quantityPath: 'usage.outputTokens', scale: 1000000, missingQuantity: 'zero' },
            price: { currency: 'USD', amount: 8, unitLabel: '1M tokens' },
          },
        ],
        tiers: [],
      }),
      planFingerprint: 'test-fingerprint',
      enabled: true,
      sourceType: 'user',
    }).run();

    const response = await app.inject({
      method: 'GET',
      url: `/api/accounts/${account.id}/models`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      siteId: site.id,
      accountTokens: [
        expect.objectContaining({
          name: 'premium token',
          tokenGroup: 'premium',
          enabled: true,
          isDefault: true,
        }),
      ],
      models: [
        expect.objectContaining({
          name: 'priced-model',
          latencyMs: 42,
          costPricing: expect.objectContaining({
            configured: true,
            matchedScope: 'account_model',
            totalCostUsd: 10,
          }),
        }),
      ],
    });
    expect(response.json().accountTokens[0]).not.toHaveProperty('token');
  });

  it('updates existing synced models to manual if provided', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Test Site',
      url: 'https://test.example.com',
      platform: 'new-api',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      accessToken: 'test-token',
    }).returning().get();

    // Already-synced model that is NOT manual
    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'gpt-existing',
      available: true,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/accounts/${account.id}/models/manual`,
      payload: {
        models: ['gpt-existing', 'gpt-new'],
      },
    });

    expect(response.statusCode).toBe(200);

    const models = await db.select().from(schema.modelAvailability)
      .where(eq(schema.modelAvailability.accountId, account.id))
      .all();
    
    expect(models).toHaveLength(2);
    const existing = models.find(m => m.modelName === 'gpt-existing');
    const newModel = models.find(m => m.modelName === 'gpt-new');

    expect(existing?.isManual).toBe(true); // Should be updated
    expect(newModel?.isManual).toBe(true);
  });

  it('fails if account does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts/999/models/manual',
      payload: {
        models: ['gpt-4-manual'],
      },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns validation error for empty models array', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Test Site',
      url: 'https://test.example.com',
      platform: 'new-api',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      accessToken: 'test-token',
    }).returning().get();

    const response = await app.inject({
      method: 'POST',
      url: `/api/accounts/${account.id}/models/manual`,
      payload: {
        models: [],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects non-string manual model entries at the route boundary', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Test Site',
      url: 'https://test.example.com',
      platform: 'new-api',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      accessToken: 'test-token',
    }).returning().get();

    const response = await app.inject({
      method: 'POST',
      url: `/api/accounts/${account.id}/models/manual`,
      payload: {
        models: ['gpt-4-manual', 123],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      message: 'Invalid models. Expected string[].',
    });
  });
});
