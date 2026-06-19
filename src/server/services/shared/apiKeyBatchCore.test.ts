import { describe, expect, it } from 'vitest';
import {
  buildBatchApiKeyConnectionName,
  parseBatchApiKeys,
} from '../apiKeyBatch.js';

describe('parseBatchApiKeys', () => {
  it('normalizes an array into unique trimmed non-empty keys', () => {
    expect(parseBatchApiKeys([' sk-a ', '', null, 'sk-b', 'sk-a', 0, '  sk-c  '])).toEqual([
      'sk-a',
      'sk-b',
      'sk-c',
    ]);
  });

  it('splits text by whitespace and common list separators while preserving first occurrence order', () => {
    expect(parseBatchApiKeys(' sk-a,\nsk-b； sk-c;sk-a，sk-d\t sk-e ')).toEqual([
      'sk-a',
      'sk-b',
      'sk-c',
      'sk-d',
      'sk-e',
    ]);
  });

  it('returns an empty list for empty or missing input', () => {
    expect(parseBatchApiKeys('  \n ')).toEqual([]);
    expect(parseBatchApiKeys(null)).toEqual([]);
    expect(parseBatchApiKeys(undefined)).toEqual([]);
  });
});

describe('buildBatchApiKeyConnectionName', () => {
  it('uses the trimmed base name unchanged for a single key', () => {
    expect(buildBatchApiKeyConnectionName('  Production  ', 0, 1)).toBe('Production');
  });

  it('adds a one-based suffix when a batch creates multiple connections', () => {
    expect(buildBatchApiKeyConnectionName('Production', 2, 4)).toBe('Production #3');
  });

  it('returns an empty name when no base name is provided', () => {
    expect(buildBatchApiKeyConnectionName('', 0, 3)).toBe('');
    expect(buildBatchApiKeyConnectionName(null, 0, 3)).toBe('');
    expect(buildBatchApiKeyConnectionName(undefined, 0, 3)).toBe('');
  });
});
