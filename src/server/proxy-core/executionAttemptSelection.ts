import { canRetryProxyTarget } from '../services/proxyTargetRetry.js';

export const TESTER_FORCED_EXECUTION_ATTEMPT_HEADER = 'x-metapi-tester-forced-execution-attempt-id';
export const TESTER_REQUEST_HEADER = 'x-metapi-tester-request';

function headerValueEquals(
  headers: Record<string, unknown> | undefined,
  expectedKey: string,
  expectedValue: string,
): boolean {
  if (!headers) return false;
  const normalizedExpectedKey = expectedKey.trim().toLowerCase();
  const normalizedExpectedValue = expectedValue.trim().toLowerCase();
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    if (rawKey.trim().toLowerCase() !== normalizedExpectedKey) continue;
    if (typeof rawValue === 'string' && rawValue.trim().toLowerCase() === normalizedExpectedValue) {
      return true;
    }
  }
  return false;
}

function isLoopbackClientIp(value: string | null | undefined): boolean {
  const trimmed = (value || '').trim();
  if (!trimmed) return false;
  if (trimmed === '::1' || trimmed === '127.0.0.1') return true;
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice('::ffff:'.length).trim() === '127.0.0.1';
  }
  return false;
}

export function normalizeForcedExecutionAttemptId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

type TesterRequestInput = {
  headers?: Record<string, unknown>;
  clientIp?: string | null;
};

export function isTrustedTesterRequest(input?: TesterRequestInput): boolean {
  if (!input) return false;
  if (!isLoopbackClientIp(input.clientIp)) return false;
  return headerValueEquals(input.headers, TESTER_REQUEST_HEADER, '1');
}

export function getTesterForcedExecutionAttemptId(input?: TesterRequestInput): string | null {
  if (!isTrustedTesterRequest(input)) return null;
  const headers = input?.headers;
  if (!headers) return null;
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    if (rawKey.trim().toLowerCase() !== TESTER_FORCED_EXECUTION_ATTEMPT_HEADER) continue;
    return normalizeForcedExecutionAttemptId(rawValue);
  }
  return null;
}

export function buildForcedExecutionAttemptUnavailableMessage(forcedExecutionAttemptId?: string | null): string {
  const normalized = normalizeForcedExecutionAttemptId(forcedExecutionAttemptId);
  if (!normalized) return 'No available execution attempt for this model';
  return `指定执行尝试 ${normalized} 当前不可用，固定执行尝试模式不会自动切换其他执行尝试`;
}

export function canRetryExecutionAttemptSelection(retryCount: number, forcedExecutionAttemptId?: string | null): boolean {
  if (normalizeForcedExecutionAttemptId(forcedExecutionAttemptId) !== null) return false;
  return canRetryProxyTarget(retryCount);
}
