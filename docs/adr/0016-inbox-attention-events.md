# ADR-0016: Inbox And Attention Events

Status: Proposed
Date: 2026-06-26

## Context

Metapi already persists operator-facing events in the `events` table and renders
them through the notification panel and system log page. The current shape is
too small for the product surface we need:

- `title` and `message` cannot represent summaries, structured details, or
  diagnostics;
- `type` and `level` are not enough to distinguish notification, activity log,
  and "needs attention" workflows;
- navigation is inferred from `related_type` and `related_id`, so buttons and
  contextual actions cannot be declared by the producer;
- repeated operational issues cannot be deduplicated or tracked as open,
  acknowledged, snoozed, or resolved;
- dashboard attention items would otherwise need a separate private API that
  duplicates notification logic.

The dashboard "needs attention" area, notification popover, system logs, route
diagnostics, pricing drift checks, low-balance checks, and upstream
announcements should consume one event contract instead of parallel page-level
models.

## Decision

Metapi will evolve `events` into a generic inbox store. An inbox item is a
single operator-facing fact with presentation, routing, and lifecycle metadata.

The same API serves different views:

- `scope = notification`: compact user notifications and top-bar unread count;
- `scope = attention`: active problems that should be handled from the
  dashboard;
- `scope = activity`: audit/history records shown in system logs;
- `scope = announcement`: upstream-originated site announcements exposed through
  the generic event surface when useful.

The existing `/api/events` route remains the public route family, but its
contract is enriched. New producers should write through an inbox service rather
than inserting raw rows directly.

## Contract

The frontend contract is:

```ts
type InboxItem = {
  id: number;
  scope: 'notification' | 'attention' | 'activity' | 'announcement';
  category: 'routing' | 'cost' | 'balance' | 'health' | 'auth' | 'settings' | 'site' | 'system';
  severity: 'critical' | 'warning' | 'info' | 'success';
  title: string;
  summary: string;
  description?: string;
  subject?: {
    type: string;
    id?: string | number;
    label?: string;
  };
  details: InboxDetailBlock[];
  actions: InboxAction[];
  state: 'open' | 'read' | 'acknowledged' | 'snoozed' | 'resolved';
  read: boolean;
  dedupeKey?: string;
  occurrenceCount: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  createdAt?: string;
  updatedAt?: string;
};
```

Detail blocks are structured so the UI can render useful diagnostics instead of
a single blob of text:

```ts
type InboxDetailBlock =
  | { type: 'text'; title?: string; text: string }
  | { type: 'kv'; title?: string; rows: Array<{ label: string; value: string }> }
  | { type: 'metrics'; title?: string; items: Array<{ label: string; value: string; tone?: string }> }
  | { type: 'list'; title?: string; items: string[] }
  | { type: 'code'; title?: string; language?: string; value: string }
  | { type: 'table'; title?: string; columns: string[]; rows: string[][] };
```

Actions are declarative. The UI may navigate, copy, or call a backend action
endpoint, but arbitrary frontend command strings are not trusted:

```ts
type InboxAction = {
  id: string;
  label: string;
  kind: 'navigate' | 'invoke' | 'copy' | 'external';
  placement?: 'primary' | 'secondary' | 'overflow';
  variant?: 'default' | 'secondary' | 'outline' | 'destructive' | 'ghost';
  href?: string;
  value?: string;
  command?: 'acknowledge' | 'snooze' | 'resolve' | 'mark_read';
};
```

## Storage

The `events` table remains the store, with additive columns for:

- semantic classification: `scope`, `category`, `severity/state`;
- presentation: `summary`, `description`, `details_json`, `actions_json`;
- subject: `subject_type`, `subject_id`, `subject_label`;
- lifecycle: `acknowledged_at`, `snoozed_until`, `resolved_at`;
- dedupe: `dedupe_key`, `occurrence_count`, `first_seen_at`, `last_seen_at`;
- source metadata: `source`;
- maintenance: `updated_at`.

Legacy `type`, `level`, `message`, `related_type`, and `related_id` are still
used as compatibility fields and as fallbacks for older producers. They are not
the primary API contract for new UI work.

## Producer Rules

New producers should use the inbox service:

```ts
emitInboxItem(input)
raiseAttention(input)
resolveAttention(dedupeKey)
```

Rules:

- attention items must provide a stable `dedupeKey`;
- every attention item needs at least one useful action or entity target;
- repeating an open item updates `lastSeenAt` and increments
  `occurrenceCount` instead of creating spam rows;
- resolved checks update the existing row state rather than deleting history;
- page-level code must not invent dashboard-only attention contracts.

## UI Rules

The notification popover renders compact inbox rows. It may auto-mark unread
notification items as read, but it must not auto-resolve or close attention
items. For `scope = attention`, `read` is only a presentation flag; the
attention lifecycle remains `open`, `acknowledged`, `snoozed`, or `resolved`
until the operator takes an explicit lifecycle action.

The dashboard "needs attention" module reads `scope=attention&state=open` and
shows the highest-priority items with direct actions.

The system log page reads all scopes by default and offers detail rendering for
structured blocks. It remains the history/audit surface, not the primary place
to resolve operational problems.

## Producer Migration

Production code should not insert raw `events` rows for new operator-facing
facts. Existing producers that create task notifications, token-expiry alerts,
proxy-failure alerts, site announcements, update-center reminders, check-in
events, site status activity, settings activity, auth-token changes, and account
token sync results now write through `emitInboxItem()`.

Tests may still insert raw rows to verify legacy normalization and migration
behavior. The service remains the source of truth for normal production writes.

## Consequences

The user-facing event model becomes richer without duplicating notification,
dashboard, and log APIs. Operational features such as price drift, low balance,
route health, and route build failures can emit one structured inbox item and
let each surface render the appropriate density.

The first implementation keeps existing event writers working. Follow-up work
should migrate high-value producers from raw `db.insert(schema.events)` calls to
the inbox service so details, actions, and dedupe become available everywhere.
