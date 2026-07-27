import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, runtimeDbDialect, schema } from '../db/index.js';

export const ROUTE_GROUP_MANAGEMENT_CATALOG_REVISION_KEY =
  'route_group_management_catalog_revision';

export async function loadRouteGroupManagementCatalogRevision(
  database: any = db,
): Promise<string> {
  const row = await database.select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, ROUTE_GROUP_MANAGEMENT_CATALOG_REVISION_KEY))
    .get();
  return typeof row?.value === 'string' ? row.value : '';
}

/** Advances the durable revision owned by stable target/site catalog writes. */
export async function advanceRouteGroupManagementCatalogRevision(
  database: any = db,
): Promise<string> {
  const revision = randomUUID();
  const insert = database.insert(schema.settings).values({
    key: ROUTE_GROUP_MANAGEMENT_CATALOG_REVISION_KEY,
    value: revision,
  });
  if (runtimeDbDialect === 'mysql') {
    await insert.onDuplicateKeyUpdate({ set: { value: revision } }).run();
  } else {
    await insert.onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: revision },
    }).run();
  }
  return revision;
}
