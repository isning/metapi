import type {
  DispatchPolicyDefinition,
  DispatchPolicyRef,
  DispatchPolicyRegistry,
  DispatchSelectionMode,
} from '../../shared/dispatchPolicyApi.js';

export type {
  DispatchPolicyDefinition,
  DispatchPolicyRef,
  DispatchPolicyRegistry,
  DispatchSelectionMode,
} from '../../shared/dispatchPolicyApi.js';

export const DEFAULT_DISPATCH_POLICY: DispatchPolicyDefinition = {
  id: 'platform-default',
  name: 'Platform default',
  kind: 'cel',
  selectionMode: 'weighted',
  contributionExpression: '(runtime.routingSignals.normalizedCostScore != null ? 0.40 : 0.0) + (runtime.routingSignals.normalizedBalanceScore != null ? 0.30 : 0.0) + (runtime.routingSignals.normalizedUsageScore != null ? 0.30 : 0.0) > 0.0 ? ((runtime.routingSignals.normalizedCostScore != null ? 0.40 * runtime.routingSignals.normalizedCostScore : 0.0) + (runtime.routingSignals.normalizedBalanceScore != null ? 0.30 * runtime.routingSignals.normalizedBalanceScore : 0.0) + (runtime.routingSignals.normalizedUsageScore != null ? 0.30 * runtime.routingSignals.normalizedUsageScore : 0.0)) / ((runtime.routingSignals.normalizedCostScore != null ? 0.40 : 0.0) + (runtime.routingSignals.normalizedBalanceScore != null ? 0.30 : 0.0) + (runtime.routingSignals.normalizedUsageScore != null ? 0.30 : 0.0)) : 1.0',
};

export function defaultDispatchPolicyRegistry(): DispatchPolicyRegistry {
  return {
    defaultPolicyId: DEFAULT_DISPATCH_POLICY.id,
    policies: [DEFAULT_DISPATCH_POLICY],
  };
}
