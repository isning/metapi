import { and, eq, gte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getLocalRangeStartDayKey } from './localTimeService.js';
import { runUsageAggregationProjectionPass } from './usageAggregationService.js';
import { summarizeBillingCostRows } from './billingCostAggregateReadService.js';
import type { BillingCostSummary } from '../../shared/billingCost.js';

export type ModelUsageBySiteQuery = {
  siteId?: string;
  days?: string;
};

export async function listModelUsageBySite(query: ModelUsageBySiteQuery): Promise<{
  models: Array<{ model: string; calls: number; cost: BillingCostSummary; tokens: number }>;
}> {
  const siteId = query.siteId ? Number.parseInt(query.siteId, 10) : null;
  const days = Math.max(1, Number.parseInt(query.days || '7', 10));
  await runUsageAggregationProjectionPass();
  const sinceDay = getLocalRangeStartDayKey(days);
  const rows = siteId != null && Number.isFinite(siteId)
    ? await db.select().from(schema.modelDayUsage).where(and(
      gte(schema.modelDayUsage.localDay, sinceDay),
      eq(schema.modelDayUsage.siteId, siteId),
    )).all()
    : await db.select().from(schema.modelDayUsage)
      .where(gte(schema.modelDayUsage.localDay, sinceDay)).all();

  const costConditions = [
    gte(schema.billingCostAggregates.bucketStart, sinceDay),
    eq(schema.billingCostAggregates.observationGrain, 'request'),
    eq(schema.billingCostAggregates.bucketKind, 'day'),
    eq(schema.billingCostAggregates.subjectKind, 'model'),
  ];
  if (siteId != null && Number.isFinite(siteId)) {
    costConditions.push(eq(schema.billingCostAggregates.siteId, siteId));
  }
  const costRows = await db.select().from(schema.billingCostAggregates)
    .where(and(...costConditions)).all();
  const costRowsByModel = new Map<string, typeof costRows>();
  for (const row of costRows) {
    if (!row.model) continue;
    const current = costRowsByModel.get(row.model) || [];
    current.push(row);
    costRowsByModel.set(row.model, current);
  }

  const totals = new Map<string, { calls: number; tokens: number }>();
  for (const row of rows) {
    const model = row.model || 'unknown';
    const current = totals.get(model) || { calls: 0, tokens: 0 };
    current.calls += Number(row.totalCalls || 0);
    current.tokens += Number(row.totalTokens || 0);
    totals.set(model, current);
  }

  return {
    models: [...totals.entries()]
      .map(([model, totals]) => ({
        model,
        calls: totals.calls,
        cost: summarizeBillingCostRows(costRowsByModel.get(model) || []),
        tokens: totals.tokens,
      }))
      .sort((left, right) => right.calls - left.calls),
  };
}
