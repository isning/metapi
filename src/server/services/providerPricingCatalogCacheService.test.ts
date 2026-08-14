import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../testing/dbHarness.js';

const fetchUpstreamPricingCatalogWithMetadataMock = vi.hoisted(() => vi.fn());

vi.mock('./upstreamPricingCatalogService.js', () => ({
  fetchUpstreamPricingCatalogWithMetadata: fetchUpstreamPricingCatalogWithMetadataMock,
}));

type DbModule = typeof import('../db/index.js');
type ServiceModule = typeof import('./providerPricingCatalogCacheService.js');

describe('providerPricingCatalogCacheService', () => {
  let runtimeDb: IsolatedRuntimeDbHandle;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let service: ServiceModule;

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-provider-pricing-cache-');
    db = runtimeDb.dbModule.db;
    schema = runtimeDb.dbModule.schema;
    service = await import('./providerPricingCatalogCacheService.js');
  });

  beforeEach(async () => {
    fetchUpstreamPricingCatalogWithMetadataMock.mockReset();
    await db.delete(schema.providerPricingCatalogCaches).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await runtimeDb.cleanup();
  });

  it('refreshes and reads a fresh provider pricing catalog cache', async () => {
    const { site, account } = await seedSubject(db, schema);
    fetchUpstreamPricingCatalogWithMetadataMock.mockResolvedValue({
      catalog: catalogWithModel('catalog-model'),
      credentialKind: 'access_token',
    });

    const refreshed = await service.refreshProviderPricingCatalog({
      siteId: site.id,
      accountId: account.id,
      ttlMs: 60_000,
    });

    expect(refreshed.status).toBe('success');
    expect(refreshed.record).toMatchObject({
      siteId: site.id,
      accountId: account.id,
      modelCount: 1,
      groupCount: 1,
      credentialKind: 'access_token',
      lastStatus: 'success',
    });
    const cached = await service.getCachedProviderPricingCatalog({
      siteId: site.id,
      accountId: account.id,
      maxAgeMs: 60_000,
    });
    expect(cached?.catalog?.models.get('catalog-model')?.modelName).toBe('catalog-model');
    const projectionCatalogs = await service.listCachedProviderPricingCatalogs();
    expect(projectionCatalogs).toEqual([
      expect.objectContaining({
        siteId: site.id,
        accountId: account.id,
        catalog: expect.objectContaining({}),
      }),
    ]);
  });

  it('records refresh failures without deleting the previous successful catalog', async () => {
    const { site, account } = await seedSubject(db, schema);
    fetchUpstreamPricingCatalogWithMetadataMock.mockResolvedValueOnce({
      catalog: catalogWithModel('kept-model'),
      credentialKind: 'api_token',
    });
    await service.refreshProviderPricingCatalog({
      siteId: site.id,
      accountId: account.id,
      ttlMs: 60_000,
    });

    fetchUpstreamPricingCatalogWithMetadataMock.mockRejectedValueOnce(new Error('upstream unavailable'));
    const failed = await service.refreshProviderPricingCatalog({
      siteId: site.id,
      accountId: account.id,
      ttlMs: 60_000,
    });

    expect(failed.status).toBe('error');
    expect(failed.record).toMatchObject({
      siteId: site.id,
      accountId: account.id,
      modelCount: 1,
      lastStatus: 'error',
      lastError: 'upstream unavailable',
    });
    expect(failed.record?.catalog?.models.get('kept-model')?.modelName).toBe('kept-model');
  });

  it('only schedules missing or expiring catalog subjects for refresh', async () => {
    const { site, account } = await seedSubject(db, schema);
    fetchUpstreamPricingCatalogWithMetadataMock.mockResolvedValue({
      catalog: catalogWithModel('scheduled-model'),
      credentialKind: 'access_token',
    });
    await service.refreshProviderPricingCatalog({
      siteId: site.id,
      accountId: account.id,
      ttlMs: 60_000,
    });

    await expect(service.listDueProviderPricingCatalogRefreshSubjects({
      nowMs: Date.now(),
      dueWithinMs: 1_000,
    })).resolves.toEqual(expect.arrayContaining([
      { siteId: site.id, accountId: null },
    ]));
    await expect(service.listDueProviderPricingCatalogRefreshSubjects({
      nowMs: Date.now(),
      dueWithinMs: 1_000,
    })).resolves.not.toEqual(expect.arrayContaining([
      { siteId: site.id, accountId: account.id },
    ]));
  });
});

function catalogWithModel(modelName: string) {
  return {
    models: new Map([[modelName, {
      modelName,
      quotaType: 0,
      modelRatio: 1,
      completionRatio: 1,
      cacheRatio: 1,
      cacheCreationRatio: 1,
      modelPrice: { input: 1, output: 2 },
      enableGroups: ['default'],
    }]]),
    groupRatio: { default: 1 },
  };
}

async function seedSubject(db: DbModule['db'], schema: DbModule['schema']) {
  const site = await db.insert(schema.sites).values({
    name: 'Provider Cache Site',
    url: 'https://cache.example.com',
    platform: 'openai',
    apiKey: 'site-key',
  }).returning().get();
  const account = await db.insert(schema.accounts).values({
    siteId: site.id,
    username: 'cache-account',
    credential: 'access-token',

  }).returning().get();
  return { site, account };
}
