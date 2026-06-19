import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
    const channel = await db.insert(schema.routeChannels).values({
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
      expect.objectContaining({ id: `entry:legacy:${seeded.route.id}`, type: 'entry' }),
      expect.objectContaining({ id: `dispatcher:legacy:${seeded.route.id}`, type: 'dispatcher' }),
      expect.objectContaining({ id: `pool:legacy:${seeded.route.id}`, type: 'model_endpoint' }),
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
          type: 'model_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: seeded.route.id,
          config: {
            targets: [{ channelId: String(seeded.channel.id), model: 'manual-api-model' }],
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

  it('rebases a stale draft with newly generated model-group macros', async () => {
    const source = await seedRoutableRoute('source-model');

    const initialDraft = await app.inject({
      method: 'GET',
      url: '/api/route-graph/draft',
      headers: app.adminHeaders(),
    });
    expect(initialDraft.statusCode).toBe(200);

    const createGroup = await app.inject({
      method: 'POST',
      url: '/api/routes',
      headers: app.adminHeaders(),
      payload: {
        match: { kind: 'model', requestedModelPattern: '', displayName: 'public-group' },
        backend: { kind: 'routes', routeIds: [source.route.id] },
        presentation: { displayName: 'public-group', displayIcon: 'Layers' },
        routingStrategy: 'round_robin',
        enabled: true,
      },
    });
    expect(createGroup.statusCode).toBe(200);
    const groupRouteId = createGroup.json().id as number;

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
                    input: { kind: 'route_ids', routeIds: [source.route.id] },
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
                  kind: 'route_ids',
                  routeIds: [source.route.id],
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
      terminalKind: 'model_endpoint',
      currentModel: 'macro-source-model',
    });
    expect(runtimeSelection?.selectedEndpointTarget).toBeNull();
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

    const primitiveNodes = publish.json().version.sourceGraph.nodes;
    expect(primitiveNodes.some((node: { id?: string }) => String(node.id || '').includes('gpt-api-model'))).toBe(false);

    const runtimeSelection = await evaluateActiveRouteGraphForModel('claude-pattern-group');
    expect(runtimeSelection).toMatchObject({
      selectedRouteId: opus.route.id,
      terminalKind: 'model_endpoint',
      currentModel: 'claude-opus-api-model',
    });
    expect(runtimeSelection?.selectedEndpointTarget).toBeNull();
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

    const graphWithEmbeddedMacro = {
      version: 1,
      nodes: activeBody.sourceGraph.nodes,
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
                { id: 'flow.in', label: 'incoming flow', direction: 'input', kind: 'bidirect', accepts: ['bidirect'] },
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
          sourceNodeId: `entry:legacy:${source.route.id}`,
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
          targetNodeId: `pool:legacy:${source.route.id}`,
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
      terminalKind: 'model_endpoint',
      currentModel: 'embedded-source-model',
    });
  });
});
