import { describe, expect, it } from 'vitest';
import { buildApiKeyAccountHealth, type AccountTokenHealth } from './accountTokenHealthService.js';

function token(id: number, enabled = true) {
  return { id, enabled, token: `key-${id}`, valueStatus: 'ready' } as any;
}

function health(state: AccountTokenHealth['state'], reason = state): AccountTokenHealth {
  return { state, reason, source: 'proxy-observation', checkedAt: '2026-08-15T00:00:00.000Z' };
}

describe('accountTokenHealthService', () => {
  it('returns unknown until an enabled key has a real proxy observation', () => {
    expect(buildApiKeyAccountHealth([token(1)], new Map())).toMatchObject({ state: 'unknown' });
  });

  it('aggregates mixed key outcomes as degraded', () => {
    expect(buildApiKeyAccountHealth(
      [token(1), token(2)],
      new Map([[1, health('healthy')], [2, health('unhealthy')]]),
    )).toMatchObject({ state: 'degraded', source: 'token-aggregate' });
  });

  it('does not let disabled keys make an account unhealthy', () => {
    expect(buildApiKeyAccountHealth(
      [token(1), token(2, false)],
      new Map([[1, health('healthy')], [2, health('unhealthy')]]),
    )).toMatchObject({ state: 'healthy' });
  });
});
