import { config } from '../config.js';

export type ProxyAffinityBinding =
  | {
    scope: 'target';
    entryNodeId: string;
    primaryExecutionTargetId: number;
    revision: number;
    expiresAtMs: number;
  }
  | {
    scope: 'pool';
    entryNodeId: string;
    primaryPoolId: string;
    revision: number;
    expiresAtMs: number;
  };

export type ProxyAffinitySuccess = {
  affinityKey?: string | null;
  entryNodeId: string;
  mode: 'disabled' | 'pool' | 'target';
  selectedExecutionTargetId: number;
  selectedPoolId?: string | null;
  primaryRevision?: number | null;
  primaryPoolId?: string | null;
  primaryExecutionTargetId?: number | null;
  fallback: boolean;
  promoteOnSuccess: boolean;
  ttlSec: number;
};

export type ProxyAffinityUpdateReason =
  | 'disabled'
  | 'invalid'
  | 'bound'
  | 'primary_refreshed'
  | 'temporary_fallback'
  | 'promoted'
  | 'stale_ignored';

export type ProxyAffinityUpdateResult = {
  changed: boolean;
  binding: ProxyAffinityBinding | null;
  reason: ProxyAffinityUpdateReason;
};

type StickyEntry = ProxyAffinityBinding;

type ActiveLeaseState = {
  release: () => void;
};

type TargetWaiter = {
  cancelled: boolean;
  resolve: (result: AcquireProxyTargetLeaseResult) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

type TargetRuntimeState = {
  activeLeaseIds: Set<number>;
  queue: TargetWaiter[];
};

export type ProxyTargetLoadSnapshot = {
  targetId: number;
  sessionScoped: boolean;
  concurrencyLimit: number;
  activeLeaseCount: number;
  waitingCount: number;
  loadRatio: number;
  saturated: boolean;
};

export type ProxyTargetLease = {
  targetId: number;
  isActive(): boolean;
  release(): void;
  touch(): void;
};

export type AcquireProxyTargetLeaseResult =
  | { status: 'acquired'; lease: ProxyTargetLease }
  | { status: 'timeout'; waitMs: number };

const stickySessionBindings = new Map<string, StickyEntry>();
const targetRuntimeStates = new Map<number, TargetRuntimeState>();
let nextLeaseId = 1;
type SessionScopedTargetInput =
  | null
  | undefined
  | {
    credentialMode?: string | null;
    oauthProvider?: string | null;
  };

function shouldUnrefTimer(timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>) {
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }
}

function cleanupExpiredStickyBindings(nowMs = Date.now()): void {
  for (const [key, entry] of stickySessionBindings.entries()) {
    if (entry.expiresAtMs <= nowMs) {
      stickySessionBindings.delete(key);
    }
  }
}

function isSessionScopedTarget(input?: SessionScopedTargetInput): boolean {
  return input?.credentialMode === 'session'
    || input?.credentialMode === 'oauth'
    || !!input?.oauthProvider;
}

function getStickySessionTtlMs(): number {
  return Math.max(30_000, Math.trunc(config.proxyStickySessionTtlMs || 0));
}

function getTargetLeaseTtlMs(): number {
  return Math.max(5_000, Math.trunc(config.proxySessionTargetLeaseTtlMs || 0));
}

function getTargetLeaseKeepaliveMs(): number {
  return Math.max(1_000, Math.trunc(config.proxySessionTargetLeaseKeepaliveMs || 0));
}

function getTargetQueueWaitMs(): number {
  return Math.max(0, Math.trunc(config.proxySessionTargetQueueWaitMs || 0));
}

function getTargetConcurrencyLimit(input?: SessionScopedTargetInput): number {
  if (!isSessionScopedTarget(input)) return 0;
  return Math.max(0, Math.trunc(config.proxySessionTargetConcurrencyLimit || 0));
}

function getOrCreateTargetRuntimeState(targetId: number): TargetRuntimeState {
  let state = targetRuntimeStates.get(targetId);
  if (!state) {
    state = {
      activeLeaseIds: new Set<number>(),
      queue: [],
    };
    targetRuntimeStates.set(targetId, state);
  }
  return state;
}

function pruneCancelledWaiters(state: TargetRuntimeState): void {
  if (state.queue.length <= 0) return;
  state.queue = state.queue.filter((waiter) => !waiter.cancelled);
}

function maybeDeleteTargetRuntimeState(targetId: number): void {
  const state = targetRuntimeStates.get(targetId);
  if (!state) return;
  pruneCancelledWaiters(state);
  if (state.activeLeaseIds.size <= 0 && state.queue.every((waiter) => waiter.cancelled)) {
    targetRuntimeStates.delete(targetId);
  }
}

function createNoopLease(targetId: number): ProxyTargetLease {
  return {
    targetId,
    isActive: () => false,
    release: () => {},
    touch: () => {},
  };
}

class ProxyTargetCoordinator {
  buildStickySessionKey(input: {
    clientKind?: string | null;
    sessionId?: string | null;
    contentAffinityKey?: string | null;
    endpointType?: string | null;
    requestedModel: string;
    downstreamPath: string;
    downstreamApiKeyId?: number | null;
  }): string | null {
    if (input.contentAffinityKey) return null;
    const sessionId = String(input.sessionId || '').trim();
    if (!sessionId) return null;
    const requestedModel = String(input.requestedModel || '').trim().toLowerCase();
    if (!requestedModel) return null;
    const clientKind = String(input.clientKind || 'generic').trim().toLowerCase() || 'generic';
    const endpointType = String(input.endpointType || input.downstreamPath || 'custom.http').trim().toLowerCase() || 'custom.http';
    const owner = typeof input.downstreamApiKeyId === 'number' && Number.isFinite(input.downstreamApiKeyId)
      ? `key:${Math.trunc(input.downstreamApiKeyId)}`
      : 'key:anonymous';
    return [owner, clientKind, endpointType, requestedModel, sessionId].join('|');
  }

  getStickyTargetId(stickySessionKey?: string | null, nowMs = Date.now()): number | null {
    if (!config.proxyStickySessionEnabled) return null;
    cleanupExpiredStickyBindings(nowMs);
    const normalizedKey = String(stickySessionKey || '').trim();
    if (!normalizedKey) return null;
    const entry = stickySessionBindings.get(normalizedKey);
    if (!entry || entry.expiresAtMs <= nowMs) {
      stickySessionBindings.delete(normalizedKey);
      return null;
    }
    return entry.scope === 'target' ? entry.primaryExecutionTargetId : null;
  }

  getAffinityBinding(affinityKey?: string | null, nowMs = Date.now()): ProxyAffinityBinding | null {
    cleanupExpiredStickyBindings(nowMs);
    const normalizedKey = String(affinityKey || '').trim();
    if (!normalizedKey) return null;
    const entry = stickySessionBindings.get(normalizedKey);
    if (!entry || entry.expiresAtMs <= nowMs) {
      stickySessionBindings.delete(normalizedKey);
      return null;
    }
    return { ...entry };
  }

  clearAffinityBinding(affinityKey?: string | null, expectedRevision?: number | null): boolean {
    const key = String(affinityKey || '').trim();
    if (!key) return false;
    const existing = stickySessionBindings.get(key);
    if (!existing) return false;
    if (expectedRevision != null && existing.revision !== expectedRevision) return false;
    return stickySessionBindings.delete(key);
  }

  bindStickyTarget(stickySessionKey: string | null | undefined, targetId: number, _accountIdentity?: SessionScopedTargetInput): void {
    if (!config.proxyStickySessionEnabled) return;
    const normalizedKey = String(stickySessionKey || '').trim();
    if (!normalizedKey || !Number.isFinite(targetId) || targetId <= 0) return;
    cleanupExpiredStickyBindings();
    const previous = stickySessionBindings.get(normalizedKey);
    stickySessionBindings.set(normalizedKey, {
      scope: 'target',
      entryNodeId: '',
      primaryExecutionTargetId: Math.trunc(targetId),
      revision: (previous?.revision || 0) + 1,
      expiresAtMs: Date.now() + getStickySessionTtlMs(),
    });
  }

  recordSuccessfulAffinitySelection(input: ProxyAffinitySuccess): ProxyAffinityUpdateResult {
    const key = String(input.affinityKey || '').trim();
    if (!key || input.mode === 'disabled') return { changed: false, binding: null, reason: 'disabled' };
    cleanupExpiredStickyBindings();
    const existing = stickySessionBindings.get(key) || null;
    const ttlMs = Math.max(30_000, Math.trunc(Number(input.ttlSec) || 0) * 1000);
    const nextTargetId = Math.trunc(Number(input.selectedExecutionTargetId));
    const nextPoolId = String(input.selectedPoolId || '').trim();
    if (!Number.isSafeInteger(nextTargetId) || nextTargetId <= 0) return { changed: false, binding: existing ? { ...existing } : null, reason: 'invalid' };
    if (input.mode === 'pool' && !nextPoolId) return { changed: false, binding: existing ? { ...existing } : null, reason: 'invalid' };

    if (!existing) {
      const binding: ProxyAffinityBinding = input.mode === 'pool'
        ? {
            scope: 'pool',
            entryNodeId: input.entryNodeId,
            primaryPoolId: nextPoolId,
            revision: 1,
            expiresAtMs: Date.now() + ttlMs,
          }
        : {
            scope: 'target',
            entryNodeId: input.entryNodeId,
            primaryExecutionTargetId: nextTargetId,
            revision: 1,
            expiresAtMs: Date.now() + ttlMs,
          };
      stickySessionBindings.set(key, binding);
      return { changed: true, binding: { ...binding }, reason: 'bound' };
    }

    if (!input.fallback) {
      existing.expiresAtMs = Date.now() + ttlMs;
      return { changed: false, binding: { ...existing }, reason: 'primary_refreshed' };
    }
    if (existing.revision !== input.primaryRevision) {
      return { changed: false, binding: { ...existing }, reason: 'stale_ignored' };
    }
    if (!input.promoteOnSuccess) {
      // A temporary fallback still represents a successful request for the
      // same session. Keep the original primary, but extend its lease while
      // the session remains active.
      existing.expiresAtMs = Date.now() + ttlMs;
      return { changed: false, binding: { ...existing }, reason: 'temporary_fallback' };
    }
    const expectedPrimaryMatches = existing.scope === 'pool'
      ? existing.primaryPoolId === input.primaryPoolId
      : existing.primaryExecutionTargetId === input.primaryExecutionTargetId;
    if (!expectedPrimaryMatches) return { changed: false, binding: { ...existing }, reason: 'stale_ignored' };
    const promoted: ProxyAffinityBinding = input.mode === 'pool'
      ? {
          scope: 'pool',
          entryNodeId: input.entryNodeId,
          primaryPoolId: nextPoolId,
          revision: existing.revision + 1,
          expiresAtMs: Date.now() + ttlMs,
        }
      : {
          scope: 'target',
          entryNodeId: input.entryNodeId,
          primaryExecutionTargetId: nextTargetId,
          revision: existing.revision + 1,
          expiresAtMs: Date.now() + ttlMs,
        };
    stickySessionBindings.set(key, promoted);
    return { changed: true, binding: { ...promoted }, reason: 'promoted' };
  }

  clearStickyTarget(stickySessionKey?: string | null, targetId?: number | null): void {
    const normalizedKey = String(stickySessionKey || '').trim();
    if (!normalizedKey) return;
    const existing = stickySessionBindings.get(normalizedKey);
    if (!existing) return;
    if (typeof targetId === 'number' && Number.isFinite(targetId) && (
      existing.scope !== 'target' || existing.primaryExecutionTargetId !== Math.trunc(targetId)
    )) {
      return;
    }
    stickySessionBindings.delete(normalizedKey);
  }

  getActiveTargetIds(): number[] {
    const ids: number[] = [];
    for (const [targetId, state] of targetRuntimeStates.entries()) {
      pruneCancelledWaiters(state);
      if (state.activeLeaseIds.size > 0) {
        ids.push(targetId);
      }
    }
    return ids;
  }

  getTargetLoadSnapshot(input: {
    targetId: number;
    accountCredentialMode?: string | null;
    accountOauthProvider?: string | null;
  }): ProxyTargetLoadSnapshot {
    const targetId = Math.trunc(input.targetId || 0);
    const sessionScoped = isSessionScopedTarget({
      credentialMode: input.accountCredentialMode,
      oauthProvider: input.accountOauthProvider,
    });
    const concurrencyLimit = getTargetConcurrencyLimit({
      credentialMode: input.accountCredentialMode,
      oauthProvider: input.accountOauthProvider,
    });
    const state = targetId > 0 ? targetRuntimeStates.get(targetId) : null;
    if (state) {
      pruneCancelledWaiters(state);
    }
    const activeLeaseCount = state?.activeLeaseIds.size ?? 0;
    const waitingCount = state?.queue.length ?? 0;
    const denominator = concurrencyLimit > 0 ? concurrencyLimit : 1;
    return {
      targetId,
      sessionScoped,
      concurrencyLimit,
      activeLeaseCount,
      waitingCount,
      loadRatio: (activeLeaseCount + waitingCount) / denominator,
      saturated: concurrencyLimit > 0 && activeLeaseCount >= concurrencyLimit,
    };
  }

  getTargetLoadSnapshots(input: Array<{
    targetId: number;
    accountCredentialMode?: string | null;
    accountOauthProvider?: string | null;
  }>): Map<number, ProxyTargetLoadSnapshot> {
    const snapshots = new Map<number, ProxyTargetLoadSnapshot>();
    for (const item of input) {
      const snapshot = this.getTargetLoadSnapshot(item);
      snapshots.set(snapshot.targetId, snapshot);
    }
    return snapshots;
  }

  async acquireTargetLease(input: {
    targetId: number;
    accountCredentialMode?: string | null;
    accountOauthProvider?: string | null;
  }): Promise<AcquireProxyTargetLeaseResult> {
    const targetId = Math.trunc(input.targetId || 0);
    if (targetId <= 0) {
      return {
        status: 'acquired',
        lease: createNoopLease(0),
      };
    }

    const concurrencyLimit = getTargetConcurrencyLimit({
      credentialMode: input.accountCredentialMode,
      oauthProvider: input.accountOauthProvider,
    });
    if (concurrencyLimit <= 0) {
      return {
        status: 'acquired',
        lease: createNoopLease(targetId),
      };
    }

    const state = getOrCreateTargetRuntimeState(targetId);
    pruneCancelledWaiters(state);
    if (state.activeLeaseIds.size < concurrencyLimit) {
      return {
        status: 'acquired',
        lease: this.createTrackedLease(targetId, state),
      };
    }

    const waitMs = getTargetQueueWaitMs();
    if (waitMs <= 0) {
      return {
        status: 'timeout',
        waitMs: 0,
      };
    }

    return await new Promise<AcquireProxyTargetLeaseResult>((resolve) => {
      const waiter: TargetWaiter = {
        cancelled: false,
        resolve,
        timer: null,
      };
      waiter.timer = setTimeout(() => {
        waiter.cancelled = true;
        waiter.timer = null;
        pruneCancelledWaiters(state);
        maybeDeleteTargetRuntimeState(targetId);
        resolve({
          status: 'timeout',
          waitMs,
        });
      }, waitMs);
      shouldUnrefTimer(waiter.timer);
      state.queue.push(waiter);
    });
  }

  private createTrackedLease(targetId: number, state: TargetRuntimeState): ProxyTargetLease {
    const leaseId = nextLeaseId++;
    state.activeLeaseIds.add(leaseId);

    let released = false;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

    const release = () => {
      if (released) return;
      released = true;
      if (expiryTimer) clearTimeout(expiryTimer);
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      state.activeLeaseIds.delete(leaseId);
      this.drainQueue(targetId);
      maybeDeleteTargetRuntimeState(targetId);
    };

    const touch = () => {
      if (released) return;
      if (expiryTimer) clearTimeout(expiryTimer);
      expiryTimer = setTimeout(() => {
        release();
      }, getTargetLeaseTtlMs());
      shouldUnrefTimer(expiryTimer);
    };

    touch();

    const keepaliveMs = getTargetLeaseKeepaliveMs();
    if (keepaliveMs > 0) {
      keepaliveTimer = setInterval(() => {
        touch();
      }, keepaliveMs);
      shouldUnrefTimer(keepaliveTimer);
    }

    return {
      targetId,
      isActive: () => !released,
      release,
      touch,
    };
  }

  private drainQueue(targetId: number): void {
    const state = targetRuntimeStates.get(targetId);
    if (!state) return;
    pruneCancelledWaiters(state);
    const concurrencyLimit = Math.max(0, Math.trunc(config.proxySessionTargetConcurrencyLimit || 0));
    while (state.activeLeaseIds.size < concurrencyLimit && state.queue.length > 0) {
      const waiter = state.queue.shift();
      if (!waiter || waiter.cancelled) continue;
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.timer = null;
      waiter.resolve({
        status: 'acquired',
        lease: this.createTrackedLease(targetId, state),
      });
    }
  }
}

export function resetProxyTargetCoordinatorState(): void {
  stickySessionBindings.clear();
  targetRuntimeStates.clear();
  nextLeaseId = 1;
}

export function isProxyTargetSessionScoped(input?: SessionScopedTargetInput): boolean {
  return isSessionScopedTarget(input);
}

export const proxyTargetCoordinator = new ProxyTargetCoordinator();
