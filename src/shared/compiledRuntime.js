// This module is deliberately source-graph agnostic. It owns the persisted
// runtime bundle representation and its compact-table materialization.

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function packedTupleValue(value) {
  return isPlainObject(value) ? value : null;
}

const EXECUTION_ATTEMPT_TRANSPORT_BINDING_INDEX = 9;

export function getCompiledExecutionAttemptId(target) {
  const executionAttemptId = normalizeString(target?.executionAttemptId);
  return executionAttemptId || null;
}

export function getCompiledExecutionTargetId(target) {
  const binding = isPlainObject(target?.transportBinding) ? target.transportBinding : null;
  if (binding?.kind !== 'execution_target') return null;
  const executionTargetId = Number(binding.executionTargetId);
  return Number.isSafeInteger(executionTargetId) && executionTargetId > 0
    ? Math.trunc(executionTargetId)
    : null;
}

function createPackedExecutionTable() {
  const policies = [];
  const terms = [];
  const fallbackStages = [];
  const terminals = [];
  const endpoints = [];
  const attempts = [];
  const syntheticResponses = [];
  const filterSets = [];
  const indexes = new Map();
  const intern = (table, kind, value) => {
    const key = `${kind}:${JSON.stringify(value)}`;
    const existing = indexes.get(key);
    if (existing != null) return existing;
    const index = table.length;
    table.push(value);
    indexes.set(key, index);
    return index;
  };
  const policyIndex = (value) => intern(policies, 'policy', isPlainObject(value) ? value : { kind: 'inherit_default' });
  const termIndex = (term) => intern(terms, 'term', [
    normalizeString(term?.termId), normalizeString(term?.nodeId) || null,
    normalizeString(term?.mode) || 'route', policyIndex(term?.policy), normalizeString(term?.optionId),
    Number.isFinite(Number(term?.optionIndex)) ? Number(term.optionIndex) : 0,
    normalizeString(term?.optionKind) || 'route', term?.enabled === false ? 0 : 1,
    Number.isFinite(Number(term?.weight)) ? Number(term.weight) : 1,
    Number.isFinite(Number(term?.order)) ? Number(term.order) : 0,
    Number.isFinite(Number(term?.controlOrder)) ? Number(term.controlOrder) : 0,
    packedTupleValue(term?.metadata), packedTupleValue(term?.runtime), packedTupleValue(term?.sourceRef), packedTupleValue(term?.failureBackoff),
  ]);
  const fallbackStageIndex = (stage) => intern(fallbackStages, 'fallback', [
    normalizeString(stage?.fallbackId), normalizeString(stage?.stageId),
    Number.isFinite(Number(stage?.stageIndex)) ? Number(stage.stageIndex) : 0,
    normalizeString(stage?.nodeId), Number.isFinite(Number(stage?.controlOrder)) ? Number(stage.controlOrder) : 0,
    packedTupleValue(stage?.sourceRef),
  ]);
  const terminalIndex = (terminal) => {
    if (!terminal) return null;
    return terminal.kind === 'synthetic'
      ? intern(terminals, 'terminal', ['synthetic', normalizeString(terminal.nodeId), terminal.statusCode === 429 ? 429 : 503, normalizeString(terminal.message) || 'No route is available.', packedTupleValue(terminal.metadata), packedTupleValue(terminal.runtime), packedTupleValue(terminal.sourceRef)])
      : intern(terminals, 'terminal', ['supply', normalizeString(terminal.endpointId)]);
  };
  const endpointIndex = (endpoint) => !endpoint ? null : intern(endpoints, 'endpoint', [
    normalizeString(endpoint.endpointId), normalizeString(endpoint.nodeId), endpoint.model == null ? null : normalizeString(endpoint.model),
    packedTupleValue(endpoint.compatibilityPolicy), packedTupleValue(endpoint.metadata), packedTupleValue(endpoint.runtime), packedTupleValue(endpoint.sourceRef),
  ]);
  const attemptIndex = (attempt) => !attempt ? null : intern(attempts, 'attempt', [
    normalizeString(attempt.targetId), normalizeString(attempt.executionAttemptId), normalizeString(attempt.model),
    attempt.modelSource === 'request' ? 'request' : 'fixed', attempt.enabled === false ? 0 : 1,
    attempt.accountId == null ? null : attempt.accountId, attempt.tokenId == null ? null : attempt.tokenId,
    attempt.siteId == null ? null : attempt.siteId, Number.isFinite(Number(attempt.weight)) ? Number(attempt.weight) : null,
    packedTupleValue(attempt.transportBinding), packedTupleValue(attempt.metadata), packedTupleValue(attempt.runtime),
    packedTupleValue(attempt.compatibilityPolicy), packedTupleValue(attempt.failureBackoff), packedTupleValue(attempt.sourceRef),
    normalizeString(attempt.executionTargetSourceRef) || null,
  ]);
  const syntheticResponseIndex = (response) => !response ? null : intern(syntheticResponses, 'synthetic', [
    normalizeString(response.nodeId), response.statusCode === 429 ? 429 : 503, normalizeString(response.message) || 'No route is available.',
    packedTupleValue(response.metadata), packedTupleValue(response.runtime), packedTupleValue(response.sourceRef),
  ]);
  const filterSetIndex = (values) => intern(filterSets, 'filters', Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : []);
  return {
    packPlan: (plan) => ({
      ...plan,
      executionAlternatives: (Array.isArray(plan.executionAlternatives) ? plan.executionAlternatives : []).map((alternative) => ({
        alternativeId: normalizeString(alternative?.alternativeId),
        kind: alternative?.kind === 'synthetic_response' ? 'synthetic_response' : alternative?.kind === 'endpoint_delegation' ? 'endpoint_delegation' : 'execution_attempt',
        enabled: alternative?.enabled !== false,
        filters: filterSetIndex(alternative?.filterStageIndexes),
        terms: (Array.isArray(alternative?.selectionTerms) ? alternative.selectionTerms : []).map(termIndex),
        fallbacks: (Array.isArray(alternative?.fallbackStages) ? alternative.fallbackStages : []).map(fallbackStageIndex),
        terminal: terminalIndex(alternative?.terminal), endpoint: endpointIndex(alternative?.endpoint), attempt: attemptIndex(alternative?.executionAttempt), synthetic: syntheticResponseIndex(alternative?.syntheticResponse),
        ...(packedTupleValue(alternative?.metadata) ? { metadata: alternative.metadata } : {}),
        ...(packedTupleValue(alternative?.runtime) ? { runtime: alternative.runtime } : {}),
      })),
    }),
    executionTable: () => ({ policies, terms, fallbackStages, terminals, endpoints, attempts, syntheticResponses, filterSets }),
  };
}

function unpackAlternative(table, alternative) {
  const unpackTerm = (tuple) => ({
    termId: normalizeString(tuple?.[0]), ...(normalizeString(tuple?.[1]) ? { nodeId: normalizeString(tuple[1]) } : {}), mode: normalizeString(tuple?.[2]) || 'route',
    policy: isPlainObject(table?.policies?.[tuple?.[3]]) ? table.policies[tuple[3]] : { kind: 'inherit_default' }, optionId: normalizeString(tuple?.[4]),
    optionIndex: Number.isFinite(Number(tuple?.[5])) ? Number(tuple[5]) : 0, optionKind: normalizeString(tuple?.[6]) || 'route', enabled: tuple?.[7] !== 0,
    weight: Number.isFinite(Number(tuple?.[8])) ? Number(tuple[8]) : 1, order: Number.isFinite(Number(tuple?.[9])) ? Number(tuple[9]) : 0,
    controlOrder: Number.isFinite(Number(tuple?.[10])) ? Number(tuple[10]) : 0, ...(packedTupleValue(tuple?.[11]) ? { metadata: tuple[11] } : {}),
    ...(packedTupleValue(tuple?.[12]) ? { runtime: tuple[12] } : {}), ...(packedTupleValue(tuple?.[13]) ? { sourceRef: tuple[13] } : {}), ...(packedTupleValue(tuple?.[14]) ? { failureBackoff: tuple[14] } : {}),
  });
  const unpackFallback = (tuple) => ({ fallbackId: normalizeString(tuple?.[0]), stageId: normalizeString(tuple?.[1]), stageIndex: Number.isFinite(Number(tuple?.[2])) ? Number(tuple[2]) : 0, nodeId: normalizeString(tuple?.[3]), controlOrder: Number.isFinite(Number(tuple?.[4])) ? Number(tuple[4]) : 0, ...(packedTupleValue(tuple?.[5]) ? { sourceRef: tuple[5] } : {}) });
  const terminalTuple = table?.terminals?.[alternative?.terminal];
  const terminal = terminalTuple?.[0] === 'synthetic'
    ? { kind: 'synthetic', nodeId: normalizeString(terminalTuple?.[1]), statusCode: terminalTuple?.[2] === 429 ? 429 : 503, message: normalizeString(terminalTuple?.[3]) || 'No route is available.', ...(packedTupleValue(terminalTuple?.[4]) ? { metadata: terminalTuple[4] } : {}), ...(packedTupleValue(terminalTuple?.[5]) ? { runtime: terminalTuple[5] } : {}), ...(packedTupleValue(terminalTuple?.[6]) ? { sourceRef: terminalTuple[6] } : {}) }
    : { kind: 'supply', endpointId: normalizeString(terminalTuple?.[1]) };
  const endpointTuple = table?.endpoints?.[alternative?.endpoint];
  const attemptTuple = table?.attempts?.[alternative?.attempt];
  const syntheticTuple = table?.syntheticResponses?.[alternative?.synthetic];
  return {
    alternativeId: normalizeString(alternative?.alternativeId), kind: alternative?.kind === 'synthetic_response' ? 'synthetic_response' : alternative?.kind === 'endpoint_delegation' ? 'endpoint_delegation' : 'execution_attempt', enabled: alternative?.enabled !== false,
    filterStageIndexes: Array.isArray(table?.filterSets?.[alternative?.filters]) ? [...table.filterSets[alternative.filters]] : [],
    selectionTerms: (Array.isArray(alternative?.terms) ? alternative.terms : []).map((index) => unpackTerm(table?.terms?.[index])).filter((term) => term.termId),
    fallbackStages: (Array.isArray(alternative?.fallbacks) ? alternative.fallbacks : []).map((index) => unpackFallback(table?.fallbackStages?.[index])).filter((stage) => stage.fallbackId && stage.stageId),
    terminal,
    endpoint: Array.isArray(endpointTuple) ? { endpointId: normalizeString(endpointTuple[0]), nodeId: normalizeString(endpointTuple[1]), model: endpointTuple[2] == null ? null : normalizeString(endpointTuple[2]), ...(packedTupleValue(endpointTuple[3]) ? { compatibilityPolicy: endpointTuple[3] } : {}), ...(packedTupleValue(endpointTuple[4]) ? { metadata: endpointTuple[4] } : {}), ...(packedTupleValue(endpointTuple[5]) ? { runtime: endpointTuple[5] } : {}), ...(packedTupleValue(endpointTuple[6]) ? { sourceRef: endpointTuple[6] } : {}) } : null,
    executionAttempt: Array.isArray(attemptTuple) ? { targetId: normalizeString(attemptTuple[0]), executionAttemptId: normalizeString(attemptTuple[1]), model: normalizeString(attemptTuple[2]), modelSource: attemptTuple[3] === 'request' ? 'request' : 'fixed', enabled: attemptTuple[4] !== 0, ...(attemptTuple[5] == null ? {} : { accountId: attemptTuple[5] }), ...(attemptTuple[6] == null ? {} : { tokenId: attemptTuple[6] }), ...(attemptTuple[7] == null ? {} : { siteId: attemptTuple[7] }), ...(attemptTuple[8] == null ? {} : { weight: Number(attemptTuple[8]) }), ...(packedTupleValue(attemptTuple[9]) ? { transportBinding: attemptTuple[9] } : {}), ...(packedTupleValue(attemptTuple[10]) ? { metadata: attemptTuple[10] } : {}), ...(packedTupleValue(attemptTuple[11]) ? { runtime: attemptTuple[11] } : {}), ...(packedTupleValue(attemptTuple[12]) ? { compatibilityPolicy: attemptTuple[12] } : {}), ...(packedTupleValue(attemptTuple[13]) ? { failureBackoff: attemptTuple[13] } : {}), ...(packedTupleValue(attemptTuple[14]) ? { sourceRef: attemptTuple[14] } : {}), ...(normalizeString(attemptTuple[15]) ? { executionTargetSourceRef: normalizeString(attemptTuple[15]) } : {}) } : null,
    syntheticResponse: Array.isArray(syntheticTuple) ? { nodeId: normalizeString(syntheticTuple[0]), statusCode: syntheticTuple[1] === 429 ? 429 : 503, message: normalizeString(syntheticTuple[2]) || 'No route is available.', ...(packedTupleValue(syntheticTuple[3]) ? { metadata: syntheticTuple[3] } : {}), ...(packedTupleValue(syntheticTuple[4]) ? { runtime: syntheticTuple[4] } : {}), ...(packedTupleValue(syntheticTuple[5]) ? { sourceRef: syntheticTuple[5] } : {}) } : null,
    ...(packedTupleValue(alternative?.metadata) ? { metadata: alternative.metadata } : {}), ...(packedTupleValue(alternative?.runtime) ? { runtime: alternative.runtime } : {}),
  };
}

export function compactCompiledRouterBundle(bundle) {
  if (!isPlainObject(bundle) || !Array.isArray(bundle.plans) || isPlainObject(bundle.executionTable)) return bundle;
  const packer = createPackedExecutionTable();
  const plans = bundle.plans.map((plan) => packer.packPlan(plan));
  return { ...bundle, plans, executionTable: packer.executionTable() };
}

export function materializeCompiledRouterPlan(bundle, plan) {
  const table = isPlainObject(bundle?.executionTable) ? bundle.executionTable : null;
  if (!table || !isPlainObject(plan) || !Array.isArray(plan.executionAlternatives) || !plan.executionAlternatives.some((alternative) => isPlainObject(alternative) && Array.isArray(alternative.terms))) return plan;
  return { ...plan, executionAlternatives: plan.executionAlternatives.map((alternative) => unpackAlternative(table, alternative)) };
}

export function getCompiledRouterPlanById(bundle, planId) {
  const id = normalizeString(planId);
  if (!id || !isPlainObject(bundle) || !Array.isArray(bundle.plans) || !isPlainObject(bundle.planIndex)) return null;
  const index = Number(bundle.planIndex[id]);
  if (!Number.isSafeInteger(index) || index < 0 || index >= bundle.plans.length) return null;
  const plan = bundle.plans[index];
  return isPlainObject(plan) && normalizeString(plan.id) === id ? materializeCompiledRouterPlan(bundle, plan) : null;
}

export function getCompiledRouterExecutionTargetIds(bundle) {
  const ids = new Set();
  for (const attempt of Array.isArray(bundle?.executionTable?.attempts) ? bundle.executionTable.attempts : []) {
    const executionTargetId = getCompiledExecutionTargetId(
      { transportBinding: packedTupleValue(attempt?.[EXECUTION_ATTEMPT_TRANSPORT_BINDING_INDEX]) },
    );
    if (Number.isSafeInteger(executionTargetId) && executionTargetId > 0) ids.add(Math.trunc(executionTargetId));
  }
  return [...ids];
}

function validIndex(value, table) {
  const index = Number(value);
  return Number.isSafeInteger(index) && index >= 0 && index < table.length;
}

function validateDispatcherPolicy(policy) {
  if (!isPlainObject(policy)) return false;
  if (policy.kind === 'inherit_default') return true;
  if (policy.kind === 'registry') return !!normalizeString(policy.policyId);
  if (policy.kind === 'inline') return isPlainObject(policy.policy);
  if (policy.kind === 'builtin') {
    return policy.builtin === 'weighted'
      || policy.builtin === 'round_robin'
      || policy.builtin === 'stable_first';
  }
  return false;
}

function validateMatcherTarget(target, plansById) {
  if (!isPlainObject(target)) return false;
  const programId = normalizeString(target.programId);
  const plan = plansById.get(programId);
  return !!plan
    && normalizeString(target.entryNodeId) === normalizeString(plan.entryNodeId)
    && !!normalizeString(target.publicModelName);
}

/** Strict, versionless parser guard for persisted compiled-runtime bundles. */
export function validateCompiledRouterBundle(bundle) {
  const fail = (reason) => ({ ok: false, reason });
  if (!isPlainObject(bundle)) return fail('bundle_not_object');
  if (!normalizeString(bundle.hash)) return fail('bundle_hash_required');
  if (!isPlainObject(bundle.matcher)) return fail('matcher_invalid');
  if (!Array.isArray(bundle.plans)) return fail('plans_invalid');
  if (!isPlainObject(bundle.planIndex)) return fail('plan_index_invalid');
  if (!isPlainObject(bundle.executionTable)) return fail('execution_table_invalid');
  if (!Array.isArray(bundle.diagnostics)) return fail('diagnostics_invalid');
  if (bundle.diagnostics.some((diagnostic) => (
    isPlainObject(diagnostic) && diagnostic.severity === 'error'
  ))) return fail('bundle_contains_error_diagnostics');

  const table = bundle.executionTable;
  const tableNames = ['policies', 'terms', 'fallbackStages', 'terminals', 'endpoints', 'attempts', 'syntheticResponses', 'filterSets'];
  for (const name of tableNames) {
    if (!Array.isArray(table[name])) return fail(`execution_table_${name}_invalid`);
  }
  for (const policy of table.policies) {
    if (!validateDispatcherPolicy(policy)) return fail('dispatcher_policy_invalid');
  }
  for (const term of table.terms) {
    if (!Array.isArray(term) || !normalizeString(term[0]) || !validIndex(term[3], table.policies) || !normalizeString(term[4])) {
      return fail('selection_term_invalid');
    }
  }
  for (const stage of table.fallbackStages) {
    if (!Array.isArray(stage) || !normalizeString(stage[0]) || !normalizeString(stage[1]) || !normalizeString(stage[3])) {
      return fail('fallback_stage_invalid');
    }
  }
  for (const terminal of table.terminals) {
    if (!Array.isArray(terminal)) return fail('terminal_invalid');
    if (terminal[0] === 'supply' && normalizeString(terminal[1])) continue;
    if (terminal[0] === 'synthetic' && normalizeString(terminal[1]) && (terminal[2] === 429 || terminal[2] === 503)) continue;
    return fail('terminal_invalid');
  }
  for (const endpoint of table.endpoints) {
    if (!Array.isArray(endpoint) || !normalizeString(endpoint[0]) || !normalizeString(endpoint[1])) {
      return fail('endpoint_invalid');
    }
  }
  const attemptIds = new Set();
  for (const attempt of table.attempts) {
    if (!Array.isArray(attempt) || !normalizeString(attempt[0]) || !normalizeString(attempt[1]) || !normalizeString(attempt[2])) {
      return fail('execution_attempt_invalid');
    }
    const executionAttemptId = normalizeString(attempt[1]);
    if (attemptIds.has(executionAttemptId)) return fail('execution_attempt_id_duplicate');
    attemptIds.add(executionAttemptId);
    const binding = packedTupleValue(attempt[EXECUTION_ATTEMPT_TRANSPORT_BINDING_INDEX]);
    if (
      binding?.kind !== 'execution_target'
      || !Number.isSafeInteger(Number(binding.executionTargetId))
      || Number(binding.executionTargetId) <= 0
    ) return fail('execution_attempt_transport_binding_invalid');
  }
  for (const synthetic of table.syntheticResponses) {
    if (!Array.isArray(synthetic) || !normalizeString(synthetic[0]) || (synthetic[1] !== 429 && synthetic[1] !== 503)) {
      return fail('synthetic_response_invalid');
    }
  }
  for (const filterSet of table.filterSets) {
    if (!Array.isArray(filterSet) || filterSet.some((index) => !Number.isSafeInteger(Number(index)) || Number(index) < 0)) {
      return fail('filter_set_invalid');
    }
  }

  const plansById = new Map();
  for (const [planIndex, plan] of bundle.plans.entries()) {
    if (!isPlainObject(plan)) return fail('plan_invalid');
    const planId = normalizeString(plan.id);
    if (!planId || plansById.has(planId)) return fail(planId ? 'plan_id_duplicate' : 'plan_id_required');
    if (!normalizeString(plan.entryNodeId) || !normalizeString(plan.publicModelName)) return fail('plan_identity_invalid');
    if (!Array.isArray(plan.filterStages) || !Array.isArray(plan.executionAlternatives)) return fail('plan_body_invalid');
    if (Number(bundle.planIndex[planId]) !== planIndex) return fail('plan_index_reference_invalid');
    plansById.set(planId, plan);
    const alternativeIds = new Set();
    for (const alternative of plan.executionAlternatives) {
      if (!isPlainObject(alternative)) return fail('alternative_invalid');
      const alternativeId = normalizeString(alternative.alternativeId);
      if (!alternativeId || alternativeIds.has(alternativeId)) return fail(alternativeId ? 'alternative_id_duplicate' : 'alternative_id_required');
      alternativeIds.add(alternativeId);
      if (!validIndex(alternative.filters, table.filterSets)) return fail('alternative_filter_set_reference_invalid');
      const filterIndexes = table.filterSets[alternative.filters];
      if (filterIndexes.some((index) => !validIndex(index, plan.filterStages))) return fail('filter_stage_reference_invalid');
      if (!Array.isArray(alternative.terms) || alternative.terms.some((index) => !validIndex(index, table.terms))) {
        return fail('selection_term_reference_invalid');
      }
      if (!Array.isArray(alternative.fallbacks) || alternative.fallbacks.some((index) => !validIndex(index, table.fallbackStages))) {
        return fail('fallback_stage_reference_invalid');
      }
      if (!validIndex(alternative.terminal, table.terminals)) return fail('terminal_reference_invalid');
      if (alternative.endpoint != null && !validIndex(alternative.endpoint, table.endpoints)) return fail('endpoint_reference_invalid');
      if (alternative.kind === 'execution_attempt') {
        if (!validIndex(alternative.attempt, table.attempts)) return fail('execution_attempt_reference_invalid');
        if (normalizeString(table.attempts[alternative.attempt]?.[1]) !== alternativeId) return fail('execution_attempt_identity_mismatch');
      } else if (alternative.kind === 'endpoint_delegation') {
        if (!validIndex(alternative.endpoint, table.endpoints) || alternative.attempt != null) return fail('endpoint_delegation_invalid');
      } else if (alternative.kind === 'synthetic_response') {
        if (!validIndex(alternative.synthetic, table.syntheticResponses) || alternative.attempt != null) return fail('synthetic_alternative_invalid');
      } else {
        return fail('alternative_kind_invalid');
      }
    }
  }
  if (Object.keys(bundle.planIndex).length !== plansById.size) return fail('plan_index_size_mismatch');

  const exact = bundle.matcher.exact;
  const normalizedExact = bundle.matcher.normalizedExact;
  const patterns = bundle.matcher.patterns;
  if (!isPlainObject(exact) || !isPlainObject(normalizedExact) || !Array.isArray(patterns)) return fail('matcher_tables_invalid');
  for (const target of [...Object.values(exact), ...Object.values(normalizedExact)]) {
    if (!validateMatcherTarget(target, plansById)) return fail('matcher_target_invalid');
  }
  for (const pattern of patterns) {
    if (!validateMatcherTarget(pattern, plansById) || !normalizeString(pattern.pattern) || (pattern.patternKind !== 'wildcard' && pattern.patternKind !== 'regex')) {
      return fail('matcher_pattern_invalid');
    }
  }
  return { ok: true, value: bundle };
}
