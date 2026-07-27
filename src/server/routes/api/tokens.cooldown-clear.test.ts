import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearRouteGroupMemberTestData,
  getRouteGroupMember,
  insertRouteGroupMember,
} from '../../../testing/routeGroupMemberTestUtils.js';
import {
  createGraphNativeRouteFixture,
  publishCurrentGraphNativeRouteFixtures,
  resetGraphNativeRouteFixtures,
} from '../../test/graphNativeRouteFixtures.js';

type DbModule = typeof import('../../db/index.js');
describe('route group failure-state clearing', () => {
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let dataDir = '';
  let seedId = 0;

  const nextId = () => {
    seedId += 1;
    return seedId;
  };

  const seedAccountWithToken = async () => {
    const id = nextId();
    const site = await db.insert(schema.sites).values({
      name: `cooldown-site-${id}`,
      url: `https://cooldown-site-${id}.example.com`,
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: `cooldown-user-${id}`,
      accessToken: `cooldown-access-token-${id}`,
      status: 'active',
    }).returning().get();

    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: `cooldown-token-${id}`,
      token: `sk-cooldown-token-${id}`,
      enabled: true,
      isDefault: true,
    }).returning().get();

    return { site, account, token };
  };

  const clearRouteGroupFailureState = async (groupKey: string) => {
    return await app.inject({
      method: 'DELETE',
      url: `/api/route-groups/${encodeURIComponent(groupKey)}/failure-state`,
    });
  };

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-route-cooldown-clear-'));
    process.env.DATA_DIR = dataDir;

    const migrate = await import('../../db/migrate.js');
    await migrate.runSqliteMigrations();
    const dbModule = await import('../../db/index.js');
    const routesModule = await import('./tokens.js');

    db = dbModule.db;
    schema = dbModule.schema;

    app = Fastify();
    await app.register(routesModule.tokensRoutes);
  });

  beforeEach(async () => {
    resetGraphNativeRouteFixtures();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.compiledRuntimeActiveArtifact).run();
    await db.delete(schema.compiledRuntimeArtifacts).run();
    await db.delete(schema.routeGraphVersions).run();
    await clearRouteGroupMemberTestData();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
    seedId = 0;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DATA_DIR;
  });

  it('clears cooldown and failure counters for a direct route', async () => {
    const seeded = await seedAccountWithToken();
    const route = await createGraphNativeRouteFixture({
      modelPattern: 'gpt-4o-mini',
      enabled: true,
    });

    const channel = await insertRouteGroupMember({
      groupId: route.id,
      accountId: seeded.account.id,
      tokenId: seeded.token.id,
      sourceModel: 'gpt-4o-mini',
      fallbackStageOrder: 0,
      weight: 10,
      enabled: true,
      failCount: 8,
      lastFailAt: '2026-04-01T00:00:00.000Z',
      consecutiveFailCount: 2,
      cooldownLevel: 3,
      cooldownUntil: '2099-01-01T00:00:00.000Z',
    });
    await publishCurrentGraphNativeRouteFixtures();

    const response = await clearRouteGroupFailureState(route.id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      clearedExecutionTargets: 1,
    });

    const refreshed = await getRouteGroupMember(channel.id);

    expect(refreshed).toMatchObject({
      failCount: 0,
      lastFailAt: null,
      consecutiveFailCount: 0,
      cooldownLevel: 0,
      cooldownUntil: null,
    });
  });

});
