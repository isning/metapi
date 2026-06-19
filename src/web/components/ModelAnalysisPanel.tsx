import { useMemo, useState } from 'react';
import { InlineBrandIcon } from './BrandIcon.js';
import { formatCompactTokenMetric } from '../numberFormat.js';
import { useThemeLabelColor } from './useThemeLabelColor.js';
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

type TabKey = 'spend' | 'trend' | 'calls' | 'rank';

interface SpendDistributionItem { model: string; spend: number; calls: number; }
interface SpendTrendItem { day: string; spend: number; }
interface CallsDistributionItem { model: string; calls: number; share: number; }
interface CallRankingItem { model: string; calls: number; successRate: number; avgLatencyMs: number; spend: number; tokens: number; }

interface ModelAnalysisData {
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
  { key: 'spend', label: '消耗分布', icon: '💰' },
  { key: 'trend', label: '消耗趋势', icon: '📈' },
  { key: 'calls', label: '调用分布', icon: '🔄' },
  { key: 'rank', label: '排行榜', icon: '🏆' },
];

const PIE_COLORS = ['#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

function toSafeNumber(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) return 0;
  return value;
}

function formatCurrency(value: number): string {
  const n = toSafeNumber(value);
  if (n >= 1000) return `$${n.toFixed(2)}`;
  if (n >= 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(6)}`;
}

function formatPercent(value: number): string {
  return `${toSafeNumber(value).toFixed(1)}%`;
}

function EmptyBlock() {
  return (
    <EmptyStateBlock
      title="暂无模型调用数据"
      description="等待代理流量进入后会自动生成统计图表"
    />
  );
}

export default function ModelAnalysisPanel({ data }: ModelAnalysisPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('spend');
  const labelColor = useThemeLabelColor();

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
    data: [{ id: 'data', values: spendDistribution.map(d => ({ model: d.model.length > 25 ? d.model.slice(0, 25) + '...' : d.model, value: toSafeNumber(d.spend) })).reverse() }],
    xField: 'value', yField: 'model', direction: 'horizontal' as const,
    bar: { style: { cornerRadius: [0, 6, 6, 0], fill: { gradient: 'linear' as const, x0: 0, y0: 0, x1: 1, y1: 0, stops: [{ offset: 0, color: '#4f46e5' }, { offset: 1, color: '#818cf8' }] } } },
    label: { visible: true, position: 'right', formatter: '{value}', style: { fontSize: 11, fill: labelColor, stroke: 'transparent' } },
    axes: [{ orient: 'left', label: { style: { fontSize: 11, fill: labelColor } } }, { orient: 'bottom', visible: false }],
    animation: true, background: 'transparent',
  }), [spendDistribution, labelColor]);

  const trendSpec = useMemo(() => ({
    type: 'area' as const,
    data: [{ id: 'data', values: spendTrend.map(d => ({ day: d.day, spend: toSafeNumber(d.spend) })) }],
    xField: 'day', yField: 'spend',
    line: { style: { lineWidth: 2.5, curveType: 'monotone' as const, stroke: '#4f46e5' } },
    area: { style: { fill: { gradient: 'linear' as const, x0: 0, y0: 0, x1: 0, y1: 1, stops: [{ offset: 0, color: 'rgba(79,70,229,0.25)' }, { offset: 1, color: 'rgba(79,70,229,0.02)' }] }, curveType: 'monotone' as const } },
    point: { visible: true, style: { size: 7, fill: '#4f46e5', stroke: '#fff', lineWidth: 2 } },
    axes: [{ orient: 'bottom' as const, label: { style: { fontSize: 11, fill: labelColor } } }, { orient: 'left' as const, label: { style: { fontSize: 11, fill: labelColor } } }],
    tooltip: { mark: { content: [{ key: () => '消耗', value: (datum: any) => formatCurrency(datum?.spend ?? 0) }] } },
    animation: true, background: 'transparent',
  }), [spendTrend, labelColor]);

  const callsPieSpec = useMemo(() => ({
    type: 'pie' as const,
    data: [{ id: 'data', values: callsDistribution.map(d => ({ model: d.model, calls: toSafeNumber(d.calls) })) }],
    valueField: 'calls', categoryField: 'model',
    outerRadius: 0.8, innerRadius: 0.55,
    pie: { style: { cornerRadius: 4, padAngle: 0.02 } },
    label: { visible: true, position: 'outside', formatter: '{_percent_}%', style: { fill: labelColor } },
    legends: { visible: false },
    animation: true,
    color: PIE_COLORS,
    background: 'transparent',
  }), [callsDistribution, labelColor]);

  if (!hasData) return <EmptyBlock />;

  return (
    <div>
      {/* Summary Cards */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-3">
            <div className="text-xs text-muted-foreground">总消耗</div>
            <div className="mt-1 text-2xl font-semibold">{formatCurrency(totals.spend)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3">
            <div className="text-xs text-muted-foreground">总调用</div>
            <div className="mt-1 text-2xl font-semibold">{Math.round(totals.calls).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3">
            <div className="text-xs text-muted-foreground">总 Tokens</div>
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
                <span className="font-semibold tabular-nums text-foreground">{formatCurrency(d.spend)}</span>
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
                  <ChartLegendSwatch color={PIE_COLORS[idx % PIE_COLORS.length]} />
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
              <TableHead>模型</TableHead>
              <TableHead className="text-center">调用</TableHead>
              <TableHead className="text-center">成功率</TableHead>
              <TableHead className="text-center">平均延迟</TableHead>
              <TableHead className="text-right">消耗</TableHead>
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
                  <TableCell className="text-right font-mono text-sm font-medium">{formatCurrency(item.spend)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
