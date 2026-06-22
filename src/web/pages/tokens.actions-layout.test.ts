import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Tokens actions layout', () => {
  it('reuses a wrapping actions cell layout so token row actions do not overflow', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/pages/Tokens.tsx'), 'utf8');

    expect(source).toContain('ButtonGroup className="flex-wrap justify-end"');
    expect(source).toContain('TableHead className="min-w-56 text-right"');
    expect(source).toContain('TableCell className="min-w-56 text-right"');
  });
});
