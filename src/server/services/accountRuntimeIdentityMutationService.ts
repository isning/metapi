import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { invalidateRouteGraphReadCaches } from './routeGraphService.js';
import { invalidateAccountsSnapshot } from './accountsOverviewService.js';

/** Invalidates account picker/list snapshots after a committed account catalog write. */
export async function recordAccountsCatalogMutation(): Promise<void> {
  await invalidateAccountsSnapshot();
}

/** Persists account fields used by dispatch and invalidates their runtime identity. */
export async function updateAccountRuntimeIdentity(
  accountId: number,
  updates: Partial<typeof schema.accounts.$inferInsert>,
): Promise<void> {
  await db.update(schema.accounts)
    .set({ ...updates, updatedAt: new Date().toISOString() })
    .where(eq(schema.accounts.id, accountId))
    .run();
  invalidateRouteGraphReadCaches('account-mutated');
  await recordAccountsCatalogMutation();
}
