import { createHash } from 'node:crypto';

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function stableSha256(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) {
      result[key] = sortJson(child);
    }
  }
  return result;
}

