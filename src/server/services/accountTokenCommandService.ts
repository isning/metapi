import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  getAccountTokenById,
  getAccountTokenWithOwner,
  isMaskedPendingAccountToken,
  repairDefaultToken,
} from './accountTokenService.js';
import {
  getAccountManagementCredential,
  getProxyUrlFromExtraConfig,
  hasOauthProvider,
} from './accountExtraConfig.js';
import { getAdapter } from './platforms/index.js';
import { withAccountProxyOverride } from './siteProxy.js';
import { buildPlatformCredentialContext } from './adapterCredentialContextService.js';
import { retireAccountTokenFromRouting } from './accountRetirementService.js';
import { rebuildRoutesOnly } from './routeRefreshWorkflow.js';

export type AccountTokenCommandResult = { success: boolean; message?: string };
export type AccountTokenBatchAction = 'enable' | 'disable' | 'delete';
export type AccountTokenBatchResult = {
  successIds: number[];
  failedItems: Array<{ id: number; message: string }>;
};

function isSiteDisabled(status?: string | null): boolean {
  return (status || 'active') === 'disabled';
}

export async function deleteAccountTokenById(tokenId: number): Promise<AccountTokenCommandResult> {
  const row = await getAccountTokenWithOwner(tokenId);
  if (!row) return { success: false, message: '令牌不存在' };
  const existing = row.token;
  const account = row.account;
  const site = row.site;
  const adapter = getAdapter(site.platform);
  const managementCredential = getAccountManagementCredential(account) || '';
  const shouldDeleteUpstream = !isMaskedPendingAccountToken(existing)
    && !isSiteDisabled(site.status)
    && !hasOauthProvider(account)
    && !!managementCredential
    && !!adapter;

  if (shouldDeleteUpstream) {
    const upstreamDeleted = await withAccountProxyOverride(
      getProxyUrlFromExtraConfig(account.extraConfig),
      () => adapter!.deleteApiToken(buildPlatformCredentialContext({
        endpoint: { baseUrl: site.url },
        account,
        token: existing,
      })),
    );
    if (!upstreamDeleted) {
      return { success: false, message: '站点删除令牌失败，本地未删除' };
    }
  }

  await retireAccountTokenFromRouting(tokenId, 'account-token-retirement');
  if (existing.isDefault) await repairDefaultToken(existing.accountId);
  return { success: true };
}

export async function runAccountTokenBatchCommand(
  ids: number[],
  action: AccountTokenBatchAction,
): Promise<AccountTokenBatchResult> {
  const successIds: number[] = [];
  const failedItems: Array<{ id: number; message: string }> = [];
  let routeCatalogChanged = false;

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
      if (action !== 'delete' && hasOauthProvider(owner)) {
        failedItems.push({ id, message: 'OAuth 账号不支持模型调用 Key 操作' });
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
        routeCatalogChanged = true;
      }
      successIds.push(id);
    } catch (error: any) {
      failedItems.push({ id, message: error?.message || 'Batch operation failed' });
    }
  }

  if (routeCatalogChanged) {
    try {
      await rebuildRoutesOnly();
    } catch (error: any) {
      const message = error?.message || 'Route rebuild failed';
      for (const id of successIds.splice(0)) {
        failedItems.push({ id, message });
      }
    }
  }

  return { successIds, failedItems };
}
