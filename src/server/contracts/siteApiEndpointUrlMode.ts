export const SITE_API_ENDPOINT_BASE_PATH_MODES = [
  'protocol_default',
  'complete_api_prefix',
] as const;

export type SiteApiEndpointBasePathMode = typeof SITE_API_ENDPOINT_BASE_PATH_MODES[number];

export const DEFAULT_SITE_API_ENDPOINT_BASE_PATH_MODE: SiteApiEndpointBasePathMode = 'protocol_default';

export function normalizeSiteApiEndpointBasePathMode(
  value: unknown,
): SiteApiEndpointBasePathMode | null {
  return SITE_API_ENDPOINT_BASE_PATH_MODES.includes(value as SiteApiEndpointBasePathMode)
    ? value as SiteApiEndpointBasePathMode
    : null;
}
