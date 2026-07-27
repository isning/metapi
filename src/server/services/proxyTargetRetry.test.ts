import { afterEach, describe, expect, it } from 'vitest';
import { buildConfig, config } from '../config.js';
import {
  canRetryProxyTarget,
  getProxyMaxTargetAttempts,
  getProxyMaxTargetRetries,
} from './proxyTargetRetry.js';

const originalProxyMaxChannelAttempts = config.proxyMaxTargetAttempts;

afterEach(() => {
  config.proxyMaxTargetAttempts = originalProxyMaxChannelAttempts;
});

describe('proxyTargetRetry', () => {
  it('parses proxy max channel attempts from config with a safer default', () => {
    expect(buildConfig({} as NodeJS.ProcessEnv).proxyMaxTargetAttempts).toBe(3);
    expect(buildConfig({ PROXY_MAX_TARGET_ATTEMPTS: '3' } as NodeJS.ProcessEnv).proxyMaxTargetAttempts).toBe(3);
  });

  it('configures high default stream hardening limits with environment overrides', () => {
    const defaults = buildConfig({} as NodeJS.ProcessEnv);

    expect(defaults.proxyStreamMaxSseBufferBytes).toBe(16 * 1024 * 1024);
    expect(defaults.proxyStreamMaxReasoningBytes).toBe(128 * 1024 * 1024);
    expect(defaults.proxyStreamMaxContentBytes).toBe(128 * 1024 * 1024);
    expect(defaults.proxyStreamMaxToolArgumentBytes).toBe(128 * 1024 * 1024);
    expect(defaults.proxyStreamMaxAggregateBytes).toBe(256 * 1024 * 1024);

    const overridden = buildConfig({
      PROXY_STREAM_MAX_SSE_BUFFER_BYTES: '1024',
      PROXY_STREAM_MAX_REASONING_BYTES: '2048',
      PROXY_STREAM_MAX_CONTENT_BYTES: '4096',
      PROXY_STREAM_MAX_TOOL_ARGUMENT_BYTES: '8192',
      PROXY_STREAM_MAX_AGGREGATE_BYTES: '16384',
    } as NodeJS.ProcessEnv);

    expect(overridden.proxyStreamMaxSseBufferBytes).toBe(1024);
    expect(overridden.proxyStreamMaxReasoningBytes).toBe(2048);
    expect(overridden.proxyStreamMaxContentBytes).toBe(4096);
    expect(overridden.proxyStreamMaxToolArgumentBytes).toBe(8192);
    expect(overridden.proxyStreamMaxAggregateBytes).toBe(16384);
  });

  it('derives retry budget from total channel attempts', () => {
    config.proxyMaxTargetAttempts = 5;

    expect(getProxyMaxTargetAttempts()).toBe(5);
    expect(getProxyMaxTargetRetries()).toBe(4);
    expect(canRetryProxyTarget(3)).toBe(true);
    expect(canRetryProxyTarget(4)).toBe(false);
  });

  it('clamps invalid runtime config to at least one channel attempt', () => {
    config.proxyMaxTargetAttempts = 0;

    expect(getProxyMaxTargetAttempts()).toBe(1);
    expect(getProxyMaxTargetRetries()).toBe(0);
    expect(canRetryProxyTarget(0)).toBe(false);
  });
});
