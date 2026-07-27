import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { insertAndGetById } from '../db/insertHelpers.js';
import { db, schema } from '../db/index.js';

export type WalletAcquisitionScope = 'site' | 'account' | 'token';
export type WalletAcquisitionInheritance = 'inherit' | 'override' | 'disabled';
export type DailyEarnedBalanceSource = 'manual' | 'observed_checkin' | 'mixed' | 'none';
export type WalletAcquisitionConfidence = 'exact' | 'estimated' | 'incomplete';

export type WalletAcquisitionSubject = {
  siteId: number;
  accountId?: number | null;
  tokenId?: number | null;
  tokenGroup?: string | null;
  walletUnit?: string | null;
};

export type WalletAcquisitionProfile = {
  id: number;
  scope: WalletAcquisitionScope;
  scopeKey: string;
  siteId: number;
  accountId: number | null;
  tokenId: number | null;
  inheritance: WalletAcquisitionInheritance;
  walletUnit: string;
  faceValuePrice: number | null;
  rechargeDiscount: number;
  dailyEarnedBalance: number | null;
  dailyEarnedBalanceSource: DailyEarnedBalanceSource;
  observedWindowDays: number | null;
  confidence: WalletAcquisitionConfidence;
  enabled: boolean;
  notes: string | null;
};

export type WalletAcquisitionProfilePayload = {
  scope: WalletAcquisitionScope;
  siteId: number;
  accountId?: number | null;
  tokenId?: number | null;
  inheritance?: WalletAcquisitionInheritance;
  walletUnit?: string | null;
  faceValuePrice?: number | null;
  rechargeDiscount?: number | null;
  dailyEarnedBalance?: number | null;
  dailyEarnedBalanceSource?: DailyEarnedBalanceSource;
  observedWindowDays?: number | null;
  confidence?: WalletAcquisitionConfidence;
  enabled?: boolean;
  notes?: string | null;
};

export type WalletAcquisitionResolution = {
  profile: WalletAcquisitionProfile | null;
  status: 'matched' | 'disabled' | 'unmatched' | 'invalid_subject';
  diagnostics: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
};

type Row = typeof schema.walletAcquisitionProfiles.$inferSelect;

const VALID_SCOPES = new Set<WalletAcquisitionScope>(['site', 'account', 'token']);
const VALID_INHERITANCE = new Set<WalletAcquisitionInheritance>(['inherit', 'override', 'disabled']);
const VALID_DAILY_SOURCES = new Set<DailyEarnedBalanceSource>(['manual', 'observed_checkin', 'mixed', 'none']);
const VALID_CONFIDENCE = new Set<WalletAcquisitionConfidence>(['exact', 'estimated', 'incomplete']);

function normalizeUnit(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.toUpperCase();
}

function normalizePositiveId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function scopeKey(input: {
  scope: WalletAcquisitionScope;
  siteId: number;
  accountId?: number | null;
  tokenId?: number | null;
}): string {
  return [
    input.scope,
    `site:${input.siteId}`,
    `account:${input.accountId ?? '-'}`,
    `token:${input.tokenId ?? '-'}`,
  ].join('|');
}

function rowToProfile(row: Row): WalletAcquisitionProfile {
  return {
    id: row.id,
    scope: row.scope as WalletAcquisitionScope,
    scopeKey: row.scopeKey,
    siteId: row.siteId,
    accountId: row.accountId ?? null,
    tokenId: row.tokenId ?? null,
    inheritance: row.inheritance as WalletAcquisitionInheritance,
    walletUnit: normalizeUnit(row.walletUnit) || 'USD',
    faceValuePrice: row.faceValuePrice ?? null,
    rechargeDiscount: Number.isFinite(Number(row.rechargeDiscount)) ? Number(row.rechargeDiscount) : 1,
    dailyEarnedBalance: row.dailyEarnedBalance ?? null,
    dailyEarnedBalanceSource: row.dailyEarnedBalanceSource as DailyEarnedBalanceSource,
    observedWindowDays: row.observedWindowDays ?? null,
    confidence: row.confidence as WalletAcquisitionConfidence,
    enabled: row.enabled !== false,
    notes: row.notes ?? null,
  };
}

export function buildWalletAcquisitionScopeKey(input: {
  scope: WalletAcquisitionScope;
  siteId: number;
  accountId?: number | null;
  tokenId?: number | null;
}): string {
  return scopeKey(input);
}

export async function listWalletAcquisitionProfiles(filters: {
  siteId?: number;
  accountId?: number;
  tokenId?: number;
  enabled?: boolean;
} = {}): Promise<WalletAcquisitionProfile[]> {
  const clauses: SQL[] = [];
  if (filters.siteId != null) clauses.push(eq(schema.walletAcquisitionProfiles.siteId, normalizeRequiredPositiveId(filters.siteId, 'siteId')));
  if (filters.accountId != null) clauses.push(eq(schema.walletAcquisitionProfiles.accountId, normalizeRequiredPositiveId(filters.accountId, 'accountId')));
  if (filters.tokenId != null) clauses.push(eq(schema.walletAcquisitionProfiles.tokenId, normalizeRequiredPositiveId(filters.tokenId, 'tokenId')));
  if (filters.enabled != null) clauses.push(eq(schema.walletAcquisitionProfiles.enabled, filters.enabled));

  const query = db.select().from(schema.walletAcquisitionProfiles);
  const rows = clauses.length > 0
    ? await query.where(and(...clauses)).orderBy(asc(schema.walletAcquisitionProfiles.siteId), asc(schema.walletAcquisitionProfiles.scope)).all()
    : await query.orderBy(asc(schema.walletAcquisitionProfiles.siteId), asc(schema.walletAcquisitionProfiles.scope)).all();
  return (rows as Row[]).map(rowToProfile);
}

export async function getWalletAcquisitionProfile(id: number): Promise<WalletAcquisitionProfile | null> {
  const row = await db.select().from(schema.walletAcquisitionProfiles)
    .where(eq(schema.walletAcquisitionProfiles.id, normalizeRequiredPositiveId(id, 'id')))
    .get();
  return row ? rowToProfile(row as Row) : null;
}

export async function createWalletAcquisitionProfile(input: WalletAcquisitionProfilePayload): Promise<WalletAcquisitionProfile> {
  const normalized = normalizeWalletAcquisitionPayload(input);
  const row = await insertAndGetById<Row>({
    table: schema.walletAcquisitionProfiles,
    idColumn: schema.walletAcquisitionProfiles.id,
    values: toInsertValues(normalized),
    insertErrorMessage: 'Failed to create wallet acquisition profile.',
  });
  return rowToProfile(row);
}

export async function updateWalletAcquisitionProfile(
  id: number,
  input: Partial<WalletAcquisitionProfilePayload>,
): Promise<WalletAcquisitionProfile | null> {
  const existing = await getWalletAcquisitionProfile(id);
  if (!existing) return null;
  const normalized = normalizeWalletAcquisitionPayload({
    scope: input.scope ?? existing.scope,
    siteId: input.siteId ?? existing.siteId,
    accountId: input.accountId !== undefined ? input.accountId : existing.accountId,
    tokenId: input.tokenId !== undefined ? input.tokenId : existing.tokenId,
    inheritance: input.inheritance ?? existing.inheritance,
    walletUnit: input.walletUnit !== undefined ? input.walletUnit : existing.walletUnit,
    faceValuePrice: input.faceValuePrice !== undefined ? input.faceValuePrice : existing.faceValuePrice,
    rechargeDiscount: input.rechargeDiscount !== undefined ? input.rechargeDiscount : existing.rechargeDiscount,
    dailyEarnedBalance: input.dailyEarnedBalance !== undefined ? input.dailyEarnedBalance : existing.dailyEarnedBalance,
    dailyEarnedBalanceSource: input.dailyEarnedBalanceSource ?? existing.dailyEarnedBalanceSource,
    observedWindowDays: input.observedWindowDays !== undefined ? input.observedWindowDays : existing.observedWindowDays,
    confidence: input.confidence ?? existing.confidence,
    enabled: input.enabled !== undefined ? input.enabled : existing.enabled,
    notes: input.notes !== undefined ? input.notes : existing.notes,
  });
  await db.update(schema.walletAcquisitionProfiles)
    .set({
      ...toInsertValues(normalized),
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(schema.walletAcquisitionProfiles.id, normalizeRequiredPositiveId(id, 'id')))
    .run();
  return await getWalletAcquisitionProfile(id);
}

export async function deleteWalletAcquisitionProfile(id: number): Promise<boolean> {
  const existing = await getWalletAcquisitionProfile(id);
  if (!existing) return false;
  await db.delete(schema.walletAcquisitionProfiles)
    .where(eq(schema.walletAcquisitionProfiles.id, normalizeRequiredPositiveId(id, 'id')))
    .run();
  return true;
}

export async function resolveWalletAcquisitionProfile(
  input: WalletAcquisitionSubject,
): Promise<WalletAcquisitionResolution> {
  const siteId = normalizePositiveId(input.siteId);
  if (siteId == null) {
    return {
      profile: null,
      status: 'invalid_subject',
      diagnostics: [{ level: 'warn', message: 'Missing site identity for wallet acquisition profile resolution.' }],
    };
  }
  const accountId = normalizePositiveId(input.accountId);
  const tokenId = normalizePositiveId(input.tokenId);
  const keys = [
    ...(tokenId != null && accountId != null ? [scopeKey({ scope: 'token', siteId, accountId, tokenId })] : []),
    ...(accountId != null ? [scopeKey({ scope: 'account', siteId, accountId })] : []),
    scopeKey({ scope: 'site', siteId }),
  ];

  const rows = await db.select()
    .from(schema.walletAcquisitionProfiles)
    .where(and(
      eq(schema.walletAcquisitionProfiles.siteId, siteId),
      eq(schema.walletAcquisitionProfiles.enabled, true),
      inArray(schema.walletAcquisitionProfiles.scopeKey, keys),
    ))
    .all() as Row[];

  const byKey = new Map(rows.map((row) => [row.scopeKey, rowToProfile(row)]));
  for (const key of keys) {
    const profile = byKey.get(key);
    if (!profile) continue;
    if (profile.inheritance === 'disabled') {
      return {
        profile: null,
        status: 'disabled',
        diagnostics: [{ level: 'info', message: `Wallet acquisition profile disabled at ${profile.scope} scope.` }],
      };
    }
    return { profile, status: 'matched', diagnostics: [] };
  }

  return {
    profile: null,
    status: 'unmatched',
    diagnostics: [{ level: 'info', message: 'No wallet acquisition profile matched this endpoint supply.' }],
  };
}

function normalizeWalletAcquisitionPayload(input: WalletAcquisitionProfilePayload): WalletAcquisitionProfilePayload & {
  scopeKey: string;
  inheritance: WalletAcquisitionInheritance;
  walletUnit: string;
  rechargeDiscount: number;
  dailyEarnedBalance: number | null;
  dailyEarnedBalanceSource: DailyEarnedBalanceSource;
  observedWindowDays: number | null;
  confidence: WalletAcquisitionConfidence;
  enabled: boolean;
  notes: string | null;
} {
  const scope = input.scope;
  if (!VALID_SCOPES.has(scope)) throw new Error('Invalid wallet acquisition scope.');
  const siteId = normalizeRequiredPositiveId(input.siteId, 'siteId');
  const accountId = input.accountId == null ? null : normalizeRequiredPositiveId(input.accountId, 'accountId');
  const tokenId = input.tokenId == null ? null : normalizeRequiredPositiveId(input.tokenId, 'tokenId');

  if (scope === 'site' && (accountId != null || tokenId != null)) {
    throw new Error('site scope cannot include accountId or tokenId.');
  }
  if (scope === 'account' && (accountId == null || tokenId != null)) {
    throw new Error('account scope requires accountId only.');
  }
  if (scope === 'token' && (accountId == null || tokenId == null)) {
    throw new Error('token scope requires accountId and tokenId.');
  }

  const inheritance = input.inheritance ?? 'override';
  if (!VALID_INHERITANCE.has(inheritance)) throw new Error('Invalid wallet acquisition inheritance.');
  const dailyEarnedBalanceSource = input.dailyEarnedBalanceSource ?? 'observed_checkin';
  if (!VALID_DAILY_SOURCES.has(dailyEarnedBalanceSource)) throw new Error('Invalid daily earned balance source.');
  const confidence = input.confidence ?? 'incomplete';
  if (!VALID_CONFIDENCE.has(confidence)) throw new Error('Invalid wallet acquisition confidence.');

  return {
    ...input,
    scope,
    scopeKey: scopeKey({ scope, siteId, accountId, tokenId }),
    siteId,
    accountId,
    tokenId,
    inheritance,
    walletUnit: normalizeUnit(input.walletUnit) || 'USD',
    faceValuePrice: normalizeOptionalNonNegativeNumber(input.faceValuePrice, 'faceValuePrice'),
    rechargeDiscount: normalizeOptionalNonNegativeNumber(input.rechargeDiscount, 'rechargeDiscount') ?? 1,
    dailyEarnedBalance: normalizeOptionalNonNegativeNumber(input.dailyEarnedBalance, 'dailyEarnedBalance'),
    dailyEarnedBalanceSource,
    observedWindowDays: normalizeOptionalPositiveInteger(input.observedWindowDays, 'observedWindowDays'),
    confidence,
    enabled: input.enabled ?? true,
    notes: normalizeOptionalText(input.notes, 2000),
  };
}

function toInsertValues(input: ReturnType<typeof normalizeWalletAcquisitionPayload>) {
  return {
    scope: input.scope,
    scopeKey: input.scopeKey,
    siteId: input.siteId,
    accountId: input.accountId,
    tokenId: input.tokenId,
    inheritance: input.inheritance,
    walletUnit: input.walletUnit,
    faceValuePrice: input.faceValuePrice,
    rechargeDiscount: input.rechargeDiscount,
    dailyEarnedBalance: input.dailyEarnedBalance,
    dailyEarnedBalanceSource: input.dailyEarnedBalanceSource,
    observedWindowDays: input.observedWindowDays,
    confidence: input.confidence,
    enabled: input.enabled,
    notes: input.notes,
  };
}

function normalizeRequiredPositiveId(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return Math.trunc(parsed);
}

function normalizeOptionalNonNegativeNumber(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative number.`);
  return parsed;
}

function normalizeOptionalPositiveInteger(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return Math.trunc(parsed);
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}
