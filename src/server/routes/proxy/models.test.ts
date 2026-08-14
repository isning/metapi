import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createGraphNativeRouteFixture,
  publishCurrentGraphNativeRouteFixtures,
  resetGraphNativeRouteFixtures,
} from '../../test/graphNativeRouteFixtures.js';
import { clearRouteGroupMemberTestData, insertRouteGroupMember, insertRouteGroupMembers } from '../../../testing/routeGroupMemberTestUtils.js';

type DbModule = typeof import('../../db/index.js');
type ProxyRouterModule = typeof import('./router.js');
type TokensRoutesModule = typeof import('../api/tokens.js');
type ConfigModule = typeof import('../../config.js');

describe('/v1/models route', () => {
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let proxyRoutes: ProxyRouterModule['proxyRoutes'];
  let tokensRoutes: TokensRoutesModule['tokensRoutes'];
  let config: ConfigModule['config'];
  let invalidateRouteRuntimeArtifactReadCaches: () => void;
  let app: FastifyInstance;
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-models-route-'));
    process.env.DATA_DIR = dataDir;

    const migrate = await import('../../db/migrate.js');
    await migrate.runSqliteMigrations();
    const dbModule = await import('../../db/index.js');
    const proxyRouterModule = await import('./router.js');
    const tokensRoutesModule = await import('../api/tokens.js');
    const configModule = await import('../../config.js');
    const routeRuntimeArtifactService = await import('../../services/routeRuntimeArtifactService.js');

    db = dbModule.db;
    schema = dbModule.schema;
    proxyRoutes = proxyRouterModule.proxyRoutes;
    tokensRoutes = tokensRoutesModule.tokensRoutes;
    config = configModule.config;
    invalidateRouteRuntimeArtifactReadCaches = routeRuntimeArtifactService.invalidateRouteRuntimeArtifactReadCaches;
    config.proxyToken = 'sk-global-proxy-token';

    app = Fastify();
    await app.register(tokensRoutes);
    await app.register(proxyRoutes);
  });

  beforeEach(async () => {
    resetGraphNativeRouteFixtures();
    await clearRouteGroupMemberTestData();
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.compiledRuntimeActiveArtifact).run();
    await db.delete(schema.compiledRuntimeArtifacts).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.tokenModelAvailability).run();
    await db.delete(schema.modelAvailability).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
    await db.delete(schema.downstreamApiKeys).run();
    invalidateRouteRuntimeArtifactReadCaches();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DATA_DIR;
  });

  async function compiledPlanIdForModel(modelName: string): Promise<string> {
    const { listActiveCompiledRuntimeModelEntrypoints } = await import('../../services/compiledRuntimeInventoryService.js');
    const entrypoint = (await listActiveCompiledRuntimeModelEntrypoints())
      .find((item) => item.modelName === modelName);
    if (!entrypoint) throw new Error(`Missing compiled plan for ${modelName}`);
    return entrypoint.planId;
  }

  it('hides models that have no routable target even if model availability contains them', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'test-site',
      url: 'https://upstream.example.com',
      platform: 'openai',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      credential: 'account-access-token',
      status: 'active',
    }).returning().get();

    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'default',
      token: 'account-api-token',
      enabled: true,
      isDefault: true,
    }).returning().get();

    await db.insert(schema.modelAvailability).values([
      {
        accountId: account.id,
        modelName: 'routable-model',
        available: true,
      },
      {
        accountId: account.id,
        modelName: 'orphan-model',
        available: true,
      },
    ]).run();

    const route = await createGraphNativeRouteFixture({ modelPattern: 'routable-model' });

    await insertRouteGroupMember({
      groupId: route.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: 'routable-model',
      enabled: true,
    });
    await publishCurrentGraphNativeRouteFixtures();

    await db.insert(schema.downstreamApiKeys).values({
      name: 'managed-key',
      key: 'sk-managed-models',
      enabled: true,
      supportedModels: JSON.stringify(['routable-model']),
    }).run();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: {
        authorization: 'Bearer sk-managed-models',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      object: 'list';
      data: Array<{ id: string }>;
    };

    const ids = body.data.map((item) => item.id);
    expect(ids).toContain('routable-model');
    expect(ids).not.toContain('orphan-model');
  });

  it('keeps global proxy token unrestricted when no managed key matches', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'global-site',
      url: 'https://global.example.com',
      platform: 'openai',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      credential: 'global-access-token',
      status: 'active',
    }).returning().get();

    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'default',
      token: 'global-api-token',
      enabled: true,
      isDefault: true,
    }).returning().get();

    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'global-routable-model',
      available: true,
    }).run();

    const route = await createGraphNativeRouteFixture({ modelPattern: 'global-routable-model' });

    await insertRouteGroupMember({
      groupId: route.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: 'global-routable-model',
      enabled: true,
    });
    await publishCurrentGraphNativeRouteFixtures();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: {
        authorization: 'Bearer sk-global-proxy-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      object: 'list';
      data: Array<{ id: string }>;
    };

    expect(body.data.map((item) => item.id)).toContain('global-routable-model');
  });

  it('surfaces an invalid compiled runtime instead of converting it into an empty model list', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'projection-models-site',
      url: 'https://projection-models.example.com',
      platform: 'openai',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      credential: 'projection-models-access-token',
      status: 'active',
    }).returning().get();

    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'default',
      token: 'projection-models-api-token',
      enabled: true,
      isDefault: true,
    }).returning().get();

    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'projection-routable-model',
      available: true,
    }).run();

    await db.insert(schema.routeGraphVersions).values({
      id: 1,
      version: 1,
      sourceGraphJson: JSON.stringify({ nodes: [], edges: [], macros: [] }),
      status: 'active',
      createdBy: 'bad-compiled-fixture',
      createdAt: new Date().toISOString(),
      activatedAt: new Date().toISOString(),
    }).run();
    await db.insert(schema.compiledRuntimeArtifacts).values({
      id: 'runtime-artifact-invalid-models',
      artifactJson: '{',
      bundleHash: 'invalid-models',
      sourceGraphVersionId: 1,
      sourceGraphHash: 'sha256:invalid-models',
    }).run();
    await db.insert(schema.compiledRuntimeActiveArtifact).values({
      id: 1,
      artifactId: 'runtime-artifact-invalid-models',
    }).run();
    await db.insert(schema.routeGraphActiveVersion).values({
      id: 1,
      versionId: 1,
      updatedAt: new Date().toISOString(),
    }).run();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: {
        authorization: 'Bearer sk-global-proxy-token',
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('invalid');
  }, 15_000);

  it('returns only whitelist models for managed key with supportedModels policy', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'test-site',
      url: 'https://upstream.example.com',
      platform: 'openai',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      credential: 'account-access-token',
      status: 'active',
    }).returning().get();

    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'default',
      token: 'account-api-token',
      enabled: true,
      isDefault: true,
    }).returning().get();

    await db.insert(schema.modelAvailability).values([
      {
        accountId: account.id,
        modelName: 'allowed-model',
        available: true,
      },
      {
        accountId: account.id,
        modelName: 'blocked-model',
        available: true,
      },
    ]).run();

    const allowedRoute = await createGraphNativeRouteFixture({ modelPattern: 'allowed-model' });
    const blockedRoute = await createGraphNativeRouteFixture({ modelPattern: 'blocked-model' });

    await insertRouteGroupMembers([
      {
        groupId: allowedRoute.id,
        accountId: account.id,
        tokenId: token.id,
        sourceModel: 'allowed-model',
        enabled: true,
      },
      {
        groupId: blockedRoute.id,
        accountId: account.id,
        tokenId: token.id,
        sourceModel: 'blocked-model',
        enabled: true,
      },
    ]);
    await publishCurrentGraphNativeRouteFixtures();

    await db.insert(schema.downstreamApiKeys).values({
      name: 'managed-key',
      key: 'sk-managed-whitelist',
      enabled: true,
      supportedModels: JSON.stringify(['allowed-model']),
    }).run();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: {
        authorization: 'Bearer sk-managed-whitelist',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      object: 'list';
      data: Array<{ id: string }>;
    };
    const ids = body.data.map((item) => item.id);
    expect(ids).toContain('allowed-model');
    expect(ids).not.toContain('blocked-model');
  });

  it('returns only the selected compiled plan public model for a managed key', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'test-site',
      url: 'https://upstream.example.com',
      platform: 'openai',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      credential: 'account-access-token',
      status: 'active',
    }).returning().get();

    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'default',
      token: 'account-api-token',
      enabled: true,
      isDefault: true,
    }).returning().get();

    await db.insert(schema.modelAvailability).values([
      {
        accountId: account.id,
        modelName: 'claude-opus-4-5',
        available: true,
      },
      {
        accountId: account.id,
        modelName: 'claude-sonnet-4-5',
        available: true,
      },
    ]).run();

    const groupRoute = await createGraphNativeRouteFixture({
      modelPattern: 're:^claude-(opus|sonnet)-4-5$',
      displayName: 'claude-opus-4-6',
    });

    await insertRouteGroupMember({
      groupId: groupRoute.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: 'claude-sonnet-4-5',
      enabled: true,
    });
    await publishCurrentGraphNativeRouteFixtures();

    await db.insert(schema.downstreamApiKeys).values({
      name: 'managed-key',
      key: 'sk-managed-group-only',
      enabled: true,
      allowedPlanIds: JSON.stringify([await compiledPlanIdForModel('claude-opus-4-6')]),
    }).run();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: {
        authorization: 'Bearer sk-managed-group-only',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      object: 'list';
      data: Array<{ id: string }>;
    };

    const ids = body.data.map((item) => item.id);
    expect(ids).toContain('claude-opus-4-6');
    expect(ids).not.toContain('claude-opus-4-5');
    expect(ids).not.toContain('claude-sonnet-4-5');
  });

  it('returns no models for managed key with empty model and group selections', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'deny-all-site',
      url: 'https://deny-all.example.com',
      platform: 'openai',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      credential: 'deny-all-access-token',
      status: 'active',
    }).returning().get();

    await db.insert(schema.modelAvailability).values([
      {
        accountId: account.id,
        modelName: 'gpt-4o-mini',
        available: true,
      },
      {
        accountId: account.id,
        modelName: 'claude-opus-4-6',
        available: true,
      },
    ]).run();

    await db.insert(schema.downstreamApiKeys).values({
      name: 'managed-key-deny-all',
      key: 'sk-managed-deny-all',
      enabled: true,
      supportedModels: JSON.stringify([]),
      allowedPlanIds: JSON.stringify([]),
    }).run();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: {
        authorization: 'Bearer sk-managed-deny-all',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      object: 'list';
      data: Array<{ id: string }>;
    };

    expect(body.data).toEqual([]);
  }, 15_000);

  it('returns only an explicit public compiled plan while hiding source entries', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'explicit-group-site',
      url: 'https://explicit-group.example.com',
      platform: 'openai',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      credential: 'explicit-group-access-token',
      status: 'active',
    }).returning().get();

    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'default',
      token: 'explicit-group-api-token',
      enabled: true,
      isDefault: true,
    }).returning().get();

    await db.insert(schema.modelAvailability).values([
      {
        accountId: account.id,
        modelName: 'claude-opus-4-5',
        available: true,
      },
      {
        accountId: account.id,
        modelName: 'claude-sonnet-4-5',
        available: true,
      },
    ]).run();

    const sourceEndpointRouteA = await createGraphNativeRouteFixture({ modelPattern: 'claude-opus-4-5' });
    const sourceEndpointRouteB = await createGraphNativeRouteFixture({ modelPattern: 'claude-sonnet-4-5' });

    await insertRouteGroupMembers([
      {
        groupId: sourceEndpointRouteA.id,
        accountId: account.id,
        tokenId: token.id,
        sourceModel: 'claude-opus-4-5',
        enabled: true,
      },
      {
        groupId: sourceEndpointRouteB.id,
        accountId: account.id,
        tokenId: token.id,
        sourceModel: 'claude-sonnet-4-5',
        enabled: true,
      },
    ]);
    await publishCurrentGraphNativeRouteFixtures();
    const groupResponse = await app.inject({
      method: 'POST',
      url: '/api/route-groups',
      payload: {
        model: {
          publicName: 'claude-opus-4-6',
        },
        sourceSelection: { kind: 'explicit', sources: [
          { kind: 'route_group', id: sourceEndpointRouteA.id },
          { kind: 'route_group', id: sourceEndpointRouteB.id },
        ] },
        presentation: {
          displayName: 'claude-opus-4-6',
        },
      },
    });
    expect(groupResponse.statusCode).toBe(200);
    const groupKey = (groupResponse.json() as { id: string }).id;
    expect(groupKey).toBeTruthy();

    await db.insert(schema.downstreamApiKeys).values({
      name: 'managed-explicit-group-key',
      key: 'sk-managed-explicit-group',
      enabled: true,
      allowedPlanIds: JSON.stringify([await compiledPlanIdForModel('claude-opus-4-6')]),
    }).run();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: {
        authorization: 'Bearer sk-managed-explicit-group',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      object: 'list';
      data: Array<{ id: string }>;
    };

    const ids = body.data.map((item) => item.id);
    expect(ids).toContain('claude-opus-4-6');
    expect(ids).not.toContain('claude-opus-4-5');
    expect(ids).not.toContain('claude-sonnet-4-5');
  });

  it('does not expose an unrelated public plan when a source plan is selected', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'explicit-source-policy-site',
      url: 'https://explicit-source-policy.example.com',
      platform: 'openai',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      credential: 'explicit-source-policy-access-token',
      status: 'active',
    }).returning().get();

    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'default',
      token: 'explicit-source-policy-api-token',
      enabled: true,
      isDefault: true,
    }).returning().get();

    await db.insert(schema.modelAvailability).values([
      {
        accountId: account.id,
        modelName: 'source-only-a',
        available: true,
      },
      {
        accountId: account.id,
        modelName: 'source-only-b',
        available: true,
      },
    ]).run();

    const sourceEndpointRouteA = await createGraphNativeRouteFixture({ modelPattern: 'source-only-a' });
    const sourceEndpointRouteB = await createGraphNativeRouteFixture({ modelPattern: 'source-only-b' });

    await insertRouteGroupMembers([
      {
        groupId: sourceEndpointRouteA.id,
        accountId: account.id,
        tokenId: token.id,
        sourceModel: 'source-only-a',
        enabled: true,
      },
      {
        groupId: sourceEndpointRouteB.id,
        accountId: account.id,
        tokenId: token.id,
        sourceModel: 'source-only-b',
        enabled: true,
      },
    ]);
    await publishCurrentGraphNativeRouteFixtures();
    const groupResponse = await app.inject({
      method: 'POST',
      url: '/api/route-groups',
      payload: {
        model: {
          publicName: 'public-source-group',
        },
        sourceSelection: { kind: 'explicit', sources: [
          { kind: 'route_group', id: sourceEndpointRouteA.id },
          { kind: 'route_group', id: sourceEndpointRouteB.id },
        ] },
        presentation: {
          displayName: 'public-source-group',
        },
      },
    });
    expect(groupResponse.statusCode).toBe(200);

    await db.insert(schema.downstreamApiKeys).values({
      name: 'managed-source-only-key',
      key: 'sk-managed-source-only',
      enabled: true,
      allowedPlanIds: JSON.stringify([await compiledPlanIdForModel('source-only-a')]),
    }).run();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: {
        authorization: 'Bearer sk-managed-source-only',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      object: 'list';
      data: Array<{ id: string }>;
    };
    const ids = body.data.map((item) => item.id);
    expect(ids).toContain('source-only-a');
    expect(ids).not.toContain('source-only-b');
    expect(ids).not.toContain('public-source-group');
  });

  it('filters search pseudo models out of /v1/models', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'search-site',
      url: 'https://search.example.com',
      platform: 'openai',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      credential: 'search-access-token',
      status: 'active',
    }).returning().get();

    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'default',
      token: 'search-api-token',
      enabled: true,
      isDefault: true,
    }).returning().get();

    await db.insert(schema.modelAvailability).values([
      {
        accountId: account.id,
        modelName: '__search',
        available: true,
      },
      {
        accountId: account.id,
        modelName: '__tavily_search',
        available: true,
      },
      {
        accountId: account.id,
        modelName: 'gpt-4.1',
        available: true,
      },
    ]).run();

    const searchRoute = await createGraphNativeRouteFixture({ modelPattern: '__search' });
    const llmRoute = await createGraphNativeRouteFixture({ modelPattern: 'gpt-4.1' });

    await insertRouteGroupMembers([
      {
        groupId: searchRoute.id,
        accountId: account.id,
        tokenId: token.id,
        sourceModel: '__search',
        enabled: true,
      },
      {
        groupId: llmRoute.id,
        accountId: account.id,
        tokenId: token.id,
        sourceModel: 'gpt-4.1',
        enabled: true,
      },
    ]);
    await publishCurrentGraphNativeRouteFixtures();

    await db.insert(schema.downstreamApiKeys).values({
      name: 'search-key',
      key: 'sk-search-key',
      enabled: true,
      supportedModels: JSON.stringify(['gpt-4.1']),
    }).run();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: {
        authorization: 'Bearer sk-search-key',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      object: 'list';
      data: Array<{ id: string }>;
    };
    const ids = body.data.map((item) => item.id);
    expect(ids).toContain('gpt-4.1');
    expect(ids).not.toContain('__search');
    expect(ids).not.toContain('__tavily_search');
  });

  it('retrieves a single model through /v1/models/:model', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'single-model-site',
      url: 'https://single-model.example.com',
      platform: 'openai',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      credential: 'single-model-access-token',
      status: 'active',
    }).returning().get();

    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'default',
      token: 'single-model-api-token',
      enabled: true,
      isDefault: true,
    }).returning().get();

    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'gpt-4.1',
      available: true,
    }).run();

    const route = await createGraphNativeRouteFixture({ modelPattern: 'gpt-4.1' });

    await insertRouteGroupMember({
      groupId: route.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: 'gpt-4.1',
      enabled: true,
    });
    await publishCurrentGraphNativeRouteFixtures();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/models/gpt-4.1',
      headers: {
        authorization: 'Bearer sk-global-proxy-token',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'gpt-4.1',
      object: 'model',
      owned_by: 'metapi',
    });
  });

  it('exposes /v1beta/openai/models as an OpenAI model list alias', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'gemini-openai-models-site',
      url: 'https://gemini-openai-models.example.com',
      platform: 'openai',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      credential: 'gemini-openai-models-access-token',
      status: 'active',
    }).returning().get();

    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'default',
      token: 'gemini-openai-models-api-token',
      enabled: true,
      isDefault: true,
    }).returning().get();

    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'gpt-4.1',
      available: true,
    }).run();

    const route = await createGraphNativeRouteFixture({ modelPattern: 'gpt-4.1' });

    await insertRouteGroupMember({
      groupId: route.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: 'gpt-4.1',
      enabled: true,
    });
    await publishCurrentGraphNativeRouteFixtures();

    const response = await app.inject({
      method: 'GET',
      url: '/v1beta/openai/models',
      headers: {
        authorization: 'Bearer sk-global-proxy-token',
        'x-api-key': 'anthropic-style-header-must-not-change-format',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      object: 'list',
      data: [
        {
          id: 'gpt-4.1',
          object: 'model',
          owned_by: 'metapi',
        },
      ],
    });
  });
});
