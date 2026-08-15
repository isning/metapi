import { describe, expect, it } from 'vitest';
import {
  buildAccountCredential,
  buildAccountTokenCredential,
  buildPlatformCredentialContext,
  serializeOpaqueExtraConfig,
} from './adapterCredentialContextService.js';

describe('adapterCredentialContextService', () => {
  const account = {
    id: 24,
    siteId: 29,
    username: 'demo-42',
    credentialMode: 'session',
    credential: 'opaque-account-credential',
    credentialKind: 'session_cookie',
    extraConfig: '{"platformUserId":42,"adapterPrivate":{"raw":true}}',
    oauthProvider: null,
  } as const;

  const token = {
    id: 21,
    accountId: 24,
    token: 'opaque-model-key',
    enabled: true,
    extraConfig: '{"adapterPrivate":{"scope":"models"}}',
  } as const;

  it('copies account persistence fields without interpreting extraConfig', () => {
    expect(buildAccountCredential(account)).toEqual({
      id: 24,
      siteId: 29,
      username: 'demo-42',
      mode: 'session',
      credential: 'opaque-account-credential',
      credentialKind: 'session_cookie',
      extraConfig: account.extraConfig,
    });
  });

  it('resolves structured OAuth identity ahead of a legacy Session mode', () => {
    expect(buildAccountCredential({
      ...account,
      credentialMode: 'session',
      oauthProvider: 'codex',
      credentialKind: 'oauth_access_token',
    })).toMatchObject({
      mode: 'oauth',
      credentialKind: 'oauth_access_token',
    });
  });

  it('resolves legacy OAuth identity stored only in extraConfig', () => {
    expect(buildAccountCredential({
      ...account,
      credentialMode: 'session',
      oauthProvider: null,
      extraConfig: JSON.stringify({ oauth: { provider: 'codex' } }),
    })).toMatchObject({ mode: 'oauth' });
  });

  it('copies token persistence fields without interpreting extraConfig', () => {
    expect(buildAccountTokenCredential(token)).toEqual({
      id: 21,
      accountId: 24,
      token: 'opaque-model-key',
      enabled: true,
      extraConfig: token.extraConfig,
    });
  });

  it('builds the same context shape with or without a token', () => {
    const endpoint = { baseUrl: 'https://example.test/v1', basePathMode: 'complete_api_prefix' as const };
    expect(buildPlatformCredentialContext({ endpoint, account, token })).toEqual({
      endpoint,
      account: buildAccountCredential(account),
      token: buildAccountTokenCredential(token),
    });
    expect(buildPlatformCredentialContext({ endpoint, account })).toMatchObject({ token: null });
  });

  it('preserves string extraConfig bytes and serializes structured input once', () => {
    const raw = '{ "adapterPrivate": [1, 2], "spacing": true }';
    expect(serializeOpaqueExtraConfig(raw)).toBe(raw);
    expect(serializeOpaqueExtraConfig({ adapterPrivate: [1, 2] })).toBe('{"adapterPrivate":[1,2]}');
    expect(serializeOpaqueExtraConfig(null)).toBeNull();
  });
});
