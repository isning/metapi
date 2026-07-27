import { describe, expect, it } from 'vitest';
import type { ModelRuntimeObservability, RuntimeObservabilityBucket, RuntimeObservabilityHealth } from '../../api.js';
import {
  buildRuntimeHistoryChartBuckets,
  filterRuntimeHistoryAxisItems,
  formatHistoryAxisLabel,
  sampleRuntimeHistoryAxisItems,
} from './ModelPerformanceTab.js';

const window: RuntimeObservabilityHealth['window'] = {
  range: '1h',
  windowDays: 1,
  fromLocalDay: '2026-07-07',
  toLocalDay: '2026-07-07',
};

function health(totalCalls: number): RuntimeObservabilityHealth {
  return {
    status: totalCalls > 0 ? 'healthy' : 'unknown',
    successRate: totalCalls > 0 ? 100 : null,
    totalCalls,
    successCalls: totalCalls,
    failedCalls: 0,
    avgLatencyMs: totalCalls > 0 ? 120 : null,
    latencySamples: totalCalls,
    avgFirstTokenLatencyMs: totalCalls > 0 ? 80 : null,
    firstTokenLatencySamples: totalCalls,
    avgOutputTokensPerSecond: totalCalls > 0 ? 25 : null,
    outputTokens: totalCalls > 0 ? 50 : 0,
    outputTokenDurationMs: totalCalls > 0 ? 2000 : 0,
    outputTokenSamples: totalCalls,
    source: totalCalls > 0 ? 'entry_projection' : 'none',
    window,
  };
}

function bucket(bucketStart: string): RuntimeObservabilityBucket {
  return {
    bucketStart,
    bucketEnd: bucketStart,
    entry: health(1),
    endpoints: [],
    executionAttempts: [],
  };
}

describe('buildRuntimeHistoryChartBuckets', () => {
  it('preserves empty minute slots between observed runtime history points', () => {
    const history: ModelRuntimeObservability['history'] = {
      range: '1h',
      granularity: 'minute',
      emptyReason: null,
      buckets: [
        bucket('2026-07-07 06:00:00'),
        bucket('2026-07-07 06:02:00'),
      ],
    };

    const buckets = buildRuntimeHistoryChartBuckets(history);

    expect(buckets.map((item) => item.bucketStart)).toEqual([
      '2026-07-07 06:00:00',
      '2026-07-07 06:01:00',
      '2026-07-07 06:02:00',
    ]);
    expect(buckets[1]?.entry).toMatchObject({
      totalCalls: 0,
      successRate: null,
      source: 'none',
    });
    expect(buckets[1]?.endpoints).toEqual([]);
    expect(buckets[1]?.executionAttempts).toEqual([]);
  });
});

describe('formatHistoryAxisLabel', () => {
  it('shows compact time labels for minute runtime history buckets', () => {
    const expected = new Date('2026-07-07T06:02:00Z').toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    expect(formatHistoryAxisLabel('2026-07-07 06:02:00', 'minute')).toBe(expected);
  });

  it('shows day labels for daily runtime history buckets', () => {
    expect(formatHistoryAxisLabel('2026-07-07', 'day')).toBe('07/07');
  });
});

describe('sampleRuntimeHistoryAxisItems', () => {
  it('samples readable VChart axis items while preserving first and last item', () => {
    const items = Array.from({ length: 10 }, (_item, index) => ({ value: index }));

    const ticks = sampleRuntimeHistoryAxisItems(items, 4);

    expect(ticks).toHaveLength(4);
    expect(ticks.map((tick) => tick.value)).toEqual([0, 3, 6, 9]);
  });
});

describe('filterRuntimeHistoryAxisItems', () => {
  it('samples VChart axis label and tick arrays through the same path', () => {
    const items = Array.from({ length: 12 }, (_item, index) => ({ value: index }));

    expect(filterRuntimeHistoryAxisItems(items, 4).map((tick) => tick.value)).toEqual([0, 4, 7, 11]);
  });

  it('preserves non-array values from unexpected VChart callback shapes', () => {
    const value = { value: 'not-axis-items' };

    expect(filterRuntimeHistoryAxisItems(value, 4)).toBe(value);
  });
});
