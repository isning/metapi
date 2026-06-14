import type { DownstreamProtocolAdapter, ParsedDownstreamRequest, PassthroughHeadersConfig, BodyConstraintsConfig, TransformRequestContext } from './types.js';
import { extractSafePassthroughHeaders } from './headerPassthrough.js';
import { openAiChatTransformer } from '../../transformers/openai/chat/index.js';
import { parseProxyUsage } from '../../services/proxyUsageParser.js';

export const openaiChatProtocolAdapter: DownstreamProtocolAdapter = {
  format: 'openai/chat',
  routes: ['/v1/chat/completions', '/chat/completions'],
  headerRule: {},
  parseRequest(body: unknown, _headers?: Record<string, unknown>, _config?: PassthroughHeadersConfig): ParsedDownstreamRequest {
    const record = !!body && typeof body === 'object' ? (body as Record<string, any>) : {};
    return {
      modelName: typeof record.model === 'string' ? record.model.trim() : '',
      stream: !!record.stream,
      standardBody: record,
      originalBody: record,
    };
  },
  extractPassthroughHeaders(headers?: Record<string, unknown>, config?: PassthroughHeadersConfig): Record<string, string> {
    return extractSafePassthroughHeaders(headers, config);
  },
  transformRequest(
    body: unknown,
    _headers?: Record<string, unknown>,
    context?: TransformRequestContext | BodyConstraintsConfig,
    constraints?: BodyConstraintsConfig,
  ) {
    const effectiveConstraints = (
      context
      && !('downstreamPath' in context)
      && (('maxTokensLimit' in context) || ('clampMaxTokens' in context) || ('temperatureOverride' in context))
    )
      ? context as BodyConstraintsConfig
      : constraints;
    const parsedRequestEnvelope = openAiChatTransformer.transformRequest(body);
    if (parsedRequestEnvelope.error) {
      return { error: parsedRequestEnvelope.error };
    }
    const requestEnvelope = parsedRequestEnvelope.value!;
    const openaiBody = requestEnvelope.parsed.upstreamBody;

    // Apply protocol-adapter-specific custom configuration overrides
    if (effectiveConstraints) {
      const { maxTokensLimit, clampMaxTokens, temperatureOverride } = effectiveConstraints;
      if (typeof temperatureOverride === 'number') {
        openaiBody.temperature = temperatureOverride;
      }
      if (typeof maxTokensLimit === 'number' && typeof openaiBody.max_tokens === 'number') {
        if (clampMaxTokens) {
          openaiBody.max_tokens = Math.min(openaiBody.max_tokens, maxTokensLimit);
        } else if (openaiBody.max_tokens > maxTokensLimit) {
          return {
            error: {
              statusCode: 400,
              payload: {
                error: {
                  message: `max_tokens exceeds allowed limit of ${maxTokensLimit}`,
                  type: 'invalid_request_error',
                },
              },
            },
          };
        }
      }
    }

    return {
      value: {
        requestedModel: requestEnvelope.model,
        isStream: requestEnvelope.stream,
        openaiBody,
      }
    };
  },
  createStreamSession(options: any) {
    return openAiChatTransformer.proxyStream.createSession(options);
  },
  transformResponse(options) {
    const normalized = openAiChatTransformer.transformFinalResponse(
      options.upstreamBody,
      options.modelName,
      options.fallbackText || '',
    );
    const usage = parseProxyUsage(options.upstreamBody);
    return openAiChatTransformer.serializeFinalResponse(normalized, usage);
  },
};
