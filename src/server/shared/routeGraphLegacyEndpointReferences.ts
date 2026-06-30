export type LegacyRouteGraphEndpointReferenceContext = {
  supplyEndpointIdsByRouteId: Map<number, string[]>;
  explicitGroupRouteIds?: Set<number>;
};

export type LegacyRouteGraphEndpointReferenceMigration<T = unknown> = {
  value: T;
  changed: boolean;
};

const LEGACY_ENTRY_ENDPOINT_PATTERN = /^entry:legacy:(\d+)$/;
const LEGACY_SUPPLY_ROUTE_ENDPOINT_PATTERN = /^route-endpoint:supply:route:(\d+)$/;
const PRODUCT_ROUTE_ENDPOINT_PATTERN = /^route-endpoint:product:route:(\d+)$/;
const EMBEDDED_ENDPOINT_PATTERN = /entry:legacy:\d+|route-endpoint:supply:route:\d+|route-endpoint:product:route:\d+/g;

function parsePositiveRouteId(value: unknown, pattern: RegExp): number | null {
  const match = pattern.exec(String(value || '').trim());
  if (!match) return null;
  const routeId = Math.trunc(Number(match[1]));
  return Number.isFinite(routeId) && routeId > 0 ? routeId : null;
}

export function legacyEntryRouteEndpointIdRouteId(value: unknown): number | null {
  return parsePositiveRouteId(value, LEGACY_ENTRY_ENDPOINT_PATTERN);
}

export function legacySupplyRouteEndpointIdRouteId(value: unknown): number | null {
  return parsePositiveRouteId(value, LEGACY_SUPPLY_ROUTE_ENDPOINT_PATTERN);
}

export function productRouteEndpointIdRouteId(value: unknown): number | null {
  return parsePositiveRouteId(value, PRODUCT_ROUTE_ENDPOINT_PATTERN);
}

export function normalizeStoredRouteEndpointId(value: unknown): string | null {
  const endpointId = String(value || '').trim();
  if (!endpointId) return null;
  if (legacyEntryRouteEndpointIdRouteId(endpointId)) return null;
  if (legacySupplyRouteEndpointIdRouteId(endpointId)) return null;
  return endpointId;
}

function replacementEndpointIdsForValue(
  value: unknown,
  context: LegacyRouteGraphEndpointReferenceContext,
): string[] | null {
  const endpointId = String(value || '').trim();
  const legacyEntryRouteId = legacyEntryRouteEndpointIdRouteId(endpointId);
  const legacySupplyRouteId = legacySupplyRouteEndpointIdRouteId(endpointId);
  const productRouteId = productRouteEndpointIdRouteId(endpointId);
  const routeId = legacyEntryRouteId || legacySupplyRouteId || productRouteId;
  if (!routeId) return null;
  if (productRouteId && context.explicitGroupRouteIds?.has(routeId)) return null;
  const replacements = context.supplyEndpointIdsByRouteId.get(routeId) || [];
  return replacements.length > 0 ? replacements : null;
}

function rewriteScalarEndpointReference(
  value: string,
  context: LegacyRouteGraphEndpointReferenceContext,
): { value: string; changed: boolean } {
  const replacements = replacementEndpointIdsForValue(value, context);
  if (replacements && replacements.length > 0) {
    return { value: replacements[0]!, changed: replacements[0] !== value };
  }

  let changed = false;
  const next = value.replace(EMBEDDED_ENDPOINT_PATTERN, (match) => {
    const embeddedReplacements = replacementEndpointIdsForValue(match, context);
    if (!embeddedReplacements || embeddedReplacements.length === 0) return match;
    changed = true;
    return embeddedReplacements[0]!;
  });
  return { value: next, changed };
}

function rewriteEndpointIdArray(
  value: unknown[],
  context: LegacyRouteGraphEndpointReferenceContext,
): { value: unknown[]; changed: boolean } {
  const next: unknown[] = [];
  let changed = false;
  for (const item of value) {
    const replacements = replacementEndpointIdsForValue(item, context);
    if (replacements && replacements.length > 0) {
      next.push(...replacements);
      changed = true;
    } else {
      next.push(item);
    }
  }
  const deduped = Array.from(new Set(next.map((item) => String(item || '').trim()).filter(Boolean)));
  if (deduped.length !== next.length) changed = true;
  return { value: deduped, changed };
}

function rewriteRouteGraphValue(
  value: unknown,
  context: LegacyRouteGraphEndpointReferenceContext,
  key = '',
): LegacyRouteGraphEndpointReferenceMigration {
  if (Array.isArray(value)) {
    if (key === 'endpointIds') {
      return rewriteEndpointIdArray(value, context);
    }
    let changed = false;
    const next = value.map((item) => {
      const rewritten = rewriteRouteGraphValue(item, context);
      if (rewritten.changed) changed = true;
      return rewritten.value;
    });
    return { value: next, changed };
  }

  if (value && typeof value === 'object') {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
      const rewritten = rewriteRouteGraphValue(entryValue, context, entryKey);
      if (rewritten.changed) changed = true;
      next[entryKey] = rewritten.value;
    }
    return { value: next, changed };
  }

  if (typeof value === 'string') {
    return rewriteScalarEndpointReference(value, context);
  }

  return { value, changed: false };
}

export function normalizeLegacyRouteGraphEndpointReferences<T>(
  sourceGraph: T,
  context: LegacyRouteGraphEndpointReferenceContext,
): LegacyRouteGraphEndpointReferenceMigration<T> {
  const rewritten = rewriteRouteGraphValue(sourceGraph, context);
  return {
    value: rewritten.value as T,
    changed: rewritten.changed,
  };
}

export function normalizeLegacyRouteGraphEndpointReferencesJson(
  raw: string | null | undefined,
  context: LegacyRouteGraphEndpointReferenceContext,
): { json: string | null; changed: boolean } {
  if (
    !raw
    || (
      !raw.includes('route-endpoint:product:route:')
      && !raw.includes('route-endpoint:supply:route:')
      && !raw.includes('entry:legacy:')
    )
  ) {
    return { json: null, changed: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { json: null, changed: false };
  }

  const rewritten = normalizeLegacyRouteGraphEndpointReferences(parsed, context);
  return rewritten.changed
    ? { json: JSON.stringify(rewritten.value), changed: true }
    : { json: null, changed: false };
}
