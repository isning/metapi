import { normalizeTokenRouteMode } from './tokenRouteContract.js';
import {
  isExactTokenRouteModelPattern,
  matchesTokenRouteModelPattern,
} from './tokenRoutePatterns.js';

export const ROUTE_GRAPH_SCHEMA_VERSION = 1;
export const ROUTE_GRAPH_MATCH_KIND_MODEL = 'model';
export const ROUTE_GRAPH_BACKEND_KIND_SUPPLY = 'supply';
export const ROUTE_GRAPH_BACKEND_KIND_ROUTES = 'routes';
export const ROUTE_GRAPH_NODE_TYPES = Object.freeze([
  'entry',
  'route_endpoint',
  'filter',
  'dispatcher',
  'synthetic_endpoint',
  'auto_node',
]);
export const ROUTE_GRAPH_TERMINAL_NODE_TYPES = Object.freeze(['route_endpoint', 'synthetic_endpoint', 'auto_node']);
export const ROUTE_GRAPH_SELECTION_STRATEGIES = Object.freeze([
  'priority_order',
  'weighted',
  'round_robin',
  'stable_first',
]);
export const ROUTE_GRAPH_VISIBILITIES = Object.freeze(['public', 'internal']);
export const ROUTE_GRAPH_ENDPOINT_KINDS = Object.freeze(['supply', 'route_product']);
export const ROUTE_GRAPH_ENDPOINT_EXPOSURES = Object.freeze(['none', 'public', 'internal']);
export const ROUTE_GRAPH_ENDPOINT_RESOLUTION_STATUSES = Object.freeze(['resolved', 'degraded', 'unresolved']);
export const ROUTE_GRAPH_ENDPOINT_SOURCE_KINDS = Object.freeze([
  'upstream_model',
  'automatic_model_group',
  'manual_group',
  'synthetic',
  'inline',
]);
export const ROUTE_GRAPH_OWNERSHIPS = Object.freeze(['manual', 'auto_generated', 'system', 'derived']);
export const ROUTE_GRAPH_PORT_KINDS = Object.freeze([
  'request',
  'bidirect',
  'route',
]);
export const ROUTE_GRAPH_EDGE_KINDS = Object.freeze([
  'request_flow',
  'bidirect_flow',
  'route_flow',
]);
export const ROUTE_GRAPH_MACRO_KINDS = Object.freeze(['candidate_selector']);
export const ROUTE_PROGRAM_BUNDLE_VERSION = 1;
export const ROUTE_FLAT_PROGRAM_BUNDLE_VERSION = 1;
export const ROUTE_GRAPH_CANDIDATE_SELECTOR_INPUT_KINDS = Object.freeze([
  'route_endpoints',
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
      multiple: true,
    },
    {
      id: 'candidates.in',
      label: 'candidate inputs',
      direction: 'input',
      kind: 'route',
      multiple: true,
      collection: { type: 'set', min: 1 },
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
});

const ROUTE_GRAPH_DEFAULT_PORTS = Object.freeze({
  entry: [
    { id: 'bidirect.out', label: 'matched flow', direction: 'output', kind: 'bidirect' },
  ],
  route_endpoint: [
    { id: 'route.out', label: 'route product', direction: 'output', kind: 'route' },
    { id: 'bidirect.in', label: 'invoke route', direction: 'input', kind: 'bidirect', multiple: true },
  ],
  filter: [
    { id: 'request.in', label: 'before mutation', direction: 'input', kind: 'request' },
    { id: 'request.out', label: 'after mutation', direction: 'output', kind: 'request' },
    { id: 'bidirect.in', label: 'before round trip', direction: 'input', kind: 'bidirect' },
    { id: 'bidirect.out', label: 'after round trip', direction: 'output', kind: 'bidirect' },
  ],
  dispatcher: [
    { id: 'bidirect.in', label: 'dispatch input', direction: 'input', kind: 'bidirect', required: true },
    { id: 'bidirect[1...].out', label: 'dispatch path', direction: 'output', kind: 'bidirect', multiple: true, collection: { type: 'arr', min: 1 } },
    { id: 'route.in', label: 'endpoint candidates', direction: 'input', kind: 'route', multiple: true, collection: { type: 'set', min: 1 } },
  ],
  synthetic_endpoint: [
    { id: 'route.out', label: 'synthetic target', direction: 'output', kind: 'route' },
    { id: 'bidirect.in', label: 'return response', direction: 'input', kind: 'bidirect', multiple: true },
  ],
  auto_node: [
    { id: 'route.in', label: 'candidate targets', direction: 'input', kind: 'route', multiple: true, collection: { type: 'set' } },
    { id: 'bidirect.in', label: 'route input', direction: 'input', kind: 'bidirect' },
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

function normalizeNonNegativeInteger(input) {
  const value = Number(input);
  if (!Number.isFinite(value)) return null;
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : null;
}

function normalizeEnum(input, allowed, fallback) {
  return allowed.includes(input) ? input : fallback;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeRouteGraphPort(input) {
  const raw = isPlainObject(input) ? input : {};
  const kind = normalizeEnum(raw.kind, ROUTE_GRAPH_PORT_KINDS, 'request');
  const direction = raw.direction === 'output' ? 'output' : 'input';
  const collection = isPlainObject(raw.collection)
    ? normalizeRouteGraphPortCollection(raw.collection)
    : undefined;
  return {
    id: normalizeString(raw.id),
    label: normalizeString(raw.label) || normalizeString(raw.id) || kind,
    direction,
    kind,
    ...(raw.required === true ? { required: true } : {}),
    ...(raw.multiple === true ? { multiple: true } : {}),
    ...(collection ? { collection } : {}),
    ...(raw.readonly === true ? { readonly: true } : {}),
    ...(raw.enabled === false ? { enabled: false } : {}),
    ...(normalizeString(raw.description) ? { description: normalizeString(raw.description) } : {}),
  };
}

function normalizeRouteGraphPortCollection(input) {
  const raw = isPlainObject(input) ? input : {};
  const type = normalizeEnum(raw.type, ['single', 'arr', 'set'], 'single');
  if (type === 'single') return { type };
  const min = normalizeNonNegativeInteger(raw.min);
  const max = normalizeNonNegativeInteger(raw.max);
  return {
    type,
    ...(min !== null ? { min } : {}),
    ...(max !== null ? { max } : {}),
  };
}

export function getRouteGraphPortConnectionBounds(port) {
  const collection = port?.collection;
  if (collection && (collection.type === 'arr' || collection.type === 'set')) {
    return {
      min: typeof collection.min === 'number' ? collection.min : 0,
      max: typeof collection.max === 'number' ? collection.max : Infinity,
      collection: true,
    };
  }
  return {
    min: 0,
    max: port?.multiple === true ? Infinity : 1,
    collection: false,
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
  return { kind: ROUTE_GRAPH_BACKEND_KIND_SUPPLY };
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
      kind: ROUTE_GRAPH_BACKEND_KIND_SUPPLY,
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
  if (normalizedBackend.kind !== ROUTE_GRAPH_BACKEND_KIND_SUPPLY) return false;
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

function canonicalRouteGraphModelKey(model) {
  return normalizeString(model).toLowerCase();
}

function routeGraphEndpointSafeId(value) {
  return String(value || 'x')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'x';
}

function routeGraphEndpointHash(value) {
  const input = typeof value === 'string' ? value : stableJson(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function routeGraphAutoModelProductEndpointId(canonicalModelKey) {
  return `route-endpoint:product:auto-model:${routeGraphEndpointSafeId(canonicalModelKey)}`;
}

export function routeGraphSupplyEndpointIdFromRoute(routeId) {
  return `route-endpoint:supply:route:${Number(routeId)}`;
}

export function routeGraphSupplyEndpointIdFromIdentity(identity, fallbackRouteId) {
  if (!isPlainObject(identity)) return routeGraphSupplyEndpointIdFromRoute(fallbackRouteId);
  const firstTarget = Array.isArray(identity.targets) && isPlainObject(identity.targets[0]) ? identity.targets[0] : {};
  const modelSlug = routeGraphEndpointSafeId(identity.model || identity.modelName || firstTarget.model || firstTarget.modelName || 'request-model');
  const providerSlug = routeGraphEndpointSafeId(identity.provider || identity.platform || identity.sitePlatform || firstTarget.provider || firstTarget.platform || firstTarget.sitePlatform || 'upstream');
  const credentialSlug = routeGraphEndpointSafeId(identity.credentialFingerprint || identity.credential || identity.account || identity.token || firstTarget.credentialFingerprint || firstTarget.credential || firstTarget.account || firstTarget.token || 'credential');
  const fingerprint = routeGraphEndpointHash(identity);
  return `route-endpoint:supply:upstream-model:${providerSlug}:${credentialSlug}:${modelSlug}:${fingerprint}`;
}

export function routeGraphRouteProductEndpointIdFromRoute(routeId) {
  return `route-endpoint:product:route:${Number(routeId)}`;
}

function routeGraphAutoModelMacroId(canonicalModelKey) {
  return `auto-model:${routeGraphEndpointSafeId(canonicalModelKey)}`;
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

function normalizeRouteExecutableTarget(input) {
  const raw = isPlainObject(input) ? input : {};
  const targetId = normalizeString(raw.targetId || raw.id);
  const model = normalizeString(raw.model || raw.sourceModel);
  const modelSource = normalizeEnum(raw.modelSource, ['fixed', 'request'], model ? 'fixed' : 'request');
  const tokenId = normalizePositiveInteger(raw.tokenId);
  const accountId = normalizePositiveInteger(raw.accountId);
  const siteId = normalizePositiveInteger(raw.siteId);
  return {
    targetId,
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

function normalizeRouteExecutableTargetConfig(input) {
  const raw = isPlainObject(input) ? input : {};
  const targets = Array.isArray(raw.targets)
    ? raw.targets.map(normalizeRouteExecutableTarget).filter((target) => target.targetId && (target.model || target.modelSource === 'request'))
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
  if (type === 'route_endpoint') {
    const routeId = normalizePositiveInteger(raw.routeId || raw.legacyRouteId || raw.match?.routeId);
    const routeEndpointId = normalizeString(raw.routeEndpointId || raw.endpointId || raw.id);
    const hasExecutableTargets = Array.isArray(raw.config?.targets) && raw.config.targets.length > 0;
    const endpointKind = normalizeEnum(raw.endpointKind, ROUTE_GRAPH_ENDPOINT_KINDS, hasExecutableTargets ? 'supply' : 'route_product');
    const exposure = endpointKind === 'supply'
      ? 'none'
      : normalizeEnum(raw.exposure || raw.visibility, ROUTE_GRAPH_ENDPOINT_EXPOSURES, 'internal');
    const resolvesTo = isPlainObject(raw.resolvesTo)
      ? {
        kind: normalizeEnum(raw.resolvesTo.kind, ['route_builder', 'synthetic', 'external'], 'external'),
        id: normalizeString(raw.resolvesTo.id),
      }
      : undefined;
    return {
      ...base,
      type,
      visibility: 'internal',
      routeEndpointId,
      endpointId: routeEndpointId,
      routeId,
      legacyRouteId: routeId,
      endpointKind,
      exposure,
      resolutionStatus: normalizeEnum(raw.resolutionStatus, ROUTE_GRAPH_ENDPOINT_RESOLUTION_STATUSES, 'resolved'),
      ownerKind: normalizeEnum(raw.ownerKind, ['automatic_route', 'manual_route', 'macro'], raw.ownership === 'auto_generated' ? 'automatic_route' : 'manual_route'),
      sourceKind: normalizeEnum(raw.sourceKind, ROUTE_GRAPH_ENDPOINT_SOURCE_KINDS, endpointKind === 'supply' ? 'upstream_model' : 'manual_group'),
      ...(resolvesTo && resolvesTo.id ? { resolvesTo } : {}),
      backend: normalizeRouteGraphBackendSpec(raw.backend),
      match: isPlainObject(raw.match) ? normalizeRouteGraphMatchSpec(raw.match) : undefined,
      config: normalizeRouteExecutableTargetConfig(raw.config),
      ...(isPlainObject(raw.compatibilityPolicy) ? { compatibilityPolicy: raw.compatibilityPolicy } : {}),
      metadata: isPlainObject(raw.metadata) ? raw.metadata : {},
      provenance: isPlainObject(raw.provenance) ? raw.provenance : { source: 'manual' },
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
      routeEndpointId: normalizeString(raw.routeEndpointId || raw.id),
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
  const kind = normalizeEnum(raw.kind, ROUTE_GRAPH_CANDIDATE_SELECTOR_INPUT_KINDS, 'route_endpoints');
  if (kind === 'route_endpoints') {
    const endpointIds = Array.isArray(raw.endpointIds)
      ? raw.endpointIds.map((value) => normalizeString(value)).filter(Boolean)
      : [];
    return {
      kind,
      endpointIds: Array.from(new Set(endpointIds)),
    };
  }
  if (kind === 'model_pattern') {
    return { kind, pattern: normalizeString(raw.pattern) };
  }
  if (kind === 'metadata_query' || kind === 'endpoint_query') {
    return { kind, cel: normalizeString(raw.cel) };
  }
  if (kind === 'inline_endpoints') {
    const endpoints = Array.isArray(raw.endpoints)
      ? raw.endpoints.map(normalizeRouteExecutableTarget).filter((target) => target.targetId && (target.model || target.modelSource === 'request'))
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
  return { kind: 'route_endpoints', endpointIds: [] };
}

function normalizeMacroSurfacePort(input) {
  const raw = isPlainObject(input) ? input : {};
  const kind = normalizeEnum(raw.kind, ROUTE_GRAPH_PORT_KINDS, 'request');
  return normalizeRouteGraphPort({
    id: normalizeString(raw.id),
    label: normalizeString(raw.label) || normalizeString(raw.id) || kind,
    direction: raw.direction === 'output' ? 'output' : 'input',
    kind,
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

function normalizeCandidateOverride(input) {
  const raw = isPlainObject(input) ? input : {};
  const override = {};
  if (normalizeString(raw.groupId)) override.groupId = normalizeString(raw.groupId);
  if (Number.isFinite(Number(raw.priority))) override.priority = Math.trunc(Number(raw.priority));
  if (Number.isFinite(Number(raw.weight))) override.weight = Number(raw.weight);
  if (raw.enabled === true || raw.enabled === false) override.enabled = raw.enabled;
  if (raw.excluded === true) override.excluded = true;
  return override;
}

function normalizeCandidateOverrideMap(input) {
  if (!isPlainObject(input)) return undefined;
  const entries = Object.entries(input)
    .map(([endpointId, override]) => [normalizeString(endpointId), normalizeCandidateOverride(override)])
    .filter(([endpointId, override]) => endpointId && Object.keys(override).length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeCandidateOverrides(input) {
  const raw = isPlainObject(input) ? input : {};
  const bySupplyEndpointId = normalizeCandidateOverrideMap(raw.bySupplyEndpointId);
  const byEndpointId = normalizeCandidateOverrideMap(raw.byEndpointId);
  return {
    ...(bySupplyEndpointId ? { bySupplyEndpointId } : {}),
    ...(byEndpointId ? { byEndpointId } : {}),
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
  const candidateOverrides = normalizeCandidateOverrides(raw.candidateOverrides);
  const rawFilters = isPlainObject(raw.filters) ? raw.filters : {};
  const filterOperations = Array.isArray(rawFilters.operations)
    ? rawFilters.operations.map(normalizeRouteFilter)
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
    ...(filterOperations.length > 0 ? { filters: { operations: filterOperations } } : {}),
    groups,
    ...(Object.keys(candidateOverrides).length > 0 ? { candidateOverrides } : {}),
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

export function buildCandidateSelectorMacroFromRouteBinding(input) {
  const endpointIds = Array.isArray(input?.endpointIds)
    ? Array.from(new Set(input.endpointIds.map((value) => normalizeString(value)).filter(Boolean)))
    : [];
  const rawCandidateBands = Array.isArray(input?.candidateBands)
    ? input.candidateBands
    : [];
  const candidateBands = rawCandidateBands.length > 0
    ? rawCandidateBands.map((band, index) => {
      const bandEndpointIds = Array.isArray(band?.endpointIds)
        ? Array.from(new Set(band.endpointIds.map((value) => normalizeString(value)).filter(Boolean)))
        : [];
      const priority = Number.isFinite(Number(band?.priority)) ? Math.trunc(Number(band.priority)) : index;
      return {
        id: normalizeString(band?.id) || `priority:${priority}`,
        label: normalizeNullableString(band?.label) || `Priority ${priority}`,
        enabled: band?.enabled !== false,
        priority,
        weight: Number.isFinite(Number(band?.weight)) ? Number(band.weight) : 10,
        endpointIds: bandEndpointIds,
      };
    }).filter((band) => band.endpointIds.length > 0)
    : [];
  const candidateGroups = candidateBands.length > 0
    ? candidateBands
    : endpointIds.map((endpointId, index) => ({
      id: `source:${macroSafeId(endpointId)}`,
      label: `Endpoint ${endpointId}`,
      enabled: true,
      priority: index,
      weight: 10,
      endpointIds: [endpointId],
    }));
  const displayName = normalizeNullableString(input?.displayName) || null;
  const match = normalizeRouteGraphMatchSpec(input?.match);
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
        entry: normalizeEnum(input?.visibility, ROUTE_GRAPH_VISIBILITIES, 'public') === 'public'
          ? {
            kind: 'external',
            visibility: 'public',
            match: {
              kind: 'model',
              requestedModelPattern: match.requestedModelPattern || '',
              displayName: displayName ?? match.displayName,
              ...(normalizePositiveInteger(input?.id) ? { routeId: normalizePositiveInteger(input.id) } : {}),
            },
          }
          : { kind: 'embedded', input: 'bidirect' },
        output: 'route',
        ports: buildCandidateSelectorDefaultSurfacePorts({
          entry: normalizeEnum(input?.visibility, ROUTE_GRAPH_VISIBILITIES, 'public') === 'public'
            ? { kind: 'external', visibility: 'public' }
            : { kind: 'embedded', input: 'bidirect' },
          output: 'route',
        }).map((port) => normalizeMacroSurfacePort(port)),
      },
      policy: {
        strategy: normalizeEnum(input?.routingStrategy, ROUTE_GRAPH_CANDIDATE_SELECTOR_STRATEGIES, 'weighted'),
      },
      groups: candidateGroups.map((group) => ({
        id: group.id,
        label: group.label,
        enabled: group.enabled,
        priority: group.priority,
        input: { kind: 'route_endpoints', endpointIds: group.endpointIds },
        defaults: {
          enabled: true,
          weight: group.weight,
          priority: group.priority,
        },
      })),
      ...(normalizeNullableString(input?.displayIcon) ? { presentation: { displayIcon: normalizeNullableString(input.displayIcon) } } : {}),
    },
    ...(isPlainObject(input?.metadata) ? { metadata: input.metadata } : {}),
  });
}

export function normalizeRouteGraphSource(input) {
  const raw = isPlainObject(input) ? input : {};
  const edges = Array.isArray(raw.edges) ? raw.edges.map(normalizeRouteGraphEdge) : [];
  return {
    version: ROUTE_GRAPH_SCHEMA_VERSION,
    nodes: Array.isArray(raw.nodes) ? raw.nodes.map(normalizeRouteGraphNode) : [],
    edges: Array.from(new Map(edges.map((edge) => [edge.id, edge])).values()),
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

function formatPortBound(value) {
  return Number.isFinite(value) ? String(value) : 'unbounded';
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
    if (sourcePort.kind !== targetPort.kind) {
      addDiagnostic(diagnostics, 'error', 'edge.incompatible_ports', `${sourcePort.kind} cannot connect to ${targetPort.kind}.`, edge.targetNodeId, edge.id);
      continue;
    }
    const key = `${edge.sourceNodeId}\u0000${edge.sourcePortId}\u0000${edge.targetNodeId}\u0000${edge.targetPortId}`;
    if (dedupe.has(key)) {
      addDiagnostic(diagnostics, 'warning', 'edge.duplicate', 'Duplicate edge ignored by compiler.', edge.sourceNodeId, edge.id);
      continue;
    }
    const incomingKey = `${edge.targetNodeId}\u0000${edge.targetPortId}`;
    const incomingCount = incomingByPort.get(incomingKey)?.count || 0;
    const bounds = getRouteGraphPortConnectionBounds(targetPort);
    if (incomingCount >= bounds.max) {
      const code = bounds.collection ? 'edge.collection_max' : 'edge.duplicate_input';
      const message = bounds.collection
        ? `Input port ${edge.targetPortId} on ${edge.targetNodeId} allows at most ${formatPortBound(bounds.max)} connections.`
        : `Input port ${edge.targetPortId} on ${edge.targetNodeId} already has a connection.`;
      addDiagnostic(diagnostics, 'error', code, message, edge.targetNodeId, edge.id);
      continue;
    }
    incomingByPort.set(incomingKey, {
      nodeId: edge.targetNodeId,
      portId: edge.targetPortId,
      count: incomingCount + 1,
    });
    const expectedKind = inferEdgeKindFromPorts(sourcePort, targetPort);
    if (edge.kind !== expectedKind) {
      addDiagnostic(diagnostics, 'warning', 'edge.kind_mismatch', `Edge kind ${edge.kind} does not match port flow ${expectedKind}.`, edge.sourceNodeId, edge.id);
    }
    dedupe.add(key);
    adjacency.get(edge.sourceNodeId).push(edge.targetNodeId);
  }
  for (const node of nodesById.values()) {
    for (const port of getRouteGraphNodePorts(node)) {
      if (port.enabled === false || port.direction !== 'input') continue;
      const bounds = getRouteGraphPortConnectionBounds(port);
      if (bounds.min <= 0) continue;
      const incomingKey = `${node.id}\u0000${port.id}`;
      const count = incomingByPort.get(incomingKey)?.count || 0;
      if (count < bounds.min) {
        addDiagnostic(
          diagnostics,
          'error',
          'port.collection_min',
          `Input port ${port.id} on ${node.id} requires at least ${formatPortBound(bounds.min)} connections.`,
          node.id,
        );
      }
    }
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

function publicEntryResolutionInfo(node, backend) {
  const routeId = legacyRouteIdFromRouteGraphNode(node);
  const normalizedBackend = normalizeRouteGraphBackendSpec(backend);
  const isExplicitGroupEntry = normalizedBackend.kind === ROUTE_GRAPH_BACKEND_KIND_ROUTES
    && normalizedBackend.routeIds.some((sourceRouteId) => sourceRouteId !== routeId);
  const isAutoModelEntry = /^macro:auto-model:[^:]+:entry$/.test(String(node?.id || ''));
  return {
    nodeId: node.id,
    backendKind: normalizedBackend.kind,
    isMacroEntry: String(node.id || '').startsWith('macro:'),
    routeId,
    isExplicitGroupEntry,
    isAutoModelEntry,
  };
}

function canPublicEntryOverrideDuplicate(left, right) {
  return (left.isExplicitGroupEntry && right.isAutoModelEntry)
    || (right.isExplicitGroupEntry && left.isAutoModelEntry);
}

function shouldPreferPublicEntryResolution(existing, next) {
  if (!existing) return true;
  return (
    (existing.backendKind === ROUTE_GRAPH_BACKEND_KIND_SUPPLY && next.backendKind === ROUTE_GRAPH_BACKEND_KIND_ROUTES)
    || (!existing.isMacroEntry && next.isMacroEntry)
    || (next.isExplicitGroupEntry && existing.isAutoModelEntry)
  );
}

function legacyRouteIdFromRouteGraphNode(node) {
  if (!node) return null;
  if (Number.isFinite(Number(node.legacyRouteId)) && Number(node.legacyRouteId) > 0) {
    return Math.trunc(Number(node.legacyRouteId));
  }
  if (node.type === 'route_endpoint' && Number.isFinite(Number(node.routeId)) && Number(node.routeId) > 0) {
    return Math.trunc(Number(node.routeId));
  }
  if (node.type === 'entry' && Number.isFinite(Number(node.match?.routeId)) && Number(node.match.routeId) > 0) {
    return Math.trunc(Number(node.match.routeId));
  }
  const match = /^(?:entry):legacy:(\d+)$/.exec(String(node.id || ''));
  if (!match) return null;
  const routeId = Number(match[1]);
  return Number.isFinite(routeId) && routeId > 0 ? routeId : null;
}

function routeIdsFromRouteGraphCandidateNode(node) {
  if (!node) return [];
  if (node.type === 'route_endpoint') {
    const backend = normalizeRouteGraphBackendSpec(node.backend);
    if (backend.kind === ROUTE_GRAPH_BACKEND_KIND_ROUTES) return backend.routeIds;
  }
  const routeId = legacyRouteIdFromRouteGraphNode(node);
  return routeId ? [routeId] : [];
}

function inferMacroIdFromGeneratedNodeId(nodeId) {
  const value = normalizeString(nodeId);
  if (!value.startsWith('macro:')) return '';
  const body = value.slice('macro:'.length);
  if (body.endsWith(':entry')) return body.slice(0, -':entry'.length);
  if (body.endsWith(':dispatcher')) return body.slice(0, -':dispatcher'.length);
  const candidateIndex = body.indexOf(':candidate:');
  if (candidateIndex >= 0) return body.slice(0, candidateIndex);
  const edgeIndex = body.indexOf(':edge:');
  if (edgeIndex >= 0) return body.slice(0, edgeIndex);
  return '';
}

function routeProgramSourceRefFromNode(node, extra = {}) {
  const metadata = isPlainObject(node?.metadata) ? node.metadata : {};
  const provenance = isPlainObject(node?.provenance) ? node.provenance : {};
  const macroCandidate = isPlainObject(metadata.macroCandidate) ? metadata.macroCandidate : {};
  const routeId = normalizePositiveInteger(
    extra.routeId
      || node?.routeId
      || node?.legacyRouteId
      || node?.match?.routeId
      || macroCandidate.routeId
      || provenance.routeId,
  );
  const macroId = normalizeString(
    extra.macroId
      || provenance.macroId
      || macroCandidate.macroId
      || inferMacroIdFromGeneratedNodeId(node?.id),
  );
  const nodeId = normalizeString(extra.nodeId || node?.id);
  return {
    ...(nodeId ? { nodeId } : {}),
    ...(normalizeString(extra.edgeId) ? { edgeId: normalizeString(extra.edgeId) } : {}),
    ...(macroId ? { macroId } : {}),
    ...(normalizeString(extra.endpointId || node?.routeEndpointId || node?.endpointId) ? { endpointId: normalizeString(extra.endpointId || node?.routeEndpointId || node?.endpointId) } : {}),
    routeId: routeId || null,
    ...(node?.ownership === 'derived' && nodeId ? { generatedNodeIds: [nodeId] } : {}),
    ...(Array.isArray(extra.generatedNodeIds) && extra.generatedNodeIds.length > 0 ? { generatedNodeIds: Array.from(new Set(extra.generatedNodeIds.map(normalizeString).filter(Boolean))) } : {}),
    ...(Array.isArray(extra.generatedEdgeIds) && extra.generatedEdgeIds.length > 0 ? { generatedEdgeIds: Array.from(new Set(extra.generatedEdgeIds.map(normalizeString).filter(Boolean))) } : {}),
  };
}

function routeProgramSourceRefFromEdge(edge) {
  const metadata = isPlainObject(edge?.metadata) ? edge.metadata : {};
  const provenance = isPlainObject(metadata.provenance) ? metadata.provenance : {};
  return {
    ...(normalizeString(edge?.sourceNodeId) ? { nodeId: normalizeString(edge.sourceNodeId) } : {}),
    ...(normalizeString(edge?.id) ? { edgeId: normalizeString(edge.id) } : {}),
    ...(normalizeString(provenance.macroId) ? { macroId: normalizeString(provenance.macroId) } : {}),
    ...(edge?.ownership === 'derived' && normalizeString(edge?.id) ? { generatedEdgeIds: [normalizeString(edge.id)] } : {}),
  };
}

function routeProgramIdForEntry(entry) {
  return `program:${normalizeString(entry?.nodeId)}`;
}

function routeProgramMatcherTarget(program, entry, rootEndpointId, node) {
  return {
    programId: program.id,
    entryNodeId: entry.nodeId,
    publicModelName: entry.publicModelName,
    ...(rootEndpointId ? { rootEndpointId } : {}),
    sourceRef: routeProgramSourceRefFromNode(node, { routeId: entry.match?.routeId }),
  };
}

function isExactRouteProgramEntry(entry) {
  if (normalizeString(entry?.match?.displayName)) return true;
  return isExactTokenRouteModelPattern(entry?.match?.requestedModelPattern || entry?.publicModelName || '');
}

function inferRouteProductEndpointForEntry(entry, routeProducts) {
  const publicName = normalizeString(entry?.publicModelName);
  const entryRouteId = normalizePositiveInteger(entry?.match?.routeId);
  const macroCandidates = routeProducts.filter((endpoint) => (
    endpoint.resolvesTo?.kind === 'route_builder'
    && `macro:${macroSafeId(endpoint.resolvesTo.id)}:entry` === entry.nodeId
  ));
  if (macroCandidates.length > 0) return macroCandidates[0];

  const routeCandidates = entryRouteId
    ? routeProducts.filter((endpoint) => normalizePositiveInteger(endpoint.routeId) === entryRouteId)
    : [];
  if (routeCandidates.length > 0) return routeCandidates[0];

  const publicNameCandidates = publicName
    ? routeProducts.filter((endpoint) => normalizeString(endpoint.publicModelName).toLowerCase() === publicName.toLowerCase())
    : [];
  return publicNameCandidates[0] || null;
}

function routeProgramEndpointIdForNode(node) {
  if (!node) return '';
  if (node.type === 'route_endpoint') return node.routeEndpointId || node.endpointId || node.id;
  if (node.type === 'synthetic_endpoint') return `synthetic:${node.id}`;
  return node.id;
}

function compiledEndpointTargetsForRouteEndpointNode(targetNode, endpointId, routeId) {
  if (!targetNode || targetNode.type !== 'route_endpoint') return [];
  const targets = Array.isArray(targetNode.config?.targets) ? targetNode.config.targets : [];
  return targets.map((target, index) => {
    const rawTargetId = normalizeString(target.targetId || target.id || index);
    const compiledTargetId = `${endpointId}:target:${index}:${macroSafeId(rawTargetId || index)}`;
    return {
      endpointId,
      targetId: compiledTargetId,
      nodeId: targetNode.id,
      model: normalizeString(target.model),
      modelSource: target.modelSource === 'request' ? 'request' : 'fixed',
      enabled: target.enabled !== false && targetNode.enabled !== false,
      routeId: normalizePositiveInteger(routeId || targetNode.legacyRouteId) || null,
      ...(target.accountId !== undefined ? { accountId: target.accountId } : {}),
      ...(target.tokenId !== undefined ? { tokenId: target.tokenId } : {}),
      ...(target.siteId !== undefined ? { siteId: target.siteId } : {}),
      ...(Number.isFinite(Number(target.weight)) ? { weight: Number(target.weight) } : {}),
      ...(Number.isFinite(Number(target.priority)) ? { priority: Number(target.priority) } : {}),
      ...(isPlainObject(target.metadata) ? { metadata: target.metadata } : {}),
      ...(isPlainObject(target.compatibilityPolicy)
        ? { compatibilityPolicy: target.compatibilityPolicy }
        : (isPlainObject(targetNode.config?.compatibilityPolicy) ? { compatibilityPolicy: targetNode.config.compatibilityPolicy } : {})),
      sourceRef: routeProgramSourceRefFromNode(targetNode, {
        endpointId,
        routeId: routeId || targetNode.legacyRouteId,
        generatedNodeIds: targetNode.ownership === 'derived' ? [targetNode.id] : [],
      }),
    };
  });
}

function compiledEndpointTargetsForRouteEndpoint(endpoint, endpointNode, nodesById) {
  const targetNode = endpointNode?.type === 'route_endpoint'
    && Array.isArray(endpointNode.config?.targets)
    && endpointNode.config.targets.length > 0
    ? endpointNode
    : null;
  return compiledEndpointTargetsForRouteEndpointNode(targetNode, endpoint.endpointId, endpoint.routeId)
    .map((target) => ({
      ...target,
      enabled: target.enabled && endpoint.enabled !== false,
    }));
}

function buildRouteProgramDebugInfo(semanticSource, primitiveSource) {
  const generatedByMacro = {};
  const addMacroGeneratedNode = (macroId, nodeId) => {
    if (!macroId || !nodeId) return;
    if (!generatedByMacro[macroId]) generatedByMacro[macroId] = { nodeIds: [], edgeIds: [] };
    if (!generatedByMacro[macroId].nodeIds.includes(nodeId)) generatedByMacro[macroId].nodeIds.push(nodeId);
  };
  const addMacroGeneratedEdge = (macroId, edgeId) => {
    if (!macroId || !edgeId) return;
    if (!generatedByMacro[macroId]) generatedByMacro[macroId] = { nodeIds: [], edgeIds: [] };
    if (!generatedByMacro[macroId].edgeIds.includes(edgeId)) generatedByMacro[macroId].edgeIds.push(edgeId);
  };
  const sourceRefs = {};
  for (const node of primitiveSource.nodes || []) {
    const ref = routeProgramSourceRefFromNode(node);
    sourceRefs[`node:${node.id}`] = ref;
    if (ref.macroId && node.ownership === 'derived') addMacroGeneratedNode(ref.macroId, node.id);
  }
  for (const edge of primitiveSource.edges || []) {
    const ref = routeProgramSourceRefFromEdge(edge);
    sourceRefs[`edge:${edge.id}`] = ref;
    if (ref.macroId && edge.ownership === 'derived') addMacroGeneratedEdge(ref.macroId, edge.id);
  }
  return {
    sourceHash: stableJson({
      nodes: semanticSource.nodes || [],
      edges: semanticSource.edges || [],
      macros: semanticSource.macros || [],
    }),
    primitiveHash: stableJson({
      nodes: primitiveSource.nodes || [],
      edges: primitiveSource.edges || [],
      macros: primitiveSource.macros || [],
    }),
    sourceRefs,
    generatedByMacro,
  };
}

function routeProgramOpId(programId, suffix) {
  return `${programId}:op:${macroSafeId(suffix)}`;
}

function routeProgramOutgoing(edgesByFromPort, nodeId, sourcePortId) {
  return edgesByFromPort[`${nodeId}:${sourcePortId}`] || [];
}

function routeProgramIncoming(edgesByFromPort, nodeId, targetPortId) {
  return Object.values(edgesByFromPort)
    .flat()
    .filter((edge) => edge.targetNodeId === nodeId && edge.targetPortId === targetPortId);
}

function routeProgramTerminalModelForEndpoint(nodesById, node) {
  if (!node || node.type !== 'route_endpoint') return '';
  if (node.match?.requestedModelPattern && isExactTokenRouteModelPattern(node.match.requestedModelPattern)) {
    return node.match.requestedModelPattern;
  }
  if (node.match?.displayName) return node.match.displayName;
  const routeId = normalizePositiveInteger(node.legacyRouteId || node.routeId);
  if (routeId) {
    const legacyEntry = nodesById[legacyRouteIdToRouteGraphEntryNodeId(routeId)];
    if (legacyEntry?.match?.requestedModelPattern && isExactTokenRouteModelPattern(legacyEntry.match.requestedModelPattern)) {
      return legacyEntry.match.requestedModelPattern;
    }
  }
  return '';
}

function routeProgramTargetSelectionPolicy(node) {
  const config = isPlainObject(node?.config) ? node.config : {};
  return isPlainObject(config.targetSelection) ? config.targetSelection : { strategy: 'weighted' };
}

function routeProgramSupplyEndpointTargetSelectionPolicy(endpointNode, nodesById) {
  const endpointConfig = isPlainObject(endpointNode?.config) ? endpointNode.config : {};
  if (isPlainObject(endpointConfig.targetSelection)) return endpointConfig.targetSelection;
  return { strategy: 'weighted' };
}

function routeProgramEndpointCompatibilityPolicy(node) {
  if (isPlainObject(node?.compatibilityPolicy)) return node.compatibilityPolicy;
  const config = isPlainObject(node?.config) ? node.config : {};
  return isPlainObject(config.compatibilityPolicy) ? config.compatibilityPolicy : undefined;
}

function routeProgramDispatcherPolicy(node) {
  if (isPlainObject(node?.policy)) return node.policy;
  return { strategy: 'weighted' };
}

function routeProgramCandidateBase(input) {
  const metadata = isPlainObject(input.metadata) ? input.metadata : {};
  const weight = Number.isFinite(Number(metadata.weight)) ? Number(metadata.weight) : input.defaultWeight;
  const priority = Number.isFinite(Number(metadata.priority)) ? Number(metadata.priority) : input.defaultPriority;
  return {
    id: input.id,
    kind: input.kind,
    ...(normalizeString(input.nodeId) ? { nodeId: normalizeString(input.nodeId) } : {}),
    ...(normalizeString(input.edgeId) ? { edgeId: normalizeString(input.edgeId) } : {}),
    ...(normalizeString(input.endpointId) ? { endpointId: normalizeString(input.endpointId) } : {}),
    ...(normalizeString(input.targetOpId) ? { targetOpId: normalizeString(input.targetOpId) } : {}),
    ...(input.targetRef ? { targetRef: input.targetRef } : {}),
    enabled: input.enabled !== false,
    weight: Number.isFinite(Number(weight)) ? Number(weight) : 1,
    priority: Number.isFinite(Number(priority)) ? Number(priority) : 0,
    metadata,
    sourceRef: input.sourceRef || {},
  };
}

function buildRouteProgramOpsForEntry(input) {
  const { program, entry, nodesById, edgesByFromPort, diagnostics } = input;
  const opsById = new Map();
  const compiledByState = new Map();
  const entryNode = nodesById[entry.nodeId];

  const addOp = (op) => {
    if (!op?.id) return '';
    opsById.set(op.id, op);
    return op.id;
  };

  const compileFirstAvailableEdges = (ownerNode, sourcePortId, edges, enteredPortId, path) => {
    const activeEdges = edges.filter((edge) => nodesById[edge.targetNodeId]?.enabled !== false);
    if (activeEdges.length === 0) return null;
    if (activeEdges.length === 1) {
      return compileNode(activeEdges[0].targetNodeId, enteredPortId || activeEdges[0].targetPortId, path.concat(ownerNode?.id || 'edge'));
    }
    const opId = routeProgramOpId(program.id, `${ownerNode?.id || 'branch'}:${sourcePortId}:first-available`);
    if (opsById.has(opId)) return opId;
    const candidates = activeEdges.map((edge, index) => {
      const targetNode = nodesById[edge.targetNodeId];
      const targetOpId = compileNode(edge.targetNodeId, edge.targetPortId, path.concat(ownerNode?.id || 'branch', String(index)));
      return routeProgramCandidateBase({
        id: `${opId}:candidate:${index}`,
        kind: 'bidirect',
        nodeId: targetNode?.id,
        edgeId: edge.id,
        targetOpId,
        metadata: isPlainObject(edge.metadata) ? edge.metadata : {},
        enabled: targetNode?.enabled !== false,
        defaultWeight: 1,
        defaultPriority: 0,
        sourceRef: routeProgramSourceRefFromEdge(edge),
      });
    }).filter((candidate) => candidate.targetOpId);
    return addOp({
      id: opId,
      op: 'dispatch',
      mode: 'flow',
      nodeId: ownerNode?.id || entry.nodeId,
      policy: { strategy: 'stable_first' },
      candidates,
      sourceRef: routeProgramSourceRefFromNode(ownerNode || entryNode),
    });
  };

  const compileNode = (nodeId, enteredPortId, path = []) => {
    const node = nodesById[nodeId];
    if (!node || node.enabled === false) return null;
    const stateKey = `${nodeId}\u0000${enteredPortId || ''}`;
    if (compiledByState.has(stateKey)) return compiledByState.get(stateKey);
    if (path.includes(stateKey)) {
      addDiagnostic(diagnostics, 'error', 'program.cycle', `Route program ${program.id} contains a cycle at ${nodeId}.`, nodeId);
      return null;
    }
    compiledByState.set(stateKey, null);

    if (node.type === 'entry') {
      const next = compileFirstAvailableEdges(
        node,
        'bidirect.out',
        routeProgramOutgoing(edgesByFromPort, node.id, 'bidirect.out'),
        'bidirect.in',
        path.concat(stateKey),
      );
      compiledByState.set(stateKey, next);
      return next;
    }

    if (node.type === 'filter') {
      const outboundPort = String(enteredPortId || '').startsWith('request') ? 'request.out' : 'bidirect.out';
      const nextOpId = compileFirstAvailableEdges(
        node,
        outboundPort,
        routeProgramOutgoing(edgesByFromPort, node.id, outboundPort),
        outboundPort === 'request.out' ? 'request.in' : 'bidirect.in',
        path.concat(stateKey),
      );
      const operations = Array.isArray(node.operations) ? node.operations : [];
      const preSelection = operations.filter((operation) => operation.type === 'rewrite_model');
      const postBuild = operations.filter((operation) => operation.type !== 'rewrite_model');
      let currentNextOpId = nextOpId;
      if (postBuild.length > 0) {
        const opId = routeProgramOpId(program.id, `${node.id}:post-build`);
        currentNextOpId = addOp({
          id: opId,
          op: 'filter',
          phase: 'post_build',
          nodeId: node.id,
          operations: postBuild,
          nextOpId: currentNextOpId,
          sourceRef: routeProgramSourceRefFromNode(node),
        });
      }
      if (preSelection.length > 0) {
        const opId = routeProgramOpId(program.id, `${node.id}:pre-selection`);
        currentNextOpId = addOp({
          id: opId,
          op: 'filter',
          phase: 'pre_selection',
          nodeId: node.id,
          operations: preSelection,
          nextOpId: currentNextOpId,
          sourceRef: routeProgramSourceRefFromNode(node),
        });
      }
      if (preSelection.length === 0 && postBuild.length === 0) {
        const opId = routeProgramOpId(program.id, `${node.id}:passthrough`);
        currentNextOpId = addOp({
          id: opId,
          op: 'filter',
          phase: 'post_build',
          nodeId: node.id,
          operations: [],
          nextOpId: currentNextOpId,
          sourceRef: routeProgramSourceRefFromNode(node),
        });
      }
      compiledByState.set(stateKey, currentNextOpId);
      return currentNextOpId;
    }

    if (node.type === 'dispatcher' && node.mode === 'route') {
      const opId = routeProgramOpId(program.id, `${node.id}:dispatch-route`);
      if (opsById.has(opId)) {
        compiledByState.set(stateKey, opId);
        return opId;
      }
      compiledByState.set(stateKey, opId);
      const candidateEdges = routeProgramIncoming(edgesByFromPort, node.id, 'route.in');
      const candidates = candidateEdges.map((edge, index) => {
        const candidateNode = nodesById[edge.sourceNodeId];
        if (!candidateNode) return null;
        const nodeMetadata = isPlainObject(candidateNode.metadata) ? candidateNode.metadata : {};
        const edgeMetadata = isPlainObject(edge.metadata) ? edge.metadata : {};
        const metadata = { ...edgeMetadata, ...nodeMetadata };
        const candidateMetadata = isPlainObject(edgeMetadata.candidate) ? edgeMetadata.candidate : {};
        const targetSelection = isPlainObject(candidateNode.config) && isPlainObject(candidateNode.config.targetSelection)
          ? candidateNode.config.targetSelection
          : {};
        const configWeight = Number(targetSelection.weight);
        const configPriority = Number(targetSelection.priority);
        const candidateWeight = Number(candidateMetadata.weight);
        const candidatePriority = Number(candidateMetadata.priority);
        const targetOpId = compileNode(candidateNode.id, 'route.selected', path.concat(stateKey, String(index)));
        return routeProgramCandidateBase({
          id: `${opId}:candidate:${index}`,
          kind: 'route',
          nodeId: candidateNode.id,
          edgeId: edge.id,
          endpointId: routeProgramEndpointIdForNode(candidateNode),
          targetOpId,
          metadata,
          enabled: candidateNode.enabled !== false && candidateMetadata.enabled !== false && candidateMetadata.excluded !== true,
          defaultWeight: Number.isFinite(candidateWeight) ? candidateWeight : (Number.isFinite(configWeight) ? configWeight : 1),
          defaultPriority: Number.isFinite(candidatePriority) ? Math.trunc(candidatePriority) : (Number.isFinite(configPriority) ? configPriority : 0),
          sourceRef: routeProgramSourceRefFromEdge(edge),
        });
      }).filter(Boolean).filter((candidate) => candidate.targetOpId);
      addOp({
        id: opId,
        op: 'dispatch',
        mode: 'route',
        nodeId: node.id,
        policy: routeProgramDispatcherPolicy(node),
        candidates,
        sourceRef: routeProgramSourceRefFromNode(node),
      });
      return opId;
    }

    if (node.type === 'dispatcher' && node.mode === 'flow') {
      const opId = routeProgramOpId(program.id, `${node.id}:dispatch-flow`);
      if (opsById.has(opId)) {
        compiledByState.set(stateKey, opId);
        return opId;
      }
      compiledByState.set(stateKey, opId);
      const candidateEdges = routeProgramOutgoing(edgesByFromPort, node.id, 'bidirect[1...].out');
      const candidates = candidateEdges.map((edge, index) => {
        const targetNode = nodesById[edge.targetNodeId];
        if (!targetNode) return null;
        const metadata = isPlainObject(edge.metadata) ? edge.metadata : {};
        const targetOpId = compileNode(targetNode.id, edge.targetPortId, path.concat(stateKey, String(index)));
        return routeProgramCandidateBase({
          id: `${opId}:candidate:${index}`,
          kind: 'bidirect',
          nodeId: targetNode.id,
          edgeId: edge.id,
          endpointId: routeProgramEndpointIdForNode(targetNode),
          targetOpId,
          metadata,
          enabled: metadata.enabled !== false,
          defaultWeight: 1,
          defaultPriority: 0,
          sourceRef: routeProgramSourceRefFromEdge(edge),
        });
      }).filter(Boolean).filter((candidate) => candidate.targetOpId);
      addOp({
        id: opId,
        op: 'dispatch',
        mode: 'flow',
        nodeId: node.id,
        policy: routeProgramDispatcherPolicy(node),
        candidates,
        sourceRef: routeProgramSourceRefFromNode(node),
      });
      return opId;
    }

    if (node.type === 'route_endpoint') {
      const hasExecutableTargets = Array.isArray(node.config?.targets) && node.config.targets.length > 0;
      if (node.endpointKind === 'supply' || hasExecutableTargets) {
        const opId = routeProgramOpId(program.id, `${node.id}:select-supply`);
        if (opsById.has(opId)) {
          compiledByState.set(stateKey, opId);
          return opId;
        }
        compiledByState.set(stateKey, opId);
        const endpointId = routeProgramEndpointIdForNode(node);
        const routeId = normalizePositiveInteger(node.routeId || node.legacyRouteId || node.match?.routeId) || null;
        const targets = compiledEndpointTargetsForRouteEndpoint({
          endpointId,
          routeId,
          resolvesTo: node.resolvesTo,
        }, node, nodesById);
        return addOp({
          id: opId,
          op: 'select_supply',
          endpointId,
          nodeId: node.id,
          routeId,
          routeEndpointId: node.id,
          terminalModel: routeProgramTerminalModelForEndpoint(nodesById, node),
          targetSelectionPolicy: routeProgramSupplyEndpointTargetSelectionPolicy(node, nodesById),
          targets,
          ...(routeProgramEndpointCompatibilityPolicy(node) ? { compatibilityPolicy: routeProgramEndpointCompatibilityPolicy(node) } : {}),
          sourceRef: routeProgramSourceRefFromNode(node, { endpointId, routeId }),
        });
      }
      const opId = routeProgramOpId(program.id, `${node.id}:call-product`);
      if (opsById.has(opId)) {
        compiledByState.set(stateKey, opId);
        return opId;
      }
      let targetNodeId = '';
      if (node.resolvesTo?.kind === 'route_builder') targetNodeId = `macro:${macroSafeId(node.resolvesTo.id)}:dispatcher`;
      else if (node.resolvesTo?.kind === 'synthetic') targetNodeId = node.resolvesTo.id;
      const nextOpId = targetNodeId
        ? compileNode(targetNodeId, 'route_endpoint.selected', path.concat(stateKey))
        : null;
      compiledByState.set(stateKey, opId);
      addOp({
        id: opId,
        op: 'call_product',
        endpointId: routeProgramEndpointIdForNode(node),
        nextOpId,
        sourceRef: routeProgramSourceRefFromNode(node),
      });
      return opId;
    }

    if (node.type === 'synthetic_endpoint') {
      const opId = routeProgramOpId(program.id, `${node.id}:synthetic`);
      compiledByState.set(stateKey, opId);
      return addOp({
        id: opId,
        op: 'synthetic',
        nodeId: node.id,
        statusCode: node.statusCode,
        message: node.message,
        sourceRef: routeProgramSourceRefFromNode(node),
      });
    }

    if (node.type === 'auto_node') {
      const opId = routeProgramOpId(program.id, `${node.id}:select-supply`);
      compiledByState.set(stateKey, opId);
      const endpointId = routeProgramEndpointIdForNode(node);
      const routeId = normalizePositiveInteger(node.legacyRouteId) || null;
      return addOp({
        id: opId,
        op: 'select_supply',
        endpointId,
        nodeId: node.id,
        routeId,
        routeEndpointId: normalizeString(node.routeEndpointId) || null,
        terminalModel: '',
        targetSelectionPolicy: { strategy: 'weighted' },
        targets: [],
        ...(routeProgramEndpointCompatibilityPolicy(node) ? { compatibilityPolicy: routeProgramEndpointCompatibilityPolicy(node) } : {}),
        sourceRef: routeProgramSourceRefFromNode(node, { endpointId, routeId }),
      });
    }

    addDiagnostic(diagnostics, 'error', 'program.unsupported_shape', `Route program ${program.id} cannot compile node ${node.id} of type ${node.type}.`, node.id);
    return null;
  };

  const startOpId = compileNode(entry.nodeId, 'entry.match', []);
  return {
    startOpId,
    ops: Array.from(opsById.values()),
  };
}

function buildRouteProgramBundle(input) {
  const semanticSource = normalizeRouteGraphSource(input?.semanticSource);
  const primitiveSource = normalizeRouteGraphSource(input?.primitiveSource);
  const compiledGraph = isPlainObject(input?.compiledGraph) ? input.compiledGraph : {};
  const nodesById = isPlainObject(compiledGraph.nodesById) ? compiledGraph.nodesById : {};
  const routeEndpoints = Array.isArray(compiledGraph.routeEndpoints) ? compiledGraph.routeEndpoints : [];
  const routeProducts = routeEndpoints.filter((endpoint) => endpoint.endpointKind === 'route_product');
  const entries = Array.isArray(compiledGraph.entries) ? compiledGraph.entries : [];
  const diagnostics = [];
  const debug = buildRouteProgramDebugInfo(semanticSource, primitiveSource);
  const programs = [];
  const programByEntryNodeId = new Map();
  const rootEndpointByEntryNodeId = new Map();

  for (const entry of entries) {
    if (entry.enabled === false || entry.visibility !== 'public' || !normalizeString(entry.publicModelName)) continue;
    const entryNode = nodesById[entry.nodeId];
    const rootEndpoint = inferRouteProductEndpointForEntry(entry, routeProducts);
    const rootEndpointId = rootEndpoint?.endpointId || null;
    const program = {
      id: routeProgramIdForEntry(entry),
      entryNodeId: entry.nodeId,
      publicModelName: entry.publicModelName,
      enabled: entry.enabled !== false,
      ...(rootEndpointId ? { rootEndpointId } : {}),
      ops: [],
      sourceRef: routeProgramSourceRefFromNode(entryNode, { routeId: entry.match?.routeId }),
    };
    programs.push(program);
    programByEntryNodeId.set(entry.nodeId, program);
    if (rootEndpointId) rootEndpointByEntryNodeId.set(entry.nodeId, rootEndpointId);
    debug.sourceRefs[`program:${program.id}`] = program.sourceRef;
  }

  const matcher = { exact: {}, normalizedExact: {}, patterns: [] };
  const matcherResolutionByKey = new Map();
  const setExactMatcherTarget = (key, target, entry, entryNode) => {
    const resolutionKey = `exact:${key.toLowerCase()}`;
    const existing = matcher.exact[key];
    if (!existing) {
      matcher.exact[key] = target;
      matcherResolutionByKey.set(resolutionKey, publicEntryResolutionInfo(entryNode, entry.backend));
      return;
    }
    if (existing.programId === target.programId) {
      matcher.exact[key] = target;
      matcherResolutionByKey.set(resolutionKey, publicEntryResolutionInfo(entryNode, entry.backend));
      return;
    }
    const existingInfo = matcherResolutionByKey.get(resolutionKey);
    const nextInfo = publicEntryResolutionInfo(entryNode, entry.backend);
    if (existingInfo && canPublicEntryOverrideDuplicate(existingInfo, nextInfo)) {
      if (shouldPreferPublicEntryResolution(existingInfo, nextInfo)) {
        matcher.exact[key] = target;
        matcherResolutionByKey.set(resolutionKey, nextInfo);
      }
      return;
    }
    addDiagnostic(diagnostics, 'error', 'program.matcher_duplicate', `Program matcher exact key ${key} is already mapped.`, entry.nodeId);
  };
  const setNormalizedMatcherTarget = (key, target, entry, entryNode) => {
    const existing = matcher.normalizedExact[key];
    if (!existing) {
      matcher.normalizedExact[key] = target;
      matcherResolutionByKey.set(`normalized:${key}`, publicEntryResolutionInfo(entryNode, entry.backend));
      return;
    }
    if (existing.programId === target.programId) {
      matcher.normalizedExact[key] = target;
      matcherResolutionByKey.set(`normalized:${key}`, publicEntryResolutionInfo(entryNode, entry.backend));
      return;
    }
    const existingInfo = matcherResolutionByKey.get(`normalized:${key}`);
    const nextInfo = publicEntryResolutionInfo(entryNode, entry.backend);
    if (existingInfo && canPublicEntryOverrideDuplicate(existingInfo, nextInfo)) {
      if (shouldPreferPublicEntryResolution(existingInfo, nextInfo)) {
        matcher.normalizedExact[key] = target;
        matcherResolutionByKey.set(`normalized:${key}`, nextInfo);
      }
      return;
    }
    addDiagnostic(diagnostics, 'error', 'program.matcher_duplicate', `Program matcher normalized key ${key} is already mapped.`, entry.nodeId);
  };
  for (const entry of entries) {
    if (entry.enabled === false || entry.visibility !== 'public' || !normalizeString(entry.publicModelName)) continue;
    const program = programByEntryNodeId.get(entry.nodeId);
    if (!program) continue;
    const entryNode = nodesById[entry.nodeId];
    const rootEndpointId = rootEndpointByEntryNodeId.get(entry.nodeId) || null;
    const target = routeProgramMatcherTarget(program, entry, rootEndpointId, entryNode);
    if (isExactRouteProgramEntry(entry)) {
      setExactMatcherTarget(entry.publicModelName, target, entry, entryNode);
      const normalized = entry.publicModelName.toLowerCase();
      setNormalizedMatcherTarget(normalized, target, entry, entryNode);
      debug.sourceRefs[`matcher:exact:${entry.publicModelName}`] = target.sourceRef;
      debug.sourceRefs[`matcher:normalized:${normalized}`] = target.sourceRef;
      continue;
    }
    matcher.patterns.push({
      ...target,
      pattern: entry.match?.requestedModelPattern || entry.publicModelName,
      patternKind: String(entry.match?.requestedModelPattern || '').startsWith('re:') ? 'regex' : 'wildcard',
    });
    debug.sourceRefs[`matcher:pattern:${entry.publicModelName}`] = target.sourceRef;
  }

  const endpointCatalog = {
    byId: {},
    productToProgram: {},
    supplyTargets: {},
  };
  for (const endpoint of routeEndpoints) {
    const endpointNode = nodesById[endpoint.nodeId];
    const sourceRef = routeProgramSourceRefFromNode(endpointNode, {
      endpointId: endpoint.endpointId,
      routeId: endpoint.routeId,
    });
    const targetRefs = compiledEndpointTargetsForRouteEndpoint(endpoint, endpointNode, nodesById);
    endpointCatalog.byId[endpoint.endpointId] = {
      endpointId: endpoint.endpointId,
      nodeId: endpoint.nodeId,
      enabled: endpoint.enabled !== false,
      endpointKind: endpoint.endpointKind,
      exposure: endpoint.exposure,
      resolutionStatus: endpoint.resolutionStatus,
      ownerKind: endpoint.ownerKind,
      sourceKind: endpoint.sourceKind,
      routeId: normalizePositiveInteger(endpoint.routeId) || null,
      publicModelName: endpoint.publicModelName || '',
      match: normalizeRouteGraphMatchSpec(endpoint.match),
      backend: normalizeRouteGraphBackendSpec(endpoint.backend),
      ...(endpoint.resolvesTo ? { resolvesTo: endpoint.resolvesTo } : {}),
      targetRefs: targetRefs.map((target) => target.targetId),
      sourceRef,
    };
    debug.sourceRefs[`endpoint:${endpoint.endpointId}`] = sourceRef;
    for (const targetRef of targetRefs) {
      debug.sourceRefs[`target:${targetRef.targetId}`] = targetRef.sourceRef;
    }
    if (endpoint.endpointKind === 'supply') {
      endpointCatalog.supplyTargets[endpoint.endpointId] = targetRefs;
    }
  }

  for (const program of programs) {
    if (program.rootEndpointId) endpointCatalog.productToProgram[program.rootEndpointId] = program.id;
  }
  for (const endpoint of routeProducts) {
    if (endpointCatalog.productToProgram[endpoint.endpointId]) continue;
    if (endpoint.resolvesTo?.kind === 'route_builder') {
      const program = programByEntryNodeId.get(`macro:${macroSafeId(endpoint.resolvesTo.id)}:entry`);
      if (program) {
        endpointCatalog.productToProgram[endpoint.endpointId] = program.id;
        continue;
      }
    }
    const routeId = normalizePositiveInteger(endpoint.routeId);
    if (routeId) {
      const program = programs.find((item) => normalizePositiveInteger(item.sourceRef.routeId) === routeId);
      if (program) {
        endpointCatalog.productToProgram[endpoint.endpointId] = program.id;
        continue;
      }
    }
    const publicName = normalizeString(endpoint.publicModelName);
    if (publicName) {
      const program = programs.find((item) => item.publicModelName.toLowerCase() === publicName.toLowerCase());
      if (program) endpointCatalog.productToProgram[endpoint.endpointId] = program.id;
    }
  }

  for (const program of programs) {
    const entry = entries.find((item) => item.nodeId === program.entryNodeId);
    if (!entry) continue;
    const compiledOps = buildRouteProgramOpsForEntry({
      program,
      entry,
      nodesById,
      edgesByFromPort: isPlainObject(compiledGraph.edgesByFromPort) ? compiledGraph.edgesByFromPort : {},
      diagnostics,
    });
    program.startOpId = compiledOps.startOpId || null;
    program.ops = compiledOps.ops;
    for (const op of program.ops) {
      debug.sourceRefs[`op:${op.id}`] = op.sourceRef || {};
    }
    if (!program.startOpId) {
      addDiagnostic(diagnostics, 'error', 'program.entry_without_program', `Public entry ${program.entryNodeId} did not compile to an executable route program.`, program.entryNodeId);
    }
  }

  const bundleWithoutHash = {
    version: ROUTE_PROGRAM_BUNDLE_VERSION,
    matcher,
    programs,
    endpointCatalog,
    debug,
    diagnostics,
  };
  return {
    ...bundleWithoutHash,
    hash: stableJson(bundleWithoutHash),
  };
}

function flatTerminalStats(terminal) {
  if (!terminal) return { terminalKind: 'dispatch', targetCount: 0, enabledTargetCount: 0 };
  if (terminal.kind === 'synthetic') return { terminalKind: 'synthetic', targetCount: 0, enabledTargetCount: 0 };
  const targets = Array.isArray(terminal.targets) ? terminal.targets : [];
  return {
    terminalKind: 'supply',
    targetCount: targets.length,
    enabledTargetCount: targets.filter((target) => target.enabled !== false).length,
  };
}

function flatDecisionStats(decision) {
  if (!decision) return { terminalKind: 'dispatch', targetCount: 0, enabledTargetCount: 0 };
  if (decision.kind === 'terminal') return flatTerminalStats(decision.terminal);
  const candidates = Array.isArray(decision.dispatch?.candidates) ? decision.dispatch.candidates : [];
  return {
    terminalKind: 'dispatch',
    targetCount: candidates.reduce((sum, candidate) => sum + (Number(candidate.targetCount) || 0), 0),
    enabledTargetCount: candidates.reduce((sum, candidate) => sum + (Number(candidate.enabledTargetCount) || 0), 0),
  };
}

function buildFlatTerminalFromRouteProgramOp(op) {
  if (!op) return null;
  if (op.op === 'synthetic') {
    return {
      kind: 'synthetic',
      nodeId: op.nodeId,
      statusCode: op.statusCode === 429 ? 429 : 503,
      message: op.message || 'No route is available.',
      sourceRef: op.sourceRef || {},
    };
  }
  if (op.op === 'select_supply') {
    return {
      kind: 'supply',
      endpointId: op.endpointId,
      nodeId: op.nodeId,
      routeId: normalizePositiveInteger(op.routeId) || null,
      ...(normalizeString(op.routeEndpointId) ? { routeEndpointId: normalizeString(op.routeEndpointId) } : {}),
      ...(normalizeString(op.terminalModel) ? { terminalModel: normalizeString(op.terminalModel) } : {}),
      targetSelectionPolicy: isPlainObject(op.targetSelectionPolicy) ? op.targetSelectionPolicy : { strategy: 'weighted' },
      targets: Array.isArray(op.targets) ? op.targets : [],
      ...(isPlainObject(op.compatibilityPolicy) ? { compatibilityPolicy: op.compatibilityPolicy } : {}),
      sourceRef: op.sourceRef || {},
    };
  }
  return null;
}

function buildFlatDecisionFromRouteProgramOps(input) {
  const { program, opsById, opId, diagnostics } = input;
  let currentOpId = normalizeString(opId);
  const filterStages = [];
  const visited = new Set(input.visited || []);
  while (currentOpId) {
    if (visited.has(currentOpId)) {
      addDiagnostic(diagnostics, 'error', 'flat_program.cycle', `Flat route program ${program.id} contains a cycle at ${currentOpId}.`);
      return null;
    }
    visited.add(currentOpId);
    const op = opsById.get(currentOpId);
    if (!op) {
      addDiagnostic(diagnostics, 'error', 'flat_program.missing_op', `Flat route program ${program.id} references missing op ${currentOpId}.`);
      return null;
    }
    if (op.op === 'filter') {
      filterStages.push({
        nodeId: op.nodeId,
        phase: op.phase,
        operations: Array.isArray(op.operations) ? op.operations : [],
        sourceRef: op.sourceRef || {},
      });
      currentOpId = normalizeString(op.nextOpId);
      continue;
    }
    if (op.op === 'call_product') {
      currentOpId = normalizeString(op.nextOpId);
      continue;
    }
    if (op.op === 'dispatch') {
      const candidates = (Array.isArray(op.candidates) ? op.candidates : []).map((candidate, index) => {
        const next = buildFlatDecisionFromRouteProgramOps({
          program,
          opsById,
          opId: candidate.targetOpId,
          diagnostics,
          visited: new Set(visited),
        });
        if (!next) return null;
        const stats = flatDecisionStats(next);
        return {
          id: candidate.id,
          kind: op.mode === 'flow' ? 'bidirect' : (op.mode === 'target' ? 'target' : 'route'),
          ...(normalizeString(candidate.nodeId) ? { nodeId: normalizeString(candidate.nodeId) } : {}),
          ...(normalizeString(candidate.edgeId) ? { edgeId: normalizeString(candidate.edgeId) } : {}),
          ...(normalizeString(candidate.endpointId) ? { endpointId: normalizeString(candidate.endpointId) } : {}),
          enabled: candidate.enabled !== false,
          weight: Number.isFinite(Number(candidate.weight)) ? Number(candidate.weight) : 1,
          priority: Number.isFinite(Number(candidate.priority)) ? Number(candidate.priority) : 0,
          order: index,
          ...(isPlainObject(candidate.metadata) ? { metadata: candidate.metadata } : {}),
          sourceRef: candidate.sourceRef || {},
          next,
          ...stats,
        };
      }).filter(Boolean);
      return {
        kind: 'dispatch',
        filterStages,
        dispatch: {
          id: op.id,
          nodeId: op.nodeId,
          mode: op.mode,
          policy: isPlainObject(op.policy) ? op.policy : { strategy: 'weighted' },
          candidates,
          enabledCandidateCount: candidates.filter((candidate) => candidate.enabled !== false).length,
          sourceRef: op.sourceRef || {},
        },
      };
    }
    const terminal = buildFlatTerminalFromRouteProgramOp(op);
    if (terminal) {
      return {
        kind: 'terminal',
        filterStages,
        terminal,
      };
    }
    addDiagnostic(diagnostics, 'error', 'flat_program.unsupported_op', `Flat route program ${program.id} cannot compile op ${currentOpId}.`);
    return null;
  }
  addDiagnostic(diagnostics, 'error', 'flat_program.empty_path', `Flat route program ${program.id} has an empty execution path.`);
  return null;
}

function buildRouteFlatProgramBundle(bundle) {
  const diagnostics = Array.isArray(bundle?.diagnostics) ? [...bundle.diagnostics] : [];
  const programs = [];
  for (const program of Array.isArray(bundle?.programs) ? bundle.programs : []) {
    const opsById = new Map((Array.isArray(program.ops) ? program.ops : []).map((op) => [op.id, op]));
    const start = normalizeString(program.startOpId)
      ? buildFlatDecisionFromRouteProgramOps({
        program,
        opsById,
        opId: program.startOpId,
        diagnostics,
      })
      : null;
    if (!start) {
      addDiagnostic(diagnostics, 'error', 'flat_program.entry_without_program', `Public entry ${program.entryNodeId} did not compile to a flat route program.`, program.entryNodeId);
    }
    programs.push({
      id: program.id,
      entryNodeId: program.entryNodeId,
      publicModelName: program.publicModelName,
      enabled: program.enabled !== false,
      ...(normalizeString(program.rootEndpointId) ? { rootEndpointId: normalizeString(program.rootEndpointId) } : {}),
      start,
      sourceRef: program.sourceRef || {},
    });
  }
  const bundleWithoutHash = {
    version: ROUTE_FLAT_PROGRAM_BUNDLE_VERSION,
    matcher: bundle?.matcher || { exact: {}, normalizedExact: {}, patterns: [] },
    programs,
    endpointCatalog: bundle?.endpointCatalog || { byId: {}, productToProgram: {}, supplyTargets: {} },
    debug: bundle?.debug || {
      sourceHash: '',
      primitiveHash: '',
      sourceRefs: {},
      generatedByMacro: {},
    },
    diagnostics,
  };
  return {
    ...bundleWithoutHash,
    hash: stableJson(bundleWithoutHash),
  };
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
        routeIds.push(...routeIdsFromRouteGraphCandidateNode(candidateNode));
      }
    }
  }
  if (routeIds.length > 0) {
    return normalizeRouteGraphBackendSpec({ kind: ROUTE_GRAPH_BACKEND_KIND_ROUTES, routeIds: Array.from(new Set(routeIds)) });
  }
  return normalizeRouteGraphBackendSpec({ kind: ROUTE_GRAPH_BACKEND_KIND_SUPPLY });
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

function macroSemanticNodeAliases(macro) {
  const aliases = new Set([macroSemanticNodeId(macro)]);
  const rawId = normalizeString(macro?.id);
  if (rawId) aliases.add(rawId);
  return Array.from(aliases);
}

function routeEndpointRouteId(node) {
  if (!node || node.type !== 'route_endpoint') return null;
  const direct = normalizePositiveInteger(node.routeId || node.legacyRouteId || node.match?.routeId);
  if (direct) return direct;
  return null;
}

function findRouteProductEndpoint(nodes, endpointId) {
  const normalizedEndpointId = normalizeString(endpointId);
  if (!normalizedEndpointId) return null;
  return nodes.find((node) => (
    node.type === 'route_endpoint'
    && (node.id === normalizedEndpointId || node.routeEndpointId === normalizedEndpointId || node.endpointId === normalizedEndpointId)
  )) || null;
}

function findExecutableEndpointForSupplyEndpoint(nodes, routeEndpoint) {
  if (!routeEndpoint || routeEndpoint.type !== 'route_endpoint' || routeEndpoint.endpointKind !== 'supply') return null;
  if (Array.isArray(routeEndpoint.config?.targets) && routeEndpoint.config.targets.length > 0) return routeEndpoint;
  return null;
}

function macroCandidateWeight(group, fallback = 10) {
  return Number.isFinite(Number(group.defaults?.weight)) ? Number(group.defaults.weight) : fallback;
}

function macroCandidatePriority(group) {
  return Number.isFinite(Number(group.defaults?.priority)) ? Number(group.defaults.priority) : group.priority;
}

function candidateOverrideForEndpoint(config, routeEndpoint) {
  const endpointId = normalizeString(routeEndpoint?.routeEndpointId || routeEndpoint?.endpointId || routeEndpoint?.id);
  if (!endpointId) return {};
  const overrides = isPlainObject(config?.candidateOverrides) ? config.candidateOverrides : {};
  const bySupplyEndpointId = isPlainObject(overrides.bySupplyEndpointId) ? overrides.bySupplyEndpointId : {};
  const byEndpointId = isPlainObject(overrides.byEndpointId) ? overrides.byEndpointId : {};
  if (routeEndpoint?.endpointKind === 'supply' && isPlainObject(bySupplyEndpointId[endpointId])) return bySupplyEndpointId[endpointId];
  if (isPlainObject(byEndpointId[endpointId])) return byEndpointId[endpointId];
  return {};
}

function mergeCandidateOverrideMetadata(group, routeEndpoint, candidateMetadata, override) {
  const overrideMetadata = isPlainObject(override) ? override : {};
  const merged = {
    ...candidateMetadata,
    ...(Number.isFinite(Number(overrideMetadata.weight)) ? { weight: Number(overrideMetadata.weight) } : {}),
    ...(Number.isFinite(Number(overrideMetadata.priority)) ? { priority: Math.trunc(Number(overrideMetadata.priority)) } : {}),
    ...(overrideMetadata.enabled === true || overrideMetadata.enabled === false ? { enabled: overrideMetadata.enabled } : {}),
    ...(overrideMetadata.excluded === true ? { excluded: true } : {}),
    ...(normalizeString(overrideMetadata.groupId) ? { overrideGroupId: normalizeString(overrideMetadata.groupId) } : {}),
  };
  if (Object.keys(overrideMetadata).length > 0) merged.override = overrideMetadata;
  return merged;
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
  if (!endpoint || endpoint.type !== 'route_endpoint') return null;
  if (endpoint.routeEndpointId) {
    const directEntry = nodes.find((node) => node.id === endpoint.routeEndpointId && node.type === 'entry');
    if (directEntry) return directEntry;
  }
  const routeId = legacyRouteIdFromRouteGraphNode(endpoint);
  if (routeId) {
    const legacyEntry = nodes.find((node) => node.id === legacyRouteIdToRouteGraphEntryNodeId(routeId) && node.type === 'entry');
    if (legacyEntry) return legacyEntry;
  }
  return null;
}

function routeEndpointPatternNames(nodes, endpoint) {
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
    .filter((node) => (
      node.enabled !== false
      && (
        node.type === 'route_endpoint' && Array.isArray(node.config?.targets) && node.config.targets.length > 0
      )
    ))
    .flatMap((endpoint) => {
      const models = routeEndpointPatternNames(source.nodes, endpoint);
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

function routeGraphEdgeConnectionKey(edge) {
  return [
    edge?.sourceNodeId || '',
    edge?.sourcePortId || '',
    edge?.targetNodeId || '',
    edge?.targetPortId || '',
  ].join('\u0000');
}

function lowerCandidateSelectorMacro(macro, source) {
  const diagnostics = [];
  const nodes = [];
  const edges = [];
  const candidateNodeIds = [];
  const config = normalizeCandidateSelectorConfig(macro.config);
  const filterOperations = Array.isArray(config.filters?.operations) ? config.filters.operations : [];
  const macroId = macroSafeId(macro.id);
  const semanticNodeId = macroSemanticNodeId(macro);
  if (macro.enabled === false) return { macro, nodes, edges, diagnostics, semanticNodeId, entryId: null, entryTargetId: null, dispatcherId: null, candidateNodeIds };

  const entryId = config.surface.entry.kind === 'external' ? `macro:${macroId}:entry` : null;
  const filterId = filterOperations.length > 0 ? `macro:${macroId}:filter` : null;
  const dispatcherId = `macro:${macroId}:dispatcher`;
  const entryTargetId = filterId || entryId || dispatcherId;
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
  if (filterId) {
    nodes.push(normalizeRouteGraphNode({
      id: filterId,
      type: 'filter',
      name: `${macro.name || macro.id} filter`,
      enabled: macro.enabled !== false,
      visibility: 'internal',
      ownership: 'derived',
      operations: filterOperations,
      provenance: macroProvenance(macro, 'filter'),
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
  if (entryId && filterId) {
    edges.push(normalizeRouteGraphEdge({
      id: `macro:${macroId}:edge:entry-filter`,
      sourceNodeId: entryId,
      sourcePortId: 'bidirect.out',
      targetNodeId: filterId,
      targetPortId: 'bidirect.in',
      kind: 'bidirect_flow',
      ownership: 'derived',
      metadata: { provenance: macroProvenance(macro, 'entry_filter_edge') },
    }));
  }
  if (filterId) {
    edges.push(normalizeRouteGraphEdge({
      id: `macro:${macroId}:edge:filter-dispatcher`,
      sourceNodeId: filterId,
      sourcePortId: 'bidirect.out',
      targetNodeId: dispatcherId,
      targetPortId: 'bidirect.in',
      kind: 'bidirect_flow',
      ownership: 'derived',
      metadata: { provenance: macroProvenance(macro, 'filter_dispatcher_edge') },
    }));
  } else if (entryId) {
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
    if (group.input.kind === 'route_endpoints') {
      const materializedRouteEndpoints = materializeCandidateItems(
        group,
        group.input.endpointIds.map((endpointId) => {
          const routeProduct = findRouteProductEndpoint(source.nodes, endpointId);
          return {
            endpointId,
            routeId: routeEndpointRouteId(routeProduct),
          };
        }),
        (item, dedupeBy) => {
          if (dedupeBy === 'endpoint_id') return String(item.endpointId || '');
          if (dedupeBy === 'route_id') return String(item.routeId || '');
          return '';
        },
      );
      for (const item of materializedRouteEndpoints) {
        const routeEndpoint = findRouteProductEndpoint(source.nodes, item.endpointId);
        if (!routeEndpoint) {
          addDiagnostic(diagnostics, 'error', 'macro.candidate_route_endpoint_missing', `candidate_selector ${macro.id} references route endpoint ${item.endpointId}, but it does not exist.`);
          continue;
        }
        const routeId = routeEndpointRouteId(routeEndpoint);
        const override = candidateOverrideForEndpoint(config, routeEndpoint);
        if (override.excluded === true) continue;
        if (routeEndpoint.endpointKind === 'route_product') {
          candidateNodeIds.push(routeEndpoint.id);
          addMacroCandidateEdge(edges, macro, macroId, group, routeEndpoint.id, dispatcherId, {
            ...mergeCandidateOverrideMetadata(group, routeEndpoint, {
              routeId,
              routeEndpointId: item.endpointId,
              endpointKind: 'route_product',
            }, override),
          }, config.surface.output);
          continue;
        }
        if (routeEndpoint.endpointKind === 'supply' && findExecutableEndpointForSupplyEndpoint(source.nodes, routeEndpoint)) {
          candidateNodeIds.push(routeEndpoint.id);
          addMacroCandidateEdge(edges, macro, macroId, group, routeEndpoint.id, dispatcherId, {
            ...mergeCandidateOverrideMetadata(group, routeEndpoint, {
              routeId,
              routeEndpointId: item.endpointId,
              endpointKind: 'supply',
            }, override),
          }, config.surface.output);
          continue;
        }
        if (!findExecutableEndpointForSupplyEndpoint(source.nodes, routeEndpoint)) {
          addDiagnostic(diagnostics, 'error', 'macro.candidate_route_endpoint_unresolved', `candidate_selector ${macro.id} references route endpoint ${item.endpointId}, but no executable endpoint exists for it.`);
          continue;
        }
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
          endpointId: target.targetId,
        })),
        (item, dedupeBy) => {
          if (dedupeBy === 'endpoint_id') return String(item.endpointId || item.targetId || '');
          if (dedupeBy === 'model') return String(item.model || '');
          return '';
        },
      );
      if (materializedTargets.length === 0) continue;
      const candidateId = `macro:${macroId}:candidate:${macroSafeId(group.id)}:inline`;
      candidateNodeIds.push(candidateId);
      nodes.push(normalizeRouteGraphNode({
        id: candidateId,
        type: 'route_endpoint',
        name: group.label || `${macro.id} inline endpoints`,
        enabled: group.defaults?.enabled !== false,
        visibility: 'internal',
        endpointKind: 'supply',
        exposure: 'none',
        resolutionStatus: 'resolved',
        ownerKind: 'macro',
        sourceKind: 'inline',
        routeEndpointId: candidateId,
        endpointId: candidateId,
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
  return { macro, nodes, edges, diagnostics, semanticNodeId, entryId, entryTargetId, dispatcherId, candidateNodeIds };
}

function validateMacroSemanticInputCollectionBounds(source, macroLoweringsBySemanticId, diagnostics) {
  const nodesById = new Map((source.nodes || []).map((node) => [node.id, node]));
  const incomingByPort = new Map();
  const dedupe = new Set();
  for (const edge of source.edges || []) {
    const sourceMacro = macroLoweringsBySemanticId.get(edge.sourceNodeId);
    const targetMacro = macroLoweringsBySemanticId.get(edge.targetNodeId);
    if (!targetMacro || sourceMacro || targetMacro.macro?.enabled === false) continue;
    const sourcePort = getRouteGraphNodePort(nodesById.get(edge.sourceNodeId), edge.sourcePortId);
    const targetPort = getRouteGraphMacroPort(targetMacro.macro, edge.targetPortId);
    if (!sourcePort || !targetPort) continue;
    if (sourcePort.enabled === false || targetPort.enabled === false) continue;
    if (sourcePort.direction !== 'output' || targetPort.direction !== 'input') continue;
    if (sourcePort.kind !== targetPort.kind) continue;
    const bounds = getRouteGraphPortConnectionBounds(targetPort);
    if (!bounds.collection || !Number.isFinite(bounds.max)) continue;
    const dedupeKey = [
      edge.sourceNodeId || '',
      edge.sourcePortId || '',
      targetMacro.semanticNodeId || edge.targetNodeId || '',
      edge.targetPortId || '',
    ].join('\u0000');
    if (dedupe.has(dedupeKey)) continue;
    dedupe.add(dedupeKey);
    const incomingKey = `${targetMacro.semanticNodeId || edge.targetNodeId}\u0000${edge.targetPortId}`;
    const incomingCount = incomingByPort.get(incomingKey) || 0;
    if (incomingCount >= bounds.max) {
      addDiagnostic(
        diagnostics,
        'error',
        'edge.collection_max',
        `Input port ${edge.targetPortId} on ${edge.targetNodeId} allows at most ${formatPortBound(bounds.max)} connections.`,
        edge.targetNodeId,
        edge.id,
      );
      continue;
    }
    incomingByPort.set(incomingKey, incomingCount + 1);
  }
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
      for (const alias of macroSemanticNodeAliases(macro)) {
        macroLoweringsBySemanticId.set(alias, lowered);
      }
      continue;
    }
    addDiagnostic(diagnostics, 'error', 'macro.unknown_kind', `Unknown route graph macro kind ${macro.kind}.`);
  }
  validateMacroSemanticInputCollectionBounds(source, macroLoweringsBySemanticId, diagnostics);
  const semanticEdges = [];
  const primitiveEdges = [];
  for (const edge of source.edges) {
    const sourceMacro = macroLoweringsBySemanticId.get(edge.sourceNodeId);
    const targetMacro = macroLoweringsBySemanticId.get(edge.targetNodeId);
    if (!sourceMacro && !targetMacro) {
      primitiveEdges.push(edge);
      continue;
    }
    if (sourceMacro?.macro?.enabled === false || targetMacro?.macro?.enabled === false) {
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
      if (targetSurfacePort?.direction === 'input' && targetSurfacePort.kind === 'bidirect' && (targetMacro.entryTargetId || targetMacro.entryId || targetMacro.dispatcherId)) {
        semanticEdges.push(normalizeRouteGraphEdge({
          ...edge,
          id: `macro-semantic:${edge.id}:bidirect-in`,
          targetNodeId: targetMacro.entryTargetId || targetMacro.entryId || targetMacro.dispatcherId,
          targetPortId: 'bidirect.in',
          ownership: 'derived',
          metadata: { ...(isPlainObject(edge.metadata) ? edge.metadata : {}), provenance: { source: 'macro_semantic_edge', semanticEdgeId: edge.id } },
        }));
        continue;
      }
      if (targetSurfacePort?.direction === 'input' && targetSurfacePort.kind === 'route' && edge.targetPortId === 'candidates.in' && targetMacro.dispatcherId) {
        const routeEndpoint = findRouteProductEndpoint(source.nodes, edge.sourceNodeId);
        const override = candidateOverrideForEndpoint(normalizeCandidateSelectorConfig(targetMacro.macro.config), routeEndpoint);
        if (override.excluded === true) continue;
        const edgeMetadata = isPlainObject(edge.metadata) ? edge.metadata : {};
        const candidateMetadata = isPlainObject(edgeMetadata.candidate) ? edgeMetadata.candidate : {};
        semanticEdges.push(normalizeRouteGraphEdge({
          ...edge,
          id: `macro-semantic:${edge.id}:candidate-in`,
          targetNodeId: targetMacro.dispatcherId,
          targetPortId: 'route.in',
          ownership: 'derived',
          metadata: {
            ...edgeMetadata,
            candidate: routeEndpoint
              ? mergeCandidateOverrideMetadata(
                { id: 'semantic', priority: Number.isFinite(Number(candidateMetadata.priority)) ? Number(candidateMetadata.priority) : 0, defaults: candidateMetadata },
                routeEndpoint,
                {
                  ...candidateMetadata,
                  routeId: routeEndpointRouteId(routeEndpoint),
                  routeEndpointId: routeEndpoint.routeEndpointId || routeEndpoint.endpointId || routeEndpoint.id,
                  endpointKind: routeEndpoint.endpointKind,
                },
                override,
              )
              : candidateMetadata,
            provenance: {
              source: 'macro_semantic_edge',
              semanticEdgeId: edge.id,
              macroId: targetMacro.macro.id,
              role: 'candidate_edge',
            },
          },
        }));
        continue;
      }
      addDiagnostic(diagnostics, 'error', 'macro.edge_unsupported', `Semantic macro target port ${edge.targetPortId} is not supported on ${edge.targetNodeId}.`, edge.targetNodeId, edge.id);
    }
  }
  const semanticEdgeConnections = new Set(semanticEdges.map(routeGraphEdgeConnectionKey));
  const dedupedDerivedEdges = derivedEdges.filter((edge) => !semanticEdgeConnections.has(routeGraphEdgeConnectionKey(edge)));
  return {
    semanticSource: source,
    primitiveSource: normalizeRouteGraphSource({
      ...source,
      nodes: [...source.nodes, ...derivedNodes],
      edges: [...primitiveEdges, ...dedupedDerivedEdges, ...semanticEdges],
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
    if (node.type === 'route_endpoint' && node.endpointKind === 'supply' && node.enabled !== false) {
      const targets = Array.isArray(node.config?.targets)
        ? node.config.targets.filter((target) => normalizeString(target?.targetId) && (normalizeString(target?.model) || target?.modelSource === 'request'))
        : [];
      if (targets.length === 0) {
        addDiagnostic(diagnostics, 'warning', 'route_endpoint.targets_required', `Route endpoint ${node.id} has no executable target yet.`, node.id);
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
      if (node.visibility !== 'public') {
        addDiagnostic(diagnostics, 'error', 'entry.internal_unsupported', `Entry ${node.id} must be public; use route_endpoint for internal reuse.`, node.id);
      }
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
        if (
          node.type === 'dispatcher'
          && node.mode === 'route'
          && port.id === 'bidirect.in'
          && node.provenance?.source === 'macro'
        ) {
          continue;
        }
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
    const info = publicEntryResolutionInfo(node, backend);
    if (publicNames.has(lower)) {
      const existing = publicNames.get(lower);
      const sameRouteBinding = info.routeId !== null && existing.routeId !== null && info.routeId === existing.routeId;
      if (!sameRouteBinding && !canPublicEntryOverrideDuplicate(existing, info)) {
        addDiagnostic(diagnostics, 'error', 'public_model.duplicate', `Public model ${publicName} is declared by both ${existing.nodeId} and ${node.id}.`, node.id);
      }
      if (shouldPreferPublicEntryResolution(existing, info)) {
        publicNames.set(lower, info);
      }
    } else {
      publicNames.set(lower, info);
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
    if (
      node.type !== 'route_endpoint'
      && node.provenance?.source !== 'macro'
      && node.enabled !== false
      && node.visibility === 'internal'
      && activeIncidentCounts.has(node.id)
      && !reachable.has(node.id)
    ) {
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
      routeEndpointId: node.routeEndpointId || node.id,
      legacyRouteId: node.legacyRouteId || null,
      routingStrategy: node.routingStrategy || 'weighted',
      statusCode: node.statusCode || null,
      message: node.message || null,
    }));
  const routeEndpoints = source.nodes
    .filter((node) => node.type === 'route_endpoint')
    .map((node) => ({
      nodeId: node.id,
      endpointId: node.routeEndpointId || node.endpointId || node.id,
      routeId: node.routeId || node.legacyRouteId || null,
      enabled: node.enabled !== false,
      endpointKind: node.endpointKind || 'route_product',
      exposure: normalizeEnum(node.exposure, ROUTE_GRAPH_ENDPOINT_EXPOSURES, node.endpointKind === 'supply' ? 'none' : 'internal'),
      resolutionStatus: normalizeEnum(node.resolutionStatus, ROUTE_GRAPH_ENDPOINT_RESOLUTION_STATUSES, 'resolved'),
      ownerKind: node.ownerKind || (node.ownership === 'auto_generated' ? 'automatic_route' : 'manual_route'),
      sourceKind: node.sourceKind || (node.endpointKind === 'supply' ? 'upstream_model' : 'manual_group'),
      ...(node.resolvesTo ? { resolvesTo: node.resolvesTo } : {}),
      backend: normalizeRouteGraphBackendSpec(node.backend),
      match: node.match ? normalizeRouteGraphMatchSpec(node.match) : normalizeRouteGraphMatchSpec(null),
      publicModelName: node.endpointKind !== 'supply' && node.exposure === 'public' ? getRouteGraphExposedModelName(node.match, node.backend) : '',
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
      routeEndpoints,
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
  const nextCompiledGraph = {
    ...compiled.compiled,
    hash: stableJson({
      nodes: lowered.primitiveSource.nodes,
      edges: lowered.primitiveSource.edges,
      macros: lowered.semanticSource.macros,
    }),
  };
  const programBundle = buildRouteProgramBundle({
    semanticSource: lowered.semanticSource,
    primitiveSource: lowered.primitiveSource,
    compiledGraph: nextCompiledGraph,
  });
  const flatProgramBundle = buildRouteFlatProgramBundle(programBundle);
  const diagnostics = [
    ...compiled.diagnostics,
    ...(Array.isArray(programBundle.diagnostics) ? programBundle.diagnostics : []),
    ...(Array.isArray(flatProgramBundle.diagnostics) ? flatProgramBundle.diagnostics.filter((diagnostic) => (
      String(diagnostic?.code || '').startsWith('flat_program.')
    )) : []),
  ];
  return {
    ...compiled,
    source: lowered.semanticSource,
    primitiveSource: lowered.primitiveSource,
    diagnostics,
    ok: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
    compiled: {
      ...nextCompiledGraph,
      programBundle,
      flatProgramBundle,
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
  const isExplicitGroupEntry = (entry) => {
    const routeId = normalizePositiveInteger(entry.match?.routeId);
    const backend = normalizeRouteGraphBackendSpec(entry.backend);
    return backend.kind === ROUTE_GRAPH_BACKEND_KIND_ROUTES
      && backend.routeIds.some((sourceRouteId) => sourceRouteId !== routeId);
  };
  const groupEntries = routeBackedEntries.filter(isExplicitGroupEntry);
  return groupEntries.find((entry) => entry.match?.displayName === model)
    || routeBackedEntries.find((entry) => (
      isExactTokenRouteModelPattern(entry.match?.requestedModelPattern || '')
      && entry.match.requestedModelPattern === model
    ))
    || enabledPublicEntries.find((entry) => (
      normalizeRouteGraphBackendSpec(entry.backend).kind === ROUTE_GRAPH_BACKEND_KIND_SUPPLY
      && entry.match?.displayName === model
    ))
    || enabledPublicEntries.find((entry) => (
      normalizeRouteGraphBackendSpec(entry.backend).kind === ROUTE_GRAPH_BACKEND_KIND_SUPPLY
      && isExactTokenRouteModelPattern(entry.match?.requestedModelPattern || '')
      && entry.match.requestedModelPattern === model
    ))
    || enabledPublicEntries.find((entry) => (
      normalizeRouteGraphBackendSpec(entry.backend).kind === ROUTE_GRAPH_BACKEND_KIND_SUPPLY
      && matchesTokenRouteModelPattern(model, entry.match?.requestedModelPattern || '')
    ))
    || null;
}

export function buildRouteGraphSourceFromLegacyRoutes(routesInput) {
  const routes = Array.isArray(routesInput) ? routesInput : [];
  const nodesById = new Map();
  const edges = [];
  const macros = [];
  const automaticExactGroups = new Map();
  const routeBindings = routes
    .map((route) => {
      const routeId = normalizePositiveInteger(route.id);
      if (!routeId) return null;
      const match = normalizeRouteGraphMatchSpec(route.match || parseRouteGraphMatchSpec(route.matchSpec));
      const backend = normalizeRouteGraphBackendSpec(route.backend || parseRouteGraphBackendSpec(route.backendSpec));
      const ownership = normalizeEnum(route.ownership, ROUTE_GRAPH_OWNERSHIPS.filter((item) => item !== 'derived'), 'manual');
      const visibility = normalizeEnum(route.visibility, ROUTE_GRAPH_VISIBILITIES, 'public');
      const projectExactRouteAsMacro = backend.kind === ROUTE_GRAPH_BACKEND_KIND_SUPPLY
        && ownership === 'auto_generated'
        && route.projectAsMacro !== false;
      const canonicalModelKey = projectExactRouteAsMacro
        ? canonicalRouteGraphModelKey(getRouteGraphExposedModelName(match, backend))
        : '';
      return {
        route,
        routeId,
        match,
        backend,
        ownership,
        visibility,
        projectExactRouteAsMacro,
        canonicalModelKey,
        productEndpointId: projectExactRouteAsMacro
          ? normalizeString(route.productEndpointId) || routeGraphAutoModelProductEndpointId(canonicalModelKey || routeId)
          : normalizeString(route.productEndpointId) || routeGraphRouteProductEndpointIdFromRoute(routeId),
        supplyEndpointId: normalizeString(route.supplyEndpointId)
          || routeGraphSupplyEndpointIdFromIdentity(route.endpointIdentity, routeId),
        supplyEndpointSpecs: Array.isArray(route.supplyEndpointSpecs)
          ? route.supplyEndpointSpecs
            .map((spec) => (isPlainObject(spec) ? {
              endpointId: normalizeString(spec.endpointId) || routeGraphSupplyEndpointIdFromIdentity(spec.endpointIdentity, routeId),
              endpointIdentity: isPlainObject(spec.endpointIdentity) ? spec.endpointIdentity : undefined,
              endpointLocalRefs: Array.isArray(spec.endpointLocalRefs) ? spec.endpointLocalRefs : [],
              targets: Array.isArray(spec.targets) ? spec.targets : [],
            } : null))
            .filter((spec) => spec && spec.endpointId)
          : [],
      };
    })
    .filter(Boolean);
  const productEndpointIdByRouteId = new Map(routeBindings.map((binding) => [binding.routeId, binding.productEndpointId]));
  const supplyEndpointIdsByRouteId = new Map(routeBindings.map((binding) => [
    binding.routeId,
    (binding.supplyEndpointSpecs.length > 0
      ? binding.supplyEndpointSpecs.map((spec) => spec.endpointId)
      : [binding.supplyEndpointId]).filter(Boolean),
  ]));
  const pushNode = (node) => {
    const normalized = normalizeRouteGraphNode(node);
    if (!nodesById.has(normalized.id)) nodesById.set(normalized.id, normalized);
  };
  const mergeUniqueValues = (left, right) => Array.from(new Set([...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)));
  const mergeUniqueObjects = (left, right) => Array.from(new Map([...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]
    .filter(isPlainObject)
    .map((value) => [stableJson(value), value]))
    .values());
  const pushOrMergeSupplyEndpointNode = (node) => {
    const normalized = normalizeRouteGraphNode(node);
    const existing = nodesById.get(normalized.id);
    if (!existing) {
      nodesById.set(normalized.id, normalized);
      return;
    }
    if (existing.type !== 'route_endpoint' || normalized.type !== 'route_endpoint' || existing.endpointKind !== 'supply' || normalized.endpointKind !== 'supply') {
      return;
    }
    const existingMetadata = isPlainObject(existing.metadata) ? existing.metadata : {};
    const nextMetadata = isPlainObject(normalized.metadata) ? normalized.metadata : {};
    nodesById.set(normalized.id, normalizeRouteGraphNode({
      ...existing,
      enabled: existing.enabled !== false || normalized.enabled !== false,
      metadata: {
        ...existingMetadata,
        ...nextMetadata,
        sourceRouteId: existingMetadata.sourceRouteId || nextMetadata.sourceRouteId,
        localRouteId: existingMetadata.localRouteId || nextMetadata.localRouteId,
        sourceRouteIds: mergeUniqueValues(existingMetadata.sourceRouteIds, nextMetadata.sourceRouteIds),
        localRouteIds: mergeUniqueValues(existingMetadata.localRouteIds, nextMetadata.localRouteIds),
        endpointLocalRefs: mergeUniqueObjects(existingMetadata.endpointLocalRefs, nextMetadata.endpointLocalRefs),
      },
    }));
  };
  for (const binding of routeBindings) {
    const { route, routeId, match, backend, ownership, visibility, projectExactRouteAsMacro, canonicalModelKey } = binding;
    const routeLabel = route.displayName || match.displayName || match.requestedModelPattern || `Route ${routeId}`;
    if (projectExactRouteAsMacro) {
      const productEndpointId = binding.productEndpointId;
      const macroId = routeGraphAutoModelMacroId(canonicalModelKey || routeId);
      const supplySpecs = binding.supplyEndpointSpecs.length > 0
        ? binding.supplyEndpointSpecs
        : [{
          endpointId: binding.supplyEndpointId,
          endpointIdentity: isPlainObject(route.endpointIdentity) ? route.endpointIdentity : undefined,
          endpointLocalRefs: Array.isArray(route.endpointLocalRefs) ? route.endpointLocalRefs : [],
          targets: Array.isArray(route.targets) ? route.targets : [],
        }];
      for (const spec of supplySpecs) {
        const supplyEndpointId = spec.endpointId;
        const routeBindingMetadata = {
          generatedByMacroId: macroId,
          syncRole: 'generated_supply_resource',
          canonicalModel: canonicalModelKey,
          ...(isPlainObject(spec.endpointIdentity) ? { endpointIdentity: spec.endpointIdentity } : {}),
        };
        pushOrMergeSupplyEndpointNode({
          id: supplyEndpointId,
          type: 'route_endpoint',
          name: routeLabel,
          enabled: route.enabled !== false,
          visibility: 'internal',
          endpointKind: 'supply',
          exposure: 'none',
          resolutionStatus: 'resolved',
          ownership,
          ownerKind: 'automatic_route',
          sourceKind: 'upstream_model',
          routeEndpointId: supplyEndpointId,
          endpointId: supplyEndpointId,
          routeId,
          legacyRouteId: routeId,
          backend,
          match,
          config: {
            targets: spec.targets,
            targetSelection: { strategy: 'defer_to_router' },
          },
          metadata: {
            ...routeBindingMetadata,
            upstreamModel: match.requestedModelPattern || match.displayName || '',
            canonicalModel: canonicalModelKey,
            sourceRouteId: routeId,
            localRouteId: routeId,
            sourceRouteIds: [routeId],
            localRouteIds: [routeId],
            endpointLocalRefs: spec.endpointLocalRefs,
          },
          provenance: route.provenance || { source: 'legacy', routeId },
        });
      }
      if (!automaticExactGroups.has(productEndpointId)) {
        automaticExactGroups.set(productEndpointId, {
          macroId,
          productEndpointId,
          canonicalModelKey,
          displayName: route.displayName || match.displayName || match.requestedModelPattern || canonicalModelKey || `Route ${routeId}`,
          displayIcon: route.displayIcon || null,
          visibility,
          enabled: route.enabled !== false,
          routingStrategy: route.routingStrategy || 'weighted',
          match,
          routeIds: [],
          supplyEndpointIds: [],
        });
      }
      const group = automaticExactGroups.get(productEndpointId);
      group.routeIds.push(routeId);
      for (const spec of supplySpecs) group.supplyEndpointIds.push(spec.endpointId);
      group.enabled = group.enabled || route.enabled !== false;
      if (visibility === 'public') group.visibility = 'public';
      continue;
    }

    const productEndpointId = binding.productEndpointId;
    const supplyEndpointSpecs = backend.kind === ROUTE_GRAPH_BACKEND_KIND_SUPPLY
      ? (binding.supplyEndpointSpecs.length > 0
        ? binding.supplyEndpointSpecs
        : [{
          endpointId: binding.supplyEndpointId,
          endpointIdentity: isPlainObject(route.endpointIdentity) ? route.endpointIdentity : undefined,
          endpointLocalRefs: Array.isArray(route.endpointLocalRefs) ? route.endpointLocalRefs : [],
          targets: Array.isArray(route.targets) ? route.targets : [],
        }])
      : [];
    const routeBindingMetadata = {};
    pushNode({
      id: productEndpointId,
      type: 'route_endpoint',
      name: routeLabel,
      enabled: route.enabled !== false,
      visibility: 'internal',
      endpointKind: 'route_product',
      exposure: visibility,
      resolutionStatus: 'resolved',
      ownership,
      ownerKind: ownership === 'auto_generated' ? 'automatic_route' : 'manual_route',
      sourceKind: backend.kind === ROUTE_GRAPH_BACKEND_KIND_ROUTES ? 'manual_group' : 'manual_group',
      routeEndpointId: productEndpointId,
      endpointId: productEndpointId,
      routeId,
      legacyRouteId: routeId,
      backend,
      match,
      resolvesTo: backend.kind === ROUTE_GRAPH_BACKEND_KIND_ROUTES
        ? { kind: 'route_builder', id: `route:${routeId}:model-group` }
        : undefined,
      metadata: routeBindingMetadata,
      provenance: route.provenance || { source: 'legacy', routeId },
    });
    for (const spec of supplyEndpointSpecs) {
      const supplyEndpointId = spec.endpointId;
      pushOrMergeSupplyEndpointNode({
        id: supplyEndpointId,
        type: 'route_endpoint',
        name: routeLabel,
        enabled: route.enabled !== false,
        visibility: 'internal',
        endpointKind: 'supply',
        exposure: 'none',
        resolutionStatus: 'resolved',
        ownership,
        ownerKind: ownership === 'auto_generated' ? 'automatic_route' : 'manual_route',
        sourceKind: 'upstream_model',
        routeEndpointId: supplyEndpointId,
        endpointId: supplyEndpointId,
        routeId,
        legacyRouteId: routeId,
        backend,
        match,
        config: {
          targets: Array.isArray(spec.targets) ? spec.targets : [],
          targetSelection: { strategy: 'defer_to_router' },
        },
        metadata: {
          ...(isPlainObject(spec.endpointIdentity) ? { endpointIdentity: spec.endpointIdentity } : {}),
          upstreamModel: match.requestedModelPattern || match.displayName || '',
          sourceRouteId: routeId,
          localRouteId: routeId,
          sourceRouteIds: [routeId],
          localRouteIds: [routeId],
          endpointLocalRefs: Array.isArray(spec.endpointLocalRefs) ? spec.endpointLocalRefs : [],
        },
        provenance: route.provenance || { source: 'legacy', routeId },
      });
    }
    if (backend.kind === ROUTE_GRAPH_BACKEND_KIND_ROUTES) {
      const candidateEndpointIds = backend.routeIds.flatMap((sourceRouteId) => {
        const supplyEndpointIds = supplyEndpointIdsByRouteId.get(sourceRouteId) || [];
        if (supplyEndpointIds.length > 0) return supplyEndpointIds;
        const productEndpointId = productEndpointIdByRouteId.get(sourceRouteId);
        return productEndpointId ? [productEndpointId] : [];
      });
      macros.push(buildCandidateSelectorMacroFromRouteBinding({
        id: routeId,
        stableId: `route:${routeId}:model-group`,
        displayName: routeLabel,
        displayIcon: route.displayIcon || null,
        visibility,
        enabled: route.enabled !== false,
        routingStrategy: route.routingStrategy || 'weighted',
        endpointIds: candidateEndpointIds,
        candidateBands: [{
          id: 'priority:0',
          label: 'Default',
          priority: 0,
          endpointIds: candidateEndpointIds,
        }],
        ownership,
        match,
        metadata: {
          provenance: {
            source: 'automatic_route_construction',
            routeId,
            binding: 'explicit_group_macro',
          },
        },
      }));
      for (const [index, endpointId] of candidateEndpointIds.entries()) {
        edges.push(normalizeRouteGraphEdge({
          id: `edge:${endpointId}:route.out:macro:route:${routeId}:model-group:candidates.in`,
          sourceNodeId: endpointId,
          sourcePortId: 'route.out',
          targetNodeId: `macro:route:${routeId}:model-group`,
          targetPortId: 'candidates.in',
          kind: 'route_flow',
          ownership,
          metadata: {
            provenance: {
              source: 'automatic_route_construction',
              routeId,
              binding: 'explicit_group_candidate_edge',
            },
            candidate: {
              routeEndpointId: endpointId,
              priority: 0,
            },
          },
        }));
      }
      continue;
    }

    const entryId = legacyRouteIdToRouteGraphEntryNodeId(routeId);
    const dispatcherId = `dispatcher:legacy:${routeId}`;
    if (visibility === 'public') {
      pushNode({
        id: entryId,
        type: 'entry',
        name: routeLabel,
        enabled: route.enabled !== false,
        visibility: 'public',
        ownership,
        match,
        selectionStrategy: route.routingStrategy || 'weighted',
        metadata: routeBindingMetadata,
        provenance: route.provenance || { source: 'legacy', routeId },
      });
    }
    if (visibility === 'public') {
      pushNode({
        id: dispatcherId,
        type: 'dispatcher',
        name: `${routeLabel} dispatcher`,
        enabled: route.enabled !== false,
        visibility: 'internal',
        ownership,
        mode: 'route',
        ordering: 'explicit',
        policy: { strategy: route.routingStrategy || 'weighted' },
        metadata: routeBindingMetadata,
        provenance: route.provenance || { source: 'legacy', routeId },
      });
      for (const spec of supplyEndpointSpecs) {
        edges.push(normalizeRouteGraphEdge({
          id: `edge:${spec.endpointId}:route.out:${dispatcherId}:route.in`,
          sourceNodeId: spec.endpointId,
          sourcePortId: 'route.out',
          targetNodeId: dispatcherId,
          targetPortId: 'route.in',
          kind: 'route_flow',
          ownership,
          metadata: routeBindingMetadata,
        }));
      }
      edges.push(normalizeRouteGraphEdge({
        id: `edge:${entryId}:bidirect.out:${dispatcherId}:bidirect.in`,
        sourceNodeId: entryId,
        sourcePortId: 'bidirect.out',
        targetNodeId: dispatcherId,
        targetPortId: 'bidirect.in',
        kind: 'bidirect_flow',
        ownership,
        metadata: routeBindingMetadata,
      }));
    }
  }
  for (const group of automaticExactGroups.values()) {
    pushNode({
      id: group.productEndpointId,
      type: 'route_endpoint',
      name: group.displayName,
      enabled: group.enabled,
      visibility: 'internal',
      endpointKind: 'route_product',
      exposure: group.visibility,
      resolutionStatus: group.supplyEndpointIds.length > 0 ? 'resolved' : 'unresolved',
      ownership: 'auto_generated',
      ownerKind: 'automatic_route',
      sourceKind: 'automatic_model_group',
      routeEndpointId: group.productEndpointId,
      endpointId: group.productEndpointId,
      routeId: group.routeIds[0] || null,
      legacyRouteId: group.routeIds[0] || null,
      backend: { kind: 'routes', routeIds: group.routeIds },
      match: {
        ...normalizeRouteGraphMatchSpec(group.match),
        routeId: group.routeIds[0] || null,
      },
      resolvesTo: { kind: 'route_builder', id: group.macroId },
      metadata: {
        canonicalModel: group.canonicalModelKey,
        sourceRouteIds: group.routeIds,
      },
      provenance: { source: 'automatic_route_construction', canonicalModel: group.canonicalModelKey },
    });
    macros.push(buildCandidateSelectorMacroFromRouteBinding({
      id: group.routeIds[0] || 0,
      stableId: group.macroId,
      displayName: group.displayName,
      displayIcon: group.displayIcon,
      visibility: group.visibility,
      enabled: group.enabled,
      routingStrategy: group.routingStrategy,
      endpointIds: group.supplyEndpointIds,
      candidateBands: [{
        id: 'priority:0',
        label: 'Default',
        priority: 0,
        endpointIds: group.supplyEndpointIds,
      }],
      ownership: 'auto_generated',
      match: group.match,
      metadata: {
        productEndpointId: group.productEndpointId,
        provenance: {
          source: 'automatic_route_construction',
          canonicalModel: group.canonicalModelKey,
          routeIds: group.routeIds,
          binding: 'automatic_model_group',
        },
      },
    }));
    for (const [index, endpointId] of group.supplyEndpointIds.entries()) {
      edges.push(normalizeRouteGraphEdge({
        id: `edge:${endpointId}:route.out:macro:${macroSafeId(group.macroId)}:candidates.in`,
        sourceNodeId: endpointId,
        sourcePortId: 'route.out',
        targetNodeId: `macro:${macroSafeId(group.macroId)}`,
        targetPortId: 'candidates.in',
        kind: 'route_flow',
        ownership: 'auto_generated',
        metadata: {
          provenance: {
            source: 'automatic_route_construction',
            canonicalModel: group.canonicalModelKey,
            routeIds: group.routeIds,
            binding: 'automatic_model_group_candidate_edge',
          },
          candidate: {
            routeEndpointId: endpointId,
            endpointKind: 'supply',
            priority: 0,
          },
        },
      }));
    }
  }
  return normalizeRouteGraphSource({ version: ROUTE_GRAPH_SCHEMA_VERSION, nodes: Array.from(nodesById.values()), edges, macros });
}
