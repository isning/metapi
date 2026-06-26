import { useState, useMemo } from 'react';
import { VChart } from '@visactor/react-vchart';
import { useThemeChartPalette, useThemeLabelColor } from '../useThemeLabelColor.js';
import { Skeleton } from '../ui/skeleton/index.js';
import EmptyStateBlock from '../EmptyStateBlock.js';
import { ChartFrame, ChartLegendSwatch, ChartMetricToggle, ChartShell } from './ChartShell.js';

import { tr } from '../../i18n.js';
interface SiteDistributionData {
  siteName: string;
  platform: string;
  totalBalance: number;
  rawBalance?: number;
  baseCostUnit?: string;
  valuedAccountCount?: number;
  valuationWarningCount?: number;
  totalSpend: number;
  accountCount: number;
}

interface SiteDistributionChartProps {
  data: SiteDistributionData[];
  loading?: boolean;
}

type ViewMode = 'balance' | 'spend';

function coerceDatumRecord(datum: unknown): Record<string, unknown> {
  return datum && typeof datum === 'object' ? datum as Record<string, unknown> : {};
}

function safeNumber(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) return 0;
  return value;
}

function SkeletonCircle() {
  return (
    <div className="flex items-center justify-center py-10">
      <Skeleton className="h-[200px] w-[200px] rounded-full" />
      <div className="ml-8 flex flex-col gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton className="h-3 w-3" />
            <Skeleton className={i === 0 ? 'h-3 w-20' : i === 1 ? 'h-3 w-[90px]' : i === 2 ? 'h-3 w-[100px]' : 'h-3 w-[110px]'} />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <EmptyStateBlock
      icon={(
        <svg
          width="64"
          height="64"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.2}
            d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.2}
            d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
          />
        </svg>
      )}
      title={tr('components.charts.siteDistributionChart.noSites')}
      description={tr('components.charts.siteDistributionChart.addSiteAutomatic')}
    />
  );
}

export default function SiteDistributionChart({ data, loading }: SiteDistributionChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('balance');
  const labelColor = useThemeLabelColor();
  const chartPalette = useThemeChartPalette();

  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.map((item) => ({
      siteName: item.siteName,
      platform: item.platform,
      value: safeNumber(viewMode === 'balance' ? item.totalBalance : item.totalSpend),
      rawBalance: safeNumber(item.rawBalance),
      baseCostUnit: item.baseCostUnit || 'USD',
      valuedAccountCount: safeNumber(item.valuedAccountCount),
      valuationWarningCount: safeNumber(item.valuationWarningCount),
      accountCount: safeNumber(item.accountCount),
    }));
  }, [data, viewMode]);

  const hasData = chartData.length > 0 && chartData.some((d) => d.value > 0);

  const spec = useMemo(() => {
    if (!hasData) return null;

    return {
      type: 'pie' as const,
      data: [{ id: 'siteData', values: chartData }],
      valueField: 'value',
      categoryField: 'siteName',
      outerRadius: 0.8,
      innerRadius: 0.55,
      pie: { style: { cornerRadius: 4, padAngle: 0.02 } },
      label: { visible: true, position: 'outside', formatter: '{_percent_}%', style: { fill: labelColor } },
      legends: { visible: false },
      tooltip: {
        mark: {
          content: [
            {
              key: (datum: unknown) => {
                const item = coerceDatumRecord(datum);
                return String(item.siteName || '-');
              },
              value: (datum: unknown) => {
                const item = coerceDatumRecord(datum);
                const val = safeNumber(item.value);
                const unit = String(item.baseCostUnit || 'USD');
                return viewMode === 'balance' ? `${formatValue(val)} ${unit}` : formatValue(val);
              },
            },
            {
              key: tr('components.charts.siteDistributionChart.share'),
              value: (datum: unknown) => {
                const item = coerceDatumRecord(datum);
                const pct = safeNumber(item._percent_);
                return `${pct.toFixed(1)}%`;
              },
            },
            {
              key: viewMode === 'balance' ? tr('components.charts.siteDistributionChart.rawBalance') : tr('components.charts.siteDistributionChart.sites'),
              value: (datum: unknown) => {
                const item = coerceDatumRecord(datum);
                if (viewMode !== 'balance') return String(item.accountCount || 0);
                return `${formatValue(safeNumber(item.rawBalance))} raw`;
              },
            },
            {
              key: tr('components.charts.siteDistributionChart.valuationCoverage'),
              value: (datum: unknown) => {
                const item = coerceDatumRecord(datum);
                const accountCount = safeNumber(item.accountCount);
                const valuedAccountCount = safeNumber(item.valuedAccountCount);
                if (viewMode !== 'balance') return '-';
                return `${valuedAccountCount}/${accountCount}`;
              },
            },
          ] as any,
        },
      },
      color: chartPalette,
      animation: true,
      background: 'transparent',
    };
  }, [chartData, chartPalette, hasData, labelColor, viewMode]);

  const formatValue = (value: number): string => {
    if (value >= 1000) return `$${value.toFixed(2)}`;
    if (value >= 1) return `$${value.toFixed(3)}`;
    return `$${value.toFixed(6)}`;
  };

  return (
    <ChartShell
      title={tr('components.charts.siteDistributionChart.sites2')}
      icon={(
          <svg
            className="h-4 w-4"
            width="16"
            height="16"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
            />
          </svg>
      )}
      actions={(
        <ChartMetricToggle
          value={viewMode}
          options={[
            { key: 'balance', label: tr('components.charts.siteDistributionChart.normalizedBalance') },
            { key: 'spend', label: tr('components.modelAnalysisPanel.consumptionDistribution') },
          ]}
          onChange={setViewMode}
        />
      )}
    >
      {loading ? (
        <SkeletonCircle />
      ) : !hasData ? (
        <EmptyState />
      ) : (
        <div>
          {spec && <ChartFrame spec={spec} height={300} />}
          <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5 px-1">
            {chartData.map((d, idx) => (
              <span key={d.siteName} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <ChartLegendSwatch color={chartPalette[idx % chartPalette.length] || chartPalette[0] || '#2563eb'} />
                <span className="max-w-[120px] truncate">{d.siteName}</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {viewMode === 'balance'
                    ? `${formatValue(d.value)} ${d.baseCostUnit}`
                    : formatValue(d.value)}
                </span>
                {viewMode === 'balance' && d.valuationWarningCount > 0 ? (
                  <span className="text-warning">!</span>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      )}
    </ChartShell>
  );
}
