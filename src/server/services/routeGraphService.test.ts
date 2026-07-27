import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import {
  getExecutionTargetIdForMember,
  insertRouteGroupMember,
} from '../../testing/routeGroupMemberTestUtils.js';

type DbModule = typeof import('../db/index.js');
type RouteGroupManagementModule = typeof import('./routeGroupManagementService.js');
type RouteGroupGraphTestHarnessModule = typeof import('../test/routeGroupGraphTestHarness.js');
type RouteGraphServiceModule = typeof import('./routeGraphService.js');
type RouteRuntimeArtifactModule = typeof import('./routeRuntimeArtifactService.js');
type AccountRetirementModule = typeof import('./accountRetirementService.js');
type RouteGroupManagementCatalogRevisionModule = typeof import('./routeGroupManagementCatalogRevisionService.js');

describe('routeGraphService graph-native route runtime', () => {
  const execFileAsync = promisify(execFile);
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let createRouteGroupFromPayload: RouteGroupManagementModule['createRouteGroupFromPayload'];
  let updateRouteGroupFromPayload: RouteGroupManagementModule['updateRouteGroupFromPayload'];
  let buildRouteGraphSourceFromRouteGroups: () => Promise<NonNullable<Awaited<ReturnType<RouteGroupGraphTestHarnessModule['publishRouteGroupGraphForTest']>>['sourceGraph']>>;
  let publishRouteGraphSource: RouteGraphServiceModule['publishRouteGraphSource'];
  let getActiveRouteGraphVersion: RouteGraphServiceModule['getActiveRouteGraphVersion'];
  let getRouteGraphDraft: RouteGraphServiceModule['getRouteGraphDraft'];
  let saveRouteGraphDraft: RouteGraphServiceModule['saveRouteGraphDraft'];
  let publishRouteGraphDraft: RouteGraphServiceModule['publishRouteGraphDraft'];
  let validateRouteGraphDraft: RouteGraphServiceModule['validateRouteGraphDraft'];
  let hashRouteGraphSource: RouteGraphServiceModule['hashRouteGraphSource'];
  let getActiveRouteRuntimeArtifact: RouteRuntimeArtifactModule['getActiveRouteRuntimeArtifact'];
  let invalidateRouteRuntimeArtifactReadCaches: RouteRuntimeArtifactModule['invalidateRouteRuntimeArtifactReadCaches'];
  let retireAccountFromRouting: AccountRetirementModule['retireAccountFromRouting'];
  let loadRouteGroupManagementCatalogRevision: RouteGroupManagementCatalogRevisionModule['loadRouteGroupManagementCatalogRevision'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-route-graph-service-'));
    process.env.DATA_DIR = dataDir;

    const migrate = await import('../db/migrate.js');
    await migrate.runSqliteMigrations();
    const dbModule = await import('../db/index.js');
    const routeGroupManagement = await import('./routeGroupManagementService.js');
    const routeGroupGraphTestHarness = await import('../test/routeGroupGraphTestHarness.js');
    const routeGraphService = await import('./routeGraphService.js');
    const routeRuntimeArtifact = await import('./routeRuntimeArtifactService.js');
    const accountRetirement = await import('./accountRetirementService.js');
    const routeGroupManagementCatalogRevision = await import('./routeGroupManagementCatalogRevisionService.js');

    db = dbModule.db;
    schema = dbModule.schema;
    createRouteGroupFromPayload = routeGroupManagement.createRouteGroupFromPayload;
    updateRouteGroupFromPayload = routeGroupManagement.updateRouteGroupFromPayload;
    buildRouteGraphSourceFromRouteGroups = async () => (
      await routeGroupGraphTestHarness.publishRouteGroupGraphForTest('route-graph-service-test')
    ).sourceGraph;
    publishRouteGraphSource = routeGraphService.publishRouteGraphSource;
    getActiveRouteGraphVersion = routeGraphService.getActiveRouteGraphVersion;
    getRouteGraphDraft = routeGraphService.getRouteGraphDraft;
    saveRouteGraphDraft = routeGraphService.saveRouteGraphDraft;
    publishRouteGraphDraft = routeGraphService.publishRouteGraphDraft;
    validateRouteGraphDraft = routeGraphService.validateRouteGraphDraft;
    hashRouteGraphSource = routeGraphService.hashRouteGraphSource;
    getActiveRouteRuntimeArtifact = routeRuntimeArtifact.getActiveRouteRuntimeArtifact;
    invalidateRouteRuntimeArtifactReadCaches = routeRuntimeArtifact.invalidateRouteRuntimeArtifactReadCaches;
    retireAccountFromRouting = accountRetirement.retireAccountFromRouting;
    loadRouteGroupManagementCatalogRevision = routeGroupManagementCatalogRevision.loadRouteGroupManagementCatalogRevision;
  }, 60_000);

  beforeEach(async () => {
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.compiledRuntimeActiveArtifact).run();
    await db.delete(schema.compiledRuntimeArtifacts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.tokenModelAvailability).run();
    await db.delete(schema.modelAvailability).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  it('hashes canonical source content instead of encoding storage version identity', () => {
    const first = hashRouteGraphSource({
      nodes: [],
      edges: [],
      macros: [],
      metadata: { beta: 2, alpha: 1 },
    });
    const reordered = hashRouteGraphSource({
      nodes: [],
      edges: [],
      macros: [],
      metadata: { alpha: 1, beta: 2 },
    });
    const changed = hashRouteGraphSource({
      nodes: [],
      edges: [],
      macros: [],
      metadata: { alpha: 1, beta: 3 },
    });
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });

  afterAll(() => {
    delete process.env.DATA_DIR;
  });

  async function seedAccountToken(modelName: string) {
    const site = await db.insert(schema.sites).values({
      name: `site-${modelName}`,
      url: `https://${modelName}.example.test`,
      platform: 'openai',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      accessToken: `access-${modelName}`,
      status: 'active',
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: `token-${modelName}`,
      token: `sk-${modelName}`,
      enabled: true,
      isDefault: true,
    }).returning().get();
    return { account, token };
  }

  async function createGroup(modelName: string) {
    return await createRouteGroupFromPayload({
      model: {
        publicName: modelName,
        upstreamName: modelName,
      },
      presentation: {
        displayName: null,
        displayIcon: null,
      },
      dispatcherPolicy: { kind: 'builtin', builtin: 'weighted' },
      enabled: true,
    });
  }

  it('reads an unpublished draft without creating or activating a graph version', async () => {
    const draft = await getRouteGraphDraft();

    expect(draft).toMatchObject({
      id: 0,
      baseVersion: null,
      revision: 0,
      status: 'unpublished',
      workingGraph: { nodes: [], edges: [], macros: [] },
    });
    expect(await getActiveRouteGraphVersion()).toBeNull();
    expect(await db.select().from(schema.routeGraphVersions).all()).toEqual([]);
  });

  it('projects route groups into route graph source without route-table identifiers', async () => {
    const { account, token } = await seedAccountToken('gpt-clean');
    const group = await createGroup('gpt-clean');

    await insertRouteGroupMember({
      groupId: group.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: 'gpt-clean',
      enabled: true,
    });

    const graph = await buildRouteGraphSourceFromRouteGroups();
    const graphJson = JSON.stringify(graph);
    expect(graphJson).not.toContain('entry:legacy');
    expect(graphJson).not.toContain('sourceRouteIds');
    expect(graphJson).not.toContain('legacyRouteId');
    expect(graphJson).not.toContain('route_group_projection');
    expect(graphJson).not.toContain('access-gpt-clean');
    expect(graphJson).not.toContain('sk-gpt-clean');
    expect(graph.macros).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: group.id,
        kind: 'candidate_selector',
      }),
    ]));
    expect(graph.nodes.some((node) => String(node.id).startsWith('route-endpoint:product:'))).toBe(false);
    const executionTarget = graph.nodes.find((node) => (
      node.type === 'route_endpoint' && node.endpointKind === 'supply'
    )) as any;
    expect(executionTarget?.metadata).toEqual({
      upstreamModel: 'gpt-clean',
      normalizedModel: 'gpt-clean',
    });
    expect(executionTarget?.config?.targets).toEqual([
      expect.objectContaining({
        transportBinding: {
          kind: 'execution_target',
          executionTargetId: expect.any(Number),
        },
      }),
    ]);
  });

  it('applies management configuration directly to its source Graph macro', async () => {
    const { account, token } = await seedAccountToken('deepseek-auto');
    const group = await createGroup('deepseek-auto');
    await insertRouteGroupMember({
      groupId: group.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: 'deepseek-auto',
      enabled: true,
    });

    await updateRouteGroupFromPayload(group.id, {
      presentation: { displayName: 'malicious-name', displayIcon: 'brand:deepseek' },
      visibility: 'internal',
      enabled: false,
      dispatcherPolicy: { kind: 'builtin', builtin: 'round_robin' },
      filters: {
        operations: [
          { type: 'set_header', name: 'x-route-override', value: '1', mode: 'override' },
        ],
      },
    });

    const graph = await buildRouteGraphSourceFromRouteGroups();
    const macro = graph.macros.find((item) => item.id === group.id);
    expect(macro?.name).toBe('malicious-name');
    expect(macro?.config.filters).toEqual({
      operations: [
        { type: 'set_header', name: 'x-route-override', value: '1', mode: 'override' },
      ],
    });
    expect(macro?.config.policy).toEqual({ kind: 'builtin', builtin: 'round_robin' });
    expect(macro).not.toHaveProperty('visibility');
    expect(macro?.config.surface.entry).toEqual({ kind: 'none' });

    await updateRouteGroupFromPayload(group.id, { visibility: 'public' });
    const repatched = await buildRouteGraphSourceFromRouteGroups();
    expect(repatched.macros.find((item) => item.id === group.id)?.config.surface.entry)
      .toMatchObject({ kind: 'external' });
  });

  it('rejects removed policy and priority shapes before graph normalization', async () => {
    const sourceGraph = {
      nodes: [
        {
          id: 'dispatcher:legacy-policy',
          type: 'dispatcher',
          policy: { strategy: 'weighted' },
        },
        {
          id: 'route-endpoint:legacy-policy',
          type: 'route_endpoint',
          config: {
            targets: [],
            targetSelection: { strategy: 'defer_to_router' },
          },
        },
      ],
      edges: [],
      macros: [
        {
          id: 'macro:legacy-policy',
          kind: 'candidate_selector',
          config: {
            policy: { strategy: 'weighted' },
            groups: [{
              id: 'stage:legacy-priority',
              priority: 0,
              input: { kind: 'route_endpoints', endpointIds: [] },
            }],
          },
        },
      ],
    };

    const validation = await validateRouteGraphDraft(sourceGraph);
    expect(validation.ok).toBe(false);
    expect(validation.diagnostics.filter((diagnostic) => diagnostic.code === 'route_graph.native_policy'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ message: 'Invalid dispatcher policy. Legacy strategy policies are not supported.' }),
        expect.objectContaining({ message: 'Invalid target selection policy. Legacy strategy policies are not supported.' }),
        expect.objectContaining({ message: 'Invalid macro dispatcher policy. Legacy strategy policies are not supported.' }),
        expect.objectContaining({ message: 'Invalid fallback stage. Use array order instead of priority.' }),
      ]));

    const published = await publishRouteGraphSource({
      sourceGraph,
      createdBy: 'test',
      allowDiagnostics: true,
    });
    expect(published).toMatchObject({ ok: false });
    expect(await db.select().from(schema.routeGraphVersions).all()).toEqual([]);
  });

  it('publishes a compiled runtime artifact from graph-native route groups', async () => {
    const { account, token } = await seedAccountToken('claude-clean');
    const group = await createGroup('claude-clean');

    await insertRouteGroupMember({
      groupId: group.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: 'claude-clean',
      enabled: true,
    });

    const graph = await buildRouteGraphSourceFromRouteGroups();
    const published = await publishRouteGraphSource({
      sourceGraph: graph,
      createdBy: 'test',
      allowDiagnostics: true,
    });
    expect(published.ok).toBe(true);

    const runtime = await getActiveRouteRuntimeArtifact();
    expect(runtime?.compiledGraph.compiledRouterBundle?.plans.length).toBeGreaterThan(0);
    const runtimeJson = JSON.stringify(runtime?.compiledGraph);
    expect(runtimeJson).not.toContain('entry:legacy');
    expect(runtimeJson).not.toContain('sourceRouteIds');
    expect(runtimeJson).not.toContain('legacyRouteId');
    expect(runtimeJson).not.toContain('sourceRef');
  });

  it('rejects publication when a compiled transport binding no longer exists', async () => {
    const { account, token } = await seedAccountToken('missing-runtime-binding');
    const group = await createGroup('missing-runtime-binding');
    const member = await insertRouteGroupMember({
      groupId: group.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: 'missing-runtime-binding',
      enabled: true,
    });
    const sourceGraph = await buildRouteGraphSourceFromRouteGroups();
    const executionTargetId = await getExecutionTargetIdForMember(member.id);
    expect(executionTargetId).toBeTruthy();
    const pointerBefore = await db.select().from(schema.compiledRuntimeActiveArtifact).get();
    await db.delete(schema.runtimeExecutionTargets)
      .where(eq(schema.runtimeExecutionTargets.id, executionTargetId!))
      .run();

    await expect(publishRouteGraphSource({ sourceGraph, createdBy: 'test' }))
      .rejects.toThrow(/execution_target_not_found/);
    expect(await db.select().from(schema.compiledRuntimeActiveArtifact).get()).toEqual(pointerBefore);
  });

  it('rejects publication when compiled and persisted credential bindings disagree', async () => {
    const { account, token } = await seedAccountToken('mismatched-runtime-binding');
    const group = await createGroup('mismatched-runtime-binding');
    const member = await insertRouteGroupMember({
      groupId: group.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: 'mismatched-runtime-binding',
      enabled: true,
    });
    const sourceGraph = await buildRouteGraphSourceFromRouteGroups();
    const executionTargetId = await getExecutionTargetIdForMember(member.id);
    expect(executionTargetId).toBeTruthy();
    const otherAccount = await db.insert(schema.accounts).values({
      siteId: account.siteId,
      username: 'binding-mismatch-account',
      accessToken: 'binding-mismatch-access',
      status: 'active',
    }).returning().get();
    await db.update(schema.runtimeExecutionTargets)
      .set({ accountId: otherAccount.id })
      .where(eq(schema.runtimeExecutionTargets.id, executionTargetId!))
      .run();

    await expect(publishRouteGraphSource({ sourceGraph, createdBy: 'test' }))
      .rejects.toThrow(/token_account_binding_mismatch/);
  });

  it('publishes a draft and advances its exact revision in one write boundary', async () => {
    const initial = await publishRouteGraphSource({
      sourceGraph: { nodes: [], edges: [], macros: [] },
      createdBy: 'test',
      allowDiagnostics: true,
    });
    expect(initial.ok).toBe(true);
    const saved = await saveRouteGraphDraft({ nodes: [], edges: [], macros: [] });

    const published = await publishRouteGraphDraft();

    expect(published.ok).toBe(true);
    const draft = await db.select().from(schema.routeGraphDrafts)
      .where(eq(schema.routeGraphDrafts.id, saved.id)).get();
    expect(draft).toMatchObject({
      status: 'published',
      revision: saved.revision + 1,
    });
    const pointer = await db.select().from(schema.routeGraphActiveVersion)
      .where(eq(schema.routeGraphActiveVersion.id, 1)).get();
    expect(pointer?.versionId).toBe(published.ok ? published.version.id : null);
  });

  it('rolls back source version, runtime artifact and both active pointers when pointer swap fails', async () => {
    const initial = await publishRouteGraphSource({
      sourceGraph: { nodes: [], edges: [], macros: [], metadata: { publication: 'initial' } },
      createdBy: 'atomic-publication-test',
      allowDiagnostics: true,
    });
    expect(initial.ok).toBe(true);

    const before = {
      versions: await db.select().from(schema.routeGraphVersions).all(),
      artifacts: await db.select().from(schema.compiledRuntimeArtifacts).all(),
      graphPointer: await db.select().from(schema.routeGraphActiveVersion).get(),
      runtimePointer: await db.select().from(schema.compiledRuntimeActiveArtifact).get(),
    };

    await db.run(sql.raw(`
      CREATE TRIGGER fail_route_graph_pointer_swap
      BEFORE UPDATE ON route_graph_active_version
      BEGIN
        SELECT RAISE(ABORT, 'injected active pointer failure');
      END
    `));
    try {
      await expect(publishRouteGraphSource({
        sourceGraph: { nodes: [], edges: [], macros: [], metadata: { publication: 'must-rollback' } },
        createdBy: 'atomic-publication-test',
        allowDiagnostics: true,
      })).rejects.toThrow(/route_graph_active_version/);
    } finally {
      await db.run(sql.raw('DROP TRIGGER IF EXISTS fail_route_graph_pointer_swap'));
    }

    expect(await db.select().from(schema.routeGraphVersions).all()).toEqual(before.versions);
    expect(await db.select().from(schema.compiledRuntimeArtifacts).all()).toEqual(before.artifacts);
    expect(await db.select().from(schema.routeGraphActiveVersion).get()).toEqual(before.graphPointer);
    expect(await db.select().from(schema.compiledRuntimeActiveArtifact).get()).toEqual(before.runtimePointer);
    expect((await db.select().from(schema.routeGraphVersions).all()).filter((row: { status: string }) => row.status === 'active')).toHaveLength(1);
  });

  it('rolls back account retirement and Graph target pruning when publication fails', async () => {
    const { account, token } = await seedAccountToken('retirement-rollback');
    const group = await createGroup('retirement-rollback');
    const member = await insertRouteGroupMember({
      groupId: group.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: 'retirement-rollback',
      enabled: true,
    });
    const executionTargetId = await getExecutionTargetIdForMember(member.id);
    expect(executionTargetId).toBeTruthy();

    const before = {
      account: await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)).get(),
      token: await db.select().from(schema.accountTokens).where(eq(schema.accountTokens.id, token.id)).get(),
      target: await db.select().from(schema.runtimeExecutionTargets)
        .where(eq(schema.runtimeExecutionTargets.id, executionTargetId!)).get(),
      revision: await loadRouteGroupManagementCatalogRevision(),
      versions: await db.select().from(schema.routeGraphVersions).all(),
      artifacts: await db.select().from(schema.compiledRuntimeArtifacts).all(),
      graphPointer: await db.select().from(schema.routeGraphActiveVersion).get(),
      runtimePointer: await db.select().from(schema.compiledRuntimeActiveArtifact).get(),
    };

    await db.run(sql.raw(`
      CREATE TRIGGER fail_account_retirement_pointer_swap
      BEFORE UPDATE ON route_graph_active_version
      BEGIN
        SELECT RAISE(ABORT, 'injected account retirement publication failure');
      END
    `));
    try {
      await expect(retireAccountFromRouting(account.id, 'account-retirement-rollback-test'))
        .rejects.toThrow(/route_graph_active_version/);
    } finally {
      await db.run(sql.raw('DROP TRIGGER IF EXISTS fail_account_retirement_pointer_swap'));
    }

    expect(await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)).get())
      .toEqual(before.account);
    expect(await db.select().from(schema.accountTokens).where(eq(schema.accountTokens.id, token.id)).get())
      .toEqual(before.token);
    expect(await db.select().from(schema.runtimeExecutionTargets)
      .where(eq(schema.runtimeExecutionTargets.id, executionTargetId!)).get())
      .toEqual(before.target);
    expect(await loadRouteGroupManagementCatalogRevision()).toBe(before.revision);
    expect(await db.select().from(schema.routeGraphVersions).all()).toEqual(before.versions);
    expect(await db.select().from(schema.compiledRuntimeArtifacts).all()).toEqual(before.artifacts);
    expect(await db.select().from(schema.routeGraphActiveVersion).get()).toEqual(before.graphPointer);
    expect(await db.select().from(schema.compiledRuntimeActiveArtifact).get()).toEqual(before.runtimePointer);
  });

  it('keeps Graph and compiled-runtime pointers consistent across independent publisher processes', async () => {
    const initial = await publishRouteGraphSource({
      sourceGraph: { nodes: [], edges: [], macros: [], metadata: { publication: 'multi-process-base' } },
      createdBy: 'multi-process-test',
      allowDiagnostics: true,
    });
    expect(initial.ok).toBe(true);

    const barrierPath = join(dataDir, 'route-publication.barrier');
    const workerPath = new URL('../../testing/routeGraphPublicationWorker.ts', import.meta.url);
    const environment = {
      ...process.env,
      DATA_DIR: dataDir,
      DB_TYPE: 'sqlite',
      DB_URL: '',
    };
    const first = execFileAsync(process.execPath, [
      '--import', 'tsx', workerPath.pathname, 'publisher-a', barrierPath,
    ], { cwd: process.cwd(), env: environment, timeout: 20_000 });
    const second = execFileAsync(process.execPath, [
      '--import', 'tsx', workerPath.pathname, 'publisher-b', barrierPath,
    ], { cwd: process.cwd(), env: environment, timeout: 20_000 });
    writeFileSync(barrierPath, 'go');

    const outcomes = await Promise.all([first, second]);
    const results = outcomes.map(({ stdout }) => JSON.parse(stdout) as { ok: boolean; label: string });
    expect(results.some((result) => result.ok)).toBe(true);

    const graphPointer = await db.select().from(schema.routeGraphActiveVersion).get();
    const runtimePointer = await db.select().from(schema.compiledRuntimeActiveArtifact).get();
    expect(graphPointer).toBeTruthy();
    expect(runtimePointer).toBeTruthy();
    const activeArtifact = await db.select().from(schema.compiledRuntimeArtifacts)
      .where(eq(schema.compiledRuntimeArtifacts.id, runtimePointer!.artifactId)).get();
    expect(activeArtifact?.sourceGraphVersionId).toBe(graphPointer!.versionId);

    const versions = await db.select().from(schema.routeGraphVersions).all();
    expect(versions.filter((row: { status: string }) => row.status === 'active')).toEqual([
      expect.objectContaining({ id: graphPointer!.versionId }),
    ]);
    const artifacts = await db.select().from(schema.compiledRuntimeArtifacts).all();
    expect(artifacts.every((artifact: { sourceGraphVersionId: number | null }) => (
      artifact.sourceGraphVersionId == null
      || versions.some((version: { id: number }) => version.id === artifact.sourceGraphVersionId)
    ))).toBe(true);
  }, 30_000);

  it('reads the published artifact without recompiling the stored source graph', async () => {
    const { account, token } = await seedAccountToken('artifact-only-read');
    const group = await createGroup('artifact-only-read');
    await insertRouteGroupMember({
      groupId: group.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: 'artifact-only-read',
      enabled: true,
    });
    const published = await publishRouteGraphSource({
      sourceGraph: await buildRouteGraphSourceFromRouteGroups(),
      createdBy: 'test',
      allowDiagnostics: true,
    });
    expect(published.ok).toBe(true);

    await db.update(schema.routeGraphVersions).set({
      sourceGraphJson: JSON.stringify({ nodes: [], edges: [] }),
    }).where(eq(schema.routeGraphVersions.id, published.version.id)).run();
    invalidateRouteRuntimeArtifactReadCaches();

    await expect(getActiveRouteGraphVersion()).resolves.toMatchObject({
      id: published.version.id,
      compiledGraph: {
        compiledRouterBundle: expect.any(Object),
      },
    });
  });

  it('does not turn corrupted active runtime storage into an empty runtime artifact', async () => {
    const { account, token } = await seedAccountToken('corrupt-runtime');
    const group = await createGroup('corrupt-runtime');

    await insertRouteGroupMember({
      groupId: group.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: 'corrupt-runtime',
      enabled: true,
    });

    const graph = await buildRouteGraphSourceFromRouteGroups();
    const published = await publishRouteGraphSource({
      sourceGraph: graph,
      createdBy: 'test',
      allowDiagnostics: true,
    });
    expect(published.ok).toBe(true);

    await db.update(schema.routeGraphVersions).set({
      sourceGraphJson: '{bad-source-json',
    }).where(eq(schema.routeGraphVersions.id, published.version.id)).run();
    await db.update(schema.compiledRuntimeArtifacts).set({
      artifactJson: '{bad-runtime-json',
    }).where(eq(schema.compiledRuntimeArtifacts.sourceGraphVersionId, published.version.id)).run();
    invalidateRouteRuntimeArtifactReadCaches();

    await expect(getActiveRouteRuntimeArtifact()).rejects.toThrow(/Route runtime artifact .* is invalid/);
  });
});
