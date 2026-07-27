import { asc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export type RuntimeExecutionTargetFact = {
  id: number;
  sourceRef: string;
  site: { id: number; name: string | null; platform: string | null };
  account: { id: number; username: string | null };
  token: {
    id: number;
    name: string;
    accountId: number;
    enabled: boolean;
    isDefault: boolean;
  } | null;
  accountId: number;
  tokenId: number | null;
  oauthRouteUnitId: number | null;
  enabled: boolean;
  modelName: string;
  successCount: number;
  failCount: number;
  cooldownUntil: string | null;
};

export type RuntimeExecutionTargetCatalogFact = Pick<
  RuntimeExecutionTargetFact,
  | 'id'
  | 'sourceRef'
  | 'site'
  | 'enabled'
  | 'modelName'
>;

function text(value: unknown): string {
  return String(value || '').trim();
}

type RuntimeExecutionTargetCatalogJoinRow = {
  runtime_execution_targets: typeof schema.runtimeExecutionTargets.$inferSelect;
  sites: typeof schema.sites.$inferSelect | null;
};

function projectCatalogFact(
  row: RuntimeExecutionTargetCatalogJoinRow,
): RuntimeExecutionTargetCatalogFact | null {
  const target = row.runtime_execution_targets;
  const site = row.sites;
  if (!target || !site) return null;
  return {
    id: target.id,
    sourceRef: target.sourceRef,
    modelName: text(target.upstreamModelName),
    enabled: target.enabled !== false,
    site: { id: site.id, name: site.name ?? null, platform: site.platform ?? null },
  };
}

/**
 * Runtime target facts are joined once for Graph management projections. This
 * keeps account, credential and health state out of source Graph metadata.
 */
export async function loadRuntimeExecutionTargetFacts(
  executionTargetIds?: number[],
): Promise<RuntimeExecutionTargetFact[]> {
  const ids = Array.from(new Set((executionTargetIds || [])
    .map((value) => Math.trunc(Number(value)))
    .filter((value) => Number.isSafeInteger(value) && value > 0)));
  if (executionTargetIds && ids.length === 0) return [];
  const baseQuery = db.select()
    .from(schema.runtimeExecutionTargets)
    .leftJoin(schema.runtimeExecutionTargetState, eq(schema.runtimeExecutionTargets.id, schema.runtimeExecutionTargetState.executionTargetId))
    .leftJoin(schema.accounts, eq(schema.runtimeExecutionTargets.accountId, schema.accounts.id))
    .leftJoin(schema.sites, eq(schema.runtimeExecutionTargets.siteId, schema.sites.id))
    .leftJoin(schema.accountTokens, eq(schema.runtimeExecutionTargets.tokenId, schema.accountTokens.id));
  const rows = ids.length > 0
    ? await baseQuery.where(inArray(schema.runtimeExecutionTargets.id, ids)).all()
    : await baseQuery.all();
  return rows.flatMap((row): RuntimeExecutionTargetFact[] => {
    const target = row.runtime_execution_targets;
    const account = row.accounts;
    const site = row.sites;
    if (!target || !account || !site) return [];
    const state = row.runtime_execution_target_state;
    const token = row.account_tokens;
    return [{
      id: target.id,
      sourceRef: target.sourceRef,
      accountId: target.accountId ?? account.id,
      tokenId: target.tokenId ?? null,
      oauthRouteUnitId: target.oauthRouteUnitId ?? null,
      modelName: text(target.upstreamModelName),
      enabled: target.enabled !== false,
      site: { id: site.id, name: site.name ?? null, platform: site.platform ?? null },
      account: { id: account.id, username: account.username ?? null },
      token: token ? {
        id: token.id,
        name: token.name,
        accountId: token.accountId,
        enabled: token.enabled !== false,
        isDefault: token.isDefault === true,
      } : null,
      successCount: Number(state?.successCount || 0),
      failCount: Number(state?.failCount || 0),
      cooldownUntil: state?.cooldownUntil ?? null,
    }];
  });
}

/** Stable target/account/site/token catalog facts; excludes volatile health state. */
export async function loadRuntimeExecutionTargetCatalogFacts(): Promise<RuntimeExecutionTargetCatalogFact[]> {
  const rows = await db.select()
    .from(schema.runtimeExecutionTargets)
    .leftJoin(schema.sites, eq(schema.runtimeExecutionTargets.siteId, schema.sites.id))
    .all();
  return rows.map(projectCatalogFact).filter(
    (fact): fact is RuntimeExecutionTargetCatalogFact => fact !== null,
  );
}

export async function loadRuntimeExecutionTargetFactPage(input: {
  page: number;
  pageSize: number;
  offset?: number;
  query?: string | null;
}): Promise<{ facts: RuntimeExecutionTargetFact[]; totalCount: number }> {
  const page = Math.max(1, Math.trunc(input.page));
  const pageSize = Math.max(1, Math.min(200, Math.trunc(input.pageSize)));
  const query = String(input.query || '').trim().toLowerCase();
  const pattern = `%${query}%`;
  const where = query ? or(
    like(sql`lower(${schema.runtimeExecutionTargets.upstreamModelName})`, pattern),
    like(sql`lower(${schema.accounts.username})`, pattern),
    like(sql`lower(${schema.sites.name})`, pattern),
    like(sql`lower(${schema.accountTokens.name})`, pattern),
  ) : undefined;
  const base = db.select()
    .from(schema.runtimeExecutionTargets)
    .leftJoin(schema.runtimeExecutionTargetState, eq(schema.runtimeExecutionTargets.id, schema.runtimeExecutionTargetState.executionTargetId))
    .leftJoin(schema.accounts, eq(schema.runtimeExecutionTargets.accountId, schema.accounts.id))
    .leftJoin(schema.sites, eq(schema.runtimeExecutionTargets.siteId, schema.sites.id))
    .leftJoin(schema.accountTokens, eq(schema.runtimeExecutionTargets.tokenId, schema.accountTokens.id));
  const rows = await (where ? base.where(where) : base)
    .orderBy(asc(schema.accounts.username), asc(schema.runtimeExecutionTargets.upstreamModelName), asc(schema.runtimeExecutionTargets.id))
    .limit(pageSize)
    .offset(input.offset === undefined ? (page - 1) * pageSize : Math.max(0, Math.trunc(input.offset)))
    .all();
  const countBase = db.select({ count: sql<number>`count(*)` })
    .from(schema.runtimeExecutionTargets)
    .leftJoin(schema.accounts, eq(schema.runtimeExecutionTargets.accountId, schema.accounts.id))
    .leftJoin(schema.sites, eq(schema.runtimeExecutionTargets.siteId, schema.sites.id))
    .leftJoin(schema.accountTokens, eq(schema.runtimeExecutionTargets.tokenId, schema.accountTokens.id));
  const countRow = await (where ? countBase.where(where) : countBase).get();
  const facts = rows.flatMap((row): RuntimeExecutionTargetFact[] => {
    const target = row.runtime_execution_targets;
    const account = row.accounts;
    const site = row.sites;
    if (!target || !account || !site) return [];
    const state = row.runtime_execution_target_state;
    const token = row.account_tokens;
    return [{
      id: target.id,
      sourceRef: target.sourceRef,
      accountId: target.accountId ?? account.id,
      tokenId: target.tokenId ?? null,
      oauthRouteUnitId: target.oauthRouteUnitId ?? null,
      modelName: text(target.upstreamModelName),
      enabled: target.enabled !== false,
      site: { id: site.id, name: site.name ?? null, platform: site.platform ?? null },
      account: { id: account.id, username: account.username ?? null },
      token: token ? { id: token.id, name: token.name, accountId: token.accountId, enabled: token.enabled !== false, isDefault: token.isDefault === true } : null,
      successCount: Number(state?.successCount || 0),
      failCount: Number(state?.failCount || 0),
      cooldownUntil: state?.cooldownUntil ?? null,
    }];
  });
  return { facts, totalCount: Number(countRow?.count || 0) };
}

export async function loadRuntimeExecutionTargetCatalogFactPage(input: {
  page: number;
  pageSize: number;
  offset?: number;
  query?: string | null;
}): Promise<{ facts: RuntimeExecutionTargetCatalogFact[]; totalCount: number }> {
  const page = Math.max(1, Math.trunc(input.page));
  const pageSize = Math.max(1, Math.min(200, Math.trunc(input.pageSize)));
  const query = String(input.query || '').trim().toLowerCase();
  const pattern = `%${query}%`;
  const where = query ? or(
    like(sql`lower(${schema.runtimeExecutionTargets.upstreamModelName})`, pattern),
    like(sql`lower(${schema.sites.name})`, pattern),
  ) : undefined;
  const base = db.select()
    .from(schema.runtimeExecutionTargets)
    .leftJoin(schema.sites, eq(schema.runtimeExecutionTargets.siteId, schema.sites.id));
  const rows = await (where ? base.where(where) : base)
    .orderBy(asc(schema.sites.name), asc(schema.runtimeExecutionTargets.upstreamModelName), asc(schema.runtimeExecutionTargets.id))
    .limit(pageSize)
    .offset(input.offset === undefined ? (page - 1) * pageSize : Math.max(0, Math.trunc(input.offset)))
    .all();
  const countBase = db.select({ count: sql<number>`count(*)` })
    .from(schema.runtimeExecutionTargets)
    .leftJoin(schema.sites, eq(schema.runtimeExecutionTargets.siteId, schema.sites.id));
  const countRow = await (where ? countBase.where(where) : countBase).get();
  const facts = rows.map(projectCatalogFact).filter(
    (fact): fact is RuntimeExecutionTargetCatalogFact => fact !== null,
  );
  return { facts, totalCount: Number(countRow?.count || 0) };
}
