import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createRouteSupplyCredentialKey, createRouteSupplyKey } from '../../shared/routingIdentity.js';
import { db, schema } from '../db/index.js';
import { getInsertedRowId } from '../db/insertHelpers.js';
import { advanceRouteGroupManagementCatalogRevision } from './routeGroupManagementCatalogRevisionService.js';

export type RuntimeExecutionTargetUpsertInput = {
  accountId: number;
  tokenId?: number | null;
  oauthRouteUnitId?: number | null;
  sourceModel: string;
  enabled?: boolean;
  discovered?: boolean;
  source: string;
  metadata?: Record<string, unknown>;
  advanceManagementCatalogRevision?: boolean;
};

function text(value: unknown): string {
  return String(value || '').trim();
}

function positiveInteger(value: unknown): number | null {
  const numeric = Math.trunc(Number(value));
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function runtimeExecutionTargetKey(input: Pick<RuntimeExecutionTargetUpsertInput, 'accountId' | 'tokenId' | 'oauthRouteUnitId' | 'sourceModel'>): string {
  const modelName = text(input.sourceModel);
  if (!modelName) throw new Error('Runtime execution target source model is required');
  const accountId = positiveInteger(input.accountId);
  if (!accountId) throw new Error('Runtime execution target account does not exist');
  return createRouteSupplyKey({
    modelName,
    credentialKey: createRouteSupplyCredentialKey({
      accountId,
      tokenId: input.tokenId ?? null,
    }),
  });
}

export async function ensureRuntimeExecutionTargetState(executionTargetId: number, database: any = db): Promise<void> {
  const id = positiveInteger(executionTargetId);
  if (!id) throw new Error('Runtime execution target id is required');
  const existing = await database.select({ id: schema.runtimeExecutionTargetState.id })
    .from(schema.runtimeExecutionTargetState)
    .where(eq(schema.runtimeExecutionTargetState.executionTargetId, id))
    .get();
  if (existing) return;
  await database.insert(schema.runtimeExecutionTargetState).values({ executionTargetId: id }).run();
}

/**
 * Runtime execution targets are transport facts, not Route Group members or
 * Graph nodes. Their Graph relation is added separately by endpoint authoring.
 */
export async function upsertRuntimeExecutionTarget(
  input: RuntimeExecutionTargetUpsertInput,
  database: any = db,
): Promise<typeof schema.runtimeExecutionTargets.$inferSelect> {
  const accountId = positiveInteger(input.accountId);
  const sourceModel = text(input.sourceModel);
  if (!accountId) throw new Error('Runtime execution target account does not exist');
  if (!sourceModel) throw new Error('Runtime execution target source model is required');
  const account = await database.select({ siteId: schema.accounts.siteId })
    .from(schema.accounts)
    .where(eq(schema.accounts.id, accountId))
    .get();
  if (!account) throw new Error(`Account ${accountId} does not exist`);
  const executionKey = runtimeExecutionTargetKey({ ...input, accountId, sourceModel });
  const metadataJson = JSON.stringify(input.metadata || {});
  const values = {
    executionKey,
    siteId: account.siteId,
    accountId,
    tokenId: input.tokenId ?? null,
    oauthRouteUnitId: input.oauthRouteUnitId ?? null,
    upstreamModelName: sourceModel,
    normalizedModelName: sourceModel.toLowerCase(),
    enabled: input.enabled !== false,
    discovered: input.discovered === true,
    source: text(input.source) || 'manual',
    metadataJson,
    updatedAt: nowIso(),
  };
  const existing = await database.select().from(schema.runtimeExecutionTargets)
    .where(eq(schema.runtimeExecutionTargets.executionKey, executionKey))
    .get();
  if (existing) {
    await database.update(schema.runtimeExecutionTargets).set(values)
      .where(eq(schema.runtimeExecutionTargets.id, existing.id)).run();
    if (input.advanceManagementCatalogRevision !== false) {
      await advanceRouteGroupManagementCatalogRevision(database);
    }
    return { ...existing, ...values } as typeof schema.runtimeExecutionTargets.$inferSelect;
  }
  const inserted = await database.insert(schema.runtimeExecutionTargets).values({
    ...values,
    sourceRef: randomUUID(),
  }).run();
  const id = getInsertedRowId(inserted);
  if (!id) throw new Error('Failed to create runtime execution target');
  const created = await database.select().from(schema.runtimeExecutionTargets)
    .where(eq(schema.runtimeExecutionTargets.id, id)).get();
  if (!created) throw new Error('Failed to load runtime execution target');
  await ensureRuntimeExecutionTargetState(created.id, database);
  if (input.advanceManagementCatalogRevision !== false) {
    await advanceRouteGroupManagementCatalogRevision(database);
  }
  return created;
}
