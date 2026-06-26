import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Mobile layout shell styles', () => {
  it('does not depend on legacy page shell or pagination classes for mobile layout', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/web/index.css'), 'utf8').replace(/\r\n/g, '\n');

    expect(css).not.toContain('.page-actions');
    expect(css).not.toContain('.page-header');
    expect(css).not.toMatch(/\.pagination(?:\s|,|\{)/);
    expect(css).not.toContain('.pagination-size');
  });
});
