import { beforeEach, describe, expect, it, vi } from "vitest";

const evaluateUpstreamCostPricingMock = vi.hoisted(() => vi.fn());

vi.mock("./upstreamCostPricingService.js", () => ({
  evaluateUpstreamCostPricing: evaluateUpstreamCostPricingMock,
}));

describe("accountModelCostSummaryService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("evaluates model cost with the default enabled token", async () => {
    evaluateUpstreamCostPricingMock.mockResolvedValue({
      matchedScope: "token_model",
      pricing: { id: 42 },
      evaluation: { totalCostUsd: 10 },
    });

    const { buildAccountModelCostSummary } = await import(
      "./accountModelCostSummaryService.js"
    );
    const summary = await buildAccountModelCostSummary({
      siteId: 1,
      accountId: 2,
      modelName: "gpt-4o-mini",
      tokenRows: [
        { id: 10, tokenGroup: "backup", enabled: true, isDefault: false },
        { id: 11, tokenGroup: "primary", enabled: true, isDefault: true },
      ],
    });

    expect(evaluateUpstreamCostPricingMock).toHaveBeenCalledWith({
      siteId: 1,
      accountId: 2,
      tokenId: 11,
      tokenGroup: "primary",
      modelName: "gpt-4o-mini",
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        requestCount: 1,
      },
    });
    expect(summary).toEqual({
      configured: true,
      matchedScope: "token_model",
      pricingId: 42,
      totalCostUsd: 10,
    });
  });

  it("returns an empty summary when no pricing matches", async () => {
    evaluateUpstreamCostPricingMock.mockResolvedValue(null);

    const { buildAccountModelCostSummary } = await import(
      "./accountModelCostSummaryService.js"
    );
    await expect(
      buildAccountModelCostSummary({
        siteId: 1,
        accountId: 2,
        modelName: "unpriced-model",
        tokenRows: [],
      }),
    ).resolves.toEqual({
      configured: false,
      matchedScope: null,
      pricingId: null,
      totalCostUsd: null,
    });
  });
});
