import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
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
import { mergeMarketplaceMetadata, shouldHydrateMarketplaceMetadata } from './helpers/modelsMarketplaceMetadata.js';
import { tr } from '../i18n.js';
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
import ModelDetailsWorkspace, { ModelInspector } from './models/ModelDetailsWorkspace.js';
import {
  buildModelDetailsView,
  type ModelDetailsTab,
  type ModelMetricsRange,
  type ModelRow,
} from './models/modelDetailsView.js';
import type { ModelRouteFlowData } from '../components/ModelRouteFlow.js';

type SortColumn = 'name' | 'accountCount' | 'tokenCount' | 'avgLatency' | 'successRate';

interface ModelsMarketplaceResponse {
  models: ModelRow[];
  meta?: {
    refreshRequested?: boolean;
    refreshQueued?: boolean;
    refreshReused?: boolean;
    refreshRunning?: boolean;
    refreshJobId?: string | null;
  };
}

function isKnownLatency(latency: number | null | undefined): latency is number {
  return typeof latency === 'number' && Number.isFinite(latency);
}

function formatLatency(latency: number | null): string {
  return isKnownLatency(latency) ? `${latency}ms` : '—';
}

const PAGE_SIZES = [10, 20, 50];
const SORT_OPTIONS: Array<{ key: SortColumn; label: string }> = [
  { key: 'accountCount', label: tr('pages.models.accounts') },
  { key: 'tokenCount', label: tr('pages.models.tokens') },
  { key: 'avgLatency', label: tr('components.modelRouteFlow.latency') },
  { key: 'successRate', label: tr('components.modelAnalysisPanel.successRate') },
  { key: 'name', label: tr('pages.models.name') },
];

function compareModels(a: ModelRow, b: ModelRow, sortBy: SortColumn, sortDir: 'asc' | 'desc'): number {
  if (sortBy === 'name') {
    const cmp = a.name.localeCompare(b.name);
    return sortDir === 'asc' ? cmp : -cmp;
  }

  const resolveNumericSortValue = (model: ModelRow) => {
    if (sortBy === 'successRate') return model.successRate ?? -1;
    if (sortBy === 'avgLatency') {
      if (!isKnownLatency(model.avgLatency)) {
        return sortDir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      }
      return model.avgLatency;
    }
    return model[sortBy] ?? 0;
  };

  const va = resolveNumericSortValue(a);
  const vb = resolveNumericSortValue(b);
  if (va === vb) return a.name.localeCompare(b.name);
  return sortDir === 'desc' ? vb - va : va - vb;
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
      {isKnownLatency(model.avgLatency) && model.avgLatency <= 500 ? <ToneBadge tone="-success">{tr('pages.models.lowLatency')}</ToneBadge> : null}
    </div>
  );
}

/* ---- component ---- */
export default function Models() {
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<ModelsMarketplaceResponse>({ models: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortColumn>('accountCount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [activeSite, setActiveSite] = useState<string | null>(null);
  const [activeBrand, setActiveBrand] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [showFilters, setShowFilters] = useState(false);
  const [metadataHydrating, setMetadataHydrating] = useState(false);
  const [routeFlowByModel, setRouteFlowByModel] = useState<Record<string, ModelRouteFlowData | null>>({});
  const [routeFlowLoadingByModel, setRouteFlowLoadingByModel] = useState<Record<string, boolean>>({});
  const [routeFlowErrorByModel, setRouteFlowErrorByModel] = useState<Record<string, string>>({});
  const isMobile = useIsMobile();
  const latestPrimaryRequestRef = useRef(0);
  const latestMetadataRequestRef = useRef(0);
  const requestedRouteFlowModelsRef = useRef(new Set<string>());
  const location = useLocation();
  const routeParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const selectedModelName = routeParams.get('model') || '';
  const workspaceTab = (routeParams.get('tab') || 'overview') as ModelDetailsTab;
  const workspaceRange = (routeParams.get('range') || '24h') as ModelMetricsRange;
  const routingViewMode = (routeParams.get('routingView') || 'effective') as 'effective' | 'candidates' | 'compiled' | 'diagnostics';

  const updateRouteParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(updates)) {
      if (value == null || value === '') params.delete(key);
      else params.set(key, value);
    }
    navigate({ pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : '' }, { replace: false });
  }, [location.pathname, location.search, navigate]);
  const siteIdByName = useMemo(() => {
    const index = new Map<string, number>();
    for (const model of data.models) {
      for (const source of model.pricingSources || []) {
        const siteName = String(source.siteName || '').trim();
        const siteId = Number(source.siteId);
        if (!siteName || !Number.isFinite(siteId) || siteId <= 0 || index.has(siteName)) continue;
        index.set(siteName, Math.trunc(siteId));
      }
    }
    return index;
  }, [data.models]);

  const loadBaseMarketplace = useCallback(async (refresh = false) => {
    const requestId = ++latestPrimaryRequestRef.current;
    latestMetadataRequestRef.current += 1;
    setMetadataHydrating(false);
    setLoading(true);
    try {
      const res = await api.getModelsMarketplace({
        refresh,
        includePricing: false,
      });
      if (requestId !== latestPrimaryRequestRef.current) return null;
      const next = res as ModelsMarketplaceResponse;
      setData(next);
      if (refresh && next.meta?.refreshRequested) {
        if (next.meta.refreshReused) {
          toast.info(tr('pages.models.marketplaceRefreshProgress'));
        } else if (next.meta.refreshQueued) {
          toast.info(tr('pages.models.startedRefreshingMarketplace'));
        }
      }
      return next;
    } catch {
      if (requestId !== latestPrimaryRequestRef.current) return null;
      setData({ models: [] });
      return null;
    } finally {
      if (requestId === latestPrimaryRequestRef.current) {
        setLoading(false);
      }
    }
  }, [toast]);

  const hydrateMarketplaceMetadata = useCallback(async (baseModels: ModelRow[]) => {
    if (!shouldHydrateMarketplaceMetadata(baseModels)) return;

    const metadataRequestId = ++latestMetadataRequestRef.current;
    const baseRequestId = latestPrimaryRequestRef.current;
    setMetadataHydrating(true);
    try {
      const res = await api.getModelsMarketplace({
        includePricing: true,
      });
      if (metadataRequestId !== latestMetadataRequestRef.current) return;
      if (baseRequestId !== latestPrimaryRequestRef.current) return;

      const detailed = res as ModelsMarketplaceResponse;
      setData((current) => ({
        ...current,
        models: mergeMarketplaceMetadata(current.models, detailed.models),
        meta: detailed.meta ?? current.meta,
      }));
    } catch {
      // Keep the fast base list when metadata fetch fails.
    } finally {
      if (metadataRequestId === latestMetadataRequestRef.current) {
        setMetadataHydrating(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let metadataTimer: ReturnType<typeof setTimeout> | null = null;
    const bootstrap = async () => {
      const initial = await loadBaseMarketplace(false);
      if (!initial || cancelled) return;
      metadataTimer = setTimeout(() => {
        if (!cancelled) {
          void hydrateMarketplaceMetadata(initial.models);
        }
      }, 1200);
    };
    void bootstrap();
    return () => {
      cancelled = true;
      if (metadataTimer) clearTimeout(metadataTimer);
      latestMetadataRequestRef.current += 1;
    };
  }, [hydrateMarketplaceMetadata, loadBaseMarketplace]);

  const handleRefresh = useCallback(() => {
    void (async () => {
      const refreshed = await loadBaseMarketplace(true);
      if (!refreshed) return;
      setTimeout(() => {
        void hydrateMarketplaceMetadata(refreshed.models);
      }, 600);
    })();
  }, [hydrateMarketplaceMetadata, loadBaseMarketplace]);

  useEffect(() => {
    const q = new URLSearchParams(location.search).get('q') || '';
    setSearch(q);
  }, [location.search]);

  useEffect(() => {
    if (!selectedModelName) return;
    if (requestedRouteFlowModelsRef.current.has(selectedModelName)) return;

    let cancelled = false;
    requestedRouteFlowModelsRef.current.add(selectedModelName);
    setRouteFlowLoadingByModel((current) => ({ ...current, [selectedModelName]: true }));
    setRouteFlowErrorByModel((current) => ({ ...current, [selectedModelName]: '' }));
    void api.getModelRouteFlow(selectedModelName)
      .then((result) => {
        if (cancelled) return;
        setRouteFlowByModel((current) => ({
          ...current,
          [selectedModelName]: (result as { flow?: ModelRouteFlowData }).flow || null,
        }));
      })
      .catch((error) => {
        if (cancelled) return;
        setRouteFlowByModel((current) => ({ ...current, [selectedModelName]: null }));
        requestedRouteFlowModelsRef.current.delete(selectedModelName);
        setRouteFlowErrorByModel((current) => ({
          ...current,
          [selectedModelName]: error instanceof Error ? error.message : tr('pages.modelTester.routesFailed'),
        }));
      })
      .finally(() => {
        if (!cancelled) {
          setRouteFlowLoadingByModel((current) => ({ ...current, [selectedModelName]: false }));
        }
      });

    return () => {
      cancelled = true;
      requestedRouteFlowModelsRef.current.delete(selectedModelName);
      setRouteFlowLoadingByModel((current) => ({ ...current, [selectedModelName]: false }));
    };
  }, [selectedModelName]);

  /* ---- derived: brand list ---- */
  const brandList = useMemo(() => {
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
    return { list, otherCount };
  }, [data.models]);

  /* ---- derived: site list ---- */
  const siteMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const model of data.models) {
      for (const a of model.accounts) {
        m.set(a.site, (m.get(a.site) || 0) + 1);
      }
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data.models]);

  /* ---- filtered ---- */
  const filteredModels = useMemo(() => {
    let list = data.models;

    if (activeBrand) {
      if (activeBrand === '__other__') {
        list = list.filter(m => !getBrand(m.name));
      } else {
        list = list.filter(m => getBrand(m.name)?.name === activeBrand);
      }
    }

    if (activeSite) {
      list = list.filter(m => m.accounts.some(a => a.site === activeSite));
    }

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(m => m.name.toLowerCase().includes(q));
    }

    return list;
  }, [data.models, search, activeSite, activeBrand]);

  // Keep expanded detail consistent with filters (especially site filter).
  // The list-level filter uses "model has at least one account on this site" semantics;
  // once a model is shown, its detail should honor the active site as well.
  const detailModels = useMemo(() => {
    const scopedModels = activeSite ? filteredModels.map((model) => {
      const accounts = model.accounts.filter((account) => account.site === activeSite);
      const pricingSources = model.pricingSources.filter((source) => source.siteName === activeSite);
      const latencyValues = accounts
        .map((account) => account.latency)
        .filter(isKnownLatency);
      return {
        ...model,
        accounts,
        pricingSources,
        accountCount: accounts.length,
        tokenCount: accounts.reduce((sum, account) => sum + account.tokens.length, 0),
        avgLatency: latencyValues.length > 0
          ? Math.round(latencyValues.reduce((sum, latency) => sum + latency, 0) / latencyValues.length)
          : null,
      };
    }) : filteredModels;

    return [...scopedModels].sort((a, b) => compareModels(a, b, sortBy, sortDir));
  }, [filteredModels, activeSite, sortBy, sortDir]);

  /* ---- pagination ---- */
  const totalPages = Math.max(1, Math.ceil(detailModels.length / pageSize));
  const safePageVal = Math.min(page, totalPages);
  const paged = detailModels.slice((safePageVal - 1) * pageSize, safePageVal * pageSize);

  useEffect(() => { setPage(1); }, [search, activeSite, activeBrand, pageSize]);

  const selectedModel = useMemo(() => (
    selectedModelName ? detailModels.find((model) => model.name === selectedModelName) ?? null : null
  ), [detailModels, selectedModelName]);

  useEffect(() => {
    if (!selectedModelName) return;
    if (selectedModel) return;
    const params = new URLSearchParams(location.search);
    params.delete('model');
    params.delete('node');
    navigate({ pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : '' }, { replace: true });
  }, [location.pathname, location.search, navigate, selectedModel, selectedModelName]);

  const selectedDetails = useMemo(() => {
    if (!selectedModel) return null;
    return buildModelDetailsView({
      model: selectedModel,
      brandName: getBrand(selectedModel.name)?.name ?? null,
      routeFlow: routeFlowByModel[selectedModel.name] ?? null,
      routeFlowLoading: !!routeFlowLoadingByModel[selectedModel.name],
      routeFlowError: routeFlowErrorByModel[selectedModel.name] || '',
      metadataHydrating,
    });
  }, [metadataHydrating, routeFlowByModel, routeFlowErrorByModel, routeFlowLoadingByModel, selectedModel]);

  /* ---- stats ---- */
  const totalCoverageSlots = detailModels.reduce((s, m) => s + m.accountCount, 0);
  const uniqueAccountCount = (() => {
    const ids = new Set<number>();
    for (const model of detailModels) {
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
            <Button type="button" variant="ghost" size="sm" onClick={() => setActiveBrand(null)}>
              {tr('pages.models.reset')}
            </Button>
          ) : null}
        </div>
        <Button
          type="button"
          variant={!activeBrand ? 'secondary' : 'ghost'}
          className="w-full justify-start gap-2"
          onClick={() => setActiveBrand(null)}
        >
          <Check className="size-4" />
          <span className="min-w-0 flex-1 truncate text-left">{tr('pages.models.allBrands')}</span>
          <ToneBadge tone="-muted">{data.models.length}</ToneBadge>
        </Button>
        {brandList.list.map(([brandName, { count, brand }]) => (
          <Button
            key={brandName}
            type="button"
            variant={activeBrand === brandName ? 'secondary' : 'ghost'}
            className="w-full justify-start gap-2"
            onClick={() => setActiveBrand(activeBrand === brandName ? null : brandName)}
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
            onClick={() => setActiveBrand(activeBrand === '__other__' ? null : '__other__')}
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
            <Button type="button" variant="ghost" size="sm" onClick={() => setActiveSite(null)}>
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
            onClick={() => setActiveSite(activeSite === site ? null : site)}
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
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={tr('pages.modelTester.searchModelSupportsNameFragments')}
      />
      <div className="flex flex-wrap items-center gap-2">
        <ToneBadge tone="-info">{tr('pages.models.total')} {filteredModels.length} {tr('pages.models.models2')}</ToneBadge>
        <ToneBadge tone="-muted">{tr('pages.models.coverageTier')} {totalCoverageSlots}</ToneBadge>
        <ToneBadge tone="-muted">{tr('pages.models.uniqueAccounts')} {uniqueAccountCount}</ToneBadge>
      </div>
      {filterControls}
      <div className="grid gap-2">
        {detailModels.length === 0 ? (
          <EmptyStateBlock title={tr('pages.models.noModelYet')} description={tr('pages.models.checkSiteAccountStatusFirstThenRefresh')} />
        ) : paged.map((model) => {
          const selected = selectedModelName === model.name;
          const sites = model.accounts.map((account) => account.site).filter((value, index, array) => array.indexOf(value) === index);
          return (
            <Button
              key={model.name}
              type="button"
              variant={selected ? 'secondary' : 'outline'}
              className="h-auto min-w-0 justify-start p-3 text-left"
              onClick={() => selectModel(model.name)}
            >
              <div className="flex min-w-0 items-start gap-2">
                <BrandIcon model={model.name} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-sm font-semibold">{model.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{getBrand(model.name)?.name || 'unknown'}</span>
                    <span>·</span>
                    <span>{formatLatency(model.avgLatency)}</span>
                    <span>·</span>
                    <span>{model.successRate == null ? 'unknown' : `${model.successRate}%`}</span>
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
      {filteredModels.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  type="button"
                  disabled={safePageVal <= 1}
                  onClick={() => setPage(p => p - 1)}
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
                  onClick={() => setPage(p => p + 1)}
                  aria-label={tr('pages.models.nextPage')}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
          <Select value={String(pageSize)} onValueChange={(nextValue) => setPageSize(Number(nextValue))}>
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
  if (loading) {
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
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
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
                {tr('pages.models.total')} {filteredModels.length} {tr('pages.models.models2')}
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
            {metadataHydrating && (
              <ToneBadge tone="-muted">{tr('pages.models.loadingMetadata')}</ToneBadge>
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

        <EntityWorkspaceLayout
          index={modelIndexContent}
          workspace={(
            <ModelDetailsWorkspace
              details={selectedDetails}
              tab={workspaceTab}
              onTabChange={(nextTab) => updateRouteParams({ tab: nextTab })}
              range={workspaceRange}
              onRangeChange={(nextRange) => updateRouteParams({ range: nextRange })}
              routingViewMode={routingViewMode}
              onRoutingViewModeChange={(nextMode) => updateRouteParams({ routingView: nextMode })}
              siteIdByName={siteIdByName}
              metadataHydrating={metadataHydrating}
              onCopyModel={copyName}
              onRefresh={handleRefresh}
              onCopyJson={(text) => {
                navigator.clipboard.writeText(text).catch(() => {});
              }}
            />
          )}
          inspector={<ModelInspector details={selectedDetails} />}
          mobile={isMobile}
        />
      </div>
    </div>
  );
}
