import { normalizePlatformAlias } from '../../shared/platformIdentity.js';
import { resolvePlatformUserId, resolveProxyUrlFromExtraConfig } from './accountExtraConfig.js';
import { refreshAccountSessionFromAutoRelogin } from './accountAutoReloginService.js';
import { getAdapter } from './platforms/index.js';
import type {
  UpstreamPricingCatalog,
  UpstreamPricingCredential,
} from './upstreamPricingCatalog.js';

export type UpstreamPricingCatalogRequest = {
  site: {
    id: number;
    url: string;
    platform: string;
    apiKey?: string | null;
  };
  account: {
    id: number;
    username?: string | null;
    credential?: string | null;
    extraConfig?: string | Record<string, unknown> | null;
  };
  upstreamCredential?: UpstreamPricingCredential | null;
};

export type UpstreamPricingCatalogFetchResult = {
  catalog: UpstreamPricingCatalog;
  credentialKind: UpstreamPricingCredential['tokenKind'];
  platformUserId?: number;
};

type PricingCatalogCredentialFailure = {
  credentialKind: UpstreamPricingCredential['tokenKind'];
  message: string;
};

function normalizeUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function normalizeToken(value: unknown): string | null {
  const token = typeof value === 'string' ? value.trim() : '';
  return token ? token : null;
}

function buildCredentialCandidates(input: UpstreamPricingCatalogRequest): UpstreamPricingCredential[] {
  const platformUserId = resolvePlatformUserId(input.account.extraConfig, input.account.username);
  const candidates: UpstreamPricingCredential[] = [];
  const seen = new Set<string>();
  const push = (token: string | null, tokenKind: UpstreamPricingCredential['tokenKind']) => {
    if (!token && tokenKind !== 'public') return;
    const key = `${tokenKind}:${token || ''}:${platformUserId || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      token,
      tokenKind,
      platformUserId,
    });
  };

  if (input.upstreamCredential) {
    push(
      normalizeToken(input.upstreamCredential.token),
      input.upstreamCredential.tokenKind,
    );
  }
  push(normalizeToken(input.account.credential), 'access_token');
  push(normalizeToken(input.site.apiKey), 'site_api_key');
  push(null, 'public');
  return candidates;
}

export async function fetchUpstreamPricingCatalog(
  input: UpstreamPricingCatalogRequest,
): Promise<UpstreamPricingCatalog | null> {
  const result = await fetchUpstreamPricingCatalogWithMetadata(input);
  return result?.catalog ?? null;
}

export async function fetchUpstreamPricingCatalogWithMetadata(
  input: UpstreamPricingCatalogRequest,
): Promise<UpstreamPricingCatalogFetchResult | null> {
  const adapter = getAdapter(normalizePlatformAlias(input.site.platform));
  if (!adapter?.getPricingCatalog) return null;

  const baseUrl = normalizeUrl(input.site.url);
  const failures: PricingCatalogCredentialFailure[] = [];
  const accountProxyUrl = resolveProxyUrlFromExtraConfig(input.account.extraConfig);
  const fetchCatalog = async (credential: UpstreamPricingCredential) => {
    const operation = () => adapter.getPricingCatalog!(baseUrl, credential);
    return adapter.runWithProxyOverride(accountProxyUrl, operation);
  };
  for (const credential of buildCredentialCandidates(input)) {
    try {
      const catalog = await fetchCatalog(credential);
      if (catalog && catalog.models.size > 0) {
        return {
          catalog,
          credentialKind: credential.tokenKind,
          platformUserId: credential.platformUserId,
        };
      }
    } catch (error) {
      failures.push({
        credentialKind: credential.tokenKind,
        message: error instanceof Error ? error.message : String(error || 'unknown error'),
      });
    }
  }

  // Password-backed accounts retain an encrypted recovery credential. Retry once
  // only after all persisted credentials and public pricing have been exhausted.
  const refreshedAccessToken = await refreshAccountSessionFromAutoRelogin(
    input.account,
    input.site,
  );
  if (refreshedAccessToken && refreshedAccessToken !== normalizeToken(input.account.credential)) {
    try {
      const credential: UpstreamPricingCredential = {
        token: refreshedAccessToken,
        tokenKind: 'access_token',
        platformUserId: resolvePlatformUserId(input.account.extraConfig, input.account.username),
      };
      const catalog = await fetchCatalog(credential);
      if (catalog && catalog.models.size > 0) {
        return {
          catalog,
          credentialKind: credential.tokenKind,
          platformUserId: credential.platformUserId,
        };
      }
    } catch (error) {
      failures.push({
        credentialKind: 'access_token',
        message: `auto relogin: ${error instanceof Error ? error.message : String(error || 'unknown error')}`,
      });
    }
  }

  if (failures.length > 0) {
    throw new Error(`Provider pricing catalog fetch failed: ${failures
      .map((failure) => `${failure.credentialKind}: ${failure.message}`)
      .join('; ')}`);
  }
  return null;
}
