import type {
  CompiledEndpointTarget,
  RouteProgramSourceRef,
  RouteProgram,
  RouteProgramBundleV3,
  RouteProgramCandidate,
  RouteProgramOp,
} from '../../shared/routeGraph.js';
import {
  matchesTokenRouteModelPattern,
  parseTokenRouteRegexPattern,
} from '../../shared/tokenRoutePatterns.js';
import { evaluateUpstreamCostPricing } from './upstreamCostPricingService.js';

export type EntryPricingEstimateLevel = 'exact' | 'static_estimate' | 'incomplete';

export type EntryPricingCandidate = {
  targetId: string;
  endpointId: string;
  nodeId: string;
  channelId: string;
  siteId: number | null;
  accountId: number | null;
  tokenId: number | null;
  modelName: string;
  probability: number;
  weight: number | null;
  priority: number | null;
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  totalCostUsd: number | null;
  pricingId: number | null;
  matchedScope: string | null;
  sourceRef: RouteProgramSourceRef;
};

export type EntryPricingEstimate = {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  totalCostUsd: number | null;
  inputMultiplier: number | null;
  outputMultiplier: number | null;
  totalMultiplier: number | null;
  sourceCount: number;
  estimateLevel: EntryPricingEstimateLevel;
  strategy: string | null;
  diagnostics: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
  candidates: EntryPricingCandidate[];
};

const PREVIEW_USAGE = {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  requestCount: 1,
};
const ENTRY_PRICE_MULTIPLIER_BASE_PER_MILLION = 2;
const TOTAL_MULTIPLIER_BASE = ENTRY_PRICE_MULTIPLIER_BASE_PER_MILLION * 2;

type WeightedTarget = {
  target: CompiledEndpointTarget;
  probability: number;
  weight: number | null;
  priority: number | null;
  strategy: string | null;
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

function roundPrice(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 1_000_000) / 1_000_000;
}

function toMultiplier(price: number | null): number | null {
  if (price == null) return null;
  return roundPrice(price / ENTRY_PRICE_MULTIPLIER_BASE_PER_MILLION);
}

function totalMultiplier(total: number | null): number | null {
  if (total == null) return null;
  return roundPrice(total / TOTAL_MULTIPLIER_BASE);
}

function programMatchesModel(bundle: RouteProgramBundleV3, requestedModel: string): RouteProgram | null {
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

function probabilityForCandidates(
  policy: Record<string, unknown> | null | undefined,
  candidates: RouteProgramCandidate[],
): Array<{ candidate: RouteProgramCandidate; probability: number; strategy: string; incomplete: boolean }> {
  const enabled = candidates.filter((candidate) => candidate.enabled !== false);
  if (enabled.length === 0) return [];
  const strategy = asTrimmedString(policy?.strategy) || 'weighted';

  if (strategy === 'direct' || strategy === 'cel_select') {
    return enabled.map((candidate, index) => ({
      candidate,
      probability: index === 0 ? 1 : 0,
      strategy,
      incomplete: true,
    }));
  }

  if (strategy === 'stable_first') {
    return enabled.map((candidate, index) => ({
      candidate,
      probability: index === 0 ? 1 : 0,
      strategy,
      incomplete: false,
    }));
  }

  if (strategy === 'priority_order') {
    const maxPriority = Math.max(...enabled.map((candidate) => asFiniteNumber(candidate.priority) ?? 0));
    const top = enabled.filter((candidate) => (asFiniteNumber(candidate.priority) ?? 0) === maxPriority);
    const weightTotal = top.reduce((sum, candidate) => sum + (asPositiveNumber(candidate.weight) ?? 1), 0);
    return enabled.map((candidate) => {
      const active = top.includes(candidate);
      const weight = asPositiveNumber(candidate.weight) ?? 1;
      return {
        candidate,
        probability: active && weightTotal > 0 ? weight / weightTotal : 0,
        strategy,
        incomplete: false,
      };
    });
  }

  if (strategy === 'round_robin') {
    return enabled.map((candidate) => ({
      candidate,
      probability: 1 / enabled.length,
      strategy,
      incomplete: false,
    }));
  }

  const weightTotal = enabled.reduce((sum, candidate) => sum + (asPositiveNumber(candidate.weight) ?? 1), 0);
  return enabled.map((candidate) => {
    const weight = asPositiveNumber(candidate.weight) ?? 1;
    return {
      candidate,
      probability: weightTotal > 0 ? weight / weightTotal : 0,
      strategy,
      incomplete: false,
    };
  });
}

function probabilityForTargets(
  policy: Record<string, unknown> | null | undefined,
  targets: CompiledEndpointTarget[],
): Array<{ target: CompiledEndpointTarget; probability: number; weight: number | null; priority: number | null; strategy: string; incomplete: boolean }> {
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
  return probabilityForCandidates(policy, candidates)
    .map((item) => ({
      target: targets[candidates.indexOf(item.candidate)],
      probability: item.probability,
      weight: asFiniteNumber(item.candidate.weight),
      priority: asFiniteNumber(item.candidate.priority),
      strategy: item.strategy,
      incomplete: item.incomplete,
    }))
    .filter((item) => !!item.target);
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

  const visit = (opId: string | null | undefined, probability: number) => {
    const id = asTrimmedString(opId);
    if (!id || probability <= 0) return;
    const guardKey = `${id}:${probability}`;
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
      const weighted = probabilityForCandidates(op.policy, op.candidates || []);
      for (const item of weighted) {
        strategies.add(item.strategy);
        if (item.incomplete) incomplete = true;
        visit(item.candidate.targetOpId, probability * item.probability);
      }
      return;
    }

    if (op.op === 'select_supply') {
      const weighted = probabilityForTargets(op.targetSelectionPolicy, op.targets || []);
      for (const item of weighted) {
        strategies.add(item.strategy);
        if (item.incomplete) incomplete = true;
        targets.push({
          target: item.target,
          probability: probability * item.probability,
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

function componentUnitPrice(evaluation: NonNullable<Awaited<ReturnType<typeof evaluateUpstreamCostPricing>>>['evaluation'], kind: string): number | null {
  const component = evaluation.components.find((item) => item.kind === kind);
  return component ? roundPrice(component.unitPriceUsd) : null;
}

export async function estimateRouteEntryPricing(input: {
  bundle: RouteProgramBundleV3;
  requestedModel: string;
}): Promise<EntryPricingEstimate | null> {
  const program = programMatchesModel(input.bundle, input.requestedModel);
  if (!program) return null;

  const collected = collectProgramTargets({ program, requestedModel: input.requestedModel });
  const diagnostics: EntryPricingEstimate['diagnostics'] = [];
  let weightedInput = 0;
  let inputWeight = 0;
  let weightedOutput = 0;
  let outputWeight = 0;
  let weightedTotal = 0;
  let totalWeight = 0;

  const candidates = await Promise.all(collected.targets
    .filter((item) => item.probability > 0)
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
        message: `Missing site/account identity for target ${target.targetId || target.channelId}.`,
      });
      return {
        targetId: target.targetId,
        endpointId: target.endpointId,
        nodeId: target.nodeId,
        channelId: target.channelId,
        siteId,
        accountId,
        tokenId,
        modelName,
        probability: roundPrice(item.probability) ?? item.probability,
        weight: item.weight,
        priority: item.priority,
        inputPerMillion: null,
        outputPerMillion: null,
        totalCostUsd: null,
        pricingId: null,
        matchedScope: null,
        sourceRef: target.sourceRef || {},
      };
    }

    const evaluated = await evaluateUpstreamCostPricing({
      siteId,
      accountId,
      tokenId,
      tokenGroup: typeof target.metadata?.tokenGroup === 'string' ? target.metadata.tokenGroup : undefined,
      modelName,
      usage: PREVIEW_USAGE,
    });
    const inputPerMillion = evaluated ? componentUnitPrice(evaluated.evaluation, 'input_tokens') : null;
    const outputPerMillion = evaluated ? componentUnitPrice(evaluated.evaluation, 'output_tokens') : null;
    const totalCostUsd = evaluated ? roundPrice(evaluated.evaluation.totalCostUsd) : null;

    if (!evaluated) {
      diagnostics.push({
        level: 'info',
        message: `No configured upstream cost for ${modelName} on target ${target.targetId || target.channelId}.`,
      });
    }
    if (inputPerMillion != null) {
      weightedInput += inputPerMillion * item.probability;
      inputWeight += item.probability;
    }
    if (outputPerMillion != null) {
      weightedOutput += outputPerMillion * item.probability;
      outputWeight += item.probability;
    }
    if (totalCostUsd != null) {
      weightedTotal += totalCostUsd * item.probability;
      totalWeight += item.probability;
    }

    return {
      targetId: target.targetId,
      endpointId: target.endpointId,
      nodeId: target.nodeId,
      channelId: target.channelId,
      siteId,
      accountId,
      tokenId,
      modelName,
      probability: roundPrice(item.probability) ?? item.probability,
      weight: item.weight,
      priority: item.priority,
      inputPerMillion,
      outputPerMillion,
      totalCostUsd,
      pricingId: evaluated?.pricing.id ?? null,
      matchedScope: evaluated?.matchedScope ?? null,
      sourceRef: target.sourceRef || {},
    };
  }));

  if (candidates.length === 0) return null;
  const inputPerMillion = inputWeight > 0 ? roundPrice(weightedInput / inputWeight) : null;
  const outputPerMillion = outputWeight > 0 ? roundPrice(weightedOutput / outputWeight) : null;
  const totalCostUsd = totalWeight > 0 ? roundPrice(weightedTotal / totalWeight) : null;
  const estimateLevel: EntryPricingEstimateLevel = collected.incomplete
    ? 'incomplete'
    : (diagnostics.length > 0 ? 'static_estimate' : 'exact');

  return {
    inputPerMillion,
    outputPerMillion,
    totalCostUsd,
    inputMultiplier: toMultiplier(inputPerMillion),
    outputMultiplier: toMultiplier(outputPerMillion),
    totalMultiplier: totalMultiplier(totalCostUsd),
    sourceCount: candidates.filter((candidate) => candidate.totalCostUsd != null || candidate.inputPerMillion != null || candidate.outputPerMillion != null).length,
    estimateLevel,
    strategy: collected.strategies.size === 1 ? [...collected.strategies][0] : (collected.strategies.size > 1 ? 'mixed' : null),
    diagnostics,
    candidates,
  };
}
