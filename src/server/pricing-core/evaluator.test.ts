import { describe, expect, it } from 'vitest';
import {
  evaluatePricingPlan,
  hashCanonicalUsage,
  normalizeCanonicalUsage,
  parsePricingPlan,
  pricingCelTestUtils,
  type PricingPlan,
} from './index.js';

function basePlan(overrides: Partial<PricingPlan> = {}): PricingPlan {
  return {
    schemaVersion: 1,
    planKind: 'rate_card',
    unitPrecision: 'per_1m',
    billingMode: 'token',
    aggregation: { mode: 'sum_components' },
    rounding: { mode: 'total', precision: 6 },
    tiers: [],
    components: [
      {
        id: 'input',
        label: 'Input',
        role: 'charge',
        kind: 'input_tokens',
        meter: { unit: 'token', quantityPath: 'usage.inputTokens', scale: 1_000_000 },
        price: { currency: 'USD', amount: 5, unitLabel: '1M input tokens' },
      },
      {
        id: 'output',
        label: 'Output',
        role: 'charge',
        kind: 'output_tokens',
        meter: { unit: 'token', quantityPath: 'usage.outputTokens', scale: 1_000_000 },
        price: { currency: 'USD', amount: 15, unitLabel: '1M output tokens' },
      },
    ],
    ...overrides,
  };
}

describe('pricing-core evaluator', () => {
  it('validates duplicate component ids', () => {
    const result = parsePricingPlan(basePlan({
      components: [
        {
          id: 'input',
          label: 'Input',
          role: 'charge',
          kind: 'input_tokens',
          meter: { unit: 'token', scale: 1_000_000 },
          price: { currency: 'USD', amount: 1, unitLabel: '1M tokens' },
        },
        {
          id: 'input',
          label: 'Duplicate',
          role: 'charge',
          kind: 'output_tokens',
          meter: { unit: 'token', scale: 1_000_000 },
          price: { currency: 'USD', amount: 2, unitLabel: '1M tokens' },
        },
      ],
    }));

    expect(result).toEqual({
      success: false,
      error: 'Duplicate component id: input',
    });
  });

  it('validates CEL syntax in pricing plans', () => {
    const result = parsePricingPlan(basePlan({
      components: [{
        id: 'input',
        label: 'Input',
        role: 'charge',
        kind: 'input_tokens',
        meter: { unit: 'token', scale: 1_000_000 },
        price: {
          currency: 'USD',
          amount: 1,
          unitLabel: '1M tokens',
          expression: { kind: 'formula', cel: 'unitPriceUsd *' },
        },
      }],
    }));

    expect(result).toEqual({
      success: false,
      error: 'Pricing formula CEL expression is invalid.',
    });
  });

  it('normalizes usage and creates stable hashes', () => {
    const left = normalizeCanonicalUsage({
      inputTokens: 10,
      requestCount: undefined,
      custom: { b: 2, a: 1 },
    });
    const right = normalizeCanonicalUsage({
      inputTokens: 10,
      custom: { a: 1, b: 2 },
    });

    expect(left.requestCount).toBe(1);
    expect(hashCanonicalUsage(left)).toBe(hashCanonicalUsage(right));
  });

  it('evaluates flat token pricing', () => {
    const evaluation = evaluatePricingPlan({
      plan: basePlan(),
      usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
    });

    expect(evaluation.totalCostUsd).toBe(12.5);
    expect(evaluation.components).toEqual([
      expect.objectContaining({ componentId: 'input', costUsd: 5, quantityPricingMode: 'flat' }),
      expect.objectContaining({ componentId: 'output', costUsd: 7.5, quantityPricingMode: 'flat' }),
    ]);
    expect(evaluation.estimateLevel).toBe('exact');
  });

  it('evaluates volume and graduated tiers differently', () => {
    const volume = evaluatePricingPlan({
      plan: basePlan({
        components: [{
          id: 'input',
          label: 'Volume input',
          role: 'charge',
          kind: 'input_tokens',
          meter: { unit: 'token', scale: 1_000_000 },
          price: { currency: 'USD', amount: 10, unitLabel: '1M input tokens' },
          quantityPricing: {
            mode: 'volume_tier',
            tiers: [
              { id: 'low', from: 0, to: 1_000_000, price: { currency: 'USD', amount: 10, unitLabel: '1M' } },
              { id: 'high', from: 1_000_000, price: { currency: 'USD', amount: 6, unitLabel: '1M' } },
            ],
          },
        }],
      }),
      usage: { inputTokens: 2_000_000 },
    });

    const graduated = evaluatePricingPlan({
      plan: basePlan({
        components: [{
          id: 'input',
          label: 'Graduated input',
          role: 'charge',
          kind: 'input_tokens',
          meter: { unit: 'token', scale: 1_000_000 },
          price: { currency: 'USD', amount: 10, unitLabel: '1M input tokens' },
          quantityPricing: {
            mode: 'graduated_tier',
            tiers: [
              { id: 'low', from: 0, to: 1_000_000, price: { currency: 'USD', amount: 10, unitLabel: '1M' } },
              { id: 'high', from: 1_000_000, price: { currency: 'USD', amount: 6, unitLabel: '1M' } },
            ],
          },
        }],
      }),
      usage: { inputTokens: 2_000_000 },
    });

    expect(volume.totalCostUsd).toBe(12);
    expect(graduated.totalCostUsd).toBe(16);
  });

  it('applies request-scoped allowances before component pricing', () => {
    const evaluation = evaluatePricingPlan({
      plan: basePlan({
        components: [{
          id: 'input',
          label: 'Input',
          role: 'charge',
          kind: 'input_tokens',
          meter: { unit: 'token', quantityPath: 'usage.inputTokens', scale: 1_000_000 },
          price: { currency: 'USD', amount: 10, unitLabel: '1M input tokens' },
        }],
        allowances: [{
          id: 'free-input',
          label: 'Free request input',
          meter: { unit: 'token', quantityPath: 'usage.inputTokens', scale: 1_000_000 },
          quantity: 100_000,
          period: 'request',
        }],
      }),
      usage: { inputTokens: 250_000 },
    });

    expect(evaluation.totalCostUsd).toBe(1.5);
    expect(evaluation.components[0]).toMatchObject({
      quantity: 150_000,
      allowanceApplied: 100_000,
    });
  });

  it('emits estimate diagnostics for period allowances without period state', () => {
    const evaluation = evaluatePricingPlan({
      plan: basePlan({
        components: [{
          id: 'input',
          label: 'Input',
          role: 'charge',
          kind: 'input_tokens',
          meter: { unit: 'token', quantityPath: 'usage.inputTokens', scale: 1_000_000 },
          price: { currency: 'USD', amount: 10, unitLabel: '1M input tokens' },
        }],
        allowances: [{
          id: 'monthly-free-input',
          label: 'Monthly free input',
          meter: { unit: 'token', quantityPath: 'usage.inputTokens', scale: 1_000_000 },
          quantity: 100_000,
          period: 'month',
        }],
      }),
      usage: { inputTokens: 250_000 },
    });

    expect(evaluation.estimateLevel).toBe('period_estimate');
    expect(evaluation.diagnostics).toContainEqual(expect.objectContaining({
      code: 'allowance_period_state_missing',
    }));
  });

  it('applies component overlays and post processors separately', () => {
    const evaluation = evaluatePricingPlan({
      plan: basePlan({
        components: [{
          id: 'input',
          label: 'Input',
          role: 'charge',
          kind: 'input_tokens',
          meter: { unit: 'token', quantityPath: 'usage.inputTokens', scale: 1_000_000 },
          price: { currency: 'USD', amount: 10, unitLabel: '1M input tokens' },
        }],
        overlays: [{
          id: 'contract-half-price',
          label: 'Contract half price',
          source: 'user_contract',
          operation: { kind: 'multiply_component', componentId: 'input', factor: 0.5 },
        }],
        postProcessors: [{
          id: 'tax',
          label: 'Tax',
          kind: 'tax',
          factor: 0.1,
        }],
      }),
      usage: { inputTokens: 1_000_000 },
    });

    expect(evaluation.subtotalCostUsd).toBe(5);
    expect(evaluation.adjustmentCostUsd).toBe(0.5);
    expect(evaluation.totalCostUsd).toBe(5.5);
    expect(evaluation.components[0]).toMatchObject({
      overlayIds: ['contract-half-price'],
      unitPriceUsd: 5,
    });
    expect(evaluation.postProcessors).toEqual([
      { id: 'tax', kind: 'tax', amountUsd: 0.5 },
    ]);
  });

  it('applies total multiplier overlays before explicit post processors', () => {
    const evaluation = evaluatePricingPlan({
      plan: basePlan({
        components: [{
          id: 'input',
          label: 'Input',
          role: 'charge',
          kind: 'input_tokens',
          meter: { unit: 'token', quantityPath: 'usage.inputTokens', scale: 1_000_000 },
          price: { currency: 'USD', amount: 10, unitLabel: '1M input tokens' },
        }],
        overlays: [{
          id: 'reseller-markup',
          label: 'Reseller markup',
          source: 'reseller_markup',
          operation: { kind: 'multiply_total', factor: 1.2 },
        }],
        postProcessors: [{
          id: 'tax',
          label: 'Tax',
          kind: 'tax',
          factor: 0.1,
        }],
      }),
      usage: { inputTokens: 1_000_000 },
    });

    expect(evaluation.subtotalCostUsd).toBe(10);
    expect(evaluation.adjustmentCostUsd).toBe(3.2);
    expect(evaluation.totalCostUsd).toBe(13.2);
    expect(evaluation.postProcessors).toEqual([
      { id: 'reseller-markup', kind: 'markup', amountUsd: 2 },
      { id: 'tax', kind: 'tax', amountUsd: 1.2 },
    ]);
  });

  it('uses CEL conditions against normalized pricing context', () => {
    const evaluation = evaluatePricingPlan({
      plan: basePlan({
        components: [
          {
            id: 'batch-input',
            label: 'Batch input',
            role: 'charge',
            kind: 'input_tokens',
            meter: { unit: 'token', quantityPath: 'usage.inputTokens', scale: 1_000_000 },
            price: { currency: 'USD', amount: 2, unitLabel: '1M input tokens' },
            appliesWhen: { cel: 'metadata.billing_mode == "batch" && usage.inputTokens > 0' },
          },
          {
            id: 'live-input',
            label: 'Live input',
            role: 'charge',
            kind: 'input_tokens',
            meter: { unit: 'token', quantityPath: 'usage.inputTokens', scale: 1_000_000 },
            price: { currency: 'USD', amount: 10, unitLabel: '1M input tokens' },
            appliesWhen: { cel: 'metadata.billing_mode != "batch"' },
          },
        ],
      }),
      usage: { inputTokens: 1_000_000 },
      context: { metadata: { billing_mode: 'batch' } },
    });

    expect(evaluation.totalCostUsd).toBe(2);
    expect(evaluation.components).toEqual([
      expect.objectContaining({ componentId: 'batch-input', unitPriceUsd: 2 }),
    ]);
  });

  it('uses CEL formula price expressions as component unit prices', () => {
    const evaluation = evaluatePricingPlan({
      plan: basePlan({
        components: [{
          id: 'input',
          label: 'Input',
          role: 'charge',
          kind: 'input_tokens',
          meter: { unit: 'token', quantityPath: 'usage.inputTokens', scale: 1_000_000 },
          price: {
            currency: 'USD',
            amount: 10,
            unitLabel: '1M input tokens',
            expression: { kind: 'formula', cel: 'unitPriceUsd * metadata.contract_multiplier' },
          },
        }],
      }),
      usage: { inputTokens: 2_000_000 },
      context: { metadata: { contract_multiplier: 0.25 } },
    });

    expect(evaluation.totalCostUsd).toBe(5);
    expect(evaluation.components[0]).toMatchObject({
      unitPriceUsd: 2.5,
      costUsd: 5,
    });
    expect(evaluation.estimateLevel).toBe('exact');
  });

  it('marks CEL formula prices incomplete when they do not return a non-negative number', () => {
    const evaluation = evaluatePricingPlan({
      plan: basePlan({
        components: [{
          id: 'input',
          label: 'Input',
          role: 'charge',
          kind: 'input_tokens',
          meter: { unit: 'token', quantityPath: 'usage.inputTokens', scale: 1_000_000 },
          price: {
            currency: 'USD',
            amount: 10,
            unitLabel: '1M input tokens',
            expression: { kind: 'formula', cel: '"not-a-number"' },
          },
        }],
      }),
      usage: { inputTokens: 1_000_000 },
    });

    expect(evaluation.totalCostUsd).toBe(0);
    expect(evaluation.estimateLevel).toBe('incomplete');
    expect(evaluation.diagnostics).toContainEqual(expect.objectContaining({
      code: 'pricing_cel_formula_invalid',
      severity: 'error',
    }));
  });

  it('applies usage transforms before component pricing', () => {
    const evaluation = evaluatePricingPlan({
      plan: basePlan({
        transforms: [{
          id: 'billable-input',
          kind: 'subtract_usage_fields',
          inputPaths: ['usage.inputTokens', 'usage.cacheReadTokens'],
          outputPath: 'usage.custom.billableInputTokens',
        }],
        components: [{
          id: 'billable-input',
          label: 'Billable input',
          role: 'charge',
          kind: 'custom',
          meter: { unit: 'token', quantityPath: 'usage.custom.billableInputTokens', scale: 1_000_000 },
          price: { currency: 'USD', amount: 10, unitLabel: '1M billable input tokens' },
        }],
      }),
      usage: { inputTokens: 1_000_000, cacheReadTokens: 250_000 },
    });

    expect(evaluation.totalCostUsd).toBe(7.5);
    expect(evaluation.components[0]).toMatchObject({
      componentId: 'billable-input',
      quantity: 750_000,
    });
  });

  it('allows custom CEL transforms to feed later formula pricing metadata', () => {
    const evaluation = evaluatePricingPlan({
      plan: basePlan({
        transforms: [{
          id: 'contract-multiplier',
          kind: 'custom',
          inputPaths: ['usage.inputTokens'],
          outputPath: 'metadata.contract_multiplier',
          cel: 'usage.inputTokens > 1000000 ? 0.5 : 1.0',
        }],
        components: [{
          id: 'input',
          label: 'Input',
          role: 'charge',
          kind: 'input_tokens',
          meter: { unit: 'token', quantityPath: 'usage.inputTokens', scale: 1_000_000 },
          price: {
            currency: 'USD',
            amount: 10,
            unitLabel: '1M input tokens',
            expression: { kind: 'formula', cel: 'unitPriceUsd * metadata.contract_multiplier' },
          },
        }],
      }),
      usage: { inputTokens: 2_000_000 },
    });

    expect(evaluation.totalCostUsd).toBe(10);
    expect(evaluation.components[0]).toMatchObject({
      unitPriceUsd: 5,
      costUsd: 10,
    });
  });

  it('plans pricing CEL expressions once and reuses the compiled expression', () => {
    pricingCelTestUtils.clearCelPlanCache();
    const plan = basePlan({
      components: [{
        id: 'input',
        label: 'Input',
        role: 'charge',
        kind: 'input_tokens',
        meter: { unit: 'token', quantityPath: 'usage.inputTokens', scale: 1_000_000 },
        price: {
          currency: 'USD',
          amount: 10,
          unitLabel: '1M input tokens',
          expression: { kind: 'formula', cel: 'unitPriceUsd * 0.5' },
        },
      }],
    });

    evaluatePricingPlan({ plan, usage: { inputTokens: 1_000_000 } });
    expect(pricingCelTestUtils.celPlanCacheSize()).toBe(1);

    evaluatePricingPlan({ plan, usage: { inputTokens: 2_000_000 } });
    expect(pricingCelTestUtils.celPlanCacheSize()).toBe(1);
  });
});
