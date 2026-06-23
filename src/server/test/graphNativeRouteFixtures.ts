import type { RouteGraphBackendSpec, RouteGraphMatchSpec } from '../../shared/routeGraph.js';

async function loadGraphNativeFixtureModules() {
  const dbModule = await import('../db/index.js');
  const routeGraphService = await import('../services/routeGraphService.js');
  return {
    db: dbModule.db,
    schema: dbModule.schema,
    buildRouteGraphSourceFromRouteTable: routeGraphService.buildRouteGraphSourceFromRouteTable,
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

const routeBindingOverrides = new Map<number, {
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
}>();

export function resetGraphNativeTokenRouteFixtures() {
  routeBindingOverrides.clear();
}

export async function publishCurrentGraphNativeTokenRouteFixtures() {
  const {
    db,
    schema,
    buildRouteGraphSourceFromRouteTable,
    publishRouteGraphSource,
  } = await loadGraphNativeFixtureModules();
  const routes = await db.select({ id: schema.tokenRoutes.id }).from(schema.tokenRoutes).all();
  const routeIds = new Set(routes.map((route) => route.id));
  for (const routeId of Array.from(routeBindingOverrides.keys())) {
    if (!routeIds.has(routeId)) routeBindingOverrides.delete(routeId);
  }

  const sourceGraph = await buildRouteGraphSourceFromRouteTable(null, routeBindingOverrides);
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

  routeBindingOverrides.set(route.id, {
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
    backend: { kind: 'supply' },
  });
  await publishCurrentGraphNativeTokenRouteFixtures();

  return route;
}
