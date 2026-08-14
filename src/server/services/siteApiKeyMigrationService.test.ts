import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

type DbModule = typeof import('../db/index.js');
type MigrationModule = typeof import('./siteApiKeyMigrationService.js');

describe('siteApiKeyMigrationService', () => {
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let migrateSiteApiKeysToAccounts: MigrationModule['migrateSiteApiKeysToAccounts'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-site-api-key-migration-'));
    process.env.DATA_DIR = dataDir;

    await import('../db/migrate.js');
    const dbModule = await import('../db/index.js');
    const migrationModule = await import('./siteApiKeyMigrationService.js');
    db = dbModule.db;
    schema = dbModule.schema;
    migrateSiteApiKeysToAccounts = migrationModule.migrateSiteApiKeysToAccounts;
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    delete process.env.DATA_DIR;
  });

  it('deduplicates a site apiKey against its account token and clears the site field', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'legacy-site',
      url: 'https://legacy.example.com',
      platform: 'new-api',
      apiKey: 'sk-legacy-site-token',
    }).returning().get();

    const existing = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: null,
      credentialMode: 'apikey',
      credential: '',
      credentialKind: 'none',
      checkinEnabled: false,
    }).returning().get();

    await db.insert(schema.accountTokens).values({
      accountId: existing.id,
      name: 'default',
      token: 'sk-legacy-site-token',
      enabled: true,
      isDefault: true,
    }).run();

    const summary = await migrateSiteApiKeysToAccounts();

    expect(summary).toMatchObject({
      migrated: 0,
      deduped: 1,
      clearedSites: 1,
      warned: 0,
    });

    const migratedSite = await db.select().from(schema.sites).where(eq(schema.sites.id, site.id)).get();
    expect(migratedSite?.apiKey).toBeNull();

    const accounts = await db.select().from(schema.accounts).where(eq(schema.accounts.siteId, site.id)).all();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ credentialMode: 'apikey', credential: '', credentialKind: 'none' });
    expect(accounts[0]?.checkinEnabled).toBe(false);

    const tokens = await db.select().from(schema.accountTokens).where(eq(schema.accountTokens.accountId, existing.id)).all();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.token).toBe('sk-legacy-site-token');
  });

  it('creates a new apikey connection from site apiKey when no matching connection exists', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'new-site',
      url: 'https://new-site.example.com',
      platform: 'new-api',
      apiKey: 'sk-new-site-token',
    }).returning().get();

    const summary = await migrateSiteApiKeysToAccounts();

    expect(summary).toMatchObject({
      migrated: 1,
      deduped: 0,
      clearedSites: 1,
      warned: 0,
    });

    const accounts = await db.select().from(schema.accounts).where(eq(schema.accounts.siteId, site.id)).all();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ credentialMode: 'apikey', credential: '', credentialKind: 'none' });
    expect(accounts[0]?.status).toBe('active');
    const tokens = await db.select().from(schema.accountTokens).where(eq(schema.accountTokens.accountId, accounts[0]!.id)).all();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ token: 'sk-new-site-token', enabled: true, isDefault: true });
  });

  it('keeps all account token rows intact when the site key already belongs to the account', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'warn-site',
      url: 'https://warn.example.com',
      platform: 'new-api',
      apiKey: 'sk-warn-site-token',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: null,
      credentialMode: 'apikey',
      credential: '',
      credentialKind: 'none',
      checkinEnabled: false,
    }).returning().get();

    await db.insert(schema.accountTokens).values([
      {
        accountId: account.id,
        name: 'default',
        token: 'sk-warn-site-token',
        enabled: true,
        isDefault: true,
      },
      {
        accountId: account.id,
        name: 'extra',
        token: 'sk-extra-token',
        enabled: true,
        isDefault: false,
      },
    ]).run();

    const summary = await migrateSiteApiKeysToAccounts();

    expect(summary).toMatchObject({ migrated: 0, deduped: 1, clearedSites: 1, warned: 0 });

    const tokens = await db.select().from(schema.accountTokens).where(eq(schema.accountTokens.accountId, account.id)).all();
    expect(tokens).toHaveLength(2);
  });
});
