import type { CanonicalUsage } from './types.js';
import { stableSha256 } from './hash.js';

const CANONICAL_USAGE_ZERO: CanonicalUsage = {
  schemaVersion: 1,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  requestCount: 1,
  imageInputUnits: 0,
  imageOutputUnits: 0,
  audioInputSeconds: 0,
  audioOutputSeconds: 0,
  videoInputSeconds: 0,
  storageMegabyteMonths: 0,
  custom: {},
};

export function normalizeCanonicalUsage(input: Partial<CanonicalUsage> = {}): CanonicalUsage {
  const custom: Record<string, number> = {};
  if (input.custom && typeof input.custom === 'object') {
    for (const [key, value] of Object.entries(input.custom)) {
      custom[key] = normalizeQuantity(value);
    }
  }

  return {
    schemaVersion: 1,
    inputTokens: normalizeQuantity(input.inputTokens),
    outputTokens: normalizeQuantity(input.outputTokens),
    reasoningTokens: normalizeQuantity(input.reasoningTokens),
    cacheReadTokens: normalizeQuantity(input.cacheReadTokens),
    cacheWriteTokens: normalizeQuantity(input.cacheWriteTokens),
    totalTokens: normalizeQuantity(input.totalTokens),
    requestCount: input.requestCount === undefined ? CANONICAL_USAGE_ZERO.requestCount : normalizeQuantity(input.requestCount),
    imageInputUnits: normalizeQuantity(input.imageInputUnits),
    imageOutputUnits: normalizeQuantity(input.imageOutputUnits),
    audioInputSeconds: normalizeQuantity(input.audioInputSeconds),
    audioOutputSeconds: normalizeQuantity(input.audioOutputSeconds),
    videoInputSeconds: normalizeQuantity(input.videoInputSeconds),
    storageMegabyteMonths: normalizeQuantity(input.storageMegabyteMonths),
    custom,
  };
}

export function hashCanonicalUsage(usage: CanonicalUsage): string {
  return stableSha256(normalizeCanonicalUsage(usage));
}

function normalizeQuantity(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return numeric;
}

