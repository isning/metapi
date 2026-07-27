import {
  createRouteGroupCandidate,
  createRouteGroupCandidates,
  deleteRouteGroupCandidate,
  listRouteGroupCandidatesByGroupKeys,
  loadRouteGroupCandidate,
  moveRouteGroupCandidatesToFallbackStages,
  restoreAutomaticRouteGroupCandidateManagement,
  routeGroupMembersBelongToGroup,
  updateRouteGroupMember,
  type RouteGroupCandidateUpdateInput,
} from './routeGroupCandidateService.js';
import { loadRouteGroupByKey } from './routeGroupManagementService.js';
import { RouteGroupCommandError } from './routeGroupCommandError.js';

function text(value: unknown): string {
  return String(value || '').trim();
}

export async function createRouteGroupCandidateCommand(input: {
  routeGroupId: string;
  sourceRef: string;
  stageId?: string;
  weight?: number;
}) {
  const group = await loadRouteGroupByKey(text(input.routeGroupId));
  if (!group) throw new RouteGroupCommandError('route_group_not_found');
  const candidates = await listRouteGroupCandidatesByGroupKeys([group.groupKey]);
  if ((candidates.get(group.groupKey) || []).some((candidate) => (
    candidate.kind === 'execution_endpoint'
    && candidate.targets.some((target) => target.sourceRef === input.sourceRef)
  ))) {
    throw new RouteGroupCommandError('duplicate_candidate');
  }
  let created;
  try {
    created = await createRouteGroupCandidate({
      routeGroupKey: group.groupKey,
      sourceRef: input.sourceRef,
      stageId: input.stageId,
      weight: input.weight ?? 10,
      manualOverride: true,
    });
  } catch (error) {
    throw error;
  }
  if (!created) throw new RouteGroupCommandError('candidate_create_failed');
  return created;
}

export async function batchCreateRouteGroupCandidatesCommand(input: {
  routeGroupId: string;
  sourceRefs: string[];
  stageId?: string;
}): Promise<{ created: number; skipped: number; errors: string[] }> {
  const group = await loadRouteGroupByKey(text(input.routeGroupId));
  if (!group) throw new RouteGroupCommandError('route_group_not_found');
  const existing = await listRouteGroupCandidatesByGroupKeys([group.groupKey]);
  const existingKeys = new Set(
    (existing.get(group.groupKey) || [])
      .filter((candidate) => candidate.kind === 'execution_endpoint')
      .flatMap((candidate) => candidate.targets.map((target) => target.sourceRef)),
  );
  let skipped = 0;
  const prepared: string[] = [];

  for (const sourceRef of input.sourceRefs) {
    if (existingKeys.has(sourceRef)) {
      skipped += 1;
      continue;
    }
    existingKeys.add(sourceRef);
    prepared.push(sourceRef);
  }
  let created;
  try {
    created = await createRouteGroupCandidates({
      routeGroupKey: group.groupKey,
      stageId: input.stageId,
      candidates: prepared.map((sourceRef) => ({ sourceRef, weight: 10, manualOverride: true })),
    });
  } catch (error) {
    throw error;
  }
  return { created: created.length, skipped, errors: [] };
}

export async function updateRouteGroupCandidateCommand(input: {
  routeGroupId: string;
  candidateId: string;
  patch: RouteGroupCandidateUpdateInput;
}) {
  const routeGroupId = text(input.routeGroupId);
  const candidate = await loadRouteGroupCandidate(routeGroupId, text(input.candidateId));
  if (!candidate) throw new RouteGroupCommandError('candidate_not_found');
  const group = await loadRouteGroupByKey(routeGroupId);
  if (!group) throw new RouteGroupCommandError('route_group_not_found');
  const updated = await updateRouteGroupMember(routeGroupId, candidate.id, input.patch);
  if (!updated) throw new RouteGroupCommandError('candidate_not_found');
  return updated;
}

export async function deleteRouteGroupCandidateCommand(routeGroupId: string, candidateId: string): Promise<void> {
  const candidate = await loadRouteGroupCandidate(text(routeGroupId), text(candidateId));
  if (!candidate) throw new RouteGroupCommandError('candidate_not_found');
  await deleteRouteGroupCandidate(text(routeGroupId), candidate.id);
}

export async function moveRouteGroupCandidatesCommand(input: {
  routeGroupId: string;
  updates: Array<{ id: string; stageId: string; sortOrder?: number }>;
  manuallyAdjustedCandidateIds?: string[];
}) {
  const group = await loadRouteGroupByKey(text(input.routeGroupId));
  if (!group) throw new RouteGroupCommandError('route_group_not_found');
  const membership = await routeGroupMembersBelongToGroup(group.groupKey, input.updates.map((item) => item.id));
  if (!membership.ok) throw new RouteGroupCommandError('candidate_not_found');
  return await moveRouteGroupCandidatesToFallbackStages(group.groupKey, input.updates, {
    manuallyAdjustedCandidateIds: input.manuallyAdjustedCandidateIds,
  });
}

export async function restoreRouteGroupCandidateManagementCommand(input: {
  routeGroupId: string;
  candidateIds?: string[];
}) {
  const group = await loadRouteGroupByKey(text(input.routeGroupId));
  if (!group) throw new RouteGroupCommandError('route_group_not_found');
  try {
    return await restoreAutomaticRouteGroupCandidateManagement(group.id, input.candidateIds);
  } catch (error) {
    throw error;
  }
}
