type LegacyRouteFixtureInput = {
  modelPattern?: string | null;
  routeMode?: string | null;
  sourceRouteIds?: number[] | null;
  displayName?: string | null;
  displayIcon?: string | null;
  modelMapping?: unknown;
  routingStrategy?: string | null;
  enabled?: boolean | null;
};

export function tokenRouteFixture(input: LegacyRouteFixtureInput = {}) {
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
        kind: 'routes',
        routeIds: input.sourceRouteIds ?? [],
      }
      : { kind: 'supply' },
    displayName,
    displayIcon: input.displayIcon ?? null,
    modelMapping: input.modelMapping ?? null,
    routingStrategy: input.routingStrategy ?? 'weighted',
    enabled: input.enabled ?? true,
  };
}
