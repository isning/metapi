import type {
  DispatchPolicySimulationCommand,
  DispatchPolicySimulationScopeSummary,
  DispatchPolicySimulationResult,
  DispatchPolicyValidationCommand,
} from '../../shared/dispatchPolicyApi.js';
import { validateDispatchPolicyRegistry } from './dispatchPolicyService.js';
import {
  loadCompiledRuntimeDispatchSimulationScopes,
  simulateDispatchPolicy,
} from './dispatchPolicySimulationService.js';
import { RuntimeSelectorPolicyEvaluationError } from './selectorEngine.js';

export class DispatchPolicyToolingError extends Error {
  constructor(
    readonly code: 'selector_required' | 'selector_unavailable' | 'evaluation_failed',
    message: string,
    readonly scopes: DispatchPolicySimulationScopeSummary[] = [],
  ) {
    super(message);
    this.name = 'DispatchPolicyToolingError';
  }
}

function runSimulation(input: Parameters<typeof simulateDispatchPolicy>[0]): DispatchPolicySimulationResult {
  try {
    return simulateDispatchPolicy(input);
  } catch (error) {
    if (error instanceof RuntimeSelectorPolicyEvaluationError) {
      throw new DispatchPolicyToolingError('evaluation_failed', error.message);
    }
    throw error;
  }
}

export function validateDispatchPolicyCommand(input: DispatchPolicyValidationCommand) {
  const validation = validateDispatchPolicyRegistry({
    defaultPolicyId: 'candidate',
    policies: [{ ...input.policy, id: 'candidate' }],
  });
  return validation.value
    ? { success: true as const, errors: [] }
    : { success: false as const, errors: validation.errors };
}

function scopeSummaries(
  scopes: Awaited<ReturnType<typeof loadCompiledRuntimeDispatchSimulationScopes>>,
): DispatchPolicySimulationScopeSummary[] {
  return scopes.map((scope) => ({
    selectorId: scope.selectorId,
    mode: scope.mode,
    optionCount: scope.options.length,
  }));
}

export async function simulateDispatchPolicyCommand(input: {
  command: DispatchPolicySimulationCommand;
  requestKnown: boolean;
}): Promise<{
  success: true;
  selectorId?: string;
  scopes: DispatchPolicySimulationScopeSummary[];
  simulation?: DispatchPolicySimulationResult;
}> {
  const command = input.command;
  if (command.mode === 'synthetic') {
    return {
      success: true,
      selectorId: 'synthetic',
      scopes: [],
      simulation: runSimulation({
        policy: command.policy,
        options: command.options,
        request: command.request,
        requestKnown: input.requestKnown,
      }),
    };
  }

  const scopes = await loadCompiledRuntimeDispatchSimulationScopes({
    model: command.model,
    request: command.request,
    requestKnown: input.requestKnown,
  });
  const summaries = scopeSummaries(scopes);
  if (command.inspectOnly) return { success: true, scopes: summaries };
  if (!command.selectorId) {
    throw new DispatchPolicyToolingError('selector_required', 'selectorId is required', summaries);
  }
  const scope = scopes.find((item) => item.selectorId === command.selectorId);
  if (!scope) {
    throw new DispatchPolicyToolingError('selector_unavailable', 'selector scope is not available', summaries);
  }
  return {
    success: true,
    selectorId: scope.selectorId,
    scopes: summaries,
    simulation: runSimulation({
      policy: command.policy,
      options: scope.options,
      request: command.request,
      requestKnown: input.requestKnown,
      runtimeCandidates: scope.runtimeCandidates,
    }),
  };
}
