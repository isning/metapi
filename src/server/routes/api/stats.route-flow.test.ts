import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { compileRouteGraphSource } from '../../../shared/routeGraph.js';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../../testing/dbHarness.js';
import { createTestApp, type TestAppHandle } from '../../../testing/appHarness.js';

type DbModule = typeof import('../../db/index.js');
type RouteGraphServiceModule = typeof import('../../services/routeGraphService.js');

describe('/api/models/route-flow', () => {
  let app: TestAppHandle | null = null;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let publishRouteGraphSource: RouteGraphServiceModule['publishRouteGraphSource'] | null = null;
  let ensureActiveRouteGraphVersion: RouteGraphServiceModule['ensureActiveRouteGraphVersion'] | null = null;
  let runtimeDb: IsolatedRuntimeDbHandle | null = null;

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-stats-route-flow-');
    const dbModule = runtimeDb.dbModule;
    const routesModule = await import('./stats.js');
    const routeGraphServiceModule = await import('../../services/routeGraphService.js');
    db = dbModule.db;
    schema = dbModule.schema;
    publishRouteGraphSource = routeGraphServiceModule.publishRouteGraphSource;
    ensureActiveRouteGraphVersion = routeGraphServiceModule.ensureActiveRouteGraphVersion;

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
    await db.delete(schema.routeEndpointTargets).run();
    await db.delete(schema.tokenRoutes).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await app?.close();
    await runtimeDb?.cleanup();
  });

  async function persistCompactedActiveRouteEndpointIdentity(routeId: number): Promise<void> {
    const active = await ensureActiveRouteGraphVersion!();
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

  it('uses graph-native route program while preserving supply endpoint metrics', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'flow-site',
      url: 'https://flow-site.example.com',
      platform: 'new-api',
      status: 'active',
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
    }).returning().get();
    const route = await db.insert(schema.tokenRoutes).values({
      modelPattern: 'gpt-4o-mini',
      enabled: true,
      routingStrategy: 'weighted',
    }).returning().get();
    const channel = await db.insert(schema.routeEndpointTargets).values({
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
        targetId: channel.id,
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
        targetId: channel.id,
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
        nodes: Array<{
          id: string;
          kind: string;
          label: string;
          subtitle?: string | null;
          status: string;
          badges: string[];
          metrics: Record<string, unknown>;
          history: unknown[];
        }>;
        edges: Array<{ source: string; target: string; label?: string | null }>;
        compatibilityPolicy?: {
          resolved: {
            reasoningHistory: {
              transport: {
                mode: string;
                thinkTag: { openTag: string; closeTag: string };
              };
            };
          };
        };
      };
    };
    expect(body.success).toBe(true);
    expect(body.flow.matched).toBe(true);
    expect(body.flow.selectedRouteId).toBe(route.id);
    expect('selectedTargetId' in body.flow).toBe(false);
    expect(body.flow.nodes.some((node) => node.id === 'graph:macro:auto-model:gpt-4o-mini:entry' && node.kind === 'entry')).toBe(true);
    expect(body.flow.nodes.some((node) => node.id === 'graph:macro:auto-model:gpt-4o-mini:dispatcher' && node.kind === 'dispatcher')).toBe(true);
    expect(body.flow.nodes.some((node) => node.kind === 'pool' || node.kind === 'channel')).toBe(false);
    expect(body.flow.nodes.some((node) => node.id.startsWith('pool:') || node.id.startsWith('channel:'))).toBe(false);
    expect(body.flow.nodes.some((node) => node.kind === 'route_endpoint')).toBe(true);
    expect(body.flow.nodes.some((node) => node.id.startsWith('target:'))).toBe(false);
    expect(body.flow.edges.some((edge) => edge.source === 'request' && edge.target === 'graph:macro:auto-model:gpt-4o-mini:entry')).toBe(true);
    const supplyNode = body.flow.nodes.find((node) => (
      node.kind === 'route_endpoint'
      && node.badges?.includes?.('supply')
      && node.metrics.totalCalls === 2
    ));
    expect(supplyNode).toMatchObject({
      kind: 'route_endpoint',
      label: expect.stringContaining('flow-site'),
      metrics: expect.objectContaining({
        totalCalls: 2,
        recentSuccessCount: 1,
        recentFailureCount: 1,
        avgLatencyMs: 120,
      }),
      history: expect.arrayContaining([
        expect.objectContaining({ status: 'success' }),
        expect.objectContaining({ status: 'failed' }),
      ]),
    });
    expect(supplyNode?.label).toContain('flow-user');
    expect(supplyNode?.subtitle).toContain('endpoint ');
    expect(body.flow.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: supplyNode?.id,
        target: 'graph:macro:auto-model:gpt-4o-mini:dispatcher',
      }),
    ]));
    const targetNode = body.flow.nodes.find((node) => (
      node.kind === 'route_endpoint'
      && node.status === 'selected'
    ));
    expect(targetNode).toMatchObject({
      status: 'selected',
    });
    expect(body.flow.compatibilityPolicy?.resolved.reasoningHistory.transport).toMatchObject({
      mode: 'content_think_tag',
      thinkTag: {
        openTag: '<reason>',
        closeTag: '</reason>',
      },
    });
  });

  it('renders each upstream target behind a supply endpoint as its own candidate node', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'multi-upstream-site',
      url: 'https://multi-upstream.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const accounts = await Promise.all(Array.from({ length: 4 }, async (_unused, index) => (
      await db.insert(schema.accounts).values({
        siteId: site.id,
        username: `multi-upstream-${index + 1}`,
        apiToken: `sk-multi-${index + 1}`,
        accessToken: `access-multi-${index + 1}`,
        status: 'active',
      }).returning().get()
    )));
    const route = await db.insert(schema.tokenRoutes).values({
      modelPattern: 'multi-upstream-model',
      enabled: true,
      routingStrategy: 'weighted',
    }).returning().get();
    const channels = await Promise.all(accounts.map(async (account) => (
      await db.insert(schema.routeEndpointTargets).values({
        routeId: route.id,
        accountId: account.id,
        tokenId: null,
        sourceModel: 'multi-upstream-model',
        priority: 0,
        weight: 10,
        enabled: true,
      }).returning().get()
    )));

    const response = await app!.inject({
      method: 'GET',
      url: '/api/models/route-flow?model=multi-upstream-model',
      headers: app!.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      success: boolean;
      flow: {
        nodes: Array<{
          id: string;
          kind: string;
          badges: string[];
          metrics: Record<string, unknown>;
        }>;
        edges: Array<{ source: string; target: string; label?: string | null }>;
        entryPricing?: {
          theoretical?: {
            candidates?: Array<{ targetId: string; probability: number }>;
          } | null;
        };
      };
    };

    expect(body.success).toBe(true);
    expect(body.flow.entryPricing?.theoretical?.candidates).toHaveLength(4);
    const candidateTargetIds = body.flow.entryPricing?.theoretical?.candidates?.map((candidate) => candidate.targetId).sort() || [];
    for (const channel of channels) {
      expect(candidateTargetIds.some((targetId) => targetId.endsWith(`:${channel.id}`))).toBe(true);
    }
    expect(body.flow.entryPricing?.theoretical?.candidates?.map((candidate) => candidate.probability)).toEqual([0.25, 0.25, 0.25, 0.25]);
    const targetNodes = body.flow.nodes.filter((node) => (
      node.kind === 'route_endpoint'
      && node.badges?.includes?.('supply-target')
    ));
    expect(targetNodes).toHaveLength(4);
    expect(targetNodes.map((node) => node.metrics.probability)).toEqual([25, 25, 25, 25]);
    for (const node of targetNodes) {
      expect(body.flow.edges).toEqual(expect.arrayContaining([
        expect.objectContaining({
          source: node.id,
          label: '25%',
        }),
      ]));
    }
  });

  it('uses target weights for incomplete route-flow probabilities when router-deferred target selection is unavailable', async () => {
    const route = await db.insert(schema.tokenRoutes).values({
      modelPattern: 'runtime-prob-model',
      enabled: true,
      routingStrategy: 'weighted',
    }).returning().get();
    const cheapSite = await db.insert(schema.sites).values({
      name: 'runtime-cheap-site',
      url: 'https://runtime-cheap.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const expensiveSite = await db.insert(schema.sites).values({
      name: 'runtime-expensive-site',
      url: 'https://runtime-expensive.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const cheapAccount = await db.insert(schema.accounts).values({
      siteId: cheapSite.id,
      username: 'runtime-cheap-user',
      apiToken: 'sk-runtime-cheap',
      accessToken: 'access-runtime-cheap',
      status: 'active',
    }).returning().get();
    const expensiveAccount = await db.insert(schema.accounts).values({
      siteId: expensiveSite.id,
      username: 'runtime-expensive-user',
      apiToken: 'sk-runtime-expensive',
      accessToken: 'access-runtime-expensive',
      status: 'active',
    }).returning().get();
    const cheapChannel = await db.insert(schema.routeEndpointTargets).values({
      routeId: route.id,
      accountId: cheapAccount.id,
      tokenId: null,
      sourceModel: 'runtime-prob-model',
      priority: 0,
      weight: 10,
      enabled: true,
      successCount: 10,
      failCount: 0,
      totalCost: 0.01,
    }).returning().get();
    const expensiveChannel = await db.insert(schema.routeEndpointTargets).values({
      routeId: route.id,
      accountId: expensiveAccount.id,
      tokenId: null,
      sourceModel: 'runtime-prob-model',
      priority: 0,
      weight: 10,
      enabled: true,
      successCount: 10,
      failCount: 0,
      totalCost: 0.1,
    }).returning().get();

    const response = await app!.inject({
      method: 'GET',
      url: '/api/models/route-flow?model=runtime-prob-model',
      headers: app!.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      success: boolean;
      flow: {
        nodes: Array<{
          id: string;
          kind: string;
          label: string;
          subtitle?: string | null;
          metrics: Record<string, unknown>;
        }>;
        edges: Array<{ source: string; target: string; label?: string | null }>;
        entryPricing?: {
          theoretical?: {
            candidates?: Array<{ targetId: string; probability: number | null }>;
          } | null;
        };
      };
    };

    expect(body.success).toBe(true);
    const pricingCandidates = body.flow.entryPricing?.theoretical?.candidates || [];
    expect(pricingCandidates).toHaveLength(2);
    expect(pricingCandidates.map((candidate) => candidate.probability)).toEqual([0.5, 0.5]);

    const cheapNode = body.flow.nodes.find((node) => node.kind === 'route_endpoint' && node.label.includes('runtime-cheap-user'));
    const expensiveNode = body.flow.nodes.find((node) => node.kind === 'route_endpoint' && node.label.includes('runtime-expensive-user'));
    expect(cheapNode?.metrics.probability).toBe(50);
    expect(expensiveNode?.metrics.probability).toBe(50);

    const cheapEdge = body.flow.edges.find((edge) => edge.source === cheapNode?.id);
    const expensiveEdge = body.flow.edges.find((edge) => edge.source === expensiveNode?.id);
    expect(cheapEdge?.label).toBe('50%');
    expect(expensiveEdge?.label).toBe('50%');
  });

  it('repairs compacted persisted route endpoint identities before rendering route-flow metrics', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'compacted-flow-site',
      url: 'https://compacted-flow.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'compacted-flow-user',
      apiToken: 'sk-compacted-flow',
      accessToken: 'access-compacted-flow',
      status: 'active',
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'compacted-flow-token',
      token: 'sk-compacted-flow-token',
      valueStatus: 'ready',
      enabled: true,
      isDefault: true,
    }).returning().get();
    const route = await db.insert(schema.tokenRoutes).values({
      modelPattern: 'compacted-flow-model',
      enabled: true,
      routingStrategy: 'weighted',
    }).returning().get();
    const target = await db.insert(schema.routeEndpointTargets).values({
      routeId: route.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: 'compacted-flow-model',
      priority: 0,
      weight: 10,
      enabled: true,
    }).returning().get();
    await db.insert(schema.proxyLogs).values([
      {
        routeId: route.id,
        targetId: target.id,
        accountId: account.id,
        modelRequested: 'compacted-flow-model',
        modelActual: 'compacted-flow-model',
        status: 'success',
        httpStatus: 200,
        latencyMs: 160,
        createdAt: new Date().toISOString(),
      },
      {
        routeId: route.id,
        targetId: target.id,
        accountId: account.id,
        modelRequested: 'compacted-flow-model',
        modelActual: 'compacted-flow-model',
        status: 'failed',
        httpStatus: 502,
        errorMessage: 'bad gateway',
        createdAt: new Date().toISOString(),
      },
    ]).run();
    await persistCompactedActiveRouteEndpointIdentity(route.id);

    const response = await app!.inject({
      method: 'GET',
      url: '/api/models/route-flow?model=compacted-flow-model',
      headers: app!.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      success: boolean;
      flow: {
        nodes: Array<{
          kind: string;
          label: string;
          metrics: Record<string, unknown>;
        }>;
      };
    };
    const supplyNode = body.flow.nodes.find((node) => (
      node.kind === 'route_endpoint'
      && node.label.includes('compacted-flow-user')
    ));

    expect(body.success).toBe(true);
    expect(supplyNode?.metrics).toMatchObject({
      probability: 100,
      successRate: 50,
      avgLatencyMs: 160,
      totalCalls: 2,
    });
  });

  it('renders published graph filters from the compiled runtime route path', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'filtered-flow-site',
      url: 'https://filtered-flow.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'filtered-flow-user',
      apiToken: 'sk-filtered-flow',
      accessToken: 'access-filtered-flow',
      status: 'active',
    }).returning().get();
    const route = await db.insert(schema.tokenRoutes).values({
      modelPattern: 'deepseek-v4-pro',
      enabled: true,
      routingStrategy: 'weighted',
    }).returning().get();
    const target = await db.insert(schema.routeEndpointTargets).values({
      routeId: route.id,
      accountId: account.id,
      tokenId: null,
      sourceModel: 'deepseek-v4-pro',
      priority: 0,
      weight: 10,
      enabled: true,
    }).returning().get();

    const published = await publishRouteGraphSource!({
      createdBy: 'test',
      sourceGraph: {
        version: 1,
        nodes: [
          {
            id: 'entry.filtered-flow',
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
            id: 'filter.filtered-flow',
            type: 'filter',
            enabled: true,
            visibility: 'internal',
            ownership: 'manual',
            operations: [
              { type: 'rewrite_model', source: 'current_model', operation: 'strip_suffix', suffix: '-max' },
              { type: 'set_payload', path: 'reasoning_effort', mode: 'override', value: 'high' },
              { type: 'set_header', name: 'X-Route-Graph', mode: 'override', value: 'filtered' },
              { type: 'set_endpoint_preference', endpoint: 'responses' },
            ],
          },
          {
            id: 'endpoint.filtered-flow',
            type: 'route_endpoint',
            enabled: true,
            visibility: 'internal',
            ownership: 'manual',
            legacyRouteId: route.id,
            config: {
              targets: [{
                targetId: String(target.id),
                model: 'deepseek-v4-pro',
                accountId: account.id,
                siteId: site.id,
              }],
              targetSelection: { strategy: 'weighted' },
            },
          },
        ],
        edges: [
          {
            id: 'entry-filter-filtered-flow',
            sourceNodeId: 'entry.filtered-flow',
            sourcePortId: 'bidirect.out',
            targetNodeId: 'filter.filtered-flow',
            targetPortId: 'bidirect.in',
            kind: 'bidirect_flow',
            ownership: 'manual',
          },
          {
            id: 'filter-endpoint-filtered-flow',
            sourceNodeId: 'filter.filtered-flow',
            sourcePortId: 'bidirect.out',
            targetNodeId: 'endpoint.filtered-flow',
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
      url: '/api/models/route-flow?model=deepseek-v4-pro-max',
      headers: app!.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      success: boolean;
      flow: {
        matched: boolean;
        actualModel: string;
        selectedRouteId: number | null;
        nodes: Array<{ id: string; kind: string; badges: string[]; status: string }>;
        edges: Array<{ source: string; target: string; label?: string | null }>;
        summary: string[];
      };
    };

    expect(body.success).toBe(true);
    expect(body.flow).toMatchObject({
      matched: true,
      actualModel: 'deepseek-v4-pro',
      selectedRouteId: route.id,
    });
    expect(body.flow.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'graph:entry.filtered-flow',
        kind: 'entry',
        status: 'active',
      }),
      expect.objectContaining({
        id: 'graph:filter.filtered-flow',
        kind: 'filter',
        badges: expect.arrayContaining(['graph', 'filter', 'rewrite_model:currentModel=strip_suffix']),
      }),
      expect.objectContaining({
        id: 'graph:endpoint.filtered-flow',
        kind: 'route_endpoint',
        status: 'selected',
      }),
    ]));
    expect(body.flow.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'graph:entry.filtered-flow',
        target: 'graph:filter.filtered-flow',
      }),
      expect.objectContaining({
        source: 'graph:filter.filtered-flow',
        target: 'graph:endpoint.filtered-flow',
      }),
    ]));
    expect(body.flow.summary).toEqual(expect.arrayContaining([
      'compiled graph selected route_endpoint',
    ]));
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
      expect.objectContaining({ id: 'graph:unmatched', status: 'blocked' }),
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
        summary: string[];
        nodes: Array<{ id: string; label: string; status: string; badges: string[] }>;
        edges: Array<{ source: string; target: string; label?: string | null }>;
        diagnostics: Array<{ level: string; message: string }>;
      };
    };
    expect(body.flow.matched).toBe(true);
    expect(body.flow.selectedRouteId).toBeNull();
    expect('selectedTargetId' in body.flow).toBe(false);
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
