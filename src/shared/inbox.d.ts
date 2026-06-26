export const INBOX_SCOPES: readonly [
  'notification',
  'attention',
  'activity',
  'announcement',
];

export type InboxScope = (typeof INBOX_SCOPES)[number];

export const INBOX_CATEGORIES: readonly [
  'routing',
  'cost',
  'balance',
  'health',
  'auth',
  'settings',
  'site',
  'system',
];

export type InboxCategory = (typeof INBOX_CATEGORIES)[number];

export const INBOX_SEVERITIES: readonly [
  'critical',
  'warning',
  'info',
  'success',
];

export type InboxSeverity = (typeof INBOX_SEVERITIES)[number];

export const INBOX_STATES: readonly [
  'open',
  'read',
  'acknowledged',
  'snoozed',
  'resolved',
];

export type InboxState = (typeof INBOX_STATES)[number];

export type InboxDetailBlock =
  | { type: 'text'; title?: string; text: string }
  | { type: 'kv'; title?: string; rows: Array<{ label: string; value: string }> }
  | { type: 'metrics'; title?: string; items: Array<{ label: string; value: string; tone?: string }> }
  | { type: 'list'; title?: string; items: string[] }
  | { type: 'code'; title?: string; language?: string; value: string }
  | { type: 'table'; title?: string; columns: string[]; rows: string[][] };

export type InboxAction = {
  id: string;
  label: string;
  kind: 'navigate' | 'invoke' | 'copy' | 'external';
  placement?: 'primary' | 'secondary' | 'overflow';
  variant?: 'default' | 'secondary' | 'outline' | 'destructive' | 'ghost';
  command?: 'acknowledge' | 'snooze' | 'resolve' | 'mark_read' | string;
  value?: string;
  href?: string;
};

export type InboxSubject = {
  type: string;
  id?: string | number | null;
  label?: string | null;
};

export type InboxItem = {
  id: number;
  scope: InboxScope;
  category?: InboxCategory | null;
  severity: InboxSeverity;
  type?: string | null;
  level?: string | null;
  title: string;
  summary: string;
  description?: string | null;
  message?: string | null;
  subject?: InboxSubject | null;
  details: InboxDetailBlock[];
  actions: InboxAction[];
  state: InboxState;
  read: boolean;
  readAt?: string | null;
  acknowledgedAt?: string | null;
  snoozedUntil?: string | null;
  resolvedAt?: string | null;
  dedupeKey?: string | null;
  occurrenceCount: number;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  relatedType?: string | null;
  relatedId?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  source?: string | null;
};

export type InboxListQuery = {
  limit?: number;
  offset?: number;
  type?: string;
  read?: boolean;
  scope?: InboxScope | '';
  category?: InboxCategory | '';
  state?: InboxState | '';
  subjectType?: string | '';
};

export type InboxActionCommand = 'acknowledge' | 'snooze' | 'resolve' | 'mark_read';

export type InboxActionRequest = {
  command: InboxActionCommand;
  snoozeUntil?: string | null;
};
