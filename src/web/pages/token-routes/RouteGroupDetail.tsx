import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronUp, Plus, RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react';

import type {
  RouteGroupManagementCandidate,
  RouteGroupManagementFallbackStage,
  RouteGroupManagementListItem,
} from '../../../shared/routeGroupManagement.js';
import type { DispatcherPolicy } from '../../../shared/routeGraph.js';
import { api, type DispatchPolicyRegistryPayload } from '../../api.js';
import { BrandGlyph, InlineBrandIcon } from '../../components/BrandIcon.js';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import ToneBadge from '../../components/ToneBadge.js';
import { useToast } from '../../components/Toast.js';
import { Button } from '../../components/ui/button/index.js';
import { ButtonGroup } from '../../components/ui/button-group/index.js';
import { Card } from '../../components/ui/card/index.js';
import { Input } from '../../components/ui/input/index.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select/index.js';
import { Skeleton } from '../../components/ui/skeleton/index.js';
import { Switch } from '../../components/ui/switch/index.js';
import { tr } from '../../i18n.js';
import { DispatcherPolicySelect } from './DispatcherPolicySelect.js';
import { DragHandleButton } from './DragHandleButton.js';
import { RouteGroupCandidateRow } from './RouteGroupCandidateRow.js';
import { RouteGroupCandidatePicker } from './RouteGroupCandidatePicker.js';
import {
  fallbackStageCollisionDetection,
  fallbackStageIdFromNewDropTarget,
  newFallbackStageDropTargetId,
} from './routeGroupDnd.js';
import {
  changedFallbackStageCandidatePlacements,
  fallbackStageIdFromDropTarget,
  moveFallbackStageCandidate,
  moveFallbackStageCandidateToNewStage,
} from './fallbackStageOrdering.js';
import {
  labelForRouteGroup as labelForGroup,
  routeGroupBrand as groupBrand,
  routeGroupCapabilities,
  routeGroupCommandErrorMessage,
  routeGroupModelName as groupModelName,
} from './routeGroupPresentation.js';
import { useRouteGroupFallbackStages } from './useRouteGroupFallbackStages.js';

function fallbackStageLabel(
  stage: RouteGroupManagementFallbackStage,
  stages: RouteGroupManagementFallbackStage[],
): string {
  const index = stages.findIndex((item) => item.id === stage.id);
  return (
    stage.label ||
    `${tr('pages.tokenRoutes.fallbackStage')} ${Math.max(0, index) + 1}`
  );
}

function CandidateDragPreview({
  candidate,
  width,
}: {
  candidate: RouteGroupManagementCandidate;
  width: number | null;
}) {
  const label =
    candidate.kind === "execution_endpoint"
      ? candidate.targets[0]?.account.username || candidate.modelName ||
        tr("pages.tokenRoutes.accountWithId").replace(
          "{id}",
          String(candidate.targets[0]?.accountId || ""),
        )
      : candidate.referencedRouteGroup.label;
  const detail =
    candidate.kind === "execution_endpoint"
      ? candidate.targets[0]?.site.name || tr("pages.proxyLogs.unknownSite")
      : candidate.referencedRouteGroup.modelName ||
        tr("pages.tokenRoutes.routeGroupSources");
  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-lg border bg-card p-2 shadow-lg"
      style={{ width: width || undefined }}
    >
      <DragHandleButton disabled aria-hidden />
      <span className="min-w-0 truncate text-sm font-semibold">{label}</span>
      <ToneBadge tone="-muted">{detail}</ToneBadge>
    </div>
  );
}

function RouteGroupNewFallbackStageDropZone({
  afterStageId,
  active,
}: {
  afterStageId: string;
  active: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: newFallbackStageDropTargetId(afterStageId),
    disabled: !active,
  });
  return (
    <div
      ref={setNodeRef}
      data-testid={`route-group-new-stage-drop-zone-${afterStageId}`}
      data-active={active ? "true" : "false"}
      data-drag-over={isOver ? "true" : "false"}
      aria-hidden={!active}
      className={`grid min-w-0 transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${active ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0"}`}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={`grid grid-cols-[86px_minmax(0,1fr)] items-center gap-3 rounded-md py-1 transition-[background-color,box-shadow] duration-150 ${isOver ? "bg-muted/40 shadow-[inset_0_0_0_1px_var(--color-border)]" : ""}`}
        >
          <div className="h-px bg-border" />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="h-px flex-1 border-t border-dashed" />
            <span className="rounded-full border border-dashed px-2 py-0.5 font-medium">
              {tr("pages.tokenRoutes.addFallbackStage")}
            </span>
            <div className="h-px flex-1 border-t border-dashed" />
          </div>
        </div>
      </div>
    </div>
  );
}

function RouteGroupStageDropZone({
  stageId,
  children,
}: {
  stageId: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `fallback-stage:${stageId}`,
  });
  return (
    <section
      ref={setNodeRef}
      data-testid={`route-group-stage-${stageId}`}
      data-drag-over={isOver ? "true" : "false"}
      className={`grid min-w-0 gap-1.5 rounded-md pb-1.5 transition-[background-color,box-shadow] ${isOver ? "bg-muted/40 shadow-[inset_0_0_0_1px_var(--color-border)]" : ""}`}
    >
      {children}
    </section>
  );
}

function SortableRouteGroupCandidateRow({
  group,
  stage,
  stages,
  candidate,
  onDetailChanged,
  onSummaryChanged,
  placementPending,
  onRestoreAutomatic,
}: {
  group: RouteGroupManagementListItem;
  stage: RouteGroupManagementFallbackStage;
  stages: RouteGroupManagementFallbackStage[];
  candidate: RouteGroupManagementCandidate;
  onDetailChanged: () => void;
  onSummaryChanged: () => void;
  placementPending: boolean;
  onRestoreAutomatic: (candidateId: string) => Promise<void>;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: candidate.id,
    disabled: placementPending,
  });
  return (
    <div
      ref={setNodeRef}
      data-testid={`route-group-candidate-drag-surface-${candidate.id}`}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.45 : undefined,
      }}
    >
      <RouteGroupCandidateRow
        group={group}
        stage={stage}
        stages={stages}
        candidate={candidate}
        dragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
        dragHandleRef={setActivatorNodeRef}
        onDetailChanged={onDetailChanged}
        onSummaryChanged={onSummaryChanged}
        onRestoreAutomatic={onRestoreAutomatic}
      />
    </div>
  );
}

export function RouteGroupDetail({
  group,
  onSummaryChanged,
  onDeleted,
  onEdit,
  onOpenGraph,
  onCollapse,
  policyRegistry,
  showOpenGraphAction = false,
}: {
  group: RouteGroupManagementListItem;
  onSummaryChanged: () => void | Promise<void>;
  onDeleted: () => void;
  onEdit: () => void;
  onOpenGraph: () => void;
  onCollapse?: () => void;
  policyRegistry: DispatchPolicyRegistryPayload | null;
  showOpenGraphAction?: boolean;
}) {
  const toast = useToast();
  const {
    stagesByRouteGroupId,
    loadingStagesByRouteGroupId,
    loadStages,
    setStages,
  } = useRouteGroupFallbackStages();
  const [creatingStage, setCreatingStage] = useState(false);
  const [candidateCreateOpen, setCandidateCreateOpen] = useState(false);
  const [candidatePlacementPending, setCandidatePlacementPending] =
    useState(false);
  const [restoringAutomatic, setRestoringAutomatic] = useState(false);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(
    null,
  );
  const [activeCandidateDragWidth, setActiveCandidateDragWidth] = useState<
    number | null
  >(null);
  const stages = stagesByRouteGroupId[group.id];
  const stageLoading = loadingStagesByRouteGroupId[group.id];
  const refreshStages = useCallback(
    () => loadStages(group.id, true),
    [group.id, loadStages],
  );
  const refreshStagesAndSummary = useCallback(async () => {
    await Promise.all([refreshStages(), onSummaryChanged()]);
  }, [onSummaryChanged, refreshStages]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const moveCandidateByDrag = async (event: DragEndEvent) => {
    const activeCandidateId = String(event.active.id || "").trim();
    const overId = String(event.over?.id || "").trim();
    if (!activeCandidateId || !overId || !stages || fallbackFlowReadOnly)
      return;
    const newStageAfterId = fallbackStageIdFromNewDropTarget(overId);
    if (newStageAfterId) {
      const optimisticStages = moveFallbackStageCandidateToNewStage({
        stages,
        activeCandidateId,
        afterStageId: newStageAfterId,
        newStage: {
          id: crypto.randomUUID(),
          label: null,
          order: 0,
          enabled: true,
          dispatcherPolicy: null,
          candidateManagement: "explicit",
          candidates: [],
        },
      });
      if (!optimisticStages) return;
      const previousStages = stages;
      setCandidatePlacementPending(true);
      setStages(group.id, optimisticStages);
      try {
        const created = await api.createRouteGroupFallbackStage(group.id, {
          label: null,
          enabled: true,
          placement: {
            afterStageId: newStageAfterId,
            candidateId: activeCandidateId,
          },
        });
        setStages(group.id, created.stages);
      } catch (error) {
        setStages(group.id, previousStages);
        toast.error(routeGroupCommandErrorMessage(error, "pages.tokenRoutes.fallbackStageCreateFailed"));
      } finally {
        setCandidatePlacementPending(false);
      }
      return;
    }
    const nextStages = moveFallbackStageCandidate({
      stages,
      activeCandidateId,
      overId,
    });
    if (!nextStages) return;
    const placementUpdates = changedFallbackStageCandidatePlacements(
      stages,
      nextStages,
    );
    const previousStages = stages;
    setCandidatePlacementPending(true);
    setStages(group.id, nextStages);
    try {
      const moved = await api.moveRouteGroupCandidatesToFallbackStages(
        group.id,
        placementUpdates,
        [activeCandidateId],
      );
      setStages(group.id, moved.stages);
    } catch (error) {
      setStages(group.id, previousStages);
      toast.error(routeGroupCommandErrorMessage(error, "pages.tokenRoutes.fallbackStageUpdateFailed"));
    } finally {
      setCandidatePlacementPending(false);
    }
  };
  const clearCandidateDrag = () => {
    setActiveCandidateId(null);
    setActiveCandidateDragWidth(null);
  };
  const beginCandidateDrag = (event: DragStartEvent) => {
    setActiveCandidateId(String(event.active.id || "").trim() || null);
    setActiveCandidateDragWidth(
      event.active.rect.current.initial?.width || null,
    );
  };
  useEffect(() => {
    void loadStages(group.id);
  }, [group.id, loadStages]);
  const addStage = async () => {
    setCreatingStage(true);
    try {
      await api.createRouteGroupFallbackStage(group.id, {
        label: null,
        enabled: true,
      });
      await refreshStages();
    } catch (error) {
      toast.error(routeGroupCommandErrorMessage(error, "pages.tokenRoutes.fallbackStageCreateFailed"));
    } finally {
      setCreatingStage(false);
    }
  };
  const reorder = async (stageId: string, direction: -1 | 1) => {
    if (!stages) return;
    const index = stages.findIndex((stage) => stage.id === stageId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= stages.length) return;
    const ids = stages.map((stage) => stage.id);
    [ids[index], ids[nextIndex]] = [ids[nextIndex]!, ids[index]!];
    try {
      await api.reorderRouteGroupFallbackStages(group.id, ids);
      await refreshStages();
    } catch (error) {
      toast.error(routeGroupCommandErrorMessage(error, "pages.tokenRoutes.fallbackStageOrderFailed"));
    }
  };
  const deleteStage = async (stageId: string) => {
    try {
      await api.deleteRouteGroupFallbackStage(group.id, stageId);
      await refreshStages();
    } catch (error) {
      toast.error(routeGroupCommandErrorMessage(error, "pages.tokenRoutes.fallbackStageDeleteFailed"));
    }
  };
  const updateStagePolicy = async (
    stageId: string,
    dispatcherPolicy: DispatcherPolicy | null,
  ) => {
    try {
      await api.updateRouteGroupFallbackStage(group.id, stageId, {
        dispatcherPolicy,
      });
      await refreshStages();
    } catch (error) {
      toast.error(routeGroupCommandErrorMessage(error, "pages.tokenRoutes.fallbackStageUpdateFailed"));
    }
  };
  const updateGroup = async (data: Record<string, unknown>) => {
    try {
      await api.updateRouteGroup(group.id, data);
      await onSummaryChanged();
    } catch (error) {
      toast.error(routeGroupCommandErrorMessage(error, "pages.tokenRoutes.groupsfailed"));
    }
  };
  const clearFailureState = async () => {
    try {
      await api.clearRouteGroupFailureState(group.id);
      toast.success(tr("pages.tokenRoutes.routeCard.clearCooldown"));
    } catch (error) {
      toast.error(routeGroupCommandErrorMessage(error, "pages.tokenRoutes.clearroutescooldownfailed"));
    }
  };
  const restoreAutomaticCandidate = async (candidateId: string) => {
    try {
      const restored = await api.restoreAutomaticRouteGroupCandidate(
        group.id,
        candidateId,
      );
      setStages(group.id, restored.stages);
      toast.success(
        tr("pages.tokenRoutes.routeCard.restoreAutomaticCandidateComplete"),
      );
    } catch (error) {
      toast.error(routeGroupCommandErrorMessage(error, "pages.tokenRoutes.routeCard.restoreAutomaticFailed"));
    }
  };
  const restoreAllAutomaticCandidates = async () => {
    if (
      !globalThis.confirm(
        tr("pages.tokenRoutes.routeCard.restoreAutomaticAllConfirm"),
      )
    )
      return;
    setRestoringAutomatic(true);
    try {
      const restored = await api.restoreAutomaticRouteGroupCandidates(group.id);
      setStages(group.id, restored.stages);
      toast.success(
        tr("pages.tokenRoutes.routeCard.restoreAutomaticAllComplete").replace(
          "{count}",
          String(restored.restoredCount),
        ),
      );
    } catch (error) {
      toast.error(routeGroupCommandErrorMessage(error, "pages.tokenRoutes.routeCard.restoreAutomaticFailed"));
    } finally {
      setRestoringAutomatic(false);
    }
  };
  const removeGroup = async () => {
    if (!globalThis.confirm(tr("pages.tokenRoutes.confirmRemove"))) return;
    try {
      await api.deleteRouteGroup(group.id);
      toast.success(tr("pages.tokenRoutes.groupDeleted"));
      onDeleted();
    } catch (error) {
      toast.error(routeGroupCommandErrorMessage(error, "pages.tokenRoutes.failedDeleteRoute"));
    }
  };
  const title = labelForGroup(group);
  const modelName = groupModelName(group);
  const brand = groupBrand(group);
  const capabilities = routeGroupCapabilities(group);
  const fallbackFlowReadOnly = group.sourceSelection.kind === "model_pattern";
  // Automatic groups own their generated member fields, not their group-level
  // dispatcher overrides. The editor deliberately exposes only those overrides.
  const activeCandidate = activeCandidateId
    ? stages
        ?.flatMap((stage) => stage.candidates)
        .find((candidate) => candidate.id === activeCandidateId)
    : null;
  const hasManualAdjustments =
    group.kind === "automatic" &&
    (stages || []).some((stage) =>
      stage.candidates.some((candidate) => candidate.manualOverride),
    );
  // Match the original compact Route Card: identity, actions and fallback flow
  // share one expanded work surface in the desktop detail column.
  return (
    <section className="route-workbench grid min-h-[520px] min-w-0 max-w-full content-start">
      <Card className="route-group-detail-card route--expanded route--expanded-compact route--detail-panel grid min-w-0 max-w-full gap-3 p-2.5">
        <div
          data-testid="route-group-detail-header"
          className="mb-1 flex min-w-0 flex-wrap items-center justify-between gap-2 border-b pb-2.5"
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <code className="inline-flex min-w-0 max-w-full items-center gap-1.5 truncate rounded-md bg-muted px-2 py-0.5 text-sm font-semibold text-foreground">
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
              <span className="min-w-0 truncate">{title}</span>
            </code>
            {modelName !== title ? (
              <ToneBadge tone="-muted" title={modelName}>
                {modelName}
              </ToneBadge>
            ) : null}
            <Button
              type="button"
              variant={group.enabled ? "secondary" : "outline"}
              size="sm"
              onClick={() => void updateGroup({ enabled: !group.enabled })}
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
            <ToneBadge tone="-muted">
              {group.visibility === "public"
                ? tr("pages.tokenRoutes.routeGroupTabs.external")
                : tr("pages.tokenRoutes.routeGroupTabs.internal")}
            </ToneBadge>
            <ToneBadge tone="-info">
              {group.enabledCandidateCount}/{group.candidateCount}{" "}
              {tr("pages.tokenRoutes.candidates")}
            </ToneBadge>
          </div>
          <ButtonGroup className="shrink-0">
            {hasManualAdjustments ? (
              <Button
                data-testid="route-group-restore-all-automatic"
                size="sm"
                variant="outline"
                disabled={restoringAutomatic || candidatePlacementPending}
                onClick={() => void restoreAllAutomaticCandidates()}
              >
                <RotateCcw className="size-4" />
                {tr("pages.tokenRoutes.routeCard.restoreAutomaticAll")}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void clearFailureState()}
            >
              {tr("pages.tokenRoutes.routeCard.clearCooldown")}
            </Button>
            {showOpenGraphAction && (
              <Button size="sm" variant="outline" onClick={onOpenGraph}>
                {tr("pages.tokenRoutes.openGraph")}
              </Button>
            )}
            <Button
              data-testid="route-group-detail-edit"
              size="sm"
              variant="outline"
              onClick={onEdit}
            >
              {tr("pages.tokenRoutes.routeGroupEditor.edit")}
            </Button>
            {capabilities.canCreateOrDeleteCandidate && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void removeGroup()}
              >
                {tr("pages.tokenRoutes.routeCard.deleteRoute")}
              </Button>
            )}
            {onCollapse ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onCollapse}
                data-tooltip={tr("pages.accounts.collapse")}
                aria-label={tr("pages.accounts.collapse")}
              >
                <ChevronUp className="size-4" />
              </Button>
            ) : null}
          </ButtonGroup>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">
              {tr("pages.tokenRoutes.dispatchPolicy")}
            </span>
            <DispatcherPolicySelect
              value={group.dispatcherPolicy || { kind: "inherit_default" }}
              registry={policyRegistry}
              className="h-8 w-52 text-xs"
              onChange={(dispatcherPolicy) =>
                void updateGroup({
                  dispatcherPolicy: dispatcherPolicy || { kind: "inherit_default" },
                })
              }
            />
            {group.siteNames.slice(0, 3).map((site) => (
              <ToneBadge key={site} tone="-muted">
                {site}
              </ToneBadge>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refreshStagesAndSummary()}
            >
              <RefreshCw className="size-4" />
              {tr("common.refresh")}
            </Button>
            {capabilities.canCreateOrDeleteCandidate &&
              !fallbackFlowReadOnly &&
              (stages || []).some(
                (stage) => stage.candidateManagement === "explicit",
              ) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCandidateCreateOpen(true)}
                >
                  <Plus className="size-4" />
                  {tr("pages.tokenRoutes.addCandidates")}
                </Button>
              )}
            {!fallbackFlowReadOnly && (
              <Button
                size="sm"
                disabled={creatingStage || candidatePlacementPending}
                onClick={() => void addStage()}
              >
                <Plus className="size-4" />
                {tr("pages.tokenRoutes.addFallbackStage")}
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {tr("pages.tokenRoutes.fallbackStage")}
          </span>
          <span className="text-xs text-muted-foreground">
            {group.kind === "automatic"
              ? tr("pages.tokenRoutes.routeGroupOverrideDescription")
              : tr("pages.tokenRoutes.candidates")}
          </span>
        </div>
        {stageLoading && !stages ? (
          <div className="grid gap-2">
            {[1, 2].map((item) => (
              <Skeleton key={item} className="h-24 w-full" />
            ))}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={fallbackStageCollisionDetection}
            measuring={{
              droppable: { strategy: MeasuringStrategy.WhileDragging },
            }}
            onDragStart={beginCandidateDrag}
            onDragCancel={clearCandidateDrag}
            onDragEnd={(event) => {
              void moveCandidateByDrag(event);
              clearCandidateDrag();
            }}
          >
            <div className="grid min-w-0 gap-1.5">
              {(stages || []).map((stage, index) => {
                const isLastStage = index === (stages || []).length - 1;
                const label = fallbackStageLabel(stage, stages || []);
                const candidates = stage.candidates;
                const displayedCandidateCount =
                  stage.candidateManagement === "generated"
                    ? group.candidateCount
                    : candidates.length;
                return (
                  <Fragment key={stage.id}>
                    <RouteGroupStageDropZone stageId={stage.id}>
                      <div className="grid min-w-0 grid-cols-[86px_minmax(0,1fr)] gap-3">
                        <div
                          aria-hidden
                          className="flex w-[86px] flex-col items-center pt-0.5"
                        >
                          <div className="min-w-16 rounded-full border border-info/30 bg-info/10 px-2 py-1 text-center text-[11px] font-semibold leading-tight text-info">
                            P{index} · {displayedCandidateCount}
                          </div>
                          <div className="mt-1 text-center text-[11px] leading-tight text-muted-foreground">
                            {label}
                          </div>
                          {!isLastStage || displayedCandidateCount > 1 ? (
                            <div className="mt-1.5 w-px flex-1 bg-border" />
                          ) : null}
                        </div>
                        <div className="grid min-w-0 gap-1.5">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
                            {fallbackFlowReadOnly ? (
                              <span className="min-w-0 flex-1 truncate font-semibold">
                                {label}
                              </span>
                            ) : (
                              <Input
                                className="h-7 min-w-36 flex-1 text-xs"
                                defaultValue={stage.label || ""}
                                placeholder={tr(
                                  "pages.tokenRoutes.fallbackStage",
                                )}
                                onBlur={async (event) => {
                                  const nextLabel =
                                    event.currentTarget.value.trim() || null;
                                  if (nextLabel !== stage.label) {
                                    try {
                                      await api.updateRouteGroupFallbackStage(
                                        group.id,
                                        stage.id,
                                        { label: nextLabel },
                                      );
                                      await refreshStages();
                                    } catch (error) {
                                      toast.error(routeGroupCommandErrorMessage(
                                        error,
                                        "pages.tokenRoutes.fallbackStageUpdateFailed",
                                      ));
                                    }
                                  }
                                }}
                              />
                            )}
                            <ToneBadge tone="-muted" className="shrink-0">
                              {displayedCandidateCount}
                            </ToneBadge>
                            <DispatcherPolicySelect
                              value={stage.dispatcherPolicy}
                              registry={policyRegistry}
                              inheritMode="group"
                              disabled={fallbackFlowReadOnly}
                              className="h-7 w-44 text-xs"
                              onChange={(dispatcherPolicy) =>
                                void updateStagePolicy(
                                  stage.id,
                                  dispatcherPolicy,
                                )
                              }
                            />
                            {!fallbackFlowReadOnly ? (
                              <>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  disabled={index === 0}
                                  onClick={() => void reorder(stage.id, -1)}
                                  aria-label={tr("common.previous")}
                                >
                                  <ChevronUp className="size-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  disabled={isLastStage}
                                  onClick={() => void reorder(stage.id, 1)}
                                  aria-label={tr("common.next")}
                                >
                                  <ChevronDown className="size-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  disabled={(stages || []).length === 1}
                                  onClick={() => void deleteStage(stage.id)}
                                  aria-label={tr("common.delete")}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </>
                            ) : null}
                          </div>
                          <SortableContext
                            items={candidates.map((candidate) => candidate.id)}
                            strategy={verticalListSortingStrategy}
                          >
                            {candidates.length ? (
                              candidates.map((candidate) => (
                                <SortableRouteGroupCandidateRow
                                  key={candidate.id}
                                  group={group}
                                  stage={stage}
                                  stages={stages || []}
                                  candidate={candidate}
                                  onDetailChanged={() => void refreshStages()}
                                  onSummaryChanged={() =>
                                    void refreshStagesAndSummary()
                                  }
                                  placementPending={candidatePlacementPending}
                                  onRestoreAutomatic={restoreAutomaticCandidate}
                                />
                              ))
                            ) : stage.candidateManagement === "generated" ? (
                              <div className="flex min-w-0 items-center gap-3 rounded-md border bg-muted/20 p-4">
                                <Search className="size-4 shrink-0 text-info" />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium">
                                    {group.sourceSelection.kind ===
                                    "model_pattern"
                                      ? group.sourceSelection.pattern
                                      : tr(
                                          "pages.tokenRoutes.routeGroupEditor.patternSources",
                                        )}
                                  </div>
                                  <div className="mt-0.5 text-xs text-muted-foreground">
                                    {tr(
                                      "pages.tokenRoutes.routeGroupEditor.patternMatches",
                                    ).replace(
                                      "{count}",
                                      String(group.candidateCount),
                                    )}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <EmptyStateBlock
                                className="rounded-md border bg-muted/20 p-4"
                                title={tr("pages.tokenRoutes.noCandidates")}
                              />
                            )}
                          </SortableContext>
                        </div>
                      </div>
                    </RouteGroupStageDropZone>
                    {!fallbackFlowReadOnly ? (
                      <RouteGroupNewFallbackStageDropZone
                        afterStageId={stage.id}
                        active={activeCandidateId !== null}
                      />
                    ) : null}
                  </Fragment>
                );
              })}
            </div>
            {typeof document === "undefined"
              ? null
              : createPortal(
                  <DragOverlay adjustScale={false} dropAnimation={null}>
                    {activeCandidate ? (
                      <CandidateDragPreview
                        candidate={activeCandidate}
                        width={activeCandidateDragWidth}
                      />
                    ) : null}
                  </DragOverlay>,
                  document.body,
                )}
          </DndContext>
        )}
        <RouteGroupCandidatePicker
          group={group}
          stages={stages || []}
          open={candidateCreateOpen}
          onClose={() => setCandidateCreateOpen(false)}
          onCreated={() => void refreshStagesAndSummary()}
        />
      </Card>
    </section>
  );
}
