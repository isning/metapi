import { celEnv, isCelError, parse, plan } from '@bufbuild/cel';

export type RuntimeSelectorStrategy =
  | 'weighted'
  | 'priority_order'
  | 'round_robin'
  | 'stable_first'
  | 'direct'
  | 'defer_to_router';

export type RuntimeSelectorPolicy = Record<string, unknown>;

export type RuntimeSelectorState = {
  requestedModel?: string;
  currentModel?: string;
  upstreamModel?: string;
  endpointPreference?: 'chat' | 'messages' | 'responses';
  stateStore?: Record<string, unknown>;
  payload?: Record<string, unknown>;
};

export type RuntimeSelectorCandidate<TPayload = unknown> = {
  idx: number;
  kind: string;
  nodeId?: string;
  edgeId?: string;
  metadata: Record<string, unknown>;
  runtime: Record<string, unknown>;
  enabled: boolean;
  weight: number;
  priority: number;
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
  'priority_order',
  'round_robin',
  'stable_first',
]);

type RuntimeScoreTermPlan = {
  source: string;
  weight: number;
  evaluator?: CelEvaluator | null;
  path?: string;
};

export type RuntimeSelectorPlan = {
  policy: RuntimeSelectorPolicy;
  strategy: RuntimeSelectorStrategy | string;
  selectEvaluator?: CelEvaluator | null;
  rankEvaluator?: CelEvaluator | null;
  scoreEvaluator?: CelEvaluator | null;
  scoreTerms: RuntimeScoreTermPlan[];
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

function getPathValue(input: unknown, path: string): unknown {
  const parts = path.split('.').map((part) => part.trim()).filter(Boolean);
  let cursor = input;
  for (const part of parts) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function numberOrFallback(value: unknown, fallback: number): number {
  const normalized = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function positiveNumberOrFallback(value: unknown, fallback: number): number {
  const normalized = numberOrFallback(value, fallback);
  return normalized > 0 ? normalized : fallback;
}

function booleanOrFallback(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isExpressionSource(source: string): boolean {
  return source.includes('(') || /[+\-*/?:<>=!]/.test(source);
}

function expressionDependsOnRequestState(expression: string): boolean {
  return /\b(payload|stateStore)\b/.test(expression);
}

function selectorPlanDependsOnRequestState(plan: RuntimeSelectorPlan): boolean {
  const policy = plan.policy;
  const expressions = [
    typeof policy.select === 'string' ? policy.select : '',
    typeof policy.rank === 'string' ? policy.rank : '',
    typeof policy.evaluate === 'string' ? policy.evaluate : '',
    typeof policy.expression === 'string' ? policy.expression : '',
    typeof policy.score === 'string' ? policy.score : '',
    typeof policy.scoreExpr === 'string' ? policy.scoreExpr : '',
    ...plan.scoreTerms.map((term) => term.source),
  ].filter(Boolean);
  return expressions.some(expressionDependsOnRequestState);
}

export function hydrateRuntimeSelectorPlan(policyInput?: RuntimeSelectorPolicy | null): RuntimeSelectorPlan {
  const policy = isRecord(policyInput) ? policyInput : DEFAULT_SELECTOR_POLICY;
  const cached = selectorPlanCache.get(policy);
  if (cached) return cached;
  const strategy = asTrimmedString(policy.strategy) || 'weighted';
  const rankExpression = typeof policy.rank === 'string'
    ? policy.rank
    : (typeof policy.evaluate === 'string'
      ? policy.evaluate
      : (typeof policy.expression === 'string' ? policy.expression : null));
  const scoreExpression = typeof policy.score === 'string'
    ? policy.score
    : (typeof policy.scoreExpr === 'string' ? policy.scoreExpr : null);
  const scoreTerms: RuntimeScoreTermPlan[] = Array.isArray(policy.score)
    ? policy.score
      .filter(isRecord)
      .map((item) => {
        const source = asTrimmedString(item.source);
        return {
          source,
          weight: numberOrFallback(item.weight, 1),
          ...(source && isExpressionSource(source)
            ? { evaluator: compileCelExpression(source) }
            : { path: source }),
        };
      })
      .filter((item) => item.source)
    : [];
  const planValue: RuntimeSelectorPlan = {
    policy,
    strategy,
    selectEvaluator: typeof policy.select === 'string' ? compileCelExpression(policy.select) : null,
    rankEvaluator: rankExpression ? compileCelExpression(rankExpression) : null,
    scoreEvaluator: scoreExpression ? compileCelExpression(scoreExpression) : null,
    scoreTerms,
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
    weight: candidate.weight,
    priority: candidate.priority,
    enabled: candidate.enabled,
    runtime: candidate.runtime,
  };
}

function buildSelectorCelContext(input: {
  state: RuntimeSelectorState;
  candidate: RuntimeSelectorCandidate;
  candidates: RuntimeSelectorCandidate[];
}): Record<string, unknown> {
  const payload = input.state.payload || {
    requestedModel: input.state.requestedModel ?? null,
    currentModel: input.state.currentModel ?? null,
    upstreamModel: input.state.upstreamModel ?? null,
    endpointPreference: input.state.endpointPreference ?? null,
  };
  return {
    payload,
    metadata: input.candidate.metadata,
    stateStore: input.state.stateStore || {},
    idx: input.candidate.idx,
    candidate: candidateForCel(input.candidate),
    candidates: input.candidates.map(candidateForCel),
  };
}

function applyScorePolicy<TPayload>(input: {
  plan: RuntimeSelectorPlan;
  candidate: RuntimeSelectorCandidate<TPayload>;
  candidates: RuntimeSelectorCandidate<TPayload>[];
  state: RuntimeSelectorState;
}): RuntimeSelectorCandidate<TPayload> {
  const context = buildSelectorCelContext(input);
  const next = { ...input.candidate };
  const rankResult = evaluatePlannedCelExpression(input.plan.rankEvaluator, context);
  if (isRecord(rankResult)) {
    next.enabled = booleanOrFallback(rankResult.enabled, next.enabled);
    next.weight = numberOrFallback(rankResult.weight, next.weight);
    next.priority = numberOrFallback(rankResult.priority, next.priority);
    next.score = numberOrFallback(rankResult.score, next.score);
  }

  if (input.plan.scoreEvaluator) {
    next.score = numberOrFallback(evaluatePlannedCelExpression(input.plan.scoreEvaluator, context), next.score);
  } else if (input.plan.scoreTerms.length > 0) {
    let score = 0;
    for (const item of input.plan.scoreTerms) {
      const rawValue = item.evaluator
        ? evaluatePlannedCelExpression(item.evaluator, context)
        : getPathValue(context, item.path || item.source);
      const value = numberOrFallback(rawValue, 0);
      score += value * item.weight;
    }
    next.score = score;
  }

  if (!Number.isFinite(next.score)) next.score = next.weight;
  return next;
}

export function selectWeightedRuntimeCandidate<TPayload>(
  candidates: RuntimeSelectorCandidate<TPayload>[],
  random = Math.random,
): RuntimeSelectorCandidate<TPayload> | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] || null;
  const weighted = candidates.map((candidate) => ({
    candidate,
    weight: positiveNumberOrFallback(candidate.weight, 1),
  }));
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return weighted[0]?.candidate || null;
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
  const stateStore = state.stateStore || {};
  const candidates = input.candidates.filter((candidate) => candidate.enabled !== false);
  if (candidates.length === 0) return null;
  const plan = input.plan || hydrateRuntimeSelectorPlan(input.policy);
  const strategy = plan.strategy as RuntimeSelectorStrategy || 'weighted';

  if (strategy === 'direct') {
    const context = buildSelectorCelContext({ state, candidate: candidates[0], candidates });
    const direct = evaluatePlannedCelExpression(plan.selectEvaluator, context);
    const idx = isRecord(direct) ? numberOrFallback(direct.idx, Number.NaN) : numberOrFallback(direct, Number.NaN);
    if (Number.isInteger(idx) && idx >= 0 && idx < candidates.length) return candidates[idx];
    return candidates[0] || null;
  }

  if (strategy === 'round_robin') {
    const key = `dispatcher:${input.selectorId}:round_robin`;
    const current = numberOrFallback(stateStore[key], 0);
    const normalizedIndex = candidates.length > 0 ? Math.abs(Math.trunc(current)) % candidates.length : 0;
    stateStore[key] = Math.max(0, Math.trunc(current)) + 1;
    return candidates[normalizedIndex] || null;
  }

  const ranked = candidates.map((candidate) => applyScorePolicy({
    plan,
    candidate,
    candidates,
    state: { ...state, stateStore },
  }));
  if (strategy === 'stable_first') {
    return [...ranked].sort((left, right) => left.order - right.order)[0] || null;
  }
  if (strategy === 'priority_order') {
    const maxPriority = Math.max(...ranked.map((candidate) => candidate.priority));
    return selectWeightedRuntimeCandidate(ranked.filter((candidate) => candidate.priority === maxPriority), input.random);
  }
  if (plan.scoreEvaluator || plan.scoreTerms.length > 0) {
    return [...ranked].sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.weight !== left.weight) return right.weight - left.weight;
      if (right.priority !== left.priority) return right.priority - left.priority;
      return left.order - right.order;
    })[0] || null;
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

  if (strategy === 'direct' || strategy === 'defer_to_router') {
    return {
      estimateLevel: 'dynamic',
      strategy,
      probabilities: input.candidates.map((candidate) => (candidate.enabled === false ? 0 : null)),
    };
  }

  if (!STATIC_SELECTOR_STRATEGIES.has(strategy) && !(plan.scoreEvaluator || plan.scoreTerms.length > 0)) {
    return {
      estimateLevel: 'unsupported',
      strategy,
      probabilities: input.candidates.map((candidate) => (candidate.enabled === false ? 0 : null)),
    };
  }

  if (selectorPlanDependsOnRequestState(plan)) {
    return {
      estimateLevel: 'dynamic',
      strategy,
      probabilities: input.candidates.map((candidate) => (candidate.enabled === false ? 0 : null)),
    };
  }

  if (strategy === 'round_robin') {
    const probability = candidates.length > 0 ? 1 / candidates.length : 0;
    for (const candidate of candidates) resultByOriginalIndex[candidate.idx] = probability;
    return { estimateLevel: 'static', strategy, probabilities: resultByOriginalIndex };
  }

  const ranked = candidates.map((candidate) => applyScorePolicy({
    plan,
    candidate,
    candidates,
    state,
  }));

  if (strategy === 'stable_first') {
    const selected = [...ranked].sort((left, right) => left.order - right.order)[0] || null;
    for (const candidate of ranked) resultByOriginalIndex[candidate.idx] = selected?.idx === candidate.idx ? 1 : 0;
    return { estimateLevel: 'static', strategy, probabilities: resultByOriginalIndex };
  }

  if (strategy === 'priority_order') {
    const maxPriority = Math.max(...ranked.map((candidate) => candidate.priority));
    const top = ranked.filter((candidate) => candidate.priority === maxPriority);
    const totalWeight = top.reduce((sum, candidate) => sum + positiveNumberOrFallback(candidate.weight, 1), 0);
    for (const candidate of ranked) {
      resultByOriginalIndex[candidate.idx] = top.includes(candidate) && totalWeight > 0
        ? positiveNumberOrFallback(candidate.weight, 1) / totalWeight
        : 0;
    }
    return { estimateLevel: 'static', strategy, probabilities: resultByOriginalIndex };
  }

  if (plan.scoreEvaluator || plan.scoreTerms.length > 0) {
    const selected = [...ranked].sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.weight !== left.weight) return right.weight - left.weight;
      if (right.priority !== left.priority) return right.priority - left.priority;
      return left.order - right.order;
    })[0] || null;
    for (const candidate of ranked) resultByOriginalIndex[candidate.idx] = selected?.idx === candidate.idx ? 1 : 0;
    return { estimateLevel: 'static', strategy, probabilities: resultByOriginalIndex };
  }

  const totalWeight = ranked.reduce((sum, candidate) => sum + positiveNumberOrFallback(candidate.weight, 1), 0);
  for (const candidate of ranked) {
    resultByOriginalIndex[candidate.idx] = totalWeight > 0
      ? positiveNumberOrFallback(candidate.weight, 1) / totalWeight
      : 0;
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
    totalContribution > 0 ? Math.max(0, value) / totalContribution : 0
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
