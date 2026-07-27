import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type ModelRuntimeObservability } from '../api.js';
import {
  Check,
  Filter,
  RefreshCw,
} from 'lucide-react';
import { BrandGlyph, getBrand, BrandIcon, type BrandInfo } from '../components/BrandIcon.js';
import SearchInput from '../components/SearchInput.js';
import EmptyStateBlock from '../components/EmptyStateBlock.js';
import { useToast } from '../components/Toast.js';
import ResponsiveFilterPanel from '../components/ResponsiveFilterPanel.js';
import { useIsMobile } from '../components/useIsMobile.js';
import { usePrefetchIntent } from '../components/usePrefetchIntent.js';
import { tr } from '../i18n.js';
import { cn } from '../lib/utils.js';
import { Button } from '../components/ui/button/index.js';
import { Skeleton } from '../components/ui/skeleton/index.js';
import ToneBadge from '../components/ToneBadge.js';
import { Card, CardContent } from '../components/ui/card/index.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select/index.js';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '../components/ui/pagination/index.js';
import EntityWorkspaceLayout from '../components/workspace/EntityWorkspaceLayout.js';
import ModelDetailsWorkspace from './models/ModelDetailsWorkspace.js';
import {
  buildModelDetailsView,
  formatLatencyValue,
  getModelCredentialCount,
  resolveVisiblePerformanceObservability,
  type ModelDetailsTab,
  type ModelMetricsRange,
  type ModelRow,
} from './models/modelDetailsView.js';
import {
  MODEL_DETAILS_PREFETCH_INTENT_MS,
  MODEL_DETAILS_SUMMARY_RANGE,
  modelDetailsResourcesFor,
} from './models/modelDetailsResourcePolicy.js';
import { useModelDetailsResourceCache } from './models/useModelDetailsResourceCache.js';
import type { ModelsMarketplaceResponse } from '../../shared/modelsMarketplace.js';

type SortColumn = 'name' | 'accountCount' | 'credentialCount' | 'successRate';

type MarketplaceQueryState = {
  page: number;
  pageSize: number;
  q: string;
  brand: string | null;
  site: string | null;
  sortBy: SortColumn;
  sortDir: 'asc' | 'desc';
};

const PAGE_SIZES = [10, 20, 50];
const PERFORMANCE_OBSERVABILITY_REFRESH_MS = 15_000;
const MARKETPLACE_SEARCH_DEBOUNCE_MS = 300;
const SORT_OPTIONS: Array<{ key: SortColumn; label: string }> = [
  { key: 'accountCount', label: tr('pages.models.accounts') },
  { key: 'credentialCount', label: tr('pages.models.credentials') },
  { key: 'successRate', label: tr('components.modelAnalysisPanel.successRate') },
  { key: 'name', label: tr('pages.models.name') },
];

function sameMarketplaceQuery(a: MarketplaceQueryState | null, b: MarketplaceQueryState): boolean {
  return !!a
    && a.page === b.page
    && a.pageSize === b.pageSize
    && a.q === b.q
    && a.brand === b.brand
    && a.site === b.site
    && a.sortBy === b.sortBy
    && a.sortDir === b.sortDir;
}

function hasRecordKey<T>(record: Record<string, T>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function SortIndicator({ active, direction }: { active: boolean; direction: 'asc' | 'desc' }) {
  if (!active) return null;
  return <span className="text-muted-foreground">{direction === 'desc' ? '↓' : '↑'}</span>;
}

function ModelTags({
  model,
  sites,
}: {
  model: ModelRow;
  sites: string[];
}) {
  const brand = getBrand(model.name);
  return (
    <div className="flex flex-wrap gap-1.5">
      {brand ? <ToneBadge tone="-info">{brand.name}</ToneBadge> : null}
      {sites.map((site) => <ToneBadge key={site} tone="-muted">{site}</ToneBadge>)}
      {model.successRate != null && model.successRate >= 90 ? <ToneBadge tone="-success">{tr('pages.accounts.healthy')}</ToneBadge> : null}
      {model.successRate != null && model.successRate < 60 ? <ToneBadge tone="-warning">{tr('pages.models.risk')}</ToneBadge> : null}
    </div>
  );
}

function ModelIndexSkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_item, index) => (
        <div key={index} className="rounded-md border p-3">
          <div className="flex items-start gap-2">
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-3/4" />
              <div className="mt-2 flex items-center gap-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 w-14" />
              </div>
              <div className="mt-3 flex gap-1.5">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

/* ---- component ---- */
export default function Models() {
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<ModelsMarketplaceResponse>({
    models: [],
    pageInfo: { page: 1, pageSize: 20, totalCount: 0, hasMore: false },
    facets: { brands: [], otherBrandCount: 0, sites: [] },
    meta: {
      refreshRequested: false,
      refreshQueued: false,
      refreshReused: false,
      refreshRunning: false,
      refreshJobId: null,
      includePricing: false,
    },
  });
  const [loading, setLoading] = useState(true);
  const [marketplaceError, setMarketplaceError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortColumn>('accountCount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [activeSite, setActiveSite] = useState<string | null>(null);
  const [activeBrand, setActiveBrand] = useState<string | null>(null);
  const [settledMarketplaceQuery, setSettledMarketplaceQuery] = useState<MarketplaceQueryState | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [showFilters, setShowFilters] = useState(false);
  const [settledPerformanceObservabilityByModel, setSettledPerformanceObservabilityByModel] = useState<Record<string, ModelRuntimeObservability>>({});
  const {
    ensure: ensureModelDetailsResources,
    prefetch: prefetchModelDetailsResources,
    refresh: refreshModelDetailsResources,
    snapshot: modelDetailsSnapshot,
  } = useModelDetailsResourceCache();
  const isMobile = useIsMobile();
  const latestPrimaryRequestRef = useRef(0);
  const location = useLocation();
  const routeParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const selectedModelName = routeParams.get('model') || '';
  const workspaceTab = (routeParams.get('tab') || 'overview') as ModelDetailsTab;
  const rawWorkspaceRange = routeParams.get('range') || '6h';
  const workspaceRange = (rawWorkspaceRange === '5m' || rawWorkspaceRange === '15m' || rawWorkspaceRange === '1h' || rawWorkspaceRange === '6h' || rawWorkspaceRange === '24h' || rawWorkspaceRange === '7d' || rawWorkspaceRange === '30d'
    ? rawWorkspaceRange
    : '6h') as ModelMetricsRange;
  const summaryObservabilityKey = selectedModelName ? `${selectedModelName}:${MODEL_DETAILS_SUMMARY_RANGE}` : '';
  const performanceObservabilityKey = selectedModelName ? `${selectedModelName}:${workspaceRange}` : '';
  const activeModelResources = useMemo(() => modelDetailsResourcesFor({
    model: selectedModelName,
    tab: workspaceTab,
    range: workspaceRange,
    phase: 'activate',
  }), [selectedModelName, workspaceRange, workspaceTab]);
  const refreshModelResources = useMemo(() => modelDetailsResourcesFor({
    model: selectedModelName,
    tab: workspaceTab,
    range: workspaceRange,
    phase: 'refresh',
  }), [selectedModelName, workspaceRange, workspaceTab]);
  const routingViewParam = routeParams.get('routingView') || '';
  const routingViewMode = (
    routingViewParam === 'cost' || routingViewParam === 'pricing'
      ? 'cost'
      : routingViewParam === 'diagnostics'
        ? 'diagnostics'
        : 'execution'
  ) as 'execution' | 'cost' | 'diagnostics';
  const currentMarketplaceQuery = useMemo<MarketplaceQueryState>(() => ({
    page,
    pageSize,
    q: debouncedSearch,
    brand: activeBrand,
    site: activeSite,
    sortBy,
    sortDir,
  }), [activeBrand, activeSite, debouncedSearch, page, pageSize, sortBy, sortDir]);

  const updateRouteParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(updates)) {
      if (value == null || value === '') params.delete(key);
      else params.set(key, value);
    }
    navigate({ pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : '' }, { replace: false });
  }, [location.pathname, location.search, navigate]);

  const loadBaseMarketplace = useCallback(async (refresh = false) => {
    const requestId = ++latestPrimaryRequestRef.current;
    setLoading(true);
    setMarketplaceError('');
    try {
      const res = await api.getModelsMarketplace({
        page,
        pageSize,
        q: debouncedSearch,
        brand: activeBrand,
        site: activeSite,
        sortBy,
        sortDir,
        refresh,
        includePricing: false,
      });
      if (requestId !== latestPrimaryRequestRef.current) return null;
      const next = res as ModelsMarketplaceResponse;
      setData(next);
      setSettledMarketplaceQuery({
        page,
        pageSize,
        q: debouncedSearch,
        brand: activeBrand,
        site: activeSite,
        sortBy,
        sortDir,
      });
      if (refresh && next.meta?.refreshRequested) {
        if (next.meta.refreshReused) {
          toast.info(tr('pages.models.marketplaceRefreshProgress'));
        } else if (next.meta.refreshQueued) {
          toast.info(tr('pages.models.startedRefreshingMarketplace'));
        }
      }
      return next;
    } catch (error) {
      if (requestId !== latestPrimaryRequestRef.current) return null;
      setMarketplaceError(error instanceof Error ? error.message : tr('pages.models.failedLoadMarketplace'));
      return null;
    } finally {
      if (requestId === latestPrimaryRequestRef.current) {
        setLoading(false);
      }
    }
  }, [activeBrand, activeSite, debouncedSearch, page, pageSize, sortBy, sortDir, toast]);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      await loadBaseMarketplace(false);
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [loadBaseMarketplace]);

  const handleRefresh = useCallback(() => {
    void loadBaseMarketplace(true);
  }, [loadBaseMarketplace]);

  const prefetchModelDetailsTab = useCallback((tab: ModelDetailsTab) => {
    prefetchModelDetailsResources(modelDetailsResourcesFor({
      model: selectedModelName,
      tab,
      range: workspaceRange,
      phase: 'prefetch',
    }));
  }, [prefetchModelDetailsResources, selectedModelName, workspaceRange]);

  const prefetchModelSelection = useCallback((modelName: string) => {
    prefetchModelDetailsResources(modelDetailsResourcesFor({
      model: modelName,
      tab: workspaceTab || 'overview',
      range: workspaceRange,
      phase: 'prefetch',
    }));
  }, [prefetchModelDetailsResources, workspaceRange, workspaceTab]);

  const modelSelectionPrefetchIntent = usePrefetchIntent<string>({
    delayMs: MODEL_DETAILS_PREFETCH_INTENT_MS,
    onIntent: prefetchModelSelection,
  });

  const handleDetailsRefresh = useCallback(() => {
    handleRefresh();
    refreshModelDetailsResources(refreshModelResources);
  }, [handleRefresh, refreshModelDetailsResources, refreshModelResources]);

  useEffect(() => {
    const q = new URLSearchParams(location.search).get('q') || '';
    setSearchInput(q);
    setDebouncedSearch(q);
  }, [location.search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch((current) => current === searchInput ? current : searchInput);
      setPage(1);
    }, MARKETPLACE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    ensureModelDetailsResources(activeModelResources);
  }, [activeModelResources, ensureModelDetailsResources]);

  useEffect(() => {
    if (!selectedModelName || workspaceTab !== 'performance') return;
    const timer = setInterval(() => {
      refreshModelDetailsResources(refreshModelResources, { silent: true });
    }, PERFORMANCE_OBSERVABILITY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshModelDetailsResources, refreshModelResources, selectedModelName, workspaceTab]);

  /* ---- derived: brand list ---- */
  const brandList = useMemo(() => {
    if (data.facets?.brands) {
      const list = data.facets.brands.map((brand) => [
        brand.name,
        {
          count: brand.count,
          brand: {
            name: brand.name,
            icon: brand.icon || getBrand(brand.name)?.icon || '',
            color: brand.color || getBrand(brand.name)?.color || '',
          } satisfies BrandInfo,
        },
      ] as const);
      return {
        list,
        otherCount: data.facets.otherBrandCount || 0,
        totalCount: list.reduce((sum, [, item]) => sum + item.count, 0) + (data.facets.otherBrandCount || 0),
      };
    }

    const m = new Map<string, { count: number; brand: BrandInfo }>();
    let otherCount = 0;
    for (const model of data.models) {
      const brand = getBrand(model.name);
      if (brand) {
        const existing = m.get(brand.name);
        if (existing) existing.count++;
        else m.set(brand.name, { count: 1, brand });
      } else {
        otherCount++;
      }
    }
    const list = [...m.entries()].sort((a, b) => b[1].count - a[1].count);
    return {
      list,
      otherCount,
      totalCount: list.reduce((sum, [, item]) => sum + item.count, 0) + otherCount,
    };
  }, [data.facets?.brands, data.facets?.otherBrandCount, data.models]);

  /* ---- derived: site list ---- */
  const siteMap = useMemo(() => {
    if (data.facets?.sites) {
      return data.facets.sites.map((site) => [site.name, site.count] as const);
    }

    const m = new Map<string, number>();
    for (const model of data.models) {
      for (const a of model.accounts) {
        m.set(a.site, (m.get(a.site) || 0) + 1);
      }
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data.facets?.sites, data.models]);

  const displayedTotal = data.pageInfo?.totalCount ?? data.models.length;

  const hasLoadedMarketplace = Boolean(data.pageInfo) || data.models.length > 0;
  const marketplaceQueryStale = hasLoadedMarketplace && !sameMarketplaceQuery(settledMarketplaceQuery, currentMarketplaceQuery);
  const marketplaceRefreshing = hasLoadedMarketplace && (loading || marketplaceQueryStale);
  const showMarketplaceRefreshSkeleton = marketplaceRefreshing && data.models.length === 0;

  const visibleModels = data.models;

  /* ---- pagination ---- */
  const totalPages = Math.max(1, Math.ceil(displayedTotal / pageSize));
  const safePageVal = Math.min(page, totalPages);

  useEffect(() => { setPage(1); }, [debouncedSearch, activeSite, activeBrand, pageSize]);

  useEffect(() => {
    if (!data.pageInfo) return;
    if (page <= totalPages) return;
    setPage(totalPages);
  }, [data.pageInfo, page, totalPages]);

  const selectedModel = useMemo(() => (
    selectedModelName ? visibleModels.find((model) => model.name === selectedModelName) ?? null : null
  ), [selectedModelName, visibleModels]);

  const selectedPerformanceObservabilityLoaded = !!performanceObservabilityKey
    && hasRecordKey(modelDetailsSnapshot.observabilityByKey, performanceObservabilityKey);
  const selectedPerformanceObservability = performanceObservabilityKey
    ? modelDetailsSnapshot.observabilityByKey[performanceObservabilityKey] ?? null
    : null;
  const selectedPerformanceObservabilityLoading = performanceObservabilityKey
    ? !!modelDetailsSnapshot.observabilityLoadingByKey[performanceObservabilityKey]
    : false;
  const selectedPerformanceObservabilityError = performanceObservabilityKey
    ? modelDetailsSnapshot.observabilityErrorByKey[performanceObservabilityKey] || ''
    : '';

  useEffect(() => {
    if (!selectedModelName || !selectedPerformanceObservability) return;
    setSettledPerformanceObservabilityByModel((current) => (
      current[selectedModelName] === selectedPerformanceObservability
        ? current
        : { ...current, [selectedModelName]: selectedPerformanceObservability }
    ));
  }, [selectedModelName, selectedPerformanceObservability]);

  const visiblePerformanceObservability = resolveVisiblePerformanceObservability({
    modelName: selectedModelName,
    current: selectedPerformanceObservability,
    currentLoaded: selectedPerformanceObservabilityLoaded,
    currentLoading: selectedPerformanceObservabilityLoading,
    currentError: selectedPerformanceObservabilityError,
    settledByModel: settledPerformanceObservabilityByModel,
  });

  useEffect(() => {
    if (!selectedModelName) return;
    if (selectedModel) return;
    if (loading || marketplaceQueryStale) return;
    const params = new URLSearchParams(location.search);
    params.delete('model');
    params.delete('node');
    navigate({ pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : '' }, { replace: true });
  }, [loading, location.pathname, location.search, marketplaceQueryStale, navigate, selectedModel, selectedModelName]);

  const selectedDetails = useMemo(() => {
    if (!selectedModel) return null;
    return buildModelDetailsView({
      model: selectedModel,
      brandName: getBrand(selectedModel.name)?.name ?? null,
      routeFlow: modelDetailsSnapshot.routeFlowByModel[selectedModel.name] ?? null,
      routeFlowDiagnostics: modelDetailsSnapshot.routeFlowDiagnosticsByModel[selectedModel.name] ?? null,
      routeFlowDiagnosticsError: modelDetailsSnapshot.routeFlowDiagnosticsErrorByModel[selectedModel.name] || '',
      routeFlowLoading: !!modelDetailsSnapshot.routeFlowLoadingByModel[selectedModel.name],
      routeFlowError: modelDetailsSnapshot.routeFlowErrorByModel[selectedModel.name] || '',
      observability: summaryObservabilityKey ? modelDetailsSnapshot.observabilityByKey[summaryObservabilityKey] ?? null : null,
      observabilityLoading: summaryObservabilityKey ? !!modelDetailsSnapshot.observabilityLoadingByKey[summaryObservabilityKey] : false,
      observabilityError: summaryObservabilityKey ? modelDetailsSnapshot.observabilityErrorByKey[summaryObservabilityKey] || '' : '',
      performanceObservability: visiblePerformanceObservability,
      performanceObservabilityLoading: selectedPerformanceObservabilityLoading,
      performanceObservabilityError: selectedPerformanceObservabilityError,
    });
  }, [
    modelDetailsSnapshot,
    selectedModel,
    selectedPerformanceObservabilityError,
    selectedPerformanceObservabilityLoading,
    summaryObservabilityKey,
    visiblePerformanceObservability,
  ]);

  const initialMarketplaceLoading = loading && !hasLoadedMarketplace;
  const totalCoverageSlots = visibleModels.reduce((s, m) => s + m.accountCount, 0);
  const totalCredentialSlots = visibleModels.reduce((sum, model) => sum + getModelCredentialCount(model), 0);
  const uniqueAccountCount = (() => {
    const ids = new Set<number>();
    for (const model of visibleModels) {
      for (const account of model.accounts) {
        ids.add(account.id);
      }
    }
    return ids.size;
  })();
  /* ---- copy ---- */
  const copyName = (name: string) => {
    navigator.clipboard.writeText(name).catch(() => { });
  };

  const filterControls = (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">{tr('pages.models.brands')}</div>
          {activeBrand ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => {
              setActiveBrand(null);
              setPage(1);
            }}>
              {tr('pages.models.reset')}
            </Button>
          ) : null}
        </div>
        <Button
          type="button"
          variant={!activeBrand ? 'secondary' : 'ghost'}
          className="w-full justify-start gap-2"
          onClick={() => {
            setActiveBrand(null);
            setPage(1);
          }}
        >
          <Check className="size-4" />
          <span className="min-w-0 flex-1 truncate text-left">{tr('pages.models.allBrands')}</span>
          <ToneBadge tone="-muted">{brandList.totalCount || displayedTotal}</ToneBadge>
        </Button>
        {brandList.list.map(([brandName, { count, brand }]) => (
          <Button
            key={brandName}
            type="button"
            variant={activeBrand === brandName ? 'secondary' : 'ghost'}
            className="w-full justify-start gap-2"
            onClick={() => {
              setActiveBrand(activeBrand === brandName ? null : brandName);
              setPage(1);
            }}
          >
            <BrandGlyph brand={brand} size={16} fallbackText={brandName} />
            <span className="min-w-0 flex-1 truncate text-left">{brandName}</span>
            <ToneBadge tone="-muted">{count}</ToneBadge>
          </Button>
        ))}
        {brandList.otherCount > 0 && (
          <Button
            type="button"
            variant={activeBrand === '__other__' ? 'secondary' : 'ghost'}
            className="w-full justify-start gap-2"
            onClick={() => {
              setActiveBrand(activeBrand === '__other__' ? null : '__other__');
              setPage(1);
            }}
          >
            <span className="inline-flex size-4 items-center justify-center text-xs text-muted-foreground">?</span>
            <span className="min-w-0 flex-1 truncate text-left">{tr('pages.models.other')}</span>
            <ToneBadge tone="-muted">{brandList.otherCount}</ToneBadge>
          </Button>
        )}
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">{tr('pages.models.providers')}</div>
          {activeSite ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => {
              setActiveSite(null);
              setPage(1);
            }}>
              {tr('pages.models.reset')}
            </Button>
          ) : null}
        </div>
        {siteMap.map(([site, count]) => (
          <Button
            key={site}
            type="button"
            variant={activeSite === site ? 'secondary' : 'ghost'}
            className="w-full justify-start gap-2"
            onClick={() => {
              setActiveSite(activeSite === site ? null : site);
              setPage(1);
            }}
          >
            <span className="inline-flex size-4 items-center justify-center text-xs text-muted-foreground">
              {site.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-left">{site}</span>
            <ToneBadge tone="-muted">{count}</ToneBadge>
          </Button>
        ))}
      </div>

      <div className="grid gap-2">
        <div className="text-sm font-medium">{tr('pages.accounts.sort')}</div>
        {SORT_OPTIONS.map(opt => (
          <Button
            key={opt.key}
            type="button"
            variant={sortBy === opt.key ? 'secondary' : 'ghost'}
            className="w-full justify-start gap-2"
            onClick={() => {
              if (sortBy === opt.key) {
                setSortDir(d => d === 'asc' ? 'desc' : 'asc');
              } else {
                setSortBy(opt.key);
                setSortDir(opt.key === 'name' ? 'asc' : 'desc');
              }
              setPage(1);
            }}
          >
            <span className="min-w-0 flex-1 truncate text-left">{opt.label}</span>
            <SortIndicator active={sortBy === opt.key} direction={sortDir} />
          </Button>
        ))}
      </div>
    </div>
  );

  const selectModel = useCallback((modelName: string) => {
    updateRouteParams({ model: modelName, tab: workspaceTab || 'overview' });
  }, [updateRouteParams, workspaceTab]);

  const modelIndexContent = (
    <div className="grid gap-3 p-3">
      <SearchInput
        value={searchInput}
        onChange={(e) => {
          setSearchInput(e.target.value);
        }}
        placeholder={tr('pages.modelTester.searchModelSupportsNameFragments')}
      />
      <div className="flex flex-wrap items-center gap-2">
        <ToneBadge tone="-info">{tr('pages.models.total')} {displayedTotal} {tr('pages.models.models2')}</ToneBadge>
        <ToneBadge tone="-muted">{tr('pages.models.coverageTier')} {totalCoverageSlots}</ToneBadge>
        <ToneBadge tone="-muted">{tr('pages.models.credentials')} {totalCredentialSlots}</ToneBadge>
        <ToneBadge tone="-muted">{tr('pages.models.uniqueAccounts')} {uniqueAccountCount}</ToneBadge>
      </div>
      {filterControls}
      <div
        className={cn(
          'grid gap-2 transition-opacity duration-150',
          marketplaceRefreshing && visibleModels.length > 0 && 'opacity-70',
        )}
        aria-busy={marketplaceRefreshing}
      >
        {showMarketplaceRefreshSkeleton ? (
          <ModelIndexSkeletonRows />
        ) : marketplaceRefreshing && visibleModels.length === 0 ? (
          <div className="min-h-48" aria-hidden="true" />
        ) : marketplaceError ? (
          <EmptyStateBlock title={tr('pages.models.failedLoadMarketplace')} description={marketplaceError} />
        ) : visibleModels.length === 0 ? (
          <EmptyStateBlock title={tr('pages.models.noModelYet')} description={tr('pages.models.checkSiteAccountStatusFirstThenRefresh')} />
        ) : visibleModels.map((model) => {
          const selected = selectedModelName === model.name;
          const sites = model.accounts.map((account) => account.site).filter((value, index, array) => array.indexOf(value) === index);
          return (
            <Button
              key={model.name}
              type="button"
              variant={selected ? 'secondary' : 'outline'}
              className="h-auto min-w-0 justify-start p-3 text-left"
              onPointerEnter={() => modelSelectionPrefetchIntent.schedule(model.name)}
              onMouseEnter={() => modelSelectionPrefetchIntent.schedule(model.name)}
              onFocus={() => modelSelectionPrefetchIntent.schedule(model.name)}
              onPointerLeave={modelSelectionPrefetchIntent.cancel}
              onMouseLeave={modelSelectionPrefetchIntent.cancel}
              onBlur={modelSelectionPrefetchIntent.cancel}
              onClick={() => selectModel(model.name)}
            >
              <div className="flex min-w-0 items-start gap-2">
                <BrandIcon model={model.name} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-sm font-semibold">{model.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{getBrand(model.name)?.name || tr('pages.models.modelDetailsView.providerUnknown')}</span>
                    <span>{model.successRate == null ? tr('common.notAvailable') : `${model.successRate}%`}</span>
                    <span>{tr('pages.models.modelDetailsView.latency')} {formatLatencyValue(model.avgLatency)}</span>
                  </div>
                  <div className="mt-2">
                    <ModelTags model={model} sites={sites.slice(0, 2)} />
                  </div>
                </div>
              </div>
            </Button>
          );
        })}
      </div>
      {displayedTotal > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  type="button"
                  disabled={safePageVal <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  aria-label={tr('pages.models.previousPage')}
                />
              </PaginationItem>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) pageNum = i + 1;
                else if (safePageVal <= 3) pageNum = i + 1;
                else if (safePageVal >= totalPages - 2) pageNum = totalPages - 4 + i;
                else pageNum = safePageVal - 2 + i;
                return (
                  <PaginationItem key={pageNum}>
                    <PaginationLink type="button" isActive={pageNum === safePageVal} onClick={() => setPage(pageNum)}>
                      {pageNum}
                    </PaginationLink>
                  </PaginationItem>
                );
              })}
              <PaginationItem>
                <PaginationNext
                  type="button"
                  disabled={safePageVal >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  aria-label={tr('pages.models.nextPage')}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
          <Select value={String(pageSize)} onValueChange={(nextValue) => {
            setPageSize(Number(nextValue));
            setPage(1);
          }}>
            <SelectTrigger className="w-24">
              <SelectValue placeholder={String(pageSize)} />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>{size}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );

  /* ---- loading skeleton ---- */
  if (initialMarketplaceLoading) {
    return (
      <div className="flex min-h-[400px] gap-6">
        {!isMobile && (
          <Card className="w-60 shrink-0">
            <CardContent className="grid gap-2 p-3">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
            </CardContent>
          </Card>
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Skeleton className="mb-2 h-7 w-56" />
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="flex items-center gap-2">
              {isMobile && (
                <Button type="button" variant="outline" onClick={() => setShowFilters(true)}>
                  <Filter className="size-4" />
                  {tr('components.mobileFilterSheet.filter')}
                </Button>
              )}
            </div>
          </div>
          <ResponsiveFilterPanel
            isMobile={isMobile}
            mobileOpen={showFilters}
            onMobileClose={() => setShowFilters(false)}
            mobileTitle={tr('pages.models.filtermodel')}
            mobileContent={filterControls}
          />
          <div className="grid gap-3">
            <ModelIndexSkeletonRows />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[400px] gap-6">
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              {activeBrand || activeSite || tr('app.modelMarketplace')}
              <ToneBadge tone="-info">
                {tr('pages.models.total')} {displayedTotal} {tr('pages.models.models2')}
              </ToneBadge>
            </h2>
            {(activeBrand || activeSite) && (
              <p className="mt-1 text-xs text-muted-foreground">
                {activeBrand && activeBrand !== '__other__' ? `${tr('pages.downstreamKeys.viewing')} ${activeBrand} ${tr('pages.models.brandModels')}` : activeSite ? `${tr('pages.models.fromProvider')} ${activeSite} ${tr('pages.models.models')}` : tr('pages.models.otherUncategorizedModels')}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isMobile && (
              <Button type="button" variant="outline" onClick={() => setShowFilters(true)}>
                <Filter className="size-4" />
                {tr('components.mobileFilterSheet.filter')}
              </Button>
            )}
            <Button type="button" variant="outline" size="icon" onClick={handleRefresh} aria-label={tr('pages.accounts.refresh')}>
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </div>

        <ResponsiveFilterPanel
          isMobile={isMobile}
          mobileOpen={showFilters}
          onMobileClose={() => setShowFilters(false)}
          mobileTitle={tr('pages.models.filtermodel')}
          mobileContent={filterControls}
        />

        <EntityWorkspaceLayout
          index={modelIndexContent}
          workspace={(
            <ModelDetailsWorkspace
              details={selectedDetails}
              tab={workspaceTab}
              onTabChange={(nextTab) => updateRouteParams({ tab: nextTab })}
              range={workspaceRange}
              onRangeChange={(nextRange) => updateRouteParams({ range: nextRange })}
              onTabPrefetch={prefetchModelDetailsTab}
              routingViewMode={routingViewMode}
              onRoutingViewModeChange={(nextMode) => updateRouteParams({ routingView: nextMode })}
              onCopyModel={copyName}
              onRefresh={handleDetailsRefresh}
              onCopyJson={(text) => {
                navigator.clipboard.writeText(text).catch(() => {});
              }}
            />
          )}
          mobile={isMobile}
        />
      </div>
    </div>
  );
}
