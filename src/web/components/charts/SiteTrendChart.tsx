import { useMemo, useState } from 'react';
import EmptyStateBlock from '../EmptyStateBlock.js';
import { Skeleton } from '../ui/skeleton/index.js';
import { ChartFrame, ChartMetricToggle, ChartShell } from './ChartShell.js';
import { useThemeChartPalette } from '../useThemeLabelColor.js';

import { tr } from '../../i18n.js';
/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SiteTrendData {
  date: string;
  sites: Record<string, { spend: number; calls: number }>;
}

interface SiteTrendChartProps {
  data: SiteTrendData[];
  loading?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

type Metric = 'spend' | 'calls';

const METRIC_OPTIONS: { key: Metric; label: string }[] = [
  { key: 'spend', label: tr('components.modelAnalysisPanel.consumptionTrend') },
  { key: 'calls', label: tr('components.charts.siteTrendChart.callTrend') },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function SiteTrendChart({ data, loading }: SiteTrendChartProps) {
  const [metric, setMetric] = useState<Metric>('spend');
  const chartPalette = useThemeChartPalette();

  /* ---------- data transform ---------- */

  const flatData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.flatMap((d) =>
      Object.entries(d.sites).map(([site, v]) => ({
        date: d.date,
        site,
        value: metric === 'spend' ? v.spend : v.calls,
      })),
    );
  }, [data, metric]);

  /* ---------- loading state ---------- */

  if (loading) {
    return (
      <ChartShell actions={<Skeleton className="h-8 w-[200px]" />}>
        <Skeleton className="h-[300px] w-full" />
      </ChartShell>
    );
  }

  /* ---------- empty state ---------- */

  if (!data || data.length === 0 || flatData.length === 0) {
    return (
      <ChartShell actions={<MetricToggle metric={metric} onChange={setMetric} />}>
        <EmptyStateBlock title={tr('components.charts.downstreamKeyTrendChart.noTrendData')} description={tr('components.charts.siteTrendChart.automatic')} />
      </ChartShell>
    );
  }

  /* ---------- vchart spec ---------- */

  const spec: Record<string, unknown> = {
    type: 'line' as const,
    data: [{ id: 'data', values: flatData }],
    xField: 'date',
    yField: 'value',
    seriesField: 'site',
    point: {
      visible: true,
      style: { size: 6 },
    },
    line: {
      style: { lineWidth: 2, curveType: 'monotone' },
    },
    legends: {
      visible: true,
      orient: 'bottom',
      padding: { top: 12 },
      item: {
        shape: { style: { symbolType: 'circle' } },
        label: { style: { fontSize: 12 } },
      },
    },
    tooltip: {
      mark: {
        title: { value: (datum: Record<string, unknown>) => datum?.date ?? '' },
        content: [
          {
            key: (datum: Record<string, unknown>) => datum?.site ?? '',
            value: (datum: Record<string, unknown>) => {
              const v = Number(datum?.value ?? 0);
              return metric === 'spend' ? `$${v.toFixed(4)}` : String(v);
            },
          },
        ],
      },
      dimension: {
        title: { value: (datum: Record<string, unknown>) => datum?.date ?? '' },
        content: [
          {
            key: (datum: Record<string, unknown>) => datum?.site ?? '',
            value: (datum: Record<string, unknown>) => {
              const v = Number(datum?.value ?? 0);
              return metric === 'spend' ? `$${v.toFixed(4)}` : String(v);
            },
          },
        ],
      },
    },
    animation: true,
    animationAppear: {
      line: { type: 'clipIn', duration: 800, easing: 'cubicOut' },
      point: { type: 'fadeIn', duration: 600, delay: 400, easing: 'cubicOut' },
    },
    axes: [
      {
        orient: 'bottom',
        label: { style: { fontSize: 11, fill: 'var(--color-text-muted)' } },
        domainLine: { style: { stroke: 'var(--color-border-light)' } },
        tick: { style: { stroke: 'var(--color-border-light)' } },
      },
      {
        orient: 'left',
        label: {
          style: { fontSize: 11, fill: 'var(--color-text-muted)' },
        },
        grid: { style: { stroke: 'var(--color-border-light)', lineDash: [4, 4] } },
        domainLine: { visible: false },
      },
    ],
    color: chartPalette,
    background: 'transparent',
    padding: { left: 8, right: 16, top: 8, bottom: 8 },
  };

  /* ---------- render ---------- */

  return (
    <ChartShell actions={<MetricToggle metric={metric} onChange={setMetric} />}>
      <ChartFrame spec={spec} height={320} />
    </ChartShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

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
