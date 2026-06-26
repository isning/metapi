import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('JsonCodeEditor theme contract', () => {
  it('tracks the app data-theme attribute and uses shadcn semantic tokens', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/components/JsonCodeEditor.tsx'), 'utf8');

    expect(source).toContain("getAttribute('data-theme')");
    expect(source).toContain("attributeFilter: ['class', 'data-theme']");
    expect(source).toContain("backgroundColor: 'var(--card)'");
    expect(source).toContain("color: 'var(--foreground)'");
    expect(source).toContain('syntaxHighlighting(HighlightStyle.define');
    expect(source).not.toContain('@codemirror/theme-one-dark');
    expect(source).not.toContain('oneDark');
  });

  it('disables live JSON linting for very large documents', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/components/JsonCodeEditor.tsx'), 'utf8');

    expect(source).toContain('JSON_LIVE_LINT_MAX_CHARS');
    expect(source).toContain('value.length > JSON_LIVE_LINT_MAX_CHARS');
    expect(source).toContain('linter(jsonParseLinter())');
  });
});
