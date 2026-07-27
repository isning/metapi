import { useMemo, useState } from 'react';
import { Activity, Gauge, Server, Timer } from 'lucide-react';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import SectionHeading from '../../components/details/SectionHeading.js';
import MetricGrid from '../../components/metrics/MetricGrid.js';
import MetricTile from '../../components/metrics/MetricTile.js';
import ToneBadge from '../../components/ToneBadge.js';
import { ChartFrame, ChartMetricToggle } from '../../components/charts/ChartShell.js';
import { useThemeLabelColor, useThemeToken } from '../../components/useThemeLabelColor.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../../components/ui/button/index.js';
import { ButtonGroup } from '../../components/ui/button-group/index.js';
import { Card, CardContent } from '../../components/ui/card/index.js';
import { Skeleton } from '../../components/ui/skeleton/index.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table/index.js';
import type { ModelDetailsView, ModelMetricsRange } from './modelDetailsView.js';
import { formatLatencyValue, formatSuccessRate, formatTokenSpeedValue } from './modelDetailsView.js';
import { tr } from '../../i18n.js';

type ModelPerformanceTabProps = {
  performance: ModelDetailsView['performance'];
  range: ModelMetricsRange;
  onRangeChange: (range: ModelMetricsRange) => void;
};

type RuntimeHistoryMetric = 'successRate' | 'firstTokenLatency' | 'outputSpeed' | 'calls';
type RuntimeHistory = NonNullable<ModelDetailsView['observability']>['history'];
type RuntimeHistoryBucket = RuntimeHistory['buckets'][number];
type RuntimeHistoryHealth = RuntimeHistoryBucket['entry'];

const ranges: ModelMetricsRange[] = ['5m', '15m', '1h', '6h', '24h', '7d', '30d'];
const historyMetricOptions: Array<{ key: RuntimeHistoryMetric; label: string }> = [
  { key: 'successRate', label: tr('components.modelAnalysisPanel.successRate') },
  { key: 'firstTokenLatency', label: tr('pages.models.firstTokenLatency') },
  { key: 'outputSpeed', label: tr('pages.models.outputSpeed') },
  { key: 'calls', label: tr('components.modelAnalysisPanel.calls') },
];

function aggregateAttemptBucket(bucket: RuntimeHistoryBucket) {
  const totals = bucket.executionAttempts.reduce((sum, item) => {
    const health = item.health;
    return {
      totalCalls: sum.totalCalls + health.totalCalls,
      successCalls: sum.successCalls + health.successCalls,
      failedCalls: sum.failedCalls + health.failedCalls,
      latencyTotal: sum.latencyTotal + (health.avgLatencyMs == null ? 0 : health.avgLatencyMs * health.latencySamples),
      latencySamples: sum.latencySamples + health.latencySamples,
      firstTokenLatencyTotal: sum.firstTokenLatencyTotal + (health.avgFirstTokenLatencyMs == null ? 0 : health.avgFirstTokenLatencyMs * health.firstTokenLatencySamples),
      firstTokenLatencySamples: sum.firstTokenLatencySamples + health.firstTokenLatencySamples,
      outputTokens: sum.outputTokens + health.outputTokens,
      outputTokenDurationMs: sum.outputTokenDurationMs + health.outputTokenDurationMs,
      outputTokenSamples: sum.outputTokenSamples + health.outputTokenSamples,
    };
  }, {
    totalCalls: 0,
    successCalls: 0,
    failedCalls: 0,
    latencyTotal: 0,
    latencySamples: 0,
    firstTokenLatencyTotal: 0,
    firstTokenLatencySamples: 0,
    outputTokens: 0,
    outputTokenDurationMs: 0,
    outputTokenSamples: 0,
  });
  return {
    successRate: totals.totalCalls > 0 ? Math.round((totals.successCalls / totals.totalCalls) * 10_000) / 100 : null,
    avgLatencyMs: totals.latencySamples > 0 ? Math.round(totals.latencyTotal / totals.latencySamples) : null,
    avgFirstTokenLatencyMs: totals.firstTokenLatencySamples > 0 ? Math.round(totals.firstTokenLatencyTotal / totals.firstTokenLatencySamples) : null,
    avgOutputTokensPerSecond: totals.outputTokens > 0 && totals.outputTokenDurationMs > 0
      ? Math.round((totals.outputTokens / totals.outputTokenDurationMs) * 1000 * 100) / 100
      : null,
    outputTokens: totals.outputTokens,
    outputTokenDurationMs: totals.outputTokenDurationMs,
    outputTokenSamples: totals.outputTokenSamples,
    totalCalls: totals.totalCalls,
    successCalls: totals.successCalls,
    failedCalls: totals.failedCalls,
  };
}

function normalizeCallCount(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function formatCallRatio(successCalls: number | null | undefined, totalCalls: number | null | undefined): string {
  return `${normalizeCallCount(successCalls)}/${normalizeCallCount(totalCalls)}`;
}

function hasInteractiveMetric(metrics: Pick<RuntimeHistoryHealth, 'avgFirstTokenLatencyMs' | 'avgOutputTokensPerSecond'>): boolean {
  return (
    (typeof metrics.avgFirstTokenLatencyMs === 'number' && Number.isFinite(metrics.avgFirstTokenLatencyMs))
    || (typeof metrics.avgOutputTokensPerSecond === 'number' && Number.isFinite(metrics.avgOutputTokensPerSecond))
  );
}

function metricEqual(left: number | null | undefined, right: number | null | undefined, epsilon = 0.01): boolean {
  const leftIsNumber = typeof left === 'number' && Number.isFinite(left);
  const rightIsNumber = typeof right === 'number' && Number.isFinite(right);
  if (!leftIsNumber && !rightIsNumber) return true;
  if (!leftIsNumber || !rightIsNumber) return false;
  return Math.abs(left - right) <= epsilon;
}

function shouldShowAttemptInteractiveMetrics(
  entry: Pick<RuntimeHistoryHealth, 'avgFirstTokenLatencyMs' | 'avgOutputTokensPerSecond'>,
  attempt: Pick<RuntimeHistoryHealth, 'avgFirstTokenLatencyMs' | 'avgOutputTokensPerSecond'>,
): boolean {
  if (!hasInteractiveMetric(attempt)) return false;
  if (!hasInteractiveMetric(entry)) return true;
  return !(
    metricEqual(entry.avgFirstTokenLatencyMs, attempt.avgFirstTokenLatencyMs, 1)
    && metricEqual(entry.avgOutputTokensPerSecond, attempt.avgOutputTokensPerSecond)
  );
}

function formatHistoryBucketLabel(value: string, granularity: RuntimeHistory['granularity'] | undefined): string {
  const parsed = new Date(value.includes(' ') ? `${value.replace(' ', 'T')}Z` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hour = String(parsed.getHours()).padStart(2, '0');
  const minute = String(parsed.getMinutes()).padStart(2, '0');
  if (granularity === 'day') return `${month}/${day}`;
  return `${month}/${day} ${hour}:${minute}`;
}

export function formatHistoryAxisLabel(value: string, granularity: RuntimeHistory['granularity'] | undefined): string {
  const parsed = new Date(value.includes(' ') ? `${value.replace(' ', 'T')}Z` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  if (granularity === 'day') return `${month}/${day}`;
  const hour = String(parsed.getHours()).padStart(2, '0');
  const minute = String(parsed.getMinutes()).padStart(2, '0');
  if (granularity === 'minute' || granularity === 'hour') return `${hour}:${minute}`;
  return `${month}/${day} ${hour}:${minute}`;
}

function healthTone(successRate: number | null | undefined, avgFirstTokenLatencyMs?: number | null): string {
  if (successRate == null) return '-muted';
  if (successRate < 90) return 'warning';
  if (avgFirstTokenLatencyMs != null && avgFirstTokenLatencyMs >= 3000) return 'warning';
  return '-success';
}

function successRateTone(successRate: number | null | undefined): string {
  if (successRate == null) return '-muted';
  return successRate >= 90 ? '-success' : 'warning';
}

function shouldSplitRuntimeHistoryMetric(metric: RuntimeHistoryMetric): boolean {
  return metric === 'successRate' || metric === 'calls';
}

function RuntimeHistoryChartSkeleton() {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-4 w-32" />
        <div className="flex gap-1">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-14" />
        </div>
      </div>
      <div className="rounded-md border p-3">
        <div className="grid h-[276px] grid-rows-[1fr_auto] gap-3">
          <div className="grid grid-rows-5 gap-3">
            {Array.from({ length: 5 }, (_item, index) => (
              <div key={index} className="flex items-center gap-3">
                <Skeleton className="h-3 w-8" />
                <Skeleton className="h-px flex-1" />
              </div>
            ))}
          </div>
          <div className="flex justify-between pl-11">
            {Array.from({ length: 5 }, (_item, index) => (
              <Skeleton key={index} className="h-3 w-10" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PerformanceMetricSkeletons() {
  return (
    <MetricGrid>
      <Card>
        <CardContent className="p-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-7 w-20" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="mt-3 h-7 w-24" />
        </CardContent>
      </Card>
    </MetricGrid>
  );
}

function RuntimeHistoryTableSkeleton() {
  return (
    <div className="mt-3 overflow-hidden rounded-md border">
      <div className="grid gap-0">
        {Array.from({ length: 5 }, (_item, rowIndex) => (
          <div key={rowIndex} className="grid grid-cols-4 gap-4 border-b p-3 last:border-b-0">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

function RuntimeNodeMetricsSkeleton() {
  return (
    <div className="grid gap-2">
      {Array.from({ length: 4 }, (_item, index) => (
        <div key={index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1.6fr_0.7fr_0.7fr_0.7fr_0.5fr] sm:items-center">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-10" />
        </div>
      ))}
    </div>
  );
}

function historyBucketIntervalMs(granularity: RuntimeHistory['granularity'] | undefined): number {
  if (granularity === 'day') return 24 * 60 * 60 * 1000;
  if (granularity === 'hour') return 60 * 60 * 1000;
  return 60 * 1000;
}

function parseHistoryBucketTime(value: string, granularity: RuntimeHistory['granularity'] | undefined): number | null {
  const parsed = granularity === 'day'
    ? new Date(`${value}T00:00:00Z`)
    : new Date(value.includes(' ') ? `${value.replace(' ', 'T')}Z` : value);
  const time = parsed.getTime();
  return Number.isFinite(time) ? time : null;
}

function formatUtcHistoryBucket(time: number, granularity: RuntimeHistory['granularity'] | undefined): string {
  const date = new Date(time);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  if (granularity === 'day') return `${year}-${month}-${day}`;
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:00`;
}

function emptyRuntimeHealth(window: RuntimeHistoryBucket['entry']['window']): RuntimeHistoryBucket['entry'] {
  return {
    status: 'unknown',
    successRate: null,
    totalCalls: 0,
    successCalls: 0,
    failedCalls: 0,
    avgLatencyMs: null,
    latencySamples: 0,
    avgFirstTokenLatencyMs: null,
    firstTokenLatencySamples: 0,
    avgOutputTokensPerSecond: null,
    outputTokens: 0,
    outputTokenDurationMs: 0,
    outputTokenSamples: 0,
    source: 'none',
    window,
  };
}

export function buildRuntimeHistoryChartBuckets(history: RuntimeHistory | null | undefined): RuntimeHistoryBucket[] {
  const buckets = history?.buckets ?? [];
  if (buckets.length <= 1) return buckets;
  const granularity = history?.granularity;
  const intervalMs = historyBucketIntervalMs(granularity);
  const keyedBuckets = new Map<string, RuntimeHistoryBucket>();
  const bucketTimes = buckets
    .map((bucket) => {
      const time = parseHistoryBucketTime(bucket.bucketStart, granularity);
      if (time == null) return null;
      keyedBuckets.set(formatUtcHistoryBucket(time, granularity), bucket);
      return time;
    })
    .filter((time): time is number => time != null)
    .sort((a, b) => a - b);
  if (bucketTimes.length <= 1) return buckets;
  const first = bucketTimes[0]!;
  const last = bucketTimes.at(-1)!;
  const fallbackWindow = buckets[0]!.entry.window;
  const expanded: RuntimeHistoryBucket[] = [];
  for (let time = first; time <= last; time += intervalMs) {
    const bucketStart = formatUtcHistoryBucket(time, granularity);
    const existing = keyedBuckets.get(bucketStart);
    expanded.push(existing ?? {
      bucketStart,
      bucketEnd: formatUtcHistoryBucket(time + intervalMs, granularity),
      entry: emptyRuntimeHealth(fallbackWindow),
      endpoints: [],
      executionAttempts: [],
    });
  }
  return expanded;
}

type AxisItem = {
  value?: unknown;
  rawValue?: unknown;
};

export function sampleRuntimeHistoryAxisItems<T>(items: T[], maxTicks = 6): T[] {
  if (items.length <= maxTicks) return items;
  const tickCount = Math.max(2, maxTicks);
  const indexes = new Set<number>([0, items.length - 1]);
  for (let slot = 1; slot < tickCount - 1; slot += 1) {
    indexes.add(Math.round((slot * (items.length - 1)) / (tickCount - 1)));
  }
  return Array.from(indexes)
    .sort((a, b) => a - b)
    .map((index) => items[index]!)
    .filter((item) => item != null);
}

export function filterRuntimeHistoryAxisItems<T>(items: T, maxTicks = 6): T {
  return Array.isArray(items)
    ? sampleRuntimeHistoryAxisItems(items, maxTicks) as T
    : items;
}

function RuntimeHistoryChart({
  observability,
  error,
  showLoadingSkeleton,
}: {
  observability: ModelDetailsView['performance']['observability'];
  error: string;
  showLoadingSkeleton: boolean;
}) {
  const [metric, setMetric] = useState<RuntimeHistoryMetric>('successRate');
  const history = observability?.history;
  const chartBuckets = useMemo(() => buildRuntimeHistoryChartBuckets(history), [history]);
  const labelColor = useThemeLabelColor();
  const borderColor = useThemeToken('--color-border-light', '#d7dee8');
  const successColor = useThemeToken('--success', '#047857');
  const warningColor = useThemeToken('--warning', '#b45309');
  const backgroundColor = useThemeToken('--background', '#ffffff');
  const popoverColor = useThemeToken('--popover', '#ffffff');
  const foregroundColor = useThemeToken('--foreground', '#111827');
  const popoverForegroundColor = useThemeToken('--popover-foreground', '#111827');
  const finalResultSeries = tr('pages.models.modelPerformanceTab.finalResult');
  const executionAttemptsSeries = tr('pages.models.modelPerformanceTab.executionAttempts');
  const splitSeries = shouldSplitRuntimeHistoryMetric(metric);
  const getSeriesName = (datum: Record<string, unknown> | undefined) => String(datum?.series || '');
  const isExecutionAttemptSeries = (datum: Record<string, unknown> | undefined) => getSeriesName(datum) === executionAttemptsSeries;
  const seriesColor = (datum: Record<string, unknown> | undefined) => (
    isExecutionAttemptSeries(datum) ? warningColor : successColor
  );
  const flatData = useMemo(() => chartBuckets.flatMap((bucket) => {
    const attemptAggregate = aggregateAttemptBucket(bucket);
    const rows = [
      {
        series: finalResultSeries,
        value: metric === 'successRate'
          ? bucket.entry.successRate
          : metric === 'firstTokenLatency'
            ? bucket.entry.avgFirstTokenLatencyMs
            : metric === 'outputSpeed'
              ? bucket.entry.avgOutputTokensPerSecond
              : bucket.entry.totalCalls,
      },
      ...(splitSeries ? [{
        series: executionAttemptsSeries,
        value: metric === 'successRate'
          ? attemptAggregate.successRate
          : attemptAggregate.totalCalls,
      }] : []),
    ];
    return rows
      .map((row) => ({
        bucket: bucket.bucketStart,
        label: formatHistoryBucketLabel(bucket.bucketStart, history?.granularity),
        series: row.series,
        value: row.value != null && Number.isFinite(row.value)
          ? row.value
          : metric === 'calls'
            ? 0
            : null,
      }));
  }), [chartBuckets, executionAttemptsSeries, finalResultSeries, history?.granularity, metric, splitSeries]);

  if (showLoadingSkeleton) {
    return <RuntimeHistoryChartSkeleton />;
  }

  if (flatData.length === 0) {
    return (
      <EmptyStateBlock
        title={tr('pages.models.modelPerformanceTab.noRuntimeHistory')}
          description={error || tr('pages.models.modelPerformanceTab.noRuntimeHistoryDescription')}
        />
      );
  }

  const spec: Record<string, unknown> = {
    type: metric === 'calls' ? 'bar' : 'line',
    data: [{ id: 'data', values: flatData }],
    xField: 'bucket',
    yField: 'value',
    seriesField: 'series',
    invalidType: 'link',
    line: {
      style: {
        lineWidth: (datum: Record<string, unknown>) => (isExecutionAttemptSeries(datum) ? 2.25 : 2.5),
        curveType: 'monotone',
        stroke: (datum: Record<string, unknown>) => seriesColor(datum),
        lineDash: (datum: Record<string, unknown>) => (isExecutionAttemptSeries(datum) ? [6, 4] : []),
      },
    },
    point: {
      visible: metric !== 'calls',
      style: {
        size: (datum: Record<string, unknown>) => (isExecutionAttemptSeries(datum) ? 5 : 6),
        fill: (datum: Record<string, unknown>) => seriesColor(datum),
        stroke: backgroundColor,
        lineWidth: 2,
      },
    },
    bar: {
      style: {
        cornerRadius: 3,
        fill: (datum: Record<string, unknown>) => seriesColor(datum),
        fillOpacity: (datum: Record<string, unknown>) => (isExecutionAttemptSeries(datum) ? 0.72 : 0.92),
      },
    },
    legends: {
      visible: splitSeries,
      orient: 'bottom',
      padding: { top: 10 },
      item: {
        label: {
          style: {
            fill: labelColor,
            fontSize: 12,
          },
          state: {
            unSelected: {
              fill: labelColor,
              opacity: 0.48,
            },
          },
        },
        shape: {
          style: {
            lineWidth: 0,
          },
        },
      },
    },
    axes: [
      {
        orient: 'bottom',
        visible: true,
        sampling: false,
        height: 48,
        minHeight: 48,
        maxHeight: 56,
        label: {
          visible: true,
          autoHide: false,
          autoRotate: false,
          dataFilter: (items: AxisItem[]) => filterRuntimeHistoryAxisItems(items, 6),
          space: 6,
          style: { fontSize: 11, fill: labelColor },
          formatMethod: (value: string) => formatHistoryAxisLabel(String(value || ''), history?.granularity),
        },
        domainLine: { visible: true, style: { stroke: borderColor } },
        tick: {
          visible: true,
          dataFilter: (items: AxisItem[]) => filterRuntimeHistoryAxisItems(items, 6),
          style: { stroke: borderColor },
        },
      },
      {
        orient: 'left',
        label: { style: { fontSize: 11, fill: labelColor } },
        grid: { style: { stroke: borderColor, lineDash: [4, 4] } },
        domainLine: { visible: false },
      },
    ],
    tooltip: {
      style: {
        panel: {
          backgroundColor: popoverColor,
          border: {
            color: borderColor,
            width: 1,
            radius: 6,
          },
          shadow: {
            x: 0,
            y: 10,
            blur: 24,
            spread: 0,
            color: 'rgba(15, 23, 42, 0.16)',
          },
        },
        titleLabel: { fill: popoverForegroundColor, fontSize: 12, fontWeight: 600 },
        keyLabel: { fill: labelColor, fontSize: 12 },
        valueLabel: { fill: foregroundColor, fontSize: 12, fontWeight: 600 },
        shape: { size: 8 },
      },
      dimension: {
        title: { value: (datum: Record<string, unknown>) => String(datum?.label || datum?.bucket || '') },
        content: [
          {
            key: (datum: Record<string, unknown>) => String(datum?.series || ''),
            value: (datum: Record<string, unknown>) => {
              if (datum?.value == null || !Number.isFinite(Number(datum.value))) return tr('common.notAvailable');
              const value = Number(datum.value);
              if (metric === 'successRate') return `${value}%`;
              if (metric === 'firstTokenLatency') return `${Math.round(value)}ms`;
              if (metric === 'outputSpeed') return formatTokenSpeedValue(value);
              return String(Math.round(value));
            },
          },
        ],
      },
    },
    color: splitSeries ? [successColor, warningColor] : [successColor],
    background: 'transparent',
    animationAppear: {
      line: { type: 'clipIn', duration: 650, easing: 'cubicOut' },
      point: { type: 'fadeIn', duration: 350, delay: 250, easing: 'cubicOut' },
      bar: { type: 'growHeightIn', duration: 500, easing: 'cubicOut' },
    },
    padding: { left: 8, right: 12, top: 6, bottom: 30 },
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {tr('pages.models.modelPerformanceTab.selectedRange').replace('{range}', history?.range || '')}
        </div>
        <ChartMetricToggle value={metric} options={historyMetricOptions} onChange={setMetric} />
      </div>
      <ChartFrame spec={spec} height={300} />
    </div>
  );
}

export default function ModelPerformanceTab({
  performance,
  range,
  onRangeChange,
}: ModelPerformanceTabProps) {
  const staleContentClassName = cn(
    'transition-opacity duration-150',
    performance.refreshing && 'opacity-75',
  );

  return (
    <div className="grid gap-4" aria-busy={performance.loading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeading title={tr('pages.models.modelPerformanceTab.title')} description={tr('pages.models.modelPerformanceTab.description')} />
        <div className="flex flex-wrap items-center gap-2">
          <ButtonGroup>
            {ranges.map((item) => (
              <Button key={item} type="button" variant={range === item ? 'secondary' : 'outline'} size="sm" onClick={() => onRangeChange(item)}>
                {item}
              </Button>
            ))}
          </ButtonGroup>
        </div>
      </div>

      {performance.initialLoading ? (
        <PerformanceMetricSkeletons />
      ) : (
        <MetricGrid>
          <MetricTile label={tr('components.modelAnalysisPanel.successRate')} value={formatSuccessRate(performance.successRate)} icon={<Activity className="size-4" />} tone={performance.successRate == null ? 'muted' : performance.successRate >= 90 ? 'success' : 'warning'} />
          <MetricTile label={tr('pages.models.firstTokenLatency')} value={formatLatencyValue(performance.avgFirstTokenLatency)} icon={<Timer className="size-4" />} tone={performance.avgFirstTokenLatency == null ? 'muted' : performance.avgFirstTokenLatency >= 3000 ? 'destructive' : performance.avgFirstTokenLatency >= 1000 ? 'warning' : 'success'} />
          <MetricTile label={tr('pages.models.outputSpeed')} value={formatTokenSpeedValue(performance.avgOutputTokensPerSecond)} icon={<Gauge className="size-4" />} tone={performance.avgOutputTokensPerSecond == null ? 'muted' : performance.avgOutputTokensPerSecond >= 20 ? 'success' : performance.avgOutputTokensPerSecond >= 5 ? 'warning' : 'destructive'} />
        </MetricGrid>
      )}

      <Card>
        <CardContent className="p-3">
          <SectionHeading title={tr('pages.models.modelPerformanceTab.runtimeHistory')} description={tr('pages.models.modelPerformanceTab.description')} />
          <div className={staleContentClassName}>
            <RuntimeHistoryChart
              observability={performance.observability}
              error={performance.error}
              showLoadingSkeleton={performance.initialLoading}
            />
          </div>
          {performance.initialLoading ? (
            <RuntimeHistoryTableSkeleton />
          ) : performance.recentBuckets.length > 0 ? (
            <div className={cn('mt-3 overflow-hidden rounded-md border', staleContentClassName)}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr('pages.models.modelPerformanceTab.runtimeHistory')}</TableHead>
                    <TableHead>{tr('pages.models.modelPerformanceTab.finalResult')}</TableHead>
                    <TableHead>{tr('pages.models.modelPerformanceTab.executionAttempts')}</TableHead>
                    <TableHead>{tr('pages.models.interactivePerformance')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {performance.recentBuckets.map((bucket) => {
                    const attemptAggregate = aggregateAttemptBucket(bucket);
                    const showAttemptInteractiveMetrics = shouldShowAttemptInteractiveMetrics(bucket.entry, attemptAggregate);
                    return (
                      <TableRow key={bucket.bucketStart}>
                        <TableCell className="font-mono text-xs">{formatHistoryBucketLabel(bucket.bucketStart, performance.observability?.history.granularity)}</TableCell>
                        <TableCell>
                          <div className={successRateTone(bucket.entry.successRate) === '-success' ? 'font-mono text-success' : 'font-mono'}>{formatSuccessRate(bucket.entry.successRate)}</div>
                          <div className="text-xs text-muted-foreground">{formatCallRatio(bucket.entry.successCalls, bucket.entry.totalCalls)}</div>
                        </TableCell>
                        <TableCell>
                          <div className={successRateTone(attemptAggregate.successRate) === '-success' ? 'font-mono text-success' : 'font-mono'}>{formatSuccessRate(attemptAggregate.successRate)}</div>
                          <div className="text-xs text-muted-foreground">{formatCallRatio(attemptAggregate.successCalls, attemptAggregate.totalCalls)}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-mono">{formatLatencyValue(bucket.entry.avgFirstTokenLatencyMs)}</div>
                          <div className="text-xs text-muted-foreground">{formatTokenSpeedValue(bucket.entry.avgOutputTokensPerSecond)}</div>
                          {showAttemptInteractiveMetrics ? (
                            <div className="text-xs text-muted-foreground">
                              {tr('pages.models.modelPerformanceTab.attemptAverage')}: {formatLatencyValue(attemptAggregate.avgFirstTokenLatencyMs)} · {formatTokenSpeedValue(attemptAggregate.avgOutputTokensPerSecond)}
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <SectionHeading title={tr('pages.models.modelPerformanceTab.routeNodeMetrics')} description={tr('pages.models.modelPerformanceTab.routeNodeMetricsDescription')} icon={<Server className="size-4" />} />
            <ToneBadge tone="-muted">{range}</ToneBadge>
          </div>
          {performance.initialLoading ? (
            <RuntimeNodeMetricsSkeleton />
          ) : performance.endpoints.length > 0 ? (
            <Table className={staleContentClassName}>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr('pages.models.modelPerformanceTab.endpoint')}</TableHead>
                  <TableHead>{tr('components.notificationPanel.status')}</TableHead>
                  <TableHead>{tr('components.modelAnalysisPanel.successRate')}</TableHead>
                  <TableHead>{tr('pages.models.interactivePerformance')}</TableHead>
                  <TableHead>{tr('components.modelAnalysisPanel.calls')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {performance.endpoints.map((endpoint) => (
                  <TableRow key={endpoint.endpointId}>
                    <TableCell>
                      <div className="font-mono text-xs">{endpoint.endpointId}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {[endpoint.label, endpoint.site?.name, endpoint.account?.label].filter(Boolean).join(' · ') || endpoint.actualModel || 'N/A'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <ToneBadge tone={healthTone(endpoint.health.successRate, endpoint.health.avgFirstTokenLatencyMs)}>
                        {endpoint.health.status}
                      </ToneBadge>
                    </TableCell>
                    <TableCell className={successRateTone(endpoint.health.successRate) === '-success' ? 'font-mono text-success' : 'font-mono'}>
                      {formatSuccessRate(endpoint.health.successRate)}
                    </TableCell>
                    <TableCell>
                      <div className="font-mono">{formatLatencyValue(endpoint.health.avgFirstTokenLatencyMs)}</div>
                      <div className="text-xs text-muted-foreground">{formatTokenSpeedValue(endpoint.health.avgOutputTokensPerSecond)}</div>
                    </TableCell>
                    <TableCell className="font-mono">{endpoint.health.totalCalls}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : performance.attempts.length > 0 ? (
            <Table className={staleContentClassName}>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr('components.modelRouteFlow.executionAttempt')}</TableHead>
                  <TableHead>{tr('components.notificationPanel.status')}</TableHead>
                  <TableHead>{tr('components.modelAnalysisPanel.successRate')}</TableHead>
                  <TableHead>{tr('pages.models.interactivePerformance')}</TableHead>
                  <TableHead>{tr('components.modelAnalysisPanel.calls')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {performance.attempts.map((attempt) => (
                  <TableRow key={attempt.executionAttemptId}>
                    <TableCell>
                      <div className="font-mono text-xs">{attempt.executionAttemptId}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{attempt.endpointId}</div>
                    </TableCell>
                    <TableCell>{attempt.enabled === false ? tr('components.modelRouteFlow.inactive') : tr('components.modelRouteFlow.active')}</TableCell>
                    <TableCell>{formatSuccessRate(attempt.health.successRate)}</TableCell>
                    <TableCell>
                      <div className="font-mono">{formatLatencyValue(attempt.health.avgFirstTokenLatencyMs)}</div>
                      <div className="text-xs text-muted-foreground">{formatTokenSpeedValue(attempt.health.avgOutputTokensPerSecond)}</div>
                    </TableCell>
                    <TableCell>{attempt.health.totalCalls}</TableCell>
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
