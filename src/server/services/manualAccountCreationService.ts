import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { insertAndGetById } from '../db/insertHelpers.js';
import { startBackgroundTask } from './backgroundTaskService.js';
import { getAdapter } from './platforms/index.js';
import { buildTransientPlatformCredentialContext } from './adapterCredentialContextService.js';
import {
  applyAccountConnectionValues,
  guessPlatformUserIdFromUsername,
  mergeAccountExtraConfig,
  type AccountCredentialMode,
} from './accountExtraConfig.js';
import { runWithSiteApiEndpointPool } from './siteApiEndpointService.js';
import { type AccountCreatePayload } from '../contracts/accountsRoutePayloads.js';
import { convergeAccountMutation } from './accountMutationWorkflow.js';
import { recordAccountsCatalogMutation } from './accountRuntimeIdentityMutationService.js';

const ACCOUNT_VERIFY_TIMEOUT_MS = 10_000;

type AccountInitializationParams = {
  accountId: number;
  site: typeof schema.sites.$inferSelect;
  adapter: NonNullable<ReturnType<typeof getAdapter>>;
  tokenType: 'session' | 'apikey' | 'unknown';
  accessToken: string;
  preferredModelApiToken: string;
  accountExtraConfig: string | null;
  credentialKind?: 'session_cookie' | 'access_token';
  skipModelFetch?: boolean;
};

export type CreateManualAccountParams = {
  body: AccountCreatePayload;
  site: typeof schema.sites.$inferSelect;
  adapter: NonNullable<ReturnType<typeof getAdapter>>;
  credentialMode: AccountCredentialMode;
  rawAccessToken: string;
  usernameOverride?: string;
};

export type CreateManualAccountResult = {
  account: typeof schema.accounts.$inferSelect;
  tokenType: 'session' | 'apikey' | 'unknown';
  modelCount: number;
  discoveredModelTokenCount: number;
  usernameDetected: boolean;
  queued: boolean;
  jobId?: string;
  message?: string;
};

async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildAccountVerifyTimeoutMessage(): string {
  return `Token verification timed out (${Math.max(1, Math.round(ACCOUNT_VERIFY_TIMEOUT_MS / 1000))}s)`;
}

async function getNextAccountSortOrder(): Promise<number> {
  const rows = await db.select({ sortOrder: schema.accounts.sortOrder }).from(schema.accounts).all();
  const max = rows.reduce((currentMax, row) => Math.max(currentMax, row.sortOrder || 0), -1);
  return max + 1;
}

async function getModelsWithSiteApiEndpointPool(
  site: typeof schema.sites.$inferSelect,
  adapter: NonNullable<ReturnType<typeof getAdapter>>,
  accessToken: string,
  accountExtraConfig: string | null,
): Promise<string[]> {
  const timeoutMessage = buildAccountVerifyTimeoutMessage();
  const deadline = Date.now() + ACCOUNT_VERIFY_TIMEOUT_MS;
  return runWithSiteApiEndpointPool(site, (target) => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(timeoutMessage);
    }
    return withTimeout(
      () => adapter.getModels(buildTransientPlatformCredentialContext({
        endpoint: { baseUrl: target.baseUrl },
        siteId: site.id,
        mode: 'apikey',
        credential: '',
        credentialKind: 'access_token',
        accountExtraConfig,
        token: accessToken,
      })),
      remainingMs,
      timeoutMessage,
    );
  });
}

async function initializeAccountInBackground({
  accountId,
  site,
  adapter,
  tokenType,
  accessToken,
  preferredModelApiToken,
  accountExtraConfig,
  credentialKind,
  skipModelFetch,
}: AccountInitializationParams) {
  const summary = {
    accountId,
    syncedTokenCount: 0,
    refreshedBalance: false,
    refreshedModels: false,
    rebuiltRoutes: false,
  };

  let fetchedUpstreamTokens: Array<{ name?: string | null; key?: string | null; enabled?: boolean | null; tokenGroup?: string | null }> = [];
  if (tokenType === 'session' && accessToken) {
    try {
      const syncedTokens = await adapter.getApiTokens(buildTransientPlatformCredentialContext({
        endpoint: { baseUrl: site.url },
        siteId: site.id,
        mode: 'session',
        credential: accessToken,
        credentialKind: credentialKind || 'access_token',
        accountExtraConfig,
      }));
      summary.syncedTokenCount = Array.isArray(syncedTokens) ? syncedTokens.length : 0;
      fetchedUpstreamTokens = Array.isArray(syncedTokens) ? syncedTokens : [];
    } catch {}
  }

  const convergence = await convergeAccountMutation({
    accountId,
    preferredApiToken: tokenType === 'session' ? preferredModelApiToken : null,
    defaultTokenSource: 'manual',
    ensurePreferredTokenBeforeSync: tokenType === 'session',
    upstreamTokens: fetchedUpstreamTokens,
    refreshBalance: tokenType === 'session',
    refreshModels: skipModelFetch !== true,
    rebuildRoutes: skipModelFetch !== true,
    continueOnError: true,
  });
  summary.refreshedBalance = convergence.refreshedBalance;
  summary.refreshedModels = convergence.refreshedModels;
  summary.rebuiltRoutes = convergence.rebuiltRoutes;

  return summary;
}

function buildQueuedAccountInitializationMessage(
  tokenType: 'session' | 'apikey' | 'unknown',
  skipModelFetch?: boolean,
) {
  if (tokenType === 'session' && skipModelFetch === true) {
    return '账号已添加，后台正在同步令牌和余额信息。';
  }
  if (tokenType === 'session') {
    return '账号已添加，后台正在同步令牌、余额和模型信息。';
  }
  if (skipModelFetch === true) {
    return '已添加为 API Key 账号（可用于代理转发）。';
  }
  return '已添加为 API Key 账号，后台正在同步模型和路由信息。';
}

export async function createManualAccount({
  body,
  site,
  adapter,
  credentialMode,
  rawAccessToken,
  usernameOverride,
}: CreateManualAccountParams): Promise<CreateManualAccountResult> {
  let username = typeof usernameOverride === 'string'
    ? usernameOverride.trim()
    : (body.username || '').trim();
  let accessToken = rawAccessToken;
  let preferredModelApiToken = credentialMode === 'apikey' ? rawAccessToken.trim() : '';
  let tokenType: 'session' | 'apikey' | 'unknown' = 'unknown';
  let verifiedModels: string[] = [];
  const initialExtraConfig = applyAccountConnectionValues(
    mergeAccountExtraConfig(undefined, body.platformUserId ? { platformUserId: body.platformUserId } : {}),
    adapter.accountConnectionFields,
    body.connectionValues,
  );

  if (credentialMode === 'apikey') {
    if (body.skipModelFetch === true) {
      tokenType = 'apikey';
      accessToken = '';
      if (!preferredModelApiToken) preferredModelApiToken = rawAccessToken;
    } else {
      const models = await getModelsWithSiteApiEndpointPool(
        site,
        adapter,
        rawAccessToken,
        initialExtraConfig,
      );
      verifiedModels = Array.isArray(models)
        ? models.filter((item) => typeof item === 'string' && item.trim().length > 0)
        : [];
      if (verifiedModels.length === 0) {
        const error = new Error('API Key 验证失败：未获取到可用模型');
        (error as Error & { requiresVerification?: boolean }).requiresVerification = true;
        throw error;
      }

      tokenType = 'apikey';
      accessToken = '';
      if (!preferredModelApiToken) preferredModelApiToken = rawAccessToken;
    }
  } else {
    const verifyResult = await withTimeout(
      () => adapter.verifyToken(buildTransientPlatformCredentialContext({
        endpoint: { baseUrl: site.url },
        siteId: site.id,
        mode: 'session',
        credential: rawAccessToken,
        credentialKind: body.credentialKind || 'access_token',
        accountExtraConfig: initialExtraConfig,
      })),
      ACCOUNT_VERIFY_TIMEOUT_MS,
      buildAccountVerifyTimeoutMessage(),
    );
    tokenType = verifyResult.tokenType;
    if (tokenType === 'unknown') {
      const error = new Error('Token 验证失败，请先点击“验证 Token”，验证成功后再绑定账号');
      (error as Error & { requiresVerification?: boolean }).requiresVerification = true;
      throw error;
    }

    if (credentialMode === 'session' && tokenType !== 'session') {
      throw new Error('当前凭据是模型调用 Key，请在「API Key 管理」中添加。');
    }

    if (tokenType === 'session') {
      if (!username && verifyResult.userInfo?.username) username = String(verifyResult.userInfo.username).trim();
      if (verifyResult.discoveredModelToken) {
        preferredModelApiToken = String(verifyResult.discoveredModelToken).trim();
      }
    }
  }

  const resolvedPlatformUserId =
    body.platformUserId || guessPlatformUserIdFromUsername(username) || undefined;
  const resolvedCredentialMode: AccountCredentialMode = credentialMode;
  const extraConfigPatch: Record<string, unknown> = {};
  if (resolvedPlatformUserId) {
    extraConfigPatch.platformUserId = resolvedPlatformUserId;
  }
  const extraConfig = applyAccountConnectionValues(
    mergeAccountExtraConfig(initialExtraConfig, extraConfigPatch),
    adapter.accountConnectionFields,
    body.connectionValues,
  );

  const sortOrder = await getNextAccountSortOrder();
  const result = await db.transaction(async (tx) => {
    const created = await insertAndGetById<typeof schema.accounts.$inferSelect>({
      txDb: tx,
      table: schema.accounts,
      idColumn: schema.accounts.id,
      values: {
        siteId: body.siteId,
        username: username || undefined,
        credential: tokenType === 'session' ? accessToken : '',
        credentialMode: resolvedCredentialMode,
        credentialKind: tokenType === 'session'
          ? (body.credentialKind || 'access_token')
          : 'none',
        checkinEnabled: tokenType === 'session' ? (body.checkinEnabled ?? true) : false,
        extraConfig,
        isPinned: false,
        sortOrder,
      },
      insertErrorMessage: '创建账号失败',
      loadErrorMessage: '创建账号失败',
    });
    if (tokenType === 'apikey') {
      await tx.insert(schema.accountTokens).values({
        accountId: created.id,
        name: 'default',
        token: preferredModelApiToken,
        tokenGroup: 'default',
        valueStatus: 'ready',
        source: 'manual',
        enabled: true,
        isDefault: true,
      }).run();
    }
    return created;
  });
  await recordAccountsCatalogMutation();

  const shouldQueueInitialization = tokenType === 'session' || body.skipModelFetch !== true;
  let queuedTaskId: string | undefined;
  let queuedMessage: string | undefined;
  if (shouldQueueInitialization) {
    const taskTitle = `初始化连接 #${result.id}`;
    const { task } = startBackgroundTask(
      {
        type: 'account-init',
        title: taskTitle,
        dedupeKey: `account-init-${result.id}`,
        notifyOnFailure: true,
        successMessage: () => `${taskTitle}已完成`,
        failureMessage: (currentTask) => `${taskTitle}失败：${currentTask.error || 'unknown error'}`,
      },
      async () => initializeAccountInBackground({
        accountId: result.id,
        site,
        adapter,
        tokenType,
        accessToken,
        preferredModelApiToken,
        accountExtraConfig: extraConfig,
        credentialKind: body.credentialKind === 'session_cookie' ? 'session_cookie' : 'access_token',
        skipModelFetch: body.skipModelFetch,
      }),
    );
    queuedTaskId = task.id;
    queuedMessage = buildQueuedAccountInitializationMessage(tokenType, body.skipModelFetch);
  }

  const account = await db.select().from(schema.accounts).where(eq(schema.accounts.id, result.id)).get();
  if (!account) {
    throw new Error('创建账号失败');
  }

  return {
    account,
    tokenType,
    modelCount: verifiedModels.length,
    discoveredModelTokenCount: tokenType === 'session' && preferredModelApiToken ? 1 : 0,
    usernameDetected: !!(!body.username && username),
    queued: !!queuedTaskId,
    jobId: queuedTaskId,
    message: queuedMessage,
  };
}
