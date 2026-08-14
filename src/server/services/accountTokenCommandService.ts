import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  getAccountTokenById,
  getAccountTokenWithOwner,
  isMaskedPendingAccountToken,
  repairDefaultToken,
} from './accountTokenService.js';
import { getAccountManagementCredential, getProxyUrlFromExtraConfig, isApiKeyAccount, resolvePlatformUserId } from './accountExtraConfig.js';
import { getAdapter } from './platforms/index.js';
import { withAccountProxyOverride } from './siteProxy.js';

export type AccountTokenCommandResult = { success: boolean; message?: string };
export type AccountTokenBatchAction = 'enable' | 'disable' | 'delete';
export type AccountTokenBatchResult = {
  successIds: number[];
  failedItems: Array<{ id: number; message: string }>;
};

function isApiKeyConnection(account: typeof schema.accounts.$inferSelect): boolean {
  return isApiKeyAccount(account);
}

function isSiteDisabled(status?: string | null): boolean {
  return (status || 'active') === 'disabled';
}

export async function deleteAccountTokenById(tokenId: number): Promise<AccountTokenCommandResult> {
  const row = await getAccountTokenWithOwner(tokenId);
  if (!row) return { success: false, message: '令牌不存在' };
  if (isApiKeyConnection(row.account)) {
    return { success: false, message: 'API Key 连接不支持管理账号令牌' };
  }

  const existing = row.token;
  const account = row.account;
  const site = row.site;
  const adapter = getAdapter(site.platform);
  const managementCredential = getAccountManagementCredential(account) || '';
  const shouldDeleteUpstream = !isMaskedPendingAccountToken(existing)
    && !isSiteDisabled(site.status)
    && !!managementCredential
    && !!adapter;

  if (shouldDeleteUpstream) {
    const platformUserId = resolvePlatformUserId(account.extraConfig, account.username);
    const upstreamDeleted = await withAccountProxyOverride(
      getProxyUrlFromExtraConfig(account.extraConfig),
      () => adapter!.deleteApiToken(site.url, managementCredential, existing.token, platformUserId),
    );
    if (!upstreamDeleted) {
      return { success: false, message: '站点删除令牌失败，本地未删除' };
    }
  }

  await db.delete(schema.accountTokens).where(eq(schema.accountTokens.id, tokenId)).run();
  if (existing.isDefault) await repairDefaultToken(existing.accountId);
  return { success: true };
}

export async function runAccountTokenBatchCommand(
  ids: number[],
  action: AccountTokenBatchAction,
): Promise<AccountTokenBatchResult> {
  const successIds: number[] = [];
  const failedItems: Array<{ id: number; message: string }> = [];

  for (const id of ids) {
    try {
      const existing = await getAccountTokenById(id);
      if (!existing) {
        failedItems.push({ id, message: 'Token not found' });
        continue;
      }

      const owner = await db.select().from(schema.accounts).where(eq(schema.accounts.id, existing.accountId)).get();
      if (!owner) {
        failedItems.push({ id, message: 'Account not found' });
        continue;
      }
      if (isApiKeyConnection(owner)) {
        failedItems.push({ id, message: 'API Key 连接不支持管理账号令牌' });
        continue;
      }

      if (action === 'delete') {
        const result = await deleteAccountTokenById(id);
        if (!result.success) {
          failedItems.push({ id, message: result.message || 'Batch operation failed' });
          continue;
        }
      } else {
        if (isMaskedPendingAccountToken(existing)) {
          failedItems.push({ id, message: '待补全令牌不能修改启用状态，请先补全明文 token' });
          continue;
        }
        await db.update(schema.accountTokens)
          .set({ enabled: action === 'enable', updatedAt: new Date().toISOString() })
          .where(eq(schema.accountTokens.id, id))
          .run();
        if (existing.isDefault && action === 'disable') await repairDefaultToken(existing.accountId);
      }
      successIds.push(id);
    } catch (error: any) {
      failedItems.push({ id, message: error?.message || 'Batch operation failed' });
    }
  }

  return { successIds, failedItems };
}
