import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRuntimeSource(): string {
  return readFileSync(new URL('./routeGraphRuntimeService.ts', import.meta.url), 'utf8');
}

describe('route graph runtime architecture', () => {
  it('executes route programs instead of reconstructing the v2 compiled graph', () => {
    const source = readRuntimeSource();

    expect(source).toContain('evaluateRouteProgramBundle');
    expect(source).not.toContain('evaluateCompiledRouteGraphV2');
    expect(source).not.toContain('findRouteGraphEntryForModel');
    expect(source).not.toContain('graphSourceFromCompiled');
    expect(source).not.toContain('edgesByFromPort');
    expect(source).not.toContain('nodesById');
  });
});
