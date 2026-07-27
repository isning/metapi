import { describe, expect, it } from 'vitest';
import {
  migrateImportedRouteGraphSourceJson,
  migratePreviousRouteBackupToCurrentRuntime,
  type BackupImportRouteRuntimeSection,
} from './backupImportMigration.js';

describe('backup import dispatch policy migration', () => {
  const legacySection = (overrides: Partial<BackupImportRouteRuntimeSection> = {}) => ({
    sites: [],
    accounts: [{ id: 1, siteId: 1 }],
    accountTokens: [],
    runtimeExecutionTargets: [],
    runtimeExecutionTargetState: [],
    ...overrides,
  }) as unknown as BackupImportRouteRuntimeSection;

  it('materializes legacy automatic routes as model-pattern groups with endpoint overrides, not explicit source pickers', () => {
    const migrated = migratePreviousRouteBackupToCurrentRuntime(legacySection(), {
      tokenRoutes: [{ id: 7, modelPattern: 'DeepSeek-V4-Flash' }],
      routeEndpointTargets: [{ routeId: 7, accountId: 1, modelName: 'DeepSeek-V4-Flash' }],
    });

    const macro = migrated.graphSource?.macros?.[0];
    expect(macro).toMatchObject({ ownership: 'system' });
    expect(macro?.config.candidateSource).toEqual({
      kind: 'model_pattern',
      pattern: 'deepseek-v4-flash',
    });
    expect(macro?.config.groups).toEqual([expect.objectContaining({
      acceptUnassigned: true,
      input: expect.objectContaining({ kind: 'synthetic', statusCode: 503 }),
    })]);
    expect(macro?.config.groups[0]?.members).toEqual([
      expect.objectContaining({
        endpointId: expect.any(String),
        weight: 10,
      }),
    ]);
  });

  it('keeps legacy manual route groups on explicit endpoint sources', () => {
    const migrated = migratePreviousRouteBackupToCurrentRuntime(legacySection({
      runtimeExecutionTargets: [{
        id: 11,
        sourceRef: 'a2efbddf-5046-4443-855d-cfb34872dd3b',
        executionKey: 'manual-target',
        siteId: 1,
        accountId: 1,
        tokenId: null,
        oauthRouteUnitId: null,
        credentialBindingId: null,
        endpointProfileId: null,
        upstreamModelName: 'gpt-5.4',
        normalizedModelName: 'gpt-5.4',
        enabled: true,
        discovered: false,
        source: 'backup_import',
        metadataJson: null,
        createdAt: null,
        updatedAt: null,
      }] as unknown as BackupImportRouteRuntimeSection['runtimeExecutionTargets'],
    }), {
      routeGroups: [{ id: 9, kind: 'manual', publicModelName: 'combined-model' }],
      routeGroupFallbackStages: [{ id: 10, groupId: 9, sortOrder: 0 }],
      routeGroupCandidates: [{ stageId: 10, executionTargetId: 11 }],
    });

    const macro = migrated.graphSource?.macros?.[0];
    expect(macro).toMatchObject({ ownership: 'manual' });
    expect(macro?.config.groups[0]?.input.kind).toBe('graph_references');
    expect(macro?.config.groups[0]?.members).toEqual([
      expect.objectContaining({ macroId: expect.any(String) }),
    ]);
  });

  it('reports unresolved legacy members without creating inferred graph references', () => {
    const migrated = migratePreviousRouteBackupToCurrentRuntime(legacySection({
      runtimeExecutionTargets: [],
    }), {
      routeGroups: [
        { id: 9, kind: 'manual', publicModelName: 'combined-model' },
        { id: 12, kind: 'automatic', publicModelName: 'missing-target-model' },
      ],
      routeGroupFallbackStages: [
        { id: 10, groupId: 9, sortOrder: 0 },
        { id: 13, groupId: 12, sortOrder: 0 },
      ],
      routeGroupCandidates: [
        { id: 101, stageId: 10, childGroupId: 404 },
        { id: 102, stageId: 10 },
        { id: 103, stageId: 13, executionTargetId: 999 },
      ],
    });

    expect(migrated.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'route_member_unresolved',
        groupKey: '9',
        memberReferenceKind: 'source_route',
        memberReference: '404',
        reason: 'source_route_missing',
      }),
      expect.objectContaining({
        code: 'route_member_unresolved',
        groupKey: '9',
        memberReferenceKind: 'candidate',
        memberReference: '102',
        reason: 'member_reference_invalid',
      }),
      expect.objectContaining({
        code: 'route_member_unresolved',
        groupKey: '12',
        memberReferenceKind: 'execution_target',
        memberReference: '999',
        reason: 'execution_target_missing',
      }),
    ]));
    expect(migrated.warnings).toHaveLength(3);

    const combinedMacro = migrated.graphSource?.macros?.find((macro) => macro.config.modelName === 'combined-model');
    const missingTargetMacro = migrated.graphSource?.macros?.find((macro) => macro.config.modelName === 'missing-target-model');
    expect(combinedMacro?.config.groups[0]?.members).toBeUndefined();
    expect(missingTargetMacro?.config.groups[0]?.members).toBeUndefined();
    expect(migrated.graphSource?.nodes).toEqual([]);
  });

  it('reports legacy endpoints whose account cannot be restored and does not synthesize a target', () => {
    const migrated = migratePreviousRouteBackupToCurrentRuntime(legacySection(), {
      tokenRoutes: [{ id: 7, modelPattern: 'missing-account-model' }],
      routeEndpointTargets: [
        { id: 70, routeId: 7, accountId: 404, sourceModel: 'missing-account-model' },
        { id: 70, routeId: 7, accountId: 404, sourceModel: 'missing-account-model' },
      ],
    });

    expect(migrated.notices).toEqual([expect.objectContaining({
      code: 'route_member_unresolved',
      groupKey: '7',
      memberReferenceKind: 'route_endpoint',
      memberReference: '70',
      reason: 'account_missing',
    })]);
    expect(migrated.warnings).toHaveLength(1);
    expect(migrated.section.runtimeExecutionTargets).toEqual([]);
    expect(migrated.graphSource?.nodes).toEqual([]);
    expect(migrated.graphSource?.macros?.[0]?.config).toMatchObject({
      candidateSource: { kind: 'model_pattern', pattern: 'missing-account-model' },
      groups: [expect.objectContaining({
        input: expect.objectContaining({ kind: 'synthetic' }),
      })],
    });
    expect(migrated.graphSource?.macros?.[0]?.config.groups[0]?.members).toBeUndefined();
  });

  it('moves historical weighted dispatchers to the explicit default-policy reference', () => {
    const migrated = JSON.parse(migrateImportedRouteGraphSourceJson(JSON.stringify({
      version: 1,
      nodes: [{ id: 'dispatcher:one', type: 'dispatcher', policy: { strategy: 'weighted' } }],
      edges: [],
      macros: [],
    })));

    expect(migrated.nodes[0].policy).toEqual({ kind: 'inherit_default' });
  });

  it('moves legacy priority_order dispatchers to the default policy and rejects malformed graph JSON', () => {
    const migrated = JSON.parse(migrateImportedRouteGraphSourceJson(JSON.stringify({
      nodes: [{ id: 'dispatcher:one', type: 'dispatcher', policy: { strategy: 'priority_order' } }],
      edges: [],
      macros: [],
    })));
    expect(migrated.nodes[0].policy).toEqual({ kind: 'inherit_default' });
    expect(() => migrateImportedRouteGraphSourceJson('{')).toThrow('路由图源定义无效');
  });

  it('does not modify endpoint target-selection policy while migrating dispatch policy', () => {
    const migrated = JSON.parse(migrateImportedRouteGraphSourceJson(JSON.stringify({
      nodes: [
        { id: 'dispatcher:one', type: 'dispatcher', policy: { strategy: 'weighted' } },
        { id: 'endpoint:one', type: 'route_endpoint', config: { targetSelection: { strategy: 'weighted' } } },
      ],
      edges: [],
      macros: [],
    })));

    expect(migrated.nodes[0].policy).toEqual({ kind: 'inherit_default' });
    expect(migrated.nodes[1].config.targetSelection).toEqual({ strategy: 'weighted' });
  });

  it('moves a historical endpoint execution-target metadata binding into the typed transport binding', () => {
    const migrated = JSON.parse(migrateImportedRouteGraphSourceJson(JSON.stringify({
      nodes: [{
        id: 'endpoint:one',
        type: 'route_endpoint',
        metadata: { executionTargetId: 42, upstreamModel: 'gpt-5.4' },
        config: {
          targets: [{
            targetId: 'target:one',
            model: 'gpt-5.4',
            metadata: { executionTargetId: 42 },
          }],
        },
      }],
      edges: [],
      macros: [],
    })));

    expect(migrated.nodes[0]).toMatchObject({
      metadata: { upstreamModel: 'gpt-5.4' },
      config: {
        targets: [{
          targetId: 'target:one',
          transportBinding: { kind: 'execution_target', executionTargetId: 42 },
        }],
      },
    });
    expect(migrated.nodes[0].metadata).not.toHaveProperty('executionTargetId');
    expect(migrated.nodes[0].config.targets[0].metadata).toBeUndefined();
  });

  it('replaces imported fallback controller metadata with explicit dispatcher edges', () => {
    const migrated = JSON.parse(migrateImportedRouteGraphSourceJson(JSON.stringify({
      version: 1,
      nodes: [
        {
          id: 'macro:example:dispatcher',
          type: 'dispatcher',
          mode: 'route',
          metadata: {
            routeGraphControl: {
              fallbackChain: [
                { dispatcherId: 'macro:example:fallback-stage:primary:dispatcher' },
                { dispatcherId: 'macro:example:fallback-stage:backup:dispatcher' },
              ],
            },
          },
        },
        { id: 'macro:example:fallback-stage:primary:dispatcher', type: 'dispatcher', mode: 'route', policy: { kind: 'builtin', builtin: 'round_robin' } },
        { id: 'macro:example:fallback-stage:backup:dispatcher', type: 'dispatcher', mode: 'route' },
        { id: 'endpoint:primary', type: 'route_endpoint' },
      ],
      edges: [
        {
          id: 'candidate',
          sourceNodeId: 'endpoint:primary',
          sourcePortId: 'route.out',
          targetNodeId: 'macro:example:fallback-stage:primary:dispatcher',
          targetPortId: 'route.in',
          kind: 'route_flow',
          metadata: { routeGraphControl: { stale: true } },
        },
      ],
      macros: [],
    })));

    expect(migrated.nodes.map((node: { id: string }) => node.id)).not.toContain('macro:example:fallback-stage:primary:dispatcher');
    expect(migrated.nodes.find((node: { id: string }) => node.id === 'macro:example:dispatcher')).toMatchObject({
      mode: 'route',
      policy: { kind: 'builtin', builtin: 'round_robin' },
      metadata: {},
    });
    expect(migrated.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'candidate', targetNodeId: 'macro:example:dispatcher' }),
      expect.objectContaining({
        sourceNodeId: 'macro:example:dispatcher',
        sourcePortId: 'fallback.out',
        targetNodeId: 'macro:example:fallback-stage:backup:dispatcher',
        targetPortId: 'bidirect.in',
        kind: 'bidirect_flow',
      }),
    ]));
    expect(JSON.stringify(migrated)).not.toContain('routeGraphControl');
  });
});
