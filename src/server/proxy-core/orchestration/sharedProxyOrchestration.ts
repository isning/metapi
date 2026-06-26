import { formatUtcSqlDateTime } from '../../services/localTimeService.js';
import { resolveChannelProxyUrl, withSiteRecordProxyRequestInit } from '../../services/siteProxy.js';
import type { SiteProxyConfigLike } from '../../services/siteProxy.js';
import { tokenRouter } from '../../services/tokenRouter.js';
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
import { selectProxyTargetForAttempt } from '../targetSelection.js';
import type { RouteExecutionScope } from '../../services/tokenRouter.js';
import { buildProxyLogRouteDecisionSnapshot } from '../../services/proxyLogRouteDecisionSnapshot.js';

type SelectedTarget = Awaited<ReturnType<typeof tokenRouter.selectTarget>>;
type SurfaceWarningScope = string;

type SurfaceSelectedTarget = {
  target: { routeId: number | null; id: number; tokenId?: number | null };
  account: { id: number; username?: string | null };
  site: { name?: string | null };
  token?: { id?: number | null; tokenGroup?: string | null } | null;
  actualModel?: string | null;
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

type SurfaceOauthRefreshSelectedTarget = {
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

type SurfaceSuccessSelectedTarget = SurfaceSelectedTarget & {
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

export async function selectSurfaceChannelForAttempt(input: {
  requestedModel: string;
  downstreamPolicy: DownstreamRoutingPolicy;
  excludeTargetIds: number[];
  retryCount: number;
  stickySessionKey?: string | null;
  forcedTargetId?: number | null;
  routeExecutionScope?: RouteExecutionScope | null;
}): Promise<SelectedTarget> {
  return await selectProxyTargetForAttempt(input);
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

export function bindSurfaceStickyChannel(input: {
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

export function clearSurfaceStickyChannel(input: {
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

export async function acquireSurfaceChannelLease(input: {
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

export function buildSurfaceChannelBusyMessage(waitMs: number): string {
  return waitMs > 0
    ? `Target busy: waited ${waitMs}ms for an available session slot`
    : 'Target busy: no session slot available';
}

export async function writeSurfaceProxyLog(input: {
  warningScope: string;
  selected: {
    target: { routeId: number | null; id: number | null };
    account: { id: number | null };
    actualModel?: string | null;
  };
  modelRequested: string;
  status: string;
  httpStatus: number;
  isStream?: boolean | null;
  firstByteLatencyMs?: number | null;
  latencyMs: number;
  errorMessage: string | null;
  retryCount: number;
  downstreamPath: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  estimatedCost?: number;
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
    const routeDecisionSnapshot = await buildProxyLogRouteDecisionSnapshot({
      selected: input.selected,
      modelRequested: input.modelRequested,
      capturedAt: createdAt,
    });
    await insertProxyLog({
      routeId: input.selected.target.routeId,
      targetId: input.selected.target.id,
      accountId: input.selected.account.id,
      downstreamApiKeyId: input.downstreamApiKeyId ?? null,
      modelRequested: input.modelRequested,
      modelActual: input.selected.actualModel ?? null,
      status: input.status,
      httpStatus: input.httpStatus,
      isStream: input.isStream ?? null,
      firstByteLatencyMs: input.firstByteLatencyMs ?? null,
      latencyMs: input.latencyMs,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      totalTokens: input.totalTokens ?? null,
      estimatedCost: input.estimatedCost ?? 0,
      billingDetails: input.billingDetails ?? null,
      routeDecisionSnapshot,
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
  const channelProxyUrl = resolveChannelProxyUrl(input.site, input.accountExtraConfig);
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
      }, channelProxyUrl),
    })
  );
}

export async function trySurfaceOauthRefreshRecovery<TRequest extends BuiltEndpointRequest>(input: {
  ctx: SurfaceOauthRefreshContext<TRequest>;
  selected: SurfaceOauthRefreshSelectedTarget;
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
    const refreshedTargetUrl = buildUpstreamUrl(input.siteUrl, refreshedRequest.path);
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
  selected: SurfaceSuccessSelectedTarget;
  requestedModel: string;
  modelName: string;
  parsedUsage: SurfaceUsageSummary;
  upstreamUsagePresent?: boolean;
  upstreamHeaders?: { get(name: string): string | null } | null;
  requestStartedAtMs: number;
  isStream?: boolean | null;
  firstByteLatencyMs?: number | null;
  latencyMs: number;
  retryCount: number;
  upstreamPath?: string | null;
  logSuccess: (args: {
    selected: SurfaceSelectedTarget;
    modelRequested: string;
    status: string;
    httpStatus: number;
    isStream?: boolean | null;
    firstByteLatencyMs?: number | null;
    latencyMs: number;
    errorMessage: string | null;
    retryCount: number;
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    usageSource?: 'upstream' | 'self-log' | 'unknown';
    estimatedCost?: number;
    billingDetails?: unknown;
    upstreamPath?: string | null;
  }) => Promise<void>;
  recordDownstreamCost?: (estimatedCost: number) => void;
  bestEffortMetrics?: {
    errorLabel: string;
  };
  suppressLogUsageSource?: boolean;
}): Promise<{
  resolvedUsage: SurfaceResolvedUsageSummary;
  estimatedCost: number;
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
  let estimatedCost = 0;
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

  tokenRouter.recordSuccess(
    input.selected.target.id,
    input.latencyMs,
    estimatedCost,
    input.modelName,
  );
  input.recordDownstreamCost?.(estimatedCost);
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
  warningScope: SurfaceWarningScope;
  downstreamPath: string;
  maxRetries: number;
  clientContext?: DownstreamClientContext | null;
  downstreamApiKeyId?: number | null;
}) {
  const log = async (args: {
    selected: SurfaceSelectedTarget;
    modelRequested: string;
    status: string;
    httpStatus: number;
    isStream?: boolean | null;
    firstByteLatencyMs?: number | null;
    latencyMs: number;
    errorMessage: string | null;
    retryCount: number;
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    usageSource?: 'upstream' | 'self-log' | 'unknown';
    estimatedCost?: number;
    billingDetails?: unknown;
    upstreamPath?: string | null;
  }) => {
    await writeSurfaceProxyLog({
      warningScope: input.warningScope,
      selected: args.selected,
      modelRequested: args.modelRequested,
      status: args.status,
      httpStatus: args.httpStatus,
      isStream: args.isStream ?? null,
      firstByteLatencyMs: args.firstByteLatencyMs ?? null,
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

  const maybeRetry = (retryCount: number) => retryCount < input.maxRetries
    ? { action: 'retry' as const }
    : null;

  const runBestEffort = (label: string, fn: () => Promise<unknown>) => {
    void Promise.resolve()
      .then(fn)
      .catch((error) => {
        console.warn(`[proxy/${input.warningScope}] failed to ${label}`, error);
      });
  };

  return {
    log,
    async handleUpstreamFailure(args: {
      selected: SurfaceSelectedTarget;
      requestedModel: string;
      modelName: string;
      status: number;
      errText: string;
      rawErrText?: string | null;
      isStream?: boolean | null;
      firstByteLatencyMs?: number | null;
      latencyMs: number;
      retryCount: number;
    }): Promise<SurfaceFailureOutcome> {
      const rawErrText = args.rawErrText || args.errText;
      await tokenRouter.recordFailure(args.selected.target.id, {
        status: args.status,
        errorText: rawErrText,
        modelName: args.modelName,
      });
      await log({
        selected: args.selected,
        modelRequested: args.requestedModel,
        status: 'failed',
        httpStatus: args.status,
        isStream: args.isStream ?? null,
        firstByteLatencyMs: args.firstByteLatencyMs ?? null,
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

      if (shouldRetryProxyRequest(args.status, args.errText)) {
        const retry = maybeRetry(args.retryCount);
        if (retry) return retry;
      }

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
      selected: SurfaceSelectedTarget;
      requestedModel: string;
      modelName: string;
      failure: { status: number; reason: string };
      isStream?: boolean | null;
      firstByteLatencyMs?: number | null;
      latencyMs: number;
      retryCount: number;
      promptTokens?: number | null;
      completionTokens?: number | null;
      totalTokens?: number | null;
      upstreamPath?: string | null;
    }): Promise<SurfaceFailureOutcome> {
      await tokenRouter.recordFailure(args.selected.target.id, {
        status: args.failure.status,
        errorText: args.failure.reason,
        modelName: args.modelName,
      });
      await log({
        selected: args.selected,
        modelRequested: args.requestedModel,
        status: 'failed',
        httpStatus: args.failure.status,
        isStream: args.isStream ?? null,
        firstByteLatencyMs: args.firstByteLatencyMs ?? null,
        latencyMs: args.latencyMs,
        errorMessage: args.failure.reason,
        retryCount: args.retryCount,
        promptTokens: args.promptTokens,
        completionTokens: args.completionTokens,
        totalTokens: args.totalTokens,
        upstreamPath: args.upstreamPath,
      });

      if (shouldRetryProxyRequest(args.failure.status, args.failure.reason)) {
        const retry = maybeRetry(args.retryCount);
        if (retry) return retry;
      }

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

    async handleExecutionError(args: {
      selected: SurfaceSelectedTarget;
      requestedModel: string;
      modelName: string;
      errorMessage: string;
      isStream?: boolean | null;
      firstByteLatencyMs?: number | null;
      latencyMs: number;
      retryCount: number;
    }): Promise<SurfaceFailureOutcome> {
      await tokenRouter.recordFailure(args.selected.target.id, {
        errorText: args.errorMessage,
        modelName: args.modelName,
      });
      await log({
        selected: args.selected,
        modelRequested: args.requestedModel,
        status: 'failed',
        httpStatus: 0,
        isStream: args.isStream ?? null,
        firstByteLatencyMs: args.firstByteLatencyMs ?? null,
        latencyMs: args.latencyMs,
        errorMessage: args.errorMessage,
        retryCount: args.retryCount,
      });

      const retry = maybeRetry(args.retryCount);
      if (retry) return retry;

      runBestEffort('report proxy all failed', () => reportProxyAllFailed({
        model: args.requestedModel,
        reason: args.errorMessage || 'network failure',
      }));

      return {
        action: 'respond',
        status: 502,
        payload: {
          error: {
            message: `Upstream error: ${args.errorMessage || 'network failure'}`,
            type: 'upstream_error',
          },
        },
      };
    },

    async recordStreamFailure(args: {
      selected: SurfaceSelectedTarget;
      requestedModel: string;
      modelName: string;
      errorMessage: string | null;
      isStream?: boolean | null;
      firstByteLatencyMs?: number | null;
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
      if (typeof args.runtimeFailureStatus === 'number') {
        await tokenRouter.recordFailure(args.selected.target.id, {
          status: args.runtimeFailureStatus,
          errorText: errorMessage,
          modelName: args.modelName,
        });
      } else {
        await tokenRouter.recordFailure(args.selected.target.id, {
          errorText: errorMessage,
          modelName: args.modelName,
        });
      }
      await log({
        selected: args.selected,
        modelRequested: args.requestedModel,
        status: 'failed',
        httpStatus: args.httpStatus ?? 200,
        isStream: args.isStream ?? null,
        firstByteLatencyMs: args.firstByteLatencyMs ?? null,
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
