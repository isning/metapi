import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { closeDbConnections, db, schema, switchRuntimeDatabase } from '../db/index.js';
import { materializeFreshSchema } from '../db/schemaIntrospection.js';
import { publishRouteGraphSource } from './routeGraphService.js';

const execFileAsync = promisify(execFile);
const mysqlUrl = process.env.DB_PARITY_MYSQL_URL || '';
const postgresUrl = process.env.DB_PARITY_POSTGRES_URL || '';
const mysqlLive = mysqlUrl ? it : it.skip;
const postgresLive = postgresUrl ? it : it.skip;

type Dialect = 'mysql' | 'postgres';

async function installPointerFailureTrigger(dialect: Dialect, connectionString: string): Promise<() => Promise<void>> {
  if (dialect === 'mysql') {
    const connection = await mysql.createConnection({ uri: connectionString });
    try {
      await connection.query('DROP TRIGGER IF EXISTS fail_route_graph_pointer_swap');
      await connection.query(`
        CREATE TRIGGER fail_route_graph_pointer_swap
        BEFORE UPDATE ON route_graph_active_version
        FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected active pointer failure'
      `);
    } finally {
      await connection.end();
    }
    return async () => {
      const cleanup = await mysql.createConnection({ uri: connectionString });
      try { await cleanup.query('DROP TRIGGER IF EXISTS fail_route_graph_pointer_swap'); } finally { await cleanup.end(); }
    };
  }

  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await client.query(`
      CREATE OR REPLACE FUNCTION fail_route_graph_pointer_swap_fn() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected active pointer failure';
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.query('DROP TRIGGER IF EXISTS fail_route_graph_pointer_swap ON route_graph_active_version');
    await client.query(`
      CREATE TRIGGER fail_route_graph_pointer_swap
      BEFORE UPDATE ON route_graph_active_version
      FOR EACH ROW EXECUTE FUNCTION fail_route_graph_pointer_swap_fn()
    `);
  } finally {
    await client.end();
  }
  return async () => {
    const cleanup = new pg.Client({ connectionString });
    await cleanup.connect();
    try {
      await cleanup.query('DROP TRIGGER IF EXISTS fail_route_graph_pointer_swap ON route_graph_active_version');
      await cleanup.query('DROP FUNCTION IF EXISTS fail_route_graph_pointer_swap_fn()');
    } finally { await cleanup.end(); }
  };
}

async function verifyPublicationAtomicity(dialect: Dialect, connectionString: string): Promise<void> {
  try {
    await materializeFreshSchema(dialect, { connectionString });
    await switchRuntimeDatabase(dialect, connectionString, false);
    const initial = await publishRouteGraphSource({
      sourceGraph: { nodes: [], edges: [], macros: [], metadata: { publication: 'live-base' } },
      createdBy: `live-${dialect}`,
      allowDiagnostics: true,
    });
    expect(initial.ok).toBe(true);
    const before = {
      versions: await db.select().from(schema.routeGraphVersions).all(),
      artifacts: await db.select().from(schema.compiledRuntimeArtifacts).all(),
      graphPointer: await db.select().from(schema.routeGraphActiveVersion).get(),
      runtimePointer: await db.select().from(schema.compiledRuntimeActiveArtifact).get(),
    };

    const removeTrigger = await installPointerFailureTrigger(dialect, connectionString);
    try {
      await expect(publishRouteGraphSource({
        sourceGraph: { nodes: [], edges: [], macros: [], metadata: { publication: 'must-rollback' } },
        createdBy: `live-${dialect}`,
        allowDiagnostics: true,
      })).rejects.toThrow();
    } finally {
      await removeTrigger();
    }
    expect(await db.select().from(schema.routeGraphVersions).all()).toEqual(before.versions);
    expect(await db.select().from(schema.compiledRuntimeArtifacts).all()).toEqual(before.artifacts);
    expect(await db.select().from(schema.routeGraphActiveVersion).get()).toEqual(before.graphPointer);
    expect(await db.select().from(schema.compiledRuntimeActiveArtifact).get()).toEqual(before.runtimePointer);

    const barrierDir = mkdtempSync(join(tmpdir(), `metapi-route-publication-${dialect}-`));
    const barrierPath = join(barrierDir, 'barrier');
    const workerPath = new URL('../../testing/routeGraphPublicationWorker.ts', import.meta.url);
    const environment = {
      ...process.env,
      DB_TYPE: dialect,
      DB_URL: connectionString,
      DATA_DIR: barrierDir,
    };
    const runWorker = (label: string) => execFileAsync(process.execPath, [
      '--import', 'tsx', workerPath.pathname, label, barrierPath,
    ], { cwd: process.cwd(), env: environment, timeout: 30_000 });
    const first = runWorker('publisher-a');
    const second = runWorker('publisher-b');
    writeFileSync(barrierPath, 'go');
    const outcomes = await Promise.all([first, second]);
    const results = outcomes.map(({ stdout }) => JSON.parse(stdout) as { ok: boolean });
    expect(results.some((result) => result.ok)).toBe(true);

    const graphPointer = await db.select().from(schema.routeGraphActiveVersion).get();
    const runtimePointer = await db.select().from(schema.compiledRuntimeActiveArtifact).get();
    expect(graphPointer).toBeTruthy();
    expect(runtimePointer).toBeTruthy();
    const pointedArtifact = await db.select().from(schema.compiledRuntimeArtifacts)
      .where(eq(schema.compiledRuntimeArtifacts.id, runtimePointer!.artifactId)).get();
    expect(pointedArtifact?.sourceGraphVersionId).toBe(graphPointer!.versionId);

    const versions = await db.select().from(schema.routeGraphVersions).all();
    const versionIds = new Set(versions.map((row) => row.id));
    const artifacts = await db.select().from(schema.compiledRuntimeArtifacts).all();
    expect(artifacts.length).toBeGreaterThan(0);
    for (const artifact of artifacts) {
      expect(artifact.sourceGraphVersionId).not.toBeNull();
      expect(versionIds.has(artifact.sourceGraphVersionId!)).toBe(true);
    }
    expect(versions.filter((row: { status: string }) => row.status === 'active')).toEqual([
      expect.objectContaining({ id: graphPointer!.versionId }),
    ]);
  } finally {
    await closeDbConnections();
  }
}

describe('Graph publication live atomicity', () => {
  mysqlLive('is atomic and cross-process consistent on MySQL', async () => {
    await verifyPublicationAtomicity('mysql', mysqlUrl);
  }, 90_000);

  postgresLive('is atomic and cross-process consistent on Postgres', async () => {
    await verifyPublicationAtomicity('postgres', postgresUrl);
  }, 90_000);
});
