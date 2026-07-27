import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type DbModule = typeof import('../db/index.js');
type WorkspaceOperationsModule = typeof import('./routeGraphWorkspaceOperationsService.js');
type WorkspaceQueryModule = typeof import('./routeGraphWorkspaceQueryService.js');
type RouteGraphServiceModule = typeof import('./routeGraphService.js');
type WorkspaceConnectionModule = typeof import('./routeGraphWorkspaceConnectionService.js');
type WorkspaceMutationModule = typeof import('./routeGraphWorkspaceMutationService.js');

describe('route graph workspace operation batches', () => {
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let getRouteGraphWorkspaceIndexPage: WorkspaceQueryModule['getRouteGraphWorkspaceIndexPage'];
  let applyRouteGraphWorkspaceOperations: WorkspaceOperationsModule['applyRouteGraphWorkspaceOperations'];
  let createRouteGraphWorkspaceNode: WorkspaceOperationsModule['createRouteGraphWorkspaceNode'];
  let createRouteGraphWorkspaceMacro: WorkspaceOperationsModule['createRouteGraphWorkspaceMacro'];
  let listRouteGraphWorkspaceOperationBatches: WorkspaceOperationsModule['listRouteGraphWorkspaceOperationBatches'];
  let replayRouteGraphWorkspaceOperationBatch: WorkspaceOperationsModule['replayRouteGraphWorkspaceOperationBatch'];
  let applyRouteGraphWorkspaceOperationsToGraph: WorkspaceOperationsModule['applyRouteGraphWorkspaceOperationsToGraph'];
  let getRouteGraphDraft: RouteGraphServiceModule['getRouteGraphDraft'];
  let getRouteGraphWorkspaceConnectionTargets: WorkspaceConnectionModule['getRouteGraphWorkspaceConnectionTargets'];
  let createRouteGraphWorkspaceConnection: WorkspaceConnectionModule['createRouteGraphWorkspaceConnection'];
  let getRouteGraphWorkspaceRemovalImpact: WorkspaceMutationModule['getRouteGraphWorkspaceRemovalImpact'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-route-graph-workspace-operations-'));
    process.env.DATA_DIR = dataDir;
    const migrate = await import('../db/migrate.js');
    await migrate.runSqliteMigrations();
    const dbModule = await import('../db/index.js');
    const workspaceOperationsModule = await import('./routeGraphWorkspaceOperationsService.js');
    const workspaceQueryModule = await import('./routeGraphWorkspaceQueryService.js');
    const routeGraphServiceModule = await import('./routeGraphService.js');
    const workspaceConnectionModule = await import('./routeGraphWorkspaceConnectionService.js');
    const workspaceMutationModule = await import('./routeGraphWorkspaceMutationService.js');
    db = dbModule.db;
    schema = dbModule.schema;
    getRouteGraphWorkspaceIndexPage = workspaceQueryModule.getRouteGraphWorkspaceIndexPage;
    applyRouteGraphWorkspaceOperations = workspaceOperationsModule.applyRouteGraphWorkspaceOperations;
    createRouteGraphWorkspaceNode = workspaceOperationsModule.createRouteGraphWorkspaceNode;
    createRouteGraphWorkspaceMacro = workspaceOperationsModule.createRouteGraphWorkspaceMacro;
    listRouteGraphWorkspaceOperationBatches = workspaceOperationsModule.listRouteGraphWorkspaceOperationBatches;
    replayRouteGraphWorkspaceOperationBatch = workspaceOperationsModule.replayRouteGraphWorkspaceOperationBatch;
    applyRouteGraphWorkspaceOperationsToGraph = workspaceOperationsModule.applyRouteGraphWorkspaceOperationsToGraph;
    getRouteGraphDraft = routeGraphServiceModule.getRouteGraphDraft;
    getRouteGraphWorkspaceConnectionTargets = workspaceConnectionModule.getRouteGraphWorkspaceConnectionTargets;
    createRouteGraphWorkspaceConnection = workspaceConnectionModule.createRouteGraphWorkspaceConnection;
    getRouteGraphWorkspaceRemovalImpact = workspaceMutationModule.getRouteGraphWorkspaceRemovalImpact;
  }, 60_000);

  beforeEach(async () => {
    await db.delete(schema.routeGraphWorkspaceOperationBatches).run();
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.compiledRuntimeActiveArtifact).run();
    await db.delete(schema.compiledRuntimeArtifacts).run();
    await db.delete(schema.routeGraphVersions).run();
  });

  afterAll(() => {
    delete process.env.DATA_DIR;
  });

  it('persists inverse operations and permits guarded undo followed by replay', async () => {
    const workspace = await getRouteGraphWorkspaceIndexPage();
    const node = {
      id: 'manual:filter:workspace-test',
      type: 'filter' as const,
      name: 'Workspace test filter',
      enabled: true,
      ownership: 'manual' as const,
      config: { expression: 'true' },
    };
    const saved = await applyRouteGraphWorkspaceOperations({
      revision: workspace.revision,
      operations: [{ kind: 'upsert_node', node }],
    });

    expect(saved.batchId).toBeGreaterThan(0);
    const batches = await listRouteGraphWorkspaceOperationBatches();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(expect.objectContaining({
      id: saved.batchId,
      forwardOperations: [{ kind: 'upsert_node', node }],
      inverseOperations: [{ kind: 'remove_node', nodeId: node.id }],
    }));

    const undone = await replayRouteGraphWorkspaceOperationBatch({
      id: saved.batchId,
      revision: saved.revision,
      direction: 'undo',
    });
    const afterUndo = await getRouteGraphWorkspaceIndexPage({ query: node.id });
    expect(afterUndo.revision).toBe(undone.revision);
    expect(afterUndo.items.some((item) => item.focus.id === node.id)).toBe(false);

    const replayed = await replayRouteGraphWorkspaceOperationBatch({
      id: saved.batchId,
      revision: undone.revision,
      direction: 'replay',
    });
    const afterReplay = await getRouteGraphWorkspaceIndexPage({ query: node.id });
    expect(afterReplay.revision).toBe(replayed.revision);
    expect(afterReplay.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ focus: { kind: 'node', id: node.id } }),
    ]));
  });

  it('allocates persisted manual node identities on the server', async () => {
    const workspace = await getRouteGraphWorkspaceIndexPage();
    const created = await createRouteGraphWorkspaceNode({
      revision: workspace.revision,
      node: {
        type: 'filter',
        name: 'Server-issued filter',
        enabled: false,
        ownership: 'manual',
        operations: [],
      },
    });

    expect(created.node.id).toMatch(/^manual:filter:[0-9a-f-]{36}$/);
    const draft = await getRouteGraphDraft();
    expect(draft.workingGraph.nodes).toContainEqual(created.node);
  });

  it('allocates persisted macro identities on the server', async () => {
    const workspace = await getRouteGraphWorkspaceIndexPage();
    const created = await createRouteGraphWorkspaceMacro({
      revision: workspace.revision,
      macro: {
        kind: 'candidate_selector',
        name: 'Server-issued macro',
        enabled: true,
        ownership: 'manual',
        config: {
          surface: { entry: { kind: 'none' }, output: 'route', ports: [] },
          policy: { kind: 'inherit_default' },
          groups: [{
            id: 'primary',
            enabled: true,
            input: { kind: 'synthetic', statusCode: 503, message: 'No route is available.' },
          }],
        },
      },
    });

    expect(created.macro.id).toMatch(/^route:managed:[0-9a-f-]{36}$/);
    const draft = await getRouteGraphDraft();
    expect(draft.workingGraph.macros).toContainEqual(created.macro);
  });

  it('restores every incident edge when undoing removal of a focus boundary element', async () => {
    const workspace = await getRouteGraphWorkspaceIndexPage();
    const entry = {
      id: 'manual:entry:undo-boundary',
      type: 'entry' as const,
      name: 'Undo boundary',
      enabled: true,
      ownership: 'manual' as const,
      match: { kind: 'model' as const, requestedModelPattern: 'undo-boundary', displayName: 'Undo boundary' },
    };
    const filter = {
      id: 'manual:filter:undo-boundary',
      type: 'filter' as const,
      name: 'Undo boundary filter',
      enabled: true,
      ownership: 'manual' as const,
      operations: [],
    };
    const edge = {
      id: 'manual:edge:undo-boundary',
      sourceNodeId: entry.id,
      sourcePortId: 'bidirect.out',
      targetNodeId: filter.id,
      targetPortId: 'bidirect.in',
      kind: 'bidirect_flow' as const,
      ownership: 'manual' as const,
    };
    const created = await applyRouteGraphWorkspaceOperations({
      revision: workspace.revision,
      operations: [
        { kind: 'upsert_node', node: entry },
        { kind: 'upsert_node', node: filter },
        { kind: 'upsert_edge', edge },
      ],
    });
    const removed = await applyRouteGraphWorkspaceOperations({
      revision: created.revision,
      operations: [{ kind: 'remove_node', nodeId: entry.id }],
    });
    expect((await getRouteGraphDraft()).workingGraph.edges).not.toContainEqual(edge);

    const [removeBatch] = await listRouteGraphWorkspaceOperationBatches();
    expect(removeBatch?.inverseOperations).toEqual([
      { kind: 'upsert_node', node: expect.objectContaining({ id: entry.id, type: 'entry' }) },
      { kind: 'upsert_edge', edge },
    ]);
    await replayRouteGraphWorkspaceOperationBatch({
      id: removed.batchId,
      revision: removed.revision,
      direction: 'undo',
    });
    const restored = (await getRouteGraphDraft()).workingGraph;
    expect(restored.nodes).toContainEqual(expect.objectContaining({ id: entry.id, type: 'entry' }));
    expect(restored.edges).toContainEqual(expect.objectContaining(edge));
  });

  it('discovers ordinary primitive ports in bounded pages and supports incoming-first sessions', async () => {
    const workspace = await getRouteGraphWorkspaceIndexPage();
    const entry = {
      id: 'manual:entry:connection-search', type: 'entry' as const, enabled: true, ownership: 'manual' as const,
      match: { kind: 'model' as const, requestedModelPattern: 'connection-search', displayName: 'Connection search' },
    };
    const filters = ['a', 'b'].map((suffix) => ({
      id: `manual:filter:connection-${suffix}`,
      type: 'filter' as const,
      name: `Filter ${suffix.toUpperCase()}`,
      enabled: true,
      ownership: 'manual' as const,
      operations: [],
    }));
    const created = await applyRouteGraphWorkspaceOperations({
      revision: workspace.revision,
      operations: [
        { kind: 'upsert_node', node: entry },
        ...filters.map((node) => ({ kind: 'upsert_node' as const, node })),
      ],
    });

    const first = await getRouteGraphWorkspaceConnectionTargets({
      source: { element: { kind: 'node', id: entry.id }, portId: 'bidirect.out' },
      limit: 1,
    });
    expect(first.revision).toBe(created.revision);
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.items[0]).toMatchObject({
      elementKind: 'filter',
      focuses: [expect.objectContaining({
        focus: expect.objectContaining({ kind: 'node' }),
        label: expect.any(String),
      })],
      port: { direction: 'input', kind: 'bidirect' },
    });
    const second = await getRouteGraphWorkspaceConnectionTargets({
      source: { element: { kind: 'node', id: entry.id }, portId: 'bidirect.out' },
      cursor: first.nextCursor,
      limit: 1,
    });
    expect(second.items[0]?.endpoint).not.toEqual(first.items[0]?.endpoint);

    const incomingFirst = await getRouteGraphWorkspaceConnectionTargets({
      source: { element: { kind: 'node', id: filters[0]!.id }, portId: 'bidirect.in' },
      query: 'Connection search',
    });
    expect(incomingFirst.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        endpoint: { element: { kind: 'node', id: entry.id }, portId: 'bidirect.out' },
        port: expect.objectContaining({ direction: 'output' }),
      }),
    ]));
  });

  it('atomically rewires a manual edge and reports complete removal impact', async () => {
    const workspace = await getRouteGraphWorkspaceIndexPage();
    const entry = {
      id: 'manual:entry:rewire', type: 'entry' as const, enabled: true, ownership: 'manual' as const,
      match: { kind: 'model' as const, requestedModelPattern: 'rewire', displayName: 'Rewire' },
    };
    const firstFilter = { id: 'manual:filter:rewire-a', type: 'filter' as const, enabled: true, ownership: 'manual' as const, operations: [] };
    const secondFilter = { id: 'manual:filter:rewire-b', type: 'filter' as const, enabled: true, ownership: 'manual' as const, operations: [] };
    const created = await applyRouteGraphWorkspaceOperations({
      revision: workspace.revision,
      operations: [
        { kind: 'upsert_node', node: entry },
        { kind: 'upsert_node', node: firstFilter },
        { kind: 'upsert_node', node: secondFilter },
      ],
    });
    const firstConnection = await createRouteGraphWorkspaceConnection({
      revision: created.revision,
      first: { element: { kind: 'node', id: entry.id }, portId: 'bidirect.out' },
      second: { element: { kind: 'node', id: firstFilter.id }, portId: 'bidirect.in' },
    });
    expect(firstConnection.edge.id).toMatch(/^edge:managed:[0-9a-f-]{36}$/);
    const impact = await getRouteGraphWorkspaceRemovalImpact({
      revision: firstConnection.revision,
      element: { kind: 'node', id: entry.id },
    });
    expect(impact.incidentConnections).toEqual({ total: 1, incoming: 0, outgoing: 1 });

    const rewired = await createRouteGraphWorkspaceConnection({
      revision: firstConnection.revision,
      first: { element: { kind: 'node', id: entry.id }, portId: 'bidirect.out' },
      second: { element: { kind: 'node', id: secondFilter.id }, portId: 'bidirect.in' },
      replacingEdgeId: firstConnection.edge.id,
    });
    const edges = (await getRouteGraphDraft()).workingGraph.edges;
    expect(edges).not.toContainEqual(expect.objectContaining({ id: firstConnection.edge.id }));
    expect(edges).toContainEqual(expect.objectContaining({
      id: rewired.edge.id,
      sourceNodeId: entry.id,
      targetNodeId: secondFilter.id,
    }));
  });

  it('rejects stale target cursors and non-authorable workspace mutations explicitly', async () => {
    const workspace = await getRouteGraphWorkspaceIndexPage();
    const entry = {
      id: 'manual:entry:stale-cursor', type: 'entry' as const, enabled: true, ownership: 'manual' as const,
      match: { kind: 'model' as const, requestedModelPattern: 'stale-cursor', displayName: 'Stale cursor' },
    };
    const filters = ['a', 'b'].map((suffix) => ({
      id: `manual:filter:stale-${suffix}`, type: 'filter' as const, enabled: true, ownership: 'manual' as const, operations: [],
    }));
    const created = await applyRouteGraphWorkspaceOperations({
      revision: workspace.revision,
      operations: [{ kind: 'upsert_node', node: entry }, ...filters.map((node) => ({ kind: 'upsert_node' as const, node }))],
    });
    const page = await getRouteGraphWorkspaceConnectionTargets({
      source: { element: { kind: 'node', id: entry.id }, portId: 'bidirect.out' },
      limit: 1,
    });
    expect(page.nextCursor).toEqual(expect.any(String));
    await applyRouteGraphWorkspaceOperations({
      revision: created.revision,
      operations: [{
        kind: 'upsert_node',
        node: { id: 'manual:filter:stale-c', type: 'filter', enabled: true, ownership: 'manual', operations: [] },
      }],
    });
    await expect(getRouteGraphWorkspaceConnectionTargets({
      source: { element: { kind: 'node', id: entry.id }, portId: 'bidirect.out' },
      cursor: page.nextCursor,
      limit: 1,
    })).rejects.toMatchObject({ code: 'invalid_connection_cursor' });

    const systemGraph = {
      nodes: [{ id: 'system:filter', type: 'filter' as const, enabled: true, ownership: 'system' as const, operations: [] }],
      macros: [],
      edges: [],
    };
    expect(() => applyRouteGraphWorkspaceOperationsToGraph(systemGraph, [
      { kind: 'remove_node', nodeId: 'system:filter' },
    ])).toThrow(expect.objectContaining({ code: 'element_not_authorable' }));
    expect(() => applyRouteGraphWorkspaceOperationsToGraph(systemGraph, [
      { kind: 'remove_edge', edgeId: 'missing-edge' },
    ])).toThrow(expect.objectContaining({ code: 'edge_not_found' }));
  });
});
