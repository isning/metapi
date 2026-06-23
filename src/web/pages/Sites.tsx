/**
 * @Author: 橘子
 * @Project_description: Metapi 站点管理页
 * @Description: 代码是我抄的，不会也是真的
 */
import { useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../api.js';
import { getAuthToken } from '../authSession.js';
import { getBrand } from '../components/BrandIcon.js';
import CenteredModal from '../components/CenteredModal.js';
import ResponsiveFilterPanel from '../components/ResponsiveFilterPanel.js';
import ResponsiveBatchActionBar from '../components/ResponsiveBatchActionBar.js';
import { useToast } from '../components/Toast.js';
import ModernSelect from '../components/ModernSelect.js';
import { MobileCard, MobileField } from '../components/MobileCard.js';
import ResponsiveFormGrid from '../components/ResponsiveFormGrid.js';
import { useIsMobile } from '../components/useIsMobile.js';
import DeleteConfirmModal from '../components/DeleteConfirmModal.js';
import SiteCreatedModal from '../components/SiteCreatedModal.js';
import PageHeader from '../components/workspace/PageHeader.js';
import PageShell from '../components/workspace/PageShell.js';
import { UpstreamCompatibilityPolicyEditor } from '../components/UpstreamCompatibilityPolicyEditor.js';
import { ConfigSection, ConfigSectionItem } from '../components/ConfigSection.js';
import { formatDateTimeLocal } from './helpers/checkinLogTime.js';
import { clearFocusParams, readFocusSiteId } from './helpers/navigationFocus.js';
import { tr } from '../i18n.js';
import {
  buildCustomReorderToTargetUpdates,
  buildCustomReorderUpdates,
  sortItemsForDisplay,
  type SortMode,
} from './helpers/listSorting.js';
import { shouldIgnoreRowSelectionClick } from './helpers/rowSelection.js';
import { resolveInitialConnectionSegment } from './helpers/defaultConnectionSegment.js';
import {
  buildSiteSaveAction,
  emptySiteApiEndpoint,
  emptySiteCustomHeader,
  emptySiteForm,
  serializeSiteApiEndpoints,
  serializeSiteCustomHeaders,
  siteFormFromSite,
  type SiteEditorState,
  type SiteApiEndpointField,
  type SiteForm,
} from './helpers/sitesEditor.js';
import {
  detectSiteInitializationPreset,
  getSiteInitializationPreset,
  listSiteInitializationPresets,
} from '../../shared/siteInitializationPresets.js';
import { analyzePrimarySiteUrl } from '../../shared/sitePrimaryUrl.js';
import { Button } from '../components/ui/button/index.js';
import ToneBadge from '../components/ToneBadge.js';
import InfoNote from '../components/InfoNote.js';
import EmptyStateBlock from '../components/EmptyStateBlock.js';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert/index.js';
import { Card } from '../components/ui/card/index.js';
import { DataTable, DataTableToolbar } from '../components/ui/data-table/index.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table/index.js';
import { Checkbox } from '../components/ui/checkbox/index.js';
import { Input } from '../components/ui/input/index.js';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group/index.js';
import { Skeleton } from '../components/ui/skeleton/index.js';
import * as DropdownMenu from '../components/ui/dropdown-menu/index.js';
import {
  CheckCircle2,
  CircleSlash,
  Ellipsis,
  GripVertical,
  LoaderCircle,
  Network,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import {
  emptyUpstreamCompatibilityPolicyForm,
  policyFormFromStoredValue,
  serializeCompatibilityPolicyForm,
} from '../lib/upstreamCompatibilityPolicyEditor.js';

type SiteSubscriptionSummary = {
  activeCount: number;
  totalUsedUsd: number;
  totalMonthlyLimitUsd?: number | null;
  totalRemainingUsd?: number | null;
  nextExpiresAt?: string | null;
  planNames?: string[];
  updatedAt?: number | null;
};

type SiteRow = {
  id: number;
  name: string;
  url: string;
  externalCheckinUrl?: string | null;
  platform?: string;
  status?: string;
  proxyUrl?: string | null;
  useSystemProxy?: boolean;
  customHeaders?: string | null;
  compatibilityPolicy?: unknown;
  globalWeight?: number;
  isPinned?: boolean;
  sortOrder?: number;
  totalBalance?: number;
  subscriptionSummary?: SiteSubscriptionSummary | null;
  createdAt?: string;
  postRefreshProbeEnabled?: boolean;
  postRefreshProbeModel?: string | null;
  postRefreshProbeScope?: string | null;
  postRefreshProbeLatencyThresholdMs?: number | null;
  apiEndpoints?: Array<{
    id?: number;
    url: string;
    enabled?: boolean;
    sortOrder?: number;
    cooldownUntil?: string | null;
    lastFailureReason?: string | null;
  }>;
};

function hasConfiguredCustomHeaders(customHeaders?: string | null): boolean {
  return typeof customHeaders === 'string' && customHeaders.trim().length > 0;
}

function getConfiguredSiteApiEndpoints(site?: Pick<SiteRow, 'apiEndpoints'> | null) {
  return Array.isArray(site?.apiEndpoints)
    ? site.apiEndpoints.filter((item) => typeof item?.url === 'string' && item.url.trim())
    : [];
}

function buildSiteApiEndpointSummary(site?: Pick<SiteRow, 'apiEndpoints'> | null): string {
  const endpoints = getConfiguredSiteApiEndpoints(site);
  if (endpoints.length <= 0) return tr('pages.sites.sitesUrl');
  const enabledCount = endpoints.filter((item) => item.enabled !== false).length;
  return `${enabledCount}/${endpoints.length} 条启用`;
}

function SiteApiEndpointSummaryBadge({ site }: { site: Pick<SiteRow, 'apiEndpoints'> }) {
  const summary = buildSiteApiEndpointSummary(site);
  return (
    <ToneBadge
      tone={getConfiguredSiteApiEndpoints(site).length > 0 ? 'warning' : 'muted'}
      className="max-w-full gap-1"
      title={`${tr('pages.sites.api')} ${summary}`}
    >
      <span className="shrink-0">{tr('pages.sites.api')}</span>
      <span className="min-w-0 truncate">{summary}</span>
    </ToneBadge>
  );
}

type SortableSiteTableRowProps = Omit<ComponentPropsWithoutRef<typeof TableRow>, 'children' | 'ref'> & {
  site: SiteRow;
  selected: boolean;
  rowRef?: (node: HTMLTableRowElement | null) => void;
  children: (dragHandle: {
    setActivatorNodeRef: (node: HTMLElement | null) => void;
    attributes: Record<string, any>;
    listeners: Record<string, any> | undefined;
    isDragging: boolean;
  }) => ReactNode;
};

function SortableSiteTableRow({
  site,
  selected,
  rowRef,
  className,
  children,
  style,
  ...props
}: SortableSiteTableRowProps) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: site.id,
  });

  return (
    <TableRow
      ref={(node) => {
        setNodeRef(node);
        rowRef?.(node);
      }}
      data-state={selected ? 'selected' : undefined}
      data-dragging={isDragging ? 'true' : undefined}
      className={`${className || ''} ${isDragging ? 'relative z-10 bg-muted shadow-sm' : ''}`.trim()}
      style={{
        ...style,
        visibility: isDragging ? 'hidden' : undefined,
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      {...props}
    >
      {children({
        setActivatorNodeRef,
        attributes: attributes as Record<string, any>,
        listeners: listeners as Record<string, any> | undefined,
        isDragging,
      })}
    </TableRow>
  );
}

function SiteDragOverlayCard({ site }: { site: SiteRow }) {
  return (
    <div className="pointer-events-none flex min-w-[360px] max-w-[560px] items-center gap-3 rounded-md border bg-popover px-3 py-2 text-popover-foreground shadow-lg">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
        <GripVertical className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{site.name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <ToneBadge tone={platformColors[site.platform || ''] || 'muted'}>
            {site.platform || '-'}
          </ToneBadge>
          <span className="text-xs tabular-nums text-muted-foreground">
            {tr('pages.sites.weight')} {(site.globalWeight || 1).toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}

function formatUsd(value?: number | null): string {
  return `$${(value || 0).toFixed(2)}`;
}

function formatSiteCreatedAtParts(value?: string | null): { full: string; date: string; time: string | null } {
  const full = formatDateTimeLocal(value);
  const match = /^(.+?)\s+(\d{2}:\d{2}(?::\d{2})?)$/.exec(full);
  if (!match) return { full, date: full, time: null };
  return { full, date: match[1]!, time: match[2]! };
}

function resolveSiteCreatedSessionLabel(platform?: string | null): string {
  const normalized = String(platform || '').trim().toLowerCase();
  if (normalized === 'codex') return tr('pages.sites.addOauth');
  return tr('components.siteCreatedModal.addAccountUsernamepasswordsign');
}

/**
 * 跳转到站点对应的连接补全流程。
 */
function buildSiteConnectionSearchParams(input: {
  siteId: number;
  initializationPresetId?: string | null;
}) {
  const params = new URLSearchParams({
    create: '1',
    siteId: String(input.siteId),
  });
  if (input.initializationPresetId) {
    params.set('initPreset', input.initializationPresetId);
  }
  return params;
}

function formatSubscriptionDate(value?: string | null): string {
  if (!value) return '';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toISOString().slice(0, 10);
}

function formatRemainingDuration(value?: string | null): string | null {
  if (!value) return null;
  const targetMs = Date.parse(value);
  if (!Number.isFinite(targetMs)) return null;
  const deltaMs = targetMs - Date.now();
  if (deltaMs <= 0) return tr('pages.sites.expired');

  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (deltaMs >= dayMs) return `剩余${Math.ceil(deltaMs / dayMs)}天`;
  if (deltaMs >= hourMs) return `剩余${Math.ceil(deltaMs / hourMs)}小时`;
  if (deltaMs >= minuteMs) return `剩余${Math.ceil(deltaMs / minuteMs)}分钟`;
  return `剩余${Math.max(1, Math.ceil(deltaMs / 1000))}秒`;
}

function buildSubscriptionInlineValue(summary?: SiteSubscriptionSummary | null): string | null {
  if (!summary) return null;
  const remainingValue = typeof summary.totalRemainingUsd === 'number' && Number.isFinite(summary.totalRemainingUsd)
    ? formatUsd(summary.totalRemainingUsd)
    : '--';
  const usedValue = formatUsd(summary.totalUsedUsd);
  const remainingDuration = formatRemainingDuration(summary.nextExpiresAt);
  const remainingSuffix = remainingDuration ? `（${remainingDuration}）` : '';
  if (usedValue === '$0.00' && remainingValue === '--' && !remainingSuffix) return null;
  return `${remainingValue}${remainingSuffix}`;
}

function buildSubscriptionTooltip(summary?: SiteSubscriptionSummary | null): string | null {
  if (!summary) return null;
  const parts: string[] = [];
  if (summary.activeCount > 0) parts.push(`生效订阅 ${summary.activeCount} 个`);

  const planNames = Array.isArray(summary.planNames)
    ? summary.planNames.filter((item) => typeof item === 'string' && item.trim())
    : [];
  if (planNames.length > 0) parts.push(`套餐 ${planNames.join(' / ')}`);

  if (typeof summary.totalRemainingUsd === 'number' && Number.isFinite(summary.totalRemainingUsd)) {
    parts.push(`订阅余额 ${formatUsd(summary.totalRemainingUsd)}`);
  }
  parts.push(`已用 ${formatUsd(summary.totalUsedUsd)}`);

  if (typeof summary.totalMonthlyLimitUsd === 'number' && Number.isFinite(summary.totalMonthlyLimitUsd)) {
    parts.push(`总额度 ${formatUsd(summary.totalMonthlyLimitUsd)}`);
  }

  const remainingDuration = formatRemainingDuration(summary.nextExpiresAt);
  if (remainingDuration) parts.push(remainingDuration);

  if (summary.nextExpiresAt) parts.push(`到期 ${formatSubscriptionDate(summary.nextExpiresAt)}`);

  return parts.join(' | ');
}

function SiteBalanceDisplay(props: {
  balance?: number | null;
  summary?: SiteSubscriptionSummary | null;
  align?: 'start' | 'end';
}) {
  const { balance, summary, align = 'start' } = props;
  const walletBalanceText = formatUsd(balance);
  const subscriptionValue = buildSubscriptionInlineValue(summary);
  const tooltip = buildSubscriptionTooltip(summary);

  return (
    <div
      className={`site-balance-inline ${align === 'end' ? 'align-end' : ''}`.trim()}
    >
      <span className="site-balance-primary">{walletBalanceText}</span>
      {subscriptionValue ? (
        <>
          <span className="site-balance-divider">/</span>
          <span
            className="site-balance-subscription"
            data-tooltip={tooltip || undefined}
            data-tooltip-align={align === 'end' ? 'end' : 'start'}
            data-tooltip-side="top"
            tabIndex={tooltip ? 0 : undefined}
          >
            {subscriptionValue}
          </span>
        </>
      ) : null}
    </div>
  );
}

const platformColors: Record<string, string> = {
  'new-api': 'info',
  'one-api': 'success',
  anyrouter: 'warning',
  veloera: 'warning',
  'one-hub': 'muted',
  'done-hub': 'muted',
  sub2api: 'muted',
  openai: 'success',
  codex: 'success',
  claude: 'warning',
  gemini: 'info',
  cliproxyapi: 'info',
};

const SITE_PLATFORM_OPTIONS = [
  { value: '', label: tr('pages.sites.platformTypeCanAutomaticallyDetected') },
  { value: 'new-api', label: 'new-api', description: tr('pages.sites.aggregationPanelUnifiedMultiChannelManagement') },
  { value: 'one-api', label: 'one-api', description: tr('pages.sites.generalOpenaiZh') },
  { value: 'anyrouter', label: 'anyrouter', description: tr('pages.sites.anyDays') },
  { value: 'veloera', label: 'veloera', description: tr('pages.sites.veloeraSitesActing') },
  { value: 'one-hub', label: 'one-hub', description: tr('pages.sites.accounts') },
  { value: 'done-hub', label: 'done-hub', description: tr('pages.sites.aggregationPanelUnifiedForwardingManagement') },
  { value: 'sub2api', label: 'sub2api', description: tr('pages.sites.zhSyncBalanceinfo') },
  { value: 'openai', label: 'openai', description: tr('pages.sites.generalOpenaiBaseUrl') },
  { value: 'codex', label: 'codex', description: tr('pages.sites.codexOauthSession') },
  { value: 'claude', label: 'claude', description: tr('pages.sites.generalClaudeAnthropic') },
  { value: 'gemini', label: 'gemini', description: tr('pages.sites.generalGeminiGoogleAi') },
  { value: 'cliproxyapi', label: 'cliproxyapi', description: tr('pages.sites.cpa') },
];

function SitesLoadingSkeleton({ isMobile }: { isMobile: boolean }) {
  if (isMobile) {
    return (
      <div className="grid gap-3">
        {[0, 1, 2].map((index) => (
          <MobileCard
            key={index}
            title={<Skeleton className="h-5 w-40" />}
            subtitle={<Skeleton className="h-4 w-60 max-w-full" />}
          >
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
          </MobileCard>
        ))}
      </div>
    );
  }

  return (
    <DataTable minWidth={1120} density="compact" aria-busy="true">
      <DataTableToolbar className="border-b bg-muted/30 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Skeleton className="size-4" />
          <div className="grid gap-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
        </div>
      </DataTableToolbar>
      <Table className="sites-table w-full text-sm">
        <TableHeader>
          <TableRow>
            <TableHead className="w-11" />
            <TableHead className="w-11" />
            <TableHead className="min-w-56">{tr('pages.models.name')}</TableHead>
            <TableHead className="min-w-64">{tr('pages.sites.signUrl')}</TableHead>
            <TableHead className="min-w-32 text-right">{tr('pages.sites.balance')}</TableHead>
            <TableHead className="sites-status-col text-center">{tr('components.notificationPanel.status')}</TableHead>
            <TableHead className="sites-system-proxy-col text-center">{tr('pages.settings.systemacting3')}</TableHead>
            <TableHead className="sites-weight-col text-right">{tr('pages.sites.weight')}</TableHead>
            <TableHead className="min-w-32">{tr('pages.sites.platform')}</TableHead>
            <TableHead className="sites-created-col">{tr('pages.sites.time')}</TableHead>
            <TableHead className="sites-actions-col text-right">{tr('pages.accounts.actions2')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[0, 1, 2, 3, 4].map((index) => (
            <TableRow key={index}>
              <TableCell><Skeleton className="size-8" /></TableCell>
              <TableCell><Skeleton className="size-4" /></TableCell>
              <TableCell>
                <div className="grid gap-2">
                  <Skeleton className="h-4 w-44" />
                  <div className="flex gap-1.5">
                    <Skeleton className="h-5 w-24 rounded-full" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                </div>
              </TableCell>
              <TableCell><Skeleton className="h-4 w-56" /></TableCell>
              <TableCell><Skeleton className="ml-auto h-5 w-24" /></TableCell>
              <TableCell><Skeleton className="mx-auto h-5 w-16 rounded-full" /></TableCell>
              <TableCell><Skeleton className="mx-auto h-5 w-16 rounded-full" /></TableCell>
              <TableCell><Skeleton className="ml-auto h-5 w-12" /></TableCell>
              <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
              <TableCell>
                <div className="grid gap-1">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-14" />
                </div>
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-1.5">
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-8 w-14" />
                  <Skeleton className="size-8" />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DataTable>
  );
}

export default function Sites() {
  const location = useLocation();
  const navigate = useNavigate();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('custom');
  const [highlightSiteId, setHighlightSiteId] = useState<number | null>(null);
  const [editor, setEditor] = useState<SiteEditorState | null>(null);
  const apiEndpointDraftIdRef = useRef(0);
  const createApiEndpointDraftId = () => {
    apiEndpointDraftIdRef.current += 1;
    return `site-api-endpoint-draft-${apiEndpointDraftIdRef.current}`;
  };
  const createEmptyApiEndpointRow = (): SiteApiEndpointField => ({
    ...emptySiteApiEndpoint(),
    draftId: createApiEndpointDraftId(),
  });
  const hydrateSiteForm = (value: SiteForm): SiteForm => {
    const sourceRows = value.apiEndpoints.length > 0 ? value.apiEndpoints : [createEmptyApiEndpointRow()];
    return {
      ...value,
      apiEndpoints: sourceRows.map((endpoint) => ({
        ...endpoint,
        draftId: endpoint.draftId || createApiEndpointDraftId(),
      })),
    };
  };
  const createEmptySiteForm = (): SiteForm => hydrateSiteForm(emptySiteForm());
  const [form, setForm] = useState<SiteForm>(() => createEmptySiteForm());
  const [compatibilityPolicyForm, setCompatibilityPolicyForm] = useState(() => emptyUpstreamCompatibilityPolicyForm());
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [togglingSiteId, setTogglingSiteId] = useState<number | null>(null);
  const [orderingSiteId, setOrderingSiteId] = useState<number | null>(null);
  const [draggingSiteId, setDraggingSiteId] = useState<number | null>(null);
  const [pinningSiteId, setPinningSiteId] = useState<number | null>(null);
  const [selectedSiteIds, setSelectedSiteIds] = useState<number[]>([]);
  const [expandedSiteIds, setExpandedSiteIds] = useState<number[]>([]);
  const [createdSiteForChoice, setCreatedSiteForChoice] = useState<{
    id: number;
    name: string;
    platform?: string | null;
    initializationPresetId?: string | null;
  } | null>(null);
  const [selectedInitializationPresetId, setSelectedInitializationPresetId] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const [showMobileTools, setShowMobileTools] = useState(false);
  const [batchActionLoading, setBatchActionLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<null | {
    mode: 'single' | 'batch';
    siteId?: number;
    siteName?: string;
    count?: number;
  }>(null);
  const lastEditorRef = useRef<SiteEditorState | null>(null);
  const loadingModelsSiteIdRef = useRef<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());
  const highlightTimerRef = useRef<number | null>(null);
  const toast = useToast();
  const [disabledModels, setDisabledModels] = useState<string[]>([]);
  const [disabledModelInput, setDisabledModelInput] = useState('');
  const [disabledModelsLoading, setDisabledModelsLoading] = useState(false);
  const [disabledModelsSaving, setDisabledModelsSaving] = useState(false);
  const [probeEnabled, setProbeEnabled] = useState(false);
  const [probeModel, setProbeModel] = useState('');
  const [probeScope, setProbeScope] = useState<'single' | 'all'>('single');
  const [probeSaving, setProbeSaving] = useState(false);
  const [probeLatencyThreshold, setProbeLatencyThreshold] = useState('0');
  const [probing, setProbing] = useState(false);
  type ProbeLogEntry = { time: string; text: string; color?: string };
  const [probeLog, setProbeLog] = useState<ProbeLogEntry[]>([]);
  const [probeCompleted, setProbeCompleted] = useState(false);
  const probeAbortRef = useRef<AbortController | null>(null);
  const probeLogEndRef = useRef<HTMLDivElement | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [disabledModelSearch, setDisabledModelSearch] = useState('');
  const initializationPresetOptions = useMemo(() => listSiteInitializationPresets(), []);
  const selectedInitializationPreset = useMemo(
    () => getSiteInitializationPreset(selectedInitializationPresetId),
    [selectedInitializationPresetId],
  );
  const primarySiteUrlAnalysis = useMemo(() => analyzePrimarySiteUrl(form.url), [form.url]);
  const latestPrimarySiteUrlRef = useRef(form.url);
  const latestPlatformRef = useRef(form.platform);
  const latestInitializationPresetIdRef = useRef(selectedInitializationPresetId);

  useEffect(() => {
    latestPrimarySiteUrlRef.current = form.url;
  }, [form.url]);

  useEffect(() => {
    latestPlatformRef.current = form.platform;
  }, [form.platform]);

  useEffect(() => {
    latestInitializationPresetIdRef.current = selectedInitializationPresetId;
  }, [selectedInitializationPresetId]);

  useEffect(() => {
    if (!editor) {
      probeAbortRef.current?.abort();
      probeAbortRef.current = null;
    }
  }, [editor]);

  useEffect(() => () => {
    probeAbortRef.current?.abort();
    probeAbortRef.current = null;
  }, []);

  const disabledModelSet = useMemo(() => new Set(disabledModels), [disabledModels]);

  const brandGroups = useMemo(() => {
    const allModels = Array.from(new Set([...availableModels, ...disabledModels]));
    const groups = new Map<string, string[]>();
    for (const model of allModels) {
      const brand = getBrand(model);
      const brandName = brand?.name || tr('pages.models.other');
      if (!groups.has(brandName)) groups.set(brandName, []);
      groups.get(brandName)!.push(model);
    }
    return [...groups.entries()].sort((a, b) => {
      if (a[0] === '其他') return 1;
      if (b[0] === '其他') return -1;
      return a[0].localeCompare(b[0], undefined, { sensitivity: 'base' });
    });
  }, [availableModels, disabledModels]);

  const filteredBrandGroups = useMemo(() => {
    const q = disabledModelSearch.trim().toLowerCase();
    if (!q) return brandGroups;
    return brandGroups
      .map(([brandName, models]) => [brandName, models.filter((m) => m.toLowerCase().includes(q))] as [string, string[]])
      .filter(([, models]) => models.length > 0);
  }, [brandGroups, disabledModelSearch]);

  if (editor) lastEditorRef.current = editor;
  const activeEditor = editor || lastEditorRef.current;
  const isEditing = activeEditor?.mode === 'edit';
  const isAdding = editor?.mode === 'add';

  const load = async () => {
    try {
      const rows = await api.getSites();
      setSites(rows || []);
      setSelectedSiteIds((current) => current.filter((id) => (rows || []).some((site: SiteRow) => site.id === id)));
    } catch {
      toast.error(tr('pages.sites.failedLoadSiteList'));
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const sortedSites = useMemo(
    () => sortItemsForDisplay(sites, sortMode, (site) => site.totalBalance || 0),
    [sites, sortMode],
  );
  const draggingSite = draggingSiteId == null
    ? null
    : sortedSites.find((site) => site.id === draggingSiteId) || null;
  const siteReorderSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );
  const allVisibleSitesSelected = sortedSites.length > 0 && sortedSites.every((site) => selectedSiteIds.includes(site.id));
  const someVisibleSitesSelected =
    !allVisibleSitesSelected &&
    sortedSites.some((site) => selectedSiteIds.includes(site.id));
  const selectedSiteCountText = tr('pages.sites.selectedCount').replace(
    '{count}',
    String(selectedSiteIds.length),
  );
  const visibleSiteCountText = tr('pages.sites.visibleCount').replace(
    '{count}',
    String(sortedSites.length),
  );

  const platformOptions = useMemo(() => {
    const current = form.platform.trim();
    const genericOptions = (!current || SITE_PLATFORM_OPTIONS.some((option) => option.value === current))
      ? SITE_PLATFORM_OPTIONS
      : [
        ...SITE_PLATFORM_OPTIONS,
        { value: current, label: `${current}（当前值）` },
      ];
    const presetOptions = initializationPresetOptions.map((preset) => ({
      value: `preset:${preset.id}`,
      label: preset.label,
      description: [
        preset.defaultUrl ? tr('pages.sites.automaticOfficial') : '',
        preset.recommendedSkipModelFetch ? tr('pages.sites.apiKey') : '',
      ].filter(Boolean).join(' · '),
    }));
    return [
      genericOptions[0]!,
      ...presetOptions,
      ...genericOptions.slice(1),
    ];
  }, [form.platform, initializationPresetOptions]);
  const activeInitializationPreset = selectedInitializationPreset;
  const platformSelectValue = selectedInitializationPreset ? `preset:${selectedInitializationPreset.id}` : form.platform;

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const focusSiteId = readFocusSiteId(location.search);
    if (!focusSiteId || !loaded) return;

    const row = rowRefs.current.get(focusSiteId);
    const cleanedSearch = clearFocusParams(location.search);
    if (!row) {
      navigate({ pathname: location.pathname, search: cleanedSearch }, { replace: true });
      return;
    }

    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightSiteId(focusSiteId);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightSiteId((current) => (current === focusSiteId ? null : current));
    }, 2200);

    navigate({ pathname: location.pathname, search: cleanedSearch }, { replace: true });
  }, [loaded, location.pathname, location.search, navigate, sortedSites]);

  const closeEditor = () => {
    setEditor(null);
    setForm(createEmptySiteForm());
    setCompatibilityPolicyForm(emptyUpstreamCompatibilityPolicyForm());
    setSelectedInitializationPresetId(null);
  };

  const scrollToEditorTop = () => {
    const scrollTo = (globalThis as { scrollTo?: (options?: ScrollToOptions) => void }).scrollTo;
    if (typeof scrollTo === 'function') {
      scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const openAdd = () => {
    if (isAdding) {
      closeEditor();
      return;
    }
    setEditor({ mode: 'add' });
    setForm(createEmptySiteForm());
    setCompatibilityPolicyForm(emptyUpstreamCompatibilityPolicyForm());
    setSelectedInitializationPresetId(null);
    scrollToEditorTop();
  };

  const openEdit = (site: SiteRow) => {
    setEditor({ mode: 'edit', editingSiteId: site.id });
    setForm(hydrateSiteForm(siteFormFromSite(site)));
    setCompatibilityPolicyForm(policyFormFromStoredValue(site.compatibilityPolicy));
    setSelectedInitializationPresetId(detectSiteInitializationPreset(site.url, site.platform)?.id || null);
    scrollToEditorTop();
    // Load disabled models and discovered models independently so a best-effort
    // availability fetch cannot wipe the existing disabled-model state.
    const loadSiteId = site.id;
    loadingModelsSiteIdRef.current = loadSiteId;
    setDisabledModelsLoading(true);
    setDisabledModels([]);
    setDisabledModelInput('');
    setAvailableModels([]);
    setDisabledModelSearch('');
    setProbeEnabled(!!site.postRefreshProbeEnabled);
    setProbeModel(typeof site.postRefreshProbeModel === 'string' ? site.postRefreshProbeModel : '');
    setProbeScope(site.postRefreshProbeScope === 'all' ? 'all' : 'single');
    setProbeLatencyThreshold(String(site.postRefreshProbeLatencyThresholdMs ?? 0));
    setProbeLog([]);
    setProbeCompleted(false);
    probeAbortRef.current?.abort();
    probeAbortRef.current = null;
    let pendingLoads = 2;
    const markLoadFinished = () => {
      pendingLoads -= 1;
      if (pendingLoads <= 0 && loadingModelsSiteIdRef.current === loadSiteId) {
        setDisabledModelsLoading(false);
      }
    };

    api.getSiteDisabledModels(site.id)
      .then((disabledRes: any) => {
        if (loadingModelsSiteIdRef.current !== loadSiteId) return;
        setDisabledModels(Array.isArray(disabledRes?.models) ? disabledRes.models : []);
      })
      .catch((err: any) => {
        console.warn('Failed to load site disabled models:', err?.message || err);
      })
      .finally(markLoadFinished);

    api.getSiteAvailableModels(site.id)
      .then((availableRes: any) => {
        if (loadingModelsSiteIdRef.current !== loadSiteId) return;
        setAvailableModels(Array.isArray(availableRes?.models) ? availableRes.models : []);
      })
      .catch((err: any) => {
        console.warn('Failed to load site available models:', err?.message || err);
      })
      .finally(markLoadFinished);
  };

  const handleAddDisabledModel = () => {
    const model = disabledModelInput.trim();
    if (!model) return;
    if (disabledModels.includes(model)) {
      toast.info(`模型 "${model}" 已在禁用列表中`);
      setDisabledModelInput('');
      return;
    }
    setDisabledModels((prev) => [...prev, model]);
    setDisabledModelInput('');
  };

  const handleSaveDisabledModels = async () => {
    if (!editor || editor.mode !== 'edit') return;
    setDisabledModelsSaving(true);
    try {
      await api.updateSiteDisabledModels(editor.editingSiteId, disabledModels);
      try {
        await api.rebuildRoutes(false, false);
        toast.success(tr('pages.sites.disabledmodelSaveRoutes'));
      } catch {
        toast.error(tr('pages.sites.disabledmodelSaveRoutesFailedManualrefreshroutes'));
      }
    } catch (e: any) {
      toast.error(e.message || tr('pages.sites.savedisabledmodelfailed'));
    } finally {
      setDisabledModelsSaving(false);
    }
  };

  const handleSaveProbeSettings = async () => {
    if (!editor || editor.mode !== 'edit') return;
    setProbeSaving(true);
    try {
      await api.updateSite(editor.editingSiteId, {
        postRefreshProbeEnabled: probeEnabled,
        postRefreshProbeModel: probeModel.trim(),
        postRefreshProbeScope: probeScope,
        postRefreshProbeLatencyThresholdMs: Math.max(0, parseInt(probeLatencyThreshold, 10) || 0),
      });
      setSites((prev) => prev.map((s) => s.id === editor.editingSiteId
        ? { ...s, postRefreshProbeEnabled: probeEnabled, postRefreshProbeModel: probeModel.trim(), postRefreshProbeScope: probeScope, postRefreshProbeLatencyThresholdMs: Math.max(0, parseInt(probeLatencyThreshold, 10) || 0) }
        : s,
      ));
      toast.success(tr('pages.sites.refreshSettingsSave'));
    } catch (e: any) {
      toast.error(e.message || tr('pages.accounts.saveFailed'));
    } finally {
      setProbeSaving(false);
    }
  };

  const handleProbeNow = async () => {
    if (!editor || editor.mode !== 'edit') return;
    const siteId = editor.editingSiteId;
    const now = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const addLog = (text: string, color?: string) =>
      setProbeLog((prev) => [...prev, { time: now(), text, color }]);

    probeAbortRef.current?.abort();
    const controller = new AbortController();
    probeAbortRef.current = controller;
    setProbing(true);
    setProbeLog([]);
    setProbeCompleted(false);

    try {
      const token = getAuthToken(localStorage);
      const params = new URLSearchParams({ scope: probeScope });
      if (probeScope === 'single' && probeModel.trim()) params.set('modelName', probeModel.trim());
      const threshold = parseInt(probeLatencyThreshold, 10);
      if (Number.isFinite(threshold) && threshold > 0) params.set('latencyThresholdMs', String(threshold));

      const res = await fetch(`/api/sites/${siteId}/probe-stream?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        let errMsg = `连接失败 (HTTP ${res.status})`;
        try { const j = await res.json() as any; errMsg = j?.error || j?.message || errMsg; } catch { /* ignore */ }
        addLog(errMsg, 'var(--color-error, #ef4444)');
        toast.error(errMsg);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      const handleSseEvent = (type: string, rawData: string) => {
        try {
          const d = JSON.parse(rawData);
          if (type === 'start') {
            addLog(`开始探测，范围：${d.scope === 'all' ? tr('pages.sites.allmodel') : tr('pages.sites.model2')}，共 ${d.modelsCount} 个`);
          } else if (type === 'model') {
            const s = d.status === 'supported' ? tr('pages.sites.available2')
              : d.status === 'unsupported'
                ? (d.latencyExceeded ? `✗ 延迟超限 (${d.latencyMs}ms)` : tr('pages.sites.notAvailable'))
              : d.status === 'skipped' ? tr('pages.sites.jumpOver')
              : tr('pages.sites.notAvailable');
            const lat = d.latencyMs != null && d.status !== 'skipped' ? ` (${d.latencyMs}ms)` : '';
            const c = d.status === 'supported' ? 'var(--color-success, #22c55e)'
              : d.status === 'skipped' ? 'var(--color-text-muted)'
              : 'var(--color-error, #ef4444)';
            const reasonText = (() => {
              if (!d.reason || d.status === 'supported' || d.status === 'skipped') return '';
              const r = d.reason;
              if (/timeout/i.test(r)) return tr('pages.dashboard.timeOut');
              if (/missing credential|no.*token/i.test(r)) return tr('pages.sites.noneToken');
              if (/no compatible.*endpoint|no.*endpoint candidate/i.test(r)) return tr('pages.sites.noneavailable');
              if (/no such model|unknown model/i.test(r)) return tr('pages.sites.model');
              if (/not found/i.test(r)) return tr('pages.accounts.notFound');
              if (/access denied|forbidden|permission/i.test(r)) return tr('pages.sites.noPermission');
              if (/rate.?limit|too many request/i.test(r)) return tr('pages.sites.hitRateLimit');
              if (/响应延迟/.test(r)) return r;
              return r.length > 60 ? r.slice(0, 57) + '…' : r;
            })();
            addLog(`${s}${lat}  ${d.modelName}${reasonText ? `  —  ${reasonText}` : ''}`, c);
            setTimeout(() => probeLogEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
          } else if (type === 'action') {
            if (d.action === 'disabled') addLog(`  ↳ 已加入站点禁用列表: ${d.modelName}`, 'var(--color-text-muted)');
          } else if (type === 'complete') {
            if (d.unsupported > 0) {
              addLog(`完成：${d.probed} 个模型已探测，${d.unsupported} 个不可用已自动加入禁用列表`, 'var(--color-error, #ef4444)');
              toast.error(`${d.unsupported} 个模型不可用，已自动加入站点禁用列表`);
            } else {
              addLog(`完成：${d.probed} 个模型均可用`, 'var(--color-success, #22c55e)');
              toast.success(`探测完成：${d.probed} 个模型均可用`);
            }
            setTimeout(() => probeLogEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
            // Refresh model lists to reflect probe results
            Promise.all([
              api.getSiteAvailableModels(siteId).then((res: any) => {
                setAvailableModels(Array.isArray(res?.models) ? res.models : []);
              }),
              api.getSiteDisabledModels(siteId).then((res: any) => {
                setDisabledModels(Array.isArray(res?.models) ? res.models : []);
              }),
            ]).catch(() => {}).finally(() => setProbeCompleted(true));
          } else if (type === 'error') {
            addLog(d.message || tr('pages.sites.failed3'), 'var(--color-error, #ef4444)');
            toast.error(d.message || tr('pages.sites.failed3'));
            // Refresh model state even on error
            Promise.all([
              api.getSiteAvailableModels(siteId).then((res: any) => {
                setAvailableModels(Array.isArray(res?.models) ? res.models : []);
              }),
              api.getSiteDisabledModels(siteId).then((res: any) => {
                setDisabledModels(Array.isArray(res?.models) ? res.models : []);
              }),
            ]).catch(() => {}).finally(() => setProbeCompleted(true));
          }
        } catch { /* ignore parse errors */ }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          let eventType = 'message';
          let data = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            else if (line.startsWith('data: ')) data = line.slice(6).trim();
          }
          if (data) handleSseEvent(eventType, data);
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setProbeLog((prev) => [...prev, { time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), text: tr('pages.sites.manualstop'), color: 'var(--color-text-muted)' }]);
        return;
      }
      addLog(e?.message || tr('pages.sites.failed3'), 'var(--color-error, #ef4444)');
      toast.error(e?.message || tr('pages.sites.failed3'));
    } finally {
      setProbing(false);
      probeAbortRef.current = null;
    }
  };

  const handleSave = async () => {
    if (!editor) return;
    const parsedGlobalWeight = Number(form.globalWeight);
    if (!Number.isFinite(parsedGlobalWeight) || parsedGlobalWeight <= 0) {
      toast.error(tr('pages.sites.weight0'));
      return;
    }
    const serializedCustomHeaders = serializeSiteCustomHeaders(form.customHeaders);
    if (!serializedCustomHeaders.valid) {
      toast.error(serializedCustomHeaders.error || tr('pages.sites.customRequest'));
      return;
    }
    const serializedApiEndpoints = serializeSiteApiEndpoints(form.apiEndpoints);
    if (!serializedApiEndpoints.valid) {
      toast.error(serializedApiEndpoints.error || tr('pages.sites.apiRequest'));
      return;
    }
    const serializedCompatibilityPolicy = serializeCompatibilityPolicyForm(compatibilityPolicyForm);
    if (!serializedCompatibilityPolicy.ok) {
      toast.error(serializedCompatibilityPolicy.error);
      return;
    }

    const payload = {
      name: form.name.trim(),
      url: primarySiteUrlAnalysis.persistedUrl || form.url.trim(),
      externalCheckinUrl: form.externalCheckinUrl.trim(),
      platform: form.platform.trim(),
      initializationPresetId: selectedInitializationPresetId,
      proxyUrl: form.proxyUrl.trim(),
      useSystemProxy: !!form.useSystemProxy,
      apiEndpoints: serializedApiEndpoints.apiEndpoints,
      customHeaders: serializedCustomHeaders.customHeaders,
      compatibilityPolicy: serializedCompatibilityPolicy.policy,
      globalWeight: Number(parsedGlobalWeight.toFixed(3)),
      postRefreshProbeEnabled: probeEnabled,
      postRefreshProbeModel: probeModel.trim(),
      postRefreshProbeScope: probeScope,
      postRefreshProbeLatencyThresholdMs: Math.max(0, parseInt(probeLatencyThreshold, 10) || 0),
    };
    if (!payload.name || !payload.url) {
      toast.error(tr('pages.sites.pleaseFillSiteNameUrl'));
      return;
    }

    setSaving(true);
    try {
      const action = buildSiteSaveAction(editor, payload);
      if (action.kind === 'add') {
        const created = await api.addSite(action.payload);
        toast.success(`站点 "${payload.name}" 已添加`);
        if (
          primarySiteUrlAnalysis.action === 'auto_strip_known_api_suffix'
          && typeof created?.url === 'string'
          && created.url.trim()
        ) {
          toast.info(`已自动规范化主站点 URL 为 ${created.url.trim()}`);
        }
        const createdSiteId = Number(created?.id) || 0;
        if (createdSiteId > 0) {
          const createdPlatform = typeof created?.platform === 'string' && created.platform.trim()
            ? created.platform.trim()
            : payload.platform;
          const returnedPreset = getSiteInitializationPreset(created?.initializationPresetId);
          const fallbackPreset = selectedInitializationPreset && selectedInitializationPreset.platform === createdPlatform
            ? selectedInitializationPreset
            : null;
          setCreatedSiteForChoice({
            id: createdSiteId,
            name: payload.name,
            platform: createdPlatform,
            initializationPresetId: returnedPreset?.id || fallbackPreset?.id || null,
          });
        }
      } else {
        const updated = await api.updateSite(action.id, action.payload);
        toast.success(`站点 "${payload.name}" 已更新`);
        if (
          primarySiteUrlAnalysis.action === 'auto_strip_known_api_suffix'
          && typeof updated?.url === 'string'
          && updated.url.trim()
        ) {
          toast.info(`已自动规范化主站点 URL 为 ${updated.url.trim()}`);
        }
      }
      closeEditor();
      await load();
    } catch (e: any) {
      toast.error(e.message || tr('pages.accounts.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const updateCustomHeaderRow = (index: number, field: 'key' | 'value', value: string) => {
    setForm((prev) => ({
      ...prev,
      customHeaders: prev.customHeaders.map((item, itemIndex) => (
        itemIndex === index
          ? { ...item, [field]: value }
          : item
      )),
    }));
  };

  const addCustomHeaderRow = () => {
    setForm((prev) => ({
      ...prev,
      customHeaders: [...prev.customHeaders, emptySiteCustomHeader()],
    }));
  };

  const removeCustomHeaderRow = (index: number) => {
    setForm((prev) => {
      const nextHeaders = prev.customHeaders.filter((_, itemIndex) => itemIndex !== index);
      return {
        ...prev,
        customHeaders: nextHeaders.length > 0 ? nextHeaders : [emptySiteCustomHeader()],
      };
    });
  };

  const updateApiEndpointRow = (index: number, patch: Partial<SiteApiEndpointField>) => {
    setForm((prev) => ({
      ...prev,
      apiEndpoints: prev.apiEndpoints.map((item, itemIndex) => (
        itemIndex === index
          ? { ...item, ...patch }
          : item
      )),
    }));
  };

  const addApiEndpointRow = () => {
    setForm((prev) => ({
      ...prev,
      apiEndpoints: [...prev.apiEndpoints, createEmptyApiEndpointRow()],
    }));
  };

  const removeApiEndpointRow = (index: number) => {
    setForm((prev) => {
      const nextEndpoints = prev.apiEndpoints.filter((_, itemIndex) => itemIndex !== index);
      return {
        ...prev,
        apiEndpoints: nextEndpoints.length > 0 ? nextEndpoints : [createEmptyApiEndpointRow()],
      };
    });
  };

  const moveApiEndpointRow = (index: number, direction: 'up' | 'down') => {
    setForm((prev) => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.apiEndpoints.length) return prev;
      const nextEndpoints = [...prev.apiEndpoints];
      const [current] = nextEndpoints.splice(index, 1);
      nextEndpoints.splice(targetIndex, 0, current);
      return {
        ...prev,
        apiEndpoints: nextEndpoints,
      };
    });
  };

  /**
   * 从站点页进入账号/API Key 连接创建流程。
   */
  const openSiteConnectionFlow = (input: {
    siteId: number;
    platform?: string | null;
    initializationPresetId?: string | null;
    choice: 'session' | 'apikey';
  }) => {
    const platform = input.platform?.toLowerCase().trim();
    const params = buildSiteConnectionSearchParams({
      siteId: input.siteId,
      initializationPresetId: input.initializationPresetId,
    });

    if (input.choice === 'session') {
      if (platform === 'codex') {
        params.set('provider', 'codex');
        navigate(`/oauth?${params.toString()}`);
        return;
      }
      navigate(`/accounts?${params.toString()}`);
      return;
    }

    params.set('segment', 'apikey');
    navigate(`/accounts?${params.toString()}`);
  };

  const handleSiteCreatedChoice = (choice: 'session' | 'apikey' | 'later') => {
    if (!createdSiteForChoice) return;

    if (choice === 'session' || choice === 'apikey') {
      openSiteConnectionFlow({
        siteId: createdSiteForChoice.id,
        platform: createdSiteForChoice.platform,
        initializationPresetId: createdSiteForChoice.initializationPresetId,
        choice,
      });
    }
    // choice === 'later': 不跳转，留在当前页面

    setCreatedSiteForChoice(null);
    closeEditor();
    load();
  };

  const handleDetect = async () => {
    const requestedUrl = form.url.trim();
    const requestedPlatform = form.platform.trim();
    const requestedInitializationPresetId = selectedInitializationPresetId;
    if (!requestedUrl) {
      toast.error(tr('pages.sites.pleaseEnterUrlFirst'));
      return;
    }
    const requestedPrimarySiteUrl = analyzePrimarySiteUrl(requestedUrl);
    setDetecting(true);
    try {
      const result = await api.detectSite(requestedUrl);
      if (
        latestPrimarySiteUrlRef.current.trim() !== requestedUrl
        || latestPlatformRef.current.trim() !== requestedPlatform
        || latestInitializationPresetIdRef.current !== requestedInitializationPresetId
      ) {
        return;
      }
      if (result?.platform) {
        const detectedPreset = getSiteInitializationPreset(result?.initializationPresetId);
        setForm((prev) => ({
          ...prev,
          platform: result.platform,
          url: requestedPrimarySiteUrl.action === 'auto_strip_known_api_suffix'
            && typeof result?.url === 'string'
            && result.url.trim()
            ? result.url.trim()
            : prev.url,
        }));
        setSelectedInitializationPresetId((current) => {
          if (detectedPreset) return detectedPreset.id;
          const activePreset = getSiteInitializationPreset(current);
          if (activePreset && activePreset.platform !== result.platform) return null;
          return current;
        });
        if (
          requestedPrimarySiteUrl.action === 'auto_strip_known_api_suffix'
          && typeof result?.url === 'string'
          && result.url.trim()
        ) {
          toast.info(`已自动规范化主站点 URL 为 ${result.url.trim()}`);
        }
        toast.success(
          detectedPreset
            ? `检测到平台: ${result.platform}（${detectedPreset.label}）`
            : `检测到平台: ${result.platform}`,
        );
      } else {
        toast.error(result?.error || tr('pages.sites.unableIdentifyPlatformType'));
      }
    } catch (e: any) {
      toast.error(e.message || tr('pages.sites.automaticDetectionFailed'));
    } finally {
      setDetecting(false);
    }
  };

  const handleDelete = async (site: SiteRow) => {
    setDeleteConfirm({ mode: 'single', siteId: site.id, siteName: site.name });
  };

  const handleToggleStatus = async (site: SiteRow) => {
    const nextStatus = site.status === 'disabled' ? 'active' : 'disabled';
    setTogglingSiteId(site.id);
    try {
      await api.updateSite(site.id, { status: nextStatus });
      toast.success(nextStatus === 'disabled' ? `站点 "${site.name}" 已禁用` : `站点 "${site.name}" 已启用`);
      await load();
    } catch (e: any) {
      toast.error(e.message || tr('pages.sites.failedSwitchSiteStatus'));
    } finally {
      setTogglingSiteId(null);
    }
  };

  /**
   * 从站点列表直接进入 API Key 批量添加入口。
   */
  const handleOpenSiteApiKey = (site: SiteRow) => {
    openSiteConnectionFlow({
      siteId: site.id,
      platform: site.platform,
      initializationPresetId: detectSiteInitializationPreset(site.url, site.platform)?.id || null,
      choice: 'apikey',
    });
  };

  const handleTogglePin = async (site: SiteRow) => {
    const nextPinned = !site.isPinned;
    setPinningSiteId(site.id);
    try {
      await api.updateSite(site.id, { isPinned: nextPinned });
      toast.success(nextPinned ? `站点 "${site.name}" 已置顶` : `站点 "${site.name}" 已取消置顶`);
      await load();
    } catch (e: any) {
      toast.error(e.message || tr('pages.sites.pinTopfailed'));
    } finally {
      setPinningSiteId(null);
    }
  };

  const handleMoveCustomOrder = async (site: SiteRow, direction: 'up' | 'down') => {
    const updates = buildCustomReorderUpdates(sites, site.id, direction);
    if (updates.length === 0) return;

    setOrderingSiteId(site.id);
    try {
      await Promise.all(updates.map((update) => api.updateSite(update.id, { sortOrder: update.sortOrder })));
      await load();
    } catch (e: any) {
      toast.error(e.message || tr('pages.sites.failed2'));
    } finally {
      setOrderingSiteId(null);
    }
  };

  const handleSiteDragStart = (event: DragStartEvent) => {
    const activeId = Number(event.active.id);
    setDraggingSiteId(Number.isFinite(activeId) ? activeId : null);
  };

  const clearSiteDragState = () => {
    setDraggingSiteId(null);
  };

  const handleSiteDragEnd = async (event: DragEndEvent) => {
    clearSiteDragState();
    const activeId = Number(event.active.id);
    const overId = event.over ? Number(event.over.id) : NaN;
    if (!Number.isFinite(activeId) || !Number.isFinite(overId) || activeId === overId) return;

    const updates = buildCustomReorderToTargetUpdates(sites, activeId, overId);
    if (updates.length === 0) return;

    setOrderingSiteId(activeId);
    try {
      await Promise.all(updates.map((update) => api.updateSite(update.id, { sortOrder: update.sortOrder })));
      await load();
    } catch (e: any) {
      toast.error(e.message || tr('pages.sites.failed2'));
    } finally {
      setOrderingSiteId(null);
    }
  };

  const toggleSiteSelection = (siteId: number, checked: boolean) => {
    setSelectedSiteIds((current) => (
      checked
        ? Array.from(new Set([...current, siteId]))
        : current.filter((id) => id !== siteId)
    ));
  };

  const toggleSelectAllVisible = (checked: boolean) => {
    if (!checked) {
      setSelectedSiteIds((current) => current.filter((id) => !sortedSites.some((site) => site.id === id)));
      return;
    }
    setSelectedSiteIds((current) => Array.from(new Set([...current, ...sortedSites.map((site) => site.id)])));
  };

  const toggleSiteDetails = (siteId: number) => {
    setExpandedSiteIds((current) => (
      current.includes(siteId)
        ? current.filter((id) => id !== siteId)
        : [...current, siteId]
    ));
  };

  const runBatchAction = async (action: 'enable' | 'disable' | 'delete' | 'enableSystemProxy' | 'disableSystemProxy', skipDeleteConfirm = false) => {
    if (selectedSiteIds.length === 0) return;
    if (action === 'delete' && !skipDeleteConfirm) {
      setDeleteConfirm({ mode: 'batch', count: selectedSiteIds.length });
      return;
    }

    setBatchActionLoading(true);
    try {
      const result = await api.batchUpdateSites({
        ids: selectedSiteIds,
        action,
      });
      const successIds = Array.isArray(result?.successIds) ? result.successIds.map((id: unknown) => Number(id)) : [];
      const failedItems = Array.isArray(result?.failedItems) ? result.failedItems : [];
      if (failedItems.length > 0) {
        toast.info(`批量操作完成：成功 ${successIds.length}，失败 ${failedItems.length}`);
      } else {
        toast.success(`批量操作完成：成功 ${successIds.length}`);
      }
      setSelectedSiteIds(failedItems.map((item: any) => Number(item.id)).filter((id: number) => Number.isFinite(id) && id > 0));
      await load();
    } catch (e: any) {
      toast.error(e.message || tr('pages.accounts.operationFailed'));
    } finally {
      setBatchActionLoading(false);
    }
  };

  const confirmDelete = async () => {
    const target = deleteConfirm;
    if (!target) return;

    setDeleteConfirm(null);
    if (target.mode === 'single' && target.siteId) {
      setDeleting(target.siteId);
      try {
        await api.deleteSite(target.siteId);
        toast.success(`站点 "${target.siteName || target.siteId}" 已删除`);
        await load();
      } catch (e: any) {
        toast.error(e.message || tr('pages.sites.deleteFailed'));
      } finally {
        setDeleting(null);
      }
      return;
    }

    await runBatchAction('delete', true);
  };

  const handleSiteRowClick = (siteId: number, event: React.MouseEvent<HTMLTableRowElement>) => {
    if (shouldIgnoreRowSelectionClick(event.target)) return;
    const isSelected = selectedSiteIds.includes(siteId);
    toggleSiteSelection(siteId, !isSelected);
  };

  return (
    <PageShell>
      <PageHeader
        title={tr('app.siteManagement')}
        description={tr('pages.sites.siteManagementSubtitle')}
        actions={(
          <>
          {isMobile ? (
            <>
              <Button variant="outline"
                type="button"
                onClick={() => setShowMobileTools(true)}
               
               
              >
                {tr('pages.accounts.actions3')}
              </Button>
              <Button variant="outline"
                type="button"
                data-testid="sites-mobile-select-all"
                onClick={() => toggleSelectAllVisible(!allVisibleSitesSelected)}
               
               
              >
                {allVisibleSitesSelected ? tr('pages.accounts.cancelselectAll') : tr('pages.accounts.selectVisibleItems')}
              </Button>
            </>
          ) : (
            <div className="min-w-40">
              <ModernSelect
                size="sm"
                value={sortMode}
                onChange={(nextValue) => setSortMode(nextValue as SortMode)}
                options={[
                  { value: 'custom', label: tr('pages.accounts.customOrder') },
                  { value: 'balance-desc', label: tr('pages.accounts.balancehighLow') },
                  { value: 'balance-asc', label: tr('pages.accounts.balancelowHigh') },
                ]}
                placeholder={tr('pages.accounts.customOrder')}
              />
            </div>
          )}
          <Button type="button" data-testid="sites-add-site-button" onClick={openAdd}>
            {isAdding ? tr('app.cancel') : tr('pages.sites.addSite')}
          </Button>
          </>
        )}
      />

      <ResponsiveFilterPanel
        isMobile={isMobile}
        mobileOpen={showMobileTools}
        onMobileClose={() => setShowMobileTools(false)}
        mobileTitle={tr('pages.sites.sitesActions')}
        mobileContent={(
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="text-xs text-muted-foreground">{tr('pages.accounts.sort')}</div>
              <ModernSelect
                value={sortMode}
                onChange={(nextValue) => setSortMode(nextValue as SortMode)}
                options={[
                  { value: 'custom', label: tr('pages.accounts.customOrder') },
                  { value: 'balance-desc', label: tr('pages.accounts.balancehighLow') },
                  { value: 'balance-asc', label: tr('pages.accounts.balancelowHigh') },
                ]}
                placeholder={tr('pages.accounts.customOrder')}
              />
            </div>
            <Button variant="outline"
              type="button"
              onClick={() => {
                toggleSelectAllVisible(!allVisibleSitesSelected);
                setShowMobileTools(false);
              }}
             
             
            >
              {allVisibleSitesSelected ? tr('pages.sites.cancelselectVisibleItems') : tr('pages.accounts.selectVisibleItems')}
            </Button>
          </div>
        )}
      />

      {isMobile && selectedSiteIds.length > 0 && (
        <ResponsiveBatchActionBar
          isMobile={isMobile}
          info={selectedSiteCountText}
        >
          <Button type="button" variant="outline"
            data-testid="sites-batch-enable-system-proxy"
            onClick={() => runBatchAction('enableSystemProxy')}
            disabled={batchActionLoading}
           
           
          >
            {tr('pages.sites.turnOnsystemacting')}
          </Button>
          <Button type="button" variant="outline"
            onClick={() => runBatchAction('disableSystemProxy')}
            disabled={batchActionLoading}
           
           
          >
            {tr('pages.sites.closesystemacting')}
          </Button>
          <Button type="button" variant="outline" onClick={() => runBatchAction('enable')} disabled={batchActionLoading}>
            {tr('pages.accounts.enabled')}
          </Button>
          <Button type="button" variant="outline" onClick={() => runBatchAction('disable')} disabled={batchActionLoading}>
            {tr('pages.accounts.disabled')}
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={() => runBatchAction('delete')} disabled={batchActionLoading}>
            {tr('pages.accounts.delete2')}
          </Button>
        </ResponsiveBatchActionBar>
      )}

      <InfoNote className="mb-3">
        {tr('pages.sites.sitesweightSitesmultiplierSitesWeightSettingsZhApi')}
      </InfoNote>

      <DeleteConfirmModal
        open={Boolean(deleteConfirm)}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={confirmDelete}
        title={tr('pages.sites.deletesites')}
        confirmText={tr('components.deleteConfirmModal.delete')}
        loading={batchActionLoading || (deleteConfirm?.mode === 'single' && deleting === deleteConfirm?.siteId)}
        description={deleteConfirm?.mode === 'single'
          ? <>{tr('pages.sites.deletesites2')} <strong>{deleteConfirm.siteName || `#${deleteConfirm.siteId}`}</strong> {tr('pages.accounts.textqcmnqj')}</>
          : <>{tr('pages.accounts.deleteZh')} <strong>{deleteConfirm?.count || 0}</strong> {tr('pages.sites.sites')}</>}
      />

      {createdSiteForChoice && (
        <SiteCreatedModal
          siteName={createdSiteForChoice.name}
          initializationPresetId={createdSiteForChoice.initializationPresetId}
          initialSegment={
            getSiteInitializationPreset(createdSiteForChoice.initializationPresetId)?.initialSegment
            || resolveInitialConnectionSegment(createdSiteForChoice.platform)
          }
          sessionLabel={resolveSiteCreatedSessionLabel(createdSiteForChoice.platform)}
          onChoice={handleSiteCreatedChoice}
          onClose={() => {
            setCreatedSiteForChoice(null);
            closeEditor();
            load();
          }}
        />
      )}

      {activeEditor && (
        <CenteredModal
          open={Boolean(editor)}
          onClose={closeEditor}
          title={(
            <div className="text-sm font-semibold">
              {isEditing ? tr('pages.sites.editSite') : tr('pages.sites.addSite2')}
            </div>
          )}
          maxWidth={920}
          bodyStyle={{
            maxHeight: isMobile ? '78vh' : '72vh',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
          footer={(
            <>
              <Button type="button" variant="outline" onClick={closeEditor}>
                {tr('app.cancel')}
              </Button>
              <Button type="button"
                onClick={handleSave}
                disabled={saving || !form.name.trim() || !form.url.trim()}
               
              >
                {saving ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : (isEditing ? tr('pages.accounts.saveChanges') : tr('pages.sites.saveSite'))}
              </Button>
            </>
          )}
        >
          <ResponsiveFormGrid>
            <Input
              placeholder={tr('pages.sites.siteName')}
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <div className={`flex gap-2 ${isMobile ? 'flex-col' : 'flex-row'}`}>
              <Input
                data-testid="site-primary-url-input"
                placeholder={tr('pages.sites.sitesUrlSignSignHttpsNihCc')}
                value={form.url}
                onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
                onBlur={() => {
                  if (form.url.trim() && !form.platform.trim()) {
                    handleDetect();
                  }
                }}
                className="flex-1"
              />
              <Button type="button" variant="outline"
                onClick={handleDetect}
                disabled={detecting || !form.url.trim()}
               
               
              >
                {detecting ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.sites.detecting')}</> : tr('pages.sites.autoDetect')}
              </Button>
            </div>
            <div
              className="rounded-md"
            >
              <ModernSelect
                data-testid="site-platform-select"
                value={platformSelectValue}
                onChange={(value) => {
                  if (value.startsWith('preset:')) {
                    const preset = getSiteInitializationPreset(value.slice('preset:'.length));
                    if (!preset) return;
                    setSelectedInitializationPresetId(preset.id);
                    setForm((prev) => {
                      const currentUrl = prev.url.trim();
                      const shouldFillDefaultUrl = !currentUrl
                        || (activeInitializationPreset?.defaultUrl && currentUrl === activeInitializationPreset.defaultUrl);
                      return {
                        ...prev,
                        platform: preset.platform,
                        url: shouldFillDefaultUrl && preset.defaultUrl ? preset.defaultUrl : prev.url,
                      };
                    });
                    return;
                  }
                  setForm((prev) => ({ ...prev, platform: value }));
                  setSelectedInitializationPresetId(null);
                }}
                options={platformOptions}
                placeholder={tr('pages.sites.platformTypeCanAutomaticallyDetected')}
              />
            </div>
            <Input
              placeholder={tr('pages.sites.signSitesUrl')}
              value={form.externalCheckinUrl}
              onChange={(e) => setForm((prev) => ({ ...prev, externalCheckinUrl: e.target.value }))}
            />
          </ResponsiveFormGrid>
          {activeInitializationPreset && (
            <Alert className="animate-scale-in">
              <AlertTitle>{tr('pages.sites.officialPresetApplied')} {activeInitializationPreset.label}</AlertTitle>
              <AlertDescription className="leading-relaxed">
                <div>{activeInitializationPreset.description}</div>
                {form.url.trim() === activeInitializationPreset.defaultUrl && (
                  <div>{tr('pages.sites.automaticOfficialUrl')}</div>
                )}
                <div>{tr('pages.accounts.recommendedmodel')}{activeInitializationPreset.recommendedModels.join(' / ')}</div>
              </AlertDescription>
            </Alert>
          )}
          <div className="text-xs leading-relaxed text-muted-foreground">
            {tr('pages.sites.sitesUrlSitesSignSignSignSystemaccessaccount')}
          </div>
          {primarySiteUrlAnalysis.action === 'auto_strip_known_api_suffix' && primarySiteUrlAnalysis.persistedUrl ? (
            <Alert className="animate-scale-in">
              <AlertTitle>{tr('pages.sites.api2')}</AlertTitle>
              <AlertDescription className="leading-relaxed">
                {tr('pages.sites.saveAutoDetectSitesUrl')} {primarySiteUrlAnalysis.persistedUrl}。
              </AlertDescription>
            </Alert>
          ) : null}
          {primarySiteUrlAnalysis.action === 'preserve_api_path' && primarySiteUrlAnalysis.persistedUrl ? (
            <Alert className="animate-scale-in">
              <AlertTitle>{tr('pages.sites.sitesUrl2')}</AlertTitle>
              <AlertDescription className="leading-relaxed">
                {tr('pages.sites.urlApiSitesUrlApiRequestApi')}
              </AlertDescription>
            </Alert>
          ) : null}
          {primarySiteUrlAnalysis.action === 'preserve_unknown_path' && primarySiteUrlAnalysis.persistedUrl ? (
            <Alert className="animate-scale-in">
              <AlertTitle>{tr('pages.sites.sitesUrl2')}</AlertTitle>
              <AlertDescription className="leading-relaxed">
                {tr('pages.sites.urlSitesUrlApiRequestApiRequest')}
              </AlertDescription>
            </Alert>
          ) : null}
          <UpstreamCompatibilityPolicyEditor
            value={compatibilityPolicyForm}
            disabled={saving}
            inheritFrom={tr('upstreamCompatibility.inheritSource.platformDefault')}
            onChange={setCompatibilityPolicyForm}
          />
          <ConfigSection
            title={tr('pages.sites.apiRequest2')}
            description={tr('pages.sites.v1ModelApiKeyVerifyDefaultSites')}
            actions={(
              <Button
                variant="outline"
                type="button"
                onClick={addApiEndpointRow}
              >
                {tr('pages.sites.addApi')}
              </Button>
            )}
          >
            {form.apiEndpoints.map((endpoint, index) => (
              <ConfigSectionItem
                key={endpoint.draftId || `site-api-endpoint-draft-${index}`}
                className="flex flex-col gap-2"
              >
                <div className={isMobile ? 'flex flex-col items-stretch gap-2' : 'flex flex-row items-center gap-2'}>
                  <Input
                    placeholder={tr('pages.sites.apiRequestHttpsApiNihCc')}
                    value={endpoint.url}
                    onChange={(e) => updateApiEndpointRow(index, { url: e.target.value })}
                    className="flex-1 font-mono"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Checkbox
                      checked={endpoint.enabled !== false}
                      onCheckedChange={(checked) => updateApiEndpointRow(index, { enabled: checked === true })}        />
                    {tr('pages.downstreamKeys.enabled')}
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{tr('pages.sites.order')}{index + 1}</span>
                    {endpoint.cooldownUntil ? <span>{tr('pages.sites.coolingDownUntil')} {formatDateTimeLocal(endpoint.cooldownUntil)}</span> : null}
                    {endpoint.lastFailureReason ? <span>{tr('pages.sites.failed')} {endpoint.lastFailureReason}</span> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghostMuted" size="sm"
                      type="button"
                      onClick={() => moveApiEndpointRow(index, 'up')}
                      disabled={index === 0}
                     
                    >
                      {tr('pages.sites.moveUp')}
                    </Button>
                    <Button variant="ghostMuted" size="sm"
                      type="button"
                      onClick={() => moveApiEndpointRow(index, 'down')}
                      disabled={index>= form.apiEndpoints.length - 1}
                     
                    >
                      {tr('pages.sites.moveDown')}
                    </Button>
                    <Button variant="ghostDestructive" size="sm"
                      type="button"
                      onClick={() => removeApiEndpointRow(index)}
                     
                    >
                      {tr('pages.accounts.delete3')}
                    </Button>
                  </div>
                </div>
              </ConfigSectionItem>
            ))}
          </ConfigSection>
          <ConfigSection
            title={tr('pages.sites.sitescustomRequest')}
            actions={(
              <Button
                variant="outline"
                type="button"
                onClick={addCustomHeaderRow}
              >
                {tr('pages.sites.addrequest')}
              </Button>
            )}
          >
            {form.customHeaders.map((header, index) => (
              <ConfigSectionItem
                key={`custom-header-${index}`}
                className={isMobile ? 'flex flex-col items-stretch gap-2' : 'flex flex-row items-center gap-2'}
              >
                <Input
                  placeholder={tr('pages.sites.headerName')}
                  value={header.key}
                  onChange={(e) => updateCustomHeaderRow(index, 'key', e.target.value)}
                  className="flex-1 font-mono"
                />
                <Input
                  placeholder={tr('pages.sites.header')}
                  value={header.value}
                  onChange={(e) => updateCustomHeaderRow(index, 'value', e.target.value)}
                  className="flex-1 font-mono"
                />
                <Button variant="destructive" size="sm"
                  type="button"
                  onClick={() => removeCustomHeaderRow(index)}
                 
                 
                >
                  {tr('pages.accounts.delete3')}
                </Button>
              </ConfigSectionItem>
            ))}
            <div className="text-xs leading-relaxed text-muted-foreground">
              {tr('pages.sites.keyValueItemsAutomaticRequestRequestRequest')}
            </div>
          </ConfigSection>
          {isEditing && (
            <ConfigSection
              title={tr('pages.sites.disabledmodelManagement')}
              description={tr('pages.sites.sitesdisabledModelRoutesSitesModelChannelsDisabled')}
            >
                {disabledModelsLoading ? (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" /> {tr('pages.oAuthManagement.loading')}
                  </div>
                ) : (
                  <>
                    {/* Search and brand group controls */}
                    {brandGroups.length > 0 ? (
                      <div className="mb-2.5">
                        <Input
                          placeholder={tr('pages.sites.searchModelName')}
                          value={disabledModelSearch}
                          onChange={(e) => setDisabledModelSearch(e.target.value)}
                          className="mb-2"
                        />
                        {/* Brand group quick actions */}
                        <div className="mb-2 flex flex-wrap gap-1">
                          <span className="text-xs leading-6 text-muted-foreground">{tr('pages.sites.brandsselectAll')}</span>
                          {brandGroups.map(([brandName, models]) => {
                            const allDisabled = models.every((m) => disabledModelSet.has(m));
                            return (
                              <Button
                                key={brandName}
                                type="button"
                                onClick={() => {
                                  if (allDisabled) {
                                    const removeSet = new Set(models);
                                    setDisabledModels((prev) => prev.filter((m) => !removeSet.has(m)));
                                  } else {
                                    setDisabledModels((prev) => Array.from(new Set([...prev, ...models])));
                                  }
                                }}
                                variant={allDisabled ? 'secondary' : 'outline'}
                                size="sm"
                                data-tooltip={allDisabled ? `取消禁用全部 ${brandName} 模型 (${models.length})` : `禁用全部 ${brandName} 模型 (${models.length})`}
                              >
                                {brandName} ({models.length})
                              </Button>
                            );
                          })}
                        </div>
                        {/* Checkbox list */}
                        <div className="max-h-70 overflow-y-auto rounded-lg border py-1">
                          {filteredBrandGroups.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-muted-foreground">{tr('pages.sites.nonematchmodel')}</div>
                          ) : filteredBrandGroups.map(([brandName, models]) => (
                            <div key={brandName}>
                              <div className="border-b bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                                {brandName} ({models.length})
                              </div>
                              {models.map((model) => {
                                const isDisabled = disabledModelSet.has(model);
                                return (
                                  <label
                                    key={model}
                                    className={`flex cursor-pointer items-center gap-2 px-3 py-1 text-xs leading-relaxed ${isDisabled ? 'bg-muted' : ''}`}
                                  >
                                    <Checkbox
                                      checked={isDisabled}
                                      onCheckedChange={(checked) => {
                                        if (checked === true) {
                                          setDisabledModels((prev) => Array.from(new Set([...prev, model])));
                                        } else {
                                          setDisabledModels((prev) => prev.filter((m) => m !== model));
                                        }
                                      }}                        />
                                    <span className={isDisabled ? 'text-muted-foreground' : 'text-foreground'}>
                                      {model}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="mb-2.5 text-xs text-muted-foreground">
                        {tr('pages.sites.noneModelManualaddModels')}
                      </div>
                    )}

                    <div className="mb-2.5 mt-2.5 flex gap-2">
                      <Input
                        placeholder={tr('pages.sites.inputmodelNameGpt4o')}
                        value={disabledModelInput}
                        onChange={(e) => setDisabledModelInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddDisabledModel();
                          }
                        }}
                        className="flex-1"
                      />
                      <Button type="button" variant="outline"
                        onClick={handleAddDisabledModel}
                       
                       
                      >
                        {tr('pages.sites.addmodel')}
                      </Button>
                    </div>

                    <div className="mt-2.5 flex items-center gap-2.5">
                      <Button type="button"
                        onClick={handleSaveDisabledModels}
                        disabled={disabledModelsSaving}
                       
                       
                      >
                        {disabledModelsSaving ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.sites.savedisabled')}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {tr('pages.accounts.disabled2')} {disabledModels.length} {tr('pages.models.models2')}
                      </span>
                    </div>
                  </>
                )}
            </ConfigSection>
          )}

          {isEditing && (
            <ConfigSection
              title={tr('pages.sites.refreshAutomaticRequest')}
              description={tr('pages.sites.turnAutomaticModelSuccessModelsendActualMeasurement')}
            >
              <label className="mb-2.5 flex cursor-pointer items-start gap-2.5">
                <Checkbox
                  checked={probeEnabled}
                  onCheckedChange={(checked) => setProbeEnabled(checked === true)}
                  className="mt-0.5 shrink-0"
                />
                <span className="text-sm text-muted-foreground">{tr('pages.sites.turnOnrefreshAutomatic')}</span>
              </label>
              <RadioGroup value={probeScope} onValueChange={(nextValue) => setProbeScope(nextValue as typeof probeScope)} className="mb-3 flex flex-wrap gap-2" disabled={!probeEnabled}>
                {([['single', tr('pages.sites.model2')] , ['all', tr('pages.sites.allmodel')]] as const).map(([val, label]) => (
                  <label
                    key={val}
                    className="flex items-center gap-2 text-sm"
                  >
                    <RadioGroupItem
                      value={val}
                      disabled={!probeEnabled}
                    />
                    {label}
                  </label>
                ))}
              </RadioGroup>
              {probeScope === 'single' && (
                <Input
                  type="text"
                  placeholder={tr('pages.sites.modelAutomaticModels')}
                  value={probeModel}
                  onChange={(e) => setProbeModel(e.target.value)}
                  disabled={!probeEnabled}
                  className="mb-2.5 font-mono"
                />
              )}
              <div className="mb-2.5 flex items-center gap-2">
                <span className="whitespace-nowrap text-xs text-muted-foreground">{tr('pages.sites.latency')}</span>
                <Input
                  type="number"
                  min="0"
                  step="500"
                  placeholder="0"
                  value={probeLatencyThreshold}
                  onChange={(e) => setProbeLatencyThreshold(e.target.value)}
                  className="w-24"
                />
                <span className="text-xs text-muted-foreground">{tr('pages.sites.msResponseTimeAutomaticdisabled0Unlimited')}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <Button type="button" variant="outline"
                  onClick={() => void handleSaveProbeSettings()}
                  disabled={probeSaving || probing}
                 
                 
                >
                  {probeSaving ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.accounts.saving')}</> : tr('pages.sites.saveSettings')}
                </Button>
                <Button type="button"
                  onClick={() => void handleProbeNow()}
                  disabled={probing || probeSaving}
                 
                 
                >
                  {probing ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.sites.zh')}</> : tr('pages.sites.detectNow')}
                </Button>
                {probing && (
                  <Button type="button" variant="outline"
                    onClick={() => { probeAbortRef.current?.abort(); }}
                   
                   
                  >
                    {tr('pages.modelTester.stop')}
                  </Button>
                )}
                <span className="text-xs text-muted-foreground">
                  {probeEnabled ? tr('pages.sites.timeOutBatchHealthChecktimeOutSettings') : tr('pages.sites.close')}
                </span>
              </div>
              {probeLog.length > 0 && (
                <div className="mt-2.5 max-h-50 overflow-y-auto rounded-lg border bg-card px-2.5 py-2 font-mono text-xs leading-relaxed">
                  {probeLog.map((entry, i) => (
                    <div key={i} className={entry.color ? 'text-foreground' : 'text-muted-foreground'}>
                      <span className="mr-2 text-muted-foreground">{entry.time}</span>
                      {entry.text}
                    </div>
                  ))}
                  <div ref={probeLogEndRef} />
                </div>
              )}
              {probeCompleted && brandGroups.length > 0 && (
                <div className="mt-2.5">
                  <div className="mb-1.5 text-xs font-semibold text-muted-foreground">
                    {tr('pages.sites.modelstatus')}
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      {tr('pages.sites.available')} {availableModels.filter((m) => !disabledModelSet.has(m)).length} {tr('pages.sites.disabled2')} {disabledModels.length} {tr('pages.accounts.model')}
                    </span>
                  </div>
                  <div className="max-h-50 overflow-y-auto rounded-lg border py-1">
                    {brandGroups.map(([brandName, models]) => (
                      <div key={brandName}>
                        <div className="border-b bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                          {brandName} ({models.length})
                        </div>
                        <div className="flex flex-wrap gap-1 px-3 py-1.5">
                          {models.map((model) => {
                            const isDisabled = disabledModelSet.has(model);
                            return (
                              <span
                                key={model}
                                className={`rounded-full border px-2 py-0.5 font-mono text-xs ${isDisabled ? 'text-destructive' : 'text-foreground'}`}
                              >
                                {model}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </ConfigSection>
          )}

          <ResponsiveFormGrid>
            <div className="flex flex-col gap-1.5">
              <Input
                placeholder={tr('pages.sites.sitesactingHttp1270017890')}
                value={form.proxyUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, proxyUrl: e.target.value }))}
              />
              <div className="text-xs text-muted-foreground">
                {tr('pages.sites.httpSocksActingApiRequestUsagesitesactingUsagesystemacting')}
              </div>
            </div>
            <label className="flex items-center gap-2.5 rounded-md border bg-muted px-3.5 py-2.5 text-sm text-foreground">
              <Checkbox
                checked={form.useSystemProxy}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, useSystemProxy: checked === true }))}  />
              {tr('pages.notificationSettings.usagesystemacting')}
            </label>
            <div className="flex flex-col gap-1.5">
              <Input
                placeholder={tr('pages.sites.sitesWeightDefault1')}
                value={form.globalWeight}
                onChange={(e) => setForm((prev) => ({ ...prev, globalWeight: e.target.value }))}
              />
              <div className="text-xs text-muted-foreground">
                {tr('pages.sites.routesZhSuggestion053Default')}
              </div>
            </div>
          </ResponsiveFormGrid>
        </CenteredModal>
      )}

      <>
        {!loaded ? (
          <SitesLoadingSkeleton isMobile={isMobile} />
        ) : sites.length > 0 ? (
          isMobile ? (
            <div className="grid gap-3">
              {sortedSites.map((site) => {
                const isExpanded = expandedSiteIds.includes(site.id);
                return (
                  <MobileCard
                    key={site.id}
                    title={(
                      <div className="flex flex-col gap-1">
                        <span>{site.name || '-'}</span>
                        {site.url ? (
                          <a
                            href={site.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="break-all font-mono text-xs underline"
                          >
                            {site.url}
                          </a>
                        ) : null}
                      </div>
                    )}
                    headerActions={(
                      <Checkbox
                       
                        aria-label={`选择站点 ${site.name || site.id}`}
                        checked={selectedSiteIds.includes(site.id)}
                        onCheckedChange={(checked) => toggleSiteSelection(site.id, checked === true)}          />
                    )}
                    footerActions={(
                      <>
                        <Button variant="ghostPrimary" size="sm"
                          type="button"
                          onClick={() => toggleSiteDetails(site.id)}
                         
                        >
                          {isExpanded ? tr('pages.accounts.collapse') : tr('pages.accounts.details')}
                        </Button>
                        <Button type="button" variant="ghostPrimary" size="sm"
                          onClick={() => handleOpenSiteApiKey(site)}
                         
                        >
                          {tr('pages.sites.addKey')}
                        </Button>
                        <Button type="button" variant="ghostPrimary" size="sm"
                          onClick={() => openEdit(site)}
                         
                        >
                          {tr('pages.accounts.edit')}
                        </Button>
                        <Button
                          type="button"
                          variant={site.status === 'disabled' ? 'ghostPrimary' : 'ghostWarning'}
                          size="sm"
                          onClick={() => handleToggleStatus(site)}
                          disabled={togglingSiteId === site.id}
                         
                        >
                          {togglingSiteId === site.id ? <LoaderCircle className="size-4 animate-spin" /> : (site.status === 'disabled' ? tr('pages.downstreamKeys.enabled') : tr('pages.downstreamKeys.disabled'))}
                        </Button>
                      </>
                    )}
                  >
                    <MobileField
                      label={tr('components.notificationPanel.status')}
                      value={(
                        <ToneBadge tone={site.status === 'disabled' ? 'muted' : 'success'}>
                          {site.status === 'disabled' ? tr('pages.downstreamKeys.disabled') : tr('pages.downstreamKeys.enabled')}
                        </ToneBadge>
                      )}
                    />
                    <MobileField
                      label={tr('pages.sites.platform')}
                      value={(
                        <ToneBadge tone={platformColors[site.platform || ''] || 'muted'}>
                          {site.platform || '-'}
                        </ToneBadge>
                      )}
                    />
                    <MobileField
                      label={tr('components.notificationPanel.balance')}
                      value={(
                        <SiteBalanceDisplay
                          balance={site.totalBalance}
                          summary={site.subscriptionSummary}
                          align="end"
                        />
                      )}
                    />
                    <MobileField label={tr('pages.sites.weight')} value={(site.globalWeight || 1).toFixed(2)} />
                    {isExpanded ? (
                      <div className="mt-3 grid gap-2">
                        <MobileField
                          label={tr('pages.sites.sitesUrl3')}
                          stacked
                          value={site.url ? (
                            <a
                              href={site.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="break-all font-mono text-xs underline"
                            >
                              {site.url}
                            </a>
                          ) : '-'}
                        />
                        <MobileField
                          label={tr('pages.sites.apiRequest3')}
                          stacked
                          value={(
                            <div className="flex flex-col gap-1">
                              <span>{buildSiteApiEndpointSummary(site)}</span>
                              {getConfiguredSiteApiEndpoints(site).map((endpoint, endpointIndex) => (
                                <span
                                  key={`mobile-site-endpoint-${site.id}-${endpoint.id ?? endpointIndex}`}
                                  className="break-all font-mono text-xs text-muted-foreground"
                                >
                                  {endpoint.url}
                                  {endpoint.enabled === false ? tr('pages.sites.disabled') : ''}
                                </span>
                              ))}
                            </div>
                          )}
                        />
                        <MobileField
                          label={tr('pages.settings.systemacting3')}
                          value={(
                            <ToneBadge tone={site.useSystemProxy ? 'info' : 'muted'}>
                              {site.useSystemProxy ? tr('pages.proxyLogs.turn3') : tr('pages.proxyLogs.turn2')}
                            </ToneBadge>
                          )}
                        />
                        <MobileField
                          label={tr('pages.sites.signUrl')}
                          value={site.externalCheckinUrl ? (
                            <a
                              href={site.externalCheckinUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="break-all font-mono text-xs underline"
                            >
                              {site.externalCheckinUrl}
                            </a>
                          ) : '-'}
                        />
                        <MobileField
                          label={tr('pages.sites.customHeaders')}
                          value={hasConfiguredCustomHeaders(site.customHeaders) ? tr('pages.sites.configured') : '-'}
                        />
                        <MobileField
                          label={tr('pages.sites.time')}
                          value={formatDateTimeLocal(site.createdAt)}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant={site.isPinned ? 'ghostWarning' : 'ghostPrimary'}
                            size="sm"
                            onClick={() => handleTogglePin(site)}
                            disabled={pinningSiteId === site.id}
                           
                          >
                            {pinningSiteId === site.id ? <LoaderCircle className="size-4 animate-spin" /> : (site.isPinned ? tr('pages.accounts.cancelpinTop') : tr('pages.accounts.pinTop'))}
                          </Button>
                          {sortMode === 'custom' && (
                            <>
                              <Button type="button" variant="ghostMuted" size="sm"
                                onClick={() => handleMoveCustomOrder(site, 'up')}
                                disabled={orderingSiteId === site.id}
                               
                              >
                                {tr('pages.accounts.moveUp')}
                              </Button>
                              <Button type="button" variant="ghostMuted" size="sm"
                                onClick={() => handleMoveCustomOrder(site, 'down')}
                                disabled={orderingSiteId === site.id}
                               
                              >
                                {tr('pages.accounts.moveDown')}
                              </Button>
                            </>
                          )}
                          <Button type="button" variant="ghostDestructive" size="sm"
                            onClick={() => handleDelete(site)}
                            disabled={deleting === site.id}
                           
                          >
                            {deleting === site.id ? <LoaderCircle className="size-4 animate-spin" /> : null}
                            {tr('pages.accounts.delete3')}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </MobileCard>
                );
              })}
            </div>
          ) : (
            <DataTable minWidth={1120} density="compact">
              <DataTableToolbar className="border-b bg-muted/30 px-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Checkbox
                    checked={allVisibleSitesSelected || (someVisibleSitesSelected && "indeterminate")}
                    aria-label={tr('pages.accounts.selectVisibleItems')}
                    onCheckedChange={(checked) => toggleSelectAllVisible(checked === true)}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">
                      {selectedSiteIds.length > 0 ? selectedSiteCountText : visibleSiteCountText}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {tr('pages.sites.selectionActions')}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="sites-batch-enable-system-proxy"
                    onClick={() => runBatchAction('enableSystemProxy')}
                    disabled={batchActionLoading || selectedSiteIds.length === 0}
                  >
                    <Network className="size-4" />
                    {tr('pages.sites.turnOnsystemacting')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => runBatchAction('disableSystemProxy')}
                    disabled={batchActionLoading || selectedSiteIds.length === 0}
                  >
                    <CircleSlash className="size-4" />
                    {tr('pages.sites.closesystemacting')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => runBatchAction('enable')}
                    disabled={batchActionLoading || selectedSiteIds.length === 0}
                  >
                    <CheckCircle2 className="size-4" />
                    {tr('pages.accounts.enabled')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => runBatchAction('disable')}
                    disabled={batchActionLoading || selectedSiteIds.length === 0}
                  >
                    <CircleSlash className="size-4" />
                    {tr('pages.accounts.disabled')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghostMuted"
                    size="sm"
                    onClick={() => setSelectedSiteIds([])}
                    disabled={batchActionLoading || selectedSiteIds.length === 0}
                  >
                    {tr('pages.accounts.clearSelection')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghostDestructive"
                    size="sm"
                    onClick={() => runBatchAction('delete')}
                    disabled={batchActionLoading || selectedSiteIds.length === 0}
                  >
                    {batchActionLoading ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    {tr('pages.accounts.delete2')}
                  </Button>
                </div>
              </DataTableToolbar>
              <DndContext
                sensors={siteReorderSensors}
                collisionDetection={closestCenter}
                onDragStart={handleSiteDragStart}
                onDragCancel={clearSiteDragState}
                onDragEnd={handleSiteDragEnd}
              >
                <SortableContext
                  items={sortedSites.map((site) => site.id)}
                  strategy={verticalListSortingStrategy}
                >
              <Table className="sites-table w-full text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-11" />
                  <TableHead className="w-11" />
                  <TableHead className="min-w-56">{tr('pages.models.name')}</TableHead>
                  <TableHead className="min-w-64">{tr('pages.sites.signUrl')}</TableHead>
                  <TableHead className="min-w-32 text-right">{tr('pages.sites.balance')}</TableHead>
                  <TableHead className="sites-status-col text-center">{tr('components.notificationPanel.status')}</TableHead>
                  <TableHead className="sites-system-proxy-col text-center">{tr('pages.settings.systemacting3')}</TableHead>
                  <TableHead className="sites-weight-col text-right">{tr('pages.sites.weight')}</TableHead>
                  <TableHead className="min-w-32">{tr('pages.sites.platform')}</TableHead>
                  <TableHead className="sites-created-col">{tr('pages.sites.time')}</TableHead>
                  <TableHead className="sites-actions-col text-right">{tr('pages.accounts.actions2')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedSites.map((site, i) => {
                  const selected = selectedSiteIds.includes(site.id);
                  const createdAtParts = formatSiteCreatedAtParts(site.createdAt);
                  return (
                    <SortableSiteTableRow
                      key={site.id}
                      site={site}
                      selected={selected}
                      data-testid={`site-row-${site.id}`}
                      rowRef={(node) => {
                        if (node) rowRefs.current.set(site.id, node);
                        else rowRefs.current.delete(site.id);
                      }}
                      onClick={(event) => handleSiteRowClick(site.id, event)}
                      className={`animate-slide-up stagger-${Math.min(i + 1, 5)} row-selectable ${highlightSiteId === site.id ? 'row-focus-highlight' : ''}`.trim()}
                    >
                    {(dragHandle) => (
                      <>
                    <TableCell>
                      {sortMode === 'custom' ? (
                        <Button
                          ref={dragHandle.setActivatorNodeRef}
                          type="button"
                          variant="ghostMuted"
                          size="icon"
                          aria-label={tr('pages.accounts.reorder')}
                          className={dragHandle.isDragging ? 'cursor-grabbing' : 'cursor-grab'}
                          disabled={orderingSiteId === site.id}
                          onClick={(event) => event.stopPropagation()}
                          {...dragHandle.attributes}
                          {...dragHandle.listeners}
                        >
                          {orderingSiteId === site.id ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : (
                            <GripVertical className="size-4" />
                          )}
                        </Button>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Checkbox
                        data-testid={`site-select-${site.id}`}
                        checked={selected}
                        onCheckedChange={(checked) => toggleSiteSelection(site.id, checked === true)}          />
                    </TableCell>
                    <TableCell className="font-semibold">
                      <div className="flex flex-col items-start gap-1.5">
                        <a
                          href={site.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-foreground underline"
                        >
                          {site.name}
                        </a>
                        {hasConfiguredCustomHeaders(site.customHeaders) ? (
                          <ToneBadge tone="-info">
                            {tr('pages.sites.customHeaders')}
                          </ToneBadge>
                        ) : null}
                        <SiteApiEndpointSummaryBadge site={site} />
                      </div>
                    </TableCell>
                    <TableCell className="sites-url-cell max-w-75">
                      {site.externalCheckinUrl ? (
                        <a
                          href={site.externalCheckinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all font-mono text-xs underline"
                        >
                          {site.externalCheckinUrl}
                        </a>
                      ) : null}
                    </TableCell>
                    <TableCell className="site-balance-cell text-right">
                      <SiteBalanceDisplay
                        balance={site.totalBalance}
                        summary={site.subscriptionSummary}
                        align="end"
                      />
                    </TableCell>
                    <TableCell className="sites-status-cell text-center">
                      <ToneBadge tone={site.status === 'disabled' ? 'muted' : 'success'}>
                        {site.status === 'disabled' ? tr('pages.downstreamKeys.disabled') : tr('pages.downstreamKeys.enabled')}
                      </ToneBadge>
                    </TableCell>
                    <TableCell className="sites-system-proxy-cell text-center">
                      <ToneBadge tone={site.useSystemProxy ? 'info' : 'muted'}>
                        {site.useSystemProxy ? tr('pages.proxyLogs.turn3') : tr('pages.proxyLogs.turn2')}
                      </ToneBadge>
                    </TableCell>
                    <TableCell className="sites-weight-cell text-right font-semibold tabular-nums">
                      {(site.globalWeight || 1).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <a
                        href={site.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="no-underline"
                      >
                        <ToneBadge tone={platformColors[site.platform || ''] || 'muted'}>
                          {site.platform || '-'}
                        </ToneBadge>
                      </a>
                    </TableCell>
                    <TableCell className="sites-created-cell text-xs text-muted-foreground">
                      <a
                        href={site.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="sites-created-link text-muted-foreground underline"
                        title={createdAtParts.full}
                      >
                        <span>{createdAtParts.date}</span>
                        {createdAtParts.time ? <span>{createdAtParts.time}</span> : null}
                      </a>
                    </TableCell>
                    <TableCell className="sites-actions-cell text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button type="button" variant="ghostPrimary" size="sm"
                          onClick={() => handleOpenSiteApiKey(site)}
                        >
                          {tr('pages.sites.addKey')}
                        </Button>
                        <Button type="button" variant="ghost" size="sm"
                          onClick={() => openEdit(site)}
                        >
                          {tr('pages.accounts.edit')}
                        </Button>
                        <DropdownMenu.Root>
                          <DropdownMenu.Trigger asChild>
                            <Button
                              type="button"
                              variant="ghostMuted"
                              size="icon"
                              aria-label={tr('pages.accounts.moreActions')}
                            >
                              <Ellipsis className="size-4" />
                            </Button>
                          </DropdownMenu.Trigger>
                          <DropdownMenu.Content align="end" className="min-w-44">
                            <DropdownMenu.Item
                              disabled={pinningSiteId === site.id}
                              onSelect={() => handleTogglePin(site)}
                            >
                              {pinningSiteId === site.id ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : site.isPinned ? (
                                <PinOff className="size-4" />
                              ) : (
                                <Pin className="size-4" />
                              )}
                              {site.isPinned ? tr('pages.accounts.cancelpinTop') : tr('pages.accounts.pinTop')}
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                              disabled={togglingSiteId === site.id}
                              onSelect={() => handleToggleStatus(site)}
                            >
                              {togglingSiteId === site.id ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : site.status === 'disabled' ? (
                                <CheckCircle2 className="size-4" />
                              ) : (
                                <CircleSlash className="size-4" />
                              )}
                              {site.status === 'disabled' ? tr('pages.downstreamKeys.enabled') : tr('pages.downstreamKeys.disabled')}
                            </DropdownMenu.Item>
                            <DropdownMenu.Separator />
                            <DropdownMenu.Item
                              variant="destructive"
                              disabled={deleting === site.id}
                              onSelect={() => handleDelete(site)}
                            >
                              {deleting === site.id ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : (
                                <Trash2 className="size-4" />
                              )}
                              {tr('pages.accounts.delete3')}
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Root>
                      </div>
                    </TableCell>
                      </>
                    )}
                    </SortableSiteTableRow>
                  );
                })}
              </TableBody>
              </Table>
                </SortableContext>
                <DragOverlay dropAnimation={null}>
                  {draggingSite ? <SiteDragOverlayCard site={draggingSite} /> : null}
                </DragOverlay>
              </DndContext>
            </DataTable>
          )
        ) : (
          <EmptyStateBlock title={tr('pages.sites.noSites')} description={tr('pages.sites.clickAddSiteStart')} />
        )}
      </>
    </PageShell>
  );
}
