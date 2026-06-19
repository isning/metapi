import { Fragment, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DragEndEvent } from '@dnd-kit/core';
import { api } from '../api.js';
import { BrandGlyph, getBrand, InlineBrandIcon, type BrandInfo } from '../components/BrandIcon.js';
import { useToast } from '../components/Toast.js';
import { MobileCard, MobileField } from '../components/MobileCard.js';
import ResponsiveFilterPanel from '../components/ResponsiveFilterPanel.js';
import { Badge } from '../components/ui/badge/index.js';
import { Button } from '../components/ui/button/index.js';
import { ButtonGroup } from '../components/ui/button-group/index.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card/index.js';
import { Checkbox } from '../components/ui/checkbox/index.js';
import * as Dialog from '../components/ui/dialog/index.js';
import * as DropdownMenu from '../components/ui/dropdown-menu/index.js';
import { Input } from '../components/ui/input/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select/index.js';
import * as Tabs from '../components/ui/tabs/index.js';
import { useIsMobile } from '../components/useIsMobile.js';
import { tr } from '../i18n.js';
import { ROUTE_DECISION_REFRESH_TASK_TYPE } from '../../shared/tokenRouteContract.js';
import {
  buildRouteModelCandidatesIndex,
  type RouteCandidateView,
  type RouteModelCandidatesByModelName,
} from './helpers/routeModelCandidatesIndex.js';
import { getInitialVisibleCount, getNextVisibleCount } from './helpers/progressiveRender.js';
import {
  buildRouteMissingTokenIndex,
  normalizeMissingTokenModels,
  type MissingTokenModelsByName,
  type RouteMissingTokenHint,
} from './helpers/routeMissingTokenHints.js';
import { buildVisibleRouteList } from './helpers/routeListVisibility.js';
import { buildZeroChannelPlaceholderRoutes } from './helpers/zeroChannelRoutes.js';
import {
  getRouteRoutingStrategyDescription,
  getRouteRoutingStrategyLabel,
  normalizeRouteRoutingStrategyValue,
} from './token-routes/routingStrategy.js';

import type {
  RouteSortBy,
  RouteSortDir,
  GroupFilter,
  RouteSummaryRow,
  RouteRoutingStrategy,
  RouteDecision,
  RouteIconOption,
  MissingTokenRouteSiteActionItem,
  MissingTokenGroupRouteSiteActionItem,
  GroupRouteItem,
} from './token-routes/types.js';
import {
  ROUTE_RENDER_CHUNK,
  isExplicitGroupRoute,
  isExactModelPattern,
  isRouteExactModel,
  matchesModelPattern,
  getRouteBackendRouteIds,
  getRouteDisplayIcon,
  getRouteDisplayName,
  getRouteRequestedModelPattern,
  isRouteBackendReferences,
  resolveRouteTitle,
  resolveRouteBrand,
  resolveRouteIcon,
  toBrandIconValue,
  normalizeRouteDisplayIconValue,
  inferEndpointTypesFromPlatform,
  getModelPatternError,
} from './token-routes/utils.js';
import { applyPriorityRailDrop, isPriorityRailNewLayerId } from './token-routes/priorityRail.js';
import {
  buildRouteGraphNodeFromRoute,
  buildRouteGraphSnapshot,
  buildCandidateSelectorMacro,
  updateCandidateSelectorMacroFromEditor,
  routeGraphEditorFormToRoutePayload,
  routeGraphNodeToRoutePayload,
  validateRouteGraphSnapshot,
  type RouteGraphNodeDraft,
  type RouteGraphSnapshotMacro,
  type RouteGraphSnapshot,
} from './token-routes/routeGraphSnapshot.js';
import { useRouteChannels } from './token-routes/useRouteChannels.js';
import RouteFilterBar, { type EnabledFilter } from './token-routes/RouteFilterBar.js';
import ManualRoutePanel from './token-routes/ManualRoutePanel.js';
import RouteCard from './token-routes/RouteCard.js';
import AddChannelModal from './token-routes/AddChannelModal.js';
import RouteGraphWorkbench from './token-routes/RouteGraphWorkbench.js';
import { LoaderCircle } from 'lucide-react';

const EMPTY_ROUTE_CANDIDATE_VIEW: RouteCandidateView = {
  routeCandidates: [],
  accountOptions: [],
  tokenOptionsByAccountId: {},
};
const EMPTY_MISSING_ITEMS: MissingTokenRouteSiteActionItem[] = [];
const EMPTY_MISSING_GROUP_ITEMS: MissingTokenGroupRouteSiteActionItem[] = [];
const ROUTE_ICON_OPTIONS: RouteIconOption[] = [
  { value: '', label: '自动品牌图标', description: '按模型匹配规则自动识别品牌', iconText: '✦' },
];

type RouteEditorForm = {
  match: {
    kind: 'model';
    requestedModelPattern: string;
    displayName: string | null;
  };
  backend:
    | { kind: 'channels' }
    | { kind: 'routes'; routeIds: number[] };
  presentation: {
    displayName: string;
    displayIcon: string;
  };
  routingStrategy: RouteRoutingStrategy;
  enabled: boolean;
  modelMapping: string;
  advancedOpen: boolean;
  macro?: RouteGraphSnapshotMacro | null;
};
type ChannelDeleteConfirmation = {
  channelId: number;
  routeId: number;
  dontAskAgain: boolean;
  resolve: (confirmed: boolean, dontAskAgain: boolean) => void;
};
type SiteBlockConfirmation = {
  channelId: number;
  routeId: number;
  modelName: string;
  siteName: string;
  resolve: (confirmed: boolean) => void;
};

const EMPTY_ROUTE_FORM: RouteEditorForm = {
  match: {
    kind: 'model',
    requestedModelPattern: '',
    displayName: null,
  },
  backend: { kind: 'routes', routeIds: [] },
  presentation: {
    displayName: '',
    displayIcon: '',
  },
  routingStrategy: 'weighted',
  enabled: true,
  modelMapping: '',
  advancedOpen: false,
};
const DESKTOP_DETAIL_ENTER_MS = 260;
const DESKTOP_DETAIL_COLLAPSE_MS = 200;

function prefersReducedMotion(): boolean {
  return typeof globalThis.matchMedia === 'function'
    && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getRouteRoutingStrategySuccessMessage(value: RouteRoutingStrategy): string {
  if (value === 'round_robin') return '已切换为轮询策略';
  if (value === 'stable_first') return '已切换为稳定优先策略';
  return '已切换为权重随机策略';
}

function downloadJsonFile(filename: string, data: unknown): void {
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

export function DesktopDetailPanelPresence({
  open,
  children,
}: {
  open: boolean;
  children: (closing: boolean) => JSX.Element;
}) {
  const [shouldRender, setShouldRender] = useState(open);
  const [isOpen, setIsOpen] = useState(open);
  const [isEntering, setIsEntering] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const hasEverOpenedRef = useRef(open);

  useEffect(() => {
    const reduceMotion = prefersReducedMotion();

    if (open) {
      hasEverOpenedRef.current = true;
      setShouldRender(true);
      setIsOpen(true);
      setIsClosing(false);
      if (reduceMotion) {
        setIsEntering(false);
        return undefined;
      }
      setIsEntering(true);
      const enterTimerId = globalThis.setTimeout(() => {
        setIsEntering(false);
      }, DESKTOP_DETAIL_ENTER_MS);
      return () => globalThis.clearTimeout(enterTimerId);
    }

    if (!hasEverOpenedRef.current) {
      setShouldRender(false);
      setIsOpen(false);
      setIsEntering(false);
      setIsClosing(false);
      return undefined;
    }

    setIsOpen(false);
    setIsEntering(false);
    if (reduceMotion) {
      setShouldRender(false);
      setIsClosing(false);
      return undefined;
    }
    setIsClosing(true);
    const timerId = globalThis.setTimeout(() => {
      setShouldRender(false);
      setIsClosing(false);
    }, DESKTOP_DETAIL_COLLAPSE_MS);

    return () => globalThis.clearTimeout(timerId);
  }, [open]);

  if (!shouldRender) return null;
  return (
    <div
      className={`route-detail-panel-presence col-span-full ${isOpen ? 'is-open' : ''} ${isEntering ? 'is-entering' : ''} ${isClosing ? 'is-closing' : ''}`.trim()}
    >
      {children(isClosing)}
    </div>
  );
}

export default function TokenRoutes() {
  const navigate = useNavigate();
  const [routeEditorMode, setRouteEditorMode] = useState<'list' | 'graph' | 'json'>('list');
  const [routeSummaries, setRouteSummaries] = useState<RouteSummaryRow[]>([]);
  const [modelCandidates, setModelCandidates] = useState<RouteModelCandidatesByModelName>({});
  const [missingTokenModelsByName, setMissingTokenModelsByName] = useState<MissingTokenModelsByName>({});
  const [missingTokenGroupModelsByName, setMissingTokenGroupModelsByName] = useState<MissingTokenModelsByName>({});
  const [endpointTypesByModel, setEndpointTypesByModel] = useState<Record<string, string[]>>({});

  const [search, setSearch] = useState('');
  const [activeBrand, setActiveBrand] = useState<string | null>(null);
  const [activeSite, setActiveSite] = useState<string | null>(null);
  const [activeEndpointType, setActiveEndpointType] = useState<string | null>(null);
  const [activeGroupFilter, setActiveGroupFilter] = useState<GroupFilter>(null);
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>('all');
  const [filterCollapsed, setFilterCollapsed] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [showZeroChannelRoutes, setShowZeroChannelRoutes] = useState(false);
  const [sortBy, setSortBy] = useState<RouteSortBy>('channelCount');
  const [sortDir, setSortDir] = useState<RouteSortDir>('desc');

  const [showManual, setShowManual] = useState(false);
  const [form, setForm] = useState<RouteEditorForm>(EMPTY_ROUTE_FORM);
  const [editingRouteId, setEditingRouteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [batchUpdatingRoutes, setBatchUpdatingRoutes] = useState(false);
  const [batchSelectMode, setBatchSelectMode] = useState(false);
  const [selectedRouteIds, setSelectedRouteIds] = useState<Set<number>>(new Set());

  const [channelTokenDraft, setChannelTokenDraft] = useState<Record<number, number>>({});
  const [updatingChannel, setUpdatingChannel] = useState<Record<number, boolean>>({});
  const [savingPriorityByRoute, setSavingPriorityByRoute] = useState<Record<number, boolean>>({});
  const [updatingRoutingStrategyByRoute, setUpdatingRoutingStrategyByRoute] = useState<Record<number, boolean>>({});
  const [clearingCooldownByRoute, setClearingCooldownByRoute] = useState<Record<number, boolean>>({});

  const [decisionByRoute, setDecisionByRoute] = useState<Record<number, RouteDecision | null>>({});
  const [loadingDecision, setLoadingDecision] = useState(false);
  const [decisionAutoSkipped, setDecisionAutoSkipped] = useState(false);
  const [visibleRouteCount, setVisibleRouteCount] = useState(ROUTE_RENDER_CHUNK);
  const [expandedSourceGroupMap, setExpandedSourceGroupMap] = useState<Record<string, boolean>>({});
  const [expandedRouteIds, setExpandedRouteIds] = useState<number[]>([]);
  const [closingDesktopDetailRouteIds, setClosingDesktopDetailRouteIds] = useState<number[]>([]);
  const [addChannelModalRouteId, setAddChannelModalRouteId] = useState<number | null>(null);
  const [channelDeleteConfirmation, setChannelDeleteConfirmation] = useState<ChannelDeleteConfirmation | null>(null);
  const [siteBlockConfirmation, setSiteBlockConfirmation] = useState<SiteBlockConfirmation | null>(null);
  const isMobile = useIsMobile();
  const desktopDetailCloseTimersRef = useRef<Record<number, ReturnType<typeof globalThis.setTimeout>>>({});
  const routeGraphImportInputRef = useRef<HTMLInputElement>(null);

  const {
    channelsByRouteId,
    loadingChannelsByRouteId,
    loadChannels,
    invalidateChannels,
    setChannels,
  } = useRouteChannels();

  const toast = useToast();

  const confirmDeleteChannel = useCallback((channelId: number, routeId: number) => new Promise<{ confirmed: boolean; dontAskAgain: boolean }>((resolve) => {
    setChannelDeleteConfirmation({
      channelId,
      routeId,
      dontAskAgain: false,
      resolve: (confirmed, dontAskAgain) => resolve({ confirmed, dontAskAgain }),
    });
  }), []);

  const closeDeleteChannelConfirmation = useCallback((confirmed: boolean) => {
    setChannelDeleteConfirmation((current) => {
      current?.resolve(confirmed, current.dontAskAgain);
      return null;
    });
  }, []);

  const confirmSiteBlock = useCallback((input: Omit<SiteBlockConfirmation, 'resolve'>) => new Promise<boolean>((resolve) => {
    setSiteBlockConfirmation({ ...input, resolve });
  }), []);

  const closeSiteBlockConfirmation = useCallback((confirmed: boolean) => {
    setSiteBlockConfirmation((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  const candidatesLoadedRef = useRef(false);
  const candidatesPromiseRef = useRef<Promise<void> | null>(null);
  const candidatesVersionRef = useRef(0);
  const candidatesSeqRef = useRef(0);
  const decisionRefreshWatchSeqRef = useRef(0);
  const mountedRef = useRef(true);

  const loadCandidates = (force?: boolean) => {
    if (candidatesLoadedRef.current && !force) return;
    if (candidatesPromiseRef.current && !force) return;
    const seq = ++candidatesSeqRef.current;
    candidatesLoadedRef.current = true;
    let promise!: Promise<void>;
    promise = (async () => {
      try {
        const candidateRows = await api.getModelTokenCandidates();
        if (candidatesSeqRef.current !== seq) return; // stale
        startTransition(() => {
          setModelCandidates((candidateRows?.models || {}) as RouteModelCandidatesByModelName);
          setMissingTokenModelsByName(
            normalizeMissingTokenModels((candidateRows?.modelsWithoutToken || {}) as MissingTokenModelsByName),
          );
          setMissingTokenGroupModelsByName(
            normalizeMissingTokenModels((candidateRows?.modelsMissingTokenGroups || {}) as MissingTokenModelsByName),
          );
          setEndpointTypesByModel(candidateRows?.endpointTypesByModel || {});
        });
        candidatesVersionRef.current = Date.now();
      } catch {
        if (candidatesSeqRef.current === seq) candidatesLoadedRef.current = false;
      } finally {
        if (candidatesPromiseRef.current === promise) {
          candidatesPromiseRef.current = null;
        }
      }
    })();
    candidatesPromiseRef.current = promise;
  };

  const load = async () => {
    const summaryRows = await api.getRoutesSummary();

    const summaries = (summaryRows || []) as RouteSummaryRow[];
    setRouteSummaries(summaries);
    const decisionPlaceholder: Record<number, RouteDecision | null> = {};
    for (const route of summaries) {
      decisionPlaceholder[route.id] = route.decisionSnapshot || null;
    }
    setDecisionByRoute(decisionPlaceholder);
    setDecisionAutoSkipped(
      summaries.some((route) => isRouteExactModel(route) && !route.decisionSnapshot),
    );

    // Silently refresh candidates in the background if already loaded
    if (candidatesLoadedRef.current) {
      loadCandidates(true);
    }
  };

  const loadRef = useRef(load);
  loadRef.current = load;

  const toastRef = useRef(toast);
  toastRef.current = toast;

  const monitorRouteDecisionRefreshTask = useCallback((taskId: string) => {
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId) return;

    const taskFetcher = (api as { getTask?: (id: string) => Promise<unknown> }).getTask;
    if (typeof taskFetcher !== 'function') {
      setLoadingDecision(false);
      return;
    }

    const watchSeq = ++decisionRefreshWatchSeqRef.current;
    setLoadingDecision(true);
    setDecisionAutoSkipped(false);

    void (async () => {
      while (mountedRef.current && decisionRefreshWatchSeqRef.current === watchSeq) {
        try {
          const taskResponse = await taskFetcher(normalizedTaskId) as {
            task?: { status?: string; message?: string; error?: string | null };
          };
          const task = taskResponse?.task;
          if (!task) {
            throw new Error('路由选中概率任务不存在');
          }

          const status = String(task.status || '').trim();
          if (status === 'pending' || status === 'running') {
            await new Promise((resolve) => setTimeout(resolve, 1200));
            continue;
          }

          if (!mountedRef.current || decisionRefreshWatchSeqRef.current !== watchSeq) return;
          await loadRef.current();
          if (!mountedRef.current || decisionRefreshWatchSeqRef.current !== watchSeq) return;

          setLoadingDecision(false);
          if (status === 'succeeded') {
            toastRef.current.success('路由选择概率已刷新');
          } else {
            toastRef.current.error(String(task.message || task.error || '刷新路由选择概率失败'));
          }
          return;
        } catch (error: any) {
          if (!mountedRef.current || decisionRefreshWatchSeqRef.current !== watchSeq) return;
          setLoadingDecision(false);
          toastRef.current.error(error?.message || '刷新路由选择概率失败');
          return;
        }
      }
    })();
  }, []);

  const resumeRouteDecisionRefreshTask = useCallback(async () => {
    const tasksFetcher = (api as { getTasks?: (limit?: number) => Promise<unknown> }).getTasks;
    if (typeof tasksFetcher !== 'function') {
      setLoadingDecision(false);
      return;
    }

    try {
      const tasksResponse = await tasksFetcher(50) as {
        tasks?: Array<{ id?: string; type?: string; status?: string }>;
      };
      const runningTask = Array.isArray(tasksResponse?.tasks)
        ? tasksResponse.tasks.find((task) => (
          String(task?.type || '').trim() === ROUTE_DECISION_REFRESH_TASK_TYPE
          && (task?.status === 'pending' || task?.status === 'running')
        ))
        : null;
      const taskId = String(runningTask?.id || '').trim();
      if (!taskId) {
        setLoadingDecision(false);
        return;
      }
      monitorRouteDecisionRefreshTask(taskId);
    } catch {
      setLoadingDecision(false);
    }
  }, [monitorRouteDecisionRefreshTask]);

  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      try {
        await resumeRouteDecisionRefreshTask();
        await load();
      } catch {
        toast.error('加载路由配置失败');
      }
      // Preload candidates in background after first paint
      const scheduleIdle = typeof requestIdleCallback === 'function' ? requestIdleCallback : (cb: () => void) => setTimeout(cb, 0);
      scheduleIdle(() => loadCandidates());
    })();
    return () => {
      mountedRef.current = false;
      decisionRefreshWatchSeqRef.current += 1;
    };
  }, [resumeRouteDecisionRefreshTask, toast]);

  const handleRebuild = async () => {
    try {
      setRebuilding(true);
      const res = await api.rebuildRoutes(true);
      if (res?.queued) {
        toast.info(res.message || '已开始重建路由，请稍后查看日志');
        invalidateChannels();
        await load();
        return;
      }
      const createdRoutes = res?.rebuild?.createdRoutes ?? 0;
      const createdChannels = res?.rebuild?.createdChannels ?? 0;
      toast.success(`自动重建完成（新增 ${createdRoutes} 条路由 / ${createdChannels} 个通道）`);
      invalidateChannels();
      await load();
    } catch (e: any) {
      toast.error(e.message || '重建路由失败');
    } finally {
      setRebuilding(false);
    }
  };

  const handleRefreshRouteDecisions = async () => {
    try {
      const response = await api.refreshRouteDecisionSnapshots() as {
        message?: string;
        jobId?: string;
      };
      const taskId = String(response?.jobId || '').trim();
      if (!taskId) {
        throw new Error('刷新任务未返回 taskId');
      }

      toast.info(response?.message || '已开始后台刷新路由选中概率，可稍后返回查看');
      monitorRouteDecisionRefreshTask(taskId);
    } catch (error: any) {
      toast.error(error?.message || '刷新路由选择概率失败');
    }
  };

  const exactRouteCount = useMemo(
    () => buildVisibleRouteList(routeSummaries, isExactModelPattern, matchesModelPattern)
      .filter((route) => isRouteExactModel(route)).length,
    [routeSummaries],
  );

  const zeroChannelPlaceholderRoutes = useMemo(
    () => buildZeroChannelPlaceholderRoutes(routeSummaries, missingTokenModelsByName, missingTokenGroupModelsByName),
    [routeSummaries, missingTokenModelsByName, missingTokenGroupModelsByName],
  );

  const visibleRouteRows = useMemo(
    () => (showZeroChannelRoutes ? [...routeSummaries, ...zeroChannelPlaceholderRoutes] : routeSummaries),
    [routeSummaries, showZeroChannelRoutes, zeroChannelPlaceholderRoutes],
  );

  const canSaveRoute = useMemo(() => {
    if (saving) return false;
    if (form.backend.kind === 'routes') {
      return !!form.presentation.displayName.trim() && form.backend.routeIds.length > 0;
    }
    return !!form.match.requestedModelPattern.trim() && !getModelPatternError(form.match.requestedModelPattern);
  }, [form.backend, form.match.requestedModelPattern, form.presentation.displayName, saving]);

  const previewModelSamples = useMemo(() => {
    if (!showManual) return [];
    const names = new Set<string>();
    for (const modelName of Object.keys(modelCandidates || {})) {
      const normalized = modelName.trim();
      if (normalized) names.add(normalized);
    }
    for (const route of routeSummaries) {
      if (!isRouteExactModel(route)) continue;
      const normalized = getRouteRequestedModelPattern(route).trim();
      if (normalized) names.add(normalized);
    }
    return Array.from(names)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .slice(0, 800);
  }, [showManual, modelCandidates, routeSummaries]);

  const exactSourceRouteOptions = useMemo(
    () => routeSummaries.filter((route) => isRouteExactModel(route)),
    [routeSummaries],
  );

  const resetRouteForm = () => {
    setForm(EMPTY_ROUTE_FORM);
    setEditingRouteId(null);
  };

  const openRouteWizard = (kind: 'references' | 'direct') => {
    loadCandidates();
    setEditingRouteId(null);
    setForm({
      ...EMPTY_ROUTE_FORM,
      backend: kind === 'references' ? { kind: 'routes', routeIds: [] } : { kind: 'channels' },
      advancedOpen: kind === 'direct',
      macro: null,
    });
    setShowManual(true);
  };

  const handleAddRoute = async () => {
    const trimmedDisplayName = form.presentation.displayName.trim() ? form.presentation.displayName.trim() : null;
    const trimmedDisplayIcon = form.presentation.displayIcon.trim() ? form.presentation.displayIcon.trim() : null;
    const trimmedModelPattern = form.match.requestedModelPattern.trim();
    const trimmedModelMapping = form.modelMapping.trim() ? form.modelMapping.trim() : undefined;
    if (trimmedModelMapping) {
      try {
        const parsedMapping = JSON.parse(trimmedModelMapping);
        if (!parsedMapping || typeof parsedMapping !== 'object' || Array.isArray(parsedMapping)) {
          toast.error('模型映射必须是 JSON 对象');
          return;
        }
      } catch {
        toast.error('模型映射 JSON 格式错误');
        return;
      }
    }
    if (form.backend.kind === 'routes') {
      if (!trimmedDisplayName) {
        toast.error('请填写对外模型名');
        return;
      }
      if (form.backend.routeIds.length === 0) {
        toast.error('请至少选择一个来源模型');
        return;
      }
    } else {
      if (!trimmedModelPattern) return;
      const modelPatternError = getModelPatternError(form.match.requestedModelPattern);
      if (modelPatternError) {
        toast.error(modelPatternError);
        return;
      }
    }

    setSaving(true);
    try {
      const payload = routeGraphEditorFormToRoutePayload({
        ...form,
        match: {
          ...form.match,
          requestedModelPattern: form.backend.kind === 'routes' ? '' : trimmedModelPattern,
          displayName: trimmedDisplayName,
        },
        presentation: {
          displayName: trimmedDisplayName || '',
          displayIcon: trimmedDisplayIcon || '',
        },
        modelMapping: trimmedModelMapping ?? '',
        macro: form.backend.kind === 'routes' && trimmedDisplayName
          ? updateCandidateSelectorMacroFromEditor({
            macro: form.macro,
            id: editingRouteId || undefined,
            stableId: editingRouteId ? `route:${editingRouteId}:model-group` : undefined,
            displayName: trimmedDisplayName,
            displayIcon: trimmedDisplayIcon,
            visibility: 'public',
            enabled: form.enabled,
            routingStrategy: form.routingStrategy,
            routeIds: form.backend.routeIds,
          })
          : null,
      });
      if (editingRouteId) {
        const currentRoute = routeSummaries.find((route) => route.id === editingRouteId) || null;
        const modelPatternChanged = form.backend.kind === 'channels' && !!currentRoute && getRouteRequestedModelPattern(currentRoute) !== trimmedModelPattern;
        await api.updateRoute(editingRouteId, payload);
        toast.success(form.backend.kind === 'channels' && modelPatternChanged ? tr('群组已更新并重新匹配通道') : tr('群组已更新'));
      } else {
        await api.addRoute(payload);
        toast.success(tr('群组已创建'));
      }
      setShowManual(false);
      resetRouteForm();
      await load();
    } catch (e: any) {
      toast.error(e.message || (editingRouteId ? tr('更新群组失败') : tr('创建群组失败')));
    } finally {
      setSaving(false);
    }
  };

  const handleEditRoute = (route: RouteSummaryRow) => {
    loadCandidates();
    setEditingRouteId(route.id);
    setForm({
      match: {
        kind: 'model',
        requestedModelPattern: getRouteRequestedModelPattern(route),
        displayName: getRouteDisplayName(route),
      },
      backend: isRouteBackendReferences(route.backend)
        ? { kind: 'routes', routeIds: getRouteBackendRouteIds(route.backend) }
        : { kind: 'channels' },
      presentation: {
        displayName: getRouteDisplayName(route) || '',
        displayIcon: normalizeRouteDisplayIconValue(getRouteDisplayIcon(route)),
      },
      routingStrategy: normalizeRouteRoutingStrategyValue(route.routingStrategy),
      enabled: route.enabled,
      modelMapping: route.modelMapping || '',
      advancedOpen: !isRouteBackendReferences(route.backend),
      macro: buildRouteGraphNodeFromRoute(route).macro || null,
    });
    setShowManual(true);
  };

  const handleCancelEditRoute = () => {
    resetRouteForm();
    setShowManual(false);
  };

  const handleExportRouteGraph = () => {
    const snapshot = buildRouteGraphSnapshot(routeSummaries);
    downloadJsonFile(`metapi-route-graph-${new Date().toISOString().slice(0, 10)}.json`, snapshot);
  };

  const handleImportRouteGraphSnapshot = async (snapshot: RouteGraphSnapshot) => {
    const nodes = snapshot.nodes.filter((node) => node.ownership === 'manual');
    if (nodes.length === 0) {
      toast.error('导入内容没有 manual 节点');
      return;
    }
    const confirmFn = typeof globalThis.confirm === 'function' ? globalThis.confirm : null;
    const confirmed = !confirmFn || confirmFn(`将导入 ${nodes.length} 个 manual 路由节点。已有 id 的节点会更新，其余会创建。是否继续？`);
    if (!confirmed) return;

    setSaving(true);
    try {
      for (const node of nodes) {
        const payload = routeGraphNodeToRoutePayload(node as RouteGraphNodeDraft);
        if (typeof node.id === 'number' && routeSummaries.some((route) => route.id === node.id)) {
          await api.updateRoute(node.id, payload);
        } else {
          await api.addRoute(payload);
        }
      }
      toast.success(`已导入 ${nodes.length} 个路由节点`);
      await load();
    } catch (error: any) {
      toast.error(error?.message || '导入路由图失败');
    } finally {
      setSaving(false);
    }
  };

  const handleImportRouteGraphFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const validation = validateRouteGraphSnapshot(parsed);
      if (!validation.ok) {
        toast.error(validation.message);
        return;
      }
      await handleImportRouteGraphSnapshot(validation.snapshot);
    } catch (error: any) {
      toast.error(error?.message || '导入 JSON 失败');
    }
  };

  const handleDeleteRoute = async (routeId: number) => {
    try {
      await api.deleteRoute(routeId);
      toast.success('路由已删除');
      await load();
    } catch (e: any) {
      toast.error(e.message || '删除路由失败');
    }
  };

  const handleToggleRouteEnabled = async (route: RouteSummaryRow) => {
    const newEnabled = !route.enabled;
    setRouteSummaries((prev) =>
      prev.map((item) => (item.id === route.id ? { ...item, enabled: newEnabled } : item)),
    );
    try {
      await api.updateRoute(route.id, { enabled: newEnabled });
      toast.success(newEnabled ? '路由已启用' : '路由已禁用');
    } catch (e: any) {
      setRouteSummaries((prev) =>
        prev.map((item) => (item.id === route.id ? { ...item, enabled: route.enabled } : item)),
      );
      toast.error(e.message || '切换路由状态失败');
    }
  };

  const handleRoutingStrategyChange = async (route: RouteSummaryRow, routingStrategy: RouteRoutingStrategy) => {
    const currentStrategy = normalizeRouteRoutingStrategyValue(route.routingStrategy);
    if (routingStrategy === currentStrategy) return;

    setUpdatingRoutingStrategyByRoute((prev) => ({ ...prev, [route.id]: true }));
    setRouteSummaries((prev) => prev.map((item) => (
      item.id === route.id
        ? { ...item, routingStrategy }
        : item
    )));
    try {
      await api.updateRoute(route.id, { routingStrategy });
      toast.success(getRouteRoutingStrategySuccessMessage(routingStrategy));
    } catch (e: any) {
      setRouteSummaries((prev) => prev.map((item) => (
        item.id === route.id
          ? { ...item, routingStrategy: currentStrategy }
          : item
      )));
      toast.error(e.message || '更新路由策略失败');
      return;
    } finally {
      setUpdatingRoutingStrategyByRoute((prev) => ({ ...prev, [route.id]: false }));
    }

    try {
      await load();
    } catch (e: any) {
      toast.error(e?.message || '路由策略已保存，但刷新列表失败');
    }
  };

  // Stable derived value: only changes when graph match/backend selection changes (not on enabled toggle).
  const routeGraphKey = visibleRouteRows
    .map((route) => `${route.id}:${getRouteRequestedModelPattern(route)}:${route.backend.kind}:${getRouteBackendRouteIds(route.backend).join('.')}`)
    .join(',');

  const routeBrandById = useMemo(() => {
    const next = new Map<number, BrandInfo | null>();
    for (const route of visibleRouteRows) {
      next.set(route.id, resolveRouteBrand(route));
    }
    return next;
  }, [visibleRouteRows]);

  const listVisibleRoutes = useMemo(
    () => buildVisibleRouteList(visibleRouteRows, isExactModelPattern, matchesModelPattern),
    [visibleRouteRows],
  );

  const brandList = useMemo(() => {
    const grouped = new Map<string, { count: number; brand: BrandInfo }>();
    let otherCount = 0;

    for (const route of listVisibleRoutes) {
      const brand = routeBrandById.get(route.id) || null;
      if (!brand) {
        otherCount++;
        continue;
      }

      const existing = grouped.get(brand.name);
      if (existing) {
        existing.count++;
      } else {
        grouped.set(brand.name, { count: 1, brand });
      }
    }

    return {
      list: [...grouped.entries()].sort((a, b) => {
        if (a[1].count === b[1].count) return a[0].localeCompare(b[0]);
        return b[1].count - a[1].count;
      }) as [string, { count: number; brand: BrandInfo }][],
      otherCount,
    };
  }, [listVisibleRoutes, routeBrandById]);

  const siteList = useMemo(() => {
    const grouped = new Map<string, { count: number; siteId: number }>();

    for (const route of listVisibleRoutes) {
      const seenSites = new Set<string>();
      for (const siteName of route.siteNames || []) {
        if (!siteName || seenSites.has(siteName)) continue;
        seenSites.add(siteName);

        const existing = grouped.get(siteName);
        if (existing) {
          existing.count++;
        } else {
          grouped.set(siteName, { count: 1, siteId: 0 });
        }
      }
    }

    return [...grouped.entries()].sort((a, b) => {
      if (a[1].count === b[1].count) return a[0].localeCompare(b[0]);
      return b[1].count - a[1].count;
    }) as [string, { count: number; siteId: number }][];
  }, [listVisibleRoutes]);

  const routeEndpointTypesByRouteId = useMemo(() => {
    const index: Record<number, Set<string>> = {};
    const entries = Object.entries(endpointTypesByModel || {});
    for (const route of visibleRouteRows) {
      const pattern = getRouteRequestedModelPattern(route).trim();
      if (!pattern) {
        index[route.id] = new Set<string>();
        continue;
      }
      const endpointTypes = new Set<string>();
      for (const [modelName, rawTypes] of entries) {
        if (!matchesModelPattern(modelName, pattern)) continue;
        for (const rawType of Array.isArray(rawTypes) ? rawTypes : []) {
          const endpointType = String(rawType || '').trim();
          if (!endpointType) continue;
          endpointTypes.add(endpointType);
        }
      }
      // Fallback: infer from siteNames isn't possible without platform info,
      // but we'll keep endpoint types from model availability
      index[route.id] = endpointTypes;
    }
    return index;
  }, [visibleRouteRows, endpointTypesByModel]);

  const endpointTypeList = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const route of listVisibleRoutes) {
      const endpointTypes = routeEndpointTypesByRouteId[route.id] || new Set<string>();
      for (const endpointType of endpointTypes) {
        grouped.set(endpointType, (grouped.get(endpointType) || 0) + 1);
      }
    }
    return [...grouped.entries()].sort((a, b) => {
      if (a[1] === b[1]) return a[0].localeCompare(b[0], undefined, { sensitivity: 'base' });
      return b[1] - a[1];
    }) as [string, number][];
  }, [listVisibleRoutes, routeEndpointTypesByRouteId]);

  const sourceEndpointTypesByRouteId = useMemo(() => {
    if (!showManual) return {};
    const next: Record<number, string[]> = {};
    for (const route of exactSourceRouteOptions) {
      next[route.id] = Array.from(routeEndpointTypesByRouteId[route.id] || new Set<string>())
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }
    return next;
  }, [showManual, exactSourceRouteOptions, routeEndpointTypesByRouteId]);

  const routeBrandIconCandidates = useMemo(() => {
    if (!showManual) return [];
    const byIcon = new Map<string, BrandInfo>();

    for (const route of visibleRouteRows) {
      const brand = resolveRouteBrand(route);
      if (brand) byIcon.set(brand.icon, brand);
    }

    for (const modelName of Object.keys(modelCandidates || {})) {
      const brand = getBrand(modelName);
      if (brand) byIcon.set(brand.icon, brand);
    }

    return Array.from(byIcon.values())
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [showManual, visibleRouteRows, modelCandidates]);

  const routeIconSelectOptions = useMemo<RouteIconOption[]>(() => ([
    ...ROUTE_ICON_OPTIONS,
    ...routeBrandIconCandidates.map((brand) => ({
      value: toBrandIconValue(brand.icon),
      label: brand.name,
      description: `${brand.name} 品牌图标`,
      iconNode: <BrandGlyph brand={brand} size={14} fallbackText={brand.name} />,
    })),
  ]), [routeBrandIconCandidates]);

  const groupRouteList = useMemo<GroupRouteItem[]>(() => (
    listVisibleRoutes
      .filter((route) => !isRouteExactModel(route))
      .map((route) => ({
        id: route.id,
        title: resolveRouteTitle(route),
        icon: resolveRouteIcon(route),
        brand: routeBrandById.get(route.id) || null,
        modelPattern: getRouteRequestedModelPattern(route),
        channelCount: route.channelCount,
        sourceRouteCount: getRouteBackendRouteIds(route.backend).length,
      }))
      .sort((a, b) => {
        if (a.channelCount === b.channelCount) return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
        return b.channelCount - a.channelCount;
      })
  ), [listVisibleRoutes, routeBrandById]);

  const activeGroupRoute = useMemo(() => {
    if (typeof activeGroupFilter !== 'number') return null;
    return listVisibleRoutes.find((route) => route.id === activeGroupFilter) || null;
  }, [activeGroupFilter, listVisibleRoutes]);

  const sortedRoutes = useMemo(() => (
    [...listVisibleRoutes].sort((a, b) => {
      if (sortBy === 'channelCount') {
        const countCmp = a.channelCount - b.channelCount;
        if (countCmp !== 0) return sortDir === 'asc' ? countCmp : -countCmp;
      }

      const nameCmp = getRouteRequestedModelPattern(a).localeCompare(getRouteRequestedModelPattern(b), undefined, { sensitivity: 'base' });
      return sortDir === 'asc' ? nameCmp : -nameCmp;
    })
  ), [listVisibleRoutes, sortBy, sortDir]);

  // Shared base filter: all filters EXCEPT enabledFilter
  const baseFilteredRoutes = useMemo(() => {
    let list = sortedRoutes;

    if (activeGroupFilter === '__all__') {
      list = list.filter((route) => !isRouteExactModel(route));
    } else if (typeof activeGroupFilter === 'number') {
      list = list.filter((route) => route.id === activeGroupFilter);
    }

    if (activeBrand) {
      if (activeBrand === '__other__') {
        list = list.filter((route) => !(routeBrandById.get(route.id) || null));
      } else {
        list = list.filter((route) => (routeBrandById.get(route.id)?.name || '') === activeBrand);
      }
    }

    if (activeSite) {
      list = list.filter((route) => route.siteNames?.includes(activeSite));
    }

    if (activeEndpointType) {
      list = list.filter((route) =>
        (routeEndpointTypesByRouteId[route.id] || new Set<string>()).has(activeEndpointType),
      );
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((route) => {
        const modelPattern = getRouteRequestedModelPattern(route).toLowerCase();
        const displayName = (getRouteDisplayName(route) || '').toLowerCase();
        const title = resolveRouteTitle(route).toLowerCase();
        return modelPattern.includes(q) || displayName.includes(q) || title.includes(q);
      });
    }

    return list;
  }, [sortedRoutes, activeGroupFilter, activeBrand, activeSite, activeEndpointType, search, routeBrandById, routeEndpointTypesByRouteId]);

  const enabledCounts = useMemo(() => {
    let enabled = 0;
    let disabled = 0;
    for (const route of baseFilteredRoutes) {
      if (route.kind === 'zero_channel' || route.readOnly === true || route.isVirtual === true) continue;
      if (route.enabled) enabled++;
      else disabled++;
    }
    return { enabled, disabled };
  }, [baseFilteredRoutes]);

  const filteredRoutes = useMemo(() => {
    if (enabledFilter === 'all') return baseFilteredRoutes;
    return baseFilteredRoutes.filter((route) => {
      if (route.kind === 'zero_channel' || route.readOnly === true || route.isVirtual === true) return false;
      return enabledFilter === 'enabled' ? route.enabled : !route.enabled;
    });
  }, [baseFilteredRoutes, enabledFilter]);

  const selectableRouteIds = useMemo(() => {
    return new Set(
      filteredRoutes
        .filter((route) => route.kind !== 'zero_channel' && route.readOnly !== true && route.isVirtual !== true)
        .map((route) => route.id),
    );
  }, [filteredRoutes]);

  const toggleBatchSelectMode = () => {
    setBatchSelectMode((prev) => {
      if (prev) setSelectedRouteIds(new Set());
      return !prev;
    });
  };

  const toggleRouteSelection = (routeId: number) => {
    setSelectedRouteIds((prev) => {
      const next = new Set(prev);
      if (next.has(routeId)) next.delete(routeId);
      else next.add(routeId);
      return next;
    });
  };

  const selectAllRoutes = () => {
    setSelectedRouteIds(new Set(selectableRouteIds));
  };

  const deselectAllRoutes = () => {
    setSelectedRouteIds(new Set());
  };

  const handleBatchUpdateRoutes = async (action: 'enable' | 'disable') => {
    const ids = Array.from(selectedRouteIds).filter((id) => selectableRouteIds.has(id));
    if (ids.length === 0) {
      toast.info('请先选择要操作的路由');
      return;
    }
    const actionLabel = action === 'disable' ? '禁用' : '启用';
    const confirmed = window.confirm(`确认批量${actionLabel} ${ids.length} 条路由？`);
    if (!confirmed) return;

    setBatchUpdatingRoutes(true);
    try {
      await api.batchUpdateRoutes({ ids, action });
      toast.success(`已批量${actionLabel} ${ids.length} 条路由`);
      setSelectedRouteIds(new Set());
      setBatchSelectMode(false);
      await load();
    } catch (e: any) {
      toast.error(e.message || `批量${actionLabel}路由失败`);
    } finally {
      setBatchUpdatingRoutes(false);
    }
  };

  useEffect(() => {
    setVisibleRouteCount(getInitialVisibleCount(filteredRoutes.length, ROUTE_RENDER_CHUNK));
  }, [filteredRoutes.length]);

  const handleLoadMoreRoutes = useCallback(() => {
    setVisibleRouteCount((current) => getNextVisibleCount(current, filteredRoutes.length, ROUTE_RENDER_CHUNK));
  }, [filteredRoutes.length]);

  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  const shouldShowLoadMore = filteredRoutes.length > 0 && visibleRouteCount < filteredRoutes.length;

  useEffect(() => {
    const el = loadMoreSentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) handleLoadMoreRoutes(); },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleLoadMoreRoutes, shouldShowLoadMore]);

  const visibleRoutes = useMemo(
    () => filteredRoutes.slice(0, visibleRouteCount),
    [filteredRoutes, visibleRouteCount],
  );

  // Lazy per-route candidate index — only computes for routes actually accessed
  const candidateIndexCacheRef = useRef<{ key: string; cache: Map<number, RouteCandidateView> }>({ key: '', cache: new Map() });
  const candidateIndexCacheKey = `${routeGraphKey}|${Object.keys(modelCandidates).length}|${candidatesVersionRef.current}`;
  if (candidateIndexCacheRef.current.key !== candidateIndexCacheKey) {
    candidateIndexCacheRef.current = { key: candidateIndexCacheKey, cache: new Map() };
  }

  const getRouteCandidateView = (routeId: number): RouteCandidateView => {
    const cache = candidateIndexCacheRef.current.cache;
    const cached = cache.get(routeId);
    if (cached) return cached;
    const route = visibleRouteRows.find((r) => r.id === routeId);
    if (!route) return EMPTY_ROUTE_CANDIDATE_VIEW;
    const index = buildRouteModelCandidatesIndex([route], modelCandidates, matchesModelPattern);
    const view = index[routeId] || EMPTY_ROUTE_CANDIDATE_VIEW;
    cache.set(routeId, view);
    return view;
  };

  // Lazy per-route missing token index
  const missingTokenCacheRef = useRef<{ key: string; cache: Map<number, RouteMissingTokenHint[]> }>({ key: '', cache: new Map() });
  const missingTokenCacheKey = `${routeGraphKey}|${Object.keys(missingTokenModelsByName).length}|${candidatesVersionRef.current}`;
  if (missingTokenCacheRef.current.key !== missingTokenCacheKey) {
    missingTokenCacheRef.current = { key: missingTokenCacheKey, cache: new Map() };
  }

  const getRouteMissingTokenHints = (routeId: number): RouteMissingTokenHint[] => {
    const cache = missingTokenCacheRef.current.cache;
    const cached = cache.get(routeId);
    if (cached) return cached;
    const route = visibleRouteRows.find((r) => r.id === routeId);
    if (!route) return [];
    const index = buildRouteMissingTokenIndex([route], missingTokenModelsByName, matchesModelPattern);
    const hints = index[routeId] || [];
    cache.set(routeId, hints);
    return hints;
  };

  const missingTokenSiteItemsCacheRef = useRef<{ key: string; cache: Map<number, MissingTokenRouteSiteActionItem[]> }>({
    key: '',
    cache: new Map(),
  });
  if (missingTokenSiteItemsCacheRef.current.key !== missingTokenCacheKey) {
    missingTokenSiteItemsCacheRef.current = { key: missingTokenCacheKey, cache: new Map() };
  }

  // Lazy per-route missing token group index
  const missingTokenGroupCacheRef = useRef<{ key: string; cache: Map<number, RouteMissingTokenHint[]> }>({ key: '', cache: new Map() });
  const missingTokenGroupCacheKey = `${routeGraphKey}|${Object.keys(missingTokenGroupModelsByName).length}|${candidatesVersionRef.current}`;
  if (missingTokenGroupCacheRef.current.key !== missingTokenGroupCacheKey) {
    missingTokenGroupCacheRef.current = { key: missingTokenGroupCacheKey, cache: new Map() };
  }

  const getRouteMissingTokenGroupHints = (routeId: number): RouteMissingTokenHint[] => {
    const cache = missingTokenGroupCacheRef.current.cache;
    const cached = cache.get(routeId);
    if (cached) return cached;
    const route = visibleRouteRows.find((r) => r.id === routeId);
    if (!route) return [];
    const index = buildRouteMissingTokenIndex([route], missingTokenGroupModelsByName, matchesModelPattern);
    const hints = index[routeId] || [];
    cache.set(routeId, hints);
    return hints;
  };

  const missingTokenGroupItemsCacheRef = useRef<{ key: string; cache: Map<number, MissingTokenGroupRouteSiteActionItem[]> }>({
    key: '',
    cache: new Map(),
  });
  if (missingTokenGroupItemsCacheRef.current.key !== missingTokenGroupCacheKey) {
    missingTokenGroupItemsCacheRef.current = { key: missingTokenGroupCacheKey, cache: new Map() };
  }

  const routeById = useMemo(
    () => new Map(visibleRouteRows.map((route) => [route.id, route])),
    [visibleRouteRows],
  );

  const editingRouteNodeJson = useMemo(() => {
    if (!editingRouteId) return null;
    const route = routeSummaries.find((item) => item.id === editingRouteId) || null;
    return route ? buildRouteGraphNodeFromRoute(route) : null;
  }, [editingRouteId, routeSummaries]);

  const handleCreateTokenForMissingAccount = (accountId: number, modelName: string) => {
    if (!Number.isFinite(accountId) || accountId <= 0) return;
    const params = new URLSearchParams();
    params.set('create', '1');
    params.set('accountId', String(accountId));
    params.set('model', modelName);
    params.set('from', 'routes');
    navigate(`/tokens?${params.toString()}`);
  };

  const handleDeleteChannel = async (channelId: number, routeId: number) => {
    const dismissedKey = 'metapi:channel-delete-warning-dismissed';
    const dismissed = localStorage.getItem(dismissedKey) === 'true';
    if (!dismissed) {
      const { confirmed, dontAskAgain } = await confirmDeleteChannel(channelId, routeId);
      if (!confirmed) return;
      if (dontAskAgain) localStorage.setItem(dismissedKey, 'true');
    }
    try {
      await api.deleteChannel(channelId);
      toast.success('通道已移除');
      await loadChannels(routeId, true);
      setRouteSummaries((prev) =>
        prev.map((r) => r.id === routeId ? { ...r, channelCount: Math.max(0, r.channelCount - 1) } : r),
      );
    } catch (e: any) {
      toast.error(e.message || '移除通道失败');
    }
  };

  const handleToggleChannelEnabled = async (channelId: number, routeId: number, enabled: boolean) => {
    if (updatingChannel[channelId]) return;
    setUpdatingChannel((prev) => ({ ...prev, [channelId]: true }));
    try {
      await api.updateChannel(channelId, { enabled });
      toast.success(enabled ? '通道已启用' : '通道已禁用');
      await loadChannels(routeId, true);
    } catch (e: any) {
      toast.error(e.message || '更新通道状态失败');
    } finally {
      setUpdatingChannel((prev) => ({ ...prev, [channelId]: false }));
    }
  };

  const handleChannelTokenSave = async (routeId: number, channelId: number, accountId: number) => {
    const tokenId = channelTokenDraft[channelId];
    const tokenOptions = getRouteCandidateView(routeId).tokenOptionsByAccountId[accountId] || [];

    if (tokenId && tokenOptions.length > 0 && !tokenOptions.some((token) => token.id === tokenId)) {
      toast.error('该令牌不支持当前模型');
      return;
    }

    setUpdatingChannel((prev) => ({ ...prev, [channelId]: true }));
    try {
      await api.updateChannel(channelId, { tokenId: tokenId || null });
      toast.success('通道令牌已更新');
      await loadChannels(routeId, true);
    } catch (e: any) {
      toast.error(e.message || '更新令牌失败');
    } finally {
      setUpdatingChannel((prev) => ({ ...prev, [channelId]: false }));
    }
  };

  const handleChannelDragEnd = async (routeId: number, event: DragEndEvent) => {
    if (savingPriorityByRoute[routeId]) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const route = routeSummaries.find((item) => item.id === routeId);
    if (!route) return;

    const channels = channelsByRouteId[routeId] || [];
    const activeChannel = channels.find((channel) => channel.id === Number(active.id));
    if (!activeChannel) return;

    const overIsNewLayer = isPriorityRailNewLayerId(over.id);
    const targetChannel = overIsNewLayer
      ? null
      : channels.find((channel) => channel.id === Number(over.id));

    if (!overIsNewLayer && !targetChannel) return;
    if (!overIsNewLayer && (targetChannel?.priority ?? 0) === (activeChannel.priority ?? 0)) return;

    const reordered = applyPriorityRailDrop(channels, Number(active.id), over.id);
    const changedChannels = reordered.filter((channel) => {
      const previous = channels.find((item) => item.id === channel.id);
      return (previous?.priority ?? 0) !== channel.priority;
    });

    if (changedChannels.length === 0) return;

    if (isExplicitGroupRoute(route)) {
      const changedSourceRouteIds = Array.from(new Set(
        changedChannels
          .map((channel) => channel.routeId)
          .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0),
      ));
      if (changedSourceRouteIds.length > 0) {
        const affectedGroups = routeSummaries.filter((candidate) => (
          candidate.id !== route.id
          && isExplicitGroupRoute(candidate)
          && getRouteBackendRouteIds(candidate.backend).some((sourceRouteId: number) => changedSourceRouteIds.includes(sourceRouteId))
        ));
        if (affectedGroups.length > 0) {
          const affectedNames = affectedGroups.map((candidate) => resolveRouteTitle(candidate));
          const confirmFn = typeof globalThis.confirm === 'function' ? globalThis.confirm : null;
          const confirmed = !confirmFn
            || confirmFn(`当前群组的优先级桶会直接回写来源通道，并同步影响：${affectedNames.join('、')}。是否继续？`);
          if (!confirmed) return;
        }
      }
    }

    const previousChannels = channels.map((channel) => ({ ...channel }));

    setChannels(routeId, reordered);
    setSavingPriorityByRoute((prev) => ({ ...prev, [routeId]: true }));

    try {
      await api.batchUpdateChannels(
        reordered.map((channel) => ({
          id: channel.id,
          priority: channel.priority,
        })),
      );

      if (route && isRouteExactModel(route)) {
        try {
          const res = await api.getRouteDecision(getRouteRequestedModelPattern(route));
          setDecisionByRoute((prev) => ({
            ...prev,
            [routeId]: (res?.decision || null) as RouteDecision | null,
          }));
        } catch {
          // ignore route decision refresh failures after reorder
        }
      }
    } catch (e: any) {
      setChannels(routeId, previousChannels);
      toast.error(e.message || '保存通道优先级失败，已回滚');
    } finally {
      setSavingPriorityByRoute((prev) => ({ ...prev, [routeId]: false }));
    }
  };

  const handleSiteBlockModel = async (channelId: number, routeId: number) => {
    const channels = channelsByRouteId[routeId] || [];
    const channel = channels.find((c) => c.id === channelId);
    if (!channel?.site?.id) {
      toast.error('找不到通道对应的站点信息');
      return;
    }
    const route = routeSummaries.find((r) => r.id === routeId);
    const routePattern = route ? getRouteRequestedModelPattern(route) : '';
    const modelName = channel.sourceModel || (route && isExactModelPattern(routePattern) ? routePattern : '') || '';
    if (!modelName) {
      toast.error('该通道没有精确模型名，无法使用站点屏蔽（通配符路由请在站点编辑中手动禁用）');
      return;
    }
    const siteName = channel.site.name || '未知站点';
    const confirmed = await confirmSiteBlock({ channelId, routeId, modelName, siteName });
    if (!confirmed) return;

    try {
      const siteId = channel.site.id;
      const existing = await api.getSiteDisabledModels(siteId);
      const currentModels: string[] = existing?.models || [];
      if (currentModels.includes(modelName)) {
        toast.info(`模型「${modelName}」已在站点「${siteName}」的禁用列表中`);
        return;
      }
      await api.updateSiteDisabledModels(siteId, [...currentModels, modelName]);
      toast.success(`已将「${modelName}」加入站点「${siteName}」的禁用列表，正在重建路由...`);
      await api.rebuildRoutes(false);
      invalidateChannels();
      await load();
    } catch (e: any) {
      toast.error(e.message || '站点屏蔽模型失败');
    }
  };

  const handleClearRouteCooldown = async (routeId: number) => {
    if (clearingCooldownByRoute[routeId]) return;
    setClearingCooldownByRoute((prev) => ({ ...prev, [routeId]: true }));
    try {
      await api.clearRouteCooldown(routeId);
      toast.success('路由冷却已清除');

      try {
        await loadChannels(routeId, true);
        const route = routeSummaries.find((item) => item.id === routeId);
        if (route) {
          if (isRouteExactModel(route)) {
            const res = await api.getRouteDecision(getRouteRequestedModelPattern(route));
            setDecisionByRoute((prev) => ({
              ...prev,
              [routeId]: (res?.decision || null) as RouteDecision | null,
            }));
          } else {
            const res = await api.getRouteWideDecisionsBatch([routeId]);
            setDecisionByRoute((prev) => ({
              ...prev,
              [routeId]: (res?.decisions?.[String(routeId)] || null) as RouteDecision | null,
            }));
          }
        }
      } catch {
        toast.error('已清除，但刷新失败');
      }
    } catch (e: any) {
      toast.error(e.message || '清除路由冷却失败');
    } finally {
      setClearingCooldownByRoute((prev) => ({ ...prev, [routeId]: false }));
    }
  };

  const toggleExpand = async (routeId: number) => {
    const isCurrentlyExpanded = expandedRouteIds.includes(routeId);
    if (isCurrentlyExpanded) {
      if (!isMobile) {
        const reduceMotion = prefersReducedMotion();
        if (reduceMotion) {
          setClosingDesktopDetailRouteIds((prev) => prev.filter((id) => id !== routeId));
        } else {
          setClosingDesktopDetailRouteIds((prev) => (prev.includes(routeId) ? prev : [...prev, routeId]));
          const existingTimer = desktopDetailCloseTimersRef.current[routeId];
          if (existingTimer) {
            globalThis.clearTimeout(existingTimer);
          }
          desktopDetailCloseTimersRef.current[routeId] = globalThis.setTimeout(() => {
            setClosingDesktopDetailRouteIds((prev) => prev.filter((id) => id !== routeId));
            delete desktopDetailCloseTimersRef.current[routeId];
          }, DESKTOP_DETAIL_COLLAPSE_MS);
        }
      }
      setExpandedRouteIds((prev) => prev.filter((id) => id !== routeId));
    } else {
      const existingTimer = desktopDetailCloseTimersRef.current[routeId];
      if (existingTimer) {
        globalThis.clearTimeout(existingTimer);
        delete desktopDetailCloseTimersRef.current[routeId];
      }
      setClosingDesktopDetailRouteIds((prev) => prev.filter((id) => id !== routeId));
      loadCandidates();
      setExpandedRouteIds((prev) => [...prev, routeId]);
      // Load channels on demand
      const route = routeById.get(routeId) || null;
      const isReadOnlyRoute = route?.kind === 'zero_channel' || route?.readOnly === true || route?.isVirtual === true;
      if (!channelsByRouteId[routeId] && !isReadOnlyRoute) {
        try {
          await loadChannels(routeId);
        } catch {
          toast.error('加载通道失败');
        }
      }
    }
  };

  useEffect(() => () => {
    Object.values(desktopDetailCloseTimersRef.current).forEach((timerId) => {
      globalThis.clearTimeout(timerId);
    });
    desktopDetailCloseTimersRef.current = {};
  }, []);

  const getMissingTokenSiteItems = (routeId: number): MissingTokenRouteSiteActionItem[] => {
    const cached = missingTokenSiteItemsCacheRef.current.cache.get(routeId);
    if (cached) return cached;
    const missingTokenHints = getRouteMissingTokenHints(routeId);
    if (missingTokenHints.length === 0) return EMPTY_MISSING_ITEMS;
    const siteMap = new Map<string, MissingTokenRouteSiteActionItem>();
    for (const hint of missingTokenHints) {
      for (const account of hint.accounts) {
        if (!Number.isFinite(account.accountId) || account.accountId <= 0) continue;
        const siteName = (account.siteName || '').trim() || `site-${account.siteId || 'unknown'}`;
        const key = `${account.siteId || 0}::${siteName.toLowerCase()}`;
        const accountLabel = account.username || `account-${account.accountId}`;
        const existing = siteMap.get(key);
        if (!existing) {
          siteMap.set(key, { key, siteName, accountId: account.accountId, accountLabel });
          continue;
        }
        if (account.accountId < existing.accountId) {
          existing.accountId = account.accountId;
          existing.accountLabel = accountLabel;
        }
      }
    }
    const items = Array.from(siteMap.values()).sort((a, b) => (
      a.siteName.localeCompare(b.siteName, undefined, { sensitivity: 'base' })
    ));
    missingTokenSiteItemsCacheRef.current.cache.set(routeId, items);
    return items;
  };

  const getMissingTokenGroupItems = (routeId: number): MissingTokenGroupRouteSiteActionItem[] => {
    const cached = missingTokenGroupItemsCacheRef.current.cache.get(routeId);
    if (cached) return cached;
    const missingGroupHints = getRouteMissingTokenGroupHints(routeId);
    if (missingGroupHints.length === 0) return EMPTY_MISSING_GROUP_ITEMS;
    const siteMap = new Map<string, MissingTokenGroupRouteSiteActionItem>();
    for (const hint of missingGroupHints) {
      for (const account of hint.accounts) {
        if (!Number.isFinite(account.accountId) || account.accountId <= 0) continue;
        const siteName = (account.siteName || '').trim() || `site-${account.siteId || 'unknown'}`;
        const key = `${account.siteId || 0}::${siteName.toLowerCase()}`;
        const accountLabel = account.username || `account-${account.accountId}`;
        const missingGroups = Array.isArray(account.missingGroups) ? account.missingGroups : [];
        const requiredGroups = Array.isArray(account.requiredGroups) ? account.requiredGroups : [];
        const availableGroups = Array.isArray(account.availableGroups) ? account.availableGroups : [];
        const existing = siteMap.get(key);
        if (!existing) {
          siteMap.set(key, {
            key,
            siteName,
            accountId: account.accountId,
            accountLabel,
            missingGroups: [...missingGroups],
            requiredGroups: [...requiredGroups],
            availableGroups: [...availableGroups],
            ...(account.groupCoverageUncertain === true ? { groupCoverageUncertain: true } : {}),
          });
          continue;
        }
        if (account.accountId < existing.accountId) {
          existing.accountId = account.accountId;
          existing.accountLabel = accountLabel;
        }
        existing.missingGroups = Array.from(new Set([...existing.missingGroups, ...missingGroups]))
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        existing.requiredGroups = Array.from(new Set([...existing.requiredGroups, ...requiredGroups]))
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        existing.availableGroups = Array.from(new Set([...existing.availableGroups, ...availableGroups]))
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        if (account.groupCoverageUncertain === true) {
          existing.groupCoverageUncertain = true;
        }
      }
    }
    const items = Array.from(siteMap.values()).sort((a, b) => (
      a.siteName.localeCompare(b.siteName, undefined, { sensitivity: 'base' })
    ));
    missingTokenGroupItemsCacheRef.current.cache.set(routeId, items);
    return items;
  };

  // Stable callbacks for RouteCard memo (use refs to avoid dependency on closure variables)
  const toggleExpandRef = useRef(toggleExpand);
  toggleExpandRef.current = toggleExpand;
  const stableToggleExpand = useCallback((routeId: number) => toggleExpandRef.current(routeId), []);
  const handleEditRouteRef = useRef(handleEditRoute);
  handleEditRouteRef.current = handleEditRoute;
  const stableEditRoute = useCallback((route: RouteSummaryRow) => handleEditRouteRef.current(route), []);
  const handleDeleteRouteRef = useRef(handleDeleteRoute);
  handleDeleteRouteRef.current = handleDeleteRoute;
  const stableDeleteRoute = useCallback((routeId: number) => { handleDeleteRouteRef.current(routeId); }, []);
  const handleToggleEnabledRef = useRef(handleToggleRouteEnabled);
  handleToggleEnabledRef.current = handleToggleRouteEnabled;
  const stableToggleEnabled = useCallback((route: RouteSummaryRow) => { handleToggleEnabledRef.current(route); }, []);
  const handleRoutingStrategyChangeRef = useRef(handleRoutingStrategyChange);
  handleRoutingStrategyChangeRef.current = handleRoutingStrategyChange;
  const stableRoutingStrategyChange = useCallback(
    (route: RouteSummaryRow, strategy: RouteRoutingStrategy) => handleRoutingStrategyChangeRef.current(route, strategy),
    [],
  );
  const stableTokenDraftChange = useCallback(
    (channelId: number, tokenId: number) => setChannelTokenDraft((prev) => ({ ...prev, [channelId]: tokenId })),
    [],
  );
  const stableAddChannel = useCallback((routeId: number) => {
    loadCandidates();
    setAddChannelModalRouteId(routeId);
  }, []);
  const stableToggleSourceGroup = useCallback(
    (groupKey: string) => setExpandedSourceGroupMap((prev) => ({ ...prev, [groupKey]: !prev[groupKey] })),
    [],
  );
  const handleChannelTokenSaveRef = useRef(handleChannelTokenSave);
  handleChannelTokenSaveRef.current = handleChannelTokenSave;
  const stableChannelTokenSave = useCallback(
    (routeId: number, channelId: number, accountId: number) => handleChannelTokenSaveRef.current(routeId, channelId, accountId),
    [],
  );
  const handleDeleteChannelRef = useRef(handleDeleteChannel);
  handleDeleteChannelRef.current = handleDeleteChannel;
  const stableDeleteChannel = useCallback(
    (channelId: number, routeId: number) => handleDeleteChannelRef.current(channelId, routeId),
    [],
  );
  const handleToggleChannelEnabledRef = useRef(handleToggleChannelEnabled);
  handleToggleChannelEnabledRef.current = handleToggleChannelEnabled;
  const stableToggleChannelEnabled = useCallback(
    (channelId: number, routeId: number, enabled: boolean) => handleToggleChannelEnabledRef.current(channelId, routeId, enabled),
    [],
  );
  const handleChannelDragEndRef = useRef(handleChannelDragEnd);
  handleChannelDragEndRef.current = handleChannelDragEnd;
  const stableChannelDragEnd = useCallback(
    (routeId: number, event: DragEndEvent) => handleChannelDragEndRef.current(routeId, event),
    [],
  );
  const handleCreateTokenRef = useRef(handleCreateTokenForMissingAccount);
  handleCreateTokenRef.current = handleCreateTokenForMissingAccount;
  const stableCreateTokenForMissing = useCallback(
    (accountId: number, modelName: string) => handleCreateTokenRef.current(accountId, modelName),
    [],
  );
  const handleSiteBlockModelRef = useRef(handleSiteBlockModel);
  handleSiteBlockModelRef.current = handleSiteBlockModel;
  const stableSiteBlockModel = useCallback(
    (channelId: number, routeId: number) => handleSiteBlockModelRef.current(channelId, routeId),
    [],
  );
  const handleClearRouteCooldownRef = useRef(handleClearRouteCooldown);
  handleClearRouteCooldownRef.current = handleClearRouteCooldown;
  const stableClearRouteCooldown = useCallback(
    (routeId: number) => handleClearRouteCooldownRef.current(routeId),
    [],
  );

  const addChannelModalRoute = addChannelModalRouteId
    ? routeSummaries.find((r) => r.id === addChannelModalRouteId) || null
    : null;

  const handleAddChannelSuccess = async () => {
    if (!addChannelModalRouteId) return;
    // Reload channels for this route
    await loadChannels(addChannelModalRouteId, true);
    // Refresh summary to update channel count
    await load();
  };

  return (
    <div className="shadcn-default-scope animate-fade-in min-h-[400px]">
      <Tabs.Tabs value={routeEditorMode} onValueChange={(value) => setRouteEditorMode(value as typeof routeEditorMode)}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <Tabs.TabsList>
            <Tabs.TabsTrigger value="list">列表 Wizard</Tabs.TabsTrigger>
            <Tabs.TabsTrigger value="graph">图编辑</Tabs.TabsTrigger>
            <Tabs.TabsTrigger value="json">高级 JSON</Tabs.TabsTrigger>
          </Tabs.TabsList>
          <ButtonGroup>
            <Button type="button" variant="outline" size="sm" onClick={handleRefreshRouteDecisions} disabled={loadingDecision}>
              {loadingDecision ? tr('刷新中...') : tr('刷新选中概率')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleRebuild} disabled={rebuilding}>
              {rebuilding ? tr('重建中...') : tr('自动重建')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => openRouteWizard('references')}>
              {tr('新建群组')}
            </Button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button type="button" variant="outline" size="sm">{tr('更多')}</Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Item onSelect={handleExportRouteGraph}>{tr('导出 JSON')}</DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => routeGraphImportInputRef.current?.click()}>{tr('导入 JSON')}</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </ButtonGroup>
        </div>
        <Tabs.TabsContent value="graph">
          <RouteGraphWorkbench mode="graph" />
        </Tabs.TabsContent>
        <Tabs.TabsContent value="json">
          <RouteGraphWorkbench mode="json" />
        </Tabs.TabsContent>
        <Tabs.TabsContent value="list">
          <section>
            <Card>
              <CardHeader>
                <CardTitle>Route Wizard</CardTitle>
                <CardDescription>{exactSourceRouteOptions.length} exact routes · {routeSummaries.filter((route) => isExplicitGroupRoute(route)).length} route references · {routeSummaries.filter((route) => route.backend.kind === 'channels').length} direct channel routes</CardDescription>
              </CardHeader>
              <CardContent>
                <ButtonGroup>
                  <Button type="button" variant="outline" onClick={() => openRouteWizard('references')}>新建重定向群组</Button>
                  <Button type="button" variant="outline" onClick={() => openRouteWizard('direct')}>新建规则路由</Button>
                  <Button type="button" variant="outline" onClick={() => routeGraphImportInputRef.current?.click()}>导入路由节点</Button>
                </ButtonGroup>
              </CardContent>
            </Card>
          </section>

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr('搜索模型路由...')}
              className="min-w-[220px] max-w-[360px] flex-1"
            />
            <Select
              value={sortBy}
              onValueChange={(nextValue) => {
                const nextSortBy = nextValue as RouteSortBy;
                setSortBy(nextSortBy);
                setSortDir(nextSortBy === 'modelPattern' ? 'asc' : 'desc');
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder={tr('排序字段')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="modelPattern">{tr('模型名称')}</SelectItem>
                <SelectItem value="channelCount">{tr('通道数量')}</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" onClick={() => setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))}>
              {sortDir === 'asc' ? tr('升序 ↑') : tr('降序 ↓')}
            </Button>
            <Input
              ref={routeGraphImportInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                event.target.value = '';
                void handleImportRouteGraphFile(file);
              }}
            />
          </div>
          <ButtonGroup>
            <Button type="button" variant="outline" onClick={handleRefreshRouteDecisions} disabled={loadingDecision}>
              {loadingDecision ? tr('刷新中...') : tr('刷新选中概率')}
            </Button>
            <Button type="button" variant="outline" onClick={handleRebuild} disabled={rebuilding}>
              {rebuilding ? tr('重建中...') : tr('自动重建')}
            </Button>
            <Button type="button" variant={batchSelectMode ? 'default' : 'outline'} onClick={toggleBatchSelectMode}>
              {batchSelectMode ? tr('退出批量') : tr('批量操作')}
            </Button>
            <Button type="button" variant="outline" aria-pressed={showZeroChannelRoutes} onClick={() => {
              if (!showZeroChannelRoutes) loadCandidates();
              setShowZeroChannelRoutes((prev) => !prev);
            }}>
              {showZeroChannelRoutes ? tr('隐藏 0 通道路由') : tr('显示 0 通道路由')}
            </Button>
          </ButtonGroup>

          <Badge variant="secondary">
            {tr('共')} {filteredRoutes.length} {tr('条路由')}
          </Badge>

      {/* Collapsible filter panel */}
      <ResponsiveFilterPanel
        isMobile={isMobile}
        mobileOpen={showFilters}
        onMobileClose={() => setShowFilters(false)}
        mobileTitle={tr('筛选路由')}
        mobileTriggerWrapperClassName=""
        mobileTrigger={(
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              loadCandidates();
              setShowFilters(true);
            }}
          >
            {tr('筛选')}
          </Button>
        )}
        mobileContent={(
          <RouteFilterBar
            totalRouteCount={baseFilteredRoutes.length}
            activeBrand={activeBrand}
            setActiveBrand={setActiveBrand}
            activeSite={activeSite}
            setActiveSite={setActiveSite}
            activeEndpointType={activeEndpointType}
            setActiveEndpointType={setActiveEndpointType}
            activeGroupFilter={activeGroupFilter}
            setActiveGroupFilter={setActiveGroupFilter}
            enabledFilter={enabledFilter}
            setEnabledFilter={setEnabledFilter}
            enabledCounts={enabledCounts}
            brandList={brandList}
            siteList={siteList}
            endpointTypeList={endpointTypeList}
            groupRouteList={groupRouteList}
            collapsed={false}
            onToggle={() => setShowFilters(false)}
          />
        )}
        desktopContent={(
          <RouteFilterBar
            totalRouteCount={baseFilteredRoutes.length}
            activeBrand={activeBrand}
            setActiveBrand={setActiveBrand}
            activeSite={activeSite}
            setActiveSite={setActiveSite}
            activeEndpointType={activeEndpointType}
            setActiveEndpointType={setActiveEndpointType}
            activeGroupFilter={activeGroupFilter}
            setActiveGroupFilter={setActiveGroupFilter}
            enabledFilter={enabledFilter}
            setEnabledFilter={setEnabledFilter}
            enabledCounts={enabledCounts}
            brandList={brandList}
            siteList={siteList}
            endpointTypeList={endpointTypeList}
            groupRouteList={groupRouteList}
            collapsed={filterCollapsed}
            onToggle={() => {
              if (filterCollapsed) loadCandidates();
              setFilterCollapsed((prev) => !prev);
            }}
          />
        )}
      />

      {/* Manual route panel */}
      <ManualRoutePanel
        show={showManual}
        editingRouteId={editingRouteId}
        form={form}
        setForm={setForm}
        saving={saving}
        canSave={canSaveRoute}
        routeIconSelectOptions={routeIconSelectOptions}
        previewModelSamples={previewModelSamples}
        exactSourceRouteOptions={exactSourceRouteOptions}
        sourceEndpointTypesByRouteId={sourceEndpointTypesByRouteId}
        currentRouteNodeJson={editingRouteNodeJson}
        onSave={handleAddRoute}
        onCancel={handleCancelEditRoute}
      />

      {/* Route card grid */}
      {/* Batch selection floating bar */}
      {batchSelectMode && (
        <div className="route-batch-bar">
          <span className="text-sm font-medium">
            {tr('已选择')} <b>{selectedRouteIds.size}</b> / {selectableRouteIds.size} {tr('条路由')}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={selectAllRoutes}>{tr('全选')}</Button>
          <Button type="button" variant="outline" size="sm" onClick={deselectAllRoutes}>{tr('取消全选')}</Button>
          <div className="ml-auto flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={selectedRouteIds.size === 0 || batchUpdatingRoutes}
              onClick={() => handleBatchUpdateRoutes('disable')}
            >
              {batchUpdatingRoutes ? <><LoaderCircle className="size-4 animate-spin" /> {tr('处理中...')}</> : tr('批量禁用')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={selectedRouteIds.size === 0 || batchUpdatingRoutes}
              onClick={() => handleBatchUpdateRoutes('enable')}
            >
              {batchUpdatingRoutes ? <><LoaderCircle className="size-4 animate-spin" /> {tr('处理中...')}</> : tr('批量启用')}
            </Button>
          </div>
        </div>
      )}

      <Card className={isMobile ? 'mobile--list' : 'route--grid'}>
        {visibleRoutes.map((route) => {
          const isExpanded = expandedRouteIds.includes(route.id);
          const isDesktopDetailClosing = closingDesktopDetailRouteIds.includes(route.id);
          const isReadOnlyRoute = route.kind === 'zero_channel' || route.readOnly === true || route.isVirtual === true;
          const exactRoute = isRouteExactModel(route);
          const explicitGroupRoute = isExplicitGroupRoute(route);
          const channelManagementDisabled = explicitGroupRoute;
          const routeTitle = resolveRouteTitle(route);

          const isSelectable = selectableRouteIds.has(route.id);
          const isSelected = selectedRouteIds.has(route.id);

          if (isMobile) {
            return (
              <div key={route.id} className="grid gap-2">
                <MobileCard
                  title={routeTitle}
                  headerActions={(
                    <div className="flex items-center gap-2">
                      {batchSelectMode && isSelectable && (
                        <label className="inline-flex cursor-pointer items-center gap-1 text-xs">
                          <Checkbox
                            data-testid={`route-select-${route.id}`}
                            aria-label={`选择路由 ${routeTitle}`}
                            checked={isSelected}
                            onCheckedChange={() => toggleRouteSelection(route.id)}
                          />
                          <span>{tr('选择')}</span>
                        </label>
                      )}
                      <Badge variant={isReadOnlyRoute || !route.enabled ? 'secondary' : 'default'}>
                        {isReadOnlyRoute ? tr('未生成') : (route.enabled ? tr('启用') : tr('禁用'))}
                      </Badge>
                    </div>
                  )}
                  footerActions={(
                    <ButtonGroup>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleExpand(route.id)}
                      >
                        {isExpanded ? tr('收起') : tr('详情')}
                      </Button>
                      {!isReadOnlyRoute && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditRoute(route)}
                        >
                          {tr('编辑')}
                        </Button>
                      )}
                      {!isReadOnlyRoute && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleRouteEnabled(route)}
                        >
                          {route.enabled ? tr('禁用') : tr('启用')}
                        </Button>
                      )}
                      {!isReadOnlyRoute && !channelManagementDisabled && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => stableAddChannel(route.id)}
                        >
                          {tr('添加通道')}
                        </Button>
                      )}
                    </ButtonGroup>
                  )}
                >
                  <MobileField label="模型" value={getRouteRequestedModelPattern(route) || resolveRouteTitle(route)} stacked />
                  <MobileField label="通道" value={route.channelCount} />
                  <MobileField label="策略" value={isReadOnlyRoute ? tr('未生成') : getRouteRoutingStrategyLabel(route.routingStrategy)} />
                  <MobileField label="状态" value={isReadOnlyRoute ? tr('未生成') : (route.enabled ? tr('启用') : tr('禁用'))} />
                  {explicitGroupRoute && (
                    <MobileField label="模式" value={tr('群组聚合')} />
                  )}
                  {!exactRoute && !explicitGroupRoute && (
                    <MobileField label="模式" value={tr('通配符路由')} />
                  )}
                </MobileCard>
                {isExpanded && (
                  <RouteCard
                    route={route}
                    brand={routeBrandById.get(route.id) || null}
                    expanded
                    compact
                    onToggleExpand={stableToggleExpand}
                    onEdit={stableEditRoute}
                    onDelete={stableDeleteRoute}
                    onToggleEnabled={stableToggleEnabled}
                    onClearCooldown={stableClearRouteCooldown}
                    clearingCooldown={!!clearingCooldownByRoute[route.id]}
                    onRoutingStrategyChange={stableRoutingStrategyChange}
                    updatingRoutingStrategy={!!updatingRoutingStrategyByRoute[route.id]}
                    channels={channelsByRouteId[route.id]}
                    loadingChannels={!!loadingChannelsByRouteId[route.id]}
                    routeDecision={decisionByRoute[route.id] || null}
                    loadingDecision={loadingDecision}
                    candidateView={getRouteCandidateView(route.id)}
                    channelTokenDraft={channelTokenDraft}
                    updatingChannel={updatingChannel}
                    savingPriority={!!savingPriorityByRoute[route.id]}
                    onTokenDraftChange={stableTokenDraftChange}
                    onSaveToken={stableChannelTokenSave}
                    onDeleteChannel={stableDeleteChannel}
                    onToggleChannelEnabled={stableToggleChannelEnabled}
                    onChannelDragEnd={stableChannelDragEnd}
                    missingTokenSiteItems={getMissingTokenSiteItems(route.id)}
                    missingTokenGroupItems={getMissingTokenGroupItems(route.id)}
                    onCreateTokenForMissing={stableCreateTokenForMissing}
                    onAddChannel={stableAddChannel}
                    onSiteBlockModel={stableSiteBlockModel}
                    expandedSourceGroupMap={expandedSourceGroupMap}
                    onToggleSourceGroup={stableToggleSourceGroup}
                  />
                )}
              </div>
            );
          }

          const summaryCard = (
            <RouteCard
              route={route}
              brand={routeBrandById.get(route.id) || null}
              expanded={false}
              summaryExpanded={isExpanded || isDesktopDetailClosing}
              onToggleExpand={stableToggleExpand}
              onEdit={stableEditRoute}
              onDelete={stableDeleteRoute}
              onToggleEnabled={stableToggleEnabled}
              onClearCooldown={stableClearRouteCooldown}
              clearingCooldown={!!clearingCooldownByRoute[route.id]}
              onRoutingStrategyChange={stableRoutingStrategyChange}
              updatingRoutingStrategy={!!updatingRoutingStrategyByRoute[route.id]}
              channels={channelsByRouteId[route.id]}
              loadingChannels={!!loadingChannelsByRouteId[route.id]}
              routeDecision={decisionByRoute[route.id] || null}
              loadingDecision={loadingDecision}
              candidateView={EMPTY_ROUTE_CANDIDATE_VIEW}
              channelTokenDraft={channelTokenDraft}
              updatingChannel={updatingChannel}
              savingPriority={!!savingPriorityByRoute[route.id]}
              onTokenDraftChange={stableTokenDraftChange}
              onSaveToken={stableChannelTokenSave}
              onDeleteChannel={stableDeleteChannel}
              onToggleChannelEnabled={stableToggleChannelEnabled}
              onChannelDragEnd={stableChannelDragEnd}
              missingTokenSiteItems={EMPTY_MISSING_ITEMS}
              missingTokenGroupItems={EMPTY_MISSING_GROUP_ITEMS}
              onCreateTokenForMissing={stableCreateTokenForMissing}
              onAddChannel={stableAddChannel}
              onSiteBlockModel={stableSiteBlockModel}
              expandedSourceGroupMap={expandedSourceGroupMap}
              onToggleSourceGroup={stableToggleSourceGroup}
            />
          );
          const detailPanel = (
            <DesktopDetailPanelPresence open={isExpanded}>
              {() => (
                <RouteCard
                  route={route}
                  brand={routeBrandById.get(route.id) || null}
                  expanded
                  compact
                  detailPanel
                  onToggleExpand={stableToggleExpand}
                  onEdit={stableEditRoute}
                  onDelete={stableDeleteRoute}
                  onToggleEnabled={stableToggleEnabled}
                  onClearCooldown={stableClearRouteCooldown}
                  clearingCooldown={!!clearingCooldownByRoute[route.id]}
                  onRoutingStrategyChange={stableRoutingStrategyChange}
                  updatingRoutingStrategy={!!updatingRoutingStrategyByRoute[route.id]}
                  channels={channelsByRouteId[route.id]}
                  loadingChannels={!!loadingChannelsByRouteId[route.id]}
                  routeDecision={decisionByRoute[route.id] || null}
                  loadingDecision={loadingDecision}
                  candidateView={getRouteCandidateView(route.id)}
                  channelTokenDraft={channelTokenDraft}
                  updatingChannel={updatingChannel}
                  savingPriority={!!savingPriorityByRoute[route.id]}
                  onTokenDraftChange={stableTokenDraftChange}
                  onSaveToken={stableChannelTokenSave}
                  onDeleteChannel={stableDeleteChannel}
                  onToggleChannelEnabled={stableToggleChannelEnabled}
                  onChannelDragEnd={stableChannelDragEnd}
                  missingTokenSiteItems={getMissingTokenSiteItems(route.id)}
                  missingTokenGroupItems={getMissingTokenGroupItems(route.id)}
                  onCreateTokenForMissing={stableCreateTokenForMissing}
                  onAddChannel={stableAddChannel}
                  onSiteBlockModel={stableSiteBlockModel}
                  expandedSourceGroupMap={expandedSourceGroupMap}
                  onToggleSourceGroup={stableToggleSourceGroup}
                />
              )}
            </DesktopDetailPanelPresence>
          );

          if (batchSelectMode && isSelectable) {
            return (
              <Fragment key={route.id}>
                <div className="flex items-stretch">
                  <div
                    onClick={() => toggleRouteSelection(route.id)}
                    className="flex min-h-full w-9 cursor-pointer items-center justify-center rounded-l-md border border-r-0"
                  >
                    <Checkbox
                      data-testid={`route-select-${route.id}`}
                      aria-label={`选择路由 ${routeTitle}`}
                      checked={isSelected}
                      onCheckedChange={() => toggleRouteSelection(route.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    {summaryCard}
                  </div>
                </div>
                {detailPanel}
              </Fragment>
            );
          }

          return (
            <Fragment key={route.id}>
              {summaryCard}
              {detailPanel}
            </Fragment>
          );
        })}
      </Card>

      {shouldShowLoadMore && (
          <div ref={loadMoreSentinelRef} className="py-3 text-center text-xs text-muted-foreground">
          {tr('当前已加载路由')} {visibleRouteCount} / {filteredRoutes.length}
        </div>
      )}

      {filteredRoutes.length === 0 && (
        <div className="rounded-lg border bg-card p-6 text-center">
          <div className="text-sm font-semibold">{routeSummaries.length === 0 ? '暂无路由' : '没有匹配的路由'}</div>
          <div className="mt-2 text-sm text-muted-foreground">
            {routeSummaries.length === 0
              ? '点击自动重建可按当前模型可用性生成路由。'
              : '请调整品牌筛选、搜索词或排序条件。'}
          </div>
        </div>
      )}

      {/* Add channel modal */}
      {addChannelModalRoute && (
        <AddChannelModal
          open={!!addChannelModalRouteId}
          onClose={() => setAddChannelModalRouteId(null)}
          routeId={addChannelModalRoute.id}
          routeTitle={resolveRouteTitle(addChannelModalRoute)}
          candidateView={getRouteCandidateView(addChannelModalRoute.id)}
          onSuccess={handleAddChannelSuccess}
          missingTokenHints={getRouteMissingTokenHints(addChannelModalRoute.id)}
          onCreateTokenForMissing={handleCreateTokenForMissingAccount}
          existingChannelAccountIds={new Set((channelsByRouteId[addChannelModalRoute.id] || []).map((c) => c.accountId))}
        />
      )}
          <Dialog.Root open={!!channelDeleteConfirmation} onOpenChange={(open) => { if (!open) closeDeleteChannelConfirmation(false); }}>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>确认移除通道</Dialog.Title>
                <Dialog.Description>
                  移除的通道会在定时模型刷新时被自动重建恢复。如果只是想临时停用通道，建议使用禁用开关。
                </Dialog.Description>
              </Dialog.Header>
              <label className="mt-4 flex items-center gap-2 text-sm">
                <Checkbox
                  checked={channelDeleteConfirmation?.dontAskAgain === true}
                  onCheckedChange={(checked) => {
                    setChannelDeleteConfirmation((current) => current ? { ...current, dontAskAgain: checked === true } : current);
                  }}
                />
                以后不再提示
              </label>
              <Dialog.Footer>
                <Button type="button" variant="outline" onClick={() => closeDeleteChannelConfirmation(false)}>取消</Button>
                <Button type="button" variant="destructive" onClick={() => closeDeleteChannelConfirmation(true)}>确认移除</Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Root>

          <Dialog.Root open={!!siteBlockConfirmation} onOpenChange={(open) => { if (!open) closeSiteBlockConfirmation(false); }}>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>确认站点屏蔽</Dialog.Title>
                <Dialog.Description>
                  将模型「{siteBlockConfirmation?.modelName || ''}」加入站点「{siteBlockConfirmation?.siteName || ''}」的禁用列表。执行后将自动触发路由重建，该站点下此模型的通道将不再生成。
                </Dialog.Description>
              </Dialog.Header>
              <Dialog.Footer>
                <Button type="button" variant="outline" onClick={() => closeSiteBlockConfirmation(false)}>取消</Button>
                <Button type="button" onClick={() => closeSiteBlockConfirmation(true)}>确认屏蔽</Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Root>
        </Tabs.TabsContent>
      </Tabs.Tabs>
    </div>
  );
}
