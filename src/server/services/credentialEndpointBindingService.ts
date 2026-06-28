import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  ensureDefaultModelCatalogSourcesForSite,
  type ModelCatalogSourceRow,
} from './modelCatalogSourceService.js';
import {
  API_TYPES,
  DEFAULT_API_VARIANT_CAPABILITY,
  apiTypeFromUpstreamEndpoint,
  defaultRequestUrlForUpstreamEndpoint,
  type ApiEndpointProfile,
  type ApiType,
  type ApiVariantCapability,
  type ApiVariantCapabilityOverride,
  type CredentialEndpointBinding,
  type EndpointModelObservation,
} from '../proxy-core/apiVariants.js';
import type { UpstreamEndpoint } from '../proxy-core/orchestration/upstreamRequest.js';

export type CredentialEndpointKey =
  | { credentialKind: 'account'; credentialKey: string; accountId: number; tokenId: null }
  | { credentialKind: 'account_token'; credentialKey: string; accountId: number; tokenId: number };

export type CredentialApiVariantConfig = {
  credentialKey: CredentialEndpointKey;
  endpointProfiles: ApiEndpointProfile[];
  credentialEndpointBindings: CredentialEndpointBinding[];
  endpointModelObservations: EndpointModelObservation[];
};

export type ModelCatalogSourceSummary = {
  id: number;
  sourceKey: string;
  label: string;
  discoveryMethod: string;
  discoveryUrl: string | null;
  parser: string;
  credentialScope: string;
  enabled: boolean;
  lastRefreshAt: string | null;
  lastModelCount: number;
  lastError: string | null;
};

export type CredentialEndpointMatrixProfile = ApiEndpointProfile & {
  rowId: number;
  profileKey: string;
};

export type CredentialEndpointMatrixBinding = {
  id: number | null;
  apiEndpointProfileId: number;
  enabled: boolean;
  support: CredentialEndpointBinding['support'];
  source: CredentialEndpointBinding['source'];
  priority: number;
  persisted: boolean;
};

export type CredentialEndpointMatrixCredential = CredentialEndpointKey & {
  label: string;
  detail: string | null;
  bindings: CredentialEndpointMatrixBinding[];
};

export type CredentialEndpointMatrix = {
  siteId: number;
  profiles: CredentialEndpointMatrixProfile[];
  catalogSources: ModelCatalogSourceSummary[];
  credentials: CredentialEndpointMatrixCredential[];
};

export type CredentialEndpointBindingUpdate = {
  apiEndpointProfileId: number;
  enabled?: boolean;
  support?: CredentialEndpointBinding['support'];
  priority?: number;
};

export type ApiEndpointProfileUpdate = {
  id: number;
  label?: string;
  requestMethod?: 'POST' | 'GET';
  requestUrl?: string | null;
  defaultHeaders?: Record<string, string> | null;
  modelCatalogSourceId?: number | null;
  enabled?: boolean;
  priority?: number;
};

type ApiEndpointProfileRow = typeof schema.apiEndpointProfiles.$inferSelect;
type CredentialEndpointBindingRow = typeof schema.credentialEndpointBindings.$inferSelect;
type EndpointModelObservationRow = typeof schema.endpointModelObservations.$inferSelect;

const DEFAULT_PROFILE_ENDPOINTS: UpstreamEndpoint[] = [
  'chat',
  'responses',
  'messages',
  'embeddings',
  'completions',
  'images/generations',
  'images/edits',
  'videos/generations',
  'videos',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
  const parsed = parseJsonRecord(value);
  if (!parsed) return undefined;
  const entries = Object.entries(parsed)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function parseCapabilityDefaults(value: unknown): ApiVariantCapability {
  const parsed = parseJsonRecord(value);
  if (!parsed) return DEFAULT_API_VARIANT_CAPABILITY;
  return {
    ...DEFAULT_API_VARIANT_CAPABILITY,
    ...parsed,
    input: {
      ...DEFAULT_API_VARIANT_CAPABILITY.input,
      ...(isRecord(parsed.input) ? parsed.input : {}),
    },
    output: {
      ...DEFAULT_API_VARIANT_CAPABILITY.output,
      ...(isRecord(parsed.output) ? parsed.output : {}),
    },
    limits: isRecord(parsed.limits) ? parsed.limits : DEFAULT_API_VARIANT_CAPABILITY.limits,
  } as ApiVariantCapability;
}

function parseCapabilityOverride(value: unknown): ApiVariantCapabilityOverride | undefined {
  const parsed = parseJsonRecord(value);
  if (!parsed) return undefined;
  return {
    ...(typeof parsed.status === 'string' ? { status: parsed.status as ApiVariantCapability['status'] } : {}),
    ...(isRecord(parsed.input) ? { input: parsed.input as ApiVariantCapabilityOverride['input'] } : {}),
    ...(isRecord(parsed.output) ? { output: parsed.output as ApiVariantCapabilityOverride['output'] } : {}),
    ...(isRecord(parsed.limits) ? { limits: parsed.limits as ApiVariantCapabilityOverride['limits'] } : {}),
  };
}

function normalizeApiType(value: unknown): ApiType {
  return API_TYPES.includes(value as ApiType) ? value as ApiType : 'custom_http';
}

function normalizeSupport(value: unknown): CredentialEndpointBinding['support'] {
  return value === 'supported' || value === 'unsupported' || value === 'unknown' || value === 'blocked'
    ? value
    : 'unknown';
}

function normalizeSource(value: unknown): CredentialEndpointBinding['source'] {
  return value === 'discovered' || value === 'manual' || value === 'inherited' || value === 'default'
    ? value
    : 'manual';
}

function rowToProfile(row: ApiEndpointProfileRow): ApiEndpointProfile {
  return {
    id: String(row.id),
    siteId: row.siteId,
    apiType: normalizeApiType(row.apiType),
    label: row.label,
    requestMethod: row.requestMethod === 'GET' ? 'GET' : 'POST',
    requestUrl: row.requestUrl,
    defaultHeaders: parseStringRecord(row.defaultHeadersJson),
    modelCatalogSourceId: row.modelCatalogSourceId === null || row.modelCatalogSourceId === undefined
      ? null
      : String(row.modelCatalogSourceId),
    authMode: row.authMode === 'api_key_header' || row.authMode === 'query' || row.authMode === 'custom'
      ? row.authMode
      : 'bearer',
    enabled: row.enabled !== false,
    priority: row.priority ?? 0,
    capabilityDefaults: parseCapabilityDefaults(row.capabilityDefaultsJson),
    compatibilityPolicyRef: row.compatibilityPolicyRef,
    metadata: parseJsonRecord(row.metadataJson),
  };
}

function rowToMatrixProfile(row: ApiEndpointProfileRow): CredentialEndpointMatrixProfile {
  return {
    ...rowToProfile(row),
    rowId: row.id,
    profileKey: row.profileKey,
  };
}

function rowToBinding(row: CredentialEndpointBindingRow): CredentialEndpointBinding {
  return {
    id: String(row.id),
    siteId: row.siteId,
    credentialId: row.credentialKey,
    apiEndpointProfileId: String(row.apiEndpointProfileId),
    enabled: row.enabled !== false,
    support: normalizeSupport(row.support),
    source: normalizeSource(row.source),
    priority: row.priority ?? 0,
    capabilityOverride: parseCapabilityOverride(row.capabilityOverrideJson),
    compatibilityPolicyRef: row.compatibilityPolicyRef,
    pricingPolicyRef: row.pricingPolicyRef,
    measuredPricingRef: row.measuredPricingRef,
    metadata: parseJsonRecord(row.metadataJson),
  };
}

function rowToObservation(row: EndpointModelObservationRow): EndpointModelObservation {
  return {
    siteId: row.siteId,
    credentialId: row.credentialKey,
    apiEndpointProfileId: String(row.apiEndpointProfileId),
    modelName: row.modelName,
    status: row.status === 'confirmed' || row.status === 'rejected' || row.status === 'transient_failure'
      ? row.status
      : 'transient_failure',
    failureClass: row.failureClass,
    observedAt: row.observedAt,
    expiresAt: row.expiresAt,
  };
}

function rowToCatalogSource(row: ModelCatalogSourceRow): ModelCatalogSourceSummary {
  return {
    id: row.id,
    sourceKey: row.sourceKey,
    label: row.label,
    discoveryMethod: row.discoveryMethod || 'GET',
    discoveryUrl: row.discoveryUrl || null,
    parser: row.parser || 'openai_models',
    credentialScope: row.credentialScope || 'credential',
    enabled: row.enabled !== false,
    lastRefreshAt: row.lastRefreshAt || null,
    lastModelCount: row.lastModelCount || 0,
    lastError: row.lastError || null,
  };
}

export function resolveCredentialEndpointKey(input: {
  accountId: number;
  tokenId?: number | null;
}): CredentialEndpointKey {
  const accountId = Math.trunc(input.accountId);
  const tokenId = Number.isFinite(Number(input.tokenId)) && Number(input.tokenId) > 0
    ? Math.trunc(Number(input.tokenId))
    : null;
  if (tokenId) {
    return {
      credentialKind: 'account_token',
      credentialKey: `account-token:${tokenId}`,
      accountId,
      tokenId,
    };
  }
  return {
    credentialKind: 'account',
    credentialKey: `account:${accountId}`,
    accountId,
    tokenId: null,
  };
}

export async function loadCredentialApiVariantConfig(input: {
  siteId: number;
  accountId: number;
  tokenId?: number | null;
  modelName?: string | null;
}): Promise<CredentialApiVariantConfig | null> {
  const credentialKey = resolveCredentialEndpointKey({
    accountId: input.accountId,
    tokenId: input.tokenId,
  });
  const [profileRows, bindingRows, observationRows] = await Promise.all([
    db.select().from(schema.apiEndpointProfiles)
      .where(eq(schema.apiEndpointProfiles.siteId, input.siteId))
      .orderBy(asc(schema.apiEndpointProfiles.priority), asc(schema.apiEndpointProfiles.id))
      .all(),
    db.select().from(schema.credentialEndpointBindings)
      .where(and(
        eq(schema.credentialEndpointBindings.siteId, input.siteId),
        eq(schema.credentialEndpointBindings.credentialKey, credentialKey.credentialKey),
      ))
      .orderBy(asc(schema.credentialEndpointBindings.priority), asc(schema.credentialEndpointBindings.id))
      .all(),
    String(input.modelName || '').trim()
      ? db.select().from(schema.endpointModelObservations)
        .where(and(
          eq(schema.endpointModelObservations.siteId, input.siteId),
          eq(schema.endpointModelObservations.credentialKey, credentialKey.credentialKey),
          eq(schema.endpointModelObservations.modelName, String(input.modelName || '').trim()),
        ))
        .all()
      : Promise.resolve([]),
  ]);

  if (profileRows.length === 0 || bindingRows.length === 0) {
    return null;
  }

  return {
    credentialKey,
    endpointProfiles: profileRows.map(rowToProfile),
    credentialEndpointBindings: bindingRows.map(rowToBinding),
    endpointModelObservations: observationRows.map(rowToObservation),
  };
}

export async function ensureDefaultApiEndpointProfilesForSite(siteId: number): Promise<ApiEndpointProfile[]> {
  const [site, existingRows] = await Promise.all([
    db.select().from(schema.sites).where(eq(schema.sites.id, siteId)).get(),
    db.select().from(schema.apiEndpointProfiles)
      .where(eq(schema.apiEndpointProfiles.siteId, siteId))
      .orderBy(asc(schema.apiEndpointProfiles.priority), asc(schema.apiEndpointProfiles.id))
      .all(),
  ]) as [typeof schema.sites.$inferSelect | undefined, ApiEndpointProfileRow[]];
  const existingKeys = new Set(existingRows.map((row) => row.profileKey));
  const inserts = DEFAULT_PROFILE_ENDPOINTS
    .map((endpoint, index) => {
      const apiType = apiTypeFromUpstreamEndpoint(endpoint);
      const profileKey = apiType;
      if (existingKeys.has(profileKey)) return null;
      return {
        siteId,
        profileKey,
        apiType,
        label: apiType,
        requestMethod: 'POST',
        requestUrl: defaultRequestUrlForUpstreamEndpoint({
          siteUrl: site?.url,
          endpoint,
        }),
        authMode: 'bearer',
        enabled: true,
        priority: index,
        capabilityDefaultsJson: JSON.stringify(DEFAULT_API_VARIANT_CAPABILITY),
      };
    })
    .filter((row): row is NonNullable<typeof row> => !!row);

  if (inserts.length > 0) {
    await db.insert(schema.apiEndpointProfiles).values(inserts).run();
  }

  const rowsMissingRequestUrl = existingRows
    .filter((row) => !String(row.requestUrl || '').trim());
  for (const row of rowsMissingRequestUrl) {
    const endpoint = DEFAULT_PROFILE_ENDPOINTS.find((candidate) => apiTypeFromUpstreamEndpoint(candidate) === row.apiType);
    if (!endpoint) continue;
    const requestUrl = defaultRequestUrlForUpstreamEndpoint({
      siteUrl: site?.url,
      endpoint,
    });
    if (!requestUrl) continue;
    await db.update(schema.apiEndpointProfiles)
      .set({
        requestUrl,
        requestMethod: row.requestMethod || 'POST',
      })
      .where(eq(schema.apiEndpointProfiles.id, row.id))
      .run();
  }

  const rows = await db.select().from(schema.apiEndpointProfiles)
    .where(eq(schema.apiEndpointProfiles.siteId, siteId))
    .orderBy(asc(schema.apiEndpointProfiles.priority), asc(schema.apiEndpointProfiles.id))
    .all();
  return rows.map(rowToProfile);
}

async function loadDefaultApiEndpointProfileRows(siteId: number): Promise<ApiEndpointProfileRow[]> {
  await ensureDefaultApiEndpointProfilesForSite(siteId);
  return db.select().from(schema.apiEndpointProfiles)
    .where(eq(schema.apiEndpointProfiles.siteId, siteId))
    .orderBy(asc(schema.apiEndpointProfiles.priority), asc(schema.apiEndpointProfiles.id))
    .all();
}

function formatAccountCredentialLabel(account: typeof schema.accounts.$inferSelect): string {
  const username = typeof account.username === 'string' && account.username.trim()
    ? account.username.trim()
    : `Account ${account.id}`;
  return username;
}

function formatTokenCredentialLabel(token: typeof schema.accountTokens.$inferSelect): string {
  const name = typeof token.name === 'string' && token.name.trim()
    ? token.name.trim()
    : `Token ${token.id}`;
  return name;
}

function defaultMatrixBinding(profileId: number, priority: number): CredentialEndpointMatrixBinding {
  return {
    id: null,
    apiEndpointProfileId: profileId,
    enabled: true,
    support: 'supported',
    source: 'default',
    priority,
    persisted: false,
  };
}

export async function listCredentialEndpointMatrix(siteId: number): Promise<CredentialEndpointMatrix> {
  const [profileRows, catalogSourceRows, accountRows, tokenRows, bindingRows] = await Promise.all([
    loadDefaultApiEndpointProfileRows(siteId),
    ensureDefaultModelCatalogSourcesForSite(siteId),
    db.select().from(schema.accounts)
      .where(eq(schema.accounts.siteId, siteId))
      .orderBy(asc(schema.accounts.sortOrder), asc(schema.accounts.id))
      .all(),
    db.select({
      token: schema.accountTokens,
      account: schema.accounts,
    }).from(schema.accountTokens)
      .innerJoin(schema.accounts, eq(schema.accountTokens.accountId, schema.accounts.id))
      .where(eq(schema.accounts.siteId, siteId))
      .orderBy(asc(schema.accounts.sortOrder), asc(schema.accountTokens.id))
      .all(),
    db.select().from(schema.credentialEndpointBindings)
      .where(eq(schema.credentialEndpointBindings.siteId, siteId))
      .orderBy(asc(schema.credentialEndpointBindings.priority), asc(schema.credentialEndpointBindings.id))
      .all(),
  ]);

  const profiles = profileRows.map(rowToMatrixProfile);
  const profileIds = profileRows.map((row) => row.id);
  const bindingByCredentialAndProfile = new Map<string, CredentialEndpointBindingRow>();
  for (const binding of bindingRows) {
    bindingByCredentialAndProfile.set(`${binding.credentialKey}:${binding.apiEndpointProfileId}`, binding);
  }

  const credentials: CredentialEndpointMatrixCredential[] = [];
  for (const account of accountRows) {
    const key = resolveCredentialEndpointKey({ accountId: account.id });
    credentials.push({
      ...key,
      label: formatAccountCredentialLabel(account),
      detail: account.apiToken ? 'account api key' : account.oauthProvider ? `oauth:${account.oauthProvider}` : 'account credential',
      bindings: profileIds.map((profileId, index) => {
        const persisted = bindingByCredentialAndProfile.get(`${key.credentialKey}:${profileId}`);
        return persisted
          ? {
              id: persisted.id,
              apiEndpointProfileId: profileId,
              enabled: persisted.enabled !== false,
              support: normalizeSupport(persisted.support),
              source: normalizeSource(persisted.source),
              priority: persisted.priority ?? index,
              persisted: true,
            }
          : defaultMatrixBinding(profileId, index);
      }),
    });
  }

  for (const row of tokenRows) {
    const key = resolveCredentialEndpointKey({
      accountId: row.account.id,
      tokenId: row.token.id,
    });
    credentials.push({
      ...key,
      label: formatTokenCredentialLabel(row.token),
      detail: formatAccountCredentialLabel(row.account),
      bindings: profileIds.map((profileId, index) => {
        const persisted = bindingByCredentialAndProfile.get(`${key.credentialKey}:${profileId}`);
        return persisted
          ? {
              id: persisted.id,
              apiEndpointProfileId: profileId,
              enabled: persisted.enabled !== false,
              support: normalizeSupport(persisted.support),
              source: normalizeSource(persisted.source),
              priority: persisted.priority ?? index,
              persisted: true,
            }
          : defaultMatrixBinding(profileId, index);
      }),
    });
  }

  return {
    siteId,
    profiles,
    catalogSources: catalogSourceRows.map(rowToCatalogSource),
    credentials,
  };
}

function validateProfileRequestUrl(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Endpoint request URL must be an absolute HTTP URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Endpoint request URL must use HTTP or HTTPS.');
  }
  return parsed.toString();
}

function normalizeDefaultHeaders(input: Record<string, string> | null | undefined): string | null {
  if (!input) return null;
  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = rawName.trim();
    const value = String(rawValue ?? '').trim();
    if (!name && !value) continue;
    if (!name) throw new Error('Header name is required.');
    if (/[\r\n:]/.test(name)) throw new Error(`Invalid header name: ${name}`);
    headers[name] = value;
  }
  return Object.keys(headers).length > 0 ? JSON.stringify(headers) : null;
}

export async function updateApiEndpointProfiles(input: {
  siteId: number;
  profiles: ApiEndpointProfileUpdate[];
}): Promise<CredentialEndpointMatrix> {
  const profileRows = await loadDefaultApiEndpointProfileRows(input.siteId);
  const profileIds = new Set(profileRows.map((row) => row.id));
  const catalogSources = await ensureDefaultModelCatalogSourcesForSite(input.siteId);
  const catalogSourceIds = new Set(catalogSources.map((row) => row.id));

  await db.transaction(async (tx: any) => {
    for (const profile of input.profiles) {
      const id = Math.trunc(Number(profile.id));
      if (!profileIds.has(id)) {
        throw new Error(`Endpoint profile ${profile.id} does not belong to this site.`);
      }
      if (profile.modelCatalogSourceId != null && !catalogSourceIds.has(Math.trunc(Number(profile.modelCatalogSourceId)))) {
        throw new Error(`Model catalog source ${profile.modelCatalogSourceId} does not belong to this site.`);
      }
      const patch: Partial<typeof schema.apiEndpointProfiles.$inferInsert> = {
        updatedAt: new Date().toISOString(),
      };
      if (profile.label !== undefined) {
        const label = String(profile.label || '').trim();
        if (!label) throw new Error('Endpoint profile label is required.');
        patch.label = label;
      }
      if (profile.requestMethod !== undefined) {
        patch.requestMethod = profile.requestMethod === 'GET' ? 'GET' : 'POST';
      }
      if (profile.requestUrl !== undefined) {
        patch.requestUrl = validateProfileRequestUrl(profile.requestUrl);
      }
      if (profile.defaultHeaders !== undefined) {
        patch.defaultHeadersJson = normalizeDefaultHeaders(profile.defaultHeaders);
      }
      if (profile.modelCatalogSourceId !== undefined) {
        patch.modelCatalogSourceId = profile.modelCatalogSourceId == null
          ? null
          : Math.trunc(Number(profile.modelCatalogSourceId));
      }
      if (profile.enabled !== undefined) {
        patch.enabled = profile.enabled !== false;
      }
      if (profile.priority !== undefined) {
        const priority = Number(profile.priority);
        if (!Number.isFinite(priority)) throw new Error('Endpoint profile priority must be a number.');
        patch.priority = Math.trunc(priority);
      }
      await tx.update(schema.apiEndpointProfiles)
        .set(patch)
        .where(and(
          eq(schema.apiEndpointProfiles.siteId, input.siteId),
          eq(schema.apiEndpointProfiles.id, id),
        ))
        .run();
    }
  });

  return listCredentialEndpointMatrix(input.siteId);
}

async function resolveCredentialKeyForSite(siteId: number, credentialKey: string): Promise<CredentialEndpointKey | null> {
  const accountMatch = /^account:(\d+)$/.exec(credentialKey);
  if (accountMatch) {
    const accountId = Number.parseInt(accountMatch[1] || '', 10);
    const account = await db.select().from(schema.accounts)
      .where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.siteId, siteId)))
      .get();
    return account ? resolveCredentialEndpointKey({ accountId }) : null;
  }

  const tokenMatch = /^account-token:(\d+)$/.exec(credentialKey);
  if (tokenMatch) {
    const tokenId = Number.parseInt(tokenMatch[1] || '', 10);
    const row = await db.select({
      token: schema.accountTokens,
      account: schema.accounts,
    }).from(schema.accountTokens)
      .innerJoin(schema.accounts, eq(schema.accountTokens.accountId, schema.accounts.id))
      .where(and(eq(schema.accountTokens.id, tokenId), eq(schema.accounts.siteId, siteId)))
      .get();
    return row ? resolveCredentialEndpointKey({ accountId: row.account.id, tokenId: row.token.id }) : null;
  }

  return null;
}

export async function replaceCredentialEndpointBindings(input: {
  siteId: number;
  credentialKey: string;
  bindings: CredentialEndpointBindingUpdate[];
}): Promise<CredentialEndpointMatrix> {
  const credential = await resolveCredentialKeyForSite(input.siteId, input.credentialKey);
  if (!credential) {
    throw new Error('Credential does not belong to this site.');
  }

  const profileRows = await loadDefaultApiEndpointProfileRows(input.siteId);
  const profileIds = new Set(profileRows.map((row) => row.id));
  for (const binding of input.bindings) {
    if (!profileIds.has(Number(binding.apiEndpointProfileId))) {
      throw new Error(`Endpoint profile ${binding.apiEndpointProfileId} does not belong to this site.`);
    }
  }
  const normalizedBindings = input.bindings
    .map((binding, index) => ({
      siteId: input.siteId,
      accountId: credential.accountId,
      tokenId: credential.tokenId,
      credentialKey: credential.credentialKey,
      credentialKind: credential.credentialKind,
      apiEndpointProfileId: Math.trunc(Number(binding.apiEndpointProfileId)),
      enabled: binding.enabled !== false,
      support: normalizeSupport(binding.support),
      source: 'manual',
      priority: Number.isFinite(Number(binding.priority)) ? Math.trunc(Number(binding.priority)) : index,
    }));

  await db.transaction(async (tx: any) => {
    await tx.delete(schema.credentialEndpointBindings)
      .where(and(
        eq(schema.credentialEndpointBindings.siteId, input.siteId),
        eq(schema.credentialEndpointBindings.credentialKey, credential.credentialKey),
      ))
      .run();
    if (normalizedBindings.length > 0) {
      await tx.insert(schema.credentialEndpointBindings).values(normalizedBindings).run();
    }
  });

  return listCredentialEndpointMatrix(input.siteId);
}
