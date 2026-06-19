import type { RouteGraphBackendSpec, RouteGraphMatchSpec } from '../../shared/routeGraph.js';

async function loadGraphNativeFixtureModules() {
  const dbModule = await import('../db/index.js');
  const routeGraphService = await import('../services/routeGraphService.js');
  return {
    db: dbModule.db,
    schema: dbModule.schema,
    buildRouteGraphSourceFromCurrentProjectionTable: routeGraphService.buildRouteGraphSourceFromCurrentProjectionTable,
    publishRouteGraphSource: routeGraphService.publishRouteGraphSource,
  };
}

type GraphNativeTokenRouteFixtureInput = {
  modelPattern: string;
  displayName?: string | null;
  displayIcon?: string | null;
  enabled?: boolean;
  routingStrategy?: string | null;
};

const routeProjectionOverrides = new Map<number, {
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
}>();

export function resetGraphNativeTokenRouteFixtures() {
  routeProjectionOverrides.clear();
}

export async function publishCurrentGraphNativeTokenRouteFixtures() {
  const {
    db,
    schema,
    buildRouteGraphSourceFromCurrentProjectionTable,
    publishRouteGraphSource,
  } = await loadGraphNativeFixtureModules();
  const routes = await db.select({ id: schema.tokenRoutes.id }).from(schema.tokenRoutes).all();
  const routeIds = new Set(routes.map((route) => route.id));
  for (const routeId of Array.from(routeProjectionOverrides.keys())) {
    if (!routeIds.has(routeId)) routeProjectionOverrides.delete(routeId);
  }

  const sourceGraph = await buildRouteGraphSourceFromCurrentProjectionTable(null, routeProjectionOverrides);
  const published = await publishRouteGraphSource({
    sourceGraph,
    createdBy: 'test-fixture',
    allowDiagnostics: true,
  });
  if (!published.ok) {
    throw new Error(`Failed to publish route graph fixture: ${published.diagnostics.map((item) => item.message).join('; ')}`);
  }
  return published.version;
}

export async function createGraphNativeTokenRouteFixture(input: GraphNativeTokenRouteFixtureInput) {
  const { db, schema } = await loadGraphNativeFixtureModules();
  const route = await db.insert(schema.tokenRoutes).values({
    displayName: input.displayName ?? null,
    displayIcon: input.displayIcon ?? null,
    routingStrategy: input.routingStrategy ?? 'weighted',
    enabled: input.enabled ?? true,
  }).returning().get();

  routeProjectionOverrides.set(route.id, {
    match: {
      kind: 'model',
      requestedModelPattern: input.modelPattern,
      currentModelPattern: '',
      displayName: input.displayName ?? null,
      downstreamProtocol: null,
      upstreamProtocol: null,
      sitePlatform: null,
      routeId: route.id,
      accountId: null,
      tokenId: null,
      siteId: null,
    },
    backend: { kind: 'channels' },
  });
  await publishCurrentGraphNativeTokenRouteFixtures();

  return route;
}
