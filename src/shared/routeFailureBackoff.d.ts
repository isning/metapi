export type RouteFailureBackoffPolicy = {
  failureThreshold: number;
  levelsSec: number[];
  maxSec: number;
};

export const DEFAULT_ROUTE_FAILURE_BACKOFF_POLICY: RouteFailureBackoffPolicy;

export type RouteFailureBackoffOverride =
  | { mode: 'custom'; policy: RouteFailureBackoffPolicy }
  | { mode: 'disabled' };

export function normalizeRouteFailureBackoffPolicy(input: unknown): RouteFailureBackoffPolicy | null;
export function normalizeRouteFailureBackoffOverride(input: unknown): RouteFailureBackoffOverride | null;
