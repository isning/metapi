import { describe, expect, it } from 'vitest';

import { responsesProtocolAdapter } from './responses.js';

describe('Responses stream output ownership', () => {
  it('permits byte passthrough only for a native Codex Responses SSE upstream', () => {
    expect(responsesProtocolAdapter.resolveStreamOutputOwnership?.({
      downstreamHeaders: { 'openai-beta': 'responses=experimental' },
      upstreamContentType: 'text/event-stream; charset=utf-8',
      upstreamPath: '/v1/responses',
    })).toBe('passthrough');

    expect(responsesProtocolAdapter.resolveStreamOutputOwnership?.({
      downstreamHeaders: { 'openai-beta': 'responses=experimental' },
      upstreamContentType: 'text/event-stream; charset=utf-8',
      upstreamPath: '/v1/chat/completions',
    })).toBe('converted');

    expect(responsesProtocolAdapter.resolveStreamOutputOwnership?.({
      downstreamHeaders: {},
      upstreamContentType: 'text/event-stream; charset=utf-8',
      upstreamPath: '/v1/responses',
    })).toBe('converted');

    expect(responsesProtocolAdapter.resolveStreamOutputOwnership?.({
      downstreamHeaders: { 'openai-beta': 'responses=experimental' },
      upstreamContentType: 'application/json',
      upstreamPath: '/v1/responses',
    })).toBe('converted');
  });
});
