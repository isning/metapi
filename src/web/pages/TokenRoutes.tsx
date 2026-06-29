import { Fragment, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DragEndEvent } from '@dnd-kit/core';
import { api } from '../api.js';
import { BrandGlyph, getBrand, InlineBrandIcon, type BrandInfo } from '../components/BrandIcon.js';
import EmptyStateBlock from '../components/EmptyStateBlock.js';
import { useToast } from '../components/Toast.js';
import { MobileCard, MobileField } from '../components/MobileCard.js';
import ResponsiveFilterPanel from '../components/ResponsiveFilterPanel.js';
import SegmentedTabBar from '../components/SegmentedTabBar.js';
import { Badge } from '../components/ui/badge/index.js';
import { Button } from '../components/ui/button/index.js';
import { ButtonGroup } from '../components/ui/button-group/index.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card/index.js';
import { Checkbox } from '../components/ui/checkbox/index.js';
import * as Dialog from '../components/ui/dialog/index.js';
import { Input } from '../components/ui/input/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select/index.js';
import { Skeleton } from '../components/ui/skeleton/index.js';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '../components/ui/pagination/index.js';
import * as Tabs from '../components/ui/tabs/index.js';
import { useIsMobile } from '../components/useIsMobile.js';
import PageHeader from '../components/workspace/PageHeader.js';
import PageShell from '../components/workspace/PageShell.js';
import { CreateActionButton, PageActionBar, SecondaryActionButton } from '../components/workspace/ActionBar.js';
import { tr } from '../i18n.js';
import { ROUTE_DECISION_REFRESH_TASK_TYPE } from '../../shared/tokenRouteContract.js';
import {
  buildRouteModelCandidatesIndex,
  type RouteCandidateView,
  type RouteModelCandidatesByModelName,
} from './helpers/routeModelCandidatesIndex.js';
import { getRouteListPageNumbers, getRouteListPageWindow } from './helpers/progressiveRender.js';
import {
  buildRouteMissingTokenIndex,
  normalizeMissingTokenModels,
  type MissingTokenModelsByName,
  type RouteMissingTokenHint,
} from './helpers/routeMissingTokenHints.js';
import { buildVisibleRouteList } from './helpers/routeListVisibility.js';
import { buildZeroTargetPlaceholderRoutes } from './helpers/zeroTargetRoutes.js';
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
  RouteEndpointCatalogItem,
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
  buildCandidateSelectorMacro,
  updateCandidateSelectorMacroFromEditor,
  routeEndpointIdFromRouteId,
  routeGraphEditorFormToRoutePayload,
  type RouteGraphSnapshotMacro,
} from './token-routes/routeGraphSnapshot.js';
import type { RouteGraphMacro } from './token-routes/routeGraphTypes.js';
import {
  extractActiveRouteGraphSource,
  resolveRouteMacroBinding,
  type RouteMacroBindingGraph,
} from './token-routes/routeMacroBinding.js';
import { useRouteTargets } from './token-routes/useRouteTargets.js';
import RouteFilterBar, { type EnabledFilter } from './token-routes/RouteFilterBar.js';
import ManualRoutePanel from './token-routes/ManualRoutePanel.js';
import RouteCard from './token-routes/RouteCard.js';
import AddRouteTargetModal from './token-routes/AddRouteTargetModal.js';
import RouteGraphWorkbench, {
  defaultGraph,
  getMacroDisplayName,
  getMacroGeneratedPreviewRows,
  type MacroGeneratedPreviewRow,
  type RouteGraphFocusIntent,
  type RouteGraphSource,
} from './token-routes/RouteGraphWorkbench.js';
import {
  ArrowRight,
  Ban,
  CheckCheck,
  Code2,
  Download,
  Eraser,
  FileJson,
  GitBranch,
  HeartPulse,
  Info,
  ListChecks,
  LoaderCircle,
  Network,
  RefreshCw,
  Search,
  ArrowDownAZ,
  ArrowUpAZ,
  Boxes,
  Crosshair,
  GitCommitHorizontal,
  Upload,
  WandSparkles,
  Waypoints,
  Workflow,
} from 'lucide-react';

const EMPTY_ROUTE_CANDIDATE_VIEW: RouteCandidateView = {
  routeCandidates: [],
  accountOptions: [],
  tokenOptionsByAccountId: {},
};
const DEFAULT_ROUTE_PAGE_SIZE = 20;
const ROUTE_PAGE_SIZES = [20, 40, 80, 120] as const;
const EMPTY_MISSING_ITEMS: MissingTokenRouteSiteActionItem[] = [];
const EMPTY_MISSING_GROUP_ITEMS: MissingTokenGroupRouteSiteActionItem[] = [];
const ROUTE_ICON_OPTIONS: RouteIconOption[] = [
  { value: '', label: tr('pages.tokenRoutes.automaticbrands'), description: tr('pages.tokenRoutes.modelmatchrulesautomaticBrands'), iconText: '✦' },
];

type RouteEditorForm = {
  match: {
    kind: 'model';
    requestedModelPattern: string;
    displayName: string | null;
  };
  backend:
    | { kind: 'supply' }
    | { kind: 'routes'; routeIds: number[] };
  presentation: {
    displayName: string;
    displayIcon: string;
  };
  routingStrategy: RouteRoutingStrategy;
  enabled: boolean;
  modelMapping: string;
  advancedOpen: boolean;
  visibility: 'public' | 'internal';
  macro?: RouteGraphSnapshotMacro | null;
};
type TargetDeleteConfirmation = {
  targetId: number;
  routeId: number;
  dontAskAgain: boolean;
  resolve: (confirmed: boolean, dontAskAgain: boolean) => void;
};
type SiteBlockConfirmation = {
  targetId: number;
  routeId: number;
  modelName: string;
  siteName: string;
  resolve: (confirmed: boolean) => void;
};
type RouteGroupListTab = 'public' | 'internal' | 'manual';
type RouteWorkbenchTab = 'priority' | 'macro' | 'generated' | 'diagnostics' | 'json';
type RouteBatchAction = 'enable' | 'disable' | 'set_internal' | 'set_public';

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
  visibility: 'public',
};
const DESKTOP_DETAIL_ENTER_MS = 260;
const DESKTOP_DETAIL_COLLAPSE_MS = 200;

function getGeneratedRouteRowLabel(row: MacroGeneratedPreviewRow): string {
  if (row.routeId) return tr('pages.tokenRoutes.routeGraphWorkbench.routeNumber').replace('{id}', String(row.routeId));
  if (row.groupLabel) return row.groupLabel;
  return tr('pages.tokenRoutes.routeGraphWorkbench.candidateNumber').replace('{index}', String(row.index + 1));
}

function getGeneratedRoutePathNodes(row: MacroGeneratedPreviewRow): Array<{
  key: 'entry' | 'dispatcher' | 'endpoint';
  label: string;
  nodeId: string;
  detail: string;
}> {
  const nodes: Array<{ key: 'entry' | 'dispatcher' | 'endpoint'; label: string; nodeId: string; detail: string }> = [];
  if (row.entryId) {
    nodes.push({
      key: 'entry',
      label: tr('pages.tokenRoutes.routeGraphWorkbench.entry'),
      nodeId: row.entryId,
      detail: row.entryId,
    });
  }
  if (row.dispatcherId) {
    nodes.push({
      key: 'dispatcher',
      label: tr('pages.tokenRoutes.routeGraphWorkbench.dispatcher'),
      nodeId: row.dispatcherId,
      detail: row.dispatcherId,
    });
  }
  const endpointNodeId = row.nodeIds.find((nodeId) => nodeId !== row.entryId && nodeId !== row.dispatcherId) || row.endpointId;
  if (endpointNodeId) {
    nodes.push({
      key: 'endpoint',
      label: tr('pages.tokenRoutes.routeGraphWorkbench.endpointSet'),
      nodeId: endpointNodeId,
      detail: endpointNodeId === row.endpointId ? endpointNodeId : row.endpointId,
    });
  }
  return nodes;
}

function getGeneratedRoutePrimaryNodeId(row: MacroGeneratedPreviewRow | null | undefined): string {
  if (!row) return '';
  const pathNodes = getGeneratedRoutePathNodes(row);
  const endpointNode = pathNodes.find((node) => node.key === 'endpoint');
  return endpointNode?.nodeId || row.dispatcherId || row.entryId || row.endpointId || '';
}

function prefersReducedMotion(): boolean {
  return typeof globalThis.matchMedia === 'function'
    && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getRouteRoutingStrategySuccessMessage(value: RouteRoutingStrategy): string {
  if (value === 'round_robin') return tr('pages.tokenRoutes.switchedRoundRobinStrategy');
  if (value === 'stable_first') return tr('pages.tokenRoutes.switchedStableFirstStrategy');
  return tr('pages.tokenRoutes.switchedWeightedRandomStrategy');
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

function RouteGroupListLoadingSkeleton({ isMobile }: { isMobile: boolean }) {
  if (isMobile) {
    return (
      <div className="grid gap-2" aria-busy="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <MobileCard
            key={index}
            title={<Skeleton className="h-5 w-44 max-w-full" />}
            headerActions={<Skeleton className="h-5 w-16 rounded-full" />}
          >
            <div className="grid gap-3">
              <Skeleton className="h-4 w-56 max-w-full" />
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-20" />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Skeleton className="h-8 w-14" />
                <Skeleton className="h-8 w-14" />
                <Skeleton className="h-8 w-20" />
              </div>
            </div>
          </MobileCard>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-2" aria-busy="true">
      {Array.from({ length: 7 }).map((_, index) => (
        <div key={index} className="rounded-md border bg-card p-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="grid min-w-0 flex-1 gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Skeleton className="h-5 w-48 max-w-full" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
              <Skeleton className="h-3 w-64 max-w-full" />
              <div className="flex flex-wrap gap-1.5">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="size-8" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RouteGroupBrowserLoadingSkeleton() {
  return (
    <div aria-busy="true">
      <div className="flex flex-col gap-3 border-b bg-muted/30 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex max-w-full gap-0 overflow-hidden rounded-md">
          <Skeleton className="h-8 w-24 rounded-r-none" />
          <Skeleton className="h-8 w-24 rounded-none" />
          <Skeleton className="h-8 w-24 rounded-l-none" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-5 w-28 rounded-full" />
        </div>
      </div>
      <div className="flex flex-col gap-2 p-3 xl:flex-row xl:items-center">
        <Skeleton className="h-9 min-w-0 flex-1" />
        <div className="flex flex-wrap items-center gap-1.5">
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
    </div>
  );
}

function RouteGroupDetailLoadingSkeleton() {
  return (
    <section className="route-workbench grid min-h-[520px] min-w-0 max-w-full content-start gap-3" aria-busy="true">
      <div className="rounded-lg border bg-card p-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="grid min-w-0 flex-1 gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Skeleton className="h-5 w-48 max-w-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <div className="flex shrink-0 gap-1">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      </div>
      <div className="rounded-lg border bg-card p-3">
        <Skeleton className="mb-3 h-9 w-full max-w-sm" />
        <div className="grid gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </section>
  );
}

export default function TokenRoutes() {
  const navigate = useNavigate();
  const [routeEditorMode, setRouteEditorMode] = useState<'list' | 'graph' | 'json'>('list');
  const [routeSummaries, setRouteSummaries] = useState<RouteSummaryRow[]>([]);
  const [routesLoading, setRoutesLoading] = useState(true);
  const [routeEndpointCatalog, setRouteEndpointCatalog] = useState<RouteEndpointCatalogItem[]>([]);
  const [activeRouteGraphSource, setActiveRouteGraphSource] = useState<RouteMacroBindingGraph>(null);
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
  const [routeGroupListTab, setRouteGroupListTab] = useState<RouteGroupListTab>('public');
  const [filterCollapsed, setFilterCollapsed] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [showZeroTargetRoutes, setShowZeroTargetRoutes] = useState(false);
  const [sortBy, setSortBy] = useState<RouteSortBy>('targetCount');
  const [sortDir, setSortDir] = useState<RouteSortDir>('desc');

  const [showManual, setShowManual] = useState(false);
  const [form, setForm] = useState<RouteEditorForm>(EMPTY_ROUTE_FORM);
  const [editingRouteId, setEditingRouteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [batchUpdatingRoutes, setBatchUpdatingRoutes] = useState(false);
  const [batchSelectMode, setBatchSelectMode] = useState(false);
  const [selectedRouteIds, setSelectedRouteIds] = useState<Set<number>>(new Set());
  const [activeRouteId, setActiveRouteId] = useState<number | null>(null);
  const [workbenchTab, setWorkbenchTab] = useState<RouteWorkbenchTab>('priority');
  const [routeGraphFocusIntent, setRouteGraphFocusIntent] = useState<RouteGraphFocusIntent | null>(null);
  const routeGraphFocusIntentSeqRef = useRef(0);

  const [targetTokenDraft, setTargetTokenDraft] = useState<Record<number, number>>({});
  const [updatingTarget, setUpdatingTarget] = useState<Record<number, boolean>>({});
  const [savingPriorityByRoute, setSavingPriorityByRoute] = useState<Record<number, boolean>>({});
  const [updatingRoutingStrategyByRoute, setUpdatingRoutingStrategyByRoute] = useState<Record<number, boolean>>({});
  const [clearingCooldownByRoute, setClearingCooldownByRoute] = useState<Record<number, boolean>>({});

  const [decisionByRoute, setDecisionByRoute] = useState<Record<number, RouteDecision | null>>({});
  const [loadingDecision, setLoadingDecision] = useState(false);
  const [decisionAutoSkipped, setDecisionAutoSkipped] = useState(false);
  const [routePage, setRoutePage] = useState(1);
  const [routePageSize, setRoutePageSize] = useState(DEFAULT_ROUTE_PAGE_SIZE);
  const [expandedSourceGroupMap, setExpandedSourceGroupMap] = useState<Record<string, boolean>>({});
  const [expandedRouteIds, setExpandedRouteIds] = useState<number[]>([]);
  const [closingDesktopDetailRouteIds, setClosingDesktopDetailRouteIds] = useState<number[]>([]);
  const [addRouteTargetModalRouteId, setAddRouteTargetModalRouteId] = useState<number | null>(null);
  const [targetDeleteConfirmation, setTargetDeleteConfirmation] = useState<TargetDeleteConfirmation | null>(null);
  const [siteBlockConfirmation, setSiteBlockConfirmation] = useState<SiteBlockConfirmation | null>(null);
  const isMobile = useIsMobile();
  const desktopDetailCloseTimersRef = useRef<Record<number, ReturnType<typeof globalThis.setTimeout>>>({});

  const {
    targetsByRouteId,
    loadingTargetsByRouteId,
    loadTargets,
    invalidateTargets,
    setTargets,
  } = useRouteTargets();

  const toast = useToast();

  const confirmDeleteTarget = useCallback((targetId: number, routeId: number) => new Promise<{ confirmed: boolean; dontAskAgain: boolean }>((resolve) => {
    setTargetDeleteConfirmation({
      targetId,
      routeId,
      dontAskAgain: false,
      resolve: (confirmed, dontAskAgain) => resolve({ confirmed, dontAskAgain }),
    });
  }), []);

  const closeDeleteTargetConfirmation = useCallback((confirmed: boolean) => {
    setTargetDeleteConfirmation((current) => {
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
  const routeEndpointCatalogLoadedRef = useRef(false);
  const routeEndpointCatalogPromiseRef = useRef<Promise<void> | null>(null);
  const routeEndpointCatalogSeqRef = useRef(0);
  const activeRouteGraphSourceLoadedRef = useRef(false);
  const activeRouteGraphSourcePromiseRef = useRef<Promise<void> | null>(null);
  const activeRouteGraphSourceSeqRef = useRef(0);
  const decisionRefreshWatchSeqRef = useRef(0);
  const mountedRef = useRef(true);

  const loadRouteEndpointCatalog = useCallback((force?: boolean) => {
    if (routeEndpointCatalogLoadedRef.current && !force) return;
    if (routeEndpointCatalogPromiseRef.current && !force) return;
    const endpointFetcher = (api as { getRouteEndpoints?: (options?: { paged?: boolean; pageSize?: number; endpointKind?: 'all' | 'supply' | 'route_product' }) => Promise<unknown> }).getRouteEndpoints;
    if (typeof endpointFetcher !== 'function') return;
    const seq = ++routeEndpointCatalogSeqRef.current;
    routeEndpointCatalogLoadedRef.current = true;
    let promise!: Promise<void>;
    promise = (async () => {
      try {
        const endpointRows = await endpointFetcher({ paged: true, pageSize: 500, endpointKind: 'supply' });
        if (routeEndpointCatalogSeqRef.current !== seq) return;
        startTransition(() => {
          setRouteEndpointCatalog((endpointRows || []) as RouteEndpointCatalogItem[]);
        });
      } catch {
        if (routeEndpointCatalogSeqRef.current === seq) routeEndpointCatalogLoadedRef.current = false;
      } finally {
        if (routeEndpointCatalogPromiseRef.current === promise) {
          routeEndpointCatalogPromiseRef.current = null;
        }
      }
    })();
    routeEndpointCatalogPromiseRef.current = promise;
  }, []);

  const loadActiveRouteGraphSource = useCallback((force?: boolean) => {
    if (activeRouteGraphSourceLoadedRef.current && !force) return;
    if (activeRouteGraphSourcePromiseRef.current && !force) return;
    const graphFetcher = (api as { getRouteGraphActive?: (options?: { include?: 'source' | 'full' | 'compiled' | 'summary' }) => Promise<unknown> }).getRouteGraphActive;
    if (typeof graphFetcher !== 'function') return;
    const seq = ++activeRouteGraphSourceSeqRef.current;
    activeRouteGraphSourceLoadedRef.current = true;
    let promise!: Promise<void>;
    promise = (async () => {
      try {
        const activeGraph = await graphFetcher({ include: 'source' });
        if (activeRouteGraphSourceSeqRef.current !== seq) return;
        startTransition(() => {
          setActiveRouteGraphSource(extractActiveRouteGraphSource(activeGraph));
        });
      } catch {
        if (activeRouteGraphSourceSeqRef.current === seq) activeRouteGraphSourceLoadedRef.current = false;
      } finally {
        if (activeRouteGraphSourcePromiseRef.current === promise) {
          activeRouteGraphSourcePromiseRef.current = null;
        }
      }
    })();
    activeRouteGraphSourcePromiseRef.current = promise;
  }, []);

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
    setRoutesLoading((current) => current || routeSummaries.length === 0);
    try {
      const summaryRows = await api.getRoutesSummary({ paged: true, pageSize: 1000 });

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
      if (routeEndpointCatalogLoadedRef.current) {
        loadRouteEndpointCatalog(true);
      }
      if (activeRouteGraphSourceLoadedRef.current) {
        loadActiveRouteGraphSource(true);
      }
    } finally {
      setRoutesLoading(false);
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
            throw new Error(tr('pages.tokenRoutes.routeProbabilityTaskMissing'));
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
            toastRef.current.success(tr('pages.tokenRoutes.routesRefresh'));
          } else {
            toastRef.current.error(String(task.message || task.error || tr('pages.tokenRoutes.failedRefreshRoutingProbability')));
          }
          return;
        } catch (error: any) {
          if (!mountedRef.current || decisionRefreshWatchSeqRef.current !== watchSeq) return;
          setLoadingDecision(false);
          toastRef.current.error(error?.message || tr('pages.tokenRoutes.failedRefreshRoutingProbability'));
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
        toast.error(tr('pages.tokenRoutes.failedLoadRoutingConfiguration'));
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

  useEffect(() => {
    if (showManual) loadRouteEndpointCatalog();
  }, [loadRouteEndpointCatalog, showManual]);

  useEffect(() => {
    if (routeEditorMode !== 'list') return;
    if (!activeRouteId) return;
    if (workbenchTab !== 'macro' && workbenchTab !== 'generated') return;
    loadActiveRouteGraphSource();
  }, [activeRouteId, loadActiveRouteGraphSource, routeEditorMode, workbenchTab]);

  const handleRebuild = async () => {
    try {
      setRebuilding(true);
      const res = await api.rebuildRoutes(true);
      if (res?.queued) {
        toast.info(res.message || tr('pages.tokenRoutes.routeReconstructionHasStartedPleaseCheckLog'));
        invalidateTargets();
        await load();
        return;
      }
      const createdRoutes = res?.rebuild?.createdRoutes ?? 0;
      const createdTargets = res?.rebuild?.createdTargets ?? 0;
      toast.success(
        tr('pages.tokenRoutes.rebuildComplete')
          .replace('{routes}', String(createdRoutes))
          .replace('{targets}', String(createdTargets)),
      );
      invalidateTargets();
      await load();
    } catch (e: any) {
      toast.error(e.message || tr('pages.tokenRoutes.failedRebuildRoute'));
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
        throw new Error(tr('pages.tokenRoutes.missingRefreshTaskId'));
      }

      toast.info(response?.message || tr('pages.tokenRoutes.routeProbabilityRefreshStarted'));
      monitorRouteDecisionRefreshTask(taskId);
    } catch (error: any) {
      toast.error(error?.message || tr('pages.tokenRoutes.failedRefreshRoutingProbability'));
    }
  };

  const exactRouteCount = useMemo(
    () => buildVisibleRouteList(routeSummaries, isExactModelPattern, matchesModelPattern)
      .filter((route) => isRouteExactModel(route)).length,
    [routeSummaries],
  );

  const zeroTargetPlaceholderRoutes = useMemo(
    () => buildZeroTargetPlaceholderRoutes(routeSummaries, missingTokenModelsByName, missingTokenGroupModelsByName),
    [routeSummaries, missingTokenModelsByName, missingTokenGroupModelsByName],
  );

  const visibleRouteRows = useMemo(
    () => (showZeroTargetRoutes ? [...routeSummaries, ...zeroTargetPlaceholderRoutes] : routeSummaries),
    [routeSummaries, showZeroTargetRoutes, zeroTargetPlaceholderRoutes],
  );

  const canSaveRoute = useMemo(() => {
    if (saving) return false;
    if (form.backend.kind === 'routes') {
      return !!form.presentation.displayName.trim() && form.backend.routeIds.length > 0;
    }
    return !!form.match.requestedModelPattern.trim() && !getModelPatternError(form.match.requestedModelPattern);
  }, [form.backend, form.match.requestedModelPattern, form.presentation.displayName, saving]);

  const modelMatchPreviewEndpoints = useMemo<RouteEndpointCatalogItem[]>(() => {
    if (!showManual) return [];
    const endpointCatalogItems = routeEndpointCatalog
      .filter((endpoint) => (
        endpoint.endpointKind === 'supply'
        && endpoint.enabled !== false
        && endpoint.resolutionStatus !== 'unresolved'
      ))
      .sort((left, right) => {
        const leftLabel = left.label || left.modelPattern || left.endpointId;
        const rightLabel = right.label || right.modelPattern || right.endpointId;
        return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: 'base' });
      });
    if (endpointCatalogItems.length > 0) return endpointCatalogItems;

    return routeSummaries
      .filter((route) => isRouteExactModel(route))
      .map((route): RouteEndpointCatalogItem => ({
        endpointId: routeEndpointIdFromRouteId(route.id),
        nodeId: routeEndpointIdFromRouteId(route.id),
        routeId: route.id,
        label: resolveRouteTitle(route),
        endpointKind: 'supply',
        exposure: 'none',
        resolutionStatus: 'resolved',
        ownerKind: 'automatic_route',
        sourceKind: 'upstream_model',
        enabled: route.enabled,
        displayIcon: getRouteDisplayIcon(route),
        modelPattern: getRouteRequestedModelPattern(route),
        publicModelName: null,
        upstreamModels: [getRouteRequestedModelPattern(route)].filter(Boolean),
        siteNames: route.siteNames || [],
        targetCount: route.targetCount,
        sourceRouteIds: [route.id],
        tags: [],
        metadata: {},
      }))
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));
  }, [showManual, routeEndpointCatalog, routeSummaries]);

  const exactSourceRouteOptions = useMemo(
    () => routeSummaries.filter((route) => isRouteExactModel(route)),
    [routeSummaries],
  );

  const resetRouteForm = () => {
    setForm(EMPTY_ROUTE_FORM);
    setEditingRouteId(null);
  };

  const openRouteWizard = () => {
    loadCandidates();
    setEditingRouteId(null);
    setForm({
      ...EMPTY_ROUTE_FORM,
      backend: { kind: 'routes', routeIds: [] },
      advancedOpen: false,
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
          toast.error(tr('pages.tokenRoutes.modelJson'));
          return;
        }
      } catch {
        toast.error(tr('pages.tokenRoutes.modelJsonMistake'));
        return;
      }
    }
    if (form.backend.kind === 'routes') {
      if (!trimmedDisplayName) {
        toast.error(tr('pages.tokenRoutes.model'));
        return;
      }
      if (form.backend.routeIds.length === 0) {
        toast.error(tr('pages.tokenRoutes.selectModel'));
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
            visibility: form.visibility,
            enabled: form.enabled,
            routingStrategy: form.routingStrategy,
            routeIds: form.backend.routeIds,
          })
          : null,
      });
      if (editingRouteId) {
        const currentRoute = routeSummaries.find((route) => route.id === editingRouteId) || null;
        const modelPatternChanged = form.backend.kind === 'supply' && !!currentRoute && getRouteRequestedModelPattern(currentRoute) !== trimmedModelPattern;
        await api.updateRoute(editingRouteId, payload);
        toast.success(form.backend.kind === 'supply' && modelPatternChanged ? tr('pages.tokenRoutes.groupsMatchtargets') : tr('pages.tokenRoutes.groups'));
      } else {
        await api.addRoute(payload);
        toast.success(tr('pages.tokenRoutes.groupCreated'));
      }
      setShowManual(false);
      resetRouteForm();
      await load();
    } catch (e: any) {
      toast.error(e.message || (editingRouteId ? tr('pages.tokenRoutes.groupsfailed') : tr('pages.tokenRoutes.failedCreateGroup')));
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
        : { kind: 'supply' },
      presentation: {
        displayName: getRouteDisplayName(route) || '',
        displayIcon: normalizeRouteDisplayIconValue(getRouteDisplayIcon(route)),
      },
      routingStrategy: normalizeRouteRoutingStrategyValue(route.routingStrategy),
      visibility: route.visibility === 'internal' ? 'internal' : 'public',
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

  const handleDeleteRoute = async (routeId: number) => {
    try {
      await api.deleteRoute(routeId);
      toast.success(tr('pages.tokenRoutes.routeDeleted'));
      await load();
    } catch (e: any) {
      toast.error(e.message || tr('pages.tokenRoutes.failedDeleteRoute'));
    }
  };

  const handleToggleRouteEnabled = async (route: RouteSummaryRow) => {
    const newEnabled = !route.enabled;
    setRouteSummaries((prev) =>
      prev.map((item) => (item.id === route.id ? { ...item, enabled: newEnabled } : item)),
    );
    try {
      await api.updateRoute(route.id, { enabled: newEnabled });
      toast.success(newEnabled ? tr('pages.tokenRoutes.routesenabled') : tr('pages.tokenRoutes.routesdisabled'));
    } catch (e: any) {
      setRouteSummaries((prev) =>
        prev.map((item) => (item.id === route.id ? { ...item, enabled: route.enabled } : item)),
      );
      toast.error(e.message || tr('pages.tokenRoutes.routesstatusfailed'));
    }
  };

  const handleRouteVisibilityChange = async (route: RouteSummaryRow, visibility: 'public' | 'internal') => {
    if (route.visibility === visibility) return;
    const previousVisibility = route.visibility === 'internal' ? 'internal' : 'public';
    setRouteSummaries((prev) =>
      prev.map((item) => (item.id === route.id ? { ...item, visibility } : item)),
    );
    try {
      await api.updateRoute(route.id, { visibility });
      toast.success(
        visibility === 'internal'
          ? tr('pages.tokenRoutes.routeSetInternal')
          : tr('pages.tokenRoutes.routeSetPublic'),
      );
      if (!isExplicitGroupRoute(route)) {
        setRouteGroupListTab(visibility === 'internal' ? 'internal' : 'public');
      }
      await load();
    } catch (e: any) {
      setRouteSummaries((prev) =>
        prev.map((item) => (item.id === route.id ? { ...item, visibility: previousVisibility } : item)),
      );
      toast.error(e.message || tr('pages.tokenRoutes.routeVisibilityFailed'));
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
      toast.error(e.message || tr('pages.tokenRoutes.updateRoutingStrategyFailed'));
      return;
    } finally {
      setUpdatingRoutingStrategyByRoute((prev) => ({ ...prev, [route.id]: false }));
    }

    try {
      await load();
    } catch (e: any) {
      toast.error(e?.message || tr('pages.tokenRoutes.routingStrategySavedRefreshFailed'));
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
      description: tr('pages.tokenRoutes.brandIconDescription').replace('{brand}', brand.name),
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
        targetCount: route.targetCount,
        sourceRouteCount: getRouteBackendRouteIds(route.backend).length,
      }))
      .sort((a, b) => {
        if (a.targetCount === b.targetCount) return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
        return b.targetCount - a.targetCount;
      })
  ), [listVisibleRoutes, routeBrandById]);

  const activeGroupRoute = useMemo(() => {
    if (typeof activeGroupFilter !== 'number') return null;
    return listVisibleRoutes.find((route) => route.id === activeGroupFilter) || null;
  }, [activeGroupFilter, listVisibleRoutes]);

  const sortedRoutes = useMemo(() => (
    [...listVisibleRoutes].sort((a, b) => {
      if (sortBy === 'targetCount') {
        const countCmp = a.targetCount - b.targetCount;
        if (countCmp !== 0) return sortDir === 'asc' ? countCmp : -countCmp;
      }

      const nameCmp = getRouteRequestedModelPattern(a).localeCompare(getRouteRequestedModelPattern(b), undefined, { sensitivity: 'base' });
      return sortDir === 'asc' ? nameCmp : -nameCmp;
    })
  ), [listVisibleRoutes, sortBy, sortDir]);

  const routeGroupTabCounts = useMemo(() => {
    let publicCount = 0;
    let internal = 0;
    let manual = 0;
    for (const route of listVisibleRoutes) {
      if (isExplicitGroupRoute(route)) {
        manual++;
      } else if (route.visibility === 'internal') {
        internal++;
      } else {
        publicCount++;
      }
    }
    return { public: publicCount, internal, manual };
  }, [listVisibleRoutes]);

  // Shared base filter: all filters EXCEPT enabledFilter
  const baseFilteredRoutes = useMemo(() => {
    let list = sortedRoutes.filter((route) => {
      if (isExplicitGroupRoute(route)) return routeGroupListTab === 'manual';
      if (route.visibility === 'internal') return routeGroupListTab === 'internal';
      return routeGroupListTab === 'public';
    });

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
  }, [sortedRoutes, routeGroupListTab, activeGroupFilter, activeBrand, activeSite, activeEndpointType, search, routeBrandById, routeEndpointTypesByRouteId]);

  const enabledCounts = useMemo(() => {
    let enabled = 0;
    let disabled = 0;
    for (const route of baseFilteredRoutes) {
      if (route.kind === 'zero_target' || route.readOnly === true || route.isVirtual === true) continue;
      if (route.enabled) enabled++;
      else disabled++;
    }
    return { enabled, disabled };
  }, [baseFilteredRoutes]);

  const filteredRoutes = useMemo(() => {
    if (enabledFilter === 'all') return baseFilteredRoutes;
    return baseFilteredRoutes.filter((route) => {
      if (route.kind === 'zero_target' || route.readOnly === true || route.isVirtual === true) return false;
      return enabledFilter === 'enabled' ? route.enabled : !route.enabled;
    });
  }, [baseFilteredRoutes, enabledFilter]);

  const selectableRouteIds = useMemo(() => {
    return new Set(
      filteredRoutes
        .filter((route) => route.kind !== 'zero_target' && route.readOnly !== true && route.isVirtual !== true)
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

  const handleBatchUpdateRoutes = async (action: RouteBatchAction) => {
    const ids = Array.from(selectedRouteIds).filter((id) => selectableRouteIds.has(id));
    if (ids.length === 0) {
      toast.info(tr('pages.tokenRoutes.selectActionsRoutes'));
      return;
    }
    const actionLabel = action === 'disable'
      ? tr('pages.downstreamKeys.disabled')
      : action === 'enable'
        ? tr('pages.downstreamKeys.enabled')
        : action === 'set_internal'
          ? tr('pages.tokenRoutes.setInternal')
          : tr('pages.tokenRoutes.setPublic');
    const confirmed = window.confirm(
      tr('pages.tokenRoutes.batchRoutesConfirm')
        .replace('{action}', actionLabel)
        .replace('{count}', String(ids.length)),
    );
    if (!confirmed) return;

    setBatchUpdatingRoutes(true);
    try {
      await api.batchUpdateRoutes({ ids, action });
      toast.success(
        tr('pages.tokenRoutes.batchRoutesComplete')
          .replace('{action}', actionLabel)
          .replace('{count}', String(ids.length)),
      );
      setSelectedRouteIds(new Set());
      setBatchSelectMode(false);
      if (routeGroupListTab !== 'manual') {
        if (action === 'set_internal') setRouteGroupListTab('internal');
        if (action === 'set_public') setRouteGroupListTab('public');
      }
      await load();
    } catch (e: any) {
      toast.error(e.message || tr('pages.tokenRoutes.batchRoutesFailed').replace('{action}', actionLabel));
    } finally {
      setBatchUpdatingRoutes(false);
    }
  };

  useEffect(() => {
    setRoutePage(1);
  }, [routeGroupListTab, search, activeBrand, activeSite, activeEndpointType, activeGroupFilter, enabledFilter, sortBy, sortDir, showZeroTargetRoutes, routePageSize]);

  const routePageWindow = useMemo(() => getRouteListPageWindow({
    page: routePage,
    total: filteredRoutes.length,
    pageSize: routePageSize,
  }), [filteredRoutes.length, routePage, routePageSize]);

  useEffect(() => {
    setRoutePage((current) => routePageWindow.safePage === current ? current : routePageWindow.safePage);
  }, [routePageWindow.safePage]);

  const routePageNumbers = useMemo(
    () => getRouteListPageNumbers(routePageWindow.safePage, routePageWindow.totalPages),
    [routePageWindow.safePage, routePageWindow.totalPages],
  );

  const visibleRoutes = useMemo(
    () => filteredRoutes.slice(routePageWindow.startIndex, routePageWindow.endIndex),
    [filteredRoutes, routePageWindow.endIndex, routePageWindow.startIndex],
  );
  const routeListSingleColumn = isMobile || (!routesLoading && filteredRoutes.length === 0);

  const activeRoute = useMemo(() => (
    activeRouteId == null ? null : filteredRoutes.find((route) => route.id === activeRouteId) || null
  ), [activeRouteId, filteredRoutes]);

  useEffect(() => {
    if (isMobile) return;
    if (filteredRoutes.length === 0) {
      if (activeRouteId !== null) setActiveRouteId(null);
      return;
    }
    if (activeRouteId == null || !visibleRoutes.some((route) => route.id === activeRouteId)) {
      setActiveRouteId(visibleRoutes[0]?.id ?? filteredRoutes[0]!.id);
    }
  }, [activeRouteId, filteredRoutes, isMobile, visibleRoutes]);

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

  const handleDeleteTarget = async (targetId: number, routeId: number) => {
    const dismissedKey = 'metapi:target-delete-warning-dismissed';
    const dismissed = localStorage.getItem(dismissedKey) === 'true';
    if (!dismissed) {
      const { confirmed, dontAskAgain } = await confirmDeleteTarget(targetId, routeId);
      if (!confirmed) return;
      if (dontAskAgain) localStorage.setItem(dismissedKey, 'true');
    }
    try {
      await api.deleteRouteTarget(targetId);
      toast.success(tr('pages.tokenRoutes.targetRemoved'));
      await loadTargets(routeId, true);
      setRouteSummaries((prev) =>
        prev.map((r) => r.id === routeId ? { ...r, targetCount: Math.max(0, r.targetCount - 1) } : r),
      );
    } catch (e: any) {
      toast.error(e.message || tr('pages.tokenRoutes.failedRemoveTarget'));
    }
  };

  const handleToggleTargetEnabled = async (targetId: number, routeId: number, enabled: boolean) => {
    if (updatingTarget[targetId]) return;
    setUpdatingTarget((prev) => ({ ...prev, [targetId]: true }));
    try {
      await api.updateRouteTarget(targetId, { enabled });
      toast.success(enabled ? tr('pages.tokenRoutes.targetsenabled') : tr('pages.tokenRoutes.targetsdisabled'));
      await loadTargets(routeId, true);
    } catch (e: any) {
      toast.error(e.message || tr('pages.tokenRoutes.targetsstatusfailed'));
    } finally {
      setUpdatingTarget((prev) => ({ ...prev, [targetId]: false }));
    }
  };

  const handleTargetTokenSave = async (routeId: number, targetId: number, accountId: number) => {
    const tokenId = targetTokenDraft[targetId];
    const tokenOptions = getRouteCandidateView(routeId).tokenOptionsByAccountId[accountId] || [];

    if (tokenId && tokenOptions.length > 0 && !tokenOptions.some((token) => token.id === tokenId)) {
      toast.error(tr('pages.tokenRoutes.tokenNotSupportedCurrentModel'));
      return;
    }

    setUpdatingTarget((prev) => ({ ...prev, [targetId]: true }));
    try {
      await api.updateRouteTarget(targetId, { tokenId: tokenId || null });
      toast.success(tr('pages.tokenRoutes.targetTokenUpdated'));
      await loadTargets(routeId, true);
    } catch (e: any) {
      toast.error(e.message || tr('pages.tokenRoutes.updateTokenFailed'));
    } finally {
      setUpdatingTarget((prev) => ({ ...prev, [targetId]: false }));
    }
  };

  const handleTargetDragEnd = async (routeId: number, event: DragEndEvent) => {
    if (savingPriorityByRoute[routeId]) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const route = routeSummaries.find((item) => item.id === routeId);
    if (!route) return;

    const targets = targetsByRouteId[routeId] || [];
    const activeTarget = targets.find((target) => target.id === Number(active.id));
    if (!activeTarget) return;

    const overIsNewLayer = isPriorityRailNewLayerId(over.id);
    const overTarget = overIsNewLayer
      ? null
      : targets.find((target) => target.id === Number(over.id));

    if (!overIsNewLayer && !overTarget) return;
    if (!overIsNewLayer && (overTarget?.priority ?? 0) === (activeTarget.priority ?? 0)) return;

    const reordered = applyPriorityRailDrop(targets, Number(active.id), over.id);
    const changedTargets = reordered.filter((target) => {
      const previous = targets.find((item) => item.id === target.id);
      return (previous?.priority ?? 0) !== target.priority;
    });

    if (changedTargets.length === 0) return;

    if (isExplicitGroupRoute(route)) {
      const changedSourceRouteIds = Array.from(new Set(
        changedTargets
          .map((target) => target.routeId)
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
            || confirmFn(tr('pages.tokenRoutes.priorityBucketAffectsGroupsConfirm').replace('{groups}', affectedNames.join(tr('pages.tokenRoutes.listSeparator'))));
          if (!confirmed) return;
        }
      }
    }

    const previousTargets = targets.map((target) => ({ ...target }));

    setTargets(routeId, reordered);
    setSavingPriorityByRoute((prev) => ({ ...prev, [routeId]: true }));

    try {
      await api.batchUpdateRouteTargets(
        reordered.map((target) => ({
          id: target.id,
          priority: target.priority,
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
      setTargets(routeId, previousTargets);
      toast.error(e.message || tr('pages.tokenRoutes.failedSaveTargetPriorityRolledBack'));
    } finally {
      setSavingPriorityByRoute((prev) => ({ ...prev, [routeId]: false }));
    }
  };

  const handleSiteBlockModel = async (targetId: number, routeId: number) => {
    const targets = targetsByRouteId[routeId] || [];
    const target = targets.find((c) => c.id === targetId);
    if (!target?.site?.id) {
      toast.error(tr('pages.tokenRoutes.targetsSitesinfo'));
      return;
    }
    const route = routeSummaries.find((r) => r.id === routeId);
    const routePattern = route ? getRouteRequestedModelPattern(route) : '';
    const modelName = target.sourceModel || (route && isExactModelPattern(routePattern) ? routePattern : '') || '';
    if (!modelName) {
      toast.error(tr('pages.tokenRoutes.targetMissingExactModelCannotUseSiteBlocklist'));
      return;
    }
    const siteName = target.site.name || tr('pages.proxyLogs.unknownSite');
    const confirmed = await confirmSiteBlock({ targetId, routeId, modelName, siteName });
    if (!confirmed) return;

    try {
      const siteId = target.site.id;
      const existing = await api.getSiteDisabledModels(siteId);
      const currentModels: string[] = existing?.models || [];
      if (currentModels.includes(modelName)) {
        toast.info(
          tr('pages.tokenRoutes.modelAlreadyBlockedOnSite')
            .replace('{model}', modelName)
            .replace('{site}', siteName),
        );
        return;
      }
      await api.updateSiteDisabledModels(siteId, [...currentModels, modelName]);
      toast.success(
        tr('pages.tokenRoutes.modelBlockedOnSiteRebuilding')
          .replace('{model}', modelName)
          .replace('{site}', siteName),
      );
      await api.rebuildRoutes(false);
      invalidateTargets();
      await load();
    } catch (e: any) {
      toast.error(e.message || tr('pages.tokenRoutes.sitesModelfailed'));
    }
  };

  const handleClearRouteCooldown = async (routeId: number) => {
    if (clearingCooldownByRoute[routeId]) return;
    setClearingCooldownByRoute((prev) => ({ ...prev, [routeId]: true }));
    try {
      await api.clearRouteCooldown(routeId);
      toast.success(tr('pages.tokenRoutes.routescooldownClear'));

      try {
        await loadTargets(routeId, true);
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
        toast.error(tr('pages.tokenRoutes.clearRefreshfailed'));
      }
    } catch (e: any) {
      toast.error(e.message || tr('pages.tokenRoutes.clearroutescooldownfailed'));
    } finally {
      setClearingCooldownByRoute((prev) => ({ ...prev, [routeId]: false }));
    }
  };

  const toggleExpand = async (routeId: number) => {
    if (!isMobile) {
      setActiveRouteId((current) => (current === routeId ? current : routeId));
      loadCandidates();
      const route = routeById.get(routeId) || null;
      const isReadOnlyRoute = route?.kind === 'zero_target' || route?.readOnly === true || route?.isVirtual === true;
      if (!targetsByRouteId[routeId] && !isReadOnlyRoute) {
        try {
          await loadTargets(routeId);
        } catch {
          toast.error(tr('pages.tokenRoutes.targetsfailed'));
        }
      }
      return;
    }

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
      // Load targets on demand
      const route = routeById.get(routeId) || null;
      const isReadOnlyRoute = route?.kind === 'zero_target' || route?.readOnly === true || route?.isVirtual === true;
      if (!targetsByRouteId[routeId] && !isReadOnlyRoute) {
        try {
          await loadTargets(routeId);
        } catch {
          toast.error(tr('pages.tokenRoutes.targetsfailed'));
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

  useEffect(() => {
    if (isMobile || activeRouteId == null) return;
    const route = routeById.get(activeRouteId) || null;
    const isReadOnlyRoute = route?.kind === 'zero_target' || route?.readOnly === true || route?.isVirtual === true;
    loadCandidates();
    if (!route || isReadOnlyRoute || targetsByRouteId[activeRouteId] || loadingTargetsByRouteId[activeRouteId]) return;
    void loadTargets(activeRouteId).catch(() => {
      toast.error(tr('pages.tokenRoutes.targetsfailed'));
    });
  }, [activeRouteId, targetsByRouteId, isMobile, loadTargets, loadingTargetsByRouteId, routeById, toast]);

  const getMissingTokenSiteItems = (routeId: number): MissingTokenRouteSiteActionItem[] => {
    const cached = missingTokenSiteItemsCacheRef.current.cache.get(routeId);
    if (cached) return cached;
    const missingTokenHints = getRouteMissingTokenHints(routeId);
    if (missingTokenHints.length === 0) return EMPTY_MISSING_ITEMS;
    const siteMap = new Map<string, MissingTokenRouteSiteActionItem>();
    for (const hint of missingTokenHints) {
      for (const account of hint.accounts) {
        if (!Number.isFinite(account.accountId) || account.accountId <= 0) continue;
        const siteName = (account.siteName || '').trim() || (account.siteId ? `site-${account.siteId}` : tr('pages.proxyLogs.unknownSite'));
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
        const siteName = (account.siteName || '').trim() || (account.siteId ? `site-${account.siteId}` : tr('pages.proxyLogs.unknownSite'));
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
  const handleRouteVisibilityChangeRef = useRef(handleRouteVisibilityChange);
  handleRouteVisibilityChangeRef.current = handleRouteVisibilityChange;
  const stableRouteVisibilityChange = useCallback(
    (route: RouteSummaryRow, visibility: 'public' | 'internal') => handleRouteVisibilityChangeRef.current(route, visibility),
    [],
  );
  const handleRoutingStrategyChangeRef = useRef(handleRoutingStrategyChange);
  handleRoutingStrategyChangeRef.current = handleRoutingStrategyChange;
  const stableRoutingStrategyChange = useCallback(
    (route: RouteSummaryRow, strategy: RouteRoutingStrategy) => handleRoutingStrategyChangeRef.current(route, strategy),
    [],
  );
  const stableTokenDraftChange = useCallback(
    (targetId: number, tokenId: number) => setTargetTokenDraft((prev) => ({ ...prev, [targetId]: tokenId })),
    [],
  );
  const stableAddTarget = useCallback((routeId: number) => {
    loadCandidates();
    setAddRouteTargetModalRouteId(routeId);
  }, []);
  const stableToggleSourceGroup = useCallback(
    (groupKey: string) => setExpandedSourceGroupMap((prev) => ({ ...prev, [groupKey]: !prev[groupKey] })),
    [],
  );
  const handleTargetTokenSaveRef = useRef(handleTargetTokenSave);
  handleTargetTokenSaveRef.current = handleTargetTokenSave;
  const stableTargetTokenSave = useCallback(
    (routeId: number, targetId: number, accountId: number) => handleTargetTokenSaveRef.current(routeId, targetId, accountId),
    [],
  );
  const handleDeleteTargetRef = useRef(handleDeleteTarget);
  handleDeleteTargetRef.current = handleDeleteTarget;
  const stableDeleteTarget = useCallback(
    (targetId: number, routeId: number) => handleDeleteTargetRef.current(targetId, routeId),
    [],
  );
  const handleToggleTargetEnabledRef = useRef(handleToggleTargetEnabled);
  handleToggleTargetEnabledRef.current = handleToggleTargetEnabled;
  const stableToggleTargetEnabled = useCallback(
    (targetId: number, routeId: number, enabled: boolean) => handleToggleTargetEnabledRef.current(targetId, routeId, enabled),
    [],
  );
  const handleTargetDragEndRef = useRef(handleTargetDragEnd);
  handleTargetDragEndRef.current = handleTargetDragEnd;
  const stableTargetDragEnd = useCallback(
    (routeId: number, event: DragEndEvent) => handleTargetDragEndRef.current(routeId, event),
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
    (targetId: number, routeId: number) => handleSiteBlockModelRef.current(targetId, routeId),
    [],
  );
  const handleClearRouteCooldownRef = useRef(handleClearRouteCooldown);
  handleClearRouteCooldownRef.current = handleClearRouteCooldown;
  const stableClearRouteCooldown = useCallback(
    (routeId: number) => handleClearRouteCooldownRef.current(routeId),
    [],
  );

  const addRouteTargetModalRoute = addRouteTargetModalRouteId
    ? routeSummaries.find((r) => r.id === addRouteTargetModalRouteId) || null
    : null;

  const activeRouteNode = activeRoute ? buildRouteGraphNodeFromRoute(activeRoute) : null;
  const activeRouteMacro = resolveRouteMacroBinding(
    activeRoute,
    activeRouteGraphSource,
    activeRouteNode?.macro || null,
  );
  const activeRouteGraphSourceForPreview = useMemo<RouteGraphSource>(() => ({
    ...defaultGraph(),
    nodes: (activeRouteGraphSource?.nodes || []) as RouteGraphSource['nodes'],
    edges: (activeRouteGraphSource?.edges || []) as RouteGraphSource['edges'],
    macros: (activeRouteGraphSource?.macros || []) as RouteGraphSource['macros'],
  }), [activeRouteGraphSource]);
  const activeRouteGraphMacro = activeRouteMacro ? activeRouteMacro as RouteGraphMacro : null;
  const activeRouteGeneratedRows = useMemo<MacroGeneratedPreviewRow[]>(() => (
    activeRouteGraphMacro
      ? getMacroGeneratedPreviewRows(activeRouteGraphSourceForPreview, activeRouteGraphMacro)
      : []
  ), [activeRouteGraphMacro, activeRouteGraphSourceForPreview]);
  const activeRouteSourceRouteIds = activeRoute ? getRouteBackendRouteIds(activeRoute.backend) : [];
  const activeRouteGraphNodeId = activeRouteNode ? String(activeRouteNode.stableId || activeRouteNode.id || '') : '';
  const activeRouteJson = activeRouteNode ? JSON.stringify({
    ...activeRouteNode,
    ...(activeRouteMacro ? { macro: activeRouteMacro } : {}),
  }, null, 2) : '';

  const focusRouteGraphMacro = useCallback((macroId: string | null | undefined) => {
    const normalizedMacroId = String(macroId || '').trim();
    if (!normalizedMacroId) {
      setRouteEditorMode('graph');
      return;
    }
    setRouteGraphFocusIntent({
      id: ++routeGraphFocusIntentSeqRef.current,
      kind: 'macro',
      macroId: normalizedMacroId,
    });
    setRouteEditorMode('graph');
  }, []);

  const focusRouteGraphNode = useCallback((nodeId: string | null | undefined, macroId?: string | null) => {
    const normalizedNodeId = String(nodeId || '').trim();
    if (!normalizedNodeId) {
      focusRouteGraphMacro(macroId);
      return;
    }
    setRouteGraphFocusIntent({
      id: ++routeGraphFocusIntentSeqRef.current,
      kind: 'node',
      nodeId: normalizedNodeId,
      macroId: macroId || null,
    });
    setRouteEditorMode('graph');
  }, [focusRouteGraphMacro]);

  const handleAddTargetSuccess = async () => {
    if (!addRouteTargetModalRouteId) return;
    // Reload targets for this route
    await loadTargets(addRouteTargetModalRouteId, true);
    // Refresh summary to update target count
    await load();
  };

  return (
    <PageShell className="shadcn-default-scope min-h-[400px]">
      <PageHeader
        title={tr('app.routes')}
        description={tr('pages.tokenRoutes.routesSubtitle')}
        actions={(
          <PageActionBar>
            <SecondaryActionButton
              type="button"
              icon={RefreshCw}
              loading={loadingDecision}
              loadingLabel={tr('pages.downstreamKeys.refreshing')}
              onClick={handleRefreshRouteDecisions}
              disabled={loadingDecision}
            >
              {tr('pages.tokenRoutes.refreshSelectionProbability')}
            </SecondaryActionButton>
            <SecondaryActionButton
              type="button"
              icon={WandSparkles}
              loading={rebuilding}
              loadingLabel={tr('pages.tokenRoutes.rebuilding')}
              onClick={handleRebuild}
              disabled={rebuilding}
            >
              {tr('pages.tokenRoutes.autoRebuild')}
            </SecondaryActionButton>
          </PageActionBar>
        )}
      />
      <Tabs.Tabs
        value={routeEditorMode}
        onValueChange={(value) => setRouteEditorMode(value as typeof routeEditorMode)}
        className="grid min-w-0 max-w-full gap-3"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <SegmentedTabBar
            value={routeEditorMode}
            onValueChange={(value) => setRouteEditorMode(value as typeof routeEditorMode)}
            className="w-full sm:w-auto"
            items={[
              { value: 'list', label: tr('pages.tokenRoutes.wizard'), icon: <GitBranch className="size-3.5" /> },
              { value: 'graph', label: tr('pages.tokenRoutes.edit'), icon: <Workflow className="size-3.5" /> },
              { value: 'json', label: tr('pages.tokenRoutes.advancedJson'), icon: <Code2 className="size-3.5" /> },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-muted-foreground">
            {routesLoading ? (
              <>
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </>
            ) : (
              <>
                <Badge variant="secondary">{tr('pages.models.total')} {routeSummaries.length}</Badge>
                <Badge variant="success">{tr('pages.downstreamKeys.enabled')} {enabledCounts.enabled}</Badge>
                <Badge variant="secondary">{tr('pages.downstreamKeys.disabled')} {enabledCounts.disabled}</Badge>
              </>
            )}
          </div>
        </div>
        <Tabs.TabsContent value="graph" className="min-w-0 max-w-full overflow-hidden">
          {routeEditorMode === 'graph' && (
            <RouteGraphWorkbench
              mode="graph"
              focusIntent={routeGraphFocusIntent}
              onFocusIntentConsumed={(id) => {
                setRouteGraphFocusIntent((current) => current?.id === id ? null : current);
              }}
            />
          )}
        </Tabs.TabsContent>
        <Tabs.TabsContent value="json" className="min-w-0 max-w-full overflow-hidden">
          {routeEditorMode === 'json' && <RouteGraphWorkbench mode="json" />}
        </Tabs.TabsContent>
        <Tabs.TabsContent value="list" className="grid min-w-0 max-w-full gap-3">
          <section className="grid gap-3">
            <div className="rounded-md border bg-card p-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">{tr('pages.tokenRoutes.routeWizard.title')}</div>
                <div className="mt-1 max-w-3xl text-xs text-muted-foreground">
                  {routesLoading ? (
                    <Skeleton className="h-4 w-72 max-w-full" />
                  ) : (
                    tr('pages.tokenRoutes.routeWizard.description')
                      .replace('{exactRoutes}', String(exactSourceRouteOptions.length))
                      .replace('{routeReferences}', String(routeSummaries.filter((route) => isExplicitGroupRoute(route)).length))
                  )}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-md border bg-card">
              {routesLoading ? (
                <RouteGroupBrowserLoadingSkeleton />
              ) : (
                <>
              <div className="flex flex-col gap-3 border-b bg-muted/30 p-3 lg:flex-row lg:items-center lg:justify-between">
                <SegmentedTabBar<RouteGroupListTab>
                  value={routeGroupListTab}
                  onValueChange={setRouteGroupListTab}
                  className="w-full lg:w-auto"
                  items={[
                    { value: 'public', label: tr('pages.tokenRoutes.routeGroupTabs.external'), count: routeGroupTabCounts.public },
                    { value: 'internal', label: tr('pages.tokenRoutes.routeGroupTabs.internalGroup'), count: routeGroupTabCounts.internal },
                    { value: 'manual', label: tr('pages.tokenRoutes.routeGroupTabs.manual'), count: routeGroupTabCounts.manual },
                  ]}
                />
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">
                    {tr('pages.tokenRoutes.routeBrowser.totalRoutes').replace('{count}', String(filteredRoutes.length))}
                  </Badge>
                  <Badge variant="secondary">
                    {tr('pages.tokenRoutes.routeBrowser.baseRoutes').replace('{count}', String(baseFilteredRoutes.length))}
                  </Badge>
                </div>
              </div>

              <div className="flex flex-col gap-2 p-3 xl:flex-row xl:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={tr('pages.tokenRoutes.searchModelRoutes')}
                    className="pr-9 pl-8"
                  />
                  {search.trim() ? (
                    <Button
                      type="button"
                      variant="ghostMuted"
                      size="icon"
                      className="absolute right-0.5 top-1/2 -translate-y-1/2"
                      aria-label={tr('pages.tokenRoutes.routeBrowser.clearSearch')}
                      onClick={() => setSearch('')}
                    >
                      <Eraser className="size-4" />
                    </Button>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Select
                    value={sortBy}
                    onValueChange={(nextValue) => {
                      const nextSortBy = nextValue as RouteSortBy;
                      setSortBy(nextSortBy);
                      setSortDir(nextSortBy === 'modelPattern' ? 'asc' : 'desc');
                    }}
                  >
                    <SelectTrigger className="w-full sm:w-44">
                      <SelectValue placeholder={tr('pages.tokenRoutes.sortField')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="modelPattern">{tr('pages.tokenRoutes.modelName')}</SelectItem>
                      <SelectItem value="targetCount">{tr('pages.tokenRoutes.targetCount')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" onClick={() => setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))}>
                    {sortDir === 'asc' ? <ArrowDownAZ className="size-4" /> : <ArrowUpAZ className="size-4" />}
                    {sortDir === 'asc' ? tr('pages.tokenRoutes.ascending') : tr('pages.tokenRoutes.descending')}
                  </Button>
                  <Button type="button" variant={batchSelectMode ? 'default' : 'outline'} onClick={toggleBatchSelectMode}>
                    <ListChecks className="size-4" />
                    {batchSelectMode ? tr('pages.tokenRoutes.exitBatchMode') : tr('pages.tokenRoutes.actions')}
                  </Button>
                  <Button type="button" variant={showZeroTargetRoutes ? 'secondary' : 'outline'} aria-pressed={showZeroTargetRoutes} onClick={() => {
                    if (!showZeroTargetRoutes) loadCandidates();
                    setShowZeroTargetRoutes((prev) => !prev);
                  }}>
                    <Network className="size-4" />
                    {showZeroTargetRoutes ? tr('pages.tokenRoutes.0Targetsroutes2') : tr('pages.tokenRoutes.0Targetsroutes')}
                  </Button>
                  {routeGroupListTab === 'manual' ? (
                    <CreateActionButton type="button" label={tr('pages.tokenRoutes.newGroups')} onClick={() => openRouteWizard()} />
                  ) : null}
                </div>
              </div>
                </>
              )}
            </div>
          </section>

      {/* Collapsible filter panel */}
      <ResponsiveFilterPanel
        isMobile={isMobile}
        mobileOpen={showFilters}
        onMobileClose={() => setShowFilters(false)}
        mobileTitle={tr('pages.tokenRoutes.filterroutes')}
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
            {tr('components.mobileFilterSheet.filter')}
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
        modelMatchPreviewEndpoints={modelMatchPreviewEndpoints}
        exactSourceRouteOptions={exactSourceRouteOptions}
        routeEndpointCatalog={routeEndpointCatalog}
        sourceEndpointTypesByRouteId={sourceEndpointTypesByRouteId}
        currentRouteNodeJson={editingRouteNodeJson}
        onSave={handleAddRoute}
        onCancel={handleCancelEditRoute}
      />

      {/* Route card grid */}
      {/* Batch selection floating bar */}
      {batchSelectMode && (
        <Card className="sticky top-[calc(var(--topbar-height)+0.5rem)] z-50 mb-2 flex flex-wrap items-center gap-2 p-2.5">
          <span className="text-sm font-medium">
            <ListChecks className="mr-1 inline size-4 text-primary" />
            {tr('pages.oAuthManagement.selected')} <b>{selectedRouteIds.size}</b> / {selectableRouteIds.size} {tr('pages.tokenRoutes.routes2')}
          </span>
          <ButtonGroup>
            <Button type="button" variant="outline" size="sm" onClick={selectAllRoutes}>{tr('pages.tokenRoutes.selectAll')}</Button>
            <Button type="button" variant="outline" size="sm" onClick={deselectAllRoutes}>{tr('pages.accounts.cancelselectAll')}</Button>
          </ButtonGroup>
          <ButtonGroup className="ml-auto">
            {routeGroupListTab === 'manual' ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={selectedRouteIds.size === 0 || batchUpdatingRoutes}
                  onClick={() => handleBatchUpdateRoutes('set_public')}
                >
                  {batchUpdatingRoutes ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.downstreamKeys.processing')}</> : <><Upload className="size-4" />{tr('pages.tokenRoutes.setPublic')}</>}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={selectedRouteIds.size === 0 || batchUpdatingRoutes}
                  onClick={() => handleBatchUpdateRoutes('set_internal')}
                >
                  {batchUpdatingRoutes ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.downstreamKeys.processing')}</> : <><Download className="size-4" />{tr('pages.tokenRoutes.setInternal')}</>}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={selectedRouteIds.size === 0 || batchUpdatingRoutes}
                onClick={() => handleBatchUpdateRoutes(routeGroupListTab === 'internal' ? 'set_public' : 'set_internal')}
              >
                {batchUpdatingRoutes
                  ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.downstreamKeys.processing')}</>
                  : routeGroupListTab === 'internal'
                    ? <><Upload className="size-4" />{tr('pages.tokenRoutes.setPublic')}</>
                    : <><Download className="size-4" />{tr('pages.tokenRoutes.setInternal')}</>}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={selectedRouteIds.size === 0 || batchUpdatingRoutes}
              onClick={() => handleBatchUpdateRoutes('disable')}
            >
              {batchUpdatingRoutes ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.downstreamKeys.processing')}</> : <><Ban className="size-4" /><span className="sr-only">{tr('pages.tokenRoutes.batchDisable')}</span>{tr('pages.accounts.disabled')}</>}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={selectedRouteIds.size === 0 || batchUpdatingRoutes}
              onClick={() => handleBatchUpdateRoutes('enable')}
            >
              {batchUpdatingRoutes ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.downstreamKeys.processing')}</> : <><CheckCheck className="size-4" /><span className="sr-only">{tr('pages.tokenRoutes.batchEnable')}</span>{tr('pages.accounts.enabled')}</>}
            </Button>
          </ButtonGroup>
        </Card>
      )}

      <div className={routeListSingleColumn ? 'grid min-w-0 gap-3' : 'route-list-workbench-layout grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(280px,0.82fr)_minmax(0,1.18fr)]'}>
        <div className={isMobile ? 'grid gap-2' : 'route-list-pane grid min-w-0 max-w-full content-start gap-2'}>
        {routesLoading ? (
          <RouteGroupListLoadingSkeleton isMobile={isMobile} />
        ) : filteredRoutes.length === 0 ? (
          <EmptyStateBlock
            className="min-h-[360px] rounded-lg border bg-card"
            icon={<Search className="size-5" />}
            title={routeSummaries.length === 0 ? tr('pages.tokenRoutes.noRouteYet') : tr('pages.tokenRoutes.noMatchingRoute')}
            description={routeSummaries.length === 0
              ? tr('pages.tokenRoutes.autoRebuildModelavailableRoutes')
              : tr('pages.tokenRoutes.pleaseAdjustYourBrandFiltersSearchTerms')}
          />
        ) : visibleRoutes.map((route, index) => {
          const isExpanded = expandedRouteIds.includes(route.id);
          const isDesktopDetailClosing = closingDesktopDetailRouteIds.includes(route.id);
          const isReadOnlyRoute = route.kind === 'zero_target' || route.readOnly === true || route.isVirtual === true;
          const exactRoute = isRouteExactModel(route);
          const explicitGroupRoute = isExplicitGroupRoute(route);
          const targetManagementDisabled = explicitGroupRoute;
          const routeTitle = resolveRouteTitle(route);

          const isSelectable = selectableRouteIds.has(route.id);
          const isSelected = selectedRouteIds.has(route.id);

          if (isMobile) {
            return (
              <div key={route.id} className={`grid gap-2 animate-slide-up stagger-${Math.min(index + 1, 5)}`}>
                <MobileCard
                  title={routeTitle}
                  headerActions={(
                    <div className="flex items-center gap-2">
                      {batchSelectMode && isSelectable && (
                        <label className="inline-flex cursor-pointer items-center gap-1 text-xs">
                          <Checkbox
                            data-testid={`route-select-${route.id}`}
                            aria-label={tr('pages.tokenRoutes.selectRouteAria').replace('{route}', routeTitle)}
                            checked={isSelected}
                            onCheckedChange={() => toggleRouteSelection(route.id)}
                          />
                          <span>{tr('pages.tokenRoutes.select')}</span>
                        </label>
                      )}
                      <Badge variant={isReadOnlyRoute || !route.enabled ? 'secondary' : 'default'}>
                        {isReadOnlyRoute ? tr('pages.tokenRoutes.notGenerated') : (route.enabled ? tr('pages.downstreamKeys.enabled') : tr('pages.downstreamKeys.disabled'))}
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
                        {isExpanded ? tr('pages.accounts.collapse') : tr('pages.accounts.details')}
                      </Button>
                      {!isReadOnlyRoute && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditRoute(route)}
                        >
                          {tr('pages.accounts.edit')}
                        </Button>
                      )}
                      {!isReadOnlyRoute && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleRouteEnabled(route)}
                        >
                          {route.enabled ? tr('pages.downstreamKeys.disabled') : tr('pages.downstreamKeys.enabled')}
                        </Button>
                      )}
                      {!isReadOnlyRoute && !targetManagementDisabled && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => stableAddTarget(route.id)}
                        >
                          {tr('pages.tokenRoutes.addtargets')}
                        </Button>
                      )}
                    </ButtonGroup>
                  )}
                >
                  <MobileField label={tr('components.modelAnalysisPanel.model')} value={getRouteRequestedModelPattern(route) || resolveRouteTitle(route)} stacked />
                  <MobileField label={tr('pages.tokenRoutes.targets')} value={route.targetCount} />
                  <MobileField label={tr('pages.oAuthManagement.strategy')} value={isReadOnlyRoute ? tr('pages.tokenRoutes.notGenerated') : getRouteRoutingStrategyLabel(route.routingStrategy)} />
                  <MobileField label={tr('components.notificationPanel.status')} value={isReadOnlyRoute ? tr('pages.tokenRoutes.notGenerated') : (route.enabled ? tr('pages.downstreamKeys.enabled') : tr('pages.downstreamKeys.disabled'))} />
                  {explicitGroupRoute && (
                    <MobileField label={tr('pages.modelTester.mode')} value={tr('pages.tokenRoutes.groups2')} />
                  )}
                  {!exactRoute && !explicitGroupRoute && (
                    <MobileField label={tr('pages.modelTester.mode')} value={tr('pages.tokenRoutes.routes')} />
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
                    targets={targetsByRouteId[route.id]}
                    loadingTargets={!!loadingTargetsByRouteId[route.id]}
                    routeDecision={decisionByRoute[route.id] || null}
                    loadingDecision={loadingDecision}
                    candidateView={getRouteCandidateView(route.id)}
                    targetTokenDraft={targetTokenDraft}
                    updatingTarget={updatingTarget}
                    savingPriority={!!savingPriorityByRoute[route.id]}
                    onTokenDraftChange={stableTokenDraftChange}
                    onSaveToken={stableTargetTokenSave}
                    onDeleteTarget={stableDeleteTarget}
                    onToggleTargetEnabled={stableToggleTargetEnabled}
                    onTargetDragEnd={stableTargetDragEnd}
                    missingTokenSiteItems={getMissingTokenSiteItems(route.id)}
                    missingTokenGroupItems={getMissingTokenGroupItems(route.id)}
                    onCreateTokenForMissing={stableCreateTokenForMissing}
                    onAddTarget={stableAddTarget}
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
              summaryExpanded={activeRouteId === route.id}
              onToggleExpand={stableToggleExpand}
              onEdit={stableEditRoute}
              onDelete={stableDeleteRoute}
              onToggleEnabled={stableToggleEnabled}
              onClearCooldown={stableClearRouteCooldown}
              clearingCooldown={!!clearingCooldownByRoute[route.id]}
              onRoutingStrategyChange={stableRoutingStrategyChange}
              updatingRoutingStrategy={!!updatingRoutingStrategyByRoute[route.id]}
              targets={targetsByRouteId[route.id]}
              loadingTargets={!!loadingTargetsByRouteId[route.id]}
              routeDecision={decisionByRoute[route.id] || null}
              loadingDecision={loadingDecision}
              candidateView={EMPTY_ROUTE_CANDIDATE_VIEW}
              targetTokenDraft={targetTokenDraft}
              updatingTarget={updatingTarget}
              savingPriority={!!savingPriorityByRoute[route.id]}
              onTokenDraftChange={stableTokenDraftChange}
              onSaveToken={stableTargetTokenSave}
              onDeleteTarget={stableDeleteTarget}
              onToggleTargetEnabled={stableToggleTargetEnabled}
              onTargetDragEnd={stableTargetDragEnd}
              missingTokenSiteItems={EMPTY_MISSING_ITEMS}
              missingTokenGroupItems={EMPTY_MISSING_GROUP_ITEMS}
              onCreateTokenForMissing={stableCreateTokenForMissing}
              onAddTarget={stableAddTarget}
              onSiteBlockModel={stableSiteBlockModel}
              expandedSourceGroupMap={expandedSourceGroupMap}
              onToggleSourceGroup={stableToggleSourceGroup}
            />
          );

          if (batchSelectMode && isSelectable) {
            return (
              <div key={route.id} className={`flex items-stretch animate-slide-up stagger-${Math.min(index + 1, 5)}`}>
                <div className="flex items-stretch">
                  <div
                    onClick={() => toggleRouteSelection(route.id)}
                    className="flex min-h-full w-9 cursor-pointer items-center justify-center rounded-l-md border border-r-0"
                  >
                    <Checkbox
                      data-testid={`route-select-${route.id}`}
                      aria-label={tr('pages.tokenRoutes.selectRouteAria').replace('{route}', routeTitle)}
                      checked={isSelected}
                      onCheckedChange={() => toggleRouteSelection(route.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    {summaryCard}
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={route.id} className={`animate-slide-up stagger-${Math.min(index + 1, 5)}`}>
              {summaryCard}
            </div>
          );
        })}
        </div>

        {!isMobile && routesLoading ? (
          <RouteGroupDetailLoadingSkeleton />
        ) : !isMobile && filteredRoutes.length > 0 && (
          <section className="route-workbench grid min-h-[520px] min-w-0 max-w-full content-start gap-3">
            {activeRoute ? (
              <>
                <div className="rounded-lg border bg-card p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <strong className="min-w-0 truncate text-sm text-foreground">{resolveRouteTitle(activeRoute)}</strong>
                        <Badge variant={activeRoute.enabled ? 'success' : 'secondary'}>
                          {activeRoute.enabled ? tr('pages.downstreamKeys.enabled') : tr('pages.downstreamKeys.disabled')}
                        </Badge>
                        <Badge variant="secondary">{activeRoute.visibility === 'internal' ? tr('pages.tokenRoutes.routeGroupTabs.internal') : tr('pages.tokenRoutes.routeGroupTabs.external')}</Badge>
                        {activeRouteMacro ? <Badge variant="info">{tr('pages.tokenRoutes.routeGraphWorkbench.macro')}</Badge> : null}
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {getRouteRequestedModelPattern(activeRoute) || resolveRouteTitle(activeRoute)}
                      </div>
                    </div>
                    <ButtonGroup>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => (
                          activeRouteGraphMacro
                            ? focusRouteGraphMacro(activeRouteGraphMacro.id)
                            : focusRouteGraphNode(activeRouteGraphNodeId, activeRouteMacro?.id || null)
                        )}
                      >
                        <Crosshair className="size-4" />
                        {tr('pages.tokenRoutes.routeGraphWorkbench.focus')}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => handleEditRoute(activeRoute)}>
                        {tr('pages.accounts.edit')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => stableRouteVisibilityChange(activeRoute, activeRoute.visibility === 'internal' ? 'public' : 'internal')}
                      >
                        {activeRoute.visibility === 'internal'
                          ? tr('pages.tokenRoutes.setPublic')
                          : tr('pages.tokenRoutes.setInternal')}
                      </Button>
                    </ButtonGroup>
                  </div>
                </div>

                <Tabs.Tabs value={workbenchTab} onValueChange={(value) => setWorkbenchTab(value as RouteWorkbenchTab)} className="grid min-w-0 max-w-full gap-3">
                  <SegmentedTabBar<RouteWorkbenchTab>
                    value={workbenchTab}
                    onValueChange={setWorkbenchTab}
                    className="w-full"
                    mouseDownActivation
                    items={[
                      { value: 'priority', label: tr('pages.tokenRoutes.routeGraphWorkbench.priority'), icon: <ListChecks className="size-3.5" /> },
                      { value: 'macro', label: tr('pages.tokenRoutes.routeGraphWorkbench.macro'), icon: <Boxes className="size-3.5" /> },
                      { value: 'generated', label: tr('pages.tokenRoutes.routeGraphWorkbench.generatedView'), icon: <Workflow className="size-3.5" /> },
                      { value: 'diagnostics', label: tr('pages.tokenRoutes.routeWorkbench.diagnostics'), icon: <HeartPulse className="size-3.5" /> },
                      { value: 'json', label: tr('pages.tokenRoutes.routeGraphWorkbench.json'), icon: <FileJson className="size-3.5" /> },
                    ]}
                  />

                  <Tabs.TabsContent value="priority" className="min-w-0">
                    <RouteCard
                      route={activeRoute}
                      brand={routeBrandById.get(activeRoute.id) || null}
                      expanded
                      compact
                      detailPanel
                      showCollapseAction={false}
                      onToggleExpand={() => setActiveRouteId(null)}
                      onEdit={stableEditRoute}
                      onDelete={stableDeleteRoute}
                      onToggleEnabled={stableToggleEnabled}
                      onClearCooldown={stableClearRouteCooldown}
                      clearingCooldown={!!clearingCooldownByRoute[activeRoute.id]}
                      onRoutingStrategyChange={stableRoutingStrategyChange}
                      updatingRoutingStrategy={!!updatingRoutingStrategyByRoute[activeRoute.id]}
                      targets={targetsByRouteId[activeRoute.id]}
                      loadingTargets={!!loadingTargetsByRouteId[activeRoute.id]}
                      routeDecision={decisionByRoute[activeRoute.id] || null}
                      loadingDecision={loadingDecision}
                      candidateView={getRouteCandidateView(activeRoute.id)}
                      targetTokenDraft={targetTokenDraft}
                      updatingTarget={updatingTarget}
                      savingPriority={!!savingPriorityByRoute[activeRoute.id]}
                      onTokenDraftChange={stableTokenDraftChange}
                      onSaveToken={stableTargetTokenSave}
                      onDeleteTarget={stableDeleteTarget}
                      onToggleTargetEnabled={stableToggleTargetEnabled}
                      onTargetDragEnd={stableTargetDragEnd}
                      missingTokenSiteItems={getMissingTokenSiteItems(activeRoute.id)}
                      missingTokenGroupItems={getMissingTokenGroupItems(activeRoute.id)}
                      onCreateTokenForMissing={stableCreateTokenForMissing}
                      onAddTarget={stableAddTarget}
                      onSiteBlockModel={stableSiteBlockModel}
                      expandedSourceGroupMap={expandedSourceGroupMap}
                      onToggleSourceGroup={stableToggleSourceGroup}
                    />
                  </Tabs.TabsContent>

                  <Tabs.TabsContent value="macro" className="min-w-0 max-w-full overflow-hidden">
                    <div className="rounded-lg border bg-card p-3">
                      <div className="flex items-start gap-2">
                        <Boxes className="mt-0.5 size-4 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold">{activeRouteMacro ? tr('pages.tokenRoutes.routeGraphWorkbench.macro') : tr('pages.tokenRoutes.routeWorkbench.noMacro')}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {activeRouteMacro
                              ? tr('pages.tokenRoutes.routeWorkbench.macroDescription')
                              : tr('pages.tokenRoutes.routeWorkbench.noMacroDescription')}
                          </div>
                          <div className="mt-3 grid gap-2 text-xs">
                            <div className="flex justify-between gap-3">
                              <span className="text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkbench.label')}</span>
                              <span className="min-w-0 truncate font-medium">{activeRouteGraphMacro ? getMacroDisplayName(activeRouteGraphMacro) : '-'}</span>
                            </div>
                            <div className="flex justify-between gap-3">
                              <span className="text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkbench.macroId')}</span>
                              <code className="min-w-0 truncate">{activeRouteMacro?.id || '-'}</code>
                            </div>
                            <div className="flex justify-between gap-3">
                              <span className="text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.visibility')}</span>
                              <span>{activeRouteMacro?.visibility || activeRoute.visibility || 'public'}</span>
                            </div>
                            <div className="flex justify-between gap-3">
                              <span className="text-muted-foreground">{tr('pages.oAuthManagement.strategy')}</span>
                              <span>{getRouteRoutingStrategyLabel(activeRoute.routingStrategy)}</span>
                            </div>
                            <div className="flex justify-between gap-3">
                              <span className="text-muted-foreground">{tr('pages.tokenRoutes.manualRoutePanel.sourceRoutes')}</span>
                              <span>{activeRouteSourceRouteIds.length}</span>
                            </div>
                          </div>
                          <div className="mt-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => focusRouteGraphMacro(activeRouteGraphMacro?.id || activeRouteMacro?.id)}
                              disabled={!activeRouteMacro}
                            >
                              <Crosshair className="size-4" />
                              {tr('pages.tokenRoutes.routeWorkbench.openGraph')}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Tabs.TabsContent>

                  <Tabs.TabsContent value="generated" className="min-w-0 max-w-full overflow-hidden">
                    <div className="rounded-lg border bg-card p-3">
                      <div className="flex items-start gap-2">
                        <Workflow className="mt-0.5 size-4 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold">{tr('pages.tokenRoutes.routeGraphWorkbench.generatedView')}</div>
                            </div>
                            <ButtonGroup className="shrink-0">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => focusRouteGraphMacro(activeRouteGraphMacro?.id || activeRouteMacro?.id)}
                                disabled={!activeRouteMacro}
                              >
                                <Boxes className="size-4" />
                                {tr('pages.tokenRoutes.routeGraphWorkbench.macro')}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => focusRouteGraphNode(getGeneratedRoutePrimaryNodeId(activeRouteGeneratedRows[0]), activeRouteGraphMacro?.id || activeRouteMacro?.id || null)}
                                disabled={!activeRouteGraphMacro || activeRouteGeneratedRows.length === 0}
                              >
                                <Workflow className="size-4" />
                                {tr('pages.tokenRoutes.routeWorkbench.showGraph')}
                              </Button>
                            </ButtonGroup>
                          </div>
                          {!activeRouteGraphMacro ? (
                            <EmptyStateBlock
                              className="mt-3 rounded-md border border-dashed bg-background"
                              icon={<Boxes className="size-5" />}
                              title={tr('pages.tokenRoutes.routeWorkbench.noMacro')}
                              description={tr('pages.tokenRoutes.routeWorkbench.noMacroDescription')}
                            />
                          ) : activeRouteGeneratedRows.length === 0 ? (
                            <EmptyStateBlock
                              className="mt-3 rounded-md border border-dashed bg-background"
                              icon={<Workflow className="size-5" />}
                              title={tr('pages.tokenRoutes.routeGraphWorkbench.noGeneratedPrimitiveRoutes')}
                            />
                          ) : (
                            <div className="mt-3 grid min-w-0 gap-3">
                              <div className="rounded-md border bg-background p-3">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <Badge variant="info" className="max-w-full">
                                    <Boxes className="size-3" />
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      className="h-auto min-w-0 truncate p-0 text-left text-current hover:bg-transparent"
                                      onClick={() => focusRouteGraphMacro(activeRouteGraphMacro.id)}
                                    >
                                      {getMacroDisplayName(activeRouteGraphMacro)}
                                    </Button>
                                  </Badge>
                                  <Badge variant="secondary">
                                    <Waypoints className="size-3" />
                                    {activeRouteGeneratedRows.length}
                                  </Badge>
                                  <Badge variant="secondary">
                                    <GitCommitHorizontal className="size-3" />
                                    {new Set(activeRouteGeneratedRows.map((row) => row.groupIndex)).size}
                                  </Badge>
                                </div>
                                <div className="mt-2 break-words text-xs text-muted-foreground">
                                  {tr('pages.tokenRoutes.routeGraphWorkbench.generatedViewSummary')
                                    .replace('{name}', getMacroDisplayName(activeRouteGraphMacro))
                                    .replace('{paths}', String(activeRouteGeneratedRows.length))
                                    .replace('{groups}', String(new Set(activeRouteGeneratedRows.map((row) => row.groupIndex)).size))}
                                </div>
                              </div>
                              <div className="grid min-w-0 gap-2">
                                {activeRouteGeneratedRows.map((row) => {
                                  const pathNodes = getGeneratedRoutePathNodes(row);
                                  return (
                                    <div key={row.id} className="grid min-w-0 gap-2 rounded-md border bg-background p-2.5 text-xs">
                                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                                        <div className="min-w-0">
                                          <div className="truncate font-medium">{getGeneratedRouteRowLabel(row)}</div>
                                          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-muted-foreground">
                                            <span>{row.groupLabel}</span>
                                            <span className="text-muted-foreground/60">·</span>
                                            <span>{tr('pages.tokenRoutes.routeGraphWorkbench.priorityValue').replace('{value}', String(row.priority))}</span>
                                          </div>
                                        </div>
                                        <Badge variant="outline" className="shrink-0">{tr('pages.tokenRoutes.routeGraphWorkbench.readOnly')}</Badge>
                                      </div>
                                      <div className="grid min-w-0 gap-1.5 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch">
                                        {pathNodes.map((pathNode, index) => (
                                          <Fragment key={`${row.id}:${pathNode.key}:${pathNode.nodeId}`}>
                                            {index > 0 ? (
                                              <div className="hidden items-center justify-center text-muted-foreground md:flex">
                                                <ArrowRight className="size-4" />
                                              </div>
                                            ) : null}
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              className="h-auto min-w-0 justify-start gap-2 whitespace-normal px-2 py-1.5 text-left"
                                              onClick={() => focusRouteGraphNode(pathNode.nodeId, activeRouteGraphMacro.id)}
                                            >
                                              <Crosshair className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                                              <span className="min-w-0">
                                                <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{pathNode.label}</span>
                                                <span className="block break-all font-mono text-xs leading-snug">{pathNode.detail}</span>
                                              </span>
                                            </Button>
                                          </Fragment>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </Tabs.TabsContent>

                  <Tabs.TabsContent value="diagnostics" className="min-w-0 max-w-full overflow-hidden">
                    <div className="rounded-lg border bg-card p-3">
                      <div className="flex items-start gap-2">
                        <HeartPulse className="mt-0.5 size-4 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold">{tr('pages.tokenRoutes.routeWorkbench.diagnostics')}</div>
                          <div className="mt-3 grid gap-2 text-xs">
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">{tr('pages.tokenRoutes.targets')}</span><span>{activeRoute.enabledTargetCount} / {activeRoute.targetCount}</span></div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">{tr('pages.tokenRoutes.routeCard.cached')}</span><span>{activeRoute.decisionSnapshot ? tr('pages.tokenRoutes.routeWorkbench.yes') : tr('pages.tokenRoutes.routeWorkbench.no')}</span></div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">{tr('pages.tokenRoutes.routeWorkbench.selectionCandidates')}</span><span>{decisionByRoute[activeRoute.id]?.candidates?.length || 0}</span></div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">{tr('pages.tokenRoutes.routeWorkbench.missingTokens')}</span><span>{getMissingTokenSiteItems(activeRoute.id).length + getMissingTokenGroupItems(activeRoute.id).length}</span></div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">{tr('pages.tokenRoutes.routeCard.lastRefreshed')}</span><span>{activeRoute.decisionRefreshedAt || '-'}</span></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Tabs.TabsContent>

                  <Tabs.TabsContent value="json" className="min-w-0 max-w-full overflow-hidden">
                    <div className="min-w-0 max-w-full overflow-hidden rounded-lg border bg-card p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold">{tr('pages.tokenRoutes.routeGraphWorkbench.json')}</div>
                        <Button type="button" variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(activeRouteJson)}>
                          {tr('pages.tokenRoutes.routeGraphWorkbench.copy')}
                        </Button>
                      </div>
                      <pre className="max-h-[420px] min-w-0 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs text-foreground">{activeRouteJson}</pre>
                    </div>
                  </Tabs.TabsContent>
                </Tabs.Tabs>
              </>
            ) : (
              <EmptyStateBlock
                className="rounded-lg border bg-card"
                icon={<Info className="size-5" />}
                title={tr('pages.tokenRoutes.routeWorkbench.emptyTitle')}
                description={tr('pages.tokenRoutes.routeWorkbench.emptyDescription')}
              />
            )}
          </section>
        )}
      </div>

      {!routesLoading && filteredRoutes.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
          <div className="mr-auto text-xs text-muted-foreground">
            {tr('pages.tokenRoutes.routeBrowser.showingRoutes')
              .replace('{start}', String(routePageWindow.displayedStart))
              .replace('{end}', String(routePageWindow.displayedEnd))
              .replace('{total}', String(filteredRoutes.length))}
          </div>
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  type="button"
                  disabled={routePageWindow.safePage <= 1}
                  onClick={() => setRoutePage((current) => Math.max(1, current - 1))}
                  aria-label={tr('pages.models.previousPage')}
                />
              </PaginationItem>
              {routePageNumbers.map((pageNumber) => (
                <PaginationItem key={pageNumber}>
                  <PaginationLink
                    type="button"
                    isActive={pageNumber === routePageWindow.safePage}
                    onClick={() => setRoutePage(pageNumber)}
                  >
                    {pageNumber}
                  </PaginationLink>
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  type="button"
                  disabled={routePageWindow.safePage >= routePageWindow.totalPages}
                  onClick={() => setRoutePage((current) => Math.min(routePageWindow.totalPages, current + 1))}
                  aria-label={tr('pages.models.nextPage')}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{tr('pages.proxyLogs.rowsPerPageLabel')}</span>
            <Select
              value={String(routePageSize)}
              onValueChange={(nextValue) => {
                setRoutePageSize(Number(nextValue));
                setRoutePage(1);
              }}
            >
              <SelectTrigger className="w-24">
                <SelectValue placeholder={String(routePageSize)} />
              </SelectTrigger>
              <SelectContent>
                {ROUTE_PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Add target modal */}
      {addRouteTargetModalRoute && (
        <AddRouteTargetModal
          open={!!addRouteTargetModalRouteId}
          onClose={() => setAddRouteTargetModalRouteId(null)}
          routeId={addRouteTargetModalRoute.id}
          routeTitle={resolveRouteTitle(addRouteTargetModalRoute)}
          candidateView={getRouteCandidateView(addRouteTargetModalRoute.id)}
          onSuccess={handleAddTargetSuccess}
          missingTokenHints={getRouteMissingTokenHints(addRouteTargetModalRoute.id)}
          onCreateTokenForMissing={handleCreateTokenForMissingAccount}
          existingTargetAccountIds={new Set((targetsByRouteId[addRouteTargetModalRoute.id] || []).map((c) => c.accountId))}
        />
      )}
          <Dialog.Root open={!!targetDeleteConfirmation} onOpenChange={(open) => { if (!open) closeDeleteTargetConfirmation(false); }}>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>{tr('pages.tokenRoutes.confirmRemovetargets')}</Dialog.Title>
                <Dialog.Description>
                  {tr('pages.tokenRoutes.removeTargetsModelrefreshAutoRebuildTargetsSuggestionusagedisabled')}
                </Dialog.Description>
              </Dialog.Header>
              <label className="mt-4 flex items-center gap-2 text-sm">
                <Checkbox
                  checked={targetDeleteConfirmation?.dontAskAgain === true}
                  onCheckedChange={(checked) => {
                    setTargetDeleteConfirmation((current) => current ? { ...current, dontAskAgain: checked === true } : current);
                  }}
                />
                {tr('pages.tokenRoutes.doNotShowAgain')}
              </label>
              <Dialog.Footer>
                <Button type="button" variant="outline" onClick={() => closeDeleteTargetConfirmation(false)}>{tr('app.cancel')}</Button>
                <Button type="button" variant="destructive" onClick={() => closeDeleteTargetConfirmation(true)}>{tr('pages.tokenRoutes.confirmRemove')}</Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Root>

          <Dialog.Root open={!!siteBlockConfirmation} onOpenChange={(open) => { if (!open) closeSiteBlockConfirmation(false); }}>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>{tr('pages.tokenRoutes.sites2')}</Dialog.Title>
                <Dialog.Description>
                  {tr('pages.tokenRoutes.disabledAutomaticRoutesSitesModelTargets')
                    .replace('{model}', siteBlockConfirmation?.modelName || '')
                    .replace('{site}', siteBlockConfirmation?.siteName || '')}
                </Dialog.Description>
              </Dialog.Header>
              <Dialog.Footer>
                <Button type="button" variant="outline" onClick={() => closeSiteBlockConfirmation(false)}>{tr('app.cancel')}</Button>
                <Button type="button" onClick={() => closeSiteBlockConfirmation(true)}>{tr('pages.tokenRoutes.confirmBlock')}</Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Root>
        </Tabs.TabsContent>
      </Tabs.Tabs>
    </PageShell>
  );
}
