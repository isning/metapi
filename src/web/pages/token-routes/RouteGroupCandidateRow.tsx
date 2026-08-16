import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type Ref,
} from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';

import type {
  RouteGroupManagementCandidate,
  RouteGroupManagementFallbackStage,
  RouteGroupManagementListItem,
} from '../../../shared/routeGroupManagement.js';
import { api } from '../../api.js';
import ToneBadge from '../../components/ToneBadge.js';
import { useToast } from '../../components/Toast.js';
import { Button } from '../../components/ui/button/index.js';
import { Input } from '../../components/ui/input/index.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select/index.js';
import { Switch } from '../../components/ui/switch/index.js';
import { tr } from '../../i18n.js';
import { DragHandleButton } from './DragHandleButton.js';
import { FailureBackoffEditor } from './FailureBackoffEditor.js';
import {
  routeGroupCapabilities,
  routeGroupCommandErrorMessage,
} from './routeGroupPresentation.js';

export function RouteGroupCandidateRow({
  group,
  stage,
  stages,
  candidate,
  dragging = false,
  dragHandleProps,
  dragHandleRef,
  onDetailChanged,
  onSummaryChanged,
  onRestoreAutomatic,
}: {
  group: RouteGroupManagementListItem;
  stage: RouteGroupManagementFallbackStage;
  stages: RouteGroupManagementFallbackStage[];
  candidate: RouteGroupManagementCandidate;
  dragging?: boolean;
  dragHandleProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  dragHandleRef?: Ref<HTMLButtonElement>;
  onDetailChanged: () => void;
  onSummaryChanged: () => void;
  onRestoreAutomatic: (candidateId: string) => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [weightInput, setWeightInput] = useState(String(candidate.weight));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const endpointCandidate =
    candidate.kind === 'execution_endpoint' ? candidate : null;
  const primaryTarget = endpointCandidate?.targets[0] || null;
  const referenceCandidate = candidate.kind === 'route_group' ? candidate : null;
  const candidateLabel = endpointCandidate
    ? primaryTarget?.account.username || endpointCandidate.modelName ||
      tr('pages.tokenRoutes.accountWithId').replace(
        '{id}',
        String(primaryTarget?.accountId || ''),
      )
    : referenceCandidate!.referencedRouteGroup.label;
  const capabilities = routeGroupCapabilities(group);

  useEffect(() => {
    setWeightInput(String(candidate.weight));
  }, [candidate.id, candidate.weight]);

  const update = async (data: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api.updateRouteGroupMember(group.id, candidate.id, data);
      if (Object.prototype.hasOwnProperty.call(data, 'enabled')) {
        onSummaryChanged();
      } else {
        onDetailChanged();
      }
    } catch (error) {
      toast.error(
        routeGroupCommandErrorMessage(
          error,
          'pages.tokenRoutes.candidateStatusFailed',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteRouteGroupCandidate(group.id, candidate.id);
      toast.success(tr('pages.tokenRoutes.candidateRemoved'));
      onSummaryChanged();
    } catch (error) {
      toast.error(
        routeGroupCommandErrorMessage(
          error,
          'pages.tokenRoutes.failedRemoveCandidate',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const move = async (stageId: string) => {
    if (!stageId || stageId === stage.id) return;
    setBusy(true);
    try {
      await api.moveRouteGroupCandidatesToFallbackStages(
        group.id,
        [{ id: candidate.id, stageId }],
        [candidate.id],
      );
      onDetailChanged();
    } catch (error) {
      toast.error(
        routeGroupCommandErrorMessage(
          error,
          'pages.tokenRoutes.fallbackStageUpdateFailed',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const restoreAutomatic = async () => {
    setBusy(true);
    try {
      await onRestoreAutomatic(candidate.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-layer-root
      className={`grid min-w-0 gap-2 rounded-lg border bg-card px-2 py-1.5 shadow-sm transition-colors ${candidate.enabled ? '' : 'opacity-60'} ${dragging ? 'bg-muted opacity-90 shadow-md' : ''}`}
    >
      <div className="grid min-w-0 items-center gap-1.5 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
          <DragHandleButton
            ref={dragHandleRef}
            {...dragHandleProps}
            data-testid={`route-group-candidate-drag-handle-${candidate.id}`}
            disabled={busy}
            data-tooltip={
              dragging
                ? undefined
                : tr(
                    'pages.tokenRoutes.sortableCandidateRow.dragDropAdjustFallbackStages',
                  )
            }
            aria-label={tr(
              'pages.tokenRoutes.sortableCandidateRow.dragDropAdjustFallbackStages',
            )}
          />
          <span className="min-w-0 truncate font-semibold text-foreground">
            {candidateLabel}
          </span>
          {endpointCandidate ? (
            <>
              <ToneBadge tone="-muted">
                {Array.from(new Set(endpointCandidate.targets
                  .map((target) => target.site.name)
                  .filter(Boolean))).join(', ') ||
                  tr('pages.proxyLogs.unknownSite')}
              </ToneBadge>
              {endpointCandidate.targets.length > 1 ? (
                <ToneBadge tone="">+{endpointCandidate.targets.length - 1}</ToneBadge>
              ) : (
                <ToneBadge tone="">
                  {tr('pages.tokenRoutes.routeCard.currentlyEffective')}
                  {primaryTarget?.token?.name || tr('pages.tokens.noToken')}
                </ToneBadge>
              )}
              {endpointCandidate.modelName ? (
                <ToneBadge tone="-info">
                  {endpointCandidate.modelName}
                </ToneBadge>
              ) : null}
            </>
          ) : (
            <>
              <ToneBadge tone="-muted">
                {tr('pages.tokenRoutes.routeGroupSources')}
              </ToneBadge>
              {referenceCandidate!.referencedRouteGroup.modelName ? (
                <ToneBadge tone="-info">
                  {referenceCandidate!.referencedRouteGroup.modelName}
                </ToneBadge>
              ) : null}
            </>
          )}
          {group.kind === 'automatic' && candidate.manualOverride ? (
            <>
              <ToneBadge tone="-warning">
                {tr('pages.tokenRoutes.routeCard.manuallyAdjusted')}
              </ToneBadge>
              <Button
                data-testid={`route-group-candidate-restore-${candidate.id}`}
                type="button"
                size="icon"
                variant="ghost"
                disabled={busy}
                onClick={() => void restoreAutomatic()}
                data-tooltip={tr(
                  'pages.tokenRoutes.routeCard.restoreAutomaticCandidate',
                )}
                aria-label={tr(
                  'pages.tokenRoutes.routeCard.restoreAutomaticCandidate',
                )}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            </>
          ) : null}
          {!candidate.enabled ? (
            <ToneBadge tone="-muted">
              {tr('pages.accounts.disabled2')}
            </ToneBadge>
          ) : null}
        </div>
        {endpointCandidate ? (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {tr('pages.tokenRoutes.routeCard.successFailed')}{' '}
            <span className="font-semibold text-foreground">
              {candidate.successCount || 0}
            </span>
            <span className="mx-0.5">/</span>
            <span className="font-semibold text-destructive">
              {candidate.failCount || 0}
            </span>
          </span>
        ) : null}
        <Button
          data-testid={`route-group-candidate-edit-${candidate.id}`}
          size="sm"
          type="button"
          variant="ghost"
          onClick={() => setDetailsOpen((current) => !current)}
        >
          {detailsOpen
            ? tr('pages.accounts.collapse')
            : tr('pages.accounts.edit')}
        </Button>
      </div>
      {detailsOpen ? (
        <div className="grid min-w-0 gap-2 border-t pt-2">
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_120px_auto] sm:items-center">
            <label className="grid min-w-0 grid-cols-[auto_minmax(84px,1fr)] items-center gap-2 text-xs text-muted-foreground">
              <span>{tr('pages.tokenRoutes.weight')}</span>
              <Input
                aria-label={tr('pages.tokenRoutes.weight')}
                className="h-8 min-w-0"
                type="number"
                value={weightInput}
                disabled={busy || !capabilities.canEditCandidateControl}
                onChange={(event) => setWeightInput(event.currentTarget.value)}
                onBlur={() => {
                  const value = Number(weightInput);
                  if (Number.isFinite(value) && value !== candidate.weight)
                    void update({ weight: value });
                }}
              />
            </label>
            <Select
              value={stage.id}
              disabled={busy || !capabilities.canEditCandidateControl}
              onValueChange={(value) => void move(value)}
            >
              <SelectTrigger
                aria-label={tr('pages.tokenRoutes.fallbackStage')}
                className="h-8 w-full text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stages.map((item, index) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label ||
                      `${tr('pages.tokenRoutes.fallbackStage')} ${index + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center justify-end gap-1">
              <Switch
                checked={candidate.enabled}
                disabled={busy || !capabilities.canEditCandidateControl}
                onCheckedChange={(enabled) => void update({ enabled })}
                aria-label={tr('pages.tokenRoutes.candidateToggle').replace(
                  '{candidate}',
                  candidateLabel,
                )}
              />
              <Button
                size="icon"
                variant="ghost"
                disabled={busy || !capabilities.canCreateOrDeleteCandidate}
                onClick={() => void remove()}
                aria-label={tr('pages.tokenRoutes.deleteCandidate').replace(
                  '{candidate}',
                  candidateLabel,
                )}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
          <FailureBackoffEditor
            value={candidate.failureBackoff}
            disabled={busy}
            onChange={(failureBackoff) => void update({ failureBackoff })}
          />
        </div>
      ) : null}
    </div>
  );
}
