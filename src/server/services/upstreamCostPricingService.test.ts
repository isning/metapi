import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../testing/dbHarness.js';

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

    expect(result?.evaluation.totalCostUsd).toBe(0.0051375);
    expect(result?.evaluation.source).toBe('user_override');
    expect(result?.evaluation.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'input_tokens', costUsd: 0.003 }),
      expect.objectContaining({ kind: 'output_tokens', costUsd: 0.0015 }),
      expect.objectContaining({ kind: 'cache_read_tokens', costUsd: 0.0006 }),
      expect.objectContaining({ kind: 'cache_write_tokens', costUsd: 0.0000375 }),
    ]));
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
