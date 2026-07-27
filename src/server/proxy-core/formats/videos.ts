import type { DownstreamProtocolAdapter, ParsedDownstreamRequest, PassthroughHeadersConfig } from './types.js';
import { extractSafePassthroughHeaders } from './headerPassthrough.js';

export const openaiVideosProtocolAdapter: DownstreamProtocolAdapter = {
  format: 'openai/videos',
  routes: ['/v1/videos/generations'],
  headerRule: {},
  parseRequest(body: unknown, _headers?: Record<string, unknown>, _config?: PassthroughHeadersConfig): ParsedDownstreamRequest {
    const record = !!body && typeof body === 'object' ? (body as Record<string, any>) : {};
    return {
      modelName: typeof record.model === 'string' ? record.model.trim() : 'gpt-video-1',
      stream: false,
      standardBody: record,
      originalBody: record,
    };
  },
  extractPassthroughHeaders(headers?: Record<string, unknown>, config?: PassthroughHeadersConfig): Record<string, string> {
    return extractSafePassthroughHeaders(headers, config);
  },
  transformRequest(body: unknown) {
    const record = !!body && typeof body === 'object' ? (body as Record<string, any>) : {};
    return {
      value: {
        requestedModel: typeof record.model === 'string' ? record.model.trim() : 'gpt-video-1',
        isStream: false,
        openaiBody: record,
      }
    };
  },
  transformResponse(options) {
    try {
      return typeof options.upstreamBody === 'string' ? JSON.parse(options.upstreamBody) : options.upstreamBody;
    } catch {
      return options.upstreamBody;
    }
  },
};
