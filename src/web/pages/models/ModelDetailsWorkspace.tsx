import { Activity, Code2, Copy, GitBranch, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import { BrandIcon } from '../../components/BrandIcon.js';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import ToneBadge from '../../components/ToneBadge.js';
import EntityHeader from '../../components/workspace/EntityHeader.js';
import { Button } from '../../components/ui/button/index.js';
import * as Tabs from '../../components/ui/tabs/index.js';
import type { ModelDetailsTab, ModelDetailsView, ModelMetricsRange } from './modelDetailsView.js';
import { formatLatencyValue, formatSuccessRate } from './modelDetailsView.js';
import ModelOverviewTab from './ModelOverviewTab.js';
import ModelRoutingTab from './ModelRoutingTab.js';
import ModelPerformanceTab from './ModelPerformanceTab.js';
import ModelApiTab from './ModelApiTab.js';
import ModelDiagnosticsTab from './ModelDiagnosticsTab.js';

type RoutingViewMode = 'effective' | 'candidates' | 'compiled' | 'diagnostics';

type ModelDetailsWorkspaceProps = {
  details: ModelDetailsView | null;
  tab: ModelDetailsTab;
  onTabChange: (tab: ModelDetailsTab) => void;
  range: ModelMetricsRange;
  onRangeChange: (range: ModelMetricsRange) => void;
  routingViewMode: RoutingViewMode;
  onRoutingViewModeChange: (mode: RoutingViewMode) => void;
  siteIdByName: Map<string, number>;
  metadataHydrating: boolean;
  onCopyModel: (model: string) => void;
  onRefresh: () => void;
  onCopyJson?: (text: string) => void;
};

const tabItems: Array<{ value: ModelDetailsTab; label: string; icon: JSX.Element }> = [
  { value: 'overview', label: 'Overview', icon: <Info className="size-4" /> },
  { value: 'routing', label: 'Routing', icon: <GitBranch className="size-4" /> },
  { value: 'performance', label: 'Performance', icon: <Activity className="size-4" /> },
  { value: 'api', label: 'API', icon: <Code2 className="size-4" /> },
  { value: 'diagnostics', label: 'Diagnostics', icon: <TriangleAlert className="size-4" /> },
];

function StatusBadge({ status }: { status: ModelDetailsView['status'] }) {
  const tone = status === 'healthy' ? '-success' : status === 'unknown' ? '-muted' : status === 'unavailable' ? 'error' : 'warning';
  return <ToneBadge tone={tone}>{status}</ToneBadge>;
}

export default function ModelDetailsWorkspace({
  details,
  tab,
  onTabChange,
  range,
  onRangeChange,
  routingViewMode,
  onRoutingViewModeChange,
  siteIdByName,
  metadataHydrating,
  onCopyModel,
  onRefresh,
  onCopyJson,
}: ModelDetailsWorkspaceProps) {
  if (!details) {
    return (
      <div className="p-4">
        <EmptyStateBlock title="Select a model" description="Choose a public model to inspect its route graph, runtime evidence, and API compatibility." />
      </div>
    );
  }

  const { model } = details;

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
      <span>Success <span className="font-mono text-foreground">{formatSuccessRate(model.successRate)}</span></span>
      <span>Latency <span className="font-mono text-foreground">{formatLatencyValue(model.avgLatency)}</span></span>
      <span>Accounts <span className="font-mono text-foreground">{model.accountCount}</span></span>
      <span>Tokens <span className="font-mono text-foreground">{model.tokenCount}</span></span>
      <span>{details.freshnessLabel}</span>
    </>
  );

  return (
    <div className="min-w-0">
      <EntityHeader
        icon={<BrandIcon model={model.name} size={40} />}
        title={model.name}
        meta={<><span>{details.brandName || 'Unknown provider'}</span><span>·</span><span>graph-native partial view</span></>}
        badges={headerBadges}
        metrics={headerMetrics}
        actions={(
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="icon" aria-label="Copy model name" onClick={() => onCopyModel(model.name)}>
              <Copy className="size-4" />
            </Button>
            <Button type="button" variant="outline" size="icon" aria-label="Refresh models" onClick={onRefresh}>
              <RefreshCw className="size-4" />
            </Button>
          </div>
        )}
      />

      <div className="p-4">
        <Tabs.Tabs value={tab} onValueChange={(value) => onTabChange(value as ModelDetailsTab)}>
          <Tabs.TabsList className="flex h-auto w-full flex-wrap justify-start">
            {tabItems.map((item) => (
              <Tabs.TabsTrigger key={item.value} value={item.value} className="gap-1.5">
                {item.icon}
                {item.label}
                {item.value === 'diagnostics' && details.diagnostics.length > 0 ? (
                  <ToneBadge tone="warning">{details.diagnostics.length}</ToneBadge>
                ) : null}
              </Tabs.TabsTrigger>
            ))}
          </Tabs.TabsList>
          <Tabs.TabsContent value="overview" className="mt-4">
            <ModelOverviewTab details={details} siteIdByName={siteIdByName} metadataHydrating={metadataHydrating} />
          </Tabs.TabsContent>
          <Tabs.TabsContent value="routing" className="mt-4">
            <ModelRoutingTab details={details} viewMode={routingViewMode} onViewModeChange={onRoutingViewModeChange} />
          </Tabs.TabsContent>
          <Tabs.TabsContent value="performance" className="mt-4">
            <ModelPerformanceTab details={details} range={range} onRangeChange={onRangeChange} />
          </Tabs.TabsContent>
          <Tabs.TabsContent value="api" className="mt-4">
            <ModelApiTab details={details} />
          </Tabs.TabsContent>
          <Tabs.TabsContent value="diagnostics" className="mt-4">
            <ModelDiagnosticsTab details={details} onCopyJson={onCopyJson} />
          </Tabs.TabsContent>
        </Tabs.Tabs>
      </div>
    </div>
  );
}
