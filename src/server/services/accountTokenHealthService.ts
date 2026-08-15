import { eq, inArray } from 'drizzle-orm';

import { db, runtimeDbDialect, schema } from '../db/index.js';
import { isUsableAccountToken, type AccountTokenRow } from './accountTokenService.js';
import type { RuntimeHealthInfo } from './accountHealthService.js';

export type AccountTokenHealthState = 'healthy' | 'unhealthy' | 'unknown';
export type AccountTokenHealth = {
  state: AccountTokenHealthState;
  reason: string;
  source: string;
  checkedAt: string | null;
};

function normalizeState(value: unknown): AccountTokenHealthState {
  return value === 'healthy' || value === 'unhealthy' ? value : 'unknown';
}

function normalizeHealth(row: typeof schema.accountTokenHealth.$inferSelect): AccountTokenHealth {
  const state = normalizeState(row.state);
  return {
    state,
    reason: (row.reason || '').trim() || (state === 'healthy' ? '最近一次代理请求成功' : state === 'unhealthy' ? 'API Key 被上游拒绝' : '尚未检测'),
    source: (row.source || '').trim() || 'proxy-observation',
    checkedAt: row.checkedAt || null,
  };
}

async function upsertTokenHealth(tokenId: number, health: Omit<AccountTokenHealth, 'checkedAt'> & { checkedAt?: string | null }) {
  const checkedAt = health.checkedAt || new Date().toISOString();
  const values = { tokenId, state: health.state, reason: health.reason, source: health.source, checkedAt, updatedAt: checkedAt };
  if (runtimeDbDialect === 'mysql') {
    const existing = await db.select({ id: schema.accountTokenHealth.id }).from(schema.accountTokenHealth)
      .where(eq(schema.accountTokenHealth.tokenId, tokenId)).get();
    if (existing) {
      await db.update(schema.accountTokenHealth).set(values).where(eq(schema.accountTokenHealth.id, existing.id)).run();
      return;
    }
    await db.insert(schema.accountTokenHealth).values(values).run();
    return;
  }
  await (db.insert(schema.accountTokenHealth).values(values) as any).onConflictDoUpdate({
    target: schema.accountTokenHealth.tokenId,
    set: { state: values.state, reason: values.reason, source: values.source, checkedAt: values.checkedAt, updatedAt: values.updatedAt },
  }).run();
}

export async function recordAccountTokenProxySuccess(tokenId: number): Promise<void> {
  await upsertTokenHealth(tokenId, { state: 'healthy', reason: '最近一次代理请求成功', source: 'proxy-observation' });
}

export async function recordAccountTokenAuthenticationFailure(tokenId: number, detail?: string): Promise<void> {
  const suffix = (detail || '').trim();
  await upsertTokenHealth(tokenId, {
    state: 'unhealthy',
    reason: suffix ? `API Key 被上游拒绝：${suffix}` : 'API Key 被上游拒绝',
    source: 'proxy-auth',
  });
}

export async function listAccountTokenHealth(tokenIds?: number[]): Promise<Map<number, AccountTokenHealth>> {
  if (tokenIds && tokenIds.length === 0) return new Map();
  const rows = await db.select().from(schema.accountTokenHealth)
    .where(tokenIds ? inArray(schema.accountTokenHealth.tokenId, tokenIds) : undefined)
    .all();
  return new Map(rows.map((row) => [row.tokenId, normalizeHealth(row)]));
}

export function buildApiKeyAccountHealth(tokens: AccountTokenRow[], healthByTokenId: Map<number, AccountTokenHealth>): RuntimeHealthInfo {
  const usable = tokens.filter(isUsableAccountToken);
  if (usable.length === 0) return { state: 'unknown', reason: '没有可用的 API Key', source: 'token-aggregate', checkedAt: null };
  const observed = usable.map((token) => healthByTokenId.get(token.id)).filter((health): health is AccountTokenHealth => !!health && health.state !== 'unknown');
  if (observed.length === 0) return { state: 'unknown', reason: 'API Key 尚未获得代理健康样本', source: 'token-aggregate', checkedAt: null };
  const healthy = observed.filter((health) => health.state === 'healthy');
  const unhealthy = observed.filter((health) => health.state === 'unhealthy');
  const checkedAt = observed.map((health) => health.checkedAt).filter((value): value is string => !!value).sort().at(-1) || null;
  if (healthy.length > 0 && unhealthy.length > 0) return { state: 'degraded', reason: `${healthy.length} 个 API Key 可用，${unhealthy.length} 个被上游拒绝`, source: 'token-aggregate', checkedAt };
  if (healthy.length > 0) return { state: 'healthy', reason: `${healthy.length} 个 API Key 最近代理成功`, source: 'token-aggregate', checkedAt };
  return { state: 'unhealthy', reason: `全部 ${unhealthy.length} 个已检测 API Key 被上游拒绝`, source: 'token-aggregate', checkedAt };
}
