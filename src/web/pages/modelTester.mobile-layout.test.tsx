import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ModelTester mobile layout', () => {
  it('switches the playground shell into a true single-column mobile layout', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/pages/ModelTester.tsx'), 'utf8');

    expect(source).toContain("import { useIsMobile } from '../components/useIsMobile.js'");
    expect(source).toContain('const isMobile = useIsMobile()');
    expect(source).toContain("const layoutColumns = isMobile");
    expect(source).toContain("gridTemplateColumns: layoutColumns");
    expect(source).toContain("isMobile ? 'grid-cols-2' : 'grid-cols-4'");
    expect(source).toContain("isMobile ? 'flex-col' : 'flex-row'");
    expect(source).toContain("isMobile ? 'order-1'");
    expect(source).toContain("isMobile ? 'order-2'");
  });
});
