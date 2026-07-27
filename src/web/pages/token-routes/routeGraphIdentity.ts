import { createRouteMacroSemanticNodeId } from '../../../shared/routingIdentity.js';

export function createRouteGraphMacroFlowNodeId(macroId: string): string {
  return createRouteMacroSemanticNodeId(macroId);
}

export function parseRouteGraphMacroFlowNodeId(nodeId: string): string | null {
  const prefix = 'macro:';
  if (!nodeId.startsWith(prefix)) return null;
  const macroId = nodeId.slice(prefix.length);
  return macroId || null;
}

export function isRouteGraphMacroFlowNodeId(nodeId: string): boolean {
  return parseRouteGraphMacroFlowNodeId(nodeId) !== null;
}
