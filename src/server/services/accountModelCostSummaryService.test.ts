import { beforeEach, describe, expect, it, vi } from "vitest";

const quoteEndpointPricingMock = vi.hoisted(() => vi.fn());

vi.mock("./pricingQuoteService.js", () => ({
  quoteEndpointPricing: quoteEndpointPricingMock,
}));

describe("accountModelCostSummaryService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("evaluates model cost with the default enabled token", async () => {
    quoteEndpointPricingMock.mockResolvedValue({
      endpoint: {
        matchedScope: "token_model",
        sourceId: 42,
        summary: { totalCost: 10 },
      },
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

    expect(quoteEndpointPricingMock).toHaveBeenCalledWith({
      supply: {
        siteId: 1,
        accountId: 2,
        tokenId: 11,
        tokenGroup: "primary",
        modelName: "gpt-4o-mini",
      },
      usageProfile: "preview_1m_io",
      includeReference: false,
    });
    expect(summary).toEqual({
      status: "configured",
      configured: true,
      matchedScope: "token_model",
      pricingId: 42,
      totalCost: 10,
      diagnostics: [],
    });
  });

  it("returns an empty summary when no pricing matches", async () => {
    quoteEndpointPricingMock.mockResolvedValue({ endpoint: null });

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
      status: "unconfigured",
      configured: false,
      matchedScope: null,
      pricingId: null,
      totalCost: null,
      diagnostics: [],
    });
  });

  it("returns an error summary when pricing quote evaluation fails", async () => {
    quoteEndpointPricingMock.mockRejectedValue(new Error("catalog unavailable"));

    const { buildAccountModelCostSummary } = await import(
      "./accountModelCostSummaryService.js"
    );
    await expect(
      buildAccountModelCostSummary({
        siteId: 1,
        accountId: 2,
        modelName: "temporarily-unpriced-model",
        tokenRows: [],
      }),
    ).resolves.toEqual({
      status: "error",
      configured: false,
      matchedScope: null,
      pricingId: null,
      totalCost: null,
      diagnostics: [{ level: "error", message: "catalog unavailable" }],
    });
  });
});
