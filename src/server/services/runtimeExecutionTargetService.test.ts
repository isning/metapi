import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

describe('runtimeExecutionTargetService', () => {
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-runtime-execution-target-'));
    process.env.DATA_DIR = dataDir;
    (await import('../db/migrate.js')).runSqliteMigrations();
  });

  beforeEach(async () => {
    const { db, schema } = await import('../db/index.js');
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(() => {
    delete process.env.DATA_DIR;
  });

  it('owns account/model transport facts independently from Route Group membership', async () => {
    const { db, schema } = await import('../db/index.js');
    const { upsertRuntimeExecutionTarget } = await import('./runtimeExecutionTargetService.js');
    const site = await db.insert(schema.sites).values({
      name: 'target-site',
      url: 'https://target.example.test',
      platform: 'openai',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'target-account',
      credential: 'target-access',
      status: 'active',
    }).returning().get();

    const first = await upsertRuntimeExecutionTarget({
      accountId: account.id,
      sourceModel: 'deepseek-v4-flash',
      source: 'route-group-facade',
      metadata: { origin: 'manual' },
    });
    const second = await upsertRuntimeExecutionTarget({
      accountId: account.id,
      sourceModel: 'deepseek-v4-flash',
      source: 'route-group-facade',
      enabled: false,
      metadata: { origin: 'manual' },
    });

    expect(second.id).toBe(first.id);
    expect(second.enabled).toBe(false);
    expect(await db.select().from(schema.runtimeExecutionTargetState)
      .where(eq(schema.runtimeExecutionTargetState.executionTargetId, first.id)).get()).toBeDefined();
  });
});
