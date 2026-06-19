import { stableSha256 } from './hash.js';
import { pricingPlanSchema } from './schema.js';
import { hashCanonicalUsage, normalizeCanonicalUsage } from './usage.js';
import type {
  CanonicalUsage,
  PricingAllowance,
  PricingComponent,
  PricingCondition,
  PricingEvaluation,
  PricingEvaluationDiagnostic,
  PricingPeriodState,
  PricingPlan,
  PricingPostProcessor,
  PricingPrice,
  PricingTier,
  PricingTierDimension,
  QuantityPriceTier,
  QuantityPricing,
  QuantityStepPrice,
} from './types.js';

export interface EvaluatePricingPlanInput {
  plan: PricingPlan;
  usage: Partial<CanonicalUsage>;
  catalogEntryId?: string | null;
  source?: PricingEvaluation['source'];
  periodState?: PricingPeriodState | null;
  context?: PricingEvaluationContext;
}

export interface PricingEvaluationContext {
  model?: string;
  provider?: string;
  serviceTier?: string;
  batch?: boolean;
  modality?: string;
  region?: string;
  metadata?: Record<string, unknown>;
}

interface WorkingComponent extends PricingComponent {
  overlayIds?: string[];
}

interface AppliedTotalOverlay {
  id: string;
  factor: number;
}

interface AppliedOverlays {
  components: WorkingComponent[];
  totalOverlays: AppliedTotalOverlay[];
}

interface ComponentQuantity {
  quantity: number;
  missing: boolean;
}

const DEFAULT_SCALE = 1;

export function evaluatePricingPlan(input: EvaluatePricingPlanInput): PricingEvaluation {
  const diagnostics: PricingEvaluationDiagnostic[] = [];
  const parsed = pricingPlanSchema.safeParse(input.plan);
  if (!parsed.success) {
    return invalidEvaluation(input, parsed.error.issues[0]?.message || 'Invalid pricing plan.');
  }

  const plan = parsed.data as PricingPlan;
  const usage = normalizeCanonicalUsage(input.usage);
  const planFingerprint = stableSha256(plan);
  const usageHash = hashCanonicalUsage(usage);
  const context = input.context || {};
  const activeTierIds = selectActiveTierIds(plan.tiers, usage, context);
  const periodState = input.periodState || null;

  let estimateLevel: PricingEvaluation['estimateLevel'] = 'exact';
  if (plan.aggregation.period && plan.aggregation.period !== 'request' && !periodState) {
    estimateLevel = 'period_estimate';
    diagnostics.push({
      code: 'period_state_missing',
      severity: 'info',
      message: `Plan aggregation period ${plan.aggregation.period} requires period state for exact evaluation.`,
    });
  }

  const appliedOverlays = applyOverlays(plan, usage, context, diagnostics);
  const components = appliedOverlays.components;
  const allowanceState = buildAllowanceState(plan.allowances || [], usage, context, periodState, diagnostics, (level) => {
    estimateLevel = mergeEstimateLevel(estimateLevel, level);
  });

  const evaluatedComponents: PricingEvaluation['components'] = [];
  for (const component of components) {
    if (!componentMatches(component, activeTierIds, usage, context)) continue;
    const quantityInfo = readComponentQuantity(component, usage, diagnostics);
    if (quantityInfo.missing && component.meter.missingQuantity === 'error') {
      estimateLevel = 'incomplete';
      continue;
    }

    const allowanceApplied = consumeAllowance(component, quantityInfo.quantity, allowanceState);
    const billableQuantity = Math.max(0, quantityInfo.quantity - allowanceApplied);
    const scale = component.meter.scale || DEFAULT_SCALE;
    const priced = evaluateComponentCost(component, billableQuantity, scale);
    const signedCost = applyRole(component.role, priced.costUsd);

    evaluatedComponents.push({
      componentId: component.id,
      kind: component.kind,
      quantity: billableQuantity,
      scale,
      unitPriceUsd: priced.unitPriceUsd,
      costUsd: roundMoney(signedCost, plan.rounding.mode === 'component' ? plan.rounding.precision : 12),
      role: component.role,
      ...(component.tierRef ? { tierId: component.tierRef } : {}),
      quantityPricingMode: component.quantityPricing?.mode || 'flat',
      ...(allowanceApplied > 0 ? { allowanceApplied } : {}),
      ...(component.overlayIds && component.overlayIds.length > 0 ? { overlayIds: component.overlayIds } : {}),
    });
  }

  const componentSubtotal = evaluatedComponents.reduce((sum, component) => sum + component.costUsd, 0);
  const minimumMaximumAdjusted = applyComponentMinimumMaximum(plan, evaluatedComponents, componentSubtotal);
  let subtotalCostUsd = minimumMaximumAdjusted;
  if (plan.aggregation.minimumChargeUsd !== undefined) {
    subtotalCostUsd = Math.max(subtotalCostUsd, plan.aggregation.minimumChargeUsd);
  }
  if (plan.aggregation.maximumChargeUsd !== undefined) {
    subtotalCostUsd = Math.min(subtotalCostUsd, plan.aggregation.maximumChargeUsd);
  }

  const commitmentAdjusted = applyCommitments(plan, subtotalCostUsd, periodState, diagnostics, (level) => {
    estimateLevel = mergeEstimateLevel(estimateLevel, level);
  });
  subtotalCostUsd = commitmentAdjusted;

  const overlayProcessors = appliedOverlays.totalOverlays.map((overlay) => ({
    id: overlay.id,
    kind: 'markup' as const,
    amountUsd: roundMoney(subtotalCostUsd * overlay.factor - subtotalCostUsd, 12),
  }));
  const postProcessors = [
    ...overlayProcessors,
    ...applyPostProcessors(plan.postProcessors || [], subtotalCostUsd + overlayProcessors.reduce((sum, item) => sum + item.amountUsd, 0), usage, context),
  ];
  const adjustmentCostUsd = postProcessors.reduce((sum, item) => sum + item.amountUsd, 0);
  const totalBeforeRounding = subtotalCostUsd + adjustmentCostUsd;
  const totalCostUsd = roundMoney(Math.max(0, totalBeforeRounding), plan.rounding.mode === 'total' ? plan.rounding.precision : 12);

  return {
    catalogEntryId: input.catalogEntryId ?? null,
    source: input.source || 'reference',
    usageHash,
    planFingerprint,
    totalCostUsd,
    subtotalCostUsd: roundMoney(Math.max(0, subtotalCostUsd), 12),
    adjustmentCostUsd: roundMoney(adjustmentCostUsd, 12),
    estimateLevel,
    components: evaluatedComponents,
    ...(postProcessors.length > 0 ? { postProcessors } : {}),
    equivalentMultipliers: buildEquivalentMultipliers(evaluatedComponents),
    diagnostics,
  };
}

function invalidEvaluation(input: EvaluatePricingPlanInput, message: string): PricingEvaluation {
  const usage = normalizeCanonicalUsage(input.usage);
  return {
    catalogEntryId: input.catalogEntryId ?? null,
    source: input.source || 'reference',
    usageHash: hashCanonicalUsage(usage),
    planFingerprint: stableSha256(input.plan),
    totalCostUsd: 0,
    subtotalCostUsd: 0,
    adjustmentCostUsd: 0,
    estimateLevel: 'incomplete',
    components: [],
    equivalentMultipliers: {},
    diagnostics: [{
      code: 'invalid_pricing_plan',
      severity: 'error',
      message,
    }],
  };
}

function applyOverlays(
  plan: PricingPlan,
  usage: CanonicalUsage,
  context: PricingEvaluationContext,
  diagnostics: PricingEvaluationDiagnostic[],
): AppliedOverlays {
  const components = new Map<string, WorkingComponent>();
  const totalOverlays: AppliedTotalOverlay[] = [];
  for (const component of plan.components) {
    components.set(component.id, { ...component });
  }

  const overlays = [...(plan.overlays || [])].sort((a, b) => (a.priority || 0) - (b.priority || 0));
  for (const overlay of overlays) {
    if (overlay.appliesWhen && !conditionMatches(overlay.appliesWhen, usage, context)) continue;
    const operation = overlay.operation;
    if (operation.kind === 'add_component') {
      components.set(operation.component.id, {
        ...operation.component,
        overlayIds: [overlay.id],
      } as WorkingComponent);
      continue;
    }
    if (operation.kind === 'multiply_total') {
      totalOverlays.push({
        id: overlay.id,
        factor: operation.factor,
      });
      continue;
    }
    const component = components.get(operation.componentId);
    if (!component) {
      diagnostics.push({
        code: 'overlay_component_missing',
        severity: 'warning',
        message: `Overlay ${overlay.id} references missing component ${operation.componentId}.`,
      });
      continue;
    }
    if (operation.kind === 'disable_component') {
      components.delete(operation.componentId);
      continue;
    }
    if (operation.kind === 'replace_component_price') {
      components.set(operation.componentId, {
        ...component,
        price: operation.price,
        overlayIds: [...(component.overlayIds || []), overlay.id],
      });
      continue;
    }
    if (operation.kind === 'multiply_component') {
      components.set(operation.componentId, {
        ...component,
        price: {
          ...component.price,
          amount: component.price.amount * operation.factor,
        },
        overlayIds: [...(component.overlayIds || []), overlay.id],
      });
    }
  }

  return {
    components: Array.from(components.values()),
    totalOverlays,
  };
}

function selectActiveTierIds(
  tiers: PricingTier[],
  usage: CanonicalUsage,
  context: PricingEvaluationContext,
): Set<string> {
  const active = new Set<string>();
  for (const tier of tiers) {
    if (tier.dimensions.every((dimension) => dimensionMatches(dimension, usage, context))) {
      active.add(tier.id);
    }
  }
  return active;
}

function componentMatches(
  component: PricingComponent,
  activeTierIds: Set<string>,
  usage: CanonicalUsage,
  context: PricingEvaluationContext,
): boolean {
  if (component.tierRef && !activeTierIds.has(component.tierRef)) return false;
  if (component.appliesWhen && !conditionMatches(component.appliesWhen, usage, context)) return false;
  return true;
}

function conditionMatches(
  condition: PricingCondition,
  usage: CanonicalUsage,
  context: PricingEvaluationContext,
): boolean {
  if (condition.all && !condition.all.every((item) => conditionMatches(item, usage, context))) return false;
  if (condition.any && !condition.any.some((item) => conditionMatches(item, usage, context))) return false;
  if (condition.not && conditionMatches(condition.not, usage, context)) return false;
  if (condition.predicate && !dimensionMatches(condition.predicate, usage, context)) return false;
  if (condition.cel) return false;
  return true;
}

function dimensionMatches(
  dimension: PricingTierDimension,
  usage: CanonicalUsage,
  context: PricingEvaluationContext,
): boolean {
  if (dimension.kind === 'context_tokens') {
    return inRange(usage.totalTokens || usage.inputTokens + usage.outputTokens, dimension.min, dimension.max);
  }
  if (dimension.kind === 'input_tokens') {
    return inRange(usage.inputTokens, dimension.min, dimension.max);
  }
  if (dimension.kind === 'output_tokens') {
    return inRange(usage.outputTokens, dimension.min, dimension.max);
  }
  if (dimension.kind === 'service_tier') return context.serviceTier === dimension.value;
  if (dimension.kind === 'batch') return Boolean(context.batch) === dimension.value;
  if (dimension.kind === 'modality') return context.modality === dimension.value;
  if (dimension.kind === 'region') return context.region === dimension.value;
  if (dimension.kind === 'custom') {
    const value = context.metadata?.[dimension.key] ?? usage.custom[dimension.key];
    return compareCustomValue(value, dimension.op, dimension.value);
  }
  return false;
}

function compareCustomValue(
  actual: unknown,
  op: Extract<PricingTierDimension, { kind: 'custom' }>['op'],
  expected: unknown,
): boolean {
  if (op === 'eq') return actual === expected;
  if (op === 'in') return Array.isArray(expected) && expected.includes(actual);
  const numericActual = Number(actual);
  const numericExpected = Number(expected);
  if (!Number.isFinite(numericActual) || !Number.isFinite(numericExpected)) return false;
  if (op === 'lt') return numericActual < numericExpected;
  if (op === 'lte') return numericActual <= numericExpected;
  if (op === 'gt') return numericActual > numericExpected;
  if (op === 'gte') return numericActual >= numericExpected;
  return false;
}

function inRange(value: number, min?: number, max?: number): boolean {
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

function readComponentQuantity(
  component: PricingComponent,
  usage: CanonicalUsage,
  diagnostics: PricingEvaluationDiagnostic[],
): ComponentQuantity {
  const path = component.meter.quantityPath || defaultQuantityPath(component.kind);
  const value = readPath({ usage }, path);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    const missingPolicy = component.meter.missingQuantity || 'diagnostic';
    if (missingPolicy !== 'zero') {
      diagnostics.push({
        code: missingPolicy === 'error' ? 'required_quantity_missing' : 'quantity_missing',
        severity: missingPolicy === 'error' ? 'error' : 'info',
        message: `Missing quantity for component ${component.id}.`,
        path,
      });
    }
    return { quantity: 0, missing: true };
  }
  return { quantity: Math.max(0, value), missing: false };
}

function defaultQuantityPath(kind: PricingComponent['kind']): string {
  switch (kind) {
    case 'input_tokens':
      return 'usage.inputTokens';
    case 'output_tokens':
      return 'usage.outputTokens';
    case 'reasoning_tokens':
      return 'usage.reasoningTokens';
    case 'cache_read_tokens':
      return 'usage.cacheReadTokens';
    case 'cache_write_tokens':
      return 'usage.cacheWriteTokens';
    case 'request':
      return 'usage.requestCount';
    case 'image_input':
      return 'usage.imageInputUnits';
    case 'image_output':
      return 'usage.imageOutputUnits';
    case 'audio_input':
      return 'usage.audioInputSeconds';
    case 'audio_output':
      return 'usage.audioOutputSeconds';
    case 'video_input':
      return 'usage.videoInputSeconds';
    case 'storage':
      return 'usage.storageMegabyteMonths';
    default:
      return `usage.custom.${kind}`;
  }
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let current: unknown = source;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function buildAllowanceState(
  allowances: PricingAllowance[],
  usage: CanonicalUsage,
  context: PricingEvaluationContext,
  periodState: PricingPeriodState | null,
  diagnostics: PricingEvaluationDiagnostic[],
  updateEstimateLevel: (level: PricingEvaluation['estimateLevel']) => void,
): Map<string, Array<{ id: string; remaining: number; consumeOrder: number }>> {
  const state = new Map<string, Array<{ id: string; remaining: number; consumeOrder: number }>>();
  for (const allowance of allowances) {
    if (allowance.appliesWhen && !conditionMatches(allowance.appliesWhen, usage, context)) continue;
    if (allowance.period !== 'request' && !periodState) {
      diagnostics.push({
        code: 'allowance_period_state_missing',
        severity: 'info',
        message: `Allowance ${allowance.id} requires ${allowance.period} state for exact evaluation.`,
      });
      updateEstimateLevel('period_estimate');
    }
    const key = allowanceKey(allowance.meter);
    const consumed = periodState?.consumedAllowances?.[allowance.id] || 0;
    const remaining = Math.max(0, allowance.quantity - consumed);
    const entries = state.get(key) || [];
    entries.push({
      id: allowance.id,
      remaining,
      consumeOrder: allowance.consumeOrder || 0,
    });
    entries.sort((a, b) => a.consumeOrder - b.consumeOrder);
    state.set(key, entries);
  }
  return state;
}

function consumeAllowance(
  component: PricingComponent,
  quantity: number,
  allowanceState: Map<string, Array<{ id: string; remaining: number }>>,
): number {
  const key = allowanceKey(component.meter);
  const entries = allowanceState.get(key);
  if (!entries || entries.length === 0) return 0;
  let remainingQuantity = quantity;
  let applied = 0;
  for (const entry of entries) {
    if (remainingQuantity <= 0) break;
    const consume = Math.min(entry.remaining, remainingQuantity);
    entry.remaining -= consume;
    remainingQuantity -= consume;
    applied += consume;
  }
  return applied;
}

function allowanceKey(meter: PricingComponent['meter']): string {
  return `${meter.unit}:${meter.quantityPath || ''}:${meter.scale || DEFAULT_SCALE}`;
}

function evaluateComponentCost(
  component: PricingComponent,
  quantity: number,
  scale: number,
): { costUsd: number; unitPriceUsd: number } {
  const quantityPricing = component.quantityPricing || { mode: 'flat' as const };
  if (quantityPricing.mode === 'flat') {
    return {
      costUsd: (quantity / scale) * component.price.amount,
      unitPriceUsd: component.price.amount,
    };
  }
  if (quantityPricing.mode === 'volume_tier') {
    const tier = findQuantityTier(quantityPricing.tiers, quantity);
    const price = tier?.price || component.price;
    return {
      costUsd: (quantity / scale) * price.amount,
      unitPriceUsd: price.amount,
    };
  }
  if (quantityPricing.mode === 'graduated_tier') {
    const costUsd = evaluateGraduatedCost(quantityPricing.tiers, quantity, scale);
    return {
      costUsd,
      unitPriceUsd: quantity > 0 ? (costUsd / quantity) * scale : 0,
    };
  }
  const step = findQuantityStep(quantityPricing.steps, quantity);
  const flatPrice = step?.flatPrice || component.price;
  return {
    costUsd: flatPrice.amount,
    unitPriceUsd: quantity > 0 ? (flatPrice.amount / quantity) * scale : flatPrice.amount,
  };
}

function findQuantityTier(tiers: QuantityPriceTier[], quantity: number): QuantityPriceTier | null {
  return [...tiers]
    .sort((a, b) => a.from - b.from)
    .find((tier) => quantity >= tier.from && (tier.to === undefined || quantity <= tier.to)) || null;
}

function findQuantityStep(steps: QuantityStepPrice[], quantity: number): QuantityStepPrice | null {
  return [...steps]
    .sort((a, b) => a.from - b.from)
    .find((step) => quantity >= step.from && (step.to === undefined || quantity <= step.to)) || null;
}

function evaluateGraduatedCost(tiers: QuantityPriceTier[], quantity: number, scale: number): number {
  let total = 0;
  for (const tier of [...tiers].sort((a, b) => a.from - b.from)) {
    if (quantity <= tier.from) continue;
    const upper = tier.to === undefined ? quantity : Math.min(quantity, tier.to);
    const bandQuantity = Math.max(0, upper - tier.from);
    total += (bandQuantity / scale) * tier.price.amount;
  }
  return total;
}

function applyRole(role: PricingComponent['role'], cost: number): number {
  if (role === 'discount' || role === 'credit') return -Math.abs(cost);
  return cost;
}

function applyComponentMinimumMaximum(
  plan: PricingPlan,
  components: PricingEvaluation['components'],
  subtotal: number,
): number {
  let total = subtotal;
  for (const component of components) {
    if (component.role === 'minimum') {
      total = Math.max(total, Math.abs(component.costUsd));
    } else if (component.role === 'maximum') {
      total = Math.min(total, Math.abs(component.costUsd));
    }
  }
  if (plan.aggregation.mode !== 'sum_components') return total;
  return total;
}

function applyCommitments(
  plan: PricingPlan,
  subtotal: number,
  periodState: PricingPeriodState | null,
  diagnostics: PricingEvaluationDiagnostic[],
  updateEstimateLevel: (level: PricingEvaluation['estimateLevel']) => void,
): number {
  let total = subtotal;
  for (const commitment of plan.commitments || []) {
    if (!periodState) {
      diagnostics.push({
        code: 'commitment_period_state_missing',
        severity: 'info',
        message: `Commitment ${commitment.id} requires period state for exact evaluation.`,
      });
      updateEstimateLevel('period_estimate');
      continue;
    }
    if (commitment.minimumSpendUsd !== undefined) {
      total = Math.max(total, commitment.minimumSpendUsd - (periodState.committedSpendUsd || 0));
    }
  }
  return total;
}

function applyPostProcessors(
  postProcessors: PricingPostProcessor[],
  subtotal: number,
  usage: CanonicalUsage,
  context: PricingEvaluationContext,
): NonNullable<PricingEvaluation['postProcessors']> {
  const result: NonNullable<PricingEvaluation['postProcessors']> = [];
  for (const processor of postProcessors) {
    if (processor.appliesWhen && !conditionMatches(processor.appliesWhen, usage, context)) continue;
    let amountUsd = processor.amount || 0;
    if (processor.factor !== undefined) {
      amountUsd += subtotal * processor.factor;
    }
    if (processor.kind === 'discount') {
      amountUsd = -Math.abs(amountUsd);
    }
    result.push({
      id: processor.id,
      kind: processor.kind,
      amountUsd: roundMoney(amountUsd, 12),
    });
  }
  return result;
}

function mergeEstimateLevel(
  current: PricingEvaluation['estimateLevel'],
  next: PricingEvaluation['estimateLevel'],
): PricingEvaluation['estimateLevel'] {
  const order: PricingEvaluation['estimateLevel'][] = ['exact', 'request_estimate', 'period_estimate', 'incomplete'];
  return order[Math.max(order.indexOf(current), order.indexOf(next))] || current;
}

function roundMoney(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function buildEquivalentMultipliers(
  components: PricingEvaluation['components'],
): PricingEvaluation['equivalentMultipliers'] {
  const byKind = new Map(components.map((component) => [component.kind, component]));
  return {
    input: byKind.get('input_tokens')?.unitPriceUsd ?? null,
    output: byKind.get('output_tokens')?.unitPriceUsd ?? null,
    cacheRead: byKind.get('cache_read_tokens')?.unitPriceUsd ?? null,
    cacheWrite: byKind.get('cache_write_tokens')?.unitPriceUsd ?? null,
  };
}
