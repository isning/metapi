export const defaultE2eAdminToken = 'test-admin-token';
export const defaultE2ePreflightTimeoutMs = 5_000;

export type E2EPreflightEnv = Pick<NodeJS.ProcessEnv, 'E2E_BASE_URL' | 'E2E_AUTH_TOKEN'>;

function resolveBaseUrlPath(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = defaultE2ePreflightTimeoutMs,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`E2E_BASE_URL preflight failed for ${url}: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function responseSnippet(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
}

export async function preflightExternalBaseUrl(
  env: E2EPreflightEnv,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const baseUrl = env.E2E_BASE_URL?.trim();
  if (!baseUrl) return;

  try {
    new URL(baseUrl);
  } catch {
    throw new Error(`Invalid E2E_BASE_URL: ${baseUrl}`);
  }

  const assetUrl = resolveBaseUrlPath(baseUrl, '/logo.png');
  const authInfoUrl = resolveBaseUrlPath(baseUrl, '/api/settings/auth/info');
  const assetResponse = await fetchWithTimeout(assetUrl, {}, options.timeoutMs);
  if (!assetResponse.ok) {
    throw new Error([
      `E2E_BASE_URL does not look like a built Metapi app: ${baseUrl}`,
      `Expected ${assetUrl} to return 2xx, got ${assetResponse.status}.`,
      await responseSnippet(assetResponse),
    ].join('\n'));
  }

  const authResponse = await fetchWithTimeout(authInfoUrl, {
    headers: { Authorization: `Bearer ${env.E2E_AUTH_TOKEN || defaultE2eAdminToken}` },
  }, options.timeoutMs);
  if (!authResponse.ok) {
    throw new Error([
      `E2E_BASE_URL is not ready for authenticated Metapi E2E tests: ${baseUrl}`,
      `Expected ${authInfoUrl} to return 2xx with E2E_AUTH_TOKEN, got ${authResponse.status}.`,
      await responseSnippet(authResponse),
    ].join('\n'));
  }
}
