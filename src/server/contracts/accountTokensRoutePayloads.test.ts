import { describe, expect, it } from 'vitest';
import {
  parseAccountTokenBatchPayload,
  parseAccountTokenCreatePayload,
  parseAccountTokenSyncAllPayload,
  parseAccountTokenUpdatePayload,
} from './accountTokensRoutePayloads.js';

describe('account token route payload contracts', () => {
  it('accepts create, update, batch, and sync-all payloads through public parsers', () => {
    expect(parseAccountTokenCreatePayload({
      accountId: 1,
      name: 'primary',
      token: 'sk-a',
      enabled: true,
      isDefault: false,
      source: 'manual',
      group: 'default',
      unlimitedQuota: true,
      remainQuota: '100',
      expiredTime: 0,
      allowIps: '',
      modelLimitsEnabled: false,
      modelLimits: 'gpt-*',
      extra: 'kept',
    })).toEqual({
      success: true,
      data: {
        accountId: 1,
        name: 'primary',
        token: 'sk-a',
        enabled: true,
        isDefault: false,
        source: 'manual',
        group: 'default',
        unlimitedQuota: true,
        remainQuota: '100',
        expiredTime: 0,
        allowIps: '',
        modelLimitsEnabled: false,
        modelLimits: 'gpt-*',
        extra: 'kept',
      },
    });

    expect(parseAccountTokenUpdatePayload({ name: 'renamed', enabled: false })).toEqual({
      success: true,
      data: { name: 'renamed', enabled: false },
    });
    expect(parseAccountTokenBatchPayload({ ids: [1, 2], action: 'delete' })).toEqual({
      success: true,
      data: { ids: [1, 2], action: 'delete' },
    });
    expect(parseAccountTokenSyncAllPayload(undefined)).toEqual({
      success: true,
      data: {},
    });
  });

  it('returns field-specific validation messages', () => {
    const cases: Array<[string, () => unknown, string]> = [
      ['accountId', () => parseAccountTokenCreatePayload({ accountId: 0 }), 'Invalid accountId. Expected positive number.'],
      ['token', () => parseAccountTokenCreatePayload({ accountId: 1, token: 1 }), 'Invalid token. Expected string.'],
      ['name', () => parseAccountTokenCreatePayload({ accountId: 1, name: 1 }), 'Invalid name. Expected string.'],
      ['enabled', () => parseAccountTokenUpdatePayload({ enabled: 'yes' }), 'Invalid enabled. Expected boolean.'],
      ['isDefault', () => parseAccountTokenCreatePayload({ accountId: 1, isDefault: 'yes' }), 'Invalid isDefault. Expected boolean.'],
      ['source', () => parseAccountTokenUpdatePayload({ source: 1 }), 'Invalid source. Expected string.'],
      ['group', () => parseAccountTokenUpdatePayload({ group: 1 }), 'Invalid group. Expected string.'],
      ['unlimitedQuota', () => parseAccountTokenCreatePayload({ accountId: 1, unlimitedQuota: 'yes' }), 'Invalid unlimitedQuota. Expected boolean.'],
      ['modelLimitsEnabled', () => parseAccountTokenCreatePayload({ accountId: 1, modelLimitsEnabled: 'yes' }), 'Invalid modelLimitsEnabled. Expected boolean.'],
      ['ids', () => parseAccountTokenBatchPayload({ ids: [0] }), 'Invalid ids. Expected number[].'],
      ['action', () => parseAccountTokenBatchPayload({ action: 1 }), 'Invalid action. Expected string.'],
      ['wait', () => parseAccountTokenSyncAllPayload({ wait: 'yes' }), 'Invalid wait. Expected boolean.'],
    ];

    for (const [name, parse, error] of cases) {
      expect(parse(), name).toEqual({ success: false, error });
    }
  });
});
