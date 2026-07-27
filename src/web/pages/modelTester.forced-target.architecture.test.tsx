import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ModelTester forced channel architecture', () => {
  it('wires forced execution attempts through compiled runtime route-flow only', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/pages/ModelTester.tsx'), 'utf8').replace(/\r\n/g, '\n');

    expect(source).toContain("tr('pages.modelTester.forcedExecutionAttempt')");
    expect(source).toContain('api.getModelRouteFlow(inputs.model, {');
    expect(source).toContain('request: routeFlowRuntimeRequest');
    expect(source).toContain('routeFlow?.compiledRuntime?.executionAttempts');
    expect(source).not.toContain('api.getRouteGroupPage');
    expect(source).not.toContain('api.getModelRoutingCandidates');
    expect(source).toContain('forcedExecutionAttemptId');
    expect(source).toContain('attachForcedExecutionAttemptToEnvelope');
    expect(source).not.toContain('forcedCandidateId');
    expect(source).not.toContain('attachForcedCandidateToEnvelope');
  });
});
