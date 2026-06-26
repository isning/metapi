import type { UpstreamEndpoint } from '../orchestration/upstreamRequest.js';
import { resolvePlatformProfile } from '../platforms/registry.js';
import {
  applyRouteGraphPostBuildFilters,
  type RouteGraphPostBuildFilters,
} from '../../services/routeGraphRuntimeService.js';
import type { DownstreamFormat } from './protocolTypes.js';
import {
  convertOpenAiBodyToResponsesBody as convertOpenAiBodyToResponsesBodyViaTransformer,
  sanitizeResponsesBodyForProxy as sanitizeResponsesBodyForProxyViaTransformer,
} from '../../transformers/openai/responses/conversion.js';
import { normalizeCodexResponsesBodyForProxy } from '../../transformers/openai/responses/codexCompatibility.js';
import {
  convertOpenAiBodyToAnthropicMessagesBody,
  sanitizeAnthropicMessagesBody,
} from '../../transformers/anthropic/messages/conversion.js';
import {
  buildGeminiGenerateContentRequestFromOpenAi,
} from '../../transformers/gemini/generate-content/requestBridge.js';
import { applyOpenAiChatReasoningHistoryTransport } from '../../transformers/canonical/openAiChatReasoningHistoryTransport.js';
import {
  DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY,
  type ResolvedUpstreamCompatibilityPolicy,
} from '../../contracts/upstreamCompatibilityPolicy.js';
import {
  buildClaudeRuntimeHeaders,
  getInputHeader,
  headerValueToString,
} from '../platforms/headers.js';
import {
  extractCodexPassthroughHeaders,
  extractClaudePassthroughHeaders,
} from './headerPassthrough.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePlatformName(platform: unknown): string {
  return asTrimmedString(platform).toLowerCase();
}

const ANTIGRAVITY_RUNTIME_USER_AGENT = 'antigravity/1.19.6 darwin/arm64';

function stripClaudeMessagesContinuationFields(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...body };
  delete next.previous_response_id;
  delete next.prompt_cache_key;
  return next;
}

function ensureStreamAcceptHeader(
  headers: Record<string, string>,
  stream: boolean,
): Record<string, string> {
  if (!stream) return headers;

  const existingAccept = (
    headerValueToString(headers.accept)
    || headerValueToString((headers as Record<string, unknown>).Accept)
  );
  if (existingAccept) return headers;

  return {
    ...headers,
    accept: 'text/event-stream',
  };
}

function ensureResponsesAcceptHeader(
  headers: Record<string, string>,
  input: {
    stream: boolean;
    sitePlatform?: string;
  },
): Record<string, string> {
  const nextHeaders = { ...headers };
  delete (nextHeaders as Record<string, unknown>).Accept;
  delete (nextHeaders as Record<string, unknown>).accept;

  if (input.stream) {
    return {
      ...nextHeaders,
      accept: 'text/event-stream',
    };
  }
  if (normalizePlatformName(input.sitePlatform) === 'sub2api') {
    return {
      ...nextHeaders,
      accept: 'application/json',
    };
  }
  return headers;
}

function normalizeResponsesFallbackChatFunctionTool(rawTool: unknown): Record<string, unknown> | null {
  if (!isRecord(rawTool)) return null;
  if (asTrimmedString(rawTool.type).toLowerCase() !== 'function') return null;

  if (isRecord(rawTool.function)) {
    const name = asTrimmedString(rawTool.function.name);
    if (!name) return null;
    return {
      ...rawTool,
      type: 'function',
      function: {
        ...rawTool.function,
        name,
      },
    };
  }

  const name = asTrimmedString(rawTool.name);
  if (!name) return null;

  const fn: Record<string, unknown> = { name };
  const description = asTrimmedString(rawTool.description);
  if (description) fn.description = description;
  if (rawTool.parameters !== undefined) fn.parameters = rawTool.parameters;
  if (rawTool.strict !== undefined) fn.strict = rawTool.strict;

  return {
    type: 'function',
    function: fn,
  };
}

function isNativeReasoningHistoryTransport(
  policy?: ResolvedUpstreamCompatibilityPolicy,
): boolean {
  if (!policy) return true;
  const transport = policy.reasoningHistory.transport;
  const defaultTransport = DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY.reasoningHistory.transport;
  return transport.mode === 'native'
    && transport.applyTo.assistantHistory === defaultTransport.applyTo.assistantHistory
    && transport.applyTo.assistantToolCalls === defaultTransport.applyTo.assistantToolCalls
    && transport.toolCallMessageBehavior === defaultTransport.toolCallMessageBehavior;
}

function normalizeResponsesFallbackChatToolChoice(
  rawToolChoice: unknown,
  allowedToolNames: Set<string>,
): unknown {
  if (rawToolChoice === undefined) return undefined;

  if (typeof rawToolChoice === 'string') {
    const normalized = rawToolChoice.trim().toLowerCase();
    if (normalized === 'none') return 'none';
    if (allowedToolNames.size <= 0) return undefined;
    if (normalized === 'auto' || normalized === 'required') return normalized;
    return undefined;
  }

  if (!isRecord(rawToolChoice)) return undefined;
  if (asTrimmedString(rawToolChoice.type).toLowerCase() !== 'function') return undefined;

  const nestedFunction = isRecord(rawToolChoice.function) ? rawToolChoice.function : null;
  const name = asTrimmedString(nestedFunction?.name ?? rawToolChoice.name);
  if (!name || !allowedToolNames.has(name)) return undefined;

  return {
    type: 'function',
    function: {
      ...(nestedFunction || {}),
      name,
    },
  };
}

function sanitizeResponsesFallbackChatBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...body };
  const normalizedTools = Array.isArray(body.tools)
    ? body.tools
      .map((tool) => normalizeResponsesFallbackChatFunctionTool(tool))
      .filter((tool): tool is Record<string, unknown> => !!tool)
    : [];

  if (normalizedTools.length > 0) {
    next.tools = normalizedTools;
  } else {
    delete next.tools;
  }

  const allowedToolNames = new Set(
    normalizedTools
      .map((tool) => (
        isRecord(tool.function)
          ? asTrimmedString(tool.function.name)
          : ''
      ))
      .filter((name) => name.length > 0),
  );
  const normalizedToolChoice = normalizeResponsesFallbackChatToolChoice(
    body.tool_choice,
    allowedToolNames,
  );
  if (normalizedToolChoice !== undefined) {
    next.tool_choice = normalizedToolChoice;
  } else {
    delete next.tool_choice;
  }

  return next;
}

function normalizeSub2ApiResponsesBodyForProxy(
  body: Record<string, unknown>,
  sitePlatform: string,
): Record<string, unknown> {
  if (sitePlatform !== 'sub2api') return body;
  return {
    ...body,
    store: false,
  };
}

function extractClaudeBetasFromBody(body: Record<string, unknown>): {
  body: Record<string, unknown>;
  betas: string[];
} {
  const next = { ...body };
  const rawBetas = next.betas;
  delete next.betas;

  if (typeof rawBetas === 'string') {
    return {
      body: next,
      betas: rawBetas.split(',').map((entry) => entry.trim()).filter(Boolean),
    };
  }

  if (Array.isArray(rawBetas)) {
    return {
      body: next,
      betas: rawBetas
        .map((entry) => asTrimmedString(entry))
        .filter(Boolean),
    };
  }

  return {
    body: next,
    betas: [],
  };
}

export function buildUpstreamEndpointRequest(input: {
  endpoint: UpstreamEndpoint;
  modelName: string;
  stream: boolean;
  tokenValue: string;
  oauthProvider?: string;
  oauthProjectId?: string;
  sitePlatform?: string;
  siteUrl?: string;
  openaiBody: Record<string, unknown>;
  downstreamFormat: DownstreamFormat | 'responses';
  claudeOriginalBody?: Record<string, unknown>;
  downstreamHeaders?: Record<string, unknown>;
  passthroughHeaders?: Record<string, string>;
  responsesOriginalBody?: Record<string, unknown>;
  forceNormalizeClaudeBody?: boolean;
  platformHeaders?: Record<string, string>;
  codexSessionCacheKey?: string | null;
  codexExplicitSessionId?: string | null;
  routeGraphFilters?: RouteGraphPostBuildFilters | null;
  compatibilityPolicy?: ResolvedUpstreamCompatibilityPolicy;
}): {
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  runtime?: {
    executor: 'default' | 'codex' | 'gemini-cli' | 'antigravity' | 'claude';
    modelName?: string;
    stream?: boolean;
    oauthProjectId?: string | null;
    action?: 'generateContent' | 'streamGenerateContent' | 'countTokens';
  };
} {
  const sitePlatform = normalizePlatformName(input.sitePlatform);
  let platformProfile = resolvePlatformProfile(sitePlatform);
  if (!platformProfile) {
    if (input.endpoint === 'messages') {
      platformProfile = resolvePlatformProfile('claude');
    } else {
      platformProfile = resolvePlatformProfile('openai');
    }
  }

  const isClaudeUpstream = platformProfile?.id === 'claude';
  const isGeminiUpstream = platformProfile?.id === 'gemini';
  const isGeminiCliUpstream = platformProfile?.id === 'gemini-cli';
  const isAntigravityUpstream = platformProfile?.id === 'antigravity';
  const isInternalGeminiUpstream = isGeminiCliUpstream || isAntigravityUpstream;
  const isClaudeOauthUpstream = isClaudeUpstream && input.oauthProvider === 'claude';

  const stripGeminiUnsupportedFields = (bodyContent: Record<string, unknown>) => {
    const next = { ...bodyContent };
    if (isGeminiUpstream || isInternalGeminiUpstream) {
      for (const key of [
        'frequency_penalty',
        'presence_penalty',
        'logit_bias',
        'logprobs',
        'top_logprobs',
        'store',
      ]) {
        delete next[key];
      }
    }
    return next;
  };

  const policyOpenAiBody = input.compatibilityPolicy
    ? applyOpenAiChatReasoningHistoryTransport(input.openaiBody, input.compatibilityPolicy)
    : input.openaiBody;
  const cleanOpenaiBody = stripGeminiUnsupportedFields(policyOpenAiBody);
  let targetPath = '';
  if (input.endpoint === 'messages') {
    targetPath = '/v1/messages';
  } else if (input.endpoint === 'responses') {
    targetPath = '/v1/responses';
  } else if (input.endpoint === 'embeddings') {
    targetPath = '/v1/embeddings';
  } else if (input.endpoint === 'completions') {
    targetPath = '/v1/completions';
  } else if (input.endpoint.startsWith('images/')) {
    targetPath = `/v1/${input.endpoint}`;
  } else if (input.endpoint.startsWith('videos/')) {
    targetPath = `/v1/${input.endpoint}`;
  } else {
    targetPath = '/v1/chat/completions';
  }

  let resolvedBody: Record<string, unknown>;
  let endpointResponsesWebsocketTransport: boolean | undefined;

  const passthroughHeaders = input.passthroughHeaders || {};
  const codexPassthroughHeaders = sitePlatform === 'codex'
    ? extractCodexPassthroughHeaders(input.downstreamHeaders)
    : {};
  const commonHeaders: Record<string, string> = {
    ...passthroughHeaders,
    ...codexPassthroughHeaders,
    'Content-Type': 'application/json',
    ...(input.platformHeaders || {}),
  };
  if (!isClaudeUpstream) {
    commonHeaders.Authorization = `Bearer ${input.tokenValue}`;
  }

  let headers: Record<string, string> = commonHeaders;

  if (isInternalGeminiUpstream) {
    const instructions = (
      input.downstreamFormat === 'responses'
      && typeof input.responsesOriginalBody?.instructions === 'string'
    )
      ? input.responsesOriginalBody.instructions
      : undefined;
    const geminiRequest = buildGeminiGenerateContentRequestFromOpenAi({
      body: cleanOpenaiBody,
      modelName: input.modelName,
      instructions,
    });
    resolvedBody = geminiRequest;
  } else if (input.endpoint === 'messages') {
    const nativeClaudeBody = (
      input.downstreamFormat === 'claude'
      && input.claudeOriginalBody
      && input.forceNormalizeClaudeBody !== true
      && isNativeReasoningHistoryTransport(input.compatibilityPolicy)
    )
      ? {
        ...stripClaudeMessagesContinuationFields(input.claudeOriginalBody),
        model: input.modelName,
        stream: input.stream,
      }
      : null;
    const normalizedClaudeBody = (
      input.downstreamFormat === 'claude'
      && input.claudeOriginalBody
      && input.forceNormalizeClaudeBody === true
    )
      ? sanitizeAnthropicMessagesBody({
        ...stripClaudeMessagesContinuationFields(input.claudeOriginalBody),
        model: input.modelName,
        stream: input.stream,
      })
      : null;
    const sanitizedBody = nativeClaudeBody
      ?? normalizedClaudeBody
      ?? sanitizeAnthropicMessagesBody(
        convertOpenAiBodyToAnthropicMessagesBody(cleanOpenaiBody, input.modelName, input.stream),
      );
    resolvedBody = sanitizedBody;
  } else if (input.endpoint === 'responses') {
    const responsesWebsocketTransport = getInputHeader(
      input.downstreamHeaders,
      'x-metapi-responses-websocket-transport',
    ) === '1';
    const websocketMode = Object.entries(input.downstreamHeaders || {}).find(([rawKey]) => rawKey.trim().toLowerCase() === 'x-metapi-responses-websocket-mode');
    const preserveWebsocketIncrementalMode = asTrimmedString(websocketMode?.[1]).toLowerCase() === 'incremental';
    const rawBody = (
      input.downstreamFormat === 'responses'
      && input.responsesOriginalBody
      && isNativeReasoningHistoryTransport(input.compatibilityPolicy)
        ? {
          ...stripGeminiUnsupportedFields(input.responsesOriginalBody),
          model: input.modelName,
          stream: input.stream,
        }
        : convertOpenAiBodyToResponsesBodyViaTransformer(cleanOpenaiBody, input.modelName, input.stream)
    );
    const sanitizedResponsesBody = sanitizeResponsesBodyForProxyViaTransformer(rawBody, input.modelName, input.stream);
    if (preserveWebsocketIncrementalMode && rawBody.generate === false) {
      sanitizedResponsesBody.generate = false;
    }
    const tempBody = normalizeCodexResponsesBodyForProxy(
      sanitizedResponsesBody,
      sitePlatform,
    );
    resolvedBody = normalizeCodexResponsesBodyForProxy(
      normalizeSub2ApiResponsesBodyForProxy(
        tempBody,
        sitePlatform,
      ),
      sitePlatform,
    );
    endpointResponsesWebsocketTransport = responsesWebsocketTransport;

    headers = ensureResponsesAcceptHeader(commonHeaders, {
      stream: input.stream,
      sitePlatform,
    });
  } else if (
    input.endpoint === 'embeddings' ||
    input.endpoint.startsWith('images/') ||
    input.endpoint.startsWith('videos/')
  ) {
    resolvedBody = {
      ...cleanOpenaiBody,
      model: input.modelName,
    };
  } else {
    headers = ensureStreamAcceptHeader(commonHeaders, input.stream);
    const chatBody = {
      ...cleanOpenaiBody,
      model: input.modelName,
      stream: input.stream,
    };
    resolvedBody = input.downstreamFormat === 'responses'
      ? sanitizeResponsesFallbackChatBody(chatBody)
      : chatBody;
  }

  if (platformProfile) {
    const prepared = platformProfile.prepareRequest({
      targetPath,
      modelName: input.modelName,
      stream: input.stream,
      tokenValue: input.tokenValue,
      oauthProvider: input.oauthProvider,
      oauthProjectId: input.oauthProjectId,
      sitePlatform,
      openaiBody: resolvedBody,
      downstreamFormat: input.downstreamFormat,
      claudeOriginalBody: input.claudeOriginalBody,
      responsesOriginalBody: input.responsesOriginalBody,
      downstreamHeaders: input.downstreamHeaders,
      baseHeaders: headers,
      platformHeaders: input.platformHeaders,
      codexSessionCacheKey: input.codexSessionCacheKey,
      codexExplicitSessionId: input.codexExplicitSessionId,
      responsesWebsocketTransport: endpointResponsesWebsocketTransport,
      action: isInternalGeminiUpstream
        ? (input.stream ? 'streamGenerateContent' : 'generateContent')
        : undefined,
      siteUrl: input.siteUrl,
    });
    const withRouteHeaders = applyRouteGraphPostBuildFilters({
      payload: prepared.body,
      headers: prepared.headers,
      filters: input.routeGraphFilters,
    });
    return {
      ...prepared,
      headers: withRouteHeaders.headers,
      body: withRouteHeaders.payload,
    };
  }

  const withRouteHeaders = applyRouteGraphPostBuildFilters({
    payload: resolvedBody,
    headers,
    filters: input.routeGraphFilters,
  });
  return {
    path: targetPath,
    headers: withRouteHeaders.headers,
    body: withRouteHeaders.payload,
    runtime: {
      executor: (
        sitePlatform === 'codex'
          ? 'codex'
          : sitePlatform === 'gemini-cli'
            ? 'gemini-cli'
            : sitePlatform === 'antigravity'
              ? 'antigravity'
              : sitePlatform === 'claude'
                ? 'claude'
                : 'default'
      ) as 'default' | 'codex' | 'gemini-cli' | 'antigravity' | 'claude',
      modelName: input.modelName,
      stream: input.stream,
      oauthProjectId: asTrimmedString(input.oauthProjectId) || null,
    },
  };
}

export function buildClaudeCountTokensUpstreamRequest(input: {
  modelName: string;
  tokenValue: string;
  oauthProvider?: string;
  sitePlatform?: string;
  claudeBody: Record<string, unknown>;
  downstreamHeaders?: Record<string, unknown>;
}): {
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  runtime: {
    executor: 'claude';
    modelName: string;
    stream: false;
    action: 'countTokens';
  };
} {
  const sitePlatform = normalizePlatformName(input.sitePlatform);
  const claudeHeaders = extractClaudePassthroughHeaders(input.downstreamHeaders);
  const { body: bodyWithoutBetas, betas } = extractClaudeBetasFromBody({
    ...stripClaudeMessagesContinuationFields(input.claudeBody),
    model: input.modelName,
  });
  const sanitizedBody = sanitizeAnthropicMessagesBody(bodyWithoutBetas);
  delete sanitizedBody.max_tokens;
  delete sanitizedBody.maxTokens;
  delete sanitizedBody.stream;
  const platformProfile = resolvePlatformProfile(sitePlatform);
  const mergedBetas = [
    ...asTrimmedString(claudeHeaders['anthropic-beta'])
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
    ...betas,
  ];
  const effectiveClaudeHeaders = {
    ...claudeHeaders,
    ...(mergedBetas.length > 0
      ? { 'anthropic-beta': Array.from(new Set(mergedBetas)).join(',') }
      : {}),
  };

  if (platformProfile?.id === 'claude' || platformProfile?.id === 'anthropic') {
    const prepared = platformProfile.prepareRequest({
      targetPath: '/v1/messages/count_tokens?beta=true',
      modelName: input.modelName,
      stream: false,
      tokenValue: input.tokenValue,
      oauthProvider: input.oauthProvider,
      sitePlatform,
      openaiBody: sanitizedBody,
      downstreamFormat: 'claude',
      platformHeaders: effectiveClaudeHeaders,
      action: 'countTokens',
    });

    return {
      path: prepared.path,
      headers: prepared.headers,
      body: prepared.body,
      runtime: {
        executor: 'claude',
        modelName: input.modelName,
        stream: false,
        action: 'countTokens',
      },
    };
  }

  const anthropicVersion = (
    effectiveClaudeHeaders['anthropic-version']
    || '2023-06-01'
  );
  const isClaudeOauthUpstream = sitePlatform === 'claude' && input.oauthProvider === 'claude';
  const headers = buildClaudeRuntimeHeaders({
    baseHeaders: {
      'Content-Type': 'application/json',
    },
    claudeHeaders: effectiveClaudeHeaders,
    anthropicVersion,
    stream: false,
    isClaudeOauthUpstream,
    tokenValue: input.tokenValue,
  });

  return {
    path: '/v1/messages/count_tokens?beta=true',
    headers,
    body: sanitizedBody,
    runtime: {
      executor: 'claude',
      modelName: input.modelName,
      stream: false,
      action: 'countTokens',
    },
  };
}
