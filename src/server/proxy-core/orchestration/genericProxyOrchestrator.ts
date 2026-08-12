import { TextDecoder } from 'node:util';
import { performance } from 'node:perf_hooks';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../../config.js';
import type { RouteExecutionScope } from '../../services/routeExecutionScopeTypes.js';
import { reportProxyAllFailed } from '../../services/alertService.js';
import {
  hasProxyCacheUsagePayload,
  hasProxyUsagePayload,
  mergeProxyUsage,
  parseProxyUsage,
} from '../../services/proxyUsageParser.js';
import { resolveUpstreamEndpointCandidates } from '../../services/upstreamEndpointDerivation.js';
import { loadCredentialApiVariantConfig } from '../../services/credentialEndpointBindingService.js';
import { buildUpstreamEndpointRequest } from '../formats/upstreamRequestBuilder.js';
import {
  getUpstreamEndpointRuntimeStateSnapshot,
  recordUpstreamEndpointFailure,
  recordUpstreamEndpointSuccess,
} from '../../services/upstreamEndpointRuntimeMemory.js';
import {
  ensureModelAllowedForDownstreamKey,
  getDownstreamRoutingPolicy,
  recordDownstreamBillingUsage,
} from '../downstreamPolicy.js';
import { executeEndpointFlow, type BuiltEndpointRequest } from './endpointFlow.js';
import { detectProxyFailure } from '../../services/proxyFailureJudge.js';
import { getProxyAuthContext, getProxyResourceOwner } from '../../middleware/auth.js';
import { getObservedResponseMeta } from '../firstByteTimeout.js';
import { getRuntimeResponseReader, readRuntimeResponseText } from '../executors/types.js';
import { detectDownstreamClientContext } from '../downstreamClientContext.js';
import { getProxyMaxTargetRetries } from '../../services/proxyTargetRetry.js';
import { shouldAbortSameSiteEndpointFallback } from '../../services/proxyRetryPolicy.js';
import { applyOpenAiServiceTierPolicy } from '../serviceTierPolicy.js';
import { maybeHandleWebSearchOnlySimulation } from '../webSearchSimulation.js';
import { buildUpstreamUrl, type UpstreamEndpoint } from './upstreamRequest.js';
import {
  shouldForceResponsesUpstreamStream,
  sanitizeCompactResponsesRequestBody,
  ensureCompactResponsesJsonAcceptHeader,
  shouldFallbackCompactResponsesToResponses,
} from '../capabilities/responsesCompact.js';
import {
  looksLikeResponsesSseText,
  collectResponsesFinalPayloadFromSseText,
  collectResponsesFinalPayloadFromSse,
  createSingleChunkStreamReader,
} from '../runtime/responsesSseFinal.js';
import { isCodexResponsesSurface } from '../cliProfiles/codexProfile.js';
import { protocolAdapters, type CompatibilityEndpoint } from '../formats/protocolAdapters.js';
import {
  buildApiAttemptPlan,
  defaultRequestPathForUpstreamEndpoint,
  endpointCandidatesFromApiAttemptPlan,
  summarizeApiAttemptPlanForDebug,
  type ApiAttempt,
} from '../apiVariants.js';
import {
  acquireSurfaceTargetLease,
  bindSurfaceStickyTarget,
  buildSurfaceTargetBusyMessage,
  buildSurfaceStickySessionKey,
  clearSurfaceStickyTarget,
  createSurfaceRuntimeDecisionSession,
  createSurfaceFailureToolkit,
  createSurfaceDispatchRequest,
  getSurfaceStickyPreferredTargetId,
  markSurfaceExecutionAttemptStarted,
  previewSurfaceRuntimeDecisionInSession,
  recordSurfaceSuccess,
  selectSurfaceRuntimeDecisionInSession,
  trySurfaceOauthRefreshRecovery,
} from './sharedProxyOrchestration.js';
import { runWithSiteApiEndpointPool, SiteApiEndpointRequestError } from '../../services/siteApiEndpointService.js';
import { resolveDispatchUpstreamCompatibilityPolicy } from '../../services/upstreamCompatibilityPolicyResolver.js';
import {
  classifyEndpointObservationFailure,
  recordEndpointModelObservation,
} from '../../services/endpointModelObservationService.js';
import { buildOauthProviderHeaders } from '../../services/oauth/service.js';
import {
  buildSurfaceProxyDebugResponseHeaders,
  captureSurfaceProxyDebugSuccessResponseBody,
  parseSurfaceProxyDebugTextPayload,
  reserveSurfaceProxyDebugAttemptBase,
  safeFinalizeSurfaceProxyDebugTrace,
  safeInsertSurfaceProxyDebugAttempt,
  safeUpdateSurfaceProxyDebugAttempt,
  safeUpdateSurfaceProxyDebugRuntime,
  safeUpdateSurfaceProxyDebugSelection,
  startSurfaceProxyDebugTrace,
} from '../../services/proxyDebugTraceRuntime.js';
import {
  buildForcedExecutionAttemptUnavailableMessage,
  canRetryExecutionAttemptSelection,
  getTesterForcedExecutionAttemptId,
} from '../executionAttemptSelection.js';
import {
  recordRouteRuntimeExecutionAttemptFailure,
} from '../../services/routeRuntimeExecutionService.js';
import { resolvePlatformProfile } from '../platforms/registry.js';
import type { DownstreamProtocolAdapter, TransformedDownstreamRequest } from '../formats/types.js';
import { createConfiguredProtocolAdapter } from '../formats/configuredProtocolAdapter.js';
import {
  endpointTypeFromApiType,
  endpointTypeFromRequest,
  endpointTypeFromUpstreamEndpoint,
} from '../../contracts/upstreamEndpointType.js';
import { getOauthInfoFromAccount } from '../../services/oauth/oauthAccount.js';
import {
  buildCodexSessionResponseStoreKey,
  getCodexSessionResponseId,
  setCodexSessionResponseId,
} from '../runtime/codexSessionResponseStore.js';
import { getCodexSessionHeaderValue } from '../platforms/headers.js';
import { buildCompiledRouteRuntimeRequestSnapshot } from './compiledRouteRuntimeRequest.js';
import { runtimeCapabilityRequiresSingleNativeVariant } from '../capabilities/requestCapabilityRequirement.js';
import {
  bindCompiledRuntimeExecutionDecision,
  completeCompiledRuntimeExecutionSession,
  resumeCompiledRuntimeExecutionSession,
  startCompiledRuntimeExecutionSession,
} from '../../services/compiledRuntimeExecutionSessionService.js';

const EMPTY_PROXY_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

const INTERNAL_RUNTIME_REQUEST_ID_HEADER = 'x-metapi-runtime-request-id';
const RESPONSES_WEBSOCKET_TRANSPORT_HEADER = 'x-metapi-responses-websocket-transport';

function finalizeRetryAsUpstreamFailure(status: number, message: string) {
  return {
    action: 'respond' as const,
    status,
    payload: {
      error: {
        message,
        type: 'upstream_error' as const,
      },
    },
  };
}

function finalizeRetryAsExecutionFailure(message: string) {
  return {
    action: 'respond' as const,
    status: 502,
    payload: {
      error: {
        message: `Upstream error: ${message}`,
        type: 'upstream_error' as const,
      },
    },
  };
}

function formatLoggedUpstreamPath(adapter: DownstreamProtocolAdapter, upstreamPath: string | null | undefined): string | null | undefined {
  if (!upstreamPath || adapter.format !== 'gemini') return upstreamPath;
  return upstreamPath.split('?')[0] || upstreamPath;
}

function prioritizeEndpointCandidates<T extends string>(
  candidates: T[],
  preferredEndpoint?: string | null,
): T[] {
  if (!preferredEndpoint) return candidates;
  const preferredIndex = candidates.findIndex((endpoint) => endpoint === preferredEndpoint);
  if (preferredIndex <= 0) return candidates;
  const next = [...candidates];
  const [preferred] = next.splice(preferredIndex, 1);
  next.unshift(preferred);
  return next;
}

export async function handleGenericSurfaceRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  adapter: DownstreamProtocolAdapter,
  downstreamPath: string,
) {
  const clientContext = detectDownstreamClientContext({
      downstreamPath,
      headers: request.headers as Record<string, unknown>,
      body: request.body,
    });

    const downstreamPolicy = await getDownstreamRoutingPolicy(request);
    const adapterConfig = downstreamPolicy?.protocolAdapterConfigs?.[adapter.format] || {};
    adapter = createConfiguredProtocolAdapter(
      adapter,
      adapterConfig.passthroughHeaders,
      adapterConfig.bodyConstraints,
    );
    const downstreamEndpointType = endpointTypeFromRequest({
      path: downstreamPath,
      downstreamFormat: adapter.format,
    });

    const transformContext = {
      downstreamPath,
      rawUrl: request.raw.url || request.url || '',
      params: (request.params || {}) as Record<string, unknown>,
      query: (request.query || {}) as Record<string, unknown>,
    };
    const transformResult: { value?: TransformedDownstreamRequest; error?: { statusCode: number; payload: unknown } } = adapter.transformRequest
      ? adapter.transformRequest(request.body, request.headers, transformContext)
      : { value: { requestedModel: (request.body as any)?.model, isStream: !!(request.body as any)?.stream, openaiBody: request.body as Record<string, unknown> } };

    if (transformResult.error) {
      return reply.code(transformResult.error.statusCode).send(transformResult.error.payload);
    }

    const transformed = transformResult.value!;
    const {
      requestedModel,
      isStream,
      openaiBody: openAiBody,
      responsesOriginalBody,
      claudeOriginalBody,
      endpointCandidates: fixedEndpointCandidates,
      disableCrossProtocolFallback,
    } = transformed;
    const usesProtocolAdapterRequest = !!(
      adapter.buildUpstreamRequest
      && transformed.upstreamRequestMode === 'protocol_adapter'
    );

    const isCodexSite = isCodexResponsesSurface(request.headers);
    const defaultEncryptedReasoningInclude = isCodexSite;
    const codexSessionId = isCodexSite
      ? getCodexSessionHeaderValue(request.headers as Record<string, string>)
      : '';

    if (adapter.validateRequest) {
      const preflight = adapter.validateRequest(request.body, request.headers as Record<string, unknown>, downstreamPath);
      if (!preflight.ok) {
        return reply.code(preflight.statusCode!).send(preflight.payload);
      }
    }

    if (!await ensureModelAllowedForDownstreamKey(request, reply, requestedModel)) return;
    const forcedExecutionAttemptId = getTesterForcedExecutionAttemptId({
      headers: request.headers as Record<string, unknown>,
      clientIp: request.ip,
    });
    const downstreamApiKeyId = getProxyAuthContext(request)?.keyId ?? null;
    const maxRetries = getProxyMaxTargetRetries();
    const stickySessionKey = buildSurfaceStickySessionKey({
      clientContext,
      requestedModel,
      downstreamPath,
      endpointType: downstreamEndpointType,
      downstreamApiKeyId,
    });

    const simulationHandled = await maybeHandleWebSearchOnlySimulation({
      app: request.server,
      request,
      reply,
      downstreamFormat: adapter.format as any,
      body: request.body as Record<string, unknown>,
      openAiBody,
    });
    if (simulationHandled) return;

    const normalizedOpenAiBody = openAiBody;
    const compiledRouteRequest = buildCompiledRouteRuntimeRequestSnapshot({
      requestedModel,
      payload: request.body,
      normalizedPayload: normalizedOpenAiBody,
      headers: request.headers as Record<string, unknown>,
      method: request.method,
      path: downstreamPath,
      endpointType: downstreamEndpointType,
      query: (request.query || {}) as Record<string, unknown>,
      clientContext,
      downstreamApiKeyId,
    });
    const resumedRequestId = String(request.headers[INTERNAL_RUNTIME_REQUEST_ID_HEADER] || '').trim();
    const executionSession = (
      String(request.headers[RESPONSES_WEBSOCKET_TRANSPORT_HEADER] || '') === '1'
      && resumedRequestId
        ? await resumeCompiledRuntimeExecutionSession(resumedRequestId)
        : null
    ) || await startCompiledRuntimeExecutionSession({
      downstreamPath,
      requestedModel,
      isStream,
      downstreamApiKeyId,
    });
    const runtimeDecisionSession = await createSurfaceRuntimeDecisionSession({
      requestedModel,
      request: compiledRouteRequest,
      downstreamPolicy,
      forcedExecutionAttemptId,
      stickyExecutionTargetId: getSurfaceStickyPreferredTargetId(stickySessionKey),
    });
    const failureToolkit = createSurfaceFailureToolkit({
      requestId: executionSession.requestId,
      executionSession,
      warningScope: adapter.format,
      downstreamPath,
      clientContext,
      downstreamApiKeyId,
    });

    const debugTrace = await startSurfaceProxyDebugTrace({
      downstreamPath,
      requestedModel,
      clientKind: clientContext.clientKind,
      sessionId: clientContext.sessionId || null,
      traceHint: clientContext.traceHint || null,
      downstreamApiKeyId,
      requestHeaders: request.headers as Record<string, unknown>,
      requestBody: request.body,
    });

    let retryCount = 0;
    const excludeTargetIds: number[] = [];
    let routeExecutionScope: RouteExecutionScope | null = null;

    const willContinueAfterFailure = async (status: number, errorText: string): Promise<boolean> => {
      if (!failureToolkit.isRetryable(status, errorText)) return false;
      if (!canRetryExecutionAttemptSelection(retryCount, forcedExecutionAttemptId)) return false;
      return await previewSurfaceRuntimeDecisionInSession({
        session: runtimeDecisionSession,
        excludeTargetIds,
        retryCount: retryCount + 1,
        routeExecutionScope,
      }) !== null;
    };

    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const stickyPreferredTargetId = getSurfaceStickyPreferredTargetId(stickySessionKey);

      const decision = await selectSurfaceRuntimeDecisionInSession({
        session: runtimeDecisionSession,
        excludeTargetIds,
        retryCount: attempt,
        routeExecutionScope,
      });

      if (decision?.kind === 'synthetic_response') {
        const statusCode = decision.statusCode;
        const payload = {
          error: {
            message: decision.message,
            type: statusCode === 429 ? 'rate_limit_error' as const : 'server_error' as const,
          },
        };
        await safeFinalizeSurfaceProxyDebugTrace(debugTrace, {
          finalStatus: 'failure',
          finalHttpStatus: statusCode,
          finalResponseHeaders: {},
          finalResponseBody: {
            ...payload,
            compiledRuntime: {
              terminalNodeId: decision.terminalNodeId,
              terminalKind: decision.kind,
              trace: decision.runtimeTrace,
            },
          },
        });
        await completeCompiledRuntimeExecutionSession(executionSession, {
          status: 'failure',
          httpStatus: statusCode,
          isStream,
          errorMessage: decision.message,
        });
        return reply.code(statusCode).send(payload);
      }
      const selected = decision?.kind === 'execution_attempt' ? decision.attempt : null;

      if (!selected) {
        const noTargetMessage = buildForcedExecutionAttemptUnavailableMessage(forcedExecutionAttemptId);
        await reportProxyAllFailed({
          model: requestedModel,
          reason: forcedExecutionAttemptId ? noTargetMessage : 'No available execution attempts after retries',
        });
        const payload = {
          error: { message: noTargetMessage, type: 'server_error' as const },
        };
        await safeFinalizeSurfaceProxyDebugTrace(debugTrace, {
          finalStatus: 'failure',
          finalHttpStatus: 503,
          finalResponseHeaders: {},
          finalResponseBody: payload,
        });
        await completeCompiledRuntimeExecutionSession(executionSession, {
          status: 'failure',
          httpStatus: 503,
          isStream,
          errorMessage: noTargetMessage,
        });
        return reply.code(503).send({
          error: { message: noTargetMessage, type: 'server_error' },
        });
      }

      excludeTargetIds.push(selected.target.id);
      routeExecutionScope = selected.routeExecutionScope ?? routeExecutionScope;
      const selectedExecutionAttemptId = selected.executionAttemptId;
      await bindCompiledRuntimeExecutionDecision({
        requestId: executionSession.requestId,
        routeEntrypointId: selected.routeEntrypointId,
        runtimeEndpointId: selected.runtimeEndpointId,
        executionAttemptId: selected.executionAttemptId,
        runtimeBundleHash: selected.routeRuntimeSnapshot.compiledRuntime.bundleHash,
        decisionSnapshot: selected.routeRuntimeSnapshot,
      });
      await safeUpdateSurfaceProxyDebugSelection(debugTrace, {
        stickySessionKey,
        stickyHitExecutionAttemptId: (
          stickyPreferredTargetId && stickyPreferredTargetId === selected.target.id
            ? selectedExecutionAttemptId
            : null
        ),
        selectedExecutionAttemptId,
        routeEntrypointId: selected.routeEntrypointId,
        runtimeEndpointId: selected.runtimeEndpointId,
        selectedAccountId: selected.account.id,
        selectedSiteId: selected.site.id,
        selectedSitePlatform: selected.site.platform,
      });

      const modelName = selected.actualModel;
      const runtimePostBuildFilters = selected.postBuildFilters ?? null;
      const platformProfile = resolvePlatformProfile(selected.site.platform);
      const compatibilityPolicy = resolveDispatchUpstreamCompatibilityPolicy({
        defaultCompatibilityPolicy: platformProfile?.defaultCompatibilityPolicy,
        site: selected.site,
        account: selected.account,
        token: selected.token,
        routeEndpointCompatibilityPolicy: selected.routeEndpointCompatibilityPolicy,
        executionAttemptCompatibilityPolicy: selected.executionAttemptCompatibilityPolicy,
      });
      const oauth = getOauthInfoFromAccount(selected.account);

      const codexSessionStoreKey = (
        isCodexSite &&
        codexSessionId
      )
        ? buildCodexSessionResponseStoreKey({
            sessionId: codexSessionId,
            siteId: selected.site.id,
            accountId: selected.account.id,
            targetId: selected.target.id,
          })
        : null;

      const startTime = Date.now();
      const startTimeMonotonicMs = performance.now();
      const leaseResult = await acquireSurfaceTargetLease({
        stickySessionKey,
        selected,
      });
      if (leaseResult.status === 'timeout') {
        clearSurfaceStickyTarget({
          stickySessionKey,
          selected,
        });
        const busyMessage = buildSurfaceTargetBusyMessage(leaseResult.waitMs);
        await failureToolkit.log({
          selected,
          modelRequested: requestedModel,
          status: 'failed',
          httpStatus: 429,
          errorMessage: busyMessage,
          retryCount,
          latencyMs: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          upstreamPath: '[proxy] lease timeout',
        });
        const payload = {
          error: { message: busyMessage, type: 'server_error' as const },
        };
        await safeFinalizeSurfaceProxyDebugTrace(debugTrace, {
          finalStatus: 'failure',
          finalHttpStatus: 429,
          finalResponseHeaders: {},
          finalResponseBody: payload,
        });
        return reply.code(429).send({
          error: { message: busyMessage, type: 'server_error' },
        });
      }

      const targetLease = leaseResult.lease;
      try {
        await markSurfaceExecutionAttemptStarted({ selected });
        const debugAttemptIndex = attempt;

      const finalizeDebugSuccess = async (
        status: number,
        upstreamPath: string,
        headers: Record<string, unknown> | null,
        body: unknown,
      ) => {
        await safeFinalizeSurfaceProxyDebugTrace(debugTrace, {
          finalStatus: 'success',
          finalHttpStatus: status,
          finalUpstreamPath: upstreamPath,
          finalResponseHeaders: headers,
          finalResponseBody: body,
        });
      };

      const finalizeDebugFailure = async (status: number, body: unknown, upstreamPath: string | null) => {
        await safeUpdateSurfaceProxyDebugAttempt(debugTrace, debugAttemptIndex, {
          rawErrorText: typeof body === 'string' ? body : JSON.stringify(body),
        });
        if (attempt === maxRetries - 1) {
          await safeFinalizeSurfaceProxyDebugTrace(debugTrace, {
            finalStatus: 'failure',
            finalHttpStatus: status,
            finalUpstreamPath: upstreamPath || '[proxy] unknown path',
            finalResponseHeaders: {},
            finalResponseBody: body,
          });
        }
      };

      const isCompactRequest = downstreamPath.endsWith('/compact');
      const forceResponsesUpstreamStream = shouldForceResponsesUpstreamStream({
        sitePlatform: selected.site.platform,
        isCompactRequest,
      });

      const executeEndpointResultForSiteApiBaseUrl = async (
        siteApiBaseUrl: string,
        basePathMode?: 'protocol_default' | 'complete_api_prefix',
      ) => {
        const appendRequestUrlSuffix = (requestUrl: string | undefined, suffix: string): string | undefined => {
          const trimmed = String(requestUrl || '').trim();
          if (!trimmed) return undefined;
          return `${trimmed.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`;
        };
        const targetUrlForAttemptPath = (
          requestUrl: string | undefined,
          endpoint: UpstreamEndpoint,
          requestPath: string,
        ): string | undefined => {
          const trimmed = String(requestUrl || '').trim();
          if (!trimmed) return undefined;
          const defaultPath = defaultRequestPathForUpstreamEndpoint(endpoint);
          if (requestPath === defaultPath) return trimmed;
          if (requestPath.startsWith(`${defaultPath}/`) || requestPath.startsWith(`${defaultPath}?`)) {
            return `${trimmed.replace(/\/+$/, '')}${requestPath.slice(defaultPath.length)}`;
          }
          return buildUpstreamUrl(siteApiBaseUrl, requestPath, { basePathMode });
        };
        const buildEndpointRequest = (endpoint: UpstreamEndpoint, apiAttempt?: ApiAttempt) => {
          const upstreamStream = isStream || (forceResponsesUpstreamStream && endpoint === 'responses');
          const passthroughHeaders = adapter.extractPassthroughHeaders(request.headers as Record<string, unknown>);
          const platformHeaders = buildOauthProviderHeaders({
            account: selected.account,
            downstreamHeaders: request.headers as Record<string, unknown>,
          });

          if (usesProtocolAdapterRequest && adapter.buildUpstreamRequest) {
            const currentOauth = getOauthInfoFromAccount(selected.account);
            const adapterRequest = adapter.buildUpstreamRequest({
              endpoint,
              modelName,
              requestedModel,
              isStream: upstreamStream,
              tokenValue: selected.tokenValue,
              oauth: currentOauth,
              site: selected.site,
              account: selected.account,
              downstreamHeaders: request.headers as Record<string, unknown>,
              passthroughHeaders,
              platformHeaders,
              transformed,
              runtimePostBuildFilters,
              compatibilityPolicy,
            });
            return {
              ...adapterRequest,
              targetUrl: targetUrlForAttemptPath(apiAttempt?.requestUrl, endpoint, adapterRequest.path),
            };
          }

          let finalOpenAiBody = openAiBody;
          let finalResponsesOriginalBody = responsesOriginalBody;

          if (endpoint === 'responses') {
            const serviceTierPolicy = applyOpenAiServiceTierPolicy({
              body: responsesOriginalBody || openAiBody,
              context: {
                requestedModel,
                actualModel: modelName,
                sitePlatform: selected.site.platform,
                accountType: oauth?.planType,
              },
              rules: (config as any).openAiServiceTierRules,
            });
            if (!serviceTierPolicy.ok) {
              const error = new SiteApiEndpointRequestError(serviceTierPolicy.payload.error.message, {
                status: serviceTierPolicy.statusCode,
                rawErrText: JSON.stringify(serviceTierPolicy.payload),
              });
              (error as SiteApiEndpointRequestError & { serviceTierBlocked?: boolean }).serviceTierBlocked = true;
              throw error;
            }
            if (responsesOriginalBody) {
              finalResponsesOriginalBody = serviceTierPolicy.body;
            } else {
              finalOpenAiBody = serviceTierPolicy.body;
            }
          }

          const finalResponsesOriginalBodyWithContinuation = (
            endpoint === 'responses'
            && isCodexSite
            && codexSessionStoreKey
            && finalResponsesOriginalBody
            && protocolAdapters.responses.shouldInferPreviousResponseId(
              finalResponsesOriginalBody,
              getCodexSessionResponseId(codexSessionStoreKey),
            )
          )
            ? protocolAdapters.responses.withPreviousResponseId(
              finalResponsesOriginalBody,
              getCodexSessionResponseId(codexSessionStoreKey)!,
            )
            : finalResponsesOriginalBody;

          const endpointRequest = buildUpstreamEndpointRequest({
            endpoint,
            modelName,
            stream: upstreamStream,
            tokenValue: selected.tokenValue,
            oauthProvider: oauth?.provider,
            oauthProjectId: oauth?.projectId,
            sitePlatform: selected.site.platform,
            siteUrl: siteApiBaseUrl,
            openaiBody: finalOpenAiBody,
            downstreamFormat: adapter.format as any,
            responsesOriginalBody: finalResponsesOriginalBodyWithContinuation,
            claudeOriginalBody,
            downstreamHeaders: request.headers as Record<string, unknown>,
            passthroughHeaders,
            platformHeaders,
            codexExplicitSessionId: codexSessionId || null,
            runtimePostBuildFilters,
            compatibilityPolicy,
          });
          const upstreamPath = (
            isCompactRequest && endpoint === 'responses'
              ? `${endpointRequest.path}/compact`
              : endpointRequest.path
          );
          const requestBody = (
            isCompactRequest && endpoint === 'responses'
              ? sanitizeCompactResponsesRequestBody(endpointRequest.body as Record<string, unknown>, {
                  sitePlatform: selected.site.platform,
                })
              : endpointRequest.body as Record<string, unknown>
          );
          const requestHeaders = (
            isCompactRequest && endpoint === 'responses'
              ? ensureCompactResponsesJsonAcceptHeader(endpointRequest.headers, {
                  sitePlatform: selected.site.platform,
                })
              : endpointRequest.headers
          );
          const headersWithProfileDefaults = {
            ...(apiAttempt?.defaultHeaders || {}),
            ...requestHeaders,
          };
          return {
            endpoint,
            path: upstreamPath,
            targetUrl: (
              isCompactRequest && endpoint === 'responses'
                ? appendRequestUrlSuffix(apiAttempt?.requestUrl, 'compact')
                : targetUrlForAttemptPath(apiAttempt?.requestUrl, endpoint, upstreamPath)
            ),
            headers: headersWithProfileDefaults,
            body: requestBody,
            runtime: endpointRequest.runtime,
          };
        };

        const baseDispatchRequest = createSurfaceDispatchRequest({
          site: selected.site,
          siteUrl: siteApiBaseUrl,
          accountExtraConfig: selected.account.extraConfig,
        });

        const dispatchRequest = (
          endpointRequest: BuiltEndpointRequest,
          targetUrl?: string,
          signal?: AbortSignal,
        ) => {
          if (platformProfile?.runSessionTask && endpointRequest.path.startsWith('/responses')) {
            return platformProfile.runSessionTask(
              {
                siteId: selected.site.id,
                accountId: selected.account.id,
                targetId: selected.target.id,
                headers: endpointRequest.headers as Record<string, string>,
                codexSessionStoreKey: codexSessionStoreKey || null,
              },
              () => baseDispatchRequest(endpointRequest, targetUrl, signal),
            );
          }
          return baseDispatchRequest(endpointRequest, targetUrl, signal);
        };

        const surfaceCapabilityHints = transformed.surfaceCapabilityHints || {};
        const conversationFileSummary = surfaceCapabilityHints.conversationFileSummary;
        const hasNonImageFileInput = surfaceCapabilityHints.hasNonImageFileInput === true;
        const prefersNativeResponsesReasoning = surfaceCapabilityHints.wantsNativeResponsesReasoning === true;
        const requiresNativeResponsesFileUrl = surfaceCapabilityHints.requiresNativeResponsesFileUrl === true;

        const rawCandidates = fixedEndpointCandidates || (usesProtocolAdapterRequest
          ? await resolveUpstreamEndpointCandidates(
              { site: selected.site, account: selected.account },
              modelName,
              adapter.format === 'openai/chat' ? 'openai' : adapter.format,
              requestedModel,
              {
                hasNonImageFileInput,
                conversationFileSummary,
                wantsNativeResponsesReasoning: prefersNativeResponsesReasoning,
              },
              {
                operationHint: transformed.operationHint as any,
                requiresNativeResponsesFileUrl,
                runtimeCapabilityRequirement: transformed.runtimeCapabilityRequirement,
              },
            )
          : isCompactRequest
          ? await resolveUpstreamEndpointCandidates(
              { site: selected.site, account: selected.account },
              modelName,
              'responses',
              requestedModel,
              {
                hasNonImageFileInput,
                conversationFileSummary,
                wantsNativeResponsesReasoning: prefersNativeResponsesReasoning,
              },
              {
                operationHint: 'responses-compact',
                requiresNativeResponsesFileUrl,
                runtimeCapabilityRequirement: transformed.runtimeCapabilityRequirement,
              },
            )
          : await resolveUpstreamEndpointCandidates(
              { site: selected.site, account: selected.account },
              modelName,
              adapter.format === 'openai/chat' ? 'openai' : adapter.format,
              requestedModel,
              {
                hasNonImageFileInput,
                conversationFileSummary,
                wantsNativeResponsesReasoning: prefersNativeResponsesReasoning,
              },
              {
                requiresNativeResponsesFileUrl,
                runtimeCapabilityRequirement: transformed.runtimeCapabilityRequirement,
              },
            ));
        const candidates = prioritizeEndpointCandidates(
          rawCandidates,
          runtimePostBuildFilters?.endpointPreference,
        );
        const endpointFallbackDisabled = (
          !!disableCrossProtocolFallback
          || isCompactRequest
          || config.disableCrossProtocolFallback
          || runtimeCapabilityRequiresSingleNativeVariant(transformed.runtimeCapabilityRequirement)
        );
        const apiVariantConfig = await loadCredentialApiVariantConfig({
          siteId: selected.site.id,
          accountId: selected.account.id,
          tokenId: selected.token?.id ?? selected.target.tokenId ?? null,
          modelName,
        });
        const credentialKey = apiVariantConfig?.credentialKey.credentialKey ?? (
          selected.token?.id || selected.target.tokenId
            ? `account-token:${selected.token?.id ?? selected.target.tokenId}`
            : `account:${selected.account.id}`
        );
        const apiAttemptPlan = buildApiAttemptPlan({
          siteId: selected.site.id,
          credentialId: credentialKey,
          modelName,
          canonicalModel: modelName,
          endpointCandidates: candidates,
          endpointProfiles: apiVariantConfig?.endpointProfiles,
          credentialEndpointBindings: apiVariantConfig?.credentialEndpointBindings,
          endpointModelObservations: apiVariantConfig?.endpointModelObservations,
          siteUrl: siteApiBaseUrl,
          basePathMode,
          disableCrossProtocolFallback: endpointFallbackDisabled,
          runtimeCapabilityRequirement: transformed.runtimeCapabilityRequirement,
        });
        const plannedCandidates = endpointCandidatesFromApiAttemptPlan(apiAttemptPlan);
        const plannedAttempts = apiAttemptPlan.attempts;
        const syncApiAttemptOrderToCandidates = () => {
          const endpointRank = new Map(plannedCandidates.map((endpoint, index) => [endpoint, index]));
          plannedAttempts.sort((left, right) => {
            const leftRank = endpointRank.get(left.upstreamEndpoint) ?? Number.MAX_SAFE_INTEGER;
            const rightRank = endpointRank.get(right.upstreamEndpoint) ?? Number.MAX_SAFE_INTEGER;
            if (leftRank !== rightRank) return leftRank - rightRank;
            return 0;
          });
        };

        const endpointRuntimeContext = {
          siteId: selected.site.id,
          modelName,
          downstreamFormat: (adapter.format === 'responses'
            ? 'responses'
            : adapter.format === 'openai/chat'
              ? 'openai'
              : adapter.format) as any,
          requestedModelHint: requestedModel,
          surfaceCapabilityHints: {
            hasNonImageFileInput,
            conversationFileSummary,
            wantsNativeResponsesReasoning: prefersNativeResponsesReasoning,
          },
        };

        await safeUpdateSurfaceProxyDebugRuntime(debugTrace, {
          protocol: {
            endpointCandidates: plannedCandidates,
            apiAttemptPlan: summarizeApiAttemptPlanForDebug(apiAttemptPlan),
          },
          runtimeState: getUpstreamEndpointRuntimeStateSnapshot(endpointRuntimeContext),
          context: {
            retryCount,
            downstreamFormat: adapter.format,
            stickySessionKey,
            stickyPreferredTargetId,
            oauthProvider: oauth?.provider || null,
            isCodexSite,
            isCompactRequest,
            credentialKey,
            runtimeCapabilityRequirement: transformed.runtimeCapabilityRequirement ?? null,
          },
        });

        if (plannedCandidates.length === 0) {
          return {
            ok: false as const,
            status: 503,
            errText: 'No available targets for this model',
          };
        }
        const debugAttemptBase = reserveSurfaceProxyDebugAttemptBase(debugTrace, plannedCandidates.length);
        const getDebugAttemptIndex = (endpointIndex: number) => debugAttemptBase + endpointIndex;

        const endpointStrategy = usesProtocolAdapterRequest
          ? null
          : adapter.format === 'responses'
          ? protocolAdapters.responses.createEndpointStrategy({
              isStream: isStream || forceResponsesUpstreamStream,
              requiresNativeResponsesFileUrl,
              sitePlatform: selected.site.platform,
              dispatchRequest,
            })
          : protocolAdapters.chat.createEndpointStrategy({
              downstreamFormat: adapter.format.startsWith('openai') ? 'openai' : (adapter.format.startsWith('claude') || adapter.format.startsWith('anthropic') ? 'claude' : adapter.format) as any,
              endpointCandidates: plannedCandidates as CompatibilityEndpoint[],
              modelName,
              requestedModelHint: requestedModel,
              sitePlatform: selected.site.platform,
              isStream,
              buildRequest: (opts) => buildEndpointRequest(opts.endpoint as CompatibilityEndpoint) as any,
              dispatchRequest: dispatchRequest as any,
            });

        const tryRecover = async (ctx: any) => {
          const status = ctx.response.status;
          const res = ctx.response;
          const rawErrText = ctx.rawErrText;
          const oauthProfile = oauth?.provider ? resolvePlatformProfile(oauth.provider) : null;
          const shouldTryOauth = (
            platformProfile?.shouldTryOAuthRecovery?.({ status, response: res, rawErrText })
            || oauthProfile?.shouldTryOAuthRecovery?.({ status, response: res, rawErrText })
            || (status === 401)
          ) ?? false;
          if (shouldTryOauth && oauth) {
            const recovered = await trySurfaceOauthRefreshRecovery({
              ctx,
              selected,
              siteUrl: siteApiBaseUrl,
              buildRequest: (endpoint) => buildEndpointRequest(endpoint as CompatibilityEndpoint, ctx.apiAttempt as ApiAttempt | undefined),
              dispatchRequest,
            });
            if (recovered?.upstream?.ok) {
              return recovered;
            }
          }
          const compactFallbackEnabled = config.responsesCompactFallbackToResponsesEnabled;
          if (
            isCompactRequest
            && compactFallbackEnabled
            && ctx.request.endpoint === 'responses'
            && ctx.request.path.endsWith('/responses/compact')
            && shouldFallbackCompactResponsesToResponses({
              status: ctx.response.status,
              rawErrText: ctx.rawErrText,
              requestPath: ctx.request.path,
            })
          ) {
            const normalizedSitePlatform = String(selected.site.platform || '').trim().toLowerCase();
            const recoveredUpstreamStream = shouldForceResponsesUpstreamStream({
              sitePlatform: selected.site.platform,
              isCompactRequest: false,
            });
            const recoveredHeaders = { ...ctx.request.headers } as Record<string, string>;
            delete (recoveredHeaders as Record<string, unknown>).Accept;
            if (recoveredUpstreamStream) {
              recoveredHeaders.accept = 'text/event-stream';
            }
            const recoveredBody = !!ctx.request.body && typeof ctx.request.body === 'object'
              ? { ...ctx.request.body }
              : ctx.request.body;
            if (!!recoveredBody && typeof recoveredBody === 'object') {
              if (recoveredUpstreamStream) {
                (recoveredBody as any).stream = true;
              }
              if (normalizedSitePlatform === 'codex' || normalizedSitePlatform === 'sub2api') {
                (recoveredBody as any).store = false;
              }
            }
            const recoveredRequest = {
              ...ctx.request,
              path: ctx.request.path.replace(/\/compact$/, ''),
              headers: recoveredHeaders,
              body: recoveredBody,
            };
            const recoveredResponse = await dispatchRequest(recoveredRequest);
            if (recoveredResponse.ok) {
              return {
                upstream: recoveredResponse,
                upstreamPath: recoveredRequest.path,
                request: recoveredRequest,
              };
            }
            ctx.request = recoveredRequest;
            ctx.response = recoveredResponse;
            ctx.rawErrText = await readRuntimeResponseText(recoveredResponse).catch(() => 'unknown error');
          }
          return endpointStrategy?.tryRecover(ctx) ?? null;
        };

        return executeEndpointFlow({
          siteUrl: siteApiBaseUrl,
          disableCrossProtocolFallback: endpointFallbackDisabled,
          firstByteTimeoutMs: Math.max(0, Math.trunc((config.proxyFirstByteTimeoutSec || 0) * 1000)),
          endpointCandidates: plannedCandidates,
          apiAttempts: plannedAttempts,
          buildRequest: (endpoint, _endpointIndex, apiAttempt) => buildEndpointRequest(endpoint as CompatibilityEndpoint, apiAttempt),
          dispatchRequest,
          tryRecover,
          shouldDowngrade: endpointStrategy?.shouldDowngrade as ((ctx: any) => boolean) | undefined,
          onDowngrade: async (ctx) => {
            if (!endpointStrategy) return;
            protocolAdapters.chat.promoteRequiredEndpointCandidateAfterProtocolError(plannedCandidates as CompatibilityEndpoint[], {
              currentEndpoint: ctx.request.endpoint as CompatibilityEndpoint,
              upstreamErrorText: ctx.rawErrText,
            });
            syncApiAttemptOrderToCandidates();
            await safeUpdateSurfaceProxyDebugAttempt(debugTrace, getDebugAttemptIndex(ctx.endpointIndex), {
              downgradeDecision: true,
              downgradeReason: 'api_variant_fallback',
              fallbackScope: 'api_variant',
              failureClass: 'protocol_mismatch',
            });
          },
          shouldAbortRemainingEndpoints: (ctx) => shouldAbortSameSiteEndpointFallback(
            ctx.response.status,
            ctx.rawErrText || ctx.errText,
          ),
          onAttemptFailure: async (ctx) => {
            const status = ctx.response.status || 502;
            const memoryWrite = recordUpstreamEndpointFailure({
              ...endpointRuntimeContext,
              endpoint: ctx.request.endpoint,
              status,
              errorText: ctx.rawErrText,
            });
            const observationFailure = classifyEndpointObservationFailure({
              status,
              errorText: ctx.rawErrText || ctx.errText,
            });
            await recordEndpointModelObservation({
              siteId: selected.site.id,
              credentialKey,
              apiEndpointProfileId: ctx.apiAttempt?.apiEndpointProfileId,
              modelName,
              status: observationFailure.status,
              failureClass: observationFailure.failureClass,
              metadata: {
                endpoint: ctx.request.endpoint,
                requestUrl: ctx.targetUrl,
              },
            }).catch(() => undefined);
            await safeInsertSurfaceProxyDebugAttempt(debugTrace, {
              attemptIndex: getDebugAttemptIndex(ctx.endpointIndex),
              endpoint: ctx.request.endpoint,
              requestPath: ctx.request.path,
              targetUrl: ctx.targetUrl,
              runtimeExecutor: ctx.request.runtime?.executor ?? 'default',
              requestHeaders: ctx.request.headers,
              requestBody: ctx.request.body,
              responseStatus: status,
              responseHeaders: buildSurfaceProxyDebugResponseHeaders(ctx.response),
              responseBody: parseSurfaceProxyDebugTextPayload(ctx.rawErrText),
              rawErrorText: ctx.rawErrText || ctx.errText,
              recoverApplied: ctx.recoverApplied === true,
              memoryWrite,
            });
          },
          onAttemptSuccess: async (ctx) => {
            const memoryWrite = recordUpstreamEndpointSuccess({
              ...endpointRuntimeContext,
              endpoint: ctx.request.endpoint,
            });
            await recordEndpointModelObservation({
              siteId: selected.site.id,
              credentialKey,
              apiEndpointProfileId: ctx.apiAttempt?.apiEndpointProfileId,
              modelName,
              status: 'confirmed',
              metadata: {
                endpoint: ctx.request.endpoint,
                requestUrl: ctx.targetUrl,
              },
            }).catch(() => undefined);
            await safeInsertSurfaceProxyDebugAttempt(debugTrace, {
              attemptIndex: getDebugAttemptIndex(ctx.endpointIndex),
              endpoint: ctx.request.endpoint,
              requestPath: ctx.request.path,
              targetUrl: ctx.targetUrl,
              runtimeExecutor: ctx.request.runtime?.executor ?? 'default',
              requestHeaders: ctx.request.headers,
              requestBody: ctx.request.body,
              responseStatus: ctx.response.status,
              responseHeaders: buildSurfaceProxyDebugResponseHeaders(ctx.response),
              responseBody: await captureSurfaceProxyDebugSuccessResponseBody(debugTrace, ctx),
              recoverApplied: ctx.recoverApplied === true,
              memoryWrite,
            });
          },
        });
      };

      let endpointResult: Awaited<ReturnType<typeof executeEndpointFlow>> | null = null;
      try {
        endpointResult = typeof selected.site.id === 'number'
          ? await runWithSiteApiEndpointPool(selected.site, async (target) => {
            const result = await executeEndpointResultForSiteApiBaseUrl(
              target.baseUrl,
              target.endpoint?.basePathMode as 'protocol_default' | 'complete_api_prefix' | undefined,
            );
            if (!result.ok) {
              const upstreamFailure = new SiteApiEndpointRequestError(result.errText || 'unknown error', {
                status: result.status || 502,
                rawErrText: result.rawErrText || result.errText || 'unknown error',
              }) as SiteApiEndpointRequestError & { siteApiEndpointUpstreamFailure?: boolean };
              upstreamFailure.siteApiEndpointUpstreamFailure = true;
              throw upstreamFailure;
            }
            return result;
          })
          : await executeEndpointResultForSiteApiBaseUrl(selected.site.url);
      } catch (err: any) {
        clearSurfaceStickyTarget({
          stickySessionKey,
          selected,
        });
        const endpointFailureStatus = typeof err?.status === 'number' ? err.status : null;
        if (endpointFailureStatus && err?.payload) {
          await failureToolkit.log({
            selected,
            modelRequested: requestedModel,
            status: 'failed',
            httpStatus: endpointFailureStatus,
            errorMessage: err.message || 'Upstream request build failed',
            retryCount,
            latencyMs: Date.now() - startTime,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            upstreamPath: '[proxy] request build failed',
          });
          try {
            await recordRouteRuntimeExecutionAttemptFailure({
              executionTargetId: selected.executionTargetId,
              status: endpointFailureStatus,
              errorText: err.message || 'Upstream request build failed',
            });
          } catch {
            // best effort only
          }
          await finalizeDebugFailure(endpointFailureStatus, err.payload, null);
          return reply.code(endpointFailureStatus).send(err.payload);
        }
        const isSiteApiEndpointFailure = (
          err instanceof SiteApiEndpointRequestError
          || err?.name === 'SiteApiEndpointRequestError'
          || err?.siteApiEndpointUpstreamFailure === true
          || err?.serviceTierBlocked === true
          || (endpointFailureStatus !== null && endpointFailureStatus >= 500)
        );

        if (err?.serviceTierBlocked === true) {
          let payload: unknown = null;
          try {
            payload = JSON.parse(err.rawErrText || '');
          } catch {
            payload = {
              error: {
                message: err.message || 'service_tier is blocked by policy',
                type: 'invalid_request_error',
              },
            };
          }
          await finalizeDebugFailure(endpointFailureStatus || 400, payload, null);
          return reply.code(endpointFailureStatus || 400).send(payload);
        }

        if (isSiteApiEndpointFailure) {
          const failureStatus = endpointFailureStatus || 502;
          const failureMessage = err.message || 'unknown error';
          const failureOutcome = await failureToolkit.handleUpstreamFailure({
            selected,
            requestedModel,
            modelName,
            status: failureStatus,
            errText: failureMessage,
            rawErrText: err.rawErrText || err.message || 'unknown error',
            isStream,
            latencyMs: Date.now() - startTime,
            retryCount,
            willContinue: await willContinueAfterFailure(failureStatus, failureMessage),
          });
          if (failureOutcome.action === 'retry') {
            retryCount += 1;
            continue;
          }
          await finalizeDebugFailure(
            failureOutcome.status,
            failureOutcome.payload,
            null,
          );
          return reply.code(failureOutcome.status).send(failureOutcome.payload);
        }

        const failureOutcome = await failureToolkit.handleUpstreamFailure({
          selected,
          requestedModel,
          modelName,
          status: 502,
          errText: err.message || 'Upstream request failed',
          rawErrText: err.message || 'Upstream request failed',
          isStream,
          latencyMs: Date.now() - startTime,
          retryCount,
          willContinue: await willContinueAfterFailure(502, err.message || 'Upstream request failed'),
        });
        const outcome = finalizeRetryAsExecutionFailure(err.message);
        if (
          failureOutcome.action === 'retry'
          && canRetryExecutionAttemptSelection(retryCount, forcedExecutionAttemptId)
        ) {
          retryCount += 1;
          continue;
        }
        await finalizeDebugFailure(outcome.status, outcome.payload, null);
        return reply.code(outcome.status).send(outcome.payload);
      }
      if (!endpointResult!.ok) {
        const status = endpointResult!.status || 502;
        const failureOutcome = await failureToolkit.handleUpstreamFailure({
          selected,
          requestedModel,
          modelName,
          status,
          errText: endpointResult!.errText || 'Upstream request failed',
          rawErrText: endpointResult!.rawErrText || endpointResult!.errText || 'Upstream request failed',
          isStream,
          latencyMs: Date.now() - startTime,
          retryCount,
          willContinue: await willContinueAfterFailure(
            status,
            endpointResult!.errText || 'Upstream request failed',
          ),
        });
        if (failureOutcome.action === 'retry') {
          retryCount += 1;
          continue;
        }
        const payload = {
          error: {
            message: endpointResult!.errText || 'Upstream request failed',
            type: status === 503 ? 'server_error' as const : 'upstream_error' as const,
          },
        };
        await finalizeDebugFailure(failureOutcome.status, failureOutcome.payload || payload, null);
        return reply.code(failureOutcome.status).send(failureOutcome.payload || payload);
      }
      const upstream = endpointResult!.upstream;
      const successfulUpstreamPath = endpointResult!.upstreamPath;
      const successfulEndpointType = endpointTypeFromRequest({
        path: successfulUpstreamPath,
        downstreamFormat: endpointTypeFromApiType(endpointResult!.apiType)
          || endpointTypeFromUpstreamEndpoint(endpointResult!.request.endpoint),
      });
      const firstByteLatencyMs = getObservedResponseMeta(upstream)?.firstByteLatencyMs ?? null;

      if (isStream) {
        const upstreamContentType = (upstream.headers.get('content-type') || '').toLowerCase();
        let streamStarted = false;
        let firstTokenLatencyMs: number | null = null;
        const markFirstToken = () => {
          if (firstTokenLatencyMs != null) return;
          firstTokenLatencyMs = Math.max(1, Math.round(performance.now() - startTimeMonotonicMs));
        };
        const startSseResponse = () => {
          if (streamStarted) return;
          streamStarted = true;
          reply.hijack();
          reply.raw.statusCode = 200;
          reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
          reply.raw.setHeader('Connection', 'keep-alive');
          reply.raw.setHeader('X-Accel-Buffering', 'no');
        };

      let parsedUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        promptTokensIncludeCache: null as boolean | null,
      };
      let upstreamUsagePresent = false;
      let upstreamCacheUsagePresent = false;
      const recordStreamSuccess = async (latencyMs: number) => {
        await recordSurfaceSuccess({
          selected,
          requestedModel,
          modelName,
          parsedUsage,
          upstreamUsagePresent,
          upstreamCacheUsagePresent,
          upstreamHeaders: upstream.headers,
          requestStartedAtMs: startTime,
          isStream: true,
          firstByteLatencyMs,
          firstTokenLatencyMs,
          latencyMs,
          retryCount,
          upstreamPath: formatLoggedUpstreamPath(adapter, successfulUpstreamPath),
          contentAffinityKey: clientContext.contentAffinityKey,
          endpointType: successfulEndpointType,
          requestEndpointType: downstreamEndpointType,
          logSuccess: failureToolkit.log,
          recordDownstreamBilling: (billing) => recordDownstreamBillingUsage(request, billing),
          bestEffortMetrics: {
            errorLabel: '[proxy/generic] failed to record success metrics',
          },
          suppressLogUsageSource: adapter.format === 'gemini',
        });
      };

      const writeLines = (lines: string[]) => {
        startSseResponse();
        for (const line of lines) {
          reply.raw.write(line);
        }
      };
      const streamResponse = {
        end() {
          if (streamStarted) {
            reply.raw.end();
          }
        },
      };

      if (!adapter.createStreamSession) {
        throw new Error(`Downstream protocol adapter ${adapter.format} must implement createStreamSession for streaming`);
      }

      const streamSession = adapter.createStreamSession({
        downstreamFormat: adapter.format.startsWith('openai') ? 'openai' : (adapter.format.startsWith('claude') || adapter.format.startsWith('anthropic') ? 'claude' : adapter.format),
        modelName,
        successfulUpstreamPath,
        getUsage: () => parsedUsage,
        onParsedPayload: (payload: unknown) => {
          if (payload && typeof payload === 'object') {
            upstreamUsagePresent = upstreamUsagePresent || hasProxyUsagePayload(payload);
            upstreamCacheUsagePresent = upstreamCacheUsagePresent || hasProxyCacheUsagePayload(payload);
            parsedUsage = mergeProxyUsage(parsedUsage, parseProxyUsage(payload));
          }
        },
        onMeaningfulOutput: markFirstToken,
        writeLines,
        writeRaw: (chunk: string | Buffer) => {
          startSseResponse();
          reply.raw.write(chunk);
        },
        policy: downstreamPolicy,
        extraContext: transformed.extraContext,
      } as any);

      let rawText = '';
      if (!upstreamContentType.includes('text/event-stream')) {
        const fallbackText = await readRuntimeResponseText(upstream);
        rawText = fallbackText;
        if (looksLikeResponsesSseText(fallbackText)) {
          const streamResult = await streamSession.run(
            createSingleChunkStreamReader(fallbackText),
            streamResponse,
          );
          const latency = Date.now() - startTime;
          if (streamResult.status === 'failed') {
            clearSurfaceStickyTarget({
              stickySessionKey,
              selected,
            });
            await failureToolkit.recordStreamFailure({
              selected,
              requestedModel,
              modelName,
              errorMessage: streamResult.errorMessage,
              isStream: true,
              firstByteLatencyMs,
              firstTokenLatencyMs,
              latencyMs: latency,
              retryCount,
              promptTokens: parsedUsage.promptTokens,
              completionTokens: parsedUsage.completionTokens,
              totalTokens: parsedUsage.totalTokens,
              upstreamPath: successfulUpstreamPath,
            });
            await finalizeDebugFailure(502, {
              error: {
                message: streamResult.errorMessage,
                type: 'stream_error',
              },
            }, successfulUpstreamPath);
            if (!streamStarted) {
              return reply.code(502).send({
                error: {
                  message: streamResult.errorMessage,
                  type: 'upstream_error',
                },
              });
            }
            return;
          }
          await recordStreamSuccess(latency);
          await finalizeDebugSuccess(
            200,
            successfulUpstreamPath,
            buildSurfaceProxyDebugResponseHeaders(upstream) ?? {},
            debugTrace?.options.captureStreamChunks
              ? fallbackText
              : {
                  stream: true,
                  usage: parsedUsage,
                },
          );
          bindSurfaceStickyTarget({
            stickySessionKey,
            selected,
          });
          return;
        }

        let fallbackData: unknown = null;
        try {
          fallbackData = JSON.parse(fallbackText);
        } catch {
          fallbackData = fallbackText;
        }
        if (String(selected.site.platform || '').trim().toLowerCase() === 'gemini-cli') {
          fallbackData = protocolAdapters.geminiCli.unwrapPayload(fallbackData);
        }
        upstreamUsagePresent = upstreamUsagePresent || hasProxyUsagePayload(fallbackData);
        upstreamCacheUsagePresent = upstreamCacheUsagePresent || hasProxyCacheUsagePayload(fallbackData);
        parsedUsage = mergeProxyUsage(parsedUsage, parseProxyUsage(fallbackData));
        const latency = Date.now() - startTime;
        const failure = detectProxyFailure({ rawText, usage: parsedUsage });
        if (failure) {
          clearSurfaceStickyTarget({
            stickySessionKey,
            selected,
          });
          const failureOutcome = await failureToolkit.handleDetectedFailure({
            selected,
            requestedModel,
            modelName,
            failure,
            isStream: true,
            firstByteLatencyMs,
            firstTokenLatencyMs,
            latencyMs: latency,
            retryCount,
            willContinue: await willContinueAfterFailure(failure.status, failure.reason),
            promptTokens: parsedUsage.promptTokens,
            completionTokens: parsedUsage.completionTokens,
            totalTokens: parsedUsage.totalTokens,
            upstreamPath: successfulUpstreamPath,
          });
          if (failureOutcome.action === 'retry') {
            retryCount += 1;
            continue;
          }
          await finalizeDebugFailure(
            failureOutcome.status,
            failureOutcome.payload,
            successfulUpstreamPath,
          );
          return reply.code(failureOutcome.status).send(failureOutcome.payload);
        }

        const streamResult = streamSession.consumeUpstreamFinalPayload(fallbackData, fallbackText, streamResponse);
        if (streamResult.status === 'failed') {
          clearSurfaceStickyTarget({
            stickySessionKey,
            selected,
          });
          await failureToolkit.recordStreamFailure({
            selected,
            requestedModel,
            modelName,
            errorMessage: streamResult.errorMessage,
            isStream: true,
            firstByteLatencyMs,
            firstTokenLatencyMs,
            latencyMs: latency,
            retryCount,
            promptTokens: parsedUsage.promptTokens,
            completionTokens: parsedUsage.completionTokens,
            totalTokens: parsedUsage.totalTokens,
            upstreamPath: successfulUpstreamPath,
            runtimeFailureStatus: 502,
          });
          await finalizeDebugFailure(502, {
            error: {
              message: streamResult.errorMessage,
              type: 'stream_error',
            },
          }, successfulUpstreamPath);
          if (!streamStarted) {
            return reply.code(502).send({
              error: {
                message: streamResult.errorMessage,
                type: 'upstream_error',
              },
            });
          }
          return;
        }
        await recordStreamSuccess(latency);
        await finalizeDebugSuccess(
          200,
          successfulUpstreamPath,
          buildSurfaceProxyDebugResponseHeaders(upstream) ?? {},
          debugTrace?.options.captureStreamChunks
            ? fallbackText
            : {
                stream: true,
                usage: parsedUsage,
              },
        );
        bindSurfaceStickyTarget({
          stickySessionKey,
          selected,
        });
        return;
      } else {
        const upstreamReader = getRuntimeResponseReader(upstream);
        const shouldUsePlatformStreamReader = !(
          adapter.format === 'gemini'
          && transformed.extraContext?.internalDownstream === true
        );
        const baseReader = (shouldUsePlatformStreamReader && platformProfile?.createStreamReader && upstreamReader)
          ? platformProfile.createStreamReader(upstreamReader)
          : upstreamReader;
        const decoder = new TextDecoder();
        const reader = baseReader
          ? {
              async read() {
                const result = await baseReader.read();
                if (result.value) {
                  rawText += decoder.decode(result.value, { stream: true });
                }
                return result;
              },
              async cancel(reason?: unknown) {
                return baseReader.cancel?.(reason);
              },
              releaseLock() {
                return baseReader.releaseLock?.();
              },
            }
          : null;

        const streamResult = await streamSession.run(reader, streamResponse);
        const latency = Date.now() - startTime;
        if (streamResult.status === 'failed') {
          clearSurfaceStickyTarget({
            stickySessionKey,
            selected,
          });
          await failureToolkit.recordStreamFailure({
            selected,
            requestedModel,
            modelName,
            errorMessage: streamResult.errorMessage,
            isStream: true,
            firstByteLatencyMs,
            firstTokenLatencyMs,
            latencyMs: latency,
            retryCount,
            promptTokens: parsedUsage.promptTokens,
            completionTokens: parsedUsage.completionTokens,
            totalTokens: parsedUsage.totalTokens,
            upstreamPath: successfulUpstreamPath,
          });
          await finalizeDebugFailure(502, {
            error: {
              message: streamResult.errorMessage,
              type: 'stream_error',
            },
          }, successfulUpstreamPath);
          if (!streamStarted) {
            return reply.code(502).send({
              error: {
                message: streamResult.errorMessage,
                type: 'upstream_error',
              },
            });
          }
          return;
        }

        await recordStreamSuccess(latency);
        await finalizeDebugSuccess(
          200,
          successfulUpstreamPath,
          buildSurfaceProxyDebugResponseHeaders(upstream) ?? {},
          debugTrace?.options.captureStreamChunks
            ? rawText
            : {
                stream: true,
                usage: parsedUsage,
              },
        );
        bindSurfaceStickyTarget({
          stickySessionKey,
          selected,
        });
        return;
      }
    } else {
      const upstreamContentType = (upstream.headers.get('content-type') || '').toLowerCase();
      let rawText = '';
      let fallbackText = '';
      let rawData: unknown = null;

      if (
        upstreamContentType.includes('text/event-stream')
        && adapter.format === 'responses'
      ) {
        const collected = await collectResponsesFinalPayloadFromSse(upstream, modelName);
        rawText = collected.rawText;
        fallbackText = rawText;
        rawData = collected.payload;
      } else {
        const readText = await readRuntimeResponseText(upstream);
        rawText = readText;
        fallbackText = readText;
        if (adapter.format === 'responses' && looksLikeResponsesSseText(rawText)) {
          rawData = collectResponsesFinalPayloadFromSseText(rawText, modelName).payload;
        } else {
          try {
            rawData = JSON.parse(readText);
          } catch {
            rawData = readText;
          }
        }
      }

      if (String(selected.site.platform || '').trim().toLowerCase() === 'gemini-cli') {
        rawData = protocolAdapters.geminiCli.unwrapPayload(rawData);
      }
      let upstreamUsagePresent = hasProxyUsagePayload(rawData);
      const upstreamCacheUsagePresent = hasProxyCacheUsagePayload(rawData);
      let parsedUsage = mergeProxyUsage(
        {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          promptTokensIncludeCache: null,
        },
        parseProxyUsage(rawData),
      );
      const latency = Date.now() - startTime;
      let failure = detectProxyFailure({ rawText, usage: parsedUsage });
      if (!failure && adapter.validateResponse) {
        const validation = adapter.validateResponse({
          rawText,
          upstreamBody: rawData,
          status: upstream.status,
        });
        if (validation && !validation.ok) {
          failure = {
            status: 502,
            reason: validation.reason || 'Upstream response validation failed',
          };
        }
      }
      if (failure) {
        clearSurfaceStickyTarget({
          stickySessionKey,
          selected,
        });
        const failureOutcome = await failureToolkit.handleDetectedFailure({
          selected,
          requestedModel,
          modelName,
          failure,
          latencyMs: latency,
          retryCount,
          willContinue: await willContinueAfterFailure(failure.status, failure.reason),
          promptTokens: parsedUsage.promptTokens,
          completionTokens: parsedUsage.completionTokens,
          totalTokens: parsedUsage.totalTokens,
          upstreamPath: formatLoggedUpstreamPath(adapter, successfulUpstreamPath),
        });
        if (failureOutcome.action === 'retry') {
          retryCount += 1;
          continue;
        }
        await finalizeDebugFailure(
          failureOutcome.status,
          failureOutcome.payload,
          successfulUpstreamPath,
        );
        return reply.code(failureOutcome.status).send(failureOutcome.payload);
      }

      await recordSurfaceSuccess({
        selected,
        requestedModel,
        modelName,
        parsedUsage,
        upstreamUsagePresent,
        upstreamCacheUsagePresent,
        upstreamHeaders: upstream.headers,
        requestStartedAtMs: startTime,
        isStream: false,
        firstByteLatencyMs,
        firstTokenLatencyMs: null,
        latencyMs: latency,
        retryCount,
        upstreamPath: formatLoggedUpstreamPath(adapter, successfulUpstreamPath),
        contentAffinityKey: clientContext.contentAffinityKey,
        endpointType: successfulEndpointType,
        requestEndpointType: downstreamEndpointType,
        logSuccess: failureToolkit.log,
        recordDownstreamBilling: (billing) => recordDownstreamBillingUsage(request, billing),
        bestEffortMetrics: {
          errorLabel: '[proxy/generic] failed to record success metrics',
        },
        suppressLogUsageSource: adapter.format === 'gemini',
      });

      const finalPayload = adapter.transformResponse
        ? adapter.transformResponse({
            upstreamBody: rawData,
            rawText,
            modelName,
            fallbackText,
            defaultEncryptedReasoningInclude,
            isCompactRequest,
            operationHint: transformed.operationHint,
            extraContext: transformed.extraContext,
          })
        : rawData;

      if (
        isCodexSite &&
        codexSessionStoreKey &&
        finalPayload &&
        typeof finalPayload === 'object' &&
        typeof (finalPayload as any).id === 'string'
      ) {
        setCodexSessionResponseId(codexSessionStoreKey, (finalPayload as any).id);
      }

      await finalizeDebugSuccess(
        upstream.status,
        successfulUpstreamPath,
        buildSurfaceProxyDebugResponseHeaders(upstream) ?? {},
        finalPayload,
      );
      bindSurfaceStickyTarget({
        stickySessionKey,
        selected,
      });

      return reply.code(upstream.status).send(finalPayload);
      }
    } finally {
      targetLease.release();
    }
  }
      const exhaustedMessage = 'Upstream execution attempts were exhausted';
      await completeCompiledRuntimeExecutionSession(executionSession, {
        status: 'failure',
        httpStatus: 502,
        isStream,
        errorMessage: exhaustedMessage,
      });
      return reply.code(502).send({
        error: { message: exhaustedMessage, type: 'upstream_error' },
      });
    } catch (error) {
      await completeCompiledRuntimeExecutionSession(executionSession, {
        status: 'failure',
        httpStatus: 500,
        isStream,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
}
