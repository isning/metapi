import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Mobile actions bar styles', () => {
  it('uses shadcn slots instead of page-level modal/mobile action skins', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/web/index.css'), 'utf8');

    expect(css).toContain('@theme inline');
    expect(css).not.toContain(['.modal', '-backdrop'].join(''));
    expect(css).not.toContain(['.mobile', '-actions-bar'].join(''));
  });
});
