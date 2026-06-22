import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
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
  let getActiveRouteGraphVersion: RouteGraphServiceModule['getActiveRouteGraphVersion'];
  let getRouteGraphDraft: RouteGraphServiceModule['getRouteGraphDraft'];
  let buildRouteGraphSourceFromCurrentProjectionTable: RouteGraphServiceModule['buildRouteGraphSourceFromCurrentProjectionTable'];
  let reconcileActiveGraphWithProjectionTable: RouteGraphServiceModule['reconcileActiveGraphWithProjectionTable'];
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
    getActiveRouteGraphVersion = serviceModule.getActiveRouteGraphVersion;
    getRouteGraphDraft = serviceModule.getRouteGraphDraft;
    buildRouteGraphSourceFromCurrentProjectionTable = serviceModule.buildRouteGraphSourceFromCurrentProjectionTable;
    reconcileActiveGraphWithProjectionTable = serviceModule.reconcileActiveGraphWithProjectionTable;
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
    const supplyEndpoint = active.sourceGraph.nodes.find((node) => (
      node.type === 'route_endpoint'
      && node.endpointKind === 'supply'
      && node.routeId === routeId
    ));

    expect(active.status).toBe('active');
    expect(active.sourceGraph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect.stringMatching(/^route-endpoint:supply:upstream-model:/), type: 'route_endpoint', endpointKind: 'supply', ownership: 'auto_generated' }),
      expect.objectContaining({ id: 'route-endpoint:product:auto-model:recovered-model', type: 'route_endpoint', endpointKind: 'route_product', ownership: 'auto_generated' }),
      expect.objectContaining({ id: `pool:legacy:${routeId}`, type: 'model_endpoint', ownership: 'auto_generated' }),
    ]));
    expect(supplyEndpoint).toMatchObject({
      metadata: expect.objectContaining({
        localRouteId: routeId,
        endpointIdentity: expect.objectContaining({
          provider: 'openai',
          siteUrl: 'https://recover.example',
          model: 'recovered-model',
        }),
      }),
    });
    expect(active.compiledGraph.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: 'macro:auto-model:recovered-model:entry',
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
      expect.objectContaining({ id: 'route-endpoint:product:auto-model:recovered-model' }),
      expect.objectContaining({ id: `pool:legacy:${routeId}` }),
    ]));
    expect(compileRouteGraphSource(draft.workingGraph).ok).toBe(true);
  });

  it('recompiles cached active graph JSON when the program bundle is missing', async () => {
    const sourceGraph = {
      version: 1,
      nodes: [
        {
          id: 'entry.cached',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'cached-model' },
        },
        {
          id: 'endpoint.cached',
          type: 'model_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 700,
          config: { targets: [{ channelId: '700', model: 'cached-model' }], targetSelection: { strategy: 'weighted' } },
        },
      ],
      edges: [
        { id: 'entry-endpoint', sourceNodeId: 'entry.cached', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint.cached', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    };
    const published = await publishRouteGraphSource({ sourceGraph, createdBy: 'test' });
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    const legacyCompiled = { ...published.version.compiledGraph } as Record<string, unknown>;
    delete legacyCompiled.programBundle;
    await db.update(schema.routeGraphVersions).set({
      compiledGraphJson: JSON.stringify(legacyCompiled),
    }).where(eq(schema.routeGraphVersions.id, published.version.id)).run();

    const active = await getActiveRouteGraphVersion();
    expect(active?.compiledGraph.programBundle).toMatchObject({
      version: 3,
      matcher: {
        exact: {
          'cached-model': expect.objectContaining({ programId: 'program:entry.cached' }),
        },
      },
    });
    const stored = await db.select().from(schema.routeGraphVersions)
      .where(eq(schema.routeGraphVersions.id, published.version.id))
      .get();
    expect(JSON.parse(stored?.compiledGraphJson || '{}').programBundle).toMatchObject({ version: 3 });

    const corruptedCompiled = JSON.parse(stored?.compiledGraphJson || '{}');
    corruptedCompiled.programBundle = {
      ...corruptedCompiled.programBundle,
      diagnostics: [{
        severity: 'error',
        code: 'program.unsupported_shape',
        message: 'cached program bundle is not executable',
      }],
    };
    await db.update(schema.routeGraphVersions).set({
      compiledGraphJson: JSON.stringify(corruptedCompiled),
    }).where(eq(schema.routeGraphVersions.id, published.version.id)).run();

    const repaired = await getActiveRouteGraphVersion();
    expect(repaired?.compiledGraph.programBundle.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'program.unsupported_shape' }),
    ]));
    const repairedStored = await db.select().from(schema.routeGraphVersions)
      .where(eq(schema.routeGraphVersions.id, published.version.id))
      .get();
    expect(JSON.parse(repairedStored?.compiledGraphJson || '{}').programBundle.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'program.unsupported_shape' }),
    ]));
  });

  it('preserves manual edges that reuse projection-owned endpoints and semantic macros during active graph reconciliation', async () => {
    const sourceInsert = await db.insert(schema.tokenRoutes).values({
      displayName: 'projection-source-model',
      routingStrategy: 'weighted',
      enabled: true,
    });
    const sourceRouteId = Number(sourceInsert.lastInsertRowid || sourceInsert.insertId);
    const { accountId, tokenId } = await seedAccountToken('projection-edge-source');
    await db.insert(schema.routeChannels).values({
      routeId: sourceRouteId,
      accountId,
      tokenId,
      sourceModel: 'projection-source-model',
      priority: 0,
      weight: 10,
      enabled: true,
    });

    const projection = await buildRouteGraphSourceFromCurrentProjectionTable();
    const sourceGraph = {
      ...projection,
      nodes: [
        ...projection.nodes,
        {
          id: 'entry.manual-projection-reuse',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'manual-projection-reuse' },
        },
      ],
      macros: [
        ...(projection.macros || []),
        {
          id: 'manual:projection-gate',
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
                input: { kind: 'synthetic', statusCode: 503, message: 'projection fallback' },
              },
            ],
          },
        },
      ],
      edges: [
        ...projection.edges,
        {
          id: 'manual-entry-to-semantic-macro',
          sourceNodeId: 'entry.manual-projection-reuse',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'macro:manual:projection-gate',
          targetPortId: 'flow.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
        {
          id: 'manual-semantic-macro-to-projection-endpoint',
          sourceNodeId: 'macro:manual:projection-gate',
          sourcePortId: 'flow.out',
          targetNodeId: `pool:legacy:${sourceRouteId}`,
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
      ],
    };
    const published = await publishRouteGraphSource({ sourceGraph, createdBy: 'test' });
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    const reconciled = await reconcileActiveGraphWithProjectionTable(published.version, new Map(), { allowDiagnostics: true });
    expect(reconciled.sourceGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'manual-entry-to-semantic-macro' }),
      expect.objectContaining({ id: 'manual-semantic-macro-to-projection-endpoint' }),
    ]));
    expect(reconciled.compiledGraph.programBundle.matcher.exact['manual-projection-reuse']).toMatchObject({
      programId: 'program:entry.manual-projection-reuse',
    });
    const program = reconciled.compiledGraph.programBundle.programs.find((item) => item.id === 'program:entry.manual-projection-reuse');
    expect(program?.ops).toEqual(expect.arrayContaining([
      expect.objectContaining({
        op: 'select_supply',
        routeId: sourceRouteId,
      }),
    ]));
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
      visibility: 'public',
      sourceRouteIds: [sourceRouteId],
      exposedModelName: 'public-group',
    });

    if (!published.ok) return;
    const internalGraph = {
      ...graph,
      macros: (graph.macros || []).map((macro) => (
        macro.id === `route:${groupRouteId}:model-group`
          ? {
            ...macro,
            visibility: 'internal',
            config: {
              ...macro.config,
              surface: {
                ...macro.config.surface,
                entry: {
                  ...macro.config.surface.entry,
                  visibility: 'internal',
                },
              },
            },
          }
          : macro
      )),
    };
    const reconciled = await reconcileActiveGraphWithProjectionTable({
      ...published.version,
      sourceGraph: internalGraph,
      compiledGraph: compileRouteGraphSource(internalGraph).compiled,
    });
    const reconciledMacro = (reconciled.sourceGraph.macros || [])
      .find((macro) => macro.id === `route:${groupRouteId}:model-group`);
    expect(reconciledMacro?.visibility).toBe('internal');
  });

  it('projects automatic exact routes as read-only candidate_selector macros over generated primitives', async () => {
    const routeInsert = await db.insert(schema.tokenRoutes).values({
      displayName: 'gpt-auto-native',
      routingStrategy: 'weighted',
      enabled: true,
    });
    const routeId = Number(routeInsert.lastInsertRowid || routeInsert.insertId);
    const { accountId, tokenId } = await seedAccountToken('auto-native');
    await db.insert(schema.routeChannels).values({
      routeId,
      accountId,
      tokenId,
      sourceModel: 'gpt-auto-native',
      priority: 0,
      weight: 10,
      enabled: true,
    });

    const graph = await buildRouteGraphSourceFromCurrentProjectionTable();
    const supplyEndpoint = graph.nodes.find((node) => (
      node.type === 'route_endpoint'
      && node.endpointKind === 'supply'
      && node.routeId === routeId
    ));
    expect(supplyEndpoint?.id).toEqual(expect.stringMatching(/^route-endpoint:supply:upstream-model:/));
    expect(graph.macros).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'auto-model:gpt-auto-native',
        kind: 'candidate_selector',
        ownership: 'auto_generated',
        config: expect.objectContaining({
          surface: expect.objectContaining({
            entry: expect.objectContaining({
              kind: 'external',
              visibility: 'public',
              match: expect.objectContaining({
                requestedModelPattern: 'gpt-auto-native',
                displayName: 'gpt-auto-native',
                routeId,
              }),
            }),
            output: 'route',
          }),
          groups: [
            expect.objectContaining({
              input: { kind: 'route_endpoints', endpointIds: [supplyEndpoint?.id] },
            }),
          ],
        }),
      }),
    ]));
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `route-endpoint:product:auto-model:gpt-auto-native`,
        type: 'route_endpoint',
        ownership: 'auto_generated',
        endpointKind: 'route_product',
      }),
      expect.objectContaining({
        id: supplyEndpoint?.id,
        type: 'route_endpoint',
        ownership: 'auto_generated',
        endpointKind: 'supply',
      }),
      expect.objectContaining({
        id: `pool:legacy:${routeId}`,
        ownership: 'auto_generated',
        metadata: expect.objectContaining({ projectedByMacroId: 'auto-model:gpt-auto-native' }),
      }),
    ]));

    const compiled = compileRouteGraphSource(graph);
    expect(compiled.ok).toBe(true);
    expect(compiled.compiled.publicModels).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: 'macro:auto-model:gpt-auto-native:entry',
        model: 'gpt-auto-native',
      }),
    ]));

    const published = await publishRouteGraphSource({ sourceGraph: graph, createdBy: 'test' });
    expect(published.ok).toBe(true);
    const bindings = await loadActiveRouteGraphRouteBindings();
    expect(bindings.get(routeId)).toMatchObject({
      routeId,
      routeMode: 'pattern',
      sourceRouteIds: [],
      exposedModelName: 'gpt-auto-native',
      exactModelName: 'gpt-auto-native',
    });
  });

  it('uses stable semantic supply endpoint ids independent of local route and channel ids', async () => {
    const firstRoute = await db.insert(schema.tokenRoutes).values({
      displayName: 'gpt-stable-supply',
      routingStrategy: 'weighted',
      enabled: true,
    });
    const firstRouteId = Number(firstRoute.lastInsertRowid || firstRoute.insertId);
    const secondRoute = await db.insert(schema.tokenRoutes).values({
      displayName: 'GPT-Stable-Supply',
      routingStrategy: 'weighted',
      enabled: true,
    });
    const secondRouteId = Number(secondRoute.lastInsertRowid || secondRoute.insertId);
    const { accountId, tokenId } = await seedAccountToken('stable-supply');
    await db.insert(schema.routeChannels).values([
      {
        routeId: firstRouteId,
        accountId,
        tokenId,
        sourceModel: 'gpt-stable-supply',
        priority: 0,
        weight: 10,
        enabled: true,
      },
      {
        routeId: secondRouteId,
        accountId,
        tokenId,
        sourceModel: 'gpt-stable-supply',
        priority: 1,
        weight: 10,
        enabled: true,
      },
    ]);

    const graph = await buildRouteGraphSourceFromCurrentProjectionTable();
    const stableSupplyEndpoints = graph.nodes.filter((node) => (
      node.type === 'route_endpoint'
      && node.endpointKind === 'supply'
      && node.id.includes(':gpt-stable-supply:')
    ));

    expect(stableSupplyEndpoints).toHaveLength(1);
    expect(stableSupplyEndpoints[0]?.id).toEqual(expect.stringMatching(/^route-endpoint:supply:upstream-model:openai:[a-f0-9]{8}:gpt-stable-supply:[a-f0-9]{8}$/));
    expect(stableSupplyEndpoints[0]?.id).not.toContain(`route:${firstRouteId}`);
    expect(stableSupplyEndpoints[0]?.id).not.toContain(`route:${secondRouteId}`);
    expect(stableSupplyEndpoints[0]?.metadata).toMatchObject({
      localRouteIds: expect.arrayContaining([firstRouteId, secondRouteId]),
      endpointLocalRefs: expect.arrayContaining([
        expect.objectContaining({ localRouteId: firstRouteId }),
        expect.objectContaining({ localRouteId: secondRouteId }),
      ]),
      endpointIdentity: expect.not.objectContaining({
        routeId: expect.anything(),
        routeChannelId: expect.anything(),
      }),
    });

    const macro = (graph.macros || []).find((item) => item.id === 'auto-model:gpt-stable-supply');
    const endpointIds = macro?.config.groups.flatMap((group) => (
      group.input.kind === 'route_endpoints' ? group.input.endpointIds : []
    ));
    expect(endpointIds).toEqual([stableSupplyEndpoints[0]?.id]);

    const compiled = compileRouteGraphSource(graph);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === 'node.duplicate_id')).toEqual([]);
    expect(compiled.ok).toBe(true);
  });

  it('reconciles colon-named automatic exact route projections without retaining stale generated nodes', async () => {
    const firstRoute = await db.insert(schema.tokenRoutes).values({
      displayName: 'deepseek-v4-flash:free',
      routingStrategy: 'weighted',
      enabled: true,
    });
    const firstRouteId = Number(firstRoute.lastInsertRowid || firstRoute.insertId);
    const secondRoute = await db.insert(schema.tokenRoutes).values({
      displayName: 'DeepSeek-V4-Flash:Free',
      routingStrategy: 'weighted',
      enabled: true,
    });
    const secondRouteId = Number(secondRoute.lastInsertRowid || secondRoute.insertId);
    const { accountId, tokenId } = await seedAccountToken('colon-auto-native');
    await db.insert(schema.routeChannels).values([
      {
        routeId: firstRouteId,
        accountId,
        tokenId,
        sourceModel: 'deepseek-v4-flash:free',
        priority: 0,
        weight: 10,
        enabled: true,
      },
      {
        routeId: secondRouteId,
        accountId,
        tokenId,
        sourceModel: 'DeepSeek-V4-Flash:Free',
        priority: 1,
        weight: 10,
        enabled: true,
      },
    ]);

    const graph = await buildRouteGraphSourceFromCurrentProjectionTable();
    const published = await publishRouteGraphSource({ sourceGraph: graph, createdBy: 'test' });
    expect(published.ok).toBe(true);

    const pollutedActive = {
      ...published.version,
      sourceGraph: {
        ...published.version.sourceGraph,
        nodes: [
          ...published.version.sourceGraph.nodes,
          ...compileRouteGraphSource(published.version.sourceGraph).primitiveSource.nodes
            .filter((node) => node.id.startsWith('macro:auto-model:deepseek-v4-flash:free')),
        ],
      },
    };

    const reconciled = await reconcileActiveGraphWithProjectionTable(pollutedActive, new Map(), { allowDiagnostics: false });
    const compiled = compileRouteGraphSource(reconciled.sourceGraph);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === 'node.duplicate_id')).toEqual([]);
    expect(compiled.ok).toBe(true);
    expect(reconciled.sourceGraph.nodes.filter((node) => node.id === 'route-endpoint:product:auto-model:deepseek-v4-flash:free')).toHaveLength(1);
    expect((reconciled.sourceGraph.macros || []).filter((macro) => macro.id === 'auto-model:deepseek-v4-flash:free')).toHaveLength(1);
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
