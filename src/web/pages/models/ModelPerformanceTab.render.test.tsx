import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelRuntimeObservability } from '../../api.js';
import { tr } from '../../i18n.js';
import ModelPerformanceTab from './ModelPerformanceTab.js';
import { buildModelDetailsView, type ModelDetailsView, type ModelMetricsRange, type ModelRow } from './modelDetailsView.js';

const chartSpecs = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('../../components/charts/ChartShell.js', () => ({
  ChartFrame: ({ spec, height }: { spec: Record<string, unknown>; height?: number }) => {
    chartSpecs.push(spec);
    return <div data-chart-frame="true" data-height={height} />;
  },
  ChartMetricToggle: <T extends string>({
    value,
    options,
    onChange,
  }: {
    value: T;
    options: Array<{ key: T; label: string }>;
    onChange: (value: T) => void;
  }) => (
    <div>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          data-active={value === option.key ? 'true' : 'false'}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}));

function collectText(node: ReactTestInstance): string {
  return node.children.map((child) => (
    typeof child === 'string' ? child : collectText(child)
  )).join('');
}

function hasClass(root: ReactTestInstance, className: string): boolean {
  return root.findAll((node) => (
    typeof node.props.className === 'string'
    && node.props.className.split(/\s+/).includes(className)
  )).length > 0;
}

function latestChartSpec(): Record<string, unknown> {
  const spec = chartSpecs[chartSpecs.length - 1];
  if (!spec) throw new Error('Expected a chart spec to be rendered.');
  return spec;
}

function latestChartRows(): Array<Record<string, unknown>> {
  const data = latestChartSpec().data as Array<{ values?: Array<Record<string, unknown>> }> | undefined;
  return data?.[0]?.values ?? [];
}

function chartSeriesNames(): string[] {
  return Array.from(new Set(latestChartRows().map((row) => String(row.series || ''))));
}

function clickMetric(root: ReactTestInstance, label: string) {
  const button = root.findAll((node) => (
    node.type === 'button' && collectText(node) === label
  ))[0];
  if (!button) throw new Error(`Metric button not found: ${label}`);
  act(() => {
    button.props.onClick();
  });
}

function createModel(name = 'deepseek-v4-flash-rerouted'): ModelRow {
  return {
    name,
    accountCount: 1,
    tokenCount: 1,
    managedTokenCount: 1,
    credentialCount: 1,
    endpointCount: 1,
    executionAttemptCount: 1,
    avgLatency: 120,
    successRate: 100,
    description: null,
    tags: [],
    supportedEndpointTypes: [],
    runtimeInventoryIssues: [],
    pricingSources: [],
    measuredEntryPricing: null,
    accounts: [
      {
        id: 1,
        site: 'Elysiver',
        username: 'tester',
        latency: 120,
        balance: 1,
        tokens: [{ id: 1, name: 'default', isDefault: true }],
        managedTokenCount: 1,
        credentialCount: 1,
        endpointCount: 1,
        executionAttemptCount: 1,
      },
    ],
    siteCounts: {
      Elysiver: { endpointCount: 1, executionAttemptCount: 1, credentialCount: 1 },
    },
  };
}

function createHealth(
  range: ModelMetricsRange,
  successCalls: number,
  totalCalls: number,
  metrics: {
    firstTokenLatencyMs?: number | null;
    outputTokensPerSecond?: number | null;
  } = {},
) {
  const firstTokenLatencyMs = metrics.firstTokenLatencyMs ?? (totalCalls > 0 ? 80 : null);
  const outputTokensPerSecond = metrics.outputTokensPerSecond ?? (totalCalls > 0 ? 25 : null);
  const outputTokenDurationMs = outputTokensPerSecond != null && totalCalls > 0 ? 1000 : 0;
  return {
    status: totalCalls > 0 ? 'healthy' : 'unknown',
    successRate: totalCalls > 0 ? Math.round((successCalls / totalCalls) * 10_000) / 100 : null,
    totalCalls,
    successCalls,
    failedCalls: Math.max(0, totalCalls - successCalls),
    avgLatencyMs: totalCalls > 0 ? 120 : null,
    latencySamples: totalCalls,
    avgFirstTokenLatencyMs: firstTokenLatencyMs,
    firstTokenLatencySamples: firstTokenLatencyMs == null ? 0 : totalCalls,
    avgOutputTokensPerSecond: outputTokensPerSecond,
    outputTokens: outputTokensPerSecond == null ? 0 : outputTokensPerSecond,
    outputTokenDurationMs,
    outputTokenSamples: outputTokensPerSecond == null ? 0 : totalCalls,
    spend: null,
    source: totalCalls > 0 ? 'entry_projection' : 'none',
    window: {
      range,
      windowDays: 1,
      fromLocalDay: '2026-07-07',
      toLocalDay: '2026-07-07',
    },
  };
}

function createObservability(
  range: ModelMetricsRange,
  options: {
    entryHealth?: ReturnType<typeof createHealth>;
    attemptHealth?: ReturnType<typeof createHealth>;
  } = {},
): ModelRuntimeObservability {
  const entryHealth = options.entryHealth ?? createHealth(range, 7, 8);
  const attemptHealth = options.attemptHealth ?? createHealth(range, 7, 8);
  return {
    requestedModel: 'deepseek-v4-flash-rerouted',
    matched: true,
    entry: null,
    health: entryHealth,
    capabilitySummary: {
      supportedEndpointTypes: [],
      inputModalities: [],
      outputModalities: [],
      capabilities: [],
      contextLength: null,
      maxOutputTokens: null,
      source: 'none',
      partial: false,
    },
    executionAttempts: [],
    endpoints: [],
    history: {
      range,
      buckets: [
        {
          bucketStart: '2026-07-07 06:00:00',
          bucketEnd: '2026-07-07 06:01:00',
          entry: entryHealth,
          endpoints: [],
          executionAttempts: [
            {
              executionAttemptId: 'attempt-a',
              health: attemptHealth,
            },
          ],
        },
      ],
      granularity: range === '24h' || range === '7d' || range === '30d' ? 'day' : 'minute',
      emptyReason: null,
    },
    diagnostics: [],
  } as unknown as ModelRuntimeObservability;
}

function createDetails(overrides: Partial<ModelDetailsView> = {}): ModelDetailsView {
  const hasPerformanceOverride = Object.prototype.hasOwnProperty.call(overrides, 'performanceObservability');
  return buildModelDetailsView({
    model: overrides.model ?? createModel(),
    brandName: overrides.brandName ?? null,
    routeFlow: overrides.routeFlow ?? null,
    routeFlowDiagnostics: overrides.routeFlowDiagnostics ?? null,
    routeFlowLoading: overrides.routeFlowLoading ?? false,
    routeFlowError: overrides.routeFlowError ?? '',
    observability: overrides.observability ?? null,
    observabilityLoading: overrides.observabilityLoading ?? false,
    observabilityError: overrides.observabilityError ?? '',
    performanceObservability: hasPerformanceOverride
      ? overrides.performanceObservability ?? null
      : createObservability('6h'),
    performanceObservabilityLoading: overrides.performanceObservabilityLoading ?? false,
    performanceObservabilityError: overrides.performanceObservabilityError ?? '',
  });
}

describe('ModelPerformanceTab refresh rendering', () => {
  beforeEach(() => {
    chartSpecs.length = 0;
  });

  it('renders the upper-layer visible runtime history while a range switch is pending', () => {
    let root!: ReactTestRenderer;

    act(() => {
      root = create(
        <ModelPerformanceTab
          performance={createDetails({
            performanceObservability: createObservability('6h'),
            performanceObservabilityLoading: true,
          }).performance}
          range="6h"
          onRangeChange={() => {}}
        />,
      );
    });

    const text = collectText(root.root);
    expect(text).toContain('7/8');
    expect(text).not.toContain('8 调用');
    expect(text).not.toContain(`${tr('pages.models.modelPerformanceTab.executionAttempts')}:`);
    expect(text).not.toContain(tr('pages.models.modelPerformanceTab.attemptAverage'));
    expect(text).not.toContain(tr('common.loading'));
    expect(hasClass(root.root, 'opacity-75')).toBe(true);
    root.unmount();
  });

  it('renders attempt calls as a ratio and labels distinct attempt performance as an upstream average', () => {
    let root!: ReactTestRenderer;

    act(() => {
      root = create(
        <ModelPerformanceTab
          performance={createDetails({
            performanceObservability: createObservability('6h', {
              entryHealth: createHealth('6h', 7, 8, {
                firstTokenLatencyMs: 902,
                outputTokensPerSecond: 98.5,
              }),
              attemptHealth: createHealth('6h', 6, 17, {
                firstTokenLatencyMs: 1300,
                outputTokensPerSecond: 40,
              }),
            }),
          }).performance}
          range="6h"
          onRangeChange={() => {}}
        />,
      );
    });

    const text = collectText(root.root);
    expect(text).toContain('7/8');
    expect(text).toContain('6/17');
    expect(text).not.toContain('17 调用');
    expect(text).not.toContain(`${tr('pages.models.modelPerformanceTab.executionAttempts')}:`);
    expect(text).toContain(tr('pages.models.modelPerformanceTab.attemptAverage'));
    expect(text).toContain('1300ms');
    expect(text).toContain('40.0 tok/s');
    root.unmount();
  });

  it('keeps interactive metric charts on final-result data instead of splitting by execution attempt', () => {
    let root!: ReactTestRenderer;

    act(() => {
      root = create(
        <ModelPerformanceTab
          performance={createDetails({
            performanceObservability: createObservability('6h', {
              entryHealth: createHealth('6h', 7, 8, {
                firstTokenLatencyMs: 902,
                outputTokensPerSecond: 98.5,
              }),
              attemptHealth: createHealth('6h', 6, 17, {
                firstTokenLatencyMs: 1300,
                outputTokensPerSecond: 40,
              }),
            }),
          }).performance}
          range="6h"
          onRangeChange={() => {}}
        />,
      );
    });

    expect(chartSeriesNames()).toEqual([
      tr('pages.models.modelPerformanceTab.finalResult'),
      tr('pages.models.modelPerformanceTab.executionAttempts'),
    ]);
    expect((latestChartSpec().legends as { visible?: boolean }).visible).toBe(true);

    clickMetric(root.root, tr('pages.models.firstTokenLatency'));
    expect(chartSeriesNames()).toEqual([tr('pages.models.modelPerformanceTab.finalResult')]);
    expect((latestChartSpec().legends as { visible?: boolean }).visible).toBe(false);
    expect(latestChartRows().map((row) => row.value)).toEqual([902]);

    clickMetric(root.root, tr('pages.models.outputSpeed'));
    expect(chartSeriesNames()).toEqual([tr('pages.models.modelPerformanceTab.finalResult')]);
    expect((latestChartSpec().legends as { visible?: boolean }).visible).toBe(false);
    expect(latestChartRows().map((row) => row.value)).toEqual([98.5]);

    clickMetric(root.root, tr('components.modelAnalysisPanel.calls'));
    expect(chartSeriesNames()).toEqual([
      tr('pages.models.modelPerformanceTab.finalResult'),
      tr('pages.models.modelPerformanceTab.executionAttempts'),
    ]);
    expect((latestChartSpec().legends as { visible?: boolean }).visible).toBe(true);
    expect(latestChartRows().map((row) => row.value)).toEqual([8, 17]);

    root.unmount();
  });

  it('shows skeletons when the upper layer has no visible performance data yet', () => {
    let root!: ReactTestRenderer;
    act(() => {
      root = create(
        <ModelPerformanceTab
          performance={createDetails({
            performanceObservability: null,
            performanceObservabilityLoading: true,
          }).performance}
          range="5m"
          onRangeChange={() => {}}
        />,
      );
    });

    expect(collectText(root.root)).not.toContain('7/8');
    expect(hasClass(root.root, 'h-[276px]')).toBe(true);
    root.unmount();
  });

  it('renders an empty state when the upper layer completed without performance data', () => {
    let root!: ReactTestRenderer;
    act(() => {
      root = create(
        <ModelPerformanceTab
          performance={createDetails({
            performanceObservability: null,
            performanceObservabilityLoading: false,
          }).performance}
          range="6h"
          onRangeChange={() => {}}
        />,
      );
    });

    expect(collectText(root.root)).not.toContain('7/8');
    expect(collectText(root.root)).not.toContain('120ms');
    expect(collectText(root.root)).toContain(tr('pages.models.modelPerformanceTab.noRuntimeHistory'));
    expect(hasClass(root.root, 'h-[300px]')).toBe(false);
    expect(hasClass(root.root, 'min-h-24')).toBe(false);
    root.unmount();
  });
});
