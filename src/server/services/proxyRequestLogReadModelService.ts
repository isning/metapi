import { and, desc, eq, exists, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { summarizeProxyBillingDetails } from './billingCostFact.js';
import { withProxyLogSelectFields } from './proxyLogStore.js';

export type ProxyRequestStatusFilter = 'all' | 'success' | 'failed';
export type ProxyRequestClientFilter = { kind: 'app' | 'family'; value: string } | null;

export type ProxyRequestLogFilters = {
  status?: ProxyRequestStatusFilter;
  search?: string;
  client?: ProxyRequestClientFilter;
  siteId?: number | null;
  fromUtc?: string | null;
  toUtc?: string | null;
};

export type ProxyRequestClientOptionFact = {
  clientFamily?: string | null;
  clientAppId?: string | null;
  clientAppName?: string | null;
};

export type ProxyRequestRow = typeof schema.proxyRequests.$inferSelect;

export type ProxyRequestAttemptJoinedRow = {
  proxy_logs: Record<string, unknown> & { billingDetails?: string | null };
  accounts: { username?: string | null } | null;
  sites: { id?: number | null; name?: string | null; url?: string | null } | null;
  account_tokens: { id?: number | null; name?: string | null; tokenGroup?: string | null } | null;
  downstream_api_keys: {
    id?: number | null;
    name?: string | null;
    groupName?: string | null;
    tags?: string | null;
  } | null;
};

export type ProxyRequestLogRecord = {
  request: ProxyRequestRow;
  attempts: ProxyRequestAttemptJoinedRow[];
};

function attemptSearchCondition(search: string) {
  const likeTerm = `%${search}%`;
  return sql<boolean>`(
    lower(coalesce(${schema.proxyLogs.modelActual}, '')) like ${likeTerm}
    or lower(coalesce(${schema.downstreamApiKeys.name}, '')) like ${likeTerm}
    or lower(coalesce(${schema.downstreamApiKeys.groupName}, '')) like ${likeTerm}
    or lower(coalesce(${schema.downstreamApiKeys.tags}, '')) like ${likeTerm}
  )`;
}

function correlatedAttemptCondition(filters: ProxyRequestLogFilters) {
  const conditions = [
    eq(schema.proxyLogs.requestId, schema.proxyRequests.id),
    filters.client
      ? filters.client.kind === 'app'
        ? eq(schema.proxyLogs.clientAppId, filters.client.value)
        : eq(schema.proxyLogs.clientFamily, filters.client.value)
      : null,
    filters.siteId ? eq(schema.sites.id, filters.siteId) : null,
  ].filter((condition): condition is NonNullable<typeof condition> => condition != null);
  if (conditions.length === 1) return null;
  return exists(db.select({ value: sql<number>`1` })
    .from(schema.proxyLogs)
    .leftJoin(schema.accounts, eq(schema.proxyLogs.accountId, schema.accounts.id))
    .leftJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .where(and(...conditions)));
}

function requestWhereClause(filters: ProxyRequestLogFilters) {
  const normalizedSearch = String(filters.search || '').trim().toLowerCase();
  const searchCondition = normalizedSearch
    ? or(
      sql<boolean>`lower(coalesce(${schema.proxyRequests.requestedModel}, '')) like ${`%${normalizedSearch}%`}`,
      exists(db.select({ value: sql<number>`1` })
        .from(schema.proxyLogs)
        .leftJoin(schema.downstreamApiKeys, eq(schema.proxyLogs.downstreamApiKeyId, schema.downstreamApiKeys.id))
        .where(and(
          eq(schema.proxyLogs.requestId, schema.proxyRequests.id),
          attemptSearchCondition(normalizedSearch),
        ))),
    )
    : null;
  const statusCondition = filters.status === 'success'
    ? eq(schema.proxyRequests.status, 'success')
    : filters.status === 'failed'
      ? eq(schema.proxyRequests.status, 'failure')
      : null;
  const conditions = [
    statusCondition,
    searchCondition,
    correlatedAttemptCondition(filters),
    filters.fromUtc ? gte(schema.proxyRequests.startedAt, filters.fromUtc) : null,
    filters.toUtc ? lt(schema.proxyRequests.startedAt, filters.toUtc) : null,
  ].filter((condition): condition is NonNullable<typeof condition> => condition != null);
  return conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);
}

function attemptJoinQuery(fields: Record<string, unknown>) {
  return db.select({
    proxy_logs: fields,
    accounts: { username: schema.accounts.username },
    sites: { id: schema.sites.id, name: schema.sites.name, url: schema.sites.url },
    account_tokens: {
      id: schema.accountTokens.id,
      name: schema.accountTokens.name,
      tokenGroup: schema.accountTokens.tokenGroup,
    },
    downstream_api_keys: {
      id: schema.downstreamApiKeys.id,
      name: schema.downstreamApiKeys.name,
      groupName: schema.downstreamApiKeys.groupName,
      tags: schema.downstreamApiKeys.tags,
    },
  })
    .from(schema.proxyLogs)
    .leftJoin(schema.accounts, eq(schema.proxyLogs.accountId, schema.accounts.id))
    .leftJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .leftJoin(schema.runtimeExecutionTargets, eq(schema.proxyLogs.executionTargetId, schema.runtimeExecutionTargets.id))
    .leftJoin(schema.accountTokens, eq(schema.runtimeExecutionTargets.tokenId, schema.accountTokens.id))
    .leftJoin(schema.downstreamApiKeys, eq(schema.proxyLogs.downstreamApiKeyId, schema.downstreamApiKeys.id));
}

async function loadAttemptsByRequestIds(requestIds: string[], includeBillingDetails: boolean) {
  const grouped = new Map<string, ProxyRequestAttemptJoinedRow[]>();
  if (requestIds.length === 0) return grouped;
  const rows = await withProxyLogSelectFields(({ fields }) => attemptJoinQuery({
    ...fields,
    requestId: schema.proxyLogs.requestId,
  })
    .where(inArray(schema.proxyLogs.requestId, requestIds))
    .orderBy(schema.proxyLogs.createdAt, schema.proxyLogs.id)
    .all(), {
    includeBillingDetails,
    includeClientFields: true,
  }) as ProxyRequestAttemptJoinedRow[];
  for (const row of rows) {
    const requestId = String(row.proxy_logs.requestId || '').trim();
    if (!requestId) continue;
    const items = grouped.get(requestId) || [];
    items.push(row);
    grouped.set(requestId, items);
  }
  return grouped;
}

export async function listProxyRequestLogPage(input: ProxyRequestLogFilters & { limit: number; offset: number }) {
  const where = requestWhereClause(input);
  let rowsQuery = db.select().from(schema.proxyRequests);
  let totalQuery = db.select({ total: sql<number>`count(*)` }).from(schema.proxyRequests);
  if (where) {
    rowsQuery = rowsQuery.where(where) as typeof rowsQuery;
    totalQuery = totalQuery.where(where) as typeof totalQuery;
  }
  const [requestRows, totalRow] = await Promise.all([
    rowsQuery.orderBy(desc(schema.proxyRequests.startedAt)).limit(input.limit).offset(input.offset).all(),
    totalQuery.get(),
  ]);
  const attempts = await loadAttemptsByRequestIds(requestRows.map((row) => row.id), false);
  return {
    rows: requestRows.map((request) => ({ request, attempts: attempts.get(request.id) || [] })),
    total: Number(totalRow?.total || 0),
  };
}

export async function getProxyRequestLogDetail(requestId: string): Promise<ProxyRequestLogRecord | undefined> {
  const normalizedId = String(requestId || '').trim();
  if (!normalizedId) return undefined;
  const request = await db.select().from(schema.proxyRequests)
    .where(eq(schema.proxyRequests.id, normalizedId))
    .get();
  if (!request) return undefined;
  const attempts = await loadAttemptsByRequestIds([normalizedId], true);
  return { request, attempts: attempts.get(normalizedId) || [] };
}

export async function getProxyRequestLogMetaFacts(input: {
  summaryFilters: ProxyRequestLogFilters;
  clientOptionFilters: ProxyRequestLogFilters;
}) {
  const summaryWhere = requestWhereClause(input.summaryFilters);
  let summaryQuery = db.select({
    totalCount: sql<number>`count(*)`,
    successCount: sql<number>`coalesce(sum(case when ${schema.proxyRequests.status} = 'success' then 1 else 0 end), 0)`,
    failedCount: sql<number>`coalesce(sum(case when ${schema.proxyRequests.status} = 'failure' then 1 else 0 end), 0)`,
    totalTokensAll: sql<number>`coalesce(sum(coalesce(${schema.proxyRequests.totalTokens}, 0)), 0)`,
  }).from(schema.proxyRequests);
  let costQuery = db.select({ billingDetails: schema.proxyRequests.billingDetails }).from(schema.proxyRequests);
  if (summaryWhere) summaryQuery = summaryQuery.where(summaryWhere) as typeof summaryQuery;
  if (summaryWhere) costQuery = costQuery.where(summaryWhere) as typeof costQuery;

  const clientRequestWhere = requestWhereClause({
    ...input.clientOptionFilters,
    client: null,
  });
  let clientOptionsQuery = db.select({
    clientFamily: schema.proxyLogs.clientFamily,
    clientAppId: schema.proxyLogs.clientAppId,
    clientAppName: schema.proxyLogs.clientAppName,
  }).from(schema.proxyLogs)
    .innerJoin(schema.proxyRequests, eq(schema.proxyLogs.requestId, schema.proxyRequests.id));
  if (clientRequestWhere) clientOptionsQuery = clientOptionsQuery.where(clientRequestWhere) as typeof clientOptionsQuery;

  const [summary, costRows, clientOptions, sites] = await Promise.all([
    summaryQuery.get(),
    costQuery.all(),
    clientOptionsQuery.groupBy(
      schema.proxyLogs.clientFamily,
      schema.proxyLogs.clientAppId,
      schema.proxyLogs.clientAppName,
    ).all(),
    db.select({ id: schema.sites.id, name: schema.sites.name, status: schema.sites.status }).from(schema.sites).all(),
  ]);
  return {
    summary: {
      ...summary,
      cost: summarizeProxyBillingDetails(costRows.map((row) => row.billingDetails)),
    },
    clientOptions: clientOptions as ProxyRequestClientOptionFact[],
    sites,
  };
}
