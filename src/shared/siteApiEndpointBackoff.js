export const SITE_API_ENDPOINT_BACKOFF_FAILURE_CLASSES = [
  'transport',
  'gateway',
  'rate_limit',
  'upstream_server',
];

export const DEFAULT_SITE_API_ENDPOINT_BACKOFF_POLICY = {
  cooldownSec: 5 * 60,
  cooldownOn: ['transport', 'gateway'],
};

function isFailureClass(value) {
  return typeof value === 'string' && SITE_API_ENDPOINT_BACKOFF_FAILURE_CLASSES.includes(value);
}

export function normalizeSiteApiEndpointBackoffPolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const cooldownSec = Number(value.cooldownSec);
  if (!Number.isInteger(cooldownSec) || cooldownSec < 1 || cooldownSec > 24 * 60 * 60) return null;
  if (!Array.isArray(value.cooldownOn)) return null;
  const cooldownOn = [...new Set(value.cooldownOn.filter(isFailureClass))];
  if (cooldownOn.length !== value.cooldownOn.length) return null;
  return { cooldownSec, cooldownOn };
}

export function normalizeSiteApiEndpointBackoffOverride(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.mode === 'disabled' && Object.keys(value).length === 1) return { mode: 'disabled' };
  if (value.mode !== 'custom' || Object.keys(value).length !== 2) return null;
  const policy = normalizeSiteApiEndpointBackoffPolicy(value.policy);
  return policy ? { mode: 'custom', policy } : null;
}

export function resolveSiteApiEndpointBackoffPolicy(override, fallback = DEFAULT_SITE_API_ENDPOINT_BACKOFF_POLICY) {
  if (override?.mode === 'disabled') return null;
  return override?.mode === 'custom' ? override.policy : fallback;
}
