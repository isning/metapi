import * as routeRefreshWorkflow from '../services/routeRefreshWorkflow.js';
import { proxyTargetCoordinator } from '../services/proxyTargetCoordinator.js';
import { canRetryProxyTarget } from '../services/proxyTargetRetry.js';
import type { DownstreamRoutingPolicy } from '../services/downstreamPolicyTypes.js';
import { tokenRouter } from '../services/tokenRouter.js';
import type { RouteExecutionScope } from '../services/routeExecutionScopeTypes.js';

type SelectedTarget = Awaited<ReturnType<typeof tokenRouter.selectTarget>>;

export const TESTER_FORCED_TARGET_HEADER = 'x-metapi-tester-forced-target-id';
export const TESTER_REQUEST_HEADER = 'x-metapi-tester-request';

function headerValueEquals(
  headers: Record<string, unknown> | undefined,
  expectedKey: string,
  expectedValue: string,
): boolean {
  if (!headers) return false;
  const normalizedExpectedKey = expectedKey.trim().toLowerCase();
  const normalizedExpectedValue = expectedValue.trim().toLowerCase();
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    if (rawKey.trim().toLowerCase() !== normalizedExpectedKey) continue;
    if (typeof rawValue === 'string' && rawValue.trim().toLowerCase() === normalizedExpectedValue) {
      return true;
    }
  }
  return false;
}

function isLoopbackClientIp(value: string | null | undefined): boolean {
  const trimmed = (value || '').trim();
  if (!trimmed) return false;
  if (trimmed === '::1' || trimmed === '127.0.0.1') return true;
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice('::ffff:'.length).trim() === '127.0.0.1';
  }
  return false;
}

export function normalizeForcedTargetId(value: unknown): number | null {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value.trim())
      : NaN;
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

type TesterRequestInput = {
  headers?: Record<string, unknown>;
  clientIp?: string | null;
};

export function isTrustedTesterRequest(input?: TesterRequestInput): boolean {
  if (!input) return false;
  if (!isLoopbackClientIp(input.clientIp)) return false;
  return headerValueEquals(input.headers, TESTER_REQUEST_HEADER, '1');
}

export function getTesterForcedTargetId(input?: TesterRequestInput): number | null {
  if (!isTrustedTesterRequest(input)) return null;
  const headers = input?.headers;
  if (!headers) return null;
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    if (rawKey.trim().toLowerCase() !== TESTER_FORCED_TARGET_HEADER) continue;
    return normalizeForcedTargetId(rawValue);
  }
  return null;
}

export function buildForcedTargetUnavailableMessage(forcedTargetId?: number | null): string {
  const normalizedForcedTargetId = normalizeForcedTargetId(forcedTargetId);
  if (normalizedForcedTargetId === null) {
    return 'No available targets for this model';
  }
  return `指定目标 #${normalizedForcedTargetId} 当前不可用，固定目标模式不会自动切换其他目标`;
}

export function canRetryTargetSelection(retryCount: number, forcedTargetId?: number | null): boolean {
  if (normalizeForcedTargetId(forcedTargetId) !== null) return false;
  return canRetryProxyTarget(retryCount);
}

export async function selectProxyTargetForAttempt(input: {
  requestedModel: string;
  downstreamPolicy: DownstreamRoutingPolicy;
  excludeTargetIds: number[];
  retryCount: number;
  stickySessionKey?: string | null;
  forcedTargetId?: number | null;
  routeExecutionScope?: RouteExecutionScope | null;
}): Promise<SelectedTarget> {
  const normalizedForcedTargetId = normalizeForcedTargetId(input.forcedTargetId);
  if (normalizedForcedTargetId !== null) {
    if (input.retryCount > 0) return null;
    return input.routeExecutionScope
      ? await tokenRouter.selectPreferredTargetWithinScope(
          input.routeExecutionScope,
          normalizedForcedTargetId,
          input.downstreamPolicy,
          input.excludeTargetIds,
        )
      : await tokenRouter.selectPreferredTarget(
          input.requestedModel,
          normalizedForcedTargetId,
          input.downstreamPolicy,
          input.excludeTargetIds,
        );
  }

  let selected: SelectedTarget = null;
  let refreshedRoutes = false;

  const refreshRoutesForFirstAttempt = async (): Promise<boolean> => {
    if (input.retryCount > 0 || refreshedRoutes) return false;
    refreshedRoutes = true;
    try {
      await routeRefreshWorkflow.refreshModelsAndRebuildRoutes();
      return true;
    } catch (error) {
      console.warn('[proxy/surface] failed to refresh routes after empty selection', error);
      return false;
    }
  };

  if (input.retryCount === 0 && input.stickySessionKey) {
    const preferredTargetId = proxyTargetCoordinator.getStickyTargetId(input.stickySessionKey);
    if (preferredTargetId && !input.excludeTargetIds.includes(preferredTargetId)) {
      selected = input.routeExecutionScope
        ? await tokenRouter.selectPreferredTargetWithinScope(
            input.routeExecutionScope,
            preferredTargetId,
            input.downstreamPolicy,
            input.excludeTargetIds,
          )
        : await tokenRouter.selectPreferredTarget(
            input.requestedModel,
            preferredTargetId,
            input.downstreamPolicy,
            input.excludeTargetIds,
          );
      if (!selected) {
        const refreshSucceeded = await refreshRoutesForFirstAttempt();
        selected = input.routeExecutionScope
          ? await tokenRouter.selectPreferredTargetWithinScope(
              input.routeExecutionScope,
              preferredTargetId,
              input.downstreamPolicy,
              input.excludeTargetIds,
            )
          : await tokenRouter.selectPreferredTarget(
              input.requestedModel,
              preferredTargetId,
              input.downstreamPolicy,
              input.excludeTargetIds,
            );
        if (!selected && refreshSucceeded) {
          proxyTargetCoordinator.clearStickyTarget(input.stickySessionKey, preferredTargetId);
        }
      }
    }
  }

  if (!selected) {
    selected = input.retryCount === 0
      ? await tokenRouter.selectTarget(input.requestedModel, input.downstreamPolicy)
      : input.routeExecutionScope
        ? await tokenRouter.selectNextTargetWithinScope(
            input.routeExecutionScope,
            input.excludeTargetIds,
            input.downstreamPolicy,
          )
        : await tokenRouter.selectNextTarget(
            input.requestedModel,
            input.excludeTargetIds,
            input.downstreamPolicy,
          );
  }

  if (!selected && input.retryCount === 0 && !refreshedRoutes) {
    await refreshRoutesForFirstAttempt();
    selected = await tokenRouter.selectTarget(input.requestedModel, input.downstreamPolicy);
  }

  return selected;
}
