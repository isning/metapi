import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureRouteGraphExecutionTargetEndpoint } from '../services/routeGraphExecutionTargetEndpointService.js';
import { createRouteGroupFacadeMacro } from '../services/routeGroupGraphFacadeService.js';
import { validateCompiledRouterBundle } from '../../shared/compiledRuntime.js';
import { compileRouteGraphSource } from '../../shared/routeGraph.js';
import { buildRouteRuntimeStorageArtifact } from '../services/routeRuntimeArtifactService.js';

type MigrationJournalEntry = { tag: string; when: number };

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../drizzle');

function readMigrationJournalEntries(): MigrationJournalEntry[] {
  const journalPath = join(migrationsDir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries?: MigrationJournalEntry[] };
  return journal.entries ?? [];
}

function readMigrationSql(tag: string): string {
  return readFileSync(join(migrationsDir, `${tag}.sql`), 'utf8');
}

describe('sqlite migration baseline', () => {
  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.DB_URL;
    vi.resetModules();
  });

  it('uses one clean Drizzle baseline without unreleased legacy history', () => {
    const entries = readMigrationJournalEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.tag).toBe('0000_current_route_runtime_baseline');
    const sql = readMigrationSql(entries[0]!.tag);
    for (const table of [
      'route_groups',
      'route_group_graph_bindings',
      'route_group_fallback_stages',
      'route_group_fallback_stage_graph_bindings',
      'route_group_candidates',
    ]) {
      expect(sql).not.toContain(`CREATE TABLE \`${table}\``);
      expect(sql).not.toContain(`DROP TABLE \`${table}\``);
    }
    expect(sql).toContain('CREATE TABLE `compiled_runtime_artifacts`');
    expect(sql).toContain('CREATE TABLE `compiled_runtime_active_artifact`');
    expect(sql).not.toContain('compiled_graph_json');
  });

  it('creates the Graph-native route runtime schema without retired Route Group storage', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-migrate-baseline-'));
    const dbPath = join(dataDir, 'hub.db');
    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    const migrateModule = await import('./migrate.js');
    await migrateModule.runSqliteMigrations();

    const sqlite = new Database(dbPath, { readonly: true });
    try {
      const tableRows = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      const tableNames = new Set(tableRows.map((row) => row.name));

      for (const table of [
        'route_groups',
        'route_group_graph_bindings',
        'route_group_fallback_stages',
        'route_group_fallback_stage_graph_bindings',
        'route_group_candidates',
        'route_graph_execution_target_bindings',
        'route_group_buckets',
      ]) {
        expect(tableNames.has(table)).toBe(false);
      }
      expect(tableNames.has('runtime_execution_targets')).toBe(true);
      expect(tableNames.has('runtime_execution_target_state')).toBe(true);
      expect(tableNames.has('route_graph_versions')).toBe(true);
      expect(tableNames.has('route_graph_drafts')).toBe(true);
      expect(tableNames.has('compiled_runtime_artifacts')).toBe(true);
      expect(tableNames.has('compiled_runtime_active_artifact')).toBe(true);
      expect(tableNames.has('route_runtime_day_usage')).toBe(true);
    } finally {
      sqlite.close();
    }
  });

  it('does not let SQLite bootstrap compatibility create tables before the baseline migration', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-empty-bootstrap-'));
    const dbPath = join(dataDir, 'hub.db');
    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    const dbModule = await import('./index.js');
    expect(existsSync(dbPath)).toBe(true);

    const sqlite = new Database(dbPath, { readonly: true });
    try {
      const tableRows = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>;
      expect(tableRows).toEqual([]);
    } finally {
      sqlite.close();
      await dbModule.closeDbConnections();
    }

    const migrateModule = await import('./migrate.js');
    await migrateModule.runSqliteMigrations();

    const migrated = new Database(dbPath, { readonly: true });
    try {
      const tableRows = migrated
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'downstream_api_keys'")
        .all() as Array<{ name: string }>;
      expect(tableRows).toEqual([{ name: 'downstream_api_keys' }]);
    } finally {
      migrated.close();
    }
  });

  it('upgrades an existing Drizzle lineage before adopting the current baseline', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-migrate-adoption-'));
    const dbPath = join(dataDir, 'hub.db');
    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    const migrateModule = await import('./migrate.js');
    await migrateModule.runSqliteMigrations();

    const existing = new Database(dbPath);
    try {
      existing.exec('DROP TABLE compiled_runtime_active_artifact;');
      existing.exec('DROP TABLE compiled_runtime_artifacts;');
      existing.exec('DELETE FROM __drizzle_migrations;');
      existing.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run('retired-baseline', readMigrationJournalEntries()[0]!.when - 1);
    } finally {
      existing.close();
    }

    await migrateModule.runSqliteMigrations();

    const upgraded = new Database(dbPath, { readonly: true });
    try {
      const tableNames = new Set((upgraded
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>)
        .map((row) => row.name));
      expect(tableNames.has('compiled_runtime_artifacts')).toBe(true);
      expect(tableNames.has('compiled_runtime_active_artifact')).toBe(true);
      const currentMigration = upgraded.prepare(
        'SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1',
      ).get() as { hash: string; created_at: number };
      expect(currentMigration.created_at).toBe(readMigrationJournalEntries()[0]!.when);
      expect(currentMigration.hash).not.toBe('retired-baseline');
    } finally {
      upgraded.close();
    }
  });

  it('losslessly upgrades legacy target bindings and compiled Graph storage into the current runtime', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-migrate-legacy-runtime-'));
    const dbPath = join(dataDir, 'hub.db');
    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    const migrateModule = await import('./migrate.js');
    await migrateModule.runSqliteMigrations();

    const seededEndpoint = ensureRouteGraphExecutionTargetEndpoint({ nodes: [], edges: [], macros: [] }, {
      id: 1,
      upstreamModelName: 'legacy-model',
      enabled: true,
    });
    const seededGraph = createRouteGroupFacadeMacro(seededEndpoint.source, {
      id: 'macro:legacy',
      kind: 'manual',
      modelName: 'legacy-model',
      stages: [{ members: [{ kind: 'endpoint', endpointId: seededEndpoint.endpoint.routeEndpointId }] }],
    }).source;
    const legacyEndpoint = seededGraph.nodes.find((node) => node.type === 'route_endpoint');
    if (legacyEndpoint?.type !== 'route_endpoint') throw new Error('Legacy migration fixture is missing an endpoint');
    const legacyTarget = legacyEndpoint.config.targets[0]!;
    delete legacyTarget.transportBinding;
    legacyTarget.metadata = { executionTargetId: 1 };
    legacyEndpoint.metadata = { executionTargetId: 1, upstreamModel: 'legacy-model' };

    const legacy = new Database(dbPath);
    try {
      legacy.pragma('foreign_keys = OFF');
      legacy.exec('DROP TABLE runtime_execution_targets;');
      legacy.exec(`
        CREATE TABLE runtime_execution_targets (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          execution_key TEXT NOT NULL,
          site_id INTEGER NOT NULL,
          account_id INTEGER,
          token_id INTEGER,
          oauth_route_unit_id INTEGER,
          credential_binding_id INTEGER,
          endpoint_profile_id INTEGER,
          upstream_model_name TEXT NOT NULL,
          normalized_model_name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT true,
          discovered INTEGER NOT NULL DEFAULT true,
          source TEXT NOT NULL DEFAULT 'availability_rebuild',
          metadata_json TEXT,
          created_at TEXT,
          updated_at TEXT
        );
      `);
      legacy.exec("INSERT INTO sites (id, name, url, platform, status) VALUES (1, 'legacy', 'https://legacy.test', 'openai', 'active');");
      legacy.exec("INSERT INTO runtime_execution_targets (id, execution_key, site_id, upstream_model_name, normalized_model_name) VALUES (1, 'legacy-target', 1, 'legacy-model', 'legacy-model');");
      legacy.exec('DROP TABLE route_graph_versions;');
      legacy.exec(`
        CREATE TABLE route_graph_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          version INTEGER NOT NULL,
          source_graph_json TEXT NOT NULL,
          compiled_graph_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'archived',
          created_by TEXT,
          created_at TEXT,
          activated_at TEXT
        );
      `);
      legacy.prepare(`
        INSERT INTO route_graph_versions
          (id, version, source_graph_json, compiled_graph_json, status, created_by, created_at, activated_at)
        VALUES (1, 1, ?, '{}', 'active', 'legacy-fixture', '2026-07-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z')
      `).run(JSON.stringify(seededGraph));
      legacy.exec("INSERT INTO route_graph_active_version (id, version_id, updated_at) VALUES (1, 1, '2026-07-27T00:00:00.000Z');");
      legacy.exec('DELETE FROM __drizzle_migrations;');
      legacy.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run('retired-baseline', readMigrationJournalEntries()[0]!.when - 1);
      legacy.pragma('foreign_keys = ON');
    } finally {
      legacy.close();
    }

    await migrateModule.runSqliteMigrations();

    const upgraded = new Database(dbPath, { readonly: true });
    try {
      const target = upgraded.prepare('SELECT source_ref FROM runtime_execution_targets WHERE id = 1').get() as { source_ref: string };
      expect(target.source_ref).toMatch(/^[0-9a-f-]{36}$/);
      const graphColumns = upgraded.prepare('PRAGMA table_info(route_graph_versions)').all() as Array<{ name: string }>;
      expect(graphColumns.map((column) => column.name)).not.toContain('compiled_graph_json');
      const graph = JSON.parse((upgraded.prepare('SELECT source_graph_json FROM route_graph_versions WHERE id = 1').get() as { source_graph_json: string }).source_graph_json);
      const endpoint = graph.nodes.find((node: { type: string }) => node.type === 'route_endpoint');
      expect(endpoint.config.targets[0].transportBinding).toEqual({ kind: 'execution_target', executionTargetId: 1 });
      const artifactRow = upgraded.prepare(`
        SELECT artifact_json, source_graph_version_id
        FROM compiled_runtime_artifacts
        WHERE source_graph_version_id = 1
      `).get() as { artifact_json: string; source_graph_version_id: number };
      const artifact = JSON.parse(artifactRow.artifact_json);
      expect(validateCompiledRouterBundle(artifact.compiledRouterBundle).ok).toBe(true);
      const pointer = upgraded.prepare(`
        SELECT artifact_id FROM compiled_runtime_active_artifact WHERE id = 1
      `).get() as { artifact_id: string };
      expect(pointer.artifact_id).toBeTruthy();
    } finally {
      upgraded.close();
    }
  });

  it('is idempotent after a legacy runtime upgrade', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-migrate-idempotent-runtime-'));
    const dbPath = join(dataDir, 'hub.db');
    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    const migrateModule = await import('./migrate.js');
    await migrateModule.runSqliteMigrations();

    const seededEndpoint = ensureRouteGraphExecutionTargetEndpoint({ nodes: [], edges: [], macros: [] }, {
      id: 1,
      upstreamModelName: 'legacy-idempotent-model',
      enabled: true,
    });
    const seededGraph = createRouteGroupFacadeMacro(seededEndpoint.source, {
      id: 'macro:legacy-idempotent',
      kind: 'manual',
      modelName: 'legacy-idempotent-model',
      stages: [{ members: [{ kind: 'endpoint', endpointId: seededEndpoint.endpoint.routeEndpointId }] }],
    }).source;
    const endpoint = seededGraph.nodes.find((node) => node.type === 'route_endpoint');
    if (endpoint?.type !== 'route_endpoint') throw new Error('Legacy idempotency fixture is missing an endpoint');
    const target = endpoint.config.targets[0]!;
    delete target.transportBinding;
    target.metadata = { executionTargetId: 1 };

    const legacy = new Database(dbPath);
    try {
      legacy.pragma('foreign_keys = OFF');
      legacy.exec('DROP TABLE runtime_execution_targets;');
      legacy.exec(`
        CREATE TABLE runtime_execution_targets (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          execution_key TEXT NOT NULL,
          site_id INTEGER NOT NULL,
          account_id INTEGER,
          token_id INTEGER,
          oauth_route_unit_id INTEGER,
          credential_binding_id INTEGER,
          endpoint_profile_id INTEGER,
          upstream_model_name TEXT NOT NULL,
          normalized_model_name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT true,
          discovered INTEGER NOT NULL DEFAULT true,
          source TEXT NOT NULL DEFAULT 'availability_rebuild',
          metadata_json TEXT,
          created_at TEXT,
          updated_at TEXT
        );
      `);
      legacy.exec("INSERT INTO sites (id, name, url, platform, status) VALUES (1, 'legacy-idempotent', 'https://legacy-idempotent.test', 'openai', 'active');");
      legacy.exec("INSERT INTO runtime_execution_targets (id, execution_key, site_id, upstream_model_name, normalized_model_name) VALUES (1, 'legacy-idempotent-target', 1, 'legacy-idempotent-model', 'legacy-idempotent-model');");
      legacy.exec('DROP TABLE route_graph_versions;');
      legacy.exec(`
        CREATE TABLE route_graph_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          version INTEGER NOT NULL,
          source_graph_json TEXT NOT NULL,
          compiled_graph_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'archived',
          created_by TEXT,
          created_at TEXT,
          activated_at TEXT
        );
      `);
      legacy.prepare(`
        INSERT INTO route_graph_versions
          (id, version, source_graph_json, compiled_graph_json, status, created_by, created_at, activated_at)
        VALUES (1, 1, ?, '{}', 'active', 'legacy-fixture', '2026-07-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z')
      `).run(JSON.stringify(seededGraph));
      legacy.exec("INSERT INTO route_graph_active_version (id, version_id, updated_at) VALUES (1, 1, '2026-07-27T00:00:00.000Z');");
      legacy.exec('DELETE FROM __drizzle_migrations;');
      legacy.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run('retired-baseline', readMigrationJournalEntries()[0]!.when - 1);
      legacy.pragma('foreign_keys = ON');
    } finally {
      legacy.close();
    }

    await migrateModule.runSqliteMigrations();
    const first = new Database(dbPath, { readonly: true });
    let firstSourceRef: string;
    let firstArtifactId: string;
    let firstArtifactJson: string;
    try {
      firstSourceRef = (first.prepare('SELECT source_ref FROM runtime_execution_targets WHERE id = 1').get() as { source_ref: string }).source_ref;
      const artifact = first.prepare('SELECT id, artifact_json FROM compiled_runtime_artifacts WHERE source_graph_version_id = 1').get() as { id: string; artifact_json: string };
      firstArtifactId = artifact.id;
      firstArtifactJson = artifact.artifact_json;
    } finally {
      first.close();
    }

    await migrateModule.runSqliteMigrations();

    const second = new Database(dbPath, { readonly: true });
    try {
      expect((second.prepare('SELECT source_ref FROM runtime_execution_targets WHERE id = 1').get() as { source_ref: string }).source_ref)
        .toBe(firstSourceRef!);
      expect(second.prepare('SELECT id, artifact_json FROM compiled_runtime_artifacts WHERE source_graph_version_id = 1').get())
        .toEqual({ id: firstArtifactId!, artifact_json: firstArtifactJson! });
      expect(second.prepare('SELECT artifact_id FROM compiled_runtime_active_artifact WHERE id = 1').get())
        .toEqual({ artifact_id: firstArtifactId! });
    } finally {
      second.close();
    }
  });

  it('does not mutate an old database when Graph artifact preflight fails', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-migrate-preflight-failure-'));
    const dbPath = join(dataDir, 'hub.db');
    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    const migrateModule = await import('./migrate.js');
    await migrateModule.runSqliteMigrations();

    const seededEndpoint = ensureRouteGraphExecutionTargetEndpoint({ nodes: [], edges: [], macros: [] }, {
      id: 999,
      upstreamModelName: 'missing-target-model',
      enabled: true,
    });
    const seededGraph = createRouteGroupFacadeMacro(seededEndpoint.source, {
      id: 'macro:missing-target',
      kind: 'manual',
      modelName: 'missing-target-model',
      stages: [{ members: [{ kind: 'endpoint', endpointId: seededEndpoint.endpoint.routeEndpointId }] }],
    }).source;

    const legacy = new Database(dbPath);
    try {
      legacy.pragma('foreign_keys = OFF');
      legacy.exec('DROP TABLE runtime_execution_targets;');
      legacy.exec(`
        CREATE TABLE runtime_execution_targets (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          execution_key TEXT NOT NULL,
          site_id INTEGER NOT NULL,
          account_id INTEGER,
          token_id INTEGER,
          oauth_route_unit_id INTEGER,
          credential_binding_id INTEGER,
          endpoint_profile_id INTEGER,
          upstream_model_name TEXT NOT NULL,
          normalized_model_name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT true,
          discovered INTEGER NOT NULL DEFAULT true,
          source TEXT NOT NULL DEFAULT 'availability_rebuild',
          metadata_json TEXT,
          created_at TEXT,
          updated_at TEXT
        );
      `);
      legacy.exec("INSERT INTO sites (id, name, url, platform, status) VALUES (1, 'missing-target', 'https://missing-target.test', 'openai', 'active');");
      legacy.exec("INSERT INTO runtime_execution_targets (id, execution_key, site_id, upstream_model_name, normalized_model_name) VALUES (1, 'existing-target', 1, 'existing-model', 'existing-model');");
      legacy.exec('DROP TABLE route_graph_versions;');
      legacy.exec(`
        CREATE TABLE route_graph_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          version INTEGER NOT NULL,
          source_graph_json TEXT NOT NULL,
          compiled_graph_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'archived',
          created_by TEXT,
          created_at TEXT,
          activated_at TEXT
        );
      `);
      legacy.prepare(`
        INSERT INTO route_graph_versions
          (id, version, source_graph_json, compiled_graph_json, status, created_by, created_at, activated_at)
        VALUES (1, 1, ?, '{}', 'active', 'legacy-fixture', '2026-07-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z')
      `).run(JSON.stringify(seededGraph));
      legacy.exec("INSERT INTO route_graph_active_version (id, version_id, updated_at) VALUES (1, 1, '2026-07-27T00:00:00.000Z');");
      legacy.exec('DELETE FROM __drizzle_migrations;');
      legacy.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run('retired-baseline', readMigrationJournalEntries()[0]!.when - 1);
      legacy.pragma('foreign_keys = ON');
    } finally {
      legacy.close();
    }

    await expect(migrateModule.runSqliteMigrations()).rejects.toThrow('execution targets are missing (999)');

    const unchanged = new Database(dbPath, { readonly: true });
    try {
      expect(unchanged.prepare('PRAGMA table_info(runtime_execution_targets)').all())
        .not.toContainEqual(expect.objectContaining({ name: 'source_ref' }));
      expect(unchanged.prepare('PRAGMA table_info(route_graph_versions)').all())
        .toContainEqual(expect.objectContaining({ name: 'compiled_graph_json' }));
      expect(unchanged.prepare('SELECT hash FROM __drizzle_migrations').get())
        .toEqual({ hash: 'retired-baseline' });
    } finally {
      unchanged.close();
    }
  });

  it('migrates current automatic candidate sources without changing manual Graph or artifact identity', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'metapi-migrate-current-candidate-source-'));
    const dbPath = join(dataDir, 'hub.db');
    process.env.DATA_DIR = dataDir;
    vi.resetModules();

    const migrateModule = await import('./migrate.js');
    await migrateModule.runSqliteMigrations();

    const ensured = ensureRouteGraphExecutionTargetEndpoint({ nodes: [], edges: [], macros: [] }, {
      id: 1,
      upstreamModelName: 'candidate-source-model',
      enabled: true,
    });
    const endpointId = ensured.endpoint.routeEndpointId;
    const automatic = createRouteGroupFacadeMacro(ensured.source, {
      id: 'route:managed:automatic-fixture',
      kind: 'automatic',
      modelName: 'candidate-source-model',
      stages: [{
        id: 'fallback-stage:managed:primary-fixture',
        members: [{
          kind: 'endpoint',
          memberId: 'dispatcher-member:managed:automatic-fixture',
          endpointId,
          weight: 13,
          enabled: false,
          metadata: { manualOverride: true },
        }],
      }],
      metadata: { managementOwner: 'availability-rebuild' },
    });
    automatic.macro.config.candidateSource = {
      kind: 'model_pattern',
      pattern: 'candidate-source-model',
    };
    const manual = createRouteGroupFacadeMacro(automatic.source, {
      id: 'route:managed:manual-fixture',
      kind: 'manual',
      modelName: 'manual-model',
      visibility: 'internal',
      stages: [{ members: [{ kind: 'endpoint', endpointId }] }],
    });
    const source = manual.source;
    const compiled = compileRouteGraphSource(source, { compactRuntimeBundle: true });
    expect(compiled.ok).toBe(true);
    const artifact = buildRouteRuntimeStorageArtifact(compiled.compiled);
    const automaticMacro = source.macros?.find((macro) => macro.id === 'route:managed:automatic-fixture');
    if (!automaticMacro) throw new Error('Automatic fixture macro is missing');

    const sqlite = new Database(dbPath);
    try {
      sqlite.exec("INSERT INTO sites (id, name, url, platform, status) VALUES (1, 'current-shape', 'https://current-shape.test', 'openai', 'active')");
      sqlite.exec("INSERT INTO runtime_execution_targets (id, source_ref, execution_key, site_id, upstream_model_name, normalized_model_name) VALUES (1, 'source-ref-current-shape', 'execution-key-current-shape', 1, 'candidate-source-model', 'candidate-source-model')");
      sqlite.prepare("INSERT INTO route_graph_versions (id, version, source_graph_json, status, created_by) VALUES (1, 1, ?, 'active', 'fixture')").run(JSON.stringify(source));
      sqlite.exec("INSERT INTO route_graph_active_version (id, version_id) VALUES (1, 1)");
      sqlite.prepare("INSERT INTO compiled_runtime_artifacts (id, artifact_json, bundle_hash, source_graph_version_id, source_graph_hash) VALUES ('artifact-current-shape', ?, ?, 1, 'sha256:before')")
        .run(JSON.stringify(artifact), artifact.compiledRouterBundle?.hash || artifact.hash || '');
      sqlite.exec("INSERT INTO compiled_runtime_active_artifact (id, artifact_id) VALUES (1, 'artifact-current-shape')");
      sqlite.prepare("INSERT INTO route_graph_drafts (id, base_version, revision, working_graph_json, status) VALUES (1, 1, 2, ?, 'active')").run(JSON.stringify(source));
      const operations = JSON.stringify([{ kind: 'upsert_macro', macro: automaticMacro }]);
      sqlite.prepare('INSERT INTO route_graph_workspace_operation_batches (id, draft_id, source_revision, result_revision, forward_operations_json, inverse_operations_json) VALUES (1, 1, 1, 2, ?, ?)')
        .run(operations, operations);
    } finally {
      sqlite.close();
    }

    await migrateModule.runSqliteMigrations();

    const readState = () => {
      const current = new Database(dbPath, { readonly: true });
      try {
        const graphJson = (current.prepare('SELECT source_graph_json FROM route_graph_versions WHERE id = 1').get() as { source_graph_json: string }).source_graph_json;
        const draftJson = (current.prepare('SELECT working_graph_json FROM route_graph_drafts WHERE id = 1').get() as { working_graph_json: string }).working_graph_json;
        const batch = current.prepare('SELECT forward_operations_json, inverse_operations_json FROM route_graph_workspace_operation_batches WHERE id = 1').get() as { forward_operations_json: string; inverse_operations_json: string };
        const artifactRow = current.prepare('SELECT id, artifact_json, source_graph_hash FROM compiled_runtime_artifacts WHERE source_graph_version_id = 1').get() as { id: string; artifact_json: string; source_graph_hash: string };
        const pointer = current.prepare('SELECT artifact_id FROM compiled_runtime_active_artifact WHERE id = 1').get() as { artifact_id: string };
        return { graphJson, draftJson, batch, artifactRow, pointer };
      } finally {
        current.close();
      }
    };
    const first = readState();
    const graph = JSON.parse(first.graphJson);
    const migratedAutomatic = graph.macros.find((macro: { id: string }) => macro.id === 'route:managed:automatic-fixture');
    const migratedManual = graph.macros.find((macro: { id: string }) => macro.id === 'route:managed:manual-fixture');
    expect(migratedAutomatic.config.candidateSource).toEqual({ kind: 'model_pattern', pattern: 'candidate-source-model' });
    expect(migratedAutomatic.config.groups[0]).toEqual(expect.objectContaining({
      id: 'fallback-stage:managed:primary-fixture',
      acceptUnassigned: true,
      members: [expect.objectContaining({
        memberId: 'dispatcher-member:managed:automatic-fixture',
        endpointId,
        weight: 13,
        enabled: false,
        metadata: { manualOverride: true },
      })],
    }));
    expect(migratedManual.config).not.toHaveProperty('candidateSource');
    expect(JSON.parse(first.draftJson).macros.find((macro: { id: string }) => macro.id === 'route:managed:automatic-fixture').config.candidateSource)
      .toEqual({ kind: 'model_pattern', pattern: 'candidate-source-model' });
    for (const operationsJson of [first.batch.forward_operations_json, first.batch.inverse_operations_json]) {
      expect(JSON.parse(operationsJson)[0].macro.config.candidateSource)
        .toEqual({ kind: 'model_pattern', pattern: 'candidate-source-model' });
    }
    expect(first.artifactRow.id).toBe('artifact-current-shape');
    expect(first.artifactRow.source_graph_hash).toMatch(/^sha256:/);
    expect(first.artifactRow.source_graph_hash).not.toBe('sha256:before');
    expect(validateCompiledRouterBundle(JSON.parse(first.artifactRow.artifact_json).compiledRouterBundle).ok).toBe(true);
    expect(first.pointer).toEqual({ artifact_id: 'artifact-current-shape' });

    await migrateModule.runSqliteMigrations();
    expect(readState()).toEqual(first);
  });
});
