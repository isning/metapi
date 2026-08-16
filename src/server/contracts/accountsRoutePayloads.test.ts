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
      credential: 'access',
      credentialKind: 'access_token',
      platformUserId: 2,
      checkinEnabled: true,
      skipModelFetch: false,
      extra: 'kept',
    })).toEqual({
      success: true,
      data: {
        siteId: 1,
        username: 'alice',
        credential: 'access',
        credentialKind: 'access_token',
        platformUserId: 2,
        checkinEnabled: true,
        skipModelFetch: false,
        extra: 'kept',
      },
    });

    expect(parseAccountUpdatePayload({ credentialMode: 'apikey', sortOrder: 0, proxyUrl: null })).toEqual({
      success: true,
      data: { credentialMode: 'apikey', sortOrder: 0, proxyUrl: null },
    });
    expect(parseAccountBatchPayload({ ids: [1], action: 'refresh' })).toEqual({
      success: true,
      data: { ids: [1], action: 'refresh' },
    });
    expect(parseAccountRebindSessionPayload({ credential: 'new' })).toEqual({
      success: true,
      data: { credential: 'new' },
    });
    expect(parseAccountHealthRefreshPayload(undefined)).toEqual({ success: true, data: {} });
    expect(parseAccountLoginPayload({ siteId: 1, username: 'u', password: 'p' })).toEqual({
      success: true,
      data: { siteId: 1, username: 'u', password: 'p' },
    });
    expect(parseAccountVerifyTokenPayload({ siteId: 1, credential: 'access', credentialKind: 'access_token' })).toEqual({
      success: true,
      data: { siteId: 1, credential: 'access', credentialKind: 'access_token' },
    });
    expect(parseAccountManualModelsPayload({ models: ['gpt-4.1'] })).toEqual({
      success: true,
      data: { models: ['gpt-4.1'] },
    });
  });

  it('returns field-specific validation messages', () => {
    const cases: Array<[string, () => unknown, string]> = [
      ['siteId', () => parseAccountCreatePayload({ siteId: 0 }), 'Invalid siteId. Expected positive number.'],
      ['credential', () => parseAccountCreatePayload({ siteId: 1, credential: 1 }), 'Invalid credential. Expected string.'],
      ['username', () => parseAccountLoginPayload({ siteId: 1, username: 1, password: 'p' }), 'Invalid username. Expected string.'],
      ['password', () => parseAccountLoginPayload({ siteId: 1, username: 'u', password: 1 }), 'Invalid password. Expected string.'],
      ['apiKey', () => parseAccountCreatePayload({ siteId: 1, apiKey: 1 }), 'Invalid apiKey. Expected string.'],
      ['checkinEnabled', () => parseAccountCreatePayload({ siteId: 1, checkinEnabled: 'yes' }), 'Invalid checkinEnabled. Expected boolean.'],
      ['credentialMode', () => parseAccountCreatePayload({ siteId: 1, credentialMode: 'password' }), 'Account creation derives its credential type from credential or apiKey.'],
      ['skipModelFetch', () => parseAccountCreatePayload({ siteId: 1, skipModelFetch: 'yes' }), 'Invalid skipModelFetch. Expected boolean.'],
      ['isPinned', () => parseAccountUpdatePayload({ isPinned: 'yes' }), 'Invalid isPinned. Expected boolean.'],
      ['sortOrder', () => parseAccountUpdatePayload({ sortOrder: -1 }), 'Invalid sortOrder. Expected non-negative integer.'],
      ['proxyUrl', () => parseAccountUpdatePayload({ proxyUrl: 1 }), 'Invalid proxyUrl. Expected string or null.'],
      ['ids', () => parseAccountBatchPayload({ ids: [0] }), 'Invalid ids. Expected number[].'],
      ['action', () => parseAccountBatchPayload({ action: 1 }), 'Invalid action. Expected string.'],
      ['platformUserId', () => parseAccountCreatePayload({ siteId: 1, platformUserId: 0 }), 'Invalid platformUserId. Expected positive number.'],
      ['accountId', () => parseAccountHealthRefreshPayload({ accountId: 0 }), '账号 ID 无效'],
      ['wait', () => parseAccountHealthRefreshPayload({ wait: 'yes' }), 'Invalid wait. Expected boolean.'],
      ['models', () => parseAccountManualModelsPayload({ models: [1] }), 'Invalid models. Expected string[].'],
    ];

    for (const [name, parse, error] of cases) {
      expect(parse(), name).toEqual({ success: false, error });
    }
  });

  it('rejects removed credential fields instead of silently ignoring them', () => {
    for (const field of ['accessToken', 'apiToken', 'cred', 'modelApiKey', 'managementApiToken', 'refreshToken', 'tokenExpiresAt']) {
      expect(parseAccountUpdatePayload({ [field]: 'legacy-value' })).toEqual({
        success: false,
        error: `Unsupported legacy account field "${field}". Use "credential" for connection credentials, "apiKey" for model keys, or "connectionValues" for adapter connection fields.`,
      });
    }
  });

  it('keeps creation and connection verification credential inputs separate', () => {
    expect(parseAccountCreatePayload({
      siteId: 1,
      credential: 'connection-credential',
      apiKey: 'model-key',
    })).toEqual({
      success: false,
      error: '请只填写连接凭据或模型调用 Key 其中一种。',
    });

    expect(parseAccountVerifyTokenPayload({
      siteId: 1,
      apiKey: 'model-key',
    })).toEqual({
      success: false,
      error: 'Connection credential verification only accepts credential and credentialKind.',
    });
    expect(parseAccountVerifyTokenPayload({
      siteId: 1,
      credentialMode: 'session',
    })).toEqual({
      success: false,
      error: 'Connection credential verification only accepts credential and credentialKind.',
    });
  });
});
