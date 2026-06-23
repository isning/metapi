import type { RouteRoutingStrategy, RouteSummaryRow } from './types.js';
import type { RouteGraphOwnership } from './routeGraphTypes.js';
import {
  getModelPatternError,
  getRouteBackendRouteIds,
  getRouteDisplayIcon,
  getRouteDisplayName,
  getRouteRequestedModelPattern,
  isRouteBackendReferences,
  normalizeRouteDisplayIconValue,
} from './utils.js';
import { normalizeRouteRoutingStrategyValue } from './routingStrategy.js';

import { tr } from '../../i18n.js';
export type RouteGraphSnapshotNode = {
  id?: number;
  stableId?: string;
  macro?: RouteGraphSnapshotMacro;
  ownership: RouteGraphOwnership;
  visibility: 'public' | 'internal';
  enabled: boolean;
  match: {
    kind?: 'model';
    requestedModelPattern: string;
    displayName?: string | null;
  };
  presentation?: {
    displayName?: string | null;
    displayIcon?: string | null;
  };
  backend:
    | { kind: 'supply' }
    | { kind: 'routes'; routeIds: number[] };
  routingStrategy?: RouteRoutingStrategy;
  modelMapping?: Record<string, string> | null;
};

export type RouteGraphSnapshotMacro = {
  id: string;
  kind: 'candidate_selector';
  enabled: boolean;
  visibility: 'public' | 'internal';
  ownership: Exclude<RouteGraphOwnership, 'derived'>;
  name?: string | null;
  config: {
    surface: {
      entry: {
        kind: 'external';
        visibility: 'public' | 'internal';
        match: {
          kind?: 'model';
          requestedModelPattern: string;
          displayName?: string | null;
        };
      };
      output: 'route';
    };
    policy: {
      strategy: RouteRoutingStrategy;
    };
    groups: Array<{
      id: string;
      label?: string;
      enabled: boolean;
      priority: number;
      input: { kind: 'route_endpoints'; endpointIds: string[] };
      defaults: {
        enabled: boolean;
        weight: number;
        priority: number;
      };
    }>;
    presentation?: {
      displayIcon?: string | null;
    };
  };
};

export type RouteGraphSnapshot = {
  version: 1;
  exportedAt: string;
  scope: 'whole_graph' | 'selected_node';
  nodes: RouteGraphSnapshotNode[];
};

export type RouteGraphNodeDraft = Omit<RouteGraphSnapshotNode, 'id' | 'stableId'> & {
  id?: number;
  stableId?: string;
};

export type RouteGraphEditorForm = {
  match: {
    kind: 'model';
    requestedModelPattern: string;
    displayName: string | null;
  };
  backend:
    | { kind: 'supply' }
    | { kind: 'routes'; routeIds: number[] };
  presentation: {
    displayName: string;
    displayIcon: string;
  };
  routingStrategy: RouteRoutingStrategy;
  visibility: 'public' | 'internal';
  enabled: boolean;
  modelMapping: string;
  advancedOpen: boolean;
  macro?: RouteGraphSnapshotMacro | null;
};

export function routeGraphEditorFormToRoutePayload(form: RouteGraphEditorForm): Record<string, unknown> {
  const displayName = normalizeStringOrNull(form.presentation.displayName) || form.match.displayName || null;
  const displayIcon = normalizeStringOrNull(form.presentation.displayIcon);
  const macro = form.macro && form.backend.kind === 'routes'
    ? normalizeCandidateSelectorMacro(form.macro)
    : null;
  const routeIds = macro ? getCandidateSelectorRouteIds(macro) : (form.backend.kind === 'routes' ? form.backend.routeIds : []);
  return {
    match: {
      kind: 'model',
      requestedModelPattern: macro ? '' : (form.backend.kind === 'routes' ? '' : form.match.requestedModelPattern || ''),
      displayName,
    },
    backend: form.backend.kind === 'routes'
      ? { kind: 'routes', routeIds }
      : { kind: 'supply' },
    macro: macro || undefined,
    presentation: {
      displayName,
      displayIcon: macro?.config.presentation?.displayIcon ?? displayIcon,
    },
    routingStrategy: normalizeRouteRoutingStrategyValue(macro?.config.policy.strategy || form.routingStrategy),
    visibility: macro?.visibility || form.visibility,
    enabled: form.enabled,
    modelMapping: form.modelMapping.trim() ? form.modelMapping.trim() : null,
  };
}

export type RouteGraphValidationResult =
  | { ok: true; node: RouteGraphNodeDraft }
  | { ok: false; message: string };

function parseModelMapping(raw: string | null | undefined): Record<string, string> | null {
  if (!raw || !raw.trim()) return null;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(tr('pages.tokenRoutes.routeGraphSnapshot.modelmapping'));
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new Error(tr('pages.tokenRoutes.routeGraphSnapshot.modelMappingValueMustBeString').replace('{key}', key));
    }
    result[key] = value;
  }
  return result;
}

function parseModelMappingForSnapshot(raw: string | null | undefined): Record<string, string> | null {
  try {
    return parseModelMapping(raw);
  } catch {
    return null;
  }
}

function stringifyModelMapping(value: Record<string, string> | null | undefined): string | null {
  if (!value || Object.keys(value).length === 0) return null;
  return JSON.stringify(value);
}

function normalizeRouteIdArray(value: unknown): number[] {
  const routeIds = (Array.isArray(value) ? value : [])
    .map((routeId) => Number(routeId))
    .filter((routeId) => Number.isFinite(routeId) && routeId > 0)
    .map((routeId) => Math.trunc(routeId));
  return Array.from(new Set(routeIds));
}

function routeEndpointIdFromRouteId(routeId: number): string {
  return `route-endpoint:product:route:${Math.trunc(routeId)}`;
}

function routeIdFromRouteEndpointId(endpointId: unknown): number | null {
  const match = /^route-endpoint:product:route:(\d+)$/.exec(String(endpointId || ''));
  if (!match) return null;
  const routeId = Number(match[1]);
  return Number.isFinite(routeId) && routeId > 0 ? Math.trunc(routeId) : null;
}

function normalizeEndpointIdArray(value: unknown): string[] {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((endpointId) => String(endpointId || '').trim())
    .filter(Boolean)));
}

export function buildCandidateSelectorMacro(input: {
  id?: number;
  stableId?: string;
  displayName: string;
  displayIcon?: string | null;
  visibility: 'public' | 'internal';
  enabled: boolean;
  routingStrategy?: RouteRoutingStrategy | null;
  routeIds: number[];
}): RouteGraphSnapshotMacro {
  const macroId = input.stableId || (input.id ? `route:${input.id}:model-group` : `model-group:${input.displayName}`);
  return {
    id: macroId,
    kind: 'candidate_selector',
    enabled: input.enabled,
    visibility: input.visibility,
    ownership: 'manual',
    name: input.displayName,
    config: {
      surface: {
        entry: {
          kind: 'external',
          visibility: input.visibility,
          match: {
            kind: 'model',
            requestedModelPattern: '',
            displayName: input.displayName,
          },
        },
        output: 'route',
      },
      policy: {
        strategy: normalizeRouteRoutingStrategyValue(input.routingStrategy),
      },
      groups: input.routeIds.map((routeId, index) => ({
        id: `source:${routeId}`,
        label: `Route ${routeId}`,
        enabled: true,
        priority: index,
        input: { kind: 'route_endpoints', endpointIds: [routeEndpointIdFromRouteId(routeId)] },
        defaults: {
          enabled: true,
          weight: 10,
          priority: index,
        },
      })),
      presentation: {
        displayIcon: normalizeRouteDisplayIconValue(input.displayIcon),
      },
    },
  };
}

export function updateCandidateSelectorMacroFromEditor(input: {
  macro?: RouteGraphSnapshotMacro | null;
  id?: number;
  stableId?: string;
  displayName: string;
  displayIcon?: string | null;
  visibility: 'public' | 'internal';
  enabled: boolean;
  routingStrategy?: RouteRoutingStrategy | null;
  routeIds: number[];
}): RouteGraphSnapshotMacro {
  const existing = input.macro ? normalizeCandidateSelectorMacro(input.macro) : null;
  const nextBase = existing || buildCandidateSelectorMacro(input);
  const routeIds = normalizeRouteIdArray(input.routeIds);
  return {
    ...nextBase,
    id: nextBase.id || input.stableId || (input.id ? `route:${input.id}:model-group` : `model-group:${input.displayName}`),
    enabled: input.enabled,
    visibility: input.visibility,
    ownership: nextBase.ownership,
    name: input.displayName,
    config: {
      ...nextBase.config,
      surface: {
        ...nextBase.config.surface,
        entry: {
          ...nextBase.config.surface.entry,
          visibility: input.visibility,
          match: {
            ...nextBase.config.surface.entry.match,
            kind: 'model',
            requestedModelPattern: '',
            displayName: input.displayName,
          },
        },
        output: 'route',
      },
      policy: {
        ...nextBase.config.policy,
        strategy: normalizeRouteRoutingStrategyValue(input.routingStrategy),
      },
      groups: routeIds.map((routeId, index) => {
        const endpointId = routeEndpointIdFromRouteId(routeId);
        const existingGroup = nextBase.config.groups.find((group) => group.input.endpointIds.includes(endpointId));
        return {
          ...(existingGroup || {
            id: `source:${routeId}`,
            label: `Route ${routeId}`,
            enabled: true,
            input: { kind: 'route_endpoints' as const, endpointIds: [endpointId] },
            defaults: { enabled: true, weight: 10, priority: index },
          }),
          priority: index,
          input: { kind: 'route_endpoints' as const, endpointIds: [endpointId] },
          defaults: {
            ...(existingGroup?.defaults || { enabled: true, weight: 10 }),
            priority: index,
          },
        };
      }),
      presentation: {
        ...(nextBase.config.presentation || {}),
        displayIcon: normalizeRouteDisplayIconValue(input.displayIcon),
      },
    },
  };
}

function getCandidateSelectorRouteIds(macro: RouteGraphSnapshotMacro): number[] {
  const pairs: Array<{ priority: number; routeId: number }> = [];
  for (const group of macro.config.groups || []) {
    if (!group.enabled || group.input.kind !== 'route_endpoints') continue;
    for (const endpointId of group.input.endpointIds) {
      const routeId = routeIdFromRouteEndpointId(endpointId);
      if (routeId) pairs.push({ priority: group.priority, routeId });
    }
  }
  return Array.from(new Set(
    pairs
      .sort((left, right) => left.priority === right.priority ? left.routeId - right.routeId : left.priority - right.priority)
      .map((item) => item.routeId),
  ));
}

function normalizeCandidateSelectorMacro(input: unknown): RouteGraphSnapshotMacro | null {
  if (!isRecord(input) || input.kind !== 'candidate_selector') return null;
  const config = isRecord(input.config) ? input.config : {};
  const surface = isRecord(config.surface) ? config.surface : {};
  const entry = isRecord(surface.entry) ? surface.entry : {};
  if (entry.kind !== 'external') return null;
  const match = isRecord(entry.match) ? entry.match : {};
  const displayName = normalizeStringOrNull(match.displayName);
  const groupsRaw = Array.isArray(config.groups) ? config.groups : [];
  const groups = groupsRaw.map((group, index) => {
    const groupRecord = isRecord(group) ? group : {};
    const inputRecord = isRecord(groupRecord.input) ? groupRecord.input : {};
    return {
      id: normalizeStringOrNull(groupRecord.id) || `group:${index}`,
      ...(normalizeStringOrNull(groupRecord.label) ? { label: normalizeStringOrNull(groupRecord.label)! } : {}),
      enabled: groupRecord.enabled !== false,
      priority: Number.isFinite(Number(groupRecord.priority)) ? Math.trunc(Number(groupRecord.priority)) : index,
      input: {
        kind: 'route_endpoints' as const,
        endpointIds: inputRecord.kind === 'route_endpoints'
          ? normalizeEndpointIdArray(inputRecord.endpointIds)
          : [],
      },
      defaults: {
        enabled: isRecord(groupRecord.defaults) ? groupRecord.defaults.enabled !== false : true,
        weight: isRecord(groupRecord.defaults) && Number.isFinite(Number(groupRecord.defaults.weight)) ? Number(groupRecord.defaults.weight) : 10,
        priority: isRecord(groupRecord.defaults) && Number.isFinite(Number(groupRecord.defaults.priority)) ? Math.trunc(Number(groupRecord.defaults.priority)) : index,
      },
    };
  }).filter((group) => group.input.endpointIds.length > 0);
  if (!displayName || groups.length === 0) return null;
  const policy = isRecord(config.policy) ? config.policy : {};
  const presentation = isRecord(config.presentation) ? config.presentation : {};
  return {
    id: normalizeStringOrNull(input.id) || `model-group:${displayName}`,
    kind: 'candidate_selector',
    enabled: input.enabled !== false,
    visibility: normalizeVisibility(input.visibility),
    ownership: normalizeOwnership(input.ownership) === 'derived' ? 'manual' : normalizeOwnership(input.ownership) as Exclude<RouteGraphOwnership, 'derived'>,
    name: normalizeStringOrNull(input.name) || displayName,
    config: {
      surface: {
        entry: {
          kind: 'external',
          visibility: normalizeVisibility(entry.visibility),
          match: {
            kind: 'model',
            requestedModelPattern: '',
            displayName,
          },
        },
        output: 'route',
      },
      policy: {
        strategy: normalizeRouteRoutingStrategyValue(policy.strategy as RouteRoutingStrategy | undefined),
      },
      groups,
      presentation: {
        displayIcon: normalizeStringOrNull(presentation.displayIcon),
      },
    },
  };
}

export function buildRouteGraphNodeFromRoute(route: RouteSummaryRow): RouteGraphSnapshotNode {
  const displayName = getRouteDisplayName(route);
  const requestedModelPattern = getRouteRequestedModelPattern(route);
  const routeIds = isRouteBackendReferences(route.backend) ? getRouteBackendRouteIds(route.backend) : [];
  const visibility = route.visibility === 'internal' ? 'internal' : 'public';
  const macro = routeIds.length > 0 && displayName
    ? buildCandidateSelectorMacro({
      id: route.id,
      stableId: `route:${route.id}:model-group`,
      displayName,
      displayIcon: getRouteDisplayIcon(route),
      visibility,
      enabled: route.enabled,
      routingStrategy: normalizeRouteRoutingStrategyValue(route.routingStrategy),
      routeIds,
    })
    : undefined;
  return {
    id: route.id,
    stableId: `route:${route.id}`,
    ...(macro ? { macro } : {}),
    ownership: route.kind === 'zero_target' || route.readOnly || route.isVirtual ? 'derived' : 'manual',
    visibility,
    enabled: route.enabled,
    match: {
      kind: 'model',
      requestedModelPattern,
      ...(displayName ? { displayName } : {}),
    },
    presentation: {
      displayName,
      displayIcon: normalizeRouteDisplayIconValue(getRouteDisplayIcon(route)),
    },
    backend: isRouteBackendReferences(route.backend)
      ? { kind: 'routes', routeIds }
      : { kind: 'supply' },
    routingStrategy: normalizeRouteRoutingStrategyValue(route.routingStrategy),
    modelMapping: parseModelMappingForSnapshot(route.modelMapping),
  };
}

export function buildRouteGraphSnapshot(
  routes: RouteSummaryRow[],
  scope: RouteGraphSnapshot['scope'] = 'whole_graph',
): RouteGraphSnapshot {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    scope,
    nodes: routes
      .map(buildRouteGraphNodeFromRoute)
      .filter((node) => node.ownership === 'manual'),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOwnership(value: unknown): RouteGraphOwnership {
  if (value === 'manual' || value === 'auto_generated' || value === 'system' || value === 'derived') return value;
  return 'manual';
}

function normalizeVisibility(value: unknown): 'public' | 'internal' {
  return value === 'internal' ? 'internal' : 'public';
}

function normalizeStringOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

export function validateRouteGraphNodeDraft(input: unknown): RouteGraphValidationResult {
  if (!isRecord(input)) return { ok: false, message: tr('pages.tokenRoutes.routeGraphSnapshot.json') };

  const ownership = normalizeOwnership(input.ownership);
  if (ownership !== 'manual') {
    return { ok: false, message: tr('pages.tokenRoutes.routeGraphSnapshot.manualOnlyOwnership').replace('{ownership}', ownership) };
  }

  const match = isRecord(input.match) ? input.match : {};
  const presentation = isRecord(input.presentation) ? input.presentation : {};
  const backendRaw = isRecord(input.backend) ? input.backend : {};
  const macro = normalizeCandidateSelectorMacro(input.macro);
  const displayName = normalizeStringOrNull(presentation.displayName ?? match.displayName);
  const requestedModelPattern = normalizeStringOrNull(match.requestedModelPattern);
  const backendKind = macro || backendRaw.kind === 'routes' ? 'routes' : 'supply';

  if (backendKind === 'routes') {
    const macroDisplayName = macro?.config.surface.entry.match.displayName || null;
    const nextDisplayName = displayName || macroDisplayName;
    if (!nextDisplayName) return { ok: false, message: tr('pages.tokenRoutes.routeGraphSnapshot.modelGroupPresentationDisplaynameMacroConfigSurface') };
    const sourceRouteIds = macro ? getCandidateSelectorRouteIds(macro) : normalizeRouteIdArray(backendRaw.routeIds);
    if (sourceRouteIds.length === 0) return { ok: false, message: tr('pages.tokenRoutes.routeGraphSnapshot.routeBackendRouteid') };
    const nextMacro = macro || buildCandidateSelectorMacro({
      id: typeof input.id === 'number' && Number.isFinite(input.id) ? Math.trunc(input.id) : undefined,
      stableId: normalizeStringOrNull(input.stableId) || undefined,
      displayName: nextDisplayName,
      displayIcon: normalizeStringOrNull(presentation.displayIcon),
      visibility: normalizeVisibility(input.visibility),
      enabled: input.enabled !== false,
      routingStrategy: input.routingStrategy as RouteRoutingStrategy | undefined,
      routeIds: Array.from(new Set(sourceRouteIds)),
    });
    return {
      ok: true,
      node: {
        id: typeof input.id === 'number' && Number.isFinite(input.id) ? Math.trunc(input.id) : undefined,
        stableId: normalizeStringOrNull(input.stableId) || undefined,
        macro: nextMacro,
        ownership,
        visibility: normalizeVisibility(input.visibility),
        enabled: input.enabled !== false,
        match: { kind: 'model', requestedModelPattern: '', displayName: nextDisplayName },
        presentation: {
          displayName: nextDisplayName,
          displayIcon: normalizeStringOrNull(presentation.displayIcon),
        },
        backend: { kind: 'routes', routeIds: Array.from(new Set(sourceRouteIds)) },
        routingStrategy: normalizeRouteRoutingStrategyValue(input.routingStrategy as RouteRoutingStrategy | undefined),
        modelMapping: isRecord(input.modelMapping) ? normalizeModelMappingObject(input.modelMapping) : null,
      },
    };
  }

  if (!requestedModelPattern) return { ok: false, message: tr('pages.tokenRoutes.routeGraphSnapshot.patternMatchRequestedmodelpattern') };
  const patternError = getModelPatternError(requestedModelPattern);
  if (patternError) return { ok: false, message: patternError };
  return {
    ok: true,
    node: {
      id: typeof input.id === 'number' && Number.isFinite(input.id) ? Math.trunc(input.id) : undefined,
      stableId: normalizeStringOrNull(input.stableId) || undefined,
      ownership,
      visibility: normalizeVisibility(input.visibility),
      enabled: input.enabled !== false,
      match: {
        kind: 'model',
        requestedModelPattern,
        ...(displayName ? { displayName } : {}),
      },
      presentation: {
        displayName,
        displayIcon: normalizeStringOrNull(presentation.displayIcon),
      },
      backend: { kind: 'supply' },
      routingStrategy: normalizeRouteRoutingStrategyValue(input.routingStrategy as RouteRoutingStrategy | undefined),
      modelMapping: isRecord(input.modelMapping) ? normalizeModelMappingObject(input.modelMapping) : null,
    },
  };
}

function normalizeModelMappingObject(value: Record<string, unknown>): Record<string, string> | null {
  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const normalizedKey = key.trim();
    const normalizedValue = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!normalizedKey || !normalizedValue) continue;
    result[normalizedKey] = normalizedValue;
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function validateRouteGraphSnapshot(input: unknown): { ok: true; snapshot: RouteGraphSnapshot } | { ok: false; message: string } {
  if (!isRecord(input)) return { ok: false, message: tr('pages.tokenRoutes.routeGraphSnapshot.importcontent') };
  if (input.version !== 1) return { ok: false, message: tr('pages.tokenRoutes.routeGraphSnapshot.supportedVersion1Routegraphsnapshot') };
  if (!Array.isArray(input.nodes)) return { ok: false, message: tr('pages.tokenRoutes.routeGraphSnapshot.routegraphsnapshotNodes') };

  const nodes: RouteGraphSnapshotNode[] = [];
  for (let index = 0; index < input.nodes.length; index += 1) {
    const parsed = validateRouteGraphNodeDraft(input.nodes[index]);
    if (!parsed.ok) return { ok: false, message: `nodes[${index}]: ${parsed.message}` };
    nodes.push(parsed.node);
  }

  return {
    ok: true,
    snapshot: {
      version: 1,
      exportedAt: normalizeStringOrNull(input.exportedAt) || new Date().toISOString(),
      scope: input.scope === 'selected_node' ? 'selected_node' : 'whole_graph',
      nodes,
    },
  };
}

export function routeGraphNodeToRoutePayload(node: RouteGraphNodeDraft): Record<string, unknown> {
  const displayName = normalizeStringOrNull(node.presentation?.displayName ?? node.match.displayName);
  const displayIcon = normalizeStringOrNull(node.presentation?.displayIcon);
  const macro = node.macro && node.backend.kind === 'routes'
    ? normalizeCandidateSelectorMacro(node.macro)
    : null;
  const routeIds = macro ? getCandidateSelectorRouteIds(macro) : (node.backend.kind === 'routes' ? node.backend.routeIds : []);
  return {
    match: {
      kind: 'model',
      requestedModelPattern: node.backend.kind === 'routes' ? '' : node.match.requestedModelPattern || '',
      displayName: macro?.config.surface.entry.match.displayName || displayName,
    },
    backend: node.backend.kind === 'routes'
      ? { kind: 'routes', routeIds }
      : node.backend,
    ...(macro ? { macro } : {}),
    presentation: {
      displayName: macro?.config.surface.entry.match.displayName || displayName,
      displayIcon: macro?.config.presentation?.displayIcon ?? displayIcon,
    },
    enabled: node.enabled !== false,
    routingStrategy: normalizeRouteRoutingStrategyValue(macro?.config.policy.strategy || node.routingStrategy),
    modelMapping: stringifyModelMapping(node.modelMapping),
  };
}

export function routeGraphNodeToEditorForm(node: RouteGraphNodeDraft): RouteGraphEditorForm {
  const macro = node.macro && node.backend.kind === 'routes'
    ? normalizeCandidateSelectorMacro(node.macro)
    : null;
  const displayName = macro?.config.surface.entry.match.displayName || node.presentation?.displayName || node.match.displayName || '';
  const routeIds = macro ? getCandidateSelectorRouteIds(macro) : (node.backend.kind === 'routes' ? node.backend.routeIds : []);
  return {
    match: {
      kind: 'model',
      requestedModelPattern: node.match.requestedModelPattern || '',
      displayName: displayName || null,
    },
    backend: node.backend.kind === 'routes'
      ? { kind: 'routes' as const, routeIds: [...routeIds] }
      : { kind: 'supply' as const },
    presentation: {
      displayName,
      displayIcon: normalizeRouteDisplayIconValue(macro?.config.presentation?.displayIcon ?? node.presentation?.displayIcon),
    },
    routingStrategy: normalizeRouteRoutingStrategyValue(macro?.config.policy.strategy || node.routingStrategy),
    visibility: macro?.visibility || node.visibility,
    enabled: node.enabled !== false,
    modelMapping: stringifyModelMapping(node.modelMapping) || '',
    advancedOpen: node.backend.kind === 'supply',
    macro: macro || node.macro || null,
  };
}

export function stringifyRouteGraphJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
