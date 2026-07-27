import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { insertRouteGroupMember } from '../../../testing/routeGroupMemberTestUtils.js';

const fetchUpstreamPricingCatalogMock = vi.hoisted(() => vi.fn(async () => null));

vi.mock('../../services/upstreamPricingCatalogService.js', () => ({
  fetchUpstreamPricingCatalog: fetchUpstreamPricingCatalogMock,
  fetchUpstreamPricingCatalogWithMetadata: async (input: unknown) => {
    const catalog = await fetchUpstreamPricingCatalogMock(input);
    return catalog ? { catalog, credentialKind: 'access_token' } : null;
  },
}));

type DbModule = typeof import('../../db/index.js');
type StatsRoutesModule = typeof import('./stats.js');
type MarketplaceReadModelModule = typeof import('../../services/modelsMarketplaceReadModelService.js');
type RouteGroupManagementModule = typeof import('../../services/routeGroupManagementService.js');
type RouteGroupGraphTestHarnessModule = typeof import('../../test/routeGroupGraphTestHarness.js');
type RouteRuntimeArtifactModule = typeof import('../../services/routeRuntimeArtifactService.js');
type ProviderPricingCatalogCacheModule = typeof import('../../services/providerPricingCatalogCacheService.js');

describe('/api/models/marketplace compiled runtime inventory', () => {
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let resetModelsMarketplaceCacheForTests: MarketplaceReadModelModule['resetModelsMarketplaceReadModelForTests'];
  let createRouteGroupFromPayload: RouteGroupManagementModule['createRouteGroupFromPayload'];
  let publishRouteGroupGraphForTest: RouteGroupGraphTestHarnessModule['publishRouteGroupGraphForTest'];
  let invalidateRouteRuntimeArtifactReadCaches: RouteRuntimeArtifactModule['invalidateRouteRuntimeArtifactReadCaches'];
  let refreshProviderPricingCatalog: ProviderPricingCatalogCacheModule['refreshProviderPricingCatalog'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-stats-marketplace-'));
    process.env.DATA_DIR = dataDir;

    vi.resetModules();
    const migrate = await import('../../db/migrate.js');
    await migrate.runSqliteMigrations();
    const dbModule = await import('../../db/index.js');
    const routesModule = await import('./stats.js');
    const marketplaceReadModel = await import('../../services/modelsMarketplaceReadModelService.js');
    const routeGroupManagement = await import('../../services/routeGroupManagementService.js');
    const routeGroupGraphTestHarness = await import('../../test/routeGroupGraphTestHarness.js');
    const routeRuntimeArtifactService = await import('../../services/routeRuntimeArtifactService.js');
    const providerPricingCatalogCacheService = await import('../../services/providerPricingCatalogCacheService.js');
    db = dbModule.db;
    schema = dbModule.schema;
    resetModelsMarketplaceCacheForTests = marketplaceReadModel.resetModelsMarketplaceReadModelForTests;
    createRouteGroupFromPayload = routeGroupManagement.createRouteGroupFromPayload;
    publishRouteGroupGraphForTest = routeGroupGraphTestHarness.publishRouteGroupGraphForTest;
    invalidateRouteRuntimeArtifactReadCaches = routeRuntimeArtifactService.invalidateRouteRuntimeArtifactReadCaches;
    refreshProviderPricingCatalog = providerPricingCatalogCacheService.refreshProviderPricingCatalog;

    app = Fastify();
    await app.register(routesModule.statsRoutes);
  });

  beforeEach(async () => {
    fetchUpstreamPricingCatalogMock.mockReset();
    fetchUpstreamPricingCatalogMock.mockResolvedValue(null);
    resetModelsMarketplaceCacheForTests();
    await db.delete(schema.proxyLogs).run();
    await db.delete(schema.proxyRequests).run();
    await db.delete(schema.providerPricingCatalogCaches).run();
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.compiledRuntimeActiveArtifact).run();
    await db.delete(schema.compiledRuntimeArtifacts).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.tokenModelAvailability).run();
    await db.delete(schema.modelAvailability).run();
    await db.delete(schema.upstreamModelCostPricings).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.checkinLogs).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DATA_DIR;
  });

  async function seedCompiledRuntimeModel(modelName: string) {
    const site = await db.insert(schema.sites).values({
      name: `${modelName}-site`,
      url: `https://${modelName}.example.test`,
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: `${modelName}-user`,
      accessToken: `${modelName}-access`,
      status: 'active',
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: `${modelName}-token`,
      token: `sk-${modelName}`,
      valueStatus: 'ready',
      enabled: true,
      isDefault: true,
    }).returning().get();
    const summary = await createRouteGroupFromPayload({
      model: {
        publicName: modelName,
        upstreamName: modelName,
      },
      presentation: {
        displayName: null,
        displayIcon: null,
      },
      dispatcherPolicy: { kind: 'builtin', builtin: 'weighted' },
      enabled: true,
    });
    await insertRouteGroupMember({
      groupId: summary.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: modelName,
      enabled: true,
    });
    const published = await publishRouteGroupGraphForTest('marketplace-test');
    expect(published.status).toBe('active');
    return { site, account, token, group: summary };
  }

  async function removeFirstCompiledExecutionTargetId() {
    const active = await db.select({
      artifactId: schema.compiledRuntimeActiveArtifact.artifactId,
      artifactJson: schema.compiledRuntimeArtifacts.artifactJson,
    })
      .from(schema.compiledRuntimeActiveArtifact)
      .innerJoin(schema.compiledRuntimeArtifacts, eq(
        schema.compiledRuntimeActiveArtifact.artifactId,
        schema.compiledRuntimeArtifacts.id,
      ))
      .get();
    expect(active).toBeTruthy();
    const artifact = JSON.parse(active!.artifactJson) as {
      compiledRouterBundle?: {
        executionTable?: {
          attempts?: Array<unknown[]>;
        };
      };
    };
    const executionAttempt = artifact.compiledRouterBundle?.executionTable?.attempts?.find((value) => {
      const transportBinding = value?.[9];
      return !!transportBinding
        && typeof transportBinding === 'object'
        && !Array.isArray(transportBinding)
        && Object.hasOwn(transportBinding, 'executionTargetId');
    });
    const transportBinding = executionAttempt?.[9];
    expect(transportBinding).toBeTruthy();
    delete (transportBinding as { executionTargetId?: unknown }).executionTargetId;
    await db.update(schema.compiledRuntimeArtifacts)
      .set({ artifactJson: JSON.stringify(artifact) })
      .where(eq(schema.compiledRuntimeArtifacts.id, active!.artifactId))
      .run();
    invalidateRouteRuntimeArtifactReadCaches();
  }

  it('does not expose discovered models without a compiled runtime entry', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'availability-only-site',
      url: 'https://availability-only.example.test',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'availability-user',
      accessToken: 'availability-access',
      status: 'inactive',
    }).returning().get();
    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'availability-only-model',
      available: true,
    }).run();

    const response = await app.inject({ method: 'GET', url: '/api/models/marketplace' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { models?: Array<{ name: string }> };
    expect((body.models || []).map((model) => model.name)).not.toContain('availability-only-model');
  });

  it('exposes models that exist in the active compiled runtime', async () => {
    await seedCompiledRuntimeModel('compiled-market-model');
    const availabilityOnlySite = await db.insert(schema.sites).values({
      name: 'same-model-availability-site',
      url: 'https://same-model-availability.example.test',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const availabilityOnlyAccount = await db.insert(schema.accounts).values({
      siteId: availabilityOnlySite.id,
      username: 'same-model-availability-user',
      accessToken: 'same-model-availability-access',
      status: 'inactive',
    }).returning().get();
    await db.insert(schema.modelAvailability).values({
      accountId: availabilityOnlyAccount.id,
      modelName: 'compiled-market-model',
      available: true,
    }).run();

    const response = await app.inject({ method: 'GET', url: '/api/models/marketplace' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { models?: Array<{ name: string; accountCount?: number; tokenCount?: number }> };
    const model = (body.models || []).find((item) => item.name === 'compiled-market-model');
    expect(model).toBeTruthy();
    expect(model?.accountCount).toBe(1);
    expect(model?.tokenCount).toBe(1);
  }, 20_000);

  it('uses compiled runtime execution attempts as the marketplace pricing source', async () => {
    const { account, site } = await seedCompiledRuntimeModel('compiled-priced-model');
    fetchUpstreamPricingCatalogMock.mockResolvedValue({
      models: new Map([['compiled-priced-model', {
        modelName: 'compiled-priced-model',
        quotaType: 0,
        modelRatio: 1,
        completionRatio: 1,
        cacheRatio: null,
        cacheCreationRatio: null,
        modelPrice: { input: 5, output: 7 },
        enableGroups: ['default'],
        modelDescription: 'Cached model metadata',
        tags: ['cached'],
        supportedEndpointTypes: ['chat_completions'],
      }]]),
      groupRatio: { default: 1 },
    });
    await refreshProviderPricingCatalog({
      siteId: site.id,
      accountId: account.id,
      ttlMs: 60_000,
    });
    fetchUpstreamPricingCatalogMock.mockClear();

    const response = await app.inject({ method: 'GET', url: '/api/models/marketplace?includePricing=true' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      models?: Array<{
        name: string;
        description?: string | null;
        tags?: string[];
        supportedEndpointTypes?: string[];
        pricingSources?: Array<{
          siteId: number;
          accountId: number;
          groupPricing: Record<string, {
            inputPerMillion?: number;
            outputPerMillion?: number;
          }>;
        }>;
      }>;
    };
    const model = (body.models || []).find((item) => item.name === 'compiled-priced-model');
    expect(model?.pricingSources).toEqual([
      expect.objectContaining({
        siteId: site.id,
        accountId: account.id,
        groupPricing: {
          default: expect.objectContaining({
            inputPerMillion: 5,
            outputPerMillion: 7,
          }),
        },
      }),
    ]);
    expect(fetchUpstreamPricingCatalogMock).not.toHaveBeenCalled();
    expect(model).toMatchObject({
      description: 'Cached model metadata',
      tags: ['cached'],
      supportedEndpointTypes: ['chat_completions'],
    });
  }, 10_000);

  it('rejects malformed persisted compiled runtime artifacts at the loader boundary', async () => {
    await seedCompiledRuntimeModel('compiled-invalid-attempt-model');
    await removeFirstCompiledExecutionTargetId();

    const response = await app.inject({ method: 'GET', url: '/api/models/marketplace' });
    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('invalid');
  });
});
