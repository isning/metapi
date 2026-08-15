import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { sendNotification } from './notifyService.js';
import { setAccountRuntimeHealth } from './accountHealthService.js';
import { updateAccountRuntimeIdentity } from './accountRuntimeIdentityMutationService.js';
import { recordAccountTokenAuthenticationFailure } from './accountTokenHealthService.js';
import { appendSessionTokenRebindHint } from './alertRules.js';
import { emitInboxItem } from './inboxService.js';

export type CredentialFailureKind = 'session' | 'apikey';

export function buildCredentialAuthenticationFailure(input: {
  credentialKind: CredentialFailureKind;
  tokenId?: number | null;
  accountId: number;
  accountLabel: string;
  siteLabel: string;
  detail?: string;
}) {
  const detailText = input.detail ? appendSessionTokenRebindHint(input.detail) : '';
  const detail = detailText ? ` (${detailText})` : '';
  const isApiKey = input.credentialKind === 'apikey';

  return {
    title: isApiKey ? 'API Key 验证失败' : '访问令牌已失效',
    summary: isApiKey
      ? `${input.accountLabel} @ ${input.siteLabel} 的 API Key 被上游拒绝`
      : `${input.accountLabel} @ ${input.siteLabel} 的访问令牌无效或已过期`,
    message: isApiKey
      ? `${input.accountLabel} @ ${input.siteLabel} 的 API Key 被上游拒绝${detail}`
      : `${input.accountLabel} @ ${input.siteLabel} 的访问令牌无效或已过期${detail}`,
    accountStatus: isApiKey ? null : 'expired' as const,
    runtimeHealth: isApiKey
      ? {
          reason: detailText
            ? `API Key 被上游拒绝：${detailText}`
            : 'API Key 被上游拒绝',
          source: 'proxy-auth',
        }
      : {
          reason: detailText ? `访问令牌失效：${detailText}` : '访问令牌失效',
          source: 'auth',
        },
    openAccountHref: isApiKey
      ? `/accounts?focusAccountId=${input.accountId}`
      : `/accounts?focusAccountId=${input.accountId}&openRebind=1`,
  };
}

export async function reportCredentialAuthenticationFailure(params: {
  accountId: number;
  username?: string | null;
  siteName?: string | null;
  credentialKind: CredentialFailureKind;
  tokenId?: number | null;
  detail?: string;
}) {
  const accountLabel = params.username || `ID:${params.accountId}`;
  const siteLabel = params.siteName || 'unknown-site';
  const failure = buildCredentialAuthenticationFailure({
    credentialKind: params.credentialKind,
    accountId: params.accountId,
    accountLabel,
    siteLabel,
    detail: params.detail,
  });
  await emitInboxItem({
    scope: 'attention',
    category: 'auth',
    severity: 'critical',
    type: 'token',
    title: failure.title,
    summary: failure.summary,
    message: failure.message,
    level: 'error',
    subject: { type: 'account', id: params.accountId, label: `${accountLabel} @ ${siteLabel}` },
    actions: [
      { id: 'open-account', label: '打开账号', kind: 'navigate', href: failure.openAccountHref, placement: 'primary' },
      { id: 'resolve', label: '标记已解决', kind: 'invoke', command: 'resolve', placement: 'secondary' },
    ],
    dedupeKey: params.credentialKind === 'apikey' && Number.isSafeInteger(params.tokenId) && (params.tokenId || 0) > 0
      ? `account:${params.accountId}:apikey:${params.tokenId}-authentication-failed`
      : `account:${params.accountId}:${params.credentialKind}-authentication-failed`,
    source: 'alert',
    relatedId: params.accountId,
    relatedType: 'account',
  });

  if (failure.accountStatus) {
    await updateAccountRuntimeIdentity(params.accountId, { status: failure.accountStatus });
  }

  if (params.credentialKind === 'apikey') {
    if (Number.isSafeInteger(params.tokenId) && (params.tokenId || 0) > 0) {
      await recordAccountTokenAuthenticationFailure(params.tokenId!, params.detail);
    }
  } else {
    await setAccountRuntimeHealth(params.accountId, {
      state: 'unhealthy',
      reason: failure.runtimeHealth.reason,
      source: failure.runtimeHealth.source,
    });
  }

  await sendNotification(
    failure.title,
    failure.message,
    'error',
  );
}

// Backward-compatible entry point for callers that historically reported a
// session token failure. New call sites should provide credentialKind.
export async function reportTokenExpired(params: {
  accountId: number;
  username?: string | null;
  siteName?: string | null;
  credentialKind?: CredentialFailureKind;
  tokenId?: number | null;
  detail?: string;
}) {
  return reportCredentialAuthenticationFailure({
    ...params,
    credentialKind: params.credentialKind || 'session',
  });
}

export async function reportProxyAllFailed(params: { model: string; reason: string }) {
  await emitInboxItem({
    scope: 'attention',
    category: 'routing',
    severity: 'critical',
    type: 'proxy',
    title: '代理全部失败',
    summary: `模型 ${params.model} 暂无可用上游`,
    message: `模型=${params.model}, 原因=${params.reason}`,
    level: 'error',
    subject: { type: 'route', id: params.model, label: params.model },
    actions: [
      { id: 'open-proxy-logs', label: '查看日志', kind: 'navigate', href: '/logs', placement: 'primary' },
      { id: 'resolve', label: '标记已解决', kind: 'invoke', command: 'resolve', placement: 'secondary' },
    ],
    dedupeKey: `proxy:${params.model}:all-failed`,
    source: 'proxy',
    relatedType: 'route',
  });

  await sendNotification(
    '代理全部失败',
    `模型=${params.model}, 原因=${params.reason}`,
    'error',
  );
}
