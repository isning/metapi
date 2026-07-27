import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type DbModule = typeof import('../db/index.js');
type IdentityModule = typeof import('./routeRuntimeExecutionIdentityService.js');

describe('routeRuntimeExecutionIdentityService', () => {
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let identity: IdentityModule;
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-runtime-identity-'));
    process.env.DATA_DIR = dataDir;
    const migrateModule = await import('../db/migrate.js');
    await migrateModule.runSqliteMigrations();
    const dbModule = await import('../db/index.js');
    identity = await import('./routeRuntimeExecutionIdentityService.js');
    db = dbModule.db;
    schema = dbModule.schema;
  });

  beforeEach(async () => {
    identity.invalidateRouteRuntimeExecutionIdentityCache();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(() => {
    delete process.env.DATA_DIR;
  });

  it('loads cooling probe contexts directly from the runtime registry without route-group rows', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'runtime identity site',
      url: 'https://runtime-identity.example',
      platform: 'openai',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      accessToken: 'runtime-identity-access',
      status: 'active',
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'runtime identity token',
      token: 'runtime-identity-token',
      enabled: true,
    }).returning().get();
    const target = await db.insert(schema.runtimeExecutionTargets).values({
      executionKey: 'runtime-identity:cooling',
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      upstreamModelName: 'runtime-identity-model',
      normalizedModelName: 'runtime-identity-model',
      enabled: true,
    }).returning().get();
    await db.insert(schema.runtimeExecutionTargetState).values({
      executionTargetId: target.id,
      cooldownUntil: '2099-01-01T00:00:00.000Z',
      failCount: 1,
      consecutiveFailCount: 1,
      cooldownLevel: 1,
    }).run();

    const contexts = await identity.loadCoolingRouteRuntimeRecoveryProbeContexts('2026-07-20T00:00:00.000Z');

    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      executionTarget: {
        id: target.id,
        upstreamModelName: 'runtime-identity-model',
        tokenId: token.id,
      },
      account: { id: account.id },
      site: { id: site.id },
      token: { id: token.id },
      state: { executionTargetId: target.id },
    });
  });
});
