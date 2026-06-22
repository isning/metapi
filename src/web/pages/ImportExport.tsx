import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import ModernSelect from '../components/ModernSelect.js';
import { useToast } from '../components/Toast.js';
import { tr } from '../i18n.js';
import { Button } from '../components/ui/button/index.js';
import { LoaderCircle } from 'lucide-react';
import ToneBadge from '../components/ToneBadge.js';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert/index.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card/index.js';
import { Input } from '../components/ui/input/index.js';
import { Label } from '../components/ui/label/index.js';
import { Switch } from '../components/ui/switch/index.js';
import JsonCodeEditor from '../components/JsonCodeEditor.js';

type BackupType = 'all' | 'accounts' | 'preferences';

type ParsedSummary = {
  valid: boolean;
  version: string;
  timestampLabel: string;
  hasAccounts: boolean;
  hasPreferences: boolean;
  hasLegacyData: boolean;
  isAllApiHubV2: boolean;
  sitesCount: number;
  accountsCount: number;
  bookmarksCount: number;
  profilesCount: number;
  tokensCount: number;
  routesCount: number;
  channelsCount: number;
  siteDisabledModelsCount: number;
  manualModelsCount: number;
  downstreamApiKeysCount: number;
  settingsCount: number;
  ignoredSections: string[];
};

type WebdavConfigForm = {
  enabled: boolean;
  fileUrl: string;
  username: string;
  password: string;
  exportType: BackupType;
  autoSyncEnabled: boolean;
  autoSyncCron: string;
  hasPassword: boolean;
  passwordMasked: string;
};

type WebdavSyncState = {
  lastSyncAt: string | null;
  lastError: string | null;
};

type WebdavConfigSnapshot = {
  enabled: boolean;
  fileUrl: string;
  username: string;
  exportType: BackupType;
  autoSyncEnabled: boolean;
  autoSyncCron: string;
  hasPassword: boolean;
};

const DEFAULT_WEBDAV_CONFIG: WebdavConfigForm = {
  enabled: false,
  fileUrl: '',
  username: '',
  password: '',
  exportType: 'all',
  autoSyncEnabled: false,
  autoSyncCron: '0 */6 * * *',
  hasPassword: false,
  passwordMasked: '',
};

const DEFAULT_WEBDAV_SNAPSHOT: WebdavConfigSnapshot = {
  enabled: false,
  fileUrl: '',
  username: '',
  exportType: 'all',
  autoSyncEnabled: false,
  autoSyncCron: '0 */6 * * *',
  hasPassword: false,
};

const WEBDAV_EXPORT_TYPE_OPTIONS = [
  { value: 'all', label: tr('components.notificationPanel.all') },
  { value: 'accounts', label: tr('pages.importExport.routesstrategy') },
  { value: 'preferences', label: tr('pages.importExport.systemSettings') },
] as const;

function downloadJsonFile(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function parseImportSummary(raw: string): ParsedSummary | null {
  if (!raw.trim()) return null;

  const invalidSummary = (): ParsedSummary => ({
    valid: false,
    version: '-',
    timestampLabel: tr('pages.accounts.unknown2'),
    hasAccounts: false,
    hasPreferences: false,
    hasLegacyData: false,
    isAllApiHubV2: false,
    sitesCount: 0,
    accountsCount: 0,
    bookmarksCount: 0,
    profilesCount: 0,
    tokensCount: 0,
    routesCount: 0,
    channelsCount: 0,
    siteDisabledModelsCount: 0,
    manualModelsCount: 0,
    downstreamApiKeysCount: 0,
    settingsCount: 0,
    ignoredSections: [],
  });

  try {
    const data = JSON.parse(raw) as any;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return invalidSummary();
    }

    const accountsSection = (data.accounts && typeof data.accounts === 'object' && !Array.isArray(data.accounts))
      ? data.accounts
      : null;
    const preferencesSection = (data.preferences && typeof data.preferences === 'object' && !Array.isArray(data.preferences))
      ? data.preferences
      : null;

    const legacyAccounts = Boolean(data.data?.accounts || Array.isArray(data.accounts));
    const legacyPrefs = Boolean(data.data?.preferences);
    const profilesCount = Array.isArray(data.apiCredentialProfiles?.profiles) ? data.apiCredentialProfiles.profiles.length : 0;
    const bookmarksCount = Array.isArray(accountsSection?.bookmarks) ? accountsSection.bookmarks.length : 0;
    const isNativeMetapiBackup = Boolean(
      accountsSection
      && Array.isArray(accountsSection.sites)
      && Array.isArray(accountsSection.accountTokens)
      && Array.isArray(accountsSection.tokenRoutes)
      && Array.isArray(accountsSection.routeChannels)
    );
    const hasLegacyAccountRows = Array.isArray(accountsSection?.accounts)
      && accountsSection.accounts.some((row: any) => row && typeof row === 'object' && !Array.isArray(row) && (
        'site_url' in row
        || 'site_type' in row
        || 'account_info' in row
        || 'cookieAuth' in row
        || 'authType' in row
        || 'sub2apiAuth' in row
      ));
    const isAllApiHubV2 = Boolean(
      accountsSection
      && !isNativeMetapiBackup
      && hasLegacyAccountRows
      && Array.isArray(accountsSection.accounts)
      && (
        (typeof data.version === 'string' && data.version.startsWith('2'))
        || 'last_updated' in accountsSection
        || Array.isArray(accountsSection.bookmarks)
        || Array.isArray(accountsSection.pinnedAccountIds)
        || Array.isArray(accountsSection.orderedAccountIds)
        || profilesCount > 0
      )
    );

    const hasAccounts = Boolean(
      data.type === 'accounts'
      || accountsSection
      || legacyAccounts,
    );
    const hasPreferences = Boolean(
      data.type === 'preferences'
      || preferencesSection
      || legacyPrefs,
    );
    const ignoredSections: string[] = [];
    if (bookmarksCount > 0) ignoredSections.push('accounts.bookmarks');
    if (data.channelConfigs && typeof data.channelConfigs === 'object' && !Array.isArray(data.channelConfigs)) ignoredSections.push('channelConfigs');
    if (data.tagStore && typeof data.tagStore === 'object' && !Array.isArray(data.tagStore)) ignoredSections.push('tagStore');

    const toCount = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

    const ts = data.timestamp !== undefined && data.timestamp !== null
      ? new Date(data.timestamp)
      : null;
    const timestampLabel = ts && !Number.isNaN(ts.getTime()) ? ts.toLocaleString() : tr('pages.accounts.unknown2');

    return {
      valid: hasAccounts || hasPreferences,
      version: typeof data.version === 'string' ? data.version : '1.0',
      timestampLabel,
      hasAccounts,
      hasPreferences,
      hasLegacyData: legacyAccounts || legacyPrefs,
      isAllApiHubV2,
      sitesCount: toCount(accountsSection?.sites),
      accountsCount: toCount(accountsSection?.accounts),
      bookmarksCount,
      profilesCount,
      tokensCount: toCount(accountsSection?.accountTokens),
      routesCount: toCount(accountsSection?.tokenRoutes),
      channelsCount: toCount(accountsSection?.routeChannels),
      siteDisabledModelsCount: toCount(accountsSection?.siteDisabledModels),
      manualModelsCount: toCount(accountsSection?.manualModels),
      downstreamApiKeysCount: toCount(accountsSection?.downstreamApiKeys),
      settingsCount: toCount(preferencesSection?.settings),
      ignoredSections,
    };
  } catch {
    return invalidSummary();
  }
}

function buildImportSuccessMessage(result: any): string {
  const sections: string[] = [];
  if (result?.sections?.accounts) sections.push(tr('pages.importExport.routesstrategy'));
  if (result?.sections?.preferences) sections.push(tr('pages.importExport.systemSettings'));

  const parts = [`导入完成：${sections.length ? sections.join('、') : tr('pages.importExport.noValidData')}`];
  if (result?.summary) {
    const summary = result.summary;
    parts.push(
      [
        `站点 ${summary.importedSites ?? 0}`,
        `账号 ${summary.importedAccounts ?? 0}`,
        `API Key 连接 ${summary.importedApiKeyConnections ?? summary.importedProfiles ?? 0}`,
        `跳过 ${summary.skippedAccounts ?? 0}`,
      ].join(' / '),
    );

    if (Array.isArray(summary.ignoredSections) && summary.ignoredSections.length > 0) {
      parts.push(`未原生导入 ${summary.ignoredSections.join('、')}`);
    }
  }

  if (Array.isArray(result?.warnings) && result.warnings.length > 0) {
    const preview = result.warnings.slice(0, 2).join('；');
    parts.push(`提示：${preview}${result.warnings.length > 2 ? ` 等 ${result.warnings.length} 项` : ''}`);
  }

  return parts.join('；');
}

export default function ImportExport() {
  const toast = useToast();
  const [exportingType, setExportingType] = useState<BackupType | ''>('');
  const [importing, setImporting] = useState(false);
  const [importData, setImportData] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [webdavConfig, setWebdavConfig] = useState<WebdavConfigForm>(DEFAULT_WEBDAV_CONFIG);
  const [savedWebdavConfig, setSavedWebdavConfig] = useState<WebdavConfigSnapshot>(DEFAULT_WEBDAV_SNAPSHOT);
  const [webdavState, setWebdavState] = useState<WebdavSyncState>({ lastSyncAt: null, lastError: null });
  const [webdavSaving, setWebdavSaving] = useState(false);
  const [webdavAction, setWebdavAction] = useState<'export' | 'import' | ''>('');
  const [clearWebdavPassword, setClearWebdavPassword] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const summary = useMemo(() => parseImportSummary(importData), [importData]);

  const buildWebdavForm = (config: any): WebdavConfigForm => ({
    enabled: config.enabled === true,
    fileUrl: String(config.fileUrl || ''),
    username: String(config.username || ''),
    password: '',
    exportType: config.exportType === 'accounts' || config.exportType === 'preferences' ? config.exportType : 'all',
    autoSyncEnabled: config.autoSyncEnabled === true,
    autoSyncCron: String(config.autoSyncCron || DEFAULT_WEBDAV_CONFIG.autoSyncCron),
    hasPassword: config.hasPassword === true,
    passwordMasked: String(config.passwordMasked || ''),
  });

  const buildWebdavSnapshot = (config: any): WebdavConfigSnapshot => ({
    enabled: config.enabled === true,
    fileUrl: String(config.fileUrl || ''),
    username: String(config.username || ''),
    exportType: config.exportType === 'accounts' || config.exportType === 'preferences' ? config.exportType : 'all',
    autoSyncEnabled: config.autoSyncEnabled === true,
    autoSyncCron: String(config.autoSyncCron || DEFAULT_WEBDAV_CONFIG.autoSyncCron),
    hasPassword: config.hasPassword === true,
  });

  const applyWebdavResponse = (result: any) => {
    const config = result?.config;
    if (config) {
      setWebdavConfig(buildWebdavForm(config));
      setSavedWebdavConfig(buildWebdavSnapshot(config));
      setClearWebdavPassword(false);
    }
    const state = result?.state || result;
    setWebdavState((prev) => ({
      lastSyncAt: typeof state?.lastSyncAt === 'string' ? state.lastSyncAt : prev.lastSyncAt,
      lastError: typeof state?.lastError === 'string'
        ? state.lastError
        : (state?.lastError === null ? null : prev.lastError),
    }));
  };

  const webdavConfigDirty = (
    webdavConfig.enabled !== savedWebdavConfig.enabled
    || webdavConfig.fileUrl !== savedWebdavConfig.fileUrl
    || webdavConfig.username !== savedWebdavConfig.username
    || webdavConfig.exportType !== savedWebdavConfig.exportType
    || webdavConfig.autoSyncEnabled !== savedWebdavConfig.autoSyncEnabled
    || webdavConfig.autoSyncCron !== savedWebdavConfig.autoSyncCron
    || webdavConfig.hasPassword !== savedWebdavConfig.hasPassword
    || webdavConfig.password.trim().length > 0
    || clearWebdavPassword
  );

  useEffect(() => {
    let alive = true;
    void api.getBackupWebdavConfig()
      .then((result: any) => {
        if (!alive) return;
        applyWebdavResponse(result);
      })
      .catch((err: any) => {
        if (!alive) return;
        toast.error(err?.message || tr('pages.importExport.webdavConfigurationfailed'));
      });
    return () => {
      alive = false;
    };
  }, [toast]);

  const handleExport = async (type: BackupType) => {
    setExportingType(type);
    try {
      const data = await api.exportBackup(type);
      const date = new Date().toISOString().split('T')[0];
      const fileName: Record<BackupType, string> = {
        all: `metapi-backup-${date}.json`,
        accounts: `metapi-accounts-${date}.json`,
        preferences: `metapi-preferences-${date}.json`,
      };
      downloadJsonFile(data, fileName[type]);
      toast.success(tr('pages.importExport.exportSuccessful'));
    } catch (err: any) {
      toast.error(err?.message || tr('pages.importExport.exportFailed'));
    } finally {
      setExportingType('');
    }
  };

  const readFile = (file: File) => {
    if (!file.name.endsWith('.json') && file.type !== 'application/json') {
      toast.error(tr('pages.importExport.pleaseSelectBackupFileJsonFormat'));
      return;
    }
    setSelectedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      setImportData(String(e.target?.result || ''));
    };
    reader.onerror = () => toast.error(tr('pages.importExport.failedReadFile'));
    reader.readAsText(file);
  };

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    readFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) readFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleImport = async () => {
    if (!importData.trim()) {
      toast.error(tr('pages.importExport.pleaseSelectPasteJsonBackupContentFirst'));
      return;
    }
    if (!summary?.valid) {
      toast.error(tr('pages.importExport.currentJsonStructureNotRecognized'));
      return;
    }
    const confirmed = typeof window === 'undefined' || typeof window.confirm !== 'function'
      ? true
      : window.confirm(tr('pages.importExport.importZhRoutesStrategyconfigurationSystemSettings'));
    if (!confirmed) {
      return;
    }

    setImporting(true);
    try {
      const parsed = JSON.parse(importData);
      const result = await api.importBackup(parsed);
      toast.success(buildImportSuccessMessage(result));
      setImportData('');
      setSelectedFileName('');
    } catch (err: any) {
      toast.error(err?.message || tr('pages.importExport.importFailed'));
    } finally {
      setImporting(false);
    }
  };

  const handleSaveWebdavConfig = async () => {
    setWebdavSaving(true);
    try {
      const nextPassword = webdavConfig.password.trim();
      const payload: Record<string, unknown> = {
        enabled: webdavConfig.enabled,
        fileUrl: webdavConfig.fileUrl,
        username: webdavConfig.username,
        exportType: webdavConfig.exportType,
        autoSyncEnabled: webdavConfig.autoSyncEnabled,
        autoSyncCron: webdavConfig.autoSyncCron,
      };
      if (nextPassword) {
        payload.password = webdavConfig.password;
      } else if (clearWebdavPassword) {
        payload.clearPassword = true;
      }
      const result = await api.saveBackupWebdavConfig(payload as any);
      applyWebdavResponse(result);
      toast.success(tr('pages.importExport.webdavConfigurationSave'));
    } catch (err: any) {
      toast.error(err?.message || tr('pages.importExport.saveWebdavConfigurationfailed'));
    } finally {
      setWebdavSaving(false);
    }
  };

  const handleExportToWebdav = async () => {
    setWebdavAction('export');
    try {
      const result = await api.exportBackupToWebdav(webdavConfig.exportType);
      applyWebdavResponse(result);
      toast.success(`已导出到 WebDAV：${result?.fileUrl || webdavConfig.fileUrl}`);
    } catch (err: any) {
      toast.error(err?.message || tr('pages.importExport.webdavFailed'));
    } finally {
      setWebdavAction('');
    }
  };

  const handleImportFromWebdav = async () => {
    const confirmed = typeof window === 'undefined' || typeof window.confirm !== 'function'
      ? true
      : window.confirm(tr('pages.importExport.webdavImportZhRoutesStrategyconfigurationSystemSettings'));
    if (!confirmed) return;
    setWebdavAction('import');
    try {
      const result = await api.importBackupFromWebdav();
      applyWebdavResponse(result);
      toast.success(buildImportSuccessMessage(result));
    } catch (err: any) {
      toast.error(err?.message || tr('pages.importExport.webdavImportFailed'));
    } finally {
      setWebdavAction('');
    }
  };

  const field = (label: string, control: JSX.Element, className = '') => (
    <div className={`grid gap-2 ${className}`.trim()}>
      <Label>{label}</Label>
      {control}
    </div>
  );

  const toggle = (label: string, checked: boolean, onCheckedChange: (checked: boolean) => void) => (
    <label className="flex items-center gap-2 text-sm font-medium">
      <Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} />
      {label}
    </label>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{tr('pages.importExport.importExport')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{tr('pages.importExport.supportedconfigurationManual')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ToneBadge tone="-muted">Schema v2.2</ToneBadge>
          <ToneBadge tone="-warning">{tr('pages.importExport.keepSensitiveDataOffline')}</ToneBadge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{tr('pages.importExport.exportData')}</CardTitle>
            <CardDescription>{tr('pages.importExport.routesstrategySettingsJson')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button type="button" onClick={() => handleExport('all')} disabled={!!exportingType}>
              <span>{tr('pages.importExport.allRoutesStrategySettings')}</span>
              {exportingType === 'all' ? <LoaderCircle className="size-4 animate-spin" /> : null}
            </Button>
            <Button type="button" variant="outline" onClick={() => handleExport('accounts')} disabled={!!exportingType}>
              <span>{tr('pages.importExport.routesstrategy2')}</span>
              {exportingType === 'accounts' ? <LoaderCircle className="size-4 animate-spin" /> : null}
            </Button>
            <Button type="button" variant="outline" onClick={() => handleExport('preferences')} disabled={!!exportingType}>
              <span>{tr('pages.importExport.systemSettings2')}</span>
              {exportingType === 'preferences' ? <LoaderCircle className="size-4 animate-spin" /> : null}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{tr('pages.importExport.import')}</CardTitle>
            <CardDescription>{tr('pages.importExport.restoreDataFromBackupFile')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${dragOver ? 'border-primary bg-muted' : 'border-border'}`.trim()}
            >
              <Input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportFile}
                className="hidden"
              />
              {selectedFileName ? (
                <div className="grid justify-items-center gap-2">
                  <div className="text-sm font-semibold">{selectedFileName}</div>
                  <div className="text-xs text-muted-foreground">{tr('pages.importExport.clickChooseAnotherFile')}</div>
                </div>
              ) : (
                <div className="grid justify-items-center gap-2">
                  <div className="text-sm font-semibold">
                    {dragOver ? tr('pages.importExport.releaseImportFile') : tr('pages.importExport.dragDropJsonBackupFileHere')}
                  </div>
                  <div className="text-xs text-muted-foreground">{tr('pages.importExport.clickChooseFile')}</div>
                </div>
              )}
            </div>

            {field(
              tr('pages.importExport.preview'),
              <JsonCodeEditor
                value={importData}
                onChange={setImportData}
                placeholder={tr('pages.importExport.pasteJsonDataImportViaDragArea')}
                minHeight={260}
                maxHeight={560}
                ariaLabel={tr('pages.importExport.preview')}
              />,
            )}

            {summary ? (
              <Alert variant={summary.valid ? 'default' : 'destructive'}>
                <AlertTitle>{summary.valid ? tr('pages.importExport.structureValid') : tr('pages.importExport.unsupportedStructure')}</AlertTitle>
                <AlertDescription>
                  {summary.valid ? (
                    <div className="grid gap-1">
                      <div>{tr('pages.importExport.version')}{summary.version}{tr('pages.importExport.time')}{summary.timestampLabel}</div>
                      <div>{tr('pages.importExport.includesSections')}{summary.hasAccounts ? tr('pages.importExport.routesstrategy') : ''}{summary.hasAccounts && summary.hasPreferences ? ' + ' : ''}{summary.hasPreferences ? tr('pages.importExport.systemSettings') : ''}</div>
                      {summary.isAllApiHubV2 ? (
                        <>
                          <div>{tr('pages.importExport.allApiHubV2Available')}</div>
                          <div>{tr('pages.importExport.accounts2')} {summary.accountsCount} {tr('pages.importExport.bookmarks')} {summary.bookmarksCount} {tr('pages.importExport.api')} {summary.profilesCount}</div>
                          {summary.ignoredSections.length ? <div>{tr('pages.importExport.import3')}{summary.ignoredSections.join('、')}</div> : null}
                        </>
                      ) : null}
                      {(summary.sitesCount
                        || summary.accountsCount
                        || summary.tokensCount
                        || summary.routesCount
                        || summary.channelsCount
                        || summary.siteDisabledModelsCount
                        || summary.manualModelsCount
                        || summary.downstreamApiKeysCount
                        || summary.settingsCount) ? (
                        <div>
                          {tr('pages.importExport.sites')} {summary.sitesCount} {tr('pages.importExport.accounts')} {summary.accountsCount} {tr('pages.importExport.token')} {summary.tokensCount} {tr('pages.importExport.routes')} {summary.routesCount} {tr('pages.importExport.channels')} {summary.channelsCount} {tr('pages.importExport.sitesdisabledmodel')} {summary.siteDisabledModelsCount} {tr('pages.importExport.model')} {summary.manualModelsCount} {tr('pages.importExport.key')} {summary.downstreamApiKeysCount} {tr('pages.importExport.settings')} {summary.settingsCount}
                        </div>
                      ) : null}
                      {summary.hasLegacyData ? <div>{tr('pages.importExport.modeimport')}</div> : null}
                    </div>
                  ) : (
                    <div>{tr('pages.importExport.jsonUnsupportedStructure')}</div>
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            <Button type="button" onClick={handleImport} disabled={importing || !summary?.valid}>
              {importing ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.importExport.importing')}</> : tr('pages.importExport.import2')}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tr('pages.importExport.webdavSync')}</CardTitle>
          <CardDescription>{tr('pages.importExport.supportedmanualManualAutomaticWebdav')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            {field(
              tr('pages.importExport.url'),
              <Input
                value={webdavConfig.fileUrl}
                onChange={(e) => setWebdavConfig((prev) => ({ ...prev, fileUrl: e.target.value }))}
                placeholder="https://dav.example.com/backups/metapi.json"
              />,
              'md:col-span-2',
            )}
            {field(
              tr('app.username'),
              <Input
                value={webdavConfig.username}
                onChange={(e) => setWebdavConfig((prev) => ({ ...prev, username: e.target.value }))}
                placeholder={tr('pages.importExport.canEmpty')}
              />,
            )}
            <div className="grid gap-2">
              <Label>{tr('pages.accounts.password')}</Label>
              <Input
                type="password"
                value={webdavConfig.password}
                onChange={(e) => {
                  const nextPassword = e.target.value;
                  setWebdavConfig((prev) => ({ ...prev, password: nextPassword }));
                  if (nextPassword.trim()) {
                    setClearWebdavPassword(false);
                  }
                }}
                placeholder={clearWebdavPassword
                  ? tr('pages.importExport.saveClearPassword')
                  : (webdavConfig.hasPassword ? `已保存 ${webdavConfig.passwordMasked}，留空则保持不变` : tr('pages.importExport.inputpassword'))}
                disabled={clearWebdavPassword}
              />
              {webdavConfig.hasPassword ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    aria-label={tr('pages.importExport.clearSavepassword')}
                    checked={clearWebdavPassword}
                    onCheckedChange={(checked) => {
                      setClearWebdavPassword(checked);
                      if (checked) {
                        setWebdavConfig((prev) => ({ ...prev, password: '' }));
                      }
                    }}
                  />
                  {tr('pages.importExport.clearSavepassword')}
                </label>
              ) : null}
            </div>
            {field(
              tr('pages.importExport.exportSections'),
              <ModernSelect
                value={webdavConfig.exportType}
                onChange={(value) => setWebdavConfig((prev) => ({ ...prev, exportType: value as BackupType }))}
                options={[...WEBDAV_EXPORT_TYPE_OPTIONS]}
              />,
            )}
            {field(
              tr('pages.importExport.automaticsyncCron'),
              <Input
                value={webdavConfig.autoSyncCron}
                onChange={(e) => setWebdavConfig((prev) => ({ ...prev, autoSyncCron: e.target.value }))}
                placeholder="0 */6 * * *"
                className="font-mono"
              />,
            )}
          </div>

          <div className="flex flex-wrap gap-4">
            {toggle(tr('pages.importExport.enabledWebdav'), webdavConfig.enabled, (checked) => setWebdavConfig((prev) => ({ ...prev, enabled: checked })))}
            {toggle(tr('pages.importExport.automaticsync'), webdavConfig.autoSyncEnabled, (checked) => setWebdavConfig((prev) => ({ ...prev, autoSyncEnabled: checked })))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleSaveWebdavConfig} disabled={webdavSaving}>
              {webdavSaving ? tr('pages.accounts.saving') : tr('pages.importExport.saveWebdavConfiguration')}
            </Button>
            <Button type="button" variant="outline" onClick={handleExportToWebdav} disabled={webdavAction !== '' || webdavSaving || webdavConfigDirty}>
              {webdavAction === 'export' ? tr('pages.importExport.zh2') : tr('pages.importExport.webdav')}
            </Button>
            <Button type="button" variant="outline" onClick={handleImportFromWebdav} disabled={webdavAction !== '' || webdavSaving || webdavConfigDirty}>
              {webdavAction === 'import' ? tr('pages.importExport.zh') : tr('pages.importExport.webdav2')}
            </Button>
          </div>

          {webdavConfigDirty ? (
            <p className="text-xs text-muted-foreground">
              {tr('pages.importExport.webdavConfigurationSaveSaveImport')}
            </p>
          ) : null}

          <div className="grid gap-1 text-xs text-muted-foreground">
            <div>{tr('pages.importExport.sync2')}{webdavState.lastSyncAt ? new Date(webdavState.lastSyncAt).toLocaleString() : tr('pages.importExport.sync')}</div>
            <div>{tr('pages.importExport.mistake')}{webdavState.lastError || tr('pages.importExport.none')}</div>
          </div>
        </CardContent>
      </Card>

      <Alert>
        <AlertTitle>{tr('pages.importExport.notes')}</AlertTitle>
        <AlertDescription>
          <div>{tr('pages.importExport.1ImportZhSitesAccountsTokenRoutes')}</div>
          <div>{tr('pages.importExport.2ZhRoutesStrategyconfiguration')}</div>
          <div>{tr('pages.importExport.3AdminsignIntokenAuthTokenImport')}</div>
          <div>{tr('pages.importExport.4SuggestionAllBackupImportactions')}</div>
        </AlertDescription>
      </Alert>
    </div>
  );
}
