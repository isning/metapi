function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function stableRoutingIdentityJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableRoutingIdentityJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableRoutingIdentityJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function stableRoutingIdentityHash(value) {
  const text = typeof value === 'string' ? value : stableRoutingIdentityJson(value);
  let left = 0x811c9dc5;
  let right = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    left ^= code;
    left = Math.imul(left, 0x01000193) >>> 0;
    right ^= code + index;
    right = Math.imul(right, 0x85ebca6b) >>> 0;
  }
  return `${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
}

export function routingIdentitySafePart(value) {
  return String(value || 'x')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'x';
}

export function routeMacroIdentitySafePart(value) {
  return String(value || 'x')
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'x';
}

function normalizeText(value) {
  return String(value || '').trim();
}

export function createRouteBuilderMacroId(routeStableId) {
  return `route:${routingIdentitySafePart(routeStableId)}`;
}

export function createManagedRouteGraphElementId(kind, opaqueId) {
  const value = normalizeText(opaqueId);
  if (!value) throw new Error('Managed Route Graph identity must include an opaque ID');
  if (kind === 'macro') return `route:managed:${value}`;
  if (kind === 'endpoint') return `route-endpoint:managed:${value}`;
  if (kind === 'stage') return `fallback-stage:managed:${value}`;
  if (kind === 'member') return `dispatcher-member:managed:${value}`;
  if (kind === 'target') return `execution-target:managed:${value}`;
  if (kind === 'edge') return `edge:managed:${value}`;
  throw new Error(`Unsupported managed Route Graph identity kind: ${String(kind)}`);
}

export function createManualRouteGraphNodeId(nodeType, opaqueId) {
  const type = routingIdentitySafePart(nodeType);
  const value = normalizeText(opaqueId);
  if (!type || !value) throw new Error('Manual Route Graph node identity requires a node type and opaque ID');
  return `manual:${type}:${value}`;
}

export function createManualRouteGraphEdgeId(opaqueId) {
  const value = normalizeText(opaqueId);
  if (!value) throw new Error('Manual Route Graph edge identity requires an opaque ID');
  return `manual:edge:${value}`;
}

export function normalizeRouteGroupModelKey(modelName) {
  return normalizeText(modelName).toLowerCase();
}

export function createAutomaticRouteGroupKey(modelName) {
  return `upstream:${normalizeRouteGroupModelKey(modelName)}`;
}

export function isAutomaticRouteGroupKey(groupKey) {
  return normalizeText(groupKey).startsWith('upstream:');
}

export function createRouteSupplyCredentialKey(identity) {
  if (!isPlainObject(identity)) {
    throw new Error('Route supply credential identity must be an object');
  }
  const oauthRouteUnitId = Number(identity.oauthRouteUnitId);
  if (Number.isSafeInteger(oauthRouteUnitId) && oauthRouteUnitId > 0) {
    return `route-unit:${oauthRouteUnitId}`;
  }
  const accountId = Number(identity.accountId);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    throw new Error('Route supply credential identity must include accountId');
  }
  const tokenId = Number(identity.tokenId);
  return `${accountId}:${Number.isSafeInteger(tokenId) && tokenId > 0 ? tokenId : 'account'}`;
}

export function createRouteSupplyKey(input) {
  if (!isPlainObject(input)) {
    throw new Error('Route supply key input must be an object');
  }
  const modelKey = normalizeRouteGroupModelKey(input.modelName || input.sourceModel);
  if (!modelKey) throw new Error('Route supply key input must include modelName');
  const credentialKey = normalizeText(input.credentialKey || createRouteSupplyCredentialKey(input));
  if (!credentialKey) throw new Error('Route supply key input must include a credential key');
  return `upstream:${modelKey}|${credentialKey}`;
}

export function createRuntimeExecutionTargetIdFromSupplyKey(supplyKey) {
  const normalizedSupplyKey = normalizeText(supplyKey);
  const modelPart = normalizedSupplyKey.startsWith('upstream:')
    ? normalizedSupplyKey.slice('upstream:'.length).split('|')[0]
    : normalizedSupplyKey.split('|')[0];
  const modelSlug = routingIdentitySafePart(modelPart || 'request-model');
  const fingerprint = stableRoutingIdentityHash(normalizedSupplyKey || supplyKey || modelSlug);
  return `route-endpoint:supply:upstream-model:supply-key:${fingerprint}:${modelSlug}:${fingerprint}`;
}

export function createRuntimeExecutionTargetIdFromIdentity(identity) {
  if (!isPlainObject(identity)) {
    throw new Error('Route supply endpoint identity must be an object');
  }
  const model = normalizeText(identity.model || identity.modelName);
  const provider = normalizeText(identity.provider || identity.platform || identity.sitePlatform);
  const credentialFingerprint = normalizeText(identity.credentialFingerprint);
  if (!model || !provider || !credentialFingerprint) {
    throw new Error('Route supply endpoint identity must include provider, credentialFingerprint, and model');
  }
  const modelSlug = routingIdentitySafePart(model);
  const providerSlug = routingIdentitySafePart(provider);
  const credentialSlug = routingIdentitySafePart(credentialFingerprint);
  const fingerprint = stableRoutingIdentityHash(identity).slice(0, 8);
  return `route-endpoint:supply:upstream-model:${providerSlug}:${credentialSlug}:${modelSlug}:${fingerprint}`;
}

export function createRouteProgramEdgeId(sourceNodeId, sourcePortId, targetNodeId, targetPortId) {
  return `edge:${routingIdentitySafePart(sourceNodeId)}:${routingIdentitySafePart(sourcePortId)}:${routingIdentitySafePart(targetNodeId)}:${routingIdentitySafePart(targetPortId)}`;
}

export function createRouteMacroSemanticNodeId(macroId) {
  return `macro:${routeMacroIdentitySafePart(macroId)}`;
}

export function isRouteMacroSemanticNodeId(value) {
  const text = normalizeText(value);
  if (!text.startsWith('macro:')) return false;
  return !/:(?:entry|filter|dispatcher|fallback-stage:|candidate:|edge:)/.test(text.slice('macro:'.length));
}

export function createRouteMacroEntryNodeId(macroId) {
  return `${createRouteMacroSemanticNodeId(macroId)}:entry`;
}

export function createRouteMacroFilterNodeId(macroId) {
  return `${createRouteMacroSemanticNodeId(macroId)}:filter`;
}

export function createRouteMacroDispatcherNodeId(macroId) {
  return `${createRouteMacroSemanticNodeId(macroId)}:dispatcher`;
}

export function createRouteMacroFallbackStageId(stageKey) {
  return `fallback-stage:${routeMacroIdentitySafePart(stageKey)}`;
}

export function createRouteMacroFallbackStageDispatcherNodeId(macroId, stageId) {
  return `${createRouteMacroSemanticNodeId(macroId)}:fallback-stage:${routeMacroIdentitySafePart(stageId)}:dispatcher`;
}

export function isRouteMacroDispatcherNodeId(value, macroId) {
  const nodeId = normalizeText(value);
  const semanticNodeId = createRouteMacroSemanticNodeId(macroId);
  return nodeId === createRouteMacroDispatcherNodeId(macroId)
    || (nodeId.startsWith(`${semanticNodeId}:fallback-stage:`) && nodeId.endsWith(':dispatcher'));
}

export function createRouteMacroCandidateEndpointNodeId(macroId, groupId, endpointId) {
  return `${createRouteMacroSemanticNodeId(macroId)}:candidate:${routeMacroIdentitySafePart(groupId)}:endpoint:${routeMacroIdentitySafePart(endpointId)}`;
}

export function createRouteMacroInlineCandidateNodeId(macroId, groupId) {
  return `${createRouteMacroSemanticNodeId(macroId)}:candidate:${routeMacroIdentitySafePart(groupId)}:inline`;
}

export function createRouteMacroSyntheticCandidateNodeId(macroId, groupId) {
  return `${createRouteMacroSemanticNodeId(macroId)}:candidate:${routeMacroIdentitySafePart(groupId)}:synthetic`;
}

export function createRouteMacroCandidateEdgeId(macroId, groupId, candidateId) {
  return `${createRouteMacroSemanticNodeId(macroId)}:edge:candidate:${routeMacroIdentitySafePart(groupId)}:${routeMacroIdentitySafePart(candidateId)}`;
}

export function createRouteMacroInternalEdgeId(macroId, edgeName) {
  return `${createRouteMacroSemanticNodeId(macroId)}:edge:${routeMacroIdentitySafePart(edgeName)}`;
}

export function createRouteMacroSemanticCandidateEdgeId(edgeId, candidateNodeId) {
  return `macro-semantic:${routeMacroIdentitySafePart(edgeId)}:route-out:${routeMacroIdentitySafePart(candidateNodeId)}`;
}

export function isRouteMacroIdentity(value) {
  return classifyRoutingIdentity(value).kind === 'macro';
}

export function classifyRoutingIdentity(value) {
  const text = normalizeText(value);
  if (!text) return { kind: 'unknown', value: text };
  if (text.startsWith('entry:')) return { kind: 'entry', value: text };
  if (text.startsWith('dispatcher:')) return { kind: 'dispatcher', value: text };
  if (text.startsWith('route-endpoint:supply:')) return { kind: 'execution_target', value: text };
  if (text.startsWith('macro:')) return { kind: 'macro', value: text };
  if (text.startsWith('edge:')) return { kind: 'edge', value: text };
  if (text.startsWith('alternative:')) return { kind: 'compiled_alternative', value: text };
  if (text.startsWith('attempt:')) return { kind: 'compiled_attempt', value: text };
  if (text.startsWith('plan:')) return { kind: 'compiled_plan', value: text };
  return { kind: 'unknown', value: text };
}
