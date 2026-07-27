import { celEnv, isCelError, parse, plan } from '@bufbuild/cel';

export type RuntimeSelectorStrategy =
  | 'weighted'
  | 'round_robin'
  | 'stable_first'
  | 'direct'
  | 'defer_to_router'
  | 'policy_weighted'
  | 'policy_ordered'
  | 'policy_round_robin';

export type RuntimeSelectorPolicy = {
  strategy: RuntimeSelectorStrategy | string;
  eligibility?: string;
  contribution?: string;
  order?: string;
  select?: string;
};

export type RuntimeSelectorState = {
  requestedModel?: string;
  currentModel?: string;
  upstreamModel?: string;
  endpointPreference?: 'chat' | 'messages' | 'responses';
  stateStore?: Record<string, unknown>;
  selectorStateStore?: Record<string, unknown>;
  payload?: unknown;
  headers?: Record<string, unknown>;
  request?: Record<string, unknown>;
  requestKnown?: boolean;
};

export type RuntimeSelectorCelScope = Record<string, unknown> & {
  metadata?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
};

export type RuntimeSelectorCandidate<TPayload = unknown> = {
  idx: number;
  kind: string;
  nodeId?: string;
  edgeId?: string;
  metadata: Record<string, unknown>;
  runtime: Record<string, unknown>;
  selection?: RuntimeSelectorCelScope | null;
  endpoint?: RuntimeSelectorCelScope | null;
  executionAttempt?: RuntimeSelectorCelScope | null;
  plan?: RuntimeSelectorCelScope | null;
  graph?: RuntimeSelectorCelScope | null;
  enabled: boolean;
  weight: number;
  score: number;
  order: number;
  payload?: TPayload;
};

type CelEvaluator = (ctx?: Record<string, unknown>) => unknown;

const selectorCelEnv = celEnv();
const celPlanCache = new Map<string, CelEvaluator | null>();
const selectorPlanCache = new WeakMap<RuntimeSelectorPolicy, RuntimeSelectorPlan>();
const DEFAULT_SELECTOR_POLICY: RuntimeSelectorPolicy = Object.freeze({ strategy: 'weighted' });
const STATIC_SELECTOR_STRATEGIES = new Set([
  'weighted',
  'round_robin',
  'stable_first',
]);

export type RuntimeSelectorPlan = {
  policy: RuntimeSelectorPolicy;
  strategy: RuntimeSelectorStrategy | string;
  selectEvaluator?: CelEvaluator | null;
  eligibilityEvaluator?: CelEvaluator | null;
  contributionEvaluator?: CelEvaluator | null;
  orderEvaluator?: CelEvaluator | null;
};

export type ContributionSelectorMode = 'weighted' | 'stable_first';

export type ContributionSelectorSnapshot = {
  totalContribution: number;
  probabilities: number[];
  rankedIndices: number[];
  rankByIndex: Map<number, number>;
  selectedIndex: number | null;
};

export type RuntimeSelectorProbabilityEstimate = {
  estimateLevel: 'static' | 'dynamic' | 'unsupported';
  strategy: string;
  probabilities: Array<number | null>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

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

function compileCelExpression(expression: string): CelEvaluator | null {
  const normalized = expression.trim();
  if (!normalized) return null;
  if (celPlanCache.has(normalized)) return celPlanCache.get(normalized) ?? null;
  try {
    const evaluator = plan(selectorCelEnv, parse(normalized)) as CelEvaluator;
    celPlanCache.set(normalized, evaluator);
    return evaluator;
  } catch {
    celPlanCache.set(normalized, null);
    return null;
  }
}

function evaluatePlannedCelExpression(evaluator: CelEvaluator | null | undefined, context: Record<string, unknown>): unknown {
  if (!evaluator) return undefined;
  try {
    return celValueToPlain(evaluator(context));
  } catch {
    return undefined;
  }
}

export function evaluateSelectorCelExpression(expression: unknown, context: Record<string, unknown>): unknown {
  if (typeof expression !== 'string' || !expression.trim()) return undefined;
  return evaluatePlannedCelExpression(compileCelExpression(expression), context);
}

export function validateSelectorCelExpression(expression: unknown): string | null {
  if (typeof expression !== 'string' || !expression.trim()) return 'Expression is required.';
  return compileCelExpression(expression) ? null : 'Expression could not be compiled.';
}

function numberOrFallback(value: unknown, fallback: number): number {
  const normalized = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function candidateSelectionWeight(candidate: RuntimeSelectorCandidate): number {
  const normalized = Number(candidate.weight);
  return Number.isFinite(normalized) ? Math.max(0, normalized) : 0;
}

export class RuntimeSelectorPolicyEvaluationError extends Error {
  constructor(selectorId: string, field: string, detail: string) {
    super(`Selector ${selectorId} ${field} evaluation failed: ${detail}`);
    this.name = 'RuntimeSelectorPolicyEvaluationError';
  }
}

function expressionDependsOnRequestInput(expression: string): boolean {
  return /\b(request|payload|headers)\b/.test(expression);
}

function expressionDependsOnStateStore(expression: string): boolean {
  return /\bstateStore\b/.test(expression);
}

function selectorPlanExpressions(plan: RuntimeSelectorPlan): string[] {
  const policy = plan.policy;
  return [
    typeof policy.select === 'string' ? policy.select : '',
    typeof policy.eligibility === 'string' ? policy.eligibility : '',
    typeof policy.contribution === 'string' ? policy.contribution : '',
    typeof policy.order === 'string' ? policy.order : '',
  ].filter(Boolean);
}

function selectorPlanHasUnavailableDynamicInputs(plan: RuntimeSelectorPlan, state: RuntimeSelectorState): boolean {
  const expressions = selectorPlanExpressions(plan);
  if (expressions.some(expressionDependsOnStateStore)) return true;
  return expressions.some(expressionDependsOnRequestInput) && state.requestKnown !== true;
}

function scopeForCel(scope: RuntimeSelectorCelScope | null | undefined): Record<string, unknown> | null {
  if (!isRecord(scope)) return null;
  return {
    ...scope,
    metadata: isRecord(scope.metadata) ? scope.metadata : {},
    runtime: isRecord(scope.runtime) ? scope.runtime : {},
  };
}

export function hydrateRuntimeSelectorPlan(policyInput?: RuntimeSelectorPolicy | null): RuntimeSelectorPlan {
  const policy = isRecord(policyInput) ? policyInput : DEFAULT_SELECTOR_POLICY;
  const cached = selectorPlanCache.get(policy);
  if (cached) return cached;
  const strategy = asTrimmedString(policy.strategy) || 'weighted';
  const planValue: RuntimeSelectorPlan = {
    policy,
    strategy,
    selectEvaluator: typeof policy.select === 'string' ? compileCelExpression(policy.select) : null,
    eligibilityEvaluator: typeof policy.eligibility === 'string' ? compileCelExpression(policy.eligibility) : null,
    contributionEvaluator: typeof policy.contribution === 'string' ? compileCelExpression(policy.contribution) : null,
    orderEvaluator: typeof policy.order === 'string' ? compileCelExpression(policy.order) : null,
  };
  selectorPlanCache.set(policy, planValue);
  return planValue;
}

function candidateForCel(candidate: RuntimeSelectorCandidate): Record<string, unknown> {
  return {
    idx: candidate.idx,
    kind: candidate.kind,
    nodeId: candidate.nodeId,
    edgeId: candidate.edgeId,
    metadata: candidate.metadata,
    enabled: candidate.enabled,
    weight: candidate.weight,
    score: candidate.score,
    order: candidate.order,
    runtime: candidate.runtime,
    selection: scopeForCel(candidate.selection),
    endpoint: scopeForCel(candidate.endpoint),
    executionAttempt: scopeForCel(candidate.executionAttempt),
    plan: scopeForCel(candidate.plan),
    graph: scopeForCel(candidate.graph),
  };
}

function buildSelectorCelContext(input: {
  state: RuntimeSelectorState;
  candidate: RuntimeSelectorCandidate;
  candidates: RuntimeSelectorCandidate[];
}): Record<string, unknown> {
  const payload = input.state.payload !== undefined ? input.state.payload : {
    requestedModel: input.state.requestedModel ?? null,
    currentModel: input.state.currentModel ?? null,
    upstreamModel: input.state.upstreamModel ?? null,
    endpointPreference: input.state.endpointPreference ?? null,
  };
  const request = input.state.request || {
    requestedModel: input.state.requestedModel ?? null,
    currentModel: input.state.currentModel ?? null,
    upstreamModel: input.state.upstreamModel ?? null,
    endpointPreference: input.state.endpointPreference ?? null,
    payload,
    headers: input.state.headers || {},
  };
  const self = candidateForCel(input.candidate);
  return {
    request,
    payload,
    headers: input.state.headers || {},
    stateStore: input.state.stateStore || {},
    idx: input.candidate.idx,
    self,
    candidates: input.candidates.map(candidateForCel),
    runtime: input.candidate.runtime,
    selection: scopeForCel(input.candidate.selection),
    endpoint: scopeForCel(input.candidate.endpoint),
    executionAttempt: scopeForCel(input.candidate.executionAttempt),
    plan: scopeForCel(input.candidate.plan),
    graph: scopeForCel(input.candidate.graph),
  };
}

function applyScorePolicy<TPayload>(input: {
  selectorId: string;
  plan: RuntimeSelectorPlan;
  candidate: RuntimeSelectorCandidate<TPayload>;
  candidates: RuntimeSelectorCandidate<TPayload>[];
  state: RuntimeSelectorState;
}): RuntimeSelectorCandidate<TPayload> {
  const context = buildSelectorCelContext(input);
  const next = { ...input.candidate };
  if (input.plan.eligibilityEvaluator) {
    const evaluated = evaluatePlannedCelExpression(input.plan.eligibilityEvaluator, context);
    if (typeof evaluated !== 'boolean') {
      throw new RuntimeSelectorPolicyEvaluationError(input.selectorId, 'eligibility', 'expected a boolean result');
    }
    next.enabled = evaluated;
  }
  if (input.plan.contributionEvaluator) {
    const evaluated = Number(evaluatePlannedCelExpression(input.plan.contributionEvaluator, context));
    if (!Number.isFinite(evaluated)) {
      throw new RuntimeSelectorPolicyEvaluationError(input.selectorId, 'contribution', 'expected a finite number');
    }
    next.weight = Math.max(0, evaluated);
  }
  if (input.plan.orderEvaluator) {
    const evaluated = Number(evaluatePlannedCelExpression(input.plan.orderEvaluator, context));
    if (!Number.isFinite(evaluated)) {
      throw new RuntimeSelectorPolicyEvaluationError(input.selectorId, 'order', 'expected a finite number');
    }
    next.order = evaluated;
  }

  next.score = next.weight;
  return next;
}

/** Evaluates a selector policy once so selection, estimation, and audit traces
 * all observe the same eligible candidates and CEL-derived values. */
export function evaluateRuntimeSelectorCandidates<TPayload>(input: {
  selectorId?: string;
  plan?: RuntimeSelectorPlan | null;
  policy?: RuntimeSelectorPolicy | null;
  candidates: RuntimeSelectorCandidate<TPayload>[];
  state?: RuntimeSelectorState;
}): RuntimeSelectorCandidate<TPayload>[] {
  const state = input.state || {};
  const candidates = input.candidates.filter((candidate) => candidate.enabled !== false);
  if (candidates.length === 0) return [];
  const plan = input.plan || hydrateRuntimeSelectorPlan(input.policy);
  return candidates.map((candidate) => applyScorePolicy({
    selectorId: input.selectorId || 'selector',
    plan,
    candidate,
    candidates,
    state,
  })).filter((candidate) => candidate.enabled !== false);
}

export function selectWeightedRuntimeCandidate<TPayload>(
  candidates: RuntimeSelectorCandidate<TPayload>[],
  random = Math.random,
): RuntimeSelectorCandidate<TPayload> | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] || null;
  const weighted = candidates.map((candidate) => ({
    candidate,
    weight: candidateSelectionWeight(candidate),
  }));
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    const index = Math.min(weighted.length - 1, Math.floor(random() * weighted.length));
    return weighted[index]?.candidate || null;
  }
  let cursor = random() * totalWeight;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor < 0) return item.candidate;
  }
  return weighted[weighted.length - 1]?.candidate || null;
}

export function selectRuntimeCandidate<TPayload>(input: {
  selectorId: string;
  policy?: RuntimeSelectorPolicy | null;
  plan?: RuntimeSelectorPlan | null;
  candidates: RuntimeSelectorCandidate<TPayload>[];
  state?: RuntimeSelectorState;
  random?: () => number;
}): RuntimeSelectorCandidate<TPayload> | null {
  const state = input.state || {};
  const stateStore = state.selectorStateStore || state.stateStore || {};
  const candidates = input.candidates.filter((candidate) => candidate.enabled !== false);
  if (candidates.length === 0) return null;
  const plan = input.plan || hydrateRuntimeSelectorPlan(input.policy);
  const strategy = plan.strategy as RuntimeSelectorStrategy || 'weighted';
  const ranked = evaluateRuntimeSelectorCandidates({
    selectorId: input.selectorId,
    plan,
    candidates,
    state: { ...state, stateStore },
  });
  if (ranked.length === 0) return null;

  if (strategy === 'direct') {
    const context = buildSelectorCelContext({ state, candidate: ranked[0], candidates: ranked });
    const direct = evaluatePlannedCelExpression(plan.selectEvaluator, context);
    const idx = isRecord(direct) ? numberOrFallback(direct.idx, Number.NaN) : numberOrFallback(direct, Number.NaN);
    if (Number.isInteger(idx) && idx >= 0 && idx < ranked.length) return ranked[idx];
    throw new RuntimeSelectorPolicyEvaluationError(input.selectorId, 'direct selection', 'expected an eligible option index');
  }

  if (strategy === 'round_robin' || strategy === 'policy_round_robin') {
    const key = `selector:${input.selectorId}:round_robin`;
    const current = numberOrFallback(stateStore[key], 0);
    const ordered = strategy === 'policy_round_robin'
      ? [...ranked].sort((left, right) => left.order - right.order)
      : ranked;
    const normalizedIndex = ordered.length > 0 ? Math.abs(Math.trunc(current)) % ordered.length : 0;
    stateStore[key] = Math.max(0, Math.trunc(current)) + 1;
    return ordered[normalizedIndex] || null;
  }
  if (strategy === 'stable_first' || strategy === 'policy_ordered') {
    return [...ranked].sort((left, right) => left.order - right.order)[0] || null;
  }
  return selectWeightedRuntimeCandidate(ranked, input.random);
}

export function estimateRuntimeSelectorProbabilities<TPayload>(input: {
  selectorId: string;
  policy?: RuntimeSelectorPolicy | null;
  plan?: RuntimeSelectorPlan | null;
  candidates: RuntimeSelectorCandidate<TPayload>[];
  state?: RuntimeSelectorState;
}): RuntimeSelectorProbabilityEstimate {
  const state = input.state || {};
  const candidates = input.candidates.filter((candidate) => candidate.enabled !== false);
  const resultByOriginalIndex: Array<number | null> = input.candidates.map(() => 0);
  if (candidates.length === 0) {
    return { estimateLevel: 'static', strategy: 'weighted', probabilities: resultByOriginalIndex };
  }

  const plan = input.plan || hydrateRuntimeSelectorPlan(input.policy);
  const strategy = plan.strategy as RuntimeSelectorStrategy || 'weighted';

  if (strategy === 'defer_to_router') {
    return {
      estimateLevel: 'dynamic',
      strategy,
      probabilities: input.candidates.map((candidate) => (candidate.enabled === false ? 0 : null)),
    };
  }

  if (selectorPlanHasUnavailableDynamicInputs(plan, state)) {
    return {
      estimateLevel: 'dynamic',
      strategy,
      probabilities: input.candidates.map((candidate) => (candidate.enabled === false ? 0 : null)),
    };
  }

  const ranked = evaluateRuntimeSelectorCandidates({ selectorId: input.selectorId, plan, candidates, state });
  if (ranked.length === 0) {
    return { estimateLevel: 'static', strategy, probabilities: resultByOriginalIndex };
  }

  if (strategy === 'direct') {
    if (!plan.selectEvaluator) {
      return {
        estimateLevel: 'dynamic',
        strategy,
        probabilities: input.candidates.map((candidate) => (candidate.enabled === false ? 0 : null)),
      };
    }
    const context = buildSelectorCelContext({ state, candidate: ranked[0]!, candidates: ranked });
    const direct = evaluatePlannedCelExpression(plan.selectEvaluator, context);
    const idx = isRecord(direct) ? numberOrFallback(direct.idx, Number.NaN) : numberOrFallback(direct, Number.NaN);
    if (!Number.isInteger(idx) || idx < 0 || idx >= ranked.length) {
      throw new RuntimeSelectorPolicyEvaluationError(input.selectorId, 'direct selection', 'expected an eligible option index');
    }
    const selected = ranked[idx];
    for (const candidate of ranked) resultByOriginalIndex[candidate.idx] = selected?.idx === candidate.idx ? 1 : 0;
    return { estimateLevel: 'static', strategy, probabilities: resultByOriginalIndex };
  }

  if (!STATIC_SELECTOR_STRATEGIES.has(strategy) && !strategy.startsWith('policy_')) {
    return {
      estimateLevel: 'unsupported',
      strategy,
      probabilities: input.candidates.map((candidate) => (candidate.enabled === false ? 0 : null)),
    };
  }

  if (strategy === 'round_robin' || strategy === 'policy_round_robin') {
    const probability = 1 / ranked.length;
    for (const candidate of ranked) resultByOriginalIndex[candidate.idx] = probability;
    return { estimateLevel: 'static', strategy, probabilities: resultByOriginalIndex };
  }

  if (strategy === 'stable_first' || strategy === 'policy_ordered') {
    const selected = [...ranked].sort((left, right) => left.order - right.order)[0] || null;
    for (const candidate of ranked) resultByOriginalIndex[candidate.idx] = selected?.idx === candidate.idx ? 1 : 0;
    return { estimateLevel: 'static', strategy, probabilities: resultByOriginalIndex };
  }

  const totalWeight = ranked.reduce((sum, candidate) => sum + candidateSelectionWeight(candidate), 0);
  for (const candidate of ranked) {
    resultByOriginalIndex[candidate.idx] = totalWeight > 0
      ? candidateSelectionWeight(candidate) / totalWeight
      : 1 / ranked.length;
  }
  return { estimateLevel: 'static', strategy, probabilities: resultByOriginalIndex };
}

export function rankContributionIndexes(
  contributions: number[],
  compareTieBreaker?: (leftIndex: number, rightIndex: number) => number,
): number[] {
  return contributions.map((_, index) => index)
    .sort((leftIndex, rightIndex) => {
      const contributionDiff = (contributions[rightIndex] ?? 0) - (contributions[leftIndex] ?? 0);
      if (Math.abs(contributionDiff) > 1e-9) {
        return contributionDiff > 0 ? 1 : -1;
      }
      return compareTieBreaker?.(leftIndex, rightIndex) ?? (leftIndex - rightIndex);
    });
}

export function selectWeightedContributionIndex(input: {
  contributions: number[];
  random?: () => number;
}): number | null {
  if (input.contributions.length === 0) return null;
  const totalContribution = input.contributions.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (totalContribution <= 0) {
    return Math.min(
      input.contributions.length - 1,
      Math.floor((input.random || Math.random)() * input.contributions.length),
    );
  }
  let cursor = (input.random || Math.random)() * totalContribution;
  for (let index = 0; index < input.contributions.length; index += 1) {
    cursor -= Math.max(0, input.contributions[index] ?? 0);
    if (cursor <= 0) return index;
  }
  return input.contributions.length - 1;
}

export function selectStableFirstContributionIndex(input: {
  rankedIndices: number[];
  stableLeaderIndices: number[];
  lastSelectedGroupId?: number | string;
  groupIdForIndex: (index: number) => number | string | null | undefined;
}): number | null {
  if (input.rankedIndices.length <= 0) return null;
  const stableLeaderIndices = input.stableLeaderIndices.length > 0
    ? input.stableLeaderIndices
    : input.rankedIndices;
  const lastSelectedIndex = input.lastSelectedGroupId == null
    ? -1
    : stableLeaderIndices.findIndex((index) => input.groupIdForIndex(index) === input.lastSelectedGroupId);
  const selectedLeaderIndex = stableLeaderIndices[lastSelectedIndex >= 0
    ? ((lastSelectedIndex + 1) % stableLeaderIndices.length)
    : 0];
  if (selectedLeaderIndex == null) return input.rankedIndices[0] ?? null;

  const selectedGroupId = input.groupIdForIndex(selectedLeaderIndex);
  const topGroupCandidateIndex = input.rankedIndices.find((index) => input.groupIdForIndex(index) === selectedGroupId);
  return topGroupCandidateIndex ?? selectedLeaderIndex;
}

export function selectContributionSnapshot(input: {
  contributions: number[];
  mode?: ContributionSelectorMode;
  random?: () => number;
  rankedIndices?: number[];
  stableLeaderIndices?: number[];
  lastSelectedGroupId?: number | string;
  groupIdForIndex?: (index: number) => number | string | null | undefined;
  compareTieBreaker?: (leftIndex: number, rightIndex: number) => number;
}): ContributionSelectorSnapshot {
  const rankedIndices = input.rankedIndices || rankContributionIndexes(input.contributions, input.compareTieBreaker);
  const rankByIndex = new Map<number, number>();
  rankedIndices.forEach((candidateIndex, rank) => {
    rankByIndex.set(candidateIndex, rank + 1);
  });
  const totalContribution = input.contributions.reduce((sum, value) => sum + Math.max(0, value), 0);
  const probabilities = input.contributions.map((value) => (
    totalContribution > 0 ? Math.max(0, value) / totalContribution : 1 / input.contributions.length
  ));
  const selectedIndex = input.mode === 'stable_first'
    ? selectStableFirstContributionIndex({
      rankedIndices,
      stableLeaderIndices: input.stableLeaderIndices || [],
      lastSelectedGroupId: input.lastSelectedGroupId,
      groupIdForIndex: input.groupIdForIndex || (() => null),
    })
    : selectWeightedContributionIndex({
      contributions: input.contributions,
      random: input.random,
    });

  return {
    totalContribution,
    probabilities,
    rankedIndices,
    rankByIndex,
    selectedIndex,
  };
}

export function __selectorEngineTestUtils() {
  return {
    celPlanCacheSize: () => celPlanCache.size,
    clearCelPlanCache: () => celPlanCache.clear(),
  };
}
