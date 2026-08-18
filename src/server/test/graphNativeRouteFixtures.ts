import type { RouteGroupCreatePayload } from '../contracts/routeGroupPayloads.js';

async function loadGraphNativeFixtureModules() {
  const routeGraphService = await import('../services/routeGraphService.js');
  const routeGroupManagementService = await import('../services/routeGroupManagementService.js');
  return {
    createRouteGroupFromPayload: routeGroupManagementService.createRouteGroupFromPayload,
    getActiveRouteGraphVersion: routeGraphService.getActiveRouteGraphVersion,
    ensureActiveRouteGraphVersion: routeGraphService.ensureActiveRouteGraphVersion,
  };
}

type GraphNativeRouteFixtureInput = {
  modelPattern: string;
  displayName?: string | null;
  displayIcon?: string | null;
  enabled?: boolean;
  dispatcherPolicy?: RouteGroupCreatePayload['dispatcherPolicy'];
  affinity?: RouteGroupCreatePayload['affinity'];
};

export function resetGraphNativeRouteFixtures() {
  // Native route-group fixtures are persisted by the test database lifecycle.
}

export async function publishCurrentGraphNativeRouteFixtures() {
  const {
    getActiveRouteGraphVersion,
    ensureActiveRouteGraphVersion,
  } = await loadGraphNativeFixtureModules();
  return await getActiveRouteGraphVersion() || await ensureActiveRouteGraphVersion();
}

export async function createGraphNativeRouteFixture(input: GraphNativeRouteFixtureInput) {
  const { createRouteGroupFromPayload } = await loadGraphNativeFixtureModules();
  const routeGroup = await createRouteGroupFromPayload({
    model: {
      publicName: input.displayName ?? input.modelPattern,
      upstreamName: input.modelPattern,
    },
    presentation: {
      displayName: input.displayName ?? null,
      displayIcon: input.displayIcon ?? null,
    },
    dispatcherPolicy: input.dispatcherPolicy ?? null,
    enabled: input.enabled ?? true,
    ...(input.affinity ? { affinity: input.affinity } : {}),
  });
  await publishCurrentGraphNativeRouteFixtures();
  return routeGroup;
}
