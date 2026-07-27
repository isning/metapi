import { and, eq, gte, lte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { loadPlatformPricingConfig } from './platformPricingConfigService.js';
import { valueWalletBalanceInBaseUnit } from './walletBalanceValuationService.js';
import { parseProxyBillingQuote } from './billingCostFact.js';
import type { BaseCostSummary } from '../../shared/billingCost.js';

export type ValuedBillingCostFact = {
  bucketStart: string;
  siteId: number;
  accountId: number;
  model: string | null;
  downstreamApiKeyId: number | null;
  amount: number | null;
  knownObservationCount: number;
  unknownObservationCount: number;
  incompatibleObservationCount: number;
};

export type ValuedBillingCostFacts = {
  baseCostUnit: string;
  facts: ValuedBillingCostFact[];
  valuationWarningCount: number;
};

export type BillingDetailsValuationRow = {
  billingDetails: unknown;
  siteId: number | null;
  accountId: number | null;
};

function normalizedUnit(value: unknown): string {
  const unit = String(value || '').trim().toUpperCase();
  return unit || 'USD';
}

export async function listValuedRequestCostFacts(input?: {
  fromDay?: string;
  toDay?: string;
}): Promise<ValuedBillingCostFacts> {
  const conditions = [
    eq(schema.billingCostAggregates.observationGrain, 'request'),
    eq(schema.billingCostAggregates.bucketKind, 'day'),
    eq(schema.billingCostAggregates.subjectKind, 'account'),
  ];
  if (input?.fromDay) conditions.push(gte(schema.billingCostAggregates.bucketStart, input.fromDay));
  if (input?.toDay) conditions.push(lte(schema.billingCostAggregates.bucketStart, input.toDay));

  const [rows, platformConfig] = await Promise.all([
    db.select().from(schema.billingCostAggregates).where(and(...conditions)).all(),
    loadPlatformPricingConfig(),
  ]);
  const baseCostUnit = normalizedUnit(platformConfig.baseCostUnit);
  const accountIds: number[] = [...new Set<number>(rows.flatMap((row) => (
    row.accountId == null ? [] : [Number(row.accountId)]
  )))];
  const accountRows = accountIds.length === 0
    ? []
    : await db.select({
      accountId: schema.accounts.id,
      siteId: schema.accounts.siteId,
    }).from(schema.accounts).all();
  const accountById = new Map<number, { accountId: number; siteId: number }>(
    accountRows.map((row) => [Number(row.accountId), {
      accountId: Number(row.accountId),
      siteId: Number(row.siteId),
    }]),
  );
  const valuationByAccountId = new Map<number, { multiplier: number | null; warningCount: number }>();
  await Promise.all(accountIds.map(async (accountId) => {
    const account = accountById.get(accountId);
    if (!account) return;
    const valuation = await valueWalletBalanceInBaseUnit({
      siteId: account.siteId,
      accountId,
      balance: 1,
    });
    valuationByAccountId.set(accountId, {
      multiplier: valuation.normalizedValue,
      warningCount: valuation.diagnostics.filter((item) => item.level === 'warn' || item.level === 'error').length,
    });
  }));

  const facts: ValuedBillingCostFact[] = [];
  for (const row of rows) {
    if (row.siteId == null || row.accountId == null) continue;
    const knownCount = Number(row.knownObservationCount || 0);
    const unknownCount = Number(row.unknownObservationCount || 0);
    let amount: number | null = null;
    let incompatibleObservationCount = 0;
    if (row.quoteUnit === 'currency' && normalizedUnit(row.currencyKey) === baseCostUnit) {
      amount = row.totalAmount == null ? null : Number(row.totalAmount);
    } else if (row.quoteUnit === 'quota') {
      const multiplier = valuationByAccountId.get(row.accountId)?.multiplier ?? null;
      amount = row.totalAmount == null || multiplier == null
        ? null
        : Number(row.totalAmount) * multiplier;
      incompatibleObservationCount = multiplier == null ? knownCount : 0;
    } else if (row.quoteUnit !== 'unknown') {
      incompatibleObservationCount = knownCount;
    }
    facts.push({
      bucketStart: row.bucketStart,
      siteId: row.siteId,
      accountId: row.accountId,
      model: row.model,
      downstreamApiKeyId: row.downstreamApiKeyId,
      amount,
      knownObservationCount: knownCount,
      unknownObservationCount: unknownCount,
      incompatibleObservationCount,
    });
  }

  return {
    baseCostUnit,
    facts,
    valuationWarningCount: [...valuationByAccountId.values()]
      .reduce((sum, item) => sum + item.warningCount, 0),
  };
}

export async function valueBillingDetailsRowsInBaseUnit(
  rows: BillingDetailsValuationRow[],
): Promise<BaseCostSummary> {
  const platformConfig = await loadPlatformPricingConfig();
  const baseCostUnit = normalizedUnit(platformConfig.baseCostUnit);
  const quotaAccountIds = [...new Set(rows.flatMap((row) => {
    const quote = parseProxyBillingQuote(row.billingDetails);
    return quote?.unit === 'quota' && row.accountId != null ? [row.accountId] : [];
  }))];
  const multiplierByAccountId = new Map<number, number | null>();
  await Promise.all(quotaAccountIds.map(async (accountId) => {
    const row = rows.find((candidate) => candidate.accountId === accountId && candidate.siteId != null);
    if (!row?.siteId) {
      multiplierByAccountId.set(accountId, null);
      return;
    }
    const valuation = await valueWalletBalanceInBaseUnit({
      siteId: row.siteId,
      accountId,
      balance: 1,
    });
    multiplierByAccountId.set(accountId, valuation.normalizedValue);
  }));

  const summary: BaseCostSummary = {
    amount: 0,
    unit: baseCostUnit,
    knownObservationCount: 0,
    unknownObservationCount: 0,
    incompatibleObservationCount: 0,
  };
  for (const row of rows) {
    const quote = parseProxyBillingQuote(row.billingDetails);
    if (!quote) {
      summary.unknownObservationCount += 1;
      continue;
    }
    if (quote.unit === 'currency') {
      if (normalizedUnit(quote.currency) !== baseCostUnit) {
        summary.incompatibleObservationCount += 1;
        continue;
      }
      summary.amount += quote.amount;
      summary.knownObservationCount += 1;
      continue;
    }
    const multiplier = row.accountId == null ? null : multiplierByAccountId.get(row.accountId) ?? null;
    if (multiplier == null) {
      summary.incompatibleObservationCount += 1;
      continue;
    }
    summary.amount += quote.amount * multiplier;
    summary.knownObservationCount += 1;
  }
  summary.amount = Math.round(summary.amount * 1_000_000) / 1_000_000;
  return summary;
}
