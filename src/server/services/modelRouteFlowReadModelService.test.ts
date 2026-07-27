import { describe, expect, it } from 'vitest';

import { normalizeModelRouteFlowPricingUsage } from './modelRouteFlowReadModelService.js';

describe('modelRouteFlowReadModelService', () => {
  it('normalizes complete pricing usage without inventing absent components', () => {
    expect(normalizeModelRouteFlowPricingUsage({
      inputTokens: '100',
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: null,
      custom: { gpuSeconds: '2.5', invalid: -1 },
    })).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 0,
      custom: { gpuSeconds: 2.5 },
    });
  });

  it('keeps an absent usage profile absent', () => {
    expect(normalizeModelRouteFlowPricingUsage({})).toBeNull();
    expect(normalizeModelRouteFlowPricingUsage(null)).toBeNull();
  });
});
