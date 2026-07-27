import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const executionService = readFileSync(
  new URL('./routeRuntimeExecutionService.ts', import.meta.url),
  'utf8',
);
const sharedOrchestration = readFileSync(
  new URL('../proxy-core/orchestration/sharedProxyOrchestration.ts', import.meta.url),
  'utf8',
);

describe('compiled runtime Route Unit boundary', () => {
  it('keeps Route Unit control-plane selection out of proxy execution', () => {
    expect(executionService).not.toMatch(/oauthRouteUnitMembers|oauthRouteUnits|chooseRouteUnitMember|routeUnitMember/);
    expect(sharedOrchestration).not.toMatch(/oauthRouteUnitMember|routeUnitMember/);
  });
});
