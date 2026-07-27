import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Ban,
  CheckCheck,
  CircleOff,
  Copy,
  Download,
  Filter,
  LoaderCircle,
  ListChecks,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import type { RouteGroupManagementListItem } from "../../../shared/routeGroupManagement.js";
import type { DispatchPolicyRegistryPayload } from "../../api.js";
import {
  BrandGlyph,
  InlineBrandIcon,
  getBrand,
} from "../../components/BrandIcon.js";
import EmptyStateBlock from "../../components/EmptyStateBlock.js";
import { MobileCard, MobileField } from "../../components/MobileCard.js";
import ResponsiveFilterPanel from "../../components/ResponsiveFilterPanel.js";
import SegmentedTabBar from "../../components/SegmentedTabBar.js";
import { Badge } from "../../components/ui/badge/index.js";
import { Button } from "../../components/ui/button/index.js";
import { ButtonGroup } from "../../components/ui/button-group/index.js";
import { Card } from "../../components/ui/card/index.js";
import { Checkbox } from "../../components/ui/checkbox/index.js";
import * as Dialog from "../../components/ui/dialog/index.js";
import { Input } from "../../components/ui/input/index.js";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "../../components/ui/pagination/index.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select/index.js";
import { Skeleton } from "../../components/ui/skeleton/index.js";
import { Switch } from "../../components/ui/switch/index.js";
import ToneBadge from "../../components/ToneBadge.js";
import { useIsMobile } from "../../components/useIsMobile.js";
import { tr } from "../../i18n.js";
import RouteFilterBar from "./RouteFilterBar.js";
import { RouteGroupEditorDialog } from './RouteGroupEditorDialog.js';
import { RouteGroupDetail } from './RouteGroupDetail.js';
import {
  ROUTE_GROUP_PAGE_SIZES,
  useRouteGroupWorkspaceResource,
  type RouteGroupTab as GroupTab,
} from './useRouteGroupWorkspaceResource.js';
import {
  labelForRouteGroup as labelForGroup,
  routeGroupBrand as groupBrand,
  routeGroupPolicyLabel as policyLabel,
  routeGroupModelName as groupModelName,
} from './routeGroupPresentation.js';
export { fallbackStageCollisionDetection } from './routeGroupDnd.js';










const DESKTOP_DETAIL_ENTER_MS = 260;
const DESKTOP_DETAIL_COLLAPSE_MS = 200;


function routeGroupPageItems(
  page: number,
  totalPages: number,
): Array<{ type: "page"; page: number } | { type: "ellipsis"; key: string }> {
  if (totalPages <= 7)
    return Array.from({ length: totalPages }, (_, index) => ({
      type: "page" as const,
      page: index + 1,
    }));
  const pages = new Set(
    [1, totalPages, page - 1, page, page + 1].filter(
      (item) => item >= 1 && item <= totalPages,
    ),
  );
  const result: Array<
    { type: "page"; page: number } | { type: "ellipsis"; key: string }
  > = [];
  let previous = 0;
  for (const current of [...pages].sort((left, right) => left - right)) {
    if (current - previous > 1)
      result.push({ type: "ellipsis", key: `ellipsis-${previous}-${current}` });
    result.push({ type: "page", page: current });
    previous = current;
  }
  return result;
}


function RouteGroupBrowserLoadingSkeleton() {
  return (
    <div
      aria-busy="true"
      data-testid="route-group-browser-loading"
      className="grid gap-2"
    >
      <div className="flex flex-col gap-3 border-b bg-muted/30 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex max-w-full gap-0 overflow-hidden rounded-md">
          <Skeleton className="h-8 w-28 rounded-r-none" />
          <Skeleton className="h-8 w-28 rounded-none" />
          <Skeleton className="h-8 w-28 rounded-l-none" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-5 w-28 rounded-full" />
        </div>
      </div>
      <div className="flex flex-col gap-2 p-3 xl:flex-row">
        <Skeleton className="h-9 min-w-0 flex-1" />
        <div className="flex flex-wrap gap-1.5">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-10" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
    </div>
  );
}

function RouteGroupListLoadingSkeleton({ isMobile }: { isMobile: boolean }) {
  if (isMobile)
    return (
      <div
        aria-busy="true"
        data-testid="route-group-list-loading"
        className="grid gap-2"
      >
        {[1, 2, 3, 4].map((item) => (
          <MobileCard
            key={item}
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
              <div className="flex justify-end gap-2">
                <Skeleton className="h-8 w-14" />
                <Skeleton className="h-8 w-14" />
              </div>
            </div>
          </MobileCard>
        ))}
      </div>
    );
  return (
    <div
      aria-busy="true"
      data-testid="route-group-list-loading"
      className="grid gap-2"
    >
      {[1, 2, 3, 4, 5, 6, 7].map((item) => (
        <div key={item} className="rounded-md border bg-card p-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="grid min-w-0 flex-1 gap-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-48 max-w-full" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
              <Skeleton className="h-3 w-64 max-w-full" />
              <div className="flex gap-1.5">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </div>
            <div className="flex gap-1">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="size-8" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Preserve the original detail-card lifecycle while Route Group data reloads. */
function DesktopRouteGroupDetailPresence({
  open,
  children,
}: {
  open: boolean;
  children: (closing: boolean) => ReactNode;
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
      const timerId = globalThis.setTimeout(
        () => setIsEntering(false),
        DESKTOP_DETAIL_ENTER_MS,
      );
      return () => globalThis.clearTimeout(timerId);
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
      className={`route-detail-panel-presence ${isOpen ? "is-open" : ""} ${isEntering ? "is-entering" : ""} ${isClosing ? "is-closing" : ""}`.trim()}
    >
      {children(isClosing)}
    </div>
  );
}

/**
 * Native Route Group presentation copied from the original collapsed RouteCard
 * structure. The view model is deliberately limited to management data; Graph
 * identities remain behind the server-side "open in graph" operation.
 */
function RouteGroupSummaryCard({
  group,
  summaryExpanded,
  onToggleExpand,
  onToggleEnabled,
}: {
  group: RouteGroupManagementListItem;
  summaryExpanded: boolean;
  onToggleExpand: (groupId: string) => void;
  onToggleEnabled: (group: RouteGroupManagementListItem) => void;
}) {
  const title = labelForGroup(group);
  const modelName = groupModelName(group);
  const brand = groupBrand(group);
  const routePatternBadge =
    group.model.upstreamName && group.model.upstreamName !== title
      ? group.model.upstreamName
      : null;

  return (
    <Card
      className={`route-card-collapsed route--collapsed min-w-0 max-w-full ${summaryExpanded ? "is-active" : ""}`.trim()}
      onClick={() => onToggleExpand(group.id)}
      role="button"
      tabIndex={0}
      aria-expanded={summaryExpanded}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggleExpand(group.id);
        }
      }}
    >
      <div data-testid="collapsed-route-body" className="min-w-0">
        <div
          data-testid="collapsed-route-content"
          className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-left"
        >
          <div
            data-testid="collapsed-route-title-row"
            className="flex min-w-0 flex-[0_1_auto] flex-wrap items-center gap-1.5"
          >
            <span
              data-testid="collapsed-route-icon"
              className="inline-flex size-5 shrink-0 items-center justify-center"
            >
              {group.presentation.displayIcon ? (
                <BrandGlyph
                  icon={group.presentation.displayIcon}
                  alt={title}
                  size={18}
                  fallbackText={title}
                />
              ) : brand ? (
                <BrandGlyph
                  brand={brand}
                  alt={title}
                  size={18}
                  fallbackText={title}
                />
              ) : (
                <InlineBrandIcon model={modelName} size={18} />
              )}
            </span>
            <code className="min-w-0 truncate text-sm font-semibold text-foreground">
              {title}
            </code>
            {routePatternBadge ? (
              <ToneBadge
                tone="-muted"
                title={routePatternBadge}
                className="min-w-0 whitespace-normal break-all leading-snug"
              >
                {routePatternBadge}
              </ToneBadge>
            ) : null}
          </div>
          <div
            data-testid="collapsed-route-meta-row"
            className="ml-auto flex min-w-0 max-w-full flex-[0_1_auto] flex-wrap items-center justify-end gap-1.5"
          >
            <Button
              type="button"
              variant={group.enabled ? "secondary" : "outline"}
              size="sm"
              className="shrink-0"
              onClick={(event) => {
                event.stopPropagation();
                onToggleEnabled(group);
              }}
              data-tooltip={
                group.enabled
                  ? tr("pages.tokenRoutes.routeCard.disabledRoutes")
                  : tr("pages.tokenRoutes.routeCard.enabledRoutes")
              }
            >
              {group.enabled
                ? tr("pages.downstreamKeys.enabled")
                : tr("pages.downstreamKeys.disabled")}
            </Button>
            <ToneBadge tone="-info">
              {group.candidateCount} {tr("pages.tokenRoutes.candidates")}
            </ToneBadge>
            <ToneBadge
              tone="-muted"
              className="min-w-0 whitespace-normal break-words leading-snug"
            >
              {policyLabel(group.dispatcherPolicy)}
            </ToneBadge>
          </div>
        </div>
      </div>
    </Card>
  );
}

function RouteGroupDesktopDetailPanel({
  group,
  onSummaryChanged,
  onDeleted,
  onEdit,
  onOpenGraph,
  onCollapse,
  policyRegistry,
}: {
  group: RouteGroupManagementListItem;
  onSummaryChanged: () => void | Promise<void>;
  onDeleted: () => void;
  onEdit: () => void;
  onOpenGraph: () => void;
  onCollapse: () => void;
  policyRegistry: DispatchPolicyRegistryPayload | null;
}) {
  return (
    <section className="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)] content-start">
      <RouteGroupDetail
        group={group}
        onSummaryChanged={onSummaryChanged}
        onDeleted={onDeleted}
        onEdit={onEdit}
        onOpenGraph={onOpenGraph}
        onCollapse={onCollapse}
        policyRegistry={policyRegistry}
        showOpenGraphAction
      />
    </section>
  );
}

export default function RouteGroupWorkspace({
  onOpenGraph,
  refreshSignal = 0,
}: {
  onOpenGraph?: (groupId: string) => void;
  refreshSignal?: number;
}) {
  const {
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
  } = useRouteGroupWorkspaceResource(refreshSignal);
  const isMobile = useIsMobile();
  const routeFilterBrandList = useMemo(
    () =>
      (overview?.brands || []).flatMap((item) => {
        const resolved = getBrand(item.name);
        return resolved
          ? [
              [item.name, { count: item.count, brand: resolved }] as [
                string,
                { count: number; brand: typeof resolved },
              ],
            ]
          : [];
      }),
    [overview],
  );
  const totalPages = Math.max(1, Math.ceil(pageInfo.totalCount / pageSize));
  const safePage = Math.min(Math.max(1, pageInfo.page || page), totalPages);
  const pageItems = routeGroupPageItems(safePage, totalPages);
  const displayedStart =
    pageInfo.totalCount === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const displayedEnd = Math.min(pageInfo.totalCount, safePage * pageSize);
  const selectableGroups = groups;
  const batchVisibilityActions: Array<"set_public" | "set_internal"> =
    tab === "manual"
      ? ["set_public", "set_internal"]
      : [tab === "internal" ? "set_public" : "set_internal"];
  return (
    <div className="grid gap-3">
      <section className="grid gap-3">
        <div className="rounded-md border bg-card p-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">
              {tr("pages.tokenRoutes.routeWizard.title")}
            </div>
            <div className="mt-1 max-w-3xl text-xs text-muted-foreground">
              {initialLoading ? (
                <Skeleton className="h-4 w-72 max-w-full" />
              ) : (
                tr("pages.tokenRoutes.routeWizard.description")
              )}
            </div>
          </div>
        </div>
        <section className="overflow-hidden rounded-md border bg-card">
          {initialLoading ? <RouteGroupBrowserLoadingSkeleton /> : null}
          {!initialLoading ? (
            <>
              <div className="flex flex-col gap-3 border-b bg-muted/30 p-3 lg:flex-row lg:items-center lg:justify-between">
                <SegmentedTabBar<GroupTab>
                  value={tab}
                  onValueChange={setTab}
                  className="w-full lg:w-auto"
                  items={[
                    {
                      value: "public",
                      label: tr("pages.tokenRoutes.routeGroupTabs.external"),
                      count: overview?.tabs.public || 0,
                    },
                    {
                      value: "internal",
                      label: tr(
                        "pages.tokenRoutes.routeGroupTabs.internalGroup",
                      ),
                      count: overview?.tabs.internal || 0,
                    },
                    {
                      value: "manual",
                      label: tr("pages.tokenRoutes.routeGroupTabs.manual"),
                      count: overview?.tabs.manual || 0,
                    },
                  ]}
                />
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">
                    {tr("pages.tokenRoutes.routeBrowser.totalRoutes").replace(
                      "{count}",
                      String(pageInfo.totalCount),
                    )}
                  </Badge>
                  <Badge variant="secondary">
                    {tr("pages.tokenRoutes.routeBrowser.baseRoutes").replace(
                      "{count}",
                      String(pageCandidateCount),
                    )}
                  </Badge>
                  {tab === "manual" && (
                    <Button size="sm" onClick={() => setEditorGroup(null)}>
                      <Plus className="size-4" />
                      {tr("pages.tokenRoutes.createGroup")}
                    </Button>
                  )}
                </div>
              </div>
              <div className="grid gap-2 border-b p-3">
                <div className="flex flex-col gap-2 xl:flex-row">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="min-w-0 pr-8 pl-8"
                      value={query}
                      placeholder={tr("pages.tokenRoutes.searchRoutes")}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    {query && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="absolute right-0.5 top-1/2 size-7 -translate-y-1/2"
                        aria-label={tr(
                          "pages.tokenRoutes.routeBrowser.clearSearch",
                        )}
                        onClick={() => setQuery("")}
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Select
                      value={sortBy}
                      onValueChange={(value) => {
                        const next = value as typeof sortBy;
                        setSortDir(next === "name" ? "asc" : "desc");
                        setSortBy(next);
                      }}
                    >
                      <SelectTrigger className="h-9 w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="name">
                          {tr("pages.tokenRoutes.modelName")}
                        </SelectItem>
                        <SelectItem value="candidateCount">
                          {tr("pages.tokenRoutes.candidateCount")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setSortDir((current) =>
                          current === "asc" ? "desc" : "asc",
                        )
                      }
                    >
                      {sortDir === "asc" ? (
                        <ArrowDownAZ className="size-4" />
                      ) : (
                        <ArrowUpAZ className="size-4" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant={batchSelectMode ? "secondary" : "outline"}
                      onClick={() => {
                        setBatchSelectMode((current) => !current);
                        setSelectedIds(new Set());
                      }}
                    >
                      <ListChecks className="size-4" />
                      {tr("pages.tokenRoutes.actions")}
                    </Button>
                    {!isMobile && (
                      <Button
                        size="sm"
                        variant={filtersOpen ? "secondary" : "outline"}
                        onClick={() => setFiltersOpen((value) => !value)}
                      >
                        <Filter className="size-4" />
                        {tr("pages.tokenRoutes.filterroutes")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              {overview ? (
                <ResponsiveFilterPanel
                  isMobile={isMobile}
                  mobileOpen={filtersOpen}
                  onMobileOpen={() => setFiltersOpen(true)}
                  onMobileClose={() => setFiltersOpen(false)}
                  mobileTitle={tr("pages.tokenRoutes.filterroutes")}
                  mobileTriggerWrapperClassName=""
                  mobileTrigger={
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setFiltersOpen(true)}
                    >
                      <Filter className="size-4" />
                      {tr("pages.tokenRoutes.filterroutes")}
                    </Button>
                  }
                  mobileContent={
                    <RouteFilterBar
                      totalRouteCount={pageInfo.totalCount}
                      activeBrand={brand}
                      setActiveBrand={setBrand}
                      activeSite={site}
                      setActiveSite={setSite}
                      activeEndpointType={endpointType}
                      setActiveEndpointType={setEndpointType}
                      enabledFilter={enabled}
                      setEnabledFilter={setEnabled}
                      enabledCounts={overview.enabled}
                      brandList={{ list: routeFilterBrandList, otherCount: 0 }}
                      siteList={overview.sites.map((item) => [
                        item.name,
                        { count: item.count, siteId: 0 },
                      ])}
                      endpointTypeList={overview.endpointTypes.map((item) => [
                        item.name,
                        item.count,
                      ])}
                      collapsed={false}
                      onToggle={() => setFiltersOpen(false)}
                    />
                  }
                  desktopContent={
                    <RouteFilterBar
                      totalRouteCount={pageInfo.totalCount}
                      activeBrand={brand}
                      setActiveBrand={setBrand}
                      activeSite={site}
                      setActiveSite={setSite}
                      activeEndpointType={endpointType}
                      setActiveEndpointType={setEndpointType}
                      enabledFilter={enabled}
                      setEnabledFilter={setEnabled}
                      enabledCounts={overview.enabled}
                      brandList={{ list: routeFilterBrandList, otherCount: 0 }}
                      siteList={overview.sites.map((item) => [
                        item.name,
                        { count: item.count, siteId: 0 },
                      ])}
                      endpointTypeList={overview.endpointTypes.map((item) => [
                        item.name,
                        item.count,
                      ])}
                      collapsed={!filtersOpen}
                      onToggle={() => setFiltersOpen((current) => !current)}
                    />
                  }
                />
              ) : null}
            </>
          ) : null}
          {batchSelectMode && (
            <Card className="sticky top-[calc(var(--topbar-height)+0.5rem)] z-50 mb-2 flex flex-wrap items-center gap-2 p-2.5">
              <span className="text-sm font-medium tabular-nums">
                <ListChecks className="mr-1 inline size-4 text-primary" />
                {tr("pages.oAuthManagement.selected")} <b>{selectedIds.size}</b>{" "}
                / {selectableGroups.length} {tr("pages.tokenRoutes.groups")}
              </span>
              <ButtonGroup>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={batchUpdating}
                  onClick={() =>
                    setSelectedIds(
                      new Set(selectableGroups.map((group) => group.id)),
                    )
                  }
                >
                  {tr("pages.tokenRoutes.selectAll")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={batchUpdating}
                  onClick={() => setSelectedIds(new Set())}
                >
                  {tr("pages.accounts.cancelselectAll")}
                </Button>
              </ButtonGroup>
              <ButtonGroup className="ml-auto">
                {batchVisibilityActions.map((action) => (
                  <Button
                    key={action}
                    data-testid={`route-group-batch-${action.replace("_", "-")}`}
                    size="sm"
                    variant="outline"
                    disabled={!selectedIds.size || batchUpdating}
                    onClick={() => void batch(action)}
                  >
                    {batchUpdating ? (
                      <>
                        <LoaderCircle className="size-4 animate-spin" />
                        {tr("pages.downstreamKeys.processing")}
                      </>
                    ) : action === "set_public" ? (
                      <>
                        <Upload className="size-4" />
                        {tr("pages.tokenRoutes.setPublic")}
                      </>
                    ) : (
                      <>
                        <Download className="size-4" />
                        {tr("pages.tokenRoutes.setInternal")}
                      </>
                    )}
                  </Button>
                ))}
                <Button
                  data-testid="route-group-batch-disable"
                  size="sm"
                  variant="outline"
                  disabled={!selectedIds.size || batchUpdating}
                  onClick={() => void batch("disable")}
                >
                  {batchUpdating ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />
                      {tr("pages.downstreamKeys.processing")}
                    </>
                  ) : (
                    <>
                      <Ban className="size-4" />
                      {tr("common.disabled")}
                    </>
                  )}
                </Button>
                <Button
                  data-testid="route-group-batch-enable"
                  size="sm"
                  disabled={!selectedIds.size || batchUpdating}
                  onClick={() => void batch("enable")}
                >
                  {batchUpdating ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />
                      {tr("pages.downstreamKeys.processing")}
                    </>
                  ) : (
                    <>
                      <CheckCheck className="size-4" />
                      {tr("common.enabled")}
                    </>
                  )}
                </Button>
              </ButtonGroup>
            </Card>
          )}
          <div className="route-list-workbench-layout grid min-w-0 grid-cols-1 items-start gap-3 p-3 xl:grid-cols-[minmax(280px,0.82fr)_minmax(0,1.18fr)]">
            <section
              className={
                isMobile
                  ? "grid gap-2"
                  : "route-list-pane grid min-w-0 content-start gap-2"
              }
            >
              {listLoading ? (
                <RouteGroupListLoadingSkeleton isMobile={isMobile} />
              ) : groups.length ? (
                groups.map((group, index) => {
                  const selected = selectedIds.has(group.id);
                  const expanded = activeId === group.id;
                  if (isMobile) {
                    return (
                      <div
                        key={group.id}
                        className={`grid gap-2 animate-slide-up stagger-${Math.min(index + 1, 5)}`}
                      >
                        <MobileCard
                          title={labelForGroup(group)}
                          headerActions={
                            <div className="flex items-center gap-2">
                              {batchSelectMode && (
                                <label className="inline-flex cursor-pointer items-center gap-1 text-xs">
                                  <Checkbox
                                    data-testid={`route-select-${group.id}`}
                                    aria-label={tr(
                                      "pages.tokenRoutes.selectRouteAria",
                                    ).replace("{route}", labelForGroup(group))}
                                    checked={selected}
                                    onCheckedChange={(checked) =>
                                      setSelectedIds((old) => {
                                        const next = new Set(old);
                                        if (checked) next.add(group.id);
                                        else next.delete(group.id);
                                        return next;
                                      })
                                    }
                                  />
                                  <span>{tr("pages.tokenRoutes.select")}</span>
                                </label>
                              )}
                              <Badge
                                variant={
                                  !group.enabled
                                    ? "secondary"
                                    : "default"
                                }
                              >
                                {group.enabled
                                  ? tr("pages.downstreamKeys.enabled")
                                  : tr("pages.downstreamKeys.disabled")}
                              </Badge>
                            </div>
                          }
                          footerActions={
                            <div className="flex flex-wrap items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleGroupExpanded(group.id)}
                              >
                                {expanded
                                  ? tr("pages.accounts.collapse")
                                  : tr("pages.accounts.details")}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditorGroup(group)}
                              >
                                {tr("pages.accounts.edit")}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => void toggleGroupEnabled(group)}
                              >
                                {group.enabled
                                  ? tr("pages.downstreamKeys.disabled")
                                  : tr("pages.downstreamKeys.enabled")}
                              </Button>
                            </div>
                          }
                        >
                          <MobileField
                            label={tr("components.modelAnalysisPanel.model")}
                            value={groupModelName(group)}
                            stacked
                          />
                          <MobileField
                            label={tr("pages.tokenRoutes.candidateCount")}
                            value={group.candidateCount}
                          />
                          <MobileField
                            label={tr("pages.oAuthManagement.strategy")}
                            value={
                              policyLabel(group.dispatcherPolicy)
                            }
                          />
                          <MobileField
                            label={tr("components.notificationPanel.status")}
                            value={
                              group.enabled
                                ? tr("pages.downstreamKeys.enabled")
                                : tr("pages.downstreamKeys.disabled")
                            }
                          />
                          <MobileField
                            label={tr("pages.modelTester.mode")}
                            value={
                              group.kind === "automatic"
                                ? tr("pages.tokenRoutes.automatic")
                                : tr("pages.tokenRoutes.manual")
                            }
                          />
                        </MobileCard>
                        {expanded ? (
                          <RouteGroupDetail
                            group={group}
                            onSummaryChanged={revalidateVisiblePage}
                            onDeleted={() => {
                              setActiveId(null);
                              void revalidateVisiblePage();
                            }}
                            onEdit={() => setEditorGroup(group)}
                            onOpenGraph={() => onOpenGraph?.(group.id)}
                            onCollapse={() => setActiveId(null)}
                            policyRegistry={policyRegistry}
                            showOpenGraphAction
                          />
                        ) : null}
                      </div>
                    );
                  }
                  return batchSelectMode ? (
                    <div
                      key={group.id}
                      className={`flex min-w-0 items-stretch animate-slide-up stagger-${Math.min(index + 1, 5)}`}
                    >
                      <div className="flex min-w-0 items-stretch">
                        <div
                          onClick={() =>
                            setSelectedIds((old) => {
                              const next = new Set(old);
                              if (selected) next.delete(group.id);
                              else next.add(group.id);
                              return next;
                            })
                          }
                          className="flex min-h-full w-9 cursor-pointer items-center justify-center rounded-l-md border border-r-0"
                        >
                          <Checkbox
                            data-testid={`route-select-${group.id}`}
                            aria-label={tr(
                              "pages.tokenRoutes.selectRouteAria",
                            ).replace("{route}", labelForGroup(group))}
                            checked={selected}
                            onCheckedChange={(checked) =>
                              setSelectedIds((old) => {
                                const next = new Set(old);
                                if (checked) next.add(group.id);
                                else next.delete(group.id);
                                return next;
                              })
                            }
                            onClick={(event) => event.stopPropagation()}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <RouteGroupSummaryCard
                            group={group}
                            summaryExpanded={activeId === group.id}
                            onToggleExpand={toggleGroupExpanded}
                            onToggleEnabled={(item) =>
                              void toggleGroupEnabled(item)
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={group.id}
                      className={`min-w-0 animate-slide-up stagger-${Math.min(index + 1, 5)}`}
                    >
                      <RouteGroupSummaryCard
                        group={group}
                        summaryExpanded={activeId === group.id}
                        onToggleExpand={toggleGroupExpanded}
                        onToggleEnabled={(item) =>
                          void toggleGroupEnabled(item)
                        }
                      />
                    </div>
                  );
                })
              ) : (
                <EmptyStateBlock
                  className="min-h-72 rounded-md border bg-card"
                  icon={<CircleOff />}
                  title={
                    query || brand || site || endpointType || enabled !== "all"
                      ? tr("pages.tokenRoutes.noMatchingRoute")
                      : tr("pages.tokenRoutes.noRouteYet")
                  }
                  description={
                    query || brand || site || endpointType || enabled !== "all"
                      ? tr(
                          "pages.tokenRoutes.pleaseAdjustYourBrandFiltersSearchTerms",
                        )
                      : tr("pages.tokenRoutes.autoRebuildModelavailableRoutes")
                  }
                />
              )}
            </section>
            {!isMobile && (
              <section className="route-workbench min-w-0 self-start">
                {active ? (
                  <DesktopRouteGroupDetailPresence key={active.id} open>
                    {() => (
                      <RouteGroupDesktopDetailPanel
                        group={active}
                        onSummaryChanged={revalidateVisiblePage}
                        onDeleted={() => {
                          setActiveId(null);
                          void revalidateVisiblePage();
                        }}
                        onEdit={() => setEditorGroup(active)}
                        onOpenGraph={() => onOpenGraph?.(active.id)}
                        onCollapse={() => setActiveId(null)}
                        policyRegistry={policyRegistry}
                      />
                    )}
                  </DesktopRouteGroupDetailPresence>
                ) : (
                  <EmptyStateBlock
                    className="min-h-72 rounded-md border bg-muted/20"
                    icon={<Copy />}
                    title={tr("pages.tokenRoutes.selectRouteGroup")}
                  />
                )}
              </section>
            )}
          </div>
        </section>
      </section>
      {!listLoading && groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
          <div className="mr-auto text-xs text-muted-foreground">
            {tr("pages.tokenRoutes.routeBrowser.showingRoutes")
              .replace("{start}", String(displayedStart))
              .replace("{end}", String(displayedEnd))
              .replace("{total}", String(pageInfo.totalCount))}
          </div>
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  aria-label={tr("pages.models.previousPage")}
                />
              </PaginationItem>
              {pageItems.map((item) => (
                <PaginationItem
                  key={item.type === "page" ? `page-${item.page}` : item.key}
                >
                  {item.type === "ellipsis" ? (
                    <PaginationEllipsis />
                  ) : (
                    <PaginationLink
                      type="button"
                      isActive={item.page === safePage}
                      onClick={() => setPage(item.page)}
                    >
                      {item.page}
                    </PaginationLink>
                  )}
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                  aria-label={tr("pages.models.nextPage")}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{tr("pages.proxyLogs.rowsPerPageLabel")}</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => setPageSize(Number(value))}
            >
              <SelectTrigger className="w-24">
                <SelectValue placeholder={String(pageSize)} />
              </SelectTrigger>
              <SelectContent>
                {ROUTE_GROUP_PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      <RouteGroupEditorDialog
        open={editorGroup !== undefined}
        group={editorGroup || null}
        onClose={() => setEditorGroup(undefined)}
        onSaved={() => void revalidateVisiblePage()}
        policyRegistry={policyRegistry}
      />
    </div>
  );
}
