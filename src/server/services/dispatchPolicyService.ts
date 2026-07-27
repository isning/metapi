import { config } from '../config.js';
import type { RuntimeSelectorPolicy } from './selectorEngine.js';
import { evaluateSelectorCelExpression, validateSelectorCelExpression } from './selectorEngine.js';
import {
  defaultDispatchPolicyRegistry,
  type DispatchPolicyDefinition,
  type DispatchPolicyRef,
  type DispatchPolicyRegistry,
  type DispatchSelectionMode,
} from './dispatchPolicyTypes.js';

export type { DispatchPolicyDefinition, DispatchPolicyRef, DispatchPolicyRegistry, DispatchSelectionMode } from './dispatchPolicyTypes.js';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const POLICY_VALIDATION_CANDIDATE = {
  idx: 0,
  enabled: true,
  weight: 1,
  score: 1,
  order: 0,
  metadata: {},
  runtime: { routingSignals: { normalizedCostScore: 0.5, normalizedBalanceScore: 0.5, normalizedUsageScore: 0.5 } },
  selection: { metadata: {}, runtime: {} },
  endpoint: { metadata: {}, runtime: {} },
  executionAttempt: { metadata: {}, runtime: {} },
  plan: { metadata: {}, runtime: {} },
  graph: { metadata: {}, runtime: {} },
};

const POLICY_VALIDATION_CONTEXT = {
  request: { payload: {}, headers: {}, query: {}, requestedModel: 'validation-model' },
  payload: {},
  headers: {},
  stateStore: {},
  idx: 0,
  self: POLICY_VALIDATION_CANDIDATE,
  candidates: [POLICY_VALIDATION_CANDIDATE],
  metadata: {},
  runtime: { routingSignals: { normalizedCostScore: 0.5, normalizedBalanceScore: 0.5, normalizedUsageScore: 0.5 } },
  selection: { metadata: {}, runtime: {} },
  endpoint: { metadata: {}, runtime: {} },
  executionAttempt: { metadata: {}, runtime: {} },
  plan: { metadata: {}, runtime: {} },
  graph: { metadata: {}, runtime: {} },
};

function expressionContractError(
  expression: string | undefined,
  expected: 'boolean' | 'number' | 'index',
): string | null {
  if (!expression) return null;
  const contexts = [
    POLICY_VALIDATION_CONTEXT,
    {
      ...POLICY_VALIDATION_CONTEXT,
      candidates: [
        POLICY_VALIDATION_CANDIDATE,
        { ...POLICY_VALIDATION_CANDIDATE, idx: 1, weight: 2, order: 1 },
      ],
    },
  ];
  for (const context of contexts) {
    const result = evaluateSelectorCelExpression(expression, context);
    if (expected === 'boolean') {
      if (typeof result !== 'boolean') return 'Expression must return a boolean for the standard selector scope.';
      continue;
    }
    const numeric = Number(result);
    if (!Number.isFinite(numeric)) return 'Expression must return a finite number for the standard selector scope.';
    if (expected === 'index' && (!Number.isInteger(numeric) || numeric < 0)) {
      return 'Direct selection expression must return a non-negative integer option index.';
    }
  }
  return null;
}

function normalizeDefinition(value: unknown): DispatchPolicyDefinition | null {
  if (!isRecord(value)) return null;
  const id = asText(value.id);
  const name = asText(value.name);
  const kind = value.kind === 'builtin' ? 'builtin' : value.kind === 'cel' ? 'cel' : null;
  const selectionMode = ['weighted', 'ordered', 'round_robin', 'direct'].includes(String(value.selectionMode))
    ? value.selectionMode as DispatchSelectionMode
    : null;
  if (!id || !name || !kind || !selectionMode) return null;
  const builtin = ['weighted', 'round_robin', 'stable_first'].includes(String(value.builtin))
    ? value.builtin as DispatchPolicyDefinition['builtin']
    : undefined;
  return {
    id,
    name,
    kind,
    selectionMode,
    ...(asText(value.eligibilityExpression) ? { eligibilityExpression: asText(value.eligibilityExpression) } : {}),
    ...(asText(value.contributionExpression) ? { contributionExpression: asText(value.contributionExpression) } : {}),
    ...(asText(value.orderExpression) ? { orderExpression: asText(value.orderExpression) } : {}),
    ...(asText(value.selectExpression) ? { selectExpression: asText(value.selectExpression) } : {}),
    ...(builtin ? { builtin } : {}),
  };
}

export function normalizeDispatchPolicyRegistry(value: unknown): DispatchPolicyRegistry {
  if (!isRecord(value) || !Array.isArray(value.policies)) return defaultDispatchPolicyRegistry();
  const policies = value.policies.map(normalizeDefinition).filter((item): item is DispatchPolicyDefinition => !!item);
  const unique = new Map(policies.map((policy) => [policy.id, policy]));
  const defaultPolicyId = asText(value.defaultPolicyId);
  if (!defaultPolicyId || !unique.has(defaultPolicyId)) return defaultDispatchPolicyRegistry();
  return { defaultPolicyId, policies: Array.from(unique.values()) };
}

export function validateDispatchPolicyRegistry(value: unknown): { value: DispatchPolicyRegistry | null; errors: string[] } {
  if (!isRecord(value) || !Array.isArray(value.policies)) {
    return { value: null, errors: ['Policy registry must contain a policies array.'] };
  }
  const policies = value.policies.map(normalizeDefinition);
  if (policies.some((policy) => !policy)) return { value: null, errors: ['Every policy requires id, name, kind, and selection mode.'] };
  const normalized = policies as DispatchPolicyDefinition[];
  const ids = normalized.map((policy) => policy.id);
  if (new Set(ids).size !== ids.length) return { value: null, errors: ['Policy IDs must be unique.'] };
  const defaultPolicyId = asText(value.defaultPolicyId);
  if (!normalized.some((policy) => policy.id === defaultPolicyId)) {
    return { value: null, errors: ['The default policy must reference a registry policy.'] };
  }
  const errors = normalized.flatMap((policy) => {
    if (policy.kind === 'builtin') {
      if (!policy.builtin) return [`Builtin policy ${policy.id} is missing its strategy.`];
      const expectedMode = policy.builtin === 'weighted'
        ? 'weighted'
        : policy.builtin === 'round_robin'
          ? 'round_robin'
          : 'ordered';
      return policy.selectionMode === expectedMode
        ? []
        : [`Builtin policy ${policy.id} must use ${expectedMode} selection mode.`];
    }
    const contributionError = policy.selectionMode === 'weighted'
      ? validateSelectorCelExpression(policy.contributionExpression)
      : null;
    const eligibilityError = policy.eligibilityExpression ? validateSelectorCelExpression(policy.eligibilityExpression) : null;
    const orderError = policy.selectionMode === 'ordered'
      ? validateSelectorCelExpression(policy.orderExpression)
      : (policy.orderExpression ? validateSelectorCelExpression(policy.orderExpression) : null);
    const selectError = policy.selectionMode === 'direct'
      ? validateSelectorCelExpression(policy.selectExpression)
      : (policy.selectExpression ? validateSelectorCelExpression(policy.selectExpression) : null);
    const contributionContractError = !contributionError && policy.selectionMode === 'weighted'
      ? expressionContractError(policy.contributionExpression, 'number')
      : null;
    const eligibilityContractError = !eligibilityError && policy.eligibilityExpression
      ? expressionContractError(policy.eligibilityExpression, 'boolean')
      : null;
    const orderContractError = !orderError && policy.orderExpression
      ? expressionContractError(policy.orderExpression, 'number')
      : null;
    const selectContractError = !selectError && policy.selectExpression
      ? expressionContractError(policy.selectExpression, 'index')
      : null;
    return [contributionError, eligibilityError, orderError, selectError, contributionContractError, eligibilityContractError, orderContractError, selectContractError]
      .filter((error): error is string => !!error)
      .map((error) => `Policy ${policy.id}: ${error}`);
  });
  return errors.length > 0
    ? { value: null, errors }
    : { value: { defaultPolicyId, policies: normalized }, errors: [] };
}

function policyFromReference(value: unknown): DispatchPolicyRef | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'inherit_default') return { kind: 'inherit_default' };
  if (value.kind === 'registry' && asText(value.policyId)) return { kind: 'registry', policyId: asText(value.policyId) };
  if (value.kind === 'builtin' && ['weighted', 'round_robin', 'stable_first'].includes(String(value.builtin))) {
    return { kind: 'builtin', builtin: value.builtin as NonNullable<DispatchPolicyDefinition['builtin']> };
  }
  const inline = normalizeDefinition(value.policy);
  return value.kind === 'inline' && inline ? { kind: 'inline', policy: inline } : null;
}

function selectorPolicyFromDefinition(policy: DispatchPolicyDefinition): RuntimeSelectorPolicy {
  if (policy.kind === 'builtin') {
    return { strategy: policy.builtin || 'weighted' };
  }
  return {
    strategy: policy.selectionMode === 'direct' ? 'direct' : `policy_${policy.selectionMode}`,
    ...(policy.eligibilityExpression ? { eligibility: policy.eligibilityExpression } : {}),
    ...(policy.contributionExpression ? { contribution: policy.contributionExpression } : {}),
    ...(policy.orderExpression ? { order: policy.orderExpression } : {}),
    ...(policy.selectExpression ? { select: policy.selectExpression } : {}),
  };
}

export function resolveDispatchSelectorPolicy(policyValue: unknown): {
  selectorPolicy: RuntimeSelectorPolicy;
  resolvedPolicy: DispatchPolicyDefinition | null;
  source: 'default' | 'registry' | 'inline' | 'builtin';
} {
  const registry = normalizeDispatchPolicyRegistry(config.dispatchPolicyRegistry);
  const reference = policyFromReference(policyValue);
  if (reference?.kind === 'inline') {
    return { selectorPolicy: selectorPolicyFromDefinition(reference.policy), resolvedPolicy: reference.policy, source: 'inline' };
  }
  if (reference?.kind === 'builtin') {
    const selectionMode = reference.builtin === 'weighted'
      ? 'weighted'
      : reference.builtin === 'round_robin'
        ? 'round_robin'
        : 'ordered';
    const resolvedPolicy: DispatchPolicyDefinition = {
      id: reference.builtin,
      name: reference.builtin,
      kind: 'builtin',
      builtin: reference.builtin,
      selectionMode,
    };
    return { selectorPolicy: selectorPolicyFromDefinition(resolvedPolicy), resolvedPolicy, source: 'builtin' };
  }
  if (reference?.kind === 'registry' || reference?.kind === 'inherit_default') {
    const policyId = reference.kind === 'registry' ? reference.policyId : registry.defaultPolicyId;
    const resolvedPolicy = registry.policies.find((policy) => policy.id === policyId) || null;
    if (!resolvedPolicy) throw new Error(`Dispatch policy ${policyId} is not available.`);
    return {
      selectorPolicy: selectorPolicyFromDefinition(resolvedPolicy),
      resolvedPolicy,
      source: reference.kind === 'registry' ? 'registry' : 'default',
    };
  }
  if (policyValue != null) {
    throw new Error('Dispatch policy reference is invalid.');
  }
  const resolvedPolicy = registry.policies.find((policy) => policy.id === registry.defaultPolicyId) || null;
  if (!resolvedPolicy) throw new Error(`Dispatch policy ${registry.defaultPolicyId} is not available.`);
  return {
    selectorPolicy: selectorPolicyFromDefinition(resolvedPolicy),
    resolvedPolicy,
    source: 'default',
  };
}
