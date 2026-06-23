import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type DbModule = typeof import('../db/index.js');
type SeedModule = typeof import('./dummyUpstreamSeedService.js');

describe('dummyUpstreamSeedService', () => {
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let seedDummyUpstreamRoutes: SeedModule['seedDummyUpstreamRoutes'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-dummy-upstream-seed-'));
    process.env.DATA_DIR = dataDir;

    await import('../db/migrate.js');
    const dbModule = await import('../db/index.js');
    const seedModule = await import('./dummyUpstreamSeedService.js');

    db = dbModule.db;
    schema = dbModule.schema;
    seedDummyUpstreamRoutes = seedModule.seedDummyUpstreamRoutes;
  });

  beforeEach(async () => {
    await db.delete(schema.routeEndpointTargets).run();
    await db.delete(schema.tokenRoutes).run();
    await db.delete(schema.tokenModelAvailability).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.routeGraphVersions).run();
  });

  afterAll(() => {
    delete process.env.DATA_DIR;
  });

  it('creates deterministic dummy upstream routes and rebuilds the active graph', async () => {
    const result = await seedDummyUpstreamRoutes();

    expect(result.routes).toBe(3);
    expect(result.channels).toBe(3);
    expect(result.modelNames).toEqual([
      'dummy-openai-chat',
      'dummy-claude-messages',
      'dummy-gemini-generate-content',
    ]);

    const routes = await db.select().from(schema.tokenRoutes).all();
    const routeNames = routes.map((route) => route.displayName).filter((name): name is string => !!name);
    expect(routeNames).toEqual(expect.arrayContaining(result.modelNames));

    const graphVersions = await db.select().from(schema.routeGraphVersions).all();
    expect(graphVersions.length).toBeGreaterThan(0);
  });
});
