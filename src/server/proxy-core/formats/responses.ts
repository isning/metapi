import type { DownstreamProtocolAdapter, ParsedDownstreamRequest, PassthroughHeadersConfig, BodyConstraintsConfig, TransformRequestContext } from './types.js';
import { extractResponsesPassthroughHeaders } from './headerPassthrough.js';
import { isCodexResponsesSurface } from '../cliProfiles/codexProfile.js';
import { validateExternalResponsesHttpRequest } from '../responsesPreflight.js';
import { openAiResponsesTransformer } from '../../transformers/openai/responses/index.js';
import { parseProxyUsage } from '../../services/proxyUsageParser.js';
import {
  carriesResponsesFileUrlInput,
  summarizeConversationFileInputsInOpenAiBody,
  summarizeConversationFileInputsInResponsesBody,
} from '../capabilities/conversationFileCapabilities.js';

function isResponsesWebsocketTransportRequest(headers?: Record<string, unknown>): boolean {
  if (!headers) return false;
  return Object.entries(headers)
    .some(([rawKey, rawValue]) => rawKey.trim().toLowerCase() === 'x-metapi-responses-websocket-transport'
      && String(rawValue).trim() === '1');
}

function normalizeIncludeList(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function hasExplicitInclude(body: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(body, 'include');
}

function hasResponsesReasoningRequest(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const relevantKeys = ['effort', 'budget_tokens', 'budgetTokens', 'max_tokens', 'maxTokens', 'summary'];
  return relevantKeys.some((key) => {
    const entry = (value as Record<string, unknown>)[key];
    if (typeof entry === 'string') return entry.trim().length > 0;
    return entry !== undefined && entry !== null;
  });
}

function carriesResponsesReasoningContinuity(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => carriesResponsesReasoningContinuity(item));
  }
  if (!value || typeof value !== 'object') return false;

  const entry = value as Record<string, unknown>;
  const type = typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : '';
  if (type === 'reasoning') {
    if (typeof entry.encrypted_content === 'string' && entry.encrypted_content.trim()) {
      return true;
    }
    if (Array.isArray(entry.summary) && entry.summary.length > 0) {
      return true;
    }
  }

  if (typeof entry.reasoning_signature === 'string' && entry.reasoning_signature.trim()) {
    return true;
  }

  return carriesResponsesReasoningContinuity(entry.input)
    || carriesResponsesReasoningContinuity(entry.content);
}

function wantsNativeResponsesReasoning(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const entry = body as Record<string, unknown>;
  const include = normalizeIncludeList(entry.include);
  if (include.some((item) => item.toLowerCase() === 'reasoning.encrypted_content')) {
    return true;
  }
  if (carriesResponsesReasoningContinuity(entry.input)) {
    return true;
  }
  if (hasExplicitInclude(entry)) {
    return false;
  }
  return hasResponsesReasoningRequest(entry.reasoning);
}

export const responsesProtocolAdapter: DownstreamProtocolAdapter = {
  format: 'responses',
  routes: ['/v1/responses', '/v1/responses/compact'],
  headerRule: {},
  parseRequest(body: unknown, _headers?: Record<string, unknown>, _config?: PassthroughHeadersConfig): ParsedDownstreamRequest {
    const rawBody = !!body && typeof body === 'object' ? (body as Record<string, any>) : {};
    return {
      modelName: typeof rawBody.model === 'string' ? rawBody.model.trim() : '',
      stream: !!rawBody.stream,
      standardBody: rawBody,
      originalBody: rawBody,
    };
  },
  extractPassthroughHeaders(headers?: Record<string, unknown>, config?: PassthroughHeadersConfig): Record<string, string> {
    return extractResponsesPassthroughHeaders(headers, config);
  },
  validateRequest(
    body: unknown,
    headers?: Record<string, unknown>,
    downstreamPath?: string,
    _constraints?: BodyConstraintsConfig,
  ): { ok: boolean; statusCode?: number; payload?: unknown } {
    const defaultEncryptedReasoningInclude = isCodexResponsesSurface(headers);
    if (!isResponsesWebsocketTransportRequest(headers)) {
      const preflight = validateExternalResponsesHttpRequest(body as any, {
        allowContinuationToolOutput: defaultEncryptedReasoningInclude,
      });
      if (!preflight.ok) {
        return preflight;
      }
    }
    const isStream = !!(body && typeof body === 'object' && (body as any).stream);
    const isCompactRequest = downstreamPath === '/v1/responses/compact';
    if (isCompactRequest && isStream) {
      return {
        ok: false,
        statusCode: 400,
        payload: {
          error: {
            message: 'stream is not supported on /v1/responses/compact',
            type: 'invalid_request_error',
          },
        },
      };
    }
    return { ok: true };
  },
  transformRequest(
    body: unknown,
    headers?: Record<string, unknown>,
    _context?: TransformRequestContext,
    _constraints?: BodyConstraintsConfig,
  ) {
    const defaultEncryptedReasoningInclude = isCodexResponsesSurface(headers);
    const parsedRequestEnvelope = openAiResponsesTransformer.transformRequest(body, {
      defaultEncryptedReasoningInclude,
    });
    if (parsedRequestEnvelope.error) {
      return { error: parsedRequestEnvelope.error };
    }
    const requestEnvelope = parsedRequestEnvelope.value!;
    const openAiBody = openAiResponsesTransformer.inbound.toOpenAiBody(
      requestEnvelope.parsed.normalizedBody,
      requestEnvelope.model,
      requestEnvelope.stream,
      { defaultEncryptedReasoningInclude },
    );
    return {
      value: {
        requestedModel: requestEnvelope.model,
        isStream: requestEnvelope.stream,
        openaiBody: openAiBody,
        responsesOriginalBody: requestEnvelope.parsed.normalizedBody,
        requestCapabilities: (() => {
          const responsesConversationFileSummary = summarizeConversationFileInputsInResponsesBody(
            requestEnvelope.parsed.normalizedBody,
          );
          const conversationFileSummary = summarizeConversationFileInputsInOpenAiBody(openAiBody);
          return {
            conversationFileSummary,
            hasNonImageFileInput: conversationFileSummary.hasDocument,
            wantsNativeResponsesReasoning: wantsNativeResponsesReasoning(requestEnvelope.parsed.normalizedBody),
            requiresNativeResponsesFileUrl: responsesConversationFileSummary.hasRemoteDocumentUrl
              || carriesResponsesFileUrlInput(requestEnvelope.parsed.normalizedBody.input),
          };
        })(),
      }
    };
  },
  createStreamSession(options: any) {
    return openAiResponsesTransformer.proxyStream.createSession(options);
  },
  transformResponse(options) {
    const normalized = openAiResponsesTransformer.transformFinalResponse(
      options.upstreamBody,
      options.modelName,
      options.fallbackText || '',
    );
    const parsedUsage = parseProxyUsage(options.upstreamBody);
    return openAiResponsesTransformer.outbound.serializeFinal({
      upstreamPayload: options.upstreamBody,
      normalized,
      usage: parsedUsage,
      serializationMode: options.isCompactRequest ? 'compact' : 'response',
    });
  },
};
