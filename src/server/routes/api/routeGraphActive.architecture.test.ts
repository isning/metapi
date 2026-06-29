import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = () => readFileSync(new URL('./tokens.ts', import.meta.url), 'utf8');
const routeGraphServiceSource = () => readFileSync(new URL('../../services/routeGraphService.ts', import.meta.url), 'utf8');
const routeTableProjectionServiceSource = () => readFileSync(new URL('../../services/routeTableProjectionService.ts', import.meta.url), 'utf8');
const statsSource = () => readFileSync(new URL('./stats.ts', import.meta.url), 'utf8');

describe('route graph active route architecture', () => {
  it('keeps the default active graph read path lightweight', () => {
    const text = source();
    const routeStart = text.indexOf("app.get<{ Querystring: { include?: string } }>('/api/route-graph/active'");
    const routeEnd = text.indexOf("app.get('/api/route-graph/draft'", routeStart);
    const block = text.slice(routeStart, routeEnd);
    const defaultBranch = block.slice(0, block.indexOf("const active = include === 'full'"));

    expect(routeStart).toBeGreaterThanOrEqual(0);
    expect(routeEnd).toBeGreaterThan(routeStart);
    expect(defaultBranch).toContain('getRouteGraphRouteTableSummary');
    expect(defaultBranch).not.toContain('synchronizeActiveRouteGraphVersion');
    expect(defaultBranch).not.toContain('ensureActiveRouteGraphVersion');
    expect(defaultBranch).not.toContain('compiledGraph: active.compiledGraph');
    expect(block).toContain("include === 'full'");
    expect(block).toContain('synchronizeActiveRouteGraphVersion()');
  });

  it('keeps active source reads off the full compiled graph path', () => {
    const text = source();
    const routeStart = text.indexOf("app.get<{ Querystring: { include?: string } }>('/api/route-graph/active'");
    const routeEnd = text.indexOf("app.get('/api/route-graph/draft'", routeStart);
    const block = text.slice(routeStart, routeEnd);
    const sourceBranchStart = block.indexOf("if (include === 'source')");
    const sourceBranchEnd = block.indexOf("const active = include === 'full'", sourceBranchStart);
    const sourceBranch = block.slice(sourceBranchStart, sourceBranchEnd);

    expect(sourceBranchStart).toBeGreaterThanOrEqual(0);
    expect(sourceBranchEnd).toBeGreaterThan(sourceBranchStart);
    expect(sourceBranch).toContain('getActiveRouteGraphSourceVersion');
    expect(sourceBranch).not.toContain('ensureActiveRouteGraphVersion()');
    expect(sourceBranch).not.toContain('synchronizeActiveRouteGraphVersion()');
    expect(sourceBranch).toContain('compiledGraph: null');
  });

  it('keeps endpoint catalog reads on the persisted projection path', () => {
    const text = routeGraphServiceSource();
    const catalogStart = text.indexOf('export async function listRouteEndpointCatalog');
    const catalogEnd = text.indexOf('export async function resolveRouteEndpointSourceRouteIds', catalogStart);
    const catalogBlock = text.slice(catalogStart, catalogEnd);

    expect(catalogStart).toBeGreaterThanOrEqual(0);
    expect(catalogEnd).toBeGreaterThan(catalogStart);
    expect(catalogBlock).toContain('loadRouteEndpointCatalogProjection');
    expect(catalogBlock).not.toContain('ensureActiveRouteGraphVersion');
    expect(catalogBlock).not.toContain('getActiveRouteGraphSourceVersion');
  });

  it('keeps route summary reads off active graph hydration', () => {
    const text = source();
    const summaryStart = text.indexOf('async function buildRouteSummaryRows');
    const summaryEnd = text.indexOf('async function loadCachedRouteSummaryRows', summaryStart);
    const summaryBlock = text.slice(summaryStart, summaryEnd);
    const pageStart = text.indexOf('async function loadRouteSummaryPage');
    const pageEnd = text.indexOf('export async function tokensRoutes', pageStart);
    const pageBlock = text.slice(pageStart, pageEnd);

    expect(summaryStart).toBeGreaterThanOrEqual(0);
    expect(summaryEnd).toBeGreaterThan(summaryStart);
    expect(pageStart).toBeGreaterThanOrEqual(0);
    expect(pageEnd).toBeGreaterThan(pageStart);
    expect(summaryBlock).toContain('schema.tokenRoutes');
    expect(summaryBlock).toContain('schema.routeGroupSources');
    expect(summaryBlock).not.toContain('listRoutesWithSources');
    expect(summaryBlock).not.toContain('loadRouteGraphRouteTableBindings');
    expect(summaryBlock).not.toContain('ensureActiveRouteGraphVersion');
    expect(pageBlock).toContain('.limit(pageSize)');
    expect(pageBlock).not.toContain('loadCachedRouteSummaryRows');
    expect(pageBlock).not.toContain('listRoutesWithSources');
    expect(pageBlock).not.toContain('loadRouteGraphRouteTableBindings');
    expect(pageBlock).not.toContain('ensureActiveRouteGraphVersion');
  });

  it('keeps marketplace route inventory off compiled graph hydration', () => {
    const text = statsSource();
    const routeStart = text.indexOf('"/api/models/marketplace"');
    const routeEnd = text.indexOf('"/api/models/probe"', routeStart);
    const block = text.slice(routeStart, routeEnd);

    expect(routeStart).toBeGreaterThanOrEqual(0);
    expect(routeEnd).toBeGreaterThan(routeStart);
    expect(block).toContain('listRouteEndpointCatalog({ endpointKind: "route_product" })');
    expect(block).not.toContain('ensureActiveRouteGraphVersion');
    expect(block).not.toContain('compiledGraph.nodesById');
    expect(block).not.toContain('compiledGraph.publicModels');
  });

  it('keeps route and target write paths synchronized with bounded projections only', () => {
    const text = source();
    const writeStart = text.indexOf('async function syncRouteGraphRouteBinding');
    const writeEnd = text.indexOf('async function syncExplicitGroupSourceRouteStrategies', writeStart);
    const writeBlock = text.slice(writeStart, writeEnd);

    expect(writeStart).toBeGreaterThanOrEqual(0);
    expect(writeEnd).toBeGreaterThan(writeStart);
    expect(text).toContain('async function syncRouteGraphRoutesById');
    expect(writeBlock).toContain('upsertRouteBindingProjections');
    expect(writeBlock).toContain('syncRouteBindingProjectionsFromRouteTable(routeIds)');
    expect(writeBlock).not.toContain('ensureActiveRouteGraphVersion');
    expect(writeBlock).not.toContain('getActiveRouteGraphVersion');
    expect(writeBlock).not.toContain('reconcileActiveGraphWithRouteTable');
    expect(writeBlock).not.toContain('synchronizeActiveRouteGraphVersion');
    expect(text).toContain("if (action === 'enable' || action === 'disable')");
    expect(text).toContain('await syncRouteGraphRoutesById(ids)');
    expect(text).toContain('await syncRouteGraphRoutesById([routeId])');
    expect(text).toContain('await syncRouteGraphRoutesById(routeIds)');
    expect(text).toContain('await syncRouteGraphRoutesById([target.routeId])');
    expect(text).toContain('invalidateRouteGraphReadCaches()');
  });

  it('keeps route binding projections table-backed instead of settings-backed', () => {
    const text = routeTableProjectionServiceSource();

    expect(text).toContain('schema.routeBindingProjections');
    expect(text).toContain('loadRouteBindingProjectionMap');
    expect(text).toContain('syncRouteBindingProjectionsFromRouteTable');
    expect(text).not.toContain('upsertSetting');
    expect(text).not.toContain('schema.settings');
    expect(text).not.toContain('ROUTE_BINDING_PROJECTION');
    expect(text).not.toContain('route_binding_projection_v1');
  });

  it('keeps persisted active graphs compact by excluding legacy program bundles', () => {
    const text = routeGraphServiceSource();
    const publishStart = text.indexOf('export async function publishRouteGraphSource');
    const publishEnd = text.indexOf('export async function ensureActiveRouteGraphVersion', publishStart);
    const publishBlock = text.slice(publishStart, publishEnd);
    const activeLoadStart = text.indexOf('export async function getActiveRouteGraphVersion');
    const activeLoadEnd = text.indexOf('export async function getActiveRouteGraphSourceVersion', activeLoadStart);
    const activeLoadBlock = text.slice(activeLoadStart, activeLoadEnd);

    expect(publishBlock).toContain('includeLegacyBundles: false');
    expect(publishBlock).toContain('includePrimitiveSource: false');
    expect(activeLoadBlock).toContain('hasLegacyRouteProgramBundles');
    expect(activeLoadBlock).toContain('includeLegacyBundles: false');
    expect(activeLoadBlock).toContain('compiledGraphJson: JSON.stringify(compiledGraph)');
  });
});
