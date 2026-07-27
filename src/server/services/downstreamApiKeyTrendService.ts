import { and, asc, eq, inArray, isNotNull, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  formatUtcSqlDateTime,
  getResolvedTimeZone,
  parseStoredUtcDateTime,
  type StoredUtcDateTimeInput,
} from './localTimeService.js';
import { valueBillingDetailsRowsInBaseUnit } from './billingCostValuationService.js';
import type { BaseCostSummary } from '../../shared/billingCost.js';

export type DownstreamKeyTrendRange = '24h' | '7d' | 'all';

export type DownstreamKeyTrendBucket = {
  startUtc: string | null;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  successRate: number | null;
  totalTokens: number;
  cost: BaseCostSummary;
};

type DownstreamTrendRequestRow = {
  id: string;
  createdAt: StoredUtcDateTimeInput;
  status: string | null;
  totalTokens: number | null;
  billingDetails: string | null;
  siteId: number | null;
  accountId: number | null;
};

type DownstreamTrendBucketAccumulator = {
  startUtc: string;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  totalTokens: number;
  billingRows: Array<{
    billingDetails: string | null;
    siteId: number | null;
    accountId: number | null;
  }>;
};

type TimeZoneDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type DownstreamTrendCursor = {
  createdAt: StoredUtcDateTimeInput;
  id: string;
};

const ALL_RANGE_CHUNK_SIZE = 5_000;

export function resolveDownstreamTrendRangeSinceUtc(range: DownstreamKeyTrendRange): string | null {
  const nowTs = Date.now();
  if (range === '24h') return formatUtcSqlDateTime(new Date(nowTs - 24 * 60 * 60 * 1000));
  if (range === '7d') return formatUtcSqlDateTime(new Date(nowTs - 7 * 24 * 60 * 60 * 1000));
  return null;
}

export function resolveDownstreamTrendBucketSeconds(range: DownstreamKeyTrendRange): number {
  return range === 'all' ? 86400 : 3600;
}

export function buildBucketTsExpressionForDialect(
  dialect: 'sqlite' | 'mysql' | 'postgres',
  createdAtColumn: SQLWrapper,
  bucketSeconds: number,
) {
  if (dialect === 'mysql') {
    return sql<number>`floor(unix_timestamp(${createdAtColumn}) / ${bucketSeconds}) * ${bucketSeconds}`;
  }
  if (dialect === 'postgres') {
    const createdAtTimestamp = sql`cast(${createdAtColumn} as timestamp)`;
    if (bucketSeconds === 86400) {
      return sql<number>`extract(epoch from date_trunc('day', ${createdAtTimestamp}))::bigint`;
    }
    return sql<number>`extract(epoch from date_trunc('hour', ${createdAtTimestamp}))::bigint`;
  }
  return sql<number>`cast(cast(strftime('%s', ${createdAtColumn}) as integer) / ${bucketSeconds} as integer) * ${bucketSeconds}`;
}

export function resolveDownstreamTrendTimeZone(raw?: string | null): string {
  const text = String(raw || '').trim();
  if (text) {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: text }).format(new Date());
      return text;
    } catch {
      // fall through to server default
    }
  }
  return getResolvedTimeZone();
}

function formatDateTimePartsInTimeZone(value: Date, timeZone: string): TimeZoneDateTimeParts | null {
  if (Number.isNaN(value.getTime())) return null;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(value);
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(lookup.get('year'));
  const month = Number(lookup.get('month'));
  const day = Number(lookup.get('day'));
  const hour = Number(lookup.get('hour'));
  const minute = Number(lookup.get('minute'));
  const second = Number(lookup.get('second'));
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
  return { year, month, day, hour, minute, second };
}

function toUtcComparableValue(parts: TimeZoneDateTimeParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
}

function sameDateTimeParts(left: TimeZoneDateTimeParts, right: TimeZoneDateTimeParts): boolean {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && left.second === right.second;
}

function resolveTargetBucketParts(parts: TimeZoneDateTimeParts, bucketSeconds: number): TimeZoneDateTimeParts {
  if (bucketSeconds >= 86400) {
    return { ...parts, hour: 0, minute: 0, second: 0 };
  }
  return { ...parts, minute: 0, second: 0 };
}

function convertZonedPartsToUtcDate(parts: TimeZoneDateTimeParts, timeZone: string): Date | null {
  let candidateMs = toUtcComparableValue(parts);
  // Iterate toward the UTC instant that renders back to the requested local wall time.
  // Rare DST gaps/ambiguities may never converge; callers skip null buckets safely.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = new Date(candidateMs);
    const rendered = formatDateTimePartsInTimeZone(candidate, timeZone);
    if (!rendered) return null;
    if (sameDateTimeParts(rendered, parts)) return candidate;
    candidateMs += toUtcComparableValue(parts) - toUtcComparableValue(rendered);
  }
  const finalCandidate = new Date(candidateMs);
  const finalRendered = formatDateTimePartsInTimeZone(finalCandidate, timeZone);
  return finalRendered && sameDateTimeParts(finalRendered, parts) ? finalCandidate : null;
}

function resolveLocalBucketStartUtc(
  raw: StoredUtcDateTimeInput,
  bucketSeconds: number,
  timeZone: string,
): string | null {
  const parsed = parseStoredUtcDateTime(raw);
  if (!parsed) return null;
  const localParts = formatDateTimePartsInTimeZone(parsed, timeZone);
  if (!localParts) return null;
  const targetParts = resolveTargetBucketParts(localParts, bucketSeconds);
  const bucketStart = convertZonedPartsToUtcDate(targetParts, timeZone);
  return bucketStart ? bucketStart.toISOString() : null;
}

function accumulateTrendRows(
  accumulator: Map<string, DownstreamTrendBucketAccumulator>,
  rows: DownstreamTrendRequestRow[],
  bucketSeconds: number,
  timeZone: string,
) {
  for (const row of rows) {
    const startUtc = resolveLocalBucketStartUtc(row.createdAt, bucketSeconds, timeZone);
    if (!startUtc) continue;
    const bucket = accumulator.get(startUtc) || {
      startUtc,
      totalRequests: 0,
      successRequests: 0,
      failedRequests: 0,
      totalTokens: 0,
      billingRows: [],
    };
    const isSuccess = row.status === 'success';
    bucket.totalRequests += 1;
    bucket.successRequests += isSuccess ? 1 : 0;
    bucket.failedRequests += isSuccess ? 0 : 1;
    bucket.totalTokens += Number(row.totalTokens || 0);
    bucket.billingRows.push({
      billingDetails: row.billingDetails,
      siteId: row.siteId,
      accountId: row.accountId,
    });
    accumulator.set(startUtc, bucket);
  }
}

async function finalizeTrendBuckets(accumulator: Map<string, DownstreamTrendBucketAccumulator>): Promise<DownstreamKeyTrendBucket[]> {
  return await Promise.all(Array.from(accumulator.values())
    .sort((left, right) => left.startUtc.localeCompare(right.startUtc))
    .map(async (bucket) => ({
      startUtc: bucket.startUtc,
      totalRequests: bucket.totalRequests,
      successRequests: bucket.successRequests,
      failedRequests: bucket.failedRequests,
      successRate: bucket.totalRequests > 0 ? Math.round((bucket.successRequests / bucket.totalRequests) * 1000) / 10 : null,
      totalTokens: bucket.totalTokens,
      cost: await valueBillingDetailsRowsInBaseUnit(bucket.billingRows),
    })));
}

function buildTrendCursorClause(cursor: DownstreamTrendCursor): SQL {
  return sql`(
    ${schema.proxyRequests.completedAt} > ${cursor.createdAt}
    or (${schema.proxyRequests.completedAt} = ${cursor.createdAt} and ${schema.proxyRequests.id} > ${cursor.id})
  )`;
}

async function readAllRangeTrendBuckets(
  downstreamApiKeyId: number,
  bucketSeconds: number,
  timeZone: string,
  sinceUtc: string | null,
): Promise<DownstreamKeyTrendBucket[]> {
  const accumulator = new Map<string, DownstreamTrendBucketAccumulator>();
  let cursor: DownstreamTrendCursor | null = null;

  for (;;) {
    const whereClauses: SQL[] = [
      eq(schema.proxyRequests.downstreamApiKeyId, downstreamApiKeyId),
      isNotNull(schema.proxyRequests.completedAt),
      inArray(schema.proxyRequests.status, ['success', 'failure']),
    ];
    if (sinceUtc) {
      whereClauses.push(sql`${schema.proxyRequests.completedAt} >= ${sinceUtc}`);
    }
    if (cursor) {
      whereClauses.push(buildTrendCursorClause(cursor));
    }

    const rows = await db.select({
      id: schema.proxyRequests.id,
      createdAt: schema.proxyRequests.completedAt,
      status: schema.proxyRequests.status,
      totalTokens: schema.proxyRequests.totalTokens,
      billingDetails: schema.proxyRequests.billingDetails,
      siteId: schema.proxyRequests.finalSiteId,
      accountId: schema.proxyRequests.finalAccountId,
    })
      .from(schema.proxyRequests)
      .where(and(...whereClauses))
      .orderBy(asc(schema.proxyRequests.completedAt), asc(schema.proxyRequests.id))
      .limit(ALL_RANGE_CHUNK_SIZE)
      .all();

    if (rows.length <= 0) break;
    accumulateTrendRows(accumulator, rows, bucketSeconds, timeZone);
    const lastRow = rows.at(-1);
    if (rows.length < ALL_RANGE_CHUNK_SIZE || !lastRow) break;
    cursor = {
      createdAt: lastRow.createdAt,
      id: lastRow.id,
    };
  }

  return await finalizeTrendBuckets(accumulator);
}

export async function readDownstreamApiKeyTrendBuckets(input: {
  downstreamApiKeyId: number;
  range: DownstreamKeyTrendRange;
  timeZone?: string | null;
}): Promise<{
  bucketSeconds: number;
  timeZone: string;
  buckets: DownstreamKeyTrendBucket[];
}> {
  const bucketSeconds = resolveDownstreamTrendBucketSeconds(input.range);
  const sinceUtc = resolveDownstreamTrendRangeSinceUtc(input.range);
  const timeZone = resolveDownstreamTrendTimeZone(input.timeZone);
  const buckets = await readAllRangeTrendBuckets(
    input.downstreamApiKeyId,
    bucketSeconds,
    timeZone,
    sinceUtc,
  );

  return {
    bucketSeconds,
    timeZone,
    buckets,
  };
}
