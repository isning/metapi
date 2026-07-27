import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migratePublishedMainRouteRuntime } from './mainRouteRuntimeMigration.js';

describe('published main route runtime migration', () => {
  let dataDir = '';

  afterEach(() => {
    delete process.env.DATA_DIR;
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    dataDir = '';
  });

  it('converts main token routes, channel state, and group composition into the native runtime', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-main-route-migration-'));
    process.env.DATA_DIR = dataDir;

    const dbPath = join(dataDir, 'hub.db');
    const sqlite = new Database(dbPath);
    try {
      migrate(drizzle(sqlite), { migrationsFolder: join(process.cwd(), 'drizzle') });
      sqlite.exec(`
        CREATE TABLE token_routes (id INTEGER PRIMARY KEY, model_pattern TEXT NOT NULL, display_name TEXT, enabled INTEGER, routing_strategy TEXT);
        CREATE TABLE route_channels (
          id INTEGER PRIMARY KEY, route_id INTEGER NOT NULL, account_id INTEGER NOT NULL, token_id INTEGER,
          source_model TEXT, enabled INTEGER, priority INTEGER, weight INTEGER, success_count INTEGER,
          fail_count INTEGER, total_latency_ms INTEGER, last_used_at TEXT, last_selected_at TEXT,
          last_fail_at TEXT, consecutive_fail_count INTEGER, cooldown_level INTEGER, cooldown_until TEXT
        );
        CREATE TABLE route_group_sources (group_route_id INTEGER NOT NULL, source_route_id INTEGER NOT NULL);
        INSERT INTO sites (id, name, url, platform) VALUES (1, 'main-site', 'https://example.test', 'openai');
        INSERT INTO accounts (id, site_id, access_token) VALUES (1, 1, 'account-token');
        INSERT INTO account_tokens (id, account_id, name, token) VALUES (1, 1, 'default', 'api-token');
        INSERT INTO token_routes (id, model_pattern, display_name, enabled, routing_strategy)
          VALUES (10, 'gpt-4.1', 'GPT 4.1', 1, 'round_robin');
        INSERT INTO route_channels (
          id, route_id, account_id, token_id, source_model, enabled, priority, weight,
          success_count, fail_count, total_latency_ms, consecutive_fail_count, cooldown_level
        ) VALUES (20, 10, 1, 1, 'gpt-4.1-mini', 1, 2, 7, 11, 3, 1100, 2, 1);
      `);

      expect(migratePublishedMainRouteRuntime(sqlite)).toBe(true);
      expect(migratePublishedMainRouteRuntime(sqlite)).toBe(false);

      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM runtime_execution_targets').get())
        .toEqual({ count: 1 });
      expect(sqlite.prepare('SELECT success_count, fail_count, total_latency_ms, cooldown_level FROM runtime_execution_target_state').get())
        .toEqual({ success_count: 11, fail_count: 3, total_latency_ms: 1100, cooldown_level: 1 });
      const graph = sqlite.prepare('SELECT source_graph_json FROM route_graph_versions WHERE version = 1').get() as { source_graph_json: string };
      expect(JSON.parse(graph.source_graph_json)).toMatchObject({
        macros: [expect.objectContaining({ kind: 'candidate_selector' })],
      });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM compiled_runtime_active_artifact').get())
        .toEqual({ count: 1 });
    } finally {
      sqlite.close();
    }
  });
});
