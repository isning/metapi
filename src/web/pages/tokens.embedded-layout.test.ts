import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Tokens embedded layout', () => {
  it('uses shadcn action layout when embedded in 连接管理', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/pages/Tokens.tsx'), 'utf8');

    expect(source).toContain('const headerActions = useMemo(() => (');
    expect(source).toContain('className="flex flex-wrap items-center gap-2"');
    expect(source).not.toContain('accounts-page-actions');
    expect(source).not.toContain('page-actions');
  });
});
