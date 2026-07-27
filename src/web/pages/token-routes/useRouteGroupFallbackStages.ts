import { useCallback, useRef, useState } from "react";
import { api } from "../../api.js";
import type { RouteGroupManagementFallbackStage } from "../../../shared/routeGroupManagement.js";

export function flattenRouteGroupFallbackStages(
  stages: RouteGroupManagementFallbackStage[] | undefined,
) {
  return (stages || []).flatMap((stage) => stage.candidates || []);
}

export function useRouteGroupFallbackStages() {
  const [stagesByRouteGroupId, setStagesByRouteGroupId] = useState<
    Record<string, RouteGroupManagementFallbackStage[]>
  >({});
  const [loadingStagesByRouteGroupId, setLoadingStagesByRouteGroupId] =
    useState<Record<string, boolean>>({});
  const stagesByRouteGroupIdRef = useRef(stagesByRouteGroupId);
  const requestVersionByRouteGroupIdRef = useRef<Record<string, number>>({});
  stagesByRouteGroupIdRef.current = stagesByRouteGroupId;

  const loadStages = useCallback(
    async (routeGroupId: string, force = false) => {
      if (!force && stagesByRouteGroupIdRef.current[routeGroupId])
        return stagesByRouteGroupIdRef.current[routeGroupId];
      const requestVersion =
        (requestVersionByRouteGroupIdRef.current[routeGroupId] || 0) + 1;
      requestVersionByRouteGroupIdRef.current[routeGroupId] = requestVersion;
      setLoadingStagesByRouteGroupId((previous) => ({
        ...previous,
        [routeGroupId]: true,
      }));
      try {
        const response = await api.getRouteGroupFallbackStages(routeGroupId);
        const stages = response.stages;
        if (
          requestVersionByRouteGroupIdRef.current[routeGroupId] ===
          requestVersion
        ) {
          setStagesByRouteGroupId((previous) => ({
            ...previous,
            [routeGroupId]: stages,
          }));
        }
        return stages;
      } finally {
        if (
          requestVersionByRouteGroupIdRef.current[routeGroupId] ===
          requestVersion
        ) {
          setLoadingStagesByRouteGroupId((previous) => ({
            ...previous,
            [routeGroupId]: false,
          }));
        }
      }
    },
    [],
  );

  const setStages = useCallback(
    (routeGroupId: string, stages: RouteGroupManagementFallbackStage[]) => {
      requestVersionByRouteGroupIdRef.current[routeGroupId] =
        (requestVersionByRouteGroupIdRef.current[routeGroupId] || 0) + 1;
      setStagesByRouteGroupId((previous) => ({
        ...previous,
        [routeGroupId]: stages,
      }));
      setLoadingStagesByRouteGroupId((previous) => ({
        ...previous,
        [routeGroupId]: false,
      }));
    },
    [],
  );

  return {
    stagesByRouteGroupId,
    loadingStagesByRouteGroupId,
    loadStages,
    setStages,
  };
}
