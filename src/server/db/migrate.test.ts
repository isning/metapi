import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('runSqliteMigrations', () => {
  let dataDir = '';

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.DB_URL;
    vi.resetModules();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    dataDir = '';
  });

  it('applies the account credential migration to a database recorded at migration 0004', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-sqlite-migration-'));
    process.env.DATA_DIR = dataDir;
    const dbPath = join(dataDir, 'hub.db');
    process.env.DB_URL = `file://${dbPath}`;
    vi.resetModules();
    const sqlite = new Database(dbPath);
    try {
      migrate(drizzle(sqlite), { migrationsFolder: join(process.cwd(), 'drizzle') });
      sqlite.exec('ALTER TABLE accounts DROP COLUMN credential_mode');
      sqlite.exec('ALTER TABLE accounts DROP COLUMN credential_kind');
      sqlite.exec('ALTER TABLE accounts RENAME COLUMN credential TO access_token');
      sqlite.exec(`
        INSERT INTO sites (id, name, url, platform) VALUES (901, 'migration-site', 'https://example.test', 'new-api');
        INSERT INTO accounts (id, site_id, username, access_token, extra_config)
          VALUES (901, 901, 'session-user', 'opaque-session', '{"credentialMode":"session","keep":true}');
        INSERT INTO accounts (id, site_id, username, access_token, extra_config)
          VALUES (902, 901, 'api-key-user', 'opaque-model-key', '{"credentialMode":"apikey","keep":true}');
        INSERT INTO account_tokens (account_id, name, token, enabled, is_default)
          VALUES (902, 'old-default', 'older-model-key', 1, 1);
        INSERT INTO accounts (id, site_id, username, access_token, extra_config)
          VALUES (
            903,
            901,
            'oauth-user',
            'oauth-access-token',
            '{"oauth":{"provider":"codex","accountId":"legacy-id","accountKey":"legacy-key","projectId":"legacy-project","refreshToken":"refresh-token"}}'
          );
      `);
      sqlite.prepare('DELETE FROM __drizzle_migrations WHERE created_at = ?')
        .run(1786731726819);
    } finally {
      sqlite.close();
    }

    const { config } = await import('../config.js');
    config.dbUrl = process.env.DB_URL;
    const { runSqliteMigrations } = await import('./migrate.js');
    await expect(runSqliteMigrations()).resolves.toBeUndefined();

    const upgraded = new Database(dbPath, { readonly: true });
    try {
      expect(upgraded.prepare('PRAGMA table_info(accounts)').all())
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'credential_mode' }),
          expect.objectContaining({ name: 'credential' }),
          expect.objectContaining({ name: 'credential_kind' }),
        ]));
      expect(upgraded.prepare('SELECT credential_mode, credential, credential_kind, extra_config FROM accounts WHERE id = 901').get())
        .toEqual({
          credential_mode: 'session',
          credential: 'opaque-session',
          credential_kind: 'adapter_default',
          extra_config: '{"keep":true}',
        });
      expect(upgraded.prepare('SELECT credential_mode, credential, credential_kind, extra_config FROM accounts WHERE id = 902').get())
        .toEqual({
          credential_mode: 'apikey',
          credential: '',
          credential_kind: 'none',
          extra_config: '{"keep":true}',
        });
      expect(upgraded.prepare('SELECT token, enabled, is_default FROM account_tokens WHERE account_id = 902 ORDER BY id').all())
        .toEqual([
          { token: 'older-model-key', enabled: 0, is_default: 0 },
          { token: 'opaque-model-key', enabled: 1, is_default: 1 },
        ]);
      expect(upgraded.prepare(`
        SELECT credential_mode, credential, credential_kind,
          oauth_provider, oauth_account_key, oauth_project_id, extra_config
        FROM accounts WHERE id = 903
      `).get()).toEqual({
        credential_mode: 'oauth',
        credential: 'oauth-access-token',
        credential_kind: 'oauth_access_token',
        oauth_provider: 'codex',
        oauth_account_key: 'legacy-key',
        oauth_project_id: 'legacy-project',
        extra_config: '{"oauth":{"refreshToken":"refresh-token"}}',
      });
      expect(upgraded.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get())
        .toEqual({ count: readMigrationFiles({ migrationsFolder: join(process.cwd(), 'drizzle') }).length });
    } finally {
      upgraded.close();
    }
  });

  it('recovers a fully applied migration when SQLite was interrupted before Drizzle recorded it', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-sqlite-migration-recovery-'));
    process.env.DATA_DIR = dataDir;
    const dbPath = join(dataDir, 'hub.db');
    process.env.DB_URL = `file://${dbPath}`;
    const migrationsFolder = join(process.cwd(), 'drizzle');
    const sqlite = new Database(dbPath);
    try {
      migrate(drizzle(sqlite), { migrationsFolder });
      sqlite.prepare('DELETE FROM __drizzle_migrations WHERE created_at = ?').run(1786646359692);
    } finally {
      sqlite.close();
    }

    vi.resetModules();
    const { config } = await import('../config.js');
    config.dbUrl = process.env.DB_URL;
    const { runSqliteMigrations } = await import('./migrate.js');
    await expect(runSqliteMigrations()).resolves.toBeUndefined();

    const upgraded = new Database(dbPath, { readonly: true });
    try {
      expect(upgraded.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations WHERE created_at = ?')
        .get(1786646359692)).toEqual({ count: 1 });
      expect(upgraded.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'token_disabled_models'").get())
        .toBeTruthy();
    } finally {
      upgraded.close();
    }
  });

  it('converts historical token-group cost pricing to its token-level equivalent', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-token-cost-migration-'));
    process.env.DATA_DIR = dataDir;
    const dbPath = join(dataDir, 'hub.db');
    process.env.DB_URL = `file://${dbPath}`;
    const sqlite = new Database(dbPath);
    try {
      migrate(drizzle(sqlite), { migrationsFolder: join(process.cwd(), 'drizzle') });
      sqlite.pragma('foreign_keys = OFF');
      sqlite.prepare(`INSERT INTO upstream_model_cost_pricings (
        scope, scope_key, site_id, account_id, token_id, token_group, model_name, normalized_model_name,
        enabled, plan_json, plan_fingerprint, source_type, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run('token_model_group', 'legacy-group-record', 1, 2, 3, 'premium', 'gpt-test', 'gpt-test', 1, '{}', 'legacy', 'user', '{}');
    } finally {
      sqlite.close();
    }

    vi.resetModules();
    const { config } = await import('../config.js');
    config.dbUrl = process.env.DB_URL;
    const { runSqliteMigrations } = await import('./migrate.js');
    await expect(runSqliteMigrations()).resolves.toBeUndefined();

    const upgraded = new Database(dbPath, { readonly: true });
    try {
      expect(upgraded.prepare('SELECT scope, token_group, scope_key FROM upstream_model_cost_pricings').get())
        .toEqual({ scope: 'token_model', token_group: null, scope_key: 'token_model|site:1|account:2|token:3|group:-|model:gpt-test' });
    } finally {
      upgraded.close();
    }
  });

  it('keeps an existing token-model cost when removing a duplicate historical group cost', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-token-cost-migration-conflict-'));
    process.env.DATA_DIR = dataDir;
    const dbPath = join(dataDir, 'hub.db');
    process.env.DB_URL = `file://${dbPath}`;
    const sqlite = new Database(dbPath);
    try {
      migrate(drizzle(sqlite), { migrationsFolder: join(process.cwd(), 'drizzle') });
      sqlite.pragma('foreign_keys = OFF');
      const insert = sqlite.prepare(`INSERT INTO upstream_model_cost_pricings (
        scope, scope_key, site_id, account_id, token_id, token_group, model_name, normalized_model_name,
        enabled, plan_json, plan_fingerprint, source_type, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      insert.run('token_model', 'current-token-record', 1, 2, 3, null, 'gpt-test', 'gpt-test', 1, '{}', 'current', 'user', '{}');
      insert.run('token_model_group', 'legacy-group-record', 1, 2, 3, 'premium', 'gpt-test', 'gpt-test', 1, '{}', 'legacy', 'user', '{}');
    } finally {
      sqlite.close();
    }

    vi.resetModules();
    const { config } = await import('../config.js');
    config.dbUrl = process.env.DB_URL;
    const { runSqliteMigrations } = await import('./migrate.js');
    await expect(runSqliteMigrations()).resolves.toBeUndefined();

    const upgraded = new Database(dbPath, { readonly: true });
    try {
      expect(upgraded.prepare('SELECT scope, scope_key, plan_fingerprint FROM upstream_model_cost_pricings').all())
        .toEqual([{ scope: 'token_model', scope_key: 'current-token-record', plan_fingerprint: 'current' }]);
    } finally {
      upgraded.close();
    }
  });
});
