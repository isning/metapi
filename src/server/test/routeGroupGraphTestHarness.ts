/**
 * Test-only read helper for management-backed Graphs. Production management
 * writes publish their Graph mutation atomically; test code must not rebuild
 * a second graph from a persistence projection.
 */
export async function publishRouteGroupGraphForTest(_createdBy = 'test-fixture') {
  const routeGraph = await import('../services/routeGraphService.js');
  return await routeGraph.getActiveRouteGraphVersion() || await routeGraph.ensureActiveRouteGraphVersion();
}
