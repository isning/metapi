import { describe, expect, it } from 'vitest';
import { summarizeBillingCostRows } from './billingCostAggregateReadService.js';

const base = {
  id: 1,
  observationGrain: 'request',
  bucketKind: 'day',
  bucketStart: '2026-07-27',
  subjectKind: 'model',
  subjectKey: 'model-a',
  quoteSourceIdKey: '',
  estimateLevelKey: 'exact',
  planFingerprintKey: 'plan-a',
  createdAt: null,
  updatedAt: null,
};

describe('summarizeBillingCostRows', () => {
  it('keeps currencies and quota units separate while preserving unknown and free observations', () => {
    const summary = summarizeBillingCostRows([
      {
        ...base,
        quoteUnit: 'currency',
        currencyKey: 'USD',
        quoteSource: 'provider_catalog',
        totalAmount: 1.25,
        knownObservationCount: 2,
        unknownObservationCount: 0,
      },
      {
        ...base,
        id: 2,
        quoteUnit: 'currency',
        currencyKey: 'CNY',
        quoteSource: 'provider_catalog',
        totalAmount: 0,
        knownObservationCount: 1,
        unknownObservationCount: 0,
      },
      {
        ...base,
        id: 3,
        quoteUnit: 'quota',
        currencyKey: '',
        quoteSource: 'billing_override',
        totalAmount: 4,
        knownObservationCount: 1,
        unknownObservationCount: 0,
      },
      {
        ...base,
        id: 4,
        quoteUnit: 'unknown',
        currencyKey: '',
        quoteSource: 'unavailable',
        totalAmount: null,
        knownObservationCount: 0,
        unknownObservationCount: 3,
      },
    ]);

    expect(summary).toEqual({
      amounts: [
        expect.objectContaining({ amount: 0, unit: 'currency', currency: 'CNY', observationCount: 1 }),
        expect.objectContaining({ amount: 1.25, unit: 'currency', currency: 'USD', observationCount: 2 }),
        expect.objectContaining({ amount: 4, unit: 'quota', currency: null, observationCount: 1 }),
      ],
      knownObservationCount: 4,
      unknownObservationCount: 3,
    });
  });
});
