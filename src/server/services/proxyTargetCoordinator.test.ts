import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';
import {
  proxyTargetCoordinator,
  resetProxyTargetCoordinatorState,
} from './proxyTargetCoordinator.js';

describe('proxyTargetCoordinator', () => {
  const originalStickyEnabled = config.proxyStickySessionEnabled;
  const originalStickyTtlMs = config.proxyStickySessionTtlMs;
  const originalConcurrencyLimit = config.proxySessionTargetConcurrencyLimit;
  const originalQueueWaitMs = config.proxySessionTargetQueueWaitMs;
  const originalLeaseTtlMs = config.proxySessionTargetLeaseTtlMs;
  const originalLeaseKeepaliveMs = config.proxySessionTargetLeaseKeepaliveMs;

  beforeEach(() => {
    vi.useFakeTimers();
    config.proxyStickySessionEnabled = true;
    config.proxyStickySessionTtlMs = 31_000;
    config.proxySessionTargetConcurrencyLimit = 1;
    config.proxySessionTargetQueueWaitMs = 200;
    config.proxySessionTargetLeaseTtlMs = 100;
    config.proxySessionTargetLeaseKeepaliveMs = 30;
    resetProxyTargetCoordinatorState();
  });

  afterEach(() => {
    config.proxyStickySessionEnabled = originalStickyEnabled;
    config.proxyStickySessionTtlMs = originalStickyTtlMs;
    config.proxySessionTargetConcurrencyLimit = originalConcurrencyLimit;
    config.proxySessionTargetQueueWaitMs = originalQueueWaitMs;
    config.proxySessionTargetLeaseTtlMs = originalLeaseTtlMs;
    config.proxySessionTargetLeaseKeepaliveMs = originalLeaseKeepaliveMs;
    resetProxyTargetCoordinatorState();
    vi.useRealTimers();
  });

  it('stores sticky bindings for session-scoped channels and expires them by ttl', async () => {
    const key = proxyTargetCoordinator.buildStickySessionKey({
      clientKind: 'codex',
      sessionId: 'turn-123',
      requestedModel: 'gpt-5.2',
      downstreamPath: '/v1/responses',
      downstreamApiKeyId: 9,
    });

    proxyTargetCoordinator.bindStickyTarget(key, 42, JSON.stringify({ credentialMode: 'session' }));
    expect(proxyTargetCoordinator.getStickyTargetId(key)).toBe(42);

    await vi.advanceTimersByTimeAsync(31_100);
    expect(proxyTargetCoordinator.getStickyTargetId(key)).toBeNull();
  });

  it('does not store sticky bindings for apikey-only channels', () => {
    const key = proxyTargetCoordinator.buildStickySessionKey({
      clientKind: 'codex',
      sessionId: 'turn-456',
      requestedModel: 'gpt-5.2',
      downstreamPath: '/v1/responses',
      downstreamApiKeyId: 9,
    });

    proxyTargetCoordinator.bindStickyTarget(key, 42, JSON.stringify({ credentialMode: 'apikey' }));
    expect(proxyTargetCoordinator.getStickyTargetId(key)).toBeNull();
  });

  it('treats structured oauth providers as session-scoped even when extraConfig omits oauth.provider', () => {
    const key = proxyTargetCoordinator.buildStickySessionKey({
      clientKind: 'codex',
      sessionId: 'turn-oauth-structured',
      requestedModel: 'gpt-5.2',
      downstreamPath: '/v1/responses',
      downstreamApiKeyId: 9,
    });

    proxyTargetCoordinator.bindStickyTarget(key, 42, {
      oauthProvider: 'codex',
      extraConfig: JSON.stringify({ credentialMode: 'session' }),
    });
    expect(proxyTargetCoordinator.getStickyTargetId(key)).toBe(42);
  });

  it('queues requests behind the active lease and grants the next waiter after release', async () => {
    const first = await proxyTargetCoordinator.acquireTargetLease({
      targetId: 11,
      accountExtraConfig: JSON.stringify({ credentialMode: 'session' }),
    });
    expect(first.status).toBe('acquired');
    if (first.status !== 'acquired') return;

    let secondSettled = false;
    const secondPromise = proxyTargetCoordinator.acquireTargetLease({
      targetId: 11,
      accountExtraConfig: JSON.stringify({ credentialMode: 'session' }),
    }).then((result) => {
      secondSettled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(50);
    expect(secondSettled).toBe(false);

    first.lease.release();
    await vi.advanceTimersByTimeAsync(0);

    const second = await secondPromise;
    expect(second.status).toBe('acquired');
    if (second.status === 'acquired') {
      second.lease.release();
    }
  });

  it('times out queued requests when no slot becomes available', async () => {
    const first = await proxyTargetCoordinator.acquireTargetLease({
      targetId: 11,
      accountExtraConfig: JSON.stringify({ credentialMode: 'session' }),
    });
    expect(first.status).toBe('acquired');
    if (first.status !== 'acquired') return;

    const secondPromise = proxyTargetCoordinator.acquireTargetLease({
      targetId: 11,
      accountExtraConfig: JSON.stringify({ credentialMode: 'session' }),
    });

    await vi.advanceTimersByTimeAsync(250);
    await expect(secondPromise).resolves.toEqual({
      status: 'timeout',
      waitMs: 200,
    });

    first.lease.release();
  });

  it('keeps active leases alive until they are explicitly released', async () => {
    const first = await proxyTargetCoordinator.acquireTargetLease({
      targetId: 11,
      accountExtraConfig: JSON.stringify({ credentialMode: 'session' }),
    });
    expect(first.status).toBe('acquired');
    if (first.status !== 'acquired') return;

    let secondSettled = false;
    const secondPromise = proxyTargetCoordinator.acquireTargetLease({
      targetId: 11,
      accountExtraConfig: JSON.stringify({ credentialMode: 'session' }),
    }).then((result) => {
      secondSettled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(180);
    expect(first.lease.isActive()).toBe(true);
    expect(secondSettled).toBe(false);

    first.lease.release();
    await vi.advanceTimersByTimeAsync(0);

    const second = await secondPromise;
    expect(second.status).toBe('acquired');
    if (second.status === 'acquired') {
      second.lease.release();
    }
  });

  it('exposes the set of currently active leased channels', async () => {
    const lease = await proxyTargetCoordinator.acquireTargetLease({
      targetId: 23,
      accountExtraConfig: JSON.stringify({ credentialMode: 'session' }),
    });
    expect(lease.status).toBe('acquired');
    if (lease.status !== 'acquired') return;

    expect(proxyTargetCoordinator.getActiveTargetIds()).toEqual([23]);

    lease.lease.release();
    expect(proxyTargetCoordinator.getActiveTargetIds()).toEqual([]);
  });

  it('reports active and waiting load for a guarded session channel', async () => {
    const first = await proxyTargetCoordinator.acquireTargetLease({
      targetId: 31,
      accountExtraConfig: JSON.stringify({ credentialMode: 'session' }),
    });
    expect(first.status).toBe('acquired');
    if (first.status !== 'acquired') return;

    const secondPromise = proxyTargetCoordinator.acquireTargetLease({
      targetId: 31,
      accountExtraConfig: JSON.stringify({ credentialMode: 'session' }),
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(proxyTargetCoordinator.getTargetLoadSnapshot({
      targetId: 31,
      accountExtraConfig: JSON.stringify({ credentialMode: 'session' }),
    })).toEqual({
      targetId: 31,
      sessionScoped: true,
      concurrencyLimit: 1,
      activeLeaseCount: 1,
      waitingCount: 1,
      loadRatio: 2,
      saturated: true,
    });

    first.lease.release();
    await vi.advanceTimersByTimeAsync(0);

    const second = await secondPromise;
    expect(second.status).toBe('acquired');
    if (second.status === 'acquired') {
      second.lease.release();
    }
  });

  it('treats structured oauth providers as session-scoped in load snapshots', () => {
    expect(proxyTargetCoordinator.getTargetLoadSnapshot({
      targetId: 41,
      accountExtraConfig: JSON.stringify({ credentialMode: 'session' }),
      accountOauthProvider: 'codex',
    })).toEqual({
      targetId: 41,
      sessionScoped: true,
      concurrencyLimit: 1,
      activeLeaseCount: 0,
      waitingCount: 0,
      loadRatio: 0,
      saturated: false,
    });
  });
});
