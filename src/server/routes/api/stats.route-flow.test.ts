import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../../testing/dbHarness.js';
import { createTestApp, type TestAppHandle } from '../../../testing/appHarness.js';

type DbModule = typeof import('../../db/index.js');
type TokenRouterModule = typeof import('../../services/tokenRouter.js');
type RouteGraphServiceModule = typeof import('../../services/routeGraphService.js');

describe('/api/models/route-flow', () => {
  let app: TestAppHandle | null = null;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let invalidateTokenRouterCache: TokenRouterModule['invalidateTokenRouterCache'] | null = null;
  let publishRouteGraphSource: RouteGraphServiceModule['publishRouteGraphSource'] | null = null;
  let runtimeDb: IsolatedRuntimeDbHandle | null = null;

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-stats-route-flow-');
    const dbModule = runtimeDb.dbModule;
    const routesModule = await import('./stats.js');
    const tokenRouterModule = await import('../../services/tokenRouter.js');
    const routeGraphServiceModule = await import('../../services/routeGraphService.js');
    db = dbModule.db;
    schema = dbModule.schema;
    invalidateTokenRouterCache = tokenRouterModule.invalidateTokenRouterCache;
    publishRouteGraphSource = routeGraphServiceModule.publishRouteGraphSource;

    app = await createTestApp({
      routes: [routesModule.statsRoutes],
      auth: 'admin-api',
    });
  });

  beforeEach(async () => {
    await db.delete(schema.proxyLogs).run();
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.routeChannels).run();
    await db.delete(schema.tokenRoutes).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
    invalidateTokenRouterCache();
  });

  afterAll(async () => {
    await app?.close();
    invalidateTokenRouterCache?.();
    await runtimeDb?.cleanup();
  });

  it('compiles the selected route, channel pool, channel health and history into a route flow', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'flow-site',
      url: 'https://flow-site.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'flow-user',
      apiToken: 'sk-flow',
      accessToken: 'access-flow',
      status: 'active',
    }).returning().get();
    const route = await db.insert(schema.tokenRoutes).values({
      modelPattern: 'gpt-4o-mini',
      enabled: true,
      routingStrategy: 'weighted',
    }).returning().get();
    const channel = await db.insert(schema.routeChannels).values({
      routeId: route.id,
      accountId: account.id,
      tokenId: null,
      sourceModel: 'gpt-4o-mini',
      priority: 0,
      weight: 10,
      enabled: true,
      lastSelectedAt: '2026-06-01T00:00:00.000Z',
    }).returning().get();
    await db.insert(schema.proxyLogs).values([
      {
        routeId: route.id,
        channelId: channel.id,
        accountId: account.id,
        modelRequested: 'gpt-4o-mini',
        modelActual: 'gpt-4o-mini',
        status: 'success',
        httpStatus: 200,
        latencyMs: 120,
        createdAt: new Date().toISOString(),
      },
      {
        routeId: route.id,
        channelId: channel.id,
        accountId: account.id,
        modelRequested: 'gpt-4o-mini',
        modelActual: 'gpt-4o-mini',
        status: 'failed',
        httpStatus: 502,
        errorMessage: 'bad gateway',
        createdAt: new Date().toISOString(),
      },
    ]).run();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/models/route-flow?model=gpt-4o-mini',
      headers: app!.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      success: boolean;
      flow: {
        matched: boolean;
        selectedRouteId: number | null;
        selectedChannelId: number | null;
        nodes: Array<{ id: string; kind: string; status: string; metrics: Record<string, unknown>; history: unknown[] }>;
        edges: Array<{ source: string; target: string }>;
      };
    };
    expect(body.success).toBe(true);
    expect(body.flow.matched).toBe(true);
    expect(body.flow.selectedRouteId).toBe(route.id);
    expect(body.flow.selectedChannelId).toBe(channel.id);
    expect(body.flow.nodes.some((node) => node.id === `graph:entry:legacy:${route.id}` && node.kind === 'route')).toBe(true);
    expect(body.flow.edges.some((edge) => edge.source === 'request' && edge.target === `graph:entry:legacy:${route.id}`)).toBe(true);
    const channelNode = body.flow.nodes.find((node) => node.id === `channel:${channel.id}`);
    expect(channelNode).toMatchObject({
      kind: 'channel',
      status: 'selected',
    });
    expect(channelNode?.metrics.successRate).toBe(50);
    expect(channelNode?.history).toHaveLength(2);
    expect(body.flow.edges.some((edge) => edge.source === 'pool:channels' && edge.target === `channel:${channel.id}`)).toBe(true);
  });

  it('returns a terminal unmatched node for unknown models', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/api/models/route-flow?model=unknown-model',
      headers: app!.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      flow: {
        matched: boolean;
        nodes: Array<{ id: string; status: string }>;
        diagnostics: Array<{ level: string; message: string }>;
      };
    };
    expect(body.flow.matched).toBe(false);
    expect(body.flow.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'unmatched', status: 'blocked' }),
    ]));
    expect(body.flow.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'warn' }),
    ]));
  });

  it('renders graph-native synthetic terminals with diagnostics instead of channel candidates', async () => {
    const published = await publishRouteGraphSource!({
      createdBy: 'test',
      sourceGraph: {
        version: 1,
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
      url: '/api/models/route-flow?model=synthetic-flow-model',
      headers: app!.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      flow: {
        matched: boolean;
        selectedRouteId: number | null;
        selectedChannelId: number | null;
        summary: string[];
        nodes: Array<{ id: string; label: string; status: string; badges: string[] }>;
        edges: Array<{ source: string; target: string; label?: string | null }>;
        diagnostics: Array<{ level: string; message: string }>;
      };
    };
    expect(body.flow.matched).toBe(true);
    expect(body.flow.selectedRouteId).toBeNull();
    expect(body.flow.selectedChannelId).toBeNull();
    expect(body.flow.summary).toEqual(['route graph synthetic response 429']);
    expect(body.flow.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'graph:entry.synthetic', status: 'active' }),
      expect.objectContaining({
        id: 'graph:synthetic-response',
        label: '429',
        status: 'blocked',
        badges: expect.arrayContaining(['terminal', 'synthetic_endpoint']),
      }),
    ]));
    expect(body.flow.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'graph:synthetic.429', target: 'graph:synthetic-response', label: 'terminal' }),
    ]));
    expect(body.flow.diagnostics).toEqual([
      { level: 'warn', message: 'quota guard' },
    ]);
  });
});
