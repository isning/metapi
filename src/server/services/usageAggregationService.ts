import { and, asc, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { db, runtimeDbDialect, schema } from '../db/index.js';
import {
  getLocalRangeStartDayKey,
  getResolvedTimeZone,
  toLocalDayKeyFromStoredUtc,
  toLocalDayStartUtcFromStoredUtc,
  toLocalHourStartUtcFromStoredUtc,
  type StoredUtcDateTimeInput,
} from './localTimeService.js';
import { clearSnapshotCache } from './snapshotCacheService.js';
import { parseProxyBillingQuote } from './billingCostFact.js';
import type {
  BillingCostBucketKind,
  BillingCostSubjectKind,
  BillingObservationGrain,
} from '../../shared/billingCost.js';

const USAGE_PROJECTOR_KEY = 'usage-aggregates-v1';
const PROJECTION_BATCH_SIZE = 1_000;
const PROJECTION_MAX_BATCHES_PER_PASS = 120;
const PROJECTION_INTERVAL_MS = 5_000;
const PROJECTION_LEASE_MS = 10 * 60_000;

type ProjectionCheckpointRow = typeof schema.analyticsProjectionCheckpoints.$inferSelect;
type ProjectionLease = {
  owner: string;
  token: string;
  expiresAt: string;
};

type ProjectionPassOptions = {
  maxBatches?: number;
};

type ProxyLogProjectionRow = {
  id: number;
  createdAt: StoredUtcDateTimeInput;
  routeEntrypointId: string | null;
  runtimeEndpointId: string | null;
  executionTargetId: number | null;
  executionAttemptId: string | null;
  downstreamApiKeyId: number | null;
  status: string | null;
  latencyMs: number | null;
  totalTokens: number | null;
  billingDetails: string | null;
  modelActual: string | null;
  modelRequested: string | null;
  accountId: number | null;
  siteId: number | null;
  sitePlatform: string | null;
};

type ProxyRequestProjectionRow = {
  id: string;
  completedAt: StoredUtcDateTimeInput;
  routeEntrypointId: string | null;
  runtimeEndpointId: string | null;
  finalExecutionAttemptId: string | null;
  finalSiteId: number | null;
  finalAccountId: number | null;
  downstreamApiKeyId: number | null;
  requestedModel: string | null;
  actualModel: string | null;
  status: string;
  latencyMs: number | null;
  totalTokens: number | null;
  billingDetails: string | null;
};

type SiteDayUsageDeltaRow = {
  localDay: string;
  siteId: number;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  totalTokens: number;
  totalLatencyMs: number;
  latencyCount: number;
};

type SiteHourUsageDeltaRow = {
  bucketStartUtc: string;
  siteId: number;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  totalTokens: number;
  totalLatencyMs: number;
  latencyCount: number;
};

type ModelDayUsageDeltaRow = {
  localDay: string;
  siteId: number;
  accountId: number;
  model: string;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  totalTokens: number;
  totalLatencyMs: number;
  latencyCount: number;
};

type RouteRuntimeDayUsageDeltaRow = {
  localDay: string;
  runtimeIdentityKey: string;
  routeEntrypointId: string | null;
  runtimeEndpointId: string | null;
  executionTargetId: number | null;
  executionAttemptId: string | null;
  siteId: number | null;
  accountId: number | null;
  model: string;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  totalTokens: number;
  totalLatencyMs: number;
  latencyCount: number;
};

type BillingCostAggregateDeltaRow = {
  observationGrain: BillingObservationGrain;
  bucketKind: BillingCostBucketKind;
  bucketStart: string;
  subjectKind: BillingCostSubjectKind;
  subjectKey: string;
  dimensionKey: string;
  siteId: number | null;
  accountId: number | null;
  model: string | null;
  routeEntrypointId: string | null;
  runtimeEndpointId: string | null;
  executionAttemptId: string | null;
  downstreamApiKeyId: number | null;
  quoteUnit: 'currency' | 'quota' | 'unknown';
  currencyKey: string;
  quoteSource: string;
  quoteSourceIdKey: string;
  estimateLevelKey: string;
  planFingerprintKey: string;
  totalAmount: number | null;
  knownObservationCount: number;
  unknownObservationCount: number;
};

type ProjectionBatchDelta = {
  siteDayRows: SiteDayUsageDeltaRow[];
  siteHourRows: SiteHourUsageDeltaRow[];
  modelDayRows: ModelDayUsageDeltaRow[];
  routeRuntimeDayRows: RouteRuntimeDayUsageDeltaRow[];
  billingCostRows: BillingCostAggregateDeltaRow[];
};

export type ProjectionPassResult = {
  processedLogs: number;
  processedRequests: number;
  watermarkId: number;
  recomputed: boolean;
};

export type SiteHourUsageAggregateRow = {
  siteId: number;
  hourStartUtc: string;
  totalRequests: number;
  successCount: number;
  failedCount: number;
  totalTokens: number;
  totalLatencyMs: number;
  latencyCount: number;
};

export type ModelDayUsageAggregateRow = {
  siteId: number;
  day: string;
  model: string;
  totalCalls: number;
  successCount: number;
  failedCount: number;
  totalTokens: number;
  totalLatencyMs: number;
  latencyCount: number;
};

let projectionTimer: ReturnType<typeof setInterval> | null = null;
let projectionInFlight: Promise<ProjectionPassResult> | null = null;

function emptyCheckpoint(): ProjectionCheckpointRow {
  return {
    projectorKey: USAGE_PROJECTOR_KEY,
    timeZone: getResolvedTimeZone(),
    lastProxyLogId: 0,
    lastProxyRequestCompletedAt: null,
    lastProxyRequestId: null,
    watermarkCreatedAt: null,
    recomputeFromId: null,
    recomputeRequestedAt: null,
    recomputeReason: null,
    recomputeStartedAt: null,
    recomputeCompletedAt: null,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    lastProjectedAt: null,
    lastSuccessfulAt: null,
    lastError: null,
    createdAt: null,
    updatedAt: null,
  };
}

function normalizeNonNegativeInt(value: unknown): number {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric);
}

function normalizePositiveInt(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

function normalizeIdentityText(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function resolveModelName(row: ProxyLogProjectionRow): string {
  return String(row.modelActual || row.modelRequested || 'unknown').trim() || 'unknown';
}

function resolveRuntimeModelName(row: ProxyLogProjectionRow): string | null {
  const model = String(row.modelActual || '').trim();
  return model || null;
}

function hasCompiledRuntimeIdentity(row: {
  routeEntrypointId: string | null;
  runtimeEndpointId: string | null;
  executionTargetId: number | null;
  executionAttemptId: string | null;
}) {
  return row.routeEntrypointId !== null
    && row.runtimeEndpointId !== null
    && row.executionAttemptId !== null;
}

function buildRuntimeIdentityKey(row: {
  routeEntrypointId: string | null;
  runtimeEndpointId: string | null;
  executionTargetId: number | null;
  executionAttemptId: string | null;
  siteId: number | null;
  accountId: number | null;
  model: string;
}) {
  return JSON.stringify([
    row.routeEntrypointId,
    row.runtimeEndpointId,
    row.executionTargetId,
    row.executionAttemptId,
    row.siteId,
    row.accountId,
    row.model,
  ]);
}

function clearAnalyticsSnapshots() {
  clearSnapshotCache('site-stats');
  clearSnapshotCache('dashboard-summary');
  clearSnapshotCache('dashboard-insights');
}

function buildProjectionLeaseOwner() {
  const host = String(hostname() || process.env.HOSTNAME || 'local').trim() || 'local';
  return `${host}:${process.pid}`;
}

function buildProjectionLeaseExpiry(nowMs = Date.now()) {
  return new Date(nowMs + PROJECTION_LEASE_MS).toISOString();
}

function normalizeProjectionError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error || 'unknown projection error');
}

async function readProjectionCheckpoint(): Promise<ProjectionCheckpointRow> {
  const row = await db
    .select()
    .from(schema.analyticsProjectionCheckpoints)
    .where(eq(schema.analyticsProjectionCheckpoints.projectorKey, USAGE_PROJECTOR_KEY))
    .get();
  return row || emptyCheckpoint();
}

async function ensureProjectionCheckpointExists() {
  const nowIso = new Date().toISOString();
  const values = {
    projectorKey: USAGE_PROJECTOR_KEY,
    timeZone: getResolvedTimeZone(),
    lastProxyLogId: 0,
    lastProxyRequestCompletedAt: null,
    lastProxyRequestId: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  if (runtimeDbDialect === 'mysql') {
    await (db.insert(schema.analyticsProjectionCheckpoints).values(values) as any)
      .onDuplicateKeyUpdate({
        set: {
          projectorKey: sql`${schema.analyticsProjectionCheckpoints.projectorKey}`,
        },
      })
      .run();
    return;
  }

  await (db.insert(schema.analyticsProjectionCheckpoints).values(values) as any)
    .onConflictDoNothing({
      target: schema.analyticsProjectionCheckpoints.projectorKey,
    })
    .run();
}

async function tryAcquireProjectionLease(): Promise<ProjectionLease | null> {
  await ensureProjectionCheckpointExists();
  const nowIso = new Date().toISOString();
  const lease: ProjectionLease = {
    owner: buildProjectionLeaseOwner(),
    token: randomUUID(),
    expiresAt: buildProjectionLeaseExpiry(),
  };

  const result = await db
    .update(schema.analyticsProjectionCheckpoints)
    .set({
      leaseOwner: lease.owner,
      leaseToken: lease.token,
      leaseExpiresAt: lease.expiresAt,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(schema.analyticsProjectionCheckpoints.projectorKey, USAGE_PROJECTOR_KEY),
        or(
          isNull(schema.analyticsProjectionCheckpoints.leaseExpiresAt),
          lte(schema.analyticsProjectionCheckpoints.leaseExpiresAt, nowIso),
        ),
      ),
    )
    .run();

  return result.changes > 0 ? lease : null;
}

async function releaseProjectionLease(
  lease: ProjectionLease,
  options?: { error?: unknown },
) {
  const nowIso = new Date().toISOString();
  await db
    .update(schema.analyticsProjectionCheckpoints)
    .set({
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: options?.error ? normalizeProjectionError(options.error) : null,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(schema.analyticsProjectionCheckpoints.projectorKey, USAGE_PROJECTOR_KEY),
        eq(schema.analyticsProjectionCheckpoints.leaseToken, lease.token),
      ),
    )
    .run();
}

async function writeProjectionCheckpoint(
  tx: typeof db,
  checkpoint: Partial<ProjectionCheckpointRow> & { lastProxyLogId: number },
) {
  const nowIso = new Date().toISOString();
  const values = {
    projectorKey: USAGE_PROJECTOR_KEY,
    timeZone: checkpoint.timeZone ?? getResolvedTimeZone(),
    lastProxyLogId: Math.max(0, Math.trunc(checkpoint.lastProxyLogId || 0)),
    lastProxyRequestCompletedAt: checkpoint.lastProxyRequestCompletedAt ?? null,
    lastProxyRequestId: checkpoint.lastProxyRequestId ?? null,
    watermarkCreatedAt: checkpoint.watermarkCreatedAt ?? null,
    recomputeFromId: checkpoint.recomputeFromId ?? null,
    recomputeRequestedAt: checkpoint.recomputeRequestedAt ?? null,
    recomputeReason: checkpoint.recomputeReason ?? null,
    recomputeStartedAt: checkpoint.recomputeStartedAt ?? null,
    recomputeCompletedAt: checkpoint.recomputeCompletedAt ?? null,
    leaseOwner: checkpoint.leaseOwner ?? null,
    leaseToken: checkpoint.leaseToken ?? null,
    leaseExpiresAt: checkpoint.leaseExpiresAt ?? null,
    lastProjectedAt: checkpoint.lastProjectedAt ?? nowIso,
    lastSuccessfulAt: checkpoint.lastSuccessfulAt ?? nowIso,
    lastError: checkpoint.lastError ?? null,
    createdAt: checkpoint.createdAt ?? nowIso,
    updatedAt: nowIso,
  };

  if (runtimeDbDialect === 'mysql') {
    await (tx.insert(schema.analyticsProjectionCheckpoints).values(values) as any)
      .onDuplicateKeyUpdate({
        set: {
          timeZone: values.timeZone,
          lastProxyLogId: values.lastProxyLogId,
          lastProxyRequestCompletedAt: values.lastProxyRequestCompletedAt,
          lastProxyRequestId: values.lastProxyRequestId,
          watermarkCreatedAt: values.watermarkCreatedAt,
          recomputeFromId: values.recomputeFromId,
          recomputeRequestedAt: values.recomputeRequestedAt,
          recomputeReason: values.recomputeReason,
          recomputeStartedAt: values.recomputeStartedAt,
          recomputeCompletedAt: values.recomputeCompletedAt,
          leaseOwner: values.leaseOwner,
          leaseToken: values.leaseToken,
          leaseExpiresAt: values.leaseExpiresAt,
          lastProjectedAt: values.lastProjectedAt,
          lastSuccessfulAt: values.lastSuccessfulAt,
          lastError: values.lastError,
          updatedAt: values.updatedAt,
        },
      })
      .run();
    return;
  }

  await (tx.insert(schema.analyticsProjectionCheckpoints).values(values) as any)
    .onConflictDoUpdate({
      target: schema.analyticsProjectionCheckpoints.projectorKey,
      set: {
        timeZone: values.timeZone,
        lastProxyLogId: values.lastProxyLogId,
        lastProxyRequestCompletedAt: values.lastProxyRequestCompletedAt,
        lastProxyRequestId: values.lastProxyRequestId,
        watermarkCreatedAt: values.watermarkCreatedAt,
        recomputeFromId: values.recomputeFromId,
        recomputeRequestedAt: values.recomputeRequestedAt,
        recomputeReason: values.recomputeReason,
        recomputeStartedAt: values.recomputeStartedAt,
        recomputeCompletedAt: values.recomputeCompletedAt,
        leaseOwner: values.leaseOwner,
        leaseToken: values.leaseToken,
        leaseExpiresAt: values.leaseExpiresAt,
        lastProjectedAt: values.lastProjectedAt,
        lastSuccessfulAt: values.lastSuccessfulAt,
        lastError: values.lastError,
        updatedAt: values.updatedAt,
      },
    })
    .run();
}

async function fetchProjectionBatch(afterId: number, limit: number) {
  const rows = await db
    .select({
      id: schema.proxyLogs.id,
      createdAt: schema.proxyLogs.createdAt,
      routeEntrypointId: schema.proxyLogs.routeEntrypointId,
      runtimeEndpointId: schema.proxyLogs.runtimeEndpointId,
      executionTargetId: schema.proxyLogs.executionTargetId,
      executionAttemptId: schema.proxyLogs.executionAttemptId,
      downstreamApiKeyId: schema.proxyLogs.downstreamApiKeyId,
      status: schema.proxyLogs.status,
      latencyMs: schema.proxyLogs.latencyMs,
      totalTokens: schema.proxyLogs.totalTokens,
      billingDetails: schema.proxyLogs.billingDetails,
      modelActual: schema.proxyLogs.modelActual,
      modelRequested: schema.proxyLogs.modelRequested,
      accountId: schema.accounts.id,
      siteId: schema.sites.id,
      sitePlatform: schema.sites.platform,
    })
    .from(schema.proxyLogs)
    .leftJoin(schema.accounts, eq(schema.proxyLogs.accountId, schema.accounts.id))
    .leftJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .where(gt(schema.proxyLogs.id, afterId))
    .orderBy(asc(schema.proxyLogs.id))
    .limit(limit)
    .all();

  return rows as ProxyLogProjectionRow[];
}

async function fetchRequestProjectionBatch(
  checkpoint: Pick<ProjectionCheckpointRow, 'lastProxyRequestCompletedAt' | 'lastProxyRequestId'>,
  limit: number,
) {
  const completedAt = checkpoint.lastProxyRequestCompletedAt;
  const requestId = checkpoint.lastProxyRequestId;
  const cursor = completedAt
    ? or(
      gt(schema.proxyRequests.completedAt, completedAt),
      and(
        eq(schema.proxyRequests.completedAt, completedAt),
        gt(schema.proxyRequests.id, requestId || ''),
      ),
    )
    : undefined;
  const rows = await db.select({
    id: schema.proxyRequests.id,
    completedAt: schema.proxyRequests.completedAt,
    routeEntrypointId: schema.proxyRequests.routeEntrypointId,
    runtimeEndpointId: schema.proxyRequests.runtimeEndpointId,
    finalExecutionAttemptId: schema.proxyRequests.finalExecutionAttemptId,
    finalSiteId: schema.proxyRequests.finalSiteId,
    finalAccountId: schema.proxyRequests.finalAccountId,
    downstreamApiKeyId: schema.proxyRequests.downstreamApiKeyId,
    requestedModel: schema.proxyRequests.requestedModel,
    actualModel: schema.proxyRequests.actualModel,
    status: schema.proxyRequests.status,
    latencyMs: schema.proxyRequests.latencyMs,
    totalTokens: schema.proxyRequests.totalTokens,
    billingDetails: schema.proxyRequests.billingDetails,
  }).from(schema.proxyRequests).where(and(
    inArray(schema.proxyRequests.status, ['success', 'failure']),
    ...(cursor ? [cursor] : []),
  )).orderBy(
    asc(schema.proxyRequests.completedAt),
    asc(schema.proxyRequests.id),
  ).limit(limit).all();
  return rows as ProxyRequestProjectionRow[];
}

function appendBillingCostDelta(
  target: Map<string, BillingCostAggregateDeltaRow>,
  input: {
    observationGrain: BillingObservationGrain;
    bucketKind: BillingCostBucketKind;
    bucketStart: string;
    subjectKind: BillingCostSubjectKind;
    subjectKey: string;
    billingDetails: string | null;
    siteId: number | null;
    accountId: number | null;
    model: string | null;
    routeEntrypointId: string | null;
    runtimeEndpointId: string | null;
    executionAttemptId: string | null;
    downstreamApiKeyId: number | null;
  },
): void {
  const quote = parseProxyBillingQuote(input.billingDetails);
  const dimensions = quote
    ? {
      quoteUnit: quote.unit,
      currencyKey: quote.currency ?? '',
      quoteSource: quote.source,
      quoteSourceIdKey: quote.sourceId == null ? '' : String(quote.sourceId),
      estimateLevelKey: quote.estimateLevel ?? '',
      planFingerprintKey: quote.planFingerprint ?? '',
    }
    : {
      quoteUnit: 'unknown' as const,
      currencyKey: '',
      quoteSource: 'unavailable',
      quoteSourceIdKey: '',
      estimateLevelKey: '',
      planFingerprintKey: '',
    };
  const key = JSON.stringify([
    input.observationGrain,
    input.bucketKind,
    input.bucketStart,
    input.subjectKind,
    input.subjectKey,
    input.siteId,
    input.accountId,
    input.model,
    input.routeEntrypointId,
    input.runtimeEndpointId,
    input.executionAttemptId,
    input.downstreamApiKeyId,
    dimensions.quoteUnit,
    dimensions.currencyKey,
    dimensions.quoteSource,
    dimensions.quoteSourceIdKey,
    dimensions.estimateLevelKey,
    dimensions.planFingerprintKey,
  ]);
  const current = target.get(key) || {
    observationGrain: input.observationGrain,
    bucketKind: input.bucketKind,
    bucketStart: input.bucketStart,
    subjectKind: input.subjectKind,
    subjectKey: input.subjectKey,
    dimensionKey: JSON.stringify([
      input.siteId,
      input.accountId,
      input.model,
      input.routeEntrypointId,
      input.runtimeEndpointId,
      input.executionAttemptId,
      input.downstreamApiKeyId,
    ]),
    siteId: input.siteId,
    accountId: input.accountId,
    model: input.model,
    routeEntrypointId: input.routeEntrypointId,
    runtimeEndpointId: input.runtimeEndpointId,
    executionAttemptId: input.executionAttemptId,
    downstreamApiKeyId: input.downstreamApiKeyId,
    ...dimensions,
    totalAmount: quote ? 0 : null,
    knownObservationCount: 0,
    unknownObservationCount: 0,
  };
  if (quote) {
    current.totalAmount = (current.totalAmount ?? 0) + quote.amount;
    current.knownObservationCount += 1;
  } else {
    current.unknownObservationCount += 1;
  }
  target.set(key, current);
}

function appendBillingCostSubjects(
  target: Map<string, BillingCostAggregateDeltaRow>,
  input: {
    observationGrain: BillingObservationGrain;
    bucketStart: string;
    billingDetails: string | null;
    subjects: Array<{ kind: BillingCostSubjectKind; key: string | null }>;
    siteId: number | null;
    accountId: number | null;
    model: string | null;
    routeEntrypointId: string | null;
    runtimeEndpointId: string | null;
    executionAttemptId: string | null;
    downstreamApiKeyId: number | null;
  },
): void {
  for (const subject of input.subjects) {
    if (!subject.key) continue;
    appendBillingCostDelta(target, {
      observationGrain: input.observationGrain,
      bucketKind: 'day',
      bucketStart: input.bucketStart,
      subjectKind: subject.kind,
      subjectKey: subject.key,
      billingDetails: input.billingDetails,
      siteId: input.siteId,
      accountId: input.accountId,
      model: input.model,
      routeEntrypointId: input.routeEntrypointId,
      runtimeEndpointId: input.runtimeEndpointId,
      executionAttemptId: input.executionAttemptId,
      downstreamApiKeyId: input.downstreamApiKeyId,
    });
  }
}

function buildAttemptProjectionBatchDelta(rows: ProxyLogProjectionRow[]): ProjectionBatchDelta {
  const siteDayMap = new Map<string, SiteDayUsageDeltaRow>();
  const siteHourMap = new Map<string, SiteHourUsageDeltaRow>();
  const modelDayMap = new Map<string, ModelDayUsageDeltaRow>();
  const routeRuntimeDayMap = new Map<string, RouteRuntimeDayUsageDeltaRow>();
  const billingCostMap = new Map<string, BillingCostAggregateDeltaRow>();

  for (const row of rows) {
    const localDay = toLocalDayKeyFromStoredUtc(row.createdAt);
    const bucketStartUtc = toLocalHourStartUtcFromStoredUtc(row.createdAt);
    if (!localDay || !bucketStartUtc) continue;

    const siteId = normalizePositiveInt(row.siteId);
    const accountId = normalizePositiveInt(row.accountId);
    const routeEntrypointId = normalizeIdentityText(row.routeEntrypointId);
    const runtimeEndpointId = normalizeIdentityText(row.runtimeEndpointId);
    const executionTargetId = normalizePositiveInt(row.executionTargetId);
    const executionAttemptId = normalizeIdentityText(row.executionAttemptId);
    const status = String(row.status || '').trim().toLowerCase();
    const isSuccess = status === 'success';
    const totalTokens = normalizeNonNegativeInt(row.totalTokens);
    const latencyMs = normalizeNonNegativeInt(row.latencyMs);
    const latencyCount = latencyMs > 0 ? 1 : 0;

    const runtimeModel = resolveRuntimeModelName(row);
    if (!runtimeModel) continue;

    const runtimeIdentity = {
      routeEntrypointId,
      runtimeEndpointId,
      executionTargetId,
      executionAttemptId,
      siteId,
      accountId,
      model: runtimeModel,
    };
    if (!hasCompiledRuntimeIdentity(runtimeIdentity)) continue;

    const runtimeIdentityKey = buildRuntimeIdentityKey(runtimeIdentity);
    const routeRuntimeDayKey = `${localDay}:${runtimeIdentityKey}`;
    const routeRuntimeDay = routeRuntimeDayMap.get(routeRuntimeDayKey) || {
      localDay,
      runtimeIdentityKey,
      ...runtimeIdentity,
      totalCalls: 0,
      successCalls: 0,
      failedCalls: 0,
      totalTokens: 0,
      totalLatencyMs: 0,
      latencyCount: 0,
    };
    routeRuntimeDay.totalCalls += 1;
    routeRuntimeDay.successCalls += isSuccess ? 1 : 0;
    routeRuntimeDay.failedCalls += isSuccess ? 0 : 1;
    routeRuntimeDay.totalTokens += totalTokens;
    routeRuntimeDay.totalLatencyMs += latencyMs;
    routeRuntimeDay.latencyCount += latencyCount;
    routeRuntimeDayMap.set(routeRuntimeDayKey, routeRuntimeDay);

    appendBillingCostSubjects(billingCostMap, {
      observationGrain: 'attempt',
      bucketStart: localDay,
      billingDetails: row.billingDetails,
      siteId,
      accountId,
      model: runtimeModel,
      routeEntrypointId,
      runtimeEndpointId,
      executionAttemptId,
      downstreamApiKeyId: normalizePositiveInt(row.downstreamApiKeyId),
      subjects: [
        { kind: 'site', key: siteId == null ? null : String(siteId) },
        { kind: 'account', key: accountId == null ? null : String(accountId) },
        { kind: 'model', key: runtimeModel },
        { kind: 'endpoint', key: runtimeEndpointId },
        { kind: 'execution_attempt', key: executionAttemptId },
        { kind: 'downstream_key', key: row.downstreamApiKeyId == null ? null : String(row.downstreamApiKeyId) },
      ],
    });
  }

  return {
    siteDayRows: Array.from(siteDayMap.values()),
    siteHourRows: Array.from(siteHourMap.values()),
    modelDayRows: Array.from(modelDayMap.values()),
    routeRuntimeDayRows: Array.from(routeRuntimeDayMap.values()),
    billingCostRows: Array.from(billingCostMap.values()),
  };
}

function buildRequestProjectionBatchDelta(rows: ProxyRequestProjectionRow[]): ProjectionBatchDelta {
  const siteDayMap = new Map<string, SiteDayUsageDeltaRow>();
  const siteHourMap = new Map<string, SiteHourUsageDeltaRow>();
  const modelDayMap = new Map<string, ModelDayUsageDeltaRow>();
  const billingCostMap = new Map<string, BillingCostAggregateDeltaRow>();

  for (const row of rows) {
    const localDay = toLocalDayKeyFromStoredUtc(row.completedAt);
    const bucketStartUtc = toLocalHourStartUtcFromStoredUtc(row.completedAt);
    if (!localDay || !bucketStartUtc) continue;
    const siteId = normalizePositiveInt(row.finalSiteId);
    const accountId = normalizePositiveInt(row.finalAccountId);
    const routeEntrypointId = normalizeIdentityText(row.routeEntrypointId);
    const runtimeEndpointId = normalizeIdentityText(row.runtimeEndpointId);
    const executionAttemptId = normalizeIdentityText(row.finalExecutionAttemptId);
    const downstreamApiKeyId = normalizePositiveInt(row.downstreamApiKeyId);
    const model = String(row.actualModel || row.requestedModel || 'unknown').trim() || 'unknown';
    const succeeded = row.status === 'success';
    const totalTokens = normalizeNonNegativeInt(row.totalTokens);
    const latencyMs = normalizeNonNegativeInt(row.latencyMs);
    const latencyCount = latencyMs > 0 ? 1 : 0;

    if (siteId && accountId) {
      const siteDayKey = `${localDay}:${siteId}`;
      const siteDay = siteDayMap.get(siteDayKey) || {
        localDay,
        siteId,
        totalCalls: 0,
        successCalls: 0,
        failedCalls: 0,
        totalTokens: 0,
        totalLatencyMs: 0,
        latencyCount: 0,
      };
      siteDay.totalCalls += 1;
      siteDay.successCalls += succeeded ? 1 : 0;
      siteDay.failedCalls += succeeded ? 0 : 1;
      siteDay.totalTokens += totalTokens;
      siteDay.totalLatencyMs += latencyMs;
      siteDay.latencyCount += latencyCount;
      siteDayMap.set(siteDayKey, siteDay);

      const siteHourKey = `${bucketStartUtc}:${siteId}`;
      const siteHour = siteHourMap.get(siteHourKey) || {
        bucketStartUtc,
        siteId,
        totalCalls: 0,
        successCalls: 0,
        failedCalls: 0,
        totalTokens: 0,
        totalLatencyMs: 0,
        latencyCount: 0,
      };
      siteHour.totalCalls += 1;
      siteHour.successCalls += succeeded ? 1 : 0;
      siteHour.failedCalls += succeeded ? 0 : 1;
      siteHour.totalTokens += totalTokens;
      siteHour.totalLatencyMs += latencyMs;
      siteHour.latencyCount += latencyCount;
      siteHourMap.set(siteHourKey, siteHour);

      const modelDayKey = `${localDay}:${siteId}:${accountId}:${model}`;
      const modelDay = modelDayMap.get(modelDayKey) || {
        localDay,
        siteId,
        accountId,
        model,
        totalCalls: 0,
        successCalls: 0,
        failedCalls: 0,
        totalTokens: 0,
        totalLatencyMs: 0,
        latencyCount: 0,
      };
      modelDay.totalCalls += 1;
      modelDay.successCalls += succeeded ? 1 : 0;
      modelDay.failedCalls += succeeded ? 0 : 1;
      modelDay.totalTokens += totalTokens;
      modelDay.totalLatencyMs += latencyMs;
      modelDay.latencyCount += latencyCount;
      modelDayMap.set(modelDayKey, modelDay);
    }

    appendBillingCostSubjects(billingCostMap, {
      observationGrain: 'request',
      bucketStart: localDay,
      billingDetails: row.billingDetails,
      siteId,
      accountId,
      model,
      routeEntrypointId,
      runtimeEndpointId,
      executionAttemptId,
      downstreamApiKeyId,
      subjects: [
        { kind: 'site', key: siteId == null ? null : String(siteId) },
        { kind: 'account', key: accountId == null ? null : String(accountId) },
        { kind: 'model', key: model },
        { kind: 'entry', key: routeEntrypointId },
        { kind: 'downstream_key', key: downstreamApiKeyId == null ? null : String(downstreamApiKeyId) },
      ],
    });
  }

  return {
    siteDayRows: Array.from(siteDayMap.values()),
    siteHourRows: Array.from(siteHourMap.values()),
    modelDayRows: Array.from(modelDayMap.values()),
    routeRuntimeDayRows: [],
    billingCostRows: Array.from(billingCostMap.values()),
  };
}

async function upsertSiteDayUsage(tx: typeof db, row: SiteDayUsageDeltaRow, updatedAt: string) {
  const values = {
    localDay: row.localDay,
    siteId: row.siteId,
    totalCalls: row.totalCalls,
    successCalls: row.successCalls,
    failedCalls: row.failedCalls,
    totalTokens: row.totalTokens,
    totalLatencyMs: row.totalLatencyMs,
    latencyCount: row.latencyCount,
    updatedAt,
  };

  if (runtimeDbDialect === 'mysql') {
    await (tx.insert(schema.siteDayUsage).values(values) as any)
      .onDuplicateKeyUpdate({
        set: {
          totalCalls: sql`${schema.siteDayUsage.totalCalls} + ${row.totalCalls}`,
          successCalls: sql`${schema.siteDayUsage.successCalls} + ${row.successCalls}`,
          failedCalls: sql`${schema.siteDayUsage.failedCalls} + ${row.failedCalls}`,
          totalTokens: sql`${schema.siteDayUsage.totalTokens} + ${row.totalTokens}`,
          totalLatencyMs: sql`${schema.siteDayUsage.totalLatencyMs} + ${row.totalLatencyMs}`,
          latencyCount: sql`${schema.siteDayUsage.latencyCount} + ${row.latencyCount}`,
          updatedAt,
        },
      })
      .run();
    return;
  }

  await (tx.insert(schema.siteDayUsage).values(values) as any)
    .onConflictDoUpdate({
      target: [schema.siteDayUsage.localDay, schema.siteDayUsage.siteId],
      set: {
        totalCalls: sql`${schema.siteDayUsage.totalCalls} + ${row.totalCalls}`,
        successCalls: sql`${schema.siteDayUsage.successCalls} + ${row.successCalls}`,
        failedCalls: sql`${schema.siteDayUsage.failedCalls} + ${row.failedCalls}`,
        totalTokens: sql`${schema.siteDayUsage.totalTokens} + ${row.totalTokens}`,
        totalLatencyMs: sql`${schema.siteDayUsage.totalLatencyMs} + ${row.totalLatencyMs}`,
        latencyCount: sql`${schema.siteDayUsage.latencyCount} + ${row.latencyCount}`,
        updatedAt,
      },
    })
    .run();
}

async function upsertSiteHourUsage(tx: typeof db, row: SiteHourUsageDeltaRow, updatedAt: string) {
  const values = {
    bucketStartUtc: row.bucketStartUtc,
    siteId: row.siteId,
    totalCalls: row.totalCalls,
    successCalls: row.successCalls,
    failedCalls: row.failedCalls,
    totalTokens: row.totalTokens,
    totalLatencyMs: row.totalLatencyMs,
    latencyCount: row.latencyCount,
    updatedAt,
  };

  if (runtimeDbDialect === 'mysql') {
    await (tx.insert(schema.siteHourUsage).values(values) as any)
      .onDuplicateKeyUpdate({
        set: {
          totalCalls: sql`${schema.siteHourUsage.totalCalls} + ${row.totalCalls}`,
          successCalls: sql`${schema.siteHourUsage.successCalls} + ${row.successCalls}`,
          failedCalls: sql`${schema.siteHourUsage.failedCalls} + ${row.failedCalls}`,
          totalTokens: sql`${schema.siteHourUsage.totalTokens} + ${row.totalTokens}`,
          totalLatencyMs: sql`${schema.siteHourUsage.totalLatencyMs} + ${row.totalLatencyMs}`,
          latencyCount: sql`${schema.siteHourUsage.latencyCount} + ${row.latencyCount}`,
          updatedAt,
        },
      })
      .run();
    return;
  }

  await (tx.insert(schema.siteHourUsage).values(values) as any)
    .onConflictDoUpdate({
      target: [schema.siteHourUsage.bucketStartUtc, schema.siteHourUsage.siteId],
      set: {
        totalCalls: sql`${schema.siteHourUsage.totalCalls} + ${row.totalCalls}`,
        successCalls: sql`${schema.siteHourUsage.successCalls} + ${row.successCalls}`,
        failedCalls: sql`${schema.siteHourUsage.failedCalls} + ${row.failedCalls}`,
        totalTokens: sql`${schema.siteHourUsage.totalTokens} + ${row.totalTokens}`,
        totalLatencyMs: sql`${schema.siteHourUsage.totalLatencyMs} + ${row.totalLatencyMs}`,
        latencyCount: sql`${schema.siteHourUsage.latencyCount} + ${row.latencyCount}`,
        updatedAt,
      },
    })
    .run();
}

async function upsertModelDayUsage(tx: typeof db, row: ModelDayUsageDeltaRow, updatedAt: string) {
  const values = {
    localDay: row.localDay,
    siteId: row.siteId,
    accountId: row.accountId,
    model: row.model,
    totalCalls: row.totalCalls,
    successCalls: row.successCalls,
    failedCalls: row.failedCalls,
    totalTokens: row.totalTokens,
    totalLatencyMs: row.totalLatencyMs,
    latencyCount: row.latencyCount,
    updatedAt,
  };

  if (runtimeDbDialect === 'mysql') {
    await (tx.insert(schema.modelDayUsage).values(values) as any)
      .onDuplicateKeyUpdate({
        set: {
          totalCalls: sql`${schema.modelDayUsage.totalCalls} + ${row.totalCalls}`,
          successCalls: sql`${schema.modelDayUsage.successCalls} + ${row.successCalls}`,
          failedCalls: sql`${schema.modelDayUsage.failedCalls} + ${row.failedCalls}`,
          totalTokens: sql`${schema.modelDayUsage.totalTokens} + ${row.totalTokens}`,
          totalLatencyMs: sql`${schema.modelDayUsage.totalLatencyMs} + ${row.totalLatencyMs}`,
          latencyCount: sql`${schema.modelDayUsage.latencyCount} + ${row.latencyCount}`,
          updatedAt,
        },
      })
      .run();
    return;
  }

  await (tx.insert(schema.modelDayUsage).values(values) as any)
    .onConflictDoUpdate({
      target: [
        schema.modelDayUsage.localDay,
        schema.modelDayUsage.siteId,
        schema.modelDayUsage.accountId,
        schema.modelDayUsage.model,
      ],
      set: {
        totalCalls: sql`${schema.modelDayUsage.totalCalls} + ${row.totalCalls}`,
        successCalls: sql`${schema.modelDayUsage.successCalls} + ${row.successCalls}`,
        failedCalls: sql`${schema.modelDayUsage.failedCalls} + ${row.failedCalls}`,
        totalTokens: sql`${schema.modelDayUsage.totalTokens} + ${row.totalTokens}`,
        totalLatencyMs: sql`${schema.modelDayUsage.totalLatencyMs} + ${row.totalLatencyMs}`,
        latencyCount: sql`${schema.modelDayUsage.latencyCount} + ${row.latencyCount}`,
        updatedAt,
      },
    })
    .run();
}

async function upsertRouteRuntimeDayUsage(tx: typeof db, row: RouteRuntimeDayUsageDeltaRow, updatedAt: string) {
  const values = {
    localDay: row.localDay,
    runtimeIdentityKey: row.runtimeIdentityKey,
    routeEntrypointId: row.routeEntrypointId,
    runtimeEndpointId: row.runtimeEndpointId,
    executionTargetId: row.executionTargetId,
    executionAttemptId: row.executionAttemptId,
    siteId: row.siteId,
    accountId: row.accountId,
    model: row.model,
    totalCalls: row.totalCalls,
    successCalls: row.successCalls,
    failedCalls: row.failedCalls,
    totalTokens: row.totalTokens,
    totalLatencyMs: row.totalLatencyMs,
    latencyCount: row.latencyCount,
    updatedAt,
  };

  if (runtimeDbDialect === 'mysql') {
    await (tx.insert(schema.routeRuntimeDayUsage).values(values) as any)
      .onDuplicateKeyUpdate({
        set: {
          totalCalls: sql`${schema.routeRuntimeDayUsage.totalCalls} + ${row.totalCalls}`,
          successCalls: sql`${schema.routeRuntimeDayUsage.successCalls} + ${row.successCalls}`,
          failedCalls: sql`${schema.routeRuntimeDayUsage.failedCalls} + ${row.failedCalls}`,
          totalTokens: sql`${schema.routeRuntimeDayUsage.totalTokens} + ${row.totalTokens}`,
          totalLatencyMs: sql`${schema.routeRuntimeDayUsage.totalLatencyMs} + ${row.totalLatencyMs}`,
          latencyCount: sql`${schema.routeRuntimeDayUsage.latencyCount} + ${row.latencyCount}`,
          updatedAt,
        },
      })
      .run();
    return;
  }

  await (tx.insert(schema.routeRuntimeDayUsage).values(values) as any)
    .onConflictDoUpdate({
      target: [
        schema.routeRuntimeDayUsage.localDay,
        schema.routeRuntimeDayUsage.runtimeIdentityKey,
      ],
      set: {
        totalCalls: sql`${schema.routeRuntimeDayUsage.totalCalls} + ${row.totalCalls}`,
        successCalls: sql`${schema.routeRuntimeDayUsage.successCalls} + ${row.successCalls}`,
        failedCalls: sql`${schema.routeRuntimeDayUsage.failedCalls} + ${row.failedCalls}`,
        totalTokens: sql`${schema.routeRuntimeDayUsage.totalTokens} + ${row.totalTokens}`,
        totalLatencyMs: sql`${schema.routeRuntimeDayUsage.totalLatencyMs} + ${row.totalLatencyMs}`,
        latencyCount: sql`${schema.routeRuntimeDayUsage.latencyCount} + ${row.latencyCount}`,
        updatedAt,
      },
    })
    .run();
}

async function upsertBillingCostAggregate(
  tx: typeof db,
  row: BillingCostAggregateDeltaRow,
  updatedAt: string,
) {
  const values = { ...row, updatedAt };
  const totalAmount = row.totalAmount == null
    ? null
    : sql`coalesce(${schema.billingCostAggregates.totalAmount}, 0) + ${row.totalAmount}`;
  const set = {
    totalAmount,
    knownObservationCount: sql`${schema.billingCostAggregates.knownObservationCount} + ${row.knownObservationCount}`,
    unknownObservationCount: sql`${schema.billingCostAggregates.unknownObservationCount} + ${row.unknownObservationCount}`,
    updatedAt,
  };

  if (runtimeDbDialect === 'mysql') {
    await (tx.insert(schema.billingCostAggregates).values(values) as any)
      .onDuplicateKeyUpdate({ set })
      .run();
    return;
  }

  await (tx.insert(schema.billingCostAggregates).values(values) as any)
    .onConflictDoUpdate({
      target: [
        schema.billingCostAggregates.observationGrain,
        schema.billingCostAggregates.bucketKind,
        schema.billingCostAggregates.bucketStart,
        schema.billingCostAggregates.subjectKind,
        schema.billingCostAggregates.subjectKey,
        schema.billingCostAggregates.dimensionKey,
        schema.billingCostAggregates.quoteUnit,
        schema.billingCostAggregates.currencyKey,
        schema.billingCostAggregates.quoteSource,
        schema.billingCostAggregates.quoteSourceIdKey,
        schema.billingCostAggregates.estimateLevelKey,
        schema.billingCostAggregates.planFingerprintKey,
      ],
      set,
    })
    .run();
}

async function applyProjectionDelta(
  checkpoint: ProjectionCheckpointRow,
  delta: ProjectionBatchDelta,
  cursor: Partial<Pick<ProjectionCheckpointRow,
    'lastProxyLogId' | 'watermarkCreatedAt' | 'lastProxyRequestCompletedAt' | 'lastProxyRequestId'>>,
): Promise<ProjectionCheckpointRow> {
  const updatedAt = new Date().toISOString();
  const nextCheckpoint = {
    ...checkpoint,
    ...cursor,
    recomputeFromId: checkpoint.recomputeFromId ?? null,
    recomputeRequestedAt: checkpoint.recomputeRequestedAt ?? null,
    leaseExpiresAt: checkpoint.leaseToken ? buildProjectionLeaseExpiry() : checkpoint.leaseExpiresAt,
    lastProjectedAt: updatedAt,
    lastSuccessfulAt: updatedAt,
    lastError: null,
    createdAt: checkpoint.createdAt ?? updatedAt,
  };

  await db.transaction(async (tx) => {
    for (const row of delta.siteDayRows) {
      await upsertSiteDayUsage(tx as typeof db, row, updatedAt);
    }
    for (const row of delta.siteHourRows) {
      await upsertSiteHourUsage(tx as typeof db, row, updatedAt);
    }
    for (const row of delta.modelDayRows) {
      await upsertModelDayUsage(tx as typeof db, row, updatedAt);
    }
    for (const row of delta.routeRuntimeDayRows) {
      await upsertRouteRuntimeDayUsage(tx as typeof db, row, updatedAt);
    }
    for (const row of delta.billingCostRows) {
      await upsertBillingCostAggregate(tx as typeof db, row, updatedAt);
    }
    await writeProjectionCheckpoint(tx as typeof db, nextCheckpoint);
  });

  clearAnalyticsSnapshots();
  return {
    ...checkpoint,
    ...nextCheckpoint,
    updatedAt,
  };
}

async function applyAttemptProjectionBatch(
  checkpoint: ProjectionCheckpointRow,
  rows: ProxyLogProjectionRow[],
): Promise<ProjectionCheckpointRow> {
  const lastRow = rows.at(-1);
  if (!lastRow) return checkpoint;
  return applyProjectionDelta(
    checkpoint,
    buildAttemptProjectionBatchDelta(rows),
    {
      lastProxyLogId: lastRow.id,
      watermarkCreatedAt: typeof lastRow.createdAt === 'string'
        ? lastRow.createdAt
        : String(lastRow.createdAt || ''),
    },
  );
}

async function applyRequestProjectionBatch(
  checkpoint: ProjectionCheckpointRow,
  rows: ProxyRequestProjectionRow[],
): Promise<ProjectionCheckpointRow> {
  const lastRow = rows.at(-1);
  if (!lastRow) return checkpoint;
  return applyProjectionDelta(
    checkpoint,
    buildRequestProjectionBatchDelta(rows),
    {
      lastProxyRequestCompletedAt: typeof lastRow.completedAt === 'string'
        ? lastRow.completedAt
        : String(lastRow.completedAt || ''),
      lastProxyRequestId: lastRow.id,
    },
  );
}

async function applyPendingRecompute(checkpoint: ProjectionCheckpointRow) {
  const recomputeFromId = normalizeNonNegativeInt(checkpoint.recomputeFromId);
  if (recomputeFromId <= 0) return checkpoint;

  const affectedRow = await db
    .select({
      id: schema.proxyLogs.id,
      createdAt: schema.proxyLogs.createdAt,
    })
    .from(schema.proxyLogs)
    .where(gte(schema.proxyLogs.id, recomputeFromId))
    .orderBy(asc(schema.proxyLogs.id))
    .get();

  if (!affectedRow) {
    const nextCheckpoint = {
      ...checkpoint,
      recomputeFromId: null,
      recomputeRequestedAt: null,
      leaseExpiresAt: checkpoint.leaseToken ? buildProjectionLeaseExpiry() : checkpoint.leaseExpiresAt,
      lastProjectedAt: new Date().toISOString(),
    };
    await db.transaction(async (tx) => {
      await writeProjectionCheckpoint(tx as typeof db, nextCheckpoint as any);
    });
    return { ...checkpoint, ...nextCheckpoint };
  }

  const affectedDay = toLocalDayKeyFromStoredUtc(affectedRow.createdAt);
  const affectedDayStartUtc = toLocalDayStartUtcFromStoredUtc(affectedRow.createdAt);
  if (!affectedDay || !affectedDayStartUtc) {
    throw new Error('Failed to resolve recompute boundary for usage aggregates');
  }

  const restartRow = await db
    .select({
      id: schema.proxyLogs.id,
      createdAt: schema.proxyLogs.createdAt,
    })
    .from(schema.proxyLogs)
    .where(gte(schema.proxyLogs.createdAt, affectedDayStartUtc))
    .orderBy(asc(schema.proxyLogs.id))
    .get();

  const restartFromId = restartRow?.id || affectedRow.id;
  const nextCheckpoint = {
    ...checkpoint,
    lastProxyLogId: Math.max(0, restartFromId - 1),
    watermarkCreatedAt: null,
    lastProxyRequestCompletedAt: affectedDayStartUtc,
    lastProxyRequestId: '',
    recomputeFromId: null,
    recomputeRequestedAt: null,
    leaseExpiresAt: checkpoint.leaseToken ? buildProjectionLeaseExpiry() : checkpoint.leaseExpiresAt,
    lastProjectedAt: new Date().toISOString(),
  };

  await db.transaction(async (tx) => {
    await tx.delete(schema.siteDayUsage).where(gte(schema.siteDayUsage.localDay, affectedDay)).run();
    await tx.delete(schema.siteHourUsage).where(gte(schema.siteHourUsage.bucketStartUtc, affectedDayStartUtc)).run();
    await tx.delete(schema.modelDayUsage).where(gte(schema.modelDayUsage.localDay, affectedDay)).run();
    await tx.delete(schema.routeRuntimeDayUsage).where(gte(schema.routeRuntimeDayUsage.localDay, affectedDay)).run();
    await tx.delete(schema.billingCostAggregates).where(gte(schema.billingCostAggregates.bucketStart, affectedDay)).run();
    await writeProjectionCheckpoint(tx as typeof db, nextCheckpoint as any);
  });

  clearAnalyticsSnapshots();
  return { ...checkpoint, ...nextCheckpoint };
}

async function runUsageAggregationProjectionPassImpl(
  options: ProjectionPassOptions = {},
): Promise<ProjectionPassResult> {
  const lease = await tryAcquireProjectionLease();
  if (!lease) {
    const checkpoint = await readProjectionCheckpoint();
    return {
      processedLogs: 0,
      processedRequests: 0,
      watermarkId: checkpoint.lastProxyLogId,
      recomputed: false,
    };
  }

  try {
    let checkpoint: ProjectionCheckpointRow = {
      ...(await readProjectionCheckpoint()),
      leaseOwner: lease.owner,
      leaseToken: lease.token,
      leaseExpiresAt: lease.expiresAt,
    };
    const hadPendingRecompute = normalizeNonNegativeInt(checkpoint.recomputeFromId) > 0;
    if (hadPendingRecompute) {
      checkpoint = await applyPendingRecompute(checkpoint);
    }

    let processedLogs = 0;
    let processedRequests = 0;
    const maxBatches = Math.max(
      1,
      Math.trunc(options.maxBatches || PROJECTION_MAX_BATCHES_PER_PASS),
    );

    for (let index = 0; index < maxBatches; index += 1) {
      const rows = await fetchRequestProjectionBatch(checkpoint, PROJECTION_BATCH_SIZE);
      if (rows.length <= 0) break;
      checkpoint = await applyRequestProjectionBatch(checkpoint, rows);
      processedRequests += rows.length;
      if (rows.length < PROJECTION_BATCH_SIZE) break;
    }

    for (let index = 0; index < maxBatches; index += 1) {
      const rows = await fetchProjectionBatch(checkpoint.lastProxyLogId, PROJECTION_BATCH_SIZE);
      if (rows.length <= 0) {
        break;
      }

      checkpoint = await applyAttemptProjectionBatch(checkpoint, rows);
      processedLogs += rows.length;

      if (rows.length < PROJECTION_BATCH_SIZE) {
        break;
      }
    }

    await releaseProjectionLease(lease);
    return {
      processedLogs,
      processedRequests,
      watermarkId: checkpoint.lastProxyLogId,
      recomputed: hadPendingRecompute,
    };
  } catch (error) {
    await releaseProjectionLease(lease, { error });
    throw error;
  }
}

export async function runUsageAggregationProjectionPass(
  options: ProjectionPassOptions = {},
): Promise<ProjectionPassResult> {
  if (projectionInFlight) {
    return projectionInFlight;
  }

  projectionInFlight = runUsageAggregationProjectionPassImpl(options).finally(() => {
    projectionInFlight = null;
  });
  return projectionInFlight;
}

export async function requestUsageAggregatesRecompute(fromLogId = 1): Promise<void> {
  const checkpoint = await readProjectionCheckpoint();
  const normalizedFromId = Math.max(1, Math.trunc(fromLogId || 1));
  const nextFromId = checkpoint.recomputeFromId && checkpoint.recomputeFromId > 0
    ? Math.min(checkpoint.recomputeFromId, normalizedFromId)
    : normalizedFromId;

  await db.transaction(async (tx) => {
    await writeProjectionCheckpoint(tx as typeof db, {
      ...checkpoint,
      lastProxyLogId: checkpoint.lastProxyLogId,
      recomputeFromId: nextFromId,
      recomputeRequestedAt: new Date().toISOString(),
      lastProjectedAt: checkpoint.lastProjectedAt,
    } as any);
  });
}

export function startUsageAggregationProjectorScheduler() {
  if (projectionTimer) return;
  void runUsageAggregationProjectionPass();
  projectionTimer = setInterval(() => {
    void runUsageAggregationProjectionPass();
  }, PROJECTION_INTERVAL_MS);
}

export async function stopUsageAggregationProjectorScheduler() {
  if (projectionTimer) {
    clearInterval(projectionTimer);
    projectionTimer = null;
  }
  if (projectionInFlight) {
    await projectionInFlight;
  }
}

export async function __resetUsageAggregationProjectorForTests() {
  await stopUsageAggregationProjectorScheduler();
}
