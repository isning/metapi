import type { DispatchPolicyRegistry } from './dispatchPolicyTypes.js';
import {
  getActiveRouteGraphSourceVersion,
  getRouteGraphDraft,
} from './routeGraphService.js';
import {
  validateRouteGraphDispatchPolicies,
  type DispatchPolicyReferenceDiagnostic,
} from './dispatchPolicyReferenceValidation.js';

export async function validatePersistedRouteGraphPolicyReferences(
  registry: DispatchPolicyRegistry,
): Promise<DispatchPolicyReferenceDiagnostic[]> {
  const [active, draft] = await Promise.all([
    getActiveRouteGraphSourceVersion(),
    getRouteGraphDraft(),
  ]);
  const diagnostics = [
    ...(active ? validateRouteGraphDispatchPolicies(active.sourceGraph, registry) : []),
    ...validateRouteGraphDispatchPolicies(draft.workingGraph, registry),
  ];
  return Array.from(new Map(diagnostics.map((item) => [
    `${item.ownerKind}:${item.ownerId}:${item.policyId}`,
    item,
  ])).values());
}
