import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ModelRouteFlowDiagnostics, type ModelRuntimeObservability } from '../../api.js';
import type { ModelRouteFlowData } from '../../components/ModelRouteFlow.js';
import { tr } from '../../i18n.js';
import type { ModelMetricsRange } from './modelDetailsView.js';
import type { ModelDetailsResource } from './modelDetailsResourcePolicy.js';

type ModelDetailsResourceSnapshot = {
  routeFlowByModel: Record<string, ModelRouteFlowData | null>;
  routeFlowDiagnosticsByModel: Record<string, ModelRouteFlowDiagnostics | null>;
  routeFlowDiagnosticsErrorByModel: Record<string, string>;
  routeFlowLoadingByModel: Record<string, boolean>;
  routeFlowErrorByModel: Record<string, string>;
  observabilityByKey: Record<string, ModelRuntimeObservability | null>;
  observabilityLoadingByKey: Record<string, boolean>;
  observabilityErrorByKey: Record<string, string>;
};

type LoadOptions = {
  force?: boolean;
  silent?: boolean;
};

function observabilityKey(model: string, range: ModelMetricsRange): string {
  return `${model}:${range}`;
}

function routeFlowDiagnosticsFromFlow(flow: ModelRouteFlowData): ModelRouteFlowDiagnostics {
  const runtime = flow.compiledRuntime;
  return {
    requestedModel: flow.requestedModel,
    actualModel: runtime?.selected.actualModel ?? null,
    matched: flow.matched,
    entryId: runtime?.match.entryNodeId ?? null,
    selectedEndpointId: runtime?.selected.endpointId ?? null,
    selectedAccountId: runtime?.selected.accountId ?? null,
    diagnostics: flow.diagnostics,
    projectedAt: flow.projectedAt,
  };
}

export function useModelDetailsResourceCache() {
  const [routeFlowByModel, setRouteFlowByModel] = useState<Record<string, ModelRouteFlowData | null>>({});
  const [routeFlowDiagnosticsByModel, setRouteFlowDiagnosticsByModel] = useState<Record<string, ModelRouteFlowDiagnostics | null>>({});
  const [routeFlowDiagnosticsErrorByModel, setRouteFlowDiagnosticsErrorByModel] = useState<Record<string, string>>({});
  const [routeFlowLoadingByModel, setRouteFlowLoadingByModel] = useState<Record<string, boolean>>({});
  const [routeFlowErrorByModel, setRouteFlowErrorByModel] = useState<Record<string, string>>({});
  const [observabilityByKey, setObservabilityByKey] = useState<Record<string, ModelRuntimeObservability | null>>({});
  const [observabilityLoadingByKey, setObservabilityLoadingByKey] = useState<Record<string, boolean>>({});
  const [observabilityErrorByKey, setObservabilityErrorByKey] = useState<Record<string, string>>({});
  const observabilityRequestSeqRef = useRef(0);
  const latestObservabilityRequestByKeyRef = useRef(new Map<string, number>());
  const inFlightObservabilityByKeyRef = useRef(new Map<string, Promise<ModelRuntimeObservability | null>>());
  const mountedRef = useRef(true);
  const requestedRouteFlowModelsRef = useRef(new Set<string>());
  const requestedRouteFlowDiagnosticsModelsRef = useRef(new Set<string>());
  const inFlightRouteFlowByModelRef = useRef(new Map<string, Promise<ModelRouteFlowData | null>>());
  const inFlightRouteFlowDiagnosticsByModelRef = useRef(new Map<string, Promise<ModelRouteFlowDiagnostics | null>>());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      observabilityRequestSeqRef.current += 1;
      latestObservabilityRequestByKeyRef.current.clear();
      inFlightObservabilityByKeyRef.current.clear();
      inFlightRouteFlowByModelRef.current.clear();
      inFlightRouteFlowDiagnosticsByModelRef.current.clear();
    };
  }, []);

  const loadRuntimeObservability = useCallback(async (
    modelName: string,
    range: ModelMetricsRange,
    options: LoadOptions = {},
  ) => {
    const key = observabilityKey(modelName, range);
    if (!options.force && Object.prototype.hasOwnProperty.call(observabilityByKey, key)) {
      return observabilityByKey[key] ?? null;
    }
    const inFlight = inFlightObservabilityByKeyRef.current.get(key);
    if (inFlight) {
      if (!options.silent) {
        setObservabilityLoadingByKey((current) => ({ ...current, [key]: true }));
      }
      return await inFlight;
    }
    const requestId = ++observabilityRequestSeqRef.current;
    latestObservabilityRequestByKeyRef.current.set(key, requestId);
    if (!options.silent) {
      setObservabilityLoadingByKey((current) => ({ ...current, [key]: true }));
    }
    setObservabilityErrorByKey((current) => ({ ...current, [key]: '' }));
    const task = (async () => {
      const result = await api.getModelRuntimeObservability(modelName, { range });
      if (!mountedRef.current || latestObservabilityRequestByKeyRef.current.get(key) !== requestId) return null;
      setObservabilityByKey((current) => ({
        ...current,
        [key]: result.observability || null,
      }));
      return result.observability || null;
    })();
    inFlightObservabilityByKeyRef.current.set(key, task);
    try {
      return await task;
    } catch (error) {
      if (!mountedRef.current || latestObservabilityRequestByKeyRef.current.get(key) !== requestId) return null;
      setObservabilityByKey((current) => ({ ...current, [key]: null }));
      setObservabilityErrorByKey((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : tr('pages.modelTester.routesFailed'),
      }));
      return null;
    } finally {
      if (inFlightObservabilityByKeyRef.current.get(key) === task) {
        inFlightObservabilityByKeyRef.current.delete(key);
      }
      if (mountedRef.current && latestObservabilityRequestByKeyRef.current.get(key) === requestId) {
        setObservabilityLoadingByKey((current) => ({ ...current, [key]: false }));
      }
    }
  }, [observabilityByKey]);

  const loadRouteFlow = useCallback(async (
    modelName: string,
    options: LoadOptions = {},
  ) => {
    if (!modelName) return null;
    const inFlight = inFlightRouteFlowByModelRef.current.get(modelName);
    if (inFlight) {
      if (!options.silent) {
        setRouteFlowLoadingByModel((current) => ({ ...current, [modelName]: true }));
      }
      return await inFlight;
    }
    if (!options.force && requestedRouteFlowModelsRef.current.has(modelName)) {
      return routeFlowByModel[modelName] ?? null;
    }

    requestedRouteFlowModelsRef.current.add(modelName);
    if (!options.silent) {
      setRouteFlowLoadingByModel((current) => ({ ...current, [modelName]: true }));
    }
    setRouteFlowErrorByModel((current) => ({ ...current, [modelName]: '' }));
    setRouteFlowDiagnosticsErrorByModel((current) => ({ ...current, [modelName]: '' }));
    const task = (async () => {
      const result = await api.getModelRouteFlow(modelName);
      const flow = (result as { flow?: ModelRouteFlowData }).flow || null;
      if (!mountedRef.current) return null;
      setRouteFlowByModel((current) => ({
        ...current,
        [modelName]: flow,
      }));
      if (flow) {
        setRouteFlowDiagnosticsByModel((current) => ({
          ...current,
          [modelName]: routeFlowDiagnosticsFromFlow(flow),
        }));
      }
      return flow;
    })();
    inFlightRouteFlowByModelRef.current.set(modelName, task);
    try {
      return await task;
    } catch (error) {
      if (!mountedRef.current) return null;
      setRouteFlowByModel((current) => ({ ...current, [modelName]: null }));
      requestedRouteFlowModelsRef.current.delete(modelName);
      setRouteFlowErrorByModel((current) => ({
        ...current,
        [modelName]: error instanceof Error ? error.message : tr('pages.modelTester.routesFailed'),
      }));
      return null;
    } finally {
      if (inFlightRouteFlowByModelRef.current.get(modelName) === task) {
        inFlightRouteFlowByModelRef.current.delete(modelName);
      }
      if (mountedRef.current) {
        setRouteFlowLoadingByModel((current) => ({ ...current, [modelName]: false }));
      }
    }
  }, [routeFlowByModel]);

  const loadRouteFlowDiagnostics = useCallback(async (modelName: string, options: LoadOptions = {}) => {
    if (!modelName) return null;
    const inFlight = inFlightRouteFlowDiagnosticsByModelRef.current.get(modelName);
    if (inFlight) return await inFlight;
    if (!options.force && requestedRouteFlowModelsRef.current.has(modelName)) {
      return routeFlowDiagnosticsByModel[modelName] ?? null;
    }
    if (!options.force && requestedRouteFlowDiagnosticsModelsRef.current.has(modelName)) {
      return routeFlowDiagnosticsByModel[modelName] ?? null;
    }

    requestedRouteFlowDiagnosticsModelsRef.current.add(modelName);
    setRouteFlowDiagnosticsErrorByModel((current) => ({ ...current, [modelName]: '' }));
    const task = (async () => {
      const result = await api.getModelRouteFlowDiagnostics(modelName);
      const diagnostics = (result as { diagnostics?: ModelRouteFlowDiagnostics }).diagnostics || null;
      if (!mountedRef.current) return null;
      setRouteFlowDiagnosticsByModel((current) => ({
        ...current,
        [modelName]: diagnostics,
      }));
      return diagnostics;
    })();
    inFlightRouteFlowDiagnosticsByModelRef.current.set(modelName, task);
    try {
      return await task;
    } catch (error) {
      if (!mountedRef.current) return null;
      requestedRouteFlowDiagnosticsModelsRef.current.delete(modelName);
      setRouteFlowDiagnosticsByModel((current) => ({ ...current, [modelName]: null }));
      setRouteFlowDiagnosticsErrorByModel((current) => ({
        ...current,
        [modelName]: error instanceof Error ? error.message : tr('pages.modelTester.routesFailed'),
      }));
      return null;
    } finally {
      if (inFlightRouteFlowDiagnosticsByModelRef.current.get(modelName) === task) {
        inFlightRouteFlowDiagnosticsByModelRef.current.delete(modelName);
      }
    }
  }, [routeFlowDiagnosticsByModel]);

  const loadResource = useCallback((resource: ModelDetailsResource, options: LoadOptions = {}) => {
    if (resource.type === 'route-flow') {
      return void loadRouteFlow(resource.model, options);
    }
    if (resource.type === 'route-diagnostics') {
      return void loadRouteFlowDiagnostics(resource.model, options);
    }
    return void loadRuntimeObservability(resource.model, resource.range, options);
  }, [loadRouteFlow, loadRouteFlowDiagnostics, loadRuntimeObservability]);

  const ensure = useCallback((resources: ModelDetailsResource[], options: LoadOptions = {}) => {
    for (const resource of resources) loadResource(resource, options);
  }, [loadResource]);

  const prefetch = useCallback((resources: ModelDetailsResource[], options: LoadOptions = {}) => {
    for (const resource of resources) loadResource(resource, { silent: true, ...options });
  }, [loadResource]);

  const refresh = useCallback((resources: ModelDetailsResource[], options: LoadOptions = {}) => {
    for (const resource of resources) loadResource(resource, { ...options, force: true });
  }, [loadResource]);

  const read = useCallback((): ModelDetailsResourceSnapshot => ({
    routeFlowByModel,
    routeFlowDiagnosticsByModel,
    routeFlowDiagnosticsErrorByModel,
    routeFlowLoadingByModel,
    routeFlowErrorByModel,
    observabilityByKey,
    observabilityLoadingByKey,
    observabilityErrorByKey,
  }), [
    observabilityByKey,
    observabilityErrorByKey,
    observabilityLoadingByKey,
    routeFlowByModel,
    routeFlowDiagnosticsByModel,
    routeFlowDiagnosticsErrorByModel,
    routeFlowErrorByModel,
    routeFlowLoadingByModel,
  ]);

  return {
    ensure,
    prefetch,
    refresh,
    read,
    snapshot: read(),
  };
}
