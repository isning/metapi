import { clearAuthSession, getAuthToken } from "./authSession.js";

import { tr } from "./i18n.js";
import type { InboxActionRequest, InboxItem } from "../shared/inbox.js";
import type { RouteRuntimeSnapshot } from "../shared/routeRuntimeSnapshot.js";
import type { ModelsMarketplaceResponse } from "../shared/modelsMarketplace.js";
import type { BillingCostSummary } from "../shared/billingCost.js";
import type { ProxyBillingDetails } from "../shared/proxyBilling.js";
import type {
  ModelTesterProxyDeleteResult,
  ModelTesterProxyEnvelope,
  ModelTesterProxyJob,
  ModelTesterProxyJobCreated,
  ModelTesterProxyMethod,
  ModelTesterProxyMultipartFile,
} from "../shared/modelTesterProxy.js";
import type {
  RouteGroupCandidateCatalogPage,
  RouteGroupCandidateCreateCommand,
  RouteGroupCandidateUpdateCommand,
  RouteGroupCreateCommand,
  RouteGroupUpdateCommand,
  RouteGroupManagementFallbackStage,
  RouteGroupManagementListItem,
  RouteGroupSourceCatalogPage,
} from "../shared/routeGroupManagement.js";
import type {
  RouteGraphFocusedWorkspace,
  RouteGraphWorkspaceIndexFilters,
  RouteGraphWorkspaceIndexPage,
  RouteGraphWorkspaceRepresentation,
  RouteGraphFocusRef,
  RouteGraphWorkspaceConnectionEndpointRef,
  RouteGraphWorkspaceConnectionTargetFilters,
  RouteGraphWorkspaceConnectionTargetPage,
  RouteGraphWorkspaceRemovalImpact,
  RouteGraphWorkspaceResume,
} from "../shared/routeGraphWorkspace.js";
import type {
  RouteGraphAuthoringCommand,
  RouteGraphDraftReadResponse,
  RouteGraphDraftSaveResponse,
  RouteGraphWorkspaceConnectionCreateCommand,
  RouteGraphWorkspaceConnectionCreateResponse,
  RouteGraphWorkspaceConnectionDraftCommand,
  RouteGraphWorkspaceConnectionDraftResponse,
  RouteGraphWorkspaceMacroCreateCommand,
  RouteGraphWorkspaceMacroCreateResponse,
  RouteGraphWorkspaceNodeCreateCommand,
  RouteGraphWorkspaceNodeCreateResponse,
  RouteGraphWorkspaceNodeReservationCommand,
  RouteGraphWorkspaceNodeReservationResponse,
  RouteGraphWorkspaceOperationBatch,
  RouteGraphWorkspaceOperationBatchReplayCommand,
  RouteGraphWorkspaceOperationsCommand,
  RouteGraphWorkspaceMutationResponse,
  RouteGraphWorkspaceRemovalImpactCommand,
  RouteGraphWorkspaceRemovalImpactResponse,
  RouteGraphWorkspaceValidationResponse,
  RouteGraphValidationResponse,
} from "../shared/routeGraphOperations.js";
import type {
  DispatchPolicyDefinition,
  DispatchPolicyRegistry,
  DispatchPolicySimulationCommand,
  DispatchPolicySimulationOption,
  DispatchPolicySimulationResult,
  DispatchPolicySimulationScopeSummary,
} from "../shared/dispatchPolicyApi.js";
import { normalizePagedResponse } from "./pagedResponse.js";
export type { PageInfo, PagedResponse } from "./pagedResponse.js";
type BufferLike = {
  from(data: ArrayBuffer): { toString(encoding: "base64"): string };
};

const nodeBuffer = (globalThis as typeof globalThis & { Buffer?: BufferLike })
  .Buffer;

type RequestOptions = RequestInit & {
  timeoutMs?: number;
};

type JsonRequestOptions = Omit<RequestOptions, "body"> & {
  body: unknown;
};

const ADMIN_AUTH_FAILURE_HEADER = "x-metapi-auth-failure";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly params: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function requireAuthToken(): string {
  const token = getAuthToken(localStorage);
  if (!token) {
    const hadToken = !!localStorage.getItem("auth_token");
    clearAuthSession(localStorage);
    if (
      hadToken &&
      typeof window !== "undefined" &&
      typeof window.location?.reload === "function"
    ) {
      window.location.reload();
    }
    throw new Error("Session expired");
  }
  return token;
}

async function extractResponseErrorMessage(res: Response): Promise<string> {
  let message = `HTTP ${res.status}`;
  try {
    const text = await res.text();
    if (text) {
      try {
        const json = JSON.parse(text);
        if (json?.message && typeof json.message === "string") {
          message = json.message;
        } else if (json?.error && typeof json.error === "string") {
          message = json.error;
        } else if (
          json?.error?.message &&
          typeof json.error.message === "string"
        ) {
          message = json.error.message;
        } else {
          message = `${message}: ${text.slice(0, 120)}`;
        }
      } catch {
        message = `${message}: ${text.slice(0, 120)}`;
      }
    }
  } catch {}
  return message;
}

async function buildApiRequestError(res: Response): Promise<ApiRequestError> {
  let payload: Record<string, unknown> = {};
  let message = `HTTP ${res.status}`;
  try {
    const text = await res.text();
    if (text) {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
      const nestedError = payload.error && typeof payload.error === "object" && !Array.isArray(payload.error)
        ? payload.error as Record<string, unknown>
        : null;
      if (typeof payload.message === "string") message = payload.message;
      else if (typeof payload.error === "string") message = payload.error;
      else if (typeof nestedError?.message === "string") message = nestedError.message;
    }
  } catch {
    // Keep the HTTP status when the response is not structured JSON.
  }
  const code = typeof payload.code === "string" ? payload.code : null;
  const params = payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)
    ? payload.params as Record<string, unknown>
    : {};
  return new ApiRequestError(message, res.status, code, params);
}

function parseContentDispositionFilename(
  headerValue: string | null,
): string | null {
  if (!headerValue) return null;
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(headerValue);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const quotedMatch = /filename="([^"]+)"/i.exec(headerValue);
  if (quotedMatch?.[1]) return quotedMatch[1];
  const bareMatch = /filename=([^;]+)/i.exec(headerValue);
  return bareMatch?.[1]?.trim() || null;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  if (nodeBuffer) {
    return nodeBuffer.from(buffer).toString("base64");
  }

  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function fetchAuthenticatedResponse(
  url: string,
  options: RequestOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 30_000,
    signal: externalSignal,
    ...fetchOptions
  } = options;
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  let cleanupExternalSignal = () => {};

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      const abortHandler = () => controller.abort();
      externalSignal.addEventListener("abort", abortHandler, { once: true });
      cleanupExternalSignal = () =>
        externalSignal.removeEventListener("abort", abortHandler);
    }
  }

  const token = requireAuthToken();
  const headers = new Headers(fetchOptions.headers ?? {});
  headers.set("Authorization", `Bearer ${token}`);

  try {
    const res = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers,
    });
    if (
      (res.status === 401 || res.status === 403) &&
      res.headers.get(ADMIN_AUTH_FAILURE_HEADER) === "admin"
    ) {
      const hadToken = !!getAuthToken(localStorage);
      clearAuthSession(localStorage);
      if (
        hadToken &&
        typeof window !== "undefined" &&
        typeof window.location?.reload === "function"
      ) {
        window.location.reload();
      }
      throw new Error("Session expired");
    }
    return res;
  } catch (error: any) {
    if (error?.name === "AbortError") {
      if (externalSignal?.aborted) throw error;
      throw new Error(
        `请求超时（${Math.max(1, Math.round(timeoutMs / 1000))}s）`,
      );
    }
    throw error;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    cleanupExternalSignal();
  }
}

async function request<T = any>(
  url: string,
  options: RequestOptions = {},
): Promise<T> {
  const res = await fetchAuthenticatedResponse(url, options);
  if (!res.ok) {
    throw await buildApiRequestError(res);
  }
  return res.json() as Promise<T>;
}

function withJsonBody(options: JsonRequestOptions): RequestOptions {
  const { body, ...requestOptions } = options;
  if (body === undefined) {
    throw new TypeError("requestJson requires a defined body");
  }
  const serializedBody = JSON.stringify(body);
  if (serializedBody === undefined) {
    throw new TypeError("requestJson body must be JSON serializable");
  }
  const headers = new Headers(requestOptions.headers ?? {});
  headers.set("Content-Type", "application/json");
  return {
    ...requestOptions,
    headers,
    body: serializedBody,
  };
}

function requestJson<T = any>(
  url: string,
  options: JsonRequestOptions,
): Promise<T> {
  return request<T>(url, withJsonBody(options));
}

function fetchAuthenticatedJsonResponse(
  url: string,
  options: JsonRequestOptions,
): Promise<Response> {
  return fetchAuthenticatedResponse(url, withJsonBody(options));
}

async function streamSse(
  url: string,
  handlers: {
    onLog?: (entry: any) => void;
    onDone?: (payload: any) => void;
    signal?: AbortSignal;
  },
) {
  const response = await fetchAuthenticatedResponse(url, {
    method: "GET",
    signal: handlers.signal,
    headers: {
      Accept: "text/event-stream",
    },
    timeoutMs: 120_000,
  });

  if (!response.ok) {
    throw new Error(await extractResponseErrorMessage(response));
  }
  if (!response.body) {
    throw new Error(tr("api.responseStreamingcontent"));
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  const flushBuffer = (final = false) => {
    const chunks = final ? [...buffer.split("\n\n"), ""] : buffer.split("\n\n");
    if (!final) buffer = chunks.pop() || "";
    else buffer = "";

    for (const chunk of chunks) {
      const lines = chunk.split("\n");
      let eventName = "message";
      const dataLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim() || "message";
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trim());
        }
      }

      if (dataLines.length <= 0) continue;
      let payload: any = dataLines.join("\n");
      try {
        payload = JSON.parse(payload);
      } catch {
        // keep string payload
      }

      if (eventName === "log") {
        handlers.onLog?.(payload);
      } else if (eventName === "done") {
        handlers.onDone?.(payload);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    flushBuffer(false);
  }

  if (buffer.trim()) {
    flushBuffer(true);
  }
}

function buildQueryString(
  params?: Record<string, string | number | boolean | null | undefined>,
) {
  if (!params) return "";
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    searchParams.set(key, String(value));
  }
  const serialized = searchParams.toString();
  return serialized ? `?${serialized}` : "";
}

export type CredentialEndpointBindingSupport =
  "supported" | "unsupported" | "unknown" | "blocked";

export type CredentialEndpointMatrixProfile = {
  id: string;
  rowId: number;
  profileKey: string;
  siteId: number;
  apiType: string;
  label: string;
  requestMethod?: "POST" | "GET" | string | null;
  requestUrl?: string | null;
  defaultHeaders?: Record<string, string> | null;
  modelCatalogSourceId?: string | null;
  capabilityDefaults?: Record<string, unknown> | null;
  authMode: string;
  enabled: boolean;
  priority?: number | null;
  compatibilityPolicyRef?: string | null;
  metadata?: Record<string, unknown>;
};

export type ModelCatalogSourceSummary = {
  id: number;
  sourceKey: string;
  label: string;
  discoveryMethod: string;
  discoveryUrl: string | null;
  parser: string;
  credentialScope: string;
  enabled: boolean;
  lastRefreshAt: string | null;
  lastModelCount: number;
  lastError: string | null;
};

export type CredentialEndpointMatrixBinding = {
  id: number | null;
  apiEndpointProfileId: number;
  enabled: boolean;
  support: CredentialEndpointBindingSupport;
  source: string;
  priority: number;
  persisted: boolean;
};

export type CredentialEndpointMatrixCredential = {
  credentialKind: "account" | "account_token";
  credentialKey: string;
  accountId: number;
  tokenId: number | null;
  label: string;
  detail: string | null;
  bindings: CredentialEndpointMatrixBinding[];
};

export type CredentialEndpointMatrix = {
  siteId: number;
  profiles: CredentialEndpointMatrixProfile[];
  catalogSources: ModelCatalogSourceSummary[];
  credentials: CredentialEndpointMatrixCredential[];
};

export type ProxyTestMethod = ModelTesterProxyMethod;
export type ProxyTestMultipartFile = ModelTesterProxyMultipartFile;
export type ProxyTestRequestEnvelope = ModelTesterProxyEnvelope;

export type ModelRouteFlowRuntimeRequest = import('../shared/compiledRuntimeRequest.js').CompiledRouteRuntimeRequest;

export type ModelRouteFlowPricingUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  totalTokens?: number | null;
  requestCount?: number | null;
  imageInputUnits?: number | null;
  imageOutputUnits?: number | null;
  audioInputSeconds?: number | null;
  audioOutputSeconds?: number | null;
  videoInputSeconds?: number | null;
  storageMegabyteMonths?: number | null;
  custom?: Record<string, number | null | undefined>;
};

export type ModelRouteFlowDiagnostics = {
  requestedModel: string;
  actualModel: string | null;
  matched: boolean;
  entryId?: string | null;
  selectedEndpointId?: string | null;
  selectedAccountId?: number | null;
  diagnostics: Array<{ level: "info" | "warn" | "error"; message: string }>;
  projectedAt: string;
};

const DEFAULT_PROXY_TEST_TIMEOUT_MS = 30_000;
const LONG_RUNNING_PROXY_TEST_TIMEOUT_MS = 150_000;

function resolveProxyTestTimeoutMs(data: ProxyTestRequestEnvelope) {
  if (data.jobMode) return LONG_RUNNING_PROXY_TEST_TIMEOUT_MS;
  if (data.path === "/v1/images/generations")
    return LONG_RUNNING_PROXY_TEST_TIMEOUT_MS;
  if (data.path === "/v1/images/edits")
    return LONG_RUNNING_PROXY_TEST_TIMEOUT_MS;
  if (data.path === "/v1/videos" && data.method === "POST")
    return LONG_RUNNING_PROXY_TEST_TIMEOUT_MS;
  return DEFAULT_PROXY_TEST_TIMEOUT_MS;
}

function proxyTestRequest(data: ProxyTestRequestEnvelope) {
  return requestJson("/api/test/proxy", {
    method: "POST",
    body: data,
    timeoutMs: resolveProxyTestTimeoutMs(data),
  });
}

function routeGroupResourcePath(routeGroupId: string): string {
  return `/api/route-groups/${encodeURIComponent(routeGroupId)}`;
}

async function proxyTestStreamRequest(
  data: ProxyTestRequestEnvelope,
  signal?: AbortSignal,
) {
  return fetchAuthenticatedJsonResponse("/api/test/proxy/stream", {
    method: "POST",
    signal,
    body: data,
    timeoutMs: resolveProxyTestTimeoutMs(data),
  });
}

export type ProxyTestJobResponse = ModelTesterProxyJob;

export type SystemProxyTestRequest = {
  proxyUrl?: string;
};

export type SystemProxyTestResponse = {
  success: true;
  proxyUrl: string;
  probeUrl: string;
  finalUrl: string;
  reachable: true;
  ok: boolean;
  statusCode: number;
  latencyMs: number;
};

export type DispatchPolicyDefinitionPayload = DispatchPolicyDefinition;

export type { RouteEndpointCatalogItem as RouteGraphEndpointCatalogItemPayload } from '../shared/routeEndpointCatalog.js';

export type DispatchPolicySimulationOptionPayload = DispatchPolicySimulationOption;

export type DispatchPolicyRegistryPayload = DispatchPolicyRegistry;

export type RuntimeSettingsPayload = {
  proxyToken?: string;
  systemProxyUrl?: string;
  modelAvailabilityProbeEnabled?: boolean;
  codexUpstreamWebsocketEnabled?: boolean;
  responsesUpstreamTransportMode?: "auto" | "follow_downstream";
  responsesCompactFallbackToResponsesEnabled?: boolean;
  disableCrossProtocolFallback?: boolean;
  proxySessionTargetConcurrencyLimit?: number;
  proxySessionTargetQueueWaitMs?: number;
  proxyDebugTraceEnabled?: boolean;
  proxyDebugCaptureHeaders?: boolean;
  proxyDebugCaptureBodies?: boolean;
  proxyDebugCaptureStreamChunks?: boolean;
  proxyDebugFilterSessionId?: string;
  proxyDebugFilterClientKind?: string;
  proxyDebugFilterModel?: string;
  proxyDebugRetentionHours?: number;
  proxyDebugMaxBodyBytes?: number;
  checkinCron?: string;
  checkinScheduleMode?: "cron" | "interval";
  checkinIntervalHours?: number;
  balanceRefreshCron?: string;
  logCleanupCron?: string;
  logCleanupUsageLogsEnabled?: boolean;
  logCleanupProgramLogsEnabled?: boolean;
  logCleanupRetentionDays?: number;
  webhookUrl?: string;
  barkUrl?: string;
  webhookEnabled?: boolean;
  barkEnabled?: boolean;
  serverChanEnabled?: boolean;
  serverChanKey?: string;
  telegramEnabled?: boolean;
  telegramApiBaseUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramUseSystemProxy?: boolean;
  telegramMessageThreadId?: string;
  smtpEnabled?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  smtpTo?: string;
  notifyCooldownSec?: number;
  adminIpAllowlist?: string[] | string;
  proxyFirstByteTimeoutSec?: number;
  routeFailureCooldownMaxSec?: number;
  routeRuntimeCacheTtlMs?: number;
  dispatchPolicyRegistry?: DispatchPolicyRegistryPayload;
  proxyErrorKeywords?: string[] | string;
  proxyEmptyContentFailEnabled?: boolean;
  globalBlockedBrands?: string[];
  globalAllowedModels?: string[];
};

export type ProxyLogStatusFilter = "all" | "success" | "failed";
export type ProxyLogClientConfidence = "exact" | "heuristic" | "unknown" | null;
export type ProxyLogUsageSource = "upstream" | "self-log" | "unknown" | null;

export type ProxyLogBillingDetails = ProxyBillingDetails | null;

export type UpstreamCostPricingScope =
  "site_model" | "account_model" | "token_model";
export type UpstreamCostMatchedScope =
  UpstreamCostPricingScope | "provider_catalog" | "system_default";

export type UpstreamCostPricingRecord = {
  id: number;
  scope: UpstreamCostPricingScope;
  siteId: number;
  accountId?: number | null;
  tokenId?: number | null;
  /** Read-only compatibility field for legacy records during database upgrade. */
  tokenGroup?: string | null;
  modelName: string;
  normalizedModelName: string;
  displayName?: string | null;
  enabled: boolean;
  plan: Record<string, unknown>;
  planFingerprint: string;
  sourceType: "user" | "official" | "provider_catalog" | "system_default";
  metadata: Record<string, unknown>;
  notes?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type UpstreamCostPricingPayload = {
  scope: UpstreamCostPricingScope;
  siteId: number;
  accountId?: number | null;
  tokenId?: number | null;
  modelName: string;
  displayName?: string | null;
  enabled?: boolean;
  plan?: Record<string, unknown>;
  simpleTokenPricing?: {
    inputPerMillion?: number;
    outputPerMillion?: number;
    cacheReadPerMillion?: number;
    cacheWritePerMillion?: number;
    reasoningPerMillion?: number;
    requestCost?: number;
  };
  sourceType?: "user" | "official" | "provider_catalog" | "system_default";
  metadata?: Record<string, unknown> | null;
  notes?: string | null;
};

export type PricingReferenceConfig = {
  schemaVersion: 1;
  sync: {
    enabled: boolean;
    url: string;
    cron: string;
    replaceOnSync: boolean;
    lastSyncedAt: string | null;
    lastError: string | null;
  };
};

export type PricingReferenceCatalogEntry = {
  id: string;
  provider: string | null;
  modelName: string;
  normalizedModelName: string;
  displayName: string | null;
  aliases: string[];
  plan: Record<string, unknown>;
  planFingerprint: string;
  sourceUrl: string | null;
  sourceType: "manual" | "imported" | "remote";
  updatedAt: string;
  notes: string | null;
};

export type PricingReferenceCatalogEntryInput =
  Partial<PricingReferenceCatalogEntry> & {
    modelName: string;
    model?: string;
    modelKey?: string;
    simpleTokenPricing?: {
      inputPerMillion?: number;
      outputPerMillion?: number;
      cacheReadPerMillion?: number;
      cacheWritePerMillion?: number;
      reasoningPerMillion?: number;
      requestCost?: number;
    };
    inputPerMillion?: number;
    outputPerMillion?: number;
    cacheReadPerMillion?: number;
    cacheWritePerMillion?: number;
    reasoningPerMillion?: number;
    requestCost?: number;
  };

export type PricingReferenceCatalog = {
  schemaVersion: 1;
  entries: PricingReferenceCatalogEntry[];
  updatedAt: string | null;
};

export type PricingReferenceCatalogPayload = Omit<
  PricingReferenceCatalog,
  "entries"
> & {
  entries: Array<
    PricingReferenceCatalogEntry | PricingReferenceCatalogEntryInput
  >;
};

export type PricingReferenceCatalogImportResult = {
  catalog: PricingReferenceCatalog;
  imported: number;
  replaced: number;
};

export type PlatformPricingConfig = {
  schemaVersion: 1;
  baseCostUnit: string;
  walletDefaultValuation: {
    enabled: boolean;
    walletUnit: string | null;
    faceValuePrice: number;
    rechargeDiscount: number;
    confidence: "exact" | "estimated" | "incomplete";
  };
  upstreamDefaultPricing: {
    inputPerMillion: number;
    outputPerMillion: number;
    cacheReadPerMillion: number | null;
    cacheWritePerMillion: number | null;
    reasoningPerMillion: number | null;
    requestCost: number | null;
  };
  providerCatalogCache: {
    ttlHours: number;
  };
  driftCheck: {
    enabled: boolean;
    windowHours: number;
    minSampleSize: number;
    relativeTolerance: number;
    absoluteToleranceCost: number;
    notifyOnWarning: boolean;
  };
};

export type RuntimeObservabilityHealth = {
  status: "healthy" | "degraded" | "unavailable" | "unknown";
  successRate: number | null;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  avgLatencyMs: number | null;
  latencySamples: number;
  avgFirstTokenLatencyMs: number | null;
  firstTokenLatencySamples: number;
  avgOutputTokensPerSecond: number | null;
  outputTokens: number;
  outputTokenDurationMs: number;
  outputTokenSamples: number;
  source: string;
  window: {
    range: "5m" | "15m" | "1h" | "6h" | "24h" | "7d" | "30d";
    windowDays: number;
    fromLocalDay: string;
    toLocalDay: string;
  };
};

export type RuntimeObservabilityBucket = {
  bucketStart: string;
  bucketEnd: string;
  entry: RuntimeObservabilityHealth;
  endpoints: Array<{ endpointId: string; health: RuntimeObservabilityHealth }>;
  executionAttempts: Array<{
    executionAttemptId: string;
    health: RuntimeObservabilityHealth;
  }>;
};

export type ModelRuntimeObservability = {
  requestedModel: string;
  matched: boolean;
  entry: {
    entryId: string;
    displayName: string;
    requestedModel: string;
    actualModel: string | null;
  } | null;
  health: RuntimeObservabilityHealth;
  capabilitySummary: {
    supportedEndpointTypes: string[];
    inputModalities: string[];
    outputModalities: string[];
    capabilities: string[];
    contextLength: number | null;
    maxOutputTokens: number | null;
    source: string;
    partial: boolean;
  };
  executionAttempts: Array<{
    executionAttemptId: string;
    alternativeId: string | null;
    endpointId: string | null;
    selected: boolean;
    enabled: boolean;
    actualModel: string | null;
    target: {
      executionTargetId: number | null;
      siteId: number | null;
      siteName: string | null;
      accountId: number | null;
      accountLabel: string | null;
      tokenId: number | null;
      tokenLabel: string | null;
    } | null;
    health: RuntimeObservabilityHealth;
    apiFallbackAttemptIds: string[];
  }>;
  endpoints: Array<{
    endpointId: string;
    label: string;
    actualModel: string | null;
    endpointType: string | null;
    site: { id: number; name: string | null } | null;
    account: { id: number; label: string | null } | null;
    health: RuntimeObservabilityHealth;
    capabilitySummary: {
      supportedEndpointTypes: string[];
      inputModalities: string[];
      outputModalities: string[];
      capabilities: string[];
      contextLength: number | null;
      maxOutputTokens: number | null;
      source: string;
      partial: boolean;
    };
  }>;
  history: {
    range: "5m" | "15m" | "1h" | "6h" | "24h" | "7d" | "30d";
    buckets: RuntimeObservabilityBucket[];
    granularity: "minute" | "hour" | "day";
    emptyReason: "no_logs" | "projection_pending" | "unmatched" | null;
  };
  diagnostics: Array<{
    level: "info" | "warn" | "error";
    code: string;
    messageKey: string;
    params?: Record<string, unknown>;
  }>;
};

export type ProviderPricingCatalogRefreshTask = {
  success: true;
  queued: boolean;
  reused: boolean;
  jobId: string;
};

export type ProviderPricingCatalogScopeRefreshResult = {
  success: boolean;
  refreshed: boolean;
  status: "success" | "error";
  error: string | null;
  record: {
    siteId: number;
    accountId: number | null;
    platform: string;
    credentialKind: string | null;
    modelCount: number;
    groupCount: number;
    lastStatus: "success" | "error";
    lastError: string | null;
    fetchedAt: string;
    expiresAt: string;
  } | null;
};

export type WalletAcquisitionScope = "site" | "account" | "token";
export type WalletAcquisitionInheritance = "inherit" | "override" | "disabled";
export type DailyEarnedBalanceSource =
  "manual" | "observed_checkin" | "mixed" | "none";
export type WalletAcquisitionConfidence = "exact" | "estimated" | "incomplete";

export type WalletAcquisitionProfile = {
  id: number;
  scope: WalletAcquisitionScope;
  scopeKey: string;
  siteId: number;
  accountId: number | null;
  tokenId: number | null;
  inheritance: WalletAcquisitionInheritance;
  walletUnit: string;
  faceValuePrice: number | null;
  rechargeDiscount: number;
  dailyEarnedBalance: number | null;
  dailyEarnedBalanceSource: DailyEarnedBalanceSource;
  observedWindowDays: number | null;
  confidence: WalletAcquisitionConfidence;
  enabled: boolean;
  notes: string | null;
};

export type WalletAcquisitionProfilePayload = {
  scope: WalletAcquisitionScope;
  siteId: number;
  accountId?: number | null;
  tokenId?: number | null;
  inheritance?: WalletAcquisitionInheritance;
  walletUnit?: string | null;
  faceValuePrice?: number | null;
  rechargeDiscount?: number | null;
  dailyEarnedBalance?: number | null;
  dailyEarnedBalanceSource?: DailyEarnedBalanceSource;
  observedWindowDays?: number | null;
  confidence?: WalletAcquisitionConfidence;
  enabled?: boolean;
  notes?: string | null;
};

export type FxRateSnapshot = {
  id: number;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  source: "manual" | "provider" | "system_default";
  capturedAt: string;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type FxRateSnapshotPayload = {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  source?: FxRateSnapshot["source"];
  capturedAt?: string | null;
  notes?: string | null;
};

export type ProxyExecutionAttemptLog = {
  id: number;
  createdAt: string;
  modelRequested?: string | null;
  modelActual?: string | null;
  status: string;
  httpStatus?: number | null;
  latencyMs?: number | null;
  isStream?: boolean | null;
  firstByteLatencyMs?: number | null;
  firstTokenLatencyMs?: number | null;
  totalTokens: number | null;
  retryCount?: number | null;
  accountId?: number | null;
  siteId?: number | null;
  username?: string | null;
  siteName?: string | null;
  siteUrl?: string | null;
  errorMessage?: string | null;
  downstreamKeyId?: number | null;
  downstreamKeyName?: string | null;
  downstreamKeyGroupName?: string | null;
  downstreamKeyTags?: string[];
  clientFamily?: string | null;
  clientAppId?: string | null;
  clientAppName?: string | null;
  clientConfidence?: ProxyLogClientConfidence;
  usageSource?: ProxyLogUsageSource;
  promptTokens?: number | null;
  completionTokens?: number | null;
  estimatedCost?: number | null;
  executionAttemptId?: string | null;
  routeEntrypointId?: string | null;
  runtimeEndpointId?: string | null;
  runtimeArtifactId?: string | null;
  executionTargetId?: number | null;
  billingDetails?: ProxyLogBillingDetails;
};

export type ProxyRequestLog = {
  id: string;
  downstreamPath: string;
  requestedModel: string | null;
  routeEntrypointId: string | null;
  runtimeEndpointId: string | null;
  finalExecutionAttemptId: string | null;
  runtimeBundleHash: string | null;
  status: string;
  httpStatus: number | null;
  isStream: boolean | null;
  latencyMs: number | null;
  firstTokenLatencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  estimatedCost: number | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  attempts: ProxyExecutionAttemptLog[];
};

export type ProxyLogRuntimeUsageScope = {
  scope: "entry" | "endpoint" | "executionAttempt" | "model";
  identity: string;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  successRate: number | null;
  totalTokens: number;
  cost: BillingCostSummary;
  averageLatencyMs: number | null;
  latencyCount: number;
};

export type ProxyLogRuntimeUsageSummary = {
  windowDays: number;
  fromLocalDay: string;
  toLocalDay: string;
  entry: ProxyLogRuntimeUsageScope | null;
  endpoint: ProxyLogRuntimeUsageScope | null;
  executionAttempt: ProxyLogRuntimeUsageScope | null;
  model: ProxyLogRuntimeUsageScope | null;
  diagnostics: Record<string, never>;
};

export type ProxyRequestLogDetail = ProxyRequestLog & {
  billingDetails?: ProxyLogBillingDetails;
  runtimeUsage?: ProxyLogRuntimeUsageSummary | null;
  decisionSnapshot?: RouteRuntimeSnapshot;
};

export type ProxyLogsSummary = {
  totalCount: number;
  successCount: number;
  failedCount: number;
  cost: BillingCostSummary;
  totalTokensAll: number;
};

export type ProxyLogsQuery = {
  limit?: number;
  offset?: number;
  status?: ProxyLogStatusFilter;
  search?: string;
  client?: string;
  siteId?: number;
  from?: string;
  to?: string;
};

export type ProxyLogClientOption = {
  value: string;
  label: string;
};

export type ProxyLogsResponse = {
  items: ProxyRequestLog[];
  total: number;
  page: number;
  pageSize: number;
  clientOptions: ProxyLogClientOption[];
  summary: ProxyLogsSummary;
};

export type ProxyDebugTraceListItem = {
  id: number;
  createdAt: string;
  downstreamPath: string;
  clientKind?: string | null;
  sessionId?: string | null;
  requestedModel?: string | null;
  selectedExecutionAttemptId?: string | null;
  finalStatus?: string | null;
  finalHttpStatus?: number | null;
  finalUpstreamPath?: string | null;
};

export type ProxyDebugTraceDetail = {
  trace: {
    id: number;
    createdAt?: string | null;
    updatedAt?: string | null;
    downstreamPath?: string | null;
    clientKind?: string | null;
    sessionId?: string | null;
    traceHint?: string | null;
    requestedModel?: string | null;
    stickySessionKey?: string | null;
    stickyHitExecutionAttemptId?: string | null;
    selectedExecutionAttemptId?: string | null;
    routeEntrypointId?: string | null;
    runtimeEndpointId?: string | null;
    selectedAccountId?: number | null;
    selectedSiteId?: number | null;
    selectedSitePlatform?: string | null;
    selectedSiteDisplay?: {
      id: number;
      label?: string | null;
      platform?: string | null;
      url?: string | null;
    } | null;
    runtimeTraceJson?: string | null;
    requestHeadersJson?: string | null;
    requestBodyJson?: string | null;
    finalStatus?: string | null;
    finalHttpStatus?: number | null;
    finalUpstreamPath?: string | null;
    finalResponseHeadersJson?: string | null;
    finalResponseBodyJson?: string | null;
  };
  attempts: Array<{
    id: number;
    attemptIndex: number;
    endpoint: string;
    requestPath: string;
    targetUrl: string;
    runtimeExecutor?: string | null;
    requestHeadersJson?: string | null;
    requestBodyJson?: string | null;
    responseStatus?: number | null;
    responseHeadersJson?: string | null;
    responseBodyJson?: string | null;
    rawErrorText?: string | null;
    recoverApplied?: boolean | null;
    downgradeDecision?: boolean | null;
    downgradeReason?: string | null;
    fallbackScope?: string | null;
    failureClass?: string | null;
    memoryWriteJson?: string | null;
    createdAt?: string | null;
  }>;
};

export type ProxyDebugTracesResponse = {
  items: ProxyDebugTraceListItem[];
};

export type OAuthProviderInfo = {
  provider: string;
  label: string;
  platform: string;
  enabled: boolean;
  loginType: "oauth";
  requiresProjectId: boolean;
  supportsDirectAccountRouting: boolean;
  supportsCloudValidation: boolean;
  supportsNativeProxy: boolean;
};

export type OAuthProvidersResponse = {
  providers: OAuthProviderInfo[];
  defaults?: {
    systemProxyConfigured?: boolean;
  };
};

export type OAuthRouteUnitStrategy = "round_robin" | "stick_until_unavailable";

export type OAuthRouteUnitSummary = {
  id?: number;
  routeUnitId?: number;
  name: string;
  strategy: OAuthRouteUnitStrategy;
  memberCount: number;
};

export type OAuthRouteParticipation =
  | {
      kind: "single";
    }
  | ({
      kind: "route_unit";
    } & OAuthRouteUnitSummary);

export type OAuthStartInstructions = {
  redirectUri: string;
  callbackPort: number;
  callbackPath: string;
  manualCallbackDelayMs: number;
  sshTunnelCommand?: string;
  sshTunnelKeyCommand?: string;
};

export type OAuthStartResponse = {
  provider: string;
  state: string;
  authorizationUrl: string;
  instructions: OAuthStartInstructions;
};

export type OAuthSessionInfo = {
  provider: string;
  state: string;
  status: "pending" | "success" | "error";
  accountId?: number;
  siteId?: number;
  error?: string;
};

export type OAuthQuotaWindowInfo = {
  supported: boolean;
  limit?: number | null;
  used?: number | null;
  remaining?: number | null;
  resetAt?: string | null;
  message?: string | null;
};

export type OAuthQuotaInfo = {
  status: "supported" | "unsupported" | "error";
  source: "official" | "reverse_engineered";
  lastSyncAt?: string | null;
  lastError?: string | null;
  providerMessage?: string | null;
  subscription?: {
    planType?: string | null;
    activeStart?: string | null;
    activeUntil?: string | null;
  } | null;
  windows: {
    fiveHour: OAuthQuotaWindowInfo;
    sevenDay: OAuthQuotaWindowInfo;
  };
  lastLimitResetAt?: string | null;
};

export type OAuthConnectionInfo = {
  accountId: number;
  siteId: number;
  provider: string;
  username?: string | null;
  email?: string | null;
  accountKey?: string | null;
  planType?: string | null;
  projectId?: string | null;
  modelCount: number;
  modelsPreview: string[];
  status: "healthy" | "abnormal";
  quota?: OAuthQuotaInfo | null;
  routeChannelCount?: number;
  lastModelSyncAt?: string | null;
  lastModelSyncError?: string | null;
  proxyUrl?: string | null;
  useSystemProxy?: boolean;
  routeUnit?: OAuthRouteUnitSummary | null;
  routeParticipation?: OAuthRouteParticipation | null;
  site?: { id: number; name: string; url: string; platform: string } | null;
};

export type OAuthConnectionsResponse = {
  items: OAuthConnectionInfo[];
  total: number;
  limit: number;
  offset: number;
};

export type OAuthQuotaBatchRefreshResponse = {
  success: boolean;
  refreshed: number;
  failed: number;
  items: Array<{
    accountId: number;
    success: boolean;
    quota?: OAuthQuotaInfo;
    error?: string;
  }>;
};

export type OAuthImportResponse = {
  success: boolean;
  imported: number;
  skipped: number;
  failed: number;
  items: Array<{
    name: string;
    status: "imported" | "skipped" | "failed";
    accountId?: number;
    provider?: string;
    message?: string;
  }>;
};

export type OAuthRouteUnitMutationResponse = {
  success: boolean;
  routeUnit?: OAuthRouteUnitSummary;
};

export type DownstreamApiKeyTrendBucket = {
  startUtc: string | null;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  successRate: number | null;
  totalTokens: number;
  cost: import('../shared/billingCost.js').BaseCostSummary;
};

export type DownstreamApiKeyTrendResponse = {
  success: boolean;
  range: "24h" | "7d" | "all";
  item: {
    id: number;
    name: string;
  };
  bucketSeconds: number;
  timeZone?: string | null;
  buckets: DownstreamApiKeyTrendBucket[];
};

export const api = {
  validateDispatchPolicy: (policy: DispatchPolicyDefinitionPayload) =>
    requestJson("/api/dispatch-policies/validate", {
      method: "POST",
      body: { policy },
    }) as Promise<{ success: boolean; errors: string[] }>,
  simulateDispatchPolicy: (input: DispatchPolicySimulationCommand) =>
    requestJson("/api/dispatch-policies/simulate", {
      method: "POST",
      body: input,
    }) as Promise<{
      success: boolean;
      scopes?: DispatchPolicySimulationScopeSummary[];
      selectorId?: string;
      simulation?: DispatchPolicySimulationResult;
    }>,
  // Sites
  getSites: () => request("/api/sites"),
  addSite: (data: any) =>
    requestJson("/api/sites", { method: "POST", body: data }),
  updateSite: (id: number, data: any) =>
    requestJson(`/api/sites/${id}`, { method: "PUT", body: data }),
  deleteSite: (id: number) => request(`/api/sites/${id}`, { method: "DELETE" }),
  batchUpdateSites: (data: any) =>
    requestJson("/api/sites/batch", { method: "POST", body: data }),
  detectSite: (url: string) =>
    requestJson("/api/sites/detect", {
      method: "POST",
      body: { url },
    }),
  getSiteDisabledModels: (siteId: number) =>
    request(`/api/sites/${siteId}/disabled-models`),
  updateSiteDisabledModels: (siteId: number, models: string[]) =>
    requestJson(`/api/sites/${siteId}/disabled-models`, {
      method: "PUT",
      body: { models },
    }),
  getSiteEndpointBindings: (siteId: number) =>
    request<CredentialEndpointMatrix>(`/api/sites/${siteId}/endpoint-bindings`),
  updateSiteEndpointProfiles: (
    siteId: number,
    profiles: Array<{
      id: number;
      label?: string;
      requestMethod?: "POST" | "GET";
      requestUrl?: string | null;
      defaultHeaders?: Record<string, string> | null;
      modelCatalogSourceId?: number | null;
      capabilityDefaults?: Record<string, unknown> | null;
      enabled?: boolean;
      priority?: number;
    }>,
  ) =>
    requestJson<CredentialEndpointMatrix>(
      `/api/sites/${siteId}/endpoint-profiles`,
      {
        method: "PUT",
        body: { profiles },
      },
    ),
  updateSiteEndpointBindings: (
    siteId: number,
    credentialKey: string,
    bindings: Array<{
      apiEndpointProfileId: number;
      enabled: boolean;
      support: CredentialEndpointBindingSupport;
      priority?: number;
    }>,
  ) =>
    requestJson<CredentialEndpointMatrix>(
      `/api/sites/${siteId}/endpoint-bindings/${encodeURIComponent(credentialKey)}`,
      {
        method: "PUT",
        body: { bindings },
      },
    ),
  getSiteAvailableModels: (siteId: number) =>
    request(`/api/sites/${siteId}/available-models`),
  probeSiteNow: (
    siteId: number,
    options?: {
      scope?: "single" | "all";
      modelName?: string;
      latencyThresholdMs?: number;
    },
  ) =>
    requestJson(`/api/sites/${siteId}/probe-now`, {
      method: "POST",
      body: options || {},
      timeoutMs: options?.scope === "all" ? 120_000 : 30_000,
    }),

  // Accounts
  getAccounts: async (params?: { includeOauth?: boolean }) => {
    const result = await request<any>(
      `/api/accounts${buildQueryString(params)}`,
    );
    return Array.isArray(result?.accounts) ? result.accounts : result;
  },
  getAccountsSnapshot: (options?: { refresh?: boolean }) =>
    request(
      `/api/accounts${buildQueryString(options?.refresh ? { refresh: 1 } : undefined)}`,
    ) as Promise<{
      generatedAt: string;
      accounts: any[];
      sites: any[];
    }>,
  addAccount: (data: any) =>
    requestJson("/api/accounts", { method: "POST", body: data }),
  loginAccount: (data: {
    siteId: number;
    username: string;
    password: string;
  }) =>
    requestJson("/api/accounts/login", {
      method: "POST",
      body: data,
    }),
  verifyToken: (data: {
    siteId: number;
    accessToken: string;
    platformUserId?: number;
    credentialMode?: "auto" | "session" | "apikey";
  }) =>
    requestJson("/api/accounts/verify-token", {
      method: "POST",
      body: data,
    }),
  rebindAccountSession: (
    id: number,
    data: {
      accessToken: string;
      platformUserId?: number;
      refreshToken?: string;
      tokenExpiresAt?: number;
    },
  ) =>
    requestJson(`/api/accounts/${id}/rebind-session`, {
      method: "POST",
      body: data,
    }),
  updateAccount: (id: number, data: any) =>
    requestJson(`/api/accounts/${id}`, {
      method: "PUT",
      body: data,
    }),
  deleteAccount: (id: number) =>
    request(`/api/accounts/${id}`, { method: "DELETE" }),
  batchUpdateAccounts: (data: any) =>
    requestJson("/api/accounts/batch", {
      method: "POST",
      body: data,
    }),
  refreshBalance: (id: number) =>
    requestJson(`/api/accounts/${id}/balance`, { method: "POST", body: {} }),
  getAccountModels: (id: number) => request(`/api/accounts/${id}/models`),
  addAccountAvailableModels: (accountId: number, models: string[]) =>
    requestJson(`/api/accounts/${accountId}/models/manual`, {
      method: "POST",
      body: { models },
    }),
  refreshAccountHealth: (data?: { accountId?: number; wait?: boolean }) =>
    requestJson("/api/accounts/health/refresh", {
      method: "POST",
      body: data || {},
      timeoutMs: data?.wait ? 150_000 : 30_000,
    }),

  // Account tokens
  getAccountTokens: (accountId?: number) =>
    request(`/api/account-tokens${accountId ? `?accountId=${accountId}` : ""}`),
  getAccountTokenModels: (id: number) => request<{
    token: { id: number; accountId: number; name: string; tokenGroup?: string | null; enabled?: boolean; isDefault?: boolean };
    account: { id: number; username?: string | null };
    site: { id: number; name: string };
    observed: boolean;
    modelDetails: Array<{ name: string; available: boolean; latencyMs: number | null; checkedAt: string | null; disabled: boolean }>;
    models: string[];
  }>(`/api/account-tokens/${id}/models`),
  refreshAccountTokenModels: (id: number) => requestJson<{
    success: boolean;
    models: {
      token: { id: number; accountId: number; name: string; tokenGroup?: string | null; enabled?: boolean; isDefault?: boolean };
      account: { id: number; username?: string | null };
      site: { id: number; name: string };
      observed: boolean;
      modelDetails: Array<{ name: string; available: boolean; latencyMs: number | null; checkedAt: string | null; disabled: boolean }>;
      models: string[];
    };
  }>(`/api/account-tokens/${id}/models/refresh`, { method: 'POST', body: {} }),
  updateAccountTokenDisabledModels: (id: number, models: string[]) =>
    requestJson(`/api/account-tokens/${id}/models/disabled`, { method: 'PUT', body: { models } }),
  addAccountTokenAvailableModels: (id: number, models: string[]) =>
    requestJson(`/api/account-tokens/${id}/models/manual`, { method: 'POST', body: { models } }),
  addAccountToken: (data: any) =>
    requestJson("/api/account-tokens", {
      method: "POST",
      body: data,
    }),
  updateAccountToken: (id: number, data: any) =>
    requestJson(`/api/account-tokens/${id}`, {
      method: "PUT",
      body: data,
    }),
  deleteAccountToken: (id: number) =>
    request(`/api/account-tokens/${id}`, { method: "DELETE" }),
  batchUpdateAccountTokens: (data: any) =>
    requestJson("/api/account-tokens/batch", {
      method: "POST",
      body: data,
    }),
  getAccountTokenGroups: (accountId: number) =>
    request(`/api/account-tokens/groups/${accountId}`),
  setDefaultAccountToken: (id: number) =>
    requestJson(`/api/account-tokens/${id}/default`, { method: "POST", body: {} }),
  getAccountTokenValue: (id: number) =>
    request(`/api/account-tokens/${id}/value`),
  syncAccountTokens: (accountId: number) =>
    requestJson(`/api/account-tokens/sync/${accountId}`, {
      method: "POST",
      body: {},
      timeoutMs: 45_000,
    }),
  syncAllAccountTokens: (wait = false) =>
    requestJson("/api/account-tokens/sync-all", {
      method: "POST",
      body: wait ? { wait: true } : {},
      timeoutMs: wait ? 150_000 : 30_000,
    }),

  // Check-in
  triggerCheckinAll: () => requestJson("/api/checkin/trigger", {
    method: "POST",
    body: {},
  }),
  triggerCheckin: (id: number) =>
    requestJson(`/api/checkin/trigger/${id}`, {
      method: "POST",
      body: {},
    }),
  getCheckinLogs: (params?: string) =>
    request(`/api/checkin/logs${params ? "?" + params : ""}`),
  updateCheckinSchedule: (cron: string) =>
    requestJson("/api/checkin/schedule", {
      method: "PUT",
      body: { cron },
    }),

  // Routes
  getRouteGraphActive: (options?: {
    include?: "summary" | "source" | "compiled" | "full";
  }) => {
    const include =
      options?.include && options.include !== "summary"
        ? `?include=${encodeURIComponent(options.include)}`
        : "";
    return request(`/api/route-graph/active${include}`);
  },
  getRouteGraphDraft: (transport: Pick<RequestOptions, "signal"> = {}) =>
    request<RouteGraphDraftReadResponse>("/api/route-graph/draft", transport),
  getRouteGraphWorkspaceIndex: (
    options: RouteGraphWorkspaceIndexFilters = {},
    transport: Pick<RequestOptions, "signal"> = {},
  ) =>
    request<RouteGraphWorkspaceIndexPage>(
      `/api/route-graph/workspace-index${buildQueryString({
        cursor: options.cursor,
        limit: options.limit,
        q: options.query,
        elementKind: options.elementKind,
        ownership: options.ownership,
        diagnosticState: options.diagnosticState,
      })}`,
      transport,
    ),
  getRouteGraphWorkspaceResume: () => request<RouteGraphWorkspaceResume>('/api/route-graph/workspace/resume'),
  getRouteGraphFocusedWorkspace: (
    options: {
      focus: RouteGraphFocusRef;
      representation?: RouteGraphWorkspaceRepresentation;
      windowToken?: string;
    },
    transport: Pick<RequestOptions, "signal"> = {},
  ) =>
    request<RouteGraphFocusedWorkspace>(
      `/api/route-graph/workspace${buildQueryString({
        focusKind: options.focus.kind,
        focusId: options.focus.id,
        representation: options.representation || "semantic",
        windowToken: options.windowToken,
      })}`,
      transport,
    ),
  getRouteGraphWorkspaceConnectionTargets: (
    options: RouteGraphWorkspaceConnectionTargetFilters,
    transport: Pick<RequestOptions, "signal"> = {},
  ) =>
    request<RouteGraphWorkspaceConnectionTargetPage>(
      `/api/route-graph/workspace/connection-targets${buildQueryString({
        elementKind: options.source.element.kind,
        elementId: options.source.element.id,
        portId: options.source.portId,
        cursor: options.cursor,
        limit: options.limit,
        q: options.query,
        replacingEdgeId: options.replacingEdgeId,
      })}`,
      transport,
    ),
  queryRouteGraphWorkspaceConnectionTargets: (
    options: RouteGraphWorkspaceConnectionTargetFilters & { revision: string; operations: RouteGraphWorkspaceOperationsCommand['operations'] },
    transport: Pick<RequestOptions, "signal"> = {},
  ) => requestJson<RouteGraphWorkspaceConnectionTargetPage>(
    `/api/route-graph/workspace/connection-targets/query${buildQueryString({ cursor: options.cursor, limit: options.limit, q: options.query })}`,
    {
      ...transport,
      method: "POST",
      body: { revision: options.revision, operations: options.operations, source: options.source, replacingEdgeId: options.replacingEdgeId },
    },
  ),
  createRouteGraphWorkspaceConnection: (payload: RouteGraphWorkspaceConnectionCreateCommand) =>
    requestJson<RouteGraphWorkspaceConnectionCreateResponse>("/api/route-graph/workspace/connections", {
      method: "POST",
      body: payload,
    }),
  draftRouteGraphWorkspaceConnection: (payload: RouteGraphWorkspaceConnectionDraftCommand) =>
    requestJson<RouteGraphWorkspaceConnectionDraftResponse>("/api/route-graph/workspace/connections/draft", {
      method: "POST",
      body: payload,
    }),
  getRouteGraphWorkspaceRemovalImpact: (payload: RouteGraphWorkspaceRemovalImpactCommand) =>
    requestJson<RouteGraphWorkspaceRemovalImpactResponse>(
      "/api/route-graph/workspace/removal-impact",
      {
        method: "POST",
        body: payload,
      },
    ),
  applyRouteGraphWorkspaceOperations: (payload: RouteGraphWorkspaceOperationsCommand) =>
    requestJson<RouteGraphWorkspaceMutationResponse>("/api/route-graph/workspace/operations", {
      method: "POST",
      body: payload,
    }),
  getRouteGraphWorkspaceOperationBatches: (options: { limit?: number } = {}) =>
    request<RouteGraphWorkspaceOperationBatch[]>(
      `/api/route-graph/workspace/operation-batches${buildQueryString(options)}`,
    ),
  createRouteGraphWorkspaceNode: (payload: RouteGraphWorkspaceNodeCreateCommand) =>
    requestJson<RouteGraphWorkspaceNodeCreateResponse>("/api/route-graph/workspace/nodes", {
      method: "POST",
      body: payload,
    }),
  reserveRouteGraphWorkspaceNode: (payload: RouteGraphWorkspaceNodeReservationCommand) =>
    requestJson<RouteGraphWorkspaceNodeReservationResponse>("/api/route-graph/workspace/nodes/reserve", {
      method: "POST",
      body: payload,
    }),
  createRouteGraphWorkspaceMacro: (payload: RouteGraphWorkspaceMacroCreateCommand) =>
    requestJson<RouteGraphWorkspaceMacroCreateResponse>("/api/route-graph/workspace/macros", {
      method: "POST",
      body: payload,
    }),
  replayRouteGraphWorkspaceOperationBatch: (
    id: number,
    payload: RouteGraphWorkspaceOperationBatchReplayCommand,
  ) =>
    requestJson<RouteGraphWorkspaceMutationResponse>(`/api/route-graph/workspace/operation-batches/${id}/replay`, {
      method: "POST",
      body: payload,
    }),
  validateRouteGraphWorkspace: (payload: RouteGraphWorkspaceOperationsCommand) =>
    requestJson<RouteGraphWorkspaceValidationResponse>("/api/route-graph/workspace/validate", {
      method: "POST",
      body: payload,
    }),
  validateRouteGraph: (graph: RouteGraphAuthoringCommand) =>
    requestJson<RouteGraphValidationResponse>("/api/route-graph/validate", {
      method: "POST",
      body: graph,
    }),
  saveRouteGraphDraft: (graph: RouteGraphAuthoringCommand) =>
    requestJson<RouteGraphDraftSaveResponse>("/api/route-graph/draft", {
      method: "PUT",
      body: graph,
    }),
  publishRouteGraphDraft: () =>
    requestJson("/api/route-graph/draft/publish", { method: "POST", body: {} }),
  rebaseRouteGraphDraft: () =>
    requestJson("/api/route-graph/draft/rebase", { method: "POST", body: {} }),
  discardRouteGraphDraft: () =>
    request("/api/route-graph/draft", { method: "DELETE" }),
  getRouteGroupPage: (options: {
    page: number;
    pageSize: number;
    q?: string;
    tab?: "public" | "internal" | "manual";
    group?: string | number | null;
    brand?: string | null;
    site?: string | null;
    endpointType?: string | null;
    enabled?: "all" | "enabled" | "disabled";
    sortBy?: "candidateCount" | "name";
    sortDir?: "asc" | "desc";
  }) =>
    request(
      `/api/route-groups${buildQueryString({
        paged: 1,
        page: options.page,
        pageSize: options.pageSize,
        q: options.q,
        tab: options.tab,
        group: options.group,
        brand: options.brand,
        site: options.site,
        endpointType: options.endpointType,
        enabled: options.enabled,
        sortBy: options.sortBy,
        sortDir: options.sortDir,
      })}`,
    ).then((response) => {
      const page =
        normalizePagedResponse<RouteGroupManagementListItem>(response);
      const candidateCount = Number(
        (response as { summary?: { candidateCount?: unknown } } | null)?.summary
          ?.candidateCount,
      );
      if (!Number.isFinite(candidateCount)) {
        throw new Error("Invalid Route Group response: summary.candidateCount must be a finite number");
      }
      return {
        ...page,
        summary: {
          candidateCount,
        },
      };
    }),
  getRouteGroupOverview: () => request("/api/route-groups/overview"),
  getRouteGroupSourceCatalog: (
    options: { q?: string; excludeGroupKey?: string; cursor?: string; limit?: number } = {},
  ) =>
    request<RouteGroupSourceCatalogPage>(
      `/api/route-groups/sources${buildQueryString(options)}`,
    ),
  getRouteGroupCandidateCatalog: (
    routeGroupId: string,
    options: { q?: string; page?: number; pageSize?: number } = {},
  ) =>
    request<RouteGroupCandidateCatalogPage>(
      `${routeGroupResourcePath(routeGroupId)}/candidate-catalog${buildQueryString(options)}`,
    ),
  getRouteGroupFallbackStages: (routeGroupId: string) =>
    request<{ stages: RouteGroupManagementFallbackStage[] }>(
      `${routeGroupResourcePath(routeGroupId)}/stages`,
    ),
  batchAddCandidates: (
    routeGroupId: string,
    sourceRefs: string[],
    stageId?: string,
  ) =>
    requestJson(`${routeGroupResourcePath(routeGroupId)}/candidates/batch`, {
      method: "POST",
      body: { sourceRefs, ...(stageId ? { stageId } : {}) },
    }),
  addRouteGroup: (data: RouteGroupCreateCommand) =>
    requestJson("/api/route-groups", {
      method: "POST",
      body: data,
    }),
  updateRouteGroup: (id: string, data: RouteGroupUpdateCommand) =>
    requestJson(routeGroupResourcePath(id), {
      method: "PUT",
      body: data,
    }),
  deleteRouteGroup: (id: string) =>
    request(routeGroupResourcePath(id), { method: "DELETE" }),
  clearRouteGroupFailureState: (routeGroupId: string) =>
    request(
      `/api/route-groups/${encodeURIComponent(routeGroupId)}/failure-state`,
      {
        method: "DELETE",
      },
    ),
  batchUpdateRouteGroups: (data: {
    ids: string[];
    action: "enable" | "disable" | "set_internal" | "set_public";
  }) =>
    requestJson("/api/route-groups/batch", {
      method: "POST",
      body: data,
    }),
  addRouteGroupCandidate: (
    routeGroupId: string,
    data: RouteGroupCandidateCreateCommand,
  ) =>
    requestJson(`${routeGroupResourcePath(routeGroupId)}/candidates`, {
      method: "POST",
      body: data,
    }),
  updateRouteGroupMember: (
    routeGroupId: string,
    candidateId: string,
    data: RouteGroupCandidateUpdateCommand,
  ) =>
    requestJson(
      `${routeGroupResourcePath(routeGroupId)}/candidates/${encodeURIComponent(candidateId)}`,
      {
        method: "PUT",
        body: data,
      },
    ),
  moveRouteGroupCandidatesToFallbackStages: (
    routeGroupId: string,
    updates: Array<{ id: string; stageId: string; sortOrder?: number }>,
    manuallyAdjustedCandidateIds: string[],
  ) =>
    requestJson<{
      success: true;
      candidates: RouteGroupManagementFallbackStage["candidates"];
      stages: RouteGroupManagementFallbackStage[];
    }>(`${routeGroupResourcePath(routeGroupId)}/candidates/stages`, {
      method: "PUT",
      body: { updates, manuallyAdjustedCandidateIds },
    }),
  restoreAutomaticRouteGroupCandidate: (
    routeGroupId: string,
    candidateId: string,
  ) =>
    request<{
      success: true;
      restoredCount: number;
      stages: RouteGroupManagementFallbackStage[];
    }>(
      `${routeGroupResourcePath(routeGroupId)}/candidates/${encodeURIComponent(candidateId)}/manual-adjustment`,
      { method: "DELETE" },
    ),
  restoreAutomaticRouteGroupCandidates: (routeGroupId: string) =>
    request<{
      success: true;
      restoredCount: number;
      stages: RouteGroupManagementFallbackStage[];
    }>(`${routeGroupResourcePath(routeGroupId)}/manual-adjustments`, {
      method: "DELETE",
    }),
  createRouteGroupFallbackStage: (
    routeGroupId: string,
    data: {
      label?: string | null;
      enabled?: boolean;
      dispatcherPolicy?: Record<string, unknown> | null;
      placement?: { afterStageId: string; candidateId: string };
    },
  ) =>
    requestJson<{
      success: true;
      stage: RouteGroupManagementFallbackStage;
      stages: RouteGroupManagementFallbackStage[];
    }>(`${routeGroupResourcePath(routeGroupId)}/stages`, {
      method: "POST",
      body: data,
    }),
  updateRouteGroupFallbackStage: (
    routeGroupId: string,
    stageId: string,
    data: unknown,
  ) =>
    requestJson(
      `${routeGroupResourcePath(routeGroupId)}/stages/${encodeURIComponent(stageId)}`,
      {
        method: "PUT",
        body: data,
      },
    ),
  reorderRouteGroupFallbackStages: (routeGroupId: string, stageIds: string[]) =>
    requestJson(`${routeGroupResourcePath(routeGroupId)}/stages/order`, {
      method: "PUT",
      body: { stageIds },
    }),
  deleteRouteGroupFallbackStage: (routeGroupId: string, stageId: string) =>
    request(
      `${routeGroupResourcePath(routeGroupId)}/stages/${encodeURIComponent(stageId)}`,
      { method: "DELETE" },
    ),
  deleteRouteGroupCandidate: (routeGroupId: string, candidateId: string) =>
    request(
      `${routeGroupResourcePath(routeGroupId)}/candidates/${encodeURIComponent(candidateId)}`,
      { method: "DELETE" },
    ),
  rebuildRoutes: (refreshModels = true, wait = false) =>
    requestJson("/api/route-groups/rebuild", {
      method: "POST",
      body: { refreshModels, ...(wait ? { wait: true } : {}) },
      timeoutMs: wait ? 150_000 : 30_000,
    }),
  getRouteGraphEndpointPage: (options: {
    page: number;
    pageSize: number;
    endpointKind?: "all" | "supply";
    siteId?: number;
    q?: string;
    revision: string;
  }) =>
    request(
      `/api/route-graph/endpoints${buildQueryString({
        paged: 1,
        page: options.page,
        pageSize: options?.pageSize,
        endpointKind: options?.endpointKind,
        siteId: options?.siteId,
        q: options?.q,
        revision: options.revision,
      })}`,
    ) as Promise<import('../shared/routeEndpointCatalog.js').RouteEndpointCatalogPage>,

  // Stats
  getDashboard: () => request("/api/stats/dashboard"),
  getDashboardSnapshot: (options?: { refresh?: boolean }) =>
    request(
      `/api/stats/dashboard${buildQueryString({
        view: "summary",
        ...(options?.refresh ? { refresh: 1 } : {}),
      })}`,
    ),
  getDashboardInsights: (options?: { refresh?: boolean }) =>
    request(
      `/api/stats/dashboard${buildQueryString({
        view: "insights",
        ...(options?.refresh ? { refresh: 1 } : {}),
      })}`,
    ),
  getProxyLogs: (params?: ProxyLogsQuery) =>
    request(
      `/api/stats/proxy-logs${buildQueryString(params)}`,
    ) as Promise<ProxyLogsResponse>,
  getProxyLogsQuery: (params?: ProxyLogsQuery) =>
    request(
      `/api/stats/proxy-logs${buildQueryString({
        ...params,
        view: "query",
      })}`,
    ) as Promise<{
      items: ProxyLogsResponse["items"];
      total: number;
      page: number;
      pageSize: number;
    }>,
  getProxyLogsMeta: (
    params?: Omit<ProxyLogsQuery, "limit" | "offset"> & {
      refresh?: number | boolean;
    },
  ) => {
    const refresh =
      params?.refresh === true
        ? 1
        : typeof params?.refresh === "number"
          ? params.refresh
          : undefined;
    const queryParams = {
      ...params,
      view: "meta",
      ...(refresh !== undefined ? { refresh } : {}),
    } as Record<string, string | number | boolean | null | undefined>;
    if (refresh === undefined) delete queryParams.refresh;
    return request(
      `/api/stats/proxy-logs${buildQueryString(queryParams)}`,
    ) as Promise<{
      clientOptions: ProxyLogsResponse["clientOptions"];
      summary: ProxyLogsResponse["summary"];
      sites: Array<{ id: number; name: string; status?: string | null }>;
    }>;
  },
  getProxyRequestLogDetail: (requestId: string) =>
    request(`/api/stats/proxy-logs/${encodeURIComponent(requestId)}`) as Promise<ProxyRequestLogDetail>,
  getProxyDebugTraces: (params?: { limit?: number }) =>
    request(
      `/api/stats/proxy-debug/traces${buildQueryString(params)}`,
    ) as Promise<ProxyDebugTracesResponse>,
  getProxyDebugTraceDetail: (id: number) =>
    request(
      `/api/stats/proxy-debug/traces/${id}`,
    ) as Promise<ProxyDebugTraceDetail>,
  checkModels: (accountId: number) =>
    requestJson(`/api/models/check/${accountId}`, { method: "POST", body: {} }),
  getSiteDistribution: () => request("/api/stats/site-distribution"),
  getSiteTrend: (days = 7) => request(`/api/stats/site-trend?days=${days}`),
  getSiteSnapshot: async (days = 7, options?: { refresh?: boolean }) => {
    const query = buildQueryString({
      days,
      ...(options?.refresh ? { refresh: 1 } : {}),
    });
    const [distribution, trend, sites] = await Promise.all([
      request<{ distribution: any[] }>(`/api/stats/site-distribution${query}`),
      request<{ trend: any[] }>(`/api/stats/site-trend${query}`),
      request<any[]>("/api/sites"),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      distribution: Array.isArray(distribution?.distribution)
        ? distribution.distribution
        : [],
      trend: Array.isArray(trend?.trend) ? trend.trend : [],
      sites: Array.isArray(sites) ? sites : [],
    };
  },
  getModelBySite: (siteId?: number, days = 7) =>
    request(
      `/api/stats/model-by-site?${siteId ? `siteId=${siteId}&` : ""}days=${days}`,
    ),

  // Search
  search: (query: string) =>
    requestJson("/api/search", {
      method: "POST",
      body: { query, limit: 20 },
    }),

  // OAuth
  getOAuthProviders: () =>
    request("/api/oauth/providers") as Promise<OAuthProvidersResponse>,
  startOAuthProvider: (
    provider: string,
    data?: {
      accountId?: number;
      projectId?: string;
      proxyUrl?: string | null;
      useSystemProxy?: boolean;
    },
  ) =>
    requestJson(`/api/oauth/providers/${encodeURIComponent(provider)}/start`, {
      method: "POST",
      body: data || {},
    }) as Promise<OAuthStartResponse>,
  getOAuthSession: (state: string) =>
    request(
      `/api/oauth/sessions/${encodeURIComponent(state)}`,
    ) as Promise<OAuthSessionInfo>,
  submitOAuthManualCallback: (state: string, callbackUrl: string) =>
    requestJson(
      `/api/oauth/sessions/${encodeURIComponent(state)}/manual-callback`,
      {
        method: "POST",
        body: { callbackUrl },
      },
    ) as Promise<{ success: true }>,
  getOAuthConnections: (params?: { limit?: number; offset?: number }) =>
    request(
      `/api/oauth/connections${buildQueryString(params)}`,
    ) as Promise<OAuthConnectionsResponse>,
  refreshOAuthConnectionQuota: (accountId: number) =>
    requestJson(`/api/oauth/connections/${accountId}/quota/refresh`, {
      method: "POST",
      body: {},
    }) as Promise<{ success: true; quota: OAuthQuotaInfo }>,
  refreshOAuthConnectionQuotaBatch: (accountIds: number[]) =>
    requestJson("/api/oauth/connections/quota/refresh-batch", {
      method: "POST",
      body: { accountIds },
    }) as Promise<OAuthQuotaBatchRefreshResponse>,
  updateOAuthConnectionProxy: (
    accountId: number,
    data: { proxyUrl?: string | null; useSystemProxy?: boolean },
  ) =>
    requestJson(`/api/oauth/connections/${accountId}/proxy`, {
      method: "PATCH",
      body: data || {},
    }) as Promise<{ success: true }>,
  rebindOAuthConnection: (
    accountId: number,
    data?: { proxyUrl?: string | null; useSystemProxy?: boolean },
  ) =>
    requestJson(`/api/oauth/connections/${accountId}/rebind`, {
      method: "POST",
      body: data || {},
    }) as Promise<OAuthStartResponse>,
  deleteOAuthConnection: (accountId: number) =>
    request(`/api/oauth/connections/${accountId}`, {
      method: "DELETE",
    }) as Promise<{ success: true }>,
  importOAuthConnections: (data: Record<string, unknown>) =>
    requestJson("/api/oauth/import", {
      method: "POST",
      body: Array.isArray(data.items) ? data : { data },
    }) as Promise<OAuthImportResponse>,
  createOAuthRouteUnit: (data: {
    accountIds: number[];
    name: string;
    strategy: OAuthRouteUnitStrategy;
  }) =>
    requestJson("/api/oauth/route-units", {
      method: "POST",
      body: data,
    }) as Promise<OAuthRouteUnitMutationResponse>,
  deleteOAuthRouteUnit: (routeUnitId: number) =>
    request(`/api/oauth/route-units/${routeUnitId}`, {
      method: "DELETE",
    }) as Promise<{ success: true }>,

  // Events
  getEvents: (params?: string) =>
    request(`/api/events${params ? "?" + params : ""}`) as Promise<InboxItem[]>,
  getEventCount: (params?: string) =>
    request(`/api/events/count${params ? "?" + params : ""}`) as Promise<{
      count: number;
    }>,
  markEventRead: (id: number) =>
    requestJson(`/api/events/${id}/read`, { method: "POST", body: {} }) as Promise<{
      success: true;
    }>,
  applyEventAction: (id: number, data: InboxActionRequest) =>
    requestJson(`/api/events/${id}/action`, {
      method: "POST",
      body: data,
    }) as Promise<{ success: true; item: InboxItem }>,
  markAllEventsRead: (params?: string) =>
    requestJson(`/api/events/read-all${params ? "?" + params : ""}`, {
      method: "POST",
      body: {},
    }) as Promise<{ success: true }>,
  clearEvents: (params?: string) =>
    request(`/api/events${params ? "?" + params : ""}`, {
      method: "DELETE",
    }) as Promise<{ success: true }>,
  getSiteAnnouncements: (params?: string) =>
    request(`/api/site-announcements${params ? "?" + params : ""}`),
  markSiteAnnouncementRead: (id: number) =>
    requestJson(`/api/site-announcements/${id}/read`, { method: "POST", body: {} }),
  markAllSiteAnnouncementsRead: () =>
    requestJson("/api/site-announcements/read-all", { method: "POST", body: {} }),
  clearSiteAnnouncements: () =>
    request("/api/site-announcements", { method: "DELETE" }),
  syncSiteAnnouncements: (payload?: { siteId?: number }) =>
    requestJson("/api/site-announcements/sync", {
      method: "POST",
      body: payload || {},
    }),
  getTasks: (limit = 50) =>
    request(
      `/api/tasks?limit=${Math.max(1, Math.min(200, Math.trunc(limit)))}`,
    ),
  getTask: (id: string) => request(`/api/tasks/${encodeURIComponent(id)}`),

  // Auth management
  getAuthInfo: () => request("/api/settings/auth/info"),
  changeAuthToken: (oldToken: string, newToken: string) =>
    requestJson("/api/settings/auth/change", {
      method: "POST",
      body: { oldToken, newToken },
    }),
  getRuntimeSettings: () => request("/api/settings/runtime"),
  getRouteRuntimeCacheStatus: () => request("/api/route-runtime/cache") as Promise<{
    ttlMs: number;
    generation: number;
    activeRuntime: { present: boolean; ageMs: number | null; artifactId: string | null; loadInFlight: boolean };
    lastInvalidation: { reason: string; at: string } | null;
  }>,
  refreshRouteRuntimeCache: () => requestJson("/api/route-runtime/cache/refresh", { method: "POST", body: {} }),
  getBrandList: () => request("/api/settings/brand-list"),
  updateRuntimeSettings: (data: RuntimeSettingsPayload) =>
    requestJson("/api/settings/runtime", {
      method: "PUT",
      body: data,
    }),
  getUpdateCenterStatus: () => request("/api/update-center/status"),
  saveUpdateCenterConfig: (data: any) =>
    requestJson("/api/update-center/config", {
      method: "PUT",
      body: data,
    }),
  checkUpdateCenter: () =>
    requestJson("/api/update-center/check", {
      method: "POST",
      body: {},
    }),
  deployUpdateCenter: (data: {
    source: "github-release" | "docker-hub-tag";
    targetTag: string;
    targetDigest?: string | null;
  }) =>
    requestJson("/api/update-center/deploy", {
      method: "POST",
      body: data,
    }),
  rollbackUpdateCenter: (data: { targetRevision: string }) =>
    requestJson("/api/update-center/rollback", {
      method: "POST",
      body: data,
    }),
  streamUpdateCenterTaskLogs: (
    taskId: string,
    handlers: {
      onLog?: (entry: any) => void;
      onDone?: (payload: any) => void;
      signal?: AbortSignal;
    },
  ) =>
    streamSse(
      `/api/update-center/tasks/${encodeURIComponent(taskId)}/stream`,
      handlers,
    ),
  testSystemProxy: (data: SystemProxyTestRequest) =>
    requestJson("/api/settings/system-proxy/test", {
      method: "POST",
      body: data,
      timeoutMs: 20_000,
    }),
  getRuntimeDatabaseConfig: () => request("/api/settings/database/runtime"),
  updateRuntimeDatabaseConfig: (data: {
    dialect: "sqlite" | "mysql" | "postgres";
    connectionString: string;
    ssl?: boolean;
  }) =>
    requestJson("/api/settings/database/runtime", {
      method: "PUT",
      body: data,
    }),
  testExternalDatabaseConnection: (data: {
    dialect: "sqlite" | "mysql" | "postgres";
    connectionString: string;
    ssl?: boolean;
  }) =>
    requestJson("/api/settings/database/test-connection", {
      method: "POST",
      body: data,
    }),
  migrateExternalDatabase: (data: {
    dialect: "sqlite" | "mysql" | "postgres";
    connectionString: string;
    overwrite?: boolean;
    ssl?: boolean;
  }) =>
    requestJson("/api/settings/database/migrate", {
      method: "POST",
      body: data,
      timeoutMs: 120_000,
    }),
  getDownstreamApiKeys: () => request("/api/downstream-keys"),
  getDownstreamCompiledPlans: () =>
    request<{
      success: boolean;
      items: Array<{ id: string; modelName: string }>;
    }>("/api/downstream-keys/compiled-plans"),
  createDownstreamApiKey: (data: any) =>
    requestJson("/api/downstream-keys", {
      method: "POST",
      body: data,
    }),
  updateDownstreamApiKey: (id: number, data: any) =>
    requestJson(`/api/downstream-keys/${id}`, {
      method: "PUT",
      body: data,
    }),
  deleteDownstreamApiKey: (id: number) =>
    request(`/api/downstream-keys/${id}`, {
      method: "DELETE",
    }),
  batchDownstreamApiKeys: (data: {
    ids: number[];
    action: "enable" | "disable" | "delete" | "resetUsage" | "updateMetadata";
    groupOperation?: "keep" | "set" | "clear";
    groupName?: string;
    tagOperation?: "keep" | "append";
    tags?: string[];
  }) =>
    requestJson("/api/downstream-keys/batch", {
      method: "POST",
      body: data,
    }),
  resetDownstreamApiKeyUsage: (id: number) =>
    requestJson(`/api/downstream-keys/${id}/reset-usage`, {
      method: "POST",
      body: {},
    }),
  getDownstreamApiKeysSummary: (params?: {
    range?: "24h" | "7d" | "all";
    status?: "all" | "enabled" | "disabled";
    search?: string;
  }) => request(`/api/downstream-keys/summary${buildQueryString(params)}`),
  getDownstreamApiKeyOverview: (id: number) =>
    request(`/api/downstream-keys/${id}/overview`),
  getDownstreamApiKeyTrend: (
    id: number,
    params?: { range?: "24h" | "7d" | "all"; timeZone?: string },
  ) =>
    request<DownstreamApiKeyTrendResponse>(
      `/api/downstream-keys/${id}/trend${buildQueryString(params)}`,
    ),
  exportBackup: (type: "all" | "accounts" | "preferences" = "all") =>
    request(`/api/settings/backup/export?type=${encodeURIComponent(type)}`),
  downloadBackup: async (type: "all" | "accounts" | "preferences" = "all") => {
    const response = await fetchAuthenticatedResponse(`/api/settings/backup/export?type=${encodeURIComponent(type)}`);
    if (!response.ok) throw await buildApiRequestError(response);
    const blob = await response.blob();
    return {
      blob,
      filename: parseContentDispositionFilename(response.headers.get('content-disposition'))
        || `metapi-${type}-backup.json.gz`,
    };
  },
  importBackup: (data: any) =>
    requestJson("/api/settings/backup/import", {
      method: "POST",
      body: { data },
    }),
  getBackupWebdavConfig: () => request("/api/settings/backup/webdav"),
  saveBackupWebdavConfig: (data: {
    enabled: boolean;
    fileUrl: string;
    username: string;
    password?: string;
    clearPassword?: boolean;
    exportType: "all" | "accounts" | "preferences";
    autoSyncEnabled: boolean;
    autoSyncCron: string;
  }) =>
    requestJson("/api/settings/backup/webdav", {
      method: "PUT",
      body: data,
    }),
  exportBackupToWebdav: (type?: "all" | "accounts" | "preferences") =>
    requestJson("/api/settings/backup/webdav/export", {
      method: "POST",
      body: type ? { type } : {},
      timeoutMs: 60_000,
    }),
  importBackupFromWebdav: () =>
    requestJson("/api/settings/backup/webdav/import", {
      method: "POST",
      body: {},
      timeoutMs: 60_000,
    }),
  clearRuntimeCache: () =>
    requestJson("/api/settings/maintenance/clear-cache", { method: "POST", body: {} }),
  clearUsageData: () =>
    requestJson("/api/settings/maintenance/clear-usage", { method: "POST", body: {} }),
  factoryReset: () =>
    requestJson("/api/settings/maintenance/factory-reset", { method: "POST", body: {} }),
  testNotification: () =>
    requestJson("/api/settings/notify/test", { method: "POST", body: {} }),

  // Monitor embed
  getMonitorConfig: () => request("/api/monitor/config"),
  updateMonitorConfig: (data: { ldohCookie?: string | null }) =>
    requestJson("/api/monitor/config", {
      method: "PUT",
      body: data,
    }),
  initMonitorSession: () => requestJson("/api/monitor/session", { method: "POST", body: {} }),

  // Models marketplace
  getModelsMarketplace: (options: {
    page: number;
    pageSize: number;
    q?: string;
    brand?: string | null;
    site?: string | null;
    sortBy?:
      | "name"
      | "accountCount"
      | "credentialCount"
      | "avgLatency"
      | "successRate";
    sortDir?: "asc" | "desc";
    refresh?: boolean;
    includePricing?: boolean;
  }) => {
    return request<ModelsMarketplaceResponse>(
      `/api/models/marketplace${buildQueryString({
        page: options.page,
        pageSize: options.pageSize,
        q: options.q,
        brand: options.brand,
        site: options.site,
        sortBy: options.sortBy,
        sortDir: options.sortDir,
        ...(options.refresh ? { refresh: 1 } : {}),
        ...(options.includePricing ? { includePricing: 1 } : {}),
      })}`,
      {
        timeoutMs: options.refresh ? 45_000 : 15_000,
      },
    );
  },
  getModelRouteFlow: (
    model: string,
    options: {
      forcedExecutionAttemptId?: string | null;
      request?: ModelRouteFlowRuntimeRequest | null;
      pricingUsage?: ModelRouteFlowPricingUsage | null;
    } = {},
  ) => {
    const query = new URLSearchParams();
    if (options.forcedExecutionAttemptId) {
      query.set("forcedExecutionAttemptId", options.forcedExecutionAttemptId);
    }
    const suffix = query.toString();
    if (options.request || options.pricingUsage) {
      return requestJson(
        `/api/models/${encodeURIComponent(model)}/route-flow${suffix ? `?${suffix}` : ""}`,
        {
          method: "POST",
          body: {
            ...(options.request ? { request: options.request } : {}),
            ...(options.pricingUsage
              ? { pricingUsage: options.pricingUsage }
              : {}),
          },
          timeoutMs: 45_000,
        },
      );
    }
    return request(
      `/api/models/${encodeURIComponent(model)}/route-flow${suffix ? `?${suffix}` : ""}`,
      {
        timeoutMs: 45_000,
      },
    );
  },
  getModelRouteFlowDiagnostics: (
    model: string,
    options: {
      forcedExecutionAttemptId?: string | null;
    } = {},
  ) => {
    const query = new URLSearchParams();
    query.set("view", "diagnostics");
    if (options.forcedExecutionAttemptId) {
      query.set("forcedExecutionAttemptId", options.forcedExecutionAttemptId);
    }
    return request<{
      success: boolean;
      diagnostics: ModelRouteFlowDiagnostics;
    }>(
      `/api/models/${encodeURIComponent(model)}/route-flow?${query.toString()}`,
      { timeoutMs: 20_000 },
    );
  },
  getModelRuntimeObservability: (
    model: string,
    options: {
      range?: "5m" | "15m" | "1h" | "6h" | "24h" | "7d" | "30d";
      refresh?: boolean;
    } = {},
  ) =>
    request<{ success: boolean; observability: ModelRuntimeObservability }>(
      `/api/models/${encodeURIComponent(model)}/runtime-observability${buildQueryString(
        {
          range: options.range,
          ...(options.refresh ? { refresh: 1 } : {}),
        },
      )}`,
      {
        timeoutMs: options.refresh ? 45_000 : 20_000,
      },
    ),
  getModelTokenCandidates: () => request("/api/models/token-candidates"),
  getPricingReferenceConfig: () =>
    request<PricingReferenceConfig>("/api/pricing/reference-config"),
  updatePricingReferenceConfig: (data: PricingReferenceConfig) =>
    requestJson<PricingReferenceConfig>("/api/pricing/reference-config", {
      method: "PUT",
      body: data,
    }),
  getPricingReferenceCatalog: () =>
    request<PricingReferenceCatalog>("/api/pricing/reference-catalog"),
  updatePricingReferenceCatalog: (data: PricingReferenceCatalogPayload) =>
    requestJson<PricingReferenceCatalog>("/api/pricing/reference-catalog", {
      method: "PUT",
      body: data,
    }),
  importPricingReferenceCatalog: (data: unknown, replace = false) =>
    requestJson<PricingReferenceCatalogImportResult>(
      "/api/pricing/reference-catalog/import",
      {
        method: "POST",
        body: { data, replace },
      },
    ),
  syncPricingReferenceCatalog: () =>
    requestJson<PricingReferenceCatalogImportResult | { skipped: true }>(
      "/api/pricing/reference-catalog/sync",
      {
        method: "POST",
        body: {},
      },
    ),
  getPlatformPricingConfig: () =>
    request<PlatformPricingConfig>("/api/pricing/platform-config"),
  updatePlatformPricingConfig: (data: PlatformPricingConfig) =>
    requestJson<PlatformPricingConfig>("/api/pricing/platform-config", {
      method: "PUT",
      body: data,
    }),
  refreshProviderPricingCatalog: () =>
    requestJson<ProviderPricingCatalogRefreshTask>(
      "/api/pricing/provider-catalog/refresh",
      {
        method: "POST",
        body: {},
      },
    ),
  refreshProviderPricingCatalogScope: (data: { siteId: number; accountId?: number }) =>
    requestJson<ProviderPricingCatalogScopeRefreshResult>(
      "/api/pricing/provider-catalog/refresh-scope",
      {
        method: "POST",
        body: data,
      },
    ),
  listWalletAcquisitionProfiles: (params?: {
    siteId?: number;
    accountId?: number;
    tokenId?: number;
    enabled?: boolean;
  }) =>
    request<WalletAcquisitionProfile[]>(
      `/api/pricing/wallet-acquisition${buildQueryString(params)}`,
    ),
  createWalletAcquisitionProfile: (data: WalletAcquisitionProfilePayload) =>
    requestJson<WalletAcquisitionProfile>("/api/pricing/wallet-acquisition", {
      method: "POST",
      body: data,
    }),
  updateWalletAcquisitionProfile: (
    id: number,
    data: Partial<WalletAcquisitionProfilePayload>,
  ) =>
    requestJson<WalletAcquisitionProfile>(`/api/pricing/wallet-acquisition/${id}`, {
      method: "PATCH",
      body: data,
    }),
  deleteWalletAcquisitionProfile: (id: number) =>
    request<{ success: boolean }>(`/api/pricing/wallet-acquisition/${id}`, {
      method: "DELETE",
    }),
  listFxRateSnapshots: (params?: {
    fromCurrency?: string;
    toCurrency?: string;
  }) =>
    request<FxRateSnapshot[]>(
      `/api/pricing/fx-rates${buildQueryString(params)}`,
    ),
  createFxRateSnapshot: (data: FxRateSnapshotPayload) =>
    requestJson<FxRateSnapshot>("/api/pricing/fx-rates", {
      method: "POST",
      body: data,
    }),
  updateFxRateSnapshot: (id: number, data: Partial<FxRateSnapshotPayload>) =>
    requestJson<FxRateSnapshot>(`/api/pricing/fx-rates/${id}`, {
      method: "PATCH",
      body: data,
    }),
  deleteFxRateSnapshot: (id: number) =>
    request<{ success: boolean }>(`/api/pricing/fx-rates/${id}`, {
      method: "DELETE",
    }),
  listUpstreamCostPricings: (params?: {
    siteId?: number;
    accountId?: number;
    tokenId?: number;
    modelName?: string;
    enabled?: boolean;
    includeSiteScope?: boolean;
  }) =>
    request<UpstreamCostPricingRecord[]>(
      `/api/pricing/upstream-cost${buildQueryString(params)}`,
    ),
  createUpstreamCostPricing: (data: UpstreamCostPricingPayload) =>
    requestJson<UpstreamCostPricingRecord>("/api/pricing/upstream-cost", {
      method: "POST",
      body: data,
    }),
  updateUpstreamCostPricing: (
    id: number,
    data: Partial<UpstreamCostPricingPayload>,
  ) =>
    requestJson<UpstreamCostPricingRecord>(`/api/pricing/upstream-cost/${id}`, {
      method: "PATCH",
      body: data,
    }),
  deleteUpstreamCostPricing: (id: number) =>
    request<{ success: boolean }>(`/api/pricing/upstream-cost/${id}`, {
      method: "DELETE",
    }),
  resolveUpstreamCostPricing: (params: {
    siteId: number;
    accountId?: number;
    tokenId?: number;
    tokenGroup?: string;
    modelName: string;
  }) =>
    request<{
      pricing: UpstreamCostPricingRecord | null;
      matchedScope?: UpstreamCostMatchedScope;
      priority?: number;
    }>(`/api/pricing/upstream-cost/resolve${buildQueryString(params)}`),
  previewUpstreamCostPricing: (data: {
    siteId: number;
    accountId?: number;
    tokenId?: number;
    tokenGroup?: string;
    modelName: string;
    usage?: Record<string, unknown>;
    context?: Record<string, unknown>;
  }) =>
    requestJson<{
      pricing: UpstreamCostPricingRecord | null;
      matchedScope?: UpstreamCostMatchedScope;
      priority?: number;
      evaluation?: Record<string, unknown> | null;
    }>("/api/pricing/upstream-cost/preview", {
      method: "POST",
      body: data,
    }),

  startProxyTestJob: (data: ProxyTestRequestEnvelope) =>
    requestJson<ModelTesterProxyJobCreated>("/api/test/proxy/jobs", {
      method: "POST",
      body: data,
      timeoutMs: resolveProxyTestTimeoutMs(data),
    }),
  getProxyTestJob: (jobId: string) =>
    request<ModelTesterProxyJob>(`/api/test/proxy/jobs/${encodeURIComponent(jobId)}`),
  deleteProxyTestJob: (jobId: string) =>
    request<ModelTesterProxyDeleteResult>(`/api/test/proxy/jobs/${encodeURIComponent(jobId)}`, {
      method: "DELETE",
    }),
  getProxyFileContentDataUrl: async (
    fileId: string,
    options: Pick<RequestOptions, "signal" | "timeoutMs"> = {},
  ) => {
    const response = await fetchAuthenticatedResponse(
      `/v1/files/${encodeURIComponent(fileId)}/content`,
      {
        method: "GET",
        ...options,
      },
    );
    if (!response.ok) {
      throw new Error(await extractResponseErrorMessage(response));
    }

    const mimeType =
      (response.headers.get("content-type") || "application/octet-stream")
        .split(";")[0]
        .trim() || "application/octet-stream";
    const filename = parseContentDispositionFilename(
      response.headers.get("content-disposition"),
    );
    const base64 = arrayBufferToBase64(await response.arrayBuffer());
    return {
      filename,
      mimeType,
      data: `data:${mimeType};base64,${base64}`,
    };
  },
  testProxy: proxyTestRequest,
  proxyTest: proxyTestRequest,
  testProxyStream: proxyTestStreamRequest,
  proxyTestStream: proxyTestStreamRequest,
};
