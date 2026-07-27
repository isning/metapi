import { Activity, Coins, Gauge, GitBranch, Info, KeyRound, Server, Timer, Users, Wallet } from 'lucide-react';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import ToneBadge from '../../components/ToneBadge.js';
import SectionHeading from '../../components/details/SectionHeading.js';
import MetricGrid from '../../components/metrics/MetricGrid.js';
import MetricTile from '../../components/metrics/MetricTile.js';
import EstimateLevelBadge from '../../components/pricing/EstimateLevelBadge.js';
import { Card, CardContent } from '../../components/ui/card/index.js';
import { Skeleton } from '../../components/ui/skeleton/index.js';
import { cn } from '../../lib/utils.js';
import type { ModelDetailsView, ModelEntryPricing } from './modelDetailsView.js';
import { formatLatencyValue, formatSuccessRate, formatTokenSpeedValue, getAccountCredentialCount, getModelCredentialCount } from './modelDetailsView.js';

import { tr } from '../../i18n.js';
type ModelOverviewTabProps = {
  details: ModelDetailsView;
};

type ModelEntryPricingComponent = NonNullable<ModelEntryPricing['components']>[number];

function formatEntryPrice(value: number | null, currency?: string | null): string {
  if (value == null || !Number.isFinite(value)) return tr('components.modelRouteFlow.priceUnavailable');
  const amount = value.toFixed(6).replace(/\.?0+$/, '');
  return `${currency ? `${currency} ` : ''}${amount} / 1M`;
}

function formatMultiplier(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return tr('components.modelRouteFlow.referenceUnavailable');
  return `${value.toFixed(4).replace(/\.?0+$/, '')}x`;
}

function formatEntryTotal(value: number | null | undefined, currency?: string | null): string {
  if (value == null || !Number.isFinite(value)) return tr('components.modelRouteFlow.totalUnavailable');
  const amount = value.toFixed(6).replace(/\.?0+$/, '');
  return `${currency ? `${currency} ` : ''}${amount} / preview`;
}

function formatWalletCost(value: number | null | undefined, currency: string | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return tr('components.modelRouteFlow.walletCostUnavailable');
  const amount = value.toFixed(6).replace(/\.?0+$/, '');
  return `${currency ? `${currency} ` : ''}${amount} / preview`;
}

function formatQuotaDays(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return tr('components.modelRouteFlow.freeQuotaUnavailable');
  return `${value.toFixed(4).replace(/\.?0+$/, '')} d / preview`;
}

function formatBalanceBurn(buckets: Array<{ unit: string; amount: number }> | null | undefined): string {
  if (!buckets || buckets.length === 0) return tr('components.modelRouteFlow.balanceCostUnavailable');
  return buckets
    .map((bucket) => `${bucket.amount.toFixed(6).replace(/\.?0+$/, '')} ${bucket.unit}`)
    .join(' + ');
}

function pricingComponentLabel(kind: ModelEntryPricingComponent['kind']): string {
  if (kind === 'input_tokens') return tr('components.modelRouteFlow.input');
  if (kind === 'output_tokens') return tr('components.modelRouteFlow.output');
  if (kind === 'cache_read_tokens') return tr('components.modelRouteFlow.cacheRead');
  if (kind === 'cache_write_tokens') return tr('components.modelRouteFlow.cacheWrite');
  if (kind === 'reasoning_tokens') return tr('components.modelRouteFlow.reasoning');
  if (kind === 'request') return tr('components.modelRouteFlow.requestFee');
  return kind;
}

function formatComponentUnitAmount(component: ModelEntryPricingComponent): string {
  if (component.unitPrice == null || !Number.isFinite(component.unitPrice)) {
    return tr('components.modelRouteFlow.priceUnavailable');
  }
  const amount = component.unitPrice.toFixed(6).replace(/\.?0+$/, '');
  return `${component.currency ? `${component.currency} ` : ''}${amount}`;
}

function pricingComponentUnit(component: ModelEntryPricingComponent): string {
  return component.kind === 'request'
    ? tr('components.modelRouteFlow.perRequest')
    : tr('components.modelRouteFlow.perMillionTokens');
}

function formatComponentCost(component: ModelEntryPricingComponent): string {
  if (component.cost == null || !Number.isFinite(component.cost)) {
    return tr('components.modelRouteFlow.totalUnavailable');
  }
  const amount = component.cost.toFixed(6).replace(/\.?0+$/, '');
  return `${component.currency ? `${component.currency} ` : ''}${amount}`;
}

function PricingComponentList({
  components,
  weighted = false,
}: {
  components: ModelEntryPricing['components'] | undefined;
  weighted?: boolean;
}) {
  const rows = (components || []).filter((component) => (
    component.unitPrice != null || component.cost != null || component.quantity > 0
  ));
  if (rows.length === 0) return null;
  return (
    <div className="grid gap-1.5">
      {weighted ? (
        <p className="text-xs text-muted-foreground">
          {tr('components.modelRouteFlow.weightedCostDescription')}
        </p>
      ) : null}
      {rows.map((component) => (
        <div key={component.kind} className="grid gap-2 rounded-md bg-muted/40 px-2.5 py-2 sm:grid-cols-[minmax(9rem,1fr)_auto] sm:items-center sm:gap-x-4">
          <div className="flex min-w-0 items-baseline gap-1">
            <span className="truncate text-xs font-medium">{pricingComponentLabel(component.kind)}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">/ {pricingComponentUnit(component)}</span>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(4.5rem,1fr)_minmax(9rem,1fr)] items-center gap-x-4 font-mono text-xs text-foreground">
            <span className="justify-self-end">{formatComponentUnitAmount(component)}</span>
            <span className="grid justify-items-end gap-0.5 border-l border-border/60 pl-4">
              <span className="font-sans text-[10px] text-muted-foreground">
                {weighted
                  ? tr('components.modelRouteFlow.weightedPreviewCost')
                  : tr('components.modelRouteFlow.previewCost')}
              </span>
              <span>{formatComponentCost(component)}</span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatEstimateLevel(level: string | null | undefined): string {
  if (level === 'exact') return tr('components.modelRouteFlow.estimateExact');
  if (level === 'static_estimate') return tr('components.modelRouteFlow.estimateStatic');
  if (level === 'estimated') return tr('components.modelRouteFlow.estimateEstimated');
  if (level === 'incomplete') return tr('components.modelRouteFlow.estimateIncomplete');
  return level || tr('common.notAvailable');
}

function formatModelStatus(status: ModelDetailsView['status']): string {
  return tr(`pages.models.modelDetailsView.status.${status}`);
}

function RouteSummarySkeleton() {
  const label = tr('pages.models.modelOverviewTab.loadingRouteFlow');
  return (
    <div role="status" aria-busy="true" aria-label={label} className="grid gap-2">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  );
}

function formatAttemptProbability(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return tr('common.notAvailable');
  const ratio = value > 1 ? value / 100 : value;
  return `${(ratio * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

function PricingSummaryCard({
  title,
  description,
  pricing,
  emptyText,
  weightedComponents = false,
}: {
  title: string;
  description: string;
  pricing: ModelEntryPricing | null;
  emptyText: string;
  weightedComponents?: boolean;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{description}</div>
        </div>
        {!pricing ? <ToneBadge tone="-muted">{tr('pages.settings.notConfigured')}</ToneBadge> : null}
      </div>
      {pricing ? (
        <div className="mt-3 grid gap-2">
          {(pricing.selectionMode || pricing.estimateLevel) && (
            <div className="flex flex-wrap gap-1.5">
              {pricing.selectionMode ? <ToneBadge tone="-muted">{pricing.selectionMode}</ToneBadge> : null}
              {pricing.estimateLevel ? (
                <EstimateLevelBadge
                  level={pricing.estimateLevel}
                  diagnostics={pricing.diagnostics}
                  executionAttempts={pricing.executionAttempts}
                  sourceCount={pricing.sourceCount}
                  selectionMode={pricing.selectionMode}
                />
              ) : null}
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted-foreground">{tr('components.modelRouteFlow.inputEntryPrice')}</div>
              <div className="font-mono text-sm font-semibold">{formatEntryPrice(pricing.inputPerMillion, pricing.currency)}</div>
              <div className="text-xs text-muted-foreground">{tr('components.modelRouteFlow.inputMultiplier')} {formatMultiplier(pricing.inputMultiplier)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{tr('components.modelRouteFlow.outputEntryPrice')}</div>
              <div className="font-mono text-sm font-semibold">{formatEntryPrice(pricing.outputPerMillion, pricing.currency)}</div>
              <div className="text-xs text-muted-foreground">{tr('components.modelRouteFlow.outputMultiplier')} {formatMultiplier(pricing.outputMultiplier)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{tr('components.modelRouteFlow.total')}</div>
              <div className="font-mono text-sm font-semibold">{formatEntryTotal(pricing.totalCost, pricing.currency)}</div>
              <div className="text-xs text-muted-foreground">{tr('components.modelRouteFlow.totalMultiplier')} {formatMultiplier(pricing.totalMultiplier ?? null)}</div>
            </div>
          </div>
          {pricing.effectiveCost ? (
            <div className="grid gap-2 border-t pt-2 sm:grid-cols-3">
              <div>
                <div className="text-xs text-muted-foreground">{tr('components.modelRouteFlow.cashCost')}</div>
                <div className="font-mono text-sm font-semibold">{formatWalletCost(pricing.effectiveCost.walletCostBaseCurrency, pricing.effectiveCost.baseCostUnit)}</div>
                <div className="text-xs text-muted-foreground">{formatEstimateLevel(pricing.effectiveCost.estimateLevel)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{tr('components.modelRouteFlow.freeQuotaCost')}</div>
                <div className="font-mono text-sm font-semibold">{formatQuotaDays(pricing.effectiveCost.freeQuotaDaysCost)}</div>
                <div className="text-xs text-muted-foreground">{tr('components.modelRouteFlow.freeQuotaCostDescription')}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{tr('components.modelRouteFlow.upstreamBalanceCost')}</div>
                <div className="font-mono text-sm font-semibold">{formatBalanceBurn(pricing.effectiveCost.balanceBurn)}</div>
                <div className="text-xs text-muted-foreground">{tr('components.modelRouteFlow.upstreamBalanceCostDescription')}</div>
              </div>
            </div>
          ) : null}
          {pricing.components?.length ? (
            <div className="border-t pt-2">
              <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                {tr('components.modelRouteFlow.costDetails')}
              </div>
              <PricingComponentList components={pricing.components} weighted={weightedComponents} />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 text-sm text-muted-foreground">{emptyText}</div>
      )}
    </div>
  );
}

function AttemptPricingDetails({ pricing }: { pricing: ModelEntryPricing | null }) {
  const attempts = pricing?.executionAttempts || [];
  if (attempts.length === 0) {
    return (
      <EmptyStateBlock
        title={tr('pages.models.modelOverviewTab.noRoutePricingDetails')}
        description={tr('pages.models.modelOverviewTab.noRoutePricingDetailsDescription')}
      />
    );
  }

  return (
    <div className="grid gap-2">
      {attempts.map((attempt) => (
        <div key={attempt.executionAttemptId} className="rounded-md border p-3">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{attempt.modelName}</div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {[
                  attempt.siteId != null ? `${tr('components.modelRouteFlow.siteIdentity').replace('{id}', String(attempt.siteId))}` : null,
                  attempt.accountId != null ? `${tr('components.modelRouteFlow.accountIdentity').replace('{id}', String(attempt.accountId))}` : null,
                  attempt.tokenId != null ? `${tr('components.modelRouteFlow.tokenIdentity').replace('{id}', String(attempt.tokenId))}` : null,
                ].filter(Boolean).join(' · ') || tr('common.notAvailable')}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <ToneBadge tone="-muted">{formatAttemptProbability(attempt.probability)}</ToneBadge>
              {attempt.matchedScope ? <ToneBadge tone="-info">{attempt.matchedScope}</ToneBadge> : null}
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted-foreground">{tr('components.modelRouteFlow.cashCost')}</div>
              <div className="font-mono text-sm font-semibold">
                {formatWalletCost(attempt.effectiveCost?.walletCostBaseCurrency, attempt.effectiveCost?.baseCostUnit)}
              </div>
              <div className="text-xs text-muted-foreground">{formatEstimateLevel(attempt.effectiveCost?.estimateLevel)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{tr('components.modelRouteFlow.total')}</div>
              <div className="font-mono text-sm font-semibold">{formatEntryTotal(attempt.totalCost, attempt.currency)}</div>
              <div className="text-xs text-muted-foreground">{tr('components.modelRouteFlow.originalPrice')}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{tr('components.modelRouteFlow.input')} / {tr('components.modelRouteFlow.output')}</div>
              <div className="font-mono text-sm font-semibold">
                {formatEntryPrice(attempt.inputPerMillion, attempt.currency)} · {formatEntryPrice(attempt.outputPerMillion, attempt.currency)}
              </div>
              <div className="text-xs text-muted-foreground">{tr('components.modelRouteFlow.originalPrice')}</div>
            </div>
          </div>
          {attempt.components?.length ? (
            <div className="mt-3 border-t pt-2">
              <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                {tr('components.modelRouteFlow.costDetails')}
              </div>
              <PricingComponentList components={attempt.components} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function ModelOverviewTab({
  details,
}: ModelOverviewTabProps) {
  const { model } = details;
  const displayMetrics = details.overview.displayMetrics;
  const supportedEndpointTypes = details.overview.supportedEndpointTypes;
  const routeSummary = details.overview.routeSummary;

  return (
    <div className="grid gap-4">
      <MetricGrid>
        <MetricTile label={tr('components.notificationPanel.status')} value={formatModelStatus(details.status)} icon={<Activity className="size-4" />} tone={details.status === 'healthy' ? 'success' : details.status === 'unknown' ? 'muted' : 'warning'} />
        <MetricTile label={tr('components.modelAnalysisPanel.successRate')} value={formatSuccessRate(displayMetrics.successRate)} icon={<Activity className="size-4" />} tone={displayMetrics.successRate == null ? 'muted' : displayMetrics.successRate >= 90 ? 'success' : 'warning'} />
        <MetricTile label={tr('pages.models.firstTokenLatency')} value={formatLatencyValue(displayMetrics.avgFirstTokenLatency)} icon={<Timer className="size-4" />} tone={displayMetrics.avgFirstTokenLatency == null ? 'muted' : displayMetrics.avgFirstTokenLatency >= 3000 ? 'destructive' : displayMetrics.avgFirstTokenLatency >= 1000 ? 'warning' : 'success'} />
        <MetricTile label={tr('pages.models.outputSpeed')} value={formatTokenSpeedValue(displayMetrics.avgOutputTokensPerSecond)} icon={<Gauge className="size-4" />} tone={displayMetrics.avgOutputTokensPerSecond == null ? 'muted' : displayMetrics.avgOutputTokensPerSecond >= 20 ? 'success' : displayMetrics.avgOutputTokensPerSecond >= 5 ? 'warning' : 'destructive'} />
        <MetricTile label={tr('components.searchModal.accounts2')} value={model.accountCount} icon={<Users className="size-4" />} />
        <MetricTile label={tr('pages.models.credentials')} value={getModelCredentialCount(model)} icon={<KeyRound className="size-4" />} />
        <MetricTile label={tr('pages.models.modelOverviewTab.endpoints')} value={supportedEndpointTypes.length || tr('common.notAvailable')} icon={<Server className="size-4" />} tone={supportedEndpointTypes.length > 0 ? 'default' : 'muted'} />
      </MetricGrid>

      <Card>
        <CardContent className="p-3">
          <SectionHeading title={tr('pages.proxyLogs.basicInfo')} description={tr('pages.models.modelOverviewTab.modelIdentityInventory')} icon={<Info className="size-4" />} />
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">{details.descriptionText}</p>
            {model.accounts.length > 0 ? (
              <div className="grid gap-2">
                <SectionHeading title={tr('pages.models.modelOverviewTab.accounts')} description={`${model.accounts.length} ${tr('components.searchModal.accounts')}`} icon={<Users className="size-4" />} />
                <div className="grid gap-2 md:grid-cols-2">
                  {model.accounts.map((account) => (
                    <div key={account.id} className="rounded-md border p-3">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{tr('components.searchModal.sites2')} {account.site}</div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">{tr('components.searchModal.accounts2')} {account.username || `ID:${account.id}`}</div>
                        </div>
                        <ToneBadge tone="-muted">{formatLatencyValue(account.latency)}</ToneBadge>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Wallet className="size-3" />{tr('components.notificationPanel.balance')} {account.balance}</span>
                        <ToneBadge tone="-muted">{tr('pages.models.credentials')} {getAccountCredentialCount(account)}</ToneBadge>
                        {(account.managedTokenCount ?? account.tokens.length) > 0 ? (
                          <ToneBadge tone="-muted">{tr('pages.models.managedTokens')} {account.managedTokenCount ?? account.tokens.length}</ToneBadge>
                        ) : null}
                        {account.tokens.map((token) => (
                          <ToneBadge key={token.id} tone={token.isDefault ? '-success' : '-muted'}>{token.name}</ToneBadge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyStateBlock title={tr('pages.models.modelOverviewTab.noAccountInventory')} description={tr('pages.models.modelOverviewTab.noUpstreamAccountsExposeModel')} />
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardContent className="p-3">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <SectionHeading title={tr('pages.models.modelOverviewTab.routeSummary')} description={tr('pages.models.modelOverviewTab.compiledRouteEvidence')} icon={<GitBranch className="size-4" />} />
            </div>
            {details.overview.routeSummaryLoading ? (
              <RouteSummarySkeleton />
            ) : details.overview.routeSummaryError ? (
              <div className="text-sm text-destructive">{details.overview.routeSummaryError}</div>
            ) : routeSummary.length > 0 ? (
              <div className={cn('grid gap-1.5 transition-opacity duration-150', details.overview.routeSummaryRefreshing && 'opacity-75')}>
                {routeSummary.map((line) => (
                  <div key={line} className="text-sm text-muted-foreground">{line}</div>
                ))}
              </div>
            ) : details.routing.loading ? (
              <div className="min-h-20" aria-hidden="true" />
            ) : (
              <EmptyStateBlock title={tr('pages.models.modelOverviewTab.noCompiledRoute')} description={tr('pages.models.modelOverviewTab.noRouteFlowData')} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <SectionHeading title={tr('pages.models.modelOverviewTab.capabilities')} description={tr('pages.models.modelOverviewTab.endpointSurfacesDiscovered')} />
            <div className="flex flex-wrap gap-1.5">
              {supportedEndpointTypes.length > 0 ? supportedEndpointTypes.map((endpoint) => (
                <ToneBadge tone="-success" key={endpoint}>{endpoint}</ToneBadge>
              )) : <ToneBadge tone="-muted">{tr('pages.models.modelOverviewTab.noCapabilityMetadata')}</ToneBadge>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-3">
          <SectionHeading title={tr('components.charts.downstreamKeyTrendChart.cost')} description={tr('pages.models.modelOverviewTab.pricingDescription')} icon={<Coins className="size-4" />} />
          <div className="mb-3 grid gap-2 2xl:grid-cols-2">
            <PricingSummaryCard
              title={tr('pages.models.modelOverviewTab.measuredEntryPricing')}
              description={tr('pages.models.modelOverviewTab.measuredProxyBillingAverage')}
              pricing={details.pricing.measured}
              emptyText={tr('pages.models.modelOverviewTab.noMeasuredEntryPricing')}
            />
            <PricingSummaryCard
              title={tr('pages.models.modelOverviewTab.theoreticalEntryPricing')}
              description={tr('pages.models.modelOverviewTab.tableContentsManualcostconfiguration')}
              pricing={details.pricing.theoretical}
              emptyText={tr('pages.models.modelOverviewTab.noTheoreticalEntryPricing')}
              weightedComponents
            />
          </div>
          <AttemptPricingDetails pricing={details.pricing.theoretical} />
        </CardContent>
      </Card>
    </div>
  );
}
