import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type MigrationJournalEntry = {
  tag: string;
  when: number;
};

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../drizzle');

function readMigrationJournalEntries(): MigrationJournalEntry[] {
  const journalPath = join(migrationsDir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries?: MigrationJournalEntry[] };
  return journal.entries ?? [];
}

function applyMigrationSql(sqlite: Database.Database, sqlText: string) {
  const statements = sqlText
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    sqlite.exec(statement);
  }
}

function applyMigrationSqlToleratingExistingSchema(sqlite: Database.Database, sqlText: string) {
  const statements = sqlText
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    const normalizedStatement = statement.replace(/[\n\r\t]+/g, ' ').replace(/["`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (
      normalizedStatement.includes('update proxy_logs')
      && normalizedStatement.includes('target_id = channel_id')
      && !sqlite.prepare("SELECT 1 FROM pragma_table_info('proxy_logs') WHERE name = 'channel_id'").get()
    ) {
      continue;
    }
    if (
      normalizedStatement.includes('update proxy_debug_traces')
      && normalizedStatement.includes('sticky_hit_target_id = sticky_hit_channel_id')
      && !sqlite.prepare("SELECT 1 FROM pragma_table_info('proxy_debug_traces') WHERE name = 'sticky_hit_channel_id'").get()
    ) {
      continue;
    }
    if (
      normalizedStatement.includes('update proxy_debug_traces')
      && normalizedStatement.includes('selected_target_id = selected_channel_id')
      && !sqlite.prepare("SELECT 1 FROM pragma_table_info('proxy_debug_traces') WHERE name = 'selected_channel_id'").get()
    ) {
      continue;
    }
    if (
      normalizedStatement.includes('update proxy_video_tasks')
      && normalizedStatement.includes('target_id = channel_id')
      && !sqlite.prepare("SELECT 1 FROM pragma_table_info('proxy_video_tasks') WHERE name = 'channel_id'").get()
    ) {
      continue;
    }

    try {
      sqlite.exec(statement);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (
        message.includes('duplicate column')
        || message.includes('duplicate column name')
        || message.includes('already exists')
      ) {
        continue;
      }
      throw error;
    }
  }
}

function recordAppliedMigrations(
  sqlite: Database.Database,
  journalEntries: MigrationJournalEntry[],
) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);

  const insert = sqlite.prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)');
  for (const entry of journalEntries) {
    const sqlText = readFileSync(join(migrationsDir, `${entry.tag}.sql`), 'utf8');
    const hash = createHash('sha256').update(sqlText).digest('hex');
    insert.run(hash, entry.when);
  }
}

const STALE_JOURNAL_TIMESTAMP_DRIFT_MS = 4_196_930;

describe('sqlite migrate bootstrap', () => {
  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.DB_URL;
    vi.resetModules();
  });

  it('accepts an already-synced sqlite schema with an empty drizzle journal', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-migrate-'));
    const dbPath = join(dataDir, 'hub.db');
    const sqlite = new Database(dbPath);
    const journalEntries = readMigrationJournalEntries();

    for (const entry of journalEntries) {
      const sqlText = readFileSync(join(migrationsDir, `${entry.tag}.sql`), 'utf8');
      applyMigrationSqlToleratingExistingSchema(sqlite, sqlText);
    }

    sqlite.close();

    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    await expect(import('./migrate.js')).resolves.toMatchObject({
      runSqliteMigrations: expect.any(Function),
    });

    const verified = new Database(dbPath, { readonly: true });
    const appliedRows = verified
      .prepare('select created_at from __drizzle_migrations order by created_at asc')
      .all() as Array<{ created_at: number }>;

    expect(appliedRows.map((row) => Number(row.created_at))).toEqual(
      journalEntries.map((entry) => entry.when),
    );

    verified.close();
  });

  it('recovers from duplicate-column errors for single-statement migrations', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-migrate-recover-'));
    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    const migrateModule = await import('./migrate.js');
    const { __migrateTestUtils } = migrateModule;

    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE account_tokens (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        token_group text
      );
    `);

    const tempMigrationsDir = mkdtempSync(join(tmpdir(), 'metapi-migration-files-'));
    mkdirSync(join(tempMigrationsDir, 'meta'), { recursive: true });

    writeFileSync(
      join(tempMigrationsDir, 'meta', '_journal.json'),
      JSON.stringify({
        entries: [
          {
            tag: '0007_account_token_group',
            when: 1772500000000,
          },
        ],
      }),
    );

    writeFileSync(
      join(tempMigrationsDir, '0007_account_token_group.sql'),
      'ALTER TABLE `account_tokens` ADD `token_group` text;\n',
    );

    const duplicateColumnError = new Error(
      "DrizzleError: Failed to run the query 'ALTER TABLE `account_tokens` ADD `token_group` text;\n' duplicate column name: token_group",
    );

    const recovered = __migrateTestUtils.tryRecoverDuplicateColumnMigrationError(
      sqlite,
      tempMigrationsDir,
      duplicateColumnError,
    );

    expect(recovered).toBe(true);

    const applied = sqlite
      .prepare('SELECT hash, created_at FROM __drizzle_migrations')
      .all() as Array<{ hash: string; created_at: number }>;

    expect(applied).toHaveLength(1);
    expect(Number(applied[0].created_at)).toBe(1772500000000);

    sqlite.close();
  });

  it('recovers when duplicate-column message appears only in error cause', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-migrate-recover-cause-'));
    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    const migrateModule = await import('./migrate.js');
    const { __migrateTestUtils } = migrateModule;

    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE account_tokens (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        token_group text
      );
    `);

    const tempMigrationsDir = mkdtempSync(join(tmpdir(), 'metapi-migration-files-cause-'));
    mkdirSync(join(tempMigrationsDir, 'meta'), { recursive: true });

    writeFileSync(
      join(tempMigrationsDir, 'meta', '_journal.json'),
      JSON.stringify({
        entries: [
          {
            tag: '0007_account_token_group',
            when: 1772500000001,
          },
        ],
      }),
    );

    writeFileSync(
      join(tempMigrationsDir, '0007_account_token_group.sql'),
      'ALTER TABLE `account_tokens` ADD `token_group` text;\n',
    );

    const drizzleLikeError = {
      message: "DrizzleError: Failed to run the query 'ALTER TABLE `account_tokens` ADD `token_group` text;\n'",
      cause: {
        message: 'SqliteError: duplicate column name: token_group',
      },
    };

    const recovered = __migrateTestUtils.tryRecoverDuplicateColumnMigrationError(
      sqlite,
      tempMigrationsDir,
      drizzleLikeError,
    );

    expect(recovered).toBe(true);

    const applied = sqlite
      .prepare('SELECT hash, created_at FROM __drizzle_migrations')
      .all() as Array<{ hash: string; created_at: number }>;

    expect(applied).toHaveLength(1);
    expect(Number(applied[0].created_at)).toBe(1772500000001);

    sqlite.close();
  });

  it('updates only the latest matching migration record when reconciling stale timestamps', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-migrate-rowid-reconcile-'));
    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    const migrateModule = await import('./migrate.js');
    const { __migrateTestUtils } = migrateModule;

    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      );
    `);
    sqlite.prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)').run('same-hash', 10);
    sqlite.prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)').run('same-hash', 20);

    const changed = __migrateTestUtils.markMigrationRecordIfMissing(sqlite, {
      hash: 'same-hash',
      createdAt: 30,
    });

    const records = sqlite
      .prepare('SELECT rowid, hash, created_at FROM "__drizzle_migrations" ORDER BY rowid ASC')
      .all() as Array<{ rowid: number; hash: string; created_at: number }>;

    expect(changed).toBe(true);
    expect(records).toEqual([
      { rowid: 1, hash: 'same-hash', created_at: 10 },
      { rowid: 2, hash: 'same-hash', created_at: 30 },
    ]);

    sqlite.close();
  });

  it('recovers duplicate-column errors when the failed SQL contains quoted literals', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-migrate-recover-quoted-'));
    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    const migrateModule = await import('./migrate.js');
    const { __migrateTestUtils } = migrateModule;

    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE account_tokens (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        value_status text DEFAULT 'ready' NOT NULL
      );
    `);

    const tempMigrationsDir = mkdtempSync(join(tmpdir(), 'metapi-migration-files-quoted-'));
    mkdirSync(join(tempMigrationsDir, 'meta'), { recursive: true });

    writeFileSync(
      join(tempMigrationsDir, 'meta', '_journal.json'),
      JSON.stringify({
        entries: [
          {
            tag: '0012_account_token_value_status',
            when: 1773665311013,
          },
        ],
      }),
    );

    writeFileSync(
      join(tempMigrationsDir, '0012_account_token_value_status.sql'),
      "ALTER TABLE `account_tokens` ADD `value_status` text DEFAULT 'ready' NOT NULL;\n",
    );

    const duplicateColumnError = new Error(
      "DrizzleError: Failed to run the query 'ALTER TABLE `account_tokens` ADD `value_status` text DEFAULT 'ready' NOT NULL;\n' duplicate column name: value_status",
    );

    const recovered = __migrateTestUtils.tryRecoverDuplicateColumnMigrationError(
      sqlite,
      tempMigrationsDir,
      duplicateColumnError,
    );

    expect(recovered).toBe(true);

    const applied = sqlite
      .prepare('SELECT hash, created_at FROM __drizzle_migrations')
      .all() as Array<{ hash: string; created_at: number }>;

    expect(applied).toHaveLength(1);
    expect(Number(applied[0].created_at)).toBe(1773665311013);

    sqlite.close();
  });

  it('recovers duplicate-column errors inside multi-statement migrations by replaying the full migration', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-migrate-recover-multi-'));
    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    const migrateModule = await import('./migrate.js');
    const { __migrateTestUtils } = migrateModule;

    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE account_tokens (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        token_group text
      );
    `);

    const tempMigrationsDir = mkdtempSync(join(tmpdir(), 'metapi-migration-files-multi-'));
    mkdirSync(join(tempMigrationsDir, 'meta'), { recursive: true });

    writeFileSync(
      join(tempMigrationsDir, 'meta', '_journal.json'),
      JSON.stringify({
        entries: [
          {
            tag: '0009_model_availability_is_manual',
            when: 1772600000000,
          },
        ],
      }),
    );

    writeFileSync(
      join(tempMigrationsDir, '0009_model_availability_is_manual.sql'),
      [
        'CREATE TABLE IF NOT EXISTS `downstream_api_keys` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL);',
        'ALTER TABLE `account_tokens` ADD `token_group` text;',
      ].join('\n--> statement-breakpoint\n'),
    );

    const duplicateColumnError = new Error(
      "DrizzleError: Failed to run the query 'ALTER TABLE `account_tokens` ADD `token_group` text;\n' duplicate column name: token_group",
    );

    const recovered = __migrateTestUtils.tryRecoverDuplicateColumnMigrationError(
      sqlite,
      tempMigrationsDir,
      duplicateColumnError,
    );

    expect(recovered).toBe(true);

    const createdTable = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'downstream_api_keys'")
      .get() as { name?: string } | undefined;
    const applied = sqlite
      .prepare('SELECT hash, created_at FROM __drizzle_migrations')
      .all() as Array<{ hash: string; created_at: number }>;

    expect(createdTable?.name).toBe('downstream_api_keys');
    expect(applied).toHaveLength(1);
    expect(Number(applied[0].created_at)).toBe(1772600000000);

    sqlite.close();
  });

  it('replays missing migrations before marking a duplicate-column migration as applied', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-migrate-partial-journal-'));
    const dbPath = join(dataDir, 'hub.db');
    const sqlite = new Database(dbPath);
    const journalEntries = readMigrationJournalEntries();
    const appliedEntries = journalEntries.filter((entry) => entry.idx <= 4);

    for (const entry of appliedEntries) {
      const sqlText = readFileSync(join(migrationsDir, `${entry.tag}.sql`), 'utf8');
      applyMigrationSqlToleratingExistingSchema(sqlite, sqlText);
    }
    recordAppliedMigrations(sqlite, appliedEntries);

    // Simulate legacy compatibility code adding token_group before the formal 0007 migration ran.
    sqlite.exec('ALTER TABLE account_tokens ADD COLUMN token_group text;');
    sqlite.close();

    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    await expect(import('./migrate.js')).resolves.toMatchObject({
      runSqliteMigrations: expect.any(Function),
    });

    const verified = new Database(dbPath, { readonly: true });
    const appliedRows = verified
      .prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at ASC')
      .all() as Array<{ created_at: number }>;
    const disabledModelsTable = verified
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'site_disabled_models'")
      .get() as { name?: string } | undefined;
    const downstreamApiKeysTable = verified
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'downstream_api_keys'")
      .get() as { name?: string } | undefined;

    expect(disabledModelsTable?.name).toBe('site_disabled_models');
    expect(downstreamApiKeysTable?.name).toBe('downstream_api_keys');
    expect(appliedRows.map((row) => Number(row.created_at))).toEqual(
      journalEntries.map((entry) => entry.when),
    );

    verified.close();
  });

  it('recovers sequential duplicate-column migrations when a legacy sqlite schema predates the drizzle journal', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-migrate-legacy-schema-'));
    const dbPath = join(dataDir, 'hub.db');
    const sqlite = new Database(dbPath);
    const journalEntries = readMigrationJournalEntries();
    const appliedEntries = journalEntries.filter((entry) => entry.idx <= 17);

    for (const entry of appliedEntries) {
      const sqlText = readFileSync(join(migrationsDir, `${entry.tag}.sql`), 'utf8');
      applyMigrationSqlToleratingExistingSchema(sqlite, sqlText);
    }

    // Simulate SQLite legacy compatibility code partially adding the latest proxy log columns
    // before drizzle creates its own migration journal.
    sqlite.exec('ALTER TABLE proxy_logs ADD COLUMN is_stream integer;');
    sqlite.close();

    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    await expect(import('./migrate.js')).resolves.toMatchObject({
      runSqliteMigrations: expect.any(Function),
    });

    const verified = new Database(dbPath, { readonly: true });
    const appliedRows = verified
      .prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at ASC')
      .all() as Array<{ created_at: number }>;
    const proxyLogColumns = verified
      .prepare('PRAGMA table_info("proxy_logs")')
      .all() as Array<{ name: string }>;

    expect(appliedRows.map((row) => Number(row.created_at))).toEqual(
      journalEntries.map((entry) => entry.when),
    );
    expect(proxyLogColumns.some((column) => column.name === 'is_stream')).toBe(true);
    expect(proxyLogColumns.some((column) => column.name === 'first_byte_latency_ms')).toBe(true);

    verified.close();
  });

  it('runs the proxy target backfill migration for legacy channel columns', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-migrate-proxy-target-backfill-'));
    const dbPath = join(dataDir, 'hub.db');
    const sqlite = new Database(dbPath);
    const journalEntries = readMigrationJournalEntries();
    const appliedEntries = journalEntries.filter((entry) => entry.tag !== '0031_proxy_target_column_backfill');

    for (const entry of appliedEntries) {
      const sqlText = readFileSync(join(migrationsDir, `${entry.tag}.sql`), 'utf8');
      applyMigrationSqlToleratingExistingSchema(sqlite, sqlText);
    }
    recordAppliedMigrations(sqlite, appliedEntries);

    sqlite.exec(`
      ALTER TABLE proxy_logs ADD COLUMN channel_id integer;
      INSERT INTO proxy_logs (route_id, channel_id, account_id, model_requested)
      VALUES (1, 77, 2, 'gpt-5');

      ALTER TABLE proxy_debug_traces ADD COLUMN sticky_hit_channel_id integer;
      ALTER TABLE proxy_debug_traces ADD COLUMN selected_channel_id integer;
      INSERT INTO proxy_debug_traces (
        downstream_path,
        sticky_hit_channel_id,
        selected_channel_id,
        created_at,
        updated_at
      )
      VALUES ('/v1/responses', 88, 99, datetime('now'), datetime('now'));

      ALTER TABLE proxy_video_tasks ADD COLUMN channel_id integer;
      INSERT INTO proxy_video_tasks (
        public_id,
        upstream_video_id,
        site_url,
        token_value,
        channel_id
      )
      VALUES ('video_legacy', 'upstream_legacy', 'https://example.com', 'token', 66);
    `);
    sqlite.close();

    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    await expect(import('./migrate.js')).resolves.toMatchObject({
      runSqliteMigrations: expect.any(Function),
    });

    const verified = new Database(dbPath, { readonly: true });
    const appliedRows = verified
      .prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at ASC')
      .all() as Array<{ created_at: number }>;
    const proxyLog = verified
      .prepare('SELECT target_id FROM proxy_logs WHERE channel_id = 77 LIMIT 1')
      .get() as { target_id: number | null } | undefined;
    const proxyDebugTrace = verified
      .prepare('SELECT sticky_hit_target_id, selected_target_id FROM proxy_debug_traces WHERE selected_channel_id = 99 LIMIT 1')
      .get() as { sticky_hit_target_id: number | null; selected_target_id: number | null } | undefined;
    const proxyVideoTask = verified
      .prepare("SELECT target_id FROM proxy_video_tasks WHERE public_id = 'video_legacy'")
      .get() as { target_id: number | null } | undefined;

    expect(appliedRows.map((row) => Number(row.created_at))).toEqual(
      journalEntries.map((entry) => entry.when),
    );
    expect(proxyLog?.target_id).toBe(77);
    expect(proxyDebugTrace).toMatchObject({
      sticky_hit_target_id: 88,
      selected_target_id: 99,
    });
    expect(proxyVideoTask?.target_id).toBe(66);

    verified.close();
  });

  it('reconciles stale migration timestamps when the latest migration hash already exists', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-migrate-stale-timestamp-'));
    const dbPath = join(dataDir, 'hub.db');
    const sqlite = new Database(dbPath);
    const journalEntries = readMigrationJournalEntries();

    for (const entry of journalEntries) {
      const sqlText = readFileSync(join(migrationsDir, `${entry.tag}.sql`), 'utf8');
      applyMigrationSqlToleratingExistingSchema(sqlite, sqlText);
    }
    recordAppliedMigrations(sqlite, journalEntries);

    const latestEntry = journalEntries.at(-1);
    const latestSqlText = latestEntry
      ? readFileSync(join(migrationsDir, `${latestEntry.tag}.sql`), 'utf8')
      : '';
    const latestHash = createHash('sha256').update(latestSqlText).digest('hex');
    // Introduce about 70 minutes of timestamp drift so journal reconciliation has work to do.
    sqlite
      .prepare('UPDATE __drizzle_migrations SET created_at = ? WHERE hash = ?')
      .run((latestEntry?.when ?? 0) - STALE_JOURNAL_TIMESTAMP_DRIFT_MS, latestHash);
    sqlite.close();

    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    await expect(import('./migrate.js')).resolves.toMatchObject({
      runSqliteMigrations: expect.any(Function),
    });

    const verified = new Database(dbPath, { readonly: true });
    const latestApplied = verified
      .prepare('SELECT created_at FROM __drizzle_migrations WHERE hash = ? LIMIT 1')
      .get(latestHash) as { created_at: number } | undefined;

    expect(Number(latestApplied?.created_at)).toBe(latestEntry?.when);

    verified.close();
  });

  it('repairs token_routes schemas left with obsolete graph columns', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-migrate-token-routes-repair-'));
    const dbPath = join(dataDir, 'hub.db');
    const sqlite = new Database(dbPath);
    const journalEntries = readMigrationJournalEntries();

    sqlite.exec(`
      CREATE TABLE "token_routes" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "match_spec" TEXT NOT NULL,
        "backend_spec" TEXT NOT NULL,
        "display_name" TEXT,
        "display_icon" TEXT,
        "model_mapping" TEXT,
        "decision_snapshot" TEXT,
        "decision_refreshed_at" TEXT,
        "routing_strategy" TEXT DEFAULT 'weighted',
        "enabled" INTEGER DEFAULT true,
        "created_at" TEXT DEFAULT (datetime('now')),
        "updated_at" TEXT DEFAULT (datetime('now')),
        "route_mode" TEXT DEFAULT 'pattern'
      );

      INSERT INTO token_routes (
        id,
        match_spec,
        backend_spec,
        display_name,
        routing_strategy,
        enabled,
        created_at,
        updated_at
      )
      VALUES (
        127,
        '{"kind":"model","requestedModelPattern":"gpt-legacy-*","displayName":null}',
        '{"kind":"supply"}',
        NULL,
        'weighted',
        1,
        '2026-03-20T00:00:00.000Z',
        '2026-03-20T00:00:00.000Z'
      );

      CREATE TABLE route_graph_versions (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        version integer NOT NULL,
        source_graph_json text NOT NULL,
        compiled_graph_json text NOT NULL,
        status text DEFAULT 'archived' NOT NULL,
        created_by text DEFAULT 'system',
        created_at text DEFAULT (datetime('now')),
        activated_at text
      );
      CREATE TABLE route_graph_drafts (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        base_version integer,
        working_graph_json text NOT NULL,
        status text DEFAULT 'active' NOT NULL,
        diagnostics_json text,
        updated_at text DEFAULT (datetime('now'))
      );
      CREATE TABLE route_graph_active_version (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        version_id integer NOT NULL,
        updated_at text DEFAULT (datetime('now'))
      );
      CREATE TABLE route_endpoint_targets (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        route_id integer NOT NULL,
        route_endpoint_id text,
        account_id integer NOT NULL,
        priority integer DEFAULT 0,
        weight integer DEFAULT 10,
        enabled integer DEFAULT true,
        manual_override integer DEFAULT false
      );
    `);
    recordAppliedMigrations(sqlite, journalEntries);
    sqlite.close();

    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    await expect(import('./migrate.js')).resolves.toMatchObject({
      runSqliteMigrations: expect.any(Function),
    });

    const verified = new Database(dbPath);
    const tokenRouteColumns = verified
      .prepare('PRAGMA table_info("token_routes")')
      .all() as Array<{ name: string; notnull: number }>;
    const columnNames = tokenRouteColumns.map((column) => column.name);

    expect(columnNames).toContain('display_name');
    expect(columnNames).not.toContain('match_spec');
    expect(columnNames).not.toContain('backend_spec');
    expect(columnNames).not.toContain('route_mode');

    expect(() => {
      verified.prepare(`
        INSERT INTO "token_routes" (
          "id",
          "display_name",
          "display_icon",
          "model_mapping",
          "decision_snapshot",
          "decision_refreshed_at",
          "routing_strategy",
          "enabled",
          "created_at",
          "updated_at"
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(128, null, null, null, null, null, 'weighted', 1, '2026-03-20T00:00:00.000Z', '2026-03-20T00:00:00.000Z');
    }).not.toThrow();

    const rows = verified
      .prepare('SELECT id, display_name, routing_strategy FROM token_routes ORDER BY id ASC')
      .all();
    expect(rows).toEqual([
      { id: 127, display_name: null, routing_strategy: 'weighted' },
      { id: 128, display_name: null, routing_strategy: 'weighted' },
    ]);

    verified.close();
  });

  it('deduplicates legacy duplicate sites before applying the oauth site unique index', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-migrate-duplicate-sites-'));
    const dbPath = join(dataDir, 'hub.db');
    const sqlite = new Database(dbPath);
    const journalEntries = readMigrationJournalEntries();
    const appliedEntries = journalEntries.filter((entry) => entry.tag !== '0013_oauth_multi_provider');

    for (const entry of appliedEntries) {
      const sqlText = readFileSync(join(migrationsDir, `${entry.tag}.sql`), 'utf8');
      applyMigrationSqlToleratingExistingSchema(sqlite, sqlText);
    }
    recordAppliedMigrations(sqlite, appliedEntries);

    sqlite.exec(`
      INSERT INTO sites (id, name, url, platform, status, is_pinned, sort_order, global_weight)
      VALUES
        (101, 'Primary Codex', 'https://chatgpt.com/backend-api/codex', 'codex', 'active', 0, 0, 1),
        (202, 'Duplicate Codex', 'https://chatgpt.com/backend-api/codex', 'codex', 'disabled', 1, 9, 3);

      INSERT INTO accounts (site_id, username, access_token, status, checkin_enabled)
      VALUES
        (101, 'first@example.com', 'token-a', 'active', 0),
        (202, 'second@example.com', 'token-b', 'disabled', 0);

      INSERT INTO site_disabled_models (site_id, model_name)
      VALUES
        (101, 'gpt-5'),
        (202, 'gpt-5'),
        (202, 'gpt-5-mini');
    `);

    sqlite.close();

    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    await expect(import('./migrate.js')).resolves.toMatchObject({
      runSqliteMigrations: expect.any(Function),
    });

    const verified = new Database(dbPath, { readonly: true });
    const sites = verified
      .prepare('SELECT id, name, url, platform, status, is_pinned, sort_order, global_weight FROM sites ORDER BY id ASC')
      .all() as Array<{
      id: number;
      name: string;
      url: string;
      platform: string;
      status: string;
      is_pinned: number;
      sort_order: number;
      global_weight: number;
    }>;
    const accounts = verified
      .prepare('SELECT username, site_id FROM accounts ORDER BY username ASC')
      .all() as Array<{ username: string; site_id: number }>;
    const disabledModels = verified
      .prepare('SELECT site_id, model_name FROM site_disabled_models ORDER BY site_id ASC, model_name ASC')
      .all() as Array<{ site_id: number; model_name: string }>;

    expect(sites).toEqual([
      expect.objectContaining({
        id: 101,
        name: 'Primary Codex',
        url: 'https://chatgpt.com/backend-api/codex',
        platform: 'codex',
      }),
    ]);
    expect(accounts).toEqual([
      { username: 'first@example.com', site_id: 101 },
      { username: 'second@example.com', site_id: 101 },
    ]);
    expect(disabledModels).toEqual([
      { site_id: 101, model_name: 'gpt-5' },
      { site_id: 101, model_name: 'gpt-5-mini' },
    ]);

    verified.close();
  });

  it('fails fast when duplicate-column recovery exceeds the retry budget', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-migrate-retry-budget-'));
    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    const migrateModule = await import('./migrate.js');
    const { __migrateTestUtils } = migrateModule as {
      __migrateTestUtils: Record<string, unknown>;
    };

    const runSqliteMigrationRecoveryLoop = __migrateTestUtils
      .runSqliteMigrationRecoveryLoop as ((input: {
        runMigrate: () => void;
        recoverDuplicateColumnMigrationError: (error: unknown) => { tag: string; recoveredCount: number } | null;
        isSitesPlatformUrlUniqueConflictError: (error: unknown) => boolean;
        deduplicateLegacySitesForUniqueIndex: () => boolean;
        closeSqlite: () => void;
      }) => void) | undefined;
    const retryBudget = __migrateTestUtils.sqliteMigrationRecoveryRetryBudget as number | undefined;

    const runMigrate = vi.fn(() => {
      throw new Error('duplicate column name: token_group');
    });
    const closeSqlite = vi.fn();

    expect(runSqliteMigrationRecoveryLoop).toBeTypeOf('function');
    expect(typeof retryBudget).toBe('number');

    expect(() => runSqliteMigrationRecoveryLoop!({
      runMigrate,
      recoverDuplicateColumnMigrationError: () => ({
        tag: '0007_account_token_group',
        recoveredCount: 1,
      }),
      isSitesPlatformUrlUniqueConflictError: () => false,
      deduplicateLegacySitesForUniqueIndex: () => false,
      closeSqlite,
    })).toThrow(/retry budget/i);

    expect(runMigrate).toHaveBeenCalledTimes((retryBudget ?? 0) + 1);
    expect(closeSqlite).toHaveBeenCalledTimes(1);
  });
});
