import { normalizeAvailabilityManagedRouteGroups } from './routeGroupAutomaticOwnership.js';
import {
  getActiveRouteGraphSourceVersion,
  publishRouteGraphSource,
} from './routeGraphService.js';

export type AutomaticRouteGroupCandidateSourceMigrationSummary = {
  migratedRouteGroups: number;
  publishedVersion: number | null;
};

/** Publishes one normalized version for legacy automatic pattern selectors. */
export async function migrateAutomaticRouteGroupCandidateSources(): Promise<AutomaticRouteGroupCandidateSourceMigrationSummary> {
  const active = await getActiveRouteGraphSourceVersion();
  if (!active) return {
    migratedRouteGroups: 0,
    publishedVersion: null,
  };

  const normalized = normalizeAvailabilityManagedRouteGroups(active.sourceGraph);
  if (!normalized.changed) {
    return {
      migratedRouteGroups: 0,
      publishedVersion: null,
    };
  }

  const published = await publishRouteGraphSource({
    sourceGraph: normalized.source,
    createdBy: 'automatic-route-group-source-migration',
  });
  if (!published.ok) {
    const detail = published.diagnostics.map((diagnostic) => diagnostic.message).join('; ');
    throw new Error(`Failed to migrate automatic Route Group candidate sources: ${detail}`);
  }
  return {
    migratedRouteGroups: normalized.migratedRouteGroups,
    publishedVersion: published.version.version,
  };
}
