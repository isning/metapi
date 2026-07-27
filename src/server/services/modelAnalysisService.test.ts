import { describe, expect, it } from 'vitest';
import { buildModelAnalysisFromDailyUsage } from './modelAnalysisService.js';
import { formatLocalDate } from './localTimeService.js';

describe('buildModelAnalysisFromDailyUsage', () => {
  it('carries cost unit and valuation metadata for pre-valued daily usage rows', () => {
    const result = buildModelAnalysisFromDailyUsage(
      [
        {
          localDay: formatLocalDate(new Date('2026-02-24T00:00:00.000Z')),
          model: 'gpt-5',
          totalCalls: 3,
          successCalls: 2,
          totalTokens: 1000,
          totalSpend: 0.42,
          totalLatencyMs: 900,
        },
      ],
      {
        now: new Date('2026-02-24T12:00:00.000Z'),
        days: 1,
        costUnit: 'cny',
        valuation: {
          source: 'wallet_valuation',
          valuedRows: 1,
          totalRows: 1,
          warningCount: 0,
        },
      },
    );

    expect(result.costUnit).toBe('CNY');
    expect(result.valuation).toEqual({
      source: 'wallet_valuation',
      valuedRows: 1,
      totalRows: 1,
      warningCount: 0,
    });
    expect(result.totals.spend).toBe(0.42);
  });
});
