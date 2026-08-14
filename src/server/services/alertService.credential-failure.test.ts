import { describe, expect, it } from 'vitest';
import { buildCredentialAuthenticationFailure } from './alertService.js';

describe('credential authentication failure classification', () => {
  const base = {
    accountId: 24,
    accountLabel: 'newapi-account',
    siteLabel: 'NewAPI',
    detail: 'HTTP 401',
  };

  it('does not describe an API Key rejection as an expired access token', () => {
    const failure = buildCredentialAuthenticationFailure({
      ...base,
      credentialKind: 'apikey',
    });

    expect(failure).toMatchObject({
      title: 'API Key 验证失败',
      accountStatus: null,
      runtimeHealth: {
        source: 'proxy-auth',
      },
      openAccountHref: '/accounts?focusAccountId=24',
    });
    expect(failure.message).not.toContain('访问令牌已过期');
    expect(failure.message).toContain('API Key');
  });

  it('keeps session expiry semantics for Access Token failures', () => {
    const failure = buildCredentialAuthenticationFailure({
      ...base,
      credentialKind: 'session',
    });

    expect(failure).toMatchObject({
      title: '访问令牌已失效',
      accountStatus: 'expired',
      runtimeHealth: {
        source: 'auth',
      },
      openAccountHref: '/accounts?focusAccountId=24&openRebind=1',
    });
    expect(failure.message).toContain('访问令牌无效或已过期');
  });
});
