import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { insertAndGetById } from '../db/insertHelpers.js';
import { db, schema } from '../db/index.js';

export type FxRateResolution = {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  source: 'manual' | 'provider' | 'system_default' | 'identity';
  snapshotId: number | null;
  capturedAt: string | null;
};

export type FxRateResolutionResult = {
  rate: FxRateResolution | null;
  diagnostics: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
};

export type FxRateSnapshotRecord = {
  id: number;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  source: 'manual' | 'provider' | 'system_default';
  capturedAt: string;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type FxRateSnapshotPayload = {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  source?: FxRateSnapshotRecord['source'];
  capturedAt?: string | null;
  notes?: string | null;
};

type Row = typeof schema.fxRateSnapshots.$inferSelect;
const VALID_SOURCES = new Set<FxRateSnapshotRecord['source']>(['manual', 'provider', 'system_default']);

function normalizeCurrency(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.toUpperCase();
}

export async function resolveFxRate(input: {
  fromCurrency: string | null | undefined;
  toCurrency: string | null | undefined;
}): Promise<FxRateResolutionResult> {
  const fromCurrency = normalizeCurrency(input.fromCurrency);
  const toCurrency = normalizeCurrency(input.toCurrency);
  if (!fromCurrency || !toCurrency) {
    return {
      rate: null,
      diagnostics: [{ level: 'warn', message: 'Missing unit for conversion rate resolution.' }],
    };
  }
  if (fromCurrency === toCurrency) {
    return {
      rate: {
        fromCurrency,
        toCurrency,
        rate: 1,
        source: 'identity',
        snapshotId: null,
        capturedAt: null,
      },
      diagnostics: [],
    };
  }

  const row = await db.select()
    .from(schema.fxRateSnapshots)
    .where(and(
      eq(schema.fxRateSnapshots.fromCurrency, fromCurrency),
      eq(schema.fxRateSnapshots.toCurrency, toCurrency),
    ))
    .orderBy(desc(schema.fxRateSnapshots.capturedAt), desc(schema.fxRateSnapshots.id))
    .get();
  if (row && Number.isFinite(Number(row.rate)) && Number(row.rate) > 0) {
    return {
      rate: {
        fromCurrency,
        toCurrency,
        rate: Number(row.rate),
        source: row.source as FxRateResolution['source'],
        snapshotId: row.id,
        capturedAt: row.capturedAt,
      },
      diagnostics: [],
    };
  }

  const reverseRow = await db.select()
    .from(schema.fxRateSnapshots)
    .where(and(
      eq(schema.fxRateSnapshots.fromCurrency, toCurrency),
      eq(schema.fxRateSnapshots.toCurrency, fromCurrency),
    ))
    .orderBy(desc(schema.fxRateSnapshots.capturedAt), desc(schema.fxRateSnapshots.id))
    .get();
  if (reverseRow && Number.isFinite(Number(reverseRow.rate)) && Number(reverseRow.rate) > 0) {
    return {
      rate: {
        fromCurrency,
        toCurrency,
        rate: 1 / Number(reverseRow.rate),
        source: reverseRow.source as FxRateResolution['source'],
        snapshotId: reverseRow.id,
        capturedAt: reverseRow.capturedAt,
      },
      diagnostics: [],
    };
  }

  return {
    rate: null,
    diagnostics: [{ level: 'warn', message: `No unit conversion configured for ${fromCurrency} -> ${toCurrency}.` }],
  };
}

export async function listFxRateSnapshots(filters: {
  fromCurrency?: string | null;
  toCurrency?: string | null;
} = {}): Promise<FxRateSnapshotRecord[]> {
  const clauses: SQL[] = [];
  const fromCurrency = normalizeCurrency(filters.fromCurrency);
  const toCurrency = normalizeCurrency(filters.toCurrency);
  if (fromCurrency) clauses.push(eq(schema.fxRateSnapshots.fromCurrency, fromCurrency));
  if (toCurrency) clauses.push(eq(schema.fxRateSnapshots.toCurrency, toCurrency));

  const query = db.select().from(schema.fxRateSnapshots);
  const rows = clauses.length > 0
    ? await query.where(and(...clauses)).orderBy(asc(schema.fxRateSnapshots.fromCurrency), asc(schema.fxRateSnapshots.toCurrency), desc(schema.fxRateSnapshots.capturedAt)).all()
    : await query.orderBy(asc(schema.fxRateSnapshots.fromCurrency), asc(schema.fxRateSnapshots.toCurrency), desc(schema.fxRateSnapshots.capturedAt)).all();
  return (rows as Row[]).map(rowToRecord);
}

export async function getFxRateSnapshot(id: number): Promise<FxRateSnapshotRecord | null> {
  const row = await db.select().from(schema.fxRateSnapshots)
    .where(eq(schema.fxRateSnapshots.id, normalizeRequiredPositiveId(id, 'id')))
    .get();
  return row ? rowToRecord(row as Row) : null;
}

export async function createFxRateSnapshot(input: FxRateSnapshotPayload): Promise<FxRateSnapshotRecord> {
  const normalized = normalizeFxRateSnapshotPayload(input);
  await assertFxRatePairIsAvailable(normalized.fromCurrency, normalized.toCurrency);
  const row = await insertAndGetById<Row>({
    table: schema.fxRateSnapshots,
    idColumn: schema.fxRateSnapshots.id,
    values: toInsertValues(normalized),
    insertErrorMessage: 'Failed to create unit conversion snapshot.',
  });
  return rowToRecord(row);
}

export async function updateFxRateSnapshot(
  id: number,
  input: Partial<FxRateSnapshotPayload>,
): Promise<FxRateSnapshotRecord | null> {
  const existing = await getFxRateSnapshot(id);
  if (!existing) return null;
  const normalized = normalizeFxRateSnapshotPayload({
    fromCurrency: input.fromCurrency ?? existing.fromCurrency,
    toCurrency: input.toCurrency ?? existing.toCurrency,
    rate: input.rate ?? existing.rate,
    source: input.source ?? existing.source,
    capturedAt: input.capturedAt !== undefined ? input.capturedAt : existing.capturedAt,
    notes: input.notes !== undefined ? input.notes : existing.notes,
  });
  await assertFxRatePairIsAvailable(normalized.fromCurrency, normalized.toCurrency, existing.id);
  await db.update(schema.fxRateSnapshots)
    .set({
      ...toInsertValues(normalized),
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(schema.fxRateSnapshots.id, normalizeRequiredPositiveId(id, 'id')))
    .run();
  return await getFxRateSnapshot(id);
}

export async function deleteFxRateSnapshot(id: number): Promise<boolean> {
  const existing = await getFxRateSnapshot(id);
  if (!existing) return false;
  await db.delete(schema.fxRateSnapshots)
    .where(eq(schema.fxRateSnapshots.id, normalizeRequiredPositiveId(id, 'id')))
    .run();
  return true;
}

function normalizeFxRateSnapshotPayload(input: FxRateSnapshotPayload): FxRateSnapshotPayload & {
  fromCurrency: string;
  toCurrency: string;
  source: FxRateSnapshotRecord['source'];
  capturedAt: string;
  notes: string | null;
} {
  const fromCurrency = normalizeCurrency(input.fromCurrency);
  const toCurrency = normalizeCurrency(input.toCurrency);
  if (!fromCurrency) throw new Error('fromCurrency is required.');
  if (!toCurrency) throw new Error('toCurrency is required.');
  if (fromCurrency === toCurrency) throw new Error('Unit conversion must use different units.');
  const rate = Number(input.rate);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('rate must be a positive number.');
  const canonicalPair = canonicalizeCurrencyPair(fromCurrency, toCurrency, rate);
  const source = input.source ?? 'manual';
  if (!VALID_SOURCES.has(source)) throw new Error('Invalid unit conversion source.');
  return {
    ...input,
    fromCurrency: canonicalPair.fromCurrency,
    toCurrency: canonicalPair.toCurrency,
    rate: canonicalPair.rate,
    source,
    capturedAt: normalizeCapturedAt(input.capturedAt),
    notes: normalizeOptionalText(input.notes, 2000),
  };
}

function canonicalizeCurrencyPair(fromCurrency: string, toCurrency: string, rate: number) {
  if (fromCurrency <= toCurrency) {
    return { fromCurrency, toCurrency, rate };
  }
  return {
    fromCurrency: toCurrency,
    toCurrency: fromCurrency,
    rate: 1 / rate,
  };
}

async function assertFxRatePairIsAvailable(fromCurrency: string, toCurrency: string, currentId?: number) {
  const existing = await db.select({ id: schema.fxRateSnapshots.id })
    .from(schema.fxRateSnapshots)
    .where(and(
      eq(schema.fxRateSnapshots.fromCurrency, fromCurrency),
      eq(schema.fxRateSnapshots.toCurrency, toCurrency),
    ))
    .get();
  if (existing && existing.id !== currentId) {
    throw new Error(`Unit conversion ${fromCurrency} -> ${toCurrency} already exists.`);
  }

  const reverseExisting = await db.select({ id: schema.fxRateSnapshots.id })
    .from(schema.fxRateSnapshots)
    .where(and(
      eq(schema.fxRateSnapshots.fromCurrency, toCurrency),
      eq(schema.fxRateSnapshots.toCurrency, fromCurrency),
    ))
    .get();
  if (reverseExisting && reverseExisting.id !== currentId) {
    throw new Error(`Unit conversion ${fromCurrency} -> ${toCurrency} conflicts with existing reverse conversion ${toCurrency} -> ${fromCurrency}.`);
  }
}

function toInsertValues(input: ReturnType<typeof normalizeFxRateSnapshotPayload>) {
  return {
    fromCurrency: input.fromCurrency,
    toCurrency: input.toCurrency,
    rate: input.rate,
    source: input.source,
    capturedAt: input.capturedAt,
    notes: input.notes,
  };
}

function rowToRecord(row: Row): FxRateSnapshotRecord {
  return {
    id: row.id,
    fromCurrency: normalizeCurrency(row.fromCurrency) || 'USD',
    toCurrency: normalizeCurrency(row.toCurrency) || 'USD',
    rate: Number(row.rate),
    source: row.source as FxRateSnapshotRecord['source'],
    capturedAt: row.capturedAt,
    notes: row.notes ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeRequiredPositiveId(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return Math.trunc(parsed);
}

function normalizeCapturedAt(value: unknown): string {
  if (value == null || value === '') return new Date().toISOString();
  const text = String(value).trim();
  if (!text) return new Date().toISOString();
  return text.slice(0, 80);
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}
