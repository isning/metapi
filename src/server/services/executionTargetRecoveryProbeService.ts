import { schema } from '../db/index.js';
import { isUsableAccountToken } from './accountTokenService.js';
import { getOauthInfoFromAccount } from './oauth/oauthAccount.js';
import { proxyTargetCoordinator } from './proxyTargetCoordinator.js';
import { probeRuntimeModel } from './runtimeModelProbe.js';
import {
  loadCoolingRouteRuntimeRecoveryProbeContexts,
  loadRouteRuntimeExecutionTargetContexts,
  type RouteRuntimeExecutionTargetContext,
} from './routeRuntimeExecutionIdentityService.js';
import { markRouteRuntimeExecutionTargetRecovered } from './routeRuntimeExecutionService.js';

type RecoveryProbeSource = 'cooldown' | 'active';

type RecoveryProbeExecutionTarget = {
  source: RecoveryProbeSource;
  executionTargetId: number;
  modelName: string;
  tokenValue: string;
  account: typeof schema.accounts.$inferSelect;
  site: typeof schema.sites.$inferSelect;
};

const EXECUTION_TARGET_RECOVERY_SWEEP_INTERVAL_MS = 30_000;
const EXECUTION_TARGET_RECOVERY_PROBE_TIMEOUT_MS = 12_000;
// Keep recovery probes conservative so they do not look like bulk health checks to upstream providers.
const EXECUTION_TARGET_RECOVERY_PROBE_CONCURRENCY = 1;
const EXECUTION_TARGET_RECOVERY_MAX_BATCH = 4;
const EXECUTION_TARGET_RECOVERY_COOLDOWN_RECHECK_MS = 30_000;
const EXECUTION_TARGET_RECOVERY_ACTIVE_RECHECK_MS = 5 * 60_000;

let recoveryProbeSchedulerTimer: ReturnType<typeof setInterval> | null = null;
let recoveryProbeSweepInFlight: Promise<void> | null = null;
const recoveryProbeInFlightKeys = new Set<string>();
const recoveryProbeLastStartedAtByKey = new Map<string, number>();

function shouldUnrefTimer(timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>) {
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }
}

function buildRecoveryProbeKey(executionTargetId: number, modelName: string): string {
  return `${executionTargetId}:${String(modelName || '').trim().toLowerCase()}`;
}

function resolveRecoveryProbeWindowMs(source: RecoveryProbeSource): number {
  return source === 'cooldown'
    ? EXECUTION_TARGET_RECOVERY_COOLDOWN_RECHECK_MS
    : EXECUTION_TARGET_RECOVERY_ACTIVE_RECHECK_MS;
}

function resolveProbeModelName(context: RouteRuntimeExecutionTargetContext): string {
  return String(context.executionTarget.upstreamModelName || '').trim();
}

function resolveProbeTokenValue(context: RouteRuntimeExecutionTargetContext): string | null {
  if (typeof context.executionTarget.tokenId === 'number' && context.executionTarget.tokenId > 0) {
    if (!context.token || !isUsableAccountToken(context.token)) return null;
    const tokenValue = String(context.token.token || '').trim();
    return tokenValue || null;
  }

  if (!context.account) return null;
  if (getOauthInfoFromAccount(context.account)) {
    const accessToken = String(context.account.accessToken || '').trim();
    return accessToken || null;
  }

  const fallbackApiToken = String(context.account.apiToken || '').trim();
  return fallbackApiToken || null;
}

function isProviderDirectedCooldown(context: RouteRuntimeExecutionTargetContext): boolean {
  const state = context.state;
  return !!state?.cooldownUntil
    && (state.failCount ?? 0) <= 0
    && (state.consecutiveFailCount ?? 0) <= 0
    && (state.cooldownLevel ?? 0) <= 0;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const safeConcurrency = Math.max(1, Math.min(items.length || 1, Math.trunc(concurrency || 1)));
  let nextIndex = 0;
  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      await worker(items[currentIndex] as T, currentIndex);
    }
  };

  await Promise.all(Array.from({ length: safeConcurrency }, () => runWorker()));
}

async function loadCoolingProbeExecutionTargets(nowIso: string): Promise<RecoveryProbeExecutionTarget[]> {
  const contexts = await loadCoolingRouteRuntimeRecoveryProbeContexts(nowIso);
  return contexts.flatMap((context) => {
    if (isProviderDirectedCooldown(context) || !context.account) return [];
    const modelName = resolveProbeModelName(context);
    const tokenValue = resolveProbeTokenValue(context);
    if (!modelName || !tokenValue) return [];
    return [{
      source: 'cooldown' as const,
      executionTargetId: context.executionTarget.id,
      modelName,
      tokenValue,
      account: context.account,
      site: context.site,
    }];
  });
}

async function loadActiveProbeExecutionTargets(activeExecutionTargetIds: number[]): Promise<RecoveryProbeExecutionTarget[]> {
  if (activeExecutionTargetIds.length <= 0) return [];

  const contexts = await loadRouteRuntimeExecutionTargetContexts(activeExecutionTargetIds);
  return Array.from(contexts.values()).flatMap((context) => {
    if (!context.account || context.executionTarget.enabled === false) return [];
    const modelName = resolveProbeModelName(context);
    const tokenValue = resolveProbeTokenValue(context);
    if (!modelName || !tokenValue) return [];
    return [{
      source: 'active' as const,
      executionTargetId: context.executionTarget.id,
      modelName,
      tokenValue,
      account: context.account,
      site: context.site,
    }];
  });
}

function mergeRecoveryProbeExecutionTargets(executionTargets: RecoveryProbeExecutionTarget[]): RecoveryProbeExecutionTarget[] {
  const merged = new Map<number, RecoveryProbeExecutionTarget>();
  for (const executionTarget of executionTargets) {
    const existing = merged.get(executionTarget.executionTargetId);
    if (!existing || (existing.source === 'active' && executionTarget.source === 'cooldown')) {
      merged.set(executionTarget.executionTargetId, executionTarget);
    }
  }
  return Array.from(merged.values());
}

function shouldProbeExecutionTarget(executionTarget: RecoveryProbeExecutionTarget, nowMs: number): boolean {
  const key = buildRecoveryProbeKey(executionTarget.executionTargetId, executionTarget.modelName);
  if (recoveryProbeInFlightKeys.has(key)) return false;
  const lastStartedAt = recoveryProbeLastStartedAtByKey.get(key) ?? 0;
  return (nowMs - lastStartedAt) >= resolveRecoveryProbeWindowMs(executionTarget.source);
}

function compareRecoveryProbeExecutionTargetPriority(left: RecoveryProbeExecutionTarget, right: RecoveryProbeExecutionTarget): number {
  const leftKey = buildRecoveryProbeKey(left.executionTargetId, left.modelName);
  const rightKey = buildRecoveryProbeKey(right.executionTargetId, right.modelName);
  const leftLastStartedAt = recoveryProbeLastStartedAtByKey.get(leftKey);
  const rightLastStartedAt = recoveryProbeLastStartedAtByKey.get(rightKey);

  if (leftLastStartedAt == null && rightLastStartedAt == null) {
    return left.executionTargetId - right.executionTargetId;
  }
  if (leftLastStartedAt == null) return -1;
  if (rightLastStartedAt == null) return 1;
  if (leftLastStartedAt !== rightLastStartedAt) {
    return leftLastStartedAt - rightLastStartedAt;
  }
  return left.executionTargetId - right.executionTargetId;
}

async function runRecoveryProbeExecutionTarget(executionTarget: RecoveryProbeExecutionTarget, nowMs: number): Promise<void> {
  const key = buildRecoveryProbeKey(executionTarget.executionTargetId, executionTarget.modelName);
  recoveryProbeInFlightKeys.add(key);
  recoveryProbeLastStartedAtByKey.set(key, nowMs);
  try {
    const result = await probeRuntimeModel({
      site: executionTarget.site,
      account: executionTarget.account,
      modelName: executionTarget.modelName,
      tokenValue: executionTarget.tokenValue,
      timeoutMs: EXECUTION_TARGET_RECOVERY_PROBE_TIMEOUT_MS,
    });
    if (result.status === 'supported') {
      await markRouteRuntimeExecutionTargetRecovered(executionTarget.executionTargetId);
    }
  } catch (error) {
    console.warn(
      `[execution-target-recovery-probe] execution target ${executionTarget.executionTargetId} probe failed`,
      error,
    );
  } finally {
    recoveryProbeInFlightKeys.delete(key);
  }
}

export async function runExecutionTargetRecoveryProbeSweep(nowMs = Date.now()): Promise<void> {
  if (recoveryProbeSweepInFlight) {
    await recoveryProbeSweepInFlight;
    return;
  }

  recoveryProbeSweepInFlight = (async () => {
    const nowIso = new Date(nowMs).toISOString();
    const activeExecutionTargetIds = proxyTargetCoordinator.getActiveTargetIds();
    const [coolingExecutionTargets, activeExecutionTargets] = await Promise.all([
      loadCoolingProbeExecutionTargets(nowIso),
      loadActiveProbeExecutionTargets(activeExecutionTargetIds),
    ]);

    const merged = mergeRecoveryProbeExecutionTargets([
      ...coolingExecutionTargets,
      ...activeExecutionTargets,
    ]);
    const dueExecutionTargets = merged
      .filter((executionTarget) => shouldProbeExecutionTarget(executionTarget, nowMs))
      .sort(compareRecoveryProbeExecutionTargetPriority)
      .slice(0, EXECUTION_TARGET_RECOVERY_MAX_BATCH);
    if (dueExecutionTargets.length <= 0) return;

    await mapWithConcurrency(
      dueExecutionTargets,
      EXECUTION_TARGET_RECOVERY_PROBE_CONCURRENCY,
      async (executionTarget) => runRecoveryProbeExecutionTarget(executionTarget, nowMs),
    );
  })().finally(() => {
    recoveryProbeSweepInFlight = null;
  });

  await recoveryProbeSweepInFlight;
}

export function startExecutionTargetRecoveryProbeScheduler(intervalMs = EXECUTION_TARGET_RECOVERY_SWEEP_INTERVAL_MS) {
  stopExecutionTargetRecoveryProbeScheduler();
  const safeIntervalMs = Math.max(10_000, Math.trunc(intervalMs || 0));
  recoveryProbeSchedulerTimer = setInterval(() => {
    void runExecutionTargetRecoveryProbeSweep().catch((error) => {
      console.warn('[execution-target-recovery-probe] background sweep failed', error);
    });
  }, safeIntervalMs);
  shouldUnrefTimer(recoveryProbeSchedulerTimer);
  void runExecutionTargetRecoveryProbeSweep().catch((error) => {
    console.warn('[execution-target-recovery-probe] initial sweep failed', error);
  });
  return {
    enabled: true,
    intervalMs: safeIntervalMs,
  };
}

export function stopExecutionTargetRecoveryProbeScheduler() {
  if (recoveryProbeSchedulerTimer) {
    clearInterval(recoveryProbeSchedulerTimer);
    recoveryProbeSchedulerTimer = null;
  }
}

export function resetExecutionTargetRecoveryProbeState() {
  stopExecutionTargetRecoveryProbeScheduler();
  recoveryProbeSweepInFlight = null;
  recoveryProbeInFlightKeys.clear();
  recoveryProbeLastStartedAtByKey.clear();
}
