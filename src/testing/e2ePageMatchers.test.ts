import { describe, expect, it } from 'vitest';

import { pagePathUrlPattern } from './e2ePageMatchers.js';

describe('e2e page matchers', () => {
  it('matches root paths with optional query and hash', () => {
    const pattern = pagePathUrlPattern('/');

    expect(pattern.test('http://127.0.0.1:4174/')).toBe(true);
    expect(pattern.test('http://127.0.0.1:4174/?tab=routes')).toBe(true);
    expect(pattern.test('http://127.0.0.1:4174/#/routes')).toBe(true);
    expect(pattern.test('http://127.0.0.1:4174/routes')).toBe(false);
  });

  it('matches named paths without treating path characters as regex', () => {
    const pattern = pagePathUrlPattern('/routes/new-model');

    expect(pattern.test('http://127.0.0.1:4174/routes/new-model')).toBe(true);
    expect(pattern.test('http://127.0.0.1:4174/routes/new-model?draft=1')).toBe(true);
    expect(pattern.test('http://127.0.0.1:4174/routes/new-model#editor')).toBe(true);
    expect(pattern.test('http://127.0.0.1:4174/routes/new-model/child')).toBe(false);
  });

  it('normalizes missing leading slashes', () => {
    const pattern = pagePathUrlPattern('settings');

    expect(pattern.test('http://127.0.0.1:4174/settings')).toBe(true);
    expect(pattern.test('http://127.0.0.1:4174/admin/settings')).toBe(false);
  });
});
