export type DownstreamAccountTokenCredentialRef = {
  kind: 'account_token';
  siteId: number;
  accountId: number;
  tokenId: number;
};

export type DownstreamDefaultApiKeyCredentialRef = {
  kind: 'default_api_key';
  siteId: number;
  accountId: number;
};

export type DownstreamExcludedCredentialRef =
  | DownstreamAccountTokenCredentialRef
  | DownstreamDefaultApiKeyCredentialRef;

export interface DownstreamProtocolAdapterPassthroughHeadersConfig {
  /** Explicitly allow these downstream headers (merged with default allowed sets) */
  allowlist?: string[];
  /** Block these headers from passing through (merged with default blocked sets) */
  blocklist?: string[];
  /** Additionally forward all headers starting with these prefixes */
  forwardAllMatchedPrefixes?: string[];
}

export interface DownstreamProtocolAdapterConfig {
  /** Base passthrough headers configuration (available to all protocol adapters) */
  passthroughHeaders?: DownstreamProtocolAdapterPassthroughHeadersConfig;
  /** Open-ended dictionary permitting any protocol-adapter-specific schemas */
  [customSetting: string]: any;
}

export interface DownstreamRoutingPolicy {
  supportedModels: string[];
  allowedRouteIds: number[];
  siteWeightMultipliers: Record<number, number>;
  excludedSiteIds: number[];
  excludedCredentialRefs: DownstreamExcludedCredentialRef[];
  denyAllWhenEmpty?: boolean;
  protocolAdapterConfigs?: Record<string, DownstreamProtocolAdapterConfig>;
}

export const EMPTY_DOWNSTREAM_ROUTING_POLICY: DownstreamRoutingPolicy = {
  supportedModels: [],
  allowedRouteIds: [],
  siteWeightMultipliers: {},
  excludedSiteIds: [],
  excludedCredentialRefs: [],
};
