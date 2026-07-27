import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, schema } from '../db/index.js';
import {
  compactCompiledRouterBundle,
  getCompiledRouterExecutionTargetIds,
  materializeCompiledRouterPlan,
  validateCompiledRouterBundle,
  type CompiledRouteGraph,
  type CompiledRouterBundle,
} from '../../shared/compiledRuntime.js';
import {
  getRouteRuntimeExecutionIdentityCacheStats,
  primeRouteRuntimeExecutionTargetIdentities,
} from './routeRuntimeExecutionIdentityService.js';
import { invalidateRouteRuntimeSelectorState } from './routeRuntimeSelectorStateService.js';
import {
  getCachedActiveRouteRuntimeArtifact as getCachedRuntimeArtifact,
  getOrLoadActiveRouteRuntimeArtifact as getOrLoadRuntimeArtifact,
  invalidateRouteRuntimeCaches,
  setCachedActiveRouteRuntimeArtifact,
} from './routeRuntimeCacheService.js';

export const ROUTE_RUNTIME_STORAGE_ARTIFACT_BYTE_LIMIT = 64 * 1024 * 1024;
const ACTIVE_ROUTE_RUNTIME_ARTIFACT_ID_CACHE_TTL_MS = 1_000;
const IMMUTABLE_ARTIFACT_CACHE_LIMIT = 4;

export type RouteRuntimeStorageArtifact = {
  hash?: string;
  compiledRouterBundle?: CompiledRouterBundle;
};

export type RouteRuntimeArtifactProvenance = {
  sourceGraphVersionId: number | null;
  sourceGraphHash: string | null;
};

export type ActiveRouteRuntimeArtifact = {
  artifactId: string;
  bundleHash: string;
  compiledGraph: RouteRuntimeStorageArtifact;
  provenance: RouteRuntimeArtifactProvenance;
};

export class RouteRuntimeArtifactValidationError extends Error {
  constructor(readonly artifactId: string, readonly reason: string) {
    super(`Route runtime artifact ${artifactId} is invalid: ${reason}`);
    this.name = 'RouteRuntimeArtifactValidationError';
  }
}

function runtimeArtifactExecutionTargetIds(artifact: RouteRuntimeStorageArtifact): number[] {
  return getCompiledRouterExecutionTargetIds(artifact.compiledRouterBundle);
}

const primedIdentityGenerationByArtifactId = new Map<string, number>();

export async function primeRouteRuntimeArtifactExecutionIdentities(
  artifactId: string,
  artifact: RouteRuntimeStorageArtifact,
): Promise<void> {
  const generation = getRouteRuntimeExecutionIdentityCacheStats().generation;
  if (primedIdentityGenerationByArtifactId.get(artifactId) === generation) return;
  await primeRouteRuntimeExecutionTargetIdentities(runtimeArtifactExecutionTargetIds(artifact));
  if (getRouteRuntimeExecutionIdentityCacheStats().generation === generation) {
    primedIdentityGenerationByArtifactId.set(artifactId, generation);
  }
}

let activeRouteRuntimeArtifactIdCache: {
  loadedAt: number;
  artifactId: string | null;
} | null = null;
let activeRouteRuntimeArtifactIdLoadPromise: Promise<string | null> | null = null;
const immutableArtifactById = new Map<string, ActiveRouteRuntimeArtifact>();

function cacheImmutableArtifact(artifact: ActiveRouteRuntimeArtifact): ActiveRouteRuntimeArtifact {
  immutableArtifactById.delete(artifact.artifactId);
  immutableArtifactById.set(artifact.artifactId, artifact);
  while (immutableArtifactById.size > IMMUTABLE_ARTIFACT_CACHE_LIMIT) {
    const oldest = immutableArtifactById.keys().next().value as string | undefined;
    if (!oldest) break;
    immutableArtifactById.delete(oldest);
  }
  return artifact;
}

export function invalidateRouteRuntimeArtifactReadCaches(): void {
  activeRouteRuntimeArtifactIdCache = null;
  activeRouteRuntimeArtifactIdLoadPromise = null;
  immutableArtifactById.clear();
  invalidateRouteRuntimeCaches('manual');
  invalidateRouteRuntimeSelectorState();
}

export function invalidateRouteRuntimeArtifactPointerCache(): void {
  activeRouteRuntimeArtifactIdCache = null;
  activeRouteRuntimeArtifactIdLoadPromise = null;
}

export function cacheActiveRouteRuntimeArtifact(value: ActiveRouteRuntimeArtifact): ActiveRouteRuntimeArtifact {
  activeRouteRuntimeArtifactIdCache = { loadedAt: Date.now(), artifactId: value.artifactId };
  const immutable = cacheImmutableArtifact(value);
  setCachedActiveRouteRuntimeArtifact(value.artifactId, immutable);
  return immutable;
}

function parseJsonObject<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function validateRouteRuntimeStorageArtifact(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'artifact_not_object';
  const bundle = (value as RouteRuntimeStorageArtifact).compiledRouterBundle;
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return 'compiled_router_bundle_missing';
  const validation = validateCompiledRouterBundle(bundle);
  return validation.ok ? null : validation.reason;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function runtimeArtifactFromCompiledRouteGraph(compiledGraph: CompiledRouteGraph): RouteRuntimeStorageArtifact {
  return {
    hash: compiledGraph.hash,
    ...(compiledGraph.compiledRouterBundle
      ? { compiledRouterBundle: compactCompiledRouterBundle(compiledGraph.compiledRouterBundle) }
      : {}),
  };
}

function boundRouteRuntimeStorageArtifact(artifact: RouteRuntimeStorageArtifact): RouteRuntimeStorageArtifact {
  const validationError = validateRouteRuntimeStorageArtifact(artifact);
  if (validationError) throw new Error(`Compiled runtime artifact is invalid: ${validationError}`);
  const artifactJson = JSON.stringify(artifact);
  if (Buffer.byteLength(artifactJson, 'utf8') > ROUTE_RUNTIME_STORAGE_ARTIFACT_BYTE_LIMIT) {
    throw new Error('Route runtime artifact exceeds storage byte limit.');
  }
  return deepFreeze(artifact);
}

export function buildRouteRuntimeStorageArtifact(compiledGraph: CompiledRouteGraph): RouteRuntimeStorageArtifact {
  return boundRouteRuntimeStorageArtifact(runtimeArtifactFromCompiledRouteGraph(compiledGraph));
}

export function compiledRouteGraphFromRuntimeArtifact(
  artifact: RouteRuntimeStorageArtifact,
): CompiledRouteGraph {
  return {
    hash: artifact.hash || artifact.compiledRouterBundle?.hash || '',
    compiledRouterBundle: artifact.compiledRouterBundle,
  };
}

function optionalPositiveInteger(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

export async function assertRouteRuntimeArtifactTransportBindings(input: {
  database: any;
  compiledGraph: CompiledRouteGraph;
}): Promise<void> {
  const bundle = input.compiledGraph.compiledRouterBundle;
  const executionTargetIds = getCompiledRouterExecutionTargetIds(bundle);
  if (executionTargetIds.length === 0) return;
  const rows = await input.database.select({
    id: schema.runtimeExecutionTargets.id,
    siteId: schema.runtimeExecutionTargets.siteId,
    accountId: schema.runtimeExecutionTargets.accountId,
    tokenId: schema.runtimeExecutionTargets.tokenId,
    credentialBindingId: schema.runtimeExecutionTargets.credentialBindingId,
    endpointProfileId: schema.runtimeExecutionTargets.endpointProfileId,
    accountRowId: schema.accounts.id,
    accountSiteId: schema.accounts.siteId,
    tokenRowId: schema.accountTokens.id,
    tokenAccountId: schema.accountTokens.accountId,
    bindingRowId: schema.credentialEndpointBindings.id,
    bindingSiteId: schema.credentialEndpointBindings.siteId,
    bindingAccountId: schema.credentialEndpointBindings.accountId,
    bindingTokenId: schema.credentialEndpointBindings.tokenId,
    bindingProfileId: schema.credentialEndpointBindings.apiEndpointProfileId,
    profileRowId: schema.apiEndpointProfiles.id,
    profileSiteId: schema.apiEndpointProfiles.siteId,
  }).from(schema.runtimeExecutionTargets)
    .leftJoin(schema.accounts, eq(schema.runtimeExecutionTargets.accountId, schema.accounts.id))
    .leftJoin(schema.accountTokens, eq(schema.runtimeExecutionTargets.tokenId, schema.accountTokens.id))
    .leftJoin(schema.credentialEndpointBindings, eq(
      schema.runtimeExecutionTargets.credentialBindingId,
      schema.credentialEndpointBindings.id,
    ))
    .leftJoin(schema.apiEndpointProfiles, eq(
      schema.runtimeExecutionTargets.endpointProfileId,
      schema.apiEndpointProfiles.id,
    ))
    .where(inArray(schema.runtimeExecutionTargets.id, executionTargetIds))
    .all();
  const rowById = new Map<number, typeof rows[number]>(rows.map((row: typeof rows[number]) => [row.id, row]));
  const errors: string[] = [];
  for (const packedPlan of bundle?.plans ?? []) {
    const plan = materializeCompiledRouterPlan(bundle!, packedPlan);
    for (const alternative of plan.executionAlternatives) {
      const attempt = alternative.executionAttempt;
      if (!attempt) continue;
      const executionTargetId = optionalPositiveInteger(attempt.transportBinding?.executionTargetId);
      if (!executionTargetId) {
        errors.push(`${attempt.executionAttemptId}:invalid_execution_target_binding`);
        continue;
      }
      const row = rowById.get(executionTargetId);
      if (!row) {
        errors.push(`${attempt.executionAttemptId}:execution_target_not_found:${executionTargetId}`);
        continue;
      }
      if (row.accountId == null || row.accountRowId == null) {
        errors.push(`${attempt.executionAttemptId}:account_binding_missing`);
      } else if (row.accountSiteId !== row.siteId) {
        errors.push(`${attempt.executionAttemptId}:account_site_binding_mismatch`);
      }
      if (row.tokenId != null && row.tokenRowId == null) {
        errors.push(`${attempt.executionAttemptId}:token_binding_missing`);
      } else if (row.tokenId != null && row.tokenAccountId !== row.accountId) {
        errors.push(`${attempt.executionAttemptId}:token_account_binding_mismatch`);
      }
      if (row.credentialBindingId != null && row.bindingRowId == null) {
        errors.push(`${attempt.executionAttemptId}:credential_binding_missing`);
      } else if (row.credentialBindingId != null && (
        row.bindingSiteId !== row.siteId
        || (row.bindingAccountId != null && row.bindingAccountId !== row.accountId)
        || (row.bindingTokenId != null && row.bindingTokenId !== row.tokenId)
      )) {
        errors.push(`${attempt.executionAttemptId}:credential_binding_mismatch`);
      }
      if (row.endpointProfileId != null && row.profileRowId == null) {
        errors.push(`${attempt.executionAttemptId}:endpoint_profile_binding_missing`);
      } else if (row.endpointProfileId != null && row.profileSiteId !== row.siteId) {
        errors.push(`${attempt.executionAttemptId}:endpoint_profile_site_mismatch`);
      }
      if (
        row.credentialBindingId != null
        && row.endpointProfileId != null
        && row.bindingProfileId !== row.endpointProfileId
      ) {
        errors.push(`${attempt.executionAttemptId}:credential_profile_binding_mismatch`);
      }
      const expectedSiteId = optionalPositiveInteger(attempt.siteId);
      const expectedAccountId = optionalPositiveInteger(attempt.accountId);
      const expectedTokenId = optionalPositiveInteger(attempt.tokenId);
      if (expectedSiteId != null && row.siteId !== expectedSiteId) {
        errors.push(`${attempt.executionAttemptId}:site_binding_mismatch`);
      }
      if (expectedAccountId != null && row.accountId !== expectedAccountId) {
        errors.push(`${attempt.executionAttemptId}:account_binding_mismatch`);
      }
      if (expectedTokenId != null && row.tokenId !== expectedTokenId) {
        errors.push(`${attempt.executionAttemptId}:token_binding_mismatch`);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Compiled runtime transport binding validation failed: ${errors.join(', ')}`);
  }
}

function activeArtifactFromRow(input: {
  id: string;
  bundleHash: string;
  sourceGraphVersionId: number | null;
  sourceGraphHash: string | null;
  artifact: RouteRuntimeStorageArtifact;
}): ActiveRouteRuntimeArtifact {
  return cacheImmutableArtifact({
    artifactId: input.id,
    bundleHash: input.bundleHash,
    compiledGraph: input.artifact,
    provenance: {
      sourceGraphVersionId: input.sourceGraphVersionId,
      sourceGraphHash: input.sourceGraphHash,
    },
  });
}

export async function persistAndActivateRouteRuntimeArtifact(input: {
  database: any;
  compiledGraph: CompiledRouteGraph;
  sourceGraphVersionId: number;
  sourceGraphHash: string;
  timestamp: string;
}): Promise<ActiveRouteRuntimeArtifact> {
  const artifact = buildRouteRuntimeStorageArtifact(input.compiledGraph);
  const artifactId = randomUUID();
  const bundleHash = artifact.compiledRouterBundle?.hash || artifact.hash || '';
  const currentPointer = await input.database.select()
    .from(schema.compiledRuntimeActiveArtifact)
    .where(eq(schema.compiledRuntimeActiveArtifact.id, 1))
    .get();
  await input.database.insert(schema.compiledRuntimeArtifacts).values({
    id: artifactId,
    artifactJson: JSON.stringify(artifact),
    bundleHash,
    sourceGraphVersionId: input.sourceGraphVersionId,
    sourceGraphHash: input.sourceGraphHash,
    createdAt: input.timestamp,
  }).run();
  if (currentPointer) {
    const updated = await input.database.update(schema.compiledRuntimeActiveArtifact)
      .set({ artifactId, updatedAt: input.timestamp })
      .where(and(
        eq(schema.compiledRuntimeActiveArtifact.id, 1),
        eq(schema.compiledRuntimeActiveArtifact.artifactId, currentPointer.artifactId),
      ))
      .run();
    const changes = Number((updated as { changes?: number }).changes ?? 0);
    if (changes !== 1) throw new Error('The active compiled runtime changed during publication.');
  } else {
    await input.database.insert(schema.compiledRuntimeActiveArtifact).values({
      id: 1,
      artifactId,
      updatedAt: input.timestamp,
    }).run();
  }
  return activeArtifactFromRow({
    id: artifactId,
    bundleHash,
    sourceGraphVersionId: input.sourceGraphVersionId,
    sourceGraphHash: input.sourceGraphHash,
    artifact,
  });
}

async function loadRouteRuntimeArtifactRow(artifactId: string): Promise<ActiveRouteRuntimeArtifact> {
  const cached = immutableArtifactById.get(artifactId);
  if (cached) return cached;
  const row = await db.select({
    id: schema.compiledRuntimeArtifacts.id,
    bundleHash: schema.compiledRuntimeArtifacts.bundleHash,
    sourceGraphVersionId: schema.compiledRuntimeArtifacts.sourceGraphVersionId,
    sourceGraphHash: schema.compiledRuntimeArtifacts.sourceGraphHash,
    artifactJson: schema.compiledRuntimeArtifacts.artifactJson,
    artifactBytes: sql<number>`length(${schema.compiledRuntimeArtifacts.artifactJson})`,
  }).from(schema.compiledRuntimeArtifacts)
    .where(eq(schema.compiledRuntimeArtifacts.id, artifactId))
    .get();
  if (!row) throw new RouteRuntimeArtifactValidationError(artifactId, 'artifact is missing');
  const bytes = Number(row.artifactBytes || 0);
  if (bytes <= 0) throw new RouteRuntimeArtifactValidationError(artifactId, 'artifact is missing');
  if (bytes > ROUTE_RUNTIME_STORAGE_ARTIFACT_BYTE_LIMIT) {
    throw new RouteRuntimeArtifactValidationError(artifactId, 'artifact exceeds storage byte limit');
  }
  const parsed = parseJsonObject<unknown>(row.artifactJson, null);
  const validationError = validateRouteRuntimeStorageArtifact(parsed);
  if (validationError) throw new RouteRuntimeArtifactValidationError(artifactId, validationError);
  return activeArtifactFromRow({
    id: row.id,
    bundleHash: row.bundleHash,
    sourceGraphVersionId: row.sourceGraphVersionId,
    sourceGraphHash: row.sourceGraphHash,
    artifact: deepFreeze(parsed as RouteRuntimeStorageArtifact),
  });
}

export async function loadRouteRuntimeArtifactForSourceGraphVersion(
  sourceGraphVersionId: number,
): Promise<ActiveRouteRuntimeArtifact | null> {
  const row = await db.select({ id: schema.compiledRuntimeArtifacts.id })
    .from(schema.compiledRuntimeArtifacts)
    .where(eq(schema.compiledRuntimeArtifacts.sourceGraphVersionId, sourceGraphVersionId))
    .get();
  return row ? await loadRouteRuntimeArtifactRow(row.id) : null;
}

async function getActiveRouteRuntimeArtifactId(): Promise<string | null> {
  const nowMs = Date.now();
  if (
    activeRouteRuntimeArtifactIdCache
    && nowMs - activeRouteRuntimeArtifactIdCache.loadedAt < ACTIVE_ROUTE_RUNTIME_ARTIFACT_ID_CACHE_TTL_MS
  ) return activeRouteRuntimeArtifactIdCache.artifactId;
  if (activeRouteRuntimeArtifactIdLoadPromise) return await activeRouteRuntimeArtifactIdLoadPromise;
  const loadTask = db.select({ artifactId: schema.compiledRuntimeActiveArtifact.artifactId })
    .from(schema.compiledRuntimeActiveArtifact)
    .where(eq(schema.compiledRuntimeActiveArtifact.id, 1))
    .get()
    .then((pointer) => {
      const artifactId = pointer?.artifactId ?? null;
      activeRouteRuntimeArtifactIdCache = { loadedAt: Date.now(), artifactId };
      return artifactId;
    })
    .finally(() => {
      if (activeRouteRuntimeArtifactIdLoadPromise === loadTask) activeRouteRuntimeArtifactIdLoadPromise = null;
    });
  activeRouteRuntimeArtifactIdLoadPromise = loadTask;
  return await loadTask;
}

export async function getActiveRouteRuntimeArtifact(): Promise<ActiveRouteRuntimeArtifact | null> {
  const artifactId = await getActiveRouteRuntimeArtifactId();
  if (!artifactId) return null;
  return await getOrLoadRuntimeArtifact(artifactId, async () => {
    const artifact = await loadRouteRuntimeArtifactRow(artifactId);
    await primeRouteRuntimeArtifactExecutionIdentities(artifact.artifactId, artifact.compiledGraph);
    return artifact;
  });
}

export function getCachedActiveRouteRuntimeArtifact(
  nowMs = Date.now(),
): ActiveRouteRuntimeArtifact | null | undefined {
  if (
    !activeRouteRuntimeArtifactIdCache
    || nowMs - activeRouteRuntimeArtifactIdCache.loadedAt >= ACTIVE_ROUTE_RUNTIME_ARTIFACT_ID_CACHE_TTL_MS
  ) return undefined;
  const artifactId = activeRouteRuntimeArtifactIdCache.artifactId;
  if (!artifactId) return null;
  return getCachedRuntimeArtifact<ActiveRouteRuntimeArtifact>(artifactId, nowMs);
}
