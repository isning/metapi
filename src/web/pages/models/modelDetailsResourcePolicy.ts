import type { ModelDetailsTab, ModelMetricsRange } from './modelDetailsView.js';

export const MODEL_DETAILS_PREFETCH_INTENT_MS = 80;
export const MODEL_DETAILS_SUMMARY_RANGE: ModelMetricsRange = '6h';

export type ModelDetailsResource =
  | { type: 'route-flow'; model: string }
  | { type: 'route-diagnostics'; model: string }
  | { type: 'runtime-observability'; model: string; range: ModelMetricsRange };

export type ModelDetailsResourcePhase = 'activate' | 'prefetch' | 'refresh';

type ModelDetailsResourceInput = {
  model: string;
  tab: ModelDetailsTab;
  range: ModelMetricsRange;
  phase: ModelDetailsResourcePhase;
};

const ROUTE_FLOW_TABS = new Set<ModelDetailsTab>(['overview', 'routing', 'api', 'diagnostics']);
const PREFETCH_ROUTE_FLOW_TABS = new Set<ModelDetailsTab>(['overview', 'routing', 'api']);
const SUMMARY_OBSERVABILITY_TABS = new Set<ModelDetailsTab>(['overview', 'performance']);

export function modelDetailsResourceKey(resource: ModelDetailsResource): string {
  if (resource.type === 'runtime-observability') {
    return `${resource.type}:${resource.model}:${resource.range}`;
  }
  return `${resource.type}:${resource.model}`;
}

export function modelDetailsResourcesFor(input: ModelDetailsResourceInput): ModelDetailsResource[] {
  if (!input.model) return [];

  const resources: ModelDetailsResource[] = [];
  if (input.phase === 'prefetch') {
    if (PREFETCH_ROUTE_FLOW_TABS.has(input.tab)) {
      resources.push({ type: 'route-flow', model: input.model });
    } else if (input.tab === 'diagnostics') {
      resources.push({ type: 'route-diagnostics', model: input.model });
    }
  } else if (ROUTE_FLOW_TABS.has(input.tab)) {
    resources.push({ type: 'route-flow', model: input.model });
  }

  if (SUMMARY_OBSERVABILITY_TABS.has(input.tab)) {
    resources.push({
      type: 'runtime-observability',
      model: input.model,
      range: MODEL_DETAILS_SUMMARY_RANGE,
    });
  }

  if (input.tab === 'performance' && input.range !== MODEL_DETAILS_SUMMARY_RANGE) {
    resources.push({
      type: 'runtime-observability',
      model: input.model,
      range: input.range,
    });
  }

  const seen = new Set<string>();
  return resources.filter((resource) => {
    const key = modelDetailsResourceKey(resource);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
