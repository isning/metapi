import type { ProxyConductorDependencies } from './types.js';

export async function recordSuccessfulAttempt(
  deps: ProxyConductorDependencies,
  targetId: number,
  metrics: { latencyMs?: number | null; cost?: number | null },
): Promise<void> {
  await deps.recordSuccess?.(targetId, {
    latencyMs: metrics.latencyMs ?? null,
    cost: metrics.cost ?? null,
  });
}

export async function recordFailedAttempt(
  deps: ProxyConductorDependencies,
  targetId: number,
  failure: { status?: number; rawErrorText?: string },
): Promise<void> {
  await deps.recordFailure?.(targetId, failure);
}
