import { tr } from '../../i18n.js';
import type { RouteRoutingStrategy } from './types.js';

export function normalizeRouteRoutingStrategyValue(value?: RouteRoutingStrategy | null): RouteRoutingStrategy {
  if (value === 'round_robin' || value === 'stable_first') return value;
  return 'weighted';
}

export function getRouteRoutingStrategyLabel(value?: RouteRoutingStrategy | null): string {
  const strategy = normalizeRouteRoutingStrategyValue(value);
  if (strategy === 'round_robin') return tr('pages.oAuthManagement.roundRobin');
  if (strategy === 'stable_first') return tr('pages.settings.stableFirst');
  return tr('pages.tokenRoutes.manualRoutePanel.weightedRandom');
}

export function getRouteRoutingStrategyDescription(value?: RouteRoutingStrategy | null): string {
  const strategy = normalizeRouteRoutingStrategyValue(value);
  if (strategy === 'round_robin') {
    return tr('pages.tokenRoutes.routingStrategy.ignorePValueCallGlobalOrderAfter');
  }
  if (strategy === 'stable_first') {
    return tr('pages.tokenRoutes.routingStrategy.avoidRecentlyFailedUnhealthySitesFirstThen');
  }
  return tr('pages.tokenRoutes.routingStrategy.pValueHardPrioritySelectionStaysWithin');
}

export function getRouteRoutingStrategyHint(value?: RouteRoutingStrategy | null): string {
  const strategy = normalizeRouteRoutingStrategyValue(value);
  if (strategy === 'round_robin') {
    return tr('pages.tokenRoutes.routingStrategy.strategyDoesNotUsePValueIf');
  }
  if (strategy === 'stable_first') {
    return tr('pages.tokenRoutes.routingStrategy.underStrategyStableSitesRotatePOrder');
  }
  return tr('pages.tokenRoutes.routingStrategy.longHigherPriorityTierStillHasAvailable');
}
