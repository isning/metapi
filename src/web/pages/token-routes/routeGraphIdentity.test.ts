import { describe, expect, it } from 'vitest';
import { createRouteMacroSemanticNodeId } from '../../../shared/routingIdentity.js';
import { createRouteGraphMacroFlowNodeId } from './routeGraphIdentity.js';

describe('routeGraphIdentity', () => {
  it('uses the shared semantic identity for macro flow nodes', () => {
    expect(createRouteGraphMacroFlowNodeId('Manual Macro / A')).toBe(
      createRouteMacroSemanticNodeId('Manual Macro / A'),
    );
  });
});
