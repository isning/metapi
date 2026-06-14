import type { DownstreamProtocolAdapter, ParsedDownstreamRequest, PassthroughHeadersConfig, BodyConstraintsConfig, TransformRequestContext, BuildUpstreamRequestInput } from './types.js';
import { extractClaudePassthroughHeaders } from './headerPassthrough.js';
import { anthropicMessagesTransformer } from '../../transformers/anthropic/messages/index.js';
import { openAiChatTransformer } from '../../transformers/openai/chat/index.js';
import { parseProxyUsage } from '../../services/proxyUsageParser.js';
import { buildClaudeCountTokensUpstreamRequest } from './upstreamRequestBuilder.js';

export const claudeProtocolAdapter: DownstreamProtocolAdapter = {
  format: 'claude',
  routes: ['/v1/messages', '/v1/messages/count_tokens'],
  headerRule: {},
  parseRequest(body: unknown, _headers?: Record<string, unknown>, _config?: PassthroughHeadersConfig): ParsedDownstreamRequest {
    const rawBody = !!body && typeof body === 'object' ? (body as Record<string, any>) : {};
    const next = { ...rawBody };
    delete next.previous_response_id;
    delete next.prompt_cache_key;

    return {
      modelName: typeof rawBody.model === 'string' ? rawBody.model.trim() : '',
      stream: !!rawBody.stream,
      standardBody: next,
      originalBody: next,
    };
  },
  extractPassthroughHeaders(headers?: Record<string, unknown>, config?: PassthroughHeadersConfig): Record<string, string> {
    return extractClaudePassthroughHeaders(headers, config);
  },
  transformRequest(
    body: unknown,
    _headers?: Record<string, unknown>,
    context?: TransformRequestContext,
    _constraints?: BodyConstraintsConfig,
  ) {
    const isCountTokens = context?.downstreamPath === '/v1/messages/count_tokens';
    if (isCountTokens) {
      const rawBody = !!body && typeof body === 'object' ? body as Record<string, unknown> : {};
      return {
        value: {
          requestedModel: typeof rawBody.model === 'string' ? rawBody.model.trim() : '',
          isStream: false,
          openaiBody: rawBody,
          claudeOriginalBody: rawBody,
          requestKind: 'claude-count-tokens',
          disableCrossProtocolFallback: true,
        },
      };
    }

    const parsedRequestEnvelope = anthropicMessagesTransformer.transformRequest(body);
    if (parsedRequestEnvelope.error) {
      return { error: parsedRequestEnvelope.error };
    }
    const requestEnvelope = parsedRequestEnvelope.value!;
    return {
      value: {
        requestedModel: requestEnvelope.model,
        isStream: requestEnvelope.stream,
        openaiBody: requestEnvelope.parsed.upstreamBody,
        claudeOriginalBody: requestEnvelope.parsed.claudeOriginalBody,
      },
    };
  },
  buildUpstreamRequest(input: BuildUpstreamRequestInput) {
    if (input.transformed.requestKind !== 'claude-count-tokens') {
      throw new Error(`Claude adapter cannot build custom upstream request for ${input.transformed.requestKind || 'default operation'}`);
    }
    const upstreamRequest = buildClaudeCountTokensUpstreamRequest({
      modelName: input.modelName,
      tokenValue: input.tokenValue,
      oauthProvider: input.oauth?.provider,
      sitePlatform: input.site.platform,
      claudeBody: input.transformed.claudeOriginalBody || input.transformed.openaiBody,
      downstreamHeaders: input.downstreamHeaders,
    });
    return {
      endpoint: 'messages',
      path: upstreamRequest.path,
      headers: upstreamRequest.headers,
      body: upstreamRequest.body,
      runtime: upstreamRequest.runtime,
    };
  },
  createStreamSession(options: any) {
    return openAiChatTransformer.proxyStream.createSession(options);
  },
  transformResponse(options) {
    if (options.requestKind === 'claude-count-tokens') {
      return options.upstreamBody;
    }
    const normalized = anthropicMessagesTransformer.transformFinalResponse(
      options.upstreamBody,
      options.modelName,
      options.fallbackText || '',
    );
    const usage = parseProxyUsage(options.upstreamBody);
    return anthropicMessagesTransformer.serializeFinalResponse(normalized, usage);
  },
};
