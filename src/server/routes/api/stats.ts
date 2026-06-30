import { FastifyInstance } from "fastify";
import { db, schema } from "../../db/index.js";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { config } from "../../config.js";
import { refreshModelsForAccount } from "../../services/modelService.js";
import * as routeRefreshWorkflow from "../../services/routeRefreshWorkflow.js";
import { buildModelAnalysis } from "../../services/modelAnalysisService.js";
import {
  fetchModelPricingCatalog,
} from "../../services/modelPricingService.js";
import {
  quoteEndpointPricing,
  quoteReferencePricing,
  type PricingResolution,
} from "../../services/pricingQuoteService.js";
import { comparePricingSummaries } from "../../services/pricingComparisonService.js";
import { compileModelRouteFlow } from "../../services/routeFlowService.js";
import {
  getActiveRouteGraphSourceVersion,
  listRouteEndpointCatalog,
} from "../../services/routeGraphService.js";
import {
  buildModelsMarketplacePage,
  type ModelsMarketplaceQuery,
} from "../../services/modelsMarketplaceProjectionService.js";
import {
  clearModelsMarketplaceCache,
  readModelsMarketplaceCache,
  resetModelsMarketplaceCacheForTests,
  writeModelsMarketplaceCache,
} from "../../services/modelsMarketplaceCacheService.js";
import { matchesTokenRouteModelPattern } from "../../../shared/tokenRoutePatterns.js";
import {
  buildModelAvailabilityProbeTaskDedupeKey,
  queueModelAvailabilityProbeTask,
  type ModelAvailabilityProbeExecutionResult,
} from "../../services/modelAvailabilityProbeService.js";
import { getUpstreamModelDescriptionsCached } from "../../services/upstreamModelDescriptionService.js";
import {
  getBackgroundTask,
  getRunningTaskByDedupeKey,
  startBackgroundTask,
  waitForBackgroundTaskCompletion,
} from "../../services/backgroundTaskService.js";
import { parseCheckinRewardAmount } from "../../services/checkinRewardParser.js";
import { estimateRewardWithTodayIncomeFallback } from "../../services/todayIncomeRewardService.js";
import {
  getProxyLogBaseSelectFields,
  parseProxyLogBillingDetails,
  withProxyLogSelectFields,
} from "../../services/proxyLogStore.js";
import {
  mapRouteDecisionSnapshotToResponse,
  summarizeRouteDecisionSnapshotValue,
} from "../../services/proxyLogRouteDecisionSnapshot.js";
import {
  getProxyDebugTraceDetail,
  listProxyDebugTraces,
} from "../../services/proxyDebugTraceStore.js";
import { parseProxyLogMessageMeta } from "../../services/proxyLogMessage.js";
import { supportsDirectAccountRoutingConnection } from "../../services/accountExtraConfig.js";
import { buildModelTokenCandidatesPayload } from "../../services/modelTokenCandidateService.js";
import { ACCOUNT_TOKEN_VALUE_STATUS_READY } from "../../services/accountTokenService.js";
import {
  formatLocalDateTime,
  formatUtcSqlDateTime,
  getLocalDayRangeUtc,
  getLocalRangeStartDayKey,
  getLocalRangeStartUtc,
  parseStoredUtcDateTime,
  type StoredUtcDateTimeInput,
  toLocalDayKeyFromStoredUtc,
} from "../../services/localTimeService.js";
import { createRateLimitGuard } from "../../middleware/requestRateLimit.js";
import {
  getDashboardInsightsSnapshot,
  getDashboardSummarySnapshot,
} from "../../services/dashboardSnapshotService.js";
import { getSiteStatsSnapshot } from "../../services/siteStatsSnapshotService.js";
import {
  runUsageAggregationProjectionPass,
} from "../../services/usageAggregationService.js";

function parseBooleanFlag(raw?: string): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeDashboardView(raw?: string) {
  const normalized = (raw || "").trim().toLowerCase();
  if (normalized === "summary" || normalized === "insights") {
    return normalized;
  }
  return "full";
}

function normalizeProxyLogsView(raw?: string) {
  const normalized = (raw || "").trim().toLowerCase();
  if (normalized === "query" || normalized === "meta") {
    return normalized;
  }
  return "full";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readRecordNumber(
  record: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  if (!record) return null;
  const value = record[key];
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function roundPricingValue(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 1_000_000) / 1_000_000;
}

const limitModelTokenCandidatesRead = createRateLimitGuard({
  bucket: "models-token-candidates-read",
  max: 30,
  windowMs: 60_000,
});

type MeasuredEntryPricingAggregate = {
  inputWeightedTotal: number;
  inputWeight: number;
  outputWeightedTotal: number;
  outputWeight: number;
  sampleCount: number;
  lastMeasuredAt: string | null;
};

type MeasuredEntryPricingSummary = {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  totalCostUsd: number | null;
  inputMultiplier: number | null;
  outputMultiplier: number | null;
  totalMultiplier: number | null;
  sampleCount: number;
  lastMeasuredAt: string | null;
};

export function __resetModelsMarketplaceCacheForTests(): void {
  resetModelsMarketplaceCacheForTests();
}

function proxyCostSqlExpression() {
  return sql<number>`
    coalesce(
      ${schema.proxyLogs.estimatedCost},
      case
        when lower(coalesce(${schema.sites.platform}, 'new-api')) = 'veloera'
          then coalesce(${schema.proxyLogs.totalTokens}, 0) / 1000000.0
        else coalesce(${schema.proxyLogs.totalTokens}, 0) / 500000.0
      end
    )
  `;
}

type ProxyLogStatusFilter = "all" | "success" | "failed";
type ProxyLogClientFilter = {
  kind: "app" | "family";
  value: string;
} | null;

type ProxyLogClientOption = {
  value: string;
  label: string;
};

const PROXY_LOG_CLIENT_FAMILY_LABELS: Record<string, string> = {
  codex: "Codex",
  claude_code: "Claude Code",
  gemini_cli: "Gemini CLI",
  generic: "通用",
};

function normalizeProxyLogPageSize(raw?: string): number {
  const parsed = Number.parseInt(raw || "50", 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(100, parsed));
}

function normalizeProxyLogOffset(raw?: string): number {
  const parsed = Number.parseInt(raw || "0", 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function normalizeProxyLogStatusFilter(raw?: string): ProxyLogStatusFilter {
  const normalized = (raw || "").trim().toLowerCase();
  if (normalized === "success") return "success";
  if (normalized === "failed") return "failed";
  return "all";
}

function normalizeProxyLogSearch(raw?: string): string {
  return (raw || "").trim().toLowerCase();
}

function normalizeProxyLogSiteId(raw?: string): number | null {
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeProxyLogClientFilter(raw?: string): ProxyLogClientFilter {
  const text = (raw || "").trim();
  if (!text) return null;
  const separatorIndex = text.indexOf(":");
  if (separatorIndex <= 0) return null;
  const kind = text.slice(0, separatorIndex).trim().toLowerCase();
  const value = text
    .slice(separatorIndex + 1)
    .trim()
    .toLowerCase();
  if (!value) return null;
  if (kind === "app" || kind === "family") {
    return { kind, value };
  }
  return null;
}

function normalizeProxyLogTimeBoundary(raw?: string): string | null {
  const text = (raw || "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatUtcSqlDateTime(parsed);
}

function parseDownstreamKeyTags(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of parsed) {
      const text = String(value || "").trim();
      if (!text) continue;
      const dedupeKey = text.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      result.push(text);
    }
    return result;
  } catch {
    return [];
  }
}

function buildProxyLogSearchCondition(search: string) {
  if (!search) return null;
  const likeTerm = `%${search}%`;
  return sql<boolean>`(
    lower(coalesce(${schema.proxyLogs.modelRequested}, '')) like ${likeTerm}
    or lower(coalesce(${schema.proxyLogs.modelActual}, '')) like ${likeTerm}
    or lower(coalesce(${schema.downstreamApiKeys.name}, '')) like ${likeTerm}
    or lower(coalesce(${schema.downstreamApiKeys.groupName}, '')) like ${likeTerm}
    or lower(coalesce(${schema.downstreamApiKeys.tags}, '')) like ${likeTerm}
  )`;
}

function buildProxyLogStatusCondition(status: ProxyLogStatusFilter) {
  if (status === "success") {
    return eq(schema.proxyLogs.status, "success");
  }
  if (status === "failed") {
    return sql<boolean>`coalesce(${schema.proxyLogs.status}, '') <> 'success'`;
  }
  return null;
}

function buildProxyLogClientCondition(client: ProxyLogClientFilter) {
  if (!client) return null;
  if (client.kind === "app") {
    return eq(schema.proxyLogs.clientAppId, client.value);
  }
  return eq(schema.proxyLogs.clientFamily, client.value);
}

function buildProxyLogWhereClause(params: {
  status?: ProxyLogStatusFilter;
  search?: string;
  client?: ProxyLogClientFilter;
  siteId?: number | null;
  fromUtc?: string | null;
  toUtc?: string | null;
}) {
  const conditions = [
    params.status ? buildProxyLogStatusCondition(params.status) : null,
    params.search ? buildProxyLogSearchCondition(params.search) : null,
    params.client ? buildProxyLogClientCondition(params.client) : null,
    params.siteId ? eq(schema.sites.id, params.siteId) : null,
    params.fromUtc ? gte(schema.proxyLogs.createdAt, params.fromUtc) : null,
    params.toUtc ? lt(schema.proxyLogs.createdAt, params.toUtc) : null,
  ].filter(
    (condition): condition is NonNullable<typeof condition> =>
      condition !== null,
  );

  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : and(...conditions);
}

function toRoundedMicroNumber(value: number | null | undefined): number {
  return Math.round(Number(value || 0) * 1_000_000) / 1_000_000;
}

function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeClientConfidence(value: unknown): string | null {
  const normalized = normalizeNullableText(value)?.toLowerCase() || null;
  if (
    normalized === "exact" ||
    normalized === "heuristic" ||
    normalized === "unknown"
  ) {
    return normalized;
  }
  return null;
}

function displayProxyLogClientFamily(value: string | null): string | null {
  if (!value) return null;
  return PROXY_LOG_CLIENT_FAMILY_LABELS[value] || value;
}

function resolveProxyLogClientMeta(proxyLog: Record<string, unknown>) {
  const clientFamily =
    normalizeNullableText(proxyLog.clientFamily)?.toLowerCase() || null;
  const clientAppId =
    normalizeNullableText(proxyLog.clientAppId)?.toLowerCase() || null;
  const clientAppName = normalizeNullableText(proxyLog.clientAppName) || null;
  const clientConfidence = normalizeClientConfidence(proxyLog.clientConfidence);

  if (clientFamily || clientAppId || clientAppName || clientConfidence) {
    return {
      clientFamily,
      clientAppId,
      clientAppName,
      clientConfidence,
    };
  }

  const legacyMeta = parseProxyLogMessageMeta(
    typeof proxyLog.errorMessage === "string" ? proxyLog.errorMessage : "",
  );
  return {
    clientFamily:
      normalizeNullableText(legacyMeta.clientKind)?.toLowerCase() || null,
    clientAppId: null,
    clientAppName: null,
    clientConfidence: null,
  };
}

function normalizeProxyLogUsageSource(
  value: unknown,
): "upstream" | "self-log" | "unknown" | null {
  const normalized = normalizeNullableText(value)?.toLowerCase() || null;
  if (
    normalized === "upstream" ||
    normalized === "self-log" ||
    normalized === "unknown"
  ) {
    return normalized;
  }
  return null;
}

function buildProxyLogClientOptions(
  rows: Array<{
    clientFamily?: string | null;
    clientAppId?: string | null;
    clientAppName?: string | null;
  }>,
): ProxyLogClientOption[] {
  const appOptions = new Map<string, ProxyLogClientOption>();
  const familyOptions = new Map<string, ProxyLogClientOption>();

  for (const row of rows) {
    const clientAppId =
      normalizeNullableText(row.clientAppId)?.toLowerCase() || null;
    const clientAppName = normalizeNullableText(row.clientAppName) || null;
    const clientFamily =
      normalizeNullableText(row.clientFamily)?.toLowerCase() || null;

    if (clientAppId && clientAppName && !appOptions.has(clientAppId)) {
      appOptions.set(clientAppId, {
        value: `app:${clientAppId}`,
        label: `应用 · ${clientAppName}`,
      });
    }

    if (
      clientFamily &&
      clientFamily !== "generic" &&
      !familyOptions.has(clientFamily)
    ) {
      familyOptions.set(clientFamily, {
        value: `family:${clientFamily}`,
        label: `协议 · ${displayProxyLogClientFamily(clientFamily) || clientFamily}`,
      });
    }
  }

  return [
    ...Array.from(appOptions.values()).sort((left, right) =>
      left.label.localeCompare(right.label, "zh-CN"),
    ),
    ...Array.from(familyOptions.values()).sort((left, right) =>
      left.label.localeCompare(right.label, "zh-CN"),
    ),
  ];
}

const SITE_AVAILABILITY_BUCKET_COUNT = 24;
const SITE_AVAILABILITY_BUCKET_MS = 60 * 60 * 1000;

type SiteAvailabilitySiteRow = {
  id: number;
  name: string;
  url: string | null;
  platform: string | null;
  sortOrder: number | null;
  isPinned: boolean | null;
};

type SiteAvailabilityLogRow = {
  siteId: number | null;
  createdAt: StoredUtcDateTimeInput;
  status: string | null;
  latencyMs: number | null;
};

type SiteAvailabilityBucketAccumulator = {
  startUtc: string;
  label: string;
  totalRequests: number;
  successCount: number;
  failedCount: number;
  latencyTotalMs: number;
  latencyCount: number;
};

function roundPercent(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function buildSiteAvailabilitySummaries(
  sites: SiteAvailabilitySiteRow[],
  logs: SiteAvailabilityLogRow[],
  now = new Date(),
) {
  const endLocal = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    0,
    0,
    0,
  );
  const startLocal = new Date(
    endLocal.getTime() -
      (SITE_AVAILABILITY_BUCKET_COUNT - 1) * SITE_AVAILABILITY_BUCKET_MS,
  );
  const startMs = startLocal.getTime();
  const rangeMs = SITE_AVAILABILITY_BUCKET_COUNT * SITE_AVAILABILITY_BUCKET_MS;

  const createBucketTemplate = (): SiteAvailabilityBucketAccumulator[] =>
    Array.from({ length: SITE_AVAILABILITY_BUCKET_COUNT }, (_, index) => {
      const bucketStart = new Date(
        startMs + index * SITE_AVAILABILITY_BUCKET_MS,
      );
      return {
        startUtc: bucketStart.toISOString(),
        label: formatLocalDateTime(bucketStart),
        totalRequests: 0,
        successCount: 0,
        failedCount: 0,
        latencyTotalMs: 0,
        latencyCount: 0,
      };
    });

  const siteMap = new Map<
    number,
    {
      site: SiteAvailabilitySiteRow;
      totalRequests: number;
      successCount: number;
      failedCount: number;
      latencyTotalMs: number;
      latencyCount: number;
      buckets: SiteAvailabilityBucketAccumulator[];
    }
  >();

  for (const site of sites) {
    siteMap.set(site.id, {
      site,
      totalRequests: 0,
      successCount: 0,
      failedCount: 0,
      latencyTotalMs: 0,
      latencyCount: 0,
      buckets: createBucketTemplate(),
    });
  }

  for (const log of logs) {
    if (log.siteId == null) continue;
    const target = siteMap.get(log.siteId);
    if (!target) continue;

    const parsed = parseStoredUtcDateTime(log.createdAt);
    if (!parsed) continue;
    const timestampMs = parsed.getTime();
    const diffMs = timestampMs - startMs;
    if (diffMs < 0 || diffMs >= rangeMs) continue;

    const bucketIndex = Math.floor(diffMs / SITE_AVAILABILITY_BUCKET_MS);
    const bucket = target.buckets[bucketIndex];
    const isSuccess = (log.status || "").trim().toLowerCase() === "success";

    target.totalRequests += 1;
    bucket.totalRequests += 1;
    if (isSuccess) {
      target.successCount += 1;
      bucket.successCount += 1;
    } else {
      target.failedCount += 1;
      bucket.failedCount += 1;
    }

    const latencyMs = Number(log.latencyMs);
    if (Number.isFinite(latencyMs) && latencyMs >= 0) {
      target.latencyTotalMs += latencyMs;
      target.latencyCount += 1;
      bucket.latencyTotalMs += latencyMs;
      bucket.latencyCount += 1;
    }
  }

  return sites.map((site) => {
    const aggregate = siteMap.get(site.id)!;
    return {
      siteId: site.id,
      siteName: site.name,
      siteUrl: site.url,
      platform: site.platform,
      totalRequests: aggregate.totalRequests,
      successCount: aggregate.successCount,
      failedCount: aggregate.failedCount,
      availabilityPercent:
        aggregate.totalRequests > 0
          ? roundPercent(
              (aggregate.successCount / aggregate.totalRequests) * 100,
            )
          : null,
      averageLatencyMs:
        aggregate.latencyCount > 0
          ? Math.round(aggregate.latencyTotalMs / aggregate.latencyCount)
          : null,
      buckets: aggregate.buckets.map((bucket) => ({
        startUtc: bucket.startUtc,
        label: bucket.label,
        totalRequests: bucket.totalRequests,
        successCount: bucket.successCount,
        failedCount: bucket.failedCount,
        availabilityPercent:
          bucket.totalRequests > 0
            ? roundPercent((bucket.successCount / bucket.totalRequests) * 100)
            : null,
        averageLatencyMs:
          bucket.latencyCount > 0
            ? Math.round(bucket.latencyTotalMs / bucket.latencyCount)
            : null,
      })),
    };
  });
}

function mapProxyLogRow(
  row: {
    proxy_logs: Record<string, unknown> & {
      billingDetails?: string | null;
      routeDecisionSnapshot?: string | null;
    };
    accounts: { username?: string | null } | null;
    sites: {
      id?: number | null;
      name?: string | null;
      url?: string | null;
    } | null;
    downstream_api_keys: {
      id?: number | null;
      name?: string | null;
      groupName?: string | null;
      tags?: string | null;
    } | null;
    token_routes?: {
      id?: number | null;
      displayName?: string | null;
      displayIcon?: string | null;
      routingStrategy?: string | null;
      enabled?: boolean | number | null;
      decisionSnapshot?: string | null;
      decisionRefreshedAt?: string | null;
    } | null;
    route_endpoint_targets?: {
      id?: number | null;
      routeEndpointId?: string | null;
      accountId?: number | null;
      tokenId?: number | null;
      oauthRouteUnitId?: number | null;
      sourceModel?: string | null;
      priority?: number | null;
      weight?: number | null;
      enabled?: boolean | number | null;
      manualOverride?: boolean | number | null;
      successCount?: number | null;
      failCount?: number | null;
      totalLatencyMs?: number | null;
      totalCost?: number | null;
      lastUsedAt?: string | null;
      lastSelectedAt?: string | null;
      lastFailAt?: string | null;
      consecutiveFailCount?: number | null;
      cooldownLevel?: number | null;
      cooldownUntil?: string | null;
    } | null;
    target_account_tokens?: {
      id?: number | null;
      name?: string | null;
      tokenGroup?: string | null;
      enabled?: boolean | number | null;
      valueStatus?: string | null;
      source?: string | null;
    } | null;
  },
  options?: { includeBillingDetails?: boolean },
) {
  const clientMeta = resolveProxyLogClientMeta(row.proxy_logs);
  const legacyMeta = parseProxyLogMessageMeta(
    typeof row.proxy_logs.errorMessage === "string"
      ? row.proxy_logs.errorMessage
      : "",
  );
  const routeDecisionSnapshot = options?.includeBillingDetails
    ? mapRouteDecisionSnapshotToResponse(row.proxy_logs.routeDecisionSnapshot)
    : null;
  const currentRouteDecision = {
    source: "current" as const,
    capturedAt: null,
    requestedModel:
      typeof row.proxy_logs.modelRequested === "string"
        ? row.proxy_logs.modelRequested
        : null,
    actualModel:
      typeof row.proxy_logs.modelActual === "string"
        ? row.proxy_logs.modelActual
        : null,
    route: row.token_routes
      ? {
          id: row.token_routes.id ?? null,
          displayName: row.token_routes.displayName ?? null,
          displayIcon: row.token_routes.displayIcon ?? null,
          routingStrategy: row.token_routes.routingStrategy ?? null,
          enabled:
            row.token_routes.enabled == null
              ? null
              : Boolean(row.token_routes.enabled),
          decisionRefreshedAt:
            row.token_routes.decisionRefreshedAt ?? null,
          snapshotSummary: summarizeRouteDecisionSnapshotValue(
            row.token_routes.decisionSnapshot,
          ),
        }
      : null,
    target: row.route_endpoint_targets
      ? {
          id: row.route_endpoint_targets.id ?? null,
          routeEndpointId:
            row.route_endpoint_targets.routeEndpointId ?? null,
          accountId: row.route_endpoint_targets.accountId ?? null,
          tokenId: row.route_endpoint_targets.tokenId ?? null,
          oauthRouteUnitId:
            row.route_endpoint_targets.oauthRouteUnitId ?? null,
          sourceModel: row.route_endpoint_targets.sourceModel ?? null,
          priority: row.route_endpoint_targets.priority ?? null,
          weight: row.route_endpoint_targets.weight ?? null,
          enabled:
            row.route_endpoint_targets.enabled == null
              ? null
              : Boolean(row.route_endpoint_targets.enabled),
          manualOverride:
            row.route_endpoint_targets.manualOverride == null
              ? null
              : Boolean(row.route_endpoint_targets.manualOverride),
          successCount:
            row.route_endpoint_targets.successCount ?? null,
          failCount: row.route_endpoint_targets.failCount ?? null,
          totalLatencyMs:
            row.route_endpoint_targets.totalLatencyMs ?? null,
          totalCost: row.route_endpoint_targets.totalCost ?? null,
          lastUsedAt: row.route_endpoint_targets.lastUsedAt ?? null,
          lastSelectedAt:
            row.route_endpoint_targets.lastSelectedAt ?? null,
          lastFailAt: row.route_endpoint_targets.lastFailAt ?? null,
          consecutiveFailCount:
            row.route_endpoint_targets.consecutiveFailCount ?? null,
          cooldownLevel:
            row.route_endpoint_targets.cooldownLevel ?? null,
          cooldownUntil:
            row.route_endpoint_targets.cooldownUntil ?? null,
        }
      : null,
    token: row.target_account_tokens
      ? {
          id: row.target_account_tokens.id ?? null,
          name: row.target_account_tokens.name ?? null,
          tokenGroup: row.target_account_tokens.tokenGroup ?? null,
          enabled:
            row.target_account_tokens.enabled == null
              ? null
              : Boolean(row.target_account_tokens.enabled),
          valueStatus: row.target_account_tokens.valueStatus ?? null,
          source: row.target_account_tokens.source ?? null,
        }
      : null,
  };

  return {
    ...row.proxy_logs,
    isStream:
      row.proxy_logs.isStream == null ? null : Boolean(row.proxy_logs.isStream),
    firstByteLatencyMs:
      typeof row.proxy_logs.firstByteLatencyMs === "number"
        ? row.proxy_logs.firstByteLatencyMs
        : null,
    ...(options?.includeBillingDetails
      ? {
          billingDetails: parseProxyLogBillingDetails(
            row.proxy_logs.billingDetails,
          ),
        }
      : {}),
    clientFamily: clientMeta.clientFamily,
    clientAppId: clientMeta.clientAppId,
    clientAppName: clientMeta.clientAppName,
    clientConfidence: clientMeta.clientConfidence,
    usageSource: normalizeProxyLogUsageSource(legacyMeta.usageSource),
    username: row.accounts?.username || null,
    siteId: row.sites?.id || null,
    siteName: row.sites?.name || null,
    siteUrl: row.sites?.url || null,
    downstreamKeyId: row.downstream_api_keys?.id || null,
    downstreamKeyName: row.downstream_api_keys?.name || null,
    downstreamKeyGroupName: row.downstream_api_keys?.groupName || null,
    downstreamKeyTags: parseDownstreamKeyTags(row.downstream_api_keys?.tags),
    ...(options?.includeBillingDetails
      ? {
          routeDecision: routeDecisionSnapshot ?? currentRouteDecision,
        }
      : {}),
  };
}

function buildProxyLogModelAnalysisSelectFields() {
  return {
    createdAt: schema.proxyLogs.createdAt,
    modelActual: schema.proxyLogs.modelActual,
    modelRequested: schema.proxyLogs.modelRequested,
    status: schema.proxyLogs.status,
    latencyMs: schema.proxyLogs.latencyMs,
    totalTokens: schema.proxyLogs.totalTokens,
    estimatedCost: schema.proxyLogs.estimatedCost,
  };
}

function buildProxyLogModelPricingSelectFields() {
  return {
    createdAt: schema.proxyLogs.createdAt,
    modelActual: schema.proxyLogs.modelActual,
    modelRequested: schema.proxyLogs.modelRequested,
    status: schema.proxyLogs.status,
    billingDetails: schema.proxyLogs.billingDetails,
  };
}

function buildProxyLogSiteTrendSelectFields() {
  return {
    createdAt: schema.proxyLogs.createdAt,
    estimatedCost: schema.proxyLogs.estimatedCost,
    totalTokens: schema.proxyLogs.totalTokens,
  };
}

export async function statsRoutes(app: FastifyInstance) {
  const proxyLogBaseFields = getProxyLogBaseSelectFields();
  const proxyLogModelAnalysisFields = buildProxyLogModelAnalysisSelectFields();
  const proxyLogModelPricingFields = buildProxyLogModelPricingSelectFields();
  const proxyLogSiteTrendFields = buildProxyLogSiteTrendSelectFields();

  app.get<{ Querystring: { refresh?: string; view?: string } }>(
    "/api/stats/dashboard",
    async (request, reply) => {
      const forceRefresh = parseBooleanFlag(request.query.refresh);
      const view = normalizeDashboardView(request.query.view);
      if (view === "summary") {
        const snapshot = await getDashboardSummarySnapshot({ forceRefresh });
        reply.header("x-dashboard-summary-cache", snapshot.cacheStatus);
        return {
          generatedAt: snapshot.generatedAt,
          ...snapshot.payload,
        };
      }
      if (view === "insights") {
        const snapshot = await getDashboardInsightsSnapshot({ forceRefresh });
        reply.header("x-dashboard-insights-cache", snapshot.cacheStatus);
        return {
          generatedAt: snapshot.generatedAt,
          ...snapshot.payload,
        };
      }

      const [summary, insights] = await Promise.all([
        getDashboardSummarySnapshot({ forceRefresh }),
        getDashboardInsightsSnapshot({ forceRefresh }),
      ]);
      reply.header("x-dashboard-summary-cache", summary.cacheStatus);
      reply.header("x-dashboard-insights-cache", insights.cacheStatus);
      return {
        generatedAt: summary.generatedAt,
        ...summary.payload,
        ...insights.payload,
      };
    },
  );

  async function loadProxyLogsQueryPayload(params: {
    limit?: string;
    offset?: string;
    status?: string;
    search?: string;
    client?: string;
    siteId?: string;
    from?: string;
    to?: string;
  }) {
    const limit = normalizeProxyLogPageSize(params.limit);
    const offset = normalizeProxyLogOffset(params.offset);
    const status = normalizeProxyLogStatusFilter(params.status);
    const search = normalizeProxyLogSearch(params.search);
    const client = normalizeProxyLogClientFilter(params.client);
    const siteId = normalizeProxyLogSiteId(params.siteId);
    const fromUtc = normalizeProxyLogTimeBoundary(params.from);
    const toUtc = normalizeProxyLogTimeBoundary(params.to);
    const listWhere = buildProxyLogWhereClause({
      status,
      search,
      client,
      siteId,
      fromUtc,
      toUtc,
    });

    const listRows = (await withProxyLogSelectFields(
      ({ fields }) => {
        let query = db
          .select({
            proxy_logs: fields,
            accounts: {
              username: schema.accounts.username,
            },
            sites: {
              id: schema.sites.id,
              name: schema.sites.name,
              url: schema.sites.url,
            },
            downstream_api_keys: {
              id: schema.downstreamApiKeys.id,
              name: schema.downstreamApiKeys.name,
              groupName: schema.downstreamApiKeys.groupName,
              tags: schema.downstreamApiKeys.tags,
            },
          })
          .from(schema.proxyLogs)
          .leftJoin(
            schema.accounts,
            eq(schema.proxyLogs.accountId, schema.accounts.id),
          )
          .leftJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
          .leftJoin(
            schema.downstreamApiKeys,
            eq(
              schema.proxyLogs.downstreamApiKeyId,
              schema.downstreamApiKeys.id,
            ),
          );

        if (listWhere) {
          query = query.where(listWhere) as typeof query;
        }

        return query
          .orderBy(desc(schema.proxyLogs.createdAt))
          .limit(limit)
          .offset(offset)
          .all();
      },
      { includeBillingDetails: false },
    )) as Array<{
      proxy_logs: Record<string, unknown> & { billingDetails?: string | null };
      accounts: { username?: string | null } | null;
      sites: {
        id?: number | null;
        name?: string | null;
        url?: string | null;
      } | null;
      downstream_api_keys: {
        id?: number | null;
        name?: string | null;
        groupName?: string | null;
        tags?: string | null;
      } | null;
    }>;

    let totalQuery = db
      .select({
        total: sql<number>`count(*)`,
      })
      .from(schema.proxyLogs)
      .leftJoin(
        schema.accounts,
        eq(schema.proxyLogs.accountId, schema.accounts.id),
      )
      .leftJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
      .leftJoin(
        schema.downstreamApiKeys,
        eq(schema.proxyLogs.downstreamApiKeyId, schema.downstreamApiKeys.id),
      );
    if (listWhere) {
      totalQuery = totalQuery.where(listWhere) as typeof totalQuery;
    }
    const totalRow = await totalQuery.get();

    return {
      items: listRows.map((row) => mapProxyLogRow(row)),
      total: Number(totalRow?.total || 0),
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
    };
  }

  async function loadProxyLogsMetaPayload(params: {
    status?: string;
    search?: string;
    client?: string;
    siteId?: string;
    from?: string;
    to?: string;
  }) {
    const status = normalizeProxyLogStatusFilter(params.status);
    const search = normalizeProxyLogSearch(params.search);
    const client = normalizeProxyLogClientFilter(params.client);
    const siteId = normalizeProxyLogSiteId(params.siteId);
    const fromUtc = normalizeProxyLogTimeBoundary(params.from);
    const toUtc = normalizeProxyLogTimeBoundary(params.to);
    const summaryWhere = buildProxyLogWhereClause({
      search,
      client,
      siteId,
      fromUtc,
      toUtc,
    });
    const clientOptionsWhere = buildProxyLogWhereClause({
      status,
      search,
      siteId,
      fromUtc,
      toUtc,
    });

    const clientOptionRowsPromise = withProxyLogSelectFields(
      ({ fields, includeClientFields }) => {
        if (!includeClientFields) {
          return Promise.resolve([]);
        }

        let query = db
          .select({
            clientFamily: fields.clientFamily!,
            clientAppId: fields.clientAppId!,
            clientAppName: fields.clientAppName!,
          })
          .from(schema.proxyLogs)
          .leftJoin(
            schema.accounts,
            eq(schema.proxyLogs.accountId, schema.accounts.id),
          )
          .leftJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
          .leftJoin(
            schema.downstreamApiKeys,
            eq(
              schema.proxyLogs.downstreamApiKeyId,
              schema.downstreamApiKeys.id,
            ),
          );

        if (clientOptionsWhere) {
          query = query.where(clientOptionsWhere) as typeof query;
        }

        return query
          .groupBy(
            fields.clientFamily!,
            fields.clientAppId!,
            fields.clientAppName!,
          )
          .all();
      },
      { includeBillingDetails: false, includeClientFields: true },
    ) as Promise<
      Array<{
        clientFamily?: string | null;
        clientAppId?: string | null;
        clientAppName?: string | null;
      }>
    >;

    const [clientOptionRows, summaryRow, siteRows] = await Promise.all([
      clientOptionRowsPromise,
      (async () => {
        let summaryQuery = db
          .select({
            totalCount: sql<number>`count(*)`,
            successCount: sql<number>`coalesce(sum(case when ${schema.proxyLogs.status} = 'success' then 1 else 0 end), 0)`,
            failedCount: sql<number>`coalesce(sum(case when coalesce(${schema.proxyLogs.status}, '') <> 'success' then 1 else 0 end), 0)`,
            totalCost: sql<number>`coalesce(sum(coalesce(${schema.proxyLogs.estimatedCost}, 0)), 0)`,
            totalTokensAll: sql<number>`coalesce(sum(coalesce(${schema.proxyLogs.totalTokens}, 0)), 0)`,
          })
          .from(schema.proxyLogs)
          .leftJoin(
            schema.accounts,
            eq(schema.proxyLogs.accountId, schema.accounts.id),
          )
          .leftJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
          .leftJoin(
            schema.downstreamApiKeys,
            eq(
              schema.proxyLogs.downstreamApiKeyId,
              schema.downstreamApiKeys.id,
            ),
          );
        if (summaryWhere) {
          summaryQuery = summaryQuery.where(
            summaryWhere,
          ) as typeof summaryQuery;
        }
        return summaryQuery.get();
      })(),
      db
        .select({
          id: schema.sites.id,
          name: schema.sites.name,
          status: schema.sites.status,
        })
        .from(schema.sites)
        .all(),
    ]);

    return {
      clientOptions: buildProxyLogClientOptions(clientOptionRows),
      summary: {
        totalCount: Number(summaryRow?.totalCount || 0),
        successCount: Number(summaryRow?.successCount || 0),
        failedCount: Number(summaryRow?.failedCount || 0),
        totalCost: toRoundedMicroNumber(summaryRow?.totalCost),
        totalTokensAll: Number(summaryRow?.totalTokensAll || 0),
      },
      sites: siteRows,
    };
  }

  // Proxy logs
  app.get<{
    Querystring: {
      limit?: string;
      offset?: string;
      status?: string;
      search?: string;
      client?: string;
      siteId?: string;
      from?: string;
      to?: string;
      view?: string;
    };
  }>("/api/stats/proxy-logs", async (request, reply) => {
    const view = normalizeProxyLogsView(request.query.view);
    if (view === "query") {
      return loadProxyLogsQueryPayload(request.query);
    }
    if (view === "meta") {
      return loadProxyLogsMetaPayload(request.query);
    }
    const [queryPayload, metaPayload] = await Promise.all([
      loadProxyLogsQueryPayload(request.query),
      loadProxyLogsMetaPayload(request.query),
    ]);
    return {
      ...queryPayload,
      clientOptions: metaPayload.clientOptions,
      summary: metaPayload.summary,
      sites: metaPayload.sites,
    };
  });

  app.get<{ Params: { id: string } }>(
    "/api/stats/proxy-logs/:id",
    async (request, reply) => {
      const id = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(id) || id <= 0) {
        return reply.code(400).send({ message: "proxy log id is invalid" });
      }

      const row = (await withProxyLogSelectFields(
        ({ fields }) =>
          db
            .select({
              proxy_logs: fields,
              accounts: schema.accounts,
              sites: schema.sites,
              downstream_api_keys: {
                id: schema.downstreamApiKeys.id,
                name: schema.downstreamApiKeys.name,
                groupName: schema.downstreamApiKeys.groupName,
                tags: schema.downstreamApiKeys.tags,
              },
              token_routes: {
                id: schema.tokenRoutes.id,
                displayName: schema.tokenRoutes.displayName,
                displayIcon: schema.tokenRoutes.displayIcon,
                routingStrategy: schema.tokenRoutes.routingStrategy,
                enabled: schema.tokenRoutes.enabled,
                decisionSnapshot: schema.tokenRoutes.decisionSnapshot,
                decisionRefreshedAt: schema.tokenRoutes.decisionRefreshedAt,
              },
              route_endpoint_targets: {
                id: schema.routeEndpointTargets.id,
                routeEndpointId: schema.routeEndpointTargets.routeEndpointId,
                accountId: schema.routeEndpointTargets.accountId,
                tokenId: schema.routeEndpointTargets.tokenId,
                oauthRouteUnitId:
                  schema.routeEndpointTargets.oauthRouteUnitId,
                sourceModel: schema.routeEndpointTargets.sourceModel,
                priority: schema.routeEndpointTargets.priority,
                weight: schema.routeEndpointTargets.weight,
                enabled: schema.routeEndpointTargets.enabled,
                manualOverride: schema.routeEndpointTargets.manualOverride,
                successCount: schema.routeEndpointTargets.successCount,
                failCount: schema.routeEndpointTargets.failCount,
                totalLatencyMs: schema.routeEndpointTargets.totalLatencyMs,
                totalCost: schema.routeEndpointTargets.totalCost,
                lastUsedAt: schema.routeEndpointTargets.lastUsedAt,
                lastSelectedAt: schema.routeEndpointTargets.lastSelectedAt,
                lastFailAt: schema.routeEndpointTargets.lastFailAt,
                consecutiveFailCount:
                  schema.routeEndpointTargets.consecutiveFailCount,
                cooldownLevel: schema.routeEndpointTargets.cooldownLevel,
                cooldownUntil: schema.routeEndpointTargets.cooldownUntil,
              },
              target_account_tokens: {
                id: schema.accountTokens.id,
                name: schema.accountTokens.name,
                tokenGroup: schema.accountTokens.tokenGroup,
                enabled: schema.accountTokens.enabled,
                valueStatus: schema.accountTokens.valueStatus,
                source: schema.accountTokens.source,
              },
            })
            .from(schema.proxyLogs)
            .leftJoin(
              schema.accounts,
              eq(schema.proxyLogs.accountId, schema.accounts.id),
            )
            .leftJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
            .leftJoin(
              schema.downstreamApiKeys,
              eq(
                schema.proxyLogs.downstreamApiKeyId,
                schema.downstreamApiKeys.id,
              ),
            )
            .leftJoin(
              schema.tokenRoutes,
              eq(schema.proxyLogs.routeId, schema.tokenRoutes.id),
            )
            .leftJoin(
              schema.routeEndpointTargets,
              eq(schema.proxyLogs.targetId, schema.routeEndpointTargets.id),
            )
            .leftJoin(
              schema.accountTokens,
              eq(schema.routeEndpointTargets.tokenId, schema.accountTokens.id),
            )
            .where(eq(schema.proxyLogs.id, id))
            .get(),
        { includeBillingDetails: true, includeRouteDecisionSnapshot: true },
      )) as
        | {
            proxy_logs: Record<string, unknown> & {
              billingDetails?: string | null;
              routeDecisionSnapshot?: string | null;
            };
            accounts: { username?: string | null } | null;
            sites: {
              id?: number | null;
              name?: string | null;
              url?: string | null;
            } | null;
            downstream_api_keys: {
              id?: number | null;
              name?: string | null;
              groupName?: string | null;
              tags?: string | null;
            } | null;
            token_routes: {
              id?: number | null;
              displayName?: string | null;
              displayIcon?: string | null;
              routingStrategy?: string | null;
              enabled?: boolean | number | null;
              decisionSnapshot?: string | null;
              decisionRefreshedAt?: string | null;
            } | null;
            route_endpoint_targets: {
              id?: number | null;
              routeEndpointId?: string | null;
              accountId?: number | null;
              tokenId?: number | null;
              oauthRouteUnitId?: number | null;
              sourceModel?: string | null;
              priority?: number | null;
              weight?: number | null;
              enabled?: boolean | number | null;
              manualOverride?: boolean | number | null;
              successCount?: number | null;
              failCount?: number | null;
              totalLatencyMs?: number | null;
              totalCost?: number | null;
              lastUsedAt?: string | null;
              lastSelectedAt?: string | null;
              lastFailAt?: string | null;
              consecutiveFailCount?: number | null;
              cooldownLevel?: number | null;
              cooldownUntil?: string | null;
            } | null;
            target_account_tokens: {
              id?: number | null;
              name?: string | null;
              tokenGroup?: string | null;
              enabled?: boolean | number | null;
              valueStatus?: string | null;
              source?: string | null;
            } | null;
          }
        | undefined;

      if (!row) {
        return reply.code(404).send({ message: "proxy log not found" });
      }

      return mapProxyLogRow(row, { includeBillingDetails: true });
    },
  );

  app.get<{ Querystring: { limit?: string } }>(
    "/api/stats/proxy-debug/traces",
    async (request) => {
      const limit = normalizeProxyLogPageSize(request.query.limit);
      const items = await listProxyDebugTraces({ limit });
      return { items };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/stats/proxy-debug/traces/:id",
    async (request, reply) => {
      const id = Number.parseInt(request.params.id, 10);
      if (!Number.isFinite(id) || id <= 0) {
        return reply
          .code(400)
          .send({ message: "proxy debug trace id is invalid" });
      }

      const detail = await getProxyDebugTraceDetail(id);
      if (!detail) {
        return reply.code(404).send({ message: "proxy debug trace not found" });
      }

      return detail;
    },
  );

  // Models marketplace - refresh upstream models and aggregate.
  app.get<{ Querystring: ModelsMarketplaceQuery & { refresh?: string; includePricing?: string } }>(
    "/api/models/marketplace",
    async (request) => {
      const refreshRequested = parseBooleanFlag(request.query.refresh);
      const includePricing = parseBooleanFlag(request.query.includePricing);

      let refreshQueued = false;
      let refreshReused = false;
      let refreshJobId: string | null = null;

      if (refreshRequested) {
        clearModelsMarketplaceCache();
        const { task, reused } = startBackgroundTask(
          {
            type: "model",
            title: "刷新模型广场数据",
            dedupeKey: "refresh-models-and-rebuild-routes",
            notifyOnFailure: true,
            successMessage: (currentTask) => {
              const rebuild = (currentTask.result as any)?.rebuild;
              if (!rebuild) return "模型广场刷新已完成";
              const createdTargets = rebuild.createdTargets ?? rebuild.createdChannels ?? 0;
              const removedTargets = rebuild.removedTargets ?? rebuild.removedChannels ?? 0;
              return `模型广场刷新完成：新增路由 ${rebuild.createdRoutes ?? 0}，移除旧路由 ${rebuild.removedRoutes ?? 0}，新增目标 ${createdTargets}，移除目标 ${removedTargets}`;
            },
            failureMessage: (currentTask) =>
              `模型广场刷新失败：${currentTask.error || "unknown error"}`,
          },
          async () => routeRefreshWorkflow.refreshModelsAndRebuildRoutes(),
        );
        refreshQueued = !reused;
        refreshReused = reused;
        refreshJobId = task.id;
      }
      const runningRefreshTask = getRunningTaskByDedupeKey(
        "refresh-models-and-rebuild-routes",
      );
      if (!refreshJobId && runningRefreshTask)
        refreshJobId = runningRefreshTask.id;

      if (!refreshRequested) {
        const cachedModels = readModelsMarketplaceCache(includePricing);
        if (cachedModels) {
          return buildModelsMarketplacePage(
            cachedModels,
            request.query,
            {
              refreshRequested,
              refreshQueued,
              refreshReused,
              refreshRunning: !!runningRefreshTask,
              refreshJobId,
              includePricing,
              cacheHit: true,
            },
          );
        }
      }

      const availability = await db
        .select()
        .from(schema.tokenModelAvailability)
        .innerJoin(
          schema.accountTokens,
          eq(schema.tokenModelAvailability.tokenId, schema.accountTokens.id),
        )
        .innerJoin(
          schema.accounts,
          eq(schema.accountTokens.accountId, schema.accounts.id),
        )
        .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
        .where(
          and(
            eq(schema.tokenModelAvailability.available, true),
            eq(schema.accountTokens.enabled, true),
            eq(
              schema.accountTokens.valueStatus,
              ACCOUNT_TOKEN_VALUE_STATUS_READY,
            ),
            eq(schema.accounts.status, "active"),
            eq(schema.sites.status, "active"),
          ),
        )
        .all();
      const accountAvailability = await db
        .select()
        .from(schema.modelAvailability)
        .innerJoin(
          schema.accounts,
          eq(schema.modelAvailability.accountId, schema.accounts.id),
        )
        .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
        .where(
          and(
            eq(schema.modelAvailability.available, true),
            eq(schema.accounts.status, "active"),
            eq(schema.sites.status, "active"),
          ),
        )
        .all();

      const last7d = getLocalRangeStartUtc(7);
      const recentLogs = await db
        .select(proxyLogBaseFields)
        .from(schema.proxyLogs)
        .where(gte(schema.proxyLogs.createdAt, last7d))
        .all();
      const recentPricingLogs = await db
        .select(proxyLogModelPricingFields)
        .from(schema.proxyLogs)
        .where(gte(schema.proxyLogs.createdAt, last7d))
        .all();

      const modelLogStats: Record<
        string,
        { success: number; total: number; totalLatency: number }
      > = {};
      for (const log of recentLogs) {
        const model = log.modelActual || log.modelRequested || "";
        if (!modelLogStats[model])
          modelLogStats[model] = { success: 0, total: 0, totalLatency: 0 };
        modelLogStats[model].total++;
        if (log.status === "success") modelLogStats[model].success++;
        modelLogStats[model].totalLatency += log.latencyMs || 0;
      }
      const measuredPricingStats: Record<string, MeasuredEntryPricingAggregate> = {};
      for (const log of recentPricingLogs) {
        if (log.status !== "success") continue;
        const model = String(log.modelActual || log.modelRequested || "").trim();
        if (!model) continue;
        const billingDetails = parseProxyLogBillingDetails(log.billingDetails);
        const breakdown = isRecord(billingDetails?.breakdown) ? billingDetails.breakdown : null;
        if (!breakdown) continue;

        const inputPrice = readRecordNumber(breakdown, "inputPerMillion");
        const outputPrice = readRecordNumber(breakdown, "outputPerMillion");
        if (!Number.isFinite(inputPrice) && !Number.isFinite(outputPrice)) continue;

        const usage = isRecord(billingDetails?.usage) ? billingDetails.usage : null;
        const inputWeight = Math.max(
          1,
          readRecordNumber(usage, "billablePromptTokens")
            || readRecordNumber(usage, "promptTokens")
            || 0,
        );
        const outputWeight = Math.max(1, readRecordNumber(usage, "completionTokens") || 0);
        if (!measuredPricingStats[model]) {
          measuredPricingStats[model] = {
            inputWeightedTotal: 0,
            inputWeight: 0,
            outputWeightedTotal: 0,
            outputWeight: 0,
            sampleCount: 0,
            lastMeasuredAt: null,
          };
        }
        const aggregate = measuredPricingStats[model];
        aggregate.sampleCount += 1;
        if (inputPrice != null) {
          aggregate.inputWeightedTotal += inputPrice * inputWeight;
          aggregate.inputWeight += inputWeight;
        }
        if (outputPrice != null) {
          aggregate.outputWeightedTotal += outputPrice * outputWeight;
          aggregate.outputWeight += outputWeight;
        }
        const createdAt = typeof log.createdAt === "string" ? log.createdAt : null;
        if (createdAt && (!aggregate.lastMeasuredAt || createdAt > aggregate.lastMeasuredAt)) {
          aggregate.lastMeasuredAt = createdAt;
        }
      }

      type ModelMetadataAggregate = {
        description: string | null;
        tags: Set<string>;
        supportedEndpointTypes: Set<string>;
      };
      type MarketplacePricingSource = {
        siteId: number;
        siteName: string;
        accountId: number;
        username: string | null;
        ownerBy: string | null;
        enableGroups: string[];
        groupPricing: Record<
          string,
          {
            quotaType: number;
            inputPerMillion?: number;
            outputPerMillion?: number;
            perCallInput?: number;
            perCallOutput?: number;
            perCallTotal?: number;
          }
        >;
      };

      const modelMetadataMap = new Map<string, ModelMetadataAggregate>();
      if (includePricing) {
        const activeAccountRows = await db
          .select()
          .from(schema.accounts)
          .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
          .where(
            and(
              eq(schema.accounts.status, "active"),
              eq(schema.sites.status, "active"),
            ),
          )
          .all();

        const metadataResults = await Promise.all(
          activeAccountRows.map(async (row) => {
            const catalog = await fetchModelPricingCatalog({
              site: {
                id: row.sites.id,
                url: row.sites.url,
                platform: row.sites.platform,
                apiKey: row.sites.apiKey,
              },
              account: {
                id: row.accounts.id,
                username: row.accounts.username,
                accessToken: row.accounts.accessToken,
                apiToken: row.accounts.apiToken,
                extraConfig: row.accounts.extraConfig,
              },
              modelName: "__metadata__",
              totalTokens: 0,
            });

            return {
              account: row.accounts,
              site: row.sites,
              catalog,
            };
          }),
        );

        for (const result of metadataResults) {
          if (!result.catalog) continue;

          for (const model of result.catalog.models) {
            const key = model.modelName.toLowerCase();
            if (!modelMetadataMap.has(key)) {
              modelMetadataMap.set(key, {
                description: null,
                tags: new Set<string>(),
                supportedEndpointTypes: new Set<string>(),
              });
            }

            const aggregate = modelMetadataMap.get(key)!;
            if (!aggregate.description && model.modelDescription) {
              aggregate.description = model.modelDescription;
            }

            for (const tag of model.tags) aggregate.tags.add(tag);
            for (const endpointType of model.supportedEndpointTypes) {
              aggregate.supportedEndpointTypes.add(endpointType);
            }
          }
        }
      }

      const modelMap: Record<
        string,
        {
          name: string;
          accountsById: Map<
            number,
            {
              id: number;
              site: string;
              username: string | null;
              latency: number | null;
              unitCost: number | null;
              balance: number;
              tokens: Array<{ id: number; name: string; isDefault: boolean }>;
              credentialKeys: Set<string>;
            }
          >;
        }
      > = {};

      const ensureModelAccount = (
        modelName: string,
        account: typeof schema.accounts.$inferSelect,
        site: typeof schema.sites.$inferSelect,
        latencyMs: number | null | undefined,
      ) => {
        if (!modelMap[modelName]) {
          modelMap[modelName] = {
            name: modelName,
            accountsById: new Map(),
          };
        }

        const existingAccount = modelMap[modelName].accountsById.get(account.id);
        if (!existingAccount) {
          const nextAccount = {
            id: account.id,
            site: site.name,
            username: account.username,
            latency: latencyMs ?? null,
            unitCost: account.unitCost,
            balance: account.balance || 0,
            tokens: [] as Array<{ id: number; name: string; isDefault: boolean }>,
            credentialKeys: new Set<string>(),
          };
          modelMap[modelName].accountsById.set(account.id, nextAccount);
          return nextAccount;
        }

        if (existingAccount.latency == null) {
          existingAccount.latency = latencyMs ?? null;
        } else if (latencyMs != null) {
          existingAccount.latency = Math.min(existingAccount.latency, latencyMs);
        }
        return existingAccount;
      };

      const addManagedTokenInfo = (
        account: ReturnType<typeof ensureModelAccount>,
        token: typeof schema.accountTokens.$inferSelect,
      ) => {
        if (!account.tokens.some((item) => item.id === token.id)) {
          account.tokens.push({
            id: token.id,
            name: token.name,
            isDefault: !!token.isDefault,
          });
        }
      };

      const addManagedTokenCredential = (
        account: ReturnType<typeof ensureModelAccount>,
        token: typeof schema.accountTokens.$inferSelect,
      ) => {
        addManagedTokenInfo(account, token);
        account.credentialKeys.add(`token:${token.id}`);
      };

      const addDirectAccountCredential = (
        account: ReturnType<typeof ensureModelAccount>,
        key: string,
      ) => {
        account.credentialKeys.add(key);
      };
      const hasAccountCredentialValue = (account: {
        accessToken?: string | null;
        apiToken?: string | null;
      }) => (
        String(account.accessToken || "").trim().length > 0 ||
        String(account.apiToken || "").trim().length > 0
      );
      const readRecordValue = (value: unknown): Record<string, unknown> | null => (
        value && typeof value === "object" && !Array.isArray(value)
          ? value as Record<string, unknown>
          : null
      );

      for (const row of availability) {
        const m = row.token_model_availability;
        const t = row.account_tokens;
        const a = row.accounts;
        const s = row.sites;
        if (
          !m.available ||
          !t.enabled ||
          t.valueStatus !== ACCOUNT_TOKEN_VALUE_STATUS_READY ||
          a.status !== "active" ||
          s.status !== "active"
        )
          continue;

        const account = ensureModelAccount(m.modelName, a, s, m.latencyMs);
        addManagedTokenCredential(account, t);
      }

      for (const row of accountAvailability) {
        const m = row.model_availability;
        const a = row.accounts;
        const s = row.sites;
        if (!m.available || a.status !== "active" || s.status !== "active")
          continue;

        const account = ensureModelAccount(m.modelName, a, s, m.latencyMs);
        if (supportsDirectAccountRoutingConnection(a) || hasAccountCredentialValue(a)) {
          addDirectAccountCredential(account, `account:${a.id}`);
        }
      }

      try {
        const routeEndpointCatalog = await listRouteEndpointCatalog({ endpointKind: "route_product" });
        const publicRouteIdsByModel = new Map<string, Set<number>>();
        const addPublicModelRouteId = (modelName: string, routeIdInput: unknown) => {
          const routeId = Number(routeIdInput);
          if (!modelName || !Number.isFinite(routeId) || routeId <= 0) return;
          const normalizedRouteId = Math.trunc(routeId);
          const routeIds = publicRouteIdsByModel.get(modelName) || new Set<number>();
          routeIds.add(normalizedRouteId);
          publicRouteIdsByModel.set(modelName, routeIds);
        };
        const recordRouteIdsFromArray = (modelName: string, values: unknown) => {
          if (!Array.isArray(values)) return;
          for (const routeId of values) addPublicModelRouteId(modelName, routeId);
        };
        const publicRouteProducts = routeEndpointCatalog.filter((endpoint) => (
          endpoint.enabled !== false
          && endpoint.endpointKind === "route_product"
          && endpoint.exposure === "public"
          && endpoint.resolutionStatus !== "unresolved"
          && String(endpoint.publicModelName || endpoint.modelPattern || endpoint.label || "").trim()
        ));
        const publicSourceRouteIds = new Set<number>();
        for (const endpoint of publicRouteProducts) {
          const modelName = String(
            endpoint.publicModelName ||
            endpoint.modelPattern ||
            endpoint.label ||
            "",
          ).trim();
          for (const routeId of endpoint.sourceRouteIds || []) {
            if (Number.isFinite(Number(routeId)) && Number(routeId) > 0) {
              const normalizedRouteId = Math.trunc(Number(routeId));
              publicSourceRouteIds.add(normalizedRouteId);
              addPublicModelRouteId(modelName, normalizedRouteId);
            }
          }
        }
        const routeProductsById = new Map<string, typeof publicRouteProducts[number]>();
        for (const endpoint of publicRouteProducts) {
          routeProductsById.set(endpoint.endpointId, endpoint);
          routeProductsById.set(endpoint.nodeId, endpoint);
        }
        const collectManualMacroRouteIds = async () => {
          const activePointer = await db.select({ versionId: schema.routeGraphActiveVersion.versionId })
            .from(schema.routeGraphActiveVersion)
            .where(eq(schema.routeGraphActiveVersion.id, 1))
            .get();
          if (!activePointer?.versionId) return;
          const activeRow = await db.select({ sourceGraphJson: schema.routeGraphVersions.sourceGraphJson })
            .from(schema.routeGraphVersions)
            .where(eq(schema.routeGraphVersions.id, activePointer.versionId))
            .get();
          const sourceGraphJson = String(activeRow?.sourceGraphJson || "");
          if (!sourceGraphJson.includes('"ownership":"manual"') || !sourceGraphJson.includes('"candidate_selector"')) return;

          const activeSource = await getActiveRouteGraphSourceVersion();
          for (const macro of activeSource?.sourceGraph.macros || []) {
            const macroRecord = readRecordValue(macro);
            const config = readRecordValue(macroRecord?.config);
            const surface = readRecordValue(config?.surface);
            const entry = readRecordValue(surface?.entry);
            if (
              macroRecord?.kind !== "candidate_selector" ||
              macroRecord?.enabled === false ||
              macroRecord?.visibility !== "public" ||
              entry?.kind !== "external"
            ) continue;
            const entryMatch = readRecordValue(entry.match);
            const modelName = String(entryMatch?.requestedModelPattern || entryMatch?.displayName || "").trim();
            if (!modelName) continue;
            if (!modelMap[modelName]) {
              modelMap[modelName] = {
                name: modelName,
                accountsById: new Map(),
              };
            }
            const groups = Array.isArray(config?.groups) ? config.groups : [];
            for (const group of groups) {
              const groupRecord = readRecordValue(group);
              if (groupRecord?.enabled === false) continue;
              const input = readRecordValue(groupRecord?.input);
              if (input?.kind === "route_endpoints") {
                const endpointIds = Array.isArray(input.endpointIds) ? input.endpointIds : [];
                for (const endpointId of endpointIds) {
                  const endpoint = routeProductsById.get(String(endpointId || "").trim());
                  if (endpoint) recordRouteIdsFromArray(modelName, endpoint.sourceRouteIds);
                }
                continue;
              }
              if (input?.kind === "model_pattern") {
                const pattern = String(input.pattern || "").trim();
                if (!pattern) continue;
                for (const endpoint of publicRouteProducts) {
                  const endpointModel = String(endpoint.publicModelName || endpoint.modelPattern || endpoint.label || "").trim();
                  if (endpointModel && matchesTokenRouteModelPattern(endpointModel, pattern)) {
                    recordRouteIdsFromArray(modelName, endpoint.sourceRouteIds);
                  }
                }
              }
            }
          }
        };
        await collectManualMacroRouteIds();
        for (const routeIds of publicRouteIdsByModel.values()) {
          for (const routeId of routeIds) publicSourceRouteIds.add(routeId);
        }

        if (publicSourceRouteIds.size > 0) {
          const targetRows = await db
            .select()
            .from(schema.routeEndpointTargets)
            .innerJoin(
              schema.accounts,
              eq(schema.routeEndpointTargets.accountId, schema.accounts.id),
            )
            .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
            .leftJoin(
              schema.accountTokens,
              eq(schema.routeEndpointTargets.tokenId, schema.accountTokens.id),
            )
            .where(
              and(
                eq(schema.routeEndpointTargets.enabled, true),
                eq(schema.accounts.status, "active"),
                eq(schema.sites.status, "active"),
              ),
            )
            .all();
          const targetsByRouteId = new Map<number, typeof targetRows>();
          for (const row of targetRows) {
            const routeId = Number(row.route_endpoint_targets.routeId);
            if (!publicSourceRouteIds.has(routeId)) continue;
            const token = row.account_tokens;
            if (
              token &&
              (
                !token.enabled ||
                token.valueStatus !== ACCOUNT_TOKEN_VALUE_STATUS_READY
              )
            ) continue;
            const rows = targetsByRouteId.get(routeId) || [];
            rows.push(row);
            targetsByRouteId.set(routeId, rows);
          }

          for (const [modelName, sourceRouteIdSet] of publicRouteIdsByModel.entries()) {
            if (!modelName) continue;
            const sourceRouteIds = Array.from(sourceRouteIdSet);
            for (const routeId of sourceRouteIds) {
              for (const row of targetsByRouteId.get(routeId) || []) {
                const target = row.route_endpoint_targets;
                const account = ensureModelAccount(
                  modelName,
                  row.accounts,
                  row.sites,
                  null,
                );
                if (row.account_tokens) {
                  addManagedTokenInfo(account, row.account_tokens);
                }
                addDirectAccountCredential(account, `route-target:${target.id}`);
              }
            }
            if (!modelMap[modelName]) {
              modelMap[modelName] = {
                name: modelName,
                accountsById: new Map(),
              };
            }
          }
        }
      } catch (error) {
        console.warn("[models/marketplace] failed to include public route graph models", error);
      }

      const pricingSourcesByModel = new Map<string, MarketplacePricingSource[]>();
      if (includePricing) {
        const pricingSourceMap = new Map<string, {
          modelKey: string;
          source: MarketplacePricingSource;
        }>();
        const upsertPricingSource = (input: {
          modelName: string;
          siteId: number;
          siteName: string;
          accountId: number;
          username: string | null;
          tokenGroup: string | null;
          resolution: PricingResolution;
        }) => {
          const modelKey = input.modelName.toLowerCase();
          const group = (input.tokenGroup || 'default').trim() || 'default';
          const sourceKey = `${modelKey}:${input.siteId}:${input.accountId}`;
          const existing = pricingSourceMap.get(sourceKey);
          const source = existing?.source || {
            siteId: input.siteId,
            siteName: input.siteName,
            accountId: input.accountId,
            username: input.username,
            ownerBy: null,
            enableGroups: [],
            groupPricing: {},
          };
          if (!source.enableGroups.includes(group)) source.enableGroups.push(group);
          const summary = input.resolution.summary;
          source.groupPricing[group] = {
            quotaType: summary.requestUsd != null && summary.inputPerMillion == null && summary.outputPerMillion == null ? 1 : 0,
            ...(summary.inputPerMillion != null ? { inputPerMillion: summary.inputPerMillion } : {}),
            ...(summary.outputPerMillion != null ? { outputPerMillion: summary.outputPerMillion } : {}),
            ...(summary.requestUsd != null ? { perCallTotal: summary.requestUsd } : {}),
          };
          pricingSourceMap.set(sourceKey, { modelKey, source });
        };

        await Promise.all([
          ...availability.map(async (row) => {
            const m = row.token_model_availability;
            const t = row.account_tokens;
            const a = row.accounts;
            const s = row.sites;
            if (
              !m.available ||
              !t.enabled ||
              t.valueStatus !== ACCOUNT_TOKEN_VALUE_STATUS_READY ||
              a.status !== "active" ||
              s.status !== "active"
            ) return;

            const quote = await quoteEndpointPricing({
              supply: {
                siteId: s.id,
                accountId: a.id,
                tokenId: t.id,
                tokenGroup: t.tokenGroup,
                provider: s.platform,
                modelName: m.modelName,
              },
              usageProfile: 'preview_1m_io',
              includeReference: true,
            });
            if (!quote.endpoint) return;
            upsertPricingSource({
              modelName: m.modelName,
              siteId: s.id,
              siteName: s.name,
              accountId: a.id,
              username: a.username,
              tokenGroup: t.tokenGroup,
              resolution: quote.endpoint,
            });
          }),
          ...accountAvailability.map(async (row) => {
            const m = row.model_availability;
            const a = row.accounts;
            const s = row.sites;
            if (!m.available || a.status !== "active" || s.status !== "active") return;

            const quote = await quoteEndpointPricing({
              supply: {
                siteId: s.id,
                accountId: a.id,
                provider: s.platform,
                modelName: m.modelName,
              },
              usageProfile: 'preview_1m_io',
              includeReference: true,
            });
            if (!quote.endpoint) return;
            upsertPricingSource({
              modelName: m.modelName,
              siteId: s.id,
              siteName: s.name,
              accountId: a.id,
              username: a.username,
              tokenGroup: null,
              resolution: quote.endpoint,
            });
          }),
        ]);

        for (const { modelKey, source } of pricingSourceMap.values()) {
          if (!pricingSourcesByModel.has(modelKey)) pricingSourcesByModel.set(modelKey, []);
          pricingSourcesByModel.get(modelKey)!.push({
            ...source,
            enableGroups: source.enableGroups.sort((a, b) => a.localeCompare(b)),
          });
        }
      }

      let upstreamDescriptionMap = new Map<string, string>();
      if (includePricing) {
        const hasMissingDescription = Object.keys(modelMap).some(
          (modelName) => {
            const metadata = modelMetadataMap.get(modelName.toLowerCase());
            return !metadata?.description;
          },
        );
        if (hasMissingDescription) {
          upstreamDescriptionMap = await getUpstreamModelDescriptionsCached();
        }
      }

      const measuredEntryPricingByModel = new Map<string, MeasuredEntryPricingSummary>();
      await Promise.all(Object.entries(measuredPricingStats).map(async ([modelName, measuredPricing]) => {
        const inputPerMillion = measuredPricing.inputWeight > 0
          ? roundPricingValue(measuredPricing.inputWeightedTotal / measuredPricing.inputWeight)
          : null;
        const outputPerMillion = measuredPricing.outputWeight > 0
          ? roundPricingValue(measuredPricing.outputWeightedTotal / measuredPricing.outputWeight)
          : null;
        const totalCostUsd = inputPerMillion != null && outputPerMillion != null
          ? roundPricingValue(inputPerMillion + outputPerMillion)
          : null;
        const referenceQuote = await quoteReferencePricing({
          subject: {
            modelName,
          },
          usageProfile: 'preview_1m_io',
        });
        const reference = referenceQuote.reference?.summary ?? null;
        const comparison = comparePricingSummaries(
          { inputPerMillion, outputPerMillion, totalCostUsd },
          reference,
        );
        measuredEntryPricingByModel.set(modelName, {
          inputPerMillion,
          outputPerMillion,
          totalCostUsd,
          inputMultiplier: comparison.inputMultiplier,
          outputMultiplier: comparison.outputMultiplier,
          totalMultiplier: comparison.totalMultiplier,
          sampleCount: measuredPricing.sampleCount,
          lastMeasuredAt: measuredPricing.lastMeasuredAt,
        });
      }));

      const models = Object.values(modelMap).map((m) => {
        const logStats = modelLogStats[m.name];
        const accounts = Array.from(m.accountsById.values()).map((account) => ({
          id: account.id,
          site: account.site,
          username: account.username,
          latency: account.latency,
          unitCost: account.unitCost,
          balance: account.balance,
          tokens: account.tokens,
          managedTokenCount: account.tokens.length,
          credentialCount: account.credentialKeys.size,
        }));
        const latencyValues = accounts
          .map((account) => account.latency)
          .filter((latency): latency is number => typeof latency === "number" && Number.isFinite(latency));
        const avgLatency = latencyValues.length > 0
          ? latencyValues.reduce((sum, latency) => sum + latency, 0) / latencyValues.length
          : null;
        const metadata = modelMetadataMap.get(m.name.toLowerCase());
        const measuredPricing = measuredEntryPricingByModel.get(m.name) || null;
        const fallbackDescription = metadata?.description
          ? null
          : upstreamDescriptionMap.get(m.name.toLowerCase()) || null;
        const managedTokenCount = accounts.reduce(
          (sum, account) => sum + account.managedTokenCount,
          0,
        );
        const credentialCount = accounts.reduce(
          (sum, account) => sum + account.credentialCount,
          0,
        );
        return {
          name: m.name,
          accountCount: accounts.length,
          tokenCount: managedTokenCount,
          managedTokenCount,
          credentialCount,
          endpointCount: credentialCount,
          avgLatency: avgLatency == null ? null : Math.round(avgLatency),
          successRate: logStats
            ? Math.round((logStats.success / logStats.total) * 1000) / 10
            : null,
          description: metadata?.description || fallbackDescription,
          tags: metadata
            ? Array.from(metadata.tags).sort((a, b) => a.localeCompare(b))
            : [],
          supportedEndpointTypes: metadata
            ? Array.from(metadata.supportedEndpointTypes).sort((a, b) =>
                a.localeCompare(b),
              )
            : [],
          pricingSources: pricingSourcesByModel.get(m.name.toLowerCase()) || [],
          measuredEntryPricing: measuredPricing
            ? measuredPricing
            : null,
          accounts,
        };
      });

      models.sort((a, b) => b.accountCount - a.accountCount);
      writeModelsMarketplaceCache(includePricing, models);
      return buildModelsMarketplacePage(
        models,
        request.query,
        {
          refreshRequested,
          refreshQueued,
          refreshReused,
          refreshRunning: !!runningRefreshTask,
          refreshJobId,
          includePricing,
        },
      );
    },
  );

  app.get<{ Querystring: { model?: string } }>(
    "/api/models/route-flow",
    async (request, reply) => {
      const model = (request.query.model || "").trim();
      if (!model) {
        return reply.code(400).send({ success: false, message: "model 不能为空" });
      }

      const flow = await compileModelRouteFlow(model);
      return { success: true, flow };
    },
  );

  app.get(
    "/api/models/token-candidates",
    { preHandler: [limitModelTokenCandidatesRead] },
    async () => {
      return buildModelTokenCandidatesPayload();
    },
  );

  // Refresh models for one account and rebuild routes.
  app.post<{ Params: { accountId: string } }>(
    "/api/models/check/:accountId",
    async (request) => {
      const accountId = Number.parseInt(request.params.accountId, 10);
      if (Number.isNaN(accountId)) {
        return { success: false, error: "Invalid account id" };
      }

      const refresh = await refreshModelsForAccount(accountId);
      const rebuild = await routeRefreshWorkflow.rebuildRoutesOnly();
      return { success: true, refresh, rebuild };
    },
  );

  app.post<{ Body?: { accountId?: number; wait?: boolean } }>(
    "/api/models/probe",
    async (request, reply) => {
      const requestBody = request.body;
      if (requestBody !== undefined && !isRecord(requestBody)) {
        return reply
          .code(400)
          .send({ success: false, message: "请求体必须是对象" });
      }

      const rawAccountId = requestBody?.accountId as unknown;
      const normalizedAccountId =
        rawAccountId === undefined || rawAccountId === null
          ? ""
          : String(rawAccountId).trim();
      const hasAccountId = normalizedAccountId !== "";
      const parsedAccountId =
        hasAccountId && /^[1-9]\d*$/.test(normalizedAccountId)
          ? Number(normalizedAccountId)
          : undefined;
      const accountId =
        parsedAccountId !== undefined && Number.isSafeInteger(parsedAccountId)
          ? parsedAccountId
          : undefined;
      const wait = requestBody?.wait === true;

      if (hasAccountId && accountId === undefined) {
        return reply
          .code(400)
          .send({ success: false, message: "账号 ID 无效" });
      }

      if (wait) {
        const taskTitle = accountId
          ? `探测模型可用性 #${accountId}`
          : "探测全部模型可用性";
        const dedupeKey = buildModelAvailabilityProbeTaskDedupeKey(accountId);
        const runningTask = getRunningTaskByDedupeKey(dedupeKey);
        const { task, reused } = runningTask
          ? { task: runningTask, reused: true }
          : queueModelAvailabilityProbeTask({
              accountId,
              title: taskTitle,
            });
        const completedTask = await waitForBackgroundTaskCompletion(task.id);
        if (!completedTask) {
          return reply
            .code(500)
            .send({
              success: false,
              message: "模型可用性探测任务不存在或已过期",
            });
        }
        if (completedTask.status === "failed") {
          return reply.code(500).send({
            success: false,
            reused,
            jobId: completedTask.id,
            status: completedTask.status,
            message: completedTask.error || "模型可用性探测失败",
          });
        }
        const result =
          completedTask.result as ModelAvailabilityProbeExecutionResult | null;
        if (!result) {
          return reply.code(500).send({
            success: false,
            reused,
            jobId: completedTask.id,
            status: completedTask.status,
            message: "模型可用性探测结果为空",
          });
        }
        if (accountId && result.summary.totalAccounts === 0) {
          return reply
            .code(404)
            .send({ success: false, message: "账号不存在" });
        }
        return {
          success: true,
          reused,
          jobId: completedTask.id,
          status: completedTask.status,
          ...result,
        };
      }

      const taskTitle = accountId
        ? `探测模型可用性 #${accountId}`
        : "探测全部模型可用性";
      const { task, reused } = queueModelAvailabilityProbeTask({
        accountId,
        title: taskTitle,
      });

      return reply.code(202).send({
        success: true,
        queued: true,
        reused,
        jobId: task.id,
        status: task.status,
        message: reused
          ? "模型可用性探测任务进行中，请稍后查看任务列表"
          : "已开始模型可用性探测，请稍后查看任务列表",
      });
    },
  );

  // Site distribution – per-site aggregate data
  app.get<{ Querystring: { days?: string; refresh?: string } }>(
    "/api/stats/site-distribution",
    async (request) => {
      const snapshot = await getSiteStatsSnapshot({
        days: request.query.days ? parseInt(request.query.days, 10) : 7,
        forceRefresh: parseBooleanFlag(request.query.refresh),
      });
      return { distribution: snapshot.payload.distribution };
    },
  );

  // Site trend – daily spend/calls broken down by site
  app.get<{ Querystring: { days?: string; refresh?: string } }>(
    "/api/stats/site-trend",
    async (request) => {
      const snapshot = await getSiteStatsSnapshot({
        days: request.query.days ? parseInt(request.query.days, 10) : 7,
        forceRefresh: parseBooleanFlag(request.query.refresh),
      });
      return { trend: snapshot.payload.trend };
    },
  );

  // Model stats by site
  app.get<{ Querystring: { siteId?: string; days?: string } }>(
    "/api/stats/model-by-site",
    async (request) => {
      const siteId = request.query.siteId
        ? parseInt(request.query.siteId, 10)
        : null;
      const days = Math.max(1, parseInt(request.query.days || "7", 10));
      await runUsageAggregationProjectionPass();
      const sinceDay = getLocalRangeStartDayKey(days);
      const rows = siteId != null && Number.isFinite(siteId)
        ? await db
            .select()
            .from(schema.modelDayUsage)
            .where(
              and(
                gte(schema.modelDayUsage.localDay, sinceDay),
                eq(schema.modelDayUsage.siteId, siteId),
              ),
            )
            .all()
        : await db
            .select()
            .from(schema.modelDayUsage)
            .where(gte(schema.modelDayUsage.localDay, sinceDay))
            .all();

      const modelMap: Record<
        string,
        { calls: number; spend: number; tokens: number }
      > = {};

      for (const row of rows) {
        const model = row.model || "unknown";

        if (!modelMap[model])
          modelMap[model] = { calls: 0, spend: 0, tokens: 0 };
        modelMap[model].calls += Number(row.totalCalls || 0);
        modelMap[model].tokens += Number(row.totalTokens || 0);
        modelMap[model].spend += Number(row.totalSpend || 0);
      }

      const models = Object.entries(modelMap)
        .map(([model, stats]) => ({
          model,
          calls: stats.calls,
          spend: Math.round(stats.spend * 1_000_000) / 1_000_000,
          tokens: stats.tokens,
        }))
        .sort((a, b) => b.calls - a.calls);

      return { models };
    },
  );
}
