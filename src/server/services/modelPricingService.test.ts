import { describe, expect, it } from 'vitest';
import {
  calculateModelUsageBreakdown,
  calculateModelUsageCost,
  type PricingModel,
} from './modelPricingService.js';

describe('modelPricingService', () => {
  it('calculates token-based cost from model ratio and completion ratio', () => {
    const model: PricingModel = {
      modelName: 'gpt-4o',
      quotaType: 0,
      modelRatio: 2,
      completionRatio: 1.5,
      modelPrice: null,
      enableGroups: ['vip'],
    };

    const cost = calculateModelUsageCost(
      model,
      {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      },
      { default: 1, vip: 2 },
    );

    expect(cost).toBe(0.014);
  });

  it('falls back to total tokens when split token usage is missing', () => {
    const model: PricingModel = {
      modelName: 'claude-sonnet',
      quotaType: 0,
      modelRatio: 1,
      completionRatio: 2,
      modelPrice: null,
      enableGroups: ['default'],
    };

    const cost = calculateModelUsageCost(
      model,
      {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 2000,
      },
      { default: 1 },
    );

    expect(cost).toBe(0.004);
  });

  it('calculates per-call cost when quota type is call-based', () => {
    const model: PricingModel = {
      modelName: 'gpt-image-1',
      quotaType: 1,
      modelRatio: 1,
      completionRatio: 1,
      modelPrice: 0.3,
      enableGroups: ['vip'],
    };

    const cost = calculateModelUsageCost(
      model,
      {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      { default: 1, vip: 1.5 },
    );

    expect(cost).toBe(0.45);
  });

  it('calculates times-based per-call cost from input ratio only', () => {
    const model: PricingModel = {
      modelName: 'flux-kontext-pro',
      quotaType: 1,
      modelRatio: 1,
      completionRatio: 1,
      modelPrice: { input: 1, output: 3 },
      enableGroups: ['vip'],
    };

    const cost = calculateModelUsageCost(
      model,
      {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      { default: 1, vip: 2 },
    );

    expect(cost).toBe(0.004);
  });

  it('splits cache read and cache creation costs from prompt cost', () => {
    const model: PricingModel = {
      modelName: 'gpt-4o',
      quotaType: 0,
      modelRatio: 2.5,
      completionRatio: 5,
      cacheRatio: 0.1,
      cacheCreationRatio: 1.25,
      modelPrice: null,
      enableGroups: ['default'],
    };

    const detail = calculateModelUsageBreakdown(
      model,
      {
        promptTokens: 146638,
        completionTokens: 172,
        totalTokens: 146810,
        cacheReadTokens: 145692,
        cacheCreationTokens: 945,
        promptTokensIncludeCache: true,
      },
      { default: 1 },
    );

    expect(detail).toMatchObject({
      usage: {
        billablePromptTokens: 1,
        cacheReadTokens: 145692,
        cacheCreationTokens: 945,
      },
      pricing: {
        modelRatio: 2.5,
        completionRatio: 5,
        cacheRatio: 0.1,
        cacheCreationRatio: 1.25,
        groupRatio: 1,
      },
      breakdown: {
        inputPerMillion: 5,
        outputPerMillion: 25,
        cacheReadPerMillion: 0.5,
        cacheCreationPerMillion: 6.25,
        inputCost: 0.000005,
        outputCost: 0.0043,
        cacheReadCost: 0.072846,
        cacheCreationCost: 0.005906,
        totalCost: 0.083057,
      },
    });
  });

  it('keeps prompt tokens intact when upstream reports cache tokens separately', () => {
    const model: PricingModel = {
      modelName: 'claude-sonnet',
      quotaType: 0,
      modelRatio: 3,
      completionRatio: 5,
      cacheRatio: 0.3,
      cacheCreationRatio: 1.25,
      modelPrice: null,
      enableGroups: ['default'],
    };

    const cost = calculateModelUsageCost(
      model,
      {
        promptTokens: 120,
        completionTokens: 30,
        totalTokens: 150,
        cacheReadTokens: 1000,
        cacheCreationTokens: 40,
        promptTokensIncludeCache: false,
      },
      { default: 1 },
    );

    expect(cost).toBe(0.00372);
  });

  it('uses the selected group price card before applying its multiplier', () => {
    const model: PricingModel = {
      modelName: 'sub2api-model',
      quotaType: 0,
      modelRatio: 1,
      completionRatio: 1,
      modelPrice: { input: 2, output: 8, cacheRead: 1, cacheWrite: 3 },
      groupPrices: {
        standard: { input: 2, output: 8, cacheRead: 1, cacheWrite: 3 },
        premium: { input: 1, output: 4, cacheRead: 0.5, cacheWrite: 1.5 },
      },
      enableGroups: ['standard', 'premium'],
    };

    const detail = calculateModelUsageBreakdown(
      model,
      {
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
        totalTokens: 2_000_000,
        cacheReadTokens: 200_000,
        cacheCreationTokens: 100_000,
        promptTokensIncludeCache: true,
      },
      { standard: 1, premium: 1.25 },
      'premium',
    );

    expect(detail).toMatchObject({
      usage: { billablePromptTokens: 700_000 },
      pricing: { groupRatio: 1.25 },
      breakdown: {
        inputPerMillion: 1.25,
        outputPerMillion: 5,
        cacheReadPerMillion: 0.625,
        cacheCreationPerMillion: 1.875,
        inputCost: 0.875,
        outputCost: 5,
        cacheReadCost: 0.125,
        cacheCreationCost: 0.1875,
        totalCost: 6.1875,
      },
    });
  });

  it('uses the selected group price for per-request models', () => {
    const model: PricingModel = {
      modelName: 'sub2api-image-model',
      quotaType: 1,
      modelRatio: 1,
      completionRatio: 1,
      modelPrice: 0.04,
      groupPrices: { standard: 0.04, premium: 0.025 },
      enableGroups: ['standard', 'premium'],
    };

    expect(calculateModelUsageCost(
      model,
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      { standard: 1, premium: 2 },
      'premium',
    )).toBe(0.05);
  });

});
