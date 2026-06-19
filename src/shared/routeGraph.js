import { normalizeTokenRouteMode } from './tokenRouteContract.js';
import {
  isExactTokenRouteModelPattern,
  matchesTokenRouteModelPattern,
} from './tokenRoutePatterns.js';

export const ROUTE_GRAPH_SCHEMA_VERSION = 1;
export const ROUTE_GRAPH_MATCH_KIND_MODEL = 'model';
export const ROUTE_GRAPH_BACKEND_KIND_CHANNELS = 'channels';
export const ROUTE_GRAPH_BACKEND_KIND_ROUTES = 'routes';
export const ROUTE_GRAPH_NODE_TYPES = Object.freeze([
  'entry',
  'filter',
  'dispatcher',
  'model_endpoint',
  'synthetic_endpoint',
  'auto_node',
]);
export const ROUTE_GRAPH_TERMINAL_NODE_TYPES = Object.freeze(['model_endpoint', 'synthetic_endpoint', 'auto_node']);
export const ROUTE_GRAPH_SELECTION_STRATEGIES = Object.freeze([
  'priority_order',
  'weighted',
  'round_robin',
  'stable_first',
]);
export const ROUTE_GRAPH_VISIBILITIES = Object.freeze(['public', 'internal']);
export const ROUTE_GRAPH_OWNERSHIPS = Object.freeze(['manual', 'auto_generated', 'system', 'derived']);
export const ROUTE_GRAPH_PORT_KINDS = Object.freeze([
  'request',
  'bidirect',
  'route',
  'response',
  'control',
  'metrics',
]);
export const ROUTE_GRAPH_EDGE_KINDS = Object.freeze([
  'request_flow',
  'bidirect_flow',
  'route_flow',
  'response_flow',
  'control_flow',
  'metrics_link',
]);
export const ROUTE_GRAPH_MACRO_KINDS = Object.freeze(['candidate_selector']);
export const ROUTE_GRAPH_CANDIDATE_SELECTOR_INPUT_KINDS = Object.freeze([
  'route_ids',
  'model_pattern',
  'metadata_query',
  'endpoint_query',
  'inline_endpoints',
  'synthetic',
]);
export const ROUTE_GRAPH_CANDIDATE_SELECTOR_STRATEGIES = Object.freeze([
  'priority_order',
  'weighted',
  'round_robin',
  'stable_first',
  'cel_select',
  'cel_score',
]);

function buildCandidateSelectorDefaultSurfacePorts(surface) {
  const entryKind = surface?.entry?.kind === 'embedded' ? 'embedded' : 'external';
  const inputKind = entryKind === 'embedded'
    ? normalizeEnum(surface.entry?.input, ['request', 'bidirect'], 'bidirect')
    : 'bidirect';
  const outputKind = normalizeEnum(surface?.output, ['route', 'bidirect'], 'route');
  const inputPortId = inputKind === 'request' ? 'request.in' : 'bidirect.in';
  const outputPortId = outputKind === 'bidirect' ? 'bidirect.out' : 'route.out';
  return [
    {
      id: inputPortId,
      label: inputKind === 'request' ? 'request input' : 'incoming flow',
      direction: 'input',
      kind: inputKind,
      accepts: [inputKind],
      multiple: true,
    },
    {
      id: outputPortId,
      label: outputKind === 'bidirect' ? 'selected flow' : 'candidate targets',
      direction: 'output',
      kind: outputKind,
      multiple: true,
      collection: outputKind === 'bidirect'
        ? { type: 'arr', min: 1 }
        : { type: 'set', min: 1 },
    },
  ];
}

const ROUTE_GRAPH_EDGE_KIND_BY_PORT_KIND = Object.freeze({
  request: 'request_flow',
  bidirect: 'bidirect_flow',
  route: 'route_flow',
  response: 'response_flow',
  control: 'control_flow',
  metrics: 'metrics_link',
});

const ROUTE_GRAPH_DEFAULT_PORTS = Object.freeze({
  entry: [
    { id: 'bidirect.in', label: 'reuse input', direction: 'input', kind: 'bidirect', accepts: ['bidirect'] },
    { id: 'bidirect.out', label: 'matched flow', direction: 'output', kind: 'bidirect' },
  ],
  filter: [
    { id: 'request.in', label: 'before mutation', direction: 'input', kind: 'request', accepts: ['request'] },
    { id: 'request.out', label: 'after mutation', direction: 'output', kind: 'request' },
    { id: 'bidirect.in', label: 'before round trip', direction: 'input', kind: 'bidirect', accepts: ['bidirect'] },
    { id: 'bidirect.out', label: 'after round trip', direction: 'output', kind: 'bidirect' },
  ],
  dispatcher: [
    { id: 'bidirect.in', label: 'dispatch input', direction: 'input', kind: 'bidirect', accepts: ['bidirect'], required: true },
    { id: 'bidirect[1...].out', label: 'dispatch path', direction: 'output', kind: 'bidirect', multiple: true, collection: { type: 'arr', min: 1 } },
    { id: 'route.in', label: 'endpoint candidates', direction: 'input', kind: 'route', accepts: ['route'], multiple: true, collection: { type: 'set', min: 1 } },
  ],
  model_endpoint: [
    { id: 'route.out', label: 'endpoint target', direction: 'output', kind: 'route' },
    { id: 'bidirect.in', label: 'invoke endpoint', direction: 'input', kind: 'bidirect', accepts: ['bidirect'], multiple: true },
  ],
  synthetic_endpoint: [
    { id: 'route.out', label: 'synthetic target', direction: 'output', kind: 'route' },
    { id: 'bidirect.in', label: 'return response', direction: 'input', kind: 'bidirect', accepts: ['bidirect'], multiple: true },
  ],
  auto_node: [
    { id: 'route.in', label: 'candidate targets', direction: 'input', kind: 'route', accepts: ['route'], multiple: true, collection: { type: 'set' } },
    { id: 'bidirect.in', label: 'route input', direction: 'input', kind: 'bidirect', accepts: ['bidirect'] },
    { id: 'bidirect.out', label: 'selected path', direction: 'output', kind: 'bidirect' },
  ],
});

function isPlainObject(input) {
  return !!input && typeof input === 'object' && !Array.isArray(input);
}

function normalizeString(input, fallback = '') {
  return typeof input === 'string' ? input.trim() : fallback;
}

function normalizeNullableString(input) {
  const value = normalizeString(input);
  return value ? value : null;
}

function normalizeBoolean(input, fallback = true) {
  return typeof input === 'boolean' ? input : fallback;
}

function normalizePositiveInteger(input) {
  const value = Number(input);
  if (!Number.isFinite(value)) return null;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : null;
}

function normalizeEnum(input, allowed, fallback) {
  return allowed.includes(input) ? input : fallback;
}

function stableJson(value) {
  return JSON.stringify(value, Object.keys(value || {}).sort());
}

function normalizeRouteGraphPort(input) {
  const raw = isPlainObject(input) ? input : {};
  const kind = normalizeEnum(raw.kind, ROUTE_GRAPH_PORT_KINDS, 'request');
  const direction = raw.direction === 'output' ? 'output' : 'input';
  const accepts = Array.isArray(raw.accepts)
    ? raw.accepts.filter((item) => ROUTE_GRAPH_PORT_KINDS.includes(item))
    : undefined;
  const collection = isPlainObject(raw.collection)
    ? {
      type: normalizeEnum(raw.collection.type, ['single', 'arr', 'set'], 'single'),
      ...(normalizePositiveInteger(raw.collection.min) ? { min: normalizePositiveInteger(raw.collection.min) } : {}),
      ...(normalizePositiveInteger(raw.collection.max) ? { max: normalizePositiveInteger(raw.collection.max) } : {}),
    }
    : undefined;
  return {
    id: normalizeString(raw.id),
    label: normalizeString(raw.label) || normalizeString(raw.id) || kind,
    direction,
    kind,
    ...(accepts && accepts.length > 0 ? { accepts: Array.from(new Set(accepts)) } : {}),
    ...(raw.required === true ? { required: true } : {}),
    ...(raw.multiple === true ? { multiple: true } : {}),
    ...(collection ? { collection } : {}),
    ...(raw.readonly === true ? { readonly: true } : {}),
    ...(raw.enabled === false ? { enabled: false } : {}),
    ...(normalizeString(raw.description) ? { description: normalizeString(raw.description) } : {}),
  };
}

export function getRouteGraphNodePorts(nodeInput) {
  const node = isPlainObject(nodeInput) ? nodeInput : {};
  const basePorts = ROUTE_GRAPH_DEFAULT_PORTS[node.type] || [];
  const dynamicPorts = Array.isArray(node.dynamicPorts)
    ? node.dynamicPorts.map(normalizeRouteGraphPort).filter((port) => port.id)
    : [];
  const portsById = new Map();
  for (const port of [...basePorts, ...dynamicPorts]) {
    portsById.set(port.id, normalizeRouteGraphPort(port));
  }
  return Array.from(portsById.values()).map((port) => {
    if (node.type !== 'dispatcher') return { ...port, enabled: port.enabled !== false };
    if (port.id === 'route.in') return { ...port, enabled: node.mode !== 'flow' };
    if (port.id === 'bidirect[1...].out') return { ...port, enabled: node.mode === 'flow' };
    return { ...port, enabled: port.enabled !== false };
  });
}

export function getRouteGraphNodePort(nodeInput, portId) {
  const id = normalizeString(portId);
  return getRouteGraphNodePorts(nodeInput).find((port) => port.id === id) || null;
}

export function getRouteGraphMacroPorts(macroInput) {
  const macro = isPlainObject(macroInput) ? macroInput : {};
  const config = isPlainObject(macro.config) ? macro.config : {};
  const normalizedConfig = macro.kind === 'candidate_selector'
    ? normalizeCandidateSelectorConfig(config)
    : { surface: { ports: [] } };
  return Array.isArray(normalizedConfig.surface?.ports)
    ? normalizedConfig.surface.ports.map(normalizeRouteGraphPort).filter((port) => port.id)
    : [];
}

export function getRouteGraphMacroPort(macroInput, portId) {
  const id = normalizeString(portId);
  return getRouteGraphMacroPorts(macroInput).find((port) => port.id === id) || null;
}

function inferEdgeKindFromPorts(sourcePort, targetPort) {
  const sourceKind = sourcePort?.kind || targetPort?.kind || 'request';
  return ROUTE_GRAPH_EDGE_KIND_BY_PORT_KIND[sourceKind] || 'request_flow';
}

export function normalizeRouteGraphMatchSpec(input) {
  const raw = isPlainObject(input) ? input : {};
  return {
    kind: ROUTE_GRAPH_MATCH_KIND_MODEL,
    requestedModelPattern: normalizeString(raw.requestedModelPattern),
    currentModelPattern: normalizeString(raw.currentModelPattern),
    displayName: normalizeNullableString(raw.displayName),
    downstreamProtocol: normalizeNullableString(raw.downstreamProtocol),
    upstreamProtocol: normalizeNullableString(raw.upstreamProtocol),
    sitePlatform: normalizeNullableString(raw.sitePlatform),
    routeId: normalizePositiveInteger(raw.routeId),
    accountId: normalizePositiveInteger(raw.accountId),
    tokenId: normalizePositiveInteger(raw.tokenId),
    siteId: normalizePositiveInteger(raw.siteId),
  };
}

export function normalizeRouteGraphBackendSpec(input) {
  const raw = isPlainObject(input) ? input : {};
  if (raw.kind === ROUTE_GRAPH_BACKEND_KIND_ROUTES) {
    const routeIds = Array.isArray(raw.routeIds)
      ? raw.routeIds
        .map(normalizePositiveInteger)
        .filter((value) => value !== null)
      : [];
    return {
      kind: ROUTE_GRAPH_BACKEND_KIND_ROUTES,
      routeIds: Array.from(new Set(routeIds)),
    };
  }
  return { kind: ROUTE_GRAPH_BACKEND_KIND_CHANNELS };
}

export function parseRouteGraphMatchSpec(raw) {
  if (!raw || typeof raw !== 'string') return normalizeRouteGraphMatchSpec(null);
  try {
    return normalizeRouteGraphMatchSpec(JSON.parse(raw));
  } catch {
    return normalizeRouteGraphMatchSpec(null);
  }
}

export function parseRouteGraphBackendSpec(raw) {
  if (!raw || typeof raw !== 'string') return normalizeRouteGraphBackendSpec(null);
  try {
    return normalizeRouteGraphBackendSpec(JSON.parse(raw));
  } catch {
    return normalizeRouteGraphBackendSpec(null);
  }
}

export function stringifyRouteGraphMatchSpec(spec) {
  return JSON.stringify(normalizeRouteGraphMatchSpec(spec));
}

export function stringifyRouteGraphBackendSpec(spec) {
  return JSON.stringify(normalizeRouteGraphBackendSpec(spec));
}

export function buildRouteGraphSpecsFromLegacyRoute(input) {
  const routeMode = normalizeTokenRouteMode(input?.routeMode);
  const displayName = normalizeNullableString(input?.displayName);
  const modelPattern = normalizeString(input?.modelPattern);
  if (routeMode === 'explicit_group') {
    const sourceRouteIds = Array.isArray(input?.sourceRouteIds) ? input.sourceRouteIds : [];
    return {
      matchSpec: normalizeRouteGraphMatchSpec({
        requestedModelPattern: '',
        displayName: displayName || modelPattern,
      }),
      backendSpec: normalizeRouteGraphBackendSpec({
        kind: ROUTE_GRAPH_BACKEND_KIND_ROUTES,
        routeIds: sourceRouteIds,
      }),
    };
  }
  return {
    matchSpec: normalizeRouteGraphMatchSpec({
      requestedModelPattern: modelPattern,
      displayName,
    }),
    backendSpec: normalizeRouteGraphBackendSpec({
      kind: ROUTE_GRAPH_BACKEND_KIND_CHANNELS,
    }),
  };
}

export function deriveLegacyRouteModeFromBackendSpec(backendSpec) {
  return normalizeRouteGraphBackendSpec(backendSpec).kind === ROUTE_GRAPH_BACKEND_KIND_ROUTES
    ? 'explicit_group'
    : 'pattern';
}

export function deriveLegacyModelPatternFromSpecs(matchSpec, backendSpec) {
  const normalizedMatch = normalizeRouteGraphMatchSpec(matchSpec);
  const normalizedBackend = normalizeRouteGraphBackendSpec(backendSpec);
  if (normalizedBackend.kind === ROUTE_GRAPH_BACKEND_KIND_ROUTES) {
    return normalizedMatch.displayName || normalizedMatch.requestedModelPattern || '';
  }
  return normalizedMatch.requestedModelPattern || normalizedMatch.displayName || '';
}

export function deriveLegacySourceRouteIdsFromBackendSpec(backendSpec) {
  const normalized = normalizeRouteGraphBackendSpec(backendSpec);
  return normalized.kind === ROUTE_GRAPH_BACKEND_KIND_ROUTES ? normalized.routeIds : [];
}

export function getRouteGraphExposedModelName(matchSpec, backendSpec) {
  const normalizedMatch = normalizeRouteGraphMatchSpec(matchSpec);
  return normalizedMatch.displayName || deriveLegacyModelPatternFromSpecs(normalizedMatch, backendSpec);
}

export function isRouteGraphExactModelMatch(matchSpec, backendSpec) {
  const normalizedBackend = normalizeRouteGraphBackendSpec(backendSpec);
  if (normalizedBackend.kind !== ROUTE_GRAPH_BACKEND_KIND_CHANNELS) return false;
  const normalizedMatch = normalizeRouteGraphMatchSpec(matchSpec);
  return isExactTokenRouteModelPattern(normalizedMatch.requestedModelPattern);
}

export function routeGraphMatchesRequestedModel(model, matchSpec, backendSpec) {
  const normalizedMatch = normalizeRouteGraphMatchSpec(matchSpec);
  const normalizedBackend = normalizeRouteGraphBackendSpec(backendSpec);
  const displayName = normalizedMatch.displayName || '';
  if (displayName && displayName === model) return true;
  if (normalizedBackend.kind === ROUTE_GRAPH_BACKEND_KIND_ROUTES) return false;
  return matchesTokenRouteModelPattern(model, normalizedMatch.requestedModelPattern);
}

export function legacyRouteIdToRouteGraphEntryNodeId(routeId) {
  return `entry:legacy:${Number(routeId)}`;
}

export function legacyRouteIdToRouteGraphPoolNodeId(routeId) {
  return `pool:legacy:${Number(routeId)}`;
}

function normalizeRouteGraphNodeBase(raw, fallbackType = 'entry') {
  return {
    id: normalizeString(raw.id),
    type: normalizeEnum(raw.type, ROUTE_GRAPH_NODE_TYPES, fallbackType),
    name: normalizeNullableString(raw.name),
    enabled: normalizeBoolean(raw.enabled, true),
    visibility: normalizeEnum(raw.visibility, ROUTE_GRAPH_VISIBILITIES, 'internal'),
    ownership: normalizeEnum(raw.ownership, ROUTE_GRAPH_OWNERSHIPS, 'manual'),
    position: isPlainObject(raw.position)
      ? {
        x: Number.isFinite(Number(raw.position.x)) ? Number(raw.position.x) : 0,
        y: Number.isFinite(Number(raw.position.y)) ? Number(raw.position.y) : 0,
      }
      : undefined,
    provenance: isPlainObject(raw.provenance) ? raw.provenance : { source: 'manual' },
    dynamicPorts: Array.isArray(raw.dynamicPorts)
      ? raw.dynamicPorts.map(normalizeRouteGraphPort).filter((port) => port.id)
      : undefined,
  };
}

function normalizeRouteFilter(input) {
  const raw = isPlainObject(input) ? input : {};
  if (raw.type === 'rewrite_model') {
    return {
      type: 'rewrite_model',
      source: raw.source === 'upstream_model' ? 'upstream_model' : 'current_model',
      operation: raw.operation === 'set' ? 'set' : 'strip_suffix',
      suffix: normalizeString(raw.suffix),
      value: normalizeString(raw.value),
    };
  }
  if (raw.type === 'remove_payload') {
    return { type: 'remove_payload', path: normalizeString(raw.path) };
  }
  if (raw.type === 'set_header') {
    return {
      type: 'set_header',
      name: normalizeString(raw.name),
      value: normalizeString(raw.value),
      mode: raw.mode === 'override' ? 'override' : 'default',
    };
  }
  if (raw.type === 'remove_header') {
    return { type: 'remove_header', name: normalizeString(raw.name) };
  }
  if (raw.type === 'set_endpoint_preference') {
    return {
      type: 'set_endpoint_preference',
      endpoint: normalizeEnum(raw.endpoint, ['chat', 'messages', 'responses'], 'chat'),
    };
  }
  return {
    type: 'set_payload',
    path: normalizeString(raw.path),
    value: raw.value,
    mode: raw.mode === 'override' ? 'override' : 'default',
  };
}

function normalizeModelEndpointTarget(input) {
  const raw = isPlainObject(input) ? input : {};
  const channelId = normalizeString(raw.channelId || raw.id);
  const model = normalizeString(raw.model || raw.sourceModel);
  const modelSource = normalizeEnum(raw.modelSource, ['fixed', 'request'], model ? 'fixed' : 'request');
  const tokenId = normalizePositiveInteger(raw.tokenId);
  const accountId = normalizePositiveInteger(raw.accountId);
  const siteId = normalizePositiveInteger(raw.siteId);
  return {
    channelId,
    model,
    modelSource,
    ...(raw.enabled === false ? { enabled: false } : {}),
    ...(tokenId ? { tokenId } : {}),
    ...(accountId ? { accountId } : {}),
    ...(siteId ? { siteId } : {}),
    ...(Number.isFinite(Number(raw.weight)) ? { weight: Number(raw.weight) } : {}),
    ...(Number.isFinite(Number(raw.priority)) ? { priority: Number(raw.priority) } : {}),
    ...(isPlainObject(raw.metadata) ? { metadata: raw.metadata } : {}),
    ...(isPlainObject(raw.compatibilityPolicy) ? { compatibilityPolicy: raw.compatibilityPolicy } : {}),
  };
}

function normalizeModelEndpointConfig(input) {
  const raw = isPlainObject(input) ? input : {};
  const targets = Array.isArray(raw.targets)
    ? raw.targets.map(normalizeModelEndpointTarget).filter((target) => target.channelId && (target.model || target.modelSource === 'request'))
    : [];
  return {
    ...raw,
    targets,
    targetSelection: isPlainObject(raw.targetSelection) ? raw.targetSelection : { strategy: 'weighted' },
  };
}

export function normalizeRouteGraphNode(input) {
  const raw = isPlainObject(input) ? input : {};
  const type = normalizeEnum(raw.type, ROUTE_GRAPH_NODE_TYPES, 'entry');
  const base = normalizeRouteGraphNodeBase({ ...raw, type }, type);
  if (type === 'entry') {
    return {
      ...base,
      type,
      visibility: normalizeEnum(raw.visibility, ROUTE_GRAPH_VISIBILITIES, 'public'),
      match: normalizeRouteGraphMatchSpec(raw.match),
      selectionStrategy: normalizeEnum(raw.selectionStrategy, ROUTE_GRAPH_SELECTION_STRATEGIES, 'weighted'),
    };
  }
  if (type === 'filter') {
    return {
      ...base,
      type,
      operations: Array.isArray(raw.operations) ? raw.operations.map(normalizeRouteFilter) : [],
    };
  }
  if (type === 'dispatcher') {
    const mode = raw.mode === 'flow' ? 'flow' : 'route';
    return {
      ...base,
      type,
      mode,
      ordering: normalizeEnum(raw.ordering, ['explicit'], 'explicit'),
      policy: isPlainObject(raw.policy) ? raw.policy : { strategy: 'weighted' },
    };
  }
  if (type === 'model_endpoint') {
    return {
      ...base,
      type,
      routeNodeId: normalizeString(raw.routeNodeId),
      legacyRouteId: normalizePositiveInteger(raw.legacyRouteId),
      metadata: isPlainObject(raw.metadata) ? raw.metadata : {},
      compatibilityPolicy: isPlainObject(raw.compatibilityPolicy) ? raw.compatibilityPolicy : undefined,
      config: normalizeModelEndpointConfig(raw.config),
    };
  }
  if (type === 'synthetic_endpoint') {
    return {
      ...base,
      type,
      statusCode: normalizeEnum(Number(raw.statusCode), [400, 401, 403, 404, 409, 429, 500, 502, 503], 503),
      message: normalizeString(raw.message, 'No route is available.'),
      headers: isPlainObject(raw.headers) ? raw.headers : undefined,
      body: raw.body,
    };
  }
  if (type === 'auto_node') {
    return {
      ...base,
      type,
      routeNodeId: normalizeString(raw.routeNodeId || raw.id),
      routingStrategy: normalizeEnum(raw.routingStrategy, ['weighted', 'round_robin', 'stable_first'], 'weighted'),
      legacyRouteId: normalizePositiveInteger(raw.legacyRouteId),
    };
  }
  return {
    ...base,
    type: 'entry',
    match: normalizeRouteGraphMatchSpec(raw.match),
    selectionStrategy: normalizeEnum(raw.selectionStrategy, ROUTE_GRAPH_SELECTION_STRATEGIES, 'weighted'),
  };
}

export function normalizeRouteGraphEdge(input) {
  const raw = isPlainObject(input) ? input : {};
  const sourceNodeId = normalizeString(raw.sourceNodeId);
  const targetNodeId = normalizeString(raw.targetNodeId);
  const sourcePortId = normalizeString(raw.sourcePortId);
  const targetPortId = normalizeString(raw.targetPortId);
  return {
    id: normalizeString(raw.id) || `edge:${sourceNodeId}:${sourcePortId}:${targetNodeId}:${targetPortId}`,
    sourceNodeId,
    sourcePortId,
    targetNodeId,
    targetPortId,
    kind: normalizeEnum(raw.kind, ROUTE_GRAPH_EDGE_KINDS, 'request_flow'),
    ownership: normalizeEnum(raw.ownership, ROUTE_GRAPH_OWNERSHIPS, 'manual'),
    ...(isPlainObject(raw.metadata) ? { metadata: raw.metadata } : {}),
  };
}

function normalizeCandidateSelectorInput(input) {
  const raw = isPlainObject(input) ? input : {};
  const kind = normalizeEnum(raw.kind, ROUTE_GRAPH_CANDIDATE_SELECTOR_INPUT_KINDS, 'route_ids');
  if (kind === 'route_ids') {
    const routeIds = Array.isArray(raw.routeIds)
      ? raw.routeIds.map(normalizePositiveInteger).filter((value) => value !== null)
      : [];
    return { kind, routeIds: Array.from(new Set(routeIds)) };
  }
  if (kind === 'model_pattern') {
    return { kind, pattern: normalizeString(raw.pattern) };
  }
  if (kind === 'metadata_query' || kind === 'endpoint_query') {
    return { kind, cel: normalizeString(raw.cel) };
  }
  if (kind === 'inline_endpoints') {
    const endpoints = Array.isArray(raw.endpoints)
      ? raw.endpoints.map(normalizeModelEndpointTarget).filter((target) => target.channelId && (target.model || target.modelSource === 'request'))
      : [];
    return { kind, endpoints };
  }
  if (kind === 'synthetic') {
    return {
      kind,
      statusCode: normalizeEnum(Number(raw.statusCode), [400, 401, 403, 404, 409, 429, 500, 502, 503], 503),
      message: normalizeString(raw.message, 'No route is available.'),
    };
  }
  return { kind: 'route_ids', routeIds: [] };
}

function normalizeMacroSurfacePort(input) {
  const raw = isPlainObject(input) ? input : {};
  const kind = normalizeEnum(raw.kind, ROUTE_GRAPH_PORT_KINDS, 'request');
  return normalizeRouteGraphPort({
    id: normalizeString(raw.id),
    label: normalizeString(raw.label) || normalizeString(raw.id) || kind,
    direction: raw.direction === 'output' ? 'output' : 'input',
    kind,
    ...(Array.isArray(raw.accepts) ? { accepts: raw.accepts } : {}),
    ...(raw.required === true ? { required: true } : {}),
    ...(raw.multiple === true ? { multiple: true } : {}),
    ...(isPlainObject(raw.collection) ? { collection: raw.collection } : {}),
    ...(raw.readonly === true ? { readonly: true } : {}),
    ...(raw.enabled === false ? { enabled: false } : {}),
    ...(normalizeString(raw.description) ? { description: normalizeString(raw.description) } : {}),
  });
}

function normalizeCandidateSelectorGroup(input, index) {
  const raw = isPlainObject(input) ? input : {};
  const priority = Number.isFinite(Number(raw.priority)) ? Math.trunc(Number(raw.priority)) : index;
  const defaults = isPlainObject(raw.defaults) ? raw.defaults : {};
  const materialization = isPlainObject(raw.materialization) ? raw.materialization : {};
  return {
    id: normalizeString(raw.id) || `group:${index}`,
    ...(normalizeString(raw.label) ? { label: normalizeString(raw.label) } : {}),
    enabled: normalizeBoolean(raw.enabled, true),
    priority,
    input: normalizeCandidateSelectorInput(raw.input),
    defaults: {
      ...(defaults.enabled === false ? { enabled: false } : {}),
      ...(Number.isFinite(Number(defaults.weight)) ? { weight: Number(defaults.weight) } : {}),
      ...(Number.isFinite(Number(defaults.priority)) ? { priority: Math.trunc(Number(defaults.priority)) } : {}),
      ...(isPlainObject(defaults.metadata) ? { metadata: defaults.metadata } : {}),
    },
    ...(isPlainObject(raw.materialization) ? {
      materialization: {
        ...(normalizeEnum(materialization.sort, ['route_id', 'model_name', 'health', 'cel'], null) ? { sort: materialization.sort } : {}),
        ...(normalizePositiveInteger(materialization.limit) ? { limit: normalizePositiveInteger(materialization.limit) } : {}),
        ...(normalizeEnum(materialization.dedupeBy, ['route_id', 'endpoint_id', 'model', 'metadata'], null) ? { dedupeBy: materialization.dedupeBy } : {}),
      },
    } : {}),
    ...(isPlainObject(raw.metadata) ? { metadata: raw.metadata } : {}),
  };
}

function normalizeCandidateSelectorConfig(input) {
  const raw = isPlainObject(input) ? input : {};
  const rawSurface = isPlainObject(raw.surface) ? raw.surface : {};
  const rawEntry = isPlainObject(rawSurface.entry) ? rawSurface.entry : {};
  const entry = rawEntry.kind === 'embedded'
    ? {
      kind: 'embedded',
      input: normalizeEnum(rawEntry.input, ['request', 'bidirect'], 'bidirect'),
    }
    : {
      kind: 'external',
      visibility: normalizeEnum(rawEntry.visibility, ROUTE_GRAPH_VISIBILITIES, 'public'),
      match: normalizeRouteGraphMatchSpec(rawEntry.match),
    };
  const rawPolicy = isPlainObject(raw.policy) ? raw.policy : {};
  const rawSurfacePorts = Array.isArray(rawSurface.ports) ? rawSurface.ports.map(normalizeMacroSurfacePort).filter((port) => port.id) : [];
  const defaultSurfacePorts = buildCandidateSelectorDefaultSurfacePorts({
    entry,
    output: normalizeEnum(rawSurface.output, ['route', 'bidirect'], 'route'),
  });
  const groups = Array.isArray(raw.groups)
    ? raw.groups.map((group, index) => normalizeCandidateSelectorGroup(group, index))
    : [];
  return {
    surface: {
      entry,
      output: normalizeEnum(rawSurface.output, ['route', 'bidirect'], 'route'),
      ports: rawSurfacePorts.length > 0 ? rawSurfacePorts : defaultSurfacePorts.map((port) => normalizeMacroSurfacePort(port)),
    },
    policy: {
      strategy: normalizeEnum(rawPolicy.strategy, ROUTE_GRAPH_CANDIDATE_SELECTOR_STRATEGIES, 'priority_order'),
      ...(normalizeString(rawPolicy.cel) ? { cel: normalizeString(rawPolicy.cel) } : {}),
    },
    groups,
    ...(isPlainObject(raw.presentation) ? {
      presentation: {
        ...(normalizeNullableString(raw.presentation.displayIcon) ? { displayIcon: normalizeNullableString(raw.presentation.displayIcon) } : {}),
      },
    } : {}),
  };
}

export function normalizeRouteGraphMacro(input) {
  const raw = isPlainObject(input) ? input : {};
  const kind = normalizeEnum(raw.kind, ROUTE_GRAPH_MACRO_KINDS, 'candidate_selector');
  return {
    id: normalizeString(raw.id),
    kind,
    enabled: normalizeBoolean(raw.enabled, true),
    visibility: normalizeEnum(raw.visibility, ROUTE_GRAPH_VISIBILITIES, 'internal'),
    ownership: normalizeEnum(raw.ownership, ROUTE_GRAPH_OWNERSHIPS.filter((item) => item !== 'derived'), 'manual'),
    ...(normalizeNullableString(raw.name) ? { name: normalizeNullableString(raw.name) } : {}),
    config: kind === 'candidate_selector' ? normalizeCandidateSelectorConfig(raw.config) : {},
    position: isPlainObject(raw.position)
      ? {
        x: Number.isFinite(Number(raw.position.x)) ? Number(raw.position.x) : 0,
        y: Number.isFinite(Number(raw.position.y)) ? Number(raw.position.y) : 0,
      }
      : undefined,
    ...(isPlainObject(raw.metadata) ? { metadata: raw.metadata } : {}),
  };
}

export function buildCandidateSelectorMacroFromRouteProjection(input) {
  const routeIds = Array.isArray(input?.routeIds)
    ? Array.from(new Set(input.routeIds
      .map(normalizePositiveInteger)
      .filter((value) => value !== null)))
    : [];
  const displayName = normalizeNullableString(input?.displayName) || null;
  const stableId = normalizeNullableString(input?.stableId) || null;
  const id = stableId || (normalizePositiveInteger(input?.id) ? `route:${normalizePositiveInteger(input.id)}:model-group` : `model-group:${displayName || 'route'}`);
  return normalizeRouteGraphMacro({
    id,
    kind: 'candidate_selector',
    enabled: normalizeBoolean(input?.enabled, true),
    visibility: normalizeEnum(input?.visibility, ROUTE_GRAPH_VISIBILITIES, 'public'),
    ownership: normalizeEnum(input?.ownership, ROUTE_GRAPH_OWNERSHIPS.filter((item) => item !== 'derived'), 'manual'),
    name: displayName,
    config: {
      surface: {
        entry: {
          kind: 'external',
          visibility: normalizeEnum(input?.visibility, ROUTE_GRAPH_VISIBILITIES, 'public'),
          match: {
            kind: 'model',
            requestedModelPattern: '',
            displayName,
            ...(normalizePositiveInteger(input?.id) ? { routeId: normalizePositiveInteger(input.id) } : {}),
          },
        },
        output: 'route',
        ports: buildCandidateSelectorDefaultSurfacePorts({
          entry: { kind: 'external', visibility: normalizeEnum(input?.visibility, ROUTE_GRAPH_VISIBILITIES, 'public') },
          output: 'route',
        }).map((port) => normalizeMacroSurfacePort(port)),
      },
      policy: {
        strategy: normalizeEnum(input?.routingStrategy, ROUTE_GRAPH_CANDIDATE_SELECTOR_STRATEGIES, 'weighted'),
      },
      groups: routeIds.map((routeId, index) => ({
        id: `source:${routeId}`,
        label: `Route ${routeId}`,
        enabled: true,
        priority: index,
        input: { kind: 'route_ids', routeIds: [routeId] },
        defaults: {
          enabled: true,
          weight: 10,
          priority: index,
        },
      })),
      ...(normalizeNullableString(input?.displayIcon) ? { presentation: { displayIcon: normalizeNullableString(input.displayIcon) } } : {}),
    },
  });
}

export function normalizeRouteGraphSource(input) {
  const raw = isPlainObject(input) ? input : {};
  return {
    version: ROUTE_GRAPH_SCHEMA_VERSION,
    nodes: Array.isArray(raw.nodes) ? raw.nodes.map(normalizeRouteGraphNode) : [],
    edges: Array.isArray(raw.edges) ? raw.edges.map(normalizeRouteGraphEdge) : [],
    macros: Array.isArray(raw.macros) ? raw.macros.map(normalizeRouteGraphMacro).filter((macro) => macro.id) : [],
    metadata: isPlainObject(raw.metadata) ? raw.metadata : {},
  };
}

export function parseRouteGraphSource(raw) {
  if (!raw || typeof raw !== 'string') return normalizeRouteGraphSource(null);
  try {
    return normalizeRouteGraphSource(JSON.parse(raw));
  } catch {
    return normalizeRouteGraphSource(null);
  }
}

export function stringifyRouteGraphSource(source) {
  return JSON.stringify(normalizeRouteGraphSource(source));
}

function addDiagnostic(diagnostics, severity, code, message, nodeId, edgeId) {
  diagnostics.push({ severity, code, message, nodeId, edgeId });
}

function validateModelPattern(pattern) {
  const normalized = normalizeString(pattern);
  if (!normalized) return null;
  if (!normalized.startsWith('re:')) return null;
  try {
    // Keep regex validation in the graph compiler so invalid public entries fail
    // before runtime route matching.
    new RegExp(normalized.slice(3));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'invalid regular expression';
  }
}

function isInactiveDispatcherModeEdge(edge, sourceNode, targetNode) {
  if (sourceNode?.type === 'dispatcher' && sourceNode.mode === 'route' && edge.sourcePortId === 'bidirect[1...].out') {
    return true;
  }
  if (targetNode?.type === 'dispatcher' && targetNode.mode === 'flow' && edge.targetPortId === 'route.in') {
    return true;
  }
  return false;
}

function buildAdjacency(nodesById, edges, diagnostics) {
  const adjacency = new Map();
  for (const nodeId of nodesById.keys()) adjacency.set(nodeId, []);
  const dedupe = new Set();
  const incomingByPort = new Map();
  for (const edge of edges) {
    if (!edge.sourceNodeId || !edge.targetNodeId || !edge.sourcePortId || !edge.targetPortId) {
      addDiagnostic(diagnostics, 'error', 'edge.invalid', 'Edge must declare source/target nodes and source/target ports.', undefined, edge.id);
      continue;
    }
    const sourceNode = nodesById.get(edge.sourceNodeId);
    const targetNode = nodesById.get(edge.targetNodeId);
    if (!sourceNode) {
      addDiagnostic(diagnostics, 'error', 'edge.missing_source', `Edge source node ${edge.sourceNodeId} does not exist.`, edge.sourceNodeId, edge.id);
      continue;
    }
    if (!targetNode) {
      addDiagnostic(diagnostics, 'error', 'edge.missing_target', `Edge target node ${edge.targetNodeId} does not exist.`, edge.targetNodeId, edge.id);
      continue;
    }
    if (isInactiveDispatcherModeEdge(edge, sourceNode, targetNode)) {
      continue;
    }
    const sourcePort = getRouteGraphNodePort(sourceNode, edge.sourcePortId);
    const targetPort = getRouteGraphNodePort(targetNode, edge.targetPortId);
    if (!sourcePort) {
      addDiagnostic(diagnostics, 'error', 'edge.missing_source_port', `Edge source port ${edge.sourcePortId} does not exist on ${edge.sourceNodeId}.`, edge.sourceNodeId, edge.id);
      continue;
    }
    if (!targetPort) {
      addDiagnostic(diagnostics, 'error', 'edge.missing_target_port', `Edge target port ${edge.targetPortId} does not exist on ${edge.targetNodeId}.`, edge.targetNodeId, edge.id);
      continue;
    }
    if (sourcePort.enabled === false || targetPort.enabled === false) {
      addDiagnostic(diagnostics, 'error', 'edge.disabled_port', `Edge ${edge.id} connects to a disabled port.`, edge.sourceNodeId, edge.id);
      continue;
    }
    if (sourcePort.direction !== 'output') {
      addDiagnostic(diagnostics, 'error', 'edge.invalid_source_port', `Edge source port ${edge.sourcePortId} is not an output port.`, edge.sourceNodeId, edge.id);
      continue;
    }
    if (targetPort.direction !== 'input') {
      addDiagnostic(diagnostics, 'error', 'edge.invalid_target_port', `Edge target port ${edge.targetPortId} is not an input port.`, edge.targetNodeId, edge.id);
      continue;
    }
    const accepts = targetPort.accepts || [targetPort.kind];
    if (!accepts.includes(sourcePort.kind)) {
      addDiagnostic(diagnostics, 'error', 'edge.incompatible_ports', `${sourcePort.kind} cannot connect to ${targetPort.kind}.`, edge.targetNodeId, edge.id);
      continue;
    }
    const incomingKey = `${edge.targetNodeId}\u0000${edge.targetPortId}`;
    if (!targetPort.multiple && incomingByPort.has(incomingKey)) {
      addDiagnostic(diagnostics, 'error', 'edge.duplicate_input', `Input port ${edge.targetPortId} on ${edge.targetNodeId} already has a connection.`, edge.targetNodeId, edge.id);
      continue;
    }
    incomingByPort.set(incomingKey, edge.id);
    const expectedKind = inferEdgeKindFromPorts(sourcePort, targetPort);
    if (edge.kind !== expectedKind) {
      addDiagnostic(diagnostics, 'warning', 'edge.kind_mismatch', `Edge kind ${edge.kind} does not match port flow ${expectedKind}.`, edge.sourceNodeId, edge.id);
    }
    const key = `${edge.sourceNodeId}\u0000${edge.sourcePortId}\u0000${edge.targetNodeId}\u0000${edge.targetPortId}`;
    if (dedupe.has(key)) {
      addDiagnostic(diagnostics, 'warning', 'edge.duplicate', 'Duplicate edge ignored by compiler.', edge.sourceNodeId, edge.id);
      continue;
    }
    dedupe.add(key);
    adjacency.get(edge.sourceNodeId).push(edge.targetNodeId);
  }
  return adjacency;
}

function buildTraversalAdjacency(nodesById, edges) {
  const adjacency = new Map();
  for (const [nodeId] of nodesById) {
    adjacency.set(nodeId, []);
  }
  for (const edge of edges) {
    if (edge.kind === 'route_flow') continue;
    const sourceNode = nodesById.get(edge.sourceNodeId);
    const targetNode = nodesById.get(edge.targetNodeId);
    if (isInactiveDispatcherModeEdge(edge, sourceNode, targetNode)) continue;
    if (!nodesById.has(edge.sourceNodeId) || !nodesById.has(edge.targetNodeId)) continue;
    adjacency.get(edge.sourceNodeId).push(edge.targetNodeId);
  }
  return adjacency;
}

function buildReachabilityAdjacency(nodesById, edges) {
  const adjacency = buildTraversalAdjacency(nodesById, edges);
  for (const edge of edges) {
    const targetNode = nodesById.get(edge.targetNodeId);
    const sourceNode = nodesById.get(edge.sourceNodeId);
    if (isInactiveDispatcherModeEdge(edge, sourceNode, targetNode)) continue;
    if (
      edge.kind === 'route_flow'
      && edge.sourcePortId === 'route.out'
      && edge.targetPortId === 'route.in'
      && targetNode?.type === 'dispatcher'
      && targetNode.mode === 'route'
      && nodesById.has(edge.sourceNodeId)
    ) {
      adjacency.get(edge.targetNodeId).push(edge.sourceNodeId);
    }
  }
  return adjacency;
}

function detectCycles(adjacency) {
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];
  const stack = [];
  const visit = (nodeId) => {
    if (visiting.has(nodeId)) {
      const index = stack.indexOf(nodeId);
      cycles.push(index >= 0 ? stack.slice(index).concat(nodeId) : [nodeId, nodeId]);
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    stack.push(nodeId);
    for (const target of adjacency.get(nodeId) || []) visit(target);
    stack.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of adjacency.keys()) visit(nodeId);
  return cycles;
}

function hasReachableTerminal(startId, nodesById, adjacency) {
  const visited = new Set();
  const stack = [startId];
  while (stack.length > 0) {
    const nodeId = stack.pop();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    const node = nodesById.get(nodeId);
    if (!node || node.enabled === false) continue;
    if (node.type === 'dispatcher' && node.mode === 'route') return true;
    if (ROUTE_GRAPH_TERMINAL_NODE_TYPES.includes(node.type)) return true;
    for (const target of adjacency.get(nodeId) || []) stack.push(target);
  }
  return false;
}

function collectReachableFromEntries(nodes, adjacency) {
  const reachable = new Set();
  const stack = nodes
    .filter((node) => node.type === 'entry' && node.enabled !== false)
    .map((node) => node.id);
  while (stack.length > 0) {
    const nodeId = stack.pop();
    if (!nodeId || reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    for (const target of adjacency.get(nodeId) || []) stack.push(target);
  }
  return reachable;
}

function getPublicModelName(node) {
  if (!node || node.type !== 'entry' || node.visibility !== 'public') return '';
  return node.match?.displayName || node.match?.requestedModelPattern || '';
}

function legacyRouteIdFromRouteGraphNode(node) {
  if (!node) return null;
  if (Number.isFinite(Number(node.legacyRouteId)) && Number(node.legacyRouteId) > 0) {
    return Math.trunc(Number(node.legacyRouteId));
  }
  if (node.type === 'entry' && Number.isFinite(Number(node.match?.routeId)) && Number(node.match.routeId) > 0) {
    return Math.trunc(Number(node.match.routeId));
  }
  const match = /^(?:entry|pool):legacy:(\d+)$/.exec(String(node.id || ''));
  if (!match) return null;
  const routeId = Number(match[1]);
  return Number.isFinite(routeId) && routeId > 0 ? routeId : null;
}

function deriveEntryBackendSpec(entryNodeId, nodesById, outgoingByNodeId) {
  const incomingByNodeId = new Map();
  for (const edges of outgoingByNodeId.values()) {
    for (const edge of edges) {
      if (!incomingByNodeId.has(edge.targetNodeId)) incomingByNodeId.set(edge.targetNodeId, []);
      incomingByNodeId.get(edge.targetNodeId).push(edge);
    }
  }
  const targets = (outgoingByNodeId.get(entryNodeId) || [])
    .filter((edge) => edge.sourcePortId === 'bidirect.out')
    .map((edge) => edge.targetNodeId);
  const routeIds = [];
  for (const target of targets) {
    const targetNode = nodesById.get(target);
    if (targetNode?.type === 'dispatcher' && targetNode.mode === 'route') {
      const candidateEdges = (incomingByNodeId.get(targetNode.id) || [])
        .filter((edge) => edge.targetPortId === 'route.in');
      for (const edge of candidateEdges) {
        const candidateNode = nodesById.get(edge.sourceNodeId);
        const routeId = legacyRouteIdFromRouteGraphNode(candidateNode);
        if (routeId) routeIds.push(routeId);
      }
    }
  }
  if (routeIds.length > 0) {
    return normalizeRouteGraphBackendSpec({ kind: ROUTE_GRAPH_BACKEND_KIND_ROUTES, routeIds: Array.from(new Set(routeIds)) });
  }
  return normalizeRouteGraphBackendSpec({ kind: ROUTE_GRAPH_BACKEND_KIND_CHANNELS });
}

function macroProvenance(macro, role) {
  return {
    source: 'macro',
    macroId: macro.id,
    macroKind: macro.kind,
    role,
  };
}

function macroSafeId(value) {
  return String(value || 'x')
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'x';
}

function macroSemanticNodeId(macro) {
  return `macro:${macroSafeId(macro?.id)}`;
}

function findRouteCandidateEndpoint(nodes, routeId) {
  const legacyPoolId = legacyRouteIdToRouteGraphPoolNodeId(routeId);
  return nodes.find((node) => node.id === legacyPoolId && node.type === 'model_endpoint')
    || nodes.find((node) => node.type === 'model_endpoint' && Number(node.legacyRouteId) === routeId)
    || null;
}

function cloneEndpointForMacroCandidate(endpoint, macro, group, routeId) {
  const candidateId = `macro:${macroSafeId(macro.id)}:candidate:${macroSafeId(group.id)}:${routeId}`;
  return normalizeRouteGraphNode({
    ...endpoint,
    id: candidateId,
    name: endpoint.name || `Route ${routeId} candidate`,
    enabled: endpoint.enabled !== false && group.enabled !== false,
    visibility: 'internal',
    ownership: 'derived',
    provenance: macroProvenance(macro, 'candidate_endpoint'),
    metadata: {
      ...(isPlainObject(endpoint.metadata) ? endpoint.metadata : {}),
      macroCandidate: {
        macroId: macro.id,
        groupId: group.id,
        routeId,
        priority: Number.isFinite(Number(group.defaults?.priority)) ? Number(group.defaults.priority) : group.priority,
        weight: Number.isFinite(Number(group.defaults?.weight)) ? Number(group.defaults.weight) : 10,
      },
    },
    config: {
      ...(isPlainObject(endpoint.config) ? endpoint.config : {}),
      targets: Array.isArray(endpoint.config?.targets) ? endpoint.config.targets : [],
      targetSelection: { strategy: 'defer_to_router' },
    },
  });
}

function macroCandidateWeight(group, fallback = 10) {
  return Number.isFinite(Number(group.defaults?.weight)) ? Number(group.defaults.weight) : fallback;
}

function macroCandidatePriority(group) {
  return Number.isFinite(Number(group.defaults?.priority)) ? Number(group.defaults.priority) : group.priority;
}

function materializeCandidateItems(group, items, keyForItem) {
  let candidates = [...items];
  const dedupeBy = group.materialization?.dedupeBy;
  if (dedupeBy) {
    const seen = new Set();
    candidates = candidates.filter((item) => {
      const key = keyForItem(item, dedupeBy);
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const sort = group.materialization?.sort;
  if (sort === 'route_id') {
    candidates.sort((left, right) => Number(left.routeId || 0) - Number(right.routeId || 0));
  } else if (sort === 'model_name') {
    candidates.sort((left, right) => String(left.model || '').localeCompare(String(right.model || '')));
  }

  const limit = normalizePositiveInteger(group.materialization?.limit);
  return limit ? candidates.slice(0, limit) : candidates;
}

function findEntryForEndpointCandidate(nodes, endpoint) {
  if (!endpoint || endpoint.type !== 'model_endpoint') return null;
  if (endpoint.routeNodeId) {
    const directEntry = nodes.find((node) => node.id === endpoint.routeNodeId && node.type === 'entry');
    if (directEntry) return directEntry;
  }
  const routeId = legacyRouteIdFromRouteGraphNode(endpoint);
  if (routeId) {
    const legacyEntry = nodes.find((node) => node.id === legacyRouteIdToRouteGraphEntryNodeId(routeId) && node.type === 'entry');
    if (legacyEntry) return legacyEntry;
  }
  return null;
}

function modelEndpointPatternNames(nodes, endpoint) {
  const values = [];
  const push = (value) => {
    const normalized = normalizeString(value);
    if (normalized && !values.includes(normalized)) values.push(normalized);
  };
  const entry = findEntryForEndpointCandidate(nodes, endpoint);
  if (entry?.match) {
    push(entry.match.displayName);
    push(entry.match.requestedModelPattern);
    push(entry.match.currentModelPattern);
  }
  if (endpoint?.name) push(endpoint.name);
  const targets = Array.isArray(endpoint?.config?.targets) ? endpoint.config.targets : [];
  for (const target of targets) {
    push(target?.model);
    push(target?.sourceModel);
  }
  return values;
}

function patternCandidateItemsForGroup(source, group) {
  const pattern = normalizeString(group.input?.pattern);
  if (!pattern) return [];
  return source.nodes
    .filter((node) => node.type === 'model_endpoint' && node.enabled !== false)
    .flatMap((endpoint) => {
      const models = modelEndpointPatternNames(source.nodes, endpoint);
      const matchedModel = models.find((model) => matchesTokenRouteModelPattern(model, pattern));
      if (!matchedModel) return [];
      return [{
        endpoint,
        routeId: legacyRouteIdFromRouteGraphNode(endpoint),
        endpointId: endpoint.id,
        model: matchedModel,
      }];
    });
}

function cloneEndpointForMacroPatternCandidate(item, macro, group) {
  const routeIdPart = item.routeId ? `route:${item.routeId}` : `endpoint:${item.endpointId}`;
  return normalizeRouteGraphNode({
    ...item.endpoint,
    id: `macro:${macroSafeId(macro.id)}:candidate:${macroSafeId(group.id)}:${macroSafeId(routeIdPart)}`,
    name: item.endpoint.name || item.model || `${macro.id} pattern candidate`,
    enabled: item.endpoint.enabled !== false && group.enabled !== false,
    visibility: 'internal',
    ownership: 'derived',
    provenance: macroProvenance(macro, 'pattern_endpoint'),
    metadata: {
      ...(isPlainObject(item.endpoint.metadata) ? item.endpoint.metadata : {}),
      macroCandidate: {
        macroId: macro.id,
        groupId: group.id,
        routeId: item.routeId || null,
        pattern: group.input.pattern,
        matchedModel: item.model,
        priority: macroCandidatePriority(group),
        weight: macroCandidateWeight(group),
      },
    },
    config: {
      ...(isPlainObject(item.endpoint.config) ? item.endpoint.config : {}),
      targets: Array.isArray(item.endpoint.config?.targets) ? item.endpoint.config.targets : [],
      targetSelection: { strategy: 'defer_to_router' },
    },
  });
}

function addMacroCandidateEdge(edges, macro, macroId, group, candidateId, dispatcherId, candidateMetadata, output = 'route') {
  const isBidirect = output === 'bidirect';
  edges.push(normalizeRouteGraphEdge({
    id: `macro:${macroId}:edge:candidate:${macroSafeId(group.id)}:${macroSafeId(candidateId)}`,
    sourceNodeId: isBidirect ? dispatcherId : candidateId,
    sourcePortId: isBidirect ? 'bidirect[1...].out' : 'route.out',
    targetNodeId: isBidirect ? candidateId : dispatcherId,
    targetPortId: isBidirect ? 'bidirect.in' : 'route.in',
    kind: isBidirect ? 'bidirect_flow' : 'route_flow',
    ownership: 'derived',
    metadata: {
      provenance: macroProvenance(macro, 'candidate_edge'),
      group: {
        id: group.id,
        priority: group.priority,
      },
      candidate: {
        enabled: group.defaults?.enabled !== false,
        weight: macroCandidateWeight(group),
        priority: macroCandidatePriority(group),
        ...candidateMetadata,
      },
    },
  }));
}

function lowerCandidateSelectorMacro(macro, source) {
  const diagnostics = [];
  const nodes = [];
  const edges = [];
  const candidateNodeIds = [];
  const config = normalizeCandidateSelectorConfig(macro.config);
  const macroId = macroSafeId(macro.id);
  const semanticNodeId = macroSemanticNodeId(macro);
  if (macro.enabled === false) return { macro, nodes, edges, diagnostics, semanticNodeId, entryId: null, dispatcherId: null, candidateNodeIds };

  const entryId = config.surface.entry.kind === 'external' ? `macro:${macroId}:entry` : null;
  const dispatcherId = `macro:${macroId}:dispatcher`;
  const dispatcherMode = config.surface.output === 'bidirect' ? 'flow' : 'route';
  const dispatcherPolicyStrategy = config.policy.strategy === 'cel_select'
    ? 'direct'
    : (config.policy.strategy === 'cel_score' ? 'weighted' : config.policy.strategy);
  if (entryId) {
    nodes.push(normalizeRouteGraphNode({
      id: entryId,
      type: 'entry',
      name: macro.name || config.surface.entry.match.displayName || config.surface.entry.match.requestedModelPattern || macro.id,
      enabled: macro.enabled !== false,
      visibility: config.surface.entry.visibility,
      ownership: 'derived',
      match: config.surface.entry.match,
      selectionStrategy: config.policy.strategy === 'cel_select' || config.policy.strategy === 'cel_score' ? 'weighted' : config.policy.strategy,
      provenance: macroProvenance(macro, 'entry'),
    }));
  }
  nodes.push(normalizeRouteGraphNode({
    id: dispatcherId,
    type: 'dispatcher',
    name: `${macro.name || macro.id} selector`,
    enabled: macro.enabled !== false,
    visibility: 'internal',
    ownership: 'derived',
    mode: dispatcherMode,
    ordering: 'explicit',
    policy: {
      strategy: dispatcherPolicyStrategy,
      ...(config.policy.strategy === 'cel_select' && config.policy.cel ? { select: config.policy.cel } : {}),
      ...(config.policy.strategy === 'cel_score' && config.policy.cel ? { score: config.policy.cel } : {}),
    },
    provenance: macroProvenance(macro, 'dispatcher'),
  }));
  if (entryId) {
    edges.push(normalizeRouteGraphEdge({
      id: `macro:${macroId}:edge:entry-dispatcher`,
      sourceNodeId: entryId,
      sourcePortId: 'bidirect.out',
      targetNodeId: dispatcherId,
      targetPortId: 'bidirect.in',
      kind: 'bidirect_flow',
      ownership: 'derived',
      metadata: { provenance: macroProvenance(macro, 'entry_dispatcher_edge') },
    }));
  }

  const sortedGroups = [...config.groups]
    .filter((group) => group.enabled !== false)
    .sort((left, right) => left.priority === right.priority ? left.id.localeCompare(right.id) : left.priority - right.priority);
  for (const group of sortedGroups) {
    if (group.input.kind === 'route_ids') {
      const materializedRouteIds = materializeCandidateItems(
        group,
        group.input.routeIds.map((routeId) => ({ routeId })),
        (item, dedupeBy) => (dedupeBy === 'route_id' ? String(item.routeId) : ''),
      );
      for (const item of materializedRouteIds) {
        const routeId = item.routeId;
        const endpoint = findRouteCandidateEndpoint(source.nodes, routeId);
        if (!endpoint) {
          addDiagnostic(diagnostics, 'error', 'macro.candidate_route_missing', `candidate_selector ${macro.id} references route ${routeId}, but no model endpoint exists for that route.`);
          continue;
        }
        const candidate = cloneEndpointForMacroCandidate(endpoint, macro, group, routeId);
        nodes.push(candidate);
        candidateNodeIds.push(candidate.id);
        addMacroCandidateEdge(edges, macro, macroId, group, candidate.id, dispatcherId, { routeId }, config.surface.output);
      }
      continue;
    }
    if (group.input.kind === 'model_pattern') {
      const materializedEndpoints = materializeCandidateItems(
        group,
        patternCandidateItemsForGroup(source, group),
        (item, dedupeBy) => {
          if (dedupeBy === 'route_id') return item.routeId ? String(item.routeId) : '';
          if (dedupeBy === 'endpoint_id') return String(item.endpointId || '');
          if (dedupeBy === 'model') return String(item.model || '');
          return '';
        },
      );
      for (const item of materializedEndpoints) {
        const candidate = cloneEndpointForMacroPatternCandidate(item, macro, group);
        nodes.push(candidate);
        candidateNodeIds.push(candidate.id);
        addMacroCandidateEdge(edges, macro, macroId, group, candidate.id, dispatcherId, {
          routeId: item.routeId || null,
          pattern: group.input.pattern,
          matchedModel: item.model,
        }, config.surface.output);
      }
      continue;
    }
    if (group.input.kind === 'inline_endpoints') {
      const materializedTargets = materializeCandidateItems(
        group,
        group.input.endpoints.map((target, index) => ({
          ...target,
          index,
          model: target.model || '',
          endpointId: target.channelId,
        })),
        (item, dedupeBy) => {
          if (dedupeBy === 'endpoint_id') return String(item.endpointId || item.channelId || '');
          if (dedupeBy === 'model') return String(item.model || '');
          return '';
        },
      );
      if (materializedTargets.length === 0) continue;
      const candidateId = `macro:${macroId}:candidate:${macroSafeId(group.id)}:inline`;
      candidateNodeIds.push(candidateId);
      nodes.push(normalizeRouteGraphNode({
        id: candidateId,
        type: 'model_endpoint',
        name: group.label || `${macro.id} inline endpoints`,
        enabled: group.defaults?.enabled !== false,
        visibility: 'internal',
        ownership: 'derived',
        provenance: macroProvenance(macro, 'inline_endpoint'),
        metadata: {
          ...(isPlainObject(group.defaults?.metadata) ? group.defaults.metadata : {}),
          macroCandidate: {
            macroId: macro.id,
            groupId: group.id,
            priority: macroCandidatePriority(group),
            weight: macroCandidateWeight(group),
          },
        },
        config: {
          targets: materializedTargets,
          targetSelection: { strategy: 'defer_to_router' },
        },
      }));
      addMacroCandidateEdge(edges, macro, macroId, group, candidateId, dispatcherId, { inline: true }, config.surface.output);
      continue;
    }
    if (group.input.kind === 'synthetic') {
      const candidateId = `macro:${macroId}:candidate:${macroSafeId(group.id)}:synthetic`;
      candidateNodeIds.push(candidateId);
      nodes.push(normalizeRouteGraphNode({
        id: candidateId,
        type: 'synthetic_endpoint',
        name: group.label || `${macro.id} synthetic`,
        enabled: group.defaults?.enabled !== false,
        visibility: 'internal',
        ownership: 'derived',
        statusCode: group.input.statusCode,
        message: group.input.message,
        provenance: macroProvenance(macro, 'synthetic_endpoint'),
      }));
      addMacroCandidateEdge(edges, macro, macroId, group, candidateId, dispatcherId, { synthetic: true }, config.surface.output);
      continue;
    }
    addDiagnostic(diagnostics, 'error', 'macro.resolver_unsupported', `candidate_selector ${macro.id} input ${group.input.kind} is not implemented yet.`);
  }
  return { macro, nodes, edges, diagnostics, semanticNodeId, entryId, dispatcherId, candidateNodeIds };
}

export function lowerRouteGraphSource(sourceInput) {
  const source = normalizeRouteGraphSource(sourceInput);
  const diagnostics = [];
  const derivedNodes = [];
  const derivedEdges = [];
  const macroLoweringsBySemanticId = new Map();
  for (const macro of source.macros || []) {
    if (macro.kind === 'candidate_selector') {
      const lowered = lowerCandidateSelectorMacro(macro, source);
      derivedNodes.push(...lowered.nodes);
      derivedEdges.push(...lowered.edges);
      diagnostics.push(...lowered.diagnostics);
      macroLoweringsBySemanticId.set(lowered.semanticNodeId, lowered);
      continue;
    }
    addDiagnostic(diagnostics, 'error', 'macro.unknown_kind', `Unknown route graph macro kind ${macro.kind}.`);
  }
  const semanticEdges = [];
  const primitiveEdges = [];
  for (const edge of source.edges) {
    const sourceMacro = macroLoweringsBySemanticId.get(edge.sourceNodeId);
    const targetMacro = macroLoweringsBySemanticId.get(edge.targetNodeId);
    if (!sourceMacro && !targetMacro) {
      primitiveEdges.push(edge);
      continue;
    }
    if (sourceMacro && targetMacro) {
      addDiagnostic(diagnostics, 'error', 'macro.edge_unsupported', `Semantic macro edge ${edge.id} cannot connect one macro node directly to another macro node.`, edge.sourceNodeId, edge.id);
      continue;
    }
    if (sourceMacro) {
      const sourceSurfacePort = getRouteGraphMacroPort(sourceMacro.macro, edge.sourcePortId);
      if (sourceSurfacePort?.direction === 'output' && sourceSurfacePort.kind === 'route' && sourceMacro.candidateNodeIds.length > 0) {
        for (const candidateNodeId of sourceMacro.candidateNodeIds) {
          semanticEdges.push(normalizeRouteGraphEdge({
            ...edge,
            id: `macro-semantic:${edge.id}:route-out:${macroSafeId(candidateNodeId)}`,
            sourceNodeId: candidateNodeId,
            sourcePortId: 'route.out',
            ownership: 'derived',
            metadata: { ...(isPlainObject(edge.metadata) ? edge.metadata : {}), provenance: { source: 'macro_semantic_edge', semanticEdgeId: edge.id } },
          }));
        }
        continue;
      }
      if (sourceSurfacePort?.direction === 'output' && sourceSurfacePort.kind === 'bidirect' && sourceMacro.dispatcherId) {
        semanticEdges.push(normalizeRouteGraphEdge({
          ...edge,
          id: `macro-semantic:${edge.id}:bidirect-out`,
          sourceNodeId: sourceMacro.dispatcherId,
          sourcePortId: 'bidirect[1...].out',
          ownership: 'derived',
          metadata: { ...(isPlainObject(edge.metadata) ? edge.metadata : {}), provenance: { source: 'macro_semantic_edge', semanticEdgeId: edge.id } },
        }));
        continue;
      }
      addDiagnostic(diagnostics, 'error', 'macro.edge_unsupported', `Semantic macro source port ${edge.sourcePortId} is not supported on ${edge.sourceNodeId}.`, edge.sourceNodeId, edge.id);
      continue;
    }
    if (targetMacro) {
      const targetSurfacePort = getRouteGraphMacroPort(targetMacro.macro, edge.targetPortId);
      if (targetSurfacePort?.direction === 'input' && targetSurfacePort.kind === 'bidirect' && (targetMacro.entryId || targetMacro.dispatcherId)) {
        semanticEdges.push(normalizeRouteGraphEdge({
          ...edge,
          id: `macro-semantic:${edge.id}:bidirect-in`,
          targetNodeId: targetMacro.entryId || targetMacro.dispatcherId,
          targetPortId: 'bidirect.in',
          ownership: 'derived',
          metadata: { ...(isPlainObject(edge.metadata) ? edge.metadata : {}), provenance: { source: 'macro_semantic_edge', semanticEdgeId: edge.id } },
        }));
        continue;
      }
      addDiagnostic(diagnostics, 'error', 'macro.edge_unsupported', `Semantic macro target port ${edge.targetPortId} is not supported on ${edge.targetNodeId}.`, edge.targetNodeId, edge.id);
    }
  }
  return {
    semanticSource: source,
    primitiveSource: normalizeRouteGraphSource({
      ...source,
      nodes: [...source.nodes, ...derivedNodes],
      edges: [...primitiveEdges, ...derivedEdges, ...semanticEdges],
      macros: source.macros,
    }),
    diagnostics,
  };
}

function compilePrimitiveRouteGraph(sourceInput, preDiagnostics = []) {
  const source = normalizeRouteGraphSource(sourceInput);
  const diagnostics = [...preDiagnostics];
  const nodesById = new Map();
  for (const node of source.nodes) {
    if (!node.id) {
      addDiagnostic(diagnostics, 'error', 'node.missing_id', 'Node id is required.');
      continue;
    }
    if (nodesById.has(node.id)) {
      addDiagnostic(diagnostics, 'error', 'node.duplicate_id', `Duplicate node id ${node.id}.`, node.id);
      continue;
    }
    nodesById.set(node.id, node);
  }

  buildAdjacency(nodesById, source.edges, diagnostics);
  const activeEdges = source.edges.filter((edge) => {
    const sourceNode = nodesById.get(edge.sourceNodeId);
    const targetNode = nodesById.get(edge.targetNodeId);
    return !isInactiveDispatcherModeEdge(edge, sourceNode, targetNode);
  });
  const traversalAdjacency = buildTraversalAdjacency(nodesById, activeEdges);
  const reachabilityAdjacency = buildReachabilityAdjacency(nodesById, activeEdges);
  const outgoingByNodeId = new Map();
  for (const nodeId of nodesById.keys()) outgoingByNodeId.set(nodeId, []);
  for (const edge of activeEdges) {
    if (!outgoingByNodeId.has(edge.sourceNodeId)) outgoingByNodeId.set(edge.sourceNodeId, []);
    outgoingByNodeId.get(edge.sourceNodeId).push(edge);
  }

  for (const node of source.nodes) {
    if (node.type === 'auto_node' && node.ownership === 'manual') {
      addDiagnostic(diagnostics, 'error', 'auto_node.manual', `Auto node ${node.id} cannot be manual-owned.`, node.id);
    }
    if (node.type === 'model_endpoint' && node.enabled !== false) {
      const targets = Array.isArray(node.config?.targets)
        ? node.config.targets.filter((target) => normalizeString(target?.channelId) && (normalizeString(target?.model) || target?.modelSource === 'request'))
        : [];
      if (targets.length === 0) {
        addDiagnostic(diagnostics, 'warning', 'model_endpoint.targets_required', `Model endpoint ${node.id} has no executable target yet.`, node.id);
      }
    }
    if (node.type === 'dispatcher' && node.mode === 'route') {
      const candidateEdges = activeEdges.filter((edge) => edge.targetNodeId === node.id && edge.targetPortId === 'route.in');
      if (candidateEdges.length === 0) {
        addDiagnostic(diagnostics, 'error', 'dispatcher.route_candidates_required', `Route dispatcher ${node.id} must have at least one route candidate.`, node.id);
      }
    }
    if (node.type === 'dispatcher' && node.mode === 'flow') {
      const outputEdges = activeEdges.filter((edge) => (
        edge.sourceNodeId === node.id
        && edge.sourcePortId === 'bidirect[1...].out'
      ));
      if (outputEdges.length === 0) {
        addDiagnostic(diagnostics, 'error', 'dispatcher.flow_outputs_required', `Flow dispatcher ${node.id} must expose at least one bidirect output.`, node.id);
      }
    }
    if (node.type === 'filter' && node.enabled !== false) {
      const inputEdges = activeEdges.filter((edge) => (
        edge.targetNodeId === node.id
        && (edge.targetPortId === 'request.in' || edge.targetPortId === 'bidirect.in')
      ));
      if (inputEdges.length === 0) {
        addDiagnostic(diagnostics, 'error', 'filter.input_required', `Filter ${node.id} must receive either request.in or bidirect.in.`, node.id);
      }
    }
    if (node.type === 'entry') {
      const requestedPatternError = validateModelPattern(node.match?.requestedModelPattern);
      if (requestedPatternError) {
        addDiagnostic(diagnostics, 'error', 'pattern.invalid', `Entry ${node.id} has invalid requested model pattern: ${requestedPatternError}.`, node.id);
      }
      const currentPatternError = validateModelPattern(node.match?.currentModelPattern);
      if (currentPatternError) {
        addDiagnostic(diagnostics, 'error', 'pattern.invalid', `Entry ${node.id} has invalid current model pattern: ${currentPatternError}.`, node.id);
      }
    }
    if (node.enabled !== false) {
      const incomingEdges = activeEdges.filter((edge) => edge.targetNodeId === node.id);
      for (const port of getRouteGraphNodePorts(node)) {
        if (port.direction !== 'input' || !port.required) continue;
        if (!incomingEdges.some((edge) => edge.targetPortId === port.id)) {
          addDiagnostic(diagnostics, 'error', 'port.required_missing', `Required input port ${port.id} on ${node.id} is not connected.`, node.id);
        }
      }
    }
  }

  for (const cycle of detectCycles(traversalAdjacency)) {
    addDiagnostic(diagnostics, 'error', 'graph.cycle', `Route graph cannot contain a cycle: ${cycle.join(' -> ')}.`, cycle[0]);
  }

  const publicNames = new Map();
  for (const node of source.nodes) {
    const publicName = getPublicModelName(node).trim();
    if (!publicName || node.enabled === false) continue;
    const lower = publicName.toLowerCase();
    const backend = deriveEntryBackendSpec(node.id, nodesById, outgoingByNodeId);
    const backendKind = backend.kind;
    const isMacroEntry = String(node.id || '').startsWith('macro:');
    if (publicNames.has(lower)) {
      const existing = publicNames.get(lower);
      const existingIsMacroEntry = existing.isMacroEntry === true;
      if (existing.backendKind === backendKind && existingIsMacroEntry === isMacroEntry) {
        addDiagnostic(diagnostics, 'error', 'public_model.duplicate', `Public model ${publicName} is declared by both ${existing.nodeId} and ${node.id}.`, node.id);
      }
      if (
        (existing.backendKind === ROUTE_GRAPH_BACKEND_KIND_CHANNELS && backendKind === ROUTE_GRAPH_BACKEND_KIND_ROUTES)
        || (!existingIsMacroEntry && isMacroEntry)
      ) {
        publicNames.set(lower, { nodeId: node.id, backendKind, isMacroEntry });
      }
    } else {
      publicNames.set(lower, { nodeId: node.id, backendKind, isMacroEntry });
    }
  }

  const activeIncidentCounts = new Map();
  for (const edge of activeEdges) {
    activeIncidentCounts.set(edge.sourceNodeId, (activeIncidentCounts.get(edge.sourceNodeId) || 0) + 1);
    activeIncidentCounts.set(edge.targetNodeId, (activeIncidentCounts.get(edge.targetNodeId) || 0) + 1);
  }

  for (const node of source.nodes) {
    if (node.type === 'entry' && node.visibility === 'public' && node.enabled !== false && !hasReachableTerminal(node.id, nodesById, traversalAdjacency)) {
      addDiagnostic(diagnostics, 'error', 'public_entry.no_terminal', `Enabled public entry ${node.id} must reach a terminal node.`, node.id);
    }
  }

  const reachable = collectReachableFromEntries(source.nodes, reachabilityAdjacency);
  for (const node of source.nodes) {
    if (node.enabled !== false && node.visibility === 'internal' && activeIncidentCounts.has(node.id) && !reachable.has(node.id)) {
      addDiagnostic(diagnostics, 'error', 'internal.unreachable', `Enabled internal node ${node.id} must be reachable from an enabled public entry.`, node.id);
    }
  }

  const entries = source.nodes
    .filter((node) => node.type === 'entry')
    .map((node) => ({
      nodeId: node.id,
      enabled: node.enabled !== false,
      visibility: node.visibility,
      match: normalizeRouteGraphMatchSpec(node.match),
      backend: deriveEntryBackendSpec(node.id, nodesById, outgoingByNodeId),
      selectionStrategy: node.selectionStrategy || 'weighted',
      publicModelName: getPublicModelName(node),
    }));
  const terminals = source.nodes
    .filter((node) => ROUTE_GRAPH_TERMINAL_NODE_TYPES.includes(node.type))
    .map((node) => ({
      nodeId: node.id,
      type: node.type,
      routeNodeId: node.routeNodeId || node.id,
      legacyRouteId: node.legacyRouteId || null,
      routingStrategy: node.routingStrategy || 'weighted',
      statusCode: node.statusCode || null,
      message: node.message || null,
    }));
  const edgesByFromPort = {};
  for (const edge of activeEdges) {
    const key = `${edge.sourceNodeId}:${edge.sourcePortId}`;
    if (!edgesByFromPort[key]) edgesByFromPort[key] = [];
    edgesByFromPort[key].push(edge);
  }

  return {
    version: ROUTE_GRAPH_SCHEMA_VERSION,
    source,
    compiled: {
      version: ROUTE_GRAPH_SCHEMA_VERSION,
      hash: stableJson({ nodes: source.nodes, edges: source.edges }),
      entries,
      nodesById: Object.fromEntries(source.nodes.map((node) => [node.id, node])),
      edgesBySource: Object.fromEntries(Array.from(traversalAdjacency.entries())),
      edgesByFromPort,
      terminals,
      publicModels: entries
        .filter((entry) => entry.enabled && entry.visibility === 'public' && entry.publicModelName)
        .map((entry) => ({ nodeId: entry.nodeId, model: entry.publicModelName })),
    },
    diagnostics,
    ok: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
  };
}

function compileRouteGraph(sourceInput) {
  const lowered = lowerRouteGraphSource(sourceInput);
  const compiled = compilePrimitiveRouteGraph(lowered.primitiveSource, lowered.diagnostics);
  return {
    ...compiled,
    source: lowered.semanticSource,
    primitiveSource: lowered.primitiveSource,
    compiled: {
      ...compiled.compiled,
      hash: stableJson({
        nodes: lowered.primitiveSource.nodes,
        edges: lowered.primitiveSource.edges,
        macros: lowered.semanticSource.macros,
      }),
    },
  };
}

export function validateRouteGraphSource(sourceInput) {
  const { diagnostics, ok } = compileRouteGraph(sourceInput);
  return { ok, diagnostics };
}

export function compileRouteGraphSource(sourceInput) {
  return compileRouteGraph(sourceInput);
}

export function findRouteGraphEntryForModel(compiledGraph, model) {
  const graph = isPlainObject(compiledGraph) ? compiledGraph : {};
  const entries = Array.isArray(graph.entries) ? graph.entries : [];
  const enabledPublicEntries = entries.filter((entry) => entry.enabled && entry.visibility === 'public');
  const routeBackedEntries = enabledPublicEntries.filter((entry) => normalizeRouteGraphBackendSpec(entry.backend).kind === ROUTE_GRAPH_BACKEND_KIND_ROUTES);
  const macroRouteBackedEntries = routeBackedEntries.filter((entry) => String(entry.nodeId || '').startsWith('macro:'));
  return macroRouteBackedEntries.find((entry) => entry.match?.displayName === model)
    || routeBackedEntries.find((entry) => entry.match?.displayName === model)
    || routeBackedEntries.find((entry) => (
      isExactTokenRouteModelPattern(entry.match?.requestedModelPattern || '')
      && entry.match.requestedModelPattern === model
    ))
    || enabledPublicEntries.find((entry) => (
      normalizeRouteGraphBackendSpec(entry.backend).kind === ROUTE_GRAPH_BACKEND_KIND_CHANNELS
      && entry.match?.displayName === model
    ))
    || enabledPublicEntries.find((entry) => (
      normalizeRouteGraphBackendSpec(entry.backend).kind === ROUTE_GRAPH_BACKEND_KIND_CHANNELS
      && isExactTokenRouteModelPattern(entry.match?.requestedModelPattern || '')
      && entry.match.requestedModelPattern === model
    ))
    || enabledPublicEntries.find((entry) => (
      normalizeRouteGraphBackendSpec(entry.backend).kind === ROUTE_GRAPH_BACKEND_KIND_CHANNELS
      && matchesTokenRouteModelPattern(model, entry.match?.requestedModelPattern || '')
    ))
    || null;
}

export function buildRouteGraphSourceFromLegacyRoutes(routesInput) {
  const routes = Array.isArray(routesInput) ? routesInput : [];
  const nodesById = new Map();
  const edges = [];
  const macros = [];
  const pushNode = (node) => {
    const normalized = normalizeRouteGraphNode(node);
    if (!nodesById.has(normalized.id)) nodesById.set(normalized.id, normalized);
  };
  for (const route of routes) {
    const routeId = normalizePositiveInteger(route.id);
    if (!routeId) continue;
    const match = normalizeRouteGraphMatchSpec(route.match || parseRouteGraphMatchSpec(route.matchSpec));
    const backend = normalizeRouteGraphBackendSpec(route.backend || parseRouteGraphBackendSpec(route.backendSpec));
    if (backend.kind === ROUTE_GRAPH_BACKEND_KIND_ROUTES) {
      macros.push(buildCandidateSelectorMacroFromRouteProjection({
        id: routeId,
        stableId: `route:${routeId}:model-group`,
        displayName: route.displayName || match.displayName || match.requestedModelPattern || `Route ${routeId}`,
        displayIcon: route.displayIcon || null,
        visibility: 'public',
        enabled: route.enabled !== false,
        routingStrategy: route.routingStrategy || 'weighted',
        routeIds: backend.routeIds,
        ownership: route.ownership || 'manual',
      }));
      continue;
    }

    const entryId = legacyRouteIdToRouteGraphEntryNodeId(routeId);
    const dispatcherId = `dispatcher:legacy:${routeId}`;
    const modelEndpointId = legacyRouteIdToRouteGraphPoolNodeId(routeId);
    pushNode({
      id: entryId,
      type: 'entry',
      name: route.displayName || match.displayName || match.requestedModelPattern || `Route ${routeId}`,
      enabled: route.enabled !== false,
      visibility: 'public',
      ownership: route.ownership || 'manual',
      match,
      selectionStrategy: route.routingStrategy || 'weighted',
      provenance: route.provenance || { source: 'legacy', routeId },
    });
    pushNode({
      id: dispatcherId,
      type: 'dispatcher',
      name: `${route.displayName || match.displayName || match.requestedModelPattern || routeId} dispatcher`,
      enabled: route.enabled !== false,
      visibility: 'internal',
      ownership: route.ownership || 'manual',
      mode: 'route',
      ordering: 'explicit',
      policy: { strategy: route.routingStrategy || 'weighted' },
      provenance: route.provenance || { source: 'legacy', routeId },
    });
    pushNode({
      id: modelEndpointId,
      type: 'model_endpoint',
      name: `${route.displayName || match.displayName || match.requestedModelPattern || routeId} endpoint`,
      enabled: route.enabled !== false,
      visibility: 'internal',
      ownership: route.ownership || 'manual',
      routeNodeId: entryId,
      legacyRouteId: routeId,
      metadata: {},
      config: {
        targets: Array.isArray(route.targets) ? route.targets : [],
        targetSelection: { strategy: 'defer_to_router' },
      },
      provenance: route.provenance || { source: 'legacy', routeId },
    });
    edges.push(normalizeRouteGraphEdge({
      id: `edge:${modelEndpointId}:route.out:${dispatcherId}:route.in`,
      sourceNodeId: modelEndpointId,
      sourcePortId: 'route.out',
      targetNodeId: dispatcherId,
      targetPortId: 'route.in',
      kind: 'route_flow',
      ownership: route.ownership || 'manual',
    }));
    edges.push(normalizeRouteGraphEdge({
      id: `edge:${entryId}:bidirect.out:${dispatcherId}:bidirect.in`,
      sourceNodeId: entryId,
      sourcePortId: 'bidirect.out',
      targetNodeId: dispatcherId,
      targetPortId: 'bidirect.in',
      kind: 'bidirect_flow',
      ownership: route.ownership || 'manual',
    }));
  }
  return normalizeRouteGraphSource({ version: ROUTE_GRAPH_SCHEMA_VERSION, nodes: Array.from(nodesById.values()), edges, macros });
}
