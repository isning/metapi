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

  it('applies the account credential migration to a database recorded at migration 0004', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-sqlite-migration-'));
    process.env.DATA_DIR = dataDir;
    const dbPath = join(dataDir, 'hub.db');
    process.env.DB_URL = `file://${dbPath}`;
    vi.resetModules();
    const sqlite = new Database(dbPath);
    try {
      migrate(drizzle(sqlite), {
        migrationsFolder: join(process.cwd(), 'drizzle'),
      });
      // Reconstruct the published 0004 shape before asking the migrator to
      // replay the generated credential/schema changes.
      sqlite.exec('DROP TABLE account_token_health');
      sqlite.exec('ALTER TABLE account_tokens DROP COLUMN extra_config');
      sqlite.exec('ALTER TABLE accounts DROP COLUMN credential_mode');
      sqlite.exec('ALTER TABLE accounts DROP COLUMN credential_kind');
      sqlite.exec('ALTER TABLE accounts RENAME COLUMN credential TO access_token');
      sqlite.exec('ALTER TABLE accounts ADD COLUMN unit_cost real');
      sqlite.exec('DROP INDEX proxy_debug_traces_request_id_idx');
      sqlite.exec('ALTER TABLE proxy_debug_traces DROP COLUMN request_id');
      sqlite.exec('DROP INDEX proxy_debug_attempts_execution_attempt_idx');
      sqlite.exec('ALTER TABLE proxy_debug_attempts DROP COLUMN execution_attempt_id');
      sqlite.exec('ALTER TABLE sites DROP COLUMN api_endpoint_backoff_policy');
      sqlite.exec(`
        ALTER TABLE sites ADD COLUMN post_refresh_probe_enabled integer DEFAULT false;
        ALTER TABLE sites ADD COLUMN post_refresh_probe_model text DEFAULT '';
        ALTER TABLE sites ADD COLUMN post_refresh_probe_scope text DEFAULT 'single';
        ALTER TABLE sites ADD COLUMN post_refresh_probe_latency_threshold_ms integer DEFAULT 0;
      `);
      sqlite.exec(`
        INSERT INTO sites (id, name, url, platform) VALUES (901, 'migration-site', 'https://example.test', 'new-api');
        INSERT INTO accounts (id, site_id, username, access_token, extra_config)
          VALUES (901, 901, 'session-user', 'opaque-session', '{"credentialMode":"session","keep":true}');
        INSERT INTO accounts (id, site_id, username, access_token, extra_config)
          VALUES (902, 901, 'api-key-user', 'opaque-model-key', '{"credentialMode":"apikey","keep":true}');
        INSERT INTO account_tokens (id, account_id, name, token, enabled, is_default)
          VALUES (902, 902, 'old-default', 'older-model-key', 1, 1);
        INSERT INTO api_endpoint_profiles (
          id, site_id, profile_key, api_type, label, request_method, auth_mode, enabled
        ) VALUES (901, 901, 'responses', 'responses', 'Responses', 'POST', 'bearer', 1);
        INSERT INTO credential_endpoint_bindings (
          id, site_id, account_id, token_id, credential_key, credential_kind,
          api_endpoint_profile_id, enabled, support, source
        ) VALUES (
          901, 901, 902, 902, 'token:902', 'token', 901, 1, 'supported', 'manual'
        );
        INSERT INTO model_availability (id, account_id, model_name, available)
          VALUES (901, 901, 'migration-model', 1);
        INSERT INTO token_model_availability (id, token_id, model_name, available, is_manual)
          VALUES (901, 902, 'migration-model', 1, 1);
        INSERT INTO accounts (id, site_id, username, access_token, extra_config)
          VALUES (
            903,
            901,
            'oauth-user',
            'oauth-access-token',
            '{"oauth":{"provider":"codex","accountId":"legacy-id","accountKey":"legacy-key","projectId":"legacy-project","refreshToken":"refresh-token"}}'
          );
        INSERT INTO runtime_execution_targets (
          id, source_ref, execution_key, site_id, account_id,
          upstream_model_name, normalized_model_name
        ) VALUES (
          901, 'migration-target-ref', 'migration-target-key', 901, 901,
          'migration-model', 'migration-model'
        );
        INSERT INTO runtime_execution_target_state (
          id, execution_target_id, success_count, fail_count
        ) VALUES (901, 901, 7, 2);
      `);
      sqlite.prepare('DELETE FROM __drizzle_migrations WHERE created_at >= ?').run(1786731726819);
    } finally {
      sqlite.close();
    }

    const { config } = await import('../config.js');
    config.dbUrl = process.env.DB_URL;
    const { runSqliteMigrations } = await import('./migrate.js');
    await expect(runSqliteMigrations()).resolves.toBeUndefined();

    const upgraded = new Database(dbPath, { readonly: true });
    try {
      expect(upgraded.prepare('PRAGMA table_info(accounts)').all()).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'credential_mode' }), expect.objectContaining({ name: 'credential' }), expect.objectContaining({ name: 'credential_kind' })]),
      );
      expect(upgraded.prepare('SELECT credential_mode, credential, credential_kind, extra_config FROM accounts WHERE id = 901').get()).toEqual({
        credential_mode: 'session',
        credential: 'opaque-session',
        credential_kind: 'adapter_default',
        extra_config: '{"keep":true}',
      });
      expect(upgraded.prepare('SELECT credential_mode, credential, credential_kind, extra_config FROM accounts WHERE id = 902').get()).toEqual({
        credential_mode: 'apikey',
        credential: '',
        credential_kind: 'none',
        extra_config: '{"keep":true}',
      });
      expect(upgraded.prepare('SELECT token, enabled, is_default FROM account_tokens WHERE account_id = 902 ORDER BY id').all()).toEqual([
        { token: 'older-model-key', enabled: 0, is_default: 0 },
        { token: 'opaque-model-key', enabled: 1, is_default: 1 },
      ]);
      expect(
        upgraded
          .prepare(
            `
        SELECT account_id, token_id, credential_key, api_endpoint_profile_id
        FROM credential_endpoint_bindings WHERE id = 901
      `,
          )
          .get(),
      ).toEqual({
        account_id: 902,
        token_id: 902,
        credential_key: 'token:902',
        api_endpoint_profile_id: 901,
      });
      expect(upgraded.prepare('SELECT account_id, model_name, available FROM model_availability WHERE id = 901').get()).toEqual({
        account_id: 901,
        model_name: 'migration-model',
        available: 1,
      });
      expect(upgraded.prepare('SELECT token_id, model_name, available FROM token_model_availability WHERE id = 901').get()).toEqual({ token_id: 902, model_name: 'migration-model', available: 1 });
      expect(upgraded.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(
        upgraded
          .prepare(
            `
        SELECT credential_mode, credential, credential_kind,
          oauth_provider, oauth_account_key, oauth_project_id, extra_config
        FROM accounts WHERE id = 903
      `,
          )
          .get(),
      ).toEqual({
        credential_mode: 'oauth',
        credential: 'oauth-access-token',
        credential_kind: 'oauth_access_token',
        oauth_provider: 'codex',
        oauth_account_key: 'legacy-key',
        oauth_project_id: 'legacy-project',
        extra_config: '{"oauth":{"refreshToken":"refresh-token"}}',
      });
      expect(upgraded.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get()).toEqual({
        count: readMigrationFiles({
          migrationsFolder: join(process.cwd(), 'drizzle'),
        }).length,
      });
      expect(
        upgraded
          .prepare(
            `
        SELECT id, source_ref, execution_key, site_id, account_id,
          upstream_model_name, normalized_model_name
        FROM runtime_execution_targets WHERE id = 901
      `,
          )
          .get(),
      ).toEqual({
        id: 901,
        source_ref: 'migration-target-ref',
        execution_key: 'migration-target-key',
        site_id: 901,
        account_id: 901,
        upstream_model_name: 'migration-model',
        normalized_model_name: 'migration-model',
      });
      expect(
        upgraded
          .prepare(
            `
        SELECT id, execution_target_id, success_count, fail_count
        FROM runtime_execution_target_state WHERE id = 901
      `,
          )
          .get(),
      ).toEqual({
        id: 901,
        execution_target_id: 901,
        success_count: 7,
        fail_count: 2,
      });
      expect(upgraded.pragma('foreign_key_check')).toEqual([]);
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
      migrate(drizzle(sqlite), {
        migrationsFolder: join(process.cwd(), 'drizzle'),
      });
      sqlite.pragma('foreign_keys = OFF');
      sqlite
        .prepare(
          `INSERT INTO upstream_model_cost_pricings (
        scope, scope_key, site_id, account_id, token_id, token_group, model_name, normalized_model_name,
        enabled, plan_json, plan_fingerprint, source_type, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
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
      expect(upgraded.prepare('SELECT scope, token_group, scope_key FROM upstream_model_cost_pricings').get()).toEqual({
        scope: 'token_model',
        token_group: null,
        scope_key: 'token_model|site:1|account:2|token:3|group:-|model:gpt-test',
      });
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
      migrate(drizzle(sqlite), {
        migrationsFolder: join(process.cwd(), 'drizzle'),
      });
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
      expect(upgraded.prepare('SELECT scope, scope_key, plan_fingerprint FROM upstream_model_cost_pricings').all()).toEqual([
        {
          scope: 'token_model',
          scope_key: 'current-token-record',
          plan_fingerprint: 'current',
        },
      ]);
    } finally {
      upgraded.close();
    }
  });
});
