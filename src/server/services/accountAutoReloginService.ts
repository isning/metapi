import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  getAutoReloginConfig,
  resolveProxyUrlFromExtraConfig,
} from './accountExtraConfig.js';
import { decryptAccountPassword } from './accountCredentialService.js';
import { getAdapter } from './platforms/index.js';
import { withAccountProxyOverride } from './siteProxy.js';

type AccountAutoReloginSubject = {
  id: number;
  status?: string | null;
  credentialMode?: string | null;
  extraConfig?: string | Record<string, unknown> | null;
};

type AccountAutoReloginSite = {
  url: string;
  platform: string;
};

/** Refreshes a stored session from the encrypted password recovery credential. */
export async function refreshAccountSessionFromAutoRelogin(
  account: AccountAutoReloginSubject,
  site: AccountAutoReloginSite,
): Promise<string | null> {
  if (account.credentialMode === 'apikey') return null;

  const adapter = getAdapter(site.platform);
  if (!adapter) return null;

  const relogin = getAutoReloginConfig(account.extraConfig);
  if (!relogin) return null;

  const password = decryptAccountPassword(relogin.passwordCipher);
  if (!password) return null;

  const loginResult = await withAccountProxyOverride(
    resolveProxyUrlFromExtraConfig(account.extraConfig),
    () => adapter.login(site.url, relogin.username, password),
  );
  if (!loginResult.success || !loginResult.accessToken) return null;

  await db.update(schema.accounts)
    .set({
      credential: loginResult.accessToken,
      credentialMode: 'session',
      credentialKind: 'adapter_default',
      status: account.status === 'expired' ? 'active' : account.status,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.accounts.id, account.id))
    .run();

  return loginResult.accessToken;
}
