import {
  hasOauthProvider,
  resolveStoredAccountCredentialMode,
} from './accountExtraConfig.js';

export type AccountCapabilities = {
  canCheckin: boolean;
  canRefreshBalance: boolean;
  canSyncAccountTokens: boolean;
  canCreateAccountTokens: boolean;
  canRebindSession: boolean;
  proxyOnly: boolean;
};

type AccountCapabilityInput = {
  credential?: string | null;
  credentialMode?: string | null;
  extraConfig?: string | Record<string, unknown> | null;
  oauthProvider?: unknown;
};

function hasCredential(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function buildAccountCapabilities(
  account: AccountCapabilityInput,
): AccountCapabilities {
  const oauthConnection = hasOauthProvider(account);
  const credentialMode = resolveStoredAccountCredentialMode(account);
  const sessionCapable = !oauthConnection
    && credentialMode === 'session'
    && hasCredential(account.credential);

  return {
    canCheckin: sessionCapable,
    canRefreshBalance: sessionCapable,
    canSyncAccountTokens: sessionCapable,
    // OAuth accounts route directly with their OAuth credential. Managed model
    // keys belong only to API-key/session accounts and are not consumed by
    // OAuth discovery or route construction.
    canCreateAccountTokens: !oauthConnection,
    canRebindSession: !oauthConnection && credentialMode === 'session',
    proxyOnly: !sessionCapable,
  };
}
