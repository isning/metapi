import { describe, expect, it } from 'vitest';
import {
  endpointTypeFromApiType,
  endpointTypeFromRequest,
  endpointTypeFromUpstreamEndpoint,
} from './upstreamEndpointType.js';

describe('upstreamEndpointType', () => {
  it('normalizes API variants and concrete upstream endpoints to one vocabulary', () => {
    expect(endpointTypeFromApiType('openai_chat_completions')).toBe('openai.chat_completions');
    expect(endpointTypeFromUpstreamEndpoint('chat')).toBe('openai.chat_completions');
    expect(endpointTypeFromApiType('anthropic_messages')).toBe('anthropic.messages');
    expect(endpointTypeFromUpstreamEndpoint('messages')).toBe('anthropic.messages');
    expect(endpointTypeFromApiType('newapi_responses')).toBe('openai.responses');
    expect(endpointTypeFromApiType('gemini_generate_content')).toBe('gemini.generate_content');
  });

  it('keeps endpoint operations with different cache semantics isolated', () => {
    expect(endpointTypeFromRequest({ path: '/v1/responses' })).toBe('openai.responses');
    expect(endpointTypeFromRequest({ path: '/v1/responses/compact' })).toBe('openai.responses.compact');
    expect(endpointTypeFromRequest({ path: '/v1/messages/count_tokens' })).toBe('anthropic.messages.count_tokens');
    expect(endpointTypeFromRequest({ path: '/v1beta/models/gemini:countTokens' })).toBe('gemini.count_tokens');
  });

  it('gives custom adapters stable names when the path has no known protocol', () => {
    expect(endpointTypeFromRequest({ path: '/vendor/generate', downstreamFormat: 'Ark Coding' }))
      .toBe('custom:ark_coding');
    expect(endpointTypeFromRequest({ path: '/vendor/generate', downstreamFormat: 'custom:ark_coding' }))
      .toBe('custom:ark_coding');
    expect(endpointTypeFromRequest({ path: '/v1/chat/completions', downstreamFormat: 'custom:ark_coding' }))
      .toBe('custom:ark_coding');
  });

  it('normalizes endpoint identity independently from URL version prefixes and query strings', () => {
    expect(endpointTypeFromRequest({ path: '/responses?beta=true' })).toBe('openai.responses');
    expect(endpointTypeFromRequest({ path: '/v3/chat/completions?trace=1' })).toBe('openai.chat_completions');
    expect(endpointTypeFromRequest({ path: '/v1beta/models/gemini-2.5-pro:generateContent?key=redacted' }))
      .toBe('gemini.generate_content');
  });

  it('keeps websocket and HTTP responses cache namespaces separate', () => {
    expect(endpointTypeFromRequest({ path: '/v1/responses' })).toBe('openai.responses');
    expect(endpointTypeFromRequest({ path: '/v1/responses:websocket' }))
      .toBe('openai.responses.websocket');
    expect(endpointTypeFromRequest({
      path: '/v1/responses:websocket',
      downstreamFormat: 'responses.websocket',
    })).toBe('openai.responses.websocket');
  });
});
