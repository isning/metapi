import { type ReactNode } from 'react';
import { BrandGlyph, InlineBrandIcon, type BrandInfo } from '../../components/BrandIcon.js';
import { tr } from '../../i18n.js';
import { Button } from '../../components/ui/button/index.js';
import ToneBadge from '../../components/ToneBadge.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/collapsible/index.js';
import { CheckCircle2, ChevronDown, ChevronUp, CircleSlash2, RotateCcw, Server, SlidersHorizontal, Tags, Workflow, X } from 'lucide-react';

export type EnabledFilter = 'all' | 'enabled' | 'disabled';
function resolveEndpointTypeIconModel(endpointType: string): string | null {
  const normalized = endpointType.trim().toLowerCase();
  if (normalized === 'openai') return 'chatgpt';
  if (normalized === 'anthropic' || normalized === 'claude') return 'claude';
  if (normalized === 'gemini') return 'gemini';
  return null;
}

type RouteFilterBarProps = {
  totalRouteCount: number;
  activeBrand: string | null;
  setActiveBrand: (brand: string | null) => void;
  activeSite: string | null;
  setActiveSite: (site: string | null) => void;
  activeEndpointType: string | null;
  setActiveEndpointType: (endpointType: string | null) => void;
  enabledFilter: EnabledFilter;
  setEnabledFilter: (filter: EnabledFilter) => void;
  enabledCounts: { enabled: number; disabled: number };
  brandList: { list: [string, { count: number; brand: BrandInfo }][]; otherCount: number };
  siteList: [string, { count: number; siteId: number }][];
  endpointTypeList: [string, number][];
  collapsed: boolean;
  onToggle: () => void;
};

function FilterChip({
  active,
  label,
  count,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'outline'}
      size="sm"
      className="max-w-full gap-2"
      onClick={onClick}
    >
      {icon}
      <span className="max-w-40 truncate">{label}</span>
      {count !== undefined && <ToneBadge tone="-muted">{count}</ToneBadge>}
    </Button>
  );
}

function SummaryChip({
  children,
  onClear,
}: {
  children: ReactNode;
  onClear: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-auto max-w-full rounded-full px-2 py-0.5 text-xs font-normal"
      onClick={(event) => {
        event.stopPropagation();
        onClear();
      }}
    >
      <span className="min-w-0 truncate">{children}</span>
      <X className="size-3 text-muted-foreground" aria-hidden="true" />
    </Button>
  );
}

function FilterRow({
  label,
  children,
  compact = false,
}: {
  label: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'grid min-w-0 content-start gap-2' : 'grid min-w-0 gap-2'}>
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function ActiveFilterSummary({
  activeBrand,
  activeSite,
  activeEndpointType,
  enabledFilter,
}: Pick<RouteFilterBarProps, 'activeBrand' | 'activeSite' | 'activeEndpointType' | 'enabledFilter'>) {
  const tags: string[] = [];
  if (enabledFilter === 'enabled') tags.push(tr('pages.tokenRoutes.routeFilterBar.statusEnabled'));
  else if (enabledFilter === 'disabled') tags.push(tr('pages.tokenRoutes.routeFilterBar.statusDisabled'));
  if (activeBrand) tags.push(tr('pages.tokenRoutes.routeFilterBar.brandFilter').replace('{brand}', activeBrand === '__other__' ? tr('pages.models.other') : activeBrand));
  if (activeSite) tags.push(tr('pages.tokenRoutes.routeFilterBar.siteFilter').replace('{site}', activeSite));
  if (activeEndpointType) tags.push(tr('pages.tokenRoutes.routeFilterBar.capabilityFilter').replace('{capability}', activeEndpointType));

  if (tags.length === 0) return <span className="text-muted-foreground">{tr('components.notificationPanel.all')}</span>;
  return <span>{tags.join(', ')}</span>;
}

function getActiveFilterCount({
  activeBrand,
  activeSite,
  activeEndpointType,
  enabledFilter,
}: Pick<RouteFilterBarProps, 'activeBrand' | 'activeSite' | 'activeEndpointType' | 'enabledFilter'>): number {
  return [
    enabledFilter !== 'all',
    !!activeBrand,
    !!activeSite,
    !!activeEndpointType,
  ].filter(Boolean).length;
}

function ActiveFilterPills({
  activeBrand,
  setActiveBrand,
  activeSite,
  setActiveSite,
  activeEndpointType,
  setActiveEndpointType,
  enabledFilter,
  setEnabledFilter,
}: Pick<RouteFilterBarProps,
  | 'activeBrand'
  | 'setActiveBrand'
  | 'activeSite'
  | 'setActiveSite'
  | 'activeEndpointType'
  | 'setActiveEndpointType'
  | 'enabledFilter'
  | 'setEnabledFilter'
>) {
  const chips: ReactNode[] = [];
  if (enabledFilter === 'enabled') {
    chips.push(
      <SummaryChip key="enabled" onClear={() => setEnabledFilter('all')}>
        {tr('pages.tokenRoutes.routeFilterBar.statusEnabled')}
      </SummaryChip>,
    );
  } else if (enabledFilter === 'disabled') {
    chips.push(
      <SummaryChip key="disabled" onClear={() => setEnabledFilter('all')}>
        {tr('pages.tokenRoutes.routeFilterBar.statusDisabled')}
      </SummaryChip>,
    );
  }
  if (activeBrand) {
    chips.push(
      <SummaryChip key="brand" onClear={() => setActiveBrand(null)}>
        {tr('pages.tokenRoutes.routeFilterBar.brandFilter').replace('{brand}', activeBrand === '__other__' ? tr('pages.models.other') : activeBrand)}
      </SummaryChip>,
    );
  }
  if (activeSite) {
    chips.push(
      <SummaryChip key="site" onClear={() => setActiveSite(null)}>
        {tr('pages.tokenRoutes.routeFilterBar.siteFilter').replace('{site}', activeSite)}
      </SummaryChip>,
    );
  }
  if (activeEndpointType) {
    chips.push(
      <SummaryChip key="endpoint-type" onClear={() => setActiveEndpointType(null)}>
        {tr('pages.tokenRoutes.routeFilterBar.capabilityFilter').replace('{capability}', activeEndpointType)}
      </SummaryChip>,
    );
  }

  if (chips.length === 0) return null;
  return <span className="mt-2 flex flex-wrap gap-1.5">{chips}</span>;
}

export default function RouteFilterBar(props: RouteFilterBarProps) {
  const {
    totalRouteCount,
    activeBrand,
    setActiveBrand,
    activeSite,
    setActiveSite,
    activeEndpointType,
    setActiveEndpointType,
    enabledFilter,
    setEnabledFilter,
    enabledCounts,
    brandList,
    siteList,
    endpointTypeList,
    collapsed,
    onToggle,
  } = props;
  const open = !collapsed;
  const activeFilterCount = getActiveFilterCount({
    activeBrand,
    activeSite,
    activeEndpointType,
    enabledFilter,
  });

  const resetFilters = () => {
    setEnabledFilter('all');
    setActiveBrand(null);
    setActiveSite(null);
    setActiveEndpointType(null);
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen !== open) onToggle();
      }}
      asChild
    >
      <section className="overflow-hidden rounded-md border bg-background">
        <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start gap-3 p-0 text-left hover:bg-transparent"
              onClick={onToggle}
            >
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <SlidersHorizontal className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{tr('components.mobileFilterSheet.filter')}:</span>
                  <ToneBadge tone={activeFilterCount > 0 ? 'info' : 'muted'}>
                    {activeFilterCount > 0
                      ? tr('pages.tokenRoutes.routeFilterBar.activeCount').replace('{count}', String(activeFilterCount))
                      : tr('components.notificationPanel.all')}
                  </ToneBadge>
                </span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  <ActiveFilterSummary
                    activeBrand={activeBrand}
                    activeSite={activeSite}
                    activeEndpointType={activeEndpointType}
                    enabledFilter={enabledFilter}
                  />
                </span>
              </span>
            </Button>
            <ActiveFilterPills
              activeBrand={activeBrand}
              setActiveBrand={setActiveBrand}
              activeSite={activeSite}
              setActiveSite={setActiveSite}
              activeEndpointType={activeEndpointType}
              setActiveEndpointType={setActiveEndpointType}
              enabledFilter={enabledFilter}
              setEnabledFilter={setEnabledFilter}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {activeFilterCount > 0 ? (
              <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
                <RotateCcw className="size-4" />
                {tr('pages.tokenRoutes.routeFilterBar.reset')}
              </Button>
            ) : null}
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={collapsed ? tr('pages.tokenRoutes.routeFilterBar.expandfilter') : tr('pages.tokenRoutes.routeFilterBar.collapsefilter')}
              >
                {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
                {collapsed ? tr('pages.proxyLogs.expand') : tr('pages.accounts.collapse')}
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent className="route-filter-collapsible overflow-hidden">
          <div className="px-3 pb-3">
            <div className="grid gap-4 border-t pt-3">
              <div className="grid gap-3 lg:grid-cols-[minmax(220px,max-content)_minmax(260px,1fr)]">
                <FilterRow compact label={tr('components.notificationPanel.status')}>
                  <FilterChip
                    active={enabledFilter === 'all'}
                    label={tr('components.notificationPanel.all')}
                    count={totalRouteCount}
                    icon={<SlidersHorizontal className="size-3.5" />}
                    onClick={() => setEnabledFilter('all')}
                  />
                  <FilterChip
                    active={enabledFilter === 'enabled'}
                    label={tr('pages.downstreamKeys.enabled2')}
                    count={enabledCounts.enabled}
                    icon={<CheckCircle2 className="size-3.5 text-success" />}
                    onClick={() => setEnabledFilter(enabledFilter === 'enabled' ? 'all' : 'enabled')}
                  />
                  <FilterChip
                    active={enabledFilter === 'disabled'}
                    label={tr('pages.downstreamKeys.disabled2')}
                    count={enabledCounts.disabled}
                    icon={<CircleSlash2 className="size-3.5 text-muted-foreground" />}
                    onClick={() => setEnabledFilter(enabledFilter === 'disabled' ? 'all' : 'disabled')}
                  />
                </FilterRow>

                <FilterRow compact label={tr('pages.tokenRoutes.routeGroupFilters.capabilities')}>
                  <FilterChip
                    active={!activeEndpointType}
                    label={tr('components.notificationPanel.all')}
                    count={totalRouteCount}
                    icon={<Workflow className="size-3.5" />}
                    onClick={() => setActiveEndpointType(null)}
                  />
                  {endpointTypeList.map(([endpointType, count]) => {
                    const iconModel = resolveEndpointTypeIconModel(endpointType);
                    return (
                      <FilterChip
                        key={endpointType}
                        active={activeEndpointType === endpointType}
                        label={endpointType}
                        count={count}
                        icon={iconModel ? <InlineBrandIcon model={iconModel} size={12} /> : <Workflow className="size-3.5" />}
                        onClick={() => setActiveEndpointType(activeEndpointType === endpointType ? null : endpointType)}
                      />
                    );
                  })}
                  {endpointTypeList.length === 0 && (
                    <span className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.routeGroupFilters.noEndpointCapabilities')}</span>
                  )}
                </FilterRow>
              </div>

              <FilterRow label={tr('pages.models.brands')}>
                <FilterChip
                  active={!activeBrand}
                  label={tr('components.notificationPanel.all')}
                  count={totalRouteCount}
                  icon={<Tags className="size-3.5" />}
                  onClick={() => setActiveBrand(null)}
                />
                {brandList.list.map(([brandName, { count, brand }]) => (
                  <FilterChip
                    key={brandName}
                    active={activeBrand === brandName}
                    label={brandName}
                    count={count}
                    icon={<BrandGlyph brand={brand} size={12} fallbackText={brandName} />}
                    onClick={() => setActiveBrand(activeBrand === brandName ? null : brandName)}
                  />
                ))}
                {brandList.otherCount > 0 && (
                  <FilterChip
                    active={activeBrand === '__other__'}
                    label={tr('pages.models.other')}
                    count={brandList.otherCount}
                    icon={<span className="text-xs">?</span>}
                    onClick={() => setActiveBrand(activeBrand === '__other__' ? null : '__other__')}
                  />
                )}
              </FilterRow>

              {siteList.length > 0 && (
                <FilterRow label={tr('components.searchModal.sites2')}>
                  <FilterChip
                    active={!activeSite}
                    label={tr('components.notificationPanel.all')}
                    count={totalRouteCount}
                    icon={<Server className="size-3.5" />}
                    onClick={() => setActiveSite(null)}
                  />
                  {siteList.map(([siteName, { count }]) => (
                    <FilterChip
                      key={siteName}
                      active={activeSite === siteName}
                      label={siteName}
                      count={count}
                      icon={<span className="text-xs">{siteName.slice(0, 1).toUpperCase()}</span>}
                      onClick={() => setActiveSite(activeSite === siteName ? null : siteName)}
                    />
                  ))}
                </FilterRow>
              )}

              <div className="flex justify-end pt-1">
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline">
                    <ChevronUp className="size-4" />
                    {tr('pages.tokenRoutes.routeFilterBar.collapsefilter')}
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}
