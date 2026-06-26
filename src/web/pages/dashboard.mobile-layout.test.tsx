import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Dashboard mobile layout', () => {
  it('uses the shared mobile breakpoint to select responsive chart grids', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/pages/Dashboard.tsx'), 'utf8');

    expect(source).toContain('import { useIsMobile } from "../components/useIsMobile.js";');
    expect(source).toContain('const isMobile = useIsMobile()');
    expect(source).toContain('!isMobile && "lg:grid-cols-2"');
    expect(source).toContain('!isMobile && "lg:grid-cols-[minmax(0,1fr)_20rem]"');
  });
});
