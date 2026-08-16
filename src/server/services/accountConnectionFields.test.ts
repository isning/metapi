import { describe, expect, it } from 'vitest';
import {
  applyAccountConnectionValues,
  buildAccountConnectionValues,
  getExtraConfigPathValue,
  mergeExtraConfigPath,
} from './accountExtraConfig.js';

const fields = [
  { key: 'platformUserId', labelI18nKey: 'id', inputType: 'number' as const, storagePath: 'platformUserId' },
  { key: 'sub2apiAuth.refreshToken', labelI18nKey: 'refresh', inputType: 'password' as const, storagePath: 'sub2apiAuth.refreshToken', secret: true },
  { key: 'sub2apiAuth.tokenExpiresAt', labelI18nKey: 'expiry', inputType: 'number' as const, storagePath: 'sub2apiAuth.tokenExpiresAt' },
];

describe('account connection field protocol', () => {
  it('reads and writes nested storage paths without dropping sibling config', () => {
    const updated = mergeExtraConfigPath(
      JSON.stringify({ proxyUrl: 'http://proxy', sub2apiAuth: { tokenExpiresAt: 123 } }),
      'sub2apiAuth.refreshToken',
      'refresh-1',
    );
    expect(getExtraConfigPathValue(updated, 'proxyUrl')).toBe('http://proxy');
    expect(getExtraConfigPathValue(updated, 'sub2apiAuth.tokenExpiresAt')).toBe(123);
    expect(getExtraConfigPathValue(updated, 'sub2apiAuth.refreshToken')).toBe('refresh-1');
  });

  it('returns declared secret values for account editing', () => {
    expect(buildAccountConnectionValues(fields, {
      platformUserId: 42,
      sub2apiAuth: { refreshToken: 'secret' },
    })).toEqual({
      platformUserId: 42,
      'sub2apiAuth.refreshToken': 'secret',
    });
  });

  it('applies declared values while preserving an empty secret input', () => {
    const updated = applyAccountConnectionValues(
      { sub2apiAuth: { refreshToken: 'stored-secret', tokenExpiresAt: 1 } },
      fields,
      {
        platformUserId: '42',
        'sub2apiAuth.refreshToken': '',
        'sub2apiAuth.tokenExpiresAt': '2',
      },
    );
    expect(JSON.parse(updated)).toEqual({
      platformUserId: 42,
      sub2apiAuth: { refreshToken: 'stored-secret', tokenExpiresAt: 2 },
    });
  });
});
