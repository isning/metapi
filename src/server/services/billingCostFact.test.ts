import { describe, expect, it } from 'vitest';
import { parseProxyBillingQuote, summarizeProxyBillingDetails } from './billingCostFact.js';

describe('parseProxyBillingQuote', () => {
  it('preserves an explicit free quote as a known zero amount', () => {
    expect(parseProxyBillingQuote(JSON.stringify({
      quote: {
        amount: 0,
        unit: 'currency',
        currency: 'USD',
        source: 'provider_catalog',
        sourceId: 'catalog:1',
        matchedScope: 'provider_catalog',
        estimateLevel: 'exact',
        planFingerprint: 'sha256:quote',
      },
    }))).toMatchObject({ amount: 0, unit: 'currency', currency: 'USD' });
  });

  it.each([
    null,
    '{}',
    '{bad json',
    { quote: { amount: -1, unit: 'currency', currency: 'USD', source: 'provider_catalog' } },
    { quote: { amount: 1, unit: 'currency', currency: null, source: 'provider_catalog' } },
  ])('keeps missing or invalid quote facts unknown', (value) => {
    expect(parseProxyBillingQuote(value)).toBeNull();
  });
});

describe('summarizeProxyBillingDetails', () => {
  it('does not combine different currencies and counts missing quotes', () => {
    const details = (amount: number, currency: string) => ({ quote: {
      amount,
      unit: 'currency',
      currency,
      source: 'provider_catalog',
      sourceId: null,
      estimateLevel: 'exact',
      planFingerprint: 'plan',
    } });
    expect(summarizeProxyBillingDetails([
      details(1, 'USD'),
      details(2, 'USD'),
      details(4, 'CNY'),
      null,
    ])).toEqual({
      amounts: expect.arrayContaining([
        expect.objectContaining({ amount: 3, currency: 'USD', observationCount: 2 }),
        expect.objectContaining({ amount: 4, currency: 'CNY', observationCount: 1 }),
      ]),
      knownObservationCount: 3,
      unknownObservationCount: 1,
    });
  });
});
