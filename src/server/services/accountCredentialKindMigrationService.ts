import { eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import { mergeAccountExtraConfig } from './accountExtraConfig.js';
import { emitInboxItem } from './inboxService.js';

const LEGACY_CREDENTIAL_KIND = 'adapter_default';
const ACCESS_TOKEN_CREDENTIAL_KIND = 'access_token';

export type AccountCredentialKindMigrationSummary = {
  migrated: number;
};

function isLegacyModelDiscoveryRuntimeHealth(extraConfig: unknown): boolean {
  if (typeof extraConfig !== 'string' || !extraConfig.trim()) return false;
  try {
    const parsed = JSON.parse(extraConfig) as { runtimeHealth?: { source?: unknown } };
    return typeof parsed.runtimeHealth?.source === 'string'
      && parsed.runtimeHealth.source.trim().toLowerCase() === 'model-discovery';
  } catch {
    return false;
  }
}

export async function removeLegacyModelDiscoveryRuntimeHealth(): Promise<number> {
  const accounts = await db.select({ id: schema.accounts.id, extraConfig: schema.accounts.extraConfig })
    .from(schema.accounts)
    .all();
  const legacyAccounts = accounts.filter((account) => isLegacyModelDiscoveryRuntimeHealth(account.extraConfig));

  for (const account of legacyAccounts) {
    await db.update(schema.accounts)
      .set({
        extraConfig: mergeAccountExtraConfig(account.extraConfig, { runtimeHealth: undefined }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.accounts.id, account.id))
      .run();
  }

  return legacyAccounts.length;
}

/**
 * Upgrades the legacy implicit credential kind after the database schema is ready.
 * The old value did not identify its wire format, so it is deliberately treated as
 * an access token and affected Cookie connections are surfaced to the operator.
 */
export async function migrateLegacyAccountCredentialKinds(): Promise<AccountCredentialKindMigrationSummary> {
  const legacyAccounts = await db.select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(eq(schema.accounts.credentialKind, LEGACY_CREDENTIAL_KIND))
    .all();

  if (legacyAccounts.length === 0) return { migrated: 0 };

  await db.update(schema.accounts)
    .set({
      credentialKind: ACCESS_TOKEN_CREDENTIAL_KIND,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.accounts.credentialKind, LEGACY_CREDENTIAL_KIND))
    .run();

  await emitInboxItem({
    scope: 'attention',
    category: 'auth',
    severity: 'warning',
    type: 'credential-migration',
    title: '账号连接凭据需要检查',
    summary: `已将 ${legacyAccounts.length} 个历史连接凭据迁移为 Access Token。`,
    description: '旧版连接未记录凭据类型。请检查 AnyRouter / New API 的 Session 账号；实际使用 Session Cookie 的账号请在编辑页重新选择“Session Cookie”并保存。',
    actions: [
      { id: 'open-accounts', label: '检查账号', kind: 'navigate', href: '/accounts', placement: 'primary' },
      { id: 'resolve', label: '标记已解决', kind: 'invoke', command: 'resolve', placement: 'secondary' },
    ],
    dedupeKey: 'migration:legacy-account-credential-kind',
    source: 'migration',
    relatedType: 'account',
  });

  return { migrated: legacyAccounts.length };
}
