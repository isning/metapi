import type { CSSProperties } from 'react';
import { getBrand, normalizeBrandIconKey, type BrandInfo } from '../../components/BrandIcon.js';
import type { RouteDecisionCandidate, RouteMode } from '../../../shared/tokenRouteContract.js';
import type { RouteRow, RouteEndpointTarget, TargetDecisionState, RouteSummaryRow } from './types.js';
import type { RouteGraphBackendSpec, RouteGraphMatchSpec } from '../../../shared/routeGraph.js';
import {
  isExactTokenRouteModelPattern,
  isTokenRouteRegexPattern,
  matchesTokenRouteModelPattern,
  parseTokenRouteRegexPattern,
} from '../../../shared/tokenRoutePatterns.js';

import { tr } from '../../i18n.js';
export const AUTO_ROUTE_DECISION_LIMIT = 80;
export const ROUTE_RENDER_CHUNK = 40;
export const ROUTE_BRAND_ICON_PREFIX = 'brand:';
export const ROUTE_ICON_NONE_VALUE = '__route_icon_none__';

export const ENDPOINT_TYPE_ICON_MODEL_MAP: Record<string, string> = {
  openai: 'chatgpt',
  gemini: 'gemini',
  anthropic: 'claude',
  anthroic: 'claude',
  claude: 'claude',
};

export const PLATFORM_ENDPOINT_FALLBACK_MAP: Record<string, string[]> = {
  openai: ['openai'],
  'new-api': ['openai'],
  'one-api': ['openai'],
  'one-hub': ['openai'],
  'done-hub': ['openai'],
  sub2api: ['openai'],
  veloera: ['openai'],
  cliproxyapi: ['openai'],
  claude: ['anthropic'],
  gemini: ['gemini'],
  anyrouter: ['openai', 'anthropic'],
};

export const PLATFORM_ALIASES: Record<string, string> = {
  anthropic: 'claude',
  google: 'gemini',
  'new api': 'new-api',
  newapi: 'new-api',
  'one api': 'one-api',
  oneapi: 'one-api',
};

export function isRegexModelPattern(modelPattern: string): boolean {
  return isTokenRouteRegexPattern(modelPattern);
}

export function isExactModelPattern(modelPattern: string): boolean {
  return isExactTokenRouteModelPattern(modelPattern);
}

export function isRouteBackendReferences(backend: RouteGraphBackendSpec | null | undefined): boolean {
  return backend?.kind === 'routes';
}

export function getRouteBackendRouteIds(backend: RouteGraphBackendSpec | null | undefined): number[] {
  return backend?.kind === 'routes' ? backend.routeIds : [];
}

export function getRouteRequestedModelPattern(route: Pick<RouteRow | RouteSummaryRow, 'match'>): string {
  return route.match.requestedModelPattern || '';
}

export function getRouteDisplayName(route: Pick<RouteRow | RouteSummaryRow, 'presentation' | 'match'>): string | null {
  return route.presentation.displayName || route.match.displayName || null;
}

export function getRouteDisplayIcon(route: Pick<RouteRow | RouteSummaryRow, 'presentation'>): string | null {
  return route.presentation.displayIcon || null;
}

export function isExplicitGroupRoute(route: Pick<RouteRow | RouteSummaryRow, 'backend'>): boolean {
  return isRouteBackendReferences(route.backend);
}

export function isRouteExactModel(route: Pick<RouteRow | RouteSummaryRow, 'match' | 'backend'>): boolean {
  return !isRouteBackendReferences(route.backend) && isExactModelPattern(getRouteRequestedModelPattern(route));
}

export function parseRegexModelPattern(modelPattern: string): { regex: { test(value: string): boolean } | null; error: string | null } {
  return parseTokenRouteRegexPattern(modelPattern);
}

export function matchesModelPattern(model: string, pattern: string): boolean {
  return matchesTokenRouteModelPattern(model, pattern);
}

export function getModelPatternError(modelPattern: string): string | null {
  const normalized = modelPattern.trim();
  if (!normalized) return null;
  if (!isRegexModelPattern(normalized)) return null;
  const parsed = parseRegexModelPattern(normalized);
  if (!parsed.error) return null;
  return tr('pages.tokenRoutes.modelPatternRegexError').replace('{message}', parsed.error);
}

export function resolveRouteTitle(route: Pick<RouteRow | RouteSummaryRow, 'presentation' | 'match'>): string {
  const title = (getRouteDisplayName(route) || '').trim();
  return title || getRouteRequestedModelPattern(route);
}

export function resolveRouteBrand(route: Pick<RouteRow | RouteSummaryRow, 'presentation' | 'match'>): BrandInfo | null {
  const displayName = (getRouteDisplayName(route) || '').trim();
  if (displayName) {
    const byDisplayName = getBrand(displayName);
    if (byDisplayName) return byDisplayName;
  }
  return getBrand(getRouteRequestedModelPattern(route));
}

export function toBrandIconValue(icon: string): string {
  return `${ROUTE_BRAND_ICON_PREFIX}${icon}`;
}

export function parseBrandIconValue(raw: string): string | null {
  const normalized = (raw || '').trim();
  if (!normalized.startsWith(ROUTE_BRAND_ICON_PREFIX)) return null;
  const icon = normalized.slice(ROUTE_BRAND_ICON_PREFIX.length).trim();
  return normalizeBrandIconKey(icon);
}

export function isRouteIconNoneValue(raw: string | null | undefined): boolean {
  return (raw || '').trim() === ROUTE_ICON_NONE_VALUE;
}

export function normalizeRouteDisplayIconValue(raw: string | null | undefined): string {
  const normalized = (raw || '').trim();
  if (isRouteIconNoneValue(normalized)) return ROUTE_ICON_NONE_VALUE;
  const brandIcon = parseBrandIconValue(normalized);
  if (brandIcon) return toBrandIconValue(brandIcon);
  return normalized;
}

export function resolveEndpointTypeIconModel(endpointType: string): string | null {
  const key = String(endpointType || '').trim().toLowerCase();
  if (!key) return null;
  return ENDPOINT_TYPE_ICON_MODEL_MAP[key] || null;
}

export function normalizePlatformKey(platform: string | null | undefined): string {
  const raw = String(platform || '').trim().toLowerCase();
  if (!raw) return '';
  return PLATFORM_ALIASES[raw] || raw;
}

export function inferEndpointTypesFromPlatform(platform: string | null | undefined): string[] {
  const key = normalizePlatformKey(platform);
  if (!key) return [];
  const mapped = PLATFORM_ENDPOINT_FALLBACK_MAP[key];
  if (Array.isArray(mapped) && mapped.length > 0) return mapped;

  if (key.includes('claude') || key.includes('anthropic')) return ['anthropic'];
  if (key.includes('gemini')) return ['gemini'];
  if (key.includes('openai') || key.includes('new-api') || key.includes('one-api')) return ['openai'];
  return [];
}

export function siteAvatarLetters(siteName: string): string {
  const normalized = String(siteName || '').trim();
  if (!normalized) return 'S';
  const parts = normalized.replace(/[-_/.]/g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  const compact = normalized.replace(/\s+/g, '');
  return compact.slice(0, 2).toUpperCase();
}

export function resolveRouteIcon(route: Pick<RouteRow | RouteSummaryRow, 'presentation'>): { kind: 'auto' } | { kind: 'none' } | { kind: 'text'; value: string } | { kind: 'brand'; value: string } {
  const icon = (route.presentation.displayIcon || '').trim();
  if (isRouteIconNoneValue(icon)) return { kind: 'none' };
  if (!icon) return { kind: 'auto' };
  const brandIcon = parseBrandIconValue(icon);
  if (brandIcon) return { kind: 'brand', value: brandIcon };
  return { kind: 'text', value: icon };
}

export function normalizeTargets(targets: RouteEndpointTarget[]): RouteEndpointTarget[] {
  return [...(targets || [])].sort((a, b) => {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pa === pb) return (a.id ?? 0) - (b.id ?? 0);
    return pa - pb;
  });
}

export function normalizeRoutes(routeRows: any[]): RouteRow[] {
  return (routeRows || []).map((route) => ({
    ...(route as RouteRow),
    targets: normalizeTargets(route.targets || []),
  }));
}

export function buildSourceGroupKey(routeId: number, sourceModel: string): string {
  const normalizedSourceModel = sourceModel.trim() || '__ungrouped__';
  return `${routeId}::${normalizedSourceModel}`;
}

export function getPriorityTagStyle(priority: number): CSSProperties {
  if (priority <= 0) {
    return {
      background: 'color-mix(in srgb, var(--color-success) 16%, transparent)',
      color: 'var(--color-success)',
    };
  }

  if (priority === 1) {
    return {
      background: 'color-mix(in srgb, var(--color-info) 16%, transparent)',
      color: 'var(--color-info)',
    };
  }

  return {
    background: 'rgba(100,116,139,0.18)',
    color: 'var(--color-text-secondary)',
  };
}

export function getProbabilityColor(probability: number): string {
  if (probability >= 80) return 'var(--color-success)';
  if (probability >= 60) return 'color-mix(in srgb, var(--color-success) 50%, var(--color-warning))';
  if (probability >= 40) return 'var(--color-warning)';
  if (probability >= 20) return 'color-mix(in srgb, var(--color-warning) 45%, var(--color-danger))';
  if (probability > 0) return 'var(--color-danger)';
  return 'var(--color-border)';
}

export function getTargetDecisionState(
  candidate: RouteDecisionCandidate | undefined,
  target: RouteEndpointTarget,
  isExactRoute: boolean,
  loadingDecision: boolean,
): TargetDecisionState {
  if (!isExactRoute && !candidate) {
    return {
      probability: 0,
      showBar: true,
      reasonText: loadingDecision ? tr('pages.tokenRoutes.utils.calculating') : tr('pages.tokenRoutes.utils.realTimeDecisionMaking'),
      reasonColor: 'var(--color-text-muted)',
    };
  }

  if (!candidate) {
    return {
      probability: 0,
      showBar: true,
      reasonText: loadingDecision ? tr('pages.tokenRoutes.utils.calculating') : tr('pages.tokenRoutes.utils.noTargetAvailable'),
      reasonColor: 'var(--color-text-muted)',
    };
  }

  if (candidate.avoidedByRecentFailure) {
    return {
      probability: 0,
      showBar: true,
      reasonText: tr('pages.tokenRoutes.utils.failureAvoidance'),
      reasonColor: 'var(--color-warning)',
    };
  }

  if (!candidate.eligible) {
    const nowIso = new Date().toISOString();
    const cooldownActive = !!target.cooldownUntil && target.cooldownUntil > nowIso;
    if (cooldownActive || candidate.reason.includes(tr('pages.tokenRoutes.utils.coolingDown'))) {
      return {
        probability: 0,
        showBar: true,
        reasonText: tr('pages.tokenRoutes.utils.coolingDown'),
        reasonColor: 'var(--color-danger)',
      };
    }

    return {
      probability: 0,
      showBar: true,
      reasonText: candidate.reason || tr('pages.settings.updateCenterSection.notAvailable'),
      reasonColor: 'var(--color-text-muted)',
    };
  }

  const probability = Number(candidate.probability || 0);
  if (probability <= 0) {
    if (candidate.recentlyFailed) {
      return {
        probability: 0,
        showBar: false,
        reasonText: tr('pages.tokenRoutes.utils.recentFailure'),
        reasonColor: 'var(--color-warning)',
      };
    }

    return {
      probability: 0,
      showBar: false,
      reasonText: candidate.reason || tr('pages.tokenRoutes.utils.probability0'),
      reasonColor: 'var(--color-text-muted)',
    };
  }

  return {
    probability,
    showBar: true,
    reasonText: '',
    reasonColor: 'var(--color-text-muted)',
  };
}
