import { describe, expect, it } from 'vitest';
import { extractSafePassthroughHeaders, extractClaudePassthroughHeaders } from './headerPassthrough.js';
import { openaiChatProtocolAdapter } from './openaiChat.js';
import { createConfiguredProtocolAdapter } from './configuredProtocolAdapter.js';
import type { PassthroughHeadersConfig, BodyConstraintsConfig } from './types.js';

describe('policy-driven header passthrough', () => {
  it('respects default behavior when config is not provided', () => {
    const headers = {
      accept: 'application/json',
      'user-agent': 'vitest-runner',
      'x-custom-unauthorized': 'secret',
      'x-metapi-tester-request': '1',
    };
    const extracted = extractSafePassthroughHeaders(headers);
    expect(extracted.accept).toBe('application/json');
    expect(extracted['user-agent']).toBe('vitest-runner');
    expect(extracted['x-custom-unauthorized']).toBeUndefined();
    expect(extracted['x-metapi-tester-request']).toBeUndefined();
  });

  it('respects custom allowlist in headers config', () => {
    const headers = {
      accept: 'application/json',
      'x-custom-allowed-header': 'yes',
      'x-metapi-tester-request': '1', // Blocked by global blocklist
    };
    const config: PassthroughHeadersConfig = {
      allowlist: ['X-Custom-Allowed-Header'],
    };
    const extracted = extractSafePassthroughHeaders(headers, config);
    expect(extracted.accept).toBe('application/json');
    expect(extracted['x-custom-allowed-header']).toBe('yes');
    expect(extracted['x-metapi-tester-request']).toBeUndefined();
  });

  it('respects custom blocklist in headers config', () => {
    const headers = {
      accept: 'application/json',
      'user-agent': 'vitest-runner',
    };
    const config: PassthroughHeadersConfig = {
      blocklist: ['user-agent'],
    };
    const extracted = extractSafePassthroughHeaders(headers, config);
    expect(extracted.accept).toBe('application/json');
    expect(extracted['user-agent']).toBeUndefined();
  });

  it('respects custom prefixes in headers config', () => {
    const headers = {
      'x-developer-feature-a': 'enabled',
      'x-other-pref': 'disabled',
    };
    const config: PassthroughHeadersConfig = {
      forwardAllMatchedPrefixes: ['x-developer-'],
    };
    const extracted = extractSafePassthroughHeaders(headers, config);
    expect(extracted['x-developer-feature-a']).toBe('enabled');
    expect(extracted['x-other-pref']).toBeUndefined();
  });

  it('correctly maps dynamic custom settings inside the Claude protocol adapter', () => {
    const headers = {
      'anthropic-beta': 'v1',
      'x-mycustom-claude-prop': 'val',
    };
    const config: PassthroughHeadersConfig = {
      allowlist: ['x-mycustom-claude-prop'],
    };
    const extracted = extractClaudePassthroughHeaders(headers, config);
    expect(extracted['anthropic-beta']).toBe('v1');
    expect(extracted['x-mycustom-claude-prop']).toBe('val');
  });
});

describe('protocol-adapter-specific custom validations and constraints', () => {
  it('applies custom temperature override from constraints', () => {
    const constraints: BodyConstraintsConfig = {
      temperatureOverride: 0.1,
    };
    const result = openaiChatProtocolAdapter.transformRequest!(
      { model: 'gpt-4o', temperature: 0.9, messages: [{ role: 'user', content: 'hello' }] },
      {},
      constraints,
    );
    expect(result.error).toBeUndefined();
    expect(result.value?.openaiBody.temperature).toBe(0.1);
  });

  it('blocks request if max_tokens exceeds allowed limit when clampMaxTokens is false', () => {
    const constraints: BodyConstraintsConfig = {
      maxTokensLimit: 1000,
      clampMaxTokens: false,
    };
    const result = openaiChatProtocolAdapter.transformRequest!(
      { model: 'gpt-4o', max_tokens: 1500, messages: [{ role: 'user', content: 'hello' }] },
      {},
      constraints,
    );
    expect(result.error).toBeDefined();
    expect(result.error?.statusCode).toBe(400);
    expect((result.error?.payload as any).error.message).toContain('max_tokens exceeds allowed limit');
  });

  it('clamps max_tokens value if max_tokens exceeds allowed limit when clampMaxTokens is true', () => {
    const constraints: BodyConstraintsConfig = {
      maxTokensLimit: 1000,
      clampMaxTokens: true,
    };
    const result = openaiChatProtocolAdapter.transformRequest!(
      { model: 'gpt-4o', max_tokens: 1500, messages: [{ role: 'user', content: 'hello' }] },
      {},
      constraints,
    );
    expect(result.error).toBeUndefined();
    expect(result.value?.openaiBody.max_tokens).toBe(1000);
  });
});

describe('ES6 Configured Protocol Adapter dynamic context injection', () => {
  it('correctly intercepts and binds configurations inside the configured protocol adapter', () => {
    const headers = {
      accept: 'application/json',
      'x-custom-allowed': 'yes-proxy',
    };

    const passthroughHeaders: PassthroughHeadersConfig = {
      allowlist: ['x-custom-allowed'],
    };
    const bodyConstraints: BodyConstraintsConfig = {
      temperatureOverride: 0.25,
    };

    const configuredProtocolAdapter = createConfiguredProtocolAdapter(
      openaiChatProtocolAdapter,
      passthroughHeaders,
      bodyConstraints,
    );

    // Verify extractPassthroughHeaders receives passthroughHeaders from Proxy context
    const extractedHeaders = configuredProtocolAdapter.extractPassthroughHeaders(headers);
    expect(extractedHeaders.accept).toBe('application/json');
    expect(extractedHeaders['x-custom-allowed']).toBe('yes-proxy');

    // Verify transformRequest receives bodyConstraints from Proxy context
    const transformResult = configuredProtocolAdapter.transformRequest!(
      { model: 'gpt-4o', temperature: 0.9, messages: [{ role: 'user', content: 'hello' }] },
      {},
    );
    expect(transformResult.error).toBeUndefined();
    expect(transformResult.value?.openaiBody.temperature).toBe(0.25);
  });

  it('preserves optional method behavior and static fields in the configured protocol adapter', () => {
    const configuredProtocolAdapter = createConfiguredProtocolAdapter(
      openaiChatProtocolAdapter,
      {},
      {},
    );

    // Verify format and routes properties are preserved and correctly read
    expect(configuredProtocolAdapter.format).toBe('openai/chat');
    expect(configuredProtocolAdapter.routes).toEqual(['/v1/chat/completions', '/chat/completions']);

    // Verify that optional methods that are absent on the target remain undefined
    // (openaiChatProtocolAdapter does not define validateRequest)
    expect(configuredProtocolAdapter.validateRequest).toBeUndefined();
  });
});
