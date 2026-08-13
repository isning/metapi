import currentSchemaContract from '../db/generated/schemaContract.json' with { type: 'json' };
import { db, schema } from '../db/index.js';
import {
  createRuntimeSchemaClient,
  ensureRuntimeDatabaseSchema,
  type RuntimeSchemaClient,
  type RuntimeSchemaDialect,
} from '../db/runtimeSchemaBootstrap.js';
import { CURRENT_CONFIG_VERSION } from './configMigrationService.js';

export type MigrationDialect = RuntimeSchemaDialect;

export interface DatabaseMigrationInput {
  dialect?: unknown;
  connectionString?: unknown;
  overwrite?: unknown;
  ssl?: unknown;
}

export interface NormalizedDatabaseMigrationInput {
  dialect: MigrationDialect;
  connectionString: string;
  overwrite: boolean;
  ssl: boolean;
}

export interface DatabaseMigrationSummary {
  dialect: MigrationDialect;
  connection: string;
  overwrite: boolean;
  version: string;
  timestamp: number;
  rows: Record<string, number> & {
    sites: number;
    siteApiEndpoints: number;
    modelCatalogSources: number;
    apiEndpointProfiles: number;
    endpointModelObservations: number;
    credentialEndpointBindings: number;
    siteAnnouncements: number;
    siteDisabledModels: number;
    accounts: number;
    accountTokens: number;
    routeGraphVersions: number;
    routeGraphDrafts: number;
    routeGraphWorkspaceOperationBatches: number;
    routeGraphActiveVersion: number;
    compiledRuntimeArtifacts: number;
    compiledRuntimeActiveArtifact: number;
    runtimeExecutionTargets: number;
    runtimeExecutionTargetState: number;
    checkinLogs: number;
    modelAvailability: number;
    tokenModelAvailability: number;
    tokenDisabledModels: number;
    proxyLogs: number;
    proxyRequests: number;
    proxyDebugTraces: number;
    proxyDebugAttempts: number;
    proxyVideoTasks: number;
    proxyFiles: number;
    downstreamApiKeys: number;
    events: number;
    settings: number;
    upstreamModelCostPricings: number;
    providerPricingCatalogCaches: number;
    walletAcquisitionProfiles: number;
    fxRateSnapshots: number;
    oauthRouteUnits: number;
    oauthRouteUnitMembers: number;
    siteDayUsage: number;
    siteHourUsage: number;
    modelDayUsage: number;
    routeRuntimeDayUsage: number;
    adminSnapshots: number;
    analyticsProjectionCheckpoints: number;
  };
}

type SchemaContractShape = {
  tables: Record<string, {
    columns: Record<string, {
      logicalType: string | null;
    }>;
  }>;
};

type NativeTableSpec = {
  tableName: string;
  summaryKey: keyof DatabaseMigrationSummary['rows'];
  selectRows: () => Promise<Array<Record<string, unknown>>>;
};

type InsertStatement = {
  tableName: string;
  columns: string[];
  values: unknown[];
};

const schemaContract = currentSchemaContract as SchemaContractShape;
const DIALECTS: MigrationDialect[] = ['sqlite', 'mysql', 'postgres'];

const NATIVE_TABLES: NativeTableSpec[] = [
  { tableName: 'sites', summaryKey: 'sites', selectRows: async () => await db.select().from(schema.sites).all() as Array<Record<string, unknown>> },
  { tableName: 'site_api_endpoints', summaryKey: 'siteApiEndpoints', selectRows: async () => await db.select().from(schema.siteApiEndpoints).all() as Array<Record<string, unknown>> },
  { tableName: 'model_catalog_sources', summaryKey: 'modelCatalogSources', selectRows: async () => await db.select().from(schema.modelCatalogSources).all() as Array<Record<string, unknown>> },
  { tableName: 'api_endpoint_profiles', summaryKey: 'apiEndpointProfiles', selectRows: async () => await db.select().from(schema.apiEndpointProfiles).all() as Array<Record<string, unknown>> },
  { tableName: 'accounts', summaryKey: 'accounts', selectRows: async () => await db.select().from(schema.accounts).all() as Array<Record<string, unknown>> },
  { tableName: 'account_tokens', summaryKey: 'accountTokens', selectRows: async () => await db.select().from(schema.accountTokens).all() as Array<Record<string, unknown>> },
  { tableName: 'credential_endpoint_bindings', summaryKey: 'credentialEndpointBindings', selectRows: async () => await db.select().from(schema.credentialEndpointBindings).all() as Array<Record<string, unknown>> },
  { tableName: 'endpoint_model_observations', summaryKey: 'endpointModelObservations', selectRows: async () => await db.select().from(schema.endpointModelObservations).all() as Array<Record<string, unknown>> },
  { tableName: 'site_disabled_models', summaryKey: 'siteDisabledModels', selectRows: async () => await db.select().from(schema.siteDisabledModels).all() as Array<Record<string, unknown>> },
  { tableName: 'model_availability', summaryKey: 'modelAvailability', selectRows: async () => await db.select().from(schema.modelAvailability).all() as Array<Record<string, unknown>> },
  { tableName: 'token_model_availability', summaryKey: 'tokenModelAvailability', selectRows: async () => await db.select().from(schema.tokenModelAvailability).all() as Array<Record<string, unknown>> },
  { tableName: 'token_disabled_models', summaryKey: 'tokenDisabledModels', selectRows: async () => await db.select().from(schema.tokenDisabledModels).all() as Array<Record<string, unknown>> },
  { tableName: 'upstream_model_cost_pricings', summaryKey: 'upstreamModelCostPricings', selectRows: async () => await db.select().from(schema.upstreamModelCostPricings).all() as Array<Record<string, unknown>> },
  { tableName: 'provider_pricing_catalog_caches', summaryKey: 'providerPricingCatalogCaches', selectRows: async () => await db.select().from(schema.providerPricingCatalogCaches).all() as Array<Record<string, unknown>> },
  { tableName: 'wallet_acquisition_profiles', summaryKey: 'walletAcquisitionProfiles', selectRows: async () => await db.select().from(schema.walletAcquisitionProfiles).all() as Array<Record<string, unknown>> },
  { tableName: 'fx_rate_snapshots', summaryKey: 'fxRateSnapshots', selectRows: async () => await db.select().from(schema.fxRateSnapshots).all() as Array<Record<string, unknown>> },
  { tableName: 'oauth_route_units', summaryKey: 'oauthRouteUnits', selectRows: async () => await db.select().from(schema.oauthRouteUnits).all() as Array<Record<string, unknown>> },
  { tableName: 'oauth_route_unit_members', summaryKey: 'oauthRouteUnitMembers', selectRows: async () => await db.select().from(schema.oauthRouteUnitMembers).all() as Array<Record<string, unknown>> },
  { tableName: 'runtime_execution_targets', summaryKey: 'runtimeExecutionTargets', selectRows: async () => await db.select().from(schema.runtimeExecutionTargets).all() as Array<Record<string, unknown>> },
  { tableName: 'runtime_execution_target_state', summaryKey: 'runtimeExecutionTargetState', selectRows: async () => await db.select().from(schema.runtimeExecutionTargetState).all() as Array<Record<string, unknown>> },
  { tableName: 'route_graph_versions', summaryKey: 'routeGraphVersions', selectRows: async () => await db.select().from(schema.routeGraphVersions).all() as Array<Record<string, unknown>> },
  { tableName: 'compiled_runtime_artifacts', summaryKey: 'compiledRuntimeArtifacts', selectRows: async () => await db.select().from(schema.compiledRuntimeArtifacts).all() as Array<Record<string, unknown>> },
  { tableName: 'route_graph_drafts', summaryKey: 'routeGraphDrafts', selectRows: async () => await db.select().from(schema.routeGraphDrafts).all() as Array<Record<string, unknown>> },
  { tableName: 'route_graph_workspace_operation_batches', summaryKey: 'routeGraphWorkspaceOperationBatches', selectRows: async () => await db.select().from(schema.routeGraphWorkspaceOperationBatches).all() as Array<Record<string, unknown>> },
  { tableName: 'compiled_runtime_active_artifact', summaryKey: 'compiledRuntimeActiveArtifact', selectRows: async () => await db.select().from(schema.compiledRuntimeActiveArtifact).all() as Array<Record<string, unknown>> },
  { tableName: 'route_graph_active_version', summaryKey: 'routeGraphActiveVersion', selectRows: async () => await db.select().from(schema.routeGraphActiveVersion).all() as Array<Record<string, unknown>> },
  { tableName: 'downstream_api_keys', summaryKey: 'downstreamApiKeys', selectRows: async () => await db.select().from(schema.downstreamApiKeys).all() as Array<Record<string, unknown>> },
  { tableName: 'site_announcements', summaryKey: 'siteAnnouncements', selectRows: async () => await db.select().from(schema.siteAnnouncements).all() as Array<Record<string, unknown>> },
  { tableName: 'checkin_logs', summaryKey: 'checkinLogs', selectRows: async () => await db.select().from(schema.checkinLogs).all() as Array<Record<string, unknown>> },
  { tableName: 'proxy_requests', summaryKey: 'proxyRequests', selectRows: async () => await db.select().from(schema.proxyRequests).all() as Array<Record<string, unknown>> },
  { tableName: 'proxy_logs', summaryKey: 'proxyLogs', selectRows: async () => await db.select().from(schema.proxyLogs).all() as Array<Record<string, unknown>> },
  { tableName: 'proxy_debug_traces', summaryKey: 'proxyDebugTraces', selectRows: async () => await db.select().from(schema.proxyDebugTraces).all() as Array<Record<string, unknown>> },
  { tableName: 'proxy_debug_attempts', summaryKey: 'proxyDebugAttempts', selectRows: async () => await db.select().from(schema.proxyDebugAttempts).all() as Array<Record<string, unknown>> },
  { tableName: 'proxy_video_tasks', summaryKey: 'proxyVideoTasks', selectRows: async () => await db.select().from(schema.proxyVideoTasks).all() as Array<Record<string, unknown>> },
  { tableName: 'proxy_files', summaryKey: 'proxyFiles', selectRows: async () => await db.select().from(schema.proxyFiles).all() as Array<Record<string, unknown>> },
  { tableName: 'site_day_usage', summaryKey: 'siteDayUsage', selectRows: async () => await db.select().from(schema.siteDayUsage).all() as Array<Record<string, unknown>> },
  { tableName: 'site_hour_usage', summaryKey: 'siteHourUsage', selectRows: async () => await db.select().from(schema.siteHourUsage).all() as Array<Record<string, unknown>> },
  { tableName: 'model_day_usage', summaryKey: 'modelDayUsage', selectRows: async () => await db.select().from(schema.modelDayUsage).all() as Array<Record<string, unknown>> },
  { tableName: 'route_runtime_day_usage', summaryKey: 'routeRuntimeDayUsage', selectRows: async () => await db.select().from(schema.routeRuntimeDayUsage).all() as Array<Record<string, unknown>> },
  { tableName: 'admin_snapshots', summaryKey: 'adminSnapshots', selectRows: async () => await db.select().from(schema.adminSnapshots).all() as Array<Record<string, unknown>> },
  { tableName: 'analytics_projection_checkpoints', summaryKey: 'analyticsProjectionCheckpoints', selectRows: async () => await db.select().from(schema.analyticsProjectionCheckpoints).all() as Array<Record<string, unknown>> },
  { tableName: 'events', summaryKey: 'events', selectRows: async () => await db.select().from(schema.events).all() as Array<Record<string, unknown>> },
  { tableName: 'settings', summaryKey: 'settings', selectRows: async () => await db.select().from(schema.settings).all() as Array<Record<string, unknown>> },
];

const CLEAR_TABLE_ORDER = [...NATIVE_TABLES].reverse().map((spec) => spec.tableName);
const POSTGRES_SEQUENCE_TABLES = NATIVE_TABLES
  .map((spec) => spec.tableName)
  .filter((tableName) => schemaContract.tables[tableName]?.columns.id);

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function validateConnectionStringForDialect(dialect: MigrationDialect, connectionString: string): void {
  const normalized = connectionString.trim().toLowerCase();
  if (dialect === 'postgres') {
    if (!normalized.startsWith('postgres://') && !normalized.startsWith('postgresql://')) {
      throw new Error('postgres connection string must start with postgres:// or postgresql://');
    }
    return;
  }
  if (dialect === 'mysql') {
    if (!normalized.startsWith('mysql://')) {
      throw new Error('MySQL connection string must start with mysql://');
    }
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(connectionString.trim())
    && !normalized.startsWith('sqlite://')
    && !normalized.startsWith('file://')) {
    throw new Error('SQLite connection string must be a local path, file:// URL, or sqlite:// URL');
  }
}

export function normalizeMigrationInput(input: DatabaseMigrationInput): NormalizedDatabaseMigrationInput {
  const dialect = asString(input.dialect) as MigrationDialect;
  if (!DIALECTS.includes(dialect)) {
    throw new Error('Unsupported database dialect');
  }
  const connectionString = asString(input.connectionString);
  if (!connectionString) {
    throw new Error('Database connection string is required');
  }
  validateConnectionStringForDialect(dialect, connectionString);
  return {
    dialect,
    connectionString,
    overwrite: asBoolean(input.overwrite, false),
    ssl: asBoolean(input.ssl, false),
  };
}

export function maskConnectionString(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.password) parsed.password = '****';
    if (parsed.username) parsed.username = parsed.username ? '****' : '';
    return parsed.toString();
  } catch {
    if (value.length <= 8) return '****';
    return `${value.slice(0, 4)}****${value.slice(-4)}`;
  }
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

function quoteIdentifier(dialect: MigrationDialect, identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return dialect === 'mysql' ? `\`${identifier}\`` : `"${identifier}"`;
}

function placeholder(dialect: MigrationDialect, index: number): string {
  return dialect === 'postgres' ? `$${index}` : '?';
}

function normalizeColumnValue(tableName: string, columnName: string, value: unknown): unknown {
  if (value === undefined) return null;
  const logicalType = schemaContract.tables[tableName]?.columns[columnName]?.logicalType ?? null;
  if (logicalType === 'json' && value !== null && typeof value !== 'string') {
    return JSON.stringify(value);
  }
  return value;
}

function normalizeSqlParameter(dialect: MigrationDialect, value: unknown): unknown {
  if (dialect === 'sqlite' && typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return value;
}

function buildInsertStatements(tableName: string, rows: Array<Record<string, unknown>>): InsertStatement[] {
  const table = schemaContract.tables[tableName];
  if (!table || rows.length === 0) return [];
  const columns = Object.keys(table.columns);
  return rows.map((row) => ({
    tableName,
    columns,
    values: columns.map((column) => normalizeColumnValue(tableName, column, row[snakeToCamel(column)] ?? row[column])),
  }));
}

function buildInsertSql(dialect: MigrationDialect, statement: InsertStatement): { sqlText: string; params: unknown[] } {
  const quotedTable = quoteIdentifier(dialect, statement.tableName);
  const quotedColumns = statement.columns.map((column) => quoteIdentifier(dialect, column)).join(', ');
  const placeholders = statement.columns.map((_, index) => placeholder(dialect, index + 1)).join(', ');
  return {
    sqlText: `INSERT INTO ${quotedTable} (${quotedColumns}) VALUES (${placeholders})`,
    params: statement.values.map((value) => normalizeSqlParameter(dialect, value)),
  };
}

async function loadStatements(): Promise<{ statements: InsertStatement[]; rows: DatabaseMigrationSummary['rows'] }> {
  const statements: InsertStatement[] = [];
  const rows = {} as DatabaseMigrationSummary['rows'];
  for (const spec of NATIVE_TABLES) {
    const tableRows = await spec.selectRows();
    rows[spec.summaryKey] = tableRows.length;
    statements.push(...buildInsertStatements(spec.tableName, tableRows));
  }
  return { statements, rows };
}

async function createClient(input: NormalizedDatabaseMigrationInput): Promise<RuntimeSchemaClient> {
  return await createRuntimeSchemaClient({
    dialect: input.dialect,
    connectionString: input.connectionString,
    ssl: input.ssl,
  });
}

async function clearTargetData(client: RuntimeSchemaClient): Promise<void> {
  for (const tableName of CLEAR_TABLE_ORDER) {
    await client.execute(`DELETE FROM ${quoteIdentifier(client.dialect, tableName)}`);
  }
}

async function insertAllRows(client: RuntimeSchemaClient, statements: InsertStatement[]): Promise<void> {
  for (const statement of statements) {
    const { sqlText, params } = buildInsertSql(client.dialect, statement);
    await client.execute(sqlText, params);
  }
}

async function syncPostgresSequences(client: RuntimeSchemaClient): Promise<void> {
  if (client.dialect !== 'postgres') return;
  for (const tableName of POSTGRES_SEQUENCE_TABLES) {
    await client.execute(`SELECT setval(pg_get_serial_sequence('${tableName}', 'id'), COALESCE((SELECT MAX(id) FROM "${tableName}"), 1), TRUE)`);
  }
}

export async function bootstrapRuntimeDatabaseSchema(input: Pick<NormalizedDatabaseMigrationInput, 'dialect' | 'connectionString' | 'ssl'>): Promise<void> {
  const client = await createRuntimeSchemaClient({
    dialect: input.dialect,
    connectionString: input.connectionString,
    ssl: input.ssl,
  });
  try {
    await ensureRuntimeDatabaseSchema(client);
  } finally {
    await client.close();
  }
}

export async function migrateCurrentDatabase(input: DatabaseMigrationInput): Promise<DatabaseMigrationSummary> {
  const normalized = normalizeMigrationInput(input);
  const snapshot = await loadStatements();
  const client = await createClient(normalized);
  const timestamp = Date.now();

  try {
    await ensureRuntimeDatabaseSchema(client);
    await client.begin();
    try {
      if (normalized.overwrite) {
        await clearTargetData(client);
      }
      await insertAllRows(client, snapshot.statements);
      await syncPostgresSequences(client);
      await client.commit();
    } catch (error) {
      await client.rollback();
      throw error;
    }
  } finally {
    await client.close();
  }

  return {
    dialect: normalized.dialect,
    connection: maskConnectionString(normalized.connectionString),
    overwrite: normalized.overwrite,
    version: CURRENT_CONFIG_VERSION,
    timestamp,
    rows: snapshot.rows,
  };
}

export async function testDatabaseConnection(input: DatabaseMigrationInput): Promise<{ dialect: MigrationDialect; connection: string }> {
  const normalized = normalizeMigrationInput(input);
  const client = await createClient(normalized);
  try {
    await client.execute('SELECT 1');
  } finally {
    await client.close();
  }
  return {
    dialect: normalized.dialect,
    connection: maskConnectionString(normalized.connectionString),
  };
}

export const __databaseMigrationServiceTestUtils = {
  ensureSchema: ensureRuntimeDatabaseSchema,
};
