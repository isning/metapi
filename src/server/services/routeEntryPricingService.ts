import type {
  CompiledExecutionAlternative,
  CompiledRouterBundle,
  CompiledRouterPlan,
  CompiledEndpointTarget,
  RouteProgramSourceRef,
} from '../../shared/compiledRuntime.js';
import {
  getCompiledExecutionAttemptId,
  getCompiledExecutionTargetId,
  getCompiledRouterPlanById,
} from '../../shared/compiledRuntime.js';
import {
  matchesModelPattern,
  parseModelRegexPattern,
} from '../../shared/modelPatternMatcher.js';
import type {
  CanonicalUsage,
  PricingComponentKind,
  PricingEvaluation,
} from '../pricing-core/index.js';
import { comparePricingSummaries } from './pricingComparisonService.js';
import { quoteEndpointPricing, quoteReferencePricing, type EffectiveCostQuote, type PricingQuoteComparison, type PricingResolution } from './pricingQuoteService.js';
import type { PricingQuoteDiagnostic, PricingResolutionSummary } from './pricingQuoteTypes.js';
import type { CompiledRuntimeProjection } from './compiledRuntimeProjectionService.js';
import { estimateCompiledRuntimeAlternativeProbabilities } from './compiledRuntimeProbabilityService.js';

export type EntryPricingEstimateLevel = 'exact' | 'static_estimate' | 'incomplete';
export type EntryPricingSelectionMode = 'weighted' | 'ordered' | 'round_robin' | 'direct' | 'mixed' | null;

export type EntryPricingUsage = Partial<CanonicalUsage>;

export type EntryPricingComponentKind = Extract<
  PricingComponentKind,
  | 'input_tokens'
  | 'output_tokens'
  | 'cache_read_tokens'
  | 'cache_write_tokens'
  | 'reasoning_tokens'
  | 'request'
  | 'tool_call'
  | 'image_input'
  | 'image_output'
  | 'audio_input'
  | 'audio_output'
  | 'video_input'
  | 'embedding_tokens'
  | 'storage'
  | 'custom'
>;

export type EntryPricingComponentBreakdown = Omit<PricingEvaluation['components'][number], 'kind' | 'currency' | 'unitPrice' | 'cost'> & {
  kind: EntryPricingComponentKind;
  currency: string | null;
  unitPrice: number | null;
  cost: number | null;
};

export type EntryPricingExecutionAttempt = {
  executionAttemptId: string;
  endpointId: string;
  nodeId: string | null;
  siteId: number | null;
  accountId: number | null;
  tokenId: number | null;
  modelName: string;
  probability: number | null;
  weight: number | null;
  currency: string | null;
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cacheReadPerMillion: number | null;
  cacheWritePerMillion: number | null;
  reasoningPerMillion: number | null;
  requestCost: number | null;
  totalCost: number | null;
  components: EntryPricingComponentBreakdown[];
  usage: EntryPricingUsage;
  resolution: PricingResolution | null;
  reference: PricingResolution | null;
  effectiveCost: EffectiveCostQuote | null;
  comparison: PricingQuoteComparison;
  quoteDiagnostics: PricingQuoteDiagnostic[];
  pricingId: number | null;
  matchedScope: string | null;
  sourceRef: RouteProgramSourceRef;
};

export type EntryEffectiveCostEstimate = {
  walletCostBaseCurrency: number | null;
  baseCostUnit: string | null;
  freeQuotaDaysCost: number | null;
  balanceBurn: Array<{ unit: string; amount: number }>;
  estimateLevel: EntryPricingEstimateLevel;
  diagnostics: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
};

export type EntryPricingEstimate = {
  currency: string | null;
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cacheReadPerMillion: number | null;
  cacheWritePerMillion: number | null;
  reasoningPerMillion: number | null;
  requestCost: number | null;
  totalCost: number | null;
  inputMultiplier: number | null;
  outputMultiplier: number | null;
  totalMultiplier: number | null;
  components: EntryPricingComponentBreakdown[];
  usage: EntryPricingUsage;
  effectiveCost: EntryEffectiveCostEstimate | null;
  reference: PricingResolutionSummary | null;
  referenceResolution: PricingResolution | null;
  comparison: PricingQuoteComparison;
  sourceCount: number;
  estimateLevel: EntryPricingEstimateLevel;
  selectionMode: EntryPricingSelectionMode;
  diagnostics: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
  executionAttempts: EntryPricingExecutionAttempt[];
};

type RuntimeExecutionAttemptPricingSource = CompiledRuntimeProjection['executionAttempts'][number];

const ENTRY_PRICING_COMPONENT_KINDS = new Set<EntryPricingComponentKind>([
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'reasoning_tokens',
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
]);

const ENTRY_PRICING_SUMMARY_KEYS = [
  'inputPerMillion',
  'outputPerMillion',
  'cacheReadPerMillion',
  'cacheWritePerMillion',
  'reasoningPerMillion',
  'requestCost',
  'totalCost',
] as const;

type EntryPricingSummaryKey = typeof ENTRY_PRICING_SUMMARY_KEYS[number];

type WeightedNumber = {
  weighted: number;
  weight: number;
};

type ComponentAccumulator = {
  componentId: string;
  kind: EntryPricingComponentKind;
  currencies: Set<string>;
  quantity: WeightedNumber;
  scale: WeightedNumber;
  unitPrice: WeightedNumber;
  cost: WeightedNumber;
  role: PricingEvaluation['components'][number]['role'];
  tierId?: string;
  quantityPricingMode?: PricingEvaluation['components'][number]['quantityPricingMode'];
  allowanceApplied: WeightedNumber;
  overlayIds: Set<string>;
};

export type EntryPricingProbabilityOverride = {
  executionAttemptId: string | number | null | undefined;
  probability: number | null | undefined;
};

type WeightedTarget = {
  target: CompiledEndpointTarget;
  endpointId: string;
  nodeId: string | null;
  sourceRef: RouteProgramSourceRef;
  executionAttemptId: string;
  probability: number | null;
  weight: number | null;
  incomplete: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function asFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function executionTargetIdForCompiledTarget(target: CompiledEndpointTarget): number | null {
  return getCompiledExecutionTargetId(target);
}

function executionAttemptIdForCompiledTarget(target: CompiledEndpointTarget): string | null {
  return getCompiledExecutionAttemptId(target);
}

function roundPrice(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 1_000_000) / 1_000_000;
}

function emptyEntryPricingSummary(): Pick<EntryPricingEstimate, EntryPricingSummaryKey> {
  return {
    inputPerMillion: null,
    outputPerMillion: null,
    cacheReadPerMillion: null,
    cacheWritePerMillion: null,
    reasoningPerMillion: null,
    requestCost: null,
    totalCost: null,
  };
}

function currencyFromPricingResolution(resolution: PricingResolution | null): string | null {
  return resolution?.summary.currency || resolution?.evaluation?.currency || null;
}

function emptyPricingComparison(): PricingQuoteComparison {
  return {
    inputMultiplier: null,
    outputMultiplier: null,
    totalMultiplier: null,
  };
}

function summaryFromPricingResolution(
  resolution: PricingResolution | null,
): Pick<EntryPricingEstimate, EntryPricingSummaryKey> {
  if (!resolution) return emptyEntryPricingSummary();
  return {
    inputPerMillion: resolution.summary.inputPerMillion ?? null,
    outputPerMillion: resolution.summary.outputPerMillion ?? null,
    cacheReadPerMillion: resolution.summary.cacheReadPerMillion ?? null,
    cacheWritePerMillion: resolution.summary.cacheWritePerMillion ?? null,
    reasoningPerMillion: resolution.summary.reasoningPerMillion ?? null,
    requestCost: resolution.summary.requestCost ?? null,
    totalCost: resolution.summary.totalCost ?? null,
  };
}

function hasConcreteEntryPricing(
  attempt: Pick<EntryPricingExecutionAttempt, EntryPricingSummaryKey> & { components?: EntryPricingComponentBreakdown[] },
): boolean {
  return ENTRY_PRICING_SUMMARY_KEYS.some((key) => attempt[key] != null)
    || (attempt.components || []).some((component) => component.cost != null || component.unitPrice != null);
}

function normalizeEntryPricingUsage(usage: EntryPricingUsage | null | undefined): EntryPricingUsage {
  if (!usage) return {};
  const normalized: EntryPricingUsage = {};
  for (const key of [
    'inputTokens',
    'outputTokens',
    'reasoningTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'totalTokens',
    'requestCount',
    'imageInputUnits',
    'imageOutputUnits',
    'audioInputSeconds',
    'audioOutputSeconds',
    'videoInputSeconds',
    'storageMegabyteMonths',
  ] as const) {
    const value = usage[key];
    const parsed = typeof value === 'number' ? value : Number(value ?? NaN);
    if (Number.isFinite(parsed) && parsed >= 0) {
      normalized[key] = parsed;
    }
  }
  if (usage.custom && typeof usage.custom === 'object' && !Array.isArray(usage.custom)) {
    const custom: Record<string, number> = {};
    for (const [key, value] of Object.entries(usage.custom)) {
      const parsed = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) custom[key] = parsed;
    }
    if (Object.keys(custom).length > 0) normalized.custom = custom;
  }
  return normalized;
}

function entryPricingComponentsFromResolution(
  resolution: PricingResolution | null,
): EntryPricingComponentBreakdown[] {
  const components = resolution?.evaluation?.components || [];
  return components
    .filter((component): component is PricingEvaluation['components'][number] & { kind: EntryPricingComponentKind } => (
      ENTRY_PRICING_COMPONENT_KINDS.has(component.kind as EntryPricingComponentKind)
    ))
    .map((component) => ({
      componentId: component.componentId,
      kind: component.kind,
      currency: component.currency || null,
      quantity: roundPrice(component.quantity) ?? component.quantity,
      scale: roundPrice(component.scale) ?? component.scale,
      unitPrice: roundPrice(component.unitPrice),
      cost: roundPrice(component.cost),
      role: component.role,
      ...(component.tierId ? { tierId: component.tierId } : {}),
      ...(component.quantityPricingMode ? { quantityPricingMode: component.quantityPricingMode } : {}),
      ...(component.allowanceApplied != null ? { allowanceApplied: roundPrice(component.allowanceApplied) ?? component.allowanceApplied } : {}),
      ...(component.overlayIds ? { overlayIds: component.overlayIds } : {}),
    }));
}

function emptyWeightedNumber(): WeightedNumber {
  return { weighted: 0, weight: 0 };
}

function createPricingAggregate() {
  const fields = Object.fromEntries(
    ENTRY_PRICING_SUMMARY_KEYS.map((key) => [key, emptyWeightedNumber()]),
  ) as Record<EntryPricingSummaryKey, WeightedNumber>;
  const components = new Map<string, ComponentAccumulator>();

  function componentAccumulator(component: EntryPricingComponentBreakdown): ComponentAccumulator {
    const key = [
      component.componentId,
      component.kind,
      component.role,
      component.tierId || '',
      component.quantityPricingMode || '',
    ].join('|');
    const existing = components.get(key);
    if (existing) return existing;
    const created: ComponentAccumulator = {
      componentId: component.componentId,
      kind: component.kind,
      currencies: new Set(component.currency ? [component.currency] : []),
      quantity: emptyWeightedNumber(),
      scale: emptyWeightedNumber(),
      unitPrice: emptyWeightedNumber(),
      cost: emptyWeightedNumber(),
      role: component.role,
      tierId: component.tierId,
      quantityPricingMode: component.quantityPricingMode,
      allowanceApplied: emptyWeightedNumber(),
      overlayIds: new Set(component.overlayIds || []),
    };
    components.set(key, created);
    return created;
  }

  function addWeighted(target: WeightedNumber, value: number | null | undefined, probability: number) {
    if (value == null || !Number.isFinite(value)) return;
    target.weighted += value * probability;
    target.weight += probability;
  }

  return {
    fields,
    components,
    add(attempt: EntryPricingExecutionAttempt, probability: number | null | undefined) {
      if (probability == null || !Number.isFinite(probability)) return;
      for (const key of ENTRY_PRICING_SUMMARY_KEYS) {
        addWeighted(fields[key], attempt[key], probability);
      }
      for (const component of attempt.components || []) {
        const accumulator = componentAccumulator(component);
        addWeighted(accumulator.quantity, component.quantity, probability);
        addWeighted(accumulator.scale, component.scale, probability);
        addWeighted(accumulator.unitPrice, component.unitPrice, probability);
        addWeighted(accumulator.cost, component.cost, probability);
        addWeighted(accumulator.allowanceApplied, component.allowanceApplied, probability);
        for (const overlayId of component.overlayIds || []) accumulator.overlayIds.add(overlayId);
        if (component.currency) accumulator.currencies.add(component.currency);
      }
    },
    hasMissing(): boolean {
      if (ENTRY_PRICING_SUMMARY_KEYS.some((key) => fields[key].weight <= 0)) return true;
      for (const component of components.values()) {
        if (component.cost.weight <= 0 || component.unitPrice.weight <= 0) return true;
      }
      return false;
    },
    summary(): Pick<EntryPricingEstimate, EntryPricingSummaryKey> {
      return Object.fromEntries(
        ENTRY_PRICING_SUMMARY_KEYS.map((key) => [
          key,
          fields[key].weight > 0
            ? roundPrice(key === 'totalCost' ? fields[key].weighted : fields[key].weighted / fields[key].weight)
            : null,
        ]),
      ) as Pick<EntryPricingEstimate, EntryPricingSummaryKey>;
    },
    componentBreakdown(): EntryPricingComponentBreakdown[] {
      return [...components.values()]
        .map((component) => ({
          componentId: component.componentId,
          kind: component.kind,
          currency: component.currencies.size === 1 ? [...component.currencies][0]! : null,
          quantity: component.quantity.weight > 0 ? (roundPrice(component.quantity.weighted / component.quantity.weight) ?? 0) : 0,
          scale: component.scale.weight > 0 ? (roundPrice(component.scale.weighted / component.scale.weight) ?? 1) : 1,
          unitPrice: component.unitPrice.weight > 0 ? roundPrice(component.unitPrice.weighted / component.unitPrice.weight) : null,
          cost: component.cost.weight > 0 ? roundPrice(component.cost.weighted) : null,
          role: component.role,
          ...(component.tierId ? { tierId: component.tierId } : {}),
          ...(component.quantityPricingMode ? { quantityPricingMode: component.quantityPricingMode } : {}),
          ...(component.allowanceApplied.weight > 0
            ? { allowanceApplied: roundPrice(component.allowanceApplied.weighted / component.allowanceApplied.weight) ?? 0 }
            : {}),
          ...(component.overlayIds.size > 0 ? { overlayIds: [...component.overlayIds].sort() } : {}),
        }))
        .sort((a, b) => {
          const order = [...ENTRY_PRICING_COMPONENT_KINDS];
          return order.indexOf(a.kind) - order.indexOf(b.kind);
        });
    },
  };
}

function mergeEstimateLevel(
  current: EntryPricingEstimateLevel,
  next: EffectiveCostQuote['estimateLevel'] | EntryPricingEstimateLevel,
): EntryPricingEstimateLevel {
  if (current === 'incomplete' || next === 'incomplete') return 'incomplete';
  if (current === 'static_estimate' || next === 'estimated') return 'static_estimate';
  return 'exact';
}

function aggregateBalanceBurn(
  buckets: Array<{ unit: string; amount: number }>,
): Array<{ unit: string; amount: number }> {
  const byUnit = new Map<string, number>();
  for (const bucket of buckets) {
    const unit = String(bucket.unit || '').trim().toUpperCase();
    const amount = Number(bucket.amount);
    if (!unit || !Number.isFinite(amount)) continue;
    byUnit.set(unit, (byUnit.get(unit) || 0) + amount);
  }
  return [...byUnit.entries()]
    .map(([unit, amount]) => ({ unit, amount: roundPrice(amount) ?? amount }))
    .sort((a, b) => a.unit.localeCompare(b.unit));
}

function aggregateEffectiveCost(
  executionAttempts: EntryPricingExecutionAttempt[],
): EntryEffectiveCostEstimate | null {
  let weightedWallet = 0;
  let walletWeight = 0;
  let weightedFreeDays = 0;
  let freeDaysWeight = 0;
  let estimateLevel: EntryPricingEstimateLevel = 'exact';
  const baseCostUnits = new Set<string>();
  const balanceBurnBuckets: Array<{ unit: string; amount: number }> = [];
  const diagnostics: EntryEffectiveCostEstimate['diagnostics'] = [];

  for (const attempt of executionAttempts) {
    const effective = attempt.effectiveCost;
    if (!effective) continue;
    const probability = attempt.probability ?? null;
    if (probability == null) {
      estimateLevel = 'incomplete';
      continue;
    }
    estimateLevel = mergeEstimateLevel(estimateLevel, effective.estimateLevel);
    if (effective.baseCostUnit) baseCostUnits.add(effective.baseCostUnit);
    if (effective.walletCostBaseCurrency != null) {
      weightedWallet += effective.walletCostBaseCurrency * probability;
      walletWeight += probability;
    }
    if (effective.freeQuotaDaysCost != null) {
      weightedFreeDays += effective.freeQuotaDaysCost * probability;
      freeDaysWeight += probability;
    }
    for (const bucket of effective.balanceBurn) {
      balanceBurnBuckets.push({
        unit: bucket.unit,
        amount: bucket.amount * probability,
      });
    }
    diagnostics.push(...effective.diagnostics);
  }

  if (walletWeight <= 0 && freeDaysWeight <= 0 && balanceBurnBuckets.length === 0) return null;
  if (baseCostUnits.size > 1) {
    diagnostics.push({ level: 'warn', message: 'Mixed base cost units prevent a single wallet cost total.' });
    estimateLevel = 'incomplete';
  }

  return {
    walletCostBaseCurrency: walletWeight > 0 && baseCostUnits.size <= 1 ? roundPrice(weightedWallet) : null,
    baseCostUnit: baseCostUnits.size === 1 ? [...baseCostUnits][0] : null,
    freeQuotaDaysCost: freeDaysWeight > 0 ? roundPrice(weightedFreeDays) : null,
    balanceBurn: aggregateBalanceBurn(balanceBurnBuckets),
    estimateLevel,
    diagnostics,
  };
}

function aggregatePricingCurrency(
  executionAttempts: EntryPricingExecutionAttempt[],
  diagnostics: EntryPricingEstimate['diagnostics'],
): string | null {
  const currencies = new Set(
    executionAttempts
      .map((attempt) => attempt.currency)
      .filter((currency): currency is string => !!currency),
  );
  if (currencies.size <= 1) return currencies.size === 1 ? [...currencies][0]! : null;
  diagnostics.push({
    level: 'warn',
    message: `Mixed pricing currencies prevent a single entry price unit: ${[...currencies].sort().join(', ')}.`,
  });
  return null;
}

function normalizeProbabilityRatio(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
}

function recalculateEntryPricingEstimate(
  estimate: EntryPricingEstimate,
  executionAttempts: EntryPricingExecutionAttempt[],
): EntryPricingEstimate {
  const aggregate = createPricingAggregate();
  let hasUnknownProbability = false;

  for (const attempt of executionAttempts) {
    const probability = attempt.probability ?? null;
    if (attempt.probability == null) {
      hasUnknownProbability = true;
    }
    aggregate.add(attempt, probability);
  }

  const summary = aggregate.summary();
  const comparison = comparePricingSummaries(
    summary,
    estimate.reference,
  );
  const estimateLevel: EntryPricingEstimateLevel = hasUnknownProbability
    ? 'incomplete'
    : (estimate.diagnostics.length > 0 ? 'static_estimate' : 'exact');

  return {
    ...estimate,
    currency: aggregatePricingCurrency(executionAttempts, estimate.diagnostics),
    ...summary,
    inputMultiplier: comparison.inputMultiplier,
    outputMultiplier: comparison.outputMultiplier,
    totalMultiplier: comparison.totalMultiplier,
    components: aggregate.componentBreakdown(),
    effectiveCost: aggregateEffectiveCost(executionAttempts),
    sourceCount: executionAttempts.filter(hasConcreteEntryPricing).length,
    estimateLevel,
    executionAttempts,
  };
}

export function applyRuntimeEntryPricingProbabilities(input: {
  estimate: EntryPricingEstimate | null | undefined;
  overrides: EntryPricingProbabilityOverride[];
}): EntryPricingEstimate | null {
  if (!input.estimate) return null;
  const probabilityByExecutionAttemptId = new Map<string, number | null>();
  for (const override of input.overrides) {
    const executionAttemptId = String(override.executionAttemptId ?? '').trim();
    if (!executionAttemptId) continue;
    probabilityByExecutionAttemptId.set(executionAttemptId, normalizeProbabilityRatio(override.probability));
  }
  if (probabilityByExecutionAttemptId.size === 0) return input.estimate;

  const executionAttempts = input.estimate.executionAttempts.map((attempt) => {
    const executionAttemptId = String(attempt.executionAttemptId ?? '').trim();
    const probability = executionAttemptId && probabilityByExecutionAttemptId.has(executionAttemptId)
      ? probabilityByExecutionAttemptId.get(executionAttemptId) ?? null
      : null;
    return {
      ...attempt,
      probability: probability == null ? null : (roundPrice(probability) ?? probability),
    };
  });
  return recalculateEntryPricingEstimate(input.estimate, executionAttempts);
}

function compiledRouterPlanMatchesModel(bundle: CompiledRouterBundle, requestedModel: string): CompiledRouterPlan | null {
  const exact = bundle.matcher?.exact?.[requestedModel]
    || bundle.matcher?.normalizedExact?.[requestedModel.toLowerCase()]
    || (bundle.matcher?.patterns || []).find((pattern) => {
      if (pattern.patternKind !== 'regex') return matchesModelPattern(requestedModel, pattern.pattern);
      const parsed = parseModelRegexPattern(pattern.pattern);
      if (parsed.error) return false;
      return matchesModelPattern(requestedModel, pattern.pattern);
  });
  if (!exact?.programId) return null;
  const plan = getCompiledRouterPlanById(bundle, exact.programId);
  return plan?.enabled === false ? null : plan;
}

function probabilityForCompiledAlternatives(
  plan: CompiledRouterPlan,
  bundle: CompiledRouterBundle,
): {
  probabilities: Map<string, number | null>;
  selectionModes: Set<Exclude<EntryPricingSelectionMode, 'mixed' | null>>;
  incomplete: boolean;
} {
  const estimate = estimateCompiledRuntimeAlternativeProbabilities({ plan, bundle });
  return {
    probabilities: new Map(Array.from(estimate.probabilities, ([id, value]) => [id, value.probability])),
    selectionModes: estimate.selectionModes,
    incomplete: estimate.incomplete,
  };
}

function collectCompiledRouterPlanTargets(input: {
  bundle: CompiledRouterBundle;
  plan: CompiledRouterPlan;
  requestedModel: string;
}): { targets: WeightedTarget[]; selectionModes: Set<Exclude<EntryPricingSelectionMode, 'mixed' | null>>; incomplete: boolean } {
  const { probabilities, selectionModes, incomplete: probabilityIncomplete } = probabilityForCompiledAlternatives(input.plan, input.bundle);
  const targets: WeightedTarget[] = [];
  let incomplete = probabilityIncomplete;

  for (const alternative of input.plan.executionAlternatives || []) {
    if (alternative.kind === 'synthetic_response') {
      incomplete = true;
      continue;
    }
    const target = alternative.executionAttempt;
    if (!target || alternative.enabled === false || target.enabled === false) continue;
    const executionAttemptId = executionAttemptIdForCompiledTarget(target);
    const executionTargetId = executionTargetIdForCompiledTarget(target);
    if (!executionAttemptId || executionTargetId == null) {
      incomplete = true;
      continue;
    }
    const probability = probabilities.get(alternative.alternativeId) ?? null;
    if (probability == null) incomplete = true;
    const targetTerm = [...(alternative.selectionTerms || [])].reverse().find((term) => term.mode === 'execution_attempt');
    const endpointId = alternative.endpoint?.endpointId
      || (alternative.terminal.kind === 'supply' ? alternative.terminal.endpointId : '');
    if (!endpointId) {
      incomplete = true;
      continue;
    }
    targets.push({
      target,
      endpointId,
      nodeId: alternative.endpoint?.nodeId || null,
      sourceRef: alternative.endpoint?.sourceRef || target.sourceRef || {},
      executionAttemptId,
      probability,
      weight: asFiniteNumber(targetTerm?.weight ?? target.weight),
      incomplete: probability == null,
    });
  }

  return { targets, selectionModes, incomplete };
}

function compiledRuntimePricingSelectionMode(runtime: CompiledRuntimeProjection): EntryPricingSelectionMode {
  const selectionModes = new Set<Exclude<EntryPricingSelectionMode, 'mixed' | null>>();
  for (const alternative of runtime.alternatives || []) {
    for (const term of alternative.selectionTerms || []) {
      if (term.policy.selectionMode) selectionModes.add(term.policy.selectionMode);
    }
  }
  return selectionModes.size === 1 ? [...selectionModes][0] : (selectionModes.size > 1 ? 'mixed' : null);
}

function compiledRuntimeAttemptSourceRef(attempt: RuntimeExecutionAttemptPricingSource): RouteProgramSourceRef {
  return {
    endpointId: attempt.endpointId,
  };
}

function concreteEndpointPricing(resolution: PricingResolution | null): PricingResolution | null {
  if (!resolution) return null;
  return resolution.source === 'system_default' || resolution.sourceType === 'system_default'
    ? null
    : resolution;
}

export async function estimateCompiledRuntimeEntryPricing(input: {
  runtime: CompiledRuntimeProjection;
  usage?: EntryPricingUsage | null;
}): Promise<EntryPricingEstimate | null> {
  const runtime = input.runtime;
  const requestedModel = runtime.match.requestedModel;
  const attempts = (runtime.executionAttempts || [])
    .filter((attempt) => attempt.enabled !== false);
  if (attempts.length === 0) return null;

  const pricingUsage = normalizeEntryPricingUsage(input.usage);
  const hasExplicitUsage = Object.keys(pricingUsage).length > 0;
  const pricingUsageProfile = hasExplicitUsage ? 'actual' : 'preview_1m_io';
  const diagnostics: EntryPricingEstimate['diagnostics'] = [];
  const referenceQuote = await quoteReferencePricing({
    subject: {
      modelName: requestedModel,
    },
    usageProfile: pricingUsageProfile,
    usage: hasExplicitUsage ? pricingUsage : undefined,
  });
  const reference = referenceQuote.reference?.summary ?? null;
  const aggregate = createPricingAggregate();
  let hasIncompleteProbability = false;

  const pricedAttempts = await Promise.all(attempts
    .filter((attempt) => attempt.probability == null || attempt.probability >= 0)
    .map(async (attempt): Promise<EntryPricingExecutionAttempt> => {
      const siteId = toPositiveInteger(attempt.siteId);
      const accountId = toPositiveInteger(attempt.accountId);
      const tokenId = toPositiveInteger(attempt.tokenId);
      const modelName = asTrimmedString(attempt.model);
      const probability = attempt.probability == null ? null : (roundPrice(attempt.probability) ?? attempt.probability);
      if (attempt.probability == null || attempt.probabilityStatus !== 'static') {
        hasIncompleteProbability = true;
      }

      if (!modelName) {
        diagnostics.push({
          level: 'warn',
          message: `Missing upstream model for execution attempt ${attempt.executionAttemptId}.`,
        });
        return {
          executionAttemptId: attempt.executionAttemptId,
          endpointId: attempt.endpointId,
          nodeId: attempt.nodeId || null,
          siteId,
          accountId,
          tokenId,
          modelName,
          probability,
          weight: attempt.weight,
          currency: null,
          inputPerMillion: null,
          outputPerMillion: null,
          cacheReadPerMillion: null,
          cacheWritePerMillion: null,
          reasoningPerMillion: null,
          requestCost: null,
          totalCost: null,
          components: [],
          usage: referenceQuote.usage,
          resolution: null,
          reference: null,
          effectiveCost: null,
          comparison: emptyPricingComparison(),
          quoteDiagnostics: [],
          pricingId: null,
          matchedScope: null,
          sourceRef: compiledRuntimeAttemptSourceRef(attempt),
        };
      }

      if (siteId == null || accountId == null) {
        diagnostics.push({
          level: 'warn',
          message: `Missing site/account identity for execution attempt ${attempt.executionAttemptId}.`,
        });
        return {
          executionAttemptId: attempt.executionAttemptId,
          endpointId: attempt.endpointId,
          nodeId: attempt.nodeId || null,
          siteId,
          accountId,
          tokenId,
          modelName,
          probability,
          weight: attempt.weight,
          currency: null,
          inputPerMillion: null,
          outputPerMillion: null,
          cacheReadPerMillion: null,
          cacheWritePerMillion: null,
          reasoningPerMillion: null,
          requestCost: null,
          totalCost: null,
          components: [],
          usage: referenceQuote.usage,
          resolution: null,
          reference: null,
          effectiveCost: null,
          comparison: emptyPricingComparison(),
          quoteDiagnostics: [],
          pricingId: null,
          matchedScope: null,
          sourceRef: compiledRuntimeAttemptSourceRef(attempt),
        };
      }

      const quote = await quoteEndpointPricing({
        supply: {
          siteId,
          accountId,
          tokenId,
          tokenGroup: asTrimmedString(attempt.tokenGroup) || undefined,
          modelName,
        },
        usageProfile: pricingUsageProfile,
        usage: hasExplicitUsage ? pricingUsage : undefined,
        includeReference: false,
        allowProviderCatalog: true,
        providerCatalogMode: 'cache_only',
      });
      const evaluated = concreteEndpointPricing(quote.endpoint);
      const summary = summaryFromPricingResolution(evaluated);
      const currency = currencyFromPricingResolution(evaluated);
      const components = entryPricingComponentsFromResolution(evaluated);

      if (!evaluated) {
        diagnostics.push({
          level: 'info',
          message: `No configured upstream cost for ${modelName} on execution attempt ${attempt.executionAttemptId}.`,
        });
      }
      const pricedAttempt: EntryPricingExecutionAttempt = {
        executionAttemptId: attempt.executionAttemptId,
        endpointId: attempt.endpointId,
        nodeId: attempt.nodeId || null,
        siteId,
        accountId,
        tokenId,
        modelName,
        probability,
        weight: attempt.weight,
        currency,
        ...summary,
        components,
        usage: quote.usage,
        resolution: evaluated,
        reference: quote.reference,
        effectiveCost: evaluated ? quote.effectiveCost : null,
        comparison: quote.comparison,
        quoteDiagnostics: quote.diagnostics,
        pricingId: typeof evaluated?.sourceId === 'number' ? evaluated.sourceId : null,
        matchedScope: evaluated?.matchedScope ?? null,
        sourceRef: compiledRuntimeAttemptSourceRef(attempt),
      };
      aggregate.add(pricedAttempt, probability);
      return pricedAttempt;
    }));

  if (pricedAttempts.length === 0) return null;
  const displayExecutionAttempts = pricedAttempts;
  const summary = aggregate.summary();
  const comparison = comparePricingSummaries(summary, reference);
  const estimateLevel: EntryPricingEstimateLevel = hasIncompleteProbability
    ? 'incomplete'
    : (diagnostics.length > 0 ? 'static_estimate' : 'exact');

  return {
    currency: aggregatePricingCurrency(displayExecutionAttempts, diagnostics),
    ...summary,
    inputMultiplier: comparison.inputMultiplier,
    outputMultiplier: comparison.outputMultiplier,
    totalMultiplier: comparison.totalMultiplier,
    components: aggregate.componentBreakdown(),
    usage: referenceQuote.usage,
    effectiveCost: aggregateEffectiveCost(displayExecutionAttempts),
    reference,
    referenceResolution: referenceQuote.reference,
    comparison,
    sourceCount: pricedAttempts.filter(hasConcreteEntryPricing).length,
    estimateLevel,
    selectionMode: compiledRuntimePricingSelectionMode(runtime),
    diagnostics,
    executionAttempts: displayExecutionAttempts,
  };
}

export async function estimateRouteEntryPricing(input: {
  bundle: CompiledRouterBundle;
  requestedModel: string;
  usage?: EntryPricingUsage | null;
}): Promise<EntryPricingEstimate | null> {
  const plan = compiledRouterPlanMatchesModel(input.bundle, input.requestedModel);
  const collected = plan
    ? collectCompiledRouterPlanTargets({ bundle: input.bundle, plan, requestedModel: input.requestedModel })
    : null;
  if (!collected) return null;
  const pricingUsage = normalizeEntryPricingUsage(input.usage);
  const hasExplicitUsage = Object.keys(pricingUsage).length > 0;
  const pricingUsageProfile = hasExplicitUsage ? 'actual' : 'preview_1m_io';
  const diagnostics: EntryPricingEstimate['diagnostics'] = [];
  const referenceQuote = await quoteReferencePricing({
    subject: {
      modelName: input.requestedModel,
    },
    usageProfile: pricingUsageProfile,
    usage: hasExplicitUsage ? pricingUsage : undefined,
  });
  const reference = referenceQuote.reference?.summary ?? null;
  const aggregate = createPricingAggregate();

  const pricedAttempts = await Promise.all(collected.targets
    .filter((item) => item.probability == null || item.probability >= 0)
    .map(async (item): Promise<EntryPricingExecutionAttempt> => {
    const target = item.target;
    const siteId = toPositiveInteger(target.siteId);
    const accountId = toPositiveInteger(target.accountId);
    const tokenId = toPositiveInteger(target.tokenId);
    const modelName = target.modelSource === 'request'
      ? input.requestedModel
      : asTrimmedString(target.model);

    if (!modelName) {
      diagnostics.push({
        level: 'warn',
        message: `Missing upstream model for execution attempt ${item.executionAttemptId}.`,
      });
      return {
        executionAttemptId: item.executionAttemptId,
        endpointId: item.endpointId,
        nodeId: item.nodeId,
        siteId,
        accountId,
        tokenId,
        modelName,
        probability: item.probability == null ? null : (roundPrice(item.probability) ?? item.probability),
        weight: item.weight,
        currency: null,
        inputPerMillion: null,
        outputPerMillion: null,
        cacheReadPerMillion: null,
        cacheWritePerMillion: null,
        reasoningPerMillion: null,
        requestCost: null,
        totalCost: null,
        components: [],
        usage: referenceQuote.usage,
        resolution: null,
        reference: null,
        effectiveCost: null,
        comparison: emptyPricingComparison(),
        quoteDiagnostics: [],
        pricingId: null,
        matchedScope: null,
        sourceRef: item.sourceRef,
      };
    }

    if (siteId == null || accountId == null) {
      diagnostics.push({
        level: 'warn',
        message: `Missing site/account identity for execution attempt ${item.executionAttemptId}.`,
      });
      return {
        executionAttemptId: item.executionAttemptId,
        endpointId: item.endpointId,
        nodeId: item.nodeId,
        siteId,
        accountId,
        tokenId,
        modelName,
        probability: item.probability == null ? null : (roundPrice(item.probability) ?? item.probability),
        weight: item.weight,
        currency: null,
        inputPerMillion: null,
        outputPerMillion: null,
        cacheReadPerMillion: null,
        cacheWritePerMillion: null,
        reasoningPerMillion: null,
        requestCost: null,
        totalCost: null,
        components: [],
        usage: referenceQuote.usage,
        resolution: null,
        reference: null,
        effectiveCost: null,
        comparison: emptyPricingComparison(),
        quoteDiagnostics: [],
        pricingId: null,
        matchedScope: null,
        sourceRef: item.sourceRef,
      };
    }

    const quote = await quoteEndpointPricing({
      supply: {
        siteId,
        accountId,
        tokenId,
        tokenGroup: typeof target.metadata?.tokenGroup === 'string' ? target.metadata.tokenGroup : undefined,
        modelName,
      },
      usageProfile: pricingUsageProfile,
      usage: hasExplicitUsage ? pricingUsage : undefined,
      includeReference: false,
      allowProviderCatalog: true,
      providerCatalogMode: 'cache_only',
    });
    const evaluated = concreteEndpointPricing(quote.endpoint);
    const summary = summaryFromPricingResolution(evaluated);
    const currency = currencyFromPricingResolution(evaluated);
    const components = entryPricingComponentsFromResolution(evaluated);

    if (!evaluated) {
      diagnostics.push({
        level: 'info',
        message: `No configured upstream cost for ${modelName} on execution attempt ${item.executionAttemptId}.`,
      });
    }

    const pricedAttempt: EntryPricingExecutionAttempt = {
      executionAttemptId: item.executionAttemptId,
      endpointId: item.endpointId,
      nodeId: item.nodeId,
      siteId,
      accountId,
      tokenId,
      modelName,
      probability: item.probability == null ? null : (roundPrice(item.probability) ?? item.probability),
      weight: item.weight,
      currency,
      ...summary,
      components,
      usage: quote.usage,
      resolution: evaluated,
      reference: quote.reference,
      effectiveCost: evaluated ? quote.effectiveCost : null,
      comparison: quote.comparison,
      quoteDiagnostics: quote.diagnostics,
      pricingId: typeof evaluated?.sourceId === 'number' ? evaluated.sourceId : null,
      matchedScope: evaluated?.matchedScope ?? null,
      sourceRef: item.sourceRef,
    };
    aggregate.add(pricedAttempt, item.probability);
    return pricedAttempt;
  }));

  if (pricedAttempts.length === 0) return null;
  const summary = aggregate.summary();
  const comparison = comparePricingSummaries(summary, reference);
  const displayExecutionAttempts = pricedAttempts;
  const estimateLevel: EntryPricingEstimateLevel = collected.incomplete
    ? 'incomplete'
    : (diagnostics.length > 0 ? 'static_estimate' : 'exact');

  return {
    currency: aggregatePricingCurrency(displayExecutionAttempts, diagnostics),
    ...summary,
    inputMultiplier: comparison.inputMultiplier,
    outputMultiplier: comparison.outputMultiplier,
    totalMultiplier: comparison.totalMultiplier,
    components: aggregate.componentBreakdown(),
    usage: referenceQuote.usage,
    effectiveCost: aggregateEffectiveCost(displayExecutionAttempts),
    reference,
    referenceResolution: referenceQuote.reference,
    comparison,
    sourceCount: pricedAttempts.filter(hasConcreteEntryPricing).length,
    estimateLevel,
    selectionMode: collected.selectionModes.size === 1
      ? [...collected.selectionModes][0]
      : (collected.selectionModes.size > 1 ? 'mixed' : null),
    diagnostics,
    executionAttempts: displayExecutionAttempts,
  };
}
