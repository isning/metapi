import { normalizePlatformAlias } from '../../shared/platformIdentity.js';
import { resolvePlatformUserId, resolveProxyUrlFromExtraConfig } from './accountExtraConfig.js';
import { refreshAccountSessionFromAutoRelogin } from './accountAutoReloginService.js';
import { getAdapter } from './platforms/index.js';
import type {
  UpstreamPricingCatalog,
  UpstreamPricingCredential,
} from './upstreamPricingCatalog.js';
import { buildTransientPlatformCredentialContext, serializeOpaqueExtraConfig } from './adapterCredentialContextService.js';

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
    credentialKind?: string | null;
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
  const accountCredentialKind = input.account.credentialKind === 'session_cookie'
    ? 'session_cookie'
    : 'access_token';
  push(normalizeToken(input.account.credential), accountCredentialKind);
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
  const fetchCatalog = async (
    credential: UpstreamPricingCredential,
    accountCredentialKind = credential.tokenKind === 'session_cookie' ? 'session_cookie' : 'access_token',
  ) => {
    const credentialOptions = adapter.credentialCapabilities?.sessionCredentialOptions;
    if (
      credential.tokenKind === 'session_cookie'
      && !credentialOptions?.some((option) => option.kind === 'session_cookie')
    ) {
      throw new Error('adapter does not support session_cookie pricing credentials');
    }
    const accountCredential = credential.tokenKind === 'access_token' || credential.tokenKind === 'session_cookie'
      ? (credential.token || '')
      : '';
    const modelToken = credential.tokenKind === 'api_token' || credential.tokenKind === 'site_api_key'
      ? credential.token
      : null;
    const operation = () => adapter.getPricingCatalog!(buildTransientPlatformCredentialContext({
      endpoint: { baseUrl },
      accountId: input.account.id,
      siteId: input.site.id,
      username: input.account.username,
      mode: modelToken ? 'apikey' : 'session',
      credential: accountCredential,
      credentialKind: credential.tokenKind === 'access_token' || credential.tokenKind === 'session_cookie'
        ? accountCredentialKind
        : credential.tokenKind,
      accountExtraConfig: serializeOpaqueExtraConfig(input.account.extraConfig),
      token: modelToken,
    }));
    return adapter.runWithProxyOverride(accountProxyUrl, operation);
  };
  for (const credential of buildCredentialCandidates(input)) {
    try {
      const catalog = await fetchCatalog(credential);
      if (catalog && catalog.models.size > 0) {
        return {
          catalog,
          credentialKind: credential.tokenKind === 'access_token' || credential.tokenKind === 'session_cookie'
            ? (input.account.credentialKind === 'session_cookie' ? 'session_cookie' : 'access_token')
            : credential.tokenKind,
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
  const refreshedSession = await refreshAccountSessionFromAutoRelogin(
    input.account,
    input.site,
  );
  if (refreshedSession && refreshedSession.credential !== normalizeToken(input.account.credential)) {
    try {
      const credential: UpstreamPricingCredential = {
        token: refreshedSession.credential,
        tokenKind: 'access_token',
        platformUserId: resolvePlatformUserId(input.account.extraConfig, input.account.username),
      };
      const catalog = await fetchCatalog(credential, refreshedSession.credentialKind);
      if (catalog && catalog.models.size > 0) {
        return {
          catalog,
          credentialKind: refreshedSession.credentialKind,
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
