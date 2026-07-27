import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('route management route composition', () => {
  it('keeps the composition root free of endpoint and domain ownership', () => {
    const source = readSource('./tokens.ts');
    expect(source).toContain('registerRouteGraphRoutes(app)');
    expect(source).toContain('registerRouteGroupRoutes(app)');
    expect(source).not.toContain("'/api/");
    expect(source).not.toContain('CommandService');
    expect(source).not.toContain('ManagementService');
    expect(source).not.toContain('../../db/');
  });

  it('keeps Graph and Route Group adapters mutually independent', () => {
    const graph = readSource('./routeGraphRoutes.ts');
    const groups = readSource('./routeGroupRoutes.ts');
    expect(graph).not.toContain('/api/route-groups');
    expect(graph).not.toContain('RouteGroup');
    expect(groups).not.toContain('/api/route-graph/workspace');
    expect(groups).not.toContain('routeGraphWorkspace');
  });

  it('keeps Graph contracts free of Route Group facade fields and owns projection in the facade', () => {
    const endpointCatalogContract = readSource('../../../shared/routeEndpointCatalog.d.ts');
    const endpointCatalog = readSource('../../services/routeGraphEndpointCatalogService.ts');
    const runtimeFacts = readSource('../../services/runtimeExecutionTargetFactsService.ts');
    const facadeProjection = readSource('../../services/routeGroupManagementProjectionService.ts');

    expect(endpointCatalogContract).not.toMatch(/routeGroup/i);
    expect(endpointCatalog).not.toMatch(/routeGroup/i);
    expect(runtimeFacts).not.toMatch(/routeGroup/i);
    expect(runtimeFacts).not.toContain('ManagementProjectionService');
    expect(facadeProjection).toContain('routeGroupManagement.js');
    expect(facadeProjection).toContain('runtimeExecutionTargetFactsService.js');
    expect(existsSync(new URL('../../services/routeGraphManagementProjectionService.ts', import.meta.url))).toBe(false);
    expect(existsSync(new URL('../../services/routeGraphExecutionTargetFactsService.ts', import.meta.url))).toBe(false);
  });

  it('uses shared strict Graph workspace command contracts across server and web', () => {
    const shared = readSource('../../../shared/routeGraphOperations.d.ts');
    const contract = readSource('../../contracts/routeManagementPayloads.ts');
    const api = readSource('../../../web/api.ts');
    const workspace = readSource('../../../web/pages/token-routes/RouteGraphWorkspaceView.tsx');
    const jsonWorkspace = readSource('../../../web/pages/token-routes/RouteGraphJsonWorkbench.tsx');

    for (const typeName of [
      'RouteGraphWorkspaceOperationsCommand',
      'RouteGraphWorkspaceNodeCreateCommand',
      'RouteGraphWorkspaceMacroCreateCommand',
      'RouteGraphWorkspaceConnectionCreateCommand',
      'RouteGraphWorkspaceValidationResponse',
      'RouteGraphAuthoringCommand',
    ]) {
      expect(shared).toContain(`export type ${typeName}`);
      expect(api).toContain(typeName);
    }
    expect(contract).toContain("from '../../shared/routeGraphOperations.js'");
    expect(api).not.toContain('applyRouteGraphWorkspaceOperations: (payload: unknown)');
    expect(api).not.toContain('operations: unknown[]');
    expect(api).not.toMatch(/createRouteGraphWorkspace(Node|Macro): \(payload: \{[\s\S]{0,160}Record<string, unknown>/);
    expect(workspace).not.toContain('validateRouteGraphWorkspace({ revision: workspace.revision, operations }) as any');
    expect(jsonWorkspace).not.toContain('api.validateRouteGraph(parsed) as');
    expect(jsonWorkspace).not.toContain('api.saveRouteGraphDraft(parsed) as');
  });

  it('keeps Graph and Route Group command errors structured and client-localized', () => {
    const graphRoutes = readSource('./routeGraphRoutes.ts');
    const groupRoutes = readSource('./routeGroupRoutes.ts');
    const graphErrors = readSource('../../../web/pages/token-routes/routeGraphConnectionErrors.ts');
    const graphWorkspace = readSource('../../../web/pages/token-routes/RouteGraphWorkspaceView.tsx');

    expect(graphRoutes).not.toContain('success: false, message');
    expect(graphRoutes).not.toContain('message: parsed.error');
    expect(groupRoutes).not.toContain('success: false, message');
    expect(groupRoutes).not.toContain('message: parsed.error');
    expect(graphErrors).toContain("typeof (error as { code?: unknown }).code === 'string'");
    expect(graphWorkspace).toContain('routeGraphCommandErrorMessage');
    expect(graphWorkspace).not.toMatch(/\(error as Error\)\.message \|\| tr\('pages\.tokenRoutes/);
  });
});
