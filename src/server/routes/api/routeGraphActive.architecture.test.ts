import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

function readProjectFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function collectServerProductionSources(dir = resolve(process.cwd(), 'src/server')): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (path.endsWith('/db/generated')) continue;
      result.push(...collectServerProductionSources(path));
      continue;
    }
    if (!path.endsWith('.ts')) continue;
    if (path.endsWith('.test.ts') || path.endsWith('.architecture.test.ts')) continue;
    result.push(path);
  }
  return result;
}

describe('route graph and compiled runtime architecture', () => {
  it('keeps retired route-table storage out of production server code', () => {
    const allowedMigrationFiles = new Set([
      'src/server/services/backupImportMigration.ts',
    ]);
    const forbidden = [
      'schema.tokenRoutes',
      'schema.routeBindingProjections',
      'schema.routeGroupSources',
      'legacyRouteId',
      'sourceRouteIds',
      'entry:legacy',
      'createLegacyRouteStableId',
      'parseLegacyRoutingIdentity',
      'buildRouteGraphSourceFromRouteTable',
      'syncRouteBindingProjectionsFromRouteGraphSource',
    ];
    const offenders = collectServerProductionSources()
      .flatMap((path) => {
        const relativePath = relative(process.cwd(), path);
        if (allowedMigrationFiles.has(relativePath)) return [];
        const text = readFileSync(path, 'utf8');
        return forbidden
          .filter((pattern) => text.includes(pattern))
          .map((pattern) => `${relativePath}: ${pattern}`);
      });

    expect(offenders).toEqual([]);
  });

  it('keeps route group wrapper storage out of the route graph service', () => {
    const text = readProjectFile('src/server/services/routeGraphService.ts');
    expect(text).not.toMatch(/schema\.routeGroup(?:s|Candidates|FallbackStages)/);
    expect(text).not.toContain('schema.runtimeExecutionTargets');
    expect(text).not.toContain('listRouteEndpointCatalog');
    expect(text).not.toContain('createRouteGroupFromPayload');
  });

  it('keeps proxy runtime execution on compiled runtime artifacts instead of graph tables', () => {
    const runtimeText = readProjectFile('src/server/services/routeRuntimeExecutionService.ts');
    const proxyText = [
      readProjectFile('src/server/routes/proxy/router.ts'),
      readProjectFile('src/server/proxy-core/orchestration/genericProxyOrchestrator.ts'),
    ].join('\n');

    expect(runtimeText).toContain('evaluateCompiledRuntimeArtifact');
    expect(runtimeText).toContain('getActiveRouteRuntimeArtifact');
    expect(runtimeText).not.toMatch(/schema\.routeGroup(?:s|Candidates)/);
    expect(proxyText).not.toMatch(/schema\.routeGroup(?:s|Candidates)/);
  });

  it('keeps model marketplace inventory sourced from compiled runtime', () => {
    const statsText = readProjectFile('src/server/routes/api/stats.ts');
    const marketplaceStart = statsText.indexOf('"/api/models/marketplace"');
    const routeFlowStart = statsText.indexOf('"/api/models/:id/route-flow"', marketplaceStart);
    const marketplaceBlock = statsText.slice(marketplaceStart, routeFlowStart);

    expect(marketplaceStart).toBeGreaterThanOrEqual(0);
    expect(routeFlowStart).toBeGreaterThan(marketplaceStart);
    expect(marketplaceBlock).toContain('getModelsMarketplaceReadModel');
    expect(marketplaceBlock).not.toContain('listRouteEndpointCatalog');
    expect(marketplaceBlock).not.toContain('ensureActiveRouteGraphVersion');
    expect(marketplaceBlock).not.toContain('getActiveRouteGraphVersion');
  });

  it('keeps model usage aggregation out of the stats HTTP adapter', () => {
    const statsText = readProjectFile('src/server/routes/api/stats.ts');
    const endpointStart = statsText.indexOf('"/api/stats/model-by-site"');
    const endpointEnd = statsText.indexOf('\n  );', endpointStart);
    const endpointBlock = statsText.slice(endpointStart, endpointEnd);

    expect(endpointStart).toBeGreaterThanOrEqual(0);
    expect(endpointBlock).toContain('listModelUsageBySite');
    expect(endpointBlock).not.toContain('schema.modelDayUsage');
    expect(endpointBlock).not.toContain('runUsageAggregationProjectionPass');
  });

  it('uses runtime-native terminal vocabulary in persisted proxy-log snapshots', () => {
    const snapshotContract = readProjectFile('src/shared/routeRuntimeSnapshot.d.ts');
    const snapshotMapper = readProjectFile('src/server/services/routeRuntimeDecisionSnapshotService.ts');

    expect(snapshotContract).toContain("'endpoint' | 'synthetic_response' | null");
    expect(snapshotContract).not.toContain("'route_endpoint' | 'synthetic_endpoint'");
    expect(snapshotMapper).not.toContain("terminalKind !== 'route_endpoint'");
    expect(snapshotMapper).not.toContain("terminalKind !== 'synthetic_endpoint'");
  });
});
