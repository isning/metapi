import { advanceRouteGroupManagementCatalogRevision } from './routeGroupManagementCatalogRevisionService.js';
import { db } from '../db/index.js';
import { invalidateSiteProxyCache } from './siteProxy.js';
import { invalidateAccountsSnapshot } from './accountsOverviewService.js';
import { invalidateRouteGraphReadCaches } from './routeGraphService.js';

/** Applies cache invalidation and persists the catalog revision for a site catalog write. */
export async function recordSiteCatalogMutation(database: any = db): Promise<void> {
  invalidateSiteProxyCache();
  // Execution identities retain the full SiteRow. Clear them so the next
  // dispatch observes updated URL, headers and proxy.
  invalidateRouteGraphReadCaches('site-mutated');
  await invalidateAccountsSnapshot();
  await advanceRouteGroupManagementCatalogRevision(database);
}
