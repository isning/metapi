import type { RouteSummaryRow } from './types.js';
import type { RouteGraphMacro, RouteGraphNode } from './routeGraphTypes.js';
import type { RouteGraphSnapshotMacro } from './routeGraphSnapshot.js';
import {
  getRouteBackendRouteIds,
  getRouteDisplayName,
  getRouteRequestedModelPattern,
  isRouteBackendReferences,
  resolveRouteTitle,
} from './utils.js';

export type RouteMacroBindingMacro = RouteGraphMacro | RouteGraphSnapshotMacro;

export type RouteMacroBindingGraph = {
  nodes?: Array<RouteGraphNode | Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
  macros?: RouteMacroBindingMacro[];
} | null | undefined;

type MacroEntryMatch = {
  routeId: number | null;
  requestedModelPattern: string;
  displayName: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeStringOrNull(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeModelKey(value: unknown): string {
  return normalizeString(value).toLowerCase();
}

function normalizePositiveInteger(value: unknown): number | null {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null;
  return Math.trunc(numberValue);
}

function normalizeRouteIdArray(value: unknown): number[] {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map(normalizePositiveInteger)
    .filter((routeId): routeId is number => routeId !== null)));
}

function addRouteId(target: Set<number>, value: unknown): void {
  const routeId = normalizePositiveInteger(value);
  if (routeId) target.add(routeId);
}

function addRouteIds(target: Set<number>, value: unknown): void {
  for (const routeId of normalizeRouteIdArray(value)) target.add(routeId);
}

function getMacroConfig(macro: RouteMacroBindingMacro | null | undefined): Record<string, unknown> {
  return isRecord(macro?.config) ? macro.config : {};
}

function getMacroEntryMatch(macro: RouteMacroBindingMacro | null | undefined): MacroEntryMatch {
  const config = getMacroConfig(macro);
  const surface = isRecord(config.surface) ? config.surface : {};
  const entry = isRecord(surface.entry) ? surface.entry : {};
  const match = isRecord(entry.match) ? entry.match : {};
  return {
    routeId: normalizePositiveInteger(match.routeId),
    requestedModelPattern: normalizeString(match.requestedModelPattern),
    displayName: normalizeStringOrNull(match.displayName),
  };
}

function getMacroGroupInputEndpointIds(macro: RouteMacroBindingMacro | null | undefined): string[] {
  const config = getMacroConfig(macro);
  const groups = Array.isArray(config.groups) ? config.groups : [];
  const endpointIds = new Set<string>();

  for (const group of groups) {
    const groupRecord = isRecord(group) ? group : {};
    const input = isRecord(groupRecord.input) ? groupRecord.input : {};
    if (input.kind !== 'route_endpoints') continue;
    for (const endpointId of Array.isArray(input.endpointIds) ? input.endpointIds : []) {
      const normalized = normalizeString(endpointId);
      if (normalized) endpointIds.add(normalized);
    }
  }

  return Array.from(endpointIds);
}

function getMacroInlineRouteIds(macro: RouteMacroBindingMacro | null | undefined): number[] {
  const routeIds = new Set<number>();
  const config = getMacroConfig(macro);
  const groups = Array.isArray(config.groups) ? config.groups : [];
  addRouteId(routeIds, getMacroEntryMatch(macro).routeId);

  for (const group of groups) {
    const groupRecord = isRecord(group) ? group : {};
    addRouteId(routeIds, groupRecord.routeId);
    addRouteIds(routeIds, groupRecord.routeIds);
    const input = isRecord(groupRecord.input) ? groupRecord.input : {};
    addRouteId(routeIds, input.routeId);
    addRouteIds(routeIds, input.routeIds);
  }

  const metadata = isRecord((macro as RouteGraphMacro | undefined)?.metadata)
    ? (macro as RouteGraphMacro).metadata || {}
    : {};
  addRouteId(routeIds, metadata.routeId);
  addRouteIds(routeIds, metadata.routeIds);
  addRouteIds(routeIds, metadata.sourceRouteIds);
  const provenance = isRecord(metadata.provenance) ? metadata.provenance : {};
  addRouteId(routeIds, provenance.routeId);
  addRouteIds(routeIds, provenance.routeIds);

  return Array.from(routeIds);
}

function routeIdFromRouteEndpointId(endpointId: unknown): number | null {
  const match = /^route-endpoint:(?:product|supply):route:(\d+)$/.exec(normalizeString(endpointId));
  if (!match) return null;
  return normalizePositiveInteger(match[1]);
}

function getNodeEndpointIds(node: RouteGraphNode | Record<string, unknown>): string[] {
  return [
    normalizeString(node.id),
    normalizeString(node.endpointId),
    normalizeString(node.routeEndpointId),
  ].filter(Boolean);
}

function getRouteIdsForEndpointId(graph: RouteMacroBindingGraph, endpointId: string): number[] {
  const routeIds = new Set<number>();
  addRouteId(routeIds, routeIdFromRouteEndpointId(endpointId));

  for (const node of graph?.nodes || []) {
    if (!getNodeEndpointIds(node).includes(endpointId)) continue;
    addRouteId(routeIds, node.routeId);
    addRouteId(routeIds, node.legacyRouteId);
    const match = isRecord(node.match) ? node.match : {};
    addRouteId(routeIds, match.routeId);
    const backend = isRecord(node.backend) ? node.backend : {};
    if (backend.kind === 'routes') addRouteIds(routeIds, backend.routeIds);
    const metadata = isRecord(node.metadata) ? node.metadata : {};
    addRouteId(routeIds, metadata.routeId);
    addRouteIds(routeIds, metadata.routeIds);
    addRouteIds(routeIds, metadata.sourceRouteIds);
    addRouteIds(routeIds, metadata.localRouteIds);
  }

  return Array.from(routeIds);
}

export function getRouteIdsReferencedByRouteMacro(
  macro: RouteMacroBindingMacro | null | undefined,
  graph: RouteMacroBindingGraph,
): number[] {
  const routeIds = new Set<number>(getMacroInlineRouteIds(macro));
  for (const endpointId of getMacroGroupInputEndpointIds(macro)) {
    for (const routeId of getRouteIdsForEndpointId(graph, endpointId)) {
      routeIds.add(routeId);
    }
  }
  return Array.from(routeIds);
}

function getRouteModelKeys(route: RouteSummaryRow): Set<string> {
  return new Set([
    getRouteRequestedModelPattern(route),
    getRouteDisplayName(route),
    resolveRouteTitle(route),
  ].map(normalizeModelKey).filter(Boolean));
}

function macroMatchesRouteModel(macro: RouteMacroBindingMacro, routeModelKeys: Set<string>): boolean {
  const match = getMacroEntryMatch(macro);
  const macroModelKeys = [
    match.requestedModelPattern,
    match.displayName,
    macro.name,
  ].map(normalizeModelKey).filter(Boolean);
  return macroModelKeys.some((key) => routeModelKeys.has(key));
}

function getMacrosReferencingRouteId(
  macros: RouteMacroBindingMacro[],
  graph: RouteMacroBindingGraph,
  routeId: number,
): RouteMacroBindingMacro[] {
  return macros.filter((macro) => (
    getRouteIdsReferencedByRouteMacro(macro, graph).includes(routeId)
  ));
}

export function resolveRouteMacroBinding(
  route: RouteSummaryRow | null | undefined,
  graph: RouteMacroBindingGraph,
  fallbackMacro: RouteMacroBindingMacro | null | undefined,
): RouteMacroBindingMacro | null {
  if (!route) return fallbackMacro || null;
  const macros = graph?.macros || [];
  if (macros.length === 0) return fallbackMacro || null;

  const routeId = normalizePositiveInteger(route.id);
  const expectedManualMacroId = routeId ? `route:${routeId}:model-group` : '';
  const explicitMacro = expectedManualMacroId
    ? macros.find((macro) => macro.id === expectedManualMacroId)
    : null;
  if (explicitMacro) return explicitMacro;

  if (routeId) {
    const byEntryRouteId = macros.find((macro) => getMacroEntryMatch(macro).routeId === routeId);
    if (byEntryRouteId) return byEntryRouteId;

    const referencingMacros = getMacrosReferencingRouteId(macros, graph, routeId);
    if (referencingMacros.length > 0) {
      const routeModelKeys = getRouteModelKeys(route);
      return referencingMacros.find((macro) => macroMatchesRouteModel(macro, routeModelKeys))
        || referencingMacros.find((macro) => macro.ownership === 'auto_generated')
        || null;
    }
  }

  if (isRouteBackendReferences(route.backend)) {
    const sourceRouteIds = new Set(getRouteBackendRouteIds(route.backend));
    const bySourceRouteIds = macros.find((macro) => (
      getRouteIdsReferencedByRouteMacro(macro, graph).some((sourceRouteId) => sourceRouteIds.has(sourceRouteId))
    ));
    if (bySourceRouteIds) return bySourceRouteIds;
  }

  const routeModelKeys = getRouteModelKeys(route);
  return macros.find((macro) => macroMatchesRouteModel(macro, routeModelKeys)) || fallbackMacro || null;
}

export function extractActiveRouteGraphSource(response: unknown): RouteMacroBindingGraph | null {
  if (!isRecord(response)) return null;
  const sourceGraph = isRecord(response.sourceGraph) ? response.sourceGraph : null;
  return sourceGraph && (Array.isArray(sourceGraph.nodes) || Array.isArray(sourceGraph.macros))
    ? {
      nodes: Array.isArray(sourceGraph.nodes) ? sourceGraph.nodes as RouteGraphNode[] : [],
      edges: Array.isArray(sourceGraph.edges) ? sourceGraph.edges as Array<Record<string, unknown>> : [],
      macros: Array.isArray(sourceGraph.macros) ? sourceGraph.macros as RouteMacroBindingMacro[] : [],
    }
    : null;
}
