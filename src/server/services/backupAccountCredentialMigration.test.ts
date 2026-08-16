import { describe, expect, it } from 'vitest';
import { migrateImportedAccountCredential } from './backupAccountCredentialMigration.js';

describe('backup account credential migration', () => {
  it('moves legacy API Key account values into migration metadata and removes legacy config keys', () => {
    const migrated = migrateImportedAccountCredential({
      id: 7,
      siteId: 2,
      accessToken: 'legacy-model-key',
      apiToken: 'legacy-discovered-key',
      extraConfig: JSON.stringify({ credentialMode: 'apikey', authType: 'api_key', keep: true }),
    });

    expect(migrated.account).toMatchObject({
      id: 7,
      credentialMode: 'apikey',
      credential: '',
      credentialKind: 'none',
      checkinEnabled: false,
    });
    expect(migrated.account).not.toHaveProperty('accessToken');
    expect(migrated.account).not.toHaveProperty('apiToken');
    expect(JSON.parse(migrated.account.extraConfig || '{}')).toEqual({ keep: true });
    expect(migrated.importedCredential.legacyModelToken).toBe('legacy-discovered-key');
  });

  it('moves a legacy session credential without inferring its kind from its value', () => {
    const migrated = migrateImportedAccountCredential({
      id: 8,
      siteId: 2,
      access_token: 'opaque-value',
      extra_config: JSON.stringify({ credentialMode: 'session' }),
    });

    expect(migrated.account).toMatchObject({
      credentialMode: 'session',
      credential: 'opaque-value',
      credentialKind: 'access_token',
    });
    expect(migrated.account.extraConfig).toBeNull();
    expect(migrated.importedCredential.legacyModelToken).toBeNull();
  });

  it('keeps unmarked historical accounts in the legacy default session mode', () => {
    const migrated = migrateImportedAccountCredential({
      id: 11,
      siteId: 2,
      username: 'session-account-with-separate-model-keys',
      extraConfig: JSON.stringify({ keep: true }),
    });

    expect(migrated.account).toMatchObject({
      credentialMode: 'session',
      credential: '',
      credentialKind: 'access_token',
    });
    expect(JSON.parse(migrated.account.extraConfig || '{}')).toEqual({ keep: true });
    expect(migrated.importedCredential).toEqual({
      accountId: 11,
      credentialMode: 'session',
      legacyModelToken: null,
    });
  });

  it('moves legacy OAuth identity into structured columns and preserves runtime state', () => {
    const migrated = migrateImportedAccountCredential({
      id: 9,
      siteId: 2,
      accessToken: 'oauth-access-token',
      extraConfig: JSON.stringify({
        keep: true,
        oauth: {
          provider: 'codex',
          accountId: 'legacy-account-id',
          accountKey: 'legacy-account-key',
          projectId: 'legacy-project',
          refreshToken: 'refresh-token',
        },
      }),
    });

    expect(migrated.account).toMatchObject({
      credentialMode: 'oauth',
      credential: 'oauth-access-token',
      credentialKind: 'oauth_access_token',
      oauthProvider: 'codex',
      oauthAccountKey: 'legacy-account-key',
      oauthProjectId: 'legacy-project',
    });
    expect(JSON.parse(migrated.account.extraConfig || '{}')).toEqual({
      keep: true,
      oauth: { refreshToken: 'refresh-token' },
    });
  });

  it('removes retired model-discovery account health from imported accounts', () => {
    const migrated = migrateImportedAccountCredential({
      id: 10,
      siteId: 2,
      extraConfig: JSON.stringify({
        runtimeHealth: { state: 'healthy', source: 'model-discovery', reason: '模型探测成功' },
        keep: true,
      }),
    });

    expect(JSON.parse(migrated.account.extraConfig || '{}')).toEqual({ keep: true });
  });

  it('normalizes legacy Sub2API refresh credentials and expiration into sub2apiAuth', () => {
    const migrated = migrateImportedAccountCredential({
      id: 12,
      siteId: 2,
      credentialMode: 'session',
      credential: 'access-token',
      refresh_token: 'legacy-refresh-token',
      token_expires_at: 1760000000000,
      extraConfig: JSON.stringify({ keep: true }),
    });

    expect(JSON.parse(migrated.account.extraConfig || '{}')).toEqual({
      keep: true,
      sub2apiAuth: {
        refreshToken: 'legacy-refresh-token',
        tokenExpiresAt: 1760000000000,
      },
    });
    expect(migrated.account).not.toHaveProperty('refresh_token');
    expect(migrated.account).not.toHaveProperty('token_expires_at');
  });
});
