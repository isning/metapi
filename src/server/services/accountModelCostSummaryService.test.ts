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

    const { buildModelCostSummary, resolveAccountPricingToken } = await import(
      "./accountModelCostSummaryService.js"
    );
    const summary = await buildModelCostSummary({
      subject: {
        siteId: 1,
        accountId: 2,
        token: resolveAccountPricingToken([
          { id: 10, tokenGroup: "backup", enabled: true, isDefault: false },
          { id: 11, tokenGroup: "primary", enabled: true, isDefault: true },
        ]),
      },
      modelName: "gpt-4o-mini",
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

  it("projects account and token rows through the same pricing function", async () => {
    quoteEndpointPricingMock.mockResolvedValue({
      endpoint: { matchedScope: "provider_catalog", sourceId: "catalog", summary: { totalCost: 2 } },
    });
    const { buildPricedModelRows, resolveAccountPricingToken } = await import("./accountModelCostSummaryService.js");
    const token = { id: 10, tokenGroup: "primary", enabled: true, isDefault: true };
    const models = [{ name: "shared-model", disabled: false, latencyMs: 12 }];

    const [accountRow] = await buildPricedModelRows({
      models,
      subject: { siteId: 1, accountId: 2, token: resolveAccountPricingToken([token]) },
    });
    const [tokenRow] = await buildPricedModelRows({
      models,
      subject: { siteId: 1, accountId: 2, token },
    });

    expect(accountRow).toEqual(tokenRow);
    expect(accountRow.costPricing).toMatchObject({
      status: "configured",
      matchedScope: "provider_catalog",
      totalCost: 2,
    });
  });

  it("returns an empty summary when no pricing matches", async () => {
    quoteEndpointPricingMock.mockResolvedValue({ endpoint: null });

    const { buildModelCostSummary } = await import(
      "./accountModelCostSummaryService.js"
    );
    await expect(
      buildModelCostSummary({
        subject: { siteId: 1, accountId: 2, token: null },
        modelName: "unpriced-model",
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

  it("uses an explicit token subject without changing the pricing projection", async () => {
    quoteEndpointPricingMock.mockResolvedValue({ endpoint: null });

    const { buildModelCostSummary } = await import(
      "./accountModelCostSummaryService.js"
    );
    await buildModelCostSummary({
      subject: {
        siteId: 1,
        accountId: 2,
        token: { id: 10, tokenGroup: "backup", enabled: true, isDefault: false },
      },
      modelName: "token-specific-model",
    });

    expect(quoteEndpointPricingMock).toHaveBeenCalledWith(expect.objectContaining({
      supply: expect.objectContaining({ tokenId: 10, tokenGroup: "backup" }),
    }));
  });

  it("returns an error summary when pricing quote evaluation fails", async () => {
    quoteEndpointPricingMock.mockRejectedValue(new Error("catalog unavailable"));

    const { buildModelCostSummary } = await import(
      "./accountModelCostSummaryService.js"
    );
    await expect(
      buildModelCostSummary({
        subject: { siteId: 1, accountId: 2, token: null },
        modelName: "temporarily-unpriced-model",
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
