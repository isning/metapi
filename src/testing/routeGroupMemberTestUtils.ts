import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createManagedRouteGraphElementId } from '../shared/routingIdentity.js';

/** Resolve server modules at call time so isolated test databases never bind to a stale module cache. */
async function runtime() {
  const [
    dbModule,
    facadeService,
    facadeAccess,
    executionTargetEndpointService,
    routeGraphService,
    runtimeExecutionTargetService,
    routeRuntimeExecutionIdentityService,
    fallbackStageService,
    executionTargetFactsService,
    managementProjectionService,
  ] = await Promise.all([
    import('../server/db/index.js'),
    import('../server/services/routeGroupGraphFacadeService.js'),
    import('../server/services/routeGroupGraphFacadeAccessService.js'),
    import('../server/services/routeGraphExecutionTargetEndpointService.js'),
    import('../server/services/routeGraphService.js'),
    import('../server/services/runtimeExecutionTargetService.js'),
    import('../server/services/routeRuntimeExecutionIdentityService.js'),
    import('../server/services/routeGroupFallbackStageService.js'),
    import('../server/services/runtimeExecutionTargetFactsService.js'),
    import('../server/services/routeGroupManagementProjectionService.js'),
  ]);
  return {
    ...dbModule,
    ...facadeService,
    ...facadeAccess,
    ...executionTargetEndpointService,
    ...routeGraphService,
    ...runtimeExecutionTargetService,
    ...routeRuntimeExecutionIdentityService,
    ...fallbackStageService,
    ...executionTargetFactsService,
    ...managementProjectionService,
  };
}

export type RouteGroupMemberSnapshot = {
  id: string;
  routeGroupId: string;
  routeGroupKey: string;
  executionTargetId: number;
  accountId: number;
  tokenId: number | null;
  oauthRouteUnitId: number | null;
  sourceModel: string | null;
  fallbackStageId: string;
  fallbackStageKey: string;
  fallbackStageLabel: string | null;
  fallbackStageOrder: number;
  sortOrder: number;
  weight: number;
  enabled: boolean;
  manualOverride: boolean;
  successCount: number;
  failCount: number;
  totalLatencyMs: number;
  totalCost: number;
  lastUsedAt: string | null;
  lastSelectedAt: string | null;
  lastFailAt: string | null;
  consecutiveFailCount: number;
  cooldownLevel: number;
  cooldownUntil: string | null;
};

export type RouteGroupMemberTestInput = {
  groupId: string;
  accountId: number;
  tokenId?: number | null;
  oauthRouteUnitId?: number | null;
  sourceModel?: string | null;
  fallbackStageId?: string | null;
  fallbackStageOrder?: number | null;
  sortOrder?: number | null;
  weight?: number | null;
  enabled?: boolean | null;
  manualOverride?: boolean | null;
  successCount?: number | null;
  failCount?: number | null;
  totalLatencyMs?: number | null;
  totalCost?: number | null;
  lastUsedAt?: string | null;
  lastSelectedAt?: string | null;
  lastFailAt?: string | null;
  consecutiveFailCount?: number | null;
  cooldownLevel?: number | null;
  cooldownUntil?: string | null;
};

export type RouteGroupMemberTestPatch = Partial<Omit<RouteGroupMemberTestInput, 'groupId' | 'accountId'>> & {
  stageId?: string | null;
};

function text(value: unknown): string {
  return String(value || '').trim();
}

function positiveInteger(value: unknown, fallback = 0): number {
  const numeric = Math.trunc(Number(value));
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizedWeight(value: unknown): number {
  return positiveInteger(value, 10);
}

function stageOrder(value: unknown): number {
  const numeric = Math.trunc(Number(value));
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function memberId(): string {
  return createManagedRouteGraphElementId('member', randomUUID());
}

async function macroForGroup(groupId: string) {
  const { getActiveRouteGraphSourceVersion } = await runtime();
  const active = await getActiveRouteGraphSourceVersion();
  const macro = (active?.sourceGraph.macros || []).find((candidate) => candidate.id === text(groupId) && candidate.kind === 'candidate_selector');
  if (!active || !macro) throw new Error(`Route group ${groupId} does not exist`);
  return { active, macro };
}

async function resolveStage(groupId: string, stageId?: string | null, order?: number | null): Promise<string> {
  const { findRouteGroupFacadeStage, createRouteGroupFallbackStage } = await runtime();
  const { macro } = await macroForGroup(groupId);
  const requestedId = text(stageId);
  if (requestedId && findRouteGroupFacadeStage(macro, requestedId)) return requestedId;
  const requestedOrder = stageOrder(order);
  if (macro.config.groups[requestedOrder]) return macro.config.groups[requestedOrder]!.id;
  let next = macro.config.groups.length;
  let latest = macro;
  while (next <= requestedOrder) {
    await createRouteGroupFallbackStage(groupId, { label: null, enabled: true });
    latest = (await macroForGroup(groupId)).macro;
    next = latest.config.groups.length;
  }
  return latest.config.groups[requestedOrder]!.id;
}

async function upsertState(executionTargetId: number, input: RouteGroupMemberTestInput | RouteGroupMemberTestPatch): Promise<void> {
  const { db, schema, invalidateRouteRuntimeExecutionTargetState } = await runtime();
  const existing = await db.select().from(schema.runtimeExecutionTargetState)
    .where(eq(schema.runtimeExecutionTargetState.executionTargetId, executionTargetId))
    .get();
  const has = (key: keyof (RouteGroupMemberTestInput | RouteGroupMemberTestPatch)) => Object.hasOwn(input, key);
  const values = {
    successCount: has('successCount') ? input.successCount ?? 0 : existing?.successCount ?? 0,
    failCount: has('failCount') ? input.failCount ?? 0 : existing?.failCount ?? 0,
    totalLatencyMs: has('totalLatencyMs') ? input.totalLatencyMs ?? 0 : existing?.totalLatencyMs ?? 0,
    totalCost: has('totalCost') ? input.totalCost ?? 0 : existing?.totalCost ?? 0,
    lastUsedAt: has('lastUsedAt') ? input.lastUsedAt ?? null : existing?.lastUsedAt ?? null,
    lastSelectedAt: has('lastSelectedAt') ? input.lastSelectedAt ?? null : existing?.lastSelectedAt ?? null,
    lastFailAt: has('lastFailAt') ? input.lastFailAt ?? null : existing?.lastFailAt ?? null,
    consecutiveFailCount: has('consecutiveFailCount') ? input.consecutiveFailCount ?? 0 : existing?.consecutiveFailCount ?? 0,
    cooldownLevel: has('cooldownLevel') ? input.cooldownLevel ?? 0 : existing?.cooldownLevel ?? 0,
    cooldownUntil: has('cooldownUntil') ? input.cooldownUntil ?? null : existing?.cooldownUntil ?? null,
    updatedAt: new Date().toISOString(),
  };
  if (existing) {
    await db.update(schema.runtimeExecutionTargetState).set(values)
      .where(eq(schema.runtimeExecutionTargetState.id, existing.id)).run();
  } else {
    await db.insert(schema.runtimeExecutionTargetState).values({ executionTargetId, ...values }).run();
  }
  invalidateRouteRuntimeExecutionTargetState(executionTargetId);
}

async function snapshotFromMember(groupId: string, memberIdInput: string): Promise<RouteGroupMemberSnapshot | null> {
  const {
    db,
    schema,
    getActiveRouteGraphSourceVersion,
    findRouteGroupFacadeMember,
    executionTargetIdForRouteGraphEndpoint,
  } = await runtime();
  const active = await getActiveRouteGraphSourceVersion();
  const macro = (active?.sourceGraph.macros || []).find((candidate) => candidate.id === groupId && candidate.kind === 'candidate_selector');
  if (!active || !macro) return null;
  const found = findRouteGroupFacadeMember(macro, memberIdInput);
  const endpointId = found?.member.endpointId;
  if (!found || !endpointId) return null;
  const endpoint = active.sourceGraph.nodes.find((node) => node.type === 'route_endpoint' && node.routeEndpointId === endpointId);
  const executionTargetId = executionTargetIdForRouteGraphEndpoint(endpoint);
  if (executionTargetId == null) return null;
  const [target, state] = await Promise.all([
    db.select().from(schema.runtimeExecutionTargets).where(eq(schema.runtimeExecutionTargets.id, executionTargetId)).get(),
    db.select().from(schema.runtimeExecutionTargetState).where(eq(schema.runtimeExecutionTargetState.executionTargetId, executionTargetId)).get(),
  ]);
  if (!target) return null;
  const fallbackStageOrder = macro.config.groups.findIndex((stage) => stage.id === found.stage.id);
  const sortOrder = (found.stage.members || []).findIndex((member) => member.memberId === memberIdInput);
  return {
    id: memberIdInput,
    routeGroupId: groupId,
    routeGroupKey: groupId,
    executionTargetId,
    accountId: target.accountId ?? 0,
    tokenId: target.tokenId ?? null,
    oauthRouteUnitId: target.oauthRouteUnitId ?? null,
    sourceModel: target.upstreamModelName || null,
    fallbackStageId: found.stage.id,
    fallbackStageKey: found.stage.id,
    fallbackStageLabel: found.stage.label || null,
    fallbackStageOrder: Math.max(0, fallbackStageOrder),
    sortOrder: Math.max(0, sortOrder),
    weight: Number(found.member.weight || 10),
    enabled: found.member.enabled !== false && target.enabled !== false,
    manualOverride: found.member.metadata?.manualOverride === true,
    successCount: state?.successCount ?? 0,
    failCount: state?.failCount ?? 0,
    totalLatencyMs: state?.totalLatencyMs ?? 0,
    totalCost: state?.totalCost ?? 0,
    lastUsedAt: state?.lastUsedAt ?? null,
    lastSelectedAt: state?.lastSelectedAt ?? null,
    lastFailAt: state?.lastFailAt ?? null,
    consecutiveFailCount: state?.consecutiveFailCount ?? 0,
    cooldownLevel: state?.cooldownLevel ?? 0,
    cooldownUntil: state?.cooldownUntil ?? null,
  };
}

export async function clearRouteGroupMemberTestData(): Promise<void> {
  const { db, schema, getActiveRouteGraphSourceVersion, publishRouteGraphSource } = await runtime();
  const active = await getActiveRouteGraphSourceVersion();
  if (active) {
    const removedEndpointIds = new Set(active.sourceGraph.nodes
      .filter((node) => node.type === 'route_endpoint' && node.ownerKind === 'macro' && node.provenance?.generatedBy === 'route-group-facade')
      .map((node) => node.id));
    const source = {
      ...active.sourceGraph,
      macros: [],
      nodes: active.sourceGraph.nodes.filter((node) => !removedEndpointIds.has(node.id)),
      edges: active.sourceGraph.edges.filter((edge) => !removedEndpointIds.has(edge.sourceNodeId) && !removedEndpointIds.has(edge.targetNodeId)),
    };
    const published = await publishRouteGraphSource({ sourceGraph: source, createdBy: 'test-member-reset', allowDiagnostics: true });
    if (!published.ok) throw new Error(`Failed to clear test route Graph: ${published.diagnostics.map((item) => item.message).join('; ')}`);
  }
  await db.delete(schema.runtimeExecutionTargetState).run();
  await db.delete(schema.runtimeExecutionTargets).run();
}

export async function insertRouteGroupMember(input: RouteGroupMemberTestInput): Promise<RouteGroupMemberSnapshot> {
  const {
    routeGroupFacadeModelName,
    upsertRuntimeExecutionTarget,
    mutateRouteGroupFacadeGraph,
    routeGroupFacadeMacroOrThrow,
    findRouteGroupFacadeStage,
    ensureRouteGraphExecutionTargetEndpoint,
    replaceRouteGroupFacadeMacroInSource,
  } = await runtime();
  const groupId = text(input.groupId);
  const { macro } = await macroForGroup(groupId);
  const sourceModel = text(input.sourceModel) || routeGroupFacadeModelName(macro);
  if (!sourceModel) throw new Error('sourceModel is required');
  const stageId = await resolveStage(groupId, input.fallbackStageId, input.fallbackStageOrder);
  const target = await upsertRuntimeExecutionTarget({
    accountId: input.accountId,
    tokenId: input.tokenId ?? null,
    oauthRouteUnitId: input.oauthRouteUnitId ?? null,
    sourceModel,
    enabled: input.enabled !== false,
    discovered: false,
    source: 'test-route-group-member',
    metadata: { source: 'test-route-group-member', manualOverride: input.manualOverride === true },
  });
  let persistedMemberId = '';
  await mutateRouteGroupFacadeGraph({
    createdBy: 'test-route-group-member',
    mutate: (source) => {
      const current = routeGroupFacadeMacroOrThrow(source, groupId);
      const stage = findRouteGroupFacadeStage(current, stageId);
      if (!stage) throw new Error('Fallback stage does not belong to the test route group');
      const ensured = ensureRouteGraphExecutionTargetEndpoint(source, {
        id: target.id,
        sourceRef: target.sourceRef,
        upstreamModelName: target.upstreamModelName,
        enabled: target.enabled !== false,
      }, {
        ownership: 'derived',
        ownerKind: 'macro',
        provenance: { source: 'generated', generatedBy: 'route-group-facade' },
      });
      const duplicate = (stage.members || []).find((member) => member.endpointId === ensured.endpoint.routeEndpointId);
      persistedMemberId = duplicate?.memberId || memberId();
      const nextMacro = {
        ...current,
        config: {
          ...current.config,
          groups: current.config.groups.map((candidate) => candidate.id === stage.id ? {
            ...candidate,
            members: duplicate
              ? (candidate.members || []).map((member) => member.memberId === duplicate.memberId ? {
                ...member,
                enabled: input.enabled !== false,
                weight: normalizedWeight(input.weight),
                metadata: { ...member.metadata, manualOverride: input.manualOverride === true },
              } : member)
              : [...(candidate.members || []), {
                memberId: persistedMemberId,
                endpointId: ensured.endpoint.routeEndpointId,
                enabled: input.enabled !== false,
                weight: normalizedWeight(input.weight),
                metadata: { manualOverride: input.manualOverride === true },
              }],
          } : candidate),
        },
      };
      return { source: replaceRouteGroupFacadeMacroInSource(ensured.source, nextMacro), result: undefined };
    },
  });
  await upsertState(target.id, input);
  const result = await snapshotFromMember(groupId, persistedMemberId);
  if (!result) throw new Error('Failed to load test route group member');
  return result;
}

export async function insertRouteGroupMembers(inputs: RouteGroupMemberTestInput[]): Promise<RouteGroupMemberSnapshot[]> {
  const result: RouteGroupMemberSnapshot[] = [];
  for (const input of inputs) result.push(await insertRouteGroupMember(input));
  return result;
}

export async function getRouteGroupMember(memberIdInput: string): Promise<RouteGroupMemberSnapshot | null> {
  const { getActiveRouteGraphSourceVersion, findRouteGroupFacadeMember } = await runtime();
  const active = await getActiveRouteGraphSourceVersion();
  for (const macro of active?.sourceGraph.macros || []) {
    if (macro.kind !== 'candidate_selector') continue;
    if (findRouteGroupFacadeMember(macro, memberIdInput)) return await snapshotFromMember(macro.id, memberIdInput);
  }
  return null;
}

export async function updateRouteGroupMember(memberIdInput: string, patch: RouteGroupMemberTestPatch): Promise<RouteGroupMemberSnapshot | null> {
  const {
    upsertRuntimeExecutionTarget,
    mutateRouteGroupFacadeGraph,
    routeGroupFacadeMacroOrThrow,
    findRouteGroupFacadeMember,
    ensureRouteGraphExecutionTargetEndpoint,
    replaceRouteGroupFacadeMacroInSource,
  } = await runtime();
  const existing = await getRouteGroupMember(memberIdInput);
  if (!existing) return null;
  const sourceModel = text(patch.sourceModel ?? existing.sourceModel);
  const target = await upsertRuntimeExecutionTarget({
    accountId: existing.accountId,
    tokenId: patch.tokenId === undefined ? existing.tokenId : patch.tokenId,
    oauthRouteUnitId: patch.oauthRouteUnitId === undefined ? existing.oauthRouteUnitId : patch.oauthRouteUnitId,
    sourceModel,
    enabled: patch.enabled ?? existing.enabled,
    discovered: false,
    source: 'test-route-group-member',
    metadata: { source: 'test-route-group-member', manualOverride: patch.manualOverride ?? existing.manualOverride },
  });
  const destinationStageId = await resolveStage(existing.routeGroupId, patch.stageId ?? patch.fallbackStageId, patch.fallbackStageOrder ?? existing.fallbackStageOrder);
  await mutateRouteGroupFacadeGraph({
    createdBy: 'test-route-group-member',
    mutate: (source) => {
      const macro = routeGroupFacadeMacroOrThrow(source, existing.routeGroupId);
      const found = findRouteGroupFacadeMember(macro, memberIdInput);
      if (!found) throw new Error('Route group member does not exist');
      const ensured = ensureRouteGraphExecutionTargetEndpoint(source, {
        id: target.id,
        sourceRef: target.sourceRef,
        upstreamModelName: target.upstreamModelName,
        enabled: target.enabled !== false,
      }, {
        ownership: 'derived',
        ownerKind: 'macro',
        provenance: { source: 'generated', generatedBy: 'route-group-facade' },
      });
      const member = {
        ...found.member,
        endpointId: ensured.endpoint.routeEndpointId,
        enabled: patch.enabled ?? found.member.enabled !== false,
        weight: patch.weight === undefined ? found.member.weight : normalizedWeight(patch.weight),
        metadata: { ...found.member.metadata, manualOverride: patch.manualOverride ?? existing.manualOverride },
      };
      const without = macro.config.groups.map((stage) => ({ ...stage, members: (stage.members || []).filter((candidate) => candidate.memberId !== memberIdInput) }));
      const nextMacro = {
        ...macro,
        config: {
          ...macro.config,
          groups: without.map((stage) => stage.id === destinationStageId ? {
            ...stage,
            members: [...(stage.members || []), member],
          } : stage),
        },
      };
      return { source: replaceRouteGroupFacadeMacroInSource(ensured.source, nextMacro), result: undefined };
    },
  });
  await upsertState(target.id, patch);
  return await snapshotFromMember(existing.routeGroupId, memberIdInput);
}

export async function getExecutionTargetIdForMember(memberIdInput: string): Promise<number | null> {
  return (await getRouteGroupMember(memberIdInput))?.executionTargetId ?? null;
}

export async function listRouteGroupMembersForGroup(groupId: string): Promise<RouteGroupMemberSnapshot[]> {
  const { getActiveRouteGraphSourceVersion } = await runtime();
  const active = await getActiveRouteGraphSourceVersion();
  const macro = (active?.sourceGraph.macros || []).find((candidate) => candidate.id === groupId && candidate.kind === 'candidate_selector');
  if (!macro) return [];
  const result: RouteGroupMemberSnapshot[] = [];
  for (const stage of macro.config.groups) {
    for (const member of stage.members || []) {
      if (!member.memberId) continue;
      const snapshot = await snapshotFromMember(groupId, member.memberId);
      if (snapshot) result.push(snapshot);
    }
  }
  return result;
}

export async function listRouteGroupMembersByIds(memberIds: string[]): Promise<RouteGroupMemberSnapshot[]> {
  const result: RouteGroupMemberSnapshot[] = [];
  for (const memberIdInput of memberIds) {
    const snapshot = await getRouteGroupMember(memberIdInput);
    if (snapshot) result.push(snapshot);
  }
  return result;
}

export async function listAllRouteGroupMembers(): Promise<RouteGroupMemberSnapshot[]> {
  const { getActiveRouteGraphSourceVersion } = await runtime();
  const active = await getActiveRouteGraphSourceVersion();
  const result: RouteGroupMemberSnapshot[] = [];
  for (const macro of active?.sourceGraph.macros || []) {
    if (macro.kind === 'candidate_selector') result.push(...await listRouteGroupMembersForGroup(macro.id));
  }
  return result;
}

export async function listAllRouteGroupEndpointMembers() {
  const {
    getActiveRouteGraphSourceVersion,
    loadRuntimeExecutionTargetFacts,
    projectRouteGroupFallbackStagesFromGraph,
  } = await runtime();
  const [active, facts] = await Promise.all([
    getActiveRouteGraphSourceVersion(),
    loadRuntimeExecutionTargetFacts(),
  ]);
  if (!active) return [];
  return active.sourceGraph.macros.flatMap((macro) => (
    macro.kind === 'candidate_selector'
      ? (projectRouteGroupFallbackStagesFromGraph(active.sourceGraph, macro.id, facts) || [])
        .flatMap((stage) => stage.candidates)
        .filter((candidate) => candidate.kind === 'execution_endpoint')
      : []
  ));
}

export async function deleteRouteGroupMembersForGroup(groupId: string): Promise<void> {
  const { mutateRouteGroupFacadeGraph, routeGroupFacadeMacroOrThrow, replaceRouteGroupFacadeMacroInSource } = await runtime();
  const existing = await listRouteGroupMembersForGroup(groupId);
  if (existing.length === 0) return;
  await mutateRouteGroupFacadeGraph({
    createdBy: 'test-route-group-member',
    mutate: (source) => {
      const macro = routeGroupFacadeMacroOrThrow(source, groupId);
      const nextMacro = {
        ...macro,
        config: { ...macro.config, groups: macro.config.groups.map((stage) => ({ ...stage, members: [] })) },
      };
      return { source: replaceRouteGroupFacadeMacroInSource(source, nextMacro), result: undefined };
    },
  });
}
