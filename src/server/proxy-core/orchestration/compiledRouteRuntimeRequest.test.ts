import { describe, expect, it } from 'vitest';
import { buildCompiledRouteRuntimeRequestSnapshot } from './compiledRouteRuntimeRequest.js';

describe('buildCompiledRouteRuntimeRequestSnapshot', () => {
  it('preserves endpoint and content evidence without promoting it to a strict session', () => {
    expect(buildCompiledRouteRuntimeRequestSnapshot({
      requestedModel: 'gpt-5.2',
      path: '/v1/responses',
      endpointType: 'openai.responses',
      payload: { input: 'inspect route' },
      clientContext: {
        clientKind: 'generic',
        contentAffinityKey: 'content:opaque-prefix',
      },
      downstreamApiKeyId: 9,
    })).toMatchObject({
      requestedModel: 'gpt-5.2',
      path: '/v1/responses',
      endpointType: 'openai.responses',
      clientContext: {
        clientKind: 'generic',
        sessionId: null,
        contentAffinityKey: 'content:opaque-prefix',
        downstreamApiKeyId: 9,
      },
    });
  });

  it('keeps explicit sessions distinct from absent content evidence', () => {
    expect(buildCompiledRouteRuntimeRequestSnapshot({
      requestedModel: 'claude-sonnet-4-5',
      endpointType: 'anthropic.messages',
      clientContext: {
        clientKind: 'claude_code',
        sessionId: 'session-123',
        traceHint: 'session-123',
      },
    }).clientContext).toEqual({
      clientKind: 'claude_code',
      sessionId: 'session-123',
      contentAffinityKey: null,
      traceHint: 'session-123',
      downstreamApiKeyId: null,
    });
  });
});
