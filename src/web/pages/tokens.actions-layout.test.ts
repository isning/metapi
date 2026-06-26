import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Tokens actions layout', () => {
  it('keeps common token actions inline and moves secondary actions into the overflow menu', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/pages/Tokens.tsx'), 'utf8');

    expect(source).toContain("import * as DropdownMenu from '../components/ui/dropdown-menu/index.js'");
    expect(source).toContain('Ellipsis');
    expect(source).toContain('TableHead className="min-w-36 text-right"');
    expect(source).toContain('TableCell className="min-w-36 text-right"');
    expect(source).toContain('ButtonGroup className="justify-end"');
    expect(source).not.toContain('ButtonGroup className="flex-wrap justify-end"');
    expect(source).toContain('<DropdownMenu.Content align="end" className="min-w-48">');
    expect(source).toContain('variant="destructive"');
  });
});
