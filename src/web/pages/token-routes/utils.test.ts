import { describe, expect, it, vi } from 'vitest';

vi.mock('../../components/BrandIcon.js', () => ({
  getBrand: (value: string) => {
    const key = String(value || '').toLowerCase();
    if (key.includes('openai') || key.includes('gpt')) {
      return { key: 'openai', label: 'OpenAI' };
    }
    return null;
  },
  normalizeBrandIconKey: (icon: string) => icon.trim().toLowerCase(),
}));

import {
  ROUTE_ICON_NONE_VALUE,
  buildSourceGroupKey,
  getTargetDecisionState,
  getModelPatternError,
  getPriorityTagStyle,
  getProbabilityColor,
  getRouteBackendRouteIds,
  getRouteDisplayIcon,
  getRouteDisplayName,
  getRouteRequestedModelPattern,
  inferEndpointTypesFromPlatform,
  isExactModelPattern,
  isExplicitGroupRoute,
  isRegexModelPattern,
  isRouteBackendReferences,
  isRouteExactModel,
  matchesModelPattern,
  normalizeTargets,
  normalizePlatformKey,
  normalizeRoutes,
  normalizeRouteDisplayIconValue,
  parseBrandIconValue,
  parseRegexModelPattern,
  resolveEndpointTypeIconModel,
  resolveRouteBrand,
  resolveRouteTitle,
  resolveRouteIcon,
  siteAvatarLetters,
  toBrandIconValue,
} from './utils.js';
import type { RouteEndpointTarget, RouteDecisionCandidate, RouteSummaryRow } from './types.js';

function route(overrides: Partial<RouteSummaryRow> & { targets?: RouteEndpointTarget[] } = {}): RouteSummaryRow {
  return {
    id: 1,
    match: { kind: 'model', requestedModelPattern: 'gpt-*', displayName: null },
    backend: { kind: 'supply' },
    presentation: { displayName: null, displayIcon: null },
    modelMapping: null,
    routingStrategy: 'weighted',
    enabled: true,
    targetCount: 0,
    enabledTargetCount: 0,
    siteNames: [],
    decisionSnapshot: null,
    decisionRefreshedAt: null,
    ...overrides,
  };
}

function target(overrides: Partial<RouteEndpointTarget> = {}): RouteEndpointTarget {
  return {
    id: 1,
    accountId: 1,
    tokenId: null,
    priority: 0,
    weight: 10,
    enabled: true,
    manualOverride: false,
    successCount: 0,
    failCount: 0,
    ...overrides,
  };
}

function candidate(overrides: Partial<RouteDecisionCandidate> = {}): RouteDecisionCandidate {
  return {
    targetId: 1,
    accountId: 1,
    username: 'user',
    siteName: 'site',
    tokenName: 'token',
    priority: 0,
    weight: 10,
    eligible: true,
    recentlyFailed: false,
    avoidedByRecentFailure: false,
    probability: 50,
    reason: '',
    ...overrides,
  };
}

describe('token route icon helpers', () => {
  it('preserves the explicit no-icon sentinel during normalization', () => {
    expect(normalizeRouteDisplayIconValue(ROUTE_ICON_NONE_VALUE)).toBe(ROUTE_ICON_NONE_VALUE);
    expect(normalizeRouteDisplayIconValue(' brand: OpenAI ')).toBe('brand:openai');
    expect(normalizeRouteDisplayIconValue('custom')).toBe('custom');
    expect(parseBrandIconValue('custom')).toBeNull();
    expect(parseBrandIconValue('brand: OpenAI')).toBe('openai');
    expect(toBrandIconValue('openai')).toBe('brand:openai');
  });

  it('treats the explicit no-icon sentinel as no icon', () => {
    expect(resolveRouteIcon({ presentation: { displayName: null, displayIcon: ROUTE_ICON_NONE_VALUE } })).toEqual({ kind: 'none' });
    expect(resolveRouteIcon({ presentation: { displayName: null, displayIcon: '' } })).toEqual({ kind: 'auto' });
    expect(resolveRouteIcon({ presentation: { displayName: null, displayIcon: 'brand:openai' } })).toEqual({ kind: 'brand', value: 'openai' });
    expect(resolveRouteIcon({ presentation: { displayName: null, displayIcon: '🚀' } })).toEqual({ kind: 'text', value: '🚀' });
  });
});

describe('token route metadata helpers', () => {
  it('resolves route display data from graph-native match, backend, and presentation fields', () => {
    const grouped = route({
      match: { kind: 'model', requestedModelPattern: '', displayName: 'Public GPT' },
      backend: { kind: 'routes', routeIds: [3, 2] },
      presentation: { displayName: null, displayIcon: 'brand:openai' },
    });

    expect(getRouteRequestedModelPattern(grouped)).toBe('');
    expect(getRouteDisplayName(grouped)).toBe('Public GPT');
    expect(getRouteDisplayIcon(grouped)).toBe('brand:openai');
    expect(isRouteBackendReferences(grouped.backend)).toBe(true);
    expect(getRouteBackendRouteIds(grouped.backend)).toEqual([3, 2]);
    expect(getRouteBackendRouteIds(null)).toEqual([]);
    expect(isExplicitGroupRoute(grouped)).toBe(true);
    expect(resolveRouteTitle(grouped)).toBe('Public GPT');
    expect(resolveRouteBrand(grouped)).toEqual({ key: 'openai', label: 'OpenAI' });
    expect(resolveRouteBrand(route({ match: { kind: 'model', requestedModelPattern: 'gpt-4o', displayName: null } }))).toEqual({ key: 'openai', label: 'OpenAI' });
  });

  it('classifies model patterns and reports regex parse errors', () => {
    expect(isExactModelPattern('gpt-4o')).toBe(true);
    expect(isRegexModelPattern('re:^gpt-.*')).toBe(true);
    expect(matchesModelPattern('gpt-4o', 'gpt-*')).toBe(true);
    expect(parseRegexModelPattern('re:^gpt-.*').regex?.test('gpt-4o')).toBe(true);
    expect(getModelPatternError('')).toBeNull();
    expect(getModelPatternError('gpt-*')).toBeNull();
    expect(getModelPatternError('re:[')).toContain('模型匹配正则错误');
    expect(isRouteExactModel(route({ match: { kind: 'model', requestedModelPattern: 'gpt-4o', displayName: null } }))).toBe(true);
    expect(isRouteExactModel(route({ backend: { kind: 'routes', routeIds: [1] } }))).toBe(false);
  });

  it('normalizes platform aliases and infers endpoint types', () => {
    expect(resolveEndpointTypeIconModel('OpenAI')).toBe('chatgpt');
    expect(resolveEndpointTypeIconModel('')).toBeNull();
    expect(normalizePlatformKey('New API')).toBe('new-api');
    expect(normalizePlatformKey(null)).toBe('');
    expect(inferEndpointTypesFromPlatform('anyrouter')).toEqual(['openai', 'anthropic']);
    expect(inferEndpointTypesFromPlatform('claude-compatible')).toEqual(['anthropic']);
    expect(inferEndpointTypesFromPlatform('custom gemini gateway')).toEqual(['gemini']);
    expect(inferEndpointTypesFromPlatform('my-openai-proxy')).toEqual(['openai']);
    expect(inferEndpointTypesFromPlatform('unknown')).toEqual([]);
  });

  it('normalizes target, route, source-group, avatar, and visual helper output', () => {
    expect(normalizeTargets([
      target({ id: 3, priority: 2 }),
      target({ id: 1, priority: 0 }),
      target({ id: 2, priority: 0 }),
    ]).map((item) => item.id)).toEqual([1, 2, 3]);
    expect(normalizeRoutes([
      route({ id: 1, targets: [target({ id: 2, priority: 2 }), target({ id: 1, priority: 1 })] }),
    ] as any)[0].targets.map((item) => item.id)).toEqual([1, 2]);
    expect(buildSourceGroupKey(1, ' model-a ')).toBe('1::model-a');
    expect(buildSourceGroupKey(1, '   ')).toBe('1::__ungrouped__');
    expect(siteAvatarLetters('New API')).toBe('NA');
    expect(siteAvatarLetters('openai')).toBe('OP');
    expect(siteAvatarLetters('')).toBe('S');
    expect(getPriorityTagStyle(0).color).toBe('var(--color-success)');
    expect(getPriorityTagStyle(1).color).toBe('var(--color-info)');
    expect(getPriorityTagStyle(2).color).toBe('var(--color-text-secondary)');
    expect([100, 75, 50, 25, 1, 0].map(getProbabilityColor)).toEqual([
      'var(--color-success)',
      'color-mix(in srgb, var(--color-success) 50%, var(--color-warning))',
      'var(--color-warning)',
      'color-mix(in srgb, var(--color-warning) 45%, var(--color-danger))',
      'var(--color-danger)',
      'var(--color-border)',
    ]);
  });
});

describe('getTargetDecisionState', () => {
  it('summarizes missing candidate states for exact and non-exact routes', () => {
    expect(getTargetDecisionState(undefined, target(), false, false)).toMatchObject({
      reasonText: '实时决策',
      showBar: true,
    });
    expect(getTargetDecisionState(undefined, target(), false, true)).toMatchObject({
      reasonText: '计算中...',
    });
    expect(getTargetDecisionState(undefined, target(), true, false)).toMatchObject({
      reasonText: '无可用目标',
    });
  });

  it('summarizes avoided, ineligible, zero-probability, and eligible candidate states', () => {
    expect(getTargetDecisionState(candidate({
      probability: 50,
      eligible: true,
      reason: '',
      avoidedByRecentFailure: true,
    }), target(), true, false)).toMatchObject({
      probability: 0,
      reasonText: '失败避让',
    });

    expect(getTargetDecisionState(candidate({
      probability: 0,
      eligible: false,
      reason: '冷却中',
    }), target(), true, false)).toMatchObject({
      reasonText: '冷却中',
      reasonColor: 'var(--color-danger)',
    });

    expect(getTargetDecisionState(candidate({
      probability: 0,
      eligible: false,
      reason: '',
    }), target({ cooldownUntil: '2999-01-01T00:00:00.000Z' }), true, false)).toMatchObject({
      reasonText: '冷却中',
    });

    expect(getTargetDecisionState(candidate({
      probability: 0,
      eligible: false,
      reason: 'disabled',
    }), target(), true, false)).toMatchObject({
      reasonText: 'disabled',
    });

    expect(getTargetDecisionState(candidate({
      probability: 0,
      eligible: true,
      reason: '',
      recentlyFailed: true,
    }), target(), true, false)).toMatchObject({
      showBar: false,
      reasonText: '近期失败',
    });

    expect(getTargetDecisionState(candidate({
      probability: 0,
      eligible: true,
      reason: '',
    }), target(), true, false)).toMatchObject({
      showBar: false,
      reasonText: '概率为 0%',
    });

    expect(getTargetDecisionState(candidate({
      probability: 42,
      eligible: true,
      reason: '',
    }), target(), true, false)).toMatchObject({
      probability: 42,
      showBar: true,
      reasonText: '',
    });
  });
});
