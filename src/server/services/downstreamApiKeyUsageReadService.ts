import { and, gte, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { valueBillingDetailsRowsInBaseUnit } from './billingCostValuationService.js';
import type { BaseCostSummary } from '../../shared/billingCost.js';

export type DownstreamApiKeyUsageMetric = {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  successRate: number | null;
  totalTokens: number;
  cost: BaseCostSummary;
};

export async function readDownstreamApiKeyUsage(input: {
  keyIds: number[];
  sinceUtc: string | null;
}): Promise<Map<number, DownstreamApiKeyUsageMetric>> {
  if (input.keyIds.length === 0) return new Map();
  const rows = await db.select({
    keyId: schema.proxyRequests.downstreamApiKeyId,
    status: schema.proxyRequests.status,
    totalTokens: schema.proxyRequests.totalTokens,
    billingDetails: schema.proxyRequests.billingDetails,
    siteId: schema.proxyRequests.finalSiteId,
    accountId: schema.proxyRequests.finalAccountId,
  }).from(schema.proxyRequests).where(and(
    inArray(schema.proxyRequests.downstreamApiKeyId, input.keyIds),
    inArray(schema.proxyRequests.status, ['success', 'failure']),
    ...(input.sinceUtc ? [gte(schema.proxyRequests.completedAt, input.sinceUtc)] : []),
  )).all();
  const rowsByKey = new Map<number, typeof rows>();
  for (const row of rows) {
    if (row.keyId == null) continue;
    const current = rowsByKey.get(row.keyId) || [];
    current.push(row);
    rowsByKey.set(row.keyId, current);
  }
  const result = new Map<number, DownstreamApiKeyUsageMetric>();
  await Promise.all(input.keyIds.map(async (keyId) => {
    const keyRows = rowsByKey.get(keyId) || [];
    const successRequests = keyRows.filter((row) => row.status === 'success').length;
    const failedRequests = keyRows.filter((row) => row.status === 'failure').length;
    const totalRequests = successRequests + failedRequests;
    result.set(keyId, {
      totalRequests,
      successRequests,
      failedRequests,
      successRate: totalRequests > 0
        ? Math.round((successRequests / totalRequests) * 1000) / 10
        : null,
      totalTokens: keyRows.reduce((sum, row) => sum + Number(row.totalTokens || 0), 0),
      cost: await valueBillingDetailsRowsInBaseUnit(keyRows),
    });
  }));
  return result;
}
