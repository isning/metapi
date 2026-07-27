import { and, desc, gte, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getLocalRangeStartUtc } from './localTimeService.js';
import {
  loadRouteRuntimeExecutionTargetContexts,
  type RouteRuntimeExecutionTargetContext,
} from './routeRuntimeExecutionIdentityService.js';
import type { RuntimeHealthSummary } from './compiledRuntimeProjectionService.js';
import type {
  RuntimeRoutingSignalContext,
  RuntimeRoutingSignalEndpointState,
} from './compiledRuntimeRoutingSignalService.js';

export type CompiledRuntimeSignalAttempt = {
  executionAttemptId: string;
  entryId?: string | null;
  endpointId?: string | null;
  model: string;
  enabled?: boolean | null;
  siteId?: number | null;
  siteName?: string | null;
  siteUrl?: string | null;
  sitePlatform?: string | null;
  accountId?: number | null;
  accountLabel?: string | null;
  tokenId?: number | null;
  tokenLabel?: string | null;
  tokenGroup?: string | null;
  executionTargetId?: number | null;
  weight?: number | null;
  order?: number | null;
  health?: RuntimeHealthSummary | null;
};

export type RuntimeCredentialIdentity = {
  siteId: number;
  siteName: string;
  siteUrl: string;
  sitePlatform: string;
  siteGlobalWeight: number;
  accountId: number;
  accountUsername: string | null;
  accountBalance: number | null;
  accountExtraConfig: string | null;
  accountOauthProvider: string | null;
  tokenId: number | null;
  tokenName: string | null;
  tokenGroup: string | null;
  cooldownUntil: string | null;
  consecutiveFailureCount: number | null;
};

export type RuntimeAttemptHealth = RuntimeHealthSummary & {
  successCount: number;
  failureCount: number;
};

export type CompiledRuntimeAttemptContextLoad = {
  identities: Map<string, RuntimeCredentialIdentity>;
  healthByAttemptId: Map<string, RuntimeAttemptHealth>;
  endpointStateByAttemptId: Map<string, RuntimeRoutingSignalEndpointState>;
  signalContexts: RuntimeRoutingSignalContext[];
};

function trimDisplay(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function roundRateRatio(successCount: number, totalCalls: number): number | null {
  if (totalCalls <= 0) return null;
  return Math.round((successCount / totalCalls) * 1000) / 1000;
}

function uniquePositiveIds(values: Array<number | null | undefined>): number[] {
  return Array.from(new Set(values
    .map((value) => Number(value))
    .filter((value) => Number.isSafeInteger(value) && value > 0)
    .map((value) => Math.trunc(value))));
}

function emptyRuntimeAttemptHealth(): RuntimeAttemptHealth {
  return {
    successRate: null,
    totalCalls: 0,
    avgLatencyMs: null,
    cooldownUntil: null,
    consecutiveFailureCount: null,
    successCount: 0,
    failureCount: 0,
  };
}

export async function loadCompiledRuntimeCredentialIdentities(
  attempts: CompiledRuntimeSignalAttempt[],
): Promise<Map<string, RuntimeCredentialIdentity>> {
  const contexts = await loadRouteRuntimeExecutionTargetContexts(
    attempts.map((attempt) => attempt.executionTargetId),
  );
  return credentialIdentitiesFromTargetContexts(attempts, contexts);
}

function credentialIdentitiesFromTargetContexts(
  attempts: CompiledRuntimeSignalAttempt[],
  contexts: Map<number, RouteRuntimeExecutionTargetContext>,
): Map<string, RuntimeCredentialIdentity> {
  const result = new Map<string, RuntimeCredentialIdentity>();
  for (const attempt of attempts) {
    const executionTargetId = Number(attempt.executionTargetId);
    if (!Number.isSafeInteger(executionTargetId) || executionTargetId <= 0) continue;
    const context = contexts.get(executionTargetId);
    if (!context?.account) continue;
    result.set(attempt.executionAttemptId, {
      siteId: context.site.id,
      siteName: context.site.name,
      siteUrl: context.site.url || '',
      sitePlatform: context.site.platform || '',
      siteGlobalWeight: typeof context.site.globalWeight === 'number' ? context.site.globalWeight : 1,
      accountId: context.account.id,
      accountUsername: context.account.username ?? null,
      accountBalance: typeof context.account.balance === 'number' ? context.account.balance : null,
      accountExtraConfig: context.account.extraConfig ?? null,
      accountOauthProvider: context.account.oauthProvider ?? null,
      tokenId: context.token?.id ?? null,
      tokenName: context.token?.name ?? null,
      tokenGroup: context.token?.tokenGroup ?? null,
      cooldownUntil: context.state?.cooldownUntil ?? null,
      consecutiveFailureCount: context.state?.consecutiveFailCount ?? null,
    });
  }
  return result;
}

function endpointStatesFromTargetContexts(
  attempts: CompiledRuntimeSignalAttempt[],
  contexts: Map<number, RouteRuntimeExecutionTargetContext>,
): Map<string, RuntimeRoutingSignalEndpointState> {
  const result = new Map<string, RuntimeRoutingSignalEndpointState>();
  for (const attempt of attempts) {
    const executionTargetId = Number(attempt.executionTargetId);
    if (!Number.isSafeInteger(executionTargetId) || executionTargetId <= 0) continue;
    const state = contexts.get(executionTargetId)?.state;
    if (!state) continue;
    result.set(attempt.executionAttemptId, {
      successCount: state.successCount ?? 0,
      failCount: state.failCount ?? 0,
      totalLatencyMs: state.totalLatencyMs ?? 0,
      latencySampleCount: state.latencySampleCount ?? 0,
    });
  }
  return result;
}

export async function loadCompiledRuntimeEndpointStates(
  attempts: CompiledRuntimeSignalAttempt[],
): Promise<Map<string, RuntimeRoutingSignalEndpointState>> {
  const contexts = await loadRouteRuntimeExecutionTargetContexts(
    attempts.map((attempt) => attempt.executionTargetId),
  );
  return endpointStatesFromTargetContexts(attempts, contexts);
}

export async function loadCompiledRuntimeAttemptHealth(
  attempts: CompiledRuntimeSignalAttempt[],
): Promise<Map<string, RuntimeAttemptHealth>> {
  const result = new Map<string, RuntimeAttemptHealth>();
  if (attempts.length === 0) return result;

  const attemptIdsByExecutionTargetId = new Map<number, string[]>();
  for (const attempt of attempts) {
    const executionTargetId = Number(attempt.executionTargetId);
    if (Number.isSafeInteger(executionTargetId) && executionTargetId > 0) {
      const attemptIds = attemptIdsByExecutionTargetId.get(executionTargetId) || [];
      attemptIds.push(attempt.executionAttemptId);
      attemptIdsByExecutionTargetId.set(executionTargetId, attemptIds);
    }
  }

  const executionTargetIds = Array.from(attemptIdsByExecutionTargetId.keys());
  if (executionTargetIds.length === 0) return result;

  const since = getLocalRangeStartUtc(7);
  const recentLogs = await db.select({
    executionTargetId: schema.proxyLogs.executionTargetId,
    status: schema.proxyLogs.status,
    latencyMs: schema.proxyLogs.latencyMs,
    createdAt: schema.proxyLogs.createdAt,
  }).from(schema.proxyLogs)
    .where(and(
      gte(schema.proxyLogs.createdAt, since),
      inArray(schema.proxyLogs.executionTargetId, executionTargetIds),
    ))
    .orderBy(desc(schema.proxyLogs.createdAt))
    .all();

  const latencyTotals = new Map<string, { total: number; samples: number }>();
  for (const log of recentLogs) {
    const matchedAttemptIds = new Set<string>();
    if (typeof log.executionTargetId === 'number') {
      for (const attemptId of attemptIdsByExecutionTargetId.get(log.executionTargetId) || []) {
        matchedAttemptIds.add(attemptId);
      }
    }
    if (matchedAttemptIds.size === 0) continue;

    for (const attemptId of matchedAttemptIds) {
      const health = result.get(attemptId) || emptyRuntimeAttemptHealth();
      health.totalCalls += 1;
      if (log.status === 'success') {
        health.successCount += 1;
        if (typeof log.latencyMs === 'number' && log.latencyMs >= 0) {
          const current = latencyTotals.get(attemptId) || { total: 0, samples: 0 };
          current.total += log.latencyMs;
          current.samples += 1;
          latencyTotals.set(attemptId, current);
        }
      } else {
        health.failureCount += 1;
      }
      result.set(attemptId, health);
    }
  }

  for (const [attemptId, health] of result.entries()) {
    health.successRate = roundRateRatio(health.successCount, health.totalCalls);
    const latency = latencyTotals.get(attemptId);
    if (latency && latency.samples > 0) {
      health.avgLatencyMs = Math.round(latency.total / latency.samples);
    }
  }

  return result;
}

export async function buildCompiledRuntimeRoutingSignalContexts(input: {
  attempts: CompiledRuntimeSignalAttempt[];
  selectionGroupIdByExecutionAttemptId?: Map<string, string>;
}): Promise<CompiledRuntimeAttemptContextLoad> {
  const [targetContexts, healthByAttemptId] = await Promise.all([
    loadRouteRuntimeExecutionTargetContexts(input.attempts.map((attempt) => attempt.executionTargetId)),
    loadCompiledRuntimeAttemptHealth(input.attempts),
  ]);
  const identities = credentialIdentitiesFromTargetContexts(input.attempts, targetContexts);
  const endpointStateByAttemptId = endpointStatesFromTargetContexts(input.attempts, targetContexts);

  const signalContexts = input.attempts.map((attempt, index): RuntimeRoutingSignalContext | null => {
    const identity = identities.get(attempt.executionAttemptId) || null;
    if (!identity) return null;
    const selectionGroupId = input.selectionGroupIdByExecutionAttemptId?.get(attempt.executionAttemptId);
    if (!selectionGroupId) return null;
    const health = healthByAttemptId.get(attempt.executionAttemptId) || null;
    const endpointState = endpointStateByAttemptId.get(attempt.executionAttemptId) || null;
    return {
      executionAttemptId: attempt.executionAttemptId,
      entryId: trimDisplay(attempt.entryId) || null,
      selectionGroupId,
      enabled: attempt.enabled !== false,
      siteId: identity.siteId,
      accountId: identity.accountId,
      tokenId: identity.tokenId,
      tokenGroup: trimDisplay(identity.tokenGroup) || null,
      provider: trimDisplay(identity.sitePlatform) || null,
      modelName: attempt.model || '',
      executionTargetId: attempt.executionTargetId ?? null,
      weight: attempt.weight ?? null,
      order: attempt.order ?? index,
      accountBalance: identity.accountBalance,
      accountExtraConfig: identity.accountExtraConfig,
      accountOauthProvider: identity.accountOauthProvider,
      siteGlobalWeight: identity.siteGlobalWeight,
      health,
      endpointState,
    };
  }).filter((context): context is RuntimeRoutingSignalContext => !!context);

  return {
    identities,
    healthByAttemptId,
    endpointStateByAttemptId,
    signalContexts,
  };
}
