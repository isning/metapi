import type { ProxyBillingQuote } from '../../shared/proxyBilling.js';
import type { BillingCostSummary } from '../../shared/billingCost.js';

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return parseJsonObject(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function optionalText(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export function parseProxyBillingQuote(value: unknown): ProxyBillingQuote | null {
  const details = parseJsonObject(value);
  const quote = parseJsonObject(details?.quote);
  if (!quote) return null;

  const amount = Number(quote.amount);
  const unit = quote.unit === 'currency' || quote.unit === 'quota' ? quote.unit : null;
  const source = optionalText(quote.source);
  if (!Number.isFinite(amount) || amount < 0 || !unit || !source) return null;

  const currency = optionalText(quote.currency);
  if (unit === 'currency' && !currency) return null;

  return {
    amount,
    unit,
    currency: unit === 'currency' ? currency : null,
    source: source as ProxyBillingQuote['source'],
    sourceId: typeof quote.sourceId === 'number'
      ? quote.sourceId
      : optionalText(quote.sourceId),
    matchedScope: optionalText(quote.matchedScope),
    estimateLevel: optionalText(quote.estimateLevel) as ProxyBillingQuote['estimateLevel'],
    planFingerprint: optionalText(quote.planFingerprint),
  };
}

export function summarizeProxyBillingDetails(values: unknown[]): BillingCostSummary {
  const amounts = new Map<string, BillingCostSummary['amounts'][number]>();
  let unknownObservationCount = 0;
  for (const value of values) {
    const quote = parseProxyBillingQuote(value);
    if (!quote) {
      unknownObservationCount += 1;
      continue;
    }
    const key = JSON.stringify([
      quote.unit,
      quote.currency,
      quote.source,
      quote.sourceId,
      quote.estimateLevel,
      quote.planFingerprint,
    ]);
    const current = amounts.get(key) || {
      amount: 0,
      unit: quote.unit,
      currency: quote.currency,
      source: quote.source,
      sourceId: quote.sourceId == null ? null : String(quote.sourceId),
      estimateLevel: quote.estimateLevel,
      planFingerprint: quote.planFingerprint,
      observationCount: 0,
    };
    current.amount += quote.amount;
    current.observationCount += 1;
    amounts.set(key, current);
  }
  return {
    amounts: [...amounts.values()].map((amount) => ({
      ...amount,
      amount: Math.round(amount.amount * 1_000_000) / 1_000_000,
    })),
    knownObservationCount: [...amounts.values()].reduce((sum, amount) => sum + amount.observationCount, 0),
    unknownObservationCount,
  };
}
