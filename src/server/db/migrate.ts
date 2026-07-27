import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from '../config.js';
import { resolveSqliteDatabasePath } from './sqlitePath.js';
import { bootstrapRuntimeDatabaseSchema } from './runtimeSchemaBootstrap.js';
import currentSchemaContract from './generated/schemaContract.json' with { type: 'json' };
import { generateBootstrapSql } from './schemaArtifactGenerator.js';
import type { SchemaContract } from './schemaContract.js';
import {
  compileRouteGraphSource,
  normalizeRouteGraphSource,
  type RouteGraphMacro,
  type RouteGraphSource,
} from '../../shared/routeGraph.js';
import { getCompiledRouterExecutionTargetIds } from '../../shared/compiledRuntime.js';
import { isExactModelPattern } from '../../shared/modelPatternMatcher.js';
import { stableRoutingIdentityJson } from '../../shared/routingIdentity.js';
import { buildRouteRuntimeStorageArtifact } from '../services/routeRuntimeArtifactService.js';
import { migrateImportedRouteGraphSourceJson } from '../services/backupImportMigration.js';

function resolveSqliteDbPath(): string {
  return resolveSqliteDatabasePath({ dbUrl: config.dbUrl, dataDir: config.dataDir });
}

function resolveMigrationsFolder(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
}

function hasExistingApplicationSchema(sqlite: Database.Database): boolean {
  const row = sqlite.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name != '__drizzle_migrations'
    LIMIT 1
  `).get();
  return !!row;
}

type CurrentSchemaContract = SchemaContract;

function splitSqlStatements(sqlText: string): string[] {
  return sqlText
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function quotedIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQLite identifier: ${identifier}`);
  }
  return `\`${identifier}\``;
}

function hasTable(sqlite: Database.Database, table: string): boolean {
  return !!sqlite.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  ).get(table);
}

function tableColumns(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${quotedIdentifier(table)})`).all() as Array<{ name?: string }>)
    .flatMap((row) => typeof row.name === 'string' && row.name ? [row.name] : []);
}

function currentTableStatements(table: string): {
  create: string;
  indexes: string[];
  columns: string[];
} {
  const contract = currentSchemaContract as unknown as CurrentSchemaContract;
  const tableContract = contract.tables[table];
  if (!tableContract) throw new Error(`Current schema is missing table ${table}`);
  const scopedContract = {
    tables: { [table]: tableContract },
    indexes: contract.indexes.filter((index) => index.table === table),
    uniques: contract.uniques.filter((unique) => unique.table === table),
    foreignKeys: contract.foreignKeys.filter((foreignKey) => foreignKey.table === table),
  };
  const statements = splitSqlStatements(generateBootstrapSql('sqlite', scopedContract));
  const tablePattern = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const create = statements.find((statement) => new RegExp(
    `^CREATE TABLE IF NOT EXISTS [\"\\\`]${tablePattern}[\"\\\`]`,
  ).test(statement));
  if (!create) throw new Error(`Current schema bootstrap does not define ${table}`);
  return {
    create,
    indexes: statements.filter((statement) => statement !== create),
    columns: Object.keys(tableContract.columns),
  };
}

/** Rebuilds a SQLite table from the generated current schema while preserving shared columns and row ids. */
function rebuildTableFromCurrentSchema(input: {
  sqlite: Database.Database;
  table: string;
  additionalValues?: (row: Record<string, unknown>) => Record<string, unknown>;
}): void {
  const { sqlite, table } = input;
  if (!hasTable(sqlite, table)) return;
  const current = currentTableStatements(table);
  const existingColumns = new Set(tableColumns(sqlite, table));
  const additionalColumns = Object.keys(input.additionalValues?.({}) || {});
  const columns = current.columns.filter((column) => existingColumns.has(column) || additionalColumns.includes(column));
  if (columns.length !== current.columns.length) {
    const missing = current.columns.filter((column) => !columns.includes(column));
    throw new Error(`Cannot rebuild ${table}: required columns are absent (${missing.join(', ')})`);
  }
  const rows = sqlite.prepare(
    `SELECT ${current.columns.filter((column) => existingColumns.has(column)).map(quotedIdentifier).join(', ')} FROM ${quotedIdentifier(table)}`,
  ).all() as Array<Record<string, unknown>>;
  const temporaryTable = `__metapi_migration_${table}`;
  const tablePattern = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const create = current.create.replace(
    new RegExp(`^CREATE TABLE IF NOT EXISTS [\"\\\`]${tablePattern}[\"\\\`]`),
    `CREATE TABLE IF NOT EXISTS \`${temporaryTable}\``,
  );
  sqlite.pragma('foreign_keys = OFF');
  try {
    sqlite.transaction(() => {
      sqlite.exec(`DROP TABLE IF EXISTS ${quotedIdentifier(temporaryTable)}`);
      sqlite.exec(create);
      const insert = sqlite.prepare(
        `INSERT INTO ${quotedIdentifier(temporaryTable)} (${current.columns.map(quotedIdentifier).join(', ')}) VALUES (${current.columns.map(() => '?').join(', ')})`,
      );
      for (const row of rows) {
        const additional = input.additionalValues?.(row) || {};
        insert.run(...current.columns.map((column) => (
          Object.hasOwn(additional, column) ? additional[column] : row[column]
        )));
      }
      sqlite.exec(`DROP TABLE ${quotedIdentifier(table)}`);
      sqlite.exec(`ALTER TABLE ${quotedIdentifier(temporaryTable)} RENAME TO ${quotedIdentifier(table)}`);
      for (const statement of current.indexes) sqlite.exec(statement);
    })();
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }
  const foreignKeyErrors = sqlite.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeyErrors.length > 0) {
    throw new Error(`Foreign-key validation failed after rebuilding ${table}`);
  }
}

function migrateLegacyExecutionTargetSourceRefs(sqlite: Database.Database): void {
  if (!hasTable(sqlite, 'runtime_execution_targets')) return;
  if (tableColumns(sqlite, 'runtime_execution_targets').includes('source_ref')) return;
  rebuildTableFromCurrentSchema({
    sqlite,
    table: 'runtime_execution_targets',
    additionalValues: () => ({ source_ref: randomUUID() }),
  });
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sourceGraphHash(source: RouteGraphSource): string {
  return sha256(stableRoutingIdentityJson(normalizeRouteGraphSource(source)));
}

function text(value: unknown): string {
  return String(value || '').trim();
}

function automaticMacroCanonicalModel(macro: RouteGraphMacro): string | null {
  const metadataModel = text(macro.metadata?.canonicalModel);
  if (metadataModel) return metadataModel;
  const entry = macro.config.surface.entry;
  if (entry.kind !== 'external') return null;
  const entryModel = text(entry.match.requestedModelPattern);
  return entryModel && isExactModelPattern(entryModel) ? entryModel : null;
}

type CandidateSourceShapeMigration = {
  source: RouteGraphSource;
  changed: boolean;
};

/**
 * Converts the unreleased automatic Route Group facade shape into the native
 * candidate-selector contract. Only system-owned macros with an authoritative
 * canonical model are eligible; manual and ambiguous Graph authoring is left
 * untouched rather than inferred.
 */
function migrateAutomaticCandidateSourceShape(input: unknown): CandidateSourceShapeMigration {
  const source = normalizeRouteGraphSource(input);
  let changed = false;
  const macros = (source.macros || []).map((macro) => {
    const isRouteGroupAutomaticSource = (
      macro.metadata?.managementOwner === 'availability-rebuild'
      || macro.metadata?.importedFrom === 'legacy_route_backup'
    );
    if (
      macro.kind !== 'candidate_selector'
      || macro.ownership !== 'system'
      || !isRouteGroupAutomaticSource
    ) return macro;
    const canonicalModel = automaticMacroCanonicalModel(macro);
    if (!canonicalModel) {
      throw new Error(`Cannot migrate automatic candidate selector ${macro.id}: canonical model is missing or not exact`);
    }
    const primaryStageId = macro.config.groups.find(
      (stage) => stage.metadata?.generationRole === 'generated_primary',
    )?.id || macro.config.groups[0]?.id;
    if (!primaryStageId) {
      throw new Error(`Cannot migrate automatic candidate selector ${macro.id}: primary fallback stage is missing`);
    }
    const needsMigration = (
      macro.config.candidateSource?.kind !== 'model_pattern'
      || macro.config.candidateSource.pattern !== canonicalModel
      || macro.config.groups.some((stage) => (
        stage.input.kind !== 'synthetic'
        || (stage.id === primaryStageId
          ? stage.acceptUnassigned !== true
          : stage.acceptUnassigned === true)
      ))
    );
    if (!needsMigration) return macro;
    changed = true;
    return {
      ...macro,
      config: {
        ...macro.config,
        candidateSource: { kind: 'model_pattern' as const, pattern: canonicalModel },
        groups: macro.config.groups.map((stage) => ({
          ...stage,
          input: {
            kind: 'synthetic' as const,
            statusCode: 503 as const,
            message: 'No route is available.',
          },
          ...(stage.id === primaryStageId
            ? { acceptUnassigned: true }
            : { acceptUnassigned: undefined }),
        })),
      },
    };
  });
  return {
    source: changed ? normalizeRouteGraphSource({ ...source, macros }) : source,
    changed,
  };
}

function migrateWorkspaceOperationJson(value: string): { value: string; changed: boolean } {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Route Graph workspace operations must be an array');
  let changed = false;
  const operations = parsed.map((operation) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return operation;
    const record = operation as Record<string, unknown>;
    if (record.kind !== 'upsert_macro' || !record.macro) return operation;
    const migrated = migrateAutomaticCandidateSourceShape({ nodes: [], edges: [], macros: [record.macro] });
    if (!migrated.changed) return operation;
    changed = true;
    const macro = migrated.source.macros?.[0];
    if (!macro) throw new Error('Migrated Route Graph workspace macro is missing');
    return { ...record, macro };
  });
  return { value: changed ? JSON.stringify(operations) : value, changed };
}

/**
 * Migrates current-schema Graph data and its replay records atomically. Every
 * changed published Graph is compiled and target-preflighted before any row is
 * written. Existing artifact identity and active pointers remain unchanged.
 */
function migrateCurrentCandidateSourceShape(sqlite: Database.Database): void {
  if (
    !hasTable(sqlite, 'route_graph_versions')
    || !hasTable(sqlite, 'compiled_runtime_artifacts')
    || !hasTable(sqlite, 'runtime_execution_targets')
  ) return;
  sqlite.transaction(() => {
    const targetIds = new Set((sqlite.prepare(
      'SELECT id FROM runtime_execution_targets',
    ).all() as Array<{ id: number }>).map((row) => row.id));
    const versionRows = sqlite.prepare(`
      SELECT id, source_graph_json
      FROM route_graph_versions
      ORDER BY id ASC
    `).all() as Array<{ id: number; source_graph_json: string }>;
    const preparedVersions = versionRows.flatMap((row) => {
      const migrated = migrateAutomaticCandidateSourceShape(JSON.parse(row.source_graph_json));
      if (!migrated.changed) return [];
      const compiled = compileRouteGraphSource(migrated.source, { compactRuntimeBundle: true });
      if (!compiled.ok) {
        throw new Error(`Cannot migrate Source Graph ${row.id}: ${compiled.diagnostics.map((item) => item.message).join('; ')}`);
      }
      const artifact = buildRouteRuntimeStorageArtifact(compiled.compiled);
      const missingTargetIds = getCompiledRouterExecutionTargetIds(artifact.compiledRouterBundle)
        .filter((id) => !targetIds.has(id));
      if (missingTargetIds.length > 0) {
        throw new Error(`Cannot migrate Source Graph ${row.id}: execution targets are missing (${missingTargetIds.join(', ')})`);
      }
      const artifactRow = sqlite.prepare(`
        SELECT id
        FROM compiled_runtime_artifacts
        WHERE source_graph_version_id = ?
      `).get(row.id) as { id: string } | undefined;
      if (!artifactRow) {
        throw new Error(`Cannot migrate Source Graph ${row.id}: compiled runtime artifact is missing`);
      }
      return [{
        id: row.id,
        sourceGraphJson: JSON.stringify(compiled.source),
        sourceGraphHash: sourceGraphHash(compiled.source),
        artifactId: artifactRow.id,
        artifactJson: JSON.stringify(artifact),
        bundleHash: artifact.compiledRouterBundle?.hash || artifact.hash || '',
      }];
    });

    let draftRows: Array<{ id: number; working_graph_json: string }> = [];
    if (hasTable(sqlite, 'route_graph_drafts')) {
      draftRows = sqlite.prepare(
        'SELECT id, working_graph_json FROM route_graph_drafts',
      ).all() as Array<{ id: number; working_graph_json: string }>;
    }
    const preparedDrafts = draftRows.flatMap((row) => {
      const migrated = migrateAutomaticCandidateSourceShape(JSON.parse(row.working_graph_json));
      return migrated.changed
        ? [{ id: row.id, workingGraphJson: JSON.stringify(migrated.source) }]
        : [];
    });

    const operationRows = hasTable(sqlite, 'route_graph_workspace_operation_batches')
      ? sqlite.prepare(`
          SELECT id, forward_operations_json, inverse_operations_json
          FROM route_graph_workspace_operation_batches
        `).all() as Array<{
          id: number;
          forward_operations_json: string;
          inverse_operations_json: string;
        }>
      : [];
    const preparedOperations = operationRows.flatMap((row) => {
      const forward = migrateWorkspaceOperationJson(row.forward_operations_json);
      const inverse = migrateWorkspaceOperationJson(row.inverse_operations_json);
      return forward.changed || inverse.changed
        ? [{ id: row.id, forward: forward.value, inverse: inverse.value }]
        : [];
    });

    const updateVersion = sqlite.prepare(
      'UPDATE route_graph_versions SET source_graph_json = ? WHERE id = ?',
    );
    const updateArtifact = sqlite.prepare(`
      UPDATE compiled_runtime_artifacts
      SET artifact_json = ?, bundle_hash = ?, source_graph_hash = ?
      WHERE id = ?
    `);
    for (const row of preparedVersions) {
      updateVersion.run(row.sourceGraphJson, row.id);
      updateArtifact.run(row.artifactJson, row.bundleHash, row.sourceGraphHash, row.artifactId);
    }
    const updateDraft = sqlite.prepare(
      'UPDATE route_graph_drafts SET working_graph_json = ? WHERE id = ?',
    );
    for (const row of preparedDrafts) updateDraft.run(row.workingGraphJson, row.id);
    const updateOperations = sqlite.prepare(`
      UPDATE route_graph_workspace_operation_batches
      SET forward_operations_json = ?, inverse_operations_json = ?
      WHERE id = ?
    `);
    for (const row of preparedOperations) updateOperations.run(row.forward, row.inverse, row.id);
  })();
}

type PreparedLegacyCompiledRuntimeArtifacts = {
  rows: Array<{
    id: number;
    sourceGraphJson: string;
    createdAt: string | null;
    artifactId: string;
    artifactJson: string;
    bundleHash: string;
  }>;
  activeArtifactId: string | null;
};

/** Validates the complete historical Graph/artifact conversion without mutating the database. */
function prepareLegacyCompiledRuntimeArtifacts(
  sqlite: Database.Database,
): PreparedLegacyCompiledRuntimeArtifacts | null {
  if (!hasTable(sqlite, 'route_graph_versions')) return null;
  const graphColumns = tableColumns(sqlite, 'route_graph_versions');
  if (!graphColumns.includes('compiled_graph_json')) return null;
  const rows = sqlite.prepare(`
    SELECT id, source_graph_json, created_at
    FROM route_graph_versions
    ORDER BY id ASC
  `).all() as Array<{ id: number; source_graph_json: string; created_at: string | null }>;
  const targetIds = new Set((sqlite.prepare('SELECT id FROM runtime_execution_targets').all() as Array<{ id: number }>)
    .map((row) => row.id));
  const prepared = rows.map((row) => {
    const sourceGraphJson = migrateImportedRouteGraphSourceJson(row.source_graph_json);
    const compiled = compileRouteGraphSource(JSON.parse(sourceGraphJson));
    if (!compiled.ok) {
      throw new Error(`Cannot migrate Source Graph ${row.id}: ${compiled.diagnostics.map((item) => item.message).join('; ')}`);
    }
    const artifact = buildRouteRuntimeStorageArtifact(compiled.compiled);
    const missingTargetIds = getCompiledRouterExecutionTargetIds(artifact.compiledRouterBundle)
      .filter((id) => !targetIds.has(id));
    if (missingTargetIds.length > 0) {
      throw new Error(`Cannot migrate Source Graph ${row.id}: execution targets are missing (${missingTargetIds.join(', ')})`);
    }
    return {
      ...row,
      sourceGraphJson,
      artifactId: randomUUID(),
      artifactJson: JSON.stringify(artifact),
      bundleHash: artifact.compiledRouterBundle?.hash || artifact.hash || '',
    };
  });
  const activeVersion = sqlite.prepare(
    'SELECT version_id FROM route_graph_active_version WHERE id = 1',
  ).get() as { version_id?: number } | undefined;
  const active = prepared.find((row) => row.id === activeVersion?.version_id);
  if (activeVersion && !active) {
    throw new Error(`Cannot migrate active Source Graph ${activeVersion.version_id}`);
  }
  return {
    rows: prepared.map((row) => ({
      id: row.id,
      sourceGraphJson: row.sourceGraphJson,
      createdAt: row.created_at,
      artifactId: row.artifactId,
      artifactJson: row.artifactJson,
      bundleHash: row.bundleHash,
    })),
    activeArtifactId: active?.artifactId || null,
  };
}

function writePreparedLegacyCompiledRuntimeArtifacts(
  sqlite: Database.Database,
  prepared: PreparedLegacyCompiledRuntimeArtifacts | null,
): void {
  if (!prepared) return;
  sqlite.transaction(() => {
    sqlite.exec('DELETE FROM compiled_runtime_active_artifact');
    sqlite.exec('DELETE FROM compiled_runtime_artifacts');
    const updateGraph = sqlite.prepare('UPDATE route_graph_versions SET source_graph_json = ? WHERE id = ?');
    const insertArtifact = sqlite.prepare(`
      INSERT INTO compiled_runtime_artifacts
        (id, artifact_json, bundle_hash, source_graph_version_id, source_graph_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const row of prepared.rows) {
      updateGraph.run(row.sourceGraphJson, row.id);
      insertArtifact.run(
        row.artifactId,
        row.artifactJson,
        row.bundleHash,
        row.id,
        sha256(row.sourceGraphJson),
        row.createdAt || new Date().toISOString(),
      );
    }
    if (prepared.activeArtifactId) {
      sqlite.prepare(`
        INSERT INTO compiled_runtime_active_artifact (id, artifact_id, updated_at)
        VALUES (1, ?, ?)
      `).run(prepared.activeArtifactId, new Date().toISOString());
    }
  })();
  rebuildTableFromCurrentSchema({ sqlite, table: 'route_graph_versions' });
}

function migrateLegacySqliteRouteRuntime(dbPath: string): void {
  const sqlite = new Database(dbPath);
  try {
    migrateLegacyExecutionTargetSourceRefs(sqlite);
  } finally {
    sqlite.close();
  }
}

function adoptCurrentDrizzleBaseline(sqlite: Database.Database, migrationsFolder: string): boolean {
  const migrations = readMigrationFiles({ migrationsFolder });
  const baseline = migrations.at(-1);
  if (!baseline) throw new Error('Current Drizzle baseline migration is missing');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      hash TEXT NOT NULL,
      created_at NUMERIC
    )
  `);
  const exists = sqlite.prepare(
    'SELECT 1 FROM __drizzle_migrations WHERE hash = ? AND created_at = ? LIMIT 1',
  ).get(baseline.hash, baseline.folderMillis);
  if (exists) return false;
  sqlite.prepare(
    'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
  ).run(baseline.hash, baseline.folderMillis);
  return true;
}

function hasCurrentDrizzleBaseline(sqlite: Database.Database, migrationsFolder: string): boolean {
  const table = sqlite.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations' LIMIT 1",
  ).get();
  if (!table) return false;
  const baseline = readMigrationFiles({ migrationsFolder }).at(-1);
  if (!baseline) throw new Error('Current Drizzle baseline migration is missing');
  return !!sqlite.prepare(
    'SELECT 1 FROM __drizzle_migrations WHERE hash = ? AND created_at = ? LIMIT 1',
  ).get(baseline.hash, baseline.folderMillis);
}

/**
 * Applies the current Drizzle baseline. Existing application databases first
 * receive the generated current-schema upgrade and then adopt that baseline;
 * this is the only owner of the unreleased baseline transition.
 */
export async function runSqliteMigrations(): Promise<void> {
  const dbPath = resolveSqliteDbPath();
  const migrationsFolder = resolveMigrationsFolder();
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  let needsBaselineAdoption = false;
  const sqlite = new Database(dbPath);
  try {
    needsBaselineAdoption = hasExistingApplicationSchema(sqlite)
      && !hasCurrentDrizzleBaseline(sqlite, migrationsFolder);
  } finally {
    sqlite.close();
  }
  if (needsBaselineAdoption) {
    const preflight = new Database(dbPath, { readonly: true });
    let preparedArtifacts: PreparedLegacyCompiledRuntimeArtifacts | null;
    try {
      preparedArtifacts = prepareLegacyCompiledRuntimeArtifacts(preflight);
    } finally {
      preflight.close();
    }
    migrateLegacySqliteRouteRuntime(dbPath);
    await bootstrapRuntimeDatabaseSchema({ dialect: 'sqlite', connectionString: dbPath });
    const runtimeMigration = new Database(dbPath);
    try {
      writePreparedLegacyCompiledRuntimeArtifacts(runtimeMigration, preparedArtifacts);
    } finally {
      runtimeMigration.close();
    }
    const adoption = new Database(dbPath);
    try {
      adoption.transaction(() => adoptCurrentDrizzleBaseline(adoption, migrationsFolder))();
    } finally {
      adoption.close();
    }
  }
  const migrated = new Database(dbPath);
  try {
    const database = drizzle(migrated);
    migrate(database, { migrationsFolder });
    migrateCurrentCandidateSourceShape(migrated);
  } finally {
    migrated.close();
  }
  console.log('Migration complete.');
}

function isCliEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  return !!entrypoint && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isCliEntrypoint()) {
  void runSqliteMigrations();
}
