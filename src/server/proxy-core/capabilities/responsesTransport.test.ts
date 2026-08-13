import { describe, expect, it } from 'vitest';

import { shouldForceResponsesUpstreamStream } from './responsesTransport.js';

describe('shouldForceResponsesUpstreamStream', () => {
  it('uses upstream SSE for ordinary Responses requests in auto mode', () => {
    expect(shouldForceResponsesUpstreamStream({
      sitePlatform: 'openai',
      transportMode: 'auto',
    })).toBe(true);
  });

  it('follows the downstream mode for ordinary platforms when configured', () => {
    expect(shouldForceResponsesUpstreamStream({
      sitePlatform: 'openai',
      transportMode: 'follow_downstream',
    })).toBe(false);
  });

  it('preserves mandatory streaming for Codex-compatible platforms', () => {
    expect(shouldForceResponsesUpstreamStream({
      sitePlatform: 'codex',
      transportMode: 'follow_downstream',
    })).toBe(true);
    expect(shouldForceResponsesUpstreamStream({
      sitePlatform: 'sub2api',
      transportMode: 'follow_downstream',
    })).toBe(true);
  });

  it('never forces streaming for compact requests', () => {
    expect(shouldForceResponsesUpstreamStream({
      sitePlatform: 'codex',
      transportMode: 'auto',
      isCompactRequest: true,
    })).toBe(false);
  });
});
