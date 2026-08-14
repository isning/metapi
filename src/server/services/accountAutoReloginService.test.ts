import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAdapterMock } = vi.hoisted(() => ({
  getAdapterMock: vi.fn(),
}));
const { decryptAccountPasswordMock } = vi.hoisted(() => ({
  decryptAccountPasswordMock: vi.fn(),
}));
const { updateSetMock } = vi.hoisted(() => ({
  updateSetMock: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateSetMock(values);
        return { where: () => ({ run: () => ({}) }) };
      },
    }),
  },
  schema: { accounts: { id: 'id' } },
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
    updateSetMock.mockReset();
  });

  it('refreshes the persisted session from the encrypted password credential', async () => {
    const login = vi.fn().mockResolvedValue({ success: true, accessToken: 'fresh-session' });
    getAdapterMock.mockReturnValue({ login });
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
    })).resolves.toBe('fresh-session');

    expect(login).toHaveBeenCalledWith('https://newapi.example.com', 'alice', 'plain-password');
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      credential: 'fresh-session',
      credentialMode: 'session',
      status: 'active',
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
});
