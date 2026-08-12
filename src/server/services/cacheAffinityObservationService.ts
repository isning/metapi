const MAX_OBSERVATIONS = 10_000;
const OBSERVATION_TTL_MS = 60 * 60 * 1000;
const MAX_EFFECTIVE_SAMPLES = 32;

type CacheAffinityObservationState = {
  sampleCount: number;
  hitCount: number;
  hitCachedFractionTotal: number;
  hitFractionSamples: number;
  hitWriteFractionTotal: number;
  missWriteFractionTotal: number;
  missWriteFractionSamples: number;
  updatedAtMs: number;
};

export type CacheAffinityObservation = {
  sampleCount: number;
  hitProbability: number;
  cachedReadFraction: number;
  hitCacheWriteFraction: number;
  missCacheWriteFraction: number;
};

const observations = new Map<string, CacheAffinityObservationState>();
const endpointAliases = new Map<string, { endpointType: string; updatedAtMs: number }>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function observationKey(input: {
  executionTargetId: number;
  endpointType: string;
  contentAffinityKey: string;
}): string | null {
  const targetId = Math.trunc(Number(input.executionTargetId));
  const endpointType = String(input.endpointType || '').trim().toLowerCase();
  const contentAffinityKey = String(input.contentAffinityKey || '').trim();
  if (!Number.isSafeInteger(targetId) || targetId <= 0 || !endpointType || !contentAffinityKey) return null;
  return `${targetId}|${endpointType}|${contentAffinityKey}`;
}

function aliasKey(input: {
  executionTargetId: number;
  requestEndpointType: string;
  contentAffinityKey: string;
}): string | null {
  return observationKey({
    executionTargetId: input.executionTargetId,
    endpointType: input.requestEndpointType,
    contentAffinityKey: input.contentAffinityKey,
  });
}

function evictExpiredAndOverflow(nowMs: number): void {
  for (const [key, value] of observations) {
    if (nowMs - value.updatedAtMs > OBSERVATION_TTL_MS) observations.delete(key);
  }
  for (const [key, value] of endpointAliases) {
    if (nowMs - value.updatedAtMs > OBSERVATION_TTL_MS) endpointAliases.delete(key);
  }
  while (observations.size > MAX_OBSERVATIONS) {
    const oldest = observations.keys().next().value as string | undefined;
    if (!oldest) break;
    observations.delete(oldest);
  }
  while (endpointAliases.size > MAX_OBSERVATIONS) {
    const oldest = endpointAliases.keys().next().value as string | undefined;
    if (!oldest) break;
    endpointAliases.delete(oldest);
  }
}

export function recordCacheAffinityObservation(input: {
  executionTargetId: number;
  endpointType: string;
  requestEndpointType?: string | null;
  contentAffinityKey: string;
  promptTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  promptTokensIncludeCache?: boolean | null;
  observedAtMs?: number;
}): void {
  const key = observationKey(input);
  if (!key) return;
  const promptTokens = Math.max(0, Math.trunc(Number(input.promptTokens) || 0));
  const cacheReadTokens = Math.max(0, Math.trunc(Number(input.cacheReadTokens) || 0));
  const cacheWriteTokens = Math.max(0, Math.trunc(Number(input.cacheWriteTokens) || 0));
  const totalInputTokens = input.promptTokensIncludeCache === false
    ? promptTokens + cacheReadTokens + cacheWriteTokens
    : Math.max(promptTokens, cacheReadTokens + cacheWriteTokens);
  if (totalInputTokens <= 0) return;

  const nowMs = Number.isFinite(input.observedAtMs) ? Number(input.observedAtMs) : Date.now();
  const previous = observations.get(key);
  const state = previous && nowMs - previous.updatedAtMs <= OBSERVATION_TTL_MS
    ? { ...previous }
    : {
        sampleCount: 0,
        hitCount: 0,
        hitCachedFractionTotal: 0,
        hitFractionSamples: 0,
        hitWriteFractionTotal: 0,
        missWriteFractionTotal: 0,
        missWriteFractionSamples: 0,
        updatedAtMs: nowMs,
      };

  if (state.sampleCount >= MAX_EFFECTIVE_SAMPLES) {
    state.sampleCount *= 0.75;
    state.hitCount *= 0.75;
    state.hitCachedFractionTotal *= 0.75;
    state.hitFractionSamples *= 0.75;
    state.hitWriteFractionTotal *= 0.75;
    state.missWriteFractionTotal *= 0.75;
    state.missWriteFractionSamples *= 0.75;
  }
  state.sampleCount += 1;
  if (cacheReadTokens > 0) {
    state.hitCount += 1;
    state.hitCachedFractionTotal += clamp(cacheReadTokens / totalInputTokens, 0, 1);
    state.hitWriteFractionTotal += clamp(cacheWriteTokens / totalInputTokens, 0, 1);
    state.hitFractionSamples += 1;
  } else {
    state.missWriteFractionTotal += clamp(cacheWriteTokens / totalInputTokens, 0, 1);
    state.missWriteFractionSamples += 1;
  }
  state.updatedAtMs = nowMs;

  observations.delete(key);
  observations.set(key, state);
  const requestEndpointType = String(input.requestEndpointType || '').trim().toLowerCase();
  if (requestEndpointType) {
    const requestKey = aliasKey({
      executionTargetId: input.executionTargetId,
      requestEndpointType,
      contentAffinityKey: input.contentAffinityKey,
    });
    if (requestKey && requestEndpointType !== String(input.endpointType).trim().toLowerCase()) {
      endpointAliases.delete(requestKey);
      endpointAliases.set(requestKey, { endpointType: String(input.endpointType).trim().toLowerCase(), updatedAtMs: nowMs });
    } else if (requestKey) {
      endpointAliases.delete(requestKey);
    }
  }
  evictExpiredAndOverflow(nowMs);
}

export function getCacheAffinityObservation(input: {
  executionTargetId: number;
  endpointType: string;
  contentAffinityKey: string;
  nowMs?: number;
}): CacheAffinityObservation | null {
  let key = observationKey(input);
  if (!key) return null;
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const requestKey = key;
  const alias = endpointAliases.get(requestKey);
  let state: CacheAffinityObservationState | undefined;
  if (alias && nowMs - alias.updatedAtMs <= OBSERVATION_TTL_MS) {
    const aliasedKey = observationKey({ ...input, endpointType: alias.endpointType });
    const aliasedState = aliasedKey ? observations.get(aliasedKey) : undefined;
    if (aliasedKey && aliasedState) {
      key = aliasedKey;
      state = aliasedState;
    } else {
      endpointAliases.delete(requestKey);
    }
  } else if (alias) {
    endpointAliases.delete(requestKey);
  }
  state ||= observations.get(requestKey);
  if (!key || !state) return null;
  if (nowMs - state.updatedAtMs > OBSERVATION_TTL_MS) {
    observations.delete(key);
    return null;
  }
  observations.delete(key);
  observations.set(key, state);
  return {
    sampleCount: Math.max(1, Math.round(state.sampleCount)),
    // One additional virtual miss keeps a single observed hit from becoming strict affinity.
    hitProbability: clamp(state.hitCount / (state.sampleCount + 1), 0, 1),
    cachedReadFraction: state.hitFractionSamples > 0
      ? clamp(state.hitCachedFractionTotal / state.hitFractionSamples, 0, 1)
      : 0,
    hitCacheWriteFraction: state.hitFractionSamples > 0
      ? clamp(state.hitWriteFractionTotal / state.hitFractionSamples, 0, 1)
      : 0,
    missCacheWriteFraction: state.missWriteFractionSamples > 0
      ? clamp(state.missWriteFractionTotal / state.missWriteFractionSamples, 0, 1)
      : 0,
  };
}

export function resetCacheAffinityObservationsForTest(): void {
  observations.clear();
  endpointAliases.clear();
}
