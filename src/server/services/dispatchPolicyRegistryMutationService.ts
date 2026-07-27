import { config } from '../config.js';
import { upsertSetting } from '../db/upsertSetting.js';
import { validateDispatchPolicyRegistry } from './dispatchPolicyService.js';
import { validatePersistedRouteGraphPolicyReferences } from './dispatchPolicyRegistryIntegrityService.js';
import { invalidateRouteGraphReadCaches } from './routeGraphService.js';
import type { DispatchPolicyRegistry } from './dispatchPolicyTypes.js';

export class DispatchPolicyRegistryValidationError extends Error {
  constructor(readonly diagnostics: string[]) {
    super(diagnostics.join(' '));
    this.name = 'DispatchPolicyRegistryValidationError';
  }
}

export class DispatchPolicyRegistryConflictError extends Error {
  constructor(readonly diagnostics: unknown[]) {
    super('Dispatch policy registry is referenced by the route graph.');
    this.name = 'DispatchPolicyRegistryConflictError';
  }
}

export async function saveDispatchPolicyRegistry(input: unknown): Promise<DispatchPolicyRegistry> {
  const validation = validateDispatchPolicyRegistry(input);
  if (!validation.value) throw new DispatchPolicyRegistryValidationError(validation.errors);
  const diagnostics = await validatePersistedRouteGraphPolicyReferences(validation.value);
  if (diagnostics.length > 0) throw new DispatchPolicyRegistryConflictError(diagnostics);
  await upsertSetting('dispatch_policy_registry', validation.value);
  config.dispatchPolicyRegistry = validation.value;
  invalidateRouteGraphReadCaches('routing-weights-mutated');
  return validation.value;
}
