import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Sites mobile layout', () => {
  it('uses shared mobile card primitives in Sites page', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/pages/Sites.tsx'), 'utf8');
    expect(source).toContain("import { MobileCard, MobileField } from '../components/MobileCard.js'");
    expect(source).toContain('className="grid gap-3"');
  });
});
