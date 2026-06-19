import type { DownstreamRoutingPolicy } from '../../services/downstreamPolicyTypes.js';
import type { RouteGraphPostBuildFilters } from '../../services/routeGraphRuntimeService.js';
import type { ResolvedUpstreamCompatibilityPolicy } from '../../contracts/upstreamCompatibilityPolicy.js';
import type { UpstreamEndpoint } from '../orchestration/upstreamRequest.js';

export interface HeaderPassthroughRule {
  allowlist?: Set<string>;
  blocklist?: Set<string>;
  transform?: (key: string, value: string) => { key: string; value: string } | null;
}

export interface ParsedDownstreamRequest {
  modelName: string;
  stream: boolean;
  standardBody: Record<string, unknown>;
  originalBody?: Record<string, unknown>;
  extraContext?: Record<string, any>;
}

export interface TransformRequestContext {
  downstreamPath: string;
  rawUrl: string;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

export interface TransformedDownstreamRequest {
  requestedModel: string;
  isStream: boolean;
  openaiBody: Record<string, unknown>;
  responsesOriginalBody?: Record<string, unknown>;
  claudeOriginalBody?: Record<string, unknown>;
  endpointCandidates?: UpstreamEndpoint[];
  requestCapabilities?: {
    hasNonImageFileInput?: boolean;
    conversationFileSummary?: {
      hasImage: boolean;
      hasAudio: boolean;
      hasDocument: boolean;
      hasRemoteDocumentUrl: boolean;
    };
    wantsNativeResponsesReasoning?: boolean;
    wantsContinuationAwareResponses?: boolean;
    requiresNativeResponsesFileUrl?: boolean;
  };
  requestKind?: string;
  disableCrossProtocolFallback?: boolean;
  extraContext?: Record<string, unknown>;
}

export interface BuildUpstreamRequestInput {
  endpoint: UpstreamEndpoint;
  modelName: string;
  requestedModel: string;
  isStream: boolean;
  tokenValue: string;
  oauth?: {
    provider?: string;
    projectId?: string;
    planType?: string | null;
  } | null;
  site: {
    id: number;
    url: string;
    platform: string;
  };
  account: {
    id: number;
    extraConfig?: string | null;
  };
  downstreamHeaders: Record<string, unknown>;
  passthroughHeaders: Record<string, string>;
  platformHeaders: Record<string, string>;
  transformed: TransformedDownstreamRequest;
  routeGraphFilters?: RouteGraphPostBuildFilters | null;
  compatibilityPolicy?: ResolvedUpstreamCompatibilityPolicy;
}

export interface BuiltUpstreamRequest {
  endpoint: UpstreamEndpoint;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  runtime?: {
    executor: 'default' | 'codex' | 'gemini-cli' | 'antigravity' | 'claude';
    modelName?: string;
    stream?: boolean;
    oauthProjectId?: string | null;
    action?: 'generateContent' | 'streamGenerateContent' | 'countTokens';
  };
}

export interface PassthroughHeadersConfig {
  allowlist?: string[];
  blocklist?: string[];
  forwardAllMatchedPrefixes?: string[];
}

export interface BodyConstraintsConfig {
  maxTokensLimit?: number;
  clampMaxTokens?: boolean;
  temperatureOverride?: number;
}

export interface DownstreamProtocolAdapter {
  format: string;
  routes: string[];
  modelListRoutes?: string[];
  modelListModelProbes?: string[];
  headerRule: HeaderPassthroughRule;
  parseRequest(
    body: unknown,
    headers?: Record<string, unknown>,
    config?: PassthroughHeadersConfig,
  ): ParsedDownstreamRequest;
  extractPassthroughHeaders(
    headers?: Record<string, unknown>,
    config?: PassthroughHeadersConfig,
  ): Record<string, string>;
  validateRequest?(
    body: any,
    headers?: any,
    downstreamPath?: any,
    constraints?: BodyConstraintsConfig,
  ): any;
  transformRequest?(
    body: any,
    headers?: any,
    context?: TransformRequestContext,
    constraints?: BodyConstraintsConfig,
  ): { value?: TransformedDownstreamRequest; error?: { statusCode: number; payload: unknown } };
  buildUpstreamRequest?(input: BuildUpstreamRequestInput): BuiltUpstreamRequest;
  buildModelListRequest?(input: {
    siteUrl: string;
    tokenValue: string;
    params?: Record<string, unknown>;
  }): { url: string; path: string };
  getStaticModelList?(input: {
    sitePlatform: string;
  }): Array<{ name: string; displayName: string }> | null;
  shouldUseLocalModelList?(input: {
    sitePlatform: string;
  }): boolean;
  formatModelList?(models: Array<{ name: string; displayName: string }>): unknown;
  createStreamSession?(options: any): any;
  transformResponse?(options: any): any;
  validateResponse?(options: {
    rawText: string;
    upstreamBody: any;
    status: number;
  }): { ok: boolean; reason?: string } | null;
  selectChannel?(options: {
    requestedModel: string;
    policy: any;
    excludeChannelIds: number[];
    forcedChannelId: number | null;
  }): Promise<any>;
}
