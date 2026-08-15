import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../../testing/dbHarness.js';
import { mergeAccountExtraConfig } from '../../services/accountExtraConfig.js';
import {
  clearRouteGroupMemberTestData,
  insertRouteGroupMember,
} from '../../../testing/routeGroupMemberTestUtils.js';

type DbModule = typeof import('../../db/index.js');
type RouteGroupGraphTestHarnessModule = typeof import('../../test/routeGroupGraphTestHarness.js');
type RouteGroupManagementServiceModule = typeof import('../../services/routeGroupManagementService.js');

describe('search routes', () => {
  let app: FastifyInstance;
  let runtimeDb: IsolatedRuntimeDbHandle;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let publishRouteGroupGraphForTest: RouteGroupGraphTestHarnessModule['publishRouteGroupGraphForTest'];
  let createRouteGroupFromPayload: RouteGroupManagementServiceModule['createRouteGroupFromPayload'];

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-search-route-');
    const dbModule = runtimeDb.dbModule;
    const routesModule = await import('./search.js');
    const routeGroupGraphTestHarness = await import('../../test/routeGroupGraphTestHarness.js');
    const routeGroupManagementService = await import('../../services/routeGroupManagementService.js');
    db = dbModule.db;
    schema = dbModule.schema;
    publishRouteGroupGraphForTest = routeGroupGraphTestHarness.publishRouteGroupGraphForTest;
    createRouteGroupFromPayload = routeGroupManagementService.createRouteGroupFromPayload;

    app = Fastify();
    await app.register(routesModule.searchRoutes);
  });

  beforeEach(async () => {
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.compiledRuntimeActiveArtifact).run();
    await db.delete(schema.compiledRuntimeArtifacts).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.compiledRuntimeActiveArtifact).run();
    await db.delete(schema.compiledRuntimeArtifacts).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.accountTokens).run();
    await clearRouteGroupMemberTestData();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.tokenModelAvailability).run();
    await db.delete(schema.modelAvailability).run();
    await db.delete(schema.checkinLogs).run();
    await db.delete(schema.proxyLogs).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await app.close();
    await runtimeDb.cleanup();
  });

  it('returns apikey connections and account tokens for global search', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'searchable key site',
      url: 'https://searchable-key.example.com',
      platform: 'new-api',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: '',
      credentialMode: 'apikey',
      credential: '',
      credentialKind: 'none',
      status: 'active',
    }).returning().get();

    await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'searchable token',
      token: 'sk-token-searchable',
      tokenGroup: 'searchable-group',
      enabled: true,
      isDefault: true,
    }).run();

    const response = await app.inject({
      method: 'POST',
      url: '/api/search',
      payload: {
        query: 'searchable',
        limit: 20,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      accounts: [
        expect.objectContaining({
          id: account.id,
          segment: 'apikey',
          site: expect.objectContaining({
            name: 'searchable key site',
          }),
        }),
      ],
      accountTokens: [
        expect.objectContaining({
          name: 'searchable token',
          accountId: account.id,
          site: expect.objectContaining({
            name: 'searchable key site',
          }),
        }),
      ],
    });
  });

  it('finds apikey accounts by the API Key display label', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'plain site',
      url: 'https://plain.example.com',
      platform: 'new-api',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: '',
      credentialMode: 'apikey',
      credential: '',
      credentialKind: 'none',
      status: 'active',
    }).returning().get();

    const response = await app.inject({
      method: 'POST',
      url: '/api/search',
      payload: {
        query: 'API Key',
        limit: 20,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      accounts: [
        expect.objectContaining({
          id: account.id,
          segment: 'apikey',
        }),
      ],
    });
  });

  it('labels OAuth accounts as OAuth instead of misclassifying them as session connections', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'codex oauth site',
      url: 'https://oauth.example.com',
      platform: 'codex',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'oauth-search-user',
      credentialMode: 'oauth',
      credential: 'oauth-access-token',
      credentialKind: 'oauth_access_token',
      oauthProvider: 'codex',
      status: 'active',
    }).returning().get();

    const response = await app.inject({
      method: 'POST',
      url: '/api/search',
      payload: { query: 'oauth-search-user', limit: 20 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: account.id, segment: 'oauth' }),
    ]));
  });

  it('returns site matches for platform keywords in global search', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Direct Workspace',
      url: 'https://workspace.example.com',
      platform: 'codex',
    }).returning().get();

    const response = await app.inject({
      method: 'POST',
      url: '/api/search',
      payload: {
        query: 'codex',
        limit: 20,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sites: [
        expect.objectContaining({
          id: site.id,
          name: 'Direct Workspace',
          url: 'https://workspace.example.com',
        }),
      ],
    });
  });

  async function createPublicRuntimeRoute(input: {
    modelName: string;
    accountId: number;
    tokenId?: number | null;
  }) {
    const summary = await createRouteGroupFromPayload({
      model: {
        publicName: input.modelName,
        upstreamName: input.modelName,
      },
      presentation: {
        displayName: input.modelName,
      },
      dispatcherPolicy: { kind: 'builtin', builtin: 'weighted' },
      enabled: true,
    });
    await insertRouteGroupMember({
      groupId: summary.id,
      accountId: input.accountId,
      tokenId: input.tokenId ?? null,
      sourceModel: input.modelName,
      fallbackStageOrder: 0,
      weight: 10,
      enabled: true,
    });
    return summary;
  }

  async function publishActiveCompiledRuntime(): Promise<void> {
    const published = await publishRouteGroupGraphForTest('search-test');
    expect(published.status).toBe('active');
  }

  it('returns model search results from active compiled runtime inventory only', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'codex site',
      url: 'https://chatgpt.com/backend-api/codex',
      platform: 'codex',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'codex-user@example.com',
      credential: 'oauth-access-token',

      status: 'active',
      extraConfig: mergeAccountExtraConfig(null, {
        credentialMode: 'session',
        oauth: {
          provider: 'codex',
          accountId: 'chatgpt-account-123',
          email: 'codex-user@example.com',
          planType: 'team',
        },
      }),
    }).returning().get();

    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'gpt-5.2-codex',
      available: true,
    }).run();

    const discoveryOnlyResponse = await app.inject({
      method: 'POST',
      url: '/api/search',
      payload: {
        query: 'gpt-5.2',
        limit: 20,
      },
    });

    expect(discoveryOnlyResponse.statusCode).toBe(200);
    expect(discoveryOnlyResponse.json()).toMatchObject({
      models: [],
    });

    await createPublicRuntimeRoute({
      modelName: 'gpt-5.2-codex',
      accountId: account.id,
      tokenId: null,
    });
    await publishActiveCompiledRuntime();

    const runtimeResponse = await app.inject({
      method: 'POST',
      url: '/api/search',
      payload: {
        query: 'gpt-5.2',
        limit: 20,
      },
    });

    expect(runtimeResponse.statusCode).toBe(200);
    expect(runtimeResponse.json()).toMatchObject({
      models: [
        expect.objectContaining({
          name: 'gpt-5.2-codex',
          accountCount: 1,
          tokenCount: 0,
          siteCount: 1,
        }),
      ],
    });
  });
});
