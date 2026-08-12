import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../../testing/dbHarness.js';
import { createTestApp, type TestAppHandle } from '../../../testing/appHarness.js';
import {
  clearRouteGroupMemberTestData,
  getExecutionTargetIdForMember,
  insertRouteGroupMember,
} from '../../../testing/routeGroupMemberTestUtils.js';
import { formatUtcSqlDateTime } from '../../services/localTimeService.js';

type DbModule = typeof import('../../db/index.js');
type RouteGraphServiceModule = typeof import('../../services/routeGraphService.js');
type RouteGroupManagementModule = typeof import('../../services/routeGroupManagementService.js');
type RouteRuntimeExecutionIdentityModule = typeof import('../../services/routeRuntimeExecutionIdentityService.js');

const fetchUpstreamPricingCatalogMock = vi.hoisted(() => vi.fn(async () => null));

vi.mock('../../services/upstreamPricingCatalogService.js', () => ({
  fetchUpstreamPricingCatalog: fetchUpstreamPricingCatalogMock,
  fetchUpstreamPricingCatalogWithMetadata: async (input: unknown) => {
    const catalog = await fetchUpstreamPricingCatalogMock(input);
    return catalog ? { catalog, credentialKind: 'access_token' } : null;
  },
}));

type RouteFlowResponse = {
  success: boolean;
  flow: {
    requestedModel: string;
    matched: boolean;
    diagnostics: Array<{ level: string; message: string }>;
    compiledRuntime: null | {
      match: {
        requestedModel: string;
        planId: string;
        entryNodeId: string;
      };
      selected: {
        alternativeId: string | null;
        endpointId: string | null;
        executionAttemptId: string | null;
        accountId: number | null;
        selectionSource: string;
        actualModel: string | null;
      };
      alternatives: Array<{
        alternativeId: string;
        kind: string;
        probability: number | null;
        executionAttemptIds: string[];
        syntheticResponse?: { statusCode: number; message: string } | null;
      }>;
      endpoints: Array<{ endpointId: string; executionAttemptIds: string[] }>;
      executionAttempts: Array<{
        executionAttemptId: string;
        alternativeId: string;
        endpointId: string;
        executionTargetId?: number | null;
        model: string;
        siteName?: string | null;
        accountLabel?: string | null;
        tokenLabel?: string | null;
        probability: number | null;
        routingSignals?: {
          unitCost: number;
          unitCostSource: string;
          balance: number;
          normalizedCostScore: number | null;
          normalizedBalanceScore: number | null;
          probability: number | null;
          runtimeHealth: {
            recentSuccessRate: number;
            recentSampleCount: number;
          };
          historicalHealth: {
            totalCalls: number;
            successRate: number | null;
          };
        };
        health: {
          successRate: number | null;
          totalCalls: number;
          avgLatencyMs: number | null;
        };
      }>;
      syntheticResponse?: { statusCode: number; message: string } | null;
    };
    entryPricing?: {
      theoretical?: {
        executionAttempts: Array<{ executionAttemptId: string; probability: number | null }>;
      } | null;
    };
    compatibilityPolicy?: {
      resolved: {
        reasoningHistory: {
          transport: {
            mode: string;
            thinkTag: { openTag: string; closeTag: string };
          };
        };
      };
      layers: Array<{ source: string; configured: boolean }>;
    };
    nodes?: unknown[];
    edges?: unknown[];
    summary?: unknown[];
  };
};

describe('/api/models/route-flow', () => {
  let app: TestAppHandle | null = null;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let publishRouteGraphSource: RouteGraphServiceModule['publishRouteGraphSource'] | null = null;
  let invalidateRouteGraphReadCaches: RouteGraphServiceModule['invalidateRouteGraphReadCaches'];
  let createRouteGroupFromPayload: RouteGroupManagementModule['createRouteGroupFromPayload'];
  let invalidateRouteRuntimeExecutionIdentityCache: RouteRuntimeExecutionIdentityModule['invalidateRouteRuntimeExecutionIdentityCache'];
  let runtimeDb: IsolatedRuntimeDbHandle | null = null;

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-stats-route-flow-');
    const dbModule = runtimeDb.dbModule;
    const routesModule = await import('./stats.js');
    const routeGraphServiceModule = await import('../../services/routeGraphService.js');
    const routeGroupManagementModule = await import('../../services/routeGroupManagementService.js');
    const routeRuntimeExecutionIdentityModule = await import('../../services/routeRuntimeExecutionIdentityService.js');
    db = dbModule.db;
    schema = dbModule.schema;
    publishRouteGraphSource = routeGraphServiceModule.publishRouteGraphSource;
    invalidateRouteGraphReadCaches = routeGraphServiceModule.invalidateRouteGraphReadCaches;
    createRouteGroupFromPayload = routeGroupManagementModule.createRouteGroupFromPayload;
    invalidateRouteRuntimeExecutionIdentityCache = routeRuntimeExecutionIdentityModule.invalidateRouteRuntimeExecutionIdentityCache;

    app = await createTestApp({
      routes: [routesModule.statsRoutes],
      auth: 'admin-api',
    });
  });

  beforeEach(async () => {
    fetchUpstreamPricingCatalogMock.mockReset();
    fetchUpstreamPricingCatalogMock.mockResolvedValue(null);
    await db.delete(schema.proxyLogs).run();
    await db.delete(schema.proxyRequests).run();
    await db.delete(schema.routeRuntimeDayUsage).run();
    await db.delete(schema.providerPricingCatalogCaches).run();
    await db.delete(schema.upstreamModelCostPricings).run();
    await clearRouteGroupMemberTestData();
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.compiledRuntimeActiveArtifact).run();
    await db.delete(schema.compiledRuntimeArtifacts).run();
    await db.delete(schema.routeGraphVersions).run();
    invalidateRouteGraphReadCaches('test-reset');
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await app?.close();
    await runtimeDb?.cleanup();
  });

  async function createRouteGroup(input: {
    model: string;
    displayName?: string | null;
    enabled?: boolean;
    visibility?: string;
  }) {
    return await createRouteGroupFromPayload({
      model: { publicName: input.model },
      presentation: { displayName: input.displayName ?? input.model },
      enabled: input.enabled ?? true,
      visibility: input.visibility ?? 'public',
      dispatcherPolicy: { kind: 'builtin', builtin: 'weighted' },
    });
  }

  async function insertTerminalRequest(input: {
    id: string;
    routeEntrypointId: string;
    requestedModel: string;
    status: 'success' | 'failure';
    httpStatus: number;
    completedAt: string;
    latencyMs?: number | null;
    firstTokenLatencyMs?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
  }) {
    await db.insert(schema.proxyRequests).values({
      id: input.id,
      downstreamPath: '/v1/chat/completions',
      requestedModel: input.requestedModel,
      routeEntrypointId: input.routeEntrypointId,
      status: input.status,
      httpStatus: input.httpStatus,
      latencyMs: input.latencyMs ?? null,
      firstTokenLatencyMs: input.firstTokenLatencyMs ?? null,
      completionTokens: input.completionTokens ?? null,
      totalTokens: input.totalTokens ?? null,
      startedAt: input.completedAt,
      completedAt: input.completedAt,
    }).run();
  }

  async function publishManagedRouteGroupsForTest(): Promise<void> {
    const { getActiveRouteGraphSourceVersion } = await import('../../services/routeGraphService.js');
    expect(await getActiveRouteGraphSourceVersion()).toBeTruthy();
  }

  it('returns a graph-native compiled runtime projection with execution attempt metrics', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'flow-site',
      url: 'https://flow-site.example.com',
      platform: 'new-api',
      status: 'active',
      globalWeight: 1.25,
      compatibilityPolicy: JSON.stringify({
        reasoningHistory: {
          transport: {
            mode: 'content_think_tag',
            thinkTag: { openTag: '<reason>', closeTag: '</reason>' },
          },
        },
      }),
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'flow-user',
      apiToken: 'sk-flow',
      accessToken: 'access-flow',
      status: 'active',
      balance: 42,
    }).returning().get();
    const route = await createRouteGroup({ model: 'gpt-4o-mini' });
    const candidate = await insertRouteGroupMember({
      groupId: route.id,
      accountId: account.id,
      tokenId: null,
      sourceModel: 'gpt-4o-mini',
      fallbackStageOrder: 0,
      weight: 10,
      enabled: true,
      successCount: 4,
      failCount: 1,
      totalLatencyMs: 480,
      totalCost: 0.02,
    });
    const executionTargetId = await getExecutionTargetIdForMember(candidate.id);
    if (!executionTargetId) throw new Error('Expected graph-native execution target for test candidate');
    await publishManagedRouteGroupsForTest();
    const now = new Date();
    const recentCreatedAt = formatUtcSqlDateTime(now);
    await db.insert(schema.proxyLogs).values([
      {
        accountId: account.id,
        modelRequested: 'gpt-4o-mini',
        modelActual: 'gpt-4o-mini',
        executionTargetId: executionTargetId,
        status: 'success',
        httpStatus: 200,
        latencyMs: 120,
        createdAt: recentCreatedAt,
      },
      {
        accountId: account.id,
        modelRequested: 'gpt-4o-mini',
        modelActual: 'gpt-4o-mini',
        executionTargetId: executionTargetId,
        status: 'retried',
        httpStatus: 502,
        createdAt: recentCreatedAt,
      },
    ]).run();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/models/gpt-4o-mini/route-flow',
      headers: app!.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as RouteFlowResponse;
    expect(body.success).toBe(true);
    expect(body.flow).toMatchObject({
      matched: true,
      requestedModel: 'gpt-4o-mini',
    });
    expect(body.flow).not.toHaveProperty('actualModel');
    expect(body.flow).not.toHaveProperty('entryId');
    expect(body.flow).not.toHaveProperty('selectedEndpointId');
    expect(body.flow).not.toHaveProperty('selectedAccountId');
    expect(body.flow.nodes).toBeUndefined();
    expect(body.flow.edges).toBeUndefined();
    expect(body.flow.summary).toBeUndefined();

    const runtime = body.flow.compiledRuntime;
    expect(runtime).toBeTruthy();
    expect(runtime?.match.requestedModel).toBe('gpt-4o-mini');
    expect(runtime?.selected.accountId).toBe(account.id);
    expect(runtime?.selected.executionAttemptId).toEqual(expect.any(String));
    expect(runtime?.executionAttempts).toHaveLength(1);
    expect(runtime?.executionAttempts[0]).toMatchObject({
      executionTargetId,
      endpointId: runtime?.selected.endpointId,
      model: 'gpt-4o-mini',
      siteName: 'flow-site',
      accountLabel: 'flow-user',
      probability: 1,
      health: {
        successRate: 0.5,
          totalCalls: 2,
          avgLatencyMs: 120,
        },
        routingSignals: {
          referencePricing: {
            scenario: 'routing_reference',
            source: 'unavailable',
            effectiveCost: null,
          },
          balance: 42,
          rawBalance: 42,
          normalizedCostScore: 0.5,
          normalizedBalanceScore: 0.5,
          normalizedBalance: 0.5,
        runtimeHealth: {
          recentSuccessRate: 0.5,
          recentSampleCount: 2,
        },
        historicalHealth: {
          totalCalls: 5,
          successRate: 0.8,
        },
      },
    });
    expect(runtime?.executionAttempts[0]?.routingSignals?.normalizedCostScore).toBeDefined();
    expect(body.flow.entryPricing?.theoretical?.executionAttempts).toHaveLength(1);
    expect('candidates' in (body.flow.entryPricing?.theoretical || {})).toBe(false);
    expect(body.flow.compatibilityPolicy?.layers.map((layer) => layer.source)).toContain('execution_attempt');
    expect(body.flow.compatibilityPolicy?.resolved.reasoningHistory.transport).toMatchObject({
      mode: 'content_think_tag',
      thinkTag: {
        openTag: '<reason>',
        closeTag: '</reason>',
      },
    });
  });

  it('does not enrich route-flow execution attempts from stale compiled credential fields', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'missing-identity-site',
      url: 'https://missing-identity.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'missing-identity-account',
      apiToken: 'sk-missing-identity',
      accessToken: 'access-missing-identity',
      status: 'active',
      balance: 100,
    }).returning().get();
    const route = await createRouteGroup({ model: 'missing-identity-flow-model' });
    await insertRouteGroupMember({
      groupId: route.id,
      accountId: account.id,
      tokenId: null,
      sourceModel: 'missing-identity-flow-model',
      fallbackStageOrder: 0,
      weight: 10,
      enabled: true,
    });
    await publishManagedRouteGroupsForTest();
    await db.delete(schema.accounts).run();
    invalidateRouteRuntimeExecutionIdentityCache();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/models/missing-identity-flow-model/route-flow',
      headers: app!.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as RouteFlowResponse;
    const attempt = body.flow.compiledRuntime?.executionAttempts[0] as any;
    expect((body.flow.compiledRuntime?.selected as any)?.accountId).toBeNull();
    expect((body.flow.compiledRuntime?.selected as any)?.siteId).toBeNull();
    expect(attempt).toMatchObject({
      siteName: null,
      accountLabel: null,
      tokenLabel: null,
      apiAttempts: [],
      health: {
        successRate: null,
        totalCalls: 0,
        avgLatencyMs: null,
      },
    });
    expect(attempt.routingSignals).toBeUndefined();
    expect(attempt.apiAttemptDiagnostics).toEqual([
      expect.objectContaining({
        code: 'compiled_runtime.execution_attempt_identity_missing',
      }),
    ]);
  });

  it('returns compiled runtime observability for route product entry health and history', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'observability-site',
      url: 'https://observability-site.example.com',
      platform: 'new-api',
      status: 'active',
      globalWeight: 1,
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'observability-user',
      apiToken: 'sk-observability',
      accessToken: 'access-observability',
      status: 'active',
      balance: 10,
    }).returning().get();
    const route = await createRouteGroup({ model: 'observed-rerouted-model' });
    const candidate = await insertRouteGroupMember({
      groupId: route.id,
      accountId: account.id,
      tokenId: null,
      sourceModel: 'observed-upstream-model',
      fallbackStageOrder: 0,
      weight: 10,
      enabled: true,
    });
    const executionTargetId = await getExecutionTargetIdForMember(candidate.id);
    if (!executionTargetId) throw new Error('Expected execution target for observability candidate');
    await publishManagedRouteGroupsForTest();

    const flowResponse = await app!.inject({
      method: 'GET',
      url: '/api/models/observed-rerouted-model/route-flow',
      headers: app!.adminHeaders(),
    });
    expect(flowResponse.statusCode).toBe(200);
    const flowBody = flowResponse.json() as RouteFlowResponse;
    const attempt = flowBody.flow.compiledRuntime?.executionAttempts[0];
    expect(attempt?.executionAttemptId).toBeTruthy();
    expect(attempt?.endpointId).toBeTruthy();

    const now = new Date();
    const recentCreatedAt = formatUtcSqlDateTime(now);
    const staleCreatedAt = formatUtcSqlDateTime(new Date(now.getTime() - 10 * 60_000));
    await db.insert(schema.proxyLogs).values([
      {
        routeEntrypointId: flowBody.flow.compiledRuntime!.match.entryNodeId,
        runtimeEndpointId: attempt!.endpointId,
        executionAttemptId: attempt!.executionAttemptId,
        executionTargetId,
        accountId: account.id,
        modelRequested: 'observed-rerouted-model',
        modelActual: 'observed-upstream-model',
        status: 'failed',
        httpStatus: 502,
        latencyMs: 500,
        totalTokens: 0,
        estimatedCost: 0,
        createdAt: staleCreatedAt,
      },
      {
        routeEntrypointId: flowBody.flow.compiledRuntime!.match.entryNodeId,
        runtimeEndpointId: attempt!.endpointId,
        executionAttemptId: attempt!.executionAttemptId,
        executionTargetId,
        accountId: account.id,
        modelRequested: 'observed-rerouted-model',
        modelActual: 'observed-upstream-model',
        status: 'success',
        httpStatus: 200,
        latencyMs: 240,
        firstTokenLatencyMs: 0,
        totalTokens: 300,
        estimatedCost: 0.001,
        createdAt: recentCreatedAt,
      },
      {
        routeEntrypointId: flowBody.flow.compiledRuntime!.match.entryNodeId,
        runtimeEndpointId: attempt!.endpointId,
        executionAttemptId: attempt!.executionAttemptId,
        executionTargetId,
        accountId: account.id,
        modelRequested: 'observed-rerouted-model',
        modelActual: 'observed-upstream-model',
        status: 'retried',
        httpStatus: 502,
        latencyMs: 120,
        totalTokens: 0,
        estimatedCost: 0,
        createdAt: recentCreatedAt,
      },
    ]).run();
    await insertTerminalRequest({
      id: 'request:observed-stale-failure',
      routeEntrypointId: flowBody.flow.compiledRuntime!.match.entryNodeId,
      requestedModel: 'observed-rerouted-model',
      status: 'failure',
      httpStatus: 502,
      latencyMs: 500,
      completedAt: staleCreatedAt,
    });
    await insertTerminalRequest({
      id: 'request:observed-recent-success',
      routeEntrypointId: flowBody.flow.compiledRuntime!.match.entryNodeId,
      requestedModel: 'observed-rerouted-model',
      status: 'success',
      httpStatus: 200,
      latencyMs: 240,
      completedAt: recentCreatedAt,
    });

    const response = await app!.inject({
      method: 'GET',
      url: '/api/models/observed-rerouted-model/runtime-observability?range=7d&refresh=true',
      headers: app!.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      success: boolean;
      observability: {
        matched: boolean;
            entry: { entryId: string; requestedModel: string } | null;
        health: {
          status: string;
          source: string;
          totalCalls: number;
          successCalls: number;
          failedCalls: number;
          successRate: number | null;
          avgLatencyMs: number | null;
          avgFirstTokenLatencyMs: number | null;
        };
        executionAttempts: Array<{
          executionAttemptId: string;
          health: { source: string; totalCalls: number; successRate: number | null; avgLatencyMs: number | null };
        }>;
        endpoints: Array<{
          endpointId: string;
          health: { source: string; totalCalls: number; successRate: number | null; avgLatencyMs: number | null };
        }>;
        history: {
          range: string;
          granularity: string;
          buckets: Array<{
            entry: { totalCalls: number };
            endpoints: Array<{ endpointId: string; health: { totalCalls: number; successRate: number | null } }>;
            executionAttempts: Array<{ executionAttemptId: string; health: { totalCalls: number; successRate: number | null } }>;
          }>;
          emptyReason: string | null;
        };
      };
    };
    expect(body.success).toBe(true);
    expect(body.observability.matched).toBe(true);
    expect(body.observability.entry).toMatchObject({
      entryId: body.observability.entry?.entryId,
      requestedModel: 'observed-rerouted-model',
    });
    expect(body.observability.health).toMatchObject({
      status: 'degraded',
      source: 'entry_projection',
      totalCalls: 2,
      successCalls: 1,
      failedCalls: 1,
      successRate: 50,
      avgLatencyMs: 370,
    });
    expect(body.observability.executionAttempts[0]).toMatchObject({
      executionAttemptId: attempt!.executionAttemptId,
      health: {
        source: 'execution_attempt_projection',
        totalCalls: 3,
        successRate: 33.33,
        avgLatencyMs: 287,
      },
    });
    expect(body.observability.history.emptyReason).toBeNull();
    expect(body.observability.history.buckets[0]?.entry.totalCalls).toBe(2);
    expect(body.observability.history.buckets[0]?.entry.successRate).toBe(50);
    expect(body.observability.history.buckets[0]?.entry.status).toBe('degraded');
    expect(body.observability.history.buckets[0]?.executionAttempts[0]).toMatchObject({
      executionAttemptId: attempt!.executionAttemptId,
      health: {
        totalCalls: 3,
        successRate: 33.33,
      },
    });

    const realtimeResponse = await app!.inject({
      method: 'GET',
      url: '/api/models/observed-rerouted-model/runtime-observability?range=5m',
      headers: app!.adminHeaders(),
    });
    expect(realtimeResponse.statusCode).toBe(200);
    const realtimeBody = realtimeResponse.json() as typeof body;
    expect(realtimeBody.observability.health).toMatchObject({
      source: 'entry_projection',
      totalCalls: 1,
      successCalls: 1,
      failedCalls: 0,
      successRate: 100,
      avgLatencyMs: 240,
      avgFirstTokenLatencyMs: null,
    });
    expect(realtimeBody.observability.executionAttempts[0]).toMatchObject({
      executionAttemptId: attempt!.executionAttemptId,
      health: {
        source: 'execution_attempt_projection',
        totalCalls: 2,
        successRate: 50,
      },
    });
    expect(realtimeBody.observability.endpoints[0]).toMatchObject({
      endpointId: attempt!.endpointId,
      health: {
        source: 'endpoint_projection',
        totalCalls: 2,
        successRate: 50,
      },
    });
    expect(realtimeBody.observability.history.range).toBe('5m');
    expect(realtimeBody.observability.history.granularity).toBe('minute');
    expect(realtimeBody.observability.history.buckets.at(-1)?.entry.totalCalls).toBe(1);
    expect(realtimeBody.observability.history.buckets.at(-1)?.executionAttempts[0]).toMatchObject({
      executionAttemptId: attempt!.executionAttemptId,
      health: {
        totalCalls: 2,
        successRate: 50,
      },
    });
    expect(realtimeBody.observability.history.buckets.at(-1)?.endpoints[0]).toMatchObject({
      endpointId: attempt!.endpointId,
      health: {
        totalCalls: 2,
        successRate: 50,
      },
    });

    const defaultRangeResponse = await app!.inject({
      method: 'GET',
      url: '/api/models/observed-rerouted-model/runtime-observability',
      headers: app!.adminHeaders(),
    });
    expect(defaultRangeResponse.statusCode).toBe(200);
    const defaultRangeBody = defaultRangeResponse.json() as typeof body;
    expect(defaultRangeBody.observability.history.range).toBe('6h');
    expect(defaultRangeBody.observability.history.granularity).toBe('minute');
    expect(defaultRangeBody.observability.history.buckets.length).toBeGreaterThanOrEqual(2);
    expect(defaultRangeBody.observability.history.buckets[0]?.entry.totalCalls).toBe(1);
    expect(defaultRangeBody.observability.history.buckets.at(-1)?.entry.totalCalls).toBe(1);
  });

  it('keeps one-hour runtime history buckets at one-minute resolution', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'minute-history-site',
      url: 'https://minute-history.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'minute-history-user',
      apiToken: 'sk-minute-history',
      accessToken: 'access-minute-history',
      status: 'active',
      balance: 10,
    }).returning().get();
    const route = await createRouteGroup({ model: 'minute-history-rerouted-model' });
    const candidate = await insertRouteGroupMember({
      groupId: route.id,
      accountId: account.id,
      tokenId: null,
      sourceModel: 'minute-history-upstream-model',
      fallbackStageOrder: 0,
      weight: 10,
      enabled: true,
    });
    const executionTargetId = await getExecutionTargetIdForMember(candidate.id);
    if (!executionTargetId) throw new Error('Expected execution target for minute history candidate');
    await publishManagedRouteGroupsForTest();

    const flowResponse = await app!.inject({
      method: 'GET',
      url: '/api/models/minute-history-rerouted-model/route-flow',
      headers: app!.adminHeaders(),
    });
    expect(flowResponse.statusCode).toBe(200);
    const flowBody = flowResponse.json() as RouteFlowResponse;
    const attempt = flowBody.flow.compiledRuntime?.executionAttempts[0];
    expect(attempt?.executionAttemptId).toBeTruthy();
    expect(attempt?.endpointId).toBeTruthy();

    const now = Date.now();
    const previousFiveMinuteBucketStart = Math.floor(now / (5 * 60_000)) * 5 * 60_000 - 5 * 60_000;
    const firstCreatedAt = formatUtcSqlDateTime(new Date(previousFiveMinuteBucketStart + 60_000));
    const secondCreatedAt = formatUtcSqlDateTime(new Date(previousFiveMinuteBucketStart + 2 * 60_000));
    await db.insert(schema.proxyLogs).values([firstCreatedAt, secondCreatedAt].map((createdAt, index) => ({
      routeEntrypointId: flowBody.flow.compiledRuntime!.match.entryNodeId,
      runtimeEndpointId: attempt!.endpointId,
      executionAttemptId: attempt!.executionAttemptId,
      executionTargetId,
      accountId: account.id,
      modelRequested: 'minute-history-rerouted-model',
      modelActual: 'minute-history-upstream-model',
      status: 'success',
      httpStatus: 200,
      latencyMs: 100 + index,
      totalTokens: 10,
      estimatedCost: 0.001,
      createdAt,
    }))).run();
    await Promise.all([firstCreatedAt, secondCreatedAt].map((completedAt, index) => insertTerminalRequest({
      id: `request:minute-history:${index}`,
      routeEntrypointId: flowBody.flow.compiledRuntime!.match.entryNodeId,
      requestedModel: 'minute-history-rerouted-model',
      status: 'success',
      httpStatus: 200,
      latencyMs: 100 + index,
      completedAt,
    })));

    const response = await app!.inject({
      method: 'GET',
      url: '/api/models/minute-history-rerouted-model/runtime-observability?range=1h',
      headers: app!.adminHeaders(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      observability: {
        history: {
          granularity: string;
          buckets: Array<{ bucketStart: string; entry: { totalCalls: number } }>;
        };
      };
    };

    expect(body.observability.history.granularity).toBe('minute');
    expect(body.observability.history.buckets.map((bucket) => bucket.bucketStart)).toEqual([
      firstCreatedAt,
      secondCreatedAt,
    ]);
    expect(body.observability.history.buckets.map((bucket) => bucket.entry.totalCalls)).toEqual([1, 1]);
  });

  it('counts entry success from final downstream trace instead of internal fallback attempts', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'terminal-trace-site',
      url: 'https://terminal-trace.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'terminal-trace-user',
      apiToken: 'sk-terminal-trace',
      accessToken: 'access-terminal-trace',
      status: 'active',
      balance: 10,
    }).returning().get();
    const route = await createRouteGroup({ model: 'terminal-trace-rerouted-model' });
    const candidate = await insertRouteGroupMember({
      groupId: route.id,
      accountId: account.id,
      tokenId: null,
      sourceModel: 'terminal-trace-upstream-model',
      fallbackStageOrder: 0,
      weight: 10,
      enabled: true,
    });
    const executionTargetId = await getExecutionTargetIdForMember(candidate.id);
    if (!executionTargetId) throw new Error('Expected execution target for terminal trace candidate');
    await publishManagedRouteGroupsForTest();

    const flowResponse = await app!.inject({
      method: 'GET',
      url: '/api/models/terminal-trace-rerouted-model/route-flow',
      headers: app!.adminHeaders(),
    });
    expect(flowResponse.statusCode).toBe(200);
    const flowBody = flowResponse.json() as RouteFlowResponse;
    const attempt = flowBody.flow.compiledRuntime?.executionAttempts[0];
    expect(attempt?.executionAttemptId).toBeTruthy();

    const now = new Date();
    const recentCreatedAt = formatUtcSqlDateTime(now);
    await db.insert(schema.proxyLogs).values([
      ...Array.from({ length: 4 }, (_, index) => ({
        routeEntrypointId: flowBody.flow.compiledRuntime!.match.entryNodeId,
        runtimeEndpointId: attempt!.endpointId,
        executionAttemptId: attempt!.executionAttemptId,
        executionTargetId,
        accountId: account.id,
        modelRequested: 'terminal-trace-rerouted-model',
        modelActual: 'terminal-trace-upstream-model',
        status: 'failed',
        httpStatus: 502,
        latencyMs: 100 + index,
        totalTokens: 0,
        estimatedCost: 0,
        retryCount: 0,
        createdAt: recentCreatedAt,
      })),
      {
        routeEntrypointId: flowBody.flow.compiledRuntime!.match.entryNodeId,
        runtimeEndpointId: attempt!.endpointId,
        executionAttemptId: attempt!.executionAttemptId,
        executionTargetId,
        accountId: account.id,
        modelRequested: 'terminal-trace-rerouted-model',
        modelActual: 'terminal-trace-upstream-model',
        status: 'success',
        httpStatus: 200,
        latencyMs: 4736,
        firstByteLatencyMs: 736,
        firstTokenLatencyMs: 1736,
        completionTokens: 200,
        totalTokens: 100,
        estimatedCost: 0.001,
        retryCount: 4,
        createdAt: recentCreatedAt,
      },
    ]).run();
    await insertTerminalRequest({
      id: 'request:terminal-success',
      routeEntrypointId: flowBody.flow.compiledRuntime!.match.entryNodeId,
      requestedModel: 'terminal-trace-rerouted-model',
      status: 'success',
      httpStatus: 200,
      latencyMs: 4736,
      firstTokenLatencyMs: 1736,
      completionTokens: 200,
      totalTokens: 100,
      completedAt: recentCreatedAt,
    });

    const response = await app!.inject({
      method: 'GET',
      url: '/api/models/terminal-trace-rerouted-model/runtime-observability?range=5m',
      headers: app!.adminHeaders(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      observability: {
        health: {
          totalCalls: number;
          successCalls: number;
          failedCalls: number;
          successRate: number | null;
          avgLatencyMs: number | null;
          avgFirstTokenLatencyMs: number | null;
          avgOutputTokensPerSecond: number | null;
        };
        executionAttempts: Array<{ executionAttemptId: string; health: { totalCalls: number; successRate: number | null } }>;
        history: { buckets: Array<{ entry: { totalCalls: number; successRate: number | null; avgLatencyMs: number | null; avgFirstTokenLatencyMs: number | null; avgOutputTokensPerSecond: number | null } }> };
      };
    };

    expect(body.observability.health).toMatchObject({
      totalCalls: 1,
      successCalls: 1,
      failedCalls: 0,
      successRate: 100,
      avgLatencyMs: 4736,
      avgFirstTokenLatencyMs: 1736,
      avgOutputTokensPerSecond: 66.67,
    });
    expect(body.observability.history.buckets.at(-1)?.entry).toMatchObject({
      totalCalls: 1,
      successRate: 100,
      avgLatencyMs: 4736,
      avgFirstTokenLatencyMs: 1736,
      avgOutputTokensPerSecond: 66.67,
    });
    expect(body.observability.executionAttempts[0]).toMatchObject({
      executionAttemptId: attempt!.executionAttemptId,
      health: {
        totalCalls: 5,
        successRate: 20,
      },
    });
  });

  it('does not infer entry health from shared execution attempt samples', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'shared-attempt-site',
      url: 'https://shared-attempt.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'shared-attempt-user',
      apiToken: 'sk-shared-attempt',
      accessToken: 'access-shared-attempt',
      status: 'active',
      balance: 10,
    }).returning().get();
    const nakedRoute = await createRouteGroup({ model: 'shared-upstream-model' });
    await createRouteGroup({ model: 'shared-rerouted-model' });
    const candidate = await insertRouteGroupMember({
      groupId: nakedRoute.id,
      accountId: account.id,
      tokenId: null,
      sourceModel: 'shared-upstream-model',
      fallbackStageOrder: 0,
      weight: 10,
      enabled: true,
    });
    const executionTargetId = await getExecutionTargetIdForMember(candidate.id);
    if (!executionTargetId) throw new Error('Expected execution target for shared attempt candidate');
    await publishManagedRouteGroupsForTest();

    const flowResponse = await app!.inject({
      method: 'GET',
      url: '/api/models/shared-upstream-model/route-flow',
      headers: app!.adminHeaders(),
    });
    expect(flowResponse.statusCode).toBe(200);
    const flowBody = flowResponse.json() as RouteFlowResponse;
    const attempt = flowBody.flow.compiledRuntime?.executionAttempts[0];
    expect(attempt?.executionAttemptId).toBeTruthy();
    expect(attempt?.endpointId).toBeTruthy();

    await db.insert(schema.proxyLogs).values({
      routeEntrypointId: null,
      runtimeEndpointId: attempt!.endpointId,
      executionAttemptId: attempt!.executionAttemptId,
      executionTargetId,
      accountId: account.id,
      modelRequested: 'shared-rerouted-model',
      modelActual: 'shared-upstream-model',
      status: 'failed',
      httpStatus: 502,
      latencyMs: 120,
      totalTokens: 0,
      estimatedCost: 0,
      createdAt: formatUtcSqlDateTime(new Date()),
    }).run();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/models/shared-upstream-model/runtime-observability?range=7d',
      headers: app!.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      success: boolean;
      observability: {
        health: {
          status: string;
          source: string;
          totalCalls: number;
          successRate: number | null;
        };
        diagnostics: Array<{ code: string }>;
        alternatives: Array<{
          health: { source: string; totalCalls: number; successRate: number | null };
        }>;
        executionAttempts: Array<{
          executionAttemptId: string;
          health: { source: string; totalCalls: number; successRate: number | null };
        }>;
      };
    };
    expect(body.success).toBe(true);
    expect(body.observability.health).toMatchObject({
      status: 'unknown',
      source: 'none',
      totalCalls: 0,
      successRate: null,
    });
    expect(body.observability.diagnostics.map((item) => item.code)).toContain('entry_usage_missing');
    expect(body.observability.alternatives[0]?.health).toMatchObject({
      source: 'none',
      totalCalls: 0,
      successRate: null,
    });
    expect(body.observability.executionAttempts[0]).toMatchObject({
      executionAttemptId: attempt!.executionAttemptId,
      health: {
        source: 'execution_attempt_projection',
        totalCalls: 1,
        successRate: 0,
      },
    });
  });

  it('projects multiple execution attempts without exposing route-group candidate ids', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'multi-site',
      url: 'https://multi.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const accounts = await Promise.all(Array.from({ length: 4 }, async (_unused, index) => (
      await db.insert(schema.accounts).values({
        siteId: site.id,
        username: `multi-${index + 1}`,
        apiToken: `sk-multi-${index + 1}`,
        accessToken: `access-multi-${index + 1}`,
        status: 'active',
        balance: index === 0 ? 100 : 1,
        unitCost: index === 0 ? 0.01 : (index === 1 ? 0.5 : 0.2),
      }).returning().get()
    )));
    const route = await createRouteGroup({ model: 'multi-model' });
    const weights = [1, 3, 2, 4];
    await Promise.all(accounts.map((account, index) => insertRouteGroupMember({
      groupId: route.id,
      accountId: account.id,
      tokenId: null,
      sourceModel: 'multi-model',
      fallbackStageOrder: 0,
      weight: weights[index]!,
      enabled: true,
      successCount: index === 0 ? 10 : 1,
      failCount: index === 0 ? 0 : 1,
      totalLatencyMs: 100,
      totalCost: index === 0 ? 0.1 : 0,
    })));
    await publishManagedRouteGroupsForTest();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/models/multi-model/route-flow',
      headers: app!.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as RouteFlowResponse;
    const attempts = body.flow.compiledRuntime?.executionAttempts || [];
    expect(attempts).toHaveLength(4);
    expect(attempts.every((attempt) => attempt.executionAttemptId.length > 0)).toBe(true);
    expect(new Set(attempts.map((attempt) => attempt.executionAttemptId)).size).toBe(attempts.length);
    expect(attempts.map((attempt) => attempt.probability)).toEqual([0.1, 0.3, 0.2, 0.4]);
    expect(attempts[0]?.routingSignals).toMatchObject({
      referencePricing: {
        scenario: 'routing_reference',
        source: 'unavailable',
      },
      normalizedCostScore: 0.5,
      normalizedBalanceScore: 1,
      rawBalance: 100,
      normalizedBalance: 1,
    });
    expect(attempts[0]?.probability).toBeDefined();
    expect(body.flow.compiledRuntime?.alternatives[0]?.probability).toBeDefined();
    expect(body.flow.entryPricing?.theoretical?.executionAttempts[0]?.probability).toBeCloseTo(attempts[0]?.probability || 0, 5);
  });

  it('prices theoretical entry cost from compiled runtime execution attempts', async () => {
    const upstreamCost = await import('../../services/upstreamCostPricingService.js');
    const site = await db.insert(schema.sites).values({
      name: 'pricing-flow-site',
      url: 'https://pricing-flow.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const accounts = await Promise.all([
      db.insert(schema.accounts).values({
        siteId: site.id,
        username: 'pricing-flow-a',
        apiToken: 'sk-pricing-flow-a',
        accessToken: 'access-pricing-flow-a',
        status: 'active',
        balance: 100,
        unitCost: 2,
      }).returning().get(),
      db.insert(schema.accounts).values({
        siteId: site.id,
        username: 'pricing-flow-b',
        apiToken: 'sk-pricing-flow-b',
        accessToken: 'access-pricing-flow-b',
        status: 'active',
        balance: 100,
        unitCost: 6,
      }).returning().get(),
    ]);
    const route = await createRouteGroup({ model: 'priced-flow-model' });

    await upstreamCost.createUpstreamCostPricing({
      scope: 'account_model',
      siteId: site.id,
      accountId: accounts[0]!.id,
      modelName: 'priced-flow-model',
      plan: upstreamCost.createSimpleTokenPricingPlan({
        inputPerMillion: 2,
        outputPerMillion: 4,
      }),
    });
    await upstreamCost.createUpstreamCostPricing({
      scope: 'account_model',
      siteId: site.id,
      accountId: accounts[1]!.id,
      modelName: 'priced-flow-model',
      plan: upstreamCost.createSimpleTokenPricingPlan({
        inputPerMillion: 10,
        outputPerMillion: 20,
      }),
    });

    await Promise.all(accounts.map((account) => insertRouteGroupMember({
      groupId: route.id,
      accountId: account.id,
      tokenId: null,
      sourceModel: 'priced-flow-model',
      fallbackStageOrder: 0,
      weight: 10,
      enabled: true,
    })));
    await publishManagedRouteGroupsForTest();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/models/priced-flow-model/route-flow',
      headers: app!.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as RouteFlowResponse & {
      flow: {
        entryPricing?: {
          theoretical?: {
            inputPerMillion: number | null;
            outputPerMillion: number | null;
            totalCost: number | null;
            sourceCount: number;
            executionAttempts: Array<{
              executionAttemptId: string;
              accountId: number | null;
              inputPerMillion: number | null;
              outputPerMillion: number | null;
              totalCost: number | null;
              probability: number | null;
              matchedScope: string | null;
            }>;
          } | null;
        };
      };
    };
    const pricing = body.flow.entryPricing?.theoretical;
    expect(pricing?.sourceCount).toBe(2);
    expect(pricing?.executionAttempts).toHaveLength(2);
    expect(pricing?.executionAttempts.map((attempt) => attempt.matchedScope)).toEqual(['account_model', 'account_model']);
    expect(pricing?.executionAttempts.map((attempt) => attempt.inputPerMillion).sort((a, b) => (a || 0) - (b || 0))).toEqual([2, 10]);
    expect(pricing?.executionAttempts.map((attempt) => attempt.outputPerMillion).sort((a, b) => (a || 0) - (b || 0))).toEqual([4, 20]);

    const attempts = pricing?.executionAttempts || [];
    const expectedInput = attempts.reduce((sum, attempt) => sum + (attempt.inputPerMillion || 0) * (attempt.probability || 0), 0);
    const expectedOutput = attempts.reduce((sum, attempt) => sum + (attempt.outputPerMillion || 0) * (attempt.probability || 0), 0);
    const expectedTotal = attempts.reduce((sum, attempt) => sum + (attempt.totalCost || 0) * (attempt.probability || 0), 0);
    expect(pricing?.inputPerMillion).toBeCloseTo(expectedInput, 4);
    expect(pricing?.outputPerMillion).toBeCloseTo(expectedOutput, 4);
    expect(pricing?.totalCost).toBeCloseTo(expectedTotal, 4);
    expect(pricing?.inputPerMillion).not.toBe(1);
    expect(pricing?.outputPerMillion).not.toBe(1);
    expect(pricing?.totalCost).not.toBe(1);
  });

  it('prices advanced route-flow usage components from the unified endpoint quote', async () => {
    const upstreamCost = await import('../../services/upstreamCostPricingService.js');
    const site = await db.insert(schema.sites).values({
      name: 'advanced-pricing-flow-site',
      url: 'https://advanced-pricing-flow.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'advanced-pricing-flow',
      apiToken: 'sk-advanced-pricing-flow',
      accessToken: 'access-advanced-pricing-flow',
      status: 'active',
      balance: 100,
      unitCost: 1,
    }).returning().get();
    const route = await createRouteGroup({ model: 'advanced-priced-flow-model' });

    await upstreamCost.createUpstreamCostPricing({
      scope: 'account_model',
      siteId: site.id,
      accountId: account.id,
      modelName: 'advanced-priced-flow-model',
      plan: upstreamCost.createSimpleTokenPricingPlan({
        inputPerMillion: 2,
        outputPerMillion: 4,
        cacheReadPerMillion: 1,
        cacheWritePerMillion: 3,
        reasoningPerMillion: 5,
        requestCost: 0.1,
      }),
    });
    await insertRouteGroupMember({
      groupId: route.id,
      accountId: account.id,
      tokenId: null,
      sourceModel: 'advanced-priced-flow-model',
      fallbackStageOrder: 0,
      weight: 10,
      enabled: true,
    });
    await publishManagedRouteGroupsForTest();

    const pricingUsage = {
      inputTokens: 1_000_000,
      outputTokens: 2_000_000,
      cacheReadTokens: 500_000,
      cacheWriteTokens: 100_000,
      reasoningTokens: 250_000,
      requestCount: 1,
    };
    const response = await app!.inject({
      method: 'POST',
      url: '/api/models/advanced-priced-flow-model/route-flow',
      headers: app!.adminHeaders(),
      payload: { pricingUsage },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as RouteFlowResponse & {
      flow: {
        entryPricing?: {
          theoretical?: {
            inputPerMillion: number | null;
            outputPerMillion: number | null;
            cacheReadPerMillion: number | null;
            cacheWritePerMillion: number | null;
            reasoningPerMillion: number | null;
            requestCost: number | null;
            totalCost: number | null;
            usage: Record<string, number>;
            components: Array<{ kind: string; unitPrice: number | null; cost: number | null }>;
            executionAttempts: Array<{
              cacheReadPerMillion: number | null;
              cacheWritePerMillion: number | null;
              reasoningPerMillion: number | null;
              requestCost: number | null;
              components: Array<{ kind: string; unitPrice: number | null; cost: number | null }>;
            }>;
          } | null;
        };
      };
    };
    const pricing = body.flow.entryPricing?.theoretical;
    expect(pricing).toMatchObject({
      inputPerMillion: 2,
      outputPerMillion: 4,
      cacheReadPerMillion: 1,
      cacheWritePerMillion: 3,
      reasoningPerMillion: 5,
      requestCost: 0.1,
      totalCost: 12.15,
      usage: expect.objectContaining(pricingUsage),
    });
    expect(pricing?.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'cache_read_tokens', unitPrice: 1, cost: 0.5 }),
      expect.objectContaining({ kind: 'cache_write_tokens', unitPrice: 3, cost: 0.3 }),
      expect.objectContaining({ kind: 'reasoning_tokens', unitPrice: 5, cost: 1.25 }),
      expect.objectContaining({ kind: 'request', unitPrice: 0.1, cost: 0.1 }),
    ]));
    expect(pricing?.executionAttempts[0]).toMatchObject({
      cacheReadPerMillion: 1,
      cacheWritePerMillion: 3,
      reasoningPerMillion: 5,
      requestCost: 0.1,
    });
  });

  it('does not expose system default cost as theoretical compiled runtime pricing', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'default-cost-flow-site',
      url: 'https://default-cost-flow.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'default-cost-flow',
      apiToken: 'sk-default-cost-flow',
      accessToken: 'access-default-cost-flow',
      status: 'active',
      balance: 100,
    }).returning().get();
    const route = await createRouteGroup({ model: 'default-cost-flow-model' });
    await insertRouteGroupMember({
      groupId: route.id,
      accountId: account.id,
      tokenId: null,
      sourceModel: 'default-cost-flow-model',
      fallbackStageOrder: 0,
      weight: 10,
      enabled: true,
    });
    await publishManagedRouteGroupsForTest();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/models/default-cost-flow-model/route-flow',
      headers: app!.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as RouteFlowResponse & {
      flow: {
        entryPricing?: {
          theoretical?: {
            inputPerMillion: number | null;
            outputPerMillion: number | null;
            totalCost: number | null;
            sourceCount: number;
            executionAttempts: Array<{
              inputPerMillion: number | null;
              outputPerMillion: number | null;
              totalCost: number | null;
              matchedScope: string | null;
            }>;
          } | null;
        };
      };
    };

    expect(body.flow.entryPricing?.theoretical).toMatchObject({
      inputPerMillion: null,
      outputPerMillion: null,
      totalCost: null,
      sourceCount: 0,
    });
    expect(body.flow.entryPricing?.theoretical?.executionAttempts[0]).toMatchObject({
      inputPerMillion: null,
      outputPerMillion: null,
      totalCost: null,
      matchedScope: null,
    });
    expect(body.flow.compiledRuntime?.executionAttempts[0]?.routingSignals?.referencePricing.source).toBe('unavailable');
  });

  it('uses provider catalog pricing for compiled runtime theoretical entry pricing', async () => {
    fetchUpstreamPricingCatalogMock.mockResolvedValue({
      models: new Map([['catalog-flow-model', {
        modelName: 'catalog-flow-model',
        quotaType: 0,
        modelRatio: 1,
        completionRatio: 1,
        cacheRatio: 1,
        cacheCreationRatio: 1,
        modelPrice: { input: 5, output: 7 },
        enableGroups: ['premium-test'],
      }]]),
      groupRatio: { default: 1, 'premium-test': 2 },
    });
    const site = await db.insert(schema.sites).values({
      name: 'catalog-flow-site',
      url: 'https://catalog-flow.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'catalog-flow',
      apiToken: 'sk-catalog-flow',
      accessToken: 'access-catalog-flow',
      status: 'active',
      balance: 100,
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'catalog-flow-token',
      token: 'sk-catalog-flow-token',
      tokenGroup: 'premium-test',
      valueStatus: 'ready',
      enabled: true,
      isDefault: true,
    }).returning().get();
    const { refreshProviderPricingCatalog } = await import('../../services/providerPricingCatalogCacheService.js');
    await expect(refreshProviderPricingCatalog({
      siteId: site.id,
      accountId: account.id,
      reason: 'test-prime-cache',
    })).resolves.toMatchObject({ status: 'success' });
    fetchUpstreamPricingCatalogMock.mockClear();

    const route = await createRouteGroup({ model: 'catalog-flow-model' });
    await insertRouteGroupMember({
      groupId: route.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: 'catalog-flow-model',
      fallbackStageOrder: 0,
      weight: 10,
      enabled: true,
    });
    await publishManagedRouteGroupsForTest();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/models/catalog-flow-model/route-flow',
      headers: app!.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as RouteFlowResponse & {
      flow: {
        entryPricing?: {
          theoretical?: {
            inputPerMillion: number | null;
            outputPerMillion: number | null;
            totalCost: number | null;
            sourceCount: number;
            executionAttempts: Array<{
              inputPerMillion: number | null;
              outputPerMillion: number | null;
              totalCost: number | null;
              matchedScope: string | null;
            }>;
          } | null;
        };
      };
    };

    expect(body.flow.entryPricing?.theoretical).toMatchObject({
      inputPerMillion: 10,
      outputPerMillion: 14,
      totalCost: 24,
      sourceCount: 1,
    });
    expect(body.flow.entryPricing?.theoretical?.executionAttempts[0]).toMatchObject({
      inputPerMillion: 10,
      outputPerMillion: 14,
      totalCost: 24,
      matchedScope: 'provider_catalog',
    });
    expect(body.flow.compiledRuntime?.executionAttempts[0]?.routingSignals).toMatchObject({
      referencePricing: {
        scenario: 'routing_reference',
        source: 'wallet_acquisition',
        rawCost: 12,
        effectiveCost: 12,
      },
    });
    expect(fetchUpstreamPricingCatalogMock).not.toHaveBeenCalled();
  });

  it('returns an unmatched compiled runtime response without route-table fallback nodes', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/api/models/unknown-model/route-flow',
      headers: app!.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as RouteFlowResponse;
    expect(body.flow).toMatchObject({
      matched: false,
      compiledRuntime: null,
    });
    expect(body.flow.nodes).toBeUndefined();
    expect(body.flow.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'warn' }),
    ]));
  });

  it('returns lightweight diagnostics without the route-flow JSON payload', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/api/models/unknown-model/route-flow?view=diagnostics',
      headers: app!.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      success: boolean;
      flow?: unknown;
      diagnostics: {
        requestedModel: string;
        matched: boolean;
        diagnostics: Array<{ level: string; message: string }>;
        compiledRuntime?: unknown;
        entryPricing?: unknown;
      };
    };
    expect(body.success).toBe(true);
    expect(body.flow).toBeUndefined();
    expect(body.diagnostics).toMatchObject({
      requestedModel: 'unknown-model',
      matched: false,
    });
    expect(body.diagnostics.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'warn' }),
    ]));
    expect(body.diagnostics.compiledRuntime).toBeUndefined();
    expect(body.diagnostics.entryPricing).toBeUndefined();
  });

  it('accepts encoded model path ids and does not expose routing-candidates compatibility API', async () => {
    const encodedModel = encodeURIComponent('Qwen/Qwen3.5-122B-A10B');

    const flowResponse = await app!.inject({
      method: 'GET',
      url: `/api/models/${encodedModel}/route-flow`,
      headers: app!.adminHeaders(),
    });
    expect(flowResponse.statusCode).toBe(200);
    expect(flowResponse.json()).toMatchObject({
      success: true,
      flow: { requestedModel: 'Qwen/Qwen3.5-122B-A10B' },
    });

    const candidatesResponse = await app!.inject({
      method: 'GET',
      url: `/api/models/${encodedModel}/routing-candidates`,
      headers: app!.adminHeaders(),
    });
    expect(candidatesResponse.statusCode).toBe(404);
  });

  it('renders graph-native synthetic terminals as compiled runtime synthetic responses', async () => {
    const published = await publishRouteGraphSource!({
      createdBy: 'test',
      sourceGraph: {
        nodes: [
          {
            id: 'entry.synthetic',
            type: 'entry',
            enabled: true,
            visibility: 'public',
            ownership: 'manual',
            match: { requestedModelPattern: 'synthetic-flow-model' },
          },
          {
            id: 'synthetic.429',
            type: 'synthetic_endpoint',
            enabled: true,
            visibility: 'internal',
            ownership: 'manual',
            statusCode: 429,
            message: 'quota guard',
          },
        ],
        edges: [
          {
            id: 'entry-synthetic',
            sourceNodeId: 'entry.synthetic',
            sourcePortId: 'bidirect.out',
            targetNodeId: 'synthetic.429',
            targetPortId: 'bidirect.in',
            kind: 'bidirect_flow',
            ownership: 'manual',
          },
        ],
        macros: [],
      },
    });
    expect(published.ok).toBe(true);

    const response = await app!.inject({
      method: 'GET',
      url: '/api/models/synthetic-flow-model/route-flow',
      headers: app!.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as RouteFlowResponse;
    expect(body.flow.matched).toBe(true);
    expect(body.flow).not.toHaveProperty('entryId');
    expect(body.flow).not.toHaveProperty('selectedEndpointId');
    expect(body.flow.compiledRuntime?.match.entryNodeId).toBe('entry.synthetic');
    expect(body.flow.compiledRuntime?.selected.endpointId).toBeNull();
    expect(body.flow.compiledRuntime?.syntheticResponse).toEqual({
      statusCode: 429,
      message: 'quota guard',
    });
    expect(body.flow.compiledRuntime?.alternatives).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'synthetic_response',
        syntheticResponse: { statusCode: 429, message: 'quota guard' },
      }),
    ]));
    expect(body.flow.diagnostics).toEqual([
      { level: 'warn', message: 'quota guard' },
    ]);
  });
});
