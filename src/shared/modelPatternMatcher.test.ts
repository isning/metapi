import { describe, expect, it } from 'vitest';
import {
  isExactModelPattern,
  isModelRegexPattern,
  matchesModelPattern,
  parseModelRegexPattern,
} from './modelPatternMatcher.js';

describe('model pattern matcher', () => {
  it('treats literal names as exact model patterns', () => {
    expect(isExactModelPattern('[NV]deepseek-v3.1-terminus')).toBe(true);
    expect(matchesModelPattern('[NV]deepseek-v3.1-terminus', '[NV]deepseek-v3.1-terminus')).toBe(true);
    expect(matchesModelPattern('Ndeepseek-v3.1-terminus', '[NV]deepseek-v3.1-terminus')).toBe(false);
  });

  it('matches exact, glob and safe regex patterns', () => {
    expect(matchesModelPattern('gpt-4o-mini', 'gpt-4o-mini')).toBe(true);
    expect(matchesModelPattern('claude-sonnet-4-6', 'claude-*')).toBe(true);
    expect(matchesModelPattern('claude-sonnet-4-6', 're:^claude-(opus|sonnet)-4-6$')).toBe(true);
    expect(matchesModelPattern('gpt-4o-mini-2025', 're:^gpt-4o-mini-\\d+$')).toBe(true);
  });

  it('identifies and parses regex patterns without native RegExp execution', () => {
    expect(isModelRegexPattern('  RE:^gpt')).toBe(true);
    expect(isModelRegexPattern('gpt-*')).toBe(false);
    expect(isExactModelPattern('re:^gpt')).toBe(false);
    expect(parseModelRegexPattern('gpt-*')).toEqual({ regex: null, error: null });
    expect(parseModelRegexPattern('re:^gpt-[').error).toBe('出于安全原因不支持该正则表达式');
  });

  it('rejects unsafe regex features as non-matches', () => {
    for (const pattern of ['re:(?=claude)', 're:^(?:gpt|claude)-5$', 're:(a)\\1', 're:\\w+']) {
      expect(parseModelRegexPattern(pattern).regex).toBeNull();
      expect(matchesModelPattern('claude-sonnet-4-6', pattern)).toBe(false);
    }
  });

  it('handles malformed patterns and glob backtracking predictably', () => {
    expect(matchesModelPattern('prefix-middle-suffix', ' prefix*mid?suffix ')).toBe(false);
    expect(matchesModelPattern('prefix-mid1suffix', ' prefix*mid?suffix ')).toBe(true);
    expect(matchesModelPattern('anything', '')).toBe(false);
    for (let index = 0; index < 50; index += 1) {
      expect(matchesModelPattern(`model-${index}`, 'model-*')).toBe(true);
    }
  });
});
