import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { upsertSetting } from '../db/upsertSetting.js';
import {
  config,
  normalizeTokenRouterFailureCooldownMaxSec,
  TOKEN_ROUTER_FAILURE_COOLDOWN_MAX_SEC_CEILING,
} from '../config.js';
import {
  getCachedEndpointRoutingReferencePricing,
  refreshEndpointRoutingReferencePricing,
} from './endpointPricingService.js';
import { loadRouteGraphRouteTableBindings } from './routeGraphService.js';
import {
  evaluateActiveRouteGraphForModel,
  type RouteGraphRuntimeSelection,
  type RouteGraphRuntimeFailureOverlay,
} from './routeGraphRuntimeService.js';
import { proxyTargetCoordinator, type ProxyTargetLoadSnapshot } from './proxyTargetCoordinator.js';
import { RETRYABLE_TIMEOUT_PATTERNS } from './proxyRetryPolicy.js';
import {
  selectContributionSnapshot,
} from './selectorEngine.js';
import {
  normalizeRouteRoutingStrategy,
  type RouteRoutingStrategy,
} from './routeRoutingStrategy.js';
import { type DownstreamRoutingPolicy, EMPTY_DOWNSTREAM_ROUTING_POLICY } from './downstreamPolicyTypes.js';
import { isUsableAccountToken } from './accountTokenService.js';
import { getOauthInfoFromAccount } from './oauth/oauthAccount.js';
import { parseCodexQuotaResetHint } from './oauth/quota.js';
import {
  getOauthRouteUnitStrategyLabel,
  listOauthRouteUnitMembersByUnitIds,
  loadOauthRouteUnitSummariesByIds,
  type OAuthRouteUnitSummary,
} from './oauth/routeUnitService.js';
import type {
  RouteExecutionCandidate,
  RouteExecutionScope,
} from './routeExecutionScopeTypes.js';
import {
  isExactTokenRouteModelPattern,
  isTokenRouteRegexPattern,
  matchesTokenRouteModelPattern,
  parseTokenRouteRegexPattern,
} from '../../shared/tokenRoutePatterns.js';
import {
  type RouteDecision,
  type RouteDecisionCandidate,
  type RouteMode,
} from '../../shared/tokenRouteContract.js';
import {
  deriveLegacyModelPatternFromSpecs,
  deriveLegacyRouteModeFromBackendSpec,
  deriveLegacySourceRouteIdsFromBackendSpec,
  getRouteGraphExposedModelName,
  isRouteGraphExactModelMatch,
  normalizeRouteGraphBackendSpec,
  parseRouteGraphBackendSpec,
  parseRouteGraphMatchSpec,
  routeGraphMatchesRequestedModel,
  type RouteGraphBackendSpec,
  type RouteGraphMatchSpec,
} from '../../shared/routeGraph.js';

interface RouteMatch {
  route: RouteRow;
  routeGraph?: RouteGraphRuntimeSelection | null;
  targets: Array<{
    target: typeof schema.routeEndpointTargets.$inferSelect;
    account: typeof schema.accounts.$inferSelect;
    site: typeof schema.sites.$inferSelect;
    token: typeof schema.accountTokens.$inferSelect | null;
    routeUnit: OAuthRouteUnitSummary | null;
    routeUnitMembers: Array<{
      member: typeof schema.oauthRouteUnitMembers.$inferSelect;
      account: typeof schema.accounts.$inferSelect;
      site: typeof schema.sites.$inferSelect;
      token: null;
    }>;
  }>;
}

type RouteEndpointTargetCandidate = RouteMatch['targets'][number];

export interface SelectedTarget {
  target: typeof schema.routeEndpointTargets.$inferSelect;
  account: typeof schema.accounts.$inferSelect;
  site: typeof schema.sites.$inferSelect;
  token: typeof schema.accountTokens.$inferSelect | null;
  tokenValue: string;
  tokenName: string;
  actualModel: string;
  routeGraph?: RouteGraphRuntimeSelection | null;
  routeExecutionScope?: RouteExecutionScope | null;
}

type FailureAwareTarget = {
  failCount?: number | null;
  lastFailAt?: string | null;
};

type SiteRuntimeFailureContext = {
  status?: number | null;
  errorText?: string | null;
  modelName?: string | null;
};

type SiteRuntimeHealthState = {
  penaltyScore: number;
  latencyEmaMs: number | null;
  transientFailureStreak: number;
  lastTransientFailureAtMs: number | null;
  recentSuccessCount: number;
  recentFailureCount: number;
  recentWindowUpdatedAtMs: number;
  breakerLevel: number;
  breakerUntilMs: number | null;
  lastUpdatedAtMs: number;
  lastFailureAtMs: number | null;
  lastSuccessAtMs: number | null;
};

const FAILURE_BACKOFF_BASE_SEC = 15;
const SHORT_WINDOW_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;
// Keep weighted-route backoff within the JavaScript Date range when fail counts grow large.
const MAX_FAILURE_BACKOFF_SEC = 30 * 24 * 60 * 60;
const MIN_EFFECTIVE_UNIT_COST = 1e-6;
const ROUND_ROBIN_FAILURE_THRESHOLD = 3;
const ROUND_ROBIN_COOLDOWN_LEVELS_SEC = [0, 10 * 60, 60 * 60, 24 * 60 * 60] as const;
const STABLE_FIRST_SITE_SCORE_RATIO = 0.92;
const SITE_RUNTIME_HEALTH_DECAY_HALF_LIFE_MS = 10 * 60 * 1000;
const SITE_RUNTIME_MIN_MULTIPLIER = 0.08;
const SITE_RUNTIME_LATENCY_BASELINE_MS = 2_500;
const SITE_RUNTIME_LATENCY_WINDOW_MS = 30_000;
const SITE_RUNTIME_MAX_LATENCY_PENALTY = 0.35;
const SITE_RUNTIME_LATENCY_EMA_ALPHA = 0.3;
const SITE_RUNTIME_BREAKER_STREAK_THRESHOLD = 3;
const SITE_RUNTIME_BREAKER_LEVELS_MS = [0, 60_000, 5 * 60_000, 30 * 60 * 1000] as const;
const SITE_TRANSIENT_STREAK_WINDOW_MS = 5 * 60 * 1000;
const SITE_RECENT_OUTCOME_HALF_LIFE_MS = 30 * 60 * 1000;
const SITE_RECENT_SUCCESS_CONFIDENCE_SAMPLES = 12;
const SITE_RECENT_SUCCESS_PRIOR_SUCCESSES = 1;
const SITE_RECENT_SUCCESS_PRIOR_FAILURES = 1;
const SITE_RECENT_SUCCESS_FALLBACK_RATE = 0.5;
const SITE_RECENT_MODEL_WEIGHT = 0.65;
const SITE_HISTORICAL_HEALTH_MIN_MULTIPLIER = 0.45;
const SITE_HISTORICAL_HEALTH_MAX_SAMPLE = 24;
const SITE_HISTORICAL_LATENCY_BASELINE_MS = 2_000;
const SITE_HISTORICAL_LATENCY_WINDOW_MS = 20_000;
const SITE_HISTORICAL_MAX_LATENCY_PENALTY = 0.18;
const SITE_RUNTIME_HEALTH_SETTING_KEY = 'token_router_site_runtime_health_v1';
const SITE_RUNTIME_HEALTH_PERSIST_DEBOUNCE_MS = 500;
const SITE_RUNTIME_HEALTH_PERSIST_STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SITE_RUNTIME_HEALTH_PERSIST_IDLE_TTL_MS = 12 * 60 * 60 * 1000;
const SITE_RUNTIME_HEALTH_PERSIST_MIN_PENALTY = 0.02;

const SITE_PROTOCOL_FAILURE_PATTERNS: RegExp[] = [
  /unsupported\s+legacy\s+protocol/i,
  /please\s+use\s+\/v1\/responses/i,
  /please\s+use\s+\/v1\/messages/i,
  /please\s+use\s+\/v1\/chat\/completions/i,
  /does\s+not\s+allow\s+\/v1\/[a-z0-9/_:-]+\s+dispatch/i,
  /unsupported\s+endpoint/i,
  /unsupported\s+path/i,
  /unknown\s+endpoint/i,
  /unrecognized\s+request\s+url/i,
  /no\s+route\s+matched/i,
];

const SITE_MODEL_FAILURE_PATTERNS: RegExp[] = [
  /unsupported\s+model/i,
  /model\s+not\s+supported/i,
  /does\s+not\s+support(?:\s+the)?\s+model/i,
  /no\s+such\s+model/i,
  /unknown\s+model/i,
  /unknown\s+provider\s+for\s+model/i,
  /invalid\s+model/i,
  /model.*does\s+not\s+exist/i,
  /当前\s*api\s*不支持所选模型/i,
  /不支持所选模型/i,
];

const SITE_VALIDATION_FAILURE_PATTERNS: RegExp[] = [
  /invalid\s+request\s+body/i,
  /validation/i,
  /missing\s+required/i,
  /required\s+parameter/i,
  /unknown\s+parameter/i,
  /unrecognized\s+(field|key|parameter)/i,
  /malformed/i,
  /invalid\s+json/i,
  /cannot\s+parse/i,
  /unsupported\s+media\s+type/i,
];

const SITE_TRANSIENT_FAILURE_PATTERNS: RegExp[] = [
  /bad\s+gateway/i,
  /gateway\s+time-?out/i,
  ...RETRYABLE_TIMEOUT_PATTERNS,
  /service\s+unavailable/i,
  /temporar(?:y|ily)\s+unavailable/i,
  /cpu\s+overloaded/i,
  /overloaded/i,
  /connection\s+reset/i,
  /connection\s+refused/i,
  /econnreset/i,
  /econnrefused/i,
];

const USAGE_LIMIT_RATE_LIMIT_PATTERNS: RegExp[] = [
  /usage_limit_reached/i,
  /usage\s+limit\s+has\s+been\s+reached/i,
  /quota\s+exceeded/i,
  /rate\s+limit/i,
  /\blimit\b/i,
];

type SiteRuntimeHealthPersistencePayload = {
  version: 1;
  savedAtMs: number;
  globalBySiteId: Record<string, SiteRuntimeHealthState>;
  modelBySiteId: Record<string, Record<string, SiteRuntimeHealthState>>;
};

type SiteRuntimeHealthDetails = {
  globalMultiplier: number;
  modelMultiplier: number;
  combinedMultiplier: number;
  globalBreakerOpen: boolean;
  modelBreakerOpen: boolean;
  modelKey: string;
  recentSuccessRate: number;
  recentSampleCount: number;
  recentConfidence: number;
};

type WeightedSelectionMode = 'weighted' | 'stable_first';
type WeightedSelectionResult = {
  selected: RouteEndpointTargetCandidate | null;
  details: Array<{ candidate: RouteEndpointTargetCandidate; probability: number; reason: string }>;
  stableSiteCount: number;
};

type RecentOutcomeSnapshot = {
  successCount: number;
  failureCount: number;
  sampleCount: number;
  successRate: number;
  confidence: number;
};

type StableFirstSitePoolState = {
  siteId: number;
  leader: RouteEndpointTargetCandidate;
  effectiveSuccessRate: number;
  trusted: boolean;
  observationReason: string | null;
};

type StableFirstPoolPlan = {
  primaryCandidates: RouteEndpointTargetCandidate[];
  observationCandidates: RouteEndpointTargetCandidate[];
  primarySiteIds: Set<number>;
  observationSiteIds: Set<number>;
  siteStateById: Map<number, StableFirstSitePoolState>;
};

type StableFirstObservationProgressState = {
  requestCount: number;
  lastObservationAtMs: number | null;
};

const siteRuntimeHealthStates = new Map<number, SiteRuntimeHealthState>();
const siteModelRuntimeHealthStates = new Map<number, Map<string, SiteRuntimeHealthState>>();
const stableFirstLastSelectedSiteByKey = new Map<string, number>();
const MAX_STABLE_FIRST_ROTATION_KEYS = 1024;
const stableFirstObservationProgressByKey = new Map<string, StableFirstObservationProgressState>();
const stableFirstObservationSiteCooldownByKey = new Map<string, number>();
const MAX_STABLE_FIRST_OBSERVATION_PROGRESS_KEYS = 1024;
const MAX_STABLE_FIRST_OBSERVATION_SITE_COOLDOWN_KEYS = 4096;
let siteRuntimeHealthLoaded = false;
let siteRuntimeHealthLoadPromise: Promise<void> | null = null;
let siteRuntimeHealthSaveTimer: ReturnType<typeof setTimeout> | null = null;
let siteRuntimeHealthPersistInFlight: Promise<void> | null = null;

const STABLE_FIRST_PRIMARY_SUCCESS_RATE_RATIO = 0.92;
const STABLE_FIRST_TRUSTED_RECENT_CONFIDENCE = 0.5;
const STABLE_FIRST_TRUSTED_HISTORICAL_CALLS = 8;
const STABLE_FIRST_OBSERVATION_REQUEST_INTERVAL = 24;
const STABLE_FIRST_OBSERVATION_SITE_COOLDOWN_MS = 30 * 60 * 1000;

function rememberStableFirstSiteSelectionForKey(rotationKey: string, siteId: number): void {
  if (!rotationKey || !Number.isFinite(siteId) || siteId <= 0) return;
  if (stableFirstLastSelectedSiteByKey.has(rotationKey)) {
    stableFirstLastSelectedSiteByKey.delete(rotationKey);
  }
  stableFirstLastSelectedSiteByKey.set(rotationKey, siteId);
  while (stableFirstLastSelectedSiteByKey.size > MAX_STABLE_FIRST_ROTATION_KEYS) {
    const oldestKey = stableFirstLastSelectedSiteByKey.keys().next().value;
    if (!oldestKey) break;
    stableFirstLastSelectedSiteByKey.delete(oldestKey);
  }
}

function rememberStableFirstObservationProgressForKey(
  rotationKey: string,
  state: StableFirstObservationProgressState,
): void {
  if (!rotationKey) return;
  if (stableFirstObservationProgressByKey.has(rotationKey)) {
    stableFirstObservationProgressByKey.delete(rotationKey);
  }
  stableFirstObservationProgressByKey.set(rotationKey, state);
  while (stableFirstObservationProgressByKey.size > MAX_STABLE_FIRST_OBSERVATION_PROGRESS_KEYS) {
    const oldestKey = stableFirstObservationProgressByKey.keys().next().value;
    if (!oldestKey) break;
    stableFirstObservationProgressByKey.delete(oldestKey);
  }
}

function rememberStableFirstObservationSiteCooldown(
  rotationKey: string,
  siteId: number,
  observedAtMs: number,
): void {
  if (!rotationKey || !Number.isFinite(siteId) || siteId <= 0) return;
  const scopedKey = `${rotationKey}:${siteId}`;
  if (stableFirstObservationSiteCooldownByKey.has(scopedKey)) {
    stableFirstObservationSiteCooldownByKey.delete(scopedKey);
  }
  stableFirstObservationSiteCooldownByKey.set(scopedKey, observedAtMs);
  while (stableFirstObservationSiteCooldownByKey.size > MAX_STABLE_FIRST_OBSERVATION_SITE_COOLDOWN_KEYS) {
    const oldestKey = stableFirstObservationSiteCooldownByKey.keys().next().value;
    if (!oldestKey) break;
    stableFirstObservationSiteCooldownByKey.delete(oldestKey);
  }
}

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

/**
 * Weighted-route failures use a Fibonacci backoff, but the resulting cooldown must stay
 * representable as a JavaScript Date for downstream `toISOString()` calls.
 */
function resolveFailureBackoffSec(failCount?: number | null): number {
  const normalizedFailCount = Math.max(1, Math.trunc(failCount ?? 0));
  return Math.min(FAILURE_BACKOFF_BASE_SEC * fibonacciNumber(normalizedFailCount), MAX_FAILURE_BACKOFF_SEC);
}

function resolveConfiguredFailureCooldownMaxMs(): number {
  const normalized = normalizeTokenRouterFailureCooldownMaxSec(config.tokenRouterFailureCooldownMaxSec)
    ?? TOKEN_ROUTER_FAILURE_COOLDOWN_MAX_SEC_CEILING;
  return Math.max(1_000, normalized * 1000);
}

function clampFailureCooldownMs(cooldownMs: number): number {
  const normalized = Math.max(0, Math.trunc(cooldownMs));
  return Math.min(normalized, resolveConfiguredFailureCooldownMaxMs());
}

function resolveEffectiveFailureCooldownMs(failCount?: number | null): number {
  return clampFailureCooldownMs(resolveFailureBackoffSec(failCount) * 1000);
}

function resolveRoundRobinCooldownSec(level: number): number {
  const normalizedLevel = Math.max(0, Math.min(ROUND_ROBIN_COOLDOWN_LEVELS_SEC.length - 1, Math.trunc(level)));
  return ROUND_ROBIN_COOLDOWN_LEVELS_SEC[normalizedLevel] ?? 0;
}

function resolveSiteRuntimeBreakerMs(level: number): number {
  const normalizedLevel = Math.max(0, Math.min(SITE_RUNTIME_BREAKER_LEVELS_MS.length - 1, Math.trunc(level)));
  return SITE_RUNTIME_BREAKER_LEVELS_MS[normalizedLevel] ?? 0;
}

function matchesAnyPattern(patterns: RegExp[], input?: string | null): boolean {
  const text = (input || '').trim();
  if (!text) return false;
  return patterns.some((pattern) => pattern.test(text));
}

function isUsageLimitRateLimitFailure(context: SiteRuntimeFailureContext = {}): boolean {
  const status = typeof context.status === 'number' ? context.status : 0;
  if (status !== 429) return false;
  return matchesAnyPattern(USAGE_LIMIT_RATE_LIMIT_PATTERNS, context.errorText);
}

function isModelScopedRuntimeFailure(context: SiteRuntimeFailureContext = {}): boolean {
  return matchesAnyPattern(SITE_MODEL_FAILURE_PATTERNS, context.errorText);
}

function isProtocolRuntimeFailure(context: SiteRuntimeFailureContext = {}): boolean {
  return matchesAnyPattern(SITE_PROTOCOL_FAILURE_PATTERNS, context.errorText);
}

function isValidationRuntimeFailure(context: SiteRuntimeFailureContext = {}): boolean {
  return matchesAnyPattern(SITE_VALIDATION_FAILURE_PATTERNS, context.errorText);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isContributionCloseToBest(value: number, bestValue: number, ratio = STABLE_FIRST_SITE_SCORE_RATIO): boolean {
  if (bestValue <= 0) return true;
  return value >= (bestValue * ratio);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readFiniteInteger(value: unknown): number | null {
  const normalized = readFiniteNumber(value);
  return normalized == null ? null : Math.trunc(normalized);
}

function readNullableTimestamp(value: unknown): number | null {
  const normalized = readFiniteInteger(value);
  if (normalized == null || normalized <= 0) return null;
  return normalized;
}

function decayRecentOutcomeCount(value: number, elapsedMs: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (elapsedMs <= 0) return value;
  const decayFactor = Math.pow(0.5, elapsedMs / SITE_RECENT_OUTCOME_HALF_LIFE_MS);
  return value * decayFactor;
}

function buildRecentOutcomeSnapshot(
  successCount: number,
  failureCount: number,
): RecentOutcomeSnapshot {
  const normalizedSuccessCount = Math.max(0, successCount);
  const normalizedFailureCount = Math.max(0, failureCount);
  const sampleCount = normalizedSuccessCount + normalizedFailureCount;
  const successRate = (
    normalizedSuccessCount + SITE_RECENT_SUCCESS_PRIOR_SUCCESSES
  ) / (
    sampleCount + SITE_RECENT_SUCCESS_PRIOR_SUCCESSES + SITE_RECENT_SUCCESS_PRIOR_FAILURES
  );
  return {
    successCount: normalizedSuccessCount,
    failureCount: normalizedFailureCount,
    sampleCount,
    successRate,
    confidence: clampNumber(sampleCount / SITE_RECENT_SUCCESS_CONFIDENCE_SAMPLES, 0, 1),
  };
}

function getRecentOutcomeSnapshot(state: SiteRuntimeHealthState | null | undefined, nowMs = Date.now()): RecentOutcomeSnapshot {
  if (!state) {
    return buildRecentOutcomeSnapshot(0, 0);
  }
  const updatedAtMs = Math.max(0, readFiniteInteger(state.recentWindowUpdatedAtMs) ?? state.lastUpdatedAtMs ?? nowMs);
  const elapsedMs = Math.max(0, nowMs - updatedAtMs);
  return buildRecentOutcomeSnapshot(
    decayRecentOutcomeCount(state.recentSuccessCount, elapsedMs),
    decayRecentOutcomeCount(state.recentFailureCount, elapsedMs),
  );
}

function refreshRecentOutcomeWindow(state: SiteRuntimeHealthState, nowMs = Date.now()): void {
  const snapshot = getRecentOutcomeSnapshot(state, nowMs);
  state.recentSuccessCount = snapshot.successCount;
  state.recentFailureCount = snapshot.failureCount;
  state.recentWindowUpdatedAtMs = nowMs;
}

function blendRecentOutcomeSnapshots(
  globalSnapshot: RecentOutcomeSnapshot,
  modelSnapshot: RecentOutcomeSnapshot | null,
): RecentOutcomeSnapshot {
  if (!modelSnapshot || modelSnapshot.sampleCount <= 0) {
    return globalSnapshot;
  }
  const modelWeight = SITE_RECENT_MODEL_WEIGHT;
  const globalWeight = 1 - modelWeight;
  return buildRecentOutcomeSnapshot(
    (globalSnapshot.successCount * globalWeight) + (modelSnapshot.successCount * modelWeight),
    (globalSnapshot.failureCount * globalWeight) + (modelSnapshot.failureCount * modelWeight),
  );
}

function resolveStableFirstSuccessRate(
  details: SiteRuntimeHealthDetails,
  historicalSuccessRate: number | null | undefined,
): number {
  const fallbackRate = historicalSuccessRate ?? SITE_RECENT_SUCCESS_FALLBACK_RATE;
  return (
    (details.recentSuccessRate * details.recentConfidence)
    + (fallbackRate * (1 - details.recentConfidence))
  );
}

function resolveSiteRuntimeFailurePenalty(context: SiteRuntimeFailureContext = {}): number {
  const status = typeof context.status === 'number' ? context.status : 0;
  const errorText = (context.errorText || '').trim();

  if (isUsageLimitRateLimitFailure({ status, errorText })) {
    return 0.4;
  }

  if (isModelScopedRuntimeFailure({ status, errorText })) {
    return 0.9;
  }

  if (isProtocolRuntimeFailure({ status, errorText })) {
    return 0.6;
  }

  if (isValidationRuntimeFailure({ status, errorText })) {
    return 0.25;
  }

  if (status >= 500 || matchesAnyPattern(SITE_TRANSIENT_FAILURE_PATTERNS, errorText)) {
    return 2.5;
  }

  if (status === 429) {
    return 2.2;
  }

  if (status === 401 || status === 403) {
    return 1.8;
  }

  if (status >= 400 && status < 500) {
    return 0.9;
  }

  return 1.2;
}

function isTransientSiteRuntimeFailure(context: SiteRuntimeFailureContext = {}): boolean {
  const status = typeof context.status === 'number' ? context.status : 0;
  const errorText = (context.errorText || '').trim();
  if (isUsageLimitRateLimitFailure({ status, errorText })) {
    return false;
  }
  if (isModelScopedRuntimeFailure({ status, errorText })) {
    return false;
  }
  if (isProtocolRuntimeFailure({ status, errorText })) {
    return false;
  }
  if (isValidationRuntimeFailure({ status, errorText })) {
    return false;
  }
  return status >= 500 || status === 429 || matchesAnyPattern(SITE_TRANSIENT_FAILURE_PATTERNS, errorText);
}

function resolveShortWindowLimitCooldown(
  account: typeof schema.accounts.$inferSelect,
  context: SiteRuntimeFailureContext = {},
  nowMs = Date.now(),
): string | null {
  const status = typeof context.status === 'number' ? context.status : 0;
  const errorText = (context.errorText || '').trim();
  if (!isUsageLimitRateLimitFailure({ status, errorText })) return null;

  const resetHint = parseCodexQuotaResetHint(status, errorText, nowMs);
  if (resetHint) {
    const hintMs = Date.parse(resetHint.resetAt);
    if (Number.isFinite(hintMs) && hintMs > nowMs) {
      return new Date(hintMs).toISOString();
    }
  }

  const oauth = getOauthInfoFromAccount(account);
  const storedResetAt = oauth?.quota?.lastLimitResetAt;
  if (oauth?.provider === 'codex' && storedResetAt) {
    const storedMs = Date.parse(storedResetAt);
    if (Number.isFinite(storedMs) && storedMs > nowMs) {
      return new Date(storedMs).toISOString();
    }
  }

  return new Date(nowMs + SHORT_WINDOW_LIMIT_COOLDOWN_MS).toISOString();
}

async function loadCredentialScopedTargetIds(
  target: typeof schema.routeEndpointTargets.$inferSelect,
  accountId: number,
): Promise<number[]> {
  if (typeof target.tokenId === 'number' && target.tokenId > 0) {
    const rows = await db.select({ id: schema.routeEndpointTargets.id })
      .from(schema.routeEndpointTargets)
      .where(eq(schema.routeEndpointTargets.tokenId, target.tokenId))
      .all();
    return rows.map((row) => row.id);
  }

  const rows = await db.select({ id: schema.routeEndpointTargets.id })
    .from(schema.routeEndpointTargets)
    .where(and(
      eq(schema.routeEndpointTargets.accountId, accountId),
      isNull(schema.routeEndpointTargets.tokenId),
    ))
    .all();
  return rows.map((row) => row.id);
}

function getDecayedSiteRuntimePenalty(state: SiteRuntimeHealthState, nowMs: number): number {
  if (!Number.isFinite(state.penaltyScore) || state.penaltyScore <= 0) return 0;
  const elapsedMs = Math.max(0, nowMs - state.lastUpdatedAtMs);
  if (elapsedMs <= 0) return state.penaltyScore;
  const decayFactor = Math.pow(0.5, elapsedMs / SITE_RUNTIME_HEALTH_DECAY_HALF_LIFE_MS);
  return state.penaltyScore * decayFactor;
}

function hydrateSiteRuntimeHealthState(raw: unknown): SiteRuntimeHealthState | null {
  if (!isRecord(raw)) return null;

  const lastUpdatedAtMs = readFiniteInteger(raw.lastUpdatedAtMs) ?? Date.now();
  const recentWindowUpdatedAtMs = readFiniteInteger(raw.recentWindowUpdatedAtMs) ?? lastUpdatedAtMs;
  return {
    penaltyScore: Math.max(0, readFiniteNumber(raw.penaltyScore) ?? 0),
    latencyEmaMs: readFiniteNumber(raw.latencyEmaMs),
    transientFailureStreak: Math.max(0, readFiniteInteger(raw.transientFailureStreak) ?? 0),
    lastTransientFailureAtMs: readNullableTimestamp(raw.lastTransientFailureAtMs),
    recentSuccessCount: Math.max(0, readFiniteNumber(raw.recentSuccessCount) ?? 0),
    recentFailureCount: Math.max(0, readFiniteNumber(raw.recentFailureCount) ?? 0),
    recentWindowUpdatedAtMs: Math.max(0, recentWindowUpdatedAtMs),
    breakerLevel: Math.max(0, readFiniteInteger(raw.breakerLevel) ?? 0),
    breakerUntilMs: readNullableTimestamp(raw.breakerUntilMs),
    lastUpdatedAtMs: Math.max(0, lastUpdatedAtMs),
    lastFailureAtMs: readNullableTimestamp(raw.lastFailureAtMs),
    lastSuccessAtMs: readNullableTimestamp(raw.lastSuccessAtMs),
  };
}

function cloneSiteRuntimeHealthState(state: SiteRuntimeHealthState): SiteRuntimeHealthState {
  return {
    penaltyScore: state.penaltyScore,
    latencyEmaMs: state.latencyEmaMs,
    transientFailureStreak: state.transientFailureStreak,
    lastTransientFailureAtMs: state.lastTransientFailureAtMs,
    recentSuccessCount: state.recentSuccessCount,
    recentFailureCount: state.recentFailureCount,
    recentWindowUpdatedAtMs: state.recentWindowUpdatedAtMs,
    breakerLevel: state.breakerLevel,
    breakerUntilMs: state.breakerUntilMs,
    lastUpdatedAtMs: state.lastUpdatedAtMs,
    lastFailureAtMs: state.lastFailureAtMs,
    lastSuccessAtMs: state.lastSuccessAtMs,
  };
}

function getOrCreateRuntimeHealthState<K>(states: Map<K, SiteRuntimeHealthState>, key: K, nowMs = Date.now()): SiteRuntimeHealthState {
  const existing = states.get(key);
  if (!existing) {
    const initial: SiteRuntimeHealthState = {
      penaltyScore: 0,
      latencyEmaMs: null,
      transientFailureStreak: 0,
      lastTransientFailureAtMs: null,
      recentSuccessCount: 0,
      recentFailureCount: 0,
      recentWindowUpdatedAtMs: nowMs,
      breakerLevel: 0,
      breakerUntilMs: null,
      lastUpdatedAtMs: nowMs,
      lastFailureAtMs: null,
      lastSuccessAtMs: null,
    };
    states.set(key, initial);
    return initial;
  }

  const nextPenalty = getDecayedSiteRuntimePenalty(existing, nowMs);
  if (nextPenalty !== existing.penaltyScore || existing.lastUpdatedAtMs !== nowMs) {
    existing.penaltyScore = nextPenalty;
    existing.lastUpdatedAtMs = nowMs;
  }
  return existing;
}

function getOrCreateSiteRuntimeHealthState(siteId: number, nowMs = Date.now()): SiteRuntimeHealthState {
  return getOrCreateRuntimeHealthState(siteRuntimeHealthStates, siteId, nowMs);
}

function getSiteModelRuntimeHealthState(siteId: number, modelName?: string | null): SiteRuntimeHealthState | null {
  const modelKey = normalizeModelAlias(modelName || '');
  if (!modelKey) return null;
  return siteModelRuntimeHealthStates.get(siteId)?.get(modelKey) ?? null;
}

function getOrCreateSiteModelRuntimeHealthState(
  siteId: number,
  modelName?: string | null,
  nowMs = Date.now(),
): SiteRuntimeHealthState | null {
  const modelKey = normalizeModelAlias(modelName || '');
  if (!modelKey) return null;
  let modelStates = siteModelRuntimeHealthStates.get(siteId);
  if (!modelStates) {
    modelStates = new Map<string, SiteRuntimeHealthState>();
    siteModelRuntimeHealthStates.set(siteId, modelStates);
  }
  return getOrCreateRuntimeHealthState(modelStates, modelKey, nowMs);
}

function isRuntimeHealthBreakerOpen(state: SiteRuntimeHealthState | null | undefined, nowMs = Date.now()): boolean {
  if (!state) return false;
  return typeof state.breakerUntilMs === 'number' && state.breakerUntilMs > nowMs;
}

function getRuntimeHealthMultiplier(state: SiteRuntimeHealthState | null | undefined, nowMs = Date.now()): number {
  if (!state) return 1;
  if (isRuntimeHealthBreakerOpen(state, nowMs)) {
    return SITE_RUNTIME_MIN_MULTIPLIER;
  }
  const penaltyScore = getDecayedSiteRuntimePenalty(state, nowMs);
  const failurePenaltyFactor = 1 / (1 + penaltyScore);
  const latencyPenaltyRatio = state.latencyEmaMs == null
    ? 0
    : clampNumber(
      (state.latencyEmaMs - SITE_RUNTIME_LATENCY_BASELINE_MS) / SITE_RUNTIME_LATENCY_WINDOW_MS,
      0,
      1,
    );
  const latencyFactor = 1 - (latencyPenaltyRatio * SITE_RUNTIME_MAX_LATENCY_PENALTY);
  return clampNumber(failurePenaltyFactor * latencyFactor, SITE_RUNTIME_MIN_MULTIPLIER, 1);
}

function getSiteRuntimeHealthDetails(siteId: number, modelName?: string | null, nowMs = Date.now()): SiteRuntimeHealthDetails {
  const modelKey = normalizeModelAlias(modelName || '');
  const globalState = siteRuntimeHealthStates.get(siteId);
  const modelState = modelKey ? getSiteModelRuntimeHealthState(siteId, modelKey) : null;
  const globalMultiplier = getRuntimeHealthMultiplier(globalState, nowMs);
  const modelMultiplier = modelState ? getRuntimeHealthMultiplier(modelState, nowMs) : 1;
  const globalRecentSnapshot = getRecentOutcomeSnapshot(globalState, nowMs);
  const modelRecentSnapshot = modelState ? getRecentOutcomeSnapshot(modelState, nowMs) : null;
  const recentSnapshot = blendRecentOutcomeSnapshots(globalRecentSnapshot, modelRecentSnapshot);
  return {
    globalMultiplier,
    modelMultiplier,
    combinedMultiplier: clampNumber(
      globalMultiplier * modelMultiplier,
      SITE_RUNTIME_MIN_MULTIPLIER * SITE_RUNTIME_MIN_MULTIPLIER,
      1,
    ),
    globalBreakerOpen: isRuntimeHealthBreakerOpen(globalState, nowMs),
    modelBreakerOpen: isRuntimeHealthBreakerOpen(modelState, nowMs),
    modelKey,
    recentSuccessRate: recentSnapshot.successRate,
    recentSampleCount: recentSnapshot.sampleCount,
    recentConfidence: recentSnapshot.confidence,
  };
}

function applyRuntimeHealthFailure(state: SiteRuntimeHealthState, context: SiteRuntimeFailureContext = {}, nowMs = Date.now()): void {
  refreshRecentOutcomeWindow(state, nowMs);
  state.recentFailureCount += 1;
  state.penaltyScore += resolveSiteRuntimeFailurePenalty(context);
  if (isTransientSiteRuntimeFailure(context)) {
    const lastTransientFailureAtMs = state.lastTransientFailureAtMs;
    const shouldContinueStreak = (
      typeof lastTransientFailureAtMs === 'number'
      && (nowMs - lastTransientFailureAtMs) <= SITE_TRANSIENT_STREAK_WINDOW_MS
    );
    state.transientFailureStreak = shouldContinueStreak
      ? state.transientFailureStreak + 1
      : 1;
    state.lastTransientFailureAtMs = nowMs;
    if (state.transientFailureStreak >= SITE_RUNTIME_BREAKER_STREAK_THRESHOLD) {
      state.breakerLevel = Math.min(state.breakerLevel + 1, SITE_RUNTIME_BREAKER_LEVELS_MS.length - 1);
      const breakerMs = resolveSiteRuntimeBreakerMs(state.breakerLevel);
      state.breakerUntilMs = breakerMs > 0 ? nowMs + breakerMs : null;
      state.transientFailureStreak = 0;
    }
  } else {
    state.transientFailureStreak = 0;
    state.lastTransientFailureAtMs = null;
  }
  state.lastFailureAtMs = nowMs;
}

function applyRuntimeHealthSuccess(state: SiteRuntimeHealthState, latencyMs: number, nowMs = Date.now()): void {
  refreshRecentOutcomeWindow(state, nowMs);
  state.recentSuccessCount += 1;
  state.penaltyScore = Math.max(0, state.penaltyScore * 0.2 - 0.3);
  state.transientFailureStreak = 0;
  state.lastTransientFailureAtMs = null;
  state.breakerLevel = 0;
  state.breakerUntilMs = null;
  state.lastSuccessAtMs = nowMs;
  const normalizedLatencyMs = Math.max(0, Math.trunc(latencyMs));
  state.latencyEmaMs = state.latencyEmaMs == null
    ? normalizedLatencyMs
    : (state.latencyEmaMs * (1 - SITE_RUNTIME_LATENCY_EMA_ALPHA))
      + (normalizedLatencyMs * SITE_RUNTIME_LATENCY_EMA_ALPHA);
}

function shouldPersistSiteRuntimeHealthState(state: SiteRuntimeHealthState, nowMs = Date.now()): boolean {
  const lastTouchedAtMs = Math.max(
    state.lastUpdatedAtMs,
    state.lastFailureAtMs ?? 0,
    state.lastSuccessAtMs ?? 0,
    state.lastTransientFailureAtMs ?? 0,
  );
  if ((nowMs - lastTouchedAtMs) > SITE_RUNTIME_HEALTH_PERSIST_STALE_TTL_MS) {
    return false;
  }

  if (isRuntimeHealthBreakerOpen(state, nowMs)) return true;
  if (getDecayedSiteRuntimePenalty(state, nowMs) >= SITE_RUNTIME_HEALTH_PERSIST_MIN_PENALTY) return true;
  if (getRecentOutcomeSnapshot(state, nowMs).sampleCount > 0.01) return true;
  if ((state.latencyEmaMs ?? 0) > 0) return true;
  return (nowMs - lastTouchedAtMs) <= SITE_RUNTIME_HEALTH_PERSIST_IDLE_TTL_MS;
}

function buildSiteRuntimeHealthPersistencePayload(nowMs = Date.now()): SiteRuntimeHealthPersistencePayload {
  const globalBySiteId: Record<string, SiteRuntimeHealthState> = {};
  const modelBySiteId: Record<string, Record<string, SiteRuntimeHealthState>> = {};

  for (const [siteId, state] of siteRuntimeHealthStates.entries()) {
    if (!shouldPersistSiteRuntimeHealthState(state, nowMs)) continue;
    globalBySiteId[String(siteId)] = cloneSiteRuntimeHealthState(state);
  }

  for (const [siteId, modelStates] of siteModelRuntimeHealthStates.entries()) {
    const persistedModels: Record<string, SiteRuntimeHealthState> = {};
    for (const [modelKey, state] of modelStates.entries()) {
      if (!shouldPersistSiteRuntimeHealthState(state, nowMs)) continue;
      persistedModels[modelKey] = cloneSiteRuntimeHealthState(state);
    }
    if (Object.keys(persistedModels).length > 0) {
      modelBySiteId[String(siteId)] = persistedModels;
    }
  }

  return {
    version: 1,
    savedAtMs: nowMs,
    globalBySiteId,
    modelBySiteId,
  };
}

async function persistSiteRuntimeHealthState(): Promise<void> {
  if (siteRuntimeHealthPersistInFlight) {
    await siteRuntimeHealthPersistInFlight;
    return;
  }
  const persistTask = (async () => {
    const payload = buildSiteRuntimeHealthPersistencePayload();
    await upsertSetting(SITE_RUNTIME_HEALTH_SETTING_KEY, payload);
  })();
  siteRuntimeHealthPersistInFlight = persistTask.finally(() => {
    if (siteRuntimeHealthPersistInFlight === persistTask) {
      siteRuntimeHealthPersistInFlight = null;
    }
  });
  await siteRuntimeHealthPersistInFlight;
}

function scheduleSiteRuntimeHealthPersistence(): void {
  if (siteRuntimeHealthSaveTimer) return;
  siteRuntimeHealthSaveTimer = setTimeout(() => {
    siteRuntimeHealthSaveTimer = null;
    void persistSiteRuntimeHealthState().catch((error) => {
      console.error('Failed to persist site runtime health state', error);
    });
  }, SITE_RUNTIME_HEALTH_PERSIST_DEBOUNCE_MS);
}

async function loadSiteRuntimeHealthStateFromSettings(): Promise<void> {
  siteRuntimeHealthStates.clear();
  siteModelRuntimeHealthStates.clear();

  const row = await db.select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, SITE_RUNTIME_HEALTH_SETTING_KEY))
    .get();
  if (!row?.value) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return;
  }
  if (!isRecord(parsed)) return;

  const globalBySiteId = isRecord(parsed.globalBySiteId) ? parsed.globalBySiteId : {};
  for (const [siteIdKey, stateRaw] of Object.entries(globalBySiteId)) {
    const siteId = Number(siteIdKey);
    if (!Number.isFinite(siteId) || siteId <= 0) continue;
    const state = hydrateSiteRuntimeHealthState(stateRaw);
    if (!state) continue;
    siteRuntimeHealthStates.set(siteId, state);
  }

  const modelBySiteId = isRecord(parsed.modelBySiteId) ? parsed.modelBySiteId : {};
  for (const [siteIdKey, modelStatesRaw] of Object.entries(modelBySiteId)) {
    const siteId = Number(siteIdKey);
    if (!Number.isFinite(siteId) || siteId <= 0 || !isRecord(modelStatesRaw)) continue;
    const hydratedModelStates = new Map<string, SiteRuntimeHealthState>();
    for (const [rawModelKey, stateRaw] of Object.entries(modelStatesRaw)) {
      const modelKey = normalizeModelAlias(rawModelKey);
      if (!modelKey) continue;
      const state = hydrateSiteRuntimeHealthState(stateRaw);
      if (!state) continue;
      hydratedModelStates.set(modelKey, state);
    }
    if (hydratedModelStates.size > 0) {
      siteModelRuntimeHealthStates.set(siteId, hydratedModelStates);
    }
  }
}

async function ensureSiteRuntimeHealthStateLoaded(): Promise<void> {
  if (siteRuntimeHealthLoaded) return;
  if (!siteRuntimeHealthLoadPromise) {
    siteRuntimeHealthLoadPromise = (async () => {
      try {
        await loadSiteRuntimeHealthStateFromSettings();
        siteRuntimeHealthLoaded = true;
      } catch (error) {
        console.warn('Failed to restore site runtime health state from settings', error);
        siteRuntimeHealthLoadPromise = null;
        siteRuntimeHealthLoaded = false;
      }
    })();
  }
  await siteRuntimeHealthLoadPromise;
}

function recordSiteRuntimeFailure(siteId: number, context: SiteRuntimeFailureContext = {}, nowMs = Date.now()): void {
  applyRuntimeHealthFailure(getOrCreateSiteRuntimeHealthState(siteId, nowMs), context, nowMs);
  const modelState = getOrCreateSiteModelRuntimeHealthState(siteId, context.modelName, nowMs);
  if (modelState) {
    applyRuntimeHealthFailure(modelState, context, nowMs);
  }
  scheduleSiteRuntimeHealthPersistence();
}

function recordSiteRuntimeSuccess(siteId: number, latencyMs: number, modelName?: string | null, nowMs = Date.now()): void {
  applyRuntimeHealthSuccess(getOrCreateSiteRuntimeHealthState(siteId, nowMs), latencyMs, nowMs);
  const modelState = getOrCreateSiteModelRuntimeHealthState(siteId, modelName, nowMs);
  if (modelState) {
    applyRuntimeHealthSuccess(modelState, latencyMs, nowMs);
  }
  scheduleSiteRuntimeHealthPersistence();
}

export function resetSiteRuntimeHealthState(): void {
  siteRuntimeHealthStates.clear();
  siteModelRuntimeHealthStates.clear();
  stableFirstObservationProgressByKey.clear();
  stableFirstObservationSiteCooldownByKey.clear();
  siteRuntimeHealthLoaded = false;
  siteRuntimeHealthLoadPromise = null;
  if (siteRuntimeHealthSaveTimer) {
    clearTimeout(siteRuntimeHealthSaveTimer);
    siteRuntimeHealthSaveTimer = null;
  }
  siteRuntimeHealthPersistInFlight = null;
}

export async function flushSiteRuntimeHealthPersistence(): Promise<void> {
  if (siteRuntimeHealthSaveTimer) {
    clearTimeout(siteRuntimeHealthSaveTimer);
    siteRuntimeHealthSaveTimer = null;
    await persistSiteRuntimeHealthState();
    return;
  }
  if (siteRuntimeHealthPersistInFlight) {
    await siteRuntimeHealthPersistInFlight;
  }
}

function clearRuntimeHealthStatesForTargets(rows: Array<{
  siteId: number;
  sourceModel: string | null;
  routeModelPattern: string;
}>): boolean {
  let changed = false;
  const modelKeysBySiteId = new Map<number, Set<string>>();

  for (const row of rows) {
    if (siteRuntimeHealthStates.delete(row.siteId)) {
      changed = true;
    }

    const resolvedModelName = normalizeTargetSourceModel(row.sourceModel)
      || (isExactRouteModelPattern(row.routeModelPattern) ? row.routeModelPattern.trim() : '');
    const modelKey = normalizeModelAlias(resolvedModelName);
    if (!modelKey) continue;
    if (!modelKeysBySiteId.has(row.siteId)) {
      modelKeysBySiteId.set(row.siteId, new Set());
    }
    modelKeysBySiteId.get(row.siteId)!.add(modelKey);
  }

  for (const [siteId, modelKeys] of modelKeysBySiteId.entries()) {
    const modelStates = siteModelRuntimeHealthStates.get(siteId);
    if (!modelStates) continue;
    for (const modelKey of modelKeys) {
      if (modelStates.delete(modelKey)) {
        changed = true;
      }
    }
    if (modelStates.size === 0) {
      siteModelRuntimeHealthStates.delete(siteId);
    }
  }

  return changed;
}

export function getSiteRuntimeHealthMultiplier(siteId: number, nowMs = Date.now()): number {
  const state = siteRuntimeHealthStates.get(siteId);
  return getRuntimeHealthMultiplier(state, nowMs);
}

export function isSiteRuntimeBreakerOpen(siteId: number, nowMs = Date.now()): boolean {
  const state = siteRuntimeHealthStates.get(siteId);
  return isRuntimeHealthBreakerOpen(state, nowMs);
}

export function filterSiteRuntimeBrokenCandidates<T extends { site: { id: number } }>(
  candidates: T[],
  nowMs = Date.now(),
): T[] {
  if (candidates.length <= 1) return candidates;
  const healthy = candidates.filter((candidate) => !isSiteRuntimeBreakerOpen(candidate.site.id, nowMs));
  return healthy.length > 0 ? healthy : candidates;
}

function buildRuntimeBreakerReason(details: SiteRuntimeHealthDetails): string {
  if (details.globalBreakerOpen && details.modelBreakerOpen) {
    return '站点熔断中，模型熔断中，优先避让';
  }
  if (details.globalBreakerOpen) {
    return '站点熔断中，优先避让';
  }
  if (details.modelBreakerOpen) {
    return '模型熔断中，优先避让';
  }
  return '运行时熔断中，优先避让';
}

function filterSiteRuntimeBrokenCandidatesByModel(
  candidates: RouteEndpointTargetCandidate[],
  modelName: string | ((candidate: RouteEndpointTargetCandidate) => string),
  nowMs = Date.now(),
): {
  candidates: RouteEndpointTargetCandidate[];
  avoided: Array<{ candidate: RouteEndpointTargetCandidate; reason: string }>;
} {
  if (candidates.length <= 1) {
    return {
      candidates,
      avoided: [],
    };
  }

  const resolveModelName = typeof modelName === 'function'
    ? modelName
    : (() => modelName);
  const avoided: Array<{ candidate: RouteEndpointTargetCandidate; reason: string }> = [];
  const healthy = candidates.filter((candidate) => {
    const details = getSiteRuntimeHealthDetails(candidate.site.id, resolveModelName(candidate), nowMs);
    const blocked = details.globalBreakerOpen || details.modelBreakerOpen;
    if (blocked) {
      avoided.push({
        candidate,
        reason: buildRuntimeBreakerReason(details),
      });
    }
    return !blocked;
  });

  return healthy.length > 0
    ? {
      candidates: healthy,
      avoided,
    }
    : {
      candidates,
      avoided: [],
    };
}

type RouteRow = typeof schema.tokenRoutes.$inferSelect & {
  routeMode: RouteMode;
  modelPattern: string;
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
  sourceRouteIds: number[];
};
type TargetRow = typeof schema.routeEndpointTargets.$inferSelect;

type RouteCacheSnapshot = {
  loadedAt: number;
  routes: RouteRow[];
};

type RouteMatchCacheSnapshot = {
  loadedAt: number;
  match: RouteMatch;
};

let routeCacheSnapshot: RouteCacheSnapshot = {
  loadedAt: 0,
  routes: [],
};

const routeMatchCache = new Map<number, RouteMatchCacheSnapshot>();

function resolveTokenRouterCacheTtlMs(): number {
  const raw = Math.trunc(config.tokenRouterCacheTtlMs || 0);
  return Math.max(100, raw);
}

function isCacheFresh(loadedAt: number, nowMs: number): boolean {
  return nowMs - loadedAt < resolveTokenRouterCacheTtlMs();
}

async function loadEnabledRoutes(nowMs = Date.now()): Promise<RouteRow[]> {
  if (isCacheFresh(routeCacheSnapshot.loadedAt, nowMs)) {
    return routeCacheSnapshot.routes;
  }

  const rawRoutes = await db.select().from(schema.tokenRoutes)
    .where(eq(schema.tokenRoutes.enabled, true))
    .all();
  const routeGroupSources = await db.select().from(schema.routeGroupSources).all();
  const sourceRouteIdsByGroupRouteId = new Map<number, number[]>();
  for (const source of routeGroupSources) {
    const existing = sourceRouteIdsByGroupRouteId.get(source.groupRouteId) || [];
    existing.push(source.sourceRouteId);
    sourceRouteIdsByGroupRouteId.set(source.groupRouteId, existing);
  }
  const bindings = await loadRouteGraphRouteTableBindings();
  const routes = rawRoutes.map((route) => {
    const binding = bindings.get(route.id);
    const legacySourceRouteIds = sourceRouteIdsByGroupRouteId.get(route.id) || [];
    const fallbackPattern = (route.modelPattern || route.displayName || '').trim();
    const match = binding?.match ?? {
      kind: 'model' as const,
      requestedModelPattern: fallbackPattern,
      currentModelPattern: '',
      displayName: route.displayName || null,
      downstreamProtocol: null,
      upstreamProtocol: null,
      sitePlatform: null,
      routeId: route.id,
      accountId: null,
      tokenId: null,
      siteId: null,
    };
    const backend = legacySourceRouteIds.length > 0
      ? { kind: 'routes' as const, routeIds: legacySourceRouteIds }
      : binding?.backend ?? { kind: 'supply' as const };
    return {
      ...route,
      match,
      backend,
      routeMode: legacySourceRouteIds.length > 0
        ? 'explicit_group'
        : binding?.routeMode ?? deriveLegacyRouteModeFromBackendSpec(backend),
      modelPattern: binding?.modelPattern ?? (deriveLegacyModelPatternFromSpecs(match, backend) || fallbackPattern),
      sourceRouteIds: binding?.sourceRouteIds ?? (
        legacySourceRouteIds.length > 0
          ? legacySourceRouteIds
          : deriveLegacySourceRouteIdsFromBackendSpec(backend)
      ),
    };
  });
  routeCacheSnapshot = {
    loadedAt: nowMs,
    routes,
  };
  return routes;
}

async function loadRouteMatch(route: RouteRow, nowMs = Date.now(), routeGraph?: RouteGraphRuntimeSelection | null): Promise<RouteMatch> {
  const cached = routeMatchCache.get(route.id);
  if (!routeGraph && cached && isCacheFresh(cached.loadedAt, nowMs)) {
    return cached.match;
  }

  const enabledRoutes = await loadEnabledRoutes(nowMs);
  const routeIds = (() => {
    if (!isExplicitGroupRoute(route)) {
      return [route.id];
    }
    return Array.from(new Set(route.sourceRouteIds.filter((routeId) => Number.isFinite(routeId) && routeId > 0)));
  })();
  const enabledSourceRoutes = isExplicitGroupRoute(route)
    ? enabledRoutes.filter((item) => (
      routeIds.includes(item.id)
      && !isExplicitGroupRoute(item)
      && isRouteGraphExactModelMatch(item.match, item.backend)
    ))
    : enabledRoutes.filter((item) => routeIds.includes(item.id));
  const enabledSourceRouteIds = enabledSourceRoutes.map((item) => item.id);
  const fallbackSourceModelByRouteId = new Map<number, string>(
    enabledSourceRoutes
      .filter((item) => isRouteGraphExactModelMatch(item.match, item.backend))
      .map((item) => [item.id, (item.modelPattern || '').trim()]),
  );
  const targets = enabledSourceRouteIds.length > 0
    ? await db
      .select()
      .from(schema.routeEndpointTargets)
      .innerJoin(schema.accounts, eq(schema.routeEndpointTargets.accountId, schema.accounts.id))
      .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
      .leftJoin(schema.accountTokens, eq(schema.routeEndpointTargets.tokenId, schema.accountTokens.id))
      .where(inArray(schema.routeEndpointTargets.routeId, enabledSourceRouteIds))
      .all()
    : [];

  const oauthRouteUnitIds: number[] = Array.from(new Set<number>(
    targets
      .map((row) => Number(row.route_endpoint_targets.oauthRouteUnitId))
      .filter((id): id is number => Number.isFinite(id) && id > 0),
  ));
  const [routeUnitSummaries, routeUnitMembersByUnitId] = await Promise.all([
    loadOauthRouteUnitSummariesByIds(oauthRouteUnitIds),
    listOauthRouteUnitMembersByUnitIds(oauthRouteUnitIds),
  ]);

  const mapped = targets.map((row) => ({
    target: {
      ...row.route_endpoint_targets,
      sourceModel: normalizeTargetSourceModel(row.route_endpoint_targets.sourceModel)
        || fallbackSourceModelByRouteId.get(row.route_endpoint_targets.routeId)
        || null,
    },
    account: row.accounts,
    site: row.sites,
    token: row.account_tokens,
    routeUnit: row.route_endpoint_targets.oauthRouteUnitId
      ? (routeUnitSummaries.get(row.route_endpoint_targets.oauthRouteUnitId) || null)
      : null,
    routeUnitMembers: row.route_endpoint_targets.oauthRouteUnitId
      ? (routeUnitMembersByUnitId.get(row.route_endpoint_targets.oauthRouteUnitId) || []).map((member) => ({
        member: member.member,
        account: member.account,
        site: member.site,
        token: null,
      }))
      : [],
  }));
  const match = { route, routeGraph: routeGraph || null, targets: mapped };
  if (!routeGraph) {
    routeMatchCache.set(route.id, {
      loadedAt: nowMs,
      match,
    });
  }
  return match;
}

function patchCachedTarget(targetId: number, apply: (target: TargetRow) => void): void {
  for (const entry of routeMatchCache.values()) {
    const target = entry.match.targets.find((item) => item.target.id === targetId);
    if (!target) continue;
    apply(target.target);
    break;
  }
}

function clearStableFirstCachesForRoute(routeId: number): void {
  const routePrefix = `${routeId}:`;
  for (const key of stableFirstLastSelectedSiteByKey.keys()) {
    if (key.startsWith(routePrefix)) {
      stableFirstLastSelectedSiteByKey.delete(key);
    }
  }
  for (const key of stableFirstObservationProgressByKey.keys()) {
    if (key.startsWith(routePrefix)) {
      stableFirstObservationProgressByKey.delete(key);
    }
  }
  for (const key of stableFirstObservationSiteCooldownByKey.keys()) {
    if (key.startsWith(routePrefix)) {
      stableFirstObservationSiteCooldownByKey.delete(key);
    }
  }
}

function invalidateRouteScopedCache(routeId: number): void {
  if (!Number.isFinite(routeId) || routeId <= 0) return;
  routeMatchCache.delete(routeId);
  clearStableFirstCachesForRoute(routeId);
}

export function invalidateTokenRouterCache(): void {
  routeCacheSnapshot = {
    loadedAt: 0,
    routes: [],
  };
  routeMatchCache.clear();
  stableFirstLastSelectedSiteByKey.clear();
  stableFirstObservationProgressByKey.clear();
  stableFirstObservationSiteCooldownByKey.clear();
}

function isSiteDisabled(status?: string | null): boolean {
  return (status || 'active') === 'disabled';
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
  // If all targets failed recently, keep them all and let weight/random decide.
  return healthy.length > 0 ? healthy : candidates;
}

export type RouteDecisionExplanation = RouteDecision & {
  routeId?: number;
  modelPattern?: string;
  selectedAccountId?: number;
};

const DEFAULT_DOWNSTREAM_POLICY: DownstreamRoutingPolicy = EMPTY_DOWNSTREAM_ROUTING_POLICY;

type ExplainSelectionOptions = {
  excludeTargetIds?: number[];
  bypassSourceModelCheck?: boolean;
  useTargetSourceModelForCost?: boolean;
  downstreamPolicy?: DownstreamRoutingPolicy;
};

type PricingReferenceRefreshOptions = {
  useTargetSourceModelForCost?: boolean;
  downstreamPolicy?: DownstreamRoutingPolicy;
  refreshedKeys?: Set<string>;
};

type CandidateEligibilityOptions = {
  requestedModel: string;
  bypassSourceModelCheck?: boolean;
  excludeTargetIds?: number[];
  nowIso?: string;
  downstreamPolicy?: DownstreamRoutingPolicy;
};

type CostSignal = {
  unitCost: number;
  source: 'observed' | 'configured' | 'endpoint' | 'fallback';
};

export function isRegexModelPattern(pattern: string): boolean {
  return isTokenRouteRegexPattern(pattern);
}

export function parseRegexModelPattern(pattern: string): { test(value: string): boolean } | null {
  return parseTokenRouteRegexPattern(pattern).regex;
}

export function matchesModelPattern(model: string, pattern: string): boolean {
  return matchesTokenRouteModelPattern(model, pattern);
}

function isExactRouteModelPattern(pattern: string): boolean {
  return isExactTokenRouteModelPattern(pattern);
}

function isExplicitGroupRoute(route: Pick<RouteRow, 'backend'> | Pick<RouteRow, 'routeMode'>): boolean {
  if ('backend' in route) {
    return normalizeRouteGraphBackendSpec(route.backend).kind === 'routes';
  }
  return route.routeMode === 'explicit_group';
}

function routeIdFromLegacyEntryNodeId(nodeId?: string | null): number | null {
  const match = /^entry:legacy:(\d+)$/.exec(String(nodeId || ''));
  if (!match) return null;
  const routeId = Number(match[1]);
  return Number.isFinite(routeId) && routeId > 0 ? routeId : null;
}

function explainRouteIdForMatch(match: RouteMatch): number {
  return routeIdFromLegacyEntryNodeId(match.routeGraph?.matchedEntryNodeId) || match.route.id;
}

function graphMatchedAliasForMatch(match: RouteMatch, requestedModel: string): string {
  if (!match.routeGraph || match.routeGraph.matchedEntryNodeId === match.routeGraph.selectedEntryNodeId) return '';
  return requestedModel.trim();
}

function normalizeRouteDisplayName(displayName: string | null | undefined): string {
  return (displayName || '').trim();
}

function isRouteDisplayNameMatch(model: string, displayName: string | null | undefined): boolean {
  const alias = normalizeRouteDisplayName(displayName);
  return !!alias && alias === model;
}

function isRouteExposedNameMatch(model: string, route: RouteRow): boolean {
  return isRouteDisplayNameMatch(model, getExposedModelNameForRoute(route));
}

function matchesRouteRequestModel(model: string, route: RouteRow): boolean {
  return routeGraphMatchesRequestedModel(model, route.match, route.backend);
}

function getExposedModelNameForRoute(route: RouteRow): string {
  return getRouteGraphExposedModelName(route.match, route.backend);
}

function hasCustomDisplayName(route: RouteRow): boolean {
  const displayName = normalizeRouteDisplayName(route.displayName);
  const requestedPattern = route.match.requestedModelPattern.trim();
  return !!displayName && displayName !== requestedPattern;
}

function buildVisibleEnabledRoutes(routes: RouteRow[]): RouteRow[] {
  const exactModelNames = new Set(
    routes
      .filter((route) => !isExplicitGroupRoute(route) && isRouteGraphExactModelMatch(route.match, route.backend))
      .map((route) => (route.modelPattern || '').trim())
      .filter(Boolean),
  );
  const coveringGroups = routes.filter((route) => (
    route.enabled
    && (
      (isExplicitGroupRoute(route) && normalizeRouteDisplayName(route.displayName).length > 0 && route.sourceRouteIds.length > 0)
      || (!isExplicitGroupRoute(route) && !isRouteGraphExactModelMatch(route.match, route.backend) && hasCustomDisplayName(route))
    )
  ));

  if (coveringGroups.length === 0) return routes;

  return routes.filter((route) => {
    if (isExplicitGroupRoute(route)) {
      return normalizeRouteDisplayName(route.displayName).length > 0;
    }
    if (!isRouteGraphExactModelMatch(route.match, route.backend)) return true;
    if (hasCustomDisplayName(route)) return true;

    const exactModel = (route.modelPattern || '').trim();
    if (!exactModel) return true;

    return !coveringGroups.some((groupRoute) => {
      if (groupRoute.id === route.id) return false;
      const groupDisplayName = normalizeRouteDisplayName(groupRoute.displayName);
      if (!groupDisplayName || exactModelNames.has(groupDisplayName)) return false;
      if (isExplicitGroupRoute(groupRoute)) {
        return groupRoute.sourceRouteIds.includes(route.id);
      }
      return routeGraphMatchesRequestedModel(exactModel, groupRoute.match, groupRoute.backend);
    });
  });
}

function normalizeModelAlias(modelName: string): string {
  const normalized = (modelName || '').trim().toLowerCase();
  if (!normalized) return '';
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex >= 0 && slashIndex < normalized.length - 1) {
    return normalized.slice(slashIndex + 1);
  }
  return normalized;
}

function isModelAliasEquivalent(left: string, right: string): boolean {
  const a = normalizeModelAlias(left);
  const b = normalizeModelAlias(right);
  return !!a && !!b && a === b;
}

function targetSupportsRequestedModel(targetSourceModel: string | null | undefined, requestedModel: string): boolean {
  const source = (targetSourceModel || '').trim();
  if (!source) return true;
  if (source === requestedModel) return true;
  if (isModelAliasEquivalent(source, requestedModel)) return true;
  if (matchesModelPattern(requestedModel, source)) return true;
  return false;
}

function isModelAllowedByDownstreamPolicy(requestedModel: string, policy: DownstreamRoutingPolicy): boolean {
  const supportedPatterns = Array.isArray(policy.supportedModels)
    ? policy.supportedModels
    : [];
  const hasSupportedPatterns = supportedPatterns.length > 0;
  const hasAllowedRoutes = policy.allowedRouteIds.length > 0;
  if (!hasSupportedPatterns && !hasAllowedRoutes) return policy.denyAllWhenEmpty === true ? false : true;
  const matchedSupportedPattern = supportedPatterns.some((pattern) => matchesModelPattern(requestedModel, pattern));
  if (matchedSupportedPattern) return true;
  if (hasAllowedRoutes) return true;
  return false;
}

function parseModelMappingRecord(modelMapping?: string | Record<string, unknown> | null): Record<string, unknown> | null {
  if (!modelMapping) return null;
  if (typeof modelMapping === 'object' && !Array.isArray(modelMapping)) {
    return modelMapping as Record<string, unknown>;
  }
  if (typeof modelMapping !== 'string') return null;
  try {
    const parsed = JSON.parse(modelMapping);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveMappedModel(requestedModel: string, modelMapping?: string | Record<string, unknown> | null): string {
  const parsed = parseModelMappingRecord(modelMapping);
  if (!parsed) return requestedModel;

  const entries = Object.entries(parsed)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0) as Array<[string, string]>;

  const exact = entries.find(([pattern]) => pattern === requestedModel);
  if (exact) return exact[1].trim();

  for (const [pattern, target] of entries) {
    if (matchesModelPattern(requestedModel, pattern)) {
      return target.trim();
    }
  }

  return requestedModel;
}

function resolveRouteMatchUpstreamModel(match: RouteMatch, requestedModel: string): string {
  const selectedTarget = match.routeGraph?.selectedEndpointTarget;
  if (selectedTarget?.modelSource !== 'request' && selectedTarget?.model) {
    return selectedTarget.model;
  }
  const graphModel = match.routeGraph?.upstreamModel || match.routeGraph?.currentModel || requestedModel;
  return resolveMappedModel(graphModel, match.route.modelMapping);
}

function normalizeTargetSourceModel(targetSourceModel: string | null | undefined): string {
  return (targetSourceModel || '').trim();
}

function resolveActualModelForSelectedTarget(
  requestedModel: string,
  route: RouteRow,
  mappedModel: string,
  targetSourceModel: string | null | undefined,
  routeGraph?: RouteGraphRuntimeSelection | null,
): string {
  const selectedTarget = routeGraph?.selectedEndpointTarget;
  if (selectedTarget?.modelSource !== 'request' && selectedTarget?.model) {
    return selectedTarget.model;
  }
  const sourceModel = normalizeTargetSourceModel(targetSourceModel);
  if (isRouteDisplayNameMatch(requestedModel, route.displayName) && sourceModel) {
    return sourceModel;
  }
  return mappedModel;
}

function routeGraphSelectionForSelectedCandidate(
  routeGraph: RouteGraphRuntimeSelection | null | undefined,
  _selected: RouteEndpointTargetCandidate,
): RouteGraphRuntimeSelection | null | undefined {
  return routeGraph;
}

function numericTargetId(value: unknown): number | null {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value.trim())
      : NaN;
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

function buildRouteExecutionScope(match: RouteMatch, requestedModel: string): RouteExecutionScope {
  const graphTargetId = numericTargetId(match.routeGraph?.selectedEndpointTarget?.targetId);
  const routeTargetIds = match.targets
    .map((candidate) => candidate.target.id)
    .filter((targetId): targetId is number => Number.isSafeInteger(targetId) && targetId > 0);
  const graphCandidateSnapshots = match.routeGraph?.candidateSnapshots || [];
  const graphScopeTargetIds = graphCandidateSnapshots.flatMap((candidate) => candidate.targetIds);
  const baseAllowedTargetIds = graphScopeTargetIds.length > 0 ? graphScopeTargetIds : routeTargetIds;
  const allowedTargetIds = graphTargetId
    ? baseAllowedTargetIds.filter((targetId) => targetId === graphTargetId || graphScopeTargetIds.length > 0)
    : baseAllowedTargetIds;
  const routeEndpointId = match.routeGraph?.selectedEndpointTarget?.endpointId
    || match.routeGraph?.selectedEntryNodeId
    || `route:${match.route.id}`;
  const candidateId = match.routeGraph?.trace.path
    .map((step) => step.selectedCandidateId)
    .filter((value): value is string => !!value)
    .at(-1)
    || routeEndpointId;

  return {
    scopeId: `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`,
    graphVersionId: match.routeGraph?.graphVersionId ?? null,
    graphVersion: match.routeGraph?.graphVersion ?? null,
    requestedModel,
    matchedEntryNodeId: match.routeGraph?.matchedEntryNodeId ?? null,
    matchedRouteId: match.routeGraph?.matchedRouteId ?? null,
    selectedRouteId: match.routeGraph?.selectedRouteId ?? match.route.id,
    selectedCandidateId: candidateId,
    allowedTargetIds,
    candidates: graphCandidateSnapshots.length > 0
      ? graphCandidateSnapshots.map((candidate) => ({
          candidateId: candidate.candidateId,
          routeEndpointId: candidate.endpointId || candidate.nodeId || candidate.candidateId,
          routeId: candidate.routeId,
          supplyTargetId: null,
          targetIds: candidate.targetIds,
          priority: candidate.priority,
          weight: candidate.weight,
          enabled: candidate.enabled,
        }))
      : [{
          candidateId,
          routeEndpointId,
          routeId: match.route.id,
          supplyTargetId: match.routeGraph?.selectedEndpointTarget?.targetId ?? null,
          targetIds: allowedTargetIds,
          priority: Math.min(...match.targets.map((candidate) => candidate.target.priority ?? 0), 0),
          weight: match.targets.reduce((sum, candidate) => sum + (candidate.target.weight ?? 0), 0),
          enabled: allowedTargetIds.length > 0,
        }],
    failureOverlay: {
      disabledCandidateIds: [],
      disabledEndpointIds: [],
      disabledTargetIds: [],
    },
    routeGraph: match.routeGraph ?? null,
    matchSnapshot: {
      ...match,
      targets: match.targets.filter((candidate) => allowedTargetIds.includes(candidate.target.id)),
    },
  };
}

function matchWithinRouteExecutionScope(scope: RouteExecutionScope): RouteMatch {
  const allowed = new Set(scope.allowedTargetIds);
  const matchSnapshot = scope.matchSnapshot as RouteMatch;
  return {
    ...matchSnapshot,
    routeGraph: scope.routeGraph ?? matchSnapshot.routeGraph ?? null,
    targets: matchSnapshot.targets.filter((candidate) => allowed.has(candidate.target.id)),
  };
}

function routeExecutionFailureOverlayForExcludedTargets(
  scope: RouteExecutionScope,
  excludeTargetIds: number[],
): RouteGraphRuntimeFailureOverlay {
  const disabledTargetIds = Array.from(new Set([
    ...(scope.failureOverlay.disabledTargetIds || []),
    ...excludeTargetIds,
  ].filter((targetId) => Number.isSafeInteger(targetId) && targetId > 0)));
  const failedCandidates = scope.candidates.filter((candidate) => (
    candidate.targetIds.some((targetId) => disabledTargetIds.includes(targetId))
  ));
  return {
    disabledTargetIds,
    disabledCandidateIds: Array.from(new Set([
      ...(scope.failureOverlay.disabledCandidateIds || []),
      ...failedCandidates.map((candidate) => candidate.candidateId),
    ].filter(Boolean))),
    disabledEndpointIds: Array.from(new Set([
      ...(scope.failureOverlay.disabledEndpointIds || []),
      ...failedCandidates.map((candidate) => candidate.routeEndpointId),
    ].filter(Boolean))),
  };
}

function routeGraphSelectionIsInsideScope(
  scope: RouteExecutionScope,
  selection: RouteGraphRuntimeSelection | null | undefined,
): boolean {
  if (!selection || selection.terminalKind !== 'route_endpoint') return false;
  if (scope.graphVersionId != null && selection.graphVersionId != null && selection.graphVersionId !== scope.graphVersionId) {
    return false;
  }
  const selectedRouteId = selection.selectedRouteId ?? selection.matchedRouteId ?? null;
  const scopeRouteIds = new Set(scope.candidates.map((candidate) => candidate.routeId).filter((routeId): routeId is number => Number.isSafeInteger(routeId)));
  if (scopeRouteIds.size > 0 && selectedRouteId != null && !scopeRouteIds.has(selectedRouteId)) return false;
  const selectedTargetId = numericTargetId(selection.selectedEndpointTarget?.targetId);
  if (selectedTargetId != null && !scope.allowedTargetIds.includes(selectedTargetId)) return false;
  const selectedCandidateIds = selection.trace.path
    .map((step) => step.selectedCandidateId)
    .filter((value): value is string => !!value);
  const scopeCandidateIds = new Set(scope.candidates.map((candidate) => candidate.candidateId));
  return selectedCandidateIds.length === 0 || selectedCandidateIds.some((candidateId) => scopeCandidateIds.has(candidateId));
}

function resolveRouteStrategy(route: RouteRow): RouteRoutingStrategy {
  return normalizeRouteRoutingStrategy(route.routingStrategy);
}

function parseIsoTimeMs(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function compareNullableTimeAsc(left?: string | null, right?: string | null): number {
  const leftMs = parseIsoTimeMs(left);
  const rightMs = parseIsoTimeMs(right);
  if (leftMs == null && rightMs == null) return 0;
  if (leftMs == null) return -1;
  if (rightMs == null) return 1;
  return leftMs - rightMs;
}

function compareNullableTimeDesc(left?: string | null, right?: string | null): number {
  return compareNullableTimeAsc(right, left);
}

function isOauthRouteUnitCandidate(candidate: RouteEndpointTargetCandidate): boolean {
  return !!candidate.routeUnit || !!candidate.target.oauthRouteUnitId;
}

function isOauthRouteUnitMemberCoolingDown(
  member: typeof schema.oauthRouteUnitMembers.$inferSelect,
  nowIso: string,
): boolean {
  return !!member.cooldownUntil && member.cooldownUntil > nowIso;
}

function compareStableFirstCandidateOrder(left: RouteEndpointTargetCandidate, right: RouteEndpointTargetCandidate): number {
  const selectionOrder = compareNullableTimeAsc(
    left.target.lastSelectedAt || left.target.lastUsedAt,
    right.target.lastSelectedAt || right.target.lastUsedAt,
  );
  if (selectionOrder !== 0) return selectionOrder;

  const usedOrder = compareNullableTimeAsc(left.target.lastUsedAt, right.target.lastUsedAt);
  if (usedOrder !== 0) return usedOrder;

  return (left.target.id ?? 0) - (right.target.id ?? 0);
}

function resolveTargetRuntimeLoadMultiplier(snapshot: ProxyTargetLoadSnapshot): number {
  if (!snapshot.sessionScoped || snapshot.concurrencyLimit <= 0) return 1;

  const activeRatio = clampNumber(snapshot.activeLeaseCount / Math.max(1, snapshot.concurrencyLimit), 0, 1.5);
  const waitingRatio = clampNumber(snapshot.waitingCount / Math.max(1, snapshot.concurrencyLimit), 0, 3);
  const activePenalty = activeRatio * 0.28;
  const waitingPenalty = waitingRatio * 0.32;
  const saturationPenalty = snapshot.saturated ? 0.12 : 0;
  return clampNumber(1 - activePenalty - waitingPenalty - saturationPenalty, 0.18, 1);
}

function formatTargetRuntimeLoad(snapshot: ProxyTargetLoadSnapshot): string {
  if (!snapshot.sessionScoped || snapshot.concurrencyLimit <= 0) {
    return '未限流';
  }
  const multiplier = resolveTargetRuntimeLoadMultiplier(snapshot);
  return `${multiplier.toFixed(2)}（活跃=${snapshot.activeLeaseCount}/${snapshot.concurrencyLimit}，等待=${snapshot.waitingCount}）`;
}

function resolveCandidateTokenGroup(candidate: RouteEndpointTargetCandidate): string | null {
  const direct = candidate.token?.tokenGroup?.trim();
  if (direct) return direct;
  return null;
}

function resolveEffectiveUnitCost(candidate: RouteEndpointTargetCandidate, modelName: string): CostSignal {
  const successCount = Math.max(0, candidate.target.successCount ?? 0);
  const totalCost = Math.max(0, candidate.target.totalCost ?? 0);
  const configured = candidate.account.unitCost ?? null;

  if (successCount > 0 && totalCost > 0) {
    return {
      unitCost: Math.max(totalCost / successCount, MIN_EFFECTIVE_UNIT_COST),
      source: 'observed',
    };
  }

  if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
    return {
      unitCost: Math.max(configured, MIN_EFFECTIVE_UNIT_COST),
      source: 'configured',
    };
  }

  const endpointPricing = getCachedEndpointRoutingReferencePricing({
    siteId: candidate.site.id,
    accountId: candidate.account.id,
    tokenId: candidate.target.tokenId ?? candidate.token?.id ?? null,
    tokenGroup: resolveCandidateTokenGroup(candidate),
    modelName,
  });
  const endpointCost = endpointPricing?.summary.totalCostUsd ?? null;
  if (typeof endpointCost === 'number' && Number.isFinite(endpointCost) && endpointCost > 0) {
    return {
      unitCost: Math.max(endpointCost, MIN_EFFECTIVE_UNIT_COST),
      source: 'endpoint',
    };
  }

  return {
    unitCost: Math.max(config.routingFallbackUnitCost || 1, MIN_EFFECTIVE_UNIT_COST),
    source: 'fallback',
  };
}

type SiteHistoricalHealthMetrics = {
  multiplier: number;
  totalCalls: number;
  successRate: number | null;
  avgLatencyMs: number | null;
};

function buildSiteHistoricalHealthMetrics(candidates: RouteEndpointTargetCandidate[]): Map<number, SiteHistoricalHealthMetrics> {
  const totals = new Map<number, {
    totalCalls: number;
    successCount: number;
    failCount: number;
    totalLatencyMs: number;
    latencySamples: number;
  }>();

  for (const candidate of candidates) {
    const siteId = candidate.site.id;
    if (!totals.has(siteId)) {
      totals.set(siteId, {
        totalCalls: 0,
        successCount: 0,
        failCount: 0,
        totalLatencyMs: 0,
        latencySamples: 0,
      });
    }
    const target = totals.get(siteId)!;
    const successCount = Math.max(0, candidate.target.successCount ?? 0);
    const failCount = Math.max(0, candidate.target.failCount ?? 0);
    target.successCount += successCount;
    target.failCount += failCount;
    target.totalCalls += successCount + failCount;
    if (successCount > 0) {
      target.totalLatencyMs += Math.max(0, candidate.target.totalLatencyMs ?? 0);
      target.latencySamples += successCount;
    }
  }

  const metrics = new Map<number, SiteHistoricalHealthMetrics>();
  for (const [siteId, total] of totals.entries()) {
    if (total.totalCalls <= 0) {
      metrics.set(siteId, {
        multiplier: 1,
        totalCalls: 0,
        successRate: null,
        avgLatencyMs: null,
      });
      continue;
    }

    const sampleFactor = clampNumber(total.totalCalls / SITE_HISTORICAL_HEALTH_MAX_SAMPLE, 0, 1);
    const successRate = total.successCount / total.totalCalls;
    const successPenaltyFactor = 1 - ((1 - successRate) * 0.55 * sampleFactor);
    const avgLatencyMs = total.latencySamples > 0
      ? Math.round(total.totalLatencyMs / total.latencySamples)
      : null;
    const latencyPenaltyRatio = avgLatencyMs == null
      ? 0
      : clampNumber(
        (avgLatencyMs - SITE_HISTORICAL_LATENCY_BASELINE_MS) / SITE_HISTORICAL_LATENCY_WINDOW_MS,
        0,
        1,
      ) * sampleFactor;
    const latencyFactor = 1 - (latencyPenaltyRatio * SITE_HISTORICAL_MAX_LATENCY_PENALTY);
    metrics.set(siteId, {
      multiplier: clampNumber(
        successPenaltyFactor * latencyFactor,
        SITE_HISTORICAL_HEALTH_MIN_MULTIPLIER,
        1,
      ),
      totalCalls: total.totalCalls,
      successRate,
      avgLatencyMs,
    });
  }

  return metrics;
}

function buildStableFirstPoolPlan(
  candidates: RouteEndpointTargetCandidate[],
  modelName: string | ((candidate: RouteEndpointTargetCandidate) => string),
  nowMs = Date.now(),
): StableFirstPoolPlan {
  if (candidates.length <= 0) {
    return {
      primaryCandidates: [],
      observationCandidates: [],
      primarySiteIds: new Set<number>(),
      observationSiteIds: new Set<number>(),
      siteStateById: new Map<number, StableFirstSitePoolState>(),
    };
  }

  const resolveModelName = typeof modelName === 'function'
    ? modelName
    : (() => modelName);
  const historicalBySiteId = buildSiteHistoricalHealthMetrics(candidates);
  const leaderBySiteId = new Map<number, RouteEndpointTargetCandidate>();
  const siteStateById = new Map<number, StableFirstSitePoolState>();

  for (const candidate of candidates) {
    const siteId = candidate.site.id;
    const currentLeader = leaderBySiteId.get(siteId);
    if (!currentLeader || compareStableFirstCandidateOrder(candidate, currentLeader) < 0) {
      leaderBySiteId.set(siteId, candidate);
    }
  }

  for (const [siteId, leader] of leaderBySiteId.entries()) {
    const healthDetails = getSiteRuntimeHealthDetails(siteId, resolveModelName(leader), nowMs);
    const historical = historicalBySiteId.get(siteId);
    const historicalTotalCalls = historical?.totalCalls ?? 0;
    const effectiveSuccessRate = resolveStableFirstSuccessRate(healthDetails, historical?.successRate);
    const trusted = (
      healthDetails.recentConfidence >= STABLE_FIRST_TRUSTED_RECENT_CONFIDENCE
      || historicalTotalCalls >= STABLE_FIRST_TRUSTED_HISTORICAL_CALLS
    );
    siteStateById.set(siteId, {
      siteId,
      leader,
      effectiveSuccessRate,
      trusted,
      observationReason: null,
    });
  }

  const allSiteStates = Array.from(siteStateById.values()).sort((left, right) => {
    const rateDiff = right.effectiveSuccessRate - left.effectiveSuccessRate;
    if (Math.abs(rateDiff) > 1e-9) return rateDiff > 0 ? 1 : -1;
    return compareStableFirstCandidateOrder(left.leader, right.leader);
  });
  const trustedSiteStates = allSiteStates.filter((state) => state.trusted);
  const leaderPool = trustedSiteStates.length > 0 ? trustedSiteStates : allSiteStates;

  const primarySiteIds = new Set<number>();
  const observationSiteIds = new Set<number>();
  const bestRate = leaderPool[0]?.effectiveSuccessRate ?? 0;
  const thresholdRate = bestRate > 0
    ? (bestRate * STABLE_FIRST_PRIMARY_SUCCESS_RATE_RATIO)
    : 0;

  for (const state of allSiteStates) {
    const inPrimary = leaderPool.length === 0
      ? true
      : (
        leaderPool.some((leaderState) => leaderState.siteId === state.siteId)
        && state.effectiveSuccessRate >= thresholdRate
      );
    if (inPrimary) {
      primarySiteIds.add(state.siteId);
      continue;
    }
    observationSiteIds.add(state.siteId);
    state.observationReason = state.trusted
      ? '观察池：近期成功率暂时落后，仅灰度真实流量会命中'
      : '观察池：近期样本不足，仅灰度真实流量会命中';
  }

  if (primarySiteIds.size <= 0 && allSiteStates.length > 0) {
    primarySiteIds.add(allSiteStates[0].siteId);
    observationSiteIds.delete(allSiteStates[0].siteId);
  }

  return {
    primaryCandidates: candidates.filter((candidate) => primarySiteIds.has(candidate.site.id)),
    observationCandidates: candidates.filter((candidate) => observationSiteIds.has(candidate.site.id)),
    primarySiteIds,
    observationSiteIds,
    siteStateById,
  };
}

function shouldUseStableFirstObservationCandidate(
  rotationKey: string,
  observationCandidates: RouteEndpointTargetCandidate[],
  nowMs = Date.now(),
): boolean {
  if (!rotationKey || observationCandidates.length <= 0) return false;
  const state = stableFirstObservationProgressByKey.get(rotationKey) ?? {
    requestCount: 0,
    lastObservationAtMs: null,
  };
  if ((state.requestCount + 1) < STABLE_FIRST_OBSERVATION_REQUEST_INTERVAL) {
    return false;
  }
  return observationCandidates.some((candidate) => {
    const observedAtMs = stableFirstObservationSiteCooldownByKey.get(`${rotationKey}:${candidate.site.id}`) ?? null;
    return observedAtMs == null || (nowMs - observedAtMs) >= STABLE_FIRST_OBSERVATION_SITE_COOLDOWN_MS;
  });
}

function updateStableFirstObservationProgress(
  rotationKey: string,
  input: {
    usedObservation: boolean;
    selectedSiteId?: number | null;
    nowMs?: number;
  },
): void {
  if (!rotationKey) return;
  const nowMs = input.nowMs ?? Date.now();
  const previous = stableFirstObservationProgressByKey.get(rotationKey) ?? {
    requestCount: 0,
    lastObservationAtMs: null,
  };
  if (input.usedObservation) {
    rememberStableFirstObservationProgressForKey(rotationKey, {
      requestCount: 0,
      lastObservationAtMs: nowMs,
    });
    if (typeof input.selectedSiteId === 'number' && input.selectedSiteId > 0) {
      rememberStableFirstObservationSiteCooldown(rotationKey, input.selectedSiteId, nowMs);
    }
    return;
  }
  rememberStableFirstObservationProgressForKey(rotationKey, {
    requestCount: Math.max(0, previous.requestCount) + 1,
    lastObservationAtMs: previous.lastObservationAtMs,
  });
}

function isExplicitTokenTarget(candidate: RouteEndpointTargetCandidate): boolean {
  return typeof candidate.target.tokenId === 'number' && candidate.target.tokenId > 0;
}

export class TokenRouter {
  /**
   * Find matching route and select a target for the given model.
   * Returns null if no route/target available.
   */
  async selectTarget(requestedModel: string, downstreamPolicy: DownstreamRoutingPolicy = DEFAULT_DOWNSTREAM_POLICY): Promise<SelectedTarget | null> {
    if (!isModelAllowedByDownstreamPolicy(requestedModel, downstreamPolicy)) return null;
    await ensureSiteRuntimeHealthStateLoaded();

    const match = await this.findRoute(requestedModel, downstreamPolicy);
    if (!match) return null;
    const scope = buildRouteExecutionScope(match, requestedModel);
    return await this.selectFromMatch(matchWithinRouteExecutionScope(scope), requestedModel, downstreamPolicy, [], true, scope);
  }

  async previewSelectedTarget(
    requestedModel: string,
    downstreamPolicy: DownstreamRoutingPolicy = DEFAULT_DOWNSTREAM_POLICY,
  ): Promise<SelectedTarget | null> {
    if (!isModelAllowedByDownstreamPolicy(requestedModel, downstreamPolicy)) return null;
    await ensureSiteRuntimeHealthStateLoaded();

    const match = await this.findRoute(requestedModel, downstreamPolicy);
    if (!match) return null;
    const scope = buildRouteExecutionScope(match, requestedModel);
    return await this.selectFromMatch(matchWithinRouteExecutionScope(scope), requestedModel, downstreamPolicy, [], false, scope);
  }

  /**
   * Select next target for failover (exclude already-tried targets).
   */
  async selectNextTarget(
    requestedModel: string,
    excludeTargetIds: number[],
    downstreamPolicy: DownstreamRoutingPolicy = DEFAULT_DOWNSTREAM_POLICY,
  ): Promise<SelectedTarget | null> {
    if (!isModelAllowedByDownstreamPolicy(requestedModel, downstreamPolicy)) return null;
    await ensureSiteRuntimeHealthStateLoaded();

    const match = await this.findRoute(requestedModel, downstreamPolicy);
    if (!match) return null;
    return await this.selectFromMatch(match, requestedModel, downstreamPolicy, excludeTargetIds);
  }

  async selectNextTargetWithinScope(
    scope: RouteExecutionScope,
    excludeTargetIds: number[],
    downstreamPolicy: DownstreamRoutingPolicy = DEFAULT_DOWNSTREAM_POLICY,
  ): Promise<SelectedTarget | null> {
    if (!isModelAllowedByDownstreamPolicy(scope.requestedModel, downstreamPolicy)) return null;
    await ensureSiteRuntimeHealthStateLoaded();

    const failureOverlay = routeExecutionFailureOverlayForExcludedTargets(scope, excludeTargetIds);
    const rerunGraphSelection = await evaluateActiveRouteGraphForModel(scope.requestedModel, { failureOverlay });
    if (routeGraphSelectionIsInsideScope(scope, rerunGraphSelection)) {
      const scopedGraphSelection = rerunGraphSelection;
      if (!scopedGraphSelection) return null;
      const selectedGraphRouteId = scopedGraphSelection.matchedRouteId ?? scopedGraphSelection.selectedRouteId ?? null;
      const routes = await loadEnabledRoutes();
      const graphRoute = selectedGraphRouteId
        ? routes.find((route) => route.id === selectedGraphRouteId)
        : null;
      if (graphRoute) {
        const graphMatch = await loadRouteMatch(graphRoute, Date.now(), scopedGraphSelection);
        const nextScope: RouteExecutionScope = {
          ...scope,
          failureOverlay,
          routeGraph: scopedGraphSelection,
          matchSnapshot: graphMatch,
          selectedRouteId: scopedGraphSelection.selectedRouteId ?? scope.selectedRouteId,
          selectedCandidateId: scopedGraphSelection.trace.path
            .map((step) => step.selectedCandidateId)
            .filter((value): value is string => !!value)
            .at(-1) ?? scope.selectedCandidateId,
        };
        return await this.selectFromMatch(
          matchWithinRouteExecutionScope(nextScope),
          scope.requestedModel,
          downstreamPolicy,
          excludeTargetIds,
          true,
          nextScope,
        );
      }
    }

    return await this.selectFromMatch(
      matchWithinRouteExecutionScope(scope),
      scope.requestedModel,
      downstreamPolicy,
      excludeTargetIds,
      true,
      scope,
    );
  }

  async selectPreferredTarget(
    requestedModel: string,
    preferredTargetId: number,
    downstreamPolicy: DownstreamRoutingPolicy = DEFAULT_DOWNSTREAM_POLICY,
    excludeTargetIds: number[] = [],
  ): Promise<SelectedTarget | null> {
    if (!isModelAllowedByDownstreamPolicy(requestedModel, downstreamPolicy)) return null;
    const normalizedPreferredTargetId = Math.trunc(preferredTargetId || 0);
    if (normalizedPreferredTargetId <= 0) return null;
    await ensureSiteRuntimeHealthStateLoaded();

    const match = await this.findRoute(requestedModel, downstreamPolicy);
    if (!match) return null;
    return await this.selectPreferredFromMatch(
      match,
      requestedModel,
      normalizedPreferredTargetId,
      downstreamPolicy,
      excludeTargetIds,
    );
  }

  async selectPreferredTargetWithinScope(
    scope: RouteExecutionScope,
    preferredTargetId: number,
    downstreamPolicy: DownstreamRoutingPolicy = DEFAULT_DOWNSTREAM_POLICY,
    excludeTargetIds: number[] = [],
  ): Promise<SelectedTarget | null> {
    if (!isModelAllowedByDownstreamPolicy(scope.requestedModel, downstreamPolicy)) return null;
    const normalizedPreferredTargetId = Math.trunc(preferredTargetId || 0);
    if (normalizedPreferredTargetId <= 0) return null;
    if (!scope.allowedTargetIds.includes(normalizedPreferredTargetId)) return null;
    await ensureSiteRuntimeHealthStateLoaded();

    return await this.selectPreferredFromMatch(
      matchWithinRouteExecutionScope(scope),
      scope.requestedModel,
      normalizedPreferredTargetId,
      downstreamPolicy,
      excludeTargetIds,
      true,
      scope,
    );
  }

  async explainSelection(
    requestedModel: string,
    excludeTargetIds: number[] = [],
    downstreamPolicy: DownstreamRoutingPolicy = DEFAULT_DOWNSTREAM_POLICY,
  ): Promise<RouteDecisionExplanation> {
    await ensureSiteRuntimeHealthStateLoaded();
    const match = await this.findRoute(requestedModel, downstreamPolicy);
    return this.explainSelectionFromMatch(match, requestedModel, { excludeTargetIds, downstreamPolicy });
  }

  async explainSelectionForRoute(
    routeId: number,
    requestedModel: string,
    excludeTargetIds: number[] = [],
    downstreamPolicy: DownstreamRoutingPolicy = DEFAULT_DOWNSTREAM_POLICY,
  ): Promise<RouteDecisionExplanation> {
    await ensureSiteRuntimeHealthStateLoaded();
    const match = await this.findRouteById(routeId, downstreamPolicy);
    return this.explainSelectionFromMatch(match, requestedModel, { excludeTargetIds, downstreamPolicy });
  }

  async explainSelectionRouteWide(routeId: number, downstreamPolicy: DownstreamRoutingPolicy = DEFAULT_DOWNSTREAM_POLICY): Promise<RouteDecisionExplanation> {
    await ensureSiteRuntimeHealthStateLoaded();
    const match = await this.findRouteById(routeId, downstreamPolicy);
    const fallbackRequestedModel = match?.route.modelPattern || `route:${routeId}`;
    return this.explainSelectionFromMatch(match, fallbackRequestedModel, {
      bypassSourceModelCheck: true,
      useTargetSourceModelForCost: true,
      downstreamPolicy,
    });
  }

  async refreshPricingReferenceCosts(
    requestedModel: string,
    options: PricingReferenceRefreshOptions = {},
  ): Promise<void> {
    const downstreamPolicy = options.downstreamPolicy ?? DEFAULT_DOWNSTREAM_POLICY;
    const match = await this.findRoute(requestedModel, downstreamPolicy);
    await this.refreshPricingReferenceCostsForMatch(match, requestedModel, options);
  }

  async refreshPricingReferenceCostsForRoute(
    routeId: number,
    requestedModel: string,
    options: PricingReferenceRefreshOptions = {},
  ): Promise<void> {
    const downstreamPolicy = options.downstreamPolicy ?? DEFAULT_DOWNSTREAM_POLICY;
    const match = await this.findRouteById(routeId, downstreamPolicy);
    await this.refreshPricingReferenceCostsForMatch(match, requestedModel, options);
  }

  async refreshRouteWidePricingReferenceCosts(
    routeId: number,
    options: Omit<PricingReferenceRefreshOptions, 'useTargetSourceModelForCost'> = {},
  ): Promise<void> {
    const downstreamPolicy = options.downstreamPolicy ?? DEFAULT_DOWNSTREAM_POLICY;
    const match = await this.findRouteById(routeId, downstreamPolicy);
    const requestedModel = match?.route.modelPattern || `route:${routeId}`;
    await this.refreshPricingReferenceCostsForMatch(match, requestedModel, {
      ...options,
      useTargetSourceModelForCost: true,
    });
  }

  private explainSelectionFromMatch(
    match: RouteMatch | null,
    requestedModel: string,
    options: ExplainSelectionOptions = {},
  ): RouteDecisionExplanation {
    const excludeTargetIds = options.excludeTargetIds ?? [];
    const downstreamPolicy = options.downstreamPolicy ?? DEFAULT_DOWNSTREAM_POLICY;

    if (!match) {
      return {
        requestedModel,
        actualModel: requestedModel,
        matched: false,
        summary: ['未匹配到启用的路由'],
        candidates: [],
      };
    }

    const graphAlias = graphMatchedAliasForMatch(match, requestedModel);
    const requestedByDisplayName = isRouteDisplayNameMatch(requestedModel, match.route.displayName) || !!graphAlias;
    const bypassSourceModelCheck = (options.bypassSourceModelCheck ?? false) || requestedByDisplayName || !!match.routeGraph;
    const useTargetSourceModelForCost = (options.useTargetSourceModelForCost ?? false) || requestedByDisplayName;
    const mappedModel = resolveRouteMatchUpstreamModel(match, requestedModel);
    const eligibilityModel = match.routeGraph?.currentModel || requestedModel;
    const routeStrategy = resolveRouteStrategy(match.route);
    const runtimeModelResolver = requestedByDisplayName
      ? ((candidate: RouteEndpointTargetCandidate) => normalizeTargetSourceModel(candidate.target.sourceModel) || mappedModel)
      : mappedModel;

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const summary: string[] = [
      `命中路由：${match.route.modelPattern}`,
      routeStrategy === 'round_robin'
        ? '路由策略：轮询'
        : (routeStrategy === 'stable_first' ? '路由策略：稳定优先' : '路由策略：按权重随机'),
    ];
    if (requestedByDisplayName) {
      summary.push(`按显示名命中：${graphAlias || normalizeRouteDisplayName(match.route.displayName)}`);
      summary.push('显示名仅用于聚合展示，实际转发模型按选中目标来源模型决定');
    }
    const available: RouteEndpointTargetCandidate[] = [];
    const candidates: RouteDecisionCandidate[] = [];
    const candidateMap = new Map<number, RouteDecisionCandidate>();

    for (const row of match.targets) {
      const reasonParts = this.getCandidateEligibilityReasons(row, {
        requestedModel: eligibilityModel,
        bypassSourceModelCheck,
        excludeTargetIds,
        nowIso,
        downstreamPolicy,
      });

      const recentlyFailed = routeStrategy !== 'round_robin'
        ? isTargetRecentlyFailed(row.target, nowMs)
        : false;
      const eligible = reasonParts.length === 0;
      const candidate: RouteDecisionCandidate = {
        targetId: row.target.id,
        accountId: row.account.id,
        username: row.account.username || `account-${row.account.id}`,
        siteName: row.site.name || 'unknown',
        tokenName: row.token?.name || 'default',
        priority: row.target.priority ?? 0,
        weight: row.target.weight ?? 10,
        eligible,
        recentlyFailed,
        avoidedByRecentFailure: false,
        probability: 0,
        reason: eligible ? '可用' : reasonParts.join('、'),
      };
      candidates.push(candidate);
      candidateMap.set(candidate.targetId, candidate);

      if (eligible) {
        available.push(row);
      }
    }

    if (available.length === 0) {
      summary.push('没有可用通道（全部被禁用、站点不可用、冷却或令牌不可用）');
      return {
        requestedModel,
        actualModel: mappedModel,
        matched: true,
        routeId: explainRouteIdForMatch(match),
        modelPattern: match.route.modelPattern,
        summary,
        candidates,
      };
    }

    if (routeStrategy === 'round_robin') {
      const rawOrdered = this.getRoundRobinCandidates(available);
      const breakerFiltered = filterSiteRuntimeBrokenCandidatesByModel(rawOrdered, runtimeModelResolver, nowMs);
      if (breakerFiltered.avoided.length > 0) {
        for (const item of breakerFiltered.avoided) {
          const target = candidateMap.get(item.candidate.target.id);
          if (!target) continue;
          target.reason = item.reason;
        }
        const breakerSummaryLabel = breakerFiltered.avoided.some((item) => item.reason.includes('模型熔断'))
          ? '运行时熔断避让'
          : '站点熔断避让';
        summary.push(`${breakerSummaryLabel} ${breakerFiltered.avoided.length}`);
      }
      const ordered = breakerFiltered.candidates;
      let selected: RouteEndpointTargetCandidate | null = null;

      for (let index = 0; index < ordered.length; index += 1) {
        const target = candidateMap.get(ordered[index].target.id);
        if (!target || !target.eligible) continue;
        target.probability = index === 0 ? 100 : 0;
        target.reason = index === 0
          ? `轮询命中（全局第 1 / ${ordered.length} 位，忽略优先级）`
          : `轮询排队中（全局第 ${index + 1} / ${ordered.length} 位，忽略优先级）`;
        if (index === 0) {
          selected = ordered[index];
        }
      }

      if (!selected) {
        summary.push('本次未选出通道');
        return {
          requestedModel,
          actualModel: mappedModel,
          matched: true,
          routeId: explainRouteIdForMatch(match),
          modelPattern: match.route.modelPattern,
          summary,
          candidates,
        };
      }

      const selectedTargetCandidate = candidateMap.get(selected.target.id);
      const selectedLabel = selectedTargetCandidate
        ? `${selectedTargetCandidate.username} @ ${selectedTargetCandidate.siteName} / ${selectedTargetCandidate.tokenName}`
        : `target-${selected.target.id}`;
      const actualModel = resolveActualModelForSelectedTarget(
        requestedModel,
        match.route,
        mappedModel,
        selected.target.sourceModel,
        match.routeGraph,
      );
      summary.push(`全局轮询：可用 ${ordered.length}，忽略优先级`);
      summary.push(`最终选择：${selectedLabel}`);
      if (actualModel !== requestedModel) {
        summary.push(`实际转发模型：${actualModel}`);
      }

      return {
        requestedModel,
        actualModel,
        matched: true,
        routeId: explainRouteIdForMatch(match),
        modelPattern: match.route.modelPattern,
        selectedTargetId: selected.target.id,
        selectedAccountId: selected.account.id,
        selectedLabel,
        summary,
        candidates,
      };
    }

    if (routeStrategy === 'stable_first') {
      const breakerFiltered = filterSiteRuntimeBrokenCandidatesByModel(available, runtimeModelResolver, nowMs);
      if (breakerFiltered.avoided.length > 0) {
        for (const item of breakerFiltered.avoided) {
          const target = candidateMap.get(item.candidate.target.id);
          if (!target) continue;
          target.reason = item.reason;
        }
      }

      const filteredCandidates = filterRecentlyFailedCandidates(breakerFiltered.candidates, nowMs);
      const avoided = breakerFiltered.candidates.filter((row) => !filteredCandidates.some((item) => item.target.id === row.target.id));
      if (avoided.length > 0) {
        for (const row of avoided) {
          const target = candidateMap.get(row.target.id);
          if (!target) continue;
          target.avoidedByRecentFailure = true;
          target.reason = `最近失败，优先避让（${resolveFailureBackoffSec(row.target.failCount)} 秒窗口）`;
        }
      }

      const rotationKey = this.buildStableFirstRotationKey(match.route.id, requestedModel);
      const poolPlan = buildStableFirstPoolPlan(
        filteredCandidates,
        useTargetSourceModelForCost ? runtimeModelResolver : mappedModel,
        nowMs,
      );
      const observationDueNow = poolPlan.observationCandidates.length > 0
        && shouldUseStableFirstObservationCandidate(rotationKey, poolPlan.observationCandidates, nowMs);
      const useObservationNow = poolPlan.observationCandidates.length > 0
        && (poolPlan.primaryCandidates.length <= 0 || observationDueNow);
      const observationProgressState = stableFirstObservationProgressByKey.get(rotationKey) ?? {
        requestCount: 0,
        lastObservationAtMs: null,
      };
      const remainingPrimaryRequestsBeforeObservation = poolPlan.primaryCandidates.length > 0
        ? Math.max(0, STABLE_FIRST_OBSERVATION_REQUEST_INTERVAL - (observationProgressState.requestCount + 1))
        : 0;
      const observationBlockedByCooldown = poolPlan.primaryCandidates.length > 0
        && poolPlan.observationCandidates.length > 0
        && remainingPrimaryRequestsBeforeObservation === 0
        && !observationDueNow;
      const primaryWeighted = this.calculateWeightedSelection(
        poolPlan.primaryCandidates,
        useTargetSourceModelForCost ? runtimeModelResolver : mappedModel,
        downstreamPolicy,
        nowMs,
        'stable_first',
        rotationKey,
      );
      const observationWeighted = poolPlan.observationCandidates.length > 0
        ? this.calculateWeightedSelection(
          poolPlan.observationCandidates,
          useTargetSourceModelForCost ? runtimeModelResolver : mappedModel,
          downstreamPolicy,
          nowMs,
          'stable_first',
          `${rotationKey}:observe`,
        )
        : {
          selected: null,
          details: [],
          stableSiteCount: 0,
        };

      for (const detail of primaryWeighted.details) {
        const target = candidateMap.get(detail.candidate.target.id);
        if (!target) continue;
        target.probability = Number((detail.probability * (useObservationNow ? 0 : 100)).toFixed(2));
        if (target.eligible && !target.avoidedByRecentFailure) {
          target.reason = useObservationNow
            ? `主池：本次让位给观察池灰度请求；${detail.reason}`
            : `主池：${detail.reason}`;
        }
      }
      for (const detail of observationWeighted.details) {
        const target = candidateMap.get(detail.candidate.target.id);
        if (!target) continue;
        target.probability = Number((detail.probability * (useObservationNow ? 100 : 0)).toFixed(2));
        if (target.eligible && !target.avoidedByRecentFailure) {
          const siteState = poolPlan.siteStateById.get(detail.candidate.site.id);
          const observationWindowPrefix = useObservationNow
            ? (poolPlan.primaryCandidates.length > 0
              ? '本次命中灰度真实请求'
              : '当前主池为空，改由观察池承接')
            : (observationBlockedByCooldown
              ? '当前已到灰度窗口，但观察站点仍在冷却'
              : `当前还需 ${remainingPrimaryRequestsBeforeObservation} 次主池请求`);
          target.reason = poolPlan.observationSiteIds.has(detail.candidate.site.id)
            ? `${siteState?.observationReason || '观察池'}；${observationWindowPrefix}；${detail.reason}`
            : `观察池：${observationWindowPrefix}；${detail.reason}`;
        }
      }

      const weighted = useObservationNow
        ? observationWeighted
        : (primaryWeighted.selected ? primaryWeighted : observationWeighted);
      if (!weighted.selected) {
        summary.push('本次未选出通道');
        return {
          requestedModel,
          actualModel: mappedModel,
          matched: true,
          routeId: explainRouteIdForMatch(match),
          modelPattern: match.route.modelPattern,
          summary,
          candidates,
        };
      }

      const summaryParts = [`稳定优先：可用 ${available.length}`];
      if (poolPlan.primarySiteIds.size > 0) {
        summaryParts.push(`主池站点 ${poolPlan.primarySiteIds.size}`);
      }
      if (poolPlan.observationSiteIds.size > 0) {
        summaryParts.push(`观察池站点 ${poolPlan.observationSiteIds.size}`);
      }
      summaryParts.push('按近期成功率分层后按配置顺序轮询站点');
      if (poolPlan.observationSiteIds.size > 0) {
        if (useObservationNow) {
          summaryParts.push('本次命中观察池灰度流量');
        } else if (observationBlockedByCooldown) {
          summaryParts.push('观察池已到灰度窗口，但候选站点仍在观察冷却');
        } else if (poolPlan.primaryCandidates.length <= 0) {
          summaryParts.push('当前主池为空，由观察池承接流量');
        } else {
          summaryParts.push(`观察池仅消耗少量真实请求灰度流量（当前还需 ${remainingPrimaryRequestsBeforeObservation} 次主池请求）`);
        }
      }
      if (breakerFiltered.avoided.length > 0) {
        const breakerSummaryLabel = breakerFiltered.avoided.some((item) => item.reason.includes('模型熔断'))
          ? '运行时熔断避让'
          : '站点熔断避让';
        summaryParts.push(`${breakerSummaryLabel} ${breakerFiltered.avoided.length}`);
      }
      if (avoided.length > 0) {
        summaryParts.push(`最近失败避让 ${avoided.length}`);
      }
      summary.push(summaryParts.join('，'));

      const selectedTargetCandidate = candidateMap.get(weighted.selected.target.id);
      const selectedLabel = selectedTargetCandidate
        ? `${selectedTargetCandidate.username} @ ${selectedTargetCandidate.siteName} / ${selectedTargetCandidate.tokenName}`
        : `target-${weighted.selected.target.id}`;
      const actualModel = resolveActualModelForSelectedTarget(
        requestedModel,
        match.route,
        mappedModel,
        weighted.selected.target.sourceModel,
        match.routeGraph,
      );
      summary.push(`最终选择：${selectedLabel}（P${weighted.selected.target.priority ?? 0}）`);
      if (actualModel !== requestedModel) {
        summary.push(`实际转发模型：${actualModel}`);
      }

      return {
        requestedModel,
        actualModel,
        matched: true,
        routeId: explainRouteIdForMatch(match),
        modelPattern: match.route.modelPattern,
        selectedTargetId: weighted.selected.target.id,
        selectedAccountId: weighted.selected.account.id,
        selectedLabel,
        summary,
        candidates,
      };
    }

    const availableByPriority = new Map<number, RouteEndpointTargetCandidate[]>();
    for (const row of available) {
      const priority = row.target.priority ?? 0;
      if (!availableByPriority.has(priority)) availableByPriority.set(priority, []);
      availableByPriority.get(priority)!.push(row);
    }

    const sortedPriorities = Array.from(availableByPriority.keys()).sort((a, b) => a - b);
    let selected: RouteEndpointTargetCandidate | null = null;
    let selectedPriority = 0;

    for (const priority of sortedPriorities) {
      const rawLayer = availableByPriority.get(priority) ?? [];
      if (rawLayer.length === 0) continue;

      const breakerFiltered = filterSiteRuntimeBrokenCandidatesByModel(rawLayer, runtimeModelResolver, nowMs);
      if (breakerFiltered.avoided.length > 0) {
        for (const item of breakerFiltered.avoided) {
          const target = candidateMap.get(item.candidate.target.id);
          if (!target) continue;
          target.reason = item.reason;
        }
      }

      const filteredLayer = filterRecentlyFailedCandidates(breakerFiltered.candidates, nowMs);
      const avoided = breakerFiltered.candidates.filter((row) => !filteredLayer.some((item) => item.target.id === row.target.id));
      if (avoided.length > 0) {
        for (const row of avoided) {
          const target = candidateMap.get(row.target.id);
          if (!target) continue;
          target.avoidedByRecentFailure = true;
          target.reason = `最近失败，优先避让（${resolveFailureBackoffSec(row.target.failCount)} 秒窗口）`;
        }
      }

      const weighted = this.calculateWeightedSelection(
        filteredLayer,
        useTargetSourceModelForCost ? runtimeModelResolver : mappedModel,
        downstreamPolicy,
        nowMs,
        'weighted',
      );
      for (const detail of weighted.details) {
        const target = candidateMap.get(detail.candidate.target.id);
        if (!target) continue;
        target.probability = Number((detail.probability * 100).toFixed(2));
        if (target.eligible && !target.avoidedByRecentFailure) {
          target.reason = detail.reason;
        }
      }

      if (!weighted.selected) continue;
      selected = weighted.selected;
      selectedPriority = priority;
      const layerSummaryParts = [`优先级 P${priority}：可用 ${rawLayer.length}`];
      if (breakerFiltered.avoided.length > 0) {
        const breakerSummaryLabel = breakerFiltered.avoided.some((item) => item.reason.includes('模型熔断'))
          ? '运行时熔断避让'
          : '站点熔断避让';
        layerSummaryParts.push(`${breakerSummaryLabel} ${breakerFiltered.avoided.length}`);
      }
      if (avoided.length > 0) {
        layerSummaryParts.push(`最近失败避让 ${avoided.length}`);
      }
      summary.push(layerSummaryParts.join('，'));
      break;
    }

    if (!selected) {
      summary.push('本次未选出通道');
      return {
        requestedModel,
        actualModel: mappedModel,
        matched: true,
        routeId: explainRouteIdForMatch(match),
        modelPattern: match.route.modelPattern,
        summary,
        candidates,
      };
    }

    const selectedTargetCandidate = candidateMap.get(selected.target.id);
    const selectedLabel = selectedTargetCandidate
      ? `${selectedTargetCandidate.username} @ ${selectedTargetCandidate.siteName} / ${selectedTargetCandidate.tokenName}`
      : `target-${selected.target.id}`;
    const actualModel = resolveActualModelForSelectedTarget(
      requestedModel,
      match.route,
      mappedModel,
      selected.target.sourceModel,
      match.routeGraph,
    );
    summary.push(`最终选择：${selectedLabel}（P${selectedPriority}）`);
    if (actualModel !== requestedModel) {
      summary.push(`实际转发模型：${actualModel}`);
    }

    return {
      requestedModel,
      actualModel,
      matched: true,
      routeId: explainRouteIdForMatch(match),
      modelPattern: match.route.modelPattern,
      selectedTargetId: selected.target.id,
      selectedAccountId: selected.account.id,
      selectedLabel,
      summary,
      candidates,
    };
  }

  private async refreshPricingReferenceCostsForMatch(
    match: RouteMatch | null,
    requestedModel: string,
    options: PricingReferenceRefreshOptions = {},
  ): Promise<void> {
    if (!match) return;

    const requestedByDisplayName = isRouteDisplayNameMatch(requestedModel, match.route.displayName);
    const useTargetSourceModelForCost = (options.useTargetSourceModelForCost ?? false) || requestedByDisplayName;
    const mappedModel = resolveRouteMatchUpstreamModel(match, requestedModel);
    const refreshedKeys = options.refreshedKeys ?? new Set<string>();

    await Promise.allSettled(match.targets.map(async (candidate) => {
      const modelName = useTargetSourceModelForCost
        ? (normalizeTargetSourceModel(candidate.target.sourceModel) || mappedModel)
        : mappedModel;
      if (!modelName) return;

      const refreshKey = [
        candidate.site.id,
        candidate.account.id,
        candidate.target.tokenId ?? candidate.token?.id ?? '-',
        resolveCandidateTokenGroup(candidate) ?? '-',
        modelName,
      ].join(':');
      if (refreshedKeys.has(refreshKey)) return;
      refreshedKeys.add(refreshKey);

      await refreshEndpointRoutingReferencePricing({
        supply: {
          siteId: candidate.site.id,
          accountId: candidate.account.id,
          tokenId: candidate.target.tokenId ?? candidate.token?.id ?? null,
          tokenGroup: resolveCandidateTokenGroup(candidate),
          provider: candidate.site.platform,
          modelName,
        },
      });
    }));
  }

  /**
   * Record success for a target.
   */
  async recordSuccess(
    targetId: number,
    latencyMs: number,
    cost: number,
    modelName?: string | null,
    actualAccountId?: number,
  ) {
    await ensureSiteRuntimeHealthStateLoaded();
    const row = await db.select()
      .from(schema.routeEndpointTargets)
      .innerJoin(schema.accounts, eq(schema.routeEndpointTargets.accountId, schema.accounts.id))
      .where(eq(schema.routeEndpointTargets.id, targetId))
      .get();
    if (!row) return;
    const ch = row.route_endpoint_targets;
    const account = row.accounts;
    const nowIso = new Date().toISOString();
    const nextSuccessCount = (ch.successCount ?? 0) + 1;
    const nextTotalLatencyMs = (ch.totalLatencyMs ?? 0) + latencyMs;
    const nextTotalCost = (ch.totalCost ?? 0) + cost;
    if (typeof ch.oauthRouteUnitId === 'number' && ch.oauthRouteUnitId > 0) {
      const targetAccountId = Number.isFinite(actualAccountId) && (actualAccountId ?? 0) > 0
        ? Math.trunc(actualAccountId!)
        : account.id;
      const memberRow = await db.select({
        member: schema.oauthRouteUnitMembers,
        account: schema.accounts,
      }).from(schema.oauthRouteUnitMembers)
        .innerJoin(schema.accounts, eq(schema.oauthRouteUnitMembers.accountId, schema.accounts.id))
        .where(and(
          eq(schema.oauthRouteUnitMembers.unitId, ch.oauthRouteUnitId),
          eq(schema.oauthRouteUnitMembers.accountId, targetAccountId),
        ))
        .get();

      if (memberRow) {
        const memberSuccessCount = (memberRow.member.successCount ?? 0) + 1;
        const memberTotalLatencyMs = (memberRow.member.totalLatencyMs ?? 0) + latencyMs;
        const memberTotalCost = (memberRow.member.totalCost ?? 0) + cost;
        await db.update(schema.oauthRouteUnitMembers).set({
          successCount: memberSuccessCount,
          totalLatencyMs: memberTotalLatencyMs,
          totalCost: memberTotalCost,
          lastUsedAt: nowIso,
          cooldownUntil: null,
          lastFailAt: null,
          consecutiveFailCount: 0,
          cooldownLevel: 0,
          updatedAt: nowIso,
        }).where(eq(schema.oauthRouteUnitMembers.id, memberRow.member.id)).run();
        recordSiteRuntimeSuccess(memberRow.account.siteId, latencyMs, modelName);
      } else {
        recordSiteRuntimeSuccess(account.siteId, latencyMs, modelName);
      }
      invalidateRouteScopedCache(ch.routeId);
    } else {
      recordSiteRuntimeSuccess(account.siteId, latencyMs, modelName);
    }

    await db.update(schema.routeEndpointTargets).set({
      successCount: nextSuccessCount,
      totalLatencyMs: nextTotalLatencyMs,
      totalCost: nextTotalCost,
      lastUsedAt: nowIso,
      cooldownUntil: null,
      lastFailAt: null,
      consecutiveFailCount: 0,
      cooldownLevel: 0,
    }).where(eq(schema.routeEndpointTargets.id, targetId)).run();

    patchCachedTarget(targetId, (target) => {
      target.successCount = nextSuccessCount;
      target.totalLatencyMs = nextTotalLatencyMs;
      target.totalCost = nextTotalCost;
      target.lastUsedAt = nowIso;
      target.cooldownUntil = null;
      target.lastFailAt = null;
      target.consecutiveFailCount = 0;
      target.cooldownLevel = 0;
    });
  }

  async recordProbeSuccess(
    targetId: number,
    latencyMs: number,
    modelName?: string | null,
    actualAccountId?: number,
  ) {
    await ensureSiteRuntimeHealthStateLoaded();
    const row = await db.select()
      .from(schema.routeEndpointTargets)
      .innerJoin(schema.accounts, eq(schema.routeEndpointTargets.accountId, schema.accounts.id))
      .where(eq(schema.routeEndpointTargets.id, targetId))
      .get();
    if (!row) return;

    const ch = row.route_endpoint_targets;
    const account = row.accounts;
    if (typeof ch.oauthRouteUnitId === 'number' && ch.oauthRouteUnitId > 0) {
      const targetAccountId = Number.isFinite(actualAccountId) && (actualAccountId ?? 0) > 0
        ? Math.trunc(actualAccountId!)
        : account.id;
      const nowIso = new Date().toISOString();
      const memberRow = await db.select({
        member: schema.oauthRouteUnitMembers,
        account: schema.accounts,
      }).from(schema.oauthRouteUnitMembers)
        .innerJoin(schema.accounts, eq(schema.oauthRouteUnitMembers.accountId, schema.accounts.id))
        .where(and(
          eq(schema.oauthRouteUnitMembers.unitId, ch.oauthRouteUnitId),
          eq(schema.oauthRouteUnitMembers.accountId, targetAccountId),
        ))
        .get();

      if (memberRow) {
        await db.update(schema.oauthRouteUnitMembers).set({
          cooldownUntil: null,
          lastFailAt: null,
          consecutiveFailCount: 0,
          cooldownLevel: 0,
          updatedAt: nowIso,
        }).where(eq(schema.oauthRouteUnitMembers.id, memberRow.member.id)).run();
        recordSiteRuntimeSuccess(memberRow.account.siteId, latencyMs, modelName);
      } else {
        recordSiteRuntimeSuccess(account.siteId, latencyMs, modelName);
      }

      await db.update(schema.routeEndpointTargets).set({
        cooldownUntil: null,
        lastFailAt: null,
        consecutiveFailCount: 0,
        cooldownLevel: 0,
      }).where(eq(schema.routeEndpointTargets.id, targetId)).run();
      patchCachedTarget(targetId, (target) => {
        target.cooldownUntil = null;
        target.lastFailAt = null;
        target.consecutiveFailCount = 0;
        target.cooldownLevel = 0;
      });
      invalidateRouteScopedCache(ch.routeId);
      return;
    }

    const affectedTargetIds = await loadCredentialScopedTargetIds(ch, account.id);
    const needsTargetReset = !!ch.cooldownUntil
      || !!ch.lastFailAt
      || (ch.consecutiveFailCount ?? 0) > 0
      || (ch.cooldownLevel ?? 0) > 0;

    if (needsTargetReset) {
      await db.update(schema.routeEndpointTargets).set({
        cooldownUntil: null,
        lastFailAt: null,
        consecutiveFailCount: 0,
        cooldownLevel: 0,
      }).where(inArray(schema.routeEndpointTargets.id, affectedTargetIds)).run();

      for (const affectedTargetId of affectedTargetIds) {
        patchCachedTarget(affectedTargetId, (target) => {
          target.cooldownUntil = null;
          target.lastFailAt = null;
          target.consecutiveFailCount = 0;
          target.cooldownLevel = 0;
        });
      }
    } else if (affectedTargetIds.length > 1) {
      const scopedRows = await db.select({
        id: schema.routeEndpointTargets.id,
        cooldownUntil: schema.routeEndpointTargets.cooldownUntil,
        lastFailAt: schema.routeEndpointTargets.lastFailAt,
        consecutiveFailCount: schema.routeEndpointTargets.consecutiveFailCount,
        cooldownLevel: schema.routeEndpointTargets.cooldownLevel,
      })
        .from(schema.routeEndpointTargets)
        .where(inArray(schema.routeEndpointTargets.id, affectedTargetIds))
        .all();
      const siblingIdsToReset = scopedRows
        .filter((candidate) => candidate.id !== targetId && (
          !!candidate.cooldownUntil
          || !!candidate.lastFailAt
          || (candidate.consecutiveFailCount ?? 0) > 0
          || (candidate.cooldownLevel ?? 0) > 0
        ))
        .map((candidate) => candidate.id);

      if (siblingIdsToReset.length > 0) {
        await db.update(schema.routeEndpointTargets).set({
          cooldownUntil: null,
          lastFailAt: null,
          consecutiveFailCount: 0,
          cooldownLevel: 0,
        }).where(inArray(schema.routeEndpointTargets.id, siblingIdsToReset)).run();

        for (const siblingId of siblingIdsToReset) {
          patchCachedTarget(siblingId, (target) => {
            target.cooldownUntil = null;
            target.lastFailAt = null;
            target.consecutiveFailCount = 0;
            target.cooldownLevel = 0;
          });
        }
      }
    }

    recordSiteRuntimeSuccess(account.siteId, latencyMs, modelName);
  }

  /**
   * Clear persisted failure and cooldown state for the given targets.
   */
  async clearTargetFailureState(targetIds: number[]): Promise<number> {
    const normalizedTargetIds = Array.from(new Set(
      targetIds
        .filter((targetId): targetId is number => Number.isFinite(targetId) && targetId > 0)
        .map((targetId) => Math.trunc(targetId)),
    ));
    if (normalizedTargetIds.length === 0) return 0;

    await ensureSiteRuntimeHealthStateLoaded();
    const runtimeHealthRows = await db.select({
      siteId: schema.accounts.siteId,
      routeId: schema.routeEndpointTargets.routeId,
      sourceModel: schema.routeEndpointTargets.sourceModel,
    }).from(schema.routeEndpointTargets)
      .innerJoin(schema.accounts, eq(schema.routeEndpointTargets.accountId, schema.accounts.id))
      .innerJoin(schema.tokenRoutes, eq(schema.routeEndpointTargets.routeId, schema.tokenRoutes.id))
      .where(inArray(schema.routeEndpointTargets.id, normalizedTargetIds))
      .all();

    const result = await db.update(schema.routeEndpointTargets).set({
      failCount: 0,
      lastFailAt: null,
      consecutiveFailCount: 0,
      cooldownLevel: 0,
      cooldownUntil: null,
    }).where(inArray(schema.routeEndpointTargets.id, normalizedTargetIds)).run();

    const bindings = await loadRouteGraphRouteTableBindings();
    if (clearRuntimeHealthStatesForTargets(runtimeHealthRows.map((row) => {
      return {
        siteId: row.siteId,
        sourceModel: row.sourceModel,
        routeModelPattern: bindings.get(row.routeId)?.modelPattern || '',
      };
    }))) {
      await persistSiteRuntimeHealthState();
    }

    invalidateTokenRouterCache();
    return Number(result?.changes || normalizedTargetIds.length);
  }

  /**
   * Record failure and set cooldown.
   */
  async recordFailure(
    targetId: number,
    context: SiteRuntimeFailureContext | string | null = {},
    actualAccountId?: number,
  ) {
    await ensureSiteRuntimeHealthStateLoaded();
    const row = await db.select()
      .from(schema.routeEndpointTargets)
      .innerJoin(schema.accounts, eq(schema.routeEndpointTargets.accountId, schema.accounts.id))
      .innerJoin(schema.tokenRoutes, eq(schema.routeEndpointTargets.routeId, schema.tokenRoutes.id))
      .where(eq(schema.routeEndpointTargets.id, targetId))
      .get();
    if (!row) return;

    const ch = row.route_endpoint_targets;
    const account = row.accounts;
    const route = row.token_routes;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const normalizedContext: SiteRuntimeFailureContext = typeof context === 'string'
      ? { modelName: context }
      : (context ?? {});
    if (typeof ch.oauthRouteUnitId === 'number' && ch.oauthRouteUnitId > 0) {
      const targetAccountId = Number.isFinite(actualAccountId) && (actualAccountId ?? 0) > 0
        ? Math.trunc(actualAccountId!)
        : account.id;
      const memberRow = await db.select({
        member: schema.oauthRouteUnitMembers,
        account: schema.accounts,
        unit: schema.oauthRouteUnits,
      }).from(schema.oauthRouteUnitMembers)
        .innerJoin(schema.accounts, eq(schema.oauthRouteUnitMembers.accountId, schema.accounts.id))
        .innerJoin(schema.oauthRouteUnits, eq(schema.oauthRouteUnitMembers.unitId, schema.oauthRouteUnits.id))
        .where(and(
          eq(schema.oauthRouteUnitMembers.unitId, ch.oauthRouteUnitId),
          eq(schema.oauthRouteUnitMembers.accountId, targetAccountId),
        ))
        .get();
      if (memberRow) {
        const shortWindowLimitCooldownUntil = resolveShortWindowLimitCooldown(memberRow.account, normalizedContext, nowMs);
        const failCount = shortWindowLimitCooldownUntil ? 0 : ((memberRow.member.failCount ?? 0) + 1);
        const routeUnitStrategy = memberRow.unit.strategy === 'stick_until_unavailable'
          ? 'stick_until_unavailable'
          : 'round_robin';
        let cooldownUntil: string | null = null;
        let consecutiveFailCount = Math.max(0, memberRow.member.consecutiveFailCount ?? 0) + 1;
        let cooldownLevel = Math.max(0, memberRow.member.cooldownLevel ?? 0);

        if (shortWindowLimitCooldownUntil) {
          cooldownUntil = shortWindowLimitCooldownUntil;
          consecutiveFailCount = 0;
          cooldownLevel = 0;
        } else if (routeUnitStrategy === 'round_robin') {
          if (consecutiveFailCount >= ROUND_ROBIN_FAILURE_THRESHOLD) {
            cooldownLevel = Math.min(cooldownLevel + 1, ROUND_ROBIN_COOLDOWN_LEVELS_SEC.length - 1);
            const cooldownSec = resolveRoundRobinCooldownSec(cooldownLevel);
            cooldownUntil = cooldownSec > 0
              ? new Date(nowMs + clampFailureCooldownMs(cooldownSec * 1000)).toISOString()
              : null;
            consecutiveFailCount = 0;
          }
        } else {
          cooldownUntil = new Date(nowMs + resolveEffectiveFailureCooldownMs(failCount)).toISOString();
          consecutiveFailCount = 0;
          cooldownLevel = 0;
        }

        await db.update(schema.oauthRouteUnitMembers).set({
          failCount,
          lastFailAt: nowIso,
          consecutiveFailCount,
          cooldownLevel,
          cooldownUntil,
          updatedAt: nowIso,
        }).where(eq(schema.oauthRouteUnitMembers.id, memberRow.member.id)).run();
        recordSiteRuntimeFailure(memberRow.account.siteId, normalizedContext, nowMs);
        invalidateRouteScopedCache(route.id);
        return;
      }
    }

    const shortWindowLimitCooldownUntil = resolveShortWindowLimitCooldown(account, normalizedContext, nowMs);
    const failCount = shortWindowLimitCooldownUntil ? 0 : ((ch.failCount ?? 0) + 1);
    const routeStrategy = resolveRouteStrategy(route);
    const affectedTargetIds = shortWindowLimitCooldownUntil
      ? await loadCredentialScopedTargetIds(ch, account.id)
      : [targetId];
    let cooldownUntil: string | null = null;
    let consecutiveFailCount = Math.max(0, ch.consecutiveFailCount ?? 0) + 1;
    let cooldownLevel = Math.max(0, ch.cooldownLevel ?? 0);

    if (shortWindowLimitCooldownUntil) {
      cooldownUntil = shortWindowLimitCooldownUntil;
      consecutiveFailCount = 0;
      cooldownLevel = 0;
    } else if (routeStrategy === 'round_robin') {
      if (consecutiveFailCount >= ROUND_ROBIN_FAILURE_THRESHOLD) {
        cooldownLevel = Math.min(cooldownLevel + 1, ROUND_ROBIN_COOLDOWN_LEVELS_SEC.length - 1);
        const cooldownSec = resolveRoundRobinCooldownSec(cooldownLevel);
        cooldownUntil = cooldownSec > 0
          ? new Date(nowMs + clampFailureCooldownMs(cooldownSec * 1000)).toISOString()
          : null;
        consecutiveFailCount = 0;
      }
    } else {
      cooldownUntil = new Date(nowMs + resolveEffectiveFailureCooldownMs(failCount)).toISOString();
      consecutiveFailCount = 0;
      cooldownLevel = 0;
    }

    await db.update(schema.routeEndpointTargets).set({
      failCount,
      lastFailAt: nowIso,
      consecutiveFailCount,
      cooldownLevel,
      cooldownUntil,
    }).where(inArray(schema.routeEndpointTargets.id, affectedTargetIds)).run();

    for (const affectedTargetId of affectedTargetIds) {
      patchCachedTarget(affectedTargetId, (target) => {
        target.failCount = failCount;
        target.lastFailAt = nowIso;
        target.cooldownUntil = cooldownUntil;
        target.consecutiveFailCount = consecutiveFailCount;
        target.cooldownLevel = cooldownLevel;
      });
    }

    recordSiteRuntimeFailure(account.siteId, normalizedContext, nowMs);
  }

  /**
   * Get all available models (aggregated from all routes).
   */
  async getAvailableModels(): Promise<string[]> {
    const routes = await loadEnabledRoutes();
    const exposed = buildVisibleEnabledRoutes(routes)
      .map((route) => getExposedModelNameForRoute(route).trim())
      .filter((name) => name.length > 0);
    return Array.from(new Set(exposed));
  }

  // --- Private methods ---

  private async selectFromMatch(
    match: RouteMatch,
    requestedModel: string,
    downstreamPolicy: DownstreamRoutingPolicy,
    excludeTargetIds: number[] = [],
    recordSelection = true,
    routeExecutionScope: RouteExecutionScope | null = null,
  ): Promise<SelectedTarget | null> {
    const mappedModel = resolveRouteMatchUpstreamModel(match, requestedModel);
    const requestedByDisplayName = isRouteDisplayNameMatch(requestedModel, match.route.displayName)
      || !!graphMatchedAliasForMatch(match, requestedModel);
    const bypassSourceModelCheck = requestedByDisplayName || !!match.routeGraph;
    const eligibilityModel = match.routeGraph?.currentModel || requestedModel;
    const routeStrategy = resolveRouteStrategy(match.route);
    const runtimeModelResolver = requestedByDisplayName
      ? ((candidate: RouteEndpointTargetCandidate) => normalizeTargetSourceModel(candidate.target.sourceModel) || mappedModel)
      : mappedModel;

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const available = match.targets.filter((candidate) => (
      this.getCandidateEligibilityReasons(candidate, {
        requestedModel: eligibilityModel,
        bypassSourceModelCheck,
        excludeTargetIds,
        nowIso,
        downstreamPolicy,
      }).length === 0
    ));

    if (available.length === 0) return null;

    if (routeStrategy === 'round_robin') {
      const breakerFiltered = filterSiteRuntimeBrokenCandidatesByModel(available, runtimeModelResolver, nowMs);
      const selected = this.selectRoundRobinCandidate(breakerFiltered.candidates);
      if (!selected) return null;
      return await this.finalizeSelectedCandidateForDispatch(
        selected,
        match,
        requestedModel,
        mappedModel,
        downstreamPolicy,
        recordSelection,
        nowIso,
        nowMs,
        undefined,
        undefined,
        false,
        excludeTargetIds,
        routeExecutionScope,
      );
    }

    if (routeStrategy === 'stable_first') {
      const breakerFiltered = filterSiteRuntimeBrokenCandidatesByModel(available, runtimeModelResolver, nowMs);
      const candidates = filterRecentlyFailedCandidates(breakerFiltered.candidates, nowMs);
      const rotationKey = this.buildStableFirstRotationKey(match.route.id, requestedModel);
      const poolPlan = buildStableFirstPoolPlan(
        candidates,
        requestedByDisplayName ? runtimeModelResolver : mappedModel,
        nowMs,
      );
      const shouldUseObservation = (
        poolPlan.observationCandidates.length > 0
        && (
          poolPlan.primaryCandidates.length <= 0
          || (
            recordSelection
            && shouldUseStableFirstObservationCandidate(rotationKey, poolPlan.observationCandidates, nowMs)
          )
        )
      );
      const selectionPool = shouldUseObservation
        ? poolPlan.observationCandidates
        : (poolPlan.primaryCandidates.length > 0 ? poolPlan.primaryCandidates : poolPlan.observationCandidates);
      const selected = this.stableFirstSelect(
        selectionPool,
        requestedByDisplayName ? runtimeModelResolver : mappedModel,
        downstreamPolicy,
        nowMs,
        shouldUseObservation ? `${rotationKey}:observe` : rotationKey,
      );
      if (!selected) return null;
      return await this.finalizeSelectedCandidateForDispatch(
        selected,
        match,
        requestedModel,
        mappedModel,
        downstreamPolicy,
        recordSelection,
        nowIso,
        nowMs,
        rotationKey,
        `${rotationKey}:observe`,
        shouldUseObservation,
        excludeTargetIds,
        routeExecutionScope,
      );
    }

    const layers = new Map<number, typeof available>();
    for (const candidate of available) {
      const priority = candidate.target.priority ?? 0;
      if (!layers.has(priority)) layers.set(priority, []);
      layers.get(priority)!.push(candidate);
    }

    const sortedPriorities = Array.from(layers.keys()).sort((a, b) => a - b);
    for (const priority of sortedPriorities) {
      const rawLayer = layers.get(priority) ?? [];
      const breakerFiltered = filterSiteRuntimeBrokenCandidatesByModel(rawLayer, runtimeModelResolver, nowMs);
      const candidates = filterRecentlyFailedCandidates(breakerFiltered.candidates, nowMs);
      const selected = this.weightedRandomSelect(
        candidates,
        requestedByDisplayName ? runtimeModelResolver : mappedModel,
        downstreamPolicy,
        nowMs,
      );
      if (!selected) continue;
      const resolved = await this.finalizeSelectedCandidateForDispatch(
        selected,
        match,
        requestedModel,
        mappedModel,
        downstreamPolicy,
        recordSelection,
        nowIso,
        nowMs,
        undefined,
        undefined,
        false,
        excludeTargetIds,
        routeExecutionScope,
      );
      if (resolved) return resolved;
    }

    return null;
  }

  private async selectPreferredFromMatch(
    match: RouteMatch,
    requestedModel: string,
    preferredTargetId: number,
    downstreamPolicy: DownstreamRoutingPolicy,
    excludeTargetIds: number[] = [],
    recordSelection = true,
    routeExecutionScope: RouteExecutionScope | null = null,
  ): Promise<SelectedTarget | null> {
    const mappedModel = resolveRouteMatchUpstreamModel(match, requestedModel);
    const requestedByDisplayName = isRouteDisplayNameMatch(requestedModel, match.route.displayName)
      || !!graphMatchedAliasForMatch(match, requestedModel);
    const bypassSourceModelCheck = requestedByDisplayName || !!match.routeGraph;
    const eligibilityModel = match.routeGraph?.currentModel || requestedModel;
    const routeStrategy = resolveRouteStrategy(match.route);
    const runtimeModelResolver = requestedByDisplayName
      ? ((candidate: RouteEndpointTargetCandidate) => normalizeTargetSourceModel(candidate.target.sourceModel) || mappedModel)
      : mappedModel;

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const available = match.targets.filter((candidate) => (
      this.getCandidateEligibilityReasons(candidate, {
        requestedModel: eligibilityModel,
        bypassSourceModelCheck,
        excludeTargetIds,
        nowIso,
        downstreamPolicy,
      }).length === 0
    ));

    const preferred = available.find((candidate) => candidate.target.id === preferredTargetId);
    if (!preferred) return null;

    const breakerFiltered = filterSiteRuntimeBrokenCandidatesByModel([preferred], runtimeModelResolver, nowMs);
    if (breakerFiltered.candidates.length <= 0) return null;

    const selected = breakerFiltered.candidates.find((candidate) => candidate.target.id === preferredTargetId);
    if (!selected) return null;
    if (!isOauthRouteUnitCandidate(selected) && routeStrategy !== 'round_robin' && isTargetRecentlyFailed(selected.target, nowMs)) {
      return null;
    }
    return await this.finalizeSelectedCandidateForDispatch(
      selected,
      match,
      requestedModel,
      mappedModel,
      downstreamPolicy,
      recordSelection && (routeStrategy === 'round_robin' || routeStrategy === 'stable_first'),
      nowIso,
      nowMs,
      routeStrategy === 'stable_first' ? this.buildStableFirstRotationKey(match.route.id, requestedModel) : undefined,
      routeStrategy === 'stable_first' ? `${this.buildStableFirstRotationKey(match.route.id, requestedModel)}:observe` : undefined,
      false,
      excludeTargetIds,
      routeExecutionScope,
    );
  }

  private async findRoute(model: string, downstreamPolicy: DownstreamRoutingPolicy): Promise<RouteMatch | null> {
    let routes = await loadEnabledRoutes();

    const supportedPatterns = Array.isArray(downstreamPolicy.supportedModels)
      ? downstreamPolicy.supportedModels
      : [];
    const matchedSupportedPattern = supportedPatterns.some((pattern) => matchesModelPattern(model, pattern));

    if (downstreamPolicy.allowedRouteIds.length > 0 && !matchedSupportedPattern) {
      const allowSet = new Set(downstreamPolicy.allowedRouteIds);
      routes = routes.filter((route) => allowSet.has(route.id));
    }

    const graphSelection = await evaluateActiveRouteGraphForModel(model);
    const selectedGraphRouteId = graphSelection?.matchedRouteId ?? graphSelection?.selectedRouteId ?? null;
    if (graphSelection?.terminalKind === 'route_endpoint' && selectedGraphRouteId) {
      const graphRoute = routes.find((route) => route.id === selectedGraphRouteId);
      if (graphRoute) {
        return await loadRouteMatch(graphRoute, Date.now(), graphSelection);
      }
    }

    const matchedRoute = routes.find((route) => isExplicitGroupRoute(route) && isRouteExposedNameMatch(model, route))
      || routes.find((route) => (
        !isExplicitGroupRoute(route)
        && isRouteGraphExactModelMatch(route.match, route.backend)
        && (route.modelPattern || '').trim() === model
      ))
      || routes.find((route) => !isExplicitGroupRoute(route) && isRouteExposedNameMatch(model, route))
      || routes.find((route) => !isExplicitGroupRoute(route) && routeGraphMatchesRequestedModel(model, route.match, route.backend));

    if (!matchedRoute) return null;

    return await this.loadRouteMatch(matchedRoute);
  }

  private async findRouteById(routeId: number, downstreamPolicy: DownstreamRoutingPolicy): Promise<RouteMatch | null> {
    if (downstreamPolicy.allowedRouteIds.length > 0 && !downstreamPolicy.allowedRouteIds.includes(routeId)) {
      return null;
    }

    const route = (await loadEnabledRoutes()).find((item) => item.id === routeId);
    if (!route) return null;

    return await this.loadRouteMatch(route);
  }

  private async loadRouteMatch(route: RouteRow): Promise<RouteMatch> {
    return await loadRouteMatch(route);
  }

  private resolveRouteUnitMemberTokenValue(candidate: {
    account: typeof schema.accounts.$inferSelect;
  }): string | null {
    const oauthAccessToken = candidate.account.accessToken?.trim();
    if (oauthAccessToken) return oauthAccessToken;
    const apiToken = candidate.account.apiToken?.trim();
    return apiToken || null;
  }

  private buildRouteUnitMemberDispatchCandidate(
    outerCandidate: RouteEndpointTargetCandidate,
    memberCandidate: RouteEndpointTargetCandidate['routeUnitMembers'][number],
  ): RouteEndpointTargetCandidate {
    return {
      ...outerCandidate,
      account: memberCandidate.account,
      site: memberCandidate.site,
      token: null,
    };
  }

  private getRouteUnitMemberEligibilityReasons(
    outerCandidate: RouteEndpointTargetCandidate,
    memberCandidate: RouteEndpointTargetCandidate['routeUnitMembers'][number],
    options: CandidateEligibilityOptions,
  ): string[] {
    const reasonParts: string[] = [];
    const bypassSourceModelCheck = options.bypassSourceModelCheck ?? false;
    const nowIso = options.nowIso ?? new Date().toISOString();

    if (!bypassSourceModelCheck && !targetSupportsRequestedModel(outerCandidate.target.sourceModel, options.requestedModel)) {
      reasonParts.push(`来源模型不匹配=${outerCandidate.target.sourceModel || ''}`);
    }

    if (!outerCandidate.target.enabled) reasonParts.push('通道禁用');

    if (memberCandidate.account.status !== 'active') {
      reasonParts.push(`账号状态=${memberCandidate.account.status}`);
    }

    if (isSiteDisabled(memberCandidate.site.status)) {
      reasonParts.push(`站点状态=${memberCandidate.site.status || 'disabled'}`);
    }

    const downstreamExclusionReason = this.resolveDownstreamExclusionReason(
      this.buildRouteUnitMemberDispatchCandidate(outerCandidate, memberCandidate),
      options.downstreamPolicy,
    );
    if (downstreamExclusionReason) {
      reasonParts.push(downstreamExclusionReason);
    }

    const tokenValue = this.resolveRouteUnitMemberTokenValue(memberCandidate);
    if (!tokenValue) reasonParts.push('令牌不可用');

    if (isOauthRouteUnitMemberCoolingDown(memberCandidate.member, nowIso)) {
      reasonParts.push('冷却中');
    }

    return reasonParts;
  }

  private getEligibleRouteUnitMembers(
    candidate: RouteEndpointTargetCandidate,
    options: CandidateEligibilityOptions,
  ): RouteEndpointTargetCandidate['routeUnitMembers'] {
    if (!isOauthRouteUnitCandidate(candidate)) return [];
    return candidate.routeUnitMembers.filter((memberCandidate) => (
      this.getRouteUnitMemberEligibilityReasons(candidate, memberCandidate, options).length === 0
    ));
  }

  private getRoundRobinRouteUnitMembers(
    members: RouteEndpointTargetCandidate['routeUnitMembers'],
  ): RouteEndpointTargetCandidate['routeUnitMembers'] {
    return [...members].sort((left, right) => {
      const selectionOrder = compareNullableTimeAsc(
        left.member.lastSelectedAt || left.member.lastUsedAt,
        right.member.lastSelectedAt || right.member.lastUsedAt,
      );
      if (selectionOrder !== 0) return selectionOrder;

      const usedOrder = compareNullableTimeAsc(left.member.lastUsedAt, right.member.lastUsedAt);
      if (usedOrder !== 0) return usedOrder;

      const sortOrder = (left.member.sortOrder ?? 0) - (right.member.sortOrder ?? 0);
      if (sortOrder !== 0) return sortOrder;

      return left.account.id - right.account.id;
    });
  }

  private getStickyPreferredRouteUnitMember(
    members: RouteEndpointTargetCandidate['routeUnitMembers'],
  ): RouteEndpointTargetCandidate['routeUnitMembers'][number] | null {
    return [...members].sort((left, right) => {
      const selectionOrder = compareNullableTimeDesc(
        left.member.lastSelectedAt || left.member.lastUsedAt,
        right.member.lastSelectedAt || right.member.lastUsedAt,
      );
      if (selectionOrder !== 0) return selectionOrder;

      const sortOrder = (left.member.sortOrder ?? 0) - (right.member.sortOrder ?? 0);
      if (sortOrder !== 0) return sortOrder;

      return left.account.id - right.account.id;
    })[0] ?? null;
  }

  private selectRouteUnitMember(
    candidate: RouteEndpointTargetCandidate,
    requestedModel: string,
    downstreamPolicy: DownstreamRoutingPolicy,
    nowIso: string,
    nowMs: number,
    excludeTargetIds: number[] = [],
  ): RouteEndpointTargetCandidate['routeUnitMembers'][number] | null {
    if (!isOauthRouteUnitCandidate(candidate)) return null;
    const eligibleMembers = this.getEligibleRouteUnitMembers(candidate, {
      requestedModel,
      bypassSourceModelCheck: true,
      excludeTargetIds: [],
      nowIso,
      downstreamPolicy,
    });
    if (eligibleMembers.length === 0) return null;

    const isRouteUnitFailover = excludeTargetIds.includes(candidate.target.id);
    const healthyMembers = isRouteUnitFailover
      ? eligibleMembers.filter((memberCandidate) => !isTargetRecentlyFailed(memberCandidate.member, nowMs))
      : filterRecentlyFailedCandidates(
        eligibleMembers.map((memberCandidate) => ({
          memberCandidate,
          target: memberCandidate.member,
        })),
        nowMs,
      ).map((item) => item.memberCandidate);
    const candidateMembers = healthyMembers.length > 0
      ? healthyMembers
      : (isRouteUnitFailover ? [] : eligibleMembers);
    if (candidate.routeUnit?.strategy === 'stick_until_unavailable') {
      const sticky = this.getStickyPreferredRouteUnitMember(candidateMembers);
      if (sticky) return sticky;
      return this.getRoundRobinRouteUnitMembers(candidateMembers)[0] ?? null;
    }

    return this.getRoundRobinRouteUnitMembers(candidateMembers)[0] ?? null;
  }

  private async recordRouteUnitMemberSelection(
    routeUnitId: number,
    accountId: number,
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    await db.update(schema.oauthRouteUnitMembers).set({
      lastSelectedAt: nowIso,
      updatedAt: nowIso,
    }).where(and(
      eq(schema.oauthRouteUnitMembers.unitId, routeUnitId),
      eq(schema.oauthRouteUnitMembers.accountId, accountId),
    )).run();
    const routeRows = await db.select({
      routeId: schema.routeEndpointTargets.routeId,
    }).from(schema.routeEndpointTargets)
      .where(eq(schema.routeEndpointTargets.oauthRouteUnitId, routeUnitId))
      .all();
    const routeIds: number[] = Array.from(new Set<number>(
      routeRows
        .map((row) => Number(row.routeId))
        .filter((routeId): routeId is number => Number.isFinite(routeId) && routeId > 0),
    ));
    for (const routeId of routeIds) {
      invalidateRouteScopedCache(routeId);
    }
  }

  private resolveTargetTokenValue(candidate: {
    target: typeof schema.routeEndpointTargets.$inferSelect;
    account: typeof schema.accounts.$inferSelect;
    site?: typeof schema.sites.$inferSelect | null;
    token: typeof schema.accountTokens.$inferSelect | null;
  }): string | null {
    if (candidate.target.tokenId) {
      if (!candidate.token) return null;
      if (!isUsableAccountToken(candidate.token)) return null;
      const token = candidate.token.token?.trim();
      return token ? token : null;
    }

    if (getOauthInfoFromAccount(candidate.account)) {
      const accessToken = candidate.account.accessToken?.trim();
      if (accessToken) return accessToken;
      return null;
    }

    const fallback = candidate.account.apiToken?.trim();
    if (fallback) return fallback;

    return null;
  }

  private resolveDownstreamExclusionReason(
    candidate: RouteEndpointTargetCandidate,
    downstreamPolicy?: DownstreamRoutingPolicy,
  ): string | null {
    if (!downstreamPolicy) return null;

    const excludedSiteIds = Array.isArray(downstreamPolicy.excludedSiteIds)
      ? downstreamPolicy.excludedSiteIds
      : [];
    if (excludedSiteIds.includes(candidate.site.id)) {
      return '站点已被下游密钥排除';
    }

    const excludedCredentialRefs = Array.isArray(downstreamPolicy.excludedCredentialRefs)
      ? downstreamPolicy.excludedCredentialRefs
      : [];
    if (excludedCredentialRefs.length <= 0) {
      return null;
    }

    for (const ref of excludedCredentialRefs) {
      if (ref.kind === 'account_token') {
        if (
          candidate.target.tokenId === ref.tokenId
          && candidate.token?.id === ref.tokenId
          && candidate.account.id === ref.accountId
          && candidate.site.id === ref.siteId
        ) {
          return 'API Key/令牌已被下游密钥排除';
        }
        continue;
      }

      if (
        candidate.target.tokenId == null
        && candidate.account.id === ref.accountId
        && candidate.site.id === ref.siteId
      ) {
        const resolvedTokenValue = this.resolveTargetTokenValue(candidate);
        const accountApiToken = candidate.account.apiToken?.trim() || '';
        if (resolvedTokenValue && accountApiToken && resolvedTokenValue === accountApiToken) {
          return 'API Key/令牌已被下游密钥排除';
        }
      }
    }

    return null;
  }

  private getCandidateEligibilityReasons(
    candidate: RouteEndpointTargetCandidate,
    options: CandidateEligibilityOptions,
  ): string[] {
    const reasonParts: string[] = [];
    const bypassSourceModelCheck = options.bypassSourceModelCheck ?? false;
    const excludeTargetIds = options.excludeTargetIds ?? [];
    const nowIso = options.nowIso ?? new Date().toISOString();

    if (!bypassSourceModelCheck && !targetSupportsRequestedModel(candidate.target.sourceModel, options.requestedModel)) {
      reasonParts.push(`来源模型不匹配=${candidate.target.sourceModel || ''}`);
    }

    if (!candidate.target.enabled) reasonParts.push('通道禁用');

    if (isOauthRouteUnitCandidate(candidate)) {
      if (excludeTargetIds.includes(candidate.target.id)) {
        // Route-unit failover should stay inside the same outer target and switch members instead of
        // excluding the entire pool after one member fails.
      }

      if (this.getEligibleRouteUnitMembers(candidate, options).length === 0) {
        reasonParts.push(`路由池成员不可用（${candidate.routeUnit?.name || getOauthRouteUnitStrategyLabel(candidate.routeUnit?.strategy || 'round_robin')}）`);
      }
      return reasonParts;
    }

    if (isExplicitTokenTarget(candidate)) {
      if (candidate.account.status === 'disabled') {
        reasonParts.push(`账号状态=${candidate.account.status}`);
      }
    } else if (candidate.account.status !== 'active') {
      reasonParts.push(`账号状态=${candidate.account.status}`);
    }

    if (isSiteDisabled(candidate.site.status)) {
      reasonParts.push(`站点状态=${candidate.site.status || 'disabled'}`);
    }

    const downstreamExclusionReason = this.resolveDownstreamExclusionReason(candidate, options.downstreamPolicy);
    if (downstreamExclusionReason) {
      reasonParts.push(downstreamExclusionReason);
    }

    if (excludeTargetIds.includes(candidate.target.id)) {
      reasonParts.push('当前请求已尝试');
    }

    const tokenValue = this.resolveTargetTokenValue(candidate);
    if (!tokenValue) reasonParts.push('令牌不可用');

    if (candidate.target.cooldownUntil && candidate.target.cooldownUntil > nowIso) {
      reasonParts.push('冷却中');
    }

    return reasonParts;
  }

  private getRoundRobinCandidates(candidates: RouteEndpointTargetCandidate[]): RouteEndpointTargetCandidate[] {
    return [...candidates].sort((left, right) => {
      const selectionOrder = compareNullableTimeAsc(
        left.target.lastSelectedAt || left.target.lastUsedAt,
        right.target.lastSelectedAt || right.target.lastUsedAt,
      );
      if (selectionOrder !== 0) return selectionOrder;

      const usedOrder = compareNullableTimeAsc(left.target.lastUsedAt, right.target.lastUsedAt);
      if (usedOrder !== 0) return usedOrder;

      return (left.target.id ?? 0) - (right.target.id ?? 0);
    });
  }

  private selectRoundRobinCandidate(candidates: RouteEndpointTargetCandidate[]): RouteEndpointTargetCandidate | null {
    return this.getRoundRobinCandidates(candidates)[0] ?? null;
  }

  private compareStableFirstCandidates(left: RouteEndpointTargetCandidate, right: RouteEndpointTargetCandidate): number {
    return compareStableFirstCandidateOrder(left, right);
  }

  private buildStableFirstRotationKey(routeId: number, requestedModel: string): string {
    const normalizedModel = normalizeModelAlias(requestedModel)
      || normalizeRouteDisplayName(requestedModel).toLowerCase()
      || String(routeId);
    return `${routeId}:${normalizedModel}`;
  }

  private getStableFirstSiteOrder(candidates: RouteEndpointTargetCandidate[], siteId: number): number {
    let order = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      if (candidate.site.id !== siteId) continue;
      order = Math.min(order, candidate.target.priority ?? 0);
    }
    return Number.isFinite(order) ? order : 0;
  }

  private getStableFirstOrderedSiteLeaderIndices(
    candidates: RouteEndpointTargetCandidate[],
    stableSiteLeaderIndices: number[],
  ): number[] {
    return [...stableSiteLeaderIndices].sort((leftIndex, rightIndex) => {
      const leftSiteId = candidates[leftIndex]?.site.id ?? 0;
      const rightSiteId = candidates[rightIndex]?.site.id ?? 0;
      const orderDiff = this.getStableFirstSiteOrder(candidates, leftSiteId)
        - this.getStableFirstSiteOrder(candidates, rightSiteId);
      if (orderDiff !== 0) return orderDiff;
      return (candidates[leftIndex]?.target.id ?? 0) - (candidates[rightIndex]?.target.id ?? 0);
    });
  }

  private async recordTargetSelection(targetId: number): Promise<void> {
    const nowIso = new Date().toISOString();
    await db.update(schema.routeEndpointTargets).set({
      lastSelectedAt: nowIso,
    }).where(eq(schema.routeEndpointTargets.id, targetId)).run();

    patchCachedTarget(targetId, (target) => {
      target.lastSelectedAt = nowIso;
    });
  }

  private async finalizeSelectedCandidateForDispatch(
    selected: RouteEndpointTargetCandidate,
    match: RouteMatch,
    requestedModel: string,
    mappedModel: string,
    downstreamPolicy: DownstreamRoutingPolicy,
    recordSelection: boolean,
    nowIso: string,
    nowMs: number,
    stableFirstRotationKey?: string,
    stableFirstObservationKey?: string,
    usedObservation = false,
    excludeTargetIds: number[] = [],
    routeExecutionScope: RouteExecutionScope | null = null,
  ): Promise<SelectedTarget | null> {
    let dispatchCandidate = selected;
    let resolvedRouteUnitMemberTokenValue: string | null = null;
    if (isOauthRouteUnitCandidate(selected)) {
      const member = this.selectRouteUnitMember(
        selected,
        requestedModel,
        downstreamPolicy,
        nowIso,
        nowMs,
        excludeTargetIds,
      );
      if (!member || !selected.routeUnit) return null;
      resolvedRouteUnitMemberTokenValue = this.resolveRouteUnitMemberTokenValue(member);
      dispatchCandidate = this.buildRouteUnitMemberDispatchCandidate(selected, member);
      if (recordSelection) {
        await this.recordRouteUnitMemberSelection(selected.routeUnit.id, member.account.id);
      }
    }

    const tokenValue = resolvedRouteUnitMemberTokenValue ?? this.resolveTargetTokenValue(dispatchCandidate);
    if (!tokenValue) return null;

    if (recordSelection) {
      if (stableFirstRotationKey && stableFirstObservationKey) {
        rememberStableFirstSiteSelectionForKey(
          usedObservation ? stableFirstObservationKey : stableFirstRotationKey,
          dispatchCandidate.site.id,
        );
        updateStableFirstObservationProgress(stableFirstRotationKey, {
          usedObservation,
          selectedSiteId: dispatchCandidate.site.id,
          nowMs,
        });
      }
      await this.recordTargetSelection(selected.target.id);
    }

    const selectedRouteGraph = routeGraphSelectionForSelectedCandidate(match.routeGraph, selected);
    const actualModel = resolveActualModelForSelectedTarget(
      requestedModel,
      match.route,
      mappedModel,
      selected.target.sourceModel,
      selectedRouteGraph,
    );

    return {
      ...dispatchCandidate,
      target: selected.target,
      tokenValue,
      tokenName: dispatchCandidate.token?.name || 'default',
      routeGraph: selectedRouteGraph,
      routeExecutionScope,
      actualModel,
    };
  }

  private weightedRandomSelect(
    candidates: RouteEndpointTargetCandidate[],
    modelName: string | ((candidate: RouteEndpointTargetCandidate) => string),
    downstreamPolicy: DownstreamRoutingPolicy,
    nowMs = Date.now(),
  ) {
    return this.calculateWeightedSelection(candidates, modelName, downstreamPolicy, nowMs, 'weighted').selected;
  }

  private stableFirstSelect(
    candidates: RouteEndpointTargetCandidate[],
    modelName: string | ((candidate: RouteEndpointTargetCandidate) => string),
    downstreamPolicy: DownstreamRoutingPolicy,
    nowMs = Date.now(),
    stableFirstRotationKey?: string,
  ) {
    return this.calculateWeightedSelection(
      candidates,
      modelName,
      downstreamPolicy,
      nowMs,
      'stable_first',
      stableFirstRotationKey,
    ).selected;
  }

  private calculateWeightedSelection(
    candidates: RouteEndpointTargetCandidate[],
    modelName: string | ((candidate: RouteEndpointTargetCandidate) => string),
    downstreamPolicy: DownstreamRoutingPolicy,
    nowMs = Date.now(),
    selectionMode: WeightedSelectionMode = 'weighted',
    stableFirstRotationKey?: string,
  ): WeightedSelectionResult {
    if (candidates.length === 0) {
      return {
        selected: null as RouteEndpointTargetCandidate | null,
        details: [] as Array<{ candidate: RouteEndpointTargetCandidate; probability: number; reason: string }>,
        stableSiteCount: 0,
      };
    }

    const { baseWeightFactor, valueScoreFactor, costWeight, balanceWeight, usageWeight } = config.routingWeights;
    const resolveModelName = typeof modelName === 'function'
      ? modelName
      : (() => modelName);
    const effectiveCosts = candidates.map((candidate) => resolveEffectiveUnitCost(candidate, resolveModelName(candidate)));
    const runtimeHealthDetails = candidates.map((candidate) => (
      getSiteRuntimeHealthDetails(candidate.site.id, resolveModelName(candidate), nowMs)
    ));
    const targetLoadSnapshots = candidates.map((candidate) => (
      proxyTargetCoordinator.getTargetLoadSnapshot({
        targetId: candidate.target.id,
        accountExtraConfig: candidate.account.extraConfig,
        accountOauthProvider: candidate.account.oauthProvider,
      })
    ));

    const valueScores = candidates.map((c, i) => {
      const unitCost = effectiveCosts[i]?.unitCost || 1;
      const balance = c.account.balance || 0;
      const totalUsed = (c.target.successCount ?? 0) + (c.target.failCount ?? 0);
      const recentUsage = Math.max(totalUsed, 1);
      return costWeight * (1 / unitCost) + balanceWeight * balance + usageWeight * (1 / recentUsage);
    });

    const maxVS = Math.max(...valueScores, 0.001);
    const minVS = Math.min(...valueScores, 0);
    const range = maxVS - minVS || 1;
    const normalizedVS = valueScores.map((v) => (v - minVS) / range);

    const baseContributions = candidates.map((c, i) => {
      const weight = c.target.weight ?? 10;
      return (weight + 10) * (baseWeightFactor + normalizedVS[i] * valueScoreFactor);
    });

    // Avoid over-favoring a site that has many tokens/targets for the same route.
    // Site-level total contribution remains comparable, then split across its targets.
    const siteTargetCounts = new Map<number, number>();
    for (const candidate of candidates) {
      siteTargetCounts.set(candidate.site.id, (siteTargetCounts.get(candidate.site.id) || 0) + 1);
    }
    const siteHistoricalHealthMetrics = buildSiteHistoricalHealthMetrics(candidates);

    const contributions = candidates.map((candidate, i) => {
      const siteTargets = Math.max(1, siteTargetCounts.get(candidate.site.id) || 1);
      const runtimeMultiplier = runtimeHealthDetails[i]?.combinedMultiplier ?? 1;
      const runtimeLoadMultiplier = resolveTargetRuntimeLoadMultiplier(targetLoadSnapshots[i]);
      if (selectionMode === 'stable_first') {
        const recentSuccessRate = resolveStableFirstSuccessRate(
          runtimeHealthDetails[i],
          siteHistoricalHealthMetrics.get(candidate.site.id)?.successRate,
        );
        let contribution = Math.max(1e-4, recentSuccessRate ** 2);
        contribution *= runtimeMultiplier;
        contribution *= runtimeLoadMultiplier;
        return contribution / siteTargets;
      }

      let contribution = baseContributions[i] / siteTargets;
      const downstreamSiteMultiplier = downstreamPolicy.siteWeightMultipliers[candidate.site.id] ?? 1;
      const normalizedDownstreamSiteMultiplier =
        (Number.isFinite(downstreamSiteMultiplier) && downstreamSiteMultiplier > 0)
          ? downstreamSiteMultiplier
          : 1;
      const siteGlobalWeight =
        (Number.isFinite(candidate.site.globalWeight) && (candidate.site.globalWeight || 0) > 0)
          ? (candidate.site.globalWeight as number)
          : 1;
      const combinedSiteWeight = siteGlobalWeight * normalizedDownstreamSiteMultiplier;
      if (combinedSiteWeight > 0 && Number.isFinite(combinedSiteWeight)) {
        contribution *= combinedSiteWeight;
      }

      contribution *= runtimeMultiplier;
      contribution *= siteHistoricalHealthMetrics.get(candidate.site.id)?.multiplier ?? 1;
      contribution *= runtimeLoadMultiplier;

      // If upstream price is unknown and we are using fallback unit cost,
      // apply an explicit penalty so raising fallback cost meaningfully lowers probability.
      if (effectiveCosts[i]?.source === 'fallback') {
        contribution *= 1 / Math.max(1, effectiveCosts[i]?.unitCost || 1);
      }

      return contribution;
    });

    const rankingSnapshot = selectContributionSnapshot({
      contributions,
      random: () => 0,
      compareTieBreaker: (leftIndex, rightIndex) => this.compareStableFirstCandidates(candidates[leftIndex], candidates[rightIndex]),
    });
    const rankedIndices = rankingSnapshot.rankedIndices;
    const stableSiteLeaderIndices = selectionMode === 'stable_first'
      ? this.getStableFirstSiteLeaderIndices(candidates, contributions, rankedIndices)
      : [];
    const stableSiteIds = new Set(stableSiteLeaderIndices.map((index) => candidates[index]?.site.id).filter((siteId) => typeof siteId === 'number'));
    const lastSelectedSiteId = stableFirstRotationKey
      ? stableFirstLastSelectedSiteByKey.get(stableFirstRotationKey)
      : undefined;
    const selectorSnapshot = selectContributionSnapshot({
      contributions,
      mode: selectionMode,
      rankedIndices,
      stableLeaderIndices: selectionMode === 'stable_first'
        ? this.getStableFirstOrderedSiteLeaderIndices(candidates, stableSiteLeaderIndices)
        : [],
      lastSelectedGroupId: lastSelectedSiteId,
      groupIdForIndex: (index) => candidates[index]?.site.id,
      compareTieBreaker: (leftIndex, rightIndex) => this.compareStableFirstCandidates(candidates[leftIndex], candidates[rightIndex]),
    });
    const details = candidates.map((candidate, i) => {
      const probability = selectorSnapshot.probabilities[i] ?? 0;
      const weight = candidate.target.weight ?? 10;
      const cost = effectiveCosts[i];
      const costSourceText = cost?.source === 'observed'
        ? '实测'
        : (cost?.source === 'configured' ? '配置' : (cost?.source === 'endpoint' ? '端点价' : '默认'));
      const siteTargets = Math.max(1, siteTargetCounts.get(candidate.site.id) || 1);
      const downstreamSiteMultiplier = downstreamPolicy.siteWeightMultipliers[candidate.site.id] ?? 1;
      const normalizedDownstreamSiteMultiplier =
        (Number.isFinite(downstreamSiteMultiplier) && downstreamSiteMultiplier > 0)
          ? downstreamSiteMultiplier
          : 1;
      const siteGlobalWeight =
        (Number.isFinite(candidate.site.globalWeight) && (candidate.site.globalWeight || 0) > 0)
          ? (candidate.site.globalWeight as number)
          : 1;
      const combinedSiteWeight = siteGlobalWeight * normalizedDownstreamSiteMultiplier;
      const siteRuntimeDetail = runtimeHealthDetails[i];
      const siteHistoricalHealth = siteHistoricalHealthMetrics.get(candidate.site.id);
      const siteHistoricalMultiplier = siteHistoricalHealth?.multiplier ?? 1;
      const historicalSuccessRateText = siteHistoricalHealth?.successRate == null
        ? '—'
        : `${(siteHistoricalHealth.successRate * 100).toFixed(1)}%`;
      const historicalLatencyText = siteHistoricalHealth?.avgLatencyMs == null
        ? '—'
        : `${siteHistoricalHealth.avgLatencyMs}ms`;
      const targetRuntimeLoad = targetLoadSnapshots[i];
      const runtimeHealthText = siteRuntimeDetail.modelKey
        ? `${siteRuntimeDetail.combinedMultiplier.toFixed(2)}（站点=${siteRuntimeDetail.globalMultiplier.toFixed(2)}，模型=${siteRuntimeDetail.modelMultiplier.toFixed(2)}）`
        : `${siteRuntimeDetail.globalMultiplier.toFixed(2)}`;
      const runtimeLoadText = formatTargetRuntimeLoad(targetRuntimeLoad);
      const recentSuccessRateText = `${(siteRuntimeDetail.recentSuccessRate * 100).toFixed(1)}%`;
      const stableFirstSuccessRate = resolveStableFirstSuccessRate(siteRuntimeDetail, siteHistoricalHealth?.successRate);
      const stableFirstSuccessRateText = `${(stableFirstSuccessRate * 100).toFixed(1)}%`;
      const stableSiteOrder = this.getStableFirstSiteOrder(candidates, candidate.site.id);
      const reasonPrefix = selectionMode === 'stable_first'
        ? (
          candidates.length === 1
            ? '稳定优先（唯一可用候选'
            : `稳定优先（综合评分第 ${selectorSnapshot.rankByIndex.get(i) ?? 1} / ${candidates.length}`
        )
        : (
          candidates.length === 1
            ? '按权重随机（唯一可用候选'
            : '按权重随机'
        );
      const stablePoolText = selectionMode === 'stable_first'
        ? `，轮询顺位=P${stableSiteOrder}`
        : '';
      return {
        candidate,
        probability,
        reason: selectionMode === 'stable_first'
          ? `${reasonPrefix}，近期成功率=${recentSuccessRateText}（样本=${siteRuntimeDetail.recentSampleCount.toFixed(2)}，置信=${siteRuntimeDetail.recentConfidence.toFixed(2)}），回退成功率=${historicalSuccessRateText}，综合近期成功率=${stableFirstSuccessRateText}，运行时健康=${runtimeHealthText}，会话负载=${runtimeLoadText}，同站点目标=${siteTargets}${stablePoolText}，评分占比≈${(probability * 100).toFixed(1)}%）`
          : (
            candidates.length === 1
              ? `${reasonPrefix}，W=${weight}，成本=${costSourceText}:${(cost?.unitCost || 1).toFixed(6)}，站点权重=${siteGlobalWeight.toFixed(2)}x下游倍率=${normalizedDownstreamSiteMultiplier.toFixed(2)}=${combinedSiteWeight.toFixed(2)}，运行时健康=${runtimeHealthText}，会话负载=${runtimeLoadText}，历史健康=${siteHistoricalMultiplier.toFixed(2)}（成功率=${historicalSuccessRateText}，均延迟=${historicalLatencyText}，样本=${siteHistoricalHealth?.totalCalls ?? 0}），同站点目标=${siteTargets}，概率≈${(probability * 100).toFixed(1)}%）`
              : `按权重随机（W=${weight}，成本=${costSourceText}:${(cost?.unitCost || 1).toFixed(6)}，站点权重=${siteGlobalWeight.toFixed(2)}x下游倍率=${normalizedDownstreamSiteMultiplier.toFixed(2)}=${combinedSiteWeight.toFixed(2)}，运行时健康=${runtimeHealthText}，会话负载=${runtimeLoadText}，历史健康=${siteHistoricalMultiplier.toFixed(2)}（成功率=${historicalSuccessRateText}，均延迟=${historicalLatencyText}，样本=${siteHistoricalHealth?.totalCalls ?? 0}），同站点目标=${siteTargets}，概率≈${(probability * 100).toFixed(1)}%）`
          ),
      };
    });

    const selected = selectorSnapshot.selectedIndex == null
      ? candidates[rankedIndices[0] ?? 0]
      : (candidates[selectorSnapshot.selectedIndex] ?? candidates[rankedIndices[0] ?? 0]);

    return {
      selected,
      details,
      stableSiteCount: stableSiteIds.size,
    };
  }

  private getStableFirstSiteLeaderIndices(
    candidates: RouteEndpointTargetCandidate[],
    contributions: number[],
    rankedIndices: number[],
  ): number[] {
    if (rankedIndices.length <= 1) return rankedIndices;

    const siteLeaderIndices: number[] = [];
    const seenSiteIds = new Set<number>();
    for (const index of rankedIndices) {
      const siteId = candidates[index]?.site.id;
      if (!Number.isFinite(siteId) || seenSiteIds.has(siteId)) continue;
      seenSiteIds.add(siteId);
      siteLeaderIndices.push(index);
    }

    if (siteLeaderIndices.length <= 1) return siteLeaderIndices;

    const bestContribution = contributions[siteLeaderIndices[0] ?? rankedIndices[0] ?? 0] ?? 0;
    const stableSiteLeaderIndices = siteLeaderIndices.filter((index) => (
      isContributionCloseToBest(contributions[index] ?? 0, bestContribution)
    ));

    return stableSiteLeaderIndices.length > 0 ? stableSiteLeaderIndices : siteLeaderIndices;
  }

}

export const tokenRouter = new TokenRouter();

export const __tokenRouterTestUtils = {
  resolveMappedModel,
  getStableFirstRotationCacheSize: () => stableFirstLastSelectedSiteByKey.size,
  rememberStableFirstSiteSelectionForKey,
};

