import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { createCodexWebsocketRuntime, CodexWebsocketRuntimeError } from '../runtime/codexWebsocketRuntime.js';
import { buildCodexSessionResponseStoreKey } from '../runtime/codexSessionResponseStore.js';
import {
  authorizeDownstreamToken,
  consumeManagedKeyRequest,
  isModelAllowedByPolicyOrAllowedRoutes,
  type DownstreamTokenAuthSuccess,
} from '../../services/downstreamApiKeyService.js';
import { runWithSiteApiEndpointPool, SiteApiEndpointRequestError } from '../../services/siteApiEndpointService.js';
import { tokenRouter } from '../../services/tokenRouter.js';
import { buildOauthProviderHeaders } from '../../services/oauth/service.js';
import { resolveDispatchUpstreamCompatibilityPolicy } from '../../services/upstreamCompatibilityPolicyResolver.js';
import { getOauthInfoFromAccount } from '../../services/oauth/oauthAccount.js';
import { protocolAdapters } from '../formats/protocolAdapters.js';
import { buildUpstreamEndpointRequest } from '../formats/upstreamRequestBuilder.js';
import { config } from '../../config.js';
import { applyOpenAiServiceTierPolicy } from '../serviceTierPolicy.js';
import { resolvePlatformProfile } from '../platforms/registry.js';

const installedApps = new WeakSet<FastifyInstance>();
const WS_TURN_STATE_HEADER = 'x-codex-turn-state';
const RESPONSES_WEBSOCKET_MODE_HEADER = 'x-metapi-responses-websocket-mode';
const RESPONSES_WEBSOCKET_TRANSPORT_HEADER = 'x-metapi-responses-websocket-transport';
const codexWebsocketRuntime = createCodexWebsocketRuntime();

type SelectedTarget = NonNullable<Awaited<ReturnType<typeof tokenRouter.selectTarget>>>;
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
function selectedChannelModelMatches(
  selectedChannel: SelectedTarget | null,
  requestModel: string,
): boolean {
  if (!selectedChannel) return false;
  const selectedModel = asTrimmedString(selectedChannel.actualModel).toLowerCase();
  const normalizedRequestModel = asTrimmedString(requestModel).toLowerCase();
  if (!selectedModel || !normalizedRequestModel) return true;
  return selectedModel === normalizedRequestModel;
}

function selectedChannelSupportsCodexWebsocketTransport(
  selectedChannel: SelectedTarget | null,
  requestModel: string,
): boolean {
  if (!selectedChannel) return false;
  const platform = asTrimmedString(selectedChannel.site?.platform).toLowerCase();
  if (platform !== 'codex') return false;
  if (!selectedChannelModelMatches(selectedChannel, requestModel)) return false;
  if (!config.codexUpstreamWebsocketEnabled) return false;

  const extraConfig = parseExtraConfigRecord(selectedChannel.account.extraConfig);
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

function selectedChannelSupportsIncrementalInput(
  selectedChannel: SelectedTarget | null,
  requestModel: string,
): boolean {
  return selectedChannelSupportsCodexWebsocketTransport(selectedChannel, requestModel);
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

function shouldReuseSelectedTarget(
  selectedChannel: SelectedTarget | null,
  requestModel: string,
): boolean {
  if (!selectedChannel) return false;
  const selectedModel = asTrimmedString(selectedChannel.actualModel).toLowerCase();
  const normalizedRequestModel = asTrimmedString(requestModel).toLowerCase();
  if (!selectedModel || !normalizedRequestModel) return true;
  return selectedModel === normalizedRequestModel;
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
}): Promise<unknown[] | null> {
  const injectHeaders: Record<string, string | string[]> = {
    ...buildInjectHeaders(input.request),
    [RESPONSES_WEBSOCKET_TRANSPORT_HEADER]: '1',
    ...(input.preserveIncrementalMode ? { [RESPONSES_WEBSOCKET_MODE_HEADER]: 'incremental' } : {}),
  };
  if (
    !headerValueToTrimmedString(injectHeaders.authorization)
    && !headerValueToTrimmedString(injectHeaders['x-api-key'])
    && !headerValueToTrimmedString(injectHeaders['x-goog-api-key'])
  ) {
    injectHeaders.authorization = `Bearer ${input.authToken}`;
  }

  const response = await input.app.inject({
    method: 'POST',
    url: '/v1/responses',
    headers: injectHeaders,
    payload: input.payload,
  });
  console.log('HTTP Injection Fallback Result:', response.statusCode, response.body);

  if (response.statusCode < 200 || response.statusCode >= 300) {
    let payload: unknown = null;
    try {
      payload = JSON.parse(response.body);
    } catch {
      payload = null;
    }
    writeResponsesWebsocketError(
      input.socket,
      response.statusCode,
      response.statusMessage || 'Upstream error',
      payload,
    );
    return null;
  }

  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('text/event-stream')) {
    try {
      const payload = JSON.parse(response.body);
      const output = protocolAdapters.responses.websocket.collectOutput([payload]);
      input.socket.send(JSON.stringify(payload));
      return output;
    } catch {
      writeResponsesWebsocketError(input.socket, 502, 'Unexpected non-JSON websocket proxy response');
      return null;
    }
  }

  const pulled = protocolAdapters.responses.pullSseEvents(response.body);
  const forwardedPayloads: unknown[] = [];
  let sawTerminalPayload = false;
  for (const event of pulled.events) {
    if (event.data === '[DONE]') continue;
    try {
      const payload = JSON.parse(event.data);
      forwardedPayloads.push(payload);
      if (protocolAdapters.responses.websocket.isTerminalPayload(payload)) {
        sawTerminalPayload = true;
      }
      input.socket.send(JSON.stringify(payload));
    } catch {
      // Ignore malformed SSE frames; the HTTP route already normalizes them.
    }
  }
  if (!sawTerminalPayload) {
    writeResponsesWebsocketError(input.socket, 408, 'stream closed before response.completed');
  }
  return protocolAdapters.responses.websocket.collectOutput(forwardedPayloads);
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

async function supportsResponsesWebsocketIncrementalInput(
  parsed: Record<string, unknown>,
  lastRequest: Record<string, unknown> | null,
  authContext: ResponsesWebsocketAuthContext,
): Promise<boolean> {
  const requestModel = asTrimmedString(parsed.model) || asTrimmedString(lastRequest?.model);
  if (!requestModel) return false;

  try {
    const selected = await tokenRouter.previewSelectedTarget(requestModel, authContext.policy);
    return selectedChannelSupportsIncrementalInput(selected, requestModel);
  } catch {
    return false;
  }
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
  let selectedChannel: SelectedTarget | null = null;
  let messageQueue = Promise.resolve();

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

  socket.on('message', (raw) => {
    messageQueue = messageQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          const parsed = parseJsonObject(raw);
          if (!parsed) {
            writeResponsesWebsocketError(socket, 400, 'Invalid websocket JSON payload');
            return;
          }

          const requestModel = asTrimmedString(parsed.model) || asTrimmedString(lastRequest?.model);
          if (requestModel && !await isModelAllowedByPolicyOrAllowedRoutes(requestModel, authContext.policy)) {
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
          const supportsIncrementalInput = selectedChannelSupportsIncrementalInput(selectedChannel, requestModel)
            || await supportsResponsesWebsocketIncrementalInput(parsed, lastRequest, authContext);
          const shouldHandleLocalPrewarm = protocolAdapters.responses.websocket.shouldHandlePrewarmLocally({
            parsed,
            lastRequest,
            supportsIncrementalInput,
          });
          const normalized = protocolAdapters.responses.websocket.normalizeRequest({
            parsed,
            lastRequest,
            lastResponseOutput,
            supportsIncrementalInput,
          });
          if (!normalized.ok) {
            writeResponsesWebsocketError(socket, normalized.status, normalized.message);
            return;
          }

          if (authContext.source === 'managed' && authContext.key?.id) {
            await consumeManagedKeyRequest(authContext.key.id);
          }

          if (shouldHandleLocalPrewarm) {
            lastRequest = normalized.nextRequestSnapshot;
            lastResponseOutput = [];
            for (const payload of protocolAdapters.responses.websocket.synthesizePrewarmResponsePayloads(normalized.request)) {
              socket.send(JSON.stringify(payload));
            }
            return;
          }

          if (!shouldReuseSelectedTarget(selectedChannel, requestModel)) {
            selectedChannel = requestModel
              ? await tokenRouter.selectTarget(requestModel, authContext.policy)
              : null;
          }

          const selectedServiceTierPolicy = applyOpenAiServiceTierPolicy({
            body: normalized.request,
            context: {
              requestedModel: requestModel,
              actualModel: asTrimmedString(selectedChannel?.actualModel),
              sitePlatform: asTrimmedString(selectedChannel?.site?.platform),
              accountType: getOauthInfoFromAccount(selectedChannel?.account)?.planType,
            },
            rules: getServiceTierPolicyRules(),
          });
          if (!selectedServiceTierPolicy.ok) {
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

          const codexWebsocketChannel = selectedChannelSupportsCodexWebsocketTransport(selectedChannel, requestModel)
            ? selectedChannel
            : null;

          if (codexWebsocketChannel) {
            const downstreamHeaders: Record<string, unknown> = {
              ...(request.headers as Record<string, unknown>),
              [RESPONSES_WEBSOCKET_TRANSPORT_HEADER]: '1',
              ...(supportsIncrementalInput ? { [RESPONSES_WEBSOCKET_MODE_HEADER]: 'incremental' } : {}),
            };
            const platformHeaders = buildOauthProviderHeaders({
              account: codexWebsocketChannel.account,
              downstreamHeaders,
            });

            const websocketRuntimeSessionKey = buildCodexSessionResponseStoreKey({
              sessionId: websocketSessionId,
              siteId: codexWebsocketChannel.site.id,
              accountId: codexWebsocketChannel.account.id,
              targetId: codexWebsocketChannel.target.id,
            }) || websocketSessionId;
            runtimeSessionKeys.add(websocketRuntimeSessionKey);

            try {
              const platformProfile = resolvePlatformProfile(codexWebsocketChannel.site.platform);
              const runtimeResult = await runWithSiteApiEndpointPool(
                codexWebsocketChannel.site as Parameters<typeof runWithSiteApiEndpointPool>[0],
                async (target) => {
                  const prepared = buildUpstreamEndpointRequest({
                    endpoint: 'responses',
                    modelName: asTrimmedString(codexWebsocketChannel.actualModel) || requestModel,
                    stream: true,
                    tokenValue: codexWebsocketChannel.tokenValue,
                    sitePlatform: codexWebsocketChannel.site.platform,
                    siteUrl: target.baseUrl,
                    openaiBody: normalized.request,
                    downstreamFormat: 'responses',
                    responsesOriginalBody: normalized.request,
                    downstreamHeaders,
                    platformHeaders,
                    codexExplicitSessionId: deriveCodexExplicitSessionId(normalized.request, websocketSessionId),
                    routeGraphFilters: codexWebsocketChannel.routeGraph?.postBuildFilters ?? null,
                    compatibilityPolicy: resolveDispatchUpstreamCompatibilityPolicy({
                      defaultCompatibilityPolicy: platformProfile?.defaultCompatibilityPolicy,
                      site: codexWebsocketChannel.site,
                      account: codexWebsocketChannel.account,
                      token: codexWebsocketChannel.token,
                      routeEndpointCompatibilityPolicy: codexWebsocketChannel.routeGraph?.routeEndpointCompatibilityPolicy,
                      selectedEndpointTarget: codexWebsocketChannel.routeGraph?.selectedEndpointTarget,
                    }),
                  });
                  const requestUrl = `${target.baseUrl.replace(/\/+$/, '')}${prepared.path}`;

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
              lastResponseOutput = protocolAdapters.responses.websocket.collectOutput(runtimeResult.events);
              for (const payload of runtimeResult.events) {
                socket.send(JSON.stringify(payload));
              }
            } catch (error) {
              const runtimeError = unwrapCodexWebsocketRuntimeError(error);
              if (runtimeError.status && runtimeError.events.length === 0) {
                const forwarded = await forwardResponsesRequestViaHttp({
                  app,
                  socket,
                  request,
                  payload: normalized.request,
                  preserveIncrementalMode: supportsIncrementalInput,
                  authToken: authContext.token,
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
          });
          if (forwarded) {
            lastResponseOutput = forwarded;
          }
        } catch {
          writeResponsesWebsocketError(socket, 500, 'internal websocket proxy error');
        }
      });
  });
}

export function ensureResponsesWebsocketTransport(app: FastifyInstance) {
  if (installedApps.has(app)) return;
  installedApps.add(app);

  const websocketServer = new WebSocketServer({ noServer: true });
  websocketServer.on('headers', (headers, request) => {
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
      websocketServer.handleUpgrade(request, socket, head, (client) => {
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
