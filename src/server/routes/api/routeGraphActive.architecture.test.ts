import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = () => readFileSync(new URL('./tokens.ts', import.meta.url), 'utf8');
const serverEntrySource = () => readFileSync(new URL('../../index.ts', import.meta.url), 'utf8');
const sqliteMigrationSource = () => readFileSync(new URL('../../db/migrate.ts', import.meta.url), 'utf8');
const routeGraphServiceSource = () => readFileSync(new URL('../../services/routeGraphService.ts', import.meta.url), 'utf8');
const routeTableProjectionServiceSource = () => readFileSync(new URL('../../services/routeTableProjectionService.ts', import.meta.url), 'utf8');
const statsSource = () => readFileSync(new URL('./stats.ts', import.meta.url), 'utf8');
const routeFlowServiceSource = () => readFileSync(new URL('../../services/routeFlowService.ts', import.meta.url), 'utf8');
const backupServiceSource = () => readFileSync(new URL('../../services/backupService.ts', import.meta.url), 'utf8');
const dummyUpstreamSeedServiceSource = () => readFileSync(new URL('../../services/dummyUpstreamSeedService.ts', import.meta.url), 'utf8');

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

  it('keeps route-table source rebuilds from compiling the base graph', () => {
    const text = routeGraphServiceSource();
    const collectorStart = text.indexOf('function collectMatchAndBackendByLegacyRouteId');
    const collectorEnd = text.indexOf('function normalizeSelfRouteProductBackend', collectorStart);
    const collectorBlock = text.slice(collectorStart, collectorEnd);

    expect(collectorStart).toBeGreaterThanOrEqual(0);
    expect(collectorEnd).toBeGreaterThan(collectorStart);
    expect(collectorBlock).toContain('for (const node of source.nodes)');
    expect(collectorBlock).toContain("node.endpointKind !== 'route_product'");
    expect(collectorBlock).not.toContain('compileRouteGraphSource');
  });

  it('keeps server startup from hydrating full active graph JSON', () => {
    const text = serverEntrySource();

    expect(text).toContain('syncRouteBindingProjectionsFromRouteTable');
    expect(text).not.toContain('ensureActiveRouteGraphVersion');
    expect(text).not.toContain('syncRouteBindingProjectionsFromRouteGraphSource');
  });

  it('keeps sqlite graph-reference migration row-streamed', () => {
    const text = sqliteMigrationSource();
    const start = text.indexOf('function normalizeLegacyRouteGraphSourceEndpointReferences');
    const end = text.indexOf('function readMigrationRecordsUntilTag', start);
    const block = text.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(text).toContain('GRAPH_JSON_MIGRATION_BATCH_SIZE = 1');
    expect(block).toContain('WHERE id > ?');
    expect(text).toContain('instr(%COLUMN%');
    expect(block).toContain('LEGACY_GRAPH_ENDPOINT_REFERENCE_SQL.replaceAll');
    expect(block).toContain('LIMIT ${GRAPH_JSON_MIGRATION_BATCH_SIZE}');
    expect(block).not.toContain("SELECT id, source_graph_json FROM route_graph_versions').all()");
    expect(block).not.toContain("SELECT id, working_graph_json FROM route_graph_drafts').all()");
  });

  it('keeps persisted active graphs compact with a single compiled router artifact', () => {
    const text = routeGraphServiceSource();
    const publishStart = text.indexOf('export async function publishRouteGraphSource');
    const publishEnd = text.indexOf('export async function ensureActiveRouteGraphVersion', publishStart);
    const publishBlock = text.slice(publishStart, publishEnd);
    const activeLoadStart = text.indexOf('export async function getActiveRouteGraphVersion');
    const activeLoadEnd = text.indexOf('export async function getActiveRouteGraphSourceVersion', activeLoadStart);
    const activeLoadBlock = text.slice(activeLoadStart, activeLoadEnd);
    const runtimeLoadStart = text.indexOf('export async function getActiveRouteGraphRuntimeVersion');
    const runtimeLoadEnd = text.indexOf('export async function getActiveRouteGraphSummary', runtimeLoadStart);
    const runtimeLoadBlock = text.slice(runtimeLoadStart, runtimeLoadEnd);

    expect(text).not.toContain('includeLegacyBundles');
    expect(publishBlock).not.toContain('programBundle');
    expect(publishBlock).not.toContain('flatProgramBundle');
    expect(publishBlock).toContain('includePrimitiveSource: false');
    expect(publishBlock).toContain('serializeRouteGraphRuntimeStorageArtifact');
    expect(activeLoadBlock).not.toContain('programBundle');
    expect(activeLoadBlock).not.toContain('flatProgramBundle');
    expect(activeLoadBlock).toContain('storeRouteGraphRuntimeArtifact');
    expect(runtimeLoadStart).toBeGreaterThanOrEqual(0);
    expect(runtimeLoadEnd).toBeGreaterThan(runtimeLoadStart);
    expect(runtimeLoadBlock).toContain('loadRouteGraphRuntimeArtifactForVersion');
    expect(runtimeLoadBlock).toContain('compiledGraphByteLength');
    expect(runtimeLoadBlock).not.toContain('sourceGraphJson');
    expect(runtimeLoadBlock).not.toContain('compileRouteGraphSource');
  });

  it('keeps draft and history reads off compiled graph hydration', () => {
    const text = routeGraphServiceSource();
    const historyStart = text.indexOf('export async function listRouteGraphVersions');
    const historyEnd = text.indexOf('async function getLatestRouteGraphDraftRow', historyStart);
    const historyBlock = text.slice(historyStart, historyEnd);
    const draftStart = text.indexOf('export async function getRouteGraphDraft');
    const draftEnd = text.indexOf('export async function validateRouteGraphDraft', draftStart);
    const draftBlock = text.slice(draftStart, draftEnd);

    expect(historyStart).toBeGreaterThanOrEqual(0);
    expect(historyEnd).toBeGreaterThan(historyStart);
    expect(draftStart).toBeGreaterThanOrEqual(0);
    expect(draftEnd).toBeGreaterThan(draftStart);
    expect(historyBlock).not.toContain('compiledGraphJson');
    expect(historyBlock).not.toContain('compileRouteGraphSource');
    expect(historyBlock).toContain('countPublicModelEntriesInSourceGraph');
    expect(draftBlock).toContain('ensureActiveRouteGraphSourceVersion');
    expect(draftBlock).not.toContain('ensureActiveRouteGraphVersion');
  });

  it('keeps backup import/export from preserving full compiled graph cache blobs', () => {
    const text = backupServiceSource();
    const exportStart = text.indexOf('async function exportRouteGraphVersionRows');
    const exportEnd = text.indexOf('async function exportAccountsSection', exportStart);
    const exportBlock = text.slice(exportStart, exportEnd);
    const importStart = text.indexOf('if (shouldRestoreRouteGraph)');
    const importEnd = text.indexOf('await tx.insert(schema.routeGraphActiveVersion)', importStart);
    const importBlock = text.slice(importStart, importEnd);
    const normalizeStart = text.indexOf('async function normalizeImportedRouteGraphRows');
    const normalizeEnd = text.indexOf('function buildModelAvailabilityIdentityKey', normalizeStart);
    const normalizeBlock = text.slice(normalizeStart, normalizeEnd);

    expect(exportStart).toBeGreaterThanOrEqual(0);
    expect(exportEnd).toBeGreaterThan(exportStart);
    expect(normalizeStart).toBeGreaterThanOrEqual(0);
    expect(normalizeEnd).toBeGreaterThan(normalizeStart);
    expect(exportBlock).not.toContain('schema.routeGraphVersions.compiledGraphJson');
    expect(exportBlock).toContain('buildRouteGraphRuntimeArtifactJsonForSource');
    expect(text).not.toContain('db.select().from(schema.routeGraphVersions).orderBy');
    expect(normalizeBlock).toContain('where(gt(schema.routeGraphVersions.id, lastVersionId))');
    expect(normalizeBlock).toContain('where(gt(schema.routeGraphDrafts.id, lastDraftId))');
    expect(normalizeBlock).not.toContain('from(schema.routeGraphDrafts).all()');
    expect(importBlock).toContain('buildRouteGraphRuntimeArtifactJsonForSource');
    expect(importBlock).not.toContain('row.compiledGraphJson');
  });

  it('keeps dummy upstream seeding on route-table projections instead of active graph hydration', () => {
    const text = dummyUpstreamSeedServiceSource();

    expect(text).toContain('routeTableProjectionService.js');
    expect(text).not.toContain('ensureActiveRouteGraphVersion');
    expect(text).not.toContain('compileRouteGraphSource');
  });

  it('keeps route-flow on runtime bundles instead of full active graph hydration', () => {
    const text = routeFlowServiceSource();
    const start = text.indexOf('export async function compileModelRouteFlow');
    const block = text.slice(start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(text).toContain('getActiveRouteGraphRuntimeVersion');
    expect(text).not.toContain('ensureActiveRouteGraphVersion');
    expect(block).not.toContain('activeGraph.compiledGraph.programBundle');
    expect(block).not.toContain('activeGraph.compiledGraph.flatProgramBundle');
  });
});
