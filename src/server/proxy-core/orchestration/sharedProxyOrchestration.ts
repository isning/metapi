import { formatUtcSqlDateTime } from '../../services/localTimeService.js';
import { resolveChannelProxyUrl, withSiteRecordProxyRequestInit } from '../../services/siteProxy.js';
import type { SiteProxyConfigLike } from '../../services/siteProxy.js';
import { resolveProxyUsageWithSelfLogFallback } from '../../services/proxyUsageFallbackService.js';
import type { DownstreamRoutingPolicy } from '../../services/downstreamPolicyTypes.js';
import { reportProxyAllFailed, reportTokenExpired } from '../../services/alertService.js';
import { isTokenExpiredError } from '../../services/alertRules.js';
import { shouldRetryProxyRequest } from '../../services/proxyRetryPolicy.js';
import { composeProxyLogMessage } from '../../services/proxyLogMessage.js';
import { resolveProxyLogBilling } from '../../services/proxyBilling.js';
import type { DownstreamClientContext } from '../downstreamClientContext.js';
import { insertProxyLog } from '../../services/proxyLogStore.js';
import { dispatchRuntimeRequest } from '../../services/runtimeDispatch.js';
import type { BuiltEndpointRequest } from './endpointFlow.js';
import { buildUpstreamUrl } from './upstreamRequest.js';
import { recordOauthQuotaHeadersSnapshot, recordOauthQuotaResetHint } from '../../services/oauth/quota.js';
import { refreshOauthAccessTokenSingleflight } from '../../services/oauth/refreshSingleflight.js';
import { proxyTargetCoordinator } from '../../services/proxyTargetCoordinator.js';
import { readRuntimeResponseText } from '../executors/types.js';
import type { RouteExecutionScope } from '../../services/routeExecutionScopeTypes.js';
import type { CompiledRouteRuntimeRequest } from '../../services/compiledRuntimeRequestTypes.js';
import type { RouteRuntimeSnapshotBody } from '../../../shared/routeRuntimeSnapshot.js';
import {
  completeCompiledRuntimeExecutionSession,
  type CompiledRuntimeExecutionSession,
} from '../../services/compiledRuntimeExecutionSessionService.js';
import {
  createRouteRuntimeDecisionSession,
  commitRouteRuntimeDecisionProposal,
  proposeRouteRuntimeDecisionInSession,
  previewRouteRuntimeDecisionInSession,
  recordRouteRuntimeExecutionAttemptFailure,
  recordRouteRuntimeExecutionAttemptStarted,
  recordRouteRuntimeExecutionAttemptSuccess,
  previewRouteRuntimeDecision,
  selectRouteRuntimeDecision,
  selectRouteRuntimeDecisionInSession,
  selectRouteRuntimeExecutionAttempt,
  type RouteRuntimeDecisionSession,
  type RouteRuntimeDecisionProposal,
  type RouteRuntimeDecision,
  type RouteRuntimeExecutionAttempt,
} from '../../services/routeRuntimeExecutionService.js';

type SelectedExecutionAttempt = RouteRuntimeExecutionAttempt | null;
type SurfaceWarningScope = string;

type SurfaceSelectedExecutionAttempt = {
  executionAttemptId: string;
  target: { id: number; tokenId?: number | null };
  account: { id: number; username?: string | null };
  site: { id: number; name?: string | null };
  token?: { id?: number | null; tokenGroup?: string | null } | null;
  actualModel?: string | null;
  routeEntrypointId: string;
  runtimeEndpointId: string;
  runtimeArtifactId: string;
  executionTargetId: number;
  routeRuntimeSnapshot: RouteRuntimeSnapshotBody;
};

type SurfaceFailureResponse = {
  action: 'respond';
  status: number;
  payload: {
    error: {
      message: string;
      type: 'upstream_error';
    };
  };
};

type SurfaceFailureOutcome =
  | { action: 'retry' }
  | SurfaceFailureResponse;

type SurfaceOauthRefreshCredential = {
  account: {
    id: number;
    accessToken?: string | null;
    extraConfig?: string | null;
  };
  tokenValue: string;
};

type SurfaceOauthRefreshContext<TRequest extends BuiltEndpointRequest> = {
  request: TRequest;
  response: Awaited<ReturnType<typeof dispatchRuntimeRequest>>;
  rawErrText: string;
};

type SurfaceSuccessSelectedExecutionAttempt = SurfaceSelectedExecutionAttempt & {
  account: Record<string, unknown> & {
    id: number;
    username?: string | null;
    accessToken?: string | null;
    apiToken?: string | null;
    extraConfig?: string | null;
    platformUserId?: number | null;
  };
  site: Record<string, unknown> & {
    id: number;
    url: string;
    platform: string;
    apiKey?: string | null;
    useSystemProxy?: boolean | null;
    proxyUrl?: string | null;
    name?: string | null;
  };
  tokenValue: string;
  tokenName?: string | null;
};

type SurfaceUsageSummary = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  promptTokensIncludeCache: boolean | null;
};

type SurfaceResolvedUsageSummary = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  recoveredFromSelfLog: boolean;
  estimatedCostFromQuota: number;
  selfLogBillingMeta: import('../../services/proxyUsageFallbackService.js').SelfLogBillingMeta | null;
  usageSource: 'upstream' | 'self-log' | 'unknown';
};

export async function selectSurfaceExecutionAttempt(input: {
  requestedModel: string;
  request?: CompiledRouteRuntimeRequest | null;
  downstreamPolicy: DownstreamRoutingPolicy;
  excludeTargetIds: number[];
  retryCount: number;
  stickySessionKey?: string | null;
  forcedExecutionAttemptId?: string | null;
  routeExecutionScope?: RouteExecutionScope | null;
}): Promise<SelectedExecutionAttempt> {
  return await selectRouteRuntimeExecutionAttempt({
    requestedModel: input.requestedModel,
    ...(input.request ? { request: input.request } : {}),
    downstreamPolicy: input.downstreamPolicy,
    retryCount: input.retryCount,
    stickyExecutionTargetId: input.retryCount === 0 && input.stickySessionKey
      ? getSurfaceStickyPreferredTargetId(input.stickySessionKey)
      : null,
    forcedExecutionAttemptId: input.forcedExecutionAttemptId,
    disabledExecutionTargetIds: input.excludeTargetIds,
    disabledExecutionAttemptIds: input.routeExecutionScope?.failureOverlay.disabledExecutionAttemptIds,
  });
}

export async function selectSurfaceRuntimeDecision(
  input: Parameters<typeof selectSurfaceExecutionAttempt>[0],
): Promise<RouteRuntimeDecision | null> {
  return await selectRouteRuntimeDecision({
    requestedModel: input.requestedModel,
    ...(input.request ? { request: input.request } : {}),
    downstreamPolicy: input.downstreamPolicy,
    retryCount: input.retryCount,
    stickyExecutionTargetId: input.retryCount === 0 && input.stickySessionKey
      ? getSurfaceStickyPreferredTargetId(input.stickySessionKey)
      : null,
    forcedExecutionAttemptId: input.forcedExecutionAttemptId,
    disabledExecutionTargetIds: input.excludeTargetIds,
    disabledExecutionAttemptIds: input.routeExecutionScope?.failureOverlay.disabledExecutionAttemptIds,
  });
}

export async function previewSurfaceRuntimeDecision(
  input: Parameters<typeof selectSurfaceExecutionAttempt>[0],
): Promise<RouteRuntimeDecision | null> {
  return await previewRouteRuntimeDecision({
    requestedModel: input.requestedModel,
    ...(input.request ? { request: input.request } : {}),
    downstreamPolicy: input.downstreamPolicy,
    retryCount: input.retryCount,
    stickyExecutionTargetId: input.retryCount === 0 && input.stickySessionKey
      ? getSurfaceStickyPreferredTargetId(input.stickySessionKey)
      : null,
    forcedExecutionAttemptId: input.forcedExecutionAttemptId,
    disabledExecutionTargetIds: input.excludeTargetIds,
    disabledExecutionAttemptIds: input.routeExecutionScope?.failureOverlay.disabledExecutionAttemptIds,
  });
}

export async function createSurfaceRuntimeDecisionSession(input: {
  requestedModel: string;
  request?: CompiledRouteRuntimeRequest | null;
  downstreamPolicy: DownstreamRoutingPolicy;
  stickyExecutionTargetId?: number | null;
  forcedExecutionAttemptId?: string | null;
}): Promise<RouteRuntimeDecisionSession> {
  return await createRouteRuntimeDecisionSession(input);
}

export async function selectSurfaceRuntimeDecisionInSession(input: {
  session: RouteRuntimeDecisionSession;
  excludeTargetIds: number[];
  retryCount: number;
  routeExecutionScope?: RouteExecutionScope | null;
}): Promise<RouteRuntimeDecision | null> {
  return await selectRouteRuntimeDecisionInSession(input.session, {
    retryCount: input.retryCount,
    disabledExecutionTargetIds: input.excludeTargetIds,
    disabledExecutionAttemptIds: input.routeExecutionScope?.failureOverlay.disabledExecutionAttemptIds,
  });
}

export async function proposeSurfaceRuntimeDecisionInSession(input: {
  session: RouteRuntimeDecisionSession;
  excludeTargetIds: number[];
  retryCount: number;
  routeExecutionScope?: RouteExecutionScope | null;
}): Promise<RouteRuntimeDecisionProposal | null> {
  return await proposeRouteRuntimeDecisionInSession(input.session, {
    retryCount: input.retryCount,
    disabledExecutionTargetIds: input.excludeTargetIds,
    disabledExecutionAttemptIds: input.routeExecutionScope?.failureOverlay.disabledExecutionAttemptIds,
  });
}

export function commitSurfaceRuntimeDecisionProposal(
  proposal: RouteRuntimeDecisionProposal,
): boolean {
  return commitRouteRuntimeDecisionProposal(proposal);
}

export async function previewSurfaceRuntimeDecisionInSession(input: {
  session: RouteRuntimeDecisionSession;
  excludeTargetIds: number[];
  retryCount: number;
  routeExecutionScope?: RouteExecutionScope | null;
}): Promise<RouteRuntimeDecision | null> {
  return await previewRouteRuntimeDecisionInSession(input.session, {
    retryCount: input.retryCount,
    disabledExecutionTargetIds: input.excludeTargetIds,
    disabledExecutionAttemptIds: input.routeExecutionScope?.failureOverlay.disabledExecutionAttemptIds,
  });
}

export async function markSurfaceExecutionAttemptStarted(input: {
  selected: SurfaceSelectedExecutionAttempt;
}): Promise<void> {
  await recordRouteRuntimeExecutionAttemptStarted({
    executionTargetId: input.selected.executionTargetId,
  });
}

export function buildSurfaceStickySessionKey(input: {
  clientContext?: DownstreamClientContext | null;
  requestedModel: string;
  downstreamPath: string;
  downstreamApiKeyId?: number | null;
}): string | null {
  return proxyTargetCoordinator.buildStickySessionKey({
    clientKind: input.clientContext?.clientKind || null,
    sessionId: input.clientContext?.sessionId || null,
    requestedModel: input.requestedModel,
    downstreamPath: input.downstreamPath,
    downstreamApiKeyId: input.downstreamApiKeyId,
  });
}

export function getSurfaceStickyPreferredTargetId(stickySessionKey?: string | null): number | null {
  if (!stickySessionKey) return null;
  return proxyTargetCoordinator.getStickyTargetId(stickySessionKey) ?? null;
}

export function bindSurfaceStickyTarget(input: {
  stickySessionKey?: string | null;
  selected: {
    target: { id: number };
    account?: { extraConfig?: string | null; oauthProvider?: string | null } | null;
  };
}): void {
  proxyTargetCoordinator.bindStickyTarget(
    input.stickySessionKey,
    input.selected.target.id,
    input.selected.account || undefined,
  );
}

export function clearSurfaceStickyTarget(input: {
  stickySessionKey?: string | null;
  selected: {
    target: { id: number };
  };
}): void {
  proxyTargetCoordinator.clearStickyTarget(
    input.stickySessionKey,
    input.selected.target.id,
  );
}

export async function acquireSurfaceTargetLease(input: {
  stickySessionKey?: string | null;
  selected: {
    target: { id: number };
    account?: { extraConfig?: string | null; oauthProvider?: string | null } | null;
  };
}) {
  return await proxyTargetCoordinator.acquireTargetLease({
    // Only session-addressable requests should consume the guarded per-target
    // lease pool. Requests without a stable downstream session key should keep
    // the pre-sticky-session parallel behavior instead of contending globally.
    targetId: input.stickySessionKey ? input.selected.target.id : 0,
    accountExtraConfig: input.selected.account?.extraConfig,
    accountOauthProvider: input.selected.account?.oauthProvider,
  });
}

export function buildSurfaceTargetBusyMessage(waitMs: number): string {
  return waitMs > 0
    ? `Target busy: waited ${waitMs}ms for an available session slot`
    : 'Target busy: no session slot available';
}

export async function writeSurfaceProxyLog(input: {
  requestId?: string | null;
  warningScope: string;
  selected: SurfaceSelectedExecutionAttempt;
  modelRequested: string;
  status: string;
  httpStatus: number;
  isStream?: boolean | null;
  firstByteLatencyMs?: number | null;
  firstTokenLatencyMs?: number | null;
  latencyMs: number;
  errorMessage: string | null;
  retryCount: number;
  downstreamPath: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  estimatedCost?: number | null;
  billingDetails?: unknown;
  upstreamPath?: string | null;
  usageSource?: 'upstream' | 'self-log' | 'unknown' | null;
  clientContext?: DownstreamClientContext | null;
  downstreamApiKeyId?: number | null;
}): Promise<void> {
  try {
    const createdAt = formatUtcSqlDateTime(new Date());
    const normalizedErrorMessage = composeProxyLogMessage({
      clientKind: input.clientContext?.clientKind && input.clientContext.clientKind !== 'generic'
        ? input.clientContext.clientKind
        : null,
      sessionId: input.clientContext?.sessionId || null,
      traceHint: input.clientContext?.traceHint || null,
      downstreamPath: input.downstreamPath,
      upstreamPath: input.upstreamPath || null,
      usageSource: input.usageSource || null,
      errorMessage: input.errorMessage,
    });
    await insertProxyLog({
      requestId: input.requestId ?? null,
      executionAttemptId: input.selected.executionAttemptId,
      accountId: input.selected.account.id,
      downstreamApiKeyId: input.downstreamApiKeyId ?? null,
      modelRequested: input.modelRequested,
      modelActual: input.selected.actualModel ?? null,
      routeEntrypointId: input.selected.routeEntrypointId,
      runtimeEndpointId: input.selected.runtimeEndpointId,
      runtimeArtifactId: input.selected.runtimeArtifactId,
      executionTargetId: input.selected.executionTargetId,
      status: input.status,
      httpStatus: input.httpStatus,
      isStream: input.isStream ?? null,
      firstByteLatencyMs: input.firstByteLatencyMs ?? null,
      firstTokenLatencyMs: input.firstTokenLatencyMs ?? null,
      latencyMs: input.latencyMs,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      totalTokens: input.totalTokens ?? null,
      estimatedCost: input.estimatedCost ?? null,
      billingDetails: input.billingDetails ?? null,
      clientFamily: input.clientContext?.clientKind || null,
      clientAppId: input.clientContext?.clientAppId || null,
      clientAppName: input.clientContext?.clientAppName || null,
      clientConfidence: input.clientContext?.clientConfidence || null,
      errorMessage: normalizedErrorMessage,
      retryCount: input.retryCount,
      createdAt,
    });
  } catch (error) {
    console.warn(`[proxy/${input.warningScope}] failed to write proxy log`, error);
  }
}

export function createSurfaceDispatchRequest(input: {
  site: SiteProxyConfigLike & { url: string };
  accountExtraConfig?: string | null;
  siteUrl?: string;
}) {
  const targetProxyUrl = resolveChannelProxyUrl(input.site, input.accountExtraConfig);
  return (
    request: BuiltEndpointRequest,
    targetUrl?: string,
    signal?: AbortSignal,
  ) => (
    dispatchRuntimeRequest({
      siteUrl: input.siteUrl ?? input.site.url,
      targetUrl,
      signal,
      request,
      buildInit: (_requestUrl, requestForFetch) => withSiteRecordProxyRequestInit(input.site, {
        method: 'POST',
        headers: requestForFetch.headers,
        body: JSON.stringify(requestForFetch.body),
      }, targetProxyUrl),
    })
  );
}

export async function trySurfaceOauthRefreshRecovery<TRequest extends BuiltEndpointRequest>(input: {
  ctx: SurfaceOauthRefreshContext<TRequest>;
  selected: SurfaceOauthRefreshCredential;
  siteUrl: string;
  buildRequest: (endpoint: TRequest['endpoint']) => TRequest;
  dispatchRequest: (
    request: TRequest,
    targetUrl: string,
  ) => Promise<Awaited<ReturnType<typeof dispatchRuntimeRequest>>>;
  captureFailureBody?: boolean;
}): Promise<{
  upstream: Awaited<ReturnType<typeof dispatchRuntimeRequest>>;
  upstreamPath: string;
  request?: TRequest;
  targetUrl?: string;
} | null> {
  try {
    const refreshed = await refreshOauthAccessTokenSingleflight(input.selected.account.id);
    input.selected.tokenValue = refreshed.accessToken;
    input.selected.account = {
      ...input.selected.account,
      accessToken: refreshed.accessToken,
      extraConfig: refreshed.extraConfig ?? input.selected.account.extraConfig,
    };

    const refreshedRequest = input.buildRequest(input.ctx.request.endpoint);
    const refreshedTargetUrl = refreshedRequest.targetUrl || buildUpstreamUrl(input.siteUrl, refreshedRequest.path);
    const refreshedResponse = await input.dispatchRequest(refreshedRequest, refreshedTargetUrl);
    if (refreshedResponse.ok) {
      return {
        upstream: refreshedResponse,
        upstreamPath: refreshedRequest.path,
        request: refreshedRequest,
        targetUrl: refreshedTargetUrl,
      };
    }

    input.ctx.request = refreshedRequest;
    input.ctx.response = refreshedResponse;
    if (input.captureFailureBody !== false) {
      const failureBody = await readRuntimeResponseText(refreshedResponse).catch(() => '');
      input.ctx.rawErrText = failureBody.trim() || 'unknown error';
    }
  } catch {
    return null;
  }

  return null;
}

export async function recordSurfaceSuccess(input: {
  selected: SurfaceSuccessSelectedExecutionAttempt;
  requestedModel: string;
  modelName: string;
  parsedUsage: SurfaceUsageSummary;
  upstreamUsagePresent?: boolean;
  upstreamHeaders?: { get(name: string): string | null } | null;
  requestStartedAtMs: number;
  isStream?: boolean | null;
  firstByteLatencyMs?: number | null;
  firstTokenLatencyMs?: number | null;
  latencyMs: number;
  retryCount: number;
  upstreamPath?: string | null;
  logSuccess: (args: {
    selected: SurfaceSelectedExecutionAttempt;
    modelRequested: string;
    status: string;
    httpStatus: number;
    isStream?: boolean | null;
    firstByteLatencyMs?: number | null;
    firstTokenLatencyMs?: number | null;
    latencyMs: number;
    errorMessage: string | null;
    retryCount: number;
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    usageSource?: 'upstream' | 'self-log' | 'unknown';
    estimatedCost?: number | null;
    billingDetails?: unknown;
    upstreamPath?: string | null;
  }) => Promise<void>;
  recordDownstreamBilling?: (input: {
    billingDetails: unknown;
    siteId: number | null;
    accountId: number | null;
  }) => Promise<void> | void;
  bestEffortMetrics?: {
    errorLabel: string;
  };
  suppressLogUsageSource?: boolean;
}): Promise<{
  resolvedUsage: SurfaceResolvedUsageSummary;
  estimatedCost: number | null;
  billingDetails: unknown;
}> {
  const hasUpstreamUsage = input.upstreamUsagePresent ?? (
    input.parsedUsage.totalTokens > 0
    || input.parsedUsage.promptTokens > 0
    || input.parsedUsage.completionTokens > 0
  );
  let resolvedUsage: SurfaceResolvedUsageSummary = {
    promptTokens: input.parsedUsage.promptTokens,
    completionTokens: input.parsedUsage.completionTokens,
    totalTokens: input.parsedUsage.totalTokens,
    recoveredFromSelfLog: false,
    estimatedCostFromQuota: 0,
    selfLogBillingMeta: null,
    usageSource: hasUpstreamUsage ? 'upstream' : 'unknown',
  };
  let estimatedCost: number | null = null;
  let billingDetails: unknown = null;

  try {
    resolvedUsage = await resolveProxyUsageWithSelfLogFallback({
      site: input.selected.site,
      account: input.selected.account,
      tokenValue: input.selected.tokenValue,
      tokenName: input.selected.tokenName,
      modelName: input.modelName,
      requestStartedAtMs: input.requestStartedAtMs,
      requestEndedAtMs: input.requestStartedAtMs + input.latencyMs,
      localLatencyMs: input.latencyMs,
      upstreamUsagePresent: hasUpstreamUsage,
      usage: {
        promptTokens: input.parsedUsage.promptTokens,
        completionTokens: input.parsedUsage.completionTokens,
        totalTokens: input.parsedUsage.totalTokens,
      },
    });
    const billing = await resolveProxyLogBilling({
      site: input.selected.site,
      account: input.selected.account,
      tokenId: input.selected.token?.id ?? input.selected.target.tokenId ?? null,
      upstreamGroup: input.selected.token?.tokenGroup ?? null,
      modelName: input.modelName,
      parsedUsage: input.parsedUsage,
      resolvedUsage,
    });
    estimatedCost = billing.estimatedCost;
    billingDetails = billing.billingDetails;
  } catch (error) {
    if (!input.bestEffortMetrics) {
      throw error;
    }
    console.error(input.bestEffortMetrics.errorLabel, error);
  }

  try {
    await recordRouteRuntimeExecutionAttemptSuccess({
      executionTargetId: input.selected.executionTargetId,
      accountId: input.selected.account.id,
      modelName: input.modelName,
      latencyMs: input.latencyMs,
    });
  } catch (error) {
    if (!input.bestEffortMetrics) {
      throw error;
    }
    console.error(input.bestEffortMetrics.errorLabel, error);
  }
  if (billingDetails != null) {
    await input.recordDownstreamBilling?.({
      billingDetails,
      siteId: input.selected.site.id,
      accountId: input.selected.account.id,
    });
  }
  const logTokens = resolvedUsage.usageSource === 'unknown'
    ? {
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    }
    : {
      promptTokens: resolvedUsage.promptTokens,
      completionTokens: resolvedUsage.completionTokens,
      totalTokens: resolvedUsage.totalTokens,
    };
  await input.logSuccess({
    selected: input.selected,
    modelRequested: input.requestedModel,
    status: 'success',
    httpStatus: 200,
    isStream: input.isStream ?? null,
    firstByteLatencyMs: input.firstByteLatencyMs ?? null,
    firstTokenLatencyMs: input.firstTokenLatencyMs ?? null,
    latencyMs: input.latencyMs,
    errorMessage: null,
    retryCount: input.retryCount,
    promptTokens: logTokens.promptTokens,
    completionTokens: logTokens.completionTokens,
    totalTokens: logTokens.totalTokens,
    usageSource: input.suppressLogUsageSource ? undefined : resolvedUsage.usageSource,
    estimatedCost,
    billingDetails,
    upstreamPath: input.upstreamPath,
  });

  if (input.upstreamHeaders) {
    void recordOauthQuotaHeadersSnapshot({
      accountId: input.selected.account.id,
      headers: input.upstreamHeaders,
    }).catch((error) => {
      console.warn('[proxy/shared] failed to record oauth quota headers', error);
    });
  }

  return {
    resolvedUsage,
    estimatedCost,
    billingDetails,
  };
}

export function createSurfaceFailureToolkit(input: {
  requestId?: string | null;
  executionSession?: CompiledRuntimeExecutionSession | null;
  warningScope: SurfaceWarningScope;
  downstreamPath: string;
  clientContext?: DownstreamClientContext | null;
  downstreamApiKeyId?: number | null;
}) {
  const log = async (args: {
    selected: SurfaceSelectedExecutionAttempt;
    modelRequested: string;
    status: string;
    httpStatus: number;
    isStream?: boolean | null;
    firstByteLatencyMs?: number | null;
    firstTokenLatencyMs?: number | null;
    latencyMs: number;
    errorMessage: string | null;
    retryCount: number;
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    usageSource?: 'upstream' | 'self-log' | 'unknown';
    estimatedCost?: number | null;
    billingDetails?: unknown;
    upstreamPath?: string | null;
  }) => {
    if (input.executionSession && (args.status === 'success' || args.status === 'failed')) {
      await completeCompiledRuntimeExecutionSession(input.executionSession, {
        status: args.status === 'success' ? 'success' : 'failure',
        httpStatus: args.httpStatus,
        executionAttemptId: args.selected.executionAttemptId,
        runtimeEndpointId: args.selected.runtimeEndpointId,
        actualModel: args.selected.actualModel ?? null,
        siteId: typeof args.selected.site.id === 'number' ? args.selected.site.id : null,
        accountId: args.selected.account.id,
        isStream: args.isStream ?? null,
        latencyMs: args.latencyMs,
        firstTokenLatencyMs: args.firstTokenLatencyMs ?? null,
        promptTokens: args.promptTokens ?? null,
        completionTokens: args.completionTokens ?? null,
        totalTokens: args.totalTokens ?? null,
        estimatedCost: args.estimatedCost ?? null,
        billingDetails: args.billingDetails ?? null,
        errorMessage: args.errorMessage,
      });
    }
    await writeSurfaceProxyLog({
      warningScope: input.warningScope,
      requestId: input.requestId ?? null,
      selected: args.selected,
      modelRequested: args.modelRequested,
      status: args.status,
      httpStatus: args.httpStatus,
      isStream: args.isStream ?? null,
      firstByteLatencyMs: args.firstByteLatencyMs ?? null,
      firstTokenLatencyMs: args.firstTokenLatencyMs ?? null,
      latencyMs: args.latencyMs,
      errorMessage: args.errorMessage,
      retryCount: args.retryCount,
      downstreamPath: input.downstreamPath,
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      totalTokens: args.totalTokens,
      usageSource: args.usageSource,
      estimatedCost: args.estimatedCost,
      billingDetails: args.billingDetails,
      upstreamPath: args.upstreamPath,
      clientContext: input.clientContext,
      downstreamApiKeyId: input.downstreamApiKeyId,
    });
  };

  const runBestEffort = (label: string, fn: () => Promise<unknown>) => {
    void Promise.resolve()
      .then(fn)
      .catch((error) => {
        console.warn(`[proxy/${input.warningScope}] failed to ${label}`, error);
      });
  };

  return {
    log,
    isRetryable(status: number, errorText: string): boolean {
      return shouldRetryProxyRequest(status, errorText);
    },
    async handleUpstreamFailure(args: {
      selected: SurfaceSelectedExecutionAttempt;
      requestedModel: string;
      modelName: string;
      status: number;
      errText: string;
      rawErrText?: string | null;
      isStream?: boolean | null;
      firstByteLatencyMs?: number | null;
      firstTokenLatencyMs?: number | null;
      latencyMs: number;
      retryCount: number;
      willContinue: boolean;
    }): Promise<SurfaceFailureOutcome> {
      const rawErrText = args.rawErrText || args.errText;
      await recordRouteRuntimeExecutionAttemptFailure({
        executionTargetId: args.selected.executionTargetId,
        status: args.status,
        errorText: rawErrText,
      });
      const retry = args.willContinue && shouldRetryProxyRequest(args.status, args.errText);
      await log({
        selected: args.selected,
        modelRequested: args.requestedModel,
        status: retry ? 'retried' : 'failed',
        httpStatus: args.status,
        isStream: args.isStream ?? null,
        firstByteLatencyMs: args.firstByteLatencyMs ?? null,
        firstTokenLatencyMs: args.firstTokenLatencyMs ?? null,
        latencyMs: args.latencyMs,
        errorMessage: args.errText,
        retryCount: args.retryCount,
      });
      runBestEffort('record oauth quota reset hint', () => recordOauthQuotaResetHint({
        accountId: args.selected.account.id,
        statusCode: args.status,
        errorText: rawErrText,
      }));

      if (isTokenExpiredError({ status: args.status, message: args.errText })) {
        runBestEffort('report token expired', () => reportTokenExpired({
          accountId: args.selected.account.id,
          username: args.selected.account.username,
          siteName: args.selected.site.name,
          detail: `HTTP ${args.status}`,
        }));
      }

      if (retry) return { action: 'retry' as const };

      runBestEffort('report proxy all failed', () => reportProxyAllFailed({
        model: args.requestedModel,
        reason: `upstream returned HTTP ${args.status}`,
      }));

      return {
        action: 'respond',
        status: args.status,
        payload: {
          error: {
            message: args.errText,
            type: 'upstream_error',
          },
        },
      };
    },

    async handleDetectedFailure(args: {
      selected: SurfaceSelectedExecutionAttempt;
      requestedModel: string;
      modelName: string;
      failure: { status: number; reason: string };
      isStream?: boolean | null;
      firstByteLatencyMs?: number | null;
      firstTokenLatencyMs?: number | null;
      latencyMs: number;
      retryCount: number;
      willContinue: boolean;
      promptTokens?: number | null;
      completionTokens?: number | null;
      totalTokens?: number | null;
      upstreamPath?: string | null;
    }): Promise<SurfaceFailureOutcome> {
      await recordRouteRuntimeExecutionAttemptFailure({
        executionTargetId: args.selected.executionTargetId,
        status: args.failure.status,
        errorText: args.failure.reason,
      });
      const retry = args.willContinue && shouldRetryProxyRequest(args.failure.status, args.failure.reason);
      await log({
        selected: args.selected,
        modelRequested: args.requestedModel,
        status: retry ? 'retried' : 'failed',
        httpStatus: args.failure.status,
        isStream: args.isStream ?? null,
        firstByteLatencyMs: args.firstByteLatencyMs ?? null,
        firstTokenLatencyMs: args.firstTokenLatencyMs ?? null,
        latencyMs: args.latencyMs,
        errorMessage: args.failure.reason,
        retryCount: args.retryCount,
        promptTokens: args.promptTokens,
        completionTokens: args.completionTokens,
        totalTokens: args.totalTokens,
        upstreamPath: args.upstreamPath,
      });

      if (retry) return { action: 'retry' as const };

      runBestEffort('report proxy all failed', () => reportProxyAllFailed({
        model: args.requestedModel,
        reason: args.failure.reason,
      }));

      return {
        action: 'respond',
        status: args.failure.status,
        payload: {
          error: {
            message: args.failure.reason,
            type: 'upstream_error',
          },
        },
      };
    },

    async recordStreamFailure(args: {
      selected: SurfaceSelectedExecutionAttempt;
      requestedModel: string;
      modelName: string;
      errorMessage: string | null;
      isStream?: boolean | null;
      firstByteLatencyMs?: number | null;
      firstTokenLatencyMs?: number | null;
      latencyMs: number;
      retryCount: number;
      promptTokens?: number | null;
      completionTokens?: number | null;
      totalTokens?: number | null;
      upstreamPath?: string | null;
      httpStatus?: number;
      runtimeFailureStatus?: number | null;
    }) {
      const errorMessage = args.errorMessage || 'stream processing failed';
      await recordRouteRuntimeExecutionAttemptFailure({
        executionTargetId: args.selected.executionTargetId,
        status: args.runtimeFailureStatus ?? undefined,
        errorText: errorMessage,
      });
      await log({
        selected: args.selected,
        modelRequested: args.requestedModel,
        status: 'failed',
        httpStatus: args.httpStatus ?? 200,
        isStream: args.isStream ?? null,
        firstByteLatencyMs: args.firstByteLatencyMs ?? null,
        firstTokenLatencyMs: args.firstTokenLatencyMs ?? null,
        latencyMs: args.latencyMs,
        errorMessage,
        retryCount: args.retryCount,
        promptTokens: args.promptTokens,
        completionTokens: args.completionTokens,
        totalTokens: args.totalTokens,
        upstreamPath: args.upstreamPath,
      });
    },
  };
}
