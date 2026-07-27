import {
  ACCOUNT_TOKEN_DATA_COMPATIBILITY_SPECS,
  ACCOUNT_TOKEN_COLUMN_COMPATIBILITY_SPECS,
  ensureAccountTokenSchemaCompatibility,
  type AccountTokenSchemaInspector,
} from './accountTokenSchemaCompatibility.js';
import {
  ensureProxyFileSchemaCompatibility,
  PROXY_FILE_COLUMN_COMPATIBILITY_SPECS,
  PROXY_FILE_INDEX_COMPATIBILITY_SPECS,
  PROXY_FILE_TABLE_COMPATIBILITY_SPECS,
  type ProxyFileSchemaInspector,
} from './proxyFileSchemaCompatibility.js';
import {
  ensureSharedIndexSchemaCompatibility,
  SHARED_INDEX_COMPATIBILITY_SPECS,
  type SharedIndexSchemaInspector,
} from './sharedIndexSchemaCompatibility.js';
import {
  ensureSiteSchemaCompatibility,
  SITE_COLUMN_COMPATIBILITY_SPECS,
  SITE_TABLE_COMPATIBILITY_SPECS,
  type SiteSchemaInspector,
} from './siteSchemaCompatibility.js';

export type SchemaBootstrapCompatibilityClassification = 'registered' | 'forbidden';

export interface SchemaBootstrapCompatibilityInspector extends
  SiteSchemaInspector,
  ProxyFileSchemaInspector,
  AccountTokenSchemaInspector,
  SharedIndexSchemaInspector {}

const BOOTSTRAP_OWNED_TABLES = [
  'account_tokens',
  'token_model_availability',
  'proxy_video_tasks',
  'downstream_api_keys',
];

const BOOTSTRAP_OWNED_COLUMNS = [
  'sites.status',
  'proxy_video_tasks.status_snapshot',
  'proxy_video_tasks.upstream_response_meta',
  'proxy_video_tasks.last_upstream_status',
  'proxy_video_tasks.last_polled_at',
  'downstream_api_keys.group_name',
  'downstream_api_keys.tags',
  'downstream_api_keys.allowed_plan_ids',
];

const BOOTSTRAP_OWNED_INDEXES = [
  'token_model_availability_token_model_unique',
  'proxy_video_tasks_public_id_unique',
  'proxy_video_tasks_upstream_video_id_idx',
  'downstream_api_keys_key_unique',
  'downstream_api_keys_name_idx',
  'downstream_api_keys_enabled_idx',
  'downstream_api_keys_expires_at_idx',
];

function normalizeSqlText(sqlText: string): string {
  return sqlText.trim().replace(/\s+/g, ' ').toLowerCase();
}

function extractIndexName(sqlText: string): string | null {
  const match = normalizeSqlText(sqlText).match(
    /^create (?:unique )?index(?: if not exists)? [`"]?([a-z0-9_]+)[`"]?/i,
  );
  return match?.[1] ?? null;
}

const REGISTERED_BOOTSTRAP_TABLES = new Set([
  ...SITE_TABLE_COMPATIBILITY_SPECS.map((spec) => spec.table),
  ...PROXY_FILE_TABLE_COMPATIBILITY_SPECS.map((spec) => spec.table),
  ...BOOTSTRAP_OWNED_TABLES,
]);

const REGISTERED_BOOTSTRAP_COLUMNS = new Set([
  ...SITE_COLUMN_COMPATIBILITY_SPECS.map((spec) => `sites.${spec.column}`),
  ...ACCOUNT_TOKEN_COLUMN_COMPATIBILITY_SPECS.map((spec) => `${spec.table}.${spec.column}`),
  ...PROXY_FILE_COLUMN_COMPATIBILITY_SPECS.map((spec) => `${spec.table}.${spec.column}`),
  ...BOOTSTRAP_OWNED_COLUMNS,
]);

const REGISTERED_BOOTSTRAP_INDEXES = new Set([
  ...SITE_TABLE_COMPATIBILITY_SPECS.flatMap((spec) => spec.postCreateSql ? Object.values(spec.postCreateSql) : [])
    .flat()
    .map((sqlText) => extractIndexName(sqlText))
    .filter((indexName): indexName is string => Boolean(indexName)),
  ...PROXY_FILE_INDEX_COMPATIBILITY_SPECS.map((spec) => spec.indexName),
  ...BOOTSTRAP_OWNED_INDEXES,
  ...SHARED_INDEX_COMPATIBILITY_SPECS.map((spec) => spec.indexName),
]);

const REGISTERED_BOOTSTRAP_UPDATES = new Set(
  [
    ...SITE_COLUMN_COMPATIBILITY_SPECS
      .flatMap((spec) => spec.normalizeSql ? Object.values(spec.normalizeSql) : []),
    ...ACCOUNT_TOKEN_DATA_COMPATIBILITY_SPECS
      .flatMap((spec) => Object.values(spec.sql)),
  ].map((sqlText) => normalizeSqlText(sqlText)),
);

export function classifySchemaBootstrapMutation(sqlText: string): SchemaBootstrapCompatibilityClassification {
  const normalized = normalizeSqlText(sqlText);

  if (REGISTERED_BOOTSTRAP_UPDATES.has(normalized)) {
    return 'registered';
  }

  const createTableMatch = normalized.match(/^create table if not exists [`"]?([a-z0-9_]+)[`"]?/i);
  if (createTableMatch) {
    return REGISTERED_BOOTSTRAP_TABLES.has(createTableMatch[1]) ? 'registered' : 'forbidden';
  }

  const alterTableMatch = normalized.match(
    /^alter table [`"]?([a-z0-9_]+)[`"]? add column [`"]?([a-z0-9_]+)[`"]?/i,
  );
  if (alterTableMatch) {
    const [, tableName, columnName] = alterTableMatch;
    return REGISTERED_BOOTSTRAP_COLUMNS.has(`${tableName}.${columnName}`) ? 'registered' : 'forbidden';
  }

  const createIndexMatch = normalized.match(
    /^create (?:unique )?index(?: if not exists)? [`"]?([a-z0-9_]+)[`"]?/i,
  );
  if (createIndexMatch) {
    return REGISTERED_BOOTSTRAP_INDEXES.has(createIndexMatch[1]) ? 'registered' : 'forbidden';
  }

  return 'forbidden';
}

function assertSchemaBootstrapMutation(sqlText: string): void {
  if (classifySchemaBootstrapMutation(sqlText) === 'forbidden') {
    throw new Error(`Forbidden schema bootstrap mutation: ${sqlText}`);
  }
}

export async function executeSchemaBootstrapCompatibility(
  execute: (sqlText: string) => Promise<void>,
  sqlText: string,
): Promise<void> {
  assertSchemaBootstrapMutation(sqlText);
  await execute(sqlText);
}

export function executeSchemaBootstrapCompatibilitySync(
  execute: (sqlText: string) => void,
  sqlText: string,
): void {
  assertSchemaBootstrapMutation(sqlText);
  execute(sqlText);
}

function wrapSchemaBootstrapInspector(
  inspector: SchemaBootstrapCompatibilityInspector,
): SchemaBootstrapCompatibilityInspector {
  return {
    ...inspector,
    execute: async (sqlText: string) => {
      await executeSchemaBootstrapCompatibility((statement) => inspector.execute(statement), sqlText);
    },
  };
}

export async function ensureSchemaBootstrapCompatibility(
  inspector: SchemaBootstrapCompatibilityInspector,
): Promise<void> {
  const wrappedInspector = wrapSchemaBootstrapInspector(inspector);
  await ensureSiteSchemaCompatibility(wrappedInspector);
  await ensureProxyFileSchemaCompatibility(wrappedInspector);
  await ensureAccountTokenSchemaCompatibility(wrappedInspector);
  await ensureSharedIndexSchemaCompatibility(wrappedInspector);
}
