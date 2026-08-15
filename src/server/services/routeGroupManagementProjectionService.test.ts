import { describe, expect, it } from 'vitest';
import { buildCandidateSelectorMacro, normalizeRouteGraphNode } from '../../shared/routeGraph.js';
import { projectRouteGroupFallbackStagesFromGraph, projectRouteGroupsFromGraph } from './routeGroupManagementProjectionService.js';

describe('routeGroupManagementProjectionService', () => {
  it('derives the management DTO directly from a public source-Graph macro and runtime facts', () => {
    const endpoint = normalizeRouteGraphNode({
      id: 'endpoint:one',
      type: 'route_endpoint',
      routeEndpointId: 'endpoint:one',
      endpointKind: 'supply',
      exposure: 'none',
      resolutionStatus: 'resolved',
      ownerKind: 'manual',
      sourceKind: 'upstream_model',
      enabled: true,
      name: 'deepseek-v4-flash',
      config: { targets: [{
        targetId: 'target:one',
        model: 'deepseek-v4-flash',
        transportBinding: { kind: 'execution_target', executionTargetId: 42 },
      }] },
    });
    const macro = buildCandidateSelectorMacro({
      stableId: 'macro:public:deepseek',
      displayName: 'DeepSeek V4 Flash',
      displayIcon: 'deepseek',
      ingress: 'external',
      policy: { kind: 'builtin', builtin: 'weighted' },
      match: { kind: 'model', requestedModelPattern: 'DeepSeek-V4-Flash', displayName: 'DeepSeek V4 Flash' },
      fallbackStages: [{ id: 'stage:primary', label: 'Primary', members: [{ memberId: 'member:one', endpointId: endpoint.routeEndpointId, weight: 10 }] }],
      ownership: 'manual',
    });
    macro.config.groups[0]!.failureBackoff = { mode: 'disabled' };
    macro.config.groups[0]!.members[0]!.failureBackoff = {
      mode: 'custom', policy: { failureThreshold: 2, levelsSec: [0, 5], maxSec: 5 },
    };

    const targetFacts = [{
      id: 42,
      sourceRef: '67d54dd0-45c8-4d98-b7b9-7ac550192ec7',
      site: { id: 7, name: 'Example Site', platform: 'openai' },
      account: { id: 9, username: 'example-user' },
      token: { id: 11, name: 'primary', accountId: 9, enabled: true, isDefault: true },
      accountId: 9,
      tokenId: 11,
      oauthRouteUnitId: null,
      enabled: true,
      modelName: 'deepseek-v4-flash',
      successCount: 3,
      failCount: 0,
      cooldownUntil: null,
    }];
    const [group] = projectRouteGroupsFromGraph({ nodes: [endpoint], edges: [], macros: [macro] }, targetFacts);

    expect(group).toEqual(expect.objectContaining({
      id: 'macro:public:deepseek',
      kind: 'manual',
      sourceMode: 'manual',
      model: { publicName: 'DeepSeek-V4-Flash', upstreamName: 'DeepSeek-V4-Flash', normalizedName: 'deepseek-v4-flash' },
      visibility: 'public',
      candidateCount: 1,
      enabledCandidateCount: 1,
      failureBackoff: { mode: 'disabled' },
      siteNames: ['Example Site'],
    }));
    expect(group.sourceSelection).toEqual({ kind: 'explicit', sources: [expect.objectContaining({
      source: { kind: 'execution_target', sourceRef: '67d54dd0-45c8-4d98-b7b9-7ac550192ec7' },
      siteName: 'Example Site',
    })] });
    const [stage] = projectRouteGroupFallbackStagesFromGraph(
      { nodes: [endpoint], edges: [], macros: [macro] }, macro.id, targetFacts,
    ) || [];
    expect(stage?.candidates[0]?.failureBackoff).toEqual({
      mode: 'custom', policy: { failureThreshold: 2, levelsSec: [0, 5], maxSec: 5 },
    });
  });

  it('keeps Graph references as management group sources without reconstructing identities', () => {
    const child = buildCandidateSelectorMacro({
      stableId: 'macro:child',
      displayName: 'Child',
      ingress: 'none',
      fallbackStages: [],
    });
    const macro = buildCandidateSelectorMacro({
      stableId: 'macro:internal:parent',
      displayName: 'Parent',
      ingress: 'none',
      fallbackStages: [{ id: 'stage:child', members: [{ memberId: 'member:child', macroId: 'macro:child', weight: 1 }] }],
    });
    const source = { nodes: [], edges: [], macros: [macro, child] };
    const [group] = projectRouteGroupsFromGraph(source);
    expect(group).toMatchObject({ id: 'macro:internal:parent', kind: 'manual', visibility: 'internal' });
    expect(group.sourceSelection).toEqual({ kind: 'explicit', sources: [expect.objectContaining({ source: { kind: 'route_group', id: 'macro:child' } })] });

    const [stage] = projectRouteGroupFallbackStagesFromGraph(source, macro.id) || [];
    expect(stage?.candidates).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: 'route_group',
      fallbackStageId: 'stage:child',
      referencedRouteGroup: expect.objectContaining({
        id: 'macro:child',
        label: 'Child',
      }),
    })]));
  });

});
