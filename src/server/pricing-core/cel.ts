import { celEnv, isCelError, parse, plan } from '@bufbuild/cel';

import type { CanonicalUsage } from './types.js';

export type PricingCelEvaluator = (ctx?: Record<string, unknown>) => unknown;

export interface PricingCelContext {
  model?: string | null;
  provider?: string | null;
  usage: CanonicalUsage;
  quantity?: number;
  scale?: number;
  unitPriceUsd?: number;
  component?: Record<string, unknown>;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  upstreamSupply?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

const pricingCelEnv = celEnv();
const pricingCelPlanCache = new Map<string, PricingCelEvaluator | null>();

function celValueToPlain(value: unknown): unknown {
  if (isCelError(value)) return undefined;
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(celValueToPlain);
  if (!value || typeof value !== 'object') return value;

  const maybeCelCollection = value as {
    entries?: () => Iterable<[unknown, unknown]>;
    values?: () => Iterable<unknown>;
  };
  if (typeof maybeCelCollection.entries === 'function') {
    return Object.fromEntries(Array.from(maybeCelCollection.entries()).map(([key, item]) => [String(key), celValueToPlain(item)]));
  }
  if (typeof maybeCelCollection.values === 'function') {
    return Array.from(maybeCelCollection.values()).map(celValueToPlain);
  }
  return value;
}

export function compilePricingCelExpression(expression: string): PricingCelEvaluator | null {
  const normalized = expression.trim();
  if (!normalized) return null;
  if (pricingCelPlanCache.has(normalized)) return pricingCelPlanCache.get(normalized) ?? null;

  try {
    const evaluator = plan(pricingCelEnv, parse(normalized)) as PricingCelEvaluator;
    pricingCelPlanCache.set(normalized, evaluator);
    return evaluator;
  } catch {
    pricingCelPlanCache.set(normalized, null);
    return null;
  }
}

export function evaluatePricingCelExpression(expression: string, context: PricingCelContext): unknown {
  const evaluator = compilePricingCelExpression(expression);
  if (!evaluator) return undefined;
  try {
    return celValueToPlain(evaluator(context as unknown as Record<string, unknown>));
  } catch {
    return undefined;
  }
}

export const pricingCelTestUtils = {
  celPlanCacheSize: () => pricingCelPlanCache.size,
  clearCelPlanCache: () => pricingCelPlanCache.clear(),
};
