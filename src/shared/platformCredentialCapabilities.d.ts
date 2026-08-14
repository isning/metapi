export type InteractiveCredentialMode = 'session' | 'apikey';

export type PlatformCredentialCapabilities = {
  session: boolean;
  apiKey: boolean;
  sessionCredentialKind: 'access_token' | 'session_cookie' | 'session_cookie_or_api_token' | 'either';
};

export function getPlatformCredentialCapabilities(
  platform: string | null | undefined,
): PlatformCredentialCapabilities;

export function supportsInteractiveCredentialMode(
  platform: string | null | undefined,
  mode: InteractiveCredentialMode,
): boolean;
