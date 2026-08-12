import { beforeEach, describe, expect, it } from 'vitest';
import {
  getCacheAffinityObservation,
  recordCacheAffinityObservation,
  resetCacheAffinityObservationsForTest,
} from './cacheAffinityObservationService.js';

describe('cacheAffinityObservationService', () => {
  beforeEach(() => resetCacheAffinityObservationsForTest());

  it('uses a conservative prior and learns cached prefix coverage from real hits', () => {
    recordCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
      promptTokens: 100,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      promptTokensIncludeCache: true,
      observedAtMs: 1_000,
    });

    expect(getCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
      nowMs: 1_001,
    })).toEqual({
      sampleCount: 1,
      hitProbability: 0.5,
      cachedReadFraction: 0.8,
      hitCacheWriteFraction: 0,
      missCacheWriteFraction: 0,
    });
  });

  it('isolates target, endpoint type, and content prefix', () => {
    recordCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
      promptTokens: 100,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
    });

    expect(getCacheAffinityObservation({ executionTargetId: 8, endpointType: 'openai.responses', contentAffinityKey: 'content:abc' })).toBeNull();
    expect(getCacheAffinityObservation({ executionTargetId: 7, endpointType: 'anthropic.messages', contentAffinityKey: 'content:abc' })).toBeNull();
    expect(getCacheAffinityObservation({ executionTargetId: 7, endpointType: 'openai.responses', contentAffinityKey: 'content:def' })).toBeNull();
  });

  it('resolves a request endpoint type to the actual successful upstream type', () => {
    recordCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'openai.chat_completions',
      requestEndpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
      promptTokens: 100,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
    });

    expect(getCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
    })).toMatchObject({ hitProbability: 0.5, cachedReadFraction: 0.8 });
  });

  it('uses the latest successful endpoint alias over stale direct observations', () => {
    recordCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'openai.responses',
      requestEndpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
      promptTokens: 100,
      cacheReadTokens: 20,
      cacheWriteTokens: 0,
      observedAtMs: 1_000,
    });
    recordCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'openai.chat_completions',
      requestEndpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
      promptTokens: 100,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      observedAtMs: 2_000,
    });

    expect(getCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
      nowMs: 2_001,
    })).toMatchObject({ cachedReadFraction: 0.8 });
  });

  it('treats an explicit cache-write-only response as a miss and expires old evidence', () => {
    recordCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
      promptTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 60,
      observedAtMs: 1_000,
    });

    expect(getCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
      nowMs: 1_001,
    })).toMatchObject({ hitProbability: 0, missCacheWriteFraction: 0.6 });
    expect(getCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
      nowMs: 3_602_000,
    })).toBeNull();
  });

  it('smooths repeated hits and misses without turning content evidence into certainty', () => {
    for (let index = 0; index < 3; index += 1) {
      recordCacheAffinityObservation({
        executionTargetId: 7,
        endpointType: 'openai.responses',
        contentAffinityKey: 'content:abc',
        promptTokens: 100,
        cacheReadTokens: 80,
        cacheWriteTokens: 0,
        observedAtMs: 1_000 + index,
      });
    }
    recordCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
      promptTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 20,
      observedAtMs: 1_004,
    });

    const observation = getCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
      nowMs: 1_005,
    });
    expect(observation).toMatchObject({
      sampleCount: 4,
      hitProbability: 0.6,
      hitCacheWriteFraction: 0,
      missCacheWriteFraction: 0.2,
    });
    expect(observation?.cachedReadFraction).toBeCloseTo(0.8);
  });

  it('includes Anthropic cache tokens in the observed input denominator', () => {
    recordCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'anthropic.messages',
      contentAffinityKey: 'content:abc',
      promptTokens: 20,
      cacheReadTokens: 70,
      cacheWriteTokens: 10,
      promptTokensIncludeCache: false,
    });

    expect(getCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'anthropic.messages',
      contentAffinityKey: 'content:abc',
    })).toMatchObject({
      cachedReadFraction: 0.7,
      hitCacheWriteFraction: 0.1,
    });
  });

  it('stops following a protocol fallback alias after the alias expires', () => {
    recordCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'openai.chat_completions',
      requestEndpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
      promptTokens: 100,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      observedAtMs: 1_000,
    });

    expect(getCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
      nowMs: 3_602_000,
    })).toBeNull();
  });

  it('returns to direct endpoint evidence after the requested protocol succeeds again', () => {
    recordCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'openai.chat_completions',
      requestEndpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
      promptTokens: 100,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      observedAtMs: 1_000,
    });
    recordCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'openai.responses',
      requestEndpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
      promptTokens: 100,
      cacheReadTokens: 25,
      cacheWriteTokens: 0,
      observedAtMs: 2_000,
    });

    expect(getCacheAffinityObservation({
      executionTargetId: 7,
      endpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
      nowMs: 2_001,
    })).toMatchObject({ cachedReadFraction: 0.25 });
  });
});
