import { useCallback, useEffect, useRef, useState } from 'react';

import type { RouteGroupManagementListItem } from '../../../shared/routeGroupManagement.js';
import { api, type DispatchPolicyRegistryPayload } from '../../api.js';
import { useToast } from '../../components/Toast.js';
import { tr } from '../../i18n.js';
import { routeGroupCommandErrorMessage } from './routeGroupPresentation.js';

export type RouteGroupTab = 'public' | 'internal' | 'manual';
export type RouteGroupOverview = {
  brands: Array<{ name: string; count: number }>;
  sites: Array<{ name: string; count: number }>;
  endpointTypes: Array<{ name: string; count: number }>;
  tabs: Record<RouteGroupTab, number>;
  enabled: { enabled: number; disabled: number };
};

export const ROUTE_GROUP_PAGE_SIZES = [20, 40, 80, 120] as const;

export function useRouteGroupWorkspaceResource(refreshSignal: number) {
  const toast = useToast();
  const [tab, setTab] = useState<RouteGroupTab>('public');
  const [query, setQuery] = useState('');
  const [enabled, setEnabled] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [brand, setBrand] = useState<string | null>(null);
  const [site, setSite] = useState<string | null>(null);
  const [endpointType, setEndpointType] = useState<string | null>(null);
  const [overview, setOverview] = useState<RouteGroupOverview | null>(null);
  const [policyRegistry, setPolicyRegistry] = useState<DispatchPolicyRegistryPayload | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [batchSelectMode, setBatchSelectMode] = useState(false);
  const [sortBy, setSortBy] = useState<'candidateCount' | 'name'>('candidateCount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(ROUTE_GROUP_PAGE_SIZES[0]);
  const [groups, setGroups] = useState<RouteGroupManagementListItem[]>([]);
  const [pageInfo, setPageInfo] = useState<{
    page: number;
    pageSize: number;
    totalCount: number;
    hasMore: boolean;
  }>({
    page: 1,
    pageSize: ROUTE_GROUP_PAGE_SIZES[0],
    totalCount: 0,
    hasMore: false,
  });
  const [pageCandidateCount, setPageCandidateCount] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchUpdating, setBatchUpdating] = useState(false);
  const [editorGroup, setEditorGroup] = useState<RouteGroupManagementListItem | null | undefined>(undefined);
  const pageRequestIdRef = useRef(0);

  useEffect(() => {
    let active = true;
    void api.getRuntimeSettings()
      .then((settings) => {
        if (active) setPolicyRegistry(settings.dispatchPolicyRegistry || null);
      })
      .catch(() => {
        if (active) setPolicyRegistry(null);
      });
    return () => { active = false; };
  }, []);

  const fetchVisiblePage = useCallback(() => api.getRouteGroupPage({
    page,
    pageSize,
    q: query || undefined,
    tab,
    enabled,
    brand,
    site,
    endpointType,
    sortBy,
    sortDir,
  }), [brand, enabled, endpointType, page, pageSize, query, site, sortBy, sortDir, tab]);

  const applyVisiblePage = useCallback((result: Awaited<ReturnType<typeof api.getRouteGroupPage>>) => {
    setGroups(result.items);
    setPageInfo(result.pageInfo);
    setPageCandidateCount(
      result.summary?.candidateCount
      ?? result.items.reduce((total, group) => total + group.candidateCount, 0),
    );
    setSelectedIds((old) => new Set([...old].filter((id) => (
      result.items.some((group) => group.id === id)
    ))));
  }, []);

  const reportPageLoadError = useCallback((error: unknown) => {
    toast.error(error instanceof Error
      ? error.message
      : tr('pages.tokenRoutes.failedLoadRoutingConfiguration'));
  }, [toast]);

  const loadVisiblePage = useCallback(async () => {
    const requestId = ++pageRequestIdRef.current;
    setListLoading(true);
    try {
      const result = await fetchVisiblePage();
      if (requestId === pageRequestIdRef.current) applyVisiblePage(result);
    } catch (error) {
      if (requestId === pageRequestIdRef.current) reportPageLoadError(error);
    } finally {
      if (requestId === pageRequestIdRef.current) {
        setListLoading(false);
        setInitialLoading(false);
      }
    }
  }, [applyVisiblePage, fetchVisiblePage, reportPageLoadError]);

  const revalidateVisiblePage = useCallback(async () => {
    const requestId = ++pageRequestIdRef.current;
    try {
      const result = await fetchVisiblePage();
      if (requestId === pageRequestIdRef.current) applyVisiblePage(result);
    } catch (error) {
      if (requestId === pageRequestIdRef.current) reportPageLoadError(error);
    } finally {
      if (requestId === pageRequestIdRef.current) {
        setListLoading(false);
        setInitialLoading(false);
      }
    }
  }, [applyVisiblePage, fetchVisiblePage, reportPageLoadError]);

  useEffect(() => {
    const timeout = globalThis.setTimeout(() => { void loadVisiblePage(); }, 150);
    return () => globalThis.clearTimeout(timeout);
  }, [loadVisiblePage]);

  useEffect(() => {
    if (refreshSignal > 0) void revalidateVisiblePage();
  }, [refreshSignal, revalidateVisiblePage]);

  useEffect(() => {
    setPage(1);
  }, [tab, query, enabled, brand, site, endpointType, sortBy, sortDir, pageSize]);

  useEffect(() => {
    let active = true;
    void api.getRouteGroupOverview()
      .then((value) => {
        if (active) setOverview(value as RouteGroupOverview);
      })
      .catch(() => {
        if (active) setOverview(null);
      });
    return () => { active = false; };
  }, []);

  const batch = useCallback(async (action: 'enable' | 'disable' | 'set_internal' | 'set_public') => {
    const selectableIds = new Set(groups
      .map((group) => group.id));
    const ids = [...selectedIds].filter((id) => selectableIds.has(id));
    if (!ids.length) {
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
    if (!globalThis.confirm(tr('pages.tokenRoutes.batchRoutesConfirm')
      .replace('{action}', actionLabel)
      .replace('{count}', String(ids.length)))) return;
    setBatchUpdating(true);
    try {
      await api.batchUpdateRouteGroups({ ids, action });
      toast.success(tr('pages.tokenRoutes.batchRoutesComplete')
        .replace('{action}', actionLabel)
        .replace('{count}', String(ids.length)));
      setSelectedIds(new Set());
      setBatchSelectMode(false);
      const changesTab = tab !== 'manual' && (action === 'set_internal' || action === 'set_public');
      if (changesTab) setTab(action === 'set_internal' ? 'internal' : 'public');
      else await revalidateVisiblePage();
    } catch (error) {
      toast.error(routeGroupCommandErrorMessage(
        error,
        'pages.tokenRoutes.batchRoutesFailed',
      ).replace('{action}', actionLabel));
    } finally {
      setBatchUpdating(false);
    }
  }, [groups, revalidateVisiblePage, selectedIds, tab, toast]);

  const active = groups.find((group) => group.id === activeId) || null;
  const toggleGroupExpanded = useCallback((groupId: string) => {
    setActiveId((current) => current === groupId ? null : groupId);
  }, []);
  const toggleGroupEnabled = useCallback(async (group: RouteGroupManagementListItem) => {
    try {
      await api.updateRouteGroup(group.id, { enabled: !group.enabled });
      await revalidateVisiblePage();
    } catch (error) {
      toast.error(routeGroupCommandErrorMessage(error, 'pages.tokenRoutes.groupsfailed'));
    }
  }, [revalidateVisiblePage, toast]);

  return {
    active,
    activeId,
    batch,
    batchSelectMode,
    batchUpdating,
    brand,
    editorGroup,
    enabled,
    endpointType,
    filtersOpen,
    groups,
    initialLoading,
    listLoading,
    overview,
    page,
    pageCandidateCount,
    pageInfo,
    pageSize,
    policyRegistry,
    query,
    revalidateVisiblePage,
    selectedIds,
    setActiveId,
    setBatchSelectMode,
    setBrand,
    setEditorGroup,
    setEnabled,
    setEndpointType,
    setFiltersOpen,
    setPage,
    setPageSize,
    setQuery,
    setSelectedIds,
    setSite,
    setSortBy,
    setSortDir,
    setTab,
    site,
    sortBy,
    sortDir,
    tab,
    toggleGroupEnabled,
    toggleGroupExpanded,
  };
}
