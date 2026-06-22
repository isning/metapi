import { Activity, Coins, GitBranch, Info, KeyRound, Server, Timer, Users, Wallet } from 'lucide-react';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import SiteBadgeLink from '../../components/SiteBadgeLink.js';
import ToneBadge from '../../components/ToneBadge.js';
import SectionHeading from '../../components/details/SectionHeading.js';
import MetricGrid from '../../components/metrics/MetricGrid.js';
import MetricTile from '../../components/metrics/MetricTile.js';
import { Card, CardContent } from '../../components/ui/card/index.js';
import type { ModelDetailsView, ModelEntryPricing } from './modelDetailsView.js';
import { formatLatencyValue, formatSuccessRate } from './modelDetailsView.js';
import { renderGroupPricingValue } from './modelFormatting.js';

import { tr } from '../../i18n.js';
type ModelOverviewTabProps = {
  details: ModelDetailsView;
  siteIdByName: Map<string, number>;
  metadataHydrating: boolean;
};

function formatEntryPrice(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'unknown';
  return `$${value.toFixed(6).replace(/\.?0+$/, '')} / 1M`;
}

function formatMultiplier(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'unknown';
  return `${value.toFixed(4).replace(/\.?0+$/, '')}x`;
}

function formatEntryTotal(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'unknown';
  return `$${value.toFixed(6).replace(/\.?0+$/, '')} / preview`;
}

function PricingSummaryCard({
  title,
  description,
  pricing,
  emptyText,
}: {
  title: string;
  description: string;
  pricing: ModelEntryPricing | null;
  emptyText: string;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{description}</div>
        </div>
        {pricing ? <ToneBadge tone="-info">{pricing.sampleCount ?? pricing.sourceCount} samples</ToneBadge> : <ToneBadge tone="-muted">{tr('pages.settings.notConfigured')}</ToneBadge>}
      </div>
      {pricing ? (
        <div className="mt-3 grid gap-2">
          {(pricing.strategy || pricing.estimateLevel) && (
            <div className="flex flex-wrap gap-1.5">
              {pricing.strategy ? <ToneBadge tone="-muted">{pricing.strategy}</ToneBadge> : null}
              {pricing.estimateLevel ? <ToneBadge tone={pricing.estimateLevel === 'exact' ? '-success' : '-warning'}>{pricing.estimateLevel}</ToneBadge> : null}
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted-foreground">输入 entry</div>
              <div className="font-mono text-sm font-semibold">{formatEntryPrice(pricing.inputPerMillion)}</div>
              <div className="text-xs text-muted-foreground">{tr('pages.downstreamKeys.multiplier2')} {formatMultiplier(pricing.inputMultiplier)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">输出 entry</div>
              <div className="font-mono text-sm font-semibold">{formatEntryPrice(pricing.outputPerMillion)}</div>
              <div className="text-xs text-muted-foreground">{tr('pages.downstreamKeys.multiplier2')} {formatMultiplier(pricing.outputMultiplier)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Total</div>
              <div className="font-mono text-sm font-semibold">{formatEntryTotal(pricing.totalCostUsd)}</div>
              <div className="text-xs text-muted-foreground">{tr('pages.downstreamKeys.multiplier2')} {formatMultiplier(pricing.totalMultiplier ?? null)}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 text-sm text-muted-foreground">{emptyText}</div>
      )}
    </div>
  );
}

export default function ModelOverviewTab({
  details,
  siteIdByName,
  metadataHydrating,
}: ModelOverviewTabProps) {
  const { model } = details;
  const routeSummary = details.routeFlow?.summary ?? [];

  return (
    <div className="grid gap-4">
      <MetricGrid>
        <MetricTile label={tr('components.notificationPanel.status')} value={details.status} icon={<Activity className="size-4" />} tone={details.status === 'healthy' ? 'success' : details.status === 'unknown' ? 'muted' : 'warning'} />
        <MetricTile label={tr('components.modelAnalysisPanel.successRate')} value={formatSuccessRate(model.successRate)} icon={<Activity className="size-4" />} tone={model.successRate == null ? 'muted' : model.successRate >= 90 ? 'success' : 'warning'} />
        <MetricTile label={tr('pages.sites.latency')} value={formatLatencyValue(model.avgLatency)} icon={<Timer className="size-4" />} tone={model.avgLatency == null ? 'muted' : model.avgLatency >= 3000 ? 'destructive' : model.avgLatency >= 1000 ? 'warning' : 'success'} />
        <MetricTile label={tr('components.searchModal.accounts2')} value={model.accountCount} icon={<Users className="size-4" />} />
        <MetricTile label="Tokens" value={model.tokenCount} icon={<KeyRound className="size-4" />} />
        <MetricTile label="Endpoints" value={model.supportedEndpointTypes.length || 'unknown'} icon={<Server className="size-4" />} tone={model.supportedEndpointTypes.length > 0 ? 'default' : 'muted'} />
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
            <SectionHeading title={tr('pages.models.modelOverviewTab.routeSummary')} description={tr('pages.models.modelOverviewTab.compiledRouteEvidence')} icon={<GitBranch className="size-4" />} />
            {details.routeFlowLoading ? (
              <div className="text-sm text-muted-foreground">{tr('pages.models.modelOverviewTab.loadingRouteFlow')}</div>
            ) : details.routeFlowError ? (
              <div className="text-sm text-destructive">{details.routeFlowError}</div>
            ) : routeSummary.length > 0 ? (
              <div className="grid gap-1.5">
                {routeSummary.map((line) => (
                  <div key={line} className="text-sm text-muted-foreground">{line}</div>
                ))}
              </div>
            ) : (
              <EmptyStateBlock title={tr('pages.models.modelOverviewTab.noCompiledRoute')} description={tr('pages.models.modelOverviewTab.noRouteFlowData')} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <SectionHeading title={tr('pages.models.modelOverviewTab.capabilities')} description={tr('pages.models.modelOverviewTab.endpointSurfacesDiscovered')} />
            <div className="flex flex-wrap gap-1.5">
              {model.supportedEndpointTypes.length > 0 ? model.supportedEndpointTypes.map((endpoint) => (
                <ToneBadge tone="-success" key={endpoint}>{endpoint}</ToneBadge>
              )) : <ToneBadge tone="-muted">{metadataHydrating ? tr('pages.models.modelDetailsView.loadingModelMetadata') : tr('pages.models.modelOverviewTab.noCapabilityMetadata')}</ToneBadge>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-3">
          <SectionHeading title={tr('components.charts.downstreamKeyTrendChart.cost')} description={tr('pages.models.modelOverviewTab.pricingDescription')} icon={<Coins className="size-4" />} />
          <div className="mb-3 grid gap-2 lg:grid-cols-2">
            <PricingSummaryCard
              title={tr('pages.models.modelOverviewTab.measuredEntryPricing')}
              description={tr('pages.models.modelOverviewTab.acting')}
              pricing={details.pricing.measured}
              emptyText={tr('pages.models.modelOverviewTab.noMeasuredEntryPricing')}
            />
            <PricingSummaryCard
              title={tr('pages.models.modelOverviewTab.theoreticalEntryPricing')}
              description={tr('pages.models.modelOverviewTab.tableContentsManualcostconfiguration')}
              pricing={details.pricing.theoretical}
              emptyText={tr('pages.models.modelOverviewTab.noTheoreticalEntryPricing')}
            />
          </div>
          {model.pricingSources.length > 0 ? (
            <div className="grid gap-2">
              {model.pricingSources.map((source) => (
                <div key={`${source.siteId}-${source.accountId}`} className="rounded-md border p-3">
                  <div className="text-sm">
                    <SiteBadgeLink siteId={siteIdByName.get(source.siteName) ?? source.siteId} siteName={source.siteName} /> · {source.username || `ID:${source.accountId}`}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(source.groupPricing).map(([group, pricing]) => (
                      <ToneBadge tone="-info" key={group}>
                        {group}: {renderGroupPricingValue(pricing)}
                      </ToneBadge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyStateBlock title={tr('pages.models.modelOverviewTab.noPricingMetadata')} description={metadataHydrating ? tr('pages.models.modelDetailsView.loadingModelMetadata') : tr('pages.models.modelOverviewTab.noPricingDataReturned')} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
