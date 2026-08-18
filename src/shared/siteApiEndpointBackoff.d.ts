export const SITE_API_ENDPOINT_BACKOFF_FAILURE_CLASSES: readonly [
  'transport',
  'gateway',
  'rate_limit',
  'upstream_server',
];

export type SiteApiEndpointBackoffFailureClass = typeof SITE_API_ENDPOINT_BACKOFF_FAILURE_CLASSES[number];
export type SiteApiEndpointBackoffPolicy = {
  cooldownSec: number;
  cooldownOn: SiteApiEndpointBackoffFailureClass[];
};
export type SiteApiEndpointBackoffOverride =
  | { mode: 'custom'; policy: SiteApiEndpointBackoffPolicy }
  | { mode: 'disabled' };

export const DEFAULT_SITE_API_ENDPOINT_BACKOFF_POLICY: SiteApiEndpointBackoffPolicy;
export function normalizeSiteApiEndpointBackoffPolicy(value: unknown): SiteApiEndpointBackoffPolicy | null;
export function normalizeSiteApiEndpointBackoffOverride(value: unknown): SiteApiEndpointBackoffOverride | null;
export function resolveSiteApiEndpointBackoffPolicy(
  override: SiteApiEndpointBackoffOverride | null | undefined,
  fallback?: SiteApiEndpointBackoffPolicy,
): SiteApiEndpointBackoffPolicy | null;
