import { asc, eq, gt } from 'drizzle-orm';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import cron from 'node-cron';
import { db, schema } from '../db/index.js';
import { upsertSetting } from '../db/upsertSetting.js';
import {
  CURRENT_CONFIG_VERSION,
  migratePublishedMainPreferenceSettings,
} from './configMigrationService.js';
import {
  invalidateRouteGraphReadCaches,
  publishRouteGraphSource,
} from './routeGraphService.js';
import {
  migrateImportedRouteGraphSourceJson,
  migratePreviousRouteBackupToCurrentRuntime,
  type BackupImportNotice,
  type BackupImportRouteRuntimeMigrationResult,
} from './backupImportMigration.js';
import {
  migrateImportedAccountCredential,
  reconcileImportedAccountCredentialTokens,
  type ImportedAccountCredential,
} from './backupAccountCredentialMigration.js';
import { parseRouteGraphSource, type RouteGraphSource } from '../../shared/routeGraph.js';
import { config as runtimeConfig } from '../config.js';

const BACKUP_VERSION = CURRENT_CONFIG_VERSION;
const BACKUP_WEBDAV_CONFIG_SETTING_KEY = 'backup_webdav_config_v1';
const BACKUP_WEBDAV_STATE_SETTING_KEY = 'backup_webdav_state_v1';
const BACKUP_WEBDAV_DEFAULT_AUTO_SYNC_CRON = '0 */6 * * *';
const BACKUP_WEBDAV_FETCH_TIMEOUT_MS = 15_000;
// Some configuration rows contain arbitrary JSON or full route graphs. Keep
// each database page to one row so no unbounded collection is resident.
const BACKUP_EXPORT_PAGE_SIZE = 1;
// Size batches by both rows and parameters. The parameter budget stays below
// SQLite's common 999-variable limit while allowing narrow, high-volume rows
// such as model availability to import efficiently.
const BACKUP_IMPORT_MAX_ROWS = 100;
const BACKUP_IMPORT_MAX_PARAMETERS = 900;

const require = createRequire(import.meta.url);
const { parser: createJsonParser } = require('stream-json') as {
  parser: () => Transform;
};
const Assembler = require('stream-json/Assembler') as new () => {
  current: unknown;
  done: boolean;
  consume(chunk: { name: string; value?: unknown }): unknown;
};

const EXCLUDED_SETTING_KEYS = new Set<string>([
  'auth_token',
  'db_type',
  'db_url',
  'db_ssl',
]);

let backupWebdavTask: cron.ScheduledTask | null = null;

export type BackupExportType = 'all' | 'accounts' | 'preferences';

export interface BackupWebdavConfig {
  enabled: boolean;
  fileUrl: string;
  username: string;
  password: string;
  exportType: BackupExportType;
  autoSyncEnabled: boolean;
  autoSyncCron: string;
}

export interface BackupWebdavConfigView {
  enabled: boolean;
  fileUrl: string;
  username: string;
  exportType: BackupExportType;
  autoSyncEnabled: boolean;
  autoSyncCron: string;
  hasPassword: boolean;
  passwordMasked: string;
}

export interface BackupWebdavState {
  lastSyncAt: string | null;
  lastError: string | null;
}

interface BackupRouteGraphSection {
  versions: Array<typeof schema.routeGraphVersions.$inferSelect>;
  activeVersion: typeof schema.routeGraphActiveVersion.$inferSelect | null;
  drafts: Array<typeof schema.routeGraphDrafts.$inferSelect>;
  operationBatches?: Array<typeof schema.routeGraphWorkspaceOperationBatches.$inferSelect>;
}

interface AccountsBackupSection {
  sites: Array<typeof schema.sites.$inferSelect>;
  siteApiEndpoints?: Array<typeof schema.siteApiEndpoints.$inferSelect>;
  modelCatalogSources?: Array<typeof schema.modelCatalogSources.$inferSelect>;
  apiEndpointProfiles?: Array<typeof schema.apiEndpointProfiles.$inferSelect>;
  endpointModelObservations?: Array<typeof schema.endpointModelObservations.$inferSelect>;
  credentialEndpointBindings?: Array<typeof schema.credentialEndpointBindings.$inferSelect>;
  accounts: Array<typeof schema.accounts.$inferSelect>;
  accountTokens: Array<typeof schema.accountTokens.$inferSelect>;
  modelAvailability?: Array<typeof schema.modelAvailability.$inferSelect>;
  tokenModelAvailability?: Array<typeof schema.tokenModelAvailability.$inferSelect>;
  tokenDisabledModels?: Array<typeof schema.tokenDisabledModels.$inferSelect>;
  upstreamModelCostPricings?: Array<typeof schema.upstreamModelCostPricings.$inferSelect>;
  providerPricingCatalogCaches?: Array<typeof schema.providerPricingCatalogCaches.$inferSelect>;
  walletAcquisitionProfiles?: Array<typeof schema.walletAcquisitionProfiles.$inferSelect>;
  fxRateSnapshots?: Array<typeof schema.fxRateSnapshots.$inferSelect>;
  runtimeExecutionTargets?: Array<typeof schema.runtimeExecutionTargets.$inferSelect>;
  runtimeExecutionTargetState?: Array<typeof schema.runtimeExecutionTargetState.$inferSelect>;
  routeGraph?: BackupRouteGraphSection;
  oauthRouteUnits?: Array<typeof schema.oauthRouteUnits.$inferSelect>;
  oauthRouteUnitMembers?: Array<typeof schema.oauthRouteUnitMembers.$inferSelect>;
  siteDisabledModels?: Array<typeof schema.siteDisabledModels.$inferSelect>;
  downstreamApiKeys?: Array<typeof schema.downstreamApiKeys.$inferSelect>;
  siteAnnouncements?: Array<typeof schema.siteAnnouncements.$inferSelect>;
}

interface PreferencesBackupSection {
  settings: Array<{ key: string; value: unknown }>;
}

type CoercedAccountsSection = {
  section: AccountsBackupSection;
  importedAccountCredentials: ImportedAccountCredential[];
  warnings: string[];
  notices: BackupImportNotice[];
  graphSource?: RouteGraphSource;
};

interface BackupFullV2 {
  version: string;
  timestamp: number;
  accounts: AccountsBackupSection;
  preferences: PreferencesBackupSection;
}

interface BackupAccountsPartialV2 {
  version: string;
  timestamp: number;
  type: 'accounts';
  accounts: AccountsBackupSection;
}

interface BackupPreferencesPartialV2 {
  version: string;
  timestamp: number;
  type: 'preferences';
  preferences: PreferencesBackupSection;
}

type BackupV2 = BackupFullV2 | BackupAccountsPartialV2 | BackupPreferencesPartialV2;
type RawBackupData = Record<string, unknown>;

export interface BackupImportResult {
  allImported: boolean;
  sections: {
    accounts: boolean;
    preferences: boolean;
  };
  appliedSettings: Array<{ key: string; value: unknown }>;
  summary?: {
    importedSites: number;
    importedAccounts: number;
    importedProfiles: number;
    importedApiKeyConnections: number;
    skippedAccounts: number;
    ignoredSections: string[];
  };
  warnings?: string[];
  notices?: BackupImportNotice[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseSettingValue(raw: string | null): unknown {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function isValidBackupExportType(value: unknown): value is BackupExportType {
  return value === 'all' || value === 'accounts' || value === 'preferences';
}

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

function isValidHttpUrl(raw: string): boolean {
  if (!raw.trim()) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function readSettingValue(key: string): Promise<unknown> {
  const row = await db.select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .get();
  return parseSettingValue(row?.value ?? null);
}

function normalizeBackupWebdavConfig(raw: unknown): BackupWebdavConfig {
  const source = isRecord(raw) ? raw : {};
  const exportType = isValidBackupExportType(source.exportType) ? source.exportType : 'all';
  const autoSyncCron = typeof source.autoSyncCron === 'string' && cron.validate(source.autoSyncCron)
    ? source.autoSyncCron
    : BACKUP_WEBDAV_DEFAULT_AUTO_SYNC_CRON;
  return {
    enabled: source.enabled === true,
    fileUrl: normalizeBackupWebdavExportFileUrl(asString(source.fileUrl)),
    username: asString(source.username),
    password: typeof source.password === 'string' ? source.password : '',
    exportType,
    autoSyncEnabled: source.autoSyncEnabled === true,
    autoSyncCron,
  };
}

function normalizeBackupWebdavExportFileUrl(raw: string): string {
  const value = raw.trim();
  if (!value || value.toLowerCase().endsWith('.gz')) return value;
  return value.toLowerCase().endsWith('.json') ? `${value}.gz` : `${value}.json.gz`;
}

function normalizeBackupWebdavState(raw: unknown): BackupWebdavState {
  const source = isRecord(raw) ? raw : {};
  return {
    lastSyncAt: typeof source.lastSyncAt === 'string' && source.lastSyncAt.trim() ? source.lastSyncAt : null,
    lastError: typeof source.lastError === 'string' && source.lastError.trim() ? source.lastError : null,
  };
}

function toBackupWebdavConfigView(config: BackupWebdavConfig): BackupWebdavConfigView {
  return {
    enabled: config.enabled,
    fileUrl: config.fileUrl,
    username: config.username,
    exportType: config.exportType,
    autoSyncEnabled: config.autoSyncEnabled,
    autoSyncCron: config.autoSyncCron,
    hasPassword: config.password.length > 0,
    passwordMasked: maskSecret(config.password),
  };
}

async function loadBackupWebdavConfig(): Promise<BackupWebdavConfig> {
  return normalizeBackupWebdavConfig(await readSettingValue(BACKUP_WEBDAV_CONFIG_SETTING_KEY));
}

async function loadBackupWebdavState(): Promise<BackupWebdavState> {
  return normalizeBackupWebdavState(await readSettingValue(BACKUP_WEBDAV_STATE_SETTING_KEY));
}

async function writeBackupWebdavState(next: BackupWebdavState): Promise<void> {
  await upsertSetting(BACKUP_WEBDAV_STATE_SETTING_KEY, next);
}

function resolveBackupWebdavAuthHeader(config: BackupWebdavConfig): string | null {
  if (!config.username && !config.password) return null;
  return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
}

function validateBackupWebdavConfig(config: BackupWebdavConfig): void {
  if (config.enabled && !isValidHttpUrl(config.fileUrl)) {
    throw new Error('WebDAV 文件地址无效，请填写 http/https 文件 URL');
  }
  if (!isValidBackupExportType(config.exportType)) {
    throw new Error('WebDAV 导出类型无效，仅支持 all/accounts/preferences');
  }
  if (!cron.validate(config.autoSyncCron)) {
    throw new Error('WebDAV 自动同步 Cron 表达式无效');
  }
  if (config.autoSyncEnabled && !config.enabled) {
    throw new Error('启用自动同步前请先启用 WebDAV 备份');
  }
}

async function fetchBackupWebdav(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    controller.abort();
  }, BACKUP_WEBDAV_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`WebDAV 请求超时（${Math.max(1, Math.round(BACKUP_WEBDAV_FETCH_TIMEOUT_MS / 1000))}s）`);
    }
    throw error;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  }
}

function stopBackupWebdavScheduler(): void {
  if (!backupWebdavTask) return;
  backupWebdavTask.stop();
  backupWebdavTask = null;
}

async function exportRouteGraphSection(): Promise<BackupRouteGraphSection> {
  const [versions, activeVersion, drafts, operationBatches] = await Promise.all([
    db.select().from(schema.routeGraphVersions).all(),
    db.select().from(schema.routeGraphActiveVersion).where(eq(schema.routeGraphActiveVersion.id, 1)).get(),
    db.select().from(schema.routeGraphDrafts).all(),
    db.select().from(schema.routeGraphWorkspaceOperationBatches).all(),
  ]);
  return {
    versions,
    activeVersion: activeVersion ?? null,
    drafts,
    operationBatches,
  };
}

async function exportAccountsSection(): Promise<AccountsBackupSection> {
  const [
    sites,
    siteApiEndpoints,
    modelCatalogSources,
    apiEndpointProfiles,
    endpointModelObservations,
    credentialEndpointBindings,
    accounts,
    accountTokens,
    modelAvailability,
    tokenModelAvailability,
    tokenDisabledModels,
    upstreamModelCostPricings,
    providerPricingCatalogCaches,
    walletAcquisitionProfiles,
    fxRateSnapshots,
    runtimeExecutionTargets,
    runtimeExecutionTargetState,
    oauthRouteUnits,
    oauthRouteUnitMembers,
    siteDisabledModels,
    downstreamApiKeys,
    siteAnnouncements,
    routeGraph,
  ] = await Promise.all([
    db.select().from(schema.sites).all(),
    db.select().from(schema.siteApiEndpoints).all(),
    db.select().from(schema.modelCatalogSources).all(),
    db.select().from(schema.apiEndpointProfiles).all(),
    db.select().from(schema.endpointModelObservations).all(),
    db.select().from(schema.credentialEndpointBindings).all(),
    db.select().from(schema.accounts).all(),
    db.select().from(schema.accountTokens).all(),
    db.select().from(schema.modelAvailability).all(),
    db.select().from(schema.tokenModelAvailability).all(),
    db.select().from(schema.tokenDisabledModels).all(),
    db.select().from(schema.upstreamModelCostPricings).all(),
    db.select().from(schema.providerPricingCatalogCaches).all(),
    db.select().from(schema.walletAcquisitionProfiles).all(),
    db.select().from(schema.fxRateSnapshots).all(),
    db.select().from(schema.runtimeExecutionTargets).all(),
    db.select().from(schema.runtimeExecutionTargetState).all(),
    db.select().from(schema.oauthRouteUnits).all(),
    db.select().from(schema.oauthRouteUnitMembers).all(),
    db.select().from(schema.siteDisabledModels).all(),
    db.select().from(schema.downstreamApiKeys).all(),
    db.select().from(schema.siteAnnouncements).all(),
    exportRouteGraphSection(),
  ]);

  return {
    sites,
    siteApiEndpoints,
    modelCatalogSources,
    apiEndpointProfiles,
    endpointModelObservations,
    credentialEndpointBindings,
    accounts,
    accountTokens,
    modelAvailability,
    tokenModelAvailability,
    tokenDisabledModels,
    upstreamModelCostPricings,
    providerPricingCatalogCaches,
    walletAcquisitionProfiles,
    fxRateSnapshots,
    runtimeExecutionTargets,
    runtimeExecutionTargetState,
    routeGraph,
    oauthRouteUnits,
    oauthRouteUnitMembers,
    siteDisabledModels,
    downstreamApiKeys,
    siteAnnouncements,
  };
}

async function exportPreferencesSection(): Promise<PreferencesBackupSection> {
  const settings = (await db.select().from(schema.settings).all())
    .filter((row) => !EXCLUDED_SETTING_KEYS.has(row.key))
    .map((row) => ({
      key: row.key,
      value: parseSettingValue(row.value),
    }));
  return {
    settings: migratePublishedMainPreferenceSettings(settings).settings,
  };
}

async function* jsonArrayFromIdPages(table: any): AsyncGenerator<string> {
  let afterId = 0;
  let first = true;
  yield '[';
  while (true) {
    const rows = await db.select().from(table)
      .where(gt(table.id, afterId))
      .orderBy(asc(table.id))
      .limit(BACKUP_EXPORT_PAGE_SIZE)
      .all();
    if (rows.length === 0) break;
    for (const row of rows) {
      yield `${first ? '' : ','}${JSON.stringify(row)}`;
      first = false;
    }
    afterId = Number(rows[rows.length - 1]?.id);
  }
  yield ']';
}

async function* preferencesJson(): AsyncGenerator<string> {
  let afterKey = '';
  let first = true;
  let sawPricingReferenceConfig = false;
  let sawPlatformPricingConfig = false;
  let sawConfigVersion = false;
  let legacyRoutingFallbackUnitCost: number | null = null;
  yield '{"settings":[';
  while (true) {
    const rows = await db.select().from(schema.settings)
      .where(gt(schema.settings.key, afterKey))
      .orderBy(asc(schema.settings.key))
      .limit(BACKUP_EXPORT_PAGE_SIZE)
      .all();
    if (rows.length === 0) break;
    for (const row of rows) {
      afterKey = row.key;
      if (EXCLUDED_SETTING_KEYS.has(row.key)) continue;
      const value = parseSettingValue(row.value);
      if (row.key === 'routing_fallback_unit_cost') {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) legacyRoutingFallbackUnitCost = numeric;
        continue;
      }
      if (row.key === 'pricing_reference_config_v1') sawPricingReferenceConfig = true;
      if (row.key === 'platform_pricing_config_v1') sawPlatformPricingConfig = true;
      if (row.key === 'metapi_config_version') {
        sawConfigVersion = true;
        yield `${first ? '' : ','}${JSON.stringify({ key: row.key, value: CURRENT_CONFIG_VERSION })}`;
        first = false;
        continue;
      }
      yield `${first ? '' : ','}${JSON.stringify({ key: row.key, value })}`;
      first = false;
    }
  }
  const migrated = migratePublishedMainPreferenceSettings([]).settings;
  if (!sawPricingReferenceConfig) {
    const row = migrated.find((item) => item.key === 'pricing_reference_config_v1');
    if (row) {
      yield `${first ? '' : ','}${JSON.stringify(row)}`;
      first = false;
    }
  }
  if (!sawPlatformPricingConfig) {
    const row = migrated.find((item) => item.key === 'platform_pricing_config_v1');
    if (row) {
      const value = legacyRoutingFallbackUnitCost === null
        ? row.value
        : {
          ...(row.value as Record<string, unknown>),
          upstreamDefaultPricing: {
            ...((row.value as any).upstreamDefaultPricing),
            inputPerMillion: legacyRoutingFallbackUnitCost,
            outputPerMillion: legacyRoutingFallbackUnitCost,
          },
        };
      yield `${first ? '' : ','}${JSON.stringify({ key: row.key, value })}`;
      first = false;
    }
  }
  if (!sawConfigVersion) {
    const row = migrated.find((item) => item.key === 'metapi_config_version');
    if (row) {
      yield `${first ? '' : ','}${JSON.stringify(row)}`;
      first = false;
    }
  }
  yield ']}';
}

async function* accountsJson(): AsyncGenerator<string> {
  const fields: Array<[string, any]> = [
    ['sites', schema.sites],
    ['siteApiEndpoints', schema.siteApiEndpoints],
    ['modelCatalogSources', schema.modelCatalogSources],
    ['apiEndpointProfiles', schema.apiEndpointProfiles],
    ['endpointModelObservations', schema.endpointModelObservations],
    ['credentialEndpointBindings', schema.credentialEndpointBindings],
    ['accounts', schema.accounts],
    ['accountTokens', schema.accountTokens],
    ['modelAvailability', schema.modelAvailability],
    ['tokenModelAvailability', schema.tokenModelAvailability],
    ['tokenDisabledModels', schema.tokenDisabledModels],
    ['upstreamModelCostPricings', schema.upstreamModelCostPricings],
    ['providerPricingCatalogCaches', schema.providerPricingCatalogCaches],
    ['walletAcquisitionProfiles', schema.walletAcquisitionProfiles],
    ['fxRateSnapshots', schema.fxRateSnapshots],
    ['runtimeExecutionTargets', schema.runtimeExecutionTargets],
    ['runtimeExecutionTargetState', schema.runtimeExecutionTargetState],
    ['oauthRouteUnits', schema.oauthRouteUnits],
    ['oauthRouteUnitMembers', schema.oauthRouteUnitMembers],
    ['siteDisabledModels', schema.siteDisabledModels],
    ['downstreamApiKeys', schema.downstreamApiKeys],
    ['siteAnnouncements', schema.siteAnnouncements],
  ];
  yield '{';
  let first = true;
  for (const [name, table] of fields) {
    yield `${first ? '' : ','}${JSON.stringify(name)}:`;
    yield* jsonArrayFromIdPages(table);
    first = false;
  }
  yield ',"routeGraph":{"versions":';
  yield* jsonArrayFromIdPages(schema.routeGraphVersions);
  const activeVersion = await db.select().from(schema.routeGraphActiveVersion)
    .where(eq(schema.routeGraphActiveVersion.id, 1)).get();
  yield `,"activeVersion":${JSON.stringify(activeVersion ?? null)},"drafts":`;
  yield* jsonArrayFromIdPages(schema.routeGraphDrafts);
  yield ',"operationBatches":';
  yield* jsonArrayFromIdPages(schema.routeGraphWorkspaceOperationBatches);
  yield '}}';
}

/**
 * Creates a gzip-compressed backup stream. Every table is paged before JSON
 * serialization so the server never retains the complete backup in memory.
 */
export function createBackupExportStream(type: BackupExportType): Readable {
  const source = Readable.from((async function* () {
    yield `{"version":${JSON.stringify(BACKUP_VERSION)},"timestamp":${Date.now()}`;
    if (type === 'accounts') {
      yield ',"type":"accounts","accounts":';
      yield* accountsJson();
    } else if (type === 'preferences') {
      yield ',"type":"preferences","preferences":';
      yield* preferencesJson();
    } else {
      yield ',"accounts":';
      yield* accountsJson();
      yield ',"preferences":';
      yield* preferencesJson();
    }
    yield '}';
  })());
  return source.pipe(createGzip());
}

class ByteLimitTransform extends Transform {
  private total = 0;

  constructor(private readonly limit: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void) {
    this.total += chunk.length;
    if (this.total > this.limit) {
      callback(new Error('压缩备份解压后超过允许大小'));
      return;
    }
    callback(null, chunk);
  }
}

const NATIVE_BACKUP_ARRAY_PATHS = [
  'accounts.sites',
  'accounts.siteApiEndpoints',
  'accounts.modelCatalogSources',
  'accounts.apiEndpointProfiles',
  'accounts.accounts',
  'accounts.accountTokens',
  'accounts.credentialEndpointBindings',
  'accounts.endpointModelObservations',
  'accounts.modelAvailability',
  'accounts.tokenModelAvailability',
  'accounts.tokenDisabledModels',
  'accounts.upstreamModelCostPricings',
  'accounts.providerPricingCatalogCaches',
  'accounts.walletAcquisitionProfiles',
  'accounts.fxRateSnapshots',
  'accounts.siteDisabledModels',
  'accounts.oauthRouteUnits',
  'accounts.oauthRouteUnitMembers',
  'accounts.runtimeExecutionTargets',
  'accounts.runtimeExecutionTargetState',
  'accounts.downstreamApiKeys',
  'accounts.siteAnnouncements',
  'accounts.routeGraph.versions',
  'accounts.routeGraph.drafts',
  'accounts.routeGraph.operationBatches',
  'preferences.settings',
] as const;

type NativeBackupArrayPath = typeof NATIVE_BACKUP_ARRAY_PATHS[number];

// These arrays are emitted before one of their foreign-key parents in the
// canonical export. Keep only these dependency inversions buffered until the
// parent array has been consumed.
const NATIVE_BACKUP_DEFERRED_ARRAY_PATHS = new Set<NativeBackupArrayPath>([
  'accounts.credentialEndpointBindings',
  'accounts.runtimeExecutionTargets',
  'accounts.runtimeExecutionTargetState',
]);

function pathFromStack(stack: Array<string | number | null>): string {
  return stack.filter((part): part is string | number => part !== null).join('.');
}

function resetImportedSiteApiEndpointHealth(row: unknown): unknown {
  return isRecord(row) ? {
    ...row,
    cooldownUntil: null,
    lastFailedAt: null,
    lastFailureReason: null,
  } : row;
}

function updateJsonPathStackBeforeToken(
  stack: Array<string | number | null>,
  previousToken: string,
  chunk: { name: string; value?: unknown },
): void {
  switch (chunk.name) {
    case 'startObject':
    case 'startArray':
    case 'startString':
    case 'startNumber':
    case 'nullValue':
    case 'trueValue':
    case 'falseValue':
      if (typeof stack.at(-1) === 'number') stack[stack.length - 1] = Number(stack.at(-1)) + 1;
      break;
    case 'keyValue':
      stack[stack.length - 1] = String(chunk.value);
      break;
    case 'numberValue':
    case 'stringValue':
      if (previousToken !== 'endNumber' && previousToken !== 'endString' && typeof stack.at(-1) === 'number') {
        stack[stack.length - 1] = Number(stack.at(-1)) + 1;
      }
      break;
  }
}

function updateJsonPathStackAfterToken(
  stack: Array<string | number | null>,
  chunk: { name: string },
): void {
  if (chunk.name === 'startObject') stack.push(null);
  else if (chunk.name === 'startArray') stack.push(-1);
  else if (chunk.name === 'endObject' || chunk.name === 'endArray') stack.pop();
}

async function streamNativeBackupJson(
  filePath: string,
  handlers: {
    onArrayStart(path: NativeBackupArrayPath): Promise<void>;
    onValue(path: NativeBackupArrayPath | string, value: unknown): Promise<void>;
  },
): Promise<void> {
  const arrayPaths = new Set<string>(NATIVE_BACKUP_ARRAY_PATHS);
  const directValuePaths = new Set(['version', 'timestamp', 'type', 'accounts.routeGraph.activeVersion']);
  const parser = createJsonParser();
  const stack: Array<string | number | null> = [];
  let previousToken = '';
  let capture: { path: string; assembler: InstanceType<typeof Assembler> } | null = null;

  createReadStream(filePath).pipe(parser);
  for await (const chunk of parser as AsyncIterable<{ name: string; value?: unknown }>) {
    updateJsonPathStackBeforeToken(stack, previousToken, chunk);
    const path = pathFromStack(stack);
    if (chunk.name === 'startArray' && arrayPaths.has(path)) {
      await handlers.onArrayStart(path as NativeBackupArrayPath);
    }

    if (capture) {
      capture.assembler.consume(chunk);
      if (capture.assembler.done) {
        await handlers.onValue(capture.path, capture.assembler.current);
        capture = null;
      }
    } else {
      const arrayPath = typeof stack.at(-1) === 'number'
        ? pathFromStack(stack.slice(0, -1))
        : null;
      const capturePath = arrayPath && arrayPaths.has(arrayPath)
        ? arrayPath
        : (directValuePaths.has(path) ? path : null);
      if ((chunk.name === 'startObject' || chunk.name === 'startArray') && capturePath) {
        const assembler = new Assembler();
        assembler.consume(chunk);
        capture = { path: capturePath, assembler };
      } else if (
        capturePath
        && ['nullValue', 'trueValue', 'falseValue', 'stringValue', 'numberValue'].includes(chunk.name)
      ) {
        await handlers.onValue(capturePath, chunk.value);
      }
    }

    updateJsonPathStackAfterToken(stack, chunk);
    previousToken = chunk.name;
  }
}

const NOT_NATIVE_BACKUP = Symbol('not-native-backup');

async function importNativeBackupFromJsonFile(filePath: string): Promise<BackupImportResult | null> {
  const values = new Map<string, unknown>();
  const seenArrays = new Set<NativeBackupArrayPath>();
  const rows = new Map<NativeBackupArrayPath, unknown[]>();
  const routeGraphSources = new Map<unknown, string>();
  const appliedSettings: Array<{ key: string; value: unknown }> = [];
  let accountsCleared = false;
  let graphSource: RouteGraphSource | null = null;
  let sawPricingReferenceConfig = false;
  let sawPlatformPricingConfig = false;
  let sawConfigVersion = false;
  let legacyRoutingFallbackUnitCost: number | null = null;
  const importedAccountCredentials = new Map<number, ImportedAccountCredential>();

  try {
    await db.transaction(async (tx) => {
      const ensureNativeHeader = () => {
        if (values.get('version') !== BACKUP_VERSION) throw NOT_NATIVE_BACKUP;
        if (values.get('timestamp') === undefined || values.get('timestamp') === null) {
          throw new Error('导入数据格式错误：缺少 timestamp');
        }
      };
      const flush = async (path: NativeBackupArrayPath, table: any, mapRow: (row: unknown) => unknown = (row) => row) => {
        const batch = rows.get(path);
        if (!batch?.length) return;
        rows.set(path, []);
        await tx.insert(table).values(batch.map(mapRow) as any).run();
      };
      const clearAccounts = async () => {
        if (accountsCleared) return;
        ensureNativeHeader();
      await deleteAll(tx, schema.siteAnnouncements);
      await deleteAll(tx, schema.downstreamApiKeys);
      await restoreRouteGraph(tx, undefined);
      await deleteAll(tx, schema.runtimeExecutionTargetState);
      await deleteAll(tx, schema.runtimeExecutionTargets);
      await deleteAll(tx, schema.oauthRouteUnitMembers);
      await deleteAll(tx, schema.oauthRouteUnits);
      await deleteAll(tx, schema.tokenModelAvailability);
      await deleteAll(tx, schema.tokenDisabledModels);
      await deleteAll(tx, schema.modelAvailability);
      await deleteAll(tx, schema.endpointModelObservations);
      await deleteAll(tx, schema.credentialEndpointBindings);
      await deleteAll(tx, schema.accountTokens);
      await deleteAll(tx, schema.accounts);
      await deleteAll(tx, schema.apiEndpointProfiles);
      await deleteAll(tx, schema.modelCatalogSources);
      await deleteAll(tx, schema.siteApiEndpoints);
      await deleteAll(tx, schema.siteDisabledModels);
      await deleteAll(tx, schema.upstreamModelCostPricings);
      await deleteAll(tx, schema.providerPricingCatalogCaches);
      await deleteAll(tx, schema.walletAcquisitionProfiles);
      await deleteAll(tx, schema.fxRateSnapshots);
      await deleteAll(tx, schema.sites);
        accountsCleared = true;
      };
      const tables = new Map<NativeBackupArrayPath, [any, (row: unknown) => unknown]>([
        ['accounts.sites', [schema.sites, (row) => row]],
        ['accounts.siteApiEndpoints', [schema.siteApiEndpoints, resetImportedSiteApiEndpointHealth]],
        ['accounts.modelCatalogSources', [schema.modelCatalogSources, (row) => row]],
        ['accounts.apiEndpointProfiles', [schema.apiEndpointProfiles, (row) => row]],
        ['accounts.accounts', [schema.accounts, (row) => {
          const normalized = migrateImportedAccountCredential(row);
          importedAccountCredentials.set(normalized.importedCredential.accountId, normalized.importedCredential);
          return normalized.account;
        }]],
        ['accounts.accountTokens', [schema.accountTokens, (row) => row]],
        ['accounts.credentialEndpointBindings', [schema.credentialEndpointBindings, (row) => row]],
        ['accounts.endpointModelObservations', [schema.endpointModelObservations, (row) => row]],
        ['accounts.modelAvailability', [schema.modelAvailability, (row) => row]],
        ['accounts.tokenModelAvailability', [schema.tokenModelAvailability, (row) => row]],
        ['accounts.tokenDisabledModels', [schema.tokenDisabledModels, (row) => row]],
        ['accounts.upstreamModelCostPricings', [schema.upstreamModelCostPricings, (row) => row]],
        ['accounts.providerPricingCatalogCaches', [schema.providerPricingCatalogCaches, (row) => row]],
        ['accounts.walletAcquisitionProfiles', [schema.walletAcquisitionProfiles, (row) => row]],
        ['accounts.fxRateSnapshots', [schema.fxRateSnapshots, (row) => row]],
        ['accounts.siteDisabledModels', [schema.siteDisabledModels, (row) => row]],
        ['accounts.oauthRouteUnits', [schema.oauthRouteUnits, (row) => row]],
        ['accounts.oauthRouteUnitMembers', [schema.oauthRouteUnitMembers, (row) => row]],
        ['accounts.runtimeExecutionTargets', [schema.runtimeExecutionTargets, (row) => row]],
        ['accounts.runtimeExecutionTargetState', [schema.runtimeExecutionTargetState, (row) => row]],
        ['accounts.downstreamApiKeys', [schema.downstreamApiKeys, (row) => row]],
        ['accounts.siteAnnouncements', [schema.siteAnnouncements, (row) => row]],
        ['accounts.routeGraph.versions', [schema.routeGraphVersions, (row) => isRecord(row) ? ({ ...row, sourceGraphJson: migrateImportedRouteGraphSourceJson(String(row.sourceGraphJson || '')) }) : row]],
        ['accounts.routeGraph.drafts', [schema.routeGraphDrafts, (row) => isRecord(row) ? ({ ...row, workingGraphJson: migrateImportedRouteGraphSourceJson(String(row.workingGraphJson || '')) }) : row]],
        ['accounts.routeGraph.operationBatches', [schema.routeGraphWorkspaceOperationBatches, (row) => row]],
      ]);
      const flushPendingRows = async () => {
        for (const [path, [table, mapRow]] of tables) {
          if (!NATIVE_BACKUP_DEFERRED_ARRAY_PATHS.has(path)) await flush(path, table, mapRow);
        }
      };

      await streamNativeBackupJson(filePath, {
        onArrayStart: async (path) => {
          seenArrays.add(path);
          ensureNativeHeader();
          if (path.startsWith('accounts.')) await clearAccounts();
          // Native exports order arrays by foreign-key dependency. Commit the
          // preceding array before accepting rows that may reference it.
          await flushPendingRows();
          if (
            seenArrays.has('accounts.accountTokens')
            && path !== 'accounts.accountTokens'
          ) {
            const binding = tables.get('accounts.credentialEndpointBindings')!;
            await flush('accounts.credentialEndpointBindings', binding[0], binding[1]);
          }
        },
        onValue: async (path, value) => {
          if (!NATIVE_BACKUP_ARRAY_PATHS.includes(path as NativeBackupArrayPath)) {
            values.set(path, value);
            if (path === 'accounts.routeGraph.activeVersion' && isRecord(value)) {
              await flush('accounts.routeGraph.versions', schema.routeGraphVersions, (row) => {
                const sourceGraphJson = migrateImportedRouteGraphSourceJson(String((row as any)?.sourceGraphJson || ''));
                return isRecord(row) ? { ...row, sourceGraphJson } : row;
              });
              await tx.insert(schema.routeGraphActiveVersion).values(value as any).run();
              const sourceGraphJson = routeGraphSources.get(value.versionId);
              if (sourceGraphJson) graphSource = parseRouteGraphSource(sourceGraphJson);
            }
            return;
          }
          if (path === 'preferences.settings') {
            if (!isRecord(value)) return;
            const key = typeof value.key === 'string' ? value.key.trim() : '';
            if (!key || EXCLUDED_SETTING_KEYS.has(key)) return;
            if (key === 'routing_fallback_unit_cost') {
              const numeric = Number(value.value);
              if (Number.isFinite(numeric) && numeric > 0) legacyRoutingFallbackUnitCost = numeric;
              return;
            }
            const settingValue = key === 'metapi_config_version' ? CURRENT_CONFIG_VERSION : value.value;
            if (key === 'pricing_reference_config_v1') sawPricingReferenceConfig = true;
            if (key === 'platform_pricing_config_v1') sawPlatformPricingConfig = true;
            if (key === 'metapi_config_version') sawConfigVersion = true;
            await upsertSetting(key, settingValue, tx);
            appliedSettings.push({ key, value: settingValue });
            return;
          }
          await clearAccounts();
          if (path === 'accounts.routeGraph.versions' && isRecord(value)) {
            routeGraphSources.set(value.id, migrateImportedRouteGraphSourceJson(String(value.sourceGraphJson || '')));
          }
          const arrayPath = path as NativeBackupArrayPath;
          const batch = rows.get(arrayPath) || [];
          batch.push(value);
          rows.set(arrayPath, batch);
          const table = tables.get(arrayPath);
          const columnCount = isRecord(value) ? Math.max(1, Object.keys(value).length) : 1;
          const maxRows = Math.max(1, Math.min(
            BACKUP_IMPORT_MAX_ROWS,
            Math.floor(BACKUP_IMPORT_MAX_PARAMETERS / columnCount),
          ));
          if (
            table
            && !NATIVE_BACKUP_DEFERRED_ARRAY_PATHS.has(arrayPath)
            && batch.length >= maxRows
          ) await flush(arrayPath, table[0], table[1]);
        },
      });

      ensureNativeHeader();
      const type = typeof values.get('type') === 'string' ? values.get('type') : '';
      const accountsRequested = type === 'accounts' || seenArrays.has('accounts.sites');
      const preferencesRequested = type === 'preferences' || seenArrays.has('preferences.settings');
      if (!accountsRequested && !preferencesRequested) throw new Error('导入数据中没有可识别的账号或设置数据');
      if (accountsRequested && !['accounts.sites', 'accounts.accounts', 'accounts.accountTokens']
        .every((path) => seenArrays.has(path as NativeBackupArrayPath))) {
        throw new Error('导入数据格式错误：账号数据结构不正确');
      }
      if (preferencesRequested && !seenArrays.has('preferences.settings')) {
        throw new Error('导入数据格式错误：设置数据结构不正确');
      }
      for (const [path, [table, mapRow]] of tables) await flush(path, table, mapRow);
      if (accountsRequested) {
        await reconcileImportedAccountCredentialTokens(tx, importedAccountCredentials.values());
      }
      if (preferencesRequested) {
        const migrated = migratePublishedMainPreferenceSettings([]).settings.filter((row) => (
      (row.key === 'pricing_reference_config_v1' && !sawPricingReferenceConfig)
      || (row.key === 'platform_pricing_config_v1' && !sawPlatformPricingConfig)
      || (row.key === 'metapi_config_version' && !sawConfigVersion)
        ));
        for (const row of migrated) {
          const value = row.key === 'platform_pricing_config_v1' && legacyRoutingFallbackUnitCost !== null
            ? { ...(row.value as Record<string, unknown>), upstreamDefaultPricing: { inputPerMillion: legacyRoutingFallbackUnitCost, outputPerMillion: legacyRoutingFallbackUnitCost } }
            : row.value;
          await upsertSetting(row.key, value, tx);
          appliedSettings.push({ key: row.key, value });
        }
      }
    });
  } catch (error) {
    if (error === NOT_NATIVE_BACKUP) return null;
    throw error;
  }

  const accountsRequested = seenArrays.has('accounts.sites') || values.get('type') === 'accounts';
  const preferencesRequested = seenArrays.has('preferences.settings') || values.get('type') === 'preferences';
  if (accountsRequested) {
    invalidateRouteGraphReadCaches('route-source-mutated');
    if (graphSource) {
      const published = await publishRouteGraphSource({ sourceGraph: graphSource, createdBy: 'backup-import' });
      if (!published.ok) throw new Error(`导入的历史路由无法编译：${published.diagnostics.map((item) => item.message).join('；')}`);
    }
  }
  return {
    allImported: true,
    sections: { accounts: accountsRequested, preferences: preferencesRequested },
    appliedSettings,
  };
}

export async function importBackupFromGzipStream(
  input: Readable,
  maxUncompressedBytes: number,
): Promise<BackupImportResult> {
  const directory = await mkdtemp(join(tmpdir(), 'metapi-backup-import-'));
  const filePath = join(directory, 'backup.json');
  try {
    await pipeline(input, createGunzip(), new ByteLimitTransform(maxUncompressedBytes), createWriteStream(filePath));
    return await importBackupFromJsonFilePath(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function importBackupFromJsonFilePath(filePath: string): Promise<BackupImportResult> {
  const nativeResult = await importNativeBackupFromJsonFile(filePath);
  if (nativeResult) return nativeResult;
  return importBackup(JSON.parse(await readFile(filePath, 'utf8')) as RawBackupData);
}

export async function importBackupFromJsonStream(
  input: Readable,
  maxUncompressedBytes: number,
): Promise<BackupImportResult> {
  const directory = await mkdtemp(join(tmpdir(), 'metapi-backup-import-'));
  const filePath = join(directory, 'backup.json');
  try {
    await pipeline(input, new ByteLimitTransform(maxUncompressedBytes), createWriteStream(filePath));
    return await importBackupFromJsonFilePath(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function exportBackup(type: BackupExportType): Promise<BackupV2> {
  const timestamp = Date.now();
  if (type === 'accounts') {
    return {
      version: BACKUP_VERSION,
      timestamp,
      type: 'accounts',
      accounts: await exportAccountsSection(),
    };
  }
  if (type === 'preferences') {
    return {
      version: BACKUP_VERSION,
      timestamp,
      type: 'preferences',
      preferences: await exportPreferencesSection(),
    };
  }
  return {
    version: BACKUP_VERSION,
    timestamp,
    accounts: await exportAccountsSection(),
    preferences: await exportPreferencesSection(),
  };
}

function coerceAccountsSection(input: unknown): CoercedAccountsSection | null {
  if (!isRecord(input)) return null;
  const sites = Array.isArray(input.sites) ? input.sites as AccountsBackupSection['sites'] : null;
  const rawAccounts = Array.isArray(input.accounts) ? input.accounts : null;
  const accountTokens = Array.isArray(input.accountTokens) ? input.accountTokens as AccountsBackupSection['accountTokens'] : null;
  if (!sites || !rawAccounts || !accountTokens) return null;
  const normalizedAccounts = rawAccounts.map(migrateImportedAccountCredential);
  const accounts = normalizedAccounts.map((item) => item.account);
  const section: AccountsBackupSection = {
    sites,
    siteApiEndpoints: Array.isArray(input.siteApiEndpoints) ? input.siteApiEndpoints as AccountsBackupSection['siteApiEndpoints'] : undefined,
    modelCatalogSources: Array.isArray(input.modelCatalogSources) ? input.modelCatalogSources as AccountsBackupSection['modelCatalogSources'] : undefined,
    apiEndpointProfiles: Array.isArray(input.apiEndpointProfiles) ? input.apiEndpointProfiles as AccountsBackupSection['apiEndpointProfiles'] : undefined,
    endpointModelObservations: Array.isArray(input.endpointModelObservations) ? input.endpointModelObservations as AccountsBackupSection['endpointModelObservations'] : undefined,
    credentialEndpointBindings: Array.isArray(input.credentialEndpointBindings) ? input.credentialEndpointBindings as AccountsBackupSection['credentialEndpointBindings'] : undefined,
    accounts,
    accountTokens,
    modelAvailability: Array.isArray(input.modelAvailability) ? input.modelAvailability as AccountsBackupSection['modelAvailability'] : undefined,
    tokenModelAvailability: Array.isArray(input.tokenModelAvailability) ? input.tokenModelAvailability as AccountsBackupSection['tokenModelAvailability'] : undefined,
    tokenDisabledModels: Array.isArray(input.tokenDisabledModels) ? input.tokenDisabledModels as AccountsBackupSection['tokenDisabledModels'] : undefined,
    upstreamModelCostPricings: Array.isArray(input.upstreamModelCostPricings) ? input.upstreamModelCostPricings as AccountsBackupSection['upstreamModelCostPricings'] : undefined,
    providerPricingCatalogCaches: Array.isArray(input.providerPricingCatalogCaches) ? input.providerPricingCatalogCaches as AccountsBackupSection['providerPricingCatalogCaches'] : undefined,
    walletAcquisitionProfiles: Array.isArray(input.walletAcquisitionProfiles) ? input.walletAcquisitionProfiles as AccountsBackupSection['walletAcquisitionProfiles'] : undefined,
    fxRateSnapshots: Array.isArray(input.fxRateSnapshots) ? input.fxRateSnapshots as AccountsBackupSection['fxRateSnapshots'] : undefined,
    runtimeExecutionTargets: Array.isArray(input.runtimeExecutionTargets) ? input.runtimeExecutionTargets as AccountsBackupSection['runtimeExecutionTargets'] : undefined,
    runtimeExecutionTargetState: Array.isArray(input.runtimeExecutionTargetState) ? input.runtimeExecutionTargetState as AccountsBackupSection['runtimeExecutionTargetState'] : undefined,
    routeGraph: isRecord(input.routeGraph)
      ? {
        versions: Array.isArray(input.routeGraph.versions) ? input.routeGraph.versions as BackupRouteGraphSection['versions'] : [],
        activeVersion: isRecord(input.routeGraph.activeVersion) ? input.routeGraph.activeVersion as BackupRouteGraphSection['activeVersion'] : null,
        drafts: Array.isArray(input.routeGraph.drafts) ? input.routeGraph.drafts as BackupRouteGraphSection['drafts'] : [],
        operationBatches: Array.isArray(input.routeGraph.operationBatches) ? input.routeGraph.operationBatches as BackupRouteGraphSection['operationBatches'] : [],
      }
      : undefined,
    oauthRouteUnits: Array.isArray(input.oauthRouteUnits) ? input.oauthRouteUnits as AccountsBackupSection['oauthRouteUnits'] : undefined,
    oauthRouteUnitMembers: Array.isArray(input.oauthRouteUnitMembers) ? input.oauthRouteUnitMembers as AccountsBackupSection['oauthRouteUnitMembers'] : undefined,
    siteDisabledModels: Array.isArray(input.siteDisabledModels) ? input.siteDisabledModels as AccountsBackupSection['siteDisabledModels'] : undefined,
    downstreamApiKeys: Array.isArray(input.downstreamApiKeys) ? input.downstreamApiKeys as AccountsBackupSection['downstreamApiKeys'] : undefined,
    siteAnnouncements: Array.isArray(input.siteAnnouncements) ? input.siteAnnouncements as AccountsBackupSection['siteAnnouncements'] : undefined,
  };
  const migrated: BackupImportRouteRuntimeMigrationResult = migratePreviousRouteBackupToCurrentRuntime(section, input);
  return {
    section: migrated.section as AccountsBackupSection,
    importedAccountCredentials: normalizedAccounts.map((item) => item.importedCredential),
    warnings: migrated.warnings,
    notices: migrated.notices,
    graphSource: migrated.graphSource,
  };
}

function coercePreferencesSection(input: unknown): PreferencesBackupSection | null {
  if (!isRecord(input)) return null;
  if (!Array.isArray(input.settings)) return null;
  const settings = input.settings
    .map((row) => {
      if (!isRecord(row)) return null;
      const key = typeof row.key === 'string' ? row.key.trim() : '';
      if (!key || EXCLUDED_SETTING_KEYS.has(key)) return null;
      return { key, value: row.value };
    })
    .filter((row): row is { key: string; value: unknown } => !!row);
  return {
    settings: migratePublishedMainPreferenceSettings(settings).settings,
  };
}

function detectAccountsSection(data: RawBackupData): CoercedAccountsSection | null {
  return coerceAccountsSection(data)
    ?? (isRecord(data.accounts) ? coerceAccountsSection(data.accounts) : null)
    ?? (isRecord(data.data) && isRecord(data.data.accounts) ? coerceAccountsSection(data.data.accounts) : null);
}

function detectPreferencesSection(data: RawBackupData): PreferencesBackupSection | null {
  return coercePreferencesSection(data)
    ?? (isRecord(data.preferences) ? coercePreferencesSection(data.preferences) : null)
    ?? (isRecord(data.data) && isRecord(data.data.preferences) ? coercePreferencesSection(data.data.preferences) : null);
}

async function deleteAll(tx: any, table: any): Promise<void> {
  await tx.delete(table).run();
}

async function insertRows(tx: any, table: any, rows: unknown[] | undefined): Promise<void> {
  for (const row of rows || []) {
    await tx.insert(table).values(row as any).run();
  }
}

async function restoreRouteGraph(tx: any, routeGraph: BackupRouteGraphSection | undefined): Promise<void> {
  await deleteAll(tx, schema.compiledRuntimeActiveArtifact);
  await deleteAll(tx, schema.compiledRuntimeArtifacts);
  await deleteAll(tx, schema.routeGraphActiveVersion);
  await deleteAll(tx, schema.routeGraphWorkspaceOperationBatches);
  await deleteAll(tx, schema.routeGraphDrafts);
  await deleteAll(tx, schema.routeGraphVersions);
  if (!routeGraph) return;
  await insertRows(tx, schema.routeGraphVersions, (routeGraph.versions || []).map((row: any) => ({
    ...row,
    sourceGraphJson: migrateImportedRouteGraphSourceJson(row.sourceGraphJson),
  })));
  await insertRows(tx, schema.routeGraphDrafts, (routeGraph.drafts || []).map((row: any) => ({
    ...row,
    workingGraphJson: migrateImportedRouteGraphSourceJson(row.workingGraphJson),
  })));
  await insertRows(tx, schema.routeGraphWorkspaceOperationBatches, routeGraph.operationBatches || []);
  if (routeGraph.activeVersion) {
    await tx.insert(schema.routeGraphActiveVersion).values(routeGraph.activeVersion as any).run();
  }
}

function activeSourceFromBackupRouteGraph(
  routeGraph: BackupRouteGraphSection | undefined,
): RouteGraphSource | null {
  const activeVersionId = routeGraph?.activeVersion?.versionId;
  if (!activeVersionId) return null;
  const activeVersion = (routeGraph?.versions || []).find((row) => row.id === activeVersionId);
  if (!activeVersion) return null;
  return parseRouteGraphSource(migrateImportedRouteGraphSourceJson(activeVersion.sourceGraphJson));
}

async function importAccountsSection(
  section: AccountsBackupSection,
  options: {
    graphSource?: RouteGraphSource;
    importedAccountCredentials?: ImportedAccountCredential[];
  } = {},
): Promise<void> {
  const graphSource = options.graphSource ?? activeSourceFromBackupRouteGraph(section.routeGraph);
  await db.transaction(async (tx) => {
    // Proxy request and debug history are local operational data, never configuration.
    // Older backups may contain proxyLogs; coercion intentionally ignores them.
    await deleteAll(tx, schema.siteAnnouncements);
    await deleteAll(tx, schema.downstreamApiKeys);
    await restoreRouteGraph(tx, options.graphSource ? undefined : section.routeGraph);
    await deleteAll(tx, schema.runtimeExecutionTargetState);
    await deleteAll(tx, schema.runtimeExecutionTargets);
    await deleteAll(tx, schema.oauthRouteUnitMembers);
    await deleteAll(tx, schema.oauthRouteUnits);
    await deleteAll(tx, schema.tokenModelAvailability);
    await deleteAll(tx, schema.tokenDisabledModels);
    await deleteAll(tx, schema.modelAvailability);
    await deleteAll(tx, schema.endpointModelObservations);
    await deleteAll(tx, schema.credentialEndpointBindings);
    await deleteAll(tx, schema.accountTokens);
    await deleteAll(tx, schema.accounts);
    await deleteAll(tx, schema.apiEndpointProfiles);
    await deleteAll(tx, schema.modelCatalogSources);
    await deleteAll(tx, schema.siteApiEndpoints);
    await deleteAll(tx, schema.siteDisabledModels);
    await deleteAll(tx, schema.upstreamModelCostPricings);
    await deleteAll(tx, schema.providerPricingCatalogCaches);
    await deleteAll(tx, schema.walletAcquisitionProfiles);
    await deleteAll(tx, schema.fxRateSnapshots);
    await deleteAll(tx, schema.sites);

    await insertRows(tx, schema.sites, section.sites);
    await insertRows(tx, schema.siteApiEndpoints, section.siteApiEndpoints?.map(resetImportedSiteApiEndpointHealth));
    await insertRows(tx, schema.modelCatalogSources, section.modelCatalogSources);
    await insertRows(tx, schema.apiEndpointProfiles, section.apiEndpointProfiles);
    await insertRows(tx, schema.accounts, section.accounts);
    await insertRows(tx, schema.accountTokens, section.accountTokens);
    await reconcileImportedAccountCredentialTokens(tx, options.importedAccountCredentials || []);
    await insertRows(tx, schema.credentialEndpointBindings, section.credentialEndpointBindings);
    await insertRows(tx, schema.endpointModelObservations, section.endpointModelObservations);
    await insertRows(tx, schema.modelAvailability, section.modelAvailability);
    await insertRows(tx, schema.tokenModelAvailability, section.tokenModelAvailability);
    await insertRows(tx, schema.tokenDisabledModels, section.tokenDisabledModels);
    await insertRows(tx, schema.upstreamModelCostPricings, section.upstreamModelCostPricings);
    await insertRows(tx, schema.providerPricingCatalogCaches, section.providerPricingCatalogCaches);
    await insertRows(tx, schema.walletAcquisitionProfiles, section.walletAcquisitionProfiles);
    await insertRows(tx, schema.fxRateSnapshots, section.fxRateSnapshots);
    await insertRows(tx, schema.siteDisabledModels, section.siteDisabledModels);
    await insertRows(tx, schema.oauthRouteUnits, section.oauthRouteUnits);
    await insertRows(tx, schema.oauthRouteUnitMembers, section.oauthRouteUnitMembers);
    await insertRows(tx, schema.runtimeExecutionTargets, section.runtimeExecutionTargets);
    await insertRows(tx, schema.runtimeExecutionTargetState, section.runtimeExecutionTargetState);
    await insertRows(tx, schema.downstreamApiKeys, section.downstreamApiKeys);
    await insertRows(tx, schema.siteAnnouncements, section.siteAnnouncements);
  });

  invalidateRouteGraphReadCaches('route-source-mutated');
  if (graphSource) {
    const published = await publishRouteGraphSource({
      sourceGraph: graphSource,
      createdBy: 'backup-import',
    });
    if (!published.ok) {
      throw new Error(`导入的历史路由无法编译：${published.diagnostics.map((item) => item.message).join('；')}`);
    }
  }
}

async function importPreferencesSection(section: PreferencesBackupSection): Promise<Array<{ key: string; value: unknown }>> {
  const applied: Array<{ key: string; value: unknown }> = [];
  for (const row of section.settings) {
    if (!row.key || EXCLUDED_SETTING_KEYS.has(row.key)) continue;
    await upsertSetting(row.key, row.value);
    applied.push({ key: row.key, value: row.value });
  }
  return applied;
}

export async function importBackup(data: RawBackupData): Promise<BackupImportResult> {
  if (!isRecord(data)) {
    throw new Error('导入数据格式错误：必须为 JSON 对象');
  }
  if (!('timestamp' in data) || data.timestamp === null || data.timestamp === undefined) {
    throw new Error('导入数据格式错误：缺少 timestamp');
  }

  const accountsDetection = detectAccountsSection(data);
  const accountsSection = accountsDetection?.section ?? null;
  const warnings = [...(accountsDetection?.warnings || [])];
  const notices = [...(accountsDetection?.notices || [])];
  const preferencesSection = detectPreferencesSection(data);
  const type = typeof data.type === 'string' ? data.type : '';
  const accountsRequested = type === 'accounts' || !!accountsSection;
  const preferencesRequested = type === 'preferences' || !!preferencesSection;

  if (!accountsRequested && !preferencesRequested) {
    throw new Error('导入数据中没有可识别的账号或设置数据');
  }

  let accountsImported = false;
  let preferencesImported = false;
  let appliedSettings: Array<{ key: string; value: unknown }> = [];

  if (accountsRequested) {
    if (!accountsSection) throw new Error('导入数据格式错误：账号数据结构不正确');
    await importAccountsSection(accountsSection, {
      graphSource: accountsDetection?.graphSource,
      importedAccountCredentials: accountsDetection?.importedAccountCredentials,
    });
    accountsImported = true;
  }

  if (preferencesRequested) {
    if (!preferencesSection) throw new Error('导入数据格式错误：设置数据结构不正确');
    appliedSettings = await importPreferencesSection(preferencesSection);
    preferencesImported = true;
  }

  return {
    allImported: (!accountsRequested || accountsImported) && (!preferencesRequested || preferencesImported),
    sections: {
      accounts: accountsImported,
      preferences: preferencesImported,
    },
    appliedSettings,
    summary: accountsImported && accountsSection
      ? {
        importedSites: accountsSection.sites.length,
        importedAccounts: accountsSection.accounts.length,
        importedProfiles: accountsSection.apiEndpointProfiles?.length || 0,
        importedApiKeyConnections: accountsSection.accountTokens.length,
        skippedAccounts: 0,
        ignoredSections: [],
      }
      : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    notices: notices.length > 0 ? notices : undefined,
  };
}

export async function getBackupWebdavConfig() {
  const [config, state] = await Promise.all([
    loadBackupWebdavConfig(),
    loadBackupWebdavState(),
  ]);
  return {
    success: true,
    config: toBackupWebdavConfigView(config),
    state,
  };
}

export async function saveBackupWebdavConfig(input: Partial<BackupWebdavConfig> & { password?: string; clearPassword?: boolean }) {
  const existing = await loadBackupWebdavConfig();
  const next: BackupWebdavConfig = {
    enabled: input.enabled !== undefined ? input.enabled === true : existing.enabled,
    fileUrl: input.fileUrl !== undefined ? normalizeBackupWebdavExportFileUrl(asString(input.fileUrl)) : existing.fileUrl,
    username: input.username !== undefined ? asString(input.username) : existing.username,
    password: input.clearPassword
      ? ''
      : (input.password !== undefined ? String(input.password) : existing.password),
    exportType: isValidBackupExportType(input.exportType) ? input.exportType : existing.exportType,
    autoSyncEnabled: input.autoSyncEnabled !== undefined ? input.autoSyncEnabled === true : existing.autoSyncEnabled,
    autoSyncCron: typeof input.autoSyncCron === 'string' && input.autoSyncCron.trim()
      ? input.autoSyncCron.trim()
      : existing.autoSyncCron,
  };
  if (!next.enabled) next.autoSyncEnabled = false;
  validateBackupWebdavConfig(next);
  await upsertSetting(BACKUP_WEBDAV_CONFIG_SETTING_KEY, next);
  await reloadBackupWebdavScheduler();
  return getBackupWebdavConfig();
}

export async function exportBackupToWebdav(type?: BackupExportType) {
  const config = await loadBackupWebdavConfig();
  validateBackupWebdavConfig(config);
  if (!config.enabled) throw new Error('WebDAV 备份未启用');
  if (!config.fileUrl) throw new Error('WebDAV 文件地址不能为空');

  const exportType = type && isValidBackupExportType(type) ? type : config.exportType;
  const headers: Record<string, string> = {
    'Content-Type': 'application/gzip',
  };
  const authHeader = resolveBackupWebdavAuthHeader(config);
  if (authHeader) headers.Authorization = authHeader;

  try {
    const response = await fetchBackupWebdav(config.fileUrl, {
      method: 'PUT',
      headers,
      body: createBackupExportStream(exportType) as any,
      duplex: 'half' as any,
    } as any);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`WebDAV 导出失败：HTTP ${response.status}${text ? ` ${text.slice(0, 120)}` : ''}`);
    }
    const syncedAt = new Date().toISOString();
    await writeBackupWebdavState({ lastSyncAt: syncedAt, lastError: null });
    return {
      success: true,
      fileUrl: config.fileUrl,
      exportType,
      syncedAt,
      lastSyncAt: syncedAt,
      lastError: null,
    };
  } catch (error: any) {
    const previousState = await loadBackupWebdavState();
    await writeBackupWebdavState({
      lastSyncAt: previousState.lastSyncAt,
      lastError: error?.message || 'WebDAV 导出失败',
    });
    throw error;
  }
}

export async function importBackupFromWebdav() {
  const config = await loadBackupWebdavConfig();
  validateBackupWebdavConfig(config);
  if (!config.enabled) throw new Error('WebDAV 备份未启用');
  if (!config.fileUrl) throw new Error('WebDAV 文件地址不能为空');

  const headers: Record<string, string> = {};
  const authHeader = resolveBackupWebdavAuthHeader(config);
  if (authHeader) headers.Authorization = authHeader;

  try {
    const response = await fetchBackupWebdav(config.fileUrl, {
      method: 'GET',
      headers,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`WebDAV 导入失败：HTTP ${response.status}${text ? ` ${text.slice(0, 120)}` : ''}`);
    }
    const input = Readable.fromWeb(response.body as any);
    const compressed = response.headers.get('content-encoding') === 'gzip' || config.fileUrl.toLowerCase().endsWith('.gz');
    const result = compressed
      ? await importBackupFromGzipStream(input, runtimeConfig.backupImportMaxUncompressedBytes)
      : await importBackupFromJsonStream(input, runtimeConfig.backupImportMaxUncompressedBytes);
    const syncedAt = new Date().toISOString();
    await writeBackupWebdavState({ lastSyncAt: syncedAt, lastError: null });
    return {
      success: true,
      fileUrl: config.fileUrl,
      syncedAt,
      lastSyncAt: syncedAt,
      lastError: null,
      ...result,
    };
  } catch (error: any) {
    const previousState = await loadBackupWebdavState();
    await writeBackupWebdavState({
      lastSyncAt: previousState.lastSyncAt,
      lastError: error?.message || 'WebDAV 导入失败',
    });
    throw error;
  }
}

export async function reloadBackupWebdavScheduler() {
  stopBackupWebdavScheduler();
  const config = await loadBackupWebdavConfig();
  if (!config.enabled || !config.autoSyncEnabled) return;
  try {
    validateBackupWebdavConfig(config);
  } catch (error: any) {
    console.warn(`[backup/webdav] invalid config: ${error?.message || 'unknown error'}`);
    return;
  }
  backupWebdavTask = cron.schedule(config.autoSyncCron, () => {
    void exportBackupToWebdav(config.exportType).catch((error) => {
      console.warn(`[backup/webdav] auto sync failed: ${(error as Error)?.message || 'unknown error'}`);
    });
  });
}

export function __resetBackupWebdavSchedulerForTests() {
  stopBackupWebdavScheduler();
}
