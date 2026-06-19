import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileRouteGraphSource } from '../../shared/routeGraph.js';

type DbModule = typeof import('../db/index.js');
type RouteGraphServiceModule = typeof import('./routeGraphService.js');

describe('routeGraphService ownership guards', () => {
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let publishRouteGraphSource: RouteGraphServiceModule['publishRouteGraphSource'];
  let saveRouteGraphDraft: RouteGraphServiceModule['saveRouteGraphDraft'];
  let publishRouteGraphDraft: RouteGraphServiceModule['publishRouteGraphDraft'];
  let rebaseRouteGraphDraft: RouteGraphServiceModule['rebaseRouteGraphDraft'];
  let ensureActiveRouteGraphVersion: RouteGraphServiceModule['ensureActiveRouteGraphVersion'];
  let getRouteGraphDraft: RouteGraphServiceModule['getRouteGraphDraft'];
  let buildRouteGraphSourceFromCurrentProjectionTable: RouteGraphServiceModule['buildRouteGraphSourceFromCurrentProjectionTable'];
  let loadActiveRouteGraphRouteBindings: RouteGraphServiceModule['loadActiveRouteGraphRouteBindings'];
  let dataDir = '';

  async function seedAccountToken(prefix: string): Promise<{ accountId: number; tokenId: number }> {
    const siteInsert = await db.insert(schema.sites).values({
      name: `${prefix}-site`,
      url: `https://${prefix}.example`,
      platform: 'openai',
      status: 'active',
    });
    const siteId = Number(siteInsert.lastInsertRowid || siteInsert.insertId);
    const accountInsert = await db.insert(schema.accounts).values({
      siteId,
      username: `${prefix}-account`,
      accessToken: `${prefix}-access`,
      status: 'active',
    });
    const accountId = Number(accountInsert.lastInsertRowid || accountInsert.insertId);
    const tokenInsert = await db.insert(schema.accountTokens).values({
      accountId,
      name: `${prefix}-token`,
      token: `sk-${prefix}`,
      enabled: true,
      isDefault: true,
    });
    const tokenId = Number(tokenInsert.lastInsertRowid || tokenInsert.insertId);
    return { accountId, tokenId };
  }

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-route-graph-service-'));
    process.env.DATA_DIR = dataDir;

    await import('../db/migrate.js');
    const dbModule = await import('../db/index.js');
    const serviceModule = await import('./routeGraphService.js');
    db = dbModule.db;
    schema = dbModule.schema;
    publishRouteGraphSource = serviceModule.publishRouteGraphSource;
    saveRouteGraphDraft = serviceModule.saveRouteGraphDraft;
    publishRouteGraphDraft = serviceModule.publishRouteGraphDraft;
    rebaseRouteGraphDraft = serviceModule.rebaseRouteGraphDraft;
    ensureActiveRouteGraphVersion = serviceModule.ensureActiveRouteGraphVersion;
    getRouteGraphDraft = serviceModule.getRouteGraphDraft;
    buildRouteGraphSourceFromCurrentProjectionTable = serviceModule.buildRouteGraphSourceFromCurrentProjectionTable;
    loadActiveRouteGraphRouteBindings = serviceModule.loadActiveRouteGraphRouteBindings;
  });

  beforeEach(async () => {
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.routeGroupSources).run();
    await db.delete(schema.routeChannels).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
    await db.delete(schema.tokenRoutes).run();
  });

  afterAll(() => {
    delete process.env.DATA_DIR;
  });

  it('rejects draft edits that mutate or delete non-manual graph-owned nodes and edges', async () => {
    const sourceGraph = {
      version: 1,
      nodes: [
        {
          id: 'entry.public',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'gpt-owned', displayName: null },
        },
        {
          id: 'filter.auto',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'auto_generated',
          operations: [{ type: 'set_payload', path: 'reasoning_effort', value: 'medium' }],
        },
        {
          id: 'pool.auto',
          type: 'model_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'auto_generated',
          legacyRouteId: 1,
          routeNodeId: 'entry.public',
          metadata: {},
          config: { targets: [{ channelId: '1', model: 'gpt-owned', accountId: 1, tokenId: 1 }], targetSelection: { strategy: 'weighted' } },
        },
      ],
      edges: [
        {
          id: 'edge.entry.filter',
          sourceNodeId: 'entry.public',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'filter.auto',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
        {
          id: 'edge.filter.pool',
          sourceNodeId: 'filter.auto',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'pool.auto',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'auto_generated',
        },
      ],
    } as const;

    const published = await publishRouteGraphSource({ sourceGraph, createdBy: 'test' });
    expect(published.ok).toBe(true);

    const draft = await saveRouteGraphDraft({
      ...sourceGraph,
      nodes: [
        sourceGraph.nodes[0],
        {
          ...sourceGraph.nodes[1],
          operations: [{ type: 'set_payload', path: 'reasoning_effort', value: 'high' }],
        },
      ],
      edges: [sourceGraph.edges[0]],
    });

    expect(draft.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      'ownership.non_manual_mutation',
      'ownership.non_manual_delete',
      'ownership.non_manual_edge_delete',
    ]));

    const publishDraft = await publishRouteGraphDraft();
    expect(publishDraft.ok).toBe(false);
    expect(publishDraft.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      'ownership.non_manual_mutation',
      'ownership.non_manual_delete',
      'ownership.non_manual_edge_delete',
    ]));
  });

  it('rejects draft-created non-manual nodes, edges, and macros so derived primitives stay read-only', async () => {
    const activeSource = {
      version: 1,
      nodes: [
        {
          id: 'entry.manual',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'manual-owned-model', displayName: null },
        },
        {
          id: 'endpoint.manual',
          type: 'model_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 1,
          routeNodeId: 'entry.manual',
          config: {
            targets: [{ channelId: 'manual', model: 'manual-owned-model' }],
            targetSelection: { strategy: 'weighted' },
          },
        },
      ],
      edges: [
        {
          id: 'entry-endpoint',
          sourceNodeId: 'entry.manual',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'endpoint.manual',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
      ],
      macros: [],
    } as const;
    const active = await publishRouteGraphSource({ sourceGraph: activeSource, createdBy: 'test' });
    expect(active.ok).toBe(true);

    const draft = await saveRouteGraphDraft({
      version: 1,
      nodes: [
        ...activeSource.nodes,
        {
          id: 'endpoint.derived',
          type: 'model_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'derived',
          legacyRouteId: 2,
          config: {
            targets: [{ channelId: 'derived', model: 'manual-owned-model' }],
            targetSelection: { strategy: 'weighted' },
          },
        },
      ],
      edges: [
        ...activeSource.edges,
        {
          id: 'derived-edge',
          sourceNodeId: 'entry.manual',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'endpoint.derived',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'derived',
        },
      ],
      macros: [
        {
          id: 'macro.auto-created',
          kind: 'candidate_selector',
          enabled: true,
          visibility: 'internal',
          ownership: 'auto_generated',
          config: {
            surface: {
              entry: { kind: 'embedded', input: 'bidirect' },
              output: 'route',
            },
            policy: { strategy: 'priority_order' },
            groups: [],
          },
        },
      ],
    });

    expect(draft.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      'ownership.non_manual_create',
      'ownership.non_manual_edge_create',
      'ownership.non_manual_macro_create',
    ]));

    const publishDraft = await publishRouteGraphDraft();
    expect(publishDraft.ok).toBe(false);
    expect(publishDraft.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      'ownership.non_manual_create',
      'ownership.non_manual_edge_create',
      'ownership.non_manual_macro_create',
    ]));
  });

  it('saves drafts against the active graph and rejects invalid publishes without replacing active version', async () => {
    const activeSource = {
      version: 1,
      nodes: [
        {
          id: 'entry.public',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { kind: 'model', requestedModelPattern: 'gpt-active', displayName: 'gpt-active' },
        },
        {
          id: 'dispatcher.public',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'weighted' },
        },
        {
          id: 'endpoint.public',
          type: 'model_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          config: {
            targets: [{ channelId: 'channel-active', model: 'gpt-active' }],
            targetSelection: { strategy: 'weighted' },
          },
        },
      ],
      edges: [
        {
          id: 'entry-dispatcher',
          sourceNodeId: 'entry.public',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'dispatcher.public',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
        {
          id: 'endpoint-dispatcher',
          sourceNodeId: 'endpoint.public',
          sourcePortId: 'route.out',
          targetNodeId: 'dispatcher.public',
          targetPortId: 'route.in',
          kind: 'route_flow',
          ownership: 'manual',
        },
      ],
    } as const;

    const active = await publishRouteGraphSource({ sourceGraph: activeSource, createdBy: 'test' });
    expect(active.ok).toBe(true);
    if (!active.ok) return;

    const invalidDraft = await saveRouteGraphDraft({
      ...activeSource,
      edges: [
        activeSource.edges[0],
        {
          id: 'bad-route-edge',
          sourceNodeId: 'entry.public',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'dispatcher.public',
          targetPortId: 'route.in',
          kind: 'request_flow',
          ownership: 'manual',
        },
      ],
    });

    expect(invalidDraft.baseVersion).toBe(active.version.id);
    expect(invalidDraft.stale).toBe(false);
    expect(invalidDraft.diagnostics.map((diagnostic) => diagnostic.code)).toContain('edge.incompatible_ports');

    const publishDraft = await publishRouteGraphDraft();
    expect(publishDraft.ok).toBe(false);
    expect(publishDraft.diagnostics.map((diagnostic) => diagnostic.code)).toContain('edge.incompatible_ports');

    const stillActive = await ensureActiveRouteGraphVersion();
    expect(stillActive.id).toBe(active.version.id);
    expect(stillActive.sourceGraph.nodes.map((node) => node.id)).toEqual(active.version.sourceGraph.nodes.map((node) => node.id));
  });

  it('projects legacy route channels into model endpoint targets', async () => {
    const routeInsert = await db.insert(schema.tokenRoutes).values({
      displayName: 'gpt-4o',
      routingStrategy: 'weighted',
      enabled: true,
    });
    const routeId = Number(routeInsert.lastInsertRowid || routeInsert.insertId);
    const siteInsert = await db.insert(schema.sites).values({
      name: 'openai',
      url: 'https://api.openai.example',
      platform: 'openai',
      status: 'active',
    });
    const siteId = Number(siteInsert.lastInsertRowid || siteInsert.insertId);
    const accountInsert = await db.insert(schema.accounts).values({
      siteId,
      username: 'account-a',
      accessToken: 'access-token',
      status: 'active',
    });
    const accountId = Number(accountInsert.lastInsertRowid || accountInsert.insertId);
    const tokenInsert = await db.insert(schema.accountTokens).values({
      accountId,
      name: 'token-a',
      token: 'api-token',
      enabled: true,
    });
    const tokenId = Number(tokenInsert.lastInsertRowid || tokenInsert.insertId);
    await db.insert(schema.routeChannels).values({
      routeId,
      accountId,
      tokenId,
      sourceModel: 'gpt-4o-upstream',
      priority: 3,
      weight: 7,
      enabled: true,
    });

    const graph = await buildRouteGraphSourceFromCurrentProjectionTable();
    const endpoint = graph.nodes.find((node) => node.id === `pool:legacy:${routeId}`);

    expect(endpoint).toMatchObject({
      type: 'model_endpoint',
      ownership: 'auto_generated',
      config: {
        targets: [
          expect.objectContaining({
            model: 'gpt-4o-upstream',
            accountId,
            tokenId,
            weight: 7,
            priority: 3,
          }),
        ],
      },
    });
  });

  it('bootstraps an active graph from current route projection when no graph version exists', async () => {
    const routeInsert = await db.insert(schema.tokenRoutes).values({
      displayName: 'recovered-model',
      routingStrategy: 'weighted',
      enabled: true,
    });
    const routeId = Number(routeInsert.lastInsertRowid || routeInsert.insertId);
    const siteInsert = await db.insert(schema.sites).values({
      name: 'recover-site',
      url: 'https://recover.example',
      platform: 'openai',
      status: 'active',
    });
    const siteId = Number(siteInsert.lastInsertRowid || siteInsert.insertId);
    const accountInsert = await db.insert(schema.accounts).values({
      siteId,
      username: 'recover-account',
      accessToken: 'recover-access',
      status: 'active',
    });
    const accountId = Number(accountInsert.lastInsertRowid || accountInsert.insertId);
    const tokenInsert = await db.insert(schema.accountTokens).values({
      accountId,
      name: 'recover-token',
      token: 'sk-recover',
      enabled: true,
      isDefault: true,
    });
    const tokenId = Number(tokenInsert.lastInsertRowid || tokenInsert.insertId);
    await db.insert(schema.routeChannels).values({
      routeId,
      accountId,
      tokenId,
      sourceModel: 'recovered-model',
      priority: 0,
      weight: 10,
      enabled: true,
    });

    const active = await ensureActiveRouteGraphVersion();

    expect(active.status).toBe('active');
    expect(active.sourceGraph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `entry:legacy:${routeId}`, type: 'entry', ownership: 'auto_generated' }),
      expect.objectContaining({ id: `pool:legacy:${routeId}`, type: 'model_endpoint', ownership: 'auto_generated' }),
    ]));
    expect(active.compiledGraph.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: `entry:legacy:${routeId}`,
        backend: expect.objectContaining({ kind: 'routes', routeIds: [routeId] }),
      }),
    ]));
    expect(active.compiledGraph.terminals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: `pool:legacy:${routeId}`,
        type: 'model_endpoint',
        legacyRouteId: routeId,
      }),
    ]));

    const draft = await getRouteGraphDraft();
    expect(draft.stale).toBe(false);
    expect(draft.workingGraph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `entry:legacy:${routeId}` }),
      expect.objectContaining({ id: `pool:legacy:${routeId}` }),
    ]));
    expect(compileRouteGraphSource(draft.workingGraph).ok).toBe(true);
  });

  it('projects model groups as candidate_selector macros and reads bindings from lowered primitives', async () => {
    const sourceInsert = await db.insert(schema.tokenRoutes).values({
      displayName: 'source-model',
      routingStrategy: 'weighted',
      enabled: true,
    });
    const sourceRouteId = Number(sourceInsert.lastInsertRowid || sourceInsert.insertId);
    const { accountId, tokenId } = await seedAccountToken('group-source');
    const groupInsert = await db.insert(schema.tokenRoutes).values({
      displayName: 'public-group',
      routingStrategy: 'round_robin',
      enabled: true,
    });
    const groupRouteId = Number(groupInsert.lastInsertRowid || groupInsert.insertId);
    await db.insert(schema.routeGroupSources).values({
      groupRouteId,
      sourceRouteId,
    });
    await db.insert(schema.routeChannels).values({
      routeId: sourceRouteId,
      accountId,
      tokenId,
      sourceModel: 'source-model',
      priority: 0,
      weight: 10,
      enabled: true,
    });

    const graph = await buildRouteGraphSourceFromCurrentProjectionTable();
    expect(graph.macros).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `route:${groupRouteId}:model-group`,
        kind: 'candidate_selector',
        ownership: 'auto_generated',
      }),
    ]));
    expect(graph.nodes.some((node) => node.id === `dispatcher:legacy:${groupRouteId}`)).toBe(false);

    const published = await publishRouteGraphSource({ sourceGraph: graph, createdBy: 'test' });
    expect(published.ok).toBe(true);
    const bindings = await loadActiveRouteGraphRouteBindings();
    expect(bindings.get(groupRouteId)).toMatchObject({
      routeId: groupRouteId,
      routeMode: 'explicit_group',
      sourceRouteIds: [sourceRouteId],
      exposedModelName: 'public-group',
    });
  });

  it('publishes manual pattern-sourced candidate selector macros over generated route endpoints', async () => {
    const sourceRouteA = await db.insert(schema.tokenRoutes).values({
      displayName: 'claude-opus-pattern-source',
      routingStrategy: 'weighted',
      enabled: true,
    });
    const routeAId = Number(sourceRouteA.lastInsertRowid || sourceRouteA.insertId);
    const sourceRouteB = await db.insert(schema.tokenRoutes).values({
      displayName: 'gpt-pattern-source',
      routingStrategy: 'weighted',
      enabled: true,
    });
    const routeBId = Number(sourceRouteB.lastInsertRowid || sourceRouteB.insertId);
    const { accountId, tokenId } = await seedAccountToken('pattern-source');
    await db.insert(schema.routeChannels).values([
      {
        routeId: routeAId,
        accountId,
        tokenId,
        sourceModel: 'claude-opus-pattern-source',
        priority: 0,
        weight: 10,
        enabled: true,
      },
      {
        routeId: routeBId,
        accountId,
        tokenId,
        sourceModel: 'gpt-pattern-source',
        priority: 0,
        weight: 10,
        enabled: true,
      },
    ]).run();

    const projection = await buildRouteGraphSourceFromCurrentProjectionTable();
    const published = await publishRouteGraphSource({
      sourceGraph: {
        ...projection,
        macros: [
          ...(projection.macros || []),
          {
            id: 'manual-pattern-group',
            kind: 'candidate_selector',
            enabled: true,
            visibility: 'public',
            ownership: 'manual',
            config: {
              surface: {
                entry: {
                  kind: 'external',
                  visibility: 'public',
                  match: { displayName: 'manual-claude-pattern-group' },
                },
                output: 'route',
              },
              policy: { strategy: 'priority_order' },
              groups: [
                {
                  id: 'claude',
                  enabled: true,
                  priority: 0,
                  input: { kind: 'model_pattern', pattern: 'claude-*' },
                  materialization: { sort: 'model_name', dedupeBy: 'route_id' },
                },
              ],
            },
          },
        ],
      },
      createdBy: 'test',
    });

    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.version.compiledGraph.publicModels).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'manual-claude-pattern-group' }),
    ]));
    expect(published.version.compiledGraph.terminals).toEqual(expect.arrayContaining([
      expect.objectContaining({ legacyRouteId: routeAId }),
    ]));
    expect(published.version.compiledGraph.terminals.some((terminal) => terminal.legacyRouteId === routeBId)).toBe(true);

    const primitive = compileRouteGraphSource(published.version.sourceGraph).primitiveSource;
    expect(primitive.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `macro:manual-pattern-group:candidate:claude:route:${routeAId}`,
        ownership: 'derived',
      }),
    ]));
    expect(primitive.nodes.some((node) => node.id === `macro:manual-pattern-group:candidate:claude:route:${routeBId}`)).toBe(false);
  });

  it('rebases stale drafts with newly generated projection macros', async () => {
    const initial = await publishRouteGraphSource({
      sourceGraph: {
        version: 1,
        nodes: [
          {
            id: 'entry.manual',
            type: 'entry',
            enabled: true,
            visibility: 'public',
            ownership: 'manual',
            match: { requestedModelPattern: 'manual-model', displayName: null },
          },
        ],
        edges: [],
        macros: [],
      },
      createdBy: 'test',
      allowDiagnostics: true,
    });
    expect(initial.ok).toBe(true);

    const draft = await saveRouteGraphDraft({
      version: 1,
      nodes: [
        {
          id: 'entry.manual',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'manual-model', displayName: null },
        },
      ],
      edges: [],
      macros: [],
    });
    expect(draft.workingGraph.macros).toHaveLength(0);

    const sourceInsert = await db.insert(schema.tokenRoutes).values({
      displayName: 'source-model',
      routingStrategy: 'weighted',
      enabled: true,
    });
    const sourceRouteId = Number(sourceInsert.lastInsertRowid || sourceInsert.insertId);
    const { accountId, tokenId } = await seedAccountToken('rebase-source');
    const groupInsert = await db.insert(schema.tokenRoutes).values({
      displayName: 'public-group',
      routingStrategy: 'round_robin',
      enabled: true,
    });
    const groupRouteId = Number(groupInsert.lastInsertRowid || groupInsert.insertId);
    await db.insert(schema.routeGroupSources).values({ groupRouteId, sourceRouteId });
    await db.insert(schema.routeChannels).values({
      routeId: sourceRouteId,
      accountId,
      tokenId,
      sourceModel: 'source-model',
      priority: 0,
      weight: 10,
      enabled: true,
    });

    const activeGraph = await buildRouteGraphSourceFromCurrentProjectionTable(initial.version.sourceGraph);
    const active = await publishRouteGraphSource({ sourceGraph: activeGraph, createdBy: 'test' });
    expect(active.ok).toBe(true);

    const rebased = await rebaseRouteGraphDraft();
    expect(rebased.workingGraph.macros).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `route:${groupRouteId}:model-group`,
        kind: 'candidate_selector',
        ownership: 'auto_generated',
      }),
    ]));
    expect(rebased.workingGraph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'entry.manual', ownership: 'manual' }),
    ]));
  });
});
