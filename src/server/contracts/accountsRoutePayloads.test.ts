import { describe, expect, it } from 'vitest';
import {
  parseAccountBatchPayload,
  parseAccountCreatePayload,
  parseAccountHealthRefreshPayload,
  parseAccountLoginPayload,
  parseAccountManualModelsPayload,
  parseAccountRebindSessionPayload,
  parseAccountUpdatePayload,
  parseAccountVerifyTokenPayload,
} from './accountsRoutePayloads.js';

describe('account route payload contracts', () => {
  it('accepts valid account payloads and preserves passthrough data', () => {
    expect(parseAccountCreatePayload({
      siteId: 1,
      username: 'alice',
      accessToken: 'access',
      accessTokens: ['a', 'b'],
      apiToken: 'api',
      platformUserId: 2,
      checkinEnabled: true,
      credentialMode: 'apikey',
      refreshToken: 'refresh',
      tokenExpiresAt: '2030',
      skipModelFetch: false,
      extra: 'kept',
    })).toEqual({
      success: true,
      data: {
        siteId: 1,
        username: 'alice',
        accessToken: 'access',
        accessTokens: ['a', 'b'],
        apiToken: 'api',
        platformUserId: 2,
        checkinEnabled: true,
        credentialMode: 'apikey',
        refreshToken: 'refresh',
        tokenExpiresAt: '2030',
        skipModelFetch: false,
        extra: 'kept',
      },
    });

    expect(parseAccountUpdatePayload({ apiToken: null, sortOrder: 0, proxyUrl: null })).toEqual({
      success: true,
      data: { apiToken: null, sortOrder: 0, proxyUrl: null },
    });
    expect(parseAccountBatchPayload({ ids: [1], action: 'refresh' })).toEqual({
      success: true,
      data: { ids: [1], action: 'refresh' },
    });
    expect(parseAccountRebindSessionPayload({ accessToken: 'new' })).toEqual({
      success: true,
      data: { accessToken: 'new' },
    });
    expect(parseAccountHealthRefreshPayload(undefined)).toEqual({ success: true, data: {} });
    expect(parseAccountLoginPayload({ siteId: 1, username: 'u', password: 'p' })).toEqual({
      success: true,
      data: { siteId: 1, username: 'u', password: 'p' },
    });
    expect(parseAccountVerifyTokenPayload({ siteId: 1, credentialMode: 'session' })).toEqual({
      success: true,
      data: { siteId: 1, credentialMode: 'session' },
    });
    expect(parseAccountManualModelsPayload({ models: ['gpt-4.1'] })).toEqual({
      success: true,
      data: { models: ['gpt-4.1'] },
    });
  });

  it('returns field-specific validation messages', () => {
    const cases: Array<[string, () => unknown, string]> = [
      ['siteId', () => parseAccountCreatePayload({ siteId: 0 }), 'Invalid siteId. Expected positive number.'],
      ['accessToken', () => parseAccountCreatePayload({ siteId: 1, accessToken: 1 }), 'Invalid accessToken. Expected string.'],
      ['username', () => parseAccountLoginPayload({ siteId: 1, username: 1, password: 'p' }), 'Invalid username. Expected string.'],
      ['password', () => parseAccountLoginPayload({ siteId: 1, username: 'u', password: 1 }), 'Invalid password. Expected string.'],
      ['apiToken', () => parseAccountUpdatePayload({ apiToken: 1 }), 'Invalid apiToken. Expected string or null.'],
      ['accessTokens', () => parseAccountCreatePayload({ siteId: 1, accessTokens: [1] }), 'Invalid accessTokens. Expected string[].'],
      ['checkinEnabled', () => parseAccountCreatePayload({ siteId: 1, checkinEnabled: 'yes' }), 'Invalid checkinEnabled. Expected boolean.'],
      ['unitCost', () => parseAccountUpdatePayload({ unitCost: '1' }), 'Invalid unitCost. Expected number or null.'],
      ['credentialMode', () => parseAccountCreatePayload({ siteId: 1, credentialMode: 'password' }), 'Invalid credentialMode. Expected auto/session/apikey.'],
      ['skipModelFetch', () => parseAccountCreatePayload({ siteId: 1, skipModelFetch: 'yes' }), 'Invalid skipModelFetch. Expected boolean.'],
      ['isPinned', () => parseAccountUpdatePayload({ isPinned: 'yes' }), 'Invalid isPinned. Expected boolean.'],
      ['sortOrder', () => parseAccountUpdatePayload({ sortOrder: -1 }), 'Invalid sortOrder. Expected non-negative integer.'],
      ['proxyUrl', () => parseAccountUpdatePayload({ proxyUrl: 1 }), 'Invalid proxyUrl. Expected string or null.'],
      ['ids', () => parseAccountBatchPayload({ ids: [0] }), 'Invalid ids. Expected number[].'],
      ['action', () => parseAccountBatchPayload({ action: 1 }), 'Invalid action. Expected string.'],
      ['platformUserId', () => parseAccountCreatePayload({ siteId: 1, platformUserId: 0 }), 'Invalid platformUserId. Expected positive number.'],
      ['refreshToken', () => parseAccountUpdatePayload({ refreshToken: 1 }), 'Invalid refreshToken. Expected string or null.'],
      ['tokenExpiresAt', () => parseAccountUpdatePayload({ tokenExpiresAt: {} }), 'Invalid tokenExpiresAt. Expected number, string, or null.'],
      ['accountId', () => parseAccountHealthRefreshPayload({ accountId: 0 }), '账号 ID 无效'],
      ['wait', () => parseAccountHealthRefreshPayload({ wait: 'yes' }), 'Invalid wait. Expected boolean.'],
      ['models', () => parseAccountManualModelsPayload({ models: [1] }), 'Invalid models. Expected string[].'],
    ];

    for (const [name, parse, error] of cases) {
      expect(parse(), name).toEqual({ success: false, error });
    }
  });
});
