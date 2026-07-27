import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

describe('dispatch policy and runtime cache route ownership', () => {
  it('keeps settings free of policy simulation and runtime cache workflows', () => {
    const settings = source('./settings.ts');
    expect(settings).not.toContain('/api/settings/dispatch-policies');
    expect(settings).not.toContain('loadCompiledRuntimeDispatchSimulationScopes');
    expect(settings).not.toContain('simulateDispatchPolicy(');
    expect(settings).not.toContain('/api/settings/route-runtime-cache');
    expect(settings).not.toContain('getRouteRuntimeCacheStats');
    expect(settings).not.toContain('getActiveRouteRuntimeArtifact');
  });

  it('keeps dedicated HTTP adapters limited to parse and delegate responsibilities', () => {
    const policyRoute = source('./dispatchPolicyRoutes.ts');
    expect(policyRoute).toContain('parseDispatchPolicySimulationCommand');
    expect(policyRoute).toContain('simulateDispatchPolicyCommand');
    expect(policyRoute).not.toContain('loadCompiledRuntimeDispatchSimulationScopes');
    expect(policyRoute).not.toContain('estimateRuntimeSelectorProbabilities');

    const runtimeRoute = source('./routeRuntimeRoutes.ts');
    expect(runtimeRoute).toContain('requestRouteRuntimeCacheRefresh');
    expect(runtimeRoute).not.toContain('startBackgroundTask');
    expect(runtimeRoute).not.toContain('invalidateRouteRuntimeCaches');
  });
});
