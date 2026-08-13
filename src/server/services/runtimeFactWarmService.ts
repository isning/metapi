import { clearEndpointPricingReferenceCache } from './endpointPricingService.js';
import {
  listDueProviderPricingCatalogRefreshSubjects,
  listProviderPricingCatalogRefreshSubjects,
  refreshProviderPricingCatalog,
} from './providerPricingCatalogCacheService.js';
import { clearModelsMarketplaceCache } from './modelsMarketplaceCacheService.js';
import { invalidateRouteRuntimeCaches } from './routeRuntimeCacheService.js';

const RUNTIME_FACT_WARM_CONCURRENCY = 2;
const RUNTIME_FACT_WARM_INTERVAL_MS = 15 * 60 * 1000;

let runtimeFactWarmInFlight: Promise<void> | null = null;
let runtimeFactWarmTimer: ReturnType<typeof setInterval> | null = null;

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

async function runRuntimeFactWarmPass(reason: string, dueOnly = false): Promise<void> {
  const subjects = dueOnly
    ? await listDueProviderPricingCatalogRefreshSubjects({ dueWithinMs: RUNTIME_FACT_WARM_INTERVAL_MS })
    : await listProviderPricingCatalogRefreshSubjects();
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

export async function warmDueRuntimeFactsOnce(reason = 'scheduled'): Promise<void> {
  if (runtimeFactWarmInFlight) return runtimeFactWarmInFlight;
  runtimeFactWarmInFlight = runRuntimeFactWarmPass(reason, true).finally(() => {
    runtimeFactWarmInFlight = null;
  });
  return runtimeFactWarmInFlight;
}

export function startPostMigrationRuntimeFactWarm(reason = 'post-migration'): void {
  void warmRuntimeFactsOnce(reason);
}

export function startRuntimeFactWarmScheduler(intervalMs = RUNTIME_FACT_WARM_INTERVAL_MS): void {
  if (runtimeFactWarmTimer) return;
  const safeIntervalMs = Math.max(60_000, Math.trunc(intervalMs || RUNTIME_FACT_WARM_INTERVAL_MS));
  runtimeFactWarmTimer = setInterval(() => {
    void warmDueRuntimeFactsOnce('scheduled');
  }, safeIntervalMs);
  runtimeFactWarmTimer.unref?.();
}

export async function stopRuntimeFactWarmScheduler(): Promise<void> {
  if (runtimeFactWarmTimer) {
    clearInterval(runtimeFactWarmTimer);
    runtimeFactWarmTimer = null;
  }
  if (runtimeFactWarmInFlight) await runtimeFactWarmInFlight;
}

export async function __resetRuntimeFactWarmForTests(): Promise<void> {
  await stopRuntimeFactWarmScheduler();
  runtimeFactWarmInFlight = null;
}
