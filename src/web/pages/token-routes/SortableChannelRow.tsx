import { useState, type CSSProperties } from 'react';
import ModernSelect from '../../components/ModernSelect.js';
import type { SortableChannelRowProps } from './types.js';
import {
  buildFixedTokenOptionDescription,
  buildFixedTokenOptionLabel,
  describeTokenBinding,
  resolveTokenBindingConnectionMode,
} from './tokenBindingPresentation.js';
import { getChannelDecisionState } from './utils.js';
import { Button } from '../../components/ui/button/index.js';
import { LoaderCircle } from 'lucide-react';
import ToneBadge from '../../components/ToneBadge.js';
import { cn } from '../../lib/utils.js';

function getRouteUnitStrategyLabel(strategy: string | null | undefined): string {
  return strategy === 'stick_until_unavailable' ? '单个用到不可用再切' : '轮询';
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
      成功/失败 <span className="font-semibold text-foreground">{successCount || 0}</span>
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

export function SortableChannelRow({
  channel,
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
  channelManagementDisabled = false,
  dragInProgress = false,
  mobile = false,
  tokenOptions,
  activeTokenId,
  isUpdatingToken,
  onTokenDraftChange,
  onSaveToken,
  onDeleteChannel,
  onToggleEnabled,
  onSiteBlockModel,
}: SortableChannelRowProps) {
  const resolvedPriority = displayPriority ?? channel.priority ?? 0;
  const managementLocked = readOnly || channelManagementDisabled;
  const suppressTooltips = dragInProgress || dragging;
  const rowClassName = cn(
    'rounded-lg border bg-card shadow-sm transition-colors',
    dragging && 'bg-muted opacity-90 shadow-md',
    channel.enabled === false && 'opacity-60',
  );
  const dragHandleClassName = cn(
    'cursor-grab text-muted-foreground',
    dragging && 'bg-muted text-foreground',
    (isSavingPriority || managementLocked) && 'cursor-not-allowed',
  );

  const decisionState = getChannelDecisionState(decisionCandidate, channel, isExactRoute, loadingDecision);
  const tokenBinding = describeTokenBinding(
    tokenOptions,
    activeTokenId,
    channel.token?.name ?? null,
    {
      connectionMode: resolveTokenBindingConnectionMode(channel.account),
      accountName: channel.account?.username || `account-${channel.accountId}`,
    },
  );
  const routeUnit = channel.routeUnit ?? null;
  const routeUnitName = routeUnit?.name?.trim() || 'OAuth 路由池';
  const routeUnitStrategyLabel = routeUnit ? getRouteUnitStrategyLabel(routeUnit.strategy) : '';
  const routeUnitMemberSummary = routeUnit?.members?.length
    ? routeUnit.members.map((member) => formatRouteUnitMemberLabel(member)).join('、')
    : null;
  const routeUnitMemberSummaryText = routeUnitMemberSummary ? `成员：${routeUnitMemberSummary}` : null;

  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);

  if (mobile) {
    return (
      <div data-layer-root className={cn(rowClassName, 'p-2')}>
        <div className="flex items-start gap-2">
          <Button
            variant="outline"
            size="icon"
            className={dragHandleClassName}
            type="button"
            ref={dragHandleRef}
            {...dragHandleProps}
            disabled={isSavingPriority || managementLocked}
            data-tooltip={suppressTooltips ? undefined : (managementLocked ? '该路由当前不可编辑优先级' : '拖拽调整优先级桶')}
            aria-label="拖拽调整优先级桶"
          >
            <svg width="12" height="12" fill="currentColor" viewBox="0 0 12 12" aria-hidden>
              <circle cx="3" cy="2" r="1" />
              <circle cx="9" cy="2" r="1" />
              <circle cx="3" cy="6" r="1" />
              <circle cx="9" cy="6" r="1" />
              <circle cx="3" cy="10" r="1" />
              <circle cx="9" cy="10" r="1" />
            </svg>
          </Button>

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {showPriorityBadge ? (
                <ToneBadge tone="">
                  P{resolvedPriority}
                </ToneBadge>
              ) : null}

              <span className="min-w-0 text-sm font-semibold text-foreground">
                {channel.account?.username || `account-${channel.accountId}`}
              </span>

              <ToneBadge tone="-muted">
                {channel.site?.name || 'unknown'}
              </ToneBadge>

              <SuccessFailStat className="ml-auto" successCount={channel.successCount} failCount={channel.failCount} />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <ToneBadge tone="">
                {tokenBinding.bindingModeLabel}
              </ToneBadge>

              <ToneBadge
                tone=""
                data-tooltip={suppressTooltips ? undefined : `当前生效：${tokenBinding.effectiveTokenName}`}
              >
                当前生效：{tokenBinding.effectiveTokenName}
              </ToneBadge>

              {channel.sourceModel ? (
                <ToneBadge tone="-info">
                  {channel.sourceModel}
                </ToneBadge>
              ) : null}

              {channel.manualOverride ? (
                <ToneBadge tone="-warning"
                 
                 
                  data-tooltip={suppressTooltips ? undefined : '该通道由用户手动添加，而非系统自动生成'}
                >
                  手动配置
                </ToneBadge>
              ) : null}

              {routeUnit ? (
                <>
                  <ToneBadge tone="-muted">
                    OAuth 路由池
                  </ToneBadge>
                  <ToneBadge tone="-info">
                    {routeUnitName}
                  </ToneBadge>
                  <ToneBadge tone="-muted">
                    {routeUnit.memberCount} 成员
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
                  成员摘要（{routeUnit?.memberCount || 0} 个成员 · {routeUnitStrategyLabel}）
                </span>
                <span className="text-xs leading-snug text-muted-foreground">
                  {routeUnitMemberSummaryText}
                </span>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="whitespace-nowrap text-xs text-muted-foreground">选中概率</span>
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
                  {mobileDetailsOpen ? '收起配置' : '配置通道'}
                </Button>
              )}
            </div>

            {!managementLocked && mobileDetailsOpen && (
              <div className="flex flex-col gap-2 border-t pt-1.5">
                <div className="w-full">
                  <ModernSelect
                    size="sm"
                    value={String(activeTokenId || 0)}
                    onChange={(nextValue) => onTokenDraftChange(channel.id, Number.parseInt(nextValue, 10) || 0)}
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
                    placeholder="选择令牌绑定方式"
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
                    {isUpdatingToken ? <LoaderCircle className="size-4 animate-spin" /> : '保存'}
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onToggleEnabled(channel.enabled === false)}
                  >
                    {channel.enabled === false ? '启用' : '禁用'}
                  </Button>

                  {onSiteBlockModel && channel.site?.id ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={onSiteBlockModel}
                    >
                      站点屏蔽
                    </Button>
                  ) : null}

                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={onDeleteChannel}
                  >
                    移除
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
        <Button
          variant="outline"
          size="icon"
          className={dragHandleClassName}
          type="button"
          ref={dragHandleRef}
          {...dragHandleProps}
          disabled={isSavingPriority || managementLocked}
          data-tooltip={suppressTooltips ? undefined : (managementLocked ? '该路由当前不可编辑优先级' : '拖拽调整优先级桶')}
          aria-label="拖拽调整优先级桶"
        >
          <svg width="12" height="12" fill="currentColor" viewBox="0 0 12 12" aria-hidden>
            <circle cx="3" cy="2" r="1" />
            <circle cx="9" cy="2" r="1" />
            <circle cx="3" cy="6" r="1" />
            <circle cx="9" cy="6" r="1" />
            <circle cx="3" cy="10" r="1" />
            <circle cx="9" cy="10" r="1" />
          </svg>
        </Button>

        {showPriorityBadge ? (
          <ToneBadge tone="">
            P{resolvedPriority}
          </ToneBadge>
        ) : null}

        <span className="font-semibold text-foreground">
          {channel.account?.username || `account-${channel.accountId}`}
        </span>

        <ToneBadge tone="-muted">
          {channel.site?.name || 'unknown'}
        </ToneBadge>

        <ToneBadge tone="">
          {tokenBinding.bindingModeLabel}
        </ToneBadge>

        <ToneBadge
          tone=""
          data-tooltip={suppressTooltips ? undefined : `当前生效：${tokenBinding.effectiveTokenName}`}
        >
          当前生效：{tokenBinding.effectiveTokenName}
        </ToneBadge>

        {channel.sourceModel ? (
          <ToneBadge tone="-info">
            {channel.sourceModel}
          </ToneBadge>
        ) : null}

        {channel.manualOverride ? (
          <ToneBadge
            tone="-warning"
            data-tooltip={suppressTooltips ? undefined : '该通道由用户手动添加，而非系统自动生成'}
          >
            手动配置
          </ToneBadge>
        ) : null}

        {channel.enabled === false ? (
          <ToneBadge tone="-muted">已禁用</ToneBadge>
        ) : null}

        {routeUnit ? (
          <>
            <ToneBadge tone="-muted">
              OAuth 路由池
            </ToneBadge>
            <ToneBadge tone="-info">
              {routeUnitName}
            </ToneBadge>
            <ToneBadge tone="-muted">
              {routeUnit.memberCount} 成员
            </ToneBadge>
            <ToneBadge tone="-muted">
              {routeUnitStrategyLabel}
            </ToneBadge>
          </>
        ) : null}

        {routeUnitMemberSummaryText ? (
          <div className="flex w-full flex-wrap items-start gap-1.5">
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              成员摘要（{routeUnit?.memberCount || 0} 个成员 · {routeUnitStrategyLabel}）
            </span>
            <span className="text-xs leading-snug text-muted-foreground">
              {routeUnitMemberSummaryText}
            </span>
          </div>
        ) : null}

        <div className="flex w-full flex-wrap items-center gap-1.5">
          <span className="whitespace-nowrap text-xs text-muted-foreground">选中概率</span>
          <ProbabilityIndicator
            probability={decisionState.probability}
            tooltip={suppressTooltips ? undefined : (decisionState.probability <= 0 ? decisionState.reasonText : undefined)}
          />
          <SuccessFailStat successCount={channel.successCount} failCount={channel.failCount} />
        </div>
      </div>

      {!managementLocked ? (
        <>
          <div className="flex items-center gap-1.5">
            <div className="min-w-55 flex-1">
              <ModernSelect
                size="sm"
                value={String(activeTokenId || 0)}
                onChange={(nextValue) => onTokenDraftChange(channel.id, Number.parseInt(nextValue, 10) || 0)}
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
                placeholder="选择令牌绑定方式"
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
              {isUpdatingToken ? <LoaderCircle className="size-4 animate-spin" /> : '保存'}
            </Button>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onToggleEnabled(channel.enabled === false)}
            data-tooltip={suppressTooltips ? undefined : (channel.enabled === false ? '启用此通道' : '禁用此通道')}
          >
            {channel.enabled === false ? '启用' : '禁用'}
          </Button>

          <div className="flex items-center gap-1">
            {onSiteBlockModel && channel.site?.id ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onSiteBlockModel}
                data-tooltip={suppressTooltips ? undefined : `将此模型加入站点「${channel.site?.name || '未知'}」的禁用列表，rebuild 后该站点的此模型通道将不再生成`}
              >
                站点屏蔽
              </Button>
            ) : null}

            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onDeleteChannel}
            >
              移除
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
