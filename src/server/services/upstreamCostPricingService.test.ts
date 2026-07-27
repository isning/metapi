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
type ServiceModule = typeof import('./upstreamCostPricingService.js');

describe('upstreamCostPricingService', () => {
  let runtimeDb: IsolatedRuntimeDbHandle;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let service: ServiceModule;

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-upstream-cost-service-');
    db = runtimeDb.dbModule.db;
    schema = runtimeDb.dbModule.schema;
    service = await import('./upstreamCostPricingService.js');
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

  it('resolves the most specific upstream supply pricing', async () => {
    const { site, account, token } = await seedSupply(db, schema);
    const modelName = 'gpt-5.5';

    await service.createUpstreamCostPricing({
      scope: 'site_model',
      siteId: site.id,
      modelName,
      plan: service.createSimpleTokenPricingPlan({ inputPerMillion: 1 }),
    });
    await service.createUpstreamCostPricing({
      scope: 'account_model',
      siteId: site.id,
      accountId: account.id,
      modelName,
      plan: service.createSimpleTokenPricingPlan({ inputPerMillion: 2 }),
    });
    await service.createUpstreamCostPricing({
      scope: 'token_model',
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      modelName,
      plan: service.createSimpleTokenPricingPlan({ inputPerMillion: 3 }),
    });
    const groupPricing = await service.createUpstreamCostPricing({
      scope: 'token_model_group',
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      tokenGroup: 'premium',
      modelName,
      plan: service.createSimpleTokenPricingPlan({ inputPerMillion: 4 }),
    });

    await expect(service.resolveUpstreamCostPricing({
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      tokenGroup: 'premium',
      modelName: 'GPT-5.5',
    })).resolves.toMatchObject({
      pricing: { id: groupPricing.id },
      matchedScope: 'token_model_group',
      priority: 400,
    });

    await expect(service.resolveUpstreamCostPricing({
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      modelName,
    })).resolves.toMatchObject({
      matchedScope: 'token_model',
      priority: 300,
    });
  });

  it('evaluates simple token pricing plans with cache writes', async () => {
    const { site, account, token } = await seedSupply(db, schema);
    await service.createUpstreamCostPricing({
      scope: 'token_model',
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      modelName: 'claude-sonnet',
      plan: service.createSimpleTokenPricingPlan({
        inputPerMillion: 3,
        outputPerMillion: 15,
        cacheReadPerMillion: 0.3,
        cacheWritePerMillion: 3.75,
      }),
    });

    const result = await service.evaluateUpstreamCostPricing({
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      modelName: 'claude-sonnet',
      usage: {
        inputTokens: 1000,
        outputTokens: 100,
        cacheReadTokens: 2000,
        cacheWriteTokens: 10,
      },
    });

    expect(result?.evaluation.totalCost).toBe(0.0051375);
    expect(result?.evaluation.source).toBe('user_override');
    expect(result?.evaluation.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'input_tokens', cost: 0.003 }),
      expect.objectContaining({ kind: 'output_tokens', cost: 0.0015 }),
      expect.objectContaining({ kind: 'cache_read_tokens', cost: 0.0006 }),
      expect.objectContaining({ kind: 'cache_write_tokens', cost: 0.0000375 }),
    ]));
  });

  it('falls back to automatically fetched upstream catalog pricing', async () => {
    const { site, account, token } = await seedSupply(db, schema);
    fetchUpstreamPricingCatalogMock.mockResolvedValue({
      models: new Map([['gpt-5.5', {
        modelName: 'gpt-5.5',
        quotaType: 0,
        modelRatio: 2,
        completionRatio: 4,
        cacheRatio: 0.25,
        cacheCreationRatio: 1.5,
        modelPrice: null,
        enableGroups: ['default', 'premium'],
      }]]),
      groupRatio: { default: 1, premium: 0.5 },
    });

    const result = await service.evaluateUpstreamCostPricing({
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      tokenGroup: 'premium',
      modelName: 'GPT-5.5',
      providerCatalogMode: 'refresh',
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      },
    });

    expect(fetchUpstreamPricingCatalogMock).toHaveBeenCalledWith({
      site: {
        id: site.id,
        url: site.url,
        platform: site.platform,
        apiKey: site.apiKey,
      },
      account: {
        id: account.id,
        username: account.username,
        accessToken: account.accessToken,
        apiToken: account.apiToken,
        extraConfig: account.extraConfig,
      },
    });
    expect(result).toMatchObject({
      matchedScope: 'provider_catalog',
      priority: 10,
      pricing: {
        id: 0,
        sourceType: 'provider_catalog',
        tokenGroup: 'premium',
      },
    });
    expect(result?.evaluation.source).toBe('upstream_catalog');
    expect(result?.evaluation.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'input_tokens', unitPrice: 2, cost: 2 }),
      expect.objectContaining({ kind: 'output_tokens', unitPrice: 8, cost: 8 }),
    ]));
  });

  it('does not synthesize zero output pricing when upstream catalog omits output price', async () => {
    const { site, account, token } = await seedSupply(db, schema);
    fetchUpstreamPricingCatalogMock.mockResolvedValue({
      models: new Map([['deepseek-v4-flash', {
        modelName: 'deepseek-v4-flash',
        quotaType: 0,
        modelRatio: 1,
        completionRatio: 1,
        cacheRatio: 1,
        cacheCreationRatio: 1,
        modelPrice: { input: 0.7 },
        enableGroups: ['default'],
      }]]),
      groupRatio: { default: 1 },
    });

    const result = await service.evaluateUpstreamCostPricing({
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      modelName: 'deepseek-v4-flash',
      providerCatalogMode: 'refresh',
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      },
    });

    expect(result?.evaluation.components).toEqual([
      expect.objectContaining({ kind: 'input_tokens', unitPrice: 0.7, cost: 0.7 }),
    ]);
    expect(result?.evaluation.components.some((component) => component.kind === 'output_tokens')).toBe(false);
    expect(result?.evaluation.components.some((component) => component.kind === 'cache_read_tokens')).toBe(false);
    expect(result?.evaluation.components.some((component) => component.kind === 'cache_write_tokens')).toBe(false);
    expect(result?.evaluation.totalCost).toBe(0.7);
  });

  it('treats missing provider catalog cache ratios as zero-priced cache usage', async () => {
    const { site, account, token } = await seedSupply(db, schema);
    fetchUpstreamPricingCatalogMock.mockResolvedValue({
      models: new Map([['ratio-model-without-cache', {
        modelName: 'ratio-model-without-cache',
        quotaType: 0,
        modelRatio: 2,
        completionRatio: 3,
        modelPrice: null,
        enableGroups: ['default'],
      }]]),
      groupRatio: { default: 1 },
    });

    const result = await service.evaluateUpstreamCostPricing({
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      modelName: 'ratio-model-without-cache',
      providerCatalogMode: 'refresh',
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      },
    });

    expect(result?.evaluation.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'input_tokens', unitPrice: 4, cost: 4 }),
      expect.objectContaining({ kind: 'output_tokens', unitPrice: 12, cost: 12 }),
    ]));
    expect(result?.evaluation.components.some((component) => component.kind === 'cache_read_tokens')).toBe(false);
    expect(result?.evaluation.components.some((component) => component.kind === 'cache_write_tokens')).toBe(false);
    expect(result?.evaluation.totalCost).toBe(16);
  });

  it('preserves explicit zero provider catalog cache prices as pricing components', async () => {
    const { site, account, token } = await seedSupply(db, schema);
    fetchUpstreamPricingCatalogMock.mockResolvedValue({
      models: new Map([['explicit-zero-cache-model', {
        modelName: 'explicit-zero-cache-model',
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

    const result = await service.evaluateUpstreamCostPricing({
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      modelName: 'explicit-zero-cache-model',
      providerCatalogMode: 'refresh',
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      },
    });

    expect(result?.evaluation.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'input_tokens', unitPrice: 4, cost: 4 }),
      expect.objectContaining({ kind: 'output_tokens', unitPrice: 12, cost: 12 }),
      expect.objectContaining({ kind: 'cache_read_tokens', unitPrice: 0, cost: 0 }),
      expect.objectContaining({ kind: 'cache_write_tokens', unitPrice: 0, cost: 0 }),
    ]));
    expect(result?.evaluation.totalCost).toBe(16);
  });

  it('preserves direct upstream catalog cache read and write prices', async () => {
    const { site, account, token } = await seedSupply(db, schema);
    fetchUpstreamPricingCatalogMock.mockResolvedValue({
      models: new Map([['onehub-cache-model', {
        modelName: 'onehub-cache-model',
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

    const result = await service.evaluateUpstreamCostPricing({
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      tokenGroup: 'vip',
      modelName: 'onehub-cache-model',
      providerCatalogMode: 'refresh',
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      },
    });

    expect(result?.evaluation.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'input_tokens', unitPrice: 0.4, cost: 0.4 }),
      expect.objectContaining({ kind: 'output_tokens', unitPrice: 1.2, cost: 1.2 }),
      expect.objectContaining({ kind: 'cache_read_tokens', unitPrice: 0.08, cost: 0.08 }),
      expect.objectContaining({ kind: 'cache_write_tokens', unitPrice: 0.6, cost: 0.6 }),
    ]));
    expect(result?.evaluation.totalCost).toBe(2.28);
  });

  it('uses upstream catalog fallback as default platform pricing source', async () => {
    const { site, account, token } = await seedSupply(db, schema);
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
      models: new Map([['gpt-5.5', {
        modelName: 'gpt-5.5',
        quotaType: 0,
        modelRatio: 2,
        completionRatio: 3,
        cacheRatio: 1,
        cacheCreationRatio: 1,
        modelPrice: null,
        enableGroups: ['premium'],
      }]]),
      groupRatio: { premium: 1 },
    });

    const result = await service.resolveUpstreamCostPricing({
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      tokenGroup: 'premium',
      modelName: 'gpt-5.5',
      providerCatalogMode: 'refresh',
    });

    expect(result).toMatchObject({
      matchedScope: 'provider_catalog',
      pricing: {
        sourceType: 'provider_catalog',
      },
    });
    expect(fetchUpstreamPricingCatalogMock).toHaveBeenCalledTimes(1);
  });

  it('does not refresh provider catalog from the default cache-only read path', async () => {
    const { site, account, token } = await seedSupply(db, schema);
    fetchUpstreamPricingCatalogMock.mockResolvedValue({
      models: new Map([['gpt-5.5', {
        modelName: 'gpt-5.5',
        quotaType: 0,
        modelRatio: 2,
        completionRatio: 3,
        cacheRatio: 1,
        cacheCreationRatio: 1,
        modelPrice: null,
        enableGroups: ['premium'],
      }]]),
      groupRatio: { premium: 1 },
    });

    const result = await service.resolveUpstreamCostPricing({
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      tokenGroup: 'premium',
      modelName: 'gpt-5.5',
    });

    expect(result).toMatchObject({
      matchedScope: 'system_default',
      pricing: {
        sourceType: 'system_default',
      },
    });
    expect(fetchUpstreamPricingCatalogMock).not.toHaveBeenCalled();
  });

  it('does not refresh provider catalog again while a failure cache is fresh', async () => {
    const { site, account, token } = await seedSupply(db, schema);
    fetchUpstreamPricingCatalogMock.mockResolvedValue(null);

    const first = await service.resolveUpstreamCostPricing({
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      tokenGroup: 'premium',
      modelName: 'gpt-5.5',
      providerCatalogMode: 'refresh',
    });

    expect(first).toMatchObject({
      matchedScope: 'system_default',
      pricing: {
        sourceType: 'system_default',
      },
    });
    expect(fetchUpstreamPricingCatalogMock).toHaveBeenCalledTimes(1);

    const second = await service.resolveUpstreamCostPricing({
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      tokenGroup: 'premium',
      modelName: 'gpt-5.5',
    });

    expect(second).toMatchObject({
      matchedScope: 'system_default',
      pricing: {
        sourceType: 'system_default',
      },
    });
    expect(fetchUpstreamPricingCatalogMock).toHaveBeenCalledTimes(1);
  });
});

async function seedSupply(db: DbModule['db'], schema: DbModule['schema']) {
  const site = await db.insert(schema.sites).values({
    name: 'Cost Site',
    url: 'https://cost.example.com',
    platform: 'openai',
  }).returning().get();
  const account = await db.insert(schema.accounts).values({
    siteId: site.id,
    username: 'cost-account',
    accessToken: 'access-token',
  }).returning().get();
  const token = await db.insert(schema.accountTokens).values({
    accountId: account.id,
    name: 'premium-token',
    token: 'sk-premium',
    tokenGroup: 'premium',
  }).returning().get();
  return { site, account, token };
}
