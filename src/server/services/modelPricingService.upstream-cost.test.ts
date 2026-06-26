import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../testing/dbHarness.js';

const fetchUpstreamPricingCatalogMock = vi.hoisted(() => vi.fn());

vi.mock('./upstreamPricingCatalogService.js', () => ({
  fetchUpstreamPricingCatalog: fetchUpstreamPricingCatalogMock,
}));

type DbModule = typeof import('../db/index.js');
type PricingModule = typeof import('./modelPricingService.js');
type UpstreamCostModule = typeof import('./upstreamCostPricingService.js');

describe('modelPricingService upstream cost integration', () => {
  let runtimeDb: IsolatedRuntimeDbHandle;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let pricing: PricingModule;
  let upstreamCost: UpstreamCostModule;

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-model-pricing-upstream-cost-');
    db = runtimeDb.dbModule.db;
    schema = runtimeDb.dbModule.schema;
    pricing = await import('./modelPricingService.js');
    upstreamCost = await import('./upstreamCostPricingService.js');
  });

  beforeEach(async () => {
    fetchUpstreamPricingCatalogMock.mockReset();
    await db.delete(schema.settings).run();
    await db.delete(schema.upstreamModelCostPricings).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await runtimeDb.cleanup();
  });

  it('uses configured upstream cost pricing before upstream catalog fallback', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Manual Cost',
      url: 'https://manual-cost.example.com',
      platform: 'openai',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'manual',
      accessToken: 'access-token',
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'paid',
      token: 'sk-paid',
      tokenGroup: 'paid',
    }).returning().get();
    await upstreamCost.createUpstreamCostPricing({
      scope: 'token_model_group',
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      tokenGroup: 'paid',
      modelName: 'manual-priced-model',
      plan: upstreamCost.createSimpleTokenPricingPlan({
        inputPerMillion: 10,
        outputPerMillion: 20,
      }),
    });

    const cost = await pricing.estimateProxyCost({
      site,
      account,
      tokenId: token.id,
      upstreamGroup: 'paid',
      modelName: 'manual-priced-model',
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });
    const details = await pricing.buildProxyBillingDetails({
      site,
      account,
      tokenId: token.id,
      upstreamGroup: 'paid',
      modelName: 'manual-priced-model',
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });

    expect(cost).toBe(0.02);
    expect(details).toMatchObject({
      source: 'upstream_cost_pricing',
      upstreamCostPricingScope: 'token_model_group',
      breakdown: {
        inputPerMillion: 10,
        outputPerMillion: 20,
        inputCost: 0.01,
        outputCost: 0.01,
        totalCost: 0.02,
      },
    });
  });

  it('uses provider catalog pricing even when the legacy provider catalog switch is disabled', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Catalog Disabled Cost',
      url: 'https://catalog-disabled.example.com',
      platform: 'openai',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'catalog-disabled',
      accessToken: 'access-token',
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'paid',
      token: 'sk-paid',
      tokenGroup: 'paid',
    }).returning().get();
    await db.insert(schema.settings).values({
      key: 'pricing_reference_config_v1',
      value: JSON.stringify({
        schemaVersion: 1,
        sync: {
          enabled: false,
          url: '',
          cron: '0 3 * * *',
          replaceOnSync: true,
          lastSyncedAt: null,
          lastError: null,
        },
      }),
    }).run();
    fetchUpstreamPricingCatalogMock.mockResolvedValue({
      models: new Map([['catalog-only-model', {
        modelName: 'catalog-only-model',
        quotaType: 0,
        modelRatio: 100,
        completionRatio: 1,
        cacheRatio: 1,
        cacheCreationRatio: 1,
        modelPrice: null,
        enableGroups: ['default'],
      }]]),
      groupRatio: { default: 1 },
    });

    const input = {
      site,
      account,
      tokenId: token.id,
      upstreamGroup: 'paid',
      modelName: 'catalog-only-model',
      promptTokens: 1000,
      completionTokens: 0,
      totalTokens: 1000,
    };

    await expect(pricing.estimateProxyCost(input)).resolves.toBe(0.2);
    await expect(pricing.buildProxyBillingDetails(input)).resolves.toMatchObject({
      source: 'upstream_catalog',
      upstreamCostPricingScope: 'provider_catalog',
      breakdown: {
        inputPerMillion: 200,
        inputCost: 0.2,
        outputCost: 0,
        totalCost: 0.2,
      },
    });
    expect(fetchUpstreamPricingCatalogMock).toHaveBeenCalledTimes(2);
  });
});
