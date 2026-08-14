import { FastifyInstance } from "fastify";
import { config } from "../../config.js";
import { refreshModelsForAccount } from "../../services/modelService.js";
import * as routeRefreshWorkflow from "../../services/routeRefreshWorkflow.js";
import { getModelRouteFlowReadModel } from "../../services/modelRouteFlowReadModelService.js";
import {
  type ModelsMarketplaceQuery,
} from "../../services/modelsMarketplaceProjectionService.js";
import {
  getModelsMarketplaceReadModel,
} from "../../services/modelsMarketplaceReadModelService.js";
import {
  buildModelAvailabilityProbeTaskDedupeKey,
  queueModelAvailabilityProbeTask,
  type ModelAvailabilityProbeExecutionResult,
} from "../../services/modelAvailabilityProbeService.js";
import {
  getRunningTaskByDedupeKey,
  waitForBackgroundTaskCompletion,
} from "../../services/backgroundTaskService.js";
import { parseCheckinRewardAmount } from "../../services/checkinRewardParser.js";
import { estimateRewardWithTodayIncomeFallback } from "../../services/todayIncomeRewardService.js";
import { parseProxyLogBillingDetails } from "../../services/proxyLogStore.js";
import {
  mapRouteRuntimeSnapshotToResponse,
} from "../../services/routeRuntimeDecisionSnapshotService.js";
import {
  getProxyDebugTraceDetail,
  listProxyDebugTraces,
} from "../../services/proxyDebugTraceStore.js";
import { parseProxyLogMessageMeta } from "../../services/proxyLogMessage.js";
import { buildModelTokenCandidatesPayload } from "../../services/modelTokenCandidateService.js";
import {
  formatLocalDateTime,
  formatUtcSqlDateTime,
  getLocalDayRangeUtc,
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
import { listModelUsageBySite } from "../../services/modelUsageReadModelService.js";
import {
  getRouteRuntimeUsageForLog,
} from "../../services/routeRuntimeUsageService.js";
import {
  getCompiledRuntimeObservability,
  type CompiledRuntimeObservabilityRange,
} from "../../services/compiledRuntimeObservabilityService.js";
import {
  getProxyRequestLogDetail,
  getProxyRequestLogMetaFacts,
  listProxyRequestLogPage,
  type ProxyRequestAttemptJoinedRow,
  type ProxyRequestLogRecord,
} from "../../services/proxyRequestLogReadModelService.js";

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

const limitModelTokenCandidatesRead = createRateLimitGuard({
  bucket: "models-token-candidates-read",
  max: 30,
  windowMs: 60_000,
});

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

  const messageMeta = parseProxyLogMessageMeta(
    typeof proxyLog.errorMessage === "string" ? proxyLog.errorMessage : "",
  );
  return {
    clientFamily:
      normalizeNullableText(messageMeta.clientKind)?.toLowerCase() || null,
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

function mapProxyRequestAttempt(
  row: ProxyRequestAttemptJoinedRow,
  options?: { includeBillingDetails?: boolean },
) {
  const clientMeta = resolveProxyLogClientMeta(row.proxy_logs);
  const messageMeta = parseProxyLogMessageMeta(
    typeof row.proxy_logs.errorMessage === "string"
      ? row.proxy_logs.errorMessage
      : "",
  );
  const {
    runtimeArtifactId: storedRuntimeArtifactId,
    runtimeEndpointId: storedRuntimeEndpointId,
    executionTargetId: storedExecutionTargetId,
    routeEntrypointId: storedRouteEntrypointId,
    ...proxyLogFields
  } = row.proxy_logs;

  return {
    ...proxyLogFields,
    runtimeArtifactId: readNullableText(storedRuntimeArtifactId),
    runtimeEndpointId: readNullableText(storedRuntimeEndpointId),
    executionTargetId: readNullablePositiveInt(storedExecutionTargetId),
    routeEntrypointId: normalizeRuntimeEntrypointId(storedRouteEntrypointId),
    isStream:
      row.proxy_logs.isStream == null ? null : Boolean(row.proxy_logs.isStream),
    firstByteLatencyMs:
      typeof row.proxy_logs.firstByteLatencyMs === "number"
        ? row.proxy_logs.firstByteLatencyMs
        : null,
    firstTokenLatencyMs:
      typeof row.proxy_logs.firstTokenLatencyMs === "number"
        ? row.proxy_logs.firstTokenLatencyMs
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
    usageSource: normalizeProxyLogUsageSource(messageMeta.usageSource),
    username: row.accounts?.username || null,
    siteId: row.sites?.id || null,
    siteName: row.sites?.name || null,
    siteUrl: row.sites?.url || null,
    tokenId: row.account_tokens?.id || null,
    tokenName: row.account_tokens?.name || null,
    tokenGroup: row.account_tokens?.tokenGroup || null,
    downstreamKeyId: row.downstream_api_keys?.id || null,
    downstreamKeyName: row.downstream_api_keys?.name || null,
    downstreamKeyGroupName: row.downstream_api_keys?.groupName || null,
    downstreamKeyTags: parseDownstreamKeyTags(row.downstream_api_keys?.tags),
  };
}

function mapProxyRequestLogRecord(
  row: ProxyRequestLogRecord,
  options?: { includeDetails?: boolean },
) {
  const request = row.request;
  return {
    id: request.id,
    downstreamPath: request.downstreamPath,
    requestedModel: request.requestedModel,
    routeEntrypointId: request.routeEntrypointId,
    runtimeEndpointId: request.runtimeEndpointId,
    finalExecutionAttemptId: request.finalExecutionAttemptId,
    runtimeBundleHash: request.runtimeBundleHash,
    status: request.status,
    httpStatus: request.httpStatus,
    isStream: request.isStream == null ? null : Boolean(request.isStream),
    latencyMs: request.latencyMs,
    firstTokenLatencyMs: request.firstTokenLatencyMs,
    promptTokens: request.promptTokens,
    completionTokens: request.completionTokens,
    totalTokens: request.totalTokens,
    estimatedCost: request.estimatedCost,
    errorMessage: request.errorMessage,
    startedAt: request.startedAt,
    completedAt: request.completedAt,
    attempts: row.attempts.map((attempt) => mapProxyRequestAttempt(attempt, {
      includeBillingDetails: options?.includeDetails === true,
    })),
    ...(options?.includeDetails
      ? {
          billingDetails: parseProxyLogBillingDetails(request.billingDetails),
          decisionSnapshot: mapRouteRuntimeSnapshotToResponse(request.decisionSnapshot),
        }
      : {}),
  };
}

function readNullablePositiveInt(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function readNullableText(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeRuntimeEntrypointId(value: unknown): string | null {
  const text = readNullableText(value);
  if (!text) return null;
  return text;
}

function decodeModelPathParam(value: string | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw;
  }
}

export async function statsRoutes(app: FastifyInstance) {

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
    const { rows: listRows, total } = await listProxyRequestLogPage({
      limit,
      offset,
      status,
      search,
      client,
      siteId,
      fromUtc,
      toUtc,
    });

    return {
      items: listRows.map((row) => mapProxyRequestLogRecord(row)),
      total,
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
    const { clientOptions: clientOptionRows, summary: summaryRow, sites: siteRows } =
      await getProxyRequestLogMetaFacts({
        summaryFilters: { search, client, siteId, fromUtc, toUtc },
        clientOptionFilters: { status, search, siteId, fromUtc, toUtc },
      });

    return {
      clientOptions: buildProxyLogClientOptions(clientOptionRows),
      summary: {
        totalCount: Number(summaryRow?.totalCount || 0),
        successCount: Number(summaryRow?.successCount || 0),
        failedCount: Number(summaryRow?.failedCount || 0),
        cost: summaryRow.cost,
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

  app.get<{ Params: { requestId: string } }>(
    "/api/stats/proxy-logs/:requestId",
    async (request, reply) => {
      const requestId = String(request.params.requestId || "").trim();
      if (!requestId) {
        return reply.code(400).send({ message: "proxy request id is invalid" });
      }

      const row = await getProxyRequestLogDetail(requestId);

      if (!row) {
        return reply.code(404).send({ message: "proxy request not found" });
      }

      const detail = mapProxyRequestLogRecord(row, { includeDetails: true });
      const finalAttempt = detail.attempts.find((attempt) => (
        readNullableText((attempt as Record<string, unknown>).executionAttemptId) === detail.finalExecutionAttemptId
      )) || detail.attempts.at(-1) || null;
      const finalAttemptRecord = finalAttempt as Record<string, unknown> | null;
      const runtimeUsage = await getRouteRuntimeUsageForLog({
        routeEntrypointId: readNullableText(detail.routeEntrypointId),
        runtimeEndpointId: readNullableText(finalAttemptRecord?.runtimeEndpointId || detail.runtimeEndpointId),
        executionAttemptId: readNullableText(finalAttemptRecord?.executionAttemptId),
        model: readNullableText(finalAttemptRecord?.modelActual),
        siteId: readNullablePositiveInt(finalAttemptRecord?.siteId),
        accountId: readNullablePositiveInt(finalAttemptRecord?.accountId),
        createdAt: readNullableText(detail.completedAt || detail.startedAt),
      });

      return {
        ...detail,
        runtimeUsage,
      };
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

  app.get<{ Querystring: ModelsMarketplaceQuery & { refresh?: string; includePricing?: string } }>(
    "/api/models/marketplace",
    async (request) => getModelsMarketplaceReadModel({
      query: request.query,
      refreshRequested: parseBooleanFlag(request.query.refresh),
      includePricing: parseBooleanFlag(request.query.includePricing),
    }),
  );

  app.get<{ Params: { id: string }; Querystring: { forcedExecutionAttemptId?: string; view?: string } }>(
    "/api/models/:id/route-flow",
    async (request, reply) => {
      const model = decodeModelPathParam(request.params.id);
      if (!model) {
        return reply.code(400).send({ success: false, message: "model 不能为空" });
      }

      const forcedExecutionAttemptId = typeof request.query.forcedExecutionAttemptId === "string"
        ? request.query.forcedExecutionAttemptId.trim()
        : "";
      const result = request.query.view === "diagnostics"
        ? await getModelRouteFlowReadModel({
            model,
            forcedExecutionAttemptId: forcedExecutionAttemptId || null,
            view: "diagnostics",
          })
        : await getModelRouteFlowReadModel({
            model,
            forcedExecutionAttemptId: forcedExecutionAttemptId || null,
            view: "full",
          });
      reply.header('Cache-Control', 'no-store');
      return result.kind === "diagnostics"
        ? { success: true, diagnostics: result.diagnostics }
        : { success: true, flow: result.flow };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { range?: string; refresh?: string } }>(
    "/api/models/:id/runtime-observability",
    async (request, reply) => {
      const model = decodeModelPathParam(request.params.id);
      if (!model) {
        return reply.code(400).send({ success: false, message: "model 不能为空" });
      }
      const rawRange = String(request.query.range || "6h");
      const range = (rawRange === "5m" || rawRange === "15m" || rawRange === "1h" || rawRange === "6h" || rawRange === "24h" || rawRange === "7d" || rawRange === "30d"
        ? rawRange
        : "6h") as CompiledRuntimeObservabilityRange;
      const observability = await getCompiledRuntimeObservability({
        requestedModel: model,
        range,
        freshness: parseBooleanFlag(request.query.refresh) ? "sync_projection" : "cached",
      });
      return { success: true, observability };
    },
  );

  app.post<{
    Params: { id: string };
    Querystring: { forcedExecutionAttemptId?: string };
    Body?: { forcedExecutionAttemptId?: string | null; request?: unknown; pricingUsage?: unknown };
  }>(
    "/api/models/:id/route-flow",
    async (request, reply) => {
      const model = decodeModelPathParam(request.params.id);
      if (!model) {
        return reply.code(400).send({ success: false, message: "model 不能为空" });
      }

      const requestBody = request.body;
      if (requestBody !== undefined && !isRecord(requestBody)) {
        return reply.code(400).send({ success: false, message: "请求体必须是对象" });
      }
      const runtimeRequest = requestBody?.request;
      if (runtimeRequest !== undefined && runtimeRequest !== null && !isRecord(runtimeRequest)) {
        return reply.code(400).send({ success: false, message: "request 必须是对象" });
      }
      const pricingUsageBody = requestBody?.pricingUsage;
      if (pricingUsageBody !== undefined && pricingUsageBody !== null && !isRecord(pricingUsageBody)) {
        return reply.code(400).send({ success: false, message: "pricingUsage 必须是对象" });
      }
      const forcedExecutionAttemptId = typeof request.query.forcedExecutionAttemptId === "string"
        ? request.query.forcedExecutionAttemptId.trim()
        : (typeof requestBody?.forcedExecutionAttemptId === "string" ? requestBody.forcedExecutionAttemptId.trim() : "");
      const result = await getModelRouteFlowReadModel({
        model,
        forcedExecutionAttemptId: forcedExecutionAttemptId || null,
        request: isRecord(runtimeRequest) ? runtimeRequest : null,
        pricingUsage: isRecord(pricingUsageBody) ? pricingUsageBody : null,
        view: "full",
      });
      return { success: true, flow: result.flow };
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
    async (request) => await listModelUsageBySite(request.query),
  );
}
