import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('OAuthManagement mobile layout', () => {
  it('uses shadcn-native action layouts instead of legacy mobile wrappers', () => {
    const pageSource = readFileSync(resolve(process.cwd(), 'src/web/pages/OAuthManagement.tsx'), 'utf8');
    const cssSource = readFileSync(resolve(process.cwd(), 'src/web/index.css'), 'utf8');

    expect(pageSource).not.toContain('mobile-filter-row');
    expect(pageSource).toContain('data-testid="oauth-select-all"');
    expect(cssSource).not.toContain('.oauth-row-actions');
    expect(cssSource).not.toContain('.oauth-mobile-trigger-row');
    expect(cssSource).not.toContain('.oauth-toolbar-actions');
  });
});
