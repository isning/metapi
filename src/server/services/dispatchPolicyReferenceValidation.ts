import type { DispatchPolicyRegistry } from './dispatchPolicyTypes.js';
import { validateDispatchPolicyRegistry } from './dispatchPolicyService.js';

type RecordValue = Record<string, unknown>;

export type DispatchPolicyReferenceDiagnostic = {
  severity: 'error';
  code: 'route_graph.dispatch_policy_reference';
  message: string;
  policyId: string;
  ownerKind: 'node' | 'macro' | 'fallback_stage';
  ownerId: string;
  nodeId?: string;
};

function record(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function referencedPolicyId(value: unknown): string | null {
  const policy = record(value);
  return policy?.kind === 'registry' && text(policy.policyId)
    ? text(policy.policyId)
    : null;
}

export function validateRouteGraphDispatchPolicies(
  sourceGraph: unknown,
  registry: DispatchPolicyRegistry,
): DispatchPolicyReferenceDiagnostic[] {
  const source = record(sourceGraph);
  if (!source) return [];
  const available = new Set(registry.policies.map((policy) => policy.id));
  const diagnostics: DispatchPolicyReferenceDiagnostic[] = [];
  const inspect = (
    value: unknown,
    ownerKind: DispatchPolicyReferenceDiagnostic['ownerKind'],
    ownerId: string,
    nodeId?: string,
  ) => {
    const policy = record(value);
    if (policy?.kind === 'inline') {
      const definition = record(policy.policy);
      const inlineId = text(definition?.id) || `inline:${ownerId}`;
      const validation = validateDispatchPolicyRegistry({
        defaultPolicyId: inlineId,
        policies: [{ ...(definition || {}), id: inlineId }],
      });
      for (const error of validation.errors) {
        diagnostics.push({
          severity: 'error',
          code: 'route_graph.dispatch_policy_reference',
          message: `${ownerKind} ${ownerId} has an invalid inline dispatch policy. ${error}`,
          policyId: inlineId,
          ownerKind,
          ownerId,
          ...(nodeId ? { nodeId } : {}),
        });
      }
      return;
    }
    const policyId = referencedPolicyId(value);
    if (!policyId || available.has(policyId)) return;
    diagnostics.push({
      severity: 'error',
      code: 'route_graph.dispatch_policy_reference',
      message: `${ownerKind} ${ownerId} references unavailable dispatch policy ${policyId}.`,
      policyId,
      ownerKind,
      ownerId,
      ...(nodeId ? { nodeId } : {}),
    });
  };

  for (const rawNode of Array.isArray(source.nodes) ? source.nodes : []) {
    const node = record(rawNode);
    if (!node) continue;
    const nodeId = text(node.id) || 'unknown';
    if (node.type === 'dispatcher') inspect(node.policy, 'node', nodeId, nodeId);
    if (node.type === 'route_endpoint') {
      inspect(record(node.config)?.targetSelection, 'node', nodeId, nodeId);
    }
  }

  for (const rawMacro of Array.isArray(source.macros) ? source.macros : []) {
    const macro = record(rawMacro);
    const config = record(macro?.config);
    if (!macro || !config) continue;
    const macroId = text(macro.id) || 'unknown';
    inspect(config.policy, 'macro', macroId);
    for (const rawStage of Array.isArray(config.groups) ? config.groups : []) {
      const stage = record(rawStage);
      if (!stage) continue;
      inspect(stage.policy, 'fallback_stage', text(stage.id) || 'unknown');
    }
  }
  return diagnostics;
}
