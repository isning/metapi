import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../testing/dbHarness.js';

const fetchUpstreamPricingCatalogMock = vi.hoisted(() => vi.fn());

vi.mock('./upstreamPricingCatalogService.js', () => ({
  fetchUpstreamPricingCatalog: fetchUpstreamPricingCatalogMock,
  fetchUpstreamPricingCatalogWithMetadata: async (input: unknown) => {
    const catalog = await fetchUpstreamPricingCatalogMock(input);
    return catalog ? { catalog, credentialKind: 'access_token' } : null;
  },
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
    await db.delete(schema.providerPricingCatalogCaches).run();
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
      scope: 'token_model',
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
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
      quote: {
        amount: 0.02,
        unit: 'currency',
        source: 'upstream_cost_pricing',
        matchedScope: 'token_model',
      },
      breakdown: {
        inputPerMillion: 10,
        outputPerMillion: 20,
        inputCost: 0.01,
        outputCost: 0.01,
        totalCost: 0.02,
      },
    });
  });

  it('charges standard input only for non-cached prompt tokens in unified upstream pricing', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Manual Cache Cost',
      url: 'https://manual-cache-cost.example.com',
      platform: 'openai',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'manual-cache',
      accessToken: 'access-token',
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'paid',
      token: 'sk-paid',
      tokenGroup: 'paid',
    }).returning().get();
    await upstreamCost.createUpstreamCostPricing({
      scope: 'token_model',
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      modelName: 'manual-cache-priced-model',
      plan: upstreamCost.createSimpleTokenPricingPlan({
        inputPerMillion: 10,
        outputPerMillion: 20,
        cacheReadPerMillion: 1,
        cacheWritePerMillion: 5,
      }),
    });

    const input = {
      site,
      account,
      tokenId: token.id,
      upstreamGroup: 'paid',
      modelName: 'manual-cache-priced-model',
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      cacheReadTokens: 300,
      cacheCreationTokens: 100,
      promptTokensIncludeCache: true,
    };

    await expect(pricing.estimateProxyCost(input)).resolves.toBe(0.0168);
    await expect(pricing.buildProxyBillingDetails(input)).resolves.toMatchObject({
      usage: {
        promptTokens: 1000,
        billablePromptTokens: 600,
        cacheReadTokens: 300,
        cacheCreationTokens: 100,
      },
      breakdown: {
        inputPerMillion: 10,
        outputPerMillion: 20,
        cacheReadPerMillion: 1,
        cacheCreationPerMillion: 5,
        inputCost: 0.006,
        outputCost: 0.01,
        cacheReadCost: 0.0003,
        cacheCreationCost: 0.0005,
        totalCost: 0.0168,
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
      quote: {
        amount: 0.2,
        unit: 'currency',
        source: 'provider_catalog',
        matchedScope: 'provider_catalog',
      },
      breakdown: {
        inputPerMillion: 200,
        inputCost: 0.2,
        outputCost: 0,
        totalCost: 0.2,
      },
    });
    expect(fetchUpstreamPricingCatalogMock).toHaveBeenCalledTimes(1);
    const cacheRows = await db.select().from(schema.providerPricingCatalogCaches).all();
    expect(cacheRows).toHaveLength(1);
    expect(cacheRows[0]).toMatchObject({
      siteId: site.id,
      accountId: account.id,
      modelCount: 1,
      lastStatus: 'success',
    });
  });

  it('uses direct provider catalog token prices in model pricing catalogs', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Direct Catalog Cost',
      url: 'https://direct-catalog.example.com',
      platform: 'openai',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'direct-catalog',
      accessToken: 'access-token',
    }).returning().get();
    fetchUpstreamPricingCatalogMock.mockResolvedValue({
      models: new Map([['direct-cache-model', {
        modelName: 'direct-cache-model',
        quotaType: 0,
        modelRatio: 1,
        completionRatio: 1,
        cacheRatio: 0.2,
        cacheCreationRatio: 1.5,
        modelPrice: {
          input: 0.5,
          output: 1.5,
          cacheRead: 0.1,
          cacheWrite: 0.75,
        },
        enableGroups: ['default', 'vip'],
      }]]),
      groupRatio: { default: 1, vip: 0.8 },
    });

    const catalog = await pricing.refreshModelPricingCatalog({
      site,
      account,
      upstreamGroup: 'vip',
      modelName: 'direct-cache-model',
    });

    expect(catalog?.models[0]?.groupPricing).toMatchObject({
      default: {
        inputPerMillion: 0.5,
        outputPerMillion: 1.5,
        cacheReadPerMillion: 0.1,
        cacheCreationPerMillion: 0.75,
      },
      vip: {
        inputPerMillion: 0.4,
        outputPerMillion: 1.2,
        cacheReadPerMillion: 0.08,
        cacheCreationPerMillion: 0.6,
      },
    });
  });

  it('keeps Sub2API group prices separate in model pricing catalogs', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Sub2API Group Catalog Cost',
      url: 'https://sub2api-group-catalog.example.com',
      platform: 'sub2api',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'sub2api-group-catalog',
      accessToken: 'access-token',
    }).returning().get();
    fetchUpstreamPricingCatalogMock.mockResolvedValue({
      models: new Map([['sub2api-model', {
        modelName: 'sub2api-model',
        quotaType: 0,
        modelRatio: 1,
        completionRatio: 1,
        modelPrice: { input: 2, output: 8, cacheRead: 1, cacheWrite: 3 },
        groupPrices: {
          standard: { input: 2, output: 8, cacheRead: 1, cacheWrite: 3 },
          premium: { input: 1, output: 4, cacheRead: 0.5, cacheWrite: 1.5 },
        },
        enableGroups: ['standard', 'premium'],
      }]]),
      groupRatio: { standard: 1, premium: 1.25 },
    });

    const catalog = await pricing.refreshModelPricingCatalog({
      site,
      account,
      upstreamGroup: 'premium',
      modelName: 'sub2api-model',
    });

    expect(catalog?.models[0]).toMatchObject({
      enableGroups: ['standard', 'premium'],
      groupPricing: {
        standard: {
          inputPerMillion: 2,
          outputPerMillion: 8,
          cacheReadPerMillion: 1,
          cacheCreationPerMillion: 3,
        },
        premium: {
          inputPerMillion: 1.25,
          outputPerMillion: 5,
          cacheReadPerMillion: 0.625,
          cacheCreationPerMillion: 1.875,
        },
      },
    });
  });

  it('omits cache prices in model pricing catalogs when provider catalog omits cache pricing', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Missing Cache Catalog Cost',
      url: 'https://missing-cache-catalog.example.com',
      platform: 'openai',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'missing-cache-catalog',
      accessToken: 'access-token',
    }).returning().get();
    fetchUpstreamPricingCatalogMock.mockResolvedValue({
      models: new Map([['missing-cache-model', {
        modelName: 'missing-cache-model',
        quotaType: 0,
        modelRatio: 2,
        completionRatio: 3,
        modelPrice: null,
        enableGroups: ['default'],
      }]]),
      groupRatio: { default: 1 },
    });

    const catalog = await pricing.refreshModelPricingCatalog({
      site,
      account,
      modelName: 'missing-cache-model',
    });

    expect(catalog?.models[0]?.groupPricing.default).toMatchObject({
      inputPerMillion: 4,
      outputPerMillion: 12,
      cacheReadPerMillion: null,
      cacheCreationPerMillion: null,
    });
  });

  it('preserves explicit zero cache prices in model pricing catalogs', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Zero Cache Catalog Cost',
      url: 'https://zero-cache-catalog.example.com',
      platform: 'openai',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'zero-cache-catalog',
      accessToken: 'access-token',
    }).returning().get();
    fetchUpstreamPricingCatalogMock.mockResolvedValue({
      models: new Map([['zero-cache-model', {
        modelName: 'zero-cache-model',
        quotaType: 0,
        modelRatio: 2,
        completionRatio: 3,
        cacheRatio: 0,
        cacheCreationRatio: 0,
        modelPrice: null,
        enableGroups: ['default'],
      }]]),
      groupRatio: { default: 1 },
    });

    const catalog = await pricing.refreshModelPricingCatalog({
      site,
      account,
      modelName: 'zero-cache-model',
    });

    expect(catalog?.models[0]?.groupPricing.default).toMatchObject({
      inputPerMillion: 4,
      outputPerMillion: 12,
      cacheReadPerMillion: 0,
      cacheCreationPerMillion: 0,
    });
  });
});
