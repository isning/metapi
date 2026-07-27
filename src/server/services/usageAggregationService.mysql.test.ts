import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const analyticsProjectionCheckpoints = sqliteTable('analytics_projection_checkpoints', {
  projectorKey: text('projector_key').primaryKey(),
  timeZone: text('time_zone'),
  lastProxyLogId: integer('last_proxy_log_id'),
  lastProxyRequestCompletedAt: text('last_proxy_request_completed_at'),
  lastProxyRequestId: text('last_proxy_request_id'),
  watermarkCreatedAt: text('watermark_created_at'),
  recomputeFromId: integer('recompute_from_id'),
  recomputeRequestedAt: text('recompute_requested_at'),
  recomputeReason: text('recompute_reason'),
  recomputeStartedAt: text('recompute_started_at'),
  recomputeCompletedAt: text('recompute_completed_at'),
  leaseOwner: text('lease_owner'),
  leaseToken: text('lease_token'),
  leaseExpiresAt: text('lease_expires_at'),
  lastProjectedAt: text('last_projected_at'),
  lastSuccessfulAt: text('last_successful_at'),
  lastError: text('last_error'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
});

const proxyLogs = sqliteTable('proxy_logs', {
  id: integer('id').primaryKey(),
  accountId: integer('account_id'),
  createdAt: text('created_at'),
  routeEntrypointId: text('route_entrypoint_id'),
  runtimeEndpointId: text('runtime_endpoint_id'),
  executionTargetId: integer('execution_target_id'),
  executionAttemptId: text('execution_attempt_id'),
  downstreamApiKeyId: integer('downstream_api_key_id'),
  status: text('status'),
  latencyMs: integer('latency_ms'),
  totalTokens: integer('total_tokens'),
  billingDetails: text('billing_details'),
  modelActual: text('model_actual'),
  modelRequested: text('model_requested'),
});

const proxyRequests = sqliteTable('proxy_requests', {
  id: text('id').primaryKey(),
  routeEntrypointId: text('route_entrypoint_id'),
  runtimeEndpointId: text('runtime_endpoint_id'),
  status: text('status'),
  finalExecutionAttemptId: text('final_execution_attempt_id'),
  finalSiteId: integer('final_site_id'),
  finalAccountId: integer('final_account_id'),
  downstreamApiKeyId: integer('downstream_api_key_id'),
  requestedModel: text('requested_model'),
  actualModel: text('actual_model'),
  completedAt: text('completed_at'),
  latencyMs: integer('latency_ms'),
  totalTokens: integer('total_tokens'),
  billingDetails: text('billing_details'),
});

const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey(),
  siteId: integer('site_id'),
});

const sites = sqliteTable('sites', {
  id: integer('id').primaryKey(),
  platform: text('platform'),
});

const siteDayUsage = sqliteTable('site_day_usage', {
  localDay: text('local_day'),
  siteId: integer('site_id'),
  totalCalls: integer('total_calls'),
  successCalls: integer('success_calls'),
  failedCalls: integer('failed_calls'),
  totalTokens: integer('total_tokens'),
  totalLatencyMs: integer('total_latency_ms'),
  latencyCount: integer('latency_count'),
  updatedAt: text('updated_at'),
});

const siteHourUsage = sqliteTable('site_hour_usage', {
  bucketStartUtc: text('bucket_start_utc'),
  siteId: integer('site_id'),
  totalCalls: integer('total_calls'),
  successCalls: integer('success_calls'),
  failedCalls: integer('failed_calls'),
  totalTokens: integer('total_tokens'),
  totalLatencyMs: integer('total_latency_ms'),
  latencyCount: integer('latency_count'),
  updatedAt: text('updated_at'),
});

const modelDayUsage = sqliteTable('model_day_usage', {
  localDay: text('local_day'),
  siteId: integer('site_id'),
  model: text('model'),
  totalCalls: integer('total_calls'),
  successCalls: integer('success_calls'),
  failedCalls: integer('failed_calls'),
  totalTokens: integer('total_tokens'),
  totalLatencyMs: integer('total_latency_ms'),
  latencyCount: integer('latency_count'),
  updatedAt: text('updated_at'),
});

const routeRuntimeDayUsage = sqliteTable('route_runtime_day_usage', {
  localDay: text('local_day'),
  runtimeIdentityKey: text('runtime_identity_key'),
  routeEntrypointId: text('route_entrypoint_id'),
  runtimeEndpointId: text('runtime_endpoint_id'),
  executionTargetId: integer('execution_target_id'),
  executionAttemptId: text('execution_attempt_id'),
  siteId: integer('site_id'),
  accountId: integer('account_id'),
  model: text('model'),
  totalCalls: integer('total_calls'),
  successCalls: integer('success_calls'),
  failedCalls: integer('failed_calls'),
  totalTokens: integer('total_tokens'),
  totalLatencyMs: integer('total_latency_ms'),
  latencyCount: integer('latency_count'),
  updatedAt: text('updated_at'),
});

const billingCostAggregates = sqliteTable('billing_cost_aggregates', {
  observationGrain: text('observation_grain'),
  bucketKind: text('bucket_kind'),
  bucketStart: text('bucket_start'),
  subjectKind: text('subject_kind'),
  subjectKey: text('subject_key'),
  dimensionKey: text('dimension_key'),
  siteId: integer('site_id'),
  accountId: integer('account_id'),
  model: text('model'),
  routeEntrypointId: text('route_entrypoint_id'),
  runtimeEndpointId: text('runtime_endpoint_id'),
  executionAttemptId: text('execution_attempt_id'),
  downstreamApiKeyId: integer('downstream_api_key_id'),
  quoteUnit: text('quote_unit'),
  currencyKey: text('currency_key'),
  quoteSource: text('quote_source'),
  quoteSourceIdKey: text('quote_source_id_key'),
  estimateLevelKey: text('estimate_level_key'),
  planFingerprintKey: text('plan_fingerprint_key'),
  totalAmount: real('total_amount'),
  knownObservationCount: integer('known_observation_count'),
  unknownObservationCount: integer('unknown_observation_count'),
  updatedAt: text('updated_at'),
});

const schema = {
  analyticsProjectionCheckpoints,
  proxyLogs,
  proxyRequests,
  accounts,
  sites,
  siteDayUsage,
  siteHourUsage,
  modelDayUsage,
  routeRuntimeDayUsage,
  billingCostAggregates,
};

type MockState = {
  checkpoint: Record<string, unknown> | null;
  proxyRows: Array<Record<string, unknown>>;
  proxyRequestRows: Array<Record<string, unknown>>;
  siteDayRows: Array<Record<string, unknown>>;
  siteHourRows: Array<Record<string, unknown>>;
  modelDayRows: Array<Record<string, unknown>>;
  routeRuntimeDayRows: Array<Record<string, unknown>>;
  billingCostRows: Array<Record<string, unknown>>;
  onDuplicateKeyUpdateTables: string[];
};

const state: MockState = {
  checkpoint: null,
  proxyRows: [],
  proxyRequestRows: [],
  siteDayRows: [],
  siteHourRows: [],
  modelDayRows: [],
  routeRuntimeDayRows: [],
  billingCostRows: [],
  onDuplicateKeyUpdateTables: [],
};

function resetMockState() {
  state.checkpoint = null;
  state.proxyRows = [];
  state.proxyRequestRows = [];
  state.siteDayRows = [];
  state.siteHourRows = [];
  state.modelDayRows = [];
  state.routeRuntimeDayRows = [];
  state.billingCostRows = [];
  state.onDuplicateKeyUpdateTables = [];
}

function resolveTableName(table: unknown): string {
  if (table && typeof table === 'object') {
    try {
      return getTableName(table as never);
    } catch {
      // Fall through to identity checks for the local table fixtures.
    }
  }
  if (table === analyticsProjectionCheckpoints) return 'analytics_projection_checkpoints';
  if (table === proxyLogs) return 'proxy_logs';
  if (table === proxyRequests) return 'proxy_requests';
  if (table === siteDayUsage) return 'site_day_usage';
  if (table === siteHourUsage) return 'site_hour_usage';
  if (table === modelDayUsage) return 'model_day_usage';
  if (table === routeRuntimeDayUsage) return 'route_runtime_day_usage';
  if (table === billingCostAggregates) return 'billing_cost_aggregates';
  return 'unknown';
}

function applyInsert(
  table: unknown,
  values: Record<string, unknown> | Array<Record<string, unknown>>,
  onDuplicateSet: Record<string, unknown> | null,
) {
  const tableName = resolveTableName(table);
  if (tableName === 'analytics_projection_checkpoints') {
    if (!state.checkpoint) {
      state.checkpoint = { ...(values as Record<string, unknown>) };
      return;
    }
    if (onDuplicateSet) {
      state.checkpoint = { ...state.checkpoint, ...onDuplicateSet };
    }
    return;
  }

  if (tableName === 'site_day_usage') {
    state.siteDayRows.push({ ...(values as Record<string, unknown>) });
    return;
  }

  if (tableName === 'site_hour_usage') {
    state.siteHourRows.push({ ...(values as Record<string, unknown>) });
    return;
  }

  if (tableName === 'model_day_usage') {
    state.modelDayRows.push({ ...(values as Record<string, unknown>) });
    return;
  }

  if (tableName === 'route_runtime_day_usage') {
    state.routeRuntimeDayRows.push({ ...(values as Record<string, unknown>) });
    return;
  }
  if (tableName === 'billing_cost_aggregates') {
    state.billingCostRows.push({ ...(values as Record<string, unknown>) });
  }
}

function makeInsertChain(table: unknown) {
  let values: Record<string, unknown> | Array<Record<string, unknown>> = {};
  let onDuplicateSet: Record<string, unknown> | null = null;

  const chain = {
    values(nextValues: Record<string, unknown> | Array<Record<string, unknown>>) {
      values = nextValues;
      return chain;
    },
    onDuplicateKeyUpdate(input: { set: Record<string, unknown> }) {
      state.onDuplicateKeyUpdateTables.push(resolveTableName(table));
      onDuplicateSet = input.set;
      return chain;
    },
    run: vi.fn(async () => {
      applyInsert(table, values, onDuplicateSet);
      return { changes: 1 };
    }),
  };

  return chain;
}

function makeSelectChain() {
  let fromTable: unknown = null;

  const chain = {
    from(table: unknown) {
      fromTable = table;
      return chain;
    },
    leftJoin() {
      return chain;
    },
    where() {
      return chain;
    },
    orderBy() {
      return chain;
    },
    limit() {
      return chain;
    },
    async get() {
      const tableName = resolveTableName(fromTable);
      if (tableName === 'analytics_projection_checkpoints') {
        return state.checkpoint ? { ...state.checkpoint } : undefined;
      }
      if (tableName === 'proxy_logs') {
        return state.proxyRows[0] ? { ...state.proxyRows[0] } : undefined;
      }
      return undefined;
    },
    async all() {
      const tableName = resolveTableName(fromTable);
      if (tableName === 'proxy_logs') {
        return state.proxyRows.map((row) => ({ ...row }));
      }
      if (tableName === 'proxy_requests') {
        return state.proxyRequestRows.map((row) => ({ ...row }));
      }
      if (tableName === 'site_day_usage') {
        return state.siteDayRows.map((row) => ({ ...row }));
      }
      if (tableName === 'site_hour_usage') {
        return state.siteHourRows.map((row) => ({ ...row }));
      }
      if (tableName === 'model_day_usage') {
        return state.modelDayRows.map((row) => ({ ...row }));
      }
      if (tableName === 'route_runtime_day_usage') {
        return state.routeRuntimeDayRows.map((row) => ({ ...row }));
      }
      return [];
    },
  };

  return chain;
}

function makeUpdateChain(table: unknown) {
  let setValues: Record<string, unknown> = {};

  const chain = {
    set(nextValues: Record<string, unknown>) {
      setValues = nextValues;
      return chain;
    },
    where() {
      return chain;
    },
    run: vi.fn(async () => {
      if (table === analyticsProjectionCheckpoints && state.checkpoint) {
        state.checkpoint = { ...state.checkpoint, ...setValues };
        return { changes: 1 };
      }
      return { changes: 0 };
    }),
  };

  return chain;
}

const db = {
  insert: vi.fn((table: unknown) => makeInsertChain(table)),
  select: vi.fn(() => makeSelectChain()),
  update: vi.fn((table: unknown) => makeUpdateChain(table)),
  transaction: vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db)),
};

vi.mock('../db/index.js', () => ({
  db,
  runtimeDbDialect: 'mysql',
  schema,
}));

vi.mock('./localTimeService.js', () => ({
  getLocalRangeStartDayKey: vi.fn(() => '2026-04-08'),
  getResolvedTimeZone: vi.fn(() => 'Local'),
  toLocalDayKeyFromStoredUtc: vi.fn(() => '2026-04-08'),
  toLocalDayStartUtcFromStoredUtc: vi.fn(() => '2026-04-08 00:00:00'),
  toLocalHourStartUtcFromStoredUtc: vi.fn(() => '2026-04-08 02:00:00'),
}));

vi.mock('./snapshotCacheService.js', () => ({
  clearSnapshotCache: vi.fn(),
}));

type UsageAggregationModule = typeof import('./usageAggregationService.js');

describe('usageAggregationService mysql conflict handling', () => {
  let usageAggregationModule: UsageAggregationModule;

  beforeEach(async () => {
    resetMockState();
    vi.resetModules();
    usageAggregationModule = await import('./usageAggregationService.js');
    await usageAggregationModule.__resetUsageAggregationProjectorForTests();
  });

  it('uses mysql duplicate-key upserts for checkpoint and aggregate writes', async () => {
    state.proxyRequestRows = [{
      id: 'request-1',
      completedAt: '2026-04-08 02:10:00',
      routeEntrypointId: 'entry:gpt-5',
      runtimeEndpointId: 'supply:gpt-5:primary',
      finalExecutionAttemptId: 'attempt:gpt-5:primary',
      finalSiteId: 7,
      finalAccountId: 17,
      downstreamApiKeyId: null,
      requestedModel: 'gpt-5',
      actualModel: 'gpt-5',
      status: 'success',
      latencyMs: 120,
      totalTokens: 100,
      billingDetails: JSON.stringify({ quote: { amount: 0.2, unit: 'currency', currency: 'USD', source: 'provider_catalog' } }),
    }];
    state.proxyRows = [{
      id: 1,
      createdAt: '2026-04-08 02:10:00',
      routeEntrypointId: 'entry:gpt-5',
      runtimeEndpointId: 'supply:gpt-5:primary',
      executionTargetId: 301,
      executionAttemptId: 'attempt:gpt-5:primary',
      status: 'success',
      latencyMs: 120,
      totalTokens: 100,
      billingDetails: JSON.stringify({ quote: { amount: 0.2, unit: 'currency', currency: 'USD', source: 'provider_catalog' } }),
      modelActual: 'gpt-5',
      modelRequested: 'gpt-5',
      accountId: 17,
      siteId: 7,
      sitePlatform: 'new-api',
      requestStatus: 'success',
      requestFinalExecutionAttemptId: 'attempt:gpt-5:primary',
      requestCompletedAt: '2026-04-08 02:10:00',
      requestLatencyMs: 120,
      requestTotalTokens: 100,
      requestBillingDetails: JSON.stringify({ quote: { amount: 0.2, unit: 'currency', currency: 'USD', source: 'provider_catalog' } }),
    }];

    const result = await usageAggregationModule.runUsageAggregationProjectionPass();

    expect(result).toEqual({
      processedLogs: 1,
      processedRequests: 1,
      watermarkId: 1,
      recomputed: false,
    });
    expect(state.onDuplicateKeyUpdateTables).toEqual(expect.arrayContaining([
      'analytics_projection_checkpoints',
      'site_day_usage',
      'site_hour_usage',
      'model_day_usage',
      'route_runtime_day_usage',
    ]));
    expect(state.onDuplicateKeyUpdateTables.filter((table) => table === 'billing_cost_aggregates')).toHaveLength(9);
    expect(state.onDuplicateKeyUpdateTables.at(-1)).toBe('analytics_projection_checkpoints');
    expect(state.siteDayRows).toEqual([
      expect.objectContaining({
        localDay: '2026-04-08',
        siteId: 7,
        totalCalls: 1,
        successCalls: 1,
        failedCalls: 0,
        totalTokens: 100,
      }),
    ]);
    expect(state.siteHourRows).toEqual([
      expect.objectContaining({
        bucketStartUtc: '2026-04-08 02:00:00',
        siteId: 7,
        totalCalls: 1,
      }),
    ]);
    expect(state.modelDayRows).toEqual([
      expect.objectContaining({
        localDay: '2026-04-08',
        siteId: 7,
        model: 'gpt-5',
        totalCalls: 1,
      }),
    ]);
    expect(state.routeRuntimeDayRows).toEqual([
      expect.objectContaining({
        localDay: '2026-04-08',
        routeEntrypointId: 'entry:gpt-5',
        runtimeEndpointId: 'supply:gpt-5:primary',
        executionTargetId: 301,
        executionAttemptId: 'attempt:gpt-5:primary',
        siteId: 7,
        accountId: 17,
        model: 'gpt-5',
        totalCalls: 1,
        successCalls: 1,
        failedCalls: 0,
        totalTokens: 100,
      }),
    ]);
    expect(state.checkpoint).toEqual(expect.objectContaining({
      projectorKey: 'usage-aggregates-v1',
      lastProxyLogId: 1,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: null,
    }));
  });

  it('uses mysql duplicate-key upsert when recompute requests persist checkpoint state', async () => {
    await usageAggregationModule.requestUsageAggregatesRecompute(7);

    expect(state.onDuplicateKeyUpdateTables).toEqual([
      'analytics_projection_checkpoints',
    ]);
    expect(state.checkpoint).toEqual(expect.objectContaining({
      projectorKey: 'usage-aggregates-v1',
      lastProxyLogId: 0,
      recomputeFromId: 7,
    }));
  });
});
