import { config } from '../config.js';
import {
  getCredentialModeFromExtraConfig,
  hasOauthProvider,
} from './accountExtraConfig.js';

type StickyEntry = {
  targetId: number;
  expiresAtMs: number;
};

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
  | string
  | null
  | undefined
  | {
    extraConfig?: string | null;
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

function getSessionScopedExtraConfig(input?: SessionScopedTargetInput): string | null | undefined {
  if (typeof input === 'string' || input == null) return input;
  return input.extraConfig;
}

function isSessionScopedTarget(input?: SessionScopedTargetInput): boolean {
  return getCredentialModeFromExtraConfig(getSessionScopedExtraConfig(input)) === 'session'
    || hasOauthProvider(input);
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
    requestedModel: string;
    downstreamPath: string;
    downstreamApiKeyId?: number | null;
  }): string | null {
    if (!config.proxyStickySessionEnabled) return null;
    const sessionId = String(input.sessionId || '').trim();
    if (!sessionId) return null;
    const requestedModel = String(input.requestedModel || '').trim().toLowerCase();
    if (!requestedModel) return null;
    const downstreamPath = String(input.downstreamPath || '').trim().toLowerCase() || 'unknown';
    const clientKind = String(input.clientKind || 'generic').trim().toLowerCase() || 'generic';
    const owner = typeof input.downstreamApiKeyId === 'number' && Number.isFinite(input.downstreamApiKeyId)
      ? `key:${Math.trunc(input.downstreamApiKeyId)}`
      : 'key:anonymous';
    return [owner, clientKind, downstreamPath, requestedModel, sessionId].join('|');
  }

  getStickyTargetId(stickySessionKey?: string | null, nowMs = Date.now()): number | null {
    cleanupExpiredStickyBindings(nowMs);
    const normalizedKey = String(stickySessionKey || '').trim();
    if (!normalizedKey) return null;
    const entry = stickySessionBindings.get(normalizedKey);
    if (!entry || entry.expiresAtMs <= nowMs) {
      stickySessionBindings.delete(normalizedKey);
      return null;
    }
    return entry.targetId;
  }

  bindStickyTarget(stickySessionKey: string | null | undefined, targetId: number, _accountIdentity?: SessionScopedTargetInput): void {
    if (!config.proxyStickySessionEnabled) return;
    const normalizedKey = String(stickySessionKey || '').trim();
    if (!normalizedKey || !Number.isFinite(targetId) || targetId <= 0) return;
    cleanupExpiredStickyBindings();
    stickySessionBindings.set(normalizedKey, {
      targetId: Math.trunc(targetId),
      expiresAtMs: Date.now() + getStickySessionTtlMs(),
    });
  }

  clearStickyTarget(stickySessionKey?: string | null, targetId?: number | null): void {
    const normalizedKey = String(stickySessionKey || '').trim();
    if (!normalizedKey) return;
    const existing = stickySessionBindings.get(normalizedKey);
    if (!existing) return;
    if (typeof targetId === 'number' && Number.isFinite(targetId) && existing.targetId !== Math.trunc(targetId)) {
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
    accountExtraConfig?: string | null;
    accountOauthProvider?: string | null;
  }): ProxyTargetLoadSnapshot {
    const targetId = Math.trunc(input.targetId || 0);
    const sessionScoped = isSessionScopedTarget({
      extraConfig: input.accountExtraConfig,
      oauthProvider: input.accountOauthProvider,
    });
    const concurrencyLimit = getTargetConcurrencyLimit({
      extraConfig: input.accountExtraConfig,
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
    accountExtraConfig?: string | null;
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
    accountExtraConfig?: string | null;
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
      extraConfig: input.accountExtraConfig,
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
