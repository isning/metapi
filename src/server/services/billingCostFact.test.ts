import { describe, expect, it } from 'vitest';
import {
  parseProxyBillingQuote,
  parseProxyBillingSummary,
  summarizeProxyBillingDetails,
} from './billingCostFact.js';

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

describe('parseProxyBillingSummary', () => {
  it('returns a currency quote without requiring usage counters', () => {
    expect(parseProxyBillingSummary({ quote: {
      amount: 0.25,
      unit: 'currency',
      currency: 'USD',
      source: 'provider_catalog',
    } })).toEqual({
      quote: expect.objectContaining({ amount: 0.25, unit: 'currency', currency: 'USD' }),
      cacheReadTokens: null,
      cacheCreationTokens: null,
    });
  });

  it('returns a quota quote with a null currency', () => {
    expect(parseProxyBillingSummary({ quote: {
      amount: 4,
      unit: 'quota',
      source: 'upstream_self_log',
    } })?.quote).toMatchObject({ amount: 4, unit: 'quota', currency: null });
  });

  it('keeps cache counters when no quote was recorded and accepts numeric strings', () => {
    expect(parseProxyBillingSummary(JSON.stringify({ usage: {
      cacheReadTokens: '1024',
      cacheCreationTokens: '32',
    } }))).toEqual({
      quote: null,
      cacheReadTokens: 1024,
      cacheCreationTokens: 32,
    });
  });

  it.each([null, '{}', '{bad json', { usage: {} }])(
    'returns null when no usable summary fact exists',
    (value) => {
      expect(parseProxyBillingSummary(value)).toBeNull();
    },
  );

  it('ignores negative and fractional token counters', () => {
    expect(parseProxyBillingSummary({
      quote: {
        amount: 1,
        unit: 'quota',
        source: 'upstream_self_log',
      },
      usage: {
        cacheReadTokens: -1,
        cacheCreationTokens: 1.5,
      },
    })).toEqual({
      quote: expect.objectContaining({ amount: 1, unit: 'quota' }),
      cacheReadTokens: null,
      cacheCreationTokens: null,
    });
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
