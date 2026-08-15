import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { parseRouteGraphSource } from '../../shared/routeGraph.js';
import { executionTargetIdForRouteGraphEndpoint } from './routeGraphExecutionTargetEndpointService.js';
import { insertRouteGroupMember, listAllRouteGroupMembers } from '../../testing/routeGroupMemberTestUtils.js';

type DbModule = typeof import('../db/index.js');
type BackupServiceModule = typeof import('./backupService.js');
type RouteGroupManagementModule = typeof import('./routeGroupManagementService.js');
type RouteGroupManagementReadModelModule = typeof import('./routeGroupManagementReadModelService.js');
type RouteSummaryProjectionModule = typeof import('./routeSummaryProjectionService.js');
type RouteGroupGraphTestHarnessModule = typeof import('../test/routeGroupGraphTestHarness.js');
type RouteGraphServiceModule = typeof import('./routeGraphService.js');
type ModelsMarketplaceCacheModule = typeof import('./modelsMarketplaceCacheService.js');
type RouteRuntimeArtifactModule = typeof import('./routeRuntimeArtifactService.js');

function sourceGraphEndpointIdForExecutionTarget(sourceGraphJson: string | null | undefined, executionTargetId: number): string | null {
  const endpoint = parseRouteGraphSource(sourceGraphJson).nodes.find((node) => node.type === 'route_endpoint' && executionTargetIdForRouteGraphEndpoint(node) === executionTargetId);
  return endpoint?.type === 'route_endpoint' ? endpoint.routeEndpointId : null;
}

describe('backupService graph-native route runtime', () => {
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let backupService: BackupServiceModule;
  let createRouteGroupFromPayload: RouteGroupManagementModule['createRouteGroupFromPayload'];
  let loadRouteGroupManagementReadModel: RouteGroupManagementReadModelModule['loadRouteGroupManagementReadModel'];
  let buildRouteSummaryProjectionPage: RouteSummaryProjectionModule['buildRouteSummaryProjectionPage'];
  let buildRouteSummaryProjectionOverview: RouteSummaryProjectionModule['buildRouteSummaryProjectionOverview'];
  let publishRouteGroupGraphForTest: RouteGroupGraphTestHarnessModule['publishRouteGroupGraphForTest'];
  let publishRouteGraphSource: RouteGraphServiceModule['publishRouteGraphSource'];
  let readModelsMarketplaceCache: ModelsMarketplaceCacheModule['readModelsMarketplaceCache'];
  let writeModelsMarketplaceCache: ModelsMarketplaceCacheModule['writeModelsMarketplaceCache'];
  let getActiveRouteRuntimeArtifact: RouteRuntimeArtifactModule['getActiveRouteRuntimeArtifact'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-backup-service-'));
    process.env.DATA_DIR = dataDir;

    const migrateModule = await import('../db/migrate.js');
    await migrateModule.runSqliteMigrations();
    const dbModule = await import('../db/index.js');
    backupService = await import('./backupService.js');
    const routeGroupManagement = await import('./routeGroupManagementService.js');
    const routeGroupManagementReadModel = await import('./routeGroupManagementReadModelService.js');
    const routeSummaryProjection = await import('./routeSummaryProjectionService.js');
    const routeGroupGraphTestHarness = await import('../test/routeGroupGraphTestHarness.js');
    const routeGraphService = await import('./routeGraphService.js');
    const modelsMarketplaceCache = await import('./modelsMarketplaceCacheService.js');
    const routeRuntimeArtifact = await import('./routeRuntimeArtifactService.js');

    db = dbModule.db;
    schema = dbModule.schema;
    createRouteGroupFromPayload = routeGroupManagement.createRouteGroupFromPayload;
    loadRouteGroupManagementReadModel = routeGroupManagementReadModel.loadRouteGroupManagementReadModel;
    buildRouteSummaryProjectionPage = routeSummaryProjection.buildRouteSummaryProjectionPage;
    buildRouteSummaryProjectionOverview = routeSummaryProjection.buildRouteSummaryProjectionOverview;
    publishRouteGroupGraphForTest = routeGroupGraphTestHarness.publishRouteGroupGraphForTest;
    publishRouteGraphSource = routeGraphService.publishRouteGraphSource;
    readModelsMarketplaceCache = modelsMarketplaceCache.readModelsMarketplaceCache;
    writeModelsMarketplaceCache = modelsMarketplaceCache.writeModelsMarketplaceCache;
    getActiveRouteRuntimeArtifact = routeRuntimeArtifact.getActiveRouteRuntimeArtifact;
  });

  beforeEach(async () => {
    await db.delete(schema.proxyLogs).run();
    await db.delete(schema.proxyDebugAttempts).run();
    await db.delete(schema.proxyDebugTraces).run();
    await db.delete(schema.downstreamApiKeys).run();
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
    await db.delete(schema.settings).run();
  });

  afterAll(() => {
    delete process.env.DATA_DIR;
  });

  async function seedRouteRuntime() {
    const site = await db
      .insert(schema.sites)
      .values({
        name: 'backup-site',
        url: 'https://backup.example.test',
        platform: 'openai',
        status: 'active',
      })
      .returning()
      .get();
    const account = await db
      .insert(schema.accounts)
      .values({
        siteId: site.id,
        username: 'backup-user',
        credential: 'backup-access',
        status: 'active',
      })
      .returning()
      .get();
    const token = await db
      .insert(schema.accountTokens)
      .values({
        accountId: account.id,
        name: 'backup-token',
        token: 'sk-backup',
        enabled: true,
        isDefault: true,
      })
      .returning()
      .get();

    const summary = await createRouteGroupFromPayload({
      model: { publicName: 'backup-model' },
      endpointIds: [],
      presentation: {
        displayName: null,
        displayIcon: null,
      },
      dispatcherPolicy: { kind: 'builtin', builtin: 'weighted' },
      enabled: true,
    });
    await insertRouteGroupMember({
      groupId: summary.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: 'backup-model',
      enabled: true,
    });

    const published = await publishRouteGroupGraphForTest('backup-test');
    expect(published.status).toBe('active');

    return { site, account, token, group: summary };
  }

  it('exports current route runtime tables and graph artifact', async () => {
    const seeded = await seedRouteRuntime();
    const backup = (await backupService.exportBackup('accounts')) as any;

    expect(backup.accounts.sites).toHaveLength(1);
    expect(backup.accounts.accounts).toHaveLength(1);
    expect(backup.accounts.accountTokens).toHaveLength(1);
    expect(backup.accounts).not.toHaveProperty('routeGroups');
    expect(backup.accounts).not.toHaveProperty('routeGraphExecutionTargetBindings');
    expect(backup.accounts).not.toHaveProperty('proxyLogs');
    expect(backup.accounts.runtimeExecutionTargets.length).toBeGreaterThan(0);
    expect(backup.accounts.routeGraph.versions.length).toBeGreaterThan(0);
    expect(backup.accounts.routeGraph.activeVersion.versionId).toBeGreaterThan(0);
    expect(
      backup.accounts.routeGraph.versions.some((version: { sourceGraphJson?: string | null }) => parseRouteGraphSource(version.sourceGraphJson).macros.some((macro) => macro.id === seeded.group.id)),
    ).toBe(true);
  });

  it('excludes unbounded proxy history and preserves local history on import', async () => {
    const { account } = await seedRouteRuntime();
    await db
      .insert(schema.proxyLogs)
      .values({
        accountId: account.id,
        status: 'success',
        modelRequested: 'backup-model',
        billingDetails: 'x'.repeat(1_000_000),
      })
      .run();

    const exported = (await backupService.exportBackup('accounts')) as any;
    expect(exported.accounts).not.toHaveProperty('proxyLogs');

    const beforeImport = await db.select().from(schema.proxyLogs).all();
    await backupService.importBackup(exported);
    expect(await db.select().from(schema.proxyLogs).all()).toEqual(beforeImport);
  });

  it('imports current route runtime backup data without legacy route storage', async () => {
    await seedRouteRuntime();
    const exported = (await backupService.exportBackup('accounts')) as any;

    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.compiledRuntimeActiveArtifact).run();
    await db.delete(schema.compiledRuntimeArtifacts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();

    const result = await backupService.importBackup(exported);
    expect(result).toMatchObject({
      allImported: true,
      sections: { accounts: true },
    });
    expect(await loadRouteGroupManagementReadModel()).toHaveLength(1);
    expect(await listAllRouteGroupMembers()).toHaveLength(1);
    const importedVersions = await db.select().from(schema.routeGraphVersions).all();
    expect(importedVersions.length).toBeGreaterThanOrEqual(exported.accounts.routeGraph.versions.length);
    const activeVersion = await db.select().from(schema.routeGraphActiveVersion).get();
    expect(activeVersion).toBeTruthy();
    expect(await getActiveRouteRuntimeArtifact()).toMatchObject({
      artifactId: expect.any(String),
      provenance: { sourceGraphVersionId: activeVersion?.versionId },
    });
    expect(typeof exported.version).toBe('string');
  });

  it('rolls back account replacement when imported route graph publication fails', async () => {
    const seeded = await seedRouteRuntime();
    const exported = (await backupService.exportBackup('accounts')) as any;
    const originalSite = await db.select().from(schema.sites).where(eq(schema.sites.id, seeded.site.id)).get();
    const originalTokens = await db.select().from(schema.accountTokens).where(eq(schema.accountTokens.accountId, seeded.account.id)).all();
    const activeVersion = exported.accounts.routeGraph.activeVersion.versionId;
    const version = exported.accounts.routeGraph.versions.find((row: any) => row.id === activeVersion);
    version.sourceGraphJson = JSON.stringify({
      nodes: [],
      edges: [],
      macros: [
        {
          id: 'macro:invalid-import',
          kind: 'candidate_selector',
          ownership: 'system',
          config: {
            candidateSource: { kind: 'model_pattern', pattern: 'model-*' },
            groups: [],
          },
        },
      ],
    });
    exported.accounts.sites[0].name = 'must-not-commit';

    await expect(backupService.importBackup(exported)).rejects.toThrow('导入的历史路由无法编译');
    expect(await db.select().from(schema.sites).where(eq(schema.sites.id, seeded.site.id)).get()).toEqual(originalSite);
    expect(await db.select().from(schema.accountTokens).where(eq(schema.accountTokens.accountId, seeded.account.id)).all()).toEqual(originalTokens);
  });

  it('preserves every account token across a multi-batch streaming import', async () => {
    const seeded = await seedRouteRuntime();
    const exported = (await backupService.exportBackup('accounts')) as any;
    const tokenCount = 250;
    exported.accounts.accountTokens = Array.from({ length: tokenCount }, (_, index) => ({
      ...exported.accounts.accountTokens[0],
      id: seeded.token.id + index,
      name: `stream-token-${index + 1}`,
      token: `sk-stream-${index + 1}`,
      isDefault: index === 0,
    }));

    const payload = JSON.stringify(exported);
    const result = await backupService.importBackupFromJsonStream(Readable.from([payload]), Buffer.byteLength(payload) + 1);

    expect(result).toMatchObject({
      allImported: true,
      sections: { accounts: true },
    });
    const imported = await db.select().from(schema.accountTokens).where(eq(schema.accountTokens.accountId, seeded.account.id)).all();
    expect(imported).toHaveLength(tokenCount);
    expect(new Set(imported.map((token) => token.id)).size).toBe(tokenCount);
    expect(new Set(imported.map((token) => token.token)).size).toBe(tokenCount);
  });

  it('normalizes explicitly marked API key connections from historical backups', async () => {
    const payload = {
      version: '2.3',
      timestamp: Date.now(),
      type: 'accounts',
      accounts: {
        sites: [
          {
            id: 1,
            name: 'legacy-api-key-site',
            url: 'https://legacy-api-key.example.test',
            platform: 'new-api',
            status: 'active',
          },
        ],
        accounts: [
          {
            id: 1,
            siteId: 1,
            username: 'legacy-api-key',
            accessToken: 'legacy-api-key-value',
            apiToken: null,
            status: 'active',
            checkinEnabled: true,
            extraConfig: JSON.stringify({ credentialMode: 'apikey' }),
          },
          {
            id: 2,
            siteId: 1,
            username: 'legacy-auth-type-api-key',
            accessToken: 'legacy-auth-type-api-key-value',
            apiToken: null,
            status: 'active',
            checkinEnabled: true,
            extraConfig: JSON.stringify({ authType: 'api_key' }),
          },
          {
            id: 3,
            siteId: 1,
            username: 'session-account',
            accessToken: 'session-value',
            apiToken: 'session-default-api-key',
            status: 'active',
            checkinEnabled: true,
            extraConfig: JSON.stringify({ credentialMode: 'session' }),
          },
        ],
        accountTokens: [],
      },
    };

    await backupService.importBackup(payload as any);

    const accounts = await db.select().from(schema.accounts).orderBy(schema.accounts.id).all();
    expect(accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          username: 'legacy-api-key',
          credentialMode: 'apikey',
          credential: '',
          credentialKind: 'none',
          checkinEnabled: false,
        }),
        expect.objectContaining({
          username: 'legacy-auth-type-api-key',
          credentialMode: 'apikey',
          credential: '',
          credentialKind: 'none',
          checkinEnabled: false,
        }),
        expect.objectContaining({
          username: 'session-account',
          credentialMode: 'session',
          credential: 'session-value',
          credentialKind: 'access_token',
          checkinEnabled: true,
        }),
      ]),
    );
    const tokens = await db.select().from(schema.accountTokens).all();
    expect(tokens.map((token) => token.token).sort()).toEqual(['legacy-api-key-value', 'legacy-auth-type-api-key-value', 'session-default-api-key']);
  });

  it('imports previous-version route backups into current route runtime tables', async () => {
    const payload = {
      version: '2.3',
      timestamp: Date.now(),
      type: 'accounts',
      accounts: {
        sites: [
          {
            id: 1,
            name: 'previous-route-site',
            url: 'https://previous-route.example.test',
            platform: 'openai',
            status: 'active',
          },
        ],
        accounts: [
          {
            id: 1,
            siteId: 1,
            username: 'previous-route-user',
            accessToken: 'previous-route-access',
            apiToken: 'previous-route-api-key',
            status: 'active',
            checkinEnabled: true,
          },
        ],
        accountTokens: [
          {
            id: 1,
            accountId: 1,
            name: 'default',
            token: 'sk-previous-route',
            tokenGroup: 'default',
            source: 'manual',
            enabled: true,
            isDefault: true,
          },
        ],
        tokenRoutes: [
          {
            id: 202,
            routeMode: 'explicit_group',
            displayName: 'deepseek-v4-flash-rerouted',
            routingStrategy: 'stable_first',
            enabled: true,
          },
          {
            id: 101,
            modelPattern: 'deepseek-v4-flash',
            routingStrategy: 'weighted',
            enabled: true,
          },
        ],
        routeEndpointTargets: [
          {
            id: 11,
            routeId: 101,
            accountId: 1,
            tokenId: 1,
            sourceModel: 'deepseek-v4-flash',
            priority: 0,
            weight: 10,
            enabled: true,
            manualOverride: false,
          },
          {
            id: 12,
            routeId: 202,
            accountId: 1,
            tokenId: 1,
            sourceModel: 'deepseek-v4-chat',
            priority: 0,
            weight: 20,
            enabled: true,
            manualOverride: true,
          },
        ],
      },
    };

    const result = await backupService.importBackup(payload as any);

    expect(result).toMatchObject({
      allImported: true,
      sections: { accounts: true },
    });
    const groups = await loadRouteGroupManagementReadModel();
    const supplyEndpoints = await db.select().from(schema.runtimeExecutionTargets).all();
    const candidates = await listAllRouteGroupMembers();
    expect(groups).toHaveLength(3);
    expect(supplyEndpoints).toHaveLength(2);
    expect(candidates).toHaveLength(2);
    expect(groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'automatic',
          model: expect.objectContaining({ publicName: 'deepseek-v4-flash' }),
        }),
        expect.objectContaining({
          kind: 'automatic',
          model: expect.objectContaining({ publicName: 'deepseek-v4-chat' }),
        }),
        expect.objectContaining({
          kind: 'manual',
          presentation: expect.objectContaining({
            displayName: 'deepseek-v4-flash-rerouted',
          }),
          dispatcherPolicy: { kind: 'builtin', builtin: 'stable_first' },
        }),
      ]),
    );
    const chatEndpoint = supplyEndpoints.find((endpoint) => endpoint.upstreamModelName === 'deepseek-v4-chat');
    const chatAutomaticGroup = groups.find((group) => group.kind === 'automatic' && group.model.publicName === 'deepseek-v4-chat');
    const manualGroup = groups.find((group) => group.kind === 'manual');
    expect(chatEndpoint).toBeTruthy();
    expect(chatAutomaticGroup).toBeTruthy();
    expect(manualGroup).toBeTruthy();
    expect(manualGroup).toMatchObject({
      candidateCount: 1,
      sourceSelection: {
        kind: 'explicit',
        sources: [
          expect.objectContaining({
            source: { kind: 'route_group', id: chatAutomaticGroup!.id },
          }),
        ],
      },
    });
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routeGroupId: chatAutomaticGroup!.id,
          executionTargetId: chatEndpoint!.id,
          weight: 20,
          enabled: true,
          manualOverride: true,
        }),
      ]),
    );
    expect(await db.select().from(schema.routeGraphActiveVersion).get()).toBeTruthy();
  });

  it('rebuilds active route graph from migrated previous-version routes instead of stale backup graph artifacts', async () => {
    const stalePublished = await publishRouteGraphSource({
      sourceGraph: {
        nodes: [],
        edges: [],
        macros: [],
      },
      createdBy: 'stale-backup-fixture',
      allowDiagnostics: true,
    });
    expect(stalePublished.ok).toBe(true);
    const staleRouteGraph = {
      versions: await db.select().from(schema.routeGraphVersions).all(),
      activeVersion: await db.select().from(schema.routeGraphActiveVersion).get(),
      drafts: [],
    };
    writeModelsMarketplaceCache(false, [{ name: 'stale-marketplace-model' }]);
    expect(readModelsMarketplaceCache(false)).toEqual([{ name: 'stale-marketplace-model' }]);
    const payload = {
      version: '2.3',
      timestamp: Date.now(),
      type: 'accounts',
      accounts: {
        sites: [
          {
            id: 1,
            name: 'previous-route-site',
            url: 'https://previous-route.example.test',
            platform: 'openai',
            status: 'active',
          },
        ],
        accounts: [
          {
            id: 1,
            siteId: 1,
            username: 'previous-route-user',
            accessToken: 'previous-route-access',
            apiToken: 'previous-route-api-key',
            status: 'active',
            checkinEnabled: true,
          },
        ],
        accountTokens: [
          {
            id: 1,
            accountId: 1,
            name: 'default',
            token: 'sk-previous-route',
            tokenGroup: 'default',
            source: 'manual',
            enabled: true,
            isDefault: true,
          },
        ],
        tokenRoutes: [
          {
            id: 101,
            modelPattern: 'deepseek-v4-flash',
            routingStrategy: 'weighted',
            enabled: true,
          },
        ],
        routeEndpointTargets: [
          {
            id: 11,
            routeId: 101,
            accountId: 1,
            tokenId: 1,
            sourceModel: 'deepseek-v4-flash',
            priority: 0,
            weight: 10,
            enabled: true,
            manualOverride: false,
          },
        ],
        routeGraph: staleRouteGraph,
      },
    };

    await backupService.importBackup(payload as any);

    const groups = await loadRouteGroupManagementReadModel();
    const supplyEndpoints = await db.select().from(schema.runtimeExecutionTargets).all();
    expect(groups).toHaveLength(1);
    expect(supplyEndpoints).toHaveLength(1);
    const activeGraph = await db.select().from(schema.routeGraphVersions).where(eq(schema.routeGraphVersions.status, 'active')).get();
    const endpointId = sourceGraphEndpointIdForExecutionTarget(activeGraph?.sourceGraphJson, supplyEndpoints[0]!.id);
    expect(endpointId).toBeTruthy();
    expect(activeGraph?.sourceGraphJson).toContain(endpointId!);
    expect(JSON.stringify((await getActiveRouteRuntimeArtifact())?.compiledGraph)).toContain(endpointId!);
    expect(activeGraph?.createdBy).toBe('backup-import');
    expect(readModelsMarketplaceCache(false)).toBeNull();
  });

  it('imports previous-version route backups that use legacy table-name keys', async () => {
    const payload = {
      version: '2.3',
      timestamp: Date.now(),
      type: 'accounts',
      accounts: {
        sites: [
          {
            id: 1,
            name: 'legacy-table-site',
            url: 'https://legacy-table.example.test',
            platform: 'openai',
            status: 'active',
          },
        ],
        accounts: [
          {
            id: 1,
            siteId: 1,
            username: 'legacy-table-user',
            accessToken: 'legacy-table-access',
            apiToken: 'legacy-table-api-key',
            status: 'active',
            checkinEnabled: true,
          },
        ],
        accountTokens: [
          {
            id: 1,
            accountId: 1,
            name: 'default',
            token: 'sk-legacy-table',
            tokenGroup: 'default',
            source: 'manual',
            enabled: true,
            isDefault: true,
          },
        ],
        token_routes: [
          {
            id: 101,
            model_pattern: 'deepseek-v4-flash',
            routing_strategy: 'weighted',
            enabled: true,
          },
        ],
        route_endpoint_targets: [
          {
            id: 11,
            route_id: 101,
            account_id: 1,
            token_id: 1,
            source_model: 'deepseek-v4-flash',
            priority: 0,
            weight: 10,
            enabled: true,
            manual_override: false,
          },
        ],
      },
    };

    const result = await backupService.importBackup(payload as any);

    expect(result).toMatchObject({
      allImported: true,
      sections: { accounts: true },
    });
    const groups = await loadRouteGroupManagementReadModel();
    const supplyEndpoints = await db.select().from(schema.runtimeExecutionTargets).all();
    const candidates = await listAllRouteGroupMembers();
    expect(groups).toEqual([
      expect.objectContaining({
        kind: 'automatic',
        model: expect.objectContaining({ publicName: 'deepseek-v4-flash' }),
      }),
    ]);
    expect(supplyEndpoints).toEqual([
      expect.objectContaining({
        upstreamModelName: 'deepseek-v4-flash',
        source: 'backup_import',
      }),
    ]);
    expect(candidates).toEqual([
      expect.objectContaining({
        routeGroupId: groups[0]!.id,
        executionTargetId: supplyEndpoints[0]!.id,
        enabled: true,
      }),
    ]);
    const activeGraph = await db.select().from(schema.routeGraphVersions).where(eq(schema.routeGraphVersions.status, 'active')).get();
    const endpointId = sourceGraphEndpointIdForExecutionTarget(activeGraph?.sourceGraphJson, supplyEndpoints[0]!.id);
    expect(endpointId).toBeTruthy();
    expect(activeGraph?.sourceGraphJson).toContain(endpointId!);
  });

  it('expands previous explicit route-group references into current manual candidates', async () => {
    const payload = {
      version: '2.3',
      timestamp: Date.now(),
      type: 'accounts',
      accounts: {
        sites: [
          {
            id: 1,
            name: 'previous-route-site',
            url: 'https://previous-route.example.test',
            platform: 'openai',
            status: 'active',
          },
        ],
        accounts: [
          {
            id: 1,
            siteId: 1,
            username: 'previous-route-user',
            accessToken: 'previous-route-access',
            apiToken: 'previous-route-api-key',
            status: 'active',
          },
        ],
        accountTokens: [
          {
            id: 1,
            accountId: 1,
            name: 'default',
            token: 'sk-previous-route',
            enabled: true,
            isDefault: true,
          },
        ],
        tokenRoutes: [
          {
            id: 101,
            modelPattern: 'deepseek-v4-flash',
            routingStrategy: 'weighted',
            enabled: true,
          },
          {
            id: 202,
            routeMode: 'explicit_group',
            displayName: 'deepseek-v4-flash-rerouted',
            routingStrategy: 'stable_first',
            enabled: true,
          },
        ],
        routeGroupSources: [
          {
            id: 1,
            groupRouteId: 202,
            sourceRouteId: 101,
          },
        ],
        routeEndpointTargets: [
          {
            id: 11,
            routeId: 101,
            accountId: 1,
            tokenId: 1,
            sourceModel: 'deepseek-v4-flash',
            priority: 0,
            weight: 10,
            enabled: true,
            manualOverride: false,
          },
        ],
      },
    };

    const result = await backupService.importBackup(payload as any);

    expect(result).toMatchObject({
      allImported: true,
      sections: { accounts: true },
    });
    const groups = await loadRouteGroupManagementReadModel();
    const manualGroup = groups.find((group) => group.kind === 'manual');
    const automaticGroup = groups.find((group) => group.kind === 'automatic');
    expect(automaticGroup).toBeTruthy();
    expect(manualGroup).toBeTruthy();

    const supplyEndpoints = await db.select().from(schema.runtimeExecutionTargets).all();
    const candidates = await listAllRouteGroupMembers();
    const automaticCandidates = candidates.filter((candidate) => candidate.routeGroupId === automaticGroup!.id);
    expect(supplyEndpoints).toHaveLength(1);
    expect(automaticCandidates).toHaveLength(1);
    expect(manualGroup).toMatchObject({
      candidateCount: 1,
      enabledCandidateCount: 1,
      sourceSelection: {
        kind: 'explicit',
        sources: [
          expect.objectContaining({
            source: { kind: 'route_group', id: automaticGroup!.id },
          }),
        ],
      },
    });

    const summaries = await loadRouteGroupManagementReadModel();
    const publicPage = buildRouteSummaryProjectionPage(summaries, {
      tab: 'public',
      pageSize: '20',
    });
    const manualPage = buildRouteSummaryProjectionPage(summaries, {
      tab: 'manual',
      pageSize: '20',
    });
    const overview = buildRouteSummaryProjectionOverview(summaries);
    expect(publicPage.items.map((item) => item.id)).toEqual([automaticGroup!.id]);
    expect(manualPage.items.map((item) => item.id)).toEqual([manualGroup!.id]);
    expect(manualPage.items[0]).toMatchObject({
      kind: 'manual',
      sourceMode: 'manual',
      candidateCount: 1,
      enabledCandidateCount: 1,
    });
    expect(overview.tabs).toEqual({
      public: 1,
      internal: 0,
      manual: 1,
    });

    const runtime = await getActiveRouteRuntimeArtifact();
    expect(runtime?.compiledGraph.compiledRouterBundle?.diagnostics.map((diagnostic: any) => diagnostic.code)).not.toContain('compiled_router.duplicate_alternative_id');
  });

  it('demotes automatic routes to internal when legacy import collides with manual public names', async () => {
    const payload = {
      version: '2.3',
      timestamp: Date.now(),
      type: 'accounts',
      accounts: {
        sites: [
          {
            id: 1,
            name: 'previous-route-site',
            url: 'https://previous-route.example.test',
            platform: 'openai',
            status: 'active',
          },
        ],
        accounts: [
          {
            id: 1,
            siteId: 1,
            username: 'previous-route-user',
            accessToken: 'previous-route-access',
            apiToken: 'previous-route-api-key',
            status: 'active',
          },
        ],
        accountTokens: [
          {
            id: 1,
            accountId: 1,
            name: 'default',
            token: 'sk-previous-route',
            enabled: true,
            isDefault: true,
          },
        ],
        tokenRoutes: [
          {
            id: 101,
            modelPattern: 'deepseek-v4-flash-rerouted',
            routingStrategy: 'weighted',
            enabled: true,
          },
          {
            id: 202,
            routeMode: 'explicit_group',
            displayName: 'deepseek-v4-flash-rerouted',
            routingStrategy: 'stable_first',
            enabled: true,
          },
        ],
        routeGroupSources: [
          {
            id: 1,
            groupRouteId: 202,
            sourceRouteId: 101,
          },
        ],
        routeEndpointTargets: [
          {
            id: 11,
            routeId: 101,
            accountId: 1,
            tokenId: 1,
            sourceModel: 'deepseek-v4-flash-rerouted',
            priority: 0,
            weight: 10,
            enabled: true,
            manualOverride: false,
          },
        ],
      },
    };

    const result = await backupService.importBackup(payload as any);

    expect(result.warnings?.join('\n')).toContain('公开模型名 deepseek-v4-flash-rerouted 重复');
    expect(result.notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'public_model_conflict_demoted',
          normalizedModelName: 'deepseek-v4-flash-rerouted',
        }),
      ]),
    );
    const groups = await loadRouteGroupManagementReadModel();
    const automaticGroup = groups.find((group) => group.kind === 'automatic');
    const manualGroup = groups.find((group) => group.kind === 'manual');
    expect(automaticGroup).toMatchObject({
      visibility: 'internal',
      model: expect.objectContaining({
        publicName: 'deepseek-v4-flash-rerouted',
      }),
    });
    expect(manualGroup).toMatchObject({
      visibility: 'public',
      model: expect.objectContaining({
        publicName: 'deepseek-v4-flash-rerouted',
      }),
    });

    const runtime = await getActiveRouteRuntimeArtifact();
    expect(runtime?.compiledGraph.compiledRouterBundle?.matcher.normalizedExact).toHaveProperty('deepseek-v4-flash-rerouted');
  });

  it('demotes automatic legacy routes when public names only differ by case', async () => {
    const payload = {
      version: '2.3',
      timestamp: Date.now(),
      type: 'accounts',
      accounts: {
        sites: [
          {
            id: 1,
            name: 'previous-route-site',
            url: 'https://previous-route.example.test',
            platform: 'openai',
            status: 'active',
          },
        ],
        accounts: [
          {
            id: 1,
            siteId: 1,
            username: 'previous-route-user',
            accessToken: 'previous-route-access',
            apiToken: 'previous-route-api-key',
            status: 'active',
          },
        ],
        accountTokens: [
          {
            id: 1,
            accountId: 1,
            name: 'default',
            token: 'sk-previous-route',
            enabled: true,
            isDefault: true,
          },
        ],
        tokenRoutes: [
          {
            id: 101,
            modelPattern: 'DeepSeek-V4-Flash-Rerouted',
            routingStrategy: 'weighted',
            enabled: true,
          },
          {
            id: 202,
            routeMode: 'explicit_group',
            displayName: 'deepseek-v4-flash-rerouted',
            routingStrategy: 'stable_first',
            enabled: true,
          },
        ],
        routeGroupSources: [
          {
            id: 1,
            groupRouteId: 202,
            sourceRouteId: 101,
          },
        ],
        routeEndpointTargets: [
          {
            id: 11,
            routeId: 101,
            accountId: 1,
            tokenId: 1,
            sourceModel: 'DeepSeek-V4-Flash-Rerouted',
            priority: 0,
            weight: 10,
            enabled: true,
            manualOverride: false,
          },
        ],
      },
    };

    const result = await backupService.importBackup(payload as any);

    expect(result.warnings?.join('\n')).toContain('公开模型名 deepseek-v4-flash-rerouted 重复');
    expect(result.notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'public_model_conflict_demoted',
          normalizedModelName: 'deepseek-v4-flash-rerouted',
        }),
      ]),
    );
    const groups = await loadRouteGroupManagementReadModel();
    const automaticGroup = groups.find((group) => group.kind === 'automatic');
    const manualGroup = groups.find((group) => group.kind === 'manual');
    expect(automaticGroup).toMatchObject({
      visibility: 'internal',
      model: expect.objectContaining({
        upstreamName: 'deepseek-v4-flash-rerouted',
        normalizedName: 'deepseek-v4-flash-rerouted',
        publicName: 'deepseek-v4-flash-rerouted',
      }),
      presentation: expect.objectContaining({
        displayName: 'deepseek-v4-flash-rerouted',
      }),
    });
    expect(manualGroup).toMatchObject({
      visibility: 'public',
      model: expect.objectContaining({
        publicName: 'deepseek-v4-flash-rerouted',
      }),
    });

    const runtime = await getActiveRouteRuntimeArtifact();
    expect(runtime?.compiledGraph.compiledRouterBundle?.matcher.normalizedExact).toHaveProperty('deepseek-v4-flash-rerouted');
  });

  it('coalesces legacy automatic route casing variants and reports the normalization', async () => {
    const payload = {
      version: '2.3',
      timestamp: Date.now(),
      type: 'accounts',
      accounts: {
        sites: [
          {
            id: 1,
            name: 'previous-route-site',
            url: 'https://previous-route.example.test',
            platform: 'openai',
            status: 'active',
          },
        ],
        accounts: [
          {
            id: 1,
            siteId: 1,
            username: 'previous-route-user',
            accessToken: 'previous-route-access',
            apiToken: 'previous-route-api-key',
            status: 'active',
          },
        ],
        accountTokens: [
          {
            id: 1,
            accountId: 1,
            name: 'default-a',
            token: 'sk-previous-route-a',
            enabled: true,
            isDefault: true,
          },
          {
            id: 2,
            accountId: 1,
            name: 'default-b',
            token: 'sk-previous-route-b',
            enabled: true,
            isDefault: false,
          },
        ],
        tokenRoutes: [
          {
            id: 101,
            modelPattern: 'DeepSeek-V4-Flash',
            routingStrategy: 'weighted',
            enabled: true,
          },
          {
            id: 102,
            modelPattern: 'deepseek-v4-flash',
            routingStrategy: 'weighted',
            enabled: true,
          },
        ],
        routeEndpointTargets: [
          {
            id: 11,
            routeId: 101,
            accountId: 1,
            tokenId: 1,
            sourceModel: 'DeepSeek-V4-Flash',
            priority: 0,
            weight: 10,
            enabled: true,
            manualOverride: false,
          },
          {
            id: 12,
            routeId: 102,
            accountId: 1,
            tokenId: 2,
            sourceModel: 'deepseek-v4-flash',
            priority: 0,
            weight: 20,
            enabled: true,
            manualOverride: false,
          },
        ],
      },
    };

    const result = await backupService.importBackup(payload as any);

    expect(result.warnings?.join('\n')).toContain('自动模型名 DeepSeek-V4-Flash 与 deepseek-v4-flash 归一化后同为 deepseek-v4-flash');
    expect(result.notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'automatic_model_normalized_coalesced',
          normalizedModelName: 'deepseek-v4-flash',
          sourceNames: ['DeepSeek-V4-Flash', 'deepseek-v4-flash'],
        }),
      ]),
    );
    const groups = await loadRouteGroupManagementReadModel();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: 'automatic',
      visibility: 'public',
      model: expect.objectContaining({
        upstreamName: 'deepseek-v4-flash',
        normalizedName: 'deepseek-v4-flash',
        publicName: 'deepseek-v4-flash',
      }),
      presentation: expect.objectContaining({
        displayName: 'deepseek-v4-flash',
      }),
    });

    const supplyEndpoints = await db.select().from(schema.runtimeExecutionTargets).all();
    expect(supplyEndpoints.map((endpoint) => endpoint.upstreamModelName).sort()).toEqual(['DeepSeek-V4-Flash', 'deepseek-v4-flash']);
    const candidates = await listAllRouteGroupMembers();
    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.routeGroupId)).toEqual([groups[0]!.id, groups[0]!.id]);

    const runtime = await getActiveRouteRuntimeArtifact();
    expect(runtime?.compiledGraph.compiledRouterBundle?.matcher.normalizedExact).toHaveProperty('deepseek-v4-flash');
  });

  it('uses the referenced source route model when migrating manual group candidates without sourceModel', async () => {
    const payload = {
      version: '2.3',
      timestamp: Date.now(),
      type: 'accounts',
      accounts: {
        sites: [
          {
            id: 1,
            name: 'PackyCode',
            url: 'https://packycode.example.test',
            platform: 'new-api',
            status: 'active',
          },
        ],
        accounts: [
          {
            id: 1,
            siteId: 1,
            username: 'packycode-user',
            accessToken: 'packycode-access',
            apiToken: 'packycode-api-key',
            status: 'active',
            checkinEnabled: true,
          },
        ],
        accountTokens: [
          {
            id: 1,
            accountId: 1,
            name: 'default',
            token: 'sk-packycode',
            enabled: true,
            isDefault: true,
          },
        ],
        tokenRoutes: [
          {
            id: 101,
            modelPattern: 'deepseek-v4-flash',
            routingStrategy: 'weighted',
            enabled: true,
          },
          {
            id: 202,
            routeMode: 'explicit_group',
            displayName: 'deepseek-v4-flash-rerouted',
            routingStrategy: 'stable_first',
            enabled: true,
          },
        ],
        routeGroupSources: [
          {
            id: 1,
            groupRouteId: 202,
            sourceRouteId: 101,
          },
        ],
        routeEndpointTargets: [
          {
            id: 11,
            routeId: 101,
            accountId: 1,
            tokenId: 1,
            priority: 0,
            weight: 10,
            enabled: true,
            manualOverride: false,
          },
        ],
      },
    };

    const result = await backupService.importBackup(payload as any);

    expect(result).toMatchObject({
      allImported: true,
      sections: { accounts: true },
    });
    const groups = await loadRouteGroupManagementReadModel();
    const manualGroup = groups.find((group) => group.kind === 'manual');
    const automaticGroup = groups.find((group) => group.kind === 'automatic');
    expect(manualGroup).toBeTruthy();
    expect(automaticGroup).toBeTruthy();

    const supplyEndpoints = await db.select().from(schema.runtimeExecutionTargets).all();
    expect(supplyEndpoints).toHaveLength(1);
    expect(supplyEndpoints[0]).toMatchObject({
      siteId: 1,
      accountId: 1,
      tokenId: 1,
      upstreamModelName: 'deepseek-v4-flash',
      normalizedModelName: 'deepseek-v4-flash',
    });
    expect(supplyEndpoints[0]?.upstreamModelName).not.toBe('deepseek-v4-flash-rerouted');
    expect(JSON.parse(supplyEndpoints[0]?.metadataJson || '{}')).toMatchObject({
      source: 'legacy_backup',
    });

    const candidates = await listAllRouteGroupMembers();
    const automaticCandidate = candidates.find((candidate) => candidate.routeGroupId === automaticGroup!.id);
    expect(automaticCandidate).toBeTruthy();
    expect(manualGroup).toMatchObject({
      candidateCount: 1,
      sourceSelection: {
        kind: 'explicit',
        sources: [
          expect.objectContaining({
            source: { kind: 'route_group', id: automaticGroup!.id },
          }),
        ],
      },
    });

    const manualPage = buildRouteSummaryProjectionPage(await loadRouteGroupManagementReadModel(), {
      tab: 'manual',
      pageSize: '20',
    });
    expect(manualPage.items[0]).toMatchObject({
      id: manualGroup!.id,
      candidateCount: 1,
      siteNames: ['PackyCode'],
    });
  });
});
