import type { InferSelectModel } from 'drizzle-orm';
import type * as schemaTypes from '../db/schema.js';
import type {
  AccountCredential,
  AccountTokenCredential,
  ModelEndpoint,
  PlatformCredentialContext,
} from './platforms/base.js';
import { resolveStoredAccountCredentialMode } from './accountExtraConfig.js';

type AccountRow = InferSelectModel<typeof schemaTypes.accounts>;
type AccountTokenRow = InferSelectModel<typeof schemaTypes.accountTokens>;

export function serializeOpaqueExtraConfig(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** Pure persistence-to-adapter mapping. Platform-specific data stays opaque. */
export function buildAccountCredential(
  account: Pick<AccountRow, 'id' | 'siteId' | 'username' | 'credentialMode' | 'credential' | 'credentialKind' | 'extraConfig' | 'oauthProvider'>,
): AccountCredential {
  return {
    id: account.id ?? null,
    siteId: account.siteId ?? null,
    username: account.username ?? null,
    mode: resolveStoredAccountCredentialMode(account),
    credential: account.credential || '',
    credentialKind: account.credentialKind || '',
    extraConfig: account.extraConfig ?? null,
  };
}

/** Pure persistence-to-adapter mapping. No adapter semantics are inferred. */
export function buildAccountTokenCredential(
  token: Pick<AccountTokenRow, 'id' | 'accountId' | 'token' | 'enabled' | 'extraConfig'>,
): AccountTokenCredential {
  return {
    id: token.id ?? null,
    accountId: token.accountId ?? null,
    token: token.token || '',
    enabled: token.enabled !== false,
    extraConfig: token.extraConfig ?? null,
  };
}

export function buildPlatformCredentialContext(input: {
  endpoint: ModelEndpoint;
  account: Pick<AccountRow, 'id' | 'siteId' | 'username' | 'credentialMode' | 'credential' | 'credentialKind' | 'extraConfig' | 'oauthProvider'>;
  token?: Pick<AccountTokenRow, 'id' | 'accountId' | 'token' | 'enabled' | 'extraConfig'> | null;
}): PlatformCredentialContext {
  return {
    endpoint: input.endpoint,
    account: buildAccountCredential(input.account),
    token: input.token ? buildAccountTokenCredential(input.token) : null,
  };
}

export function buildTransientPlatformCredentialContext(input: {
  endpoint: ModelEndpoint;
  accountId?: number | null;
  siteId: number | null;
  username?: string | null;
  mode: AccountCredential['mode'];
  credential: string;
  credentialKind: string;
  accountExtraConfig?: string | null;
  token?: string | null;
  tokenId?: number | null;
  tokenAccountId?: number | null;
  tokenExtraConfig?: string | null;
}): PlatformCredentialContext {
  return {
    endpoint: input.endpoint,
    account: {
      id: input.accountId ?? null,
      siteId: input.siteId,
      username: input.username ?? null,
      mode: input.mode,
      credential: input.credential,
      credentialKind: input.credentialKind,
      extraConfig: input.accountExtraConfig ?? null,
    },
    token: input.token
      ? {
          id: input.tokenId ?? null,
          accountId: input.tokenAccountId ?? input.accountId ?? null,
          token: input.token,
          enabled: true,
          extraConfig: input.tokenExtraConfig ?? null,
        }
      : null,
  };
}
