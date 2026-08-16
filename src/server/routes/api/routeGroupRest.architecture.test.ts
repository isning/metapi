import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n');
}

describe('route group REST API boundaries', () => {
  it('keeps route group resources off the legacy /api/routes namespace', () => {
    const routes = source('src/server/routes/api/routeGroupRoutes.ts');
    const compositionRoot = source('src/server/routes/api/tokens.ts');

    expect(routes).toMatch(/["']\/api\/route-groups["']/);
    expect(routes).toMatch(/["']\/api\/route-groups\/:id\/candidates["']/);
    expect(routes).not.toContain("'/api/route-groups/:id/targets'");
    expect(routes).not.toContain("'/api/route-graph/endpoint-targets");
    expect(routes).not.toContain("'/api/routes'");
    expect(routes).not.toContain('"/api/routes"');
    expect(routes).not.toContain('/api/routes/decision');
    expect(compositionRoot).not.toContain('/api/route-groups');
    expect(compositionRoot).toContain('registerRouteGroupRoutes');
  });

  it('uses the dedicated route-group write contract instead of token-route or graph payloads', () => {
    const routes = source('src/server/routes/api/routeGroupRoutes.ts');
    const contract = source('src/server/contracts/routeGroupPayloads.ts');

    expect(routes).toMatch(/from ["']\.\.\/\.\.\/contracts\/routeGroupPayloads\.js["']/);
    expect(routes).not.toContain('parseTokenRouteCreatePayload');
    expect(routes).not.toContain('parseTokenRouteUpdatePayload');
    expect(routes).not.toContain('parseTokenRouteBatchPayload');
    expect(contract).toContain('model: modelSchema');
    expect(contract).toContain('sourceSelectionSchema');
    expect(contract).toContain('sources: z.array(sourceReferenceSchema)');
    expect(contract).toMatch(/kind: z\.literal\(["']execution_target["']\)/);
    expect(contract).toContain('sourceRef: z.string().uuid()');
    expect(contract).not.toMatch(/kind: z\.literal\(["']execution_target["']\)[\s\S]{0,120}id: z\.number/);
    expect(contract).toMatch(/kind: z\.literal\(["']route_group["']\)/);
    expect(contract).not.toContain('endpointIds: z.array');
    expect(contract).not.toContain('sourceEndpointIds');
    expect(contract).not.toContain('routingStrategy');
    expect(contract).not.toContain('bucketId');
  });

  it('uses one opaque candidate source reference from catalog through mutation', () => {
    const contract = source('src/server/contracts/routeManagementPayloads.ts');
    const candidateService = source('src/server/services/routeGroupCandidateService.ts');
    const candidateCommands = source('src/server/services/routeGroupCandidateCommandService.ts');
    const shared = source('src/shared/routeGroupManagement.d.ts');
    const picker = source('src/web/pages/token-routes/RouteGroupCandidatePicker.tsx');
    const api = source('src/web/api.ts');

    expect(contract).toContain('sourceRef: z.string().uuid()');
    expect(contract).toContain('sourceRefs: z.array(z.string().uuid())');
    expect(candidateService).toContain('schema.runtimeExecutionTargets.sourceRef');
    expect(candidateCommands).toContain('sourceRef: input.sourceRef');
    expect(shared).toContain('sourceRef: string');
    expect(picker).toContain('.map((item) => item.sourceRef)');
    expect(picker).not.toMatch(/accountId:\s*item\.accountId|tokenId:\s*item\.tokenId|sourceModel:\s*item\.sourceModel/);
    expect(api).not.toContain('addRouteGroupCandidate: (routeGroupId: string, data: any)');
    expect(api).not.toContain('updateRouteGroup: (id: string, data: any)');
  });

  it('exposes management source selection as route-group references, not graph endpoints', () => {
    const routes = source('src/server/routes/api/routeGroupRoutes.ts');
    const management = source('src/server/services/routeGroupManagementService.ts');
    const api = source('src/web/api.ts');

    expect(routes).toMatch(/["']\/api\/route-groups\/sources["']/);
    expect(routes).toContain('listRouteGroupSourceCatalog');
    expect(management).toContain('export async function listRouteGroupSourceCatalog');
    expect(management).toMatch(/kind: ["']execution_target["']/);
    expect(management).toMatch(/kind: ["']route_group["']/);
    expect(api).toContain('getRouteGroupSourceCatalog');
  });

  it('projects Route Group reads from the management contract rather than a Graph-shaped DTO', () => {
    const routes = source('src/server/routes/api/routeGroupRoutes.ts');
    const management = source('src/server/services/routeGroupManagementService.ts');
    const projection = source('src/server/services/routeSummaryProjectionService.ts');
    const api = source('src/web/api.ts');

    expect(routes).toContain('loadRouteGroupManagementReadModel');
    expect(routes).not.toContain('loadRouteGroupSummaryReadModel');
    expect(management).toContain('loadRouteGroupManagementSummaries');
    expect(management).not.toContain('routeBuilderMacroId');
    expect(management).not.toContain('sourceEndpointIds');
    expect(projection).not.toContain('routeBuilderMacroId');
    expect(projection).not.toContain('sourceEndpointIds');
    expect(projection).not.toContain('route-endpoint');
    expect(api).toContain('normalizePagedResponse<RouteGroupManagementListItem>');
    expect(api).not.toContain('getRouteGroupPage: <T = any>');
  });

  it('keeps retired candidate snapshot storage removed from the Route Group facade', () => {
    const candidateTypes = source('src/shared/routeGroupManagement.d.ts');

    expect(existsSync(resolve(process.cwd(), 'src/server/services/routeGroupCandidateSnapshotService.ts'))).toBe(false);
    expect(candidateTypes).not.toContain('routeEndpointId?:');
  });

  it('keeps model route projections under model resources', () => {
    const stats = source('src/server/routes/api/stats.ts');
    const api = source('src/web/api.ts');

    expect(stats).toContain('"/api/models/:id/route-flow"');
    expect(api).toContain('/api/models/${encodeURIComponent(model)}/route-flow');
    expect(stats).not.toContain('"/api/models/:id/routing-candidates"');
    expect(api).not.toContain('/api/models/${encodeURIComponent(model)}/routing-candidates');
    expect(api).not.toContain('getModelRoutingCandidates');
    expect(stats).not.toContain('/api/models/route-flow?model');
    expect(api).not.toContain('/api/models/route-flow?model');
  });

  it('keeps failure-state management scoped to route groups rather than graph endpoints', () => {
    const routes = source('src/server/routes/api/routeGroupRoutes.ts');
    const api = source('src/web/api.ts');

    expect(routes).toMatch(/["']\/api\/route-groups\/:id\/failure-state["']/);
    expect(api).toContain('/api/route-groups/${encodeURIComponent(routeGroupId)}/failure-state');
    expect(routes).not.toContain("'/api/route-graph/endpoints/:id/failure-state'");
    expect(api).not.toContain('/api/route-graph/endpoints/${encodeURIComponent(endpointId)}/failure-state');
  });

  it('forwards candidate failure-backoff updates through the HTTP adapter', () => {
    const routes = source('src/server/routes/api/routeGroupRoutes.ts');

    expect(routes).toContain('parsed.data.failureBackoff !== undefined');
    expect(routes).toContain('{ failureBackoff: parsed.data.failureBackoff }');
  });

  it('keeps localized policy and background-task construction out of the Route Group adapter', () => {
    const routes = source('src/server/routes/api/routeGroupRoutes.ts');
    const candidateService = source('src/server/services/routeGroupCandidateService.ts');

    expect(routes).not.toMatch(/[\u3400-\u9fff]/);
    expect(routes).not.toContain('startBackgroundTask');
    expect(routes).not.toContain('appendBackgroundTaskLog');
    expect(routes).not.toContain('successMessageI18n');
    expect(routes).not.toMatch(/\.message\s*===|\.message\.includes/);
    expect(candidateService).not.toMatch(/[\u3400-\u9fff]/);
  });
});
