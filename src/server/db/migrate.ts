import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from '../config.js';
import { migratePublishedMainRouteRuntime } from './mainRouteRuntimeMigration.js';
import { bootstrapRuntimeDatabaseSchema } from './runtimeSchemaBootstrap.js';
import { resolveSqliteDatabasePath } from './sqlitePath.js';

function resolveSqliteDbPath(): string {
  return resolveSqliteDatabasePath({
    dbUrl: config.dbUrl,
    dataDir: config.dataDir,
  });
}

function resolveMigrationsFolder(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
}

function hasExistingApplicationSchema(sqlite: Database.Database): boolean {
  return !!sqlite
    .prepare(
      `
    SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'
    LIMIT 1
  `,
    )
    .get();
}

function hasTable(sqlite: Database.Database, table: string): boolean {
  return !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(table);
}

function isPublishedMainSchema(sqlite: Database.Database): boolean {
  return ['sites', 'accounts', 'account_tokens', 'token_routes', 'route_channels', 'route_group_sources'].every((table) => hasTable(sqlite, table));
}

function recordPublishedMainMigrationStage(sqlite: Database.Database, stage: 'schema' | 'data' | 'complete'): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS __metapi_main_migration_state (id INTEGER PRIMARY KEY CHECK (id = 1), stage TEXT NOT NULL)`);
  sqlite
    .prepare(
      `INSERT INTO __metapi_main_migration_state (id, stage) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET stage = excluded.stage`,
    )
    .run(stage);
}

function hasRecognizedDrizzleMigration(sqlite: Database.Database, migrationsFolder: string): boolean {
  if (!hasTable(sqlite, '__drizzle_migrations')) return false;

  const migrations = readMigrationFiles({ migrationsFolder });
  if (migrations.length === 0) throw new Error('Current Drizzle migrations are missing');
  const hasMigration = sqlite.prepare('SELECT 1 FROM __drizzle_migrations WHERE hash = ? AND created_at = ? LIMIT 1');
  return migrations.some((migration) => !!hasMigration.get(migration.hash, migration.folderMillis));
}

function adoptCurrentDrizzleBaseline(sqlite: Database.Database, migrationsFolder: string): void {
  const baseline = readMigrationFiles({ migrationsFolder }).at(-1);
  if (!baseline) throw new Error('Current Drizzle baseline migration is missing');
  sqlite.exec(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, hash TEXT NOT NULL, created_at NUMERIC
  )`);
  sqlite.prepare('INSERT OR IGNORE INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(baseline.hash, baseline.folderMillis);
}

function runGeneratedSqliteMigrations(sqlite: Database.Database, migrationsFolder: string): void {
  // Drizzle emits PRAGMA foreign_keys=OFF around SQLite table rebuilds. Its
  // migrator executes statements inside a transaction, where SQLite ignores
  // that pragma. Disable enforcement before beginning the transaction so
  // generated parent-table rebuilds preserve dependent rows.
  const foreignKeysWereEnabled = sqlite.pragma('foreign_keys', { simple: true }) === 1;
  const existingViolationKeys = new Set((sqlite.pragma('foreign_key_check') as Array<Record<string, unknown>>).map((violation) => JSON.stringify(violation)));
  if (foreignKeysWereEnabled) sqlite.pragma('foreign_keys = OFF');
  try {
    migrate(drizzle(sqlite), { migrationsFolder });
    const violations = sqlite.pragma('foreign_key_check') as Array<Record<string, unknown>>;
    const introducedViolations = violations.filter((violation) => !existingViolationKeys.has(JSON.stringify(violation)));
    if (introducedViolations.length > 0) {
      throw new Error(`SQLite migration introduced ${introducedViolations.length} foreign-key violation(s).`);
    }
  } finally {
    if (foreignKeysWereEnabled) sqlite.pragma('foreign_keys = ON');
  }
}

function migrateLegacyTokenGroupCostPricings(sqlite: Database.Database): void {
  if (!hasTable(sqlite, 'upstream_model_cost_pricings')) return;
  const legacyRows = sqlite
    .prepare(
      `
    SELECT id, site_id, account_id, token_id, normalized_model_name
    FROM upstream_model_cost_pricings
    WHERE scope = 'token_model_group'
  `,
    )
    .all() as Array<{
    id: number;
    site_id: number;
    account_id: number | null;
    token_id: number | null;
    normalized_model_name: string;
  }>;
  if (legacyRows.length === 0) return;

  const hasCurrent = sqlite.prepare(`
    SELECT 1 FROM upstream_model_cost_pricings
    WHERE scope = 'token_model' AND site_id = ? AND account_id IS ? AND token_id IS ?
      AND normalized_model_name = ?
    LIMIT 1
  `);
  const deleteLegacy = sqlite.prepare('DELETE FROM upstream_model_cost_pricings WHERE id = ?');
  const upgradeLegacy = sqlite.prepare(`
    UPDATE upstream_model_cost_pricings
    SET scope = 'token_model', token_group = NULL,
        scope_key = 'token_model|site:' || site_id || '|account:' || account_id || '|token:' || token_id || '|group:-|model:' || normalized_model_name,
        updated_at = datetime('now')
    WHERE id = ?
  `);

  for (const row of legacyRows) {
    if (hasCurrent.get(row.site_id, row.account_id, row.token_id, row.normalized_model_name)) {
      deleteLegacy.run(row.id);
    } else {
      upgradeLegacy.run(row.id);
    }
  }
}

/** Applies the native schema, with one direct conversion from published main data. */
export async function runSqliteMigrations(): Promise<void> {
  const dbPath = resolveSqliteDbPath();
  const migrationsFolder = resolveMigrationsFolder();
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  try {
    const requiresPublishedMainMigration = hasExistingApplicationSchema(sqlite) && !hasRecognizedDrizzleMigration(sqlite, migrationsFolder);
    if (requiresPublishedMainMigration) {
      if (!isPublishedMainSchema(sqlite)) {
        throw new Error('Cannot migrate SQLite database: expected the published cita-777/metapi main schema.');
      }
      await bootstrapRuntimeDatabaseSchema({
        dialect: 'sqlite',
        connectionString: dbPath,
      });
      recordPublishedMainMigrationStage(sqlite, 'schema');
      migratePublishedMainRouteRuntime(sqlite);
      recordPublishedMainMigrationStage(sqlite, 'data');
      adoptCurrentDrizzleBaseline(sqlite, migrationsFolder);
      recordPublishedMainMigrationStage(sqlite, 'complete');
    }
    runGeneratedSqliteMigrations(sqlite, migrationsFolder);
    migrateLegacyTokenGroupCostPricings(sqlite);
  } finally {
    sqlite.close();
  }
  console.log('Migration complete.');
}

function isCliEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  return !!entrypoint && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isCliEntrypoint()) void runSqliteMigrations();
