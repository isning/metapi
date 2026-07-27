import { randomUUID } from 'node:crypto';
import { schema } from '../db/index.js';
import {
  createManagedRouteGraphElementId,
  createRouteSupplyCredentialKey,
  createRouteSupplyKey,
} from '../../shared/routingIdentity.js';
import {
  normalizeDispatcherPolicy,
  type CandidateSelectorMacroConfig,
  type DispatcherPolicy,
  type RouteGraphSource,
} from '../../shared/routeGraph.js';
import {
  createRouteGroupFacadeMacro,
  type RouteGroupFacadeMemberReference,
  type RouteGroupFacadeStage,
} from './routeGroupGraphFacadeService.js';
import { ensureRouteGraphExecutionTargetEndpoint } from './routeGraphExecutionTargetEndpointService.js';

type SiteRow = typeof schema.sites.$inferSelect;
type AccountRow = typeof schema.accounts.$inferSelect;
type AccountTokenRow = typeof schema.accountTokens.$inferSelect;
type RuntimeExecutionTargetRow = typeof schema.runtimeExecutionTargets.$inferSelect;
type RuntimeExecutionTargetStateRow = typeof schema.runtimeExecutionTargetState.$inferSelect;

export type BackupImportRouteRuntimeSection = {
  sites: SiteRow[];
  accounts: AccountRow[];
  accountTokens: AccountTokenRow[];
  runtimeExecutionTargets?: RuntimeExecutionTargetRow[];
  runtimeExecutionTargetState?: RuntimeExecutionTargetStateRow[];
};

type BackupImportNormalizationNotice = {
  code: 'automatic_model_normalized_coalesced' | 'public_model_conflict_demoted';
  level: 'warning';
  normalizedModelName: string;
  sourceNames?: string[];
  groupKey?: string;
  demotedGroup?: string;
  keptGroup?: string;
  action: string;
  message: string;
};

export type BackupImportUnresolvedRouteMemberReason =
  | 'execution_target_missing'
  | 'account_missing'
  | 'source_route_missing'
  | 'member_reference_invalid';

type BackupImportUnresolvedRouteMemberNotice = {
  code: 'route_member_unresolved';
  level: 'warning';
  groupKey: string;
  groupLabel: string;
  memberReferenceKind: 'execution_target' | 'source_route' | 'candidate' | 'route_endpoint';
  memberReference: string;
  reason: BackupImportUnresolvedRouteMemberReason;
};

export type BackupImportNotice =
  | BackupImportNormalizationNotice
  | BackupImportUnresolvedRouteMemberNotice;

export type BackupImportRouteRuntimeMigrationResult = {
  section: BackupImportRouteRuntimeSection;
  graphSource?: RouteGraphSource;
  warnings: string[];
  notices: BackupImportNotice[];
};

type JsonRecord = Record<string, unknown>;

type LegacyStageMember = {
  executionTargetId?: number;
  childGroupId?: string;
  sourceReferenceKind: BackupImportUnresolvedRouteMemberNotice['memberReferenceKind'];
  sourceReference: string;
  unresolvedReason?: BackupImportUnresolvedRouteMemberReason;
  enabled: boolean;
  weight: number;
  manualOverride: boolean;
};

type LegacyStage = {
  key: string;
  sortOrder: number;
  label: string | null;
  enabled: boolean;
  policy: DispatcherPolicy | null;
  members: LegacyStageMember[];
};

type LegacyFacadeGroup = {
  sourceIds: string[];
  sourceModelNames: string[];
  kind: 'automatic' | 'manual';
  modelName: string;
  normalizedModelName: string;
  displayName: string;
  displayIcon: string | null;
  visibility: 'public' | 'internal';
  enabled: boolean;
  policy: DispatcherPolicy;
  filters?: CandidateSelectorMacroConfig['filters'];
  stages: LegacyStage[];
};

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readArray(source: JsonRecord, ...keys: string[]): unknown[] {
  for (const key of keys) {
    if (Array.isArray(source[key])) return source[key] as unknown[];
  }
  return [];
}

function readText(source: JsonRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** Historical backups used numeric primary keys for route, stage and member references. */
function readIdentifier(source: JsonRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  }
  return '';
}

function readNumber(source: JsonRecord, fallback: number, ...keys: string[]): number {
  for (const key of keys) {
    const value = Number(source[key]);
    if (Number.isFinite(value)) return Math.trunc(value);
  }
  return fallback;
}

function readPositiveInteger(source: JsonRecord, ...keys: string[]): number | null {
  const value = readNumber(source, 0, ...keys);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function readBoolean(source: JsonRecord, fallback: boolean, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
  }
  return fallback;
}

function readJsonRecord(source: JsonRecord, ...keys: string[]): JsonRecord {
  for (const key of keys) {
    const value = source[key];
    if (isRecord(value)) return value;
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isRecord(parsed)) return parsed;
    } catch {
      // Historical malformed optional configuration is ignored at import.
    }
  }
  return {};
}

function normalizeModelName(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function opaqueId(kind: 'macro' | 'stage' | 'member'): string {
  return createManagedRouteGraphElementId(kind, randomUUID());
}

function legacyPolicy(value: unknown): DispatcherPolicy {
  if (isRecord(value)) return normalizeDispatcherPolicy(value);
  const kind = String(value || '').trim().toLowerCase();
  if (kind === 'round_robin' || kind === 'stable_first') {
    return { kind: 'builtin', builtin: kind };
  }
  return { kind: 'inherit_default' };
}

function routeGroupModelName(group: JsonRecord): string {
  return readText(group, 'publicModelName', 'public_model_name')
    || readText(group, 'normalizedModelName', 'normalized_model_name')
    || readText(group, 'upstreamModelName', 'upstream_model_name')
    || readText(group, 'displayName', 'display_name');
}

function routeGroupDisplayName(group: JsonRecord, fallback: string): string {
  return readText(group, 'displayName', 'display_name') || fallback;
}

function isLegacyManualRoute(route: JsonRecord): boolean {
  const routeMode = readText(route, 'routeMode', 'route_mode');
  const backend = readJsonRecord(route, 'backend');
  return routeMode === 'explicit_group'
    || backend.kind === 'route_endpoints'
    || backend.kind === 'routes'
    || backend.kind === 'legacy_routes'
    || (!readText(route, 'modelPattern', 'model_pattern') && !!readText(route, 'displayName', 'display_name'));
}

function previousRouteModelName(route: JsonRecord): string {
  const match = readJsonRecord(route, 'match');
  return readText(route, 'modelPattern', 'model_pattern')
    || readText(match, 'requestedModelPattern')
    || readText(route, 'displayName', 'display_name')
    || readText(match, 'displayName');
}

function previousRouteDisplayName(route: JsonRecord, fallback: string): string {
  const match = readJsonRecord(route, 'match');
  return readText(route, 'displayName', 'display_name') || readText(match, 'displayName') || fallback;
}

function hasHistoricalRouteGroupInput(raw: JsonRecord): boolean {
  return [
    'routeGroups',
    'route_groups',
    'routeGroupFallbackStages',
    'route_group_fallback_stages',
    'routeGroupCandidates',
    'route_group_candidates',
    'routeGroupBuckets',
    'route_group_buckets',
    'tokenRoutes',
    'token_routes',
    'routeEndpointTargets',
    'route_endpoint_targets',
    'routeBindingProjections',
    'route_binding_projections',
  ].some((key) => Array.isArray(raw[key]));
}

/** Historical routes are accepted only by the import boundary. */
export function importedBackupRequiresRouteGraphRebuild(rawAccountsSection: unknown): boolean {
  return isRecord(rawAccountsSection) && hasHistoricalRouteGroupInput(rawAccountsSection);
}

function executionTargetKey(modelName: string, accountId: number, tokenId: number | null, oauthRouteUnitId: number | null): string {
  return createRouteSupplyKey({
    modelName,
    credentialKey: createRouteSupplyCredentialKey({ accountId, tokenId, oauthRouteUnitId }),
  });
}

function parseFilters(group: JsonRecord): CandidateSelectorMacroConfig['filters'] | undefined {
  const config = { ...readJsonRecord(group, 'configJson', 'config_json'), ...readJsonRecord(group, 'userOverrideJson', 'user_override_json') };
  const filters = config.filters;
  return isRecord(filters) && Array.isArray(filters.operations)
    ? { operations: filters.operations as NonNullable<CandidateSelectorMacroConfig['filters']>['operations'] }
    : undefined;
}

function addWarningsForPublicModelConflicts(groups: LegacyFacadeGroup[]): { warnings: string[]; notices: BackupImportNotice[] } {
  const warnings: string[] = [];
  const notices: BackupImportNotice[] = [];
  const exposed = new Map<string, LegacyFacadeGroup>();
  for (const group of groups) {
    if (group.visibility !== 'public') continue;
    const key = normalizeModelName(group.modelName);
    if (!key) continue;
    const existing = exposed.get(key);
    if (!existing) {
      exposed.set(key, group);
      continue;
    }
    const demoted = existing.kind === 'automatic' && group.kind !== 'automatic' ? existing : group;
    const kept = demoted === existing ? group : existing;
    demoted.visibility = 'internal';
    exposed.set(key, kept);
    const action = `将自动路由组 ${demoted.displayName} 设为内部，仅保留 ${kept.displayName} 的公开入口`;
    const message = `导入配置时检测到公开模型名 ${key} 重复，已${action}。`;
    warnings.push(message);
    notices.push({
      code: 'public_model_conflict_demoted',
      level: 'warning',
      normalizedModelName: key,
      demotedGroup: demoted.displayName,
      keptGroup: kept.displayName,
      action,
      message,
    });
  }
  return { warnings, notices };
}

function ensureStage(group: LegacyFacadeGroup, key: string, sortOrder: number, options: {
  label?: string | null;
  enabled?: boolean;
  policy?: DispatcherPolicy | null;
} = {}): LegacyStage {
  const existing = group.stages.find((stage) => stage.key === key);
  if (existing) return existing;
  const stage: LegacyStage = {
    key,
    sortOrder,
    label: options.label || null,
    enabled: options.enabled !== false,
    policy: options.policy || null,
    members: [],
  };
  group.stages.push(stage);
  return stage;
}

function uniqueGroupsByAutomaticModel(groups: LegacyFacadeGroup[]): { groups: LegacyFacadeGroup[]; warnings: string[]; notices: BackupImportNotice[]; sourceIdMap: Map<string, LegacyFacadeGroup> } {
  const automaticByModel = new Map<string, LegacyFacadeGroup>();
  const sourceIdMap = new Map<string, LegacyFacadeGroup>();
  const result: LegacyFacadeGroup[] = [];
  const warnings: string[] = [];
  const notices: BackupImportNotice[] = [];
  for (const originalGroup of groups) {
    const group = originalGroup.kind === 'automatic' && originalGroup.normalizedModelName
      ? {
        ...originalGroup,
        modelName: originalGroup.normalizedModelName,
        displayName: originalGroup.normalizedModelName,
      }
      : originalGroup;
    if (group.kind !== 'automatic') {
      result.push(group);
      for (const sourceId of group.sourceIds) sourceIdMap.set(sourceId, group);
      continue;
    }
    const existing = automaticByModel.get(group.normalizedModelName);
    if (!existing) {
      automaticByModel.set(group.normalizedModelName, group);
      result.push(group);
      for (const sourceId of group.sourceIds) sourceIdMap.set(sourceId, group);
      continue;
    }
    for (const stage of group.stages) {
      const merged = ensureStage(existing, stage.key, stage.sortOrder, stage);
      merged.members.push(...stage.members);
    }
    for (const sourceId of group.sourceIds) sourceIdMap.set(sourceId, existing);
    const sourceNames = Array.from(new Set([...existing.sourceModelNames, ...group.sourceModelNames]));
    existing.sourceModelNames = sourceNames;
    if (sourceNames.length > 1) {
      const action = `合并为一个自动路由组 ${existing.displayName}`;
      const message = `导入配置时检测到自动模型名 ${sourceNames.join(' 与 ')} 归一化后同为 ${group.normalizedModelName}，已${action}。`;
      warnings.push(message);
      notices.push({
        code: 'automatic_model_normalized_coalesced',
        level: 'warning',
        normalizedModelName: group.normalizedModelName,
        sourceNames,
        action,
        message,
      });
    }
  }
  return { groups: result, warnings, notices, sourceIdMap };
}

function parseLegacyStoredRouteGroups(raw: JsonRecord): LegacyFacadeGroup[] {
  const groupRows = readArray(raw, 'routeGroups', 'route_groups').filter(isRecord);
  const stageRows = readArray(raw, 'routeGroupFallbackStages', 'route_group_fallback_stages').filter(isRecord);
  const candidateRows = readArray(raw, 'routeGroupCandidates', 'route_group_candidates').filter(isRecord);
  const stagesByGroup = new Map<string, JsonRecord[]>();
  for (const stage of stageRows) {
    const groupId = readIdentifier(stage, 'groupId', 'group_id');
    if (!groupId) continue;
    const stages = stagesByGroup.get(groupId) || [];
    stages.push(stage);
    stagesByGroup.set(groupId, stages);
  }
  const candidatesByStage = new Map<string, JsonRecord[]>();
  for (const candidate of candidateRows) {
    const stageId = readIdentifier(candidate, 'stageId', 'stage_id');
    if (!stageId) continue;
    const candidates = candidatesByStage.get(stageId) || [];
    candidates.push(candidate);
    candidatesByStage.set(stageId, candidates);
  }
  return groupRows.flatMap((group): LegacyFacadeGroup[] => {
    const sourceId = readIdentifier(group, 'id');
    const modelName = routeGroupModelName(group);
    if (!sourceId || !modelName) return [];
    const kind = readText(group, 'kind') === 'manual' ? 'manual' : 'automatic';
    const result: LegacyFacadeGroup = {
      sourceIds: [sourceId],
      sourceModelNames: [modelName],
      kind,
      modelName,
      normalizedModelName: normalizeModelName(modelName),
      displayName: routeGroupDisplayName(group, modelName),
      displayIcon: readText(group, 'displayIcon', 'display_icon') || null,
      visibility: readText(group, 'visibility') === 'internal' ? 'internal' : 'public',
      enabled: readBoolean(group, true, 'enabled') && readText(group, 'syncStatus', 'sync_status') !== 'unresolved',
      policy: legacyPolicy(readJsonRecord(group, 'dispatcherPolicyJson', 'dispatcher_policy_json')),
      filters: parseFilters(group),
      stages: [],
    };
    const stages = [...(stagesByGroup.get(sourceId) || [])].sort((left, right) => (
      readNumber(left, 0, 'sortOrder', 'sort_order') - readNumber(right, 0, 'sortOrder', 'sort_order')
    ));
    for (const [index, stageRow] of stages.entries()) {
      const stageId = readIdentifier(stageRow, 'id') || String(index);
      const stage = ensureStage(result, stageId, readNumber(stageRow, index, 'sortOrder', 'sort_order'), {
        label: readText(stageRow, 'label') || null,
        enabled: readBoolean(stageRow, true, 'enabled'),
        policy: legacyPolicy(readJsonRecord(stageRow, 'dispatcherPolicyJson', 'dispatcher_policy_json')),
      });
      const candidates = [...(candidatesByStage.get(stageId) || [])].sort((left, right) => (
        readNumber(left, 0, 'sortOrder', 'sort_order') - readNumber(right, 0, 'sortOrder', 'sort_order')
      ));
      for (const candidate of candidates) {
        const executionTargetId = readPositiveInteger(candidate, 'executionTargetId', 'execution_target_id') || undefined;
        const childGroupId = readIdentifier(candidate, 'childGroupId', 'child_group_id') || undefined;
        const candidateId = readIdentifier(candidate, 'id') || `stage:${stageId}:member`;
        stage.members.push({
          executionTargetId,
          childGroupId,
          sourceReferenceKind: executionTargetId
            ? 'execution_target'
            : childGroupId
              ? 'source_route'
              : 'candidate',
          sourceReference: executionTargetId
            ? String(executionTargetId)
            : childGroupId || candidateId,
          ...(!executionTargetId && !childGroupId ? { unresolvedReason: 'member_reference_invalid' as const } : {}),
          enabled: readBoolean(candidate, true, 'enabled'),
          weight: Math.max(1, readNumber(candidate, 10, 'weight')),
          manualOverride: readBoolean(candidate, false, 'manualOverride', 'manual_override'),
        });
      }
    }
    if (result.stages.length === 0) ensureStage(result, opaqueId('stage'), 0);
    return [result];
  });
}

function maxId(rows: Array<{ id: number }>): number {
  return rows.reduce((maximum, row) => Math.max(maximum, Number(row.id) || 0), 0);
}

function convertPreviousTokenRoutes(input: {
  raw: JsonRecord;
  section: BackupImportRouteRuntimeSection;
}): { groups: LegacyFacadeGroup[]; targets: RuntimeExecutionTargetRow[]; state: RuntimeExecutionTargetStateRow[] } {
  const routes = readArray(input.raw, 'tokenRoutes', 'token_routes', 'routes').filter(isRecord);
  const endpointRows = readArray(input.raw, 'routeEndpointTargets', 'route_endpoint_targets', 'routeChannels', 'route_channels', 'targets').filter(isRecord);
  const routeGroupSourceRows = readArray(input.raw, 'routeGroupSources', 'route_group_sources').filter(isRecord);
  const accounts = new Map(input.section.accounts.map((account) => [account.id, account]));
  const tokenIds = new Set(input.section.accountTokens.map((token) => token.id));
  const endpointsByRoute = new Map<string, JsonRecord[]>();
  for (const endpoint of endpointRows) {
    const routeId = readIdentifier(endpoint, 'routeId', 'route_id');
    if (!routeId) continue;
    const endpoints = endpointsByRoute.get(routeId) || [];
    endpoints.push(endpoint);
    endpointsByRoute.set(routeId, endpoints);
  }
  const sourceRouteIdsByGroupRouteId = new Map<string, string[]>();
  for (const source of routeGroupSourceRows) {
    const groupRouteId = readIdentifier(source, 'groupRouteId', 'group_route_id', 'routeId', 'route_id');
    const sourceRouteId = readIdentifier(source, 'sourceRouteId', 'source_route_id', 'childRouteId', 'child_route_id');
    if (!groupRouteId || !sourceRouteId) continue;
    const references = sourceRouteIdsByGroupRouteId.get(groupRouteId) || [];
    if (!references.includes(sourceRouteId)) references.push(sourceRouteId);
    sourceRouteIdsByGroupRouteId.set(groupRouteId, references);
  }
  const targets = [...(input.section.runtimeExecutionTargets || [])];
  const state = [...(input.section.runtimeExecutionTargetState || [])];
  const targetIdByKey = new Map(targets.map((target) => [target.executionKey, target.id]));
  let nextTargetId = maxId(targets) + 1;
  let nextStateId = maxId(state) + 1;

  const ensureTarget = (endpoint: JsonRecord, modelName: string):
    | { executionTargetId: number }
    | { reason: 'account_missing' } => {
    const accountId = readPositiveInteger(endpoint, 'accountId', 'account_id');
    if (!accountId) return { reason: 'account_missing' };
    const account = accounts.get(accountId);
    if (!account) return { reason: 'account_missing' };
    const rawTokenId = readPositiveInteger(endpoint, 'tokenId', 'token_id');
    const tokenId = rawTokenId && tokenIds.has(rawTokenId) ? rawTokenId : null;
    const key = executionTargetKey(modelName, accountId, tokenId, null);
    const existing = targetIdByKey.get(key);
    if (existing) return { executionTargetId: existing };
    const id = nextTargetId++;
    targetIdByKey.set(key, id);
    const timestamp = new Date().toISOString();
    targets.push({
      id,
      sourceRef: randomUUID(),
      executionKey: key,
      siteId: account.siteId,
      accountId,
      tokenId,
      oauthRouteUnitId: null,
      credentialBindingId: null,
      endpointProfileId: null,
      upstreamModelName: modelName,
      normalizedModelName: normalizeModelName(modelName),
      enabled: readBoolean(endpoint, true, 'enabled'),
      discovered: false,
      source: 'backup_import',
      metadataJson: JSON.stringify({ source: 'legacy_backup' }),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const successCount = Math.max(0, readNumber(endpoint, 0, 'successCount', 'success_count'));
    state.push({
      id: nextStateId++,
      executionTargetId: id,
      successCount,
      failCount: Math.max(0, readNumber(endpoint, 0, 'failCount', 'fail_count')),
      totalLatencyMs: Math.max(0, readNumber(endpoint, 0, 'totalLatencyMs', 'total_latency_ms')),
      latencySampleCount: Math.max(0, readNumber(endpoint, successCount, 'latencySampleCount', 'latency_sample_count')),
      lastUsedAt: readText(endpoint, 'lastUsedAt', 'last_used_at') || null,
      lastSelectedAt: readText(endpoint, 'lastSelectedAt', 'last_selected_at') || null,
      lastFailAt: readText(endpoint, 'lastFailAt', 'last_fail_at') || null,
      consecutiveFailCount: Math.max(0, readNumber(endpoint, 0, 'consecutiveFailCount', 'consecutive_fail_count')),
      cooldownLevel: Math.max(0, readNumber(endpoint, 0, 'cooldownLevel', 'cooldown_level')),
      cooldownUntil: readText(endpoint, 'cooldownUntil', 'cooldown_until') || null,
      updatedAt: timestamp,
    });
    return { executionTargetId: id };
  };

  const groups = routes.flatMap((route, index): LegacyFacadeGroup[] => {
    const sourceId = readIdentifier(route, 'id') || String(index);
    const modelName = previousRouteModelName(route);
    const displayName = previousRouteDisplayName(route, modelName || `Route ${index + 1}`);
    if (!modelName && !displayName) return [];
    const kind = isLegacyManualRoute(route) ? 'manual' : 'automatic';
    const group: LegacyFacadeGroup = {
      sourceIds: [sourceId],
      sourceModelNames: [modelName || displayName],
      kind,
      modelName: modelName || displayName,
      normalizedModelName: normalizeModelName(modelName || displayName),
      displayName,
      displayIcon: readText(route, 'displayIcon', 'display_icon') || null,
      visibility: 'public',
      enabled: readBoolean(route, true, 'enabled'),
      policy: legacyPolicy(readText(route, 'routingStrategy', 'routing_strategy')),
      stages: [],
    };
    const priorityStages = new Map<number, LegacyStage>();
    for (const endpoint of endpointsByRoute.get(sourceId) || []) {
      const sourceModel = readText(endpoint, 'sourceModel', 'source_model') || modelName || displayName;
      if (!sourceModel) continue;
      const target = ensureTarget(endpoint, sourceModel);
      const priority = Math.max(0, readNumber(endpoint, 0, 'priority'));
      const stage = priorityStages.get(priority) || ensureStage(group, String(priority), priority);
      priorityStages.set(priority, stage);
      stage.members.push({
        ...('executionTargetId' in target ? { executionTargetId: target.executionTargetId } : { unresolvedReason: target.reason }),
        sourceReferenceKind: 'route_endpoint',
        sourceReference: readIdentifier(endpoint, 'id') || `${sourceId}/${priority}`,
        enabled: readBoolean(endpoint, true, 'enabled'),
        weight: Math.max(1, readNumber(endpoint, 10, 'weight')),
        manualOverride: readBoolean(endpoint, false, 'manualOverride', 'manual_override'),
      });
    }
    if (group.stages.length === 0) ensureStage(group, opaqueId('stage'), 0);
    return [group];
  });
  const groupsBySourceId = new Map(groups.flatMap((group) => group.sourceIds.map((sourceId) => [sourceId, group] as const)));
  for (const [groupRouteId, sourceRouteIds] of sourceRouteIdsByGroupRouteId) {
    const group = groupsBySourceId.get(groupRouteId);
    if (!group) continue;
    const stage = group.stages[0] || ensureStage(group, opaqueId('stage'), 0);
    for (const sourceRouteId of sourceRouteIds) {
      if (stage.members.some((member) => member.childGroupId === sourceRouteId)) continue;
      stage.members.push({
        childGroupId: sourceRouteId,
        sourceReferenceKind: 'source_route',
        sourceReference: sourceRouteId,
        ...(!groupsBySourceId.has(sourceRouteId) ? { unresolvedReason: 'source_route_missing' as const } : {}),
        enabled: true,
        weight: 10,
        manualOverride: true,
      });
    }
  }
  return { groups, targets, state };
}

function makeAutomaticGroup(modelName: string, sourceId: string): LegacyFacadeGroup {
  const group: LegacyFacadeGroup = {
    sourceIds: [sourceId],
    sourceModelNames: [modelName],
    kind: 'automatic',
    modelName,
    normalizedModelName: normalizeModelName(modelName),
    displayName: normalizeModelName(modelName) || modelName,
    displayIcon: null,
    visibility: 'public',
    enabled: true,
    policy: { kind: 'inherit_default' },
    stages: [],
  };
  ensureStage(group, opaqueId('stage'), 0);
  return group;
}

function materializeHistoricalGroups(input: {
  groups: LegacyFacadeGroup[];
  targets: RuntimeExecutionTargetRow[];
}): { source: RouteGraphSource; warnings: string[]; notices: BackupImportNotice[] } {
  const targetById = new Map(input.targets.map((target) => [target.id, target]));
  const unresolvedNotices = new Map<string, BackupImportUnresolvedRouteMemberNotice>();
  const reportUnresolvedMember = (
    group: LegacyFacadeGroup,
    member: LegacyStageMember,
    reason: BackupImportUnresolvedRouteMemberReason,
  ) => {
    const groupKey = group.sourceIds[0] || group.normalizedModelName || group.displayName;
    const memberReference = member.sourceReference || 'unknown';
    const key = `${groupKey}\u0000${memberReference}\u0000${reason}`;
    unresolvedNotices.set(key, {
      code: 'route_member_unresolved',
      level: 'warning',
      groupKey,
      groupLabel: group.displayName,
      memberReferenceKind: member.sourceReferenceKind,
      memberReference,
      reason,
    });
  };
  const initial = uniqueGroupsByAutomaticModel(input.groups);
  const groups = initial.groups;
  const automaticByModel = new Map(groups
    .filter((group) => group.kind === 'automatic')
    .map((group) => [group.normalizedModelName, group]));

  // A manual facade is a composition of automatic model facades. Historical
  // direct target members are therefore moved to their automatic owner before
  // any Graph endpoint is created.
  for (const manual of groups.filter((group) => group.kind === 'manual')) {
    for (const stage of manual.stages) {
      for (const member of stage.members) {
        if (member.unresolvedReason) continue;
        if (!member.executionTargetId) continue;
        const target = targetById.get(member.executionTargetId);
        if (!target) continue;
        const model = target.upstreamModelName;
        const key = normalizeModelName(model);
        let automatic = automaticByModel.get(key);
        if (!automatic) {
          automatic = makeAutomaticGroup(model, opaqueId('macro'));
          automaticByModel.set(key, automatic);
          groups.push(automatic);
        }
        const automaticStage = automatic.stages.find((candidate) => candidate.sortOrder === stage.sortOrder)
          || ensureStage(automatic, opaqueId('stage'), stage.sortOrder);
        if (!automaticStage.members.some((candidate) => candidate.executionTargetId === member.executionTargetId)) {
          automaticStage.members.push({ ...member });
        }
        member.childGroupId = automatic.sourceIds[0];
        delete member.executionTargetId;
      }
    }
  }

  const conflicts = addWarningsForPublicModelConflicts(groups);
  const macroIdBySourceId = new Map<string, string>();
  for (const group of groups) {
    const macroId = opaqueId('macro');
    for (const sourceId of group.sourceIds) macroIdBySourceId.set(sourceId, macroId);
  }
  let source: RouteGraphSource = { nodes: [], edges: [], macros: [] };
  const endpointIdByTargetId = new Map<number, string>();
  const endpointForTarget = (targetId: number): string | null => {
    const existing = endpointIdByTargetId.get(targetId);
    if (existing) return existing;
    const target = targetById.get(targetId);
    if (!target) return null;
    const ensured = ensureRouteGraphExecutionTargetEndpoint(source, {
      id: target.id,
      upstreamModelName: target.upstreamModelName,
      enabled: target.enabled !== false,
    }, {
      ownership: 'derived',
      ownerKind: 'macro',
      provenance: { source: 'import', importId: 'legacy-route-backup' },
    });
    source = ensured.source;
    endpointIdByTargetId.set(targetId, ensured.endpoint.routeEndpointId);
    return ensured.endpoint.routeEndpointId;
  };

  for (const group of groups) {
    const macroId = macroIdBySourceId.get(group.sourceIds[0]!);
    if (!macroId) throw new Error('Failed to allocate imported route macro identity');
    const stages: RouteGroupFacadeStage[] = [...group.stages]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((stage) => {
        if (group.kind === 'automatic') {
          // The automatic facade selects Graph endpoints by model pattern. Historical
          // automatic members therefore materialize endpoint facts and retain only
          // per-endpoint dispatch overrides. The `model_pattern` remains the sole
          // source selector, so this never becomes a manual source selection.
          const members: RouteGroupFacadeMemberReference[] = [];
          for (const member of stage.members) {
            if (member.unresolvedReason) {
              reportUnresolvedMember(group, member, member.unresolvedReason);
              continue;
            }
            if (!member.executionTargetId) {
              reportUnresolvedMember(group, member, 'member_reference_invalid');
              continue;
            }
            const endpointId = member.executionTargetId
              ? endpointForTarget(member.executionTargetId)
              : null;
            if (!endpointId) {
              reportUnresolvedMember(group, member, 'execution_target_missing');
              continue;
            }
            members.push({
              kind: 'endpoint',
              endpointId,
              memberId: opaqueId('member'),
              enabled: member.enabled,
              weight: member.weight,
              metadata: { manualOverride: member.manualOverride },
            });
          }
          return {
            id: opaqueId('stage'),
            ...(stage.label ? { label: stage.label } : {}),
            enabled: stage.enabled,
            ...(stage.policy ? { policy: stage.policy } : {}),
            input: members.length > 0
              ? {
                  kind: 'route_endpoints' as const,
                  endpointIds: members.flatMap((member) =>
                    member.kind === 'endpoint' ? [member.endpointId] : []),
                }
              : {
                  kind: 'synthetic' as const,
                  statusCode: 503 as const,
                  message: 'No route is available.',
                },
            ...(members.length > 0 ? { members } : {}),
          };
        }
        const members: RouteGroupFacadeMemberReference[] = [];
        for (const member of stage.members) {
          if (member.unresolvedReason) {
            reportUnresolvedMember(group, member, member.unresolvedReason);
            continue;
          }
          const endpointId = member.executionTargetId ? endpointForTarget(member.executionTargetId) : null;
          const macroRef = member.childGroupId ? macroIdBySourceId.get(member.childGroupId) : null;
          if (endpointId) {
          members.push({
            kind: 'endpoint',
            endpointId,
            memberId: opaqueId('member'),
            enabled: member.enabled,
            weight: member.weight,
            metadata: { manualOverride: member.manualOverride },
            });
          } else if (macroRef) {
            members.push({
              kind: 'macro',
              macroId: macroRef,
            memberId: opaqueId('member'),
            enabled: member.enabled,
            weight: member.weight,
            metadata: { manualOverride: member.manualOverride },
            });
          } else {
            reportUnresolvedMember(
              group,
              member,
              member.executionTargetId ? 'execution_target_missing'
                : member.childGroupId ? 'source_route_missing'
                  : 'member_reference_invalid',
            );
          }
        }
        return {
          id: opaqueId('stage'),
          ...(stage.label ? { label: stage.label } : {}),
          enabled: stage.enabled,
          ...(stage.policy ? { policy: stage.policy } : {}),
          members,
        };
      });
    const created = createRouteGroupFacadeMacro(source, {
      id: macroId,
      kind: group.kind,
      modelName: group.modelName,
      displayName: group.displayName,
      displayIcon: group.displayIcon,
      visibility: group.visibility,
      enabled: group.enabled,
      policy: group.policy,
      ...(group.kind === 'automatic' ? {
        candidateSource: {
          kind: 'model_pattern' as const,
          pattern: group.normalizedModelName,
        },
      } : {}),
      ...(group.filters ? { filters: group.filters } : {}),
      stages: stages.map((stage, index) => ({
        ...stage,
        ...(group.kind === 'automatic' && index === 0 ? { acceptUnassigned: true } : {}),
      })),
      metadata: {
        canonicalModel: group.normalizedModelName,
        importedFrom: 'legacy_route_backup',
      },
    });
    source = created.source;
  }
  return {
    source,
    warnings: [
      ...initial.warnings,
      ...conflicts.warnings,
      ...Array.from(unresolvedNotices.values(), (notice) =>
        `导入路由组 ${notice.groupLabel} 时无法恢复成员 ${notice.memberReference}（${notice.reason}），已跳过该成员。`),
    ],
    notices: [...initial.notices, ...conflicts.notices, ...unresolvedNotices.values()],
  };
}

/**
 * Converts only historical backup storage into Graph source and runtime facts.
 * Normal runtime code never receives the retired table-shaped data.
 */
export function migratePreviousRouteBackupToCurrentRuntime(
  section: BackupImportRouteRuntimeSection,
  rawAccountsSection: unknown,
): BackupImportRouteRuntimeMigrationResult {
  if (!isRecord(rawAccountsSection) || !hasHistoricalRouteGroupInput(rawAccountsSection)) {
    return { section, warnings: [], notices: [] };
  }
  const storedGroups = parseLegacyStoredRouteGroups(rawAccountsSection);
  const previous = storedGroups.length > 0
    ? { groups: storedGroups, targets: [...(section.runtimeExecutionTargets || [])], state: [...(section.runtimeExecutionTargetState || [])] }
    : convertPreviousTokenRoutes({ raw: rawAccountsSection, section });
  if (previous.groups.length === 0) return { section: { ...section, runtimeExecutionTargets: previous.targets, runtimeExecutionTargetState: previous.state }, warnings: [], notices: [] };
  const materialized = materializeHistoricalGroups({ groups: previous.groups, targets: previous.targets });
  return {
    section: {
      ...section,
      runtimeExecutionTargets: previous.targets,
      runtimeExecutionTargetState: previous.state,
    },
    graphSource: materialized.source,
    warnings: materialized.warnings,
    notices: materialized.notices,
  };
}

export function migrateImportedDispatchPolicyShape(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const migratePolicy = (policy: unknown): unknown => {
    if (!isRecord(policy)) return policy;
    if (policy.kind === 'inherit_default' || policy.kind === 'registry' || policy.kind === 'inline' || policy.kind === 'builtin') {
      return policy;
    }
    if (policy.strategy === 'weighted' && typeof policy.score === 'string' && policy.score.trim()) {
      return {
        kind: 'inline',
        policy: {
          id: 'imported-inline-ranked',
          name: 'Imported inline ranked',
          kind: 'cel',
          selectionMode: 'ordered',
          orderExpression: `-(${policy.score.trim()})`,
        },
      };
    }
    if (policy.strategy === 'weighted' || policy.strategy === 'priority_order') return { kind: 'inherit_default' };
    if (policy.strategy === 'round_robin' || policy.strategy === 'stable_first') {
      return { kind: 'builtin', builtin: policy.strategy };
    }
    if (policy.strategy === 'cel_score' && typeof policy.cel === 'string' && policy.cel.trim()) {
      return {
        kind: 'inline',
        policy: {
          id: 'imported-inline-score',
          name: 'Imported inline score',
          kind: 'cel',
          selectionMode: 'weighted',
          contributionExpression: policy.cel.trim(),
        },
      };
    }
    if ((policy.strategy === 'cel_select' || policy.strategy === 'direct') && typeof (policy.cel || policy.select) === 'string' && String(policy.cel || policy.select).trim()) {
      return {
        kind: 'inline',
        policy: {
          id: 'imported-inline-direct',
          name: 'Imported inline direct',
          kind: 'cel',
          selectionMode: 'direct',
          selectExpression: String(policy.cel || policy.select).trim(),
        },
      };
    }
    return policy;
  };
  return {
    ...value,
    ...(Array.isArray(value.nodes) ? {
      nodes: value.nodes.map((node) => (
        isRecord(node) && node.type === 'dispatcher'
          ? { ...node, policy: migratePolicy(node.policy) }
          : node
      )),
    } : {}),
    ...(Array.isArray(value.macros) ? {
      macros: value.macros.map((macro) => {
        if (!isRecord(macro) || !isRecord(macro.config)) return macro;
        return { ...macro, config: { ...macro.config, policy: migratePolicy(macro.config.policy) } };
      }),
    } : {}),
  };
}

function readLegacyFallbackStageDispatcherIds(value: unknown): string[] {
  const control = isRecord(value) ? value : {};
  const rawStages = [control.fallbackChain, control.fallback_chain, control.fallbackStages, control.fallback_stages, control.stages]
    .find(Array.isArray);
  if (!Array.isArray(rawStages)) return [];
  return rawStages.flatMap((stage) => {
    if (typeof stage === 'string' && stage.trim()) return [stage.trim()];
    if (!isRecord(stage)) return [];
    const id = readText(stage, 'dispatcherId', 'dispatcher_id', 'nodeId', 'node_id', 'stageNodeId', 'stage_node_id', 'id');
    return id ? [id] : [];
  });
}

function migrateImportedFallbackControlShape(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return value;
  const nodes: JsonRecord[] = value.nodes.filter(isRecord).map((node) => ({ ...node }));
  const edges: JsonRecord[] = value.edges.filter(isRecord).map((edge) => ({ ...edge }));
  const nodesById = new Map(nodes.flatMap((node) => {
    const id = readText(node, 'id');
    return id ? [[id, node] as const] : [];
  }));
  const removedNodeIds = new Set<string>();
  const replacementByNodeId = new Map<string, string>();
  const fallbackEdges: JsonRecord[] = [];
  for (const controller of nodes) {
    if (readText(controller, 'type') !== 'dispatcher') continue;
    const metadata = readJsonRecord(controller, 'metadata');
    const control = isRecord(metadata.routeGraphControl) ? metadata.routeGraphControl : null;
    if (!control) continue;
    const controllerId = readText(controller, 'id');
    const stageIds = readLegacyFallbackStageDispatcherIds(control);
    if (!controllerId || stageIds.length === 0) continue;
    const firstStage = nodesById.get(stageIds[0]!);
    if (firstStage) {
      if (firstStage.mode !== undefined) controller.mode = firstStage.mode;
      if (firstStage.policy !== undefined) controller.policy = firstStage.policy;
      replacementByNodeId.set(stageIds[0]!, controllerId);
      removedNodeIds.add(stageIds[0]!);
    }
    const chain = [controllerId, ...stageIds.slice(1)].filter((id, index, all) => !!id && all.indexOf(id) === index);
    for (let index = 0; index + 1 < chain.length; index += 1) {
      fallbackEdges.push({
        id: createManagedRouteGraphElementId('edge', randomUUID()),
        sourceNodeId: chain[index]!,
        sourcePortId: 'fallback.out',
        targetNodeId: chain[index + 1]!,
        targetPortId: 'bidirect.in',
        kind: 'bidirect_flow',
        ownership: 'derived',
      });
    }
    const { routeGraphControl: _discarded, ...nextMetadata } = metadata;
    controller.metadata = nextMetadata;
  }
  const normalizedEdges = edges.map((edge) => {
    const sourceNodeId = readText(edge, 'sourceNodeId', 'source_node_id');
    const targetNodeId = readText(edge, 'targetNodeId', 'target_node_id');
    return {
      ...edge,
      ...(replacementByNodeId.has(sourceNodeId) ? { sourceNodeId: replacementByNodeId.get(sourceNodeId) } : {}),
      ...(replacementByNodeId.has(targetNodeId) ? { targetNodeId: replacementByNodeId.get(targetNodeId) } : {}),
    };
  });
  const edgeIds = new Set(normalizedEdges.map((edge) => readText(edge, 'id')));
  for (const edge of fallbackEdges) {
    if (!edgeIds.has(String(edge.id))) normalizedEdges.push(edge);
  }
  const withoutRetiredControlMetadata = (record: JsonRecord): JsonRecord => {
    const metadata = readJsonRecord(record, 'metadata');
    if (!Object.hasOwn(metadata, 'routeGraphControl')) return record;
    const { routeGraphControl: _discarded, ...nextMetadata } = metadata;
    return { ...record, metadata: nextMetadata };
  };
  return {
    ...value,
    nodes: nodes.filter((node) => !removedNodeIds.has(readText(node, 'id'))).map(withoutRetiredControlMetadata),
    edges: normalizedEdges.map(withoutRetiredControlMetadata),
  };
}

/**
 * Historical Graph endpoints stored their execution-target binding in
 * metadata. The current Graph contract owns that relation in the typed target
 * transport binding. This runs only in backup/DB migration owners and never
 * provides a runtime metadata fallback.
 */
function migrateImportedExecutionTargetBindingShape(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return value;
  return {
    ...value,
    nodes: value.nodes.map((rawNode) => {
      if (!isRecord(rawNode) || readText(rawNode, 'type') !== 'route_endpoint') return rawNode;
      const config = readJsonRecord(rawNode, 'config');
      const targets = Array.isArray(config.targets) ? config.targets.filter(isRecord) : [];
      if (targets.length === 0) return rawNode;
      const nodeMetadata = readJsonRecord(rawNode, 'metadata');
      const nodeExecutionTargetId = readPositiveInteger(nodeMetadata, 'executionTargetId', 'execution_target_id');
      const migratedTargets = targets.map((target) => {
        const binding = readJsonRecord(target, 'transportBinding');
        if (binding.kind === 'execution_target' && readPositiveInteger(binding, 'executionTargetId')) {
          return target;
        }
        const targetMetadata = readJsonRecord(target, 'metadata');
        const targetExecutionTargetId = readPositiveInteger(targetMetadata, 'executionTargetId', 'execution_target_id')
          || (targets.length === 1 ? nodeExecutionTargetId : null);
        if (!targetExecutionTargetId) return target;
        const { executionTargetId: _retiredCamel, execution_target_id: _retiredSnake, ...metadata } = targetMetadata;
        return {
          ...target,
          ...(Object.keys(metadata).length > 0 ? { metadata } : { metadata: undefined }),
          transportBinding: {
            kind: 'execution_target',
            executionTargetId: targetExecutionTargetId,
          },
        };
      });
      const { executionTargetId: _retiredCamel, execution_target_id: _retiredSnake, ...metadata } = nodeMetadata;
      return {
        ...rawNode,
        ...(Object.keys(metadata).length > 0 ? { metadata } : { metadata: undefined }),
        config: { ...config, targets: migratedTargets },
      };
    }),
  };
}

export function migrateImportedRouteGraphSourceJson(sourceGraphJson: unknown): string {
  if (typeof sourceGraphJson !== 'string' || !sourceGraphJson.trim()) {
    throw new Error('导入数据中的路由图源定义缺失');
  }
  try {
    return JSON.stringify(migrateImportedExecutionTargetBindingShape(
      migrateImportedDispatchPolicyShape(migrateImportedFallbackControlShape(JSON.parse(sourceGraphJson))),
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知 JSON 错误';
    throw new Error(`导入数据中的路由图源定义无效：${message}`);
  }
}
