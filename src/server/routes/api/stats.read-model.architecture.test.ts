import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const statsRoutePath = new URL("./stats.ts", import.meta.url);

describe("stats route read-model boundaries", () => {
  it("delegates proxy-log, marketplace and route-flow use cases to dedicated services", async () => {
    const source = await readFile(statsRoutePath, "utf8");

    expect(source).toContain("from \"../../services/proxyRequestLogReadModelService.js\"");
    expect(source).toContain("from \"../../services/modelsMarketplaceReadModelService.js\"");
    expect(source).toContain("from \"../../services/modelRouteFlowReadModelService.js\"");
    expect(source).not.toMatch(/from\s+["']\.\.\/\.\.\/db\/index\.js["']/);
    expect(source).not.toMatch(/\b(?:db|schema)\./);
    for (const forbidden of [
      'compiledRuntimeInventoryService.js',
      'modelsMarketplaceRuntimeFactsService.js',
      'modelsMarketplaceCacheService.js',
      'providerPricingCatalogCacheService.js',
      'pricingQuoteService.js',
      'routeFlowService.js',
      'listActiveCompiledRuntimeModelInventory',
      'quoteEndpointPricing',
      'writeModelsMarketplaceCache',
      'getCompiledRuntimeRouteFlow',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
