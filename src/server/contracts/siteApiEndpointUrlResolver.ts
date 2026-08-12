import type { SiteApiEndpointBasePathMode } from './siteApiEndpointUrlMode.js';

export type SiteApiEndpointUrlContext = {
  baseUrl: string;
  basePathMode?: SiteApiEndpointBasePathMode | null;
};

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function stripVersionPrefix(
  basePath: string,
  requestPath: string,
  basePathMode?: SiteApiEndpointBasePathMode | null,
): string {
  const path = normalizePath(requestPath);
  if (basePathMode === 'complete_api_prefix') {
    return path.replace(/^\/v\d+(?:\.\d+)?(?:beta)?(?=\/|$)/i, '') || '/';
  }

  const baseVersion = basePath.match(/\/(v\d+(?:\.\d+)?(?:beta)?)$/i)?.[1];
  if (!baseVersion) return path;
  const pathVersion = path.match(/^\/(v\d+(?:\.\d+)?(?:beta)?)(?:\/|$)/i)?.[1];
  if (pathVersion && pathVersion.toLowerCase() === baseVersion.toLowerCase()) {
    return path.slice(pathVersion.length + 1) || '/';
  }
  if (path === '/v1') return '/';
  if (path.startsWith('/v1/')) return path.slice('/v1'.length) || '/';
  return path;
}

function joinPath(basePath: string, requestPath: string): string {
  const base = basePath.replace(/\/+$/, '');
  const path = normalizePath(requestPath);
  if (!base || base === '/') return path || '/';
  if (!path || path === '/') return base;
  return `${base}${path}`;
}

function formatOrigin(url: URL): string {
  const username = url.username ? encodeURIComponent(url.username) : '';
  const password = url.password ? encodeURIComponent(url.password) : '';
  const auth = username ? `${username}${password ? `:${password}` : ''}@` : '';
  return `${url.protocol}//${auth}${url.host}`;
}

export function resolveSiteApiEndpointRequestUrl(
  endpoint: SiteApiEndpointUrlContext,
  requestPath: string,
): string {
  const baseRaw = String(endpoint.baseUrl || '').trim();
  const path = normalizePath(String(requestPath || '').trim());
  const fallbackBase = baseRaw.replace(/\/+$/, '');
  if (!fallbackBase) return path || '/';
  if (!path || path === '/') return fallbackBase;

  try {
    const parsed = new URL(baseRaw);
    const basePath = parsed.pathname.replace(/\/+$/, '');
    const resolvedPath = stripVersionPrefix(basePath, path, endpoint.basePathMode);
    return `${formatOrigin(parsed)}${joinPath(basePath, resolvedPath)}${parsed.search}${parsed.hash}`;
  } catch {
    const basePath = fallbackBase.replace(/^https?:\/\/[^/]+/i, '');
    return `${fallbackBase}${stripVersionPrefix(basePath, path, endpoint.basePathMode)}`;
  }
}

export function resolveOpenAiModelsUrl(endpoint: SiteApiEndpointUrlContext): string {
  return resolveSiteApiEndpointRequestUrl(endpoint, '/v1/models');
}

export function resolveGeminiNativeModelsUrl(
  endpoint: SiteApiEndpointUrlContext,
  apiToken: string,
): string {
  const baseUrl = String(endpoint.baseUrl || '').trim().replace(/\/+$/, '');
  const versionedBase = endpoint.basePathMode === 'complete_api_prefix'
    ? baseUrl
    : /\/v\d+(?:beta)?(?:\/|$)/i.test(baseUrl)
      ? baseUrl
      : `${baseUrl}/v1beta`;
  const modelsUrl = /\/models$/i.test(versionedBase)
    ? versionedBase
    : `${versionedBase}/models`;
  const separator = modelsUrl.includes('?') ? '&' : '?';
  return `${modelsUrl}${separator}key=${encodeURIComponent(apiToken)}`;
}
