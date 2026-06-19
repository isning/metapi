import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUTE_ROUTING_STRATEGY,
  isRoundRobinRouteRoutingStrategy,
  normalizeRouteRoutingStrategy,
} from './routeRoutingStrategy.js';

describe('normalizeRouteRoutingStrategy', () => {
  it('accepts supported route routing strategies case-insensitively', () => {
    expect(normalizeRouteRoutingStrategy(' round_robin ')).toBe('round_robin');
    expect(normalizeRouteRoutingStrategy('STABLE_FIRST')).toBe('stable_first');
  });

  it('falls back to the default weighted strategy for unsupported values', () => {
    expect(normalizeRouteRoutingStrategy('priority')).toBe(DEFAULT_ROUTE_ROUTING_STRATEGY);
    expect(normalizeRouteRoutingStrategy(null)).toBe(DEFAULT_ROUTE_ROUTING_STRATEGY);
    expect(normalizeRouteRoutingStrategy(undefined)).toBe(DEFAULT_ROUTE_ROUTING_STRATEGY);
  });
});

describe('isRoundRobinRouteRoutingStrategy', () => {
  it('only returns true for normalized round-robin routing', () => {
    expect(isRoundRobinRouteRoutingStrategy('ROUND_ROBIN')).toBe(true);
    expect(isRoundRobinRouteRoutingStrategy('stable_first')).toBe(false);
    expect(isRoundRobinRouteRoutingStrategy('weighted')).toBe(false);
  });
});
