import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { createTestApp, type TestAppHandle } from '../../../testing/appHarness.js';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../../testing/dbHarness.js';
import { tokenRouteFixture } from '../../test/routeGraphFixtures.js';

type DbModule = typeof import('../../db/index.js');
type TokenRouterModule = typeof import('../../services/tokenRouter.js');
type RouteGraphRuntimeModule = typeof import('../../services/routeGraphRuntimeService.js');
type RouteTableProjectionModule = typeof import('../../services/routeTableProjectionService.js');
type ModelsMarketplaceCacheServiceModule = typeof import('../../services/modelsMarketplaceCacheService.js');

describe('/api/route-graph lifecycle', () => {
  let app: TestAppHandle;
  let runtimeDb: IsolatedRuntimeDbHandle;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let invalidateTokenRouterCache: TokenRouterModule['invalidateTokenRouterCache'];
  let resetTokenRouteReadLimitersForTests: (options?: { summaryPoints?: number; listPoints?: number }) => void;
  let evaluateActiveRouteGraphForModel: RouteGraphRuntimeModule['evaluateActiveRouteGraphForModel'];
  let applyRouteGraphPostBuildFilters: RouteGraphRuntimeModule['applyRouteGraphPostBuildFilters'];
  let syncRouteBindingProjectionsFromRouteTable: RouteTableProjectionModule['syncRouteBindingProjectionsFromRouteTable'];
  let upsertRouteBindingProjections: RouteTableProjectionModule['upsertRouteBindingProjections'];
  let writeModelsMarketplaceCache: ModelsMarketplaceCacheServiceModule['writeModelsMarketplaceCache'];
  let clearModelsMarketplaceCache: ModelsMarketplaceCacheServiceModule['clearModelsMarketplaceCache'];

  async function seedRoutableRoute(model = 'graph-api-model', options: { siteName?: string; siteUrl?: string } = {}) {
    const site = await db.insert(schema.sites).values({
      name: options.siteName || `${model}-site`,
      url: options.siteUrl || `https://${model}.example.com`,
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: `${model}-account`,
      accessToken: `${model}-access`,
      apiToken: `${model}-api`,
      status: 'active',
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: `${model}-token`,
      token: `sk-${model}`,
      enabled: true,
      isDefault: true,
    }).returning().get();
    const route = await db.insert(schema.tokenRoutes).values({
      ...tokenRouteFixture({ modelPattern: model }),
      enabled: true,
    }).returning().get();
    const channel = await db.insert(schema.routeEndpointTargets).values({
      routeId: route.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: model,
      priority: 0,
      weight: 10,
      enabled: true,
    }).returning().get();
    return { site, account, token, route, channel };
  }

  async function seedRouteGroups(input: { groupCount: number; sourcesPerGroup: number }) {
    const site = await db.insert(schema.sites).values({
      name: 'large-summary-site',
      url: 'https://large-summary.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'large-summary-account',
      accessToken: 'large-summary-access',
      apiToken: 'large-summary-api',
      status: 'active',
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'large-summary-token',
      token: 'sk-large-summary',
      enabled: true,
      isDefault: true,
    }).returning().get();

    const sourceRouteIdsByGroup: number[][] = [];
    for (let groupIndex = 0; groupIndex < input.groupCount; groupIndex += 1) {
      const sourceRouteIds: number[] = [];
      for (let sourceIndex = 0; sourceIndex < input.sourcesPerGroup; sourceIndex += 1) {
        const model = `large-summary-source-${groupIndex}-${sourceIndex}`;
        const route = await db.insert(schema.tokenRoutes).values({
          ...tokenRouteFixture({ modelPattern: model }),
          enabled: true,
        }).returning().get();
        await db.insert(schema.routeEndpointTargets).values({
          routeId: route.id,
          accountId: account.id,
          tokenId: token.id,
          sourceModel: model,
          priority: sourceIndex,
          weight: 10,
          enabled: true,
        }).run();
        sourceRouteIds.push(route.id);
      }
      sourceRouteIdsByGroup.push(sourceRouteIds);
    }

    for (let groupIndex = 0; groupIndex < input.groupCount; groupIndex += 1) {
      const groupRoute = await db.insert(schema.tokenRoutes).values({
        ...tokenRouteFixture({ modelPattern: `large-summary-group-${groupIndex}` }),
        enabled: true,
      }).returning().get();
      await db.insert(schema.routeGroupSources).values(sourceRouteIdsByGroup[groupIndex].map((sourceRouteId) => ({
        groupRouteId: groupRoute.id,
        sourceRouteId,
      }))).run();
    }
  }

  function chunkValues<T>(values: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
      chunks.push(values.slice(index, index + size));
    }
    return chunks;
  }

  async function seedLargeExplicitRouteGroups(groupCount: number) {
    const site = await db.insert(schema.sites).values({
      name: 'ten-thousand-route-groups-site',
      url: 'https://ten-thousand-route-groups.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'ten-thousand-route-groups-account',
      accessToken: 'ten-thousand-route-groups-access',
      apiToken: 'ten-thousand-route-groups-api',
      status: 'active',
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'ten-thousand-route-groups-token',
      token: 'sk-ten-thousand-route-groups',
      enabled: true,
      isDefault: true,
    }).returning().get();

    const sourceRoutes: Array<typeof schema.tokenRoutes.$inferSelect> = [];
    for (const chunk of chunkValues(Array.from({ length: groupCount }, (_, index) => index), 250)) {
      sourceRoutes.push(...await db.insert(schema.tokenRoutes).values(chunk.map((index) => ({
        displayName: `scale-source-${index}`,
        displayIcon: null,
        modelMapping: null,
        routingStrategy: 'weighted',
        enabled: true,
      }))).returning().all());
    }
    for (const chunk of chunkValues(sourceRoutes, 250)) {
      await db.insert(schema.routeEndpointTargets).values(chunk.map((route, index) => ({
        routeId: route.id,
        accountId: account.id,
        tokenId: token.id,
        sourceModel: route.displayName || `scale-source-${index}`,
        priority: 0,
        weight: 10,
        enabled: true,
      }))).run();
    }

    const groupRoutes: Array<typeof schema.tokenRoutes.$inferSelect> = [];
    for (const chunk of chunkValues(Array.from({ length: groupCount }, (_, index) => index), 250)) {
      groupRoutes.push(...await db.insert(schema.tokenRoutes).values(chunk.map((index) => ({
        displayName: `scale-group-${index}`,
        displayIcon: null,
        modelMapping: null,
        routingStrategy: 'weighted',
        enabled: true,
      }))).returning().all());
    }
    for (let start = 0; start < groupRoutes.length; start += 250) {
      const groupChunk = groupRoutes.slice(start, start + 250);
      await db.insert(schema.routeGroupSources).values(groupChunk.map((groupRoute, index) => ({
        groupRouteId: groupRoute.id,
        sourceRouteId: sourceRoutes[start + index].id,
      }))).run();
    }
  }

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-route-graph-api-');
    const dbModule = runtimeDb.dbModule;
    const routesModule = await import('./tokens.js');
    const tokenRouterModule = await import('../../services/tokenRouter.js');
    const routeGraphRuntimeModule = await import('../../services/routeGraphRuntimeService.js');
    const routeTableProjectionModule = await import('../../services/routeTableProjectionService.js');
    const modelsMarketplaceCacheServiceModule = await import('../../services/modelsMarketplaceCacheService.js');
    db = dbModule.db;
    schema = dbModule.schema;
    resetTokenRouteReadLimitersForTests = routesModule.resetTokenRouteReadLimitersForTests;
    invalidateTokenRouterCache = tokenRouterModule.invalidateTokenRouterCache;
    evaluateActiveRouteGraphForModel = routeGraphRuntimeModule.evaluateActiveRouteGraphForModel;
    applyRouteGraphPostBuildFilters = routeGraphRuntimeModule.applyRouteGraphPostBuildFilters;
    syncRouteBindingProjectionsFromRouteTable = routeTableProjectionModule.syncRouteBindingProjectionsFromRouteTable;
    upsertRouteBindingProjections = routeTableProjectionModule.upsertRouteBindingProjections;
    writeModelsMarketplaceCache = modelsMarketplaceCacheServiceModule.writeModelsMarketplaceCache;
    clearModelsMarketplaceCache = modelsMarketplaceCacheServiceModule.clearModelsMarketplaceCache;
    app = await createTestApp({
      routes: [routesModule.tokensRoutes],
      auth: 'admin-api',
      env: {
        DATA_DIR: runtimeDb.path,
        DB_TYPE: 'sqlite',
      },
    });
  });

  beforeEach(async () => {
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.routeBindingProjections).run();
    await db.delete(schema.routeGroupSources).run();
    await db.delete(schema.routeEndpointTargets).run();
    await db.delete(schema.tokenRoutes).run();
    await db.delete(schema.tokenModelAvailability).run();
    await db.delete(schema.modelAvailability).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
    clearModelsMarketplaceCache();
    resetTokenRouteReadLimitersForTests();
    invalidateTokenRouterCache();
  });

  afterAll(async () => {
    await app?.close();
    invalidateTokenRouterCache?.();
    await runtimeDb?.cleanup();
  });

  it('returns a lightweight active graph summary by default', async () => {
    await seedRoutableRoute('summary-default-model');

    const response = await app.inject({
      method: 'GET',
      url: '/api/route-graph/active',
      headers: app.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      version: { id: number; status: string };
      sourceSummary: { nodes: number; edges: number; macros: number };
      hashes: { sourceGraph: string; compiledGraph: string | null };
      sourceGraph: unknown;
      compiledGraph: unknown;
    };
    expect(body.version.status).toBe('active');
    expect(body.sourceSummary.nodes).toBeGreaterThan(0);
    expect(body.sourceSummary.edges).toBeGreaterThan(0);
    expect(body.sourceSummary.macros).toBeGreaterThan(0);
    expect(body.version.id).toBe(0);
    expect(body.hashes.sourceGraph).toMatch(/^route-table:/);
    expect(body.sourceGraph).toBeNull();
    expect(body.compiledGraph).toBeNull();
    expect(response.body).not.toContain('"programBundle"');
    expect(response.body).not.toContain('"compiledRouterBundle"');
    const activeVersions = await db.select({ id: schema.routeGraphVersions.id }).from(schema.routeGraphVersions).all();
    expect(activeVersions).toHaveLength(0);
  });

  it('keeps the default active graph payload small for hundreds of route groups', async () => {
    await seedRouteGroups({ groupCount: 630, sourcesPerGroup: 1 });

    const response = await app.inject({
      method: 'GET',
      url: '/api/route-graph/active',
      headers: app.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(Buffer.byteLength(response.body, 'utf8')).toBeLessThan(200_000);
    expect(response.body).not.toContain('"sourceGraph":{"nodes"');
    expect(response.body).not.toContain('"compiledGraph":{"version"');
    expect(response.body).not.toContain('"programBundle"');
    expect(response.body).not.toContain('"flatProgramBundle"');
    expect(response.body).not.toContain('"compiledRouterBundle"');
  });

  it('serves route summaries from the active source projection without compiled graph hydration', async () => {
    const seeded = await seedRoutableRoute('source-projected-summary-model');
    const bootstrap = await app.inject({
      method: 'GET',
      url: '/api/route-graph/active?include=full',
      headers: app.adminHeaders(),
    });
    expect(bootstrap.statusCode).toBe(200);
    const active = await db.select().from(schema.routeGraphActiveVersion).where(eq(schema.routeGraphActiveVersion.id, 1)).get();
    expect(active?.versionId).toEqual(expect.any(Number));
    await db.update(schema.routeGraphVersions).set({
      compiledGraphJson: '{}',
    }).where(eq(schema.routeGraphVersions.id, active!.versionId)).run();

    const response = await app.inject({
      method: 'GET',
      url: '/api/routes/summary?all=1',
      headers: app.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: seeded.route.id,
        match: expect.objectContaining({ requestedModelPattern: 'source-projected-summary-model' }),
        backend: { kind: 'supply' },
        targetCount: 1,
        enabledTargetCount: 1,
        siteNames: [seeded.site.name],
      }),
    ]));
    const stored = await db.select().from(schema.routeGraphVersions).where(eq(schema.routeGraphVersions.id, active!.versionId)).get();
    expect(stored?.compiledGraphJson).toBe('{}');
  });

  it('persists graph-published automatic source routes as supply projections', async () => {
    const seeded = await seedRoutableRoute('graph-published-source-model');

    const response = await app.inject({
      method: 'GET',
      url: '/api/route-graph/active?include=full',
      headers: app.adminHeaders(),
    });
    expect(response.statusCode).toBe(200);

    const projection = await db.select().from(schema.routeBindingProjections)
      .where(eq(schema.routeBindingProjections.routeId, seeded.route.id))
      .get();
    expect(projection).toBeDefined();
    expect(JSON.parse(projection!.backendJson)).toEqual({ kind: 'supply' });
    expect(projection!.routeMode).toBe('pattern');
    expect(JSON.parse(projection!.sourceRouteIdsJson)).toEqual([]);
  });

  it('keeps duplicate automatic source route projections as supply after graph bootstrap', async () => {
    const first = await seedRoutableRoute('duplicate-source-projection-model');
    const second = await seedRoutableRoute('duplicate-source-projection-model', {
      siteName: 'duplicate-source-projection-model-second-site',
      siteUrl: 'https://duplicate-source-projection-model-second.example.com',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/route-graph/active?include=full',
      headers: app.adminHeaders(),
    });
    expect(response.statusCode).toBe(200);

    const projections = await db.select().from(schema.routeBindingProjections).all();
    const projectionByRouteId = new Map(projections.map((projection) => [projection.routeId, projection]));

    for (const routeId of [first.route.id, second.route.id]) {
      const projection = projectionByRouteId.get(routeId);
      expect(projection).toBeDefined();
      expect(JSON.parse(projection!.backendJson)).toEqual({ kind: 'supply' });
      expect(projection!.routeMode).toBe('pattern');
      expect(JSON.parse(projection!.sourceRouteIdsJson)).toEqual([]);
    }
  });

  it('returns a bounded route summary page by default', async () => {
    await seedRoutableRoute('paged-summary-model-a');
    await seedRoutableRoute('paged-summary-model-b');

    const response = await app.inject({
      method: 'GET',
      url: '/api/routes/summary?pageSize=1',
      headers: app.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [expect.objectContaining({ id: expect.any(Number) })],
      pageInfo: {
        page: 1,
        pageSize: 1,
        totalCount: 2,
        hasMore: true,
      },
    });
    expect(response.json().items).toHaveLength(1);
  });

  it('returns a bounded filtered route summary page with real totals and facets', async () => {
    await seedRoutableRoute('gpt-route-alpha', { siteName: 'route-filter-site-a' });
    await seedRoutableRoute('gpt-route-beta', { siteName: 'route-filter-site-a' });
    await seedRoutableRoute('gpt-route-gamma', { siteName: 'route-filter-site-a' });
    await seedRoutableRoute('gpt-route-other-site', { siteName: 'route-filter-site-b' });
    await seedRoutableRoute('claude-route-sonnet', { siteName: 'route-filter-site-a' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/routes/summary?page=2&pageSize=1&q=gpt&tab=public&brand=OpenAI&site=route-filter-site-a&sortBy=name&sortDir=asc&enabled=enabled',
      headers: app.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: Array<{ match: { requestedModelPattern: string }; siteNames: string[] }>;
      pageInfo: { page: number; pageSize: number; totalCount: number; hasMore: boolean };
      facets: {
        brands: Array<{ name: string; count: number }>;
        sites: Array<{ name: string; count: number }>;
        tabs: { public: number; internal: number; manual: number };
      };
    };

    expect(body.items.map((item) => item.match.requestedModelPattern)).toEqual(['gpt-route-beta']);
    expect(body.items[0]?.siteNames).toEqual(['route-filter-site-a']);
    expect(body.pageInfo).toEqual({
      page: 2,
      pageSize: 1,
      totalCount: 3,
      hasMore: true,
    });
    expect(body.facets.brands).toEqual([
      expect.objectContaining({ name: 'OpenAI', count: 4 }),
    ]);
    expect(body.facets.sites).toEqual([
      expect.objectContaining({ name: 'route-filter-site-a', count: 3 }),
      expect.objectContaining({ name: 'route-filter-site-b', count: 1 }),
    ]);
    expect(body.facets.tabs).toMatchObject({
      public: 4,
      internal: 0,
      manual: 0,
    });
  });

  it('applies route group visibility before paging route summaries', async () => {
    await seedRoutableRoute('minimax-m2.1');
    await seedRoutableRoute('minimaxai/minimax-m2.1');
    const groupRoute = await db.insert(schema.tokenRoutes).values({
      displayName: 'minimax2.1',
      displayIcon: null,
      modelMapping: null,
      routingStrategy: 'weighted',
      enabled: true,
    }).returning().get();
    await upsertRouteBindingProjections([{
      routeId: groupRoute.id,
      match: {
        kind: 'model',
        requestedModelPattern: 're:^(minimax-m2\\.1|minimaxai/minimax-m2\\.1)$',
        displayName: null,
      },
      backend: { kind: 'supply' },
      visibility: 'public',
    }]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/routes/summary?page=1&pageSize=10&tab=public&sortBy=name&sortDir=asc',
      headers: app.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: Array<{
        match: { requestedModelPattern: string };
        presentation: { displayName?: string | null };
      }>;
      pageInfo: { totalCount: number; hasMore: boolean };
    };

    expect(body.items.map((item) => item.match.requestedModelPattern)).toEqual([
      're:^(minimax-m2\\.1|minimaxai/minimax-m2\\.1)$',
    ]);
    expect(body.items[0]?.presentation.displayName).toBe('minimax2.1');
    expect(body.pageInfo).toMatchObject({ totalCount: 1, hasMore: false });
  });

  it('filters route summary pages by endpoint type across the full route set', async () => {
    await seedRoutableRoute('gpt-endpoint-type-a');
    await seedRoutableRoute('gpt-endpoint-type-b');
    await seedRoutableRoute('claude-endpoint-type-a');
    writeModelsMarketplaceCache(true, [
      { name: 'gpt-endpoint-type-a', supportedEndpointTypes: ['openai'] },
      { name: 'gpt-endpoint-type-b', supportedEndpointTypes: ['openai'] },
      { name: 'claude-endpoint-type-a', supportedEndpointTypes: ['anthropic'] },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/routes/summary?page=2&pageSize=1&endpointType=openai&sortBy=name&sortDir=asc',
      headers: app.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: Array<{ match: { requestedModelPattern: string } }>;
      pageInfo: { page: number; pageSize: number; totalCount: number; hasMore: boolean };
      facets: { endpointTypes: Array<{ name: string; count: number }> };
    };

    expect(body.items.map((item) => item.match.requestedModelPattern)).toEqual(['gpt-endpoint-type-b']);
    expect(body.pageInfo).toEqual({
      page: 2,
      pageSize: 1,
      totalCount: 2,
      hasMore: false,
    });
    expect(body.facets.endpointTypes).toEqual([
      { name: 'openai', count: 2 },
      { name: 'anthropic', count: 1 },
    ]);
  });

  it('includes zero-target placeholder routes in the paged route summary projection', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'zero-target-site',
      url: 'https://zero-target.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'zero-target-account',
      accessToken: 'zero-target-access',
      apiToken: 'zero-target-api',
      status: 'active',
    }).returning().get();
    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'zero-target-tail-model',
      available: true,
    }).run();

    const response = await app.inject({
      method: 'GET',
      url: '/api/routes/summary?page=1&pageSize=1&q=zero-target-tail&includeZeroTarget=1',
      headers: app.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: Array<{
        id: number;
        kind?: string;
        readOnly?: boolean;
        match: { requestedModelPattern: string };
        siteNames: string[];
      }>;
      pageInfo: { totalCount: number; hasMore: boolean };
    };

    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      kind: 'zero_target',
      readOnly: true,
      match: { requestedModelPattern: 'zero-target-tail-model' },
      siteNames: ['zero-target-site'],
    });
    expect(body.items[0]!.id).toBeLessThan(0);
    expect(body.pageInfo).toMatchObject({ totalCount: 1, hasMore: false });
  });

  it('does not add zero-target placeholders already covered by a visible group route', async () => {
    const groupRoute = await db.insert(schema.tokenRoutes).values({
      displayName: 'Zero Covered',
      displayIcon: null,
      modelMapping: null,
      routingStrategy: 'weighted',
      enabled: true,
    }).returning().get();
    await upsertRouteBindingProjections([{
      routeId: groupRoute.id,
      match: {
        kind: 'model',
        requestedModelPattern: 're:^(zero-covered-model)$',
        displayName: null,
      },
      backend: { kind: 'supply' },
      visibility: 'public',
    }]);
    const site = await db.insert(schema.sites).values({
      name: 'zero-covered-site',
      url: 'https://zero-covered.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'zero-covered-account',
      accessToken: 'zero-covered-access',
      apiToken: 'zero-covered-api',
      status: 'active',
    }).returning().get();
    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'zero-covered-model',
      available: true,
    }).run();

    const response = await app.inject({
      method: 'GET',
      url: '/api/routes/summary?page=1&pageSize=10&tab=public&includeZeroTarget=1&sortBy=name&sortDir=asc',
      headers: app.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: Array<{
        kind?: string;
        match: { requestedModelPattern: string; displayName?: string | null };
        presentation: { displayName?: string | null };
      }>;
      pageInfo: { totalCount: number; hasMore: boolean };
    };

    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      match: {
        requestedModelPattern: 're:^(zero-covered-model)$',
      },
      presentation: { displayName: 'Zero Covered' },
    });
    expect(body.items.some((item) => item.kind === 'zero_target')).toBe(false);
    expect(body.pageInfo).toMatchObject({ totalCount: 1, hasMore: false });
  });

  it('serves route endpoint catalog from the active source projection without compiled graph hydration', async () => {
    const seeded = await seedRoutableRoute('source-projected-catalog-model');
    const bootstrap = await app.inject({
      method: 'GET',
      url: '/api/route-graph/active?include=full',
      headers: app.adminHeaders(),
    });
    expect(bootstrap.statusCode).toBe(200);
    const active = await db.select().from(schema.routeGraphActiveVersion).where(eq(schema.routeGraphActiveVersion.id, 1)).get();
    expect(active?.versionId).toEqual(expect.any(Number));
    await db.update(schema.routeGraphVersions).set({
      compiledGraphJson: '{}',
    }).where(eq(schema.routeGraphVersions.id, active!.versionId)).run();

    const response = await app.inject({
      method: 'GET',
      url: '/api/route-endpoints?all=1',
      headers: app.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        endpointId: 'route-endpoint:product:auto-model:source-projected-catalog-model',
        routeId: seeded.route.id,
        exposure: 'public',
        endpointKind: 'route_product',
        sourceKind: 'automatic_model_group',
        modelPattern: 'source-projected-catalog-model',
        publicModelName: 'source-projected-catalog-model',
        sourceRouteIds: [seeded.route.id],
        upstreamModels: ['source-projected-catalog-model'],
        siteNames: [seeded.site.name],
      }),
    ]));
    const stored = await db.select().from(schema.routeGraphVersions).where(eq(schema.routeGraphVersions.id, active!.versionId)).get();
    expect(stored?.compiledGraphJson).toBe('{}');
  });

  it('validates, saves, and publishes graph-native drafts without replacing active on invalid publish', async () => {
    const seeded = await seedRoutableRoute();

    const activeResponse = await app.inject({
      method: 'GET',
      url: '/api/route-graph/active?include=full',
      headers: app.adminHeaders(),
    });
    expect(activeResponse.statusCode).toBe(200);
    const activeBody = activeResponse.json() as {
      version: { id: number; status: string };
      sourceGraph: {
        nodes: Array<{ id: string; type: string }>;
        edges: Array<unknown>;
        macros?: Array<unknown>;
      };
      compiledGraph: { publicModels: Array<{ model: string }> };
    };
    expect(activeBody.version.status).toBe('active');
    expect(activeBody.sourceGraph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect.stringMatching(/^route-endpoint:supply:upstream-model:/), type: 'route_endpoint', endpointKind: 'supply' }),
      expect.objectContaining({ id: 'route-endpoint:product:auto-model:graph-api-model', type: 'route_endpoint', endpointKind: 'route_product' }),
    ]));
    expect(activeBody.compiledGraph.publicModels).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'graph-api-model' }),
    ]));

    const invalidGraph = {
      version: 1,
      nodes: [
        {
          id: 'entry.invalid',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'broken-model' },
        },
      ],
      edges: [],
      macros: [],
    };

    const invalidValidation = await app.inject({
      method: 'POST',
      url: '/api/route-graph/validate',
      headers: app.adminHeaders(),
      payload: invalidGraph,
    });
    expect(invalidValidation.statusCode).toBe(200);
    expect(invalidValidation.json()).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'public_entry.no_terminal' }),
      ]),
    });

    const draftSave = await app.inject({
      method: 'PUT',
      url: '/api/route-graph/draft',
      headers: app.adminHeaders(),
      payload: invalidGraph,
    });
    expect(draftSave.statusCode).toBe(200);
    expect(draftSave.json()).toMatchObject({
      success: true,
      draft: {
        baseVersion: activeBody.version.id,
        stale: false,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'public_entry.no_terminal' }),
        ]),
      },
    });

    const rejectedPublish = await app.inject({
      method: 'POST',
      url: '/api/route-graph/draft/publish',
      headers: app.adminHeaders(),
    });
    expect(rejectedPublish.statusCode).toBe(400);
    expect(rejectedPublish.json()).toMatchObject({
      success: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'public_entry.no_terminal' }),
      ]),
    });

    const activeAfterRejectedPublish = await app.inject({
      method: 'GET',
      url: '/api/route-graph/active?include=full',
      headers: app.adminHeaders(),
    });
    expect(activeAfterRejectedPublish.statusCode).toBe(200);
    expect(activeAfterRejectedPublish.json().version.id).toBe(activeBody.version.id);

    const validGraph = {
      version: 1,
      nodes: [
        ...activeBody.sourceGraph.nodes,
        {
          id: 'entry.manual',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'manual-api-model', displayName: 'manual-api-model' },
        },
        {
          id: 'dispatcher.manual',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'weighted' },
        },
        {
          id: 'endpoint.manual',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: seeded.route.id,
          config: {
            targets: [{ targetId: String(seeded.channel.id), model: 'manual-api-model' }],
            targetSelection: { strategy: 'defer_to_router' },
          },
        },
      ],
      edges: [
        ...activeBody.sourceGraph.edges,
        {
          id: 'entry-dispatcher',
          sourceNodeId: 'entry.manual',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'dispatcher.manual',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
        {
          id: 'endpoint-dispatcher',
          sourceNodeId: 'endpoint.manual',
          sourcePortId: 'route.out',
          targetNodeId: 'dispatcher.manual',
          targetPortId: 'route.in',
          kind: 'route_flow',
          ownership: 'manual',
        },
      ],
      macros: activeBody.sourceGraph.macros || [],
      metadata: { testCase: 'route-graph-api' },
    };

    const validValidation = await app.inject({
      method: 'POST',
      url: '/api/route-graph/validate',
      headers: app.adminHeaders(),
      payload: validGraph,
    });
    expect(validValidation.statusCode).toBe(200);
    expect(validValidation.json()).toMatchObject({ ok: true });

    const validDraftSave = await app.inject({
      method: 'PUT',
      url: '/api/route-graph/draft',
      headers: app.adminHeaders(),
      payload: validGraph,
    });
    expect(validDraftSave.statusCode).toBe(200);
    expect(validDraftSave.json().draft.diagnostics).toEqual([]);

    const publish = await app.inject({
      method: 'POST',
      url: '/api/route-graph/draft/publish',
      headers: app.adminHeaders(),
    });
    expect(publish.statusCode).toBe(200);
    expect(publish.json()).toMatchObject({
      success: true,
      version: expect.objectContaining({
        sourceGraph: expect.objectContaining({
          metadata: { testCase: 'route-graph-api' },
        }),
      }),
      diagnostics: [],
    });

    const activeAfterPublish = await app.inject({
      method: 'GET',
      url: '/api/route-graph/active?include=full',
      headers: app.adminHeaders(),
    });
    expect(activeAfterPublish.statusCode).toBe(200);
    expect(activeAfterPublish.json()).toMatchObject({
      sourceGraph: expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: 'entry.manual' }),
        ]),
      }),
      compiledGraph: expect.objectContaining({
        publicModels: expect.arrayContaining([
          expect.objectContaining({ model: 'manual-api-model' }),
        ]),
      }),
    });
  });

  it('lists route endpoint catalog items for automatic route products', async () => {
    const seeded = await seedRoutableRoute('catalog-model');

    const response = await app.inject({
      method: 'GET',
      url: '/api/route-endpoints?all=1',
      headers: app.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        endpointId: 'route-endpoint:product:auto-model:catalog-model',
        routeId: seeded.route.id,
        exposure: 'public',
        endpointKind: 'route_product',
        sourceKind: 'automatic_model_group',
        modelPattern: 'catalog-model',
        publicModelName: 'catalog-model',
        sourceRouteIds: [seeded.route.id],
        upstreamModels: expect.arrayContaining(['catalog-model']),
        siteNames: expect.arrayContaining([seeded.site.name]),
      }),
    ]));
  });

  it('returns a bounded route endpoint catalog page by default', async () => {
    await seedRoutableRoute('paged-catalog-model-a');
    await seedRoutableRoute('paged-catalog-model-b');

    const response = await app.inject({
      method: 'GET',
      url: '/api/route-endpoints?pageSize=1&endpointKind=route_product',
      headers: app.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [expect.objectContaining({ endpointKind: 'route_product' })],
      pageInfo: {
        page: 1,
        pageSize: 1,
        totalCount: expect.any(Number),
        hasMore: true,
      },
    });
    expect(response.json().items).toHaveLength(1);
  });

  it('serves paged route endpoint catalog for ten thousand route groups without bootstrapping active graph', async () => {
    await seedLargeExplicitRouteGroups(10_000);

    const summaryResponse = await app.inject({
      method: 'GET',
      url: '/api/routes/summary?pageSize=5',
      headers: app.adminHeaders(),
    });
    expect(summaryResponse.statusCode).toBe(200);
    const summaryBody = summaryResponse.json() as {
      items: Array<{ presentation: { displayName: string | null }; targetCount: number; enabledTargetCount: number }>;
      pageInfo: { page: number; pageSize: number; totalCount: number; hasMore: boolean };
    };
    expect(summaryBody.items[0]).toMatchObject({
      presentation: expect.objectContaining({ displayName: 'scale-source-0' }),
      targetCount: 1,
      enabledTargetCount: 1,
    });
    expect(summaryBody.pageInfo).toMatchObject({
      page: 1,
      pageSize: 5,
      totalCount: 20_000,
      hasMore: true,
    });
    expect(summaryBody.items).toHaveLength(5);
    expect(Buffer.byteLength(summaryResponse.body, 'utf8')).toBeLessThan(20_000);

    const response = await app.inject({
      method: 'GET',
      url: '/api/route-endpoints?page=2001&pageSize=5&endpointKind=route_product',
      headers: app.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: Array<{ label: string; endpointKind: string; sourceRouteIds: number[] }>;
      pageInfo: { page: number; pageSize: number; totalCount: number; hasMore: boolean };
    };
    expect(body.items).toHaveLength(5);
    expect(body.items[0]).toMatchObject({
      label: 'scale-group-0',
      endpointKind: 'route_product',
    });
    expect(body.items[0].sourceRouteIds).toHaveLength(1);
    expect(body.pageInfo).toMatchObject({
      page: 2001,
      pageSize: 5,
      totalCount: 20_000,
      hasMore: true,
    });

    const supplyResponse = await app.inject({
      method: 'GET',
      url: '/api/route-endpoints?pageSize=5&endpointKind=supply',
      headers: app.adminHeaders(),
    });
    expect(supplyResponse.statusCode).toBe(200);
    const supplyBody = supplyResponse.json() as {
      items: Array<{ label: string; endpointKind: string; modelPattern: string }>;
      pageInfo: { page: number; pageSize: number; totalCount: number; hasMore: boolean };
    };
    expect(supplyBody.items[0]).toMatchObject({
      label: 'scale-source-0',
      endpointKind: 'supply',
      modelPattern: 'scale-source-0',
    });
    expect(supplyBody.pageInfo).toMatchObject({
      page: 1,
      pageSize: 5,
      totalCount: 10_000,
      hasMore: true,
    });
    expect(supplyBody.items).toHaveLength(5);
    expect(await db.select().from(schema.routeGraphVersions).all()).toHaveLength(0);
  }, 30_000);

  it('updates a route against a ten thousand group projection without bootstrapping active graph', async () => {
    await seedLargeExplicitRouteGroups(10_000);
    await syncRouteBindingProjectionsFromRouteTable();
    const groupRoute = await db.select().from(schema.tokenRoutes)
      .where(eq(schema.tokenRoutes.displayName, 'scale-group-0'))
      .get();
    expect(groupRoute).toBeDefined();

    const response = await app.inject({
      method: 'POST',
      url: '/api/routes/batch',
      headers: app.adminHeaders(),
      payload: { ids: [groupRoute!.id], action: 'set_internal' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ success: true, updatedCount: 1 });

    const summaryResponse = await app.inject({
      method: 'GET',
      url: '/api/routes/summary?page=10001&pageSize=1',
      headers: app.adminHeaders(),
    });
    expect(summaryResponse.statusCode).toBe(200);
    expect(summaryResponse.json().items).toEqual([
      expect.objectContaining({
        id: groupRoute!.id,
        visibility: 'internal',
      }),
    ]);

    const endpointResponse = await app.inject({
      method: 'GET',
      url: '/api/route-endpoints?page=2001&pageSize=5&endpointKind=route_product',
      headers: app.adminHeaders(),
    });
    expect(endpointResponse.statusCode).toBe(200);
    expect(endpointResponse.json().items).toContainEqual(expect.objectContaining({
      routeId: groupRoute!.id,
      exposure: 'internal',
    }));
    expect(await db.select().from(schema.routeGraphVersions).all()).toHaveLength(0);
  }, 30_000);

  it('keeps supply endpoint catalog site names scoped to the upstream endpoint', async () => {
    const seeded = await seedRoutableRoute('multi-site-catalog-model');
    const secondSite = await db.insert(schema.sites).values({
      name: 'multi-site-catalog-second-site',
      url: 'https://multi-site-catalog-second.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const secondAccount = await db.insert(schema.accounts).values({
      siteId: secondSite.id,
      username: 'multi-site-catalog-second-account',
      accessToken: 'multi-site-catalog-second-access',
      apiToken: 'multi-site-catalog-second-api',
      status: 'active',
    }).returning().get();
    const secondToken = await db.insert(schema.accountTokens).values({
      accountId: secondAccount.id,
      name: 'multi-site-catalog-second-token',
      token: 'sk-multi-site-catalog-second',
      enabled: true,
      isDefault: true,
    }).returning().get();
    await db.insert(schema.routeEndpointTargets).values({
      routeId: seeded.route.id,
      accountId: secondAccount.id,
      tokenId: secondToken.id,
      sourceModel: 'multi-site-catalog-model',
      priority: 1,
      weight: 10,
      enabled: true,
    }).returning().get();

    const response = await app.inject({
      method: 'GET',
      url: '/api/route-endpoints?all=1',
      headers: app.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const endpoints = response.json() as Array<{ endpointKind: string; routeId: number | null; siteNames: string[]; upstreamModels: string[]; targetCount?: number }>;
    const productEndpoint = endpoints.find((endpoint) => (
      endpoint.endpointKind === 'route_product'
      && endpoint.routeId === seeded.route.id
    ));
    expect(productEndpoint?.siteNames).toEqual(expect.arrayContaining([seeded.site.name, secondSite.name]));
    expect(productEndpoint?.targetCount).toBe(2);

    const supplyEndpoints = endpoints.filter((endpoint) => (
      endpoint.endpointKind === 'supply'
      && endpoint.routeId === seeded.route.id
    ));
    expect(supplyEndpoints.length).toBeGreaterThanOrEqual(2);
    expect(supplyEndpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        siteNames: [seeded.site.name],
        upstreamModels: ['multi-site-catalog-model'],
        targetCount: 1,
      }),
      expect.objectContaining({
        siteNames: [secondSite.name],
        upstreamModels: ['multi-site-catalog-model'],
        targetCount: 1,
      }),
    ]));
    for (const endpoint of supplyEndpoints) {
      expect(endpoint.siteNames).toHaveLength(1);
    }
  });

  it('rebases a stale draft with newly generated model-group macros', async () => {
    const source = await seedRoutableRoute('source-model');

    const initialDraft = await app.inject({
      method: 'GET',
      url: '/api/route-graph/draft',
      headers: app.adminHeaders(),
    });
    expect(initialDraft.statusCode).toBe(200);

    const groupInsert = await db.insert(schema.tokenRoutes).values({
      displayName: 'public-group',
      displayIcon: 'Layers',
      routingStrategy: 'round_robin',
      enabled: true,
    });
    const groupRouteId = Number(groupInsert.lastInsertRowid || groupInsert.insertId);
    await db.insert(schema.routeGroupSources).values({
      groupRouteId,
      sourceRouteId: source.route.id,
    });

    const rebase = await app.inject({
      method: 'POST',
      url: '/api/route-graph/draft/rebase',
      headers: app.adminHeaders(),
    });
    expect(rebase.statusCode).toBe(200);
    expect(rebase.json()).toMatchObject({
      success: true,
      draft: {
        stale: false,
        workingGraph: {
          macros: expect.arrayContaining([
            expect.objectContaining({
              id: `route:${groupRouteId}:model-group`,
              kind: 'candidate_selector',
              ownership: 'auto_generated',
              config: expect.objectContaining({
                policy: { strategy: 'round_robin' },
                presentation: { displayIcon: 'Layers' },
                groups: [
                  expect.objectContaining({
                    input: {
                      kind: 'route_endpoints',
                      endpointIds: [expect.stringMatching(/^route-endpoint:supply:upstream-model:/)],
                    },
                  }),
                ],
              }),
            }),
          ]),
        },
      },
    });
  });

  it('publishes graph-native model-group macros that runtime can select as routable public models', async () => {
    const source = await seedRoutableRoute('macro-source-model');

    const activeResponse = await app.inject({
      method: 'GET',
      url: '/api/route-graph/active?include=full',
      headers: app.adminHeaders(),
    });
    expect(activeResponse.statusCode).toBe(200);
    const activeBody = activeResponse.json() as {
      sourceGraph: {
        nodes: Array<unknown>;
        edges: Array<unknown>;
        macros?: Array<unknown>;
      };
    };
    const supplyEndpoint = activeBody.sourceGraph.nodes.find((node: any) => (
      node?.type === 'route_endpoint'
      && node?.endpointKind === 'supply'
      && Array.isArray(node?.metadata?.sourceRouteIds)
      && node.metadata.sourceRouteIds.includes(source.route.id)
    )) as { id: string } | undefined;
    expect(supplyEndpoint).toBeDefined();

    const graphWithMacro = {
      version: 1,
      nodes: activeBody.sourceGraph.nodes,
      edges: activeBody.sourceGraph.edges,
      macros: [
        ...(activeBody.sourceGraph.macros || []),
        {
          id: 'macro:api:model-group',
          kind: 'candidate_selector',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                visibility: 'public',
                match: {
                  requestedModelPattern: '',
                  displayName: 'macro-public-model',
                },
              },
              output: 'route',
            },
            policy: { strategy: 'priority_order' },
            groups: [
              {
                id: 'priority-0',
                enabled: true,
                priority: 0,
                input: {
                  kind: 'route_endpoints',
                  endpointIds: [supplyEndpoint!.id],
                },
                defaults: {
                  weight: 10,
                  metadata: {
                    tier: 'gold',
                  },
                },
              },
            ],
            presentation: {
              displayIcon: 'Layers',
            },
          },
        },
      ],
    };

    const save = await app.inject({
      method: 'PUT',
      url: '/api/route-graph/draft',
      headers: app.adminHeaders(),
      payload: graphWithMacro,
    });
    expect(save.statusCode, save.body).toBe(200);
    expect(save.json().draft.diagnostics).toEqual([]);

    const publish = await app.inject({
      method: 'POST',
      url: '/api/route-graph/draft/publish',
      headers: app.adminHeaders(),
    });
    expect(publish.statusCode, publish.body).toBe(200);
    expect(publish.json()).toMatchObject({
      success: true,
      version: {
        compiledGraph: {
          publicModels: expect.arrayContaining([
            expect.objectContaining({ model: 'macro-public-model' }),
          ]),
        },
      },
    });

    const runtimeSelection = await evaluateActiveRouteGraphForModel('macro-public-model');
    expect(runtimeSelection).toMatchObject({
      selectedRouteId: source.route.id,
      terminalKind: 'route_endpoint',
      currentModel: 'macro-source-model',
      selectedEndpointTarget: null,
    });
  });

  it('accepts route-only product endpoint aliases for ordinary source routes in manual group payloads', async () => {
    const source = await seedRoutableRoute('legacy-product-route-source-model');
    const legacyProductRouteEndpointId = `route-endpoint:product:route:${source.route.id}`;

    const response = await app.inject({
      method: 'POST',
      url: '/api/routes',
      headers: app.adminHeaders(),
      payload: {
        match: {
          kind: 'model',
          requestedModelPattern: '',
          displayName: 'legacy-product-route-group',
        },
        backend: {
          kind: 'routes',
          routeIds: [source.route.id],
        },
        presentation: {
          displayName: 'legacy-product-route-group',
          displayIcon: null,
        },
        routingStrategy: 'priority_order',
        visibility: 'public',
        enabled: true,
        macro: {
          id: 'macro:legacy-product-route-group',
          kind: 'candidate_selector',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                visibility: 'public',
                match: {
                  kind: 'model',
                  requestedModelPattern: '',
                  displayName: 'legacy-product-route-group',
                },
              },
              output: 'route',
            },
            policy: { strategy: 'priority_order' },
            groups: [
              {
                id: 'source:legacy-product-route',
                enabled: true,
                priority: 0,
                input: {
                  kind: 'route_endpoints',
                  endpointIds: [legacyProductRouteEndpointId],
                },
                defaults: {
                  enabled: true,
                  weight: 10,
                  priority: 0,
                },
              },
            ],
            presentation: {
              displayIcon: null,
            },
          },
        },
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      backend: {
        kind: 'routes',
        routeIds: [source.route.id],
      },
    });
    const sources = await db.select().from(schema.routeGroupSources).all();
    expect(sources).toEqual([
      expect.objectContaining({
        sourceRouteId: source.route.id,
      }),
    ]);
  });

  it('accepts route-only legacy supply endpoint aliases for ordinary source routes in manual group payloads', async () => {
    const source = await seedRoutableRoute('legacy-supply-route-source-model');
    const legacySupplyRouteEndpointId = `route-endpoint:supply:route:${source.route.id}`;

    const response = await app.inject({
      method: 'POST',
      url: '/api/routes',
      headers: app.adminHeaders(),
      payload: {
        match: {
          kind: 'model',
          requestedModelPattern: '',
          displayName: 'legacy-supply-route-group',
        },
        backend: {
          kind: 'routes',
          routeIds: [source.route.id],
        },
        presentation: {
          displayName: 'legacy-supply-route-group',
          displayIcon: null,
        },
        routingStrategy: 'priority_order',
        visibility: 'public',
        enabled: true,
        macro: {
          id: 'macro:legacy-supply-route-group',
          kind: 'candidate_selector',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                visibility: 'public',
                match: {
                  kind: 'model',
                  requestedModelPattern: '',
                  displayName: 'legacy-supply-route-group',
                },
              },
              output: 'route',
            },
            policy: { strategy: 'priority_order' },
            groups: [
              {
                id: 'source:legacy-supply-route',
                enabled: true,
                priority: 0,
                input: {
                  kind: 'route_endpoints',
                  endpointIds: [legacySupplyRouteEndpointId],
                },
                defaults: {
                  enabled: true,
                  weight: 10,
                  priority: 0,
                },
              },
            ],
            presentation: {
              displayIcon: null,
            },
          },
        },
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      backend: {
        kind: 'routes',
        routeIds: [source.route.id],
      },
    });
    const sources = await db.select().from(schema.routeGroupSources).all();
    expect(sources).toEqual([
      expect.objectContaining({
        sourceRouteId: source.route.id,
      }),
    ]);
  });

  it('preserves explicit backend source routes when macro endpoints resolve to merged supply endpoints', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'merged-endpoint-site',
      url: 'https://merged-endpoint.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'merged-endpoint-account',
      accessToken: 'merged-endpoint-access',
      apiToken: 'merged-endpoint-api',
      status: 'active',
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'merged-endpoint-token',
      token: 'sk-merged-endpoint',
      enabled: true,
      isDefault: true,
    }).returning().get();
    const firstSource = await db.insert(schema.tokenRoutes).values({
      ...tokenRouteFixture({ modelPattern: 'merged-source-a' }),
      enabled: true,
    }).returning().get();
    const secondSource = await db.insert(schema.tokenRoutes).values({
      ...tokenRouteFixture({ modelPattern: 'merged-source-b' }),
      enabled: true,
    }).returning().get();
    await db.insert(schema.routeEndpointTargets).values([
      {
        routeId: firstSource.id,
        accountId: account.id,
        tokenId: token.id,
        sourceModel: 'merged-upstream-model',
        priority: 0,
        weight: 10,
        enabled: true,
      },
      {
        routeId: secondSource.id,
        accountId: account.id,
        tokenId: token.id,
        sourceModel: 'merged-upstream-model',
        priority: 0,
        weight: 10,
        enabled: true,
      },
    ]).run();
    await syncRouteBindingProjectionsFromRouteTable();

    const endpointsResponse = await app.inject({
      method: 'GET',
      url: `/api/route-endpoints?paged=1&page=1&pageSize=10&endpointKind=supply&routeId=${firstSource.id}`,
      headers: app.adminHeaders(),
    });
    expect(endpointsResponse.statusCode).toBe(200);
    const endpointId = endpointsResponse.json().items.find((item: { endpointKind: string }) => item.endpointKind === 'supply')?.endpointId;
    expect(endpointId).toEqual(expect.stringMatching(/^route-endpoint:supply:upstream-model:/));

    const group = await db.insert(schema.tokenRoutes).values({
      displayName: 'merged-explicit-group',
      displayIcon: null,
      modelMapping: null,
      routingStrategy: 'weighted',
      enabled: true,
    }).returning().get();
    await db.insert(schema.routeGroupSources).values({
      groupRouteId: group.id,
      sourceRouteId: firstSource.id,
    }).run();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/routes/${group.id}`,
      headers: app.adminHeaders(),
      payload: {
        match: {
          kind: 'model',
          requestedModelPattern: '',
          displayName: 'merged-explicit-group',
        },
        backend: {
          kind: 'routes',
          routeIds: [firstSource.id],
        },
        presentation: {
          displayName: 'merged-explicit-group',
          displayIcon: null,
        },
        routingStrategy: 'weighted',
        visibility: 'public',
        enabled: true,
        macro: {
          id: `route:${group.id}:model-group`,
          kind: 'candidate_selector',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                visibility: 'public',
                match: {
                  kind: 'model',
                  requestedModelPattern: '',
                  displayName: 'merged-explicit-group',
                },
              },
              output: 'route',
            },
            policy: { strategy: 'weighted' },
            groups: [
              {
                id: 'source:merged-endpoint',
                enabled: true,
                priority: 0,
                input: {
                  kind: 'route_endpoints',
                  endpointIds: [endpointId],
                },
                defaults: {
                  enabled: true,
                  weight: 10,
                  priority: 0,
                },
              },
            ],
          },
        },
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().backend).toEqual({ kind: 'routes', routeIds: [firstSource.id] });
    const sources = await db.select().from(schema.routeGroupSources)
      .where(eq(schema.routeGroupSources.groupRouteId, group.id))
      .all();
    expect(sources.map((source) => source.sourceRouteId)).toEqual([firstSource.id]);
  });

  it('publishes candidate_selector macros whose priority groups are sourced by model patterns', async () => {
    const opus = await seedRoutableRoute('claude-opus-api-model');
    await seedRoutableRoute('claude-sonnet-api-model');
    await seedRoutableRoute('gpt-api-model');

    const activeResponse = await app.inject({
      method: 'GET',
      url: '/api/route-graph/active?include=full',
      headers: app.adminHeaders(),
    });
    expect(activeResponse.statusCode).toBe(200);
    const activeBody = activeResponse.json() as {
      sourceGraph: {
        nodes: Array<unknown>;
        edges: Array<unknown>;
        macros?: Array<unknown>;
      };
    };

    const graphWithPatternMacro = {
      version: 1,
      nodes: activeBody.sourceGraph.nodes,
      edges: activeBody.sourceGraph.edges,
      macros: [
        ...(activeBody.sourceGraph.macros || []),
        {
          id: 'macro:api:pattern-group',
          kind: 'candidate_selector',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                visibility: 'public',
                match: {
                  requestedModelPattern: '',
                  displayName: 'claude-pattern-group',
                },
              },
              output: 'route',
            },
            policy: { strategy: 'priority_order' },
            groups: [
              {
                id: 'claude-pattern',
                enabled: true,
                priority: 0,
                input: {
                  kind: 'model_pattern',
                  pattern: 'claude-*',
                },
                defaults: {
                  priority: 10,
                  weight: 10,
                  metadata: {
                    source: 'pattern-test',
                  },
                },
                materialization: {
                  sort: 'model_name',
                  dedupeBy: 'route_id',
                },
              },
            ],
          },
        },
      ],
    };

    const save = await app.inject({
      method: 'PUT',
      url: '/api/route-graph/draft',
      headers: app.adminHeaders(),
      payload: graphWithPatternMacro,
    });
    expect(save.statusCode, save.body).toBe(200);
    expect(save.json().draft.diagnostics).toEqual([]);

    const publish = await app.inject({
      method: 'POST',
      url: '/api/route-graph/draft/publish',
      headers: app.adminHeaders(),
    });
    expect(publish.statusCode, publish.body).toBe(200);
    expect(publish.json()).toMatchObject({
      success: true,
      version: {
        compiledGraph: {
          publicModels: expect.arrayContaining([
            expect.objectContaining({ model: 'claude-pattern-group' }),
          ]),
        },
      },
    });

    vi.spyOn(Math, 'random').mockReturnValueOnce(0);
    const runtimeSelection = await evaluateActiveRouteGraphForModel('claude-pattern-group');
    expect(runtimeSelection).toMatchObject({
      selectedRouteId: opus.route.id,
      terminalKind: 'route_endpoint',
      currentModel: 'claude-opus-api-model',
    });
    expect(runtimeSelection?.selectedEndpointTarget).toBeNull();
  });

  it('publishes request filters through the graph API and evaluates them in the active runtime graph', async () => {
    const source = await seedRoutableRoute('deepseek-v4-pro');

    const activeResponse = await app.inject({
      method: 'GET',
      url: '/api/route-graph/active?include=full',
      headers: app.adminHeaders(),
    });
    expect(activeResponse.statusCode).toBe(200);
    const activeBody = activeResponse.json() as {
      sourceGraph: {
        nodes: Array<unknown>;
        edges: Array<unknown>;
        macros?: Array<unknown>;
      };
    };
    const supplyEndpoint = activeBody.sourceGraph.nodes.find((node: any) => (
      node?.type === 'route_endpoint'
      && node?.endpointKind === 'supply'
      && Array.isArray(node?.metadata?.sourceRouteIds)
      && node.metadata.sourceRouteIds.includes(source.route.id)
    )) as { id: string } | undefined;
    expect(supplyEndpoint).toBeDefined();

    const filteredGraph = {
      version: 1,
      nodes: [
        ...activeBody.sourceGraph.nodes,
        {
          id: 'entry.deepseek-max',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: {
            requestedModelPattern: 'deepseek-v4-pro-max',
            displayName: 'deepseek-v4-pro-max',
          },
        },
        {
          id: 'filter.deepseek-request',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          operations: [
            { type: 'rewrite_model', source: 'current_model', operation: 'strip_suffix', suffix: '-max' },
            { type: 'set_payload', path: 'reasoning_effort', mode: 'override', value: 'high' },
            { type: 'set_payload', path: 'metadata.route', mode: 'override', value: 'graph-filter' },
            { type: 'set_header', name: 'X-DeepSeek-Reasoning', mode: 'override', value: 'enabled' },
            { type: 'remove_header', name: 'X-Drop-Me' },
            { type: 'set_endpoint_preference', endpoint: 'responses' },
          ],
        },
        {
          id: 'dispatcher.deepseek-filtered',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'priority_order' },
        },
      ],
      edges: [
        ...activeBody.sourceGraph.edges,
        {
          id: 'entry-filter-deepseek',
          sourceNodeId: 'entry.deepseek-max',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'filter.deepseek-request',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
        {
          id: 'filter-dispatcher-deepseek',
          sourceNodeId: 'filter.deepseek-request',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'dispatcher.deepseek-filtered',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
        {
          id: 'supply-dispatcher-deepseek',
          sourceNodeId: supplyEndpoint!.id,
          sourcePortId: 'route.out',
          targetNodeId: 'dispatcher.deepseek-filtered',
          targetPortId: 'route.in',
          kind: 'route_flow',
          ownership: 'manual',
        },
      ],
      macros: activeBody.sourceGraph.macros || [],
    };

    const save = await app.inject({
      method: 'PUT',
      url: '/api/route-graph/draft',
      headers: app.adminHeaders(),
      payload: filteredGraph,
    });
    expect(save.statusCode, save.body).toBe(200);
    expect(save.json().draft.diagnostics).toEqual([]);

    const publish = await app.inject({
      method: 'POST',
      url: '/api/route-graph/draft/publish',
      headers: app.adminHeaders(),
    });
    expect(publish.statusCode, publish.body).toBe(200);
    const publishBody = publish.json();
    expect(publishBody).toMatchObject({
      success: true,
      version: {
        compiledGraph: {
          publicModels: expect.arrayContaining([
            expect.objectContaining({ model: 'deepseek-v4-pro-max' }),
          ]),
        },
      },
    });
    const compiledRouterBundle = publishBody.version.compiledGraph.compiledRouterBundle;
    expect(compiledRouterBundle.diagnostics.map((diagnostic: { code: string }) => diagnostic.code)).not.toContain('compiled_router.unsupported_filter_path');
    const compiledRouterPlan = compiledRouterBundle.plans.find((plan: { id: string }) => plan.id === 'program:entry.deepseek-max');
    expect(compiledRouterPlan?.selectorLevels[0]?.filterStageIndexes.map((index: number) => compiledRouterPlan.filterStages[index])).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'filter.deepseek-request' }),
    ]));

    const runtimeSelection = await evaluateActiveRouteGraphForModel('deepseek-v4-pro-max');
    expect(runtimeSelection).toMatchObject({
      selectedRouteId: source.route.id,
      terminalKind: 'route_endpoint',
      currentModel: 'deepseek-v4-pro',
    });
    expect(runtimeSelection?.selectedEndpointTarget).toBeNull();
    expect(runtimeSelection?.postBuildFilters.payload.map((operation) => operation.type)).toEqual(['set_payload', 'set_payload']);
    expect(runtimeSelection?.postBuildFilters.headers.map((operation) => operation.type)).toEqual(['set_header', 'remove_header']);
    expect(runtimeSelection?.postBuildFilters.endpointPreference).toBe('responses');
    const filterTraceSteps = runtimeSelection?.trace.path.filter((step) => step.nodeId === 'filter.deepseek-request') || [];
    expect(filterTraceSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeType: 'filter',
        decision: 'applied_filter',
        appliedFilters: ['rewrite_model:currentModel=strip_suffix'],
      }),
      expect.objectContaining({
        nodeType: 'filter',
        decision: 'applied_filter',
        appliedFilters: expect.arrayContaining([
          'set_payload',
          'set_header',
          'remove_header',
          'set_endpoint_preference',
        ]),
      }),
    ]));

    const filtered = applyRouteGraphPostBuildFilters({
      payload: {
        model: 'deepseek-v4-pro',
        reasoning_effort: 'medium',
      },
      headers: {
        'x-deepseek-reasoning': 'client',
        'x-drop-me': 'remove',
      },
      filters: runtimeSelection?.postBuildFilters,
    });
    expect(filtered).toEqual({
      endpointPreference: 'responses',
      payload: {
        model: 'deepseek-v4-pro',
        reasoning_effort: 'high',
        metadata: { route: 'graph-filter' },
      },
      headers: {
        'x-deepseek-reasoning': 'enabled',
      },
    });
  });

  it('saves and compiles embedded candidate_selector macros without public model exposure', async () => {
    const source = await seedRoutableRoute('embedded-source-model');
    const activeResponse = await app.inject({
      method: 'GET',
      url: '/api/route-graph/active?include=full',
      headers: app.adminHeaders(),
    });
    expect(activeResponse.statusCode).toBe(200);
    const activeBody = activeResponse.json() as {
      sourceGraph: {
        nodes: Array<unknown>;
        edges: Array<unknown>;
        macros?: Array<unknown>;
      };
      version: { id: number };
    };
    const supplyEndpoint = activeBody.sourceGraph.nodes.find((node: any) => (
      node?.type === 'route_endpoint'
      && node?.endpointKind === 'supply'
      && Array.isArray(node?.metadata?.sourceRouteIds)
      && node.metadata.sourceRouteIds.includes(source.route.id)
    )) as { id: string } | undefined;
    expect(supplyEndpoint).toBeDefined();

    const graphWithEmbeddedMacro = {
      version: 1,
      nodes: [
        ...activeBody.sourceGraph.nodes,
        {
          id: 'entry:manual:embedded-test',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'embedded-test-public' },
        },
      ],
      macros: [
        ...(activeBody.sourceGraph.macros || []),
        {
          id: 'api:embedded',
          kind: 'candidate_selector',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          config: {
            surface: {
              entry: { kind: 'embedded', input: 'bidirect' },
              output: 'bidirect',
              ports: [
                { id: 'flow.in', label: 'incoming flow', direction: 'input', kind: 'bidirect' },
                { id: 'flow.out', label: 'selected flow', direction: 'output', kind: 'bidirect', collection: { type: 'arr', min: 1 } },
              ],
            },
            policy: { strategy: 'stable_first' },
            groups: [
              {
                id: 'fallback',
                enabled: true,
                priority: 0,
                input: { kind: 'synthetic', statusCode: 503, message: 'embedded fallback' },
              },
            ],
          },
        },
      ],
      edges: [
        ...activeBody.sourceGraph.edges,
        {
          id: 'entry-to-embedded',
          sourceNodeId: 'entry:manual:embedded-test',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'macro:api:embedded',
          targetPortId: 'flow.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
        {
          id: 'embedded-to-endpoint',
          sourceNodeId: 'macro:api:embedded',
          sourcePortId: 'flow.out',
          targetNodeId: supplyEndpoint!.id,
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
      ],
    };

    const save = await app.inject({
      method: 'PUT',
      url: '/api/route-graph/draft',
      headers: app.adminHeaders(),
      payload: graphWithEmbeddedMacro,
    });
    expect(save.statusCode, save.body).toBe(200);
    expect(save.json().draft.diagnostics).toEqual([]);

    const publish = await app.inject({
      method: 'POST',
      url: '/api/route-graph/draft/publish',
      headers: app.adminHeaders(),
    });
    expect(publish.statusCode, publish.body).toBe(200);
    expect(publish.json()).toMatchObject({
      success: true,
      version: {
        compiledGraph: {
          publicModels: expect.not.arrayContaining([
            expect.objectContaining({ model: 'macro:api:embedded' }),
          ]),
        },
      },
    });

    const runtimeSelection = await evaluateActiveRouteGraphForModel('embedded-source-model');
    expect(runtimeSelection).toMatchObject({
      selectedRouteId: source.route.id,
      terminalKind: 'route_endpoint',
      currentModel: 'embedded-source-model',
    });
  });
});
