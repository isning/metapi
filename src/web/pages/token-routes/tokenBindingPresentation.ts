import { tr } from '../../i18n.js';
export type TokenBindingOption = {
  id: number;
  name: string;
  isDefault: boolean;
  sourceModel?: string;
};

export type TokenBindingPresentation = {
  isFollowingAccountDefault: boolean;
  bindingModeLabel: string;
  badgeTone: 'info' | 'warning';
  effectiveTokenName: string;
  helperText: string;
  followOptionLabel: string;
  followOptionDescription: string;
};

type TokenBindingConnectionMode = 'session' | 'apikey' | 'oauth';

type TokenBindingContext = {
  connectionMode?: TokenBindingConnectionMode;
  accountName?: string | null;
};

function parseExtraConfigHints(extraConfig?: string | null): {
  credentialMode: Extract<TokenBindingConnectionMode, 'session' | 'apikey'> | null;
  hasOauthProvider: boolean;
} {
  if (typeof extraConfig !== 'string' || !extraConfig.trim()) {
    return {
      credentialMode: null,
      hasOauthProvider: false,
    };
  }
  try {
    const parsed = JSON.parse(extraConfig) as {
      credentialMode?: unknown;
      oauth?: { provider?: unknown } | null;
    };
    const raw = String(parsed?.credentialMode || '').trim().toLowerCase();
    return {
      credentialMode: raw === 'session' || raw === 'apikey' ? raw : null,
      hasOauthProvider: typeof parsed?.oauth?.provider === 'string' && parsed.oauth.provider.trim().length > 0,
    };
  } catch {}
  return {
    credentialMode: null,
    hasOauthProvider: false,
  };
}

function buildDirectBindingPresentation(
  connectionMode: Extract<TokenBindingConnectionMode, 'apikey' | 'oauth'>,
  accountName: string,
): TokenBindingPresentation {
  if (connectionMode === 'oauth') {
    return {
      isFollowingAccountDefault: false,
      bindingModeLabel: tr('pages.tokenRoutes.tokenBindingPresentation.oauth'),
      badgeTone: 'warning',
      effectiveTokenName: accountName,
      helperText: tr('pages.tokenRoutes.tokenBindingPresentation.oauthDirectHelper').replace('{account}', accountName),
      followOptionLabel: tr('pages.tokenRoutes.tokenBindingPresentation.fixedOauthLabel').replace('{account}', accountName),
      followOptionDescription: tr('pages.tokenRoutes.tokenBindingPresentation.oauthDirectDescription').replace('{account}', accountName),
    };
  }

  return {
    isFollowingAccountDefault: false,
    bindingModeLabel: tr('pages.tokenRoutes.tokenBindingPresentation.apitoken'),
    badgeTone: 'warning',
    effectiveTokenName: accountName,
    helperText: tr('pages.tokenRoutes.tokenBindingPresentation.apiKeyDirectHelper').replace('{account}', accountName),
    followOptionLabel: tr('pages.tokenRoutes.tokenBindingPresentation.fixedApiKeyLabel').replace('{account}', accountName),
    followOptionDescription: tr('pages.tokenRoutes.tokenBindingPresentation.apiKeyDirectDescription').replace('{account}', accountName),
  };
}

export function resolveTokenBindingConnectionMode(account?: {
  accessToken?: string | null;
  extraConfig?: string | null;
  credentialMode?: string | null;
} | null): TokenBindingConnectionMode {
  const parsedHints = parseExtraConfigHints(account?.extraConfig);
  if (parsedHints.hasOauthProvider) return 'oauth';

  const rawMode = String(account?.credentialMode || '').trim().toLowerCase();
  if (rawMode === 'session') return 'session';
  if (rawMode === 'apikey') return 'apikey';

  if (parsedHints.credentialMode) return parsedHints.credentialMode;

  return typeof account?.accessToken === 'string' && account.accessToken.trim()
    ? 'session'
    : 'apikey';
}

export function getDefaultTokenOption(options: TokenBindingOption[]): TokenBindingOption | null {
  return options.find((option) => option.isDefault) || null;
}

export function describeTokenBinding(
  options: TokenBindingOption[],
  activeTokenId: number,
  fallbackTokenName?: string | null,
  context: TokenBindingContext = {},
): TokenBindingPresentation {
  const defaultToken = getDefaultTokenOption(options);
  const selectedToken = activeTokenId
    ? options.find((option) => option.id === activeTokenId) || null
    : null;
  const connectionMode = context.connectionMode || 'session';
  const accountName = String(context.accountName || '').trim() || tr('pages.oAuthManagement.currentConnection');

  if (!activeTokenId) {
    if (connectionMode === 'apikey' || connectionMode === 'oauth') {
      return buildDirectBindingPresentation(connectionMode, accountName);
    }

    const effectiveTokenName = defaultToken?.name || fallbackTokenName || tr('pages.tokenRoutes.tokenBindingPresentation.notSetdefaultToken');
    return {
      isFollowingAccountDefault: true,
      bindingModeLabel: tr('pages.tokenRoutes.addChannelModal.accountsdefault'),
      badgeTone: 'info',
      effectiveTokenName,
      helperText: defaultToken
        ? tr('pages.tokenRoutes.tokenBindingPresentation.followDefaultHelper').replace('{token}', defaultToken.name)
        : tr('pages.tokenRoutes.tokenBindingPresentation.accountsdefaultAccountsDefaultToken'),
      followOptionLabel: tr('pages.tokenRoutes.addChannelModal.accountsdefault'),
      followOptionDescription: defaultToken
        ? tr('pages.tokenRoutes.tokenBindingPresentation.followDefaultDescription').replace('{token}', defaultToken.name)
        : tr('pages.tokenRoutes.tokenBindingPresentation.accountsdefaultAutomatic'),
    };
  }

  const effectiveTokenName = selectedToken?.name || fallbackTokenName || `token-${activeTokenId}`;
  return {
    isFollowingAccountDefault: false,
    bindingModeLabel: tr('pages.tokenRoutes.tokenBindingPresentation.token'),
    badgeTone: 'warning',
    effectiveTokenName,
    helperText: selectedToken?.isDefault
      ? tr('pages.tokenRoutes.tokenBindingPresentation.fixedDefaultHelper').replace('{token}', effectiveTokenName)
      : tr('pages.tokenRoutes.tokenBindingPresentation.fixedTokenHelper').replace('{token}', effectiveTokenName),
    followOptionLabel: connectionMode === 'oauth'
      ? tr('pages.tokenRoutes.tokenBindingPresentation.oauth')
      : (connectionMode === 'apikey' ? tr('pages.tokenRoutes.tokenBindingPresentation.apiSettings') : tr('pages.tokenRoutes.addChannelModal.accountsdefault')),
    followOptionDescription: connectionMode === 'oauth'
      ? tr('pages.tokenRoutes.tokenBindingPresentation.oauthDirectDescription').replace('{account}', accountName)
      : (connectionMode === 'apikey'
          ? tr('pages.tokenRoutes.tokenBindingPresentation.apiKeyDirectDescription').replace('{account}', accountName)
          : (defaultToken
              ? tr('pages.tokenRoutes.tokenBindingPresentation.followDefaultDescription').replace('{token}', defaultToken.name)
              : tr('pages.tokenRoutes.tokenBindingPresentation.accountsdefaultAutomatic'))),
  };
}

export function buildFixedTokenOptionLabel(
  token: TokenBindingOption,
  options: {
    includeDefaultTag?: boolean;
    includeSourceModel?: boolean;
  } = {},
): string {
  let label = tr('pages.tokenRoutes.tokenBindingPresentation.fixedTokenLabel').replace('{token}', token.name);
  if (options.includeDefaultTag && token.isDefault) {
    label += tr('pages.tokenRoutes.tokenBindingPresentation.accountsdefault');
  }
  if (options.includeSourceModel && token.sourceModel) {
    label += ` [${token.sourceModel}]`;
  }
  return label;
}

export function buildFixedTokenOptionDescription(token: TokenBindingOption): string {
  return token.isDefault
    ? tr('pages.tokenRoutes.tokenBindingPresentation.itemstokenAccountsdefaultAutomatic')
    : tr('pages.tokenRoutes.tokenBindingPresentation.itemstokenAccountsdefault');
}
