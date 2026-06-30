import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n');
}

describe('route projection paging architecture', () => {
  it('keeps route projections behind explicit paged web API helpers', () => {
    const apiSource = source('src/web/api.ts');

    expect(apiSource).toContain('getRouteSummaryPage: <T = any>(options: {');
    expect(apiSource).toContain('tab?: "public" | "internal" | "manual";');
    expect(apiSource).toContain('brand?: string | null;');
    expect(apiSource).toContain('endpointType?: string | null;');
    expect(apiSource).toContain('includeZeroTarget?: boolean;');
    expect(apiSource).toContain('getRouteEndpointPage: <T = any>(options: {');
    expect(apiSource).toContain('paged: 1');
    expect(apiSource).not.toContain('getRoutes: () => request("/api/routes")');
  });

  it('keeps route-heavy pages off the full route list API', () => {
    const tokenRoutes = source('src/web/pages/TokenRoutes.tsx');
    const modelTester = source('src/web/pages/ModelTester.tsx');
    const graphWorkbench = source('src/web/pages/token-routes/RouteGraphWorkbench.tsx');
    const combined = [tokenRoutes, modelTester, graphWorkbench].join('\n');

    expect(tokenRoutes).toContain('api.getRouteSummaryPage<RouteSummaryRow>');
    expect(tokenRoutes).toContain('displayedRouteTotalCount');
    expect(tokenRoutes).toContain('routeSummaryFacets');
    expect(tokenRoutes).toContain('routeSummaryFacetsAreRemote');
    expect(tokenRoutes).toContain('routeEndpointCatalogPageInfo');
    expect(tokenRoutes).toContain('onLoadMoreSourceEndpoints');
    expect(modelTester).toContain('api.getRouteSummaryPage({');
    expect(modelTester).toContain('MODEL_TESTER_ROUTE_MODEL_PAGE_SIZE');
    expect(graphWorkbench).toContain('api.getRouteEndpointPage<RouteEndpointCatalogItem>');
    expect(graphWorkbench).toContain('routeEndpointCatalogPageInfo');
    expect(graphWorkbench).toContain('onSearchRouteEndpoints');
    expect(graphWorkbench).toContain('onLoadMoreRouteEndpoints');
    expect(graphWorkbench).toContain('loadMoreEndpoints');
    expect(combined).not.toContain('api.getRoutes()');
  });

  it('keeps models marketplace on the server-side paged projection contract', () => {
    const apiSource = source('src/web/api.ts');
    const modelsSource = source('src/web/pages/Models.tsx');
    const modelTesterSource = source('src/web/pages/ModelTester.tsx');

    expect(apiSource).toContain('getModelsMarketplace: (options: {');
    expect(apiSource).toContain('page: number;');
    expect(apiSource).toContain('pageSize: number;');
    expect(apiSource).toContain('sortBy?: "name" | "accountCount" | "credentialCount" | "avgLatency" | "successRate";');
    expect(modelsSource).toContain('displayedTotal = data.pageInfo?.totalCount');
    expect(modelsSource).toContain('facets');
    expect(modelsSource).toContain('api.getModelsMarketplace({');
    expect(modelTesterSource).toContain('api.getModelsMarketplace({');
    expect(modelTesterSource).toContain('pageSize: MODEL_TESTER_ROUTE_MODEL_PAGE_SIZE');
    expect(modelsSource).not.toContain('detailModels.slice');
    expect(modelsSource).not.toContain('Math.ceil(detailModels.length / pageSize)');
  });
});
