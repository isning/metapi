import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from '../config.js';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type MigrationJournalEntry = {
  tag: string;
  when: number;
};

type MigrationJournalFile = {
  entries?: MigrationJournalEntry[];
};

type SchemaMarker = {
  table: string;
  column?: string;
};

type MigrationRecord = {
  createdAt: number;
  hash: string;
};

type RecoveryMigrationRecord = MigrationRecord & {
  tag: string;
};

type RecoveryMigration = RecoveryMigrationRecord & {
  statements: string[];
};

type SqliteMigrationRecoveryLoopInput = {
  runMigrate: () => void;
  recoverDuplicateColumnMigrationError: (error: unknown) => DuplicateColumnRecoveryResult | null;
  isSitesPlatformUrlUniqueConflictError: (error: unknown) => boolean;
  deduplicateLegacySitesForUniqueIndex: () => boolean;
  closeSqlite: () => void;
  retryBudget?: number;
};

type LegacySiteRow = {
  id: number;
  platform: string;
  url: string;
};

const VERIFIED_BOOTSTRAP_TAG = '0012_account_token_value_status';
const GRAPH_NATIVE_BOOTSTRAP_TAG = '0027_route_graph_replacement';
const SQLITE_MIGRATION_RECOVERY_RETRY_BUDGET = 64;
const VERIFIED_SCHEMA_MARKERS: SchemaMarker[] = [
  { table: 'sites' },
  { table: 'settings' },
  { table: 'accounts' },
  { table: 'checkin_logs' },
  { table: 'model_availability' },
  { table: 'proxy_logs' },
  { table: 'token_routes' },
  { table: 'route_endpoint_targets', column: 'token_id' },
  { table: 'account_tokens' },
  { table: 'token_model_availability' },
  { table: 'events' },
  { table: 'sites', column: 'is_pinned' },
  { table: 'sites', column: 'sort_order' },
  { table: 'accounts', column: 'is_pinned' },
  { table: 'accounts', column: 'sort_order' },
  // 0006: site_disabled_models table
  { table: 'site_disabled_models' },
  // 0007: token_group column on account_tokens
  { table: 'account_tokens', column: 'token_group' },
  // 0009: is_manual column on model_availability
  { table: 'model_availability', column: 'is_manual' },
  // 0010: downstream_api_key_id column on proxy_logs
  { table: 'proxy_logs', column: 'downstream_api_key_id' },
  // 0011: downstream key metadata columns
  { table: 'downstream_api_keys', column: 'group_name' },
  { table: 'downstream_api_keys', column: 'tags' },
  // 0012: value_status column on account_tokens
  { table: 'account_tokens', column: 'value_status' },
  // 0019: proxy log stream/timing columns
  { table: 'proxy_logs', column: 'is_stream' },
  { table: 'proxy_logs', column: 'first_byte_latency_ms' },
];


function resolveSqliteDbPath(): string {
  const raw = (config.dbUrl || '').trim();
  if (!raw) return resolve(`${config.dataDir}/hub.db`);
  if (raw === ':memory:') return raw;
  if (raw.startsWith('file://')) {
    const parsed = new URL(raw);
    return decodeURIComponent(parsed.pathname);
  }
  if (raw.startsWith('sqlite://')) {
    return resolve(raw.slice('sqlite://'.length).trim());
  }
  return resolve(raw);
}

function resolveMigrationsFolder(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
}

function tableExists(sqlite: Database.Database, table: string): boolean {
  const row = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(table);
  return !!row;
}

function columnExists(sqlite: Database.Database, table: string, column: string): boolean {
  if (!tableExists(sqlite, table)) return false;
  const rows = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name?: string }>;
  return rows.some((row) => row.name === column);
}

function ensureUpstreamModelCostPricingScopeKey(sqlite: Database.Database): boolean {
  if (!tableExists(sqlite, 'upstream_model_cost_pricings')) return false;
  if (columnExists(sqlite, 'upstream_model_cost_pricings', 'scope_key')) return false;

  sqlite.exec('ALTER TABLE `upstream_model_cost_pricings` ADD COLUMN `scope_key` text');
  sqlite.exec(`
    UPDATE upstream_model_cost_pricings
    SET scope_key = printf(
      '%s|site:%s|account:%s|token:%s|group:%s|model:%s|row:%s',
      COALESCE(scope, 'unknown'),
      COALESCE(CAST(site_id AS TEXT), '-'),
      COALESCE(CAST(account_id AS TEXT), '-'),
      COALESCE(CAST(token_id AS TEXT), '-'),
      COALESCE(token_group, '-'),
      COALESCE(normalized_model_name, model_name, '-'),
      CAST(id AS TEXT)
    )
    WHERE scope_key IS NULL OR scope_key = ''
  `);
  return true;
}

function hasRecordedDrizzleMigrations(sqlite: Database.Database): boolean {
  if (!tableExists(sqlite, '__drizzle_migrations')) return false;
  const row = sqlite.prepare('SELECT 1 FROM __drizzle_migrations LIMIT 1').get();
  return !!row;
}

function hasVerifiedLegacySchema(sqlite: Database.Database): boolean {
  return VERIFIED_SCHEMA_MARKERS.every((marker) => (
    marker.column
      ? columnExists(sqlite, marker.table, marker.column)
      : tableExists(sqlite, marker.table)
  ));
}

function hasGraphNativeTokenRoutesReplacement(sqlite: Database.Database): boolean {
  return tableExists(sqlite, 'route_graph_versions')
    && tableExists(sqlite, 'route_graph_drafts')
    && tableExists(sqlite, 'route_graph_active_version')
    && columnExists(sqlite, 'route_endpoint_targets', 'route_endpoint_id')
    && columnExists(sqlite, 'token_routes', 'display_name')
    && !columnExists(sqlite, 'token_routes', 'model_pattern')
    && !columnExists(sqlite, 'token_routes', 'route_mode')
    && !columnExists(sqlite, 'token_routes', 'match_spec')
    && !columnExists(sqlite, 'token_routes', 'backend_spec');
}

function hasVerifiedGraphNativeSchema(sqlite: Database.Database): boolean {
  return hasGraphNativeTokenRoutesReplacement(sqlite)
    && columnExists(sqlite, 'proxy_logs', 'is_stream')
    && columnExists(sqlite, 'proxy_logs', 'first_byte_latency_ms')
    && columnExists(sqlite, 'sites', 'post_refresh_probe_latency_threshold_ms');
}

function hasAnyRouteGraphLegacyTokenRouteColumn(sqlite: Database.Database): boolean {
  return columnExists(sqlite, 'token_routes', 'model_pattern')
    || columnExists(sqlite, 'token_routes', 'route_mode')
    || columnExists(sqlite, 'token_routes', 'match_spec')
    || columnExists(sqlite, 'token_routes', 'backend_spec');
}

function hasRouteGraphScaffolding(sqlite: Database.Database): boolean {
  return tableExists(sqlite, 'route_graph_versions')
    || tableExists(sqlite, 'route_graph_drafts')
    || tableExists(sqlite, 'route_graph_active_version')
    || columnExists(sqlite, 'route_endpoint_targets', 'route_endpoint_id');
}

function selectExistingTokenRouteColumnExpression(
  sqlite: Database.Database,
  columnName: string,
  fallback: string,
): string {
  return columnExists(sqlite, 'token_routes', columnName)
    ? `"token_routes"."${columnName}"`
    : fallback;
}

function buildSqliteTokenRouteRepairStatements(sqlite: Database.Database): string[] {
  if (!tableExists(sqlite, 'token_routes') || !hasAnyRouteGraphLegacyTokenRouteColumn(sqlite)) {
    return [];
  }

  const routeModeExpr = columnExists(sqlite, 'token_routes', 'route_mode')
    ? `coalesce("token_routes"."route_mode", 'pattern')`
    : `'pattern'`;
  const displayNameExpr = columnExists(sqlite, 'token_routes', 'display_name')
    ? `"token_routes"."display_name"`
    : columnExists(sqlite, 'token_routes', 'match_spec')
      ? `json_extract("token_routes"."match_spec", '$.displayName')`
      : columnExists(sqlite, 'token_routes', 'model_pattern')
        ? `CASE WHEN ${routeModeExpr} = 'explicit_group' THEN "token_routes"."model_pattern" ELSE NULL END`
        : 'NULL';

  return [
    `CREATE TABLE "__new_token_routes" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "display_name" text,
      "display_icon" text,
      "model_mapping" text,
      "decision_snapshot" text,
      "decision_refreshed_at" text,
      "routing_strategy" text DEFAULT 'weighted',
      "enabled" integer DEFAULT true,
      "created_at" text DEFAULT (datetime('now')),
      "updated_at" text DEFAULT (datetime('now'))
    )`,
    `INSERT INTO "__new_token_routes" (
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
    SELECT
      "token_routes"."id",
      ${displayNameExpr},
      ${selectExistingTokenRouteColumnExpression(sqlite, 'display_icon', 'NULL')},
      ${selectExistingTokenRouteColumnExpression(sqlite, 'model_mapping', 'NULL')},
      ${selectExistingTokenRouteColumnExpression(sqlite, 'decision_snapshot', 'NULL')},
      ${selectExistingTokenRouteColumnExpression(sqlite, 'decision_refreshed_at', 'NULL')},
      coalesce(${selectExistingTokenRouteColumnExpression(sqlite, 'routing_strategy', 'NULL')}, 'weighted'),
      coalesce(${selectExistingTokenRouteColumnExpression(sqlite, 'enabled', 'NULL')}, true),
      coalesce(${selectExistingTokenRouteColumnExpression(sqlite, 'created_at', 'NULL')}, datetime('now')),
      coalesce(${selectExistingTokenRouteColumnExpression(sqlite, 'updated_at', 'NULL')}, datetime('now'))
    FROM "token_routes"`,
    'DROP TABLE "token_routes"',
    'ALTER TABLE "__new_token_routes" RENAME TO "token_routes"',
    'CREATE INDEX IF NOT EXISTS "token_routes_enabled_idx" ON "token_routes" ("enabled")',
  ];
}

function repairSqliteRouteGraphTokenRoutesSchema(sqlite: Database.Database): boolean {
  const statements = buildSqliteTokenRouteRepairStatements(sqlite);
  if (statements.length === 0) return false;

  sqlite.transaction(() => {
    for (const statement of statements) {
      sqlite.exec(statement);
    }
  })();
  console.warn('[db] Repaired legacy token_routes graph columns.');
  return true;
}

function readMigrationRecordsUntilTag(migrationsFolder: string, stopTag?: string): MigrationRecord[] {
  const journalPath = resolve(migrationsFolder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as MigrationJournalFile;
  const records: MigrationRecord[] = [];

  for (const entry of journal.entries ?? []) {
    const migrationSql = readFileSync(resolve(migrationsFolder, `${entry.tag}.sql`), 'utf8');
    records.push({
      createdAt: Number(entry.when),
      hash: createHash('sha256').update(migrationSql).digest('hex'),
    });

    if (stopTag && entry.tag === stopTag) {
      return records;
    }
  }

  return [];
}

function readVerifiedMigrationRecords(migrationsFolder: string): MigrationRecord[] {
  return readMigrationRecordsUntilTag(migrationsFolder, VERIFIED_BOOTSTRAP_TAG);
}

function splitMigrationStatements(sqlText: string): string[] {
  return sqlText
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function normalizeSqlForMatch(sqlText: string): string {
  return sqlText
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/["`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/;+$/g, '')
    .toLowerCase();
}

function extractFailedSqlFromError(error: unknown): string | null {
  const message = normalizeSchemaErrorMessage(error);
  const matched = message.match(/Failed to run the query '([\s\S]*?)'/i);
  const sqlText = matched?.[1]?.trim();
  return sqlText && sqlText.length > 0 ? sqlText : null;
}

function findMatchingSingleStatementMigration(
  migrationsFolder: string,
  failedSqlText: string,
): RecoveryMigrationRecord | null {
  const journalPath = resolve(migrationsFolder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as MigrationJournalFile;
  const normalizedFailedSql = normalizeSqlForMatch(failedSqlText);

  for (const entry of journal.entries ?? []) {
    const migrationSql = readFileSync(resolve(migrationsFolder, `${entry.tag}.sql`), 'utf8');
    const statements = splitMigrationStatements(migrationSql);
    if (statements.length !== 1) {
      continue;
    }

    if (normalizeSqlForMatch(statements[0]) !== normalizedFailedSql) {
      continue;
    }

    return {
      tag: entry.tag,
      createdAt: Number(entry.when),
      hash: createHash('sha256').update(migrationSql).digest('hex'),
    };
  }

  return null;
}

function findMatchingMigrationByStatement(
  migrationsFolder: string,
  failedSqlText: string,
): RecoveryMigrationRecord | null {
  const normalizedFailedSql = normalizeSqlForMatch(failedSqlText);
  const migrations = readRecoveryMigrations(migrationsFolder);

  for (const migration of migrations) {
    if (!migration.statements.some((statement) => normalizeSqlForMatch(statement) === normalizedFailedSql)) {
      continue;
    }

    return {
      tag: migration.tag,
      createdAt: migration.createdAt,
      hash: migration.hash,
    };
  }

  return null;
}

function findMatchingMigrationByErrorMessage(
  migrationsFolder: string,
  error: unknown,
): RecoveryMigrationRecord | null {
  const normalizedErrorMessage = normalizeSqlForMatch(normalizeSchemaErrorMessage(error));
  const migrations = readRecoveryMigrations(migrationsFolder);

  for (const migration of migrations) {
    if (!migration.statements.some((statement) => normalizedErrorMessage.includes(normalizeSqlForMatch(statement)))) {
      continue;
    }

    return {
      tag: migration.tag,
      createdAt: migration.createdAt,
      hash: migration.hash,
    };
  }

  return null;
}

function readRecoveryMigrations(migrationsFolder: string): RecoveryMigration[] {
  const journalPath = resolve(migrationsFolder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as MigrationJournalFile;

  return (journal.entries ?? []).map((entry) => {
    const migrationSql = readFileSync(resolve(migrationsFolder, `${entry.tag}.sql`), 'utf8');
    return {
      tag: entry.tag,
      createdAt: Number(entry.when),
      hash: createHash('sha256').update(migrationSql).digest('hex'),
      statements: splitMigrationStatements(migrationSql),
    };
  });
}

function ensureDrizzleMigrationsTable(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);
}

function markMigrationRecordIfMissing(sqlite: Database.Database, record: MigrationRecord): boolean {
  ensureDrizzleMigrationsTable(sqlite);
  const existing = sqlite
    .prepare('SELECT rowid, "created_at" FROM "__drizzle_migrations" WHERE "hash" = ? ORDER BY "created_at" DESC LIMIT 1')
    .get(record.hash) as { rowid?: number; created_at?: number } | undefined;
  if (existing) {
    if (Number(existing.created_at) === record.createdAt) {
      return false;
    }

    sqlite
      .prepare('UPDATE "__drizzle_migrations" SET "created_at" = ? WHERE rowid = ?')
      .run(record.createdAt, existing.rowid);
    return true;
  }

  sqlite
    .prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)')
    .run(record.hash, record.createdAt);

  return true;
}

function hasMigrationRecord(sqlite: Database.Database, record: MigrationRecord): boolean {
  if (!tableExists(sqlite, '__drizzle_migrations')) return false;
  const row = sqlite
    .prepare('SELECT 1 FROM "__drizzle_migrations" WHERE "hash" = ? LIMIT 1')
    .get(record.hash);
  return !!row;
}

function normalizeSchemaErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return String(error || '');
  }

  const collected: string[] = [];
  let cursor: unknown = error;
  let depth = 0;

  while (cursor && typeof cursor === 'object' && depth < 8) {
    const current = cursor as { message?: unknown; cause?: unknown };
    if (current.message !== undefined && current.message !== null) {
      const text = String(current.message).trim();
      if (text.length > 0) {
        collected.push(text);
      }
    }

    cursor = current.cause;
    depth += 1;
  }

  if (collected.length > 0) {
    return collected.join(' | ');
  }

  return String(error || '');
}

function isDuplicateColumnError(error: unknown): boolean {
  const lowered = normalizeSchemaErrorMessage(error).toLowerCase();
  return lowered.includes('duplicate column')
    || lowered.includes('already exists')
    || lowered.includes('duplicate column name');
}

function isRecoverableSchemaConflictError(error: unknown): boolean {
  const lowered = normalizeSchemaErrorMessage(error).toLowerCase();
  return lowered.includes('duplicate column')
    || lowered.includes('duplicate column name')
    || lowered.includes('already exists');
}

function isReplacedRouteGraphLegacyTokenRoutesStatement(
  sqlite: Database.Database,
  statement: string,
): boolean {
  if (!hasGraphNativeTokenRoutesReplacement(sqlite) && !hasRouteGraphScaffolding(sqlite)) {
    return false;
  }

  const normalized = normalizeSqlForMatch(statement);
  return normalized.includes('token_routes')
    && (
      normalized.includes('model_pattern')
      || normalized.includes('route_mode')
      || normalized.includes('match_spec')
      || normalized.includes('backend_spec')
      || normalized.includes('token_routes_model_pattern_idx')
      || normalized.includes('token_routes_match_spec_idx')
    );
}

function isLegacyProxyTargetBackfillStatement(
  sqlite: Database.Database,
  statement: string,
): boolean {
  const normalized = normalizeSqlForMatch(statement);
  if (
    normalized.includes('update proxy_logs')
    && normalized.includes('target_id = channel_id')
  ) {
    return !columnExists(sqlite, 'proxy_logs', 'channel_id');
  }

  if (
    normalized.includes('update proxy_debug_traces')
    && normalized.includes('sticky_hit_target_id = sticky_hit_channel_id')
  ) {
    return !columnExists(sqlite, 'proxy_debug_traces', 'sticky_hit_channel_id');
  }

  if (
    normalized.includes('update proxy_debug_traces')
    && normalized.includes('selected_target_id = selected_channel_id')
  ) {
    return !columnExists(sqlite, 'proxy_debug_traces', 'selected_channel_id');
  }

  if (
    normalized.includes('update proxy_video_tasks')
    && normalized.includes('target_id = channel_id')
  ) {
    return !columnExists(sqlite, 'proxy_video_tasks', 'channel_id');
  }

  return false;
}

function isReplayedDropMissingColumnStatement(
  sqlite: Database.Database,
  statement: string,
): boolean {
  const normalized = normalizeSqlForMatch(statement);
  const match = /^alter table ([a-z0-9_]+) drop column ([a-z0-9_]+)$/.exec(normalized);
  if (!match) {
    return false;
  }

  const [, table, column] = match;
  return !columnExists(sqlite, table, column);
}

function isReplayedWalletAcquisitionCurrencyRebuildStatement(
  sqlite: Database.Database,
  statement: string,
): boolean {
  if (!columnExists(sqlite, 'wallet_acquisition_profiles', 'wallet_unit')) {
    return false;
  }
  if (columnExists(sqlite, 'wallet_acquisition_profiles', 'wallet_currency')) {
    return false;
  }

  const normalized = normalizeSqlForMatch(statement);
  if (!normalized.includes('wallet_acquisition_profiles')) {
    return false;
  }

  return normalized.includes('wallet_acquisition_profiles_next')
    || (
      normalized.includes('drop table wallet_acquisition_profiles')
      && !normalized.includes('wallet_acquisition_profiles_')
    )
    || (
      normalized.includes('alter table wallet_acquisition_profiles_next')
      && normalized.includes('rename to wallet_acquisition_profiles')
    );
}

function isSitesPlatformUrlUniqueConflictError(error: unknown): boolean {
  const lowered = normalizeSchemaErrorMessage(error).toLowerCase();
  if (!lowered.includes('unique constraint failed: sites.platform, sites.url')) {
    return false;
  }

  const failedSqlText = extractFailedSqlFromError(error);
  if (!failedSqlText) {
    return true;
  }

  return normalizeSqlForMatch(failedSqlText)
    === normalizeSqlForMatch('CREATE UNIQUE INDEX `sites_platform_url_unique` ON `sites` (`platform`,`url`);');
}

function replayMigrationStatements(sqlite: Database.Database, statements: string[]): void {
  for (const statement of statements) {
    if (
      isReplacedRouteGraphLegacyTokenRoutesStatement(sqlite, statement)
      || isLegacyProxyTargetBackfillStatement(sqlite, statement)
      || isReplayedDropMissingColumnStatement(sqlite, statement)
      || isReplayedWalletAcquisitionCurrencyRebuildStatement(sqlite, statement)
    ) {
      continue;
    }
    try {
      sqlite.exec(statement);
    } catch (error) {
      if (isRecoverableSchemaConflictError(error)) {
        continue;
      }

      if (isSitesPlatformUrlUniqueConflictError(error) && deduplicateLegacySitesForUniqueIndex(sqlite)) {
        try {
          sqlite.exec(statement);
          continue;
        } catch (retryError) {
          if (isRecoverableSchemaConflictError(retryError)) {
            continue;
          }
          throw retryError;
        }
      }

      throw error;
    }
  }
}

function recoverMigrationSequence(
  sqlite: Database.Database,
  migrationsFolder: string,
  failedMigrationTag: string,
): number {
  const migrations = readRecoveryMigrations(migrationsFolder);
  const failedMigrationIndex = migrations.findIndex((migration) => migration.tag === failedMigrationTag);
  if (failedMigrationIndex < 0) {
    return 0;
  }

  let recoveredCount = 0;
  for (const migration of migrations.slice(0, failedMigrationIndex + 1)) {
    if (hasMigrationRecord(sqlite, migration)) {
      if (markMigrationRecordIfMissing(sqlite, migration)) {
        recoveredCount += 1;
      }
      continue;
    }

    replayMigrationStatements(sqlite, migration.statements);
    if (markMigrationRecordIfMissing(sqlite, migration)) {
      recoveredCount += 1;
    }
  }

  return recoveredCount;
}

function backfillMissingRecordedMigrations(sqlite: Database.Database, migrationsFolder: string): number {
  if (!tableExists(sqlite, '__drizzle_migrations')) return 0;

  ensureUpstreamModelCostPricingScopeKey(sqlite);

  let recoveredCount = 0;
  for (const migration of readRecoveryMigrations(migrationsFolder)) {
    if (hasMigrationRecord(sqlite, migration)) {
      if (markMigrationRecordIfMissing(sqlite, migration)) {
        recoveredCount += 1;
      }
      continue;
    }

    replayMigrationStatements(sqlite, migration.statements);
    if (markMigrationRecordIfMissing(sqlite, migration)) {
      recoveredCount += 1;
    }
  }

  if (recoveredCount > 0) {
    console.warn(`[db] Backfilled ${recoveredCount} missing drizzle migration record(s).`);
  }

  return recoveredCount;
}

type DuplicateColumnRecoveryResult = {
  tag: string;
  recoveredCount: number;
};

function recoverDuplicateColumnMigrationError(
  sqlite: Database.Database,
  migrationsFolder: string,
  error: unknown,
): DuplicateColumnRecoveryResult | null {
  if (!isDuplicateColumnError(error)) {
    return null;
  }

  const failedSqlText = extractFailedSqlFromError(error);
  const matchedMigration = failedSqlText
    ? findMatchingMigrationByStatement(migrationsFolder, failedSqlText)
      ?? findMatchingMigrationByErrorMessage(migrationsFolder, error)
    : findMatchingMigrationByErrorMessage(migrationsFolder, error);
  if (!matchedMigration) {
    return null;
  }

  const recoveredCount = recoverMigrationSequence(sqlite, migrationsFolder, matchedMigration.tag);
  if (recoveredCount > 0) {
    console.warn(`[db] Recovered duplicate-column migration sequence through ${matchedMigration.tag}.`);
  }
  return {
    tag: matchedMigration.tag,
    recoveredCount,
  };
}

function buildSqliteMigrationRetryBudgetError(error: unknown, retryBudget: number): Error {
  const detail = normalizeSchemaErrorMessage(error);
  return new Error(
    detail
      ? `[db] Migration recovery exceeded retry budget (${retryBudget} attempts): ${detail}`
      : `[db] Migration recovery exceeded retry budget (${retryBudget} attempts).`,
  );
}

function runSqliteMigrationRecoveryLoop(input: SqliteMigrationRecoveryLoopInput): void {
  const retryBudget = Math.max(1, Math.trunc(input.retryBudget ?? SQLITE_MIGRATION_RECOVERY_RETRY_BUDGET));
  let recoveryRetries = 0;

  while (true) {
    try {
      input.runMigrate();
      return;
    } catch (error) {
      const duplicateColumnRecovery = input.recoverDuplicateColumnMigrationError(error);
      if (duplicateColumnRecovery && duplicateColumnRecovery.recoveredCount > 0) {
        recoveryRetries += 1;
        if (recoveryRetries > retryBudget) {
          input.closeSqlite();
          throw buildSqliteMigrationRetryBudgetError(error, retryBudget);
        }
        continue;
      }
      if (duplicateColumnRecovery) {
        input.closeSqlite();
        throw error;
      }

      const recoveredDuplicateSites = (
        input.isSitesPlatformUrlUniqueConflictError(error)
        && input.deduplicateLegacySitesForUniqueIndex()
      );
      if (recoveredDuplicateSites) {
        recoveryRetries += 1;
        if (recoveryRetries > retryBudget) {
          input.closeSqlite();
          throw buildSqliteMigrationRetryBudgetError(error, retryBudget);
        }
        continue;
      }

      input.closeSqlite();
      throw error;
    }
  }
}

function tryRecoverDuplicateColumnMigrationError(
  sqlite: Database.Database,
  migrationsFolder: string,
  error: unknown,
): boolean {
  const recovery = recoverDuplicateColumnMigrationError(sqlite, migrationsFolder, error);
  return (recovery?.recoveredCount ?? 0) > 0;
}

function rewriteDownstreamSiteWeightMultipliers(
  sqlite: Database.Database,
  siteIdMapping: Map<number, number>,
): void {
  if (siteIdMapping.size <= 0) return;
  if (!tableExists(sqlite, 'downstream_api_keys')) return;
  if (!columnExists(sqlite, 'downstream_api_keys', 'site_weight_multipliers')) return;

  const rows = sqlite.prepare(`
    SELECT id, site_weight_multipliers
    FROM downstream_api_keys
    WHERE site_weight_multipliers IS NOT NULL
      AND TRIM(site_weight_multipliers) <> ''
  `).all() as Array<{ id: number; site_weight_multipliers: string | null }>;

  const update = sqlite.prepare('UPDATE downstream_api_keys SET site_weight_multipliers = ? WHERE id = ?');
  for (const row of rows) {
    if (!row.site_weight_multipliers) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.site_weight_multipliers);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const nextValue = { ...(parsed as Record<string, unknown>) };
    let changed = false;

    for (const [fromSiteId, toSiteId] of siteIdMapping.entries()) {
      const fromKey = String(fromSiteId);
      const toKey = String(toSiteId);
      if (!(fromKey in nextValue)) continue;
      if (!(toKey in nextValue)) {
        nextValue[toKey] = nextValue[fromKey];
      }
      delete nextValue[fromKey];
      changed = true;
    }

    if (!changed) continue;
    update.run(JSON.stringify(nextValue), row.id);
  }
}

function deduplicateLegacySitesForUniqueIndex(sqlite: Database.Database): boolean {
  const duplicateGroups = sqlite.prepare(`
    SELECT platform, url
    FROM sites
    GROUP BY platform, url
    HAVING COUNT(*) > 1
  `).all() as Array<{ platform: string; url: string }>;

  if (duplicateGroups.length <= 0) {
    return false;
  }

  const selectSitesByIdentity = sqlite.prepare(`
    SELECT id, platform, url
    FROM sites
    WHERE platform = ? AND url = ?
    ORDER BY id ASC
  `);
  const rebindAccounts = sqlite.prepare('UPDATE accounts SET site_id = ? WHERE site_id = ?');
  const mergeDisabledModels = sqlite.prepare(`
    INSERT OR IGNORE INTO site_disabled_models (site_id, model_name, created_at)
    SELECT ?, model_name, created_at
    FROM site_disabled_models
    WHERE site_id = ?
  `);
  const deleteDisabledModels = sqlite.prepare('DELETE FROM site_disabled_models WHERE site_id = ?');
  const deleteSite = sqlite.prepare('DELETE FROM sites WHERE id = ?');

  const siteIdMapping = new Map<number, number>();

  const transaction = sqlite.transaction(() => {
    for (const group of duplicateGroups) {
      const sites = selectSitesByIdentity.all(group.platform, group.url) as LegacySiteRow[];
      if (sites.length <= 1) continue;

      const canonicalSiteId = sites[0]!.id;
      for (const site of sites.slice(1)) {
        mergeDisabledModels.run(canonicalSiteId, site.id);
        deleteDisabledModels.run(site.id);
        rebindAccounts.run(canonicalSiteId, site.id);
        siteIdMapping.set(site.id, canonicalSiteId);
        deleteSite.run(site.id);
      }
    }

    rewriteDownstreamSiteWeightMultipliers(sqlite, siteIdMapping);
  });

  transaction();
  if (siteIdMapping.size > 0) {
    console.warn(`[db] Deduplicated ${siteIdMapping.size} legacy site entries before applying sites_platform_url_unique.`);
  }
  return siteIdMapping.size > 0;
}

export const __migrateTestUtils = {
  splitMigrationStatements,
  normalizeSqlForMatch,
  extractFailedSqlFromError,
  findMatchingSingleStatementMigration,
  findMatchingMigrationByStatement,
  findMatchingMigrationByErrorMessage,
  readRecoveryMigrations,
  markMigrationRecordIfMissing,
  recoverMigrationSequence,
  tryRecoverDuplicateColumnMigrationError,
  isSitesPlatformUrlUniqueConflictError,
  deduplicateLegacySitesForUniqueIndex,
  runSqliteMigrationRecoveryLoop,
  sqliteMigrationRecoveryRetryBudget: SQLITE_MIGRATION_RECOVERY_RETRY_BUDGET,
};

function bootstrapLegacyDrizzleMigrations(sqlite: Database.Database, migrationsFolder: string): boolean {
  if (hasRecordedDrizzleMigrations(sqlite)) return false;

  const bootstrapTag = hasVerifiedGraphNativeSchema(sqlite)
    ? GRAPH_NATIVE_BOOTSTRAP_TAG
    : hasVerifiedLegacySchema(sqlite)
      ? VERIFIED_BOOTSTRAP_TAG
      : null;
  if (!bootstrapTag) return false;

  const records = bootstrapTag === GRAPH_NATIVE_BOOTSTRAP_TAG
    ? readMigrationRecordsUntilTag(migrationsFolder, GRAPH_NATIVE_BOOTSTRAP_TAG)
    : readVerifiedMigrationRecords(migrationsFolder);
  if (records.length === 0) return false;

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);

  const insert = sqlite.prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)');
  const applyBootstrap = sqlite.transaction((migrations: MigrationRecord[]) => {
    for (const migrationRecord of migrations) {
      insert.run(migrationRecord.hash, migrationRecord.createdAt);
    }
  });

  applyBootstrap(records);
  console.log('[db] Bootstrapped drizzle migration journal for existing SQLite schema.');
  return true;
}

export function runSqliteMigrations(): void {
  const dbPath = resolveSqliteDbPath();
  const migrationsFolder = resolveMigrationsFolder();
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const sqlite = new Database(dbPath);
  if (hasRouteGraphScaffolding(sqlite)) {
    repairSqliteRouteGraphTokenRoutesSchema(sqlite);
  }
  bootstrapLegacyDrizzleMigrations(sqlite, migrationsFolder);
  backfillMissingRecordedMigrations(sqlite, migrationsFolder);

  runSqliteMigrationRecoveryLoop({
    runMigrate: () => {
      migrate(drizzle(sqlite), { migrationsFolder });
    },
    recoverDuplicateColumnMigrationError: (error) => (
      recoverDuplicateColumnMigrationError(sqlite, migrationsFolder, error)
    ),
    isSitesPlatformUrlUniqueConflictError,
    deduplicateLegacySitesForUniqueIndex: () => deduplicateLegacySitesForUniqueIndex(sqlite),
    closeSqlite: () => sqlite.close(),
  });

  repairSqliteRouteGraphTokenRoutesSchema(sqlite);
  sqlite.close();
  console.log('Migration complete.');
}

runSqliteMigrations();
