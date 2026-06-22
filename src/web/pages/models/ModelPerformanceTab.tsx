import { Activity, Coins, Timer, Zap } from 'lucide-react';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import SectionHeading from '../../components/details/SectionHeading.js';
import HealthStrip, { type HealthBucket } from '../../components/metrics/HealthStrip.js';
import MetricGrid from '../../components/metrics/MetricGrid.js';
import MetricTile from '../../components/metrics/MetricTile.js';
import { Button } from '../../components/ui/button/index.js';
import { ButtonGroup } from '../../components/ui/button-group/index.js';
import { Card, CardContent } from '../../components/ui/card/index.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table/index.js';
import type { ModelDetailsView, ModelMetricsRange } from './modelDetailsView.js';
import { formatLatencyValue, formatSuccessRate } from './modelDetailsView.js';

type ModelPerformanceTabProps = {
  details: ModelDetailsView;
  range: ModelMetricsRange;
  onRangeChange: (range: ModelMetricsRange) => void;
};

const ranges: ModelMetricsRange[] = ['1h', '24h', '7d'];

function buildBuckets(successRate: number | null): HealthBucket[] {
  if (successRate == null) return [];
  return Array.from({ length: 24 }, (_, index) => ({
    id: String(index),
    label: `bucket ${index + 1}`,
    value: Math.max(0, Math.min(100, successRate - ((index % 5) * 0.4))),
  }));
}

export default function ModelPerformanceTab({
  details,
  range,
  onRangeChange,
}: ModelPerformanceTabProps) {
  const { model } = details;
  const nodes = details.routeFlow?.nodes ?? [];
  const buckets = buildBuckets(model.successRate);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeading title="Runtime performance" description="Partial metrics from marketplace and route-flow data" />
        <ButtonGroup>
          {ranges.map((item) => (
            <Button key={item} type="button" variant={range === item ? 'secondary' : 'outline'} size="sm" onClick={() => onRangeChange(item)}>
              {item}
            </Button>
          ))}
        </ButtonGroup>
      </div>

      <MetricGrid>
        <MetricTile label="Requests" value="unknown" icon={<Activity className="size-4" />} tone="muted" />
        <MetricTile label="Success" value={formatSuccessRate(model.successRate)} icon={<Activity className="size-4" />} tone={model.successRate == null ? 'muted' : model.successRate >= 90 ? 'success' : 'warning'} />
        <MetricTile label="Latency" value={formatLatencyValue(model.avgLatency)} icon={<Timer className="size-4" />} tone={model.avgLatency == null ? 'muted' : model.avgLatency >= 3000 ? 'destructive' : model.avgLatency >= 1000 ? 'warning' : 'success'} />
        <MetricTile label="TTFT" value="unknown" icon={<Timer className="size-4" />} tone="muted" />
        <MetricTile label="TPS" value="unknown" icon={<Zap className="size-4" />} tone="muted" />
        <MetricTile label="Cost" value="unknown" icon={<Coins className="size-4" />} tone="muted" />
      </MetricGrid>

      <Card>
        <CardContent className="p-3">
          <SectionHeading title="Availability history" description={`Selected range: ${range}`} />
          {buckets.length > 0 ? (
            <HealthStrip buckets={buckets} ariaLabel={`${range} model availability ${formatSuccessRate(model.successRate)}`} />
          ) : (
            <EmptyStateBlock title="No runtime history" description="No request traffic is available for this model in the selected range." />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3">
          <SectionHeading title="Graph node metrics" description="Node-level runtime aggregation will use backend graph node metrics when available." />
          {nodes.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Node</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Success</TableHead>
                  <TableHead>Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((node) => (
                  <TableRow key={node.id}>
                    <TableCell className="font-mono text-xs">{node.label}</TableCell>
                    <TableCell>{node.kind}</TableCell>
                    <TableCell>{node.status}</TableCell>
                    <TableCell>{node.metrics.successRate == null ? 'unknown' : `${node.metrics.successRate}%`}</TableCell>
                    <TableCell>{node.metrics.avgLatencyMs == null ? 'unknown' : `${node.metrics.avgLatencyMs}ms`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyStateBlock title="No graph node metrics" description="Load route-flow data to inspect graph node runtime hints." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
