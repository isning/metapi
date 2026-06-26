import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { sendNotification } from './notifyService.js';
import { setAccountRuntimeHealth } from './accountHealthService.js';
import { appendSessionTokenRebindHint } from './alertRules.js';
import { emitInboxItem } from './inboxService.js';

export async function reportTokenExpired(params: {
  accountId: number;
  username?: string | null;
  siteName?: string | null;
  detail?: string;
}) {
  const accountLabel = params.username || `ID:${params.accountId}`;
  const siteLabel = params.siteName || 'unknown-site';
  const detailText = params.detail ? appendSessionTokenRebindHint(params.detail) : '';
  const detail = detailText ? ` (${detailText})` : '';
  await emitInboxItem({
    scope: 'attention',
    category: 'auth',
    severity: 'critical',
    type: 'token',
    title: 'Token 已失效',
    summary: `${accountLabel} @ ${siteLabel} 的 Token 无效或已过期`,
    message: `${accountLabel} @ ${siteLabel} 的 Token 无效或已过期${detail}`,
    level: 'error',
    subject: { type: 'account', id: params.accountId, label: `${accountLabel} @ ${siteLabel}` },
    actions: [
      { id: 'open-account', label: '打开账号', kind: 'navigate', href: `/accounts?focusAccountId=${params.accountId}&openRebind=1`, placement: 'primary' },
      { id: 'resolve', label: '标记已解决', kind: 'invoke', command: 'resolve', placement: 'secondary' },
    ],
    dedupeKey: `account:${params.accountId}:token-expired`,
    source: 'alert',
    relatedId: params.accountId,
    relatedType: 'account',
  });

  await db.update(schema.accounts).set({
    status: 'expired',
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.accounts.id, params.accountId)).run();

  setAccountRuntimeHealth(params.accountId, {
    state: 'unhealthy',
    reason: detailText ? `访问令牌失效：${detailText}` : '访问令牌失效',
    source: 'auth',
  });

  await sendNotification(
    'Token 已失效',
    `${accountLabel} @ ${siteLabel} 的 Token 无效或已过期${detail}`,
    'error',
  );
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
