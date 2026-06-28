import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestApp, type TestAppHandle } from '../../../testing/appHarness.js';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../../testing/dbHarness.js';
import { tokenRouteFixture } from '../../test/routeGraphFixtures.js';

type DbModule = typeof import('../../db/index.js');
type TokenRouterModule = typeof import('../../services/tokenRouter.js');
type RouteGraphRuntimeModule = typeof import('../../services/routeGraphRuntimeService.js');

describe('/api/route-graph lifecycle', () => {
  let app: TestAppHandle;
  let runtimeDb: IsolatedRuntimeDbHandle;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let invalidateTokenRouterCache: TokenRouterModule['invalidateTokenRouterCache'];
  let evaluateActiveRouteGraphForModel: RouteGraphRuntimeModule['evaluateActiveRouteGraphForModel'];
  let applyRouteGraphPostBuildFilters: RouteGraphRuntimeModule['applyRouteGraphPostBuildFilters'];

  async function seedRoutableRoute(model = 'graph-api-model') {
    const site = await db.insert(schema.sites).values({
      name: `${model}-site`,
      url: `https://${model}.example.com`,
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

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-route-graph-api-');
    const dbModule = runtimeDb.dbModule;
    const routesModule = await import('./tokens.js');
    const tokenRouterModule = await import('../../services/tokenRouter.js');
    const routeGraphRuntimeModule = await import('../../services/routeGraphRuntimeService.js');
    db = dbModule.db;
    schema = dbModule.schema;
    invalidateTokenRouterCache = tokenRouterModule.invalidateTokenRouterCache;
    evaluateActiveRouteGraphForModel = routeGraphRuntimeModule.evaluateActiveRouteGraphForModel;
    applyRouteGraphPostBuildFilters = routeGraphRuntimeModule.applyRouteGraphPostBuildFilters;
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
    await db.delete(schema.routeGroupSources).run();
    await db.delete(schema.routeEndpointTargets).run();
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

  it('validates, saves, and publishes graph-native drafts without replacing active on invalid publish', async () => {
    const seeded = await seedRoutableRoute();

    const activeResponse = await app.inject({
      method: 'GET',
      url: '/api/route-graph/active',
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
      url: '/api/route-graph/active',
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
      url: '/api/route-graph/active',
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
      url: '/api/route-endpoints',
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
      url: '/api/route-endpoints',
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
      url: '/api/route-graph/active',
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

  it('publishes candidate_selector macros whose priority groups are sourced by model patterns', async () => {
    const opus = await seedRoutableRoute('claude-opus-api-model');
    await seedRoutableRoute('claude-sonnet-api-model');
    await seedRoutableRoute('gpt-api-model');

    const activeResponse = await app.inject({
      method: 'GET',
      url: '/api/route-graph/active',
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
      url: '/api/route-graph/active',
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
      url: '/api/route-graph/active',
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
