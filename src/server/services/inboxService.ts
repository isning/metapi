import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import { requireInsertedRowId } from '../db/insertHelpers.js';
import { formatUtcSqlDateTime } from './localTimeService.js';
import {
  INBOX_CATEGORIES,
  INBOX_SCOPES,
  INBOX_SEVERITIES,
  INBOX_STATES,
  type InboxAction,
  type InboxActionCommand,
  type InboxDetailBlock,
  type InboxItem,
  type InboxListQuery,
  type InboxScope,
  type InboxState,
} from '../../shared/inbox.js';

type EventRow = typeof schema.events.$inferSelect;

type InboxEmitInput = {
  scope?: InboxItem['scope'];
  category?: InboxItem['category'];
  severity?: InboxItem['severity'];
  type?: string | null;
  level?: string | null;
  title: string;
  summary?: string | null;
  description?: string | null;
  message?: string | null;
  subject?: InboxItem['subject'];
  details?: InboxDetailBlock[];
  actions?: InboxAction[];
  state?: InboxItem['state'];
  read?: boolean;
  dedupeKey?: string | null;
  source?: string | null;
  relatedId?: number | null;
  relatedType?: string | null;
};

type InboxListOptions = InboxListQuery & {
  includeSnoozed?: boolean;
};

const SCOPES = new Set<string>(INBOX_SCOPES);
const CATEGORIES = new Set<string>(INBOX_CATEGORIES);
const SEVERITIES = new Set<string>(INBOX_SEVERITIES);
const STATES = new Set<string>(INBOX_STATES);

function nowSql(): string {
  return formatUtcSqlDateTime(new Date());
}

function clampLimit(limit: unknown): number {
  const parsed = Number.parseInt(String(limit ?? '30'), 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(1, Math.min(500, parsed));
}

function clampOffset(offset: unknown): number {
  const parsed = Number.parseInt(String(offset ?? '0'), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function optionalText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeScope(value: unknown, fallback: InboxScope = 'activity'): InboxScope {
  const text = optionalText(value);
  return text && SCOPES.has(text) ? text as InboxScope : fallback;
}

function normalizeCategory(value: unknown, fallback: InboxItem['category'] = 'system'): InboxItem['category'] {
  const text = optionalText(value);
  return text && CATEGORIES.has(text) ? text as InboxItem['category'] : fallback;
}

function normalizeSeverity(value: unknown, fallback?: InboxItem['severity']): InboxItem['severity'] {
  const text = optionalText(value);
  if (text && SEVERITIES.has(text)) return text as InboxItem['severity'];
  const level = optionalText(value)?.toLowerCase();
  if (level === 'error') return 'critical';
  return fallback ?? 'info';
}

function severityFromLegacyLevel(level: unknown): InboxItem['severity'] {
  const text = optionalText(level)?.toLowerCase();
  if (text === 'error' || text === 'critical') return 'critical';
  if (text === 'warning' || text === 'warn') return 'warning';
  if (text === 'success') return 'success';
  return 'info';
}

function normalizeState(value: unknown, read: boolean): InboxState {
  const text = optionalText(value);
  if (text && STATES.has(text)) return text as InboxState;
  return read ? 'read' : 'open';
}

function categoryFromLegacy(row: Pick<EventRow, 'type' | 'relatedType'>): InboxItem['category'] {
  const type = optionalText(row.type)?.toLowerCase();
  const relatedType = optionalText(row.relatedType)?.toLowerCase();
  if (type === 'balance') return 'balance';
  if (type === 'token') return 'auth';
  if (type === 'proxy' || type === 'status') return 'health';
  if (type === 'site_notice') return 'site';
  if (relatedType === 'route') return 'routing';
  return 'system';
}

function scopeFromLegacy(row: Pick<EventRow, 'type'>): InboxScope {
  const type = optionalText(row.type)?.toLowerCase();
  if (type === 'site_notice') return 'announcement';
  return 'activity';
}

function parseJsonArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  const text = optionalText(raw);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function stringifyJsonArray(input: unknown[] | undefined): string | null {
  if (!input || input.length === 0) return null;
  return JSON.stringify(input);
}

function buildSubject(row: EventRow): InboxItem['subject'] {
  const type = optionalText(row.subjectType) ?? optionalText(row.relatedType);
  const id = optionalText(row.subjectId) ?? (row.relatedId == null ? null : String(row.relatedId));
  const label = optionalText(row.subjectLabel);
  if (!type && !id && !label) return null;
  return {
    type: type || 'unknown',
    id,
    label,
  };
}

function inferLevelFromSeverity(severity: InboxItem['severity']): string {
  if (severity === 'critical') return 'error';
  if (severity === 'warning') return 'warning';
  return 'info';
}

function readFlagForState(state: InboxState, read?: boolean): boolean {
  if (read !== undefined) return !!read;
  return state === 'read' || state === 'acknowledged' || state === 'resolved';
}

export function normalizeInboxRow(row: EventRow): InboxItem {
  const read = !!row.read;
  const severity = normalizeSeverity(row.severity, severityFromLegacyLevel(row.level));
  const state = normalizeState(row.state, read);
  const summary = optionalText(row.summary) ?? optionalText(row.message) ?? row.title;
  const description = optionalText(row.description) ?? optionalText(row.message);
  const details = parseJsonArray<InboxDetailBlock>(row.detailsJson);
  const actions = parseJsonArray<InboxAction>(row.actionsJson);

  return {
    id: row.id,
    scope: normalizeScope(row.scope, scopeFromLegacy(row)),
    category: normalizeCategory(row.category, categoryFromLegacy(row)),
    severity,
    type: row.type,
    level: row.level,
    title: row.title,
    summary,
    description,
    message: row.message,
    subject: buildSubject(row),
    details,
    actions,
    state,
    read,
    readAt: row.readAt ?? null,
    acknowledgedAt: row.acknowledgedAt ?? null,
    snoozedUntil: row.snoozedUntil ?? null,
    resolvedAt: row.resolvedAt ?? null,
    dedupeKey: row.dedupeKey ?? null,
    occurrenceCount: row.occurrenceCount ?? 1,
    firstSeenAt: row.firstSeenAt ?? row.createdAt ?? null,
    lastSeenAt: row.lastSeenAt ?? row.createdAt ?? null,
    relatedType: row.relatedType ?? null,
    relatedId: row.relatedId ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
    source: row.source ?? null,
  };
}

function buildListFilters(query: InboxListOptions): unknown[] {
  const filters: unknown[] = [];
  const type = optionalText(query.type);
  const scope = optionalText(query.scope);
  const category = optionalText(query.category);
  const state = optionalText(query.state);
  const subjectType = optionalText(query.subjectType);

  if (type) filters.push(eq(schema.events.type, type));
  if (query.read === true) filters.push(eq(schema.events.read, true));
  if (query.read === false) filters.push(eq(schema.events.read, false));
  if (scope && SCOPES.has(scope)) filters.push(eq(schema.events.scope, scope));
  if (category && CATEGORIES.has(category)) filters.push(eq(schema.events.category, category));
  if (state && STATES.has(state)) filters.push(eq(schema.events.state, state));
  if (subjectType) filters.push(eq(schema.events.subjectType, subjectType));

  if (!query.includeSnoozed) {
    const now = nowSql();
    filters.push(or(
      isNull(schema.events.snoozedUntil),
      sql`${schema.events.snoozedUntil} <= ${now}`,
    ));
  }

  return filters;
}

export async function listInboxItems(query: InboxListOptions = {}): Promise<InboxItem[]> {
  const limit = clampLimit(query.limit);
  const offset = clampOffset(query.offset);
  const filters = buildListFilters(query);
  const base = db.select().from(schema.events);
  const rows = filters.length > 0
    ? await base
      .where(and(...filters as any[]))
      .orderBy(desc(schema.events.createdAt))
      .limit(limit)
      .offset(offset)
      .all()
    : await base
      .orderBy(desc(schema.events.createdAt))
      .limit(limit)
      .offset(offset)
      .all();
  return rows.map(normalizeInboxRow);
}

export async function countUnreadInboxItems(query: Pick<InboxListOptions, 'scope' | 'category' | 'state' | 'subjectType'> = {}): Promise<number> {
  const filters = buildListFilters({ ...query, read: false });
  const result = filters.length > 0
    ? await db.select({ count: sql<number>`count(*)` }).from(schema.events).where(and(...filters as any[])).get()
    : await db.select({ count: sql<number>`count(*)` }).from(schema.events).get();
  return Number(result?.count || 0);
}

export async function emitInboxItem(input: InboxEmitInput): Promise<InboxItem> {
  const timestamp = nowSql();
  const severity = normalizeSeverity(input.severity, severityFromLegacyLevel(input.level));
  const scope = normalizeScope(input.scope, 'activity');
  const state = normalizeState(input.state, !!input.read);
  const read = readFlagForState(state, input.read);
  const type = optionalText(input.type) ?? scope;
  const relatedType = optionalText(input.relatedType) ?? optionalText(input.subject?.type);
  const subjectId = input.subject?.id == null ? null : String(input.subject.id);
  const relatedId = input.relatedId ?? (subjectId && /^\d+$/.test(subjectId) ? Number(subjectId) : null);

  if (input.dedupeKey) {
    const existing = await db.select()
      .from(schema.events)
      .where(and(
        eq(schema.events.dedupeKey, input.dedupeKey),
        or(eq(schema.events.state, 'open'), eq(schema.events.state, 'acknowledged'), eq(schema.events.state, 'snoozed')),
      ))
      .orderBy(desc(schema.events.createdAt))
      .limit(1)
      .get();

    if (existing) {
      await db.update(schema.events)
        .set({
          title: input.title,
          summary: optionalText(input.summary) ?? optionalText(input.message) ?? input.title,
          description: optionalText(input.description) ?? optionalText(input.message),
          message: optionalText(input.message) ?? optionalText(input.description) ?? optionalText(input.summary),
          severity,
          level: optionalText(input.level) ?? inferLevelFromSeverity(severity),
          scope,
          category: normalizeCategory(input.category, categoryFromLegacy({ type, relatedType })),
          state,
          read,
          detailsJson: stringifyJsonArray(input.details),
          actionsJson: stringifyJsonArray(input.actions),
          occurrenceCount: (existing.occurrenceCount ?? 1) + 1,
          lastSeenAt: timestamp,
          updatedAt: timestamp,
          snoozedUntil: state === 'snoozed' ? existing.snoozedUntil : null,
          resolvedAt: null,
        })
        .where(eq(schema.events.id, existing.id))
        .run();
      const row = await db.select().from(schema.events).where(eq(schema.events.id, existing.id)).get();
      return normalizeInboxRow(row);
    }
  }

  const insertValues = {
    type,
    title: input.title,
    summary: optionalText(input.summary) ?? optionalText(input.message) ?? input.title,
    description: optionalText(input.description) ?? optionalText(input.message),
    message: optionalText(input.message) ?? optionalText(input.description) ?? optionalText(input.summary),
    level: optionalText(input.level) ?? inferLevelFromSeverity(severity),
    severity,
    scope,
    category: normalizeCategory(input.category, categoryFromLegacy({ type, relatedType })),
    state,
    read,
    readAt: read ? timestamp : null,
    subjectType: optionalText(input.subject?.type) ?? relatedType,
    subjectId,
    subjectLabel: optionalText(input.subject?.label),
    detailsJson: stringifyJsonArray(input.details),
    actionsJson: stringifyJsonArray(input.actions),
    dedupeKey: optionalText(input.dedupeKey),
    occurrenceCount: 1,
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    source: optionalText(input.source),
    relatedId,
    relatedType,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const result = await db.insert(schema.events).values(insertValues).run();
  const id = requireInsertedRowId(result, 'Failed to create inbox item.');
  const row = await db.select().from(schema.events).where(eq(schema.events.id, id)).get();
  return normalizeInboxRow(row);
}

function nextStateAfterRead(row: Pick<EventRow, 'scope' | 'state'>): InboxState {
  const state = normalizeState(row.state, false);
  if (state === 'acknowledged' || state === 'snoozed' || state === 'resolved') return state;
  if (normalizeScope(row.scope, 'activity') === 'attention') return state;
  return 'read';
}

export async function markInboxItemRead(id: number): Promise<void> {
  const timestamp = nowSql();
  const row = await db.select({
    scope: schema.events.scope,
    state: schema.events.state,
  }).from(schema.events).where(eq(schema.events.id, id)).get();
  const nextState = row ? nextStateAfterRead(row) : 'read';
  await db.update(schema.events)
    .set({ read: true, state: nextState, readAt: timestamp, updatedAt: timestamp })
    .where(eq(schema.events.id, id))
    .run();
}

export async function markAllInboxItemsRead(query: Pick<InboxListOptions, 'scope' | 'category' | 'type' | 'state' | 'subjectType'> = {}): Promise<void> {
  const timestamp = nowSql();
  const filters = buildListFilters({ ...query, read: false, includeSnoozed: true });
  const baseUpdate = db.update(schema.events).set({
    read: true,
    state: sql<string>`case
      when ${schema.events.scope} = 'attention' then ${schema.events.state}
      when ${schema.events.state} in ('acknowledged', 'snoozed', 'resolved') then ${schema.events.state}
      else 'read'
    end`,
    readAt: timestamp,
    updatedAt: timestamp,
  });
  if (filters.length > 0) {
    await baseUpdate.where(and(...filters as any[])).run();
    return;
  }
  await baseUpdate.run();
}

export async function clearInboxItems(query: Pick<InboxListOptions, 'scope' | 'category' | 'type' | 'state' | 'subjectType' | 'read'> = {}): Promise<void> {
  const filters = buildListFilters({ ...query, includeSnoozed: true });
  const baseDelete = db.delete(schema.events);
  if (filters.length > 0) {
    await baseDelete.where(and(...filters as any[])).run();
    return;
  }
  await baseDelete.run();
}

export async function applyInboxAction(id: number, command: InboxActionCommand, options: { snoozeUntil?: string | null } = {}): Promise<InboxItem | null> {
  const timestamp = nowSql();
  if (command === 'mark_read') {
    await markInboxItemRead(id);
  } else if (command === 'acknowledge') {
    await db.update(schema.events)
      .set({
        read: true,
        state: 'acknowledged',
        readAt: timestamp,
        acknowledgedAt: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(schema.events.id, id))
      .run();
  } else if (command === 'resolve') {
    await db.update(schema.events)
      .set({
        read: true,
        state: 'resolved',
        readAt: timestamp,
        resolvedAt: timestamp,
        snoozedUntil: null,
        updatedAt: timestamp,
      })
      .where(eq(schema.events.id, id))
      .run();
  } else if (command === 'snooze') {
    const snoozeUntil = optionalText(options.snoozeUntil);
    if (!snoozeUntil) throw new Error('snoozeUntil is required for snooze actions.');
    await db.update(schema.events)
      .set({
        read: true,
        state: 'snoozed',
        readAt: timestamp,
        snoozedUntil: snoozeUntil,
        updatedAt: timestamp,
      })
      .where(eq(schema.events.id, id))
      .run();
  } else {
    throw new Error(`Unsupported inbox action: ${command}`);
  }

  const row = await db.select().from(schema.events).where(eq(schema.events.id, id)).get();
  return row ? normalizeInboxRow(row) : null;
}

export async function resolveInboxItemByDedupeKey(dedupeKey: string): Promise<void> {
  const key = optionalText(dedupeKey);
  if (!key) return;
  const timestamp = nowSql();
  await db.update(schema.events)
    .set({
      read: true,
      state: 'resolved',
      readAt: timestamp,
      resolvedAt: timestamp,
      snoozedUntil: null,
      updatedAt: timestamp,
    })
    .where(eq(schema.events.dedupeKey, key))
    .run();
}
