import { z } from 'zod';
import type { PricingComponent, PricingOverlay, PricingPlan, PricingTierDimension } from './types.js';

const finiteNumberSchema = z.number().finite();
const nonNegativeNumberSchema = finiteNumberSchema.min(0);
const positiveNumberSchema = finiteNumberSchema.positive();
const idSchema = z.string().trim().min(1);
const metadataSchema = z.record(z.string(), z.unknown());

const priceExpressionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed') }),
  z.object({ kind: z.literal('linear'), multiplier: finiteNumberSchema }),
  z.object({
    kind: z.literal('formula'),
    cel: z.string().trim().min(1).max(2048),
  }),
]);

export const pricingPriceSchema = z.object({
  currency: z.literal('USD'),
  amount: nonNegativeNumberSchema,
  unitLabel: z.string().trim().min(1),
  expression: priceExpressionSchema.optional(),
});

export const pricingMeterSchema = z.object({
  unit: z.enum(['token', 'request', 'second', 'minute', 'image', 'megabyte', 'gigabyte_month', 'custom']),
  quantityPath: z.string().trim().min(1).optional(),
  scale: positiveNumberSchema.optional(),
  missingQuantity: z.enum(['zero', 'diagnostic', 'error']).optional(),
});

const tierDimensionSchema: z.ZodType<PricingTierDimension> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('context_tokens'),
    min: nonNegativeNumberSchema.optional(),
    max: nonNegativeNumberSchema.optional(),
  }),
  z.object({
    kind: z.literal('input_tokens'),
    min: nonNegativeNumberSchema.optional(),
    max: nonNegativeNumberSchema.optional(),
  }),
  z.object({
    kind: z.literal('output_tokens'),
    min: nonNegativeNumberSchema.optional(),
    max: nonNegativeNumberSchema.optional(),
  }),
  z.object({ kind: z.literal('service_tier'), value: z.string().trim().min(1) }),
  z.object({ kind: z.literal('batch'), value: z.boolean() }),
  z.object({ kind: z.literal('modality'), value: z.string().trim().min(1) }),
  z.object({ kind: z.literal('region'), value: z.string().trim().min(1) }),
  z.object({
    kind: z.literal('custom'),
    key: z.string().trim().min(1),
    op: z.enum(['eq', 'lt', 'lte', 'gt', 'gte', 'in']),
    value: z.unknown(),
  }),
]).superRefine((dimension, ctx) => {
  if ('min' in dimension && 'max' in dimension
    && typeof dimension.min === 'number'
    && typeof dimension.max === 'number'
    && dimension.min > dimension.max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Tier dimension min must be less than or equal to max.',
    });
  }
});

export const pricingConditionSchema: z.ZodType<any> = z.lazy(() => z.object({
  all: z.array(pricingConditionSchema).optional(),
  any: z.array(pricingConditionSchema).optional(),
  not: pricingConditionSchema.optional(),
  predicate: tierDimensionSchema.optional(),
  cel: z.string().trim().min(1).max(2048).optional(),
}).superRefine((condition, ctx) => {
  if (!condition.all && !condition.any && !condition.not && !condition.predicate && !condition.cel) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Pricing condition must contain at least one predicate.',
    });
  }
}));

const quantityPriceTierSchema = z.object({
  id: idSchema,
  from: nonNegativeNumberSchema,
  to: nonNegativeNumberSchema.optional(),
  price: pricingPriceSchema,
});

const quantityStepPriceSchema = z.object({
  id: idSchema,
  from: nonNegativeNumberSchema,
  to: nonNegativeNumberSchema.optional(),
  flatPrice: pricingPriceSchema,
});

const quantityPricingSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('flat') }),
  z.object({ mode: z.literal('volume_tier'), tiers: z.array(quantityPriceTierSchema).min(1) }),
  z.object({ mode: z.literal('graduated_tier'), tiers: z.array(quantityPriceTierSchema).min(1) }),
  z.object({ mode: z.literal('stairstep'), steps: z.array(quantityStepPriceSchema).min(1) }),
]);

export const pricingTierSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1),
  dimensions: z.array(tierDimensionSchema).min(1),
});

const pricingComponentBaseSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1),
  role: z.enum(['charge', 'discount', 'credit', 'minimum', 'maximum']),
  kind: z.enum([
    'input_tokens',
    'output_tokens',
    'reasoning_tokens',
    'cache_read_tokens',
    'cache_write_tokens',
    'request',
    'tool_call',
    'image_input',
    'image_output',
    'audio_input',
    'audio_output',
    'video_input',
    'embedding_tokens',
    'storage',
    'custom',
  ]),
  meter: pricingMeterSchema,
  price: pricingPriceSchema,
  quantityPricing: quantityPricingSchema.optional(),
  appliesWhen: pricingConditionSchema.optional(),
  tierRef: idSchema.optional(),
  comparisonKey: z.string().trim().min(1).optional(),
  priority: finiteNumberSchema.optional(),
  metadata: metadataSchema.optional(),
});

export const pricingComponentSchema: z.ZodType<PricingComponent> = pricingComponentBaseSchema.superRefine((component, ctx) => {
  const expression = component.price.expression;
  if (expression?.kind === 'formula') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Formula CEL pricing is not enabled in pricing-core v1.',
      path: ['price', 'expression'],
    });
  }
});

const pricingAllowanceSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1),
  meter: pricingMeterSchema,
  quantity: nonNegativeNumberSchema,
  period: z.enum(['request', 'day', 'month', 'billing_cycle']),
  appliesWhen: pricingConditionSchema.optional(),
  consumeOrder: finiteNumberSchema.optional(),
});

const pricingCommitmentSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1),
  period: z.enum(['month', 'billing_cycle']),
  minimumSpendUsd: nonNegativeNumberSchema.optional(),
  includedComponents: z.array(idSchema).optional(),
  overagePolicy: z.enum(['charge_components', 'cap_at_minimum', 'diagnostic_only']).optional(),
});

const pricingOverlaySchema: z.ZodType<PricingOverlay> = z.object({
  id: idSchema,
  label: z.string().trim().min(1),
  source: z.enum(['user_contract', 'reseller_markup', 'promotion', 'internal_policy']),
  operation: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('replace_component_price'), componentId: idSchema, price: pricingPriceSchema }),
    z.object({ kind: z.literal('multiply_component'), componentId: idSchema, factor: nonNegativeNumberSchema }),
    z.object({ kind: z.literal('multiply_total'), factor: nonNegativeNumberSchema }),
    z.object({ kind: z.literal('add_component'), component: pricingComponentBaseSchema }),
    z.object({ kind: z.literal('disable_component'), componentId: idSchema }),
  ]),
  appliesWhen: pricingConditionSchema.optional(),
  priority: finiteNumberSchema.optional(),
});

const pricingPostProcessorSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1),
  kind: z.enum(['markup', 'discount', 'tax', 'currency_conversion', 'rounding_adjustment']),
  appliesWhen: pricingConditionSchema.optional(),
  amount: finiteNumberSchema.optional(),
  factor: finiteNumberSchema.optional(),
  metadata: metadataSchema.optional(),
});

const pricingTransformSchema = z.object({
  id: idSchema,
  kind: z.enum([
    'copy_usage_field',
    'sum_usage_fields',
    'subtract_usage_fields',
    'cap_quantity',
    'multiply_quantity',
    'custom',
  ]),
  inputPaths: z.array(z.string().trim().min(1)),
  outputPath: z.string().trim().min(1),
  value: z.unknown().optional(),
  cel: z.string().trim().min(1).max(2048).optional(),
}).superRefine((transform, ctx) => {
  if (transform.kind === 'custom' || transform.cel) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Custom/CEL transforms are not enabled in pricing-core v1.',
      path: ['cel'],
    });
  }
});

const pricingPlanBaseSchema = z.object({
  schemaVersion: z.literal(1),
  planKind: z.enum(['rate_card', 'contract_overlay', 'composed']),
  unitPrecision: z.enum(['per_1m', 'per_1k', 'per_unit', 'mixed']),
  billingMode: z.enum(['token', 'request', 'time', 'asset', 'mixed']),
  aggregation: z.object({
    mode: z.literal('sum_components'),
    period: z.enum(['request', 'day', 'month', 'billing_cycle']).optional(),
    minimumChargeUsd: nonNegativeNumberSchema.optional(),
    maximumChargeUsd: nonNegativeNumberSchema.optional(),
  }),
  rounding: z.object({
    mode: z.enum(['none', 'component', 'total']),
    precision: z.number().int().min(0).max(12),
  }),
  components: z.array(pricingComponentSchema).min(1),
  tiers: z.array(pricingTierSchema),
  allowances: z.array(pricingAllowanceSchema).optional(),
  commitments: z.array(pricingCommitmentSchema).optional(),
  overlays: z.array(pricingOverlaySchema).optional(),
  postProcessors: z.array(pricingPostProcessorSchema).optional(),
  transforms: z.array(pricingTransformSchema).optional(),
});

export const pricingPlanSchema: z.ZodType<PricingPlan> = pricingPlanBaseSchema.superRefine((plan, ctx) => {
  const componentIds = new Set<string>();
  for (const [index, component] of plan.components.entries()) {
    if (componentIds.has(component.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate component id: ${component.id}`,
        path: ['components', index, 'id'],
      });
    }
    componentIds.add(component.id);
  }

  const tierIds = new Set(plan.tiers.map((tier) => tier.id));
  for (const [index, component] of plan.components.entries()) {
    if (component.tierRef && !tierIds.has(component.tierRef)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown tier ref: ${component.tierRef}`,
        path: ['components', index, 'tierRef'],
      });
    }
  }

  validateQuantityBands(plan, ctx);
});

function validateQuantityBands(plan: PricingPlan, ctx: z.RefinementCtx): void {
  for (const [componentIndex, component] of plan.components.entries()) {
    const quantityPricing = component.quantityPricing;
    if (!quantityPricing || quantityPricing.mode === 'flat') continue;
    const bands = quantityPricing.mode === 'stairstep' ? quantityPricing.steps : quantityPricing.tiers;
    const sorted = [...bands].sort((a, b) => a.from - b.from);
    for (let i = 0; i < sorted.length; i += 1) {
      const current = sorted[i]!;
      if (current.to !== undefined && current.to < current.from) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Quantity pricing band to must be greater than or equal to from.',
          path: ['components', componentIndex, 'quantityPricing'],
        });
      }
      const next = sorted[i + 1];
      if (next && current.to !== undefined && current.to > next.from) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Quantity pricing bands must not overlap.',
          path: ['components', componentIndex, 'quantityPricing'],
        });
      }
    }
  }
}

export type PricingPlanInput = z.input<typeof pricingPlanSchema>;
export type PricingPlanOutput = z.output<typeof pricingPlanSchema>;

export function parsePricingPlan(input: unknown): { success: true; data: PricingPlanOutput } | { success: false; error: string } {
  const result = pricingPlanSchema.safeParse(input);
  if (!result.success) {
    return {
      success: false,
      error: result.error.issues[0]?.message || 'Invalid pricing plan.',
    };
  }
  return {
    success: true,
    data: result.data,
  };
}
