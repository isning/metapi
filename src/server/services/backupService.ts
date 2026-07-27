import { eq } from 'drizzle-orm';
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
import { parseRouteGraphSource, type RouteGraphSource } from '../../shared/routeGraph.js';

const BACKUP_VERSION = CURRENT_CONFIG_VERSION;
const BACKUP_WEBDAV_CONFIG_SETTING_KEY = 'backup_webdav_config_v1';
const BACKUP_WEBDAV_STATE_SETTING_KEY = 'backup_webdav_state_v1';
const BACKUP_WEBDAV_DEFAULT_AUTO_SYNC_CRON = '0 */6 * * *';
const BACKUP_WEBDAV_FETCH_TIMEOUT_MS = 15_000;

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
  proxyLogs?: Array<typeof schema.proxyLogs.$inferSelect>;
}

interface PreferencesBackupSection {
  settings: Array<{ key: string; value: unknown }>;
}

type CoercedAccountsSection = {
  section: AccountsBackupSection;
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
    fileUrl: asString(source.fileUrl),
    username: asString(source.username),
    password: typeof source.password === 'string' ? source.password : '',
    exportType,
    autoSyncEnabled: source.autoSyncEnabled === true,
    autoSyncCron,
  };
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
    proxyLogs,
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
    db.select().from(schema.proxyLogs).all(),
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
    proxyLogs,
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
  const accounts = Array.isArray(input.accounts) ? input.accounts as AccountsBackupSection['accounts'] : null;
  const accountTokens = Array.isArray(input.accountTokens) ? input.accountTokens as AccountsBackupSection['accountTokens'] : null;
  if (!sites || !accounts || !accountTokens) return null;
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
    proxyLogs: Array.isArray(input.proxyLogs) ? input.proxyLogs as AccountsBackupSection['proxyLogs'] : undefined,
  };
  const migrated: BackupImportRouteRuntimeMigrationResult = migratePreviousRouteBackupToCurrentRuntime(section, input);
  return {
    section: migrated.section as AccountsBackupSection,
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
  options: { graphSource?: RouteGraphSource } = {},
): Promise<void> {
  const graphSource = options.graphSource ?? activeSourceFromBackupRouteGraph(section.routeGraph);
  await db.transaction(async (tx) => {
    await deleteAll(tx, schema.proxyLogs);
    await deleteAll(tx, schema.proxyDebugAttempts);
    await deleteAll(tx, schema.proxyDebugTraces);
    await deleteAll(tx, schema.siteAnnouncements);
    await deleteAll(tx, schema.downstreamApiKeys);
    await restoreRouteGraph(tx, options.graphSource ? undefined : section.routeGraph);
    await deleteAll(tx, schema.runtimeExecutionTargetState);
    await deleteAll(tx, schema.runtimeExecutionTargets);
    await deleteAll(tx, schema.oauthRouteUnitMembers);
    await deleteAll(tx, schema.oauthRouteUnits);
    await deleteAll(tx, schema.tokenModelAvailability);
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
    await insertRows(tx, schema.siteApiEndpoints, section.siteApiEndpoints);
    await insertRows(tx, schema.modelCatalogSources, section.modelCatalogSources);
    await insertRows(tx, schema.apiEndpointProfiles, section.apiEndpointProfiles);
    await insertRows(tx, schema.accounts, section.accounts);
    await insertRows(tx, schema.accountTokens, section.accountTokens);
    await insertRows(tx, schema.credentialEndpointBindings, section.credentialEndpointBindings);
    await insertRows(tx, schema.endpointModelObservations, section.endpointModelObservations);
    await insertRows(tx, schema.modelAvailability, section.modelAvailability);
    await insertRows(tx, schema.tokenModelAvailability, section.tokenModelAvailability);
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
    await insertRows(tx, schema.proxyLogs, section.proxyLogs);
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
    fileUrl: input.fileUrl !== undefined ? asString(input.fileUrl) : existing.fileUrl,
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
  const payload = await exportBackup(exportType);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const authHeader = resolveBackupWebdavAuthHeader(config);
  if (authHeader) headers.Authorization = authHeader;

  try {
    const response = await fetchBackupWebdav(config.fileUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload, null, 2),
    });
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
    const raw = await response.text();
    const result = await importBackup(JSON.parse(raw) as RawBackupData);
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
