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
import { Textarea } from '../components/ui/textarea/index.js';

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
  { value: 'all', label: '全部' },
  { value: 'accounts', label: '连接与路由策略' },
  { value: 'preferences', label: '系统设置' },
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
    timestampLabel: '未知',
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
    const timestampLabel = ts && !Number.isNaN(ts.getTime()) ? ts.toLocaleString() : '未知';

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
  if (result?.sections?.accounts) sections.push('连接与路由策略');
  if (result?.sections?.preferences) sections.push('系统设置');

  const parts = [`导入完成：${sections.length ? sections.join('、') : '无有效数据'}`];
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
        toast.error(err?.message || '加载 WebDAV 配置失败');
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
      toast.success('导出成功');
    } catch (err: any) {
      toast.error(err?.message || '导出失败');
    } finally {
      setExportingType('');
    }
  };

  const readFile = (file: File) => {
    if (!file.name.endsWith('.json') && file.type !== 'application/json') {
      toast.error('请选择 JSON 格式的备份文件');
      return;
    }
    setSelectedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      setImportData(String(e.target?.result || ''));
    };
    reader.onerror = () => toast.error('读取文件失败');
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
      toast.error('请先选择或粘贴 JSON 备份内容');
      return;
    }
    if (!summary?.valid) {
      toast.error('当前 JSON 结构无法识别');
      return;
    }
    const confirmed = typeof window === 'undefined' || typeof window.confirm !== 'function'
      ? true
      : window.confirm('导入会覆盖备份中的连接/路由/策略配置或系统设置，但会保留本机日志、公告、缓存和统计，确认继续？');
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
      toast.error(err?.message || '导入失败');
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
      toast.success('WebDAV 配置已保存');
    } catch (err: any) {
      toast.error(err?.message || '保存 WebDAV 配置失败');
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
      toast.error(err?.message || '导出到 WebDAV 失败');
    } finally {
      setWebdavAction('');
    }
  };

  const handleImportFromWebdav = async () => {
    const confirmed = typeof window === 'undefined' || typeof window.confirm !== 'function'
      ? true
      : window.confirm('从 WebDAV 导入会覆盖备份中的连接/路由/策略配置或系统设置，但会保留本机日志、公告、缓存和统计，确认继续？');
    if (!confirmed) return;
    setWebdavAction('import');
    try {
      const result = await api.importBackupFromWebdav();
      applyWebdavResponse(result);
      toast.success(buildImportSuccessMessage(result));
    } catch (err: any) {
      toast.error(err?.message || '从 WebDAV 导入失败');
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
          <h2 className="text-2xl font-semibold tracking-tight">{tr('导入 / 导出')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">支持配置型备份、分区备份与手动恢复。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ToneBadge tone="-muted">Schema v2.2</ToneBadge>
          <ToneBadge tone="-warning">敏感数据请离线保管</ToneBadge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>导出数据</CardTitle>
            <CardDescription>将连接、路由策略与设置导出为 JSON 文件进行备份</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button type="button" onClick={() => handleExport('all')} disabled={!!exportingType}>
              <span>导出全部（连接 + 路由 + 策略 + 设置）</span>
              {exportingType === 'all' ? <LoaderCircle className="size-4 animate-spin" /> : null}
            </Button>
            <Button type="button" variant="outline" onClick={() => handleExport('accounts')} disabled={!!exportingType}>
              <span>仅导出连接与路由策略</span>
              {exportingType === 'accounts' ? <LoaderCircle className="size-4 animate-spin" /> : null}
            </Button>
            <Button type="button" variant="outline" onClick={() => handleExport('preferences')} disabled={!!exportingType}>
              <span>仅导出系统设置</span>
              {exportingType === 'preferences' ? <LoaderCircle className="size-4 animate-spin" /> : null}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>导入数据</CardTitle>
            <CardDescription>从备份文件恢复数据</CardDescription>
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
                  <div className="text-xs text-muted-foreground">点击重新选择文件</div>
                </div>
              ) : (
                <div className="grid justify-items-center gap-2">
                  <div className="text-sm font-semibold">
                    {dragOver ? '松开以导入文件' : '拖拽 JSON 备份文件到此处'}
                  </div>
                  <div className="text-xs text-muted-foreground">或点击选择文件</div>
                </div>
              )}
            </div>

            {field(
              '数据预览',
              <Textarea
                value={importData}
                onChange={(e) => setImportData(e.target.value)}
                placeholder="粘贴 JSON 数据或通过上面的拖拽区域导入..."
                className="min-h-28 font-mono text-xs"
              />,
            )}

            {summary ? (
              <Alert variant={summary.valid ? 'default' : 'destructive'}>
                <AlertTitle>{summary.valid ? '结构有效' : '结构不受支持'}</AlertTitle>
                <AlertDescription>
                  {summary.valid ? (
                    <div className="grid gap-1">
                      <div>版本：{summary.version}，时间：{summary.timestampLabel}</div>
                      <div>包含分区：{summary.hasAccounts ? '连接与路由策略' : ''}{summary.hasAccounts && summary.hasPreferences ? ' + ' : ''}{summary.hasPreferences ? '系统设置' : ''}</div>
                      {summary.isAllApiHubV2 ? (
                        <>
                          <div>检测到 ALL-API-Hub V2 兼容备份：将离线迁移可用连接。</div>
                          <div>统计：账号 {summary.accountsCount} / 书签 {summary.bookmarksCount} / 独立 API 凭据 {summary.profilesCount}</div>
                          {summary.ignoredSections.length ? <div>不会原生导入：{summary.ignoredSections.join('、')}</div> : null}
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
                          统计：站点 {summary.sitesCount} / 账号 {summary.accountsCount} / 令牌 {summary.tokensCount} / 路由 {summary.routesCount} / 通道 {summary.channelsCount} / 站点禁用模型 {summary.siteDisabledModelsCount} / 手工模型 {summary.manualModelsCount} / 下游 Key {summary.downstreamApiKeysCount} / 设置 {summary.settingsCount}
                        </div>
                      ) : null}
                      {summary.hasLegacyData ? <div>检测到兼容结构：将按兼容模式导入。</div> : null}
                    </div>
                  ) : (
                    <div>JSON 可解析，但结构不受支持。</div>
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            <Button type="button" onClick={handleImport} disabled={importing || !summary?.valid}>
              {importing ? <><LoaderCircle className="size-4 animate-spin" /> 导入中...</> : '导入'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>WebDAV 同步</CardTitle>
          <CardDescription>支持手动推送、手动拉取，以及定时自动导出到 WebDAV。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            {field(
              '文件 URL',
              <Input
                value={webdavConfig.fileUrl}
                onChange={(e) => setWebdavConfig((prev) => ({ ...prev, fileUrl: e.target.value }))}
                placeholder="https://dav.example.com/backups/metapi.json"
              />,
              'md:col-span-2',
            )}
            {field(
              '用户名',
              <Input
                value={webdavConfig.username}
                onChange={(e) => setWebdavConfig((prev) => ({ ...prev, username: e.target.value }))}
                placeholder="可留空"
              />,
            )}
            <div className="grid gap-2">
              <Label>密码</Label>
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
                  ? '保存后将清空已存密码'
                  : (webdavConfig.hasPassword ? `已保存 ${webdavConfig.passwordMasked}，留空则保持不变` : '请输入密码')}
                disabled={clearWebdavPassword}
              />
              {webdavConfig.hasPassword ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    aria-label="清空已保存密码"
                    checked={clearWebdavPassword}
                    onCheckedChange={(checked) => {
                      setClearWebdavPassword(checked);
                      if (checked) {
                        setWebdavConfig((prev) => ({ ...prev, password: '' }));
                      }
                    }}
                  />
                  清空已保存密码
                </label>
              ) : null}
            </div>
            {field(
              '导出分区',
              <ModernSelect
                value={webdavConfig.exportType}
                onChange={(value) => setWebdavConfig((prev) => ({ ...prev, exportType: value as BackupType }))}
                options={[...WEBDAV_EXPORT_TYPE_OPTIONS]}
              />,
            )}
            {field(
              '自动同步 Cron',
              <Input
                value={webdavConfig.autoSyncCron}
                onChange={(e) => setWebdavConfig((prev) => ({ ...prev, autoSyncCron: e.target.value }))}
                placeholder="0 */6 * * *"
                className="font-mono"
              />,
            )}
          </div>

          <div className="flex flex-wrap gap-4">
            {toggle('启用 WebDAV', webdavConfig.enabled, (checked) => setWebdavConfig((prev) => ({ ...prev, enabled: checked })))}
            {toggle('自动同步', webdavConfig.autoSyncEnabled, (checked) => setWebdavConfig((prev) => ({ ...prev, autoSyncEnabled: checked })))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleSaveWebdavConfig} disabled={webdavSaving}>
              {webdavSaving ? '保存中...' : '保存 WebDAV 配置'}
            </Button>
            <Button type="button" variant="outline" onClick={handleExportToWebdav} disabled={webdavAction !== '' || webdavSaving || webdavConfigDirty}>
              {webdavAction === 'export' ? '导出中...' : '立即导出到 WebDAV'}
            </Button>
            <Button type="button" variant="outline" onClick={handleImportFromWebdav} disabled={webdavAction !== '' || webdavSaving || webdavConfigDirty}>
              {webdavAction === 'import' ? '拉取中...' : '从 WebDAV 拉取'}
            </Button>
          </div>

          {webdavConfigDirty ? (
            <p className="text-xs text-muted-foreground">
              当前 WebDAV 配置有未保存改动，请先保存后再执行导入或导出。
            </p>
          ) : null}

          <div className="grid gap-1 text-xs text-muted-foreground">
            <div>上次同步：{webdavState.lastSyncAt ? new Date(webdavState.lastSyncAt).toLocaleString() : '尚未同步'}</div>
            <div>最近错误：{webdavState.lastError || '无'}</div>
          </div>
        </CardContent>
      </Card>

      <Alert>
        <AlertTitle>注意事项</AlertTitle>
        <AlertDescription>
          <div>1. 导入连接分区会覆盖备份中的站点、账号、令牌、路由、禁用模型、手工模型和下游 Key 配置。</div>
          <div>2. 覆盖备份中的连接/路由/策略配置，但会保留本机日志、公告、缓存和统计。</div>
          <div>3. 为避免锁死管理界面，管理员登录令牌（`auth_token`）不会从备份导入。</div>
          <div>4. 建议先导出一份"全部备份"再执行导入操作。</div>
        </AlertDescription>
      </Alert>
    </div>
  );
}
