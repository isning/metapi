import { and, eq, gte, lte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type {
  BillingCostAmount,
  BillingCostSubjectKind,
  BillingCostSummary,
  BillingObservationGrain,
} from '../../shared/billingCost.js';

type CostRow = typeof schema.billingCostAggregates.$inferSelect;

function emptySummary(): BillingCostSummary {
  return {
    amounts: [],
    knownObservationCount: 0,
    unknownObservationCount: 0,
  };
}

function amountIdentity(row: CostRow): string {
  return JSON.stringify([
    row.quoteUnit,
    row.currencyKey,
    row.quoteSource,
    row.quoteSourceIdKey,
    row.estimateLevelKey,
    row.planFingerprintKey,
  ]);
}

export function summarizeBillingCostRows(rows: CostRow[]): BillingCostSummary {
  const summary = emptySummary();
  const amounts = new Map<string, BillingCostAmount>();
  for (const row of rows) {
    summary.knownObservationCount += Number(row.knownObservationCount || 0);
    summary.unknownObservationCount += Number(row.unknownObservationCount || 0);
    if (row.quoteUnit !== 'currency' && row.quoteUnit !== 'quota') continue;
    if (row.totalAmount == null) continue;
    const key = amountIdentity(row);
    const current = amounts.get(key) || {
      amount: 0,
      unit: row.quoteUnit,
      currency: row.quoteUnit === 'currency' ? row.currencyKey || null : null,
      source: row.quoteSource,
      sourceId: row.quoteSourceIdKey || null,
      estimateLevel: row.estimateLevelKey || null,
      planFingerprint: row.planFingerprintKey || null,
      observationCount: 0,
    };
    current.amount += Number(row.totalAmount);
    current.observationCount += Number(row.knownObservationCount || 0);
    amounts.set(key, current);
  }
  summary.amounts = [...amounts.values()]
    .map((amount) => ({
      ...amount,
      amount: Math.round(amount.amount * 1_000_000) / 1_000_000,
    }))
    .sort((left, right) => (
      `${left.unit}:${left.currency ?? ''}:${left.source}:${left.sourceId ?? ''}`
        .localeCompare(`${right.unit}:${right.currency ?? ''}:${right.source}:${right.sourceId ?? ''}`)
    ));
  return summary;
}

export async function getBillingCostSummary(input: {
  observationGrain: BillingObservationGrain;
  subjectKind: BillingCostSubjectKind;
  subjectKey: string;
  fromDay: string;
  toDay: string;
}): Promise<BillingCostSummary> {
  const rows = await db.select().from(schema.billingCostAggregates).where(and(
    eq(schema.billingCostAggregates.observationGrain, input.observationGrain),
    eq(schema.billingCostAggregates.bucketKind, 'day'),
    eq(schema.billingCostAggregates.subjectKind, input.subjectKind),
    eq(schema.billingCostAggregates.subjectKey, input.subjectKey),
    gte(schema.billingCostAggregates.bucketStart, input.fromDay),
    lte(schema.billingCostAggregates.bucketStart, input.toDay),
  )).all();
  return summarizeBillingCostRows(rows);
}
