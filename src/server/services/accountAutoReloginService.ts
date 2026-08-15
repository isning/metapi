import { schema } from '../db/index.js';
import {
  getAutoReloginConfig,
  resolveProxyUrlFromExtraConfig,
  resolveStoredAccountCredentialMode,
} from './accountExtraConfig.js';
import { decryptAccountPassword } from './accountCredentialService.js';
import { getAdapter } from './platforms/index.js';
import { withAccountProxyOverride } from './siteProxy.js';
import { updateAccountRuntimeIdentity } from './accountRuntimeIdentityMutationService.js';

type AccountAutoReloginSubject = {
  id: number;
  status?: string | null;
  credentialMode?: string | null;
  oauthProvider?: string | null;
  extraConfig?: string | Record<string, unknown> | null;
};

type AccountAutoReloginSite = {
  url: string;
  platform: string;
};

export type RefreshedAccountSession = {
  credential: string;
  credentialKind: 'access_token' | 'session_cookie';
};

/** Refreshes a stored session from the encrypted password recovery credential. */
export async function refreshAccountSessionFromAutoRelogin(
  account: AccountAutoReloginSubject,
  site: AccountAutoReloginSite,
): Promise<RefreshedAccountSession | null> {
  if (resolveStoredAccountCredentialMode(account) !== 'session') return null;

  const adapter = getAdapter(site.platform);
  if (!adapter || !adapter.credentialCapabilities?.session) return null;

  const relogin = getAutoReloginConfig(account.extraConfig);
  if (!relogin) return null;

  const password = decryptAccountPassword(relogin.passwordCipher);
  if (!password) return null;

  const loginResult = await withAccountProxyOverride(
    resolveProxyUrlFromExtraConfig(account.extraConfig),
    () => adapter.login(site.url, relogin.username, password),
  );
  if (!loginResult.success || !loginResult.accessToken) return null;

  await updateAccountRuntimeIdentity(account.id, {
    credential: loginResult.accessToken,
    credentialMode: 'session',
    credentialKind: loginResult.credentialKind || 'access_token',
    status: account.status === 'expired' ? 'active' : account.status,
  });

  return {
    credential: loginResult.accessToken,
    credentialKind: loginResult.credentialKind || 'access_token',
  };
}
