import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRouteMacroSemanticNodeId } from '../../../shared/routingIdentity.js';

type DbModule = typeof import('../../db/index.js');

describe('route graph API graph-native behavior', () => {
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-route-graph-api-'));
    process.env.DATA_DIR = dataDir;

    await import('../../db/migrate.js');
    const dbModule = await import('../../db/index.js');
    const routesModule = await import('./tokens.js');
    db = dbModule.db;
    schema = dbModule.schema;

    app = Fastify();
    await app.register(routesModule.tokensRoutes);
  });

  beforeEach(async () => {
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
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DATA_DIR;
  });

  async function createRouteGroup(modelName: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/route-groups',
      payload: {
        model: { publicName: modelName },
        presentation: {
          displayName: null,
          displayIcon: null,
        },
        dispatcherPolicy: { kind: 'builtin', builtin: 'weighted' },
        enabled: true,
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as any;
  }

  function asGraphAuthoringCommand(graph: any) {
    const nodeIds = new Set(graph.nodes.map((node: any) => node.id));
    const macroIds = new Map((graph.macros || []).map((macro: any) => [createRouteMacroSemanticNodeId(macro.id), macro.id]));
    const element = (id: string) => nodeIds.has(id)
      ? { kind: 'node', id }
      : { kind: 'macro', id: macroIds.get(id) };
    return {
      nodes: graph.nodes,
      macros: graph.macros || [],
      edges: graph.edges.map((edge: any) => ({
        id: edge.id,
        source: element(edge.sourceNodeId),
        sourcePortId: edge.sourcePortId,
        target: element(edge.targetNodeId),
        targetPortId: edge.targetPortId,
        kind: edge.kind,
        ownership: edge.ownership,
        ...(edge.metadata ? { metadata: edge.metadata } : {}),
      })),
      ...(graph.metadata ? { metadata: graph.metadata } : {}),
    };
  }

  it('keeps active and draft graph reads side-effect free when no graph has been published', async () => {
    const beforeVersions = await db.select().from(schema.routeGraphVersions).all();
    const beforeDrafts = await db.select().from(schema.routeGraphDrafts).all();

    const [active, source, draft] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/route-graph/active' }),
      app.inject({ method: 'GET', url: '/api/route-graph/active?include=source' }),
      app.inject({ method: 'GET', url: '/api/route-graph/draft' }),
    ]);

    expect(active.statusCode).toBe(404);
    expect(source.statusCode).toBe(404);
    expect(draft.statusCode).toBe(404);
    expect(await db.select().from(schema.routeGraphVersions).all()).toEqual(beforeVersions);
    expect(await db.select().from(schema.routeGraphDrafts).all()).toEqual(beforeDrafts);
    expect(await db.select().from(schema.routeGraphActiveVersion).all()).toEqual([]);
  });

  it('serves lightweight, source, and full active graph views from the same active version', async () => {
    await createRouteGroup('gpt-4.1-mini');

    const lightweight = await app.inject({ method: 'GET', url: '/api/route-graph/active' });
    expect(lightweight.statusCode).toBe(200);
    const lightweightBody = lightweight.json() as any;
    expect(lightweightBody.sourceGraph).toBeNull();
    expect(lightweightBody.compiledGraph).toBeNull();
    expect(lightweightBody.sourceSummary.nodes).toBe(0);
    expect(lightweightBody.sourceSummary.macros).toBeGreaterThan(0);

    const source = await app.inject({ method: 'GET', url: '/api/route-graph/active?include=source' });
    expect(source.statusCode).toBe(200);
    const sourceBody = source.json() as any;
    expect(sourceBody.version.id).toBe(lightweightBody.version.id);
    expect(sourceBody.sourceGraph.nodes.length).toBe(lightweightBody.sourceSummary.nodes);
    expect(sourceBody.compiledGraph).toBeNull();

    const full = await app.inject({ method: 'GET', url: '/api/route-graph/active?include=full' });
    expect(full.statusCode).toBe(200);
    const fullBody = full.json() as any;
    expect(fullBody.version.id).toBe(lightweightBody.version.id);
    expect(fullBody.sourceGraph.nodes.length).toBe(lightweightBody.sourceSummary.nodes);
    expect(fullBody.compiledGraph.compiledRouterBundle.plans).toEqual(expect.arrayContaining([
      expect.objectContaining({
        publicModelName: 'gpt-4.1-mini',
        executionAlternatives: expect.arrayContaining([
          expect.objectContaining({ kind: 'synthetic_response' }),
        ]),
      }),
    ]));
  });

  it('does not expose route-group products through the supply endpoint catalog', async () => {
    await createRouteGroup('catalog-model');

    const response = await app.inject({
      method: 'GET',
      url: '/api/route-graph/endpoints?page=1&pageSize=20',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.items).toEqual([]);
    expect(body.revision).toEqual(expect.any(String));

    const stale = await app.inject({
      method: 'GET',
      url: '/api/route-graph/endpoints?page=1&pageSize=20&revision=draft%3Astale',
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ success: false, code: 'stale_revision' });
  });

  it('serves the paged graph Index without a graph slice and loads explicit semantic or primitive Focus workspaces', async () => {
    await createRouteGroup('workspace-a');
    await createRouteGroup('workspace-b');

    const index = await app.inject({ method: 'GET', url: '/api/route-graph/workspace-index?limit=1' });
    expect(index.statusCode).toBe(200);
    const indexBody = index.json() as any;
    expect(indexBody.items).toHaveLength(1);
    expect(indexBody.totalCount).toBeGreaterThanOrEqual(2);
    expect(indexBody.nextCursor).toEqual(expect.any(String));
    expect(indexBody).not.toHaveProperty('graph');
    const focus = indexBody.items[0].focus;

    const workspace = await app.inject({
      method: 'GET',
      url: `/api/route-graph/workspace?focusKind=${focus.kind}&focusId=${encodeURIComponent(focus.id)}&representation=semantic`,
    });
    expect(workspace.statusCode).toBe(200);
    const workspaceBody = workspace.json() as any;
    expect(workspaceBody.representation).toBe('semantic');
    expect(workspaceBody.focus).toMatchObject(focus);
    expect(workspaceBody.residentGraph.macros).toHaveLength(1);
    expect(workspaceBody).not.toHaveProperty('graph');
    expect(workspaceBody).not.toHaveProperty('primitiveGraph');

    const primitive = await app.inject({
      method: 'GET',
      url: `/api/route-graph/workspace?focusKind=${focus.kind}&focusId=${encodeURIComponent(focus.id)}&representation=primitive`,
    });
    expect(primitive.statusCode).toBe(200);
    expect(primitive.json()).toMatchObject({
      representation: 'primitive',
      focus,
      residentGraph: { macros: [] },
      capabilities: { editable: false },
    });

    const oldCatalog = await app.inject({ method: 'GET', url: '/api/route-graph/workspace/catalog' });
    expect(oldCatalog.statusCode).toBe(404);
  });

  it('rejects workspace edits from a stale revision instead of replacing the full graph', async () => {
    await createRouteGroup('workspace-edit');
    const index = await app.inject({ method: 'GET', url: '/api/route-graph/workspace-index?limit=1' });
    const body = index.json() as any;
    const response = await app.inject({
      method: 'POST',
      url: '/api/route-graph/workspace/operations',
      payload: {
        revision: `${body.revision}:stale`,
        operations: [{ kind: 'remove_macro', macroId: body.items[0].focus.id }],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ success: false, stale: true });
  });

  it('creates workspace macros with a server-issued Graph identity', async () => {
    const index = await app.inject({ method: 'GET', url: '/api/route-graph/workspace-index' });
    expect(index.statusCode).toBe(200);
    const response = await app.inject({
      method: 'POST',
      url: '/api/route-graph/workspace/macros',
      payload: {
        revision: (index.json() as any).revision,
        macro: {
          kind: 'candidate_selector',
          name: 'HTTP-created macro',
          enabled: true,
          ownership: 'manual',
          config: {
            surface: { entry: { kind: 'none' }, output: 'route', ports: [] },
            policy: { kind: 'inherit_default' },
            groups: [{ id: 'unavailable', enabled: true, input: { kind: 'synthetic', statusCode: 503, message: 'No route is available.' } }],
          },
        },
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.macro.id).toMatch(/^route:managed:[0-9a-f-]{36}$/);
    expect(body.macro.id).not.toBe('HTTP-created macro');
  });

  it('applies a revisioned workspace operation without replacing nonresident graph elements', async () => {
    await createRouteGroup('workspace-operation');
    const index = await app.inject({ method: 'GET', url: '/api/route-graph/workspace-index?limit=1' });
    const body = index.json() as any;
    const macroId = body.items[0].focus.id;
    const response = await app.inject({
      method: 'POST',
      url: '/api/route-graph/workspace/operations',
      payload: {
        revision: body.revision,
        operations: [{
          kind: 'upsert_node',
          node: {
            id: 'manual:workspace-operation',
            type: 'entry',
            enabled: false,
            ownership: 'manual',
            match: { kind: 'model', requestedModelPattern: 'workspace-operation', displayName: 'workspace-operation' },
          },
        }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ success: true, revision: expect.any(String), batchId: expect.any(Number) });
    const saved = response.json() as any;
    expect(saved.revision).not.toBe(body.revision);
    const batches = await app.inject({ method: 'GET', url: '/api/route-graph/workspace/operation-batches' });
    expect(batches.statusCode).toBe(200);
    expect(batches.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: saved.batchId, resultRevision: saved.revision }),
    ]));
    const draft = await app.inject({ method: 'GET', url: '/api/route-graph/draft' });
    const graph = (draft.json() as any).draft.workingGraph;
    expect(graph.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'manual:workspace-operation' })]));
    expect(graph.macros).toEqual(expect.arrayContaining([expect.objectContaining({ id: macroId })]));

    const undo = await app.inject({
      method: 'POST',
      url: `/api/route-graph/workspace/operation-batches/${saved.batchId}/replay`,
      payload: { revision: saved.revision, direction: 'undo' },
    });
    expect(undo.statusCode).toBe(200);
    expect(undo.json()).toMatchObject({ success: true, revision: expect.any(String) });
  });

  it('discovers and creates cross-Focus connections through revisioned workspace APIs', async () => {
    const index = await app.inject({ method: 'GET', url: '/api/route-graph/workspace-index' });
    const revision = (index.json() as any).revision;
    const entry = {
      id: 'manual:entry:http-connection', type: 'entry', enabled: true, ownership: 'manual',
      match: { kind: 'model', requestedModelPattern: 'http-connection', displayName: 'HTTP connection' },
    };
    const filter = { id: 'manual:filter:http-connection', type: 'filter', enabled: true, ownership: 'manual', operations: [] };
    const seeded = await app.inject({
      method: 'POST',
      url: '/api/route-graph/workspace/operations',
      payload: {
        revision,
        operations: [
          { kind: 'upsert_node', node: entry },
          { kind: 'upsert_node', node: filter },
        ],
      },
    });
    expect(seeded.statusCode).toBe(200);
    const seededRevision = (seeded.json() as any).revision;

    const targets = await app.inject({
      method: 'GET',
      url: `/api/route-graph/workspace/connection-targets?elementKind=node&elementId=${encodeURIComponent(entry.id)}&portId=bidirect.out&limit=1`,
    });
    expect(targets.statusCode).toBe(200);
    expect(targets.json()).toMatchObject({
      revision: seededRevision,
      totalCount: 1,
      items: [{ endpoint: { element: { kind: 'node', id: filter.id }, portId: 'bidirect.in' } }],
    });

    const connected = await app.inject({
      method: 'POST',
      url: '/api/route-graph/workspace/connections',
      payload: {
        revision: seededRevision,
        first: { element: { kind: 'node', id: entry.id }, portId: 'bidirect.out' },
        second: { element: { kind: 'node', id: filter.id }, portId: 'bidirect.in' },
      },
    });
    expect(connected.statusCode).toBe(200);
    const connectedBody = connected.json() as any;
    expect(connectedBody).toMatchObject({ success: true, edge: { sourceNodeId: entry.id, targetNodeId: filter.id } });

    const impact = await app.inject({
      method: 'POST',
      url: '/api/route-graph/workspace/removal-impact',
      payload: { revision: connectedBody.revision, element: { kind: 'node', id: entry.id } },
    });
    expect(impact.statusCode).toBe(200);
    expect(impact.json()).toMatchObject({
      success: true,
      incidentConnections: { total: 1, incoming: 0, outgoing: 1 },
    });

    const stale = await app.inject({
      method: 'POST',
      url: '/api/route-graph/workspace/connections',
      payload: {
        revision: seededRevision,
        first: { element: { kind: 'node', id: entry.id }, portId: 'bidirect.out' },
        second: { element: { kind: 'node', id: filter.id }, portId: 'bidirect.in' },
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ success: false, code: 'stale_revision' });
  });

  it('validates and publishes draft graph payloads without route-table fields', async () => {
    const route = await createRouteGroup('draft-model');
    const active = await app.inject({ method: 'GET', url: '/api/route-graph/active?include=source' });
    const graph = (active.json() as any).sourceGraph;
    const serialized = JSON.stringify(graph);
    expect(serialized).not.toContain('entry:legacy');
    expect(serialized).not.toContain('sourceRouteIds');

    const command = asGraphAuthoringCommand(graph);
    const validate = await app.inject({
      method: 'POST',
      url: '/api/route-graph/validate',
      payload: command,
    });
    expect(validate.statusCode).toBe(200);
    expect(validate.json()).toMatchObject({ ok: true });

    const save = await app.inject({
      method: 'PUT',
      url: '/api/route-graph/draft',
      payload: command,
    });
    expect(save.statusCode).toBe(200);
    expect(save.json()).toMatchObject({ success: true });

    const publish = await app.inject({ method: 'POST', url: '/api/route-graph/draft/publish' });
    expect(publish.statusCode).toBe(200);
    expect(publish.json()).toMatchObject({ success: true });
    expect(route.id).toBeTruthy();
  });

  it('allocates full-graph element identities server-side and rewrites local edge references', async () => {
    const payload = {
      nodes: [
        { localRef: 'entry', type: 'entry', enabled: true, ownership: 'manual', match: { kind: 'model', requestedModelPattern: 'local-ref-model' } },
        { localRef: 'endpoint', type: 'synthetic_endpoint', enabled: true, ownership: 'manual', statusCode: 503, message: 'Unavailable' },
      ],
      macros: [],
      edges: [{
        localRef: 'entry-to-endpoint',
        source: { kind: 'node', localRef: 'entry' },
        sourcePortId: 'route.out',
        target: { kind: 'node', localRef: 'endpoint' },
        targetPortId: 'route.in',
        kind: 'route_flow',
        ownership: 'manual',
      }],
    };
    const save = await app.inject({ method: 'PUT', url: '/api/route-graph/draft', payload });
    expect(save.statusCode).toBe(200);
    const graph = (save.json() as any).draft.workingGraph;
    expect(graph.nodes.map((node: any) => node.id)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^manual:entry:/),
      expect.stringMatching(/^manual:synthetic_endpoint:/),
    ]));
    expect(graph.edges[0]).toMatchObject({
      id: expect.stringMatching(/^manual:edge:/),
      sourceNodeId: graph.nodes[0].id,
      targetNodeId: graph.nodes[1].id,
    });

    const forged = await app.inject({
      method: 'PUT',
      url: '/api/route-graph/draft',
      payload: { nodes: [{ id: 'manual:node:forged', type: 'entry' }], macros: [], edges: [] },
    });
    expect(forged.statusCode).toBe(400);
    expect(forged.json()).toMatchObject({
      success: false,
      code: 'graph_authoring_identity_invalid',
      params: {},
    });

    const missingLocalRef = await app.inject({
      method: 'PUT',
      url: '/api/route-graph/draft',
      payload: { nodes: [{ type: 'entry', enabled: true }], macros: [], edges: [] },
    });
    expect(missingLocalRef.statusCode).toBe(400);
    expect(missingLocalRef.json()).toMatchObject({ success: false });
  });
});
