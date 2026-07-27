import { createTestApp, type TestAppHandle } from './appHarness.js';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from './dbHarness.js';
import {
  createUpstreamMock,
  type UpstreamMockHandle,
} from './upstreamMock.js';
import {
  createGraphNativeRouteFixture,
  publishCurrentGraphNativeRouteFixtures,
  resetGraphNativeRouteFixtures,
} from '../server/test/graphNativeRouteFixtures.js';
import { getCompiledRouterPlanById } from '../shared/compiledRuntime.js';

type DbModule = typeof import('../server/db/index.js');
type RouteGraphServiceModule = typeof import('../server/services/routeGraphService.js');
type RouteGroupCandidateTestUtilsModule = typeof import('./routeGroupMemberTestUtils.js');

export type SeedProxyRouteInput = {
  model?: string;
  platform?: string;
  siteUrl?: string;
  tokenValue?: string;
  accountExtraConfig?: Record<string, unknown>;
  routeEnabled?: boolean;
  candidateEnabled?: boolean;
};

export type SeedProxyRouteResult = {
  site: any;
  account: any;
  token: any;
  route: any;
  candidate: any;
  managedKey: any;
};

export type ProxyRelayHarness = {
  app: TestAppHandle;
  runtimeDb: IsolatedRuntimeDbHandle;
  db: DbModule['db'];
  schema: DbModule['schema'];
  upstream: UpstreamMockHandle;
  resetUpstream: () => UpstreamMockHandle;
  seedRoute: (input?: SeedProxyRouteInput) => Promise<SeedProxyRouteResult>;
  resetData: () => Promise<void>;
  close: () => Promise<void>;
};

function defaultSiteUrl(platform: string): string {
  if (platform === 'gemini') return 'https://generativelanguage.googleapis.com';
  if (platform === 'claude') return 'https://api.anthropic.com';
  return 'https://upstream.test';
}

export async function createProxyRelayHarness(prefix = 'metapi-proxy-relay-'): Promise<ProxyRelayHarness> {
  const runtimeDb = await bootIsolatedRuntimeDb(prefix);
  const dbModule = runtimeDb.dbModule;
  const proxyRouterModule = await import('../server/routes/proxy/router.js');
  const routeGraphServiceModule: RouteGraphServiceModule = await import('../server/services/routeGraphService.js');
  const routeGroupMemberTestUtils: RouteGroupCandidateTestUtilsModule = await import('./routeGroupMemberTestUtils.js');
  const db = dbModule.db;
  const schema = dbModule.schema;
  let upstream = createUpstreamMock();

  const app = await createTestApp({
    routes: [proxyRouterModule.proxyRoutes],
    auth: 'none',
    env: {
      DATA_DIR: runtimeDb.path,
      DB_TYPE: 'sqlite',
      PROXY_TOKEN: 'sk-relay-proxy',
    },
  });

  async function resetData() {
    upstream.restore();
    upstream = createUpstreamMock();
    await db.delete(schema.proxyDebugAttempts).run();
    await db.delete(schema.proxyDebugTraces).run();
    await db.delete(schema.proxyVideoTasks).run();
    await db.delete(schema.proxyFiles).run();
    await db.delete(schema.proxyLogs).run();
    await db.delete(schema.endpointModelObservations).run();
    await db.delete(schema.credentialEndpointBindings).run();
    await db.delete(schema.apiEndpointProfiles).run();
    await db.delete(schema.modelCatalogSources).run();
    await routeGroupMemberTestUtils.clearRouteGroupMemberTestData();
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.downstreamApiKeys).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
    resetGraphNativeRouteFixtures();
    routeGraphServiceModule.invalidateRouteGraphReadCaches('test-reset');
  }

  async function seedRoute(input: SeedProxyRouteInput = {}) {
    const model = input.model || 'relay-model';
    const platform = input.platform || 'openai';
    const site = await db.insert(schema.sites).values({
      name: `${model}-site`,
      url: input.siteUrl || defaultSiteUrl(platform),
      platform,
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: `${model}-account`,
      accessToken: `${model}-access`,
      apiToken: `${model}-api-key`,
      status: 'active',
      extraConfig: JSON.stringify({
        credentialMode: 'apikey',
        ...(input.accountExtraConfig || {}),
      }),
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: `${model}-token`,
      token: input.tokenValue || `${model}-token-value`,
      enabled: true,
      isDefault: true,
    }).returning().get();
    const route = await createGraphNativeRouteFixture({
      modelPattern: model,
      displayName: model,
      enabled: input.routeEnabled ?? true,
    });
    const candidate = await routeGroupMemberTestUtils.insertRouteGroupMember({
      groupId: route.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: model,
      fallbackStageOrder: 0,
      weight: 10,
      enabled: input.candidateEnabled ?? true,
    });
    const executionTargetId = await routeGroupMemberTestUtils.getExecutionTargetIdForMember(candidate.id);
    if (!executionTargetId) {
      throw new Error('Failed to resolve execution target for proxy relay fixture');
    }
    const published = await publishCurrentGraphNativeRouteFixtures();
    const bundle = published.compiledGraph.compiledRouterBundle;
    if (!bundle) throw new Error('Published proxy relay fixture has no compiled runtime bundle');
    const executionAttempt = bundle.plans
      .flatMap((storedPlan) => getCompiledRouterPlanById(bundle, storedPlan.id)?.executionAlternatives || [])
      .map((alternative) => alternative.executionAttempt)
      .find((attempt) => attempt?.transportBinding?.executionTargetId === executionTargetId);
    if (!executionAttempt?.executionAttemptId) {
      throw new Error('Compiler did not issue an execution attempt identity for proxy relay fixture');
    }
    const managedKey = await db.insert(schema.downstreamApiKeys).values({
      name: `${model}-managed-key`,
      key: `${model}-managed-key-value`,
      enabled: true,
      supportedModels: JSON.stringify([model]),
    }).returning().get();
    routeGraphServiceModule.invalidateRouteGraphReadCaches('test-reset');
    return {
      site,
      account,
      token,
      route,
      candidate: {
        ...candidate,
        executionTargetId,
        executionAttemptId: executionAttempt.executionAttemptId,
      },
      managedKey,
    };
  }

  return {
    app,
    runtimeDb,
    db,
    schema,
    get upstream() {
      return upstream;
    },
    resetUpstream() {
      upstream.restore();
      upstream = createUpstreamMock();
      return upstream;
    },
    seedRoute,
    resetData,
    close: async () => {
      upstream.restore();
      routeGraphServiceModule.invalidateRouteGraphReadCaches('test-reset');
      await app.close();
      await runtimeDb.cleanup();
    },
  };
}
