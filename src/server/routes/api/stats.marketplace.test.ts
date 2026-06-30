import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { compileRouteGraphSource } from '../../../shared/routeGraph.js';

type DbModule = typeof import('../../db/index.js');
type StatsRoutesModule = typeof import('./stats.js');
type RouteGraphServiceModule = typeof import('../../services/routeGraphService.js');

describe('/api/models/marketplace', () => {
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let resetModelsMarketplaceCacheForTests: StatsRoutesModule['__resetModelsMarketplaceCacheForTests'];
  let buildRouteGraphSourceFromRouteTable: RouteGraphServiceModule['buildRouteGraphSourceFromRouteTable'];
  let publishRouteGraphSource: RouteGraphServiceModule['publishRouteGraphSource'];
  let ensureActiveRouteGraphVersion: RouteGraphServiceModule['ensureActiveRouteGraphVersion'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-stats-marketplace-'));
    process.env.DATA_DIR = dataDir;

    vi.resetModules();
    await import('../../db/migrate.js');
    const dbModule = await import('../../db/index.js');
    const routesModule = await import('./stats.js');
    const routeGraphServiceModule = await import('../../services/routeGraphService.js');
    db = dbModule.db;
    schema = dbModule.schema;
    resetModelsMarketplaceCacheForTests = routesModule.__resetModelsMarketplaceCacheForTests;
    buildRouteGraphSourceFromRouteTable = routeGraphServiceModule.buildRouteGraphSourceFromRouteTable;
    publishRouteGraphSource = routeGraphServiceModule.publishRouteGraphSource;
    ensureActiveRouteGraphVersion = routeGraphServiceModule.ensureActiveRouteGraphVersion;

    app = Fastify();
    await app.register(routesModule.statsRoutes);
  });

  beforeEach(async () => {
    resetModelsMarketplaceCacheForTests();
    await db.delete(schema.proxyLogs).run();
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.routeEndpointTargets).run();
    await db.delete(schema.tokenRoutes).run();
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

  async function persistCompactedActiveRouteEndpointIdentity(routeId: number): Promise<void> {
    const active = await ensureActiveRouteGraphVersion();
    const badSourceGraph = {
      ...active.sourceGraph,
      nodes: active.sourceGraph.nodes.map((node) => {
        if (
          node.type !== 'route_endpoint'
          || node.endpointKind !== 'supply'
          || node.routeId !== routeId
          || !node.metadata
          || typeof node.metadata !== 'object'
          || Array.isArray(node.metadata)
        ) {
          return node;
        }
        const metadata = node.metadata as Record<string, unknown>;
        const endpointIdentity = metadata.endpointIdentity && typeof metadata.endpointIdentity === 'object' && !Array.isArray(metadata.endpointIdentity)
          ? metadata.endpointIdentity as Record<string, unknown>
          : {};
        const compactedIdentity = { ...endpointIdentity };
        delete compactedIdentity.targets;
        return {
          ...node,
          metadata: {
            ...metadata,
            endpointIdentity: {
              ...compactedIdentity,
              targetCount: 1,
              targetSetFingerprint: 'bad-persisted-fingerprint',
            },
          },
        };
      }),
    };
    const badCompiled = compileRouteGraphSource(badSourceGraph);
    await db.update(schema.routeGraphVersions).set({
      sourceGraphJson: JSON.stringify(badSourceGraph),
      compiledGraphJson: JSON.stringify(badCompiled.compiled),
    }).where(eq(schema.routeGraphVersions.id, active.id)).run();
  }

  it('returns account-level discovered models even when account has no managed tokens', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'site-no-token',
      url: 'https://site-no-token.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'alice',
      accessToken: 'session-token',
      status: 'active',
      balance: 12.5,
    }).returning().get();

    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'claude-sonnet-4-5-20250929',
      available: true,
      latencyMs: 233,
    }).run();

    const visibleRows = await db.select().from(schema.modelAvailability)
      .innerJoin(schema.accounts, eq(schema.modelAvailability.accountId, schema.accounts.id))
      .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
      .where(
        and(
          eq(schema.modelAvailability.available, true),
          eq(schema.accounts.status, 'active'),
          eq(schema.sites.status, 'active'),
        ),
      )
      .all();
    expect(visibleRows).toHaveLength(1);

    const response = await app.inject({
      method: 'GET',
      url: '/api/models/marketplace',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      models: Array<{
        name: string;
        accountCount: number;
        tokenCount: number;
        managedTokenCount: number;
        credentialCount: number;
        accounts: Array<{
          id: number;
          site: string;
          username: string | null;
          credentialCount: number;
          tokens: Array<{ id: number; name: string; isDefault: boolean }>;
        }>;
      }>;
    };
    const model = body.models.find((item) => item.name === 'claude-sonnet-4-5-20250929');
    expect(model).toBeDefined();
    expect(model?.accountCount).toBe(1);
    expect(model?.tokenCount).toBe(0);
    expect(model?.managedTokenCount).toBe(0);
    expect(model?.credentialCount).toBe(1);
    expect(model?.accounts).toHaveLength(1);
    expect(model?.accounts[0]).toMatchObject({
      id: account.id,
      site: 'site-no-token',
      username: 'alice',
      credentialCount: 1,
      tokens: [],
    });
  });

  it('only exposes available models from active sites, active accounts, and ready enabled tokens', async () => {
    const activeSite = await db.insert(schema.sites).values({
      name: 'active-market-site',
      url: 'https://active-market.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const disabledSite = await db.insert(schema.sites).values({
      name: 'disabled-market-site',
      url: 'https://disabled-market.example.com',
      platform: 'new-api',
      status: 'disabled',
    }).returning().get();
    const activeAccount = await db.insert(schema.accounts).values({
      siteId: activeSite.id,
      username: 'active-user',
      accessToken: 'active-access',
      apiToken: 'active-api',
      status: 'active',
      unitCost: 0.25,
      balance: 9,
    }).returning().get();
    const disabledAccount = await db.insert(schema.accounts).values({
      siteId: activeSite.id,
      username: 'disabled-user',
      accessToken: 'disabled-access',
      apiToken: 'disabled-api',
      status: 'disabled',
    }).returning().get();
    const accountOnDisabledSite = await db.insert(schema.accounts).values({
      siteId: disabledSite.id,
      username: 'site-disabled-user',
      accessToken: 'site-disabled-access',
      apiToken: 'site-disabled-api',
      status: 'active',
    }).returning().get();
    const readyToken = await db.insert(schema.accountTokens).values({
      accountId: activeAccount.id,
      name: 'ready-token',
      token: 'sk-ready-token',
      valueStatus: 'ready',
      enabled: true,
      isDefault: true,
    }).returning().get();
    const disabledToken = await db.insert(schema.accountTokens).values({
      accountId: activeAccount.id,
      name: 'disabled-token',
      token: 'sk-disabled-token',
      valueStatus: 'ready',
      enabled: false,
    }).returning().get();
    const pendingToken = await db.insert(schema.accountTokens).values({
      accountId: activeAccount.id,
      name: 'pending-token',
      token: 'sk-pending-token',
      valueStatus: 'pending',
      enabled: true,
    }).returning().get();

    await db.insert(schema.tokenModelAvailability).values([
      {
        tokenId: readyToken.id,
        modelName: 'gpt-4o-mini',
        available: true,
        latencyMs: 100,
      },
      {
        tokenId: disabledToken.id,
        modelName: 'hidden-disabled-token-model',
        available: true,
        latencyMs: 101,
      },
      {
        tokenId: pendingToken.id,
        modelName: 'hidden-pending-token-model',
        available: true,
        latencyMs: 102,
      },
      {
        tokenId: readyToken.id,
        modelName: 'hidden-unavailable-token-model',
        available: false,
        latencyMs: 103,
      },
    ]).run();
    await db.insert(schema.modelAvailability).values([
      {
        accountId: activeAccount.id,
        modelName: 'account-only-model',
        available: true,
        latencyMs: 80,
      },
      {
        accountId: disabledAccount.id,
        modelName: 'hidden-disabled-account-model',
        available: true,
        latencyMs: 81,
      },
      {
        accountId: accountOnDisabledSite.id,
        modelName: 'hidden-disabled-site-model',
        available: true,
        latencyMs: 82,
      },
      {
        accountId: activeAccount.id,
        modelName: 'hidden-unavailable-account-model',
        available: false,
        latencyMs: 83,
      },
    ]).run();
    await db.insert(schema.proxyLogs).values([
      {
        accountId: activeAccount.id,
        modelRequested: 'gpt-4o-mini',
        modelActual: 'gpt-4o-mini',
        status: 'success',
        latencyMs: 120,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        billingDetails: JSON.stringify({
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            billablePromptTokens: 100,
            promptTokensIncludeCache: false,
          },
          breakdown: {
            inputPerMillion: 5,
            outputPerMillion: 15,
          },
        }),
        createdAt: new Date().toISOString(),
      },
      {
        accountId: activeAccount.id,
        modelRequested: 'gpt-4o-mini',
        modelActual: 'gpt-4o-mini',
        status: 'failed',
        latencyMs: 240,
        createdAt: new Date().toISOString(),
      },
    ]).run();

    const response = await app.inject({
      method: 'GET',
      url: '/api/models/marketplace',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      models: Array<{
        name: string;
        accountCount: number;
        tokenCount: number;
        credentialCount: number;
        avgLatency: number;
        successRate: number | null;
        accounts: Array<{
          id: number;
          site: string;
          username: string | null;
          unitCost: number | null;
          balance: number;
          credentialCount: number;
          tokens: Array<{ id: number; name: string; isDefault: boolean }>;
        }>;
        measuredEntryPricing: {
          inputPerMillion: number | null;
          outputPerMillion: number | null;
          sampleCount: number;
          lastMeasuredAt: string | null;
        } | null;
      }>;
      meta: { includePricing: boolean; cacheHit?: boolean };
    };
    const names = body.models.map((model) => model.name);
    expect(names).toContain('gpt-4o-mini');
    expect(names).toContain('account-only-model');
    expect(names).not.toContain('hidden-disabled-token-model');
    expect(names).not.toContain('hidden-pending-token-model');
    expect(names).not.toContain('hidden-unavailable-token-model');
    expect(names).not.toContain('hidden-disabled-account-model');
    expect(names).not.toContain('hidden-disabled-site-model');
    expect(names).not.toContain('hidden-unavailable-account-model');

    const routedModel = body.models.find((model) => model.name === 'gpt-4o-mini');
    expect(routedModel).toMatchObject({
      accountCount: 1,
      tokenCount: 1,
      avgLatency: 100,
      successRate: 50,
      measuredEntryPricing: {
        inputPerMillion: 5,
        outputPerMillion: 15,
        sampleCount: 1,
      },
    });
    expect(routedModel?.accounts).toEqual([
      expect.objectContaining({
        id: activeAccount.id,
        site: 'active-market-site',
        username: 'active-user',
        unitCost: 0.25,
        balance: 9,
        tokens: [
          { id: readyToken.id, name: 'ready-token', isDefault: true },
        ],
      }),
    ]);

    const accountOnly = body.models.find((model) => model.name === 'account-only-model');
    expect(accountOnly).toMatchObject({
      accountCount: 1,
      tokenCount: 0,
      credentialCount: 1,
      avgLatency: 80,
      successRate: null,
    });
    expect(body.meta.includePricing).toBe(false);
  });

  it('includes compiled public macro route products in marketplace inventory', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'deepseek-site',
      url: 'https://deepseek-site.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'deepseek-user',
      accessToken: 'deepseek-access',
      apiToken: 'deepseek-api',
      status: 'active',
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'deepseek-token',
      token: 'sk-deepseek',
      valueStatus: 'ready',
      enabled: true,
      isDefault: true,
    }).returning().get();
    const route = await db.insert(schema.tokenRoutes).values({
      modelPattern: 'deepseek-v4-flash',
      enabled: true,
      routingStrategy: 'weighted',
    }).returning().get();
    await db.insert(schema.routeEndpointTargets).values({
      routeId: route.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: 'deepseek-v4-flash',
      priority: 0,
      weight: 10,
      enabled: true,
    }).run();

    const routeTableGraph = await buildRouteGraphSourceFromRouteTable();
    const published = await publishRouteGraphSource({
      createdBy: 'test',
      sourceGraph: {
        ...routeTableGraph,
        macros: [
          ...(routeTableGraph.macros || []),
          {
            id: 'deepseek-v4-flash-reroute',
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
                    requestedModelPattern: 'deepseek-v4-flash-reroute',
                    displayName: 'deepseek-v4-flash-reroute',
                  },
                },
                output: 'route',
              },
              policy: { strategy: 'priority_order' },
              groups: [
                {
                  id: 'primary',
                  enabled: true,
                  priority: 0,
                  input: {
                    kind: 'model_pattern',
                    pattern: 'deepseek-v4-flash',
                  },
                  materialization: { sort: 'model_name', dedupeBy: 'route_id' },
                },
              ],
            },
          },
        ],
      },
    });
    if (!published.ok) {
      throw new Error(JSON.stringify(published.diagnostics, null, 2));
    }

    const response = await app.inject({
      method: 'GET',
      url: '/api/models/marketplace',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      models: Array<{
        name: string;
        accountCount: number;
        tokenCount: number;
        credentialCount: number;
        accounts: Array<{ id: number; site: string; credentialCount: number; tokens: Array<{ id: number }> }>;
      }>;
    };
    const macroModel = body.models.find((model) => model.name === 'deepseek-v4-flash-reroute');
    if (!macroModel) {
      throw new Error(JSON.stringify(body.models.map((model) => ({
        name: model.name,
        accountCount: model.accountCount,
        tokenCount: model.tokenCount,
        credentialCount: model.credentialCount,
      })), null, 2));
    }
    expect(macroModel).toMatchObject({
      accountCount: 1,
      tokenCount: 1,
      credentialCount: 1,
    });
    expect(macroModel?.accounts).toEqual([
      expect.objectContaining({
        id: account.id,
        site: 'deepseek-site',
        credentialCount: 1,
        tokens: [expect.objectContaining({ id: token.id })],
      }),
    ]);
  });

  it('repairs compacted persisted route endpoint identities before aggregating public route products', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'compacted-market-site',
      url: 'https://compacted-market.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'compacted-market-user',
      accessToken: 'compacted-market-access',
      apiToken: 'compacted-market-api',
      status: 'active',
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'compacted-market-token',
      token: 'sk-compacted-market',
      valueStatus: 'ready',
      enabled: true,
      isDefault: true,
    }).returning().get();
    const route = await db.insert(schema.tokenRoutes).values({
      modelPattern: 'compacted-market-model',
      enabled: true,
      routingStrategy: 'weighted',
    }).returning().get();
    await db.insert(schema.routeEndpointTargets).values({
      routeId: route.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: 'compacted-market-model',
      priority: 0,
      weight: 10,
      enabled: true,
    }).run();
    await persistCompactedActiveRouteEndpointIdentity(route.id);

    const response = await app.inject({
      method: 'GET',
      url: '/api/models/marketplace',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      models: Array<{
        name: string;
        accountCount: number;
        tokenCount: number;
        credentialCount: number;
        accounts: Array<{
          id: number;
          site: string;
          username: string | null;
          tokens: Array<{ id: number; name: string }>;
        }>;
      }>;
    };
    const model = body.models.find((item) => item.name === 'compacted-market-model');

    expect(model).toMatchObject({
      accountCount: 1,
      tokenCount: 1,
      credentialCount: 1,
    });
    expect(model?.accounts).toEqual([
      expect.objectContaining({
        id: account.id,
        site: 'compacted-market-site',
        username: 'compacted-market-user',
        tokens: [expect.objectContaining({ id: token.id, name: 'compacted-market-token' })],
      }),
    ]);
  });

  it('serves repeated marketplace reads from the matching pricing cache', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'cache-site',
      url: 'https://cache-site.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'cache-user',
      accessToken: 'cache-access',
      apiToken: 'cache-api',
      status: 'active',
    }).returning().get();
    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'cache-model',
      available: true,
      latencyMs: 55,
    }).run();

    const first = await app.inject({
      method: 'GET',
      url: '/api/models/marketplace',
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as {
      meta: { cacheHit?: boolean; includePricing: boolean };
    };
    expect(firstBody.meta.includePricing).toBe(false);
    expect('cacheHit' in firstBody.meta).toBe(false);

    await db.update(schema.modelAvailability).set({
      modelName: 'cache-model-mutated-after-first-read',
    }).where(eq(schema.modelAvailability.accountId, account.id)).run();

    const cached = await app.inject({
      method: 'GET',
      url: '/api/models/marketplace',
    });
    expect(cached.statusCode).toBe(200);
    const cachedBody = cached.json() as {
      models: Array<{ name: string }>;
      meta: { cacheHit?: boolean; includePricing: boolean };
    };
    expect(cachedBody.meta).toMatchObject({
      cacheHit: true,
      includePricing: false,
    });
    expect(cachedBody.models.map((model) => model.name)).toContain('cache-model');
    expect(cachedBody.models.map((model) => model.name)).not.toContain('cache-model-mutated-after-first-read');
  });

  it('uses endpoint pricing for marketplace theoretical pricing metadata', async () => {
    const upstreamCost = await import('../../services/upstreamCostPricingService.js');
    const site = await db.insert(schema.sites).values({
      name: 'priced-site',
      url: 'https://priced-site.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'priced-user',
      accessToken: 'priced-access',
      apiToken: 'priced-api',
      status: 'active',
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'priced-token',
      token: 'sk-priced',
      tokenGroup: 'vip',
      valueStatus: 'ready',
      enabled: true,
      isDefault: true,
    }).returning().get();

    await db.insert(schema.tokenModelAvailability).values({
      tokenId: token.id,
      modelName: 'priced-model',
      available: true,
      latencyMs: 42,
    }).run();
    await upstreamCost.createUpstreamCostPricing({
      scope: 'token_model_group',
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      tokenGroup: 'vip',
      modelName: 'priced-model',
      plan: upstreamCost.createSimpleTokenPricingPlan({
        inputPerMillion: 7,
        outputPerMillion: 11,
      }),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/models/marketplace?includePricing=true',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      models: Array<{
        name: string;
        pricingSources: Array<{
          siteId: number;
          accountId: number;
          enableGroups: string[];
          groupPricing: Record<string, {
            inputPerMillion?: number;
            outputPerMillion?: number;
          }>;
        }>;
      }>;
      meta: { includePricing: boolean };
    };
    const model = body.models.find((item) => item.name === 'priced-model');
    expect(model?.pricingSources).toEqual([
      expect.objectContaining({
        siteId: site.id,
        accountId: account.id,
        enableGroups: ['vip'],
        groupPricing: {
          vip: expect.objectContaining({
            inputPerMillion: 7,
            outputPerMillion: 11,
          }),
        },
      }),
    ]);
    expect(body.meta.includePricing).toBe(true);
  });

  it('returns a bounded filtered marketplace page with real totals and facets', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'paged-market-site',
      url: 'https://paged-market.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const otherSite = await db.insert(schema.sites).values({
      name: 'other-market-site',
      url: 'https://other-market.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'paged-user',
      accessToken: 'paged-access',
      apiToken: 'paged-api',
      status: 'active',
    }).returning().get();
    const otherAccount = await db.insert(schema.accounts).values({
      siteId: otherSite.id,
      username: 'other-user',
      accessToken: 'other-access',
      apiToken: 'other-api',
      status: 'active',
    }).returning().get();

    await db.insert(schema.modelAvailability).values([
      { accountId: account.id, modelName: 'gpt-alpha', available: true, latencyMs: 31 },
      { accountId: account.id, modelName: 'gpt-beta', available: true, latencyMs: 32 },
      { accountId: account.id, modelName: 'gpt-gamma', available: true, latencyMs: 33 },
      { accountId: account.id, modelName: 'claude-sonnet-4-5-20250929', available: true, latencyMs: 34 },
      { accountId: otherAccount.id, modelName: 'gpt-other-site', available: true, latencyMs: 35 },
    ]).run();

    const response = await app.inject({
      method: 'GET',
      url: '/api/models/marketplace?page=2&pageSize=1&q=gpt&brand=OpenAI&site=paged-market-site&sortBy=name&sortDir=asc',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      models: Array<{ name: string; accounts: Array<{ site: string }> }>;
      pageInfo: { page: number; pageSize: number; totalCount: number; hasMore: boolean };
      facets: {
        brands: Array<{ name: string; count: number }>;
        sites: Array<{ name: string; count: number }>;
      };
    };

    expect(body.models.map((model) => model.name)).toEqual(['gpt-beta']);
    expect(body.models[0]?.accounts.map((accountRow) => accountRow.site)).toEqual(['paged-market-site']);
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
      expect.objectContaining({ name: 'paged-market-site', count: 3 }),
      expect.objectContaining({ name: 'other-market-site', count: 1 }),
    ]);
  });
});
