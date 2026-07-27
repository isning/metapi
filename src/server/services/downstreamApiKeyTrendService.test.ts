import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type DbModule = typeof import('../db/index.js');
type TrendServiceModule = typeof import('./downstreamApiKeyTrendService.js');

const INSERT_BATCH_SIZE = 100;

function billingDetails(amount: number, currency = 'USD') {
  return JSON.stringify({
    quote: {
      amount,
      unit: 'currency',
      currency,
      source: 'provider_catalog',
      sourceId: 'catalog:trend-test',
      matchedScope: 'provider_catalog',
      estimateLevel: 'exact',
      planFingerprint: 'sha256:trend-test',
    },
  });
}

describe('downstreamApiKeyTrendService', () => {
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let closeDbConnections: DbModule['closeDbConnections'];
  let trendService: TrendServiceModule;
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-downstream-trend-'));
    process.env.DATA_DIR = dataDir;

    await import('../db/migrate.js');
    const dbModule = await import('../db/index.js');
    const trendServiceModule = await import('./downstreamApiKeyTrendService.js');

    db = dbModule.db;
    schema = dbModule.schema;
    closeDbConnections = dbModule.closeDbConnections;
    trendService = trendServiceModule;
  });

  beforeEach(async () => {
    await db.delete(schema.proxyLogs).run();
    await db.delete(schema.proxyRequests).run();
    await db.delete(schema.downstreamApiKeys).run();
  });

  afterAll(async () => {
    await closeDbConnections();
    delete process.env.DATA_DIR;
  });

  it('reads all-range buckets across cursor pages when many rows share the same createdAt', async () => {
    const inserted = await db.insert(schema.downstreamApiKeys).values({
      name: 'cursor-key',
      key: 'sk-cursor-key-001',
      enabled: true,
    }).returning().get();

    const sharedCreatedAt = '2026-04-05T00:15:00.000Z';
    const sharedRows = Array.from({ length: 5_001 }, (_, index) => ({
      id: `cursor-request-${index}`,
      downstreamPath: '/v1/chat/completions',
      downstreamApiKeyId: inserted.id,
      status: 'success',
      totalTokens: 1,
      estimatedCost: 0.001,
      billingDetails: billingDetails(0.001),
      completedAt: sharedCreatedAt,
    }));

    for (let index = 0; index < sharedRows.length; index += INSERT_BATCH_SIZE) {
      await db.insert(schema.proxyRequests).values(sharedRows.slice(index, index + INSERT_BATCH_SIZE)).run();
    }

    await db.insert(schema.proxyRequests).values({
      id: 'cursor-request-final',
      downstreamPath: '/v1/chat/completions',
      downstreamApiKeyId: inserted.id,
      status: 'failure',
      totalTokens: 2,
      estimatedCost: 0.002,
      billingDetails: billingDetails(0.002),
      completedAt: '2026-04-06T00:30:00.000Z',
    }).run();

    const trend = await trendService.readDownstreamApiKeyTrendBuckets({
      downstreamApiKeyId: inserted.id,
      range: 'all',
      timeZone: 'UTC',
    });

    expect(trend.bucketSeconds).toBe(86400);
    expect(trend.timeZone).toBe('UTC');
    expect(trend.buckets).toHaveLength(2);
    expect(trend.buckets[0]).toMatchObject({
      startUtc: '2026-04-05T00:00:00.000Z',
      totalRequests: 5_001,
      successRequests: 5_001,
      failedRequests: 0,
      totalTokens: 5_001,
    });
    expect(trend.buckets[0]?.cost).toEqual({
      amount: 5.001,
      unit: 'USD',
      knownObservationCount: 5_001,
      unknownObservationCount: 0,
      incompatibleObservationCount: 0,
    });
    expect(trend.buckets[1]).toMatchObject({
      startUtc: '2026-04-06T00:00:00.000Z',
      totalRequests: 1,
      successRequests: 0,
      failedRequests: 1,
      totalTokens: 2,
    });
    expect(trend.buckets[1]?.cost).toEqual({
      amount: 0.002,
      unit: 'USD',
      knownObservationCount: 1,
      unknownObservationCount: 0,
      incompatibleObservationCount: 0,
    });
  });

  it('normalizes trend time zones consistently for explicit and invalid values', () => {
    const fallback = trendService.resolveDownstreamTrendTimeZone();

    expect(trendService.resolveDownstreamTrendTimeZone('UTC')).toBe('UTC');
    expect(trendService.resolveDownstreamTrendTimeZone('Invalid/Zone')).toBe(fallback);
    expect(trendService.resolveDownstreamTrendTimeZone('  ')).toBe(fallback);
  });

  it('counts terminal requests once and preserves free, unknown, and incompatible quote semantics', async () => {
    const inserted = await db.insert(schema.downstreamApiKeys).values({
      name: 'request-grain-key',
      key: 'sk-request-grain-key-001',
      enabled: true,
    }).returning().get();
    const completedAt = '2026-04-05T12:15:00.000Z';

    await db.insert(schema.proxyRequests).values([
      {
        id: 'request-free',
        downstreamPath: '/v1/chat/completions',
        downstreamApiKeyId: inserted.id,
        status: 'success',
        billingDetails: billingDetails(0),
        completedAt,
      },
      {
        id: 'request-unknown',
        downstreamPath: '/v1/chat/completions',
        downstreamApiKeyId: inserted.id,
        status: 'success',
        billingDetails: null,
        completedAt,
      },
      {
        id: 'request-incompatible',
        downstreamPath: '/v1/chat/completions',
        downstreamApiKeyId: inserted.id,
        status: 'success',
        billingDetails: billingDetails(3, 'CNY'),
        completedAt,
      },
      {
        id: 'request-with-fallback',
        downstreamPath: '/v1/chat/completions',
        downstreamApiKeyId: inserted.id,
        status: 'success',
        billingDetails: billingDetails(0.2),
        completedAt,
      },
      {
        id: 'request-still-running',
        downstreamPath: '/v1/chat/completions',
        downstreamApiKeyId: inserted.id,
        status: 'started',
        billingDetails: billingDetails(99),
        completedAt: null,
      },
    ]).run();
    await db.insert(schema.proxyLogs).values([
      { requestId: 'request-with-fallback', status: 'retried', billingDetails: billingDetails(5), createdAt: completedAt },
      { requestId: 'request-with-fallback', status: 'success', billingDetails: billingDetails(7), createdAt: completedAt },
    ]).run();

    const trend = await trendService.readDownstreamApiKeyTrendBuckets({
      downstreamApiKeyId: inserted.id,
      range: 'all',
      timeZone: 'UTC',
    });

    expect(trend.buckets).toHaveLength(1);
    expect(trend.buckets[0]).toMatchObject({
      totalRequests: 4,
      successRequests: 4,
      failedRequests: 0,
      cost: {
        amount: 0.2,
        unit: 'USD',
        knownObservationCount: 2,
        unknownObservationCount: 1,
        incompatibleObservationCount: 1,
      },
    });
  });

  it('uses local hour buckets for windowed ranges in half-hour offset time zones', async () => {
    const inserted = await db.insert(schema.downstreamApiKeys).values({
      name: 'windowed-local-hour-key',
      key: 'sk-windowed-local-hour-key-001',
      enabled: true,
    }).returning().get();

    const baseHour = new Date(Date.now() - 2 * 60 * 60 * 1000);
    baseHour.setUTCMinutes(0, 0, 0);
    const firstCreatedAt = new Date(baseHour);
    firstCreatedAt.setUTCMinutes(10, 0, 0);
    const secondCreatedAt = new Date(baseHour);
    secondCreatedAt.setUTCMinutes(40, 0, 0);

    await db.insert(schema.proxyRequests).values([
      {
        id: 'window-request-first',
        downstreamPath: '/v1/chat/completions',
        downstreamApiKeyId: inserted.id,
        status: 'success',
        totalTokens: 10,
        estimatedCost: 0.01,
        billingDetails: billingDetails(0.01),
        completedAt: firstCreatedAt.toISOString(),
      },
      {
        id: 'window-request-second',
        downstreamPath: '/v1/chat/completions',
        downstreamApiKeyId: inserted.id,
        status: 'failure',
        totalTokens: 20,
        estimatedCost: 0.02,
        billingDetails: billingDetails(0.02),
        completedAt: secondCreatedAt.toISOString(),
      },
    ]).run();

    const trend = await trendService.readDownstreamApiKeyTrendBuckets({
      downstreamApiKeyId: inserted.id,
      range: '24h',
      timeZone: 'Asia/Kolkata',
    });

    expect(trend.bucketSeconds).toBe(3600);
    expect(trend.timeZone).toBe('Asia/Kolkata');
    expect(trend.buckets).toMatchObject([
      {
        startUtc: expectedFixedOffsetHourBucketStartUtc(firstCreatedAt.toISOString(), 330),
        totalRequests: 1,
        successRequests: 1,
        failedRequests: 0,
        totalTokens: 10,
        cost: { amount: 0.01, unit: 'USD', knownObservationCount: 1, unknownObservationCount: 0, incompatibleObservationCount: 0 },
      },
      {
        startUtc: expectedFixedOffsetHourBucketStartUtc(secondCreatedAt.toISOString(), 330),
        totalRequests: 1,
        successRequests: 0,
        failedRequests: 1,
        totalTokens: 20,
        cost: { amount: 0.02, unit: 'USD', knownObservationCount: 1, unknownObservationCount: 0, incompatibleObservationCount: 0 },
      },
    ]);
  });
});

function expectedFixedOffsetHourBucketStartUtc(raw: string, offsetMinutes: number): string {
  const parsed = new Date(raw);
  const localMs = parsed.getTime() + offsetMinutes * 60_000;
  const localBucketStart = new Date(localMs);
  localBucketStart.setUTCMinutes(0, 0, 0);
  return new Date(localBucketStart.getTime() - offsetMinutes * 60_000).toISOString();
}
