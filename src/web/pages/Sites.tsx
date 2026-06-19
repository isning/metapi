/**
 * @Author: 橘子
 * @Project_description: Metapi 站点管理页
 * @Description: 代码是我抄的，不会也是真的
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import { UpstreamCompatibilityPolicyEditor } from '../components/UpstreamCompatibilityPolicyEditor.js';
import { ConfigSection, ConfigSectionItem } from '../components/ConfigSection.js';
import { formatDateTimeLocal } from './helpers/checkinLogTime.js';
import { clearFocusParams, readFocusSiteId } from './helpers/navigationFocus.js';
import { tr } from '../i18n.js';
import { buildCustomReorderUpdates, sortItemsForDisplay, type SortMode } from './helpers/listSorting.js';
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
import { LoaderCircle } from 'lucide-react';
import ToneBadge from '../components/ToneBadge.js';
import InfoNote from '../components/InfoNote.js';
import EmptyStateBlock from '../components/EmptyStateBlock.js';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert/index.js';
import { Card } from '../components/ui/card/index.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table/index.js';
import { Checkbox } from '../components/ui/checkbox/index.js';
import { Input } from '../components/ui/input/index.js';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group/index.js';
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
  if (endpoints.length <= 0) return '跟随主站点 URL';
  const enabledCount = endpoints.filter((item) => item.enabled !== false).length;
  return `${enabledCount}/${endpoints.length} 条启用`;
}

function formatUsd(value?: number | null): string {
  return `$${(value || 0).toFixed(2)}`;
}

function resolveSiteCreatedSessionLabel(platform?: string | null): string {
  const normalized = String(platform || '').trim().toLowerCase();
  if (normalized === 'codex') return '添加 OAuth 连接';
  return '添加账号（用户名密码登录）';
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
  if (deltaMs <= 0) return '已到期';

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
  { value: '', label: '平台类型（可自动检测）' },
  { value: 'new-api', label: 'new-api', description: '聚合面板，适合多渠道统一管理' },
  { value: 'one-api', label: 'one-api', description: '经典聚合面板，常见于通用 OpenAI 中转' },
  { value: 'anyrouter', label: 'anyrouter', description: 'any大善人今天还能用吗' },
  { value: 'veloera', label: 'veloera', description: 'Veloera 兼容站点，常见于聚合代理场景' },
  { value: 'one-hub', label: 'one-hub', description: '聚合面板，偏向多账号统一管理' },
  { value: 'done-hub', label: 'done-hub', description: '聚合面板，适合统一转发与管理' },
  { value: 'sub2api', label: 'sub2api', description: '订阅式中转面板，可同步套餐与余额信息' },
  { value: 'openai', label: 'openai', description: '通用 OpenAI 兼容接口，手填 Base URL 即可' },
  { value: 'codex', label: 'codex', description: 'Codex OAuth / Session 优先入口' },
  { value: 'claude', label: 'claude', description: '通用 Claude / Anthropic 兼容接口' },
  { value: 'gemini', label: 'gemini', description: '通用 Gemini / Google AI 兼容接口' },
  { value: 'cliproxyapi', label: 'cliproxyapi', description: 'CPA接入口' },
];

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
      const brandName = brand?.name || '其他';
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
      toast.error('加载站点列表失败');
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
  const allVisibleSitesSelected = sortedSites.length > 0 && sortedSites.every((site) => selectedSiteIds.includes(site.id));

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
        preset.defaultUrl ? '自动填充官方地址' : '',
        preset.recommendedSkipModelFetch ? 'API Key 优先初始化' : '',
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
        toast.success('禁用模型列表已保存，路由已重建');
      } catch {
        toast.error('禁用模型列表已保存，但路由重建失败，请手动刷新路由');
      }
    } catch (e: any) {
      toast.error(e.message || '保存禁用模型失败');
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
      toast.success('刷新后探测设置已保存');
    } catch (e: any) {
      toast.error(e.message || '保存失败');
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
            addLog(`开始探测，范围：${d.scope === 'all' ? '全部模型' : '指定模型'}，共 ${d.modelsCount} 个`);
          } else if (type === 'model') {
            const s = d.status === 'supported' ? '✓ 可用'
              : d.status === 'unsupported'
                ? (d.latencyExceeded ? `✗ 延迟超限 (${d.latencyMs}ms)` : '✗ 不可用')
              : d.status === 'skipped' ? '— 已跳过'
              : '✗ 不可用';
            const lat = d.latencyMs != null && d.status !== 'skipped' ? ` (${d.latencyMs}ms)` : '';
            const c = d.status === 'supported' ? 'var(--color-success, #22c55e)'
              : d.status === 'skipped' ? 'var(--color-text-muted)'
              : 'var(--color-error, #ef4444)';
            const reasonText = (() => {
              if (!d.reason || d.status === 'supported' || d.status === 'skipped') return '';
              const r = d.reason;
              if (/timeout/i.test(r)) return '超时';
              if (/missing credential|no.*token/i.test(r)) return '无 Token';
              if (/no compatible.*endpoint|no.*endpoint candidate/i.test(r)) return '无可用端点';
              if (/no such model|unknown model/i.test(r)) return '模型不存在';
              if (/not found/i.test(r)) return '未找到';
              if (/access denied|forbidden|permission/i.test(r)) return '无权限';
              if (/rate.?limit|too many request/i.test(r)) return '触发频率限制';
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
            addLog(d.message || '探测失败', 'var(--color-error, #ef4444)');
            toast.error(d.message || '探测失败');
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
        setProbeLog((prev) => [...prev, { time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), text: '已手动停止', color: 'var(--color-text-muted)' }]);
        return;
      }
      addLog(e?.message || '探测失败', 'var(--color-error, #ef4444)');
      toast.error(e?.message || '探测失败');
    } finally {
      setProbing(false);
      probeAbortRef.current = null;
    }
  };

  const handleSave = async () => {
    if (!editor) return;
    const parsedGlobalWeight = Number(form.globalWeight);
    if (!Number.isFinite(parsedGlobalWeight) || parsedGlobalWeight <= 0) {
      toast.error('全局权重必须是大于 0 的数字');
      return;
    }
    const serializedCustomHeaders = serializeSiteCustomHeaders(form.customHeaders);
    if (!serializedCustomHeaders.valid) {
      toast.error(serializedCustomHeaders.error || '自定义请求头格式不正确');
      return;
    }
    const serializedApiEndpoints = serializeSiteApiEndpoints(form.apiEndpoints);
    if (!serializedApiEndpoints.valid) {
      toast.error(serializedApiEndpoints.error || 'API 请求地址格式不正确');
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
      toast.error('请填写站点名称和 URL');
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
      toast.error(e.message || '保存失败');
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
      toast.error('请先输入 URL');
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
        toast.error(result?.error || '无法识别平台类型');
      }
    } catch (e: any) {
      toast.error(e.message || '自动检测失败');
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
      toast.error(e.message || '切换站点状态失败');
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
      toast.error(e.message || '切换置顶失败');
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
      toast.error(e.message || '更新排序失败');
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
      toast.error(e.message || '批量操作失败');
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
        toast.error(e.message || '删除失败');
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
    <div className="animate-fade-in">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h2 className="text-xl font-semibold">{tr('站点管理')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {isMobile ? (
            <>
              <Button variant="outline"
                type="button"
                onClick={() => setShowMobileTools(true)}
               
               
              >
                排序与操作
              </Button>
              <Button variant="outline"
                type="button"
                data-testid="sites-mobile-select-all"
                onClick={() => toggleSelectAllVisible(!allVisibleSitesSelected)}
               
               
              >
                {allVisibleSitesSelected ? '取消全选' : '全选可见项'}
              </Button>
            </>
          ) : (
            <div className="min-w-40">
              <ModernSelect
                size="sm"
                value={sortMode}
                onChange={(nextValue) => setSortMode(nextValue as SortMode)}
                options={[
                  { value: 'custom', label: '自定义排序' },
                  { value: 'balance-desc', label: '余额高到低' },
                  { value: 'balance-asc', label: '余额低到高' },
                ]}
                placeholder="自定义排序"
              />
            </div>
          )}
          <Button type="button" data-testid="sites-add-site-button" onClick={openAdd}>
            {isAdding ? '取消' : '+ 添加站点'}
          </Button>
        </div>
      </div>

      <ResponsiveFilterPanel
        isMobile={isMobile}
        mobileOpen={showMobileTools}
        onMobileClose={() => setShowMobileTools(false)}
        mobileTitle="站点排序与操作"
        mobileContent={(
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="text-xs text-muted-foreground">排序方式</div>
              <ModernSelect
                value={sortMode}
                onChange={(nextValue) => setSortMode(nextValue as SortMode)}
                options={[
                  { value: 'custom', label: '自定义排序' },
                  { value: 'balance-desc', label: '余额高到低' },
                  { value: 'balance-asc', label: '余额低到高' },
                ]}
                placeholder="自定义排序"
              />
            </div>
            <Button variant="outline"
              type="button"
              onClick={() => {
                toggleSelectAllVisible(!allVisibleSitesSelected);
                setShowMobileTools(false);
              }}
             
             
            >
              {allVisibleSitesSelected ? '取消全选可见项' : '全选可见项'}
            </Button>
          </div>
        )}
      />

      {selectedSiteIds.length > 0 && (
        <ResponsiveBatchActionBar
          isMobile={isMobile}
          info={`已选 ${selectedSiteIds.length} 项`}
        >
          <Button type="button" variant="outline"
            data-testid="sites-batch-enable-system-proxy"
            onClick={() => runBatchAction('enableSystemProxy')}
            disabled={batchActionLoading}
           
           
          >
            批量开启系统代理
          </Button>
          <Button type="button" variant="outline"
            onClick={() => runBatchAction('disableSystemProxy')}
            disabled={batchActionLoading}
           
           
          >
            批量关闭系统代理
          </Button>
          <Button type="button" variant="outline" onClick={() => runBatchAction('enable')} disabled={batchActionLoading}>
            批量启用
          </Button>
          <Button type="button" variant="outline" onClick={() => runBatchAction('disable')} disabled={batchActionLoading}>
            批量禁用
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={() => runBatchAction('delete')} disabled={batchActionLoading}>
            批量删除
          </Button>
        </ResponsiveBatchActionBar>
      )}

      <InfoNote className="mb-3">
        站点权重说明：最终站点倍率 = 站点全局权重 × 设置页中下游 API Key 的站点倍率。它会与路由策略因子（基础权重、价值分、成本、余额、使用频次）共同作用。数值越大，该站点在同优先级下越容易被选中。建议范围 0.5-3，默认 1；长期不建议超过 5。
      </InfoNote>

      <DeleteConfirmModal
        open={Boolean(deleteConfirm)}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={confirmDelete}
        title="确认删除站点"
        confirmText="确认删除"
        loading={batchActionLoading || (deleteConfirm?.mode === 'single' && deleting === deleteConfirm?.siteId)}
        description={deleteConfirm?.mode === 'single'
          ? <>确定要删除站点 <strong>{deleteConfirm.siteName || `#${deleteConfirm.siteId}`}</strong> 吗？</>
          : <>确定要删除选中的 <strong>{deleteConfirm?.count || 0}</strong> 个站点吗？</>}
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
              {isEditing ? '编辑站点' : '添加站点'}
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
                取消
              </Button>
              <Button type="button"
                onClick={handleSave}
                disabled={saving || !form.name.trim() || !form.url.trim()}
               
              >
                {saving ? <><LoaderCircle className="size-4 animate-spin" /> 保存中...</> : (isEditing ? '保存修改' : '保存站点')}
              </Button>
            </>
          )}
        >
          <ResponsiveFormGrid>
            <Input
              placeholder="站点名称"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <div className={`flex gap-2 ${isMobile ? 'flex-col' : 'flex-row'}`}>
              <Input
                data-testid="site-primary-url-input"
                placeholder="准确主站点 URL（面板/登录/签到地址，如 https://nih.cc）"
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
                {detecting ? <><LoaderCircle className="size-4 animate-spin" /> 检测中</> : '自动检测'}
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
                placeholder="平台类型（可自动检测）"
              />
            </div>
            <Input
              placeholder="外部签到/福利站点 URL（可选）"
              value={form.externalCheckinUrl}
              onChange={(e) => setForm((prev) => ({ ...prev, externalCheckinUrl: e.target.value }))}
            />
          </ResponsiveFormGrid>
          {activeInitializationPreset && (
            <Alert className="animate-scale-in">
              <AlertTitle>已应用官方预设 · {activeInitializationPreset.label}</AlertTitle>
              <AlertDescription className="leading-relaxed">
                <div>{activeInitializationPreset.description}</div>
                {form.url.trim() === activeInitializationPreset.defaultUrl && (
                  <div>当前已自动填入官方地址；如需走自建网关，也可以直接改 URL。</div>
                )}
                <div>推荐模型：{activeInitializationPreset.recommendedModels.join(' / ')}</div>
              </AlertDescription>
            </Alert>
          )}
          <div className="text-xs leading-relaxed text-muted-foreground">
            请填写准确的主站点 URL。这里填写主站点/面板/登录地址，用于登录、签到、面板接口和系统访问令牌管理；不要把 OpenAI/Gemini 请求路径直接填到主站点 URL；如果 API 请求地址和主站点不同，请在下面的 API 请求地址池里填写。
          </div>
          {primarySiteUrlAnalysis.action === 'auto_strip_known_api_suffix' && primarySiteUrlAnalysis.persistedUrl ? (
            <Alert className="animate-scale-in">
              <AlertTitle>检测到常见 API 路径后缀</AlertTitle>
              <AlertDescription className="leading-relaxed">
                保存或自动检测时会将主站点 URL 规范化为 {primarySiteUrlAnalysis.persistedUrl}。
              </AlertDescription>
            </Alert>
          ) : null}
          {primarySiteUrlAnalysis.action === 'preserve_api_path' && primarySiteUrlAnalysis.persistedUrl ? (
            <Alert className="animate-scale-in">
              <AlertTitle>请确认主站点 URL</AlertTitle>
              <AlertDescription className="leading-relaxed">
                当前 URL 含 /api 路径，将原样保留。请确认这就是准确的主站点 URL；如果这是 API 请求地址，请填到下方的 API 请求地址池。
              </AlertDescription>
            </Alert>
          ) : null}
          {primarySiteUrlAnalysis.action === 'preserve_unknown_path' && primarySiteUrlAnalysis.persistedUrl ? (
            <Alert className="animate-scale-in">
              <AlertTitle>请确认主站点 URL</AlertTitle>
              <AlertDescription className="leading-relaxed">
                当前 URL 含额外路径，将原样保留。请确认这就是准确的主站点 URL；如果这是 API 请求地址，请填到下方的 API 请求地址池。
              </AlertDescription>
            </Alert>
          ) : null}
          <UpstreamCompatibilityPolicyEditor
            value={compatibilityPolicyForm}
            disabled={saving}
            onChange={setCompatibilityPolicyForm}
          />
          <ConfigSection
            title="API 请求地址池"
            description="这里只用于 `/v1/*`、模型发现和 API Key 验证。不填时默认跟随主站点 URL；多条地址会按列表顺序参与轮询，禁用的地址不会参与调度。"
            actions={(
              <Button
                variant="outline"
                type="button"
                onClick={addApiEndpointRow}
              >
                + 添加 API 地址
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
                    placeholder="API 请求地址（如 https://api.nih.cc）"
                    value={endpoint.url}
                    onChange={(e) => updateApiEndpointRow(index, { url: e.target.value })}
                    className="flex-1 font-mono"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Checkbox
                      checked={endpoint.enabled !== false}
                      onCheckedChange={(checked) => updateApiEndpointRow(index, { enabled: checked === true })}        />
                    启用
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>顺序 #{index + 1}</span>
                    {endpoint.cooldownUntil ? <span>冷却至 {formatDateTimeLocal(endpoint.cooldownUntil)}</span> : null}
                    {endpoint.lastFailureReason ? <span>最近失败: {endpoint.lastFailureReason}</span> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" size="sm"
                      type="button"
                      onClick={() => moveApiEndpointRow(index, 'up')}
                      disabled={index === 0}
                     
                    >
                      上移
                    </Button>
                    <Button variant="ghost" size="sm"
                      type="button"
                      onClick={() => moveApiEndpointRow(index, 'down')}
                      disabled={index>= form.apiEndpoints.length - 1}
                     
                    >
                      下移
                    </Button>
                    <Button variant="destructive" size="sm"
                      type="button"
                      onClick={() => removeApiEndpointRow(index)}
                     
                    >
                      删除
                    </Button>
                  </div>
                </div>
              </ConfigSectionItem>
            ))}
          </ConfigSection>
          <ConfigSection
            title="站点自定义请求头"
            actions={(
              <Button
                variant="outline"
                type="button"
                onClick={addCustomHeaderRow}
              >
                + 添加请求头
              </Button>
            )}
          >
            {form.customHeaders.map((header, index) => (
              <ConfigSectionItem
                key={`custom-header-${index}`}
                className={isMobile ? 'flex flex-col items-stretch gap-2' : 'flex flex-row items-center gap-2'}
              >
                <Input
                  placeholder="Header 名称"
                  value={header.key}
                  onChange={(e) => updateCustomHeaderRow(index, 'key', e.target.value)}
                  className="flex-1 font-mono"
                />
                <Input
                  placeholder="Header 值"
                  value={header.value}
                  onChange={(e) => updateCustomHeaderRow(index, 'value', e.target.value)}
                  className="flex-1 font-mono"
                />
                <Button variant="destructive" size="sm"
                  type="button"
                  onClick={() => removeCustomHeaderRow(index)}
                 
                 
                >
                  删除
                </Button>
              </ConfigSectionItem>
            ))}
            <div className="text-xs leading-relaxed text-muted-foreground">
              按 key/value 逐条填写。整行留空会自动忽略；同名请求头不允许重复；请求本身显式传入的请求头优先级更高。
            </div>
          </ConfigSection>
          {isEditing && (
            <ConfigSection
              title="禁用模型管理"
              description="在此站点禁用指定模型后，路由重建时将不为该站点的这些模型创建通道。勾选表示禁用该模型。"
            >
                {disabledModelsLoading ? (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" /> 加载中...
                  </div>
                ) : (
                  <>
                    {/* Search and brand group controls */}
                    {brandGroups.length > 0 ? (
                      <div className="mb-2.5">
                        <Input
                          placeholder="搜索模型名称..."
                          value={disabledModelSearch}
                          onChange={(e) => setDisabledModelSearch(e.target.value)}
                          className="mb-2"
                        />
                        {/* Brand group quick actions */}
                        <div className="mb-2 flex flex-wrap gap-1">
                          <span className="text-xs leading-6 text-muted-foreground">按品牌全选：</span>
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
                            <div className="px-3 py-2 text-xs text-muted-foreground">无匹配模型</div>
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
                        暂无已发现模型，仍可手动添加需要屏蔽的模型名。
                      </div>
                    )}

                    <div className="mb-2.5 mt-2.5 flex gap-2">
                      <Input
                        placeholder="输入模型名称，如 gpt-4o"
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
                        添加模型
                      </Button>
                    </div>

                    <div className="mt-2.5 flex items-center gap-2.5">
                      <Button type="button"
                        onClick={handleSaveDisabledModels}
                        disabled={disabledModelsSaving}
                       
                       
                      >
                        {disabledModelsSaving ? <><LoaderCircle className="size-4 animate-spin" /> 保存中...</> : '保存禁用列表'}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        已禁用 {disabledModels.length} 个模型
                      </span>
                    </div>
                  </>
                )}
            </ConfigSection>
          )}

          {isEditing && (
            <ConfigSection
              title="刷新后自动测试请求"
              description="开启后，每次自动获取模型列表成功后，会对指定模型发送一次真实测试请求。若判定不可用，自动加入站点禁用列表并重建路由。"
            >
              <label className="mb-2.5 flex cursor-pointer items-start gap-2.5">
                <Checkbox
                  checked={probeEnabled}
                  onCheckedChange={(checked) => setProbeEnabled(checked === true)}
                  className="mt-0.5 shrink-0"
                />
                <span className="text-sm text-muted-foreground">开启刷新后自动探测</span>
              </label>
              <RadioGroup value={probeScope} onValueChange={(nextValue) => setProbeScope(nextValue as typeof probeScope)} className="mb-3 flex flex-wrap gap-2" disabled={!probeEnabled}>
                {([['single', '指定模型'] , ['all', '全部模型']] as const).map(([val, label]) => (
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
                  placeholder="探测模型名（留空则自动取第一个发现的模型）"
                  value={probeModel}
                  onChange={(e) => setProbeModel(e.target.value)}
                  disabled={!probeEnabled}
                  className="mb-2.5 font-mono"
                />
              )}
              <div className="mb-2.5 flex items-center gap-2">
                <span className="whitespace-nowrap text-xs text-muted-foreground">延迟阈值</span>
                <Input
                  type="number"
                  min="0"
                  step="500"
                  placeholder="0"
                  value={probeLatencyThreshold}
                  onChange={(e) => setProbeLatencyThreshold(e.target.value)}
                  className="w-24"
                />
                <span className="text-xs text-muted-foreground">ms（响应超过该时间则自动禁用，0=不限）</span>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <Button type="button" variant="outline"
                  onClick={() => void handleSaveProbeSettings()}
                  disabled={probeSaving || probing}
                 
                 
                >
                  {probeSaving ? <><LoaderCircle className="size-4 animate-spin" /> 保存中...</> : '保存探测设置'}
                </Button>
                <Button type="button"
                  onClick={() => void handleProbeNow()}
                  disabled={probing || probeSaving}
                 
                 
                >
                  {probing ? <><LoaderCircle className="size-4 animate-spin" /> 探测中...</> : '立即探测'}
                </Button>
                {probing && (
                  <Button type="button" variant="outline"
                    onClick={() => { probeAbortRef.current?.abort(); }}
                   
                   
                  >
                    停止
                  </Button>
                )}
                <span className="text-xs text-muted-foreground">
                  {probeEnabled ? '实际探测超时复用「批量测活超时」设置' : '当前已关闭'}
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
                    探测后模型状态
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      — 可用 {availableModels.filter((m) => !disabledModelSet.has(m)).length} 个，已禁用 {disabledModels.length} 个
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
                placeholder="站点代理（可选，如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080）"
                value={form.proxyUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, proxyUrl: e.target.value }))}
              />
              <div className="text-xs text-muted-foreground">
                这里只是 HTTP/SOCKS 代理地址，不是上游 API 请求地址。填写后优先使用站点代理；留空则使用系统代理或直连(取决于设置开关状态)。
              </div>
            </div>
            <label className="flex items-center gap-2.5 rounded-md border bg-muted px-3.5 py-2.5 text-sm text-foreground">
              <Checkbox
                checked={form.useSystemProxy}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, useSystemProxy: checked === true }))}  />
              使用系统代理
            </label>
            <div className="flex flex-col gap-1.5">
              <Input
                placeholder="站点全局权重（默认 1）"
                value={form.globalWeight}
                onChange={(e) => setForm((prev) => ({ ...prev, globalWeight: e.target.value }))}
              />
              <div className="text-xs text-muted-foreground">
                越大越容易被路由选中。建议 0.5-3，默认 1。
              </div>
            </div>
          </ResponsiveFormGrid>
        </CenteredModal>
      )}

      <Card className="overflow-x-auto">
        {sites.length > 0 ? (
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
                        <Button variant="ghost" size="sm"
                          type="button"
                          onClick={() => toggleSiteDetails(site.id)}
                         
                        >
                          {isExpanded ? '收起' : '详情'}
                        </Button>
                        <Button type="button" variant="ghost" size="sm"
                          onClick={() => handleOpenSiteApiKey(site)}
                         
                        >
                          添加 Key
                        </Button>
                        <Button type="button" variant="ghost" size="sm"
                          onClick={() => openEdit(site)}
                         
                        >
                          编辑
                        </Button>
                        <Button type="button" variant="secondary" size="sm"
                          onClick={() => handleToggleStatus(site)}
                          disabled={togglingSiteId === site.id}
                         
                        >
                          {togglingSiteId === site.id ? <LoaderCircle className="size-4 animate-spin" /> : (site.status === 'disabled' ? '启用' : '禁用')}
                        </Button>
                      </>
                    )}
                  >
                    <MobileField
                      label="状态"
                      value={(
                        <ToneBadge tone={site.status === 'disabled' ? 'muted' : 'success'}>
                          {site.status === 'disabled' ? '禁用' : '启用'}
                        </ToneBadge>
                      )}
                    />
                    <MobileField
                      label="平台"
                      value={(
                        <ToneBadge tone={platformColors[site.platform || ''] || 'muted'}>
                          {site.platform || '-'}
                        </ToneBadge>
                      )}
                    />
                    <MobileField
                      label="余额"
                      value={(
                        <SiteBalanceDisplay
                          balance={site.totalBalance}
                          summary={site.subscriptionSummary}
                          align="end"
                        />
                      )}
                    />
                    <MobileField label="权重" value={(site.globalWeight || 1).toFixed(2)} />
                    {isExpanded ? (
                      <div className="mt-3 grid gap-2">
                        <MobileField
                          label="主站点 URL"
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
                          label="API 请求地址"
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
                                  {endpoint.enabled === false ? '（已禁用）' : ''}
                                </span>
                              ))}
                            </div>
                          )}
                        />
                        <MobileField
                          label="系统代理"
                          value={(
                            <ToneBadge tone={site.useSystemProxy ? 'info' : 'muted'}>
                              {site.useSystemProxy ? '已开启' : '未开启'}
                            </ToneBadge>
                          )}
                        />
                        <MobileField
                          label="外部签到站URL"
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
                          label="自定义头"
                          value={hasConfiguredCustomHeaders(site.customHeaders) ? '已配置' : '-'}
                        />
                        <MobileField
                          label="创建时间"
                          value={formatDateTimeLocal(site.createdAt)}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <Button type="button" variant="secondary" size="sm"
                            onClick={() => handleTogglePin(site)}
                            disabled={pinningSiteId === site.id}
                           
                          >
                            {pinningSiteId === site.id ? <LoaderCircle className="size-4 animate-spin" /> : (site.isPinned ? '取消置顶' : '置顶')}
                          </Button>
                          {sortMode === 'custom' && (
                            <>
                              <Button type="button" variant="ghost" size="sm"
                                onClick={() => handleMoveCustomOrder(site, 'up')}
                                disabled={orderingSiteId === site.id}
                               
                              >
                                ↑ 上移
                              </Button>
                              <Button type="button" variant="ghost" size="sm"
                                onClick={() => handleMoveCustomOrder(site, 'down')}
                                disabled={orderingSiteId === site.id}
                               
                              >
                                ↓ 下移
                              </Button>
                            </>
                          )}
                          <Button type="button" variant="destructive" size="sm"
                            onClick={() => handleDelete(site)}
                            disabled={deleting === site.id}
                           
                          >
                            {deleting === site.id ? <LoaderCircle className="size-4 animate-spin" /> : null}
                            删除
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </MobileCard>
                );
              })}
            </div>
          ) : (
            <Table className="w-full text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-11">
                    <Checkbox
                     
                      checked={allVisibleSitesSelected}
                      onCheckedChange={(checked) => toggleSelectAllVisible(checked === true)}        />
                  </TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>外部签到站URL</TableHead>
                  <TableHead>总余额</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>系统代理</TableHead>
                  <TableHead>权重</TableHead>
                  <TableHead>平台</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="sites-actions-col text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedSites.map((site, i) => (
                  <TableRow
                    key={site.id}
                    data-testid={`site-row-${site.id}`}
                    ref={(node) => {
                      if (node) rowRefs.current.set(site.id, node);
                      else rowRefs.current.delete(site.id);
                    }}
                    onClick={(event) => handleSiteRowClick(site.id, event)}
                    className={`animate-slide-up stagger-${Math.min(i + 1, 5)} row-selectable ${selectedSiteIds.includes(site.id) ? 'row-selected' : ''} ${highlightSiteId === site.id ? 'row-focus-highlight' : ''}`.trim()}
                  >
                    <TableCell>
                      <Checkbox
                        data-testid={`site-select-${site.id}`}
                       
                        checked={selectedSiteIds.includes(site.id)}
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
                            自定义头
                          </ToneBadge>
                        ) : null}
                        <ToneBadge tone={getConfiguredSiteApiEndpoints(site).length> 0 ? 'warning' : 'muted'}>
                          API 地址: {buildSiteApiEndpointSummary(site)}
                        </ToneBadge>
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
                    <TableCell className="site-balance-cell">
                      <SiteBalanceDisplay
                        balance={site.totalBalance}
                        summary={site.subscriptionSummary}
                      />
                    </TableCell>
                    <TableCell>
                      <ToneBadge tone={site.status === 'disabled' ? 'muted' : 'success'}>
                        {site.status === 'disabled' ? '禁用' : '启用'}
                      </ToneBadge>
                    </TableCell>
                    <TableCell>
                      <ToneBadge tone={site.useSystemProxy ? 'info' : 'muted'}>
                        {site.useSystemProxy ? '已开启' : '未开启'}
                      </ToneBadge>
                    </TableCell>
                    <TableCell className="font-semibold tabular-nums">
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
                    <TableCell className="text-xs text-muted-foreground">
                      <a
                        href={site.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground underline"
                      >
                        {formatDateTimeLocal(site.createdAt)}
                      </a>
                    </TableCell>
                    <TableCell className="sites-actions-cell text-right">
                      <div className="sites-row-actions">
                        <Button type="button" variant="secondary" size="sm"
                          onClick={() => handleTogglePin(site)}
                          disabled={pinningSiteId === site.id}
                         
                        >
                          {pinningSiteId === site.id ? <LoaderCircle className="size-4 animate-spin" /> : (site.isPinned ? '取消置顶' : '置顶')}
                        </Button>
                        {sortMode === 'custom' && (
                          <>
                            <Button type="button" variant="ghost" size="sm"
                              onClick={() => handleMoveCustomOrder(site, 'up')}
                              disabled={orderingSiteId === site.id}
                             
                            >
                              ↑
                            </Button>
                            <Button type="button" variant="ghost" size="sm"
                              onClick={() => handleMoveCustomOrder(site, 'down')}
                              disabled={orderingSiteId === site.id}
                             
                            >
                              ↓
                            </Button>
                          </>
                        )}
                        <Button type="button" variant="ghost" size="sm"
                          onClick={() => handleOpenSiteApiKey(site)}
                         
                        >
                          添加 Key
                        </Button>
                        <Button type="button" variant="ghost" size="sm"
                          onClick={() => openEdit(site)}
                         
                        >
                          编辑
                        </Button>
                        <Button type="button" variant="secondary" size="sm"
                          onClick={() => handleToggleStatus(site)}
                          disabled={togglingSiteId === site.id}
                         
                        >
                          {togglingSiteId === site.id ? <LoaderCircle className="size-4 animate-spin" /> : (site.status === 'disabled' ? '启用' : '禁用')}
                        </Button>
                        <Button type="button" variant="destructive" size="sm"
                          onClick={() => handleDelete(site)}
                          disabled={deleting === site.id}
                         
                        >
                          {deleting === site.id ? <LoaderCircle className="size-4 animate-spin" /> : null}
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        ) : (
          <EmptyStateBlock title="暂无站点" description="点击“+ 添加站点”开始使用。" />
        )}
      </Card>
    </div>
  );
}
