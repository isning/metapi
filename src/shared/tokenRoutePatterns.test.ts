import { describe, expect, it } from 'vitest';

describe('token route pattern helpers', () => {
  it('treats bracket-prefixed literal model names as exact patterns', async () => {
    const {
      isExactTokenRouteModelPattern,
      matchesTokenRouteModelPattern,
    } = await import('./tokenRoutePatterns.js');
    expect(isExactTokenRouteModelPattern('[NV]deepseek-v3.1-terminus')).toBe(true);
    expect(matchesTokenRouteModelPattern('[NV]deepseek-v3.1-terminus', '[NV]deepseek-v3.1-terminus')).toBe(true);
    expect(matchesTokenRouteModelPattern('Ndeepseek-v3.1-terminus', '[NV]deepseek-v3.1-terminus')).toBe(false);
  });

  it('rejects unsafe nested-quantifier regex patterns', async () => {
    const {
      matchesTokenRouteModelPattern,
      parseTokenRouteRegexPattern,
    } = await import('./tokenRoutePatterns.js');

    expect(parseTokenRouteRegexPattern('re:(?=claude)').regex).toBeNull();
    expect(matchesTokenRouteModelPattern('claude-sonnet-4-6', 're:(?=claude)')).toBe(false);
  });

  it('rejects regex syntax that the lightweight parser does not implement', async () => {
    const {
      matchesTokenRouteModelPattern,
      parseTokenRouteRegexPattern,
    } = await import('./tokenRoutePatterns.js');

    expect(parseTokenRouteRegexPattern('re:^(?:gpt|claude)-5$').regex).toBeNull();
    expect(matchesTokenRouteModelPattern('gpt-5', 're:^(?:gpt|claude)-5$')).toBe(false);
    expect(parseTokenRouteRegexPattern('re:^gpt-\\s+$').regex).toBeNull();
    expect(matchesTokenRouteModelPattern('gpt-   ', 're:^gpt-\\s+$')).toBe(false);
  });

  it('supports exact, glob, and safe regex route matches', async () => {
    const { matchesTokenRouteModelPattern } = await import('./tokenRoutePatterns.js');

    expect(matchesTokenRouteModelPattern('gpt-4o-mini', 'gpt-4o-mini')).toBe(true);
    expect(matchesTokenRouteModelPattern('claude-sonnet-4-6', 'claude-*')).toBe(true);
    expect(matchesTokenRouteModelPattern('claude-sonnet-4-6', 're:^claude-(opus|sonnet)-4-6$')).toBe(true);
    expect(matchesTokenRouteModelPattern('gpt-4o-mini-2025', 're:^gpt-4o-mini-\\d+$')).toBe(true);
  });

  it('reports regex parsing errors and distinguishes regex from exact model patterns', async () => {
    const {
      isExactTokenRouteModelPattern,
      isTokenRouteRegexPattern,
      parseTokenRouteRegexPattern,
    } = await import('./tokenRoutePatterns.js');

    expect(isTokenRouteRegexPattern('  RE:^gpt')).toBe(true);
    expect(isTokenRouteRegexPattern('gpt-*')).toBe(false);
    expect(isExactTokenRouteModelPattern('')).toBe(false);
    expect(isExactTokenRouteModelPattern('re:^gpt')).toBe(false);
    expect(isExactTokenRouteModelPattern('gpt-?')).toBe(false);
    expect(isExactTokenRouteModelPattern('gpt-4o')).toBe(true);
    expect(parseTokenRouteRegexPattern('gpt-*')).toEqual({ regex: null, error: null });
    expect(parseTokenRouteRegexPattern('re:   ')).toEqual({ regex: null, error: 're: 后缺少正则表达式' });
    expect(parseTokenRouteRegexPattern(`re:${'a'.repeat(257)}`)).toEqual({ regex: null, error: '出于安全原因不支持该正则表达式' });
    expect(parseTokenRouteRegexPattern('re:\\w+')).toEqual({ regex: null, error: '出于安全原因不支持该正则表达式' });
    expect(parseTokenRouteRegexPattern('re:(a)\\1')).toEqual({ regex: null, error: '出于安全原因不支持该正则表达式' });
  });

  it('matches the supported safe-regex feature set without using native RegExp', async () => {
    const { matchesTokenRouteModelPattern } = await import('./tokenRoutePatterns.js');

    expect(matchesTokenRouteModelPattern('x-gpt-42-preview', 're:gpt-\\d{2}')).toBe(true);
    expect(matchesTokenRouteModelPattern('gpt-999', 're:^gpt-\\d{2}$')).toBe(false);
    expect(matchesTokenRouteModelPattern('gpt-aa', 're:^gpt-[^0-9]+$')).toBe(true);
    expect(matchesTokenRouteModelPattern('gpt-12', 're:^gpt-[^0-9]+$')).toBe(false);
    expect(matchesTokenRouteModelPattern('claude-opus', 're:^claude-(sonnet|opus)$')).toBe(true);
    expect(matchesTokenRouteModelPattern('claude-haiku', 're:^claude-(sonnet|opus)$')).toBe(false);
    expect(matchesTokenRouteModelPattern('gpt-abc', 're:^gpt-.+$')).toBe(true);
    expect(matchesTokenRouteModelPattern('gpt-', 're:^gpt-.+$')).toBe(false);
    expect(matchesTokenRouteModelPattern('gpt', 're:^gpt-?$')).toBe(true);
    expect(matchesTokenRouteModelPattern('gpt-', 're:^gpt-?$')).toBe(true);
  });

  it('handles malformed safe-looking regex input as non-matches', async () => {
    const {
      matchesTokenRouteModelPattern,
      parseTokenRouteRegexPattern,
    } = await import('./tokenRoutePatterns.js');

    expect(parseTokenRouteRegexPattern('re:^gpt-[').error).toBe('出于安全原因不支持该正则表达式');
    expect(parseTokenRouteRegexPattern('re:^gpt-)').error).toBe('出于安全原因不支持该正则表达式');
    expect(parseTokenRouteRegexPattern('re:^gpt-(a|b)+$').error).toBe('出于安全原因不支持该正则表达式');
    expect(matchesTokenRouteModelPattern('gpt-a', 're:^gpt-(a|b)+$')).toBe(false);
  });

  it('falls back through glob wildcard backtracking and trims patterns before caching', async () => {
    const { matchesTokenRouteModelPattern } = await import('./tokenRoutePatterns.js');

    expect(matchesTokenRouteModelPattern('prefix-middle-suffix', ' prefix*mid?suffix ')).toBe(false);
    expect(matchesTokenRouteModelPattern('prefix-mid1suffix', ' prefix*mid?suffix ')).toBe(true);
    expect(matchesTokenRouteModelPattern('anything', '')).toBe(false);

    for (let index = 0; index < 4005; index += 1) {
      expect(matchesTokenRouteModelPattern(`model-${index}`, 'model-*')).toBe(true);
    }
    expect(matchesTokenRouteModelPattern('model-final', 'model-*')).toBe(true);
  });
});
