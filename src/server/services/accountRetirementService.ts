import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { mutateActiveRouteGraphSourceTransaction } from './routeGraphService.js';
import { removeRouteGraphExecutionTargets } from './routeGraphExecutionTargetEndpointService.js';
import { advanceRouteGroupManagementCatalogRevision } from './routeGroupManagementCatalogRevisionService.js';

/** Retires an account and every Graph transport binding that references it. */
export async function retireAccountFromRouting(accountId: number, createdBy: string): Promise<void> {
  await mutateActiveRouteGraphSourceTransaction({
    createdBy,
    mutate: async (transaction, source) => {
      const account = await transaction.select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(eq(schema.accounts.id, accountId))
        .get();
      if (!account) throw new Error('oauth account not found');
      const targets = await transaction.select({ id: schema.runtimeExecutionTargets.id })
        .from(schema.runtimeExecutionTargets)
        .where(eq(schema.runtimeExecutionTargets.accountId, accountId))
        .all();
      const targetIds = targets.map((target: { id: number }) => target.id);
      const pruned = removeRouteGraphExecutionTargets(source, targetIds);
      if (targetIds.length > 0) {
        await transaction.delete(schema.runtimeExecutionTargetState)
          .where(inArray(schema.runtimeExecutionTargetState.executionTargetId, targetIds)).run();
        await transaction.delete(schema.runtimeExecutionTargets)
          .where(inArray(schema.runtimeExecutionTargets.id, targetIds)).run();
      }
      await transaction.delete(schema.accounts).where(eq(schema.accounts.id, accountId)).run();
      await advanceRouteGroupManagementCatalogRevision(transaction);
      return { source: pruned.source, result: undefined };
    },
  });
}

/** Retires a site and every Graph transport binding rooted at that site. */
export async function retireSiteFromRouting(siteId: number, createdBy: string): Promise<void> {
  await mutateActiveRouteGraphSourceTransaction({
    createdBy,
    mutate: async (transaction, source) => {
      const site = await transaction.select({ id: schema.sites.id })
        .from(schema.sites)
        .where(eq(schema.sites.id, siteId))
        .get();
      if (!site) throw new Error('site not found');
      const targets = await transaction.select({ id: schema.runtimeExecutionTargets.id })
        .from(schema.runtimeExecutionTargets)
        .where(eq(schema.runtimeExecutionTargets.siteId, siteId))
        .all();
      const targetIds = targets.map((target: { id: number }) => target.id);
      const pruned = removeRouteGraphExecutionTargets(source, targetIds);
      if (targetIds.length > 0) {
        await transaction.delete(schema.runtimeExecutionTargetState)
          .where(inArray(schema.runtimeExecutionTargetState.executionTargetId, targetIds)).run();
        await transaction.delete(schema.runtimeExecutionTargets)
          .where(inArray(schema.runtimeExecutionTargets.id, targetIds)).run();
      }
      await transaction.delete(schema.sites).where(eq(schema.sites.id, siteId)).run();
      await advanceRouteGroupManagementCatalogRevision(transaction);
      return { source: pruned.source, result: undefined };
    },
  });
}

/** Retires one model-call key and every Graph transport binding that uses it. */
export async function retireAccountTokenFromRouting(tokenId: number, createdBy: string): Promise<void> {
  await mutateActiveRouteGraphSourceTransaction({
    createdBy,
    mutate: async (transaction, source) => {
      const token = await transaction.select({ id: schema.accountTokens.id })
        .from(schema.accountTokens)
        .where(eq(schema.accountTokens.id, tokenId))
        .get();
      if (!token) throw new Error('account token not found');
      const targets = await transaction.select({ id: schema.runtimeExecutionTargets.id })
        .from(schema.runtimeExecutionTargets)
        .where(eq(schema.runtimeExecutionTargets.tokenId, tokenId))
        .all();
      const targetIds = targets.map((target: { id: number }) => target.id);
      const pruned = removeRouteGraphExecutionTargets(source, targetIds);
      if (targetIds.length > 0) {
        await transaction.delete(schema.runtimeExecutionTargetState)
          .where(inArray(schema.runtimeExecutionTargetState.executionTargetId, targetIds)).run();
        await transaction.delete(schema.runtimeExecutionTargets)
          .where(inArray(schema.runtimeExecutionTargets.id, targetIds)).run();
      }
      await transaction.delete(schema.accountTokens).where(eq(schema.accountTokens.id, tokenId)).run();
      await advanceRouteGroupManagementCatalogRevision(transaction);
      return { source: pruned.source, result: undefined };
    },
  });
}
