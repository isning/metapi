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
import PageHeader from '../components/workspace/PageHeader.js';
import PageShell from '../components/workspace/PageShell.js';
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
import { DataTable, DataTableToolbar } from '../components/ui/data-table/index.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table/index.js';
import { Textarea } from '../components/ui/textarea/index.js';
import JsonCodeEditor from '../components/JsonCodeEditor.js';
import EmptyStateBlock from '../components/EmptyStateBlock.js';
import { Ellipsis, Eye, GitMerge, RefreshCcw, RotateCcw, Settings2, Trash2 } from 'lucide-react';
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

import { tr } from '../i18n.js';
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
  { key: 'identity', label: tr('pages.oAuthManagement.accountsProvider') },
  { key: 'site', label: tr('components.searchModal.sites2') },
  { key: 'status', label: tr('pages.oAuthManagement.status') },
  { key: 'quota', label: 'Usage / Quota' },
  { key: 'proxy', label: tr('pages.oAuthManagement.acting') },
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
    .replace(/codex usage windows inferred from rate limit response headers/ig, tr('pages.oAuthManagement.quotaWindowInferredFromResponseHeaders'))
    .replace(/official 5h quota window is not exposed by current codex oauth artifacts/ig, tr('pages.oAuthManagement.codexOauthOfficial5h'))
    .replace(/official 7d quota window is not exposed by current codex oauth artifacts/ig, tr('pages.oAuthManagement.codexOauthOfficial7d'))
    .replace(/official 5h quota window is unavailable for this provider/ig, tr('pages.oAuthManagement.providerOfficial5h'))
    .replace(/official 7d quota window is unavailable for this provider/ig, tr('pages.oAuthManagement.providerOfficial7d'))
    .replace(/\bfetch failed\b/ig, tr('pages.oAuthManagement.requestFailed'));
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
        error: tr('pages.oAuthManagement.currentBrowserCannotReadFile'),
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
        error: error?.message || tr('pages.importExport.failedReadFile'),
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
    throw new Error(tr('pages.oAuthManagement.expiredTimeInvalid'));
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
      error: tr('pages.oAuthManagement.jsonContent'),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      sourceName: source.sourceName,
      valid: false,
      error: tr('pages.oAuthManagement.jsonFailed'),
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      sourceName: source.sourceName,
      valid: false,
      error: tr('pages.oAuthManagement.oauthJson2'),
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
      error: tr('pages.oAuthManagement.sub2api'),
    };
  }

  const providerLabel = type ? resolveImportProviderLabel(type) : null;
  if (!providerLabel) {
    return {
      sourceName: source.sourceName,
      valid: false,
      error: `不支持的 OAuth 类型：${type || tr('pages.accounts.unknown2')}`,
    };
  }

  if (!asTrimmedString(typeof payload.access_token === 'string' ? payload.access_token : '')) {
    return {
      sourceName: source.sourceName,
      valid: false,
      error: tr('pages.oAuthManagement.accessToken'),
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
      error: error?.message || tr('pages.oAuthManagement.jsonInvalid'),
    };
  }
}

function resolveConnectionPrimaryTitle(connection: OAuthConnectionInfo): string {
  return asTrimmedString(connection.username)
    || asTrimmedString(connection.email)
    || asTrimmedString(connection.accountKey)
    || asTrimmedString(connection.provider)
    || tr('pages.oAuthManagement.oauth');
}

function resolveConnectionEmailLabel(connection: OAuthConnectionInfo): string {
  return asTrimmedString(connection.email);
}

function resolveConnectionStatusLabel(status?: string): string {
  return status === 'abnormal' ? tr('pages.accounts.error') : tr('pages.oAuthManagement.normal');
}

function resolveQuotaStatusLabel(status?: OAuthQuotaInfo['status']): string {
  if (status === 'unsupported') return tr('pages.accounts.unsupported');
  if (status === 'error') return tr('pages.oAuthManagement.failed');
  return tr('pages.oAuthManagement.supported');
}

function resolveQuotaSourceLabel(source?: OAuthQuotaInfo['source']): string {
  return source === 'official' ? tr('pages.oAuthManagement.official') : tr('pages.oAuthManagement.responseHeaderInference');
}

function resolveModelSyncStatusText(connection: OAuthConnectionInfo): string {
  const failureText = normalizeOauthMessage(connection.lastModelSyncError || '');
  if (failureText) return tr('pages.oAuthManagement.failed');
  return connection.lastModelSyncAt ? tr('pages.oAuthManagement.syncnormal') : tr('pages.oAuthManagement.sync');
}

function resolveQuotaSyncStatusText(quota?: OAuthQuotaInfo | null): string {
  if (!quota) return tr('pages.oAuthManagement.refreshquota2');
  if (quota.status === 'error') {
    return tr('pages.oAuthManagement.failed');
  }
  if (quota.status === 'unsupported') {
    return tr('pages.accounts.unsupported');
  }
  return quota.lastSyncAt ? tr('pages.oAuthManagement.syncnormal') : tr('pages.oAuthManagement.refresh');
}

function resolveModelSyncDetail(connection: OAuthConnectionInfo): string {
  return normalizeOauthMessage(connection.lastModelSyncError || '');
}

function resolveQuotaSyncDetail(quota?: OAuthQuotaInfo | null): string {
  if (!quota) return '';
  if (quota.status === 'error') {
    return normalizeOauthMessage(quota.lastError || quota.providerMessage || tr('pages.oAuthManagement.quotarefreshfailed'));
  }
  if (quota.status === 'unsupported') {
    return normalizeOauthMessage(quota.providerMessage || tr('pages.oAuthManagement.currentConnectionDoesNotSupportQuotaWindows'));
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
  if (diffMs <= 0) return tr('pages.oAuthManagement.now');
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
  if (typeof window.used === 'number' && typeof window.limit === 'number') return '';
  if (typeof window.remaining === 'number' && typeof window.limit === 'number') return '';
  if (typeof window.limit === 'number') return '';
  return window.message || tr('pages.oAuthManagement.officialnotProvided');
}

function resolveProxyProjectSummary(connection: OAuthConnectionInfo): string {
  const parts = [
    asTrimmedString(connection.planType || ''),
    connection.projectId ? `Project ${connection.projectId}` : '',
  ].filter(Boolean);
  return parts.join(' · ') || '--';
}

function resolveProxyDisplayText(connection: OAuthConnectionInfo): string {
  if (connection.useSystemProxy) return tr('pages.oAuthManagement.systemActing');
  if (connection.proxyUrl) return redactProxyUrl(connection.proxyUrl);
  return tr('pages.oAuthManagement.notSetacting');
}

function hasOauthProxySelection(connection: OAuthConnectionInfo): boolean {
  return !!connection.useSystemProxy || !!asTrimmedString(connection.proxyUrl);
}

function resolveRouteUnitStrategyLabel(strategy?: OAuthRouteUnitStrategy | null): string {
  return strategy === 'stick_until_unavailable' ? tr('pages.oAuthManagement.notAvailable') : tr('pages.oAuthManagement.roundRobin');
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
    return tr('pages.oAuthManagement.standalone');
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
          <span className="text-muted-foreground">{tr('pages.models.reset')} {formatResetLabel(window.resetAt)}</span>
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
      setSessionError(error?.message || tr('pages.oAuthManagement.oauthFailed'));
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
            setSessionError(error?.message || tr('pages.oAuthManagement.oauthRefreshfailed'));
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
    setSessionInfo(tr('pages.oAuthManagement.goOauth'));
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
          setSessionInfo(tr('pages.oAuthManagement.waitingAuthorization'));
          timer = setTimeout(poll, POLL_INTERVAL_MS);
          return;
        }

        if (session.status === 'success') {
          setSessionSuccess(tr('pages.oAuthManagement.success'));
          await loadConnections();
          setActiveSession(null);
          return;
        }

        setSessionError(`授权失败：${session.error || tr('pages.oAuthManagement.unknownError')}`);
        setActiveSession(null);
      } catch (error: any) {
        if (cancelled) return;
        setSessionError(error?.message || tr('pages.oAuthManagement.oauthStatusFailed'));
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
      description: [
        provider.platform,
        provider.requiresProjectId ? tr('pages.oAuthManagement.projectId') : '',
        !provider.enabled ? tr('pages.oAuthManagement.enabled') : '',
      ].filter(Boolean).join(' · '),
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
    setSessionInfo(tr('pages.oAuthManagement.openOauthActingsettingsSaveactingSaveReauthorize'));
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
      setSessionError(tr('pages.oAuthManagement.turnOnactingInputActing'));
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
      setSessionSuccess(tr('pages.oAuthManagement.actingSave'));
    } catch (error: any) {
      setSessionError(error?.message || tr('pages.oAuthManagement.saveactingfailed'));
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
      setSessionError(tr('pages.oAuthManagement.availableOauthProvider'));
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
      setSessionError(tr('pages.oAuthManagement.turnOnactingInputActing'));
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

      setSessionInfo(tr('pages.oAuthManagement.waitingAuthorization'));
      setActiveSession({
        provider: started.provider,
        state: started.state,
        authorizationUrl: started.authorizationUrl,
        instructions: started.instructions,
      });
      resetOauthProxySettings();
      openOAuthPopup(provider.provider, started.authorizationUrl);
    } catch (error: any) {
      setSessionError(error?.message || tr('pages.oAuthManagement.noneOauth'));
    } finally {
      setActionLoadingKey('');
    }
  };

  const handleSubmitManualCallback = async () => {
    if (!activeSession) return;
    const callbackUrl = manualCallbackUrl.trim();
    if (!callbackUrl) {
      setSessionError(tr('pages.oAuthManagement.inputUrl'));
      return;
    }
    setManualCallbackSubmitting(true);
    try {
      await api.submitOAuthManualCallback(activeSession.state, callbackUrl);
      setSessionInfo(tr('pages.oAuthManagement.callbackSubmittedWaitingAuthorization'));
    } catch (error: any) {
      setSessionError(error?.message || tr('pages.oAuthManagement.urlFailed'));
    } finally {
      setManualCallbackSubmitting(false);
    }
  };

  const handleDelete = async (accountId: number) => {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      const confirmed = window.confirm(tr('pages.oAuthManagement.deleteOauth'));
      if (!confirmed) return;
    }
    const actionKey = `delete:${accountId}`;
    setActionLoadingKey(actionKey);
    try {
      await api.deleteOAuthConnection(accountId);
      setSessionSuccess(tr('pages.oAuthManagement.deleted'));
      await loadConnections();
      setSelectedConnectionIds((current) => current.filter((id) => id !== accountId));
    } catch (error: any) {
      setSessionError(error?.message || tr('pages.oAuthManagement.deleteOauthFailed'));
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
      setSessionSuccess(tr('pages.oAuthManagement.quotainfoRefresh'));
      await loadConnections();
    } catch (error: any) {
      setSessionError(error?.message || tr('pages.oAuthManagement.refreshquotafailed2'));
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
      setSessionError(error?.message || tr('pages.oAuthManagement.refreshquotafailed'));
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
        setSessionSuccess(tr('pages.accounts.modelRefresh'));
      }
    } catch (error: any) {
      if (modelsModalRequestSeqRef.current !== requestId) return;
      setSessionError(error?.message || tr('pages.accounts.modelFailed3'));
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
      ...(manualRaw ? [{ sourceName: tr('pages.oAuthManagement.manualJson'), rawText: manualRaw }] : []),
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
      setSessionError(tr('pages.oAuthManagement.selectJsonOauthJsonContent'));
      return;
    }
    if (!importPreviewSummary?.canImport) {
      setSessionError(tr('pages.oAuthManagement.invalidOauthJson'));
      return;
    }
    if (importCustomProxyEnabled && !asTrimmedString(importProxyUrl)) {
      setSessionError(tr('pages.oAuthManagement.turnOnactingInputActing'));
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
      const message = error?.message || tr('pages.oAuthManagement.importOauthJsonFailed');
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
      setSessionError(tr('pages.oAuthManagement.inputroutesName'));
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
      setSessionSuccess(tr('pages.oAuthManagement.routes2'), {
        routeUnit,
      });
      setSelectedConnectionIds([]);
      closeRouteUnitModal();
      try {
        await loadConnections();
      } catch {
        toast.error(tr('pages.oAuthManagement.oauthRefreshfailed'));
        setSessionError(tr('pages.oAuthManagement.routesRefreshfailed'), {
          routeUnit,
        });
      }
    } catch (error: any) {
      const message = error?.message || tr('pages.oAuthManagement.routesFailed');
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
      setSessionSuccess(tr('pages.oAuthManagement.splitBackStandalone'), {
        routeUnit: routeUnitFeedback,
      });
      setSelectedConnectionIds([]);
      try {
        await loadConnections();
      } catch {
        toast.error(tr('pages.oAuthManagement.oauthRefreshfailed'));
        setSessionError(tr('pages.oAuthManagement.splitBackStandaloneRefreshfailed'), {
          routeUnit: routeUnitFeedback,
        });
      }
    } catch (error: any) {
      const message = error?.message || tr('pages.oAuthManagement.splitStandalonefailed');
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
              placeholder={tr('pages.oAuthManagement.searchaccountsEmailSites')}
            />
            <div className="w-44">
              <ModernSelect
                size="sm"
                value={providerFilter}
                onChange={(value) => setProviderFilter(String(value || ''))}
                options={[
                  { value: '', label: tr('pages.oAuthManagement.allProvider') },
                  ...providerOptions,
                ]}
                placeholder={tr('pages.oAuthManagement.allProvider')}
              />
            </div>
            <div className="w-40">
              <ModernSelect
                size="sm"
                value={statusFilter}
                onChange={(value) => setStatusFilter(String(value || ''))}
                options={[
                  { value: '', label: tr('pages.downstreamKeys.allstatus') },
                  { value: 'healthy', label: tr('pages.oAuthManagement.normal') },
                  { value: 'abnormal', label: tr('pages.accounts.error') },
                ]}
                placeholder={tr('pages.downstreamKeys.allstatus')}
              />
            </div>
            <div className="w-56">
              <ModernSelect
                size="sm"
                value={siteFilter}
                onChange={(value) => setSiteFilter(String(value || ''))}
                options={[
                  { value: '', label: tr('pages.oAuthManagement.allsites') },
                  ...siteOptions,
                ]}
                placeholder={tr('pages.oAuthManagement.allsites')}
              />
            </div>
            <div className="w-44">
              <ModernSelect
                size="sm"
                value={String(autoRefreshSeconds)}
                onChange={(value) => setAutoRefreshSeconds(Number(value || 0))}
                options={AUTO_REFRESH_OPTIONS.map((seconds) => ({
                  value: String(seconds),
                  label: seconds === 0 ? tr('pages.oAuthManagement.automaticrefreshClose') : `自动刷新：${seconds}s`,
                }))}
                placeholder={tr('pages.oAuthManagement.automaticrefresh')}
              />
            </div>
            {autoRefreshSeconds > 0 ? (
              <div className="text-sm text-muted-foreground">{tr('pages.oAuthManagement.refresh2')} {autoRefreshCountdown}s</div>
            ) : null}
            <DropdownMenu.Root open={showColumnMenu} onOpenChange={setShowColumnMenu}>
              <DropdownMenu.Trigger asChild>
                <Button variant="outline" type="button">
                  {tr('pages.oAuthManagement.settings')}
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Label>{tr('pages.oAuthManagement.visibleColumns')}</DropdownMenu.Label>
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
          {tr('pages.oAuthManagement.oauthAccountsConnectionManagementDefaultSessionApi')}
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
        placeholder={tr('pages.oAuthManagement.searchaccountsEmailSites')}
      />
      <ModernSelect
        size="sm"
        value={providerFilter}
        onChange={(value) => setProviderFilter(String(value || ''))}
        options={[
          { value: '', label: tr('pages.oAuthManagement.allProvider') },
          ...providerOptions,
        ]}
        placeholder={tr('pages.oAuthManagement.allProvider')}
      />
      <ModernSelect
        size="sm"
        value={statusFilter}
        onChange={(value) => setStatusFilter(String(value || ''))}
        options={[
          { value: '', label: tr('pages.downstreamKeys.allstatus') },
          { value: 'healthy', label: tr('pages.oAuthManagement.normal') },
          { value: 'abnormal', label: tr('pages.accounts.error') },
        ]}
        placeholder={tr('pages.downstreamKeys.allstatus')}
      />
      <ModernSelect
        size="sm"
        value={siteFilter}
        onChange={(value) => setSiteFilter(String(value || ''))}
        options={[
          { value: '', label: tr('pages.oAuthManagement.allsites') },
          ...siteOptions,
        ]}
        placeholder={tr('pages.oAuthManagement.allsites')}
      />
      <ModernSelect
        size="sm"
        value={String(autoRefreshSeconds)}
        onChange={(value) => setAutoRefreshSeconds(Number(value || 0))}
        options={AUTO_REFRESH_OPTIONS.map((seconds) => ({
          value: String(seconds),
          label: seconds === 0 ? tr('pages.oAuthManagement.automaticrefreshClose') : `自动刷新：${seconds}s`,
        }))}
        placeholder={tr('pages.oAuthManagement.automaticrefresh')}
      />
    </div>
  );

  const desktopTable = (
    <DataTable minWidth={1180}>
      <DataTableToolbar className="border-b bg-muted/30">
        <div className="text-sm text-muted-foreground">
          已选 <span className="font-medium text-foreground">{selectedConnectionIds.length}</span> / {filteredConnections.length} 个 OAuth 连接
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedConnectionIds.length > 0 ? (
            <>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={handleRefreshSelected}
                disabled={actionLoadingKey === 'quota:selected'}
              >
                <RefreshCcw className="size-4" />
                <span className="sr-only">{tr('pages.oAuthManagement.refreshquota3')}</span>
                {actionLoadingKey === 'quota:selected' ? tr('pages.downstreamKeys.refreshzh') : tr('pages.oAuthManagement.refreshquota')}
              </Button>
              {canMergeSelectedIntoRouteUnit ? (
                <Button variant="outline" size="sm" type="button" onClick={openRouteUnitModal}>
                  <GitMerge className="size-4" />
                  {tr('pages.oAuthManagement.routes3')}
                </Button>
              ) : null}
              {canSplitSelectedRouteUnit ? (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={handleDeleteSelectedRouteUnit}
                  disabled={actionLoadingKey === 'route-unit:delete'}
                >
                  <RotateCcw className="size-4" />
                  {actionLoadingKey === 'route-unit:delete' ? tr('pages.oAuthManagement.zh3') : tr('pages.oAuthManagement.splitStandalone')}
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" type="button" onClick={() => setSelectedConnectionIds([])} disabled={!!actionLoadingKey}>
                {tr('pages.accounts.cancelselectAll')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                type="button"
                onClick={handleDeleteSelected}
                disabled={actionLoadingKey === 'delete:selected'}
              >
                <Trash2 className="size-4" />
                {actionLoadingKey === 'delete:selected' ? tr('components.deleteConfirmModal.deletezh') : tr('pages.accounts.delete2')}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" type="button" onClick={() => toggleSelectAllVisible(true)} disabled={filteredConnections.length === 0}>
              {tr('pages.downstreamKeys.selectVisible')}
            </Button>
          )}
        </div>
      </DataTableToolbar>
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
          {visibleColumns.identity ? <TableHead>{tr('components.searchModal.accounts2')}</TableHead> : null}
          {visibleColumns.site ? <TableHead>{tr('components.searchModal.sites2')}</TableHead> : null}
          {visibleColumns.status ? <TableHead>{tr('components.notificationPanel.status')}</TableHead> : null}
          {visibleColumns.quota ? <TableHead>{tr('pages.downstreamKeys.quota')}</TableHead> : null}
          {visibleColumns.proxy ? <TableHead>{tr('pages.oAuthManagement.acting2')}</TableHead> : null}
          <TableHead>{tr('pages.accounts.actions2')}</TableHead>
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
            <TableRow
              key={connection.accountId}
              data-state={selectedConnectionIds.includes(connection.accountId) ? 'selected' : undefined}
            >
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
                        <Eye className="size-4" />
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
                        {tr('pages.accounts.connection')} {compactAccountKey(connection.accountKey)}
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
                        <div className="text-xs font-medium text-muted-foreground">{tr('components.modelAnalysisPanel.model')}</div>
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
                        <div className="text-xs font-medium text-muted-foreground">{tr('pages.downstreamKeys.quota')}</div>
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
                      <Settings2 className="size-4" />
                      {hasOauthProxySelection(connection) ? tr('pages.oAuthManagement.actingsettings') : tr('pages.oAuthManagement.settingsacting')}
                    </Button>
                  </div>
                </TableCell>
              ) : null}
              <TableCell>
                <div className="flex items-center justify-end gap-1">
                  <Button variant="ghost" size="sm"
                    type="button"
                    onClick={() => void openModelsModal(connection)}
                  >
                    <Eye className="size-4" />
                    {connection.modelCount} {tr('pages.models.models2')}
                  </Button>
                  <Button variant="ghost" size="sm"
                    type="button"
                    onClick={() => handleRefreshQuota(connection.accountId)}
                    disabled={actionLoadingKey === `quota:${connection.accountId}`}
                  >
                    <RefreshCcw className="size-4" />
                    {actionLoadingKey === `quota:${connection.accountId}` ? tr('pages.downstreamKeys.refreshzh') : tr('pages.oAuthManagement.refreshquota')}
                  </Button>
                  <Button variant="ghost" size="sm"
                    type="button"
                    onClick={() => openRebindDrawer(connection)}
                  >
                    <RotateCcw className="size-4" />
                    {tr('pages.oAuthManagement.reauthorize')}
                  </Button>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <Button variant="ghost" size="icon" type="button" aria-label={tr('pages.accounts.actions2')}>
                        <Ellipsis className="size-4" />
                      </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end">
                      <DropdownMenu.Item onSelect={() => openProxySettingsDrawer(connection)}>
                        <Settings2 className="size-4" />
                        {hasOauthProxySelection(connection) ? tr('pages.oAuthManagement.actingsettings') : tr('pages.oAuthManagement.settingsacting')}
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                  <Button variant="ghostDestructive" size="sm"
                    type="button"
                    onClick={() => handleDelete(connection.accountId)}
                    disabled={actionLoadingKey === `delete:${connection.accountId}`}
                  >
                    <Trash2 className="size-4" />
                    {actionLoadingKey === `delete:${connection.accountId}` ? tr('components.deleteConfirmModal.deletezh') : tr('pages.oAuthManagement.delete')}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
      </Table>
    </DataTable>
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
            <MobileField label={tr('components.searchModal.sites2')} value={connection.site?.name || '--'} />
            <MobileField label={tr('pages.oAuthManagement.email')} value={resolveConnectionEmailLabel(connection) || '--'} />
            <MobileField label={tr('pages.oAuthManagement.planProject')} value={connection.projectId ? `${connection.planType || '--'} · ${connection.projectId}` : (connection.planType || '--')} />
            <MobileField label={tr('pages.oAuthManagement.routes4')} value={resolveRouteParticipationSummary(connection)} />
            <MobileField
              label={tr('pages.oAuthManagement.accountsacting')}
              value={(
                <div className="grid gap-2">
                  <div className="text-xs text-muted-foreground">{resolveProxyDisplayText(connection)}</div>
                  <Button variant="ghost" size="sm"
                    type="button"
                    onClick={() => openProxySettingsDrawer(connection)}
                  >
                    {hasOauthProxySelection(connection) ? tr('pages.oAuthManagement.actingsettings') : tr('pages.oAuthManagement.settingsacting')}
                  </Button>
                </div>
              )}
              stacked
            />
            <MobileField
              label={tr('pages.oAuthManagement.status')}
              value={(
                <div className="grid gap-2 text-sm">
                  <div className="grid gap-1">
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-medium text-muted-foreground">{tr('components.modelAnalysisPanel.model')}</div>
                      <div>{resolveModelSyncStatusText(connection)}</div>
                    </div>
                    {resolveModelSyncDetail(connection) ? (
                      <div className="text-xs text-muted-foreground">{resolveModelSyncDetail(connection)}</div>
                    ) : null}
                  </div>
                  <div className="grid gap-1">
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-medium text-muted-foreground">{tr('pages.downstreamKeys.quota')}</div>
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
                {connection.modelCount} {tr('pages.models.models2')}
              </Button>
              <Button variant="ghost" size="sm" type="button" onClick={() => handleRefreshQuota(connection.accountId)}>
                {tr('pages.oAuthManagement.refreshquota')}
              </Button>
              <Button variant="ghost" size="sm" type="button" onClick={() => openProxySettingsDrawer(connection)}>
                {tr('pages.oAuthManagement.actingsettings')}
              </Button>
              <Button variant="ghost" size="sm" type="button" onClick={() => openRebindDrawer(connection)}>
                {tr('pages.oAuthManagement.reauthorize')}
              </Button>
              <Button variant="destructive" size="sm" type="button" onClick={() => handleDelete(connection.accountId)}>
                {tr('pages.oAuthManagement.delete')}
              </Button>
            </div>
          </MobileCard>
        );
      })}
    </div>
  );

  return (
    <PageShell>
      <PageHeader
        title={tr('app.oauth')}
        description={tr('pages.oAuthManagement.officialOauthAccountsConnectionManagement')}
        actions={!isMobile ? (
          <>
            <Button variant="outline" type="button" onClick={openImportModal}>
              {tr('pages.oAuthManagement.importJson2')}
            </Button>
            <Button type="button" onClick={() => openCreateDrawer()}>
              {tr('pages.oAuthManagement.newOauth')}
            </Button>
          </>
        ) : null}
      />

      {sessionFeedback ? (
        <Card>
          <CardContent className="grid gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium">{sessionFeedback.message}</div>
            <ToneBadge tone={sessionFeedback.tone === 'success' ? 'success' : sessionFeedback.tone === 'error' ? 'danger' : 'info'}>
              {sessionFeedback.tone === 'success' ? tr('pages.checkinLog.success') : sessionFeedback.tone === 'error' ? tr('pages.checkinLog.failed') : tr('pages.accounts.tip')}
            </ToneBadge>
          </div>
          {sessionFeedback.routeUnit ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <ToneBadge tone="-info">{sessionFeedback.routeUnit.name}</ToneBadge>
              <ToneBadge tone="-muted">{sessionFeedback.routeUnit.memberCount} {tr('pages.oAuthManagement.members')}</ToneBadge>
              <ToneBadge tone="-muted">{resolveRouteUnitStrategyLabel(sessionFeedback.routeUnit.strategy)}</ToneBadge>
              <div className="text-muted-foreground">
                {sessionFeedback.routeUnit.action === 'created'
                  ? tr('pages.oAuthManagement.zhOauthAccountsRoutesRoutesRoutes')
                  : tr('pages.oAuthManagement.routesStandaloneaccountsRoutes')}
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
        mobileTitle={tr('pages.oAuthManagement.oauthFilterActions')}
        mobileContent={mobileFilterContent}
        desktopContent={filterBar}
        mobileTrigger={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline"
              type="button"
              onClick={() => setShowMobileFilters(true)}
            >
              {tr('pages.oAuthManagement.filterActions')}
            </Button>
            <Button type="button" onClick={() => openCreateDrawer()}>
              {tr('pages.oAuthManagement.newOauth')}
            </Button>
          </div>
        }
      />

      <div className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="grid gap-1">
            <div className="text-sm font-semibold text-foreground">{tr('pages.oAuthManagement.oauth2')}</div>
            <div className="text-sm text-muted-foreground">
              {tr('pages.oAuthManagement.connected')} {connections.length} {tr('pages.oAuthManagement.oauthAccountsFilter')} {filteredConnections.length} {tr('pages.oAuthManagement.items')}
            </div>
          </div>
        </div>

        {isMobile && selectedConnectionIds.length > 0 ? (
          <ResponsiveBatchActionBar isMobile={isMobile} info={`已选 ${selectedConnectionIds.length} 项`}>
            <Button variant="outline"
              type="button"
              onClick={handleRefreshSelected}
              disabled={actionLoadingKey === 'quota:selected'}
            >
              {actionLoadingKey === 'quota:selected' ? tr('pages.downstreamKeys.refreshzh') : tr('pages.oAuthManagement.refreshquota3')}
            </Button>
            {canMergeSelectedIntoRouteUnit ? (
              <Button variant="outline"
                type="button"
                onClick={openRouteUnitModal}
              >
                {tr('pages.oAuthManagement.routes3')}
              </Button>
            ) : null}
            {canSplitSelectedRouteUnit ? (
              <Button variant="outline"
                type="button"
                onClick={handleDeleteSelectedRouteUnit}
                disabled={actionLoadingKey === 'route-unit:delete'}
              >
                {actionLoadingKey === 'route-unit:delete' ? tr('pages.oAuthManagement.zh3') : tr('pages.oAuthManagement.splitStandalone')}
              </Button>
            ) : null}
            <Button variant="destructive" size="sm"
              type="button"
              onClick={handleDeleteSelected}
              disabled={actionLoadingKey === 'delete:selected'}
            >
              {actionLoadingKey === 'delete:selected' ? tr('components.deleteConfirmModal.deletezh') : tr('pages.accounts.delete2')}
            </Button>
          </ResponsiveBatchActionBar>
        ) : null}

        {!loaded ? (
          <EmptyStateBlock title={tr('pages.oAuthManagement.loading')} description={tr('pages.oAuthManagement.oauthQuotainfo')} />
        ) : filteredConnections.length === 0 ? (
          <EmptyStateBlock
            title={tr('pages.oAuthManagement.noneOauth2')}
            description={tr('pages.oAuthManagement.usageNewOauthCodexClaudeGeminiCli')}
          />
        ) : (
          isMobile ? mobileList : desktopTable
        )}
      </div>

      <SideDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={drawerIntent.mode === 'create'
          ? tr('pages.oAuthManagement.newOauth')
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
                    placeholder={tr('pages.oAuthManagement.selectOauthProvider')}
                  />
                </div>
              ) : (
                <div className="grid gap-1">
                  <Label>{tr('pages.oAuthManagement.currentConnection')}</Label>
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
                  <Label>{tr('pages.oAuthManagement.googleCloudProjectId')}</Label>
                  <Input
                    type="text"
                    value={drawerProjectId}
                    onChange={(event) => setDrawerProjectId(event.target.value)}
                    placeholder={tr('pages.oAuthManagement.automatic')}
                  />
                </div>
              ) : null}

              <div className="text-sm text-muted-foreground">
                {drawerIntent.mode === 'proxy'
                  ? tr('pages.oAuthManagement.accountsOauthActingSaveactingRefreshSaveReauthorize')
                  : tr('pages.oAuthManagement.settingsReauthorizeActingOauthTokenAccountsAccounts')}
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
                  <span>{tr('pages.oAuthManagement.usagesystemActing')}</span>
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
                  <span>{tr('pages.oAuthManagement.usageActing')}</span>
                </Label>
              </div>

              <div className="grid gap-2">
                <Label>{tr('pages.oAuthManagement.acting3')}</Label>
                <Input
                  type="text"
                  value={oauthProxyUrl}
                  data-oauth-setting="proxy-url"
                  onChange={(event) => setOauthProxyUrl(event.target.value)}
                  placeholder={tr('pages.oAuthManagement.http1270017890Socks5')}
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
                    {actionLoadingKey === `save-proxy:${drawerIntent.account.accountId}` ? tr('pages.accounts.saving') : tr('pages.oAuthManagement.saveacting')}
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
                    {actionLoadingKey.startsWith('start:') ? tr('pages.oAuthManagement.zh') : tr('pages.oAuthManagement.saveReauthorize')}
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  onClick={handleStart}
                  disabled={!selectedProvider || !selectedProvider.enabled || actionLoadingKey.startsWith('start:')}
                >
                  {actionLoadingKey.startsWith('start:')
                    ? tr('pages.oAuthManagement.zh')
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
                <CardTitle>{tr('pages.oAuthManagement.authorizationGuide')}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Card>
                  <CardContent className="grid gap-2 p-4">
                  <div className="text-xs font-medium text-muted-foreground">{tr('pages.oAuthManagement.fixedCallbackUrl')}</div>
                  {renderCodeBlock(activeSession.instructions.redirectUri)}
                  </CardContent>
                </Card>

                {renderGuideCard(
                  tr('pages.oAuthManagement.localDeployment'),
                  tr('pages.oAuthManagement.metapiSsh'),
                  <div className="text-sm text-muted-foreground">
                    {tr('pages.oAuthManagement.accessLocalhostAutomaticMetapi')}
                  </div>,
                )}

                {activeSession.instructions.sshTunnelCommand
                  ? renderGuideCard(
                    tr('pages.oAuthManagement.cloudDeployment'),
                    tr('pages.oAuthManagement.metapiDeployVpsAccessLocalhostSshSign'),
                    <div className="grid gap-2">
                      <div className="text-xs font-medium text-muted-foreground">{tr('pages.oAuthManagement.ssh')}</div>
                      {renderCodeBlock(activeSession.instructions.sshTunnelCommand)}
                      {activeSession.instructions.sshTunnelKeyCommand ? (
                        <>
                          <div className="text-xs font-medium text-muted-foreground">{tr('pages.oAuthManagement.sshKey')}</div>
                          {renderCodeBlock(activeSession.instructions.sshTunnelKeyCommand)}
                        </>
                      ) : null}
                    </div>,
                  )
                  : renderGuideCard(
                    tr('pages.oAuthManagement.cloudDeployment'),
                    tr('pages.oAuthManagement.cloudDeploymentAccess127001'),
                  )}

                {renderGuideCard(
                  tr('pages.oAuthManagement.manual'),
                  `如果浏览器停在 localhost 错误页，复制浏览器地址栏里的完整 URL，等待 ${Math.max(1, Math.round(activeSession.instructions.manualCallbackDelayMs / 1000))} 秒后粘贴回来。`,
                  manualCallbackVisible ? (
                    <div className="grid gap-3">
                      <Textarea
                        className="font-mono"
                        value={manualCallbackUrl}
                        onChange={(event) => setManualCallbackUrl(event.target.value)}
                        placeholder={tr('pages.oAuthManagement.callbackUrlHttpLocalhost1455AuthCallback')}
                        rows={3}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          onClick={handleSubmitManualCallback}
                          disabled={manualCallbackSubmitting}
                        >
                          {manualCallbackSubmitting ? tr('pages.oAuthManagement.zh2') : tr('pages.oAuthManagement.url')}
                        </Button>
                        <Button variant="outline"
                          type="button"
                          onClick={() => openOAuthPopup(activeSession.provider, activeSession.authorizationUrl)}
                        >
                          {tr('pages.oAuthManagement.open')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">{tr('pages.oAuthManagement.manualSecondsAvailable')}</div>
                  ),
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </SideDrawer>

      <OAuthModelsModal
        open={modelsModal.open}
        title={modelsModal.connection ? `模型列表 · ${resolveConnectionPrimaryTitle(modelsModal.connection)}` : tr('pages.oAuthManagement.model')}
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
        title={tr('pages.oAuthManagement.importOauthJson')}
        maxWidth={760}
        footer={(
          <>
            <Button variant="outline" type="button" onClick={closeImportModal}>
              {tr('pages.accounts.close')}
            </Button>
            <Button type="button" onClick={handleImport} disabled={importing || !importPreviewSummary?.canImport}>
              {importing ? tr('pages.accounts.adding') : tr('pages.oAuthManagement.add')}
            </Button>
          </>
        )}
      >
        <div className="text-sm text-muted-foreground">
          {tr('pages.oAuthManagement.selectJsonAddJsonOauth')}
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
              <div className="font-medium">{tr('pages.oAuthManagement.selected')} {importDrafts.length} {tr('pages.oAuthManagement.jsonSelect')}</div>
              <div className="text-sm text-muted-foreground">{tr('pages.oAuthManagement.supportedImportZhOauthAccounts')}</div>
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
                {importDragOver ? tr('pages.oAuthManagement.importJson') : tr('pages.oAuthManagement.oauthJson')}
              </div>
              <div className="text-sm text-muted-foreground">{tr('pages.oAuthManagement.clickChooseFileSupportedJson')}</div>
            </>
          )}
        </div>
        <div className="text-sm text-muted-foreground">
          {tr('pages.oAuthManagement.importAccountsactingCurrentlyRunningConfiguredsystemactingDefaultUsagesystem')}
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
            <span>{tr('pages.oAuthManagement.usagesystemActing')}</span>
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
            <span>{tr('pages.oAuthManagement.usageActing')}</span>
          </Label>
        </div>
        <div className="grid gap-2">
          <Label>{tr('pages.oAuthManagement.acting3')}</Label>
          <Input
            type="text"
            value={importProxyUrl}
            data-oauth-import-setting="proxy-url"
            onChange={(event) => setImportProxyUrl(event.target.value)}
            placeholder={tr('pages.oAuthManagement.http1270017890Socks5')}
            disabled={!importCustomProxyEnabled}
          />
        </div>
        <div className="text-sm text-muted-foreground">{tr('pages.oAuthManagement.manualJsonContent')}</div>
        <JsonCodeEditor
          value={importJsonText}
          onChange={setImportJsonText}
          placeholder={tr('pages.oAuthManagement.oauthJsonTypeCodexAccessTokenRefresh')}
          minHeight={260}
          maxHeight={560}
          ariaLabel={tr('pages.oAuthManagement.manualJsonContent')}
        />
        {importPreviewSummary ? (
          <Card>
            <CardHeader>
              <CardTitle>{tr('pages.oAuthManagement.recognitionResult')}</CardTitle>
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
                      {item.valid ? tr('pages.importExport.structureValid') : tr('pages.oAuthManagement.invalid')}
                    </ToneBadge>
                  </div>
                  {item.valid ? (
                    <div className="grid gap-1 text-sm text-muted-foreground">
                      <span>Provider：{item.providerLabel}</span>
                      {item.email ? <span>{tr('pages.oAuthManagement.email2')}{item.email}</span> : null}
                      {item.accountKey ? <span>{tr('pages.oAuthManagement.accounts')}{item.accountKey}</span> : null}
                      {item.expiresLabel ? <span>{tr('pages.oAuthManagement.expires')}{item.expiresLabel}</span> : null}
                      <span>{item.disabled ? tr('pages.oAuthManagement.statusImportDisabled') : tr('pages.oAuthManagement.statusImportEnabled')}</span>
                    </div>
                  ) : (
                    <div className="text-sm text-destructive">{item.error || tr('pages.oAuthManagement.jsonInvalid')}</div>
                  )}
                  </CardContent>
                </Card>
              ))}
            {!importPreviewSummary.canImport ? (
              <div className="text-sm text-muted-foreground">{tr('pages.oAuthManagement.invalidJsonAdd')}</div>
            ) : null}
            </CardContent>
          </Card>
        ) : null}
      </CenteredModal>

      <CenteredModal
        open={routeUnitModal.open}
        onClose={closeRouteUnitModal}
        title={tr('pages.oAuthManagement.routes')}
        maxWidth={520}
        footer={(
          <>
            <Button variant="outline" type="button" onClick={closeRouteUnitModal}>
              {tr('app.cancel')}
            </Button>
            <Button
              type="button"
              onClick={handleCreateRouteUnit}
              disabled={actionLoadingKey === 'route-unit:create' || !asTrimmedString(routeUnitModal.name)}
            >
              {actionLoadingKey === 'route-unit:create' ? tr('pages.oAuthManagement.creating') : tr('pages.oAuthManagement.routes')}
            </Button>
          </>
        )}
      >
        <div className="grid gap-2">
          <Label>{tr('pages.oAuthManagement.routesName')}</Label>
          <Input
            type="text"
            data-testid="oauth-route-unit-name"
            value={routeUnitModal.name}
            onChange={(event) => setRouteUnitModal((current) => ({ ...current, name: event.target.value }))}
            placeholder={tr('pages.oAuthManagement.codexPool')}
          />
        </div>
        <div className="grid gap-2">
          <Label>{tr('pages.oAuthManagement.strategy')}</Label>
          <ModernSelect
            value={routeUnitModal.strategy}
            onChange={(value) => setRouteUnitModal((current) => ({
              ...current,
              strategy: String(value || 'round_robin') as OAuthRouteUnitStrategy,
            }))}
            options={[
              { value: 'round_robin', label: tr('pages.oAuthManagement.roundRobin') },
              { value: 'stick_until_unavailable', label: tr('pages.oAuthManagement.notAvailable') },
            ]}
            placeholder={tr('pages.oAuthManagement.selectroutesStrategy')}
          />
        </div>
      </CenteredModal>
    </PageShell>
  );
}
