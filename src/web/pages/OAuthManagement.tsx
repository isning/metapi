import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import CenteredModal from '../components/CenteredModal.js';
import ResponsiveBatchActionBar from '../components/ResponsiveBatchActionBar.js';
import ResponsiveFilterPanel from '../components/ResponsiveFilterPanel.js';
import { MobileCard, MobileField } from '../components/MobileCard.js';
import ModernSelect from '../components/ModernSelect.js';
import { useToast } from '../components/Toast.js';
import { useIsMobile } from '../components/useIsMobile.js';
import OAuthModelsModal, { type OAuthModelItem } from './oauth/OAuthModelsModal.js';
import { Button } from '../components/ui/button/index.js';
import * as DropdownMenu from '../components/ui/dropdown-menu/index.js';
import { Input } from '../components/ui/input/index.js';
import * as Sheet from '../components/ui/sheet/index.js';
import ToneBadge from '../components/ToneBadge.js';
import SearchInput from '../components/SearchInput.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card/index.js';
import { Checkbox } from '../components/ui/checkbox/index.js';
import { Label } from '../components/ui/label/index.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table/index.js';
import { Textarea } from '../components/ui/textarea/index.js';
import EmptyStateBlock from '../components/EmptyStateBlock.js';
import {
  api,
  type OAuthConnectionInfo,
  type OAuthProviderInfo,
  type OAuthRouteParticipation,
  type OAuthRouteUnitStrategy,
  type OAuthQuotaInfo,
  type OAuthQuotaWindowInfo,
  type OAuthStartInstructions,
} from '../api.js';

const POLL_INTERVAL_MS = 1500;
const CONNECTION_PAGE_LIMIT = 200;
const AUTO_REFRESH_OPTIONS = [0, 5, 10, 15, 30] as const;

type ActiveSession = {
  provider: string;
  state: string;
  authorizationUrl: string;
  instructions: OAuthStartInstructions;
};

type DrawerIntent =
  | { mode: 'create'; provider?: string }
  | { mode: 'rebind'; account: OAuthConnectionInfo }
  | { mode: 'proxy'; account: OAuthConnectionInfo };

type ColumnKey = 'identity' | 'site' | 'status' | 'quota' | 'proxy';

type OAuthImportFileLike = {
  name?: string;
  text?: () => Promise<string>;
};

type OAuthImportDraft = {
  sourceName: string;
  rawText: string;
  error?: string;
};

type OAuthImportSource = {
  sourceName: string;
  rawText: string;
  error?: string;
};

type OAuthImportPreview = {
  sourceName: string;
  valid: boolean;
  providerLabel?: string;
  email?: string;
  accountKey?: string;
  expiresLabel?: string;
  disabled?: boolean;
  error?: string;
  parsedData?: Record<string, unknown>;
};

type OAuthImportPreviewSummary = {
  totalCount: number;
  validCount: number;
  invalidCount: number;
  canImport: boolean;
  items: OAuthImportPreview[];
};

type OAuthModelsModalState = {
  open: boolean;
  loading: boolean;
  refreshing: boolean;
  connection: OAuthConnectionInfo | null;
  models: OAuthModelItem[];
  totalCount: number;
  disabledCount: number;
  siteName: string;
};

type OAuthRouteUnitModalState = {
  open: boolean;
  name: string;
  strategy: OAuthRouteUnitStrategy;
};

type SessionRouteUnitFeedback = {
  action: 'created' | 'deleted';
  name: string;
  memberCount: number;
  strategy: OAuthRouteUnitStrategy;
};

type SessionFeedback = {
  message: string;
  tone: 'info' | 'success' | 'error';
  routeUnit?: SessionRouteUnitFeedback | null;
};

const COLUMN_OPTIONS: Array<{ key: ColumnKey; label: string }> = [
  { key: 'identity', label: '账号 / Provider' },
  { key: 'site', label: '站点' },
  { key: 'status', label: '运行状态' },
  { key: 'quota', label: 'Usage / Quota' },
  { key: 'proxy', label: '代理 / 项目' },
];

function openOAuthPopup(provider: string, authorizationUrl: string) {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return;
  const popup = window.open(
    authorizationUrl,
    `oauth-${provider}`,
    'popup=yes,width=540,height=760,resizable=yes,scrollbars=yes,noopener,noreferrer',
  );
  if (popup) {
    try {
      popup.opener = null;
    } catch {
      // Ignore cross-window opener hardening failures.
    }
  }
  if (popup && typeof popup.focus === 'function') {
    popup.focus();
  }
}

function asTrimmedString(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOauthMessage(value: string | null | undefined): string {
  const text = asTrimmedString(value);
  if (!text) return '';

  return text
    .replace(/codex usage windows inferred from rate limit response headers/ig, '额度窗口已从响应头推断')
    .replace(/official 5h quota window is not exposed by current codex oauth artifacts/ig, '当前 Codex OAuth 未暴露官方 5h 窗口')
    .replace(/official 7d quota window is not exposed by current codex oauth artifacts/ig, '当前 Codex OAuth 未暴露官方 7d 窗口')
    .replace(/official 5h quota window is unavailable for this provider/ig, '当前 Provider 不提供官方 5h 窗口')
    .replace(/official 7d quota window is unavailable for this provider/ig, '当前 Provider 不提供官方 7d 窗口')
    .replace(/\bfetch failed\b/ig, '网络请求失败');
}

function listImportFiles(files: ArrayLike<OAuthImportFileLike> | null | undefined): OAuthImportFileLike[] {
  return files ? Array.from(files) : [];
}

async function readOauthImportDrafts(
  files: ArrayLike<OAuthImportFileLike> | null | undefined,
): Promise<OAuthImportDraft[]> {
  const nextFiles = listImportFiles(files);
  return Promise.all(nextFiles.map(async (file, index) => {
    const sourceName = asTrimmedString(file.name) || `oauth-import-${index + 1}.json`;
    if (typeof file.text !== 'function') {
      return {
        sourceName,
        rawText: '',
        error: '当前浏览器不支持读取该文件',
      };
    }
    try {
      return {
        sourceName,
        rawText: await file.text(),
      };
    } catch (error: any) {
      return {
        sourceName,
        rawText: '',
        error: error?.message || '读取文件失败',
      };
    }
  }));
}

function decodeJwtPayload(token?: string): Record<string, unknown> | null {
  if (typeof token !== 'string' || !token.trim()) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const raw = (parts[1] || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = raw + '='.repeat((4 - (raw.length % 4 || 4)) % 4);
  try {
    const decoded = typeof window !== 'undefined' && typeof window.atob === 'function'
      ? window.atob(padded)
      : '';
    const parsed = JSON.parse(decoded) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function resolveImportProviderLabel(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'codex' || normalized === 'openai') return 'Codex';
  if (normalized === 'claude' || normalized === 'anthropic') return 'Claude';
  if (normalized === 'gemini-cli' || normalized === 'gemini') return 'Gemini CLI';
  if (normalized === 'antigravity') return 'Antigravity';
  return null;
}

function resolveImportPreviewExpiryLabel(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number'
    ? value
    : (typeof value === 'string' && /^\d+$/.test(value.trim()))
      ? Number.parseInt(value.trim(), 10)
      : Date.parse(typeof value === 'string' ? value : '');
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('expired 时间格式无效');
  }
  return new Date(parsed).toLocaleString();
}

function parseOauthImportPreview(source: OAuthImportSource): OAuthImportPreview {
  if (source.error) {
    return {
      sourceName: source.sourceName,
      valid: false,
      error: source.error,
    };
  }

  const raw = source.rawText.trim();
  if (!raw) {
    return {
      sourceName: source.sourceName,
      valid: false,
      error: 'JSON 内容为空',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      sourceName: source.sourceName,
      valid: false,
      error: 'JSON 解析失败',
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      sourceName: source.sourceName,
      valid: false,
      error: '需要单个 OAuth JSON 对象',
    };
  }

  const payload = parsed as Record<string, unknown>;
  const type = asTrimmedString(typeof payload.type === 'string' ? payload.type : '');
  if (
    type === 'sub2api-data'
    || type === 'sub2api-bundle'
    || 'accounts' in payload
    || 'proxies' in payload
    || 'version' in payload
    || 'exported_at' in payload
  ) {
    return {
      sourceName: source.sourceName,
      valid: false,
      error: '这是旧的 sub2api 导出格式',
    };
  }

  const providerLabel = type ? resolveImportProviderLabel(type) : null;
  if (!providerLabel) {
    return {
      sourceName: source.sourceName,
      valid: false,
      error: `不支持的 OAuth 类型：${type || '未知'}`,
    };
  }

  if (!asTrimmedString(typeof payload.access_token === 'string' ? payload.access_token : '')) {
    return {
      sourceName: source.sourceName,
      valid: false,
      error: '缺少 access_token',
    };
  }

  try {
    const claims = decodeJwtPayload(typeof payload.id_token === 'string' ? payload.id_token : undefined);
    const authClaims = claims?.['https://api.openai.com/auth'];
    const authRecord = authClaims && typeof authClaims === 'object' && !Array.isArray(authClaims)
      ? authClaims as Record<string, unknown>
      : null;
    return {
      sourceName: source.sourceName,
      valid: true,
      providerLabel,
      email: asTrimmedString(typeof payload.email === 'string' ? payload.email : '')
        || asTrimmedString(typeof claims?.email === 'string' ? claims.email : ''),
      accountKey: asTrimmedString(typeof payload.account_key === 'string' ? payload.account_key : '')
        || asTrimmedString(typeof payload.account_id === 'string' ? payload.account_id : '')
        || asTrimmedString(typeof authRecord?.chatgpt_account_id === 'string' ? authRecord.chatgpt_account_id : ''),
      expiresLabel: resolveImportPreviewExpiryLabel(payload.expired),
      disabled: payload.disabled === true,
      parsedData: payload,
    };
  } catch (error: any) {
    return {
      sourceName: source.sourceName,
      valid: false,
      error: error?.message || 'JSON 结构无效',
    };
  }
}

function resolveConnectionPrimaryTitle(connection: OAuthConnectionInfo): string {
  return asTrimmedString(connection.username)
    || asTrimmedString(connection.email)
    || asTrimmedString(connection.accountKey)
    || asTrimmedString(connection.provider)
    || 'OAuth 连接';
}

function resolveConnectionEmailLabel(connection: OAuthConnectionInfo): string {
  return asTrimmedString(connection.email);
}

function resolveConnectionStatusLabel(status?: string): string {
  return status === 'abnormal' ? '异常' : '正常';
}

function resolveQuotaStatusLabel(status?: OAuthQuotaInfo['status']): string {
  if (status === 'unsupported') return '不支持';
  if (status === 'error') return '获取失败';
  return '支持';
}

function resolveQuotaSourceLabel(source?: OAuthQuotaInfo['source']): string {
  return source === 'official' ? '官方' : '响应头推断';
}

function resolveModelSyncStatusText(connection: OAuthConnectionInfo): string {
  const failureText = normalizeOauthMessage(connection.lastModelSyncError || '');
  if (failureText) return '获取失败';
  return connection.lastModelSyncAt ? '同步正常' : '未同步';
}

function resolveQuotaSyncStatusText(quota?: OAuthQuotaInfo | null): string {
  if (!quota) return '未刷新额度';
  if (quota.status === 'error') {
    return '获取失败';
  }
  if (quota.status === 'unsupported') {
    return '不支持';
  }
  return quota.lastSyncAt ? '同步正常' : '未刷新';
}

function resolveModelSyncDetail(connection: OAuthConnectionInfo): string {
  return normalizeOauthMessage(connection.lastModelSyncError || '');
}

function resolveQuotaSyncDetail(quota?: OAuthQuotaInfo | null): string {
  if (!quota) return '';
  if (quota.status === 'error') {
    return normalizeOauthMessage(quota.lastError || quota.providerMessage || '额度刷新失败');
  }
  if (quota.status === 'unsupported') {
    return normalizeOauthMessage(quota.providerMessage || '当前连接暂不支持额度窗口');
  }
  return '';
}

function redactProxyUrl(value: string | null | undefined): string {
  const text = asTrimmedString(value);
  if (!text) return '';
  try {
    const parsed = new URL(text);
    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '';
    }
    const serialized = parsed.toString();
    return parsed.pathname === '/' && !parsed.search && !parsed.hash
      ? serialized.replace(/\/$/, '')
      : serialized;
  } catch {
    return text.replace(/\/\/[^/@:\s]+(?::[^/@\s]*)?@/, '//***@');
  }
}

function compactAccountKey(value?: string | null): string {
  const text = asTrimmedString(value || '');
  if (!text || text.length <= 24) return text;
  return `${text.slice(0, 8)}...${text.slice(-6)}`;
}

function formatResetLabel(value?: string | null): string {
  const text = asTrimmedString(value || '');
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return '现在';
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (diffHours >= 24) {
    const days = Math.floor(diffHours / 24);
    return `${days}d ${diffHours % 24}h`;
  }
  if (diffHours > 0) return `${diffHours}h ${diffMinutes}m`;
  return `${Math.max(1, diffMinutes)}m`;
}

function resolveQuotaWindowPercent(window?: OAuthQuotaWindowInfo | null): number | null {
  if (!window?.supported) return null;
  if (typeof window.used === 'number' && typeof window.limit === 'number' && window.limit > 0) {
    return Math.max(0, Math.min(100, Math.round((window.used / window.limit) * 100)));
  }
  if (typeof window.remaining === 'number' && typeof window.limit === 'number' && window.limit > 0) {
    return Math.max(0, Math.min(100, Math.round(((window.limit - window.remaining) / window.limit) * 100)));
  }
  return null;
}

function resolveQuotaWindowSummary(window?: OAuthQuotaWindowInfo | null): string {
  if (!window || !window.supported) return '';
  if (typeof window.used === 'number' && typeof window.limit === 'number') {
    return `${window.used} / ${window.limit}`;
  }
  if (typeof window.remaining === 'number' && typeof window.limit === 'number') {
    return `剩余 ${window.remaining} / ${window.limit}`;
  }
  if (typeof window.limit === 'number') return `总量 ${window.limit}`;
  return window.message || '官方未提供';
}

function resolveProxyProjectSummary(connection: OAuthConnectionInfo): string {
  const parts = [
    asTrimmedString(connection.planType || ''),
    connection.projectId ? `Project ${connection.projectId}` : '',
  ].filter(Boolean);
  return parts.join(' · ') || '--';
}

function resolveProxyDisplayText(connection: OAuthConnectionInfo): string {
  if (connection.useSystemProxy) return '系统级代理';
  if (connection.proxyUrl) return redactProxyUrl(connection.proxyUrl);
  return '未设置代理';
}

function hasOauthProxySelection(connection: OAuthConnectionInfo): boolean {
  return !!connection.useSystemProxy || !!asTrimmedString(connection.proxyUrl);
}

function resolveRouteUnitStrategyLabel(strategy?: OAuthRouteUnitStrategy | null): string {
  return strategy === 'stick_until_unavailable' ? '单个用到不可用再切' : '轮询';
}

function resolveConnectionRouteParticipation(
  connection: OAuthConnectionInfo,
): OAuthRouteParticipation {
  if (connection.routeParticipation?.kind === 'route_unit') {
    return {
      ...connection.routeParticipation,
      id: connection.routeParticipation.id ?? connection.routeUnit?.id,
      routeUnitId: connection.routeParticipation.routeUnitId
        ?? connection.routeParticipation.id
        ?? connection.routeUnit?.routeUnitId
        ?? connection.routeUnit?.id,
    };
  }
  if (connection.routeParticipation?.kind === 'single') {
    return connection.routeParticipation;
  }
  if (connection.routeUnit) {
    return {
      kind: 'route_unit',
      routeUnitId: connection.routeUnit.routeUnitId ?? connection.routeUnit.id,
      id: connection.routeUnit.id,
      name: connection.routeUnit.name,
      strategy: connection.routeUnit.strategy,
      memberCount: connection.routeUnit.memberCount,
    };
  }
  return { kind: 'single' };
}

function resolveRouteParticipationSummary(connection: OAuthConnectionInfo): string {
  const participation = resolveConnectionRouteParticipation(connection);
  if (participation.kind !== 'route_unit') {
    return '单体';
  }
  return `路由池：${participation.name} · ${participation.memberCount} 个成员 · ${resolveRouteUnitStrategyLabel(participation.strategy)}`;
}

function renderCodeBlock(value: string) {
  return (
    <code className="block overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{value}</code>
  );
}

function renderGuideCard(title: string, description: string, children?: ReactNode) {
  return (
    <Card>
      <CardContent className="grid gap-3 p-4">
        <div className="grid gap-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-sm text-muted-foreground">{description}</div>
        </div>
      {children}
      </CardContent>
    </Card>
  );
}

function QuotaWindowRow({
  label,
  window,
}: {
  label: string;
  window?: OAuthQuotaWindowInfo | null;
}) {
  const percent = resolveQuotaWindowPercent(window);
  const summary = resolveQuotaWindowSummary(window);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
        <ToneBadge tone="muted">{label}</ToneBadge>
        <span className="font-medium">{percent == null ? 'N/A' : `${percent}%`}</span>
        {summary ? <span className="text-muted-foreground">{summary}</span> : null}
        {window?.resetAt ? (
          <span className="text-muted-foreground">重置 {formatResetLabel(window.resetAt)}</span>
        ) : null}
    </div>
  );
}

function SideDrawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <Sheet.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Sheet.Content side="right" className="flex h-full w-[min(92vw,560px)] max-w-none flex-col p-0" onClose={onClose}>
        <Sheet.Header className="border-b px-4 py-4">
          <Sheet.Title>{title}</Sheet.Title>
        </Sheet.Header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {children}
        </div>
      </Sheet.Content>
    </Sheet.Root>
  );
}

export default function OAuthManagement() {
  const location = useLocation();
  const isMobile = useIsMobile();
  const toast = useToast();
  const createIntentHandledRef = useRef(false);
  const modelsModalRequestSeqRef = useRef(0);
  const [providers, setProviders] = useState<OAuthProviderInfo[]>([]);
  const [connections, setConnections] = useState<OAuthConnectionInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sessionFeedback, setSessionFeedback] = useState<SessionFeedback | null>(null);
  const [actionLoadingKey, setActionLoadingKey] = useState('');
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<number[]>([]);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [siteFilter, setSiteFilter] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>({
    identity: true,
    site: true,
    status: true,
    quota: true,
    proxy: true,
  });
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState<number>(0);
  const [autoRefreshCountdown, setAutoRefreshCountdown] = useState<number>(0);
  const [runtimeSystemProxyConfigured, setRuntimeSystemProxyConfigured] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const [importJsonText, setImportJsonText] = useState('');
  const [importDrafts, setImportDrafts] = useState<OAuthImportDraft[]>([]);
  const [importDragOver, setImportDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importCustomProxyEnabled, setImportCustomProxyEnabled] = useState(false);
  const [importSystemProxyEnabled, setImportSystemProxyEnabled] = useState(false);
  const [importProxyUrl, setImportProxyUrl] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerIntent, setDrawerIntent] = useState<DrawerIntent>({ mode: 'create' });
  const [selectedProviderKey, setSelectedProviderKey] = useState('');
  const [drawerProjectId, setDrawerProjectId] = useState('');
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [manualCallbackVisible, setManualCallbackVisible] = useState(false);
  const [manualCallbackUrl, setManualCallbackUrl] = useState('');
  const [manualCallbackSubmitting, setManualCallbackSubmitting] = useState(false);
  const [oauthCustomProxyEnabled, setOauthCustomProxyEnabled] = useState(false);
  const [oauthSystemProxyEnabled, setOauthSystemProxyEnabled] = useState(false);
  const [oauthProxyUrl, setOauthProxyUrl] = useState('');
  const [modelsModal, setModelsModal] = useState<OAuthModelsModalState>({
    open: false,
    loading: false,
    refreshing: false,
    connection: null,
    models: [],
    totalCount: 0,
    disabledCount: 0,
    siteName: '',
  });
  const [routeUnitModal, setRouteUnitModal] = useState<OAuthRouteUnitModalState>({
    open: false,
    name: '',
    strategy: 'round_robin',
  });

  const setSessionMessage = useCallback((
    message: string,
    tone: SessionFeedback['tone'],
    options?: {
      routeUnit?: SessionRouteUnitFeedback | null;
    },
  ) => {
    setSessionFeedback({
      message,
      tone,
      routeUnit: options?.routeUnit ?? null,
    });
  }, []);

  const setSessionInfo = useCallback((
    message: string,
    options?: {
      routeUnit?: SessionRouteUnitFeedback | null;
    },
  ) => {
    setSessionMessage(message, 'info', options);
  }, [setSessionMessage]);

  const setSessionSuccess = useCallback((
    message: string,
    options?: {
      routeUnit?: SessionRouteUnitFeedback | null;
    },
  ) => {
    setSessionMessage(message, 'success', options);
  }, [setSessionMessage]);

  const setSessionError = useCallback((
    message: string,
    options?: {
      routeUnit?: SessionRouteUnitFeedback | null;
    },
  ) => {
    setSessionMessage(message, 'error', options);
  }, [setSessionMessage]);

  const resetOauthProxySettings = useCallback(() => {
    setOauthCustomProxyEnabled(false);
    setOauthSystemProxyEnabled(false);
    setOauthProxyUrl('');
  }, []);

  const resetImportProxySettings = useCallback((defaultToSystem = false) => {
    setImportCustomProxyEnabled(false);
    setImportSystemProxyEnabled(defaultToSystem);
    setImportProxyUrl('');
  }, []);

  const resetImportState = useCallback(() => {
    setImportJsonText('');
    setImportDrafts([]);
    setImportDragOver(false);
  }, []);

  const closeImportModal = useCallback(() => {
    setImportOpen(false);
    resetImportState();
    resetImportProxySettings(false);
  }, [resetImportProxySettings, resetImportState]);

  const openImportModal = useCallback(() => {
    resetImportState();
    resetImportProxySettings(runtimeSystemProxyConfigured);
    setImportOpen(true);
  }, [resetImportProxySettings, resetImportState, runtimeSystemProxyConfigured]);

  const loadConnections = useCallback(async () => {
    const response = await api.getOAuthConnections({
      limit: CONNECTION_PAGE_LIMIT,
      offset: 0,
    });
    const nextItems = Array.isArray(response?.items) ? response.items : [];
    setConnections(nextItems);
    setSelectedConnectionIds((current) => current.filter((id) => nextItems.some((item) => item.accountId === id)));
    return nextItems;
  }, []);

  const load = useCallback(async () => {
    try {
      const [providersResponse] = await Promise.all([
        api.getOAuthProviders(),
        loadConnections(),
      ]);
      const nextProviders = Array.isArray(providersResponse?.providers) ? providersResponse.providers : [];
      setRuntimeSystemProxyConfigured(providersResponse?.defaults?.systemProxyConfigured === true);
      setProviders(nextProviders);
      setSelectedProviderKey((current) => current || nextProviders[0]?.provider || '');
    } catch (error: any) {
      console.error('failed to load oauth management data', error);
      setSessionError(error?.message || 'OAuth 管理数据加载失败');
    } finally {
      setLoaded(true);
    }
  }, [loadConnections]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (autoRefreshSeconds <= 0) {
      setAutoRefreshCountdown(0);
      return undefined;
    }

    setAutoRefreshCountdown(autoRefreshSeconds);
    const timer = setInterval(() => {
      setAutoRefreshCountdown((current) => {
        if (current <= 1) {
          void loadConnections().catch((error: any) => {
            setSessionError(error?.message || 'OAuth 连接列表刷新失败');
          });
          return autoRefreshSeconds;
        }
        return current - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [autoRefreshSeconds, loadConnections]);

  useEffect(() => {
    if (!loaded || providers.length === 0 || createIntentHandledRef.current) return;
    const params = new URLSearchParams(location.search);
    if (params.get('create') !== '1') return;

    createIntentHandledRef.current = true;
    const provider = asTrimmedString(params.get('provider')) || providers[0]?.provider || '';
    setDrawerIntent({ mode: 'create', provider });
    setSelectedProviderKey(provider);
    setDrawerProjectId('');
    setDrawerOpen(true);
    setSessionInfo('从建站流程跳转到 OAuth 管理，请在这里完成授权。');
  }, [loaded, location.search, providers]);

  useEffect(() => {
    if (!activeSession) return undefined;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const session = await api.getOAuthSession(activeSession.state);
        if (cancelled) return;

        if (session.status === 'pending') {
          setSessionInfo('等待授权完成');
          timer = setTimeout(poll, POLL_INTERVAL_MS);
          return;
        }

        if (session.status === 'success') {
          setSessionSuccess('授权成功');
          await loadConnections();
          setActiveSession(null);
          return;
        }

        setSessionError(`授权失败：${session.error || '未知错误'}`);
        setActiveSession(null);
      } catch (error: any) {
        if (cancelled) return;
        setSessionError(error?.message || 'OAuth 会话状态查询失败');
        setActiveSession(null);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeSession, loadConnections]);

  useEffect(() => {
    if (!activeSession) {
      setManualCallbackVisible(false);
      setManualCallbackUrl('');
      setManualCallbackSubmitting(false);
      return undefined;
    }

    setManualCallbackVisible(false);
    setManualCallbackUrl('');
    setManualCallbackSubmitting(false);

    const timer = setTimeout(() => {
      setManualCallbackVisible(true);
    }, Math.max(0, activeSession.instructions.manualCallbackDelayMs || 0));

    return () => clearTimeout(timer);
  }, [activeSession]);

  const providerOptions = useMemo(
    () => providers.map((provider) => ({
      value: provider.provider,
      label: provider.label,
      description: `${provider.platform}${provider.requiresProjectId ? ' · 可选 Project ID' : ''}${!provider.enabled ? ' · 当前环境未启用' : ''}`,
    })),
    [providers],
  );

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.provider === selectedProviderKey) || null,
    [providers, selectedProviderKey],
  );

  const siteOptions = useMemo(() => {
    const seen = new Map<string, string>();
    connections.forEach((connection) => {
      const id = String(connection.site?.id || '');
      const label = asTrimmedString(connection.site?.name) || asTrimmedString(connection.site?.url);
      if (id && label && !seen.has(id)) {
        seen.set(id, label);
      }
    });
    return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
  }, [connections]);

  const filteredConnections = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    return connections.filter((connection) => {
      if (providerFilter && connection.provider !== providerFilter) return false;
      if (statusFilter && connection.status !== statusFilter) return false;
      if (siteFilter && String(connection.site?.id || '') !== siteFilter) return false;
      if (!search) return true;
      const haystack = [
        resolveConnectionPrimaryTitle(connection),
        resolveConnectionEmailLabel(connection),
        connection.provider,
        connection.site?.name,
        connection.site?.url,
        connection.accountKey,
        connection.projectId,
        connection.modelsPreview.join(' '),
      ].join(' ').toLowerCase();
      return haystack.includes(search);
    });
  }, [connections, providerFilter, searchQuery, siteFilter, statusFilter]);

  const allVisibleSelected = filteredConnections.length > 0
    && filteredConnections.every((connection) => selectedConnectionIds.includes(connection.accountId));

  const selectedConnections = useMemo(
    () => connections.filter((connection) => selectedConnectionIds.includes(connection.accountId)),
    [connections, selectedConnectionIds],
  );

  const selectedRouteUnitParticipation = useMemo(() => {
    if (selectedConnections.length <= 0) return null;
    const participations = selectedConnections.map(resolveConnectionRouteParticipation);
    if (participations.some((item) => item.kind !== 'route_unit')) return null;
    const first = participations[0];
    if (!first || first.kind !== 'route_unit') return null;
    const routeUnitId = first.routeUnitId ?? first.id;
    if (!routeUnitId) return null;
    const allSameRouteUnit = participations.every((item) => (
      item.kind === 'route_unit'
      && (item.routeUnitId ?? item.id) === routeUnitId
    ));
    if (!allSameRouteUnit) return null;

    const totalRouteUnitMembers = connections.filter((connection) => {
      const participation = resolveConnectionRouteParticipation(connection);
      return participation.kind === 'route_unit'
        && (participation.routeUnitId ?? participation.id) === routeUnitId;
    }).length;
    if (totalRouteUnitMembers !== selectedConnections.length) return null;

    return {
      ...first,
      memberCount: Math.max(first.memberCount, totalRouteUnitMembers),
    };
  }, [connections, selectedConnections]);

  const canMergeSelectedIntoRouteUnit = useMemo(() => {
    if (selectedConnections.length < 2) return false;
    const first = selectedConnections[0];
    if (!first) return false;
    const firstSiteId = first.siteId;
    const firstProvider = first.provider;
    return selectedConnections.every((connection) => (
      connection.siteId === firstSiteId
      && connection.provider === firstProvider
      && resolveConnectionRouteParticipation(connection).kind === 'single'
    ));
  }, [selectedConnections]);

  const canSplitSelectedRouteUnit = selectedRouteUnitParticipation != null;

  const openCreateDrawer = (provider?: string) => {
    setDrawerIntent({ mode: 'create', provider });
    setSelectedProviderKey(provider || providers[0]?.provider || '');
    setDrawerProjectId('');
    resetOauthProxySettings();
    setDrawerOpen(true);
    setShowColumnMenu(false);
  };

  const openRebindDrawer = (connection: OAuthConnectionInfo) => {
    setDrawerIntent({ mode: 'rebind', account: connection });
    setSelectedProviderKey(connection.provider);
    setDrawerProjectId(connection.projectId || '');
    resetOauthProxySettings();
    setDrawerOpen(true);
    setShowColumnMenu(false);
  };

  const openProxySettingsDrawer = (connection: OAuthConnectionInfo) => {
    setDrawerIntent({ mode: 'proxy', account: connection });
    setSelectedProviderKey(connection.provider);
    setDrawerProjectId(connection.projectId || '');
    setOauthSystemProxyEnabled(connection.useSystemProxy === true);
    setOauthCustomProxyEnabled(connection.useSystemProxy !== true && !!asTrimmedString(connection.proxyUrl));
    setOauthProxyUrl(connection.useSystemProxy ? '' : asTrimmedString(connection.proxyUrl));
    setDrawerOpen(true);
    setShowColumnMenu(false);
    setSessionInfo('已打开 OAuth 代理设置，修改后可直接保存代理，或保存后重新授权。');
  };

  const openRouteUnitModal = () => {
    setRouteUnitModal({
      open: true,
      name: '',
      strategy: 'round_robin',
    });
  };

  const closeRouteUnitModal = () => {
    setRouteUnitModal((current) => ({
      ...current,
      open: false,
    }));
  };

  const resolveProxySettingsPayload = ({
    customEnabled,
    systemEnabled,
    proxyValue,
    fallbackAccount,
    clearToSiteFallback = false,
  }: {
    customEnabled: boolean;
    systemEnabled: boolean;
    proxyValue: string;
    fallbackAccount?: OAuthConnectionInfo | null;
    clearToSiteFallback?: boolean;
  }): { proxyUrl?: string | null; useSystemProxy?: boolean } => {
    const customProxyUrl = asTrimmedString(proxyValue);
    if (customEnabled) {
      return {
        proxyUrl: customProxyUrl,
        useSystemProxy: false,
      };
    }
    if (systemEnabled) {
      return {
        proxyUrl: null,
        useSystemProxy: true,
      };
    }
    if (clearToSiteFallback) {
      return {
        proxyUrl: null,
        useSystemProxy: false,
      };
    }
    if (fallbackAccount?.useSystemProxy) {
      return {
        proxyUrl: null,
        useSystemProxy: true,
      };
    }
    if (fallbackAccount?.proxyUrl !== undefined) {
      return {
        proxyUrl: asTrimmedString(fallbackAccount.proxyUrl) || null,
        useSystemProxy: false,
      };
    }
    return {};
  };

  const handleSaveProxy = async () => {
    if (drawerIntent.mode !== 'proxy') return;
    const customProxyUrl = asTrimmedString(oauthProxyUrl);
    if (oauthCustomProxyEnabled && !customProxyUrl) {
      setSessionError('已开启代理，请先输入完整代理地址');
      return;
    }

    const actionKey = `save-proxy:${drawerIntent.account.accountId}`;
    setActionLoadingKey(actionKey);
    try {
      await api.updateOAuthConnectionProxy(
        drawerIntent.account.accountId,
        resolveProxySettingsPayload({
          customEnabled: oauthCustomProxyEnabled,
          systemEnabled: oauthSystemProxyEnabled,
          proxyValue: oauthProxyUrl,
          clearToSiteFallback: true,
        }),
      );
      await loadConnections();
      setDrawerOpen(false);
      resetOauthProxySettings();
      setSessionSuccess('代理已保存');
    } catch (error: any) {
      setSessionError(error?.message || '保存代理失败');
    } finally {
      setActionLoadingKey('');
    }
  };

  const handleStart = async () => {
    const provider = selectedProvider
      || (drawerIntent.mode === 'create'
        ? providers.find((item) => item.provider === drawerIntent.provider)
        : null)
      || providers[0]
      || null;
    if (!provider) {
      setSessionError('当前没有可用的 OAuth Provider。');
      return;
    }
    if (!provider.enabled) {
      setSessionError(`${provider.label} 当前环境未启用`);
      return;
    }

    const rebindAccount = drawerIntent.mode === 'create' ? null : drawerIntent.account;
    const accountId = rebindAccount?.accountId;
    const customProxyUrl = asTrimmedString(oauthProxyUrl);
    if (oauthCustomProxyEnabled && !customProxyUrl) {
      setSessionError('已开启代理，请先输入完整代理地址');
      return;
    }

    const proxySettings = resolveProxySettingsPayload({
      customEnabled: oauthCustomProxyEnabled,
      systemEnabled: oauthSystemProxyEnabled,
      proxyValue: oauthProxyUrl,
      fallbackAccount: rebindAccount,
      clearToSiteFallback: drawerIntent.mode === 'proxy',
    });

    const actionKey = `start:${provider.provider}:${accountId || 0}`;
    setActionLoadingKey(actionKey);
    try {
      const projectId = drawerIntent.mode === 'create' && provider.requiresProjectId
        ? (asTrimmedString(drawerProjectId) || undefined)
        : undefined;
      const started = accountId
        ? await api.rebindOAuthConnection(
          accountId,
          {
            ...proxySettings,
          },
        )
        : await api.startOAuthProvider(provider.provider, {
          projectId,
          ...proxySettings,
        });

      setSessionInfo('等待授权完成');
      setActiveSession({
        provider: started.provider,
        state: started.state,
        authorizationUrl: started.authorizationUrl,
        instructions: started.instructions,
      });
      resetOauthProxySettings();
      openOAuthPopup(provider.provider, started.authorizationUrl);
    } catch (error: any) {
      setSessionError(error?.message || '无法启动 OAuth 授权');
    } finally {
      setActionLoadingKey('');
    }
  };

  const handleSubmitManualCallback = async () => {
    if (!activeSession) return;
    const callbackUrl = manualCallbackUrl.trim();
    if (!callbackUrl) {
      setSessionError('请输入完整的回调 URL');
      return;
    }
    setManualCallbackSubmitting(true);
    try {
      await api.submitOAuthManualCallback(activeSession.state, callbackUrl);
      setSessionInfo('回调已提交，等待授权完成');
    } catch (error: any) {
      setSessionError(error?.message || '提交回调 URL 失败');
    } finally {
      setManualCallbackSubmitting(false);
    }
  };

  const handleDelete = async (accountId: number) => {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      const confirmed = window.confirm('确定要删除这个 OAuth 连接吗？');
      if (!confirmed) return;
    }
    const actionKey = `delete:${accountId}`;
    setActionLoadingKey(actionKey);
    try {
      await api.deleteOAuthConnection(accountId);
      setSessionSuccess('连接已删除');
      await loadConnections();
      setSelectedConnectionIds((current) => current.filter((id) => id !== accountId));
    } catch (error: any) {
      setSessionError(error?.message || '删除 OAuth 连接失败');
    } finally {
      setActionLoadingKey('');
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedConnectionIds.length === 0) return;
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      const confirmed = window.confirm(`确定要删除选中的 ${selectedConnectionIds.length} 个 OAuth 连接吗？`);
      if (!confirmed) return;
    }
    setActionLoadingKey('delete:selected');
    try {
      const results = await Promise.allSettled(selectedConnectionIds.map((accountId) => api.deleteOAuthConnection(accountId)));
      const failed = results.filter((item) => item.status === 'rejected').length;
      await loadConnections();
      setSelectedConnectionIds([]);
      if (failed > 0) {
        setSessionInfo(`批量删除完成，${failed} 个连接删除失败`);
      } else {
        setSessionSuccess(`已删除 ${results.length} 个 OAuth 连接`);
      }
    } finally {
      setActionLoadingKey('');
    }
  };

  const handleRefreshQuota = async (accountId: number) => {
    const actionKey = `quota:${accountId}`;
    setActionLoadingKey(actionKey);
    try {
      await api.refreshOAuthConnectionQuota(accountId);
      setSessionSuccess('额度信息已刷新');
      await loadConnections();
    } catch (error: any) {
      setSessionError(error?.message || '刷新额度失败');
    } finally {
      setActionLoadingKey('');
    }
  };

  const handleRefreshSelected = async () => {
    if (selectedConnectionIds.length === 0) return;
    setActionLoadingKey('quota:selected');
    try {
      const result = await api.refreshOAuthConnectionQuotaBatch(selectedConnectionIds);
      await loadConnections();
      if (result.failed > 0) {
        setSessionInfo(`批量刷新完成，成功 ${result.refreshed} 个，失败 ${result.failed} 个`);
      } else {
        setSessionSuccess(`已批量刷新 ${result.refreshed} 个 OAuth 连接`);
      }
    } catch (error: any) {
      setSessionError(error?.message || '批量刷新额度失败');
    } finally {
      setActionLoadingKey('');
    }
  };

  const applyLoadedModelsModal = useCallback((connection: OAuthConnectionInfo, result: any) => {
    const models = Array.isArray(result?.models) ? result.models as OAuthModelItem[] : [];
    setModelsModal((current) => ({
      ...current,
      open: true,
      loading: false,
      refreshing: false,
      connection,
      models,
      totalCount: Number.isFinite(result?.totalCount) ? Number(result.totalCount) : models.length,
      disabledCount: Number.isFinite(result?.disabledCount)
        ? Number(result.disabledCount)
        : models.filter((item) => item.disabled).length,
      siteName: asTrimmedString(result?.siteName) || connection.site?.name || '',
    }));
  }, []);

  const loadModelsModal = useCallback(async (
    connection: OAuthConnectionInfo,
    options: {
      refreshUpstream?: boolean;
      resetBeforeLoad?: boolean;
      closeOnError?: boolean;
    } = {},
  ) => {
    const requestId = ++modelsModalRequestSeqRef.current;
    setModelsModal((current) => ({
      ...current,
      open: true,
      connection,
      loading: options.resetBeforeLoad ? true : current.loading,
      refreshing: options.refreshUpstream ? true : current.refreshing,
      ...(options.resetBeforeLoad
        ? { models: [], totalCount: 0, disabledCount: 0, siteName: connection.site?.name || '' }
        : {}),
    }));

    try {
      if (options.refreshUpstream) {
        await api.checkModels(connection.accountId);
      }
      const result = await api.getAccountModels(connection.accountId);
      if (modelsModalRequestSeqRef.current !== requestId) return;
      applyLoadedModelsModal(connection, result);
      if (options.refreshUpstream) {
        await loadConnections();
        setSessionSuccess('模型列表已刷新');
      }
    } catch (error: any) {
      if (modelsModalRequestSeqRef.current !== requestId) return;
      setSessionError(error?.message || '加载模型列表失败');
      setModelsModal((current) => (
        options.closeOnError
          ? {
            ...current,
            open: false,
            loading: false,
            refreshing: false,
            connection: null,
          }
          : {
            ...current,
            loading: false,
            refreshing: false,
          }
      ));
    }
  }, [applyLoadedModelsModal, loadConnections]);

  const openModelsModal = useCallback(async (connection: OAuthConnectionInfo) => {
    await loadModelsModal(connection, {
      resetBeforeLoad: true,
      closeOnError: true,
    });
  }, [loadModelsModal]);

  const closeModelsModal = useCallback(() => {
    modelsModalRequestSeqRef.current += 1;
    setModelsModal((current) => ({
      ...current,
      open: false,
      loading: false,
      refreshing: false,
      connection: null,
    }));
  }, []);

  const handleImportFilesSelected = useCallback(async (files: ArrayLike<OAuthImportFileLike> | null | undefined) => {
    const drafts = await readOauthImportDrafts(files);
    setImportDrafts(drafts);
  }, []);

  const handleImportFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    await handleImportFilesSelected(event.target.files);
    event.target.value = '';
  }, [handleImportFilesSelected]);

  const handleImportDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setImportDragOver(true);
  }, []);

  const handleImportDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setImportDragOver(false);
  }, []);

  const handleImportDrop = useCallback(async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setImportDragOver(false);
    await handleImportFilesSelected(event.dataTransfer?.files);
  }, [handleImportFilesSelected]);

  const importSources = useMemo<OAuthImportSource[]>(() => {
    const manualRaw = importJsonText.trim();
    return [
      ...importDrafts,
      ...(manualRaw ? [{ sourceName: '手动粘贴 JSON', rawText: manualRaw }] : []),
    ];
  }, [importDrafts, importJsonText]);

  const importPreviewSummary = useMemo<OAuthImportPreviewSummary | null>(() => {
    if (importSources.length <= 0) return null;
    const items = importSources.map((source) => parseOauthImportPreview(source));
    const validCount = items.filter((item) => item.valid).length;
    const invalidCount = items.length - validCount;
    return {
      totalCount: items.length,
      validCount,
      invalidCount,
      canImport: validCount > 0 && invalidCount === 0,
      items,
    };
  }, [importSources]);

  const handleImport = async () => {
    if (importSources.length <= 0) {
      setSessionError('请先选择 JSON 文件或粘贴 OAuth 连接 JSON 内容');
      return;
    }
    if (!importPreviewSummary?.canImport) {
      setSessionError('请先修正无效的 OAuth JSON');
      return;
    }
    if (importCustomProxyEnabled && !asTrimmedString(importProxyUrl)) {
      setSessionError('已开启代理，请先输入完整代理地址');
      return;
    }

    setImporting(true);
    try {
      const parsedItems = importPreviewSummary.items
        .filter((item) => item.valid && item.parsedData)
        .map((item) => item.parsedData as Record<string, unknown>);
      const importProxySettings = importSystemProxyEnabled && !importCustomProxyEnabled
        ? { useSystemProxy: true as const }
        : resolveProxySettingsPayload({
          customEnabled: importCustomProxyEnabled,
          systemEnabled: importSystemProxyEnabled,
          proxyValue: importProxyUrl,
        });
      const result = parsedItems.length === 1
        && !('proxyUrl' in importProxySettings)
        && !('useSystemProxy' in importProxySettings)
        ? await api.importOAuthConnections(parsedItems[0]!)
        : await api.importOAuthConnections({
          items: parsedItems,
          ...importProxySettings,
        });

      await loadConnections();
      const importMessage = result.failed > 0
        ? `批量导入完成，成功 ${result.imported} 个，失败 ${result.failed} 个`
        : `已添加 ${result.imported} 个 OAuth 连接`;
      if (result.failed > 0) {
        toast.info(importMessage);
      } else {
        toast.success(importMessage);
      }
      if (result.failed > 0) {
        setSessionInfo(importMessage);
      } else {
        setSessionSuccess(importMessage);
      }
      closeImportModal();
    } catch (error: any) {
      const message = error?.message || '导入 OAuth JSON 失败';
      toast.error(message);
      setSessionError(message);
    } finally {
      setImporting(false);
    }
  };

  const handleCreateRouteUnit = async () => {
    const name = asTrimmedString(routeUnitModal.name);
    if (!canMergeSelectedIntoRouteUnit || selectedConnections.length < 2) return;
    if (!name) {
      setSessionError('请先输入路由池名称');
      return;
    }

    setActionLoadingKey('route-unit:create');
    try {
      const result = await api.createOAuthRouteUnit({
        accountIds: selectedConnections.map((connection) => connection.accountId),
        name,
        strategy: routeUnitModal.strategy,
      });
      const routeUnitDefaults: SessionRouteUnitFeedback = {
        action: 'created' as const,
        name: asTrimmedString(name) || name,
        memberCount: selectedConnections.length,
        strategy: routeUnitModal.strategy,
      };
      const routeUnit: SessionRouteUnitFeedback = result.routeUnit
        ? {
          ...routeUnitDefaults,
          name: asTrimmedString(result.routeUnit.name) || routeUnitDefaults.name,
          memberCount: result.routeUnit.memberCount || routeUnitDefaults.memberCount,
          strategy: result.routeUnit.strategy || routeUnitDefaults.strategy,
        }
        : routeUnitDefaults;
      toast.success(`已创建路由池：${routeUnit.name}`);
      setSessionSuccess('已创建路由池', {
        routeUnit,
      });
      setSelectedConnectionIds([]);
      closeRouteUnitModal();
      try {
        await loadConnections();
      } catch {
        toast.error('OAuth 连接列表刷新失败');
        setSessionError('已创建路由池，但连接列表刷新失败', {
          routeUnit,
        });
      }
    } catch (error: any) {
      const message = error?.message || '创建路由池失败';
      toast.error(message);
      setSessionError(message);
    } finally {
      setActionLoadingKey('');
    }
  };

  const handleDeleteSelectedRouteUnit = async () => {
    if (!selectedRouteUnitParticipation) return;
    const routeUnitId = selectedRouteUnitParticipation.routeUnitId ?? selectedRouteUnitParticipation.id;
    if (!routeUnitId) return;

    setActionLoadingKey('route-unit:delete');
    try {
      const routeUnitFeedback = {
        action: 'deleted' as const,
        name: selectedRouteUnitParticipation.name,
        memberCount: selectedRouteUnitParticipation.memberCount,
        strategy: selectedRouteUnitParticipation.strategy,
      };
      await api.deleteOAuthRouteUnit(routeUnitId);
      toast.success(`已拆回单体：${routeUnitFeedback.name}`);
      setSessionSuccess('已拆回单体', {
        routeUnit: routeUnitFeedback,
      });
      setSelectedConnectionIds([]);
      try {
        await loadConnections();
      } catch {
        toast.error('OAuth 连接列表刷新失败');
        setSessionError('已拆回单体，但连接列表刷新失败', {
          routeUnit: routeUnitFeedback,
        });
      }
    } catch (error: any) {
      const message = error?.message || '拆回单体失败';
      toast.error(message);
      setSessionError(message);
    } finally {
      setActionLoadingKey('');
    }
  };

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const toggleSelectAllVisible = (checked: boolean) => {
    if (!checked) {
      setSelectedConnectionIds((current) => current.filter((id) => !filteredConnections.some((connection) => connection.accountId === id)));
      return;
    }
    setSelectedConnectionIds((current) => Array.from(new Set([
      ...current,
      ...filteredConnections.map((connection) => connection.accountId),
    ])));
  };

  const filterBar = (
    <Card>
      <CardContent className="grid gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
            <SearchInput
              className="min-w-64 flex-1"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索账号 / 邮箱 / 站点 / 项目"
            />
            <div className="w-44">
              <ModernSelect
                size="sm"
                value={providerFilter}
                onChange={(value) => setProviderFilter(String(value || ''))}
                options={[
                  { value: '', label: '全部 Provider' },
                  ...providerOptions,
                ]}
                placeholder="全部 Provider"
              />
            </div>
            <div className="w-40">
              <ModernSelect
                size="sm"
                value={statusFilter}
                onChange={(value) => setStatusFilter(String(value || ''))}
                options={[
                  { value: '', label: '全部状态' },
                  { value: 'healthy', label: '正常' },
                  { value: 'abnormal', label: '异常' },
                ]}
                placeholder="全部状态"
              />
            </div>
            <div className="w-56">
              <ModernSelect
                size="sm"
                value={siteFilter}
                onChange={(value) => setSiteFilter(String(value || ''))}
                options={[
                  { value: '', label: '全部站点' },
                  ...siteOptions,
                ]}
                placeholder="全部站点"
              />
            </div>
            <div className="w-44">
              <ModernSelect
                size="sm"
                value={String(autoRefreshSeconds)}
                onChange={(value) => setAutoRefreshSeconds(Number(value || 0))}
                options={AUTO_REFRESH_OPTIONS.map((seconds) => ({
                  value: String(seconds),
                  label: seconds === 0 ? '自动刷新：关闭' : `自动刷新：${seconds}s`,
                }))}
                placeholder="自动刷新"
              />
            </div>
            {autoRefreshSeconds > 0 ? (
              <div className="text-sm text-muted-foreground">下次刷新 {autoRefreshCountdown}s</div>
            ) : null}
            <DropdownMenu.Root open={showColumnMenu} onOpenChange={setShowColumnMenu}>
              <DropdownMenu.Trigger asChild>
                <Button variant="outline" type="button">
                  列设置
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Label>显示列</DropdownMenu.Label>
                <DropdownMenu.Separator />
                {COLUMN_OPTIONS.map((column) => (
                  <DropdownMenu.CheckboxItem
                    key={column.key}
                    checked={visibleColumns[column.key]}
                    onCheckedChange={() => toggleColumn(column.key)}
                  >
                    {column.label}
                  </DropdownMenu.CheckboxItem>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
        </div>
        <div className="text-sm text-muted-foreground">
          OAuth 账号以后只在这里维护。连接管理页默认只保留普通 Session / API Key / Token 连接。
        </div>
      </CardContent>
    </Card>
  );

  const mobileFilterContent = (
    <div className="grid gap-3">
      <Input
        type="text"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder="搜索账号 / 邮箱 / 站点 / 项目"
      />
      <ModernSelect
        size="sm"
        value={providerFilter}
        onChange={(value) => setProviderFilter(String(value || ''))}
        options={[
          { value: '', label: '全部 Provider' },
          ...providerOptions,
        ]}
        placeholder="全部 Provider"
      />
      <ModernSelect
        size="sm"
        value={statusFilter}
        onChange={(value) => setStatusFilter(String(value || ''))}
        options={[
          { value: '', label: '全部状态' },
          { value: 'healthy', label: '正常' },
          { value: 'abnormal', label: '异常' },
        ]}
        placeholder="全部状态"
      />
      <ModernSelect
        size="sm"
        value={siteFilter}
        onChange={(value) => setSiteFilter(String(value || ''))}
        options={[
          { value: '', label: '全部站点' },
          ...siteOptions,
        ]}
        placeholder="全部站点"
      />
      <ModernSelect
        size="sm"
        value={String(autoRefreshSeconds)}
        onChange={(value) => setAutoRefreshSeconds(Number(value || 0))}
        options={AUTO_REFRESH_OPTIONS.map((seconds) => ({
          value: String(seconds),
          label: seconds === 0 ? '自动刷新：关闭' : `自动刷新：${seconds}s`,
        }))}
        placeholder="自动刷新"
      />
    </div>
  );

  const desktopTable = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              data-testid="oauth-select-all"
              checked={allVisibleSelected}
              onCheckedChange={(checked) => toggleSelectAllVisible(checked === true)}
            />
          </TableHead>
          {visibleColumns.identity ? <TableHead>账号</TableHead> : null}
          {visibleColumns.site ? <TableHead>站点</TableHead> : null}
          {visibleColumns.status ? <TableHead>状态</TableHead> : null}
          {visibleColumns.quota ? <TableHead>额度</TableHead> : null}
          {visibleColumns.proxy ? <TableHead>计划 / 代理</TableHead> : null}
          <TableHead>操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filteredConnections.map((connection) => {
          const quota = connection.quota;
          const emailLabel = resolveConnectionEmailLabel(connection);
          const primaryTitle = resolveConnectionPrimaryTitle(connection);
          const sitePlatform = asTrimmedString(connection.site?.platform);
          const modelSyncDetail = resolveModelSyncDetail(connection);
          const quotaSyncDetail = resolveQuotaSyncDetail(quota);
          return (
            <TableRow key={connection.accountId}>
              <TableCell>
                <Checkbox
                  checked={selectedConnectionIds.includes(connection.accountId)}
                  onCheckedChange={(nextChecked) => {
                    const checked = nextChecked === true;
                    setSelectedConnectionIds((current) => checked
                      ? Array.from(new Set([...current, connection.accountId]))
                      : current.filter((id) => id !== connection.accountId));
                  }}
                />
              </TableCell>
              {visibleColumns.identity ? (
                <TableCell>
                  <div className="grid gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="ghost" size="sm"
                        type="button"
                        title={primaryTitle}
                        onClick={() => void openModelsModal(connection)}
                      >
                        {primaryTitle}
                      </Button>
                      <ToneBadge tone={connection.provider === 'codex' ? 'info' : 'primary'}>
                        {connection.provider}
                      </ToneBadge>
                      <ToneBadge tone={connection.status === 'abnormal' ? 'warning' : 'success'}>
                        {resolveConnectionStatusLabel(connection.status)}
                      </ToneBadge>
                    </div>
                    {emailLabel && emailLabel !== primaryTitle ? (
                      <div className="text-sm text-muted-foreground" title={emailLabel}>{emailLabel}</div>
                    ) : null}
                    {connection.accountKey ? (
                      <div className="text-xs text-muted-foreground" title={connection.accountKey}>
                        连接: {compactAccountKey(connection.accountKey)}
                      </div>
                    ) : null}
                  </div>
                </TableCell>
              ) : null}
              {visibleColumns.site ? (
                <TableCell>
                  <div className="grid gap-1">
                    <div className="font-medium" title={connection.site?.name || '--'}>
                      {connection.site?.name || '--'}
                    </div>
                    {sitePlatform && sitePlatform !== connection.provider ? (
                      <div className="text-sm text-muted-foreground">{sitePlatform}</div>
                    ) : null}
                  </div>
                </TableCell>
              ) : null}
              {visibleColumns.status ? (
                <TableCell>
                  <div className="grid gap-2 text-sm">
                    <div className="grid gap-1">
                      <div className="flex items-center gap-2">
                        <div className="text-xs font-medium text-muted-foreground">模型</div>
                        <div title={modelSyncDetail || resolveModelSyncStatusText(connection)}>
                          {resolveModelSyncStatusText(connection)}
                        </div>
                      </div>
                      {modelSyncDetail ? (
                        <div className="text-xs text-muted-foreground" title={modelSyncDetail}>{modelSyncDetail}</div>
                      ) : null}
                    </div>
                    <div className="grid gap-1">
                      <div className="flex items-center gap-2">
                        <div className="text-xs font-medium text-muted-foreground">额度</div>
                        <div title={quotaSyncDetail || resolveQuotaSyncStatusText(quota)}>
                          {resolveQuotaSyncStatusText(quota)}
                        </div>
                      </div>
                      {quotaSyncDetail ? (
                        <div className="text-xs text-muted-foreground" title={quotaSyncDetail}>{quotaSyncDetail}</div>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
              ) : null}
              {visibleColumns.quota ? (
                <TableCell>
                  {quota ? (
                    <div className="grid gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <ToneBadge tone={quota.status === 'error' ? 'warning' : quota.status === 'unsupported' ? 'muted' : 'info'}>
                          {resolveQuotaStatusLabel(quota.status)}
                        </ToneBadge>
                        <span className="text-xs text-muted-foreground">{resolveQuotaSourceLabel(quota.source)}</span>
                      </div>
                      <QuotaWindowRow label="5h" window={quota.windows?.fiveHour} />
                      <QuotaWindowRow label="7d" window={quota.windows?.sevenDay} />
                    </div>
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                </TableCell>
              ) : null}
              {visibleColumns.proxy ? (
                <TableCell>
                  <div className="grid gap-1 text-sm">
                    <div className="text-muted-foreground">{resolveProxyProjectSummary(connection)}</div>
                    <div className="text-muted-foreground">{resolveRouteParticipationSummary(connection)}</div>
                    <div className="text-xs text-muted-foreground">{resolveProxyDisplayText(connection)}</div>
                    <Button variant="ghost" size="sm"
                      type="button"
                      onClick={() => openProxySettingsDrawer(connection)}
                    >
                      {hasOauthProxySelection(connection) ? '代理设置' : '设置代理'}
                    </Button>
                  </div>
                </TableCell>
              ) : null}
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm"
                    type="button"
                    onClick={() => void openModelsModal(connection)}
                  >
                    {connection.modelCount} 个模型
                  </Button>
                  <Button variant="ghost" size="sm"
                    type="button"
                    onClick={() => handleRefreshQuota(connection.accountId)}
                    disabled={actionLoadingKey === `quota:${connection.accountId}`}
                  >
                    {actionLoadingKey === `quota:${connection.accountId}` ? '刷新中...' : '刷新额度'}
                  </Button>
                  <Button variant="ghost" size="sm"
                    type="button"
                    onClick={() => openRebindDrawer(connection)}
                  >
                    重新授权
                  </Button>
                  <Button variant="destructive" size="sm"
                    type="button"
                    onClick={() => handleDelete(connection.accountId)}
                    disabled={actionLoadingKey === `delete:${connection.accountId}`}
                  >
                    {actionLoadingKey === `delete:${connection.accountId}` ? '删除中...' : '删除连接'}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  const mobileList = (
    <div className="grid gap-3">
      {filteredConnections.map((connection) => {
        const quota = connection.quota;
        return (
          <MobileCard
            key={connection.accountId}
            title={resolveConnectionPrimaryTitle(connection)}
            subtitle={`${connection.provider} · ${resolveConnectionStatusLabel(connection.status)}`}
            headerActions={(
              <Checkbox
                checked={selectedConnectionIds.includes(connection.accountId)}
                onCheckedChange={(nextChecked) => {
                  const checked = nextChecked === true;
                  setSelectedConnectionIds((current) => checked
                    ? Array.from(new Set([...current, connection.accountId]))
                    : current.filter((id) => id !== connection.accountId));
                }}
              />
            )}
          >
            <MobileField label="站点" value={connection.site?.name || '--'} />
            <MobileField label="邮箱" value={resolveConnectionEmailLabel(connection) || '--'} />
            <MobileField label="计划 / 项目" value={connection.projectId ? `${connection.planType || '--'} · ${connection.projectId}` : (connection.planType || '--')} />
            <MobileField label="路由参与" value={resolveRouteParticipationSummary(connection)} />
            <MobileField
              label="账号代理"
              value={(
                <div className="grid gap-2">
                  <div className="text-xs text-muted-foreground">{resolveProxyDisplayText(connection)}</div>
                  <Button variant="ghost" size="sm"
                    type="button"
                    onClick={() => openProxySettingsDrawer(connection)}
                  >
                    {hasOauthProxySelection(connection) ? '代理设置' : '设置代理'}
                  </Button>
                </div>
              )}
              stacked
            />
            <MobileField
              label="运行状态"
              value={(
                <div className="grid gap-2 text-sm">
                  <div className="grid gap-1">
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-medium text-muted-foreground">模型</div>
                      <div>{resolveModelSyncStatusText(connection)}</div>
                    </div>
                    {resolveModelSyncDetail(connection) ? (
                      <div className="text-xs text-muted-foreground">{resolveModelSyncDetail(connection)}</div>
                    ) : null}
                  </div>
                  <div className="grid gap-1">
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-medium text-muted-foreground">额度</div>
                      <div>{resolveQuotaSyncStatusText(quota)}</div>
                    </div>
                    {resolveQuotaSyncDetail(quota) ? (
                      <div className="text-xs text-muted-foreground">{resolveQuotaSyncDetail(quota)}</div>
                    ) : null}
                  </div>
                </div>
              )}
              stacked
            />
            <div className="grid gap-2 pt-3">
              <div className="text-xs font-medium text-muted-foreground">Usage / Quota</div>
              {quota ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <ToneBadge tone={quota.status === 'error' ? 'warning' : quota.status === 'unsupported' ? 'muted' : 'info'}>
                      {resolveQuotaStatusLabel(quota.status)}
                    </ToneBadge>
                    <span className="text-xs text-muted-foreground">{resolveQuotaSourceLabel(quota.source)}</span>
                  </div>
                  <QuotaWindowRow label="5h" window={quota.windows?.fiveHour} />
                  <QuotaWindowRow label="7d" window={quota.windows?.sevenDay} />
                </>
              ) : (
                <div className="text-muted-foreground">--</div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 pt-3">
              <Button variant="ghost" size="sm" type="button" onClick={() => void openModelsModal(connection)}>
                {connection.modelCount} 个模型
              </Button>
              <Button variant="ghost" size="sm" type="button" onClick={() => handleRefreshQuota(connection.accountId)}>
                刷新额度
              </Button>
              <Button variant="ghost" size="sm" type="button" onClick={() => openProxySettingsDrawer(connection)}>
                代理设置
              </Button>
              <Button variant="ghost" size="sm" type="button" onClick={() => openRebindDrawer(connection)}>
                重新授权
              </Button>
              <Button variant="destructive" size="sm" type="button" onClick={() => handleDelete(connection.accountId)}>
                删除连接
              </Button>
            </div>
          </MobileCard>
        );
      })}
    </div>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-2xl font-semibold tracking-tight">OAuth 管理</h2>
          <div className="text-sm text-muted-foreground">
            统一管理需要浏览器授权的官方上游连接。OAuth 账号以后只在这里维护，不再和普通连接管理页重复显示。
          </div>
        </div>
        {!isMobile ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" type="button" onClick={openImportModal}>
              导入 JSON
            </Button>
            <Button type="button" onClick={() => openCreateDrawer()}>
              新建 OAuth 连接
            </Button>
          </div>
        ) : null}
      </div>

      {sessionFeedback ? (
        <Card>
          <CardContent className="grid gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium">{sessionFeedback.message}</div>
            <ToneBadge tone={sessionFeedback.tone === 'success' ? 'success' : sessionFeedback.tone === 'error' ? 'danger' : 'info'}>
              {sessionFeedback.tone === 'success' ? '成功' : sessionFeedback.tone === 'error' ? '失败' : '提示'}
            </ToneBadge>
          </div>
          {sessionFeedback.routeUnit ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <ToneBadge tone="-info">{sessionFeedback.routeUnit.name}</ToneBadge>
              <ToneBadge tone="-muted">{sessionFeedback.routeUnit.memberCount} 个成员</ToneBadge>
              <ToneBadge tone="-muted">{resolveRouteUnitStrategyLabel(sessionFeedback.routeUnit.strategy)}</ToneBadge>
              <div className="text-muted-foreground">
                {sessionFeedback.routeUnit.action === 'created'
                  ? '已将选中的 OAuth 账号合并为一个路由池，后续会以单个路由单元参与路由。'
                  : '该路由池已拆分回单体账号，后续会分别参与路由。'}
              </div>
            </div>
          ) : null}
          </CardContent>
        </Card>
      ) : null}

      <ResponsiveFilterPanel
        isMobile={isMobile}
        mobileOpen={showMobileFilters}
        onMobileOpen={() => setShowMobileFilters(true)}
        onMobileClose={() => setShowMobileFilters(false)}
        mobileTitle="OAuth 筛选与操作"
        mobileContent={mobileFilterContent}
        desktopContent={filterBar}
        mobileTrigger={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline"
              type="button"
              onClick={() => setShowMobileFilters(true)}
            >
              筛选与操作
            </Button>
            <Button type="button" onClick={() => openCreateDrawer()}>
              新建 OAuth 连接
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
            <CardTitle>OAuth 连接列表</CardTitle>
            <CardDescription>
              已连接 {connections.length} 个 OAuth 账号，当前筛选后显示 {filteredConnections.length} 个。
            </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">

        {selectedConnectionIds.length > 0 ? (
          <ResponsiveBatchActionBar isMobile={isMobile} info={`已选 ${selectedConnectionIds.length} 项`}>
            <Button variant="outline"
              type="button"
              onClick={handleRefreshSelected}
              disabled={actionLoadingKey === 'quota:selected'}
            >
              {actionLoadingKey === 'quota:selected' ? '刷新中...' : '批量刷新额度'}
            </Button>
            {canMergeSelectedIntoRouteUnit ? (
              <Button variant="outline"
                type="button"
                onClick={openRouteUnitModal}
              >
                合并参与路由
              </Button>
            ) : null}
            {canSplitSelectedRouteUnit ? (
              <Button variant="outline"
                type="button"
                onClick={handleDeleteSelectedRouteUnit}
                disabled={actionLoadingKey === 'route-unit:delete'}
              >
                {actionLoadingKey === 'route-unit:delete' ? '拆分中...' : '拆回单体'}
              </Button>
            ) : null}
            <Button variant="destructive" size="sm"
              type="button"
              onClick={handleDeleteSelected}
              disabled={actionLoadingKey === 'delete:selected'}
            >
              {actionLoadingKey === 'delete:selected' ? '删除中...' : '批量删除'}
            </Button>
          </ResponsiveBatchActionBar>
        ) : null}

        {!loaded ? (
          <EmptyStateBlock title="加载中..." description="正在加载 OAuth 连接与额度信息。" />
        ) : filteredConnections.length === 0 ? (
          <EmptyStateBlock
            title="暂无 OAuth 连接"
            description="使用右上角“新建 OAuth 连接”接入 Codex、Claude、Gemini CLI 或 Antigravity。"
          />
        ) : (
          isMobile ? mobileList : desktopTable
        )}
        </CardContent>
      </Card>

      <SideDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={drawerIntent.mode === 'create'
          ? '新建 OAuth 连接'
          : drawerIntent.mode === 'proxy'
            ? `代理设置 · ${resolveConnectionPrimaryTitle(drawerIntent.account)}`
            : `重新授权 · ${resolveConnectionPrimaryTitle(drawerIntent.account)}`}
      >
        <div className="grid gap-4">
          <Card>
            <CardContent className="grid gap-4 p-4">
              {drawerIntent.mode === 'create' ? (
                <div className="grid gap-2">
                  <Label>Provider</Label>
                  <ModernSelect
                    value={selectedProviderKey}
                    onChange={(value) => setSelectedProviderKey(String(value || ''))}
                    options={providerOptions}
                    placeholder="选择 OAuth Provider"
                  />
                </div>
              ) : (
                <div className="grid gap-1">
                  <Label>当前连接</Label>
                  <div className="font-medium">
                    {resolveConnectionPrimaryTitle(drawerIntent.account)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {drawerIntent.account.provider}
                    {drawerIntent.account.projectId ? ` · Project ${drawerIntent.account.projectId}` : ''}
                    {drawerIntent.mode === 'proxy'
                      ? ` · ${resolveProxyDisplayText(drawerIntent.account)}`
                      : ''}
                  </div>
                </div>
              )}

              {selectedProvider?.requiresProjectId && drawerIntent.mode === 'create' ? (
                <div className="grid gap-2">
                  <Label>Google Cloud Project ID（可选）</Label>
                  <Input
                    type="text"
                    value={drawerProjectId}
                    onChange={(event) => setDrawerProjectId(event.target.value)}
                    placeholder="留空则交给上游自动解析"
                  />
                </div>
              ) : null}

              <div className="text-sm text-muted-foreground">
                {drawerIntent.mode === 'proxy'
                  ? '这里修改的是账号级 OAuth 代理。点击“保存代理”会立即落库并刷新列表；只有“保存并重新授权”才会重新走授权流程。若两项都不勾选，则回退到站点代理配置。'
                  : '这里的设置会作用于下一次“连接”或“重新授权”。填写代理地址后，本次 OAuth 换 token 和后续生成的账号都会直接带上这份账号级代理配置；若不勾选，则回退到站点代理配置。'}
              </div>

              <div className="grid gap-3">
                <Label className="flex items-center gap-2">
                  <Checkbox
                    checked={oauthSystemProxyEnabled}
                    data-oauth-setting="use-system-proxy"
                    onCheckedChange={(nextChecked) => {
                      const checked = nextChecked === true;
                      setOauthSystemProxyEnabled(checked);
                      if (checked) {
                        setOauthCustomProxyEnabled(false);
                        setOauthProxyUrl('');
                      }
                    }}
                  />
                  <span>使用系统级代理</span>
                </Label>
                <Label className="flex items-center gap-2">
                  <Checkbox
                    checked={oauthCustomProxyEnabled}
                    data-oauth-setting="use-custom-proxy"
                    onCheckedChange={(nextChecked) => {
                      const checked = nextChecked === true;
                      setOauthCustomProxyEnabled(checked);
                      if (checked) setOauthSystemProxyEnabled(false);
                    }}
                  />
                  <span>使用自定义代理</span>
                </Label>
              </div>

              <div className="grid gap-2">
                <Label>代理地址</Label>
                <Input
                  type="text"
                  value={oauthProxyUrl}
                  data-oauth-setting="proxy-url"
                  onChange={(event) => setOauthProxyUrl(event.target.value)}
                  placeholder="如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
                  disabled={!oauthCustomProxyEnabled}
                />
              </div>

              {drawerIntent.mode === 'proxy' ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={handleSaveProxy}
                    disabled={
                      actionLoadingKey === `save-proxy:${drawerIntent.account.accountId}`
                      || actionLoadingKey.startsWith('start:')
                    }
                  >
                    {actionLoadingKey === `save-proxy:${drawerIntent.account.accountId}` ? '保存中...' : '保存代理'}
                  </Button>
                  <Button variant="outline"
                    type="button"
                    onClick={handleStart}
                    disabled={
                      !selectedProvider
                      || !selectedProvider.enabled
                      || actionLoadingKey.startsWith('start:')
                      || actionLoadingKey === `save-proxy:${drawerIntent.account.accountId}`
                    }
                  >
                    {actionLoadingKey.startsWith('start:') ? '启动中...' : '保存并重新授权'}
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  onClick={handleStart}
                  disabled={!selectedProvider || !selectedProvider.enabled || actionLoadingKey.startsWith('start:')}
                >
                  {actionLoadingKey.startsWith('start:')
                    ? '启动中...'
                    : drawerIntent.mode === 'rebind'
                      ? `重新授权 ${selectedProvider?.label || ''}`.trim()
                      : `连接 ${selectedProvider?.label || ''}`.trim()}
                </Button>
              )}
            </CardContent>
          </Card>

          {activeSession ? (
            <Card>
              <CardHeader>
                <CardTitle>授权指引</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Card>
                  <CardContent className="grid gap-2 p-4">
                  <div className="text-xs font-medium text-muted-foreground">固定回调地址</div>
                  {renderCodeBlock(activeSession.instructions.redirectUri)}
                  </CardContent>
                </Card>

                {renderGuideCard(
                  '本地部署',
                  'metapi 和浏览器在同一台机器时，不需要 SSH 隧道。直接点击“连接”，在弹窗里完成授权即可。',
                  <div className="text-sm text-muted-foreground">
                    如果浏览器能直接访问上面的 localhost 回调地址，授权完成后会自动回到 metapi。
                  </div>,
                )}

                {activeSession.instructions.sshTunnelCommand
                  ? renderGuideCard(
                    '云端部署',
                    'metapi 部署在 VPS、容器或远程主机时，浏览器访问到的是你自己电脑的 localhost。先在本地开 SSH 隧道，再继续登录。',
                    <div className="grid gap-2">
                      <div className="text-xs font-medium text-muted-foreground">常规 SSH 隧道</div>
                      {renderCodeBlock(activeSession.instructions.sshTunnelCommand)}
                      {activeSession.instructions.sshTunnelKeyCommand ? (
                        <>
                          <div className="text-xs font-medium text-muted-foreground">SSH Key 隧道</div>
                          {renderCodeBlock(activeSession.instructions.sshTunnelKeyCommand)}
                        </>
                      ) : null}
                    </div>,
                  )
                  : renderGuideCard(
                    '云端部署',
                    '当前没有检测到远程主机地址。如果你实际是云端部署，请用能访问服务器 127.0.0.1 回调端口的 SSH 隧道方式完成授权。',
                  )}

                {renderGuideCard(
                  '手动回调',
                  `如果浏览器停在 localhost 错误页，复制浏览器地址栏里的完整 URL，等待 ${Math.max(1, Math.round(activeSession.instructions.manualCallbackDelayMs / 1000))} 秒后粘贴回来。`,
                  manualCallbackVisible ? (
                    <div className="grid gap-3">
                      <Textarea
                        className="font-mono"
                        value={manualCallbackUrl}
                        onChange={(event) => setManualCallbackUrl(event.target.value)}
                        placeholder="粘贴完整的 callback URL，例如 http://localhost:1455/auth/callback?code=..."
                        rows={3}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          onClick={handleSubmitManualCallback}
                          disabled={manualCallbackSubmitting}
                        >
                          {manualCallbackSubmitting ? '提交中...' : '提交回调 URL'}
                        </Button>
                        <Button variant="outline"
                          type="button"
                          onClick={() => openOAuthPopup(activeSession.provider, activeSession.authorizationUrl)}
                        >
                          重新打开授权页
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">手动回调入口将在几秒后可用。</div>
                  ),
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </SideDrawer>

      <OAuthModelsModal
        open={modelsModal.open}
        title={modelsModal.connection ? `模型列表 · ${resolveConnectionPrimaryTitle(modelsModal.connection)}` : '模型列表'}
        siteName={modelsModal.siteName}
        loading={modelsModal.loading}
        refreshing={modelsModal.refreshing}
        models={modelsModal.models}
        totalCount={modelsModal.totalCount}
        disabledCount={modelsModal.disabledCount}
        onClose={closeModelsModal}
        onRefresh={async () => {
          if (!modelsModal.connection) return;
          await loadModelsModal(modelsModal.connection, { refreshUpstream: true });
        }}
      />

      <CenteredModal
        open={importOpen}
        onClose={closeImportModal}
        title="导入 OAuth 连接 JSON"
        maxWidth={760}
        footer={(
          <>
            <Button variant="outline" type="button" onClick={closeImportModal}>
              关闭
            </Button>
            <Button type="button" onClick={handleImport} disabled={importing || !importPreviewSummary?.canImport}>
              {importing ? '添加中...' : '添加'}
            </Button>
          </>
        )}
      >
        <div className="text-sm text-muted-foreground">
          选择 JSON 后会先识别是否有效，再决定是否添加。每个 JSON 文件只对应一个 OAuth 连接。
        </div>
        <div
          className="grid cursor-pointer gap-3 rounded-md border border-dashed p-6 text-center"
          onDrop={(event) => { void handleImportDrop(event); }}
          onDragOver={handleImportDragOver}
          onDragLeave={handleImportDragLeave}
          onClick={() => importFileInputRef.current?.click()}
        >
          <Input
            ref={importFileInputRef}
            data-testid="oauth-import-file-input"
            type="file"
            accept=".json,application/json"
            multiple
            onChange={(event) => { void handleImportFileChange(event); }}
            className="hidden"
          />
          {importDrafts.length > 0 ? (
            <>
              <div className="font-medium">已选择 {importDrafts.length} 份 JSON，点击可重新选择</div>
              <div className="text-sm text-muted-foreground">支持多选，只会导入其中的 OAuth 账号。</div>
              <div className="grid gap-2 text-left">
                {importDrafts.map((draft) => (
                  <div key={draft.sourceName} className="rounded-md border p-2 text-sm">
                    <span>
                      {draft.sourceName}
                      {draft.error ? ` · ${draft.error}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="font-medium">
                {importDragOver ? '松开即可导入这些 JSON 文件' : '拖拽 OAuth 连接 JSON 到此处'}
              </div>
              <div className="text-sm text-muted-foreground">或点击选择文件，支持一次多选多个 `.json` 文件</div>
            </>
          )}
        </div>
        <div className="text-sm text-muted-foreground">
          导入后的账号代理可在这里一次性指定；如果当前运行时已配置系统代理，会默认预选“使用系统级代理”。
        </div>
        <div className="grid gap-3">
          <Label className="flex items-center gap-2">
            <Checkbox
              checked={importSystemProxyEnabled}
              data-oauth-import-setting="use-system-proxy"
              onCheckedChange={(nextChecked) => {
                const checked = nextChecked === true;
                setImportSystemProxyEnabled(checked);
                if (checked) {
                  setImportCustomProxyEnabled(false);
                  setImportProxyUrl('');
                }
              }}
            />
            <span>使用系统级代理</span>
          </Label>
          <Label className="flex items-center gap-2">
            <Checkbox
              checked={importCustomProxyEnabled}
              data-oauth-import-setting="use-custom-proxy"
              onCheckedChange={(nextChecked) => {
                const checked = nextChecked === true;
                setImportCustomProxyEnabled(checked);
                if (checked) setImportSystemProxyEnabled(false);
              }}
            />
            <span>使用自定义代理</span>
          </Label>
        </div>
        <div className="grid gap-2">
          <Label>代理地址</Label>
          <Input
            type="text"
            value={importProxyUrl}
            data-oauth-import-setting="proxy-url"
            onChange={(event) => setImportProxyUrl(event.target.value)}
            placeholder="如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
            disabled={!importCustomProxyEnabled}
          />
        </div>
        <div className="text-sm text-muted-foreground">或者手动粘贴单个 JSON 内容：</div>
        <Textarea
          className="font-mono"
          value={importJsonText}
          onChange={(event) => setImportJsonText(event.target.value)}
          placeholder='粘贴单个 OAuth 连接 JSON，例如 {"type":"codex","access_token":"...","refresh_token":"...","email":"user@example.com"}'
          rows={8}
        />
        {importPreviewSummary ? (
          <Card>
            <CardHeader>
              <CardTitle>识别结果</CardTitle>
              <CardDescription>
              {importPreviewSummary.canImport
                ? `已识别 ${importPreviewSummary.totalCount} 份 JSON，均可添加。`
                : `已识别 ${importPreviewSummary.totalCount} 份 JSON，其中 ${importPreviewSummary.invalidCount} 份无效。`}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {importPreviewSummary.items.map((item) => (
                <Card key={item.sourceName}>
                  <CardContent className="grid gap-2 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">{item.sourceName}</div>
                    <ToneBadge tone={item.valid ? 'success' : 'danger'}>
                      {item.valid ? '结构有效' : '结构无效'}
                    </ToneBadge>
                  </div>
                  {item.valid ? (
                    <div className="grid gap-1 text-sm text-muted-foreground">
                      <span>Provider：{item.providerLabel}</span>
                      {item.email ? <span>邮箱：{item.email}</span> : null}
                      {item.accountKey ? <span>账号：{item.accountKey}</span> : null}
                      {item.expiresLabel ? <span>到期：{item.expiresLabel}</span> : null}
                      <span>{item.disabled ? '状态：导入后禁用' : '状态：导入后启用'}</span>
                    </div>
                  ) : (
                    <div className="text-sm text-destructive">{item.error || 'JSON 结构无效'}</div>
                  )}
                  </CardContent>
                </Card>
              ))}
            {!importPreviewSummary.canImport ? (
              <div className="text-sm text-muted-foreground">请先修正无效 JSON，再点击“添加”。</div>
            ) : null}
            </CardContent>
          </Card>
        ) : null}
      </CenteredModal>

      <CenteredModal
        open={routeUnitModal.open}
        onClose={closeRouteUnitModal}
        title="创建路由池"
        maxWidth={520}
        footer={(
          <>
            <Button variant="outline" type="button" onClick={closeRouteUnitModal}>
              取消
            </Button>
            <Button
              type="button"
              onClick={handleCreateRouteUnit}
              disabled={actionLoadingKey === 'route-unit:create' || !asTrimmedString(routeUnitModal.name)}
            >
              {actionLoadingKey === 'route-unit:create' ? '创建中...' : '创建路由池'}
            </Button>
          </>
        )}
      >
        <div className="grid gap-2">
          <Label>路由池名称</Label>
          <Input
            type="text"
            data-testid="oauth-route-unit-name"
            value={routeUnitModal.name}
            onChange={(event) => setRouteUnitModal((current) => ({ ...current, name: event.target.value }))}
            placeholder="例如 Codex Pool"
          />
        </div>
        <div className="grid gap-2">
          <Label>策略</Label>
          <ModernSelect
            value={routeUnitModal.strategy}
            onChange={(value) => setRouteUnitModal((current) => ({
              ...current,
              strategy: String(value || 'round_robin') as OAuthRouteUnitStrategy,
            }))}
            options={[
              { value: 'round_robin', label: '轮询' },
              { value: 'stick_until_unavailable', label: '单个用到不可用再切' },
            ]}
            placeholder="选择路由池策略"
          />
        </div>
      </CenteredModal>
    </div>
  );
}
