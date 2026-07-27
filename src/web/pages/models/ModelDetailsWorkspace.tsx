import { Activity, Code2, Copy, GitBranch, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import { BrandIcon } from '../../components/BrandIcon.js';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import ToneBadge from '../../components/ToneBadge.js';
import EntityHeader from '../../components/workspace/EntityHeader.js';
import { Button } from '../../components/ui/button/index.js';
import * as Tabs from '../../components/ui/tabs/index.js';
import type { ModelDetailsTab, ModelDetailsView, ModelMetricsRange } from './modelDetailsView.js';
import { formatLatencyValue, formatSuccessRate, getModelCredentialCount, resolveModelDisplayMetrics } from './modelDetailsView.js';
import ModelOverviewTab from './ModelOverviewTab.js';
import ModelRoutingTab from './ModelRoutingTab.js';
import ModelPerformanceTab from './ModelPerformanceTab.js';
import ModelApiTab from './ModelApiTab.js';
import ModelDiagnosticsTab from './ModelDiagnosticsTab.js';
import { tr } from '../../i18n.js';
import { usePrefetchIntent } from '../../components/usePrefetchIntent.js';
import { MODEL_DETAILS_PREFETCH_INTENT_MS } from './modelDetailsResourcePolicy.js';

type RoutingViewMode = 'execution' | 'cost' | 'diagnostics';

type ModelDetailsWorkspaceProps = {
  details: ModelDetailsView | null;
  tab: ModelDetailsTab;
  onTabChange: (tab: ModelDetailsTab) => void;
  range: ModelMetricsRange;
  onRangeChange: (range: ModelMetricsRange) => void;
  onTabPrefetch?: (tab: ModelDetailsTab) => void;
  routingViewMode: RoutingViewMode;
  onRoutingViewModeChange: (mode: RoutingViewMode) => void;
  onCopyModel: (model: string) => void;
  onRefresh: () => void;
  onCopyJson?: (text: string) => void;
};

const tabItems: Array<{ value: ModelDetailsTab; label: string; icon: JSX.Element }> = [
  { value: 'overview', label: tr('pages.models.modelDetailsView.overview'), icon: <Info className="size-4" /> },
  { value: 'routing', label: tr('pages.models.modelDetailsView.routing'), icon: <GitBranch className="size-4" /> },
  { value: 'performance', label: tr('pages.models.modelDetailsView.performance'), icon: <Activity className="size-4" /> },
  { value: 'api', label: 'API', icon: <Code2 className="size-4" /> },
  { value: 'diagnostics', label: tr('pages.models.modelDetailsView.diagnostics'), icon: <TriangleAlert className="size-4" /> },
];

function StatusBadge({ status }: { status: ModelDetailsView['status'] }) {
  const tone = status === 'healthy' ? '-success' : status === 'unknown' ? '-muted' : status === 'unavailable' ? 'error' : 'warning';
  return <ToneBadge tone={tone}>{tr(`pages.models.modelDetailsView.status.${status}`)}</ToneBadge>;
}

export default function ModelDetailsWorkspace({
  details,
  tab,
  onTabChange,
  range,
  onRangeChange,
  onTabPrefetch,
  routingViewMode,
  onRoutingViewModeChange,
  onCopyModel,
  onRefresh,
  onCopyJson,
}: ModelDetailsWorkspaceProps) {
  const tabPrefetchIntent = usePrefetchIntent<ModelDetailsTab>({
    delayMs: MODEL_DETAILS_PREFETCH_INTENT_MS,
    onIntent: (nextTab) => onTabPrefetch?.(nextTab),
  });

  if (!details) {
    return (
      <div className="p-4">
        <EmptyStateBlock
          title={tr('pages.models.modelDetailsView.selectModel')}
          description={tr('pages.models.modelDetailsView.selectModelDescription')}
        />
      </div>
    );
  }

  const { model } = details;
  const displayMetrics = resolveModelDisplayMetrics({
    observability: details.observability,
  });

  const headerBadges = (
    <>
      <StatusBadge status={details.status} />
      {details.brandName ? <ToneBadge tone="-info">{details.brandName}</ToneBadge> : null}
      {model.supportedEndpointTypes.slice(0, 6).map((endpoint) => (
        <ToneBadge key={endpoint} tone="-muted">{endpoint}</ToneBadge>
      ))}
      {model.supportedEndpointTypes.length > 6 ? <ToneBadge tone="-muted">+{model.supportedEndpointTypes.length - 6}</ToneBadge> : null}
    </>
  );

  const headerMetrics = (
    <>
      <span>{tr('pages.models.modelDetailsView.success')} <span className="font-mono text-foreground">{formatSuccessRate(displayMetrics.successRate)}</span></span>
      <span>{tr('pages.models.modelDetailsView.latency')} <span className="font-mono text-foreground">{formatLatencyValue(displayMetrics.avgLatency)}</span></span>
      <span>{tr('pages.models.modelDetailsView.accounts')} <span className="font-mono text-foreground">{model.accountCount}</span></span>
      <span>{tr('pages.models.credentials')} <span className="font-mono text-foreground">{getModelCredentialCount(model)}</span></span>
      <span>{details.freshnessLabel}</span>
    </>
  );

  const activeTabContent = (() => {
    if (tab === 'overview') return <ModelOverviewTab details={details} />;
    if (tab === 'routing') return <ModelRoutingTab routing={details.routing} viewMode={routingViewMode} onViewModeChange={onRoutingViewModeChange} />;
    if (tab === 'performance') return <ModelPerformanceTab performance={details.performance} range={range} onRangeChange={onRangeChange} />;
    if (tab === 'api') return <ModelApiTab details={details} />;
    return <ModelDiagnosticsTab diagnostics={details.diagnosticsView} onCopyJson={onCopyJson} />;
  })();

  return (
    <div className="min-w-0">
      <EntityHeader
        icon={<BrandIcon model={model.name} size={40} />}
        title={model.name}
        meta={<><span>{details.brandName || tr('pages.models.modelDetailsView.providerUnknown')}</span><span>·</span><span>{details.freshnessLabel}</span></>}
        badges={headerBadges}
        metrics={headerMetrics}
        actions={(
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="icon" aria-label={tr('pages.models.modelDetailsView.copyModelName')} onClick={() => onCopyModel(model.name)}>
              <Copy className="size-4" />
            </Button>
            <Button type="button" variant="outline" size="icon" aria-label={tr('pages.models.modelDetailsView.refreshModels')} onClick={onRefresh}>
              <RefreshCw className="size-4" />
            </Button>
          </div>
        )}
      />

      <div className="p-4">
        <Tabs.Tabs value={tab} onValueChange={(value) => onTabChange(value as ModelDetailsTab)}>
          <Tabs.TabsList className="flex h-auto w-full flex-wrap justify-start">
            {tabItems.map((item) => (
              <Tabs.TabsTrigger
                key={item.value}
                value={item.value}
                className="gap-1.5"
                onPointerEnter={() => tabPrefetchIntent.schedule(item.value)}
                onMouseEnter={() => tabPrefetchIntent.schedule(item.value)}
                onFocus={() => tabPrefetchIntent.schedule(item.value)}
                onPointerLeave={tabPrefetchIntent.cancel}
                onMouseLeave={tabPrefetchIntent.cancel}
                onBlur={tabPrefetchIntent.cancel}
              >
                {item.icon}
                {item.label}
                {item.value === 'diagnostics' && details.diagnostics.length > 0 ? (
                  <ToneBadge tone="warning">{details.diagnostics.length}</ToneBadge>
                ) : null}
              </Tabs.TabsTrigger>
            ))}
          </Tabs.TabsList>
          <Tabs.TabsContent value={tab} className="mt-4">
            {activeTabContent}
          </Tabs.TabsContent>
        </Tabs.Tabs>
      </div>
    </div>
  );
}
