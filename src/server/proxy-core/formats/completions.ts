import type { DownstreamProtocolAdapter, ParsedDownstreamRequest, PassthroughHeadersConfig } from './types.js';
import { extractSafePassthroughHeaders } from './headerPassthrough.js';
import { parseProxyUsage } from '../../services/proxyUsageParser.js';

export const openaiCompletionsProtocolAdapter: DownstreamProtocolAdapter = {
  format: 'openai/completions',
  routes: ['/v1/completions'],
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
  validateRequest(body: any) {
    const requestedModel = body?.model;
    if (!requestedModel) {
      return {
        ok: false,
        statusCode: 400,
        payload: { error: { message: 'model is required', type: 'invalid_request_error' } },
      };
    }
    return { ok: true };
  },
  transformRequest(body: unknown) {
    const record = !!body && typeof body === 'object' ? (body as Record<string, any>) : {};
    return {
      value: {
        requestedModel: typeof record.model === 'string' ? record.model.trim() : '',
        isStream: !!record.stream,
        openaiBody: record,
      }
    };
  },
  transformResponse(options) {
    return options.upstreamBody;
  },
};
