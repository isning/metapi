import {
  config,
  normalizeRouteFailureCooldownMaxSec,
  ROUTE_FAILURE_COOLDOWN_MAX_SEC_CEILING,
} from '../config.js';
import {
  matchesModelPattern as matchesSharedModelPattern,
  parseModelRegexPattern,
} from '../../shared/modelPatternMatcher.js';

const FAILURE_BACKOFF_BASE_SEC = 15;
const MAX_FAILURE_BACKOFF_SEC = 30 * 24 * 60 * 60;

type FailureAwareTarget = {
  failCount?: number | null;
  lastFailAt?: string | null;
};

function fibonacciNumber(index: number): number {
  if (index <= 2) return 1;
  let prev = 1;
  let current = 1;
  for (let i = 3; i <= index; i += 1) {
    const next = prev + current;
    prev = current;
    current = next;
  }
  return current;
}

export function resolveFailureBackoffSec(failCount?: number | null): number {
  const normalizedFailCount = Math.max(1, Math.trunc(failCount ?? 0));
  return Math.min(FAILURE_BACKOFF_BASE_SEC * fibonacciNumber(normalizedFailCount), MAX_FAILURE_BACKOFF_SEC);
}

function resolveConfiguredFailureCooldownMaxMs(): number {
  const normalized = normalizeRouteFailureCooldownMaxSec(config.routeFailureCooldownMaxSec)
    ?? ROUTE_FAILURE_COOLDOWN_MAX_SEC_CEILING;
  return Math.max(1_000, normalized * 1000);
}

function clampFailureCooldownMs(cooldownMs: number): number {
  const normalized = Math.max(0, Math.trunc(cooldownMs));
  return Math.min(normalized, resolveConfiguredFailureCooldownMaxMs());
}

export function isTargetRecentlyFailed(
  target: FailureAwareTarget,
  nowMs = Date.now(),
  avoidSec = resolveFailureBackoffSec(target.failCount),
): boolean {
  const avoidMs = clampFailureCooldownMs(avoidSec * 1000);
  if (avoidMs <= 0) return false;
  if ((target.failCount ?? 0) <= 0) return false;
  if (!target.lastFailAt) return false;

  const failTs = Date.parse(target.lastFailAt);
  if (Number.isNaN(failTs)) return false;

  return nowMs - failTs < avoidMs;
}

export function filterRecentlyFailedCandidates<T extends { target: FailureAwareTarget }>(
  candidates: T[],
  nowMs = Date.now(),
  avoidSec?: number,
): T[] {
  if (candidates.length <= 1) return candidates;
  if (avoidSec != null && avoidSec <= 0) return candidates;

  const healthy = candidates.filter((candidate) => !isTargetRecentlyFailed(candidate.target, nowMs, avoidSec));
  return healthy.length > 0 ? healthy : candidates;
}

export function parseRegexModelPattern(pattern: string): { test(value: string): boolean } | null {
  return parseModelRegexPattern(pattern).regex;
}

export function matchesModelPattern(model: string, pattern: string): boolean {
  return matchesSharedModelPattern(model, pattern);
}
