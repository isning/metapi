import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import pg from 'pg';
import { drizzle as drizzleSqliteProxy } from 'drizzle-orm/sqlite-proxy';
import { drizzle as drizzleMysqlProxy } from 'drizzle-orm/mysql-proxy';
import { drizzle as drizzlePgProxy } from 'drizzle-orm/pg-proxy';
import { is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from './schema.js';
import {
  installPostgresJsonTextParsers,
  resetPostgresJsonTextParsersInstallStateForTests,
} from './postgresJsonTextParsers.js';
import { ensureSiteSchemaCompatibility, type SiteSchemaInspector } from './siteSchemaCompatibility.js';
import { ensureProxyFileSchemaCompatibility } from './proxyFileSchemaCompatibility.js';
import {
  executeSchemaBootstrapCompatibility,
  executeSchemaBootstrapCompatibilitySync,
} from './schemaBootstrapCompatibility.js';
import { config } from '../config.js';
import { ensureRuntimeDatabaseReady } from '../runtimeDatabaseBootstrap.js';
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { resolveSqliteDatabasePath } from './sqlitePath.js';

export type RuntimeDbDialect = 'sqlite' | 'mysql' | 'postgres';
type SqlMethod = 'all' | 'get' | 'run' | 'values' | 'execute';

const TABLES_WITH_NUMERIC_ID = new Set(
  Object.values(schema)
    .filter((value) => is(value, SQLiteTable))
    .map((table) => getTableConfig(table as SQLiteTable))
    .filter((table) => table.columns.some((column) => (
      column.name === 'id' && column.primary && column.dataType === 'number'
    )))
    .map((table) => table.name),
);

export let runtimeDbDialect: RuntimeDbDialect = config.dbType;

let sqliteConnection: Database.Database | null = null;
let mysqlPool: mysql.Pool | null = null;
let pgPool: pg.Pool | null = null;

function buildMysqlPoolOptions(
  connectionString = config.dbUrl,
  sslEnabled = config.dbSsl,
): mysql.PoolOptions {
  const poolOptions: mysql.PoolOptions = {
    uri: connectionString,
    jsonStrings: true,
  };
  if (sslEnabled) {
    poolOptions.ssl = { rejectUnauthorized: false };
  }
  return poolOptions;
}

function buildPostgresPoolOptions(
  connectionString = config.dbUrl,
  sslEnabled = config.dbSsl,
): pg.PoolConfig {
  const poolOptions: pg.PoolConfig = { connectionString };
  if (sslEnabled) {
    poolOptions.ssl = { rejectUnauthorized: false };
  }
  return poolOptions;
}

function requireSqliteConnection(): Database.Database {
  if (!sqliteConnection) {
    throw new Error('SQLite connection is not initialized');
  }
  return sqliteConnection;
}

function tableExists(table: string): boolean {
  const sqlite = requireSqliteConnection();
  const row = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(table) as { name?: string } | undefined;
  return !!row?.name;
}

function tableColumnExists(table: string, column: string): boolean {
  const sqlite = requireSqliteConnection();
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  return rows.some((row) => row.name === column);
}

function execSqliteStatement(sqlText: string): void {
  requireSqliteConnection().exec(sqlText);
}

function execSqliteSchemaBootstrapCompatibility(sqlText: string): void {
  executeSchemaBootstrapCompatibilitySync(execSqliteStatement, sqlText);
}

function hasExistingSqliteApplicationSchema(): boolean {
  const sqlite = requireSqliteConnection();
  const rows = sqlite.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name != '__drizzle_migrations'
    LIMIT 1
  `).all() as Array<{ name?: string }>;
  return rows.length > 0;
}

function ensureTokenManagementSchema() {
  if (!tableExists('accounts')) {
    return;
  }
  execSqliteSchemaBootstrapCompatibility(`
    CREATE TABLE IF NOT EXISTS account_tokens (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      account_id integer NOT NULL,
      name text NOT NULL,
      token text NOT NULL,
      token_group text,
      value_status text NOT NULL DEFAULT 'ready',
      source text DEFAULT 'manual',
      enabled integer DEFAULT true,
      is_default integer DEFAULT false,
      created_at text DEFAULT (datetime('now')),
      updated_at text DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE cascade
    );
  `);
  if (!tableColumnExists('account_tokens', 'token_group')) {
    execSqliteSchemaBootstrapCompatibility('ALTER TABLE account_tokens ADD COLUMN token_group text;');
  }
  if (!tableColumnExists('account_tokens', 'value_status')) {
    execSqliteSchemaBootstrapCompatibility("ALTER TABLE account_tokens ADD COLUMN value_status text NOT NULL DEFAULT 'ready';");
  }

  execSqliteSchemaBootstrapCompatibility(`
    CREATE TABLE IF NOT EXISTS token_model_availability (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      token_id integer NOT NULL,
      model_name text NOT NULL,
      available integer,
      latency_ms integer,
      checked_at text DEFAULT (datetime('now')),
      FOREIGN KEY (token_id) REFERENCES account_tokens(id) ON DELETE cascade
    );
  `);

  execSqliteSchemaBootstrapCompatibility(`
    CREATE UNIQUE INDEX IF NOT EXISTS token_model_availability_token_model_unique
    ON token_model_availability(token_id, model_name);
  `);
}

function ensureProxyVideoTaskSchema() {
  execSqliteSchemaBootstrapCompatibility(`
    CREATE TABLE IF NOT EXISTS proxy_video_tasks (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      public_id text NOT NULL,
      upstream_video_id text NOT NULL,
      site_url text NOT NULL,
      token_value text NOT NULL,
      requested_model text,
      actual_model text,
      execution_target_id integer,
      account_id integer,
      status_snapshot text,
      upstream_response_meta text,
      last_upstream_status integer,
      last_polled_at text,
      created_at text DEFAULT (datetime('now')),
      updated_at text DEFAULT (datetime('now'))
    );
  `);
  if (!tableColumnExists('proxy_video_tasks', 'status_snapshot')) {
    execSqliteSchemaBootstrapCompatibility('ALTER TABLE proxy_video_tasks ADD COLUMN status_snapshot text;');
  }
  if (!tableColumnExists('proxy_video_tasks', 'upstream_response_meta')) {
    execSqliteSchemaBootstrapCompatibility('ALTER TABLE proxy_video_tasks ADD COLUMN upstream_response_meta text;');
  }
  if (!tableColumnExists('proxy_video_tasks', 'last_upstream_status')) {
    execSqliteSchemaBootstrapCompatibility('ALTER TABLE proxy_video_tasks ADD COLUMN last_upstream_status integer;');
  }
  if (!tableColumnExists('proxy_video_tasks', 'last_polled_at')) {
    execSqliteSchemaBootstrapCompatibility('ALTER TABLE proxy_video_tasks ADD COLUMN last_polled_at text;');
  }
  execSqliteSchemaBootstrapCompatibility(`
    CREATE UNIQUE INDEX IF NOT EXISTS proxy_video_tasks_public_id_unique
    ON proxy_video_tasks(public_id);
  `);
  execSqliteSchemaBootstrapCompatibility(`
    CREATE INDEX IF NOT EXISTS proxy_video_tasks_upstream_video_id_idx
    ON proxy_video_tasks(upstream_video_id);
  `);
}

function ensureProxyFileSchema() {
  execSqliteSchemaBootstrapCompatibility(`
    CREATE TABLE IF NOT EXISTS proxy_files (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      public_id text NOT NULL,
      owner_type text NOT NULL,
      owner_id text NOT NULL,
      filename text NOT NULL,
      mime_type text NOT NULL,
      purpose text,
      byte_size integer NOT NULL,
      sha256 text NOT NULL,
      content_base64 text NOT NULL,
      created_at text DEFAULT (datetime('now')),
      updated_at text DEFAULT (datetime('now')),
      deleted_at text
    );
  `);
  execSqliteSchemaBootstrapCompatibility(`
    CREATE UNIQUE INDEX IF NOT EXISTS proxy_files_public_id_unique
    ON proxy_files(public_id);
  `);
  execSqliteSchemaBootstrapCompatibility(`
    CREATE INDEX IF NOT EXISTS proxy_files_owner_lookup_idx
    ON proxy_files(owner_type, owner_id, deleted_at);
  `);
}

function ensureSiteStatusSchema() {
  if (!tableExists('sites')) {
    return;
  }

  if (!tableColumnExists('sites', 'status')) {
    execSqliteSchemaBootstrapCompatibility(`ALTER TABLE sites ADD COLUMN status text DEFAULT 'active';`);
  }

  execSqliteStatement(`
    UPDATE sites
    SET status = lower(trim(status))
    WHERE status IS NOT NULL
      AND lower(trim(status)) IN ('active', 'disabled')
      AND status != lower(trim(status));
  `);

  execSqliteStatement(`
    UPDATE sites
    SET status = 'active'
    WHERE status IS NULL
      OR trim(status) = ''
      OR lower(trim(status)) NOT IN ('active', 'disabled');
  `);
}

function ensureSiteProxySchema() {
  if (!tableExists('sites')) {
    return;
  }

  if (!tableColumnExists('sites', 'proxy_url')) {
    execSqliteSchemaBootstrapCompatibility(`ALTER TABLE sites ADD COLUMN proxy_url text;`);
  }
}

function ensureSiteUseSystemProxySchema() {
  if (!tableExists('sites')) {
    return;
  }

  if (!tableColumnExists('sites', 'use_system_proxy')) {
    execSqliteSchemaBootstrapCompatibility(`ALTER TABLE sites ADD COLUMN use_system_proxy integer DEFAULT 0;`);
  }

  execSqliteSchemaBootstrapCompatibility(`
    UPDATE sites
    SET use_system_proxy = 0
    WHERE use_system_proxy IS NULL;
  `);
}

function ensureSiteCustomHeadersSchema() {
  if (!tableExists('sites')) {
    return;
  }

  if (!tableColumnExists('sites', 'custom_headers')) {
    execSqliteSchemaBootstrapCompatibility(`ALTER TABLE sites ADD COLUMN custom_headers text;`);
  }
}

function ensureSiteExternalCheckinUrlSchema() {
  if (!tableExists('sites')) {
    return;
  }

  if (!tableColumnExists('sites', 'external_checkin_url')) {
    execSqliteSchemaBootstrapCompatibility(`ALTER TABLE sites ADD COLUMN external_checkin_url text;`);
  }
}

function ensureSiteGlobalWeightSchema() {
  if (!tableExists('sites')) {
    return;
  }

  if (!tableColumnExists('sites', 'global_weight')) {
    execSqliteSchemaBootstrapCompatibility(`ALTER TABLE sites ADD COLUMN global_weight real DEFAULT 1;`);
  }

  execSqliteSchemaBootstrapCompatibility(`
    UPDATE sites
    SET global_weight = 1
    WHERE global_weight IS NULL
      OR global_weight <= 0;
  `);
}

type RuntimeSchemaInspector = {
  dialect: SiteSchemaInspector['dialect'];
  tableExists(table: string): Promise<boolean>;
  columnExists(table: string, column: string): Promise<boolean>;
  execute(sqlText: string): Promise<void>;
};

function createSqliteSchemaInspector(): RuntimeSchemaInspector {
  return {
    dialect: 'sqlite',
    tableExists: async (table) => tableExists(table),
    columnExists: async (table, column) => tableColumnExists(table, column),
    execute: async (sqlText) => {
      executeSchemaBootstrapCompatibilitySync(execSqliteStatement, sqlText);
    },
  };
}

function createMysqlSchemaInspector(): RuntimeSchemaInspector | null {
  if (!mysqlPool) return null;
  return {
      dialect: 'mysql',
      tableExists: async (table) => {
        const [rows] = await mysqlPool!.query(
          'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1',
          [table],
        );
        return Array.isArray(rows) && rows.length > 0;
      },
      columnExists: async (table, column) => {
        const [rows] = await mysqlPool!.query(
          'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1',
          [table, column],
        );
        return Array.isArray(rows) && rows.length > 0;
      },
      execute: async (sqlText) => {
        await executeSchemaBootstrapCompatibility((statement) => mysqlPool!.query(statement).then(() => undefined), sqlText);
      },
    };
}

function createPostgresSchemaInspector(): RuntimeSchemaInspector | null {
  if (!pgPool) return null;
  return {
    dialect: 'postgres',
    tableExists: async (table) => {
      const result = await pgPool!.query(
        'SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1 LIMIT 1',
        [table],
      );
      return Number(result.rowCount || 0) > 0;
    },
    columnExists: async (table, column) => {
      const result = await pgPool!.query(
        'SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2 LIMIT 1',
        [table, column],
      );
      return Number(result.rowCount || 0) > 0;
    },
    execute: async (sqlText) => {
      await executeSchemaBootstrapCompatibility((statement) => pgPool!.query(statement).then(() => undefined), sqlText);
    },
  };
}

function createRuntimeSchemaInspector(): RuntimeSchemaInspector | null {
  if (runtimeDbDialect === 'sqlite') {
    return createSqliteSchemaInspector();
  }
  if (runtimeDbDialect === 'mysql') {
    return createMysqlSchemaInspector();
  }
  return createPostgresSchemaInspector();
}

export async function ensureSiteCompatibilityColumns(): Promise<void> {
  const inspector = createRuntimeSchemaInspector();
  if (!inspector) return;
  await ensureSiteSchemaCompatibility(inspector);
}

export async function ensureProxyFileCompatibilityColumns(): Promise<void> {
  const inspector = createRuntimeSchemaInspector();
  if (!inspector) return;
  await ensureProxyFileSchemaCompatibility(inspector);
}

function ensureDownstreamApiKeySchema() {
  execSqliteSchemaBootstrapCompatibility(`
    CREATE TABLE IF NOT EXISTS downstream_api_keys (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      name text NOT NULL,
      key text NOT NULL,
      description text,
      group_name text,
      tags text,
      enabled integer DEFAULT true,
      expires_at text,
      max_cost real,
      used_cost real DEFAULT 0,
      max_requests integer,
      used_requests integer DEFAULT 0,
      supported_models text,
      allowed_plan_ids text,
      site_weight_multipliers text,
      last_used_at text,
      created_at text DEFAULT (datetime('now')),
      updated_at text DEFAULT (datetime('now'))
    );
  `);

  execSqliteSchemaBootstrapCompatibility(`
    CREATE UNIQUE INDEX IF NOT EXISTS downstream_api_keys_key_unique
    ON downstream_api_keys(key);
  `);
  execSqliteSchemaBootstrapCompatibility(`
    CREATE INDEX IF NOT EXISTS downstream_api_keys_name_idx
    ON downstream_api_keys(name);
  `);
  execSqliteSchemaBootstrapCompatibility(`
    CREATE INDEX IF NOT EXISTS downstream_api_keys_enabled_idx
    ON downstream_api_keys(enabled);
  `);
  execSqliteSchemaBootstrapCompatibility(`
    CREATE INDEX IF NOT EXISTS downstream_api_keys_expires_at_idx
    ON downstream_api_keys(expires_at);
  `);

  if (!tableColumnExists('downstream_api_keys', 'group_name')) {
    execSqliteSchemaBootstrapCompatibility('ALTER TABLE downstream_api_keys ADD COLUMN group_name text;');
  }

  if (!tableColumnExists('downstream_api_keys', 'tags')) {
    execSqliteSchemaBootstrapCompatibility('ALTER TABLE downstream_api_keys ADD COLUMN tags text;');
  }

  if (!tableColumnExists('downstream_api_keys', 'allowed_plan_ids')) {
    execSqliteSchemaBootstrapCompatibility('ALTER TABLE downstream_api_keys ADD COLUMN allowed_plan_ids text;');
  }
}





































async function sqliteProxyQuery(sqlText: string, params: unknown[], method: SqlMethod) {
  const sqlite = requireSqliteConnection();
  const statement = sqlite.prepare(sqlText);
  if (method === 'run' || method === 'execute') {
    const result = statement.run(...params);
    return {
      rows: [],
      changes: Number(result.changes || 0),
      lastInsertRowid: Number(result.lastInsertRowid || 0),
    };
  }

  if (method === 'get') {
    const row = statement.raw().get(...params) as unknown[] | undefined;
    return { rows: row as any };
  }

  const rows = statement.raw().all(...params) as unknown[][];
  return { rows };
}

type MysqlQueryable = mysql.Pool | mysql.PoolConnection;
async function mysqlProxyQuery(executor: MysqlQueryable, sqlText: string, params: unknown[], method: SqlMethod) {
  const queryOptions = {
    sql: sqlText,
    rowsAsArray: method === 'all' || method === 'values',
  };
  const [rows] = await executor.query(queryOptions as mysql.QueryOptions, params as any[]);

  if (method === 'all' || method === 'values') {
    return { rows: Array.isArray(rows) ? rows : [] };
  }

  if (Array.isArray(rows)) {
    return { rows };
  }
  return { rows: [rows] };
}

type PgQueryable = pg.Pool | pg.PoolClient;
function parseInsertTableName(sqlText: string): string | null {
  const match = sqlText.match(/insert\s+into\s+"?([a-zA-Z0-9_]+)"?/i);
  return match?.[1]?.toLowerCase() || null;
}

async function pgProxyQuery(executor: PgQueryable, sqlText: string, params: unknown[], method: SqlMethod) {
  const trimmedLower = sqlText.trim().toLowerCase();
  const values = params as any[];

  if (method === 'all' || method === 'values') {
    const result = await executor.query({
      text: sqlText,
      values,
      rowMode: 'array',
    } as pg.QueryConfig);
    return { rows: result.rows };
  }

  if (trimmedLower.startsWith('insert') && method === 'execute') {
    const tableName = parseInsertTableName(sqlText);
    const canReturnId = tableName !== null && TABLES_WITH_NUMERIC_ID.has(tableName) && !trimmedLower.includes(' returning ');
    if (canReturnId) {
      const result = await executor.query({
        text: `${sqlText} returning id`,
        values,
      } as pg.QueryConfig);
      const insertedId = Number((result.rows?.[0] as { id?: unknown } | undefined)?.id ?? 0);
      return {
        rows: [{
          changes: Number(result.rowCount || 0),
          lastInsertRowid: Number.isFinite(insertedId) ? insertedId : 0,
        }],
      };
    }
  }

  const result = await executor.query({
    text: sqlText,
    values,
  } as pg.QueryConfig);

  if (trimmedLower.startsWith('select')) {
    return { rows: result.rows };
  }

  return { rows: [{ changes: Number(result.rowCount || 0) }] };
}

function normalizeAllResult(result: unknown): unknown[] {
  if (!Array.isArray(result)) return [];
  if (result.length === 0) return [];
  const first = result[0] as Record<string, unknown> | undefined;
  if (first && typeof first === 'object') {
    if ('affectedRows' in first || 'insertId' in first) return [];
    if ('changes' in first && result.length === 1) return [];
    if ('rowCount' in first && result.length === 1) return [];
  }
  return result;
}

function normalizeRunResult(result: unknown): { changes: number; lastInsertRowid: number } {
  if (!result) return { changes: 0, lastInsertRowid: 0 };

  if (typeof result === 'object' && !Array.isArray(result)) {
    const row = result as Record<string, unknown>;
    if ('changes' in row || 'lastInsertRowid' in row) {
      return {
        changes: Number(row.changes || 0),
        lastInsertRowid: Number(row.lastInsertRowid || 0),
      };
    }
    if ('affectedRows' in row || 'insertId' in row) {
      return {
        changes: Number(row.affectedRows || 0),
        lastInsertRowid: Number(row.insertId || 0),
      };
    }
  }

  if (Array.isArray(result) && result.length > 0) {
    const first = result[0] as Record<string, unknown>;
    if (first && typeof first === 'object') {
      if ('changes' in first || 'lastInsertRowid' in first) {
        return {
          changes: Number(first.changes || 0),
          lastInsertRowid: Number(first.lastInsertRowid || 0),
        };
      }
      if ('affectedRows' in first || 'insertId' in first) {
        return {
          changes: Number(first.affectedRows || 0),
          lastInsertRowid: Number(first.insertId || 0),
        };
      }
      if ('rowCount' in first) {
        return {
          changes: Number(first.rowCount || 0),
          lastInsertRowid: 0,
        };
      }
    }
  }

  return { changes: 0, lastInsertRowid: 0 };
}

const wrappedObjects = new WeakMap<object, unknown>();

function shouldWrapObject(value: unknown): value is object {
  if (!value || typeof value !== 'object') return false;
  // Drizzle query builders are thenable objects (QueryPromise) but are not native Promises.
  // They still need wrapping so we can provide sqlite-style `.all/.get/.run` shims.
  if (value instanceof Promise) return false;
  return true;
}

function wrapQueryLike<T>(value: T): T {
  if (!shouldWrapObject(value)) return value;
  const target = value as unknown as object;
  if (wrappedObjects.has(target)) {
    return wrappedObjects.get(target) as T;
  }

  const proxy = new Proxy(target as Record<string, unknown>, {
    get(innerTarget, prop, receiver) {
      if (prop === 'then' && typeof innerTarget.then === 'function') {
        return innerTarget.then.bind(innerTarget);
      }

      if (prop === 'all' && typeof innerTarget.all !== 'function' && typeof innerTarget.execute === 'function') {
        return async (...args: unknown[]) => normalizeAllResult(await (innerTarget.execute as (...a: unknown[]) => Promise<unknown>)(...args));
      }

      if (prop === 'get' && typeof innerTarget.get !== 'function' && typeof innerTarget.execute === 'function') {
        return async (...args: unknown[]) => {
          const rows = normalizeAllResult(await (innerTarget.execute as (...a: unknown[]) => Promise<unknown>)(...args));
          return rows[0] ?? undefined;
        };
      }

      if (prop === 'run' && typeof innerTarget.run !== 'function' && typeof innerTarget.execute === 'function') {
        return async (...args: unknown[]) => normalizeRunResult(await (innerTarget.execute as (...a: unknown[]) => Promise<unknown>)(...args));
      }

      const original = Reflect.get(innerTarget, prop, receiver);
      if (typeof original !== 'function') {
        return original;
      }

      return (...args: unknown[]) => {
        const result = original.apply(innerTarget, args);
        if (shouldWrapObject(result)) {
          return wrapQueryLike(result);
        }
        return result;
      };
    },
  });

  wrappedObjects.set(target, proxy);
  return proxy as unknown as T;
}

function wrapDbClient<T extends object>(
  rawDb: T,
  customTransaction?: <R>(fn: (tx: any) => Promise<R> | R) => Promise<R>,
) {
  return new Proxy(rawDb as Record<string, unknown>, {
    get(target, prop, receiver) {
      if (prop === 'transaction') {
        if (customTransaction) return customTransaction;

        const originalTransaction = target.transaction;
        if (typeof originalTransaction !== 'function') return undefined;
        return async <R>(fn: (tx: any) => Promise<R> | R) => {
          return await (originalTransaction as (handler: (tx: unknown) => Promise<R> | R) => Promise<R>).call(target, async (tx: unknown) => {
            return await fn(wrapDbClient(tx as object));
          });
        };
      }

      const original = Reflect.get(target, prop, receiver);
      if (typeof original !== 'function') {
        return original;
      }

      return (...args: unknown[]) => {
        const result = original.apply(target, args);
        if (shouldWrapObject(result)) {
          return wrapQueryLike(result);
        }
        return result;
      };
    },
  }) as T;
}

function initSqliteDb() {
  const sqlitePath = resolveSqliteDatabasePath({ dbUrl: config.dbUrl, dataDir: config.dataDir });
  if (sqlitePath !== ':memory:') {
    mkdirSync(dirname(sqlitePath), { recursive: true });
  }

  const sqlite = new Database(sqlitePath);
  sqliteConnection = sqlite;
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  if (hasExistingSqliteApplicationSchema()) {
    ensureTokenManagementSchema();
    ensureSiteStatusSchema();
    ensureSiteProxySchema();
    ensureSiteUseSystemProxySchema();
    ensureSiteCustomHeadersSchema();
    ensureSiteExternalCheckinUrlSchema();
    ensureSiteGlobalWeightSchema();
    ensureDownstreamApiKeySchema();
    ensureProxyVideoTaskSchema();
    ensureProxyFileSchema();
  }

  const rawDb = drizzleSqliteProxy(
    (sqlText, params, method) => sqliteProxyQuery(sqlText, params, method as SqlMethod),
    { schema },
  ) as any;
  return wrapDbClient(rawDb);
}

type AppDb = ReturnType<typeof initSqliteDb>;

function initMysqlDb(): AppDb {
  if (!config.dbUrl) {
    throw new Error('DB_URL is required when DB_TYPE=mysql');
  }
  mysqlPool = mysql.createPool(buildMysqlPoolOptions());

  const rawDb = drizzleMysqlProxy(
    (sqlText, params, method) => mysqlProxyQuery(mysqlPool!, sqlText, params, method as SqlMethod),
    { schema },
  ) as any;

  return wrapDbClient(rawDb, async <R>(fn: (tx: any) => Promise<R> | R) => {
    const connection = await mysqlPool!.getConnection();
    try {
      await connection.beginTransaction();
      const txRaw = drizzleMysqlProxy(
        (sqlText, params, method) => mysqlProxyQuery(connection, sqlText, params, method as SqlMethod),
        { schema },
      ) as any;
      const txWrapped = wrapDbClient(txRaw);
      const result = await fn(txWrapped);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }) as AppDb;
}

function initPostgresDb(): AppDb {
  if (!config.dbUrl) {
    throw new Error('DB_URL is required when DB_TYPE=postgres');
  }
  installPostgresJsonTextParsers();
  const poolOptions = buildPostgresPoolOptions();
  pgPool = new pg.Pool(poolOptions);

  const rawDb = drizzlePgProxy(
    (sqlText, params, method) => pgProxyQuery(pgPool!, sqlText, params, method as SqlMethod),
    { schema },
  ) as any;

  return wrapDbClient(rawDb, async <R>(fn: (tx: any) => Promise<R> | R) => {
    const client = await pgPool!.connect();
    try {
      await client.query('BEGIN');
      const txRaw = drizzlePgProxy(
        (sqlText, params, method) => pgProxyQuery(client, sqlText, params, method as SqlMethod),
        { schema },
      ) as any;
      const txWrapped = wrapDbClient(txRaw);
      const result = await fn(txWrapped);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }) as AppDb;
}

function initDb(): AppDb {
  if (runtimeDbDialect === 'mysql') return initMysqlDb();
  if (runtimeDbDialect === 'postgres') return initPostgresDb();
  return initSqliteDb();
}

let activeDb: AppDb = initDb();

export const db: any = new Proxy({}, {
  get(_target, prop) {
    return (activeDb as any)?.[prop as keyof typeof activeDb];
  },
});
export { schema };

export async function closeDbConnections(): Promise<void> {
  if (mysqlPool) {
    await mysqlPool.end();
    mysqlPool = null;
  }
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
  if (sqliteConnection) {
    sqliteConnection.close();
    sqliteConnection = null;
  }
}

export async function switchRuntimeDatabase(nextDialect: RuntimeDbDialect, nextDbUrl: string, nextDbSsl?: boolean): Promise<void> {
  const previousDialect = runtimeDbDialect;
  const previousDbUrl = config.dbUrl;
  const previousConfigDialect = config.dbType;
  const previousDbSsl = config.dbSsl;

  await closeDbConnections();

  runtimeDbDialect = nextDialect;
  config.dbType = nextDialect;
  config.dbUrl = nextDbUrl;
  if (nextDbSsl !== undefined) {
    config.dbSsl = nextDbSsl;
  }

  try {
    activeDb = initDb();
    await ensureRuntimeDatabaseReady({
      dialect: nextDialect,
      connectionString: nextDbUrl,
      ssl: config.dbSsl,
    });
  } catch (error) {
    await closeDbConnections();
    runtimeDbDialect = previousDialect;
    config.dbType = previousConfigDialect;
    config.dbUrl = previousDbUrl;
    config.dbSsl = previousDbSsl;
    activeDb = initDb();
    throw error;
  }
}

export const __dbProxyTestUtils = {
  wrapQueryLike,
  shouldWrapObject,
  pgProxyQuery,
  resolveSqlitePath: () => resolveSqliteDatabasePath({ dbUrl: config.dbUrl, dataDir: config.dataDir }),
  buildMysqlPoolOptions,
  buildPostgresPoolOptions,
  installPostgresJsonTextParsers,
  ensurePostgresJsonTextParsers: installPostgresJsonTextParsers,
  resetPostgresJsonTextParsersInstallStateForTests,
  pg,
};
