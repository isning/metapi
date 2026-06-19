import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { BrandGlyph, InlineBrandIcon, type BrandInfo } from '../../components/BrandIcon.js';
import { tr } from '../../i18n.js';
import type { GroupFilter, GroupRouteItem } from './types.js';
import { resolveEndpointTypeIconModel } from './utils.js';
import { Button } from '../../components/ui/button/index.js';
import ToneBadge from '../../components/ToneBadge.js';
import { Card, CardContent } from '../../components/ui/card/index.js';

export type EnabledFilter = 'all' | 'enabled' | 'disabled';

const FILTER_EXPANDED_CONTENT_UNMOUNT_MS = 180;

type RouteFilterBarProps = {
  totalRouteCount: number;
  activeBrand: string | null;
  setActiveBrand: (brand: string | null) => void;
  activeSite: string | null;
  setActiveSite: (site: string | null) => void;
  activeEndpointType: string | null;
  setActiveEndpointType: (endpointType: string | null) => void;
  activeGroupFilter: GroupFilter;
  setActiveGroupFilter: (filter: GroupFilter) => void;
  enabledFilter: EnabledFilter;
  setEnabledFilter: (filter: EnabledFilter) => void;
  enabledCounts: { enabled: number; disabled: number };
  brandList: { list: [string, { count: number; brand: BrandInfo }][]; otherCount: number };
  siteList: [string, { count: number; siteId: number }][];
  endpointTypeList: [string, number][];
  groupRouteList: GroupRouteItem[];
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
      className="gap-2"
      onClick={onClick}
    >
      {icon}
      <span className="max-w-40 truncate">{label}</span>
      {count !== undefined && <ToneBadge tone="-muted">{count}</ToneBadge>}
    </Button>
  );
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function ActiveFilterSummary({
  activeBrand,
  activeSite,
  activeGroupFilter,
  activeEndpointType,
  enabledFilter,
}: Pick<RouteFilterBarProps, 'activeBrand' | 'activeSite' | 'activeGroupFilter' | 'activeEndpointType' | 'enabledFilter'>) {
  const tags: string[] = [];
  if (enabledFilter === 'enabled') tags.push('状态=启用');
  else if (enabledFilter === 'disabled') tags.push('状态=禁用');
  if (activeBrand) tags.push(`品牌=${activeBrand === '__other__' ? '其他' : activeBrand}`);
  if (activeSite) tags.push(`站点=${activeSite}`);
  if (activeGroupFilter === '__all__') tags.push('群组=全部');
  else if (typeof activeGroupFilter === 'number') tags.push(`群组=#${activeGroupFilter}`);
  if (activeEndpointType) tags.push(`能力=${activeEndpointType}`);

  if (tags.length === 0) return <span className="text-muted-foreground">{tr('全部')}</span>;
  return <span>{tags.join(', ')}</span>;
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
    activeGroupFilter,
    setActiveGroupFilter,
    enabledFilter,
    setEnabledFilter,
    enabledCounts,
    brandList,
    siteList,
    endpointTypeList,
    groupRouteList,
    collapsed,
    onToggle,
  } = props;
  const [renderExpandedContent, setRenderExpandedContent] = useState(!collapsed);
  const [presenceOpen, setPresenceOpen] = useState(!collapsed);

  useEffect(() => {
    if (!collapsed) return undefined;

    const timerId = globalThis.setTimeout(() => setRenderExpandedContent(false), FILTER_EXPANDED_CONTENT_UNMOUNT_MS);
    return () => globalThis.clearTimeout(timerId);
  }, [collapsed]);

  useLayoutEffect(() => {
    if (collapsed) {
      setPresenceOpen(false);
      return undefined;
    }

    setRenderExpandedContent(true);
    setPresenceOpen(false);
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      const rafId = window.requestAnimationFrame(() => setPresenceOpen(true));
      return () => window.cancelAnimationFrame(rafId);
    }
    setPresenceOpen(true);
    return undefined;
  }, [collapsed]);

  return (
    <Card>
      {/* Collapsed summary */}
      <Button
        type="button"
        variant="ghost"
        className="w-full justify-start gap-2"
        onClick={onToggle}
      >
        <span className="text-sm font-medium">{tr('筛选')}:</span>
        <ActiveFilterSummary
          activeBrand={activeBrand}
          activeSite={activeSite}
          activeGroupFilter={activeGroupFilter}
          activeEndpointType={activeEndpointType}
          enabledFilter={enabledFilter}
        />
      </Button>

      {/* Expanded panel */}
      <div className={`anim-collapse ${presenceOpen ? 'is-open' : ''}`.trim()}>
        <div className="anim-collapse-inner">
          {renderExpandedContent && (
            <CardContent className="grid gap-4 pt-0">
              {/* Status row */}
              <FilterRow label={tr('状态')}>
                <FilterChip
                  active={enabledFilter === 'all'}
                  label={tr('全部')}
                  count={totalRouteCount}
                  icon={<span className="text-xs">✦</span>}
                  onClick={() => setEnabledFilter('all')}
                />
                <FilterChip
                  active={enabledFilter === 'enabled'}
                  label={tr('仅启用')}
                  count={enabledCounts.enabled}
                  icon={<span className="text-xs">●</span>}
                  onClick={() => setEnabledFilter(enabledFilter === 'enabled' ? 'all' : 'enabled')}
                />
                <FilterChip
                  active={enabledFilter === 'disabled'}
                  label={tr('仅禁用')}
                  count={enabledCounts.disabled}
                  icon={<span className="text-xs">●</span>}
                  onClick={() => setEnabledFilter(enabledFilter === 'disabled' ? 'all' : 'disabled')}
                />
              </FilterRow>

              {/* Brand row */}
              <FilterRow label={tr('品牌')}>
                <FilterChip
                  active={!activeBrand}
                  label={tr('全部')}
                  count={totalRouteCount}
                  icon={<span className="text-xs">✦</span>}
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
                    label={tr('其他')}
                    count={brandList.otherCount}
                    icon={<span className="text-xs">?</span>}
                    onClick={() => setActiveBrand(activeBrand === '__other__' ? null : '__other__')}
                  />
                )}
              </FilterRow>

              {/* Site row */}
              {siteList.length > 0 && (
                <FilterRow label={tr('站点')}>
                  <FilterChip
                    active={!activeSite}
                    label={tr('全部')}
                    count={totalRouteCount}
                    icon={<span className="text-xs">⚡</span>}
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

              {/* Group row */}
              <FilterRow label={tr('群组')}>
                <FilterChip
                  active={activeGroupFilter === '__all__'}
                  label={tr('全部群组')}
                  count={groupRouteList.length}
                  icon={<span className="text-xs">◎</span>}
                  onClick={() => setActiveGroupFilter(activeGroupFilter === '__all__' ? null : '__all__')}
                />
                {groupRouteList.map((groupRoute) => (
                  <FilterChip
                    key={groupRoute.id}
                    active={activeGroupFilter === groupRoute.id}
                    label={groupRoute.title}
                    count={groupRoute.sourceRouteCount > 0 ? groupRoute.sourceRouteCount : groupRoute.channelCount}
                    icon={
                      groupRoute.icon.kind === 'brand' ? (
                        <BrandGlyph icon={groupRoute.icon.value} alt={groupRoute.title} size={12} fallbackText={groupRoute.title} />
                      ) : groupRoute.icon.kind === 'text' ? (
                        <span className="text-xs leading-none">{groupRoute.icon.value}</span>
                      ) : groupRoute.icon.kind === 'auto' && groupRoute.brand ? (
                        <BrandGlyph brand={groupRoute.brand} alt={groupRoute.title} size={12} fallbackText={groupRoute.title} />
                      ) : groupRoute.icon.kind === 'auto' ? (
                        <InlineBrandIcon model={groupRoute.modelPattern} size={12} />
                      ) : undefined
                    }
                    onClick={() => setActiveGroupFilter(activeGroupFilter === groupRoute.id ? null : groupRoute.id)}
                  />
                ))}
              </FilterRow>

              {/* Endpoint type row */}
              <FilterRow label={tr('能力')}>
                <FilterChip
                  active={!activeEndpointType}
                  label={tr('全部')}
                  count={totalRouteCount}
                  icon={<span className="text-xs">⚙</span>}
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
                      icon={iconModel ? <InlineBrandIcon model={iconModel} size={12} /> : <span className="text-xs">⚙</span>}
                      onClick={() => setActiveEndpointType(activeEndpointType === endpointType ? null : endpointType)}
                    />
                  );
                })}
                {endpointTypeList.length === 0 && (
                  <span className="text-xs text-muted-foreground">{tr('暂无接口能力数据')}</span>
                )}
              </FilterRow>

              <div className="flex justify-end pt-1">
                <Button type="button" variant="outline"
                 
                 
                  onClick={onToggle}
                >
                  {tr('收起筛选面板')}
                </Button>
              </div>
            </CardContent>
          )}
        </div>
      </div>
    </Card>
  );
}
