import { describe, expect, it } from 'vitest';
import {
  compiledRuntimeRequestUsageConstraints,
  forecastCompiledRuntimeUsage,
  type CompiledRuntimeUsageObservation,
} from './compiledRuntimeUsageForecastService.js';

function observations(): CompiledRuntimeUsageObservation[] {
  return Array.from({ length: 24 }, (_, index) => ({
    inputBytes: 1_000,
    maxOutputTokens: 512,
    promptTokens: 250,
    completionTokens: index < 20 ? 120 : 400,
  }));
}

describe('compiledRuntimeUsageForecastService', () => {
  it('extracts request limits without retaining request content', () => {
    expect(compiledRuntimeRequestUsageConstraints({
      payload: { messages: [{ role: 'user', content: 'secret text' }], max_tokens: 256 },
    })).toMatchObject({
      inputBytes: expect.any(Number),
      maxOutputTokens: 256,
    });
  });

  it('forecasts prompt and completion tokens only from sufficient, shape-compatible observations', () => {
    const forecast = forecastCompiledRuntimeUsage({
      constraints: { inputBytes: 2_000, maxOutputTokens: 1_024 },
      observations: observations().concat([{
        inputBytes: 8_000,
        maxOutputTokens: 4_096,
        promptTokens: 2_000,
        completionTokens: 4_000,
      }]),
    });

    expect(forecast).toEqual({
      status: 'available',
      sampleCount: 24,
      confidence: 1,
      estimatedInputTokens: 500,
      expectedOutputTokens: 120,
      p90OutputTokens: 400,
      maxOutputTokens: 1_024,
    });
  });

  it('does not synthesize a forecast before sufficient comparable observations exist', () => {
    expect(forecastCompiledRuntimeUsage({
      constraints: { inputBytes: 1_000, maxOutputTokens: 512 },
      observations: observations().slice(0, 19),
    })).toEqual({
      status: 'insufficient_data',
      sampleCount: 19,
      confidence: 0.95,
      maxOutputTokens: 512,
    });
  });
});
