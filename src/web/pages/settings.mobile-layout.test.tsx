import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Settings mobile layout', () => {
  it('collapses fixed form grids behind the shared mobile breakpoint', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/pages/Settings.tsx'), 'utf8');

    expect(source).toContain("import { useIsMobile } from '../components/useIsMobile.js'");
    expect(source).toContain('const isMobile = useIsMobile()');
    expect(source).toContain('md:grid-cols-[180px_180px_auto]');
    expect(source).toContain('md:grid-cols-2');
    expect(source).toContain('md:grid-cols-3');
  });
});
