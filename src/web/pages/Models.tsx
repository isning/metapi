import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api.js';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Filter,
  KeyRound,
  List,
  RefreshCw,
  Table2,
  Users,
} from 'lucide-react';
import { BrandGlyph, getBrand, BrandIcon, type BrandInfo } from '../components/BrandIcon.js';
import ModelRouteFlow, { type ModelRouteFlowData } from '../components/ModelRouteFlow.js';
import SiteBadgeLink from '../components/SiteBadgeLink.js';
import SearchInput from '../components/SearchInput.js';
import EmptyStateBlock from '../components/EmptyStateBlock.js';
import { useToast } from '../components/Toast.js';
import ResponsiveFilterPanel from '../components/ResponsiveFilterPanel.js';
import { useAnimatedVisibility } from '../components/useAnimatedVisibility.js';
import { useIsMobile } from '../components/useIsMobile.js';
import { mergeMarketplaceMetadata, shouldHydrateMarketplaceMetadata } from './helpers/modelsMarketplaceMetadata.js';
import { tr } from '../i18n.js';
import { Button } from '../components/ui/button/index.js';
import { ButtonGroup } from '../components/ui/button-group/index.js';
import { Skeleton } from '../components/ui/skeleton/index.js';
import ToneBadge from '../components/ToneBadge.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card/index.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select/index.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table/index.js';

type SortColumn = 'name' | 'accountCount' | 'tokenCount' | 'avgLatency' | 'successRate';
type ViewMode = 'card' | 'table';

interface ModelTokenInfo {
  id: number;
  name: string;
  isDefault: boolean;
}

interface ModelGroupPricing {
  quotaType: number;
  inputPerMillion?: number;
  outputPerMillion?: number;
  perCallInput?: number;
  perCallOutput?: number;
  perCallTotal?: number;
}

interface ModelPricingSource {
  siteId: number;
  siteName: string;
  accountId: number;
  username: string | null;
  ownerBy: string | null;
  enableGroups: string[];
  groupPricing: Record<string, ModelGroupPricing>;
}

interface ModelAccountInfo {
  id: number;
  site: string;
  username: string | null;
  latency: number | null;
  balance: number;
  tokens: ModelTokenInfo[];
}

interface ModelRow {
  name: string;
  accountCount: number;
  tokenCount: number;
  avgLatency: number | null;
  successRate: number | null;
  description: string | null;
  tags: string[];
  supportedEndpointTypes: string[];
  pricingSources: ModelPricingSource[];
  accounts: ModelAccountInfo[];
}

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

function getLatencyBadgeClass(latency: number | null) {
  if (!isKnownLatency(latency)) return 'muted';
  if (latency >= 3000) return 'error';
  if (latency >= 1000) return 'warning';
  return 'success';
}

function formatLatency(latency: number | null): string {
  return isKnownLatency(latency) ? `${latency}ms` : '—';
}

function getSuccessBadgeClass(rate: number | null) {
  if (rate == null) return 'muted';
  if (rate >= 90) return 'success';
  if (rate >= 60) return 'warning';
  return 'error';
}

function resolveMarketplaceDescription(model: ModelRow, metadataHydrating: boolean): string {
  if (model.description && model.description.trim().length > 0) return model.description;
  if (metadataHydrating) return tr('正在加载模型元数据...');

  const hasOtherMetadata = model.tags.length > 0 || model.supportedEndpointTypes.length > 0 || model.pricingSources.length > 0;
  if (hasOtherMetadata) return tr('上游未提供描述文本，但已同步标签、能力或价格信息。');
  return tr('当前上游仅返回模型 ID，未返回描述字段。');
}

function renderGroupPricingValue(pricing: ModelGroupPricing): string {
  if (pricing.quotaType === 0) {
    return `${pricing.inputPerMillion ?? 0}/${pricing.outputPerMillion ?? 0} USD / 1M`;
  }

  if (pricing.perCallInput != null || pricing.perCallOutput != null) {
    return `${pricing.perCallInput ?? 0}/${pricing.perCallOutput ?? 0} USD / call`;
  }

  return `${pricing.perCallTotal ?? 0} USD / call`;
}

const PAGE_SIZES = [10, 20, 50];
const SORT_OPTIONS: Array<{ key: SortColumn; label: string }> = [
  { key: 'accountCount', label: tr('账号数') },
  { key: 'tokenCount', label: tr('令牌数') },
  { key: 'avgLatency', label: tr('延迟') },
  { key: 'successRate', label: tr('成功率') },
  { key: 'name', label: tr('名称') },
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

function MetricText({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      {label}
      <span className="font-medium text-foreground">{value}</span>
    </span>
  );
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
      {model.successRate != null && model.successRate >= 90 ? <ToneBadge tone="-success">{tr('健康')}</ToneBadge> : null}
      {model.successRate != null && model.successRate < 60 ? <ToneBadge tone="-warning">{tr('风险')}</ToneBadge> : null}
      {isKnownLatency(model.avgLatency) && model.avgLatency <= 500 ? <ToneBadge tone="-success">{tr('低延迟')}</ToneBadge> : null}
    </div>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {children}
      </CardContent>
    </Card>
  );
}

/* ---- component ---- */
export default function Models() {
  const toast = useToast();
  const [data, setData] = useState<ModelsMarketplaceResponse>({ models: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortColumn>('accountCount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [activeSite, setActiveSite] = useState<string | null>(null);
  const [activeBrand, setActiveBrand] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [copied, setCopied] = useState<string | null>(null);
  const [filterCollapsed, setFilterCollapsed] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [metadataHydrating, setMetadataHydrating] = useState(false);
  const [routeFlowByModel, setRouteFlowByModel] = useState<Record<string, ModelRouteFlowData | null>>({});
  const [routeFlowLoadingByModel, setRouteFlowLoadingByModel] = useState<Record<string, boolean>>({});
  const [routeFlowErrorByModel, setRouteFlowErrorByModel] = useState<Record<string, string>>({});
  const isMobile = useIsMobile();
  const filterPanelPresence = useAnimatedVisibility(!isMobile && !filterCollapsed, 220);
  const latestPrimaryRequestRef = useRef(0);
  const latestMetadataRequestRef = useRef(0);
  const requestedRouteFlowModelsRef = useRef(new Set<string>());
  const location = useLocation();
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
          toast.info(tr('模型广场刷新进行中'));
        } else if (next.meta.refreshQueued) {
          toast.info(tr('已开始刷新模型广场'));
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
    if (!isMobile) return;
    if (viewMode !== 'card') {
      setViewMode('card');
    }
    if (!filterCollapsed) {
      setFilterCollapsed(true);
    }
  }, [filterCollapsed, isMobile, viewMode]);

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
    if (!expanded) return;
    if (requestedRouteFlowModelsRef.current.has(expanded)) return;

    let cancelled = false;
    requestedRouteFlowModelsRef.current.add(expanded);
    setRouteFlowLoadingByModel((current) => ({ ...current, [expanded]: true }));
    setRouteFlowErrorByModel((current) => ({ ...current, [expanded]: '' }));
    void api.getModelRouteFlow(expanded)
      .then((result) => {
        if (cancelled) return;
        setRouteFlowByModel((current) => ({
          ...current,
          [expanded]: (result as { flow?: ModelRouteFlowData }).flow || null,
        }));
      })
      .catch((error) => {
        if (cancelled) return;
        setRouteFlowByModel((current) => ({ ...current, [expanded]: null }));
        requestedRouteFlowModelsRef.current.delete(expanded);
        setRouteFlowErrorByModel((current) => ({
          ...current,
          [expanded]: error instanceof Error ? error.message : tr('加载路由流程失败。'),
        }));
      })
      .finally(() => {
        if (!cancelled) {
          setRouteFlowLoadingByModel((current) => ({ ...current, [expanded]: false }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [expanded]);

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
  const latencyMetrics = detailModels
    .map((model) => model.avgLatency)
    .filter(isKnownLatency);
  const avgLatency = latencyMetrics.length > 0
    ? Math.round(latencyMetrics.reduce((sum, latency) => sum + latency, 0) / latencyMetrics.length)
    : null;

  /* ---- copy ---- */
  const copyName = (name: string) => {
    navigator.clipboard.writeText(name).catch(() => { });
    setCopied(name);
    setTimeout(() => setCopied(null), 1500);
  };

  const renderAccountCards = (model: ModelRow) => (
    <div className="grid gap-2">
      <div className="text-sm font-medium text-muted-foreground">{tr('账号明细')}</div>
      {model.accounts.map((account) => (
        <Card key={account.id}>
          <CardContent className="grid gap-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SiteBadgeLink siteId={siteIdByName.get(account.site)} siteName={account.site} badgeClassName="info" />
              <span className="text-xs text-muted-foreground">{account.username || `ID:${account.id}`}</span>
            </div>
            <div className="grid gap-2 text-xs">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">{tr('延迟')}</span>
                <ToneBadge tone={getLatencyBadgeClass(account.latency)}>
                  {account.latency != null ? `${account.latency}ms` : '—'}
                </ToneBadge>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">{tr('余额')}</span>
                <span className="font-mono">${(account.balance || 0).toFixed(2)}</span>
              </div>
              <div className="grid gap-1">
                <span className="text-muted-foreground">{tr('令牌')}</span>
                <div className="flex flex-wrap gap-1">
                  {account.tokens.length > 0 ? account.tokens.map((token) => (
                    <ToneBadge tone={token.isDefault ? 'success' : 'muted'} key={token.id}>{token.name}</ToneBadge>
                  )) : <span className="text-muted-foreground">—</span>}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );

  const renderAccountsTable = (model: ModelRow) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{tr('站点')}</TableHead>
          <TableHead>{tr('账号')}</TableHead>
          <TableHead>{tr('令牌')}</TableHead>
          <TableHead>{tr('延迟')}</TableHead>
          <TableHead>{tr('余额')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {model.accounts.map((account) => (
          <TableRow key={account.id}>
            <TableCell>
              <SiteBadgeLink siteId={siteIdByName.get(account.site)} siteName={account.site} badgeClassName="info" />
            </TableCell>
            <TableCell className="text-xs">{account.username || `ID:${account.id}`}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {account.tokens.length > 0 ? account.tokens.map((token) => (
                  <ToneBadge tone={token.isDefault ? 'success' : 'muted'} key={token.id}>{token.name}</ToneBadge>
                )) : <span className="text-muted-foreground">—</span>}
              </div>
            </TableCell>
            <TableCell>
              <ToneBadge tone={getLatencyBadgeClass(account.latency)}>
                {account.latency != null ? `${account.latency}ms` : '—'}
              </ToneBadge>
            </TableCell>
            <TableCell className="font-mono text-xs">${(account.balance || 0).toFixed(2)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const renderModelDetails = (model: ModelRow) => (
    <div className="grid gap-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard title={tr('基础信息')}>
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">
              {resolveMarketplaceDescription(model, metadataHydrating)}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {model.tags.length > 0 ? model.tags.map((tag) => (
                <ToneBadge tone="-info" key={tag}>{tag}</ToneBadge>
              )) : <ToneBadge tone="-muted">{metadataHydrating ? tr('加载元数据中...') : tr('暂无标签')}</ToneBadge>}
            </div>
          </div>
        </SectionCard>

        <SectionCard title={tr('接口能力')}>
          <div className="flex flex-wrap gap-1.5">
            {model.supportedEndpointTypes.length > 0 ? model.supportedEndpointTypes.map((endpoint) => (
              <ToneBadge tone="-success" key={endpoint}>{endpoint}</ToneBadge>
            )) : <ToneBadge tone="-muted">{metadataHydrating ? tr('加载元数据中...') : tr('未提供')}</ToneBadge>}
          </div>
        </SectionCard>
      </div>

      <SectionCard title={tr('分组计费')}>
        {model.pricingSources.length > 0 ? (
          <div className="grid gap-2">
            {model.pricingSources.map((source) => (
              <Card key={`${source.siteId}-${source.accountId}`}>
                <CardContent className="grid gap-2 p-3">
                  <div className="text-sm">
                    <SiteBadgeLink siteId={source.siteId} siteName={source.siteName} /> · {source.username || `ID:${source.accountId}`}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(source.groupPricing).map(([group, pricing]) => (
                      <ToneBadge tone="-info" key={group}>
                        {group}: {renderGroupPricingValue(pricing)}
                      </ToneBadge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <ToneBadge tone="-muted">{metadataHydrating ? tr('正在加载价格元数据...') : tr('暂无价格元数据')}</ToneBadge>
        )}
      </SectionCard>

      <SectionCard title={tr('路由流程')}>
        <ModelRouteFlow
          flow={routeFlowByModel[model.name] ?? null}
          loading={!!routeFlowLoadingByModel[model.name]}
          error={routeFlowErrorByModel[model.name] || ''}
        />
      </SectionCard>

      {isMobile ? renderAccountCards(model) : renderAccountsTable(model)}
    </div>
  );

  const filterControls = (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">{tr('品牌')}</div>
          {activeBrand ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setActiveBrand(null)}>
              {tr('重置')}
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
          <span className="min-w-0 flex-1 truncate text-left">{tr('全部品牌')}</span>
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
            <span className="min-w-0 flex-1 truncate text-left">{tr('其他')}</span>
            <ToneBadge tone="-muted">{brandList.otherCount}</ToneBadge>
          </Button>
        )}
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">{tr('供应商')}</div>
          {activeSite ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setActiveSite(null)}>
              {tr('重置')}
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
        <div className="text-sm font-medium">{tr('排序方式')}</div>
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
                  {tr('筛选')}
                </Button>
              )}
            </div>
          </div>
          <ResponsiveFilterPanel
            isMobile={isMobile}
            mobileOpen={showFilters}
            onMobileClose={() => setShowFilters(false)}
            mobileTitle={tr('筛选模型')}
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
      {!isMobile && filterPanelPresence.shouldRender && (
        <Card className={`w-60 shrink-0 ${filterPanelPresence.isVisible ? '' : 'opacity-0'}`.trim()}>
          <CardContent className="grid gap-4 p-3">
            {filterControls}
            <Button type="button" variant="outline" onClick={() => setFilterCollapsed(true)}>
              {tr('收起')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ====== RIGHT: Content Area ====== */}
      <div className="min-w-0 flex-1">
        {/* Header */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              {activeBrand || activeSite || tr('模型广场')}
              <ToneBadge tone="-info">
                {tr('共')} {filteredModels.length} {tr('个模型')}
              </ToneBadge>
            </h2>
            {(activeBrand || activeSite) && (
              <p className="mt-1 text-xs text-muted-foreground">
                {activeBrand && activeBrand !== '__other__' ? `${tr('查看')} ${activeBrand} ${tr('品牌的所有模型')}` : activeSite ? `${tr('来自供应商')} ${activeSite} ${tr('的模型')}` : tr('其他未归类的模型')}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(isMobile || filterCollapsed) && (
              <Button type="button" variant="outline"
                onClick={() => {
                  if (isMobile) {
                    setShowFilters(true);
                    return;
                  }
                  setFilterCollapsed(false);
                }}
              >
                <Filter className="size-4" />
                {tr('筛选')}
              </Button>
            )}
            <Button type="button" variant="outline" size="icon" onClick={handleRefresh} aria-label={tr('刷新')}>
              <RefreshCw className="size-4" />
            </Button>
            {metadataHydrating && (
              <ToneBadge tone="-muted">{tr('加载元数据中...')}</ToneBadge>
            )}
            {!isMobile && (
              <ButtonGroup>
                <Button type="button" variant={viewMode === 'card' ? 'secondary' : 'outline'} size="icon" onClick={() => setViewMode('card')} aria-label={tr('卡片视图')}>
                  <List className="size-4" />
                </Button>
                <Button type="button" variant={viewMode === 'table' ? 'secondary' : 'outline'} size="icon" onClick={() => setViewMode('table')} aria-label={tr('表格视图')}>
                  <Table2 className="size-4" />
                </Button>
              </ButtonGroup>
            )}
          </div>
        </div>

        <ResponsiveFilterPanel
          isMobile={isMobile}
          mobileOpen={showFilters}
          onMobileClose={() => setShowFilters(false)}
          mobileTitle={tr('筛选模型')}
          mobileContent={filterControls}
        />

        {/* Toolbar */}
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput
            className="w-full lg:max-w-md"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={tr('搜索模型（支持名称片段）')}
          />
          {/* Quick stats */}
          <div className="flex flex-wrap items-center gap-4">
            <MetricText label={tr('覆盖档位')} value={totalCoverageSlots} />
            <MetricText label={tr('去重账号')} value={uniqueAccountCount} />
            <MetricText label={tr('平均延迟')} value={<ToneBadge tone={getLatencyBadgeClass(avgLatency)}>{formatLatency(avgLatency)}</ToneBadge>} />
          </div>
        </div>

        {/* Empty */}
        {detailModels.length === 0 ? (
          <EmptyStateBlock title={tr('暂无模型结果')} description={tr('请先检查站点与账号状态，然后点击刷新。')} />
        ) : viewMode === 'card' ? (
          <div className="grid gap-3">
            {paged.map((model) => {
              const isExpanded = expanded === model.name;
              const sites = model.accounts.map((account) => account.site).filter((value, index, array) => array.indexOf(value) === index);
              return (
                <Card key={model.name} role="button" tabIndex={0} onClick={() => setExpanded(isExpanded ? null : model.name)} onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setExpanded(isExpanded ? null : model.name);
                  }
                }}>
                  <CardHeader className="flex-row items-start gap-3 space-y-0">
                    <BrandIcon model={model.name} size={44} />
                    <div className="min-w-0 flex-1">
                      <CardTitle className="truncate text-base">{model.name}</CardTitle>
                      <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1"><Users className="size-3" />{model.accountCount} {tr('个账号')}</span>
                        <span className="inline-flex items-center gap-1"><KeyRound className="size-3" />{model.tokenCount} {tr('令牌')}</span>
                        <ToneBadge tone={getLatencyBadgeClass(model.avgLatency)}>{tr('延迟')} {formatLatency(model.avgLatency)}</ToneBadge>
                        <ToneBadge tone={getSuccessBadgeClass(model.successRate)}>{tr('成功率')} {model.successRate != null ? `${model.successRate}%` : '—'}</ToneBadge>
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                      <Button type="button" variant="outline" size="icon" aria-label={tr('复制模型名')} onClick={() => copyName(model.name)}>
                        {copied === model.name ? <Check className="size-4" /> : <Copy className="size-4" />}
                      </Button>
                      <Button type="button" variant="outline" size="icon" aria-label={isExpanded ? tr('收起') : tr('展开')} onClick={() => setExpanded(isExpanded ? null : model.name)}>
                        <ChevronDown className={`size-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <ModelTags model={model} sites={sites} />
                    {isExpanded ? (
                      <div onClick={(event) => event.stopPropagation()}>
                        {renderModelDetails(model)}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12" />
                  <TableHead>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setSortBy('name'); setSortDir((direction) => direction === 'asc' ? 'desc' : 'asc'); }}>
                      {tr('模型名称')} <SortIndicator active={sortBy === 'name'} direction={sortDir} />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setSortBy('accountCount'); setSortDir((direction) => direction === 'asc' ? 'desc' : 'asc'); }}>
                      {tr('账号数')} <SortIndicator active={sortBy === 'accountCount'} direction={sortDir} />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setSortBy('tokenCount'); setSortDir((direction) => direction === 'asc' ? 'desc' : 'asc'); }}>
                      {tr('令牌数')} <SortIndicator active={sortBy === 'tokenCount'} direction={sortDir} />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setSortBy('avgLatency'); setSortDir((direction) => direction === 'asc' ? 'desc' : 'asc'); }}>
                      {tr('延迟')} <SortIndicator active={sortBy === 'avgLatency'} direction={sortDir} />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setSortBy('successRate'); setSortDir((direction) => direction === 'asc' ? 'desc' : 'asc'); }}>
                      {tr('成功率')} <SortIndicator active={sortBy === 'successRate'} direction={sortDir} />
                    </Button>
                  </TableHead>
                  <TableHead>{tr('操作')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((model) => {
                  const isExpanded = expanded === model.name;
                  return (
                    <React.Fragment key={model.name}>
                      <TableRow className="cursor-pointer" onClick={() => setExpanded(isExpanded ? null : model.name)}>
                        <TableCell><BrandIcon model={model.name} size={28} /></TableCell>
                        <TableCell><code className="rounded border px-2 py-1 text-xs">{model.name}</code></TableCell>
                        <TableCell><ToneBadge tone="-info">{model.accountCount}</ToneBadge></TableCell>
                        <TableCell><ToneBadge tone="-muted">{model.tokenCount}</ToneBadge></TableCell>
                        <TableCell><ToneBadge tone={getLatencyBadgeClass(model.avgLatency)}>{formatLatency(model.avgLatency)}</ToneBadge></TableCell>
                        <TableCell><ToneBadge tone={getSuccessBadgeClass(model.successRate)}>{model.successRate != null ? `${model.successRate}%` : '—'}</ToneBadge></TableCell>
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <Button type="button" variant="outline" size="icon" aria-label={tr('复制')} onClick={() => copyName(model.name)}>
                            {copied === model.name ? <Check className="size-4" /> : <Copy className="size-4" />}
                          </Button>
                        </TableCell>
                      </TableRow>
                      {isExpanded ? (
                        <TableRow>
                          <TableCell colSpan={7}>
                            {renderModelDetails(model)}
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}

        {/* Pagination */}
        {filteredModels.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <ButtonGroup>
              <Button type="button" variant="outline" size="icon" disabled={safePageVal <= 1} onClick={() => setPage(p => p - 1)} aria-label={tr('上一页')}>
                <ChevronLeft className="size-4" />
              </Button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 7) {
                  pageNum = i + 1;
                } else if (safePageVal <= 4) {
                  pageNum = i + 1;
                } else if (safePageVal >= totalPages - 3) {
                  pageNum = totalPages - 6 + i;
                } else {
                  pageNum = safePageVal - 3 + i;
                }
                return (
                  <Button type="button" variant={pageNum === safePageVal ? 'secondary' : 'outline'} key={pageNum} onClick={() => setPage(pageNum)}>
                    {pageNum}
                  </Button>
                );
              })}
              <Button type="button" variant="outline" size="icon" disabled={safePageVal >= totalPages} onClick={() => setPage(p => p + 1)} aria-label={tr('下一页')}>
                <ChevronRight className="size-4" />
              </Button>
            </ButtonGroup>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{tr('每页条数')}</span>
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
          </div>
        )}
      </div>
    </div>
  );
}
