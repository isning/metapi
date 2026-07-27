type LegacyRouteFixtureInput = {
  modelPattern?: string | null;
  routeMode?: string | null;
  sourceEndpointIds?: string[] | null;
  displayName?: string | null;
  displayIcon?: string | null;
  modelMapping?: unknown;
  dispatcherPolicy?: Record<string, unknown> | null;
  enabled?: boolean | null;
};

export function routeGraphFixture(input: LegacyRouteFixtureInput = {}) {
  const routeMode = input.routeMode === 'explicit_group' ? 'explicit_group' : 'pattern';
  const displayName = input.displayName ?? input.modelPattern ?? null;
  return {
    match: routeMode === 'explicit_group'
      ? {
        kind: 'model',
        requestedModelPattern: '',
        displayName,
      }
      : {
        kind: 'model',
        requestedModelPattern: input.modelPattern ?? '',
        displayName: input.displayName ?? null,
      },
    backend: routeMode === 'explicit_group'
      ? {
        kind: 'route_endpoints',
        endpointIds: [],
      }
      : { kind: 'supply' },
    sourceEndpointIds: input.sourceEndpointIds ?? [],
    displayName,
    displayIcon: input.displayIcon ?? null,
    modelMapping: input.modelMapping ?? null,
    dispatcherPolicy: input.dispatcherPolicy ?? null,
    enabled: input.enabled ?? true,
  };
}
