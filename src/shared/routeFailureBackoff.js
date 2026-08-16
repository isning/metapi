function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export const DEFAULT_ROUTE_FAILURE_BACKOFF_POLICY = Object.freeze({
  failureThreshold: 3,
  levelsSec: Object.freeze([0, 600, 3600, 86400]),
  maxSec: 86400,
});

export function normalizeRouteFailureBackoffPolicy(input) {
  const raw = isRecord(input) ? input : {};
  const threshold = Number(raw.failureThreshold);
  const maxSec = Number(raw.maxSec);
  const levels = Array.isArray(raw.levelsSec) ? raw.levelsSec.map(Number) : [];
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > 100) return null;
  if (!Number.isFinite(maxSec) || maxSec <= 0 || maxSec > 30 * 24 * 60 * 60) return null;
  if (levels.length === 0 || levels.length > 32) return null;
  const normalizedLevels = levels.map((value) => Math.trunc(value));
  if (normalizedLevels.some((value) => !Number.isFinite(value) || value < 0 || value > maxSec)) return null;
  for (let index = 1; index < normalizedLevels.length; index += 1) {
    if (normalizedLevels[index] < normalizedLevels[index - 1]) return null;
  }
  return { failureThreshold: threshold, levelsSec: normalizedLevels, maxSec: Math.trunc(maxSec) };
}

export function normalizeRouteFailureBackoffOverride(input) {
  const raw = isRecord(input) ? input : {};
  if (raw.mode === 'disabled') return { mode: 'disabled' };
  if (raw.mode !== 'custom') return null;
  const policy = normalizeRouteFailureBackoffPolicy(raw.policy);
  return policy ? { mode: 'custom', policy } : null;
}
