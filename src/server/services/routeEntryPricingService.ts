import type {
  CompiledEndpointTarget,
  RouteFlatDecision,
  RouteFlatProgram,
  RouteProgramSourceRef,
  RouteProgram,
  RouteProgramBundle,
  RouteFlatProgramBundle,
  RouteProgramCandidate,
  RouteProgramOp,
} from '../../shared/routeGraph.js';
import {
  matchesTokenRouteModelPattern,
  parseTokenRouteRegexPattern,
} from '../../shared/tokenRoutePatterns.js';
import { comparePricingSummaries } from './pricingComparisonService.js';
import { quoteEndpointPricing, quoteReferencePricing, type EffectiveCostQuote, type PricingResolution } from './pricingQuoteService.js';
import type { PricingResolutionSummary } from './pricingQuoteTypes.js';
import {
  estimateRuntimeSelectorProbabilities,
  type RuntimeSelectorCandidate,
} from './selectorEngine.js';

export type EntryPricingEstimateLevel = 'exact' | 'static_estimate' | 'incomplete';

export type EntryPricingCandidate = {
  targetId: string;
  endpointId: string;
  nodeId: string;
  siteId: number | null;
  accountId: number | null;
  tokenId: number | null;
  modelName: string;
  probability: number | null;
  weight: number | null;
  priority: number | null;
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  totalCostUsd: number | null;
  effectiveCost: EffectiveCostQuote | null;
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
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  totalCostUsd: number | null;
  inputMultiplier: number | null;
  outputMultiplier: number | null;
  totalMultiplier: number | null;
  effectiveCost: EntryEffectiveCostEstimate | null;
  reference: PricingResolutionSummary | null;
  sourceCount: number;
  estimateLevel: EntryPricingEstimateLevel;
  strategy: string | null;
  diagnostics: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
  candidates: EntryPricingCandidate[];
};

export type EntryPricingProbabilityOverride = {
  targetId: string | number | null | undefined;
  probability: number | null | undefined;
};

type WeightedTarget = {
  target: CompiledEndpointTarget;
  probability: number | null;
  fallbackProbability: number | null;
  weight: number | null;
  priority: number | null;
  strategy: string | null;
  incomplete: boolean;
};

type ProbabilityCandidate = {
  enabled?: boolean;
  weight?: number | null;
  priority?: number | null;
  metadata?: Record<string, unknown>;
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

function roundPrice(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 1_000_000) / 1_000_000;
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
  candidates: EntryPricingCandidate[],
  fallbackProbabilityByTargetId: Map<string, number>,
): EntryEffectiveCostEstimate | null {
  let weightedWallet = 0;
  let walletWeight = 0;
  let weightedFreeDays = 0;
  let freeDaysWeight = 0;
  let estimateLevel: EntryPricingEstimateLevel = 'exact';
  const baseCostUnits = new Set<string>();
  const balanceBurnBuckets: Array<{ unit: string; amount: number }> = [];
  const diagnostics: EntryEffectiveCostEstimate['diagnostics'] = [];

  for (const candidate of candidates) {
    const effective = candidate.effectiveCost;
    if (!effective) continue;
    const probability = candidate.probability ?? fallbackProbabilityByTargetId.get(candidate.targetId) ?? null;
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
    walletCostBaseCurrency: walletWeight > 0 && baseCostUnits.size <= 1 ? roundPrice(weightedWallet / walletWeight) : null,
    baseCostUnit: baseCostUnits.size === 1 ? [...baseCostUnits][0] : null,
    freeQuotaDaysCost: freeDaysWeight > 0 ? roundPrice(weightedFreeDays / freeDaysWeight) : null,
    balanceBurn: aggregateBalanceBurn(balanceBurnBuckets),
    estimateLevel,
    diagnostics,
  };
}

function normalizeProbabilityRatio(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
}

function recalculateEntryPricingEstimate(
  estimate: EntryPricingEstimate,
  candidates: EntryPricingCandidate[],
): EntryPricingEstimate {
  const fallbackProbabilityByTargetId = buildFallbackProbabilityByTargetId(candidates);
  let weightedInput = 0;
  let inputWeight = 0;
  let weightedOutput = 0;
  let outputWeight = 0;
  let weightedTotal = 0;
  let totalWeight = 0;
  let hasUnknownProbability = false;

  for (const candidate of candidates) {
    const probability = candidate.probability ?? fallbackProbabilityByTargetId.get(candidate.targetId) ?? null;
    if (candidate.probability == null) {
      hasUnknownProbability = true;
    }
    if (probability == null) continue;
    if (candidate.inputPerMillion != null) {
      weightedInput += candidate.inputPerMillion * probability;
      inputWeight += probability;
    }
    if (candidate.outputPerMillion != null) {
      weightedOutput += candidate.outputPerMillion * probability;
      outputWeight += probability;
    }
    if (candidate.totalCostUsd != null) {
      weightedTotal += candidate.totalCostUsd * probability;
      totalWeight += probability;
    }
  }

  const inputPerMillion = inputWeight > 0 ? roundPrice(weightedInput / inputWeight) : null;
  const outputPerMillion = outputWeight > 0 ? roundPrice(weightedOutput / outputWeight) : null;
  const totalCostUsd = totalWeight > 0 ? roundPrice(weightedTotal / totalWeight) : null;
  const comparison = comparePricingSummaries(
    { inputPerMillion, outputPerMillion, totalCostUsd },
    estimate.reference,
  );
  const estimateLevel: EntryPricingEstimateLevel = hasUnknownProbability
    ? 'incomplete'
    : (estimate.diagnostics.length > 0 ? 'static_estimate' : 'exact');

  return {
    ...estimate,
    inputPerMillion,
    outputPerMillion,
    totalCostUsd,
    inputMultiplier: comparison.inputMultiplier,
    outputMultiplier: comparison.outputMultiplier,
    totalMultiplier: comparison.totalMultiplier,
    effectiveCost: aggregateEffectiveCost(candidates, fallbackProbabilityByTargetId),
    sourceCount: candidates.filter((candidate) => (
      candidate.totalCostUsd != null
      || candidate.inputPerMillion != null
      || candidate.outputPerMillion != null
    )).length,
    estimateLevel,
    candidates,
  };
}

function buildFallbackProbabilityByTargetId(
  candidates: Array<Pick<EntryPricingCandidate, 'targetId' | 'weight'>>,
): Map<string, number> {
  const enabled = candidates.filter((candidate) => candidate.targetId);
  const totalWeight = enabled.reduce((sum, candidate) => {
    const weight = asPositiveNumber(candidate.weight) ?? 1;
    return sum + weight;
  }, 0);
  const result = new Map<string, number>();
  if (totalWeight <= 0) return result;
  for (const candidate of enabled) {
    const weight = asPositiveNumber(candidate.weight) ?? 1;
    result.set(candidate.targetId, weight / totalWeight);
  }
  return result;
}

function applyFallbackCandidateProbabilities(
  candidates: EntryPricingCandidate[],
  fallbackProbabilityByTargetId: Map<string, number | null>,
): EntryPricingCandidate[] {
  if (fallbackProbabilityByTargetId.size === 0) return candidates;
  return candidates.map((candidate) => {
    if (candidate.probability != null) return candidate;
    const probability = fallbackProbabilityByTargetId.get(candidate.targetId);
    if (probability == null) return candidate;
    return {
      ...candidate,
      probability: roundPrice(probability) ?? probability,
    };
  });
}

export function applyRuntimeEntryPricingProbabilities(input: {
  estimate: EntryPricingEstimate | null | undefined;
  overrides: EntryPricingProbabilityOverride[];
}): EntryPricingEstimate | null {
  if (!input.estimate) return null;
  const probabilityByTargetId = new Map<string, number | null>();
  for (const override of input.overrides) {
    const targetId = String(override.targetId ?? '').trim();
    if (!targetId) continue;
    probabilityByTargetId.set(targetId, normalizeProbabilityRatio(override.probability));
  }
  if (probabilityByTargetId.size === 0) return input.estimate;

  const candidates = input.estimate.candidates.map((candidate) => {
    const targetId = String(candidate.targetId ?? '').trim();
    const probability = probabilityByTargetId.has(targetId)
      ? probabilityByTargetId.get(targetId) ?? null
      : null;
    return {
      ...candidate,
      probability: probability == null ? null : (roundPrice(probability) ?? probability),
    };
  });
  return recalculateEntryPricingEstimate(input.estimate, candidates);
}

function programMatchesModel(bundle: RouteProgramBundle, requestedModel: string): RouteProgram | null {
  const exact = bundle.matcher?.exact?.[requestedModel]
    || bundle.matcher?.normalizedExact?.[requestedModel.toLowerCase()]
    || (bundle.matcher?.patterns || []).find((pattern) => {
      if (pattern.patternKind !== 'regex') return matchesTokenRouteModelPattern(requestedModel, pattern.pattern);
      const parsed = parseTokenRouteRegexPattern(pattern.pattern);
      if (parsed.error) return false;
      return matchesTokenRouteModelPattern(requestedModel, pattern.pattern);
    });
  if (!exact?.programId) return null;
  return (bundle.programs || []).find((program) => program.id === exact.programId && program.enabled !== false) || null;
}

function flatProgramMatchesModel(bundle: RouteFlatProgramBundle, requestedModel: string): RouteFlatProgram | null {
  const exact = bundle.matcher?.exact?.[requestedModel]
    || bundle.matcher?.normalizedExact?.[requestedModel.toLowerCase()]
    || (bundle.matcher?.patterns || []).find((pattern) => {
      if (pattern.patternKind !== 'regex') return matchesTokenRouteModelPattern(requestedModel, pattern.pattern);
      const parsed = parseTokenRouteRegexPattern(pattern.pattern);
      if (parsed.error) return false;
      return matchesTokenRouteModelPattern(requestedModel, pattern.pattern);
    });
  if (!exact?.programId) return null;
  return (bundle.programs || []).find((program) => program.id === exact.programId && program.enabled !== false) || null;
}

function isRouteFlatProgramBundle(bundle: RouteProgramBundle | RouteFlatProgramBundle): bundle is RouteFlatProgramBundle {
  return Array.isArray(bundle.programs)
    && bundle.programs.some((program) => isRecord(program) && isRecord(program.start));
}

function runtimeCandidateFromProbabilityCandidate<T extends ProbabilityCandidate>(
  candidate: T,
  index: number,
  kind: string,
): RuntimeSelectorCandidate<T> {
  const weight = asPositiveNumber(candidate.weight) ?? 1;
  return {
    idx: index,
    kind,
    metadata: isRecord(candidate.metadata) ? candidate.metadata : {},
    runtime: {},
    enabled: candidate.enabled !== false,
    weight,
    priority: asFiniteNumber(candidate.priority) ?? 0,
    score: weight,
    order: index,
    payload: candidate,
  };
}

function probabilityForCandidates<T extends ProbabilityCandidate>(
  policy: Record<string, unknown> | null | undefined,
  candidates: T[],
  kind: string,
): Array<{ candidate: T; probability: number | null; strategy: string; incomplete: boolean }> {
  const enabled = candidates.filter((candidate) => candidate.enabled !== false);
  if (enabled.length === 0) return [];

  const runtimeCandidates = candidates.map((candidate, index) => (
    runtimeCandidateFromProbabilityCandidate(candidate, index, kind)
  ));
  const estimate = estimateRuntimeSelectorProbabilities({
    selectorId: `${kind}:entry-pricing`,
    policy,
    candidates: runtimeCandidates,
  });

  return enabled.map((candidate) => {
    const originalIndex = candidates.indexOf(candidate);
    return {
      candidate,
      probability: estimate.probabilities[originalIndex] ?? null,
      strategy: estimate.strategy,
      incomplete: estimate.estimateLevel !== 'static',
    };
  });
}

function probabilityForTargets(
  policy: Record<string, unknown> | null | undefined,
  targets: CompiledEndpointTarget[],
): Array<{ target: CompiledEndpointTarget; probability: number | null; fallbackProbability: number | null; weight: number | null; priority: number | null; strategy: string; incomplete: boolean }> {
  const candidates = targets.map((target, index): RouteProgramCandidate => ({
    id: target.targetId || `${target.endpointId}:${index}`,
    kind: 'target',
    enabled: target.enabled !== false,
    weight: asPositiveNumber(target.weight) ?? 1,
    priority: asFiniteNumber(target.priority) ?? 0,
    targetRef: target,
    metadata: isRecord(target.metadata) ? target.metadata : {},
    sourceRef: target.sourceRef || {},
  }));
  const fallbackProbabilityByTargetId = isRecord(policy) && policy.strategy === 'defer_to_router'
    ? buildFallbackProbabilityByTargetId(candidates.map((candidate) => ({
      targetId: String(candidate.targetRef?.targetId ?? candidate.id),
      weight: candidate.weight,
    })))
    : new Map<string, number>();
  return probabilityForCandidates(policy, candidates, 'target')
    .map((item) => ({
      target: targets[candidates.indexOf(item.candidate)],
      probability: item.probability,
      fallbackProbability: fallbackProbabilityByTargetId.get(String(item.candidate.targetRef?.targetId ?? item.candidate.id)) ?? null,
      weight: asFiniteNumber(item.candidate.weight),
      priority: asFiniteNumber(item.candidate.priority),
      strategy: item.strategy,
      incomplete: item.incomplete,
    }))
    .filter((item): item is { target: CompiledEndpointTarget; probability: number | null; fallbackProbability: number | null; weight: number | null; priority: number | null; strategy: string; incomplete: boolean } => !!item.target);
}

function collectProgramTargets(input: {
  program: RouteProgram;
  requestedModel: string;
}): { targets: WeightedTarget[]; strategies: Set<string>; incomplete: boolean } {
  const opsById = new Map((input.program.ops || []).map((op) => [op.id, op]));
  const targets: WeightedTarget[] = [];
  const strategies = new Set<string>();
  let incomplete = false;
  const visited = new Set<string>();

  const visit = (opId: string | null | undefined, probability: number | null) => {
    const id = asTrimmedString(opId);
    if (!id || (probability != null && probability <= 0)) return;
    const guardKey = `${id}:${probability == null ? 'dynamic' : probability}`;
    if (visited.has(guardKey)) return;
    visited.add(guardKey);
    const op = opsById.get(id);
    if (!op) {
      incomplete = true;
      return;
    }

    if (op.op === 'filter') {
      visit(op.nextOpId, probability);
      return;
    }

    if (op.op === 'call_product') {
      visit(op.nextOpId, probability);
      return;
    }

    if (op.op === 'dispatch') {
      const weighted = probabilityForCandidates(op.policy, op.candidates || [], 'route');
      for (const item of weighted) {
        strategies.add(item.strategy);
        if (item.incomplete || item.probability == null) incomplete = true;
        visit(
          item.candidate.targetOpId,
          probability == null || item.probability == null ? null : probability * item.probability,
        );
      }
      return;
    }

    if (op.op === 'select_supply') {
      const weighted = probabilityForTargets(op.targetSelectionPolicy, op.targets || []);
      for (const item of weighted) {
        strategies.add(item.strategy);
        if (item.incomplete || item.probability == null) incomplete = true;
        targets.push({
          target: item.target,
          probability: probability == null || item.probability == null ? null : probability * item.probability,
          fallbackProbability: probability != null && item.probability == null && item.fallbackProbability != null
            ? probability * item.fallbackProbability
            : null,
          weight: item.weight,
          priority: item.priority,
          strategy: item.strategy,
          incomplete: item.incomplete,
        });
      }
      return;
    }

    if (op.op === 'synthetic') {
      incomplete = true;
    }
  };

  visit(input.program.startOpId, 1);
  return { targets, strategies, incomplete };
}

function collectFlatProgramTargets(input: {
  program: RouteFlatProgram;
  requestedModel: string;
}): { targets: WeightedTarget[]; strategies: Set<string>; incomplete: boolean } {
  const targets: WeightedTarget[] = [];
  const strategies = new Set<string>();
  let incomplete = false;
  const visited = new Set<string>();

  const visit = (decision: RouteFlatDecision | null | undefined, probability: number | null) => {
    if (!decision || (probability != null && probability <= 0)) return;
    const guardKey = `${decision.kind}:${decision.kind === 'dispatch' ? decision.dispatch.id : decision.terminal.nodeId}:${probability == null ? 'dynamic' : probability}`;
    if (visited.has(guardKey)) return;
    visited.add(guardKey);

    if (decision.kind === 'dispatch') {
      const weighted = probabilityForCandidates(decision.dispatch.policy, decision.dispatch.candidates || [], 'route');
      for (const item of weighted) {
        strategies.add(item.strategy);
        if (item.incomplete || item.probability == null) incomplete = true;
        visit(
          item.candidate.next,
          probability == null || item.probability == null ? null : probability * item.probability,
        );
      }
      return;
    }

    if (decision.terminal.kind === 'synthetic') {
      incomplete = true;
      return;
    }

    const weighted = probabilityForTargets(decision.terminal.targetSelectionPolicy, decision.terminal.targets || []);
    for (const item of weighted) {
      strategies.add(item.strategy);
      if (item.incomplete || item.probability == null) incomplete = true;
      targets.push({
        target: item.target,
        probability: probability == null || item.probability == null ? null : probability * item.probability,
        fallbackProbability: probability != null && item.probability == null && item.fallbackProbability != null
          ? probability * item.fallbackProbability
          : null,
        weight: item.weight,
        priority: item.priority,
        strategy: item.strategy,
        incomplete: item.incomplete,
      });
    }
  };

  visit(input.program.start, 1);
  return { targets, strategies, incomplete };
}

export async function estimateRouteEntryPricing(input: {
  bundle: RouteProgramBundle | RouteFlatProgramBundle;
  requestedModel: string;
}): Promise<EntryPricingEstimate | null> {
  const collected = isRouteFlatProgramBundle(input.bundle)
    ? (() => {
      const program = flatProgramMatchesModel(input.bundle, input.requestedModel);
      return program ? collectFlatProgramTargets({ program, requestedModel: input.requestedModel }) : null;
    })()
    : (() => {
      const program = programMatchesModel(input.bundle, input.requestedModel);
      return program ? collectProgramTargets({ program, requestedModel: input.requestedModel }) : null;
    })();
  if (!collected) return null;
  const diagnostics: EntryPricingEstimate['diagnostics'] = [];
  const referenceQuote = await quoteReferencePricing({
    subject: {
      modelName: input.requestedModel,
    },
    usageProfile: 'preview_1m_io',
  });
  const reference = referenceQuote.reference?.summary ?? null;
  let weightedInput = 0;
  let inputWeight = 0;
  let weightedOutput = 0;
  let outputWeight = 0;
  let weightedTotal = 0;
  let totalWeight = 0;

  const candidates = await Promise.all(collected.targets
    .filter((item) => item.probability == null || item.probability >= 0)
    .map(async (item): Promise<EntryPricingCandidate> => {
    const target = item.target;
    const siteId = toPositiveInteger(target.siteId);
    const accountId = toPositiveInteger(target.accountId);
    const tokenId = toPositiveInteger(target.tokenId);
    const modelName = target.modelSource === 'request'
      ? input.requestedModel
      : (asTrimmedString(target.model) || input.requestedModel);

    if (siteId == null || accountId == null) {
      diagnostics.push({
        level: 'warn',
        message: `Missing site/account identity for target ${target.targetId}.`,
      });
      return {
        targetId: target.targetId,
        endpointId: target.endpointId,
        nodeId: target.nodeId,
        siteId,
        accountId,
        tokenId,
        modelName,
        probability: item.probability == null ? null : (roundPrice(item.probability) ?? item.probability),
        weight: item.weight,
        priority: item.priority,
        inputPerMillion: null,
        outputPerMillion: null,
        totalCostUsd: null,
        effectiveCost: null,
        pricingId: null,
        matchedScope: null,
        sourceRef: target.sourceRef || {},
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
      usageProfile: 'preview_1m_io',
      includeReference: false,
    });
    const evaluated: PricingResolution | null = quote.endpoint;
    const inputPerMillion = evaluated?.summary.inputPerMillion ?? null;
    const outputPerMillion = evaluated?.summary.outputPerMillion ?? null;
    const totalCostUsd = evaluated?.summary.totalCostUsd ?? null;

    if (!evaluated) {
      diagnostics.push({
        level: 'info',
        message: `No configured upstream cost for ${modelName} on target ${target.targetId}.`,
      });
    }
    if (inputPerMillion != null && item.probability != null) {
      weightedInput += inputPerMillion * item.probability;
      inputWeight += item.probability;
    }
    if (outputPerMillion != null && item.probability != null) {
      weightedOutput += outputPerMillion * item.probability;
      outputWeight += item.probability;
    }
    if (totalCostUsd != null && item.probability != null) {
      weightedTotal += totalCostUsd * item.probability;
      totalWeight += item.probability;
    }

    return {
      targetId: target.targetId,
      endpointId: target.endpointId,
      nodeId: target.nodeId,
      siteId,
      accountId,
      tokenId,
      modelName,
      probability: item.probability == null ? null : (roundPrice(item.probability) ?? item.probability),
      weight: item.weight,
      priority: item.priority,
      inputPerMillion,
      outputPerMillion,
      totalCostUsd,
      effectiveCost: quote.effectiveCost,
      pricingId: typeof evaluated?.sourceId === 'number' ? evaluated.sourceId : null,
      matchedScope: evaluated?.matchedScope ?? null,
      sourceRef: target.sourceRef || {},
    };
  }));

  if (candidates.length === 0) return null;
  const aggregateFallbackProbabilityByTargetId = buildFallbackProbabilityByTargetId(candidates);
  const displayFallbackProbabilityByTargetId = new Map<string, number | null>();
  for (const item of collected.targets) {
    displayFallbackProbabilityByTargetId.set(item.target.targetId, item.fallbackProbability);
  }
  const hasFallbackProbability = aggregateFallbackProbabilityByTargetId.size > 0;
  if ((inputWeight <= 0 || outputWeight <= 0 || totalWeight <= 0) && hasFallbackProbability) {
    let fallbackWeightedInput = 0;
    let fallbackInputWeight = 0;
    let fallbackWeightedOutput = 0;
    let fallbackOutputWeight = 0;
    let fallbackWeightedTotal = 0;
    let fallbackTotalWeight = 0;
    for (const candidate of candidates) {
      if (candidate.probability != null) continue;
      const probability = aggregateFallbackProbabilityByTargetId.get(candidate.targetId);
      if (probability == null) continue;
      if (candidate.inputPerMillion != null) {
        fallbackWeightedInput += candidate.inputPerMillion * probability;
        fallbackInputWeight += probability;
      }
      if (candidate.outputPerMillion != null) {
        fallbackWeightedOutput += candidate.outputPerMillion * probability;
        fallbackOutputWeight += probability;
      }
      if (candidate.totalCostUsd != null) {
        fallbackWeightedTotal += candidate.totalCostUsd * probability;
        fallbackTotalWeight += probability;
      }
    }
    if (inputWeight <= 0) {
      weightedInput = fallbackWeightedInput;
      inputWeight = fallbackInputWeight;
    }
    if (outputWeight <= 0) {
      weightedOutput = fallbackWeightedOutput;
      outputWeight = fallbackOutputWeight;
    }
    if (totalWeight <= 0) {
      weightedTotal = fallbackWeightedTotal;
      totalWeight = fallbackTotalWeight;
    }
  }
  const inputPerMillion = inputWeight > 0 ? roundPrice(weightedInput / inputWeight) : null;
  const outputPerMillion = outputWeight > 0 ? roundPrice(weightedOutput / outputWeight) : null;
  const totalCostUsd = totalWeight > 0 ? roundPrice(weightedTotal / totalWeight) : null;
  const comparison = comparePricingSummaries({ inputPerMillion, outputPerMillion, totalCostUsd }, reference);
  const displayCandidates = collected.incomplete
    ? applyFallbackCandidateProbabilities(candidates, displayFallbackProbabilityByTargetId)
    : candidates;
  const estimateLevel: EntryPricingEstimateLevel = collected.incomplete
    ? 'incomplete'
    : (diagnostics.length > 0 ? 'static_estimate' : 'exact');

  return {
    inputPerMillion,
    outputPerMillion,
    totalCostUsd,
    inputMultiplier: comparison.inputMultiplier,
    outputMultiplier: comparison.outputMultiplier,
    totalMultiplier: comparison.totalMultiplier,
    effectiveCost: aggregateEffectiveCost(displayCandidates, aggregateFallbackProbabilityByTargetId),
    reference,
    sourceCount: candidates.filter((candidate) => candidate.totalCostUsd != null || candidate.inputPerMillion != null || candidate.outputPerMillion != null).length,
    estimateLevel,
    strategy: collected.strategies.size === 1 ? [...collected.strategies][0] : (collected.strategies.size > 1 ? 'mixed' : null),
    diagnostics,
    candidates: displayCandidates,
  };
}
