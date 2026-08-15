import { and, eq, inArray, ne } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getInsertedRowId } from '../db/insertHelpers.js';

type UpstreamApiToken = {
  name?: string | null;
  key?: string | null;
  enabled?: boolean | null;
  tokenGroup?: string | null;
  extraConfig?: string | null;
};

export type AccountTokenRow = typeof schema.accountTokens.$inferSelect;
export type AccountTokenOwnerRow = {
  token: AccountTokenRow;
  account: typeof schema.accounts.$inferSelect;
  site: typeof schema.sites.$inferSelect;
};

export const ACCOUNT_TOKEN_VALUE_STATUS_READY = 'ready' as const;
export const ACCOUNT_TOKEN_VALUE_STATUS_MASKED_PENDING = 'masked_pending' as const;
export type AccountTokenValueStatus =
  | typeof ACCOUNT_TOKEN_VALUE_STATUS_READY
  | typeof ACCOUNT_TOKEN_VALUE_STATUS_MASKED_PENDING;

export function normalizeTokenForDisplay(token?: string | null, platform?: string | null): string {
  if (!token) return '';
  const value = token.trim();
  if (platform !== undefined) {
    // Keep the parameter for route-level compatibility. Token values are opaque
    // credentials and must never be rewritten based on a platform convention.
  }
  return value;
}

export function maskToken(token?: string | null, platform?: string | null): string {
  const value = normalizeTokenForDisplay(token, platform);
  if (!value) return '';
  if (value.toLowerCase().startsWith('sk-')) {
    if (value.length <= 7) return 'sk-***';
    const visibleMiddle = value.slice(3, Math.min(6, value.length));
    if (value.length <= 12) return `sk-${visibleMiddle}***${value.slice(-2)}`;
    return `sk-${visibleMiddle}***${value.slice(-4)}`;
  }
  if (value.length <= 10) return `${value.slice(0, 2)}***${value.slice(-2)}`;
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function normalizeTokenName(name: string | null | undefined, fallbackIndex = 1): string {
  const trimmed = (name || '').trim();
  if (trimmed) return trimmed;
  return fallbackIndex === 1 ? 'default' : `token-${fallbackIndex}`;
}

function normalizeTokenValue(token: string | null | undefined): string | null {
  const trimmed = (token || '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isMaskedTokenValue(token: string | null | undefined): boolean {
  const value = (token || '').trim();
  if (!value) return false;
  return value.includes('*') || value.includes('•');
}

function normalizeMaskedTokenForCompare(token: string | null | undefined): string {
  return normalizeTokenForDisplay(token).replace(/•/g, '*');
}

function matchesMaskedTokenValue(
  fullToken: string | null | undefined,
  maskedToken: string | null | undefined,
): boolean {
  const normalizedFull = normalizeTokenForDisplay(fullToken);
  const normalizedMasked = normalizeMaskedTokenForCompare(maskedToken);
  if (!normalizedFull || !normalizedMasked) return false;

  if (!isMaskedTokenValue(normalizedMasked)) {
    return normalizedFull === normalizedMasked;
  }

  const firstMaskIndex = normalizedMasked.search(/[\*]/);
  const lastMaskIndex = Math.max(
    normalizedMasked.lastIndexOf('*'),
    normalizedMasked.lastIndexOf('•'),
  );
  if (firstMaskIndex < 0 || lastMaskIndex < firstMaskIndex) {
    return normalizedFull === normalizedMasked;
  }

  const prefix = normalizedMasked.slice(0, firstMaskIndex);
  const suffix = normalizedMasked.slice(lastMaskIndex + 1);
  const visiblePrefix = prefix.replace(/^sk-/i, '');
  if (!visiblePrefix && !suffix) return false;
  if (normalizedFull.length < prefix.length + suffix.length) return false;
  if (prefix && !normalizedFull.startsWith(prefix)) return false;
  if (suffix && !normalizedFull.endsWith(suffix)) return false;
  return true;
}

function normalizeTokenValueStatus(value: string | null | undefined): AccountTokenValueStatus {
  const normalized = (value || '').trim().toLowerCase();
  return normalized === ACCOUNT_TOKEN_VALUE_STATUS_MASKED_PENDING
    ? ACCOUNT_TOKEN_VALUE_STATUS_MASKED_PENDING
    : ACCOUNT_TOKEN_VALUE_STATUS_READY;
}

export function resolveAccountTokenValueStatus(
  value: Pick<AccountTokenRow, 'token' | 'valueStatus'> | string | null | undefined,
): AccountTokenValueStatus {
  if (typeof value === 'string' || value == null) {
    return normalizeTokenValueStatus(value);
  }

  const explicit = normalizeTokenValueStatus(value.valueStatus);
  if (explicit === ACCOUNT_TOKEN_VALUE_STATUS_MASKED_PENDING) {
    return ACCOUNT_TOKEN_VALUE_STATUS_MASKED_PENDING;
  }
  return isMaskedTokenValue(value.token)
    ? ACCOUNT_TOKEN_VALUE_STATUS_MASKED_PENDING
    : ACCOUNT_TOKEN_VALUE_STATUS_READY;
}

export function isReadyAccountToken(token: Pick<AccountTokenRow, 'token' | 'valueStatus'> | null | undefined): boolean {
  if (!token) return false;
  return resolveAccountTokenValueStatus(token) === ACCOUNT_TOKEN_VALUE_STATUS_READY
    && !isMaskedTokenValue(token.token);
}

export function isMaskedPendingAccountToken(token: Pick<AccountTokenRow, 'token' | 'valueStatus'> | null | undefined): boolean {
  if (!token) return false;
  return resolveAccountTokenValueStatus(token) === ACCOUNT_TOKEN_VALUE_STATUS_MASKED_PENDING;
}

export function isUsableAccountToken(token: AccountTokenRow | null | undefined): boolean {
  if (!token) return false;
  return token.enabled === true && isReadyAccountToken(token);
}

function normalizeTokenGroup(value: string | null | undefined, tokenName?: string | null): string | null {
  const explicit = (value || '').trim();
  if (explicit.length > 0) return explicit;

  const name = (tokenName || '').trim();
  if (!name) return null;
  const normalized = name.toLowerCase();
  if (normalized === 'default' || normalized === '默认' || /^default($|[-_\s])/.test(normalized)) {
    return 'default';
  }
  if (/^token-\d+$/.test(normalized)) return null;
  return name;
}

function sameTokenGroup(
  leftGroup: string | null | undefined,
  leftName: string | null | undefined,
  rightGroup: string | null | undefined,
  rightName: string | null | undefined,
): boolean {
  return normalizeTokenGroup(leftGroup, leftName) === normalizeTokenGroup(rightGroup, rightName);
}

export type AccountTokenDb = typeof db;

export async function listAccountTokens(
  accountId: number,
  database: AccountTokenDb = db,
): Promise<AccountTokenRow[]> {
  return database.select()
    .from(schema.accountTokens)
    .where(eq(schema.accountTokens.accountId, accountId))
    .all();
}

export async function listAllAccountTokens(
  database: AccountTokenDb = db,
): Promise<AccountTokenRow[]> {
  return database.select().from(schema.accountTokens).all();
}

export async function listUsableAccountTokens(
  accountId: number,
  database: AccountTokenDb = db,
): Promise<AccountTokenRow[]> {
  const rows = await database.select()
    .from(schema.accountTokens)
    .where(and(
      eq(schema.accountTokens.accountId, accountId),
      eq(schema.accountTokens.enabled, true),
      eq(schema.accountTokens.valueStatus, ACCOUNT_TOKEN_VALUE_STATUS_READY),
    ))
    .all();
  return rows.filter(isUsableAccountToken);
}

export async function getAccountTokenById(
  tokenId: number,
  database: AccountTokenDb = db,
): Promise<AccountTokenRow | null> {
  return await database.select()
    .from(schema.accountTokens)
    .where(eq(schema.accountTokens.id, tokenId))
    .get() ?? null;
}

export async function listAccountTokensByIds(
  tokenIds: number[],
  database: AccountTokenDb = db,
): Promise<AccountTokenRow[]> {
  const ids = Array.from(new Set(tokenIds.filter((id) => Number.isSafeInteger(id) && id > 0)));
  if (ids.length === 0) return [];
  return database.select()
    .from(schema.accountTokens)
    .where(inArray(schema.accountTokens.id, ids))
    .all();
}

export async function getAccountTokenWithOwner(
  tokenId: number,
  database: AccountTokenDb = db,
): Promise<AccountTokenOwnerRow | null> {
  const row = await database.select({
    token: schema.accountTokens,
    account: schema.accounts,
    site: schema.sites,
  })
    .from(schema.accountTokens)
    .innerJoin(schema.accounts, eq(schema.accountTokens.accountId, schema.accounts.id))
    .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .where(eq(schema.accountTokens.id, tokenId))
    .get();
  return row ?? null;
}

export async function listAvailableModelTokenCredentials(): Promise<Array<{
  modelName: string;
  accountId: number;
  siteId: number;
  accountCredential: string;
  accountCredentialMode: string;
  accountExtraConfig: string | null;
  accountOauthProvider: string | null;
  tokenId: number;
  token: string;
  tokenEnabled: boolean | null;
  tokenValueStatus: string;
}>> {
  const rows = await db.select({
    modelName: schema.tokenModelAvailability.modelName,
    accountId: schema.accounts.id,
    siteId: schema.accounts.siteId,
    accountCredential: schema.accounts.credential,
    accountCredentialMode: schema.accounts.credentialMode,
    accountExtraConfig: schema.accounts.extraConfig,
    accountOauthProvider: schema.accounts.oauthProvider,
    tokenId: schema.accountTokens.id,
    token: schema.accountTokens.token,
    tokenEnabled: schema.accountTokens.enabled,
    tokenValueStatus: schema.accountTokens.valueStatus,
  }).from(schema.tokenModelAvailability)
    .innerJoin(schema.accountTokens, eq(schema.tokenModelAvailability.tokenId, schema.accountTokens.id))
    .innerJoin(schema.accounts, eq(schema.accountTokens.accountId, schema.accounts.id))
    .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .where(and(
      eq(schema.tokenModelAvailability.available, true),
      eq(schema.accountTokens.enabled, true),
      eq(schema.accountTokens.valueStatus, ACCOUNT_TOKEN_VALUE_STATUS_READY),
      eq(schema.accounts.status, 'active'),
      eq(schema.sites.status, 'active'),
    ))
    .all();
  return rows.filter((row) => isUsableAccountToken({
    enabled: row.tokenEnabled,
    token: row.token,
    valueStatus: row.tokenValueStatus,
  } as AccountTokenRow));
}

export async function getPreferredAccountToken(accountId: number) {
  const usableTokens = await listUsableAccountTokens(accountId);
  if (usableTokens.length === 0) return null;

  const preferred = usableTokens.find((t) => t.isDefault) || usableTokens[0];
  return preferred;
}

export async function ensureDefaultTokenForAccount(
  accountId: number,
  tokenValue: string,
  options?: { name?: string; source?: string; enabled?: boolean; tokenGroup?: string | null },
): Promise<number | null> {
  const normalizedToken = normalizeTokenValue(tokenValue);
  if (!normalizedToken) return null;
  if (isMaskedTokenValue(normalizedToken)) return null;
  const tokenGroup = normalizeTokenGroup(options?.tokenGroup, options?.name) || 'default';

  return db.transaction(async (tx: AccountTokenDb) => {
    const now = new Date().toISOString();
    const tokens = await listAccountTokens(accountId, tx);

    let target = tokens.find((t) => t.token === normalizedToken) || null;
    if (!target) {
      const inserted = await tx.insert(schema.accountTokens)
        .values({
          accountId,
          name: normalizeTokenName(options?.name, tokens.length + 1),
          token: normalizedToken,
          tokenGroup,
          valueStatus: ACCOUNT_TOKEN_VALUE_STATUS_READY,
          source: options?.source || 'manual',
          enabled: options?.enabled ?? true,
          isDefault: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      const insertedId = getInsertedRowId(inserted);
      target = insertedId != null
        ? await getAccountTokenById(insertedId, tx)
        : null;
      if (!target) return null;
    } else {
      await tx.update(schema.accountTokens)
        .set({
          name: options?.name ? normalizeTokenName(options.name) : target.name,
          tokenGroup,
          valueStatus: ACCOUNT_TOKEN_VALUE_STATUS_READY,
          source: options?.source || target.source || 'manual',
          enabled: options?.enabled ?? target.enabled,
          isDefault: true,
          updatedAt: now,
        })
        .where(eq(schema.accountTokens.id, target.id))
        .run();
    }

    await tx.update(schema.accountTokens)
      .set({ isDefault: false, updatedAt: now })
      .where(and(eq(schema.accountTokens.accountId, accountId), ne(schema.accountTokens.id, target.id)))
      .run();

    return target.id;
  });
}

export async function setDefaultToken(tokenId: number): Promise<boolean> {
  return db.transaction(async (tx: AccountTokenDb) => {
    const target = await getAccountTokenById(tokenId, tx);
    if (!target || !isUsableAccountToken(target)) return false;
    const now = new Date().toISOString();
    await tx.update(schema.accountTokens)
      .set({ isDefault: false, updatedAt: now })
      .where(eq(schema.accountTokens.accountId, target.accountId))
      .run();

    await tx.update(schema.accountTokens)
      .set({ isDefault: true, enabled: true, updatedAt: now })
      .where(eq(schema.accountTokens.id, tokenId))
      .run();

    return true;
  });
}

export async function repairDefaultToken(accountId: number) {
  return db.transaction(async (tx: AccountTokenDb) => {
    const tokens = await listAccountTokens(accountId, tx);

    const enabled = tokens.filter(isUsableAccountToken);
    if (enabled.length === 0) {
      return null;
    }

    const currentDefault = enabled.find((t) => t.isDefault) || enabled[0];
    const now = new Date().toISOString();

    await tx.update(schema.accountTokens)
      .set({ isDefault: false, updatedAt: now })
      .where(eq(schema.accountTokens.accountId, accountId))
      .run();

    await tx.update(schema.accountTokens)
      .set({ isDefault: true, enabled: true, updatedAt: now })
      .where(eq(schema.accountTokens.id, currentDefault.id))
      .run();

    return currentDefault;
  });
}

export async function syncTokensFromUpstream(accountId: number, upstreamTokens: UpstreamApiToken[]) {
  const now = new Date().toISOString();
  const existing = await listAccountTokens(accountId);

  let created = 0;
  let updated = 0;
  let maskedPending = 0;
  const pendingTokenIds: number[] = [];
  let index = existing.length + 1;

  for (const upstream of upstreamTokens) {
    const tokenValue = normalizeTokenValue(upstream.key);
    if (!tokenValue) continue;
    const tokenName = normalizeTokenName(upstream.name, index);
    const enabled = upstream.enabled ?? true;
    const tokenGroup = normalizeTokenGroup(upstream.tokenGroup, tokenName);
    const extraConfig = upstream.extraConfig ?? null;
    const nextValueStatus = isMaskedTokenValue(tokenValue)
      ? ACCOUNT_TOKEN_VALUE_STATUS_MASKED_PENDING
      : ACCOUNT_TOKEN_VALUE_STATUS_READY;

    const byToken = existing.find((row) => (
      row.token === tokenValue
      && resolveAccountTokenValueStatus(row) === ACCOUNT_TOKEN_VALUE_STATUS_READY
    ));
    if (byToken) {
      await db.update(schema.accountTokens)
        .set({
          name: tokenName,
          tokenGroup,
          extraConfig,
          valueStatus: ACCOUNT_TOKEN_VALUE_STATUS_READY,
          source: 'sync',
          enabled,
          updatedAt: now,
        })
        .where(eq(schema.accountTokens.id, byToken.id))
        .run();
      byToken.name = tokenName;
      byToken.tokenGroup = tokenGroup;
      byToken.extraConfig = extraConfig;
      byToken.valueStatus = ACCOUNT_TOKEN_VALUE_STATUS_READY;
      byToken.enabled = enabled;
      byToken.source = 'sync';
      byToken.updatedAt = now;
      updated++;
      continue;
    }

    const matchingReadyByMaskedValue = nextValueStatus === ACCOUNT_TOKEN_VALUE_STATUS_MASKED_PENDING
      ? existing.filter((row) => (
        resolveAccountTokenValueStatus(row) === ACCOUNT_TOKEN_VALUE_STATUS_READY
        && matchesMaskedTokenValue(row.token, tokenValue)
        && row.name === tokenName
        && sameTokenGroup(row.tokenGroup, row.name, tokenGroup, tokenName)
      ))
      : [];
    const readyMaskedMatch = matchingReadyByMaskedValue.length === 1
      ? matchingReadyByMaskedValue[0]
      : null;
    if (readyMaskedMatch) {
      const staleMaskedPlaceholders = existing.filter((row) => (
        row.id !== readyMaskedMatch.id
        && resolveAccountTokenValueStatus(row) === ACCOUNT_TOKEN_VALUE_STATUS_MASKED_PENDING
        && matchesMaskedTokenValue(row.token, tokenValue)
        && row.name === tokenName
        && sameTokenGroup(row.tokenGroup, row.name, tokenGroup, tokenName)
      ));

      await db.update(schema.accountTokens)
        .set({
          name: tokenName,
          tokenGroup,
          extraConfig,
          valueStatus: ACCOUNT_TOKEN_VALUE_STATUS_READY,
          source: 'sync',
          enabled,
          updatedAt: now,
        })
        .where(eq(schema.accountTokens.id, readyMaskedMatch.id))
        .run();
      readyMaskedMatch.name = tokenName;
      readyMaskedMatch.tokenGroup = tokenGroup;
      readyMaskedMatch.extraConfig = extraConfig;
      readyMaskedMatch.valueStatus = ACCOUNT_TOKEN_VALUE_STATUS_READY;
      readyMaskedMatch.enabled = enabled;
      readyMaskedMatch.source = 'sync';
      readyMaskedMatch.updatedAt = now;

      if (staleMaskedPlaceholders.length > 0) {
        for (const placeholder of staleMaskedPlaceholders) {
          await db.delete(schema.accountTokens)
            .where(eq(schema.accountTokens.id, placeholder.id))
            .run();
        }
        for (const placeholder of staleMaskedPlaceholders) {
          const placeholderIndex = existing.findIndex((row) => row.id === placeholder.id);
          if (placeholderIndex >= 0) {
            existing.splice(placeholderIndex, 1);
          }
        }
      }

      updated++;
      continue;
    }

    const matchingPlaceholder = existing.find((row) => (
      isMaskedPendingAccountToken(row)
      && row.name === tokenName
      && sameTokenGroup(row.tokenGroup, row.name, tokenGroup, tokenName)
    ));

    if (matchingPlaceholder) {
      const nextEnabled = nextValueStatus === ACCOUNT_TOKEN_VALUE_STATUS_READY ? enabled : false;
      await db.update(schema.accountTokens)
        .set({
          name: tokenName,
          token: tokenValue,
          tokenGroup,
          extraConfig,
          valueStatus: nextValueStatus,
          source: 'sync',
          enabled: nextEnabled,
          isDefault: false,
          updatedAt: now,
        })
        .where(eq(schema.accountTokens.id, matchingPlaceholder.id))
        .run();
      matchingPlaceholder.name = tokenName;
      matchingPlaceholder.token = tokenValue;
      matchingPlaceholder.tokenGroup = tokenGroup;
      matchingPlaceholder.extraConfig = extraConfig;
      matchingPlaceholder.valueStatus = nextValueStatus;
      matchingPlaceholder.source = 'sync';
      matchingPlaceholder.enabled = nextEnabled;
      matchingPlaceholder.isDefault = false;
      matchingPlaceholder.updatedAt = now;
      updated++;
      if (nextValueStatus === ACCOUNT_TOKEN_VALUE_STATUS_MASKED_PENDING) {
        maskedPending++;
        pendingTokenIds.push(matchingPlaceholder.id);
      }
      continue;
    }

    const inserted = await db.insert(schema.accountTokens)
      .values({
        accountId,
        name: tokenName,
        token: tokenValue,
        tokenGroup,
        extraConfig,
        valueStatus: nextValueStatus,
        source: 'sync',
        enabled: nextValueStatus === ACCOUNT_TOKEN_VALUE_STATUS_READY ? enabled : false,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const insertedId = getInsertedRowId(inserted);
    if (insertedId == null) continue;
    const createdRow = await getAccountTokenById(insertedId);
    if (!createdRow) continue;

    existing.push(createdRow);
    created++;
    index++;
    if (nextValueStatus === ACCOUNT_TOKEN_VALUE_STATUS_MASKED_PENDING) {
      maskedPending++;
      pendingTokenIds.push(createdRow.id);
    }
  }

  const repaired = await repairDefaultToken(accountId);

  return {
    created,
    updated,
    maskedPending,
    pendingTokenIds,
    total: existing.length,
    defaultTokenId: repaired?.id || null,
  };
}

export async function listTokensWithRelations(accountId?: number) {
  const base = db.select()
    .from(schema.accountTokens)
    .innerJoin(schema.accounts, eq(schema.accountTokens.accountId, schema.accounts.id))
    .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .leftJoin(schema.accountTokenHealth, eq(schema.accountTokens.id, schema.accountTokenHealth.tokenId));

  const rows = accountId
    ? await base.where(eq(schema.accountTokens.accountId, accountId)).all()
    : await base.all();

  return rows.map((row) => {
    const { token, ...tokenMeta } = row.account_tokens;
    return {
      ...tokenMeta,
      valueStatus: resolveAccountTokenValueStatus(row.account_tokens),
      tokenMasked: maskToken(token, row.sites.platform),
      health: row.account_token_health ? {
        state: row.account_token_health.state,
        reason: row.account_token_health.reason,
        source: row.account_token_health.source,
        checkedAt: row.account_token_health.checkedAt,
      } : null,
      account: {
        id: row.accounts.id,
        username: row.accounts.username,
        status: row.accounts.status,
      },
      site: {
        id: row.sites.id,
        name: row.sites.name,
        url: row.sites.url,
        platform: row.sites.platform,
      },
    };
    });
}

export type AccountTokenAvailableModels = {
  token: Pick<AccountTokenRow, 'id' | 'accountId' | 'name' | 'tokenGroup' | 'enabled' | 'isDefault'>;
  account: {
    id: number;
    username: string | null;
  };
  site: {
    id: number;
    name: string;
  };
  observed: boolean;
  modelDetails: Array<{
    name: string;
    available: boolean;
    latencyMs: number | null;
    checkedAt: string | null;
    disabled: boolean;
    siteDisabled: boolean;
    tokenDisabled: boolean;
    isManual: boolean;
  }>;
  models: string[];
};

/**
 * Returns the models that can be priced for one concrete upstream token.
 * Token observations take precedence once present; otherwise account coverage
 * remains the authoritative fallback until that token has been probed.
 */
export async function getAvailableModelsForAccountToken(tokenId: number): Promise<AccountTokenAvailableModels | null> {
  const row = await db.select()
    .from(schema.accountTokens)
    .innerJoin(schema.accounts, eq(schema.accountTokens.accountId, schema.accounts.id))
    .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .where(eq(schema.accountTokens.id, tokenId))
    .get();
  if (!row) return null;

  const [tokenCoverage, accountCoverage, disabledRows, tokenDisabledRows] = await Promise.all([
    db.select({
      modelName: schema.tokenModelAvailability.modelName,
      available: schema.tokenModelAvailability.available,
      isManual: schema.tokenModelAvailability.isManual,
      latencyMs: schema.tokenModelAvailability.latencyMs,
      checkedAt: schema.tokenModelAvailability.checkedAt,
    })
      .from(schema.tokenModelAvailability)
      .where(eq(schema.tokenModelAvailability.tokenId, tokenId))
      .all(),
    db.select({
      modelName: schema.modelAvailability.modelName,
      available: schema.modelAvailability.available,
      isManual: schema.modelAvailability.isManual,
      latencyMs: schema.modelAvailability.latencyMs,
      checkedAt: schema.modelAvailability.checkedAt,
    })
      .from(schema.modelAvailability)
      .where(eq(schema.modelAvailability.accountId, row.accounts.id))
      .all(),
    db.select({ modelName: schema.siteDisabledModels.modelName })
      .from(schema.siteDisabledModels)
      .where(eq(schema.siteDisabledModels.siteId, row.sites.id))
      .all(),
    db.select({ modelName: schema.tokenDisabledModels.modelName })
      .from(schema.tokenDisabledModels)
      .where(eq(schema.tokenDisabledModels.tokenId, tokenId))
      .all(),
  ]);
  const observed = tokenCoverage.length > 0;
  const coverage = observed ? tokenCoverage : accountCoverage;
  const siteDisabledModels = new Set<string>(disabledRows.map((item) => item.modelName));
  const tokenDisabledModels = new Set<string>(tokenDisabledRows.map((item) => item.modelName));
  const modelDetails = coverage.map((item) => ({
    name: item.modelName,
    available: item.available === true,
    latencyMs: item.latencyMs ?? null,
    checkedAt: item.checkedAt ?? null,
    siteDisabled: siteDisabledModels.has(item.modelName),
    tokenDisabled: tokenDisabledModels.has(item.modelName),
    disabled: siteDisabledModels.has(item.modelName) || tokenDisabledModels.has(item.modelName),
    isManual: item.isManual === true,
  }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const models = modelDetails
    .filter((item) => item.available && !item.disabled)
    .map((item) => item.name);

  return {
    token: {
      id: row.account_tokens.id,
      accountId: row.account_tokens.accountId,
      name: row.account_tokens.name,
      tokenGroup: row.account_tokens.tokenGroup,
      enabled: row.account_tokens.enabled,
      isDefault: row.account_tokens.isDefault,
    },
    account: {
      id: row.accounts.id,
      username: row.accounts.username,
    },
    site: {
      id: row.sites.id,
      name: row.sites.name,
    },
    observed,
    modelDetails,
    models,
  };
}
