export type CrossScopeFallback = 'deny' | 'temporary' | 'promote_on_success';

export type RouteAffinityPolicy =
  | { kind: 'inherit_default' }
  | { kind: 'disabled' }
  | { kind: 'pool'; ttlSec: number; crossPoolFallback: CrossScopeFallback }
  | { kind: 'target'; ttlSec: number; crossTargetFallback: CrossScopeFallback };

export type ResolvedRouteAffinityPolicy = Exclude<RouteAffinityPolicy, { kind: 'inherit_default' }>;

export type EntryAffinityPoolMember = {
  kind: 'execution_target';
  sourceRef: string;
};

export type EntryAffinityPool = {
  id: string;
  label?: string;
  members: EntryAffinityPoolMember[];
};

export type EntryAffinityConfig = {
  policy: RouteAffinityPolicy;
  pools?: EntryAffinityPool[];
};

export const DEFAULT_ROUTE_AFFINITY_TTL_SEC: number;
export const DEFAULT_ROUTE_AFFINITY_POLICY: Readonly<{ kind: 'disabled' }>;

export function normalizeRouteAffinityPolicy(
  input: unknown,
  options?: { allowInherit?: boolean; defaultTtlSec?: number },
): RouteAffinityPolicy;
export function normalizeGlobalRouteAffinityPolicy(input: unknown): ResolvedRouteAffinityPolicy;
export function resolveRouteAffinityPolicy(
  input: unknown,
  globalDefault?: unknown,
): ResolvedRouteAffinityPolicy;
export function normalizeEntryAffinityConfig(input: unknown): EntryAffinityConfig;
export function validateEntryAffinityConfig(input: unknown): string[];
