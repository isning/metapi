import { and, gte, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";

const modelHealthRequestFields = {
  createdAt: schema.proxyRequests.completedAt,
  routeEntrypointId: schema.proxyRequests.routeEntrypointId,
  modelRequested: schema.proxyRequests.requestedModel,
  status: schema.proxyRequests.status,
  latencyMs: schema.proxyRequests.latencyMs,
  totalTokens: schema.proxyRequests.totalTokens,
  estimatedCost: schema.proxyRequests.estimatedCost,
};

const modelPricingRequestFields = {
  createdAt: schema.proxyRequests.completedAt,
  modelRequested: schema.proxyRequests.requestedModel,
  routeEntrypointId: schema.proxyRequests.routeEntrypointId,
  status: schema.proxyRequests.status,
  billingDetails: schema.proxyRequests.billingDetails,
};

export type MarketplaceHealthRequestFact = typeof modelHealthRequestFields;
export type MarketplacePricingRequestFact = typeof modelPricingRequestFields;

/**
 * Runtime observations used to enrich the compiled-runtime marketplace inventory.
 * This is intentionally a bounded read model: it does not resolve Graph or Route Group state.
 */
export async function listModelsMarketplaceRuntimeFacts(input: {
  realtimeHealthStart: string;
  pricingStart: string;
}) {
  const [recentHealthLogs, recentPricingLogs] = await Promise.all([
    db
      .select(modelHealthRequestFields)
      .from(schema.proxyRequests)
      .where(and(
        gte(schema.proxyRequests.completedAt, input.realtimeHealthStart),
        inArray(schema.proxyRequests.status, ["success", "failed"]),
      ))
      .all(),
    db
      .select(modelPricingRequestFields)
      .from(schema.proxyRequests)
      .where(and(
        gte(schema.proxyRequests.completedAt, input.pricingStart),
        inArray(schema.proxyRequests.status, ["success", "failed"]),
      ))
      .all(),
  ]);

  return { recentHealthLogs, recentPricingLogs };
}
