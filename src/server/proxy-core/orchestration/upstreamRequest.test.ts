import { describe, expect, it } from 'vitest';
import { buildUpstreamUrl } from './upstreamRequest.js';

describe('buildUpstreamUrl', () => {
  it('uses an explicit version suffix as the API prefix without adding another /v1', () => {
    expect(buildUpstreamUrl('https://ark.cn-beijing.volces.com/api/coding/v3', '/v1/chat/completions'))
      .toBe('https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions');
    expect(buildUpstreamUrl('https://api.example.com/v1beta', '/v1beta/models/gemini-2.5-pro'))
      .toBe('https://api.example.com/v1beta/models/gemini-2.5-pro');
  });

  it('keeps /v1 for a custom non-versioned prefix', () => {
    expect(buildUpstreamUrl('https://gateway.example.com/custom', '/v1/responses'))
      .toBe('https://gateway.example.com/custom/v1/responses');
  });

  it('uses an explicitly configured API prefix even when it has no version-looking suffix', () => {
    expect(buildUpstreamUrl('https://gateway.example.com/openai-compatible', '/v1/chat/completions', {
      basePathMode: 'complete_api_prefix',
    })).toBe('https://gateway.example.com/openai-compatible/chat/completions');
    expect(buildUpstreamUrl('https://gateway.example.com/anthropic-compatible', '/v1/messages', {
      basePathMode: 'complete_api_prefix',
    })).toBe('https://gateway.example.com/anthropic-compatible/messages');
  });

  it('keeps the standard /v1 prefix for a root OpenAI URL', () => {
    expect(buildUpstreamUrl('https://api.openai.com', '/v1/chat/completions'))
      .toBe('https://api.openai.com/v1/chat/completions');
  });
});
