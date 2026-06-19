import { Fragment, memo, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BrandGlyph, InlineBrandIcon, type BrandInfo } from '../../components/BrandIcon.js';
import ModernSelect from '../../components/ModernSelect.js';
import { tr } from '../../i18n.js';
import { formatDateTimeMinuteLocal } from '../helpers/checkinLogTime.js';
import type {
  RouteSummaryRow,
  RouteChannel,
  RouteChannelRouteUnit,
  RouteDecision,
  RouteDecisionCandidate,
  MissingTokenRouteSiteActionItem,
  MissingTokenGroupRouteSiteActionItem,
  RouteRoutingStrategy,
} from './types.js';
import type { RouteCandidateView, RouteTokenOption } from '../helpers/routeModelCandidatesIndex.js';
import { SortableChannelRow } from './SortableChannelRow.js';
import {
  getRouteRoutingStrategyLabel,
  getRouteRoutingStrategyDescription,
  getRouteRoutingStrategyHint,
  normalizeRouteRoutingStrategyValue,
} from './routingStrategy.js';
import {
  isRouteExactModel,
  isExplicitGroupRoute,
  getRouteBackendRouteIds,
  getRouteDisplayName,
  getRouteRequestedModelPattern,
  resolveRouteTitle,
  resolveRouteIcon,
} from './utils.js';
import {
  buildPriorityBuckets,
} from './priorityBuckets.js';
import {
  buildPriorityRailNodeStyle,
  buildPriorityRailSections,
  createPriorityRailNewLayerId,
  isPriorityRailNewLayerId,
} from './priorityRail.js';
import { translateOnlyRectSortingStrategy } from './sortingStrategies.js';
import { Button } from '../../components/ui/button/index.js';
import { LoaderCircle } from 'lucide-react';
import ToneBadge from '../../components/ToneBadge.js';
import { Card } from '../../components/ui/card/index.js';
import { cn } from '../../lib/utils.js';

type RouteCardProps = {
  route: RouteSummaryRow;
  brand: BrandInfo | null;
  expanded: boolean;
  compact?: boolean;
  summaryExpanded?: boolean;
  detailPanel?: boolean;
  onToggleExpand: (routeId: number) => void;
  onEdit: (route: RouteSummaryRow) => void;
  onDelete: (routeId: number) => void;
  onToggleEnabled: (route: RouteSummaryRow) => void;
  onClearCooldown: (routeId: number) => void;
  clearingCooldown: boolean;
  onRoutingStrategyChange: (route: RouteSummaryRow, strategy: RouteRoutingStrategy) => void;
  updatingRoutingStrategy: boolean;
  // Channel data (loaded on demand)
  channels: RouteChannel[] | undefined;
  loadingChannels: boolean;
  // Decision data
  routeDecision: RouteDecision | null;
  loadingDecision: boolean;
  // Channel interaction
  candidateView: RouteCandidateView;
  channelTokenDraft: Record<number, number>;
  updatingChannel: Record<number, boolean>;
  savingPriority: boolean;
  onTokenDraftChange: (channelId: number, tokenId: number) => void;
  onSaveToken: (routeId: number, channelId: number, accountId: number) => void;
  onDeleteChannel: (channelId: number, routeId: number) => void;
  onToggleChannelEnabled: (channelId: number, routeId: number, enabled: boolean) => void;
  onChannelDragEnd: (routeId: number, event: DragEndEvent) => void;
  // Missing token hints
  missingTokenSiteItems: MissingTokenRouteSiteActionItem[];
  missingTokenGroupItems: MissingTokenGroupRouteSiteActionItem[];
  onCreateTokenForMissing: (accountId: number, modelName: string) => void;
  // Add channel
  onAddChannel: (routeId: number) => void;
  // Site block model
  onSiteBlockModel: (channelId: number, routeId: number) => void;
  // Source group expansion
  expandedSourceGroupMap: Record<string, boolean>;
  onToggleSourceGroup: (groupKey: string) => void;
};

function getRouteUnitStrategyLabel(strategy: string | null | undefined): string {
  return strategy === 'stick_until_unavailable' ? '单个用到不可用再切' : '轮询';
}

function collectRouteUnits(channels: RouteChannel[] | undefined): RouteChannelRouteUnit[] {
  if (!Array.isArray(channels) || channels.length === 0) return [];
  const unitsById = new Map<string, RouteChannelRouteUnit>();
  for (const channel of channels) {
    const routeUnit = channel.routeUnit;
    if (!routeUnit) continue;
    const key = String(routeUnit.id);
    if (!unitsById.has(key)) {
      unitsById.set(key, routeUnit);
    }
  }
  return Array.from(unitsById.values());
}

function RouteSuccessFailStat({
  successCount,
  failCount,
}: {
  successCount?: number | null;
  failCount?: number | null;
}) {
  return (
    <div className="whitespace-nowrap text-xs text-muted-foreground">
      成功/失败 <span className="font-semibold text-foreground">{successCount || 0}</span>
      <span className="mx-0.5 text-muted-foreground">/</span>
      <span className="font-semibold text-destructive">{failCount || 0}</span>
    </div>
  );
}

function PriorityRailNewLayerRow({
  id,
  highlighted,
  compact = false,
}: {
  id: string;
  highlighted: boolean;
  compact?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const active = highlighted || isOver;

  if (compact) {
    return (
      <div
        ref={setNodeRef}
        data-testid="route-priority-new-layer-target"
        className="flex min-h-8 items-center gap-2 px-0.5"
      >
        <div className={cn('flex-1 border-t border-dashed transition-opacity', active ? 'opacity-100' : 'opacity-70')} />
        <div
          className={cn(
            'min-w-21 rounded-full border border-dashed px-2.5 py-1 text-center text-xs font-semibold leading-tight transition-colors',
            active ? 'bg-muted text-foreground' : 'bg-card text-muted-foreground',
          )}
        >
          {tr('放到新档位')}
        </div>
        <div className={cn('flex-1 border-t border-dashed transition-opacity', active ? 'opacity-100' : 'opacity-70')} />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      data-testid="route-priority-new-layer-target"
      className="grid grid-cols-[86px_minmax(0,1fr)] items-center gap-3"
    >
      <div
        className={cn(
          'min-w-18 rounded-full border border-dashed px-2.5 py-1.5 text-center text-xs font-semibold leading-tight transition-colors',
          active ? 'bg-muted text-foreground' : 'text-muted-foreground',
        )}
      >
        {tr('放到新档位')}
      </div>
      <div className={cn('h-0 border-t border-dashed transition-opacity', active ? 'opacity-100' : 'opacity-75')} />
    </div>
  );
}

function PriorityBucketHeader({
  label,
  testId,
}: {
  label: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="route-priority-bucket-header flex flex-wrap items-center gap-1.5 px-0.5 text-xs text-muted-foreground"
    >
      <span className="font-semibold">{label}</span>
    </div>
  );
}

function PriorityDragPreview({
  channel,
  displayPriority,
  width,
}: {
  channel: RouteChannel;
  displayPriority: number;
  width?: number | null;
}) {
  const resolvedWidth = Number.isFinite(width ?? Number.NaN) ? width ?? undefined : undefined;
  const effectiveTokenName = channel.token?.name || `account-${channel.accountId}`;

  return (
    <div
      data-testid="route-channel-drag-overlay"
      className="pointer-events-none grid h-full max-w-[calc(100vw-32px)] grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border bg-muted p-3 text-foreground shadow-md"
      style={{
        width: resolvedWidth,
        boxSizing: 'border-box',
      }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <ToneBadge tone="">
          P{displayPriority}
        </ToneBadge>
        <span className="min-w-0 font-semibold">
          {channel.account?.username || `account-${channel.accountId}`}
        </span>
        <ToneBadge tone="-muted">
          {channel.site?.name || 'unknown'}
        </ToneBadge>
        <ToneBadge tone="">
          当前生效：{effectiveTokenName}
        </ToneBadge>
        {channel.sourceModel ? (
          <ToneBadge tone="-info">
            {channel.sourceModel}
          </ToneBadge>
        ) : null}
        {channel.manualOverride ? (
          <ToneBadge tone="-warning">
            手动配置
          </ToneBadge>
        ) : null}
      </div>
      <RouteSuccessFailStat successCount={channel.successCount} failCount={channel.failCount} />
    </div>
  );
}

function renderDragOverlayNode(node: ReactNode) {
  if (typeof document === 'undefined' || !document.body) {
    return node;
  }
  return createPortal(node, document.body);
}

type SortableChannelShellProps = {
  channel: RouteChannel;
  bucketIndex: number;
  channelIndex: number;
  bucketChannelCount: number;
  totalBucketCount: number;
  compact: boolean;
  readOnlyRoute: boolean;
  savingPriority: boolean;
  candidateView: RouteCandidateView;
  channelTokenDraft: Record<number, number>;
  updatingChannel: Record<number, boolean>;
  activeDragChannelId: number | null;
  decisionMap: Map<number, RouteDecisionCandidate>;
  exactRoute: boolean;
  loadingDecision: boolean;
  channelManagementDisabled: boolean;
  routeId: number;
  onTokenDraftChange: (channelId: number, tokenId: number) => void;
  onSaveToken: (routeId: number, channelId: number, accountId: number) => void;
  onDeleteChannel: (channelId: number, routeId: number) => void;
  onToggleChannelEnabled: (channelId: number, routeId: number, enabled: boolean) => void;
  onSiteBlockModel: (channelId: number, routeId: number) => void;
  railLabel: string;
  mobileRailLabel: string;
  railNodeStyle: CSSProperties;
  showCompactRailHeader: boolean;
  useDragOverlay: boolean;
};

function SortableChannelShell({
  channel,
  bucketIndex,
  channelIndex,
  bucketChannelCount,
  totalBucketCount,
  compact,
  readOnlyRoute,
  savingPriority,
  candidateView,
  channelTokenDraft,
  updatingChannel,
  activeDragChannelId,
  decisionMap,
  exactRoute,
  loadingDecision,
  channelManagementDisabled,
  routeId,
  onTokenDraftChange,
  onSaveToken,
  onDeleteChannel,
  onToggleChannelEnabled,
  onSiteBlockModel,
  railLabel,
  mobileRailLabel,
  railNodeStyle,
  showCompactRailHeader,
  useDragOverlay,
}: SortableChannelShellProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: channel.id,
    disabled: savingPriority || readOnlyRoute,
  });

  const tokenOptions = candidateView.tokenOptionsByAccountId[channel.accountId] || [];
  const activeTokenId = channelTokenDraft[channel.id] ?? channel.tokenId ?? 0;
  const showDesktopRailHeader = !compact && channelIndex === 0;
  const showDesktopRailLine = !compact
    && (bucketIndex < totalBucketCount - 1 || channelIndex < bucketChannelCount - 1);
  const shellTransition = [
    transition,
    'opacity 180ms ease',
  ].filter(Boolean).join(', ');
  const translatedTransform = transform
    ? { ...transform, scaleX: 1, scaleY: 1 }
    : null;

  return (
    <div
      ref={setNodeRef}
      data-testid="route-channel-shell"
      data-channel-id={channel.id}
      style={{
        visibility: useDragOverlay && isDragging ? 'hidden' : undefined,
        transform: CSS.Translate.toString(translatedTransform),
        transition: shellTransition || undefined,
        zIndex: isDragging ? 10 : undefined,
        willChange: isDragging || Boolean(transform) || Boolean(transition) ? 'transform' : undefined,
        display: compact ? 'flex' : 'grid',
        flexDirection: compact ? 'column' : undefined,
        gridTemplateColumns: compact ? undefined : '86px minmax(0, 1fr)',
        gap: compact ? 6 : 12,
        alignItems: 'stretch',
      }}
    >
      {compact && showCompactRailHeader ? (
        <PriorityBucketHeader label={mobileRailLabel} />
      ) : null}

      {!compact ? (
        <div
          aria-hidden
          style={{
            width: 86,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            paddingTop: showDesktopRailHeader ? 2 : 0,
          }}
        >
          {showDesktopRailHeader ? (
            <>
              <div
                style={{
                  minWidth: 64,
                  padding: '5px 8px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  textAlign: 'center',
                  lineHeight: 1.2,
                  transition: 'border-color 0.16s ease, background 0.16s ease, color 0.16s ease',
                  ...railNodeStyle,
                }}
              >
                {railLabel}
              </div>
            </>
          ) : (
            <div style={{ minWidth: 64 }} />
          )}
          {showDesktopRailLine ? (
            <div
              style={{
                width: 1,
                flex: 1,
                minHeight: showDesktopRailHeader ? 10 : 0,
                marginTop: showDesktopRailHeader ? 6 : 0,
                background: 'var(--color-border)',
              }}
            />
          ) : null}
        </div>
      ) : null}

      <SortableChannelRow
        channel={channel}
        displayPriority={bucketIndex}
        showPriorityBadge={compact}
        dragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
        dragHandleRef={setActivatorNodeRef}
        dragInProgress={activeDragChannelId != null}
        decisionCandidate={decisionMap.get(channel.id)}
        isExactRoute={exactRoute}
        loadingDecision={loadingDecision}
        isSavingPriority={savingPriority}
        readOnly={readOnlyRoute}
        channelManagementDisabled={channelManagementDisabled}
        mobile={compact}
        tokenOptions={tokenOptions}
        activeTokenId={activeTokenId}
        isUpdatingToken={!!updatingChannel[channel.id]}
        onTokenDraftChange={onTokenDraftChange}
        onSaveToken={() => onSaveToken(routeId, channel.id, channel.accountId)}
        onDeleteChannel={() => onDeleteChannel(channel.id, routeId)}
        onToggleEnabled={(enabled) => onToggleChannelEnabled(channel.id, routeId, enabled)}
        onSiteBlockModel={channelManagementDisabled ? undefined : () => onSiteBlockModel(channel.id, routeId)}
      />
    </div>
  );
}

function RouteCardInner({
  route,
  brand,
  expanded,
  compact = false,
  summaryExpanded = false,
  detailPanel = false,
  onToggleExpand,
  onEdit,
  onDelete,
  onToggleEnabled,
  onClearCooldown,
  clearingCooldown,
  onRoutingStrategyChange,
  updatingRoutingStrategy,
  channels,
  loadingChannels,
  routeDecision,
  loadingDecision,
  candidateView,
  channelTokenDraft,
  updatingChannel,
  savingPriority,
  onTokenDraftChange,
  onSaveToken,
  onDeleteChannel,
  onToggleChannelEnabled,
  onChannelDragEnd,
  missingTokenSiteItems,
  missingTokenGroupItems,
  onCreateTokenForMissing,
  onAddChannel,
  onSiteBlockModel,
  expandedSourceGroupMap,
  onToggleSourceGroup,
}: RouteCardProps) {
  const routeIcon = resolveRouteIcon(route);
  const exactRoute = isRouteExactModel(route);
  const explicitGroupRoute = isExplicitGroupRoute(route);
  const explicitGroupSourceCount = getRouteBackendRouteIds(route.backend).length;
  const routePattern = getRouteRequestedModelPattern(route);
  const routeDisplayName = getRouteDisplayName(route);
  const readOnlyRoute = route.kind === 'zero_channel' || route.readOnly === true || route.isVirtual === true;
  const channelManagementDisabled = explicitGroupRoute;
  const title = resolveRouteTitle(route);
  const routingStrategy = normalizeRouteRoutingStrategyValue(route.routingStrategy);
  const routingStrategyDescription = getRouteRoutingStrategyDescription(routingStrategy);
  const routingStrategyHint = getRouteRoutingStrategyHint(routingStrategy);
  const hasCachedDecisionSnapshot = !!route.decisionSnapshot;
  const cachedDecisionTooltip = route.decisionRefreshedAt
    ? `${tr('最近刷新')}: ${formatDateTimeMinuteLocal(route.decisionRefreshedAt)}`
    : undefined;
  const showAddChannelButton = !readOnlyRoute && !channelManagementDisabled;
  const showMissingTokenHints = !channelManagementDisabled && (missingTokenSiteItems.length > 0 || missingTokenGroupItems.length > 0);
  const routeUnits = collectRouteUnits(channels);
  const routingStrategyOptions = [
    {
      value: 'weighted',
      label: tr('权重随机'),
      description: getRouteRoutingStrategyDescription('weighted'),
    },
    {
      value: 'round_robin',
      label: tr('轮询'),
      description: getRouteRoutingStrategyDescription('round_robin'),
    },
    {
      value: 'stable_first',
      label: tr('稳定优先'),
      description: getRouteRoutingStrategyDescription('stable_first'),
    },
  ] as const;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const decisionMap = new Map<number, RouteDecisionCandidate>(
    (routeDecision?.candidates || []).map((c) => [c.channelId, c]),
  );

  const priorityBuckets = buildPriorityBuckets(channels || []);
  const priorityRailSections = buildPriorityRailSections(channels || []);
  const [activeDragChannelId, setActiveDragChannelId] = useState<number | null>(null);
  const [activeDragRowWidth, setActiveDragRowWidth] = useState<number | null>(null);
  const useDragOverlay = compact && detailPanel;

  const clearDragState = () => {
    setActiveDragChannelId(null);
    setActiveDragRowWidth(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const nextId = Number(event.active.id);
    setActiveDragChannelId(Number.isFinite(nextId) ? nextId : null);
    setActiveDragRowWidth(event.active.rect?.current?.initial?.width ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    onChannelDragEnd(route.id, event);
    clearDragState();
  };
  const activeDragChannel = activeDragChannelId == null
    ? null
    : (channels || []).find((channel) => channel.id === activeDragChannelId) || null;
  const activeDragBucketIndex = activeDragChannel == null
    ? -1
    : priorityBuckets.findIndex((bucket) => bucket.channels.some((channel) => channel.id === activeDragChannel.id));
  const renderClearCooldownButton = () => {
    if (readOnlyRoute) return null;
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => onClearCooldown(route.id)} disabled={clearingCooldown}>
        {clearingCooldown ? tr('清除中...') : tr('清除冷却')}
      </Button>
    );
  };
  const renderAddChannelButton = ({
    fullWidth = false,
    alignRight = false,
  }: {
    fullWidth?: boolean;
    alignRight?: boolean;
  } = {}) => (
    <Button type="button" variant="outline"
      onClick={() => onAddChannel(route.id)}
     
     
    >
      + {tr('添加通道')}
    </Button>
  );

  // Collapsed card
  if (!expanded) {
    return (
      <Card
        className={`route-card-collapsed route--collapsed ${summaryExpanded ? 'is-active' : ''}`.trim()}
        onClick={() => onToggleExpand(route.id)}
        role="button"
        tabIndex={0}
        aria-expanded={summaryExpanded}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggleExpand(route.id);
          }
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex size-5 shrink-0 items-center">
            {routeIcon.kind === 'brand' ? (
              <BrandGlyph icon={routeIcon.value} alt={title} size={18} fallbackText={title} />
            ) : routeIcon.kind === 'text' ? (
              <span className="text-sm leading-none">{routeIcon.value}</span>
            ) : routeIcon.kind === 'auto' && brand ? (
              <BrandGlyph brand={brand} alt={title} size={18} fallbackText={title} />
            ) : routeIcon.kind === 'auto' ? (
              <InlineBrandIcon model={routePattern} size={18} />
            ) : null}
          </span>

          <div
            data-testid="collapsed-route-title-row"
            className="flex min-w-0 flex-[1_1_180px] items-center gap-1.5"
          >
            <code
              className="min-w-0 flex-[1_1_180px] truncate text-[13px] font-semibold text-foreground"
            >
              {title}
            </code>

            {routeDisplayName && routeDisplayName.trim() !== routePattern ? (
              <ToneBadge tone="-muted"
               
                title={routePattern}
                className="min-w-0 max-w-[116px] flex-[0_1_116px] truncate"
               
              >
                {routePattern}
              </ToneBadge>
            ) : null}
          </div>

          {readOnlyRoute ? (
            <ToneBadge tone="-muted">
              {tr('未生成')}
            </ToneBadge>
          ) : (
            <Button
              type="button"
              variant={route.enabled ? 'secondary' : 'outline'}
              size="sm"
              onClick={(e) => { e.stopPropagation(); onToggleEnabled(route); }}
              data-tooltip={route.enabled ? '点击禁用此路由' : '点击启用此路由'}
            >
              {route.enabled ? tr('启用') : tr('禁用')}
            </Button>
          )}

          {explicitGroupRoute && explicitGroupSourceCount > 0 ? (
            <>
              <ToneBadge tone="-info">
                {explicitGroupSourceCount} {tr('来源模型')}
              </ToneBadge>
              <ToneBadge tone="-muted">
                {route.channelCount} {tr('通道')}
              </ToneBadge>
            </>
          ) : (
            <ToneBadge tone="-info">
              {route.channelCount} {tr('通道')}
            </ToneBadge>
          )}
          {hasCachedDecisionSnapshot ? (
            <ToneBadge tone="-success"
             
              data-tooltip={cachedDecisionTooltip}
             
            >
              {tr('已缓存')}
            </ToneBadge>
          ) : null}

          {readOnlyRoute ? (
            <ToneBadge tone="-warning">
              {tr('0 通道')}
            </ToneBadge>
          ) : (
            <ToneBadge tone="-muted"
             
             
              data-tooltip={`${getRouteRoutingStrategyLabel(routingStrategy)}：${routingStrategyDescription}`}
            >
              {getRouteRoutingStrategyLabel(routingStrategy)}
            </ToneBadge>
          )}

          <svg
            width="14"
            height="14"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={cn('shrink-0 text-muted-foreground transition-transform', summaryExpanded && 'rotate-180')}
            aria-hidden
          >
            <path d="m5 7 5 6 5-6" />
          </svg>
        </div>
      </Card>
    );
  }

  // Expanded card
  return (
    <Card
      className={cn(
        'route--expanded',
        compact ? 'route--expanded-compact p-2.5' : 'p-3.5',
        detailPanel && 'route--detail-panel',
      )}
    >
      {!compact ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <code className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-sm font-semibold text-foreground">
              {routeIcon.kind === 'brand' ? (
                <BrandGlyph icon={routeIcon.value} alt={title} size={20} fallbackText={title} />
              ) : routeIcon.kind === 'text' ? (
                <span className="inline-flex size-5 items-center justify-center rounded-md bg-card text-sm leading-none">
                  {routeIcon.value}
                </span>
              ) : routeIcon.kind === 'auto' && brand ? (
                <BrandGlyph brand={brand} alt={title} size={20} fallbackText={title} />
              ) : routeIcon.kind === 'auto' ? (
                <InlineBrandIcon model={routePattern} size={20} />
              ) : null}
              {title}
            </code>
            {routeDisplayName && routeDisplayName.trim() !== routePattern ? (
              <ToneBadge tone="-muted">{routePattern}</ToneBadge>
            ) : null}
            {readOnlyRoute ? (
              <ToneBadge tone="-muted">
                {tr('未生成')}
              </ToneBadge>
            ) : (
              <Button
                type="button"
                variant={route.enabled ? 'secondary' : 'outline'}
                size="sm"
                onClick={(e) => { e.stopPropagation(); onToggleEnabled(route); }}
                data-tooltip={route.enabled ? '点击禁用此路由' : '点击启用此路由'}
              >
                {route.enabled ? tr('启用') : tr('禁用')}
              </Button>
            )}
            {explicitGroupRoute && explicitGroupSourceCount > 0 ? (
              <>
                <ToneBadge tone="-info">
                  {explicitGroupSourceCount} {tr('来源模型')}
                </ToneBadge>
                <ToneBadge tone="-muted">
                  {route.channelCount} {tr('通道')}
                </ToneBadge>
              </>
            ) : (
              <ToneBadge tone="-info">
                {route.channelCount} {tr('通道')}
              </ToneBadge>
            )}
            {hasCachedDecisionSnapshot ? (
              <ToneBadge tone="-success"
               
                data-tooltip={cachedDecisionTooltip}
               
              >
                {tr('已缓存')}
              </ToneBadge>
            ) : null}
            {readOnlyRoute && (
              <ToneBadge tone="-warning">
                {tr('0 通道')}
              </ToneBadge>
            )}
            {savingPriority && (
              <ToneBadge tone="-warning">{tr('排序保存中')}</ToneBadge>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {renderClearCooldownButton()}
            {!readOnlyRoute && (explicitGroupRoute || !exactRoute) && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(route)}>{tr('编辑群组')}</Button>
            )}
            {!readOnlyRoute && <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(route.id)}>{tr('删除路由')}</Button>}
            <Button
              type="button"
              variant="outline"
              onClick={() => onToggleExpand(route.id)}
              data-tooltip={tr('收起')}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="rotate-180"
                aria-hidden
              >
                <path d="m5 7 5 6 5-6" />
              </svg>
            </Button>
          </div>
        </div>
      ) : (
        <div className="mb-2 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              data-testid="compact-route-header-main"
              className="flex min-w-0 flex-1 flex-row flex-wrap items-center gap-1.5"
            >
              <code className="inline-flex max-w-full min-w-0 truncate rounded-md bg-muted px-2 py-0.5 text-sm font-semibold text-foreground">
                {title}
              </code>
              {routeDisplayName && routeDisplayName.trim() !== routePattern ? (
                <ToneBadge tone="-muted">{routePattern}</ToneBadge>
              ) : null}
              {readOnlyRoute ? (
                <ToneBadge tone="-muted">{tr('未生成')}</ToneBadge>
              ) : (
                <ToneBadge tone={route.enabled ? 'success' : 'muted'}>
                  {route.enabled ? tr('启用') : tr('禁用')}
                </ToneBadge>
              )}
              <ToneBadge tone="-info">
                {route.channelCount} {tr('通道')}
              </ToneBadge>
              {hasCachedDecisionSnapshot ? (
                <ToneBadge tone="-success"
                 
                  data-tooltip={cachedDecisionTooltip}
                 
                >
                  {tr('已缓存')}
                </ToneBadge>
              ) : null}
              {explicitGroupRoute && explicitGroupSourceCount > 0 ? (
                <ToneBadge tone="-muted">
                  {explicitGroupSourceCount} {tr('来源模型')}
                </ToneBadge>
              ) : null}
              {savingPriority ? <ToneBadge tone="-warning">{tr('排序保存中')}</ToneBadge> : null}
            </div>
            {!readOnlyRoute && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {renderClearCooldownButton()}
                {(explicitGroupRoute || !exactRoute) && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(route)}>{tr('编辑群组')}</Button>
                )}
                <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(route.id)}>{tr('删除路由')}</Button>
                {detailPanel && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onToggleExpand(route.id)}
                  >
                    {tr('收起详情')}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {!compact && explicitGroupRoute ? (
        <div className="mb-1.5 text-xs leading-snug text-muted-foreground">
          {tr('该群组会将多个来源模型聚合为一个对外模型名；这里调整优先级桶时会直接回写来源通道。若某个来源模型被其他群组复用，保存前会提示影响范围。')}
        </div>
      ) : !compact && !exactRoute ? (
        <div className="mb-1.5 text-xs leading-snug text-muted-foreground">
          {tr('通配符路由按请求实时决策；下方优先级桶在整条路由内全局生效，来源模型只作为通道标签展示。')}
        </div>
      ) : null}

      {routeUnits.length > 0 ? (
        <div className="mb-2 flex flex-col gap-1.5">
          <div className="text-xs text-muted-foreground">
            OAuth 路由池
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {routeUnits.map((routeUnit) => (
              <ToneBadge
                tone="-info"
                key={`route-unit-${String(routeUnit.id)}`}
                title={`${routeUnit.name?.trim() || 'OAuth 路由池'} · ${routeUnit.memberCount} 个成员 · ${getRouteUnitStrategyLabel(routeUnit.strategy)}`}
              >
                {(routeUnit.name?.trim() || 'OAuth 路由池')} · {routeUnit.memberCount} 个成员 · {getRouteUnitStrategyLabel(routeUnit.strategy)}
              </ToneBadge>
            ))}
          </div>
        </div>
      ) : null}

      {!readOnlyRoute && (
        <div
          data-testid={compact ? 'compact-route-action-row' : undefined}
          className={cn(
            'mb-2 flex flex-wrap items-center gap-2',
            compact ? 'justify-start' : 'justify-between',
          )}
        >
          {compact ? (
            <>
              <div
                className="flex min-w-0 items-center gap-1.5"
                data-tooltip={`${routingStrategyDescription} ${routingStrategyHint}`}
              >
                <div className="shrink-0 text-xs text-muted-foreground">
                  {tr('路由策略')}
                </div>
                <div
                  data-testid="compact-route-strategy-select"
                  style={{
                    flex: '0 0 168px',
                    minWidth: 168,
                    maxWidth: 168,
                  }}
                >
                  <ModernSelect
                    size="sm"
                    value={routingStrategy}
                    disabled={updatingRoutingStrategy}
                    onChange={(nextValue) => onRoutingStrategyChange(route, nextValue as RouteRoutingStrategy)}
                    options={routingStrategyOptions.map((option) => ({ value: option.value, label: option.label }))}
                    placeholder={tr('选择路由策略')}
                    emptyLabel={tr('暂无可选策略')}
                  />
                </div>
              </div>
              {showAddChannelButton ? renderAddChannelButton({ alignRight: true }) : null}
            </>
          ) : (
            <>
              <div className="text-xs text-muted-foreground" data-tooltip={undefined}>
                {tr('路由策略')}
              </div>
              <div
                style={{
                  minWidth: 220,
                  maxWidth: 320,
                  flex: '1 1 220px',
                }}
              >
                <ModernSelect
                  size="sm"
                  value={routingStrategy}
                  disabled={updatingRoutingStrategy}
                  onChange={(nextValue) => onRoutingStrategyChange(route, nextValue as RouteRoutingStrategy)}
                  options={routingStrategyOptions.map((option) => ({ ...option }))}
                  placeholder={tr('选择路由策略')}
                  emptyLabel={tr('暂无可选策略')}
                />
                <div className="mt-1.5 flex flex-col gap-0.5">
                  <div className="text-xs leading-snug text-muted-foreground">
                    {routingStrategyDescription}
                  </div>
                  <div className="text-xs leading-snug text-muted-foreground">
                    {routingStrategyHint}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Missing token hints + Add channel button */}
      <div className={cn('mb-2 flex flex-wrap justify-between gap-1.5', compact ? 'flex-col items-stretch' : 'flex-row items-start')}>
        {showMissingTokenHints ? (
          <div className="flex flex-1 flex-col gap-1">
            {missingTokenSiteItems.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{tr('待注册站点')}:</span>
                {missingTokenSiteItems.map((item) => (
                  <Button
                    key={`missing-${route.id}-${item.key}`}
                    type="button"
                    onClick={() => onCreateTokenForMissing(item.accountId, routePattern)}
                    variant="secondary"
                    size="sm"
                    data-tooltip={`点击跳转到令牌创建（预选 ${item.siteName}/${item.accountLabel}）`}
                  >
                    {item.siteName}
                  </Button>
                ))}
              </div>
            )}
            {missingTokenGroupItems.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{tr('缺少分组')}:</span>
                {missingTokenGroupItems.map((item) => (
                  <Button
                    key={`missing-group-${route.id}-${item.key}`}
                    type="button"
                    onClick={() => onCreateTokenForMissing(item.accountId, routePattern)}
                    variant="secondary"
                    size="sm"
                    data-tooltip={`缺少分组：${item.missingGroups.join('、') || '未知'}${item.availableGroups.length > 0 ? `；已覆盖：${item.availableGroups.join('、')}` : ''}${item.groupCoverageUncertain ? '；当前分组覆盖存在不确定性' : ''}`}
                  >
                    {item.siteName}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ) : (!compact && showAddChannelButton ? <div /> : null)}
        {!compact && showAddChannelButton ? renderAddChannelButton() : null}
      </div>

      {/* Channel list */}
      {loadingChannels ? (
        <div className="flex items-center gap-2 py-2">
          <LoaderCircle className="size-4 animate-spin" />
          <span className="text-sm text-muted-foreground">{tr('加载通道中...')}</span>
        </div>
      ) : channels && channels.length > 0 ? (
        <div className="flex flex-col gap-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragCancel={clearDragState}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={(channels || []).map((channel) => channel.id)} strategy={translateOnlyRectSortingStrategy}>
              <div
                data-testid="route-channel-sortable-list"
                className={compact ? 'flex flex-col gap-2' : 'flex flex-col gap-1'}
              >
                {priorityBuckets.map((bucket, bucketIndex) => {
                  const railSection = priorityRailSections[bucketIndex];
                  const railLabel = `P${bucketIndex} · ${bucket.channels.length}`;
                  const mobileRailLabel = `${railLabel} ${tr('通道')}`;
                  const railNodeStyle = buildPriorityRailNodeStyle(bucketIndex, false);
                  const showStandaloneCompactRailHeader = compact && detailPanel;
                  const showNewLayerTarget = activeDragChannelId != null
                    && !readOnlyRoute
                    && (!compact || detailPanel);

                  return (
                    <Fragment key={`${route.id}-priority-bucket-${bucket.priority}-${bucketIndex}`}>
                      {showStandaloneCompactRailHeader ? (
                        <PriorityBucketHeader
                          label={mobileRailLabel}
                          testId="route-priority-bucket-header"
                        />
                      ) : null}

                      {bucket.channels.map((channel, channelIndex) => {
                        return (
                          <SortableChannelShell
                            key={channel.id}
                            channel={channel}
                            bucketIndex={bucketIndex}
                            channelIndex={channelIndex}
                            bucketChannelCount={bucket.channels.length}
                            totalBucketCount={priorityBuckets.length}
                            compact={compact}
                            readOnlyRoute={readOnlyRoute}
                            savingPriority={savingPriority}
                            candidateView={candidateView}
                            channelTokenDraft={channelTokenDraft}
                            updatingChannel={updatingChannel}
                            activeDragChannelId={activeDragChannelId}
                            decisionMap={decisionMap}
                            exactRoute={exactRoute}
                            loadingDecision={loadingDecision}
                            channelManagementDisabled={channelManagementDisabled}
                            routeId={route.id}
                            onTokenDraftChange={onTokenDraftChange}
                            onSaveToken={onSaveToken}
                            onDeleteChannel={onDeleteChannel}
                            onToggleChannelEnabled={onToggleChannelEnabled}
                            onSiteBlockModel={onSiteBlockModel}
                            railLabel={railSection ? `P${bucketIndex} · ${railSection.channelCount}` : railLabel}
                            mobileRailLabel={mobileRailLabel}
                            railNodeStyle={railNodeStyle}
                            showCompactRailHeader={!showStandaloneCompactRailHeader && channelIndex === 0}
                            useDragOverlay={useDragOverlay}
                          />
                        );
                      })}

                      {showNewLayerTarget ? (
                        <PriorityRailNewLayerRow
                          id={createPriorityRailNewLayerId(bucket.priority)}
                          highlighted={false}
                          compact={compact}
                        />
                      ) : null}
                    </Fragment>
                  );
                })}
              </div>
            </SortableContext>
            {useDragOverlay ? renderDragOverlayNode(
              <DragOverlay>
                {activeDragChannel ? (
                  <PriorityDragPreview
                    channel={activeDragChannel}
                    displayPriority={Math.max(0, activeDragBucketIndex)}
                    width={activeDragRowWidth}
                  />
                ) : null}
              </DragOverlay>,
            ) : null}
          </DndContext>
        </div>
      ) : (
        <div className="pl-1 text-sm text-muted-foreground">
          {readOnlyRoute ? tr('暂无通道，先补齐连接配置后再重建路由。') : tr('暂无通道')}
        </div>
      )}
    </Card>
  );
}

function buildChannelInteractionSignature(
  channels: RouteChannel[] | undefined,
  channelTokenDraft: Record<number, number>,
  updatingChannel: Record<number, boolean>,
): string {
  if (!Array.isArray(channels) || channels.length === 0) return '';
  return channels
    .map((channel) => `${channel.id}:${channelTokenDraft[channel.id] ?? ''}:${updatingChannel[channel.id] ? 1 : 0}`)
    .join('|');
}

function areRouteCardPropsEqual(prev: RouteCardProps, next: RouteCardProps): boolean {
  if (
    prev.route !== next.route
    || prev.brand !== next.brand
    || prev.expanded !== next.expanded
    || prev.compact !== next.compact
    || prev.summaryExpanded !== next.summaryExpanded
    || prev.detailPanel !== next.detailPanel
    || prev.onToggleExpand !== next.onToggleExpand
    || prev.onToggleEnabled !== next.onToggleEnabled
  ) {
    return false;
  }

  if (!next.expanded) {
    return true;
  }

  if (
    prev.onEdit !== next.onEdit
    || prev.onDelete !== next.onDelete
    || prev.onClearCooldown !== next.onClearCooldown
    || prev.onRoutingStrategyChange !== next.onRoutingStrategyChange
    || prev.onTokenDraftChange !== next.onTokenDraftChange
    || prev.onSaveToken !== next.onSaveToken
    || prev.onDeleteChannel !== next.onDeleteChannel
    || prev.onToggleChannelEnabled !== next.onToggleChannelEnabled
    || prev.onChannelDragEnd !== next.onChannelDragEnd
    || prev.onCreateTokenForMissing !== next.onCreateTokenForMissing
    || prev.onAddChannel !== next.onAddChannel
    || prev.onSiteBlockModel !== next.onSiteBlockModel
    || prev.onToggleSourceGroup !== next.onToggleSourceGroup
    || prev.clearingCooldown !== next.clearingCooldown
    || prev.updatingRoutingStrategy !== next.updatingRoutingStrategy
    || prev.savingPriority !== next.savingPriority
    || prev.loadingChannels !== next.loadingChannels
    || prev.loadingDecision !== next.loadingDecision
    || prev.routeDecision !== next.routeDecision
    || prev.candidateView !== next.candidateView
    || prev.missingTokenSiteItems !== next.missingTokenSiteItems
    || prev.missingTokenGroupItems !== next.missingTokenGroupItems
    || prev.channels !== next.channels
  ) {
    return false;
  }

  return buildChannelInteractionSignature(prev.channels, prev.channelTokenDraft, prev.updatingChannel)
    === buildChannelInteractionSignature(next.channels, next.channelTokenDraft, next.updatingChannel);
}

const RouteCard = memo(RouteCardInner, areRouteCardPropsEqual);
export default RouteCard;
