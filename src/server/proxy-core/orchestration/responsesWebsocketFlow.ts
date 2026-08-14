import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { request as createHttpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { createCodexWebsocketRuntime, CodexWebsocketRuntimeError } from '../runtime/codexWebsocketRuntime.js';
import { buildCodexSessionResponseStoreKey } from '../runtime/codexSessionResponseStore.js';
import {
  authorizeDownstreamToken,
  consumeManagedKeyRequest,
  isModelAllowedByPolicyOrAllowedPlans,
  type DownstreamTokenAuthSuccess,
} from '../../services/downstreamApiKeyService.js';
import type { DownstreamRoutingPolicy } from '../../services/downstreamPolicyTypes.js';
import { runWithSiteApiEndpointPool, SiteApiEndpointRequestError } from '../../services/siteApiEndpointService.js';
import { buildOauthProviderHeaders } from '../../services/oauth/service.js';
import { resolveDispatchUpstreamCompatibilityPolicy } from '../../services/upstreamCompatibilityPolicyResolver.js';
import { getOauthInfoFromAccount } from '../../services/oauth/oauthAccount.js';
import { protocolAdapters } from '../formats/protocolAdapters.js';
import { buildUpstreamEndpointRequest } from '../formats/upstreamRequestBuilder.js';
import { defaultRequestUrlForUpstreamEndpoint } from '../apiVariants.js';
import { config } from '../../config.js';
import { applyOpenAiServiceTierPolicy } from '../serviceTierPolicy.js';
import { resolvePlatformProfile } from '../platforms/registry.js';
import type { RouteRuntimeExecutionAttempt } from '../../services/routeRuntimeExecutionService.js';
import {
  bindSurfaceStickyTarget,
  buildSurfaceStickySessionKey,
  commitSurfaceRuntimeDecisionProposal,
  createSurfaceRuntimeDecisionSession,
  createSurfaceFailureToolkit,
  getSurfaceStickyPreferredTargetId,
  markSurfaceExecutionAttemptStarted,
  proposeSurfaceRuntimeDecisionInSession,
  recordSurfaceSuccess,
  selectSurfaceRuntimeDecisionInSession,
} from './sharedProxyOrchestration.js';
import { buildCompiledRouteRuntimeRequestSnapshot } from './compiledRouteRuntimeRequest.js';
import {
  bindCompiledRuntimeExecutionDecision,
  completeCompiledRuntimeExecutionSession,
  startCompiledRuntimeExecutionSession,
  type CompiledRuntimeExecutionSession,
} from '../../services/compiledRuntimeExecutionSessionService.js';
import {
  hasProxyCacheUsagePayload,
  hasProxyUsagePayload,
  mergeProxyUsage,
  parseProxyUsage,
} from '../../services/proxyUsageParser.js';

const installedApps = new WeakSet<FastifyInstance>();
const WS_TURN_STATE_HEADER = 'x-codex-turn-state';
const RESPONSES_WEBSOCKET_MODE_HEADER = 'x-metapi-responses-websocket-mode';
const RESPONSES_WEBSOCKET_TRANSPORT_HEADER = 'x-metapi-responses-websocket-transport';
const INTERNAL_RUNTIME_REQUEST_ID_HEADER = 'x-metapi-runtime-request-id';
const codexWebsocketRuntime = createCodexWebsocketRuntime();

type SelectedExecutionAttempt = RouteRuntimeExecutionAttempt;
type ResponsesWebsocketAuthContext = DownstreamTokenAuthSuccess;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getServiceTierPolicyRules(): unknown {
  return (config as typeof config & { openAiServiceTierRules?: unknown }).openAiServiceTierRules;
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function headerValueToTrimmedString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'string') continue;
      const trimmed = item.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
}

function toBooleanLike(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  }
  return null;
}

function parseExtraConfigRecord(extraConfig: unknown): Record<string, unknown> | null {
  if (isRecord(extraConfig)) return extraConfig;
  if (typeof extraConfig !== 'string') return null;
  try {
    const parsed = JSON.parse(extraConfig);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readNestedRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const nested = value[key];
  return isRecord(nested) ? nested : null;
}
function selectedExecutionAttemptModelMatches(
  selectedExecutionAttempt: SelectedExecutionAttempt | null,
  requestModel: string,
): boolean {
  if (!selectedExecutionAttempt) return false;
  const selectedModel = asTrimmedString(selectedExecutionAttempt.actualModel).toLowerCase();
  const normalizedRequestModel = asTrimmedString(requestModel).toLowerCase();
  if (!selectedModel || !normalizedRequestModel) return true;
  return selectedModel === normalizedRequestModel;
}

function selectedExecutionAttemptSupportsCodexWebsocketTransport(
  selectedExecutionAttempt: SelectedExecutionAttempt | null,
  requestModel: string,
): boolean {
  if (!selectedExecutionAttempt) return false;
  const platform = asTrimmedString(selectedExecutionAttempt.site?.platform).toLowerCase();
  if (platform !== 'codex') return false;
  if (!selectedExecutionAttemptModelMatches(selectedExecutionAttempt, requestModel)) return false;
  if (!config.codexUpstreamWebsocketEnabled) return false;

  const extraConfig = parseExtraConfigRecord(selectedExecutionAttempt.account.extraConfig);
  const oauth = readNestedRecord(extraConfig, 'oauth');
  const providerData = readNestedRecord(oauth, 'providerData');
  const candidateFlags = [
    extraConfig?.websockets,
    readNestedRecord(extraConfig, 'attributes')?.websockets,
    readNestedRecord(extraConfig, 'metadata')?.websockets,
    providerData?.websockets,
    readNestedRecord(providerData, 'attributes')?.websockets,
    readNestedRecord(providerData, 'metadata')?.websockets,
  ];
  for (const candidate of candidateFlags) {
    const parsed = toBooleanLike(candidate);
    if (parsed !== null) return parsed;
  }
  return true;
}

function selectedExecutionAttemptSupportsIncrementalInput(
  selectedExecutionAttempt: SelectedExecutionAttempt | null,
  requestModel: string,
): boolean {
  return selectedExecutionAttemptSupportsCodexWebsocketTransport(selectedExecutionAttempt, requestModel);
}

function unwrapCodexWebsocketRuntimeError(error: unknown): CodexWebsocketRuntimeError {
  if (error instanceof CodexWebsocketRuntimeError) return error;
  if (error instanceof SiteApiEndpointRequestError && error.cause instanceof CodexWebsocketRuntimeError) {
    return error.cause;
  }
  return new CodexWebsocketRuntimeError(
    error instanceof Error && error.message.trim()
      ? error.message
      : 'upstream websocket request failed',
  );
}

function deriveCodexExplicitSessionId(body: Record<string, unknown>, sessionId: string): string {
  void body;
  return sessionId;
}

function parseJsonObject(raw: RawData): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(String(raw));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeResponsesWebsocketError(
  socket: WebSocket,
  status: number,
  message: string,
  errorPayload?: unknown,
) {
  socket.send(JSON.stringify({
    type: 'error',
    status,
    error: isRecord(errorPayload) && isRecord(errorPayload.error)
      ? errorPayload.error
      : {
        type: status >= 500 ? 'server_error' : 'invalid_request_error',
        message,
      },
  }));
}

async function forwardResponsesRequestViaHttp(input: {
  app: FastifyInstance;
  socket: WebSocket;
  request: IncomingMessage;
  payload: Record<string, unknown>;
  preserveIncrementalMode: boolean;
  authToken: string;
  executionSession: CompiledRuntimeExecutionSession;
}): Promise<unknown[] | null> {
  const headers: Record<string, string | string[]> = {
    ...buildInjectHeaders(input.request),
    [RESPONSES_WEBSOCKET_TRANSPORT_HEADER]: '1',
    [INTERNAL_RUNTIME_REQUEST_ID_HEADER]: input.executionSession.requestId,
    ...(input.preserveIncrementalMode ? { [RESPONSES_WEBSOCKET_MODE_HEADER]: 'incremental' } : {}),
  };
  if (
    !headerValueToTrimmedString(headers.authorization)
    && !headerValueToTrimmedString(headers['x-api-key'])
    && !headerValueToTrimmedString(headers['x-goog-api-key'])
  ) {
    headers.authorization = `Bearer ${input.authToken}`;
  }

  // Fastify's inject() only resolves after the complete response body is available.
  // The WebSocket fallback must use the live listener so SSE frames can reach the
  // Codex client before the upstream response has completed.
  const requestBody = JSON.stringify(input.payload);
  delete headers['content-length'];
  delete headers['transfer-encoding'];
  headers['content-type'] = 'application/json';
  headers['content-length'] = String(Buffer.byteLength(requestBody));

  const address = input.app.server.address();
  if (!address) {
    throw new Error('HTTP responses fallback requires an active Fastify listener');
  }
  const requestOptions: RequestOptions = typeof address === 'string'
    ? { socketPath: address, path: '/v1/responses', method: 'POST', headers }
    : {
        host: address.address === '::' ? '127.0.0.1' : address.address,
        port: address.port,
        path: '/v1/responses',
        method: 'POST',
        headers,
      };

  return await new Promise<unknown[] | null>((resolve, reject) => {
    const downstreamRequest = createHttpRequest(requestOptions, (response) => {
      const bufferedBodyChunks: Buffer[] = [];
      const statusCode = response.statusCode || 502;
      const statusMessage = response.statusMessage || 'Upstream error';
      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      const forwardedPayloads: unknown[] = [];
      let sseBuffer = '';
      let sawTerminalPayload = false;

      const forwardSseEvents = (source: string) => {
        const pulled = protocolAdapters.responses.pullSseEvents(source);
        sseBuffer = pulled.rest;
        for (const event of pulled.events) {
          if (event.data === '[DONE]') continue;
          try {
            const payload = JSON.parse(event.data);
            forwardedPayloads.push(payload);
            if (protocolAdapters.responses.websocket.isTerminalPayload(payload)) {
              sawTerminalPayload = true;
            }
            if (input.socket.readyState === WebSocket.OPEN) {
              input.socket.send(JSON.stringify(payload));
            }
          } catch {
            // The HTTP surface already normalizes valid upstream SSE frames.
          }
        }
      };

      response.on('data', (chunk: Buffer) => {
        if (statusCode >= 200 && statusCode < 300 && contentType.includes('text/event-stream')) {
          forwardSseEvents(sseBuffer + chunk.toString('utf8'));
          return;
        }
        bufferedBodyChunks.push(chunk);
      });
      response.once('error', reject);
      response.once('end', () => {
        const body = Buffer.concat(bufferedBodyChunks).toString('utf8');
        if (statusCode < 200 || statusCode >= 300) {
          let errorPayload: unknown = null;
          try {
            errorPayload = JSON.parse(body);
          } catch {
            // Keep the standardized error when the internal surface returned text.
          }
          writeResponsesWebsocketError(input.socket, statusCode, statusMessage, errorPayload);
          resolve(null);
          return;
        }
        if (!contentType.includes('text/event-stream')) {
          try {
            const payload = JSON.parse(body);
            const output = protocolAdapters.responses.websocket.collectOutput([payload]);
            if (input.socket.readyState === WebSocket.OPEN) input.socket.send(JSON.stringify(payload));
            resolve(output);
          } catch {
            writeResponsesWebsocketError(input.socket, 502, 'Unexpected non-JSON websocket proxy response');
            resolve(null);
          }
          return;
        }
        if (sseBuffer.trim()) forwardSseEvents(`${sseBuffer}\n\n`);
        if (!sawTerminalPayload) {
          writeResponsesWebsocketError(input.socket, 408, 'stream closed before response.completed');
        }
        resolve(protocolAdapters.responses.websocket.collectOutput(forwardedPayloads));
      });
    });
    downstreamRequest.once('error', reject);
    downstreamRequest.end(requestBody);
  });
}

function buildInjectHeaders(request: IncomingMessage): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [rawKey, rawValue] of Object.entries(request.headers)) {
    const key = rawKey.toLowerCase();
    if (!rawValue) continue;
    if (
      key === 'host'
      || key === 'connection'
      || key === 'upgrade'
      || key === 'sec-websocket-key'
      || key === 'sec-websocket-version'
      || key === 'sec-websocket-extensions'
      || key === 'sec-websocket-protocol'
    ) {
      continue;
    }
    headers[rawKey] = rawValue as string | string[];
  }
  return headers;
}

function extractWebsocketAuthToken(request: IncomingMessage, url: URL): string {
  const auth = headerValueToTrimmedString(request.headers.authorization);
  if (auth) return auth.replace(/^Bearer\s+/i, '').trim();
  const apiKey = headerValueToTrimmedString(request.headers['x-api-key']);
  if (apiKey) return apiKey;
  const googApiKey = headerValueToTrimmedString(request.headers['x-goog-api-key']);
  if (googApiKey) return googApiKey;
  return asTrimmedString(url.searchParams.get('key'));
}

function writeUpgradeHttpError(socket: Duplex, status: number, message: string): void {
  const statusText = status === 401
    ? 'Unauthorized'
    : status === 403
      ? 'Forbidden'
      : status === 400
        ? 'Bad Request'
        : 'Error';
  const body = JSON.stringify({ error: message });
  socket.end(
    `HTTP/1.1 ${status} ${statusText}\r\n`
    + 'Content-Type: application/json\r\n'
    + `Content-Length: ${Buffer.byteLength(body)}\r\n`
    + 'Connection: close\r\n'
    + '\r\n'
    + body,
  );
}

async function handleResponsesWebsocketConnection(
  app: FastifyInstance,
  socket: WebSocket,
  request: IncomingMessage,
  authContext: ResponsesWebsocketAuthContext,
) {
  const websocketSessionId = headerValueToTrimmedString(request.headers['session-id'])
    || headerValueToTrimmedString(request.headers['session_id'])
    || headerValueToTrimmedString(request.headers['conversation-id'])
    || headerValueToTrimmedString(request.headers['conversation_id'])
    || randomUUID();
  const runtimeSessionKeys = new Set<string>();
  let lastRequest: Record<string, unknown> | null = null;
  let lastResponseOutput: unknown[] = [];
  let messageQueue = Promise.resolve();
  const downstreamPolicy = authContext.policy;

  socket.once('close', () => {
    const sessionKeys = runtimeSessionKeys.size > 0
      ? Array.from(runtimeSessionKeys)
      : [websocketSessionId];
    void Promise.all(sessionKeys.map(async (sessionKey) => {
      try {
        await codexWebsocketRuntime.closeSession(sessionKey);
      } catch {
        // Ignore close-time cleanup failures after downstream disconnects.
      }
    }));
  });

  socket.on('message', (raw: RawData) => {
    messageQueue = messageQueue
      .catch(() => undefined)
      .then(async () => {
        let executionSession: CompiledRuntimeExecutionSession | null = null;
        try {
          const parsed = parseJsonObject(raw);
          if (!parsed) {
            writeResponsesWebsocketError(socket, 400, 'Invalid websocket JSON payload');
            return;
          }

          const requestModel = asTrimmedString(parsed.model) || asTrimmedString(lastRequest?.model);
          if (requestModel && !await isModelAllowedByPolicyOrAllowedPlans(requestModel, authContext.policy)) {
            writeResponsesWebsocketError(socket, 403, 'model is not allowed for this downstream key');
            return;
          }
          const serviceTierPolicy = applyOpenAiServiceTierPolicy({
            body: parsed,
            context: {
              requestedModel: requestModel,
            },
            rules: getServiceTierPolicyRules(),
          });
          if (!serviceTierPolicy.ok) {
            writeResponsesWebsocketError(
              socket,
              serviceTierPolicy.statusCode,
              serviceTierPolicy.payload.error.message,
              serviceTierPolicy.payload,
            );
            return;
          }
          parsed.service_tier = serviceTierPolicy.body.service_tier;
          if (serviceTierPolicy.body.service_tier === undefined) delete parsed.service_tier;
          const stickySessionKey = requestModel
            ? buildSurfaceStickySessionKey({
              clientContext: {
                clientKind: 'codex',
                sessionId: websocketSessionId,
                traceHint: websocketSessionId,
              },
              requestedModel: requestModel,
              downstreamPath: '/v1/responses:websocket',
              endpointType: 'openai.responses.websocket',
              downstreamApiKeyId: authContext.key?.id ?? null,
            })
            : null;
          const runtimeRequest = requestModel
            ? buildCompiledRouteRuntimeRequestSnapshot({
                requestedModel: requestModel,
                payload: parsed,
                normalizedPayload: parsed,
                headers: request.headers as Record<string, unknown>,
                method: 'WEBSOCKET',
                path: '/v1/responses:websocket',
                clientContext: {
                  clientKind: 'codex',
                  sessionId: websocketSessionId,
                  traceHint: websocketSessionId,
                },
                downstreamApiKeyId: authContext.key?.id ?? null,
              })
            : null;
          const runtimeDecisionSession = runtimeRequest
            ? await createSurfaceRuntimeDecisionSession({
              requestedModel: requestModel!,
              request: runtimeRequest,
              downstreamPolicy,
              stickyExecutionTargetId: getSurfaceStickyPreferredTargetId(stickySessionKey),
            })
            : null;
          let normalized: ReturnType<typeof protocolAdapters.responses.websocket.normalizeRequest>;
          let shouldHandleLocalPrewarm = false;
          let supportsIncrementalInput = false;
          let selectedExecutionAttempt: SelectedExecutionAttempt | null = null;
          if (runtimeDecisionSession) {
            for (;;) {
              const proposal = await proposeSurfaceRuntimeDecisionInSession({
                session: runtimeDecisionSession,
                excludeTargetIds: [],
                retryCount: 0,
              });
              const proposedAttempt = proposal?.decision.kind === 'execution_attempt'
                ? proposal.decision.attempt
                : null;
              supportsIncrementalInput = selectedExecutionAttemptSupportsIncrementalInput(
                proposedAttempt,
                requestModel!,
              );
              shouldHandleLocalPrewarm = protocolAdapters.responses.websocket.shouldHandlePrewarmLocally({
                parsed,
                lastRequest,
                supportsIncrementalInput,
              });
              normalized = protocolAdapters.responses.websocket.normalizeRequest({
                parsed,
                lastRequest,
                lastResponseOutput,
                supportsIncrementalInput,
              });
              if (!normalized.ok || shouldHandleLocalPrewarm || !supportsIncrementalInput) break;
              if (proposal && commitSurfaceRuntimeDecisionProposal(proposal)) {
                selectedExecutionAttempt = proposedAttempt;
                break;
              }
            }
          } else {
            normalized = protocolAdapters.responses.websocket.normalizeRequest({
              parsed,
              lastRequest,
              lastResponseOutput,
              supportsIncrementalInput: false,
            });
          }
          if (!normalized.ok) {
            writeResponsesWebsocketError(socket, normalized.status, normalized.message);
            return;
          }

          if (authContext.source === 'managed' && authContext.key?.id) {
            const consumed = await consumeManagedKeyRequest(authContext.key.id);
            if (!consumed) {
              writeResponsesWebsocketError(socket, 403, 'API key has exceeded its quota or is no longer active');
              return;
            }
          }

          if (shouldHandleLocalPrewarm) {
            lastRequest = normalized.nextRequestSnapshot;
            lastResponseOutput = [];
            for (const payload of protocolAdapters.responses.websocket.synthesizePrewarmResponsePayloads(normalized.request)) {
              socket.send(JSON.stringify(payload));
            }
            return;
          }

          executionSession = await startCompiledRuntimeExecutionSession({
            downstreamPath: '/v1/responses:websocket',
            requestedModel: requestModel || null,
            isStream: true,
            downstreamApiKeyId: authContext.source === 'managed' ? authContext.key?.id ?? null : null,
          });
          if (selectedExecutionAttempt) {
            await bindCompiledRuntimeExecutionDecision({
              requestId: executionSession.requestId,
              routeEntrypointId: selectedExecutionAttempt.routeEntrypointId,
              runtimeEndpointId: selectedExecutionAttempt.runtimeEndpointId,
              executionAttemptId: selectedExecutionAttempt.executionAttemptId,
              runtimeBundleHash: selectedExecutionAttempt.routeRuntimeSnapshot.compiledRuntime.bundleHash,
              decisionSnapshot: selectedExecutionAttempt.routeRuntimeSnapshot,
            });
            bindSurfaceStickyTarget({
              stickySessionKey,
              selected: selectedExecutionAttempt,
            });
          }

          const selectedServiceTierPolicy = applyOpenAiServiceTierPolicy({
            body: normalized.request,
            context: {
              requestedModel: requestModel,
              actualModel: asTrimmedString(selectedExecutionAttempt?.actualModel),
              sitePlatform: asTrimmedString(selectedExecutionAttempt?.site?.platform),
              accountType: getOauthInfoFromAccount(selectedExecutionAttempt?.account)?.planType,
            },
            rules: getServiceTierPolicyRules(),
          });
          if (!selectedServiceTierPolicy.ok) {
            await completeCompiledRuntimeExecutionSession(executionSession, {
              status: 'failure',
              httpStatus: selectedServiceTierPolicy.statusCode,
              isStream: true,
              errorMessage: selectedServiceTierPolicy.payload.error.message,
            });
            writeResponsesWebsocketError(
              socket,
              selectedServiceTierPolicy.statusCode,
              selectedServiceTierPolicy.payload.error.message,
              selectedServiceTierPolicy.payload,
            );
            return;
          }
          normalized.request = selectedServiceTierPolicy.body;
          normalized.nextRequestSnapshot = {
            ...normalized.nextRequestSnapshot,
            service_tier: selectedServiceTierPolicy.body.service_tier,
          };
          if (selectedServiceTierPolicy.body.service_tier === undefined) {
            delete normalized.nextRequestSnapshot.service_tier;
          }
          lastRequest = normalized.nextRequestSnapshot;

          const codexWebsocketTarget = selectedExecutionAttemptSupportsCodexWebsocketTransport(selectedExecutionAttempt, requestModel)
            ? selectedExecutionAttempt
            : null;

          if (codexWebsocketTarget) {
            const terminalToolkit = createSurfaceFailureToolkit({
              requestId: executionSession.requestId,
              executionSession,
              warningScope: 'responses-websocket',
              downstreamPath: '/v1/responses:websocket',
              clientContext: {
                clientKind: 'codex',
                sessionId: websocketSessionId,
                traceHint: websocketSessionId,
              },
              downstreamApiKeyId: authContext.key?.id ?? null,
            });
            const downstreamHeaders: Record<string, unknown> = {
              ...(request.headers as Record<string, unknown>),
              [RESPONSES_WEBSOCKET_TRANSPORT_HEADER]: '1',
              ...(supportsIncrementalInput ? { [RESPONSES_WEBSOCKET_MODE_HEADER]: 'incremental' } : {}),
            };
            const platformHeaders = buildOauthProviderHeaders({
              account: codexWebsocketTarget.account,
              downstreamHeaders,
            });

            const websocketRuntimeSessionKey = buildCodexSessionResponseStoreKey({
              sessionId: websocketSessionId,
              siteId: codexWebsocketTarget.site.id,
              accountId: codexWebsocketTarget.account.id,
              targetId: codexWebsocketTarget.target.id,
            }) || websocketSessionId;
            runtimeSessionKeys.add(websocketRuntimeSessionKey);

            try {
              const platformProfile = resolvePlatformProfile(codexWebsocketTarget.site.platform);
              await markSurfaceExecutionAttemptStarted({ selected: codexWebsocketTarget });
              const runtimeResult = await runWithSiteApiEndpointPool(
                codexWebsocketTarget.site as Parameters<typeof runWithSiteApiEndpointPool>[0],
                async (target) => {
                  const prepared = buildUpstreamEndpointRequest({
                    endpoint: 'responses',
                    modelName: asTrimmedString(codexWebsocketTarget.actualModel) || requestModel,
                    stream: true,
                    tokenValue: codexWebsocketTarget.tokenValue,
                    sitePlatform: codexWebsocketTarget.site.platform,
                    siteUrl: target.baseUrl,
                    openaiBody: normalized.request,
                    downstreamFormat: 'responses',
                    responsesOriginalBody: normalized.request,
                    downstreamHeaders,
                    platformHeaders,
                    codexExplicitSessionId: deriveCodexExplicitSessionId(normalized.request, websocketSessionId),
                    runtimePostBuildFilters: codexWebsocketTarget.postBuildFilters ?? null,
                    compatibilityPolicy: resolveDispatchUpstreamCompatibilityPolicy({
                      defaultCompatibilityPolicy: platformProfile?.defaultCompatibilityPolicy,
                      site: codexWebsocketTarget.site,
                      account: codexWebsocketTarget.account,
                      token: codexWebsocketTarget.token,
                      routeEndpointCompatibilityPolicy: codexWebsocketTarget.routeEndpointCompatibilityPolicy,
                      executionAttemptCompatibilityPolicy: codexWebsocketTarget.executionAttemptCompatibilityPolicy,
                    }),
                  });
                  const requestUrl = defaultRequestUrlForUpstreamEndpoint({
                    siteUrl: target.baseUrl,
                    endpoint: 'responses',
                  })
                    || `${target.baseUrl.replace(/\/+$/, '')}${prepared.path}`;

                  try {
                    return await codexWebsocketRuntime.sendRequest({
                      sessionId: websocketRuntimeSessionKey,
                      requestUrl,
                      headers: prepared.headers,
                      body: prepared.body,
                    });
                  } catch (error) {
                    const runtimeError = error instanceof CodexWebsocketRuntimeError
                      ? error
                      : new CodexWebsocketRuntimeError('upstream websocket request failed');
                    throw new SiteApiEndpointRequestError(runtimeError.message, {
                      status: runtimeError.status,
                      cause: runtimeError,
                    });
                  }
                },
              );
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
              for (const payload of runtimeResult.events) {
                upstreamUsagePresent = upstreamUsagePresent || hasProxyUsagePayload(payload);
                upstreamCacheUsagePresent = upstreamCacheUsagePresent || hasProxyCacheUsagePayload(payload);
                parsedUsage = mergeProxyUsage(parsedUsage, parseProxyUsage(payload));
              }
              await recordSurfaceSuccess({
                selected: codexWebsocketTarget,
                requestedModel: requestModel,
                modelName: asTrimmedString(codexWebsocketTarget.actualModel) || requestModel,
                parsedUsage,
                upstreamUsagePresent,
                upstreamCacheUsagePresent,
                requestStartedAtMs: executionSession.startedAtMs,
                isStream: true,
                firstByteLatencyMs: null,
                firstTokenLatencyMs: null,
                latencyMs: Math.max(0, Date.now() - executionSession.startedAtMs),
                retryCount: 0,
                upstreamPath: '/v1/responses:websocket',
                endpointType: 'openai.responses.websocket',
                requestEndpointType: 'openai.responses.websocket',
                logSuccess: terminalToolkit.log,
                bestEffortMetrics: {
                  errorLabel: '[proxy/responses-websocket] failed to record success metrics',
                },
              });
              lastResponseOutput = protocolAdapters.responses.websocket.collectOutput(runtimeResult.events);
              for (const payload of runtimeResult.events) {
                socket.send(JSON.stringify(payload));
              }
            } catch (error) {
              const runtimeError = unwrapCodexWebsocketRuntimeError(error);
              if (runtimeError.status && runtimeError.events.length === 0) {
                const retryToolkit = createSurfaceFailureToolkit({
                  requestId: executionSession.requestId,
                  executionSession,
                  warningScope: 'responses-websocket',
                  downstreamPath: '/v1/responses:websocket',
                  clientContext: {
                    clientKind: 'codex',
                    sessionId: websocketSessionId,
                    traceHint: websocketSessionId,
                  },
                  downstreamApiKeyId: authContext.key?.id ?? null,
                });
                await retryToolkit.handleUpstreamFailure({
                  selected: codexWebsocketTarget,
                  requestedModel: requestModel,
                  modelName: asTrimmedString(codexWebsocketTarget.actualModel) || requestModel,
                  status: runtimeError.status,
                  errText: runtimeError.message,
                  rawErrText: runtimeError.message,
                  isStream: true,
                  latencyMs: Math.max(0, Date.now() - executionSession.startedAtMs),
                  retryCount: 0,
                  willContinue: true,
                });
                const forwarded = await forwardResponsesRequestViaHttp({
                  app,
                  socket,
                  request,
                  payload: normalized.request,
                  preserveIncrementalMode: supportsIncrementalInput,
                  authToken: authContext.token,
                  executionSession,
                });
                if (forwarded) {
                  lastResponseOutput = forwarded;
                }
                return;
              }
              lastResponseOutput = protocolAdapters.responses.websocket.collectOutput(runtimeError.events);
              for (const payload of runtimeError.events) {
                socket.send(JSON.stringify(payload));
              }
              const emittedTerminalResponsesEvent = runtimeError.events.some((payload) =>
                protocolAdapters.responses.websocket.isTerminalPayload(payload));
              await terminalToolkit.handleUpstreamFailure({
                selected: codexWebsocketTarget,
                requestedModel: requestModel,
                modelName: asTrimmedString(codexWebsocketTarget.actualModel) || requestModel,
                status: runtimeError.status || 408,
                errText: runtimeError.message,
                rawErrText: runtimeError.message,
                isStream: true,
                latencyMs: Math.max(0, Date.now() - executionSession.startedAtMs),
                retryCount: 0,
                willContinue: false,
              });
              if (!emittedTerminalResponsesEvent) {
                writeResponsesWebsocketError(
                  socket,
                  runtimeError.status || 408,
                  runtimeError.message,
                  runtimeError.payload,
                );
              }
            }
            return;
          }

          const forwarded = await forwardResponsesRequestViaHttp({
            app,
            socket,
            request,
            payload: normalized.request,
            preserveIncrementalMode: supportsIncrementalInput,
            authToken: authContext.token,
            executionSession,
          });
          if (forwarded) {
            lastResponseOutput = forwarded;
          }
        } catch (error) {
          if (executionSession) {
            await completeCompiledRuntimeExecutionSession(executionSession, {
              status: 'failure',
              httpStatus: 500,
              isStream: true,
              errorMessage: error instanceof Error ? error.message : String(error),
            });
          }
          writeResponsesWebsocketError(socket, 500, 'internal websocket proxy error');
        }
      });
  });
}

export function ensureResponsesWebsocketTransport(app: FastifyInstance) {
  if (installedApps.has(app)) return;
  installedApps.add(app);

  const websocketServer = new WebSocketServer({ noServer: true });
  websocketServer.on('headers', (headers: string[], request: IncomingMessage) => {
    const turnState = headerValueToTrimmedString(request.headers[WS_TURN_STATE_HEADER]);
    if (!turnState) return;
    headers.push(`${WS_TURN_STATE_HEADER}: ${turnState}`);
  });

  app.server.on('upgrade', (request, socket, head) => {
    void (async () => {
      const url = new URL(request.url || '/', 'http://localhost');
      if (url.pathname !== '/v1/responses') return;
      const token = extractWebsocketAuthToken(request, url);
      if (!token) {
        writeUpgradeHttpError(socket, 401, 'Missing Authorization, x-api-key, x-goog-api-key, or key query parameter');
        return;
      }
      const authResult = await authorizeDownstreamToken(token);
      if (!authResult.ok) {
        writeUpgradeHttpError(socket, authResult.statusCode, authResult.error);
        return;
      }
      websocketServer.handleUpgrade(request, socket, head, (client: WebSocket) => {
        void handleResponsesWebsocketConnection(app, client, request, authResult);
      });
    })().catch(() => {
      writeUpgradeHttpError(socket, 500, 'internal websocket proxy error');
    });
  });

  app.addHook('onClose', async () => {
    await codexWebsocketRuntime.closeAllSessions();
    await new Promise<void>((resolve) => {
      websocketServer.close(() => resolve());
    });
  });
}
