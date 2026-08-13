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

  it('applies new migrations to a database recorded at an earlier Drizzle migration', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-sqlite-migration-'));
    process.env.DATA_DIR = dataDir;
    const dbPath = join(dataDir, 'hub.db');
    process.env.DB_URL = `file://${dbPath}`;
    vi.resetModules();
    const sqlite = new Database(dbPath);
    try {
      migrate(drizzle(sqlite), { migrationsFolder: join(process.cwd(), 'drizzle') });
      sqlite.exec('ALTER TABLE site_api_endpoints DROP COLUMN base_path_mode');
      sqlite.exec('DROP TABLE token_disabled_models');
      sqlite.exec('ALTER TABLE token_model_availability DROP COLUMN is_manual');
      sqlite.exec(`CREATE INDEX upstream_model_cost_pricings_token_group_model_idx
        ON upstream_model_cost_pricings (token_id, token_group, normalized_model_name, enabled)`);
      sqlite.prepare('DELETE FROM __drizzle_migrations WHERE created_at > ?')
        .run(1785130968994);
    } finally {
      sqlite.close();
    }

    const { config } = await import('../config.js');
    config.dbUrl = process.env.DB_URL;
    const { runSqliteMigrations } = await import('./migrate.js');
    await expect(runSqliteMigrations()).resolves.toBeUndefined();

    const upgraded = new Database(dbPath, { readonly: true });
    try {
      expect(upgraded.prepare('PRAGMA table_info(site_api_endpoints)').all())
        .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'base_path_mode' })]));
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
