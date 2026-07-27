import { clearEndpointPricingReferenceCache } from './endpointPricingService.js';
import {
  listProviderPricingCatalogRefreshSubjects,
  refreshProviderPricingCatalog,
} from './providerPricingCatalogCacheService.js';
import { clearModelsMarketplaceCache } from './modelsMarketplaceCacheService.js';
import { invalidateRouteRuntimeCaches } from './routeRuntimeCacheService.js';

const RUNTIME_FACT_WARM_CONCURRENCY = 2;

let runtimeFactWarmInFlight: Promise<void> | null = null;

async function runBatches<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  for (let index = 0; index < items.length; index += RUNTIME_FACT_WARM_CONCURRENCY) {
    const batch = items.slice(index, index + RUNTIME_FACT_WARM_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(worker));
    for (const result of settled) {
      if (result.status === 'rejected') {
        console.warn(`[RuntimeFactWarm] ${result.reason instanceof Error ? result.reason.message : String(result.reason || 'unknown error')}`);
      }
    }
  }
}

async function runRuntimeFactWarmPass(reason: string): Promise<void> {
  const subjects = await listProviderPricingCatalogRefreshSubjects();
  await runBatches(subjects, async (subject) => {
    const result = await refreshProviderPricingCatalog({
      ...subject,
      reason,
    });
    if (result.status === 'error' && result.error) {
      console.warn(`[RuntimeFactWarm] Provider pricing catalog refresh failed for site ${subject.siteId}, account ${subject.accountId ?? 'site'}: ${result.error}`);
    }
  });

  if (subjects.length > 0) {
    clearEndpointPricingReferenceCache();
    invalidateRouteRuntimeCaches('pricing-config-mutated');
    clearModelsMarketplaceCache();
  }
}

export async function warmRuntimeFactsOnce(reason = 'startup'): Promise<void> {
  if (runtimeFactWarmInFlight) return runtimeFactWarmInFlight;
  runtimeFactWarmInFlight = runRuntimeFactWarmPass(reason).finally(() => {
    runtimeFactWarmInFlight = null;
  });
  return runtimeFactWarmInFlight;
}

export function startPostMigrationRuntimeFactWarm(reason = 'post-migration'): void {
  void warmRuntimeFactsOnce(reason);
}

export async function __resetRuntimeFactWarmForTests(): Promise<void> {
  if (runtimeFactWarmInFlight) await runtimeFactWarmInFlight;
  runtimeFactWarmInFlight = null;
}
