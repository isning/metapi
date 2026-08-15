import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

type DbModule = typeof import('../db/index.js');
type ModelServiceModule = typeof import('./modelService.js');
type RouteGroupManagementModule = typeof import('./routeGroupManagementService.js');
type RouteGroupCandidateModule = typeof import('./routeGroupCandidateService.js');
type RouteGraphServiceModule = typeof import('./routeGraphService.js');
type RouteGroupGraphFacadeModule = typeof import('./routeGroupGraphFacadeService.js');

describe('rebuildManagedRouteGroupsFromAvailability graph-native output', () => {
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let rebuildManagedRouteGroupsFromAvailability: ModelServiceModule['rebuildManagedRouteGroupsFromAvailability'];
  let createRouteGroupFromPayload: RouteGroupManagementModule['createRouteGroupFromPayload'];
  let loadRouteGroupManagementSummaries: RouteGroupManagementModule['loadRouteGroupManagementSummaries'];
  let listRouteGroupCandidatesByGroupKeys: RouteGroupCandidateModule['listRouteGroupCandidatesByGroupKeys'];
  let invalidateRouteGraphReadCaches: RouteGraphServiceModule['invalidateRouteGraphReadCaches'];
  let getActiveRouteGraphSourceVersion: RouteGraphServiceModule['getActiveRouteGraphSourceVersion'];
  let createRouteGroupFacadeMacro: RouteGroupGraphFacadeModule['createRouteGroupFacadeMacro'];
  let mutateRouteGroupFacadeGraph: RouteGroupGraphFacadeModule['mutateRouteGroupFacadeGraph'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-model-service-'));
    process.env.DATA_DIR = dataDir;

    const migrate = await import('../db/migrate.js');
    await migrate.runSqliteMigrations();
    const dbModule = await import('../db/index.js');
    const modelService = await import('./modelService.js');
    const routeGroupManagement = await import('./routeGroupManagementService.js');
    const routeGroupCandidates = await import('./routeGroupCandidateService.js');
    const routeGraphService = await import('./routeGraphService.js');
    const routeGroupGraphFacade = await import('./routeGroupGraphFacadeService.js');

    db = dbModule.db;
    schema = dbModule.schema;
    rebuildManagedRouteGroupsFromAvailability = modelService.rebuildManagedRouteGroupsFromAvailability;
    createRouteGroupFromPayload = routeGroupManagement.createRouteGroupFromPayload;
    loadRouteGroupManagementSummaries = routeGroupManagement.loadRouteGroupManagementSummaries;
    listRouteGroupCandidatesByGroupKeys = routeGroupCandidates.listRouteGroupCandidatesByGroupKeys;
    invalidateRouteGraphReadCaches = routeGraphService.invalidateRouteGraphReadCaches;
    getActiveRouteGraphSourceVersion = routeGraphService.getActiveRouteGraphSourceVersion;
    createRouteGroupFacadeMacro = routeGroupGraphFacade.createRouteGroupFacadeMacro;
    mutateRouteGroupFacadeGraph = routeGroupGraphFacade.mutateRouteGroupFacadeGraph;
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
    invalidateRouteGraphReadCaches();
  });

  afterAll(() => {
    delete process.env.DATA_DIR;
  });

  async function seedAccountWithModel(modelName: string, options: { token?: boolean } = {}) {
    const site = await db.insert(schema.sites).values({
      name: `site-${modelName}`,
      url: `https://${modelName}.example.test`,
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: `user-${modelName}`,
      credentialMode: 'apikey',
      credential: '',
      credentialKind: 'none',
      status: 'active',
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: `token-${modelName}`,
      token: `sk-token-${modelName}`,
      enabled: true,
      isDefault: true,
      valueStatus: 'ready',
    }).returning().get();
    await db.insert(schema.tokenModelAvailability).values({
      tokenId: token.id,
      modelName,
      available: true,
    }).run();
    return { site, account, token };
  }

  async function routeGroupForModel(modelName: string) {
    return (await loadRouteGroupManagementSummaries())
      .filter((group) => group.model.normalizedName === modelName.toLowerCase());
  }

  it('creates automatic route groups, supply endpoints, and candidates from account availability', async () => {
    const seeded = await seedAccountWithModel('gpt-5.2-codex');

    const rebuild = await rebuildManagedRouteGroupsFromAvailability();
    expect(rebuild.models).toBe(1);

    const group = (await routeGroupForModel('gpt-5.2-codex')).find((item) => item.kind === 'automatic');
    expect(group).toMatchObject({
      kind: 'automatic',
      model: { publicName: 'gpt-5.2-codex' },
      sourceMode: 'auto',
    });

    const endpoint = await db.select().from(schema.runtimeExecutionTargets)
      .where(eq(schema.runtimeExecutionTargets.accountId, seeded.account.id))
      .get();
    expect(endpoint).toMatchObject({
      upstreamModelName: 'gpt-5.2-codex',
      accountId: seeded.account.id,
      tokenId: seeded.token.id,
    });

    const candidates = (await listRouteGroupCandidatesByGroupKeys([group!.id])).get(group!.id) || [];
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: 'execution_endpoint',
      enabled: true,
      targets: [expect.objectContaining({
        accountId: seeded.account.id,
        sourceModel: 'gpt-5.2-codex',
      })],
    });

    const active = await db.select().from(schema.routeGraphActiveVersion).get();
    expect(active?.versionId).toBeGreaterThan(0);
  });

  it('does not create an automatic route from session-scoped model availability alone', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'session-only-site',
      url: 'https://session-only.example.test',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'session-only-user',
      credentialMode: 'session',
      credentialKind: 'session_cookie',
      credential: 'account-session-cookie',
      status: 'active',
    }).returning().get();
    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'session-only-model',
      available: true,
    }).run();

    const rebuild = await rebuildManagedRouteGroupsFromAvailability();

    expect(rebuild.models).toBe(0);
    expect(await db.select().from(schema.runtimeExecutionTargets).all()).toEqual([]);
  });

  it('coalesces casing variants into one automatic route group while preserving source models', async () => {
    await seedAccountWithModel('DeepSeek-v4-Flash', { token: true });
    await seedAccountWithModel('deepseek-v4-flash', { token: true });

    const rebuild = await rebuildManagedRouteGroupsFromAvailability();
    expect(rebuild.models).toBe(1);

    const groups = await routeGroupForModel('deepseek-v4-flash');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: 'automatic',
      model: { publicName: 'deepseek-v4-flash' },
      presentation: { displayName: 'deepseek-v4-flash' },
    });

    const endpoints = await db.select().from(schema.runtimeExecutionTargets).all();
    expect(endpoints.map((endpoint) => endpoint.upstreamModelName).sort()).toEqual([
      'DeepSeek-v4-Flash',
      'deepseek-v4-flash',
    ]);
    const candidates = (await listRouteGroupCandidatesByGroupKeys([groups[0]!.id])).get(groups[0]!.id) || [];
    expect(candidates).toHaveLength(2);
  });

  it('does not rewrite same-model internal automatic groups into availability default groups', async () => {
    await mutateRouteGroupFacadeGraph({
      createdBy: 'test',
      mutate: (source) => {
        const created = createRouteGroupFacadeMacro(source, {
          kind: 'automatic',
          modelName: 'same-model',
          displayName: 'same-model shadow',
          visibility: 'internal',
        });
        return { source: created.source, result: undefined };
      },
    });
    expect(await loadRouteGroupManagementSummaries()).toHaveLength(1);
    await seedAccountWithModel('same-model', { token: true });

    const rebuild = await rebuildManagedRouteGroupsFromAvailability();
    expect(rebuild.models).toBe(1);
    expect((await getActiveRouteGraphSourceVersion())?.sourceGraph.macros.map((macro) => ({
      id: macro.id,
      ownership: macro.ownership,
      canonicalModel: macro.metadata?.canonicalModel,
      managementOwner: macro.metadata?.managementOwner,
    }))).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownership: 'system', canonicalModel: 'same-model' }),
      expect.objectContaining({
        ownership: 'system',
        canonicalModel: 'same-model',
        managementOwner: 'availability-rebuild',
      }),
    ]));

    const groups = await routeGroupForModel('same-model');
    expect(groups).toHaveLength(2);
    const internal = groups.find((group) => group.visibility === 'internal');
    const defaultGroup = groups.find((group) => group.visibility === 'public');
    expect(internal).toMatchObject({
      visibility: 'internal',
      presentation: { displayName: 'same-model shadow' },
    });
    expect(defaultGroup).toMatchObject({
      visibility: 'public',
      model: { publicName: 'same-model' },
    });
  });

  it('creates automatic route groups as internal when a manual public group already exposes the model', async () => {
    await createRouteGroupFromPayload({
      model: { publicName: 'manual-conflict-model', upstreamName: 'manual-conflict-model' },
      presentation: { displayName: 'manual-conflict-model', displayIcon: null },
      visibility: 'public',
      enabled: true,
    });
    await seedAccountWithModel('manual-conflict-model', { token: true });

    const rebuild = await rebuildManagedRouteGroupsFromAvailability();
    expect(rebuild.models).toBe(1);

    const groups = await routeGroupForModel('manual-conflict-model');
    const manualGroup = groups.find((group) => group.kind === 'manual');
    const automaticGroup = groups.find((group) => group.kind === 'automatic');
    expect(manualGroup).toMatchObject({
      visibility: 'public',
      model: { publicName: 'manual-conflict-model' },
    });
    expect(automaticGroup).toMatchObject({
      visibility: 'internal',
      model: { publicName: 'manual-conflict-model' },
    });
  });
});
