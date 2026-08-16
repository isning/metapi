import { eq } from 'drizzle-orm';
import { schema } from '../db/index.js';
import { insertAndGetById } from '../db/insertHelpers.js';
import {
  ACCOUNT_TOKEN_VALUE_STATUS_READY,
  isMaskedTokenValue,
  isUsableAccountToken,
  type AccountTokenDb,
  type AccountTokenRow,
} from './accountTokenService.js';

type AccountRow = typeof schema.accounts.$inferSelect;
type JsonRecord = Record<string, unknown>;

export type ImportedAccountCredential = {
  accountId: number;
  credentialMode: 'session' | 'apikey' | 'oauth';
  legacyModelToken: string | null;
};

export type MigratedBackupAccountCredential = {
  account: AccountRow;
  importedCredential: ImportedAccountCredential;
};

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isLegacyModelDiscoveryRuntimeHealth(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return readTrimmedString(value.source).toLowerCase() === 'model-discovery';
}

function parseLegacyAccountExtraConfig(value: unknown): JsonRecord {
  if (isRecord(value)) return { ...value };
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? { ...parsed } : {};
  } catch {
    return {};
  }
}

/** Upgrade historical account credential storage at the backup-import boundary. */
export function migrateImportedAccountCredential(row: unknown): MigratedBackupAccountCredential {
  if (!isRecord(row)) throw new Error('导入数据格式错误：账号记录必须为对象');
  const source = { ...row };
  const accountId = Number(source.id);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    throw new Error('导入数据格式错误：账号 ID 无效');
  }

  const storedMode = readTrimmedString(source.credentialMode ?? source.credential_mode).toLowerCase();
  const extraConfig = parseLegacyAccountExtraConfig(source.extraConfig ?? source.extra_config);
  const legacyOauth = isRecord(extraConfig.oauth) ? { ...extraConfig.oauth } : null;
  const legacyExtraMode = readTrimmedString(extraConfig.credentialMode).toLowerCase();
  const legacyAuthType = readTrimmedString(extraConfig.authType).toLowerCase();
  const legacyApiKeyMode = legacyExtraMode === 'apikey'
    || (legacyExtraMode === '' && legacyAuthType === 'api_key');
  const oauthProvider = readTrimmedString(
    source.oauthProvider ?? source.oauth_provider ?? legacyOauth?.provider,
  );
  const oauthAccountKey = readTrimmedString(
    source.oauthAccountKey
      ?? source.oauth_account_key
      ?? legacyOauth?.accountKey
      ?? legacyOauth?.accountId,
  );
  const oauthProjectId = readTrimmedString(
    source.oauthProjectId ?? source.oauth_project_id ?? legacyOauth?.projectId,
  );
  const legacyAccessToken = readTrimmedString(source.accessToken ?? source.access_token);
  const existingCredential = readTrimmedString(source.credential);
  const legacyAccountApiToken = readTrimmedString(source.apiToken ?? source.api_token);

  const credentialMode: ImportedAccountCredential['credentialMode'] = oauthProvider
    ? 'oauth'
    : storedMode === 'oauth' || storedMode === 'session' || storedMode === 'apikey'
      ? storedMode
      : legacyApiKeyMode
        ? 'apikey'
        : 'session';
  const credential = credentialMode === 'apikey' ? '' : (existingCredential || legacyAccessToken);
  const storedKind = readTrimmedString(source.credentialKind ?? source.credential_kind);
  const credentialKind = credentialMode === 'oauth'
    ? 'oauth_access_token'
    : credentialMode === 'apikey'
      ? 'none'
      : ['session_cookie', 'access_token'].includes(storedKind)
        ? storedKind
        : 'access_token';
  const legacyModelToken = credentialMode === 'apikey'
    ? (legacyAccountApiToken || legacyAccessToken || existingCredential || null)
    : (legacyAccountApiToken || null);

  delete extraConfig.credentialMode;
  delete extraConfig.authType;
  if (isLegacyModelDiscoveryRuntimeHealth(extraConfig.runtimeHealth)) {
    delete extraConfig.runtimeHealth;
  }
  if (legacyOauth) {
    delete legacyOauth.provider;
    delete legacyOauth.accountId;
    delete legacyOauth.accountKey;
    delete legacyOauth.projectId;
    if (Object.keys(legacyOauth).length > 0) extraConfig.oauth = legacyOauth;
    else delete extraConfig.oauth;
  }
  delete source.accessToken;
  delete source.access_token;
  delete source.apiToken;
  delete source.api_token;
  delete source.managementApiToken;
  delete source.modelApiKey;
  delete source.credential_mode;
  delete source.credential_kind;
  delete source.extra_config;
  delete source.oauth_provider;
  delete source.oauth_account_key;
  delete source.oauth_project_id;

  return {
    account: {
      ...source,
      extraConfig: Object.keys(extraConfig).length > 0 ? JSON.stringify(extraConfig) : null,
      credentialMode,
      credential,
      credentialKind,
      oauthProvider: oauthProvider || null,
      oauthAccountKey: oauthAccountKey || null,
      oauthProjectId: oauthProjectId || null,
      checkinEnabled: credentialMode === 'apikey' ? false : source.checkinEnabled,
    } as AccountRow,
    importedCredential: { accountId, credentialMode, legacyModelToken },
  };
}

/** Materialize credential migration metadata after imported account_tokens rows exist. */
export async function reconcileImportedAccountCredentialTokens(
  tx: AccountTokenDb,
  credentials: Iterable<ImportedAccountCredential>,
): Promise<void> {
  for (const credential of credentials) {
    const tokens = await tx.select()
      .from(schema.accountTokens)
      .where(eq(schema.accountTokens.accountId, credential.accountId))
      .all() as AccountTokenRow[];
    const legacyToken = credential.legacyModelToken && !isMaskedTokenValue(credential.legacyModelToken)
      ? credential.legacyModelToken
      : null;
    let preferred = legacyToken
      ? tokens.find((token) => token.token === legacyToken) ?? null
      : null;

    if (legacyToken && !preferred) {
      const inserted = await insertAndGetById<AccountTokenRow>({
        txDb: tx,
        table: schema.accountTokens,
        idColumn: schema.accountTokens.id,
        values: {
          accountId: credential.accountId,
          name: 'default',
          token: legacyToken,
          tokenGroup: 'default',
          valueStatus: ACCOUNT_TOKEN_VALUE_STATUS_READY,
          source: 'legacy_backup_account_credential',
          enabled: true,
          isDefault: true,
        },
        insertErrorMessage: 'failed to migrate imported account credential token',
        loadErrorMessage: 'failed to load migrated account credential token',
      });
      preferred = inserted;
      if (preferred) tokens.push(preferred);
    }

    if (credential.credentialMode === 'apikey') {
      preferred ??= tokens.find((token) => token.isDefault && isUsableAccountToken(token))
        ?? tokens.find(isUsableAccountToken)
        ?? null;
      await tx.update(schema.accountTokens)
        .set({ enabled: false, isDefault: false })
        .where(eq(schema.accountTokens.accountId, credential.accountId))
        .run();
      if (preferred) {
        await tx.update(schema.accountTokens)
          .set({
            enabled: true,
            isDefault: true,
            valueStatus: ACCOUNT_TOKEN_VALUE_STATUS_READY,
          })
          .where(eq(schema.accountTokens.id, preferred.id))
          .run();
      }
      continue;
    }

    if (preferred) {
      await tx.update(schema.accountTokens)
        .set({ isDefault: false })
        .where(eq(schema.accountTokens.accountId, credential.accountId))
        .run();
      await tx.update(schema.accountTokens)
        .set({
          enabled: true,
          isDefault: true,
          valueStatus: ACCOUNT_TOKEN_VALUE_STATUS_READY,
        })
        .where(eq(schema.accountTokens.id, preferred.id))
        .run();
    }
  }
}
