import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('Route Group management read-model boundaries', () => {
  it('separates stable catalog projection from volatile target health', () => {
    const readModel = source('./routeGroupManagementReadModelService.ts');
    const detail = source('./routeGroupFallbackStageService.ts');
    const catalog = source('./runtimeExecutionTargetFactsService.ts');
    const runtimeHealth = source('./routeRuntimeExecutionService.ts');

    expect(readModel).toContain('loadRuntimeExecutionTargetCatalogFacts');
    expect(readModel).toContain('loadRouteGroupManagementCatalogRevision');
    expect(readModel).not.toContain('runtimeExecutionTargetState');
    expect(readModel).not.toContain('loadRuntimeExecutionTargetFacts');
    expect(readModel).not.toMatch(/count\(\*\)|max\(/);
    expect(detail).toContain('loadRuntimeExecutionTargetFacts(executionTargetIds)');
    expect(detail).not.toContain('loadRuntimeExecutionTargetFacts()');
    expect(catalog).toContain('loadRuntimeExecutionTargetCatalogFactPage');
    expect(runtimeHealth).not.toContain('RouteGroupManagementCatalogRevision');
    expect(runtimeHealth).not.toContain('advanceRouteGroupManagementCatalogRevision');
  });
});
