import {
  isExactModelPattern,
  matchesModelPattern,
} from './modelPatternMatcher.js';
import {
  createRouteBuilderMacroId,
  createRouteMacroCandidateEdgeId,
  createRouteMacroCandidateEndpointNodeId,
  createRouteMacroDispatcherNodeId,
  createRouteMacroEntryNodeId,
  createRouteMacroFallbackStageDispatcherNodeId,
  createRouteMacroFallbackStageId,
  createRouteMacroFilterNodeId,
  createRouteMacroInlineCandidateNodeId,
  createRouteMacroInternalEdgeId,
  createRouteMacroSemanticCandidateEdgeId,
  createRouteMacroSemanticNodeId,
  createRouteMacroSyntheticCandidateNodeId,
  createRouteProgramEdgeId,
  createRuntimeExecutionTargetIdFromIdentity,
  createRuntimeExecutionTargetIdFromSupplyKey,
  isRouteMacroIdentity,
  routeMacroIdentitySafePart,
} from './routingIdentity.js';
import { compactCompiledRouterBundle as compactRuntimeBundle } from './compiledRuntime.js';

export const ROUTE_GRAPH_MATCH_KIND_MODEL = 'model';
export const ROUTE_GRAPH_BACKEND_KIND_SUPPLY = 'supply';
export const ROUTE_GRAPH_BACKEND_KIND_ROUTE_ENDPOINTS = 'route_endpoints';
export const ROUTE_GRAPH_NODE_TYPES = Object.freeze([
  'entry',
  'route_endpoint',
  'filter',
  'dispatcher',
  'synthetic_endpoint',
]);
export const ROUTE_GRAPH_TERMINAL_NODE_TYPES = Object.freeze(['route_endpoint', 'synthetic_endpoint']);
export const ROUTE_GRAPH_ENDPOINT_KINDS = Object.freeze(['supply']);
export const ROUTE_GRAPH_ENDPOINT_EXPOSURES = Object.freeze(['none', 'public', 'internal']);
export const ROUTE_GRAPH_ENDPOINT_RESOLUTION_STATUSES = Object.freeze(['resolved', 'degraded', 'unresolved']);
export const ROUTE_GRAPH_ENDPOINT_SOURCE_KINDS = Object.freeze([
  'upstream_model',
  'synthetic',
  'inline',
]);
export const ROUTE_GRAPH_OWNERSHIPS = Object.freeze(['manual', 'system', 'derived']);
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
export const ROUTE_GRAPH_CANDIDATE_SELECTOR_INPUT_KINDS = Object.freeze([
  'route_endpoints',
  'graph_references',
  'model_pattern',
  'metadata_query',
  'endpoint_query',
  'inline_endpoints',
  'synthetic',
]);
export function buildCandidateSelectorSurfacePorts(surface) {
  const entryKind = normalizeEnum(surface?.entry?.kind, ['external', 'embedded', 'none'], 'external');
  const inputKind = entryKind === 'embedded'
    ? normalizeEnum(surface.entry?.input, ['request', 'bidirect'], 'bidirect')
    : 'bidirect';
  const outputKind = normalizeEnum(surface?.output, ['route', 'bidirect'], 'route');
  const inputPortId = inputKind === 'request' ? 'request.in' : 'bidirect.in';
  const outputPortId = outputKind === 'bidirect' ? 'bidirect.out' : 'route.out';
  return [
    ...(entryKind === 'none' ? [] : [{
      id: inputPortId,
      label: inputKind === 'request' ? 'request input' : 'incoming flow',
      direction: 'input',
      kind: inputKind,
      manualEdgePolicy: 'allow',
      multiple: true,
    }]),
    {
      id: 'candidates.in',
      label: 'candidate inputs',
      direction: 'input',
      kind: 'route',
      manualEdgePolicy: 'allow',
      multiple: true,
      collection: { type: 'set', min: 1 },
    },
    {
      id: outputPortId,
      label: outputKind === 'bidirect' ? 'selected flow' : 'candidate targets',
      direction: 'output',
      kind: outputKind,
      manualEdgePolicy: 'allow',
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
    { id: 'bidirect.out', label: 'matched flow', direction: 'output', kind: 'bidirect', manualEdgePolicy: 'allow' },
  ],
  route_endpoint: [
    { id: 'route.out', label: 'route product', direction: 'output', kind: 'route', manualEdgePolicy: 'allow' },
    { id: 'bidirect.in', label: 'invoke route', direction: 'input', kind: 'bidirect', manualEdgePolicy: 'allow', multiple: true },
  ],
  filter: [
    { id: 'request.in', label: 'before mutation', direction: 'input', kind: 'request', manualEdgePolicy: 'allow' },
    { id: 'request.out', label: 'after mutation', direction: 'output', kind: 'request', manualEdgePolicy: 'allow' },
    { id: 'bidirect.in', label: 'before round trip', direction: 'input', kind: 'bidirect', manualEdgePolicy: 'allow' },
    { id: 'bidirect.out', label: 'after round trip', direction: 'output', kind: 'bidirect', manualEdgePolicy: 'allow' },
  ],
  dispatcher: [
    { id: 'bidirect.in', label: 'dispatch input', direction: 'input', kind: 'bidirect', manualEdgePolicy: 'allow', required: true },
    { id: 'bidirect[1...].out', label: 'dispatch path', direction: 'output', kind: 'bidirect', manualEdgePolicy: 'allow', multiple: true, collection: { type: 'arr', min: 1 } },
    { id: 'route.in', label: 'endpoint candidates', direction: 'input', kind: 'route', manualEdgePolicy: 'allow', multiple: true, collection: { type: 'set', min: 1 } },
    { id: 'route.out', label: 'selected route', direction: 'output', kind: 'route', manualEdgePolicy: 'allow', multiple: true },
    { id: 'fallback.out', label: 'fallback when exhausted', direction: 'output', kind: 'bidirect', manualEdgePolicy: 'allow', multiple: false },
  ],
  synthetic_endpoint: [
    { id: 'route.out', label: 'synthetic response', direction: 'output', kind: 'route', manualEdgePolicy: 'allow' },
    { id: 'bidirect.in', label: 'return response', direction: 'input', kind: 'bidirect', manualEdgePolicy: 'allow', multiple: true },
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

function normalizePositiveIntegerList(input) {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input
    .map(normalizePositiveInteger)
    .filter((value) => value !== null)));
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

function stableHash(value) {
  let left = 0x811c9dc5;
  let right = 0x01000193;
  let index = 0;
  const appendText = (text) => {
    for (let offset = 0; offset < text.length; offset += 1) {
      const code = text.charCodeAt(offset);
      left ^= code;
      left = Math.imul(left, 0x01000193) >>> 0;
      right ^= code + index;
      right = Math.imul(right, 0x85ebca6b) >>> 0;
      index += 1;
    }
  };
  const appendStableJson = (input, arrayItem = false) => {
    if (Array.isArray(input)) {
      appendText('[');
      for (let itemIndex = 0; itemIndex < input.length; itemIndex += 1) {
        if (itemIndex > 0) appendText(',');
        appendStableJson(input[itemIndex], true);
      }
      appendText(']');
      return;
    }
    if (input && typeof input === 'object') {
      appendText('{');
      const entries = Object.entries(input).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
      for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
        if (entryIndex > 0) appendText(',');
        const [key, item] = entries[entryIndex];
        appendText(JSON.stringify(key));
        appendText(':');
        appendStableJson(item);
      }
      appendText('}');
      return;
    }
    const serialized = JSON.stringify(input);
    if (serialized !== undefined) {
      appendText(serialized);
    } else if (!arrayItem) {
      appendText('undefined');
    }
  };
  if (typeof value === 'string') {
    appendText(value);
  } else {
    appendStableJson(value);
  }
  return `${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
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
    manualEdgePolicy: normalizeEnum(raw.manualEdgePolicy, ['allow', 'deny'], 'deny'),
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

export function canAttachManualRouteGraphEdge(port) {
  return port?.manualEdgePolicy === 'allow' && port.enabled !== false;
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
    if (port.id === 'fallback.out') return { ...port, enabled: true };
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
  return (Array.isArray(normalizedConfig.surface?.ports)
    ? normalizedConfig.surface.ports.map(normalizeRouteGraphPort).filter((port) => port.id)
    : []);
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
    accountId: normalizePositiveInteger(raw.accountId),
    tokenId: normalizePositiveInteger(raw.tokenId),
    siteId: normalizePositiveInteger(raw.siteId),
  };
}

export function normalizeRouteGraphBackendSpec(input) {
  const raw = isPlainObject(input) ? input : {};
  if (raw.kind === ROUTE_GRAPH_BACKEND_KIND_ROUTE_ENDPOINTS) {
    const endpointIds = Array.isArray(raw.endpointIds)
      ? raw.endpointIds
        .map(normalizeString)
        .filter(Boolean)
      : [];
    return {
      kind: ROUTE_GRAPH_BACKEND_KIND_ROUTE_ENDPOINTS,
      endpointIds: Array.from(new Set(endpointIds)),
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

export function getRouteGraphModelPatternFromSpecs(matchSpec, backendSpec) {
  const normalizedMatch = normalizeRouteGraphMatchSpec(matchSpec);
  const normalizedBackend = normalizeRouteGraphBackendSpec(backendSpec);
  if (normalizedBackend.kind === ROUTE_GRAPH_BACKEND_KIND_ROUTE_ENDPOINTS) {
    return normalizedMatch.displayName || normalizedMatch.requestedModelPattern || '';
  }
  return normalizedMatch.requestedModelPattern || normalizedMatch.displayName || '';
}

export function getRouteGraphExposedModelName(matchSpec, backendSpec) {
  const normalizedMatch = normalizeRouteGraphMatchSpec(matchSpec);
  return normalizedMatch.displayName || getRouteGraphModelPatternFromSpecs(normalizedMatch, backendSpec);
}

export function isRouteGraphExactModelMatch(matchSpec, backendSpec) {
  const normalizedBackend = normalizeRouteGraphBackendSpec(backendSpec);
  if (normalizedBackend.kind !== ROUTE_GRAPH_BACKEND_KIND_SUPPLY) return false;
  const normalizedMatch = normalizeRouteGraphMatchSpec(matchSpec);
  return isExactModelPattern(normalizedMatch.requestedModelPattern);
}

export function routeGraphMatchesRequestedModel(model, matchSpec, backendSpec) {
  const normalizedMatch = normalizeRouteGraphMatchSpec(matchSpec);
  const normalizedBackend = normalizeRouteGraphBackendSpec(backendSpec);
  const displayName = normalizedMatch.displayName || '';
  if (displayName && displayName === model) return true;
  if (normalizedBackend.kind === ROUTE_GRAPH_BACKEND_KIND_ROUTE_ENDPOINTS) return false;
  return matchesModelPattern(model, normalizedMatch.requestedModelPattern);
}

export function routeGraphSupplyEndpointIdFromSupplyKey(supplyKey) {
  return createRuntimeExecutionTargetIdFromSupplyKey(supplyKey);
}

export function routeGraphExecutionTargetIdFromIdentity(identity) {
  return createRuntimeExecutionTargetIdFromIdentity(identity);
}

function normalizeRouteGraphNodeBase(raw, fallbackType = 'entry') {
  return {
    id: normalizeString(raw.id),
    type: normalizeEnum(raw.type, ROUTE_GRAPH_NODE_TYPES, fallbackType),
    name: normalizeNullableString(raw.name),
    enabled: normalizeBoolean(raw.enabled, true),
    ownership: normalizeEnum(raw.ownership, ROUTE_GRAPH_OWNERSHIPS, 'manual'),
    position: isPlainObject(raw.position)
      ? {
        x: Number.isFinite(Number(raw.position.x)) ? Number(raw.position.x) : 0,
        y: Number.isFinite(Number(raw.position.y)) ? Number(raw.position.y) : 0,
      }
      : undefined,
    provenance: isPlainObject(raw.provenance) ? raw.provenance : { source: 'manual' },
    metadata: isPlainObject(raw.metadata) ? raw.metadata : {},
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

export const DEFAULT_ROUTE_FAILURE_BACKOFF_POLICY = Object.freeze({
  failureThreshold: 3,
  levelsSec: Object.freeze([0, 600, 3600, 86400]),
  maxSec: 86400,
});

export function normalizeRouteFailureBackoffPolicy(input) {
  const raw = isPlainObject(input) ? input : {};
  const threshold = Number(raw.failureThreshold);
  const maxSec = Number(raw.maxSec);
  const levels = Array.isArray(raw.levelsSec) ? raw.levelsSec.map(Number) : [];
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > 100) return null;
  if (!Number.isFinite(maxSec) || maxSec <= 0 || maxSec > 30 * 24 * 60 * 60) return null;
  if (levels.length === 0 || levels.length > 32) return null;
  const normalizedLevels = levels.map((value) => Math.trunc(value));
  if (normalizedLevels.some((value) => !Number.isFinite(value) || value < 0 || value > maxSec)) return null;
  for (let index = 1; index < normalizedLevels.length; index += 1) {
    if (normalizedLevels[index] < normalizedLevels[index - 1]) return null;
  }
  return { failureThreshold: threshold, levelsSec: normalizedLevels, maxSec: Math.trunc(maxSec) };
}

export function normalizeRouteFailureBackoffOverride(input) {
  const raw = isPlainObject(input) ? input : {};
  if (raw.mode === 'disabled') return { mode: 'disabled' };
  if (raw.mode !== 'custom') return null;
  const policy = normalizeRouteFailureBackoffPolicy(raw.policy);
  return policy ? { mode: 'custom', policy } : null;
}

function normalizeRouteExecutableTarget(input) {
  const raw = isPlainObject(input) ? input : {};
  const targetId = normalizeString(raw.targetId);
  const model = normalizeString(raw.model);
  const modelSource = normalizeEnum(raw.modelSource, ['fixed', 'request'], model ? 'fixed' : 'request');
  const tokenId = normalizePositiveInteger(raw.tokenId);
  const accountId = normalizePositiveInteger(raw.accountId);
  const siteId = normalizePositiveInteger(raw.siteId);
  const executionTargetId = normalizePositiveInteger(raw.transportBinding?.executionTargetId);
  const failureBackoff = normalizeRouteFailureBackoffOverride(raw.failureBackoff);
  return {
    targetId,
    model,
    modelSource,
    ...(raw.enabled === false ? { enabled: false } : {}),
    ...(tokenId ? { tokenId } : {}),
    ...(accountId ? { accountId } : {}),
    ...(siteId ? { siteId } : {}),
    ...(executionTargetId ? { transportBinding: { kind: 'execution_target', executionTargetId } } : {}),
    ...(Number.isFinite(Number(raw.weight)) ? { weight: Number(raw.weight) } : {}),
    ...(isPlainObject(raw.metadata) ? { metadata: raw.metadata } : {}),
    ...(isPlainObject(raw.compatibilityPolicy) ? { compatibilityPolicy: raw.compatibilityPolicy } : {}),
    ...(failureBackoff ? { failureBackoff } : {}),
  };
}

function normalizeRouteExecutableTargetConfig(input) {
  const raw = isPlainObject(input) ? input : {};
  const targets = Array.isArray(raw.targets)
    ? raw.targets.map(normalizeRouteExecutableTarget)
    : [];
  return {
    ...raw,
    targets,
    targetSelection: normalizeTargetSelectionPolicy(raw.targetSelection),
    ...(isPlainObject(raw.compatibilityPolicy) ? { compatibilityPolicy: raw.compatibilityPolicy } : {}),
  };
}

export function normalizeDispatcherPolicy(input) {
  const raw = isPlainObject(input) ? input : {};
  if (raw.kind === 'inherit_default') return { kind: 'inherit_default' };
  if (raw.kind === 'registry' && normalizeString(raw.policyId)) {
    return { kind: 'registry', policyId: normalizeString(raw.policyId) };
  }
  if (raw.kind === 'inline' && isPlainObject(raw.policy)) {
    return { kind: 'inline', policy: raw.policy };
  }
  if (raw.kind === 'builtin' && ['weighted', 'round_robin', 'stable_first'].includes(raw.builtin)) {
    return { kind: 'builtin', builtin: raw.builtin };
  }
  return { kind: 'inherit_default' };
}

export function validateNativeDispatcherPolicy(input) {
  if (!isPlainObject(input)) {
    return { ok: false, error: 'Expected a native dispatcher policy object.' };
  }
  if (Object.hasOwn(input, 'strategy')) {
    return { ok: false, error: 'Legacy strategy policies are not supported.' };
  }
  if (input.kind === 'inherit_default') {
    return { ok: true, value: { kind: 'inherit_default' } };
  }
  if (input.kind === 'registry' && normalizeString(input.policyId)) {
    return { ok: true, value: { kind: 'registry', policyId: normalizeString(input.policyId) } };
  }
  if (input.kind === 'inline' && isPlainObject(input.policy)) {
    return { ok: true, value: { kind: 'inline', policy: input.policy } };
  }
  if (input.kind === 'builtin' && ['weighted', 'round_robin', 'stable_first'].includes(input.builtin)) {
    return { ok: true, value: { kind: 'builtin', builtin: input.builtin } };
  }
  return { ok: false, error: 'Expected a native dispatcher policy object.' };
}

export function requireNativeDispatcherPolicy(input) {
  const validation = validateNativeDispatcherPolicy(input);
  if (!validation.ok) throw new Error(validation.error);
  return validation.value;
}

export function normalizeTargetSelectionPolicy(input) {
  const raw = isPlainObject(input) ? input : {};
  if (raw.kind === 'defer_to_router') return { kind: 'defer_to_router' };
  return normalizeDispatcherPolicy(raw);
}

export function validateNativeTargetSelectionPolicy(input) {
  if (isPlainObject(input) && input.kind === 'defer_to_router') {
    return { ok: true, value: { kind: 'defer_to_router' } };
  }
  return validateNativeDispatcherPolicy(input);
}

// Check the raw graph before normalization so removed route-policy fields
// cannot be silently discarded by the source normalizer.
export function validateNativeRouteGraphSourcePolicies(sourceInput) {
  if (!isPlainObject(sourceInput)) return [];
  const errors = [];
  const validateDispatcher = (value, label) => {
    const validation = validateNativeDispatcherPolicy(value);
    if (!validation.ok) errors.push(`${label}. ${validation.error}`);
  };
  const validateTargetSelection = (value, label) => {
    const validation = validateNativeTargetSelectionPolicy(value);
    if (!validation.ok) errors.push(`${label}. ${validation.error}`);
  };

  for (const node of Array.isArray(sourceInput.nodes) ? sourceInput.nodes : []) {
    if (!isPlainObject(node)) continue;
    if (node.type === 'dispatcher' && node.policy !== undefined) {
      validateDispatcher(node.policy, 'Invalid dispatcher policy');
    }
    if (node.type === 'route_endpoint' && isPlainObject(node.config) && node.config.targetSelection !== undefined) {
      validateTargetSelection(node.config.targetSelection, 'Invalid target selection policy');
    }
  }

  for (const macro of Array.isArray(sourceInput.macros) ? sourceInput.macros : []) {
    if (!isPlainObject(macro) || !isPlainObject(macro.config)) continue;
    if (macro.config.routingStrategy !== undefined) {
      errors.push('Invalid macro configuration. Use policy instead of routingStrategy.');
    }
    if (macro.config.policy !== undefined) {
      validateDispatcher(macro.config.policy, 'Invalid macro dispatcher policy');
    }
    for (const group of Array.isArray(macro.config.groups) ? macro.config.groups : []) {
      if (!isPlainObject(group)) continue;
      if (Object.hasOwn(group, 'priority') || (isPlainObject(group.defaults) && Object.hasOwn(group.defaults, 'priority'))) {
        errors.push('Invalid fallback stage. Use array order instead of priority.');
      }
      if (group.strategy !== undefined) {
        errors.push('Invalid fallback stage. Use policy instead of strategy.');
      }
      if (group.policy !== undefined) {
        validateDispatcher(group.policy, 'Invalid fallback stage dispatcher policy');
      }
    }
  }

  return errors;
}

export function normalizeRouteGraphNode(input) {
  const raw = isPlainObject(input) ? input : {};
  const type = normalizeEnum(raw.type, ROUTE_GRAPH_NODE_TYPES, 'entry');
  const base = normalizeRouteGraphNodeBase({ ...raw, type }, type);
  if (type === 'entry') {
    return {
      ...base,
      type,
      match: normalizeRouteGraphMatchSpec(raw.match),
    };
  }
  if (type === 'route_endpoint') {
    const routeEndpointId = normalizeString(raw.routeEndpointId);
    const endpointKind = 'supply';
    const exposure = 'none';
    const resolvesTo = isPlainObject(raw.resolvesTo)
      ? {
        kind: normalizeEnum(raw.resolvesTo.kind, ['route_builder', 'synthetic', 'external'], 'external'),
      id: normalizeString(raw.resolvesTo.id),
    }
      : undefined;
    return {
      ...base,
      type,
      routeEndpointId,
      endpointKind,
      exposure,
      resolutionStatus: normalizeEnum(raw.resolutionStatus, ROUTE_GRAPH_ENDPOINT_RESOLUTION_STATUSES, 'resolved'),
      ownerKind: normalizeEnum(raw.ownerKind, ['manual', 'macro'], 'manual'),
      sourceKind: normalizeEnum(raw.sourceKind, ROUTE_GRAPH_ENDPOINT_SOURCE_KINDS, 'upstream_model'),
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
      policy: normalizeDispatcherPolicy(raw.policy),
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
  return {
    ...base,
    type: 'entry',
    match: normalizeRouteGraphMatchSpec(raw.match),
  };
}

export function normalizeRouteGraphEdge(input) {
  const raw = isPlainObject(input) ? input : {};
  const sourceNodeId = normalizeString(raw.sourceNodeId);
  const targetNodeId = normalizeString(raw.targetNodeId);
  const sourcePortId = normalizeString(raw.sourcePortId);
  const targetPortId = normalizeString(raw.targetPortId);
  return {
    id: normalizeString(raw.id) || createRouteProgramEdgeId(sourceNodeId, sourcePortId, targetNodeId, targetPortId),
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
  if (kind === 'graph_references') {
    const endpointIds = Array.isArray(raw.endpointIds)
      ? raw.endpointIds.map((value) => normalizeString(value)).filter(Boolean)
      : [];
    const macroIds = Array.isArray(raw.macroIds)
      ? raw.macroIds.map((value) => normalizeString(value)).filter(Boolean)
      : [];
    return {
      kind,
      endpointIds: Array.from(new Set(endpointIds)),
      macroIds: Array.from(new Set(macroIds)),
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
    manualEdgePolicy: normalizeEnum(raw.manualEdgePolicy, ['allow', 'deny'], 'deny'),
    ...(raw.enabled === false ? { enabled: false } : {}),
    ...(normalizeString(raw.description) ? { description: normalizeString(raw.description) } : {}),
  });
}

function normalizeCandidateSelectorGroupMember(input) {
  const raw = isPlainObject(input) ? input : {};
  const memberId = normalizeString(raw.memberId);
  const endpointId = normalizeString(raw.endpointId);
  const macroId = normalizeString(raw.macroId);
  const failureBackoff = normalizeRouteFailureBackoffOverride(raw.failureBackoff);
  return {
    ...(memberId ? { memberId } : {}),
    ...(endpointId ? { endpointId } : {}),
    ...(macroId ? { macroId } : {}),
    ...(raw.enabled === false ? { enabled: false } : {}),
    ...(Number.isFinite(Number(raw.weight)) ? { weight: Number(raw.weight) } : {}),
    ...(isPlainObject(raw.metadata) ? { metadata: raw.metadata } : {}),
    ...(failureBackoff ? { failureBackoff } : {}),
  };
}

function normalizeCandidateSelectorGroup(input, index) {
  const raw = isPlainObject(input) ? input : {};
  const defaults = isPlainObject(raw.defaults) ? raw.defaults : {};
  const failureBackoff = normalizeRouteFailureBackoffOverride(raw.failureBackoff);
  const defaultFailureBackoff = normalizeRouteFailureBackoffOverride(defaults.failureBackoff);
  const materialization = isPlainObject(raw.materialization) ? raw.materialization : {};
  const normalizedInput = normalizeCandidateSelectorInput(raw.input);
  const rawMembers = Array.isArray(raw.members)
    ? raw.members.map(normalizeCandidateSelectorGroupMember).filter((member) => member.endpointId || member.macroId)
    : [];
  const members = normalizedInput.kind === 'route_endpoints' || normalizedInput.kind === 'graph_references'
    ? (rawMembers.length > 0
      ? rawMembers
      : [
        ...normalizedInput.endpointIds.map((endpointId) => ({ endpointId })),
        ...(normalizedInput.kind === 'graph_references'
          ? normalizedInput.macroIds.map((macroId) => ({ macroId }))
          : []),
      ])
    : rawMembers;
  const inputWithMembers = normalizedInput.kind === 'route_endpoints'
    ? {
      ...normalizedInput,
      endpointIds: Array.from(new Set([
        ...normalizedInput.endpointIds,
        ...members.map((member) => member.endpointId).filter(Boolean),
      ])),
    }
    : normalizedInput.kind === 'graph_references'
      ? {
        ...normalizedInput,
        endpointIds: Array.from(new Set([
          ...normalizedInput.endpointIds,
          ...members.map((member) => member.endpointId).filter(Boolean),
        ])),
        macroIds: Array.from(new Set([
          ...normalizedInput.macroIds,
          ...members.map((member) => member.macroId).filter(Boolean),
        ])),
      }
    : normalizedInput;
  return {
    id: normalizeString(raw.id) || createRouteMacroFallbackStageId(index + 1),
    ...(normalizeString(raw.label) ? { label: normalizeString(raw.label) } : {}),
    enabled: normalizeBoolean(raw.enabled, true),
    ...(raw.acceptUnassigned === true ? { acceptUnassigned: true } : {}),
    ...(isPlainObject(raw.policy) ? { policy: normalizeDispatcherPolicy(raw.policy) } : {}),
    input: inputWithMembers,
    defaults: {
      ...(defaults.enabled === false ? { enabled: false } : {}),
      ...(Number.isFinite(Number(defaults.weight)) ? { weight: Number(defaults.weight) } : {}),
      ...(isPlainObject(defaults.metadata) ? { metadata: defaults.metadata } : {}),
      ...(defaultFailureBackoff ? { failureBackoff: defaultFailureBackoff } : {}),
    },
    ...(failureBackoff ? { failureBackoff } : {}),
    ...(members.length > 0 ? { members } : {}),
    ...(isPlainObject(raw.materialization) ? {
      materialization: {
        ...(normalizeEnum(materialization.sort, ['model_name', 'health', 'cel'], null) ? { sort: materialization.sort } : {}),
        ...(normalizePositiveInteger(materialization.limit) ? { limit: normalizePositiveInteger(materialization.limit) } : {}),
        ...(normalizeEnum(materialization.dedupeBy, ['endpoint_id', 'model', 'metadata'], null) ? { dedupeBy: materialization.dedupeBy } : {}),
      },
    } : {}),
    ...(isPlainObject(raw.metadata) ? { metadata: raw.metadata } : {}),
  };
}

function normalizeCandidateSelectorConfig(input) {
  const raw = isPlainObject(input) ? input : {};
  const rawSurface = isPlainObject(raw.surface) ? raw.surface : {};
  const rawEntry = isPlainObject(rawSurface.entry) ? rawSurface.entry : {};
  const entry = rawEntry.kind === 'none'
    ? { kind: 'none' }
    : rawEntry.kind === 'embedded'
    ? {
      kind: 'embedded',
      input: normalizeEnum(rawEntry.input, ['request', 'bidirect'], 'bidirect'),
    }
    : {
      kind: 'external',
      match: normalizeRouteGraphMatchSpec(rawEntry.match),
    };
  const rawPolicy = isPlainObject(raw.policy) ? raw.policy : {};
  const rawSurfacePorts = Array.isArray(rawSurface.ports) ? rawSurface.ports.map(normalizeMacroSurfacePort).filter((port) => port.id) : [];
  const defaultSurfacePorts = buildCandidateSelectorSurfacePorts({
    entry,
    output: normalizeEnum(rawSurface.output, ['route', 'bidirect'], 'route'),
  });
  const groups = Array.isArray(raw.groups)
    ? raw.groups.map((group, index) => normalizeCandidateSelectorGroup(group, index))
    : [];
  const rawFilters = isPlainObject(raw.filters) ? raw.filters : {};
  const candidateSource = isPlainObject(raw.candidateSource)
    ? normalizeCandidateSelectorInput(raw.candidateSource)
    : null;
  const filterOperations = Array.isArray(rawFilters.operations)
    ? rawFilters.operations.map(normalizeRouteFilter)
    : [];
  return {
    surface: {
      entry,
      output: normalizeEnum(rawSurface.output, ['route', 'bidirect'], 'route'),
      ports: rawSurfacePorts.length > 0 ? rawSurfacePorts : defaultSurfacePorts.map((port) => normalizeMacroSurfacePort(port)),
    },
    policy: normalizeDispatcherPolicy(rawPolicy),
    ...(filterOperations.length > 0 ? { filters: { operations: filterOperations } } : {}),
    ...(candidateSource?.kind === 'model_pattern'
      ? { candidateSource }
      : {}),
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

export function buildCandidateSelectorMacro(input) {
  const endpointIds = Array.isArray(input?.endpointIds)
    ? Array.from(new Set(input.endpointIds.map((value) => normalizeString(value)).filter(Boolean)))
    : [];
  const rawFallbackStages = Array.isArray(input?.fallbackStages)
    ? input.fallbackStages
    : [];
  const fallbackStages = rawFallbackStages.length > 0
    ? rawFallbackStages.map((stage, index) => {
      const members = Array.isArray(stage?.members)
        ? stage.members
          .map(normalizeCandidateSelectorGroupMember)
          .filter((member) => member.endpointId || member.macroId)
        : [];
      const stageEndpointIds = members.map((member) => member.endpointId).filter(Boolean);
      const stageMacroIds = members.map((member) => member.macroId).filter(Boolean);
      return {
        id: normalizeString(stage?.id) || createRouteMacroFallbackStageId(index + 1),
        label: normalizeNullableString(stage?.label) || `Fallback stage ${index + 1}`,
        enabled: stage?.enabled !== false,
        ...(isPlainObject(stage?.policy) ? { policy: normalizeDispatcherPolicy(stage.policy) } : {}),
        input: stageMacroIds.length > 0
          ? { kind: 'graph_references', endpointIds: stageEndpointIds, macroIds: stageMacroIds }
          : { kind: 'route_endpoints', endpointIds: stageEndpointIds },
        members,
      };
    }).filter((stage) => stage.members.length > 0)
    : [];
  const candidateStages = fallbackStages.length > 0
    ? fallbackStages
    : endpointIds.length > 0
      ? [{
        id: createRouteMacroFallbackStageId('default'),
        label: 'Default',
        enabled: true,
        members: endpointIds.map((endpointId) => ({ endpointId })),
      }]
    : [{
      id: createRouteMacroFallbackStageId('unavailable'),
      label: 'Unavailable',
      enabled: true,
      input: { kind: 'synthetic', statusCode: 503, message: 'No route is available.' },
    }];
  const displayName = normalizeNullableString(input?.displayName) || null;
  const match = normalizeRouteGraphMatchSpec(input?.match);
  const stableId = normalizeNullableString(input?.stableId) || null;
  const id = stableId || createRouteBuilderMacroId(displayName || 'route');
  return normalizeRouteGraphMacro({
    id,
    kind: 'candidate_selector',
    enabled: normalizeBoolean(input?.enabled, true),
    ownership: normalizeEnum(input?.ownership, ROUTE_GRAPH_OWNERSHIPS.filter((item) => item !== 'derived'), 'manual'),
    name: displayName,
    config: {
      surface: {
        entry: input?.ingress === 'none'
          ? { kind: 'none' }
          : input?.ingress === 'embedded'
            ? { kind: 'embedded', input: 'bidirect' }
            : {
            kind: 'external',
            match: {
            kind: 'model',
            requestedModelPattern: match.requestedModelPattern || '',
            displayName: displayName ?? match.displayName,
          },
          },
        output: 'route',
        ports: buildCandidateSelectorSurfacePorts({
          entry: input?.ingress === 'none'
            ? { kind: 'none' }
            : input?.ingress === 'embedded'
              ? { kind: 'embedded', input: 'bidirect' }
              : { kind: 'external' },
          output: 'route',
        }).map((port) => normalizeMacroSurfacePort(port)),
      },
      policy: isPlainObject(input?.policy)
        ? normalizeDispatcherPolicy(input.policy)
        : { kind: 'inherit_default' },
      ...(isPlainObject(input?.filters) ? { filters: normalizeCandidateSelectorConfig({ filters: input.filters }).filters } : {}),
      groups: candidateStages.map((group) => ({
        id: group.id,
        label: group.label,
        enabled: group.enabled,
        ...(isPlainObject(group.policy) ? { policy: group.policy } : {}),
        input: isPlainObject(group.input)
          ? group.input
          : { kind: 'route_endpoints', endpointIds: group.members.map((member) => member.endpointId) },
        defaults: {
          enabled: true,
          weight: 1,
        },
        ...(Array.isArray(group.members) ? { members: group.members } : {}),
      })),
      ...(normalizeNullableString(input?.displayIcon) ? { presentation: { displayIcon: normalizeNullableString(input.displayIcon) } } : {}),
    },
    ...(isPlainObject(input?.metadata) ? { metadata: input.metadata } : {}),
  });
}

export function normalizeRouteGraphSource(input) {
  const raw = isPlainObject(input) ? input : {};
  const nodes = Array.isArray(raw.nodes) ? raw.nodes.map(normalizeRouteGraphNode) : [];
  const edges = Array.isArray(raw.edges) ? raw.edges.map(normalizeRouteGraphEdge) : [];
  return {
    nodes,
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
  const fallbackOutgoingByPort = new Map();
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
    // Fallback is conditional continuation, not a branch. Enforce the
    // one-successor contract here so compiler behavior cannot depend on edge
    // insertion order.
    if (edge.sourcePortId === 'fallback.out') {
      const outgoingKey = `${edge.sourceNodeId}\u0000${edge.sourcePortId}`;
      if (fallbackOutgoingByPort.has(outgoingKey)) {
        addDiagnostic(
          diagnostics,
          'error',
          'edge.fallback_fanout',
          `Fallback port ${edge.sourcePortId} on ${edge.sourceNodeId} allows only one continuation.`,
          edge.sourceNodeId,
          edge.id,
        );
        continue;
      }
      fallbackOutgoingByPort.set(outgoingKey, edge.id);
    }
    const expectedKind = inferEdgeKindFromPorts(sourcePort, targetPort);
    if (edge.kind !== expectedKind) {
      addDiagnostic(diagnostics, 'warning', 'edge.kind_mismatch', `Edge kind ${edge.kind} does not match port flow ${expectedKind}.`, edge.sourceNodeId, edge.id);
    }
    dedupe.add(key);
    adjacency.get(edge.sourceNodeId).push(edge.targetNodeId);
  }
  for (const node of nodesById.values()) {
    if (node.enabled === false) continue;
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
  if (!node || node.type !== 'entry') return '';
  return node.match?.displayName || node.match?.requestedModelPattern || '';
}

function publicEntryResolutionInfo(node) {
  return {
    nodeId: node.id,
  };
}

function endpointIdsFromRouteGraphCandidateNode(node) {
  if (!node) return [];
  if (node.type === 'route_endpoint') {
    const backend = normalizeRouteGraphBackendSpec(node.backend);
    if (backend.kind === ROUTE_GRAPH_BACKEND_KIND_ROUTE_ENDPOINTS) return backend.endpointIds;
    return [node.routeEndpointId].map(normalizeString).filter(Boolean);
  }
  return [];
}

function routeProgramSourceRefFromNode(node, extra = {}) {
  const metadata = isPlainObject(node?.metadata) ? node.metadata : {};
  const provenance = isPlainObject(node?.provenance) ? node.provenance : {};
  const metadataProvenance = isPlainObject(metadata.provenance) ? metadata.provenance : {};
  const macroCandidate = isPlainObject(metadata.macroCandidate) ? metadata.macroCandidate : {};
  const macroId = normalizeString(
    extra.macroId
      || provenance.macroId
      || macroCandidate.macroId,
  );
  const nodeId = normalizeString(extra.nodeId || node?.id);
  return {
    ...(nodeId ? { nodeId } : {}),
    ...(normalizeString(extra.edgeId) ? { edgeId: normalizeString(extra.edgeId) } : {}),
    ...(macroId ? { macroId } : {}),
    ...(normalizeString(extra.endpointId || node?.routeEndpointId) ? { endpointId: normalizeString(extra.endpointId || node?.routeEndpointId) } : {}),
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

function routeProgramMatcherTarget(program, entry) {
  return {
    programId: program.id,
    entryNodeId: entry.nodeId,
    publicModelName: entry.publicModelName,
  };
}

function isExactRouteProgramEntry(entry) {
  if (normalizeString(entry?.match?.displayName)) return true;
  return isExactModelPattern(entry?.match?.requestedModelPattern || entry?.publicModelName || '');
}

function routeProgramEndpointIdForNode(node) {
  if (!node) return '';
  if (node.type === 'route_endpoint') return node.routeEndpointId || '';
  if (node.type === 'synthetic_endpoint') return `synthetic:${node.id}`;
  return node.id;
}

function compiledEndpointTargetsForRouteEndpoint(endpointNode, endpointId, sourceRef, diagnostics) {
  const targets = Array.isArray(endpointNode?.config?.targets) ? endpointNode.config.targets : [];
  return targets.map((target) => {
    const rawTargetId = normalizeString(target.targetId);
    if (!rawTargetId) {
      addDiagnostic(
        diagnostics,
        'error',
        'route_endpoint.target_id_required',
        `Route endpoint ${endpointNode.id} executable target must declare a stable target id.`,
        endpointNode.id,
      );
      return null;
    }
    return {
      endpointId,
      targetId: rawTargetId,
      nodeId: endpointNode.id,
      model: normalizeString(target.model),
      modelSource: target.modelSource === 'request' ? 'request' : 'fixed',
      enabled: target.enabled !== false && endpointNode.enabled !== false,
      ...(target.accountId !== undefined ? { accountId: target.accountId } : {}),
      ...(target.tokenId !== undefined ? { tokenId: target.tokenId } : {}),
      ...(target.siteId !== undefined ? { siteId: target.siteId } : {}),
      ...(Number.isFinite(Number(target.weight)) ? { weight: Number(target.weight) } : {}),
      ...(isPlainObject(target.transportBinding) ? { transportBinding: target.transportBinding } : {}),
      metadata: isPlainObject(target.metadata) ? target.metadata : {},
      ...(isPlainObject(target.compatibilityPolicy)
        ? { compatibilityPolicy: target.compatibilityPolicy }
        : (isPlainObject(endpointNode.config?.compatibilityPolicy) ? { compatibilityPolicy: endpointNode.config.compatibilityPolicy } : {})),
      ...(target.failureBackoff ? { failureBackoff: target.failureBackoff } : {}),
      sourceRef: sourceRef || routeProgramSourceRefFromNode(endpointNode, {
        endpointId,
        generatedNodeIds: endpointNode.ownership === 'derived' ? [endpointNode.id] : [],
      }),
    };
  }).filter(Boolean);
}

function routeProgramOpId(programId, suffix) {
  return `${programId}:op:${macroSafeId(suffix)}`;
}

function routeProgramCandidateId(programId, edge, node, kind) {
  const edgeId = normalizeString(edge?.id);
  if (edgeId) return `${programId}:candidate:${macroSafeId(edgeId)}`;
  const nodeId = normalizeString(node?.id);
  if (nodeId) return `${programId}:candidate:${macroSafeId(kind || 'route')}:${macroSafeId(nodeId)}`;
  return '';
}

function routeGraphEdgePortKey(nodeId, portId) {
  return `${nodeId}\u0000${portId}`;
}

function appendRouteGraphEdgeIndex(index, key, edge) {
  const entries = index.get(key);
  if (entries) {
    entries.push(edge);
  } else {
    index.set(key, [edge]);
  }
}

function buildRouteGraphEdgeIndexes(nodesById, edges) {
  const activeEdges = [];
  const outgoingByNodeId = new Map();
  const incomingByNodeId = new Map();
  const outgoingByPort = new Map();
  const incomingByPort = new Map();
  for (const nodeId of nodesById.keys()) {
    outgoingByNodeId.set(nodeId, []);
    incomingByNodeId.set(nodeId, []);
  }
  for (const edge of edges) {
    const sourceNode = nodesById.get(edge.sourceNodeId);
    const targetNode = nodesById.get(edge.targetNodeId);
    if (isInactiveDispatcherModeEdge(edge, sourceNode, targetNode)) continue;
    activeEdges.push(edge);
    appendRouteGraphEdgeIndex(outgoingByNodeId, edge.sourceNodeId, edge);
    appendRouteGraphEdgeIndex(incomingByNodeId, edge.targetNodeId, edge);
    appendRouteGraphEdgeIndex(outgoingByPort, routeGraphEdgePortKey(edge.sourceNodeId, edge.sourcePortId), edge);
    appendRouteGraphEdgeIndex(incomingByPort, routeGraphEdgePortKey(edge.targetNodeId, edge.targetPortId), edge);
  }
  return {
    activeEdges,
    outgoingByNodeId,
    incomingByNodeId,
    outgoingByPort,
    incomingByPort,
  };
}

function buildRouteGraphSourceNodeIndexes(nodes) {
  const routeEndpointsById = new Map();
  const routeEndpointsByNodeId = new Map();
  const entriesByNodeId = new Map();
  const supplyEndpoints = [];
  for (const node of nodes) {
    if (node.type === 'entry' && !entriesByNodeId.has(node.id)) {
      entriesByNodeId.set(node.id, node);
    }
    if (node.type !== 'route_endpoint') continue;
    if (!routeEndpointsByNodeId.has(node.id)) {
      routeEndpointsByNodeId.set(node.id, node);
    }
    const endpointId = normalizeString(node.routeEndpointId);
    if (endpointId && !routeEndpointsById.has(endpointId)) {
      routeEndpointsById.set(endpointId, node);
    }
    if (node.endpointKind === 'supply') supplyEndpoints.push(node);
  }
  return {
    entriesByNodeId,
    routeEndpointsById,
    routeEndpointsByNodeId,
    supplyEndpoints,
  };
}

function routeProgramOutgoing(edgesByFromPort, nodeId, sourcePortId) {
  return edgesByFromPort.get(routeGraphEdgePortKey(nodeId, sourcePortId)) || [];
}

function routeProgramIncoming(edgesByToPort, nodeId, targetPortId) {
  return edgesByToPort.get(routeGraphEdgePortKey(nodeId, targetPortId)) || [];
}

function buildRouteProgramSourceIndexes(sourceInput) {
  const source = sourceInput;
  const nodesByIdMap = new Map(source.nodes.map((node) => [node.id, node]));
  const edgeIndexes = buildRouteGraphEdgeIndexes(nodesByIdMap, source.edges);
  const entries = source.nodes
    .filter((node) => node.type === 'entry')
    .map((node) => ({
      nodeId: node.id,
      enabled: node.enabled !== false,
      match: normalizeRouteGraphMatchSpec(node.match),
      backend: deriveEntryBackendSpec(node.id, nodesByIdMap, edgeIndexes.outgoingByNodeId, edgeIndexes.incomingByNodeId),
      publicModelName: getPublicModelName(node),
    }));
  const routeEndpoints = source.nodes
    .filter((node) => node.type === 'route_endpoint')
    .map((node) => ({
      nodeId: node.id,
      endpointId: node.routeEndpointId || '',
      enabled: node.enabled !== false,
      endpointKind: 'supply',
      exposure: 'none',
      resolutionStatus: normalizeEnum(node.resolutionStatus, ROUTE_GRAPH_ENDPOINT_RESOLUTION_STATUSES, 'resolved'),
      ownerKind: node.ownerKind || 'manual',
      sourceKind: node.sourceKind || 'upstream_model',
      ...(node.resolvesTo ? { resolvesTo: node.resolvesTo } : {}),
      backend: normalizeRouteGraphBackendSpec(node.backend),
      match: node.match ? normalizeRouteGraphMatchSpec(node.match) : normalizeRouteGraphMatchSpec(null),
      publicModelName: '',
    }));
  return {
    entries,
    entriesByNodeId: new Map(entries.map((entry) => [entry.nodeId, entry])),
    routeEndpoints,
    nodesById: Object.fromEntries(source.nodes.map((node) => [node.id, node])),
    edgesByFromPort: edgeIndexes.outgoingByPort,
    edgesByToPort: edgeIndexes.incomingByPort,
  };
}

function routeProgramTerminalModelForEndpoint(nodesById, node) {
  if (!node || node.type !== 'route_endpoint') return '';
  if (node.match?.requestedModelPattern && isExactModelPattern(node.match.requestedModelPattern)) {
    return node.match.requestedModelPattern;
  }
  if (node.match?.displayName) return node.match.displayName;
  return '';
}

function routeProgramSupplyEndpointTargetSelectionPolicy(node) {
  const config = isPlainObject(node?.config) ? node.config : {};
  return normalizeTargetSelectionPolicy(config.targetSelection);
}

function routeProgramEndpointCompatibilityPolicy(node) {
  if (isPlainObject(node?.compatibilityPolicy)) return node.compatibilityPolicy;
  const config = isPlainObject(node?.config) ? node.config : {};
  return isPlainObject(config.compatibilityPolicy) ? config.compatibilityPolicy : undefined;
}

function routeProgramDispatcherPolicy(node) {
  if (isPlainObject(node?.policy)) return node.policy;
  return { kind: 'inherit_default' };
}

function canElideSingleCompiledSelection(policy) {
  return isPlainObject(policy) && policy.kind === 'builtin';
}

function routeProgramCandidateBase(input) {
  const metadata = isPlainObject(input.metadata) ? input.metadata : {};
  const weight = Number.isFinite(Number(metadata.weight)) ? Number(metadata.weight) : input.defaultWeight;
  const failureBackoff = normalizeRouteFailureBackoffOverride(input.failureBackoff || metadata.failureBackoff);
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
    ...(failureBackoff ? { failureBackoff } : {}),
    metadata,
    sourceRef: input.sourceRef || {},
  };
}

function buildRouteProgramOpsForEntry(input) {
  const { program, entry, nodesById, edgesByFromPort, edgesByToPort, diagnostics } = input;
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
    const candidates = activeEdges.map((edge) => {
      const targetNode = nodesById[edge.targetNodeId];
      const candidateId = routeProgramCandidateId(program.id, edge, targetNode, 'bidirect');
      if (!candidateId) {
        addDiagnostic(diagnostics, 'error', 'program.candidate_identity_required', `Flow branch ${ownerNode?.id || entry.nodeId} candidate must resolve to a stable source identity.`, ownerNode?.id || entry.nodeId, edge.id);
        return null;
      }
      const targetOpId = compileNode(edge.targetNodeId, edge.targetPortId, path.concat(ownerNode?.id || 'branch', candidateId));
      return routeProgramCandidateBase({
        id: candidateId,
        kind: 'bidirect',
        nodeId: targetNode?.id,
        edgeId: edge.id,
        targetOpId,
        metadata: isPlainObject(edge.metadata) ? edge.metadata : {},
        enabled: targetNode?.enabled !== false,
        defaultWeight: 1,
        sourceRef: routeProgramSourceRefFromEdge(edge),
      });
    }).filter((candidate) => candidate && candidate.targetOpId);
    if (candidates.length === 0) return null;
    return addOp({
      id: opId,
      op: 'dispatch',
      mode: 'flow',
      nodeId: ownerNode?.id || entry.nodeId,
      policy: { kind: 'builtin', builtin: 'stable_first' },
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

    if (node.type === 'dispatcher' && node.mode === 'route' && node.enabled !== false) {
      const opId = routeProgramOpId(program.id, `${node.id}:dispatch-route`);
      if (opsById.has(opId)) {
        compiledByState.set(stateKey, opId);
        return opId;
      }
      compiledByState.set(stateKey, opId);
      const candidateEdges = routeProgramIncoming(edgesByToPort, node.id, 'route.in');
      const candidates = candidateEdges.map((edge, index) => {
        const candidateNode = nodesById[edge.sourceNodeId];
        if (!candidateNode) return null;
        const candidateId = routeProgramCandidateId(program.id, edge, candidateNode, 'route');
        if (!candidateId) {
          addDiagnostic(diagnostics, 'error', 'program.candidate_identity_required', `Route dispatcher ${node.id} candidate must resolve to a stable source identity.`, node.id, edge.id);
          return null;
        }
        const nodeMetadata = isPlainObject(candidateNode.metadata) ? candidateNode.metadata : {};
        const edgeMetadata = isPlainObject(edge.metadata) ? edge.metadata : {};
        const candidateMetadata = isPlainObject(edgeMetadata.candidate) ? edgeMetadata.candidate : {};
        const edgeSelfMetadata = { ...edgeMetadata };
        delete edgeSelfMetadata.candidate;
        delete edgeSelfMetadata.provenance;
        const resolvedCandidateMetadata = {
          ...candidateMetadata,
        };
        const selectionMetadata = Object.keys(resolvedCandidateMetadata).length > 0
          ? { ...edgeSelfMetadata, ...resolvedCandidateMetadata }
          : edgeSelfMetadata;
        const candidateWeight = Number(resolvedCandidateMetadata.weight);
        const nodeWeight = Number(nodeMetadata.weight);
        const edgeWeight = Number(edgeSelfMetadata.weight);
        let targetOpId = '';
        if (
          candidateNode.type === 'route_endpoint'
          && candidateNode.endpointKind === 'supply'
          && Array.isArray(candidateNode.config?.targets)
          && candidateNode.config.targets.length > 0
        ) {
          targetOpId = routeProgramOpId(program.id, `${node.id}:${candidateId}:select-supply`);
          if (!opsById.has(targetOpId)) {
            const endpointId = routeProgramEndpointIdForNode(candidateNode);
            addOp({
              id: targetOpId,
              op: 'select_supply',
              endpointId,
              nodeId: candidateNode.id,
              routeEndpointId: endpointId,
              terminalModel: routeProgramTerminalModelForEndpoint(nodesById, candidateNode),
              targetSelectionPolicy: routeProgramSupplyEndpointTargetSelectionPolicy(candidateNode),
              targets: compiledEndpointTargetsForRouteEndpoint(candidateNode, endpointId, routeProgramSourceRefFromEdge(edge), diagnostics),
              ...(routeProgramEndpointCompatibilityPolicy(candidateNode) ? { compatibilityPolicy: routeProgramEndpointCompatibilityPolicy(candidateNode) } : {}),
              ...(isPlainObject(candidateNode.metadata) ? { metadata: candidateNode.metadata } : {}),
              sourceRef: routeProgramSourceRefFromEdge(edge),
            });
          }
        } else {
          targetOpId = compileNode(candidateNode.id, 'route.selected', path.concat(stateKey, candidateId)) || '';
        }
        return routeProgramCandidateBase({
          id: candidateId,
          kind: 'route',
          nodeId: candidateNode.id,
          edgeId: edge.id,
          endpointId: routeProgramEndpointIdForNode(candidateNode),
          targetOpId,
          metadata: selectionMetadata,
          enabled: candidateNode.enabled !== false && resolvedCandidateMetadata.enabled !== false && resolvedCandidateMetadata.excluded !== true,
          defaultWeight: Number.isFinite(nodeWeight)
            ? nodeWeight
            : (Number.isFinite(edgeWeight)
              ? edgeWeight
              : (Number.isFinite(candidateWeight) ? candidateWeight : 1)),
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
      const fallbackEdge = routeProgramOutgoing(edgesByFromPort, node.id, 'fallback.out')[0] || null;
      if (!fallbackEdge) return opId;
      const fallbackNode = nodesById[fallbackEdge.targetNodeId];
      const fallbackTargetOpId = compileNode(
        fallbackEdge.targetNodeId,
        fallbackEdge.targetPortId,
        path.concat(stateKey, fallbackEdge.id),
      );
      if (!fallbackNode || !fallbackTargetOpId) {
        addDiagnostic(
          diagnostics,
          'error',
          'program.fallback_stage_unavailable',
          `Fallback destination for ${node.id} does not compile to an executable route stage.`,
          node.id,
          fallbackEdge.id,
        );
        return opId;
      }
      const fallbackOpId = routeProgramOpId(program.id, `${node.id}:fallback`);
      addOp({
        id: fallbackOpId,
        op: 'fallback',
        nodeId: node.id,
        stages: [
          {
            stageId: node.id,
            nodeId: node.id,
            order: 0,
            targetOpId: opId,
            sourceRef: routeProgramSourceRefFromNode(node),
          },
          {
            stageId: fallbackNode.id,
            nodeId: fallbackNode.id,
            order: 1,
            targetOpId: fallbackTargetOpId,
            sourceRef: routeProgramSourceRefFromEdge(fallbackEdge),
          },
        ],
        sourceRef: routeProgramSourceRefFromNode(node),
      });
      compiledByState.set(stateKey, fallbackOpId);
      return fallbackOpId;
    }

    if (node.type === 'dispatcher' && node.mode === 'flow' && node.enabled !== false) {
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
        const candidateId = routeProgramCandidateId(program.id, edge, targetNode, 'bidirect');
        if (!candidateId) {
          addDiagnostic(diagnostics, 'error', 'program.candidate_identity_required', `Flow dispatcher ${node.id} candidate must resolve to a stable source identity.`, node.id, edge.id);
          return null;
        }
        const metadata = isPlainObject(edge.metadata) ? edge.metadata : {};
        const targetOpId = compileNode(targetNode.id, edge.targetPortId, path.concat(stateKey, candidateId));
        return routeProgramCandidateBase({
          id: candidateId,
          kind: 'bidirect',
          nodeId: targetNode.id,
          edgeId: edge.id,
          endpointId: routeProgramEndpointIdForNode(targetNode),
          targetOpId,
          metadata,
          enabled: metadata.enabled !== false,
          defaultWeight: 1,
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
      const fallbackEdge = routeProgramOutgoing(edgesByFromPort, node.id, 'fallback.out')[0] || null;
      if (!fallbackEdge) return opId;
      const fallbackNode = nodesById[fallbackEdge.targetNodeId];
      const fallbackTargetOpId = compileNode(
        fallbackEdge.targetNodeId,
        fallbackEdge.targetPortId,
        path.concat(stateKey, fallbackEdge.id),
      );
      if (!fallbackNode || !fallbackTargetOpId) {
        addDiagnostic(diagnostics, 'error', 'program.fallback_stage_unavailable', `Fallback destination for ${node.id} does not compile to an executable stage.`, node.id, fallbackEdge.id);
        return opId;
      }
      const fallbackOpId = routeProgramOpId(program.id, `${node.id}:fallback`);
      addOp({
        id: fallbackOpId,
        op: 'fallback',
        nodeId: node.id,
        stages: [
          { stageId: node.id, nodeId: node.id, order: 0, targetOpId: opId, sourceRef: routeProgramSourceRefFromNode(node) },
          { stageId: fallbackNode.id, nodeId: fallbackNode.id, order: 1, targetOpId: fallbackTargetOpId, sourceRef: routeProgramSourceRefFromEdge(fallbackEdge) },
        ],
        sourceRef: routeProgramSourceRefFromNode(node),
      });
      compiledByState.set(stateKey, fallbackOpId);
      return fallbackOpId;
    }

    if (node.type === 'route_endpoint') {
      if (node.endpointKind === 'supply') {
        const opId = routeProgramOpId(program.id, `${node.id}:select-supply`);
        if (opsById.has(opId)) {
          compiledByState.set(stateKey, opId);
          return opId;
        }
        compiledByState.set(stateKey, opId);
        const endpointId = routeProgramEndpointIdForNode(node);
        return addOp({
          id: opId,
          op: 'select_supply',
          endpointId,
          nodeId: node.id,
          routeEndpointId: endpointId,
          terminalModel: routeProgramTerminalModelForEndpoint(nodesById, node),
          targetSelectionPolicy: routeProgramSupplyEndpointTargetSelectionPolicy(node),
          targets: compiledEndpointTargetsForRouteEndpoint(node, endpointId, routeProgramSourceRefFromNode(node, { endpointId }), diagnostics),
          ...(routeProgramEndpointCompatibilityPolicy(node) ? { compatibilityPolicy: routeProgramEndpointCompatibilityPolicy(node) } : {}),
          ...(isPlainObject(node.metadata) ? { metadata: node.metadata } : {}),
          sourceRef: routeProgramSourceRefFromNode(node, { endpointId }),
        });
      }
      const opId = routeProgramOpId(program.id, `${node.id}:call-product`);
      if (opsById.has(opId)) {
        compiledByState.set(stateKey, opId);
        return opId;
      }
      let targetNodeId = '';
      if (node.resolvesTo?.kind === 'route_builder') targetNodeId = createRouteMacroDispatcherNodeId(node.resolvesTo.id);
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
        ...(isPlainObject(node.metadata) ? { metadata: node.metadata } : {}),
        sourceRef: routeProgramSourceRefFromNode(node),
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

function buildCompiledRouterPlanSource(input) {
  const semanticSource = input?.semanticSource;
  const primitiveSource = input?.primitiveSource;
  const {
    nodesById,
    routeEndpoints,
    entries,
    entriesByNodeId,
    edgesByFromPort,
    edgesByToPort,
  } = buildRouteProgramSourceIndexes(primitiveSource);
  const diagnostics = [];
  const programs = [];
  const programByEntryNodeId = new Map();

  for (const entry of entries) {
    if (entry.enabled === false || !normalizeString(entry.publicModelName)) continue;
    const entryNode = nodesById[entry.nodeId];
    const program = {
      id: routeProgramIdForEntry(entry),
      entryNodeId: entry.nodeId,
      publicModelName: entry.publicModelName,
      enabled: entry.enabled !== false,
      ops: [],
      ...(isPlainObject(entryNode?.metadata) ? { metadata: entryNode.metadata } : {}),
      sourceRef: routeProgramSourceRefFromNode(entryNode),
    };
    programs.push(program);
    programByEntryNodeId.set(entry.nodeId, program);
  }

  const matcher = { exact: {}, normalizedExact: {}, patterns: [] };
  const matcherResolutionByKey = new Map();
  const setExactMatcherTarget = (key, target, entry, entryNode) => {
    const resolutionKey = `exact:${key.toLowerCase()}`;
    const existing = matcher.exact[key];
    if (!existing) {
      matcher.exact[key] = target;
      matcherResolutionByKey.set(resolutionKey, publicEntryResolutionInfo(entryNode));
      return;
    }
    if (existing.programId === target.programId) {
      matcher.exact[key] = target;
      matcherResolutionByKey.set(resolutionKey, publicEntryResolutionInfo(entryNode));
      return;
    }
    addDiagnostic(diagnostics, 'error', 'program.matcher_duplicate', `Program matcher exact key ${key} is already mapped.`, entry.nodeId);
  };
  const setNormalizedMatcherTarget = (key, target, entry, entryNode) => {
    const existing = matcher.normalizedExact[key];
    if (!existing) {
      matcher.normalizedExact[key] = target;
      matcherResolutionByKey.set(`normalized:${key}`, publicEntryResolutionInfo(entryNode));
      return;
    }
    if (existing.programId === target.programId) {
      matcher.normalizedExact[key] = target;
      matcherResolutionByKey.set(`normalized:${key}`, publicEntryResolutionInfo(entryNode));
      return;
    }
    addDiagnostic(diagnostics, 'error', 'program.matcher_duplicate', `Program matcher normalized key ${key} is already mapped.`, entry.nodeId);
  };
  for (const entry of entries) {
    if (entry.enabled === false || !normalizeString(entry.publicModelName)) continue;
    const program = programByEntryNodeId.get(entry.nodeId);
    if (!program) continue;
    const entryNode = nodesById[entry.nodeId];
    const target = routeProgramMatcherTarget(program, entry);
    if (isExactRouteProgramEntry(entry)) {
      setExactMatcherTarget(entry.publicModelName, target, entry, entryNode);
      const normalized = entry.publicModelName.toLowerCase();
      setNormalizedMatcherTarget(normalized, target, entry, entryNode);
      continue;
    }
    matcher.patterns.push({
      ...target,
      pattern: entry.match?.requestedModelPattern || entry.publicModelName,
      patternKind: String(entry.match?.requestedModelPattern || '').startsWith('re:') ? 'regex' : 'wildcard',
    });
  }

  for (const program of programs) {
    const entry = entriesByNodeId.get(program.entryNodeId);
    if (!entry) continue;
    const compiledOps = buildRouteProgramOpsForEntry({
      program,
      entry,
      nodesById,
      edgesByFromPort,
      edgesByToPort,
      diagnostics,
    });
    program.startOpId = compiledOps.startOpId || null;
    program.ops = compiledOps.ops;
    if (!program.startOpId) {
      addDiagnostic(diagnostics, 'error', 'program.entry_without_program', `Public entry ${program.entryNodeId} did not compile to an executable route program.`, program.entryNodeId);
    }
  }
  const bundleWithoutHash = {
    matcher,
    programs,
    diagnostics,
    metadata: isPlainObject(semanticSource.metadata) ? semanticSource.metadata : {},
  };
  return {
    ...bundleWithoutHash,
    hash: stableHash(bundleWithoutHash),
  };
}

function cloneRouteMatcherTarget(target) {
  return isPlainObject(target) ? { ...target } : null;
}

function buildCompiledRouterMatcher(matcher, planIds) {
  const exact = {};
  const normalizedExact = {};
  const patterns = [];
  for (const [key, target] of Object.entries(isPlainObject(matcher?.exact) ? matcher.exact : {})) {
    const cloned = cloneRouteMatcherTarget(target);
    if (cloned && planIds.has(cloned.programId)) exact[key] = cloned;
  }
  for (const [key, target] of Object.entries(isPlainObject(matcher?.normalizedExact) ? matcher.normalizedExact : {})) {
    const cloned = cloneRouteMatcherTarget(target);
    if (cloned && planIds.has(cloned.programId)) normalizedExact[key] = cloned;
  }
  for (const target of Array.isArray(matcher?.patterns) ? matcher.patterns : []) {
    const cloned = cloneRouteMatcherTarget(target);
    if (cloned && planIds.has(cloned.programId)) patterns.push(cloned);
  }
  return { exact, normalizedExact, patterns };
}

function buildCompiledRouterPlanFromRouteProgram(program, diagnostics) {
  if (!program?.startOpId || !Array.isArray(program.ops)) return null;
  const executionAlternatives = [];
  const filterStages = [];
  const filterStageIndexByOpId = new Map();
  const opsById = new Map(program.ops.map((op) => [op.id, op]));
  const alternativeIds = new Set();

  const addFilterStage = (op) => {
    if (!op || op.op !== 'filter') return null;
    const opId = normalizeString(op.id);
    if (opId && filterStageIndexByOpId.has(opId)) return filterStageIndexByOpId.get(opId);
    const index = filterStages.length;
    filterStages.push({
      nodeId: op.nodeId,
      phase: op.phase,
      operations: Array.isArray(op.operations) ? op.operations : [],
    });
    if (opId) filterStageIndexByOpId.set(opId, index);
    return index;
  };

  const terminalFromOp = (op) => {
    if (!op) return null;
    if (op.op === 'synthetic') {
      return {
        kind: 'synthetic',
        nodeId: op.nodeId,
        statusCode: op.statusCode === 429 ? 429 : 503,
        message: op.message || 'No route is available.',
        ...(isPlainObject(op.metadata) ? { metadata: op.metadata } : {}),
        ...(isPlainObject(op.runtime) ? { runtime: op.runtime } : {}),
        sourceRef: op.sourceRef || {},
      };
    }
    if (op.op !== 'select_supply') return null;
    return {
      kind: 'supply',
      endpointId: op.endpointId,
      nodeId: op.nodeId,
      ...(normalizeString(op.routeEndpointId) ? { routeEndpointId: normalizeString(op.routeEndpointId) } : {}),
      ...(normalizeString(op.terminalModel) ? { terminalModel: normalizeString(op.terminalModel) } : {}),
      targetSelectionPolicy: isPlainObject(op.targetSelectionPolicy) ? op.targetSelectionPolicy : { kind: 'inherit_default' },
      ...(isPlainObject(op.compatibilityPolicy) ? { compatibilityPolicy: op.compatibilityPolicy } : {}),
      ...(isPlainObject(op.metadata) ? { metadata: op.metadata } : {}),
      ...(isPlainObject(op.runtime) ? { runtime: op.runtime } : {}),
      sourceRef: op.sourceRef || {},
    };
  };

  const targetFromOp = (target, op) => {
    const normalized = isPlainObject(target) ? target : {};
    const sourceRef = isPlainObject(normalized.sourceRef) ? normalized.sourceRef : (op.sourceRef || {});
    return {
      ...normalized,
      endpointId: normalizeString(normalized.endpointId) || normalizeString(op.endpointId),
      nodeId: normalizeString(normalized.nodeId) || normalizeString(op.nodeId),
      enabled: normalized.enabled !== false,
      modelSource: normalized.modelSource === 'request' ? 'request' : 'fixed',
      sourceRef,
    };
  };

  const endpointFromTerminal = (terminal) => {
    if (!terminal || terminal.kind !== 'supply') return null;
    return {
      endpointId: terminal.endpointId,
      nodeId: terminal.nodeId,
      model: normalizeString(terminal.terminalModel) || null,
      ...(isPlainObject(terminal.compatibilityPolicy) ? { compatibilityPolicy: terminal.compatibilityPolicy } : {}),
      ...(isPlainObject(terminal.metadata) ? { metadata: terminal.metadata } : {}),
      ...(isPlainObject(terminal.runtime) ? { runtime: terminal.runtime } : {}),
    };
  };

  const terminalForExecutionAlternative = (terminal) => {
    if (!terminal) return terminal;
    if (terminal.kind === 'synthetic') {
      const { sourceRef: _sourceRef, ...runtimeTerminal } = terminal;
      return runtimeTerminal;
    }
    return {
      kind: 'supply',
      endpointId: terminal.endpointId,
    };
  };

  const executionAttemptForAlternative = (executionAttempt) => {
    const {
      endpointId: _endpointId,
      nodeId: _nodeId,
      sourceRef: _sourceRef,
      ...target
    } = executionAttempt;
    return target;
  };

  const terminalRef = (terminal) => {
    if (!terminal) return '';
    if (terminal.kind === 'synthetic') return normalizeString(terminal.nodeId);
    return normalizeString(terminal.routeEndpointId)
      || normalizeString(terminal.endpointId);
  };

  const stableAlternativeId = (kind, terminal, selectionTerms, fallbackStages, targetId = null) => {
    const terminalIdentity = terminalRef(terminal);
    if (!terminalIdentity) return '';
    return `${program.id}:alt:${stableHash({
      kind,
      terminalRef: terminalIdentity,
      targetId: normalizeString(targetId) || null,
      selectionPath: selectionTerms.map((term) => ({
        termId: term.termId,
        optionId: term.optionId,
      })),
      fallbackPath: fallbackStages.map((stage) => ({
        fallbackId: stage.fallbackId,
        stageId: stage.stageId,
      })),
    })}`;
  };

  const reserveAlternativeId = (alternativeId, terminal) => {
    if (!alternativeId) {
      addDiagnostic(diagnostics, 'error', 'compiled_router.alternative_identity_required', `Compiled router plan ${program.id} alternative must resolve to a stable terminal identity.`, program.entryNodeId);
      return false;
    }
    if (alternativeIds.has(alternativeId)) {
      addDiagnostic(diagnostics, 'error', 'compiled_router.duplicate_alternative_id', `Compiled router plan ${program.id} produced duplicate alternative id ${alternativeId}.`, terminal?.nodeId || program.entryNodeId);
      return false;
    }
    alternativeIds.add(alternativeId);
    return true;
  };

  const addSyntheticAlternative = (terminal, selectionTerms, fallbackStages, filterStageIndexes) => {
    const alternativeId = stableAlternativeId('synthetic_response', terminal, selectionTerms, fallbackStages);
    if (!reserveAlternativeId(alternativeId, terminal)) return null;
    const index = executionAlternatives.length;
    executionAlternatives.push({
      alternativeId,
      kind: 'synthetic_response',
      enabled: true,
      filterStageIndexes: [...filterStageIndexes],
      selectionTerms: selectionTerms.map((term) => ({ ...term })),
      fallbackStages: fallbackStages.map((stage) => ({ ...stage })),
      terminal: terminalForExecutionAlternative(terminal),
      endpoint: null,
      executionAttempt: null,
      syntheticResponse: {
        nodeId: terminal.nodeId,
        statusCode: terminal.statusCode === 429 ? 429 : 503,
        message: terminal.message || 'No route is available.',
      },
    });
    return index;
  };

  const addEndpointDelegationAlternative = (terminal, selectionTerms, fallbackStages, filterStageIndexes) => {
    const alternativeId = stableAlternativeId('endpoint_delegation', terminal, selectionTerms, fallbackStages);
    if (!reserveAlternativeId(alternativeId, terminal)) return null;
    const index = executionAlternatives.length;
    executionAlternatives.push({
      alternativeId,
      kind: 'endpoint_delegation',
      enabled: true,
      filterStageIndexes: [...filterStageIndexes],
      selectionTerms: selectionTerms.map((term) => ({ ...term })),
      fallbackStages: fallbackStages.map((stage) => ({ ...stage })),
      terminal: terminalForExecutionAlternative(terminal),
      endpoint: endpointFromTerminal(terminal),
      executionAttempt: null,
      syntheticResponse: null,
    });
    return index;
  };

  const addExecutionAttemptAlternative = (
    terminal,
    target,
    targetIndex,
    selectionTerms,
    fallbackStages,
    filterStageIndexes,
    controlOrder,
    includeTargetSelection,
  ) => {
    const policy = isPlainObject(terminal.targetSelectionPolicy) ? terminal.targetSelectionPolicy : { kind: 'inherit_default' };
    const executionAttempt = targetFromOp(target, {
      endpointId: terminal.endpointId,
      nodeId: terminal.nodeId,
      sourceRef: terminal.sourceRef,
    });
    const targetId = normalizeString(executionAttempt.targetId);
    if (!targetId) return null;
    executionAttempt.targetId = targetId;
    const targetTerm = includeTargetSelection
      ? {
          termId: `${terminal.endpointId}:execution_attempt`,
          nodeId: terminal.nodeId,
          mode: 'execution_attempt',
          policy,
          optionId: targetId,
          optionIndex: targetIndex,
          optionKind: 'execution_attempt',
          enabled: executionAttempt.enabled !== false,
          weight: Number.isFinite(Number(executionAttempt.weight)) ? Number(executionAttempt.weight) : 1,
          order: targetIndex,
          controlOrder,
        }
      : null;
    const terms = targetTerm
      ? [...selectionTerms.map((term) => ({ ...term })), targetTerm]
      : selectionTerms.map((term) => ({ ...term }));
    const alternativeId = stableAlternativeId('execution_attempt', terminal, terms, fallbackStages, targetId);
    if (!reserveAlternativeId(alternativeId, terminal)) return null;
    executionAttempt.executionAttemptId = alternativeId;
    const index = executionAlternatives.length;
    executionAlternatives.push({
      alternativeId,
      kind: 'execution_attempt',
      enabled: executionAttempt.enabled !== false,
      filterStageIndexes: [...filterStageIndexes],
      selectionTerms: terms,
      fallbackStages: fallbackStages.map((stage) => ({ ...stage })),
      terminal: terminalForExecutionAlternative(terminal),
      endpoint: endpointFromTerminal(terminal),
      executionAttempt: executionAttemptForAlternative(executionAttempt),
      syntheticResponse: null,
    });
    return index;
  };

  const visitOp = (opId, selectionTerms, fallbackStages, inheritedFilterStageIndexes, inheritedVisited, controlOrder = 0) => {
    let currentOpId = normalizeString(opId);
    const currentFilterStageIndexes = [...(Array.isArray(inheritedFilterStageIndexes) ? inheritedFilterStageIndexes : [])];
    const visited = new Set(inheritedVisited || []);
    while (currentOpId) {
      if (visited.has(currentOpId)) {
        addDiagnostic(diagnostics, 'error', 'compiled_router.cycle', `Compiled router plan ${program.id} contains a cycle at ${currentOpId}.`, program.entryNodeId);
        return null;
      }
      visited.add(currentOpId);
      const op = opsById.get(currentOpId);
      if (!op) {
        addDiagnostic(diagnostics, 'error', 'compiled_router.missing_op', `Compiled router plan ${program.id} references missing op ${currentOpId}.`, program.entryNodeId);
        return null;
      }

      if (op.op === 'filter') {
        const stageIndex = addFilterStage(op);
        if (stageIndex != null) currentFilterStageIndexes.push(stageIndex);
        currentOpId = normalizeString(op.nextOpId);
        continue;
      }

      if (op.op === 'call_product') {
        currentOpId = normalizeString(op.nextOpId);
        continue;
      }

      const terminal = terminalFromOp(op);
      if (terminal) {
        const before = executionAlternatives.length;
        if (terminal.kind === 'synthetic') {
          addSyntheticAlternative(terminal, selectionTerms, fallbackStages, currentFilterStageIndexes);
        } else if (isPlainObject(terminal.targetSelectionPolicy) && terminal.targetSelectionPolicy.kind === 'defer_to_router') {
          addEndpointDelegationAlternative(terminal, selectionTerms, fallbackStages, currentFilterStageIndexes);
        } else {
          const targets = Array.isArray(op.targets) ? op.targets : [];
          const includeTargetSelection = !(targets.length === 1 && canElideSingleCompiledSelection(terminal.targetSelectionPolicy));
          for (const [targetIndex, target] of targets.entries()) {
            addExecutionAttemptAlternative(
              terminal,
              target,
              targetIndex,
              selectionTerms,
              fallbackStages,
              currentFilterStageIndexes,
              controlOrder,
              includeTargetSelection,
            );
          }
        }
        return executionAlternatives.length > before ? executionAlternatives.slice(before).map((_, offset) => before + offset) : [];
      }

      if (op.op === 'fallback') {
        const fallbackId = normalizeString(op.id);
        if (!fallbackId) {
          addDiagnostic(diagnostics, 'error', 'compiled_router.fallback_identity_required', `Compiled router plan ${program.id} fallback operation must declare a stable identity.`, program.entryNodeId);
          return null;
        }
        const stages = Array.isArray(op.stages) ? op.stages : [];
        if (stages.length === 1) {
          const stage = stages[0];
          const stageId = normalizeString(stage?.stageId);
          const targetOpId = normalizeString(stage?.targetOpId);
          if (!stageId || !targetOpId) {
            addDiagnostic(diagnostics, 'error', 'compiled_router.fallback_stage_invalid', `Compiled router plan ${program.id} fallback ${fallbackId} has an invalid stage.`, op.nodeId || program.entryNodeId);
            return null;
          }
          return visitOp(
            targetOpId,
            selectionTerms,
            fallbackStages,
            currentFilterStageIndexes,
            new Set(visited),
            controlOrder,
          );
        }
        const allIndexes = [];
        for (const [stageIndex, stage] of stages.entries()) {
          const stageId = normalizeString(stage?.stageId);
          const targetOpId = normalizeString(stage?.targetOpId);
          if (!stageId || !targetOpId) {
            addDiagnostic(diagnostics, 'error', 'compiled_router.fallback_stage_invalid', `Compiled router plan ${program.id} fallback ${fallbackId} has an invalid stage.`, op.nodeId || program.entryNodeId);
            return null;
          }
          const nextFallbackStages = [...fallbackStages, {
            fallbackId,
            stageId,
            stageIndex,
            nodeId: normalizeString(stage?.nodeId) || normalizeString(op.nodeId),
            controlOrder,
            ...(isPlainObject(stage?.sourceRef) ? { sourceRef: stage.sourceRef } : {}),
          }];
          const terminalCandidateIndexes = visitOp(
            targetOpId,
            selectionTerms,
            nextFallbackStages,
            currentFilterStageIndexes,
            new Set(visited),
            controlOrder + 1,
          );
          if (!terminalCandidateIndexes) return null;
          allIndexes.push(...terminalCandidateIndexes);
        }
        return allIndexes;
      }

      if (op.op !== 'dispatch') {
        addDiagnostic(diagnostics, 'error', 'compiled_router.unsupported_op', `Compiled router plan ${program.id} cannot compile op ${currentOpId}.`, program.entryNodeId);
        return null;
      }
      const dispatch = op;
      const selectorId = normalizeString(dispatch.id);
      if (!selectorId) {
        addDiagnostic(diagnostics, 'error', 'compiled_router.selector_identity_required', `Compiled router plan ${program.id} dispatch operation must declare a stable selector id.`, dispatch.nodeId || program.entryNodeId);
        return null;
      }
      const mode = normalizeString(dispatch.mode) || 'route';
      const policy = isPlainObject(dispatch.policy) ? dispatch.policy : { kind: 'inherit_default' };
      const dispatchCandidates = Array.isArray(dispatch.candidates) ? dispatch.candidates : [];
      if (dispatchCandidates.length === 1 && canElideSingleCompiledSelection(policy)) {
        const candidate = dispatchCandidates[0];
        const candidateId = normalizeString(candidate?.id);
        if (!candidateId) {
          addDiagnostic(diagnostics, 'error', 'compiled_router.candidate_identity_required', `Compiled router plan ${program.id} dispatch candidate must declare a stable candidate id.`, dispatch.nodeId || program.entryNodeId);
          return null;
        }
        if (candidate.enabled === false) return [];
        return visitOp(
          candidate.targetOpId,
          selectionTerms,
          fallbackStages,
          currentFilterStageIndexes,
          new Set(visited),
          controlOrder,
        );
      }
      const allIndexes = [];
      for (const [index, candidate] of dispatchCandidates.entries()) {
        const groupId = normalizeString(candidate.id);
        if (!groupId) {
          addDiagnostic(diagnostics, 'error', 'compiled_router.candidate_identity_required', `Compiled router plan ${program.id} dispatch candidate must declare a stable candidate id.`, dispatch.nodeId || program.entryNodeId);
          return null;
        }
        const nextSelectionTerms = [
          ...selectionTerms,
          {
            termId: selectorId,
            nodeId: normalizeString(dispatch.nodeId),
            mode,
            policy,
            optionId: groupId,
            optionIndex: index,
            optionKind: normalizeString(candidate.kind) || (mode === 'flow' ? 'bidirect' : 'route'),
            enabled: candidate.enabled !== false,
            weight: Number.isFinite(Number(candidate.weight)) ? Number(candidate.weight) : 1,
            order: Number.isFinite(Number(candidate.order)) ? Number(candidate.order) : index,
            controlOrder,
          ...(isPlainObject(candidate.metadata) ? { metadata: candidate.metadata } : {}),
          ...(candidate.failureBackoff ? { failureBackoff: candidate.failureBackoff } : {}),
          },
        ];
        const terminalCandidateIndexes = visitOp(
          candidate.targetOpId,
          nextSelectionTerms,
          fallbackStages,
          currentFilterStageIndexes,
          new Set(visited),
          controlOrder + 1,
        );
        if (!terminalCandidateIndexes) return null;
        allIndexes.push(...terminalCandidateIndexes);
      }
      return allIndexes;
    }
    addDiagnostic(diagnostics, 'error', 'compiled_router.empty_path', `Compiled router plan ${program.id} has an empty execution path.`, program.entryNodeId);
    return null;
  };

  const indexes = visitOp(program.startOpId, [], [], [], new Set());
  if (!indexes || indexes.length === 0 || executionAlternatives.length === 0) return null;
  return {
    id: program.id,
    entryNodeId: program.entryNodeId,
    publicModelName: program.publicModelName,
    enabled: program.enabled !== false,
    ...(isPlainObject(program.metadata) ? { metadata: program.metadata } : {}),
    filterStages,
    executionAlternatives,
  };
}

function buildCompiledRouterBundle(planSource) {
  const diagnostics = [];
  const plans = [];
  const planHashes = [];
  const planIndex = Object.create(null);
  for (const program of Array.isArray(planSource?.programs) ? planSource.programs : []) {
    const plan = buildCompiledRouterPlanFromRouteProgram(program, diagnostics);
    // Program ops are compiler-only input. Release each completed program before
    // building the next plan so large publishes do not retain both forms.
    program.ops = [];
    program.startOpId = null;
    if (!plan) continue;
    if (Object.prototype.hasOwnProperty.call(planIndex, plan.id)) {
      addDiagnostic(
        diagnostics,
        'error',
        'compiled_router.duplicate_plan_id',
        `Compiled router program ${plan.id} is declared more than once.`,
        plan.entryNodeId,
      );
      continue;
    }
    planIndex[plan.id] = plans.length;
    planHashes.push(stableHash(plan));
    plans.push(plan);
  }
  const planIds = new Set(Object.keys(planIndex));
  const matcher = buildCompiledRouterMatcher(planSource?.matcher, planIds);
  const metadata = isPlainObject(planSource?.metadata) ? planSource.metadata : {};
  const bundleWithoutHash = {
    matcher,
    plans,
    planIndex,
    diagnostics,
    metadata,
  };
  return {
    ...bundleWithoutHash,
    // The bundle hash represents the logical plans, not their storage shape.
    // A runtime compiler can therefore emit packed plans without changing the
    // identity of the same compiled route program.
    hash: stableHash({
      matcher,
      planIndex,
      diagnostics,
      metadata,
      planHashes,
    }),
  };
}

function deriveEntryBackendSpec(entryNodeId, nodesById, outgoingByNodeId, incomingByNodeId) {
  const targets = (outgoingByNodeId.get(entryNodeId) || [])
    .filter((edge) => edge.sourcePortId === 'bidirect.out')
    .map((edge) => edge.targetNodeId);
  const endpointIds = [];
  for (const target of targets) {
    const targetNode = nodesById.get(target);
    if (targetNode?.type === 'dispatcher' && targetNode.mode === 'route') {
      const candidateEdges = (incomingByNodeId.get(targetNode.id) || [])
        .filter((edge) => edge.targetPortId === 'route.in');
      for (const edge of candidateEdges) {
        const candidateNode = nodesById.get(edge.sourceNodeId);
        endpointIds.push(...endpointIdsFromRouteGraphCandidateNode(candidateNode));
      }
    }
  }
  if (endpointIds.length > 0) {
    return normalizeRouteGraphBackendSpec({
      kind: ROUTE_GRAPH_BACKEND_KIND_ROUTE_ENDPOINTS,
      endpointIds: Array.from(new Set(endpointIds)),
    });
  }
  return normalizeRouteGraphBackendSpec({ kind: ROUTE_GRAPH_BACKEND_KIND_SUPPLY });
}

function macroProvenance(macro, role, details = {}) {
  const metadata = isPlainObject(macro?.metadata) ? macro.metadata : {};
  const metadataProvenance = isPlainObject(metadata.provenance) ? metadata.provenance : {};
  return {
    source: 'macro',
    macroId: macro.id,
    macroKind: macro.kind,
    role,
    ...(normalizeString(metadataProvenance.binding) ? { binding: normalizeString(metadataProvenance.binding) } : {}),
    ...(isPlainObject(details) ? details : {}),
  };
}

function macroSafeId(value) {
  return routeMacroIdentitySafePart(value);
}

function macroSemanticNodeId(macro) {
  return createRouteMacroSemanticNodeId(macro?.id);
}

function macroSemanticNodeAliases(macro) {
  const aliases = new Set([macroSemanticNodeId(macro)]);
  const rawId = normalizeString(macro?.id);
  if (rawId) aliases.add(rawId);
  return Array.from(aliases);
}

function findExecutableEndpointForSupplyEndpoint(routeEndpoint) {
  if (!routeEndpoint || routeEndpoint.type !== 'route_endpoint' || routeEndpoint.endpointKind !== 'supply') return null;
  if (Array.isArray(routeEndpoint.config?.targets) && routeEndpoint.config.targets.length > 0) return routeEndpoint;
  return null;
}

function macroCandidateMember(group, routeEndpointId) {
  const referenceId = normalizeString(routeEndpointId);
  if (!referenceId) return {};
  return (Array.isArray(group?.members) ? group.members : [])
    .find((member) => normalizeString(member?.endpointId || member?.macroId) === referenceId) || {};
}

function macroCandidateWeight(group, member, fallback = 1) {
  if (Number.isFinite(Number(member?.weight))) return Number(member.weight);
  return Number.isFinite(Number(group.defaults?.weight)) ? Number(group.defaults.weight) : fallback;
}

function mergeCandidateMemberMetadata(group, candidateMetadata, member) {
  const stageMember = isPlainObject(member) ? member : {};
  const failureBackoff = normalizeRouteFailureBackoffOverride(
    stageMember.failureBackoff || group?.failureBackoff || group?.defaults?.failureBackoff,
  );
  const merged = {
    ...candidateMetadata,
    ...(Number.isFinite(Number(stageMember.weight)) ? { weight: Number(stageMember.weight) } : {}),
    ...(stageMember.enabled === true || stageMember.enabled === false ? { enabled: stageMember.enabled } : {}),
    ...(isPlainObject(stageMember.metadata) ? { metadata: stageMember.metadata } : {}),
    ...(failureBackoff ? { failureBackoff } : {}),
  };
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
  if (sort === 'model_name') {
    candidates.sort((left, right) => String(left.model || '').localeCompare(String(right.model || '')));
  }

  const limit = normalizePositiveInteger(group.materialization?.limit);
  return limit ? candidates.slice(0, limit) : candidates;
}

function routeEndpointPatternNames(entriesByNodeId, endpoint) {
  const values = [];
  const push = (value) => {
    const normalized = normalizeString(value);
    if (normalized && !values.includes(normalized)) values.push(normalized);
  };
  const entry = entriesByNodeId.get(normalizeString(endpoint?.routeEndpointId));
  if (entry?.match) {
    push(entry.match.displayName);
    push(entry.match.requestedModelPattern);
    push(entry.match.currentModelPattern);
  }
  if (endpoint?.name) push(endpoint.name);
  const metadata = isPlainObject(endpoint?.metadata) ? endpoint.metadata : {};
  push(metadata.upstreamModel);
  push(metadata.normalizedModel);
  const endpointIdentity = isPlainObject(metadata.endpointIdentity) ? metadata.endpointIdentity : {};
  push(endpointIdentity.model);
  const targets = Array.isArray(endpoint?.config?.targets) ? endpoint.config.targets : [];
  for (const target of targets) {
    push(target?.model);
    push(target?.sourceModel);
  }
  return values;
}

function patternCandidateItemsForGroup(sourceNodeIndexes, group) {
  const pattern = normalizeString(group.input?.pattern);
  if (!pattern) return [];
  return sourceNodeIndexes.supplyEndpoints
    .filter((endpoint) => endpoint.enabled !== false)
    .flatMap((endpoint) => {
      const endpointId = normalizeString(endpoint.routeEndpointId);
      if (!endpointId) return [];
      const models = routeEndpointPatternNames(sourceNodeIndexes.entriesByNodeId, endpoint);
      const matchedModel = models.find((model) => matchesModelPattern(model, pattern));
      if (!matchedModel) return [];
      return [{
        endpoint,
        endpointId,
        model: matchedModel,
      }];
    });
}

function cloneEndpointForMacroPatternCandidate(item, macro, group) {
  return normalizeRouteGraphNode({
    ...item.endpoint,
    id: createRouteMacroCandidateEndpointNodeId(macro.id, group.id, item.endpointId),
    name: item.endpoint.name || item.model || `${macro.id} pattern candidate`,
    enabled: item.endpoint.enabled !== false && group.enabled !== false,
    ownership: 'derived',
    provenance: macroProvenance(macro, 'pattern_endpoint'),
    metadata: {
      ...(isPlainObject(item.endpoint.metadata) ? item.endpoint.metadata : {}),
    },
    config: {
      ...(isPlainObject(item.endpoint.config) ? item.endpoint.config : {}),
    },
  });
}

function addMacroCandidateEdge(edges, macro, macroId, stage, candidateId, dispatcherId, candidateMetadata, output = 'route') {
  const group = stage.group;
  const isBidirect = output === 'bidirect';
  edges.push(normalizeRouteGraphEdge({
    id: createRouteMacroCandidateEdgeId(macroId, group.id, candidateId),
    sourceNodeId: isBidirect ? dispatcherId : candidateId,
    sourcePortId: isBidirect ? 'bidirect[1...].out' : 'route.out',
    targetNodeId: isBidirect ? candidateId : dispatcherId,
    targetPortId: isBidirect ? 'bidirect.in' : 'route.in',
    kind: isBidirect ? 'bidirect_flow' : 'route_flow',
    ownership: 'derived',
    metadata: {
      provenance: macroProvenance(macro, 'candidate_edge', {
        fallbackStage: {
          id: group.id,
          index: stage.stageIndex,
        },
      }),
      candidate: {
        enabled: group.defaults?.enabled !== false,
        weight: macroCandidateWeight(group, null),
        ...candidateMetadata,
      },
    },
  }));
}

function routeEndpointHasExecutableTargets(node) {
  if (!node || node.type !== 'route_endpoint' || node.endpointKind !== 'supply') return true;
  const targets = Array.isArray(node.config?.targets) ? node.config.targets : [];
  return targets.some((target) => normalizeString(target?.targetId) && (normalizeString(target?.model) || target?.modelSource === 'request'));
}

function routeGraphEdgeConnectionKey(edge) {
  return [
    edge?.sourceNodeId || '',
    edge?.sourcePortId || '',
    edge?.targetNodeId || '',
    edge?.targetPortId || '',
  ].join('\u0000');
}

function lowerCandidateSelectorMacro(macro, sourceNodeIndexes, sourceMacrosById) {
  const diagnostics = [];
  const nodes = [];
  const edges = [];
  const candidateNodeIds = new Set();
  const configuredCandidateNodeIds = new Set();
  const config = normalizeCandidateSelectorConfig(macro.config);
  const filterOperations = Array.isArray(config.filters?.operations) ? config.filters.operations : [];
  const macroId = macroSafeId(macro.id);
  const semanticNodeId = macroSemanticNodeId(macro);
  if (macro.enabled === false) {
    return {
      macro,
      nodes,
      edges,
      diagnostics,
      semanticNodeId,
      entryId: null,
      entryTargetId: null,
      dispatcherId: null,
      candidateInputDispatcherId: null,
      candidateNodeIds: [],
      configuredCandidateNodeIds: [],
    };
  }

  const entryId = config.surface.entry.kind === 'external' ? createRouteMacroEntryNodeId(macroId) : null;
  const filterId = filterOperations.length > 0 ? createRouteMacroFilterNodeId(macroId) : null;
  const dispatcherMode = config.surface.output === 'bidirect' ? 'flow' : 'route';
  const configuredStages = config.groups.filter((group) => group.enabled !== false);
  const candidateSourceMatches = config.candidateSource?.kind === 'model_pattern'
    ? patternCandidateItemsForGroup(sourceNodeIndexes, { input: config.candidateSource })
    : [];
  const assignedCandidateSourceEndpointIds = new Set(
    configuredStages.flatMap((group) =>
      (group.members || []).map((member) => normalizeString(member.endpointId)).filter(Boolean),
    ),
  );
  const candidateSourceEndpointsByStageId = new Map();
  if (config.candidateSource?.kind === 'model_pattern') {
    for (const group of configuredStages) {
      const assignedEndpointIds = new Set(
        (group.members || []).map((member) => normalizeString(member.endpointId)).filter(Boolean),
      );
      candidateSourceEndpointsByStageId.set(
        group.id,
        candidateSourceMatches.filter((item) => {
          const endpointId = normalizeString(item.endpointId);
          return assignedEndpointIds.has(endpointId)
            || (group.acceptUnassigned === true && !assignedCandidateSourceEndpointIds.has(endpointId));
        }),
      );
    }
  }
  const hasMaterializedCandidateSourceStage = Array.from(candidateSourceEndpointsByStageId.values())
    .some((items) => items.length > 0);
  const candidateSourceManagedStages = configuredStages.filter((group) => (
    group.acceptUnassigned === true
    || (group.members || []).some((member) => normalizeString(member.endpointId))
  ));
  const unavailableCandidateSourceStageId = candidateSourceManagedStages.find(
    (group) => group.acceptUnassigned === true,
  )?.id || candidateSourceManagedStages[0]?.id;
  const materializedConfiguredStages = config.candidateSource?.kind === 'model_pattern'
    ? configuredStages.filter((group) => {
        const sourceManaged = candidateSourceManagedStages.includes(group);
        if (!sourceManaged) return true;
        const materialized = (candidateSourceEndpointsByStageId.get(group.id) || []).length > 0;
        return materialized
          || (!hasMaterializedCandidateSourceStage && group.id === unavailableCandidateSourceStageId);
      })
    : configuredStages;
  const fallbackStages = materializedConfiguredStages.length > 0
    ? materializedConfiguredStages
    : [normalizeCandidateSelectorGroup({
      id: createRouteMacroFallbackStageId('default'),
      label: 'Default',
      enabled: true,
      input: { kind: 'route_endpoints', endpointIds: [] },
    }, 0)];
  const stageDescriptors = fallbackStages.map((group, stageIndex) => ({
    group,
    stageIndex,
    dispatcherId: stageIndex === 0
      ? createRouteMacroDispatcherNodeId(macroId)
      : createRouteMacroFallbackStageDispatcherNodeId(macroId, group.id),
  }));
  const candidateInputDispatcherId = stageDescriptors[0]?.dispatcherId || null;
  const entryTargetId = filterId || candidateInputDispatcherId;
  if (entryId) {
    const macroMetadata = isPlainObject(macro.metadata) ? macro.metadata : {};
    const macroMetadataProvenance = isPlainObject(macroMetadata.provenance) ? macroMetadata.provenance : {};
    nodes.push(normalizeRouteGraphNode({
      id: entryId,
      type: 'entry',
      name: macro.name || config.surface.entry.match.displayName || config.surface.entry.match.requestedModelPattern || macro.id,
      enabled: macro.enabled !== false,
      ownership: 'derived',
      match: config.surface.entry.match,
      metadata: {
        ...(normalizeString(macroMetadataProvenance.binding) ? { macroBinding: normalizeString(macroMetadataProvenance.binding) } : {}),
      },
      provenance: macroProvenance(macro, 'entry'),
    }));
  }
  if (filterId) {
    nodes.push(normalizeRouteGraphNode({
      id: filterId,
      type: 'filter',
      name: `${macro.name || macro.id} filter`,
      enabled: macro.enabled !== false,
      ownership: 'derived',
      operations: filterOperations,
      provenance: macroProvenance(macro, 'filter'),
    }));
  }
  for (const stage of stageDescriptors) {
    nodes.push(normalizeRouteGraphNode({
      id: stage.dispatcherId,
      type: 'dispatcher',
      name: `${macro.name || macro.id} ${stage.group.label || `stage ${stage.stageIndex + 1}`}`,
      enabled: macro.enabled !== false && stage.group.enabled !== false,
      ownership: 'derived',
      mode: dispatcherMode,
      ordering: 'explicit',
      policy: stage.group.policy || config.policy,
      provenance: macroProvenance(macro, 'fallback_stage_dispatcher', {
        fallbackStage: {
          id: stage.group.id,
          index: stage.stageIndex,
        },
      }),
    }));
  }
  {
    for (const [index, stage] of stageDescriptors.entries()) {
      const nextStage = stageDescriptors[index + 1];
      if (!nextStage) continue;
      edges.push(normalizeRouteGraphEdge({
        id: createRouteMacroInternalEdgeId(macroId, `fallback-${stage.group.id}-to-${nextStage.group.id}`),
        sourceNodeId: stage.dispatcherId,
        sourcePortId: 'fallback.out',
        targetNodeId: nextStage.dispatcherId,
        targetPortId: 'bidirect.in',
        kind: 'bidirect_flow',
        ownership: 'derived',
        metadata: {
          provenance: macroProvenance(macro, 'fallback_stage_edge', {
            fallbackStage: { id: nextStage.group.id, index: nextStage.stageIndex },
          }),
        },
      }));
    }
  }
  if (entryId && filterId) {
    edges.push(normalizeRouteGraphEdge({
      id: createRouteMacroInternalEdgeId(macroId, 'entry-filter'),
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
      id: createRouteMacroInternalEdgeId(macroId, 'filter-dispatcher'),
      sourceNodeId: filterId,
      sourcePortId: 'bidirect.out',
      targetNodeId: candidateInputDispatcherId,
      targetPortId: 'bidirect.in',
      kind: 'bidirect_flow',
      ownership: 'derived',
      metadata: { provenance: macroProvenance(macro, 'filter_dispatcher_edge') },
    }));
  } else if (entryId) {
    edges.push(normalizeRouteGraphEdge({
      id: createRouteMacroInternalEdgeId(macroId, 'entry-dispatcher'),
      sourceNodeId: entryId,
      sourcePortId: 'bidirect.out',
      targetNodeId: candidateInputDispatcherId,
      targetPortId: 'bidirect.in',
      kind: 'bidirect_flow',
      ownership: 'derived',
      metadata: { provenance: macroProvenance(macro, 'entry_dispatcher_edge') },
    }));
  }

  for (const stage of stageDescriptors) {
    const { group } = stage;
    const candidateSourceEndpoints = candidateSourceEndpointsByStageId.get(group.id) || [];
    const candidateSourceAppliesToStage = config.candidateSource?.kind === 'model_pattern'
      && candidateSourceEndpoints.length > 0;
    if (candidateSourceAppliesToStage) {
      const sourceGroup = { ...group, input: config.candidateSource };
      const materializedEndpoints = materializeCandidateItems(
        sourceGroup,
        candidateSourceEndpoints,
        (item, dedupeBy) => {
          if (dedupeBy === 'endpoint_id') return String(item.endpointId || '');
          if (dedupeBy === 'model') return String(item.model || '');
          return '';
        },
      );
      for (const item of materializedEndpoints) {
        const candidate = cloneEndpointForMacroPatternCandidate(item, macro, group);
        const member = macroCandidateMember(group, item.endpointId);
        nodes.push(candidate);
        candidateNodeIds.add(candidate.id);
        configuredCandidateNodeIds.add(candidate.id);
        addMacroCandidateEdge(edges, macro, macroId, stage, candidate.id, stage.dispatcherId,
          mergeCandidateMemberMetadata(group, {
            routeEndpointId: item.endpointId,
            pattern: config.candidateSource.pattern,
            matchedModel: item.model,
          }, member), config.surface.output);
      }
      continue;
    }
    if (group.input.kind === 'route_endpoints') {
      const materializedRouteEndpoints = materializeCandidateItems(
        group,
        group.input.endpointIds.map((endpointId) => ({ endpointId })),
        (item, dedupeBy) => {
          if (dedupeBy === 'endpoint_id') return String(item.endpointId || '');
          return '';
        },
      );
      for (const item of materializedRouteEndpoints) {
        const routeEndpoint = sourceNodeIndexes.routeEndpointsById.get(normalizeString(item.endpointId));
        if (!routeEndpoint) {
          addDiagnostic(diagnostics, 'error', 'macro.candidate_route_endpoint_missing', `candidate_selector ${macro.id} references route endpoint ${item.endpointId}, but it does not exist.`);
          continue;
        }
        const member = macroCandidateMember(group, item.endpointId);
        if (routeEndpoint.endpointKind === 'supply' && findExecutableEndpointForSupplyEndpoint(routeEndpoint)) {
          candidateNodeIds.add(routeEndpoint.id);
          configuredCandidateNodeIds.add(routeEndpoint.id);
          addMacroCandidateEdge(edges, macro, macroId, stage, routeEndpoint.id, stage.dispatcherId, {
            ...mergeCandidateMemberMetadata(group, {
              routeEndpointId: item.endpointId,
              endpointKind: 'supply',
            }, member),
          }, config.surface.output);
          continue;
        }
        if (!findExecutableEndpointForSupplyEndpoint(routeEndpoint)) {
          addDiagnostic(diagnostics, 'error', 'macro.candidate_route_endpoint_unresolved', `candidate_selector ${macro.id} references route endpoint ${item.endpointId}, but no executable endpoint exists for it.`);
          continue;
        }
      }
      continue;
    }
    if (group.input.kind === 'graph_references') {
      const materializedEndpointIds = materializeCandidateItems(
        group,
        group.input.endpointIds.map((endpointId) => ({ endpointId })),
        (item, dedupeBy) => dedupeBy === 'endpoint_id' ? String(item.endpointId || '') : '',
      );
      for (const item of materializedEndpointIds) {
        const routeEndpoint = sourceNodeIndexes.routeEndpointsById.get(normalizeString(item.endpointId));
        if (!routeEndpoint || !findExecutableEndpointForSupplyEndpoint(routeEndpoint)) {
          addDiagnostic(diagnostics, 'error', 'macro.graph_reference_endpoint_unresolved', `candidate_selector ${macro.id} references executable endpoint ${item.endpointId}, but it does not exist or is not executable.`);
          continue;
        }
        const member = macroCandidateMember(group, item.endpointId);
        candidateNodeIds.add(routeEndpoint.id);
        configuredCandidateNodeIds.add(routeEndpoint.id);
        addMacroCandidateEdge(edges, macro, macroId, stage, routeEndpoint.id, stage.dispatcherId, {
          ...mergeCandidateMemberMetadata(group, { routeEndpointId: item.endpointId, endpointKind: 'supply' }, member),
        }, config.surface.output);
      }
      for (const childMacroId of group.input.macroIds) {
        const childMacro = sourceMacrosById.get(childMacroId);
        if (!childMacro || childMacro.kind !== 'candidate_selector' || childMacro.enabled === false) {
          addDiagnostic(diagnostics, 'error', 'macro.graph_reference_macro_unresolved', `candidate_selector ${macro.id} references macro ${childMacroId}, but it does not exist or is disabled.`);
          continue;
        }
        const childDispatcherId = createRouteMacroDispatcherNodeId(childMacroId);
        const member = macroCandidateMember(group, childMacroId);
        configuredCandidateNodeIds.add(childDispatcherId);
        addMacroCandidateEdge(edges, macro, macroId, stage, childDispatcherId, stage.dispatcherId, {
          macroId: childMacroId,
          referenceKind: 'macro',
          ...(Number.isFinite(Number(member.weight)) ? { weight: Number(member.weight) } : {}),
          ...(member.enabled === false ? { enabled: false } : {}),
          ...(isPlainObject(member.metadata) ? { metadata: member.metadata } : {}),
        }, config.surface.output);
      }
      continue;
    }
    if (group.input.kind === 'model_pattern') {
      const materializedEndpoints = materializeCandidateItems(
        group,
        patternCandidateItemsForGroup(sourceNodeIndexes, group),
        (item, dedupeBy) => {
          if (dedupeBy === 'endpoint_id') return String(item.endpointId || '');
          if (dedupeBy === 'model') return String(item.model || '');
          return '';
        },
      );
      for (const item of materializedEndpoints) {
        const candidate = cloneEndpointForMacroPatternCandidate(item, macro, group);
        const member = macroCandidateMember(group, item.endpointId);
        nodes.push(candidate);
        candidateNodeIds.add(candidate.id);
        addMacroCandidateEdge(edges, macro, macroId, stage, candidate.id, stage.dispatcherId,
          mergeCandidateMemberMetadata(group, {
            routeEndpointId: item.endpointId,
            pattern: group.input.pattern,
            matchedModel: item.model,
          }, member), config.surface.output);
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
      const candidateId = createRouteMacroInlineCandidateNodeId(macroId, group.id);
      candidateNodeIds.add(candidateId);
      nodes.push(normalizeRouteGraphNode({
        id: candidateId,
        type: 'route_endpoint',
        name: group.label || `${macro.id} inline endpoints`,
        enabled: group.defaults?.enabled !== false,
        endpointKind: 'supply',
        exposure: 'none',
        resolutionStatus: 'resolved',
        ownerKind: 'macro',
        sourceKind: 'inline',
        routeEndpointId: candidateId,
        ownership: 'derived',
        provenance: macroProvenance(macro, 'inline_endpoint'),
        metadata: {
          ...(isPlainObject(group.defaults?.metadata) ? group.defaults.metadata : {}),
        },
        config: {
          targets: materializedTargets,
          targetSelection: { kind: 'defer_to_router' },
        },
      }));
      addMacroCandidateEdge(edges, macro, macroId, stage, candidateId, stage.dispatcherId, { inline: true }, config.surface.output);
      continue;
    }
    if (group.input.kind === 'synthetic') {
      const candidateId = createRouteMacroSyntheticCandidateNodeId(macroId, group.id);
      candidateNodeIds.add(candidateId);
      nodes.push(normalizeRouteGraphNode({
        id: candidateId,
        type: 'synthetic_endpoint',
        name: group.label || `${macro.id} synthetic`,
        enabled: group.defaults?.enabled !== false,
        ownership: 'derived',
        statusCode: group.input.statusCode,
        message: group.input.message,
        provenance: macroProvenance(macro, 'synthetic_endpoint'),
      }));
      addMacroCandidateEdge(edges, macro, macroId, stage, candidateId, stage.dispatcherId, { synthetic: true }, config.surface.output);
      continue;
    }
    addDiagnostic(diagnostics, 'error', 'macro.resolver_unsupported', `candidate_selector ${macro.id} input ${group.input.kind} is not implemented yet.`);
  }
  return {
    macro,
    nodes,
    edges,
    diagnostics,
    semanticNodeId,
    entryId,
    entryTargetId,
    dispatcherId: candidateInputDispatcherId,
    candidateInputDispatcherId,
    stageDescriptors,
    candidateNodeIds: Array.from(candidateNodeIds),
    configuredCandidateNodeIds: Array.from(configuredCandidateNodeIds),
  };
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
  const sourceNodeIndexes = buildRouteGraphSourceNodeIndexes(source.nodes);
  const sourceMacrosById = new Map((source.macros || []).map((macro) => [macro.id, macro]));
  const diagnostics = [];
  const derivedNodes = [];
  const derivedEdges = [];
  const macroLoweringsBySemanticId = new Map();
  for (const macro of source.macros || []) {
    if (macro.kind === 'candidate_selector') {
      const lowered = lowerCandidateSelectorMacro(macro, sourceNodeIndexes, sourceMacrosById);
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
            id: createRouteMacroSemanticCandidateEdgeId(edge.id, candidateNodeId),
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
      if (targetSurfacePort?.direction === 'input' && targetSurfacePort.kind === 'route' && edge.targetPortId === 'candidates.in' && targetMacro.candidateInputDispatcherId) {
        if (targetMacro.configuredCandidateNodeIds.includes(edge.sourceNodeId)) continue;
        const routeEndpoint = sourceNodeIndexes.routeEndpointsByNodeId.get(normalizeString(edge.sourceNodeId));
        const edgeMetadata = isPlainObject(edge.metadata) ? edge.metadata : {};
        const candidateMetadata = isPlainObject(edgeMetadata.candidate) ? edgeMetadata.candidate : {};
        const fallbackStage = targetMacro.stageDescriptors?.[0] || null;
        semanticEdges.push(normalizeRouteGraphEdge({
          ...edge,
          id: `macro-semantic:${edge.id}:candidate-in`,
          targetNodeId: targetMacro.candidateInputDispatcherId,
          targetPortId: 'route.in',
          ownership: 'derived',
          metadata: {
            ...edgeMetadata,
            candidate: routeEndpoint
              ? mergeCandidateMemberMetadata(
                { id: 'semantic', defaults: candidateMetadata },
                {
                  ...candidateMetadata,
                  routeEndpointId: routeEndpoint.routeEndpointId,
                  endpointKind: routeEndpoint.endpointKind,
                },
                {},
              )
              : candidateMetadata,
            provenance: {
              source: 'macro_semantic_edge',
              semanticEdgeId: edge.id,
              macroId: targetMacro.macro.id,
              role: 'candidate_edge',
              ...(fallbackStage ? {
                fallbackStage: {
                  id: fallbackStage.group.id,
                  index: fallbackStage.stageIndex,
                },
              } : {}),
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
    primitiveSource: {
      ...source,
      nodes: [...source.nodes, ...derivedNodes],
      edges: [...primitiveEdges, ...dedupedDerivedEdges, ...semanticEdges],
      macros: source.macros,
    },
    diagnostics,
  };
}

function compilePrimitiveRouteGraph(sourceInput, preDiagnostics = []) {
  const source = sourceInput;
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
  const edgeIndexes = buildRouteGraphEdgeIndexes(nodesById, source.edges);
  const activeEdges = edgeIndexes.activeEdges;
  const traversalAdjacency = buildTraversalAdjacency(nodesById, activeEdges);
  const reachabilityAdjacency = buildReachabilityAdjacency(nodesById, activeEdges);

  for (const node of source.nodes) {
    if (node.type === 'route_endpoint' && node.endpointKind === 'supply' && node.enabled !== false) {
      for (const target of Array.isArray(node.config?.targets) ? node.config.targets : []) {
        if (!normalizeString(target?.targetId)) {
          addDiagnostic(
            diagnostics,
            'error',
            'route_endpoint.target_id_required',
            `Route endpoint ${node.id} executable target must declare a stable target id.`,
            node.id,
          );
        }
      }
      if (!routeEndpointHasExecutableTargets(node)) {
        addDiagnostic(diagnostics, 'warning', 'route_endpoint.targets_required', `Route endpoint ${node.id} has no executable target yet.`, node.id);
      }
    }
    if (node.type === 'dispatcher' && node.mode === 'route' && node.enabled !== false) {
      const candidateEdges = routeProgramIncoming(edgeIndexes.incomingByPort, node.id, 'route.in');
      if (candidateEdges.length === 0) {
        addDiagnostic(diagnostics, 'error', 'dispatcher.route_candidates_required', `Route dispatcher ${node.id} must have at least one route candidate.`, node.id);
      }
    }
    if (node.type === 'dispatcher' && node.mode === 'flow' && node.enabled !== false) {
      const outputEdges = routeProgramOutgoing(edgeIndexes.outgoingByPort, node.id, 'bidirect[1...].out');
      if (outputEdges.length === 0) {
        addDiagnostic(diagnostics, 'error', 'dispatcher.flow_outputs_required', `Flow dispatcher ${node.id} must expose at least one bidirect output.`, node.id);
      }
    }
    if (node.type === 'filter' && node.enabled !== false) {
      const inputEdges = edgeIndexes.incomingByNodeId.get(node.id) || [];
      const hasInput = inputEdges.some((edge) => edge.targetPortId === 'request.in' || edge.targetPortId === 'bidirect.in');
      if (!hasInput) {
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
      const incomingEdges = edgeIndexes.incomingByNodeId.get(node.id) || [];
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
    const info = publicEntryResolutionInfo(node);
    if (publicNames.has(lower)) {
      const existing = publicNames.get(lower);
      addDiagnostic(diagnostics, 'error', 'public_model.duplicate', `Public model ${publicName} is declared by both ${existing.nodeId} and ${node.id}.`, node.id);
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
    if (node.type === 'entry' && node.enabled !== false && !hasReachableTerminal(node.id, nodesById, traversalAdjacency)) {
      addDiagnostic(diagnostics, 'error', 'entry.no_terminal', `Enabled entry ${node.id} must reach a terminal node.`, node.id);
    }
  }

  const reachable = collectReachableFromEntries(source.nodes, reachabilityAdjacency);
  for (const node of source.nodes) {
    if (
      node.type !== 'route_endpoint'
      && node.provenance?.source !== 'macro'
      && node.enabled !== false
      && activeIncidentCounts.has(node.id)
      && !reachable.has(node.id)
    ) {
      addDiagnostic(diagnostics, 'error', 'internal.unreachable', `Enabled internal node ${node.id} must be reachable from an enabled public entry.`, node.id);
    }
  }

  return {
    source,
    compiled: {
      hash: stableHash({ nodes: source.nodes, edges: source.edges }),
    },
    diagnostics,
    ok: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
  };
}

function compileRouteGraph(sourceInput, options = {}) {
  const includePrimitiveSource = options.includePrimitiveSource !== false;
  const lowered = lowerRouteGraphSource(sourceInput);
  const compiled = compilePrimitiveRouteGraph(lowered.primitiveSource, lowered.diagnostics);
  const nextCompiledGraph = {
    ...compiled.compiled,
    metadata: isPlainObject(lowered.semanticSource.metadata) ? lowered.semanticSource.metadata : {},
    hash: stableHash({
      nodes: lowered.primitiveSource.nodes,
      edges: lowered.primitiveSource.edges,
      macros: lowered.semanticSource.macros,
      metadata: lowered.semanticSource.metadata,
    }),
  };
  if (!includePrimitiveSource) {
    // Runtime publication keeps only the compiled bundle. Release the
    // validation graph before bundle construction so large publishes do not
    // retain source, primitive, program, and bundle forms simultaneously.
    compiled.source = null;
  }
  const routerPlanSource = buildCompiledRouterPlanSource({
    semanticSource: lowered.semanticSource,
    primitiveSource: lowered.primitiveSource,
  });
  if (!includePrimitiveSource) {
    lowered.primitiveSource.nodes = [];
    lowered.primitiveSource.edges = [];
    lowered.primitiveSource.macros = [];
  }
  const logicalCompiledRouterBundle = buildCompiledRouterBundle(routerPlanSource);
  const compiledRouterBundle = options.compactRuntimeBundle === true
    ? compactRuntimeBundle(logicalCompiledRouterBundle)
    : logicalCompiledRouterBundle;
  const diagnostics = [
    ...compiled.diagnostics,
    ...(Array.isArray(routerPlanSource.diagnostics) ? routerPlanSource.diagnostics : []),
  ];
  return {
    ...compiled,
    source: lowered.semanticSource,
    primitiveSource: includePrimitiveSource ? lowered.primitiveSource : normalizeRouteGraphSource(null),
    diagnostics,
    ok: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
    compiled: {
      ...nextCompiledGraph,
      compiledRouterBundle,
    },
  };
}

export function validateRouteGraphSource(sourceInput) {
  const { diagnostics, ok } = compileRouteGraph(sourceInput);
  return { ok, diagnostics };
}

export function compileRouteGraphSource(sourceInput, options = {}) {
  return compileRouteGraph(sourceInput, options);
}

export function findRouteGraphEntryForModel(compiledGraph, model) {
  const graph = isPlainObject(compiledGraph) ? compiledGraph : {};
  const bundle = isPlainObject(graph.compiledRouterBundle) ? graph.compiledRouterBundle : null;
  const matcher = isPlainObject(bundle?.matcher) ? bundle.matcher : {};
  const plans = Array.isArray(bundle?.plans) ? bundle.plans : [];
  const plansById = new Map(plans.map((plan) => [normalizeString(plan.id), plan]));
  const targetToEntry = (target) => {
    const targetRecord = isPlainObject(target) ? target : {};
    const plan = plansById.get(normalizeString(targetRecord.programId));
    if (plan?.enabled === false) return null;
    const entryNodeId = normalizeString(targetRecord.entryNodeId || plan?.entryNodeId);
    const publicModelName = normalizeString(targetRecord.publicModelName || plan?.publicModelName);
    if (!entryNodeId || !publicModelName) return null;
    return {
      nodeId: entryNodeId,
      enabled: true,
      match: normalizeRouteGraphMatchSpec({
        requestedModelPattern: normalizeString(targetRecord.pattern) || publicModelName,
        displayName: publicModelName,
      }),
      backend: normalizeRouteGraphBackendSpec(null),
      publicModelName,
    };
  };
  const exactEntry = targetToEntry(isPlainObject(matcher.exact) ? matcher.exact[model] : null);
  if (exactEntry) return exactEntry;
  const normalized = normalizeString(model).toLowerCase();
  const normalizedEntry = targetToEntry(isPlainObject(matcher.normalizedExact) ? matcher.normalizedExact[normalized] : null);
  if (normalizedEntry) return normalizedEntry;
  for (const pattern of Array.isArray(matcher.patterns) ? matcher.patterns : []) {
    const patternEntry = targetToEntry(pattern);
    if (!patternEntry) continue;
    if (routeGraphMatchesRequestedModel(model, patternEntry.match, patternEntry.backend)) return patternEntry;
  }
  return null;
}
