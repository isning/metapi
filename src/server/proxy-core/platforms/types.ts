import type { UpstreamCompatibilityPolicy } from '../../contracts/upstreamCompatibilityPolicy.js';

export type PlatformProfileId =
  | 'codex'
  | 'claude'
  | 'gemini-cli'
  | 'antigravity'
  | 'openai'
  | 'gemini'
  | 'anthropic';

export type PlatformAction =
  | 'generateContent'
  | 'streamGenerateContent'
  | 'countTokens';

export type PlatformRuntimeDescriptor = {
  executor: 'default' | 'codex' | 'gemini-cli' | 'antigravity' | 'claude';
  modelName?: string;
  stream?: boolean;
  oauthProjectId?: string | null;
  action?: PlatformAction;
};

export type PreparedPlatformRequest = {
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  runtime: PlatformRuntimeDescriptor;
};

export interface DownstreamRoutingPolicy {
  supportedModels: string[];
  allowedRouteIds: number[];
  siteWeightMultipliers: Record<number, number>;
  excludedSiteIds: number[];
  excludedCredentialRefs: any[];
  denyAllWhenEmpty?: boolean;
}

export interface RequestBuilderContext {
  channel?: {
    id: number;
    routeId: number | null;
    priority?: number | null;
    weight?: number | null;
  };
  account?: {
    id: number;
    siteId: number;
    username?: string | null;
    oauthProvider?: string | null;
    oauthProjectId?: string | null;
    extraConfig?: string | null;
  };
  site?: {
    id: number;
    name: string;
    url: string;
    platform: string;
    customHeaders?: string | null;
  };
  downstreamApiKey?: {
    id: number;
    name: string;
    key: string;
    tags?: string | null;
    supportedModels?: string | null;
  };
  downstreamPolicy?: DownstreamRoutingPolicy;
}

export type PreparePlatformRequestInput = {
  targetPath: string;
  modelName: string;
  stream: boolean;
  tokenValue: string;
  oauthProvider?: string;
  oauthProjectId?: string;
  sitePlatform: string;
  siteUrl?: string | null;
  openaiBody: Record<string, unknown>;
  downstreamFormat: string;
  claudeOriginalBody?: Record<string, unknown>;
  forceNormalizeClaudeBody?: boolean;
  responsesOriginalBody?: Record<string, unknown>;
  downstreamHeaders?: Record<string, unknown>;
  baseHeaders?: Record<string, string>;
  platformHeaders?: Record<string, string>;
  codexSessionCacheKey?: string | null;
  codexExplicitSessionId?: string | null;
  responsesWebsocketTransport?: boolean;
  action?: PlatformAction;
  
  // Injected entity context metadata
  context?: RequestBuilderContext;
};

export type PlatformProfile = {
  id: PlatformProfileId;
  defaultCompatibilityPolicy?: UpstreamCompatibilityPolicy;
  prepareRequest(input: PreparePlatformRequestInput): PreparedPlatformRequest;
  runSessionTask?<T>(
    context: {
      siteId: number;
      accountId: number;
      targetId: number;
      headers: Record<string, string>;
      codexSessionStoreKey?: string | null;
    },
    task: () => Promise<T>
  ): Promise<T>;
  createStreamReader?(upstreamReader: ReadableStreamDefaultReader<Uint8Array>): any;
  shouldTryOAuthRecovery?(options: {
    status: number;
    response: { headers: { get(name: string): string | null } };
    rawErrText: string;
  }): boolean;
};
