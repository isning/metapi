import { and, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

type RuntimeExecutionTargetRow = typeof schema.runtimeExecutionTargets.$inferSelect;
type RuntimeExecutionTargetStateRow = typeof schema.runtimeExecutionTargetState.$inferSelect;
type AccountRow = typeof schema.accounts.$inferSelect;
type SiteRow = typeof schema.sites.$inferSelect;
type AccountTokenRow = typeof schema.accountTokens.$inferSelect;
type RuntimeExecutionTargetIdentityRow = Pick<
  RuntimeExecutionTargetRow,
  'id' | 'accountId' | 'tokenId' | 'oauthRouteUnitId' | 'upstreamModelName' | 'enabled'
>;

const IDENTITY_BATCH_SIZE = 400;

export type RouteRuntimeExecutionTargetIdentity = {
  executionTarget: RuntimeExecutionTargetIdentityRow;
  account: AccountRow | null;
  site: SiteRow;
  token: AccountTokenRow | null;
};

export type RouteRuntimeExecutionTargetContext = RouteRuntimeExecutionTargetIdentity & {
  state: RuntimeExecutionTargetStateRow | null;
};

export type RouteRuntimeRecoveryProbeContext = RouteRuntimeExecutionTargetContext & {
  account: AccountRow;
};

export type RouteRuntimeExecutionIdentityCacheStats = {
  generation: number;
  identityEntries: number;
  stateEntries: number;
  identityLoads: number;
  stateLoads: number;
};

let generation = 0;
const identityByExecutionTargetId = new Map<number, RouteRuntimeExecutionTargetIdentity | null>();
const stateByExecutionTargetId = new Map<number, RuntimeExecutionTargetStateRow | null>();
const accountById = new Map<number, AccountRow>();
const siteById = new Map<number, SiteRow>();
const tokenById = new Map<number, AccountTokenRow>();
const identityLoadByExecutionTargetId = new Map<number, Promise<RouteRuntimeExecutionTargetContext | null>>();
const stateLoadByExecutionTargetId = new Map<number, Promise<RuntimeExecutionTargetStateRow | null>>();
const stateRevisionByExecutionTargetId = new Map<number, number>();

function asPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function uniqueExecutionTargetIds(values: readonly unknown[]): number[] {
  return Array.from(new Set(values
    .map(asPositiveInteger)
    .filter((value): value is number => value != null)));
}

function currentStateRevision(executionTargetId: number): number {
  return stateRevisionByExecutionTargetId.get(executionTargetId) || 0;
}

function canonicalAccount(account: AccountRow | null): AccountRow | null {
  if (!account) return null;
  const existing = accountById.get(account.id);
  if (existing) return existing;
  accountById.set(account.id, account);
  return account;
}

function canonicalSite(site: SiteRow): SiteRow {
  const existing = siteById.get(site.id);
  if (existing) return existing;
  siteById.set(site.id, site);
  return site;
}

function canonicalToken(token: AccountTokenRow | null): AccountTokenRow | null {
  if (!token) return null;
  const existing = tokenById.get(token.id);
  if (existing) return existing;
  tokenById.set(token.id, token);
  return token;
}

async function loadIdentityRows(executionTargetIds: number[]): Promise<Map<number, RouteRuntimeExecutionTargetContext>> {
  const result = new Map<number, RouteRuntimeExecutionTargetContext>();
  if (executionTargetIds.length === 0) return result;

  for (let start = 0; start < executionTargetIds.length; start += IDENTITY_BATCH_SIZE) {
    const batch = executionTargetIds.slice(start, start + IDENTITY_BATCH_SIZE);
    const endpoints = await db.select({
      id: schema.runtimeExecutionTargets.id,
      siteId: schema.runtimeExecutionTargets.siteId,
      accountId: schema.runtimeExecutionTargets.accountId,
      tokenId: schema.runtimeExecutionTargets.tokenId,
      oauthRouteUnitId: schema.runtimeExecutionTargets.oauthRouteUnitId,
      upstreamModelName: schema.runtimeExecutionTargets.upstreamModelName,
      enabled: schema.runtimeExecutionTargets.enabled,
    }).from(schema.runtimeExecutionTargets)
      .where(inArray(schema.runtimeExecutionTargets.id, batch))
      .all();
    const siteIds = uniqueExecutionTargetIds(endpoints.map((endpoint) => endpoint.siteId));
    const accountIds = uniqueExecutionTargetIds(endpoints.map((endpoint) => endpoint.accountId));
    const tokenIds = uniqueExecutionTargetIds(endpoints.map((endpoint) => endpoint.tokenId));
    const siteRows: Promise<SiteRow[]> = siteIds.length > 0
      ? db.select().from(schema.sites).where(inArray(schema.sites.id, siteIds)).all()
      : Promise.resolve([]);
    const accountRows: Promise<AccountRow[]> = accountIds.length > 0
      ? db.select().from(schema.accounts).where(inArray(schema.accounts.id, accountIds)).all()
      : Promise.resolve([]);
    const tokenRows: Promise<AccountTokenRow[]> = tokenIds.length > 0
      ? db.select().from(schema.accountTokens).where(inArray(schema.accountTokens.id, tokenIds)).all()
      : Promise.resolve([]);
    const stateRows: Promise<RuntimeExecutionTargetStateRow[]> = db.select().from(schema.runtimeExecutionTargetState)
      .where(inArray(schema.runtimeExecutionTargetState.executionTargetId, batch))
      .all();
    const [sites, accounts, tokens, states] = await Promise.all([
      siteRows,
      accountRows,
      tokenRows,
      stateRows,
    ]);
    const siteById = new Map(sites.map((site) => [site.id, canonicalSite(site)]));
    const accountByIdForBatch = new Map(accounts.map((account) => [account.id, canonicalAccount(account)]));
    const tokenByIdForBatch = new Map(tokens.map((token) => [token.id, canonicalToken(token)]));
    const stateByExecutionTargetId = new Map(states.map((state) => [state.executionTargetId, state]));

    for (const endpoint of endpoints) {
      const site = siteById.get(endpoint.siteId) || null;
      if (!site) continue;
      result.set(endpoint.id, {
        executionTarget: {
          id: endpoint.id,
          accountId: endpoint.accountId,
          tokenId: endpoint.tokenId,
          oauthRouteUnitId: endpoint.oauthRouteUnitId,
          upstreamModelName: endpoint.upstreamModelName,
          enabled: endpoint.enabled,
        },
        state: stateByExecutionTargetId.get(endpoint.id) || null,
        account: endpoint.accountId == null ? null : accountByIdForBatch.get(endpoint.accountId) || null,
        site,
        token: endpoint.tokenId == null ? null : tokenByIdForBatch.get(endpoint.tokenId) || null,
      });
    }
  }
  return result;
}

function cacheIdentityContext(
  executionTargetId: number,
  context: RouteRuntimeExecutionTargetContext | null,
  expectedGeneration: number,
  expectedStateRevision: number,
): void {
  if (expectedGeneration !== generation) return;
  if (context) {
    identityByExecutionTargetId.set(executionTargetId, {
      executionTarget: context.executionTarget,
      account: context.account,
      site: context.site,
      token: context.token,
    });
    if (currentStateRevision(executionTargetId) === expectedStateRevision) {
      stateByExecutionTargetId.set(executionTargetId, context.state);
    }
    return;
  }
  identityByExecutionTargetId.set(executionTargetId, null);
  if (currentStateRevision(executionTargetId) === expectedStateRevision) {
    stateByExecutionTargetId.set(executionTargetId, null);
  }
}

async function loadExecutionTargetState(executionTargetId: number): Promise<RuntimeExecutionTargetStateRow | null> {
  if (stateByExecutionTargetId.has(executionTargetId)) {
    return stateByExecutionTargetId.get(executionTargetId) || null;
  }
  const pending = stateLoadByExecutionTargetId.get(executionTargetId);
  if (pending) return await pending;

  const expectedGeneration = generation;
  const expectedStateRevision = currentStateRevision(executionTargetId);
  const loading = db.select().from(schema.runtimeExecutionTargetState)
    .where(eq(schema.runtimeExecutionTargetState.executionTargetId, executionTargetId))
    .get()
    .then((state) => {
      const resolved = state || null;
      if (
        expectedGeneration === generation
        && currentStateRevision(executionTargetId) === expectedStateRevision
      ) {
        stateByExecutionTargetId.set(executionTargetId, resolved);
      }
      return resolved;
    })
    .finally(() => {
      if (stateLoadByExecutionTargetId.get(executionTargetId) === loading) {
        stateLoadByExecutionTargetId.delete(executionTargetId);
      }
    });
  stateLoadByExecutionTargetId.set(executionTargetId, loading);
  return await loading;
}

export async function loadRouteRuntimeExecutionTargetContext(
  inputExecutionTargetId: number,
): Promise<RouteRuntimeExecutionTargetContext | null> {
  const executionTargetId = asPositiveInteger(inputExecutionTargetId);
  if (executionTargetId == null) return null;
  if (identityByExecutionTargetId.has(executionTargetId)) {
    const identity = identityByExecutionTargetId.get(executionTargetId);
    if (!identity) return null;
    return {
      ...identity,
      state: await loadExecutionTargetState(executionTargetId),
    };
  }

  const pending = identityLoadByExecutionTargetId.get(executionTargetId);
  if (pending) return await pending;

  const expectedGeneration = generation;
  const expectedStateRevision = currentStateRevision(executionTargetId);
  const loading = loadIdentityRows([executionTargetId])
    .then((rows) => {
      const context = rows.get(executionTargetId) || null;
      cacheIdentityContext(executionTargetId, context, expectedGeneration, expectedStateRevision);
      return context;
    })
    .finally(() => {
      if (identityLoadByExecutionTargetId.get(executionTargetId) === loading) {
        identityLoadByExecutionTargetId.delete(executionTargetId);
      }
    });
  identityLoadByExecutionTargetId.set(executionTargetId, loading);
  return await loading;
}

export async function loadRouteRuntimeExecutionTargetContexts(
  inputExecutionTargetIds: readonly unknown[],
): Promise<Map<number, RouteRuntimeExecutionTargetContext>> {
  const executionTargetIds = uniqueExecutionTargetIds(inputExecutionTargetIds);
  const result = new Map<number, RouteRuntimeExecutionTargetContext>();
  if (executionTargetIds.length === 0) return result;

  await primeRouteRuntimeExecutionTargetIdentities(executionTargetIds);
  await Promise.all(executionTargetIds.map(async (executionTargetId) => {
    const context = await loadRouteRuntimeExecutionTargetContext(executionTargetId);
    if (context) result.set(executionTargetId, context);
  }));
  return result;
}

/**
 * Runtime-native recovery read model. It deliberately joins only the target
 * registry, mutable target state and credential ownership; source Graph and
 * Route Group projections have no role in recovery probing.
 */
export async function loadCoolingRouteRuntimeRecoveryProbeContexts(
  nowIso: string,
): Promise<RouteRuntimeRecoveryProbeContext[]> {
  const rows = await db.select()
    .from(schema.runtimeExecutionTargets)
    .innerJoin(schema.runtimeExecutionTargetState, eq(
      schema.runtimeExecutionTargetState.executionTargetId,
      schema.runtimeExecutionTargets.id,
    ))
    .innerJoin(schema.accounts, eq(schema.runtimeExecutionTargets.accountId, schema.accounts.id))
    .innerJoin(schema.sites, eq(schema.runtimeExecutionTargets.siteId, schema.sites.id))
    .leftJoin(schema.accountTokens, eq(schema.runtimeExecutionTargets.tokenId, schema.accountTokens.id))
    .where(and(
      eq(schema.runtimeExecutionTargets.enabled, true),
      eq(schema.accounts.status, 'active'),
      eq(schema.sites.status, 'active'),
      isNotNull(schema.runtimeExecutionTargetState.cooldownUntil),
      gt(schema.runtimeExecutionTargetState.cooldownUntil, nowIso),
    ))
    .all();

  return rows.map((row) => ({
    executionTarget: {
      id: row.runtime_execution_targets.id,
      accountId: row.runtime_execution_targets.accountId,
      tokenId: row.runtime_execution_targets.tokenId,
      oauthRouteUnitId: row.runtime_execution_targets.oauthRouteUnitId,
      upstreamModelName: row.runtime_execution_targets.upstreamModelName,
      enabled: row.runtime_execution_targets.enabled,
    },
    state: row.runtime_execution_target_state,
    account: row.accounts,
    site: row.sites,
    token: row.account_tokens,
  }));
}

export async function primeRouteRuntimeExecutionTargetIdentities(
  inputExecutionTargetIds: readonly unknown[],
): Promise<void> {
  const executionTargetIds = uniqueExecutionTargetIds(inputExecutionTargetIds)
    .filter((executionTargetId) => !identityByExecutionTargetId.has(executionTargetId));
  if (executionTargetIds.length === 0) return;

  const expectedGeneration = generation;
  const stateRevisions = new Map(executionTargetIds.map((id) => [id, currentStateRevision(id)]));
  const rows = await loadIdentityRows(executionTargetIds);
  for (const executionTargetId of executionTargetIds) {
    cacheIdentityContext(
      executionTargetId,
      rows.get(executionTargetId) || null,
      expectedGeneration,
      stateRevisions.get(executionTargetId) || 0,
    );
  }
}

export function invalidateRouteRuntimeExecutionTargetState(
  inputExecutionTargetIds: readonly unknown[] | unknown,
): void {
  const values = Array.isArray(inputExecutionTargetIds)
    ? inputExecutionTargetIds
    : [inputExecutionTargetIds];
  for (const executionTargetId of uniqueExecutionTargetIds(values)) {
    stateRevisionByExecutionTargetId.set(executionTargetId, currentStateRevision(executionTargetId) + 1);
    stateByExecutionTargetId.delete(executionTargetId);
    stateLoadByExecutionTargetId.delete(executionTargetId);
  }
}

export function invalidateRouteRuntimeExecutionIdentityCache(): void {
  generation += 1;
  identityByExecutionTargetId.clear();
  stateByExecutionTargetId.clear();
  accountById.clear();
  siteById.clear();
  tokenById.clear();
  identityLoadByExecutionTargetId.clear();
  stateLoadByExecutionTargetId.clear();
  stateRevisionByExecutionTargetId.clear();
}

export function getRouteRuntimeExecutionIdentityCacheStats(): RouteRuntimeExecutionIdentityCacheStats {
  return {
    generation,
    identityEntries: identityByExecutionTargetId.size,
    stateEntries: stateByExecutionTargetId.size,
    identityLoads: identityLoadByExecutionTargetId.size,
    stateLoads: stateLoadByExecutionTargetId.size,
  };
}
