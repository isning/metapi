import { afterEach, describe, expect, it } from 'vitest';
import { buildConfig, config } from '../config.js';
import {
  canRetryProxyChannel,
  getProxyMaxChannelAttempts,
  getProxyMaxChannelRetries,
} from './proxyChannelRetry.js';

const originalProxyMaxChannelAttempts = config.proxyMaxChannelAttempts;

afterEach(() => {
  config.proxyMaxChannelAttempts = originalProxyMaxChannelAttempts;
});

describe('proxyChannelRetry', () => {
  it('parses proxy max channel attempts from config with a safer default', () => {
    expect(buildConfig({} as NodeJS.ProcessEnv).proxyMaxChannelAttempts).toBe(3);
    expect(buildConfig({ PROXY_MAX_CHANNEL_ATTEMPTS: '3' } as NodeJS.ProcessEnv).proxyMaxChannelAttempts).toBe(3);
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
    config.proxyMaxChannelAttempts = 5;

    expect(getProxyMaxChannelAttempts()).toBe(5);
    expect(getProxyMaxChannelRetries()).toBe(4);
    expect(canRetryProxyChannel(3)).toBe(true);
    expect(canRetryProxyChannel(4)).toBe(false);
  });

  it('clamps invalid runtime config to at least one channel attempt', () => {
    config.proxyMaxChannelAttempts = 0;

    expect(getProxyMaxChannelAttempts()).toBe(1);
    expect(getProxyMaxChannelRetries()).toBe(0);
    expect(canRetryProxyChannel(0)).toBe(false);
  });
});
