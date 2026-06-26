import { useMemo, useState } from 'react';
import { InlineBrandIcon } from './BrandIcon.js';
import { formatCompactTokenMetric } from '../numberFormat.js';
import { useThemeChartPalette, useThemeLabelColor, useThemeToken } from './useThemeLabelColor.js';
import EmptyStateBlock from './EmptyStateBlock.js';
import ToneBadge from './ToneBadge.js';
import { Button } from './ui/button/index.js';
import { ButtonGroup } from './ui/button-group/index.js';
import { Card, CardContent } from './ui/card/index.js';
import { ChartFrame, ChartLegendSwatch } from './charts/ChartShell.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table/index.js';

import { tr } from '../i18n.js';
type TabKey = 'spend' | 'trend' | 'calls' | 'rank';

interface SpendDistributionItem { model: string; spend: number; calls: number; }
interface SpendTrendItem { day: string; spend: number; }
interface CallsDistributionItem { model: string; calls: number; share: number; }
interface CallRankingItem { model: string; calls: number; successRate: number; avgLatencyMs: number; spend: number; tokens: number; }

interface ModelAnalysisData {
  costUnit?: string;
  valuation?: {
    source?: 'raw' | 'wallet_valuation';
    valuedRows?: number;
    totalRows?: number;
    warningCount?: number;
  };
  totals?: { spend?: number; calls?: number; tokens?: number };
  spendDistribution?: SpendDistributionItem[];
  spendTrend?: SpendTrendItem[];
  callsDistribution?: CallsDistributionItem[];
  callRanking?: CallRankingItem[];
}

interface ModelAnalysisPanelProps {
  data?: ModelAnalysisData | null;
}

const tabs: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: 'spend', label: tr('components.modelAnalysisPanel.consumptionDistribution'), icon: '💰' },
  { key: 'trend', label: tr('components.modelAnalysisPanel.consumptionTrend'), icon: '📈' },
  { key: 'calls', label: tr('components.modelAnalysisPanel.callDistribution'), icon: '🔄' },
  { key: 'rank', label: tr('components.modelAnalysisPanel.rankingList'), icon: '🏆' },
];

function toSafeNumber(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) return 0;
  return value;
}

function normalizeCostUnit(value: unknown): string {
  const text = String(value || '').trim();
  return text ? text.toUpperCase() : 'USD';
}

function formatCurrency(value: number, unit: string): string {
  const n = toSafeNumber(value);
  if (n >= 1000) return `${n.toFixed(2)} ${unit}`;
  if (n >= 1) return `${n.toFixed(3)} ${unit}`;
  return `${n.toFixed(6)} ${unit}`;
}

function formatPercent(value: number): string {
  return `${toSafeNumber(value).toFixed(1)}%`;
}

function EmptyBlock() {
  return (
    <EmptyStateBlock
      title={tr('components.modelAnalysisPanel.noModelYetcalls')}
      description={tr('components.modelAnalysisPanel.proxyTrafficEmptyDescription')}
    />
  );
}

export default function ModelAnalysisPanel({ data }: ModelAnalysisPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('spend');
  const labelColor = useThemeLabelColor();
  const primaryColor = useThemeToken('--primary', '#2563eb');
  const primaryHoverColor = useThemeToken('--color-primary-hover', '#1d4ed8');
  const chartPalette = useThemeChartPalette();
  const costUnit = normalizeCostUnit(data?.costUnit);
  const valuation = {
    source: data?.valuation?.source || 'raw',
    valuedRows: toSafeNumber(data?.valuation?.valuedRows),
    totalRows: toSafeNumber(data?.valuation?.totalRows),
    warningCount: toSafeNumber(data?.valuation?.warningCount),
  };
  const hasValuationWarnings = valuation.source === 'wallet_valuation'
    && valuation.totalRows > 0
    && (valuation.valuedRows < valuation.totalRows || valuation.warningCount > 0);

  const totals = {
    spend: toSafeNumber(data?.totals?.spend),
    calls: toSafeNumber(data?.totals?.calls),
    tokens: toSafeNumber(data?.totals?.tokens),
  };

  const spendDistribution = (data?.spendDistribution || []).slice(0, 10);
  const spendTrend = data?.spendTrend || [];
  const callsDistribution = (data?.callsDistribution || []).slice(0, 10);
  const callRanking = (data?.callRanking || []).slice(0, 10);

  const hasData = totals.calls > 0
    || spendDistribution.length > 0
    || spendTrend.some((item) => toSafeNumber(item.spend) > 0);

  const spendBarSpec = useMemo(() => ({
    type: 'bar' as const,
    data: [{
      id: 'data',
      values: spendDistribution.map(d => ({
        model: d.model.length > 25 ? `${d.model.slice(0, 25)}...` : d.model,
        value: toSafeNumber(d.spend),
        displayValue: formatCurrency(d.spend, costUnit),
      })).reverse(),
    }],
    xField: 'value', yField: 'model', direction: 'horizontal' as const,
    bar: { style: { cornerRadius: [0, 6, 6, 0], fill: { gradient: 'linear' as const, x0: 0, y0: 0, x1: 1, y1: 0, stops: [{ offset: 0, color: primaryColor }, { offset: 1, color: primaryHoverColor }] } } },
    label: {
      visible: true,
      position: 'right',
      formatter: '{displayValue}',
      style: { fontSize: 11, fill: labelColor, stroke: 'transparent' },
    },
    axes: [{ orient: 'left', label: { style: { fontSize: 11, fill: labelColor } } }, { orient: 'bottom', visible: false }],
    animation: true, background: 'transparent',
  }), [costUnit, labelColor, primaryColor, primaryHoverColor, spendDistribution]);

  const trendSpec = useMemo(() => ({
    type: 'area' as const,
    data: [{ id: 'data', values: spendTrend.map(d => ({ day: d.day, spend: toSafeNumber(d.spend) })) }],
    xField: 'day', yField: 'spend',
    line: { style: { lineWidth: 2.5, curveType: 'monotone' as const, stroke: primaryColor } },
    area: { style: { fill: { gradient: 'linear' as const, x0: 0, y0: 0, x1: 0, y1: 1, stops: [{ offset: 0, color: primaryColor }, { offset: 1, color: 'transparent' }] }, fillOpacity: 0.22, curveType: 'monotone' as const } },
    point: { visible: true, style: { size: 7, fill: primaryColor, stroke: '#fff', lineWidth: 2 } },
    axes: [{ orient: 'bottom' as const, label: { style: { fontSize: 11, fill: labelColor } } }, { orient: 'left' as const, label: { style: { fontSize: 11, fill: labelColor } } }],
    tooltip: { mark: { content: [{ key: () => tr('components.modelAnalysisPanel.spend'), value: (datum: any) => formatCurrency(datum?.spend ?? 0, costUnit) }] } },
    animation: true, background: 'transparent',
  }), [costUnit, labelColor, primaryColor, spendTrend]);

  const callsPieSpec = useMemo(() => ({
    type: 'pie' as const,
    data: [{ id: 'data', values: callsDistribution.map(d => ({ model: d.model, calls: toSafeNumber(d.calls) })) }],
    valueField: 'calls', categoryField: 'model',
    outerRadius: 0.8, innerRadius: 0.55,
    pie: { style: { cornerRadius: 4, padAngle: 0.02 } },
    label: { visible: true, position: 'outside', formatter: '{_percent_}%', style: { fill: labelColor } },
    legends: { visible: false },
    animation: true,
    color: chartPalette,
    background: 'transparent',
  }), [callsDistribution, chartPalette, labelColor]);

  if (!hasData) return <EmptyBlock />;

  return (
    <div>
      {/* Summary Cards */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-3">
            <div className="text-xs text-muted-foreground">{tr('components.modelAnalysisPanel.totalSpend')}</div>
            <div className="mt-1 text-2xl font-semibold">{formatCurrency(totals.spend, costUnit)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3">
            <div className="text-xs text-muted-foreground">{tr('components.modelAnalysisPanel.totalCalls')}</div>
            <div className="mt-1 text-2xl font-semibold">{Math.round(totals.calls).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3">
            <div className="text-xs text-muted-foreground">{tr('components.modelAnalysisPanel.tokens')}</div>
            <div className="mt-1 text-2xl font-semibold">{formatCompactTokenMetric(totals.tokens)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Pill Tabs */}
      <div className="mb-4">
        <ButtonGroup>
          {tabs.map(tab => (
            <Button
              type="button"
              key={tab.key}
              variant={activeTab === tab.key ? 'secondary' : 'outline'}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.icon} {tab.label}
            </Button>
          ))}
        </ButtonGroup>
        {valuation.source === 'wallet_valuation' ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <ToneBadge tone={hasValuationWarnings ? 'warning' : 'success'}>
              {hasValuationWarnings
                ? tr('components.modelAnalysisPanel.valuationPartial')
                : tr('components.modelAnalysisPanel.valuationApplied')}
            </ToneBadge>
            <span>
              {tr('components.modelAnalysisPanel.valuationCoverage')
                .replace('{valued}', String(Math.round(valuation.valuedRows)))
                .replace('{total}', String(Math.round(valuation.totalRows)))}
            </span>
          </div>
        ) : null}
      </div>

      {/* Chart Content */}
      {activeTab === 'spend' && (
        <div>
          <ChartFrame spec={spendBarSpec} />
          <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5 px-1">
            {spendDistribution.map(d => (
              <span key={d.model} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <InlineBrandIcon model={d.model} size={13} />
                <span className="max-w-[150px] truncate">{d.model}</span>
                <span className="font-semibold tabular-nums text-foreground">{formatCurrency(d.spend, costUnit)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'trend' && (
        <ChartFrame spec={trendSpec} />
      )}

      {activeTab === 'calls' && (
        <div>
          <ChartFrame spec={callsPieSpec} />
          <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5 px-1">
            {callsDistribution.map((d, idx) => {
              return (
                <span key={d.model} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <ChartLegendSwatch color={chartPalette[idx % chartPalette.length] || chartPalette[0] || '#2563eb'} />
                  <InlineBrandIcon model={d.model} size={13} />
                  <span className="max-w-[150px] truncate">{d.model}</span>
                  <span className="font-semibold tabular-nums text-foreground">{d.calls}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'rank' && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-9 text-center">#</TableHead>
              <TableHead>{tr('components.modelAnalysisPanel.model')}</TableHead>
              <TableHead className="text-center">{tr('components.modelAnalysisPanel.calls')}</TableHead>
              <TableHead className="text-center">{tr('components.modelAnalysisPanel.successRate')}</TableHead>
              <TableHead className="text-center">{tr('components.modelAnalysisPanel.avgLatency')}</TableHead>
              <TableHead className="text-right">{tr('components.modelAnalysisPanel.spend2')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {callRanking.map((item, index) => {
              const latMs = item.avgLatencyMs;
              const latText = latMs >= 1000 ? `${(latMs / 1000).toFixed(latMs >= 60000 ? 0 : 1)}s` : `${latMs}ms`;
              return (
                <TableRow key={item.model}>
                  <TableCell className="text-center font-mono text-xs text-muted-foreground">{index + 1}</TableCell>
                  <TableCell>
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <InlineBrandIcon model={item.model} size={14} />
                      <code className="truncate text-xs font-medium">{item.model}</code>
                    </span>
                  </TableCell>
                  <TableCell className="text-center font-mono text-sm font-semibold">{Math.round(item.calls).toLocaleString()}</TableCell>
                  <TableCell className="text-center">
                    <ToneBadge tone={item.successRate >= 90 ? 'success' : item.successRate >= 60 ? 'warning' : 'error'}>
                      {formatPercent(item.successRate)}
                    </ToneBadge>
                  </TableCell>
                  <TableCell className="text-center"><ToneBadge tone="-muted">{latText}</ToneBadge></TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium">{formatCurrency(item.spend, costUnit)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
