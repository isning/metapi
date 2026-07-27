import type {
  CompiledExecutionAlternative,
  CompiledRouterBundle,
  CompiledRouterPlan,
  RouteMatcherTarget,
} from '../../shared/compiledRuntime.js';
import {
  getCompiledExecutionAttemptId,
  getCompiledExecutionTargetId,
  getCompiledRouterPlanById,
} from '../../shared/compiledRuntime.js';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  type RouteRuntimeStorageArtifact,
  getActiveRouteRuntimeArtifact,
  getCachedActiveRouteRuntimeArtifact,
} from './routeRuntimeArtifactService.js';

export type CompiledRuntimeModelEntrypoint = {
  modelName: string;
  planId: string;
  entryNodeId: string;
};

type RuntimeExecutionTargetRow = typeof schema.runtimeExecutionTargets.$inferSelect;
type RuntimeExecutionTargetStateRow = typeof schema.runtimeExecutionTargetState.$inferSelect;
type AccountRow = typeof schema.accounts.$inferSelect;
type SiteRow = typeof schema.sites.$inferSelect;
type AccountTokenRow = typeof schema.accountTokens.$inferSelect;

export type CompiledRuntimeInventoryExecutionAttempt = {
  executionAttemptId: string;
  executionTargetId: number;
  endpointId: string;
  modelName: string;
  enabled: boolean;
  executionTarget: RuntimeExecutionTargetRow;
  state: RuntimeExecutionTargetStateRow | null;
  account: AccountRow;
  site: SiteRow;
  token: AccountTokenRow | null;
  latencyMs: number | null;
};

export type CompiledRuntimeInventoryInvalidExecutionAttempt = {
  alternativeId: string;
  executionAttemptId: string | null;
  executionTargetId: number | null;
  endpointId: string | null;
  modelName: string | null;
  reason:
    | 'missing_execution_attempt'
    | 'missing_execution_target_id'
    | 'missing_execution_target_identity'
    | 'missing_model';
};

export type CompiledRuntimeModelInventory = CompiledRuntimeModelEntrypoint & {
  executionAttempts: CompiledRuntimeInventoryExecutionAttempt[];
  invalidExecutionAttempts: CompiledRuntimeInventoryInvalidExecutionAttempt[];
};

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function executionTargetIdFromAlternative(alternative: CompiledExecutionAlternative): number | null {
  return getCompiledExecutionTargetId(alternative.executionAttempt);
}

function executionAttemptIdForAlternative(alternative: CompiledExecutionAlternative): string | null {
  return getCompiledExecutionAttemptId(alternative.executionAttempt);
}

function invalidExecutionAttempt(
  alternative: CompiledExecutionAlternative,
  reason: CompiledRuntimeInventoryInvalidExecutionAttempt['reason'],
  modelName: string | null = null,
): CompiledRuntimeInventoryInvalidExecutionAttempt {
  const executionTargetId = executionTargetIdFromAlternative(alternative);
  return {
    alternativeId: alternative.alternativeId,
    executionAttemptId: executionAttemptIdForAlternative(alternative),
    executionTargetId,
    endpointId: alternative.executionAttempt?.endpointId ?? alternative.endpoint?.endpointId ?? null,
    modelName,
    reason,
  };
}

function averageLatencyMs(state: RuntimeExecutionTargetStateRow | null): number | null {
  if (!state) return null;
  const totalLatencyMs = Number(state.totalLatencyMs ?? 0);
  const samples = Number(state.latencySampleCount ?? 0);
  if (!Number.isFinite(totalLatencyMs) || totalLatencyMs < 0 || samples <= 0) return null;
  return Math.round(totalLatencyMs / samples);
}

function modelEntrypointFromPlan(plan: CompiledRouterPlan): CompiledRuntimeModelEntrypoint | null {
  if (plan.enabled === false) return null;
  const modelName = trimText(plan.publicModelName);
  const planId = trimText(plan.id);
  const entryNodeId = trimText(plan.entryNodeId);
  if (!modelName || !planId || !entryNodeId) return null;

  return {
    modelName,
    planId,
    entryNodeId,
  };
}

function mergeEntrypoint(
  byModelName: Map<string, CompiledRuntimeModelEntrypoint>,
  entrypoint: CompiledRuntimeModelEntrypoint | null,
): void {
  if (!entrypoint) return;
  const key = entrypoint.modelName.toLowerCase();
  const existing = byModelName.get(key);
  if (!existing) {
    byModelName.set(key, entrypoint);
    return;
  }
  byModelName.set(key, {
    ...existing,
  });
}

function matcherEntrypoint(input: {
  modelName: string;
  target: RouteMatcherTarget;
  plan: CompiledRouterPlan | null;
}): CompiledRuntimeModelEntrypoint | null {
  const modelName = trimText(input.modelName) || trimText(input.target.publicModelName);
  const planId = trimText(input.target.programId) || trimText(input.plan?.id);
  const entryNodeId = trimText(input.target.entryNodeId) || trimText(input.plan?.entryNodeId);
  if (!modelName || !planId || !entryNodeId || input.plan?.enabled === false) return null;

  return {
    modelName,
    planId,
    entryNodeId,
  };
}

function collectBundleEntrypoints(bundle: CompiledRouterBundle): CompiledRuntimeModelEntrypoint[] {
  const plans = bundle.plans || [];
  const byModelName = new Map<string, CompiledRuntimeModelEntrypoint>();
  const plansById = new Map(plans.map((plan) => [plan.id, plan]));

  for (const plan of plans) {
    mergeEntrypoint(byModelName, modelEntrypointFromPlan(plan));
  }
  for (const [modelName, target] of Object.entries(bundle.matcher?.exact || {})) {
    mergeEntrypoint(byModelName, matcherEntrypoint({
      modelName,
      target,
      plan: plansById.get(target.programId) || null,
    }));
  }
  for (const [modelName, target] of Object.entries(bundle.matcher?.normalizedExact || {})) {
    mergeEntrypoint(byModelName, matcherEntrypoint({
      modelName: target.publicModelName || modelName,
      target,
      plan: plansById.get(target.programId) || null,
    }));
  }
  for (const target of bundle.matcher?.patterns || []) {
    mergeEntrypoint(byModelName, matcherEntrypoint({
      modelName: target.publicModelName || target.pattern,
      target,
      plan: plansById.get(target.programId) || null,
    }));
  }

  return Array.from(byModelName.values()).sort((a, b) => a.modelName.localeCompare(b.modelName));
}

function collectBundleInventoryEntrypoints(bundle: CompiledRouterBundle): Array<CompiledRuntimeModelEntrypoint & {
  executionAlternatives: CompiledExecutionAlternative[];
}> {
  const plans = bundle.plans || [];
  const plansById = new Map(plans
    .map((storedPlan) => [storedPlan.id, getCompiledRouterPlanById(bundle, storedPlan.id)] as const)
    .filter((entry): entry is readonly [string, CompiledRouterPlan] => !!entry[1]));
  const byModelName = new Map<string, CompiledRuntimeModelEntrypoint & {
    executionAlternatives: CompiledExecutionAlternative[];
  }>();

  for (const plan of plansById.values()) {
    const entrypoint = modelEntrypointFromPlan(plan);
    if (!entrypoint) continue;
    byModelName.set(entrypoint.modelName.toLowerCase(), {
      ...entrypoint,
      executionAlternatives: plan.executionAlternatives || [],
    });
  }

  const mergeMatcherEntrypoint = (entrypoint: CompiledRuntimeModelEntrypoint | null, plan: CompiledRouterPlan | null) => {
    if (!entrypoint) return;
    const key = entrypoint.modelName.toLowerCase();
    const existing = byModelName.get(key);
    byModelName.set(key, {
      ...entrypoint,
      executionAlternatives: existing?.executionAlternatives || plan?.executionAlternatives || [],
    });
  };

  for (const [modelName, target] of Object.entries(bundle.matcher?.exact || {})) {
    const plan = plansById.get(target.programId) || null;
    mergeMatcherEntrypoint(matcherEntrypoint({ modelName, target, plan }), plan);
  }
  for (const [modelName, target] of Object.entries(bundle.matcher?.normalizedExact || {})) {
    const plan = plansById.get(target.programId) || null;
    mergeMatcherEntrypoint(matcherEntrypoint({
      modelName: target.publicModelName || modelName,
      target,
      plan,
    }), plan);
  }
  for (const target of bundle.matcher?.patterns || []) {
    const plan = plansById.get(target.programId) || null;
    mergeMatcherEntrypoint(matcherEntrypoint({
      modelName: target.publicModelName || target.pattern,
      target,
      plan,
    }), plan);
  }

  return Array.from(byModelName.values()).sort((a, b) => a.modelName.localeCompare(b.modelName));
}

async function loadExecutionTargetIdentities(executionTargetIds: number[]): Promise<Map<number, {
  executionTarget: RuntimeExecutionTargetRow;
  state: RuntimeExecutionTargetStateRow | null;
  account: AccountRow;
  site: SiteRow;
  token: AccountTokenRow | null;
}>> {
  const ids = Array.from(new Set(executionTargetIds.filter((id) => Number.isSafeInteger(id) && id > 0)));
  if (ids.length === 0) return new Map();

  const rows = await db.select()
    .from(schema.runtimeExecutionTargets)
    .innerJoin(schema.accounts, eq(schema.runtimeExecutionTargets.accountId, schema.accounts.id))
    .innerJoin(schema.sites, eq(schema.runtimeExecutionTargets.siteId, schema.sites.id))
    .leftJoin(schema.accountTokens, eq(schema.runtimeExecutionTargets.tokenId, schema.accountTokens.id))
    .leftJoin(
      schema.runtimeExecutionTargetState,
      eq(schema.runtimeExecutionTargetState.executionTargetId, schema.runtimeExecutionTargets.id),
    )
    .where(inArray(schema.runtimeExecutionTargets.id, ids))
    .all();

  const identities = new Map<number, {
    executionTarget: RuntimeExecutionTargetRow;
    state: RuntimeExecutionTargetStateRow | null;
    account: AccountRow;
    site: SiteRow;
    token: AccountTokenRow | null;
  }>();
  for (const row of rows) {
    identities.set(row.runtime_execution_targets.id, {
      executionTarget: row.runtime_execution_targets,
      state: row.runtime_execution_target_state,
      account: row.accounts,
      site: row.sites,
      token: row.account_tokens,
    });
  }
  return identities;
}

export async function listActiveCompiledRuntimeModelEntrypoints(): Promise<CompiledRuntimeModelEntrypoint[]> {
  const cached = getCachedActiveRouteRuntimeArtifact();
  const active = cached === undefined ? await getActiveRouteRuntimeArtifact() : cached;
  if (!active) return [];
  const bundle = active?.compiledGraph.compiledRouterBundle || null;
  if (!bundle) return [];
  return collectBundleEntrypoints(bundle);
}

export async function listActiveCompiledRuntimeModelEntrypointsForPlanScope(
  allowedPlanIds: string[],
): Promise<CompiledRuntimeModelEntrypoint[]> {
  const cached = getCachedActiveRouteRuntimeArtifact();
  const active = cached === undefined ? await getActiveRouteRuntimeArtifact() : cached;
  if (!active) return [];
  const bundle = active?.compiledGraph.compiledRouterBundle || null;
  if (!bundle) return [];
  const scopedPlanIds = new Set(allowedPlanIds.map(trimText).filter(Boolean));
  if (scopedPlanIds.size === 0) return [];
  return collectBundleEntrypoints(bundle).filter((entrypoint) => scopedPlanIds.has(entrypoint.planId));
}

export async function listActiveCompiledRuntimeModelInventory(): Promise<CompiledRuntimeModelInventory[]> {
  const cached = getCachedActiveRouteRuntimeArtifact();
  const active = cached === undefined ? await getActiveRouteRuntimeArtifact() : cached;
  if (!active) return [];
  const bundle = active?.compiledGraph.compiledRouterBundle || null;
  if (!bundle) return [];

  const inventoryEntrypoints = collectBundleInventoryEntrypoints(bundle);
  const executionTargetIds = inventoryEntrypoints.flatMap((entrypoint) => (
    entrypoint.executionAlternatives
      .map(executionTargetIdFromAlternative)
      .filter((id): id is number => id != null)
  ));
  const identities = await loadExecutionTargetIdentities(executionTargetIds);

  return inventoryEntrypoints.map((entrypoint) => {
    const invalidExecutionAttempts: CompiledRuntimeInventoryInvalidExecutionAttempt[] = [];
    const attempts = entrypoint.executionAlternatives.flatMap((alternative): CompiledRuntimeInventoryExecutionAttempt[] => {
      const executionTargetId = executionTargetIdFromAlternative(alternative);
      const executionAttemptId = executionAttemptIdForAlternative(alternative);
      const target = alternative.executionAttempt;
      if (!target) {
        invalidExecutionAttempts.push(invalidExecutionAttempt(alternative, 'missing_execution_attempt'));
        return [];
      }
      if (!executionTargetId || !executionAttemptId) {
        invalidExecutionAttempts.push(invalidExecutionAttempt(alternative, 'missing_execution_target_id'));
        return [];
      }
      const identity = identities.get(executionTargetId);
      if (!identity) {
        invalidExecutionAttempts.push(invalidExecutionAttempt(alternative, 'missing_execution_target_identity'));
        return [];
      }
      const modelName = target.modelSource === 'request'
        ? entrypoint.modelName
        : trimText(target.model);
      if (!modelName) {
        invalidExecutionAttempts.push(invalidExecutionAttempt(alternative, 'missing_model', null));
        return [];
      }
      return [{
        executionAttemptId,
        executionTargetId,
        endpointId: alternative.endpoint?.endpointId || (
          alternative.terminal.kind === 'supply' ? alternative.terminal.endpointId : ''
        ),
        modelName,
        enabled: alternative.enabled !== false && target.enabled !== false && identity.executionTarget.enabled !== false,
        executionTarget: identity.executionTarget,
        state: identity.state,
        account: identity.account,
        site: identity.site,
        token: identity.token,
        latencyMs: averageLatencyMs(identity.state),
      }];
    });
    return {
      modelName: entrypoint.modelName,
      planId: entrypoint.planId,
      entryNodeId: entrypoint.entryNodeId,
      executionAttempts: attempts,
      invalidExecutionAttempts,
    };
  });
}

export async function listActiveCompiledRuntimeModelNames(): Promise<string[]> {
  return (await listActiveCompiledRuntimeModelEntrypoints()).map((entrypoint) => entrypoint.modelName);
}
