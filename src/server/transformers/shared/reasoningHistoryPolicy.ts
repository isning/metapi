import type { ResolvedUpstreamCompatibilityPolicy } from '../../contracts/upstreamCompatibilityPolicy.js';

export type LimitedReasoningHistoryText = {
  text: string;
  overflowed: boolean;
  dropped: boolean;
};

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function truncateUtf8StringByBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (byteLength(value) <= maxBytes) return value;

  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (byteLength(value.slice(0, mid)) <= maxBytes) low = mid;
    else high = mid - 1;
  }

  const truncated = value.slice(0, low);
  return /[\uD800-\uDBFF]$/.test(truncated) ? truncated.slice(0, -1) : truncated;
}

export function limitReasoningHistoryText(
  text: string,
  policy: ResolvedUpstreamCompatibilityPolicy,
): LimitedReasoningHistoryText {
  const maxBytes = policy.reasoningHistory.transport.maxReasoningBytes;
  if (!text || !Number.isFinite(maxBytes) || maxBytes <= 0 || byteLength(text) <= maxBytes) {
    return {
      text,
      overflowed: false,
      dropped: false,
    };
  }

  if (policy.reasoningHistory.transport.overflow === 'drop') {
    return {
      text: '',
      overflowed: true,
      dropped: true,
    };
  }

  return {
    text: truncateUtf8StringByBytes(text, Math.trunc(maxBytes)),
    overflowed: true,
    dropped: false,
  };
}
