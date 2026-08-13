import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
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
      sqlite.prepare('DELETE FROM __drizzle_migrations WHERE created_at = ?').run(1786526201900);
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
        .toEqual({ count: 2 });
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
});
