import type { PlatformCredentialContext } from './base.js';

export function testAccountContext(baseUrl: string, credential = ''): PlatformCredentialContext {
  return {
    endpoint: { baseUrl },
    account: { id: null, siteId: null, username: null, mode: 'session', credential, credentialKind: 'access_token', extraConfig: null },
    token: null,
  };
}

export function testModelContext(baseUrl: string, token: string): PlatformCredentialContext {
  const context = testAccountContext(baseUrl);
  return {
    ...context,
    account: { ...context.account, mode: 'apikey' },
    token: { id: null, accountId: null, token, enabled: true, extraConfig: null },
  };
}
