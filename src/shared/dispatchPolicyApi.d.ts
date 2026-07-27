import type { CompiledRouteRuntimeRequest } from './compiledRuntimeRequest.js';

export type DispatchSelectionMode = 'weighted' | 'ordered' | 'round_robin' | 'direct';

export type DispatchPolicyDefinition = {
  id: string;
  name: string;
  kind: 'cel' | 'builtin';
  selectionMode: DispatchSelectionMode;
  eligibilityExpression?: string;
  contributionExpression?: string;
  orderExpression?: string;
  selectExpression?: string;
  builtin?: 'weighted' | 'round_robin' | 'stable_first';
};

export type DispatchPolicyRegistry = {
  defaultPolicyId: string;
  policies: DispatchPolicyDefinition[];
};

export type DispatchPolicyRef =
  | { kind: 'inherit_default' }
  | { kind: 'registry'; policyId: string }
  | { kind: 'inline'; policy: DispatchPolicyDefinition }
  | { kind: 'builtin'; builtin: 'weighted' | 'round_robin' | 'stable_first' };

export type DispatchPolicySimulationOption = {
  id: string;
  label?: string;
  enabled?: boolean;
  weight?: number;
  order?: number;
  runtime?: Record<string, unknown>;
  selection?: Record<string, unknown>;
  endpoint?: Record<string, unknown>;
  executionAttempt?: Record<string, unknown>;
  plan?: Record<string, unknown>;
  graph?: Record<string, unknown>;
};

export type DispatchPolicyValidationCommand = { policy: DispatchPolicyDefinition };

export type DispatchPolicySimulationCommand =
  | {
      mode: 'synthetic';
      policy: DispatchPolicyRef;
      options: DispatchPolicySimulationOption[];
      request?: CompiledRouteRuntimeRequest;
    }
  | {
      mode: 'compiled_runtime';
      inspectOnly: true;
      policy: DispatchPolicyRef;
      model: string;
      request?: CompiledRouteRuntimeRequest;
    }
  | {
      mode: 'compiled_runtime';
      inspectOnly?: false;
      policy: DispatchPolicyRef;
      model: string;
      selectorId: string;
      request?: CompiledRouteRuntimeRequest;
    };

export type DispatchPolicySimulationScopeSummary = {
  selectorId: string;
  mode: string;
  optionCount: number;
};

export type DispatchPolicySimulationResult = {
  strategy: string;
  selectionMode: string | null;
  selectedOptionId: string | null;
  options: Array<{
    id: string;
    label: string;
    eligible: boolean;
    contribution: number;
    order: number;
    score: number;
    probability: number | null;
  }>;
};
