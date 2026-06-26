import { useState, type CSSProperties } from 'react';
import ModernSelect from '../../components/ModernSelect.js';
import type { SortableRouteTargetRowProps } from './types.js';
import {
  buildFixedTokenOptionDescription,
  buildFixedTokenOptionLabel,
  describeTokenBinding,
  resolveTokenBindingConnectionMode,
} from './tokenBindingPresentation.js';
import { getTargetDecisionState } from './utils.js';
import { Button } from '../../components/ui/button/index.js';
import { LoaderCircle } from 'lucide-react';
import ToneBadge from '../../components/ToneBadge.js';
import { cn } from '../../lib/utils.js';
import { DragHandleButton } from './DragHandleButton.js';

import { tr } from '../../i18n.js';
function getRouteUnitStrategyLabel(strategy: string | null | undefined): string {
  return strategy === 'stick_until_unavailable' ? tr('pages.oAuthManagement.notAvailable') : tr('pages.oAuthManagement.roundRobin');
}

function formatRouteUnitMemberLabel(member: { accountId: number; username: string | null; siteName: string | null }): string {
  const accountLabel = member.username?.trim() || `account-${member.accountId}`;
  const siteLabel = member.siteName?.trim();
  return siteLabel ? `${accountLabel} @ ${siteLabel}` : accountLabel;
}

function SuccessFailStat({
  successCount,
  failCount,
  className,
}: {
  successCount?: number | null;
  failCount?: number | null;
  className?: string;
}) {
  return (
    <span className={cn('whitespace-nowrap text-xs text-muted-foreground', className)}>
      {tr('pages.tokenRoutes.routeCard.successFailed')} <span className="font-semibold text-foreground">{successCount || 0}</span>
      <span className="mx-0.5 text-muted-foreground">/</span>
      <span className="font-semibold text-destructive">{failCount || 0}</span>
    </span>
  );
}

function ProbabilityIndicator({
  probability,
  tooltip,
}: {
  probability: number;
  tooltip?: string;
}) {
  const clamped = Math.max(0, Math.min(100, probability));
  return (
    <div className="inline-flex min-w-24 items-center gap-1.5">
      <div
        data-tooltip={tooltip}
        className="h-1 w-15 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn('h-full rounded-full transition-all', clamped > 0 ? 'bg-primary' : 'bg-border')}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span
        data-tooltip={tooltip}
        className="whitespace-nowrap text-xs tabular-nums text-muted-foreground"
      >
        {probability.toFixed(1)}%
      </span>
    </div>
  );
}

export function SortableRouteTargetRow({
  target,
  displayPriority,
  showPriorityBadge = true,
  dragging = false,
  dragHandleProps,
  dragHandleRef,
  decisionCandidate,
  isExactRoute,
  loadingDecision,
  isSavingPriority,
  readOnly = false,
  targetManagementDisabled = false,
  dragInProgress = false,
  mobile = false,
  tokenOptions,
  activeTokenId,
  isUpdatingToken,
  onTokenDraftChange,
  onSaveToken,
  onDeleteTarget,
  onToggleEnabled,
  onSiteBlockModel,
}: SortableRouteTargetRowProps) {
  const resolvedPriority = displayPriority ?? target.priority ?? 0;
  const managementLocked = readOnly || targetManagementDisabled;
  const suppressTooltips = dragInProgress || dragging;
  const rowClassName = cn(
    'rounded-lg border bg-card shadow-sm transition-colors',
    dragging && 'bg-muted opacity-90 shadow-md',
    target.enabled === false && 'opacity-60',
  );
  const decisionState = getTargetDecisionState(decisionCandidate, target, isExactRoute, loadingDecision);
  const tokenBinding = describeTokenBinding(
    tokenOptions,
    activeTokenId,
    target.token?.name ?? null,
    {
      connectionMode: resolveTokenBindingConnectionMode(target.account),
      accountName: target.account?.username || `account-${target.accountId}`,
    },
  );
  const routeUnit = target.routeUnit ?? null;
  const routeUnitName = routeUnit?.name?.trim() || tr('pages.tokenRoutes.routeCard.oauthRoutes');
  const routeUnitStrategyLabel = routeUnit ? getRouteUnitStrategyLabel(routeUnit.strategy) : '';
  const routeUnitMemberSummary = routeUnit?.members?.length
    ? routeUnit.members.map((member) => formatRouteUnitMemberLabel(member)).join('、')
    : null;
  const routeUnitMemberSummaryText = routeUnitMemberSummary
    ? tr('pages.tokenRoutes.sortableTargetRow.membersSummary').replace('{members}', routeUnitMemberSummary)
    : null;

  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);

  if (mobile) {
    return (
      <div data-layer-root className={cn(rowClassName, 'p-2')}>
        <div className="flex items-start gap-2">
          <DragHandleButton
            ref={dragHandleRef}
            {...dragHandleProps}
            disabled={isSavingPriority || managementLocked}
            data-tooltip={suppressTooltips ? undefined : (managementLocked ? tr('pages.tokenRoutes.sortableTargetRow.routesEdit') : tr('pages.tokenRoutes.sortableTargetRow.dragDropAdjustPriorityBuckets'))}
            aria-label={tr('pages.tokenRoutes.sortableTargetRow.dragDropAdjustPriorityBuckets')}
          />

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {showPriorityBadge ? (
                <ToneBadge tone="">
                  P{resolvedPriority}
                </ToneBadge>
              ) : null}

              <span className="min-w-0 text-sm font-semibold text-foreground">
                {target.account?.username || `account-${target.accountId}`}
              </span>

              <ToneBadge tone="-muted">
                {target.site?.name || tr('pages.proxyLogs.unknownSite')}
              </ToneBadge>

              <SuccessFailStat className="ml-auto" successCount={target.successCount} failCount={target.failCount} />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <ToneBadge tone="">
                {tokenBinding.bindingModeLabel}
              </ToneBadge>

              <ToneBadge
                tone=""
                data-tooltip={suppressTooltips ? undefined : tr('pages.tokenRoutes.sortableTargetRow.currentlyEffectiveToken').replace('{token}', tokenBinding.effectiveTokenName)}
              >
                {tr('pages.tokenRoutes.routeCard.currentlyEffective')}{tokenBinding.effectiveTokenName}
              </ToneBadge>

              {target.sourceModel ? (
                <ToneBadge tone="-info">
                  {target.sourceModel}
                </ToneBadge>
              ) : null}

              {target.manualOverride ? (
                <ToneBadge tone="-warning"
                 
                 
                  data-tooltip={suppressTooltips ? undefined : tr('pages.tokenRoutes.sortableTargetRow.targetAddedManuallyUserNotAutomaticallyGenerated')}
                >
                  {tr('pages.tokenRoutes.routeCard.manualconfiguration')}
                </ToneBadge>
              ) : null}

              {routeUnit ? (
                <>
                  <ToneBadge tone="-muted">
                    {tr('pages.tokenRoutes.routeCard.oauthRoutes')}
                  </ToneBadge>
                  <ToneBadge tone="-info">
                    {routeUnitName}
                  </ToneBadge>
                  <ToneBadge tone="-muted">
                    {routeUnit.memberCount} {tr('pages.tokenRoutes.sortableTargetRow.members')}
                  </ToneBadge>
                  <ToneBadge tone="-muted">
                    {routeUnitStrategyLabel}
                  </ToneBadge>
                </>
              ) : null}
            </div>

            {routeUnitMemberSummaryText ? (
              <div className="flex flex-wrap items-start gap-1.5">
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {tr('pages.tokenRoutes.sortableTargetRow.memberSummary')}{routeUnit?.memberCount || 0} {tr('pages.tokenRoutes.routeCard.members')} {routeUnitStrategyLabel}）
                </span>
                <span className="text-xs leading-snug text-muted-foreground">
                  {routeUnitMemberSummaryText}
                </span>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="whitespace-nowrap text-xs text-muted-foreground">{tr('pages.tokenRoutes.sortableTargetRow.selectionProbability')}</span>
              <ProbabilityIndicator
                probability={decisionState.probability}
                tooltip={suppressTooltips ? undefined : (decisionState.probability <= 0 ? decisionState.reasonText : undefined)}
              />

              {!managementLocked && (
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => setMobileDetailsOpen((current) => !current)}
                >
                  {mobileDetailsOpen ? tr('pages.tokenRoutes.sortableTargetRow.collapseconfiguration') : tr('pages.tokenRoutes.sortableTargetRow.configurationtargets')}
                </Button>
              )}
            </div>

            {!managementLocked && mobileDetailsOpen && (
              <div className="flex flex-col gap-2 border-t pt-1.5">
                <div className="w-full">
                  <ModernSelect
                    size="sm"
                    value={String(activeTokenId || 0)}
                    onChange={(nextValue) => onTokenDraftChange(target.id, Number.parseInt(nextValue, 10) || 0)}
                    disabled={isUpdatingToken}
                    options={[
                      {
                        value: '0',
                        label: tokenBinding.followOptionLabel,
                        description: tokenBinding.followOptionDescription,
                      },
                      ...tokenOptions.map((token) => ({
                        value: String(token.id),
                        label: buildFixedTokenOptionLabel(token, { includeDefaultTag: true }),
                        description: buildFixedTokenOptionDescription(token),
                      })),
                    ]}
                    placeholder={tr('pages.tokenRoutes.sortableTargetRow.selecttoken')}
                  />
                  <div className="mt-1 text-xs leading-snug text-muted-foreground">
                    {tokenBinding.helperText}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onSaveToken}
                    disabled={isUpdatingToken}
                  >
                    {isUpdatingToken ? <LoaderCircle className="size-4 animate-spin" /> : tr('app.save')}
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onToggleEnabled(target.enabled === false)}
                  >
                    {target.enabled === false ? tr('pages.downstreamKeys.enabled') : tr('pages.downstreamKeys.disabled')}
                  </Button>

                  {onSiteBlockModel && target.site?.id ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={onSiteBlockModel}
                    >
                      {tr('pages.tokenRoutes.sortableTargetRow.sites')}
                    </Button>
                  ) : null}

                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={onDeleteTarget}
                  >
                    {tr('pages.settings.remove')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-layer-root
      className={cn(
        rowClassName,
        'grid items-center gap-1.5 px-2 py-1.5',
        managementLocked ? 'grid-cols-[minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)_auto_auto_auto]',
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
        <DragHandleButton
          ref={dragHandleRef}
          {...dragHandleProps}
          disabled={isSavingPriority || managementLocked}
          data-tooltip={suppressTooltips ? undefined : (managementLocked ? tr('pages.tokenRoutes.sortableTargetRow.routesEdit') : tr('pages.tokenRoutes.sortableTargetRow.dragDropAdjustPriorityBuckets'))}
          aria-label={tr('pages.tokenRoutes.sortableTargetRow.dragDropAdjustPriorityBuckets')}
        />

        {showPriorityBadge ? (
          <ToneBadge tone="">
            P{resolvedPriority}
          </ToneBadge>
        ) : null}

        <span className="font-semibold text-foreground">
          {target.account?.username || `account-${target.accountId}`}
        </span>

        <ToneBadge tone="-muted">
          {target.site?.name || tr('pages.proxyLogs.unknownSite')}
        </ToneBadge>

        <ToneBadge tone="">
          {tokenBinding.bindingModeLabel}
        </ToneBadge>

        <ToneBadge
          tone=""
          data-tooltip={suppressTooltips ? undefined : tr('pages.tokenRoutes.sortableTargetRow.currentlyEffectiveToken').replace('{token}', tokenBinding.effectiveTokenName)}
        >
          {tr('pages.tokenRoutes.routeCard.currentlyEffective')}{tokenBinding.effectiveTokenName}
        </ToneBadge>

        {target.sourceModel ? (
          <ToneBadge tone="-info">
            {target.sourceModel}
          </ToneBadge>
        ) : null}

        {target.manualOverride ? (
          <ToneBadge
            tone="-warning"
            data-tooltip={suppressTooltips ? undefined : tr('pages.tokenRoutes.sortableTargetRow.targetAddedManuallyUserNotAutomaticallyGenerated')}
          >
            {tr('pages.tokenRoutes.routeCard.manualconfiguration')}
          </ToneBadge>
        ) : null}

        {target.enabled === false ? (
          <ToneBadge tone="-muted">{tr('pages.accounts.disabled2')}</ToneBadge>
        ) : null}

        {routeUnit ? (
          <>
            <ToneBadge tone="-muted">
              {tr('pages.tokenRoutes.routeCard.oauthRoutes')}
            </ToneBadge>
            <ToneBadge tone="-info">
              {routeUnitName}
            </ToneBadge>
            <ToneBadge tone="-muted">
              {routeUnit.memberCount} {tr('pages.tokenRoutes.sortableTargetRow.members')}
            </ToneBadge>
            <ToneBadge tone="-muted">
              {routeUnitStrategyLabel}
            </ToneBadge>
          </>
        ) : null}

        {routeUnitMemberSummaryText ? (
          <div className="flex w-full flex-wrap items-start gap-1.5">
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {tr('pages.tokenRoutes.sortableTargetRow.memberSummary')}{routeUnit?.memberCount || 0} {tr('pages.tokenRoutes.routeCard.members')} {routeUnitStrategyLabel}）
            </span>
            <span className="text-xs leading-snug text-muted-foreground">
              {routeUnitMemberSummaryText}
            </span>
          </div>
        ) : null}

        <div className="flex w-full flex-wrap items-center gap-1.5">
          <span className="whitespace-nowrap text-xs text-muted-foreground">{tr('pages.tokenRoutes.sortableTargetRow.selectionProbability')}</span>
          <ProbabilityIndicator
            probability={decisionState.probability}
            tooltip={suppressTooltips ? undefined : (decisionState.probability <= 0 ? decisionState.reasonText : undefined)}
          />
          <SuccessFailStat successCount={target.successCount} failCount={target.failCount} />
        </div>
      </div>

      {!managementLocked ? (
        <>
          <div className="flex items-center gap-1.5">
            <div className="min-w-55 flex-1">
              <ModernSelect
                size="sm"
                value={String(activeTokenId || 0)}
                onChange={(nextValue) => onTokenDraftChange(target.id, Number.parseInt(nextValue, 10) || 0)}
                disabled={isUpdatingToken}
                options={[
                  {
                    value: '0',
                    label: tokenBinding.followOptionLabel,
                    description: tokenBinding.followOptionDescription,
                  },
                  ...tokenOptions.map((token) => ({
                    value: String(token.id),
                    label: buildFixedTokenOptionLabel(token, { includeDefaultTag: true }),
                    description: buildFixedTokenOptionDescription(token),
                  })),
                ]}
                placeholder={tr('pages.tokenRoutes.sortableTargetRow.selecttoken')}
              />
              <div className="mt-1 text-xs leading-snug text-muted-foreground">
                {tokenBinding.helperText}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onSaveToken}
              disabled={isUpdatingToken}
            >
              {isUpdatingToken ? <LoaderCircle className="size-4 animate-spin" /> : tr('app.save')}
            </Button>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onToggleEnabled(target.enabled === false)}
            data-tooltip={suppressTooltips ? undefined : (target.enabled === false ? tr('pages.tokenRoutes.sortableTargetRow.enabledTargets') : tr('pages.tokenRoutes.sortableTargetRow.disabledTargets'))}
          >
            {target.enabled === false ? tr('pages.downstreamKeys.enabled') : tr('pages.downstreamKeys.disabled')}
          </Button>

          <div className="flex items-center gap-1">
            {onSiteBlockModel && target.site?.id ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onSiteBlockModel}
                data-tooltip={suppressTooltips ? undefined : tr('pages.tokenRoutes.sortableTargetRow.blockModelOnSiteTooltip').replace('{site}', target.site?.name || tr('pages.accounts.unknown2'))}
              >
                {tr('pages.tokenRoutes.sortableTargetRow.sites')}
              </Button>
            ) : null}

            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onDeleteTarget}
            >
              {tr('pages.settings.remove')}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
