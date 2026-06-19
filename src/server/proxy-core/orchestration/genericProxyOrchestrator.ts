import { TextDecoder } from 'node:util';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../../config.js';
import { tokenRouter } from '../../services/tokenRouter.js';
import { reportProxyAllFailed } from '../../services/alertService.js';
import { hasProxyUsagePayload, mergeProxyUsage, parseProxyUsage } from '../../services/proxyUsageParser.js';
import { resolveUpstreamEndpointCandidates } from '../../services/upstreamEndpointDerivation.js';
import { buildUpstreamEndpointRequest } from '../formats/upstreamRequestBuilder.js';
import {
  getUpstreamEndpointRuntimeStateSnapshot,
  recordUpstreamEndpointFailure,
  recordUpstreamEndpointSuccess,
} from '../../services/upstreamEndpointRuntimeMemory.js';
import {
  ensureModelAllowedForDownstreamKey,
  getDownstreamRoutingPolicy,
  recordDownstreamCostUsage,
} from '../downstreamPolicy.js';
import { executeEndpointFlow, type BuiltEndpointRequest } from './endpointFlow.js';
import { detectProxyFailure } from '../../services/proxyFailureJudge.js';
import { getProxyAuthContext, getProxyResourceOwner } from '../../middleware/auth.js';
import { getObservedResponseMeta } from '../firstByteTimeout.js';
import { getRuntimeResponseReader, readRuntimeResponseText } from '../executors/types.js';
import { detectDownstreamClientContext } from '../downstreamClientContext.js';
import { getProxyMaxChannelRetries } from '../../services/proxyChannelRetry.js';
import { shouldAbortSameSiteEndpointFallback } from '../../services/proxyRetryPolicy.js';
import { applyOpenAiServiceTierPolicy } from '../serviceTierPolicy.js';
import { maybeHandleWebSearchOnlySimulation } from '../webSearchSimulation.js';
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
  acquireSurfaceChannelLease,
  bindSurfaceStickyChannel,
  buildSurfaceChannelBusyMessage,
  buildSurfaceStickySessionKey,
  clearSurfaceStickyChannel,
  createSurfaceFailureToolkit,
  createSurfaceDispatchRequest,
  getSurfaceStickyPreferredChannelId,
  recordSurfaceSuccess,
  selectSurfaceChannelForAttempt,
  trySurfaceOauthRefreshRecovery,
} from './sharedProxyOrchestration.js';
import { runWithSiteApiEndpointPool, SiteApiEndpointRequestError } from '../../services/siteApiEndpointService.js';
import { evaluateActiveRouteGraphForModel } from '../../services/routeGraphRuntimeService.js';
import { resolveDispatchUpstreamCompatibilityPolicy } from '../../services/upstreamCompatibilityPolicyResolver.js';
import { buildOauthProviderHeaders } from '../../services/oauth/service.js';
import {
  buildSurfaceProxyDebugResponseHeaders,
  captureSurfaceProxyDebugSuccessResponseBody,
  parseSurfaceProxyDebugTextPayload,
  reserveSurfaceProxyDebugAttemptBase,
  safeFinalizeSurfaceProxyDebugTrace,
  safeInsertSurfaceProxyDebugAttempt,
  safeUpdateSurfaceProxyDebugAttempt,
  safeUpdateSurfaceProxyDebugCandidates,
  safeUpdateSurfaceProxyDebugSelection,
  startSurfaceProxyDebugTrace,
} from '../../services/proxyDebugTraceRuntime.js';
import {
  buildForcedChannelUnavailableMessage,
  canRetryChannelSelection,
  getTesterForcedChannelId,
} from '../channelSelection.js';
import { resolvePlatformProfile } from '../platforms/registry.js';
import type { DownstreamProtocolAdapter, TransformedDownstreamRequest } from '../formats/types.js';
import { createConfiguredProtocolAdapter } from '../formats/configuredProtocolAdapter.js';
import { getOauthInfoFromAccount } from '../../services/oauth/oauthAccount.js';
import {
  buildCodexSessionResponseStoreKey,
  getCodexSessionResponseId,
  setCodexSessionResponseId,
} from '../runtime/codexSessionResponseStore.js';
import { getCodexSessionHeaderValue } from '../platforms/headers.js';

const EMPTY_PROXY_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

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
  try {
    const clientContext = detectDownstreamClientContext({
      downstreamPath,
      headers: request.headers as Record<string, unknown>,
      body: request.body,
    });

    const downstreamPolicy = getDownstreamRoutingPolicy(request);
    const adapterConfig = downstreamPolicy?.protocolAdapterConfigs?.[adapter.format] || {};
    adapter = createConfiguredProtocolAdapter(
      adapter,
      adapterConfig.passthroughHeaders,
      adapterConfig.bodyConstraints,
    );

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
    const forcedChannelId = getTesterForcedChannelId({
      headers: request.headers as Record<string, unknown>,
      clientIp: request.ip,
    });
    const downstreamApiKeyId = getProxyAuthContext(request)?.keyId ?? null;
    const maxRetries = getProxyMaxChannelRetries();
    const failureToolkit = createSurfaceFailureToolkit({
      warningScope: adapter.format,
      downstreamPath,
      maxRetries,
      clientContext,
      downstreamApiKeyId,
    });

    const stickySessionKey = buildSurfaceStickySessionKey({
      clientContext,
      requestedModel,
      downstreamPath,
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

    const initialGraphSelection = await evaluateActiveRouteGraphForModel(requestedModel);
    if (initialGraphSelection?.terminalKind === 'synthetic_endpoint') {
      const statusCode = initialGraphSelection.syntheticResponse?.statusCode || 503;
      const payload = {
        error: {
          message: initialGraphSelection.syntheticResponse?.message || 'No route is available.',
          type: statusCode === 429 ? 'rate_limit_error' as const : 'server_error' as const,
        },
      };
      await safeFinalizeSurfaceProxyDebugTrace(debugTrace, {
        finalStatus: 'failure',
        finalHttpStatus: statusCode,
        finalResponseHeaders: {},
        finalResponseBody: {
          ...payload,
          routeGraph: {
            terminalNodeId: initialGraphSelection.terminalNodeId,
            terminalKind: initialGraphSelection.terminalKind,
            trace: initialGraphSelection.trace,
          },
        },
      });
      return reply.code(statusCode).send(payload);
    }

    let retryCount = 0;
    const excludeChannelIds: number[] = [];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const stickyPreferredChannelId = getSurfaceStickyPreferredChannelId(stickySessionKey);

      const selected = adapter.selectChannel
        ? await adapter.selectChannel({
            requestedModel,
            policy: downstreamPolicy,
            excludeChannelIds,
            forcedChannelId,
          })
        : await selectSurfaceChannelForAttempt({
            requestedModel,
            downstreamPolicy,
            excludeChannelIds,
            forcedChannelId,
            retryCount: attempt,
            stickySessionKey,
          });

      if (!selected) {
        const noChannelMessage = buildForcedChannelUnavailableMessage(forcedChannelId);
        await reportProxyAllFailed({
          model: requestedModel,
          reason: forcedChannelId ? noChannelMessage : 'No available channels after retries',
        });
        const payload = {
          error: { message: noChannelMessage, type: 'server_error' as const },
        };
        await safeFinalizeSurfaceProxyDebugTrace(debugTrace, {
          finalStatus: 'failure',
          finalHttpStatus: 503,
          finalResponseHeaders: {},
          finalResponseBody: payload,
        });
        return reply.code(503).send({
          error: { message: noChannelMessage, type: 'server_error' },
        });
      }

      excludeChannelIds.push(selected.channel.id);
      await safeUpdateSurfaceProxyDebugSelection(debugTrace, {
        stickySessionKey,
        stickyHitChannelId: (
          stickyPreferredChannelId && stickyPreferredChannelId === selected.channel.id
            ? stickyPreferredChannelId
            : null
        ),
        selectedChannelId: selected.channel.id,
        selectedRouteId: selected.channel.routeId ?? null,
        selectedAccountId: selected.account.id,
        selectedSiteId: selected.site.id,
        selectedSitePlatform: selected.site.platform,
      });

      const modelName = selected.actualModel || requestedModel;
      const routeGraphFilters = selected.routeGraph?.postBuildFilters ?? null;
      const platformProfile = resolvePlatformProfile(selected.site.platform);
      const compatibilityPolicy = resolveDispatchUpstreamCompatibilityPolicy({
        defaultCompatibilityPolicy: platformProfile?.defaultCompatibilityPolicy,
        site: selected.site,
        account: selected.account,
        token: selected.token,
        modelEndpointCompatibilityPolicy: selected.routeGraph?.modelEndpointCompatibilityPolicy,
        selectedEndpointTarget: selected.routeGraph?.selectedEndpointTarget,
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
            channelId: selected.channel.id,
          })
        : null;

      const startTime = Date.now();
      const leaseResult = await acquireSurfaceChannelLease({
        stickySessionKey,
        selected,
      });
      if (leaseResult.status === 'timeout') {
        clearSurfaceStickyChannel({
          stickySessionKey,
          selected,
        });
        const busyMessage = buildSurfaceChannelBusyMessage(leaseResult.waitMs);
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

      const channelLease = leaseResult.lease;
      try {
        const debugAttemptIndex = attempt;
      await safeInsertSurfaceProxyDebugAttempt(debugTrace, {
        attemptIndex: debugAttemptIndex,
        endpoint: adapter.format,
        requestPath: downstreamPath,
        targetUrl: selected.site.url,
        runtimeExecutor: 'default',
      });

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

      const executeEndpointResultForSiteApiBaseUrl = async (siteApiBaseUrl: string) => {
        const buildEndpointRequest = (endpoint: CompatibilityEndpoint) => {
          const upstreamStream = isStream || (forceResponsesUpstreamStream && endpoint === 'responses');
          const passthroughHeaders = adapter.extractPassthroughHeaders(request.headers as Record<string, unknown>);
          const platformHeaders = buildOauthProviderHeaders({
            account: selected.account,
            downstreamHeaders: request.headers as Record<string, unknown>,
          });

          if (adapter.buildUpstreamRequest && transformed.requestKind) {
            const currentOauth = getOauthInfoFromAccount(selected.account);
            return adapter.buildUpstreamRequest({
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
              routeGraphFilters,
              compatibilityPolicy,
            });
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
            routeGraphFilters,
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
          return {
            endpoint,
            path: upstreamPath,
            headers: requestHeaders,
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
                channelId: selected.channel.id,
                headers: endpointRequest.headers as Record<string, string>,
                codexSessionStoreKey: codexSessionStoreKey || null,
              },
              () => baseDispatchRequest(endpointRequest, targetUrl, signal),
            );
          }
          return baseDispatchRequest(endpointRequest, targetUrl, signal);
        };

        const requestCapabilities = transformed.requestCapabilities || {};
        const conversationFileSummary = requestCapabilities.conversationFileSummary;
        const hasNonImageFileInput = requestCapabilities.hasNonImageFileInput === true;
        const prefersNativeResponsesReasoning = requestCapabilities.wantsNativeResponsesReasoning === true;
        const requiresNativeResponsesFileUrl = requestCapabilities.requiresNativeResponsesFileUrl === true;

        const rawCandidates = fixedEndpointCandidates || (transformed.requestKind
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
                requestKind: transformed.requestKind as any,
                requiresNativeResponsesFileUrl,
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
                requestKind: 'responses-compact',
                requiresNativeResponsesFileUrl,
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
              },
            ));
        const candidates = prioritizeEndpointCandidates(
          rawCandidates,
          routeGraphFilters?.endpointPreference,
        );

        const endpointRuntimeContext = {
          siteId: selected.site.id,
          modelName,
          downstreamFormat: (adapter.format === 'responses' ? 'responses' : (adapter.format.startsWith('openai') ? 'openai' : 'claude')) as any,
          requestedModelHint: requestedModel,
          requestCapabilities: {
            hasNonImageFileInput,
            conversationFileSummary,
            wantsNativeResponsesReasoning: prefersNativeResponsesReasoning,
          },
        };

        await safeUpdateSurfaceProxyDebugCandidates(debugTrace, {
          endpointCandidates: candidates,
          endpointRuntimeState: getUpstreamEndpointRuntimeStateSnapshot(endpointRuntimeContext),
          decisionSummary: {
            retryCount,
            downstreamFormat: adapter.format,
            stickySessionKey,
            stickyPreferredChannelId,
            oauthProvider: oauth?.provider || null,
            isCodexSite,
            isCompactRequest,
          },
        });

        if (candidates.length === 0) {
          return {
            ok: false as const,
            status: 503,
            errText: 'No available channels for this model',
          };
        }

        const endpointStrategy = adapter.buildUpstreamRequest && transformed.requestKind
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
              endpointCandidates: candidates as CompatibilityEndpoint[],
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
              buildRequest: (endpoint) => buildEndpointRequest(endpoint as CompatibilityEndpoint),
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
          disableCrossProtocolFallback: !!disableCrossProtocolFallback || isCompactRequest || config.disableCrossProtocolFallback,
          firstByteTimeoutMs: Math.max(0, Math.trunc((config.proxyFirstByteTimeoutSec || 0) * 1000)),
          endpointCandidates: candidates,
          buildRequest: (endpoint) => buildEndpointRequest(endpoint as CompatibilityEndpoint),
          dispatchRequest,
          tryRecover,
          shouldDowngrade: endpointStrategy?.shouldDowngrade as ((ctx: any) => boolean) | undefined,
          onDowngrade: async (ctx) => {
            if (!endpointStrategy) return;
            protocolAdapters.chat.promoteRequiredEndpointCandidateAfterProtocolError(candidates as CompatibilityEndpoint[], {
              currentEndpoint: ctx.request.endpoint as CompatibilityEndpoint,
              upstreamErrorText: ctx.rawErrText,
            });
            await safeUpdateSurfaceProxyDebugAttempt(debugTrace, attempt, {
              downgradeDecision: true,
              downgradeReason: 'cross_protocol_downgrade',
            });
          },
          shouldAbortRemainingEndpoints: (ctx) => shouldAbortSameSiteEndpointFallback(
            ctx.response.status,
            ctx.rawErrText || ctx.errText,
          ),
          onAttemptFailure: async (ctx) => {
            const latency = Date.now() - startTime;
            const status = ctx.response.status || 502;
            if (adapter.buildUpstreamRequest && transformed.requestKind) {
              try {
                await tokenRouter.recordFailure?.(selected.channel.id, {
                  status,
                  errorText: ctx.rawErrText || ctx.errText,
                });
              } catch {
                // best effort only
              }
            }
            recordUpstreamEndpointFailure({
              ...endpointRuntimeContext,
              endpoint: ctx.request.endpoint,
              status,
              errorText: ctx.rawErrText,
            });
            await failureToolkit.log({
              selected,
              modelRequested: requestedModel,
              status: 'failed',
              httpStatus: status,
              errorMessage: adapter.buildUpstreamRequest && transformed.requestKind
                ? (ctx.rawErrText || ctx.errText || 'Attempt failed')
                : (ctx.errText || 'Attempt failed'),
              retryCount,
              latencyMs: latency,
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
              upstreamPath: formatLoggedUpstreamPath(adapter, ctx.request.path),
            });
          },
          onAttemptSuccess: async (ctx) => {
            recordUpstreamEndpointSuccess({
              ...endpointRuntimeContext,
              endpoint: ctx.request.endpoint,
            });
          },
        });
      };

      let endpointResult: Awaited<ReturnType<typeof executeEndpointFlow>> | null = null;
      try {
        const usesAdapterBuiltRequest = !!(adapter.buildUpstreamRequest && transformed.requestKind);
        endpointResult = !usesAdapterBuiltRequest && typeof selected.site.id === 'number'
          ? await runWithSiteApiEndpointPool(selected.site, async (target) => {
            const result = await executeEndpointResultForSiteApiBaseUrl(target.baseUrl);
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
        console.log('LOOP_ATTEMPT_ERROR:', err.stack || err);
        clearSurfaceStickyChannel({
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
            await tokenRouter.recordFailure?.(selected.channel.id, {
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
          const failureOutcome = await failureToolkit.handleUpstreamFailure({
            selected,
            requestedModel,
            modelName,
            status: endpointFailureStatus || 502,
            errText: err.message || 'unknown error',
            rawErrText: err.rawErrText || err.message || 'unknown error',
            isStream,
            latencyMs: Date.now() - startTime,
            retryCount,
          });
          const terminalFailureOutcome = failureOutcome.action === 'retry'
            ? (canRetryChannelSelection(retryCount, forcedChannelId)
              ? null
              : finalizeRetryAsUpstreamFailure(endpointFailureStatus || 502, err.message))
            : failureOutcome;

          if (!terminalFailureOutcome) {
            retryCount += 1;
            continue;
          }
          await finalizeDebugFailure(
            terminalFailureOutcome.status,
            terminalFailureOutcome.payload,
            null,
          );
          return reply.code(terminalFailureOutcome.status).send(terminalFailureOutcome.payload);
        }

        const latency = Date.now() - startTime;
        if (adapter.buildUpstreamRequest && transformed.requestKind) {
          try {
            await tokenRouter.recordFailure?.(selected.channel.id, {
              errorText: err.message || 'Upstream request failed',
            });
          } catch {
            // best effort only
          }
          await failureToolkit.log({
            selected,
            modelRequested: requestedModel,
            status: 'failed',
            httpStatus: 502,
            errorMessage: err.message,
            retryCount,
            latencyMs: latency,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            upstreamPath: '[proxy] execution pool error',
          });
          if (canRetryChannelSelection(retryCount, forcedChannelId)) {
            retryCount += 1;
            continue;
          }
        }
        await failureToolkit.log({
          selected,
          modelRequested: requestedModel,
          status: 'failed',
          httpStatus: 502,
          errorMessage: err.message,
          retryCount,
          latencyMs: latency,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          upstreamPath: '[proxy] execution pool error',
        });
        const outcome = finalizeRetryAsExecutionFailure(err.message);
        await finalizeDebugFailure(outcome.status, outcome.payload, null);
        if (attempt === maxRetries - 1) {
          return reply.code(outcome.status).send(outcome.payload);
        }
        retryCount += 1;
        continue;
      }
      if (!endpointResult!.ok) {
        const status = endpointResult!.status || 502;
        if (adapter.buildUpstreamRequest && transformed.requestKind) {
          if (canRetryChannelSelection(retryCount, forcedChannelId)) {
            retryCount += 1;
            continue;
          }
          const payload = {
            error: {
              message: endpointResult!.errText || 'Upstream request failed',
              type: status === 503 ? 'server_error' as const : 'upstream_error' as const,
            },
          };
          await finalizeDebugFailure(status, payload, null);
          return reply.code(status).send(payload);
        }
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
        });
        const terminalFailureOutcome = failureOutcome.action === 'retry'
          ? (canRetryChannelSelection(retryCount, forcedChannelId)
            ? null
            : finalizeRetryAsUpstreamFailure(status, endpointResult!.errText || 'Upstream request failed'))
          : failureOutcome;

        if (!terminalFailureOutcome) {
          retryCount += 1;
          continue;
        }
        const payload = {
          error: {
            message: endpointResult!.errText || 'Upstream request failed',
            type: status === 503 ? 'server_error' as const : 'upstream_error' as const,
          },
        };
        await finalizeDebugFailure(terminalFailureOutcome.status, terminalFailureOutcome.payload || payload, null);
        return reply.code(terminalFailureOutcome.status).send(terminalFailureOutcome.payload || payload);
      }
      const upstream = endpointResult!.upstream;
      const successfulUpstreamPath = endpointResult!.upstreamPath;
      const firstByteLatencyMs = getObservedResponseMeta(upstream)?.firstByteLatencyMs ?? null;

      if (isStream) {
        const upstreamContentType = (upstream.headers.get('content-type') || '').toLowerCase();
        let streamStarted = false;
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
      const recordStreamSuccess = async (latencyMs: number) => {
        await recordSurfaceSuccess({
          selected,
          requestedModel,
          modelName,
          parsedUsage,
          upstreamUsagePresent,
          upstreamHeaders: upstream.headers,
          requestStartedAtMs: startTime,
          isStream: true,
          firstByteLatencyMs,
          latencyMs,
          retryCount,
          upstreamPath: formatLoggedUpstreamPath(adapter, successfulUpstreamPath),
          logSuccess: failureToolkit.log,
          recordDownstreamCost: (estimatedCost) => {
            recordDownstreamCostUsage(request, estimatedCost);
          },
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
        onParsedPayload: (payload) => {
          if (payload && typeof payload === 'object') {
            upstreamUsagePresent = upstreamUsagePresent || hasProxyUsagePayload(payload);
            parsedUsage = mergeProxyUsage(parsedUsage, parseProxyUsage(payload));
          }
        },
        writeLines,
        writeRaw: (chunk) => {
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
            clearSurfaceStickyChannel({
              stickySessionKey,
              selected,
            });
            await failureToolkit.recordStreamFailure({
              selected,
              requestedModel,
              modelName,
              errorMessage: streamResult.errorMessage,
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
          bindSurfaceStickyChannel({
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
        parsedUsage = mergeProxyUsage(parsedUsage, parseProxyUsage(fallbackData));
        const latency = Date.now() - startTime;
        const failure = detectProxyFailure({ rawText, usage: parsedUsage });
        if (failure) {
          clearSurfaceStickyChannel({
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
            promptTokens: parsedUsage.promptTokens,
            completionTokens: parsedUsage.completionTokens,
            totalTokens: parsedUsage.totalTokens,
            upstreamPath: successfulUpstreamPath,
          });
          const terminalFailureOutcome = failureOutcome.action === 'retry'
            ? (canRetryChannelSelection(retryCount, forcedChannelId)
              ? null
              : finalizeRetryAsUpstreamFailure(failure.status, failure.reason))
            : failureOutcome;
          if (!terminalFailureOutcome) {
            retryCount += 1;
            continue;
          }
          await finalizeDebugFailure(
            terminalFailureOutcome.status,
            terminalFailureOutcome.payload,
            successfulUpstreamPath,
          );
          return reply.code(terminalFailureOutcome.status).send(terminalFailureOutcome.payload);
        }

        const streamResult = streamSession.consumeUpstreamFinalPayload(fallbackData, fallbackText, streamResponse);
        if (streamResult.status === 'failed') {
          clearSurfaceStickyChannel({
            stickySessionKey,
            selected,
          });
          await failureToolkit.recordStreamFailure({
            selected,
            requestedModel,
            modelName,
            errorMessage: streamResult.errorMessage,
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
        bindSurfaceStickyChannel({
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
          clearSurfaceStickyChannel({
            stickySessionKey,
            selected,
          });
          await failureToolkit.recordStreamFailure({
            selected,
            requestedModel,
            modelName,
            errorMessage: streamResult.errorMessage,
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
        bindSurfaceStickyChannel({
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
        clearSurfaceStickyChannel({
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
          promptTokens: parsedUsage.promptTokens,
          completionTokens: parsedUsage.completionTokens,
          totalTokens: parsedUsage.totalTokens,
          upstreamPath: formatLoggedUpstreamPath(adapter, successfulUpstreamPath),
        });
        const terminalFailureOutcome = failureOutcome.action === 'retry'
          ? (canRetryChannelSelection(retryCount, forcedChannelId)
            ? null
            : finalizeRetryAsUpstreamFailure(failure.status, failure.reason))
          : failureOutcome;

        if (!terminalFailureOutcome) {
          retryCount += 1;
          continue;
        }
        await finalizeDebugFailure(
          terminalFailureOutcome.status,
          terminalFailureOutcome.payload,
          successfulUpstreamPath,
        );
        return reply.code(terminalFailureOutcome.status).send(terminalFailureOutcome.payload);
      }

      await recordSurfaceSuccess({
        selected,
        requestedModel,
        modelName,
        parsedUsage,
        upstreamUsagePresent,
        upstreamHeaders: upstream.headers,
        requestStartedAtMs: startTime,
        isStream: false,
        firstByteLatencyMs,
        latencyMs: latency,
        retryCount,
        upstreamPath: formatLoggedUpstreamPath(adapter, successfulUpstreamPath),
        logSuccess: failureToolkit.log,
        recordDownstreamCost: (estimatedCost) => {
          recordDownstreamCostUsage(request, estimatedCost);
        },
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
            requestKind: transformed.requestKind,
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
      bindSurfaceStickyChannel({
        stickySessionKey,
        selected,
      });

      return reply.code(upstream.status).send(finalPayload);
    }
  } finally {
    channelLease.release();
  }
}
  } catch (err: any) {
    console.error('DIAGNOSTIC ERROR:', err.stack || err);
    throw err;
  }
}
