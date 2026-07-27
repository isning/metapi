import { describe, expect, it } from 'vitest';
import {
  buildProxyLogModelAnalysisSelectFields,
  buildProxyLogSiteTrendSelectFields,
  buildSiteAvailabilitySummaries,
  buildSiteAvailabilitySummariesFromHourlyAggregates,
  proxyCostSqlExpression,
  toRoundedMicroNumber,
  type SiteAvailabilitySiteRow,
} from './statsShared.js';

const sites: SiteAvailabilitySiteRow[] = [
  {
    id: 1,
    name: 'Primary',
    url: 'https://primary.example',
    platform: 'openai',
    sortOrder: 0,
    isPinned: true,
  },
  {
    id: 2,
    name: 'Idle',
    url: null,
    platform: null,
    sortOrder: null,
    isPinned: null,
  },
];

describe('toRoundedMicroNumber', () => {
  it('rounds nullish and numeric input to micro precision', () => {
    expect(toRoundedMicroNumber(null)).toBe(0);
    expect(toRoundedMicroNumber(undefined)).toBe(0);
    expect(toRoundedMicroNumber(1.2345678)).toBe(1.234568);
  });
});

describe('proxy log stats select helpers', () => {
  it('keeps model-analysis select fields aligned with stats consumers', () => {
    expect(Object.keys(buildProxyLogModelAnalysisSelectFields())).toEqual([
      'createdAt',
      'modelActual',
      'modelRequested',
      'status',
      'latencyMs',
      'totalTokens',
      'estimatedCost',
    ]);
  });

  it('keeps site-trend select fields minimal for hourly aggregation', () => {
    expect(Object.keys(buildProxyLogSiteTrendSelectFields())).toEqual([
      'createdAt',
      'estimatedCost',
      'totalTokens',
    ]);
  });

  it('builds a platform-aware proxy cost SQL expression', () => {
    const expression = proxyCostSqlExpression();
    expect(expression).toEqual(expect.objectContaining({
      queryChunks: expect.any(Array),
    }));
    expect(expression.queryChunks.length).toBeGreaterThan(0);
  });
});

describe('buildSiteAvailabilitySummaries', () => {
  it('builds fixed 24-hour per-site summaries from raw proxy logs', () => {
    const now = new Date('2026-01-02T10:35:00.000Z');
    const result = buildSiteAvailabilitySummaries(
      sites,
      [
        { siteId: 1, createdAt: '2026-01-02 10:00:00', status: 'success', latencyMs: 120 },
        { siteId: 1, createdAt: '2026-01-02 09:30:00', status: ' error ', latencyMs: 280 },
        { siteId: 1, createdAt: '2026-01-02 09:10:00', status: 'success', latencyMs: -1 },
        { siteId: 1, createdAt: '2026-01-01 10:59:59', status: 'success', latencyMs: 50 },
        { siteId: 999, createdAt: '2026-01-02 10:00:00', status: 'success', latencyMs: 1 },
        { siteId: null, createdAt: '2026-01-02 10:00:00', status: 'success', latencyMs: 1 },
        { siteId: 1, createdAt: 'invalid', status: 'success', latencyMs: 1 },
      ],
      now,
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      siteId: 1,
      siteName: 'Primary',
      siteUrl: 'https://primary.example',
      platform: 'openai',
      totalRequests: 3,
      successCount: 2,
      failedCount: 1,
      availabilityPercent: 66.7,
      averageLatencyMs: 200,
    });
    expect(result[0]!.buckets).toHaveLength(24);
    expect(result[0]!.buckets.at(-1)).toMatchObject({
      totalRequests: 1,
      successCount: 1,
      failedCount: 0,
      availabilityPercent: 100,
      averageLatencyMs: 120,
    });
    expect(result[0]!.buckets.at(-2)).toMatchObject({
      totalRequests: 2,
      successCount: 1,
      failedCount: 1,
      availabilityPercent: 50,
      averageLatencyMs: 280,
    });
    expect(result[1]).toMatchObject({
      siteId: 2,
      totalRequests: 0,
      availabilityPercent: null,
      averageLatencyMs: null,
    });
  });
});

describe('buildSiteAvailabilitySummariesFromHourlyAggregates', () => {
  it('builds summaries from pre-aggregated hourly rows and clamps negative values', () => {
    const now = new Date('2026-01-02T10:35:00.000Z');
    const result = buildSiteAvailabilitySummariesFromHourlyAggregates(
      sites,
      [
        {
          siteId: 1,
          hourStartUtc: '2026-01-02 10:00:00',
          totalRequests: 5,
          successCount: 4,
          failedCount: 1,
          totalLatencyMs: 900,
          latencyCount: 3,
        },
        {
          siteId: 1,
          hourStartUtc: '2026-01-02 09:00:00',
          totalRequests: -10,
          successCount: -5,
          failedCount: -5,
          totalLatencyMs: -100,
          latencyCount: -1,
        },
        {
          siteId: 2,
          hourStartUtc: '2026-01-02 08:00:00',
          totalRequests: 2,
          successCount: 0,
          failedCount: 2,
          totalLatencyMs: 0,
          latencyCount: 0,
        },
        {
          siteId: null,
          hourStartUtc: '2026-01-02 10:00:00',
          totalRequests: 100,
          successCount: 100,
          failedCount: 0,
          totalLatencyMs: 100,
          latencyCount: 1,
        },
        {
          siteId: 1,
          hourStartUtc: 'invalid',
          totalRequests: 100,
          successCount: 100,
          failedCount: 0,
          totalLatencyMs: 100,
          latencyCount: 1,
        },
      ],
      now,
    );

    expect(result[0]).toMatchObject({
      totalRequests: 5,
      successCount: 4,
      failedCount: 1,
      availabilityPercent: 80,
      averageLatencyMs: 300,
    });
    expect(result[0]!.buckets.at(-1)).toMatchObject({
      totalRequests: 5,
      successCount: 4,
      failedCount: 1,
      availabilityPercent: 80,
      averageLatencyMs: 300,
    });
    expect(result[0]!.buckets.at(-2)).toMatchObject({
      totalRequests: 0,
      successCount: 0,
      failedCount: 0,
      availabilityPercent: null,
      averageLatencyMs: null,
    });
    expect(result[1]).toMatchObject({
      totalRequests: 2,
      successCount: 0,
      failedCount: 2,
      availabilityPercent: 0,
      averageLatencyMs: null,
    });
  });
});
