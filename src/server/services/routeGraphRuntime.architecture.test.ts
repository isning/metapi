import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRuntimeSource(): string {
  return readFileSync(new URL('./routeGraphRuntimeService.ts', import.meta.url), 'utf8');
}

function readTokenRouterSource(): string {
  return readFileSync(new URL('./tokenRouter.ts', import.meta.url), 'utf8');
}

function readGenericProxyOrchestratorSource(): string {
  return readFileSync(new URL('../proxy-core/orchestration/genericProxyOrchestrator.ts', import.meta.url), 'utf8');
}

describe('route graph runtime architecture', () => {
  it('executes compiled router bundles without reconstructing the source graph', () => {
    const source = readRuntimeSource();

    expect(source).toContain('evaluateCompiledRouterBundle');
    expect(source).toContain('compiledRouterBundle');
    expect(source).toContain('random?: () => number');
    expect(source).toContain('random: input.random');
    expect(source).not.toContain('evaluateFlatRouteProgramBundle');
    expect(source).not.toContain('evaluateRouteProgramBundle');
    expect(source).not.toContain('flatProgramBundle');
    expect(source).not.toContain('programBundle');
    expect(source).toContain("from './selectorEngine.js'");
    expect(source).toContain('selectRuntimeCandidate');
    expect(source).not.toContain('Math.random');
    expect(source).not.toContain("from '../db/");
    expect(source).not.toContain("from '../routes/");
    expect(source).not.toContain("from '@bufbuild/cel'");
    expect(source).not.toContain('evaluateCompiledRouteGraphV2');
    expect(source).not.toContain('findRouteGraphEntryForModel');
    expect(source).not.toContain('graphSourceFromCompiled');
    expect(source).not.toContain('edgesByFromPort');
    expect(source).not.toContain('nodesById');
  });

  it('keeps request routing from bootstrapping or compiling an active graph', () => {
    const runtimeSource = readRuntimeSource();
    const tokenRouterSource = readTokenRouterSource();
    const orchestratorSource = readGenericProxyOrchestratorSource();

    expect(runtimeSource).toContain("from './routeGraphService.js'");
    expect(runtimeSource).toContain('getCachedActiveRouteGraphRuntimeVersion()');
    expect(runtimeSource).toContain('getActiveRouteGraphRuntimeVersion()');
    expect(runtimeSource).not.toContain('bootstrapIfMissing');
    expect(runtimeSource).not.toContain('ensureActiveRouteGraphVersion');
    expect(runtimeSource).not.toContain("await import('./routeGraphService.js')");
    expect(tokenRouterSource).toContain('evaluateActiveRouteGraphForModel(model)');
    expect(tokenRouterSource).not.toContain('bootstrapIfMissing');
    expect(orchestratorSource).toContain('evaluateActiveRouteGraphForModel(requestedModel)');
    expect(orchestratorSource).not.toContain('bootstrapIfMissing');
  });
});
