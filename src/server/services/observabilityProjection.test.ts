import { describe, expect, it, vi } from 'vitest';

import {
  buildRealtimeWindow,
  hasAvailableExecutionAttempt,
  mapAggregateRow,
  normalizeRange,
} from './compiledRuntimeObservabilityProjection.js';

describe('compiled runtime observability projection', () => {
  it('maps aggregate counters into canonical health metrics', () => {
    const window = buildRealtimeWindow(5);
    expect(mapAggregateRow({
      totalCalls: 4,
      successCalls: 3,
      failedCalls: 1,
      totalTokens: 0,
      totalLatencyMs: 4000,
      latencyCount: 4,
      totalFirstTokenLatencyMs: 1200,
      firstTokenLatencyCount: 3,
      outputTokens: 180,
      outputTokenDurationMs: 3000,
      outputTokenSampleCount: 3,
    }, 'entry_projection', window)).toMatchObject({
      status: 'degraded',
      successRate: 75,
      avgLatencyMs: 1000,
      avgFirstTokenLatencyMs: 400,
      avgOutputTokensPerSecond: 60,
      source: 'entry_projection',
    });
  });

  it('normalizes ranges and clamps realtime windows', () => {
    expect(normalizeRange(undefined)).toBe('6h');
    expect(normalizeRange('30d')).toBe('30d');
    expect(buildRealtimeWindow(0).realtime?.minutes).toBe(1);
    expect(buildRealtimeWindow(100_000).realtime?.minutes).toBe(30 * 24 * 60);
  });

  it('marks a runtime available only when an enabled attempt is outside cooldown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T08:00:00.000Z'));
    const flow = {
      compiledRuntime: {
        executionAttempts: [
          { enabled: false, health: { cooldownUntil: null } },
          { enabled: true, health: { cooldownUntil: '2026-07-26T08:05:00.000Z' } },
        ],
      },
    } as any;
    expect(hasAvailableExecutionAttempt(flow)).toBe(false);
    flow.compiledRuntime.executionAttempts.push({
      enabled: true,
      health: { cooldownUntil: '2026-07-26T07:59:00.000Z' },
    });
    expect(hasAvailableExecutionAttempt(flow)).toBe(true);
    vi.useRealTimers();
  });
});
