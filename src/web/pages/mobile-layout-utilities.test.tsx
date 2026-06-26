import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Mobile layout utilities', () => {
  it('keeps mobile layout off legacy global pagination classes', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/web/index.css'), 'utf8');

    expect(css).not.toContain('.page-actions');
    expect(css).not.toMatch(/\.pagination(?:\s|,|\{)/);
    expect(css).not.toContain('.pagination-size');
    expect(css).not.toContain('.pagination-btn');
  });
});
