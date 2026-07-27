import { config } from '../config.js';

export function getProxyMaxTargetAttempts(): number {
  const attempts = Math.trunc(config.proxyMaxTargetAttempts || 0);
  return attempts > 0 ? attempts : 1;
}

export function getProxyMaxTargetRetries(): number {
  return Math.max(0, getProxyMaxTargetAttempts() - 1);
}

export function canRetryProxyTarget(retryCount: number): boolean {
  return retryCount < getProxyMaxTargetRetries();
}
