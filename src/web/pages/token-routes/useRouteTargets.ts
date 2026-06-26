import { useState, useCallback, useRef } from 'react';
import { api } from '../../api.js';
import { normalizeTargets } from './utils.js';
import type { RouteEndpointTarget } from './types.js';

export function useRouteTargets() {
  const [targetsByRouteId, setTargetsByRouteId] = useState<Record<number, RouteEndpointTarget[]>>({});
  const [loadingTargetsByRouteId, setLoadingTargetsByRouteId] = useState<Record<number, boolean>>({});
  const targetsByRouteIdRef = useRef(targetsByRouteId);
  targetsByRouteIdRef.current = targetsByRouteId;

  const loadTargets = useCallback(async (routeId: number, force = false) => {
    if (!force && targetsByRouteIdRef.current[routeId]) return targetsByRouteIdRef.current[routeId];
    setLoadingTargetsByRouteId((prev) => ({ ...prev, [routeId]: true }));
    try {
      const targets = await api.getRouteTargets(routeId);
      const sorted = normalizeTargets(targets || []);
      setTargetsByRouteId((prev) => ({ ...prev, [routeId]: sorted }));
      return sorted;
    } catch (error) {
      console.error(`Failed to load targets for route ${routeId}:`, error);
      throw error;
    } finally {
      setLoadingTargetsByRouteId((prev) => ({ ...prev, [routeId]: false }));
    }
  }, []);

  const invalidateTargets = useCallback((routeId?: number) => {
    setTargetsByRouteId((prev) => {
      if (routeId === undefined) {
        return {};
      }
      const next = { ...prev };
      delete next[routeId];
      return next;
    });
  }, []);

  const setTargets = useCallback((routeId: number, targets: RouteEndpointTarget[]) => {
    setTargetsByRouteId((prev) => ({ ...prev, [routeId]: targets }));
  }, []);

  return {
    targetsByRouteId,
    loadingTargetsByRouteId,
    loadTargets,
    invalidateTargets,
    setTargets,
  };
}
