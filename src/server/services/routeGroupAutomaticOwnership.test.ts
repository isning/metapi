import { describe, expect, it } from 'vitest';
import type { RouteGraphSource } from '../../shared/routeGraph.js';
import {
  AVAILABILITY_ROUTE_GROUP_OWNER,
  normalizeAvailabilityManagedRouteGroups,
} from './routeGroupAutomaticOwnership.js';

function sourceFixture(): RouteGraphSource {
  return {
    nodes: [],
    edges: [],
    macros: [
      {
        id: 'automatic:model-a',
        kind: 'candidate_selector',
        ownership: 'system',
        enabled: true,
        name: 'model-a',
        config: {
          surface: {
            entry: {
              kind: 'external',
              match: { kind: 'model', requestedModelPattern: 'model-a' },
            },
            output: 'route',
          },
          policy: { kind: 'inherit_default' },
          candidateSource: { kind: 'model_pattern', pattern: 'model-a' },
          groups: [
            {
              id: 'primary',
              enabled: true,
              acceptUnassigned: true,
              input: { kind: 'synthetic', statusCode: 503, message: 'No route is available.' },
              members: [{
                memberId: 'member:a',
                endpointId: 'endpoint:a',
                enabled: false,
                weight: 37,
                metadata: { manualOverride: true },
              }],
            },
            {
              id: 'fallback',
              enabled: true,
              input: { kind: 'synthetic', statusCode: 503, message: 'No route is available.' },
              members: [{ memberId: 'member:b', endpointId: 'endpoint:b', weight: 11 }],
            },
          ],
        },
        metadata: { canonicalModel: 'model-a', importedFrom: 'route-graph-backup' },
      },
      {
        id: 'manual:pattern',
        kind: 'candidate_selector',
        ownership: 'manual',
        enabled: true,
        name: 'manual-pattern',
        config: {
          surface: {
            entry: {
              kind: 'external',
              match: { kind: 'model', requestedModelPattern: 'manual-pattern' },
            },
            output: 'route',
          },
          policy: { kind: 'inherit_default' },
          candidateSource: { kind: 'model_pattern', pattern: 'model-*' },
          groups: [{
            id: 'manual-stage',
            enabled: true,
            acceptUnassigned: true,
            input: { kind: 'synthetic', statusCode: 503, message: 'No route is available.' },
          }],
        },
      },
      {
        id: 'system:unmanaged-explicit',
        kind: 'candidate_selector',
        ownership: 'system',
        enabled: true,
        name: 'internal-system-route',
        config: {
          surface: { entry: { kind: 'none' }, output: 'route' },
          policy: { kind: 'inherit_default' },
          groups: [{
            id: 'system-stage',
            enabled: true,
            input: { kind: 'route_endpoints', endpointIds: ['endpoint:internal'] },
            members: [{ memberId: 'member:internal', endpointId: 'endpoint:internal' }],
          }],
        },
      },
    ],
  };
}

describe('availability-managed automatic Route Groups', () => {
  it('migrates system-owned pattern selectors to explicit members without changing manual pattern groups', () => {
    const input = sourceFixture();
    const migrated = normalizeAvailabilityManagedRouteGroups(input);
    const automatic = migrated.source.macros?.find((macro) => macro.id === 'automatic:model-a');
    const manual = migrated.source.macros?.find((macro) => macro.id === 'manual:pattern');
    const unmanagedSystem = migrated.source.macros?.find((macro) => macro.id === 'system:unmanaged-explicit');

    expect(migrated.changed).toBe(true);
    expect(migrated.migratedRouteGroups).toBe(1);
    expect(automatic?.metadata).toMatchObject({
      canonicalModel: 'model-a',
      importedFrom: 'route-graph-backup',
      managementOwner: AVAILABILITY_ROUTE_GROUP_OWNER,
    });
    expect(automatic?.config.candidateSource).toBeUndefined();
    expect(automatic?.config.groups).toEqual([
      expect.objectContaining({
        id: 'primary',
        input: { kind: 'route_endpoints', endpointIds: ['endpoint:a'] },
        members: [expect.objectContaining({
          memberId: 'member:a',
          endpointId: 'endpoint:a',
          enabled: false,
          weight: 37,
          metadata: { manualOverride: true },
        })],
      }),
      expect.objectContaining({
        id: 'fallback',
        input: { kind: 'route_endpoints', endpointIds: ['endpoint:b'] },
        members: [expect.objectContaining({ memberId: 'member:b', weight: 11 })],
      }),
    ]);
    expect(automatic?.config.groups[0]).not.toHaveProperty('acceptUnassigned');
    expect(manual).toEqual(input.macros?.[1]);
    expect(unmanagedSystem).toEqual(input.macros?.[2]);
    expect(normalizeAvailabilityManagedRouteGroups(migrated.source)).toMatchObject({
      changed: false,
      migratedRouteGroups: 0,
    });
  });
});
