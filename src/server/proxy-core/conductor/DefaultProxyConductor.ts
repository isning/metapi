import {
  failureActionOf,
  isTerminalFailure,
  shouldFailover,
  shouldRefreshAuth,
  shouldRetrySameTarget,
} from './retryPolicy.js';
import type { ExecuteInput, ExecuteResult, ProxyConductorDependencies, SelectedTargetLike } from './types.js';
import { recordFailedAttempt, recordSuccessfulAttempt } from './usageHooks.js';

export class DefaultProxyConductor {
  constructor(private readonly deps: ProxyConductorDependencies) {}

  async previewSelectedTarget(requestedModel: string, downstreamPolicy?: unknown): Promise<SelectedTargetLike | null> {
    if (this.deps.previewSelectedTarget) {
      return this.deps.previewSelectedTarget(requestedModel, downstreamPolicy);
    }
    return this.deps.selectTarget(requestedModel, downstreamPolicy);
  }

  async execute(input: ExecuteInput): Promise<ExecuteResult> {
    const excludeTargetIds: number[] = [];
    let attempts = 0;
    let selected = await this.deps.selectTarget(input.requestedModel, input.downstreamPolicy);
    if (!selected) {
      return {
        ok: false,
        reason: 'no_target',
        attempts: 0,
      };
    }

    while (selected) {
      const result = await input.attempt({
        selected,
        attemptIndex: attempts,
        excludeTargetIds: [...excludeTargetIds],
      });
      attempts += 1;

      if (result.ok) {
        await recordSuccessfulAttempt(this.deps, selected.target.id, {
          latencyMs: result.latencyMs ?? null,
          cost: result.cost ?? null,
        });
        return {
          ok: true,
          selected,
          response: result.response,
          attempts,
        };
      }

      const action = failureActionOf(result);
      await recordFailedAttempt(this.deps, selected.target.id, {
        status: result.status,
        rawErrorText: result.rawErrorText,
      });

      if (isTerminalFailure(action)) {
        await input.onTerminalFailure?.(selected, {
          status: result.status,
          rawErrorText: result.rawErrorText,
        });
        return {
          ok: false,
          reason: 'terminal',
          selected,
          status: result.status,
          rawErrorText: result.rawErrorText,
          attempts,
        };
      }

      if (shouldRetrySameTarget(action)) {
        continue;
      }

      if (shouldRefreshAuth(action) && this.deps.refreshAuth) {
        const refreshed = await this.deps.refreshAuth(selected, {
          status: result.status,
          rawErrorText: result.rawErrorText,
        });
        if (refreshed) {
          selected = refreshed;
          continue;
        }
      }

      if (shouldFailover(action)) {
        excludeTargetIds.push(selected.target.id);
        const next = await this.deps.selectNextTarget(
          input.requestedModel,
          excludeTargetIds,
          input.downstreamPolicy,
        );
        if (!next) {
          return {
            ok: false,
            reason: 'failed',
            selected,
            status: result.status,
            rawErrorText: result.rawErrorText,
            attempts,
          };
        }
        selected = next;
        continue;
      }

      return {
        ok: false,
        reason: 'failed',
        selected,
        status: result.status,
        rawErrorText: result.rawErrorText,
        attempts,
      };
    }

    return {
      ok: false,
      reason: 'failed',
      attempts,
    };
  }
}
