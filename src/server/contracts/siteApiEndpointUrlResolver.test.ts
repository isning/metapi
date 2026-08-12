import { describe, expect, it } from 'vitest';
import {
  resolveGeminiNativeModelsUrl,
  resolveOpenAiModelsUrl,
  resolveSiteApiEndpointRequestUrl,
} from './siteApiEndpointUrlResolver.js';

describe('site API endpoint URL resolver', () => {
  it('distinguishes a protocol namespace from a complete API prefix', () => {
    expect(resolveSiteApiEndpointRequestUrl({
      baseUrl: 'https://gateway.example.com/openai',
      basePathMode: 'protocol_default',
    }, '/v1/chat/completions')).toBe('https://gateway.example.com/openai/v1/chat/completions');
    expect(resolveSiteApiEndpointRequestUrl({
      baseUrl: 'https://gateway.example.com/custom-api-prefix',
      basePathMode: 'complete_api_prefix',
    }, '/v1/messages')).toBe('https://gateway.example.com/custom-api-prefix/messages');
  });

  it('uses the same OpenAI models rule for catalog and adapter discovery', () => {
    expect(resolveOpenAiModelsUrl({
      baseUrl: 'https://gateway.example.com/custom-api-prefix',
      basePathMode: 'complete_api_prefix',
    })).toBe('https://gateway.example.com/custom-api-prefix/models');
  });

  it('keeps Gemini native versioning protocol-aware', () => {
    expect(resolveGeminiNativeModelsUrl({
      baseUrl: 'https://generativelanguage.googleapis.com',
      basePathMode: 'protocol_default',
    }, 'test-key')).toBe('https://generativelanguage.googleapis.com/v1beta/models?key=test-key');
    expect(resolveGeminiNativeModelsUrl({
      baseUrl: 'https://gateway.example.com/gemini-complete-prefix',
      basePathMode: 'complete_api_prefix',
    }, 'test-key')).toBe('https://gateway.example.com/gemini-complete-prefix/models?key=test-key');
  });
});
