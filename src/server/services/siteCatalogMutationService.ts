import { advanceRouteGroupManagementCatalogRevision } from './routeGroupManagementCatalogRevisionService.js';
import { invalidateSiteProxyCache } from './siteProxy.js';

/** Applies cache/revision side effects owned by a committed site catalog write. */
export async function recordSiteCatalogMutation(): Promise<void> {
  invalidateSiteProxyCache();
  await advanceRouteGroupManagementCatalogRevision();
}
