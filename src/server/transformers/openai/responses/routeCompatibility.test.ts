import { describe, expect, it } from 'vitest';

import { createResponsesEndpointStrategy } from './routeCompatibility.js';

describe('responses endpoint compatibility fallback', () => {
  const strategy = createResponsesEndpointStrategy({
    isStream: true,
    requiresNativeResponsesFileUrl: false,
    dispatchRequest: async () => new Response('', { status: 500 }) as any,
  });
  const context = (status: number, rawErrText: string) => ({
    request: {
      endpoint: 'responses' as const,
      path: '/v1/responses',
      headers: { 'content-type': 'application/json' },
      body: { model: 'gpt-test', input: 'hi' },
    },
    targetUrl: 'https://upstream.example.com/v1/responses',
    response: { status } as any,
    rawErrText,
  });

  it('does not turn upstream capacity failures into an API-variant fallback', () => {
    expect(strategy.shouldDowngrade(context(500, JSON.stringify({
      error: {
        message: '当前模型负载已经达到上限，请稍后重试',
        type: 'new_api_error',
        code: 'get_channel_failed',
      },
    })))).toBe(false);
  });

  it('still falls back when the upstream explicitly rejects the endpoint', () => {
    expect(strategy.shouldDowngrade(context(404, JSON.stringify({
      error: { message: 'unknown endpoint', type: 'not_found_error' },
    })))).toBe(true);
  });
});
