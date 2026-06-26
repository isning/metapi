import { Activity, Timer } from 'lucide-react';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import SectionHeading from '../../components/details/SectionHeading.js';
import MetricGrid from '../../components/metrics/MetricGrid.js';
import MetricTile from '../../components/metrics/MetricTile.js';
import { Button } from '../../components/ui/button/index.js';
import { ButtonGroup } from '../../components/ui/button-group/index.js';
import { Card, CardContent } from '../../components/ui/card/index.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table/index.js';
import type { ModelDetailsView, ModelMetricsRange } from './modelDetailsView.js';
import { formatLatencyValue, formatSuccessRate } from './modelDetailsView.js';
import { tr } from '../../i18n.js';

type ModelPerformanceTabProps = {
  details: ModelDetailsView;
  range: ModelMetricsRange;
  onRangeChange: (range: ModelMetricsRange) => void;
};

const ranges: ModelMetricsRange[] = ['1h', '24h', '7d'];

export default function ModelPerformanceTab({
  details,
  range,
  onRangeChange,
}: ModelPerformanceTabProps) {
  const { model } = details;
  const nodes = details.routeFlow?.nodes ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeading title={tr('pages.models.modelPerformanceTab.title')} description={tr('pages.models.modelPerformanceTab.description')} />
        <ButtonGroup>
          {ranges.map((item) => (
            <Button key={item} type="button" variant={range === item ? 'secondary' : 'outline'} size="sm" onClick={() => onRangeChange(item)}>
              {item}
            </Button>
          ))}
        </ButtonGroup>
      </div>

      <MetricGrid>
        <MetricTile label={tr('components.modelAnalysisPanel.successRate')} value={formatSuccessRate(model.successRate)} icon={<Activity className="size-4" />} tone={model.successRate == null ? 'muted' : model.successRate >= 90 ? 'success' : 'warning'} />
        <MetricTile label={tr('pages.sites.latency')} value={formatLatencyValue(model.avgLatency)} icon={<Timer className="size-4" />} tone={model.avgLatency == null ? 'muted' : model.avgLatency >= 3000 ? 'destructive' : model.avgLatency >= 1000 ? 'warning' : 'success'} />
      </MetricGrid>

      <Card>
        <CardContent className="p-3">
          <SectionHeading title={tr('pages.models.modelPerformanceTab.runtimeHistory')} description={tr('pages.models.modelPerformanceTab.selectedRange').replace('{range}', range)} />
          <EmptyStateBlock title={tr('pages.models.modelPerformanceTab.noRuntimeHistory')} description={tr('pages.models.modelPerformanceTab.noRuntimeHistoryDescription')} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3">
          <SectionHeading title={tr('pages.models.modelPerformanceTab.routeNodeMetrics')} description={tr('pages.models.modelPerformanceTab.routeNodeMetricsDescription')} />
          {nodes.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr('pages.models.modelPerformanceTab.endpoint')}</TableHead>
                  <TableHead>{tr('components.notificationPanel.status')}</TableHead>
                  <TableHead>{tr('components.modelAnalysisPanel.successRate')}</TableHead>
                  <TableHead>{tr('pages.sites.latency')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((node) => (
                  <TableRow key={node.id}>
                    <TableCell className="font-mono text-xs">{node.label}</TableCell>
                    <TableCell>{node.status}</TableCell>
                    <TableCell>{node.metrics.successRate == null ? tr('common.notAvailable') : `${node.metrics.successRate}%`}</TableCell>
                    <TableCell>{node.metrics.avgLatencyMs == null ? tr('common.notAvailable') : `${node.metrics.avgLatencyMs}ms`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyStateBlock title={tr('pages.models.modelPerformanceTab.noRouteNodeMetrics')} description={tr('pages.models.modelPerformanceTab.routeNodeMetricsEmptyDescription')} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
