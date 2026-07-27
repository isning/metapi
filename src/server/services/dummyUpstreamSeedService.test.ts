import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearRouteGroupMemberTestData, listAllRouteGroupMembers } from '../../testing/routeGroupMemberTestUtils.js';

type DbModule = typeof import('../db/index.js');
type SeedModule = typeof import('./dummyUpstreamSeedService.js');
type RouteGroupManagementReadModelModule = typeof import('./routeGroupManagementReadModelService.js');

describe('dummyUpstreamSeedService', () => {
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let seedDummyUpstreamRoutes: SeedModule['seedDummyUpstreamRoutes'];
  let loadRouteGroupManagementReadModel: RouteGroupManagementReadModelModule['loadRouteGroupManagementReadModel'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-dummy-upstream-seed-'));
    process.env.DATA_DIR = dataDir;

    await import('../db/migrate.js');
    const dbModule = await import('../db/index.js');
    const seedModule = await import('./dummyUpstreamSeedService.js');
    const routeGroupManagementReadModelModule = await import('./routeGroupManagementReadModelService.js');

    db = dbModule.db;
    schema = dbModule.schema;
    seedDummyUpstreamRoutes = seedModule.seedDummyUpstreamRoutes;
    loadRouteGroupManagementReadModel = routeGroupManagementReadModelModule.loadRouteGroupManagementReadModel;
  });

  beforeEach(async () => {
    await clearRouteGroupMemberTestData();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.compiledRuntimeActiveArtifact).run();
    await db.delete(schema.compiledRuntimeArtifacts).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.tokenModelAvailability).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.compiledRuntimeActiveArtifact).run();
    await db.delete(schema.compiledRuntimeArtifacts).run();
    await db.delete(schema.routeGraphVersions).run();
  });

  afterAll(() => {
    delete process.env.DATA_DIR;
  });

  it('creates deterministic dummy upstream route groups and rebuilds compiled runtime inputs', async () => {
    const result = await seedDummyUpstreamRoutes();

    expect(result.routes).toBe(3);
    expect(result.channels).toBe(3);
    expect(result.modelNames).toEqual([
      'dummy-openai-chat',
      'dummy-claude-messages',
      'dummy-gemini-generate-content',
    ]);

    const routes = await loadRouteGroupManagementReadModel();
    const routeNames = routes.map((route) => route.presentation.displayName).filter((name): name is string => !!name);
    expect(routeNames).toEqual(expect.arrayContaining(result.modelNames));

    const supplyEndpoints = await db.select().from(schema.runtimeExecutionTargets).all();
    expect(supplyEndpoints.map((endpoint) => endpoint.upstreamModelName)).toEqual(expect.arrayContaining(result.modelNames));
    expect(await listAllRouteGroupMembers()).toHaveLength(result.channels);
  });
});
