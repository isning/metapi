import { describe, expect, it, vi } from 'vitest';

import { DefaultProxyConductor } from './DefaultProxyConductor.js';
import { terminalStreamFailure } from './streamTermination.js';

const baseSelectedExecutionAttempt = {
  target: { id: 11, routeId: 22 },
  site: { id: 44, name: 'demo-site', url: 'https://upstream.example.com', platform: 'openai' },
  account: { id: 33, username: 'demo-user' },
  tokenName: 'default',
  tokenValue: 'sk-demo',
  actualModel: 'upstream-gpt',
};

describe('DefaultProxyConductor', () => {
  it('returns the first selected channel when the first attempt succeeds', async () => {
    const selectExecutionAttempt = vi.fn().mockResolvedValue(baseSelectedExecutionAttempt);
    const selectNextExecutionAttempt = vi.fn();
    const recordSuccess = vi.fn().mockResolvedValue(undefined);
    const recordFailure = vi.fn().mockResolvedValue(undefined);
    const conductor = new DefaultProxyConductor({
      selectExecutionAttempt,
      selectNextExecutionAttempt,
      recordSuccess,
      recordFailure,
    });
    const attempt = vi.fn().mockResolvedValue({
      ok: true,
      response: new Response('ok', { status: 200 }),
      latencyMs: 12,
      cost: 0.25,
    });

    const result = await conductor.execute({
      requestedModel: 'gpt-5.4',
      attempt,
    });

    expect(result).toMatchObject({
      ok: true,
      selected: baseSelectedExecutionAttempt,
      attempts: 1,
    });
    expect(selectExecutionAttempt).toHaveBeenCalledWith('gpt-5.4', undefined);
    expect(selectNextExecutionAttempt).not.toHaveBeenCalled();
    expect(recordFailure).not.toHaveBeenCalled();
    expect(recordSuccess).toHaveBeenCalledWith(11, {
      latencyMs: 12,
      cost: 0.25,
    });
  });

  it('retries on the same target when the attempt asks for a same-channel retry', async () => {
    const selectExecutionAttempt = vi.fn().mockResolvedValue(baseSelectedExecutionAttempt);
    const selectNextExecutionAttempt = vi.fn();
    const recordSuccess = vi.fn().mockResolvedValue(undefined);
    const recordFailure = vi.fn().mockResolvedValue(undefined);
    const conductor = new DefaultProxyConductor({
      selectExecutionAttempt,
      selectNextExecutionAttempt,
      recordSuccess,
      recordFailure,
    });
    const attempt = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        action: 'retry_same_target',
        status: 429,
        rawErrorText: 'rate limited',
      })
      .mockResolvedValueOnce({
        ok: true,
        response: new Response('ok', { status: 200 }),
      });

    const result = await conductor.execute({
      requestedModel: 'gpt-5.4',
      attempt,
    });

    expect(result).toMatchObject({
      ok: true,
      attempts: 2,
    });
    expect(selectNextExecutionAttempt).not.toHaveBeenCalled();
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(recordFailure).toHaveBeenCalledWith(11, {
      status: 429,
      rawErrorText: 'rate limited',
    });
  });

  it('fails over to the next target when the attempt asks for failover', async () => {
    const nextSelectedExecutionAttempt = {
      ...baseSelectedExecutionAttempt,
      target: { id: 12, routeId: 22 },
      tokenValue: 'sk-next',
    };
    const selectExecutionAttempt = vi.fn().mockResolvedValue(baseSelectedExecutionAttempt);
    const selectNextExecutionAttempt = vi.fn().mockResolvedValue(nextSelectedExecutionAttempt);
    const recordSuccess = vi.fn().mockResolvedValue(undefined);
    const recordFailure = vi.fn().mockResolvedValue(undefined);
    const conductor = new DefaultProxyConductor({
      selectExecutionAttempt,
      selectNextExecutionAttempt,
      recordSuccess,
      recordFailure,
    });
    const attempt = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        action: 'failover',
        status: 503,
        rawErrorText: 'upstream unavailable',
      })
      .mockResolvedValueOnce({
        ok: true,
        response: new Response('ok', { status: 200 }),
      });

    const result = await conductor.execute({
      requestedModel: 'gpt-5.4',
      attempt,
    });

    expect(result).toMatchObject({
      ok: true,
      selected: nextSelectedExecutionAttempt,
      attempts: 2,
    });
    expect(selectNextExecutionAttempt).toHaveBeenCalledWith('gpt-5.4', [11], undefined);
    expect(recordFailure).toHaveBeenCalledWith(11, {
      status: 503,
      rawErrorText: 'upstream unavailable',
    });
    expect(recordSuccess).toHaveBeenCalledWith(12, {
      latencyMs: null,
      cost: null,
    });
  });

  it('refreshes auth on 401 and retries the same target with the refreshed selection', async () => {
    const refreshedTarget = {
      ...baseSelectedExecutionAttempt,
      tokenValue: 'sk-refreshed',
    };
    const refreshAuth = vi.fn().mockResolvedValue(refreshedTarget);
    const conductor = new DefaultProxyConductor({
      selectExecutionAttempt: vi.fn().mockResolvedValue(baseSelectedExecutionAttempt),
      selectNextExecutionAttempt: vi.fn(),
      recordSuccess: vi.fn().mockResolvedValue(undefined),
      recordFailure: vi.fn().mockResolvedValue(undefined),
      refreshAuth,
    });
    const attempt = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        action: 'refresh_auth',
        status: 401,
        rawErrorText: 'expired token',
      })
      .mockResolvedValueOnce({
        ok: true,
        response: new Response('ok', { status: 200 }),
      });

    const result = await conductor.execute({
      requestedModel: 'gpt-5.4',
      attempt,
    });

    expect(result).toMatchObject({
      ok: true,
      selected: refreshedTarget,
      attempts: 2,
    });
    expect(refreshAuth).toHaveBeenCalledWith(baseSelectedExecutionAttempt, {
      status: 401,
      rawErrorText: 'expired token',
    });
  });

  it('returns a no_target result when no channel is available', async () => {
    const conductor = new DefaultProxyConductor({
      selectExecutionAttempt: vi.fn().mockResolvedValue(null),
      selectNextExecutionAttempt: vi.fn(),
      recordSuccess: vi.fn(),
      recordFailure: vi.fn(),
      previewExecutionAttempt: vi.fn().mockResolvedValue(null),
    });

    expect(await conductor.previewExecutionAttempt('gpt-5.4')).toBe(null);

    const result = await conductor.execute({
      requestedModel: 'gpt-5.4',
      attempt: vi.fn(),
    });

    expect(result).toEqual({
      ok: false,
      reason: 'no_target',
      attempts: 0,
    });
  });

  it('propagates terminal stream failures and calls the terminal failure hook', async () => {
    const onTerminalFailure = vi.fn().mockResolvedValue(undefined);
    const conductor = new DefaultProxyConductor({
      selectExecutionAttempt: vi.fn().mockResolvedValue(baseSelectedExecutionAttempt),
      selectNextExecutionAttempt: vi.fn(),
      recordSuccess: vi.fn(),
      recordFailure: vi.fn().mockResolvedValue(undefined),
    });
    const attempt = vi.fn().mockResolvedValue({
      ok: false,
      ...terminalStreamFailure({
        status: 502,
        rawErrorText: 'stream disconnected before completion',
      }),
    });

    const result = await conductor.execute({
      requestedModel: 'gpt-5.4',
      attempt,
      onTerminalFailure,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'terminal',
      selected: baseSelectedExecutionAttempt,
      status: 502,
      rawErrorText: 'stream disconnected before completion',
      attempts: 1,
    });
    expect(onTerminalFailure).toHaveBeenCalledWith(baseSelectedExecutionAttempt, {
      status: 502,
      rawErrorText: 'stream disconnected before completion',
    });
  });
});
