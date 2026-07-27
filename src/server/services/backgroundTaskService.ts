import { randomUUID } from 'node:crypto';
import { sendNotification } from './notifyService.js';
import { emitInboxItem } from './inboxService.js';
import type { InboxDetailBlock } from '../../shared/inbox.js';

export type BackgroundTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type BackgroundTaskLogEntry = {
  seq: number;
  message: string;
  createdAt: string;
};

export type BackgroundTask = {
  id: string;
  type: string;
  title: string;
  titleKey: string | null;
  status: BackgroundTaskStatus;
  message: string;
  error: string | null;
  result: unknown;
  dedupeKey: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAtMs: number;
  logs: BackgroundTaskLogEntry[];
};

type TaskMessageTemplate = string | ((task: BackgroundTask) => string);
type TaskI18nPayload = {
  key: string;
  params?: Record<string, string | number | boolean | null | undefined>;
  paramKeys?: Record<string, string>;
};
type TaskI18nTemplate = TaskI18nPayload | ((task: BackgroundTask) => TaskI18nPayload | null | undefined);

export type BackgroundTaskStartOptions = {
  type: string;
  title: string;
  titleKey?: string;
  dedupeKey?: string;
  keepMs?: number;
  notifyOnSuccess?: boolean;
  notifyOnFailure?: boolean;
  successTitle?: TaskMessageTemplate;
  failureTitle?: TaskMessageTemplate;
  successMessage?: TaskMessageTemplate;
  failureMessage?: TaskMessageTemplate;
  successMessageI18n?: TaskI18nTemplate;
  failureMessageI18n?: TaskI18nTemplate;
};

const TASK_TTL_MS = 6 * 60 * 60 * 1000;
const TASK_CLEANUP_INTERVAL_MS = 60 * 1000;
const TASK_LOG_LIMIT = 200;

const tasks = new Map<string, BackgroundTask>();
const dedupeTaskIds = new Map<string, string>();
const taskLogSeq = new Map<string, number>();
const taskLogSubscribers = new Map<string, Set<(entry: BackgroundTaskLogEntry) => void>>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function nowIso() {
  return new Date().toISOString();
}

function summarizeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error && typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch {
      return 'unknown error';
    }
  }
  return 'unknown error';
}

function resolveTaskMessage(template: TaskMessageTemplate | undefined, task: BackgroundTask, fallback: string): string {
  if (typeof template === 'function') {
    try {
      const value = template(task);
      if (typeof value === 'string' && value.trim()) return value.trim();
    } catch {}
    return fallback;
  }
  if (typeof template === 'string' && template.trim()) return template.trim();
  return fallback;
}

function resolveTaskI18n(template: TaskI18nTemplate | undefined, task: BackgroundTask): TaskI18nPayload | null {
  if (!template) return null;
  if (typeof template === 'function') {
    try {
      return template(task) || null;
    } catch {
      return null;
    }
  }
  return template;
}

function taskTitleI18nParams(task: BackgroundTask) {
  return {
    params: { title: task.title },
    paramKeys: task.titleKey ? { title: task.titleKey } : undefined,
  };
}

function lifecycleTaskI18n(
  task: BackgroundTask,
  input: {
    titleKey: string;
    messageKey: string;
    message?: TaskI18nPayload | null;
    extraParams?: Record<string, string | number | boolean | null | undefined>;
  },
): Extract<InboxDetailBlock, { type: 'i18n' }> {
  const titleParams = taskTitleI18nParams(task);
  const message = input.message;
  return {
    type: 'i18n',
    titleKey: input.titleKey,
    summaryKey: message?.key || input.messageKey,
    messageKey: message?.key || input.messageKey,
    params: {
      ...titleParams.params,
      ...(input.extraParams || {}),
      ...(message?.params || {}),
    },
    paramKeys: {
      ...(titleParams.paramKeys || {}),
      ...(message?.paramKeys || {}),
    },
  };
}

function formatTaskTimestamp(value: string | null | undefined): string {
  return value || '-';
}

function formatTaskDuration(task: BackgroundTask): string {
  const startMs = Date.parse(task.startedAt || task.createdAt);
  const endMs = Date.parse(task.finishedAt || task.updatedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return '-';
  const durationMs = endMs - startMs;
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(2).replace(/\.?0+$/, '')} s`;
}

function stringifyTaskDetailValue(value: unknown): string {
  if (value == null) return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function collectTaskMetricItems(value: unknown, prefix = ''): Array<{ label: string; value: string }> {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [{ label: prefix || 'value', value: String(value) }];
  }
  if (Array.isArray(value)) {
    return prefix ? [{ label: `${prefix}.count`, value: String(value.length) }] : [];
  }
  if (!value || typeof value !== 'object') return [];

  const items: Array<{ label: string; value: string }> = [];
  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    const label = prefix ? `${prefix}.${key}` : key;
    if (typeof entryValue === 'number' || typeof entryValue === 'boolean') {
      items.push({ label, value: String(entryValue) });
      continue;
    }
    if (Array.isArray(entryValue)) {
      items.push({ label: `${label}.count`, value: String(entryValue.length) });
      continue;
    }
    if (entryValue && typeof entryValue === 'object') {
      for (const [nestedKey, nestedValue] of Object.entries(entryValue as Record<string, unknown>)) {
        if (typeof nestedValue === 'number' || typeof nestedValue === 'boolean') {
          items.push({ label: `${label}.${nestedKey}`, value: String(nestedValue) });
        } else if (Array.isArray(nestedValue)) {
          items.push({ label: `${label}.${nestedKey}.count`, value: String(nestedValue.length) });
        }
      }
    }
  }
  return items;
}

function buildTaskResultDetailBlocks(result: unknown): InboxDetailBlock[] {
  if (result == null) return [];
  const blocks: InboxDetailBlock[] = [];
  if (typeof result === 'object' && !Array.isArray(result)) {
    const entries = Object.entries(result as Record<string, unknown>);
    const metricItems = collectTaskMetricItems(result);
    if (metricItems.length > 0) {
      blocks.push({ type: 'metrics', title: 'backgroundTask.details.resultMetrics', items: metricItems });
    }

    const rows = entries
      .filter(([, value]) => value == null || typeof value === 'string')
      .map(([label, value]) => ({ label, value: stringifyTaskDetailValue(value) }));
    if (rows.length > 0) {
      blocks.push({ type: 'kv', title: 'backgroundTask.details.result', rows });
    }

    const errors = (result as { errors?: unknown }).errors;
    if (Array.isArray(errors) && errors.length > 0) {
      blocks.push({
        type: 'table',
        title: 'backgroundTask.details.errorList',
        columns: ['siteId', 'accountId', 'error'],
        rows: errors.slice(0, 20).map((item) => {
          const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
          return [
            stringifyTaskDetailValue(row.siteId),
            stringifyTaskDetailValue(row.accountId),
            stringifyTaskDetailValue(row.error ?? item),
          ];
        }),
      });
    }
  }

  try {
    blocks.push({
      type: 'code',
      title: 'backgroundTask.details.resultJson',
      language: 'json',
      value: JSON.stringify(result, null, 2),
    });
  } catch {}

  return blocks;
}

function buildTaskEventDetails(task: BackgroundTask): InboxDetailBlock[] {
  const details: InboxDetailBlock[] = [
    {
      type: 'kv',
      title: 'backgroundTask.details.taskInfo',
      rows: [
        { label: 'backgroundTask.details.taskId', value: task.id },
        { label: 'backgroundTask.details.type', value: task.type },
        { label: 'backgroundTask.details.status', value: task.status },
        { label: 'backgroundTask.details.createdAt', value: formatTaskTimestamp(task.createdAt) },
        { label: 'backgroundTask.details.startedAt', value: formatTaskTimestamp(task.startedAt) },
        { label: 'backgroundTask.details.finishedAt', value: formatTaskTimestamp(task.finishedAt) },
        { label: 'backgroundTask.details.duration', value: formatTaskDuration(task) },
        ...(task.dedupeKey ? [{ label: 'backgroundTask.details.dedupeKey', value: task.dedupeKey }] : []),
      ],
    },
  ];

  if (task.error) {
    details.push({ type: 'text', title: 'backgroundTask.details.error', text: task.error });
  }
  details.push(...buildTaskResultDetailBlocks(task.result));
  if (task.logs.length > 0) {
    details.push({
      type: 'list',
      title: 'backgroundTask.details.logs',
      items: task.logs.slice(-20).map((entry) => `${entry.seq}. ${entry.message}`),
    });
  }
  return details;
}

function setTaskStatus(task: BackgroundTask, patch: Partial<BackgroundTask>) {
  const currentTask = tasks.get(task.id) || task;
  const next: BackgroundTask = {
    ...currentTask,
    ...patch,
    updatedAt: nowIso(),
  };
  tasks.set(task.id, next);
  return next;
}

function cleanupTaskInternals(taskId: string) {
  taskLogSeq.delete(taskId);
  taskLogSubscribers.delete(taskId);
}

export function appendBackgroundTaskLog(taskId: string, message: string): BackgroundTaskLogEntry | null {
  const task = tasks.get(taskId);
  const normalizedMessage = String(message || '').trim();
  if (!task || !normalizedMessage) return null;

  const nextSeq = (taskLogSeq.get(taskId) || 0) + 1;
  taskLogSeq.set(taskId, nextSeq);

  const entry: BackgroundTaskLogEntry = {
    seq: nextSeq,
    message: normalizedMessage,
    createdAt: nowIso(),
  };

  const nextLogs = [...task.logs, entry];
  const trimmedLogs = nextLogs.length > TASK_LOG_LIMIT
    ? nextLogs.slice(nextLogs.length - TASK_LOG_LIMIT)
    : nextLogs;

  tasks.set(taskId, {
    ...task,
    logs: trimmedLogs,
    updatedAt: nowIso(),
  });

  const subscribers = taskLogSubscribers.get(taskId);
  if (subscribers) {
    for (const subscriber of subscribers) {
      subscriber(entry);
    }
  }

  return entry;
}

export function subscribeToBackgroundTaskLogs(
  taskId: string,
  listener: (entry: BackgroundTaskLogEntry) => void,
): () => void {
  let subscribers = taskLogSubscribers.get(taskId);
  if (!subscribers) {
    subscribers = new Set();
    taskLogSubscribers.set(taskId, subscribers);
  }
  subscribers.add(listener);

  return () => {
    const current = taskLogSubscribers.get(taskId);
    if (!current) return;
    current.delete(listener);
    if (current.size <= 0) {
      taskLogSubscribers.delete(taskId);
    }
  };
}

async function appendTaskEvent(
  level: 'info' | 'warning' | 'error',
  title: string,
  message: string,
  taskId: string,
  options: { scope?: 'notification' | 'activity'; i18n?: Extract<InboxDetailBlock, { type: 'i18n' }> } = {},
) {
  try {
    const task = tasks.get(taskId);
    const details = [
      ...(options.i18n ? [options.i18n] : []),
      ...(task ? buildTaskEventDetails(task) : []),
    ];
    await emitInboxItem({
      scope: options.scope || 'notification',
      category: 'system',
      type: 'status',
      title,
      summary: message,
      message,
      level,
      subject: { type: 'task', id: taskId, label: title },
      details,
      relatedType: 'task',
      source: 'background_task',
    });
  } catch {}
}

async function runTask(taskId: string, options: BackgroundTaskStartOptions, runner: () => Promise<unknown>) {
  const initialTask = tasks.get(taskId);
  if (!initialTask) return;

  let task = setTaskStatus(initialTask, {
    status: 'running',
    startedAt: nowIso(),
    message: `${initialTask.title} 正在执行`,
  });

  try {
    const result = await runner();
    task = setTaskStatus(task, {
      status: 'succeeded',
      finishedAt: nowIso(),
      result,
      error: null,
    });

    const eventTitle = resolveTaskMessage(options.successTitle, task, `${task.title} 已完成`);
    const eventMessage = resolveTaskMessage(options.successMessage, task, `${task.title} 已完成`);
    task = setTaskStatus(task, { message: eventMessage });
    appendTaskEvent('info', eventTitle, eventMessage, task.id, {
      i18n: lifecycleTaskI18n(task, {
        titleKey: 'backgroundTask.lifecycle.completedTitle',
        messageKey: 'backgroundTask.lifecycle.completedMessage',
        message: resolveTaskI18n(options.successMessageI18n, task),
      }),
    });

    if (options.notifyOnSuccess) {
      await sendNotification(eventTitle, eventMessage, 'info');
    }
  } catch (error) {
    const errorText = summarizeError(error);
    task = setTaskStatus(task, {
      status: 'failed',
      finishedAt: nowIso(),
      error: errorText,
      message: `${task.title} 失败：${errorText}`,
    });

    const eventTitle = resolveTaskMessage(options.failureTitle, task, `${task.title} 失败`);
    const eventMessage = resolveTaskMessage(options.failureMessage, task, task.message);
    task = setTaskStatus(task, { message: eventMessage });
    appendTaskEvent('error', eventTitle, eventMessage, task.id, {
      i18n: lifecycleTaskI18n(task, {
        titleKey: 'backgroundTask.lifecycle.failedTitle',
        messageKey: 'backgroundTask.lifecycle.failedMessage',
        message: resolveTaskI18n(options.failureMessageI18n, task),
        extraParams: { error: task.error || 'unknown error' },
      }),
    });

    if (options.notifyOnFailure ?? true) {
      await sendNotification(eventTitle, eventMessage, 'error');
    }
  } finally {
    if (task.dedupeKey && dedupeTaskIds.get(task.dedupeKey) === task.id) {
      dedupeTaskIds.delete(task.dedupeKey);
    }
  }
}

function cleanupExpiredTasks() {
  const now = Date.now();
  for (const [taskId, task] of tasks.entries()) {
    if (task.expiresAtMs <= now) {
      tasks.delete(taskId);
      if (task.dedupeKey && dedupeTaskIds.get(task.dedupeKey) === taskId) {
        dedupeTaskIds.delete(task.dedupeKey);
      }
      cleanupTaskInternals(taskId);
    }
  }
}

function ensureCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanupExpiredTasks, TASK_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
}

export function startBackgroundTask(
  options: BackgroundTaskStartOptions,
  runner: () => Promise<unknown>,
): { task: BackgroundTask; reused: boolean } {
  ensureCleanupTimer();
  const dedupeKey = options.dedupeKey?.trim() || '';
  if (dedupeKey) {
    const existingTaskId = dedupeTaskIds.get(dedupeKey);
    if (existingTaskId) {
      const existing = tasks.get(existingTaskId);
      if (existing && (existing.status === 'pending' || existing.status === 'running')) {
        return { task: existing, reused: true };
      }
      dedupeTaskIds.delete(dedupeKey);
    }
  }

  const createdAt = nowIso();
  const task: BackgroundTask = {
    id: randomUUID(),
    type: options.type,
    title: options.title,
    titleKey: options.titleKey || null,
    status: 'pending',
    message: `${options.title} 已开始执行`,
    error: null,
    result: null,
    dedupeKey: dedupeKey || null,
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    finishedAt: null,
    expiresAtMs: Date.now() + Math.max(60_000, options.keepMs ?? TASK_TTL_MS),
    logs: [],
  };

  tasks.set(task.id, task);
  taskLogSeq.set(task.id, 0);
  if (dedupeKey) dedupeTaskIds.set(dedupeKey, task.id);

  appendTaskEvent('info', `${task.title} 已开始`, `${task.title} 已开始执行`, task.id, {
    scope: 'activity',
    i18n: lifecycleTaskI18n(task, {
      titleKey: 'backgroundTask.lifecycle.startedTitle',
      messageKey: 'backgroundTask.lifecycle.startedMessage',
    }),
  });
  void runTask(task.id, options, runner);
  return { task, reused: false };
}

export function getBackgroundTask(taskId: string): BackgroundTask | null {
  return tasks.get(taskId) || null;
}

export function listBackgroundTasks(limit = 50): BackgroundTask[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 50;
  return Array.from(tasks.values())
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, safeLimit);
}

export function getRunningTaskByDedupeKey(key: string): BackgroundTask | null {
  const taskId = dedupeTaskIds.get(key.trim());
  if (!taskId) return null;
  const task = tasks.get(taskId);
  if (!task) return null;
  if (task.status !== 'pending' && task.status !== 'running') return null;
  return task;
}

export async function waitForBackgroundTaskCompletion(taskId: string, pollIntervalMs = 25): Promise<BackgroundTask | null> {
  const safePollIntervalMs = Math.max(5, Math.trunc(pollIntervalMs || 0));
  while (true) {
    const task = getBackgroundTask(taskId);
    if (!task) return null;
    if (task.status !== 'pending' && task.status !== 'running') {
      return task;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, safePollIntervalMs);
      timer.unref?.();
    });
  }
}

export function summarizeCheckinResults(results: Array<{ result?: any }>): { total: number; success: number; skipped: number; failed: number } {
  const summary = { total: results.length, success: 0, skipped: 0, failed: 0 };
  for (const item of results) {
    const status = item?.result?.status;
    if (status === 'skipped' || item?.result?.skipped) {
      summary.skipped += 1;
      continue;
    }
    if (item?.result?.success) {
      summary.success += 1;
      continue;
    }
    summary.failed += 1;
  }
  return summary;
}

export function __resetBackgroundTasksForTests() {
  tasks.clear();
  dedupeTaskIds.clear();
  taskLogSeq.clear();
  taskLogSubscribers.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
