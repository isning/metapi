const API_KEY_ONLY_PLATFORMS = new Set([
  'openai',
  'claude',
  'gemini',
  'gemini-cli',
  'cliproxyapi',
]);

const DEFAULT_CAPABILITIES = {
  session: true,
  apiKey: true,
  sessionCredentialKind: 'either',
};

const API_KEY_ONLY_CAPABILITIES = {
  session: false,
  apiKey: true,
  sessionCredentialKind: 'either',
};

const SESSION_CREDENTIAL_KINDS = {
  'new-api': 'session_cookie_or_api_token',
  anyrouter: 'session_cookie_or_api_token',
  sub2api: 'access_token',
};

export function getPlatformCredentialCapabilities(platform) {
  const normalized = String(platform || '').trim().toLowerCase();
  if (API_KEY_ONLY_PLATFORMS.has(normalized)) return API_KEY_ONLY_CAPABILITIES;
  return {
    ...DEFAULT_CAPABILITIES,
    sessionCredentialKind: SESSION_CREDENTIAL_KINDS[normalized] || DEFAULT_CAPABILITIES.sessionCredentialKind,
  };
}

export function supportsInteractiveCredentialMode(platform, mode) {
  const capabilities = getPlatformCredentialCapabilities(platform);
  return mode === 'session' ? capabilities.session : capabilities.apiKey;
}
