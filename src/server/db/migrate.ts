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

const TOKEN_MODEL_OVERRIDES_MIGRATION_CREATED_AT = 1786646359692;

function resolveSqliteDbPath(): string {
  return resolveSqliteDatabasePath({ dbUrl: config.dbUrl, dataDir: config.dataDir });
}

function resolveMigrationsFolder(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
}

function hasExistingApplicationSchema(sqlite: Database.Database): boolean {
  return !!sqlite.prepare(`
    SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'
    LIMIT 1
  `).get();
}

function hasTable(sqlite: Database.Database, table: string): boolean {
  return !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(table);
}

function isPublishedMainSchema(sqlite: Database.Database): boolean {
  return ['sites', 'accounts', 'account_tokens', 'token_routes', 'route_channels', 'route_group_sources']
    .every((table) => hasTable(sqlite, table));
}

function recordPublishedMainMigrationStage(sqlite: Database.Database, stage: 'schema' | 'data' | 'complete'): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS __metapi_main_migration_state (id INTEGER PRIMARY KEY CHECK (id = 1), stage TEXT NOT NULL)`);
  sqlite.prepare(`INSERT INTO __metapi_main_migration_state (id, stage) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET stage = excluded.stage`).run(stage);
}

function hasRecognizedDrizzleMigration(sqlite: Database.Database, migrationsFolder: string): boolean {
  if (!hasTable(sqlite, '__drizzle_migrations')) return false;

  const migrations = readMigrationFiles({ migrationsFolder });
  if (migrations.length === 0) throw new Error('Current Drizzle migrations are missing');
  const hasMigration = sqlite.prepare(
    'SELECT 1 FROM __drizzle_migrations WHERE hash = ? AND created_at = ? LIMIT 1',
  );
  return migrations.some((migration) => !!hasMigration.get(migration.hash, migration.folderMillis));
}

function adoptCurrentDrizzleBaseline(sqlite: Database.Database, migrationsFolder: string): void {
  const baseline = readMigrationFiles({ migrationsFolder }).at(-1);
  if (!baseline) throw new Error('Current Drizzle baseline migration is missing');
  sqlite.exec(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, hash TEXT NOT NULL, created_at NUMERIC
  )`);
  sqlite.prepare('INSERT OR IGNORE INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
    .run(baseline.hash, baseline.folderMillis);
}

function hasColumn(sqlite: Database.Database, table: string, column: string): boolean {
  return sqlite.prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => (
      typeof row === 'object'
      && row !== null
      && 'name' in row
      && (row as { name?: unknown }).name === column
    ));
}

function hasIndex(sqlite: Database.Database, index: string): boolean {
  return !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1")
    .get(index);
}

/**
 * SQLite can persist DDL from an interrupted migration before Drizzle writes
 * its metadata row. Adopt only this fully-verifiable migration state so the
 * next startup remains retryable without replaying already-created objects.
 */
function recoverCompletedTokenModelOverridesMigration(
  sqlite: Database.Database,
  migrationsFolder: string,
): void {
  if (!hasTable(sqlite, '__drizzle_migrations')) return;
  const migrations = readMigrationFiles({ migrationsFolder });
  const migration = migrations.find((item) => item.folderMillis === TOKEN_MODEL_OVERRIDES_MIGRATION_CREATED_AT);
  if (!migration) return;
  const recorded = sqlite.prepare(
    'SELECT 1 FROM __drizzle_migrations WHERE hash = ? AND created_at = ? LIMIT 1',
  ).get(migration.hash, migration.folderMillis);
  if (recorded) return;

  const complete = hasTable(sqlite, 'token_disabled_models')
    && hasIndex(sqlite, 'token_disabled_models_token_model_unique')
    && hasIndex(sqlite, 'token_disabled_models_token_id_idx')
    && hasColumn(sqlite, 'token_model_availability', 'is_manual');
  if (!complete) return;

  sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
    .run(migration.hash, migration.folderMillis);
  console.warn('Recovered completed Drizzle migration 0002_red_vertigo after interrupted SQLite startup.');
}

/** Applies the native schema, with one direct conversion from published main data. */
export async function runSqliteMigrations(): Promise<void> {
  const dbPath = resolveSqliteDbPath();
  const migrationsFolder = resolveMigrationsFolder();
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  try {
    const requiresPublishedMainMigration = hasExistingApplicationSchema(sqlite)
      && !hasRecognizedDrizzleMigration(sqlite, migrationsFolder);
    if (requiresPublishedMainMigration) {
      if (!isPublishedMainSchema(sqlite)) {
        throw new Error('Cannot migrate SQLite database: expected the published cita-777/metapi main schema.');
      }
      await bootstrapRuntimeDatabaseSchema({ dialect: 'sqlite', connectionString: dbPath });
      recordPublishedMainMigrationStage(sqlite, 'schema');
      migratePublishedMainRouteRuntime(sqlite);
      recordPublishedMainMigrationStage(sqlite, 'data');
      adoptCurrentDrizzleBaseline(sqlite, migrationsFolder);
      recordPublishedMainMigrationStage(sqlite, 'complete');
    }
    recoverCompletedTokenModelOverridesMigration(sqlite, migrationsFolder);
    migrate(drizzle(sqlite), { migrationsFolder });
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
