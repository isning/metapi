const AFFINITY_KINDS = ['inherit_default', 'disabled', 'pool', 'target'];
const CROSS_SCOPE_FALLBACKS = ['deny', 'temporary', 'promote_on_success'];

export const DEFAULT_ROUTE_AFFINITY_TTL_SEC = 30 * 60;
export const DEFAULT_ROUTE_AFFINITY_POLICY = Object.freeze({ kind: 'disabled' });

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function ttlSec(value, fallback = DEFAULT_ROUTE_AFFINITY_TTL_SEC) {
  const numeric = Math.trunc(Number(value));
  return Number.isSafeInteger(numeric) && numeric >= 30 && numeric <= 30 * 24 * 60 * 60
    ? numeric
    : fallback;
}

function fallback(value) {
  return CROSS_SCOPE_FALLBACKS.includes(value) ? value : 'deny';
}

export function normalizeRouteAffinityPolicy(input, options = {}) {
  const raw = isRecord(input) ? input : {};
  const allowInherit = options.allowInherit !== false;
  const kind = AFFINITY_KINDS.includes(raw.kind) ? raw.kind : (allowInherit ? 'inherit_default' : 'disabled');
  if (kind === 'inherit_default') return allowInherit ? { kind } : { kind: 'disabled' };
  if (kind === 'disabled') return { kind };
  if (kind === 'pool') {
    return {
      kind,
      ttlSec: ttlSec(raw.ttlSec, options.defaultTtlSec ?? DEFAULT_ROUTE_AFFINITY_TTL_SEC),
      crossPoolFallback: fallback(raw.crossPoolFallback),
    };
  }
  return {
    kind: 'target',
    ttlSec: ttlSec(raw.ttlSec, options.defaultTtlSec ?? DEFAULT_ROUTE_AFFINITY_TTL_SEC),
    crossTargetFallback: fallback(raw.crossTargetFallback),
  };
}

export function normalizeGlobalRouteAffinityPolicy(input) {
  return normalizeRouteAffinityPolicy(input, { allowInherit: false });
}

export function resolveRouteAffinityPolicy(input, globalDefault = DEFAULT_ROUTE_AFFINITY_POLICY) {
  const policy = normalizeRouteAffinityPolicy(input);
  return policy.kind === 'inherit_default'
    ? normalizeGlobalRouteAffinityPolicy(globalDefault)
    : policy;
}

export function normalizeEntryAffinityConfig(input) {
  const raw = isRecord(input) ? input : {};
  const pools = Array.isArray(raw.pools)
    ? raw.pools.map((pool) => {
      const value = isRecord(pool) ? pool : {};
      const members = Array.isArray(value.members)
        ? value.members.flatMap((member) => {
          const candidate = isRecord(member) ? member : {};
          const sourceRef = text(candidate.sourceRef);
          return candidate.kind === 'execution_target' && sourceRef
            ? [{ kind: 'execution_target', sourceRef }]
            : [];
        })
        : [];
      return {
        id: text(value.id),
        ...(text(value.label) ? { label: text(value.label) } : {}),
        members: Array.from(new Map(members.map((member) => [member.sourceRef, member])).values()),
      };
    }).filter((pool) => pool.id)
    : [];
  return {
    policy: normalizeRouteAffinityPolicy(raw.policy),
    ...(pools.length > 0 ? { pools } : {}),
  };
}

export function validateEntryAffinityConfig(input) {
  if (!isRecord(input)) return [];
  const errors = [];
  const rawPools = Array.isArray(input.pools) ? input.pools : [];
  const poolIds = new Set();
  const memberPools = new Map();
  for (const rawPool of rawPools) {
    const pool = isRecord(rawPool) ? rawPool : {};
    const poolId = text(pool.id);
    if (!poolId) {
      errors.push('Affinity pool id is required.');
      continue;
    }
    if (poolIds.has(poolId)) errors.push(`Affinity pool id ${poolId} is duplicated.`);
    poolIds.add(poolId);
    const members = Array.isArray(pool.members) ? pool.members : [];
    if (members.length === 0) errors.push(`Affinity pool ${poolId} must contain at least one execution target.`);
    for (const rawMember of members) {
      const member = isRecord(rawMember) ? rawMember : {};
      const sourceRef = text(member.sourceRef);
      if (member.kind !== 'execution_target' || !sourceRef) {
        errors.push(`Affinity pool ${poolId} contains an invalid execution target reference.`);
        continue;
      }
      const previous = memberPools.get(sourceRef);
      if (previous && previous !== poolId) {
        errors.push(`Execution target ${sourceRef} belongs to more than one affinity pool.`);
      }
      memberPools.set(sourceRef, poolId);
    }
  }
  return errors;
}
