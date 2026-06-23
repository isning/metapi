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
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import ModernSelect from '../../components/ModernSelect.js';
import { tr } from '../../i18n.js';
import { formatDateTimeMinuteLocal } from '../helpers/checkinLogTime.js';
import type {
  RouteSummaryRow,
  RouteEndpointTarget,
  RouteEndpointTargetRouteUnit,
  RouteDecision,
  RouteDecisionCandidate,
  MissingTokenRouteSiteActionItem,
  MissingTokenGroupRouteSiteActionItem,
  RouteRoutingStrategy,
} from './types.js';
import type { RouteCandidateView, RouteTokenOption } from '../helpers/routeModelCandidatesIndex.js';
import { SortableRouteTargetRow } from './SortableRouteTargetRow.js';
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
  showCollapseAction?: boolean;
  onToggleExpand: (routeId: number) => void;
  onEdit: (route: RouteSummaryRow) => void;
  onDelete: (routeId: number) => void;
  onToggleEnabled: (route: RouteSummaryRow) => void;
  onClearCooldown: (routeId: number) => void;
  clearingCooldown: boolean;
  onRoutingStrategyChange: (route: RouteSummaryRow, strategy: RouteRoutingStrategy) => void;
  updatingRoutingStrategy: boolean;
  // Target data (loaded on demand)
  targets: RouteEndpointTarget[] | undefined;
  loadingTargets: boolean;
  // Decision data
  routeDecision: RouteDecision | null;
  loadingDecision: boolean;
  // Target interaction
  candidateView: RouteCandidateView;
  targetTokenDraft: Record<number, number>;
  updatingTarget: Record<number, boolean>;
  savingPriority: boolean;
  onTokenDraftChange: (targetId: number, tokenId: number) => void;
  onSaveToken: (routeId: number, targetId: number, accountId: number) => void;
  onDeleteTarget: (targetId: number, routeId: number) => void;
  onToggleTargetEnabled: (targetId: number, routeId: number, enabled: boolean) => void;
  onTargetDragEnd: (routeId: number, event: DragEndEvent) => void;
  // Missing token hints
  missingTokenSiteItems: MissingTokenRouteSiteActionItem[];
  missingTokenGroupItems: MissingTokenGroupRouteSiteActionItem[];
  onCreateTokenForMissing: (accountId: number, modelName: string) => void;
  // Add target
  onAddTarget: (routeId: number) => void;
  // Site block model
  onSiteBlockModel: (targetId: number, routeId: number) => void;
  // Source group expansion
  expandedSourceGroupMap: Record<string, boolean>;
  onToggleSourceGroup: (groupKey: string) => void;
};

function getRouteUnitStrategyLabel(strategy: string | null | undefined): string {
  return strategy === 'stick_until_unavailable' ? tr('pages.oAuthManagement.notAvailable') : tr('pages.oAuthManagement.roundRobin');
}

function collectRouteUnits(targets: RouteEndpointTarget[] | undefined): RouteEndpointTargetRouteUnit[] {
  if (!Array.isArray(targets) || targets.length === 0) return [];
  const unitsById = new Map<string, RouteEndpointTargetRouteUnit>();
  for (const target of targets) {
    const routeUnit = target.routeUnit;
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
      {tr('pages.tokenRoutes.routeCard.successFailed')} <span className="font-semibold text-foreground">{successCount || 0}</span>
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
          {tr('pages.tokenRoutes.routeCard.moveNewTier')}
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
        {tr('pages.tokenRoutes.routeCard.moveNewTier')}
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
  target,
  displayPriority,
  width,
}: {
  target: RouteEndpointTarget;
  displayPriority: number;
  width?: number | null;
}) {
  const resolvedWidth = Number.isFinite(width ?? Number.NaN) ? width ?? undefined : undefined;
  const effectiveTokenName = target.token?.name || `account-${target.accountId}`;

  return (
    <div
      data-testid="route-target-drag-overlay"
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
          {target.account?.username || `account-${target.accountId}`}
        </span>
        <ToneBadge tone="-muted">
          {target.site?.name || 'unknown'}
        </ToneBadge>
        <ToneBadge tone="">
          {tr('pages.tokenRoutes.routeCard.currentlyEffective')}{effectiveTokenName}
        </ToneBadge>
        {target.sourceModel ? (
          <ToneBadge tone="-info">
            {target.sourceModel}
          </ToneBadge>
        ) : null}
        {target.manualOverride ? (
          <ToneBadge tone="-warning">
            {tr('pages.tokenRoutes.routeCard.manualconfiguration')}
          </ToneBadge>
        ) : null}
      </div>
      <RouteSuccessFailStat successCount={target.successCount} failCount={target.failCount} />
    </div>
  );
}

function renderDragOverlayNode(node: ReactNode) {
  if (typeof document === 'undefined' || !document.body) {
    return node;
  }
  return createPortal(node, document.body);
}

type SortableTargetShellProps = {
  target: RouteEndpointTarget;
  bucketIndex: number;
  targetIndex: number;
  bucketTargetCount: number;
  totalBucketCount: number;
  compact: boolean;
  readOnlyRoute: boolean;
  savingPriority: boolean;
  candidateView: RouteCandidateView;
  targetTokenDraft: Record<number, number>;
  updatingTarget: Record<number, boolean>;
  activeDragTargetId: number | null;
  decisionMap: Map<number, RouteDecisionCandidate>;
  exactRoute: boolean;
  loadingDecision: boolean;
  targetManagementDisabled: boolean;
  routeId: number;
  onTokenDraftChange: (targetId: number, tokenId: number) => void;
  onSaveToken: (routeId: number, targetId: number, accountId: number) => void;
  onDeleteTarget: (targetId: number, routeId: number) => void;
  onToggleTargetEnabled: (targetId: number, routeId: number, enabled: boolean) => void;
  onSiteBlockModel: (targetId: number, routeId: number) => void;
  railLabel: string;
  mobileRailLabel: string;
  railNodeStyle: CSSProperties;
  showCompactRailHeader: boolean;
  useDragOverlay: boolean;
};

function SortableTargetShell({
  target,
  bucketIndex,
  targetIndex,
  bucketTargetCount,
  totalBucketCount,
  compact,
  readOnlyRoute,
  savingPriority,
  candidateView,
  targetTokenDraft,
  updatingTarget,
  activeDragTargetId,
  decisionMap,
  exactRoute,
  loadingDecision,
  targetManagementDisabled,
  routeId,
  onTokenDraftChange,
  onSaveToken,
  onDeleteTarget,
  onToggleTargetEnabled,
  onSiteBlockModel,
  railLabel,
  mobileRailLabel,
  railNodeStyle,
  showCompactRailHeader,
  useDragOverlay,
}: SortableTargetShellProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: target.id,
    disabled: savingPriority || readOnlyRoute,
  });

  const tokenOptions = candidateView.tokenOptionsByAccountId[target.accountId] || [];
  const activeTokenId = targetTokenDraft[target.id] ?? target.tokenId ?? 0;
  const showDesktopRailHeader = !compact && targetIndex === 0;
  const showDesktopRailLine = !compact
    && (bucketIndex < totalBucketCount - 1 || targetIndex < bucketTargetCount - 1);
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
      data-testid="route-target-shell"
      data-target-id={target.id}
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

      <SortableRouteTargetRow
        target={target}
        displayPriority={bucketIndex}
        showPriorityBadge={compact}
        dragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
        dragHandleRef={setActivatorNodeRef}
        dragInProgress={activeDragTargetId != null}
        decisionCandidate={decisionMap.get(target.id)}
        isExactRoute={exactRoute}
        loadingDecision={loadingDecision}
        isSavingPriority={savingPriority}
        readOnly={readOnlyRoute}
        targetManagementDisabled={targetManagementDisabled}
        mobile={compact}
        tokenOptions={tokenOptions}
        activeTokenId={activeTokenId}
        isUpdatingToken={!!updatingTarget[target.id]}
        onTokenDraftChange={onTokenDraftChange}
        onSaveToken={() => onSaveToken(routeId, target.id, target.accountId)}
        onDeleteTarget={() => onDeleteTarget(target.id, routeId)}
        onToggleEnabled={(enabled) => onToggleTargetEnabled(target.id, routeId, enabled)}
        onSiteBlockModel={targetManagementDisabled ? undefined : () => onSiteBlockModel(target.id, routeId)}
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
  showCollapseAction = true,
  onToggleExpand,
  onEdit,
  onDelete,
  onToggleEnabled,
  onClearCooldown,
  clearingCooldown,
  onRoutingStrategyChange,
  updatingRoutingStrategy,
  targets,
  loadingTargets,
  routeDecision,
  loadingDecision,
  candidateView,
  targetTokenDraft,
  updatingTarget,
  savingPriority,
  onTokenDraftChange,
  onSaveToken,
  onDeleteTarget,
  onToggleTargetEnabled,
  onTargetDragEnd,
  missingTokenSiteItems,
  missingTokenGroupItems,
  onCreateTokenForMissing,
  onAddTarget,
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
  const readOnlyRoute = route.kind === 'zero_target' || route.readOnly === true || route.isVirtual === true;
  const targetManagementDisabled = explicitGroupRoute;
  const title = resolveRouteTitle(route);
  const routingStrategy = normalizeRouteRoutingStrategyValue(route.routingStrategy);
  const routingStrategyDescription = getRouteRoutingStrategyDescription(routingStrategy);
  const routingStrategyHint = getRouteRoutingStrategyHint(routingStrategy);
  const hasCachedDecisionSnapshot = !!route.decisionSnapshot;
  const cachedDecisionTooltip = route.decisionRefreshedAt
    ? `${tr('pages.tokenRoutes.routeCard.lastRefreshed')}: ${formatDateTimeMinuteLocal(route.decisionRefreshedAt)}`
    : undefined;
  const showAddTargetButton = !readOnlyRoute && !targetManagementDisabled;
  const showMissingTokenHints = !targetManagementDisabled && (missingTokenSiteItems.length > 0 || missingTokenGroupItems.length > 0);
  const routeUnits = collectRouteUnits(targets);
  const routingStrategyOptions = [
    {
      value: 'weighted',
      label: tr('pages.tokenRoutes.manualRoutePanel.weightedRandom'),
      description: getRouteRoutingStrategyDescription('weighted'),
    },
    {
      value: 'round_robin',
      label: tr('pages.oAuthManagement.roundRobin'),
      description: getRouteRoutingStrategyDescription('round_robin'),
    },
    {
      value: 'stable_first',
      label: tr('pages.settings.stableFirst'),
      description: getRouteRoutingStrategyDescription('stable_first'),
    },
  ] as const;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const decisionMap = new Map<number, RouteDecisionCandidate>(
    (routeDecision?.candidates || []).map((c) => [c.targetId, c]),
  );

  const priorityBuckets = buildPriorityBuckets(targets || []);
  const priorityRailSections = buildPriorityRailSections(targets || []);
  const [activeDragTargetId, setActiveDragTargetId] = useState<number | null>(null);
  const [activeDragRowWidth, setActiveDragRowWidth] = useState<number | null>(null);
  const useDragOverlay = compact && detailPanel;

  const clearDragState = () => {
    setActiveDragTargetId(null);
    setActiveDragRowWidth(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const nextId = Number(event.active.id);
    setActiveDragTargetId(Number.isFinite(nextId) ? nextId : null);
    setActiveDragRowWidth(event.active.rect?.current?.initial?.width ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    onTargetDragEnd(route.id, event);
    clearDragState();
  };
  const activeDragTarget = activeDragTargetId == null
    ? null
    : (targets || []).find((target) => target.id === activeDragTargetId) || null;
  const activeDragTargetBucketIndex = activeDragTarget == null
    ? -1
    : priorityBuckets.findIndex((bucket) => bucket.targets.some((target) => target.id === activeDragTarget.id));
  const renderClearCooldownButton = () => {
    if (readOnlyRoute) return null;
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => onClearCooldown(route.id)} disabled={clearingCooldown}>
        {clearingCooldown ? tr('pages.tokenRoutes.routeCard.clearzh') : tr('pages.tokenRoutes.routeCard.clearCooldown')}
      </Button>
    );
  };
  const renderAddTargetButton = ({
    fullWidth = false,
    alignRight = false,
  }: {
    fullWidth?: boolean;
    alignRight?: boolean;
  } = {}) => (
    <Button type="button" variant="outline"
      onClick={() => onAddTarget(route.id)}
     
     
    >
      + {tr('pages.tokenRoutes.addtargets')}
    </Button>
  );

  // Collapsed card
  if (!expanded) {
    return (
      <Card
        className={`route-card-collapsed route--collapsed min-w-0 max-w-full ${summaryExpanded ? 'is-active' : ''}`.trim()}
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
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
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
              {tr('pages.tokenRoutes.notGenerated')}
            </ToneBadge>
          ) : (
            <Button
              type="button"
              variant={route.enabled ? 'secondary' : 'outline'}
              size="sm"
              onClick={(e) => { e.stopPropagation(); onToggleEnabled(route); }}
              data-tooltip={route.enabled ? tr('pages.tokenRoutes.routeCard.disabledRoutes') : tr('pages.tokenRoutes.routeCard.enabledRoutes')}
            >
              {route.enabled ? tr('pages.downstreamKeys.enabled') : tr('pages.downstreamKeys.disabled')}
            </Button>
          )}

          {explicitGroupRoute && explicitGroupSourceCount > 0 ? (
            <>
              <ToneBadge tone="-info">
                {explicitGroupSourceCount} {tr('pages.tokenRoutes.manualRoutePanel.model2')}
              </ToneBadge>
              <ToneBadge tone="-muted">
                {route.targetCount} {tr('pages.tokenRoutes.targets')}
              </ToneBadge>
            </>
          ) : (
            <ToneBadge tone="-info">
              {route.targetCount} {tr('pages.tokenRoutes.targets')}
            </ToneBadge>
          )}
          {hasCachedDecisionSnapshot ? (
            <ToneBadge tone="-success"
             
              data-tooltip={cachedDecisionTooltip}
             
            >
              {tr('pages.tokenRoutes.routeCard.cached')}
            </ToneBadge>
          ) : null}

          {readOnlyRoute ? (
            <ToneBadge tone="-warning">
              {tr('pages.tokenRoutes.routeCard.0Targets')}
            </ToneBadge>
          ) : (
            <ToneBadge tone="-muted"
              className="min-w-0 max-w-[132px] truncate"
             
              data-tooltip={`${getRouteRoutingStrategyLabel(routingStrategy)}：${routingStrategyDescription}`}
            >
              {getRouteRoutingStrategyLabel(routingStrategy)}
            </ToneBadge>
          )}
        </div>
      </Card>
    );
  }

  // Expanded card
  return (
    <Card
      className={cn(
        'route--expanded',
        'min-w-0 max-w-full',
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
                {tr('pages.tokenRoutes.notGenerated')}
              </ToneBadge>
            ) : (
              <Button
                type="button"
                variant={route.enabled ? 'secondary' : 'outline'}
                size="sm"
                onClick={(e) => { e.stopPropagation(); onToggleEnabled(route); }}
                data-tooltip={route.enabled ? tr('pages.tokenRoutes.routeCard.disabledRoutes') : tr('pages.tokenRoutes.routeCard.enabledRoutes')}
              >
                {route.enabled ? tr('pages.downstreamKeys.enabled') : tr('pages.downstreamKeys.disabled')}
              </Button>
            )}
            {explicitGroupRoute && explicitGroupSourceCount > 0 ? (
              <>
                <ToneBadge tone="-info">
                  {explicitGroupSourceCount} {tr('pages.tokenRoutes.manualRoutePanel.model2')}
                </ToneBadge>
                <ToneBadge tone="-muted">
                  {route.targetCount} {tr('pages.tokenRoutes.targets')}
                </ToneBadge>
              </>
            ) : (
              <ToneBadge tone="-info">
                {route.targetCount} {tr('pages.tokenRoutes.targets')}
              </ToneBadge>
            )}
            {hasCachedDecisionSnapshot ? (
              <ToneBadge tone="-success"
               
                data-tooltip={cachedDecisionTooltip}
               
              >
                {tr('pages.tokenRoutes.routeCard.cached')}
              </ToneBadge>
            ) : null}
            {readOnlyRoute && (
              <ToneBadge tone="-warning">
                {tr('pages.tokenRoutes.routeCard.0Targets')}
              </ToneBadge>
            )}
            {savingPriority && (
              <ToneBadge tone="-warning">{tr('pages.tokenRoutes.routeCard.savingOrder')}</ToneBadge>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {renderClearCooldownButton()}
            {!readOnlyRoute && (explicitGroupRoute || !exactRoute) && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(route)}>{tr('pages.tokenRoutes.manualRoutePanel.editgroups')}</Button>
            )}
            {!readOnlyRoute && <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(route.id)}>{tr('pages.tokenRoutes.routeCard.deleteRoute')}</Button>}
            {showCollapseAction ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => onToggleExpand(route.id)}
                data-tooltip={tr('pages.accounts.collapse')}
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
            ) : null}
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
                <ToneBadge tone="-muted">{tr('pages.tokenRoutes.notGenerated')}</ToneBadge>
              ) : (
                <ToneBadge tone={route.enabled ? 'success' : 'muted'}>
                  {route.enabled ? tr('pages.downstreamKeys.enabled') : tr('pages.downstreamKeys.disabled')}
                </ToneBadge>
              )}
              <ToneBadge tone="-info">
                {route.targetCount} {tr('pages.tokenRoutes.targets')}
              </ToneBadge>
              {hasCachedDecisionSnapshot ? (
                <ToneBadge tone="-success"
                 
                  data-tooltip={cachedDecisionTooltip}
                 
                >
                  {tr('pages.tokenRoutes.routeCard.cached')}
                </ToneBadge>
              ) : null}
              {explicitGroupRoute && explicitGroupSourceCount > 0 ? (
                <ToneBadge tone="-muted">
                  {explicitGroupSourceCount} {tr('pages.tokenRoutes.manualRoutePanel.model2')}
                </ToneBadge>
              ) : null}
              {savingPriority ? <ToneBadge tone="-warning">{tr('pages.tokenRoutes.routeCard.savingOrder')}</ToneBadge> : null}
            </div>
            {!readOnlyRoute && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {renderClearCooldownButton()}
                {(explicitGroupRoute || !exactRoute) && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(route)}>{tr('pages.tokenRoutes.manualRoutePanel.editgroups')}</Button>
                )}
                <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(route.id)}>{tr('pages.tokenRoutes.routeCard.deleteRoute')}</Button>
                {detailPanel && showCollapseAction && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onToggleExpand(route.id)}
                  >
                    {tr('pages.proxyLogs.collapsedetails')}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {!compact && explicitGroupRoute ? (
        <div className="mb-1.5 text-xs leading-snug text-muted-foreground">
          {tr('pages.tokenRoutes.routeCard.groupAggregatesMultipleSourceModelsIntoOne')}
        </div>
      ) : !compact && !exactRoute ? (
        <div className="mb-1.5 text-xs leading-snug text-muted-foreground">
          {tr('pages.tokenRoutes.routeCard.wildcardRoutesDecidePerRequestPriorityBuckets')}
        </div>
      ) : null}

      {routeUnits.length > 0 ? (
        <div className="mb-2 flex flex-col gap-1.5">
          <div className="text-xs text-muted-foreground">
            {tr('pages.tokenRoutes.routeCard.oauthRoutes')}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {routeUnits.map((routeUnit) => (
              <ToneBadge
                tone="-info"
                key={`route-unit-${String(routeUnit.id)}`}
                title={tr('pages.tokenRoutes.routeCard.routeUnitTitle')
                  .replace('{name}', routeUnit.name?.trim() || tr('pages.tokenRoutes.routeCard.oauthRoutes'))
                  .replace('{count}', String(routeUnit.memberCount))
                  .replace('{strategy}', getRouteUnitStrategyLabel(routeUnit.strategy))}
              >
                {(routeUnit.name?.trim() || tr('pages.tokenRoutes.routeCard.oauthRoutes'))} · {routeUnit.memberCount} {tr('pages.tokenRoutes.routeCard.members')} {getRouteUnitStrategyLabel(routeUnit.strategy)}
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
                  {tr('pages.settings.routesstrategy')}
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
                    placeholder={tr('pages.tokenRoutes.manualRoutePanel.selectroutesstrategy')}
                    emptyLabel={tr('pages.tokenRoutes.routeCard.noAvailableStrategies')}
                  />
                </div>
              </div>
              {showAddTargetButton ? renderAddTargetButton({ alignRight: true }) : null}
            </>
          ) : (
            <>
              <div className="text-xs text-muted-foreground" data-tooltip={undefined}>
                {tr('pages.settings.routesstrategy')}
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
                  placeholder={tr('pages.tokenRoutes.manualRoutePanel.selectroutesstrategy')}
                  emptyLabel={tr('pages.tokenRoutes.routeCard.noAvailableStrategies')}
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

      {/* Missing token hints + Add target button */}
      <div className={cn('mb-2 flex flex-wrap justify-between gap-1.5', compact ? 'flex-col items-stretch' : 'flex-row items-start')}>
        {showMissingTokenHints ? (
          <div className="flex flex-1 flex-col gap-1">
            {missingTokenSiteItems.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.routeCard.sites')}:</span>
                {missingTokenSiteItems.map((item) => (
                  <Button
                    key={`missing-${route.id}-${item.key}`}
                    type="button"
                    onClick={() => onCreateTokenForMissing(item.accountId, routePattern)}
                    variant="secondary"
                    size="sm"
                    data-tooltip={tr('pages.tokenRoutes.routeCard.createTokenTooltip')
                      .replace('{site}', item.siteName)
                      .replace('{account}', item.accountLabel)}
                  >
                    {item.siteName}
                  </Button>
                ))}
              </div>
            )}
            {missingTokenGroupItems.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.routeCard.missingGroup')}:</span>
                {missingTokenGroupItems.map((item) => (
                  <Button
                    key={`missing-group-${route.id}-${item.key}`}
                    type="button"
                    onClick={() => onCreateTokenForMissing(item.accountId, routePattern)}
                    variant="secondary"
                    size="sm"
                    data-tooltip={[
                      tr('pages.tokenRoutes.routeCard.missingGroupTooltip').replace('{groups}', item.missingGroups.join(tr('pages.tokenRoutes.listSeparator')) || tr('pages.accounts.unknown2')),
                      item.availableGroups.length > 0
                        ? tr('pages.tokenRoutes.routeCard.coveredGroupsTooltip').replace('{groups}', item.availableGroups.join(tr('pages.tokenRoutes.listSeparator')))
                        : '',
                      item.groupCoverageUncertain ? tr('pages.tokenRoutes.routeCard.currentGroupCoverageUncertain') : '',
                    ].filter(Boolean).join('')}
                  >
                    {item.siteName}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ) : (!compact && showAddTargetButton ? <div /> : null)}
        {!compact && showAddTargetButton ? renderAddTargetButton() : null}
      </div>

      {/* Target list */}
      {loadingTargets ? (
        <div className="flex items-center gap-2 py-2">
          <LoaderCircle className="size-4 animate-spin" />
          <span className="text-sm text-muted-foreground">{tr('pages.modelTester.targetszh')}</span>
        </div>
      ) : targets && targets.length > 0 ? (
        <div className="flex flex-col gap-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragCancel={clearDragState}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={(targets || []).map((target) => target.id)} strategy={translateOnlyRectSortingStrategy}>
              <div
                data-testid="route-target-sortable-list"
                className={compact ? 'flex flex-col gap-2' : 'flex flex-col gap-1'}
              >
                {priorityBuckets.map((bucket, bucketIndex) => {
                  const railSection = priorityRailSections[bucketIndex];
                  const railLabel = `P${bucketIndex} · ${bucket.targets.length}`;
                  const mobileRailLabel = `${railLabel} ${tr('pages.tokenRoutes.targets')}`;
                  const railNodeStyle = buildPriorityRailNodeStyle(bucketIndex, false);
                  const showStandaloneCompactRailHeader = compact && detailPanel;
                  const showNewLayerTarget = activeDragTargetId != null
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

                      {bucket.targets.map((target, targetIndex) => {
                        return (
                          <SortableTargetShell
                            key={target.id}
                            target={target}
                            bucketIndex={bucketIndex}
                            targetIndex={targetIndex}
                            bucketTargetCount={bucket.targets.length}
                            totalBucketCount={priorityBuckets.length}
                            compact={compact}
                            readOnlyRoute={readOnlyRoute}
                            savingPriority={savingPriority}
                            candidateView={candidateView}
                            targetTokenDraft={targetTokenDraft}
                            updatingTarget={updatingTarget}
                            activeDragTargetId={activeDragTargetId}
                            decisionMap={decisionMap}
                            exactRoute={exactRoute}
                            loadingDecision={loadingDecision}
                            targetManagementDisabled={targetManagementDisabled}
                            routeId={route.id}
                            onTokenDraftChange={onTokenDraftChange}
                            onSaveToken={onSaveToken}
                            onDeleteTarget={onDeleteTarget}
                            onToggleTargetEnabled={onToggleTargetEnabled}
                            onSiteBlockModel={onSiteBlockModel}
                            railLabel={railSection ? `P${bucketIndex} · ${railSection.targetCount}` : railLabel}
                            mobileRailLabel={mobileRailLabel}
                            railNodeStyle={railNodeStyle}
                            showCompactRailHeader={!showStandaloneCompactRailHeader && targetIndex === 0}
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
                {activeDragTarget ? (
                  <PriorityDragPreview
                    target={activeDragTarget}
                    displayPriority={Math.max(0, activeDragTargetBucketIndex)}
                    width={activeDragRowWidth}
                  />
                ) : null}
              </DragOverlay>,
            ) : null}
          </DndContext>
        </div>
      ) : (
        <EmptyStateBlock
          className={cn('rounded-md border bg-muted/20', compact ? 'p-4' : 'p-6')}
          title={readOnlyRoute ? tr('pages.tokenRoutes.routeCard.nonetargetsConfigurationRoutes') : tr('pages.tokenRoutes.routeCard.nonetargets')}
        />
      )}
    </Card>
  );
}

function buildTargetInteractionSignature(
  targets: RouteEndpointTarget[] | undefined,
  targetTokenDraft: Record<number, number>,
  updatingTarget: Record<number, boolean>,
): string {
  if (!Array.isArray(targets) || targets.length === 0) return '';
  return targets
    .map((target) => `${target.id}:${targetTokenDraft[target.id] ?? ''}:${updatingTarget[target.id] ? 1 : 0}`)
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
    || prev.showCollapseAction !== next.showCollapseAction
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
    || prev.onDeleteTarget !== next.onDeleteTarget
    || prev.onToggleTargetEnabled !== next.onToggleTargetEnabled
    || prev.onTargetDragEnd !== next.onTargetDragEnd
    || prev.onCreateTokenForMissing !== next.onCreateTokenForMissing
    || prev.onAddTarget !== next.onAddTarget
    || prev.onSiteBlockModel !== next.onSiteBlockModel
    || prev.onToggleSourceGroup !== next.onToggleSourceGroup
    || prev.clearingCooldown !== next.clearingCooldown
    || prev.updatingRoutingStrategy !== next.updatingRoutingStrategy
    || prev.savingPriority !== next.savingPriority
    || prev.loadingTargets !== next.loadingTargets
    || prev.loadingDecision !== next.loadingDecision
    || prev.routeDecision !== next.routeDecision
    || prev.candidateView !== next.candidateView
    || prev.missingTokenSiteItems !== next.missingTokenSiteItems
    || prev.missingTokenGroupItems !== next.missingTokenGroupItems
    || prev.targets !== next.targets
  ) {
    return false;
  }

  return buildTargetInteractionSignature(prev.targets, prev.targetTokenDraft, prev.updatingTarget)
    === buildTargetInteractionSignature(next.targets, next.targetTokenDraft, next.updatingTarget);
}

const RouteCard = memo(RouteCardInner, areRouteCardPropsEqual);
export default RouteCard;
