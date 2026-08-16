import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAdapterMock } = vi.hoisted(() => ({
  getAdapterMock: vi.fn(),
}));
const { decryptAccountPasswordMock } = vi.hoisted(() => ({
  decryptAccountPasswordMock: vi.fn(),
}));
const { updateAccountRuntimeIdentityMock } = vi.hoisted(() => ({
  updateAccountRuntimeIdentityMock: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
  schema: { accounts: { id: 'id' } },
}));

vi.mock('./accountRuntimeIdentityMutationService.js', () => ({
  updateAccountRuntimeIdentity: (...args: unknown[]) => updateAccountRuntimeIdentityMock(...args),
}));

vi.mock('./platforms/index.js', () => ({
  getAdapter: (...args: unknown[]) => getAdapterMock(...args),
}));

vi.mock('./accountCredentialService.js', () => ({
  decryptAccountPassword: (...args: unknown[]) => decryptAccountPasswordMock(...args),
}));

import { refreshAccountSessionFromAutoRelogin } from './accountAutoReloginService.js';

describe('accountAutoReloginService', () => {
  beforeEach(() => {
    getAdapterMock.mockReset();
    decryptAccountPasswordMock.mockReset();
    updateAccountRuntimeIdentityMock.mockReset();
    updateAccountRuntimeIdentityMock.mockResolvedValue(undefined);
  });

  it('refreshes the persisted session from the encrypted password credential', async () => {
    const login = vi.fn().mockResolvedValue({ success: true, accessToken: 'fresh-session' });
    getAdapterMock.mockReturnValue({
      login,
      credentialCapabilities: { session: true },
    });
    decryptAccountPasswordMock.mockReturnValue('plain-password');

    await expect(refreshAccountSessionFromAutoRelogin({
      id: 4,
      status: 'expired',
      credentialMode: 'session',
      extraConfig: JSON.stringify({
        autoRelogin: { username: 'alice', passwordCipher: 'cipher' },
      }),
    }, {
      platform: 'new-api',
      url: 'https://newapi.example.com',
    })).resolves.toEqual({ credential: 'fresh-session', credentialKind: 'access_token' });

    expect(login).toHaveBeenCalledWith('https://newapi.example.com', 'alice', 'plain-password');
    expect(updateAccountRuntimeIdentityMock).toHaveBeenCalledWith(4, expect.objectContaining({
      credential: 'fresh-session',
      credentialMode: 'session',
      credentialKind: 'access_token',
      status: 'active',
    }));
  });

  it('preserves a Cookie credential returned by the adapter', async () => {
    const login = vi.fn().mockResolvedValue({
      success: true,
      accessToken: 'session=cookie-value',
      credentialKind: 'session_cookie',
    });
    getAdapterMock.mockReturnValue({
      login,
      credentialCapabilities: { session: true },
    });
    decryptAccountPasswordMock.mockReturnValue('plain-password');

    await refreshAccountSessionFromAutoRelogin({
      id: 4,
      credentialMode: 'session',
      extraConfig: JSON.stringify({
        autoRelogin: { username: 'alice', passwordCipher: 'cipher' },
      }),
    }, {
      platform: 'new-api',
      url: 'https://newapi.example.com',
    });

    expect(updateAccountRuntimeIdentityMock).toHaveBeenCalledWith(4, expect.objectContaining({
      credential: 'session=cookie-value',
      credentialKind: 'session_cookie',
    }));
  });

  it('does not use a retained password when the account explicitly uses an API key', async () => {
    await expect(refreshAccountSessionFromAutoRelogin({
      id: 4,
      credentialMode: 'apikey',
      extraConfig: JSON.stringify({
        autoRelogin: { username: 'alice', passwordCipher: 'cipher' },
      }),
    }, {
      platform: 'new-api',
      url: 'https://newapi.example.com',
    })).resolves.toBeNull();

    expect(getAdapterMock).not.toHaveBeenCalled();
    expect(decryptAccountPasswordMock).not.toHaveBeenCalled();
  });

  it('does not convert a structured OAuth account when stale auto-relogin metadata exists', async () => {
    await expect(refreshAccountSessionFromAutoRelogin({
      id: 4,
      // Some pre-migration rows still carry the legacy Session mode. The
      // structured OAuth provider remains authoritative for their lifecycle.
      credentialMode: 'session',
      oauthProvider: 'codex',
      extraConfig: JSON.stringify({
        autoRelogin: { username: 'alice', passwordCipher: 'cipher' },
      }),
    }, {
      platform: 'codex',
      url: 'https://chatgpt.com/backend-api/codex',
    })).resolves.toBeNull();

    expect(getAdapterMock).not.toHaveBeenCalled();
    expect(decryptAccountPasswordMock).not.toHaveBeenCalled();
    expect(updateAccountRuntimeIdentityMock).not.toHaveBeenCalled();
  });

  it('does not convert a legacy OAuth account identified only in extraConfig', async () => {
    await expect(refreshAccountSessionFromAutoRelogin({
      id: 4,
      credentialMode: 'session',
      extraConfig: JSON.stringify({
        oauth: { provider: 'codex' },
        autoRelogin: { username: 'alice', passwordCipher: 'cipher' },
      }),
    }, {
      platform: 'codex',
      url: 'https://chatgpt.com/backend-api/codex',
    })).resolves.toBeNull();

    expect(getAdapterMock).not.toHaveBeenCalled();
    expect(decryptAccountPasswordMock).not.toHaveBeenCalled();
    expect(updateAccountRuntimeIdentityMock).not.toHaveBeenCalled();
  });

  it('does not auto-relogin through an adapter without Session support', async () => {
    getAdapterMock.mockReturnValue({
      login: vi.fn(),
      credentialCapabilities: { session: false },
    });

    await expect(refreshAccountSessionFromAutoRelogin({
      id: 4,
      credentialMode: 'session',
      extraConfig: JSON.stringify({
        autoRelogin: { username: 'alice', passwordCipher: 'cipher' },
      }),
    }, {
      platform: 'openai',
      url: 'https://api.openai.com',
    })).resolves.toBeNull();

    expect(decryptAccountPasswordMock).not.toHaveBeenCalled();
    expect(updateAccountRuntimeIdentityMock).not.toHaveBeenCalled();
  });
});
