import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

type DbModule = typeof import('../db/index.js');
type MigrationModule = typeof import('./accountCredentialKindMigrationService.js');

describe('accountCredentialKindMigrationService', () => {
  let dataDir = '';
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let migrateLegacyAccountCredentialKinds: MigrationModule['migrateLegacyAccountCredentialKinds'];

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-account-credential-kind-migration-'));
    process.env.DATA_DIR = dataDir;

    await import('../db/migrate.js');
    const dbModule = await import('../db/index.js');
    const migrationModule = await import('./accountCredentialKindMigrationService.js');
    db = dbModule.db;
    schema = dbModule.schema;
    migrateLegacyAccountCredentialKinds = migrationModule.migrateLegacyAccountCredentialKinds;
  });

  beforeEach(async () => {
    await db.delete(schema.events).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('upgrades every legacy kind to access_token and creates one operator notification', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'legacy-credential-site',
      url: 'https://legacy-credential.example.test',
      platform: 'new-api',
    }).returning().get();
    await db.insert(schema.accounts).values([
      { siteId: site.id, credentialMode: 'session', credential: 'first', credentialKind: 'adapter_default' },
      { siteId: site.id, credentialMode: 'session', credential: 'second', credentialKind: 'adapter_default' },
    ]).run();

    await expect(migrateLegacyAccountCredentialKinds()).resolves.toEqual({ migrated: 2 });

    const accounts = await db.select().from(schema.accounts)
      .where(eq(schema.accounts.siteId, site.id))
      .all();
    expect(accounts.map((account) => account.credentialKind)).toEqual(['access_token', 'access_token']);

    const events = await db.select().from(schema.events).all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      dedupeKey: 'migration:legacy-account-credential-kind',
      source: 'migration',
      category: 'auth',
      severity: 'warning',
    });

    await expect(migrateLegacyAccountCredentialKinds()).resolves.toEqual({ migrated: 0 });
    expect(await db.select().from(schema.events).all()).toHaveLength(1);
  });

  it('removes only legacy model-discovery health data from account extra config', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'legacy-health-site',
      url: 'https://legacy-health.example.test',
      platform: 'new-api',
    }).returning().get();
    const legacy = await db.insert(schema.accounts).values({
      siteId: site.id,
      credentialMode: 'session',
      credential: 'token',
      extraConfig: JSON.stringify({ runtimeHealth: { state: 'healthy', source: 'model-discovery' }, keep: true }),
    }).returning().get();
    const current = await db.insert(schema.accounts).values({
      siteId: site.id,
      credentialMode: 'session',
      credential: 'token',
      extraConfig: JSON.stringify({ runtimeHealth: { state: 'unhealthy', source: 'proxy-auth' }, keep: true }),
    }).returning().get();

    const { removeLegacyModelDiscoveryRuntimeHealth } = await import('./accountCredentialKindMigrationService.js');
    await expect(removeLegacyModelDiscoveryRuntimeHealth()).resolves.toBe(1);

    expect(JSON.parse((await db.select().from(schema.accounts).where(eq(schema.accounts.id, legacy.id)).get())!.extraConfig || '{}'))
      .toEqual({ keep: true });
    expect(JSON.parse((await db.select().from(schema.accounts).where(eq(schema.accounts.id, current.id)).get())!.extraConfig || '{}'))
      .toMatchObject({ runtimeHealth: { source: 'proxy-auth' }, keep: true });
  });
});
