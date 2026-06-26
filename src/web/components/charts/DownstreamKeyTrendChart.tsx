import { useMemo, useState } from 'react';
import { formatDateTimeMinuteLocal } from '../../pages/helpers/checkinLogTime.js';
import { Skeleton } from '../ui/skeleton/index.js';
import EmptyStateBlock from '../EmptyStateBlock.js';
import { ChartFrame, ChartMetricToggle, ChartShell } from './ChartShell.js';

import { tr } from '../../i18n.js';
type Metric = 'tokens' | 'requests' | 'cost';

const METRIC_OPTIONS: Array<{ key: Metric; label: string }> = [
  { key: 'tokens', label: 'Tokens' },
  { key: 'requests', label: tr('components.charts.downstreamKeyTrendChart.requests') },
  { key: 'cost', label: tr('components.charts.downstreamKeyTrendChart.cost') },
];

export type DownstreamKeyTrendBucket = {
  startUtc: string | null;
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  successRate: number | null;
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatTrendAxisLabel(raw: string, bucketSeconds: number): string {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  const month = pad2(parsed.getMonth() + 1);
  const day = pad2(parsed.getDate());
  if (bucketSeconds >= 86400) return `${month}/${day}`;
  return `${month}/${day} ${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}`;
}

export default function DownstreamKeyTrendChart({
  buckets,
  bucketSeconds = 3600,
  loading,
  height = 260,
}: {
  buckets: DownstreamKeyTrendBucket[];
  bucketSeconds?: number;
  loading?: boolean;
  height?: number;
}) {
  const [metric, setMetric] = useState<Metric>('tokens');

  const flatData = useMemo(() => {
    if (!Array.isArray(buckets) || buckets.length === 0) return [];
    return buckets
      .map((bucket) => {
        const rawDate = (bucket.startUtc || '').trim();
        const value = metric === 'tokens'
          ? Number(bucket.totalTokens || 0)
          : (metric === 'requests'
            ? Number(bucket.totalRequests || 0)
            : Number(bucket.totalCost || 0));
        return {
          date: rawDate,
          tooltipDate: rawDate ? formatDateTimeMinuteLocal(rawDate) : '',
          value,
        };
      })
      .filter((row) => row.date.length > 0);
  }, [buckets, metric]);

  if (loading) {
    return (
      <ChartShell actions={<Skeleton className="h-[30px] w-40" />}>
        <Skeleton className="w-full" style={{ height }} />
      </ChartShell>
    );
  }

  if (!flatData || flatData.length === 0) {
    return (
      <ChartShell actions={<MetricToggle metric={metric} onChange={setMetric} />}>
        <EmptyStateBlock title={tr('components.charts.downstreamKeyTrendChart.noTrendData')} description={tr('components.charts.downstreamKeyTrendChart.keyTimeAvailableTokens')} />
      </ChartShell>
    );
  }

  const spec: Record<string, unknown> = {
    type: 'area' as const,
    data: [{ id: 'data', values: flatData }],
    xField: 'date',
    yField: 'value',
    area: {
      style: {
        curveType: 'monotone',
        fillOpacity: 0.2,
      },
    },
    line: {
      style: {
        curveType: 'monotone',
        lineWidth: 2,
      },
    },
    point: { visible: false },
    axes: [
      {
        orient: 'bottom',
        label: {
          style: { fontSize: 11, fill: 'var(--color-text-muted)' },
          formatMethod: (value: string) => formatTrendAxisLabel(String(value || ''), bucketSeconds),
        },
        domainLine: { style: { stroke: 'var(--color-border-light)' } },
        tick: { style: { stroke: 'var(--color-border-light)' } },
      },
      {
        orient: 'left',
        label: { style: { fontSize: 11, fill: 'var(--color-text-muted)' } },
        grid: { style: { stroke: 'var(--color-border-light)', lineDash: [4, 4] } },
        domainLine: { visible: false },
      },
    ],
    tooltip: {
      dimension: {
        title: { value: (datum: Record<string, unknown>) => String(datum?.tooltipDate || datum?.date || '') },
        content: [
          {
            key: () => METRIC_OPTIONS.find((opt) => opt.key === metric)?.label || 'Value',
            value: (datum: Record<string, unknown>) => {
              const value = Number(datum?.value ?? 0);
              if (metric === 'cost') return `$${value.toFixed(6)}`;
              return value.toLocaleString();
            },
          },
        ],
      },
    },
    color: ['var(--color-primary)'],
    background: 'transparent',
    animationAppear: {
      area: { type: 'fadeIn', duration: 500, easing: 'cubicOut' },
      line: { type: 'clipIn', duration: 700, easing: 'cubicOut' },
    },
    padding: { left: 8, right: 16, top: 8, bottom: 8 },
  };

  return (
    <ChartShell actions={<MetricToggle metric={metric} onChange={setMetric} />}>
      <ChartFrame spec={spec} height={height} />
    </ChartShell>
  );
}

function MetricToggle({
  metric,
  onChange,
}: {
  metric: Metric;
  onChange: (m: Metric) => void;
}) {
  return (
    <ChartMetricToggle value={metric} options={METRIC_OPTIONS} onChange={onChange} />
  );
}
